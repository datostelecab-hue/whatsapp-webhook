// ============================================================
// JORNADA SEMANAL · REPOSITORIO — los contratos que tocan una semana
// ============================================================
// El informe semanal es de la PLANTILLA PROPIA y se reparte por JORNADA: las
// dos cosas viven en el periodo de empleo (`conductor_periodo_empleo.tipo` y
// `.jornada_horas`), no en la ficha, porque una persona puede entrar por la
// ETT y pasar luego a propia, o cambiar de 32 a 40 horas al renovar.
//
// Por eso se mira el periodo QUE TOCA ESA SEMANA, y si hay dos (se fue y
// volvió, o pasó de la ETT a propia a mitad de semana), el más reciente: es el
// contrato con el que acabó la semana.
//
// Las horas NO salen de aquí: salen de la rejilla de la Bitácora, que ya las
// tiene resueltas con la misma regla que todo lo demás (ver el servicio).

const db = require('../../services/db');

/**
 * El periodo de empleo de cada conductor que toca la semana [lunes, domingo].
 * @returns {Promise<Map<number, {tipo: string, jornada: number|null, alta: string, baja: string|null}>>}
 */
async function contratosDeLaSemana(lunesIso, domingoIso) {
  // Fechas como TEXTO: node-postgres devuelve DATE en zona local y desplaza un día.
  const { rows } = await db.consulta(
    `SELECT DISTINCT ON (p.conductor_id)
            p.conductor_id, p.tipo, p.jornada_horas,
            to_char(p.alta, 'YYYY-MM-DD') AS alta,
            to_char(p.baja, 'YYYY-MM-DD') AS baja
       FROM conductor_periodo_empleo p
      WHERE p.alta <= $2::date
        AND (p.baja IS NULL OR p.baja >= $1::date)
      ORDER BY p.conductor_id, p.alta DESC`,
    [lunesIso, domingoIso]);
  return new Map(rows.map(r => [Number(r.conductor_id), {
    tipo: r.tipo,
    jornada: r.jornada_horas == null ? null : Number(r.jornada_horas),
    alta: r.alta,
    baja: r.baja || null,
  }]));
}

module.exports = { contratosDeLaSemana };
