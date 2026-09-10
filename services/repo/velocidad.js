// ============================================================
// EXCESOS DE VELOCIDAD — la capa de datos
// ============================================================
// Guardar un exceso, saber cuáles ya se registraron, y las dos preguntas que se
// le hacen al módulo: quién acumula avisos, y qué ha pasado.

const db = require('../db');

const ESTADOS = ['avisado', 'simulado', 'sin_conductor', 'dudoso', 'error'];

/**
 * "Avisado" es SOLO 'avisado'. Un 'simulado' es un exceso que en modo pruebas
 * se habría avisado y no se avisó: al conductor no le llegó nada.
 *
 * Los tuve juntos y estaba mal. La lista de "quién no hace caso" es lo que
 * alguien lleva delante cuando se sienta a hablar con un conductor, y decirle
 * "te hemos avisado cinco veces" cuando no ha recibido ni uno es la peor manera
 * posible de empezar esa conversación. Los simulados se cuentan aparte y se ven
 * aparte.
 */
const AVISADOS = ['avisado'];

const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const dec = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * uuid de BOLT → { nombre, telefono, conductorId }.
 *
 * Sale de `conductor_externo`, que la ingesta refresca cada hora y que tiene el
 * teléfono de las 1.626 cuentas. Antes esto venía de dos hojas de cálculo
 * encadenadas —el padrón y una tabla de teléfonos por nombre— con un `.catch()`
 * en cada una: cuando fallaban, el módulo se quedaba sin teléfono y el aviso no
 * salía, sin que nadie se enterara de por qué.
 *
 * El nombre de BOLT manda, como en el resto del sistema.
 */
async function padron() {
  const r = await db.consulta(`
    SELECT e.externo_id AS uuid, e.conductor_id,
           COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                    NULLIF(btrim(e.externo_nombre), ''),
                    NULLIF(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')), '')) AS nombre,
           NULLIF(btrim(e.externo_telefono), '') AS telefono
      FROM conductor_externo e
      LEFT JOIN conductor c ON c.id = e.conductor_id
     WHERE e.sistema = 'bolt' AND e.externo_id IS NOT NULL`);
  return new Map(r.rows.map(x => [x.uuid, {
    nombre: x.nombre || '', telefono: x.telefono || '', conductorId: x.conductor_id || null,
  }]));
}

/** Las claves de Mapon ya registradas desde una fecha. Es el dedup. */
async function yaVistas(desdeIso) {
  const r = await db.consulta(
    `SELECT clave FROM velocidad_exceso WHERE ocurrido_at >= $1::timestamptz`,
    [desdeIso]);
  return new Set(r.rows.map(x => x.clave));
}

/**
 * Registra un exceso. Si la clave ya está, NO se toca: un exceso registrado es
 * un hecho, y una segunda pasada del cron no puede reescribirlo ni mandar otro
 * aviso por lo mismo.
 */
async function registrar(e) {
  const r = await db.consulta(`
    INSERT INTO velocidad_exceso (clave, ocurrido_at, placa, vehiculo_id, driver_uuid,
      conductor_id, conductor, telefono, velocidad, limite, exceso, lat, lng,
      estado, plantilla, envio_id, enviado_at, ventana_seg, nota)
    SELECT $1, $2::timestamptz, $3, v.id, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18
      FROM (SELECT 1) z
      LEFT JOIN vehiculo v ON v.matricula_norm = $3 AND v.baja_at IS NULL
    ON CONFLICT (clave) DO NOTHING
    RETURNING clave`,
    [txt(e.clave, 80), e.ocurridoAt, txt(e.placa, 16), txt(e.driverUuid, 64),
      e.conductorId || null, txt(e.conductor, 120), txt(e.telefono, 24),
      dec(e.velocidad), dec(e.limite), dec(e.exceso), dec(e.lat), dec(e.lng),
      ESTADOS.includes(e.estado) ? e.estado : 'error', txt(e.plantilla, 40),
      txt(e.envioId, 80), e.enviadoAt || null,
      e.ventanaSeg == null ? null : Math.round(e.ventanaSeg), txt(e.nota, 2000)]);
  return r.rowCount > 0;
}

/**
 * EL RECUENTO: cuántas veces se le ha dicho a cada uno, y cuántas ha seguido
 * corriendo igual. Ordenado por avisos, que es la lista que se mira.
 *
 * `desde_el_primero` es lo que separa a quien tuvo un mal día de quien lleva
 * meses ignorándolo: diez avisos en tres días son una racha, diez en seis meses
 * son una costumbre.
 */
async function porConductor({ desde, hasta, limite = 300 } = {}) {
  const r = await db.consulta(`
    SELECT COALESCE(e.conductor, e.driver_uuid, '(sin identificar)') AS conductor,
           e.conductor_id, e.driver_uuid,
           max(e.telefono) AS telefono,
           count(*)::int                                               AS excesos,
           count(*) FILTER (WHERE e.estado = ANY($3))::int             AS avisos,
           count(*) FILTER (WHERE e.estado = 'simulado')::int          AS simulados,
           count(*) FILTER (WHERE e.estado = 'error')::int             AS fallos,
           max(e.velocidad)::float8                                    AS punta,
           round(avg(e.exceso), 1)::float8                             AS exceso_medio,
           count(DISTINCT e.placa)::int                                AS coches,
           to_char(min(e.ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS primero,
           to_char(max(e.ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS ultimo,
           GREATEST(1, (max(e.ocurrido_at)::date - min(e.ocurrido_at)::date) + 1)::int   AS dias_entre
      FROM velocidad_exceso e
     WHERE e.ocurrido_at BETWEEN $1::timestamptz AND $2::timestamptz
       AND e.driver_uuid IS NOT NULL
     GROUP BY 1, 2, 3
     ORDER BY count(*) FILTER (WHERE e.estado = ANY($3)) DESC, count(*) DESC
     LIMIT $4`, [desde, hasta, AVISADOS, Math.min(Number(limite) || 300, 1000)]);
  return r.rows;
}

/** El histórico, lo último primero. */
async function historico({ desde, hasta, estado, conductorId, driverUuid, limite = 500 } = {}) {
  const par = [desde, hasta];
  let extra = '';
  if (estado === 'revisar') extra += ` AND e.estado IN ('sin_conductor','dudoso','error')`;
  else if (ESTADOS.includes(estado)) { par.push(estado); extra += ` AND e.estado = $${par.length}`; }
  if (conductorId) { par.push(Number(conductorId)); extra += ` AND e.conductor_id = $${par.length}`; }
  if (driverUuid) { par.push(String(driverUuid)); extra += ` AND e.driver_uuid = $${par.length}`; }
  par.push(Math.min(Number(limite) || 500, 5000));

  const r = await db.consulta(`
    SELECT e.clave,
           to_char(e.ocurrido_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS cuando,
           e.placa, e.conductor, e.conductor_id, e.driver_uuid, e.telefono,
           e.velocidad::float8, e.limite::float8, e.exceso::float8,
           e.lat::float8, e.lng::float8, e.estado, e.plantilla, e.ventana_seg, e.nota,
           to_char(e.enviado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS enviado
      FROM velocidad_exceso e
     WHERE e.ocurrido_at BETWEEN $1::timestamptz AND $2::timestamptz ${extra}
     ORDER BY e.ocurrido_at DESC
     LIMIT $${par.length}`, par);
  return r.rows;
}

/** Las cifras de la cabecera. */
async function resumen({ desde, hasta } = {}) {
  const r = await db.consulta(`
    SELECT count(*)::int                                          AS excesos,
           count(*) FILTER (WHERE estado = ANY($3))::int           AS avisos,
           count(*) FILTER (WHERE estado = 'simulado')::int        AS simulados,
           count(*) FILTER (WHERE estado = 'error')::int           AS fallos,
           count(*) FILTER (WHERE estado IN ('sin_conductor','dudoso'))::int AS sin_avisar,
           count(DISTINCT driver_uuid) FILTER (WHERE driver_uuid IS NOT NULL)::int AS gente,
           max(velocidad)::float8                                  AS punta
      FROM velocidad_exceso
     WHERE ocurrido_at BETWEEN $1::timestamptz AND $2::timestamptz`,
    [desde, hasta, AVISADOS]);
  return r.rows[0];
}

module.exports = { ESTADOS, AVISADOS, padron, yaVistas, registrar, porConductor, historico, resumen };
