// ============================================================
// BARCELONA · REPOSITORIO — sus conductores, sus coches y su planificador
// ============================================================
// Todo lo de una sede que no es la vigilada (Madrid) vive en tablas suyas
// (db/181 y db/234): sus cuentas de BOLT (conductor_externo, de la empresa de
// esa sede), sus coches de BOLT (sede_bolt_vehiculo), sus asignaciones
// (sede_asignacion), sus zonas y cuadrantes (sede_zona, sede_cuadrante,
// sede_coche), sus periodos con correturnos (sede_coche_ct), sus descansos
// (sede_descanso) y sus cambios de estado (sede_bolt_state_log). Las consultas
// llevan la sede como parámetro: la próxima sede no pide otro repositorio.
//
// Aquí solo hay SQL. Qué se puede escribir y qué no (un CT en un coche sin CT,
// dos bloques que comparten día, quién choca consigo mismo) lo decide el
// servicio con las reglas de barcelona.plan.js.
//
// Hasta que se aplique db/181 (o db/234) las tablas o sus columnas no existen:
// `faltaMigracion(e)` lo reconoce y `queFalta()` dice cuál, para que la pantalla
// lo diga en vez de dar un error.

const db = require('../../services/db');

/**
 * ¿El error es que falta una migración? 42P01: no existe la tabla (sin db/181,
 * o sin las de db/234). El 42703 (no existe la columna: el `rol` sin db/234) NO
 * está aquí a propósito: también es una columna mal escrita, y el reporte, la
 * semana y la Visibilidad usan esto sin preguntar más, así que se tragarían un
 * error de verdad. Ese lo acepta solo barcelona.service.migracionQueFalta, que
 * se lo pregunta a `queFalta()` antes de decirlo.
 */
const faltaMigracion = e => !!e && e.code === '42P01';

/** Qué migración de Barcelona falta: 'db/181', 'db/234' o null si están las dos. */
async function queFalta() {
  const r = await db.consulta(
    `SELECT to_regclass('sede_asignacion') IS NOT NULL AS m181,
            to_regclass('sede_descanso') IS NOT NULL AND to_regclass('sede_coche_ct') IS NOT NULL
              AND to_regclass('sede_cuadrante') IS NOT NULL
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'sede_asignacion' AND column_name = 'rol') AS m234`);
  const x = r.rows[0] || {};
  if (!x.m181) return 'db/181';
  if (!x.m234) return 'db/234';
  return null;
}

/**
 * Las cuentas de BOLT de la sede (la empresa de BOLT de esa sede, `flota.sede`).
 * Todas, activas o no: una desactivada puede seguir en una asignación vieja y
 * hace falta su nombre. Quién se ofrece lo decide el servicio.
 */
async function conductores(sede) {
  const r = await db.consulta(
    `SELECT ce.externo_id AS uuid,
            btrim(COALESCE(ce.externo_nombre, '')) AS nombre,
            COALESCE(ce.externo_telefono, '') AS telefono,
            ce.estado_externo AS estado
       FROM conductor_externo ce
       JOIN flota f ON f.company_id = ce.bolt_company_id AND f.sede = $1
      WHERE ce.sistema = 'bolt'
      ORDER BY 2`, [sede]);
  return r.rows;
}

/**
 * LOS COCHES DE LA SEDE, uno por matrícula: los de su empresa de BOLT (el
 * último que BOLT devolvió) MÁS los del maestro de Vehículos con esa sede que
 * no están de baja. Camilo, 07/10/2026: hay coches de Barcelona que aún no
 * están dados de alta en BOLT (la 3035LTX) y hay que poder planificarlos.
 * Vehículos es quien dice de qué sede es cada coche; BOLT, si puede trabajar.
 *
 * Cada fila dice de dónde sale: `enBolt` (con su `estado` de BOLT) y `enErp`.
 */
async function coches(sede) {
  const r = await db.consulta(
    `WITH bolt AS (
       SELECT DISTINCT ON (matricula) uuid, matricula, modelo, estado_bolt, visto_at
         FROM sede_bolt_vehiculo
        WHERE sede = $1
        ORDER BY matricula, visto_at DESC
     ), erp AS (
       SELECT DISTINCT ON (matricula_norm) matricula_norm AS matricula, marca_modelo AS modelo
         FROM vehiculo
        WHERE sede = $1 AND baja_at IS NULL AND matricula_norm IS NOT NULL
        ORDER BY matricula_norm, id DESC
     )
     SELECT b.uuid, COALESCE(b.matricula, e.matricula) AS matricula,
            COALESCE(NULLIF(b.modelo, ''), e.modelo, '') AS modelo,
            COALESCE(b.estado_bolt, '') AS estado,
            (b.matricula IS NOT NULL) AS "enBolt", (e.matricula IS NOT NULL) AS "enErp", b.visto_at
       FROM bolt b
       FULL JOIN erp e ON e.matricula = b.matricula
      ORDER BY 2`, [sede]);
  return r.rows;
}

// ── El planificador: lo que se lee ──────────────────────────────────────────

const COLS_ASIG = `id::text AS id, matricula, turno, driver_uuid AS uuid,
            to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta`;

/**
 * Las asignaciones que tocan un rango de días, SIN rol ni días: la forma de
 * db/181. Es la red del rato entre desplegar y aplicar db/234 (el servicio la
 * usa solo entonces): sin db/234 todas eran fijas y nadie libraba.
 */
async function asignacionesEntre(sede, desde, hasta) {
  const r = await db.consulta(
    `SELECT ${COLS_ASIG}
       FROM sede_asignacion
      WHERE sede = $1 AND desde <= $3::date AND (hasta IS NULL OR hasta >= $2::date)`, [sede, desde, hasta]);
  return r.rows.map(a => ({ ...a, rol: 'fijo', dias: null }));
}

/**
 * EL PLANIFICADOR DE UNAS FECHAS (las dos incluidas): las asignaciones con su
 * rol y sus días, los periodos con CT y los descansos que las tocan. Es lo que
 * necesita barcelona.plan.crear para decir quién trabaja y quién libra.
 * Lo escrito para más adelante dentro del rango también viene: las
 * comprobaciones de la semana lo necesitan.
 */
async function planEntre(sede, desde, hasta) {
  const [a, c, d] = await Promise.all([
    db.consulta(
      `SELECT ${COLS_ASIG}, rol, dias
         FROM sede_asignacion
        WHERE sede = $1 AND desde <= $3::date AND (hasta IS NULL OR hasta >= $2::date)`, [sede, desde, hasta]),
    db.consulta(
      `SELECT matricula, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta
         FROM sede_coche_ct
        WHERE sede = $1 AND desde <= $3::date AND (hasta IS NULL OR hasta >= $2::date)`, [sede, desde, hasta]),
    db.consulta(
      `SELECT matricula, turno, dias, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta
         FROM sede_descanso
        WHERE sede = $1 AND desde <= $3::date AND (hasta IS NULL OR hasta >= $2::date)`, [sede, desde, hasta]),
  ]);
  const numeros = x => (x || []).map(Number);
  return {
    asignaciones: a.rows.map(x => ({ ...x, dias: x.dias ? numeros(x.dias) : null })),
    cts: c.rows,
    descansos: d.rows.map(x => ({ ...x, turno: x.turno || null, dias: numeros(x.dias) })),
  };
}

/**
 * LA FORMA DEL PLANIFICADOR: las zonas (todas, con `activa`), los cuadrantes
 * vivos y en qué cuadrante vivo está cada coche.
 */
async function estructura(sede) {
  const [z, q, c] = await Promise.all([
    db.consulta(
      `SELECT id::text AS id, nombre, activa FROM sede_zona WHERE sede = $1 ORDER BY lower(nombre), id`, [sede]),
    db.consulta(
      `SELECT id::text AS id, numero, nombre, zona_id::text AS "zonaId"
         FROM sede_cuadrante WHERE sede = $1 AND baja_at IS NULL ORDER BY numero`, [sede]),
    db.consulta(
      `SELECT sc.matricula, sc.cuadrante_id::text AS "cuadranteId"
         FROM sede_coche sc
         JOIN sede_cuadrante q ON q.id = sc.cuadrante_id AND q.baja_at IS NULL
        WHERE sc.sede = $1
        ORDER BY sc.matricula`, [sede]),
  ]);
  return { zonas: z.rows, cuadrantes: q.rows, cochesCuadrante: c.rows };
}

// ── El planificador: lo que se escribe ──────────────────────────────────────
// Las reglas (qué se puede y qué no) las decide el servicio con
// barcelona.plan.js; aquí solo se guarda, y siempre igual que Madrid: lo vigente
// el día que se escribe se CIERRA la víspera (el pasado no se borra: el reporte
// de un día viejo tiene que seguir sabiendo qué había), lo que aún no había
// empezado se BORRA (no llegó a valer), y lo escrito para más adelante se
// RESPETA (lo nuevo dura hasta su víspera).

const VISPERA = `$2::date - 1`;

/**
 * PONER (O QUITAR) A ALGUIEN EN UNA PLAZA (matrícula + turno + rol) DESDE UN DÍA.
 *
 * Fija hasta que se cambie (Camilo, 07/10/2026), y como Madrid (colocar y
 * liberar de planificador.repo):
 *
 *   · Lo que VALE ese día en la plaza se CIERRA la víspera (`hasta`): el reporte
 *     de un día viejo sigue sabiendo a quién le tocaba. Si empezaba ese mismo
 *     día (una corrección), no llegó a valer y se borra.
 *   · Lo escrito para MÁS ADELANTE en la plaza se RESPETA: lo nuevo dura hasta
 *     su víspera (auto-corte). Si eso siguiente es de la misma persona (con los
 *     mismos días, si es CT) y cabe, se le adelanta el «desde»: una fila, no dos.
 *   · Sin persona, la plaza queda libre desde ese día hasta lo siguiente.
 *
 * Si un FIJO ya estaba de fijo en otra matrícula del mismo turno, SE MUEVE:
 * aquella se cierra igual. Si tiene otra plaza fija escrita para más adelante
 * en ese turno, lo nuevo acaba la víspera. La base no deja dos plazas fijas
 * abiertas por persona y turno (uq_sede_asig_conductor), así que esto no es
 * cortesía: sin ello fallaría. Un CT no se mueve: lleva varios coches.
 *
 * `hasta`: el último día que puede durar lo nuevo (en un CT, el último día con
 * CT del coche, que pone el servicio; db/235 no deja pasarse). `dias`, solo en
 * un CT. Devuelve { cambio, movidaDe }.
 */
async function asignarEn(cli, { sede, matricula, turno, rol = 'fijo', driverUuid, dias = null, desde, hasta = null, usuarioId }) {
  // Lo que vale el día que se escribe o empieza después, de lo más antiguo a lo
  // más nuevo, con su víspera ya hecha (para el auto-corte).
  const filas = async (donde, params) => (await cli.query(
    `SELECT id, matricula, driver_uuid AS uuid, dias, to_char(desde, 'YYYY-MM-DD') AS desde,
            to_char(hasta, 'YYYY-MM-DD') AS hasta, to_char(desde - 1, 'YYYY-MM-DD') AS "diaAntes"
       FROM sede_asignacion WHERE ${donde} AND (hasta IS NULL OR hasta >= $2::date)
      ORDER BY desde, id FOR UPDATE`, params)).rows;
  const cerrar = async x => {
    if (x.desde >= desde) await cli.query('DELETE FROM sede_asignacion WHERE id = $1', [x.id]);
    else {
      await cli.query(
        `UPDATE sede_asignacion SET hasta = $2::date - 1, cerrado_por = $3, cerrado_at = now() WHERE id = $1`,
        [x.id, desde, usuarioId || null]);
    }
  };
  const ct = rol === 'ct';
  const mismosDias = x => !ct || JSON.stringify((x.dias || []).map(Number)) === JSON.stringify(dias || []);
  const antes = (a, b) => (a == null ? b : b == null ? a : (a < b ? a : b));   // el «hasta» más corto (null = sin fin)

  const plaza = await filas('sede = $1 AND matricula = $3 AND turno = $4 AND rol = $5', [sede, desde, matricula, turno, rol]);
  const vigentes = plaza.filter(x => x.desde <= desde);
  const sig = plaza.find(x => x.desde > desde) || null;
  // Un fijo: sus plazas fijas de ese turno en OTRAS matrículas. La de ese día se
  // cierra (se mueve); la primera de más adelante pone el límite.
  const suyas = driverUuid && !ct
    ? await filas(`sede = $1 AND driver_uuid = $3 AND turno = $4 AND rol = 'fijo' AND matricula <> $5`, [sede, desde, driverUuid, turno, matricula])
    : [];
  const suyaSig = suyas.find(x => x.desde > desde) || null;
  // Hasta dónde llega lo nuevo.
  const fin = antes(antes(hasta || null, sig ? sig.diaAntes : null), suyaSig ? suyaSig.diaAntes : null);

  // Lo mismo que ya había, desde antes y hasta el mismo día: no hay nada que cambiar.
  if (driverUuid && vigentes.length === 1 && vigentes[0].uuid === driverUuid && mismosDias(vigentes[0])
      && (vigentes[0].hasta || null) === fin) {
    return { cambio: false, movidaDe: null };
  }
  for (const x of vigentes) await cerrar(x);
  if (!driverUuid) return { cambio: vigentes.length > 0, movidaDe: null };

  let movidaDe = null;
  for (const x of suyas.filter(y => y.desde <= desde)) { movidaDe = x.matricula; await cerrar(x); }

  // Lo siguiente de la plaza es suyo, con los mismos días, y lo nuevo llegaría
  // justo hasta su víspera: se le adelanta el «desde». En un CT, solo si no se
  // pasa del último día con CT del coche.
  if (sig && sig.uuid === driverUuid && mismosDias(sig) && fin === sig.diaAntes
      && (hasta == null || (sig.hasta != null && sig.hasta <= hasta))) {
    await cli.query(`UPDATE sede_asignacion SET desde = $2::date WHERE id = $1`, [sig.id, desde]);
    return { cambio: true, movidaDe };
  }
  await cli.query(
    `INSERT INTO sede_asignacion (sede, matricula, turno, rol, dias, driver_uuid, desde, hasta, creado_por)
     VALUES ($1, $2, $3, $4, $5::smallint[], $6, $7::date, $8::date, $9)`,
    [sede, matricula, turno, rol, ct ? dias : null, driverUuid, desde, fin, usuarioId || null]);
  return { cambio: true, movidaDe };
}

/** Una plaza, en su transacción. */
const asignar = x => db.transaccion(cli => asignarEn(cli, x));

/**
 * VARIAS PLAZAS DE UNA VEZ (el CT del cuadrante): todas o ninguna. A medias
 * dejaría a la persona en la mitad de los coches del cuadrante.
 */
const asignarVarias = lista => db.transaccion(async cli => {
  const out = [];
  for (const x of lista) out.push(await asignarEn(cli, x));
  return out;
});

/**
 * Cierra desde un día los descansos de una matrícula de los tipos que se digan
 * (`turnos`: null = el común, 'dia', 'noche'): borra lo que empieza ese día o
 * después y cierra la víspera lo que lo cubre.
 */
async function cerrarDescansos(cli, { sede, matricula, desde, usuarioId, turnos }) {
  const tipo = `(turno IS NULL AND $4::boolean OR turno = ANY($5::varchar[]))`;
  const args = [sede, desde, matricula, turnos.includes(null), turnos.filter(Boolean)];
  await cli.query(`DELETE FROM sede_descanso WHERE sede = $1 AND matricula = $3 AND ${tipo} AND desde >= $2::date`, args);
  await cli.query(
    `UPDATE sede_descanso SET hasta = ${VISPERA}, cerrado_por = $6, cerrado_at = now()
      WHERE sede = $1 AND matricula = $3 AND ${tipo}
        AND desde < $2::date AND (hasta IS NULL OR hasta >= $2::date)`, [...args, usuarioId || null]);
}

/**
 * Abre un descanso desde un día. AUTO-CORTE, como ponerDescansoCoche de Madrid:
 * si hay uno escrito PARA MÁS ADELANTE con el que chocaría (el del mismo turno,
 * o un común, que ocupa los dos), el nuevo dura hasta su víspera y el futuro se
 * respeta. Sin días no se abre nada: no librar es no tener fila.
 */
async function abrirDescanso(cli, { sede, matricula, turno, dias, desde, usuarioId }) {
  if (!dias || !dias.length) return;
  const sig = (await cli.query(
    `SELECT to_char(desde, 'YYYY-MM-DD') AS desde FROM sede_descanso
      WHERE sede = $1 AND matricula = $3 AND desde > $2::date
        AND (turno IS NULL OR $4::varchar IS NULL OR turno = $4::varchar)
      ORDER BY desde LIMIT 1`, [sede, desde, matricula, turno || null])).rows[0];
  await cli.query(
    `INSERT INTO sede_descanso (sede, matricula, turno, dias, desde, hasta, creado_por)
     VALUES ($1, $2, $3, $4::smallint[], $5::date, CASE WHEN $6::date IS NULL THEN NULL ELSE $6::date - 1 END, $7)`,
    [sede, matricula, turno || null, dias, desde, sig ? sig.desde : null, usuarioId || null]);
}

/**
 * FIJA EL DESCANSO de una plaza desde un día: el común (turno null, el bloque
 * de un coche con CT) o el de un fijo (turno 'dia'/'noche', un coche sin CT).
 * Lo vigente de ese tipo se cierra la víspera, y lo nuevo se abre con auto-corte.
 * Sin días, la plaza deja de librar desde ese día.
 */
const ponerDescanso = ({ sede, matricula, turno, dias, desde, usuarioId }) => db.transaccion(async cli => {
  // Lo que empezaba justo ese día se sustituye; lo que lo cubre, se cierra.
  // Lo de más adelante se respeta: por eso no se usa cerrarDescansos.
  await cli.query(
    `DELETE FROM sede_descanso WHERE sede = $1 AND matricula = $3 AND turno IS NOT DISTINCT FROM $4::varchar AND desde = $2::date`,
    [sede, desde, matricula, turno || null]);
  await cli.query(
    `UPDATE sede_descanso SET hasta = ${VISPERA}, cerrado_por = $5, cerrado_at = now()
      WHERE sede = $1 AND matricula = $3 AND turno IS NOT DISTINCT FROM $4::varchar
        AND desde < $2::date AND (hasta IS NULL OR hasta >= $2::date)`,
    [sede, desde, matricula, turno || null, usuarioId || null]);
  await abrirDescanso(cli, { sede, matricula, turno, dias, desde, usuarioId });
});

/**
 * ACTIVA EL CT de un coche desde un día, con su bloque: fuera los descansos de
 * cada fijo, dentro el periodo con CT y el descanso común. El servicio ya ha
 * comprobado que no lo tenía y que el bloque no choca en su cuadrante.
 */
const activarCT = ({ sede, matricula, dias, desde, usuarioId }) => db.transaccion(async cli => {
  await cerrarDescansos(cli, { sede, matricula, desde, usuarioId, turnos: [null, 'dia', 'noche'] });
  // Si el periodo anterior acaba justo la víspera (se le quitó el CT desde ese
  // mismo día y se le vuelve a poner), se alarga ese en vez de abrir otro pegado.
  // El coche no llega a estar ni un día sin CT, y una plaza de CT dura hasta el
  // fin de SU periodo (servicio y db/235): con dos periodos pegados, la puesta
  // antes de la junta acabaría en ella aunque el coche siga con CT.
  const sigue = await cli.query(
    `UPDATE sede_coche_ct SET hasta = NULL, cerrado_por = NULL, cerrado_at = NULL
      WHERE sede = $1 AND matricula = $2 AND hasta = $3::date - 1`, [sede, matricula, desde]);
  if (!sigue.rowCount) {
    await cli.query(
      `INSERT INTO sede_coche_ct (sede, matricula, desde, creado_por) VALUES ($1, $2, $3::date, $4)`,
      [sede, matricula, desde, usuarioId || null]);
  }
  await abrirDescanso(cli, { sede, matricula, turno: null, dias, desde, usuarioId });
});

/**
 * DESACTIVA EL CT de un coche desde un día:
 *
 *   1. Fuera sus CT: a quien lo llevaba se le cierra la víspera y lo escrito
 *      para después se borra. Se devuelve a quiénes, para decirlo.
 *   2. Cada fijo libra lo que libraba el coche: `dias` (el bloque, que decide el
 *      servicio) pasa a ser el descanso del de día y el del de noche.
 *   3. Se cierra el periodo con CT (y lo que hubiera escrito para después).
 *
 * Como quitarCorreturnos de Madrid, al revés de marca.
 */
const desactivarCT = ({ sede, matricula, dias, desde, usuarioId }) => db.transaccion(async cli => {
  const cts = (await cli.query(
    `SELECT id, driver_uuid AS uuid, turno, to_char(desde, 'YYYY-MM-DD') AS desde
       FROM sede_asignacion
      WHERE sede = $1 AND matricula = $3 AND rol = 'ct' AND (hasta IS NULL OR hasta >= $2::date)
      ORDER BY turno, desde FOR UPDATE`, [sede, desde, matricula])).rows;
  for (const a of cts) {
    if (a.desde >= desde) await cli.query('DELETE FROM sede_asignacion WHERE id = $1', [a.id]);
    else {
      await cli.query(`UPDATE sede_asignacion SET hasta = $2::date - 1, cerrado_por = $3, cerrado_at = now() WHERE id = $1`,
        [a.id, desde, usuarioId || null]);
    }
  }
  await cerrarDescansos(cli, { sede, matricula, desde, usuarioId, turnos: [null, 'dia', 'noche'] });
  for (const turno of ['dia', 'noche']) await abrirDescanso(cli, { sede, matricula, turno, dias, desde, usuarioId });
  await cli.query(`DELETE FROM sede_coche_ct WHERE sede = $1 AND matricula = $3 AND desde >= $2::date`, [sede, desde, matricula]);
  await cli.query(
    `UPDATE sede_coche_ct SET hasta = ${VISPERA}, cerrado_por = $4, cerrado_at = now()
      WHERE sede = $1 AND matricula = $3 AND desde < $2::date AND (hasta IS NULL OR hasta >= $2::date)`,
    [sede, desde, matricula, usuarioId || null]);
  return { quitados: cts.map(a => ({ uuid: a.uuid, turno: a.turno, desde: a.desde })) };
});

// ── Las zonas y los cuadrantes ──────────────────────────────────────────────

async function crearZona({ sede, nombre, usuarioId }) {
  const r = await db.consulta(
    `INSERT INTO sede_zona (sede, nombre, creado_por) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [sede, nombre, usuarioId || null]);
  return r.rows[0];
}

/** Renombra (`nombre`) o retira/recupera (`activa`) una zona. Lo que no se diga no cambia. */
async function cambiarZona({ sede, id, nombre, activa }) {
  const r = await db.consulta(
    `UPDATE sede_zona SET nombre = COALESCE($3, nombre), activa = COALESCE($4::boolean, activa)
      WHERE sede = $1 AND id = $2::bigint RETURNING id::text AS id`,
    [sede, id, nombre == null ? null : nombre, activa == null ? null : !!activa]);
  return r.rows[0] || null;
}

/**
 * Crea un cuadrante con EL SIGUIENTE NÚMERO LIBRE de la sede (el primero que no
 * lleva ningún cuadrante vivo). El candado de la transacción hace que dos que
 * crean a la vez no se den el mismo; si aun así chocaran, el índice único lo
 * pararía.
 */
const crearCuadrante = ({ sede, zonaId, nombre, usuarioId }) => db.transaccion(async cli => {
  await cli.query(`SELECT pg_advisory_xact_lock(hashtext('sede_cuadrante:' || $1::text))`, [sede]);
  const r = await cli.query(
    `INSERT INTO sede_cuadrante (sede, numero, nombre, zona_id, creado_por)
     SELECT $1, n, $3, $2::bigint, $4
       FROM generate_series(1, (SELECT count(*) + 1 FROM sede_cuadrante WHERE sede = $1 AND baja_at IS NULL)::int) AS n
      WHERE NOT EXISTS (SELECT 1 FROM sede_cuadrante q WHERE q.sede = $1 AND q.baja_at IS NULL AND q.numero = n)
      ORDER BY n LIMIT 1
     RETURNING id::text AS id, numero`, [sede, zonaId || null, nombre || null, usuarioId || null]);
  return r.rows[0];
});

/** Cambia la zona (`cambiaZona`, con `zonaId` o null) o el nombre (`cambiaNombre`) de un cuadrante vivo. */
async function cambiarCuadrante({ sede, id, zonaId, nombre, cambiaZona, cambiaNombre }) {
  const r = await db.consulta(
    `UPDATE sede_cuadrante
        SET zona_id = CASE WHEN $3::boolean THEN $4::bigint ELSE zona_id END,
            nombre  = CASE WHEN $5::boolean THEN $6::varchar ELSE nombre END
      WHERE sede = $1 AND id = $2::bigint AND baja_at IS NULL RETURNING id::text AS id`,
    [sede, id, !!cambiaZona, zonaId || null, !!cambiaNombre, nombre || null]);
  return r.rows[0] || null;
}

/** Da de baja un cuadrante vivo sin coches. Devuelve el número, o null si no había nada que dar de baja. */
async function bajaCuadrante({ sede, id }) {
  const r = await db.consulta(
    `UPDATE sede_cuadrante q SET baja_at = now()
      WHERE q.sede = $1 AND q.id = $2::bigint AND q.baja_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM sede_coche c WHERE c.cuadrante_id = q.id)
      RETURNING q.numero`, [sede, id]);
  return r.rows[0] || null;
}

/** Mete un coche en un cuadrante (o lo saca, con `cuadranteId` null). */
async function cocheEnCuadrante({ sede, matricula, cuadranteId, usuarioId }) {
  await db.consulta(
    `INSERT INTO sede_coche (sede, matricula, cuadrante_id, actualizado_por) VALUES ($1, $2, $3::bigint, $4)
     ON CONFLICT (sede, matricula) DO UPDATE
        SET cuadrante_id = EXCLUDED.cuadrante_id, actualizado_at = now(), actualizado_por = EXCLUDED.actualizado_por`,
    [sede, matricula, cuadranteId || null, usuarioId || null]);
}

/**
 * Los cambios de estado de BOLT de la sede en [iniMs, finMs). `veh` sale ya
 * como matrícula cuando se conoce el coche (si no, su uuid de BOLT).
 */
async function apuntesEntre(sede, iniMs, finMs) {
  const r = await db.consulta(
    `SELECT l.driver_uuid AS uuid, COALESCE(v.matricula, l.vehiculo_uuid) AS veh, l.estado,
            (extract(epoch FROM l.ocurrido_at) * 1000)::bigint AS t
       FROM sede_bolt_state_log l
       LEFT JOIN sede_bolt_vehiculo v ON v.uuid = l.vehiculo_uuid
      WHERE l.sede = $1 AND l.ocurrido_at >= $2::timestamptz AND l.ocurrido_at < $3::timestamptz`,
    [sede, new Date(iniMs).toISOString(), new Date(finMs).toISOString()]);
  return r.rows.map(x => ({ uuid: x.uuid, veh: x.veh, estado: x.estado, t: Number(x.t) }));
}

/**
 * Cómo se traduce cada estado de BOLT al nuestro, y si es trabajo: el MISMO
 * catálogo que Madrid (fv_estado_bolt + fv_cat_situacion, de Flota viva). Si
 * mañana BOLT estrena un estado y se clasifica allí, Barcelona lo hereda.
 */
async function situaciones() {
  const r = await db.consulta(`SELECT estado, situacion FROM fv_estado_bolt`);
  return new Map(r.rows.map(x => [x.estado, x.situacion]));
}

/**
 * El neto y los pedidos terminados de la sede en [iniMs, finMs) (db/182), por
 * la hora en que se pidieron, como en Madrid.
 */
async function dineroEntre(sede, iniMs, finMs) {
  const r = await db.consulta(
    `SELECT COALESCE(round(sum(neto) FILTER (WHERE estado = 'finished'), 2), 0)::float AS neto,
            count(*) FILTER (WHERE estado = 'finished')::int AS viajes
       FROM sede_bolt_order
      WHERE sede = $1 AND creado_ts >= $2::timestamptz AND creado_ts < $3::timestamptz`,
    [sede, new Date(iniMs).toISOString(), new Date(finMs).toISOString()]);
  return { neto: Number(r.rows[0].neto) || 0, viajes: Number(r.rows[0].viajes) || 0 };
}

/**
 * El neto y los pedidos terminados de cada día natural (en Madrid) entre dos
 * fechas, para la serie del mes: Map('AAAA-MM-DD' → { neto, viajes }).
 */
async function dineroPorDia(sede, desde, hasta) {
  const r = await db.consulta(
    `SELECT to_char((creado_ts AT TIME ZONE 'Europe/Madrid')::date, 'YYYY-MM-DD') AS dia,
            COALESCE(round(sum(neto) FILTER (WHERE estado = 'finished'), 2), 0)::float AS neto,
            count(*) FILTER (WHERE estado = 'finished')::int AS viajes
       FROM sede_bolt_order
      WHERE sede = $1
        AND creado_ts >= ($2::date)::timestamp AT TIME ZONE 'Europe/Madrid'
        AND creado_ts < ($3::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid'
      GROUP BY 1`, [sede, desde, hasta]);
  return new Map(r.rows.map(x => [x.dia, { neto: Number(x.neto) || 0, viajes: Number(x.viajes) || 0 }]));
}

/**
 * El primer día (en Madrid) con apuntes de BOLT de la sede, o null. Es desde
 * donde empieza su historia en los gráficos largos de la Visibilidad: pedir «un
 * año» no tiene que cargar once meses vacíos.
 */
async function primerDiaApuntes(sede) {
  const r = await db.consulta(
    `SELECT to_char(min(ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS d
       FROM sede_bolt_state_log WHERE sede = $1`, [sede]);
  return (r.rows[0] && r.rows[0].d) || null;
}

/** La configuración de la Visibilidad de la sede (capacidad, meta, coches), o null. */
async function leerConfigVisibilidad(sede) {
  const r = await db.consulta(`SELECT valor FROM visibilidad_config WHERE clave = $1`, ['parametros_' + sede]);
  return r.rows[0] ? r.rows[0].valor : null;
}

async function guardarConfigVisibilidad(sede, valor) {
  await db.consulta(
    `INSERT INTO visibilidad_config (clave, valor, actualizado_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_at = now()`,
    ['parametros_' + sede, JSON.stringify(valor)]);
}

module.exports = {
  faltaMigracion, queFalta, conductores, coches,
  asignacionesEntre, planEntre, estructura,
  asignar, asignarVarias, ponerDescanso, activarCT, desactivarCT,
  crearZona, cambiarZona, crearCuadrante, cambiarCuadrante, bajaCuadrante, cocheEnCuadrante,
  apuntesEntre, situaciones, dineroEntre, dineroPorDia, leerConfigVisibilidad, guardarConfigVisibilidad,
  primerDiaApuntes,
};
