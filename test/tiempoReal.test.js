// ============================================================
// EL TIEMPO REAL (pieza A7 de la hoja de ruta)
// ============================================================
// El bus en memoria (canales, a quién llega cada aviso, lo que se guarda para
// quien vuelve) y, por HTTP con la compresión puesta, la conexión de verdad:
// sin comprimir, con su latido, retomando lo perdido y cortándose al cerrar la
// sesión. No usa la base.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const tiempoReal = require('../services/tiempoReal');
const sesion = require('../services/sesion');

const AJUSTES_ANTES = { ...tiempoReal.AJUSTES };
after(() => { tiempoReal.cerrarTodas('fin de las pruebas'); tiempoReal.configurar(AJUSTES_ANTES); });

// Los canales de estas pruebas.
const OYEN = new Set();
tiempoReal.registrarCanal('test.tareas', { etiqueta: 'Tareas', puede: async q => OYEN.has(q.id) });
tiempoReal.registrarCanal('test.todos', { puede: async () => true });
tiempoReal.registrarCanal('test.roto', { puede: async () => { throw new Error('se rompe'); } });

const esperar = ms => new Promise(ok => setTimeout(ok, ms));

/** Una conexión de mentira: lo que se le escribe, en `texto`. */
function falsa(quien, canales, { pendiente = () => 0 } = {}) {
  const f = { texto: '', cerrada: null };
  f.c = tiempoReal.conectar({
    quien, canales,
    escribir: t => { f.texto += t; },
    pendiente,
    cerrar: motivo => { f.cerrada = motivo; },
  });
  return f;
}

test('un aviso llega a quien oye su canal y, con `para`, solo a esos', () => {
  const ana = falsa({ id: 1, rol: 'oficina' }, ['test.tareas']);
  const luis = falsa({ id: 2, rol: 'oficina' }, ['test.tareas']);
  const otro = falsa({ id: 3, rol: 'oficina' }, ['test.todos']);
  try {
    const id = tiempoReal.publicar('test.tareas', { id: 42, que: 'nueva' });
    assert.match(id, new RegExp(`^${tiempoReal.ARRANQUE}-\\d+$`));
    assert.match(ana.texto, new RegExp(`id: ${id}\\ndata: \\{"c":"test.tareas","d":\\{"id":42,"que":"nueva"\\}\\}\\n\\n`));
    assert.match(luis.texto, /"id":42/);
    assert.equal(otro.texto, '', 'otro canal: nada');

    tiempoReal.publicar('test.tareas', { id: 43 }, { para: [2] });
    assert.doesNotMatch(ana.texto, /"id":43/, 'no era para ella');
    assert.match(luis.texto, /"id":43/);
  } finally {
    [ana, luis, otro].forEach(f => f.c.terminar('fin'));
  }
});

test('un aviso de un canal sin registrar, o de más de 16 KB, no sale', () => {
  assert.throws(() => tiempoReal.publicar('no.existe', {}), /hay que registrarlo/);
  assert.throws(() => tiempoReal.publicar('test.todos', { texto: 'x'.repeat(17 * 1024) }), /16 KB/);
});

test('quien vuelve recibe lo que se perdió; si ya no está o es de otro arranque, reinicio', () => {
  const ana = falsa({ id: 1 }, ['test.tareas']);
  ana.c.terminar('fin');   // se corta
  const visto = tiempoReal.publicar('test.todos', { n: 0 });
  const a1 = tiempoReal.publicar('test.tareas', { n: 1 });
  tiempoReal.publicar('test.tareas', { n: 2 }, { para: [9] });   // no era para ella
  const a3 = tiempoReal.publicar('test.tareas', { n: 3 });

  const vuelve = falsa({ id: 1 }, ['test.tareas']);
  try {
    const p = tiempoReal.perdidos(visto, vuelve.c);
    assert.deepEqual(p.map(a => a.marco.match(/^id: (\S+)/)[1]), [a1, a3], 'los suyos, en orden, y nada más');
    assert.deepEqual(tiempoReal.perdidos(a3, vuelve.c), [], 'al día: nada');
    assert.equal(tiempoReal.perdidos('otroarranque-5', vuelve.c), null, 'el servidor se reinició');
    assert.equal(tiempoReal.perdidos('basura', vuelve.c), null);
    assert.equal(tiempoReal.perdidos(`${tiempoReal.ARRANQUE}-999999999`, vuelve.c), null, 'un id del futuro');

    // Pasado el tope de guardados, lo viejo ya no se puede retomar.
    const antes = tiempoReal.AJUSTES.maxGuardados;
    tiempoReal.configurar({ maxGuardados: 2 });
    try {
      tiempoReal.publicar('test.tareas', { n: 4 });
      tiempoReal.publicar('test.tareas', { n: 5 });
      tiempoReal.publicar('test.tareas', { n: 6 });
      assert.equal(tiempoReal.perdidos(a1, vuelve.c), null);
    } finally {
      tiempoReal.configurar({ maxGuardados: antes });
    }
  } finally {
    vuelve.c.terminar('fin');
  }
});

test('los canales: sin permiso, que no existen o con un permiso que falla, se rechazan', async () => {
  OYEN.add(5);
  const r = await tiempoReal.canalesDe(['test.tareas', 'test.todos', 'no.existe', 'test.roto', 'test.todos'], { id: 5 });
  assert.deepEqual(r, { aceptados: ['test.tareas', 'test.todos'], rechazados: ['no.existe', 'test.roto'] });
  const sin = await tiempoReal.canalesDe(['test.tareas'], { id: 6 });
  assert.deepEqual(sin.rechazados, ['test.tareas']);
  assert.deepEqual((await tiempoReal.canalesDe(['test.todos'], { id: null })).aceptados, [], 'sin usuario, nada');
});

test('con demasiadas pestañas se cierra la más vieja, y un navegador que no lee se corta', () => {
  const antes = tiempoReal.AJUSTES.maxPorUsuario;
  tiempoReal.configurar({ maxPorUsuario: 2 });
  const abiertas = [];
  try {
    abiertas.push(falsa({ id: 8 }, ['test.todos']), falsa({ id: 8 }, ['test.todos']), falsa({ id: 8 }, ['test.todos']));
    assert.deepEqual(abiertas.map(f => f.cerrada), ['demasiadas', null, null]);
    const lenta = falsa({ id: 9 }, ['test.todos'], { pendiente: () => 2 * 1024 * 1024 });
    abiertas.push(lenta);
    tiempoReal.publicar('test.todos', { n: 1 });
    assert.equal(lenta.cerrada, 'lento');
  } finally {
    abiertas.forEach(f => f.c.terminar('fin'));
    tiempoReal.configurar({ maxPorUsuario: antes });
  }
});

// ── Por HTTP, con la compresión puesta como en app.js ──────────────────────
async function servidor() {
  const express = require('express');
  const app = express();
  app.use(require('compression')());
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = Number(req.headers['x-yo'] || 0);
    req.usuario = id ? { id, rol: req.headers['x-rol'] || 'oficina' } : null;
    next();
  });
  app.use((req, res, next) => (req.usuario ? next() : res.status(401).json({ status: 'error', msg: 'Sesión requerida' })));
  app.use('/tiempo-real', require('../modules/TiempoReal/tiempoReal.controller'));
  const s = await new Promise(ok => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  return {
    url: `http://127.0.0.1:${s.address().port}/tiempo-real`,
    cerrar: () => new Promise(ok => { s.closeAllConnections(); s.close(ok); }),
  };
}

/** Abre la conexión como un navegador y va leyendo los eventos. */
function abrir(url, { yo, rol, cabeceras = {} } = {}) {
  const eventos = [];
  let crudo = '';
  let resto = '';
  const c = { eventos, crudo: () => crudo, terminada: false };
  c.lista = new Promise((ok, mal) => {
    c.rq = http.get(url, { headers: { 'Accept-Encoding': 'gzip', Accept: 'text/event-stream', 'X-Yo': String(yo || ''), 'X-Rol': rol || '', ...cabeceras } }, res => {
      c.res = res;
      res.setEncoding('utf8');
      res.on('data', t => {
        crudo += t;
        resto += t;
        let i;
        while ((i = resto.indexOf('\n\n')) >= 0) {
          const bloque = resto.slice(0, i);
          resto = resto.slice(i + 2);
          const ev = { event: 'message', data: '', id: null, comentario: null };
          for (const l of bloque.split('\n')) {
            if (l.startsWith(':')) ev.comentario = l.slice(1).trim();
            else if (l.startsWith('event: ')) ev.event = l.slice(7);
            else if (l.startsWith('data: ')) ev.data += l.slice(6);
            else if (l.startsWith('id: ')) ev.id = l.slice(4);
            else if (l.startsWith('retry: ')) ev.retry = Number(l.slice(7));
          }
          eventos.push(ev);
        }
      });
      res.on('end', () => { c.terminada = true; });
      ok(res);
    });
    c.rq.on('error', e => { c.terminada = true; mal(e); });
  });
  c.hasta = async (pred, ms = 2000) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      const e = eventos.find(pred);
      if (e) return e;
      await esperar(10);
    }
    throw new Error('no llegó: ' + JSON.stringify(eventos));
  };
  c.cerrar = () => c.rq.destroy();
  return c;
}

test('por HTTP: sin comprimir, con su retry y su «suscrito», y los avisos al momento', async () => {
  const srv = await servidor();
  OYEN.add(21);
  const a = abrir(`${srv.url}/eventos?canales=test.tareas,no.existe`, { yo: 21 });
  try {
    const res = await a.lista;
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /^text\/event-stream/);
    assert.equal(res.headers['content-encoding'], undefined, 'la compresión no lo toca: si no, retendría los avisos');
    assert.match(res.headers['cache-control'], /no-transform/);
    const sus = await a.hasta(e => e.event === 'suscrito');
    assert.deepEqual(JSON.parse(sus.data).canales, ['test.tareas']);
    assert.deepEqual(JSON.parse(sus.data).rechazados, ['no.existe']);
    const retry = a.eventos.find(e => e.retry);
    assert.ok(retry.retry >= 3000 && retry.retry < 7000);

    const id = tiempoReal.publicar('test.tareas', { id: 7 });
    const llega = await a.hasta(e => e.id === id, 500);
    assert.deepEqual(JSON.parse(llega.data), { c: 'test.tareas', d: { id: 7 } });
  } finally {
    a.cerrar();
    await srv.cerrar();
  }
});

test('por HTTP: al volver con Last-Event-ID llega lo perdido; con un id de otro arranque, «reinicio»', async () => {
  const srv = await servidor();
  OYEN.add(22);
  try {
    const a = abrir(`${srv.url}/eventos?canales=test.tareas`, { yo: 22 });
    await a.hasta(e => e.event === 'suscrito');
    const visto = tiempoReal.publicar('test.tareas', { n: 1 });
    await a.hasta(e => e.id === visto);
    a.cerrar();
    await esperar(30);
    const p2 = tiempoReal.publicar('test.tareas', { n: 2 });
    const p3 = tiempoReal.publicar('test.tareas', { n: 3 });

    const b = abrir(`${srv.url}/eventos?canales=test.tareas`, { yo: 22, cabeceras: { 'Last-Event-ID': visto } });
    await b.hasta(e => e.id === p3);
    assert.deepEqual(b.eventos.filter(e => e.event === 'message' && e.id).map(e => e.id), [p2, p3], 'los dos perdidos, en orden');
    const sus = b.eventos.find(e => e.event === 'suscrito');
    assert.ok(b.eventos.indexOf(sus) > b.eventos.findIndex(e => e.id === p3), '«suscrito» va después de lo perdido');
    assert.equal(sus.id, p3, 'y lleva el último id: desde ahí se retoma');
    b.cerrar();

    // `desde` en la dirección vale igual (una conexión nueva no manda la cabecera).
    const c = abrir(`${srv.url}/eventos?canales=test.tareas&desde=${encodeURIComponent(p2)}`, { yo: 22 });
    await c.hasta(e => e.id === p3);
    c.cerrar();

    const d = abrir(`${srv.url}/eventos?canales=test.tareas`, { yo: 22, cabeceras: { 'Last-Event-ID': 'otroarranque-3' } });
    await d.hasta(e => e.event === 'reinicio');
    // Tras el reinicio, el id de «suscrito» es de este servidor: al volver, ya no hay otro reinicio.
    const idNuevo = d.eventos.find(e => e.event === 'suscrito').id;
    assert.match(idNuevo, new RegExp(`^${tiempoReal.ARRANQUE}-`));
    d.cerrar();

    // Se corta ANTES de recibir ningún aviso: con el id de «suscrito» vuelve sin perder lo de en medio.
    const e1 = abrir(`${srv.url}/eventos?canales=test.tareas`, { yo: 22 });
    const desdeAqui = (await e1.hasta(e => e.event === 'suscrito')).id;
    e1.cerrar();
    await esperar(30);
    const enMedio = tiempoReal.publicar('test.tareas', { n: 4 });
    const e2 = abrir(`${srv.url}/eventos?canales=test.tareas`, { yo: 22, cabeceras: { 'Last-Event-ID': desdeAqui } });
    await e2.hasta(e => e.id === enMedio);
    assert.equal(e2.eventos.some(e => e.event === 'reinicio'), false);
    e2.cerrar();
  } finally {
    await srv.cerrar();
  }
});

test('por HTTP: el latido sale solo, y al cerrarse la sesión la conexión se corta con «fin»', async () => {
  const srv = await servidor();
  const vigente = sesion.sesionVigente;
  let vale = true;
  sesion.sesionVigente = async () => (vale ? { id: 23 } : null);
  tiempoReal.configurar({ latidoMs: 40, revisarSesionMs: 60 });
  const a = abrir(`${srv.url}/eventos?canales=test.todos`, { yo: 23 });
  try {
    await a.hasta(e => e.event === 'suscrito');
    await a.hasta(e => e.comentario && e.comentario.startsWith('latido'), 1000);
    assert.equal(a.terminada, false, 'con la sesión abierta sigue');
    vale = false;
    const fin = await a.hasta(e => e.event === 'fin', 1000);
    assert.deepEqual(JSON.parse(fin.data), { motivo: 'sesion' });
    for (let i = 0; i < 50 && !a.terminada; i++) await esperar(10);
    assert.equal(a.terminada, true, 'y se cierra');
  } finally {
    sesion.sesionVigente = vigente;
    tiempoReal.configurar({ latidoMs: AJUSTES_ANTES.latidoMs, revisarSesionMs: AJUSTES_ANTES.revisarSesionMs });
    a.cerrar();
    await srv.cerrar();
  }
});

test('por HTTP: al perder el permiso de un canal se deja de oír', async () => {
  const srv = await servidor();
  const vigente = sesion.sesionVigente;
  sesion.sesionVigente = async () => ({ id: 24 });
  OYEN.add(24);
  tiempoReal.configurar({ revisarSesionMs: 50 });
  const a = abrir(`${srv.url}/eventos?canales=test.tareas,test.todos`, { yo: 24 });
  try {
    await a.hasta(e => e.event === 'suscrito');
    OYEN.delete(24);
    const cambio = await a.hasta(e => e.event === 'suscrito' && JSON.parse(e.data).rechazados.includes('test.tareas'), 1000);
    assert.deepEqual(JSON.parse(cambio.data).canales, ['test.todos']);
    const id = tiempoReal.publicar('test.tareas', { secreto: 1 });
    const otro = tiempoReal.publicar('test.todos', { n: 1 });
    await a.hasta(e => e.id === otro);
    assert.equal(a.eventos.some(e => e.id === id), false, 'ya no le llega');
  } finally {
    sesion.sesionVigente = vigente;
    tiempoReal.configurar({ revisarSesionMs: AJUSTES_ANTES.revisarSesionMs });
    a.cerrar();
    await srv.cerrar();
  }
});

test('por HTTP: sin sesión 401, sin canales 400, sin ninguno permitido «fin»; el estado solo dice lo suyo', async () => {
  const srv = await servidor();
  try {
    assert.equal((await fetch(`${srv.url}/eventos?canales=test.todos`)).status, 401);
    assert.equal((await fetch(`${srv.url}/eventos`, { headers: { 'X-Yo': '25' } })).status, 400);
    const a = abrir(`${srv.url}/eventos?canales=test.tareas`, { yo: 25 });
    const fin = await a.hasta(e => e.event === 'fin');
    assert.deepEqual(JSON.parse(fin.data), { motivo: 'sin-canales' });
    a.cerrar();

    const mio = await (await fetch(`${srv.url}/api/estado`, { headers: { 'X-Yo': '25' } })).json();
    assert.deepEqual(Object.keys(mio).sort(), ['mias', 'status']);
    const dev = await (await fetch(`${srv.url}/api/estado`, { headers: { 'X-Yo': '26', 'X-Rol': 'desarrollador' } })).json();
    assert.ok('conexiones' in dev && 'porCanal' in dev);

    // El banco: solo el desarrollador se manda avisos, y solo a sí mismo.
    const nada = await fetch(`${srv.url}/api/probar`, { method: 'POST', headers: { 'X-Yo': '25' } });
    assert.equal(nada.status, 403);
  } finally {
    await srv.cerrar();
  }
});
