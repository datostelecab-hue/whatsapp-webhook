// ============================================================
// EL ENVÍO A FIRMA (módulo 6, db/293, 25/11/2026)
// ============================================================
// Camilo: «Diana verá si se hace o no … esperará a que te mandemos a ti a
// enviar los documentos, pero a nombre de Diana … siempre debe de ser un
// humano». Plan Plus de YouTrust: la aplicación, sin API.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const firmas = require('../modules/RRHH/firmas.service');

test('la cola: Diana aprueba, el bot lo manda en su nombre, firmado; y el finiquito con él', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/firmas'), ($1, '/firmas/aprobar')`, [diana.id]);
  const D = { usuarioId: diana.id, rol: 'oficina' };
  const otro = { usuarioId: (await fabrica.usuario({ rol: 'superadmin', nombre: 'Sin' })).id, rol: 'superadmin' };
  const c = await fabrica.conductor({ nombre: 'FIRMA' });
  const pdf = async (tipo, id) => consulta(
    `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256)
     VALUES ($1::varchar, $2::varchar, 'r2', 'pruebas/' || $1::text || '/' || $2::text || '.pdf', 'doc.pdf', 'application/pdf', 10, repeat('a', 64))`, [tipo, String(id)]);

  // Prepararlo es de quien aprueba (ni el superadmin por su rol).
  await assert.rejects(firmas.crear({ conductorId: c.id, tipo: 'suspension' }, otro), /aprueba/);
  const { id } = await firmas.crear({ conductorId: c.id, tipo: 'suspension', titulo: 'Suspensión del 01/12' }, D);
  assert.equal((await consulta(`SELECT estado FROM tarea WHERE tipo = 'firma_aprobar' AND origen_id = $1`, [id])).rows[0].estado !== 'cerrada', true);

  // Sin PDF, sin email o sin móvil no se aprueba.
  await assert.rejects(firmas.aprobar(id, {}, D), /PDF/);
  await pdf('firma_envio', id);
  await assert.rejects(firmas.aprobar(id, {}, D), /email/);
  await consulta(`UPDATE conductor SET email = 'firma@ejemplo.test' WHERE id = $1`, [c.id]);
  await assert.rejects(firmas.aprobar(id, {}, D), /móvil/);
  await consulta(`INSERT INTO conductor_telefono (conductor_id, e164, origen, principal) VALUES ($1, '+34600111222', 'manual', TRUE)`, [c.id]);
  await firmas.aprobar(id, {}, D);
  let f = await firmas.ficha(id, D);
  assert.deepEqual([f.estado, f.firmante_email, f.firmante_movil, f.en_nombre_de_nombre], ['aprobado', 'firma@ejemplo.test', '+34600111222', 'Diana De Prueba']);

  // El bot: los pendientes, enviado (con el enlace del sobre), firmado.
  assert.ok((await firmas.delBot.pendientes()).some(x => x.id === id));
  const REF = 'b6cc0c96-2b4c-431b-8ca9-c7a965bc3896';
  await assert.rejects(firmas.delBot.enviado(id, { ref: '123' }), /número de la solicitud/);
  await firmas.delBot.enviado(id, { ref: REF });
  f = await firmas.ficha(id, D);
  assert.deepEqual([f.estado, f.enviado_por_nombre, f.proveedor_ref, f.proveedor_url],
    ['enviado', 'Bot telecab', REF, `https://yousign.app/auth/workspace/requests/${REF}`]);
  assert.ok((await firmas.delBot.enviados()).some(x => x.id === id && x.proveedor_ref === REF));
  assert.deepEqual(await firmas.delBot.sincronizar(id, { estado: 'ongoing' }), { sinCambios: true, youtrust: 'ongoing' }, 'en curso: no cambia');
  // Desde la pantalla, firmado solo con el PDF firmado; el bot, con el enlace.
  await assert.rejects(firmas.cerrar(id, { estado: 'firmado' }, D), /firmado/);
  await firmas.delBot.sincronizar(id, { estado: 'done', cuando: '2026-11-25T14:18:37+00:00' });
  f = await firmas.ficha(id, D);
  assert.equal(f.estado, 'firmado');
  assert.match(f.nota, /Firmado en YouTrust el 25\/11\/2026/);
  const quien = (await consulta(`SELECT u.email FROM auditoria a JOIN usuario u ON u.id = a.usuario_id
    WHERE a.tabla = 'firma_envio' AND a.registro = $1 ORDER BY a.id DESC LIMIT 1`, [id])).rows[0];
  assert.equal(quien && quien.email, 'bot@telecab.invalid', 'lo que hace el bot, al libro como Bot telecab');

  // Un finiquito aprobado entra solo en la cola, y al firmarse el finiquito queda firmado.
  const fq = (await consulta(`INSERT INTO finiquito (conductor_id, fecha_baja, tipo, resumen, estado)
    VALUES ($1, '2026-11-20', 'propia', '{}'::jsonb, 'enviado') RETURNING id::text AS id`, [c.id])).rows[0];
  const r = await firmas.desdeFiniquito({ id: fq.id, conductor_id: String(c.id), nombre: 'FIRMA', fecha_baja: '2026-11-20' });
  assert.ok(r && r.id);
  assert.equal(await firmas.desdeFiniquito({ id: fq.id, conductor_id: String(c.id), nombre: 'FIRMA', fecha_baja: '2026-11-20' }), null, 'no entra dos veces');
  await pdf('firma_envio', r.id);
  await firmas.aprobar(r.id, {}, D);
  await firmas.delBot.enviado(r.id, { ref: '00000000-0000-0000-0000-000000000456' });
  await pdf('firma_firmada', r.id);
  await firmas.cerrar(r.id, { estado: 'firmado' }, D);
  assert.equal((await consulta(`SELECT estado FROM finiquito WHERE id = $1`, [fq.id])).rows[0].estado, 'firmado');
}));
