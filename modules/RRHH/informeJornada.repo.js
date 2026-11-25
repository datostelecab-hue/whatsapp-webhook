// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC — el SQL (módulo 5, 25/11/2026)
// ============================================================
'use strict';

const db = require('../../services/db');

/** La persona: nombre, documento, legajo, su empleo y sus cuentas de BOLT. */
async function persona(id) {
  const r = await db.consulta(
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.nombre_ss,
            c.dni_nie, c.legajo,
            (SELECT array_agg(ce.externo_id ORDER BY ce.externo_id) FROM conductor_externo ce
              WHERE ce.sistema = 'bolt' AND ce.conductor_id = c.id) AS cuentas,
            e.tipo AS empleo, to_char(e.alta, 'YYYY-MM-DD') AS alta, to_char(e.baja, 'YYYY-MM-DD') AS baja
       FROM conductor c
       LEFT JOIN LATERAL (SELECT tipo, alta, baja FROM conductor_periodo_empleo pe
                           WHERE pe.conductor_id = c.id ORDER BY (pe.baja IS NULL) DESC, pe.alta DESC LIMIT 1) e ON TRUE
      WHERE c.id = $1`, [Number(id)]);
  const p = r.rows[0];
  return p ? { ...p, cuentas: p.cuentas || [] } : null;
}

/**
 * Los tramos de BOLT de esas cuentas que tocan [desde, hasta): situación,
 * coche (su uuid de BOLT) y desde-hasta en ms. El final de un tramo abierto, con
 * la regla de la casa (rutas.FIN_KM): uno que nadie cierra no suma sin fin.
 */
async function tramos(uuids, desdeMs, hastaMs) {
  if (!uuids.length) return [];
  const fv = require('../../services/flotaViva/db');
  const { FIN_KM } = require('../../services/flotaViva/rutas');
  if (!fv.HAY_BD) return [];
  await fv.preparar();
  const r = await fv.consulta(
    `SELECT t.situacion, t.vehiculo_uuid AS veh,
            extract(epoch FROM t.desde) * 1000 AS desde_ms,
            extract(epoch FROM ${FIN_KM}) * 1000 AS hasta_ms
       FROM fv_tramo t
      WHERE t.conductor_uuid = ANY($3::text[])
        AND t.desde < $2::timestamptz
        AND (t.hasta IS NULL OR t.hasta > $1::timestamptz)
        AND t.desde >= $1::timestamptz - interval '2 days'
      ORDER BY t.desde`,
    [new Date(desdeMs).toISOString(), new Date(hastaMs).toISOString(), uuids]);
  return r.rows.map(x => ({ situacion: x.situacion, veh: x.veh, desdeMs: Number(x.desde_ms), hastaMs: Number(x.hasta_ms) }));
}

/** La regla del convenio, tal como está en la base (cat_estado_te): para dejarla escrita en el informe. */
async function regla() {
  const r = await db.consulta(`SELECT estado_bolt, cuenta, condicionado, supuesto_te, supuesto_sin FROM cat_estado_te ORDER BY estado_bolt`);
  return r.rows;
}

/** ¿Hay alguna zona de Mapon puesta? Sin zonas, toda la espera queda fuera del área. */
async function hayZonas() {
  try {
    const r = await db.consulta(`SELECT count(*)::int AS n FROM mapon_zona_evento WHERE ocurrido_at > now() - interval '60 days'`);
    return r.rows[0].n > 0;
  } catch (_) { return false; }
}

/** El nombre de quien emite el informe. */
async function usuarioNombre(id) {
  if (!id) return null;
  const r = await db.consulta(
    `SELECT NULLIF(btrim(COALESCE(nombre, '') || ' ' || COALESCE(NULLIF(apellidos, '.'), '')), '') AS n FROM usuario WHERE id = $1`, [id]);
  return r.rows[0] ? r.rows[0].n : null;
}

module.exports = { persona, tramos, regla, hayZonas, usuarioNombre };
