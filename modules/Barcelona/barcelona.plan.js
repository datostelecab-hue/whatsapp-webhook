// ============================================================
// BARCELONA · LAS REGLAS DEL PLAN — quién trabaja, quién libra y dónde hay hueco
// ============================================================
// Puro: no lee nada. El servicio le da lo que hay en la base (db/234 y db/236)
// y aquí se decide, día a día, qué pasa en cada plaza.
//
// Camilo, 06/11/2026: «ahora necesito agregarle días de libranzas desde el
// planificador…». Y, el mismo día, la reconstrucción de los correturnos: «si
// los coches pertenecen a un cuadrante y tienen correturnos, los correturnos sí
// o sí van a ser una sola casilla cogiendo los coches que estén ahí, ojo,
// ninguna plaza se puede repetir, si el coche xxxx tiene como libranza el de
// día el L, no puede haber otro coche descansando de día el L ya que el
// correturno debe de coger las plazas que no se trabajan, por lo que no puede
// coger dos coches a la vez. […] El correturno puesto tendrá como día de
// libranza el día que no coja ninguno de los coches en el cuadrante.»
//
// LAS REGLAS (db/236):
//
//   · Las LIBRANZAS son de cada plaza (matrícula + turno, sede_descanso): cada
//     fijo libra lo suyo. Un fijo trabaja todos los días menos esos.
//   · El CT es una CASILLA DEL CUADRANTE (sede_cuadrante_ct), por jornada: la
//     de 'dia' coge, cada día, la plaza de día del coche del cuadrante cuyo fijo
//     libra ese día; la de 'noche', igual de noche; la 'todoturno', las de día y
//     las de noche juntas. Coge a TODOS los coches del cuadrante (Camilo: «el CT
//     cubre a todos»): los que estaban en él ESE día (la pertenencia tiene
//     historial, db/237). Su libranza son los días en que no coge nada: se calcula.
//   · Si el cuadrante NO tiene casilla de ese turno, el día que libra el fijo el
//     coche no sale: es lo planificado, no un hueco (Camilo: «si el cuadrante no
//     tiene CT de un turno, el día que libra el fijo de ese turno el coche no
//     sale»). Un coche sin cuadrante, igual: no lleva CT.
//   · HUECO = el turno tiene que salir y nadie lo lleva: sin fijo un día que su
//     plaza no libra, o una casilla vacía el día que le toca coger esa plaza.
//   · Ninguna plaza se repite: una casilla no coge dos plazas el mismo día. Lo
//     impiden las escrituras (plazasRepetidas); si aun así pasa (la conversión
//     de db/236), coge la primera y la otra queda en hueco: una persona no lleva
//     dos coches a la vez.
//
// LO DE ANTES DE db/236 sigue contando para los días de antes (cerrar y no
// borrar: el reporte de un día viejo tiene que seguir cuadrando). El descanso
// COMÚN del coche (turno NULL, el bloque) vale para los dos fijos si no hay uno
// de su turno, y las plazas de CT POR COCHE (rol 'ct' de sede_asignacion, con
// sus `dias`) trabajan sus días mientras el coche tuvo CT (sede_coche_ct). db/236
// las cierra la víspera de aplicarse y ya no entra ninguna nueva.
//
// Esto es lo que tienen que leer TODOS los que preguntan «¿a quién le tocaba?»:
// el tablero, el reparto de horas por turno (barcelona.horas.planDesde), el
// reporte diario, el semanal, el promedio y la Visibilidad.
//
// Las fechas son 'AAAA-MM-DD' y se comparan como texto (sin Date: un DATE de la
// base pasado por toISOString da el día anterior en Madrid, Trampas conocidas).

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const TURNOS = ['dia', 'noche'];
/** Las jornadas de una casilla de CT, en el orden en que se pintan. */
const JORNADAS = ['dia', 'noche', 'todoturno'];
/** Los turnos que coge una casilla de cada jornada. */
const TURNOS_DE = { dia: ['dia'], noche: ['noche'], todoturno: ['dia', 'noche'] };
const SEMANA = [1, 2, 3, 4, 5, 6, 7];

/** ISODOW (1 = lunes … 7 = domingo) de un 'AAAA-MM-DD', sin la zona horaria local. */
function isodow(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Una fecha 'AAAA-MM-DD' más n días, recorriendo el calendario (a prueba del cambio de hora). */
function sumarDias(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** ¿Vale ese día? desde ≤ día ≤ hasta (sin hasta, para siempre). */
const vigente = (x, dia) => !!x && x.desde <= dia && (!x.hasta || x.hasta >= dia);

/** Unos días de la semana limpios: números 1..7, sin repetir y en orden. */
const limpiarDias = dias => [...new Set((Array.isArray(dias) ? dias : []).map(Number)
  .filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);

/** «L M» de [1, 2]. */
const letras = dias => limpiarDias(dias).map(d => LETRAS[d - 1]).join(' ');

/** Plazas en orden: el día antes que la noche y, dentro, por matrícula. */
const porTurnoYMatricula = (a, b) => TURNOS.indexOf(a.turno) - TURNOS.indexOf(b.turno) || a.matricula.localeCompare(b.matricula);

/**
 * LAS REGLAS DE UN PLAN. Recibe lo que hay en la base para las fechas que se
 * miran (con cualquier cosa de más: se filtra por fecha):
 *
 *   asignaciones     [{ id, matricula, turno, uuid, rol, dias, desde, hasta }]
 *                    (sede_asignacion). Los fijos; sin `rol`, un fijo. Las de
 *                    rol 'ct' son las de antes de db/236 (histórico).
 *   casillas         [{ id, cuadranteId, jornada ('dia'|'noche'|'todoturno'),
 *                    uuid|null, desde, hasta }] (sede_cuadrante_ct): uuid null
 *                    es la casilla vacía.
 *   descansos        [{ matricula, turno ('dia'|'noche'; null = el común de
 *                    antes de db/236), dias, desde, hasta }] (sede_descanso)
 *   cochesCuadrante  [{ matricula, cuadranteId, desde?, hasta? }] en qué
 *                    cuadrante estuvo cada coche y cuándo (sede_coche_cuadrante,
 *                    db/237: el historial de la pertenencia). Un coche puede
 *                    tener varios periodos (sale de uno y entra en otro); no se
 *                    pisan (la base lo garantiza). Antes de su primer periodo
 *                    no se sabe dónde estaba: sus casillas no lo cogen esos
 *                    días. Sin `desde`, desde siempre; sin `hasta`, sigue. Sin
 *                    db/237 llega la pertenencia de hoy con el día de su último
 *                    cambio de `desde` (sede_coche.actualizado_at).
 *   cts              [{ matricula, desde, hasta }] los periodos con CT por coche
 *                    de antes de db/236 (sede_coche_ct, histórico)
 *
 * Devuelve las funciones con las que se pregunta, todas de un día concreto.
 */
function crear({ asignaciones = [], casillas = [], descansos = [], cochesCuadrante = [], cts = [] } = {}) {
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
  const cas = (casillas || []).filter(c => c && c.cuadranteId != null && TURNOS_DE[c.jornada]).map(c => ({
    id: String(c.id), cuadranteId: String(c.cuadranteId), jornada: c.jornada, uuid: c.uuid || null,
    desde: c.desde, hasta: c.hasta || null,
  }));
  const ctDe = porMat(cts, x => ({ desde: x.desde, hasta: x.hasta || null }));
  const descDe = porMat(descansos, x => ({ turno: x.turno || null, dias: limpiarDias(x.dias), desde: x.desde, hasta: x.hasta || null }));
  // EN QUÉ CUADRANTE ESTABA CADA COCHE CADA DÍA (db/237). Lo que coge una
  // casilla un día se calcula con los coches que estaban en su cuadrante ESE
  // día, no con los de hoy: sacar o mover un coche no reescribe el pasado (los
  // días ya cerrados en que la casilla lo cubrió siguen siendo suyos, y sus
  // horas no se van a «Sin plaza»). Antes de entrar, ninguna casilla lo coge.
  const periodosDe = new Map();    // matrícula → [{ cuadranteId, desde, hasta }]
  const cochesDe = new Map();      // cuadranteId → [matrícula] (los que estuvieron alguna vez)
  (cochesCuadrante || []).forEach(x => {
    if (!x || !x.matricula || x.cuadranteId == null) return;
    const q = String(x.cuadranteId);
    if (!periodosDe.has(x.matricula)) periodosDe.set(x.matricula, []);
    periodosDe.get(x.matricula).push({ cuadranteId: q, desde: x.desde || null, hasta: x.hasta || null });
    if (!cochesDe.has(q)) cochesDe.set(q, []);
    if (!cochesDe.get(q).includes(x.matricula)) cochesDe.get(q).push(x.matricula);
  });
  cochesDe.forEach(l => l.sort());
  /** El cuadrante (su id) en que estaba el coche ese día, o null si en ninguno. */
  const cuadranteDe = (matricula, dia) => {
    const p = (periodosDe.get(matricula) || []).find(x => (!x.desde || x.desde <= dia) && (!x.hasta || x.hasta >= dia));
    return p ? p.cuadranteId : null;
  };

  // ── Las libranzas ─────────────────────────────────────────────────────────

  /** El descanso vigente de ese tipo (null = el común de antes de db/236; 'dia'/'noche' = el de ese fijo). */
  const descansoVigente = (matricula, turno, dia) =>
    (descDe.get(matricula) || []).find(d => d.turno === (turno || null) && vigente(d, dia)) || null;

  /**
   * LOS DÍAS QUE LIBRA LA PLAZA (matrícula + turno) esa semana: los de su
   * descanso. Antes de db/236, en un coche con CT, el común (el bloque): la base
   * no deja que convivan en las mismas fechas (ex_sede_desc_solape).
   */
  const descansoDe = (matricula, turno, dia) => {
    const d = descansoVigente(matricula, turno, dia) || descansoVigente(matricula, null, dia);
    return d ? d.dias.slice() : [];
  };
  /** ¿Libra la plaza ese día (tenga fijo o no)? */
  const libraLaPlaza = (matricula, turno, dia) => descansoDe(matricula, turno, dia).includes(isodow(dia));

  /** ¿Libra ese día? Solo un fijo libra: el CT no trabaja los días que no coge nada, que es su libranza aparte. */
  const libra = (a, dia) => !!a && a.rol !== 'ct' && vigente(a, dia) && libraLaPlaza(a.matricula, a.turno, dia);

  // ── Lo de antes de db/236 (histórico) ────────────────────────────────────

  /** El periodo con CT POR COCHE que cubre ese día, o null. Desde db/236 ya no hay. */
  const periodoCT = (matricula, dia) => (ctDe.get(matricula) || []).find(p => vigente(p, dia)) || null;

  /** ¿Trabaja ese día? El fijo, si no libra; un CT por coche de antes, si el coche tenía CT y es uno de sus días. */
  const trabaja = (a, dia) => {
    if (!a || !vigente(a, dia)) return false;
    if (a.rol === 'ct') return !!periodoCT(a.matricula, dia) && (a.dias || []).includes(isodow(dia));
    return !libra(a, dia);
  };

  // ── Las casillas de CT del cuadrante ──────────────────────────────────────

  /** Las casillas de un cuadrante que valen ese día, en el orden de JORNADAS. */
  const casillasEn = (cuadranteId, dia) => cas
    .filter(c => c.cuadranteId === String(cuadranteId) && vigente(c, dia))
    .sort((a, b) => JORNADAS.indexOf(a.jornada) - JORNADAS.indexOf(b.jornada));
  /**
   * La casilla del cuadrante del coche que coge ese turno ese día: la de su
   * jornada o la todoturno (la base no deja que convivan, ex_sede_cuadrante_ct_solape).
   */
  const casillaDelTurno = (matricula, turno, dia) => {
    const q = cuadranteDe(matricula, dia);
    if (q == null) return null;
    const v = casillasEn(q, dia);
    return v.find(c => c.jornada === turno) || v.find(c => c.jornada === 'todoturno') || null;
  };

  /** Las plazas del cuadrante que la casilla puede coger ese día (las de sus turnos, de los coches que estaban ESE día). */
  const plazasDe = (c, dia) => (cochesDe.get(c.cuadranteId) || []).filter(m => cuadranteDe(m, dia) === c.cuadranteId)
    .flatMap(m => TURNOS_DE[c.jornada].map(t => ({ matricula: m, turno: t })));

  /**
   * LAS PLAZAS QUE LIBRAN ESE DÍA entre las que coge la casilla: las que tiene
   * que coger. Una, si todo está bien; varias es una plaza repetida.
   */
  const libranEn = (c, dia) => plazasDe(c, dia).filter(p => libraLaPlaza(p.matricula, p.turno, dia)).sort(porTurnoYMatricula);

  /**
   * LA PLAZA QUE COGE LA CASILLA ESE DÍA (esté vacía o no), o null si ese día
   * libra. Si libraran varias (no debería: ninguna plaza se repite), la
   * primera: el CT no lleva dos coches a la vez, y las demás quedan en hueco.
   */
  const cubreEl = (c, dia) => (vigente(c, dia) ? libranEn(c, dia)[0] || null : null);

  /**
   * LO QUE COGE LA CASILLA CADA DÍA DE LA SEMANA, con los descansos que valen
   * ese día: [{ dia: 1..7, matricula, turno }], por día de la semana.
   */
  const cubreSemana = (c, dia) => plazasDe(c, dia)
    .flatMap(p => descansoDe(p.matricula, p.turno, dia).map(d => ({ dia: d, ...p })))
    .sort((a, b) => a.dia - b.dia || porTurnoYMatricula(a, b));

  /** LA LIBRANZA DEL CT: los días de la semana en que no coge ninguna plaza (Camilo: «el día que no coja ninguno»). */
  const libraCasilla = (c, dia) => {
    const coge = new Set(cubreSemana(c, dia).map(x => x.dia));
    return SEMANA.filter(d => !coge.has(d));
  };

  /** Los días de la semana en que la casilla cogería más de una plaza: [{ dia, plazas: [{ matricula, turno }] }]. */
  const repetidasSemana = (c, dia) => {
    const porDia = new Map();
    cubreSemana(c, dia).forEach(x => {
      if (!porDia.has(x.dia)) porDia.set(x.dia, []);
      porDia.get(x.dia).push({ matricula: x.matricula, turno: x.turno });
    });
    return [...porDia.entries()].filter(([, ps]) => ps.length > 1).map(([d, plazas]) => ({ dia: d, plazas }));
  };

  /**
   * ¿DOBLA LA PERSONA DE LA CASILLA CON UNA PLAZA FIJA SUYA? Con lo que vale ese
   * día (como repetidasSemana): los días de la semana en que la casilla la
   * pondría a coger un coche en un turno en que ya trabaja de fija en otro.
   * Las escrituras no lo dejan (P.choques), pero la conversión de db/236 pudo
   * dejarlo (un CT por coche que también era fijo pasa a una casilla que coge
   * a TODOS los coches del cuadrante): se dice en la casilla hasta que se
   * arregle. Su propia plaza no cuenta: el día que la coge, libra.
   *
   * Devuelve [{ matricula, turno, dias: [ISODOW] }] con cada plaza fija suya
   * con la que dobla, o [].
   */
  const doblesSemana = (c, dia) => {
    if (!c.uuid || !vigente(c, dia)) return [];
    const fijas = asigs.filter(a => a.uuid === c.uuid && a.rol === 'fijo' && vigente(a, dia));
    if (!fijas.length) return [];
    // Cada día de la semana coge una plaza: la primera (como cubreEl).
    const cogeEl = new Map();
    cubreSemana(c, dia).forEach(x => { if (!cogeEl.has(x.dia)) cogeEl.set(x.dia, x); });
    const out = new Map();
    cogeEl.forEach(x => fijas
      .filter(a => a.turno === x.turno && !descansoDe(a.matricula, a.turno, dia).includes(x.dia))
      .forEach(a => {
        const k = `${a.matricula}|${a.turno}`;
        if (!out.has(k)) out.set(k, { matricula: a.matricula, turno: a.turno, dias: [] });
        out.get(k).dias.push(x.dia);
      }));
    return [...out.values()].map(x => ({ ...x, dias: limpiarDias(x.dias) })).sort(porTurnoYMatricula);
  };

  /**
   * EL CT DE UNA CASILLA COMO UNA ASIGNACIÓN DE ESE DÍA: la matrícula y el
   * turno que coge, con su persona. null si está vacía o ese día libra. Una
   * todoturno puede ir de día un día y de noche otro: por eso el turno es el de
   * la plaza que coge, no el de la casilla.
   */
  const ctDeLaCasilla = (c, dia) => {
    if (!c.uuid) return null;
    const p = cubreEl(c, dia);
    return p ? {
      id: `casilla:${c.id}`, casillaId: c.id, cuadranteId: c.cuadranteId, jornada: c.jornada,
      uuid: c.uuid, rol: 'ct', matricula: p.matricula, turno: p.turno, dias: null, desde: c.desde, hasta: c.hasta,
    } : null;
  };

  // ── Cada turno de cada coche ──────────────────────────────────────────────

  /**
   * ¿SALE EL COCHE ESE TURNO? El día que libra su plaza, solo si su cuadrante
   * tiene una casilla que coja ese turno (o, antes de db/236, si el coche
   * llevaba CT). Si no, no sale: es lo planificado, no un hueco.
   */
  const turnoDelCoche = (matricula, turno, dia) => {
    if (!libraLaPlaza(matricula, turno, dia)) return 'sale';
    return casillaDelTurno(matricula, turno, dia) || periodoCT(matricula, dia) ? 'sale' : 'libra';
  };

  /** Las asignaciones vigentes de una plaza (matrícula + turno + rol) ese día. */
  const enLaPlaza = (matricula, turno, rol, dia) =>
    asigs.filter(a => a.matricula === matricula && a.turno === turno && a.rol === rol && vigente(a, dia));

  /**
   * QUIÉN LLEVA ESE COCHE Y TURNO ESE DÍA: el fijo si no libra; si libra, la
   * persona de la casilla que coge esa plaza (o, antes de db/236, el CT del
   * coche que cubría ese día). null si nadie.
   */
  const quienCubre = (matricula, turno, dia) => {
    const fijo = enLaPlaza(matricula, turno, 'fijo', dia).find(a => trabaja(a, dia));
    if (fijo) return fijo;
    const c = libraLaPlaza(matricula, turno, dia) ? casillaDelTurno(matricula, turno, dia) : null;
    const x = c ? ctDeLaCasilla(c, dia) : null;
    if (x && x.matricula === matricula && x.turno === turno) return x;
    return enLaPlaza(matricula, turno, 'ct', dia).find(a => trabaja(a, dia)) || null;
  };

  /**
   * LO QUE PINTA EL TABLERO EN CADA TURNO:
   *   'trabaja'   lo lleva su fijo
   *   'cubre-ct'  libra su fijo y lo coge la casilla de CT del cuadrante
   *   'hueco'     tiene que salir y nadie lo lleva (sin fijo, o la casilla vacía)
   *   'libra'     libra su fijo y no hay casilla que lo coja: el coche no sale
   */
  const estadoDelTurno = (matricula, turno, dia) => {
    if (turnoDelCoche(matricula, turno, dia) === 'libra') return 'libra';
    const q = quienCubre(matricula, turno, dia);
    if (!q) return 'hueco';
    return q.rol === 'ct' ? 'cubre-ct' : 'trabaja';
  };

  /** Los CT de las casillas que trabajan ese día, cada uno en la plaza que coge. */
  const ctsDelDia = dia => cas.map(c => ctDeLaCasilla(c, dia)).filter(Boolean);

  /**
   * EL PLAN DE VERDAD DE ESE DÍA: las asignaciones que TRABAJAN, cada una en su
   * matrícula y su turno. Los fijos que no libran, las personas de las casillas
   * en la plaza que cogen ese día y, antes de db/236, los CT por coche de sus
   * días. Con esto el reparto de horas da a cada uno su turno.
   */
  const planDelDia = dia => [...asigs.filter(a => trabaja(a, dia)), ...ctsDelDia(dia)];

  /** Las asignaciones vigentes ese día, trabajen o no (para pintar las plazas de los fijos). */
  const vigentesEn = dia => asigs.filter(a => vigente(a, dia));

  /**
   * LAS PLAZAS DEL REPORTE DE ESE DÍA: los fijos vigentes (trabajen o libren:
   * el que libra sale «Libra») y los CT que trabajan, en la plaza que cogen. El
   * CT que ese día no coge nada no tiene nada que contar.
   */
  const plazasDelDia = dia => [
    ...asigs.filter(a => vigente(a, dia) && (a.rol !== 'ct' || trabaja(a, dia))),
    ...ctsDelDia(dia),
  ];

  /** Las casillas que valen ese día (de todos los cuadrantes). */
  const casillasVigentes = dia => cas.filter(c => vigente(c, dia));

  /**
   * ¿SE REPITE ALGUNA PLAZA? Camilo: «ninguna plaza se puede repetir… el
   * correturno debe de coger las plazas que no se trabajan, por lo que no puede
   * coger dos coches a la vez». Recorre las fechas de `desde` a `hasta`, día a
   * día (lo escrito para más adelante también cuenta), y devuelve el primer día
   * en que una casilla del cuadrante tendría que coger más de una plaza:
   *
   *   { fecha, dia (ISODOW), jornada, plazas: [{ matricula, turno }] }  o null
   *
   * `foco`: solo cuenta lo que toca la escritura. Un choque que ya hubiera en
   * otras plazas (o en otra casilla), y que la escritura no toca, no la para.
   *   { matricula, turno? }   lo que toca a esa plaza (o a ese coche)
   *   { casillaId }           lo de esa casilla (la que se agrega)
   */
  const plazasRepetidas = (cuadranteId, desde, hasta, foco = null) => {
    const toca = (c, ps) => !foco
      || (foco.casillaId != null ? c.id === String(foco.casillaId)
        : ps.some(p => p.matricula === foco.matricula && (!foco.turno || p.turno === foco.turno)));
    for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
      for (const c of casillasEn(cuadranteId, dia)) {
        const ps = libranEn(c, dia);
        if (ps.length > 1 && toca(c, ps)) return { fecha: dia, dia: isodow(dia), jornada: c.jornada, plazas: ps };
      }
    }
    return null;
  };

  return {
    asignaciones: asigs, casillas: cas,
    descansoDe, libraLaPlaza, libra, trabaja, periodoCT,
    cuadranteDe, casillasEn, casillaDelTurno, cubreEl, cubreSemana, libraCasilla, repetidasSemana, doblesSemana, ctDeLaCasilla,
    turnoDelCoche, quienCubre, estadoDelTurno, planDelDia, vigentesEn, plazasDelDia, casillasVigentes, plazasRepetidas,
  };
}

/**
 * ¿DOBLA ALGUIEN? Los días (de `desde` a `tope`) en que lo nuevo de una
 * persona la haría trabajar a la vez que otra cosa suya EN EL MISMO TURNO: nadie
 * lleva dos coches a la vez. Es la regla de Madrid (comprobarPlan: «trabajar en
 * su libranza sí vale —un correturnos vive de eso—; lo que no vale es doblar»),
 * reducida al mismo turno, que es lo que Barcelona deja hacer: un fijo de día y
 * uno de noche a la vez sí se puede.
 *
 *   datos     lo de la base para esos días (como `crear`)
 *   nueva     o una plaza de fijo  { matricula, turno, uuid, desde, hasta? }
 *             o una casilla de CT  { cuadranteId, jornada, uuid, desde, hasta? }
 *             (lo que coge la casilla cada día sale de los descansos de `datos`).
 *             `hasta`, si ya se sabe que no llegará más allá (la víspera de lo
 *             que ya hay escrito para después): esos días no chocan.
 *   apartar   (x) → true para lo suyo que se va a cerrar al guardar (la plaza
 *             que se sustituye, la fija que se mueve, la casilla que se
 *             reescribe): eso no choca. Recibe asignaciones y casillas.
 *   tope      el último día que se mira ('AAAA-MM-DD'). Lo escrito para más
 *             adelante también cuenta: una plaza fija suya que empieza dentro
 *             de tres semanas dobla igual que una de mañana. Quien escribe pasa
 *             el tope de lo que puede haber escrito (barcelona.service
 *             .topeEscrito), con `datos` cargados hasta ahí. Sin tope, la
 *             semana desde `desde`.
 *
 * Devuelve [{ matricula, turno, rol, dias: [ISODOW], desde, cuadranteId?, jornada? }]
 * con cada cosa suya con la que choca (rol 'ct' con `cuadranteId` y `jornada`
 * si es su casilla; `desde`, el primer día en que choca), o [].
 */
function choques(datos, nueva, apartar = () => false, tope = null) {
  const NUEVA = '__nueva__';
  const esCasilla = nueva.jornada != null;
  const otras = (datos.asignaciones || []).filter(a => a && a.uuid === nueva.uuid && !apartar(a));
  const otrasCasillas = (datos.casillas || []).filter(c => c && c.uuid === nueva.uuid && !apartar(c));
  const propia = { ...nueva, id: NUEVA, hasta: nueva.hasta || null };
  const reglas = crear({
    ...datos,
    asignaciones: esCasilla ? otras : [...otras, { ...propia, rol: 'fijo' }],
    casillas: esCasilla ? [...otrasCasillas, propia] : otrasCasillas,
  });
  const esNueva = a => a.id === NUEVA || a.casillaId === NUEVA;
  const out = new Map();
  // Hasta el tope (o la semana), y nunca más allá de donde acaba lo nuevo.
  const fin = [tope || sumarDias(nueva.desde, 6), nueva.hasta].filter(Boolean).sort()[0];
  for (let dia = nueva.desde; dia <= fin; dia = sumarDias(dia, 1)) {
    const suyas = reglas.planDelDia(dia).filter(a => a.uuid === nueva.uuid);
    suyas.filter(esNueva).forEach(n => suyas.filter(a => !esNueva(a) && a.turno === n.turno).forEach(a => {
      const k = `${a.matricula}|${a.turno}|${a.rol}`;
      if (!out.has(k)) {
        out.set(k, { matricula: a.matricula, turno: a.turno, rol: a.rol,
          ...(a.casillaId ? { cuadranteId: a.cuadranteId, jornada: a.jornada } : {}), dias: [], desde: dia });
      }
      out.get(k).dias.push(isodow(dia));
    }));
  }
  return [...out.values()].map(x => ({ ...x, dias: limpiarDias(x.dias) }));
}

module.exports = { LETRAS, JORNADAS, isodow, limpiarDias, letras, crear, choques };
