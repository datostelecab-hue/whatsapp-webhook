// ============================================================
// LA VISTA PREVIA DE UN ENLACE — sin abrir la puerta a la red de dentro
// ============================================================
// El chat (ítem 2, entrega 2b) enseña debajo de un mensaje el título y la
// descripción de la página que se enlaza, como Slack. Para eso el SERVIDOR lee
// la página, y eso es justo lo que busca un SSRF: que nuestro servidor pida por
// otro algo que solo él alcanza (la base, el metadato de la nube en
// 169.254.169.254, un panel en localhost). Por eso aquí:
//
//   · Solo http y https, a los puertos de siempre (80 y 443), sin usuario ni
//     contraseña en la dirección.
//   · Cada nombre se resuelve AQUÍ y se comprueba que TODAS sus direcciones son
//     públicas (ni privadas, ni de bucle, ni de enlace local, ni reservadas, ni
//     IPv6 que escondan una IPv4 de esas). Y se conecta A ESA dirección (el
//     `lookup` de la propia petición): un DNS que cambia de respuesta entre la
//     comprobación y la conexión (DNS rebinding) no cuela.
//   · Las redirecciones se siguen a mano, como mucho tres, y cada una pasa por lo
//     mismo.
//   · Solo HTML, sin comprimir (nada de bombas de zip), con tope de tiempo
//     (5 s) y de tamaño (512 KB): se lee hasta </head> y se corta.
//   · No se traen imágenes: la CSP de la casa no deja pintar las de fuera, y
//     traerlas por nuestro servidor sería otra puerta.
//
//   const enlaces = require('./enlaces');
//   await enlaces.vistaPrevia('https://www.boe.es/…')
//     → { url, titulo, descripcion, sitio } o null (no hay nada que enseñar)
//   Lanza (status 400) si la dirección no se puede pedir; con otro fallo, null.
'use strict';

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

const MAX_BYTES = 512 * 1024;
const TIEMPO_MS = 5000;
const MAX_REDIRECCIONES = 3;
const MAX_URL = 2000;

function conEstado(e, status) { e.status = status; return e; }

// ── Las direcciones que no se piden nunca ─────────────────────────────────
const VEDADAS = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([red, bits]) => VEDADAS.addSubnet(red, bits, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64], ['2001::', 32], ['2002::', 16],
].forEach(([red, bits]) => VEDADAS.addSubnet(red, bits, 'ipv6'));

/** La IPv4 que lleva dentro una IPv6 (::ffff:a.b.c.d, ::a.b.c.d o 64:ff9b::a.b.c.d), o null. */
function ipv4Dentro(ip) {
  const s = String(ip).toLowerCase();
  const punto = /^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (punto) return punto[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) {
    const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
    return [a >> 8, a & 255, b >> 8, b & 255].join('.');
  }
  return null;
}

/** ¿Se puede pedir algo a esta IP? Solo a las públicas. */
function ipPermitida(ip) {
  const tipo = net.isIP(String(ip || ''));
  if (!tipo) return false;
  if (tipo === 4) return !VEDADAS.check(ip, 'ipv4');
  const dentro = ipv4Dentro(ip);
  if (dentro) return ipPermitida(dentro);
  return !VEDADAS.check(ip, 'ipv6');
}

/**
 * La dirección, si se puede pedir: { url (URL), host } o lanza 400 con el porqué.
 * Solo comprueba la forma; la IP se mira al conectar.
 */
function urlValida(texto) {
  const s = String(texto || '').trim();
  if (!s || s.length > MAX_URL) throw conEstado(new Error('El enlace no se entiende'), 400);
  let u;
  try { u = new URL(s); } catch (_) { throw conEstado(new Error('El enlace no se entiende'), 400); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw conEstado(new Error('Solo se leen enlaces http y https'), 400);
  if (u.username || u.password) throw conEstado(new Error('Un enlace con usuario o contraseña no se lee'), 400);
  if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))) {
    throw conEstado(new Error('Solo se leen enlaces a los puertos de siempre'), 400);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw conEstado(new Error('Ese enlace es de una red de dentro'), 400);
  }
  if (net.isIP(host) && !ipPermitida(host)) throw conEstado(new Error('Ese enlace es de una red de dentro'), 400);
  // Un nombre sin punto no es de internet (un servidor de la red de dentro).
  if (!net.isIP(host) && !host.includes('.')) throw conEstado(new Error('Ese enlace es de una red de dentro'), 400);
  return { url: u, host };
}

/**
 * El `lookup` de la petición: resuelve, y si ALGUNA dirección es de dentro, no
 * conecta. Con `all` (Node lo pide así para probar IPv4 e IPv6), las devuelve todas.
 */
function lookupSeguro(host, opciones, cb) {
  if (typeof opciones === 'function') { cb = opciones; opciones = {}; }
  dns.lookup(host, { all: true, verbatim: true }, (err, dirs) => {
    if (err) return cb(err);
    if (!dirs.length || dirs.some(d => !ipPermitida(d.address))) {
      return cb(conEstado(new Error(`${host} apunta a una red de dentro`), 400));
    }
    if (opciones && opciones.all) return cb(null, dirs);
    const familia = opciones && opciones.family;
    const d = dirs.find(x => !familia || x.family === familia) || dirs[0];
    return cb(null, d.address, d.family);
  });
}

/**
 * Pide UNA dirección (sin seguir redirecciones). → { estado, cabeceras, cuerpo (Buffer) }.
 * Corta al llegar a MAX_BYTES o al ver </head>.
 */
function pedirUna(u) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    let hecho = false;
    const fin = (err, v) => { if (hecho) return; hecho = true; clearTimeout(reloj); err ? reject(err) : resolve(v); };
    const req = mod.request(u, {
      method: 'GET',
      lookup: lookupSeguro,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TelecabBot/1.0; vista previa de enlaces del chat)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.5',
        'Accept-Encoding': 'identity',
      },
      timeout: TIEMPO_MS,
    }, res => {
      const estado = res.statusCode || 0;
      if (estado >= 300 && estado < 400) { res.resume(); fin(null, { estado, cabeceras: res.headers, cuerpo: Buffer.alloc(0) }); req.destroy(); return; }
      const tipo = String(res.headers['content-type'] || '').toLowerCase();
      if (estado !== 200 || !/text\/html|application\/xhtml\+xml/.test(tipo) || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
        res.resume(); fin(null, { estado, cabeceras: res.headers, cuerpo: Buffer.alloc(0) }); req.destroy(); return;
      }
      const trozos = [];
      let n = 0;
      res.on('data', t => {
        trozos.push(t); n += t.length;
        if (n >= MAX_BYTES || /<\/head\s*>/i.test(t.toString('latin1'))) { fin(null, { estado, cabeceras: res.headers, cuerpo: Buffer.concat(trozos).subarray(0, MAX_BYTES) }); req.destroy(); }
      });
      res.on('end', () => fin(null, { estado, cabeceras: res.headers, cuerpo: Buffer.concat(trozos).subarray(0, MAX_BYTES) }));
      res.on('error', e => fin(e));
    });
    const reloj = setTimeout(() => { req.destroy(); fin(conEstado(new Error('La página tardó demasiado'), 504)); }, TIEMPO_MS);
    req.on('timeout', () => { req.destroy(); fin(conEstado(new Error('La página tardó demasiado'), 504)); });
    req.on('error', e => fin(e));
    req.end();
  });
}

/** Pide la página siguiendo como mucho MAX_REDIRECCIONES, comprobando cada salto. */
async function pedirPagina(direccion) {
  let { url } = urlValida(direccion);
  for (let saltos = 0; saltos <= MAX_REDIRECCIONES; saltos++) {
    const r = await pedirUna(url);
    if (r.estado >= 300 && r.estado < 400 && r.cabeceras.location) {
      if (saltos === MAX_REDIRECCIONES) return null;
      url = urlValida(new URL(String(r.cabeceras.location), url).toString()).url;
      continue;
    }
    if (!r.cuerpo.length) return null;
    return { url: url.toString(), tipo: String(r.cabeceras['content-type'] || ''), cuerpo: r.cuerpo };
  }
  return null;
}

// ── Leer el título y la descripción ───────────────────────────────────────
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', euro: '€',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿' };
function desentidad(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#(\d{1,7});/g, (m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&([a-z]+);/gi, (m, e) => (Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m));
}
// Hay páginas que codifican dos veces («Bolet&amp;iacute;n», el BOE): una segunda pasada si hace falta.
const limpio = (s, max) => {
  let d = desentidad(s);
  if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(d)) d = desentidad(d);
  const t = d.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** El texto de un Buffer HTML, con su juego de caracteres (cabecera o <meta>). */
function aTexto(cuerpo, tipo = '') {
  const cab = /charset=["']?([\w-]+)/i.exec(tipo);
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(cuerpo.subarray(0, 4096).toString('latin1'));
  const juego = String((cab && cab[1]) || (meta && meta[1]) || 'utf-8').toLowerCase();
  try { return new TextDecoder(juego === 'iso-8859-1' || juego === 'latin1' ? 'windows-1252' : juego).decode(cuerpo); } catch (_) { return cuerpo.toString('utf8'); }
}

/**
 * Del HTML, lo que se enseña: { titulo, descripcion, sitio } (Open Graph y
 * Twitter primero; si no, <title> y la descripción de siempre). Pura: se prueba sola.
 */
function leerMetadatos(html, url) {
  const cabeza = String(html || '').slice(0, MAX_BYTES).split(/<\/head\s*>/i)[0];
  const metas = [];
  cabeza.replace(/<meta\b[^>]*>/gi, etiqueta => {
    const at = {};
    etiqueta.replace(/([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, k, v, a, b, c) => { at[k.toLowerCase()] = a != null ? a : b != null ? b : c; return m; });
    metas.push(at);
    return etiqueta;
  });
  const meta = (...nombres) => {
    for (const n of nombres) {
      const m = metas.find(x => String(x.property || x.name || '').toLowerCase() === n && x.content);
      if (m) return m.content;
    }
    return '';
  };
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cabeza);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { /* sin sitio */ }
  return {
    titulo: limpio(meta('og:title', 'twitter:title') || (t && t[1]) || '', 200),
    descripcion: limpio(meta('og:description', 'twitter:description', 'description'), 300),
    sitio: limpio(meta('og:site_name') || host, 120),
  };
}

/**
 * La vista previa de un enlace: { url, titulo, descripcion, sitio }, o null si
 * no hay título que enseñar. `pedir` se cambia en las pruebas (no hay red).
 */
async function vistaPrevia(direccion, { pedir = pedirPagina } = {}) {
  urlValida(direccion);
  let pagina = null;
  try { pagina = await pedir(direccion); } catch (e) { if (e.status === 400) throw e; return null; }
  if (!pagina || !pagina.cuerpo) return null;
  const html = Buffer.isBuffer(pagina.cuerpo) ? aTexto(pagina.cuerpo, pagina.tipo) : String(pagina.cuerpo);
  const m = leerMetadatos(html, pagina.url || direccion);
  return m.titulo ? { url: String(direccion).trim(), ...m } : null;
}

module.exports = { vistaPrevia, urlValida, ipPermitida, leerMetadatos, pedirPagina, aTexto };
