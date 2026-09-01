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

module.exports = { mesPorDefecto, trabajadores, ficha };
