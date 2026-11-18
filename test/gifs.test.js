// ============================================================
// EL BOTÓN DE GIF DEL CHAT — con KLIPY (18/11/2026)
// ============================================================
// Camilo pidió el botón con Tenor; Google apagó su API el 30/06/2026 y eligió
// KLIPY. Sin red: fetch se sustituye por respuestas inventadas.
//
//   · de la respuesta de KLIPY se toma una vista pequeña y el GIF que se manda;
//     lo que no trae GIF se salta, y la clave no sale del servidor;
//   · sin clave, se dice que falta;
//   · solo se manda un GIF que el servidor acaba de enseñar, y llega al canal
//     como un mensaje con el GIF de adjunto (no un enlace a KLIPY).
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const gifs = require('../modules/Chat/gifs.service');
const chat = require('../modules/Chat/chat.service');
const adjuntos = require('../services/adjuntos');

const fetchDeVerdad = global.fetch;
const claveAntes = process.env.KLIPY_API_KEY;
let pedidas = [];
beforeEach(() => { gifs._olvidar(); pedidas = []; process.env.KLIPY_API_KEY = 'clave-de-prueba'; });
afterEach(() => { global.fetch = fetchDeVerdad; if (claveAntes === undefined) delete process.env.KLIPY_API_KEY; else process.env.KLIPY_API_KEY = claveAntes; });

const RESPUESTA = {
  result: true,
  data: {
    data: [
      { id: 101, slug: 'jaja-risa', title: 'Jaja', file: {
        hd: { gif: { url: 'https://static.klipy.com/hd.gif', width: 498, height: 280, size: 2000000 } },
        md: { gif: { url: 'https://static.klipy.com/md.gif', width: 320, height: 180, size: 600000 } },
        sm: { webp: { url: 'https://static.klipy.com/sm.webp', width: 220, height: 124, size: 90000 } },
      } },
      { id: 102, title: 'Sin ficheros' },
    ],
    current_page: 1, per_page: 24, has_next: true,
  },
};
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');

function klipyFalso() {
  global.fetch = async (url) => {
    pedidas.push(String(url));
    if (String(url).startsWith('https://api.klipy.com/')) return new Response(JSON.stringify(RESPUESTA), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url) === 'https://static.klipy.com/md.gif') return new Response(GIF, { status: 200, headers: { 'content-type': 'image/gif' } });
    return new Response('no', { status: 404 });
  };
}

test('de KLIPY, la vista pequeña para la rejilla y el GIF mediano para mandar; lo que no trae GIF, fuera', () => {
  const r = gifs._leerRespuesta(RESPUESTA);
  assert.equal(r.hayMas, true);
  assert.equal(r.gifs.length, 1);
  assert.deepEqual([r.gifs[0].id, r.gifs[0].vista.url, r.gifs[0].envio.url], ['101', 'https://static.klipy.com/sm.webp', 'https://static.klipy.com/md.gif']);
  assert.deepEqual(gifs._leerRespuesta(null), { gifs: [], hayMas: false }, 'una respuesta rara no rompe');
  assert.equal(gifs._aGif({ id: 9, file: { md: { gif: { url: 'http://inseguro/x.gif' } } } }), null, 'solo https');
});

test('buscar: sin clave lo dice; con ella, sin texto los más vistos, y a la pantalla no llega ni la clave ni el GIF de mandar', async () => {
  delete process.env.KLIPY_API_KEY;
  await assert.rejects(gifs.buscar(7, { q: 'hola' }), e => e.status === 503 && /KLIPY_API_KEY/.test(e.message));
  process.env.KLIPY_API_KEY = 'clave-de-prueba';
  klipyFalso();
  const r = await gifs.buscar(7, { q: '' });
  assert.match(pedidas[0], /^https:\/\/api\.klipy\.com\/api\/v1\/clave-de-prueba\/gifs\/trending\?/);
  assert.match(pedidas[0], /customer_id=[0-9a-f]{24}/, 'una huella, no el id de la persona');
  assert.doesNotMatch(pedidas[0], /customer_id=7\b/);
  assert.deepEqual(r.gifs, [{ id: '101', titulo: 'Jaja', vista: { url: 'https://static.klipy.com/sm.webp', ancho: 220, alto: 124, bytes: 90000 } }]);
  assert.doesNotMatch(JSON.stringify(r), /clave-de-prueba|md\.gif/);
  await gifs.buscar(7, { q: 'jaja' });
  await gifs.buscar(8, { q: 'JAJA' });
  assert.equal(pedidas.filter(u => /gifs\/search\?/.test(u)).length, 1, 'la misma búsqueda, una vez en diez minutos');
});

test('con la base: mandar un GIF de los enseñados; sale en el canal como mensaje con el GIF adjunto', () => conBase(async ({ fabrica, consulta }) => {
  const u = (await fabrica.usuario({ nombre: 'Daiane' })).id;
  await chat.canales(u);
  const general = Number((await consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  klipyFalso();
  await assert.rejects(gifs.mandar(u, general, { gifId: '101' }), e => e.status === 410, 'sin haberlo enseñado, no');
  await gifs.buscar(u, { q: 'jaja' });
  const r = await gifs.mandar(u, general, { gifId: '101' });
  await chat.esperarPendientes();
  assert.equal(r.mensaje.conAdjuntos, true);
  assert.equal(r.mensaje.texto, '');
  const a = await adjuntos.lista('chat_mensaje', String(r.mensaje.id), { id: u });
  assert.deepEqual(a.map(x => [x.nombre, x.mime]), [['jaja-risa.gif', 'image/gif']], 'guardado aquí, no un enlace a KLIPY');
  assert.ok(pedidas.includes('https://static.klipy.com/md.gif'), 'se trajo el mediano');
}));
