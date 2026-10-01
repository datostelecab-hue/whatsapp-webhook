// ============================================================
// CONDUCTORES — la puerta para quien no es Conductores
// ============================================================
// La persona —su ficha, sus teléfonos, su IBAN, sus contratos, su turno y su
// cuenta de BOLT— es de Conductores. Selección la crea y la completa mientras
// dura el proceso, y la da de alta al contratarla; hasta el 01/10/2026 lo hacía
// entrando por la puerta de atrás en `conductores.repo` (a través del puente
// `services/repo/conductores`). Ahora entra por aquí.
//
// Casi todo es la puerta, sin más: las reglas de cada escritura —qué campos
// valen, cómo se cifra el IBAN, qué abre un contrato— están en el repositorio y
// en su cabecera. Lo único que vive aquí es `realizarAlta`, que es coordinación
// y no datos.

const repo = require('./conductores.repo');
const alta = require('../../services/repo/alta');

/**
 * Da de alta a alguien con lo que sepamos de él, decidiendo solo si es un alta
 * nueva o una restauración.
 *
 * Es el ÚNICO sitio por el que entra gente al sistema, lo llame Selección con
 * un candidato de TIBUS o el módulo de ETT con una tabla pegada. La diferencia
 * entre esos dos no es cómo se crea la ficha: es cuántos datos traen. Por eso no
 * hay dos funciones.
 *
 * `datos` lleva el teléfono, las columnas de la ficha que se sepan, y las del
 * contrato (`alta`, `tipo`, `jornadaHoras`…). Lo que no venga, no se toca.
 *
 * (Era `services/repo/alta.realizar`, hasta el 01/10/2026: un repositorio no
 * puede coordinar a otro módulo, y esto es coordinación pura. Mismo código.)
 */
async function realizarAlta(datos, quien = {}) {
  const d = datos || {};
  const s = await alta.porTelefono(d.telefono);

  if (s.caso === 'ya_trabaja') {
    const e = new Error(`${s.ficha.quien} ya tiene contrato abierto. No hay nada que dar de alta.`);
    e.situacion = s;
    throw e;
  }

  // Los campos de la ficha son los declarados en CAMPOS; el resto (alta, tipo,
  // jornada…) son del contrato y van por otro camino. Separarlos aquí evita que
  // `actualizar` rechace la llamada entera por un campo que no le toca.
  const ficha = {};
  for (const [k, v] of Object.entries(d)) {
    if (repo.CAMPOS[k] && v !== '' && v !== null && v !== undefined) ficha[k] = v;
  }
  const contrato = {
    tipo: d.tipo === 'ett' ? 'ett' : 'propia',
    ettNombre: d.ettNombre,
    alta: d.alta,
    antiguedad: d.antiguedad,
    jornadaHoras: d.jornadaHoras,
    finPrueba: d.finPrueba,
  };

  let id, restaurado = false;
  if (s.ficha) {
    // Restauración: la ficha se queda, con su historial. Se actualiza lo que
    // venga nuevo (puede haber cambiado de dirección en un año) y se le abre un
    // periodo de empleo más.
    id = s.ficha.id;
    restaurado = true;
    if (Object.keys(ficha).length) await repo.actualizar(id, ficha, quien);
    await repo.darDeAlta(id, contrato, quien);
    // Si vuelve con un número que no era el suyo, se le añade.
    if (!s.ficha.telefonoVigente) await repo.guardarTelefono(id, d.telefono, quien);
  } else {
    const r = await repo.crear({ ...ficha, ...contrato, telefono: d.telefono,
                                 turnoId: d.turnoId, libranzas: d.libranzas }, quien);
    id = r.id;
  }

  // La cuenta de BOLT: si existe con ese número y no es de nadie, se enlaza
  // sola. Es el caso que describe `alta_con_bolt`, y hacerlo a mano después solo
  // sirve para que se olvide.
  let boltEnlazada = false;
  if (s.bolt && !s.bolt.enlazadaCon) {
    try { await repo.enlazarBolt(id, s.bolt.cuentaId, quien); boltEnlazada = true; }
    catch (e) { console.error(`❌ [ALTA] no se pudo enlazar la cuenta de BOLT: ${e.message}`); }
  }

  return {
    id, restaurado, caso: s.caso, boltEnlazada,
    // Sin cuenta de BOLT no puede conducir. Se devuelve para que la pantalla lo
    // diga en el momento y no se descubra el día que tiene que salir.
    faltaBolt: !s.bolt,
    avisos: s.avisos,
  };
}

module.exports = {
  // Qué es un campo de la ficha (y de qué tipo). Es un catálogo, no una función.
  CAMPOS: repo.CAMPOS,
  crearPersona: (...a) => repo.crearPersona(...a),
  actualizar: (...a) => repo.actualizar(...a),
  guardarTelefono: (...a) => repo.guardarTelefono(...a),
  guardarIban: (...a) => repo.guardarIban(...a),
  darDeAlta: (...a) => repo.darDeAlta(...a),
  cambiarTurno: (...a) => repo.cambiarTurno(...a),
  enlazarBolt: (...a) => repo.enlazarBolt(...a),
  realizarAlta,
};
