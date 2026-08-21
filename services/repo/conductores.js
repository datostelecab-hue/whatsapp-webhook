// ============================================================
// CONDUCTORES — consultas contra PostgreSQL
// ============================================================
// Es lo que hoy hace la pantalla de Plantilla, pero de una pieza. Ahora mismo
// esa pantalla lee TRES hojas (tickets, tablero y CONDUCTORES_OUT) y las cruza
// en JavaScript por nombre; aquí sale de una consulta y el cruce lo hacen las
// claves, no los nombres.
//
// REGLA DE IDENTIDAD: el nombre NO identifica. Sirve para leer la fila, nada
// más. Quien identifica es el id, y hacia fuera el DNI y la cuenta de BOLT.
// Por eso el listado trae siempre esos dos y avisa de quién no tiene ninguno.
//
// Todo lo que tiene historial (empleo, situación, turno, teléfono, coche,
// libranza) se consulta por `repo/vigencia`: aquí no se repite ni un
// `hasta IS NULL`.

const db = require('../db');
const vig = require('./vigencia');

// Nombre para mostrar. Se arma en SQL para poder ordenar y buscar por él.
const NOMBRE = `btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)`;

/**
 * El listado con todo lo que la pantalla necesita, en UNA consulta.
 *
 * `momento` permite mirar la plantilla de una fecha pasada: quién estaba de
 * alta, en qué turno y en qué coche. Hoy eso no se puede saber.
 */
async function listar({ id, momento, incluirBajas = false, tipo, situacion, turnoId } = {}) {
  const params = [momento || null];
  const donde = [];
  // Pidiendo un id concreto no se filtra por empleo: una ficha se abre igual
  // aunque la persona ya no esté de alta.
  if (id) { params.push(Number(id)); donde.push(`c.id = $${params.length}`); }
  else if (!incluirBajas) donde.push('c.empleo_vigente');
  if (tipo)      { params.push(tipo);            donde.push(`e.tipo = $${params.length}`); }
  if (situacion) { params.push(situacion);       donde.push(`COALESCE(s.estado, 'activo') = $${params.length}`); }
  if (turnoId)   { params.push(Number(turnoId)); donde.push(`th.turno_id = $${params.length}`); }

  const r = await db.consulta(`
    WITH ref AS (SELECT COALESCE($1::date, CURRENT_DATE) AS dia)
    SELECT c.id,
           ${NOMBRE}                       AS nombre_completo,
           c.nombre, c.apellidos, c.nombre_ss,
           c.dni_tipo, c.dni_nie, c.nacionalidad, c.email,
           c.es_centinela, c.empleo_vigente,

           -- Empleo vigente en la fecha: propia o ETT, desde cuándo.
           e.tipo AS empleo_tipo, e.ett_nombre, e.alta, e.baja,
           COALESCE(e.fecha_antiguedad, e.alta) AS antiguedad,
           -- Años de casa, que es lo que se mira de un vistazo.
           round(EXTRACT(EPOCH FROM (age((SELECT dia FROM ref),
                 COALESCE(e.fecha_antiguedad, e.alta)))) / 31557600, 1) AS anios,

           -- Situación: activo mientras nadie diga lo contrario.
           COALESCE(s.estado, 'activo')     AS situacion,
           COALESCE(ce.etiqueta, 'Activo')  AS situacion_etiqueta,
           COALESCE(ce.es_ausencia, FALSE)  AS ausente,
           s.desde AS situacion_desde, s.hasta_previsto,

           th.turno_id, t.etiqueta AS turno,

           tel.e164 AS telefono,

           -- Cuenta de BOLT. La activa manda: hay gente con varias.
           bolt.externo_id AS bolt_id, bolt.estado_externo AS bolt_estado,

           -- Coche y plaza de hoy, con su zona.
           v.matricula, v.id AS vehiculo_id, sl.rol, tv.etiqueta AS turno_plaza,
           bz.nombre AS zona,

           -- Libranzas del patrón vigente, como 'L M' y no como siete columnas.
           lib.dias AS libranzas
    FROM conductor c
    CROSS JOIN ref
    LEFT JOIN conductor_periodo_empleo e
           ON e.conductor_id = c.id
          AND e.alta <= ref.dia AND (e.baja IS NULL OR e.baja >= ref.dia)
    LEFT JOIN conductor_estado_hist s
           ON s.conductor_id = c.id
          AND s.desde <= ref.dia AND (s.hasta IS NULL OR s.hasta >= ref.dia)
    LEFT JOIN cat_estado_conductor ce ON ce.codigo = s.estado
    LEFT JOIN conductor_turno_hist th
           ON th.conductor_id = c.id
          AND th.desde <= ref.dia AND (th.hasta IS NULL OR th.hasta >= ref.dia)
    LEFT JOIN turno t ON t.id = th.turno_id
    LEFT JOIN LATERAL (
      SELECT e164 FROM conductor_telefono
       WHERE conductor_id = c.id AND vigente_hasta IS NULL
       ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
    LEFT JOIN LATERAL (
      SELECT externo_id, estado_externo FROM conductor_externo
       WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
       -- La cuenta activa primero: es la que usa el sistema para cruzar horas.
       ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) bolt ON TRUE
    LEFT JOIN asignacion a
           ON a.conductor_id = c.id
          AND a.desde <= ref.dia AND (a.hasta IS NULL OR a.hasta >= ref.dia)
    LEFT JOIN plaza p     ON p.id = a.plaza_id
    LEFT JOIN cat_slot sl ON sl.slot = p.slot
    LEFT JOIN turno tv    ON tv.id = sl.turno_id
    LEFT JOIN vehiculo v  ON v.id = p.vehiculo_id
    LEFT JOIN base_zona bz ON bz.id = v.base_zona_id
    LEFT JOIN LATERAL (
      SELECT string_agg(
               CASE d.dia_semana WHEN 1 THEN 'L' WHEN 2 THEN 'M' WHEN 3 THEN 'X'
                                 WHEN 4 THEN 'J' WHEN 5 THEN 'V' WHEN 6 THEN 'S'
                                 ELSE 'D' END, ' ' ORDER BY d.dia_semana) AS dias
        FROM patron_libranza pl
        JOIN patron_libranza_dia d ON d.patron_id = pl.id
       WHERE pl.conductor_id = c.id
         AND pl.desde <= ref.dia AND (pl.hasta IS NULL OR pl.hasta >= ref.dia)) lib ON TRUE
    WHERE NOT c.es_centinela
      ${donde.length ? 'AND ' + donde.join(' AND ') : ''}
    ORDER BY ${NOMBRE}`, params);

  // Lo que le falta a cada ficha. Se calcula aquí y no en la vista para que
  // valga igual en la pantalla, en un aviso o en un informe.
  return r.rows.map(c => ({ ...c, faltan: faltantesDe(c) }));
}

/**
 * Qué le falta a una ficha para estar completa. El orden importa: lo primero
 * es lo que más duele. Sin cuenta de BOLT no se le imputan horas, y sin
 * teléfono el bot no puede hablar con esa persona.
 */
function faltantesDe(c) {
  const f = [];
  if (!c.bolt_id) f.push('cuenta de BOLT');
  // Tenerla desactivada es igual de malo que no tenerla: BOLT deja de mandar
  // sus horas y el conductor desaparece del control de trafico sin avisar.
  else if (c.bolt_estado && c.bolt_estado !== 'active') f.push(`cuenta de BOLT ${c.bolt_estado}`);
  if (!c.telefono) f.push('teléfono');
  if (!c.dni_nie)  f.push('DNI');
  // A un ETT no se le exige la ficha legal completa: entra con nombre, DNI y
  // fecha, y por eso se le puede planificar antes de existir en BOLT.
  if (c.empleo_tipo !== 'ett') {
    if (!c.nombre_ss) f.push('nombre de la Seguridad Social');
    if (!c.email)     f.push('correo');
  }
  return f;
}

/** Un conductor con todo lo suyo: quién es, dónde está y por dónde ha pasado. */
async function ficha(id, { momento } = {}) {
  const [c] = (await db.consulta(`
    SELECT c.*, ${NOMBRE} AS nombre_completo
      FROM conductor c WHERE c.id = $1`, [id])).rows;
  if (!c) return null;

  // El grueso sale de la capa común de vigencias: ni un SQL repetido.
  const [empleos, situaciones, turnos, telefonos, libranzas] = await Promise.all([
    vig.historial('empleo', id),
    vig.historial('situacion', id),
    vig.historial('turnoConductor', id),
    vig.historial('telefono', id),
    vig.historial('libranza', id),
  ]);

  const cuentas = (await db.consulta(
    `SELECT sistema, externo_id, externo_nombre, estado_externo, visto_desde, visto_hasta
       FROM conductor_externo WHERE conductor_id = $1
      ORDER BY visto_hasta NULLS FIRST, sistema, visto_desde DESC`, [id])).rows;

  // Con qué nombre le conoce cada sistema. Es la pieza que explica por qué un
  // cruce salió bien o mal, y hoy no se puede consultar en ningún sitio.
  const alias = (await db.consulta(
    `SELECT tipo, alias, ambiguo, vigente FROM conductor_alias
      WHERE conductor_id = $1 ORDER BY vigente DESC, tipo, alias`, [id])).rows;

  const coches = (await db.consulta(`
    SELECT a.id, a.desde, a.hasta, v.matricula, v.id AS vehiculo_id,
           sl.rol, t.etiqueta AS turno, bz.nombre AS zona
      FROM asignacion a
      JOIN plaza p      ON p.id = a.plaza_id
      JOIN cat_slot sl  ON sl.slot = p.slot
      JOIN turno t      ON t.id = sl.turno_id
      JOIN vehiculo v   ON v.id = p.vehiculo_id
      LEFT JOIN base_zona bz ON bz.id = v.base_zona_id
     WHERE a.conductor_id = $1
     ORDER BY a.hasta NULLS FIRST, a.desde DESC`, [id])).rows;

  // Los días del patrón vigente, para pintarlos como semana.
  const diasLibranza = libranzas.length
    ? (await db.consulta(
        `SELECT patron_id, dia_semana FROM patron_libranza_dia
          WHERE patron_id = ANY($1) ORDER BY patron_id, dia_semana`,
        [libranzas.map(l => l.id)])).rows
    : [];

  // La misma fila que se ve en el listado: turno, coche, situación y faltantes
  // salen de una sola definición, así que la ficha nunca contradice a la tabla.
  const [fila] = await listar({ id, momento });

  return {
    ...c,
    ...(fila || {}),
    empleos, situaciones, turnos, telefonos, cuentas, alias, coches,
    // OJO: se llaman `patrones` y no `libranzas` a proposito. `libranzas` ya
    // viene del listado como texto legible ('L M'); si esto se llamara igual,
    // lo pisaria y la pantalla ensenaria un objeto.
    patrones: libranzas.map(l => ({
      ...l,
      dias: diasLibranza.filter(d => d.patron_id === l.id).map(d => d.dia_semana),
    })),
  };
}

/** Contadores de la cabecera. Una consulta, no una por tarjeta. */
async function resumen({ momento } = {}) {
  const [porSituacion, porTipo, huecos] = await Promise.all([
    db.consulta(`
      WITH ref AS (SELECT COALESCE($1::date, CURRENT_DATE) AS dia)
      SELECT COALESCE(s.estado, 'activo') AS codigo,
             COALESCE(ce.etiqueta, 'Activo') AS etiqueta,
             COALESCE(ce.es_ausencia, FALSE) AS es_ausencia,
             count(*)::int personas
        FROM conductor c
        CROSS JOIN ref
        LEFT JOIN conductor_estado_hist s
               ON s.conductor_id = c.id
              AND s.desde <= ref.dia AND (s.hasta IS NULL OR s.hasta >= ref.dia)
        LEFT JOIN cat_estado_conductor ce ON ce.codigo = s.estado
       WHERE c.empleo_vigente AND NOT c.es_centinela
       GROUP BY 1, 2, 3 ORDER BY 3, 2`, [momento || null]),

    db.consulta(`
      WITH ref AS (SELECT COALESCE($1::date, CURRENT_DATE) AS dia)
      SELECT e.tipo, count(*)::int personas
        FROM conductor c
        CROSS JOIN ref
        JOIN conductor_periodo_empleo e
          ON e.conductor_id = c.id
         AND e.alta <= ref.dia AND (e.baja IS NULL OR e.baja >= ref.dia)
       WHERE NOT c.es_centinela
       GROUP BY 1`, [momento || null]),

    db.consulta(`
      SELECT count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM conductor_externo x
                WHERE x.conductor_id = c.id AND x.sistema = 'bolt' AND x.visto_hasta IS NULL))  sin_bolt,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM conductor_telefono x
                WHERE x.conductor_id = c.id AND x.vigente_hasta IS NULL))                       sin_telefono,
             count(*) FILTER (WHERE c.dni_nie IS NULL)                                          sin_dni,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM asignacion a
                WHERE a.conductor_id = c.id AND a.hasta IS NULL))                               sin_coche
        FROM conductor c WHERE c.empleo_vigente AND NOT c.es_centinela`),
  ]);

  return {
    porSituacion: porSituacion.rows,
    porTipo: porTipo.rows,
    huecos: huecos.rows[0],
  };
}

/** Catálogos para filtros y desplegables. */
async function catalogos() {
  const [situaciones, turnos] = await Promise.all([
    db.consulta(`SELECT codigo, etiqueta, es_ausencia FROM cat_estado_conductor ORDER BY orden, etiqueta`),
    db.consulta(`SELECT id, codigo, etiqueta FROM turno WHERE activo ORDER BY id`),
  ]);
  return {
    situaciones: situaciones.rows,
    turnos: turnos.rows,
    tipos: [{ codigo: 'propia', etiqueta: 'Plantilla propia' }, { codigo: 'ett', etiqueta: 'ETT' }],
  };
}

/**
 * Las cuentas de BOLT sin dueño, para el enlace manual. Es la lista que se
 * ofrece frente a los conductores que están "pendientes de asignar id".
 */
async function boltLibres() {
  const r = await db.consulta(
    `SELECT externo_id, externo_nombre, estado_externo, visto_desde
       FROM conductor_externo
      WHERE sistema = 'bolt' AND conductor_id IS NULL
      ORDER BY (estado_externo = 'active') DESC, externo_nombre`);
  return r.rows;
}

module.exports = {
  listar, ficha, resumen, catalogos, boltLibres, faltantesDe,
};
