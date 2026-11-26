// ============================================================
// LA COMUNICACIÓN SEMANAL DE HORAS — la cuenta (pura) (db/294, 25/11/2026)
// ============================================================
// Camilo: «siempre es cuando el trabajador no cumple con las horas que debe de
// hacer en la semana: si faltó un día, pero hizo 41 horas en la semana, pues
// está bien, nada de carta». «Siempre son 8, pero se las mandamos con ausencias
// y horas que quedó debiendo por días».
//
//   · La semana va de lunes a domingo. Camilo (25/11/2026): «si tenía que
//     trabajar 8 horas, entonces debió de hacer 32 horas si tenía planificado
//     4 días para salir y 3 de descanso, sin importar el contrato». Se le piden
//     8 h por cada día que le tocaba trabajar: los días con contrato que no son
//     libranza, ni vacaciones, baja o permiso, ni una situación sin marca
//     (suspensión…), ni sin plaza en el planificador, ni que RR. HH. dio por
//     JUSTIFICADO en Ausencias. Lo que el cuadrante no le dio no se le pide.
//   · Hizo: las horas de la bitácora (BOLT de su turno + las J APROBADAS), la
//     misma cuenta del promedio de horas de la casa.
//   · Debe = lo pedido − lo hecho. Por debajo de 2 h no hay carta (Camilo).
//   · Los días de la carta: cada «Ausencia» (8 h) y cada día trabajado con
//     menos de 8 h (lo que le faltó). El total es lo que debe en la semana (lo
//     que se descuenta): un día largo compensa uno corto.
'use strict';

const HORAS_DIA = 8;
/** Por debajo de esto, no hay carta (Camilo, 25/11/2026: «2 horas»). */
const MINIMO = 2;
const r1 = n => Math.round(n * 10) / 10;
const NO_SE_PIDE = new Set(['V', 'B', 'P']);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'AAAA-MM-DD' → «5 de noviembre de 2026». */
const diaLargo = iso => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
/** 5.3 → «5,3». */
const coma = n => String(r1(n)).replace('.', ',');

/**
 * La semana de una persona. `dias`: los 7 de la bitácora (`bitacora.diasDe`);
 * `alta`/`baja`: su contrato propio; `justificadas`: Set de días que RR. HH.
 * dio por justificados. → { objetivo, horas, debe, carta, lineas: [{ dia, tipo, horas, debe }] }
 * `carta`: debe al menos el mínimo.
 */
function calcular({ dias = [], alta, baja = null, justificadas = new Set() }) {
  const enContrato = dias.filter(d => !d.fuera && d.dia >= alta && (!baja || d.dia <= baja));
  // Un día en que trabajó (horas en la bitácora) cuenta como trabajado, caiga en
  // lo que caiga (una suspensión que empieza ese día, un justificado con su J):
  // no se le pedía y además sumaba sus horas (26/11/2026, el caso de Jeisson Hoyos).
  const libre = d => d.clase !== 'trabajado' && (NO_SE_PIDE.has(d.marca) || d.situacion || d.sinPlaza || justificadas.has(d.dia));
  // Le tocaba trabajar: la bitácora dice «trabajado» o «ausencia» (libranzas y
  // días fuera de plan salen sin clase).
  const deTrabajo = enContrato.filter(d => !libre(d) && (d.clase === 'trabajado' || d.clase === 'ausencia'));
  const objetivo = deTrabajo.length * HORAS_DIA;
  const horas = enContrato.reduce((s, d) => s + (Number(d.horas) || 0), 0);
  const debe = r1(Math.max(0, objetivo - horas));
  const lineas = [];
  if (debe > 0) {
    for (const d of deTrabajo) {
      if (d.clase === 'ausencia') lineas.push({ dia: d.dia, tipo: 'ausencia', horas: 0, debe: HORAS_DIA });
      else if (d.horas < HORAS_DIA) lineas.push({ dia: d.dia, tipo: 'menos', horas: r1(d.horas), debe: r1(HORAS_DIA - d.horas) });
    }
  }
  return { objetivo: r1(objetivo), horas: r1(horas), debe, carta: debe >= MINIMO, dias: deTrabajo.length, lineas };
}

/** Lo que va en los huecos de la plantilla de YouTrust: los días y el total. */
function textos(c) {
  return {
    incidencias: c.lineas.map(l => `• ${diaLargo(l.dia)} – ${coma(l.debe)} horas`).join('\n'),
    total: `${coma(c.debe)} h`,
  };
}

/** El lunes de la semana de un día, y el domingo. */
function semanaDe(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;   // 0 = lunes
  const lunes = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  const domingo = new Date(d.getTime() + (6 - dow) * 86400000).toISOString().slice(0, 10);
  return { lunes, domingo };
}

module.exports = { calcular, textos, semanaDe, diaLargo, coma, HORAS_DIA, MINIMO };
