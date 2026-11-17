// ============================================================
// EL TABLERO DE TAREAS (ítem 1, entrega 1a, db/251)
// ============================================================
// Una prueba por cada cosa que decidieron Camilo e Ignacio el 16/11/2026:
//   1. La tarea a mano espera la aprobación de Ignacio; el plazo cuenta al aprobarla.
//   2. Cada ticket nuevo crea su tarjeta «por asignar»; responsable y plazo, a mano.
//   3. Cerrar no pide aprobación (pasado el plazo, con motivo de demora).
//   + reasignar con motivo, quién ve qué, la historia intocable, el aviso de vencida.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const push = require('../services/notificacionesPush');
const tablero = require('../services/tablero');
const calendario = require('../services/calendario');
const contadores = require('../services/contadores');
const ticketera = require('../modules/Ticketera/ticketera.service');
const tarjetas = require('../modules/Ticketera/tarjetas');

// Las notificaciones, apuntadas en vez de mandadas.
let enviadas = [];
const enviar = push.enviar;
beforeEach(() => { enviadas = []; push.enviar = async (ids, aviso) => { enviadas.push({ ids: [...ids].sort((a, b) => a - b), ...aviso }); return {}; }; });
afterEach(() => { push.enviar = enviar; contadores.olvidar(); });

async function gente({ fabrica, consulta }) {
  const ignacio = await fabrica.usuario({ nombre: 'Ignacio' });
  const laura = await fabrica.usuario({ nombre: 'Laura' });
  const diana = await fabrica.usuario({ nombre: 'Diana' });
  const otra = await fabrica.usuario({ nombre: 'Otra' });
  for (const f of ['tareas_aprueba', 'tareas_asigna']) {
    await consulta('INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, $2, FALSE, $1)', [ignacio.id, f]);
  }
  return { ignacio: ignacio.id, laura: laura.id, diana: diana.id, otra: otra.id };
}

async function ticket(consulta, { subtipo = 'INCIDENCIA_NOMINA', nombre = 'Luis Pérez', estado = 'pendiente' } = {}) {
  const n = Math.floor(Math.random() * 1e6);
  const r = await consulta(
    `INSERT INTO ticket (codigo, origen, area_codigo, subtipo_codigo, nombre, descripcion, estado)
     VALUES ($1, 'soporte', 'RRHH', $2, $3, 'Me falta un día en la nómina', $4) RETURNING id, codigo`,
    [`RH-T-${n}`, subtipo, nombre, estado]);
  return { id: Number(r.rows[0].id), codigo: r.rows[0].codigo };
}

test('1. la tarea a mano espera la aprobación de Ignacio, y el plazo cuenta desde que la aprueba', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.laura, { titulo: 'Revisar las J de octubre', responsableId: p.diana, plazoDias: 3 });
  assert.equal(t.estado, 'por_aprobar');
  assert.equal(t.plazo.venceEl, null, 'por aprobar, el plazo aún no corre');
  assert.deepEqual(enviadas.map(e => [e.ids, e.titulo]), [[[p.ignacio], 'Tarea por aprobar']], 'se le notifica a Ignacio');
  assert.ok((await tablero.listar(p.ignacio, { vista: 'mias' })).some(x => x.id === t.id), 'y la tiene en «Mi tablero», por aprobar');
  assert.equal((await tablero.listar(p.diana, { vista: 'mias' })).some(x => x.id === t.id), true, 'la lleva Diana: también la ve');
  assert.equal((await tablero.listar(p.otra, { vista: 'mias' })).some(x => x.id === t.id), false, 'a otra persona, no');

  await assert.rejects(tablero.aprobar(p.diana, t.id, {}), e => e.status === 403, 'solo quien tiene la función');
  enviadas = [];
  const a = await tablero.aprobar(p.ignacio, t.id, {});
  const cal = await calendario.de('madrid');
  assert.equal(a.estado, 'por_hacer');
  assert.equal(a.plazo.venceEl, cal.sumarDiasHabiles(calendario.hoy(), 3), '3 días hábiles desde hoy, que la aprueba');
  assert.deepEqual(enviadas[0].ids, [p.laura, p.diana].sort((x, y) => x - y), 'a quien la lleva y a quien la pidió');

  // Rechazar pide motivo y avisa a quien la pidió.
  const t2 = await tablero.crear(p.laura, { titulo: 'Otra cosa', responsableId: p.laura, plazoDias: 1 });
  await assert.rejects(tablero.rechazar(p.ignacio, t2.id, { motivo: '' }), /por qué/);
  enviadas = [];
  const r = await tablero.rechazar(p.ignacio, t2.id, { motivo: 'No es una tarea, es una duda' });
  assert.equal(r.estado, 'rechazada');
  assert.deepEqual(enviadas[0].ids, [p.laura]);

  // La que crea quien aprueba no espera a nadie.
  const t3 = await tablero.crear(p.ignacio, { titulo: 'Preparar el cierre', responsableId: p.laura, venceEl: cal.sumarDiasHabiles(calendario.hoy(), 5) });
  assert.equal(t3.estado, 'por_hacer');
  assert.ok(t3.plazo.semaforo, 'con su semáforo');
}));

test('2. cada ticket nuevo crea su tarjeta «por asignar»; Ignacio pone responsable y plazo, y el ticket pasa a esa persona', () => conBase(async h => {
  const p = await gente(h);
  const tk = await ticket(h.consulta);
  assert.equal(await tarjetas.deNuevos(), 1);
  assert.equal(await tarjetas.deNuevos(), 0, 'una sola tarjeta por ticket');
  const [card] = await tablero.listar(p.ignacio, { vista: 'pendientes' });
  assert.deepEqual([card.tipo, card.estado, card.titulo], ['ticket', 'por_asignar', `Incidencia de nómina · Luis Pérez · ${tk.codigo}`]);
  assert.equal(card.enlace, `/ticketera?ticket=${encodeURIComponent(tk.codigo)}`);

  await assert.rejects(tablero.asignar(p.laura, card.id, { responsableId: p.diana, plazoDias: 2 }), e => e.status === 404, 'ni la ve: no reparte');
  await assert.rejects(tablero.asignar(p.ignacio, card.id, { responsableId: p.diana }), /Falta el plazo/, 'el plazo es obligatorio');
  enviadas = [];
  const a = await tablero.asignar(p.ignacio, card.id, { responsableId: p.diana, plazoDias: 2 });
  assert.deepEqual([a.estado, a.responsable.id], ['por_hacer', p.diana]);
  assert.deepEqual(enviadas.map(e => [e.ids, e.titulo]), [[[p.diana], 'Te han asignado una tarea']]);
  const t = (await h.consulta('SELECT responsable_id, estado FROM ticket WHERE id = $1', [tk.id])).rows[0];
  assert.deepEqual([t.responsable_id, t.estado], [p.diana, 'en_curso'], 'el ticket, a cargo de esa persona');
}));

test('2b. cerrar el ticket en su bandeja cierra la tarjeta, y cerrar la tarjeta cierra el ticket', () => conBase(async h => {
  const p = await gente(h);
  const a = await ticket(h.consulta);
  const b = await ticket(h.consulta);
  await tarjetas.deNuevos();

  // En la bandeja: la tarjeta (aún por asignar) se cierra sola.
  await ticketera.cambiarEstado(a.id, { estado: 'ejecutado', resolucion: 'Pagado en la de noviembre' }, { usuarioId: p.laura, nombre: 'Laura' });
  const ca = (await h.consulta(`SELECT estado, cierre_nota FROM tarea WHERE tipo = 'ticket' AND origen_id = $1`, [String(a.id)])).rows[0];
  assert.deepEqual([ca.estado, ca.cierre_nota], ['cerrada', 'Ticket ejecutado: Pagado en la de noviembre']);

  // En el tablero: cierra el ticket, con sus reglas (en qué quedó).
  const cb = (await tablero.listar(p.ignacio, { vista: 'pendientes' })).find(x => x.origenId === String(b.id));
  await tablero.asignar(p.ignacio, cb.id, { responsableId: p.diana, plazoDias: 2 });
  await assert.rejects(tablero.cerrar(p.diana, cb.id, { nota: '' }), /en qué quedó/);
  const cerrada = await tablero.cerrar(p.diana, cb.id, { nota: 'Corregido en la nómina' });
  assert.equal(cerrada.estado, 'cerrada');
  const tb = (await h.consulta('SELECT estado, resolucion FROM ticket WHERE id = $1', [b.id])).rows[0];
  assert.deepEqual([tb.estado, tb.resolucion], ['ejecutado', 'Corregido en la nómina']);
}));

test('2c. «me hago cargo» en la bandeja le pasa la tarjeta; una baja médica no lleva nombre; los tickets de antes, no', () => conBase(async h => {
  const p = await gente(h);
  // Pedido antes del corte de las bandejas (24/09/2026): se queda en la ticketera (1c).
  const viejo = await ticket(h.consulta);
  await h.consulta(`UPDATE ticket SET creado_at = '2026-09-01 10:00+02', marca_form = NULL WHERE id = $1`, [viejo.id]);
  const baja = await ticket(h.consulta, { subtipo: 'BAJA_AUSENCIA', nombre: 'Ana Ruiz' });
  assert.equal(await tarjetas.deNuevos(), 1, 'el de antes del corte no crea tarjeta');
  const [card] = await tablero.listar(p.ignacio, { vista: 'pendientes' });
  assert.equal(card.titulo, `Baja o ausencia · ${baja.codigo}`, 'sin el nombre');
  assert.equal(card.sensible, true);

  await ticketera.asignar(baja.id, { responsable: 'Laura' }, { usuarioId: p.laura, nombre: 'Laura' });
  const ficha = await tablero.ficha(p.ignacio, card.id);
  assert.deepEqual([ficha.estado, ficha.responsable.id, ficha.plazo.venceEl], ['por_hacer', p.laura, null], 'sin plazo: lo pone Ignacio');
}));

test('3. cerrar no pide aprobación; pasado el plazo hay que decir por qué; las de las colas no se cierran a mano', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.ignacio, { titulo: 'Llamar a la gestoría', responsableId: p.laura, plazoDias: 0 });
  // Que venciera ayer.
  await h.consulta(`UPDATE tarea SET vence_el = $2::date WHERE id = $1`, [t.id, calendario.sumarDias(calendario.hoy(), -1)]);
  await assert.rejects(tablero.cerrar(p.laura, t.id, { nota: 'Hecho' }), /motivo de demora/);
  const c = await tablero.cerrar(p.laura, t.id, { nota: 'Hecho', motivoDemora: 'La gestoría no contestaba' });
  assert.deepEqual([c.estado, c.motivoDemora], ['cerrada', 'La gestoría no contestaba']);

  tablero.registrarTipo('test_cola', { etiqueta: 'Cola de prueba', cierreManual: false });
  const id = await h.consulta(`INSERT INTO tarea (tipo, titulo, estado, responsable_id) VALUES ('test_cola', 'Una J', 'por_hacer', $1) RETURNING id`, [p.laura]);
  await assert.rejects(tablero.cerrar(p.laura, Number(id.rows[0].id), { nota: 'Aprobada' }), e => e.status === 409 && /se cierra sola/.test(e.message));
}));

test('reasignar pide motivo y avisa a los dos; bloquear pide qué la bloquea; solo quien la lleva la mueve', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.ignacio, { titulo: 'Revisar contratos', responsableId: p.laura, plazoDias: 4 });
  await assert.rejects(tablero.reasignar(p.ignacio, t.id, { responsableId: p.diana, motivo: '' }), /por qué/);
  await assert.rejects(tablero.reasignar(p.laura, t.id, { responsableId: p.diana, motivo: 'Me voy de vacaciones' }), e => e.status === 403);
  enviadas = [];
  const r = await tablero.reasignar(p.ignacio, t.id, { responsableId: p.diana, motivo: 'Laura está de vacaciones' });
  assert.equal(r.responsable.id, p.diana);
  assert.deepEqual(enviadas[0].ids, [p.laura, p.diana].sort((x, y) => x - y));

  await assert.rejects(tablero.mover(p.laura, t.id, { estado: 'en_curso' }), e => e.status === 404, 'ya no la lleva: ni la ve');
  await assert.rejects(tablero.mover(p.diana, t.id, { estado: 'bloqueada' }), /qué la bloquea/);
  const b = await tablero.mover(p.diana, t.id, { estado: 'bloqueada', motivo: 'Falta el contrato firmado' });
  assert.deepEqual([b.estado, b.bloqueoMotivo], ['bloqueada', 'Falta el contrato firmado']);
  const historia = (await tablero.ficha(p.diana, t.id)).historia.map(e => e.tipo);
  assert.deepEqual(historia, ['creada', 'aprobada', 'reasignada', 'estado']);
}));

test('quién ve qué: lo suyo, lo de su gente si lleva un área, y todo quien reparte', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.ignacio, { titulo: 'Tarea de Laura', responsableId: p.laura, plazoDias: 2 });
  await assert.rejects(tablero.ficha(p.otra, t.id), e => e.status === 404, 'otra persona no la ve');
  assert.equal((await tablero.listar(p.otra, { vista: 'equipo' })).length, 0);
  // Diana lleva el área de Laura: la ve en su equipo.
  await h.consulta(`INSERT INTO cat_area (codigo, etiqueta, orden, activa, responsable_id) VALUES ('test_rrhh', 'RRHH de prueba', 99, TRUE, $1)`, [p.diana]);
  await h.consulta(`UPDATE usuario SET area_codigo = 'test_rrhh' WHERE id = $1`, [p.laura]);
  assert.deepEqual((await tablero.listar(p.diana, { vista: 'equipo' })).map(x => x.id), [t.id]);
  assert.ok((await tablero.listar(p.ignacio, { vista: 'equipo' })).some(x => x.id === t.id), 'quien reparte, todas');
  assert.deepEqual((await tablero.listar(p.laura, { vista: 'mias' })).map(x => x.id), [t.id]);
}));

test('la historia no se cambia ni se borra, y todo queda en el libro', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.laura, { titulo: 'Algo', responsableId: p.laura, plazoDias: 1 });
  // Cada intento en su punto de guardado: el error aborta la transacción de la prueba.
  for (const sql of [`UPDATE tarea_evento SET motivo = 'otro' WHERE tarea_id = $1`, 'DELETE FROM tarea_evento WHERE tarea_id = $1']) {
    await h.consulta('SAVEPOINT intento');
    await assert.rejects(h.consulta(sql, [t.id]), /no se cambia ni se borra/);
    await h.consulta('ROLLBACK TO SAVEPOINT intento');
  }
  const libro = require('../services/libro');
  const hist = await libro.historial('tarea', String(t.id));
  assert.ok(hist.length >= 1 && hist[0].accion === 'alta' && hist[0].origen === 'tablero');
}));

test('cada día hábil se avisa de las vencidas al responsable y a su superior, una sola vez', () => conBase(async h => {
  const p = await gente(h);
  await h.consulta('UPDATE usuario SET superior_id = $2 WHERE id = $1', [p.laura, p.diana]);
  const t = await tablero.crear(p.ignacio, { titulo: 'Mandar el informe', responsableId: p.laura, plazoDias: 1 });
  const cal = await calendario.de('madrid');
  const lunes = cal.habilEnODespues('2026-11-23');
  await h.consulta(`UPDATE tarea SET vence_el = $2::date WHERE id = $1`, [t.id, cal.restarDiasHabiles(lunes, 1)]);
  enviadas = [];
  const r = await h.consulta('SELECT 1').then(() => tablero.avisarVencidas({ periodo: lunes, cli: null }));
  assert.equal(r.vencidas, 1);
  assert.deepEqual(enviadas.map(e => [e.ids, e.titulo, e.urgente]), [[[p.laura, p.diana].sort((x, y) => x - y), 'Tarea vencida', true]]);
  assert.equal((await tablero.avisarVencidas({ periodo: lunes, cli: null })).vencidas, 0, 'una sola vez');
  assert.equal((await tablero.avisarVencidas({ periodo: '2026-11-22', cli: null })).saltada, 'no es hábil', 'domingo, nada');
}));

test('los números del menú: las suyas (en rojo si hay vencidas), y por aprobar y por asignar a quien le toca', () => conBase(async h => {
  const p = await gente(h);
  await tablero.crear(p.laura, { titulo: 'Pedida', responsableId: p.laura, plazoDias: 1 });
  const t = await tablero.crear(p.ignacio, { titulo: 'Suya', responsableId: p.laura, plazoDias: 1 });
  await h.consulta(`UPDATE tarea SET vence_el = $2::date WHERE id = $1`, [t.id, calendario.sumarDias(calendario.hoy(), -1)]);
  await ticket(h.consulta);
  await tarjetas.deNuevos();
  contadores.olvidar();
  const deLaura = await contadores.recuentos({ id: p.laura, rol: 'oficina', permisos: [] });
  assert.deepEqual([deLaura['tareas.mias'].n, deLaura['tareas.mias'].tono], [1, 'aviso']);
  assert.equal('tareas.por_aprobar' in deLaura, false);
  const deIgnacio = await contadores.recuentos({ id: p.ignacio, rol: 'oficina', permisos: [] });
  assert.deepEqual([deIgnacio['tareas.por_aprobar'].n, deIgnacio['tareas.por_asignar'].n], [1, 1]);
  // La entrada «Tablero» del menú: las suyas y lo que espera por él, en rojo si hay algo.
  assert.deepEqual([deLaura['tareas.menu'].n, deLaura['tareas.menu'].tono], [1, 'aviso']);
  assert.deepEqual([deIgnacio['tareas.menu'].n, deIgnacio['tareas.menu'].tono], [2, 'aviso']);
}));

test('la pantalla: quién soy en el tablero, y no se añade a nadie a una tarjeta que nadie lleva', () => conBase(async h => {
  const p = await gente(h);
  assert.deepEqual(await tablero.quienSoy(p.ignacio), { id: p.ignacio, aprueba: true, asigna: true, todos: true, equipo: 0 });
  const yoLaura = await tablero.quienSoy(p.laura);
  assert.deepEqual([yoLaura.aprueba, yoLaura.asigna, yoLaura.todos], [false, false, false]);
  await ticket(h.consulta);
  await tarjetas.deNuevos();
  const [card] = await tablero.listar(p.ignacio, { vista: 'pendientes' });
  assert.equal(card.puede.colaboradores, false, 'por asignar: aún no la lleva nadie');
  const t = await tablero.asignar(p.ignacio, card.id, { responsableId: p.laura, plazoDias: 2 });
  assert.equal(t.puede.colaboradores, true);
}));

test('por HTTP: la API responde con la tarjeta y los errores en JSON, sin enseñar los de la base', () => conBase(async h => {
  const p = await gente(h);
  const express = require('express');
  const app = express();
  let yo = p.laura;
  app.use(express.json());
  app.use((req, _res, next) => { req.usuario = { id: yo, rol: 'oficina' }; next(); });
  app.use('/tablero', require('../modules/Tablero/tablero.controller'));
  const s = await new Promise(ok => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  const base = `http://127.0.0.1:${s.address().port}/tablero/api`;
  const post = (ruta, cuerpo) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
  try {
    const r = await post('/tarjetas', { titulo: 'Desde la API', responsableId: p.diana, plazoDias: 2 });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.tarjeta.estado, 'por_aprobar');
    assert.equal((await post(`/tarjetas/${j.tarjeta.id}/aprobar`)).status, 403);
    yo = p.ignacio;
    assert.equal((await (await post(`/tarjetas/${j.tarjeta.id}/aprobar`)).json()).tarjeta.estado, 'por_hacer');
    const lista = await (await fetch(`${base}/tarjetas?vista=equipo`)).json();
    assert.ok(lista.tarjetas.some(x => x.id === j.tarjeta.id));
    assert.equal((await fetch(`${base}/tarjetas/999999999`)).status, 404);
    assert.ok((await (await fetch(`${base}/personas`)).json()).personas.some(x => x.id === p.laura));
  } finally {
    await new Promise(ok => { s.closeAllConnections(); s.close(ok); });
  }
}));
