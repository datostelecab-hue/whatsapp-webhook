// ============================================================
// PUERTAS POR MAPON DIRECTO, SIN APPS SCRIPT (23/11/2026)
// ============================================================
// «Vamos con la apertura y cierre de puertas de forma directa (…) hagámosla de
// una directo». La orden va del servidor a Mapon (unit_commands/execute) con el
// equipo de la matrícula y el comando de su catálogo. Mapon es de mentira: aquí
// no sale nada hacia ningún coche.
'use strict';

require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const mapon = require('../services/mapon');
const fichaje = require('../services/fichaje');
const otraSede = require('../services/otraSede');
const registro = require('../services/repo/puertas');
const puertas = require('../services/puertasBot');

// ── puertasBot: qué equipo, qué se apunta y qué se dice ─────────────────────
const reales = {};
let ordenes, apuntes, pedidas, respuestaMapon;
beforeEach(() => {
  ordenes = []; apuntes = []; pedidas = [];
  respuestaMapon = async o => ({ ok: true, status: 'ok', intentos: 1, command: o.command });
  reales.unidad = mapon.unidadPorMatricula; reales.seguro = mapon.ejecutarComandoSeguro; reales.conf = mapon.configurado;
  reales.disponible = fichaje.maponDisponible; reales.sede = otraSede.sedeDe; reales.registrar = registro.registrar;
  reales.fetch = global.fetch;
  // 1234ABC tiene dos equipos: 893954 (el bueno) y 898080 (el viejo).
  mapon.unidadPorMatricula = async (m, o = {}) => {
    pedidas.push({ m, actual: o.actual });
    if (m !== '1234ABC') return null;
    const usa = o.actual === '898080' ? '898080' : 893954;
    return { unitId: usa, matricula: '1234ABC', vehiculo: 'Toyota Corolla', otros: [usa === 893954 ? 898080 : 893954] };
  };
  mapon.ejecutarComandoSeguro = async o => { ordenes.push(o); return respuestaMapon(o); };
  mapon.configurado = () => true;
  fichaje.maponDisponible = () => true;
  otraSede.sedeDe = async () => 'madrid';
  registro.registrar = o => { apuntes.push(o); };
  global.fetch = async u => { throw new Error('No debería salir ninguna petición: ' + u); };
  puertas._filas.clear();
});
afterEach(() => {
  mapon.unidadPorMatricula = reales.unidad; mapon.ejecutarComandoSeguro = reales.seguro; mapon.configurado = reales.conf;
  fichaje.maponDisponible = reales.disponible; otraSede.sedeDe = reales.sede; registro.registrar = reales.registrar;
  global.fetch = reales.fetch;
});
const abre = extra => puertas.ejecutar({ telefono: '612345678', nombre: 'Prueba', matricula: '1234ABC', abrir: true, ...extra });
const respuesta = () => JSON.parse(apuntes.at(-1).respuesta);

test('a Mapon directo: el equipo de la matrícula, y se apunta el equipo USADO con lo que dijo Mapon', async () => {
  const r = await abre({ unitId: '' });
  assert.deepEqual([r.ok, r.motivo], [true, null]);
  assert.deepEqual(ordenes, [{ unitId: '893954', command: 'open_doors' }]);
  assert.equal(apuntes[0].unitId, '893954');
  assert.equal(apuntes[0].ok, true);
  assert.deepEqual([respuesta().via, respuesta().resultado, respuesta().mapon], ['mapon', 'aceptada', 'ok']);
});

test('el equipo del turno se respeta si es de esa matrícula; uno que no lo es, nunca recibe la orden', async () => {
  await abre({ unitId: '898080' });
  assert.equal(pedidas[0].actual, '898080', 'se le pasa a elegirEquipo como el que ya se usaba');
  assert.equal(ordenes[0].unitId, '898080');
  puertas._filas.clear();
  await abre({ unitId: '555555' });
  assert.equal(ordenes[1].unitId, '893954', 'el ajeno no: el de la matrícula');
  assert.equal(respuesta().pedidaAjena, true, 'y queda apuntado');
});

test('el doble toque: la misma orden en camino se comparte; ya contestada, vuelve a salir; la contraria espera su turno', async () => {
  // Mapon tarda: la primera sigue en camino cuando llega la segunda pulsada.
  let soltar; const lenta = new Promise(r => { soltar = r; });
  respuestaMapon = async o => { await lenta; return { ok: true, status: 'ok', intentos: 1, command: o.command }; };
  const p1 = abre(), p2 = abre();
  const cierre = puertas.ejecutar({ telefono: '612345678', matricula: '1234ABC', abrir: false });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(ordenes.map(o => o.command), ['open_doors'], 'la segunda no sale; la contraria espera en la fila');
  soltar();
  const [r1, r2] = await Promise.all([p1, p2]);
  await cierre;
  assert.deepEqual([r1.ok, r1.motivo, r2.ok, r2.motivo], [true, null, true, 'repetida']);
  assert.deepEqual(ordenes.map(o => o.command), ['open_doors', 'close_doors']);
  const compartida = apuntes.map(a => JSON.parse(a.respuesta)).find(x => x.repetida);
  assert.equal(compartida.resultado, 'misma-orden-en-camino', 'apuntada aparte, no como otra orden aceptada');
  // Ya contestada, volver a pulsar sí la manda (es lo que se le pide al conductor).
  respuestaMapon = async o => ({ ok: true, status: 'ok', intentos: 1, command: o.command });
  const r3 = await abre();
  assert.deepEqual([r3.ok, r3.motivo, ordenes.length], [true, null, 3]);
});

test('el doble toque sobre una orden que falla: los dos se enteran del fallo', async () => {
  let soltar; const lenta = new Promise(r => { soltar = r; });
  respuestaMapon = async () => { await lenta; return { ok: false, motivo: 'rechazada', status: 'failed' }; };
  const p1 = abre(), p2 = abre();
  await new Promise(r => setTimeout(r, 20));
  soltar();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual([r1.ok, r1.motivo, r2.ok, r2.motivo, ordenes.length], [false, 'rechazada', false, 'rechazada', 1]);
});

test('cada «no» con su motivo y su texto', async () => {
  const casos = [
    [async () => ({ ok: false, motivo: 'comando-no-disponible', disponibles: [] }), 'sin-comando', /no se puede abrir desde aquí/],
    [async () => ({ ok: false, motivo: 'rechazada', status: 'failed' }), 'rechazada', /no ha recibido la orden/],
    [async () => { throw Object.assign(new Error('x'), { codigo: 1010 }); }, 'no-llega', /no ha recibido la orden/],
    // La orden salió y no hubo respuesta (plazo vencido en el execute): no se sabe.
    [async () => { throw Object.assign(new Error('x'), { sinRespuesta: true, ordenEnVuelo: true }); }, 'sin-respuesta', /no sé si la orden/],
    // El plazo venció LEYENDO (catálogo o padrón): la orden no salió.
    [async () => { throw Object.assign(new Error('x'), { sinRespuesta: true }); }, 'no-enviada', /la orden de abrir no ha salido/],
    [async () => { throw Object.assign(new Error('x'), { codigo: 1011 }); }, 'saturado', /muchas órdenes/],
    [async () => { throw Object.assign(new Error('x'), { codigo: 1006 }); }, 'configuracion', /proveedor externo/],
  ];
  for (const [mapa, motivo, texto] of casos) {
    respuestaMapon = mapa;
    puertas._filas.clear();
    const r = await abre();
    assert.deepEqual([r.ok, r.motivo], [false, motivo], motivo);
    assert.match(puertas.textoFallo(r, true), texto, motivo);
    assert.equal(apuntes.at(-1).ok, false);
  }
  const resultados = apuntes.map(a => JSON.parse(a.respuesta));
  assert.equal(resultados[3].resultado, 'desconocida', 'sin respuesta: no se sabe si llegó');
  assert.equal(resultados[4].resultado, 'no-enviada-o-rechazada', 'sin poder leer: no salió');
  assert.equal(resultados[3].usada, '893954', 'el equipo usado va también cuando falla');
  assert.equal(puertas.emojiFallo({ motivo: 'sin-respuesta' }), '⚠️');
  assert.equal(puertas.emojiFallo({ motivo: 'rechazada' }), '❌');
});

test('sin equipo en Mapon, sin clave, con Mapon caído o de otra sede: no se manda nada', async () => {
  const sin = await puertas.ejecutar({ telefono: '612345678', matricula: '0000ZZZ', abrir: true });
  assert.equal(sin.motivo, 'sin-equipo');
  mapon.configurado = () => false;
  assert.equal((await abre()).motivo, 'configuracion');
  mapon.configurado = () => true;
  fichaje.maponDisponible = () => false;
  const caido = await abre();
  assert.deepEqual([caido.sinMapon, caido.motivo], [true, 'sin-mapon']);
  fichaje.maponDisponible = () => true;
  otraSede.sedeDe = async () => 'barcelona';
  const bcn = await abre();
  assert.deepEqual([bcn.ok, bcn.otraSede], [false, 'barcelona']);
  assert.equal(ordenes.length, 0);
});

// ── mapon.js: la respuesta tal y como la documenta Mapon ─────────────────────
// Contesta a cada petición con lo que diga `responder(url, opciones)`.
function falsoFetch(responder) {
  const llamadas = [];
  global.fetch = async (url, opciones = {}) => {
    llamadas.push({ url: String(url), metodo: opciones.method || 'GET' });
    const { cuerpo, estado = 200 } = await responder(String(url), opciones);
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    const r = { ok: estado < 400, status: estado, text: async () => texto, json: async () => JSON.parse(texto) };
    r.clone = () => r;
    return r;
  };
  return llamadas;
}

test('mapon: «failed» no es «ok», el catálogo va en caché y un 1011 se reintenta una vez', async () => {
  const unidad = 700001;
  let estado = 'ok', saturado = false;
  const llamadas = falsoFetch(url => {
    if (url.includes('get_available')) return { cuerpo: { data: ['open_doors', 'close_doors', 'hazard_lights'] } };
    if (saturado) { saturado = false; return { cuerpo: { error: { code: 1011, msg: 'Request limit reached' } } }; }
    return { cuerpo: { data: { status: estado } } };
  });
  mapon.olvidarCatalogo(unidad);
  const r1 = await reales.seguro({ unitId: unidad, command: 'open_doors' });
  const r2 = await reales.seguro({ unitId: unidad, command: 'close_doors' });
  assert.deepEqual([r1.ok, r2.ok], [true, true]);
  assert.equal(llamadas.filter(l => l.url.includes('get_available')).length, 1, 'el catálogo, una vez');
  estado = 'failed';
  const r3 = await reales.seguro({ unitId: unidad, command: 'open_doors' });
  assert.deepEqual([r3.ok, r3.motivo, r3.status], [false, 'rechazada', 'failed']);
  estado = 'ok'; saturado = true;
  const antes = llamadas.length;
  const r4 = await reales.seguro({ unitId: unidad, command: 'open_doors' });
  assert.deepEqual([r4.ok, r4.intentos, llamadas.length - antes], [true, 2, 2]);
  const r5 = await reales.seguro({ unitId: unidad, command: 'open_trunk' });
  assert.deepEqual([r5.ok, r5.motivo], [false, 'comando-no-disponible']);
  assert.equal(llamadas.filter(l => l.url.includes('get_available')).length, 2, 'si no está en la caché, se pregunta otra vez antes de decir que no');
});

test('mapon: un comando rechazado con 403 no da Mapon por caído (sí lo hace un error de cuenta)', async () => {
  const unidad = 700002;
  falsoFetch(url => (url.includes('get_available') ? { cuerpo: { data: ['open_doors'] } }
    : { cuerpo: { error: { code: 1006, msg: 'Method not available' } }, estado: 403 }));
  mapon.olvidarCatalogo(unidad);
  await assert.rejects(reales.seguro({ unitId: unidad, command: 'open_doors' }), e => e.codigo === 1006 && !e.ordenEnVuelo);
  assert.equal(mapon.disponible(), true);
});

test('mapon: un error sin código de Mapon con la orden ya mandada queda «en vuelo» (no se sabe si llegó)', async () => {
  const unidad = 700003;
  let respuestaOrden = { cuerpo: '<html>Bad gateway</html>', estado: 502 };
  falsoFetch(url => (url.includes('get_available') ? { cuerpo: { data: ['open_doors'] } } : respuestaOrden));
  mapon.olvidarCatalogo(unidad);
  await assert.rejects(reales.seguro({ unitId: unidad, command: 'open_doors' }), e => e.ordenEnVuelo === true);
  respuestaOrden = { cuerpo: { data: {} } };
  await assert.rejects(reales.seguro({ unitId: unidad, command: 'open_doors' }), e => e.ordenEnVuelo === true, 'sin estado tampoco es un «no»');
});
