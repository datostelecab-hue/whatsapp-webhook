// ============================================================
// BI — inteligencia de negocio sobre la capa semántica bi_* (db/61, db/62)
// ============================================================
// Este módulo NO calcula nada por su cuenta: lee las vistas bi_* y las agrega
// por el rango de fechas y los filtros que pide la pantalla. Toda la lógica de
// negocio (qué es efectivo, a qué día va un tramo, cómo se reparte el neto por
// coche) vive en SQL, en la misma vista que leería Power BI. Así la app y
// Power BI no pueden contradecirse: son el mismo número.
//
// Los hechos gordos son vistas MATERIALIZADAS y se refrescan con refrescar()
// (cron cada hora en app.js + botón en la pantalla). meta() dice de cuándo son.

const db = require('./db');

const TZ = 'Europe/Madrid';
const hoyISO = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const sumaDias = (iso, n) => {
  const [Y, M, D] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + n, 12));
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000) + 1;
const esISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const n1 = x => (x == null ? null : Math.round(Number(x) * 10) / 10);
const n2 = x => (x == null ? null : Math.round(Number(x) * 100) / 100);
const num = x => (x == null ? 0 : Number(x));

// ── El rango: presets o fechas sueltas. Siempre devuelve también el periodo
//    anterior de la misma longitud, para poder decir "frente al periodo anterior".
function rango(q = {}) {
  const hoy = hoyISO();
  let desde, hasta;
  const preset = String(q.preset || '').trim();
  if (esISO(q.desde) && esISO(q.hasta)) { desde = q.desde; hasta = q.hasta; }
  else if (preset === 'mes_pasado') {
    const [Y, M] = hoy.split('-').map(Number);
    const prim = new Date(Date.UTC(Y, M - 2, 1, 12)); const fin = new Date(Date.UTC(Y, M - 1, 0, 12));
    desde = prim.toISOString().slice(0, 10); hasta = fin.toISOString().slice(0, 10);
  } else if (preset === '7d')  { hasta = hoy; desde = sumaDias(hoy, -6); }
  else if (preset === '30d') { hasta = hoy; desde = sumaDias(hoy, -29); }
  else if (preset === '90d') { hasta = hoy; desde = sumaDias(hoy, -89); }
  else if (preset === 'anio') { hasta = hoy; desde = hoy.slice(0, 4) + '-01-01'; }
  else { hasta = hoy; desde = hoy.slice(0, 8) + '01'; }            // este mes (por defecto)
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  const dias = diasEntre(desde, hasta);
  return { desde, hasta, dias, anteriorDesde: sumaDias(desde, -dias), anteriorHasta: sumaDias(desde, -1), preset: preset || 'mes' };
}

// Filtros de dimensión: zona, tipo de contrato y turno. Vacío = todos.
function filtros(q = {}) {
  const lim = v => { const s = String(v || '').trim(); return s && s !== 'todos' ? s.slice(0, 40) : null; };
  return { zona: lim(q.zona), tipo: lim(q.tipo), turno: lim(q.turno) };
}
// Los tres filtros como condiciones sobre la dimensión conductor, con sus $n.
const condConductor = (f, alias, base) => [
  `($${base}::text IS NULL OR ${alias}.zona = $${base})`,
  `($${base + 1}::text IS NULL OR ${alias}.tipo_contrato = $${base + 1})`,
  `($${base + 2}::text IS NULL OR ${alias}.turno = $${base + 2})`,
].join(' AND ');
const params = (desde, hasta, f) => [desde, hasta, f.zona, f.tipo, f.turno];

// ── El bloque de números de un periodo (se usa para el actual y el anterior) ──
async function bloque(desde, hasta, f) {
  const p = params(desde, hasta, f);
  const [h, i, k, pl] = await Promise.all([
    db.consulta(`
      SELECT SUM(h.seg_efectivo)/3600.0 AS horas, SUM(h.seg_viaje)/3600.0 AS horas_viaje,
             SUM(h.seg_descanso)/3600.0 AS horas_descanso,
             COUNT(DISTINCT h.conductor_uuid) FILTER (WHERE h.seg_efectivo > 0) AS conductores,
             COUNT(DISTINCT h.vehiculo_uuid)  FILTER (WHERE h.seg_efectivo > 0) AS coches,
             COUNT(DISTINCT h.dia) AS dias
        FROM bi_hecho_horas_dia h
        LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = h.conductor_uuid
       WHERE h.dia BETWEEN $1::date AND $2::date AND ${condConductor(f, 'dc', 3)}`, p),
    db.consulta(`
      SELECT SUM(i.viajes) AS viajes, SUM(i.neto) AS neto, SUM(i.propina) AS propina, SUM(i.ofertas) AS ofertas,
             SUM(i.perdidas_conductor) AS perdidas, SUM(i.canc_cliente) AS canc_cliente,
             SUM(i.sin_respuesta) AS sin_respuesta, SUM(i.rechazados) AS rechazados, SUM(i.canc_conductor) AS canc_conductor
        FROM bi_hecho_ingresos_dia i
        LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = i.driver_uuid
       WHERE i.dia BETWEEN $1::date AND $2::date AND ${condConductor(f, 'dc', 3)}`, p),
    db.consulta(`
      SELECT SUM(k.km_total) AS km_total, SUM(k.km_bolt) AS km_bolt, SUM(k.km_fuera) AS km_fuera
        FROM bi_hecho_km_dia k
        LEFT JOIN bi_dim_vehiculo dv ON dv.matricula = k.matricula
       WHERE k.dia BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR dv.zona = $3)`, [desde, hasta, f.zona]),
    db.consulta(`
      SELECT ROUND(AVG(vigentes),1) AS plantilla, ROUND(AVG(ausentes),1) AS ausentes, ROUND(AVG(baja_medica),1) AS baja_medica,
             SUM(altas) AS altas, SUM(bajas_reales) AS bajas
        FROM bi_plantilla_dia WHERE dia BETWEEN $1::date AND $2::date`, [desde, hasta]),
  ]);
  const H = h.rows[0] || {}, I = i.rows[0] || {}, K = k.rows[0] || {}, P = pl.rows[0] || {};
  const horas = num(H.horas), neto = num(I.neto), viajes = num(I.viajes), ofertas = num(I.ofertas);
  return {
    horas: n1(horas), horasViaje: n1(H.horas_viaje), horasDescanso: n1(H.horas_descanso),
    utilizacion: horas > 0 ? n1(num(H.horas_viaje) / horas * 100) : null,
    conductores: num(H.conductores), coches: num(H.coches), dias: num(H.dias),
    neto: n2(neto), propina: n2(I.propina), viajes,
    eurosHora: horas > 0 ? n2(neto / horas) : null,
    eurosViaje: viajes > 0 ? n2(neto / viajes) : null,
    viajesHora: horas > 0 ? n2(viajes / horas) : null,
    ofertas, perdidas: num(I.perdidas), cancCliente: num(I.canc_cliente),
    sinRespuesta: num(I.sin_respuesta), rechazados: num(I.rechazados), cancConductor: num(I.canc_conductor),
    pctPerdidas: ofertas > 0 ? n1(num(I.perdidas) / ofertas * 100) : null,
    pctConversion: ofertas > 0 ? n1(viajes / ofertas * 100) : null,
    kmTotal: n1(K.km_total), kmBolt: n1(K.km_bolt), kmFuera: n1(K.km_fuera),
    eurosKm: num(K.km_bolt) > 0 ? n2(neto / num(K.km_bolt)) : null,
    horasPorCocheDia: num(H.coches) > 0 && num(H.dias) > 0 ? n2(horas / num(H.coches) / num(H.dias)) : null,
    eurosPorCocheDia: num(H.coches) > 0 && num(H.dias) > 0 ? n2(neto / num(H.coches) / num(H.dias)) : null,
    plantilla: n1(P.plantilla), ausentes: n1(P.ausentes), bajaMedica: n1(P.baja_medica),
    pctAbsentismo: num(P.plantilla) > 0 ? n1(num(P.ausentes) / num(P.plantilla) * 100) : null,
    altas: num(P.altas), bajas: num(P.bajas),
  };
}

async function resumen(q = {}) {
  const r = rango(q), f = filtros(q);
  const [actual, anterior] = await Promise.all([bloque(r.desde, r.hasta, f), bloque(r.anteriorDesde, r.anteriorHasta, f)]);
  return { rango: r, filtros: f, actual, anterior };
}

// ── Serie diaria del rango: una fila por día del calendario, sin huecos ──────
async function serieDiaria(q = {}) {
  const r = rango(q), f = filtros(q);
  const p = params(r.desde, r.hasta, f);
  const res = await db.consulta(`
    WITH d AS (SELECT dia, dia_semana, es_finde FROM bi_dim_fecha WHERE dia BETWEEN $1::date AND $2::date),
    h AS (
      SELECT h.dia, SUM(h.seg_efectivo)/3600.0 AS horas, SUM(h.seg_viaje)/3600.0 AS horas_viaje, SUM(h.seg_descanso)/3600.0 AS horas_descanso,
             COUNT(DISTINCT h.conductor_uuid) FILTER (WHERE h.seg_efectivo > 0) AS conductores,
             COUNT(DISTINCT h.vehiculo_uuid)  FILTER (WHERE h.seg_efectivo > 0) AS coches
        FROM bi_hecho_horas_dia h LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = h.conductor_uuid
       WHERE h.dia BETWEEN $1::date AND $2::date AND ${condConductor(f, 'dc', 3)} GROUP BY h.dia),
    i AS (
      SELECT i.dia, SUM(i.viajes) AS viajes, SUM(i.neto) AS neto, SUM(i.ofertas) AS ofertas, SUM(i.perdidas_conductor) AS perdidas,
             SUM(i.canc_cliente) AS canc_cliente
        FROM bi_hecho_ingresos_dia i LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = i.driver_uuid
       WHERE i.dia BETWEEN $1::date AND $2::date AND ${condConductor(f, 'dc', 3)} GROUP BY i.dia),
    k AS (
      SELECT k.dia, SUM(k.km_bolt) AS km_bolt, SUM(k.km_fuera) AS km_fuera
        FROM bi_hecho_km_dia k LEFT JOIN bi_dim_vehiculo dv ON dv.matricula = k.matricula
       WHERE k.dia BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR dv.zona = $3) GROUP BY k.dia)
    SELECT d.dia::text AS dia, d.dia_semana, d.es_finde,
           h.horas, h.horas_viaje, h.horas_descanso, h.conductores, h.coches,
           i.viajes, i.neto, i.ofertas, i.perdidas, i.canc_cliente, k.km_bolt, k.km_fuera
      FROM d LEFT JOIN h USING (dia) LEFT JOIN i USING (dia) LEFT JOIN k USING (dia)
     ORDER BY d.dia`, p);
  return { rango: r, filtros: f, dias: res.rows.map(x => {
    const horas = num(x.horas), neto = num(x.neto), viajes = num(x.viajes), ofertas = num(x.ofertas);
    return {
      dia: x.dia, diaSemana: x.dia_semana, esFinde: x.es_finde,
      horas: n1(horas), horasDescanso: n1(x.horas_descanso),
      utilizacion: horas > 0 ? n1(num(x.horas_viaje) / horas * 100) : null,
      conductores: num(x.conductores), coches: num(x.coches),
      neto: n2(neto), viajes, eurosHora: horas > 0 ? n2(neto / horas) : null,
      viajesHora: horas > 0 ? n2(viajes / horas) : null,
      ofertas, perdidas: num(x.perdidas), cancCliente: num(x.canc_cliente),
      pctPerdidas: ofertas > 0 ? n1(num(x.perdidas) / ofertas * 100) : null,
      kmBolt: n1(x.km_bolt), kmFuera: n1(x.km_fuera),
    };
  }) };
}

// ── Los KPI por mes, tal cual la vista (los últimos 12 con datos) ────────────
async function kpiMes() {
  const r = await db.consulta(`
    SELECT * FROM bi_kpi_mes WHERE neto IS NOT NULL OR horas_efectivas IS NOT NULL ORDER BY anio_mes DESC LIMIT 12`);
  return r.rows.reverse();
}

// ── Desgloses del periodo: por zona, contrato, turno de plaza y turno horario ─
async function desglose(q = {}) {
  const r = rango(q);
  const por = async (col, alias) => {
    const res = await db.consulta(`
      WITH h AS (
        SELECT COALESCE(dc.${col}::text, '(sin dato)') AS clave, SUM(h.seg_efectivo)/3600.0 AS horas, SUM(h.seg_viaje)/3600.0 AS horas_viaje,
               COUNT(DISTINCT h.conductor_uuid) FILTER (WHERE h.seg_efectivo > 0) AS conductores
          FROM bi_hecho_horas_dia h LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = h.conductor_uuid
         WHERE h.dia BETWEEN $1::date AND $2::date AND h.conductor_uuid IS NOT NULL GROUP BY 1),
      i AS (
        SELECT COALESCE(dc.${col}::text, '(sin dato)') AS clave, SUM(i.viajes) AS viajes, SUM(i.neto) AS neto,
               SUM(i.ofertas) AS ofertas, SUM(i.perdidas_conductor) AS perdidas
          FROM bi_hecho_ingresos_dia i LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = i.driver_uuid
         WHERE i.dia BETWEEN $1::date AND $2::date GROUP BY 1)
      SELECT COALESCE(h.clave, i.clave) AS clave, h.horas, h.horas_viaje, h.conductores, i.viajes, i.neto, i.ofertas, i.perdidas
        FROM h FULL JOIN i ON i.clave = h.clave ORDER BY i.neto DESC NULLS LAST`, [r.desde, r.hasta]);
    return res.rows.map(x => {
      const horas = num(x.horas), neto = num(x.neto), viajes = num(x.viajes), ofertas = num(x.ofertas);
      return { clave: x.clave, horas: n1(horas), neto: n2(neto), viajes, conductores: num(x.conductores),
        eurosHora: horas > 0 ? n2(neto / horas) : null, utilizacion: horas > 0 ? n1(num(x.horas_viaje) / horas * 100) : null,
        pctPerdidas: ofertas > 0 ? n1(num(x.perdidas) / ofertas * 100) : null };
    });
  };
  const turnoHora = await db.consulta(`
    SELECT i.turno_hora AS clave, SUM(i.viajes) AS viajes, SUM(i.neto) AS neto, SUM(i.ofertas) AS ofertas, SUM(i.perdidas_conductor) AS perdidas
      FROM bi_hecho_ingresos_dia i WHERE i.dia BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 1`, [r.desde, r.hasta]);
  const [zona, contrato, turno] = await Promise.all([por('zona'), por('tipo_contrato'), por('turno')]);
  return { rango: r, zona, contrato, turno,
    turnoHora: turnoHora.rows.map(x => ({ clave: x.clave === 'dia' ? 'Día (05–17)' : 'Noche (17–05)', viajes: num(x.viajes), neto: n2(x.neto),
      pctPerdidas: num(x.ofertas) > 0 ? n1(num(x.perdidas) / num(x.ofertas) * 100) : null })) };
}

// ── Ranking de conductores del periodo ──────────────────────────────────────
const ORDENES = { neto: 'neto DESC', horas: 'horas DESC', euros_hora: 'euros_hora DESC NULLS LAST', perdidas: 'pct_perdidas DESC NULLS LAST', utilizacion: 'utilizacion DESC NULLS LAST', menos_horas: 'horas ASC' };
async function conductores(q = {}) {
  const r = rango(q), f = filtros(q);
  const orden = ORDENES[q.orden] || ORDENES.neto;
  const limite = Math.max(5, Math.min(500, Number(q.limite) || 50));
  // Un ratio (€/h, utilización, % perdidas) con cuatro horas de muestra no dice
  // nada: encabezaba el ranking quien había salido una tarde. Para ordenar por
  // ratio se exige un mínimo de horas en el periodo (2 h por día, o lo que pidan).
  const esRatio = ['euros_hora', 'utilizacion', 'perdidas'].includes(q.orden);
  const minHoras = q.min != null && q.min !== '' ? Math.max(0, Number(q.min) || 0) : (esRatio ? Math.max(8, r.dias * 2) : 0);
  const res = await db.consulta(`
    WITH h AS (
      SELECT conductor_uuid AS uuid, SUM(seg_efectivo)/3600.0 AS horas, SUM(seg_viaje)/3600.0 AS horas_viaje, SUM(seg_descanso)/3600.0 AS horas_descanso,
             COUNT(DISTINCT dia) FILTER (WHERE seg_efectivo > 0) AS dias
        FROM bi_hecho_horas_dia WHERE dia BETWEEN $1::date AND $2::date AND conductor_uuid IS NOT NULL GROUP BY 1),
    i AS (
      SELECT driver_uuid AS uuid, SUM(viajes) AS viajes, SUM(neto) AS neto, SUM(ofertas) AS ofertas, SUM(perdidas_conductor) AS perdidas
        FROM bi_hecho_ingresos_dia WHERE dia BETWEEN $1::date AND $2::date AND driver_uuid IS NOT NULL GROUP BY 1),
    u AS (
      SELECT COALESCE(h.uuid, i.uuid) AS uuid, h.horas, h.horas_viaje, h.horas_descanso, h.dias, i.viajes, i.neto, i.ofertas, i.perdidas
        FROM h FULL JOIN i ON i.uuid = h.uuid)
    SELECT dc.conductor_id, COALESCE(dc.nombre, fc.nombre, '(cuenta ' || left(u.uuid, 8) || ')') AS nombre,
           (dc.conductor_id IS NULL) AS sin_enlazar, dc.tipo_contrato, dc.zona, dc.turno, dc.telefono, dc.empleo_vigente,
           u.horas, u.horas_descanso, u.dias, u.viajes, u.neto, u.ofertas, u.perdidas,
           u.neto / NULLIF(u.horas, 0) AS euros_hora,
           u.horas_viaje / NULLIF(u.horas, 0) * 100 AS utilizacion,
           u.perdidas::numeric / NULLIF(u.ofertas, 0) * 100 AS pct_perdidas,
           u.horas / NULLIF(u.dias, 0) AS horas_dia
      FROM u
      LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = u.uuid
      LEFT JOIN fv_conductor fc ON fc.uuid = u.uuid
     WHERE ${condConductor(f, 'dc', 3)} AND COALESCE(u.horas, 0) >= $6
     ORDER BY ${orden}, nombre
     LIMIT ${limite}`, [...params(r.desde, r.hasta, f), minHoras]);
  return { rango: r, filtros: f, orden: q.orden || 'neto', minHoras, filas: res.rows.map(x => ({
    conductorId: x.conductor_id, nombre: x.nombre, sinEnlazar: x.sin_enlazar, tipo: x.tipo_contrato, zona: x.zona, turno: x.turno,
    telefono: x.telefono, vigente: x.empleo_vigente,
    horas: n1(x.horas), horasDescanso: n1(x.horas_descanso), dias: num(x.dias), horasDia: n1(x.horas_dia),
    viajes: num(x.viajes), neto: n2(x.neto), eurosHora: n2(x.euros_hora), utilizacion: n1(x.utilizacion),
    ofertas: num(x.ofertas), perdidas: num(x.perdidas), pctPerdidas: n1(x.pct_perdidas),
  })) };
}

// ── Ranking de coches del periodo ───────────────────────────────────────────
async function vehiculos(q = {}) {
  const r = rango(q), f = filtros(q);
  const res = await db.consulta(`
    SELECT v.matricula, v.zona, v.cuadrante, v.marca_modelo, v.estado_operativo,
           SUM(v.horas_efectivas) AS horas, SUM(v.horas_descanso) AS horas_descanso, SUM(v.neto_atribuido) AS neto,
           SUM(v.viajes_atribuidos) AS viajes, SUM(v.km_total) AS km_total, SUM(v.km_bolt) AS km_bolt, SUM(v.km_fuera) AS km_fuera,
           COUNT(*) FILTER (WHERE v.salio) AS dias_salio, COUNT(*) AS dias
      FROM bi_vehiculo_dia v
     WHERE v.dia BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR v.zona = $3)
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY neto DESC NULLS LAST`, [r.desde, r.hasta, f.zona]);
  const dias = r.hasta > hoyISO() ? diasEntre(r.desde, hoyISO()) : r.dias;
  return { rango: r, filtros: f, filas: res.rows.map(x => ({
    matricula: x.matricula, zona: x.zona, cuadrante: x.cuadrante, modelo: x.marca_modelo, estado: x.estado_operativo,
    horas: n1(x.horas), horasDescanso: n1(x.horas_descanso), neto: n2(x.neto), viajes: n1(x.viajes),
    kmTotal: n1(x.km_total), kmBolt: n1(x.km_bolt), kmFuera: n1(x.km_fuera),
    diasSalio: num(x.dias_salio), diasPeriodo: dias,
    horasDia: num(x.dias_salio) > 0 ? n1(num(x.horas) / num(x.dias_salio)) : null,
    eurosDia: num(x.dias_salio) > 0 ? n2(num(x.neto) / num(x.dias_salio)) : null,
    eurosHora: num(x.horas) > 0 ? n2(num(x.neto) / num(x.horas)) : null,
    pctKmFuera: num(x.km_total) > 0 ? n1(num(x.km_fuera) / num(x.km_total) * 100) : null,
  })) };
}

// ── Personas: la plantilla y cómo se mueve ──────────────────────────────────
async function plantilla(q = {}) {
  const r = rango(q);
  const [serie, hoy, motivos, antig, edad, ausentesHoy] = await Promise.all([
    db.consulta(`SELECT dia::text AS dia, vigentes, vigentes_propia, vigentes_ett, ausentes, baja_medica, vacaciones, permiso, suspendidos, altas, bajas_reales AS bajas, en_prueba
                   FROM bi_plantilla_dia WHERE dia BETWEEN $1::date AND $2::date ORDER BY dia`, [r.desde, r.hasta]),
    db.consulta(`SELECT tipo_contrato, COUNT(*) AS n, COUNT(*) FILTER (WHERE ausente) AS ausentes, COUNT(*) FILTER (WHERE bolt_uuid IS NULL) AS sin_bolt,
                        COUNT(*) FILTER (WHERE en_prueba) AS en_prueba
                   FROM bi_dim_conductor WHERE empleo_vigente GROUP BY 1 ORDER BY 1`),
    db.consulta(`SELECT COALESCE(NULLIF(btrim(motivo_baja), ''), '(sin motivo)') AS motivo, COUNT(*) AS n
                   FROM bi_dim_conductor WHERE baja BETWEEN $1::date AND $2::date AND COALESCE(motivo_baja, '') <> 'Migración inicial'
                  GROUP BY 1 ORDER BY n DESC LIMIT 10`, [r.desde, r.hasta]),
    db.consulta(`SELECT CASE WHEN antiguedad_meses < 3 THEN '0-3 m' WHEN antiguedad_meses < 6 THEN '3-6 m' WHEN antiguedad_meses < 12 THEN '6-12 m'
                             WHEN antiguedad_meses < 24 THEN '1-2 a' ELSE '+2 a' END AS tramo,
                        MIN(antiguedad_meses) AS orden, COUNT(*) AS n
                   FROM bi_dim_conductor WHERE empleo_vigente AND antiguedad_meses IS NOT NULL GROUP BY 1 ORDER BY orden`),
    db.consulta(`SELECT CASE WHEN edad < 30 THEN '<30' WHEN edad < 40 THEN '30-39' WHEN edad < 50 THEN '40-49' WHEN edad < 60 THEN '50-59' ELSE '60+' END AS tramo,
                        MIN(edad) AS orden, COUNT(*) AS n
                   FROM bi_dim_conductor WHERE empleo_vigente AND edad IS NOT NULL GROUP BY 1 ORDER BY orden`),
    db.consulta(`SELECT estado_etiqueta AS estado, COUNT(*) AS n FROM bi_dim_conductor WHERE empleo_vigente AND ausente GROUP BY 1 ORDER BY n DESC`),
  ]);
  return { rango: r,
    serie: serie.rows.map(x => ({ dia: x.dia, vigentes: num(x.vigentes), propia: num(x.vigentes_propia), ett: num(x.vigentes_ett),
      ausentes: num(x.ausentes), bajaMedica: num(x.baja_medica), vacaciones: num(x.vacaciones), permiso: num(x.permiso),
      suspendidos: num(x.suspendidos), altas: num(x.altas), bajas: num(x.bajas), enPrueba: num(x.en_prueba) })),
    hoy: hoy.rows.map(x => ({ tipo: x.tipo_contrato || '(sin periodo)', n: num(x.n), ausentes: num(x.ausentes), sinBolt: num(x.sin_bolt), enPrueba: num(x.en_prueba) })),
    ausentesHoy: ausentesHoy.rows.map(x => ({ estado: x.estado, n: num(x.n) })),
    bajasMotivo: motivos.rows.map(x => ({ motivo: x.motivo, n: num(x.n) })),
    antiguedad: antig.rows.map(x => ({ tramo: x.tramo, n: num(x.n) })),
    edad: edad.rows.map(x => ({ tramo: x.tramo, n: num(x.n) })),
  };
}

// ── Operación: incidencias, justificantes y cobertura ───────────────────────
async function operacion(q = {}) {
  const r = rango(q);
  const cobDesde = sumaDias(hoyISO(), -13), cobHasta = hoyISO();
  const [tipo, dia, bit, cob, reinc] = await Promise.all([
    db.consulta(`SELECT tipo_etiqueta AS tipo, gravedad, COUNT(*) AS n, COUNT(*) FILTER (WHERE gestionada) AS gestionadas,
                        ROUND(AVG(duracion_seg) FILTER (WHERE resuelta_at IS NOT NULL) / 60) AS min_media
                   FROM bi_hecho_incidencias WHERE dia BETWEEN $1::date AND $2::date GROUP BY 1, 2 ORDER BY n DESC`, [r.desde, r.hasta]),
    db.consulta(`SELECT dia::text AS dia, COUNT(*) AS n, COUNT(*) FILTER (WHERE gravedad >= 4) AS graves
                   FROM bi_hecho_incidencias WHERE dia BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 1`, [r.desde, r.hasta]),
    db.consulta(`SELECT to_char(dia, 'YYYY-MM') AS mes, marca, marca_etiqueta AS etiqueta, COUNT(*) AS n
                   FROM bi_hecho_bitacora WHERE dia >= (date_trunc('month', $1::date) - interval '5 months')::date GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC`, [r.desde]),
    db.consulta(`SELECT c.dia::text AS dia, COUNT(*) AS plazas, COUNT(c.conductor_id) AS cubiertas
                   FROM f_cobertura($1::date, $2::date) c GROUP BY 1 ORDER BY 1`, [cobDesde, cobHasta]),
    db.consulta(`SELECT COALESCE(conductor, '(sin conductor)') AS conductor, matricula, COUNT(*) AS n, MAX(gravedad) AS gravedad
                   FROM bi_hecho_incidencias WHERE dia BETWEEN $1::date AND $2::date GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`, [r.desde, r.hasta]),
  ]);
  return { rango: r,
    incidenciasTipo: tipo.rows.map(x => ({ tipo: x.tipo, gravedad: num(x.gravedad), n: num(x.n), gestionadas: num(x.gestionadas), minMedia: num(x.min_media) })),
    incidenciasDia: dia.rows.map(x => ({ dia: x.dia, n: num(x.n), graves: num(x.graves) })),
    bitacora: bit.rows.map(x => ({ mes: x.mes, marca: x.marca, etiqueta: x.etiqueta, n: num(x.n) })),
    cobertura: cob.rows.map(x => ({ dia: x.dia, plazas: num(x.plazas), cubiertas: num(x.cubiertas), huecos: num(x.plazas) - num(x.cubiertas),
      pct: num(x.plazas) > 0 ? n1(num(x.cubiertas) / num(x.plazas) * 100) : null })),
    reincidentes: reinc.rows.map(x => ({ conductor: x.conductor, matricula: x.matricula, n: num(x.n), gravedad: num(x.gravedad) })),
  };
}

// ── Contratación: el embudo ─────────────────────────────────────────────────
async function funnel() {
  const [estados, canales, meses, tiempo] = await Promise.all([
    db.consulta(`SELECT estado_etiqueta AS estado, etapa, etapa_orden, en_funnel, es_salida, COUNT(*) AS n FROM bi_funnel_candidaturas GROUP BY 1, 2, 3, 4, 5 ORDER BY etapa_orden NULLS LAST`),
    db.consulta(`SELECT COALESCE(canal_etiqueta, canal, '(sin canal)') AS canal, COUNT(*) AS n, COUNT(*) FILTER (WHERE alta_at IS NOT NULL) AS altas FROM bi_funnel_candidaturas GROUP BY 1 ORDER BY n DESC`),
    db.consulta(`SELECT anio_mes, COUNT(*) AS n, COUNT(*) FILTER (WHERE alta_at IS NOT NULL) AS altas, COUNT(*) FILTER (WHERE es_salida) AS salidas FROM bi_funnel_candidaturas GROUP BY 1 ORDER BY 1`),
    db.consulta(`SELECT ROUND(AVG(dias_hasta_alta), 1) AS media, COUNT(*) AS n FROM bi_funnel_candidaturas WHERE dias_hasta_alta IS NOT NULL`),
  ]);
  return {
    estados: estados.rows.map(x => ({ estado: x.estado, etapa: x.etapa, enFunnel: x.en_funnel, esSalida: x.es_salida, n: num(x.n) })),
    canales: canales.rows.map(x => ({ canal: x.canal, n: num(x.n), altas: num(x.altas) })),
    meses: meses.rows.map(x => ({ mes: x.anio_mes, n: num(x.n), altas: num(x.altas), salidas: num(x.salidas) })),
    diasHastaAlta: tiempo.rows[0] ? { media: n1(tiempo.rows[0].media), n: num(tiempo.rows[0].n) } : null,
    total: estados.rows.reduce((s, x) => s + num(x.n), 0),
  };
}

// ── Mapa de calor: neto y viajes por hora del día × día de la semana ────────
// Sale de bolt_order directamente (la hora no está en la vista materializada).
async function heatmap(q = {}) {
  const r = rango(q);
  const res = await db.consulta(`
    SELECT EXTRACT(ISODOW FROM (finalizado_ts AT TIME ZONE 'Europe/Madrid'))::int AS dow,
           EXTRACT(HOUR FROM (finalizado_ts AT TIME ZONE 'Europe/Madrid'))::int AS hora,
           COUNT(*) AS viajes, SUM(neto) AS neto
      FROM bolt_order
     WHERE estado = 'finished' AND finalizado_ts IS NOT NULL
       AND (finalizado_ts AT TIME ZONE 'Europe/Madrid')::date BETWEEN $1::date AND $2::date
     GROUP BY 1, 2`, [r.desde, r.hasta]);
  return { rango: r, celdas: res.rows.map(x => ({ dow: x.dow, hora: x.hora, viajes: num(x.viajes), neto: n2(x.neto) })) };
}

// ── Refresco de los hechos materializados + cuándo fue ──────────────────────
const MATERIALIZADAS = ['bi_hecho_horas_dia', 'bi_hecho_ingresos_dia', 'bi_hecho_km_dia'];
async function refrescar() {
  const vistas = [];
  for (const v of MATERIALIZADAS) {
    const t0 = Date.now();
    await db.consulta('REFRESH MATERIALIZED VIEW CONCURRENTLY ' + v);
    vistas.push({ vista: v, ms: Date.now() - t0 });
  }
  await db.consulta(`INSERT INTO bi_meta (clave, valor, actualizado) VALUES ('refresco', $1, now())
                     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now()`,
    [JSON.stringify(vistas)]);
  return { vistas, at: new Date().toISOString() };
}
async function meta() {
  const r = await db.consulta(`SELECT valor, actualizado FROM bi_meta WHERE clave = 'refresco'`);
  const fila = r.rows[0];
  return { refrescoAt: fila ? fila.actualizado : null, detalle: fila && fila.valor && fila.valor.startsWith('[') ? JSON.parse(fila.valor) : null };
}

// ── Catálogo de filtros (para los desplegables) ─────────────────────────────
async function catalogo() {
  const [z, t] = await Promise.all([
    db.consulta(`SELECT nombre FROM base_zona WHERE activa ORDER BY nombre`),
    db.consulta(`SELECT DISTINCT turno FROM bi_dim_conductor WHERE turno IS NOT NULL ORDER BY 1`),
  ]);
  return { zonas: z.rows.map(x => x.nombre), turnos: t.rows.map(x => x.turno), tipos: ['propia', 'ett'] };
}

// ── Exportar una vista bi_* tal cual (CSV para Excel / Power BI sin conexión) ─
const EXPORTABLES = {
  kpi_mes: { vista: 'bi_kpi_mes', fecha: null, orden: 'anio_mes' },
  conductor_mes: { vista: 'bi_conductor_mes', fecha: null, orden: 'anio_mes, nombre' },
  vehiculo_dia: { vista: 'bi_vehiculo_dia', fecha: 'dia', orden: 'dia, matricula' },
  horas_dia: { vista: 'bi_hecho_horas_dia', fecha: 'dia', orden: 'dia' },
  ingresos_dia: { vista: 'bi_hecho_ingresos_dia', fecha: 'dia', orden: 'dia' },
  km_dia: { vista: 'bi_hecho_km_dia', fecha: 'dia', orden: 'dia, matricula' },
  plantilla_dia: { vista: 'bi_plantilla_dia', fecha: 'dia', orden: 'dia' },
  incidencias: { vista: 'bi_hecho_incidencias', fecha: 'dia', orden: 'dia, id' },
  bitacora: { vista: 'bi_hecho_bitacora', fecha: 'dia', orden: 'dia' },
  candidaturas: { vista: 'bi_funnel_candidaturas', fecha: null, orden: 'id' },
  dim_conductor: { vista: 'bi_dim_conductor', fecha: null, orden: 'nombre' },
  dim_vehiculo: { vista: 'bi_dim_vehiculo', fecha: null, orden: 'matricula' },
};
async function exportar(clave, q = {}) {
  const e = EXPORTABLES[clave];
  if (!e) throw new Error('Vista no exportable: ' + clave);
  const r = rango(q);
  const res = e.fecha
    ? await db.consulta(`SELECT * FROM ${e.vista} WHERE ${e.fecha} BETWEEN $1::date AND $2::date ORDER BY ${e.orden}`, [r.desde, r.hasta])
    : await db.consulta(`SELECT * FROM ${e.vista} ORDER BY ${e.orden}`);
  return { vista: e.vista, columnas: res.fields.map(f => f.name), filas: res.rows };
}

module.exports = {
  rango, filtros, resumen, serieDiaria, kpiMes, desglose, conductores, vehiculos, plantilla, operacion, funnel, heatmap,
  refrescar, meta, catalogo, exportar, EXPORTABLES, MATERIALIZADAS,
};
