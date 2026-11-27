// ============================================================
// LAS ALTAS QUE SE MANDAN AL CHAT (módulo 8, 27/11/2026)
// ============================================================
// Un PDF de alta en #2-altas-de-empresas confirma su alta en Gestoría › Altas y
// queda como su justificante; Telecab lo dice en el hilo. Datos de mentira.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const calendario = require('../services/calendario');
const adjuntos = require('../services/adjuntos');
require('../modules/Chat/chat.service');          // registra el dueño 'chat_mensaje'
const altas = require('../modules/Gestoria/altas.service');
const ac = require('../modules/Gestoria/altasChat.service');

test('el nombre del fichero y del texto, y a qué alta va', () => {
  assert.equal(ac.nombreDeFichero('2026 11 30 JOSE ANGEL HERRERA PIMENTEL - RYC.pdf'), 'JOSE ANGEL HERRERA PIMENTEL');
  assert.equal(ac.nombreDeFichero('2026-11-25_ ALTA SS_ CAMILO PEÑARANDA AZAD.pdf'), 'CAMILO PENARANDA AZAD');
  assert.equal(ac.nombreDeTexto('JOSE ANGEL HERRERA PIMENTEL/  ALTA/ TIBUS LUXURY/30/11/2026'), 'JOSE ANGEL HERRERA PIMENTEL');
  const altasSin = [
    { id: '1', fecha_alta: '2026-11-30', nombre: 'Herrera Pimentel, Jose Angel' },
    { id: '2', fecha_alta: '2026-11-27', nombre: 'Peñaranda Ventura, Jesus Fernando' },
  ];
  assert.equal(ac.elegir(altasSin, ['JOSE ANGEL HERRERA PIMENTEL'], '2026-11-27').id, '1');
  assert.equal(ac.elegir(altasSin, ['CAMILO PENARANDA AZAD'], '2026-11-23'), null, 'una palabra en común no basta');
  assert.equal(ac.elegir(altasSin, ['JOSE ANGEL HERRERA PIMENTEL'], '2026-10-01'), null, 'un PDF de hace meses no es de este contrato');
  assert.equal(ac.elegir([...altasSin, { id: '3', fecha_alta: '2026-11-30', nombre: 'Herrera Pimentel, Jose Angel' }],
    ['JOSE ANGEL HERRERA PIMENTEL'], '2026-11-27'), null, 'dos iguales: no se adivina');
});

test('con la base: el PDF del chat confirma el alta, queda como justificante y Telecab lo dice en el hilo', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  for (const k of ['/gestoria', '/gestoria/gestionar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [diana.id, k]);
  const entra = calendario.sumarDias(calendario.hoy(), 3);
  const c = await fabrica.conductor({ nombre: 'JOSE ANGEL', apellidos: 'HERRERA PIMENTEL', alta: entra });
  const { filas } = await altas.lista({ usuarioId: diana.id, rol: 'oficina' });
  const alta = filas.find(f => f.conductor_id === String(c.id));
  assert.equal(alta.estado, 'pendiente');

  const canal = ((await consulta(`SELECT id FROM chat_canal WHERE nombre = $1`, [ac.CANAL])).rows[0]
    || (await consulta(`INSERT INTO chat_canal (tipo, nombre) VALUES ('publico', $1) RETURNING id`, [ac.CANAL])).rows[0]).id;
  const fecha = entra.split('-').join(' ');
  const msj = (await consulta(`INSERT INTO chat_mensaje (canal_id, autor_id, texto, con_adjuntos) VALUES ($1, $2, $3, true) RETURNING id`,
    [canal, diana.id, `JOSE ANGEL HERRERA PIMENTEL/  ALTA/ TIBUS LUXURY/${entra.split('-').reverse().join('/')}`])).rows[0].id;
  await adjuntos.subirDelSistema({ tipo: 'chat_mensaje', duenoId: String(msj), nombre: `${fecha} JOSE ANGEL HERRERA PIMENTEL - RYC.pdf`,
    mime: 'application/pdf', cuerpo: Readable.from(Buffer.from('%PDF-1.4 alta de prueba')), firmante: null, origen: 'prueba' });

  const r = await ac.procesarMensaje(String(msj), { contestar: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].alta, alta.id);
  const f = await altas.ficha(alta.id, { usuarioId: diana.id, rol: 'oficina' });
  assert.equal(f.estado, 'confirmada');
  assert.equal((await adjuntos.bytesDe('alta_gestoria', alta.id)).length, 1, 'el PDF, como su justificante');
  const resp = (await consulta(`SELECT texto, autor_id, evento FROM chat_mensaje WHERE padre_id = $1`, [msj])).rows;
  assert.equal(resp.length, 1);
  assert.equal(resp[0].autor_id, null);
  assert.match(resp[0].texto, /Alta confirmada en Gestoría › Altas: HERRERA PIMENTEL, JOSE ANGEL/);

  // Otra vuelta no hace nada: el PDF ya es su justificante.
  assert.equal((await ac.procesarMensaje(String(msj))).length, 0);
  assert.equal((await ac.repasar()).confirmadas, 0);
}));
