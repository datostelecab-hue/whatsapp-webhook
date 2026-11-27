// ============================================================
// EL SMS CERTIFICADO DE MENSATEK (plan de RR. HH., módulo 9, db/306, 26/11/2026)
// ============================================================
// El encargo: «envío a un conductor, un grupo o toda la plantilla, con texto
// libre o con plantillas que rellenan solas los datos del conductor
// (suspensión, sanción, requerimiento, aviso de finiquito, etc.). Los módulos 3
// y 7 lanzan sus envíos desde aquí, y el historial queda centralizado. Cada
// envío guarda su certificado de entrega en el expediente del conductor».
//
// Lo que decidió Camilo el 26/11/2026:
//   · Todo el módulo: envíos libres o con plantilla, y Sanciones y Finiquitos
//     preparan el suyo desde su ficha (con el PDF que se adjunte).
//   · El remitente, el que tenga la cuenta de Mensatek por defecto (el
//     parámetro `mensatek.remitente` vacío).
//   · Para abrir la notificación el conductor escribe SU DNI (Identificar
//     DNI-…). Sin DNI en la ficha, el móvil en el que la recibió.
//   · Lo manda Diana sola (llave '/sms/enviar'), sin segundo visto bueno.
//
// CADA PERSONA, SU PETICIÓN: el DNI con el que se abre es de cada uno, así que
// no se puede mandar a varios en una. Cada destinatario tiene su idMensaje.
//
// LOS ESTADOS llegan por el receptor de Mensatek (`recibirReport`, ruta
// pública /mensatek/reports con usuario y contraseña) y, por si no está
// configurado o se pierde alguno, cada hora se preguntan los que faltan. Con
// «entregado y certificado» se baja el certificado en PDF y se guarda (dueño
// 'sms_certificado'): sale en el expediente del conductor.
'use strict';

const repo = require('./sms.repo');
const mensatek = require('../../services/mensatek');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const parametros = require('../../services/parametros');
const adjuntos = require('../../services/adjuntos');
const contadores = require('../../services/contadores');
const tareasProgramadas = require('../../services/tareasProgramadas');
const calendario = require('../../services/calendario');

const CLAVE_VER = '/sms';
const CLAVE_ENVIAR = '/sms/enviar';
const TOTAL = ['superadmin', 'desarrollador'];
const DUENO_PDF = 'sms_envio';
const DUENO_CERT = 'sms_certificado';

const ALCANCES = { personas: 'Unas personas', todos: 'Toda la plantilla de alta', propia: 'La plantilla propia', ett: 'Los de ETT' };
const ESTADOS = {
  borrador: { etiqueta: 'Borrador', tono: 'muted' },
  enviando: { etiqueta: 'Enviando', tono: 'gold' },
  enviado: { etiqueta: 'Enviado', tono: 'green' },
  error: { etiqueta: 'No salió', tono: 'red' },
  anulado: { etiqueta: 'Anulado', tono: 'muted' },
};

// Las plantillas: se rellenan con {nombre}, {pila}, {dni} y {fecha} de cada
// uno. Son el punto de partida: el texto se puede cambiar antes de mandarlo.
const EMPRESA = 'TIBUS LUXURY SERVICES, S.L.';
const PLANTILLAS = {
  libre: { nombre: 'Texto libre', asunto: '', texto: '' },
  requerimiento: { nombre: 'Requerimiento', asunto: 'Requerimiento',
    texto: `{nombre}: ${EMPRESA} le requiere para que [qué se le pide] antes del [fecha]. Para cualquier duda, contacte con la oficina.` },
  sancion: { nombre: 'Comunicación de sanción', asunto: 'Comunicación de sanción',
    texto: `{nombre}: ${EMPRESA} le notifica una comunicación de sanción. Tiene el documento en el enlace de este mensaje.` },
  suspension: { nombre: 'Suspensión de empleo y sueldo', asunto: 'Suspensión de empleo y sueldo',
    texto: `{nombre}: ${EMPRESA} le notifica la suspensión de empleo y sueldo que se detalla en el documento del enlace de este mensaje.` },
  finiquito: { nombre: 'Aviso de finiquito', asunto: 'Aviso de finiquito',
    texto: `{nombre}: ${EMPRESA} le comunica que su liquidación y finiquito está preparada. Tiene el detalle en el enlace de este mensaje.` },
  // A quien no ha leído un comunicado (db/310). Corto a propósito: hasta 160
  // caracteres son 9 créditos; cada trozo más, 3.
  comunicado: { nombre: 'Comunicado sin leer', asunto: 'Comunicado sin leer',
    // Sin «»: no están en el alfabeto GSM con el que sale el SMS.
    texto: '{pila}: tienes un comunicado de la empresa sin leer. Léelo en tu portal de conductores y pulsa "Lo he leído".' },
};

// Lo que dice Mensatek de cada uno (los códigos de su documentación).
const ENTREGADO = new Set([13, 14, 70, 106]);
const CERTIFICADO = 14;
const FALLIDO = new Set([50, 51, 52, 53, 54, 55, 101, 102, 103, 104, 110, 111, 112, 113, 124, 125, 127, 128, 129, 130, 133, 136, 137, 138, 140, 141, 150]);
const TEXTO_RESULTADO = {
  0: 'Esperando entrega', 1: 'Programado', 2: 'Esperando entrega', 10: 'Esperando entrega',
  13: 'Entregado al teléfono', 14: 'Entregado y certificado', 50: 'El teléfono no existe', 51: 'Falló la entrega al teléfono',
  52: 'Falló la entrega a la red', 53: 'Expirado: el teléfono sigue apagado', 54: 'Número en lista negra', 55: 'Número bloqueado',
  70: 'Entregado al teléfono', 101: 'Expirado: el teléfono sigue apagado', 102: 'Usuario dado de baja', 103: 'Expirado: el teléfono sigue apagado',
  104: 'El teléfono no es correcto', 106: 'Entregado al teléfono', 110: 'El teléfono no existe', 111: 'Teléfono dado de baja',
  112: 'Teléfono sin servicio', 113: 'Expirado: el teléfono sigue apagado', 123: 'Teléfono apagado o fuera de cobertura',
  124: 'Teléfono sin servicio de SMS', 125: 'Teléfono bloqueado o restringido', 127: 'Remitente no autorizado (CNMC)',
  128: 'Remitente no registrado en la CNMC', 129: 'Remitente sin autorización en la CNMC', 138: 'Rechazado por la operadora por el contenido',
  1000: 'Esperando entrega', 1001: 'Programado', 1002: 'Enviando',
};
const textoResultado = (n, dado) => TEXTO_RESULTADO[n] || dado || `Estado ${n} de Mensatek`;

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const hoyDmy = () => calendario.hoy().split('-').reverse().join('/');

async function puede(quien, clave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol)) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(clave); } catch (_) { return false; }
}
const exigir = async (quien, clave, msg = 'No tienes permiso para esto') => { if (!await puede(quien, clave)) throw error(msg, 403); };

/** El texto de una persona: la plantilla con sus datos. */
function rellenar(plantilla, p) {
  return String(plantilla)
    .replace(/\{nombre\}/g, p.nombre || '').replace(/\{pila\}/g, p.pila || '')
    .replace(/\{dni\}/g, p.dni || '').replace(/\{fecha\}/g, hoyDmy());
}
/** El DNI como lo quiere Mensatek en Identificar: en mayúsculas, sin espacios ni guiones. */
const dniLimpio = d => String(d || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

async function emisor() {
  const v = async (k, def = '') => texto(await parametros.valor(k).catch(() => def), 160);
  return {
    contacto: await v('mensatek.contacto', EMPRESA), telContacto: await v('mensatek.telefono'), cif: await v('mensatek.cif'),
    remitente: await v('mensatek.remitente'), diasValidez: Number(await parametros.valor('mensatek.dias_validez').catch(() => 3)) || 3,
  };
}

function limpiar(b = {}) {
  const asunto = texto(b.asunto, 160);
  const mensaje = texto(b.mensaje, 1500);
  const plantilla = PLANTILLAS[b.plantilla] ? b.plantilla : 'libre';
  const alcance = ALCANCES[b.alcance] ? b.alcance : null;
  const aceptacion = Math.max(0, Math.min(15, Math.round(Number(b.aceptacion) || 0)));
  if (!asunto) throw error('Falta el asunto (para reconocerlo en la lista)');
  if (mensaje.length < 10) throw error('Escribe el texto del SMS');
  if (!alcance) throw error('Di a quién va');
  const personas = alcance === 'personas'
    ? [...new Set([].concat(b.personas || []).map(Number).filter(n => Number.isInteger(n) && n > 0))] : null;
  if (alcance === 'personas' && !personas.length) throw error('Elige al menos una persona');
  return { asunto, mensaje, plantilla, alcance, personas, aceptacion };
}

// ── La oficina ─────────────────────────────────────────────────────────────
const publico = e => ({ ...e, alcance_texto: ALCANCES[e.alcance] || e.alcance, plantilla_texto: (PLANTILLAS[e.plantilla] || {}).nombre || e.plantilla });

async function lista(quien = {}) {
  await exigir(quien, CLAVE_VER);
  const base = { estados: ESTADOS, alcances: ALCANCES, plantillas: PLANTILLAS, configurado: mensatek.configurado() };
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, ...base };
  const em = await emisor();
  return {
    filas: (await repo.lista()).map(publico), sinTabla: false, ...base,
    faltaEmisor: [!em.telContacto ? 'el teléfono' : '', !em.cif ? 'el CIF' : ''].filter(Boolean), puedeEnviar: await puede(quien, CLAVE_ENVIAR),
  };
}

async function ficha(id, quien = {}) {
  await exigir(quien, CLAVE_VER);
  const e = await repo.porId(null, id);
  if (!e) throw error('Ese envío no existe', 404);
  const personas = e.estado === 'borrador' || e.estado === 'anulado' ? [] : await repo.destinatariosDelEnvio(id);
  let previa = null;
  if (e.estado === 'borrador') {
    const van = await repo.destinatariosDe(null, { alcance: e.alcance, personas: e.personas });
    previa = { total: van.length, sinMovil: van.filter(p => !p.movil).length, sinDni: van.filter(p => !p.dni).length,
      ejemplo: van[0] ? rellenar(e.mensaje, van[0]) : null };
  }
  const pdfs = await adjuntos.lista(DUENO_PDF, id, { id: quien.usuarioId, usuarioId: quien.usuarioId, rol: quien.rol }).catch(() => []);
  return { ...publico(e), personas, previa, pdfs: pdfs.length, puedeEnviar: await puede(quien, CLAVE_ENVIAR), configurado: mensatek.configurado() };
}

async function personas(quien = {}) {
  await exigir(quien, CLAVE_ENVIAR);
  return { personas: await repo.personas() };
}

async function crear(b = {}, quien = {}) {
  await exigir(quien, CLAVE_ENVIAR, 'Mandar SMS certificados es de quien tiene la llave «SMS certificado · enviar»');
  const x = limpiar(b);
  const origen = ['sancion', 'finiquito', 'comunicado'].includes(b.origen) ? b.origen : 'manual';
  const id = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sms', accion: 'alta', motivo: `SMS certificado: ${x.asunto}` },
    cli => repo.insertar(cli, { ...x, origen, origenId: origen === 'manual' ? null : texto(b.origenId, 40), creadoPor: quien.usuarioId }));
  avisarCambio();
  return { id };
}

async function editar(id, b = {}, quien = {}) {
  await exigir(quien, CLAVE_ENVIAR);
  const x = limpiar(b);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sms', accion: 'cambio', motivo: 'SMS certificado corregido' }, async cli => {
    const e = await repo.porId(cli, id);
    if (!e) throw error('Ese envío no existe', 404);
    if (e.estado !== 'borrador') throw error('Solo se corrige un borrador', 409);
    await repo.cambiar(cli, id, { asunto: x.asunto, mensaje: x.mensaje, plantilla: x.plantilla, alcance: x.alcance, personas: x.personas, aceptacion: x.aceptacion });
  });
  return { id };
}

async function anular(id, quien = {}) {
  await exigir(quien, CLAVE_ENVIAR);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sms', accion: 'anulacion', motivo: 'SMS certificado anulado' }, async cli => {
    const e = await repo.porId(cli, id);
    if (!e) throw error('Ese envío no existe', 404);
    if (e.estado !== 'borrador') throw error('Solo se anula un borrador: uno mandado ya ha salido', 409);
    await repo.cambiar(cli, id, { estado: 'anulado', anulado_por: quien.usuarioId, anulado_at: 'now' });
  });
  avisarCambio();
  return { estado: 'anulado' };
}

/**
 * Lo que preparan Sanciones y Finiquitos desde su ficha: un borrador a esa
 * persona con su plantilla. El PDF lo adjunta Diana antes de mandarlo.
 */
async function borradorDesde({ origen, origenId, plantilla } = {}, quien = {}) {
  await exigir(quien, CLAVE_ENVIAR, 'Mandar SMS certificados es de quien tiene la llave «SMS certificado · enviar»');
  if (origen === 'comunicado') return desdeComunicado(origenId, quien);
  const db = require('../../services/db');
  const tabla = { sancion: 'sancion', finiquito: 'finiquito' }[origen];
  if (!tabla || !/^\d+$/.test(String(origenId || ''))) throw error('No sé de qué es');
  const f = (await db.consulta(`SELECT conductor_id::text AS conductor_id FROM ${tabla} WHERE id = $1`, [origenId])).rows[0];
  if (!f) throw error('No existe', 404);
  const ya = (await db.consulta(`SELECT id::text AS id FROM sms_envio WHERE origen = $1 AND origen_id = $2 AND estado = 'borrador' ORDER BY id DESC LIMIT 1`,
    [origen, String(origenId)])).rows[0];
  if (ya) return { id: ya.id, ya: true };
  const p = PLANTILLAS[plantilla] && plantilla !== 'libre' ? plantilla : (origen === 'finiquito' ? 'finiquito' : 'sancion');
  return crear({ asunto: PLANTILLAS[p].asunto, mensaje: PLANTILLAS[p].texto, plantilla: p, alcance: 'personas', personas: [f.conductor_id],
    origen, origenId: String(origenId) }, quien);
}

/**
 * DESDE UN COMUNICADO (db/310, 27/11/2026): el borrador a quienes aún no lo han
 * leído, con la plantilla corta y el PDF del comunicado, si lo lleva (así el
 * certificado de Mensatek cubre también el documento). Lo decide Diana: aquí
 * solo se prepara; se revisa y se manda en /sms. Si ya había un borrador de ese
 * comunicado, se abre ese.
 */
async function desdeComunicado(comunicadoId, quien) {
  if (!/^\d+$/.test(String(comunicadoId || ''))) throw error('No sé de qué comunicado es');
  const db = require('../../services/db');
  const comunicados = require('./comunicados.service');
  const m = (await db.consulta(`SELECT id::text AS id, titulo, estado FROM comunicado WHERE id = $1`, [comunicadoId])).rows[0];
  if (!m) throw error('Ese comunicado no existe', 404);
  if (m.estado !== 'enviado') throw error('El comunicado aún no se ha mandado', 409);
  const ya = (await db.consulta(`SELECT id::text AS id FROM sms_envio WHERE origen = 'comunicado' AND origen_id = $1 AND estado = 'borrador' ORDER BY id DESC LIMIT 1`,
    [String(comunicadoId)])).rows[0];
  if (ya) return { id: ya.id, ya: true };
  const faltan = await comunicados.sinLeer(comunicadoId);
  if (!faltan.length) throw error('Ya lo han leído todos', 409);
  const p = PLANTILLAS.comunicado;
  const r = await crear({ asunto: texto(`Comunicado sin leer: ${m.titulo}`, 160), mensaje: p.texto, plantilla: 'comunicado',
    alcance: 'personas', personas: faltan, origen: 'comunicado', origenId: String(comunicadoId) }, quien);
  // Y su PDF, si lo lleva: va dentro del SMS y Mensatek lo custodia.
  try {
    const pdf = (await adjuntos.bytesDe(comunicados.DUENO_PDF, comunicadoId)).find(a => /pdf/i.test(a.mime));
    if (pdf) {
      const { Readable } = require('stream');
      await adjuntos.subirDelSistema({ tipo: DUENO_PDF, duenoId: String(r.id), nombre: pdf.nombre, mime: 'application/pdf',
        cuerpo: Readable.from(pdf.buffer), firmante: null, creadoPor: quien.usuarioId || null, origen: 'sms · desde un comunicado' });
    }
  } catch (e) { console.error(`❌ [SMS] el PDF del comunicado ${comunicadoId}: ${e.message}`); }
  return { ...r, personas: faltan.length };
}

// ── Mandarlo ───────────────────────────────────────────────────────────────
/**
 * MANDAR: se hace la foto de a quién va y sale, una petición por persona, en
 * segundo plano (`esperar` para las pruebas). Quien no tiene móvil queda con su
 * motivo y no gasta.
 */
async function enviar(id, quien = {}, { esperar = false } = {}) {
  await exigir(quien, CLAVE_ENVIAR, 'Mandar SMS certificados es de quien tiene la llave «SMS certificado · enviar»');
  const enPruebas = require('../../services/modoPruebas').ACTIVO;
  if (!mensatek.configurado() && !enPruebas) throw error('Mensatek no está configurado en el servidor (faltan el usuario y el token de la API)', 409);
  const em = await emisor();
  // El remitente también (27/11/2026): vacío, Mensatek lo rechaza aunque la cuenta tenga uno por defecto.
  const faltan = [!em.telContacto ? 'el teléfono' : '', !em.cif ? 'el CIF' : '', em.remitente.length < 4 ? 'el remitente' : ''].filter(Boolean);
  if (faltan.length) throw error(`Falta ${faltan.join(' y ')} de la empresa en Parámetros (Mensatek lo pide en cada envío)`, 409);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sms', accion: 'cambio', motivo: 'SMS certificado enviado' }, async cli => {
    const e = await repo.porId(cli, id);
    if (!e) throw error('Ese envío no existe', 404);
    if (e.estado !== 'borrador') throw error('Ya se mandó (o está anulado)', 409);
    const van = await repo.destinatariosDe(cli, { alcance: e.alcance, personas: e.personas });
    if (!van.length) throw error('No va a nadie', 409);
    for (const p of van) {
      const movil = mensatek.movilDe(p.movil);
      await repo.guardarDestinatario(cli, id, {
        conductorId: p.id, movil, identificar: p.dni ? 'DNI' : 'MOVIL', error: movil ? null : 'Sin móvil en su ficha',
      });
    }
    await repo.cambiar(cli, id, { estado: 'enviando', enviado_por: quien.usuarioId, enviado_at: 'now', error: null });
    return { personas: van.length, sinMovil: van.filter(p => !mensatek.movilDe(p.movil)).length };
  });
  avisarCambio();
  const tarea = mandarYa(id, em).catch(e => console.error(`❌ [SMS] envío ${id}: ${e.message}`));
  if (esperar) await tarea;
  return { estado: 'enviando', ...r };
}

async function mandarYa(id, em) {
  const e = await repo.porId(null, id);
  const pdf = (await adjuntos.bytesDe(DUENO_PDF, id).catch(() => [])).find(a => /pdf/i.test(a.mime));
  const b64 = pdf ? pdf.buffer.toString('base64') : null;
  let ok = 0, mal = 0, gastado = 0, ultimoError = null;
  for (const d of await repo.destinatariosDelEnvio(id)) {
    if (d.error || d.id_mensaje || !d.movil) continue;
    try {
      const r = await mensatek.enviarCertificado({
        movil: d.movil, mensaje: rellenar(e.mensaje, d), referencia: `tc-${d.id}`,
        identificar: d.dni ? `DNI-${dniLimpio(d.dni)}` : 'MOVIL', aceptacion: e.aceptacion,
        pdf: b64 ? { base64: b64 } : null, remitente: em.remitente, contacto: em.contacto, telContacto: em.telContacto, cif: em.cif,
        diasValidez: em.diasValidez,
      });
      await repo.cambiarDestinatario(null, d.id, { id_mensaje: r.idMensaje, resultado: r.simulado ? 0 : null,
        estado_texto: r.simulado ? 'Simulado (modo pruebas)' : 'Enviado a Mensatek', estado_at: 'now' });
      gastado += r.creditos || 0;
      ok++;
    } catch (err) {
      ultimoError = err.message;
      await repo.cambiarDestinatario(null, d.id, { error: texto(err.message, 300), estado_at: 'now' });
      mal++;
      // Sin credenciales o sin créditos, los demás fallarían igual (y Mensatek lo toma por spam).
      if ([-1, -2, -5].includes(err.res) || err.sinConfigurar) break;
    }
  }
  const sigue = ok > 0 ? 'enviado' : 'error';
  await libro.conFirma({ usuarioId: null, origen: 'sms', accion: 'cambio', motivo: `SMS certificado: ${ok} enviados, ${mal} con error` },
    cli => repo.cambiar(cli, id, { estado: sigue, creditos: gastado, error: mal ? texto(ultimoError, 300) : null }));
  console.log(`📲 [SMS] envío ${id}: ${ok} enviados, ${mal} con error, ${gastado} créditos`);
  avisarCambio();
  return { ok, mal };
}

// ── Los estados de Mensatek ────────────────────────────────────────────────
/**
 * UN REPORT del receptor (o de la vuelta de cada hora). Mueve el estado del
 * destinatario; con «entregado y certificado», baja el certificado.
 * `cuerpo` es lo que manda Mensatek, tal cual.
 */
async function recibirReport(cuerpo = {}) {
  if (!await repo.hayTabla()) return { ignorado: 'sin tabla' };
  const servicio = String(cuerpo.Servicio || '').toUpperCase();
  const idMensaje = Number(cuerpo.idMensaje || cuerpo.idEnvio || cuerpo.Msgid);
  const movil = String(cuerpo.Movil || cuerpo.Telefono || '');
  await repo.apuntarReport(null, { servicio, idMensaje, movil, resultado: Number(cuerpo.Resultado), cuerpo });
  if (!Number.isFinite(idMensaje)) return { ignorado: 'sin idMensaje' };
  const d = await repo.porMensaje(null, idMensaje, movil || null);
  if (!d) return { ignorado: 'no es nuestro' };
  const cambios = {};
  if (servicio === 'EVENTOSSMSCERTIFICADO') {
    const ev = Number(cuerpo.TipoEvento);
    if ([1, 3, 7, 8, 10].includes(ev) && !d.abierto_at) cambios.abierto_at = 'now';
    if (ev === 12) cambios.aceptado_at = 'now';
    if (ev === 13) cambios.rechazado_at = 'now';
  } else {
    const n = Number(cuerpo.Resultado);
    if (!Number.isFinite(n)) return { ignorado: 'sin resultado' };
    Object.assign(cambios, { resultado: n, estado_texto: textoResultado(n, cuerpo.Estado), estado_at: 'now' });
    if (ENTREGADO.has(n) && !d.entregado_at) cambios.entregado_at = 'now';
    if (n === CERTIFICADO) cambios.certificado_at = 'now';
  }
  await repo.cambiarDestinatario(null, d.id, cambios);
  avisarCambio();
  if (cambios.certificado_at && !d.certificado_adjunto_id) await guardarCertificado({ ...d, id_mensaje: idMensaje });
  return { ok: true };
}

/** Baja de Mensatek el certificado en PDF y lo guarda en el almacén. No lanza. */
async function guardarCertificado(d) {
  try {
    const pdf = await mensatek.certificado(d.id_mensaje, d.movil);
    if (!pdf) return null;
    const { Readable } = require('stream');
    const a = await adjuntos.subirDelSistema({
      tipo: DUENO_CERT, duenoId: String(d.id), nombre: `certificado-sms-${d.id_mensaje}.pdf`, mime: 'application/pdf',
      cuerpo: Readable.from(pdf), firmante: null, origen: 'sms · certificado',
    });
    await repo.cambiarDestinatario(null, d.id, { certificado_adjunto_id: a.id });
    return a.id;
  } catch (e) {
    console.error(`❌ [SMS] certificado del mensaje ${d.id_mensaje}: ${e.message}`);
    return null;
  }
}

/**
 * LA VUELTA DE CADA HORA: a los que no tienen estado final o certificado (de
 * los 10 últimos días), se les pregunta. Es la red si el receptor no está
 * configurado o se perdió algún aviso. Como mucho 40 por vuelta.
 */
async function comprobar({ cli = null } = {}) {
  if (!await repo.hayTabla(cli) || !mensatek.configurado()) return { saltada: true };
  let vistos = 0, certificados = 0;
  for (const d of (await repo.porComprobar(cli)).slice(0, 40)) {
    if (FALLIDO.has(Number(d.resultado))) continue;
    try {
      const inf = await mensatek.report(d.id_mensaje);
      const suyo = inf.find(x => mensatek.movilDe(x.telefono) === mensatek.movilDe(d.movil)) || inf[0];
      if (suyo && Number.isFinite(suyo.resultado) && suyo.resultado !== Number(d.resultado)) {
        await recibirReport({ Servicio: 'SMSCERTIFICADO', Resultado: suyo.resultado, Estado: suyo.estado, Movil: d.movil, idMensaje: d.id_mensaje, deLaVuelta: true });
        vistos++;
      } else if (d.certificado && !d.certificado_adjunto_id) {
        if (await guardarCertificado(d)) certificados++;
      }
    } catch (e) {
      console.error(`⚠️ [SMS] comprobar ${d.id_mensaje}: ${e.message}`);
      if ([-1].includes(e.res)) break;
    }
  }
  return { vistos, certificados };
}

/** Comprueba el usuario y la contraseña con los que llama Mensatek al receptor. */
function receptorValido(cabecera) {
  const u = String(process.env.MENSATEK_WEBHOOK_USUARIO || ''), c = String(process.env.MENSATEK_WEBHOOK_CLAVE || '');
  if (!u || !c) return false;
  const m = /^Basic\s+(.+)$/i.exec(String(cabecera || ''));
  if (!m) return false;
  const dado = Buffer.from(Buffer.from(m[1], 'base64').toString('utf8'));
  const bueno = Buffer.from(`${u}:${c}`);
  return dado.length === bueno.length && require('crypto').timingSafeEqual(dado, bueno);
}

/** Los créditos que quedan en Mensatek: también sirve para comprobar que la conexión va. */
async function creditos(quien = {}) {
  await exigir(quien, CLAVE_VER);
  if (!mensatek.configurado()) throw error('Mensatek no está configurado en el servidor (faltan el usuario y el token de la API)', 409);
  return { creditos: await mensatek.creditos() };
}

// ── Para el expediente y el portal de la ficha ─────────────────────────────
async function expediente(conductorId) {
  if (!await repo.hayTabla()) return [];
  return repo.expediente(conductorId);
}

// ── Registro ───────────────────────────────────────────────────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DUENO_PDF, {
  etiqueta: 'PDF del SMS certificado',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async (q, id) => {
    if (!await puede(quienDe(q), CLAVE_ENVIAR)) return false;
    const e = await repo.porId(null, id);
    if (e && e.estado !== 'borrador') throw error('Ya se mandó: el PDF no se puede cambiar', 409);
    return !!e;
  },
});
adjuntos.registrarDueno(DUENO_CERT, {
  etiqueta: 'Certificado de entrega del SMS',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async () => false,
});

tareasProgramadas.registrar({
  clave: 'sms.comprobar',
  descripcion: 'Cada hora: el estado y el certificado de los SMS certificados que aún no lo tienen (por si el receptor de Mensatek no avisó)',
  desde: '2026-11-27',
  toca: ahora => {
    const { fecha, min } = calendario.partesMadrid(ahora);
    return `${fecha}T${String(Math.floor(min / 60)).padStart(2, '0')}`;
  },
  hacer: ({ cli }) => comprobar({ cli }),
});

let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('sms'); }
contadores.registrarFuente('sms', {
  async contar(q) {
    const ve = q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(CLAVE_VER)));
    if (!ve) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.lista() : [])).then(f => f.filter(e => e.estado === 'borrador').length) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const n = await cuenta.valor;
    return n ? { 'sms.pendientes': { n, tono: 'info', titulo: `${n} ${n === 1 ? 'SMS certificado' : 'SMS certificados'} por mandar` } } : {};
  },
});

module.exports = {
  lista, ficha, personas, crear, editar, anular, enviar, borradorDesde, creditos, recibirReport, comprobar, receptorValido, expediente,
  rellenar, puede, PLANTILLAS, ESTADOS, CLAVE_VER, CLAVE_ENVIAR, DUENO_PDF, DUENO_CERT, _mandarYa: mandarYa,
};
