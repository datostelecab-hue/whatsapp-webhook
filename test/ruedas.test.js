// ============================================================
// RUEDAS — cada 30.000 km, un cambio (db/265, 18/11/2026; 30.000 desde ese mismo día)
// ============================================================
// Camilo: «que cada 25K de KM se pase y avise, los KM de los últimos
// mantenimientos deben de sacarse de cambio de ruedas, hay unos de pinchazos en
// las facturas por los que esos no cuentan» y «que le llegue al chat de Óscar…
// "Notificaciones Telecab"».
//
//   · qué es un cambio de ruedas (una cubierta nueva; un pinchazo, no), el
//     último de cada coche y el semáforo, puros;
//   · con la base: el aviso por el chat al responsable de taller, una vez por
//     cambio, en el canal «Notificaciones Telecab».
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ruedas = require('../modules/Vehiculos/ruedas.service');
const chat = require('../modules/Chat/chat.service');
const contadores = require('../services/contadores');
const push = require('../services/notificacionesPush');

const enviar = push.enviar;
afterEach(() => { push.enviar = enviar; contadores.olvidar(); });

test('una cubierta nueva es un cambio de ruedas; un pinchazo, un reutilizado, la ecotasa o el equilibrado solos, no', () => {
  const si = ['CUB.205/55R16 91V SUNFULL SF-688M', 'Cub. doublestar 205/55R16 91V DH03', 'NEUMÁTICOS DELANTEROS 205/55R16 91V APTANI + MONTAJE'];
  const no = ['REPARACIÓN DE PINCHAZO NEUMÁTICO TRASERO DCHO.', 'Reparacion pinchazo rueda', 'REUTILIZADOS NEUMATICOS DELANTEROS',
    'GESTION ECOTASA RUEDA TURISMO', 'EQUILIBRADO Y MONTAJE RUEDA', 'IMPUESTO RETIRADA DE NEUMÁTICO', 'SESON DE PRESION DE RUEDA DELT IZQ CAIDO'];
  si.forEach(d => assert.equal(ruedas._esRuedaNueva(d), true, d));
  no.forEach(d => assert.equal(ruedas._esRuedaNueva(d), false, d));
});

test('el último cambio de cada coche, con sus ruedas; los pinchazos aparte, sin contar', () => {
  const m = (id, v, fecha, km, piezas, extra = {}) => ({ id, vehiculo_id: v, fecha, km, taller: 'iPark', referencia: `A${id}`, origen: 'factura', tipo: 'neumaticos', piezas, ...extra });
  const h = ruedas._historialRuedas([
    m(1, 7, '2026-05-10', 40000, [{ d: 'CUB.205/55R16 91V SUNFULL', c: '2' }, { d: 'EQUILIBRADO Y MONTAJE RUEDA', c: '2' }]),
    m(2, 7, '2026-08-01', 61000, [{ d: 'REPARACION PINCHAZO RUEDA', c: '1' }]),               // pinchazo: no cuenta
    m(3, 7, '2026-09-20', 70500, [{ d: 'Cub. doublestar 205/55R16', c: '4' }]),
    m(4, 9, '2026-07-01', null, [{ d: 'CUB.195/65R15 91V APTANY', c: '2' }]),                  // sin km
    m(5, 9, '2026-10-02', 33000, [], { origen: 'manual', descripcion: 'Cambio de ruedas (4 ruedas) · apuntado en Ruedas' }),
  ]);
  assert.deepEqual(h.get(7).cambios.map(c => [c.id, c.ruedas]), [[3, 4], [1, 2]], 'el más reciente primero, con sus ruedas');
  assert.deepEqual(h.get(7).pinchazos.map(c => c.id), [2], 'el pinchazo, aparte');
  assert.deepEqual(h.get(9).cambios.map(c => [c.id, c.ruedas, c.origen]), [[5, 4, 'manual'], [4, 2, 'factura']], 'el apuntado a mano también cuenta');
});

test('el semáforo: a los 30.000 km toca; desde el 85 % (o a 15 días al ritmo de ahora), a punto; sin cambio o sin km, sin dato', () => {
  const c = km => ({ id: 1, km, fecha: '2026-05-10' });
  assert.equal(ruedas.INTERVALO, 30000, 'Camilo, 18/11: «a los 30K km»');
  assert.deepEqual(ruedas._semaforo({ odometro: 71000, cambio: c(40000) }).estado, 'toca');
  assert.equal(ruedas._semaforo({ odometro: 71000, cambio: c(40000) }).restan, -1000);
  assert.equal(ruedas._semaforo({ odometro: 65000, cambio: c(40000) }).estado, 'ok', '25.000 km: con 30.000 aún no toca (con 25.000 tocaba), y es el 83 %');
  assert.equal(ruedas._semaforo({ odometro: 65500, cambio: c(40000) }).estado, 'pronto', '25.500 km: el 85 %');
  assert.equal(ruedas._semaforo({ odometro: 60000, cambio: c(40000), kmDia: 700 }).estado, 'pronto', 'le quedan 10.000 km: a 700 al día, 14 días');
  assert.equal(ruedas._semaforo({ odometro: 50000, cambio: c(40000), kmDia: 300 }).estado, 'ok');
  assert.deepEqual([ruedas._semaforo({ odometro: 50000, cambio: null }).estado, ruedas._semaforo({ odometro: 50000, cambio: null }).motivo], ['sin_dato', 'sin_cambio']);
  assert.equal(ruedas._semaforo({ odometro: 50000, cambio: c(null) }).motivo, 'cambio_sin_km');
  assert.equal(ruedas._semaforo({ odometro: 30000, cambio: c(40000) }).estado, 'revisar', 'el odómetro por debajo del cambio: dato imposible');
});

test('con la base: el aviso llega por el chat, en «Notificaciones Telecab», al responsable de taller; una vez por cambio', () => conBase(async ({ fabrica, consulta }) => {
  const notificados = [];
  push.enviar = async (ids, a) => { notificados.push({ ids: [...ids], titulo: a.titulo }); return {}; };
  const oscar = await fabrica.usuario({ rol: 'taller', nombre: 'Taller' });
  await consulta(`UPDATE usuario SET puesto_codigo = 'responsable_taller' WHERE id = $1`, [oscar.id]);
  const v = await fabrica.vehiculo();
  const fila = { id: v.id, matricula: v.matricula, vehiculo: 'Toyota Corolla', estado: 'toca', desde: 31300,
    cambio: { id: null, km: 40000, fecha: '2026-05-10', taller: 'iPark' } };

  const r = await ruedas.avisar({ filas: [fila] });
  await chat.esperarPendientes();
  assert.deepEqual([r.avisados, r.para], [1, 1]);
  const canal = (await consulta(`SELECT id, tipo, nombre FROM chat_canal WHERE nombre = 'notificaciones-telecab'`)).rows[0];
  assert.equal(canal.tipo, 'privado');
  const msj = (await consulta('SELECT autor_id, evento, texto FROM chat_mensaje WHERE canal_id = $1', [canal.id])).rows;
  assert.equal(msj.length, 1);
  assert.equal(msj[0].autor_id, null, 'lo firma el sistema');
  assert.equal(msj[0].evento, 'aviso');
  assert.match(msj[0].texto, new RegExp(`<@${oscar.id}> Ruedas: a un coche le toca cambiar las ruedas`));
  assert.match(msj[0].texto, new RegExp(`${v.matricula} \\(Toyota Corolla\\): lleva 31\\.300 km desde el último cambio \\(10/05/2026, 40\\.000 km, iPark\\)`));
  assert.deepEqual(notificados, [{ ids: [oscar.id], titulo: 'Notificaciones Telecab' }], 'le llega al móvil como «Notificaciones Telecab»');
  const lista = await chat.canales(oscar.id);
  assert.ok((lista.canales || lista).some(c => c.titulo === 'Notificaciones Telecab'), 'en su lista del chat se llama así');

  // Otra vuelta con el mismo cambio: no se repite.
  assert.equal((await ruedas.avisar({ filas: [fila] })).avisados, 0);
  // Sin responsable de taller, no se avisa a nadie (y no se apunta como avisado).
  await consulta(`UPDATE usuario SET puesto_codigo = NULL WHERE id = $1`, [oscar.id]);
  const otro = { ...fila, id: (await fabrica.vehiculo()).id };
  assert.deepEqual(await ruedas.avisar({ filas: [otro] }), { avisados: 0, sinResponsable: true });
}));
