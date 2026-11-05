// ============================================================
// LA JORNADA DE UN CONTRATO: horas y modalidad (40x5 / 40x4)
// ============================================================
// Un contrato tiene horas semanales (`jornada_horas`). Las de 40 horas tienen
// además una MODALIDAD: en cuántos días se reparten.
//
//   40x5 → 40 horas en 5 días. Es la de por defecto de todo contrato de 40 h.
//   40x4 → 40 horas en 4 días (10 h al día). Para correturnos de 4 días.
//
// Las demás jornadas (18…35, 32…) no tienen modalidad: `dias` va a null.
//
// Todo lo que llega del desplegable, del alta o de la ETT pasa por aquí: el
// valor que se elige es un texto («40», «40x5», «40x4», «32»), y la base guarda
// dos columnas (`jornada_horas`, `jornada_dias`). Así no hay dos formas de
// escribir lo mismo.

const TOPE_HORAS = 40;               // el máximo legal de la jornada ordinaria
const DIAS_40 = [5, 4];              // las modalidades de 40 horas; la primera, por defecto
const HORAS_SIN_MODALIDAD = [18, 20, 21, 24, 25, 27, 29, 30, 32, 35];

/**
 * Lee un valor de jornada y devuelve { horas, dias }. Lanza si no vale.
 *   '40' / 40      → { horas: 40, dias: 5 }   (40 sin modalidad es 40x5)
 *   '40x4'         → { horas: 40, dias: 4 }
 *   '32' / 32      → { horas: 32, dias: null }
 *   null / ''      → { horas: null, dias: null }
 */
function parseJornada(valor) {
  if (valor == null || String(valor).trim() === '') return { horas: null, dias: null };
  const s = String(valor).trim().toLowerCase();
  const m = /^(\d+)\s*x\s*(\d)$/.exec(s);
  const horas = m ? Number(m[1]) : Number(s);
  let dias = m ? Number(m[2]) : null;
  if (!Number.isInteger(horas) || horas < 1 || horas > TOPE_HORAS) {
    throw new Error(`Esa jornada no vale: tienen que ser horas enteras, de 1 a ${TOPE_HORAS}.`);
  }
  if (horas === TOPE_HORAS) {
    if (dias == null) dias = DIAS_40[0];
    if (!DIAS_40.includes(dias)) throw new Error('La modalidad de 40 horas es 40x5 o 40x4.');
  } else if (dias != null) {
    throw new Error('Solo las jornadas de 40 horas tienen modalidad (40x5 o 40x4).');
  }
  return { horas, dias };
}

/**
 * El texto que se muestra y se devuelve al desplegable: «40x4», «40x5», «32».
 * Recibe las dos columnas de la base. Un 40 sin modalidad (contratos anteriores
 * a db/229) se lee como 40x5, que es lo que se le aplicó por defecto.
 */
function valorJornada(horas, dias) {
  if (horas == null) return '';
  const h = Number(horas);
  if (h === TOPE_HORAS) return `40x${dias ? Number(dias) : DIAS_40[0]}`;
  return String(h);
}

/** Las opciones del desplegable, en su orden: las horas habituales y luego 40x5 y 40x4. */
const OPCIONES_JORNADA = [
  ...HORAS_SIN_MODALIDAD.map(h => ({ valor: String(h), texto: h + ' horas' })),
  ...DIAS_40.map(d => ({ valor: `40x${d}`, texto: `40x${d}` })),
];

/**
 * Los días que tiene que trabajar un correturno con este contrato (lo que lee el
 * planificador). 40x4 son 4 días; el resto sigue lo que diga el catálogo
 * (`cat_jornada.dias_ct`: 32 h → 4, 40 h → 6).
 *
 * PENDIENTE DE DECIDIR (5/11/2026): un 40x5 de correturno hoy cuenta 6 días en
 * el catálogo, y 40x5 quiere decir 5. Cambiarlo cambia lo que hay que cubrir
 * de todos los correturnos de 40 h. Hasta que se decida, no se toca aquí.
 */
function diasDeCt(horas, dias, diasCatalogo) {
  if (Number(horas) === TOPE_HORAS && Number(dias) === 4) return 4;
  return diasCatalogo == null ? null : Number(diasCatalogo);
}

module.exports = {
  TOPE_HORAS, DIAS_40, HORAS_SIN_MODALIDAD, OPCIONES_JORNADA,
  parseJornada, valorJornada, diasDeCt,
};
