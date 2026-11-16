// ============================================================
// LAS NOVEDADES — la ventana de cada versión, una vez por persona (db/253)
// ============================================================
// Con la V3 (16/11/2026) la aplicación avisa a todos de lo nuevo y de lo que
// ya trae, y ofrece un recorrido guiado opcional. Sale UNA vez por persona y
// versión, en el dispositivo que sea: lo que se ha visto se guarda aquí.
//
// LO QUE DICE CADA VERSIÓN está en public/assets/js/novedades.js (es texto de
// pantalla). Aquí solo se decide CUÁL es la de ahora: para una versión nueva,
// se cambia ACTUAL y se le escribe su contenido allí.
'use strict';

const db = require('../../services/db');

const ACTUAL = 'v3';
const RECORRIDO = new Set(['hecho', 'saltado']);

function conEstado(e, status) { e.status = status; return e; }
const entero = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** Lo que necesita la pantalla: la versión de ahora y si a esta persona le falta verla. */
async function estado(usuarioId) {
  const id = entero(usuarioId);
  if (!id) throw conEstado(new Error('Sesión requerida'), 401);
  const r = await db.consulta(
    'SELECT vista_at, recorrido FROM novedad_vista WHERE usuario_id = $1 AND version = $2', [id, ACTUAL]);
  const f = r.rows[0];
  return { version: ACTUAL, pendiente: !f, recorrido: f ? f.recorrido : null };
}

/**
 * La ha visto (cerró la ventana). Con `recorrido`, además, cómo acabó el
 * recorrido guiado; un recorrido «hecho» no se pisa con uno «saltado» después.
 */
async function marcar(usuarioId, { version, recorrido = null } = {}) {
  const id = entero(usuarioId);
  if (!id) throw conEstado(new Error('Sesión requerida'), 401);
  if (version !== ACTUAL) throw conEstado(new Error(`Esa versión no es la de ahora (${ACTUAL})`), 400);
  if (recorrido != null && !RECORRIDO.has(recorrido)) throw conEstado(new Error('El recorrido acaba «hecho» o «saltado»'), 400);
  await db.consulta(
    `INSERT INTO novedad_vista (usuario_id, version, recorrido, recorrido_at)
     VALUES ($1, $2, $3::varchar, CASE WHEN $3::varchar IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (usuario_id, version) DO UPDATE SET
       recorrido = CASE WHEN $3::varchar IS NULL OR novedad_vista.recorrido = 'hecho' THEN novedad_vista.recorrido ELSE $3::varchar END,
       recorrido_at = CASE WHEN $3::varchar IS NULL OR novedad_vista.recorrido = 'hecho' THEN novedad_vista.recorrido_at ELSE now() END`,
    [id, ACTUAL, recorrido]);
  return estado(id);
}

/** Para quien la mida: cuántos la han visto y cuántos hicieron el recorrido. */
async function cuentas(version = ACTUAL) {
  const r = await db.consulta(
    `SELECT count(*)::int AS vistas,
            count(*) FILTER (WHERE recorrido = 'hecho')::int AS recorridos,
            count(*) FILTER (WHERE recorrido = 'saltado')::int AS saltados
       FROM novedad_vista WHERE version = $1`, [version]);
  return r.rows[0];
}

module.exports = { ACTUAL, estado, marcar, cuentas };
