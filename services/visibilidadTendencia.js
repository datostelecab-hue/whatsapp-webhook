// ============================================================
// VISIBILIDAD · LA TENDENCIA — cómo van las horas y cómo hemos crecido
// ============================================================
// Camilo, 25/10/2026: «en el gráfico que muestras los últimos 15 días, que se
// pueda agrandar: última semana, 15 días, 30 días, 2 meses, 1 año… gráficos
// mucho más profesionales, que muestren cómo van las horas actualmente y cómo
// hemos crecido». Tres preguntas, tres piezas:
//
//   · armarRango       las horas de un rango de días, por día, por semana o por
//                      mes, con la media móvil y el ritmo que pide la meta.
//   · compararMes      el mes elegido contra el anterior A LA MISMA ALTURA, y la
//                      proyección de cierre al ritmo de ahora contra la meta.
//   · crecimientoMensual  mes a mes: horas, horas por día y conductores al día.
//
// LO QUE NO HACE: recalcular el núcleo día a día. Una serie de un año serían 365
// consultas a fv_tramo por pintar un gráfico. Lee las fotos diarias (las de
// visibilidad_dia, más el histórico de BOLT de antes de julio) y solo HOY va en
// vivo, como en serieMes. La única excepción son los días del núcleo que se
// quedaron sin foto (un cron caído): se rellenan, pocos cada vez (TOPE_RELLENO).
// Las cifras de arriba de la pantalla (las del Inicio) siguen saliendo de
// visibilidad.resumen() y no se tocan desde aquí.
//
// Las reglas son funciones PURAS (fundirDias, validarRango, agruparSerie,
// proyectar, compararMes, crecimientoMensual): las prueba
// scripts/comprobar-visibilidad-tendencia.js y las comparte la Visibilidad de
// Barcelona (modules/Barcelona), que les pasa sus días en vez de los de Madrid.

const R = require('./flotaViva/repartoTurnos');    // sumarDias: caminar el calendario
const repo = require('./repo/visibilidadSerie');

const sumarDias = R.sumarDias;
const r1 = x => Math.round(x * 10) / 10;
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ── El calendario, siempre por fechas y a mediodía UTC ─────────────────────
// Nada de restar bloques de 24 h: el día del cambio de hora tiene 23 o 25 y
// «ayer» acababa siendo anteayer (Trampas conocidas). Las fechas viajan como
// 'AAAA-MM-DD' y se comparan como texto, que en ese formato ordena bien.
const mediodia = d => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd, 12); };
const diasEntre = (a, b) => Math.round((mediodia(b) - mediodia(a)) / 86400000);
const diaSemana = d => (new Date(mediodia(d)).getUTCDay() + 6) % 7;     // 0 = lunes
const lunesDe = d => sumarDias(d, -diaSemana(d));
const diasEnMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m 1-12
const diasDelMesDe = d => diasEnMes(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
// Una fecha de verdad: el formato, y que no sea un 30 de febrero (sumarDias la
// normalizaría a marzo y no sería la misma cadena).
const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && sumarDias(String(s), 0) === String(s);
const pct = (a, b) => (a == null || b == null || !(b > 0) ? null : r1((a / b - 1) * 100));

// ── Los topes ───────────────────────────────────────────────────────────────
// Tres años de días es más de lo que hay (los datos empiezan en 2026) y es lo
// más que se deja pedir: lo que entra por la URL lo controla cualquiera.
const TOPE_DIAS = 1100;
// Por días, como mucho seis meses: 186 barras ya no se leen ni en una pantalla
// ancha. Más largo, por semanas o por meses.
const TOPE_POR_DIA = 186;
// La media móvil de cada agrupación: una semana de días (quita el vaivén del
// fin de semana, que aquí es de 150 h), cuatro semanas, tres meses.
const VENTANA_MEDIA = { dia: 7, semana: 28, mes: 84 };
// Las agrupaciones que valen, en una lista: preguntar `VENTANA_MEDIA[x]` dejaba
// pasar «constructor», «__proto__» o «toString» (en un objeto normal también
// «existen»), y acababan en un 500 de PostgreSQL en vez del 400 con motivo.
const AGRUPACIONES = ['dia', 'semana', 'mes'];
// Con menos del 60 % de la ventana con datos, la media no se pinta: al principio
// de la historia sería la media de dos días y engañaría.
const MINIMO_MEDIA = 0.6;
// El periodo anterior de un rango tiene que estar casi entero (90 % de sus días
// con datos) para compararse: los 15 días de Barcelona contra un periodo que
// empezaba antes de su primer apunte (30/09, a media tarde) daban «+26,5 %».
const MINIMO_ANTERIOR = 0.9;
// Un mes con menos de siete días con datos no sirve de base para un %: el
// primer día de Barcelona (30/09, desde las 15:00) daría «+300 %» a octubre.
const DIAS_PARA_COMPARAR = 7;

function errorDeUsuario(msg) {
  return Object.assign(new Error(msg), { estado: 400 });
}

// ── LA REGLA DEL CONTRATO ───────────────────────────────────────────────────
/**
 * Qué vale cada día: lo de visibilidad_dia si tiene horas y, si no, lo del
 * histórico de BOLT (visibilidad_dia_historico, db/217). Un día sin horas en
 * ninguna de las dos NO está: un hueco no es un cero, y no baja ninguna media.
 *   nucleo     [{ dia, viajeSeg, esperaSeg, conductores }]
 *   historico  [{ dia, viajeSeg, esperaSeg, conductores, fuente }]
 * → Map('AAAA-MM-DD' → { viajeSeg, esperaSeg, conductores, origen, fuente })
 */
function fundirDias(nucleo = [], historico = []) {
  const m = new Map();
  historico.forEach(h => {
    if (h.viajeSeg + h.esperaSeg > 0) {
      m.set(h.dia, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg, conductores: h.conductores, origen: 'historico', fuente: h.fuente || null });
    }
  });
  // El núcleo manda donde tiene horas; donde está a cero, se queda el histórico.
  nucleo.forEach(n => {
    if (n.viajeSeg + n.esperaSeg > 0) {
      m.set(n.dia, { viajeSeg: n.viajeSeg, esperaSeg: n.esperaSeg, conductores: n.conductores || null, origen: 'nucleo', fuente: null });
    }
  });
  return m;
}

/**
 * HOY va en vivo por encima de su foto, como en serieMes: la foto de hoy la
 * reescribe el cron cada rato y siempre va por detrás. Si en vivo no hay nada
 * (las 00:05, o una copia local sin ingesta), hoy no tiene horas.
 */
function ponerHoy(dias, hoy, h) {
  if (h && h.viajeSeg + h.esperaSeg > 0) {
    dias.set(hoy, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg, conductores: h.conductores || null, origen: 'nucleo', fuente: null, vivo: true });
  } else {
    dias.delete(hoy);
  }
  return dias;
}

// ── EL RANGO PEDIDO ─────────────────────────────────────────────────────────
/**
 * Lee y comprueba lo que pide la pantalla. Acepta:
 *   ultimos=N        los N días cerrados y hoy (N de 1 a TOPE_DIAS − 1)
 *   desde=AAAA-MM-DD (o 'inicio': desde el primer día con datos)
 *   hasta=AAAA-MM-DD (por defecto hoy; lo que pase de hoy se corta en hoy)
 *   agrupar=dia|semana|mes (por defecto, según lo largo que sea)
 * Antes del primer día con datos no hay nada que pintar: se empieza ahí, y se
 * devuelve también lo pedido (`desdePedido`) para que la pantalla lo diga.
 * Las semanas empiezan en lunes y los meses el día 1, para que el primer cubo
 * sea entero y no una semana de dos días que parezca un hundimiento.
 */
function validarRango(q = {}, hoy, primerDia = null) {
  let hasta = q.hasta ? String(q.hasta).trim() : hoy;
  if (!esFecha(hasta)) throw errorDeUsuario('La fecha «hasta» no es válida: tiene que ser AAAA-MM-DD.');
  if (hasta > hoy) hasta = hoy;

  let desde, esInicio = false;
  if (q.ultimos != null && String(q.ultimos).trim() !== '') {
    const n = Number(q.ultimos);
    // N días cerrados y hoy son N + 1 días, que es lo que mide el tope. Con
    // «hasta TOPE_DIAS», ultimos=1100 pasaba aquí y lo rechazaba la cuenta de abajo.
    if (!Number.isInteger(n) || n < 1 || n > TOPE_DIAS - 1) throw errorDeUsuario(`«ultimos» tiene que ser un número de días entre 1 y ${TOPE_DIAS - 1}.`);
    desde = sumarDias(hasta, -n);
  } else if (!q.desde || String(q.desde).trim() === 'inicio') {
    desde = primerDia || sumarDias(hasta, -30);
    esInicio = true;
  } else {
    desde = String(q.desde).trim();
    if (!esFecha(desde)) throw errorDeUsuario('La fecha «desde» no es válida: tiene que ser AAAA-MM-DD.');
  }
  if (desde > hasta) throw errorDeUsuario('«desde» va después de «hasta».');
  const desdePedido = desde;
  if (primerDia && desde < primerDia) desde = primerDia > hasta ? hasta : primerDia;
  // «Todo» son, como mucho, los últimos TOPE_DIAS días. Sin este recorte, el día
  // que la historia pase de tres años (hacia enero de 2029) el botón daría
  // siempre un 400; un «desde» escrito a mano sí se rechaza, abajo.
  if (esInicio && diasEntre(desde, hasta) + 1 > TOPE_DIAS) desde = sumarDias(hasta, -(TOPE_DIAS - 1));

  const n = diasEntre(desde, hasta) + 1;
  if (n > TOPE_DIAS) throw errorDeUsuario(`El rango no puede pasar de ${TOPE_DIAS} días.`);
  let agrupacion = q.agrupar ? String(q.agrupar).trim() : '';
  if (agrupacion && !AGRUPACIONES.includes(agrupacion)) throw errorDeUsuario('«agrupar» tiene que ser dia, semana o mes.');
  if (!agrupacion) agrupacion = n <= 62 ? 'dia' : n <= 400 ? 'semana' : 'mes';
  if (agrupacion === 'dia' && n > TOPE_POR_DIA) throw errorDeUsuario(`Por días, como mucho ${TOPE_POR_DIA}: agrupa por semana o por mes.`);
  if (agrupacion === 'semana') desde = lunesDe(desde);
  if (agrupacion === 'mes') desde = desde.slice(0, 8) + '01';
  return { desde, hasta, desdePedido, agrupacion, dias: diasEntre(desde, hasta) + 1 };
}

/**
 * La media de horas por día de los días CERRADOS con datos de [a, b]. Hoy no
 * entra nunca: va a medias y hundiría cualquier media.
 */
function mediaEntre(dias, a, b, hoy) {
  let s = 0, n = 0;
  for (let d = a; d <= b; d = sumarDias(d, 1)) {
    if (d >= hoy) break;
    const f = dias.get(d);
    if (f) { s += (f.viajeSeg + f.esperaSeg) / 3600; n++; }
  }
  return { media: n ? s / n : null, n };
}

/** La media móvil (h/día) de la ventana que acaba en `fin`, si hay datos suficientes. */
function mediaMovil(dias, fin, ventana, hoy) {
  const { media, n } = mediaEntre(dias, sumarDias(fin, -(ventana - 1)), fin, hoy);
  return n >= Math.ceil(ventana * MINIMO_MEDIA) ? media : null;
}

/**
 * LOS CUBOS DE UN RANGO (pura). Por días, cada punto es el día; por semanas o
 * meses, es la MEDIA DIARIA del periodo (h/día). Así el eje dice lo mismo en
 * todos los rangos —horas por día—, la línea de la meta vale para todos y una
 * semana a medias no parece un hundimiento. El total del periodo va aparte.
 *
 * Hoy está marcado (`enCurso`) y su valor es el parcial en vivo: por días, la
 * barra de hoy; por semanas o meses NO entra en la media del cubo (bajaría la
 * semana entera a las diez de la mañana) y se da aparte en `hoy`.
 *
 *   dias  Map de fundirDias (con días de antes de `desde` para la media móvil)
 *   meta  la meta del mes: el ritmo que pide es meta ÷ días de CADA mes
 */
function agruparSerie({ dias, desde, hasta, hoy, agrupacion, meta = 0 }) {
  const claveDe = d => (agrupacion === 'dia' ? d : agrupacion === 'semana' ? lunesDe(d) : d.slice(0, 7));
  const ventana = VENTANA_MEDIA[agrupacion];
  const ayer = sumarDias(hoy, -1);
  const cubos = [];
  let c = null;
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
    const k = claveDe(d);
    if (!c || c.clave !== k) { c = { clave: k, desde: d, hasta: d, lista: [] }; cubos.push(c); }
    c.hasta = d;
    c.lista.push(d);
  }
  return cubos.map(cubo => {
    let cerradas = 0, nCerr = 0, viaje = 0, espera = 0, condSum = 0, condN = 0, ritmoSum = 0;
    let hoyH = null, condHoy = null;
    const origenes = new Set(), fuentes = new Set();
    cubo.lista.forEach(d => {
      if (meta > 0) ritmoSum += meta / diasDelMesDe(d);
      const f = dias.get(d);
      if (!f || d > hoy) return;
      const h = (f.viajeSeg + f.esperaSeg) / 3600;
      viaje += f.viajeSeg; espera += f.esperaSeg;
      origenes.add(f.origen);
      if (f.fuente) fuentes.add(f.fuente);
      if (d === hoy) { hoyH = h; condHoy = f.conductores || null; return; }
      cerradas += h; nCerr++;
      if (f.conductores > 0) { condSum += f.conductores; condN++; }
    });
    const enCurso = cubo.desde <= hoy && hoy <= cubo.hasta;
    let valor;
    if (agrupacion === 'dia') valor = enCurso ? hoyH : (nCerr ? cerradas : null);
    else valor = nCerr ? cerradas / nCerr : null;
    const efectivas = viaje + espera;
    const media = mediaMovil(dias, cubo.hasta < ayer ? cubo.hasta : ayer, ventana, hoy);
    return {
      clave: cubo.clave, desde: cubo.desde, hasta: cubo.hasta,
      dias: cubo.lista.length, diasConDatos: nCerr, enCurso,
      valor: valor == null ? null : r1(valor),
      total: r1(cerradas + (hoyH || 0)),
      hoy: hoyH == null ? null : r1(hoyH),
      viajeH: r1(viaje / 3600), esperaH: r1(espera / 3600),
      utilizacion: efectivas > 0 ? Math.round((viaje / efectivas) * 1000) / 10 : null,
      conductores: agrupacion === 'dia' && enCurso ? condHoy : (condN ? Math.round(condSum / condN) : null),
      media: media == null ? null : r1(media),
      ritmoMeta: meta > 0 ? Math.round(ritmoSum / cubo.lista.length) : null,
      origen: origenes.size === 0 ? null : origenes.size > 1 ? 'mixto' : [...origenes][0],
      fuentes: [...fuentes],
    };
  });
}

/**
 * Lo que dice el rango en cifras: la media diaria de sus días cerrados contra la
 * del periodo de la misma longitud justo antes («+6 % frente a los 30 días
 * anteriores»), contra el ritmo que pide la meta, el mejor punto y lo que lleva
 * hoy. Si el periodo anterior no está casi entero (MINIMO_ANTERIOR: al principio
 * de la historia), no hay comparación.
 *
 * «LA MISMA LONGITUD» SON LOS DÍAS CERRADOS DE ESTE PERIODO, no los del rango
 * pedido: «15 días» son 15 cerrados más hoy, y hoy no entra en la media. Medir el
 * anterior con los 16 del rango (y por semanas, con el lunes adelantado) metía un
 * día de más en un lado, y aquí el fin de semana va 100-150 h por encima del
 * lunes: con semanas idénticas daba −1,8 % en «Semana» y +1,8 % en «15 días».
 *
 * EL RITMO DE LA META, de los MISMOS días que la media (meta ÷ días de su mes,
 * día a día): con la media de los ritmos de cada barra, los cubos de un mes corto
 * pesaban como uno largo y el % no salía con el ritmo que se leía debajo.
 */
function resumenRango({ dias, puntos, desde, hasta, hoy, meta = 0 }) {
  const ayer = sumarDias(hoy, -1);
  const fin = hasta < ayer ? hasta : ayer;
  const actual = mediaEntre(dias, desde, fin, hoy);
  const nCerrados = Math.max(1, diasEntre(desde, fin) + 1);
  const antDesde = sumarDias(desde, -nCerrados), antHasta = sumarDias(desde, -1);
  const anterior = mediaEntre(dias, antDesde, antHasta, hoy);
  const basta = anterior.n >= Math.max(1, Math.ceil(nCerrados * MINIMO_ANTERIOR));
  const cerrados = puntos.filter(p => !p.enCurso && p.valor != null);
  const mejor = cerrados.reduce((m, p) => (m == null || p.valor > m.valor ? p : m), null);
  const deHoy = puntos.find(p => p.enCurso);
  // El ritmo de la meta de los días que hacen la media (los cerrados con datos).
  const ritmos = [];
  if (meta > 0) for (let d = desde; d <= fin; d = sumarDias(d, 1)) if (dias.get(d)) ritmos.push(meta / diasDelMesDe(d));
  const ritmo = ritmos.length ? ritmos.reduce((s, x) => s + x, 0) / ritmos.length : null;
  return {
    media: actual.media == null ? null : r1(actual.media),
    diasConDatos: actual.n,
    total: r1(puntos.reduce((s, p) => s + (p.total || 0), 0)),
    anterior: basta ? { desde: antDesde, hasta: antHasta, dias: nCerrados, media: r1(anterior.media), diasConDatos: anterior.n } : null,
    cambioPct: basta ? pct(actual.media, anterior.media) : null,
    // Si el periodo cruza meses de distinta longitud, el ritmo es una media y la
    // pantalla lo dice («de media»); si no, es el de ese mes.
    ritmoMeta: ritmo == null ? null : Math.round(ritmo),
    ritmoMetaVaria: ritmos.length > 0 && Math.min(...ritmos) !== Math.max(...ritmos),
    vsMetaPct: ritmo == null ? null : pct(actual.media, ritmo),
    mejor: mejor ? { clave: mejor.clave, desde: mejor.desde, hasta: mejor.hasta, valor: mejor.valor } : null,
    hoy: deHoy && deHoy.hoy != null ? deHoy.hoy : null,
  };
}

/**
 * EL RANGO ENTERO: comprueba, carga lo justo (con lo de antes para la media móvil
 * y para el periodo anterior), agrupa y resume. `cargarDias(desde, hasta)` es de
 * cada sede y devuelve { dias: Map, faltaHistorico? } con hoy ya en vivo.
 */
async function armarRango({ q, hoy, primerDia, meta, cargarDias }) {
  const v = validarRango(q, hoy, primerDia);
  const atras = Math.max(VENTANA_MEDIA[v.agrupacion], v.dias);
  const { dias, faltaHistorico = false } = await cargarDias(sumarDias(v.desde, -atras), v.hasta);
  const puntos = agruparSerie({ dias, desde: v.desde, hasta: v.hasta, hoy, agrupacion: v.agrupacion, meta });
  return {
    ...v, hoy, primerDia, meta: meta || null, ventanaMedia: VENTANA_MEDIA[v.agrupacion], faltaHistorico,
    puntos,
    resumen: resumenRango({ dias, puntos, desde: v.desde, hasta: v.hasta, hoy, meta }),
  };
}

// ── LA PROYECCIÓN DE CIERRE ─────────────────────────────────────────────────
/**
 * Cómo cerraría el mes AL RITMO DE AHORA (pura). El ritmo es la media de los
 * últimos 7 días cerrados, crucen o no el cambio de mes: el día 2 la media del
 * mes sería la de un solo día, y siete días llevan dentro un fin de semana
 * entero, que aquí pesa (sábado y domingo van 100-150 h por encima del lunes).
 *   cierre = horas de los días cerrados + ritmo × días que quedan (hoy incluido)
 * Un día cerrado sin datos cuenta como cero en lo hecho: ya pasó.
 *   diasMes   los días del mes
 *   cerradas  horas de cada día cerrado del mes, en orden (null si no hay dato)
 *   previos   horas de los días cerrados de justo antes del mes (para el ritmo)
 */
function proyectar({ diasMes, cerradas = [], previos = [] }) {
  const validos = [...previos, ...cerradas].filter(v => v != null && v > 0);
  const ultimos = validos.slice(-7);
  if (ultimos.length < 3) return null;
  const ritmo = ultimos.reduce((s, v) => s + v, 0) / ultimos.length;
  const conDatos = cerradas.filter(v => v != null && v > 0);
  const real = conDatos.reduce((s, v) => s + v, 0);
  const quedan = Math.max(0, diasMes - cerradas.length);
  return {
    ritmo: r1(ritmo),
    ritmoMes: conDatos.length ? r1(real / conDatos.length) : null,
    real: r1(real), quedan,
    cierre: Math.round(real + ritmo * quedan),
  };
}

/** La proyección contra la meta: el % de la meta y el ritmo que hace falta desde hoy. */
function contraMeta(p, meta) {
  if (!p) return null;
  if (!(meta > 0)) return { ...p, meta: null, pctMeta: null, faltan: null, ritmoNecesario: null };
  return {
    ...p, meta,
    pctMeta: r1((p.cierre / meta) * 100),
    faltan: Math.max(0, Math.round(meta - p.real)),
    ritmoNecesario: p.quedan > 0 ? Math.max(0, Math.round((meta - p.real) / p.quedan)) : null,
  };
}

// ── CÓMO VAMOS: EL MES CONTRA EL ANTERIOR A LA MISMA ALTURA ────────────────
/**
 * Compara el mes elegido con el anterior (pura). Las dos series son las de
 * serieMes (o la de Barcelona, que tiene la misma forma).
 *
 * EN EL MES EN CURSO, A LA MISMA ALTURA: el último día cerrado (ayer; hoy va a
 * medias y siempre saldría por detrás) contra el mismo día del anterior. Si el
 * anterior es más corto, se compara con su último día y se dice cuál.
 *
 * UN MES CERRADO SE COMPARA ENTERO: total contra total, y por día la media de
 * los días con datos de cada uno, que es lo que hace «Cómo hemos crecido». Antes
 * se cortaba el anterior en el día 30 aunque el elegido ya hubiera cerrado, y la
 * misma pantalla daba tres cifras para lo mismo: septiembre salía −6,0 % frente
 * a agosto (a día 30), −9,5 % en su cierre y −6,4 % en el crecimiento.
 *
 * El corte de un mes cerrado es su ÚLTIMO DÍA CON HORAS, o 0 si no tiene
 * ninguna: diciembre de 2025, sin un dato, salía «cerró con 0 h, −30.000 h sobre
 * el ideal», como si hubiera sido una catástrofe y no un mes sin datos.
 */
function compararMes({ actual, anterior }) {
  const dias = actual.dias || [];
  const meta = Number((actual.config || {}).meta) || 0;
  const conHoras = d => !!d && d.total > 0;
  const ultimoConHoras = lista => { for (let i = lista.length - 1; i >= 0; i--) if (conHoras(lista[i])) return i + 1; return 0; };
  const mesCerrado = !actual.esMesActual;
  const corte = mesCerrado
    ? ultimoConHoras(dias.slice(0, actual.ultimoConDatos || 0))
    : Math.max(0, (actual.hoyDia || 1) - 1);
  const totalDe = d => (d && d.total > 0 ? d.total : null);
  const enCorte = corte > 0 ? dias[corte - 1] : null;
  const antDias = (anterior && anterior.dias) || [];
  const acum = enCorte ? enCorte.acumulado : null;
  const nAct = dias.slice(0, corte).filter(conHoras).length;    // días con horas hasta el corte
  let hayAnterior, corteAnt, acumAnt, conDatosAnt, mediaDia, mediaDiaAnterior;
  if (mesCerrado) {
    // El mes entero contra el mes entero. El anterior sirve de base con
    // DIAS_PARA_COMPARAR días con datos (el septiembre de Barcelona es uno).
    conDatosAnt = antDias.filter(conHoras).length;
    hayAnterior = corte > 0 && conDatosAnt >= DIAS_PARA_COMPARAR;
    corteAnt = hayAnterior ? ultimoConHoras(antDias) : 0;
    acumAnt = hayAnterior ? antDias[corteAnt - 1].acumulado : null;
    mediaDia = acum != null && nAct ? acum / nAct : null;
    mediaDiaAnterior = hayAnterior ? acumAnt / conDatosAnt : null;
  } else {
    // El anterior solo sirve de base si tiene datos hasta esa altura: Barcelona
    // empezó el 30/09 y su septiembre (un día, por la tarde) daba «+3.092 h» a
    // octubre a día 24, comparando contra cero. Hacen falta tantos días con datos
    // como días se comparan, hasta DIAS_PARA_COMPARAR.
    const alto = Math.min(corte, antDias.length);
    conDatosAnt = antDias.slice(0, alto).filter(conHoras).length;
    hayAnterior = alto > 0 && conDatosAnt >= Math.min(DIAS_PARA_COMPARAR, alto);
    corteAnt = hayAnterior ? alto : 0;
    acumAnt = corteAnt > 0 ? antDias[corteAnt - 1].acumulado : null;
    mediaDia = acum != null ? acum / corte : null;
    mediaDiaAnterior = acumAnt != null ? acumAnt / corteAnt : null;
  }

  // La proyección solo tiene sentido con el mes corriendo; uno cerrado ya tiene cierre.
  let proyeccion = null, cierre = null;
  if (actual.esMesActual) {
    const p = contraMeta(proyectar({
      diasMes: actual.diasMes,
      cerradas: dias.slice(0, corte).map(totalDe),
      previos: antDias.slice(-7).map(totalDe),
    }), meta);
    if (p) {
      // La línea de puntos del gráfico: del último día cerrado a fin de mes, al ritmo.
      const desde = acum || 0;
      p.serie = [];
      for (let d = corte; d <= actual.diasMes; d++) p.serie.push({ dia: d, acumulado: Math.round(desde + p.ritmo * (d - corte)) });
    }
    proyeccion = p;
  } else if (corte > 0) {
    const total = r1(actual.total || 0);
    cierre = {
      total,
      pctMeta: meta > 0 ? r1((total / meta) * 100) : null,
      // La misma cuenta que la cifra de «Frente a …»: total contra total.
      vsAnteriorPct: hayAnterior ? pct(total, anterior.total) : null,
    };
  }

  return {
    corte, meta: meta || null,
    // Cómo se ha comparado: el mes entero (uno cerrado) o a la misma altura.
    mesEntero: mesCerrado,
    sinDatos: mesCerrado && corte === 0,
    acumulado: acum, diasConDatos: nAct,
    anterior: hayAnterior ? { dia: corteAnt, acumulado: acumAnt, total: r1(anterior.total || 0), diasConDatos: conDatosAnt } : null,
    diferencia: acum != null && acumAnt != null ? r1(acum - acumAnt) : null,
    diferenciaPct: acum != null && acumAnt != null ? pct(acum, acumAnt) : null,
    mediaDia: mediaDia == null ? null : r1(mediaDia),
    mediaDiaAnterior: mediaDiaAnterior == null ? null : r1(mediaDiaAnterior),
    ideal: enCorte && meta > 0 ? enCorte.ideal : null,
    brecha: enCorte && meta > 0 ? enCorte.brecha : null,
    critico: enCorte && meta > 0 ? enCorte.critico : null,
    sobreCritico: enCorte && meta > 0 ? enCorte.sobreCritico : null,
    // Lo que lleva hoy, aparte: va a medias y no entra en ninguna cuenta de arriba.
    hoy: actual.esMesActual && actual.hoyDia ? (dias[actual.hoyDia - 1] || {}).total || 0 : null,
    proyeccion, cierre,
  };
}

/**
 * La serie del mes con su comparación: lo que pinta «Cómo vamos» y, debajo, la
 * tabla y las cifras del mes (la misma serie de siempre, sin tocar).
 */
function armarComoVamos(actual, anterior) {
  return {
    ...actual,
    anterior: {
      anio: anterior.anio, mes: anterior.mes, diasMes: anterior.diasMes, total: anterior.total,
      dias: (anterior.dias || []).map(d => ({ dia: d.dia, total: d.total, acumulado: d.acumulado, ...(d.origen ? { origen: d.origen } : {}) })),
    },
    comoVamos: compararMes({ actual, anterior }),
  };
}

// ── CÓMO HEMOS CRECIDO: MES A MES ───────────────────────────────────────────
/**
 * Un renglón por mes desde el primero con datos (pura):
 *   horas            las del mes (días cerrados + hoy en vivo)
 *   horasDia         la media de sus días cerrados con datos: un febrero de 28
 *                    días y un marzo de 31 se comparan sin trampa
 *   conductoresDia   la media de conductores que trabajaron cada día (los de
 *                    visibilidad_dia.conductores: quien hizo viaje o espera)
 *   horasPorConductor  horasDia ÷ conductoresDia: ¿crecemos por más gente o
 *                    porque cada uno hace más?
 *   origen           de dónde sale el mes: 'nucleo', 'historico' o 'mixto'
 * El mes en curso lleva su proyección APARTE (`proyeccion`), nunca sumada a lo
 * real. Los % frente al mes anterior solo se dan entre meses con al menos
 * DIAS_PARA_COMPARAR días con datos; en el mes en curso, el de las horas compara
 * su proyección (y lo dice `cambioHorasEsProyeccion`).
 */
function crecimientoMensual({ dias, hoy, meta = 0 }) {
  const claves = [...dias.keys()].filter(d => d <= hoy).sort();
  if (!claves.length) return { meses: [], resumen: null };
  const meses = [];
  const cerradosAntes = [];          // los días cerrados, en orden, para el ritmo de la proyección
  let ym = claves[0].slice(0, 7);
  const ymHoy = hoy.slice(0, 7);
  while (ym <= ymHoy) {
    const [y, m] = ym.split('-').map(Number);
    const dm = diasEnMes(y, m);
    let suma = 0, n = 0, condSum = 0, condN = 0, diasCerrados = 0, hoyH = null;
    const origenes = new Set(), fuentes = new Set(), cerradas = [];
    const previos = cerradosAntes.slice(-7);
    for (let i = 1; i <= dm; i++) {
      const d = `${ym}-${String(i).padStart(2, '0')}`;
      if (d > hoy) break;
      const f = dias.get(d);
      const h = f ? (f.viajeSeg + f.esperaSeg) / 3600 : null;
      if (f) { origenes.add(f.origen); if (f.fuente) fuentes.add(f.fuente); }
      if (d === hoy) { hoyH = h; continue; }
      diasCerrados++;
      cerradas.push(h);
      cerradosAntes.push(h);
      if (f) {
        suma += h; n++;
        if (f.conductores > 0) { condSum += f.conductores; condN++; }
      }
    }
    const enCurso = ym === ymHoy;
    const horasDia = n ? suma / n : null;
    const conductoresDia = condN ? condSum / condN : null;
    meses.push({
      mes: ym, diasMes: dm, diasCerrados, diasConDatos: n, enCurso,
      horas: r1(suma + (hoyH || 0)), horasCerradas: r1(suma),
      hoy: hoyH == null ? null : r1(hoyH),
      horasDia: horasDia == null ? null : r1(horasDia),
      conductoresDia: conductoresDia == null ? null : r1(conductoresDia),
      horasPorConductor: horasDia != null && conductoresDia ? r1(horasDia / conductoresDia) : null,
      origen: origenes.size === 0 ? null : origenes.size > 1 ? 'mixto' : [...origenes][0],
      fuentes: [...fuentes],
      proyeccion: enCurso ? contraMeta(proyectar({ diasMes: dm, cerradas, previos }), meta) : null,
    });
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  // Los % frente al mes anterior, solo entre meses que se pueden comparar.
  const comparable = x => x && x.diasConDatos >= DIAS_PARA_COMPARAR;
  meses.forEach((x, i) => {
    const prev = meses[i - 1];
    const ok = comparable(x) && comparable(prev);
    x.comparable = comparable(x);
    x.cambioHorasDiaPct = ok ? pct(x.horasDia, prev.horasDia) : null;
    x.cambioConductoresPct = ok ? pct(x.conductoresDia, prev.conductoresDia) : null;
    x.cambioHorasPorConductorPct = ok ? pct(x.horasPorConductor, prev.horasPorConductor) : null;
    const horasMes = x.enCurso ? (x.proyeccion ? x.proyeccion.cierre : null) : x.horas;
    // Un mes anterior a medias (el primero de la historia) no es base para las horas del mes.
    const prevEntero = prev && !prev.enCurso && prev.diasConDatos >= prev.diasMes - 1;
    x.cambioHorasPct = ok && prevEntero ? pct(horasMes, prev.horas) : null;
    x.cambioHorasEsProyeccion = !!(x.enCurso && x.cambioHorasPct != null);
  });

  // TRES COMPARACIONES A LA VEZ, sin escoger la que más luce. Con el histórico de
  // BOLT (db/217) la historia empieza en enero, a 960 h/día; mayo y junio se
  // hundieron (~590) y desde julio se recupera. «Desde el primer mes» sola daba
  // −7 % y escondía la subida; «desde julio» sola habría escondido la caída. El
  // último mes es el en curso, por su media de días cerrados: es «cómo vamos ahora».
  const idx = [...meses.keys()].reverse().find(i => comparable(meses[i]));
  const ultimo = idx == null ? null : meses[idx];
  const base = meses.find(comparable);
  const frente = otro => (ultimo && comparable(otro) && otro !== ultimo ? {
    mes: otro.mes,
    horasDiaPct: pct(ultimo.horasDia, otro.horasDia),
    conductoresPct: pct(ultimo.conductoresDia, otro.conductoresDia),
    horasPorConductorPct: pct(ultimo.horasPorConductor, otro.horasPorConductor),
    horasDiaDesde: otro.horasDia, horasDiaHasta: ultimo.horasDia,
  } : null);
  const resumen = ultimo && base && base !== ultimo ? {
    hasta: ultimo.mes,
    anterior: frente(meses[idx - 1]),
    hace3: frente(meses[idx - 3]),
    desdeElPrimero: frente(base),
  } : null;
  return { meses, resumen };
}

/** Crecimiento a partir de los días de una sede, de su primer día con datos a hoy. */
async function armarCrecimiento({ hoy, primerDia, meta, cargarDias }) {
  if (!primerDia) return { hoy, meta: meta || null, meses: [], resumen: null, faltaHistorico: false };
  // Con el mismo tope que el rango; y desde el día 1 de su mes, aunque esté vacío.
  let desde = primerDia;
  const tope = sumarDias(hoy, -TOPE_DIAS);
  if (desde < tope) desde = tope;
  const { dias, faltaHistorico = false } = await cargarDias(desde, hoy);
  return { hoy, meta: meta || null, faltaHistorico, ...crecimientoMensual({ dias, hoy, meta }) };
}

// ── MADRID: de dónde salen sus días ─────────────────────────────────────────
// LOS DÍAS DEL NÚCLEO SIN FOTO. serieMes rellena los que faltan (o están a 0) al
// abrir su mes, y el rango, que solo leía fotos, los pintaba como «Sin datos»: al
// abrir la pantalla las dos cargas van a la vez, y el mismo día salía hueco en
// Horas por día y con horas en Cómo vamos; si era de un mes que nadie abría, hueco
// para siempre. Ahora el rango también los rellena (con el mismo capturarDia),
// pero como mucho TOPE_RELLENO por petición y los más recientes primero: un cron
// caído un mes entero se sana en unas cuantas cargas, no en una que tarde un minuto.
const TOPE_RELLENO = 7;

/**
 * Los días cerrados de [desde, hasta] que el núcleo debería tener y no tienen
 * foto con horas (pura). Solo desde su primer tramo: antes no hay nada que
 * recalcular (los días de antes son del histórico de BOLT, o huecos).
 */
function diasSinFoto({ nucleo = [], desde, hasta, hoy, primerTramo }) {
  if (!primerTramo) return [];
  const conFoto = new Set(nucleo.filter(n => n.viajeSeg + n.esperaSeg > 0).map(n => n.dia));
  const ayer = sumarDias(hoy, -1);
  const fin = hasta < ayer ? hasta : ayer;
  const faltan = [];
  for (let d = desde > primerTramo ? desde : primerTramo; d <= fin; d = sumarDias(d, 1)) if (!conFoto.has(d)) faltan.push(d);
  return faltan.slice(-TOPE_RELLENO);
}

// Las fotos (visibilidad_dia) y el histórico de BOLT, fundidos con la regla del
// contrato; y hoy en vivo del núcleo, como serieMes.
async function cargarDiasMadrid(desde, hasta) {
  const vis = require('./visibilidad');
  const hoy = hoyMadrid();
  const [nucleo, hist, primerTramo] = await Promise.all([
    repo.fotos(desde, hasta), repo.historico(desde, hasta), repo.primerDiaNucleo().catch(() => null),
  ]);
  for (const d of diasSinFoto({ nucleo, desde, hasta, hoy, primerTramo })) {
    try {
      const h = await vis.capturarDia(d);
      if (h) nucleo.push({ dia: d, viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg, conductores: h.conductores });
    } catch (e) { /* un día que falle se queda como hueco; no corta el gráfico */ }
  }
  const dias = fundirDias(nucleo, hist.filas);
  if (desde <= hoy && hoy <= hasta) ponerHoy(dias, hoy, await vis.horasVentana(hoy, 0, 1, 0));
  return { dias, faltaHistorico: hist.falta };
}

/** El mes 'AAAA-MM' pedido, o el de hoy en Madrid. */
function mesPedido(texto) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(texto || '').trim());
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { anio: Number(m[1]), mes: Number(m[2]) };
  const [Y, M] = hoyMadrid().split('-').map(Number);
  return { anio: Y, mes: M };
}
const mesAnterior = ({ anio, mes }) => (mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 });

/** GET /visibilidad/api/rango */
async function rango(q) {
  const vis = require('./visibilidad');
  const [primerDia, config] = await Promise.all([repo.primerDia(), vis.leerConfig()]);
  return armarRango({ q, hoy: hoyMadrid(), primerDia, meta: Number(config.meta) || 0, cargarDias: cargarDiasMadrid });
}

/** GET /visibilidad/api/crecimiento */
async function crecimiento() {
  const vis = require('./visibilidad');
  const [primerDia, config] = await Promise.all([repo.primerDia(), vis.leerConfig()]);
  return armarCrecimiento({ hoy: hoyMadrid(), primerDia, meta: Number(config.meta) || 0, cargarDias: cargarDiasMadrid });
}

/** GET /visibilidad/api/como-vamos: la serie del mes de siempre + el mes anterior + la comparación. */
async function comoVamos(mesTexto) {
  const vis = require('./visibilidad');
  const pedido = mesPedido(mesTexto);
  const ant = mesAnterior(pedido);
  const [actual, anterior] = await Promise.all([vis.serieMes(pedido.anio, pedido.mes), vis.serieMes(ant.anio, ant.mes)]);
  return armarComoVamos(actual, anterior);
}

module.exports = {
  rango, crecimiento, comoVamos,
  // Las piezas que comparte Barcelona (modules/Barcelona/visibilidad.service.js).
  armarRango, armarCrecimiento, armarComoVamos, mesPedido, mesAnterior, ponerHoy,
  // Las reglas puras: las prueba scripts/comprobar-visibilidad-tendencia.js.
  fundirDias, validarRango, agruparSerie, resumenRango, proyectar, contraMeta, compararMes, crecimientoMensual,
  diasSinFoto,
};
