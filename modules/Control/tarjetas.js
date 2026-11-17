// ============================================================
// LAS J Y LAS −J EN EL TABLERO (ítem 1, entrega 1c)
// ============================================================
// Cada J pendiente tiene su tarjeta, a nombre de quien lleva las J de su tipo
// (funciones de Organización j_trafico, j_bolt, j_companero, j_taller y j_rrhh:
// Camilo, 16/11/2026, «por tipo, como hoy»), con el plazo de las colas. Cada −J
// pendiente, a quien tiene «menos_j». Aprobarla o rechazarla, venga de donde
// venga (/justificantes, la bitácora, Control), cierra la tarjeta; una J
// aprobada que se edita vuelve a pendiente y reabre la suya.
//
// El repaso lo hace services/tableroColas.js: aquí solo se dice qué espera y
// cómo acabó lo que ya no. Los repos avisan de cada cambio (`avisarCambios`).
'use strict';

const db = require('../../services/db');
const colas = require('../../services/tableroColas');
const repoJ = require('../../services/repo/justificantes');
const menosJ = require('../../services/repo/menosJ');

const ETIQUETA_J = Object.fromEntries(repoJ.TIPOS_J.map(t => [t.codigo, t.etiqueta]));
const TOPE = 1000;

/** Cómo acabaron (aprobadas o no) las de una tabla con aprobado_* y anulado_*. */
async function comoAcabaron(tabla, ids, que) {
  const r = await db.consulta(
    `SELECT id::text AS id, aprobado_at, aprobado_por, anulado_at, anulado_por, anulado_motivo
       FROM ${tabla} WHERE id = ANY($1::bigint[])`, [ids.map(Number)]);
  const m = new Map();
  for (const x of r.rows) {
    if (x.anulado_at) m.set(x.id, { autorId: x.anulado_por || null, nota: `${que} no se aprobó${x.anulado_motivo ? ': ' + x.anulado_motivo : ''}` });
    else if (x.aprobado_at) m.set(x.id, { autorId: x.aprobado_por || null, nota: `${que} aprobada` });
  }
  return m;
}

colas.registrar('j', {
  etiqueta: 'J por aprobar',
  abrir: 'Abrir la J',
  async abiertas() {
    const r = await db.consulta(
      `SELECT j.id::text AS id, j.tipo, j.usuario_id, to_char(j.dia_operativo, 'YYYY-MM-DD') AS dia,
              to_char(j.dia_operativo, 'DD/MM') AS dia_corto,
              NULLIF(btrim(concat_ws(' ', c.nombre, c.apellidos)), '') AS conductor
         FROM justificante j JOIN conductor c ON c.id = j.conductor_id
        WHERE j.aprobado_at IS NULL AND j.anulado_at IS NULL
        ORDER BY j.id LIMIT ${TOPE}`);
    return r.rows.map(x => ({
      origenId: x.id, reparto: x.tipo, creadaPor: x.usuario_id,
      titulo: `J ${ETIQUETA_J[x.tipo] || x.tipo} · ${x.conductor || 'Sin nombre'} · ${x.dia_corto}`,
      enlace: `/justificantes?tipo=${encodeURIComponent(x.tipo)}&dia=${x.dia}`,
    }));
  },
  responsable: it => colas.titularDe(`j_${it.reparto}`).catch(() => null),
  comoAcabaron: ids => comoAcabaron('justificante', ids, 'J'),
});

colas.registrar('menos_j', {
  etiqueta: '−J por aprobar',
  abrir: 'Abrir la −J',
  async abiertas() {
    const r = await db.consulta(
      `SELECT m.id::text AS id, m.usuario_id, to_char(m.dia_operativo, 'YYYY-MM-DD') AS dia,
              to_char(m.dia_operativo, 'DD/MM') AS dia_corto,
              NULLIF(btrim(concat_ws(' ', c.nombre, c.apellidos)), '') AS conductor
         FROM menos_j m JOIN conductor c ON c.id = m.conductor_id
        WHERE m.aprobado_at IS NULL AND m.anulado_at IS NULL
        ORDER BY m.id LIMIT ${TOPE}`);
    return r.rows.map(x => ({
      origenId: x.id, creadaPor: x.usuario_id,
      titulo: `−J · ${x.conductor || 'Sin nombre'} · ${x.dia_corto}`,
      enlace: `/justificantes?tipo=menos_j&dia=${x.dia}`,
    }));
  },
  responsable: () => colas.titularDe('menos_j').catch(() => null),
  comoAcabaron: ids => comoAcabaron('menos_j', ids, '−J'),
});

// Cada cambio en las J o en las −J pide un repaso de su cola.
repoJ.avisarCambios(() => { colas.pedir('j'); });
menosJ.avisarCambios(() => { colas.pedir('menos_j'); });

module.exports = { ETIQUETA_J };
