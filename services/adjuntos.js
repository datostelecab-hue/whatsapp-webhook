// ============================================================
// LOS ADJUNTOS — un fichero de cualquier cosa (db/249)
// ============================================================
// Pieza A6 de docs/Hoja de ruta.md (13/11/2026). El chat interno, las tareas,
// las multas, las cartas, los expedientes y los siniestros adjuntan ficheros, y
// todos lo hacen igual:
//
//   // 1. El módulo dueño se registra UNA vez, y dice quién ve y quién adjunta:
//   adjuntos.registrarDueno('siniestro', {
//     etiqueta: 'Siniestro',
//     ver: async (quien, id) => …,        // quien = { id, rol }
//     adjuntar: async (quien, id) => …,
//     anular: async (quien, id) => …,      // opcional: si no, el de adjuntar
//   });
//
//   // 2. La pantalla usa el componente de la casa (public/assets/js/adjuntos.js):
//   Adjuntos.montar(caja, { tipo: 'siniestro', dueno: 42 });
//
// Las rutas (modules/Adjuntos) son las mismas para todos: subir por trozos,
// listar, servir (con Range: un vídeo se ve sin bajarlo entero) y anular.
//
// LOS BYTES van al almacén (services/almacen.js: R2 en Render). AQUÍ, la fila
// (`adjunto`), quién puede qué y CÓMO SE SIRVE CADA COSA:
//   · Se abren en la página solo las fotos, los PDF, los vídeos y los audios de
//     tipos conocidos (ENLINEA). Lo demás se DESCARGA siempre, con el tipo
//     «application/octet-stream»: un HTML o un SVG subido con otro nombre no
//     corre nunca en nuestro dominio.
//   · El tipo que manda el navegador al subir no se cree a ciegas: solo vale si
//     es uno de esos; si no, se deduce de la extensión y, si tampoco, se descarga.
//   · Con `nosniff`, y una CSP propia en cada fichero (sin scripts; un PDF solo
//     se deja enmarcar en nuestras páginas).
//
// NADA SE BORRA: quitar un adjunto es anularlo con motivo (convención 5). El
// fichero se queda en el almacén y la fila aquí; deja de listarse y de servirse.
'use strict';

const crypto = require('crypto');
const { Transform, pipeline } = require('stream');
const repo = require('./repo/adjuntos');
const almacen = require('./almacen');
const libro = require('./libro');
const parametros = require('./parametros');

// ── Los dueños ─────────────────────────────────────────────────────────────
const DUENOS = new Map();
const TIPO_VALIDO = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Un módulo dice que sus cosas llevan adjuntos, y quién los ve y quién adjunta.
 * Las tres funciones reciben `quien` ({ id, rol }) y el id del dueño, y
 * contestan sí o no. Ante la duda, no.
 */
function registrarDueno(tipo, { etiqueta, ver, adjuntar, anular } = {}) {
  if (!TIPO_VALIDO.test(String(tipo || ''))) throw new Error(`Tipo de dueño de adjuntos no válido: «${tipo}»`);
  if (typeof ver !== 'function' || typeof adjuntar !== 'function') {
    throw new Error(`El dueño «${tipo}» tiene que decir quién ve (ver) y quién adjunta (adjuntar)`);
  }
  DUENOS.set(tipo, { tipo, etiqueta: etiqueta || tipo, ver, adjuntar, anular: anular || adjuntar });
}

function dueno(tipo) {
  const d = DUENOS.get(String(tipo || ''));
  if (!d) throw conEstado(new Error(`No existe el tipo de adjunto «${tipo}»`), 404);
  return d;
}

const idDeDueno = v => {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(s)) throw conEstado(new Error('El dueño del adjunto no se entiende'), 400);
  return s;
};

async function permiso(cual, tipo, duenoId, quien) {
  const d = dueno(tipo);
  let si = false;
  try { si = !!(quien && quien.id && await d[cual](quien, duenoId)); } catch (e) {
    // EL DUEÑO PUEDE DECIR POR QUÉ NO (18/11/2026): un error suyo con estado
    // 4xx se enseña tal cual («es el único comprobante: sube otro antes»). Lo
    // demás (un fallo de la base) sigue siendo un «no puedes» sin detalles.
    if (e && e.status >= 400 && e.status < 500) throw e;
    console.error(`❌ [Adjuntos] ${tipo}.${cual}:`, e.message);
  }
  if (!si) {
    const que = { ver: 'ver', adjuntar: 'adjuntar ficheros a', anular: 'quitar adjuntos de' }[cual];
    throw conEstado(new Error(`No puedes ${que} este ${d.etiqueta.toLowerCase()}`), 403);
  }
  return d;
}

/** Lanza si no puede adjuntar. Va ANTES de leer el cuerpo: si no puede, no se sube nada. */
const exigirAdjuntar = (tipo, duenoId, quien) => permiso('adjuntar', tipo, idDeDueno(duenoId), quien);

// ── Los tipos de fichero ───────────────────────────────────────────────────
// Lo que se puede abrir en la página. Ni SVG ni HTML: llevan código.
const ENLINEA = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a',
]);
const POR_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
};

/**
 * El nombre del fichero, sin carpetas ni caracteres que rompan una cabecera.
 * Fuera también los de control C1 (U+0080-U+009F) y los invisibles de formato
 * (\p{Cf}): con U+202E «foto‮gpj.exe» se leía en la lista «fotoexe.jpg», con
 * el icono de foto (revisión del 16/11/2026).
 */
function nombreLimpio(nombre) {
  const base = String(nombre || '').split(/[\\/]/).pop();
  const limpio = base.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}<>:"|?*]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return limpio || 'adjunto';
}

/** El tipo: el que manda el navegador si es uno conocido; si no, por la extensión. */
function mimeDe(declarado, nombre) {
  const m = String(declarado || '').toLowerCase().split(';')[0].trim();
  if (ENLINEA.has(m)) return m;
  const ext = (String(nombre || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1];
  if (ext && POR_EXTENSION[ext]) return POR_EXTENSION[ext];
  // Con tope de largo: la columna es VARCHAR(120), y uno más largo daba un 500
  // DESPUÉS de haber subido el fichero entero.
  return m.length <= 100 && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(m) ? m : 'application/octet-stream';
}

/** El id de un adjunto, o null si no puede serlo (ni texto ni más allá de bigint). */
function idDeAdjunto(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Cómo se enseña: 'imagen', 'pdf', 'video', 'audio' o 'otro' (se descarga). */
function claseDe(mime) {
  if (!ENLINEA.has(mime)) return 'otro';
  if (mime === 'application/pdf') return 'pdf';
  return { image: 'imagen', video: 'video', audio: 'audio' }[mime.split('/')[0]] || 'otro';
}

/** La cabecera Content-Disposition, con el nombre también en UTF-8 (tildes y eñes). */
function disposicion(nombre, enLinea) {
  const ascii = String(nombre || 'adjunto').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${enLinea ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre || 'adjunto')}`;
}

/** El tope de una subida, en bytes (parámetro adjuntos.max_mb). */
async function maxBytes() {
  return (await parametros.valor('adjuntos.max_mb')) * 1024 * 1024;
}

// ── Subir ──────────────────────────────────────────────────────────────────
/**
 * Sube UN fichero que llega a trozos (`cuerpo`, un stream) y lo apunta. No se
 * carga entero en memoria: según llega, se cuenta, se le saca la huella y se
 * manda al almacén. Si pasa del tope, se corta ahí mismo.
 *   → el adjunto, como lo enseña la pantalla.
 */
async function subir({ tipo, duenoId, nombre, mime, cuerpo, quien }) {
  // El cuerpo puede romperse mientras se mira el permiso y el tope (un
  // formulario mal cerrado): sin quien escuche, ese error tumbaba el proceso y
  // la subida se quedaba colgada (revisión del 16/11/2026). Se guarda y se mira.
  let rotoAntes = null;
  const guardia = e => { if (!rotoAntes) rotoAntes = e; };
  cuerpo.on('error', guardia);
  try {
    return await subirYa({ tipo, duenoId, nombre, mime, cuerpo, quien }, () => rotoAntes);
  } finally {
    cuerpo.off('error', guardia);
  }
}

async function subirYa({ tipo, duenoId, nombre, mime, cuerpo, quien, sistema = null }, rotoAntes) {
  const id = idDeDueno(duenoId);
  // Del sistema (subirDelSistema): lo decide el servidor, no el permiso de una persona.
  if (sistema) dueno(tipo); else await permiso('adjuntar', tipo, id, quien);
  const donde = almacen.cual();
  if (!donde) {
    throw conEstado(new Error('No hay almacén de ficheros: falta configurar Cloudflare R2 en el servidor. Avisa al desarrollador.'), 503);
  }
  const tope = (sistema && sistema.tope) || await maxBytes();
  if (rotoAntes()) throw conEstado(rotoAntes(), rotoAntes().status || 400);
  const limpio = nombreLimpio(nombre);
  const tipoFichero = mimeDe(mime, limpio);
  const ruta = almacen.rutaNueva();

  let bytes = 0;
  const huella = crypto.createHash('sha256');
  const contador = new Transform({
    transform(trozo, _enc, sigue) {
      bytes += trozo.length;
      if (bytes > tope) {
        return sigue(conEstado(new Error(`El fichero pasa de ${Math.round(tope / 1048576)} MB, que es lo máximo que se puede adjuntar`), 413));
      }
      huella.update(trozo);
      sigue(null, trozo);
    },
  });
  // pipeline y no pipe: si el cuerpo se rompe (o ya venía roto), el contador se
  // rompe con él y el almacén suelta la subida.
  pipeline(cuerpo, contador, e => { if (e) contador.destroy(e); });

  const a = almacen.de(donde);
  await a.subir(ruta, contador, { mime: tipoFichero });
  if (bytes === 0) {
    await a.borrar(ruta).catch(() => {});
    throw conEstado(new Error('El fichero está vacío'), 400);
  }

  let nuevo;
  try {
    nuevo = await libro.conFirma({ usuarioId: sistema ? sistema.firmante : quien.id, origen: sistema ? sistema.origen : 'adjuntos' }, cli => repo.insertar(cli, {
      duenoTipo: tipo, duenoId: id, almacen: donde, ruta, nombre: limpio, mime: tipoFichero,
      bytes, sha256: huella.digest('hex'), creadoPor: sistema ? sistema.creadoPor : quien.id,
    }));
  } catch (e) {
    // Sin fila, el fichero no es de nadie: fuera del almacén.
    await a.borrar(ruta).catch(() => {});
    throw e;
  }
  console.log(`📎 [Adjuntos] ${tipo} ${id}: «${limpio}» (${bytes} bytes, ${donde}) ${sistema ? `de ${sistema.origen}` : `por el usuario ${quien.id}`}`);
  return publico(await repo.porId(nuevo));
}

/**
 * Un fichero que trae el SERVIDOR, no una persona (la migración de Slack): sin
 * el permiso de «adjuntar» del dueño, que es para la gente. Firma `firmante`
 * (quien lanzó el proceso); `creadoPor`, de quién es (o null); `tope`, en bytes.
 * Solo se llama desde el servidor: no hay ninguna ruta que lo use.
 */
async function subirDelSistema({ tipo, duenoId, nombre, mime, cuerpo, firmante, creadoPor = null, origen = 'adjuntos', tope = null }) {
  let rotoAntes = null;
  const guardia = e => { if (!rotoAntes) rotoAntes = e; };
  cuerpo.on('error', guardia);
  try {
    return await subirYa({ tipo, duenoId, nombre, mime, cuerpo, sistema: { firmante, creadoPor, origen, tope } }, () => rotoAntes);
  } finally {
    cuerpo.off('error', guardia);
  }
}

// ── Leer ───────────────────────────────────────────────────────────────────
/** Los de un dueño, si puede verlos. */
async function lista(tipo, duenoId, quien) {
  const id = idDeDueno(duenoId);
  await permiso('ver', tipo, id, quien);
  return (await repo.deDueno(tipo, id)).map(publico);
}

/**
 * El rango pedido (`Range: bytes=a-b`) sobre un fichero de `total` bytes:
 * null (entero), { desde, hasta } o 'fuera' (416). Varios rangos a la vez se
 * ignoran y se manda entero, que la norma lo permite.
 */
function rangoDe(cabecera, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(cabecera || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (total === 0) return 'fuera';
  let desde, hasta;
  if (m[1] === '') {                       // los últimos N
    const n = Number(m[2]);
    if (n === 0) return 'fuera';
    desde = Math.max(0, total - n); hasta = total - 1;
  } else {
    desde = Number(m[1]);
    hasta = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (desde >= total || desde > hasta) return 'fuera';
  return { desde, hasta };
}

/**
 * Lo que hace falta para servir un adjunto: { estado, cabeceras, cuerpo }.
 * `cuerpo` es un stream, o null (304, 416 o HEAD). Comprueba que puede verlo.
 */
async function servir(adjuntoId, quien, { rango, siNoCoincide, siRango, descargar = false, soloCabeceras = false, senal } = {}) {
  const n = idDeAdjunto(adjuntoId);
  const a = n ? await repo.porId(n) : null;
  if (!a || a.anulado_at) throw conEstado(new Error('Ese adjunto no existe o lo han quitado'), 404);
  await permiso('ver', a.dueno_tipo, a.dueno_id, quien);

  const clase = claseDe(a.mime);
  const enLinea = !descargar && clase !== 'otro';
  const etag = `"${a.sha256}"`;
  const cabeceras = {
    'Content-Type': enLinea ? a.mime : 'application/octet-stream',
    'Content-Disposition': disposicion(a.nombre, enLinea),
    'X-Content-Type-Options': 'nosniff',
    // `no-cache`: el navegador puede guardarlo, pero PREGUNTA cada vez (con la
    // huella, If-None-Match) y aquí se mira el permiso antes del 304. Con
    // `max-age` lo reusaba 24 h sin preguntar: en un PC compartido, otro usuario,
    // o el mismo tras cerrar sesión o anularse el adjunto, lo seguía viendo
    // (revisión del 16/11/2026). `no-transform`: que la compresión no toque un
    // fichero servido por trozos.
    'Cache-Control': 'private, no-cache, no-transform',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    // Sin scripts. Un PDF no puede ir con `sandbox` (el visor de Chrome no abre
    // un PDF en un documento aislado), pero solo se deja enmarcar en lo nuestro.
    'Content-Security-Policy': clase === 'pdf' && enLinea
      ? "default-src 'none'; frame-ancestors 'self'"
      : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
  };
  if (siNoCoincide && String(siNoCoincide).split(',').map(s => s.trim()).includes(etag)) {
    return { estado: 304, cabeceras, cuerpo: null };
  }
  // If-Range con otra huella: el fichero no es el que el navegador tenía a medias → entero.
  const r = siRango && siRango !== etag ? null : rangoDe(rango, a.bytes);
  if (r === 'fuera') {
    return { estado: 416, cabeceras: { ...cabeceras, 'Content-Range': `bytes */${a.bytes}` }, cuerpo: null };
  }
  const largo = r ? r.hasta - r.desde + 1 : a.bytes;
  const fin = { ...cabeceras, 'Content-Length': String(largo) };
  if (r) fin['Content-Range'] = `bytes ${r.desde}-${r.hasta}/${a.bytes}`;
  const cuerpo = soloCabeceras || largo === 0 ? null : await almacen.de(a.almacen).leer(a.ruta, { ...(r || {}), senal });
  return { estado: r ? 206 : 200, cabeceras: fin, cuerpo };
}

/**
 * LOS BYTES de los adjuntos vivos de un dueño, para el SERVIDOR (el SMS
 * certificado manda el PDF a Mensatek, 26/11/2026). Sin permiso de persona:
 * solo se llama desde el servidor, nunca desde una ruta. → [{ id, nombre, mime, buffer }]
 */
async function bytesDe(tipo, duenoId) {
  const out = [];
  for (const a of await repo.deDueno(tipo, idDeDueno(duenoId))) {
    if (a.anulado_at) continue;
    const trozos = [];
    for await (const c of await almacen.de(a.almacen).leer(a.ruta)) trozos.push(c);
    out.push({ id: String(a.id), nombre: a.nombre, mime: a.mime, buffer: Buffer.concat(trozos) });
  }
  return out;
}

/**
 * Los adjuntos vivos de un dueño, SIN los bytes y sin permiso de persona: para
 * el servidor, que ya ha comprobado el acceso por su cuenta (el portal de
 * conductores enseña el PDF de un comunicado a quien se lo mandaron, 27/11/2026).
 * → [{ id, nombre, mime, bytes }]
 */
async function delDueno(tipo, duenoId) {
  return (await repo.deDueno(tipo, idDeDueno(duenoId))).filter(a => !a.anulado_at)
    .map(a => ({ id: String(a.id), nombre: a.nombre, mime: a.mime, bytes: Number(a.bytes) || null }));
}

/** Uno de ellos con sus bytes, si es de ese dueño y está vivo (lo mismo: para el servidor). → { nombre, mime, buffer } | null */
async function leerDelDueno(tipo, duenoId, adjuntoId) {
  const n = idDeAdjunto(adjuntoId);
  const a = n ? await repo.porId(n) : null;
  if (!a || a.anulado_at || a.dueno_tipo !== tipo || String(a.dueno_id) !== String(idDeDueno(duenoId))) return null;
  const trozos = [];
  for await (const c of await almacen.de(a.almacen).leer(a.ruta)) trozos.push(c);
  return { nombre: a.nombre, mime: a.mime, buffer: Buffer.concat(trozos) };
}

// ── Quitar ─────────────────────────────────────────────────────────────────
/** Anula un adjunto, con motivo. El fichero se queda en el almacén. */
const MOTIVO_MINIMO = 3;

async function anular(adjuntoId, motivo, quien) {
  const n = idDeAdjunto(adjuntoId);
  const a = n ? await repo.porId(n) : null;
  if (!a) throw conEstado(new Error('Ese adjunto no existe'), 404);
  await permiso('anular', a.dueno_tipo, a.dueno_id, quien);
  const m = String(motivo || '').trim();
  if (m.length < MOTIVO_MINIMO) throw conEstado(new Error(`Di por qué se quita (al menos ${MOTIVO_MINIMO} letras): queda en su historia`), 400);
  await libro.conFirma({ usuarioId: quien.id, origen: 'adjuntos', motivo: m }, async cli => {
    if (!await repo.anular(cli, { id: n, motivo: m.slice(0, 500), anuladoPor: quien.id })) {
      throw conEstado(new Error('Ese adjunto ya estaba quitado'), 409);
    }
  });
  return publico(await repo.porId(n));
}

// ── Lo que ve la pantalla ──────────────────────────────────────────────────
function publico(a) {
  const clase = claseDe(a.mime);
  return {
    id: a.id, tipo: a.dueno_tipo, dueno: a.dueno_id,
    nombre: a.nombre, mime: a.mime, clase, bytes: a.bytes,
    creadoAt: a.creado_at, creadoPor: a.creado_por_nombre || null,
    anulado: a.anulado_at ? { at: a.anulado_at, por: a.anulado_por_nombre || null, motivo: a.anulado_motivo } : null,
    url: `/adjuntos/${a.id}/fichero`,
  };
}

function conEstado(e, status) { e.status = status; return e; }

/**
 * LAS CABECERAS PARA SERVIR UN FICHERO QUE SUBIÓ ALGUIEN, fuera de los
 * adjuntos (los documentos de Drive, las facturas): la misma regla que
 * `servir` (26/11/2026). Solo se abre en la página una foto, un PDF, un vídeo
 * o un audio de tipo conocido; lo demás se descarga con tipo genérico, para
 * que un HTML o un SVG subido nunca corra en nuestro dominio. Con `nosniff` y
 * una CSP sin scripts.
 */
function cabecerasSeguras({ mime, nombre }) {
  const m = mimeDe(mime, nombre);
  const clase = claseDe(m);
  const enLinea = clase !== 'otro';
  return {
    'Content-Type': enLinea ? m : 'application/octet-stream',
    'Content-Disposition': disposicion(nombre || 'documento', enLinea),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': clase === 'pdf'
      ? "default-src 'none'; frame-ancestors 'self'"
      : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
  };
}

module.exports = {
  registrarDueno, exigirAdjuntar, subir, subirDelSistema, lista, servir, anular, bytesDe, delDueno, leerDelDueno, maxBytes, MOTIVO_MINIMO, cabecerasSeguras,
  // Para las pruebas y la pantalla de pruebas:
  ENLINEA, nombreLimpio, mimeDe, claseDe, rangoDe, disposicion, tipos: () => [...DUENOS.keys()],
};
