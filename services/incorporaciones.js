// ============================================================
// INCORPORACIONES — Tráfico coloca a quien llega de Administración
// ============================================================
// Cuando Administración crea la ficha en la agenda (Pendiente Asignar), el
// conductor le llega a Tráfico como una INCORPORACIÓN con los datos de su vacante.
// Desde SUS pendientes (sin abrir el planificador) Tráfico puede:
//   · Aceptar → se auto-asigna a la(s) matrícula(s) de la vacante con sus días y
//     libranzas ya puestos (escribe en el planificador por detrás).
//   · Asignar manualmente → se queda "Pendiente Asignar" para colocarlo a mano.
// En ambos casos la incorporación se marca resuelta y la vacante se CIERRA.
// El "Aceptar" es best-effort: si no puede colocar limpio (matrícula que no está
// en el planificador, sin hueco libre), NO escribe nada y degrada a manual.

const TZ = 'Europe/Madrid';
function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
// "S D" / "L,M" → [5,6] / [0,1]. "a definir" (fijo) → [] (no se toca la libranza).
function parseLibranza(s) {
  const up = (s == null ? '' : s).toString().toUpperCase();
  if (/DEFINIR/.test(up)) return [];
  const out = [];
  up.split(/[^A-Z]+/).filter(Boolean).forEach(tok => {
    const i = LETRAS.indexOf(tok);   // solo tokens que sean exactamente una letra de día
    if (i >= 0 && !out.includes(i)) out.push(i);
  });
  return out;
}
const norm = s => (s == null ? '' : s).toString().trim().toUpperCase();

/**
 * Intenta colocar al conductor (por su ID_BOLT) en las matrículas de la vacante,
 * con los días de cada matrícula y sus libranzas. Devuelve {ok, motivo|matriculas}.
 * Si algo no encaja, NO escribe nada (para no dejar el planificador a medias).
 */
async function autoAsignar(vacante, idBolt) {
  idBolt = (idBolt || '').toString().trim();
  if (!idBolt) return { ok: false, motivo: 'el conductor no tiene ID de BOLT' };
  const planif = require('./planificadorV2');
  const tablero = await planif.leerTablero();
  const coches = tablero.coches || [];
  const rol = /^\s*CT/i.test(vacante.puesto || '') ? 'CT' : 'FIJO';
  const turno = vacante.turno || 'Día';

  const cambios = [];
  const usados = new Set();
  for (const m of (vacante.matriculas || [])) {
    const mat = norm(m.m);
    if (!mat) continue;
    const coche = coches.find(c => norm(c.matricula) === mat);
    if (!coche) return { ok: false, motivo: `la matrícula ${m.m} no está en el planificador` };
    const slot = (coche.personas || []).find(p =>
      p.turno === turno && p.rol === rol && !p.id && !usados.has(coche.idx + '-' + p.slot));
    if (!slot) return { ok: false, motivo: `no hay hueco libre de ${turno} (${rol === 'CT' ? 'correturno' : 'fijo'}) en ${m.m}` };
    usados.add(coche.idx + '-' + slot.slot);
    const dias = (m.d && m.d.length) ? planif.diasALetras(m.d) : undefined;
    cambios.push({ coche: coche.idx, slots: [{ slot: slot.slot, id: idBolt, ...(dias !== undefined ? { dias } : {}) }] });
  }
  if (!cambios.length) return { ok: false, motivo: 'la vacante no tiene matrículas' };

  try {
    await planif.guardarCambios(cambios);
  } catch (e) {
    return { ok: false, motivo: 'el planificador rechazó la asignación: ' + (e.message || '') };
  }

  // Libranzas del conductor (solo si la vacante las trae definidas; en un fijo van
  // "a definir" y las pone Tráfico después).
  const lib = parseLibranza(vacante.libranzas);
  if (lib.length) {
    const campos = {};
    ['libLun', 'libMar', 'libMie', 'libJue', 'libVie', 'libSab', 'libDom']
      .forEach((k, i) => { campos[k] = lib.includes(i); });
    try { await planif.actualizarConductor(idBolt, campos); } catch (_) { /* la asignación ya entró */ }
  }
  return { ok: true, matriculas: cambios.length };
}

/**
 * Resuelve una incorporación. modo:
 *   · 'aceptar' → intenta auto-asignar; si no puede, degrada a manual con aviso.
 *   · 'manual'  → se deja "Pendiente Asignar".
 * En ambos: la ficha pasa a "Asignado" y la vacante se cierra ("resuelta").
 */
async function resolver(tel, modo) {
  const tickets = require('./tickets');
  const t = await tickets.leerTicket(tel);
  if (!t) throw new Error('No existe esa incorporación');
  if (t.etapa !== tickets.ETAPAS.TRAFICO || t.estado !== tickets.ESTADOS.ALTA) {
    throw new Error('Esta incorporación ya no está pendiente en Tráfico');
  }
  const vId = (t.vacante || '').toString().trim();
  let aviso = '', auto = false;

  if (modo === 'aceptar') {
    if (!vId) throw new Error('Esta ficha no tiene vacante para auto-asignar. Usa "Asignar manualmente".');
    const vac = (await require('./vacantes').leerVacantesGuardadas()).find(v => v.id === vId);
    if (!vac) throw new Error('No se encontró la vacante de esta ficha.');
    const r = await autoAsignar(vac, t.id_bolt);
    if (r.ok) { auto = true; aviso = `Asignado a ${r.matriculas} matrícula(s) con sus libranzas.`; }
    else { aviso = `No se pudo asignar automáticamente (${r.motivo}). Queda como Pendiente Asignar para colocarlo a mano.`; }
  } else {
    aviso = 'Queda como Pendiente Asignar para colocarlo en el planificador.';
  }

  await tickets.guardarCelda(tel, 'estado', tickets.ESTADOS.ASIGNADO);
  await tickets.guardarCelda(tel, 'fecha_asignado', ahora());
  if (vId) { try { await require('./vacantes').actualizarEstadoVacante(vId, 'Cerrada'); } catch (_) {} }

  return { ok: true, auto, aviso };
}

module.exports = { autoAsignar, resolver };
