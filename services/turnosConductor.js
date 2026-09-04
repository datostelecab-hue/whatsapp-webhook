// ============================================================
// TURNOS POR CONDUCTOR — el mensaje de WhatsApp y a quién le toca
// ============================================================
// La SEMANA de cada conductor (qué coche lleva, de quién lo recibe y a quién se lo
// entrega) la calcula `repo/cobertura.porConductor` desde el tablero de PostgreSQL.
// Aquí queda solo lo que rodea al mensaje:
//
//   · mensajeTurnos(entrada)          → el texto que se le manda por WhatsApp.
//   · resolver(lista, { phone, … })   → de un teléfono a SU entrada de la lista.
//
// Cero hojas: antes esto leía el tablero de Sheets y volvía del teléfono a la
// persona comparando NOMBRES (fallaba con una tilde, con los apellidos en otro
// orden o si el teléfono no estaba en el padrón). Ahora el teléfono identifica
// solo, contra la base; el nombre queda de red por si acaso.

const cob = require('./repo/cobertura');

// El planner usa días abreviados; para el mensaje al conductor van completos.
const DIAS_LARGOS = {
  Lun: 'Lunes', Mar: 'Martes', Mié: 'Miércoles', Mie: 'Miércoles',
  Jue: 'Jueves', Vie: 'Viernes', Sáb: 'Sábado', Sab: 'Sábado', Dom: 'Domingo',
};
const diaLargo = d => DIAS_LARGOS[d] || d;

/** Une nombres de día: ["Martes","Miércoles"] → "Martes y Miércoles". */
function unirDias(nombres) {
  if (nombres.length === 1) return nombres[0];
  return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1];
}

/** Mensaje de WhatsApp con los turnos y relevos de la semana de un conductor. */
function mensajeTurnos(entrada) {
  if (!entrada) return 'No encuentro tus turnos de esta semana. Avisa a la oficina, por favor.';
  const L = [`👋 Hola ${entrada.nombre}, estos son tus turnos y relevos de esta semana:`, ''];
  const dias = entrada.dias || [];
  const tel = x => (x.telefono ? ` (${x.telefono})` : '');

  let i = 0;
  while (i < dias.length) {
    const d = dias[i];
    // Un día que NO está cargado en el planificador no se menciona: ni trabaja ni
    // libra, sencillamente no hay dato. Antes salía como "libras" y era mentira
    // (los días anteriores a la migración salían todos como libranza).
    if (d.sinPlan) { i++; continue; }
    if (!d.trabaja) {
      let j = i; while (j < dias.length && !dias[j].trabaja && !dias[j].sinPlan) j++;
      L.push(`😴 *${unirDias(dias.slice(i, j).map(x => diaLargo(x.diaNombre)))}*: libras`, '');
      i = j; continue;
    }
    L.push(`📅 *${diaLargo(d.diaNombre)}* · turno de ${d.turno} · coche *${d.matricula}*`);
    if (d.recibeDe) L.push(`   🔑 Recibes el coche de *${d.recibeDe.nombre}*${tel(d.recibeDe)}`);
    if (d.entregaA) L.push(`   🤝 Al terminar tu turno, lo entregas a *${d.entregaA.nombre}*${tel(d.entregaA)}`);
    L.push('');
    i++;
  }
  // Si de toda la semana no salió ni un día (aún sin plan cargado), se dice claro,
  // en vez de mandar un saludo huérfano que no informa de nada.
  if (L.length <= 2) {
    return `👋 Hola ${entrada.nombre}, todavía no tengo cargados tus turnos de esa semana. ` +
           'En cuanto estén, te aviso.';
  }
  return L.join('\n').trim();
}

// Nombre normalizado para la red de seguridad: sin tildes, en minúsculas y con las
// palabras ordenadas, para que "Juan Pérez Gómez" y "Gómez, Juan Perez" casen.
const normNombre = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .trim().split(/\s+/).filter(Boolean).sort().join(' ');

const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);

/**
 * De un teléfono a SU entrada de la semana.
 *
 * 1. Por TELÉFONO contra la base (lo normal y lo fiable: el sufijo de 9 dígitos es
 *    único, así que no hay margen de error).
 * 2. Por el teléfono que ya trae la propia lista (mismo criterio, sin otra consulta).
 * 3. Por NOMBRE (el de la sesión del bot), como último cartucho.
 *
 * Devuelve { entrada, como } — `como` dice por dónde se resolvió, que es lo que
 * hace diagnosticable el caso raro.
 */
async function resolver(lista, { phone, nombreSesion } = {}) {
  const L = lista || [];

  // 1. El teléfono, contra la base.
  try {
    const p = await cob.conductorPorTelefono(phone);
    if (p) {
      const e = L.find(x => String(x.id) === p.conductorId);
      if (e) return { entrada: e, como: 'telefono' };
      // Está en la base pero no le toca ningún turno esta semana: eso NO es un
      // fallo de identificación, es que libra. Se dice tal cual.
      return { entrada: null, como: 'sin-turnos', quien: p.nombre };
    }
  } catch (e) {
    console.error('⚠️ [Turnos] conductorPorTelefono:', e.message);
  }

  // 2. El teléfono que ya viene en la lista.
  const mio = tel9(phone);
  if (mio) {
    const e = L.find(x => tel9(x.telefono) === mio);
    if (e) return { entrada: e, como: 'telefono-lista' };
  }

  // 3. El nombre de la sesión.
  const clave = normNombre(nombreSesion);
  if (clave) {
    const e = L.find(x => normNombre(x.nombre) === clave);
    if (e) return { entrada: e, como: 'nombre' };
  }

  return { entrada: null, como: 'no-identificado' };
}

module.exports = { mensajeTurnos, resolver, normNombre, tel9 };
