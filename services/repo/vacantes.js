// ============================================================
// VACANTES — el puesto que hay que cubrir, sobre PostgreSQL
// ============================================================
// Una vacante es un conjunto de PLAZAS REALES que se prometen a alguien que
// todavía no está. Antes era una fila de la hoja VACANTES con las matrículas
// dentro de una celda en JSON; aquí es una fila con sus plazas colgando, y eso
// cambia tres cosas que se notan al usarlo:
//
//   · Se sabe qué plaza está comprometida, así que el planificador puede
//     pintarla reservada y no se puede prometer el mismo sitio dos veces.
//   · Existe el RECAMBIO: una vacante sobre una plaza que TIENE dueño y que se
//     va a quedar libre. Antes solo se sabían generar vacantes de huecos vacíos,
//     que es la mitad del trabajo.
//   · Selección la señala por clave foránea, así que se puede contestar "quién
//     viene a esta plaza y cuándo".
//
// ── LA JORNADA NO SE TECLEA ─────────────────────────────────────────────────
// Sale de las plazas: un FIJO lleva su coche toda la semana, son 40 h. Un
// correturnos cubre los días de descanso de los fijos de dos o tres coches: con
// 4 días son 32 h y con 6 son 40. Quien monta la vacante elige plazas; el
// contrato que se ofrece lo dice el catálogo (`cat_jornada.dias_ct`).

const db = require('../db');

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const ESTADOS = ['abierta', 'proceso', 'cubierta', 'anulada'];
const VIVAS = ['abierta', 'proceso'];

const letrasDe = dias => (dias || []).slice().sort((a, b) => a - b).map(d => LETRAS[d - 1]).join(' ');
/**
 * Una fecha de la base a 'AAAA-MM-DD'.
 *
 * node-postgres devuelve DATE como un `Date` en hora local, y `String(fecha)`
 * da "Wed Sep 30 2026…" — que recortado a 10 caracteres es "Wed Sep 30". Se leen
 * los componentes locales; `toISOString` tampoco vale, porque resta la zona y en
 * Madrid devuelve el día anterior.
 */
const iso = d => {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
};

/** 'V' + marca de tiempo en base 36. Es el código que se dice en voz alta. */
const nuevoCodigo = () => 'V' + Date.now().toString(36).toUpperCase();

// ── La jornada que sale de las plazas ───────────────────────────────────────
let _jornadas = null;
async function jornadas() {
  if (_jornadas) return _jornadas;
  const r = await db.consulta(
    'SELECT horas::float AS horas, etiqueta, dias_ct FROM cat_jornada WHERE activa ORDER BY horas');
  _jornadas = r.rows.map(x => ({ horas: Number(x.horas), etiqueta: x.etiqueta, dias: Number(x.dias_ct) }));
  return _jornadas;
}

/**
 * Qué contrato se está ofreciendo.
 *
 * FIJO → la jornada completa: lleva su coche todos los días que sale.
 * CT   → la que le corresponda por días cubiertos. Con el catálogo de hoy, 4
 *        días son 32 h y 6 son 40; si algún día se añade otro tramo, esto lo
 *        respeta solo porque el número no está escrito aquí.
 */
async function jornadaDe(rol, diasCubiertos) {
  const js = await jornadas();
  if (!js.length) return null;
  if (rol === 'FIJO') return js[js.length - 1].horas;
  const n = Number(diasCubiertos) || 0;
  // El tramo más alto que quepa; si no llega ni al más bajo, el más bajo (una
  // vacante a medio armar sigue ofreciendo el contrato pequeño, no ninguno).
  const cabe = js.filter(j => j.dias <= n);
  return (cabe.length ? cabe[cabe.length - 1] : js[0]).horas;
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Las plazas de una o varias vacantes, ya resueltas (coche, zona, días, quién la ocupa). */
async function plazasDe(vacanteIds) {
  if (!vacanteIds.length) return new Map();
  const r = await db.consulta(
    `SELECT * FROM v_vacante_plaza WHERE vacante_id = ANY($1::bigint[])
      ORDER BY vacante_id, matricula`, [vacanteIds]);
  const m = new Map();
  r.rows.forEach(x => {
    const k = String(x.vacante_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({
      vacantePlazaId: String(x.vacante_plaza_id),
      plazaId: String(x.plaza_id),
      vehiculoId: String(x.vehiculo_id),
      matricula: x.matricula,
      zona: x.zona || '',
      rol: x.rol, ordenCt: x.orden_ct, turno: x.turno || '',
      dias: (x.dias || []).map(Number),
      letras: x.letras || '',
      descansoCoche: (x.descanso_coche || []).map(Number),
      descansoLetras: letrasDe(x.descanso_coche || []),
      // Quién la ocupa HOY. En una vacante de recambio, el que se va.
      ocupaId: x.ocupa_id ? String(x.ocupa_id) : null,
      ocupa: x.ocupa || '',
      ocupaHasta: iso(x.ocupa_hasta),
    });
  });
  return m;
}

/** Da a una fila de `v_vacante` la forma que pintan las pantallas. */
function aSalida(x, plazas) {
  return {
    id: String(x.id), codigo: x.codigo, estado: x.estado, motivo: x.motivo,
    rol: x.rol, turno: x.turno || '', turnoId: x.turno_id || null,
    zona: x.zona || '', zonaId: x.base_zona_id || null,
    zonas: x.zonas || x.zona || '',
    jornadaHoras: x.jornada_horas == null ? null : Number(x.jornada_horas),
    plazas: plazas || [],
    nPlazas: Number(x.plazas) || 0,
    dias: Number(x.dias) || 0,
    matriculas: x.matriculas || '',
    libranzas: x.libranzas || '',
    // El puesto, dicho como se dice: "CT Noche · 32 h".
    puesto: `${x.rol === 'CT' ? 'CT' : 'Fijo'} ${x.turno || ''}`.trim() +
      (x.jornada_horas ? ` · ${Number(x.jornada_horas)} h` : ''),
    sustituyeA: x.sustituye_a ? String(x.sustituye_a) : null,
    sustituye: x.sustituye || '',
    salidaPrevista: iso(x.salida_prevista),
    notas: x.notas || '', motivoCierre: x.motivo_cierre || '',
    creadoAt: x.creado_at, cerradoAt: x.cerrado_at,
    // El candidato enganchado: es lo que contesta "quién viene y cuándo".
    candidaturaId: x.candidatura_id ? String(x.candidatura_id) : null,
    candidato: x.candidato || '',
    estadoCandidatura: x.estado_candidatura || '',
    inicioPrevisto: iso(x.inicio_previsto),
  };
}

/** Las vacantes. Por defecto, solo las vivas. */
async function listar({ estados, incluirCerradas = false } = {}) {
  const filtro = Array.isArray(estados) && estados.length
    ? estados.filter(e => ESTADOS.includes(e))
    : (incluirCerradas ? ESTADOS : VIVAS);
  const r = await db.consulta(
    `SELECT * FROM v_vacante WHERE estado = ANY($1)
      ORDER BY (estado = 'abierta') DESC, creado_at DESC`, [filtro]);
  const pl = await plazasDe(r.rows.map(x => x.id));
  return r.rows.map(x => aSalida(x, pl.get(String(x.id))));
}

/** Una vacante por id numérico o por su código ('V…'). */
async function ficha(ref) {
  const esNum = /^\d+$/.test(String(ref || '').trim());
  const r = await db.consulta(
    `SELECT * FROM v_vacante WHERE ${esNum ? 'id = $1::bigint' : 'codigo = $1'}`,
    [String(ref).trim()]);
  if (!r.rows.length) return null;
  const pl = await plazasDe([r.rows[0].id]);
  return aSalida(r.rows[0], pl.get(String(r.rows[0].id)));
}

/** Las que Selección puede ofrecer: abiertas y sin candidato enganchado. */
const disponibles = () => listar({ estados: ['abierta'] });

/**
 * Qué plazas están comprometidas ahora mismo, indexado por plaza.
 * Es lo que mira el planificador para pintar la reserva sobre la celda.
 */
async function comprometidas() {
  const r = await db.consulta('SELECT * FROM v_plaza_comprometida');
  const m = new Map();
  r.rows.forEach(x => m.set(String(x.plaza_id), {
    vacanteId: String(x.vacante_id), codigo: x.codigo, estado: x.estado,
    motivo: x.motivo, rol: x.rol, turno: x.turno || '', matricula: x.matricula || '',
    letras: x.letras || '', dias: (x.dias || []).map(Number),
    sustituyeA: x.sustituye_a ? String(x.sustituye_a) : null,
    sale: x.ocupa || '', salidaPrevista: iso(x.salida_prevista),
    candidato: x.candidato || '', inicioPrevisto: iso(x.inicio_previsto),
  }));
  return m;
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Crea una vacante con sus plazas.
 *
 * Todo o nada, y con la comprobación que faltaba: una plaza que ya está
 * prometida en otra vacante viva NO se puede volver a prometer. Antes esto se
 * miraba por matrícula y "a ver si cuela"; ahora lo dice la base.
 *
 * @param {{rol, turnoId, zonaId, motivo, sustituyeA, salidaPrevista, notas,
 *          plazas:[{plazaId, dias:[1..7]}]}} v
 */
async function crear(v = {}, { usuarioId } = {}) {
  const rol = v.rol === 'CT' ? 'CT' : 'FIJO';
  const motivo = v.motivo === 'recambio' ? 'recambio' : 'nueva';
  const plazas = (v.plazas || [])
    .map(p => ({
      plazaId: Number(p.plazaId),
      dias: [...new Set((p.dias || []).map(Number).filter(d => d >= 1 && d <= 7))].sort((a, b) => a - b),
    }))
    .filter(p => Number.isInteger(p.plazaId) && p.plazaId > 0);
  if (!plazas.length) throw new Error('La vacante no tiene ninguna plaza');
  if (motivo === 'recambio' && !Number(v.sustituyeA)) {
    throw new Error('Una vacante de recambio tiene que decir a quién sustituye');
  }

  // Un FIJO cubre toda la semana que su coche sale: no tiene días propios. Se
  // limpian aquí y no en la pantalla, para que dé igual quién llame.
  if (rol === 'FIJO') plazas.forEach(p => { p.dias = []; });

  // Los días solo deciden la jornada de un correturnos; un fijo es jornada
  // completa lleve el coche los días que lo lleve.
  const diasCubiertos = rol === 'CT' ? new Set(plazas.flatMap(p => p.dias)).size : 0;
  const jornada = v.jornadaHoras != null ? Number(v.jornadaHoras) : await jornadaDe(rol, diasCubiertos);

  return db.transaccion(async cli => {
    // Que las plazas existan y sean del rol y turno que dice la vacante: una
    // vacante de CT de noche sobre la plaza del fijo de día es un error de
    // pantalla, y aquí se ve antes de escribirla.
    const info = await cli.query(
      `SELECT p.id, p.slot, s.rol, s.turno_id, v.matricula
         FROM plaza p JOIN cat_slot s ON s.slot = p.slot
         JOIN vehiculo v ON v.id = p.vehiculo_id
        WHERE p.id = ANY($1::bigint[]) AND p.baja_at IS NULL`,
      [plazas.map(p => p.plazaId)]);
    const porId = new Map(info.rows.map(x => [String(x.id), x]));
    for (const p of plazas) {
      const d = porId.get(String(p.plazaId));
      if (!d) throw new Error(`La plaza ${p.plazaId} no existe o está dada de baja`);
      if (d.rol !== rol) throw new Error(`La plaza de ${d.matricula} es de ${d.rol}, no de ${rol}`);
    }
    const turnoId = Number(v.turnoId) || porId.get(String(plazas[0].plazaId)).turno_id;
    const distinto = plazas.find(p => porId.get(String(p.plazaId)).turno_id !== turnoId);
    if (distinto) {
      throw new Error(`La plaza de ${porId.get(String(distinto.plazaId)).matricula} no es del mismo turno`);
    }

    // Ya prometida en otra vacante viva.
    const choque = await cli.query(
      `SELECT c.codigo, w.matricula
         FROM v_plaza_comprometida c
         LEFT JOIN v_vacante_plaza w ON w.plaza_id = c.plaza_id AND w.vacante_id = c.vacante_id
        WHERE c.plaza_id = ANY($1::bigint[]) LIMIT 1`, [plazas.map(p => p.plazaId)]);
    if (choque.rows.length) {
      throw new Error(`La plaza de ${choque.rows[0].matricula} ya está prometida en la vacante ${choque.rows[0].codigo}`);
    }

    const codigo = nuevoCodigo();
    const r = await cli.query(
      `INSERT INTO vacante (codigo, estado, motivo, rol, turno_id, base_zona_id,
                            jornada_horas, sustituye_a, salida_prevista, notas, usuario_id)
       VALUES ($1, 'abierta', $2, $3, $4, $5, $6, $7, $8::date, $9, $10)
       RETURNING id`,
      [codigo, motivo, rol, turnoId || null, Number(v.zonaId) || null,
        jornada || null, Number(v.sustituyeA) || null, iso(v.salidaPrevista),
        String(v.notas || '').trim() || null, usuarioId || null]);
    const id = r.rows[0].id;

    for (const p of plazas) {
      const vp = await cli.query(
        'INSERT INTO vacante_plaza (vacante_id, plaza_id) VALUES ($1, $2) RETURNING id',
        [id, p.plazaId]);
      for (const d of p.dias) {
        await cli.query('INSERT INTO vacante_plaza_dia (vacante_plaza_id, dia_semana) VALUES ($1, $2)',
          [vp.rows[0].id, d]);
      }
    }
    return { id: String(id), codigo, rol, motivo, jornadaHoras: jornada, plazas: plazas.length };
  });
}

/**
 * Mueve el estado. Acepta id o código, para que valga igual desde Selección
 * (que guarda el código) y desde las pantallas nuevas.
 *
 * 'cubierta' y 'anulada' cierran; volver a 'abierta' reabre y borra el cierre —
 * es lo que pasa cuando un candidato se cae: a esa vacante nunca entró nadie.
 */
async function cambiarEstado(ref, estado, { motivo, usuarioId } = {}) {
  if (!ESTADOS.includes(estado)) throw new Error(`Estado de vacante no válido: ${estado}`);
  const esNum = /^\d+$/.test(String(ref || '').trim());
  const cierra = estado === 'cubierta' || estado === 'anulada';
  const r = await db.consulta(
    `UPDATE vacante
        SET estado = $2,
            motivo_cierre = CASE WHEN $3::text IS NULL THEN motivo_cierre ELSE $3 END,
            cerrado_at = ${cierra ? 'COALESCE(cerrado_at, now())' : 'NULL'},
            usuario_id = COALESCE($4, usuario_id),
            actualizado_at = now()
      WHERE ${esNum ? 'id = $1::bigint' : 'codigo = $1'}
      RETURNING id, codigo, estado`,
    [String(ref).trim(), estado, String(motivo || '').trim().slice(0, 200) || null, usuarioId || null]);
  if (!r.rowCount) return { ok: false, motivo: 'no existe' };
  return { ok: true, id: String(r.rows[0].id), codigo: r.rows[0].codigo, estado: r.rows[0].estado };
}

/**
 * Borra una vacante. Solo si NADIE la ha tocado: si tiene candidato enganchado
 * o ya se cubrió, se anula (que deja rastro) en vez de borrarse.
 */
async function eliminar(id, { usuarioId } = {}) {
  const f = await ficha(id);
  if (!f) throw new Error('No existe esa vacante');
  if (f.candidaturaId || f.estado === 'cubierta') {
    await cambiarEstado(f.id, 'anulada', { motivo: 'Anulada por Tráfico', usuarioId });
    return { anulada: true, codigo: f.codigo };
  }
  await db.consulta('DELETE FROM vacante WHERE id = $1', [Number(f.id)]);
  return { borrada: true, codigo: f.codigo };
}

// ── EL RECAMBIO ─────────────────────────────────────────────────────────────

/**
 * La plantilla planificada, para elegir a quién se saca. Es la lista que se
 * busca en "Buscar recambio": todo el que tiene plaza viva, con su coche, su
 * turno, su zona, sus libranzas y sus horas.
 */
async function plantillaPlanificada({ busca, limite = 400 } = {}) {
  const par = [];
  let filtro = '';
  const t = String(busca || '').trim();
  if (t) {
    par.push('%' + t + '%');
    filtro = `AND (x.nombre ILIKE $1 OR x.matriculas ILIKE $1 OR x.telefono ILIKE $1)`;
  }
  par.push(Math.min(Number(limite) || 400, 1000));

  const r = await db.consulta(
    `WITH plazas AS (
       SELECT a.conductor_id,
              count(*)::int                                   AS plazas,
              string_agg(DISTINCT vp.matricula, ' · ')         AS matriculas,
              string_agg(DISTINCT NULLIF(vp.zona, ''), ' · ')   AS zonas,
              min(vp.rol)                                      AS rol,
              min(vp.turno)                                    AS turno,
              -- Los días que cubre de verdad: un fijo, todos menos el descanso
              -- de su coche; un correturnos, los que le hayan marcado.
              COALESCE(sum(CASE WHEN vp.rol = 'CT'
                                THEN (SELECT count(*) FROM asignacion_dia ad WHERE ad.asignacion_id = a.id)
                                ELSE 7 - (SELECT count(*)
                                            FROM vehiculo_descanso vd
                                            JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                                           WHERE vd.vehiculo_id = vp.vehiculo_id
                                             AND vd.desde <= CURRENT_DATE
                                             AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE))
                           END), 0)::int                       AS dias
         FROM asignacion a
         JOIN v_plaza vp ON vp.plaza_id = a.plaza_id
        WHERE a.hasta IS NULL AND a.retirada_at IS NULL
        GROUP BY a.conductor_id)
     SELECT * FROM (
       SELECT c.id AS conductor_id,
              COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
              tel.e164 AS telefono,
              e.alta::text AS alta, e.jornada_horas, e.tipo AS contrato_tipo, e.ett_nombre,
              pz.plazas, pz.matriculas, pz.zonas, pz.rol, pz.turno, pz.dias,
              COALESCE(ce.etiqueta, 'Activo') AS estado,
              COALESCE(ce.es_ausencia, FALSE) AS ausente,
              -- Su media de horas de las últimas 4 semanas: es el dato con el que
              -- se decide si a alguien se le busca recambio.
              (SELECT round(avg(b.horas_seg) / 3600.0, 1)::float8
                 FROM bitacora_horas b
                WHERE b.conductor_id = c.id
                  AND b.dia_operativo >= CURRENT_DATE - 28) AS media_horas,
              (SELECT count(*)::int FROM bitacora_horas b
                WHERE b.conductor_id = c.id AND b.dia_operativo >= CURRENT_DATE - 28
                  AND b.horas_seg > 0) AS dias_con_horas,
              (SELECT k.codigo FROM vacante k
                WHERE k.sustituye_a = c.id AND k.estado IN ('abierta', 'proceso')
                ORDER BY k.creado_at DESC LIMIT 1) AS vacante_abierta
         FROM conductor c
         JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
         JOIN plazas pz ON pz.conductor_id = c.id
         LEFT JOIN LATERAL (
           SELECT e164 FROM conductor_telefono
            WHERE conductor_id = c.id AND vigente_hasta IS NULL
            ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
         LEFT JOIN conductor_estado_hist h
                ON h.conductor_id = c.id
               AND h.desde <= CURRENT_DATE AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE)
         LEFT JOIN cat_estado_conductor ce ON ce.codigo = h.estado
        WHERE NOT c.es_centinela) x
      WHERE TRUE ${filtro}
      ORDER BY x.media_horas NULLS FIRST, x.nombre
      LIMIT $${par.length}`, par);

  return r.rows.map(x => ({
    conductorId: String(x.conductor_id), nombre: x.nombre, telefono: x.telefono || '',
    alta: x.alta || '', jornadaHoras: x.jornada_horas == null ? null : Number(x.jornada_horas),
    contrato: x.contrato_tipo === 'ett' ? (x.ett_nombre || 'ETT') : 'Propia',
    plazas: Number(x.plazas), matriculas: x.matriculas || '', zonas: x.zonas || '',
    rol: x.rol, turno: x.turno || '', dias: Number(x.dias) || 0,
    estado: x.estado, ausente: !!x.ausente,
    mediaHoras: x.media_horas == null ? null : Number(x.media_horas),
    diasConHoras: Number(x.dias_con_horas) || 0,
    vacanteAbierta: x.vacante_abierta || null,
  }));
}

/**
 * LA PROPUESTA DE RECAMBIO.
 *
 * Se le da un conductor y devuelve la vacante que habría que abrir para
 * sustituirlo: sus plazas de verdad —con coche, zona, turno y los días que
 * cubre—, la libranza que se ofrece y el contrato que sale de todo eso.
 *
 * No escribe nada. Quien la mira decide si quitar alguna plaza (a veces se
 * sustituye solo una parte) y entonces se crea.
 */
async function propuestaRecambio(conductorId) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');

  const [quien, plazas] = await Promise.all([
    db.consulta(
      `SELECT c.id,
              COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
              tel.e164 AS telefono, c.barrio,
              e.alta::text AS alta, e.jornada_horas, e.tipo AS contrato_tipo, e.ett_nombre,
              COALESCE(ce.etiqueta, 'Activo') AS estado,
              th.turno_id, t.etiqueta AS turno,
              (SELECT round(avg(b.horas_seg) / 3600.0, 1)::float8 FROM bitacora_horas b
                WHERE b.conductor_id = c.id AND b.dia_operativo >= CURRENT_DATE - 28) AS media_horas,
              (SELECT round(sum(b.horas_seg) / 3600.0, 1)::float8 FROM bitacora_horas b
                WHERE b.conductor_id = c.id AND b.dia_operativo >= CURRENT_DATE - 28) AS horas_28
         FROM conductor c
         LEFT JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
         LEFT JOIN LATERAL (
           SELECT e164 FROM conductor_telefono
            WHERE conductor_id = c.id AND vigente_hasta IS NULL
            ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
         LEFT JOIN conductor_turno_hist th ON th.conductor_id = c.id
               AND th.desde <= CURRENT_DATE AND (th.hasta IS NULL OR th.hasta >= CURRENT_DATE)
         LEFT JOIN turno t ON t.id = th.turno_id
         LEFT JOIN conductor_estado_hist h ON h.conductor_id = c.id
               AND h.desde <= CURRENT_DATE AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE)
         LEFT JOIN cat_estado_conductor ce ON ce.codigo = h.estado
        WHERE c.id = $1`, [cid]),

    db.consulta(
      `SELECT vp.plaza_id, vp.vehiculo_id, vp.matricula, vp.estado_operativo,
              COALESCE(cev.etiqueta, vp.estado_operativo) AS estado_coche,
              COALESCE(vp.zona, '') AS zona, vp.base_zona_id, vp.cuadrante,
              vp.rol, vp.orden_ct, vp.turno_id, vp.turno,
              a.id AS asignacion_id, a.desde::text AS desde,
              COALESCE(
                (SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana)
                   FROM asignacion_dia ad WHERE ad.asignacion_id = a.id),
                ARRAY[]::smallint[]) AS dias,
              COALESCE(
                (SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana)
                   FROM vehiculo_descanso vd
                   JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                  WHERE vd.vehiculo_id = vp.vehiculo_id
                    AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)),
                ARRAY[]::smallint[]) AS descanso_coche,
              (SELECT k.codigo FROM vacante k
                 JOIN vacante_plaza w ON w.vacante_id = k.id AND w.plaza_id = vp.plaza_id
                WHERE k.estado IN ('abierta', 'proceso') LIMIT 1) AS comprometida
         FROM asignacion a
         JOIN v_plaza vp ON vp.plaza_id = a.plaza_id
         LEFT JOIN cat_estado_vehiculo cev ON cev.codigo = vp.estado_operativo
        WHERE a.conductor_id = $1 AND a.hasta IS NULL AND a.retirada_at IS NULL
        ORDER BY vp.rol, vp.matricula`, [cid]),
  ]);

  const c = quien.rows[0];
  if (!c) throw new Error('No existe ese conductor');
  if (!plazas.rows.length) {
    throw new Error(`${c.nombre} no tiene ninguna plaza en el planificador: no hay nada que recambiar`);
  }

  const rol = plazas.rows[0].rol;
  const mezcla = plazas.rows.some(p => p.rol !== rol);
  const salida = plazas.rows.map(p => {
    // Un FIJO no tiene días propios: cubre toda la semana menos el descanso de
    // su coche. Un CT cubre los que tenga marcados y, si no tiene, los del
    // descanso —que es justo lo que significa correturnos—.
    const desc = (p.descanso_coche || []).map(Number);
    const propios = (p.dias || []).map(Number);
    const dias = p.rol === 'CT'
      ? (propios.length ? propios : desc)
      : [1, 2, 3, 4, 5, 6, 7].filter(d => !desc.includes(d));
    return {
      plazaId: String(p.plaza_id), vehiculoId: String(p.vehiculo_id),
      matricula: p.matricula, zona: p.zona, zonaId: p.base_zona_id || null,
      estadoCoche: p.estado_coche, operativo: p.estado_operativo === 'O',
      cuadrante: p.cuadrante || '',
      rol: p.rol, ordenCt: p.orden_ct, turnoId: p.turno_id, turno: p.turno,
      desde: p.desde,
      dias, letras: letrasDe(dias),
      descansoCoche: desc, descansoLetras: letrasDe(desc),
      comprometida: p.comprometida || null,
    };
  });

  const cubiertos = new Set(salida.flatMap(p => p.dias));
  const jornada = await jornadaDe(rol, cubiertos.size);
  const libranzas = [1, 2, 3, 4, 5, 6, 7].filter(d => !cubiertos.has(d));

  return {
    conductor: {
      id: String(c.id), nombre: c.nombre, telefono: c.telefono || '', barrio: c.barrio || '',
      alta: c.alta || '', estado: c.estado,
      turnoId: c.turno_id || null, turno: c.turno || '',
      jornadaHoras: c.jornada_horas == null ? null : Number(c.jornada_horas),
      contrato: c.contrato_tipo === 'ett' ? (c.ett_nombre || 'ETT') : 'Propia',
      mediaHoras: c.media_horas == null ? null : Number(c.media_horas),
      horas28: c.horas_28 == null ? null : Number(c.horas_28),
    },
    rol, mezcla,
    turnoId: salida[0].turnoId, turno: salida[0].turno,
    zonaId: salida[0].zonaId, zona: salida[0].zona,
    zonas: [...new Set(salida.map(p => p.zona).filter(Boolean))].join(' · '),
    plazas: salida,
    dias: cubiertos.size,
    diasLetras: letrasDe([...cubiertos]),
    libranzas, libranzasLetras: letrasDe(libranzas),
    jornadaHoras: jornada,
    // Por qué esa jornada, dicho en una línea: es lo que evita la discusión de
    // "y por qué a este 32 y al otro 40".
    porQueJornada: rol === 'FIJO'
      ? 'Fijo: lleva su coche todos los días que sale, jornada completa'
      : `Correturnos de ${cubiertos.size} día${cubiertos.size === 1 ? '' : 's'} ` +
        `(${salida.length} coche${salida.length === 1 ? '' : 's'}) → ${jornada} h`,
    // Ya hay una vacante viva para sustituirlo: no se abren dos.
    yaTiene: (await db.consulta(
      `SELECT codigo FROM vacante WHERE sustituye_a = $1 AND estado IN ('abierta','proceso') LIMIT 1`,
      [cid])).rows.map(x => x.codigo)[0] || null,
  };
}

module.exports = {
  ESTADOS, VIVAS, LETRAS, letrasDe, jornadas, jornadaDe,
  listar, ficha, disponibles, comprometidas,
  crear, cambiarEstado, eliminar,
  plantillaPlanificada, propuestaRecambio,
};
