// ============================================================
// LA TENDENCIA DE VISIBILIDAD — rangos, cómo vamos y cómo hemos crecido
// ============================================================
// Las reglas de services/visibilidadTendencia.js (25/10/2026), que comparten
// Madrid y Barcelona: qué vale cada día (el contrato con el histórico de BOLT),
// cómo se agrupa un rango por días, semanas o meses, qué pasa con HOY, los bordes
// del calendario en Madrid (el cambio de hora, fin de mes y de año) y la
// proyección de cierre. Cada caso es una regla escrita o un borde que ya mordió
// en otra pantalla.
//
//   node scripts/comprobar-visibilidad-tendencia.js
//
// No toca la base de datos: prueba las funciones puras. LO QUE NO MIRA: el SQL de
// services/repo/visibilidadSerie.js ni que la pantalla pinte bien; eso se prueba
// contra la base local (ver docs/modulos/Visibilidad.md).
const T = require('../services/visibilidadTendencia');

let fallos = 0;
function caso(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
function lanza(nombre, fn, estado = 400) {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  const ok = !!e && e.estado === estado;
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? ' → ' + e.message : '\n      esperaba un error ' + estado + (e ? ', y salió ' + e.message : ', y no lanzó')));
}

const H = 3600;
// Un día con h horas (la cuarta parte de espera) y c conductores.
const dia = (h, c = 100, origen = 'nucleo') => ({ viajeSeg: h * H * 0.75, esperaSeg: h * H * 0.25, conductores: c, origen, fuente: null });
const mapa = obj => new Map(Object.entries(obj));
const sumar = (d, n) => require('../services/flotaViva/repartoTurnos').sumarDias(d, n);
// Una racha de días seguidos con las mismas horas.
function racha(desde, n, h, c, origen) {
  const m = {};
  for (let i = 0; i < n; i++) m[sumar(desde, i)] = dia(h, c, origen);
  return m;
}

// ── 1. La regla del contrato ────────────────────────────────────────────────
{
  const nucleo = [
    { dia: '2026-07-01', viajeSeg: 7200, esperaSeg: 3600, conductores: 2 },
    { dia: '2026-06-30', viajeSeg: 0, esperaSeg: 0, conductores: 0 },        // foto a cero
    { dia: '2026-06-29', viajeSeg: 0, esperaSeg: 0, conductores: 0 },        // a cero y sin histórico
  ];
  const historico = [
    { dia: '2026-07-01', viajeSeg: 99999, esperaSeg: 0, conductores: 9, fuente: 'bolt' },   // el núcleo manda
    { dia: '2026-06-30', viajeSeg: 3600, esperaSeg: 0, conductores: null, fuente: 'bolt' },
    { dia: '2026-06-28', viajeSeg: 0, esperaSeg: 0, conductores: 5, fuente: 'bolt' },       // histórico a cero
  ];
  const m = T.fundirDias(nucleo, historico);
  caso('Contrato: con horas en el núcleo, vale el núcleo (no el histórico)', m.get('2026-07-01'), { viajeSeg: 7200, esperaSeg: 3600, conductores: 2, origen: 'nucleo', fuente: null });
  caso('Contrato: foto a cero → el histórico, con su fuente', m.get('2026-06-30'), { viajeSeg: 3600, esperaSeg: 0, conductores: null, origen: 'historico', fuente: 'bolt' });
  caso('Contrato: sin horas en ninguna de las dos, el día NO está (un hueco no es un cero)', [m.has('2026-06-29'), m.has('2026-06-28')], [false, false]);
  caso('Contrato: sin la tabla del histórico (db/217 sin aplicar) vale solo el núcleo', [...T.fundirDias(nucleo, []).keys()], ['2026-07-01']);
}

// ── 2. Hoy, en vivo ─────────────────────────────────────────────────────────
{
  const m = mapa({ '2026-10-25': dia(100) });
  T.ponerHoy(m, '2026-10-25', { viajeSeg: 1800 * 2, esperaSeg: 1800 * 2, conductores: 7 });
  caso('Hoy en vivo pisa su foto', [m.get('2026-10-25').viajeSeg + m.get('2026-10-25').esperaSeg, m.get('2026-10-25').vivo], [7200, true]);
  T.ponerHoy(m, '2026-10-25', { viajeSeg: 0, esperaSeg: 0, conductores: 0 });
  caso('Hoy sin nada en vivo (las 00:05, o la copia local) no tiene horas', m.has('2026-10-25'), false);
}

// ── 3. El rango pedido ──────────────────────────────────────────────────────
{
  const HOY = '2026-10-25';      // domingo, y el día que se atrasa el reloj
  const v = (q, p = '2026-07-01') => T.validarRango(q, HOY, p);
  caso('15 días = los 15 cerrados y hoy, por días', (({ desde, hasta, agrupacion, dias }) => ({ desde, hasta, agrupacion, dias }))(v({ ultimos: 15 })),
    { desde: '2026-10-10', hasta: '2026-10-25', agrupacion: 'dia', dias: 16 });
  caso('2 meses (60) sigue siendo por días', v({ ultimos: 60 }).agrupacion, 'dia');
  const seis = v({ ultimos: 182 });
  caso('6 meses → por semanas, desde el primer día con datos y en LUNES (29/06)', [seis.agrupacion, seis.desde, seis.desdePedido], ['semana', '2026-06-29', '2026-04-26']);
  caso('«Todo» = desde el primer día con datos', v({ desde: 'inicio' }).desde, '2026-06-29');
  caso('Sin primer día (no hay datos): «todo» son 30 días', T.validarRango({}, HOY, null).desde, '2026-09-25');
  caso('Lo que pase de hoy se corta en hoy', v({ desde: '2026-10-20', hasta: '2026-12-31' }).hasta, HOY);
  caso('Por meses, desde el día 1', v({ desde: '2026-07-15', agrupar: 'mes' }).desde, '2026-07-01');
  caso('400 días → por semanas; 401 → por meses',
    [T.validarRango({ ultimos: 399 }, HOY, null).agrupacion, T.validarRango({ ultimos: 400 }, HOY, null).agrupacion], ['semana', 'mes']);
  lanza('Más de 1100 días', () => v({ ultimos: 1101 }));
  // N cerrados y hoy son N + 1 días: ultimos=1100 pasaba la primera comprobación y
  // lo rechazaba la segunda. Ahora las dos dicen lo mismo.
  lanza('ultimos=1100 (1.101 días con hoy) se rechaza ya en la primera comprobación', () => T.validarRango({ ultimos: 1100 }, HOY, null));
  caso('ultimos=1099 (1.100 días con hoy) sí vale', T.validarRango({ ultimos: 1099 }, HOY, null).desdePedido, sumar(HOY, -1099));
  const largo = T.validarRango({ desde: 'inicio' }, HOY, '2023-01-01');
  caso('«Todo» con más de 1.100 días de historia se recorta a los últimos 1.100 (por meses, desde el día 1), sin 400',
    [largo.desdePedido, largo.desde, largo.agrupacion], ['2023-01-01', sumar(HOY, -1099).slice(0, 8) + '01', 'mes']);
  lanza('Un «desde» escrito a mano de más de 1.100 días sí es un 400', () => T.validarRango({ desde: '2023-01-01' }, HOY, null));
  lanza('«ultimos» que no es un número', () => v({ ultimos: 'abc' }));
  lanza('«ultimos» con decimales', () => v({ ultimos: '7.5' }));
  lanza('Un 30 de febrero no es una fecha', () => v({ desde: '2026-02-30' }));
  lanza('Una fecha con otro formato (25/10/2026)', () => v({ desde: '25/10/2026' }));
  lanza('«desde» después de «hasta»', () => v({ desde: '2026-10-20', hasta: '2026-10-01' }));
  lanza('Por días, más de 186', () => T.validarRango({ ultimos: 200, agrupar: 'dia' }, HOY, null));
  lanza('Una agrupación que no existe', () => v({ ultimos: 7, agrupar: 'hora' }));
  // En un objeto normal estas «existen» (son de Object.prototype) y colaban hasta
  // reventar en PostgreSQL con un 500 ('NaN-NaN-NaN'::date).
  ['constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach(x =>
    lanza('«agrupar=' + x + '» es un 400, no un 500', () => v({ ultimos: 7, agrupar: x })));
}

// ── 4. Por días: hoy, la media móvil y el ritmo de la meta ──────────────────
{
  const HOY = '2026-10-25';
  const dias = mapa({ ...racha('2026-10-01', 24, 900, 120), '2026-10-25': dia(400, 90) });
  const p = T.agruparSerie({ dias, desde: '2026-10-18', hasta: HOY, hoy: HOY, agrupacion: 'dia', meta: 31000 });
  const hoy = p[p.length - 1];
  caso('Por días: 8 puntos (7 cerrados y hoy)', p.length, 8);
  caso('Hoy va marcado y con su parcial en vivo', [hoy.enCurso, hoy.valor, hoy.hoy, hoy.conductores], [true, 400, 400, 90]);
  caso('La media de 7 días NO mete hoy (sería 829, es 900)', hoy.media, 900);
  caso('El ritmo de la meta: 31.000 h en octubre (31 días) = 1.000 h/día', hoy.ritmoMeta, 1000);
  const corto = T.agruparSerie({ dias: mapa(racha('2026-10-20', 3, 900)), desde: '2026-10-22', hasta: '2026-10-22', hoy: HOY, agrupacion: 'dia' });
  caso('Con 3 de 7 días no hay media (sería la media de dos días y engañaría)', corto[0].media, null);
  const hueco = T.agruparSerie({ dias: mapa(racha('2026-10-01', 2, 900)), desde: '2026-10-03', hasta: '2026-10-03', hoy: HOY, agrupacion: 'dia' });
  caso('Un día sin datos es null, no cero', [hueco[0].valor, hueco[0].diasConDatos], [null, 0]);
}

// ── 5. Por semanas: lunes a domingo, hoy fuera de la media ──────────────────
{
  const HOY = '2026-10-25';
  const dias = mapa({ ...racha('2026-09-28', 27, 900, 120), '2026-10-25': dia(300, 80) });
  // La semana del cambio de hora (19→25/10) tiene sus 7 días, no 6 ni 8.
  const p = T.agruparSerie({ dias, desde: '2026-09-28', hasta: HOY, hoy: HOY, agrupacion: 'semana', meta: 30000 });
  caso('Por semanas: cubos de lunes a domingo', p.map(x => [x.desde, x.hasta, x.dias]),
    [['2026-09-28', '2026-10-04', 7], ['2026-10-05', '2026-10-11', 7], ['2026-10-12', '2026-10-18', 7], ['2026-10-19', '2026-10-25', 7]]);
  const ult = p[3];
  caso('La semana en curso: la media de sus días cerrados, hoy aparte y en el total', [ult.enCurso, ult.valor, ult.diasConDatos, ult.hoy, ult.total], [true, 900, 6, 300, 5700]);
  caso('El ritmo de la meta de una semana partida entre septiembre (30 d) y octubre (31 d)', p[0].ritmoMeta, Math.round((3 * 1000 + 4 * 30000 / 31) / 7));
  caso('Una semana pasada no va en curso', p[2].enCurso, false);
  const año = T.agruparSerie({ dias: new Map(), desde: '2026-12-28', hasta: '2027-01-03', hoy: '2027-01-10', agrupacion: 'semana' });
  caso('Fin de año: la semana del 28/12 al 03/01 es una sola', año.map(x => [x.desde, x.hasta]), [['2026-12-28', '2027-01-03']]);
  caso('El lunes de un domingo de cambio de hora es el de esa semana', T.validarRango({ desde: '2026-10-25', agrupar: 'semana' }, '2026-10-25', null).desde, '2026-10-19');
  caso('El lunes del 01/03/2026 (domingo) es el 23/02', T.validarRango({ desde: '2026-03-01', hasta: '2026-03-10', agrupar: 'semana' }, '2026-10-25', null).desde, '2026-02-23');
}

// ── 6. Por meses, y el origen de cada cubo ──────────────────────────────────
{
  const HOY = '2026-08-10';
  const dias = mapa({ ...racha('2026-06-20', 11, 500, 50, 'historico'), ...racha('2026-07-01', 41, 800, 100) });   // del 01/07 al 10/08
  const p = T.agruparSerie({ dias, desde: '2026-06-01', hasta: HOY, hoy: HOY, agrupacion: 'mes' });
  caso('Por meses: junio, julio y agosto', p.map(x => x.clave), ['2026-06', '2026-07', '2026-08']);
  caso('Junio: la media de sus 11 días con datos, del histórico', [p[0].valor, p[0].diasConDatos, p[0].origen], [500, 11, 'historico']);
  caso('Agosto en curso: 9 días cerrados (el 10 es hoy) y su hoy aparte', [p[2].diasConDatos, p[2].enCurso, p[2].hoy], [9, true, 800]);
  const mixto = T.agruparSerie({ dias, desde: '2026-06-29', hasta: '2026-07-05', hoy: HOY, agrupacion: 'semana' });
  caso('Una semana con días del histórico y del núcleo es «mixto»', mixto[0].origen, 'mixto');
}

// ── 7. Lo que dice el rango en cifras ───────────────────────────────────────
{
  const HOY = '2026-10-25';
  const dias = mapa({ ...racha('2026-09-25', 15, 800), ...racha('2026-10-10', 15, 880), '2026-10-24': dia(1000) });
  const puntos = T.agruparSerie({ dias, desde: '2026-10-10', hasta: HOY, hoy: HOY, agrupacion: 'dia' });
  const r = T.resumenRango({ dias, puntos, desde: '2026-10-10', hasta: HOY, hoy: HOY });
  caso('La media del periodo es de los días cerrados', r.media, Math.round((14 * 880 + 1000) / 15 * 10) / 10);
  caso('El mejor día', [r.mejor.clave, r.mejor.valor], ['2026-10-24', 1000]);
  // «15 días» son 15 cerrados y hoy: el anterior son los 15 de antes, no 16.
  caso('El periodo anterior tiene la longitud de los días CERRADOS (15, sin hoy), y se compara',
    [r.anterior && r.anterior.desde, r.anterior && r.anterior.hasta, r.anterior && r.anterior.dias, r.anterior && r.anterior.diasConDatos, r.cambioPct],
    ['2026-09-25', '2026-10-09', 15, 15, Math.round(((14 * 880 + 1000) / 15 / 800 - 1) * 1000) / 10]);
  const pocos = mapa({ ...racha('2026-10-03', 7, 800), ...racha('2026-10-10', 15, 880) });
  const r2 = T.resumenRango({ dias: pocos, puntos, desde: '2026-10-10', hasta: HOY, hoy: HOY });
  caso('Con el periodo anterior a medias (7 de 15 días) no hay comparación', [r2.anterior, r2.cambioPct], [null, null]);

  // SEMANAS IDÉNTICAS, NINGÚN CAMBIO. Entre semana 850 h y el fin de semana 1.000:
  // con un día de más en el periodo anterior salía −1,8 % en «Semana» sin que
  // cambiara nada. Con la misma longitud, las ventanas de semanas enteras dan 0.
  const semanal = {};
  for (let i = 1; i <= 200; i++) { const d = sumar(HOY, -i); const ds = new Date(d + 'T12:00:00Z').getUTCDay(); semanal[d] = dia(ds === 0 || ds === 6 ? 1000 : 850); }
  const fijos = mapa(semanal);
  const cambio = q => {
    const v = T.validarRango(q, HOY, null);
    const p = T.agruparSerie({ dias: fijos, desde: v.desde, hasta: v.hasta, hoy: HOY, agrupacion: v.agrupacion });
    return T.resumenRango({ dias: fijos, puntos: p, desde: v.desde, hasta: v.hasta, hoy: HOY }).cambioPct;
  };
  caso('Semanas idénticas: «Semana», 14 y 28 días no cambian nada', [cambio({ ultimos: 7 }), cambio({ ultimos: 14 }), cambio({ ultimos: 28 })], [0, 0, 0]);
  // Por semanas el rango empieza en lunes: el anterior se mide con los días cerrados desde ese lunes.
  const vs = T.validarRango({ desde: '2026-10-08', agrupar: 'semana' }, HOY, null);
  const rs = T.resumenRango({ dias: fijos, puntos: T.agruparSerie({ dias: fijos, desde: vs.desde, hasta: vs.hasta, hoy: HOY, agrupacion: 'semana' }), desde: vs.desde, hasta: vs.hasta, hoy: HOY });
  caso('Por semanas (desde el lunes 05/10), el anterior son los 20 días cerrados de antes', [vs.desde, rs.anterior.dias, rs.anterior.desde], ['2026-10-05', 20, '2026-09-15']);

  // EL RITMO DE LA META, de los mismos días que la media: un periodo de 5 días de
  // septiembre (30 días: 1.000 h/día) y 10 de octubre (31: 967,7) pide 978,5 de
  // media, no la media de los ritmos de cada barra.
  const cruza = mapa({ ...racha('2026-09-26', 5, 950), ...racha('2026-10-01', 10, 950) });
  const rc = T.resumenRango({ dias: cruza, puntos: [], desde: '2026-09-26', hasta: '2026-10-10', hoy: HOY, meta: 30000 });
  const ritmo = (5 * 1000 + 10 * 30000 / 31) / 15;
  caso('El ritmo de la meta pondera por días y dice que varía', [rc.ritmoMeta, rc.ritmoMetaVaria, rc.vsMetaPct], [Math.round(ritmo), true, Math.round((950 / ritmo - 1) * 1000) / 10]);
  const rOct = T.resumenRango({ dias: cruza, puntos: [], desde: '2026-10-01', hasta: '2026-10-10', hoy: HOY, meta: 31000 });
  caso('Dentro de un mes el ritmo es el suyo (31.000 en octubre: 1.000) y no varía', [rOct.ritmoMeta, rOct.ritmoMetaVaria, rOct.vsMetaPct], [1000, false, -5]);
  caso('Sin meta, sin ritmo', T.resumenRango({ dias: cruza, puntos: [], desde: '2026-10-01', hasta: '2026-10-10', hoy: HOY }).vsMetaPct, null);
}

// ── 8. La proyección de cierre ──────────────────────────────────────────────
{
  const p = T.proyectar({ diasMes: 31, cerradas: Array(24).fill(900), previos: [] });
  caso('Proyección: 24 días a 900 y 7 por delante (hoy incluido) a 900 → 27.900', [p.ritmo, p.real, p.quedan, p.cierre], [900, 21600, 7, 27900]);
  const conHueco = T.proyectar({ diasMes: 30, cerradas: [...Array(9).fill(1000), null], previos: [] });
  caso('Un día cerrado sin datos cuenta cero en lo hecho y no entra en el ritmo', [conHueco.real, conHueco.ritmo, conHueco.quedan, conHueco.cierre], [9000, 1000, 20, 29000]);
  const dia2 = T.proyectar({ diasMes: 30, cerradas: [800], previos: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] });
  caso('El día 2 el ritmo son los últimos 7 cerrados, crucen el mes (6 del anterior + 1)', dia2.ritmo, Math.round((6 * 1000 + 800) / 7 * 10) / 10);
  caso('Sin 3 días con datos no hay proyección', T.proyectar({ diasMes: 31, cerradas: [900, 900], previos: [] }), null);
  const m = T.contraMeta(p, 30000);
  caso('Contra la meta: % y el ritmo que hace falta desde hoy', [m.pctMeta, m.faltan, m.ritmoNecesario], [93, 8400, 1200]);
  caso('Sin meta, la proyección sigue y lo demás va vacío', [T.contraMeta(p, 0).cierre, T.contraMeta(p, 0).pctMeta], [27900, null]);
}

// ── 9. Cómo vamos: el mes contra el anterior a la misma altura ─────────────
{
  // Las series con la forma de serieMes: el acumulado día a día.
  const serie = (dm, porDia, hasta = dm) => {
    let a = 0;
    return Array.from({ length: dm }, (_, i) => {
      const t = i < hasta ? porDia : 0;
      a += t;
      return { dia: i + 1, total: t, acumulado: a, ideal: Math.round(30000 / dm * (i + 1)), critico: 0, brecha: a - Math.round(30000 / dm * (i + 1)), sobreCritico: a };
    });
  };
  const octubre = { anio: 2026, mes: 10, diasMes: 31, esMesActual: true, hoyDia: 25, ultimoConDatos: 25, config: { meta: 30000 }, total: 0, dias: serie(31, 950, 25) };
  const septiembre = { anio: 2026, mes: 9, diasMes: 30, esMesActual: false, hoyDia: null, ultimoConDatos: 30, config: { meta: 30000 }, total: 27000, dias: serie(30, 900) };
  const c = T.compararMes({ actual: octubre, anterior: septiembre });
  caso('A la misma altura = el último día cerrado (ayer, el 24)', [c.corte, c.anterior.dia], [24, 24]);
  caso('Por delante del anterior: cuánto y en %', [c.acumulado, c.anterior.acumulado, c.diferencia, c.diferenciaPct], [22800, 21600, 1200, 5.6]);
  caso('La proyección sale del mismo ritmo (7 últimos cerrados: 950)', [c.proyeccion.ritmo, c.proyeccion.cierre, c.proyeccion.serie.length], [950, 22800 + 950 * 7, 8]);
  caso('Hoy, aparte (va a medias)', c.hoy, 950);
  const fin = T.compararMes({ actual: { ...octubre, esMesActual: false, hoyDia: null, ultimoConDatos: 31, total: 29450, dias: serie(31, 950) }, anterior: septiembre });
  caso('Un mes cerrado lleva su cierre, no proyección', [fin.proyeccion, fin.cierre.total, fin.cierre.pctMeta, fin.cierre.vsAnteriorPct], [null, 29450, 98.2, 9.1]);
  // UN MES CERRADO SE COMPARA ENTERO: total contra total y la media de los días
  // con datos de cada uno. Antes, a día 30, la misma pantalla daba tres cifras.
  caso('Un mes cerrado se compara entero: total contra total, y la media de cada mes',
    [fin.mesEntero, fin.corte, fin.anterior.dia, fin.diferencia, fin.diferenciaPct, fin.mediaDia, fin.mediaDiaAnterior], [true, 31, 30, 2450, 9.1, 950, 900]);
  caso('Su «frente al anterior» y su cierre dicen lo mismo', fin.diferenciaPct, fin.cierre.vsAnteriorPct);
  // Septiembre (30 días) contra agosto (31): agosto no se corta en el día 30.
  const agosto = { anio: 2026, mes: 8, diasMes: 31, esMesActual: false, ultimoConDatos: 31, config: { meta: 30000 }, total: 31 * 934, dias: serie(31, 934) };
  const sep = T.compararMes({ actual: { ...septiembre, total: 30 * 874, dias: serie(30, 874) }, anterior: agosto });
  caso('Septiembre contra agosto entero: −9,4 % en horas y 874 frente a 934 h/día (−6,4 %, como el crecimiento)',
    [sep.diferenciaPct, sep.mediaDia, sep.mediaDiaAnterior, Math.round((sep.mediaDia / sep.mediaDiaAnterior - 1) * 1000) / 10], [-9.4, 874, 934, -6.4]);
  // Un mes cerrado cuyos últimos días no tienen horas: el corte es su último día con horas.
  const corto = T.compararMes({ actual: { ...septiembre, total: 20 * 900, dias: serie(30, 900, 20) }, anterior: agosto });
  caso('Un mes cerrado corta en su último día con horas, y su media es de esos días', [corto.corte, corto.diasConDatos, corto.mediaDia], [20, 20, 900]);
  // Un mes sin un solo dato no es un cierre catastrófico: es un mes sin datos.
  const vacio = T.compararMes({ actual: { ...septiembre, anio: 2025, mes: 12, diasMes: 31, total: 0, dias: serie(31, 0) }, anterior: { ...septiembre, total: 0, dias: serie(30, 0) } });
  caso('Un mes sin datos: corte 0, sin cierre, sin brecha y sin anterior', [vacio.corte, vacio.sinDatos, vacio.cierre, vacio.brecha, vacio.anterior, vacio.acumulado], [0, true, null, null, null, null]);
  const sinAnt = T.compararMes({ actual: octubre, anterior: { ...septiembre, total: 29, dias: serie(30, 0).map((d, i) => (i === 29 ? { ...d, total: 29, acumulado: 29 } : d)) } });
  caso('Un anterior con un solo día (Barcelona, 30/09) no sirve de base', [sinAnt.anterior, sinAnt.diferencia], [null, null]);
  const dia1 = T.compararMes({ actual: { ...octubre, hoyDia: 1, dias: serie(31, 0) }, anterior: septiembre });
  caso('El día 1 no hay días cerrados, pero sí proyección (del ritmo del mes anterior)', [dia1.corte, dia1.acumulado, dia1.proyeccion.cierre], [0, null, 900 * 31]);
}

// ── 10. Cómo hemos crecido ──────────────────────────────────────────────────
{
  const HOY = '2026-10-25';
  const dias = mapa({
    ...racha('2026-06-28', 3, 600, 60, 'historico'),     // junio: 3 días, no se compara
    ...racha('2026-07-01', 31, 800, 100),
    ...racha('2026-08-01', 31, 900, 110),
    ...racha('2026-09-01', 30, 870, 115),
    ...racha('2026-10-01', 24, 930, 120),
    '2026-10-25': dia(300, 90),
  });
  const { meses, resumen } = T.crecimientoMensual({ dias, hoy: HOY, meta: 30000 });
  caso('Un mes por cada uno desde el primero con datos', meses.map(m => m.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  caso('Horas, horas por día y conductores de un mes cerrado', [meses[2].horas, meses[2].horasDia, meses[2].conductoresDia, meses[2].horasPorConductor], [27900, 900, 110, 8.2]);
  caso('El mes en curso: lo hecho (cerrados + hoy) y la previsión APARTE', [meses[4].horas, meses[4].horasCerradas, meses[4].proyeccion.cierre], [22620, 22320, 22320 + 930 * 7]);
  caso('% frente al mes anterior (h/día)', meses[2].cambioHorasDiaPct, 12.5);
  caso('Un mes con 3 días no se compara, ni sirve de base', [meses[0].comparable, meses[1].cambioHorasDiaPct, meses[1].cambioHorasPct], [false, null, null]);
  caso('Las horas del mes en curso se comparan por su previsión, y lo dice', [meses[4].cambioHorasPct, meses[4].cambioHorasEsProyeccion], [Math.round(((22320 + 930 * 7) / 26100 - 1) * 1000) / 10, true]);
  caso('Desde el primer mes que sirve (julio, no junio con 3 días) hasta el último', [resumen.desdeElPrimero.mes, resumen.hasta, resumen.desdeElPrimero.horasDiaPct, resumen.desdeElPrimero.conductoresPct], ['2026-07', '2026-10', 16.3, 20]);
  caso('Frente al mes anterior y frente a hace tres meses', [resumen.anterior.mes, resumen.anterior.horasDiaPct, resumen.hace3.mes, resumen.hace3.horasDiaPct], ['2026-09', 6.9, '2026-07', 16.3]);
  caso('De dónde sale cada mes', meses.map(m => m.origen), ['historico', 'nucleo', 'nucleo', 'nucleo', 'nucleo']);
  caso('Sin datos, nada (y sin romperse)', T.crecimientoMensual({ dias: new Map(), hoy: HOY }), { meses: [], resumen: null });
  const cruza = T.crecimientoMensual({ dias: mapa({ ...racha('2026-12-20', 12, 500) }), hoy: '2027-01-05' });
  caso('Cruza el año: diciembre y enero', cruza.meses.map(m => m.mes), ['2026-12', '2027-01']);
}

// ── 11. Los días del núcleo sin foto (el rango los rellena, pocos cada vez) ─
{
  const HOY = '2026-10-25';
  const foto = (d, h) => ({ dia: d, viajeSeg: h * H, esperaSeg: 0, conductores: 1 });
  const nucleo = [foto('2026-10-20', 900), foto('2026-10-21', 0), foto('2026-10-23', 900), foto('2026-10-24', 900), foto('2026-10-25', 300)];
  caso('Faltan los días sin foto o a 0, ni hoy ni los de antes del primer tramo',
    T.diasSinFoto({ nucleo, desde: '2026-10-18', hasta: HOY, hoy: HOY, primerTramo: '2026-10-19' }), ['2026-10-19', '2026-10-21', '2026-10-22']);
  caso('Sin núcleo (sin primer tramo), nada que rellenar', T.diasSinFoto({ nucleo: [], desde: '2026-10-01', hasta: HOY, hoy: HOY, primerTramo: null }), []);
  const mes = T.diasSinFoto({ nucleo: [], desde: '2026-09-01', hasta: HOY, hoy: HOY, primerTramo: '2026-07-01' });
  caso('Como mucho 7 por petición, los más recientes', mes, ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
}

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
