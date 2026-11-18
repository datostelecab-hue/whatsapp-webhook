// ============================================================
// EL BOTÓN DE GIF DEL CHAT — con KLIPY (18/11/2026)
// ============================================================
// Camilo: «ponle el botón de GIF con Tenor». Google apagó la API de Tenor el
// 30/06/2026 (desde enero no daba claves), así que eligió KLIPY, adonde se
// fueron muchas apps. La clave la saca él en su panel y la pone en Render:
// KLIPY_API_KEY. Sin ella, el botón dice que falta.
//
// CÓMO VA
//   · BUSCAR (GET /chat/api/gifs?q=): el servidor le pregunta a KLIPY (los
//     más vistos si no se escribe nada) y devuelve, de cada GIF, una vista
//     pequeña para la rejilla y el que se manda. La clave no sale del servidor.
//     Las mismas búsquedas, diez minutos en memoria.
//   · MANDAR (POST /chat/api/canales/:id/gif { gifId }): solo vale un GIF que
//     el servidor acaba de enseñar (se recuerdan una hora): no se descarga lo
//     que diga el navegador. Se trae de KLIPY y se guarda como ADJUNTO del
//     mensaje, igual que un fichero subido (R2). Así el historial no depende de
//     KLIPY: con Tenor, al cerrar, se rompieron los GIF de medio internet.
//   · A KLIPY no va quién es nadie: el customer_id que pide es una huella del
//     id de la persona, no su id ni su nombre.
//   · Contenido: rating 'pg' (KLIPY_RATING para cambiarlo), que es un chat de
//     trabajo.
//
// La respuesta de KLIPY se lee con cuidado: su documentación no se pudo leer
// entera al hacer esto, así que se buscan los tamaños (md, sm, hd, xs) y los
// formatos (gif, webp) que haya, y lo que no traiga GIF se salta.
'use strict';

const crypto = require('crypto');
const { Readable } = require('stream');
const adjuntos = require('../../services/adjuntos');

const BASE = 'https://api.klipy.com/api/v1';
const POR_PAGINA = 24;
const RATING = () => String(process.env.KLIPY_RATING || 'pg');
const clave = () => String(process.env.KLIPY_API_KEY || '').trim();
const configurado = () => !!clave();

function error(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// ── Lo que se ha enseñado: solo esos se pueden mandar ─────────────────────
const VISTO_MS = 60 * 60 * 1000;
const MAX_VISTOS = 5000;
const vistos = new Map();
function recordar(g) {
  vistos.delete(g.id);
  vistos.set(g.id, { ...g, at: Date.now() });
  while (vistos.size > MAX_VISTOS) vistos.delete(vistos.keys().next().value);
}

// ── Las búsquedas recientes, diez minutos ─────────────────────────────────
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

/** La huella de una persona para KLIPY (customer_id): no su id. */
const huella = usuarioId => crypto.createHash('sha256').update(`telecab-chat-gif:${usuarioId}`).digest('hex').slice(0, 24);

/** El primer tamaño y formato que haya, de los pedidos. Puro. */
function formato(file, tamanos, formatos) {
  if (!file || typeof file !== 'object') return null;
  for (const t of tamanos) {
    const f = file[t];
    if (!f || typeof f !== 'object') continue;
    for (const k of formatos) {
      const x = f[k];
      if (x && typeof x.url === 'string' && /^https:\/\//.test(x.url)) {
        return { url: x.url, ancho: Number(x.width) || null, alto: Number(x.height) || null, bytes: Number(x.size) || null };
      }
    }
  }
  return null;
}

/** Un GIF de KLIPY, como lo usa el chat; null si no trae lo que hace falta. Puro. */
function aGif(it) {
  if (!it || typeof it !== 'object') return null;
  const file = it.file || it.files || null;
  const vista = formato(file, ['sm', 'xs', 'md', 'hd'], ['webp', 'gif']);
  const envio = formato(file, ['md', 'sm', 'hd'], ['gif', 'webp']);
  const id = it.id != null ? String(it.id) : it.slug ? String(it.slug) : null;
  if (!id || !vista || !envio) return null;
  return { id, slug: it.slug ? String(it.slug) : null, titulo: String(it.title || '').slice(0, 120), vista, envio };
}

/** La lista de una respuesta de KLIPY: { data: { data: [...], has_next } }. Puro. */
function leerRespuesta(j) {
  const d = j && j.data;
  const lista = Array.isArray(d && d.data) ? d.data : Array.isArray(d) ? d : [];
  return { gifs: lista.map(aGif).filter(Boolean), hayMas: !!(d && d.has_next) };
}

/** Buscar (o, sin texto, los más vistos). */
async function buscar(usuarioId, { q = '', pagina = 1 } = {}) {
  if (!configurado()) throw error('Para buscar GIF falta la clave de KLIPY en el servidor (KLIPY_API_KEY). Avisa al desarrollador.', 503);
  const texto = String(q || '').trim().slice(0, 80);
  const page = Math.max(1, Math.min(20, Number(pagina) || 1));
  const ruta = texto ? 'gifs/search' : 'gifs/trending';
  const llave = `${ruta}|${texto.toLowerCase()}|${page}`;
  const ya = cache.get(llave);
  let r;
  if (ya && Date.now() - ya.at < CACHE_MS) {
    r = ya.r;
  } else {
    const params = new URLSearchParams({ per_page: String(POR_PAGINA), page: String(page), customer_id: huella(usuarioId), rating: RATING() });
    if (texto) params.set('q', texto);
    let res;
    try {
      // La clave va en la ruta: ni esta dirección ni sus errores salen al log ni a la pantalla.
      res = await fetch(`${BASE}/${encodeURIComponent(clave())}/${ruta}?${params}`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000),
      });
    } catch (_) {
      throw error('KLIPY no contesta ahora mismo. Prueba en un rato.', 502);
    }
    if (res.status === 401 || res.status === 403) throw error('KLIPY no acepta la clave (KLIPY_API_KEY). Avisa al desarrollador.', 502);
    if (res.status === 429) throw error('Demasiadas búsquedas de GIF seguidas: espera un minuto.', 429);
    if (!res.ok) throw error(`KLIPY ha contestado con un error (${res.status}).`, 502);
    r = leerRespuesta(await res.json().catch(() => null));
    cache.set(llave, { at: Date.now(), r });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  r.gifs.forEach(recordar);
  return { gifs: r.gifs.map(({ id, titulo, vista }) => ({ id, titulo, vista })), hayMas: r.hayMas, pagina: page };
}

/**
 * Trae un GIF de los enseñados (solo esos) y lo guarda como ADJUNTO de un
 * borrador: el de un mensaje del chat ('chat_borrador') o el de un comentario
 * del tablero ('tarea_borrador'). Devuelve el adjunto, como lo enseña la pantalla.
 * Lo usan mandar (el chat) y el tablero (18/11/2026, db/270).
 */
async function aBorrador(usuarioId, gifId, tipo, borrador) {
  const g = vistos.get(String(gifId || ''));
  if (!g || Date.now() - g.at > VISTO_MS) throw error('Ese GIF ya no está a mano: búscalo otra vez.', 410);
  let res;
  try {
    res = await fetch(g.envio.url, { signal: AbortSignal.timeout(15000) });
  } catch (_) {
    throw error('No se ha podido traer el GIF de KLIPY. Prueba otra vez.', 502);
  }
  if (!res.ok || !res.body) throw error('No se ha podido traer el GIF de KLIPY. Prueba otra vez.', 502);
  const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(gif|webp)$/.test(mime)) throw error('Eso no es un GIF.', 502);
  const base = String(g.slug || g.titulo || 'gif').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'gif';
  return adjuntos.subir({
    tipo, duenoId: borrador, nombre: `${base}.${mime === 'image/webp' ? 'webp' : 'gif'}`, mime,
    cuerpo: Readable.fromWeb(res.body), quien: { id: Number(usuarioId) },
  });
}

/** Mandar un GIF de los enseñados: se trae, se guarda como adjunto y sale en un mensaje. */
async function mandar(usuarioId, canalId, { gifId, padreId = null } = {}) {
  // Un borrador del chat de quien lo manda (como los ficheros que sube él).
  const borrador = `${Number(usuarioId)}-${crypto.randomBytes(12).toString('hex')}`;
  await aBorrador(usuarioId, gifId, 'chat_borrador', borrador);
  return require('./chat.service').enviar(usuarioId, canalId, { texto: '', padreId, borrador });
}

module.exports = {
  buscar, mandar, aBorrador, configurado,
  // Para las pruebas:
  _aGif: aGif, _leerRespuesta: leerRespuesta, _recordar: recordar, _olvidar: () => { vistos.clear(); cache.clear(); },
};
