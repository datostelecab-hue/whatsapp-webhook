// ============================================================
// RENDIMIENTO DE LAS ZONAS Y LOS CUADRANTES — las cuentas
// ============================================================
// Camilo, 06/11/2026: «un reporte de horas por zona, teniendo en cuenta la
// cantidad de coches que hay, entonces es como un rendimiento de zonas, ver qué
// falta, CT y fijos; si hay un coche configurado sin CT entonces no cuenta, es
// como el colorido pero sin contar lo de conductores mal planificados. Y que
// diga cuántas horas deben hacer a fin de mes y cómo van, separados siempre por
// cuadrantes» y «Cada coche debe hacer por lo menos 8 horas por plaza. Si es uno
// con CT entonces son 4 conductores que deben de hacer 8 horas, si no tiene un
// correturnos entonces ahí es donde falla el cuadrante de la zona y le baja el
// rendimiento a la misma, eso es lo que necesitamos ver». Y luego: «el reporte
// ejecutivo debe de descargarse junto con el excel en telecab … resumido en 2
// páginas».
//
// Nació como script de análisis (06/11/2026, revisado por tres revisores) y vive
// aquí: Control › Reportes baja el Excel (rendimiento.excel.js) y el ejecutivo
// en PDF (rendimiento.pdf.js) de un clic.
//
// LAS REGLAS
//   · DEBEN HACER: cada turno que le toca al coche, a 8 h (HORAS_TURNO). Con
//     correturnos, los dos turnos todos los días (4 plazas, 16 h): si falta el CT
//     esos turnos se piden igual, y es lo que baja el rendimiento. Configurado
//     SIN correturnos (vehiculo_sin_ct, con sus fechas) no se pide el turno del
//     fijo que libra ESE día (vehiculo_descanso vigente ese día).
//   · Los días que el coche estuvo PARADO (estado no operativo en
//     vehiculo_estado_hist: taller, Policía…, como coche.operativo en el
//     planificador) no se piden ni cuentan sus horas, salvo que BOLT diga que
//     rodó 1 h o más: el historial de antes del 08/10 no es del todo fiable
//     (db/188). Un coche cuenta desde su primera plaza (sus horas de antes, no).
//   · LLEVAN: las horas del coche en BOLT (fv_tramo, viaje y espera), lo lleve
//     quien lo lleve, por día natural de Madrid, hasta ayer a las 24:00, los
//     solapes una vez. Cómo van = llevan ÷ lo que debían llevar hasta ayer.
//   · TURNOS SIN CONDUCTOR: los que le tocaban y no tienen a nadie en
//     f_cobertura (quien está de vacaciones o de baja no cubre) ni en un relevo
//     (plan_relevo, quien entra). Los que caen el día que libra el fijo son
//     FALTA DE CT. A 8 h cada uno, las horas que se pierden.
//   · LO QUE FALTA HOY (fijos, días de CT): coche.falta del planificador, con su
//     regla: solo coches que ruedan, y en un turno sin fijo no se piden días de
//     CT (falta el fijo). CT que faltan = días ÷ 6, hacia arriba (iceberg.js).
//   · El reparto en cuadrantes es el de HOY (vehiculo.cuadrante_id no tiene
//     historial): un coche que cambió de cuadrante cuenta entero en el de hoy, y
//     un coche que tuvo plaza en el mes pero hoy no está en el planificador
//     (dado de baja, sin cuadrante y fuera de la cobertura) va con «sin
//     cuadrante», hasta el último día que tuvo plaza.
//   · En un mes PASADO, si el coche rodaba sale de su historial del último día
//     (con la misma excepción de BOLT), y «lo que falta» no se da: es una foto
//     del planificador, y la de entonces no se puede rehacer (lo que estaba
//     escrito para más adelante ya ha llegado).
//
// UN MES. El en curso, hasta ayer, y con lo previsto hasta fin de mes; uno
// pasado, entero (corte el 1 del mes siguiente), con las asignaciones de su
// último día. Desde septiembre de 2026: antes no hay planificador en la base.

const db = require('../../services/db');

const HORAS_TURNO = 8;            // por plaza y turno (Camilo, 06/11/2026)
const DIAS_POR_CT = 6;            // como iceberg.js: días de CT que faltan ÷ 6, hacia arriba
const PRIMER_MES = '2026-09';     // el planificador empieza en la base el 03/09/2026
// Los coches sin cuadrante son una zona más y suman al total (06/11/2026, Camilo:
// «también agrega a los que no tienen, para que sumen a esas horas. Y que se
// llame "Cuadrantes libres" como zona»).
const LIBRES = 'Cuadrantes libres';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ── Fechas: 'AAAA-MM-DD', día natural de Madrid ─────────────────────────────
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const mas = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const isodow = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const finDeMes = mesIso => new Date(Date.UTC(+mesIso.slice(0, 4), +mesIso.slice(5, 7), 0)).toISOString().slice(0, 10);
const mesSiguiente = mesIso => mas(finDeMes(mesIso), 1).slice(0, 7);
const nombreMes = mesIso => `${MESES[Number(mesIso.slice(5, 7)) - 1]} ${mesIso.slice(0, 4)}`;

// Las 00:00 de Madrid de un día, en milisegundos, con su horario de verano.
const cacheCero = new Map();
const FMT_HORA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false });
function ceroMadrid(dia) {
  if (cacheCero.has(dia)) return cacheCero.get(dia);
  const [y, m, d] = dia.split('-').map(Number);
  for (const off of [1, 2]) {
    const t = Date.UTC(y, m - 1, d, -off);
    if (Number(FMT_HORA.format(new Date(t))) % 24 === 0) { cacheCero.set(dia, t); return t; }
  }
  throw new Error('No sé las 00:00 de ' + dia);
}

/** Los intervalos [ini, fin] (ms) fundidos: lo que se pisa cuenta una vez. */
function fundir(ratos) {
  const o = (ratos || []).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  o.forEach(([a, b]) => {
    const u = out[out.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], b); else out.push([a, b]);
  });
  return out;
}

/**
 * El periodo de un mes ('AAAA-MM'): sus días, el corte (`hoy`: el día que aún
 * no cuenta), y el día del planificador que manda (hoy en el en curso; su último
 * día en uno pasado).
 */
function periodo(mes, hoy = hoyMadrid()) {
  const actual = hoy.slice(0, 7);
  const m = /^\d{4}-\d{2}$/.test(mes || '') ? mes : actual;
  if (m > actual) throw new Error('Ese mes aún no ha empezado');
  if (m < PRIMER_MES) throw new Error('El planificador empieza en septiembre de 2026: antes no hay cuadrantes en la base');
  const enCurso = m === actual;
  const ini = m + '-01', fin = finDeMes(m);
  const corte = enCurso ? hoy : mesSiguiente(m) + '-01';
  const dias = []; for (let d = ini; d <= fin; d = mas(d, 1)) dias.push(d);
  return { mes: m, nombre: nombreMes(m), enCurso, ini, fin, hoy: corte, ayer: mas(corte, -1),
    diaPlan: enCurso ? hoy : fin, dias, cerrados: dias.filter(d => d < corte).length };
}

/** Los meses que ofrece la tarjeta: el en curso y los anteriores desde septiembre de 2026. */
function meses(hoy = hoyMadrid()) {
  const out = [];
  for (let m = hoy.slice(0, 7); m >= PRIMER_MES; m = mas(m + '-01', -1).slice(0, 7)) out.push(m);
  // Por defecto el en curso; el día 1 aún no tiene ningún día cerrado: el anterior.
  const def = hoy.slice(8) === '01' && out.length > 1 ? out[1] : out[0];
  return out.map((m, i) => ({ mes: m, etiqueta: nombreMes(m) + (i === 0 ? ' · en curso' : ''), porDefecto: m === def }));
}

// ── LA CUENTA, pura ─────────────────────────────────────────────────────────
/**
 * Coche a coche, cuadrante a cuadrante y zona a zona. Sin base de datos: lo
 * prueba scripts/comprobar-rendimiento-cuadrantes.js.
 *
 *   per        periodo()
 *   tablero    { coches, cuadrantes, zonas } del planificador del día que manda
 *   horas      Map(matrícula normalizada → Map(día → horas))
 *   primera    Map(vehiculoId → 'AAAA-MM-DD') su primera plaza
 *   ultima     Map(vehiculoId → 'AAAA-MM-DD') el último día con plaza, de los
 *              coches que hoy ya no están en el planificador (coche.extra)
 *   parado     Map('vehiculoId|día' → etiqueta del estado no operativo)
 *   descansos  [{ v, t (1|2|null), d, h, dias: [1..7] }] con fechas
 *   sinCt      [{ v, d, h }] periodos sin correturnos
 *   cubierto   Set('vehiculoId|día|turno') quién cubre (f_cobertura + relevos)
 */
function calcular({ per, tablero, horas, primera, ultima, parado, descansos, sinCt, cubierto }) {
  const porCoche = rows => { const m = new Map(); (rows || []).forEach(x => { const k = String(x.v); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
  const descansosDe = porCoche(descansos), sinCtDe = porCoche(sinCt);
  // ¿Libra el fijo de ese turno (1 día, 2 noche) ese día? Es el día de CT.
  const libraFijo = (v, d, tu) => (descansosDe.get(v) || []).some(x =>
    (x.t == null || Number(x.t) === tu) && x.d <= d && x.h >= d && (x.dias || []).map(Number).includes(isodow(d)));
  const sinCtEn = (v, d) => (sinCtDe.get(v) || []).some(x => x.d <= d && x.h >= d);
  const turnosQueTocan = (v, d) => (sinCtEn(v, d) ? [1, 2].filter(tu => !libraFijo(v, d, tu)) : [1, 2]);
  const norm = m => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const cocheX = coche => {
    const v = String(coche.vehiculoId);
    const desde = [per.ini, (primera && primera.get(v)) || per.ini].sort()[1];
    const hasta = (ultima && ultima.get(v)) || per.fin;        // el último día que cuenta
    const suyas = (horas && horas.get(norm(coche.matricula))) || new Map();
    let objMes = 0, objAyer = 0, llevan = 0, sinPasados = 0, sinPrevistos = 0, sinCtPasados = 0, sinCtPrevistos = 0, diasParado = 0;
    const dias = per.dias.map(d => {
      const cerrado = d < per.hoy;
      const h = cerrado ? (suyas.get(d) || 0) : null;
      const antes = d < desde, despues = d > hasta;
      // Parado ese día (taller, Policía…), salvo que BOLT diga que rodó.
      const est = antes || despues ? null : (parado && parado.get(`${v}|${d}`)) || null;
      const esParado = !!est && !(cerrado && h >= 1);
      if (esParado && cerrado) diasParado++;
      const tocan = antes || despues || esParado ? [] : turnosQueTocan(v, d);
      const obj = tocan.length * HORAS_TURNO;
      objMes += obj;
      if (cerrado) { objAyer += obj; if (!antes && !despues && !esParado) llevan += h; }
      // Sin nadie en el cuadrante; de ellos, el día que libra el fijo: falta de CT.
      const sinT = tocan.filter(tu => !cubierto.has(`${v}|${d}|${tu}`));
      const sin = sinT.length, sinCtD = sinT.filter(tu => libraFijo(v, d, tu)).length;
      if (cerrado) { sinPasados += sin; sinCtPasados += sinCtD; } else { sinPrevistos += sin; sinCtPrevistos += sinCtD; }
      return { d, turnos: tocan.length, obj, h, antes, despues, parado: esParado ? est : null, sin, sinCt: sinCtD };
    });
    // ¿Rueda? En el mes en curso, lo que dice hoy el planificador. En uno pasado
    // (o un coche que hoy ya no está en él), su historial del último día, con la
    // misma excepción de BOLT: el estado de hoy no dice nada de entonces.
    const corte = dias.find(x => x.d === (per.enCurso ? per.hoy : per.fin)) || {};
    const conFoto = per.enCurso && !coche.extra;
    const rueda = conFoto ? !!coche.operativo : !corte.parado && !corte.antes && !corte.despues;
    const estadoCorte = conFoto ? null : (corte.parado || (corte.despues ? 'ya no está en el planificador' : null));
    // Lo que falta hoy, con la regla del planificador. Solo en el mes en curso:
    // en uno pasado es una foto que no se puede rehacer (falta = null).
    const f = (conFoto && coche.falta) || { fijo: {}, ct: {} };
    const fijo = f.fijo || {}, ct = f.ct || {};
    const fijoDia = conFoto && rueda && !!fijo.dia, fijoNoche = conFoto && rueda && !!fijo.noche;
    const ctDia = !conFoto || !rueda || coche.sinCT || fijoDia ? 0 : Number(ct.dia) || 0;
    const ctNoche = !conFoto || !rueda || coche.sinCT || fijoNoche ? 0 : Number(ct.noche) || 0;
    const falta = !per.enCurso ? null : [fijoDia ? 'el fijo de día' : '', fijoNoche ? 'el fijo de noche' : '',
      ctDia ? `${ctDia} día${ctDia === 1 ? '' : 's'} de CT de día` : '', ctNoche ? `${ctNoche} día${ctNoche === 1 ? '' : 's'} de CT de noche` : ''].filter(Boolean);
    const pct = objAyer ? llevan / objAyer : null;
    const restantes = dias.filter(x => x.d >= per.hoy).reduce((s, x) => s + x.turnos, 0);
    const faltan = Math.max(0, objMes - llevan);
    return {
      coche, desde, hasta, dias, objMes, objAyer, llevan, pct, restantes, diasParado, estadoCorte,
      ritmo: pct == null ? null : objMes * pct, faltan,
      porTurno: restantes ? faltan / restantes : null,     // lo que necesitan por turno hasta fin de mes
      fijoDia, fijoNoche, fijosFaltan: (fijoDia ? 1 : 0) + (fijoNoche ? 1 : 0), ctDia, ctNoche, falta, rueda,
      sinPasados, sinPrevistos, sinMes: sinPasados + sinPrevistos, perdidas: (sinPasados + sinPrevistos) * HORAS_TURNO,
      sinCtPasados, sinCtPrevistos, sinCtMes: sinCtPasados + sinCtPrevistos, perdidasCt: (sinCtPasados + sinCtPrevistos) * HORAS_TURNO,
    };
  };

  // Zonas → cuadrantes → coches, en el orden del planificador.
  const cuadranteDe = new Map((tablero.cuadrantes || []).map(c => [String(c.id), c]));
  const grupos = new Map();
  (tablero.coches || []).forEach(coche => {
    // Un coche que entró en el planificador después del mes no es de ese mes.
    if (primera && primera.get(String(coche.vehiculoId)) > per.fin) return;
    const cu = coche.cuadranteId ? cuadranteDe.get(String(coche.cuadranteId)) : null;
    const k = cu ? 'c' + cu.id : 'sin';
    if (!grupos.has(k)) {
      grupos.set(k, { k, zona: cu ? (cu.zona || coche.zona || 'Sin zona') : LIBRES, numero: cu ? Number(cu.numero) : 1e9,
        nombre: cu ? (cu.nombre || 'Cuadrante ' + cu.numero) : LIBRES, coches: [] });
    }
    grupos.get(k).coches.push(cocheX(coche));
  });
  const ordenZonas = (tablero.zonas || []).map(z => (typeof z === 'string' ? z : z && (z.nombre || z.zona))).filter(x => typeof x === 'string');
  const zonaOrden = z => { const i = ordenZonas.indexOf(z); return z === LIBRES ? 1e9 : i < 0 ? 1e6 : i; };
  const lista = [...grupos.values()].sort((a, b) => zonaOrden(a.zona) - zonaOrden(b.zona) || a.zona.localeCompare(b.zona) || a.numero - b.numero);
  lista.forEach(g => { g.coches.sort((a, b) => a.coche.matricula.localeCompare(b.coche.matricula)); g.tot = totales(g.coches); });
  // Los cuadrantes libres son una zona más (la última) y entran en el total.
  const zonas = [...new Set(lista.map(g => g.zona))].map(z => {
    const gs = lista.filter(g => g.zona === z);
    return { zona: z, grupos: gs, tot: totales(gs.flatMap(g => g.coches)) };
  });
  const sin = lista.find(g => g.k === 'sin') || null;
  return { grupos: lista, zonas, sinCuadrante: sin, total: totales(lista.flatMap(g => g.coches)) };
}

/** Las sumas de un grupo de coches. Los CT que faltan, sobre los días juntos (÷ 6). */
function totales(xs) {
  const suma = k => xs.reduce((s, x) => s + (x[k] || 0), 0);
  const objMes = suma('objMes'), objAyer = suma('objAyer'), llevan = suma('llevan');
  const pct = objAyer ? llevan / objAyer : null;
  const ctDia = suma('ctDia'), ctNoche = suma('ctNoche');
  const restantes = suma('restantes'), faltan = Math.max(0, objMes - llevan);
  return { coches: xs.length, fijosFaltan: suma('fijosFaltan'), ctDia, ctNoche,
    sinPasados: suma('sinPasados'), sinPrevistos: suma('sinPrevistos'), sinMes: suma('sinMes'), perdidas: suma('perdidas'),
    sinCtPasados: suma('sinCtPasados'), sinCtPrevistos: suma('sinCtPrevistos'), sinCtMes: suma('sinCtMes'), perdidasCt: suma('perdidasCt'),
    ctFaltan: Math.ceil(ctDia / DIAS_POR_CT) + Math.ceil(ctNoche / DIAS_POR_CT), diasParado: suma('diasParado'),
    objMes, objAyer, llevan, pct, ritmo: pct == null ? null : objMes * pct, faltan, restantes,
    porTurno: restantes ? faltan / restantes : null };
}

// ── Los datos de la base ────────────────────────────────────────────────────
async function cargar(per) {
  const planificador = require('../Planificacion/planificador.repo');
  const t0 = await planificador.tablero({ dia: per.diaPlan });
  const corte = Math.min(ceroMadrid(per.hoy), Date.now());          // hasta ayer a las 24:00
  const desdeMs = ceroMadrid(per.ini);
  // Los coches que tuvieron plaza en el mes y hoy no salen en el tablero (dados
  // de baja, sin cuadrante y fuera de la cobertura): sus horas y sus turnos sin
  // nadie también son del mes. Van con «sin cuadrante», hasta su último día con plaza.
  const enTablero = new Set(t0.coches.map(c => String(c.vehiculoId)));
  const conPlaza = (await db.consulta(
    `SELECT p.vehiculo_id::text AS v, v.matricula,
            to_char(max(LEAST(COALESCE(a.hasta, $2::date), COALESCE(p.baja_at::date, $2::date), $2::date)), 'YYYY-MM-DD') AS ultima
       FROM asignacion a JOIN plaza p ON p.id = a.plaza_id JOIN vehiculo v ON v.id = p.vehiculo_id
      WHERE a.desde <= $2::date AND (a.hasta IS NULL OR a.hasta >= $1::date)
      GROUP BY 1, 2`, [per.ini, per.fin])).rows.filter(x => !enTablero.has(x.v) && x.ultima >= per.ini);
  const extras = conPlaza.map(x => ({ vehiculoId: Number(x.v), matricula: x.matricula, cuadranteId: null, operativo: true, sinCT: false,
    personas: [], falta: { fijo: {}, ct: {} }, extra: true }));
  const t = { ...t0, coches: [...t0.coches, ...extras] };
  // Los que tenían plaza ese día y ya no están en plantilla (el tablero los da
  // «huérfanos», sin nombre): su nombre sale de la asignación.
  const huerfanas = [...new Set(t0.coches.flatMap(c => (c.personas || []).filter(p => p && p.asignacionId && !p.id).map(p => String(p.asignacionId))))];
  const [contactos, veh, tramos, primera, paradosQ, estadosQ, descansosQ, sinCtQ, cubiertoQ, huerfanosQ] = await Promise.all([
    planificador.contactos().catch(() => new Map()),
    db.consulta('SELECT id, marca_modelo FROM vehiculo WHERE id = ANY($1::bigint[])', [t.coches.map(c => c.vehiculoId)]),
    corte > desdeMs ? db.consulta(
      `SELECT upper(regexp_replace(fv.matricula, '[^A-Za-z0-9]', '', 'g')) AS m,
              GREATEST(t.desde, to_timestamp($1 / 1000.0)) AS d, LEAST(COALESCE(t.hasta, now()), to_timestamp($2 / 1000.0)) AS h
         FROM fv_tramo t
         JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
         JOIN fv_vehiculo fv     ON fv.uuid = t.vehiculo_uuid
        WHERE t.desde < to_timestamp($2 / 1000.0) AND COALESCE(t.hasta, now()) > to_timestamp($1 / 1000.0)`,
      [desdeMs, corte]) : Promise.resolve({ rows: [] }),
    // Cuándo entró cada coche en el planificador: su primera plaza ocupada.
    db.consulta(`SELECT p.vehiculo_id::text AS v, to_char(min(a.desde), 'YYYY-MM-DD') AS desde
                   FROM asignacion a JOIN plaza p ON p.id = a.plaza_id GROUP BY 1`),
    // Los días del mes de cada coche en un estado no operativo.
    db.consulta(`SELECT h.vehiculo_id::text AS v, to_char(g, 'YYYY-MM-DD') AS d, c.etiqueta AS e
                   FROM vehiculo_estado_hist h
                   JOIN cat_estado_vehiculo c ON c.codigo = h.estado_codigo AND NOT c.es_operativo
                  CROSS JOIN generate_series(GREATEST(h.desde, $1::date), LEAST(COALESCE(h.hasta, $2::date), $2::date), INTERVAL '1 day') g
                  WHERE h.desde <= $2::date AND (h.hasta IS NULL OR h.hasta >= $1::date)`, [per.ini, per.fin]),
    db.consulta('SELECT codigo, etiqueta FROM cat_estado_vehiculo'),
    // El descanso de cada coche CON SUS FECHAS (la condición de f_cobertura, db/203).
    db.consulta(`SELECT vd.vehiculo_id::text AS v, vd.turno_id::int AS t, to_char(vd.desde, 'YYYY-MM-DD') AS d,
                        to_char(COALESCE(vd.hasta, DATE '9999-12-31'), 'YYYY-MM-DD') AS h, array_agg(vdd.dia_semana::int) AS dias
                   FROM vehiculo_descanso vd JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                  WHERE vd.desde <= $2::date AND (vd.hasta IS NULL OR vd.hasta >= $1::date)
                  GROUP BY vd.id, 1, 2, 3, 4`, [per.ini, per.fin]),
    db.consulta(`SELECT vehiculo_id::text AS v, to_char(desde, 'YYYY-MM-DD') AS d, to_char(COALESCE(hasta, DATE '9999-12-31'), 'YYYY-MM-DD') AS h
                   FROM vehiculo_sin_ct WHERE desde <= $2::date AND (hasta IS NULL OR hasta >= $1::date)`, [per.ini, per.fin]),
    // Quién cubre cada coche, turno y día: f_cobertura aparta a quien sale en un
    // relevo; quien ENTRA a cubrirle va aparte, y ese turno también está cubierto.
    db.consulta(`SELECT DISTINCT vehiculo_id::text AS v, to_char(dia, 'YYYY-MM-DD') AS d, turno_id::int AS t FROM f_cobertura($1::date, $2::date)
                 UNION
                 SELECT vehiculo_id::text, to_char(dia, 'YYYY-MM-DD'), turno_id::int FROM plan_relevo
                  WHERE anulado_at IS NULL AND conductor_entra IS NOT NULL AND dia BETWEEN $1::date AND $2::date`, [per.ini, per.fin]),
    huerfanas.length ? db.consulta(`SELECT a.id::text AS id, btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre
                   FROM asignacion a JOIN conductor c ON c.id = a.conductor_id WHERE a.id = ANY($1::bigint[])`, [huerfanas]) : Promise.resolve({ rows: [] }),
  ]);

  // Las horas de cada coche, día a día, con los solapes una vez.
  const ratos = new Map();
  tramos.rows.forEach(x => { if (!ratos.has(x.m)) ratos.set(x.m, []); ratos.get(x.m).push([new Date(x.d).getTime(), new Date(x.h).getTime()]); });
  const limites = per.dias.filter(d => d < per.hoy).map(d => [d, ceroMadrid(d), ceroMadrid(mas(d, 1))]);
  const horas = new Map();
  ratos.forEach((rs, m) => {
    const fundidos = fundir(rs);
    const out = new Map();
    limites.forEach(([d, a, b]) => {
      let ms = 0;
      fundidos.forEach(([i, f]) => { const x = Math.max(i, a), y = Math.min(f, b); if (y > x) ms += y - x; });
      if (ms) out.set(d, ms / 3600000);
    });
    horas.set(m, out);
  });

  return {
    tablero: t, contactos,
    nombreAsignacion: new Map(huerfanosQ.rows.map(x => [x.id, x.nombre])),
    modelo: new Map(veh.rows.map(v => [String(v.id), v.marca_modelo || ''])),
    etiquetaEstado: new Map(estadosQ.rows.map(x => [x.codigo, x.etiqueta])),
    entrada: {
      per, tablero: t, horas,
      primera: new Map(primera.rows.map(x => [x.v, x.desde])),
      ultima: new Map(conPlaza.map(x => [x.v, x.ultima])),
      parado: new Map(paradosQ.rows.map(x => [`${x.v}|${x.d}`, x.e])),
      descansos: descansosQ.rows, sinCt: sinCtQ.rows,
      cubierto: new Set(cubiertoQ.rows.map(x => `${x.v}|${x.d}|${x.t}`)),
    },
  };
}

/** El informe de un mes: las cuentas y lo que necesitan el Excel y el PDF para pintarlas. */
async function informe({ mes, hoy = hoyMadrid() } = {}) {
  const per = periodo(mes, hoy);
  const d = await cargar(per);
  const r = calcular(d.entrada);
  return {
    per, horasTurno: HORAS_TURNO, diasPorCt: DIAS_POR_CT,
    ...r,
    personas: new Map((d.tablero.conductores || []).map(c => [String(c.id), c])),
    contactos: d.contactos, modelo: d.modelo, etiquetaEstado: d.etiquetaEstado, nombreAsignacion: d.nombreAsignacion,
  };
}

// ── EL EJECUTIVO: lo que hay que decir, en dos páginas ──────────────────────
// Camilo, 06/11/2026: «el reporte ejecutivo debe de descargarse junto con el
// excel en telecab» y «No lo quiero tan largo, resumido en 2 páginas». Aquí se
// decide QUÉ se dice —las cifras, las frases y los topes de filas— a partir del
// informe; rendimiento.pdf.js solo lo pinta. Puro: sin base de datos.
//
// LAS CAUSAS salen de las horas: lo que falta hasta el corte se reparte en
// turnos del fijo sin nadie, días de CT sin nadie (el día que libra el fijo) y
// el resto, turnos cubiertos que no llegan a 8 h. Los días de taller no son
// causa: no se piden.

// Miles con punto también en las de cuatro cifras (es-ES no agrupa 1032).
const n0 = v => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pc = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %');
const ddmm = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const ddmmaaaa = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const yLista = xs => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs[0] || '');
// «a, b, c y 3 más»: sin dos «y» seguidas.
const conMas = (xs, n = 4) => (xs.length > n ? xs.slice(0, n).join(', ') + ` y ${xs.length - n} más` : yLista(xs));
const plural = (n, uno, varios) => `${n0(n)} ${n === 1 ? uno : varios}`;
const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
// «falta el fijo de día», «faltan 2 días de CT»: concuerda con lo que falta.
const falta = xs => (xs.length > 1 || /^([2-9]|\d{2,})/.test(xs[0] || '') ? 'faltan ' : 'falta ') + yLista(xs);
const corto = g => (g.k === 'sin' ? 'Libres' : `C${g.numero}`);
const deZona = g => (g.k === 'sin' ? 'cuadrantes libres' : `C${g.numero} de ${g.zona}`);

// Topes de filas del ejecutivo; si aun así no caben, el PDF dice cuántas quedan fuera.
const TOPE = { peores: 8, faltan: 14, coches: 10, mejores: 3, zonas: 9 };

/** Lo que falta hasta el corte, por su causa (horas). */
function causas(t, HT) {
  const deficit = t.objAyer - t.llevan;
  const hCt = t.sinCtPasados * HT, hFijo = (t.sinPasados - t.sinCtPasados) * HT;
  return { deficit, hCt, hFijo, hResto: deficit - hCt - hFijo, nCt: t.sinCtPasados, nFijo: t.sinPasados - t.sinCtPasados };
}

/** Quién deja vacía la plaza de fijo de ese turno: se va sin relevo, o no hay nadie. */
function porQueFaltaFijo(coche, slot, diaPlan) {
  const p = (coche.personas || [])[slot];
  if (p && p.id && p.hasta && !p.futuro && p.hasta >= diaPlan) return `se va el ${ddmm(p.hasta)} sin relevo`;
  return 'sin nadie';
}

/** Lo que le pasa a un cuadrante: las dos causas que más horas se llevan y, en curso, lo que falta hoy. */
function queLePasa(g, per, HT) {
  const c = causas(g.tot, HT);
  if (c.deficit <= 0) return 'Va por encima de lo que debía.';
  const partes = [
    [c.hFijo, `${n0(c.hFijo)} de turnos del fijo sin nadie (${plural(c.nFijo, 'turno', 'turnos')})`],
    [c.hCt, `${n0(c.hCt)} de días de CT sin nadie (${plural(c.nCt, 'turno', 'turnos')})`],
    [c.hResto, `${n0(c.hResto)} de turnos cubiertos que no llegan a ${HT} h`],
  ].filter(([h]) => h > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
  let txt = `Le faltan ${n0(c.deficit)} h: ${yLista(partes)}.`;
  if (per.enCurso) {
    const hoy = [];
    g.coches.forEach(x => {
      if (x.fijoDia) hoy.push(`el fijo de día del ${x.coche.matricula} (${porQueFaltaFijo(x.coche, 0, per.diaPlan)})`);
      if (x.fijoNoche) hoy.push(`el fijo de noche del ${x.coche.matricula} (${porQueFaltaFijo(x.coche, 1, per.diaPlan)})`);
    });
    const ct = [g.tot.ctNoche ? 'de noche' : '', g.tot.ctDia ? 'de día' : ''].filter(Boolean);
    if (ct.length) hoy.push(`el CT ${ct.join(' y ')}`);
    if (hoy.length) txt += ` Hoy ${falta(hoy)}.`;
  }
  return txt;
}

/** Por qué mirar un coche: primero lo que se ha perdido, luego lo que falta hoy. */
function porQueRevisar(c, per, etiquetaEstado, HT) {
  const p = [];
  if (!c.rueda) {
    p.push(c.estadoCorte ? (c.coche.extra ? c.estadoCorte : `parado el ${ddmm(per.enCurso ? per.hoy : per.fin)} (${String(c.estadoCorte).toLowerCase()})`)
      : `parado hoy (${String((etiquetaEstado && etiquetaEstado.get(c.coche.estadoVeh)) || 'no operativo').toLowerCase()})`);
  }
  if (!c.llevan && c.objAyer) p.push(c.desde > per.ini ? `sin horas en BOLT desde que entró, el ${ddmm(c.desde)}` : 'sin horas en BOLT en el mes');
  if (c.sinPasados) p.push(`${plural(c.sinPasados, 'turno', 'turnos')} sin nadie (${n0(c.sinPasados * HT)} h${c.sinCtPasados ? `, ${c.sinCtPasados} de CT` : ''})`);
  const cub = c.objAyer - c.sinPasados * HT;
  if (c.llevan > 0 && cub > 0 && c.llevan / cub < 0.8) p.push(`sus turnos cubiertos van al ${pc(c.llevan / cub)}`);
  if (c.falta && c.falta.length) p.push(`hoy ${falta(c.falta)}`);
  if (c.diasParado >= 3) p.push(`${c.diasParado} días parado, que no se piden`);
  if (!p.length) return 'Sin turnos vacíos: es el rendimiento de sus conductores.';
  return mayus(p.join('; ')) + '.';
}

function ejecutivo(inf) {
  const { per, total: T } = inf;
  const HT = inf.horasTurno;
  const mes = per.nombre.split(' ')[0];
  const hayDias = per.cerrados > 0 && T.objAyer > 0;
  const enCuadrante = inf.grupos.filter(g => g.k !== 'sin');
  const todos = inf.grupos.flatMap(g => g.coches.map(c => ({ c, g })));
  const S = inf.sinCuadrante ? inf.sinCuadrante.tot : null;
  const { deficit, hCt, hFijo, hResto } = causas(T, HT);

  const titulo = `Rendimiento de los cuadrantes · ${per.nombre}`;
  const flota = S && S.coches ? `${T.coches} coches: ${T.coches - S.coches} en ${enCuadrante.length} cuadrantes y ${S.coches} en cuadrantes libres`
    : `${T.coches} coches en ${enCuadrante.length} cuadrantes`;
  const sub = !per.enCurso ? `${mayus(mes)} entero · reparto de cuadrantes de hoy · ${flota}`
    : !per.cerrados ? `Aún sin días cerrados · lo previsto del 1 al ${Number(per.fin.slice(8))} de ${mes} · planificador del ${ddmmaaaa(per.diaPlan)} · ${flota}`
      : `Del 1 al ${Number(per.ayer.slice(8))} de ${mes} (días cerrados) y lo previsto hasta el ${Number(per.fin.slice(8))} · planificador del ${ddmmaaaa(per.diaPlan)} · ${flota}`;
  let frase, explica = '';
  if (!hayDias) {
    frase = `Aún no hay ningún día cerrado en ${mes}: el informe empieza a contar mañana.`;
  } else {
    const dif = T.ritmo - T.objMes;
    frase = per.enCurso
      ? `Los cuadrantes van al ${pc(T.pct)} de las horas que debían: a este ritmo cierran ${mes} con ${n0(T.ritmo)} h de ${n0(T.objMes)}, ${n0(Math.abs(dif))} h ${dif < 0 ? 'por debajo' : 'por encima'}.`
      : `Los cuadrantes hicieron el ${pc(T.pct)} de las horas que debían en ${mes}: ${n0(T.llevan)} h de ${n0(T.objAyer)}.`;
    explica = deficit > 0
      ? `${per.enCurso ? `Faltan ${n0(deficit)} h hasta el ${ddmm(per.ayer)}` : `Faltaron ${n0(deficit)} h`}: ${n0(hCt)} por falta de CT (${plural(T.sinCtPasados, 'turno', 'turnos')} sin nadie el día que libra el fijo), ` +
        `${n0(hFijo)} por turnos del fijo sin nadie (${n0(T.sinPasados - T.sinCtPasados)}) y ` +
        (hResto >= 0 ? `${n0(hResto)} de turnos cubiertos que no llegan a ${HT} h.` : `los turnos cubiertos hacen ${n0(-hResto)} h de más.`)
      : per.enCurso ? `Llevan ${n0(-deficit)} h más de las que debían hasta el ${ddmm(per.ayer)}.` : `Hicieron ${n0(-deficit)} h más de las que debían en ${mes}.`;
  }

  // Lo que falta hoy: el total ya lleva los cuadrantes libres (como el planificador).
  const fF = T.fijosFaltan, cD = T.ctDia, cN = T.ctNoche;
  const ctF = Math.ceil(cD / inf.diasPorCt) + Math.ceil(cN / inf.diasPorCt);
  const sinDias = 'aún sin días cerrados';
  const kpis = [
    { etq: per.enCurso ? 'Cómo van' : 'Cómo fueron', valor: pc(T.pct), pie: hayDias ? `de lo que debían hasta el ${ddmm(per.ayer)}` : sinDias, pct: T.pct },
    per.enCurso
      ? { etq: 'A este ritmo, a fin de mes', valor: T.ritmo == null ? '—' : n0(T.ritmo) + ' h', pie: `de ${n0(T.objMes)} h que deben en el mes` }
      : { etq: 'Debían en el mes', valor: n0(T.objMes) + ' h', pie: `${T.coches} coches, ${HT} h por plaza y turno` },
    { etq: per.enCurso ? 'Llevan' : 'Hicieron', valor: n0(T.llevan) + ' h', pie: !hayDias ? sinDias : per.enCurso ? `de ${n0(T.objAyer)} h hasta el ${ddmm(per.ayer)}` : 'horas de los coches en BOLT' },
    { etq: 'Turnos sin conductor', valor: n0(T.sinPasados), pie: per.enCurso ? `y ${n0(T.sinPrevistos)} previstos hasta el ${ddmm(per.fin)}` : `${n0(T.sinPasados * HT)} h perdidas` },
    { etq: 'Por falta de CT', valor: n0(hCt) + ' h', pie: per.enCurso && T.sinCtPrevistos ? `${plural(T.sinCtPasados, 'turno', 'turnos')} · +${n0(T.sinCtPrevistos * HT)} h previstas` : `${plural(T.sinCtPasados, 'turno', 'turnos')} el día que libra el fijo` },
    per.enCurso
      ? { etq: `Faltan el ${ddmm(per.diaPlan)}`, valor: `${fF} fijo${fF === 1 ? '' : 's'} · ${ctF} CT`, pie: `${cD + cN} días de CT a la semana` }
      : { etq: 'Lo que falta', valor: '—', pie: 'solo en el mes en curso' },
  ];

  const cascada = [
    { txt: 'Debían', pie: hayDias ? `del 1 al ${ddmm(per.ayer)}` : sinDias, valor: T.objAyer, tipo: 'total' },
    { txt: 'Sin CT', pie: 'libraba el fijo', valor: -hCt, tipo: 'paso' },
    { txt: 'Sin fijo', pie: 'vacante o fuera', valor: -hFijo, tipo: 'paso' },
    { txt: 'Cubiertos', pie: hResto >= 0 ? `no llegan a ${HT} h` : `pasan de ${HT} h`, valor: -hResto, tipo: 'paso' },
    { txt: 'Llevan', pie: 'horas en BOLT', valor: T.llevan, tipo: 'total' },
  ];

  const filaZona = (nombre, t, extra = {}) => ({ nombre, coches: t.coches, debian: t.objAyer, llevan: t.llevan, pct: t.pct, ritmo: per.enCurso ? t.ritmo : t.llevan,
    deben: t.objMes, sin: `${t.sinPasados} / ${t.sinPrevistos}`, perdidas: t.perdidas, perdidasCt: t.perdidasCt, ...extra });
  let zonas = inf.zonas.map(z => filaZona(z.zona, z.tot)).sort((a, b) => (a.pct == null ? 9 : a.pct) - (b.pct == null ? 9 : b.pct));
  if (zonas.length > TOPE.zonas) {
    const fuera = zonas.length - TOPE.zonas;
    zonas = zonas.slice(0, TOPE.zonas);
    zonas.push({ nombre: `y ${fuera} zona${fuera === 1 ? '' : 's'} más (en el Excel)`, nota: true });
  }
  zonas.push(filaZona('Total', T, { total: true }));

  // Los cuadrantes, de peor a mejor (los libres son una zona, no un cuadrante: no van aquí).
  const conPct = enCuadrante.filter(g => g.tot.pct != null).sort((a, b) => a.tot.pct - b.tot.pct);
  const semaforo = { verde: conPct.filter(g => g.tot.pct >= 0.9).length, ambar: conPct.filter(g => g.tot.pct >= 0.7 && g.tot.pct < 0.9).length, rojo: conPct.filter(g => g.tot.pct < 0.7).length };
  const cuadrantes = conPct.map(g => ({ etq: corto(g), zona: g.zona, pct: g.tot.pct }));
  const peores = conPct.slice(0, TOPE.peores).map(g => ({ nombre: corto(g), zona: g.zona, pct: g.tot.pct, llevan: g.tot.llevan, debian: g.tot.objAyer,
    sin: `${g.tot.sinPasados} / ${g.tot.sinPrevistos}`, sinCt: `${g.tot.sinCtPasados} / ${g.tot.sinCtPrevistos}`, que: queLePasa(g, per, HT) }));
  // Los que mejor van, solo si no están ya en la tabla de los peores.
  const mejores = conPct.slice(Math.max(TOPE.peores, conPct.length - TOPE.mejores)).reverse().map(g => `${deZona(g)} (${pc(g.tot.pct)})`);

  // Lo que falta en el planificador el día que manda (solo en el mes en curso).
  const faltanTodas = [];
  if (per.enCurso) {
    inf.grupos.forEach(g => {
      g.coches.forEach(c => {
        if (c.fijoDia) faltanTodas.push({ zona: g.zona, cu: corto(g), coches: c.coche.matricula, que: `Fijo de día: ${porQueFaltaFijo(c.coche, 0, per.diaPlan)}`, peso: 0, txt: `el fijo de día del ${c.coche.matricula} (${deZona(g)}${/sin relevo/.test(porQueFaltaFijo(c.coche, 0, per.diaPlan)) ? ', ' + porQueFaltaFijo(c.coche, 0, per.diaPlan) : ''})` });
        if (c.fijoNoche) faltanTodas.push({ zona: g.zona, cu: corto(g), coches: c.coche.matricula, que: `Fijo de noche: ${porQueFaltaFijo(c.coche, 1, per.diaPlan)}`, peso: 0, txt: `el fijo de noche del ${c.coche.matricula} (${deZona(g)}${/sin relevo/.test(porQueFaltaFijo(c.coche, 1, per.diaPlan)) ? ', ' + porQueFaltaFijo(c.coche, 1, per.diaPlan) : ''})` });
      });
      [['ctNoche', 'noche'], ['ctDia', 'día']].forEach(([k, turno]) => {
        const cs = g.coches.filter(c => c[k]);
        if (!cs.length) return;
        const dias = cs.reduce((s, c) => s + c[k], 0);
        faltanTodas.push({ zona: g.zona, cu: corto(g), coches: cs.map(c => c.coche.matricula).join(', '), que: `CT de ${turno} (${dias} día${dias === 1 ? '' : 's'})`, peso: 1 });
      });
    });
  }
  const faltan = faltanTodas.sort((a, b) => a.peso - b.peso).slice(0, TOPE.faltan);

  // Los coches que más tiran hacia abajo.
  const peoresCoches = todos.filter(({ c }) => c.pct != null).sort((a, b) => a.c.pct - b.c.pct).slice(0, TOPE.coches)
    .map(({ c, g }) => ({ mat: c.coche.matricula, donde: deZona(g), pct: c.pct, por: porQueRevisar(c, per, inf.etiquetaEstado, HT) }));

  // Las prioridades, de lo que más horas se lleva y antes se arregla. La cifra
  // va primero: si la frase no cabe, se corta la lista, no el número.
  const prioridades = [];
  const masVacios = (k, n = 3) => enCuadrante.map(g => ({ g, v: k(g.tot) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, n).map(x => deZona(x.g));
  const ctGrupos = per.enCurso ? inf.grupos.filter(g => g.tot.ctDia || g.tot.ctNoche) : [];
  const listaCt = k => {
    const gs = ctGrupos.filter(g => g.tot[k]);
    const zs = [...new Set(gs.map(g => g.zona))];
    return conMas(zs.map(z => { const de = gs.filter(g => g.zona === z); return de[0].k === 'sin' ? 'cuadrantes libres' : `${yLista(de.map(corto))} de ${z}`; }), 5);
  };
  if (hCt > 0 || ctGrupos.length) {
    const coste = `La falta de CT ${per.enCurso ? 'ya ha costado' : 'costó'} ${n0(hCt)} h` + (per.enCurso && T.sinCtPrevistos ? ` y hay ${n0(T.sinCtPrevistos * HT)} h más previstas hasta fin de mes` : '');
    if (ctGrupos.length) {
      const noche = listaCt('ctNoche'), dia = listaCt('ctDia');
      prioridades.push(`${coste}. Poner los correturnos que faltan${noche ? `, de noche en ${noche}` : ''}${dia ? `${noche ? ';' : ','} de día en ${dia}` : ''}.`);
    } else {
      prioridades.push(`${coste}${hCt ? `, sobre todo en ${yLista(masVacios(t => t.sinCtPasados))}` : ''}. ${per.enCurso ? 'Hoy no falta ningún CT en el planificador: son ausencias de los que hay.' : 'Mirar quién cubre los días que libra el fijo.'}`);
    }
  }
  const fijosHoy = faltanTodas.filter(f => f.peso === 0);
  if (hFijo > 0 || fijosHoy.length) {
    const partes = [];
    if (hFijo > 0) partes.push(`en el mes se ${T.sinPasados - T.sinCtPasados === 1 ? 'ha quedado 1 turno' : `han quedado ${n0(T.sinPasados - T.sinCtPasados)} turnos`} del fijo sin nadie (${n0(hFijo)} h), sobre todo en ${yLista(masVacios(t => t.sinPasados - t.sinCtPasados))}`);
    if (fijosHoy.length) partes.push(`hoy ${fijosHoy.length > 1 ? 'faltan' : 'falta'} ${conMas(fijosHoy.map(f => f.txt), 4)}`);
    prioridades.push(`Cubrir los fijos: ${partes.join('; ')}.`);
  }
  // Los que ya salieron del planificador no son algo que mirar: ya no están.
  const mirar = todos.filter(({ c }) => !c.coche.extra && c.objAyer > 0 && (!c.rueda || !c.llevan));
  if (mirar.length) {
    prioridades.push(`Mirar los coches que no ruedan: ${conMas(mirar.map(({ c }) => `el ${c.coche.matricula} (${!c.rueda ? (c.coche.extra ? 'ya no está en el planificador' : `parado${per.enCurso ? '' : ' el ' + ddmm(per.fin)}`) : c.desde > per.ini ? `sin horas desde el ${ddmm(c.desde)}` : 'sin horas en el mes'})`), 4)}.`);
  }
  if (hResto > 0) {
    const cub = c => c.objAyer - c.sinPasados * HT;
    const flojos = todos.filter(({ c }) => c.rueda && !(c.falta && c.falta.length) && c.llevan > 0 && cub(c) > 0 && c.llevan / cub(c) < 0.8)
      .sort((a, b) => a.c.llevan / cub(a.c) - b.c.llevan / cub(b.c)).slice(0, 3).map(({ c }) => `el ${c.coche.matricula} (${pc(c.llevan / cub(c))} en sus turnos cubiertos)`);
    prioridades.push(`Los turnos cubiertos que no llegan a ${HT} h suman ${n0(hResto)} h. Hablar con los conductores de los coches que se quedan cortos${flojos.length ? `, como ${yLista(flojos)}` : ''}.`);
  }

  const nota = `Deben hacer: ${HT} h por plaza y turno; un coche con correturnos son 4 plazas y ${2 * HT} h al día, y si falta el CT esos turnos se piden igual. ` +
    'Un coche configurado sin CT no pide el turno del fijo que libra. Los días de coche parado (taller, Policía…) no se piden, salvo que BOLT diga que rodó. ' +
    'Llevan: horas del coche en BOLT (viaje + espera). Un turno sin conductor es el que no tiene a nadie en el cuadrante (vacaciones y bajas no cubren) y se cuenta a ' +
    `${HT} h. ` + (per.enCurso ? `Lo que falta es la foto del planificador del ${ddmm(per.diaPlan)}. ` : 'El reparto en cuadrantes es el de hoy. ') + 'El detalle, coche a coche y día a día, en el Excel.';

  return { titulo, sub, frase, explica, kpis, cascada, zonas, cuadrantes, semaforo, peores, mejores,
    cerrado: !per.enCurso, hayDias, deficit,
    faltan, faltanMas: Math.max(0, faltanTodas.length - faltan.length),
    faltanNota: per.enCurso ? '' : 'En un mes que ya terminó no se da: es una foto del planificador, y la de entonces no se puede rehacer.',
    coches: peoresCoches, prioridades: prioridades.slice(0, 4), nota };
}

module.exports = { informe, meses, periodo, calcular, fundir, ejecutivo, pc };
