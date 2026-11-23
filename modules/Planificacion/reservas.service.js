// ============================================================
// PLAZAS RESERVADAS EN EL PLANIFICADOR (db/277, 23/11/2026)
// ============================================================
// Camilo: «vamos a eliminar completamente el módulo de vacantes en RRHH y
// Generar vacantes en tráfico, se harán directamente desde el planificador.
// Cuando tengo un "Hueco" en un cuadrante, puedo separar esa plaza para alguien
// que esté en proceso de terminar su alta, tanto de ETT como propia (…) la plaza
// se puede guardar como "Sin nombre". Va a estar el mensaje de "Plaza
// reservada" pero se puede planificar, si alguien es planificado y no hay
// nadie, entonces el hasta no se verá. Pero si ponen a alguien que ya tiene un
// alta prevista, entonces el hasta del conductor planificado irá hasta ese
// día, para que el de la plaza prometida llegue directamente a ese puesto».
// Y: «se la planifica sí o sí, para algo se le guardó el puesto».
//
// LAS REGLAS
//   · Se reserva una plaza (un hueco) para una persona en proceso de alta o
//     «Sin nombre». Una reserva abierta por plaza y por persona.
//   · CON PERSONA Y FECHA (su alta, o el inicio previsto de su candidatura): se
//     la PLANIFICA desde ese día, en el acto. Si alguien está en la plaza, acaba
//     la víspera (se libera la plaza desde ese día y se la coloca). Y quien se
//     planifique después en la plaza acaba solo la víspera: el auto-corte de
//     `colocar` (planificador.repo).
//   · SIN NOMBRE, o la persona sin fecha: solo el cartel. Quien se planifique,
//     sin hasta. Cuando la fecha se sepa, la tarea de cada mañana (o el alta) la
//     planifica.
//   · Se CIERRA sola («cumplida») cuando la persona ya está en su plaza; y a
//     mano («quitada»). Quitarla quita también su planificación si aún no había
//     empezado. Nada se borra.
'use strict';

const libro = require('../../services/libro');
const tareasProgramadas = require('../../services/tareasProgramadas');
const repo = require('./reservas.repo');
const plan = require('./planificador.repo');

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const err = (m, status = 400) => Object.assign(new Error(m), { status });

/** Quién está en proceso de alta, para elegirle en «Reservar plaza». */
async function candidatos() {
  return { personas: (await repo.enProceso()).map(p => ({
    id: Number(p.id), nombre: p.nombre, tipo: p.tipo, estado: p.estado, llega: p.llega || null, reservada: !!p.reservada,
  })) };
}

/**
 * PLANIFICAR a la persona de una reserva desde el día que llega (nunca antes de
 * hoy). En un solo movimiento: la plaza se libera desde ese día (quien esté,
 * acaba la víspera) y se la coloca. Devuelve el día, o null si no hay nada que
 * hacer (sin persona, sin fecha, o ya planificada).
 */
async function planificar(reserva, { usuarioId } = {}) {
  if (!reserva || !reserva.conductor_id || reserva.asignacion_id || !reserva.llega) return null;
  const hoy = hoyMadrid();
  const desde = reserva.llega < hoy ? hoy : reserva.llega;
  const plazaId = String(reserva.plaza_id);
  await plan.guardar([{ slots: [
    { plazaId, id: '', desde },
    { plazaId, id: String(reserva.conductor_id), desde },
  ] }], { dia: desde, usuarioId });
  const asignacionId = await repo.asignacionDesde(null, { plazaId, conductorId: reserva.conductor_id, desde });
  if (asignacionId) await repo.ponerAsignacion(null, reserva.id, asignacionId);
  return desde;
}

/** Reservar un hueco: para una persona en proceso de alta, o «Sin nombre». */
async function reservar({ plazaId, conductorId, nota } = {}, { usuarioId } = {}) {
  const plaza = Number(plazaId);
  if (!Number.isInteger(plaza) || plaza <= 0 || !await repo.plazaExiste(plaza)) throw err('Esa plaza ya no existe: recarga el tablero');
  let persona = null;
  if (conductorId != null && String(conductorId).trim() !== '') {
    persona = Number(conductorId);
    const enProceso = (await repo.enProceso()).find(p => Number(p.id) === persona);
    if (!enProceso) throw err('Esa persona no está en proceso de alta');
    if (enProceso.reservada) throw err(`${enProceso.nombre} ya tiene una plaza reservada: quita esa antes`, 409);
  }
  const texto = String(nota || '').trim().slice(0, 500);
  let id;
  try {
    id = await libro.conFirma({ usuarioId, origen: 'planificador.reservas', accion: 'alta' },
      cli => repo.crear(cli, { plazaId: plaza, conductorId: persona, nota: texto, usuarioId }));
  } catch (e) {
    if (repo.falta(e)) throw err('Falta aplicar la migración db/277', 409);
    if (e.code === '23505') throw err('Esa plaza ya está reservada', 409);
    throw e;
  }
  // Con persona y fecha, se la planifica ya. Si eso falla, la reserva se queda
  // (es lo que se pidió) y se dice por qué no se ha podido planificar.
  let planificadaDesde = null, aviso = null;
  try {
    planificadaDesde = await planificar(await repo.una(null, id), { usuarioId });
  } catch (e) {
    aviso = `La plaza queda reservada, pero no se ha podido planificar a la persona: ${e.message}`;
  }
  return { id, planificadaDesde, aviso };
}

/** Quitar una reserva (con su planificación, si aún no había empezado). */
async function quitar(id, { usuarioId } = {}) {
  const r = await repo.una(null, Number(id));
  if (!r || r.cerrada_at) throw err('Esa reserva ya no está', 404);
  let soltada = false;
  if (r.asignacion_id) {
    const a = await repo.asignacion(null, r.asignacion_id);
    if (a && a.desde > hoyMadrid() && String(a.conductor_id) === String(r.conductor_id)) {
      await plan.guardar([{ slots: [{ plazaId: String(a.plaza_id), id: '', desde: a.desde }] }], { dia: a.desde, usuarioId });
      soltada = true;
    }
  }
  await libro.conFirma({ usuarioId, origen: 'planificador.reservas', accion: 'baja' },
    cli => repo.cerrar(cli, r.id, { motivo: 'quitada', usuarioId }));
  return { ok: true, soltada };
}

/**
 * Al dar de alta a alguien (ETT o propia): si tenía una plaza reservada y aún
 * no estaba planificado, se le planifica desde su alta. Nunca tumba el alta.
 */
async function alDarDeAlta({ conductorId, usuarioId } = {}) {
  try {
    const r = (await repo.abiertas()).find(x => String(x.conductor_id) === String(conductorId));
    if (!r || r.asignacion_id) return null;
    return await planificar(await repo.una(null, r.id), { usuarioId });
  } catch (e) {
    console.error('⚠️ [RESERVAS] al dar de alta:', e.message);
    return null;
  }
}

/**
 * LA VUELTA DE CADA MAÑANA: planifica a quien ya tiene fecha y aún no lo
 * estaba, y cierra como «cumplidas» las reservas cuya persona ya está en su
 * plaza (su planificación ha empezado).
 */
async function repasar() {
  const hoy = hoyMadrid();
  let planificadas = 0, cumplidas = 0, errores = 0;
  for (const r of await repo.abiertas()) {
    try {
      if (r.conductor_id && !r.asignacion_id && r.llega) {
        if (await planificar(await repo.una(null, r.id), {})) planificadas++;
      } else if (r.asignacion_id && r.planificada_desde && r.planificada_desde <= hoy) {
        if (await repo.cerrar(null, r.id, { motivo: 'cumplida' })) cumplidas++;
      }
    } catch (e) {
      errores++;
      console.error(`⚠️ [RESERVAS] reserva ${r.id}:`, e.message);
    }
  }
  return { planificadas, cumplidas, errores };
}

tareasProgramadas.registrar({
  clave: 'planificador.reservas',
  descripcion: 'Plazas reservadas: planifica a quien ya tiene fecha de alta y cierra las que ya se cumplieron',
  desde: '2026-11-24',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '06:00' }),
  hacer: () => repasar(),
});

module.exports = { candidatos, reservar, quitar, alDarDeAlta, repasar };
