// ============================================================
// VACACIONES — ¿LE TOCABA TRABAJAR ESE DÍA? (las libranzas, día a día)
// ============================================================
// Camilo, 06/11/2026: «las libranzas que tenga se mantienen en las vacaciones.
// Entonces, si pido 18 días de vacaciones, me tiene que contar solo días
// laborales para mí, se saltan los días de libranza … Una cosa importante de las
// libranzas es que siempre se mantienen: si se planifica un fijo para L M eso se
// va a ver siempre hasta que se cambie en el planificador».
//
// Un día de vacaciones solo cuenta si ese día le tocaba trabajar. La regla es la
// del cuadrante, la de `f_cobertura` (db/203), menos lo que aparta a quien está
// ausente —justo esos son los días que se miran aquí—:
//   · un FIJO trabaja salvo los días de descanso de su coche (el común o el de
//     su turno, `vehiculo_descanso`);
//   · un CORRETURNOS trabaja los días que le pusieron (`asignacion_dia`);
//   · con dos plazas a la vez, trabaja si alguna lo dice;
//   · la libranza excepcional manda sobre todo: libra su `dia_libra` y trabaja
//     su `dia_trabaja`.
// Unas vacaciones no le quitan la plaza (db/57: el cuadrante solo le aparta esos
// días), así que se mira la plaza que tenía ese día. Si ese día no tiene
// ninguna —se la quitaron para cubrirle, o el día aún no está planificado—, LA
// ÚLTIMA QUE TUVO: lo planificado se mantiene hasta que se cambie. Y si aún no ha
// tenido ninguna, la primera que tenga. Igual con el descanso de su coche.
//
// LO QUE NO SE SABE. El planificador empieza en la base el 03/09/2026: antes no
// hay libranzas que saltar y el día cuenta (como contaba siempre). Quien no ha
// tenido nunca plaza, tampoco: cuenta el día. Esos días salen marcados.
//
// Pura: entra el plan de una persona (vacaciones.repo.planes) y un día.

const FIN = '9999-12-31';
const isodow = dia => { const w = new Date(dia + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const vigente = (x, dia) => x.desde <= dia && (x.hasta || FIN) >= dia;

/**
 * De una lista con { desde, hasta }, las que valen ese día; si ninguna, las
 * últimas que acabaron antes (lo de entonces se mantiene) y, si no hay, las
 * primeras que empiecen después.
 */
function lasDeEseDia(lista, dia) {
  const hoy = lista.filter(x => vigente(x, dia));
  if (hoy.length) return { lista: hoy, persiste: false };
  const antes = lista.filter(x => x.hasta && x.hasta < dia);
  if (antes.length) {
    const ult = antes.reduce((m, x) => (x.hasta > m ? x.hasta : m), '');
    return { lista: antes.filter(x => x.hasta === ult), persiste: true };
  }
  const despues = lista.filter(x => x.desde > dia);
  if (!despues.length) return { lista: [], persiste: false };
  const pri = despues.reduce((m, x) => (x.desde < m ? x.desde : m), FIN);
  return { lista: despues.filter(x => x.desde === pri), persiste: true };
}

/** ¿Trabaja con esta plaza ese día? */
function trabajaCon(a, dia, descansos) {
  const dow = isodow(dia);
  if (a.rol === 'CT') return (a.dias || []).includes(dow);
  const del = (descansos.get(String(a.vehiculo_id)) || []).filter(d => d.turno_id == null || Number(d.turno_id) === Number(a.turno_id));
  const { lista } = lasDeEseDia(del, dia);
  return !lista.some(d => (d.dias || []).includes(dow));
}

/**
 * Qué le tocaba ese día: { trabaja: true | false | null, por }.
 *   por: 'plaza' | 'su-ultima-plaza' | 'excepcional' | 'antes-del-cuadrante' | 'sin-plaza'
 * `trabaja: null` es que no se sabe (y el día de vacaciones cuenta).
 *
 *   plan  { asignaciones: [{ desde, hasta, rol, turno_id, vehiculo_id, dias }],
 *           descansos: Map(vehiculo_id → [{ turno_id, desde, hasta, dias }]),
 *           libra: Set(días), trabaja: Set(días) }   (los de libranza_excepcional)
 *   inicio  el primer día del planificador en la base
 */
function elDia(plan, dia, inicio) {
  if (plan.libra && plan.libra.has(dia)) return { trabaja: false, por: 'excepcional' };
  if (plan.trabaja && plan.trabaja.has(dia)) return { trabaja: true, por: 'excepcional' };
  if (!plan.asignaciones || !plan.asignaciones.length) return { trabaja: null, por: 'sin-plaza' };
  if (inicio && dia < inicio) return { trabaja: null, por: 'antes-del-cuadrante' };
  const { lista, persiste } = lasDeEseDia(plan.asignaciones, dia);
  return { trabaja: lista.some(a => trabajaCon(a, dia, plan.descansos || new Map())), por: persiste ? 'su-ultima-plaza' : 'plaza' };
}

/** Un día de vacaciones cuenta salvo que ese día librara. */
const cuenta = x => !x || x.trabaja !== false;

// ── LOS DOS DÍAS QUE LIBRA EN SUS VACACIONES, A MANO (06/11/2026, db/233) ────
// Camilo: «Angel Lopez Gomez descansa según el planificador solo un día, pero le
// tenemos que saltar dos días los cuales lo elegirá Laura. Sí o sí tienen que
// ser dos días obligatoriamente … solo es por el periodo de vacaciones: cuando
// vuelva debe de tener de nuevo los días de libranza que le pone el
// planificador». Unas vacaciones nuevas llevan sus dos días (1 = lunes … 7 =
// domingo); dentro del tramo, esos días no cuentan y los demás sí. Las de antes
// no los tienen y cuentan con `elDia`.
const NOMBRE_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/**
 * Los dos días que libra en unas vacaciones, ordenados: exactamente dos,
 * distintos, de 1 a 7. Admite [3, 4] o '3,4'. Lanza con el porqué.
 */
function dosDiasLibra(v) {
  const lista = (Array.isArray(v) ? v : String(v == null ? '' : v).split(','))
    .map(x => String(x).trim()).filter(Boolean).map(Number);
  const unicos = [...new Set(lista)];
  if (lista.length !== 2 || unicos.length !== 2 || unicos.some(n => !Number.isInteger(n) || n < 1 || n > 7)) {
    throw new Error('Elige los dos días que libra durante las vacaciones: siempre son dos, distintos.');
  }
  return unicos.sort((a, b) => a - b);
}

/** ¿Cuenta este día de unas vacaciones con sus dos días a mano? */
const cuentaConLibra = (libra, dia) => !libra.includes(isodow(dia));

/**
 * Lo que dice el planificador de una semana a partir de `desde`: los días que
 * libraría (1–7). Para proponerlos al elegir los dos a mano; si no se sabe (sin
 * plaza, antes del planificador), ninguno. `queTocaba` = día → `elDia(...)`.
 */
function libraSegunPlanificador(queTocaba, desde) {
  if (!queTocaba) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(desde + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const x = queTocaba(d);
    if (x && x.trabaja === false) out.push(isodow(d));
  }
  return out.sort((a, b) => a - b);
}

/** 'miércoles y jueves' */
const nombresDias = dias => {
  const n = (dias || []).map(d => NOMBRE_DIA[d - 1]).filter(Boolean);
  return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n.at(-1) : (n[0] || '');
};

module.exports = { elDia, cuenta, isodow, dosDiasLibra, cuentaConLibra, libraSegunPlanificador, nombresDias, _lasDeEseDia: lasDeEseDia };
