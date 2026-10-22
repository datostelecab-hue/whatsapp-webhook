// ============================================================
// COMBUSTIBLE · DE QUIÉN ES LA TARJETA
// ============================================================
// Puro: ni base ni red. Lo que dice el correo en «Conductor» y con quién casa.
//
// EN «CONDUCTOR» NO SIEMPRE HAY UNA PERSONA. De los nueve primeros correos:
//
//   «Juan Carlos Silva Sánchez»                       una persona
//   «PROVISIONAL 54»                                  una tarjeta provisional
//   «PROVISIONAL 52  [chico de apoyo en Barcelona]»   provisional, con una nota
//   «[TALLER GUTI]»                                   una tarjeta del taller
//
// Una tarjeta provisional no es de nadie: quien repostó lo dice BOLT (quién
// llevaba el coche a esa hora), no el correo. Por eso se marca y no se casa.
//
// EL NOMBRE SE CASA POR SUS PALABRAS, no por cómo está escrito: «PAULA ANDREA
// DIAZ ARAQUE» y «Paula Andrea Díaz Araque» son la misma (normClave del núcleo:
// sin tildes, en minúsculas, palabras ordenadas). Y como la tarjeta, la ficha y
// BOLT no siempre llevan los mismos apellidos, vale también que las palabras de
// uno estén todas en el otro, con dos como mínimo: «Isac Muntean» casa con
// «Isac Fernando Muntean». Si eso vale para dos personas distintas, NO se enlaza
// con ninguna («ambiguo»): enlazar mal es peor que no enlazar, porque luego se
// audita a quien no era.

const { normClave } = require('../../services/nucleo');

// Las palabras que no distinguen a nadie: «María del Mar» y «María Mar».
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos']);
const palabras = nombre => normClave(nombre).split(' ').filter(p => p && !VACIAS.has(p));

/**
 * Separa lo que dice la tarjeta.
 * → { nombre, provisional, nota }: `nombre` es la persona (o null si no lo es),
 *   `nota` lo que va entre corchetes.
 */
function tarjeta(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  const notas = [...t.matchAll(/\[([^\]]*)\]/g)].map(m => m[1].trim()).filter(Boolean);
  const fuera = t.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const provisional = /^provisional\b/i.test(fuera);
  // Una persona tiene al menos dos palabras con letras. «PROVISIONAL 54» no.
  const nombre = !provisional && palabras(fuera).filter(p => /[a-z]/.test(p)).length >= 2 ? fuera : null;
  return { nombre, provisional, nota: notas.join(' · ') || null };
}

/** ¿Son la misma persona escrita de dos maneras? 'exacto', 'parecido' o null. */
function comoCasan(a, b) {
  const pa = palabras(a), pb = palabras(b);
  if (pa.length < 2 || pb.length < 2) return null;
  if (pa.join(' ') === pb.join(' ')) return 'exacto';
  const [corto, largo] = pa.length <= pb.length ? [pa, new Set(pb)] : [pb, new Set(pa)];
  return corto.every(p => largo.has(p)) ? 'parecido' : null;
}

/**
 * Casa el nombre de la tarjeta con las personas que conoce el ERP.
 *
 * `candidatos`: [{ conductorId, cuentaBolt, nombre, sede }] — las fichas (con su
 * nombre y su nombre de BOLT) y las cuentas de BOLT (Barcelona no tiene fichas:
 * allí la persona ES su cuenta). Una persona es su ficha si la tiene y, si no,
 * su cuenta de BOLT.
 *
 * `sede`: la del coche. Solo sirve para desempatar: si el nombre vale para una
 * persona de Madrid y otra de Barcelona, se queda con la de la sede del coche.
 *
 * → { como: 'exacto' | 'parecido' | 'ambiguo' | 'nadie', conductorId, cuentaBolt, nombre }
 */
function casarNombre(nombre, candidatos, { sede } = {}) {
  const nadie = { como: 'nadie', conductorId: null, cuentaBolt: null, nombre: null };
  if (palabras(nombre).length < 2) return nadie;

  for (const nivel of ['exacto', 'parecido']) {
    const porPersona = new Map();
    for (const c of candidatos || []) {
      const como = comoCasan(nombre, c.nombre);
      if (!como || (nivel === 'exacto' && como !== 'exacto')) continue;
      const k = c.conductorId ? 'c' + c.conductorId : 'b' + c.cuentaBolt;
      if (!porPersona.has(k)) porPersona.set(k, []);
      porPersona.get(k).push(c);
    }
    if (!porPersona.size) continue;
    let personas = [...porPersona.values()];
    if (personas.length > 1 && sede) {
      const deLaSede = personas.filter(filas => filas.some(f => f.sede === sede));
      if (deLaSede.length) personas = deLaSede;
    }
    if (personas.length > 1) return { ...nadie, como: 'ambiguo' };
    // Su cuenta de BOLT, aunque en BOLT se llame de otra forma: la ficha de
    // «Rubén Ortega Lafuente» casa exacta y su cuenta se llama «Rubén Ortega».
    const k = personas[0][0].conductorId ? 'c' + personas[0][0].conductorId : null;
    const filas = k ? (candidatos || []).filter(c => c.conductorId && 'c' + c.conductorId === k) : personas[0];
    const cuenta = filas.find(f => f.cuentaBolt && (!sede || f.sede === sede)) || filas.find(f => f.cuentaBolt);
    return {
      como: nivel,
      conductorId: (filas.find(f => f.conductorId) || {}).conductorId || null,
      cuentaBolt: cuenta ? cuenta.cuentaBolt : null,
      nombre: filas[0].nombre,
    };
  }
  return nadie;
}

/**
 * ¿La persona de la tarjeta es la que estaba en BOLT con el coche?
 *
 * Por lo más firme que haya: la ficha de los dos, si no la cuenta de BOLT
 * (Barcelona), y si no, el nombre. null cuando no hay con qué comparar.
 *
 * Dos cuentas de BOLT distintas NO dicen que sean dos personas: hay 72 con más
 * de una cuenta (conductor_externo). Por eso, si las cuentas no son la misma,
 * manda el nombre, y solo sin nombres se da por distinta.
 */
function coincide(t, b) {
  if (!t || !b) return null;
  if (t.conductorId && b.conductorId) return String(t.conductorId) === String(b.conductorId);
  if (t.cuentaBolt && b.uuid && t.cuentaBolt === b.uuid) return true;
  if (t.nombre && b.nombre) return !!comoCasan(t.nombre, b.nombre);
  if (t.cuentaBolt && b.uuid) return false;
  return null;
}

module.exports = { tarjeta, casarNombre, comoCasan, coincide };
