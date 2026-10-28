// ============================================================
// INICIO — el panel donde cae todo el mundo al entrar
// ============================================================
// Antes se entraba a /pendientes, tuviera uno permiso o no. Quien no lo tenía
// se comía un "Sin permiso" nada más hacer login y creía que la web se había
// caído. Ahora se entra AQUÍ, que no se bloquea nunca: sin el permiso `/inicio`
// se ve la bienvenida, y con él, las cifras.
//
// Las cifras son las MISMAS de Visibilidad (mismas ventanas, mismas horas
// efectivas, mismas metas) para que no haya dos verdades. Desde el 23/10/2026
// (Camilo: «lo más importante siempre serán las horas del mes, las horas del
// turno actual, si es día o noche, y luego las horas del turno pasado, también de
// la jornada pasada, si puede ser más gráfico mejor») esas van arriba y en
// grande, con su meta y sus barras; el resto, abajo y en pequeño. Y añade dos
// cosas que Visibilidad no cuenta:
//
//   · HORAS NO EFECTIVAS — lo que falta para completar la jornada. No es el
//     descanso: es la resta. Quien tiene 2 h justificadas de taller y 3 h
//     conectado en viaje/espera lleva 5 de 8, así que deja 3 h no efectivas.
//
//   · KILÓMETROS — cuánto se rueda CON pasajero y cuánto sin él. Los da el GPS
//     de Mapon, que es lo que hay en PostgreSQL.

const db = require('./db');
const visibilidad = require('./visibilidad');

// La jornada de referencia, en horas. Sale de la config de Visibilidad para no
// tener dos sitios donde tocar los mismos números; 8 h si nadie la ha puesto.
const JORNADA_DEFECTO = 8;

/** El día operativo (jornada 05→05) al que pertenece una hora de un día. */
function jornadaDe(iso, hora) {
  const H0 = require('./nucleo').HORA_DIA;
  if (hora >= H0) return iso;
  return diaMenos(iso, 1);
}

/** N días antes de una fecha ISO, sin líos de zona horaria. */
function diaMenos(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Las horas que se quedaron sin hacer, por jornada.
 *
 * Solo cuenta a QUIEN DEBÍA SALIR (`f_cobertura`, la misma regla de todo el
 * ERP), así que las vacaciones y las bajas no ensucian el número: quien está
 * ausente no aparece en la cobertura y no deja horas a deber.
 *
 * Y suma lo JUSTIFICADO con lo trabajado antes de restar, que es justo lo que
 * significa un justificante: esas 2 h de taller no son culpa suya.
 */
async function noEfectivas(desdeIso, hastaIso, jornadaH) {
  const r = await db.consulta(
    `WITH debia AS (
       SELECT DISTINCT conductor_id, dia FROM f_cobertura($1::date, $2::date)
        WHERE conductor_id IS NOT NULL
     ),
     hecho AS (
       SELECT conductor_id, dia, sum(seg)::bigint AS seg FROM (
         SELECT conductor_id, dia_operativo AS dia, horas_seg AS seg
           FROM bitacora_horas WHERE dia_operativo BETWEEN $1::date AND $2::date
         UNION ALL
         SELECT conductor_id, dia_operativo, COALESCE(horas_seg_momento, 0)
           FROM justificante
          WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
       ) x GROUP BY conductor_id, dia
     ),
     -- Lo justificado aparte, solo para poder decir cuánto de lo que falta ya
     -- tiene explicación y cuánto no la tiene.
     just AS (
       SELECT conductor_id, dia_operativo AS dia,
              sum(COALESCE(horas_seg_momento, 0))::bigint AS seg
         FROM justificante
        WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
        GROUP BY 1, 2
     )
     SELECT count(*)::int                                                AS personas_dia,
            count(*) FILTER (WHERE COALESCE(h.seg, 0) = 0)::int          AS sin_salir,
            round(sum(GREATEST(0, $3::numeric * 3600 - COALESCE(h.seg, 0)))
                  / 3600.0, 1)                                          AS no_efectivas_h,
            round(sum(COALESCE(h.seg, 0)) / 3600.0, 1)                   AS hechas_h,
            round(sum(COALESCE(j.seg, 0)) / 3600.0, 1)                   AS justificadas_h,
            round($3::numeric * count(*), 1)                             AS debidas_h
       FROM debia d
       LEFT JOIN hecho h ON h.conductor_id = d.conductor_id AND h.dia = d.dia
       LEFT JOIN just  j ON j.conductor_id = d.conductor_id AND j.dia = d.dia`,
    [desdeIso, hastaIso, jornadaH]);

  const num = v => (v == null ? 0 : Number(v));
  const x = r.rows[0] || {};
  const debidas = num(x.debidas_h);
  const noEfec = num(x.no_efectivas_h);
  return {
    personasDia: num(x.personas_dia),
    sinSalir: num(x.sin_salir),
    horas: noEfec,
    hechas: num(x.hechas_h),
    justificadas: num(x.justificadas_h),
    debidas,
    // Qué parte de lo que se debía se quedó sin hacer.
    porcentaje: debidas > 0 ? Math.round((noEfec / debidas) * 1000) / 10 : null,
  };
}

/**
 * Kilómetros de una ventana de turno: los que se ruedan DENTRO de BOLT y los que
 * se ruedan fuera.
 *
 * · EN BOLT  = viaje + espera. Es trabajo.
 * · FUERA    = descanso (el "busy" de BOLT) + desconectado. El coche anda y no
 *              está produciendo, o directamente nadie ha fichado.
 *
 * LOS KM SALEN DE `fv_ruta`, NO DE `fv_tramo.km_m`. Esto se aprendió por las
 * malas y está escrito en flotaViva/rutas.js: `km_m` es el salto de odómetro
 * dentro del tramo, y el odómetro solo llega a ratos —de 3.551 tramos de un día,
 * 188 traían km y el 43 % ni lectura—, así que los kilómetros caían en el tramo
 * que estuviera abierto cuando Mapon habló. Con esa fuente este panel daba 1.570
 * km para sesenta coches, que es imposible. `fv_ruta` son los TRAYECTOS de Mapon
 * y es la fuente que cuadró con el informe de BOLT al 0,03 %.
 *
 * Se reparte cada trayecto entre las situaciones que pisa, en proporción al
 * tiempo: un trayecto de 10 km que cae mitad en viaje y mitad en descanso son 5
 * y 5, no 10 para el que estuviera abierto al final.
 *
 * No se calcula aquí: se pide a `rutas.kmConectadoDesconectado`, que es la misma
 * función que usan el cockpit y los reportes. Dos formas de contar kilómetros
 * darían dos verdades.
 */
async function kilometros(dia, turno) {
  const r = await require('./flotaViva/rutas').kmConectadoDesconectado(dia, turno);
  const t = r.total || { enBolt: 0, desconectado: 0, total: 0 };
  const r1 = n => Math.round(n * 10) / 10;
  return {
    dia: r.dia,
    turno,
    enBolt: r1(t.enBolt),
    fuera: r1(t.desconectado),
    total: r1(t.total),
    // Qué parte de lo que rodó la flota se rodó sin estar produciendo. Es LA
    // cifra: el total sube con la actividad, esto no.
    porcentajeFuera: t.total > 0 ? Math.round((t.desconectado / t.total) * 1000) / 10 : null,
  };
}

/**
 * QUIÉN LLEVA YA SU JORNADA Y QUIÉN NO, en cada tarjeta de turno y en la de la
 * jornada (Camilo, 23/10/2026: «de los 64 conductores que están, cuántos ya
 * cumplieron sus 8 horas, a cuántos les falta… y al darle click que me detalle
 * los nombres y las horas que llevan, de mayor a menor, para saber si llegaremos
 * o no»).
 *
 * La gente y sus horas son las de Visibilidad (`resumen({ gente: true })`, la
 * misma carga que el total y los «X conductores»). Aquí se le pone a cada uno su
 * nombre —el de BOLT de su ficha, como en todo el ERP; sin ficha, el de su cuenta—
 * y lo que hace AHORA según la foto compartida de BOLT (`flotaViva/ahora`): quien
 * sigue conectado aún puede llegar a sus horas. La PREVISIÓN es la cuenta simple
 * de si todos los que faltan completaran su jornada: lo que lleva el turno más lo
 * que les falta.
 *
 * EN EL TURNO EN CURSO, TODOS LOS PLANIFICADOS (Camilo, el mismo día: «pon a
 * todos los planificados, así tengan 0 horas, y la previsión de cuántas horas se
 * pueden hacer si todos hacen sus 8 horas»; con solo los que ya habían salido, a
 * las 18:05 decía «si los 21 completan, 168 h» y confundía). La lista es quien
 * lo tiene en el plan —el de Control, `f_cobertura` con los eventos— más los NN
 * que ya han salido, y la previsión, cada uno con sus horas o con su jornada si
 * aún no llega. Y en vivo (`enVivo`): cuántos DEBEN SALIR (el plan), cuántos HAN
 * SALIDO (plan + NN, los «X conductores» de la tarjeta) y cuántos están
 * CONECTADOS ahora. El turno anterior y la jornada siguen con quien hizo horas.
 *
 * Cambia `turnoDia`, `turnoNoche` y `ayerJornada` en su sitio: su `gente` cruda
 * (persona, segundos, cuentas) pasa a ser la lista para pintar, y se añade
 * `prevision`.
 */
async function conLaGente(visib, jornadaH, turnoActual) {
  const tarjetas = [visib.turnoDia, visib.turnoNoche, visib.ayerJornada].filter(t => t && Array.isArray(t.gente));
  const actual = turnoActual === 'dia' ? visib.turnoDia : visib.turnoNoche;
  // En el turno en curso, los planificados que aún no han hecho nada, con 0.
  if (actual && Array.isArray(actual.gente)) {
    const conHoras = new Set(actual.gente.map(g => g.persona));
    const enPlan = new Set((actual.planificados || []).map(p => p.persona));
    actual.gente = actual.gente.map(g => ({ ...g, plan: enPlan.has(g.persona) }))
      .concat((actual.planificados || []).filter(p => !conHoras.has(p.persona))
        .map(p => ({ persona: p.persona, seg: 0, nn: false, plan: true, cuentas: p.cuentas || [] })));
    actual.conPlan = true;
  }
  const todas = tarjetas.flatMap(t => t.gente);
  const ids = [...new Set(todas.filter(g => /^c\d+$/.test(g.persona)).map(g => Number(g.persona.slice(1))))];
  const uuids = [...new Set(todas.filter(g => g.persona.startsWith('u')).map(g => g.persona.slice(1)))];
  const [rc, ru, foto] = await Promise.all([
    ids.length ? db.consulta(
      `SELECT id, COALESCE(NULLIF(btrim(nombre_bolt), ''), btrim(nombre || ' ' || COALESCE(apellidos, ''))) AS nombre
         FROM conductor WHERE id = ANY($1::bigint[])`, [ids]) : { rows: [] },
    uuids.length ? db.consulta(
      `SELECT uuid, nombre FROM fv_conductor WHERE uuid = ANY($1::text[])`, [uuids]) : { rows: [] },
    // Sin la foto del ahora la lista sale igual, solo que sin decir quién sigue.
    require('./flotaViva/ahora').foto().catch(() => null),
  ]);
  const nombreConductor = new Map(rc.rows.map(x => [Number(x.id), x.nombre]));
  const nombreCuenta = new Map(ru.rows.map(x => [String(x.uuid), x.nombre]));
  const nombreDe = p => (p.startsWith('c') ? nombreConductor.get(Number(p.slice(1))) : nombreCuenta.get(p.slice(1)))
    || (p === 'sin-conductor' ? 'Sin conductor' : 'Sin nombre');
  // Lo que hace ahora: de sus cuentas, la noticia más fresca.
  const ahoraDe = cuentas => {
    if (!foto) return null;
    let mejor = null;
    cuentas.forEach(u => {
      const x = foto.porConductor.get(u);
      if (x && (!mejor || new Date(x.desde) > new Date(mejor.desde))) mejor = x;
    });
    return mejor && mejor.conectado ? { situacion: mejor.situacion, matricula: mejor.matricula || null } : null;
  };

  const meta = jornadaH * 3600;
  const r1 = v => Math.round(v * 10) / 10;
  tarjetas.forEach(t => {
    const lista = t.gente
      .map(g => ({ nombre: nombreDe(g.persona), seg: g.seg, nn: !!g.nn, plan: !!g.plan, ahora: ahoraDe(g.cuentas || []) }))
      .sort((a, b) => b.seg - a.seg || a.nombre.localeCompare(b.nombre, 'es'));
    const faltan = lista.filter(p => p.seg < meta);
    const faltanSeg = faltan.reduce((s, p) => s + (meta - p.seg), 0);
    t.prevision = {
      jornadaH,
      cumplen: lista.length - faltan.length,
      faltan: faltan.length,
      faltanH: r1(faltanSeg / 3600),
      // De los que faltan, cuántos siguen conectados: esos aún pueden llegar.
      faltanConectados: faltan.filter(p => p.ahora).length,
      // Lo que llevan todos más lo que les falta para su jornada: cada uno con sus
      // horas, o con su jornada si aún no llega. En el turno en curso, con los
      // planificados que aún no han salido.
      siCompletan: r1((t.horasEfectivas || 0) + faltanSeg / 3600),
      todos: lista.length,
    };
    if (t.conPlan) {
      t.enVivo = {
        debenSalir: (t.planificados || []).length,
        hanSalido: lista.filter(p => p.seg > 0).length,
        // De los que deben salir y de los NN que ya salieron, quién está ahora
        // conectado a BOLT (en viaje, en espera o en descanso).
        conectados: lista.filter(p => p.ahora).length,
        planSinSalir: lista.filter(p => p.plan && !(p.seg > 0)).length,
      };
    }
    t.gente = lista.map(p => ({ nombre: p.nombre, h: r1(p.seg / 3600), salio: p.seg > 0, nn: p.nn, plan: p.plan, ahora: p.ahora }));
    // Lo crudo ya no hace falta: la lista para pintar lo lleva todo.
    delete t.planificados;
    delete t.conPlan;
  });
  [visib.turnoDia, visib.turnoNoche].forEach(t => { if (t) delete t.planificados; });
}

/**
 * El panel entero, de una vez.
 *
 * Las cifras de Visibilidad se piden tal cual: si algún día cambia cómo se
 * cuentan las horas, cambian aquí solas y las dos pantallas siguen diciendo lo
 * mismo. Lo que se añade va por JORNADA (05→05), que es la ventana con la que
 * cuadran la Bitácora y el Reporte de horas.
 */
async function panel() {
  const cfg = await visibilidad.leerConfig();
  const jornadaH = Number(cfg.jornada_h) > 0 ? Number(cfg.jornada_h) : JORNADA_DEFECTO;

  const ahora = new Date();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ahora);
  const hora = Number(new Intl.DateTimeFormat('en-GB',
    { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(ahora));

  // La jornada EN CURSO y la última CERRADA. La que se mira es la cerrada: la de
  // hoy va por la mitad y las horas que le faltan aún se pueden hacer.
  const enCurso = jornadaDe(hoy, hora);
  const cerrada = diaMenos(enCurso, 1);
  const primeroMes = enCurso.slice(0, 8) + '01';

  // LOS KM, POR TURNO Y EN LAS MISMAS VENTANAS QUE LAS HORAS. Se piden a
  // `visibilidad.ventanaTurnos()` en vez de elegirlas aquí: si cada pantalla
  // escogiera su turno, las horas y los kilómetros no se podrían comparar.
  const vt = visibilidad.ventanaTurnos();

  // LAS NO EFECTIVAS SOLO DE JORNADAS CERRADAS. Salen de `bitacora_horas`, que
  // es el histórico SELLADO: del día en curso no hay nada ahí todavía y saldría
  // que nadie ha hecho nada. Y aunque lo hubiera, no significaría gran cosa: a
  // media jornada las horas que faltan aún se pueden hacer.
  // EL TURNO EN CURSO, con el reloj de siempre: de día de 05:00 a 17:00 y de
  // noche de 17:00 a 05:00. Es la hora a la que Visibilidad cambia de tarjeta, así
  // que el «turno en curso» de aquí es una de sus dos tarjetas de turno y el
  // anterior, la otra (de madrugada, la noche que corre es la de ayer).
  const T = require('./flotaViva/rutas').TURNOS;
  const ahoraMad = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(ahora).split(':').map(Number);
  const horaDec = (ahoraMad[0] % 24) + ahoraMad[1] / 60;
  const turnoActual = horaDec >= T.dia[0] && horaDec < T.noche[0] ? 'dia' : 'noche';
  // El mes por el DÍA NATURAL, como las horas del mes de Visibilidad: el día 1 a
  // las 02:00 la jornada en curso aún es la del mes anterior, pero el mes ya no.
  const [Y, M] = hoy.split('-').map(Number);

  const [visib, serie, neCerrada, neMes, kmDia, kmNoche, kmAyer] = await Promise.all([
    // Con la gente de cada turno: quién lleva ya su jornada y quién no.
    visibilidad.resumen({ gente: true }),
    // Las horas de cada día del mes, para las barras de la tarjeta del mes. Es la
    // MISMA serie de las gráficas de Visibilidad (sus fotos diarias y hoy en vivo).
    visibilidad.serieMes(Y, M),
    noEfectivas(cerrada, cerrada, jornadaH),
    noEfectivas(primeroMes, cerrada, jornadaH),
    kilometros(vt.dia.v[0], 'dia'),
    kilometros(vt.noche.v[0], 'noche'),
    // La jornada de ayer entera (05→05), que es la que se compara con las horas
    // de "Ayer · jornada".
    kilometros(cerrada, 'operativo'),
  ]);
  await conLaGente(visib, jornadaH, turnoActual);

  return {
    hoy, jornadaEnCurso: enCurso, jornadaCerrada: cerrada, jornadaH,
    turnoActual, horaMadrid: Math.round(horaDec * 100) / 100,
    turnos: { dia: [T.dia[0], T.dia[2]], noche: [T.noche[0], T.noche[2]] },
    visibilidad: visib,
    // Solo lo que pintan las barras: el total de cada día, hasta qué día hay datos
    // y el ritmo que pide la meta. El acumulado frente al ideal, a cierre de AYER:
    // el de hoy aún corre (igual que en la gráfica de Visibilidad).
    mesSerie: {
      anio: serie.anio, mes: serie.mes, diasMes: serie.diasMes, hoyDia: serie.hoyDia,
      ultimoConDatos: serie.ultimoConDatos, idealDiario: serie.idealDiario,
      dias: serie.dias.map(d => ({ dia: d.dia, total: d.total, ideal: d.ideal, acumulado: d.acumulado, brecha: d.brecha })),
    },
    noEfectivas: { cerrada: neCerrada, mes: neMes },
    km: {
      dia: { ...kmDia, etq: vt.dia.etq },
      noche: { ...kmNoche, etq: vt.noche.etq },
      ayer: { ...kmAyer, etq: 'Ayer · jornada' },
    },
  };
}

/**
 * QUIÉN ESTÁ CONECTADO AHORA, POR SU TURNO (Camilo, 28/10/2026: «cuántos
 * conectados hay en el turno actual, separa los que tengan turno día con turno
 * noche»).
 *
 * Todos los conectados de Madrid según la foto del ahora —con la API v2 de
 * BOLT, su lista tal cual— y de cada PERSONA (sus cuentas y las prestadas
 * cuentan una vez) el turno que tiene en el plan a esta hora, con la misma
 * regla que reparte las horas (repartoTurnos.etiquetaPlan): a las 18:00, quien
 * es de día y aún no ha cerrado cuenta como de día. Quien no tiene turno en el
 * plan va aparte.
 *
 * Es ligero (la foto ya está hecha y el plan son dos días), así que va fuera de
 * la caché del panel: la pantalla lo pide cada 10 s. Con varias pantallas
 * abiertas, mientras la foto sea la misma se responde lo ya contado.
 */
let vivoCache = null;     // { foto, t, datos }
async function conectadosPorTurno() {
  const foto = await require('./flotaViva/ahora').foto();
  if (vivoCache && vivoCache.foto === foto && Date.now() - vivoCache.t < 10000) return vivoCache.datos;
  const datos = await contarPorTurno(foto);
  vivoCache = { foto, t: Date.now(), datos };
  return datos;
}

async function contarPorTurno(foto) {
  const reparto = require('./flotaViva/repartoTurnos');
  const uuids = [...foto.porConductor.values()].filter(x => x.conectado).map(x => String(x.uuid));
  const ahoraMs = Date.now();
  const hoy = reparto.enMadrid(ahoraMs).fecha;
  const ayer = reparto.sumarDias(hoy, -1);

  // De cada cuenta, su persona: la de su ficha o, si hoy está prestada, quien
  // la lleva (como en Control). Sin ficha, la cuenta es la persona.
  const rp = uuids.length ? await db.consulta(
    `SELECT ce.externo_id AS uuid, COALESCE(f.conductor_id, ce.conductor_id) AS conductor_id
       FROM conductor_externo ce
       LEFT JOIN LATERAL (
         SELECT f.conductor_id FROM cuenta_fantasma f
          WHERE f.cuenta_id = ce.id AND f.anulado_at IS NULL
            AND f.desde <= $2::date AND (f.hasta IS NULL OR f.hasta >= $2::date)
          ORDER BY f.desde DESC LIMIT 1) f ON TRUE
      WHERE ce.sistema = 'bolt' AND ce.externo_id = ANY($1::text[])`, [uuids, hoy]) : { rows: [] };
  const deCuenta = new Map(rp.rows.filter(x => x.conductor_id != null).map(x => [String(x.uuid), Number(x.conductor_id)]));
  const personas = new Map();     // persona → id de conductor (o null sin ficha)
  uuids.forEach(u => {
    const id = deCuenta.get(u);
    personas.set(id != null ? 'c' + id : 'u' + u, id != null ? id : null);
  });
  const ids = [...new Set([...personas.values()].filter(id => id != null))];

  // EL PLAN de ayer y hoy, el mismo que pinta el planificador y lee Control.
  const rplan = ids.length ? await db.consulta(
    `SELECT DISTINCT to_char(c.dia, 'YYYY-MM-DD') AS dia, c.conductor_id, t.codigo AS turno
       FROM f_cobertura($1::date, $2::date, TRUE) c
       JOIN turno t ON t.id = c.turno_id
      WHERE t.codigo IN ('dia', 'noche', 'todoturno') AND c.conductor_id = ANY($3::bigint[])`,
    [ayer, hoy, ids]) : { rows: [] };
  const planes = new Map();
  rplan.rows.forEach(x => {
    const id = Number(x.conductor_id);
    if (!planes.has(id)) planes.set(id, new Map());
    const m = planes.get(id);
    if (!m.has(x.dia)) m.set(x.dia, new Set());
    m.get(x.dia).add(x.turno);
  });
  const VACIO = new Set();

  const cuenta = { dia: 0, noche: 0, todoturno: 0, sinTurno: 0 };
  personas.forEach(id => {
    const plan = id != null ? planes.get(id) : null;
    const planDe = fecha => (plan && plan.get(fecha)) || VACIO;
    const e = plan ? reparto.etiquetaPlan(ahoraMs, planDe) : null;
    if (e) cuenta[e.turno]++;
    else if (planDe(hoy).has('todoturno')) cuenta.todoturno++;
    else cuenta.sinTurno++;
  });

  return {
    at: foto.at, fuente: foto.fuente || 'bd', v2At: foto.v2At || null,
    total: personas.size, ...cuenta,
  };
}

// ── Caché: se sirve lo que hay y se refresca por detrás ─────────────────────
// Este panel lo abre TODO EL MUNDO al entrar y son unas veinte consultas
// pesadas: tarda unos nueve segundos en frío. Una pantalla de entrada no puede
// tardar nueve segundos.
//
// Así que se sirve SIEMPRE lo último que se calculó, aunque esté pasado, y el
// recálculo se lanza por detrás para el siguiente. Solo espera de verdad quien
// entra el primero tras arrancar. Los datos de fondo se refrescan cada cinco
// minutos (la ingesta), así que enseñar algo de hace tres no engaña a nadie —y
// para saberlo está `calculadoAt`, que la pantalla enseña—.
const FRESCO = 5 * 60 * 1000;    // más nuevo que esto, no se toca
const VIEJO_TOPE = 30 * 60 * 1000;   // más viejo que esto, mejor esperar al nuevo
let cache = null;      // { datos, ts }
let enVuelo = null;    // el recálculo en curso, si lo hay

function recalcular() {
  if (enVuelo) return enVuelo;
  enVuelo = panel()
    .then(datos => { cache = { datos, ts: Date.now() }; return datos; })
    .finally(() => { enVuelo = null; });
  return enVuelo;
}

async function panelCacheado({ forzar = false } = {}) {
  // Pedir refresco a mano recalcula de verdad. Es lo único que salta la caché:
  // entrar a la pantalla NO recalcula, sirve lo último que hay.
  if (forzar) {
    const datos = await recalcular();
    return { ...datos, calculadoAt: Date.now(), edadMs: 0 };
  }
  const edad = cache ? Date.now() - cache.ts : Infinity;
  if (edad < FRESCO) return { ...cache.datos, calculadoAt: cache.ts, edadMs: edad };

  // Hay algo y no es una antigualla: se devuelve YA y se refresca por detrás.
  if (cache && edad < VIEJO_TOPE) {
    recalcular().catch(e => console.error('❌ [INICIO] refresco en segundo plano:', e.message));
    return { ...cache.datos, calculadoAt: cache.ts, edadMs: edad };
  }

  // Nada en caché (o demasiado viejo): toca esperar. Si entran cinco a la vez,
  // las cinco esperan al MISMO cálculo, no lanzan cinco.
  const datos = await recalcular();
  return { ...datos, calculadoAt: Date.now(), edadMs: 0 };
}

module.exports = {
  panel: panelCacheado,
  conectadosPorTurno,
  noEfectivas, kilometros, jornadaDe, diaMenos, JORNADA_DEFECTO,
};
