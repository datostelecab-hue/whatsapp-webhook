// ============================================================
// TURNOS POR CONDUCTOR — instrucciones de relevo de la semana
// ============================================================
// A partir del tablero (planificadorV2) arma, para cada conductor, su semana día a
// día: qué coche lleva, de quién lo recibe y a quién se lo entrega (con teléfono).
// Lo usan la pestaña "Por conductor" de Cobertura y el botón "Ver mis turnos" del bot.
// Se apoya en `coche.semana` (14 tramos) y `coche.relevos` (pasos de un tramo a otro),
// que ya calcula planificadorV2.

const { DIAS_SEM, TURNOS } = require('./planificadorV2');
const { normClave } = require('./conductores');

/**
 * Devuelve, por conductor, su semana: [{ id, nombre, telefono, dias: [7] }], donde
 * cada día es { diaNombre, trabaja } y, si trabaja: { turno, matricula, recibeDe, entregaA }.
 * recibeDe / entregaA = { nombre, telefono, directo } o null (sin relevo).
 */
function instruccionesPorConductor(tablero, telefonosExtra) {
  const conductores = (tablero && tablero.conductores) || [];
  const coches = (tablero && tablero.coches) || [];
  const extra = telefonosExtra instanceof Map ? telefonosExtra : new Map();

  const porId = new Map();
  conductores.forEach(c => { if (c.idBolt) porId.set(c.idBolt, c); });
  // Teléfono: el de la agenda y, si está vacío, el de DB_CONDUCTORES (por nombre normalizado).
  const telDe = id => {
    const c = porId.get(id);
    return ((c && (c.telefono || '').toString().trim()) || '') || extra.get(normClave(id)) || '';
  };
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
    if (d.recibeDe) L.push(`   🔑 Recibes el coche de *${d.recibeDe.nombre}*${tel(d.recibeDe)}`);
    if (d.entregaA) L.push(`   🤝 Al terminar tu turno, lo entregas a *${d.entregaA.nombre}*${tel(d.entregaA)}`);
    L.push('');
    i++;
  }
  return L.join('\n').trim();
}

// ── ¿Qué entrada de la lista es la de ESTE teléfono? ─────────────────────────
// El aviso se manda al teléfono de la agenda, pero al pulsar el botón hay que
// volver del teléfono a la persona. Antes se intentaba solo por el padrón de
// BOLT y comparando el nombre letra a letra: si el teléfono no estaba en el
// padrón o el nombre difería en una tilde o en el orden de los apellidos, el
// conductor recibía "no encuentro tus turnos" (caso Israel Alvarado, 18/08/2026).
// Ahora se reúnen TODAS las identidades disponibles y se compara con normClave
// (sin tildes, sin mayúsculas y con las palabras ordenadas).

const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);

/**
 * Claves (normClave) que pueden identificar al que llama:
 *  - conductores de la agenda cuyo teléfono coincide (la fuente A LA QUE se mandó el aviso),
 *  - entradas de DB_CONDUCTORES (Map normClave(nombre) → teléfono) con ese teléfono,
 *  - su nombre en el padrón de BOLT, si se tiene,
 *  - el nombre de la sesión del bot, si la hay.
 */
function clavesDe({ phone, conductores, telsDB, padronNombre, nombreSesion }) {
  const mio = tel9(phone);
  const claves = new Set();
  if (mio) {
    (conductores || []).forEach(c => {
      if (tel9(c.telefono) === mio && (c.idBolt || c.id)) claves.add(normClave(c.idBolt || c.id));
    });
    if (telsDB instanceof Map) {
      for (const [clave, tel] of telsDB) if (tel9(tel) === mio) claves.add(clave);
    }
  }
  if ((padronNombre || '').trim()) claves.add(normClave(padronNombre));
  if ((nombreSesion || '').trim()) claves.add(normClave(nombreSesion));
  claves.delete('');
  return claves;
}

/** Primera entrada cuya id o nombre (normalizados) esté entre las claves. */
function entradaPorClaves(lista, claves) {
  if (!claves || !claves.size) return null;
  return (lista || []).find(e => claves.has(normClave(e.id)) || claves.has(normClave(e.nombre))) || null;
}

module.exports = { instruccionesPorConductor, mensajeTurnos, clavesDe, entradaPorClaves };
