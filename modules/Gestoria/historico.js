// ============================================================
// EL HISTÓRICO DE LA NÓMINA DE UNA PERSONA, MES A MES (plan de RR. HH., 4.7, 26/11/2026)
// ============================================================
// El encargo, del panel ejecutivo: «histórico consultable por conductor y mes».
// Aquí no se calcula nada: se junta, por mes de nómina, lo que ya guarda cada
// pieza del ERP:
//   · LA PROFORMA de A3 (db/296): su bruto, líquido, días cotizados e IT, de la
//     última proforma cargada de ese mes (se guarda la cifra de cada trabajador
//     desde el 26/11/2026; las de antes, al volver a cruzarlas).
//   · LAS VARIABLES para A3 (db/300): las líneas vivas del mes, con su concepto.
//   · LOS DESCUENTOS (db/298): lo que de verdad se descontó ese mes.
// Sale en el expediente del conductor (ficha de Plantilla) con la llave de Gestoría.
'use strict';

const db = require('../../services/db');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = p => `${MESES[Number(p.slice(5, 7)) - 1]} de ${p.slice(0, 4)}`;
const existe = async t => (await db.consulta(`SELECT to_regclass($1) IS NOT NULL AS hay`, [`public.${t}`])).rows[0].hay;

/** Los últimos `meses` meses de nómina con algo de esa persona, del más nuevo al más viejo. */
async function deConductor(conductorId, meses = 12) {
  const id = Number(conductorId);
  const c = (await db.consulta(`SELECT legajo FROM conductor WHERE id = $1`, [id])).rows[0];
  if (!c) return [];
  const porMes = new Map();
  const mes = p => {
    if (!porMes.has(p)) porMes.set(p, { periodo: p, mes: mesDe(p), proforma: null, variables: { pagar: 0, descontar: 0, lineas: [] }, descuentos: [] });
    return porMes.get(p);
  };

  if (c.legajo && await existe('fichero_importado')) {
    const r = await db.consulta(
      `SELECT DISTINCT ON (f.periodo) f.periodo, t.x
         FROM fichero_importado f
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.resultado -> 'trabajadores', '[]'::jsonb)) AS t(x)
        WHERE f.tipo = 'proforma_a3' AND f.estado = 'cargado' AND f.periodo IS NOT NULL AND t.x ->> 'legajo' = $1
        ORDER BY f.periodo DESC, f.id DESC LIMIT $2`, [c.legajo, meses]);
    for (const x of r.rows) {
      mes(x.periodo).proforma = { bruto: Number(x.x.bruto) || 0, liquido: Number(x.x.liquido) || 0, dias: Number(x.x.dias) || 0, it: Number(x.x.it) || 0 };
    }
  }
  if (await existe('nomina_linea')) {
    const r = await db.consulta(
      `SELECT l.periodo, l.concepto, k.nombre, k.tipo, sum(l.importe)::float AS importe
         FROM nomina_linea l JOIN nomina_concepto k ON k.codigo = l.concepto
        WHERE l.conductor_id = $1 AND l.anulado_at IS NULL
        GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2`, [id]);
    for (const x of r.rows) {
      const m = mes(x.periodo);
      m.variables.lineas.push({ concepto: x.concepto, nombre: x.nombre, tipo: x.tipo, importe: x.importe });
      if (x.tipo === 'deduccion') m.variables.descontar += x.importe; else m.variables.pagar += x.importe;
    }
  }
  if (await existe('descuento_aplicacion')) {
    const { ORIGENES } = require('../RRHH/descuentos.service');
    const r = await db.consulta(
      `SELECT a.periodo, d.origen, sum(a.importe)::float AS importe
         FROM descuento_aplicacion a JOIN descuento_nomina d ON d.id = a.descuento_id
        WHERE d.conductor_id = $1 GROUP BY 1, 2 ORDER BY 1 DESC, 2`, [id]);
    for (const x of r.rows) mes(x.periodo).descuentos.push({ origen: x.origen, etiqueta: (ORIGENES[x.origen] || {}).etiqueta || x.origen, importe: x.importe });
  }
  return [...porMes.values()].sort((a, b) => b.periodo.localeCompare(a.periodo)).slice(0, meses);
}

module.exports = { deConductor };
