// ============================================================
// DOCUMENTOS — índice en PostgreSQL, bytes en Drive
// ============================================================
// La base guarda QUÉ es cada documento, de quién, cuándo caduca y quién lo
// subió. Los bytes siguen en Drive, detrás de `almacen` + `externo_id`.
//
// Lo que esto arregla del montaje anterior:
//   · La carpeta de Drive se llamaba con el DNI o, si no había, con el NOMBRE.
//     Cuando llegaba el DNI se creaba una segunda carpeta y los archivos de la
//     primera quedaban huérfanos. Aquí la carpeta se llama con el ID.
//   · Nadie sabía qué era cada archivo. Ahora tiene tipo, y con el tipo vienen
//     las preguntas que importan: a quién le caduca el permiso, a quién le
//     falta el contrato.
//
// El día que los bytes se muden a otro sitio, se añade otro almacén a `ALMACEN`
// y el resto del sistema no se entera.

const db = require('../db');
const audit = require('./auditoria');

// ---------- almacenes ----------
// Cada uno sabe subir, borrar y descargar. Nada más: la base lleva el índice.
const ALMACEN = {
  drive: {
    async subir({ carpeta, nombre, mime, base64 }) {
      const drive = require('../drive');
      const f = await drive.subir(carpeta, { nombre, mime, base64 });
      return { externoId: f.id, enlace: f.webViewLink, bytes: Number(f.size) || null, mime: f.mimeType };
    },
    async borrar(externoId) {
      const drive = require('../drive');
      return drive.borrar(externoId);
    },
    async descargar(externoId) {
      const drive = require('../drive');
      return drive.descargar(externoId);
    },
  },
};

/**
 * La carpeta donde van los archivos de una entidad.
 *
 * Se nombra con el ID y no con el nombre ni el DNI. Es la corrección de fondo:
 * el nombre cambia, el DNI puede llegar tarde, y cualquiera de las dos cosas
 * partía los documentos de una persona en dos carpetas.
 */
const carpetaDe = (ambito, id) => `${ambito}-${id}`;

/** Comprueba el dueño y devuelve las columnas con las que consultarlo. */
function duenio({ conductorId, vehiculoId }) {
  if (conductorId && vehiculoId) throw new Error('Un documento es de una persona o de un coche, no de las dos');
  if (conductorId) return { col: 'conductor_id', id: Number(conductorId), ambito: 'conductor' };
  if (vehiculoId) return { col: 'vehiculo_id', id: Number(vehiculoId), ambito: 'vehiculo' };
  throw new Error('Falta de quién es el documento');
}

// ---------- lectura ----------

/** Los tipos que se pueden subir en cada ámbito. */
async function tipos(ambito) {
  const r = await db.consulta(
    `SELECT codigo, etiqueta, caduca, obligatorio, aviso_dias
       FROM cat_tipo_documento
      WHERE activo AND ($1::text IS NULL OR ambito = $1)
      ORDER BY orden, etiqueta`, [ambito || null]);
  return r.rows;
}

/**
 * Los documentos de una persona o de un coche, con su estado de caducidad ya
 * resuelto para que ninguna pantalla lo calcule por su cuenta.
 */
async function listar({ conductorId, vehiculoId, incluirReemplazados = false } = {}) {
  const d = duenio({ conductorId, vehiculoId });
  const r = await db.consulta(`
    SELECT dc.id, dc.tipo, t.etiqueta AS tipo_etiqueta, t.caduca AS tipo_caduca, t.obligatorio,
           dc.almacen, dc.externo_id, dc.enlace, dc.nombre_archivo, dc.mime, dc.bytes,
           dc.fecha_emision, dc.fecha_caduca, dc.vigente, dc.notas,
           dc.subido_at, dc.reemplaza_a,
           (dc.fecha_caduca - CURRENT_DATE)                          AS dias_caduca,
           (dc.fecha_caduca IS NOT NULL AND dc.fecha_caduca < CURRENT_DATE) AS caducado,
           u.nombre AS subido_nombre, u.email AS subido_email
      FROM documento dc
      JOIN cat_tipo_documento t ON t.codigo = dc.tipo
      LEFT JOIN usuario u ON u.id = dc.subido_por
     WHERE dc.${d.col} = $1
       AND ($2 OR dc.vigente)
     ORDER BY dc.vigente DESC, t.orden, dc.subido_at DESC`,
    [d.id, incluirReemplazados]);
  return r.rows;
}

/** Qué documentación obligatoria le falta. Sale de la vista, definición única. */
async function faltantes(conductorId) {
  const r = await db.consulta(
    'SELECT tipo, etiqueta FROM v_documento_falta WHERE conductor_id = $1 ORDER BY tipo', [conductorId]);
  return r.rows;
}

/** Lo mismo para MUCHOS a la vez, que es lo que necesita el listado. */
async function faltantesDeVarios(conductorIds) {
  if (!conductorIds || !conductorIds.length) return new Map();
  const r = await db.consulta(
    'SELECT conductor_id, tipo, etiqueta FROM v_documento_falta WHERE conductor_id = ANY($1)',
    [conductorIds]);
  const m = new Map();
  for (const x of r.rows) {
    if (!m.has(x.conductor_id)) m.set(x.conductor_id, []);
    m.get(x.conductor_id).push(x.etiqueta);
  }
  return m;
}

/** Lo que caduca pronto, de personas y de coches. Para el panel de avisos. */
async function porVencer({ dias } = {}) {
  const r = await db.consulta(`
    SELECT v.*,
           COALESCE(btrim(COALESCE(c.apellidos || ', ', '') || c.nombre), veh.matricula) AS duenio
      FROM v_documento_vence v
      LEFT JOIN conductor c  ON c.id  = v.conductor_id
      LEFT JOIN vehiculo veh ON veh.id = v.vehiculo_id
     WHERE $1::int IS NULL OR v.dias <= $1
     ORDER BY v.dias`, [dias == null ? null : Number(dias)]);
  return r.rows;
}

// ---------- escritura ----------

/**
 * Sube un documento y lo indexa.
 *
 * Si ya había uno vigente de ese tipo, el anterior NO se borra: se marca como
 * reemplazado y el nuevo apunta a él. Así se puede saber qué documentación
 * tenía esta persona en una fecha pasada, que es justo lo que hace falta cuando
 * alguien pregunta por qué se dejó conducir a fulano en marzo.
 *
 * El archivo se sube ANTES de tocar la base. Si la base fallara, quedaría un
 * archivo suelto en Drive — molesto pero inofensivo. Al revés (índice sin
 * archivo) sería una ficha que dice tener un documento que no existe.
 */
async function subir({ conductorId, vehiculoId, tipo, nombre, mime, base64,
                       fechaEmision, fechaCaduca, notas, almacen = 'drive' }, { usuarioId } = {}) {
  const d = duenio({ conductorId, vehiculoId });
  const motor = ALMACEN[almacen];
  if (!motor) throw new Error(`Almacén desconocido: "${almacen}"`);

  const t = (await db.consulta(
    'SELECT codigo, etiqueta, ambito, caduca FROM cat_tipo_documento WHERE codigo = $1 AND activo', [tipo])).rows[0];
  if (!t) throw new Error(`Tipo de documento desconocido: "${tipo}"`);
  if (t.ambito !== d.ambito) throw new Error(`"${t.etiqueta}" es un documento de ${t.ambito}, no de ${d.ambito}`);
  if (t.caduca && !fechaCaduca) throw new Error(`"${t.etiqueta}" caduca: hace falta la fecha de caducidad`);

  const subido = await motor.subir({
    carpeta: carpetaDe(d.ambito, d.id), nombre, mime, base64,
  });

  try {
    return await db.transaccion(async cli => {
      const previo = (await cli.query(
        `SELECT id FROM documento WHERE ${d.col} = $1 AND tipo = $2 AND vigente`, [d.id, tipo])).rows[0];
      if (previo) {
        await cli.query('UPDATE documento SET vigente = FALSE WHERE id = $1', [previo.id]);
      }
      const r = await cli.query(
        `INSERT INTO documento (${d.col}, tipo, almacen, externo_id, enlace, nombre_archivo,
                                mime, bytes, fecha_emision, fecha_caduca, notas, reemplaza_a, subido_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [d.id, tipo, almacen, subido.externoId, subido.enlace || null, nombre,
         subido.mime || mime || null, subido.bytes, fechaEmision || null, fechaCaduca || null,
         notas || null, previo ? previo.id : null, usuarioId || null]);

      await audit.registrar({
        tabla: d.ambito, id: d.id, usuarioId, cli,
        cambios: [{ campo: 'documento:' + tipo, antes: previo ? 'sustituido' : null, ahora: nombre }],
      });
      return r.rows[0];
    });
  } catch (e) {
    // La base no lo aceptó: se retira el archivo para no dejar basura en Drive.
    await motor.borrar(subido.externoId).catch(() => {});
    throw e;
  }
}

/**
 * Retira un documento. Por omisión solo lo marca como no vigente y el archivo
 * se queda: un documento borrado del todo no se puede volver a mirar, y estos
 * son papeles laborales. `borrarArchivo` fuerza el borrado real.
 */
async function retirar(id, { borrarArchivo = false, usuarioId } = {}) {
  return db.transaccion(async cli => {
    const doc = (await cli.query('SELECT * FROM documento WHERE id = $1', [id])).rows[0];
    if (!doc) throw new Error('Ese documento no existe');

    if (borrarArchivo) {
      const motor = ALMACEN[doc.almacen];
      if (motor) await motor.borrar(doc.externo_id).catch(e => {
        console.error(`⚠️  [DOCUMENTOS] No se pudo borrar ${doc.externo_id}: ${e.message}`);
      });
      await cli.query('DELETE FROM documento WHERE id = $1', [id]);
    } else {
      await cli.query('UPDATE documento SET vigente = FALSE WHERE id = $1', [id]);
    }

    const ambito = doc.conductor_id ? 'conductor' : 'vehiculo';
    await audit.registrar({
      tabla: ambito, id: doc.conductor_id || doc.vehiculo_id, usuarioId, cli,
      cambios: [{ campo: 'documento:' + doc.tipo,
                  antes: doc.nombre_archivo,
                  ahora: borrarArchivo ? null : '(retirado)' }],
    });
    return true;
  });
}

/** Corrige las fechas o las notas sin volver a subir el archivo. */
async function actualizar(id, { fechaEmision, fechaCaduca, notas }, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    const antes = (await cli.query('SELECT * FROM documento WHERE id = $1', [id])).rows[0];
    if (!antes) throw new Error('Ese documento no existe');
    await cli.query(
      `UPDATE documento SET fecha_emision = COALESCE($2, fecha_emision),
                            fecha_caduca  = COALESCE($3, fecha_caduca),
                            notas         = COALESCE($4, notas)
        WHERE id = $1`,
      [id, fechaEmision || null, fechaCaduca || null, notas || null]);
    const ahora = (await cli.query('SELECT * FROM documento WHERE id = $1', [id])).rows[0];
    await audit.registrar({
      tabla: 'documento', id, antes, ahora, usuarioId, cli,
      ignorar: ['subido_at', 'externo_id', 'enlace'],
    });
    return ahora;
  });
}

/** Trae los bytes para servirlos. La base dice dónde están; el almacén los da. */
async function descargar(id) {
  const doc = (await db.consulta('SELECT * FROM documento WHERE id = $1', [id])).rows[0];
  if (!doc) throw new Error('Ese documento no existe');
  const motor = ALMACEN[doc.almacen];
  if (!motor) throw new Error(`Almacén desconocido: "${doc.almacen}"`);
  const { bytes, mime } = await motor.descargar(doc.externo_id);
  return { bytes, mime: mime || doc.mime, nombre: doc.nombre_archivo };
}

module.exports = {
  tipos, listar, faltantes, faltantesDeVarios, porVencer,
  subir, retirar, actualizar, descargar,
  carpetaDe, ALMACEN,
};
