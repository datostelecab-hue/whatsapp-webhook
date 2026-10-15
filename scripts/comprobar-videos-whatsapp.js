// ============================================================
// LOS VÍDEOS POR WHATSAPP — las reglas
// ============================================================
// El envío de vídeos de la casa (15/10/2026): solo con la ventana de 24 h
// abierta, por enlace https a nuestro /assets, con su texto debajo, y apuntado
// en el chat como un vídeo que se ve desde el propio ERP.
//
//   node scripts/comprobar-videos-whatsapp.js
//
// No toca la base ni Meta: el chat y el envío se sustituyen.
const path = require('path');
const fs = require('fs');

const enviados = [];
let chatDe = () => null;
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};
const WA_REAL = require('../services/whatsapp');
sustituir('services/whatsapp.js', {
  ...WA_REAL,
  enviarVideo: async (tel, o, op) => { enviados.push({ tipo: 'video', tel, ...o, ...op }); return { ok: true, id: 'wamid.V' }; },
  enviarTexto: async (tel, texto, op) => { enviados.push({ tipo: 'texto', tel, texto, ...op }); return { ok: true, id: 'wamid.T' }; },
});
sustituir('services/repo/whatsappChat.js', { chat: async tel => chatDe(tel) });

const V = require('../services/videosWhatsapp');
const W = require('../services/whatsappChat');
const S = require('../modules/WhatsApp/whatsapp.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
async function lanza(nombre, fn, trozo) {
  try { await fn(); igual(nombre + ' (tenía que fallar)', 'no falló', trozo); }
  catch (e) { igual(nombre, e.message.includes(trozo) ? trozo : e.message, trozo); }
}

(async () => {
  // ── El catálogo ────────────────────────────────────────────────────────────
  const bot = V.de('bot_coche');
  igual('El vídeo del bot está en el catálogo', !!bot, true);
  const fichero = path.join(__dirname, '..', 'public', bot.ruta);
  igual('Su fichero existe y cabe en WhatsApp (16 MB)', fs.existsSync(fichero) && fs.statSync(fichero).size <= 16 * 1024 * 1024, true);
  igual('Lo que va a la pantalla no lleva el texto de WhatsApp', Object.keys(V.lista()[0]).includes('pie'), false);
  igual('Sin la palabra que no se le dice al conductor', /fich/i.test(bot.pie), false);

  // ── El enlace ──────────────────────────────────────────────────────────────
  igual('Enlace con la dirección pública', V.enlace(bot, 'https://erp.example.com/'), 'https://erp.example.com/assets/videos/bot-coche.mp4');
  await lanza('Sin https no hay enlace (y desde local no sale nada)', () => V.enlace(bot, 'http://localhost:3000'), 'https');

  // ── Cómo queda en el chat ──────────────────────────────────────────────────
  igual('El vídeo que mandamos se apunta como vídeo, con su ruta para verlo',
    W.describirSaliente({ type: 'video', video: { link: 'https://erp.example.com/assets/videos/bot-coche.mp4', caption: 'Hola' } }),
    { tipo: 'video', texto: 'Hola', detalle: { enlace: 'https://erp.example.com/assets/videos/bot-coche.mp4', ruta: '/assets/videos/bot-coche.mp4' } });
  igual('Un enlace que no es https no se manda', (await WA_REAL.enviarVideo('600111222', { link: 'http://x/v.mp4' })).ok, false);

  // ── Mandarlo ───────────────────────────────────────────────────────────────
  const hace = h => new Date(Date.now() - h * 3600 * 1000).toISOString();
  chatDe = tel => (tel === '34600111222' ? { existe: true, ultima_entrante_at: hace(30) } : null);
  await lanza('Ventana cerrada (escribió hace 30 h): no se manda', () =>
    S.enviarVideo({ telefono: '600111222', video: 'bot_coche' }, 7, 'https://erp.example.com'), 'ventana de 24 h está cerrada');
  chatDe = () => null;
  await lanza('Sin conversación: no se manda', () =>
    S.enviarVideo({ telefono: '600111222', video: 'bot_coche' }, 7, 'https://erp.example.com'), 'ventana de 24 h está cerrada');
  await lanza('Un vídeo que no existe', () => S.enviarVideo({ telefono: '600111222', video: 'otro' }, 7, 'https://x.com'), 'no existe');

  chatDe = tel => (tel === '34600111222' ? { existe: true, ultima_entrante_at: hace(2) } : null);
  enviados.length = 0;
  const r = await S.enviarVideo({ telefono: '600111222', video: 'bot_coche' }, 7, 'https://erp.example.com');
  igual('Ventana abierta: sale, con el 34 delante, el enlace, su texto y firmado por la oficina',
    [r.enviado, enviados[0].tel, enviados[0].link, enviados[0].caption === bot.pie, enviados[0].origen, enviados[0].usuarioId],
    [true, '34600111222', 'https://erp.example.com/assets/videos/bot-coche.mp4', true, 'oficina', 7]);

  enviados.length = 0;
  await S.enviarVideo({ telefono: '600111222', video: 'bot_coche', texto: 'Hola, bienvenido' }, 7, 'https://erp.example.com');
  igual('Con texto: sale primero el texto y después el vídeo, los dos de la oficina',
    enviados.map(e => [e.tipo, e.origen]), [['texto', 'oficina'], ['video', 'oficina']]);
  enviados.length = 0;
  await lanza('Sin https no sale ni el texto', () =>
    S.enviarVideo({ telefono: '600111222', video: 'bot_coche', texto: 'Hola' }, 7, 'http://localhost'), 'https');
  igual('…de verdad, nada', enviados.length, 0);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
