// ============================================================
// LOS FICHEROS Y LOS GIF DEL TABLERO (db/270, 18/11/2026)
// ============================================================
// Camilo: «que en cada tarea también se puedan adjuntar archivos, lo que sea:
// imágenes, vídeos, Word, Excel, etc., hasta GIFs en los comentarios».
//
//   · los ficheros de la tarjeta: quien la ve los sube; no en una rechazada ni
//     anulada; quien no la ve no los ve;
//   · un comentario puede llevar solo un fichero o un GIF (sin texto); los
//     ficheros van del borrador de quien escribe al comentario; sin texto ni
//     ficheros, no sale; de otra persona, no se puede traer;
//   · quitar un comentario quita sus ficheros de la vista.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tablero = require('../services/tablero');
const adjuntos = require('../services/adjuntos');

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

let n = 0;
/** Un fichero ya subido al borrador de alguien (la fila; los bytes no hacen falta aquí). */
async function ficheroEnBorrador(consulta, usuarioId, nombre = 'ticket.jpg', mime = 'image/jpeg') {
  const borrador = `${usuarioId}-${(++n).toString(16).padStart(8, '0')}abcdef`;
  await consulta(
    `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256, creado_por)
     VALUES ('tarea_borrador', $1, 'disco', $2, $3, $4, 1234, $5, $6)`,
    [borrador, `pruebas/tablero/${borrador}`, nombre, mime, 'a'.repeat(64), usuarioId]);
  return borrador;
}

test('un comentario puede ir solo con un GIF o un fichero; los ficheros pasan del borrador al comentario', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.laura, { titulo: 'Revisar el taller', responsableId: p.diana, plazoDias: 3 });
  await tablero.aprobar(p.ignacio, t.id, {});

  // Sin texto ni ficheros, no sale.
  await assert.rejects(tablero.comentar(p.diana, t.id, { texto: '' }), /Escribe el comentario o adjunta algo/);
  // Un borrador que no es suyo, no.
  const ajeno = await ficheroEnBorrador(h.consulta, p.laura);
  await assert.rejects(tablero.comentar(p.diana, t.id, { texto: 'hola', borrador: ajeno }), e => e.status === 403);
  // Un borrador suyo sin ficheros, con texto: sale solo el texto.
  const vacio = `${p.diana}-000000000000000000000000`;
  const solo = await tablero.comentar(p.diana, t.id, { texto: 'Sin nada', borrador: vacio });
  assert.deepEqual(solo.comentariosLista.map(c => [c.texto, c.adjuntos.length]), [['Sin nada', 0]]);

  // Un GIF (un fichero de imagen) y nada de texto: sale, con su imagen.
  const suyo = await ficheroEnBorrador(h.consulta, p.diana, 'risa.gif', 'image/gif');
  const r = await tablero.comentar(p.diana, t.id, { texto: '', borrador: suyo });
  const comentario = r.comentariosLista.find(c => !c.texto);
  assert.ok(comentario, 'el comentario sin texto sale');
  assert.equal(comentario.adjuntos.length, 1);
  assert.deepEqual([comentario.adjuntos[0].nombre, comentario.adjuntos[0].clase], ['risa.gif', 'imagen']);
  const fila = (await h.consulta(`SELECT con_adjuntos FROM tarea_comentario WHERE id = $1`, [comentario.id])).rows[0];
  assert.equal(fila.con_adjuntos, true, 'se marca que lleva ficheros');
  const ya = (await h.consulta(`SELECT dueno_tipo, dueno_id FROM adjunto WHERE ruta = $1`, [`pruebas/tablero/${suyo}`])).rows[0];
  assert.deepEqual([ya.dueno_tipo, ya.dueno_id], ['tarea_comentario', String(comentario.id)], 'pasa del borrador al comentario');
  // Ya no queda nada en el borrador: un segundo comentario con el mismo no lleva nada.
  const otra = await tablero.comentar(p.diana, t.id, { texto: 'Otro', borrador: suyo });
  assert.equal(otra.comentariosLista.find(c => c.texto === 'Otro').adjuntos.length, 0);
}));

test('los ficheros de la tarjeta: los sube quien la ve, no en una rechazada; quien no la ve no los ve', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.laura, { titulo: 'Contrato del proveedor', responsableId: p.diana, plazoDias: 3 });
  await tablero.aprobar(p.ignacio, t.id, {});
  // La ficha enseña si puede adjuntar.
  assert.equal((await tablero.ficha(p.diana, t.id)).puede.adjuntar, true);
  assert.equal((await tablero.ficha(p.laura, t.id)).puede.adjuntar, true, 'quien la pidió también');
  // Quien no la ve, ni la ficha ni sus ficheros.
  await assert.rejects(tablero.ficha(p.otra, t.id), e => e.status === 404);
  await assert.rejects(adjuntos.lista('tarea', t.id, { id: p.otra }), e => e.status === 403);
  // Un fichero de la tarjeta: lo ve quien la ve y sale en su ficha.
  await h.consulta(
    `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256, creado_por)
     VALUES ('tarea', $1, 'disco', 'pruebas/tablero/tarea-1', 'contrato.pdf', 'application/pdf', 900, $2, $3)`,
    [String(t.id), 'b'.repeat(64), p.laura]);
  const f = await tablero.ficha(p.diana, t.id);
  assert.deepEqual(f.adjuntos.map(a => [a.nombre, a.clase]), [['contrato.pdf', 'pdf']]);
  assert.equal(f.yo, p.diana, 'la ficha dice quién mira, para el borrador');
  // Una rechazada no admite ficheros: se rechaza una que espera aprobación.
  const t2 = await tablero.crear(p.laura, { titulo: 'Propuesta duplicada', responsableId: p.diana, plazoDias: 3 });
  await tablero.rechazar(p.ignacio, t2.id, { motivo: 'Duplicada' });
  assert.equal((await tablero.ficha(p.ignacio, t2.id)).puede.adjuntar, false, 'una rechazada no admite ficheros');
  await assert.rejects(adjuntos.exigirAdjuntar('tarea', t2.id, { id: p.laura, rol: 'oficina' }), e => e.status === 403);
}));

test('quitar un comentario quita sus ficheros de la vista; un GIF de otra persona, no se trae', () => conBase(async h => {
  const p = await gente(h);
  const t = await tablero.crear(p.laura, { titulo: 'Foto del siniestro', responsableId: p.diana, plazoDias: 3 });
  await tablero.aprobar(p.ignacio, t.id, {});
  const b = await ficheroEnBorrador(h.consulta, p.diana, 'choque.jpg');
  const r = await tablero.comentar(p.diana, t.id, { texto: 'Así quedó', borrador: b });
  const c = r.comentariosLista[0];
  assert.equal(c.adjuntos.length, 1);
  // Lo ve quien ve la tarjeta.
  assert.equal(await adjuntos.lista('tarea_comentario', c.id, { id: p.laura }).then(x => x.length), 1);
  // Quitarlo: se quita el comentario y, con él, sus ficheros.
  await tablero.anularComentario(p.diana, c.id, { motivo: 'Me equivoqué' });
  const despues = await tablero.ficha(p.diana, t.id);
  assert.equal(despues.comentariosLista.length, 0);
  await assert.rejects(adjuntos.lista('tarea_comentario', c.id, { id: p.laura }), e => e.status === 403, 'anulado, no se ve');

  // Traer un GIF al borrador de otra persona: no.
  await assert.rejects(tablero.gifABorrador(p.laura, { gifId: 'x', borrador: `${p.diana}-000000000000000000000000` }), e => e.status === 403);
}));
