// ============================================================
// CONVENIO — lectura para la interfaz de RRHH (Hito 13)
// ============================================================
// Solo LEE. Junta lo que los Hitos 1-12 dejaron en la base (contrato, objetivo,
// conciliacion, registro, ausencias, variables, incidencias, liquidacion) y lo
// sirve ya masticado para el panel y la ficha del trabajador. Ni una cuenta del
// convenio vive aqui: todas estan en las funciones y vistas de la base. Este
// modulo es el cristal por el que se miran, no otra copia de la logica.

const db = require('../db');

const filas = async (sql, params) => (await db.consulta(sql, params)).rows;
const una = async (sql, params) => (await db.consulta(sql, params)).rows[0] || null;

// ── El mes que se enseña por defecto ────────────────────────────────────────
// El ultimo mes con objetivos generados: es donde hay algo que mirar. Si aun no
// hay ninguno (base recien montada), el mes natural en curso.
async function mesPorDefecto() {
  const r = await una(`SELECT anio, mes FROM objetivo_mensual ORDER BY anio DESC, mes DESC LIMIT 1`);
  if (r) return { anio: r.anio, mes: r.mes };
  const hoy = new Date();
  return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
}

// ── El panel: un trabajador por fila, con la cuenta del mes ──────────────────
// Cada conductor con contrato vigente y, al lado, su conciliacion del mes
// pedido. LEFT JOIN: si el mes no tiene objetivo ni movimientos, la fila sale
// igual con huecos, que es mas honesto que esconderla.
async function trabajadores(anio, mes) {
  return filas(`
    SELECT
      co.id                                            AS conductor_id,
      vc.id                                            AS contrato_id,
      btrim(co.nombre || ' ' || COALESCE(co.apellidos, '')) AS nombre,
      vc.grupo,
      vc.grupo_nombre,
      vc.jornada_mode,
      vc.desde                                         AS contrato_desde,
      om.objetivo_min,
      om.publicado_at,
      om.congelado_at,
      cm.bruta, cm.reduce, cm.neta,
      cm.cumple, cm.cumple_total, cm.espera_fuera_area,
      cm.defecto, cm.exceso,
      (SELECT count(*)::int FROM incidencia_economica ie
        WHERE ie.conductor_id = co.id
          AND ie.estado NOT IN ('descontada', 'rechazada'))  AS incidencias_abiertas
    FROM conductor co
    JOIN v_contrato vc ON vc.conductor_id = co.id AND vc.vigente
    LEFT JOIN objetivo_mensual om ON om.contrato_id = vc.id AND om.anio = $1 AND om.mes = $2
    LEFT JOIN v_conciliacion_mes cm ON cm.contrato_id = vc.id AND cm.anio = $1 AND cm.mes = $2
    ORDER BY nombre`, [anio, mes]);
}

// ── La ficha de un trabajador ───────────────────────────────────────────────
// Todo lo suyo, cada cosa de su tabla, en una sola pasada. Las tablas grandes
// (registro, variables) van recortadas a lo reciente: la ficha es para mirar de
// un vistazo, no el archivo completo.
async function ficha(conductorId) {
  const id = Number(conductorId);
  if (!Number.isInteger(id)) throw new Error('Conductor no válido');

  const datos = await una(`
    SELECT id, btrim(nombre || ' ' || COALESCE(apellidos, '')) AS nombre,
           dni_tipo, dni_nie, email, correo_legal, empleo_vigente
      FROM conductor WHERE id = $1`, [id]);
  if (!datos) throw new Error('No se encuentra el conductor');

  // Contratos (el vigente primero), la conciliacion de los ultimos meses, el
  // registro reciente, las ausencias, las variables, las incidencias y las
  // liquidaciones. Cada una de su tabla, sin recalcular nada.
  const [contratos, conciliacion, registro, ausencias, variables, incidencias, liquidaciones] =
    await Promise.all([
      filas(`SELECT id AS contrato_id, grupo, grupo_nombre, convenio, jornada_mode,
                    target_policy, desde, hasta, vigente
               FROM v_contrato WHERE conductor_id = $1 ORDER BY desde DESC`, [id]),

      filas(`SELECT cm.anio, cm.mes, cm.bruta, cm.reduce, cm.neta,
                    cm.cumple, cm.cumple_total, cm.espera_fuera_area,
                    cm.defecto, cm.exceso,
                    om.publicado_at, om.congelado_at
               FROM v_conciliacion_mes cm
               JOIN contrato c ON c.id = cm.contrato_id
               LEFT JOIN objetivo_mensual om
                      ON om.contrato_id = cm.contrato_id AND om.anio = cm.anio AND om.mes = cm.mes
              WHERE c.conductor_id = $1
              ORDER BY cm.anio DESC, cm.mes DESC LIMIT 12`, [id]),

      filas(`SELECT dia, inicio, fin, efectivo_estricto_min, efectivo_total_min,
                    descanso_min, aux_min, nocturno_min, congelado_at
               FROM registro_jornada WHERE conductor_id = $1
              ORDER BY dia DESC LIMIT 30`, [id]),

      filas(`SELECT h.estado, cec.etiqueta AS estado_etiqueta, cec.es_ausencia,
                    h.desde, h.hasta, h.hasta_previsto, h.motivo,
                    h.leave_type_code, h.it_grave, h.it_hospitalizacion
               FROM conductor_estado_hist h
               JOIN cat_estado_conductor cec ON cec.codigo = h.estado
              WHERE h.conductor_id = $1
              ORDER BY h.desde DESC LIMIT 30`, [id]),

      filas(`SELECT tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
                    cantidad, unidad, importe, estado
               FROM variable_nomina WHERE conductor_id = $1
              ORDER BY devengo_anio DESC, devengo_mes DESC, tipo LIMIT 40`, [id]),

      filas(`SELECT id, tipo, estado, importe_detectado, importe_validado,
                    importe_autorizado, ref_autoridad, detectada_at,
                    programada_anio, programada_mes
               FROM incidencia_economica WHERE conductor_id = $1
              ORDER BY detectada_at DESC LIMIT 40`, [id]),

      filas(`SELECT id, fecha_baja, tipo_baja, preaviso_exigido, dias_preavisados,
                    estado, total
               FROM liquidacion WHERE conductor_id = $1
              ORDER BY fecha_baja DESC`, [id]),
    ]);

  return {
    ...datos,
    contrato: contratos.find(c => c.vigente) || contratos[0] || null,
    contratos, conciliacion, registro, ausencias, variables, incidencias, liquidaciones,
  };
}

// ── Cierre de periodo (Hito 7) ──────────────────────────────────────────────
// La lista de meses a cerrar: los que tienen objetivos o ya un periodo, con la
// cuenta en vivo al lado (lo que se congelaria) y, si ya se cerro, su sello.
async function periodos() {
  return filas(`
    WITH meses AS (
      SELECT DISTINCT anio, mes FROM objetivo_mensual
      UNION
      SELECT anio, mes FROM periodo_nomina
    ),
    vivo AS (
      SELECT anio, mes,
             count(*)::int                    AS contratos,
             COALESCE(sum(defecto), 0)::int   AS defecto,
             COALESCE(sum(exceso), 0)::int    AS exceso
        FROM v_conciliacion_mes GROUP BY anio, mes
    )
    SELECT m.anio || '-' || lpad(m.mes::text, 2, '0') AS k,
           m.anio, m.mes,
           COALESCE(p.estado, 'sin_cerrar')   AS estado,
           p.cerrado_at, p.cerrado_por, p.manifiesto,
           (SELECT count(*)::int FROM cierre_conciliacion cc WHERE cc.periodo_id = p.id) AS contratos_cerrados,
           COALESCE(v.contratos, 0)           AS contratos_vivo,
           COALESCE(v.defecto, 0)             AS defecto_vivo,
           COALESCE(v.exceso, 0)              AS exceso_vivo,
           -- Si esta cerrado, ¿ha cambiado algo desde el cierre? (candidato a regularizar)
           (p.estado = 'cerrado' AND EXISTS (
              SELECT 1 FROM v_conciliacion_mes v2
              JOIN cierre_conciliacion cc2 ON cc2.contrato_id = v2.contrato_id AND cc2.periodo_id = p.id
              WHERE v2.anio = m.anio AND v2.mes = m.mes
                AND (v2.cumple <> cc2.cumple OR v2.reduce <> cc2.reduce)
           )) AS tiene_cambios
      FROM meses m
      LEFT JOIN periodo_nomina p ON p.anio = m.anio AND p.mes = m.mes
      LEFT JOIN vivo v ON v.anio = m.anio AND v.mes = m.mes
     ORDER BY m.anio DESC, m.mes DESC`);
}

// La ficha de un periodo: la foto congelada (si cerrado), la vista en vivo, las
// diferencias desde el cierre y las regularizaciones ya apuntadas.
async function fichaPeriodo(anio, mes) {
  const a = Number(anio), m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m)) throw new Error('Periodo no válido');
  const per = await una(`SELECT * FROM periodo_nomina WHERE anio = $1 AND mes = $2`, [a, m]);
  const cerrado = !!per && per.estado === 'cerrado';

  const [snapshot, vivo, diferencias, regularizaciones] = await Promise.all([
    cerrado ? filas(`
      SELECT cc.contrato_id, btrim(co.nombre || ' ' || COALESCE(co.apellidos, '')) AS nombre,
             cc.bruta, cc.reduce, cc.neta, cc.cumple, cc.cumple_total, cc.defecto, cc.exceso
        FROM cierre_conciliacion cc
        JOIN contrato c  ON c.id = cc.contrato_id
        JOIN conductor co ON co.id = c.conductor_id
       WHERE cc.periodo_id = $1 ORDER BY nombre`, [per.id]) : Promise.resolve([]),

    filas(`
      SELECT v.contrato_id, btrim(co.nombre || ' ' || COALESCE(co.apellidos, '')) AS nombre,
             v.bruta, v.reduce, v.neta, v.cumple, v.cumple_total, v.defecto, v.exceso
        FROM v_conciliacion_mes v
        JOIN contrato c  ON c.id = v.contrato_id
        JOIN conductor co ON co.id = c.conductor_id
       WHERE v.anio = $1 AND v.mes = $2 ORDER BY nombre`, [a, m]),

    cerrado ? filas(`
      SELECT v.contrato_id, btrim(co.nombre || ' ' || COALESCE(co.apellidos, '')) AS nombre,
             (v.cumple - cc.cumple) AS delta_cumple,
             (v.reduce - cc.reduce) AS delta_reduce
        FROM v_conciliacion_mes v
        JOIN cierre_conciliacion cc ON cc.contrato_id = v.contrato_id AND cc.periodo_id = $3
        JOIN contrato c  ON c.id = v.contrato_id
        JOIN conductor co ON co.id = c.conductor_id
       WHERE v.anio = $1 AND v.mes = $2 AND (v.cumple <> cc.cumple OR v.reduce <> cc.reduce)
       ORDER BY nombre`, [a, m, per.id]) : Promise.resolve([]),

    filas(`
      SELECT r.origen_anio, r.origen_mes, r.aplica_anio, r.aplica_mes, r.concepto,
             r.delta_min, r.motivo, r.creado_at,
             btrim(co.nombre || ' ' || COALESCE(co.apellidos, '')) AS nombre
        FROM regularizacion r JOIN conductor co ON co.id = r.conductor_id
       WHERE r.origen_anio = $1 AND r.origen_mes = $2
       ORDER BY r.creado_at DESC`, [a, m]),
  ]);

  return { anio: a, mes: m, periodo: per, cerrado, snapshot, vivo, diferencias, regularizaciones };
}

/** Cierra un mes: fotografia, congela y sella (llama a f_cerrar_periodo). */
async function cerrar(anio, mes, quien) {
  const r = await db.consulta(`SELECT * FROM f_cerrar_periodo($1, $2, $3)`, [Number(anio), Number(mes), quien || null]);
  return r.rows[0];   // { periodo_id, contratos, manifiesto }
}

/** Apunta hacia adelante lo que cambio en un mes cerrado (f_regularizar). */
async function regularizar(origenAnio, origenMes, aplicaAnio, aplicaMes) {
  const r = await db.consulta(`SELECT f_regularizar($1, $2, $3, $4) AS creadas`,
    [Number(origenAnio), Number(origenMes), Number(aplicaAnio), Number(aplicaMes)]);
  return { creadas: r.rows[0].creadas };
}

// ── Cuadro de absentismo (Hito 11) ──────────────────────────────────────────
// El coste del absentismo del mes, agregado por MODULO RESPONSABLE. Las dos
// magnitudes -coste soportado (lo pagado) y lucro cesante (lo no facturado)- se
// suman limpio; por eso aqui se agregan y se ordenan por coste total. Los
// "trabajadores" NO se suman entre tipos (contarian doble): se ven por tipo en
// el detalle, donde el dato ya es exacto.
async function absentismo(anio, mes) {
  return filas(`
    SELECT modulo,
           count(*)::int                    AS tipos,
           sum(dias)::int                   AS dias,
           round(sum(horas), 1)             AS horas,
           round(sum(coste_soportado), 2)   AS coste_soportado,
           round(sum(lucro_cesante), 2)     AS lucro_cesante
      FROM v_coste_absentismo
     WHERE anio = $1 AND mes = $2
     GROUP BY modulo
     ORDER BY (sum(coste_soportado) + sum(lucro_cesante)) DESC`, [Number(anio), Number(mes)]);
}

// El detalle de un modulo: cada tipo de ausencia, con su coste. Aqui
// "trabajadores" es el de la vista (distinct por tipo), asi que es exacto.
async function absentismoModulo(anio, mes, modulo) {
  const tipos = await filas(`
    SELECT tipo, trabajadores, dias, round(horas, 1) AS horas,
           round(coste_soportado, 2) AS coste_soportado,
           round(lucro_cesante, 2)   AS lucro_cesante
      FROM v_coste_absentismo
     WHERE anio = $1 AND mes = $2 AND modulo = $3
     ORDER BY (coste_soportado + lucro_cesante) DESC`, [Number(anio), Number(mes), String(modulo)]);
  return { modulo: String(modulo), anio: Number(anio), mes: Number(mes), tipos };
}

module.exports = {
  mesPorDefecto, trabajadores, ficha,
  periodos, fichaPeriodo, cerrar, regularizar,
  absentismo, absentismoModulo,
};
