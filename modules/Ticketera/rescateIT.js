// ============================================================
// EL RESCATE DE LOS TICKETS DE SOPORTE, UNA SOLA VEZ
// ============================================================
// Los tickets de «Soporte técnico» vivían en la hoja `TICKETS_IT`. Lo que haya
// abierto ahí mismo es trabajo pendiente de verdad: fallos reportados que aún no
// se han arreglado, mejoras pedidas. Perderlo al cambiar de sitio sería perder
// la cola de trabajo entera.
//
// Se trae solo, una vez, igual que la configuración y las fechas del padrón: los
// valores solo se pueden leer desde donde hay credenciales de Google —el
// servidor—, y pedirle a alguien que lance una migración a mano es pedirle que
// se acuerde. Queda apuntado en `config_app` para no repetirlo.
//
// Si la hoja no contesta no pasa nada y NO se marca como hecho: se reintenta en
// la siguiente mirada.

const db = require('../../services/db');

const LIBRO = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';   // el del planificador
const HOJA = 'TICKETS_IT';
const CLAVE = 'tickets_it_rescatados';

// El orden de columnas de la hoja, tal como lo escribía `services/ticketsIT`.
const COL = {
  id: 0, fecha_creacion: 1, solicitante_email: 2, solicitante_nombre: 3, solicitante_rol: 4,
  tipo: 5, prioridad: 6, titulo: 7, descripcion: 8, estado: 9, adjuntos: 10,
  notas_dev: 11, fecha_actualizacion: 12, fecha_resolucion: 13,
};

// Los cuatro estados de la hoja → los del catálogo. «Resuelto» es ejecutado y
// «Descartado» es no procede: significan lo mismo con otras palabras, y añadir
// dos estados más es como se llega a un desplegable donde nadie sabe qué elegir.
const ESTADO = {
  'Nuevo': 'pendiente', 'En curso': 'en_curso',
  'Resuelto': 'ejecutado', 'Descartado': 'no_procede',
};
const SUBTIPO = {
  'Bug': 'IT_BUG', 'Requerimiento': 'IT_REQUERIMIENTO', 'Mejora': 'IT_MEJORA',
  'Consulta': 'IT_CONSULTA', 'Otro': 'IT_OTRO',
};

/** 'dd/mm/aaaa hh:mm' → 'aaaa-mm-dd hh:mm:ss' (sin zona; la pone PostgreSQL). */
function cuando(v) {
  const m = String(v || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const p = n => String(n).padStart(2, '0');
  return `${m[3]}-${p(m[2])}-${p(m[1])} ${p(m[4] || 0)}:${m[5] || '00'}:00`;
}

async function yaHecho() {
  const r = await db.consulta('SELECT 1 FROM config_app WHERE clave = $1', [CLAVE]);
  return r.rows.length > 0;
}

/** Trae lo que haya en la hoja. Devuelve null si no se pudo mirar. */
async function rescatar() {
  if (await yaHecho()) return null;

  let filas;
  try {
    const { readSheet } = require('../../services/sheets');
    filas = await readSheet(LIBRO, `${HOJA}!A:N`);
  } catch (e) {
    console.error('⚠️  [SOPORTE] no se pudo mirar la hoja para el rescate:', e.message);
    return null;
  }

  let traidos = 0, sinUsuario = 0;
  for (let i = 1; i < (filas || []).length; i++) {
    const f = filas[i];
    const ref = String(f[COL.id] || '').trim();
    if (!ref) continue;

    const estado = ESTADO[String(f[COL.estado] || '').trim()] || 'pendiente';
    const cierra = estado === 'ejecutado' || estado === 'no_procede';
    let adjuntos = [];
    try { const a = JSON.parse(f[COL.adjuntos] || '[]'); if (Array.isArray(a)) adjuntos = a; } catch (_) {}

    // El solicitante venía como CORREO. Se busca su cuenta para atarlo de
    // verdad; si ya no existe (alguien que se fue), se conserva el nombre.
    const u = (await db.consulta(
      'SELECT id FROM usuario WHERE lower(email) = lower($1)',
      [String(f[COL.solicitante_email] || '').trim()])).rows[0];
    if (!u) sinUsuario++;

    // El código viejo (IT-xxxxx) se conserva TAL CUAL: está en conversaciones y
    // en correos. Los nuevos llevan el formato de la ticketera.
    const r = await db.consulta(
      `INSERT INTO ticket
         (codigo, origen, usuario_id, nombre, area_codigo, subtipo_codigo,
          tipo_gestion, prioridad, descripcion, notas, adjuntos, estado,
          creado_at, resuelto_at)
       VALUES ($1, 'soporte', $2, $3, 'IT', $4, $5, $6, $7, $8, $9::jsonb, $10,
               COALESCE($11::timestamp AT TIME ZONE 'Europe/Madrid', now()),
               CASE WHEN $12 THEN COALESCE($13::timestamp AT TIME ZONE 'Europe/Madrid', now()) END)
       ON CONFLICT (codigo) DO NOTHING
       RETURNING id`,
      [ref, u ? u.id : null, String(f[COL.solicitante_nombre] || '').trim() || null,
       SUBTIPO[String(f[COL.tipo] || '').trim()] || 'IT_OTRO',
       String(f[COL.titulo] || '').trim() || null,
       String(f[COL.prioridad] || '').trim() || null,
       String(f[COL.descripcion] || '').trim() || null,
       String(f[COL.notas_dev] || '').trim() || null,
       JSON.stringify(adjuntos), estado,
       cuando(f[COL.fecha_creacion]), cierra, cuando(f[COL.fecha_resolucion])]);
    if (r.rows.length) traidos++;
  }

  await db.consulta(
    `INSERT INTO config_app (clave, valor) VALUES ($1, $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_at = now()`,
    [CLAVE, `${traidos} el ${new Date().toISOString().slice(0, 10)}`]);

  console.log(`⚙️  [SOPORTE] ${traidos} ticket(s) traídos de la hoja TICKETS_IT ` +
    `(${sinUsuario} sin cuenta que enlazar). La hoja ya no se vuelve a mirar.`);
  return traidos;
}

module.exports = { rescatar };
