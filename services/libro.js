// ============================================================
// EL LIBRO DE AUDITORÍA — quién, qué, cuándo y por qué (db/245)
// ============================================================
// Hoja de ruta de Ignacio, convención 5: «Cada alta, cambio de estado,
// aprobación o lectura de un aviso guarda quién, qué y cuándo. Nada se borra:
// se anula, con motivo». Pieza A4 de docs/Hoja de ruta.md (13/11/2026).
//
// El libro (`auditoria`) lo escribe la BASE: una tabla nueva se pone bajo él en
// su migración con `SELECT auditoria_vigilar('tarea');` y cada alta, cambio y
// borrado deja su fila, venga de donde venga. Aquí solo se le dice, dentro de
// la MISMA transacción que escribe, quién lo hace, desde dónde y por qué:
//
//   await libro.conFirma({ usuarioId, origen: 'tablero', accion: 'reasignacion', motivo }, async cli => {
//     await cli.query('UPDATE tarea SET responsable_id = $2 WHERE id = $1', [id, nuevo]);
//   });
//
// `set_config(…, true)` solo vale en esa transacción: una consulta suelta del
// pool iría por otra conexión y la firma no llegaría. Si un camino se olvida de
// firmar, el cambio se apunta igual («sin decir»): lo que no puede es no quedar.
//
// Lo que no es una fila —una LECTURA de un aviso— se apunta a mano:
//   await libro.apuntar({ tabla: 'aviso', registro: id, accion: 'lectura', usuarioId, origen: 'avisos' });
//
// Las variables son las mismas que las del libro de las J (db/228,
// services/repo/auditoriaJ.js): una transacción que escriba a la vez una J y
// una tabla de este libro no debe pasar una `accion` de las de aquí.
//
// Quién puede LEER la historia de un registro lo decide el módulo dueño del
// registro: `historial` no mira permisos.
'use strict';

const db = require('./db');

/** Cómo se dice cada acción. Una acción nueva es una entrada más. */
const ACCIONES = {
  alta: 'Alta',
  cambio: 'Cambio',
  estado: 'Cambio de estado',
  aprobacion: 'Aprobación',
  rechazo: 'Rechazo',
  reasignacion: 'Reasignación',
  anulacion: 'Anulación',
  borrado: 'Borrado',
  lectura: 'Leído',
  resolucion: 'Resuelto',
};

const ACCION_VALIDA = /^[a-z_]{1,24}$/;
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * Firma lo que se va a escribir en ESTA transacción (`cli` es su conexión).
 *   usuarioId  quién (de la sesión, nunca del cuerpo de la petición)
 *   origen     desde dónde: la pantalla, la tarea programada…
 *   accion     opcional: si no, la deduce la base del cambio
 *   motivo     opcional: por qué (una reasignación, una anulación)
 */
async function firmar(cli, { usuarioId, origen, accion, motivo } = {}) {
  const n = Number(usuarioId);
  const acc = accion ? String(accion) : '';
  if (acc && !ACCION_VALIDA.test(acc)) throw new Error(`Acción de auditoría no válida: «${accion}»`);
  await cli.query(
    `SELECT set_config('telecab.usuario_id', $1, true),
            set_config('telecab.origen', $2, true),
            set_config('telecab.accion', $3, true),
            set_config('telecab.motivo', $4, true)`,
    [Number.isInteger(n) && n > 0 ? String(n) : '', texto(origen, 60), acc, texto(motivo, 2000)]);
}

/** Abre una transacción, la firma y ejecuta `fn(cli)` dentro. */
function conFirma(firma, fn) {
  return db.transaccion(async cli => {
    await firmar(cli, firma);
    return fn(cli);
  });
}

/**
 * Apunta en el libro algo que no es una fila: una lectura, un aviso resuelto,
 * una reasignación que se quiere dejar con su motivo… Con `cli`, dentro de esa
 * transacción.
 */
async function apuntar({ tabla, registro, accion, usuarioId, origen, motivo, detalle } = {}, cli = null) {
  const t = texto(tabla, 63);
  const r = texto(registro, 80);
  if (!t || !r) throw new Error('Un apunte del libro dice de qué tabla y de qué registro');
  if (!ACCION_VALIDA.test(String(accion || ''))) throw new Error(`Acción de auditoría no válida: «${accion}»`);
  const n = Number(usuarioId);
  const q = cli ? (s, p) => cli.query(s, p) : db.consulta;
  const res = await q(
    `INSERT INTO auditoria (tabla, registro, accion, usuario_id, origen, motivo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
    [t, r, accion, Number.isInteger(n) && n > 0 ? n : null, texto(origen, 60) || null,
     texto(motivo, 2000) || null, detalle == null ? null : JSON.stringify(detalle)]);
  return Number(res.rows[0].id);
}

/**
 * La historia de UN registro, de lo más viejo a lo más nuevo:
 * [{ accion, etiqueta, quien, origen, motivo, en, enIso, cambios: [{ campo, antes, despues }], detalle }].
 * `en` va en hora de Madrid, dd/mm/aaaa hh:mm.
 */
async function historial(tabla, registro) {
  const t = texto(tabla, 63), r = texto(registro, 80);
  if (!t || !r) throw new Error('Falta de qué y cuál');
  const res = await db.consulta(
    `SELECT a.id, a.accion, a.origen, a.motivo, a.cambios, a.detalle, a.en,
            to_char(a.en AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS en_texto,
            btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS quien
       FROM auditoria a
       LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE a.tabla = $1 AND a.registro = $2
      ORDER BY a.en, a.id`, [t, r]);
  return res.rows.map(f => ({
    id: Number(f.id),
    accion: f.accion,
    etiqueta: ACCIONES[f.accion] || f.accion,
    quien: f.quien || null,
    origen: f.origen,
    motivo: f.motivo,
    en: f.en_texto,
    enIso: f.en instanceof Date ? f.en.toISOString() : f.en,   // un instante: toISOString es correcto aquí
    cambios: f.cambios ? Object.entries(f.cambios).map(([campo, [antes, despues]]) => ({ campo, antes, despues })) : [],
    detalle: f.detalle,
  }));
}

module.exports = { ACCIONES, firmar, conFirma, apuntar, historial };
