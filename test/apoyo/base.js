// ============================================================
// LA BASE DE LOS TESTS — cada test en su transacción, y se deshace al acabar
// ============================================================
// Convención 11 de la hoja de ruta: «Cada criterio de aceptación es un test
// automático. Nunca se prueba con datos reales de conductores». Los tests van
// contra `telecab_pruebas`, la base vacía y sintética que hace
// scripts/pruebas/crear-base.js, nunca contra la copia de producción.
//
// Uso, en un fichero de test/:
//
//   const { conBase } = require('./apoyo/base');   // PRIMERO: antes que el código a probar
//   const { test } = require('node:test');
//   const assert = require('node:assert/strict');
//
//   test('el ticket sin captura no se envía', () => conBase(async ({ consulta, fabrica }) => {
//     const c = await fabrica.conductor();
//     const sanciones = require('../modules/…/….service');
//     await assert.rejects(sanciones.enviar({ conductorId: c.id }), /captura/);
//   }));
//
// Lo que hace al cargarse:
//   · Fija MODO_PRUEBAS=1 (no sale ningún WhatsApp, correo ni orden a Mapon) y
//     apunta DATABASE_URL a la base de pruebas, por si algo abre su propia
//     conexión.
//   · SUSTITUYE services/db y services/flotaViva/db por una versión que habla con
//     UNA conexión de este fichero. Por eso hay que pedirlo antes que el código a
//     probar: lo que ya se cargó con la base de verdad no se puede cambiar.
//
// conBase(fn) abre una transacción, le pasa a fn { consulta, fabrica } y la
// DESHACE siempre al acabar: ningún test ve lo de otro y la base queda como
// estaba. El `transaccion()` del código probado se hace con un SAVEPOINT dentro
// de esa transacción, así que su «si falla, se deshace todo» se sigue cumpliendo.
// Una consulta fuera de conBase falla: así no se cuela nada que se quede.
//
// SOLO 127.0.0.1:5433/telecab_pruebas, y solo si tiene la marca
// `base_de_pruebas`. La dirección va escrita aquí: no se lee de ninguna variable.
'use strict';

const path = require('path');
const { Client } = require('pg');

const URL_PRUEBAS = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab_pruebas';
const RAIZ = path.join(__dirname, '..', '..');

process.env.MODO_PRUEBAS = '1';
process.env.DATABASE_URL = URL_PRUEBAS;
process.env.FLOTA_VIVA_DB_URL = URL_PRUEBAS;

let cliente = null;        // una conexión por fichero (node --test corre cada fichero en su proceso)
let enCurso = false;       // hay una transacción de test abierta
let puntos = 0;            // contador de SAVEPOINT

async function conectar() {
  if (cliente) return cliente;
  const c = new Client({ connectionString: URL_PRUEBAS, options: '-c jit=off' });
  try {
    await c.connect();
  } catch (e) {
    throw new Error(`No hay base de pruebas (${e.message}). Abre Docker Desktop y créala: npm run pruebas:base`);
  }
  try {
    await c.query('SELECT 1 FROM base_de_pruebas LIMIT 1');
  } catch (e) {
    await c.end();
    throw new Error('Esa base no es la de pruebas: le falta la marca base_de_pruebas. Créala: npm run pruebas:base');
  }
  cliente = c;
  return c;
}

function actual() {
  if (!enCurso || !cliente) {
    throw new Error('Consulta a la base fuera de conBase(): cada test abre la suya y se deshace al acabar');
  }
  return cliente;
}

const consulta = (sql, params) => actual().query(sql, params);

/** El transaccion() del código probado: un SAVEPOINT dentro del test. */
async function transaccion(fn) {
  const c = actual();
  const p = `t${++puntos}`;
  await c.query(`SAVEPOINT ${p}`);
  try {
    const r = await fn(c);
    await c.query(`RELEASE SAVEPOINT ${p}`);
    return r;
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${p}`);
    throw e;
  }
}

function sustituir(rel, exportaciones) {
  const f = require.resolve(path.join(RAIZ, rel));
  if (require.cache[f] && require.cache[f].exports !== exportaciones && !require.cache[f]._deLosTests) {
    throw new Error(`${rel} ya estaba cargado con la base de verdad: pide test/apoyo/base.js ANTES que el código a probar`);
  }
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exportaciones, _deLosTests: true };
}

const sinPool = () => { throw new Error('En los tests no hay pool: se usa consulta() o transaccion()'); };

sustituir('services/db', {
  HAY_BD: true,
  consulta,
  transaccion,
  pool: sinPool,
  estado: async () => ({ configurada: true, pruebas: true }),
  cerrar: async () => {},
});

sustituir('services/flotaViva/db', {
  HAY_BD: true,
  consulta,
  transaccion,
  preparar: async () => {},                       // el esquema fv_* ya lo puso crear-base.js
  conEsquema: funciones => ({ ...funciones }),
  huellaDe: () => 'pruebas',
  _olvidar: () => {},
});

/**
 * Ejecuta fn dentro de una transacción que se deshace siempre al acabar.
 * @param {(h: { consulta: Function, fabrica: object }) => Promise<any>} fn
 */
async function conBase(fn) {
  await conectar();
  if (enCurso) throw new Error('conBase() no se anida: cada test abre la suya');
  enCurso = true;
  await cliente.query('BEGIN');
  try {
    const { crearFabrica } = require('./fabrica');
    return await fn({ consulta, fabrica: crearFabrica(consulta) });
  } finally {
    await cliente.query('ROLLBACK');
    enCurso = false;
  }
}

/** Cierra la conexión. */
async function cerrar() {
  if (cliente) { await cliente.end(); cliente = null; }
}

// Con la conexión abierta, el proceso del fichero no acabaría nunca y
// `node --test` se quedaría esperando: se cierra al terminar sus tests.
require('node:test').after(cerrar);

module.exports = { conBase, cerrar, URL_PRUEBAS };
