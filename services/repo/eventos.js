// ============================================================
// MODO EVENTOS — las plazas de refuerzo, con fecha de caducidad
// ============================================================
// La F1 en Madrid, una marcha, un concierto: días en los que hay que sacar más
// coches de los que el cuadrante tiene puestos. Las plazas para eso ya existen
// —los slots 4 y 5 son CT día 2 y CT noche 2, creados desde el primer día para
// los 100 coches— pero estaban ocultas, porque abrirlas a mano significa que
// alguien tiene que acordarse de cerrarlas, y nadie se acuerda.
//
// Aquí un evento tiene DESDE y HASTA obligatorios y se cierra SOLO. Pero no se
// cierra el día que dice el papel:
//
//   EL EVENTO ACABA CUANDO TERMINA EL ÚLTIMO TURNO PLANIFICADO EN REFUERZO.
//
// Los turnos no caben en un día natural: el de noche empieza a las 17:00 y
// muere a las 05:00 del siguiente. Si la última en salir es Laura, CT2 de
// noche el domingo, el planificador vuelve a la normalidad el LUNES a las
// 05:00 — aunque el evento dijera "viernes, sábado y domingo". Esa hora no se
// guarda: se calcula al leer, porque cambia cada vez que alguien toca el
// cuadrante y guardada mentiría.

const db = require('../db');

const TZ = 'Europe/Madrid';

/** Las dos plazas de refuerzo. Están en la base desde db/04; solo se enseñan. */
const SLOTS_REFUERZO = [4, 5];

/** Un evento no puede durar un mes: eso ya no es un evento, es otra plantilla. */
const MAX_DIAS = 21;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Días entre dos ISO, caminando el calendario (no restando bloques de 24 h). */
function diasEntre(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const fechaDe = v => {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
};

/**
 * CUÁNDO VUELVE EL PLANIFICADOR A LA NORMALIDAD.
 *
 * Se mira quién está planificado en las plazas de refuerzo DENTRO del evento y
 * se coge el final de su turno más tardío. El de día acaba a las 17:00 del
 * mismo día; el de noche, a las 05:00 del siguiente. Si no hay nadie en
 * refuerzo, el evento muere al acabar la jornada de su último día (05:00 del
 * día siguiente), que es cuando muere cualquier jornada.
 *
 * Los instantes los monta PostgreSQL con AT TIME ZONE: el servidor va en UTC y
 * `new Date('...T17:00:00')` daría las 19:00 de Madrid en verano.
 */
async function cierreDe(evento) {
  const r = await db.consulta(
    `WITH cob AS (
       SELECT c.dia, c.turno_id, c.conductor_id, c.vehiculo_id
         FROM f_cobertura($1::date, $2::date) c
         JOIN plaza p ON p.id = c.plaza_id
        WHERE p.slot = ANY($3::smallint[])
     ),
     fin AS (
       SELECT cob.*,
              -- El turno de día muere a las 17:00 del mismo día; el de noche, a
              -- las 05:00 del siguiente. Las 17 y las 5 son las de flotaViva/rutas.
              CASE WHEN t.codigo = 'noche'
                   THEN ((cob.dia + 1) + interval '5 hours')  AT TIME ZONE 'Europe/Madrid'
                   ELSE ( cob.dia      + interval '17 hours') AT TIME ZONE 'Europe/Madrid'
              END AS termina
         FROM cob JOIN turno t ON t.id = cob.turno_id
     )
     SELECT (SELECT max(termina) FROM fin)                               AS ultimo,
            (SELECT count(*)::int FROM fin)                              AS plazas,
            (SELECT count(DISTINCT conductor_id)::int FROM fin)          AS gente,
            (($2::date + 1) + interval '5 hours') AT TIME ZONE 'Europe/Madrid' AS por_defecto,
            (SELECT json_agg(json_build_object(
                      'dia', to_char(f.dia, 'YYYY-MM-DD'),
                      'turno', t.codigo,
                      'conductor', COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                                            btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))),
                      'matricula', v.matricula,
                      'termina', f.termina)
                    ORDER BY f.termina DESC, f.dia)
               FROM fin f
               JOIN turno t     ON t.id = f.turno_id
               JOIN conductor c ON c.id = f.conductor_id
               JOIN vehiculo v  ON v.id = f.vehiculo_id)                 AS detalle`,
    [evento.desde, evento.hasta, SLOTS_REFUERZO]);

  const x = r.rows[0];
  const cierra = x.ultimo || x.por_defecto;
  return {
    cierraAt: cierra,
    // Si el último turno de refuerzo acaba DESPUÉS del papel, el evento se
    // alarga solo. Es el caso de Laura: el evento decía "hasta el domingo" y la
    // normalidad no vuelve hasta el lunes a las 05:00.
    alargado: !!(x.ultimo && x.ultimo > x.por_defecto),
    plazasRefuerzo: x.plazas,
    genteRefuerzo: x.gente,
    ultimos: (x.detalle || []).slice(0, 6),
  };
}

/** ¿Sigue vivo? Vivo = ya empezó (05:00 de su primer día) y aún no ha cerrado. */
function estadoDe(ev, cierre, ahora) {
  if (ev.canceladoAt) return 'cancelado';
  if (ahora >= new Date(cierre.cierraAt).getTime()) return 'terminado';
  if (ev.desde > hoyMadrid()) return 'programado';
  return 'vivo';
}

/**
 * LOS EVENTOS QUE IMPORTAN: el que está vivo (o el próximo) y los de la semana.
 * `vigente` es lo único que mira el planificador para enseñar las columnas.
 */
async function estado({ dia } = {}) {
  const d = ISO.test(dia || '') ? dia : hoyMadrid();
  const r = await db.consulta(
    `SELECT e.id, e.nombre, e.desde, e.hasta, e.nota, e.creado_at,
            e.cancelado_at, e.cancelado_nota,
            COALESCE(u.nombre, '')  AS creado_por,
            COALESCE(uc.nombre, '') AS cancelado_por
       FROM evento_operativo e
       LEFT JOIN usuario u  ON u.id = e.usuario_id
       LEFT JOIN usuario uc ON uc.id = e.cancelado_por
      WHERE e.hasta >= ($1::date - 7) AND e.desde <= ($1::date + 60)
      ORDER BY e.desde DESC, e.id DESC`, [d]);

  const ahora = Date.now();
  const eventos = [];
  for (const x of r.rows) {
    const ev = {
      id: String(x.id), nombre: x.nombre,
      desde: fechaDe(x.desde), hasta: fechaDe(x.hasta),
      nota: x.nota || '', creadoPor: x.creado_por, creadoAt: x.creado_at,
      canceladoAt: x.cancelado_at, canceladoPor: x.cancelado_por, canceladoNota: x.cancelado_nota || '',
    };
    const cierre = x.cancelado_at
      ? { cierraAt: x.cancelado_at, alargado: false, plazasRefuerzo: 0, genteRefuerzo: 0, ultimos: [] }
      : await cierreDe(ev);
    eventos.push({ ...ev, ...cierre, estado: estadoDe(ev, cierre, ahora) });
  }

  // VIGENTE = el que abre las columnas. Es el vivo; y si se está mirando un día
  // futuro dentro de un evento programado, ese, para poder planificarlo antes.
  const vigente = eventos.find(e => e.estado === 'vivo')
    || eventos.find(e => e.estado === 'programado' && e.desde <= d && d <= e.hasta)
    || null;

  return { dia: d, eventos, vigente, slotsRefuerzo: SLOTS_REFUERZO, maxDias: MAX_DIAS };
}

/** El evento que manda el día `d`, o null. Lo usa el planificador al guardar. */
async function vigenteEn(d) {
  const e = await estado({ dia: d });
  return e.vigente;
}

async function crear({ nombre, desde, hasta, nota }, { usuarioId } = {}) {
  nombre = String(nombre || '').trim().slice(0, 80);
  if (!nombre) throw new Error('El evento necesita un nombre ("F1 Madrid", "Marcha del Orgullo"…)');
  if (!ISO.test(desde || '')) throw new Error('Falta el DESDE: sin él el refuerzo no se cierra solo');
  if (!ISO.test(hasta || '')) throw new Error('Falta el HASTA: sin él el refuerzo no se cierra solo');
  if (hasta < desde) throw new Error('El "hasta" es anterior al "desde"');
  const dias = diasEntre(desde, hasta) + 1;
  if (dias > MAX_DIAS) {
    throw new Error(`Son ${dias} días. Un evento dura unos días (máximo ${MAX_DIAS}); ` +
      'para algo más largo hay que cambiar el cuadrante, no abrir refuerzo.');
  }

  // Dos eventos solapados no rompen nada —las columnas son las mismas— pero casi
  // siempre es que se ha creado dos veces el mismo. Se avisa con nombre y fechas.
  const solapa = await db.consulta(
    `SELECT nombre, desde, hasta FROM evento_operativo
      WHERE cancelado_at IS NULL AND desde <= $2::date AND hasta >= $1::date
      ORDER BY desde LIMIT 1`, [desde, hasta]);
  if (solapa.rows.length) {
    const s = solapa.rows[0];
    throw new Error(`Ya hay un evento en esas fechas: "${s.nombre}" (${fechaDe(s.desde)} → ${fechaDe(s.hasta)}). ` +
      'Amplíalo o cancélalo antes de abrir otro.');
  }

  const r = await db.consulta(
    `INSERT INTO evento_operativo (nombre, desde, hasta, nota, usuario_id)
     VALUES ($1, $2::date, $3::date, $4, $5) RETURNING id`,
    [nombre, desde, hasta, String(nota || '').trim().slice(0, 300) || null, usuarioId || null]);
  console.log(`🎪 [EVENTOS] "${nombre}" ${desde} → ${hasta} (${dias} día(s))`);
  return { ok: true, id: String(r.rows[0].id) };
}

/** Cambiar las fechas o el nombre. Acortar no borra lo ya planificado. */
async function editar(id, { nombre, desde, hasta, nota }) {
  const act = (await db.consulta('SELECT * FROM evento_operativo WHERE id = $1', [Number(id)])).rows[0];
  if (!act) throw new Error('Ese evento no existe');
  if (act.cancelado_at) throw new Error('Ese evento está cancelado');
  const d = ISO.test(desde || '') ? desde : fechaDe(act.desde);
  const h = ISO.test(hasta || '') ? hasta : fechaDe(act.hasta);
  if (h < d) throw new Error('El "hasta" es anterior al "desde"');
  if (diasEntre(d, h) + 1 > MAX_DIAS) throw new Error(`Máximo ${MAX_DIAS} días`);
  await db.consulta(
    `UPDATE evento_operativo SET nombre = $2, desde = $3::date, hasta = $4::date, nota = $5
      WHERE id = $1`,
    [Number(id), String(nombre || act.nombre).trim().slice(0, 80) || act.nombre, d, h,
     nota === undefined ? act.nota : (String(nota || '').trim().slice(0, 300) || null)]);
  return { ok: true, id: String(id) };
}

/**
 * CANCELAR un evento: se acabó antes de tiempo.
 *
 * No borra a nadie del refuerzo —lo planificado, planificado está, y si alguien
 * ya salió esas horas son suyas— pero cierra las asignaciones de refuerzo que
 * aún no han empezado y corta las vivas en la víspera. Si no, quedarían plazas
 * abiertas sin evento que las sostenga, que es justo lo que se quería evitar.
 */
async function cancelar(id, { usuarioId, nota } = {}) {
  nota = String(nota || '').trim();
  if (!nota) throw new Error('Di por qué se cancela: alguien tendrá que entender mañana por qué no salieron esos coches');
  return db.transaccion(async cli => {
    const ev = (await cli.query(
      'SELECT desde, hasta, nombre FROM evento_operativo WHERE id = $1 AND cancelado_at IS NULL',
      [Number(id)])).rows[0];
    if (!ev) throw new Error('Ese evento no existe o ya estaba cancelado');

    const hoy = hoyMadrid();
    const corte = hoy > fechaDe(ev.desde) ? hoy : fechaDe(ev.desde);
    // Las que aún no habían empezado no llegaron a pasar: fuera.
    const borradas = await cli.query(
      `DELETE FROM asignacion a
        USING plaza p
        WHERE p.id = a.plaza_id AND p.slot = ANY($1::smallint[])
          AND a.desde >= $2::date AND a.desde <= $3::date
        RETURNING a.id`, [SLOTS_REFUERZO, corte, fechaDe(ev.hasta)]);
    // Las vivas se cierran la víspera del corte: lo hecho queda.
    const cerradas = await cli.query(
      `UPDATE asignacion a SET hasta = ($2::date - 1)
        FROM plaza p
       WHERE p.id = a.plaza_id AND p.slot = ANY($1::smallint[])
         AND a.desde < $2::date AND (a.hasta IS NULL OR a.hasta >= $2::date)
       RETURNING a.id`, [SLOTS_REFUERZO, corte]);

    await cli.query(
      `UPDATE evento_operativo SET cancelado_at = now(), cancelado_por = $2, cancelado_nota = $3
        WHERE id = $1`, [Number(id), usuarioId || null, nota.slice(0, 300)]);
    console.log(`🎪 [EVENTOS] cancelado "${ev.nombre}": ${borradas.rowCount} plaza(s) sin empezar borradas, ` +
      `${cerradas.rowCount} cerrada(s)`);
    return { ok: true, id: String(id), borradas: borradas.rowCount, cerradas: cerradas.rowCount };
  });
}

module.exports = { estado, vigenteEn, crear, editar, cancelar, cierreDe, SLOTS_REFUERZO, MAX_DIAS };
