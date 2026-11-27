// ============================================================
// LAS ALTAS QUE DIANA MANDA AL CHAT (módulo 8, 27/11/2026)
// ============================================================
// Diana sube el documento del alta en la Seguridad Social (la «RYC») al canal
// #2-altas-de-empresas, con el nombre y la fecha: «JOSE ANGEL HERRERA PIMENTEL /
// ALTA / TIBUS LUXURY / 30/11/2026» y el PDF «2026 11 30 JOSE ANGEL HERRERA
// PIMENTEL - RYC.pdf». Camilo: «cuando mande un alta en ese chat, de una vez
// confirme las altas por confirmar en ese módulo y le relacione el PDF», para
// que no haga el trabajo dos veces.
//
//   · AL ESCRIBIR en ese canal con un PDF (también en un hilo), se busca el alta
//     sin confirmar de esa persona en Gestoría › Altas: por el nombre del
//     fichero y el del texto (al menos dos palabras en común, como el cruce con
//     la gestoría), y una sola. El PDF pasa a ser su justificante y el alta
//     queda confirmada por quien lo mandó (con su llave de Gestoría). En el hilo
//     del mensaje contesta Telecab: confirmada, o que no la encontró.
//   · CADA HORA se repasan los mensajes del canal desde el 20/11/2026: así entra
//     el PDF que llegó antes de que existiera el alta (se manda días antes) y lo
//     que se escribió con el ERP caído. Ahí no contesta nada si no encuentra.
//   · Un mensaje cuyo hilo dice «anulada» no cuenta. Un PDF que ya es el
//     justificante de un alta no se usa otra vez.
'use strict';

const { Readable } = require('stream');
const db = require('../../services/db');
const adjuntos = require('../../services/adjuntos');
const calendario = require('../../services/calendario');
const tareasProgramadas = require('../../services/tareasProgramadas');
const { palabrasEnComun, plano } = require('./listado');

const CANAL = '2-altas-de-empresas';
const DESDE_CHAT = '2026-11-20';
const DUENO_ALTA = 'alta_gestoria';
// El PDF se manda días antes del alta (y algo después): fuera de esto, no es de este contrato.
const ANTES_DIAS = 20;
const DESPUES_DIAS = 30;

const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const RUIDO = new Set(['RYC', 'ALTA', 'SS', 'RESOLUCION', 'PDF', 'TIBUS', 'LUXURY', 'DE', 'DEL']);

/** «2026 11 30 JOSE ANGEL HERRERA PIMENTEL - RYC.pdf» → «JOSE ANGEL HERRERA PIMENTEL». */
function nombreDeFichero(nombre) {
  const sinExt = String(nombre || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const sinFecha = sinExt.replace(/^\s*\d{4}[\s_.-]+\d{1,2}[\s_.-]+\d{1,2}[\s_.-]*/, '');
  return plano(sinFecha).split(' ').filter(p => p && !RUIDO.has(p)).join(' ');
}

/** «JOSE ANGEL HERRERA PIMENTEL/  ALTA/ TIBUS LUXURY/30/11/2026» → «JOSE ANGEL HERRERA PIMENTEL». */
function nombreDeTexto(texto) {
  const linea = String(texto || '').split('\n')[0];
  return plano(linea.split('/')[0]).split(' ').filter(p => p && !RUIDO.has(p)).join(' ');
}

/**
 * EL CRUCE (puro): de las altas sin confirmar, la de esta persona. Dos palabras
 * en común como mínimo, la que más, y una sola; y el mensaje, de unos días
 * antes a unos días después de su alta. → el alta o null
 */
function elegir(altas, nombres, diaMensaje) {
  const dentro = altas.filter(a => calendario.sumarDias(a.fecha_alta, -ANTES_DIAS) <= diaMensaje
    && diaMensaje <= calendario.sumarDias(a.fecha_alta, DESPUES_DIAS));
  const puntos = dentro.map(a => ({ a, n: Math.max(0, ...nombres.filter(Boolean).map(x => palabrasEnComun(x, a.nombre))) }))
    .filter(x => x.n >= 2).sort((x, y) => y.n - x.n);
  if (!puntos.length || (puntos[1] && puntos[1].n === puntos[0].n)) return null;
  return puntos[0].a;
}

async function altasSinConfirmar() {
  return (await db.consulta(
    `SELECT a.id::text AS id, to_char(a.fecha_alta, 'YYYY-MM-DD') AS fecha_alta,
            btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre
       FROM alta_gestoria a JOIN conductor_periodo_empleo p ON p.id = a.periodo_id JOIN conductor c ON c.id = p.conductor_id
      WHERE a.estado IN ('pendiente', 'solicitada')`)).rows;
}

/** El mensaje, si es de ese canal y no está anulado, con el texto de su hilo. */
async function mensaje(id) {
  return (await db.consulta(
    `SELECT m.id::text AS id, m.autor_id, m.padre_id::text AS padre_id, m.texto,
            to_char(m.creado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            p.texto AS texto_padre,
            EXISTS (SELECT 1 FROM chat_mensaje h WHERE h.anulado_at IS NULL AND h.texto ~* 'anulad'
                     AND (h.id = COALESCE(m.padre_id, m.id) OR h.padre_id = COALESCE(m.padre_id, m.id))) AS anulada
       FROM chat_mensaje m JOIN chat_canal c ON c.id = m.canal_id AND c.nombre = $2
       LEFT JOIN chat_mensaje p ON p.id = m.padre_id
      WHERE m.id = $1 AND m.anulado_at IS NULL`, [id, CANAL])).rows[0] || null;
}

/** ¿Ese PDF ya es el justificante de un alta? (por su huella) */
async function yaUsado(adjuntoId) {
  return (await db.consulta(
    `SELECT EXISTS (SELECT 1 FROM adjunto j JOIN adjunto o ON o.id = $1 AND o.sha256 = j.sha256
                     WHERE j.dueno_tipo = $2 AND j.anulado_at IS NULL) AS ya`, [adjuntoId, DUENO_ALTA])).rows[0].ya;
}

/**
 * UN MENSAJE: cada PDF, a su alta. `contestar`: en el hilo, lo que ha hecho (y
 * si no encuentra el alta, también). → [{ fichero, alta?, nombre?, motivo? }]
 */
async function procesarMensaje(mensajeId, { contestar = false } = {}) {
  const m = await mensaje(mensajeId);
  if (!m || m.anulada) return [];
  const pdfs = (await adjuntos.delDueno('chat_mensaje', m.id)).filter(a => /pdf/i.test(a.mime) || /\.pdf$/i.test(a.nombre));
  if (!pdfs.length) return [];
  const gestoria = require('./gestoria.service');
  const altas = require('./altas.service');
  const quien = { usuarioId: m.autor_id, rol: '' };
  if (!m.autor_id || !await gestoria.puede(quien, gestoria.CLAVE_GESTIONAR)) return [];
  const texto = m.texto && m.texto.trim() ? m.texto : (m.texto_padre || '');
  const hecho = [];
  for (const f of pdfs) {
    if (await yaUsado(f.id)) continue;
    const nombres = [nombreDeFichero(f.nombre), pdfs.length === 1 ? nombreDeTexto(texto) : ''];
    const a = elegir(await altasSinConfirmar(), nombres, m.dia);
    if (!a) { hecho.push({ fichero: f.nombre, motivo: 'sin alta' }); continue; }
    try {
      const pdf = await adjuntos.leerDelDueno('chat_mensaje', m.id, f.id);
      await adjuntos.subirDelSistema({ tipo: DUENO_ALTA, duenoId: a.id, nombre: f.nombre, mime: 'application/pdf',
        cuerpo: Readable.from(pdf.buffer), firmante: null, creadoPor: m.autor_id, origen: 'altas · desde el chat' });
      await altas.confirmar(a.id, { nota: `Confirmada con el PDF del chat #${CANAL} (${dmy(m.dia)})` }, quien);
      hecho.push({ fichero: f.nombre, alta: a.id, nombre: a.nombre, fecha: a.fecha_alta });
    } catch (e) {
      console.error(`❌ [Altas · chat] mensaje ${m.id}, ${f.nombre}: ${e.message}`);
      hecho.push({ fichero: f.nombre, motivo: e.message });
    }
  }
  if (contestar && hecho.length) {
    const lineas = hecho.map(h => (h.alta
      ? `✔ Alta confirmada en Gestoría › Altas: ${h.nombre} (alta el ${dmy(h.fecha)}). Este PDF queda como su justificante.`
      : h.motivo === 'sin alta'
        ? `No encuentro en Gestoría › Altas ningún alta sin confirmar para «${h.fichero}»: si es de un contrato nuevo de plantilla propia, confírmala allí a mano.`
        : `No se pudo confirmar con «${h.fichero}»: ${h.motivo}`));
    await require('../Chat/chat.service').respuestaDelSistema({ mensajeId: m.id, texto: lineas.join('\n') }).catch(e =>
      console.error(`❌ [Altas · chat] respuesta al mensaje ${m.id}: ${e.message}`));
  }
  return hecho;
}

/** CADA HORA: los mensajes del canal con PDF desde el 20/11, por si llegaron antes que el alta. */
async function repasar() {
  const ids = (await db.consulta(
    `SELECT m.id::text AS id FROM chat_mensaje m JOIN chat_canal c ON c.id = m.canal_id AND c.nombre = $1
      WHERE m.anulado_at IS NULL AND m.creado_at >= $2::date
        AND EXISTS (SELECT 1 FROM adjunto a WHERE a.dueno_tipo = 'chat_mensaje' AND a.dueno_id = m.id::text AND a.anulado_at IS NULL)
      ORDER BY m.id`, [CANAL, DESDE_CHAT])).rows.map(x => x.id);
  if (!ids.length || !(await altasSinConfirmar()).length) return { mensajes: ids.length, confirmadas: 0 };
  let confirmadas = 0;
  for (const id of ids) confirmadas += (await procesarMensaje(id)).filter(h => h.alta).length;
  return { mensajes: ids.length, confirmadas };
}

/** Lo llama el chat al escribir en ese canal con ficheros: en segundo plano, y contesta en el hilo. */
function alEscribir({ canal, mensajeId, ficheros }) {
  if (!canal || canal.nombre !== CANAL || !ficheros) return;
  setImmediate(() => procesarMensaje(mensajeId, { contestar: true })
    .catch(e => console.error(`❌ [Altas · chat] mensaje ${mensajeId}: ${e.message}`)));
}

tareasProgramadas.registrar({
  clave: 'gestoria.altas_chat',
  descripcion: `Cada hora: los PDF de alta del canal #${CANAL} que aún no han confirmado su alta en Gestoría › Altas`,
  desde: '2026-11-27',
  toca: ahora => {
    const { fecha, min } = calendario.partesMadrid(ahora);
    return `${fecha}T${String(Math.floor(min / 60)).padStart(2, '0')}`;
  },
  hacer: () => repasar(),
});

module.exports = { procesarMensaje, repasar, alEscribir, elegir, nombreDeFichero, nombreDeTexto, CANAL };
