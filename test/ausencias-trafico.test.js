// ============================================================
// LAS AUSENCIAS DESDE EL CORTE DEL 26/11, A TRÁFICO (db/311, 27/11/2026)
// ============================================================
// Desde el 26/11 las confirma Tráfico (injustificada, o justificada con sus
// horas: su J de Tráfico nace ya aprobada); lo de antes y abrir una baja o un
// permiso, RR. HH. Y el tablero, con sus grupos.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const aus = require('../modules/RRHH/ausencias.service');
const tablero = require('../services/tablero');

const conLlaves = async (consulta, fabrica, nombre, claves) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre });
  for (const k of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, k]);
  return { usuarioId: u.id, rol: 'oficina' };
};

test('desde el 26/11 decide Tráfico, y justificada pone su J ya aprobada con sus horas', () => conBase(async ({ consulta, fabrica }) => {
  const diana = await conLlaves(consulta, fabrica, 'Diana', ['/ausencias', '/ausencias/validar']);
  const william = await conLlaves(consulta, fabrica, 'William', ['/ausencias', '/ausencias/trafico']);
  const c = await fabrica.conductor({ nombre: 'AUSENTE', apellidos: 'PRUEBA' });
  const ins = dia => consulta(`INSERT INTO ausencia_rrhh (conductor_id, dia, estado, detectada_el) VALUES ($1, $2, 'pendiente', $2) RETURNING id`, [c.id, dia])
    .then(r => String(r.rows[0].id));
  const antes = await ins('2026-11-20');
  const despues = await ins('2026-11-27');
  const otra = await ins('2026-11-28');

  // Cada uno, lo suyo.
  await assert.rejects(aus.decidir({ ids: [antes], estado: 'injustificada' }, william), e => e.status === 403 && /RR\. HH\./.test(e.message));
  await assert.rejects(aus.decidir({ ids: [despues], estado: 'injustificada' }, diana), e => e.status === 403 && /Tráfico/.test(e.message));
  await assert.rejects(aus.decidir({ ids: [despues], estado: 'baja_medica' }, william), e => e.status === 403, 'la baja es de RR. HH.');
  await aus.decidir({ ids: [antes], estado: 'injustificada' }, diana);

  // Justificada por Tráfico: pide las horas, y su J nace aprobada.
  await assert.rejects(aus.decidir({ ids: [despues], estado: 'justificada', nota: 'Avisó por la mañana' }, william), /horas/);
  const r = await aus.decidir({ ids: [despues], estado: 'justificada', nota: 'Avisó por la mañana', horas: '7,5' }, william);
  assert.equal(r.decididas, 1);
  const j = (await consulta(`SELECT tipo, horas_seg_momento, aprobado_at IS NOT NULL AS aprobada, observacion
    FROM justificante WHERE conductor_id = $1 AND dia_operativo = '2026-11-27' AND anulado_at IS NULL`, [c.id])).rows[0];
  assert.deepEqual([j.tipo, Number(j.horas_seg_momento), j.aprobada], ['trafico', 27000, true]);
  assert.match(j.observacion, /Ausencia justificada por Tráfico: Avisó por la mañana/);
  assert.equal((await consulta(`SELECT estado FROM ausencia_rrhh WHERE id = $1`, [despues])).rows[0].estado, 'justificada');

  // Injustificada por Tráfico: sin J.
  await aus.decidir({ ids: [otra], estado: 'injustificada' }, william);
  assert.equal((await consulta(`SELECT count(*)::int AS n FROM justificante WHERE conductor_id = $1 AND dia_operativo = '2026-11-28'`, [c.id])).rows[0].n, 0);
}));

test('el tablero: cada tipo de tarjeta en su grupo', () => {
  const g = t => tablero.grupoDe(t).id;
  assert.deepEqual(['alta_pedir', 'alta_no_presentado', 'gestoria_plantilla'].map(g), ['altas', 'altas', 'altas']);
  assert.deepEqual(['baja_revisar', 'baja_reincorporacion'].map(g), ['bajas', 'bajas']);
  assert.equal(g('ausencias_revisar'), 'ausencias');
  assert.deepEqual(['nomina_cierre', 'nomina_pendientes', 'gestoria_proforma'].map(g), ['nomina', 'nomina', 'nomina']);
  assert.deepEqual(['salida_bolt', 'finiquito_revisar'].map(g), ['salidas', 'salidas']);
  assert.deepEqual(['firma_aprobar', 'comunicaciones_semana', 'sancion_carta', 'comunicado_aprobar', 'j_trafico', 'menos_j', 'ticket', 'manual'].map(g),
    ['firmas', 'firmas', 'sanciones', 'comunicados', 'j', 'j', 'tickets', 'otras']);
});
