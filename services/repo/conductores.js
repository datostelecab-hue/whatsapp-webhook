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
const audit = require('./auditoria');

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

           -- Coche y plaza de hoy. AGRUPADOS: unir con asignacion a pelo
           -- duplicaba la fila de quien tuviera dos plazas abiertas, y esto es
           -- una lista de personas, no de plazas.
           coche.matricula, coche.vehiculo_id, coche.rol, coche.zona,
           coche.plazas AS plazas_abiertas,

           -- Libranzas del patrón vigente, como 'L M' y no como siete columnas.
           lib.dias AS libranzas,

           -- Documentación obligatoria que le falta. Sale de v_documento_falta,
           -- que es la única definición de "obligatorio" del sistema.
           docs.faltan AS docs_faltan
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
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT v.matricula, ' + ' ORDER BY v.matricula) AS matricula,
             min(v.id)                                                    AS vehiculo_id,
             string_agg(DISTINCT sl.rol, ', ')                            AS rol,
             string_agg(DISTINCT bz.nombre, ', ')                         AS zona,
             count(*)::int                                                AS plazas
        FROM asignacion a
        JOIN plaza p      ON p.id = a.plaza_id
        JOIN cat_slot sl  ON sl.slot = p.slot
        JOIN vehiculo v   ON v.id = p.vehiculo_id
        LEFT JOIN base_zona bz ON bz.id = v.base_zona_id
       WHERE a.conductor_id = c.id
         AND a.desde <= ref.dia AND (a.hasta IS NULL OR a.hasta >= ref.dia)) coche ON TRUE
    LEFT JOIN LATERAL (
      SELECT string_agg(
               CASE d.dia_semana WHEN 1 THEN 'L' WHEN 2 THEN 'M' WHEN 3 THEN 'X'
                                 WHEN 4 THEN 'J' WHEN 5 THEN 'V' WHEN 6 THEN 'S'
                                 ELSE 'D' END, ' ' ORDER BY d.dia_semana) AS dias
        FROM patron_libranza pl
        JOIN patron_libranza_dia d ON d.patron_id = pl.id
       WHERE pl.conductor_id = c.id
         AND pl.desde <= ref.dia AND (pl.hasta IS NULL OR pl.hasta >= ref.dia)) lib ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(f.etiqueta ORDER BY f.etiqueta) AS faltan
        FROM v_documento_falta f WHERE f.conductor_id = c.id) docs ON TRUE
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
  // Dos plazas abiertas a la vez casi siempre es un error de planificacion: la
  // persona figura conduciendo dos coches el mismo dia.
  if (c.plazas_abiertas > 1) f.push(`${c.plazas_abiertas} plazas a la vez`);
  if (!c.dni_nie)  f.push('DNI');
  // A un ETT no se le exige la ficha legal completa: entra con nombre, DNI y
  // fecha, y por eso se le puede planificar antes de existir en BOLT.
  if (c.empleo_tipo !== 'ett') {
    if (!c.nombre_ss) f.push('nombre de la Seguridad Social');
    if (!c.email)     f.push('correo');
  }
  // Papeles. La lista de cuáles son obligatorios vive en cat_tipo_documento, no
  // aquí: añadir uno nuevo no debería obligar a tocar código.
  (c.docs_faltan || []).forEach(d => f.push(d));
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
               SELECT 1 FROM conductor_externo xb
                WHERE xb.conductor_id = c.id AND xb.sistema = 'bolt' AND xb.visto_hasta IS NULL)) sin_bolt,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM conductor_telefono xt
                WHERE xt.conductor_id = c.id AND xt.vigente_hasta IS NULL))                      sin_telefono,
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
// El cazamiento con BOLT vive entero en `services/cazamientoBolt.js`, que ya
// tenía libres/enlazar/desenlazar antes de que existiera este repositorio. Aquí
// solo se reexporta para que la pantalla tenga una única puerta de entrada;
// escribir una segunda versión fue un error y duraron poco.
const bolt = require('../cazamientoBolt');

const boltLibres = q => bolt.libres(q);

// ============================================================
// ESCRITURA
// ============================================================
// Todo lo que se puede cambiar de un conductor. Nada de esto escribe fechas
// "hasta" a mano: las vigencias pasan por `repo/vigencia`, que cierra la
// anterior y abre la nueva en una sola transaccion.

/**
 * Campos editables de la ficha, con quien puede tocarlos.
 *
 *   operativo → el dia a dia de Trafico: turno y libranzas.
 *   sensible  → datos personales, contractuales y bancarios: solo RRHH.
 *
 * El reparto estaba ya escrito en el codigo viejo (CAMPOS_SENSIBLES en
 * planificadorV2.js) pero marcado como "todavia no se aplica". Aqui se aplica:
 * Trafico VE los sensibles y no puede cambiarlos.
 */
const CAMPOS = {
  // Identidad
  nombre:            { grupo: 'Identidad', etiqueta: 'Nombre', ambito: 'sensible' },
  apellidos:         { grupo: 'Identidad', etiqueta: 'Apellidos', ambito: 'sensible' },
  nombre_ss:         { grupo: 'Identidad', etiqueta: 'Nombre en la Seguridad Social', ambito: 'sensible',
                       ayuda: 'Como figura en la Seguridad Social, que no siempre coincide con el de BOLT' },
  dni_tipo:          { grupo: 'Identidad', etiqueta: 'Tipo de documento', ambito: 'sensible',
                       tipo: 'lista', opciones: ['DNI', 'NIE', 'Pasaporte', 'Pasaporte/NIE'] },
  dni_nie:           { grupo: 'Identidad', etiqueta: 'Número de documento', ambito: 'sensible' },
  fecha_nacimiento:  { grupo: 'Identidad', etiqueta: 'Fecha de nacimiento', ambito: 'sensible', tipo: 'fecha' },
  sexo:              { grupo: 'Identidad', etiqueta: 'Sexo', ambito: 'sensible',
                       tipo: 'lista', opciones: ['Hombre', 'Mujer', 'Otro'] },
  estado_civil:      { grupo: 'Identidad', etiqueta: 'Estado civil', ambito: 'sensible' },
  nacionalidad:      { grupo: 'Identidad', etiqueta: 'Nacionalidad', ambito: 'sensible' },
  pais_nacimiento:   { grupo: 'Identidad', etiqueta: 'País de nacimiento', ambito: 'sensible' },

  // Seguridad Social. La gestoría lo maneja en tres piezas y así hay que
  // devolvérselo: `naf` se recalcula sola al juntarlas.
  naf_provincia:     { grupo: 'Seguridad Social', etiqueta: 'NAF · provincia', ambito: 'sensible' },
  naf_numero:        { grupo: 'Seguridad Social', etiqueta: 'NAF · número', ambito: 'sensible' },
  naf_control:       { grupo: 'Seguridad Social', etiqueta: 'NAF · control', ambito: 'sensible' },
  legajo:            { grupo: 'Seguridad Social', etiqueta: 'Legajo', ambito: 'sensible',
                       ayuda: 'El identificador que usa la gestoría en SU sistema, no el nuestro' },

  // Dirección despiezada: el fichero de la gestoría la pide así.
  via_tipo:          { grupo: 'Dirección', etiqueta: 'Tipo de vía', ambito: 'sensible' },
  via_nombre:        { grupo: 'Dirección', etiqueta: 'Nombre de la vía', ambito: 'sensible' },
  via_numero:        { grupo: 'Dirección', etiqueta: 'Número', ambito: 'sensible' },
  escalera:          { grupo: 'Dirección', etiqueta: 'Escalera', ambito: 'sensible' },
  piso:              { grupo: 'Dirección', etiqueta: 'Piso', ambito: 'sensible' },
  puerta:            { grupo: 'Dirección', etiqueta: 'Puerta', ambito: 'sensible' },
  codigo_postal:     { grupo: 'Dirección', etiqueta: 'Código postal', ambito: 'sensible' },
  localidad:         { grupo: 'Dirección', etiqueta: 'Localidad', ambito: 'sensible' },
  provincia:         { grupo: 'Dirección', etiqueta: 'Provincia', ambito: 'sensible' },
  pais:              { grupo: 'Dirección', etiqueta: 'País', ambito: 'sensible' },
  lat:               { grupo: 'Dirección', etiqueta: 'Latitud', ambito: 'sensible', tipo: 'numero',
                       ayuda: 'Sin coordenadas, esta persona no entra en el reparto por zona' },
  lng:               { grupo: 'Dirección', etiqueta: 'Longitud', ambito: 'sensible', tipo: 'numero' },

  // Contacto. El teléfono principal NO está aquí: tiene historial propio y se
  // cambia desde su bloque, que además comprueba que no sea de otra persona.
  email:             { grupo: 'Contacto', etiqueta: 'Correo', ambito: 'sensible' },
  tel_emergencia:    { grupo: 'Contacto', etiqueta: 'Teléfono de emergencia', ambito: 'sensible' },

  // Interno
  recomendador:      { grupo: 'Interno', etiqueta: 'Quién le recomendó', ambito: 'sensible' },
  observaciones:     { grupo: 'Interno', etiqueta: 'Observaciones', ambito: 'operativo', tipo: 'texto-largo' },
};


// Columnas GENERADAS: se calculan solas y no se pueden escribir. Intentarlo es
// un error de PostgreSQL, no un aviso.
const GENERADAS = ['direccion', 'naf', 'nombre_completo'];

/** Los campos que puede tocar un rol. Trafico solo lo operativo. */
function camposDe(rol) {
  const todos = Object.keys(CAMPOS);
  if (rol === 'trafico') return todos.filter(c => CAMPOS[c].ambito === 'operativo');
  return todos;
}

/**
 * Actualiza la ficha y deja constancia de cada campo que cambia.
 *
 * `rol` decide qué se acepta. Un campo prohibido NO se ignora en silencio: se
 * lanza. Ignorarlo haría creer a quien lo escribió que se guardó.
 */
async function actualizar(id, campos, { usuarioId, rol } = {}) {
  const permitidos = new Set(camposDe(rol));
  const entradas = Object.entries(campos || {})
    .filter(([k]) => k in CAMPOS || GENERADAS.includes(k));

  const prohibidos = entradas.filter(([k]) => GENERADAS.includes(k) || !permitidos.has(k)).map(([k]) => k);
  if (prohibidos.length) {
    const generadas = prohibidos.filter(k => GENERADAS.includes(k));
    if (generadas.length) throw new Error(`Estos campos se calculan solos y no se escriben: ${generadas.join(', ')}`);
    throw new Error(`Tu rol no puede cambiar: ${prohibidos.join(', ')}`);
  }

  const cols = entradas.map(([k]) => k);
  if (!cols.length) throw new Error('No se ha recibido ningún cambio');

  // Los campos de lista solo aceptan lo que hay en su lista. Que el desplegable
  // del navegador ya lo limite no basta: la ruta es pública para quien tenga
  // sesión y esto es lo único que de verdad lo impide.
  for (const [k, v] of entradas) {
    const def = CAMPOS[k];
    if (def && def.opciones && v && !def.opciones.includes(v)) {
      throw new Error(`"${v}" no vale para ${def.etiqueta}. Opciones: ${def.opciones.join(', ')}`);
    }
  }

  return db.transaccion(async cli => {
    const antes = (await cli.query('SELECT * FROM conductor WHERE id = $1', [id])).rows[0];
    if (!antes) throw new Error('No existe ese conductor');

    await cli.query(
      `UPDATE conductor SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')},
              actualizado_at = now()
        WHERE id = $1`,
      [id, ...cols.map(c => {
        const v = campos[c];
        if (v === '' || v === undefined || v === null) return null;
        // Los numéricos llegan como texto del formulario; PostgreSQL no acepta
        // '' en una columna NUMERIC y una coma decimal tampoco.
        if (CAMPOS[c] && CAMPOS[c].tipo === 'numero') {
          const n = Number(String(v).replace(',', '.'));
          if (!Number.isFinite(n)) throw new Error(`"${CAMPOS[c].etiqueta}" tiene que ser un número`);
          return n;
        }
        return v;
      })]);

    const ahora = (await cli.query('SELECT * FROM conductor WHERE id = $1', [id])).rows[0];
    // `direccion` y `naf` se recalculan solas al cambiar sus piezas: apuntarlas
    // seria ruido, porque no las ha cambiado nadie a mano.
    const n = await audit.registrar({
      tabla: 'conductor', id, antes, ahora, usuarioId, cli,
      ignorar: GENERADAS,
    });
    return { campos: cols, auditados: n };
  });
}

/**
 * Cambia la situación (vacaciones, baja médica, vuelta al trabajo).
 *
 * Una ausencia NO cierra la asignación: la persona conserva su plaza. Eso ya
 * está decidido en el esquema y aquí solo se respeta.
 */
async function cambiarSituacion(id, { estado, desde, hastaPrevisto, motivo }, { usuarioId } = {}) {
  if (!estado) throw new Error('Falta la situación');
  return db.transaccion(async cli => {
    const cat = (await cli.query(
      'SELECT codigo, etiqueta, fin_previsible FROM cat_estado_conductor WHERE codigo = $1', [estado])).rows[0];
    if (!cat) throw new Error(`No existe la situación "${estado}"`);

    // Una vuelta con fecha prevista solo tiene sentido si esa situación la
    // admite: en una baja médica la fecha la pone el alta, no nosotros.
    const previsto = cat.fin_previsible ? (hastaPrevisto || null) : null;
    return vig.reemplazar('situacion', id, {
      estado, hasta_previsto: previsto, motivo: motivo || null, usuario_id: usuarioId || null,
    }, { desde, cli });
  });
}

/** Cambia el turno. Cierra el anterior el día antes; nunca se solapan. */
async function cambiarTurno(id, { turnoId, desde }, { usuarioId } = {}) {
  if (!turnoId) throw new Error('Falta el turno');
  return vig.reemplazar('turnoConductor', id,
    { turno_id: Number(turnoId), origen: 'manual', usuario_id: usuarioId || null }, { desde });
}

/**
 * Guarda el patrón de libranza: qué días de la semana libra (1 = lunes).
 *
 * Cambiarlo abre un patrón NUEVO y cierra el anterior, no reescribe el que
 * había. Si se reescribiera, la cobertura de las semanas pasadas se recalcularía
 * con la libranza de hoy y dejaría de cuadrar con lo que de verdad pasó.
 */
async function guardarLibranza(id, dias, { desde, usuarioId } = {}) {
  const limpios = [...new Set((dias || []).map(Number))]
    .filter(d => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  if (limpios.length >= 7) throw new Error('No puede librar los siete días');

  return db.transaccion(async cli => {
    const patron = await vig.reemplazar('libranza', id,
      { usuario_id: usuarioId || null }, { desde, cli });
    for (const d of limpios) {
      await cli.query('INSERT INTO patron_libranza_dia (patron_id, dia_semana) VALUES ($1,$2)', [patron.id, d]);
    }
    // El patrón queda en el historial aunque no libre ningún día: "no libra" es
    // una decisión, no la ausencia de una.
    await audit.registrar({
      tabla: 'conductor', id, usuarioId, cli,
      cambios: [{ campo: 'libranza', antes: null, ahora: limpios.join(' ') || '(ninguna)' }],
    });
    return { patronId: patron.id, dias: limpios };
  });
}

/**
 * Enlaza una cuenta de BOLT. Delega en el cazamiento y añade la constancia en
 * la ficha, que es lo propio de este módulo.
 *
 * `cuentaId` es el id de la fila que da `v_bolt_libres`.
 */
async function enlazarBolt(id, cuentaId, { usuarioId } = {}) {
  const r = await bolt.enlazar({ cuentaId, conductorId: id, usuarioId });
  await audit.registrar({
    tabla: 'conductor', id, usuarioId,
    cambios: [{ campo: 'cuenta_bolt', antes: null, ahora: r.externo_id }],
  });
  return { externoId: r.externo_id, nombreEnBolt: r.externo_nombre };
}

/** Suelta la cuenta: vuelve a la bolsa de IDs libres. */
async function soltarBolt(id, cuentaId, { usuarioId } = {}) {
  const r = await bolt.desenlazar({ cuentaId, usuarioId });
  await audit.registrar({
    tabla: 'conductor', id, usuarioId,
    cambios: [{ campo: 'cuenta_bolt', antes: r.externo_id, ahora: null }],
  });
  return true;
}

/** Añade o sustituye el teléfono principal. */
async function guardarTelefono(id, e164, { origen = 'manual', usuarioId, desde } = {}) {
  const limpio = String(e164 || '').replace(/[^0-9+]/g, '');
  if (limpio.replace(/\D/g, '').length < 9) throw new Error('El teléfono no parece válido');
  return db.transaccion(async cli => {
    // El sufijo de 9 dígitos es único entre los vigentes: si ya es de otro, la
    // base lo rechaza. Se comprueba antes para poder decir de quién es.
    const duenio = (await cli.query(
      `SELECT t.conductor_id, ${NOMBRE} AS nombre
         FROM conductor_telefono t JOIN conductor c ON c.id = t.conductor_id
        WHERE t.vigente_hasta IS NULL AND t.sufijo9 = right(regexp_replace($1,'[^0-9]','','g'), 9)
          AND t.conductor_id <> $2`, [limpio, id])).rows[0];
    if (duenio) throw new Error(`Ese teléfono ya es de ${duenio.nombre}`);

    await vig.reemplazar('telefono', id,
      { e164: limpio, origen, principal: true }, { desde, cli });
    await audit.registrar({
      tabla: 'conductor', id, usuarioId, cli,
      cambios: [{ campo: 'telefono', antes: null, ahora: limpio }],
    });
    return limpio;
  });
}

/**
 * Crea a una persona NUEVA y la contrata, todo en una transacción.
 *
 * Lo mínimo es el nombre y la fecha de alta. Los ETT entran así de justos a
 * propósito: se les puede planificar antes de existir en BOLT y antes de que
 * llegue su papeleo, que es como funciona de verdad una incorporación urgente.
 *
 * El DNI, si viene, se comprueba ANTES de crear nada: la base ya lo impide con
 * un índice único, pero un error de PostgreSQL no dice de quién era el DNI y
 * eso es justo lo que hace falta saber.
 */
async function crear(datos, { usuarioId, rol } = {}) {
  const d = datos || {};
  const nombre = String(d.nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre');
  if (!d.alta) throw new Error('Falta la fecha de alta');
  const tipo = d.tipo === 'ett' ? 'ett' : 'propia';
  if (tipo === 'ett' && !String(d.ettNombre || '').trim()) throw new Error('Falta el nombre de la ETT');

  const dni = String(d.dni_nie || '').trim().toUpperCase() || null;
  if (dni) {
    const ya = (await db.consulta(
      `SELECT id, ${NOMBRE} AS quien, empleo_vigente FROM conductor c
        WHERE upper(btrim(dni_nie)) = $1`, [dni])).rows[0];
    if (ya) {
      throw new Error(`Ese DNI ya es de ${ya.quien}` +
        (ya.empleo_vigente ? ', que está de alta.' : ', que está de baja. Vuélvele a dar de alta desde su ficha.') +
        ` (ficha ${ya.id})`);
    }
  }

  // El teléfono también: si ya es de otra persona vigente, la base lo rechaza y
  // el alta entera se caería después de haber creado a medias.
  const tel = String(d.telefono || '').replace(/[^0-9+]/g, '');
  if (tel) {
    const duenio = (await db.consulta(
      `SELECT ${NOMBRE} AS quien FROM conductor_telefono t
         JOIN conductor c ON c.id = t.conductor_id
        WHERE t.vigente_hasta IS NULL
          AND t.sufijo9 = right(regexp_replace($1, '[^0-9]', '', 'g'), 9)`, [tel])).rows[0];
    if (duenio) throw new Error(`Ese teléfono ya es de ${duenio.quien}`);
  }

  return db.transaccion(async cli => {
    // Solo los campos que el rol pueda tocar, con la misma regla que editar.
    const permitidos = new Set(camposDe(rol));
    const cols = ['nombre'], vals = [nombre];
    for (const [k, v] of Object.entries(d)) {
      if (k === 'nombre' || !CAMPOS[k] || !permitidos.has(k)) continue;
      if (v === '' || v === null || v === undefined) continue;
      cols.push(k);
      vals.push(CAMPOS[k].tipo === 'numero' ? Number(String(v).replace(',', '.')) : v);
    }

    const r = await cli.query(
      `INSERT INTO conductor (${cols.join(', ')})
       VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`, vals);
    const id = r.rows[0].id;

    await cli.query(
      `INSERT INTO conductor_periodo_empleo
         (conductor_id, tipo, ett_nombre, alta, fecha_antiguedad, jornada_horas,
          fin_periodo_prueba, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, tipo, tipo === 'ett' ? String(d.ettNombre).trim() : null, d.alta,
       d.antiguedad || null, d.jornadaHoras || null, d.finPrueba || null, usuarioId || null]);
    await cli.query('UPDATE conductor SET empleo_vigente = TRUE WHERE id = $1', [id]);

    if (tel) {
      await cli.query(
        `INSERT INTO conductor_telefono (conductor_id, e164, origen, principal)
         VALUES ($1,$2,'manual',TRUE)`, [id, tel]);
    }
    if (d.turnoId) {
      await vig.reemplazar('turnoConductor', id,
        { turno_id: Number(d.turnoId), origen: 'manual', usuario_id: usuarioId || null },
        { desde: d.alta, cerrarAnterior: false, cli });
    }
    if (Array.isArray(d.libranzas) && d.libranzas.length) {
      const patron = await vig.reemplazar('libranza', id, { usuario_id: usuarioId || null },
        { desde: d.alta, cerrarAnterior: false, cli });
      for (const dia of [...new Set(d.libranzas.map(Number))].filter(x => x >= 1 && x <= 7)) {
        await cli.query('INSERT INTO patron_libranza_dia (patron_id, dia_semana) VALUES ($1,$2)',
          [patron.id, dia]);
      }
    }

    await audit.registrar({
      tabla: 'conductor', id, usuarioId, cli,
      cambios: [{ campo: 'alta', antes: null, ahora: `${nombre} · ${tipo} · ${d.alta}` }],
    });
    return { id, nombre };
  });
}

/** Da de alta a alguien: abre su periodo de empleo. */
async function darDeAlta(id, { tipo = 'propia', ettNombre, alta, antiguedad,
                              jornadaHoras, finPrueba }, { usuarioId } = {}) {
  if (!alta) throw new Error('Falta la fecha de alta');
  if (tipo === 'ett' && !ettNombre) throw new Error('Falta el nombre de la ETT');
  return db.transaccion(async cli => {
    const abierto = await vig.abierta('empleo', id);
    if (abierto) throw new Error('Esta persona ya está de alta');
    const r = await cli.query(
      `INSERT INTO conductor_periodo_empleo
         (conductor_id, tipo, ett_nombre, alta, fecha_antiguedad, jornada_horas,
          fin_periodo_prueba, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [id, tipo, tipo === 'ett' ? ettNombre : null, alta, antiguedad || null,
       jornadaHoras || null, finPrueba || null, usuarioId || null]);
    await cli.query('UPDATE conductor SET empleo_vigente = TRUE WHERE id = $1', [id]);
    return r.rows[0].id;
  });
}

/**
 * Da de baja: cierra el empleo, la situación, el turno y las asignaciones.
 *
 * Lo importante es que se cierra TODO en la misma transacción. Dejar una
 * asignación abierta de alguien que ya no está haría que su coche siguiera
 * apareciendo cubierto.
 */
async function darDeBaja(id, { fecha, motivo }, { usuarioId } = {}) {
  const dia = fecha || new Date().toISOString().slice(0, 10);
  return db.transaccion(async cli => {
    const r = await cli.query(
      `UPDATE conductor_periodo_empleo SET baja = $2, motivo_baja = $3, usuario_id = $4
        WHERE conductor_id = $1 AND baja IS NULL RETURNING id`,
      [id, dia, motivo || null, usuarioId || null]);
    if (!r.rowCount) throw new Error('Esta persona no está de alta');

    await cli.query(
      `UPDATE asignacion SET hasta = $2 WHERE conductor_id = $1 AND (hasta IS NULL OR hasta > $2)`,
      [id, dia]);
    await vig.cerrar('situacion', id, dia, { cli });
    await vig.cerrar('turnoConductor', id, dia, { cli });
    await vig.cerrar('libranza', id, dia, { cli });
    await cli.query('UPDATE conductor SET empleo_vigente = FALSE WHERE id = $1', [id]);

    await audit.registrar({
      tabla: 'conductor', id, usuarioId, cli,
      cambios: [{ campo: 'baja', antes: null, ahora: `${dia}${motivo ? ' · ' + motivo : ''}` }],
    });
    return true;
  });
}

/**
 * La misma persona en dos coches el mismo día. Sale de la vista, que es la
 * ÚNICA definición de esta regla en todo el sistema.
 */
async function doblePlaza({ momento } = {}) {
  const r = await db.consulta(`
    SELECT d.*, ${NOMBRE} AS nombre_completo
      FROM v_conductor_doble_plaza d
      JOIN conductor c ON c.id = d.conductor_id
     WHERE COALESCE($1::date, CURRENT_DATE) BETWEEN d.solapa_desde AND d.solapa_hasta
     ORDER BY 8, d.dia_semana`, [momento || null]);
  return r.rows;
}

module.exports = {
  listar, ficha, resumen, catalogos, boltLibres, faltantesDe,
  CAMPOS, camposDe, GENERADAS,
  crear, actualizar, cambiarSituacion, cambiarTurno, guardarLibranza,
  enlazarBolt, soltarBolt, guardarTelefono,
  darDeAlta, darDeBaja, doblePlaza,
};
