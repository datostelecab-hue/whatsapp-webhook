// ============================================================
// LA FICHA DE PRUEBAS NO CUENTA COMO UN ALTA (24/11/2026, db/281)
// ============================================================
// Camilo: «Márcala como de pruebas y sácala de todo eso» (el conductor de
// pruebas de db/280). `conductor.es_prueba` la marca. Entra al portal y usa el
// bot como cualquiera, pero las consultas que cuentan altas (gestoría,
// contratos, nómina, objetivos, recuentos de la plantilla, incorporaciones,
// planificador, vacaciones, asistencia, calificación, cumpleaños) la dejan fuera
// con `fuera('c')`.
//
// SIN db/281 NO SE CAE NADA: el código se despliega antes de que se aplique la
// migración, y una consulta que nombre una columna que aún no existe falla. Así
// que se mira una vez si la columna está: si está, `fuera` da el filtro; si no,
// nada (se vuelve a mirar cada minuto hasta que aparezca, y desde ahí ya no).
'use strict';

const db = require('../db');

const REMIRAR_MS = 60 * 1000;
let hay = false;
let mirado = 0;
let mirando = null;

async function mirar() {
  if (hay) return true;
  if (Date.now() - mirado < REMIRAR_MS) return hay;
  if (!mirando) {
    mirando = db.consulta(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'conductor' AND column_name = 'es_prueba'`)
      .then(r => { hay = r.rows.length > 0; })
      .catch(() => { hay = false; })
      .finally(() => { mirado = Date.now(); mirando = null; });
  }
  await mirando;
  return hay;
}

/** «AND NOT c.es_prueba» (con el alias de la tabla conductor), o '' sin db/281. */
async function fuera(alias = 'c') {
  return (await mirar()) ? ` AND NOT ${alias}.es_prueba` : '';
}

/** La columna para enseñarla («c.es_prueba»), o FALSE sin db/281. */
async function columna(alias = 'c') {
  return (await mirar()) ? `${alias}.es_prueba` : 'FALSE AS es_prueba';
}

module.exports = { fuera, columna, _olvidar: () => { hay = false; mirado = 0; } };
