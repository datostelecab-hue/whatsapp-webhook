// ============================================================
// LAS BAJAS MÉDICAS Y SUS PARTES (módulo 1 del plan de RR. HH., db/303)
// ============================================================
// El encargo: «bajas nuevas, prórrogas o confirmaciones, rectificaciones y
// altas, con la fecha prevista de cada una. Prórrogas y confirmaciones se
// actualizan solas. Dos días hábiles antes del fin previsto, comprobar si hay
// prórroga. Solo si se confirma el alta se crea una tarjeta a Diana para la
// reincorporación y se avisa a planificación».
//
// Camilo, 26/11/2026: a mano hasta que llegue el fichero del INSS (que meterá
// los mismos partes, `origen` 'fie'); con el alta, vuelve AL DÍA SIGUIENTE (la
// baja de su ficha se cierra el día del alta); los apunta quien valida
// ausencias; el aviso, al área de Planificación.
//
// La baja es la situación «baja médica» de su ficha (la de siempre: manda en el
// planificador y en la bitácora). Cada parte la mueve:
//   baja          la abre (desde el día del parte), con su fecha prevista
//   confirmación  cambia la fecha prevista (una prórroga)
//   alta          la cierra el día del alta; vuelve al día siguiente
//   rectificación corrige el primer día o la fecha prevista, con motivo
//
// CADA DÍA a las 08:00 (`bajas.revisar`): a la baja abierta cuya fecha prevista
// está a dos días hábiles o menos (o ya pasó) le nace una tarjeta a quien
// valida ausencias, «comprobar si hay prórroga o alta»; se cierra sola con la
// confirmación o el alta. Y el aviso de su vuelta a Planificación se da por
// visto cuando ya está en el planificador ese día (o caduca).
'use strict';

const repo = require('./bajas.repo');
const aus = require('./ausencias.service');
const libro = require('../../services/libro');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const avisos = require('../../services/avisos');
const organizacion = require('../../services/organizacion');
const tareasProgramadas = require('../../services/tareasProgramadas');
const adjuntos = require('../../services/adjuntos');

const CONTINGENCIAS = {
  comun: 'Enfermedad común',
  accidente_no_laboral: 'Accidente no laboral',
  enfermedad_profesional: 'Enfermedad profesional',
  accidente_trabajo: 'Accidente de trabajo',
};
const TIPOS = { baja: 'Parte de baja', confirmacion: 'Confirmación (prórroga)', alta: 'Parte de alta', rectificacion: 'Rectificación' };
const TARJETA_REVISAR = 'baja_revisar';
const TARJETA_VUELVE = 'baja_reincorporacion';
const AVISO_VUELVE = 'baja_vuelve';
const DUENO = 'baja_medica';
const AVISO_DIAS = 2;

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const exigir = async (quien, llave) => { if (!await aus.puede(quien, llave)) throw error('No tienes permiso para esto', 403); };
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const diana = async () => ((await organizacion.quienes('ausencias_validar', { conSuplentes: false }).catch(() => []))[0] || {}).id || null;

async function exigirTabla() { if (!await repo.hayTabla()) throw error('Falta aplicar la migración 303'); }

/** Cómo va una baja: en plazo, toca revisar (fin previsto cerca o pasado sin parte), o de alta. */
function estadoDe(b, hoy, cal) {
  if (b.hasta) return { clave: 'alta', etiqueta: `Alta: vuelve el ${dmy(calendario.sumarDias(b.hasta, 1))}`, tono: 'green' };
  if (!b.prevista) return { clave: 'sin_prevista', etiqueta: 'Sin fecha prevista', tono: 'muted' };
  if (b.prevista < hoy) return { clave: 'vencida', etiqueta: `Fin previsto pasado (${dmy(b.prevista)}): falta el parte`, tono: 'red' };
  if (cal.diasHabilesEntre(hoy, b.prevista) <= AVISO_DIAS) return { clave: 'revisar', etiqueta: `Comprobar prórroga o alta (${dmy(b.prevista)})`, tono: 'warn' };
  return { clave: 'en_plazo', etiqueta: `Hasta el ${dmy(b.prevista)} (previsto)`, tono: 'azul' };
}

async function lista(quien) {
  await exigir(quien, aus.CLAVE_VER);
  const base = { contingencias: CONTINGENCIAS, tipos: TIPOS, puedeValidar: await aus.puede(quien, aus.CLAVE_VALIDAR) };
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, ...base };
  const hoy = calendario.hoy();
  const cal = await calendario.de('madrid');
  const filas = (await repo.lista()).map(b => ({ ...b, dias: diasEntre(b.desde, b.hasta || hoy) + 1, estado: estadoDe(b, hoy, cal) }));
  return { filas, recientes: await repo.recientes(7), ...base };
}

async function ficha(id, quien) {
  await exigir(quien, aus.CLAVE_VER);
  const b = await repo.situacion(null, String(id));
  if (!b) throw error('No existe esa baja', 404);
  const hoy = calendario.hoy();
  return { ...b, dias: diasEntre(b.desde, b.hasta || hoy) + 1, estado: estadoDe(b, hoy, await calendario.de('madrid')),
    vuelve: b.hasta ? calendario.sumarDias(b.hasta, 1) : null, historia: await repo.partesDe(b.id) };
}

/** PARTE DE BAJA: abre la baja de su ficha desde ese día, con su fecha prevista. */
async function nuevaBaja(b = {}, quien) {
  await exigir(quien, aus.CLAVE_VALIDAR);
  await exigirTabla();
  const conductorId = Number(b.conductorId);
  if (!Number.isInteger(conductorId) || conductorId <= 0) throw error('Elige a la persona');
  if (!esIso(b.fecha)) throw error('Falta el día de la baja');
  if (b.prevista && (!esIso(b.prevista) || b.prevista < b.fecha)) throw error('La fecha prevista va antes que la baja');
  if (b.contingencia && !CONTINGENCIAS[b.contingencia]) throw error('Esa contingencia no existe');
  const ya = await repo.abiertaDe(null, conductorId, b.fecha);
  if (ya) throw error(`Ya tiene una baja desde el ${dmy(ya.desde)}${ya.hasta ? ` hasta el ${dmy(ya.hasta)}` : ''}: apunta una confirmación o una rectificación`, 409);
  const nota = String(b.nota || '').trim();
  const plantilla = require('../Conductores/plantilla.service');
  const puesta = await plantilla.anadirAusencia(conductorId,
    { estado: 'baja_medica', desde: b.fecha, hasta: null, motivo: `Parte de baja${b.contingencia ? ` (${CONTINGENCIAS[b.contingencia].toLowerCase()})` : ''}${nota ? `: ${nota}` : ''}` }, quien);
  const situacionId = puesta && puesta.anadida ? String(puesta.anadida.id) : (await repo.abiertaDe(null, conductorId, b.fecha) || {}).id;
  if (!situacionId) throw error('No se ha podido abrir la baja en su ficha');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'bajas', accion: 'alta', motivo: `Parte de baja del ${dmy(b.fecha)}` }, async cli => {
    if (b.prevista) await repo.ponerPrevista(cli, situacionId, b.prevista);
    await repo.insertarParte(cli, { conductorId, situacionId, tipo: 'baja', fecha: b.fecha, prevista: b.prevista, contingencia: b.contingencia,
      nota, creadoPor: quien.usuarioId });
  });
  return { ok: true, id: situacionId };
}

async function cargarAbierta(id) {
  const b = await repo.situacion(null, String(id));
  if (!b) throw error('No existe esa baja', 404);
  return b;
}

/** CONFIRMACIÓN (prórroga): la nueva fecha prevista. Cierra la tarjeta de «comprobar». */
async function confirmacion(id, d = {}, quien) {
  await exigir(quien, aus.CLAVE_VALIDAR);
  await exigirTabla();
  const b = await cargarAbierta(id);
  if (b.hasta) throw error('Esta baja ya tiene el alta');
  if (!esIso(d.fecha)) throw error('Falta el día del parte');
  if (!esIso(d.prevista)) throw error('Falta la nueva fecha prevista');
  if (d.fecha < b.desde || d.prevista < d.fecha) throw error('Las fechas no cuadran con la baja');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'bajas', accion: 'cambio', motivo: `Confirmación de la baja de ${b.nombre}: hasta el ${dmy(d.prevista)}` }, async cli => {
    await repo.ponerPrevista(cli, b.id, d.prevista);
    await repo.insertarParte(cli, { conductorId: b.conductor_id, situacionId: b.id, tipo: 'confirmacion', fecha: d.fecha, prevista: d.prevista,
      nota: String(d.nota || '').trim(), creadoPor: quien.usuarioId });
    await tablero.cerrarPorOrigen(cli, { tipo: TARJETA_REVISAR, origenId: b.id, autorId: quien.usuarioId, nota: `Prórroga hasta el ${dmy(d.prevista)}` });
  });
  return { ok: true };
}

/** ALTA: cierra la baja el día del alta; vuelve al siguiente. Tarjeta a Diana y aviso a Planificación. */
async function alta(id, d = {}, quien) {
  await exigir(quien, aus.CLAVE_VALIDAR);
  await exigirTabla();
  const b = await cargarAbierta(id);
  if (b.hasta) throw error('Esta baja ya tiene el alta');
  if (!esIso(d.fecha)) throw error('Falta el día del alta');
  if (d.fecha < b.desde) throw error('El alta va antes que la baja');
  const vuelve = calendario.sumarDias(d.fecha, 1);
  const plantilla = require('../Conductores/plantilla.service');
  await plantilla.editarAusencia(Number(b.conductor_id), Number(b.id), { hasta: d.fecha }, quien);
  const responsable = await diana();
  const cal = await calendario.de('madrid');
  const hoy = calendario.hoy();
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'bajas', accion: 'cambio', motivo: `Alta de ${b.nombre} el ${dmy(d.fecha)}` }, async cli => {
    await repo.insertarParte(cli, { conductorId: b.conductor_id, situacionId: b.id, tipo: 'alta', fecha: d.fecha,
      nota: String(d.nota || '').trim(), creadoPor: quien.usuarioId });
    await tablero.cerrarPorOrigen(cli, { tipo: TARJETA_REVISAR, origenId: b.id, autorId: quien.usuarioId, nota: `Alta el ${dmy(d.fecha)}` });
    await tablero.nacer(cli, {
      tipo: TARJETA_VUELVE, origenId: b.id, sensible: true, enlace: `/ausencias?vista=bajas&baja=${encodeURIComponent(b.id)}`,
      titulo: `Reincorporación de ${b.nombre} el ${dmy(vuelve)}`,
      descripcion: `Le dieron el alta el ${dmy(d.fecha)} y vuelve el ${dmy(vuelve)}. Comprueba que está en el planificador y lo que haga falta para su vuelta.`,
      responsableId: responsable, plazoDias: vuelve > hoy ? cal.diasHabilesEntre(hoy, vuelve) : 0,
    });
  });
  // A Planificación: que lo tenga en el cuadrante (se da por visto cuando ya está, o caduca).
  await avisos.emitir({ tipo: AVISO_VUELVE, origenId: b.id, area: 'planificacion', enlace: '/planificador',
    titulo: `${b.nombre} vuelve de baja médica el ${dmy(vuelve)}`,
    texto: 'Tiene el alta. Si aún no está en el cuadrante para ese día, ponlo.',
    caducaAt: `${calendario.sumarDias(vuelve, 1)}T00:00:00+01:00`, autorId: quien.usuarioId }).catch(e => console.error('⚠️ [Bajas] aviso a Planificación:', e.message));
  return { ok: true, vuelve };
}

/** RECTIFICACIÓN: corrige el primer día o la fecha prevista, con motivo. */
async function rectificar(id, d = {}, quien) {
  await exigir(quien, aus.CLAVE_VALIDAR);
  await exigirTabla();
  const b = await cargarAbierta(id);
  const motivo = String(d.nota || '').trim();
  if (motivo.length < 3) throw error('Di qué se rectifica y por qué');
  const desde = esIso(d.desde) ? d.desde : null;
  const prevista = esIso(d.prevista) ? d.prevista : null;
  if (!desde && !prevista) throw error('Cambia el primer día o la fecha prevista');
  if (desde && b.hasta && desde > b.hasta) throw error('El primer día va después del alta');
  if (desde && desde !== b.desde) {
    const plantilla = require('../Conductores/plantilla.service');
    await plantilla.editarAusencia(Number(b.conductor_id), Number(b.id), { desde }, quien);
  }
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'bajas', accion: 'cambio', motivo: `Rectificación de la baja de ${b.nombre}: ${motivo}` }, async cli => {
    if (prevista) await repo.ponerPrevista(cli, b.id, prevista);
    await repo.insertarParte(cli, { conductorId: b.conductor_id, situacionId: b.id, tipo: 'rectificacion', fecha: calendario.hoy(),
      prevista, nota: `${desde && desde !== b.desde ? `Primer día: del ${dmy(b.desde)} al ${dmy(desde)}. ` : ''}${motivo}`, creadoPor: quien.usuarioId });
  });
  return { ok: true };
}

/** Las personas para un parte de baja: de alta, o que se fueron hace poco. */
async function personas(quien) {
  await exigir(quien, aus.CLAVE_VALIDAR);
  const db = require('../../services/db');
  const pruebas = require('../../services/repo/fichaDePruebas');
  const r = await db.consulta(
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo
       FROM conductor c WHERE NOT c.es_centinela${await pruebas.fuera('c')} AND c.empleo_vigente ORDER BY 2`);
  return { personas: r.rows };
}

// ── Cada día: las tarjetas de «comprobar» y los avisos ya vistos ─────────────
tablero.registrarTipo(TARJETA_REVISAR, { etiqueta: 'Baja médica: comprobar prórroga o alta', abrir: 'Abrir la baja', cierreManual: false });
tablero.registrarTipo(TARJETA_VUELVE, { etiqueta: 'Reincorporación tras una baja', abrir: 'Abrir la baja' });
avisos.registrarTipo(AVISO_VUELVE, { etiqueta: 'Vuelve de baja médica', modulo: 'ausencias', icono: 'fa-person-walking', area: 'planificacion' });

async function revisar({ cli = null, hoy = calendario.hoy() } = {}) {
  if (!await repo.hayTabla(cli)) return { sinTabla: true };
  const cal = await calendario.de('madrid');
  const responsable = await diana();
  let nacidas = 0, vistos = 0;
  for (const b of await repo.lista(10)) {
    if (!b.hasta && b.prevista && (b.prevista < hoy || cal.diasHabilesEntre(hoy, b.prevista) <= AVISO_DIAS)) {
      const t = await tablero.nacer(cli, {
        tipo: TARJETA_REVISAR, origenId: b.id, sensible: true, enlace: `/ausencias?vista=bajas&baja=${encodeURIComponent(b.id)}`,
        titulo: `Comprobar si hay prórroga o alta: ${b.nombre} (fin previsto ${dmy(b.prevista)})`,
        descripcion: 'Su parte dice que la baja acaba ese día. Mira si llega la confirmación (apúntala y la fecha prevista cambia) o el alta (apúntala y se avisa a Planificación).',
        responsableId: responsable, plazoDias: b.prevista > hoy ? cal.diasHabilesEntre(hoy, b.prevista) : 0,
      });
      if (t.nueva) nacidas++;
    }
    // El aviso de su vuelta: visto si ya está en el planificador ese día.
    if (b.hasta) {
      const vuelve = calendario.sumarDias(b.hasta, 1);
      if (vuelve >= hoy && await repo.planificadoEl(cli, b.conductor_id, vuelve)) {
        if (await avisos.resolverPorOrigen({ tipo: AVISO_VUELVE, origenId: b.id, nota: 'Ya está en el planificador' }, { cli })) vistos++;
      }
    }
  }
  return { nacidas, vistos };
}

tareasProgramadas.registrar({
  clave: 'bajas.revisar',
  descripcion: 'Cada día a las 08:00, las bajas médicas cuyo fin previsto está a dos días hábiles: tarjeta para comprobar si hay prórroga o alta',
  desde: '2026-11-27',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '08:00' }),
  hacer: ({ cli }) => revisar({ cli }),
});

// Los partes escaneados (el PDF o la foto del parte), en la baja: datos de salud.
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DUENO, {
  etiqueta: 'Partes de una baja médica',
  ver: async q => aus.puede(quienDe(q), aus.CLAVE_VER),
  adjuntar: async q => aus.puede(quienDe(q), aus.CLAVE_VALIDAR),
});

module.exports = { CONTINGENCIAS, TIPOS, DUENO, lista, ficha, nuevaBaja, confirmacion, alta, rectificar, personas, revisar };
