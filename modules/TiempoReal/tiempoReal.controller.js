// ============================================================
// TIEMPO REAL — la conexión que la pantalla deja abierta (/tiempo-real, A7)
// ============================================================
// Las mismas para todos. Quién oye qué lo dice cada canal al registrarse en
// services/tiempoReal.js, no esta ruta: por eso /tiempo-real no está en el
// catálogo de permisos (entra cualquiera con sesión, y cada canal se comprueba).
//
//   GET  /tiempo-real/eventos?canales=a,b[&desde=id]   la conexión (Server-Sent Events)
//   GET  /tiempo-real/api/estado                       cuántas tiene abiertas (y si sigue la sesión)
//   POST /tiempo-real/api/probar                       un aviso de prueba a uno mismo (desarrollador)
//   GET  /tiempo-real/banco                            el banco de pruebas (desarrollador)
//
// Quién es sale de la sesión, nunca de la petición.
'use strict';

const express = require('express');
const router = express.Router();
const sesion = require('../../services/sesion');
const actor = require('../../services/repo/actor');
const tiempoReal = require('../../services/tiempoReal');

// EL CANAL DEL BANCO: solo el desarrollador, y cada aviso solo a quien lo pidió.
tiempoReal.registrarCanal('prueba', { etiqueta: 'Banco de pruebas', puede: async q => q.rol === 'desarrollador' });

const quienEs = async req => {
  const id = (req.usuario && req.usuario.id) || await actor.idDe(req);
  return { id: id ? Number(id) : null, rol: req.usuario ? req.usuario.rol : null };
};

const MAX_CANALES = 20;

// ── La conexión ─────────────────────────────────────────────────────────────
router.get('/eventos', async (req, res) => {
  let quien;
  try { quien = await quienEs(req); } catch (e) {
    console.error('❌ [Tiempo real] quién es:', e.message);
    return res.status(500).json({ status: 'error', msg: 'No se ha podido abrir el tiempo real' });
  }
  if (!quien.id) return res.status(401).json({ status: 'error', msg: 'Sesión requerida' });
  const pedidos = String(req.query.canales || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_CANALES);
  if (!pedidos.length) return res.status(400).json({ status: 'error', msg: 'Di qué canales quieres oír (?canales=…)' });

  const { aceptados, rechazados } = await tiempoReal.canalesDe(pedidos, quien);
  if (req.destroyed || res.destroyed) return;   // se fue mientras se miraban los permisos

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // `no-transform`: la compresión (app.js) no lo toca, y por eso no lo retiene
    // hasta llenar su búfer; los avisos salen en cuanto se escriben.
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  if (req.socket && req.socket.setNoDelay) req.socket.setNoDelay(true);

  // FIN: el motivo va en un evento y la pantalla decide (ver tiempoReal.js):
  // con «sesion» comprueba la sesión, con «demasiadas» o «sin-canales» deja de
  // intentarlo, y con lo demás vuelve sola.
  const cerrar = motivo => {
    try { res.write(tiempoReal.marcoDe('fin', { motivo })); } catch (_) { /* ya cerrada */ }
    res.end();
  };

  if (!aceptados.length) {
    res.write(tiempoReal.marcoDe('suscrito', { canales: [], rechazados, ultimo: tiempoReal.ultimoId() }));
    return cerrar('sin-canales');
  }

  let c;
  try {
    c = tiempoReal.conectar({
      quien,
      canales: aceptados,
      escribir: t => res.write(t),
      pendiente: () => res.writableLength,
      cerrar,
      // Cada dos minutos: que la sesión siga abierta (cerrar la del móvil, o
      // bloquear a alguien, también corta su tiempo real) y que siga pudiendo
      // oír cada canal.
      revisar: async () => {
        if (!await sesion.sesionVigente(req)) return { ok: false };
        const { aceptados: siguen } = await tiempoReal.canalesDe([...c.canales], quien);
        return { ok: true, canales: siguen };
      },
    });
  } catch (e) {
    if (e.status !== 503) console.error('❌ [Tiempo real] conectar:', e.message);
    return cerrar('lleno');
  }
  req.on('close', () => tiempoReal.soltar(c));

  // TODO ESTO VA SEGUIDO, sin esperas: entre apuntar la conexión y mandar lo
  // perdido no puede colarse un aviso nuevo (saldría antes que los viejos).
  // La espera antes de volver si se corta, distinta para cada uno (3 a 7 s): si
  // el servidor se reinicia, no vuelven todos en el mismo segundo.
  res.write(`retry: ${3000 + Math.floor(Math.random() * 4000)}\n\n`);
  const desde = req.get('last-event-id') || req.query.desde;
  const perdidos = desde ? tiempoReal.perdidos(String(desde), c) : [];
  // Primero lo perdido, en orden; después «suscrito», que lleva el id del último
  // aviso del servidor. Así el navegador, si se vuelve a cortar, pide desde
  // ahí: también si se corta antes de que llegue ningún aviso (sin ese id
  // volvería sin decir desde dónde y lo de en medio se perdería), y también
  // tras un reinicio (si no, volvería con el id viejo y otra vez «reinicio»).
  if (perdidos) for (const a of perdidos) res.write(a.marco);
  res.write(`id: ${tiempoReal.ultimoId()}\n` + tiempoReal.marcoDe('suscrito', { canales: aceptados, rechazados, ultimo: tiempoReal.ultimoId() }));
  if (perdidos === null) res.write(tiempoReal.marcoDe('reinicio', { motivo: 'no se pueden recuperar los avisos perdidos' }));
});

// ── Cuántas hay ─────────────────────────────────────────────────────────────
// La pantalla la pide cuando la conexión se cae del todo: si la sesión caducó,
// contesta 401 y Api lleva al login, como cualquier otra petición.
router.get('/api/estado', async (req, res) => {
  try {
    const quien = await quienEs(req);
    const e = tiempoReal.estado(quien.id);
    res.json(quien.rol === 'desarrollador' ? { status: 'ok', ...e } : { status: 'ok', mias: e.mias });
  } catch (e) {
    console.error('❌ [Tiempo real] estado:', e.message);
    res.status(500).json({ status: 'error', msg: 'No se ha podido leer el estado del tiempo real' });
  }
});

// ── El banco de pruebas ─────────────────────────────────────────────────────
router.get('/banco', sesion.requiereDesarrollador, (req, res) => {
  res.render('tiempoRealBanco', { titulo: 'Banco de tiempo real', seccion: 'tiempo-real', layout: 'layout-gestion' });
});

// Uno o varios avisos a uno mismo, por el canal del banco.
router.post('/api/probar', sesion.requiereDesarrollador, async (req, res) => {
  try {
    const quien = await quienEs(req);
    const veces = Math.min(Math.max(Number((req.body || {}).veces) || 1, 1), 5);
    const ids = [];
    for (let i = 1; i <= veces; i++) {
      ids.push(tiempoReal.publicar('prueba', { n: i, de: veces, enviado: Date.now() }, { para: [quien.id] }));
    }
    res.json({ status: 'ok', ids });
  } catch (e) {
    console.error('❌ [Tiempo real] probar:', e.message);
    res.status(500).json({ status: 'error', msg: 'No se ha podido mandar el aviso de prueba' });
  }
});

module.exports = router;
