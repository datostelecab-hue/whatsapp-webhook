// ============================================================
// LA FICHA DE PRUEBAS NO CUENTA COMO UN ALTA (24/11/2026, db/281)
// ============================================================
// «Pero ojo, ese conductor de pruebas no cuenta como alta en todo el sistema,
// no?» y «Márcala como de pruebas y sácala de todo eso». La ficha de pruebas
// tiene su contrato abierto (para entrar al portal y usar el bot), pero no sale
// en la gestoría, los contratos, la nómina, vacaciones, las incorporaciones ni
// los recuentos de la plantilla. En la lista de Plantilla sí, marcada.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const conductores = require('../modules/Conductores/conductores.repo');
const nominas = require('../modules/Nominas/nominas.repo');
const contratos = require('../modules/RRHH/contratos.repo');
const vacaciones = require('../modules/Vacaciones/vacaciones.repo');
const incorporaciones = require('../modules/Control/incorporaciones.repo');
const portal = require('../modules/Portal/portal.repo');

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

test('la de pruebas no sale en nada de lo que cuenta altas; la normal, sí', () => conBase(async ({ consulta, fabrica }) => {
  const normal = await fabrica.conductor({ nombre: 'Normal', alta: hoy });
  const prueba = await fabrica.conductor({ nombre: 'Prueba', apellidos: 'De Prueba (PRUEBAS)', alta: hoy });
  await consulta('UPDATE conductor SET es_prueba = TRUE, dni_nie = $2, email = $3 WHERE id = $1',
    [prueba.id, '600000000', 'pruebas@telecab.invalid']);
  const ids = xs => new Set(xs instanceof Map ? [...xs.keys()].map(String) : xs.map(x => String(x.id || x.conductor_id)));
  const n = String(normal.id), p = String(prueba.id);

  // La gestoría no trae el id: se reconoce por su documento.
  const gestoria = new Set((await conductores.paraGestoria({ estado: 'alta' })).map(x => String(x.dni_nie || '')));
  const nomina = ids(await nominas.fichasDelMes(hoy));
  const sinContrato = ids(await contratos.sinContrato({ tipo: 'propia' }));
  const vac = ids(await vacaciones.personas({}));
  const altas = ids(await incorporaciones.altas(hoy, hoy));
  for (const [que, lista] of [['nómina', nomina], ['contratos', sinContrato], ['vacaciones', vac], ['incorporaciones', altas]]) {
    assert.ok(lista.has(n), `la normal sale en ${que}`);
    assert.ok(!lista.has(p), `la de pruebas NO sale en ${que}`);
  }
  assert.ok(!gestoria.has('600000000'), 'ni en la gestoría');

  // Plantilla: la lista la enseña, marcada; los recuentos no la cuentan.
  const lista = await conductores.listar({ soloVigentes: true });
  const suya = lista.find(x => String(x.id) === p);
  assert.ok(suya, 'en Plantilla se ve');
  assert.equal(suya.es_prueba, true, 'con su marca');
  const r = await conductores.resumen({});
  const deAlta = (r.porTipo || []).reduce((a, x) => a + Number(x.personas || 0), 0);
  const todas = (await consulta('SELECT count(*)::int n FROM conductor c WHERE c.empleo_vigente AND NOT c.es_centinela')).rows[0].n;
  assert.equal(deAlta, todas - 1, 'los recuentos de alta no la cuentan');

  // Y sigue pudiendo entrar al portal con su «documento».
  const entra = await portal.porDni('600000000');
  assert.equal(String(entra && entra.id), p);
}));
