// ============================================================
// EL CHAT INTERNO, ENTREGA 2b (ítem 2, db/257)
// ============================================================
// Lo que decidió Camilo el 17/11/2026 y lo que pide la hoja de ruta para la 2b:
//   · editar y anular lo propio sin motivo; lo de otro, quien lleva los canales
//     y con motivo; el texto queda en el libro;
//   · seis reacciones fijas; fijar, cualquiera del canal; guardar, cada uno;
//   · convertir en tarea como una tarea a mano (el primer criterio del ítem 1),
//     con su sello y la respuesta en el hilo al cerrarla;
//   · ficheros con el servicio de adjuntos; un mensaje puede ser solo ficheros;
//   · la vista previa de los enlaces, sin abrir la puerta a la red de dentro.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

// El almacén de disco, en una carpeta de este fichero de pruebas (antes de cargar nada).
process.env.ALMACEN = 'disco';
process.env.ALMACEN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telecab-chat-test-'));

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const chat = require('../modules/Chat/chat.service');
const contadores = require('../services/contadores');
const adjuntos = require('../services/adjuntos');
const enlaces = require('../services/enlaces');
const tablero = require('../services/tablero');
const push = require('../services/notificacionesPush');

const enviarPush = push.enviar;
beforeEach(() => { chat.olvidar(); chat.usarVistaPrevia(null); push.enviar = async () => ({}); });
afterEach(() => { contadores.olvidar(); push.enviar = enviarPush; });

async function oficina({ fabrica, consulta }) {
  const a = (await fabrica.usuario({ nombre: 'Ignacio' })).id;   // lleva los canales
  const b = (await fabrica.usuario({ nombre: 'Karen' })).id;
  const c = (await fabrica.usuario({ nombre: 'Laura' })).id;
  await consulta(`INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, 'chat_canales', FALSE, $1)`, [a]);
  const general = Number((await consulta(`SELECT id FROM chat_canal WHERE nombre = '1-general-telecab'`)).rows[0].id);
  for (const u of [a, b, c]) await chat.canales(u);
  return { a, b, c, general };
}
const enviar = (u, canal, texto, extra = {}) => chat.enviar(u, canal, { texto, ...extra }).then(r => r.mensaje);
const aTrozos = buf => Readable.from((function* () { yield buf; })());

test('editar y anular: lo propio, sin motivo; lo de otro, quien lleva los canales y con motivo; el texto queda en el libro', () => conBase(async h => {
  const p = await oficina(h);
  const m = await enviar(p.b, p.general, 'Mañana libro');
  await assert.rejects(chat.editar(p.c, m.id, { texto: 'Hackeado' }), e => e.status === 403, 'solo su autor lo edita');
  const e = (await chat.editar(p.b, m.id, { texto: 'Mañana no libro' })).mensaje;
  assert.deepEqual([e.texto, e.editado], ['Mañana no libro', true]);
  const libro = (await h.consulta(`SELECT cambios FROM auditoria WHERE tabla = 'chat_mensaje' AND registro = $1 AND accion = 'cambio'`, [String(m.id)])).rows;
  assert.deepEqual(libro.map(x => x.cambios.texto), [['Mañana libro', 'Mañana no libro']], 'lo de antes, en el libro');

  await assert.rejects(chat.anular(p.c, m.id, {}), e2 => e2.status === 403, 'Laura no lleva los canales');
  await assert.rejects(chat.anular(p.a, m.id, {}), e2 => e2.status === 400 && /por qué/.test(e2.message), 'lo de otro, con motivo');
  const an = (await chat.anular(p.a, m.id, { motivo: 'Datos personales' })).mensaje;
  assert.equal(an.texto, null, 'el texto ya no sale');
  assert.deepEqual(an.anulado, { porAutor: false, por: 'Ignacio De Prueba', motivo: 'Datos personales' });
  await assert.rejects(chat.editar(p.b, m.id, { texto: 'Otra vez' }), e2 => e2.status === 409);
  const fila = (await h.consulta('SELECT texto FROM chat_mensaje WHERE id = $1', [m.id])).rows[0];
  assert.equal(fila.texto, 'Mañana no libro', 'nada se borra');

  const m2 = await enviar(p.c, p.general, 'Me he equivocado de canal');
  const an2 = (await chat.anular(p.c, m2.id, {})).mensaje;
  assert.deepEqual(an2.anulado, { porAutor: true, por: 'Laura De Prueba', motivo: null }, 'lo propio, sin motivo y sin enseñarlo');
  await assert.rejects(chat.anular(p.c, m2.id, {}), e2 => e2.status === 409);
  const de = (await chat.canales(p.b)).canales.find(x => x.id === p.general);
  assert.equal(de.sinLeer, 0, 'lo anulado no cuenta como no leído');
}));

test('reacciones, fijar y guardar', () => conBase(async h => {
  const p = await oficina(h);
  const m = await enviar(p.a, p.general, 'Reunión a las 10');
  let r = (await chat.reaccionar(p.b, m.id, { emoji: 'ok' })).mensaje;
  assert.deepEqual(r.reacciones, [{ emoji: 'ok', n: 1, mia: true, nombres: ['Karen De Prueba'] }]);
  r = (await chat.reaccionar(p.c, m.id, { emoji: 'ok' })).mensaje;
  assert.equal(r.reacciones[0].n, 2);
  assert.equal((await chat.uno(p.a, m.id)).mensaje.reacciones[0].mia, false, 'la de otro no es mía');
  r = (await chat.reaccionar(p.b, m.id, { emoji: 'ok' })).mensaje;
  assert.deepEqual(r.reacciones.map(x => [x.emoji, x.n, x.mia]), [['ok', 1, false]], 'otra vez la quita');
  await assert.rejects(chat.reaccionar(p.b, m.id, { emoji: 'cohete' }), e => e.status === 400, 'solo las seis');

  const priv = await chat.crearCanal(p.a, { nombre: 'direccion', tipo: 'privado' });
  const mp = await enviar(p.a, priv.id, 'Solo para dirección');
  await assert.rejects(chat.reaccionar(p.b, mp.id, { emoji: 'ok' }), e => e.status === 404, 'a quien no está, ni existe');

  const f = (await chat.fijar(p.c, m.id, { fijar: true })).mensaje;
  assert.deepEqual(f.fijado, { por: 'Laura De Prueba' }, 'fija cualquiera del canal');
  assert.equal((await chat.ficha(p.b, p.general)).fijados, 1);
  assert.deepEqual((await chat.fijados(p.b, p.general)).mensajes.map(x => x.id), [m.id]);
  await assert.rejects(chat.fijar(p.b, m.id, { fijar: true }), e => e.status === 409, 'ya estaba fijado');
  await chat.fijar(p.b, m.id, { fijar: false });
  assert.equal((await chat.ficha(p.b, p.general)).fijados, 0);

  assert.equal((await chat.guardar(p.b, m.id, { guardar: true })).mensaje.guardado, true);
  assert.equal((await chat.uno(p.a, m.id)).mensaje.guardado, false, 'lo guardado es de cada uno');
  await chat.anadir(p.a, priv.id, { usuarioId: p.b });
  await chat.guardar(p.b, mp.id, { guardar: true });
  assert.deepEqual((await chat.guardados(p.b)).mensajes.map(x => [x.id, x.canal.nombre]), [[mp.id, 'direccion'], [m.id, '1-general-telecab']]);
  await chat.quitar(p.b, priv.id, { usuarioId: p.b });
  assert.deepEqual((await chat.guardados(p.b)).mensajes.map(x => x.id), [m.id], 'de un privado del que salió, ya no');
}));

test('convertir un mensaje en tarea: como una tarea a mano, con su sello y la respuesta en el hilo al cerrarla (ítem 1)', () => conBase(async h => {
  const p = await oficina(h);
  const jefe = (await h.fabrica.usuario({ nombre: 'Jefe' })).id;
  for (const f of ['tareas_aprueba', 'tareas_asigna']) {
    await h.consulta('INSERT INTO usuario_funcion (usuario_id, funcion, suplente, creado_por) VALUES ($1, $2, FALSE, $1)', [jefe, f]);
  }
  const m = await enviar(p.b, p.general, 'Hay que cambiar la rueda del 0101LTF');

  const r = await chat.convertirEnTarea(p.a, m.id, { titulo: 'Cambiar la rueda del 0101LTF', responsableId: p.c, plazoDias: 2 });
  assert.equal(r.tarea.estado, 'por_aprobar', 'quien la crea no aprueba: pasa por quien aprueba');
  const fila = (await h.consulta('SELECT tipo, origen_id, enlace, creada_por FROM tarea WHERE id = $1', [r.tarea.id])).rows[0];
  assert.deepEqual(fila, { tipo: 'mensaje', origen_id: String(m.id), enlace: `/chat?canal=${p.general}&mensaje=${m.id}`, creada_por: p.a });
  assert.deepEqual([r.mensaje.tarea.id, r.mensaje.tarea.estado, r.mensaje.tarea.responsable], [r.tarea.id, 'por_aprobar', 'Laura De Prueba'], 'el sello en el mensaje');
  await assert.rejects(chat.convertirEnTarea(p.b, m.id, { titulo: 'Otra', responsableId: p.c, plazoDias: 1 }), e => e.status === 409, 'una por mensaje');

  await tablero.aprobar(jefe, r.tarea.id, {});
  await tablero.cerrar(p.c, r.tarea.id, { nota: 'Rueda cambiada en el taller' });
  const t = (await h.consulta('SELECT estado, cerrada_por, cierre_nota FROM tarea WHERE id = $1', [r.tarea.id])).rows[0];
  assert.deepEqual(t, { estado: 'cerrada', cerrada_por: p.c, cierre_nota: 'Rueda cambiada en el taller' });
  const hilo = await chat.hilo(p.a, m.id);
  assert.equal(hilo.raiz.tarea.estado, 'cerrada');
  const resp = hilo.respuestas[0];
  assert.equal(resp.evento, 'tarea_cerrada');
  assert.equal(resp.autor, 'Telecab', 'la firma Telecab: quien la cierra puede no estar en el canal');
  assert.match(resp.texto, new RegExp(`^<@${p.a}> Tarea hecha: «Cambiar la rueda del 0101LTF», la cerró Laura De Prueba\\.\\nRueda cambiada en el taller$`));
  assert.equal((await chat.canales(p.a)).canales.find(x => x.id === p.general).menciones, 1, 'a quien la creó le llega como mención');
}));

test('los ficheros: se suben antes de mandar, el mensaje sale con ellos ya subidos y los ve quien ve el mensaje', () => conBase(async h => {
  const p = await oficina(h);
  const quien = id => ({ id, rol: 'oficina' });
  const subir = (u, borrador, nombre) => adjuntos.subir({ tipo: 'chat_borrador', duenoId: borrador, nombre, mime: 'application/pdf', cuerpo: aTrozos(Buffer.from(`%PDF-1.4 ${nombre}`)), quien: quien(u) });
  await assert.rejects(enviar(p.b, p.general, '   '), e => e.status === 400, 'vacío y sin ficheros, no');

  // El borrador es de quien escribe: nadie más sube ni ve en él.
  const bb = `${p.b}-a1b2c3d4e5f6`;
  await assert.rejects(subir(p.c, bb, 'x.pdf'), e => e.status === 403, 'en el borrador de otro, no');
  const a = await subir(p.b, bb, 'parte.pdf');
  await assert.rejects(adjuntos.lista('chat_borrador', bb, quien(p.c)), e => e.status === 403, 'lo de un borrador solo lo ve quien lo sube');
  const antes = (await chat.mensajes(p.c, p.general)).mensajes.length;
  assert.equal(antes, 0, 'mientras sube, no hay mensaje que ver');
  await assert.rejects(enviar(p.c, p.general, '', { borrador: bb }), e => e.status === 403, 'mandar los ficheros de otro, no');

  const m = await enviar(p.b, p.general, '', { borrador: bb });
  assert.equal(m.conAdjuntos, true, 'un mensaje puede ser solo ficheros');
  assert.deepEqual(m.adjuntos.map(x => [x.id, x.nombre, x.clase, x.url]), [[Number(a.id), 'parte.pdf', 'pdf', `/adjuntos/${a.id}/fichero`]], 'sale ya con ellos');
  assert.equal((await adjuntos.lista('chat_mensaje', String(m.id), quien(p.c))).length, 1, 'lo ve quien ve el canal');
  assert.deepEqual(await adjuntos.lista('chat_borrador', bb, quien(p.b)), [], 'y el borrador se queda vacío');
  await assert.rejects(enviar(p.b, p.general, '', { borrador: bb }), e => e.status === 400, 'ya mandados, no se mandan dos veces');
  await assert.rejects(adjuntos.subir({ tipo: 'chat_mensaje', duenoId: String(m.id), nombre: 'y.pdf', mime: 'application/pdf', cuerpo: aTrozos(Buffer.from('%PDF-1.4 y')), quien: quien(p.b) }),
    e => e.status === 403, 'a un mensaje ya mandado no se le suben más');

  const priv = await chat.crearCanal(p.a, { nombre: 'nominas-privado', tipo: 'privado' });
  const ba = `${p.a}-ffeeddccbbaa`;
  await subir(p.a, ba, 'n.pdf');
  const mp = await enviar(p.a, priv.id, 'La nómina', { borrador: ba });
  await assert.rejects(adjuntos.lista('chat_mensaje', String(mp.id), quien(p.b)), e => e.status === 403, 'de un privado, solo los de dentro');

  await chat.anular(p.b, m.id, {});
  await assert.rejects(adjuntos.servir(a.id, quien(p.c), {}), e => e.status === 403, 'anulado el mensaje, no se sirven sus ficheros');
  assert.deepEqual((await chat.uno(p.c, m.id)).mensaje.adjuntos, []);
}));

test('la vista previa de un enlace: solo de la red pública, y lo que se lee de la página', () => conBase(async () => {
  // Las direcciones que nunca se piden.
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe']) {
    assert.equal(enlaces.ipPermitida(ip), false, `${ip} es de dentro`);
  }
  for (const ip of ['8.8.8.8', '151.101.1.140', '2a00:1450:4003:80b::200e']) assert.equal(enlaces.ipPermitida(ip), true, `${ip} es pública`);
  for (const u of ['ftp://boe.es/x', 'http://localhost/admin', 'http://intranet/', 'https://user:clave@boe.es/', 'http://boe.es:8080/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'javascript:alert(1)']) {
    assert.throws(() => enlaces.urlValida(u), e => e.status === 400, `${u} no se pide`);
  }
  assert.equal(enlaces.urlValida('https://www.boe.es/buscar/doc.php?id=BOE-A-2026-1').host, 'www.boe.es');

  // Lo que se lee de la página.
  const html = `<html><head><meta charset="utf-8"><title>No este</title>
    <meta property="og:title" content="Convenio VTC &amp; Madrid &#8211; 2026">
    <meta name="description" content="La de siempre"><meta property="og:description" content='Texto «oficial»'>
    <meta property="og:site_name" content="BOE"></head><body>…</body></html>`;
  assert.deepEqual(enlaces.leerMetadatos(html, 'https://www.boe.es/x'), { titulo: 'Convenio VTC & Madrid – 2026', descripcion: 'Texto «oficial»', sitio: 'BOE' });
  assert.deepEqual(enlaces.leerMetadatos('<title> Solo\n título </title>', 'https://www.ejemplo.es/'), { titulo: 'Solo título', descripcion: '', sitio: 'ejemplo.es' });
  assert.equal(enlaces.aTexto(Buffer.from([0x45, 0x73, 0x70, 0x61, 0xf1, 0x61]), 'text/html; charset=ISO-8859-1'), 'España');

  // En el chat: se lee después de mandar, una vez, y no se pide lo de dentro.
  assert.equal(chat.primerEnlace('Mira http://192.168.1.10/panel y ya'), null);
  assert.equal(chat.primerEnlace('Mira https://www.boe.es/x, ¿vale?'), 'https://www.boe.es/x');
}));

test('la vista previa en un mensaje: llega por su cuenta y se pinta con el mensaje', () => conBase(async h => {
  const p = await oficina(h);
  const pedidas = [];
  chat.usarVistaPrevia(async url => { pedidas.push(url); return { url, titulo: 'Convenio VTC', descripcion: 'El BOE', sitio: 'BOE' }; });
  const m = await enviar(p.a, p.general, 'El convenio: https://www.boe.es/convenio');
  await chat.esperarPendientes();
  assert.deepEqual((await chat.uno(p.b, m.id)).mensaje.enlace, { url: 'https://www.boe.es/convenio', titulo: 'Convenio VTC', descripcion: 'El BOE', sitio: 'BOE' });
  await enviar(p.b, p.general, 'Otra vez https://www.boe.es/convenio');
  await chat.esperarPendientes();
  assert.deepEqual(pedidas, ['https://www.boe.es/convenio'], 'una vez por enlace');
  const local = await enviar(p.b, p.general, 'Esto no: http://localhost:3000/usuarios');
  await chat.esperarPendientes();
  assert.equal((await chat.uno(p.a, local.id)).mensaje.enlace, null);
  assert.equal(pedidas.length, 1, 'lo de dentro ni se pide');
}));
