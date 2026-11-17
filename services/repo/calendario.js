// ============================================================
// CALENDARIO LABORAL — el SQL (db/197, db/244)
// ============================================================
// Solo datos: qué días son hábiles lo decide services/calendario.js.
'use strict';

const db = require('../db');

/** Los festivos del convenio (`festivo`) y los de cada oficina (`festivo_oficina`), con la fecha como texto. */
async function festivos() {
  const [f, o] = await Promise.all([
    db.consulta(`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, ambito FROM festivo`),
    db.consulta(`SELECT sede, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM festivo_oficina`),
  ]);
  return { festivo: f.rows, oficina: o.rows };
}

module.exports = { festivos };
