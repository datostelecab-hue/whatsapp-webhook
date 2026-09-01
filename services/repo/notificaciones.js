// ============================================================
// NOTIFICACIONES — generar los requerimientos, con sus reglas
// ============================================================
// El motor que, tras cerrar un mes, crea las comunicaciones que tocan: la de
// defecto de jornada, los requerimientos de ausencia. Con la plantilla correcta
// segun el modo de jornada, la puerta de aprobacion para las graves, la
// evidencia y la idempotencia.
//
// AQUI SE CREAN, NO SE ENVIAN. El envio -por el canal fehaciente, dentro de la
// ventana del art. 46, con su acuse- es el paso siguiente: saca de la cola las
// que esten 'en_cola'. Separarlo deja que las graves esperen aprobacion humana
// sin bloquear a las automaticas.

const db = require('../db');
const crypto = require('crypto');

// Umbral de defecto para comunicar, en minutos. Por debajo no se molesta a
// nadie: un defecto de diez minutos en un mes no es una reclamacion.
const UMBRAL_DEFECTO_MIN = Number(process.env.NOTIF_UMBRAL_DEFECTO_MIN) || 480;   // 8h

// ── Piezas puras (sin base, testeables) ─────────────────────────────────────

/**
 * Que plantilla de defecto de jornada corresponde a un modo de jornada.
 *
 * Es la restriccion legal del spec 5.1: con MARCO_TEMPORAL el conductor ordena
 * su jornada y el computo es mensual, asi que reclamarle un defecto DIARIO no se
 * sostiene -> comunicacion MENSUAL. Con HORARIO_CONCRETO cabe la diaria.
 * Codificarlo en una sola plantilla es el error que se paga en la primera
 * reclamacion.
 */
function plantillaDefecto(jornadaMode) {
  return jornadaMode === 'HORARIO_CONCRETO'
    ? 'COM_DEFECTO_JORNADA_DIA'
    : 'COM_DEFECTO_JORNADA_MES';
}

/**
 * La version de los datos: una huella de las cifras con que se genero.
 *
 * Si el mes se reabre y cambian, la huella cambia, y eso dispara una
 * RECTIFICATIVA en vez de reenviar lo mismo. Solo entran las cifras que, si
 * cambian, cambian el contenido del requerimiento.
 */
function versionDatos(cifras) {
  const base = Object.keys(cifras).sort().map(k => `${k}=${cifras[k]}`).join('|');
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
}

/**
 * La calificacion del art. 39 por dias de inasistencia. El sistema PROPONE; la
 * decide una persona. De 2 dias en adelante exige aprobacion humana.
 */
function calificacionInasistencia(dias) {
  if (dias >= 4) return { severidad: 'MUY_GRAVE', requiereAprob: true, regla: 'ABS_4D' };
  if (dias >= 2) return { severidad: 'GRAVE', requiereAprob: true, regla: 'ABS_2D' };
  if (dias >= 1) return { severidad: 'LEVE', requiereAprob: false, regla: 'ABS_1D' };
  return null;
}

// ── La plantilla vigente, de la base ────────────────────────────────────────
async function plantillaVigente(code) {
  const r = await db.consulta(
    `SELECT template_code AS code, version, channel, requires_human_approval, active,
            requires_ack, applies_to_jornada_mode
       FROM notification_template
      WHERE code = $1
      ORDER BY version DESC LIMIT 1`, [code]);
  return r.rows[0] || null;
}

/**
 * Crea (o rectifica) una notificacion. El corazon del motor.
 *
 * Idempotente por (conductor, plantilla, periodo, version_datos): con los mismos
 * datos no se crea dos veces. Con datos distintos para el mismo periodo, la
 * nueva RECTIFICA a la anterior.
 */
async function crear({ conductorId, code, periodo, cifras, requiereAprobExtra = false,
                       venceEl = null, creadaPor = 'sistema' }) {
  const tpl = await plantillaVigente(code);
  if (!tpl) throw new Error(`No existe la plantilla ${code}`);

  const version = versionDatos(cifras);
  const requiereAprob = tpl.requires_human_approval || requiereAprobExtra;
  const estado = requiereAprob ? 'borrador' : 'en_cola';

  // El correo autorizado del art. 13. Sin el, se marca: no se envia por email.
  const cond = (await db.consulta(
    'SELECT correo_legal FROM conductor WHERE id = $1', [conductorId])).rows[0] || {};
  const sinCorreo = tpl.channel === 'EMAIL' && !cond.correo_legal;

  // La anterior del mismo periodo, si la habia con OTROS datos: se rectifica.
  const previa = (await db.consulta(
    `SELECT id, version_datos FROM notificacion
      WHERE conductor_id = $1 AND template_code = $2 AND periodo = $3
      ORDER BY creada_at DESC LIMIT 1`, [conductorId, code, periodo])).rows[0];

  const ins = await db.consulta(
    `INSERT INTO notificacion
       (conductor_id, template_code, template_version, canal, periodo, payload,
        version_datos, estado, requiere_aprob, vence_el, rectifica_a, creada_por)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (conductor_id, template_code, periodo, version_datos) DO NOTHING
     RETURNING id`,
    [conductorId, code, tpl.version, tpl.channel, periodo, JSON.stringify(cifras),
     version, estado, requiereAprob, venceEl,
     (previa && previa.version_datos !== version) ? previa.id : null, creadaPor]);

  if (!ins.rowCount) return { creada: false, motivo: 'ya existia con estos datos' };

  // Si rectifica a otra, la anterior queda marcada.
  if (previa && previa.version_datos !== version) {
    await db.consulta(
      "UPDATE notificacion SET estado = 'rectificada' WHERE id = $1 AND estado <> 'rectificada'",
      [previa.id]);
  }

  return { creada: true, id: ins.rows[0].id, estado, requiereAprob, sinCorreo,
           rectificaA: (previa && previa.version_datos !== version) ? previa.id : null };
}

/**
 * Genera las comunicaciones de defecto de jornada de un mes cerrado.
 *
 * Por cada contrato con defecto sobre el umbral, la plantilla que corresponde a
 * su modo de jornada, con las cifras de la reconciliacion como evidencia.
 */
async function generarDefectoMes(anio, mes, { umbral = UMBRAL_DEFECTO_MIN } = {}) {
  const filas = (await db.consulta(
    `SELECT v.contrato_id, c.conductor_id, c.jornada_mode,
            v.bruta, v.reduce, v.neta, v.cumple, v.cubre, v.defecto
       FROM v_conciliacion_mes v
       JOIN contrato c ON c.id = v.contrato_id
      WHERE v.anio = $1 AND v.mes = $2 AND v.defecto >= $3`,
    [anio, mes, umbral])).rows;

  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const salida = { periodo, revisados: filas.length, creadas: 0, rectificadas: 0, sinCorreo: 0, yaEstaban: 0 };

  for (const f of filas) {
    const code = plantillaDefecto(f.jornada_mode);
    const cifras = {
      bruta: f.bruta, reduce: f.reduce, neta: f.neta,
      cumple: f.cumple, cubre: f.cubre, defecto: f.defecto,
    };
    const r = await crear({ conductorId: f.conductor_id, code, periodo, cifras });
    if (!r.creada) { salida.yaEstaban++; continue; }
    salida.creadas++;
    if (r.rectificaA) salida.rectificadas++;
    if (r.sinCorreo) salida.sinCorreo++;
  }
  return salida;
}

/** Aprueba un borrador: pasa de 'borrador' a 'en_cola' para que salga. */
async function aprobar(id, quien) {
  const r = await db.consulta(
    `UPDATE notificacion SET estado = 'en_cola', aprobada_por = $2, aprobada_at = now()
      WHERE id = $1 AND estado = 'borrador' AND requiere_aprob
      RETURNING id`, [id, String(quien || '').slice(0, 120)]);
  if (!r.rowCount) throw new Error('No es un borrador pendiente de aprobacion');
  return { id, estado: 'en_cola' };
}

module.exports = {
  plantillaDefecto, versionDatos, calificacionInasistencia,
  plantillaVigente, crear, generarDefectoMes, aprobar,
  UMBRAL_DEFECTO_MIN,
};
