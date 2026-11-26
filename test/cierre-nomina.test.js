// ============================================================
// EL CIERRE DE LA NÓMINA DEL MES (módulo 4, db/299, 26/11/2026)
// ============================================================
// Cuatro etapas por mes (del 26 al 25), cada una con su fecha: proforma
// revisada (sola) el 20, variables y descuentos enviados el 25, borrador
// revisado el 28 y nómina aprobada el 30; marcar es de quien gestiona la
// gestoría y aprobar, de quien tiene '/gestoria/nomina'. Las tarjetas nacen a
// tres días hábiles de cada fecha.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const cierre = require('../modules/Gestoria/cierre.service');

test('las fechas de cada etapa y el mes de nómina de un día', async () => {
  assert.deepEqual(await cierre.fechas('2026-11'),
    { proforma: '2026-11-20', variables: '2026-11-25', borrador: '2026-11-28', aprobada: '2026-11-30' });
  // En febrero, la aprobada cae el último día del mes.
  assert.equal((await cierre.fechas('2027-02')).aprobada, '2027-02-28');
  assert.equal(await cierre.periodoDe('2026-11-25'), '2026-11');
  assert.equal(await cierre.periodoDe('2026-11-26'), '2026-12');
  assert.equal(await cierre.periodoDe('2026-12-31'), '2027-01');
});

test('marcar, aprobar y deshacer: cada cosa con su llave y en su orden', () => conBase(async ({ consulta, fabrica }) => {
  const usuario = async (nombre, claves) => {
    const u = await fabrica.usuario({ rol: 'oficina', nombre });
    for (const c of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
    return { usuarioId: u.id, rol: 'oficina' };
  };
  const mira = await usuario('Mira', ['/gestoria']);
  const gestor = await usuario('Gestor', ['/gestoria', '/gestoria/gestionar']);
  const jefe = await usuario('Jefe', ['/gestoria', '/gestoria/nomina']);
  const P = '2026-11';

  let e = await cierre.estado(P);
  assert.deepEqual(e.etapas.map(x => [x.clave, x.hecha]), [['proforma', false], ['variables', false], ['borrador', false], ['aprobada', false]]);
  assert.equal(e.etapas[0].detalle, 'Sin subir');
  assert.equal(e.etapas[0].toca, true);

  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'variables', nota: 'x' }, mira), e2 => e2.status === 403);
  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'proforma' }, gestor), /no se marca a mano/);
  // La variable del mes sin congelar: se puede mandar igual, diciendo por qué.
  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'variables' }, gestor), /di por qué/);
  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'borrador' }, gestor), /Primero, las variables/);
  await cierre.marcar({ periodo: P, etapa: 'variables', nota: 'La variable va aparte este mes' }, gestor);
  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'variables', nota: 'otra vez' }, gestor), /ya está marcada/);
  await cierre.marcar({ periodo: P, etapa: 'borrador' }, gestor);

  // Aprobar: no el gestor; el jefe, solo con la proforma revisada.
  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'aprobada' }, gestor), e2 => e2.status === 403);
  await assert.rejects(cierre.marcar({ periodo: P, etapa: 'aprobada' }, jefe), /proforma revisada/);

  // Deshacer: con motivo, y la última primero.
  await assert.rejects(cierre.deshacer({ periodo: P, etapa: 'variables', motivo: 'Me equivoqué' }, gestor), /Primero hay que deshacer «Borrador revisado»/);
  await assert.rejects(cierre.deshacer({ periodo: P, etapa: 'borrador', motivo: '' }, gestor), /por qué/);
  await cierre.deshacer({ periodo: P, etapa: 'borrador', motivo: 'Llegó otro borrador' }, gestor);
  e = await cierre.estado(P);
  assert.deepEqual(e.etapas.map(x => x.hecha), [false, true, false, false]);
  assert.equal(e.etapas[1].nota, 'La variable va aparte este mes');
  const v = await cierre.vista({ periodo: P }, mira);
  assert.equal(v.historia.length, 1);
  assert.deepEqual([v.puedeMarcar, v.puedeAprobar], [false, false]);
  await cierre.marcar({ periodo: P, etapa: 'borrador', nota: 'El segundo' }, gestor);

  // Las tarjetas a 26/11: la de la proforma (sin subir) y la de aprobar; las
  // hechas no, y diciembre todavía no. Una sola vez.
  const r = await cierre.tarjetas({ hoy: '2026-11-26' });
  assert.equal(r.nacidas, 2);
  assert.equal((await cierre.tarjetas({ hoy: '2026-11-26' })).nacidas, 0);
  const t = (await consulta(`SELECT origen_id FROM tarea WHERE tipo = 'nomina_cierre' AND estado <> 'cerrada' ORDER BY origen_id`)).rows.map(x => x.origen_id);
  assert.deepEqual(t, ['2026-11|aprobada', '2026-11|proforma']);
}));

test('el panel del mes: la proforma, las variables para A3 y los descuentos, contra el mes anterior', () => conBase(async ({ consulta, fabrica }) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Gestor' });
  for (const c of ['/gestoria', '/gestoria/gestionar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, c]);
  const g = { usuarioId: u.id, rol: 'oficina' };
  const proforma = (periodo, bruto, sha) => consulta(
    `INSERT INTO fichero_importado (tipo, periodo, nombre, sha256, resultado) VALUES ('proforma_a3', $1, $2, $3, $4::jsonb)`,
    [periodo, `proforma ${periodo}.xlsx`, sha.repeat(64).slice(0, 64),
     JSON.stringify({ trabajadores: 160, casos: 0, totales: { bruto, liquido: bruto * 0.9, costeEmpresa: bruto * 1.3 } })]);
  await proforma('2026-10', 200000, 'a');
  await proforma('2026-11', 210000, 'b');
  const c = await fabrica.conductor({ nombre: 'PANEL' });
  await require('../modules/Gestoria/variables.service').apuntar({ periodo: '2026-11', conductorId: c.id, concepto: '015', importe: '150', motivo: 'Plus de calidad' }, g);
  const v = await cierre.vista({ periodo: '2026-11' }, g);
  assert.deepEqual([v.resumen.proforma.bruto, v.resumen.proforma.trabajadores, v.anterior.proforma.bruto], [210000, 160, 200000]);
  assert.deepEqual([v.resumen.lineas.pagar, v.resumen.lineas.personas, v.resumen.lineas.sin_codigo], [150, 1, 1]);
  assert.equal(v.resumen.descuentos.por_aprobar, 0);
  assert.equal(v.anterior.lineas.lineas, 0, 'octubre, sin variables preparadas');
}));
