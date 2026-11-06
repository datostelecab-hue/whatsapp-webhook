// ============================================================
// BARCELONA · LAS REGLAS DEL PLAN — quién trabaja, quién libra y dónde hay hueco
// ============================================================
// Puro: no lee nada. El servicio le da lo que hay en la base (db/234) y aquí se
// decide, día a día, qué pasa en cada plaza.
//
// Camilo, 06/11/2026: «ahora necesito agregarle días de libranzas desde el
// planificador… no sé todavía si habrá o no CT allá pero actívalo de una vez,
// por defecto todos deben de venir con los CT desactivados». Y: «Prácticamente
// será el mismo diseño de Madrid, solo que la arquitectura y flujo de datos
// cambia ya que no tenemos lo mismo».
//
// LAS REGLAS SON LAS DE MADRID (f_cobertura con db/203), escritas en JS porque
// Barcelona no tiene f_cobertura ni plazas ni fichas:
//
//   · Un coche CON CT tiene UN descanso, el del coche entero (el bloque): sus
//     dos fijos libran esos días y su CT los cubre.
//   · Un coche SIN CT (lo de por defecto) tiene el descanso de cada fijo: cada
//     uno libra lo suyo y nadie lo cubre. Ese turno, ese día, el coche NO SALE,
//     y es lo planificado: no es un hueco («Lo que no es un hueco», Coches sin
//     correturnos.md).
//   · Un fijo trabaja todos los días menos los que libra su plaza.
//   · Un CT trabaja solo los días de la semana que cubre en ESA matrícula, y
//     solo mientras el coche tiene CT.
//
// Esto es lo que tienen que leer TODOS los que preguntan «¿a quién le tocaba?»:
// el tablero, el reparto de horas por turno (barcelona.horas.planDesde), el
// reporte diario, el semanal y la Visibilidad. Antes leían las asignaciones en
// crudo (asignacionesEn): con libranzas, eso daría «No salió» a quien libraba.
//
// Las fechas son 'AAAA-MM-DD' y se comparan como texto (sin Date: un DATE de la
// base pasado por toISOString da el día anterior en Madrid, Trampas conocidas).

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** ISODOW (1 = lunes … 7 = domingo) de un 'AAAA-MM-DD', sin la zona horaria local. */
function isodow(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** ¿Vale ese día? desde ≤ día ≤ hasta (sin hasta, para siempre). */
const vigente = (x, dia) => !!x && x.desde <= dia && (!x.hasta || x.hasta >= dia);

/** Unos días de la semana limpios: números 1..7, sin repetir y en orden. */
const limpiarDias = dias => [...new Set((Array.isArray(dias) ? dias : []).map(Number)
  .filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);

/** «L M» de [1, 2]. */
const letras = dias => limpiarDias(dias).map(d => LETRAS[d - 1]).join(' ');

/**
 * LAS REGLAS DE UN PLAN. Recibe lo que hay en la base para las fechas que se
 * miran (con cualquier cosa de más: se filtra por fecha):
 *
 *   asignaciones  [{ id, matricula, turno, uuid, rol ('fijo'|'ct'), dias, desde, hasta }]
 *                 (sede_asignacion; sin `rol`, es un fijo, como antes de db/234)
 *   cts           [{ matricula, desde, hasta }]  los periodos CON correturnos (sede_coche_ct)
 *   descansos     [{ matricula, turno (null|'dia'|'noche'), dias, desde, hasta }]  (sede_descanso)
 *
 * Devuelve las funciones con las que se pregunta, todas de un día concreto.
 */
function crear({ asignaciones = [], cts = [], descansos = [] } = {}) {
  const porMat = (lista, limpiar) => {
    const m = new Map();
    (lista || []).forEach(x => {
      if (!x || !x.matricula) return;
      if (!m.has(x.matricula)) m.set(x.matricula, []);
      m.get(x.matricula).push(limpiar(x));
    });
    return m;
  };
  const asigs = (asignaciones || []).filter(a => a && a.uuid && a.matricula).map(a => ({
    ...a, rol: a.rol === 'ct' ? 'ct' : 'fijo', dias: a.rol === 'ct' ? limpiarDias(a.dias) : null,
  }));
  const ctDe = porMat(cts, x => ({ desde: x.desde, hasta: x.hasta || null }));
  const descDe = porMat(descansos, x => ({ turno: x.turno || null, dias: limpiarDias(x.dias), desde: x.desde, hasta: x.hasta || null }));

  /** El periodo con CT que cubre ese día, o null. */
  const periodoCT = (matricula, dia) => (ctDe.get(matricula) || []).find(p => vigente(p, dia)) || null;
  /** ¿Lleva correturnos el coche ese día? Sin periodo, no (lo de por defecto). */
  const conCT = (matricula, dia) => !!periodoCT(matricula, dia);

  /** El descanso vigente de ese tipo (null = el común; 'dia'/'noche' = el de ese fijo). */
  const descansoVigente = (matricula, turno, dia) =>
    (descDe.get(matricula) || []).find(d => d.turno === (turno || null) && vigente(d, dia)) || null;

  /**
   * LOS DÍAS QUE LIBRA EL FIJO DE ESE TURNO esa semana: con CT, los del bloque
   * (el descanso común); sin CT, los del descanso de su turno. El otro tipo de
   * descanso no cuenta aunque quedara escrito: es lo que decide el CT.
   */
  const descansoDe = (matricula, turno, dia) => {
    const d = descansoVigente(matricula, conCT(matricula, dia) ? null : turno, dia);
    return d ? d.dias.slice() : [];
  };

  /** ¿Libra ese día? Solo un fijo libra: el CT no trabaja los días que no cubre, que no es librar. */
  const libra = (a, dia) => !!a && a.rol !== 'ct' && vigente(a, dia)
    && descansoDe(a.matricula, a.turno, dia).includes(isodow(dia));

  /** ¿Trabaja ese día? El fijo, si no libra; el CT, si el coche lleva CT y es uno de sus días. */
  const trabaja = (a, dia) => {
    if (!a || !vigente(a, dia)) return false;
    if (a.rol === 'ct') return conCT(a.matricula, dia) && (a.dias || []).includes(isodow(dia));
    return !libra(a, dia);
  };

  /**
   * ¿SALE EL COCHE ESE TURNO? Sin CT, el día que libra el fijo de ese turno el
   * coche no sale: es lo planificado, no un hueco. Con CT siempre sale: el día
   * del bloque lo cubre el CT (y si no hay CT, ESO es el hueco).
   */
  const turnoDelCoche = (matricula, turno, dia) => {
    if (conCT(matricula, dia)) return 'sale';
    return descansoDe(matricula, turno, dia).includes(isodow(dia)) ? 'libra' : 'sale';
  };

  /** Las asignaciones vigentes de una plaza (matrícula + turno + rol) ese día. */
  const enLaPlaza = (matricula, turno, rol, dia) =>
    asigs.filter(a => a.matricula === matricula && a.turno === turno && a.rol === rol && vigente(a, dia));

  /** Quién lleva ese coche y turno ese día: el fijo si no libra; si libra, el CT si cubre ese día. */
  const quienCubre = (matricula, turno, dia) =>
    enLaPlaza(matricula, turno, 'fijo', dia).find(a => trabaja(a, dia))
    || enLaPlaza(matricula, turno, 'ct', dia).find(a => trabaja(a, dia))
    || null;

  /** Lo que pinta el tablero en cada turno: 'trabaja' | 'libra' | 'hueco'. */
  const estadoDelTurno = (matricula, turno, dia) => {
    if (turnoDelCoche(matricula, turno, dia) === 'libra') return 'libra';
    return quienCubre(matricula, turno, dia) ? 'trabaja' : 'hueco';
  };

  /** LAS ASIGNACIONES QUE TRABAJAN ESE DÍA: el plan de verdad de ese día. */
  const planDelDia = dia => asigs.filter(a => trabaja(a, dia));

  /** Las vigentes ese día, trabajen o no (para pintar las plazas). */
  const vigentesEn = dia => asigs.filter(a => vigente(a, dia));

  return {
    asignaciones: asigs, conCT, periodoCT, descansoDe, descansoVigente, libra, trabaja,
    turnoDelCoche, quienCubre, estadoDelTurno, planDelDia, vigentesEn,
  };
}

/**
 * ¿CHOCA ALGUIEN CONSIGO MISMO? Los días de la semana (los siete desde `desde`)
 * en que una asignación nueva trabajaría a la vez que otra suya del MISMO
 * turno: una persona no lleva dos coches a la vez. Es la regla de Madrid
 * (comprobarPlan: «trabajar en su libranza sí vale —un correturnos vive de
 * eso—; lo que no vale es doblar»), reducida al mismo turno, que es lo que
 * Barcelona deja hacer hoy: un fijo de día y uno de noche a la vez sí se puede.
 *
 *   datos     lo de la base para esos siete días (como `crear`)
 *   nueva     { matricula, turno, uuid, rol, dias, desde, hasta? }  `hasta`, si
 *             ya se sabe que no llegará más allá (el fin del periodo con CT, o
 *             la víspera de lo que ya hay escrito para después): esos días no
 *             los trabaja aquí y no chocan
 *   apartar   (a) → true para las suyas que se van a cerrar al guardar (la
 *             plaza que se sustituye, o la fija que se mueve): esas no chocan
 *
 * Devuelve [{ matricula, rol, dias: [ISODOW] }] con cada choque, o [].
 */
function choques(datos, nueva, apartar = () => false) {
  const otras = (datos.asignaciones || []).filter(a => a && a.uuid === nueva.uuid && a.turno === nueva.turno && !apartar(a));
  const reglas = crear({ ...datos, asignaciones: [...otras, { ...nueva, hasta: nueva.hasta || null, id: '__nueva__' }] });
  const nuevaR = reglas.asignaciones.find(a => a.id === '__nueva__');
  const out = new Map();
  for (let i = 0; i < 7; i++) {
    const dia = sumarDias(nueva.desde, i);
    if (!reglas.trabaja(nuevaR, dia)) continue;
    reglas.asignaciones.filter(a => a !== nuevaR && reglas.trabaja(a, dia)).forEach(a => {
      const k = `${a.matricula}|${a.rol}`;
      if (!out.has(k)) out.set(k, { matricula: a.matricula, rol: a.rol, dias: [] });
      out.get(k).dias.push(isodow(dia));
    });
  }
  return [...out.values()].map(x => ({ ...x, dias: limpiarDias(x.dias) }));
}

/** Una fecha 'AAAA-MM-DD' más n días, recorriendo el calendario (a prueba del cambio de hora). */
function sumarDias(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { LETRAS, isodow, limpiarDias, letras, crear, choques };
