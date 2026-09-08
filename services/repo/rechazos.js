// ============================================================
// RECHAZOS — cuántos viajes está tirando cada conductor en su jornada
// ============================================================
// Es lo que Tráfico necesita ver al lado del nombre: un conductor conectado ocho
// horas que rechaza cuarenta viajes no está trabajando, está ocupando un coche.
// Sale de `bolt_order`, que ya se ingiere.
//
// LOS ESTADOS DE BOLT Y QUÉ SIGNIFICAN AQUÍ:
//   finished                      → lo hizo. Es el denominador.
//   driver_rejected               → le llegó y dijo que no. Rechazo explícito.
//   driver_did_not_respond        → le llegó y lo dejó sonar. Rechazo igualmente:
//                                    para el cliente y para la flota es lo mismo.
//   driver_cancelled_after_accept → aceptó y luego lo soltó. El PEOR: el cliente
//                                    ya estaba esperando. Se cuenta aparte.
//   client_cancelled / client_did_not_show → del cliente, no del conductor: NO
//                                    cuentan como rechazo (sería acusarle de algo
//                                    que no hizo).
//
// La ventana es la JORNADA OPERATIVA (05:00 → 05:00), la misma que todo Control.

const db = require('../db');

const RECHAZO = ['driver_rejected', 'driver_did_not_respond', 'driver_cancelled_after_accept'];

/**
 * Rechazos por cuenta de BOLT en una jornada.
 * Devuelve Map(driver_uuid -> { rechazados, sinResponder, cancelados, total,
 *                               aceptados, ofertas, tasa }).
 * `tasa` es el % de aceptación: aceptados / (aceptados + rechazos).
 */
async function porConductor(diaIso, { hora = 5 } = {}) {
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval)       AT TIME ZONE 'Europe/Madrid' AS ini,
              (($1::date + 1) + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT o.driver_uuid,
            count(*) FILTER (WHERE o.estado = 'finished')::int                      AS aceptados,
            count(*) FILTER (WHERE o.estado = 'driver_rejected')::int               AS rechazados,
            count(*) FILTER (WHERE o.estado = 'driver_did_not_respond')::int        AS sin_responder,
            count(*) FILTER (WHERE o.estado = 'driver_cancelled_after_accept')::int AS cancelados
       FROM bolt_order o CROSS JOIN v
      WHERE o.driver_uuid IS NOT NULL
        AND o.creado_ts >= v.ini AND o.creado_ts < v.fin
      GROUP BY o.driver_uuid`,
    [String(diaIso).slice(0, 10), String(hora)]);

  const m = new Map();
  r.rows.forEach(x => {
    const rechazados = Number(x.rechazados) || 0;
    const sinResponder = Number(x.sin_responder) || 0;
    const cancelados = Number(x.cancelados) || 0;
    const aceptados = Number(x.aceptados) || 0;
    const total = rechazados + sinResponder + cancelados;
    const ofertas = aceptados + total;
    m.set(x.driver_uuid, {
      rechazados, sinResponder, cancelados, aceptados, total, ofertas,
      tasa: ofertas > 0 ? Math.round((aceptados / ofertas) * 100) : null,
    });
  });
  return m;
}

/** Suma de varias cuentas de BOLT de la misma persona. */
function fundir(lista) {
  const f = { rechazados: 0, sinResponder: 0, cancelados: 0, aceptados: 0, total: 0, ofertas: 0, tasa: null };
  lista.filter(Boolean).forEach(x => {
    f.rechazados += x.rechazados; f.sinResponder += x.sinResponder; f.cancelados += x.cancelados;
    f.aceptados += x.aceptados; f.total += x.total; f.ofertas += x.ofertas;
  });
  f.tasa = f.ofertas > 0 ? Math.round((f.aceptados / f.ofertas) * 100) : null;
  return f;
}

module.exports = { porConductor, fundir, RECHAZO };
