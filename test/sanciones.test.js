// ============================================================
// FALTAS Y SANCIONES (módulo 3, db/295, 25/11/2026)
// ============================================================
// Camilo: la abre la oficina, la aprueban Ángel, William o Ignacio, Diana
// manda la carta; el ERP propone y una persona decide; la carta con plantilla;
// la suspensión entra en el planificador al firmarse (o no firmarla, o caducar).
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const sanciones = require('../modules/RRHH/sanciones.service');
const firmas = require('../modules/RRHH/firmas.service');
const calendario = require('../services/calendario');

const REF = 'b6cc0c96-2b4c-431b-8ca9-c7a965bc3896';

async function gente({ consulta, fabrica }) {
  const jefe = await fabrica.usuario({ rol: 'oficina', nombre: 'Jefe' });
  const diana = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES
    ($1, '/disciplina'), ($1, '/disciplina/abrir'), ($1, '/disciplina/aprobar'),
    ($2, '/disciplina'), ($2, '/disciplina/abrir'), ($2, '/disciplina/carta'), ($2, '/firmas'), ($2, '/firmas/aprobar')`, [jefe.id, diana.id]);
  const c = await fabrica.conductor({ nombre: 'SANCION' });
  await consulta(`UPDATE conductor SET email = 'sancion@ejemplo.test' WHERE id = $1`, [c.id]);
  await consulta(`INSERT INTO conductor_telefono (conductor_id, e164, origen, principal) VALUES ($1, '+34600111333', 'manual', TRUE)`, [c.id]);
  return { J: { usuarioId: jefe.id, rol: 'oficina' }, D: { usuarioId: diana.id, rol: 'oficina' }, c };
}

test('a mano: se abre, se aprueba en la horquilla, la carta a Firmas y, firmada, la suspensión a su ficha', () => conBase(async (base) => {
  const { consulta } = base;
  const { J, D, c } = await gente(base);
  const otro = { usuarioId: (await base.fabrica.usuario({ rol: 'superadmin', nombre: 'Sin' })).id, rol: 'superadmin' };
  const hoy = calendario.hoy();
  const datos = { conductorId: c.id, regla: 'DAMAGE', fechaHechos: hoy, hechos: 'Golpeó el retrovisor contra una columna del garaje y no lo comunicó.' };

  await assert.rejects(sanciones.crear(datos, otro), /abrir/, 'ni el superadmin por su rol');
  await assert.rejects(sanciones.crear({ ...datos, hechos: 'corto' }, J), /qué pasó/);
  const { id } = await sanciones.crear(datos, J);
  let s = await sanciones.ficha(id, J);
  assert.deepEqual([s.estado, s.gravedad, s.articulo], ['abierta', 'GRAVE', 'Art. 39.2.q']);
  assert.ok((await consulta(`SELECT 1 FROM tarea WHERE tipo = 'sancion_aprobar' AND origen_id = $1 AND estado <> 'cerrada'`, [id])).rows.length);

  // La horquilla: una grave no se queda en amonestación, y va de 3 a 30 días.
  await assert.rejects(sanciones.aprobar(id, { medida: 'suspension', dias: 5 }, D), /aprobar/, 'Diana no aprueba');
  await assert.rejects(sanciones.aprobar(id, { medida: 'amonestacion' }, J), /amonestación/);
  await assert.rejects(sanciones.aprobar(id, { medida: 'suspension', dias: 2 }, J), /de 3 a 30/);
  const a = await sanciones.aprobar(id, { medida: 'suspension', dias: 5 }, J);
  assert.equal(a.estado, 'aprobada');
  assert.ok(a.comunicarAntes > hoy, 'el plazo para comunicarla');
  assert.ok((await consulta(`SELECT 1 FROM tarea WHERE tipo = 'sancion_carta' AND origen_id = $1 AND estado <> 'cerrada'`, [id])).rows.length);

  // La carta: con las fechas de la suspensión; entra en Firmas y Diana la aprueba a la vez.
  const desde = calendario.sumarDias(hoy, 3), hasta = calendario.sumarDias(hoy, 7);
  await assert.rejects(sanciones.mandarAFirma(id, {}, J), /carta/, 'la carta es de Diana');
  await assert.rejects(sanciones.mandarAFirma(id, {}, D), /desde qué día/);
  const m = await sanciones.mandarAFirma(id, { desde, hasta }, D);
  assert.equal(m.aprobada, true, m.falta || '');
  const f = await firmas.ficha(m.firmaId, D);
  assert.deepEqual([f.tipo, f.origen, f.estado], ['suspension', 'sancion', 'aprobado']);
  assert.match(f.detalle.sancion, /Suspensión de empleo y sueldo de 5 días, del/);
  assert.match(f.detalle.calificacion, /Falta grave, artículo 39\.2\.q del convenio colectivo/);
  assert.equal(firmas.comoSe(f).plantilla, 'Carta de sanción', 'va con la plantilla, sin PDF');
  const p = (await firmas.delBot.pendientes()).find(x => x.id === m.firmaId);
  assert.ok(p && p.detalle.hechos.includes('retrovisor'));

  // Enviada y firmada: comunicada, y suspendido en su ficha esas fechas.
  await firmas.delBot.enviado(m.firmaId, { ref: REF });
  await firmas.delBot.sincronizar(m.firmaId, { estado: 'done' });
  s = await sanciones.ficha(id, J);
  assert.equal(s.estado, 'comunicada');
  assert.ok(s.situacion_id, s.nota);
  const sit = (await consulta(`SELECT estado, to_char(desde, 'YYYY-MM-DD') AS d, to_char(hasta, 'YYYY-MM-DD') AS h FROM conductor_estado_hist WHERE id = $1`, [s.situacion_id])).rows[0];
  assert.deepEqual([sit.estado, sit.d, sit.h], ['suspendido', desde, hasta]);
}));

test('la carta descartada en Firmas vuelve a prepararse; una leve se queda en amonestación', () => conBase(async (base) => {
  const { J, D, c } = await gente(base);
  const { id } = await sanciones.crear({ conductorId: c.id, gravedad: 'LEVE', falta: 'Llegar tarde al relevo sin avisar',
    fechaHechos: calendario.hoy(), hechos: 'Llegó 40 minutos tarde al relevo y no avisó a Control.' }, J);
  await assert.rejects(sanciones.aprobar(id, { medida: 'suspension', dias: 3 }, J), /de 1 a 2/);
  await sanciones.aprobar(id, { medida: 'amonestacion' }, J);
  const m = await sanciones.mandarAFirma(id, {}, D);
  assert.equal((await firmas.ficha(m.firmaId, D)).tipo, 'sancion');
  await firmas.descartar(m.firmaId, { nota: 'El texto no era' }, D);
  const s = await sanciones.ficha(id, J);
  assert.deepEqual([s.estado, s.firma_envio_id], ['aprobada', null]);
  assert.match(s.carta.sancion, /Amonestación por escrito/);
}));

test('el ERP propone por las ausencias injustificadas del mes y la reincidencia; sube de grado sin duplicar', () => conBase(async (base) => {
  const { consulta } = base;
  const { J, c } = await gente(base);
  const injustificada = dia => consulta(`INSERT INTO ausencia_rrhh (conductor_id, dia, estado, detectada_el, resuelta_at)
    VALUES ($1, $2::date, 'injustificada', $2::date, now())`, [c.id, dia]);
  const propuestas = async () => (await consulta(`SELECT regla, estado, hechos FROM sancion WHERE conductor_id = $1 AND origen = 'propuesta' ORDER BY id`, [c.id])).rows;

  await injustificada('2026-11-03');
  assert.equal((await sanciones.proponer()).nuevas, 1);
  assert.deepEqual((await propuestas()).map(x => [x.regla, x.estado]), [['ABS_1D', 'propuesta']]);
  await injustificada('2026-11-09');
  const r = await sanciones.proponer();
  assert.deepEqual([r.nuevas, r.sustituidas], [1, 1]);
  const ps = await propuestas();
  assert.deepEqual(ps.map(x => [x.regla, x.estado]), [['ABS_1D', 'descartada'], ['ABS_2D', 'propuesta']]);
  assert.match(ps[1].hechos, /los días 3 y 9 de noviembre de 2026/);
  assert.equal((await sanciones.proponer()).nuevas, 0, 'repetirlo no duplica');

  // Una persona la abre: pasa a aprobación con los hechos escritos.
  const id = (await consulta(`SELECT id::text FROM sancion WHERE conductor_id = $1 AND regla = 'ABS_2D'`, [c.id])).rows[0].id;
  await sanciones.abrir(id, {}, J);
  assert.equal((await sanciones.ficha(id, J)).estado, 'abierta');

  // Reincidencia: 3 leves comunicadas en un trimestre → grave por reincidencia.
  for (const d of ['2026-09-10', '2026-10-05', '2026-11-02']) {
    await consulta(`INSERT INTO sancion (conductor_id, regla, gravedad, articulo, falta, fecha_hechos, estado, medida)
      VALUES ($1, 'ABS_1D', 'LEVE', 'Art. 39.1.b', 'x', $2::date, 'comunicada', 'amonestacion')`, [c.id, d]);
  }
  await sanciones.proponer();
  assert.ok((await propuestas()).some(x => x.regla === 'RECID_L' && x.estado === 'propuesta'));
}));
