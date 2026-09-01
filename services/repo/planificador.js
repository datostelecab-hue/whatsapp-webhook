// ============================================================
// PLANIFICADOR — el tablero, sobre PostgreSQL
// ============================================================
// Sustituye a leer PLANIFICADOR_V2 y AGENDA_V2 de la hoja. No es la misma
// lógica traducida: es otra, porque la de la hoja estaba limitada por la hoja.
//
// Lo que se va con ella:
//
//   · El ID de BOLT como clave. Era el NOMBRE tal como lo escribe BOLT, y todo
//     el tablero colgaba de que ese texto coincidiera carácter a carácter. Aquí
//     la clave es el id del conductor, que no cambia porque alguien corrija una
//     tilde. La cuenta de BOLT pasa a ser un dato más de la persona.
//   · Los días escritos a mano ("L M X"). Ahora son filas en `asignacion_dia`.
//   · Una foto del presente. La hoja solo sabía decir quién está HOY en cada
//     plaza; `asignacion` tiene desde y hasta, así que se puede mirar cualquier
//     semana y planificar hacia delante sin pisar lo de antes.
//
// LA REGLA de quién cubre qué día NO está aquí: está en `f_cobertura`, en la
// base. Este módulo la consulta y le da forma de tablero. Si mañana cambia lo
// que significa un correturnos, se cambia en un sitio.

const db = require('../db');

// Lunes = 1, como ISODOW. El tablero pinta de lunes a domingo.
const DIAS = 7;
const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Como se llama una plaza cuando hay que nombrarla: "Fijo dia", "CT1 noche". */
const etiquetaPlaza = (rol, ordenCt, turno) =>
  (rol === 'CT' ? 'CT' + (ordenCt || '') : 'Fijo') + ' ' + String(turno || '').toLowerCase();

/** El lunes de la semana que contiene esa fecha. */
function lunesDe(dia) {
  const d = new Date(dia + 'T00:00:00');
  const desplaza = (d.getDay() + 6) % 7;          // domingo=0 → 6
  d.setDate(d.getDate() - desplaza);
  return aISO(d);
}

const aISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Una fecha de PostgreSQL a 'AAAA-MM-DD', sin pasar por UTC. */
function fechaDe(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '' : aISO(d);
}

const hoy = () => aISO(new Date());

/** Los siete días de la semana que empieza ese lunes. */
function semanaDesde(lunes) {
  const base = new Date(lunes + 'T00:00:00');
  return Array.from({ length: DIAS }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return aISO(d);
  });
}

/**
 * El tablero de una semana.
 *
 * `dia` es la fecha EFECTIVA: decide qué semana se pinta y, cuando se guarda,
 * desde cuándo valen los cambios. Por omisión, hoy.
 */
async function tablero({ dia } = {}) {
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();
  const lunes = lunesDe(efectivo);
  const fechas = semanaDesde(lunes);
  const domingo = fechas[DIAS - 1];

  const [plazas, asignaciones, cobertura, conductores, sugeridos, huerfanos, emergencia, libranzasExc, descansos] = await Promise.all([
    // Las plazas de los coches que se planifican. El orden es el de la
    // pantalla: primero la zona, luego la matrícula.
    db.consulta(
      `SELECT plaza_id, vehiculo_id, matricula, zona, base_zona_id, estado_operativo,
              es_operativo, visible_cobertura, slot, turno_codigo, turno, rol, orden_ct,
              cuadrante_id, cuadrante
         FROM v_plaza
        WHERE visible_cobertura OR cuadrante_id IS NOT NULL
        ORDER BY zona NULLS LAST, cuadrante NULLS LAST, matricula, slot`),

    // Lo que hay escrito para esta semana, con sus días si es correturnos.
    db.consulta(
      `SELECT a.id, a.plaza_id, a.conductor_id, a.desde, a.hasta,
              (SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana)
                 FROM asignacion_dia ad WHERE ad.asignacion_id = a.id) AS dias
         FROM asignacion a
         JOIN plaza p ON p.id = a.plaza_id AND p.baja_at IS NULL
        WHERE a.desde <= $2 AND (a.hasta IS NULL OR a.hasta >= $1)
        ORDER BY a.desde`, [lunes, domingo]),

    // Día a día, quién cubre qué. La regla vive en la base.
    db.consulta('SELECT * FROM f_cobertura($1, $2)', [lunes, domingo]),

    // Quién se puede planificar. No hay "agenda": es la plantilla con contrato
    // abierto, su turno, su libranza y su jornada.
    db.consulta(
      `SELECT c.id,
              btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre,
              c.dni_nie,
              e.alta, e.jornada_horas, e.tipo AS contrato_tipo, e.ett_nombre,
              j.dias_ct,
              th.turno_id, t.codigo AS turno_codigo, t.etiqueta AS turno,
              lib.dias                                   AS libra,
              (ext.externo_id IS NULL)                   AS bolt_pendiente,
              est.estado, ce.etiqueta AS estado_etiqueta, ce.es_ausencia,
              ce.libera_plaza, est.hasta AS estado_hasta,
              prox.estado AS prox_estado, prox.etiqueta AS prox_etiqueta, prox.desde AS prox_desde
         FROM conductor c
         JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
         LEFT JOIN cat_jornada j  ON j.horas = e.jornada_horas
         LEFT JOIN conductor_turno_hist th
                ON th.conductor_id = c.id
               AND th.desde <= $1 AND (th.hasta IS NULL OR th.hasta >= $1)
         LEFT JOIN turno t ON t.id = th.turno_id
         LEFT JOIN LATERAL (
           SELECT array_agg(d.dia_semana ORDER BY d.dia_semana) AS dias
             FROM patron_libranza pl
             JOIN patron_libranza_dia d ON d.patron_id = pl.id
            WHERE pl.conductor_id = c.id
              AND pl.desde <= $1 AND (pl.hasta IS NULL OR pl.hasta >= $1)) lib ON TRUE
         LEFT JOIN LATERAL (
           SELECT externo_id FROM conductor_externo
            WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
            ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
         LEFT JOIN conductor_estado_hist est
                ON est.conductor_id = c.id
               AND est.desde <= $1 AND (est.hasta IS NULL OR est.hasta >= $1)
         LEFT JOIN cat_estado_conductor ce ON ce.codigo = est.estado
         -- La proxima ausencia que aun no ha empezado (para avisar "entra el...").
         LEFT JOIN LATERAL (
           SELECT h.estado, h.desde, cec.etiqueta
             FROM conductor_estado_hist h
             JOIN cat_estado_conductor cec ON cec.codigo = h.estado
            WHERE h.conductor_id = c.id AND cec.es_ausencia AND h.desde > $1
            ORDER BY h.desde LIMIT 1) prox ON TRUE
        WHERE NOT c.es_centinela
        ORDER BY nombre`, [efectivo]),

    // Qué días le tocarían a un correturnos en cada plaza: los que libra el
    // fijo de ese coche y turno.
    db.consulta('SELECT plaza_id, dias_sugeridos FROM v_plaza_ct_sugerida'),

    // Conductores huérfanos: su coche salió de cobertura (taller, siniestro,
    // emergencia) y se quedaron sin sitio. Es una foto de "ahora".
    db.consulta('SELECT * FROM v_conductor_huerfano ORDER BY zona NULLS LAST, matricula'),

    // El pool de emergencia = coches OPERATIVOS y SIN NADIE asignado (reserva).
    // Operativos a proposito: un coche en taller/siniestro sin gente NO sirve de
    // repuesto (esta roto), aunque no tenga a nadie.
    db.consulta(
      `SELECT v.id AS vehiculo_id, v.matricula, v.base_zona_id, bz.nombre AS zona,
              v.estado_operativo
         FROM vehiculo v
         JOIN cat_estado_vehiculo cev ON cev.codigo = v.estado_operativo
         LEFT JOIN base_zona bz ON bz.id = v.base_zona_id
        WHERE v.baja_at IS NULL
          AND cev.es_operativo
          AND NOT EXISTS (
            SELECT 1 FROM plaza p
              JOIN asignacion a ON a.plaza_id = p.id
                               AND a.hasta IS NULL AND a.retirada_at IS NULL
             WHERE p.vehiculo_id = v.id AND p.baja_at IS NULL)
        ORDER BY bz.nombre NULLS LAST, v.matricula`),

    // Las libranzas excepcionales que tocan esta semana (para avisarlas en el
    // tablero): la que trabaja o la que libra cae dentro de la semana.
    db.consulta(
      `SELECT le.id, le.conductor_id, le.dia_trabaja, le.dia_libra, le.motivo,
              btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS conductor
         FROM libranza_excepcional le JOIN conductor c ON c.id = le.conductor_id
        WHERE le.dia_trabaja BETWEEN $1 AND $2 OR le.dia_libra BETWEEN $1 AND $2
        ORDER BY le.dia_trabaja`, [lunes, domingo]),

    // El descanso (bloque) de cada coche vigente el dia efectivo.
    db.consulta(
      `SELECT vd.vehiculo_id, array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
         FROM vehiculo_descanso vd
         JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
        WHERE vd.desde <= $1 AND (vd.hasta IS NULL OR vd.hasta >= $1)
        GROUP BY vd.vehiculo_id`, [efectivo]),
  ]);

  const descansoDe = new Map(descansos.rows.map(r => [String(r.vehiculo_id), (r.dias || []).map(Number)]));

  const sugeridoDe = new Map(sugeridos.rows.map(r => [String(r.plaza_id), r.dias_sugeridos || []]));

  // ── Las personas, indexadas ────────────────────────────────────────────
  const gente = new Map();
  conductores.rows.forEach(c => {
    const libra = new Array(DIAS).fill(false);
    (c.libra || []).forEach(d => { libra[d - 1] = true; });
    gente.set(String(c.id), {
      id: String(c.id),
      nombre: c.nombre,
      dni: c.dni_nie || '',
      turno: c.turno || '',
      turnoCodigo: c.turno_codigo || '',
      turnoId: c.turno_id || null,
      alta: fechaDe(c.alta),
      jornadaHoras: c.jornada_horas == null ? null : Number(c.jornada_horas),
      diasQueDebeCT: c.dias_ct == null ? null : Number(c.dias_ct),
      contrato: c.jornada_horas ? `${Number(c.jornada_horas)}h${c.contrato_tipo === 'ett' ? ' ETT' : ''}` : '',
      esEtt: c.contrato_tipo === 'ett',
      ettNombre: c.ett_nombre || '',
      boltPendiente: !!c.bolt_pendiente,
      estado: c.estado_etiqueta || 'Activo',
      ausente: !!c.es_ausencia,
      // Su estado libera la plaza (vacaciones/suspendido/baja): sale del cuadrante.
      liberaPlaza: !!c.libera_plaza,
      // Cuando vuelve de la ausencia actual (para avisar la vuelta proxima).
      vuelveEl: fechaDe(c.estado_hasta),
      // La proxima ausencia que aun no ha empezado (para avisar "entra el...").
      proxAusencia: c.prox_desde ? { estado: c.prox_etiqueta, desde: fechaDe(c.prox_desde) } : null,
      libra,
      // Se rellenan con la cobertura, más abajo.
      trabaja: new Array(DIAS).fill(false),
      diasAsignados: 0,
      plazas: 0,
    });
  });

  // ── La cobertura, día a día ────────────────────────────────────────────
  const indiceDia = new Map(fechas.map((f, i) => [f, i]));
  // vehiculo → turno → día → [conductores]
  const cubre = new Map();
  cobertura.rows.forEach(r => {
    const i = indiceDia.get(fechaDe(r.dia));
    if (i === undefined) return;
    const clave = `${r.vehiculo_id}|${r.turno_id}`;
    if (!cubre.has(clave)) cubre.set(clave, Array.from({ length: DIAS }, () => []));
    cubre.get(clave)[i].push(String(r.conductor_id));

    const p = gente.get(String(r.conductor_id));
    if (p && !p.trabaja[i]) { p.trabaja[i] = true; p.diasAsignados++; }
  });

  // ── Las asignaciones por plaza ─────────────────────────────────────────
  // La plaza muestra a quien esta vigente el dia EFECTIVO (no a quien estuvo
  // antes en la semana): asi "dejar vacia" -que cierra la asignacion la vispera-
  // limpia la celda de verdad, y el banquillo cuenta bien.
  const porPlaza = new Map();
  asignaciones.rows.forEach(a => {
    if (fechaDe(a.desde) <= efectivo && (!a.hasta || fechaDe(a.hasta) >= efectivo)) {
      porPlaza.set(String(a.plaza_id), a);
      const p = gente.get(String(a.conductor_id));
      if (p) p.plazas++;
    }
  });

  // ── El tablero ─────────────────────────────────────────────────────────
  const coches = [];
  const porVehiculo = new Map();
  plazas.rows.forEach(p => {
    const k = String(p.vehiculo_id);
    if (!porVehiculo.has(k)) {
      const coche = {
        idx: coches.length,
        vehiculoId: p.vehiculo_id,
        matricula: p.matricula,
        zona: p.zona || '',
        zonaId: p.base_zona_id || null,
        cuadranteId: p.cuadrante_id || null,
        cuadrante: p.cuadrante || '',
        // El descanso del coche (bloque): los días que libran sus fijos.
        descanso: descansoDe.get(String(p.vehiculo_id)) || [],
        // `estadoVeh` con el nombre que usa el front. Es el CODIGO de la base
        // ('O', 'R', 'T'...), no el simbolo de la hoja: quien decide que
        // significa operativo es `cat_estado_vehiculo`, no una lista de textos.
        estadoVeh: p.estado_operativo,
        operativo: !!p.es_operativo,
        visibleCobertura: !!p.visible_cobertura,
        // Seis plazas; se rellenan por su número de slot.
        personas: Array.from({ length: 6 }, () => null),
        semana: Array.from({ length: DIAS * 2 }, () => ({ id: '', nombre: '', conflicto: false })),
      };
      porVehiculo.set(k, coche);
      coches.push(coche);
    }
    const coche = porVehiculo.get(k);
    const a = porPlaza.get(String(p.plaza_id));
    const persona = a ? gente.get(String(a.conductor_id)) : null;
    const dias = new Array(DIAS).fill(false);
    (a && a.dias ? a.dias : []).forEach(d => { dias[d - 1] = true; });

    coche.personas[p.slot] = {
      plazaId: String(p.plaza_id),
      slot: p.slot,
      rol: p.rol,
      turno: p.turno,
      turnoCodigo: p.turno_codigo,
      ordenCt: p.orden_ct,
      // Cómo se llama esta plaza cuando hay que nombrarla en un mensaje.
      etiqueta: etiquetaPlaza(p.rol, p.orden_ct, p.turno),
      id: persona ? persona.id : '',
      nombre: persona ? persona.nombre : '',
      asignacionId: a ? String(a.id) : '',
      desde: a ? fechaDe(a.desde) : '',
      hasta: a ? fechaDe(a.hasta) : '',
      diasManual: dias,
      // Lo que le tocaría si nadie dice otra cosa: los días que libra el fijo.
      diasSugeridos: (sugeridoDe.get(String(p.plaza_id)) || []).map(d => d - 1),
      huerfano: !!(a && !persona),
    };
  });

  // Una plaza que no existe en la base se pinta igual, vacía: el tablero tiene
  // seis huecos por coche pase lo que pase.
  coches.forEach(coche => {
    for (let k = 0; k < 6; k++) {
      if (coche.personas[k]) continue;
      coche.personas[k] = {
        plazaId: '', slot: k, rol: k < 2 ? 'FIJO' : 'CT',
        turno: k % 2 === 0 ? 'Día' : 'Noche', turnoCodigo: k % 2 === 0 ? 'dia' : 'noche',
        ordenCt: k < 2 ? null : (k < 4 ? 1 : 2),
        etiqueta: etiquetaPlaza(k < 2 ? 'FIJO' : 'CT', k < 2 ? null : (k < 4 ? 1 : 2),
          k % 2 === 0 ? 'Día' : 'Noche'),
        id: '', nombre: '', asignacionId: '', desde: '', hasta: '',
        diasManual: new Array(DIAS).fill(false), diasSugeridos: [], huerfano: false,
      };
    }
  });

  // ── La tira de cobertura, y los días sin cubrir ────────────────────────
  const turnoIdDe = new Map();
  plazas.rows.forEach(p => turnoIdDe.set(p.turno_codigo, p.turno_id));

  let diasSinCubrirDia = 0, diasSinCubrirNoche = 0;
  coches.forEach(coche => {
    ['dia', 'noche'].forEach((codigo, off) => {
      const lista = cubre.get(`${coche.vehiculoId}|${turnoIdDe.get(codigo)}`)
        || Array.from({ length: DIAS }, () => []);
      let sinCubrir = 0;
      for (let d = 0; d < DIAS; d++) {
        const quienes = lista[d];
        const celda = coche.semana[d * 2 + off];
        if (!quienes.length) {
          if (coche.operativo) sinCubrir++;
          continue;
        }
        const p = gente.get(quienes[0]);
        celda.id = quienes[0];
        celda.nombre = p ? p.nombre : '';
        // Dos personas cubriendo el mismo coche, turno y día. La base impide
        // que compartan PLAZA, no que un fijo y su correturnos se solapen.
        celda.conflicto = quienes.length > 1;
        if (celda.conflicto) celda.otros = quienes.slice(1).map(i => (gente.get(i) || {}).nombre || i);
      }
      if (off === 0) diasSinCubrirDia += sinCubrir; else diasSinCubrirNoche += sinCubrir;
      coche[off === 0 ? 'sinCubrirDia' : 'sinCubrirNoche'] = sinCubrir;
    });
  });

  // ── El banquillo ───────────────────────────────────────────────────────
  // Quien no tiene ninguna plaza esta semana. Incluye a los que empiezan más
  // adelante: se les ve para poder colocarlos antes de que entren.
  // El banquillo = disponibles de verdad: sin plaza y SIN ausencia. Los que
  // estan de baja/vacaciones/suspendidos no se ofrecen para colocar.
  const pendientes = [...gente.values()].filter(p => !p.plazas && !p.ausente);
  const cuadrantes = await listarCuadrantes();
  const zonas = (await db.consulta('SELECT id, nombre FROM base_zona WHERE activa ORDER BY nombre')).rows
    .map(z => ({ id: z.id, nombre: z.nombre }));

  return {
    dia: efectivo,
    lunes,
    fechas,
    cuadrantes,
    zonas,
    dias: LETRAS,
    coches,
    conductores: [...gente.values()],
    // El banquillo. Van las personas enteras y no sus ids: el front las pinta
    // por nombre y no tendria de donde sacarlo.
    pendientes,
    // Conductores sin coche porque el suyo salio de cobertura (taller...): hay
    // que recolocarlos, normalmente en un coche de emergencia.
    huerfanos: huerfanos.rows.map(h => ({
      asignacionId: String(h.asignacion_id),
      conductorId: String(h.conductor_id),
      conductor: h.conductor,
      matricula: h.matricula,
      estadoVeh: h.estado_operativo,
      estado: h.estado_etiqueta,
      zona: h.zona || '',
      turno: h.turno,
      rol: h.rol,
    })),
    // Coches de emergencia disponibles para colocar en un cuadrante.
    emergencia: emergencia.rows.map(e => ({
      vehiculoId: e.vehiculo_id,
      matricula: e.matricula,
      zona: e.zona || '',
      zonaId: e.base_zona_id || null,
    })),
    // Libranzas excepcionales activas esta semana.
    libranzasSemana: libranzasExc.rows.map(l => ({
      id: String(l.id),
      conductorId: String(l.conductor_id),
      conductor: l.conductor,
      diaTrabaja: fechaDe(l.dia_trabaja),
      diaLibra: fechaDe(l.dia_libra),
      motivo: l.motivo || '',
    })),
    resumen: {
      coches: coches.filter(c => c.operativo).length,
      diasSinCubrirDia,
      diasSinCubrirNoche,
      // A dos días por coche, un correturnos de 40 horas cubre seis días. Es lo
      // que convierte "faltan 14 días" en "hacen falta 3 personas", que es la
      // pregunta que se hace de verdad.
      ctQueFaltanDia: Math.ceil(diasSinCubrirDia / 6),
      ctQueFaltanNoche: Math.ceil(diasSinCubrirNoche / 6),
      pendientes: pendientes.length,
    },
    avisos: avisosDe(coches, gente),
  };
}

/**
 * Lo que hay que mirar, dicho con nombres.
 *
 * No son todos los problemas posibles: son los que impiden que alguien salga a
 * trabajar, más los que hacen que el tablero mienta.
 */
function avisosDe(coches, gente) {
  const avisos = [];
  const di = (tipo, msg) => avisos.push({ tipo, msg });

  coches.forEach(coche => {
    if (!coche.operativo) return;
    coche.personas.forEach(p => {
      if (p.rol !== 'FIJO' || p.id) return;
      di('hueco', `${coche.matricula}: sin fijo de ${p.turno.toLowerCase()}`);
    });
    coche.semana.forEach((celda, i) => {
      if (!celda.conflicto) return;
      const turno = i % 2 === 0 ? 'día' : 'noche';
      di('conflicto', `${coche.matricula} ${LETRAS[Math.floor(i / 2)]} (${turno}): ` +
        `${celda.nombre} y ${(celda.otros || []).join(', ')} a la vez`);
    });
  });

  gente.forEach(p => {
    if (!p.plazas) return;
    if (!p.turnoId) di('sin_turno', `${p.nombre} está colocado y no tiene turno`);
    if (p.boltPendiente) di('bolt', `${p.nombre} no tiene cuenta de BOLT`);
    if (p.ausente) di('ausente', `${p.nombre} está ${p.estado.toLowerCase()} y ocupa plaza`);
    // Un correturnos con menos días de los que le tocan por contrato. El
    // estándar son dos por coche: 32 horas son cuatro días, 40 son seis.
    const soloCT = p.diasQueDebeCT != null && p.trabaja.some(Boolean);
    if (soloCT && p.plazas > 1 && p.diasAsignados < p.diasQueDebeCT) {
      di('faltan_dias', `${p.nombre} tiene ${p.diasAsignados} día(s) de los ` +
        `${p.diasQueDebeCT} que le tocan`);
    }
  });

  return avisos;
}

// ============================================================
// ESCRIBIR
// ============================================================

/** El día anterior, para cerrar lo que había el día antes de que entre el nuevo. */
function vispera(dia) {
  const d = new Date(dia + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return aISO(d);
}

/**
 * "L M X" → [1, 2, 3].
 *
 * Se sigue aceptando escrito porque es como lo teclea Tráfico, pero ya no se
 * guarda así: acaba en filas de `asignacion_dia`. Devuelve null si hay algo que
 * no se entiende, y entonces no se guarda nada — antes un "L y M" se convertía
 * en solo el lunes sin decir una palabra.
 */
function parsearDias(txt) {
  if (Array.isArray(txt)) return txt.map(Number).filter(d => d >= 1 && d <= 7);
  const limpio = String(txt == null ? '' : txt).trim();
  if (!limpio) return [];
  const MAPA = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 7 };
  const dias = new Set();
  for (const trozo of limpio.toUpperCase().split(/[\s,;.+\-/]+/)) {
    if (!trozo) continue;
    // "LMX" pegado también vale: se lee letra a letra.
    for (const letra of trozo) {
      if (!MAPA[letra]) return null;
      dias.add(MAPA[letra]);
    }
  }
  return [...dias].sort((a, b) => a - b);
}

/** La asignación viva de una plaza en una fecha. */
async function asignacionEn(cli, plazaId, dia) {
  const r = await cli.query(
    `SELECT id, conductor_id, desde, hasta FROM asignacion
      WHERE plaza_id = $1 AND desde <= $2 AND (hasta IS NULL OR hasta >= $2)
      ORDER BY desde DESC LIMIT 1`, [plazaId, dia]);
  return r.rows[0] || null;
}

/**
 * Deja libre una plaza a partir de un día.
 *
 * Cerrar y no borrar: quien estuvo ahí el mes pasado estuvo, y la cobertura de
 * esas semanas tiene que seguir cuadrando. Solo se borra la asignación que
 * todavía no había empezado, porque esa no llegó a pasar.
 */
async function liberar(cli, plazaId, dia, usuarioId) {
  const a = await asignacionEn(cli, plazaId, dia);
  if (!a) return null;
  const desde = fechaDe(a.desde);
  if (desde >= dia) {
    await cli.query('DELETE FROM asignacion WHERE id = $1', [a.id]);
    return { id: a.id, borrada: true };
  }
  await cli.query('UPDATE asignacion SET hasta = $2 WHERE id = $1', [a.id, vispera(dia)]);
  return { id: a.id, cerrada: vispera(dia) };
}

/**
 * Coloca a alguien en una plaza desde un día.
 *
 * Las dos reglas que pidió Tráfico, y que aquí son una línea cada una:
 *
 *   · Sin "desde", desde el día que se está planificando.
 *   · Sin "hasta", indefinido. La plaza es suya hasta que alguien diga otra cosa.
 *
 * Los días de un correturnos, si no se dicen, son los que libra el fijo de ese
 * mismo coche y turno. Es lo que significa un correturnos: cubrir justo los días
 * que el fijo no está.
 */
async function colocar(cli, { plazaId, conductorId, desde, hasta, dias }, { dia, usuarioId }) {
  const entra = desde || dia;
  const rol = (await cli.query('SELECT rol FROM v_plaza WHERE plaza_id = $1', [plazaId])).rows[0];
  if (!rol) throw new Error('Esa plaza ya no existe');

  // Auto-corte: si no hay "hasta" (o se pasa) y ya hay un ocupante FUTURO en la
  // plaza, se cierra la vispera de su llegada. Asi se puede colocar a alguien
  // "mientras llega el otro", y el otro lo desplaza solo el dia que entra. La
  // exclusion de la base rechazaria el solape; esto lo evita a proposito.
  let hastaFinal = hasta || null;
  const futuro = (await cli.query(
    'SELECT desde FROM asignacion WHERE plaza_id = $1 AND desde > $2 ORDER BY desde LIMIT 1',
    [plazaId, entra])).rows[0];
  if (futuro) {
    const tope = vispera(fechaDe(futuro.desde));
    if (!hastaFinal || hastaFinal > tope) hastaFinal = tope;
  }

  const actual = await asignacionEn(cli, plazaId, entra);
  // Ya está ahí: no se abre otra, se ajusta la que hay. Abrir una segunda por
  // cambiarle la fecha de fin partía su historia en dos sin motivo.
  if (actual && String(actual.conductor_id) === String(conductorId)) {
    await cli.query('UPDATE asignacion SET hasta = $2 WHERE id = $1', [actual.id, hastaFinal]);
    await guardarDias(cli, actual.id, plazaId, rol.rol, dias);
    return { id: actual.id, ajustada: true };
  }

  if (actual) await liberar(cli, plazaId, entra, usuarioId);

  const r = await cli.query(
    `INSERT INTO asignacion (plaza_id, conductor_id, desde, hasta, usuario_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [plazaId, conductorId, entra, hastaFinal, usuarioId || null]);
  await guardarDias(cli, r.rows[0].id, plazaId, rol.rol, dias);
  return { id: r.rows[0].id, nueva: true };
}

/** Los días que cubre un correturnos. Un fijo no tiene: cubre todos menos los que libra. */
async function guardarDias(cli, asignacionId, plazaId, rol, dias) {
  await cli.query('DELETE FROM asignacion_dia WHERE asignacion_id = $1', [asignacionId]);
  if (rol !== 'CT') return;

  let lista = dias;
  if (!lista || !lista.length) {
    const s = await cli.query(
      'SELECT dias_sugeridos FROM v_plaza_ct_sugerida WHERE plaza_id = $1', [plazaId]);
    lista = (s.rows[0] || {}).dias_sugeridos || [];
  }
  for (const d of lista) {
    await cli.query(
      'INSERT INTO asignacion_dia (asignacion_id, dia_semana) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [asignacionId, d]);
  }
}

// ── El descanso, por coche (el bloque del cuadrante) ────────────────────────
// El descanso vive en el COCHE (vehiculo_descanso, db/56). Sus fijos libran esos
// dias porque f_cobertura lee el descanso del coche de su plaza; no se copia
// nada a cada conductor. La libranza excepcional (por conductor) manda encima.

/** Pone (con fecha) el descanso de un coche desde un dia. Vacio = sin descanso. */
async function ponerDescansoCoche(cli, vehiculoId, dias, dia, usuarioId) {
  const act = (await cli.query(
    `SELECT id, desde FROM vehiculo_descanso
      WHERE vehiculo_id = $1 AND desde <= $2 AND (hasta IS NULL OR hasta >= $2)
      ORDER BY desde DESC LIMIT 1`, [vehiculoId, dia])).rows[0];
  if (act) {
    // Cerrar la vispera; borrar si aun no habia empezado (no llego a pasar).
    if (fechaDe(act.desde) >= dia) await cli.query('DELETE FROM vehiculo_descanso WHERE id = $1', [act.id]);
    else await cli.query('UPDATE vehiculo_descanso SET hasta = $2 WHERE id = $1', [act.id, vispera(dia)]);
  }
  if (!dias || !dias.length) return null;
  const r = await cli.query(
    'INSERT INTO vehiculo_descanso (vehiculo_id, desde, usuario_id) VALUES ($1, $2, $3) RETURNING id',
    [vehiculoId, dia, usuarioId || null]);
  for (const d of dias) {
    await cli.query('INSERT INTO vehiculo_descanso_dia (descanso_id, dia_semana) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [r.rows[0].id, d]);
  }
  return r.rows[0].id;
}

/** Fija el descanso (bloque) de un coche. Sus fijos libran esos dias solos. */
async function fijarDescanso(vehiculoId, dias, { dia, usuarioId } = {}) {
  if (!vehiculoId) throw new Error('Falta el coche');
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();
  const parsed = parsearDias(dias);
  if (parsed === null) throw new Error('No entiendo los días. Escríbelos como L M X J V S D.');
  // Si el coche esta en un cuadrante, no puede repetir el bloque de dias de otro.
  if (parsed.length) {
    const dup = await db.consulta(
      `SELECT v2.matricula, array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
         FROM vehiculo v1
         JOIN vehiculo v2 ON v2.cuadrante_id = v1.cuadrante_id AND v2.id <> v1.id
         JOIN vehiculo_descanso vd ON vd.vehiculo_id = v2.id AND vd.hasta IS NULL
         JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
        WHERE v1.id = $1 AND v1.cuadrante_id IS NOT NULL
        GROUP BY v2.id, v2.matricula
       HAVING array_agg(vdd.dia_semana) && $2::smallint[]`,
      [vehiculoId, parsed]);
    if (dup.rows.length) throw new Error(
      `Esos días chocan con ${dup.rows[0].matricula} (${(dup.rows[0].dias || []).map(d => LETRAS[d - 1]).join('/')}) en el cuadrante: no pueden compartir día`);
  }
  await db.transaccion(async cli => { await ponerDescansoCoche(cli, vehiculoId, parsed, efectivo, usuarioId); });
  return { dia: efectivo, dias: parsed };
}

/**
 * Guarda los cambios del tablero.
 *
 * Todo en UNA transacción: mover a alguien toca dos plazas, y a medias deja el
 * coche de origen con un hueco y el de destino con dos personas.
 *
 * `dia` es la fecha efectiva: lo que se guarde vale DESDE ese día, y lo que
 * hubiera antes se cierra la víspera. Así se puede poner a uno el 25 y a otro
 * el 28 en la misma plaza sin borrar lo del 25.
 */
async function guardar(cambios = [], { dia, usuarioId } = {}) {
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();
  const hechos = [];

  await db.transaccion(async cli => {
    for (const c of cambios) {
      const tocaCoche = c.zona !== undefined || c.estadoVeh !== undefined || c.matricula !== undefined;
      if (c.vehiculoId && tocaCoche) {
        const sets = [], vals = [];

        // LA ZONA VIAJA COMO TEXTO y la columna es una clave ajena.
        //
        // El front tiene un campo escrito con lista de sugerencias, así que
        // llega "Alcobendas", no un número. Meterlo tal cual en `base_zona_id`
        // reventaba la consulta. Se busca por nombre, y si esa zona no existe se
        // dice cuál es en vez de dejar un error de tipos.
        if (c.zona !== undefined) {
          let zonaId = null;
          const nombre = String(c.zona || '').trim();
          if (nombre) {
            const z = await cli.query(
              'SELECT id FROM base_zona WHERE nombre_norm = lower(btrim($1))', [nombre]);
            if (!z.rows.length) throw new Error(`No existe la zona "${nombre}"`);
            zonaId = z.rows[0].id;
          }
          vals.push(zonaId); sets.push(`base_zona_id = $${vals.length}`);
        }

        if (c.estadoVeh !== undefined) { vals.push(c.estadoVeh); sets.push(`estado_operativo = $${vals.length}`); }

        // Cambiar la matrícula RENOMBRA el coche, no mueve a nadie: la gente
        // cuelga de sus plazas y las plazas del vehículo. Para mover a la
        // tripulación está el botón de cambiar de coche.
        if (c.matricula !== undefined) {
          const mat = String(c.matricula || '').trim().toUpperCase();
          if (!mat) throw new Error('Un coche no se puede quedar sin matrícula');
          const otro = await cli.query(
            `SELECT matricula FROM vehiculo
              WHERE matricula_norm = upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g'))
                AND id <> $2 AND baja_at IS NULL`, [mat, c.vehiculoId]);
          if (otro.rows.length) throw new Error(`Ya hay otro coche con la matrícula ${mat}`);
          vals.push(mat); sets.push(`matricula = $${vals.length}`);
        }

        vals.push(c.vehiculoId);
        await cli.query(`UPDATE vehiculo SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
        hechos.push({ que: 'coche', vehiculoId: c.vehiculoId });
      }

      for (const s of (c.slots || [])) {
        if (!s.plazaId) throw new Error('Falta la plaza: recarga el tablero y vuelve a intentarlo');

        const dias = s.dias === undefined ? null : parsearDias(s.dias);
        if (dias === null && s.dias !== undefined && String(s.dias).trim()) {
          throw new Error(`No entiendo los días "${s.dias}". Escríbelos como L M X J V S D.`);
        }

        if (!s.id) {
          const r = await liberar(cli, s.plazaId, s.desde || efectivo, usuarioId);
          if (r) hechos.push({ que: 'libera', plazaId: s.plazaId, ...r });
          continue;
        }
        const r = await colocar(cli, {
          plazaId: s.plazaId, conductorId: Number(s.id),
          desde: s.desde || null, hasta: s.hasta || null, dias: dias || [],
        }, { dia: efectivo, usuarioId });
        hechos.push({ que: 'coloca', plazaId: s.plazaId, conductorId: s.id, ...r });
      }
    }
  });

  return { hechos, dia: efectivo };
}

/**
 * Un coche se cambia por otro: sus conductores se van con él.
 *
 * Pasa de verdad y pasa a menudo — el coche entra en el taller y la gente sigue
 * saliendo con otro. Hacerlo plaza por plaza son doce movimientos, y basta con
 * equivocarse en uno para dejar a alguien sin coche o a dos en el mismo.
 *
 * Se respeta la plaza: el fijo de día de X es el fijo de día de Y, y un
 * correturnos se lleva sus mismos días. Lo de X se cierra la víspera; lo de Y
 * empieza el día del cambio.
 */
async function cambiarCoche({ deVehiculoId, aVehiculoId, dia, soloTurno, forzar }, { usuarioId } = {}) {
  if (!deVehiculoId || !aVehiculoId) throw new Error('Faltan los dos coches');
  if (String(deVehiculoId) === String(aVehiculoId)) throw new Error('Es el mismo coche');
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();
  const movidos = [];

  // EL COCHE DE DESTINO TIENE QUE ESTAR LIBRE.
  //
  // Si lleva gente, moverla sin decir nada la deja sin plaza — y nadie se entera
  // hasta que esa persona se presenta a trabajar. Se para y se dice por su
  // nombre; `forzar` existe para cuando de verdad se quiera hacer.
  if (!forzar) {
    const ocupado = await db.consulta(
      `SELECT btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS quien
         FROM v_plaza p
         JOIN asignacion a ON a.plaza_id = p.plaza_id
                          AND a.desde <= $2 AND (a.hasta IS NULL OR a.hasta >= $2)
         JOIN conductor c ON c.id = a.conductor_id
        WHERE p.vehiculo_id = $1`, [aVehiculoId, efectivo]);
    if (ocupado.rows.length) {
      const e = new Error('El coche de destino ya lleva gente: ' +
        ocupado.rows.map(r => r.quien).join(', ') + '. Sácalos antes, o confirma que se les quita la plaza.');
      e.ocupantes = ocupado.rows.map(r => r.quien);
      throw e;
    }
  }

  await db.transaccion(async cli => {
    const origen = await cli.query(
      `SELECT p.plaza_id, p.slot, p.rol, p.turno_codigo, a.id AS asignacion_id, a.conductor_id,
              a.hasta,
              (SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana)
                 FROM asignacion_dia ad WHERE ad.asignacion_id = a.id) AS dias
         FROM v_plaza p
         JOIN asignacion a ON a.plaza_id = p.plaza_id
                          AND a.desde <= $2 AND (a.hasta IS NULL OR a.hasta >= $2)
        WHERE p.vehiculo_id = $1
        ORDER BY p.slot`, [deVehiculoId, efectivo]);

    if (!origen.rows.length) throw new Error('Ese coche no tiene a nadie colocado');

    const destino = new Map((await cli.query(
      'SELECT plaza_id, slot FROM v_plaza WHERE vehiculo_id = $1', [aVehiculoId]
    )).rows.map(r => [r.slot, r.plaza_id]));

    for (const o of origen.rows) {
      if (soloTurno && o.turno_codigo !== soloTurno) continue;
      const plazaDestino = destino.get(o.slot);
      if (!plazaDestino) {
        throw new Error(`El coche de destino no tiene la plaza ${o.slot}: no se puede mover a todos`);
      }
      // Primero se vacía el destino y se cierra el origen; después se coloca.
      // Al revés, la exclusión de la base rechazaría el solape — que es
      // exactamente lo que tiene que hacer.
      await liberar(cli, o.plaza_id, efectivo, usuarioId);
      await liberar(cli, plazaDestino, efectivo, usuarioId);
      const r = await colocar(cli, {
        plazaId: plazaDestino, conductorId: o.conductor_id,
        desde: efectivo, hasta: fechaDe(o.hasta) || null, dias: o.dias || [],
      }, { dia: efectivo, usuarioId });
      movidos.push({ conductorId: String(o.conductor_id), slot: o.slot, asignacionId: r.id });
    }
  });

  return { movidos, dia: efectivo };
}

// ============================================================
// LIBRANZA EXCEPCIONAL
// ============================================================
// El swap de una semana: un fijo trabaja un dia que libra por patron y libra uno
// que trabaja. No toca el patron; f_cobertura lo lee por encima (db/54). El
// desplazamiento del CT y el coche de emergencia es una colocacion normal que
// hace Trafico despues; aqui solo se apunta el swap.

async function crearLibranzaExcepcional({ conductorId, diaTrabaja, diaLibra, motivo }, { usuarioId } = {}) {
  if (!conductorId) throw new Error('Falta el conductor');
  const f = /^\d{4}-\d{2}-\d{2}$/;
  if (!f.test(diaTrabaja || '') || !f.test(diaLibra || '')) throw new Error('Faltan las fechas del cambio');
  if (diaTrabaja === diaLibra) throw new Error('El día que trabaja y el que libra no pueden ser el mismo');
  try {
    const r = await db.consulta(
      `INSERT INTO libranza_excepcional (conductor_id, dia_trabaja, dia_libra, motivo, autorizado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [Number(conductorId), diaTrabaja, diaLibra, (motivo || '').trim() || null, usuarioId || null]);
    return { id: String(r.rows[0].id) };
  } catch (e) {
    // El CHECK de "misma semana" (<= 6 dias) o los UNIQUE de dia dan un mensaje
    // feo de Postgres; se traduce a algo que Trafico entienda.
    if (/ck_lexc_semana/.test(e.message)) throw new Error('Los dos días deben ser de la misma semana');
    if (/uq_lexc/.test(e.message)) throw new Error('Ese conductor ya tiene un cambio en uno de esos días');
    throw e;
  }
}

async function borrarLibranzaExcepcional(id) {
  await db.consulta('DELETE FROM libranza_excepcional WHERE id = $1', [Number(id)]);
  return { borrada: true };
}

// ============================================================
// CUADRANTES
// ============================================================
// Un cuadrante agrupa coches (bloques de días) que comparten correturnos. El CT
// se asigna AL CUADRANTE y se reparte entre sus coches, cada uno con los días
// que libra su fijo (v_plaza_ct_sugerida). Un coche suelto (sin cuadrante) es
// solo sus dos días de libranza.

async function listarCuadrantes() {
  const r = await db.consulta(
    `SELECT cu.id, cu.base_zona_id, bz.nombre AS zona,
            (SELECT count(*)::int FROM vehiculo v WHERE v.cuadrante_id = cu.id AND v.baja_at IS NULL) AS coches
       FROM cuadrante cu LEFT JOIN base_zona bz ON bz.id = cu.base_zona_id
      WHERE cu.baja_at IS NULL
      ORDER BY cu.id`);
  // El numero es secuencial entre los cuadrantes VIVOS (por orden de creacion):
  // al borrar unos, los que quedan se renumeran 1..N, sin huecos.
  return r.rows.map((c, i) => ({
    id: String(c.id), numero: i + 1, nombre: 'Cuadrante ' + (i + 1),
    zona: c.zona || '', zonaId: c.base_zona_id || null, coches: c.coches,
  }));
}

async function crearCuadrante({ zonaId }, { usuarioId } = {}) {
  // El numero es global y automatico (el maximo de siempre + 1: no se reusan
  // los de cuadrantes borrados). El nombre se deriva del numero.
  const r = await db.consulta(
    `INSERT INTO cuadrante (numero, nombre, base_zona_id, usuario_id)
     SELECT n, 'Cuadrante ' || n, $1, $2
       FROM (SELECT COALESCE(max(numero), 0) + 1 AS n FROM cuadrante) x
     RETURNING id, numero`, [zonaId || null, usuarioId || null]);
  return { id: String(r.rows[0].id), numero: r.rows[0].numero };
}

/**
 * Anade un bloque a un cuadrante: mete la matricula y le pone su descanso. Un
 * bloque = una matricula con sus dias de libranza (L/M, X/J...). No puede haber
 * dos bloques con los mismos dias en el mismo cuadrante.
 */
async function anadirBloque({ cuadranteId, vehiculoId, dias }, { dia, usuarioId } = {}) {
  if (!cuadranteId || !vehiculoId) throw new Error('Falta el cuadrante o la matrícula');
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();
  const parsed = parsearDias(dias);
  if (parsed === null || !parsed.length) throw new Error('Elige los días del bloque');
  const dup = await db.consulta(
    `SELECT v.matricula, array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
       FROM vehiculo v
       JOIN vehiculo_descanso vd ON vd.vehiculo_id = v.id AND vd.hasta IS NULL
       JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
      WHERE v.cuadrante_id = $1 AND v.id <> $2
      GROUP BY v.id, v.matricula
     HAVING array_agg(vdd.dia_semana) && $3::smallint[]`,
    [cuadranteId, vehiculoId, parsed]);
  if (dup.rows.length) throw new Error(
    `Esos días chocan con ${dup.rows[0].matricula} (${(dup.rows[0].dias || []).map(d => LETRAS[d - 1]).join('/')}): dos bloques no pueden compartir día`);
  await db.transaccion(async cli => {
    await cli.query('UPDATE vehiculo SET cuadrante_id = $2 WHERE id = $1', [vehiculoId, cuadranteId]);
    await ponerDescansoCoche(cli, vehiculoId, parsed, efectivo, usuarioId);
  });
  return { dia: efectivo };
}

async function borrarCuadrante(id) {
  await db.transaccion(async cli => {
    // Los coches quedan sueltos; no se toca su gente ni su libranza.
    await cli.query('UPDATE vehiculo SET cuadrante_id = NULL WHERE cuadrante_id = $1', [id]);
    await cli.query('UPDATE cuadrante SET baja_at = now() WHERE id = $1', [id]);
  });
  return { borrado: true };
}

/** Mete un coche en un cuadrante (o lo saca, con cuadranteId nulo). */
async function meterCoche(vehiculoId, cuadranteId) {
  if (!vehiculoId) throw new Error('Falta el coche');
  await db.consulta('UPDATE vehiculo SET cuadrante_id = $2 WHERE id = $1', [vehiculoId, cuadranteId || null]);
  return { ok: true };
}

/**
 * Asigna un CT al cuadrante: lo coloca en la plaza CT de cada coche del
 * cuadrante, con los días que libra el fijo de ese coche. Así un CT abarca las
 * matrículas del cuadrante sin teclearlo coche por coche. conductorId vacío lo
 * quita de todos.
 */
async function asignarCTcuadrante({ cuadranteId, turno, conductorId, vehiculos }, { dia, usuarioId } = {}) {
  if (!cuadranteId) throw new Error('Falta el cuadrante');
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();
  const slot = turno === 'noche' ? 3 : 2;   // CT1 día = slot 2, CT1 noche = slot 3
  // Los bloques (coches) que cubre el CT. Si no se dice, todos los del cuadrante.
  const elegidos = Array.isArray(vehiculos) && vehiculos.length ? new Set(vehiculos.map(String)) : null;
  let n = 0;
  await db.transaccion(async cli => {
    const plazas = await cli.query(
      `SELECT p.id AS plaza_id, p.vehiculo_id
         FROM plaza p JOIN vehiculo v ON v.id = p.vehiculo_id AND v.baja_at IS NULL
        WHERE v.cuadrante_id = $1 AND p.slot = $2 AND p.baja_at IS NULL`, [cuadranteId, slot]);
    for (const pl of plazas.rows) {
      const cubre = !elegidos || elegidos.has(String(pl.vehiculo_id));
      if (conductorId && cubre) {
        // Sin días: guardarDias los saca de v_plaza_ct_sugerida (el descanso del coche).
        await colocar(cli, { plazaId: pl.plaza_id, conductorId: Number(conductorId), desde: efectivo, hasta: null, dias: [] },
          { dia: efectivo, usuarioId });
      } else {
        // No cubre ese bloque (o se quita el CT): se libera esa plaza.
        await liberar(cli, pl.plaza_id, efectivo, usuarioId);
      }
      n++;
    }
  });
  return { dia: efectivo, coches: n };
}

/**
 * Reemplaza la matrícula de un bloque por otra (de emergencia). La nueva HEREDA
 * el bloque entero: el cuadrante, los días de descanso y la tripulación. El
 * coche viejo (el que va a taller/siniestro) queda suelto y vacío.
 */
async function reemplazarMatricula(deVehiculoId, aVehiculoId, { dia, usuarioId } = {}) {
  if (!deVehiculoId || !aVehiculoId) throw new Error('Faltan los dos coches');
  if (String(deVehiculoId) === String(aVehiculoId)) throw new Error('Es el mismo coche');
  const efectivo = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy();

  // El destino tiene que estar libre (es una matrícula de emergencia).
  const ocupado = await db.consulta(
    `SELECT btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS quien
       FROM v_plaza p
       JOIN asignacion a ON a.plaza_id = p.plaza_id AND a.desde <= $2 AND (a.hasta IS NULL OR a.hasta >= $2)
       JOIN conductor c ON c.id = a.conductor_id
      WHERE p.vehiculo_id = $1`, [aVehiculoId, efectivo]);
  if (ocupado.rows.length) throw new Error('La matrícula de destino lleva gente. Usa una libre (de emergencia).');

  let movidos = 0;
  await db.transaccion(async cli => {
    // 1. La tripulación, plaza a plaza (misma posición). No falla si no hay gente.
    const origen = await cli.query(
      `SELECT p.plaza_id, p.slot, a.conductor_id, a.hasta,
              (SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana)
                 FROM asignacion_dia ad WHERE ad.asignacion_id = a.id) AS dias
         FROM v_plaza p
         JOIN asignacion a ON a.plaza_id = p.plaza_id AND a.desde <= $2 AND (a.hasta IS NULL OR a.hasta >= $2)
        WHERE p.vehiculo_id = $1 ORDER BY p.slot`, [deVehiculoId, efectivo]);
    const destino = new Map((await cli.query(
      'SELECT plaza_id, slot FROM v_plaza WHERE vehiculo_id = $1', [aVehiculoId])).rows.map(r => [r.slot, r.plaza_id]));
    for (const o of origen.rows) {
      const plazaDestino = destino.get(o.slot);
      if (!plazaDestino) continue;
      await liberar(cli, o.plaza_id, efectivo, usuarioId);
      await liberar(cli, plazaDestino, efectivo, usuarioId);
      await colocar(cli, { plazaId: plazaDestino, conductorId: o.conductor_id, desde: efectivo,
        hasta: fechaDe(o.hasta) || null, dias: o.dias || [] }, { dia: efectivo, usuarioId });
      movidos++;
    }
    // 2. El cuadrante y el descanso pasan al coche nuevo; el viejo queda suelto.
    const de = (await cli.query('SELECT cuadrante_id FROM vehiculo WHERE id = $1', [deVehiculoId])).rows[0];
    const desc = (await cli.query(
      `SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
         FROM vehiculo_descanso vd JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
        WHERE vd.vehiculo_id = $1 AND vd.desde <= $2 AND (vd.hasta IS NULL OR vd.hasta >= $2)`,
      [deVehiculoId, efectivo])).rows[0];
    await cli.query('UPDATE vehiculo SET cuadrante_id = $2 WHERE id = $1', [aVehiculoId, de ? de.cuadrante_id : null]);
    await cli.query('UPDATE vehiculo SET cuadrante_id = NULL WHERE id = $1', [deVehiculoId]);
    if (desc && desc.dias && desc.dias.length) {
      await ponerDescansoCoche(cli, aVehiculoId, desc.dias, efectivo, usuarioId);
      await ponerDescansoCoche(cli, deVehiculoId, [], efectivo, usuarioId);
    }
  });
  return { dia: efectivo, movidos };
}

module.exports = {
  tablero, guardar, cambiarCoche, reemplazarMatricula, fijarDescanso,
  crearLibranzaExcepcional, borrarLibranzaExcepcional,
  listarCuadrantes, crearCuadrante, anadirBloque, borrarCuadrante, meterCoche, asignarCTcuadrante,
  lunesDe, semanaDesde, fechaDe, parsearDias, vispera, DIAS, LETRAS,
};
