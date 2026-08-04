// ============================================================
// TURNOS POR CONDUCTOR — instrucciones de relevo de la semana
// ============================================================
// A partir del tablero (planificadorV2) arma, para cada conductor, su semana día a
// día: qué coche lleva, de quién lo recibe y a quién se lo entrega (con teléfono).
// Lo usan la pestaña "Por conductor" de Cobertura y el botón "Ver mis turnos" del bot.
// Se apoya en `coche.semana` (14 tramos) y `coche.relevos` (pasos de un tramo a otro),
// que ya calcula planificadorV2.

const { DIAS_SEM, TURNOS } = require('./planificadorV2');

/**
 * Devuelve, por conductor, su semana: [{ id, nombre, telefono, dias: [7] }], donde
 * cada día es { diaNombre, trabaja } y, si trabaja: { turno, matricula, recibeDe, entregaA }.
 * recibeDe / entregaA = { nombre, telefono, directo } o null (sin relevo).
 */
function instruccionesPorConductor(tablero) {
  const conductores = (tablero && tablero.conductores) || [];
  const coches = (tablero && tablero.coches) || [];

  const porId = new Map();
  conductores.forEach(c => { if (c.idBolt) porId.set(c.idBolt, c); });
  const telDe = id => { const c = porId.get(id); return (c && (c.telefono || '').toString().trim()) || ''; };
  const nombreDe = id => { const c = porId.get(id); return (c && c.nombre) || id; };

  const relevos = [];
  coches.forEach(c => (c.relevos || []).forEach(r => relevos.push(r)));

  // Tramos que conduce cada uno: id → [{ diaIdx, diaNombre, turno, matricula }]
  const slots = new Map();
  coches.forEach(coche => (coche.semana || []).forEach(tr => {
    if (!tr.id) return;
    if (!slots.has(tr.id)) slots.set(tr.id, []);
    slots.get(tr.id).push({ diaIdx: tr.dia, diaNombre: tr.diaNombre, turno: tr.turno, matricula: coche.matricula });
  }));

  const buscaRecibe = (id, s) => relevos.find(r => r.matricula === s.matricula && r.recibe.id === id && r.recibe.dia === s.diaNombre && r.recibe.turno === s.turno);
  const buscaEntrega = (id, s) => relevos.find(r => r.matricula === s.matricula && r.entrega.id === id && r.entrega.dia === s.diaNombre && r.entrega.turno === s.turno);
  const ordTurno = t => { const i = TURNOS.indexOf(t); return i < 0 ? 99 : i; };

  const salida = [];
  for (const [id, misSlots] of slots.entries()) {
    const dias = DIAS_SEM.map((diaNombre, d) => {
      const delDia = misSlots.filter(s => s.diaIdx === d).sort((a, b) => ordTurno(a.turno) - ordTurno(b.turno));
      if (!delDia.length) return { diaNombre, trabaja: false };

      const primero = delDia[0], ultimo = delDia[delDia.length - 1];
      const rec = buscaRecibe(id, primero);     // de quién lo coge (al empezar)
      const ent = buscaEntrega(id, ultimo);      // a quién se lo deja (al terminar)
      return {
        diaNombre, trabaja: true,
        turno: delDia.map(s => s.turno).join(' y '),
        matricula: primero.matricula,
        recibeDe: rec ? { nombre: rec.entrega.nombre, telefono: telDe(rec.entrega.id), directo: !!rec.directo } : null,
        entregaA: ent ? { nombre: ent.recibe.nombre, telefono: telDe(ent.recibe.id), directo: !!ent.directo } : null
      };
    });
    salida.push({ id, nombre: nombreDe(id), telefono: telDe(id), dias });
  }
  return salida.sort((a, b) => (a.nombre || a.id).localeCompare(b.nombre || b.id, 'es'));
}

// El planner usa días abreviados; para el mensaje al conductor van completos.
const DIAS_LARGOS = { Lun: 'Lunes', Mar: 'Martes', Mié: 'Miércoles', Mie: 'Miércoles', Jue: 'Jueves', Vie: 'Viernes', Sáb: 'Sábado', Sab: 'Sábado', Dom: 'Domingo' };
const diaLargo = d => DIAS_LARGOS[d] || d;

/** Une una lista de nombres de día: ["Martes","Miércoles"] → "Martes y Miércoles". */
function unirDias(nombres) {
  if (nombres.length === 1) return nombres[0];
  return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1];
}

/** Mensaje de WhatsApp con los turnos/relevos de un conductor (una entrada de la lista). */
function mensajeTurnos(entrada) {
  if (!entrada) return 'No encuentro tus turnos de esta semana. Avisa a la oficina, por favor.';
  const L = [`👋 Hola ${entrada.nombre}, estos son tus turnos y relevos de esta semana:`, ''];
  const dias = entrada.dias;
  const tel = x => (x.telefono ? ` (${x.telefono})` : '');

  let i = 0;
  while (i < dias.length) {
    const d = dias[i];
    if (!d.trabaja) {
      let j = i; while (j < dias.length && !dias[j].trabaja) j++;
      L.push(`😴 *${unirDias(dias.slice(i, j).map(x => diaLargo(x.diaNombre)))}*: libras`, '');
      i = j; continue;
    }
    L.push(`📅 *${diaLargo(d.diaNombre)}* · turno de ${d.turno} · coche *${d.matricula}*`);
    if (d.recibeDe) {
      L.push(d.recibeDe.directo
        ? `   🔑 Recibes el coche de *${d.recibeDe.nombre}*${tel(d.recibeDe)}`
        : `   🔑 Coges el coche donde quedó (lo dejó *${d.recibeDe.nombre}*)`);
    } else {
      L.push('   🔑 Coges el coche donde quedó aparcado');
    }
    if (d.entregaA) {
      L.push(d.entregaA.directo
        ? `   🤝 Al terminar tu turno, lo entregas a *${d.entregaA.nombre}*${tel(d.entregaA)}`
        : `   🅿️ Al terminar, deja el coche aparcado (luego lo coge *${d.entregaA.nombre}*)`);
    } else {
      L.push('   🅿️ Al terminar tu turno, dejas el coche aparcado');
    }
    L.push('');
    i++;
  }
  return L.join('\n').trim();
}

module.exports = { instruccionesPorConductor, mensajeTurnos };
