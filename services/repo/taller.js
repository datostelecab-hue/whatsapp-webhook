// ============================================================
// TALLER — mantenimiento por kilómetros
// ============================================================
// La pregunta del módulo es una sola: ¿a qué coche le toca revisión?
//
//     km desde la última revisión = odómetro de hoy − km de la última revisión
//
// Las dos cifras vienen de sitios distintos y ninguna es obvia:
//
//   · El ODÓMETRO sale de `v_vehiculo_odometro`, que es donde vive la regla
//     (CAN del coche, o ancla manual + lo recorrido desde ella). Aquí NO se
//     recalcula: se lee. Si esa vista dice NULL, el coche no tiene odómetro y
//     este módulo no se inventa uno.
//   · El KM DE LA ÚLTIMA REVISIÓN sale de `mantenimiento`. Se ordena por km
//     descendente, no por fecha: el fichero del taller trae los km pero no
//     siempre la fecha, y entre dos revisiones la de más km es la más reciente.
//
// El RITMO (km/día) sale de `vehiculo_km_dia`, la foto diaria del odómetro. Es
// lo que permite decir "le quedan 12 días" en vez de solo "le quedan 6.000 km",
// que es lo que sirve para organizar el taller. Un coche recién dado de alta no
// tiene ritmo todavía: se dice que no se sabe, no se pone un cero.

const db = require('../db');

/** Cada cuántos km toca revisión, si el coche no dice otra cosa. */
const INTERVALO = Number(process.env.TALLER_KM_REVISION) || 15000;

/** A partir de qué % del intervalo se avisa, y con cuántos días de margen. */
const AVISO_PCT = 0.85;
const AVISO_DIAS = 15;

/**
 * Por encima de esto, "km desde la última revisión" no es una revisión
 * pendiente: es un dato mal metido. 5369LJH llegó con 207.831.
 */
const IMPOSIBLE = 120000;

const TIPOS = [
  { codigo: 'revision',   etiqueta: 'Revisión',        icono: 'fa-screwdriver-wrench', cuenta: true },
  { codigo: 'aceite',     etiqueta: 'Cambio de aceite', icono: 'fa-oil-can',           cuenta: false },
  { codigo: 'neumaticos', etiqueta: 'Neumáticos',      icono: 'fa-circle-dot',         cuenta: false },
  { codigo: 'itv',        etiqueta: 'ITV',             icono: 'fa-clipboard-check',    cuenta: false },
  { codigo: 'chapa',      etiqueta: 'Chapa y pintura', icono: 'fa-spray-can',          cuenta: false },
  { codigo: 'averia',     etiqueta: 'Avería',          icono: 'fa-triangle-exclamation', cuenta: false },
  { codigo: 'otro',       etiqueta: 'Otro',            icono: 'fa-wrench',             cuenta: false },
];
const CODIGOS = TIPOS.map(t => t.codigo);
/** Los que cuentan como "última revisión" para el control por km. */
const CUENTAN = TIPOS.filter(t => t.cuenta).map(t => t.codigo);

const ESTADOS = [
  { codigo: 'toca',      etiqueta: 'Toca revisión' },
  { codigo: 'pronto',    etiqueta: 'A punto' },
  { codigo: 'ok',        etiqueta: 'Al día' },
  { codigo: 'sin_dato',  etiqueta: 'Sin dato' },
  { codigo: 'revisar',   etiqueta: 'Dato imposible' },
];

const ent = v => (v == null || v === '' ? null : Math.round(Number(v)));
const txt = v => (v == null ? null : String(v).trim() || null);

/** Euros escritos como sea ("1.234,50", "1234.5") → céntimos. */
function aCentimos(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('El coste no es un número válido');
  return Math.round(n * 100);
}

// ============================================================
// LECTURA
// ============================================================

/**
 * El cuadro del módulo: un coche por fila, con lo que hace falta para decidir
 * si entra a taller. Se calcula ENTERO en SQL menos el semáforo, que se decide
 * aquí para que la regla se lea de un vistazo.
 */
async function cuadro({ busca, estado } = {}) {
  // Solo lo que USA el SQL: Postgres rechaza la consulta si sobran parámetros.
  // El umbral de aviso y el de "imposible" se aplican después, en pintar().
  const params = [INTERVALO, CUENTAN];
  let filtroBusca = '';
  if (busca && String(busca).trim()) {
    params.push('%' + String(busca).trim().toUpperCase().replace(/[^0-9A-Z]/g, '') + '%');
    params.push('%' + String(busca).trim() + '%');
    filtroBusca = `AND (v.matricula_norm LIKE $${params.length - 1} OR v.marca_modelo ILIKE $${params.length})`;
  }

  const r = await db.consulta(`
    WITH ult AS (
      -- La última revisión de cada coche. Por km, no por fecha: el histórico
      -- del taller trae km sin fecha, y entre dos revisiones manda el km.
      SELECT DISTINCT ON (m.vehiculo_id)
             m.vehiculo_id, m.id, m.km, m.fecha, m.taller
        FROM mantenimiento m
       WHERE m.anulado_at IS NULL AND m.tipo = ANY($2)
       ORDER BY m.vehiculo_id, m.km DESC NULLS LAST, m.fecha DESC NULLS LAST, m.id DESC
    ),
    ritmo AS (
      -- Km al día de los últimos 30. Hacen falta al menos dos fotos separadas
      -- por un día: con una sola no hay pendiente que medir.
      SELECT vehiculo_id,
             (max(km) - min(km))::numeric / NULLIF(max(dia) - min(dia), 0) AS km_dia,
             (max(dia) - min(dia))                                          AS dias
        FROM vehiculo_km_dia
       WHERE dia >= CURRENT_DATE - 30
       GROUP BY vehiculo_id
      HAVING count(*) > 1 AND max(dia) > min(dia)
    )
    SELECT v.id, v.matricula, v.marca_modelo, v.anio,
           v.estado_operativo, e.etiqueta AS estado_etiqueta, e.es_operativo,
           b.nombre AS zona,
           o.km AS odometro, o.fuente AS odometro_fuente,
           to_char(o.visto_at, 'YYYY-MM-DD HH24:MI') AS odometro_at,
           COALESCE(v.km_revision_cada, $1) AS intervalo,
           v.km_revision_cada IS NOT NULL   AS intervalo_propio,
           u.id AS revision_id, u.km AS revision_km,
           to_char(u.fecha, 'YYYY-MM-DD') AS revision_fecha, u.taller AS revision_taller,
           (o.km - u.km) AS desde,
           round(r.km_dia, 1)::float8 AS km_dia, r.dias AS dias_ritmo,
           (SELECT count(*) FROM mantenimiento m2
             WHERE m2.vehiculo_id = v.id AND m2.anulado_at IS NULL) AS movimientos
      FROM vehiculo v
      LEFT JOIN cat_estado_vehiculo e ON e.codigo = v.estado_operativo
      LEFT JOIN base_zona b           ON b.id = v.base_zona_id
      LEFT JOIN v_vehiculo_odometro o ON o.vehiculo_id = v.id
      LEFT JOIN ult u                 ON u.vehiculo_id = v.id
      LEFT JOIN ritmo r               ON r.vehiculo_id = v.id
     WHERE v.baja_at IS NULL ${filtroBusca}
     ORDER BY v.matricula`, params);

  const filas = r.rows.map(pintar);
  return estado ? filas.filter(f => f.estado === estado) : filas;
}

/**
 * El semáforo de una fila. Cinco estados y en este orden, que importa: primero
 * se descarta lo que no se puede afirmar, y solo después se juzga.
 */
function pintar(f) {
  const odometro = f.odometro == null ? null : Number(f.odometro);
  const revision = f.revision_km == null ? null : Number(f.revision_km);
  const intervalo = Number(f.intervalo);
  const desde = f.desde == null ? null : Number(f.desde);
  const kmDia = f.km_dia == null ? null : Number(f.km_dia);

  let estado, restan = null, dias = null;
  if (desde == null) {
    estado = 'sin_dato';
  } else if (desde < 0 || desde > IMPOSIBLE) {
    estado = 'revisar';
  } else {
    restan = intervalo - desde;
    // Con ritmo se sabe CUÁNDO; sin ritmo solo cuánto le falta.
    dias = kmDia && kmDia > 0 && restan > 0 ? Math.round(restan / kmDia) : null;
    if (desde >= intervalo) estado = 'toca';
    else if (desde >= intervalo * AVISO_PCT || (dias != null && dias <= AVISO_DIAS)) estado = 'pronto';
    else estado = 'ok';
  }

  return {
    // vehiculo.id es BIGINT y el driver lo entrega como CADENA. Si no se
    // normaliza aquí, ficha() compara "12" con 12 y no encuentra el coche.
    id: Number(f.id),
    matricula: f.matricula,
    vehiculo: f.marca_modelo || '',
    anio: f.anio,
    estadoOperativo: f.estado_etiqueta || f.estado_operativo,
    esOperativo: f.es_operativo,
    zona: f.zona,
    odometro,
    odometroFuente: f.odometro_fuente,      // can | ancla | ancla_fija | null
    odometroAt: f.odometro_at,
    intervalo,
    intervaloPropio: f.intervalo_propio,
    revisionKm: revision,
    revisionFecha: f.revision_fecha,
    revisionTaller: f.revision_taller,
    desde, restan, kmDia, dias,
    diasRitmo: f.dias_ritmo == null ? null : Number(f.dias_ritmo),
    movimientos: Number(f.movimientos) || 0,
    // Porcentaje del intervalo consumido, tope 150 para que la barra no se
    // desborde en un coche muy pasado de vueltas.
    porcentaje: desde == null || desde < 0 ? null : Math.min(150, Math.round(desde / intervalo * 100)),
    estado,
  };
}

/** Las cifras de la cabecera. Se cuentan sobre TODO, no sobre lo filtrado. */
async function resumen() {
  const filas = await cuadro();
  const cuenta = c => filas.filter(f => f.estado === c).length;
  return {
    total: filas.length,
    toca: cuenta('toca'),
    pronto: cuenta('pronto'),
    ok: cuenta('ok'),
    sinDato: cuenta('sin_dato'),
    revisar: cuenta('revisar'),
    sinOdometro: filas.filter(f => f.odometro == null).length,
    sinRevision: filas.filter(f => f.revisionKm == null).length,
  };
}

/** La ficha de un coche: su fila del cuadro más todo su historial. */
async function ficha(vehiculoId) {
  const id = ent(vehiculoId);
  if (!id) throw new Error('Falta el vehículo');
  const [fila] = (await cuadro()).filter(f => f.id === id);
  if (!fila) throw new Error('Ese vehículo no existe o está de baja');

  const h = await db.consulta(`
    SELECT m.id, m.tipo, to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.km, m.taller,
           m.coste_cent, m.descripcion,
           to_char(m.creado_at, 'YYYY-MM-DD HH24:MI') AS creado_at,
           to_char(m.anulado_at, 'YYYY-MM-DD HH24:MI') AS anulado_at,
           m.anulado_motivo,
           u.nombre AS usuario, ua.nombre AS anulado_usuario
      FROM mantenimiento m
      LEFT JOIN usuario u  ON u.id = m.usuario_id
      LEFT JOIN usuario ua ON ua.id = m.anulado_por
     WHERE m.vehiculo_id = $1
     ORDER BY m.km DESC NULLS LAST, m.fecha DESC NULLS LAST, m.id DESC`, [id]);

  const anclas = await db.consulta(`
    SELECT a.id, a.km, to_char(a.leido_at, 'YYYY-MM-DD HH24:MI') AS leido_at,
           a.nota, u.nombre AS usuario
      FROM odometro_ancla a
      LEFT JOIN usuario u ON u.id = a.usuario_id
     WHERE a.vehiculo_id = $1
     ORDER BY a.leido_at DESC`, [id]);

  return {
    ...fila,
    historial: h.rows.map(m => ({
      id: m.id, tipo: m.tipo,
      tipoEtiqueta: (TIPOS.find(t => t.codigo === m.tipo) || {}).etiqueta || m.tipo,
      fecha: m.fecha, km: m.km == null ? null : Number(m.km), taller: m.taller,
      coste: m.coste_cent == null ? null : Number(m.coste_cent) / 100,
      descripcion: m.descripcion, creadoAt: m.creado_at, usuario: m.usuario,
      anuladoAt: m.anulado_at, anuladoPor: m.anulado_usuario, anuladoMotivo: m.anulado_motivo,
    })),
    anclas: anclas.rows.map(a => ({
      id: a.id, km: Number(a.km), leidoAt: a.leido_at, nota: a.nota, usuario: a.usuario,
    })),
  };
}

// ============================================================
// ESCRITURA
// ============================================================

/**
 * Apunta un paso por taller.
 *
 * El km se compara con el odómetro que tenemos: si lo supera con holgura, o es
 * ridículamente bajo, se rechaza. No por desconfianza, sino porque un cero de
 * más en este campo manda un coche al taller que no le toca, o —peor— deja de
 * mandar uno al que sí.
 */
async function registrar(datos = {}, { usuarioId } = {}) {
  const vehiculoId = ent(datos.vehiculoId);
  if (!vehiculoId) throw new Error('Falta el vehículo');

  const tipo = txt(datos.tipo) || 'revision';
  if (!CODIGOS.includes(tipo)) throw new Error(`Tipo de mantenimiento desconocido: ${tipo}`);

  const km = ent(datos.km);
  const fecha = txt(datos.fecha);
  if (km == null && !fecha) throw new Error('Hace falta al menos el km o la fecha');
  if (km != null && (km < 0 || km > 2000000)) throw new Error('Ese kilometraje no puede ser');
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha va en formato aaaa-mm-dd');

  const [v] = (await db.consulta(
    `SELECT v.matricula, o.km AS odometro
       FROM vehiculo v LEFT JOIN v_vehiculo_odometro o ON o.vehiculo_id = v.id
      WHERE v.id = $1 AND v.baja_at IS NULL`, [vehiculoId])).rows;
  if (!v) throw new Error('Ese vehículo no existe o está de baja');

  // Un mantenimiento no puede apuntarse por encima del odómetro de hoy (salvo
  // el margen de que la lectura del GPS vaya con horas de retraso).
  if (km != null && v.odometro != null && km > Number(v.odometro) + 2000) {
    throw new Error(
      `${v.matricula} marca ${Number(v.odometro).toLocaleString('es-ES')} km y estás apuntando ` +
      `${km.toLocaleString('es-ES')}. Revisa el dato.`);
  }

  const r = await db.consulta(`
    INSERT INTO mantenimiento (vehiculo_id, tipo, fecha, km, taller, coste_cent, descripcion, usuario_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [vehiculoId, tipo, fecha || null, km, txt(datos.taller), aCentimos(datos.coste),
      txt(datos.descripcion), ent(usuarioId)]);
  return { id: r.rows[0].id };
}

/** Anular no borra: deja la fila con quién y por qué. */
async function anular(id, motivo, { usuarioId } = {}) {
  const n = ent(id);
  if (!n) throw new Error('Falta el movimiento');
  const razon = txt(motivo);
  if (!razon) throw new Error('Hay que decir por qué se anula');
  const r = await db.consulta(`
    UPDATE mantenimiento
       SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
     WHERE id = $1 AND anulado_at IS NULL
    RETURNING id`, [n, ent(usuarioId), razon]);
  if (!r.rowCount) throw new Error('Ese movimiento no existe o ya estaba anulado');
  return { id: n };
}

/**
 * Anclar el odómetro: alguien ha leído el cuadro de un coche sin CAN.
 *
 * Se guarda junto al contador del GPS de ese momento, y eso es lo que hace que
 * la lectura no caduque: a partir de ahí el sistema le va sumando lo recorrido.
 * Si el coche no tiene contador de GPS, el ancla vale igual pero se queda
 * quieta, y la vista lo dice con fuente 'ancla_fija'.
 */
async function anclar(datos = {}, { usuarioId } = {}) {
  const vehiculoId = ent(datos.vehiculoId);
  const km = ent(datos.km);
  if (!vehiculoId) throw new Error('Falta el vehículo');
  if (km == null || km < 0 || km > 2000000) throw new Error('Ese kilometraje no puede ser');

  const [v] = (await db.consulta(
    `SELECT matricula, km_gps_m, km_odometro_m FROM vehiculo WHERE id = $1 AND baja_at IS NULL`,
    [vehiculoId])).rows;
  if (!v) throw new Error('Ese vehículo no existe o está de baja');
  if (v.km_odometro_m != null) {
    throw new Error(`${v.matricula} ya da su odómetro por el CAN: no hace falta anclarlo a mano`);
  }

  const r = await db.consulta(`
    INSERT INTO odometro_ancla (vehiculo_id, km, gps_m, usuario_id, nota)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vehiculoId, km, v.km_gps_m, ent(usuarioId), txt(datos.nota)]);
  return { id: r.rows[0].id, seguira: v.km_gps_m != null };
}

/** Cambiar cada cuánto toca revisión a UN coche. Vacío = vuelve al general. */
async function intervalo(datos = {}) {
  const vehiculoId = ent(datos.vehiculoId);
  if (!vehiculoId) throw new Error('Falta el vehículo');
  const km = datos.km === '' || datos.km == null ? null : ent(datos.km);
  if (km != null && (km < 1000 || km > 200000)) throw new Error('El intervalo va entre 1.000 y 200.000 km');
  const r = await db.consulta(
    `UPDATE vehiculo SET km_revision_cada = $2 WHERE id = $1 AND baja_at IS NULL RETURNING id`,
    [vehiculoId, km]);
  if (!r.rowCount) throw new Error('Ese vehículo no existe o está de baja');
  return { id: vehiculoId, intervalo: km || INTERVALO };
}

/**
 * TODO lo del módulo de una vez: el cuadro, las cifras y el historial entero.
 * Es lo que se lleva el informe en PDF, y se saca de aquí y no de la vista para
 * que el papel y la pantalla no puedan contar cosas distintas.
 */
async function todo() {
  const filas = await cuadro();
  const cuenta = c => filas.filter(f => f.estado === c).length;
  const h = await db.consulta(`
    SELECT v.matricula, m.tipo, to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.km,
           m.taller, m.coste_cent, m.descripcion,
           to_char(m.creado_at, 'YYYY-MM-DD') AS creado_at, u.nombre AS usuario
      FROM mantenimiento m
      JOIN vehiculo v ON v.id = m.vehiculo_id
      LEFT JOIN usuario u ON u.id = m.usuario_id
     WHERE m.anulado_at IS NULL AND v.baja_at IS NULL
     ORDER BY v.matricula, m.km DESC NULLS LAST, m.id DESC`);

  return {
    filas,
    intervalo: INTERVALO,
    resumen: {
      total: filas.length,
      toca: cuenta('toca'), pronto: cuenta('pronto'), ok: cuenta('ok'),
      sinDato: cuenta('sin_dato'), revisar: cuenta('revisar'),
      sinOdometro: filas.filter(f => f.odometro == null).length,
      sinRevision: filas.filter(f => f.revisionKm == null).length,
    },
    historial: h.rows.map(m => ({
      matricula: m.matricula, tipo: m.tipo,
      tipoEtiqueta: (TIPOS.find(t => t.codigo === m.tipo) || {}).etiqueta || m.tipo,
      fecha: m.fecha, km: m.km == null ? null : Number(m.km),
      taller: m.taller, coste: m.coste_cent == null ? null : Number(m.coste_cent) / 100,
      descripcion: m.descripcion, creadoAt: m.creado_at, usuario: m.usuario,
    })),
  };
}

module.exports = {
  INTERVALO, TIPOS, ESTADOS, CODIGOS, CUENTAN, IMPOSIBLE,
  cuadro, resumen, ficha, todo, registrar, anular, anclar, intervalo,
};
