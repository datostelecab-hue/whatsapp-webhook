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
// Barcelona así como en Madrid». Y: «Prácticamente será el mismo diseño de
// Madrid, solo que la arquitectura y flujo de datos cambia ya que no tenemos lo
// mismo».
//
// Y el mismo día, la reconstrucción de los correturnos (db/236): «los
// correturnos sí o sí van a ser una sola casilla cogiendo los coches que estén
// ahí, ojo, ninguna plaza se puede repetir… que se pueda agregar la casilla por
// jornada, tipo: Agregar CT al cuadrante, se abre con 3 opciones: día, noche,
// todoturno. Si se escoge día o noche no se puede elegir luego el todoturno y
// viceversa».
//
//   · Zonas y cuadrantes como Madrid (la zona es del cuadrante).
//   · Libranzas de la PLAZA (matrícula + turno): cada fijo libra lo suyo.
//   · El CT es una CASILLA DEL CUADRANTE (día, noche o todoturno) que coge las
//     plazas de sus coches el día que libran. Sin casilla de ese turno, el día
//     que libra el fijo el coche no sale.
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
/** Lo más adelante que puede empezar una escritura, en días desde hoy (fechaDe, fechaCT). */
const MAX_ADELANTE = 60;
/**
 * HASTA DÓNDE MIRAR LO ESCRITO: lo último que puede empezar algo es dentro de
 * MAX_ADELANTE días; desde ahí lo que valga vale para siempre y se repite cada
 * semana. Así que basta con mirar hasta UNA SEMANA ENTERA después (los siete
 * días de la semana de ese último estado) para no perderse nada de lo escrito
 * para más adelante. Antes eran 62 días: una libranza o una plaza puesta desde
 * dentro de 60 solo se miraba tres días, y un choque en otro día de la semana
 * se colaba.
 */
const topeEscrito = () => sumar(hoyMadrid(), MAX_ADELANTE + 6);
const ddmmaaaa = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const nombreTurno = t => (t === 'dia' ? 'de día' : 'de noche');
const NOMBRE_JORNADA = { dia: 'de día', noche: 'de noche', todoturno: 'todoturno' };
/** «CT de día», «CT de noche», «CT todoturno». */
const ctDe = j => `CT ${NOMBRE_JORNADA[j] || j}`;
const normMat = v => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
// El selector de la casa puede devolver { valor } (ver Componentes de la casa).
const uuidDe = v => (v && typeof v === 'object' ? String(v.valor || '') : String(v || '')).trim();
/** «a», «a y b», «a, b y c». */
const yLista = l => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`);

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
  if (d < sumar(hoy, -31) || d > sumar(hoy, MAX_ADELANTE)) throw aviso('La fecha tiene que estar entre un mes atrás y dos meses adelante.');
  return d;
}

/**
 * AGREGAR O QUITAR UNA CASILLA DE CT, nunca antes de hoy (como «Sin
 * correturnos» de Madrid): el pasado de ese cuadrante fue como fue y su
 * reporte tiene que seguir cuadrando (un día que libraba un fijo no pasa a ser
 * un hueco de hace dos semanas). Un día de antes vale como hoy.
 */
function fechaCT(desde) {
  fechaQueExista(desde);
  const hoy = hoyMadrid();
  const d = esFecha(desde) && desde > hoy ? desde : hoy;
  if (d > sumar(hoy, MAX_ADELANTE)) throw aviso('La fecha tiene que estar entre hoy y dos meses adelante.');
  return d;
}

/**
 * ¿FALTA UNA MIGRACIÓN? Si el error lo parece, se pregunta cuál (db/181, db/234
 * o db/236). Si están todas, es otro error y se lanza tal cual.
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
 * Entre desplegar y aplicar una migración se lee lo que haya, para que el
 * reporte y la Visibilidad sigan saliendo:
 *   · sin db/236 (sin casillas), todo menos las casillas: lo de antes, con sus
 *     CT por coche, que barcelona.plan sigue entendiendo;
 *   · sin db/234, lo de db/181: todos fijos, nadie libra.
 * Sin db/181 el error sigue su camino (quien llama ya dice «Falta aplicar la
 * migración db/181»).
 */
async function planParaHoras(desde, hasta) {
  try {
    return await repo.planEntre(SEDE, desde, hasta);
  } catch (e) {
    const falta = await migracionQueFalta(e);
    if (falta === 'db/236') return repo.planEntre(SEDE, desde, hasta, { casillas: false });
    if (falta !== 'db/234') throw e;
    return { asignaciones: await repo.asignacionesEntre(SEDE, desde, hasta), cts: [], descansos: [], casillas: [], cochesCuadrante: [] };
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
 * EL TABLERO DE UN DÍA: las zonas, los cuadrantes con sus casillas de CT, cada
 * coche con su descanso, sus dos fijos y qué pasa en cada turno, los
 * conductores con su promedio y quién se ha quedado sin plaza. La forma es el
 * contrato con la pantalla (docs/modulos/Barcelona.md, «La forma del tablero»):
 * lo decide todo el servidor y la pantalla solo pinta.
 */
async function tablero({ fecha } = {}) {
  const dia = esFecha(fecha) ? fecha : hoyMadrid();
  let conductores, coches, plan, est;
  try {
    [conductores, coches, plan, est] = await Promise.all([
      repo.conductores(SEDE), repo.coches(SEDE), repo.planEntre(SEDE, dia, dia), repo.estructura(SEDE),
    ]);
  } catch (e) {
    // Sin db/181, db/234 o db/236 la pantalla lo dice (con cuál) en vez de dar un error.
    return { faltaMigracion: await migracionQueFalta(e), fecha: dia, hoy: hoyMadrid() };
  }
  return armarTablero({ dia, conductores, coches, plan, est, promedioDe: await promedios() });
}

/** El tablero, con los datos ya leídos. */
function armarTablero({ dia, conductores, coches, plan, est, promedioDe }) {
  const reglas = P.crear(plan);
  // Las plazas de fijo de ese día (y, en un día de antes de db/236, los CT por coche).
  const vig = reglas.vigentesEn(dia);
  const casillasHoy = reglas.casillasVigentes(dia);
  const cuenta = new Map(conductores.map(c => [c.uuid, c]));
  const numeroDe = new Map(est.cuadrantes.map(q => [String(q.id), Number(q.numero)]));

  const base = uuid => {
    const c = cuenta.get(uuid) || {};
    return { uuid, nombre: c.nombre || 'Cuenta de BOLT desconocida', telefono: c.telefono || '', activa: activa(c) };
  };
  /** Los días de la semana que coge una casilla (con los descansos de ese día). */
  const diasDe = c => P.limpiarDias(reglas.cubreSemana(c, dia).map(x => x.dia));
  /** Una persona EN UNA PLAZA DE FIJO: con lo de esa asignación. */
  const persona = a => ({
    ...base(a.uuid), desde: a.desde, hasta: a.hasta || null, rol: a.rol, dias: a.rol === 'ct' ? a.dias.slice() : null,
    libraHoy: reglas.libra(a, dia), trabajaHoy: reglas.trabaja(a, dia), promedio: promedioDe(a.uuid),
  });
  /** La persona DE UNA CASILLA: libra el día que no coge nada; `dias`, los que coge. */
  const personaDeCasilla = c => {
    const hoy = reglas.ctDeLaCasilla(c, dia);
    return {
      ...base(c.uuid), desde: c.desde, hasta: c.hasta || null, rol: 'ct', dias: diasDe(c),
      libraHoy: !hoy, trabajaHoy: !!hoy, promedio: promedioDe(c.uuid),
    };
  };
  /** Dónde está cada uno ese día: sus plazas de fijo y su casilla (con lo que coge ese día). */
  const plazasDe = uuid => [
    ...vig.filter(a => a.uuid === uuid).map(a => ({
      matricula: a.matricula, turno: a.turno, rol: a.rol, dias: a.rol === 'ct' ? a.dias.slice() : null,
      desde: a.desde, hasta: a.hasta || null, libraHoy: reglas.libra(a, dia), trabajaHoy: reglas.trabaja(a, dia),
    })),
    ...casillasHoy.filter(c => c.uuid === uuid).map(c => {
      const hoy = reglas.ctDeLaCasilla(c, dia);
      return {
        matricula: hoy ? hoy.matricula : null, turno: hoy ? hoy.turno : null, rol: 'ct',
        cuadranteId: c.cuadranteId, cuadrante: numeroDe.get(c.cuadranteId) || null, jornada: c.jornada, dias: diasDe(c),
        desde: c.desde, hasta: c.hasta || null, libraHoy: !hoy, trabajaHoy: !!hoy,
      };
    }),
  ];
  /** Una persona SUELTA (conductores, sin plaza): libra o trabaja según sus plazas de ese día. */
  const suelta = uuid => {
    const suyas = plazasDe(uuid);
    const trabaja = suyas.some(p => p.trabajaHoy);
    return {
      ...base(uuid), desde: null, hasta: null, rol: null, dias: null,
      libraHoy: !trabaja && suyas.some(p => p.libraHoy), trabajaHoy: trabaja, promedio: promedioDe(uuid),
      plazas: suyas,
    };
  };

  // ── Los coches: los activos, y los desactivados solo si alguien los lleva o
  // están en un cuadrante. Una matrícula que ya no está ni en BOLT ni en
  // Vehículos pero sigue en una plaza o en un cuadrante no se esconde.
  //
  // El cuadrante de cada coche es el de ESE día (el historial, db/237), no el
  // de hoy: lo que coge cada casilla se calcula con los coches que estaban en
  // su cuadrante ese día, y la tabla tiene que enseñar lo mismo. Mirando un
  // día pasado, un coche que se movió sale donde estaba. Si aquel cuadrante ya
  // está dado de baja, va a «cuadrantes libres» (el cuadrante no se pinta).
  const vivos = new Set(est.cuadrantes.map(q => String(q.id)));
  const cuadranteDe = new Map();
  (plan.cochesCuadrante || []).forEach(x => {
    const q = reglas.cuadranteDe(x.matricula, dia);
    if (q != null && vivos.has(q)) cuadranteDe.set(x.matricula, q);
  });
  const conAsig = new Set(vig.map(a => a.matricula));
  const deLaSede = new Set(coches.map(c => c.matricula));
  const huerfanas = [...new Set([...conAsig, ...cuadranteDe.keys()])].filter(m => !deLaSede.has(m))
    .map(m => ({ matricula: m, modelo: '', estado: 'ya no es de la sede', enBolt: false, enErp: false, huerfana: true }));
  const fila = c => {
    const mat = c.matricula;
    const fijo = turno => { const a = vig.find(x => x.matricula === mat && x.turno === turno && x.rol === 'fijo'); return a ? persona(a) : null; };
    return {
      matricula: mat, modelo: c.modelo || '', enBolt: !!c.enBolt, enErp: !!c.enErp,
      activo: c.huerfana ? false : cocheActivo(c), estadoBolt: c.estado || '',
      cuadranteId: cuadranteDe.get(mat) || null,
      descansoTurno: { dia: reglas.descansoDe(mat, 'dia', dia), noche: reglas.descansoDe(mat, 'noche', dia) },
      plazas: { fijoDia: fijo('dia'), fijoNoche: fijo('noche') },
      turnos: { dia: reglas.estadoDelTurno(mat, 'dia', dia), noche: reglas.estadoDelTurno(mat, 'noche', dia) },
    };
  };
  const filas = [...coches.filter(c => cocheActivo(c) || conAsig.has(c.matricula) || cuadranteDe.has(c.matricula)), ...huerfanas]
    .map(fila)
    .sort((a, b) => (Number(b.activo) - Number(a.activo)) || a.matricula.localeCompare(b.matricula));

  // ── Los cuadrantes, con sus casillas de CT, y las zonas.
  const zonaPorId = new Map(est.zonas.map(z => [String(z.id), z]));
  const cochesDe = id => filas.filter(f => f.cuadranteId === String(id)).map(f => f.matricula).sort();
  const casilla = c => {
    const hoy = reglas.cubreEl(c, dia);
    return {
      jornada: c.jornada, desde: c.desde, hasta: c.hasta || null,
      persona: c.uuid ? personaDeCasilla(c) : null,
      cubre: reglas.cubreSemana(c, dia),
      libra: reglas.libraCasilla(c, dia),
      // Lo que coge ese día, esté vacía o no: vacía, eso es el hueco.
      hoy: hoy ? { matricula: hoy.matricula, turno: hoy.turno } : null,
      // No debería haber (las escrituras lo impiden), pero si las hay se dicen.
      repetidas: reglas.repetidasSemana(c, dia),
      // Ni esto: los días en que su persona dobla con una plaza fija suya (lo
      // pudo dejar la conversión de db/236). Se dice hasta que se arregle.
      dobles: reglas.doblesSemana(c, dia),
    };
  };
  const cuadrantes = est.cuadrantes.map(q => {
    const suyas = reglas.casillasEn(q.id, dia);
    const hay = new Set(suyas.map(c => c.jornada));
    const zona = q.zonaId ? zonaPorId.get(String(q.zonaId)) : null;
    return {
      id: String(q.id), numero: Number(q.numero), nombre: q.nombre || null,
      zonaId: zona ? String(zona.id) : null, zona: zona ? zona.nombre : null,
      coches: cochesDe(q.id),
      casillas: suyas.map(casilla),
      // Lo que admite «Agregar CT»: día y noche conviven; el todoturno, solo.
      puedeAgregar: {
        dia: !hay.has('dia') && !hay.has('todoturno'),
        noche: !hay.has('noche') && !hay.has('todoturno'),
        todoturno: hay.size === 0,
      },
    };
  }).sort((a, b) => (a.zona === null) - (b.zona === null) || String(a.zona || '').localeCompare(String(b.zona || ''), 'es')
    || a.numero - b.numero);
  const zonas = est.zonas.filter(z => z.activa).map(z => {
    const suyos = cuadrantes.filter(q => q.zonaId === String(z.id));
    return { id: String(z.id), nombre: z.nombre, cuadrantes: suyos.length, coches: suyos.reduce((s, q) => s + q.coches.length, 0) };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // ── La gente: los activos en BOLT, y quién de ellos no tiene plaza ese día
  // (ni de fijo ni en una casilla: quien libra ese día tiene plaza).
  const activos = conductores.filter(activa);
  const conPlaza = new Set([...vig.map(a => a.uuid), ...casillasHoy.filter(c => c.uuid).map(c => c.uuid)]);
  const sinPlaza = activos.filter(c => !conPlaza.has(c.uuid)).map(c => suelta(c.uuid));

  // ── Las cifras, de los coches que se pueden planificar. «Turnos» son los que
  // tienen que salir ese día (cubiertos + huecos); los que no salen porque
  // libra el fijo y no hay casilla que lo coja van aparte, en «libran»: no son
  // huecos. Cubiertos: los que lleva su fijo y los que coge el CT.
  const estados = filas.filter(f => f.activo).flatMap(f => [f.turnos.dia, f.turnos.noche]);
  return {
    fecha: dia, hoy: hoyMadrid(),
    zonas, cuadrantes, coches: filas,
    conductores: activos.map(c => suelta(c.uuid)),
    sinPlaza,
    resumen: {
      coches: filas.filter(f => f.activo).length,
      turnos: estados.filter(x => x !== 'libra').length,
      cubiertos: estados.filter(x => x === 'trabaja' || x === 'cubre-ct').length,
      huecos: estados.filter(x => x === 'hueco').length,
      libran: estados.filter(x => x === 'libra').length,
      sinPlaza: sinPlaza.length,
      casillas: cuadrantes.reduce((s, q) => s + q.casillas.length, 0),
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

/** «desde el 20/11/2026» si el choque empieza después del día que se escribe: si no, parecería que choca ya. */
const desdeCuando = (fecha, d) => (fecha > d ? ` desde el ${ddmmaaaa(fecha)}` : '');

/**
 * NINGUNA PLAZA SE REPITE, dicho para la pantalla. Camilo: «si el coche xxxx
 * tiene como libranza el de día el L, no puede haber otro coche descansando de
 * día el L ya que el correturno debe de coger las plazas que no se trabajan,
 * por lo que no puede coger dos coches a la vez». `rep` es lo que devuelve
 * reglas.plazasRepetidas; `cola`, qué hacer.
 *
 * «desde el …» solo si el choque no sale en la primera semana (viene de algo
 * escrito para más adelante): en la primera semana cada día sale una vez, y «el
 * V» ya es el próximo viernes.
 */
const mensajeRepetida = (rep, numero, d, cola) =>
  `El ${P.LETRAS[rep.dia - 1]} librarían ${yLista(rep.plazas.map(p => `el ${p.matricula} (${nombreTurno(p.turno)})`))} ` +
  `en el C${numero}${desdeCuando(rep.fecha, sumar(d, 6))}, y el ${ctDe(rep.jornada)} no puede coger dos plazas a la vez: ` +
  `ninguna plaza se puede repetir. ${cola}`;

/**
 * «el 1111AAA los L M de día y el 2222BBB (de CT) los X de noche»: con qué
 * dobla alguien (P.choques). «desde el …» si el choque empieza pasada la
 * primera semana desde `d` (viene de algo escrito para más adelante): si no,
 * parecería que choca ya.
 */
const doblesTxt = (choques, d) => yLista(choques.map(x =>
  `el ${x.matricula}${x.rol === 'ct' ? ' (de CT)' : ''} los ${P.letras(x.dias)} ${nombreTurno(x.turno)}` +
  (d && x.desde ? desdeCuando(x.desde, sumar(d, 6)) : '')));

/**
 * ¿DOBLA ALGUNA PERSONA DE LAS CASILLAS DEL CUADRANTE? Lo que coge una casilla
 * sale de las libranzas de sus coches: cambiar una libranza, o meter un coche,
 * cambia los días que trabaja su CT. Si con el plan COMO QUEDARÍA tuviera que
 * llevar un coche el mismo día y turno que ya lleva otro (es fijo en otro
 * coche), no se guarda. Se mira de `desde` a `tope` (lo último que puede haber
 * escrito), como al asignar: lo escrito para más adelante también cuenta.
 */
function doblanLasCasillas({ plan, cuadranteId, numero, desde, tope, conductores, antes }) {
  const nombreDe = u => (conductores.find(x => x.uuid === u) || {}).nombre || 'Cuenta de BOLT desconocida';
  for (const c of plan.casillas) {
    if (String(c.cuadranteId) !== String(cuadranteId) || !c.uuid || (c.hasta && c.hasta < desde)) continue;
    const ch = P.choques(plan, { cuadranteId: c.cuadranteId, jornada: c.jornada, uuid: c.uuid, desde: c.desde > desde ? c.desde : desde, hasta: c.hasta },
      x => x === c, tope);
    if (ch.length) {
      throw aviso(`${antes}, ${nombreDe(c.uuid)} (${ctDe(c.jornada)} del C${numero}) tendría que coger un coche los días que ya lleva ` +
        `${doblesTxt(ch, desde)}: nadie lleva dos coches a la vez.`);
    }
  }
}

/**
 * LOS CUADRANTES EN QUE ESTÁ (O ESTARÁ) UN COCHE de `desde` a `hasta`, con el
 * historial de la pertenencia (db/237): sus ids, sin repetir. Una libranza que
 * se cambia desde un día pasado toca también las casillas del cuadrante en que
 * estaba entonces.
 */
const cuadrantesDelCoche = (plan, matricula, desde, hasta) => [...new Set((plan.cochesCuadrante || [])
  .filter(x => x.matricula === matricula && x.cuadranteId != null
    && (!x.desde || x.desde <= hasta) && (!x.hasta || x.hasta >= desde))
  .map(x => String(x.cuadranteId)))];

/**
 * LA PERTENENCIA TRAS METER (O SACAR, `cuadranteId` null) UN COCHE DESDE UN
 * DÍA, como la deja repo.cocheEnCuadrante: lo suyo que empieza ese día se va,
 * lo que lo cubre se cierra la víspera, lo de más adelante se respeta y lo
 * nuevo dura hasta su víspera. Puro: para comprobar antes de escribir.
 */
function trasPertenencia(periodos, { matricula, cuadranteId, desde }) {
  const suyos = (periodos || []).filter(x => x.matricula === matricula);
  const sig = suyos.filter(x => x.desde && x.desde > desde).map(x => x.desde).sort()[0];
  const quedan = suyos
    .filter(x => !(x.desde === desde))
    .map(x => ((!x.desde || x.desde < desde) && (!x.hasta || x.hasta >= desde) ? { ...x, hasta: sumar(desde, -1) } : x));
  const nuevo = cuadranteId == null ? [] : [{ matricula, cuadranteId: String(cuadranteId), desde, hasta: sig ? sumar(sig, -1) : null }];
  return [...(periodos || []).filter(x => x.matricula !== matricula), ...quedan, ...nuevo];
}

/** El número de un cuadrante para los avisos (uno dado de baja ya no está en la estructura: «?»). */
const numeroDe = (est, id) => (est.cuadrantes.find(q => String(q.id) === String(id)) || {}).numero || '?';

/** Las escrituras que la base para (un solape que se coló) dichas para la pantalla. */
function traducir(e) {
  if (e && e.code === '23P01') {
    if (e.constraint === 'ex_sede_cuadrante_ct_persona') return aviso('Esa persona ya está en otra casilla de CT en esas fechas: recarga el tablero y vuelve a probar.');
    if (e.constraint === 'ex_sede_cuadrante_ct_solape') return aviso('Esa casilla se pisa con otra del cuadrante en esas fechas (el todoturno no convive con día ni con noche): recarga el tablero y vuelve a probar.');
    if (e.constraint === 'ex_sede_desc_solape') {
      return aviso('Esa libranza se pisa con otra de la misma matrícula en esas fechas (o con el descanso común del coche, de cuando ' +
        'los correturnos iban por coche): recarga el tablero y elige otra fecha.');
    }
    if (e.constraint === 'ex_sede_coche_cuadrante_solape') return aviso('Ese coche ya cambia de cuadrante en esas fechas: recarga el tablero y vuelve a probar.');
    return aviso('Eso se pisa con otro periodo de la misma matrícula: recarga el tablero y vuelve a probar.');
  }
  if (e && e.code === '23505') return aviso('Alguien acaba de cambiar lo mismo: recarga el tablero y vuelve a probar.');
  if (e && e.code === '23514' && /correturnos/.test(e.message || '')) return aviso(e.message);
  return e;
}
const escribir = async fn => { try { return await fn(); } catch (e) { throw traducir(e); } };

// ── LAS PLAZAS DE FIJO ──────────────────────────────────────────────────────

/**
 * PONER O QUITAR A ALGUIEN de fijo en una plaza (matrícula + turno) desde un
 * día. Trabaja todos los días menos los que libra su plaza. Si ya era fijo de
 * otra matrícula en ese turno, SE MUEVE (como hasta ahora).
 *
 * Nadie lleva dos coches del mismo turno a la vez: si los días que trabajaría
 * aquí se pisan con los de otra plaza suya de ese turno, o con los que coge su
 * casilla de CT, no se guarda y se dice con cuál (P.choques).
 *
 * Desde db/236 no hay plazas de CT por coche: el CT es una casilla del
 * cuadrante (personaCasilla). `rol: 'ct'` es un 400 que lo dice.
 */
async function asignar(body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const t = String(body.turno || '');
  const rol = body.rol ? String(body.rol) : 'fijo';
  const uuid = uuidDe(body.uuid !== undefined ? body.uuid : body.conductor);
  if (!TURNOS.includes(t)) throw aviso('El turno tiene que ser de día o de noche.');
  if (rol === 'ct') ctPorCoche();
  if (rol !== 'fijo') throw aviso('En una matrícula solo se pone a alguien de fijo: el correturnos es una casilla del cuadrante.');
  const d = fechaDe(body.desde);

  const [coches, conductores] = await Promise.all([repo.coches(SEDE), repo.conductores(SEDE)]);
  // Dejar libre una plaza vale siempre, también la de una matrícula que ya no es
  // de la sede (sale en el tablero para eso: para poder vaciarla).
  if (uuid) cocheDeLaSede(coches, mat);
  const c = uuid ? cuentaActiva(conductores, uuid) : null;

  if (uuid) {
    // Con qué choca, de `d` a lo último que puede haber escrito: una plaza o una
    // casilla suya que empieza dentro de tres semanas dobla igual que una de
    // mañana (con solo la semana, se colaba).
    const tope = topeEscrito();
    const plan = await repo.planEntre(SEDE, d, tope);
    // Lo que se va a cerrar al guardar no choca: su plaza fija de ese turno que
    // vale ese día (se mueve, o es esta misma). Lo escrito para más adelante se
    // respeta (repo.asignarEn): lo nuevo dura hasta su víspera, y así se le pasa
    // a P.choques para no contarle días que no va a trabajar aquí. Su casilla de
    // CT sí cuenta: no se toca.
    const apartar = a => a.matricula != null && (a.rol || 'fijo') === 'fijo' && a.turno === t && a.desde <= d;
    let hastaPrevista = null;
    plan.asignaciones.filter(a => a.desde > d && a.turno === t && (a.rol || 'fijo') === 'fijo' && (a.matricula === mat || a.uuid === uuid))
      .forEach(a => { const v = sumar(a.desde, -1); if (hastaPrevista == null || v < hastaPrevista) hastaPrevista = v; });
    const choques = P.choques(plan, { matricula: mat, turno: t, uuid, desde: d, hasta: hastaPrevista }, apartar, tope);
    if (choques.length) throw aviso(`${c.nombre || 'Esa persona'} ya lleva ${doblesTxt(choques, d)}: no puede llevar también el ${mat} esos días.`);
  }

  const r = await escribir(() => repo.asignar({ sede: SEDE, matricula: mat, turno: t, driverUuid: uuid || null, desde: d, usuarioId }));
  olvidarPromediosSi(d);
  console.log(`🗓️ [BARCELONA] ${mat} ${t === 'dia' ? 'día' : 'noche'} desde ${d}: ` +
    `${c ? c.nombre : 'libre'}${r.movidaDe ? ` (viene de ${r.movidaDe})` : ''}${r.cambio ? '' : ' (sin cambios)'}`);
  return { ...r, tablero: await tablero({ fecha: d }) };
}

/**
 * LO QUE YA NO EXISTE: el CT por coche (POST /api/ct, rol 'ct' al asignar) y
 * el CT del cuadrante coche a coche (POST /api/cuadrantes/:id/ct). Desde db/236
 * el CT es una casilla del cuadrante. Un 400 que lo dice, para quien llame
 * con la pantalla de antes abierta.
 */
function ctPorCoche() {
  throw aviso('Los correturnos ya no van por coche: son casillas del cuadrante (día, noche o todoturno). ' +
    'Usa «+ CT» en la cabecera del cuadrante y asigna a la persona en su casilla.');
}

// ── LA LIBRANZA DE CADA FIJO ────────────────────────────────────────────────

/**
 * EL PLAN TRAS FIJAR UNA LIBRANZA, como lo deja repo.ponerDescanso: la de esa
 * plaza que empezaba ese día se va, la que lo cubre se cierra la víspera, lo de
 * más adelante se respeta y la nueva dura hasta la víspera de lo siguiente de
 * esa plaza (el auto-corte de abrirDescanso). Devuelve el plan y hasta cuándo
 * vale lo nuevo (null = sin fin): a partir de ahí no cambia nada.
 */
function trasDescanso(plan, { matricula, turno, dias, desde }) {
  const mismo = x => x.matricula === matricula && x.turno === turno;
  const descansos = plan.descansos
    .filter(x => !(mismo(x) && x.desde === desde))
    .map(x => (mismo(x) && x.desde < desde && (!x.hasta || x.hasta >= desde) ? { ...x, hasta: sumar(desde, -1) } : x));
  // Hasta cuándo vale lo nuevo, también si es «no librar» (sin días): hasta la
  // víspera de lo siguiente que la plaza ya tiene escrito (o un común de antes
  // de db/236, que ocupa los dos turnos).
  const sig = plan.descansos
    .filter(x => x.matricula === matricula && x.desde > desde && (!x.turno || x.turno === turno))
    .map(x => x.desde).sort()[0];
  const hasta = sig ? sumar(sig, -1) : null;
  if (dias.length) descansos.push({ matricula, turno, dias, desde, hasta });
  return { plan: { ...plan, descansos }, hasta };
}

/**
 * FIJA LO QUE LIBRA EL FIJO DE UNA PLAZA (matrícula + turno, sol o luna) desde
 * un día. Sin días, deja de librar. Desde db/236 no hay descanso común del
 * coche (el bloque): cada fijo libra lo suyo.
 *
 * Si el coche está en un cuadrante con una casilla de CT que coge ese turno,
 * ninguna plaza se puede repetir: dos fijos que la casilla coge no libran el
 * mismo día. Se mira día a día con el plan COMO QUEDARÍA, de `d` a lo último
 * que puede haber escrito (lo que otro coche tiene escrito para más adelante
 * también cuenta), como hacía chocaEnElCuadrante con los bloques. Y la persona
 * de la casilla no puede acabar doblando (doblanLasCasillas).
 */
async function fijarDescanso(body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const t = body.turno == null ? '' : String(body.turno);
  if (!t) throw aviso('La libranza es de cada fijo: elige la de día (sol) o la de noche (luna). El descanso común del coche ya no existe: el correturnos es del cuadrante.');
  if (!TURNOS.includes(t)) throw aviso('El turno de la libranza es de día o de noche.');
  const d = fechaDe(body.desde);
  const dias = parsearDias(body.dias);
  if (dias === null) throw aviso('No entiendo los días. Escríbelos como L M X J V S D.');

  const tope = topeEscrito();
  const [coches, plan, est, conductores] = await Promise.all([
    repo.coches(SEDE), repo.planEntre(SEDE, d, tope), repo.estructura(SEDE), repo.conductores(SEDE),
  ]);
  cocheDeLaSede(coches, mat);
  // EL DESCANSO COMÚN DE ANTES DE db/236. db/236 lo cerró la víspera del día en
  // que se aplicó y abrió uno de día y otro de noche desde ese día. Corregir una
  // libranza desde antes de ese día pisaría el común (la base lo para,
  // ex_sede_desc_solape, y el aviso de «recarga» engañaba). No se parte: en esos
  // días el coche llevaba CT por coche, que cubría justo los días del común; si
  // el fijo librara otros, aquel CT doblaría o dejaría un hueco en días ya
  // cerrados, y sus filas ya no se pueden tocar (db/236 solo deja acortarlas).
  // Se dice claro y desde cuándo se puede.
  const comun = plan.descansos
    .filter(x => x.matricula === mat && !x.turno && (!x.hasta || x.hasta >= d))
    .sort((a, b) => String(b.hasta || '9999-12-31').localeCompare(String(a.hasta || '9999-12-31')))[0];
  if (comun) {
    throw aviso(`Hasta el ${comun.hasta ? ddmmaaaa(comun.hasta) : '(sin fin)'} el ${mat} tenía el descanso común del coche ` +
      `(${P.letras(comun.dias)}), de cuando los correturnos iban por coche, y esos días no se cambian desde aquí. ` +
      (comun.hasta ? `Pon la libranza desde el ${ddmmaaaa(sumar(comun.hasta, 1))}.` : 'Avisa a sistemas: tendría que estar cerrado (db/236).'));
  }
  if (dias.length) {
    // Los cuadrantes en que está el coche de `d` en adelante (con el
    // historial: desde un día pasado, también en el que estaba entonces). Lo
    // nuevo vale de `d` a la víspera de lo siguiente que la plaza ya tiene
    // escrito; de ahí en adelante no cambia nada, así que no se mira. Solo lo
    // que toca a esta plaza: un choque que ya hubiera entre otras no la para.
    const nuevo = trasDescanso(plan, { matricula: mat, turno: t, dias, desde: d });
    const hasta = nuevo.hasta || tope;
    const reglasNuevas = P.crear(nuevo.plan);
    for (const cuadranteId of cuadrantesDelCoche(plan, mat, d, hasta)) {
      const numero = numeroDe(est, cuadranteId);
      const rep = reglasNuevas.plazasRepetidas(cuadranteId, d, hasta, { matricula: mat, turno: t });
      if (rep) throw aviso(mensajeRepetida(rep, numero, d, 'Elige otro día.'));
      doblanLasCasillas({ plan: nuevo.plan, cuadranteId, numero, desde: d, tope, conductores, antes: 'Con esa libranza' });
    }
  }
  await escribir(() => repo.ponerDescanso({ sede: SEDE, matricula: mat, turno: t, dias, desde: d, usuarioId }));
  olvidarPromediosSi(d);
  console.log(`🗓️ [BARCELONA] ${mat} libranza ${nombreTurno(t)} desde ${d}: ${P.letras(dias) || 'no libra'}`);
  return { dias, tablero: await tablero({ fecha: d }) };
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

/**
 * Da de baja un cuadrante, si ya no tiene coches ni casillas de CT de hoy en
 * adelante. Con una casilla viva, su persona seguiría «en una casilla» (la base
 * no la deja estar en dos) de un cuadrante que ya no se ve: se pide quitarla
 * antes, como los coches.
 */
async function borrarCuadrante(id, body = {}) {
  const hoy = hoyMadrid();
  const [est, plan] = await Promise.all([repo.estructura(SEDE), repo.planEntre(SEDE, hoy, topeEscrito())]);
  const q = cuadranteVivo(est, id);
  const suyos = est.cochesCuadrante.filter(x => String(x.cuadranteId) === String(q.id));
  if (suyos.length) {
    throw aviso(`El C${q.numero} tiene ${suyos.length === 1 ? 'un coche' : suyos.length + ' coches'} ` +
      `(${suyos.map(x => x.matricula).join(', ')}): sácalos antes de borrarlo.`);
  }
  const casillas = [...new Set(plan.casillas.filter(c => String(c.cuadranteId) === String(q.id) && (!c.hasta || c.hasta >= hoy))
    .map(c => c.jornada))].sort((a, b) => P.JORNADAS.indexOf(a) - P.JORNADAS.indexOf(b));
  if (casillas.length) {
    throw aviso(`El C${q.numero} tiene ${yLista(casillas.map(ctDe))}: quita antes ${casillas.length === 1 ? 'la casilla' : 'las casillas'} y luego bórralo.`);
  }
  const r = await escribir(() => repo.bajaCuadrante({ sede: SEDE, id: q.id }));
  if (!r) throw aviso('No se ha podido borrar: alguien acaba de cambiarlo. Recarga la pantalla.');
  console.log(`🗓️ [BARCELONA] cuadrante C${q.numero} borrado`);
  return { borrado: true, ...(await tableroSi(body.fecha)) };
}

/**
 * METE O SACA UN COCHE de un cuadrante. Al meterlo, sus plazas pasan a ser de
 * las que cogen las casillas de CT del cuadrante, así que ninguna puede librar
 * el mismo día que otra que coja la misma casilla (Camilo: «ninguna plaza se
 * puede repetir»), y la persona de la casilla no puede acabar doblando.
 *
 * Se escribe SIEMPRE DESDE HOY, con historial (db/237, repo.cocheEnCuadrante):
 * lo de antes se cierra la víspera y no se reescribe. Así sacar o mover un
 * coche no le quita a su casilla los días ya cerrados en que lo cubrió (ni
 * manda sus horas a «Sin plaza», ni lo pinta «Libra» en el reporte). Desde hoy
 * vale para siempre, así que se mira de hoy hasta lo último que puede haber
 * escrito, no solo el día que se mira: una libranza o una casilla escritas
 * para más adelante también cuentan. `fecha` es solo el día del tablero que se
 * devuelve.
 */
async function cocheEnCuadrante(id, body = {}, usuarioId) {
  const mat = normMat(body.matricula);
  const quitar = body.quitar === true || body.quitar === 'true' || body.quitar === 1;
  const hoy = hoyMadrid();
  const tope = topeEscrito();
  const [coches, est, plan, conductores] = await Promise.all([
    repo.coches(SEDE), repo.estructura(SEDE), repo.planEntre(SEDE, hoy, tope), repo.conductores(SEDE),
  ]);
  const q = cuadranteVivo(est, id);
  const actual = (est.cochesCuadrante.find(x => x.matricula === mat) || {}).cuadranteId || null;
  if (quitar) {
    if (String(actual) !== String(q.id)) throw aviso(`El ${mat || '(vacía)'} no está en el C${q.numero}.`);
    await escribir(() => repo.cocheEnCuadrante({ sede: SEDE, matricula: mat, cuadranteId: null, desde: hoy, usuarioId }));
    return { sacado: mat, ...(await tableroSi(body.fecha)) };
  }
  cocheDeLaSede(coches, mat);
  if (String(actual) === String(q.id)) return { metido: mat, ...(await tableroSi(body.fecha)) };
  // El plan con el coche ya dentro desde hoy, como lo dejará el historial.
  const dentro = { ...plan, cochesCuadrante: trasPertenencia(plan.cochesCuadrante, { matricula: mat, cuadranteId: String(q.id), desde: hoy }) };
  const rep = P.crear(dentro).plazasRepetidas(q.id, hoy, tope, { matricula: mat });
  if (rep) throw aviso(mensajeRepetida(rep, q.numero, hoy, `Cámbiale antes la libranza al ${mat}.`));
  doblanLasCasillas({ plan: dentro, cuadranteId: q.id, numero: q.numero, desde: hoy, tope, conductores, antes: `Con el ${mat} en el C${q.numero}` });
  await escribir(() => repo.cocheEnCuadrante({ sede: SEDE, matricula: mat, cuadranteId: q.id, desde: hoy, usuarioId }));
  console.log(`🗓️ [BARCELONA] ${mat} al C${q.numero}${actual ? ' (sale de otro cuadrante)' : ''}`);
  return { metido: mat, ...(await tableroSi(body.fecha)) };
}

// ── LAS CASILLAS DE CT DEL CUADRANTE (db/236) ───────────────────────────────
// Camilo, 06/11/2026: «que se pueda agregar la casilla por jornada, tipo:
// Agregar CT al cuadrante, se abre con 3 opciones: día, noche, todoturno. Si se
// escoge día o noche no se puede elegir luego el todoturno y viceversa. Si es
// todoturno es una sola casilla sin logo. Si es día es una sola casilla con
// logo de sol. Si es noche es una sola casilla con logo de luna. Si es día y
// noche cada casilla con su logo. El correturno puesto tendrá como día de
// libranza el día que no coja ninguno de los coches en el cuadrante.»

/** La jornada de una casilla, o un aviso. */
function jornadaDe(v) {
  const j = String(v || '');
  if (!P.JORNADAS.includes(j)) throw aviso('El CT del cuadrante es de día, de noche o todoturno.');
  return j;
}
/** ¿No pueden convivir esas dos jornadas en el mismo cuadrante? La misma, o el todoturno con cualquiera. */
const excluyen = (a, b) => a === b || a === 'todoturno' || b === 'todoturno';
/** ¿Se pisan dos periodos [desde, hasta] (sin hasta, para siempre)? */
const sePisan = (a, b) => a.desde <= (b.hasta || '9999-12-31') && b.desde <= (a.hasta || '9999-12-31');

/**
 * AGREGA UNA CASILLA DE CT VACÍA al cuadrante desde un día (nunca antes de
 * hoy). La persona se pone después, en la propia casilla.
 *
 *   · Una de cada jornada, y el todoturno solo: ni día ni noche a la vez.
 *   · Lo escrito para más adelante se respeta: si el cuadrante ya tiene escrita
 *     una casilla que no puede convivir con esta, la nueva dura hasta su víspera.
 *   · Ninguna plaza se repite en lo que cogería, día a día hasta donde llega.
 */
async function agregarCasilla(id, body = {}, usuarioId) {
  const j = jornadaDe(body.jornada);
  const d = fechaCT(body.desde);
  const tope = topeEscrito();
  const [est, plan] = await Promise.all([repo.estructura(SEDE), repo.planEntre(SEDE, d, tope)]);
  const q = cuadranteVivo(est, id);
  const choca = plan.casillas.filter(c => String(c.cuadranteId) === String(q.id) && excluyen(c.jornada, j) && (!c.hasta || c.hasta >= d))
    .sort((a, b) => a.desde.localeCompare(b.desde));
  const ya = choca.find(c => c.desde <= d);
  if (ya) {
    if (ya.jornada === j) throw aviso(`El C${q.numero} ya tiene ${ctDe(j)}.`);
    throw aviso(`El C${q.numero} tiene ${ctDe(ya.jornada)}: no puede tener también ${ctDe(j)} ` +
      '(o día y noche, o todoturno). Quita antes la otra casilla.');
  }
  const hasta = choca.length ? sumar(choca[0].desde, -1) : null;
  const nueva = { id: '__nueva__', cuadranteId: String(q.id), jornada: j, uuid: null, desde: d, hasta };
  // Solo lo que cogería la nueva: una plaza que ya se repitiera en la otra
  // casilla del cuadrante (lo que dejó db/236) no impide agregar esta.
  const rep = P.crear({ ...plan, casillas: [...plan.casillas, nueva] }).plazasRepetidas(q.id, d, hasta || tope, { casillaId: nueva.id });
  if (rep) throw aviso(mensajeRepetida(rep, q.numero, d, 'Cambia antes una de esas libranzas.'));
  await escribir(() => repo.agregarCasilla({ sede: SEDE, cuadranteId: q.id, jornada: j, desde: d, hasta, usuarioId }));
  console.log(`🗓️ [BARCELONA] ${ctDe(j)} agregado al C${q.numero} desde ${d}${hasta ? ` hasta ${hasta}` : ''}`);
  return { casilla: { jornada: j, desde: d, hasta }, tablero: await tablero({ fecha: d }) };
}

/**
 * PONE, CAMBIA O VACÍA A LA PERSONA DE UNA CASILLA desde un día (como una
 * plaza: de un mes atrás a dos adelante, para corregir lo que se olvidó; pero
 * la casilla tiene que existir ese día).
 *
 *   · Una cuenta activa de BOLT de Barcelona.
 *   · En una sola casilla a la vez (no se mueve sola: se dice dónde está).
 *   · Sin doblar: los días que coge la casilla no pueden ser días en que ya
 *     lleva otro coche en ese turno (es fija en otro coche), de `d` a lo
 *     último que puede haber escrito (P.choques).
 *
 * Sin persona, la casilla queda vacía desde ese día: lo que coja, hueco.
 */
async function personaCasilla(id, jornada, body = {}, usuarioId) {
  const j = jornadaDe(jornada);
  const uuid = uuidDe(body.uuid !== undefined ? body.uuid : body.conductor);
  const d = fechaDe(body.desde);
  const tope = topeEscrito();
  const [conductores, est, plan] = await Promise.all([repo.conductores(SEDE), repo.estructura(SEDE), repo.planEntre(SEDE, d, tope)]);
  const q = cuadranteVivo(est, id);
  const actual = plan.casillas.find(c => String(c.cuadranteId) === String(q.id) && c.jornada === j && c.desde <= d && (!c.hasta || c.hasta >= d));
  if (!actual) throw aviso(`El C${q.numero} no tiene ${ctDe(j)} el ${ddmmaaaa(d)}: agrégalo antes con «+ CT».`);
  if ((actual.uuid || null) === (uuid || null)) return { cambio: false, tablero: await tablero({ fecha: d }) };

  let c = null;
  if (uuid) {
    c = cuentaActiva(conductores, uuid);
    const nueva = { cuadranteId: String(q.id), jornada: j, uuid, desde: d, hasta: actual.hasta || null };
    const otra = plan.casillas.find(x => x !== actual && x.uuid === uuid && sePisan(x, nueva));
    if (otra) {
      const n = (est.cuadrantes.find(x => String(x.id) === String(otra.cuadranteId)) || {}).numero;
      throw aviso(`${c.nombre} ya es ${ctDe(otra.jornada)}${n ? ` del C${n}` : ''}${desdeCuando(otra.desde, d)}: ` +
        'una persona está en una sola casilla. Quítala antes de allí.');
    }
    // Hasta lo último que puede haber escrito: una plaza fija suya que empieza
    // dentro de tres semanas también dobla.
    const choques = P.choques(plan, nueva, () => false, tope);
    if (choques.length) {
      throw aviso(`${c.nombre} ya lleva ${doblesTxt(choques, d)}: como ${ctDe(j)} del C${q.numero} tendría que coger otro coche ` +
        'esos días, y nadie lleva dos a la vez.');
    }
  }
  const r = await escribir(() => repo.personaCasilla({ sede: SEDE, cuadranteId: q.id, jornada: j, uuid: uuid || null, desde: d, usuarioId }));
  olvidarPromediosSi(d);
  console.log(`🗓️ [BARCELONA] ${ctDe(j)} del C${q.numero} desde ${d}: ${c ? c.nombre : 'vacía'}${r.cambio ? '' : ' (sin cambios)'}`);
  return { ...r, tablero: await tablero({ fecha: d }) };
}

/**
 * QUITA UNA CASILLA DE CT del cuadrante desde un día (nunca antes de hoy): su
 * persona sale y, desde ese día, el día que libra un fijo de esa jornada el
 * coche no sale. Lo escrito para más adelante en esa casilla también se va.
 */
async function quitarCasilla(id, jornada, body = {}, usuarioId) {
  const j = jornadaDe(jornada);
  const d = fechaCT(body.desde);
  const [est, plan] = await Promise.all([repo.estructura(SEDE), repo.planEntre(SEDE, d, topeEscrito())]);
  const q = cuadranteVivo(est, id);
  if (!plan.casillas.some(c => String(c.cuadranteId) === String(q.id) && c.jornada === j && (!c.hasta || c.hasta >= d))) {
    throw aviso(`El C${q.numero} no tiene ${ctDe(j)} desde el ${ddmmaaaa(d)}.`);
  }
  const r = await escribir(() => repo.quitarCasilla({ sede: SEDE, cuadranteId: q.id, jornada: j, desde: d, usuarioId }));
  console.log(`🗓️ [BARCELONA] ${ctDe(j)} quitado del C${q.numero} desde ${d}`);
  return { ...r, tablero: await tablero({ fecha: d }) };
}

// ── EL EXCEL DEL PLANIFICADOR ────────────────────────────────────────────────

/**
 * EL PLANIFICADOR DE UN DÍA EN EXCEL (Camilo, 06/11/2026: «no era imprimir sino
 * exportar en excel… no necesitamos eso en PDF sino en excel»). Lo que se ve:
 * el tablero del día, con la zona abierta (`zona`: su id, 'libres' o vacío) y
 * el buscador (`q`). El libro lo arma barcelona.planificador.excel.js.
 */
async function planificadorExcel({ fecha, zona, q } = {}) {
  const t = await tablero({ fecha });
  if (t.faltaMigracion) throw new Error(`Falta aplicar la migración ${t.faltaMigracion} (en Migraciones): el planificador de Barcelona aún no se puede exportar.`);
  const bytes = await require('./barcelona.planificador.excel').generar({
    tablero: t, zona: String(zona || ''), q: String(q || ''), ahora: new Date(),
  });
  return { bytes, nombre: `Planificador Barcelona ${t.fecha.split('-').reverse().join('-')}.xlsx` };
}

// ── EL REPORTE DE HORAS ──────────────────────────────────────────────────────

const MAX_DIAS_REPORTE = 31;

/**
 * EL REPORTE DE HORAS de unas fechas (hasta 31 días). Sin fechas, ayer.
 * Cada fecha lleva su turno de día (00:00→24:00) y su noche (12:00→12:00 del
 * día siguiente): por eso se leen los ratos desde el mediodía de la víspera
 * hasta el mediodía del día después. A quién le tocaba lo dice el plan del día
 * (con sus libranzas y las casillas de CT), no la asignación en crudo.
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
    const [ivs, plan, conductores, coches, rechazos] = await Promise.all([
      ratos(iniMs, finMs),
      planParaHoras(R.sumarDias(d1, -1), R.sumarDias(d2, 1)),
      repo.conductores(SEDE),
      repo.coches(SEDE),
      repo.rechazosEntre(SEDE, iniMs, finMs),
    ]);
    return H.informe({ desde: d1, hasta: d2, ivs, ...plan, conductores, coches, rechazos });
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
  SEDE, tablero, asignar, fijarDescanso, ctPorCoche,
  crearZona, cambiarZona, crearCuadrante, cambiarCuadrante, borrarCuadrante, cocheEnCuadrante,
  agregarCasilla, personaCasilla, quitarCasilla, planificadorExcel,
  hoyMadrid, ratos, planParaHoras, reporte, reporteExcel, cocheActivo, reporteSemanal, reporteSemanalExcel,
};
