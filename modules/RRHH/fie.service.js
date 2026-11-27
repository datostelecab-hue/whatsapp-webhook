// ============================================================
// EL FICHERO FIE DE LA GESTORÍA — LA PUERTA (módulo 1, segunda parte, db/312, 27/11/2026)
// ============================================================
// Camilo: «este es el fichero FIE el cual nos pasa la gestoría todos los días,
// en el cual nos dice quién verdaderamente está de baja médica, la fecha de baja
// y la fecha de alta (…) si alguien en Telecab pone la fecha de alta y de baja
// de una baja médica que no coincide con el Excel de la gestoría, este Excel lo
// corrige ya que es lo legal (…) la verificación empieza desde el 27 de septiembre».
//
//   · LLEGA POR CORREO: Diana reenvía cada FIE a datos@telecab.es, el buzón de
//     los repostajes. Cada hora se lee en solo lectura (como los repostajes): los
//     correos «FICHERO FIE …» con su Excel. Cada fichero entra una vez (huella,
//     `fichero_importado` tipo 'fie'); uno vacío es un día sin novedades.
//   · CADA PROCESO DE IT (persona + fecha de baja) guarda lo último que dijo el
//     FIE (`fie_proceso`). Se cruza por el DOCUMENTO (el IPF sin su primer dígito).
//   · LO QUE HACE CON LAS BAJAS DEL ERP (el FIE manda):
//       - no la tiene → la abre (parte de baja, origen 'fie');
//       - otro primer día → lo rectifica;
//       - la Fecha Fin IT es el DÍA DEL ALTA: la cierra ese día y vuelve al
//         siguiente (parte de alta; si vuelve de hoy en adelante, la tarjeta de
//         reincorporación y el aviso a Planificación, como el alta a mano);
//       - sin fecha de fin (o con el alta anulada) y cerrada en el ERP → la reabre;
//       - con la próxima revisión médica → esa es su fecha prevista;
//       - con el parte de baja anulado → la quita.
//   · Una baja del ERP de la plantilla propia desde el 27/09 que no sale en
//     ningún FIE se SEÑALA para revisar; no se toca.
//   · PRIMERO UNA PREVIA (Camilo: «primero una previa, luego automático»): hasta
//     que alguien con la llave de validar ausencias pulsa «Aplicar», solo se
//     enseña lo que cambiaría. Desde entonces (`fie_automatico` en config_app),
//     cada FIE nuevo se aplica solo.
'use strict';

const db = require('../../services/db');
const repo = require('./fie.repo');
const fie = require('./fie');
const aus = require('./ausencias.service');
const bajasRepo = require('./bajas.repo');
const libro = require('../../services/libro');
const calendario = require('../../services/calendario');
const ficheros = require('../../services/ficherosImportados');
const configApp = require('../../services/configApp');
const tareasProgramadas = require('../../services/tareasProgramadas');

const DESDE = '2026-09-27';
const TIPO_FICHERO = 'fie';
const SISTEMA = { usuarioId: null, rol: 'sistema' };
const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

ficheros.registrarTipo(TIPO_FICHERO, {
  etiqueta: 'Fichero FIE de la gestoría (bajas médicas)',
  ver: async q => aus.puede({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol }, aus.CLAVE_VALIDAR),
});

// ── EL PLAN (puro): qué haría con cada proceso, contra sus bajas ─────────────
const finEfectivo = p => (p.fecha_fin && !p.alta_anulada ? p.fecha_fin : null);
const solapa = (b, p) => b.desde <= (finEfectivo(p) || '9999-12-31') && (b.hasta || '9999-12-31') >= p.fecha_baja;

/**
 * Los procesos de UNA persona (en orden) contra sus bajas del ERP: lo que
 * habría que hacer con cada uno. Va cambiando su copia de las bajas, para que
 * el segundo proceso (una recaída) vea cómo quedó el primero.
 *
 * En el ERP una baja larga suele estar PARTIDA en tramos (uno por parte), y a
 * veces empieza antes que el FIE (27/11/2026, visto en producción). Por eso, con
 * los tramos que tocan el proceso (del día de la baja al del alta, o sin fin):
 *   · el que empieza ANTES se corta el día anterior (`recortar`): lo de antes no
 *     se borra —puede ser de un proceso anterior al 27/09— y queda en «bajas
 *     del ERP sin FIE» para revisarlo;
 *   · el primero que empieza dentro es LA baja del proceso: se le pone su primer
 *     día, su alta (o se reabre) y su revisión;
 *   · los demás que caben dentro son trozos de la misma: se quitan (`quitar`);
 *   · uno que empieza dentro y sigue después del alta es del proceso siguiente:
 *     empieza al día siguiente del alta (`desplazar`).
 * → [{ proceso, acciones: [{ tipo, … }] }]
 */
function planear(procesos, bajas) {
  const copia = bajas.map(b => ({ ...b }));
  return [...procesos].sort((a, b) => a.fecha_baja.localeCompare(b.fecha_baja)).map(p => {
    const acciones = [];
    if (p.baja_anulada) {
      const exacta = copia.find(b => b.desde === p.fecha_baja);
      if (exacta) { acciones.push({ tipo: 'anular', bajaId: exacta.id, desde: exacta.desde }); copia.splice(copia.indexOf(exacta), 1); }
      return { proceso: p, acciones };
    }
    const fe = finEfectivo(p);
    const fin = fe || '9999-12-31';
    const tocan = copia.filter(b => solapa(b, p)).sort((a, b) => a.desde.localeCompare(b.desde));
    // Lo que empieza antes: se corta, no se borra.
    for (const t of tocan.filter(b => b.desde < p.fecha_baja)) {
      const hasta = calendario.sumarDias(p.fecha_baja, -1);
      acciones.push({ tipo: 'recortar', bajaId: t.id, desde: t.desde, de: t.hasta || null, a: hasta });
      t.hasta = hasta;
    }
    const dentro = tocan.filter(b => b.desde >= p.fecha_baja);
    const b = dentro[0];
    for (const t of dentro.slice(1)) {
      if ((t.hasta || '9999-12-31') <= fin) {
        acciones.push({ tipo: 'quitar', bajaId: t.id, desde: t.desde, hasta: t.hasta || null });
        copia.splice(copia.indexOf(t), 1);
      } else {
        const desde = calendario.sumarDias(fe, 1);
        acciones.push({ tipo: 'desplazar', bajaId: t.id, de: t.desde, a: desde });
        t.desde = desde;
      }
    }
    if (!b) {
      acciones.push({ tipo: 'crear', desde: p.fecha_baja, hasta: fe, prevista: fe ? null : p.revision, contingencia: p.contingencia });
      copia.push({ id: null, desde: p.fecha_baja, hasta: fe, prevista: fe ? null : p.revision });
      return { proceso: p, acciones };
    }
    if (b.desde !== p.fecha_baja) { acciones.push({ tipo: 'desde', bajaId: b.id, de: b.desde, a: p.fecha_baja }); b.desde = p.fecha_baja; }
    if ((b.hasta || null) !== fe) { acciones.push({ tipo: 'hasta', bajaId: b.id, de: b.hasta || null, a: fe }); b.hasta = fe; }
    if (!fe && p.revision && b.prevista !== p.revision) { acciones.push({ tipo: 'prevista', bajaId: b.id, de: b.prevista || null, a: p.revision }); b.prevista = p.revision; }
    return { proceso: p, acciones, bajaId: b.id };
  });
}

/** Una acción, dicha para quien la mira. */
function texto(a) {
  switch (a.tipo) {
    case 'crear': return `Abrir la baja del ${dmy(a.desde)}${a.hasta ? ` con el alta el ${dmy(a.hasta)}` : ', sin alta'}`;
    case 'desde': return `Primer día de la baja: del ${dmy(a.de)} al ${dmy(a.a)}`;
    case 'hasta': return a.a ? `Alta el ${dmy(a.a)}${a.de ? ` (en el ERP, el ${dmy(a.de)})` : ''}: vuelve el ${dmy(calendario.sumarDias(a.a, 1))}`
      : `Reabrir la baja: el FIE no tiene el alta (en el ERP, alta el ${dmy(a.de)})`;
    case 'prevista': return `Próxima revisión: el ${dmy(a.a)}`;
    case 'anular': return `Quitar la baja del ${dmy(a.desde)}: el parte de baja está anulado`;
    case 'recortar': return `La baja del ERP del ${dmy(a.desde)} se corta el ${dmy(a.a)}: lo de antes no sale en el FIE (queda para revisar)`;
    case 'quitar': return `Juntar: el tramo del ${dmy(a.desde)}${a.hasta ? ` al ${dmy(a.hasta)}` : ''} es de esta misma baja`;
    case 'desplazar': return `El tramo del ${dmy(a.de)} pasa a empezar el ${dmy(a.a)} (es de la baja siguiente)`;
    default: return a.tipo;
  }
}

// ── Cruzar: quién es cada uno y qué haría ────────────────────────────────────
async function cruce(cli = null) {
  const procesos = await repo.todos(cli);
  const fichas = await repo.fichasPorDni(cli);
  const porDni = new Map();
  fichas.forEach(f => {
    const k = fie.dniNorm(f.dni_nie);
    porDni.set(k, porDni.has(k) ? null : f);   // dos fichas con el mismo documento: no se adivina
  });
  const conFicha = new Map();
  const sinFicha = [];
  for (const p of procesos) {
    const f = porDni.get(fie.dniNorm(p.dni));
    if (!f) { sinFicha.push(p); continue; }
    if (!conFicha.has(f.id)) conFicha.set(f.id, { ficha: f, procesos: [] });
    conFicha.get(f.id).procesos.push(p);
  }
  const bajas = await repo.bajasDe(cli, [...conFicha.keys()]);
  const planes = [];
  for (const [cid, g] of conFicha) {
    planear(g.procesos, bajas.filter(b => b.conductor_id === cid)).forEach(x => planes.push({ ...x, ficha: g.ficha }));
  }
  return { planes, sinFicha, procesos };
}

/**
 * LA PREVIA (y la lista de la pantalla): cada proceso con lo que haría, las
 * bajas del ERP que no salen en ningún FIE y cómo va el buzón.
 */
async function vista(quien = {}) {
  await exigirVer(quien);
  if (!await repo.hayTabla()) return { sinTabla: true, filas: [], sinFie: [] };
  const { planes, sinFicha } = await cruce();
  const filas = [
    ...planes.map(x => ({ ...x.proceso, conductor_id: x.ficha.id, nombre_erp: x.ficha.nombre,
      acciones: x.acciones.map(texto), cambia: x.acciones.length > 0 })),
    ...sinFicha.map(p => ({ ...p, acciones: ['No hay nadie en el ERP con ese documento'], cambia: false, sin_ficha: true })),
  ].sort((a, b) => b.fecha_baja.localeCompare(a.fecha_baja));
  // Las bajas del ERP (plantilla propia, desde el 27/09) que no cubre ningún proceso del FIE.
  const cubiertas = planes.map(x => ({ cid: x.ficha.id, p: x.proceso }));
  const sinFie = (await repo.bajasDesde(null, DESDE)).filter(b => !cubiertas.some(c => c.cid === b.conductor_id
    && c.p.fecha_baja <= (b.hasta || '9999-12-31') && (finEfectivo(c.p) || '9999-12-31') >= b.desde));
  const ultimo = (await db.consulta(
    `SELECT nombre, to_char(creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS cuando, count(*) OVER () AS total
       FROM fichero_importado WHERE tipo = $1 ORDER BY creado_at DESC LIMIT 1`, [TIPO_FICHERO]).catch(() => ({ rows: [] }))).rows[0] || null;
  return {
    sinTabla: false, filas, sinFie, automatico: await automatico(), desde: DESDE, ultimo,
    porAplicar: filas.filter(f => f.cambia).length, puedeAplicar: await aus.puede(quien, aus.CLAVE_VALIDAR),
  };
}

// ── APLICAR ─────────────────────────────────────────────────────────────────
async function ejecutar(cid, nombre, x) {
  const plantilla = require('../Conductores/plantilla.service');
  const bajas = require('./bajas.service');
  const p = x.proceso;
  const parte = (cli, d) => bajasRepo.insertarParte(cli, { conductorId: cid, origen: 'fie', creadoPor: null, ...d });
  const firma = motivo => ({ usuarioId: null, origen: 'fie', accion: 'cambio', motivo });
  for (const a of x.acciones) {
    if (a.tipo === 'crear') {
      const puesta = await plantilla.anadirAusencia(Number(cid),
        { estado: 'baja_medica', desde: a.desde, hasta: a.hasta, motivo: `Fichero FIE de la gestoría: baja del ${dmy(a.desde)}` }, SISTEMA);
      const situacionId = puesta && puesta.anadida ? String(puesta.anadida.id)
        : ((await bajasRepo.abiertaDe(null, cid, a.desde)) || {}).id;
      await libro.conFirma(firma(`FIE: baja de ${nombre} del ${dmy(a.desde)}`), async cli => {
        if (a.prevista && situacionId) await bajasRepo.ponerPrevista(cli, situacionId, a.prevista);
        await parte(cli, { situacionId, tipo: 'baja', fecha: a.desde, prevista: a.prevista, contingencia: a.contingencia, nota: 'Fichero FIE de la gestoría' });
        if (a.hasta) await parte(cli, { situacionId, tipo: 'alta', fecha: a.hasta, nota: 'Fichero FIE de la gestoría' });
      });
      if (a.hasta && situacionId) await vuelta(bajas, { id: situacionId, nombre }, a.hasta);
    } else if (a.tipo === 'desde') {
      await plantilla.editarAusencia(Number(cid), Number(a.bajaId), { desde: a.a }, SISTEMA);
      await libro.conFirma(firma(`FIE: primer día de la baja de ${nombre}`), cli => parte(cli, { situacionId: a.bajaId, tipo: 'rectificacion',
        fecha: p.registro || calendario.hoy(), nota: `Fichero FIE de la gestoría: el primer día es el ${dmy(a.a)} (en el ERP, el ${dmy(a.de)})` }));
    } else if (a.tipo === 'hasta') {
      await plantilla.editarAusencia(Number(cid), Number(a.bajaId), { hasta: a.a }, SISTEMA);
      await libro.conFirma(firma(`FIE: ${a.a ? 'alta' : 'baja reabierta'} de ${nombre}`), async cli => {
        if (a.a) await parte(cli, { situacionId: a.bajaId, tipo: 'alta', fecha: a.a, nota: 'Fichero FIE de la gestoría' });
        else await parte(cli, { situacionId: a.bajaId, tipo: 'rectificacion', fecha: p.registro || calendario.hoy(),
          nota: `Fichero FIE de la gestoría: sigue de baja, sin alta (en el ERP tenía el alta el ${dmy(a.de)})` });
      });
      if (a.a) await vuelta(bajas, { id: a.bajaId, nombre }, a.a);
    } else if (a.tipo === 'prevista') {
      await libro.conFirma(firma(`FIE: próxima revisión de ${nombre}`), async cli => {
        await bajasRepo.ponerPrevista(cli, a.bajaId, a.a);
        await parte(cli, { situacionId: a.bajaId, tipo: 'confirmacion', fecha: p.confirmacion || p.registro || calendario.hoy(), prevista: a.a,
          nota: 'Fichero FIE de la gestoría' });
      });
    } else if (a.tipo === 'recortar') {
      await plantilla.editarAusencia(Number(cid), Number(a.bajaId), { hasta: a.a }, SISTEMA);
      await libro.conFirma(firma(`FIE: baja de ${nombre} cortada`), cli => parte(cli, { situacionId: a.bajaId, tipo: 'rectificacion',
        fecha: p.registro || calendario.hoy(), nota: `Fichero FIE de la gestoría: la IT empieza el ${dmy(p.fecha_baja)}; este tramo se corta el ${dmy(a.a)} (lo de antes no sale en el FIE: revisar)` }));
    } else if (a.tipo === 'quitar') {
      await libro.conFirma(firma(`FIE: tramo de la baja de ${nombre} juntado`), cli => parte(cli, { situacionId: a.bajaId, tipo: 'rectificacion',
        fecha: p.registro || calendario.hoy(), nota: `Fichero FIE de la gestoría: el tramo del ${dmy(a.desde)} es de la baja del ${dmy(p.fecha_baja)}; se junta con ella` }));
      await plantilla.borrarAusencia(Number(cid), Number(a.bajaId), SISTEMA);
    } else if (a.tipo === 'desplazar') {
      await plantilla.editarAusencia(Number(cid), Number(a.bajaId), { desde: a.a }, SISTEMA);
      await libro.conFirma(firma(`FIE: tramo de la baja de ${nombre} desplazado`), cli => parte(cli, { situacionId: a.bajaId, tipo: 'rectificacion',
        fecha: p.registro || calendario.hoy(), nota: `Fichero FIE de la gestoría: este tramo empieza el ${dmy(a.a)} (en el ERP, el ${dmy(a.de)})` }));
    } else if (a.tipo === 'anular') {
      await libro.conFirma(firma(`FIE: parte de baja anulado de ${nombre}`), cli => parte(cli, { situacionId: a.bajaId, tipo: 'rectificacion',
        fecha: p.registro || calendario.hoy(), nota: `Fichero FIE de la gestoría: el parte de baja del ${dmy(a.desde)} está anulado; se quita la baja` }));
      await plantilla.borrarAusencia(Number(cid), Number(a.bajaId), SISTEMA);
    }
  }
}

/** El alta del FIE: la de «comprobar» se cierra; si vuelve de hoy en adelante, tarjeta y aviso como a mano. */
async function vuelta(bajas, b, fechaAlta) {
  const tablero = require('../../services/tablero');
  await db.transaccion(cli => tablero.cerrarPorOrigen(cli, { tipo: bajas.TARJETA_REVISAR, origenId: b.id, nota: `Alta el ${dmy(fechaAlta)} (fichero FIE)` }));
  if (calendario.sumarDias(fechaAlta, 1) < calendario.hoy()) return;
  await db.transaccion(cli => bajas.tarjetaDeVuelta(cli, b, fechaAlta));
  await bajas.avisarVuelta(b, fechaAlta, null);
}

/**
 * APLICAR lo pendiente. A mano (`quien`, con la llave de validar ausencias), y
 * la primera vez enciende el automático; o sola, desde la tarea, si ya lo está.
 * → { aplicados, alDia, sinFicha, errores }
 */
async function aplicar(quien = null) {
  if (quien) {
    if (!await aus.puede(quien, aus.CLAVE_VALIDAR)) throw error('Aplicar el fichero FIE es de quien valida las ausencias', 403);
  } else if (!await automatico()) return { saltado: 'la previa aún no se ha aplicado a mano' };
  if (!await repo.hayTabla()) throw error('Falta aplicar la migración db/312', 409);
  const { planes, sinFicha } = await cruce();
  const r = { aplicados: 0, alDia: 0, sinFicha: 0, errores: 0 };
  for (const p of sinFicha) {
    if (p.estado !== 'sin_ficha') await repo.marcar(null, p.id, { estado: 'sin_ficha', nota: 'No hay nadie en el ERP con ese documento' });
    r.sinFicha++;
  }
  // Por persona y en orden: una recaída depende de cómo quedó la baja anterior.
  for (const x of planes) {
    const p = x.proceso;
    if (!x.acciones.length) {
      if (p.estado !== 'al_dia' && p.estado !== 'aplicado') await repo.marcar(null, p.id, { estado: 'al_dia', nota: 'Ya cuadraba con el ERP', conductorId: x.ficha.id });
      r.alDia++;
      continue;
    }
    try {
      await ejecutar(x.ficha.id, x.ficha.nombre, x);
      await repo.marcar(null, p.id, { estado: 'aplicado', nota: x.acciones.map(texto).join(' · '), conductorId: x.ficha.id });
      r.aplicados++;
    } catch (e) {
      console.error(`❌ [FIE] ${x.ficha.nombre}, baja del ${p.fecha_baja}: ${e.message}`);
      await repo.marcar(null, p.id, { estado: 'error', nota: e.message.slice(0, 500), conductorId: x.ficha.id });
      r.errores++;
    }
  }
  if (quien && !await automatico()) {
    await configApp.guardarConfig({ fie_automatico: 'si' }, quien.usuarioId);
    console.log('📋 [FIE] Aplicado a mano por primera vez: desde ahora cada FIE nuevo se aplica solo');
  }
  if (r.aplicados || r.errores) console.log(`📋 [FIE] ${r.aplicados} procesos aplicados, ${r.alDia} al día, ${r.sinFicha} sin ficha, ${r.errores} con error`);
  return r;
}

async function automatico() {
  const c = await configApp.leerConfig().catch(() => ({}));
  return String(c.fie_automatico || '').toLowerCase() === 'si';
}

// ── LEER EL FICHERO ─────────────────────────────────────────────────────────
/** La fecha del fichero: la de su nombre («… 27-11-2026.xlsx») o, si no, la última de sus registros. */
function fechaDelFichero(nombre, procesos) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(String(nombre || ''));
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return procesos.map(p => p.registro).filter(Boolean).sort().pop() || calendario.hoy();
}

/**
 * IMPORTAR UN FIE: si ya entró, nada. → { ya } | { ficheroId, procesos, nuevos, cambian }
 * Desde el buzón (`usuarioId` null) o subido a mano.
 */
async function importar({ buffer, nombre, usuarioId = null } = {}) {
  if (!buffer || !buffer.length) throw error('No ha llegado ningún fichero');
  try { await ficheros.exigirNuevo(TIPO_FICHERO, ficheros.huella(buffer)); } catch (e) {
    if (e.yaCargado) return { ya: true };
    throw e;
  }
  const leido = await fie.leer(buffer);
  const periodo = fechaDelFichero(nombre, leido.procesos);
  const r = await libro.conFirma({ usuarioId, origen: 'fie', accion: 'alta', motivo: `Fichero FIE «${nombre}»` }, async cli => {
    const ficheroId = await ficheros.apuntar(cli, {
      tipo: TIPO_FICHERO, periodo, nombre, buffer, usuarioId,
      estructura: { hoja: leido.hoja }, resultado: { procesos: leido.procesos.length, avisos: leido.avisos }, incidencias: leido.avisos.length,
    });
    let nuevos = 0, cambian = 0;
    for (const p of leido.procesos) {
      const c = await repo.guardar(cli, p, ficheroId);
      if (c === 'nuevo') nuevos++; else if (c === 'cambia') cambian++;
    }
    return { ficheroId, procesos: leido.procesos.length, nuevos, cambian };
  });
  await ficheros.guardarOriginal(r.ficheroId, { nombre, buffer, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', usuarioId });
  return r;
}

/** Subirlo a mano desde la pantalla (por si el correo no llegó). */
async function subir({ base64, nombre } = {}, quien = {}) {
  if (!await aus.puede(quien, aus.CLAVE_VALIDAR)) throw error('Subir el fichero FIE es de quien valida las ausencias', 403);
  if (!await repo.hayTabla()) throw error('Falta aplicar la migración db/312', 409);
  const r = await importar({ buffer: Buffer.from(String(base64 || ''), 'base64'), nombre: String(nombre || 'fichero-fie.xlsx').slice(0, 200), usuarioId: quien.usuarioId });
  if (r.ya) throw error('Ese fichero FIE ya se había leído', 409);
  if (await automatico()) r.aplicado = await aplicar();
  return r;
}

/**
 * EL BUZÓN: los correos «FICHERO FIE …» de datos@telecab.es con su Excel, desde
 * diez días antes del último leído (o desde el 27/09 la primera vez). Solo lectura.
 */
async function leerBuzon() {
  if (!await repo.hayTabla()) return { sinTabla: true };
  const cred = await require('../Combustible/combustible.service').credenciales();
  const ult = (await db.consulta(`SELECT max(periodo) AS p FROM fichero_importado WHERE tipo = $1`, [TIPO_FICHERO]).catch(() => ({ rows: [{}] }))).rows[0].p;
  const ultimo = ult ? String(ult).slice(0, 10) : null;
  const desde = ultimo && ultimo > DESDE ? calendario.sumarDias(ultimo, -10) : DESDE;
  const leido = await require('../../services/correo').leerCorreos({
    user: cred.user, pass: cred.pass, host: cred.host, carpetas: ['INBOX', 'Spam'], desde: new Date(`${desde}T00:00:00Z`),
    elegir: s => /FICHERO\s+FIE/i.test(s.asunto || ''),
    adjuntos: a => /\.xlsx?$/i.test(a.nombre || ''),
  });
  const r = { correos: leido.correos.length, nuevos: 0, repetidos: 0, errores: [] };
  for (const c of leido.correos) {
    if (c.error) { r.errores.push(`${c.asunto}: ${c.error}`); continue; }
    for (const a of c.adjuntos || []) {
      try {
        const x = await importar({ buffer: a.buffer, nombre: a.nombre });
        if (x.ya) r.repetidos++; else r.nuevos++;
      } catch (e) { r.errores.push(`${a.nombre}: ${e.message}`); }
    }
  }
  if (r.nuevos || r.errores.length) console.log(`📋 [FIE] Buzón: ${r.nuevos} ficheros nuevos, ${r.repetidos} ya leídos${r.errores.length ? `, ${r.errores.length} con error` : ''}`);
  return r;
}

/** «Leer el buzón ahora», desde la pantalla. */
async function leerAhora(quien = {}) {
  if (!await aus.puede(quien, aus.CLAVE_VALIDAR)) throw error('No tienes permiso para esto', 403);
  const r = await leerBuzon();
  if (await automatico()) r.aplicado = await aplicar();
  return r;
}

async function exigirVer(quien) {
  if (!await aus.puede(quien, aus.CLAVE_VALIDAR)) throw error('El fichero FIE es de quien valida las ausencias (datos de salud)', 403);
}

tareasProgramadas.registrar({
  clave: 'rrhh.fie',
  descripcion: 'Cada hora: los ficheros FIE de la gestoría que llegan a datos@telecab.es; si ya se aplicó la previa, se aplican solos',
  desde: '2026-11-27',
  toca: ahora => {
    const { fecha, min } = calendario.partesMadrid(ahora);
    return `${fecha}T${String(Math.floor(min / 60)).padStart(2, '0')}`;
  },
  hacer: async () => {
    if (require('../../services/modoPruebas').ACTIVO) return { saltado: 'modo pruebas' };
    const leido = await leerBuzon().catch(e => ({ error: e.message }));
    const aplicado = await aplicar().catch(e => ({ error: e.message }));
    return { leido, aplicado };
  },
});

module.exports = { vista, aplicar, importar, subir, leerBuzon, leerAhora, planear, texto, fechaDelFichero, DESDE };
