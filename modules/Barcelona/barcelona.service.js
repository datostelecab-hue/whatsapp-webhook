// ============================================================
// BARCELONA · SERVICIO — el planificador
// ============================================================
// Pedido por Camilo el 07/10/2026: Barcelona no necesita fichas ni altas. Sus
// conductores son sus cuentas de BOLT (nombre y teléfono) y sus matrículas, los
// coches de su empresa de BOLT. Se planifica a cada uno en una matrícula, de DÍA
// o de NOCHE, y la asignación es FIJA hasta que se cambie.
//
// Desde el 06/11/2026 (db/234) es EL PLANIFICADOR DE MADRID con los datos de
// Barcelona. Camilo: «ahora necesito agregarle días de libranzas desde el
// planificador, además de agregar los promedios de cada uno como en el
// planificador de Madrid, sin letra… ahora también se van a agregar zonas de
// Barcelona así como en Madrid, no sé todavía si habrá o no CT allá pero
// actívalo de una vez, por defecto todos deben de venir con los CT
// desactivados». Y: «Prácticamente será el mismo diseño de Madrid, solo que la
// arquitectura y flujo de datos cambia ya que no tenemos lo mismo».
//
//   · Zonas y cuadrantes como Madrid (la zona es del cuadrante).
//   · Libranzas de la PLAZA (matrícula + turno): sin CT, cada fijo libra lo
//     suyo; con CT, los dos libran el bloque del coche y el CT lo cubre.
//   · El CT viene desactivado: se activa coche a coche, con su bloque.
//   · El promedio de horas de la casa, sin letra (barcelona.horas.promedios).
//
// Las reglas de quién trabaja y quién libra viven en barcelona.plan.js (puro);
// las comprobaciones y el orden de las escrituras, aquí; el SQL, en
// barcelona.repo.js; las horas, en barcelona.horas.js. Ver
// docs/modulos/Barcelona.md.

const repo = require('./barcelona.repo');
const H = require('./barcelona.horas');
const P = require('./barcelona.plan');
const R = require('../../services/flotaViva/repartoTurnos');

const SEDE = 'barcelona';
const TURNOS = ['dia', 'noche'];
const ROLES = ['fijo', 'ct'];
const MS_DIA = 86400000;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
/**
 * ¿Es un día que EXISTE, 'AAAA-MM-DD'? La forma sola no basta: '2026-11-31' la
 * tiene, V8 lo pasa al 01/12 sin decir nada y PostgreSQL lo rechaza con un error
 * en inglés (22008); '2026-13-01' rompe sumar(). Por eso se rehace la fecha y
 * se mira que salga la misma.
 */
const esFecha = v => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
/** Si viene una fecha, tiene que existir: no se cambia por hoy sin decirlo (se escribiría desde un día que nadie ha pedido). */
const fechaQueExista = v => {
  if (v != null && v !== '' && !esFecha(v)) throw aviso('Esa fecha no existe: elígela en el calendario.');
};
const sumar = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * MS_DIA).toISOString().slice(0, 10);
/**
 * Hasta dónde puede haber algo escrito: las escrituras valen como mucho desde
 * dos meses adelante (fechaDe, fechaCT). Pasado ese día ya no empieza nada
 * nuevo, así que lo que valga entonces vale para siempre: basta con mirar hasta
 * aquí para no perderse nada de lo que hay escrito para más adelante.
 */
const topeEscrito = () => sumar(hoyMadrid(), 62);
const ddmmaaaa = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const nombreTurno = t => (t === 'dia' ? 'de día' : 'de noche');
const normMat = v => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
// El selector de la casa puede devolver { valor } (ver Componentes de la casa).
const uuidDe = v => (v && typeof v === 'object' ? String(v.valor || '') : String(v || '')).trim();
const mismos = (a, b) => JSON.stringify(P.limpiarDias(a)) === JSON.stringify(P.limpiarDias(b));

/** Un error que la pantalla enseña tal cual: un 400 que no ensucia el registro. */
function aviso(texto) {
  const e = new Error(texto);
  e.estado = 400;
  return e;
}

/** ¿Está activa en BOLT? Solo a esas se las ofrece para planificar. */
const activa = c => String((c && c.estado) || '').toLowerCase() === 'active';
/**
 * ¿SE PUEDE PLANIFICAR EL COCHE? Si BOLT lo conoce, manda BOLT: activo sí,
 * desactivado no (no podría trabajar). Si BOLT no lo conoce pero Vehículos lo
 * tiene de alta en la sede, sí: aún no está dado de alta en BOLT (Camilo,
 * 07/10/2026, la 3035LTX), y la pantalla lo avisa.
 */
const cocheActivo = c => (c.enBolt ? String(c.estado || '').toLowerCase() === 'active' : !!c.enErp);

/**
 * Los días de la semana de la pantalla: un array (1..7) o letras («L M X»,
 * «LMX»). null si no se entiende —entonces no se guarda nada—, como
 * parsearDias de Madrid.
 */
function parsearDias(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) {
    const n = v.map(Number);
    return n.every(d => Number.isInteger(d) && d >= 1 && d <= 7) ? P.limpiarDias(n) : null;
  }
  const MAPA = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 7 };
  const dias = new Set();
  for (const trozo of String(v).trim().toUpperCase().split(/[\s,;.+\-/]+/)) {
    for (const letra of trozo) {
      if (!MAPA[letra]) return null;
      dias.add(MAPA[letra]);
    }
  }
  return P.limpiarDias([...dias]);
}

/**
 * DESDE CUÁNDO VALE UNA ESCRITURA: el día que se dice (o hoy), entre un mes
 * atrás (para corregir lo que se olvidó) y dos meses adelante.
 */
function fechaDe(desde) {
  fechaQueExista(desde);
  const hoy = hoyMadrid();
  const d = esFecha(desde) ? desde : hoy;
  if (d < sumar(hoy, -31) || d > sumar(hoy, 60)) throw aviso('La fecha tiene que estar entre un mes atrás y dos meses adelante.');
  return d;
}

/**
 * Lo del CT, nunca antes de hoy (como «Sin correturnos» de Madrid): el pasado de
 * ese coche fue como fue y su reporte tiene que seguir cuadrando. Un día de
 * antes vale como hoy.
 */
function fechaCT(desde) {
  fechaQueExista(desde);
  const hoy = hoyMadrid();
  const d = esFecha(desde) && desde > hoy ? desde : hoy;
  if (d > sumar(hoy, 60)) throw aviso('La fecha tiene que estar entre hoy y dos meses adelante.');
  return d;
}

/**
 * ¿FALTA UNA MIGRACIÓN? Si el error lo parece, se pregunta cuál (db/181 o
 * db/234). Si están las dos, es otro error y se lanza tal cual.
 *
 * Aquí, y solo aquí, también vale un 42703 (no existe la columna): es lo que da
 * leer el `rol` sin db/234. Pero una columna mal escrita da lo mismo, así que
 * solo se toma por «falta la migración» si queFalta() lo confirma. Por eso el
 * 42703 no está en repo.faltaMigracion: el reporte, la semana y la Visibilidad
 * lo usan sin preguntar, y se tragarían un error de verdad como «falta la
 * migración» (o como 0 €).
 */
async function migracionQueFalta(e) {
  if (!repo.faltaMigracion(e) && !(e && e.code === '42703')) throw e;
  const falta = await repo.queFalta().catch(() => null);
  if (!falta) throw e;
  return falta;
}

/**
 * EL PLAN PARA LAS HORAS (el reporte, la semana, el promedio y la Visibilidad).
 * Entre desplegar y aplicar db/234 no hay ni roles, ni CT, ni descansos: se lee
 * lo de antes (todos fijos, nadie libra) para que el reporte y la Visibilidad
 * sigan saliendo como hasta ahora. Sin db/181 el error sigue su camino (quien
 * llama ya dice «Falta aplicar la migración db/181»).
 */
async function planParaHoras(desde, hasta) {
  try {
    return await repo.planEntre(SEDE, desde, hasta);
  } catch (e) {
    if ((await migracionQueFalta(e)) !== 'db/234') throw e;
    return { asignaciones: await repo.asignacionesEntre(SEDE, desde, hasta), cts: [], descansos: [] };
  }
}

/**
 * Los ratos de trabajo de la sede en [iniMs, finMs), con el catálogo de estados
 * de Madrid. Se leen los apuntes desde un día antes: el último de antes de la
 * ventana dice en qué estado estaba cada uno al empezar.
 */
async function ratos(iniMs, finMs, opciones) {
  const [apuntes, mapa] = await Promise.all([
    repo.apuntesEntre(SEDE, iniMs - MS_DIA, finMs),
    repo.situaciones(),
  ]);
  return H.intervalos(apuntes, e => mapa.get(e) || 'otro', iniMs, finMs, opciones);
}

// ── EL PROMEDIO, AL VUELO ───────────────────────────────────────────────────
// La regla, en barcelona.horas.promedios. Aquí solo se cargan sus datos (el mes
// corrido, y el anterior si el mes es joven) y se guardan unos minutos: el
// tablero se pinta cada vez que se escribe algo, y el promedio del mes no
// cambia de un minuto a otro. Barcelona es pequeña: nada de tablas.

const PROMEDIO_MS = 3 * 60000;
const promediosGuardados = new Map();   // hoy → { t, de: uuid → promedio }

async function promedios() {
  const hoy = hoyMadrid();
  const ya = promediosGuardados.get(hoy);
  if (ya && Date.now() - ya.t < PROMEDIO_MS) return ya.de;
  // El mismo «ahora» para decidir si el mes es joven (cuenta los días ya
  // cerrados) y para contar: si no, a las 12:00 del día 6 podrían no cuadrar.
  const ahora = Date.now();
  const per = H.periodosDelPromedio(hoy, ahora);
  let de;
  try {
    const iniMs = R.instante(R.sumarDias(per.desde, -1), R.INICIO.noche);
    const finMs = Math.min(ahora, R.cierreDe(per.hasta));
    const [ivs, plan] = await Promise.all([ratos(iniMs, finMs), planParaHoras(R.sumarDias(per.desde, -1), R.sumarDias(per.hasta, 1))]);
    de = H.promedios({ hoy, ivs, ...plan, ahoraMs: ahora });
  } catch (e) {
    // Sin promedio el planificador se sigue pudiendo usar: se dice N/E y por qué.
    console.error(`❌ [Barcelona] promedios: ${e.stack || e.message}`);
    const nada = { horas: null, total: 0, salio: 0, ausencias: 0, media: null, periodo: per.actual.mes, mesAnterior: false, ne: 'no se ha podido calcular' };
    return () => ({ ...nada });
  }
  promediosGuardados.clear();
  promediosGuardados.set(hoy, { t: ahora, de });
  return de;
}

/** Una escritura que cambia el plan de un día ya cerrado cambia las ausencias: el promedio, de nuevo. */
const olvidarPromediosSi = desde => { if (desde < hoyMadrid()) promediosGuardados.clear(); };

// ── EL TABLERO ──────────────────────────────────────────────────────────────

/**
 * EL TABLERO DE UN DÍA: las zonas, los cuadrantes, cada coche con su CT, su
 * descanso, sus cuatro plazas y si sale cada turno, los conductores con su
 * promedio y quién se ha quedado sin plaza. La forma es el contrato con la
 * pantalla (docs/modulos/Barcelona.md, «La forma del tablero»): lo decide todo
 * el servidor y la pantalla solo pinta.
 */
async function tablero({ fecha } = {}) {
  const dia = esFecha(fecha) ? fecha : hoyMadrid();
  let conductores, coches, plan, est;
  try {
    [conductores, coches, plan, est] = await Promise.all([
      repo.conductores(SEDE), repo.coches(SEDE), repo.planEntre(SEDE, dia, dia), repo.estructura(SEDE),
    ]);
  } catch (e) {
    // Sin db/181 o sin db/234 la pantalla lo dice (con cuál) en vez de dar un error.
    return { faltaMigracion: await migracionQueFalta(e), fecha: dia, hoy: hoyMadrid() };
  }
  return armarTablero({ dia, conductores, coches, plan, est, promedioDe: await promedios() });
}

/** El tablero, con los datos ya leídos. */
function armarTablero({ dia, conductores, coches, plan, est, promedioDe }) {
  const reglas = P.crear(plan);
  const vig = reglas.vigentesEn(dia);
  const cuenta = new Map(conductores.map(c => [c.uuid, c]));

  const base = uuid => {
    const c = cuenta.get(uuid) || {};
    return { uuid, nombre: c.nombre || 'Cuenta de BOLT desconocida', telefono: c.telefono || '', activa: activa(c) };
  };
  /** Una persona EN UNA PLAZA: con lo de esa asignación. */
  const persona = a => ({
    ...base(a.uuid), desde: a.desde, hasta: a.hasta || null, rol: a.rol, dias: a.rol === 'ct' ? a.dias.slice() : null,
    libraHoy: reglas.libra(a, dia), trabajaHoy: reglas.trabaja(a, dia), promedio: promedioDe(a.uuid),
  });
  /** Una persona SUELTA (conductores, sin plaza): libra o trabaja según sus plazas de ese día. */
  const suelta = uuid => {
    const suyas = vig.filter(a => a.uuid === uuid);
    const trabaja = suyas.some(a => reglas.trabaja(a, dia));
    return {
      ...base(uuid), desde: null, hasta: null, rol: null, dias: null,
      libraHoy: !trabaja && suyas.some(a => reglas.libra(a, dia)), trabajaHoy: trabaja, promedio: promedioDe(uuid),
      plazas: suyas.map(a => ({ matricula: a.matricula, turno: a.turno, rol: a.rol, dias: a.rol === 'ct' ? a.dias.slice() : null,
        desde: a.desde, hasta: a.hasta || null, libraHoy: reglas.libra(a, dia), trabajaHoy: reglas.trabaja(a, dia) })),
    };
  };

  // ── Los coches: los activos, y los desactivados solo si alguien los lleva o
  // están en un cuadrante. Una matrícula que ya no está ni en BOLT ni en
  // Vehículos pero sigue en una plaza o en un cuadrante no se esconde.
  const cuadranteDe = new Map(est.cochesCuadrante.map(x => [x.matricula, String(x.cuadranteId)]));
  const conAsig = new Set(vig.map(a => a.matricula));
  const deLaSede = new Set(coches.map(c => c.matricula));
  const huerfanas = [...new Set([...conAsig, ...cuadranteDe.keys()])].filter(m => !deLaSede.has(m))
    .map(m => ({ matricula: m, modelo: '', estado: 'ya no es de la sede', enBolt: false, enErp: false, huerfana: true }));
  const fila = c => {
    const mat = c.matricula;
    const per = reglas.periodoCT(mat, dia);
    const plaza = (turno, rol) => { const a = vig.find(x => x.matricula === mat && x.turno === turno && x.rol === rol); return a ? persona(a) : null; };
    return {
      matricula: mat, modelo: c.modelo || '', enBolt: !!c.enBolt, enErp: !!c.enErp,
      activo: c.huerfana ? false : cocheActivo(c), estadoBolt: c.estado || '',
      cuadranteId: cuadranteDe.get(mat) || null,
      conCT: !!per, conCTDesde: per ? per.desde : null,
      descanso: per ? reglas.descansoDe(mat, null, dia) : [],
      descansoTurno: per ? { dia: [], noche: [] } : { dia: reglas.descansoDe(mat, 'dia', dia), noche: reglas.descansoDe(mat, 'noche', dia) },
      plazas: { fijoDia: plaza('dia', 'fijo'), fijoNoche: plaza('noche', 'fijo'), ctDia: plaza('dia', 'ct'), ctNoche: plaza('noche', 'ct') },
      turnos: { dia: reglas.estadoDelTurno(mat, 'dia', dia), noche: reglas.estadoDelTurno(mat, 'noche', dia) },
    };
  };
  const filas = [...coches.filter(c => cocheActivo(c) || conAsig.has(c.matricula) || cuadranteDe.has(c.matricula)), ...huerfanas]
    .map(fila)
    .sort((a, b) => (Number(b.activo) - Number(a.activo)) || a.matricula.localeCompare(b.matricula));

  // ── Los cuadrantes y las zonas.
  const zonaPorId = new Map(est.zonas.map(z => [String(z.id), z]));
  const cochesDe = id => filas.filter(f => f.cuadranteId === String(id)).map(f => f.matricula).sort();
  const cuadrantes = est.cuadrantes.map(q => {
    const mats = cochesDe(q.id);
    const ctDe = turno => {
      const out = new Map();
      vig.filter(a => a.rol === 'ct' && a.turno === turno && mats.includes(a.matricula)).forEach(a => {
        if (!out.has(a.uuid)) out.set(a.uuid, { ...persona(a), matriculas: [] });
        out.get(a.uuid).matriculas.push(a.matricula);
      });
      return [...out.values()];
    };
    const zona = q.zonaId ? zonaPorId.get(String(q.zonaId)) : null;
    return {
      id: String(q.id), numero: Number(q.numero), nombre: q.nombre || null,
      zonaId: zona ? String(zona.id) : null, zona: zona ? zona.nombre : null,
      coches: mats,
      ct: { dia: ctDe('dia'), noche: ctDe('noche') },
      bloques: mats.filter(m => reglas.conCT(m, dia)).map(m => ({ matricula: m, dias: reglas.descansoDe(m, null, dia) })),
    };
  }).sort((a, b) => (a.zona === null) - (b.zona === null) || String(a.zona || '').localeCompare(String(b.zona || ''), 'es')
    || a.numero - b.numero);
  const zonas = est.zonas.filter(z => z.activa).map(z => {
    const suyos = cuadrantes.filter(q => q.zonaId === String(z.id));
    return { id: String(z.id), nombre: z.nombre, cuadrantes: suyos.length, coches: suyos.reduce((s, q) => s + q.coches.length, 0) };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // ── La gente: los activos en BOLT, y quién de ellos no tiene plaza ese día.
  const activos = conductores.filter(activa);
  const conPlaza = new Set(vig.map(a => a.uuid));
  const sinPlaza = activos.filter(c => !conPlaza.has(c.uuid)).map(c => suelta(c.uuid));

  // ── Las cifras, de los coches que se pueden planificar. «Turnos» son los que
  // tienen que salir ese día (cubiertos + huecos); los que no salen porque
  // libra el fijo de un coche sin CT van aparte, en «libran»: no son huecos.
  const estados = filas.filter(f => f.activo).flatMap(f => [f.turnos.dia, f.turnos.noche]);
  return {
    fecha: dia, hoy: hoyMadrid(),
    zonas, cuadrantes, coches: filas,
    conductores: activos.map(c => suelta(c.uuid)),
    sinPlaza,
    resumen: {
      coches: filas.filter(f => f.activo).length,
      turnos: estados.filter(x => x !== 'libra').length,
      cubiertos: estados.filter(x => x === 'trabaja').length,
      huecos: estados.filter(x => x === 'hueco').length,
      libran: estados.filter(x => x === 'libra').length,
      sinPlaza: sinPlaza.length,
      conCT: filas.filter(f => f.activo && f.conCT).length,
    },
  };
}

/** El tablero de un día si la escritura lo trae (las de zonas y cuadrantes no tienen día). */
const tableroSi = async fecha => (esFecha(fecha) ? { tablero: await tablero({ fecha }) } : {});

// ── LO QUE SE COMPRUEBA ANTES DE ESCRIBIR ───────────────────────────────────

/** La matrícula, de un coche de la sede (en BOLT o en Vehículos). */
function cocheDeLaSede(coches, mat) {
  if (!coches.some(c => c.matricula === mat)) throw aviso(`La matrícula ${mat || '(vacía)'} no es de un coche de Barcelona (ni en BOLT ni en Vehículos).`);
}

/** La persona, una cuenta ACTIVA de BOLT de la sede. */
function cuentaActiva(conductores, uuid) {
  const c = conductores.find(x => x.uuid === uuid);
  if (!c) throw aviso('Esa persona no es una cuenta de BOLT de Barcelona.');
  if (!activa(c)) throw aviso(`${c.nombre || 'Esa cuenta'} no está activa en BOLT.`);
  return c;
}

/**
 * ¿COMPARTE DÍA EL BLOQUE CON OTRO DEL CUADRANTE? Dos bloques de un cuadrante no
 * comparten día: el mismo CT los cubre (la regla de Madrid, chocaEnElCuadrante).
 * Solo cuentan los coches con CT ese día: uno sin CT no tiene bloque.
 *
 * SE MIRA DÍA A DÍA, de `desde` a `hasta`, con las reglas del plan COMO
 * QUEDARÍA tras la escritura (trasDescanso, trasActivar). Mirar solo el día que
 * se escribe dejaba pasar un bloque que chocaba con lo que otro coche ya tiene
 * escrito para más adelante (o un CT que empieza más adelante), y el cuadrante
 * acababa con dos bloques en los mismos días. Barcelona es pequeña: unos
 * noventa días por unos pocos coches no cuestan nada.
 *
 * Devuelve el primer choque { matricula, dias (los suyos), mios, dia } o null.
 */
function chocaEnElCuadrante({ est, reglas, cuadranteId, matricula, desde, hasta }) {
  if (!cuadranteId) return null;
  const otros = est.cochesCuadrante.filter(x => String(x.cuadranteId) === String(cuadranteId) && x.matricula !== matricula)
    .map(x => x.matricula);
  if (!otros.length) return null;
  for (let dia = desde; dia <= hasta; dia = sumar(dia, 1)) {
    if (!reglas.conCT(matricula, dia)) continue;
    const mios = reglas.descansoDe(matricula, null, dia);
    if (!mios.length) continue;
    for (const m of otros) {
      if (!reglas.conCT(m, dia)) continue;
      const suyos = reglas.descansoDe(m, null, dia);
      if (suyos.some(d => mios.includes(d))) return { matricula: m, dias: suyos, mios, dia };
    }
  }
  return null;
}
const barras = dias => dias.map(d => P.LETRAS[d - 1]).join('/');
/** «desde el 20/11/2026» si el choque empieza después del día que se escribe: si no, parecería que choca ya. */
const desdeCuando = (x, d) => (x.dia > d ? ` desde el ${ddmmaaaa(x.dia)}` : '');
const mensajeChoque = (x, d) =>
  `Esos días chocan con ${x.matricula} (${barras(x.dias)}) en el cuadrante${desdeCuando(x, d)}: no pueden compartir día, el mismo correturnos cubre los dos bloques.`;

/**
 * EL PLAN TRAS FIJAR UN DESCANSO, como lo deja repo.ponerDescanso: el de ese
 * tipo que empezaba ese día se va, el que lo cubre se cierra la víspera, lo de
 * más adelante se respeta y el nuevo dura hasta la víspera de lo siguiente del
 * coche (el auto-corte de abrirDescanso). Devuelve el plan y hasta cuándo vale
 * lo nuevo (null = sin fin): a partir de ahí no cambia nada.
 */
function trasDescanso(plan, { matricula, turno, dias, desde }) {
  const t = turno || null;
  const mismo = x => x.matricula === matricula && (x.turno || null) === t;
  const descansos = plan.descansos
    .filter(x => !(mismo(x) && x.desde === desde))
    .map(x => (mismo(x) && x.desde < desde && (!x.hasta || x.hasta >= desde) ? { ...x, hasta: sumar(desde, -1) } : x));
  // Hasta cuándo vale lo nuevo, también si es «no librar» (sin días): hasta la
  // víspera de lo siguiente que el coche ya tiene escrito. Si no se acotara al
  // quitar el bloque, un choque que ya hubiera más adelante (y que esta
  // escritura no toca) impediría dejar de librar, cuando poner otro bloque sí
  // se deja.
  const sig = plan.descansos
    .filter(x => x.matricula === matricula && x.desde > desde && (t === null || !x.turno || x.turno === t))
    .map(x => x.desde).sort()[0];
  const hasta = sig ? sumar(sig, -1) : null;
  if (dias.length) descansos.push({ matricula, turno: t, dias, desde, hasta });
  return { plan: { ...plan, descansos }, hasta };
}

/**
 * EL PLAN TRAS ACTIVAR EL CT, como lo deja repo.activarCT: fuera los descansos
 * del coche desde ese día (lo de más adelante se borra, lo que lo cubre se
 * cierra la víspera), dentro el periodo con CT y el bloque, los dos sin fin.
 */
function trasActivar(plan, { matricula, dias, desde }) {
  const descansos = plan.descansos
    .filter(x => !(x.matricula === matricula && x.desde >= desde))
    .map(x => (x.matricula === matricula && (!x.hasta || x.hasta >= desde) ? { ...x, hasta: sumar(desde, -1) } : x));
  descansos.push({ matricula, turno: null, dias, desde, hasta: null });
  return { ...plan, cts: [...plan.cts, { matricula, desde, hasta: null }], descansos };
}

/** «Ana ya lleva el 2222BBB (de CT) los X J de día: no puede llevar también el 1111AAA esos días.» */
const mensajeDoble = (nombre, turno, choques, mat) =>
  `${nombre} ya lleva ${choques.map(x => `el ${x.matricula}${x.rol === 'ct' ? ' (de CT)' : ''} los ${P.letras(x.dias)}`).join(' y ')} ` +
  `${nombreTurno(turno)}: no puede llevar también el ${mat} esos días.`;

/** Las escrituras que la base para (un solape que se coló) dichas para la pantalla. */
function traducir(e) {
  if (e && e.code === '23P01') return aviso('Eso se pisa con otro periodo de la misma matrícula: recarga el tablero y vuelve a probar.');
  if (e && e.code === '23505') return aviso('Alguien acaba de cambiar lo mismo: recarga el tablero y vuelve a probar.');
  if (e && e.code === '23514' && /correturnos/.test(e.message || '')) return aviso(e.message);
  return e;
}
const escribir = async fn => { try { return await fn(); } catch (e) { throw traducir(e); } };

// ── LAS PLAZAS ──────────────────────────────────────────────────────────────

/**
 * PONER O QUITAR A ALGUIEN de una plaza (matrícula + turno + rol) desde un día.
 *
 *   · fijo: trabaja todos los días menos los que libra su plaza. Si ya era fijo
 *     de otra matrícula en ese turno, SE MUEVE (como hasta ahora).
 *   · ct: solo en un coche que lleva CT ese día, con los días de la semana que
 *     cubre en esa matrícula (por omisión, los del bloque del coche). No se
 *     mueve: un CT lleva varios coches, los de su cuadrante.
 *
 * Nadie lleva dos coches del mismo turno a la vez: si los días que trabajaría
 * aquí se pisan con los de otra plaza suya de ese turno, no se guarda y se dice
 * con cuál (P.choques).
 *
 * Una plaza de CT dura, como mucho, lo que dura el periodo con CT del coche: si
 * ya está escrito que se le quita el CT, la plaza acaba ese día (`hasta`). Si
 * no, quedaría abierta en un coche sin CT, la pantalla no dejaría vaciarla y
 * volvería sola el día que se le reactivara el CT. La base lo para también
 * (db/235).
 */
async function asignar(body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const t = String(body.turno || '');
  const rol = body.rol ? String(body.rol) : 'fijo';
  const uuid = uuidDe(body.uuid !== undefined ? body.uuid : body.conductor);
  if (!TURNOS.includes(t)) throw aviso('El turno tiene que ser de día o de noche.');
  if (!ROLES.includes(rol)) throw aviso('La plaza es de fijo o de correturnos.');
  const d = fechaDe(body.desde);

  const [coches, conductores] = await Promise.all([repo.coches(SEDE), repo.conductores(SEDE)]);
  // Dejar libre una plaza vale siempre, también la de una matrícula que ya no es
  // de la sede (sale en el tablero para eso: para poder vaciarla).
  if (uuid) cocheDeLaSede(coches, mat);
  const c = uuid ? cuentaActiva(conductores, uuid) : null;

  // Lo de esa semana: para saber si el coche lleva CT, su bloque y con qué choca.
  const plan = await repo.planEntre(SEDE, d, sumar(d, 6));
  const reglas = P.crear(plan);
  let dias = null;
  let hasta = null;      // el último día que puede durar: el del periodo con CT (un CT), o sin fin
  if (rol === 'ct' && uuid) {
    const per = reglas.periodoCT(mat, d);
    if (!per) {
      throw aviso(`El ${mat} no lleva correturnos el ${ddmmaaaa(d)}: no se puede poner a nadie de CT. Actívalo antes en el coche.`);
    }
    hasta = per.hasta || null;
    // Sin días, los del bloque del coche: cubrir justo lo que libran sus fijos
    // es lo que significa un correturnos (como guardarDias de Madrid).
    const sinDias = body.dias == null || body.dias === '' || (Array.isArray(body.dias) && !body.dias.length);
    const pedidos = sinDias ? [] : parsearDias(body.dias);
    if (pedidos === null) throw aviso('No entiendo los días. Escríbelos como L M X J V S D.');
    dias = pedidos.length ? pedidos : reglas.descansoDe(mat, null, d);
    if (!dias.length) throw aviso('Elige qué días trabaja en esta matrícula: un correturnos sin días no cubre nada.');
  }
  if (uuid) {
    // Lo que se va a cerrar al guardar no choca: lo que vale ese día en la
    // plaza que se sustituye y, si es un fijo, su otra plaza fija de ese turno
    // (se mueve). Lo escrito para más adelante se respeta (repo.asignarEn): lo
    // nuevo dura hasta su víspera, y así se le pasa a P.choques para no contarle
    // días que no va a trabajar aquí.
    const apartar = a => a.desde <= d
      && ((a.matricula === mat && a.turno === t && a.rol === rol) || (rol === 'fijo' && a.rol === 'fijo'));
    let hastaPrevista = hasta;
    reglas.asignaciones.filter(a => a.desde > d && a.turno === t
      && ((a.matricula === mat && a.rol === rol) || (rol === 'fijo' && a.rol === 'fijo' && a.uuid === uuid)))
      .forEach(a => { const v = sumar(a.desde, -1); if (hastaPrevista == null || v < hastaPrevista) hastaPrevista = v; });
    const choques = P.choques(plan, { matricula: mat, turno: t, uuid, rol, dias, desde: d, hasta: hastaPrevista }, apartar);
    if (choques.length) throw aviso(mensajeDoble(c.nombre || 'Esa persona', t, choques, mat));
  }

  const r = await escribir(() => repo.asignar({ sede: SEDE, matricula: mat, turno: t, rol, driverUuid: uuid || null, dias, desde: d, hasta, usuarioId }));
  olvidarPromediosSi(d);
  console.log(`🗓️ [BARCELONA] ${mat} ${t === 'dia' ? 'día' : 'noche'}${rol === 'ct' ? ' CT' : ''} desde ${d}: ` +
    `${c ? c.nombre : 'libre'}${dias ? ` (${P.letras(dias)})` : ''}${r.movidaDe ? ` (viene de ${r.movidaDe})` : ''}${r.cambio ? '' : ' (sin cambios)'}`);
  return { ...r, tablero: await tablero({ fecha: d }) };
}

// ── EL DESCANSO ─────────────────────────────────────────────────────────────

/**
 * FIJA EL DESCANSO de una plaza desde un día. `turno` null: el BLOQUE del coche
 * (sus dos fijos libran a la vez y el CT lo cubre), solo en un coche con CT, y
 * sin compartir día con otro bloque de su cuadrante. `turno` 'dia'/'noche': el
 * de ese fijo, solo en un coche sin CT. Sin días, deja de librar.
 */
async function fijarDescanso(body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const t = body.turno == null || body.turno === '' ? null : String(body.turno);
  if (t !== null && !TURNOS.includes(t)) throw aviso('El turno del descanso es de día, de noche o el del coche entero.');
  const d = fechaDe(body.desde);
  const dias = parsearDias(body.dias);
  if (dias === null) throw aviso('No entiendo los días. Escríbelos como L M X J V S D.');

  // Hasta donde puede haber algo escrito: el bloque no puede chocar con lo que
  // otro coche del cuadrante ya tiene escrito para más adelante.
  const tope = topeEscrito();
  const [coches, plan, est] = await Promise.all([repo.coches(SEDE), repo.planEntre(SEDE, d, tope), repo.estructura(SEDE)]);
  cocheDeLaSede(coches, mat);
  const reglas = P.crear(plan);
  const conCT = reglas.conCT(mat, d);
  if (t === null && !conCT) {
    throw aviso(`El ${mat} no lleva correturnos: cada fijo tiene su propio descanso (el de día y el de noche).`);
  }
  if (t !== null && conCT) {
    throw aviso(`El ${mat} lleva correturnos: sus dos fijos libran el bloque del coche, que cubre el CT. Cámbialo en su descanso.`);
  }
  if (t === null) {
    const cuadranteId = (est.cochesCuadrante.find(x => x.matricula === mat) || {}).cuadranteId;
    // Lo nuevo vale de `d` a la víspera de lo siguiente que el coche ya tiene
    // escrito; de ahí en adelante no cambia nada, así que no se mira.
    const nuevo = trasDescanso(plan, { matricula: mat, turno: null, dias, desde: d });
    const choca = chocaEnElCuadrante({ est, reglas: P.crear(nuevo.plan), cuadranteId, matricula: mat, desde: d, hasta: nuevo.hasta || tope });
    if (choca) throw aviso(mensajeChoque(choca, d));
  }
  await escribir(() => repo.ponerDescanso({ sede: SEDE, matricula: mat, turno: t, dias, desde: d, usuarioId }));
  olvidarPromediosSi(d);
  console.log(`🗓️ [BARCELONA] ${mat} descanso ${t ? nombreTurno(t) : 'del coche'} desde ${d}: ${P.letras(dias) || 'no libra'}`);
  return { dias, tablero: await tablero({ fecha: d }) };
}

// ── EL CORRETURNOS DEL COCHE ────────────────────────────────────────────────

/**
 * ACTIVAR O DESACTIVAR EL CT DE UN COCHE desde un día (nunca antes de hoy).
 * Camilo: «no sé todavía si habrá o no CT allá pero actívalo de una vez, por
 * defecto todos deben de venir con los CT desactivados».
 *
 *   Activar     pide los días del bloque (los que libran los dos fijos y cubre
 *               el CT), que no pueden compartir día con otro bloque de su
 *               cuadrante. Los descansos de cada fijo se cierran.
 *   Desactivar  como «Sin correturnos» de Madrid: fuera sus CT (se dice
 *               quiénes), cada fijo pasa a librar lo que libraba el coche, y se
 *               cierra el periodo con CT.
 */
async function correturnos(body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const activar = body.activar === true || body.activar === 'true' || body.activar === 1;
  const d = fechaCT(body.desde);
  // Dos meses por delante: es hasta donde se puede escribir, así que un CT
  // escrito para más adelante empieza dentro.
  const [coches, conductores, plan, est] = await Promise.all([
    repo.coches(SEDE), repo.conductores(SEDE), repo.planEntre(SEDE, d, sumar(d, 62)), repo.estructura(SEDE),
  ]);
  const reglas = P.crear(plan);
  // Los periodos con CT de ese coche desde ese día (el de ese día o uno escrito para más adelante).
  const periodos = plan.cts.filter(p => p.matricula === mat && (!p.hasta || p.hasta >= d)).sort((a, b) => a.desde.localeCompare(b.desde));

  if (activar) {
    cocheDeLaSede(coches, mat);
    if (periodos.length) throw aviso(`El ${mat} ya lleva correturnos desde el ${ddmmaaaa(periodos[0].desde)}.`);
    const dias = parsearDias(body.dias);
    if (dias === null) throw aviso('No entiendo los días. Escríbelos como L M X J V S D.');
    if (!dias.length) throw aviso('Elige los días del bloque: los que libran los dos fijos y cubre el correturnos.');
    const cuadranteId = (est.cochesCuadrante.find(x => x.matricula === mat) || {}).cuadranteId;
    // Con el CT y el bloque puestos desde `d` y sin fin: todos los días hasta
    // donde llega lo leído, que es más allá de lo último que se puede escribir.
    const choca = chocaEnElCuadrante({ est, reglas: P.crear(trasActivar(plan, { matricula: mat, dias, desde: d })),
      cuadranteId, matricula: mat, desde: d, hasta: sumar(d, 62) });
    if (choca) throw aviso(mensajeChoque(choca, d));
    await escribir(() => repo.activarCT({ sede: SEDE, matricula: mat, dias, desde: d, usuarioId }));
    console.log(`🗓️ [BARCELONA] ${mat} con correturnos desde ${d}: bloque ${P.letras(dias)}`);
    return { dias, tablero: await tablero({ fecha: d }) };
  }

  if (!periodos.length) throw aviso(`El ${mat} no lleva correturnos.`);
  // Un CT escrito para más adelante que aún no ha empezado se quita DESDE QUE
  // EMPIEZA: hasta entonces el coche sigue como está (sin CT, cada fijo con lo
  // suyo) y no hay nada que tocar.
  const desde = reglas.conCT(mat, d) ? d : periodos[0].desde;
  // El bloque que pasa a cada fijo: el del coche ese día.
  const bloque = reglas.descansoDe(mat, null, desde);
  const r = await escribir(() => repo.desactivarCT({ sede: SEDE, matricula: mat, dias: bloque, desde, usuarioId }));
  const nombre = uuid => (conductores.find(x => x.uuid === uuid) || {}).nombre || 'Cuenta de BOLT desconocida';
  const quitados = (r.quitados || []).map(q => ({ ...q, nombre: nombre(q.uuid) }));
  console.log(`🗓️ [BARCELONA] ${mat} sin correturnos desde ${desde}: cada fijo libra ${P.letras(bloque) || 'nada'}` +
    `${quitados.length ? `; fuera ${quitados.map(q => q.nombre).join(', ')}` : ''}`);
  return { quitados, descanso: bloque, tablero: await tablero({ fecha: desde }) };
}

// ── LAS ZONAS ───────────────────────────────────────────────────────────────

/** Un nombre de zona o de cuadrante: sin espacios de más y de 1 a 60 letras. */
function nombreLimpio(v, { obligatorio, que }) {
  const n = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!n) { if (obligatorio) throw aviso(`Ponle nombre a la ${que}.`); return null; }
  if (n.length > 60) throw aviso(`El nombre de la ${que} es demasiado largo (60 letras como mucho).`);
  return n;
}
const mismoNombre = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Crea una zona. Nombre único entre las vivas de la sede; «Sin zona» es el grupo de los que no tienen. */
async function crearZona(body = {}, usuarioId) {
  const nombre = nombreLimpio(body.nombre, { obligatorio: true, que: 'zona' });
  if (mismoNombre(nombre, 'Sin zona')) throw aviso('«Sin zona» es el grupo de los cuadrantes que no tienen zona: elige otro nombre.');
  const est = await repo.estructura(SEDE);
  if (est.zonas.some(z => z.activa && mismoNombre(z.nombre, nombre))) throw aviso(`Ya hay una zona «${nombre}».`);
  const r = await escribir(() => repo.crearZona({ sede: SEDE, nombre, usuarioId }));
  return { zona: { id: String(r.id), nombre }, ...(await tableroSi(body.fecha)) };
}

/** Renombra una zona (`nombre`) o la retira/recupera (`activa`). No se retira con cuadrantes vivos. */
async function cambiarZona(id, body = {}) {
  const est = await repo.estructura(SEDE);
  const z = est.zonas.find(x => String(x.id) === String(id));
  if (!z) throw aviso('Esa zona no existe: recarga la pantalla.');
  const nombre = body.nombre === undefined ? null : nombreLimpio(body.nombre, { obligatorio: true, que: 'zona' });
  const activaNueva = body.activa === undefined ? null : !(body.activa === false || body.activa === 'false' || body.activa === 0);
  if (nombre === null && activaNueva === null) throw aviso('No hay nada que cambiar en la zona.');
  if (nombre && mismoNombre(nombre, 'Sin zona')) throw aviso('«Sin zona» es el grupo de los cuadrantes que no tienen zona: elige otro nombre.');
  const quedaViva = activaNueva === null ? z.activa : activaNueva;
  if (quedaViva && est.zonas.some(x => x.activa && String(x.id) !== String(z.id) && mismoNombre(x.nombre, nombre || z.nombre))) {
    throw aviso(`Ya hay una zona «${nombre || z.nombre}».`);
  }
  if (activaNueva === false) {
    const suyos = est.cuadrantes.filter(q => String(q.zonaId) === String(z.id));
    if (suyos.length) {
      throw aviso(`La zona ${z.nombre} tiene ${suyos.length === 1 ? 'un cuadrante' : suyos.length + ' cuadrantes'} ` +
        `(${suyos.map(q => 'C' + q.numero).join(', ')}): cámbialos de zona antes de retirarla.`);
    }
  }
  await escribir(() => repo.cambiarZona({ sede: SEDE, id: z.id, nombre, activa: activaNueva }));
  return { zona: { id: String(z.id), nombre: nombre || z.nombre, activa: quedaViva }, ...(await tableroSi(body.fecha)) };
}

// ── LOS CUADRANTES ──────────────────────────────────────────────────────────

/** El cuadrante vivo de la sede con ese id, o un aviso. */
function cuadranteVivo(est, id) {
  const q = est.cuadrantes.find(x => String(x.id) === String(id));
  if (!q) throw aviso('Ese cuadrante no existe o ya está borrado: recarga la pantalla.');
  return q;
}
/** La zona viva de la sede con ese id (vacío = sin zona), o un aviso. */
function zonaViva(est, zonaId) {
  if (zonaId == null || zonaId === '') return null;
  const z = est.zonas.find(x => String(x.id) === String(zonaId) && x.activa);
  if (!z) throw aviso('Esa zona no existe o está retirada: recarga la pantalla.');
  return z;
}

/** Crea un cuadrante con el siguiente número libre de la sede, en una zona o sin ella. */
async function crearCuadrante(body = {}, usuarioId) {
  const est = await repo.estructura(SEDE);
  const z = zonaViva(est, body.zonaId);
  const nombre = nombreLimpio(body.nombre, { obligatorio: false, que: 'cuadrante' });
  const r = await escribir(() => repo.crearCuadrante({ sede: SEDE, zonaId: z ? z.id : null, nombre, usuarioId }));
  console.log(`🗓️ [BARCELONA] cuadrante C${r.numero} creado${z ? ` en ${z.nombre}` : ' sin zona'}`);
  return { cuadrante: { id: String(r.id), numero: Number(r.numero) }, ...(await tableroSi(body.fecha)) };
}

/** Cambia la zona (`zonaId`, null = sin zona) o el nombre de un cuadrante. Lo que no venga no cambia. */
async function cambiarCuadrante(id, body = {}) {
  const est = await repo.estructura(SEDE);
  const q = cuadranteVivo(est, id);
  const cambiaZona = Object.prototype.hasOwnProperty.call(body, 'zonaId');
  const cambiaNombre = Object.prototype.hasOwnProperty.call(body, 'nombre');
  if (!cambiaZona && !cambiaNombre) throw aviso('No hay nada que cambiar en el cuadrante.');
  const z = cambiaZona ? zonaViva(est, body.zonaId) : null;
  const nombre = cambiaNombre ? nombreLimpio(body.nombre, { obligatorio: false, que: 'cuadrante' }) : null;
  await escribir(() => repo.cambiarCuadrante({ sede: SEDE, id: q.id, zonaId: z ? z.id : null, nombre, cambiaZona, cambiaNombre }));
  return { cuadrante: { id: String(q.id), numero: Number(q.numero) }, ...(await tableroSi(body.fecha)) };
}

/** Da de baja un cuadrante, si ya no tiene coches. */
async function borrarCuadrante(id, body = {}) {
  const est = await repo.estructura(SEDE);
  const q = cuadranteVivo(est, id);
  const suyos = est.cochesCuadrante.filter(x => String(x.cuadranteId) === String(q.id));
  if (suyos.length) {
    throw aviso(`El C${q.numero} tiene ${suyos.length === 1 ? 'un coche' : suyos.length + ' coches'} ` +
      `(${suyos.map(x => x.matricula).join(', ')}): sácalos antes de borrarlo.`);
  }
  const r = await escribir(() => repo.bajaCuadrante({ sede: SEDE, id: q.id }));
  if (!r) throw aviso('No se ha podido borrar: alguien acaba de cambiarlo. Recarga la pantalla.');
  console.log(`🗓️ [BARCELONA] cuadrante C${q.numero} borrado`);
  return { borrado: true, ...(await tableroSi(body.fecha)) };
}

/**
 * METE O SACA UN COCHE de un cuadrante. Un coche CON CT entra con su bloque, que
 * no puede compartir día con los de los demás coches con CT del cuadrante. Uno
 * sin CT entra sin más: está en el cuadrante para tenerlo (como en Madrid).
 *
 * El cuadrante de un coche no tiene fechas (sede_coche, como vehiculo
 * .cuadrante_id): vale desde ya y para siempre. Por eso el choque se mira de hoy
 * hasta lo último que puede haber escrito, no solo el día que se mira: un coche
 * sin CT hoy pero con un CT escrito para más adelante también tiene bloque.
 * `fecha` es solo el día del tablero que se devuelve.
 */
async function cocheEnCuadrante(id, body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const quitar = body.quitar === true || body.quitar === 'true' || body.quitar === 1;
  const hoy = hoyMadrid();
  const tope = topeEscrito();
  const [coches, est, plan] = await Promise.all([repo.coches(SEDE), repo.estructura(SEDE), repo.planEntre(SEDE, hoy, tope)]);
  const q = cuadranteVivo(est, id);
  const actual = (est.cochesCuadrante.find(x => x.matricula === mat) || {}).cuadranteId || null;
  if (quitar) {
    if (String(actual) !== String(q.id)) throw aviso(`El ${mat || '(vacía)'} no está en el C${q.numero}.`);
    await escribir(() => repo.cocheEnCuadrante({ sede: SEDE, matricula: mat, cuadranteId: null, usuarioId }));
    return { sacado: mat, ...(await tableroSi(body.fecha)) };
  }
  cocheDeLaSede(coches, mat);
  if (String(actual) === String(q.id)) return { metido: mat, ...(await tableroSi(body.fecha)) };
  const choca = chocaEnElCuadrante({ est, reglas: P.crear(plan), cuadranteId: q.id, matricula: mat, desde: hoy, hasta: tope });
  if (choca) {
    throw aviso(`El bloque del ${mat} (${barras(choca.mios)}) choca con ${choca.matricula} (${barras(choca.dias)}) ` +
      `en el C${q.numero}${desdeCuando(choca, hoy)}: no pueden compartir día. Cámbiale antes el descanso.`);
  }
  await escribir(() => repo.cocheEnCuadrante({ sede: SEDE, matricula: mat, cuadranteId: q.id, usuarioId }));
  console.log(`🗓️ [BARCELONA] ${mat} al C${q.numero}${actual ? ' (sale de otro cuadrante)' : ''}`);
  return { metido: mat, ...(await tableroSi(body.fecha)) };
}

/**
 * EL CT DEL CUADRANTE (como asignarCTcuadrante de Madrid): pone a esa persona de
 * CT de ese turno en cada coche CON CT del cuadrante, con los días del bloque de
 * cada uno. Así un CT abarca las matrículas del cuadrante sin ir coche por
 * coche. Los coches sin CT se saltan sin decir nada: están para tener cuadrante.
 *
 * Si otro ya lleva el CT de ese turno de un coche, ese coche NO se toca (es
 * decisión de una persona sobre un coche concreto) y se devuelve en
 * `saltados`, para hacerlo a mano. Sin persona, se quitan los CT de ese turno
 * de todos los coches del cuadrante. Todo o nada: en una transacción.
 */
async function ctDelCuadrante(id, body = {}, usuarioId) {
  const t = String(body.turno || '');
  if (!TURNOS.includes(t)) throw aviso('El turno tiene que ser de día o de noche.');
  const uuid = uuidDe(body.uuid !== undefined ? body.uuid : body.conductor);
  const d = fechaDe(body.desde);
  const [conductores, est, plan] = await Promise.all([repo.conductores(SEDE), repo.estructura(SEDE), repo.planEntre(SEDE, d, sumar(d, 6))]);
  const q = cuadranteVivo(est, id);
  const c = uuid ? cuentaActiva(conductores, uuid) : null;
  const reglas = P.crear(plan);
  const nombreDe = u => (conductores.find(x => x.uuid === u) || {}).nombre || 'Cuenta de BOLT desconocida';
  const mats = est.cochesCuadrante.filter(x => String(x.cuadranteId) === String(q.id)).map(x => x.matricula)
    .filter(m => reglas.conCT(m, d)).sort();
  // El CT de cada coche ese día o, si no tiene, el que empieza después (dentro
  // de la semana que se ha leído): primero el que vale ese día.
  const ctDe = m => reglas.asignaciones
    .filter(a => a.matricula === m && a.turno === t && a.rol === 'ct' && (!a.hasta || a.hasta >= d))
    .sort((a, b) => a.desde.localeCompare(b.desde))[0] || null;

  const lista = [], saltados = [];
  for (const m of mats) {
    const actual = ctDe(m);
    if (!uuid) {
      // Quitar es dejar libre desde ese día: lo de más adelante se respeta.
      if (actual && actual.desde <= d) lista.push({ matricula: m, turno: t, rol: 'ct', driverUuid: null, dias: null, desde: d, hasta: null });
      continue;
    }
    const bloque = reglas.descansoDe(m, null, d);
    if (!bloque.length) { saltados.push({ matricula: m, motivo: 'aún no tiene los días del bloque' }); continue; }
    if (actual && actual.uuid !== uuid) { saltados.push({ matricula: m, nombre: nombreDe(actual.uuid), motivo: 'ya lo lleva otro' }); continue; }
    // Como mucho hasta el último día con CT del coche (como en asignar): una
    // plaza de CT no sigue abierta en un coche que ya no lleva CT.
    const hastaCT = reglas.periodoCT(m, d).hasta || null;
    // Ya estaba así, desde antes y hasta el mismo día: nada que escribir.
    if (actual && mismos(actual.dias, bloque) && actual.desde <= d && (actual.hasta || null) === hastaCT) continue;
    lista.push({ matricula: m, turno: t, rol: 'ct', driverUuid: uuid, dias: bloque, desde: d, hasta: hastaCT });
  }

  if (uuid) {
    // La misma regla que de uno en uno: nadie lleva dos coches del mismo turno a
    // la vez. En un cuadrante sano los bloques no comparten día y esto no salta;
    // si salta, es una persona llevando dos coches el mismo día y hay que verlo
    // aquí, no en la calle. Cada coche se mira contra lo que ya lleva y contra
    // los otros coches que se le ponen ahora; lo que se sustituye no cuenta.
    const enLista = new Set(lista.map(y => y.matricula));
    const sustituida = a => a.turno === t && a.rol === 'ct' && enLista.has(a.matricula) && !String(a.id).startsWith('__cuadrante_');
    for (const x of lista) {
      const otras = lista.filter(y => y !== x).map((y, i) => ({ ...y, id: `__cuadrante_${i}__`, uuid }));
      const datos = { ...plan, asignaciones: [...plan.asignaciones, ...otras] };
      const choques = P.choques(datos, { matricula: x.matricula, turno: t, uuid, rol: 'ct', dias: x.dias, desde: d, hasta: x.hasta }, sustituida);
      if (choques.length) throw aviso(`${mensajeDoble(c.nombre || 'Esa persona', t, choques, x.matricula)} Quita ese bloque o cámbiale los días.`);
    }
  }

  // Los que de verdad han cambiado los dice el repositorio (lo que ya estaba
  // igual no se escribe).
  const hechos = lista.length ? await escribir(() => repo.asignarVarias(lista.map(x => ({ sede: SEDE, ...x, usuarioId })))) : [];
  const cambiados = (hechos || []).filter(r => !r || r.cambio !== false).length;
  olvidarPromediosSi(d);
  console.log(`🗓️ [BARCELONA] CT ${nombreTurno(t)} del C${q.numero} desde ${d}: ${c ? c.nombre : 'quitado'} en ` +
    `${lista.map(x => x.matricula).join(', ') || 'ningún coche'}${saltados.length ? `; saltados ${saltados.map(s => s.matricula).join(', ')}` : ''}`);
  return { cambiados, saltados, tablero: await tablero({ fecha: d }) };
}

// ── EL REPORTE DE HORAS ──────────────────────────────────────────────────────

const MAX_DIAS_REPORTE = 31;

/**
 * EL REPORTE DE HORAS de unas fechas (hasta 31 días). Sin fechas, ayer.
 * Cada fecha lleva su turno de día (00:00→24:00) y su noche (12:00→12:00 del
 * día siguiente): por eso se leen los ratos desde el mediodía de la víspera
 * hasta el mediodía del día después. A quién le tocaba lo dice el plan del día
 * (con sus libranzas y sus CT), no la asignación en crudo.
 */
async function reporte({ desde, hasta } = {}) {
  const hoy = hoyMadrid();
  let d1 = esFecha(desde) ? desde : sumar(hoy, -1);
  let d2 = esFecha(hasta) ? hasta : d1;
  if (d2 < d1) [d1, d2] = [d2, d1];
  if (d2 > hoy) d2 = hoy;
  if (d1 > d2) d1 = d2;
  if (H.fechasEntre(d1, d2).length > MAX_DIAS_REPORTE) throw new Error(`El reporte va de un día a ${MAX_DIAS_REPORTE}: elige un rango más corto.`);

  const iniMs = R.instante(R.sumarDias(d1, -1), R.INICIO.noche);
  const finMs = Math.min(Date.now(), R.instante(R.sumarDias(d2, 1), R.INICIO.noche));
  try {
    const [ivs, plan, conductores, coches] = await Promise.all([
      ratos(iniMs, finMs),
      planParaHoras(R.sumarDias(d1, -1), R.sumarDias(d2, 1)),
      repo.conductores(SEDE),
      repo.coches(SEDE),
    ]);
    return H.informe({ desde: d1, hasta: d2, ivs, ...plan, conductores, coches });
  } catch (e) {
    if (repo.faltaMigracion(e)) return { faltaMigracion: true, desde: d1, hasta: d2 };
    throw e;
  }
}

/** El Excel del reporte: { bytes, nombre }. */
async function reporteExcel(q = {}) {
  const datos = await reporte(q);
  if (datos.faltaMigracion) throw new Error('Falta aplicar la migración db/181 (en Migraciones): Barcelona aún no tiene horas.');
  const bytes = await require('./barcelona.excel').generar(datos);
  const dm = iso => iso.split('-').reverse().join('-');
  const nombre = datos.desde === datos.hasta
    ? `Horas Barcelona ${dm(datos.desde)}.xlsx`
    : `Horas Barcelona ${dm(datos.desde)} a ${dm(datos.hasta)}.xlsx`;
  return { bytes, nombre };
}

// ── LAS HORAS SEMANALES ──────────────────────────────────────────────────────

/**
 * LAS HORAS DE UNA SEMANA (la de `dia`, o la que corre). Se leen los ratos desde
 * el mediodía del domingo anterior (una noche que empezó entonces sigue el lunes)
 * hasta el mediodía del lunes siguiente (la noche del domingo acaba ahí).
 */
async function reporteSemanal({ dia } = {}) {
  const lunes = H.lunesDe(esFecha(dia) ? dia : hoyMadrid());
  const domingo = R.sumarDias(lunes, 6);
  if (lunes > hoyMadrid()) throw new Error('Esa semana todavía no ha empezado.');
  const iniMs = R.instante(R.sumarDias(lunes, -1), R.INICIO.noche);
  const finMs = Math.min(Date.now(), R.instante(R.sumarDias(domingo, 1), R.INICIO.noche));
  try {
    const [ivs, plan, conductores] = await Promise.all([
      ratos(iniMs, finMs),
      planParaHoras(R.sumarDias(lunes, -1), R.sumarDias(domingo, 1)),
      repo.conductores(SEDE),
    ]);
    return H.semana({ lunes, ivs, ...plan, conductores });
  } catch (e) {
    if (repo.faltaMigracion(e)) return { faltaMigracion: true, lunes, domingo };
    throw e;
  }
}

/** El Excel de la semana: { bytes, nombre }. */
async function reporteSemanalExcel(q = {}) {
  const datos = await reporteSemanal(q);
  if (datos.faltaMigracion) throw new Error('Falta aplicar la migración db/181 (en Migraciones): Barcelona aún no tiene horas.');
  const bytes = await require('./barcelona.excel').generarSemana(datos);
  const d = iso => iso.split('-').reverse().join('-');
  return { bytes, nombre: `Horas semanales Barcelona ${d(datos.lunes)} a ${d(datos.domingo)}${datos.resumen.cerrada ? '' : ' (en curso)'}.xlsx` };
}

module.exports = {
  SEDE, tablero, asignar, fijarDescanso, correturnos,
  crearZona, cambiarZona, crearCuadrante, cambiarCuadrante, borrarCuadrante, cocheEnCuadrante, ctDelCuadrante,
  hoyMadrid, ratos, planParaHoras, reporte, reporteExcel, cocheActivo, reporteSemanal, reporteSemanalExcel,
};
