// ============================================================
// EL HISTÓRICO DE LA NÓMINA DE UNA PERSONA, MES A MES (4.7, 26/11/2026)
// ============================================================
// Junta por mes la proforma de A3 (su línea, por su código), las variables para
// A3 y lo descontado. Sin calcular nada.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const historico = require('../modules/Gestoria/historico');
const expediente = require('../modules/Conductores/expediente.service');

test('la nómina por meses: proforma, variables y descuentos; en el expediente con la llave de Gestoría', () => conBase(async ({ consulta, fabrica }) => {
  const c = await fabrica.conductor({ nombre: 'HISTORICO' });
  await consulta(`UPDATE conductor SET legajo = '009991' WHERE id = $1`, [c.id]);
  const fichero = (periodo, sha, trabajadores) => consulta(
    `INSERT INTO fichero_importado (tipo, periodo, nombre, sha256, resultado) VALUES ('proforma_a3', $1, 'p.xlsx', $2, $3::jsonb)`,
    [periodo, sha.repeat(64), JSON.stringify({ trabajadores })]);
  await fichero('2026-10', 'a', [{ legajo: '009991', dias: 31, it: 0, bruto: 1500, liquido: 1300 }]);
  await fichero('2026-11', 'b', [{ legajo: '009991', dias: 30, it: 0, bruto: 1400, liquido: 1200 }, { legajo: '000001', dias: 30, it: 0, bruto: 9, liquido: 9 }]);
  await fichero('2026-11', 'c', [{ legajo: '009991', dias: 30, it: 55.5, bruto: 1450, liquido: 1250 }]);   // la última de noviembre manda
  await consulta(`INSERT INTO nomina_linea (periodo, conductor_id, concepto, importe, origen) VALUES ('2026-11', $1, '066', 200, 'variable'), ('2026-11', $1, '066', 50, 'variable')`, [c.id]);
  const d = (await consulta(
    `INSERT INTO descuento_nomina (conductor_id, origen, concepto, importe, saldo, periodo, fecha, motivo, estado)
     VALUES ($1, 'km', '758', 30, 0, '2026-11', '2026-11-10', 'Prueba', 'aplicado') RETURNING id`, [c.id])).rows[0];
  await consulta(`INSERT INTO descuento_aplicacion (descuento_id, periodo, importe) VALUES ($1, '2026-11', 30)`, [d.id]);

  const meses = await historico.deConductor(c.id);
  assert.deepEqual(meses.map(m => m.periodo), ['2026-11', '2026-10']);
  const nov = meses[0];
  assert.deepEqual(nov.proforma, { bruto: 1450, liquido: 1250, dias: 30, it: 55.5 });
  assert.deepEqual(nov.variables.lineas.map(l => [l.concepto, l.importe]), [['066', 250]]);
  assert.equal(nov.variables.pagar, 250);
  assert.deepEqual(nov.descuentos.map(x => [x.origen, x.importe]), [['km', 30]]);
  assert.equal(meses[1].proforma.bruto, 1500);

  // En el expediente, con la llave de Gestoría; sin ella, no llega.
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Gest' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/gestoria')`, [u.id]);
  const conLlave = await expediente.deUno(c.id, { usuarioId: u.id, rol: 'oficina' });
  const s = conLlave.secciones.find(x => x.id === 'nomina');
  assert.ok(s && !s.error, s && s.error);
  assert.equal(s.datos.meses.length, 2);
  const otro = await fabrica.usuario({ rol: 'oficina', nombre: 'Sin' });
  await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/plantilla')`, [otro.id]);
  assert.ok(!(await expediente.deUno(c.id, { usuarioId: otro.id, rol: 'oficina' })).secciones.some(x => x.id === 'nomina'));
}));
