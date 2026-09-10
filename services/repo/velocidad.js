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

/**
 * LOS EXCESOS A PROCESAR — de la ingesta, no de la API de Mapon.
 *
 * `mapon_alerta` la llena la ingesta cada 15 minutos con TODAS las alertas de
 * Mapon, y las de velocidad están ahí con la misma clave que usa este módulo para
 * no repetir avisos (`unit_id|instante|tipo`). O sea que el módulo salía a pedirle
 * a Mapon exactamente lo que la ingesta acababa de guardar.
 *
 * Se devuelven solo los que NO tienen ya su fila en `velocidad_exceso`: el dedup
 * deja de ser dos consultas y un Set en memoria y pasa a ser un NOT EXISTS.
 */
async function excesosPendientes({ desde, hasta, limite = 500 } = {}) {
  const r = await db.consulta(`
    SELECT a.clave, a.ocurrido_at, a.matricula, a.unit_id,
           a.velocidad::float8 AS velocidad, a.limite::float8 AS limite,
           a.exceso::float8 AS exceso, a.severidad, a.msg
      FROM mapon_alerta a
     WHERE a.tipo = 'speeding'
       AND ($1::timestamptz IS NULL OR a.ocurrido_at >= $1::timestamptz)
       AND ($2::timestamptz IS NULL OR a.ocurrido_at <= $2::timestamptz)
       AND NOT EXISTS (SELECT 1 FROM velocidad_exceso e WHERE e.clave = a.clave)
     ORDER BY a.ocurrido_at
     LIMIT $3`, [desde || null, hasta || null, Math.min(Number(limite) || 500, 5000)]);
  return r.rows.map(x => ({
    clave: x.clave,
    ocurridoAt: x.ocurrido_at,
    tMs: new Date(x.ocurrido_at).getTime(),
    matricula: x.matricula || '',
    unitId: x.unit_id || null,
    velocidad: x.velocidad, limite: x.limite, exceso: x.exceso,
    severidad: x.severidad || '', msg: x.msg || '',
  }));
}

/**
 * QUIÉN LLEVABA ESE COCHE EN ESE INSTANTE — de PostgreSQL, no de la API.
 *
 * La ingesta ya trae los cambios de estado de BOLT y los deja en `fv_tramo`:
 * vehículo, conductor y el intervalo en que lo llevó. O sea que la pregunta ya
 * estaba contestada en casa, y el módulo salía a preguntarla fuera.
 *
 * Lo que hacía antes: por cada exceso, hasta SIETE barridos paginados de
 * `getFleetStateLogs` con ventanas crecientes (15 min, 30, 1 h, 6 h, 24 h,
 * 3 días, 15 días) contra las dos flotas. La última ventana se descarga 65.884
 * logs y tarda 90 segundos —más los 429 de BOLT, que añaden 5 s cada uno—, y solo
 * para acabar diciendo "no hay conductor". Esto son 33 ms.
 *
 * Y ADEMÁS ES MÁS EXACTO. La API daba la antigüedad del último CAMBIO DE ESTADO
 * anterior al exceso; aquí se sabe si el instante cae DENTRO de un tramo, que es
 * la certeza de que esa persona estaba conectada en ese momento. Contrastado
 * contra los 30 excesos ya registrados: mismo conductor en los 24 resolubles,
 * cero discrepancias, y los 30 caen dentro de su tramo.
 *
 * Devuelve { driverUuid, dentro, antiguedadSeg, situacion, desde, hasta } o null.
 */
async function quienConducia(placa, ocurridoAt) {
  const p = String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!p) return null;
  const r = await db.consulta(`
    WITH veh AS (
      SELECT uuid FROM fv_vehiculo
       WHERE upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) = $1
       ORDER BY visto_at DESC NULLS LAST LIMIT 1)
    SELECT t.conductor_uuid, t.situacion, t.estado_bolt,
           COALESCE(cs.conectado, FALSE) AS conectado,
           -- El instante cae dentro del tramo. Un tramo ABIERTO no llega hasta el
           -- infinito: llega hasta su última señal, y por eso el límite superior
           -- es COALESCE(hasta, senal_at) y no "sin fin".
           (t.desde <= $2::timestamptz
            AND COALESCE(t.hasta, t.senal_at, t.desde) >= $2::timestamptz) AS dentro,
           -- Cuánto hace del último momento en que se SUPO quién lo llevaba.
           GREATEST(0, EXTRACT(EPOCH FROM
             ($2::timestamptz - COALESCE(t.hasta, t.senal_at, t.desde))))::int AS antiguedad,
           -- Y cuánto hace que empezó este tramo: si el tramo es de DESCONEXIÓN,
           -- esta es la antigüedad que cuenta.
           GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - t.desde)))::int AS desde_inicio,
           to_char(t.desde AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS desde,
           to_char(COALESCE(t.hasta, t.senal_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS hasta
      FROM fv_tramo t
      JOIN veh ON TRUE
      LEFT JOIN fv_cat_situacion cs ON cs.codigo = t.situacion
     WHERE t.vehiculo_uuid = veh.uuid
       AND t.conductor_uuid IS NOT NULL
       AND t.desde <= $2::timestamptz
     ORDER BY t.desde DESC
     LIMIT 1`, [p, ocurridoAt]);
  const x = r.rows[0];
  if (!x || !x.conductor_uuid) return null;

  // LA ANTIGÜEDAD DEPENDE DE SI ESTABA ENGANCHADO A BOLT O NO.
  //
  //   · Tramo CONECTADO (viaje, espera, descanso) que contiene el instante: esa
  //     persona estaba en la app en ese momento. Antigüedad CERO, certeza.
  //   · Tramo DESCONECTADO: es el último que tuvo el coche, pero desde que se
  //     desconectó nadie sabe quién va dentro —y estos tramos duran 91 minutos de
  //     media—. La antigüedad se cuenta desde que se desconectó, que es justo lo
  //     que mide la regla de la media hora. Contarlo como cero sería avisar a
  //     quien entregó el coche hace hora y media.
  //   · Fuera de todo tramo: desde que acabó el último.
  const dentroConectado = !!x.dentro && !!x.conectado;
  const antiguedadSeg = dentroConectado ? 0
    : (x.dentro ? Number(x.desde_inicio) || 0 : Number(x.antiguedad) || 0);

  return {
    driverUuid: x.conductor_uuid,
    dentro: dentroConectado,
    desconectado: !!x.dentro && !x.conectado,
    antiguedadSeg,
    situacion: x.situacion || '', estadoBolt: x.estado_bolt || '',
    desde: x.desde, hasta: x.hasta,
  };
}

/**
 * ¿Conoce la ingesta esa matrícula? Distingue "el coche no está en BOLT" de
 * "el coche está pero nadie lo llevaba", que son dos notas distintas en el libro.
 */
async function conoceMatricula(placa) {
  const p = String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!p) return false;
  const r = await db.consulta(
    `SELECT 1 FROM fv_vehiculo
      WHERE upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) = $1 LIMIT 1`, [p]);
  return r.rowCount > 0;
}

/**
 * Hasta cuándo llega la ingesta de BOLT. Si un exceso es POSTERIOR, todavía no se
 * puede saber quién conducía —y eso no es lo mismo que no hubiera nadie—.
 *
 * Se cachea un minuto: es un max() sobre un cuarto de millón de tramos y se
 * pregunta una vez por exceso.
 */
let _frescura = { ts: 0, valor: null };
async function frescuraIngesta() {
  if (_frescura.valor && Date.now() - _frescura.ts < 60000) return _frescura.valor;
  const r = await db.consulta(
    'SELECT max(GREATEST(desde, COALESCE(senal_at, desde))) AS ultimo FROM fv_tramo');
  _frescura = { ts: Date.now(), valor: r.rows[0] && r.rows[0].ultimo ? new Date(r.rows[0].ultimo) : null };
  return _frescura.valor;
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

module.exports = {
  ESTADOS, AVISADOS, padron, yaVistas, registrar, porConductor, historico, resumen,
  excesosPendientes, quienConducia, conoceMatricula, frescuraIngesta,
};
