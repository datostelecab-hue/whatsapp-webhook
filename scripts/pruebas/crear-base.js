// ============================================================
// LA BASE DE PRUEBAS — vacía, sintética y aparte de la copia de producción
// ============================================================
// Hoja de ruta de Ignacio, convención 11 (13/11/2026): «Cada criterio de
// aceptación es un test automático. Nunca se prueba con datos reales de
// conductores». La base local de siempre (`telecab`) es una COPIA de producción,
// con DNI, teléfonos y correos de verdad: sirve para mirar, no para los tests.
//
// Este script hace otra base en el mismo Docker, `telecab_pruebas`, desde cero:
//   1. La borra si existe y la crea vacía.
//   2. Le aplica TODAS las migraciones de db/ con el corredor de siempre
//      (services/migraciones.js), así su esquema es el de producción. Cuando una
//      pide las tablas de Flota viva (fv_*), que no viven en db/ sino en
//      services/flotaViva/esquema.sql, se aplica ese esquema y se sigue.
//   3. Salta las migraciones que SOLO cargan datos reales y en vacío no pueden
//      (lista SOLO_DATOS, cada una con su porqué). Las apunta en `_migracion`
//      con su huella, como hechas, para que el corredor no las vuelva a pedir.
//      Una que falle y no esté en la lista PARA el script: puede llevar esquema,
//      y saltarla dejaría una base distinta de la de producción.
//   4. Vacía las tablas que las migraciones llenan con datos de personas
//      (VACIAR) y COMPRUEBA que no queda ninguno: ningún DNI, teléfono, correo,
//      IBAN ni cuenta de BOLT en ninguna tabla, ni conductores salvo el
//      centinela «(sin mapear)», ni usuarios. Si una migración futura carga
//      gente de verdad, el script falla y lo dice.
//   5. Pone la marca `base_de_pruebas`, que exigen los tests (test/apoyo/base.js).
//
//   npm run pruebas:base        (unos dos minutos; hace falta Docker abierto)
//
// SOLO TOCA 127.0.0.1:5433. La dirección va escrita aquí y no se lee de ninguna
// variable: no hay forma de que apunte a producción.
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');

const SERVIDOR = 'postgresql://telecab:pruebas@127.0.0.1:5433';
const BASE = 'telecab_pruebas';
const URL_PRUEBAS = `${SERVIDOR}/${BASE}`;
const RAIZ = path.join(__dirname, '..', '..');

// Migraciones que solo cargan datos reales de personas concretas: en una base
// vacía fallan por las claves ajenas (la persona no existe) y no llevan nada de
// esquema (comprobado el 13/11/2026: ningún CREATE, ALTER ni DROP).
const SOLO_DATOS = {
  '155-libranzas-de-agosto-por-patron.sql': 'libranzas de agosto de conductores concretos',
  '162-recaudacion-nomina-septiembre.sql': 'descuentos de nómina de septiembre de conductores concretos',
  '232-cuentas-bolt-de-antes-de-julio.sql': 'cuentas de BOLT de antes de julio de personas concretas',
};

// Tablas que las migraciones llenan con datos de personas aunque la base esté
// vacía: las horas por cuenta de BOLT de antes de julio (db/231) y los códigos
// de lavado de Ballenoil con su teléfono (db/89, db/164).
const VACIAR = ['bolt_jornada_historico', 'ballenoil_codigo'];

// Columnas que delatan a una persona: por la PALABRA del nombre (`dni_nie`,
// `tel_emergencia`, `correo_legal`, `iban_cifrado`, `naf_numero`, `driver_uuid`,
// `pin_ballenoil`…), no por una lista exacta, para que una columna nueva no se
// escape. Ninguna puede tener un valor al acabar.
const COLUMNA_DE_PERSONA = '(^|_)(dni|nie|nif|naf|nss|tel|telefono|movil|email|correo|iban|uuid|pin)(_|$)';
// Las que llevan datos de EMPRESAS, no de personas: pueden venir llenas.
const DE_EMPRESAS = new Set([
  'taller_proveedor.telefono',   // Discom, iPark, Hergar… (db/132, db/241)
  'taller_proveedor.nif',
]);

// La misma huella que el corredor (services/migraciones.js): sin depender de los
// saltos de línea del sistema.
const huella = txt => crypto.createHash('sha256')
  .update(String(txt).replace(/\r\n/g, '\n').trimEnd(), 'utf8').digest('hex').slice(0, 16);

const log = (...a) => console.log('🧪 [BASE DE PRUEBAS]', ...a);

async function crearVacia() {
  const adm = new Client({ connectionString: `${SERVIDOR}/postgres` });
  try {
    await adm.connect();
  } catch (e) {
    throw new Error(`No hay PostgreSQL local en 127.0.0.1:5433 (${e.message}). Abre Docker Desktop y arranca el entorno: node scripts/entorno-local/arrancar.js`);
  }
  await adm.query(`DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`);
  await adm.query(`CREATE DATABASE ${BASE} TEMPLATE template0 ENCODING 'UTF8'`);
  await adm.end();
}

async function migrar() {
  // El corredor y Flota viva leen DATABASE_URL al cargarse: se fija antes.
  process.env.DATABASE_URL = URL_PRUEBAS;
  process.env.MODO_PRUEBAS = '1';
  const migraciones = require(path.join(RAIZ, 'services', 'migraciones'));
  const db = require(path.join(RAIZ, 'services', 'db'));
  const flotaViva = require(path.join(RAIZ, 'services', 'flotaViva', 'db'));

  let flotaVivaHecha = false;
  const saltadas = [];
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const r = await migraciones.aplicar();
    if (!r.parado) break;
    const mala = r.aplicadas.find(x => !x.ok);
    if (/\bfv_/.test(mala.error) && !flotaVivaHecha) {
      await flotaViva.preparar();
      flotaVivaHecha = true;
      log('esquema de Flota viva aplicado (lo pidió', mala.fichero + ')');
      continue;
    }
    if (!SOLO_DATOS[mala.fichero]) {
      throw new Error(`${mala.fichero} falla en una base vacía: ${mala.error}${mala.detalle ? ' — ' + mala.detalle : ''}.\n` +
        'Si SOLO carga datos reales (ni CREATE, ni ALTER, ni DROP), añádela a SOLO_DATOS con su porqué. Si lleva esquema, hay que arreglarla.');
    }
    const sql = fs.readFileSync(path.join(RAIZ, 'db', mala.fichero), 'utf8');
    await db.consulta(
      `INSERT INTO _migracion (fichero, huella, duracion_ms, sentencias) VALUES ($1, $2, 0, 0)`,
      [mala.fichero, huella(sql)]);
    saltadas.push(mala.fichero);
  }
  const e = await migraciones.estado();
  if (e.pendientes.length) throw new Error(`Quedan migraciones sin aplicar: ${e.pendientes.map(p => p.fichero).join(', ')}`);
  return { aplicadas: e.aplicadas.length, saltadas, db };
}

async function limpiarYComprobar(db) {
  for (const t of VACIAR) await db.consulta(`TRUNCATE ${t}`);

  const problemas = [];
  const n = async sql => Number((await db.consulta(sql)).rows[0].n);
  if (await n(`SELECT count(*) n FROM conductor WHERE NOT es_centinela`)) problemas.push('hay conductores que no son el centinela');
  if (await n(`SELECT count(*) n FROM usuario`)) problemas.push('hay usuarios');
  if (await n(`SELECT count(*) n FROM conductor_externo`)) problemas.push('hay cuentas de BOLT');

  const cols = (await db.consulta(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name ~ $1`,
    [COLUMNA_DE_PERSONA])).rows;
  for (const { table_name: t, column_name: c } of cols) {
    if (DE_EMPRESAS.has(`${t}.${c}`)) continue;
    const k = await n(`SELECT count(*) n FROM "${t}" WHERE "${c}" IS NOT NULL`);
    if (k) problemas.push(`${t}.${c} tiene ${k} valores`);
  }
  if (problemas.length) {
    throw new Error('La base de pruebas tiene datos de personas: ' + problemas.join('; ') +
      '. Una migración los carga: añade su tabla a VACIAR o su fichero a SOLO_DATOS.');
  }
  return cols.length;
}

async function marcar(db, aplicadas) {
  await db.consulta(`
    CREATE TABLE base_de_pruebas (
      creada_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      migraciones INTEGER     NOT NULL
    )`);
  await db.consulta(`INSERT INTO base_de_pruebas (migraciones) VALUES ($1)`, [aplicadas]);
  await db.consulta(`COMMENT ON TABLE base_de_pruebas IS
    'Marca de la base de los tests (scripts/pruebas/crear-base.js). Sin ella, test/apoyo/base.js se niega a conectar.'`);
}

(async () => {
  const t0 = Date.now();
  log('creando', BASE, 'vacía en 127.0.0.1:5433…');
  await crearVacia();
  const { aplicadas, saltadas, db } = await migrar();
  const revisadas = await limpiarYComprobar(db);
  await marcar(db, aplicadas);
  log(`lista en ${Math.round((Date.now() - t0) / 1000)} s: ${aplicadas} migraciones` +
    (saltadas.length ? ` (${saltadas.length} solo de datos, saltadas: ${saltadas.join(', ')})` : '') +
    `, sin datos de personas (${revisadas} columnas revisadas).`);
  log('ahora: npm test');
  await db.cerrar();
  process.exit(0);
})().catch(e => {
  console.error('❌ [BASE DE PRUEBAS]', e.message);
  process.exit(1);
});
