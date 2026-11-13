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
// · La firma solo vale dentro de una transacción (`set_config(…, true)`):
//   `firmar` lo comprueba y lanza si se llama fuera.
// · La acción y el motivo firmados valen para los CAMBIOS de esa transacción:
//   un alta es siempre «alta» y un borrado, «borrado».
// · Si un camino se olvida de firmar, el cambio se apunta igual («sin decir»):
//   lo que no puede es no quedar.
// · Las variables de quién y desde dónde son las del libro de las J (db/228,
//   services/repo/auditoriaJ.js): por eso el origen va como mucho con 40 letras,
//   lo que cabe allí.
//
// Lo que no es una fila —una LECTURA de un aviso— se apunta a mano:
//   await libro.apuntar({ tabla: 'aviso', registro: id, accion: 'lectura', usuarioId, origen: 'avisos' });
//
// Quién puede LEER la historia de un registro lo decide el módulo dueño del
// registro: `historial` no mira permisos.
'use strict';

const db = require('./db');
const repo = require('./repo/libro');

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
const ORIGEN_MAX = 40;   // lo que cabe en justificante_auditoria.origen (db/228)
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const usuario = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/**
 * La clave de un registro, como la guarda el disparador. Un Date de JavaScript
 * no vale: su texto no es el '2026-11-09' de la base (ver Trampas conocidas,
 * fechas sin toISOString).
 */
function claveDeRegistro(v) {
  if (v instanceof Date) throw new Error('El registro va como texto: una fecha, como aaaa-mm-dd (to_char en la consulta)');
  if (v == null || typeof v === 'object') throw new Error('Falta cuál: el registro va como texto o número');
  const s = String(v);
  if (!s.trim()) throw new Error('Falta cuál: el registro va como texto o número');
  return s;
}

/** El detalle de un apunte en JSON, con las fechas de un día como 'aaaa-mm-dd' (no el día anterior en UTC). */
function detalleJson(detalle) {
  if (detalle == null) return null;
  const pad = n => String(n).padStart(2, '0');
  return JSON.stringify(detalle, function (k, v) {
    const original = this[k];
    if (original instanceof Date) {
      const local = original.getHours() === 0 && original.getMinutes() === 0 && original.getSeconds() === 0
        && original.getMilliseconds() === 0;
      return local
        ? `${original.getFullYear()}-${pad(original.getMonth() + 1)}-${pad(original.getDate())}`
        : original.toISOString();   // un instante: su ISO es correcto
    }
    return v;
  });
}

/**
 * Firma lo que se va a escribir en ESTA transacción (`cli` es su conexión).
 *   usuarioId  quién (de la sesión, nunca del cuerpo de la petición)
 *   origen     desde dónde: la pantalla, la tarea programada…
 *   accion     opcional, para los cambios: si no, la deduce la base
 *   motivo     opcional: por qué (una reasignación, una anulación)
 */
async function firmar(cli, { usuarioId, origen, accion, motivo } = {}) {
  const acc = accion ? String(accion) : '';
  if (acc && !ACCION_VALIDA.test(acc)) throw new Error(`Acción de auditoría no válida: «${accion}»`);
  const n = usuario(usuarioId);
  const puesta = await repo.firmar(cli, {
    usuarioId: n ? String(n) : '', origen: texto(origen, ORIGEN_MAX), accion: acc, motivo: texto(motivo, 2000),
  });
  if (!puesta) throw new Error('libro.firmar va dentro de una transacción (db.transaccion o libro.conFirma): fuera, la firma se pierde');
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
  if (!t) throw new Error('Un apunte del libro dice de qué tabla y de qué registro');
  const r = claveDeRegistro(registro);
  if (!ACCION_VALIDA.test(String(accion || ''))) throw new Error(`Acción de auditoría no válida: «${accion}»`);
  return repo.insertarApunte({
    tabla: t, registro: r, accion, usuarioId: usuario(usuarioId),
    origen: texto(origen, 60) || null, motivo: texto(motivo, 2000) || null, detalle: detalleJson(detalle),
  }, cli);
}

/**
 * La historia de UN registro, de lo más viejo a lo más nuevo:
 * [{ accion, etiqueta, quien, origen, motivo, en, enIso, cambios: [{ campo, antes, despues }], detalle }].
 * `en` va en hora de Madrid, dd/mm/aaaa hh:mm.
 */
async function historial(tabla, registro) {
  const t = texto(tabla, 63);
  if (!t) throw new Error('Falta de qué tabla');
  const filas = await repo.historial(t, claveDeRegistro(registro));
  return filas.map(f => ({
    id: Number(f.id),
    accion: f.accion,
    etiqueta: ACCIONES[f.accion] || f.accion,
    quien: f.quien || null,
    origen: f.origen,
    motivo: f.motivo,
    en: f.en_texto,
    enIso: f.en instanceof Date ? f.en.toISOString() : f.en,   // un instante: su ISO es correcto
    cambios: f.cambios ? Object.entries(f.cambios).map(([campo, [antes, despues]]) => ({ campo, antes, despues })) : [],
    detalle: f.detalle,
  }));
}

module.exports = { ACCIONES, firmar, conFirma, apuntar, historial };
