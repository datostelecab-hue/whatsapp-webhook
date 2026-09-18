// ============================================================
// NÓMINAS · REPOSITORIO — SQL y nada más
// ============================================================
// Aquí está TODO lo que la nómina lee y escribe. Antes esto eran seis hojas de
// cálculo y una llamada a la API de BOLT; ahora son cuatro consultas.
//
// De dónde sale cada número de la nómina:
//
//   Horas efectivas   fv_tramo, situaciones efectivas (viaje + espera), por
//                     DÍA NATURAL y con los solapes fundidos. Ojo: la bitácora
//                     mide por jornada 05→05, así que para quien trabaja de
//                     noche los dos numeros NO coinciden, y es a proposito.
//                     Ver la nota larga de HORA_CORTE mas abajo.
//   Nocturnas         el trozo de esas mismas horas que cae entre las 22:00 y
//                     las 06:00 (hora de Madrid).
//   Utilización       viaje / (viaje + espera). 'viaje' es el has_order de BOLT
//                     y 'espera' su waiting_orders: es la misma cuenta que hacía
//                     la columna "% Efec" de la hoja.
//   Dinero            v_ordenes_conductor (bolt_order), que ya existe y se hizo
//                     para esto: la fuente única para nómina, bonus y plus de
//                     calidad.
//   Ficha             conductor + conductor_periodo_empleo: DNI, si es de ETT o
//                     de plantilla propia, la jornada (40/32) y la FECHA DE ALTA.
//
// EL CAMBIO QUE MÁS SE NOTA ES LA FECHA DE ALTA. En la hoja salía de la columna
// G de AGENDA_V2, escrita a mano en dd/mm/aaaa, y a mucha gente le faltaba: sin
// ella el prorrateo caía al criterio viejo (el primer día con horas), que
// perjudica al veterano que libró la primera quincena. En PostgreSQL la tiene el
// 100 % de la plantilla, propia y ETT.

const db = require('../../services/db');

// ── LA NÓMINA CUENTA POR DÍA NATURAL, Y ES LA ÚNICA QUE LO HACE ────────────
//
// El resto del ERP mide por JORNADA OPERATIVA: de las 05:00 a las 05:00, de
// modo que un turno de noche que acaba a las 03:51 pertenece al día anterior.
// Eso es lo correcto para la bitácora, el reporte de horas y Visibilidad, que
// son control de TURNOS: quieren ver la noche entera junta.
//
// Una nómina no es eso. Una nómina paga LO QUE PASÓ EN EL MES, y el mes va del
// día 1 a las 00:00 al último a las 23:59. Un conductor de noche que rueda la
// madrugada del 1 de septiembre cobra esas horas en septiembre, aunque para la
// bitácora sean del turno del 31 de agosto.
//
// Y hay una razón práctica además de la conceptual: el dinero (facturación,
// propinas, peajes) sale de `v_ordenes_conductor`, que agrupa por día natural.
// Cuando las horas se recortaban a las 05:00 y el dinero a medianoche, las dos
// mitades del mismo cálculo miraban ventanas distintas y en el borde del mes
// no cuadraban: la facturación de la madrugada del 1 de septiembre (2.825,85 €
// en 914 pedidos) quedaba fuera de agosto mientras sus horas quedaban dentro, y
// a dos personas eso les cambiaba si superaban o no el umbral del MBO FAS.
// Con el corte a medianoche, horas, dinero y J miran exactamente lo mismo.
//
// Las J se leen igual: una J del 1 de septiembre cubre ese día natural entero.
//
// CONSECUENCIA ESPERADA: las horas de la nómina NO coinciden con las de la
// bitácora para quien trabaja de noche, y no es un fallo. Son dos preguntas
// distintas —"¿cuántas horas cayeron en este mes?" y "¿cómo fue ese turno?"— y
// cada una tiene su ventana.
const HORA_CORTE = 0;
// Franja nocturna del convenio, la misma que usaba la hoja de horas.
const NOC_DESDE = 22, NOC_HASTA = 6;

// ────────────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────────────

/** Lo guardado en nomina_config, como objeto { clave: número }. */
async function leerConfig() {
  const r = await db.consulta('SELECT clave, valor FROM nomina_config');
  const o = {};
  r.rows.forEach(x => { o[x.clave] = Number(x.valor); });
  return o;
}

/** Guarda (solo) las claves que se pasen. Devuelve cuántas quedaron escritas. */
async function guardarConfig(valores, usuarioId) {
  const claves = Object.keys(valores);
  if (!claves.length) return 0;
  await db.transaccion(async cli => {
    for (const k of claves) {
      await cli.query(
        `INSERT INTO nomina_config (clave, valor, usuario_id) VALUES ($1, $2, $3)
         ON CONFLICT (clave) DO UPDATE
           SET valor = EXCLUDED.valor, usuario_id = EXCLUDED.usuario_id, actualizado_at = now()`,
        [k, valores[k], usuarioId || null]);
    }
  });
  return claves.length;
}

// ────────────────────────────────────────────────────────────────────────────
// LOS DATOS DEL MES DE TRABAJO
// ────────────────────────────────────────────────────────────────────────────

// Los trozos de tramo EFECTIVO del rango, ya recortados por el DÍA NATURAL y
// etiquetados con su situación. Es la consulta de `bitacora.horasCalculadas`
// con dos diferencias: la hora de corte es 0 y no 5 (ver arriba), y viene la
// situación, porque la nómina necesita separar el viaje de la espera para la
// utilización.
//
// El tramo SE RECORTA por el día, no se le da entero al día en que empieza: uno
// que va de las 23:22 a las 00:36 deja 38 minutos en un día y 36 en el otro.
const SQL_TROZOS = `
  WITH tr AS (
    SELECT ce.conductor_id, t.situacion, t.desde, COALESCE(t.hasta, now()) AS hasta
      FROM fv_tramo t
      JOIN fv_cat_situacion s   ON s.codigo = t.situacion AND s.efectivo
      JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = t.conductor_uuid
     WHERE ce.conductor_id IS NOT NULL
       -- Amplio por los dos lados: un tramo puede empezar la víspera y morir
       -- dentro del rango, o empezar dentro y acabar al día siguiente.
       AND t.desde < (($2::date + 1) + ($3 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'
       AND COALESCE(t.hasta, now()) > ($1::date + ($3 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'
  ),
  trozos AS (
    SELECT tr.conductor_id, tr.situacion, g.dia::date AS dia,
           GREATEST(tr.desde, (g.dia::date + ($3 || ' hours')::interval)      AT TIME ZONE 'Europe/Madrid') AS d,
           LEAST(tr.hasta,  ((g.dia::date + 1) + ($3 || ' hours')::interval)  AT TIME ZONE 'Europe/Madrid') AS h
      FROM tr
      CROSS JOIN LATERAL generate_series(
        ((tr.desde AT TIME ZONE 'Europe/Madrid') - ($3 || ' hours')::interval)::date,
        ((tr.hasta AT TIME ZONE 'Europe/Madrid') - ($3 || ' hours')::interval)::date,
        interval '1 day') g(dia)
  )
  SELECT conductor_id, situacion, to_char(dia, 'YYYY-MM-DD') AS dia, d, h
    FROM trozos
   WHERE h > d AND dia BETWEEN $1::date AND $2::date
   ORDER BY conductor_id, dia, d`;

/** Funde una lista de [ini, fin] en ms y devuelve los intervalos sin solapes. */
function fundir(lista) {
  lista.sort((a, b) => a[0] - b[0]);
  const out = [];
  let ci = null, cf = null;
  for (const [s, e] of lista) {
    if (e <= s) continue;
    if (cf === null || s > cf) { if (cf !== null) out.push([ci, cf]); ci = s; cf = e; }
    else if (e > cf) cf = e;
  }
  if (cf !== null) out.push([ci, cf]);
  return out;
}

const segundosDe = ivs => Math.round(ivs.reduce((a, [i, f]) => a + (f - i), 0) / 1000);

// Partes de la hora de Madrid de un instante. Se calcula así y no con
// `getHours()` porque el servidor corre en UTC: allí las 23:30 de Madrid son las
// 21:30 y la franja nocturna se desplazaría una hora en invierno y dos en
// verano. Es el mismo cuidado que en el resto del ERP con las fechas.
const PARTES_MADRID = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', hour12: false,
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function horaMadrid(ms) {
  const p = {};
  PARTES_MADRID.formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
  return { h: p.hour % 24, m: p.minute, s: p.second };
}

/**
 * Segundos de un intervalo que caen en la franja nocturna (22:00–06:00 Madrid).
 *
 * Se avanza borde a borde en vez de minuto a minuto: de cada instante se calcula
 * cuánto falta para el siguiente cambio de franja y se salta ahí. Un tramo de
 * ocho horas son tres o cuatro vueltas, no 28.800.
 */
function segundosNocturnos(ini, fin) {
  let total = 0, t = ini;
  while (t < fin) {
    const { h, m, s } = horaMadrid(t);
    // Horas hasta el siguiente borde de franja (06:00 o 22:00).
    const horasAlBorde = h >= NOC_DESDE ? (24 - h + NOC_HASTA) : h < NOC_HASTA ? (NOC_HASTA - h) : (NOC_DESDE - h);
    const borde = t + (horasAlBorde * 3600 - (m * 60 + s)) * 1000;
    const hasta = Math.min(borde, fin);
    if (h >= NOC_DESDE || h < NOC_HASTA) total += Math.max(0, hasta - t);
    t = hasta;
  }
  return Math.round(total / 1000);
}

/**
 * Horas, nocturnas y utilización de cada persona en el mes de trabajo, por DÍA
 * NATURAL (ver la nota de HORA_CORTE arriba).
 * Devuelve Map(conductor_id → { horasSeg, nocSeg, viajeSeg, esperaSeg, primerDia, porDia }).
 *
 * El plegado de intervalos se hace en JS, como en la bitácora: si alguien tiene
 * dos cuentas de BOLT que se pisan, ese rato cuenta UNA vez. En SQL saldría, pero
 * con window functions que nadie va a poder leer dentro de un año.
 */
async function horasDelMes(desdeIso, hastaIso) {
  const r = await db.consulta(SQL_TROZOS, [desdeIso, hastaIso, String(HORA_CORTE)]);

  // cid → dia → { todo: [], viaje: [], espera: [] }
  const acc = new Map();
  for (const x of r.rows) {
    const cid = Number(x.conductor_id);
    if (!acc.has(cid)) acc.set(cid, new Map());
    const dias = acc.get(cid);
    if (!dias.has(x.dia)) dias.set(x.dia, { todo: [], viaje: [], espera: [] });
    const iv = [new Date(x.d).getTime(), new Date(x.h).getTime()];
    const c = dias.get(x.dia);
    c.todo.push(iv);
    (x.situacion === 'viaje' ? c.viaje : c.espera).push(iv);
  }

  const out = new Map();
  acc.forEach((dias, cid) => {
    let horasSeg = 0, nocSeg = 0, viajeSeg = 0, esperaSeg = 0, primerDia = 0;
    // Los segundos de cada dia sueltos. Hacen falta para las J: una J cubre lo
    // que falte de ESE dia, asi que hay que saber que se rodo en el.
    const porDia = new Map();
    dias.forEach((c, dia) => {
      const efectivo = fundir(c.todo);
      const seg = segundosDe(efectivo);
      if (seg <= 0) return;
      horasSeg += seg;
      nocSeg += efectivo.reduce((a, [i, f]) => a + segundosNocturnos(i, f), 0);
      viajeSeg += segundosDe(fundir(c.viaje));
      esperaSeg += segundosDe(fundir(c.espera));
      const d = Number(dia.slice(8));
      porDia.set(d, seg);
      if (!primerDia || d < primerDia) primerDia = d;
    });
    if (horasSeg > 0) out.set(cid, { horasSeg, nocSeg, viajeSeg, esperaSeg, primerDia, porDia });
  });
  return out;
}

/**
 * Los dias con JUSTIFICANTE del mes, por persona.
 * Devuelve Map(conductor_id -> { aprobados: [dia del mes...], pendientes: n }).
 *
 * SOLO CUENTAN LAS APROBADAS. Una J nace pendiente y el area responsable la
 * aprueba o la rechaza; contar una pendiente seria darla por buena antes del
 * visto bueno, que es justo lo que el circuito de aprobacion vino a evitar. Las
 * pendientes se devuelven CONTADAS, no en la lista, para poder avisar de que
 * hay J en la cola que cambiarian estos numeros.
 *
 * Las rechazadas no salen: ese dia vuelve a ser lo que era, sin justificar.
 *
 * NO se leen las horas de la J. La columna existe, pero en agosto de 2026 no
 * dice nada: 114 de 182 traen un "8" puesto a ojo y 13 traen las horas que esa
 * persona ya habia rodado ese dia. Cuanto vale una J lo decide el servicio.
 */
async function justificantesDelMes(desdeIso, hastaIso) {
  const r = await db.consulta(
    `SELECT conductor_id,
            EXTRACT(DAY FROM dia_operativo)::int AS dia,
            (aprobado_at IS NOT NULL) AS aprobada
       FROM justificante
      WHERE dia_operativo BETWEEN $1::date AND $2::date
        AND anulado_at IS NULL
      ORDER BY conductor_id, dia_operativo`,
    [desdeIso, hastaIso]);

  const out = new Map();
  for (const x of r.rows) {
    const cid = Number(x.conductor_id);
    if (!out.has(cid)) out.set(cid, { aprobados: [], pendientes: 0 });
    if (x.aprobada) out.get(cid).aprobados.push(Number(x.dia));
    else out.get(cid).pendientes++;
  }
  return out;
}

/** Dinero del mes por persona: Map(conductor_id → { neto, propinas, peajes }). */
async function dineroDelMes(desdeIso, hastaIso) {
  const r = await db.consulta(
    `SELECT conductor_id,
            COALESCE(sum(neto),    0)::float8 AS neto,
            COALESCE(sum(propina), 0)::float8 AS propinas,
            COALESCE(sum(peaje),   0)::float8 AS peajes
       FROM v_ordenes_conductor
      WHERE dia BETWEEN $1::date AND $2::date
      GROUP BY conductor_id`,
    [desdeIso, hastaIso]);
  return new Map(r.rows.map(x => [Number(x.conductor_id), {
    neto: Number(x.neto), propinas: Number(x.propinas), peajes: Number(x.peajes),
  }]));
}

/**
 * La ficha laboral: Map(conductor_id → { nombre, nombreBolt, nombreSS, dni,
 * ett, jornada, alta }).
 *
 * TRES NOMBRES, y los tres hacen falta:
 *   nombre      el de la ficha, "NOMBRE APELLIDOS". Es el de la pantalla.
 *   nombreBolt  como figura su cuenta en BOLT. Por ahi lo busca Trafico y por
 *               ahi se cruza con cualquier informe de la plataforma.
 *   nombreSS    como lo tiene RRHH: apellidos primero, coma, nombres. El que
 *               entiende la gestoria. Si no esta escrito se compone de la
 *               ficha, que es de donde salio el dia que se cargo.
 *
 * El periodo que manda es el que estaba VIGENTE el mes de trabajo, no el último:
 * quien se fue en julio y volvió en septiembre con otro contrato tiene que
 * cobrar la nómina de julio con la jornada y el alta de julio. Si no hay ninguno
 * vigente (alguien que trabajó antes de que le abrieran el periodo) se coge el
 * más reciente que empezara antes del fin del mes, y en último término el que
 * haya: la nómina avisa aparte de las fechas raras, pero no deja a nadie fuera
 * por un dato que falta.
 */
async function fichasDelMes(hastaIso) {
  const r = await db.consulta(
    `SELECT c.id,
            btrim(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellidos, '')) AS nombre,
            c.nombre_bolt,
            -- EL NOMBRE DE LA SEGURIDAD SOCIAL: apellidos primero, coma, nombres.
            --
            -- Manda lo que RRHH tenga escrito (nombre_ss), y si no lo tiene se
            -- compone de la ficha. La coma se normaliza a ", " venga como venga:
            -- en la base hay "MIJON RUBIO,PEDRO" pegado y el resto separado, y
            -- una lista que mezcla los dos estilos parece hecha a trozos.
            --
            -- Lo que NO se hace es adivinar donde acaban los apellidos cuando el
            -- nombre viene entero en una sola pieza ("PICO CABEZAS JOSE"): no se
            -- sabe si son dos apellidos y un nombre o uno y dos, y en algun caso
            -- —"RAZVAN OCTAVIAN TIRNOVAN"— el orden es el contrario. Partirlo a
            -- ojo cambiaria el nombre legal de alguien en un papel que va a la
            -- gestoria. Se deja como esta, y nombre_ss_en_forma avisa de ello.
            regexp_replace(
              COALESCE(NULLIF(btrim(c.nombre_ss), ''),
                       NULLIF(btrim(
                         CASE WHEN btrim(COALESCE(c.apellidos, '')) <> ''
                               AND btrim(COALESCE(c.nombre, ''))    <> ''
                              THEN btrim(c.apellidos) || ', ' || btrim(c.nombre)
                              ELSE btrim(COALESCE(c.apellidos, '') || COALESCE(c.nombre, ''))
                         END), '')),
              -- Sin barra invertida a proposito: esto vive dentro de un template
              -- literal de JavaScript, que se come los escapes, y un ',\s*' que
              -- llega a PostgreSQL como ',s*' no reemplaza lo que se cree.
              ', *', ', ') AS nombre_ss,
            c.dni_nie,
            pe.tipo,
            pe.jornada_horas,
            to_char(pe.alta, 'YYYY-MM-DD') AS alta,
            -- La BAJA, con to_char por lo mismo que el alta: leer un DATE de
            -- PostgreSQL con toISOString devuelve el dia anterior en Madrid.
            to_char(pe.baja, 'YYYY-MM-DD') AS baja
       FROM conductor c
       LEFT JOIN LATERAL (
         SELECT p.tipo, p.jornada_horas, p.alta, p.baja
           FROM conductor_periodo_empleo p
          WHERE p.conductor_id = c.id
          ORDER BY (p.alta <= $1::date AND (p.baja IS NULL OR p.baja >= $1::date)) DESC,
                   (p.alta <= $1::date) DESC,
                   p.alta DESC
          LIMIT 1
       ) pe ON TRUE
      WHERE NOT c.es_centinela`,
    [hastaIso]);
  return new Map(r.rows.map(x => [Number(x.id), {
    nombre: x.nombre || '',
    nombreBolt: x.nombre_bolt || '',
    nombreSS: x.nombre_ss || '',
    // Si de verdad quedo en "apellidos, nombres" o salio de una pieza. Se mira
    // el valor YA compuesto y no las columnas de origen: alguien con apellidos
    // en la ficha puede tener ademas un nombre_ss guardado sin coma, y entonces
    // manda el guardado. La marca tiene que decir lo que se ve, no lo que se
    // esperaba.
    nombreSSEnForma: /, /.test(x.nombre_ss || ''),
    dni: x.dni_nie || '',
    ett: x.tipo === 'ett',
    jornada: x.jornada_horas == null ? null : Number(x.jornada_horas),
    alta: x.alta || '',
    baja: x.baja || '',
  }]));
}

/**
 * Quién trabajó ese mes pero NO está en la bitácora, ni con una hora.
 *
 * La bitácora sella las horas el día que la jornada cierra y ya no las recalcula
 * —el pasado no se mueve—, así que a quien se le enlace la cuenta de BOLT más
 * tarde no aparece allí aunque sí trabajara. La nómina no puede permitirse eso
 * (dejaría a alguien sin cobrar 137 horas), por eso calcula ella.
 *
 * Esto NO es la lista de "a quién le bailan las horas entre las dos pantallas":
 * a quien trabaja de noche le bailan siempre, porque las dos miden ventanas
 * distintas a propósito (ver HORA_CORTE). Es la lista de quien la bitácora no
 * tiene en absoluto, que sí es algo que conviene saber; se arregla con
 * `POST /bitacora/api/resellar`.
 */
async function sinSellarEnBitacora(desdeIso, hastaIso, ids) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT c.id,
            btrim(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellidos, '')) AS nombre
       FROM conductor c
      WHERE c.id = ANY($3::bigint[])
        AND NOT EXISTS (
          SELECT 1 FROM bitacora_horas b
           WHERE b.conductor_id = c.id
             -- UN DIA MAS POR DETRAS. La nomina cuenta dias naturales y la
             -- bitacora jornadas 05->05, asi que los dias naturales 1..31 de
             -- agosto caen en las jornadas del 31 de JULIO al 31 de agosto.
             -- Sin ese dia extra, quien solo rodo la madrugada del dia 1 salia
             -- acusado de no estar en la bitacora cuando si esta, un dia antes.
             AND b.dia_operativo BETWEEN ($1::date - 1) AND $2::date)`,
    [desdeIso, hastaIso, ids]);
  return r.rows.map(x => ({ id: Number(x.id), nombre: x.nombre }));
}

// ────────────────────────────────────────────────────────────────────────────
// LO CONGELADO
// ────────────────────────────────────────────────────────────────────────────

const COLS_FILA = ['conductor_id', 'nombre', 'nombre_bolt', 'nombre_ss', 'dni', 'ett', 'jornada',
  'primer_dia', 'alta', 'origen_arranque', 'horas', 'horas_espera_quitadas', 'horas_justificadas',
  'horas_no_justificadas', 'dias_justificados', 'horas_objetivo', 'delta_horas', 'util_pct', 'propinas', 'peajes',
  'nocturnas', 'nocturnas_horas', 'mbo_fas', 'mbo_hs_ext', 'compensacion', 'dias_extra', 'total'];

// Los valores de una fila, EN EL ORDEN DE COLS_FILA. Van pegados a la lista a
// proposito: si se anade una columna arriba y no aqui, el INSERT falla en voz
// alta en vez de guardar los numeros corridos una posicion.
const valoresDeFila = f => [
  f.conductorId || null, f.nombre, f.nombreBolt || null, f.nombreSS || null, f.dni || null,
  !!f.ett, f.jornada || null, f.primerDia || null, f.alta || null, f.origenArranque,
  f.horas, f.horasEsperaQuitadas, f.horasJustificadas, f.horasNoJustificadas, f.diasJustificados,
  f.horasObjetivo, f.deltaHoras, f.utilPct, f.propinas, f.peajes,
  f.nocturnas, f.nocturnasHoras, f.mboFAS, f.mboHsExt, f.compensacion, f.diasExtra, f.total,
];

/** Congela una nómina. Reescribe la del mes si ya hubiera una. */
async function congelar(r, usuarioId) {
  return db.transaccion(async cli => {
    await cli.query('DELETE FROM nomina_mes WHERE mes = $1 AND ano = $2', [r.mes, r.ano]);
    const cab = await cli.query(
      `INSERT INTO nomina_mes (mes, ano, mes_datos, ano_datos, dias_del_mes, config, totales, avisos, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, congelada_at`,
      [r.mes, r.ano, r.mesDatos, r.anoDatos, r.diasDelMes,
        JSON.stringify(r.config), JSON.stringify(r.totales), JSON.stringify(r.avisos || {}), usuarioId || null]);
    const id = cab.rows[0].id;

    // En bloques: una plantilla de 250 personas por 21 columnas son 5.250
    // parámetros y PostgreSQL admite 65.535, pero el día que sean 3.000 personas
    // el INSERT de una sola vez reventaría sin avisar.
    const TAM = 200;
    const N = COLS_FILA.length + 1;          // las columnas + el nomina_id
    for (let i = 0; i < r.filas.length; i += TAM) {
      const trozo = r.filas.slice(i, i + TAM);
      const valores = [];
      const marcas = trozo.map((f, k) => {
        valores.push(id, ...valoresDeFila(f));
        const base = k * N;
        return '(' + Array.from({ length: N }, (_, j) => '$' + (base + j + 1)).join(',') + ')';
      }).join(',');
      await cli.query(
        `INSERT INTO nomina_fila (nomina_id, ${COLS_FILA.join(', ')}) VALUES ${marcas}`, valores);
    }
    return { id, congeladaAt: cab.rows[0].congelada_at, conductores: r.filas.length, total: r.totales.total };
  });
}

/** La nómina congelada de un mes, o null. */
async function leerCongelada(mes, ano) {
  const c = await db.consulta(
    `SELECT n.id, n.mes, n.ano, n.mes_datos, n.ano_datos, n.dias_del_mes, n.config, n.totales, n.avisos,
            n.congelada_at, (SELECT u.nombre FROM usuario u WHERE u.id = n.usuario_id) AS quien
       FROM nomina_mes n WHERE n.mes = $1 AND n.ano = $2`, [mes, ano]);
  if (!c.rowCount) return null;
  const n = c.rows[0];
  const f = await db.consulta(
    `SELECT ${COLS_FILA.join(', ')} FROM nomina_fila WHERE nomina_id = $1 ORDER BY total DESC`, [n.id]);
  return {
    mes: n.mes, ano: n.ano, mesDatos: n.mes_datos, anoDatos: n.ano_datos,
    diasDelMes: n.dias_del_mes, config: n.config, totales: n.totales, avisos: n.avisos || {},
    congelada: true, congeladaAt: n.congelada_at, congeladaPor: n.quien || '',
    filas: f.rows.map(x => ({
      conductorId: x.conductor_id == null ? null : Number(x.conductor_id),
      nombre: x.nombre, nombreBolt: x.nombre_bolt || '', nombreSS: x.nombre_ss || '',
      dni: x.dni || '', ett: x.ett,
      jornada: x.jornada == null ? null : Number(x.jornada),
      primerDia: x.primer_dia == null ? null : Number(x.primer_dia),
      alta: x.alta || '', origenArranque: x.origen_arranque,
      horas: Number(x.horas),
      horasEsperaQuitadas: Number(x.horas_espera_quitadas),
      horasJustificadas: Number(x.horas_justificadas),
      horasNoJustificadas: Number(x.horas_no_justificadas),
      diasJustificados: Number(x.dias_justificados),
      horasObjetivo: Number(x.horas_objetivo), deltaHoras: Number(x.delta_horas),
      utilPct: x.util_pct == null ? null : Number(x.util_pct),
      propinas: Number(x.propinas), peajes: Number(x.peajes), nocturnas: Number(x.nocturnas),
      nocturnasHoras: Number(x.nocturnas_horas),
      mboFAS: Number(x.mbo_fas), mboHsExt: Number(x.mbo_hs_ext), compensacion: Number(x.compensacion),
      diasExtra: Number(x.dias_extra), total: Number(x.total),
    })),
  };
}

/** Qué meses hay congelados, el más reciente primero. Para el selector. */
async function mesesCongelados() {
  const r = await db.consulta(
    `SELECT n.mes, n.ano, n.congelada_at, count(f.*)::int AS conductores,
            (n.totales->>'total')::float8 AS total
       FROM nomina_mes n LEFT JOIN nomina_fila f ON f.nomina_id = n.id
      GROUP BY n.id ORDER BY n.ano DESC, n.mes DESC`);
  return r.rows.map(x => ({
    mes: x.mes, ano: x.ano, congeladaAt: x.congelada_at,
    conductores: x.conductores, total: Number(x.total) || 0,
  }));
}

/** Descongela un mes (borra la nómina congelada). Solo el desarrollador. */
async function descongelar(mes, ano) {
  const r = await db.consulta('DELETE FROM nomina_mes WHERE mes = $1 AND ano = $2', [mes, ano]);
  return r.rowCount > 0;
}

/**
 * La persona y su periodo de empleo, para el finiquito. Se coge el ÚLTIMO
 * periodo: alguien puede haber entrado, salido y vuelto, y lo que se liquida es
 * la salida de ahora.
 */
async function personaConBaja(conductorId) {
  const r = await db.consulta(
    `SELECT c.id, c.dni_nie AS dni,
            COALESCE(NULLIF(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')), ''),
                     '#' || c.id::text) AS nombre,
            c.nombre_bolt, c.nombre_ss,
            p.alta::text AS alta, p.baja::text AS baja, p.motivo_baja,
            p.jornada_horas
       FROM conductor c
       LEFT JOIN LATERAL (
         SELECT alta, baja, motivo_baja, jornada_horas
           FROM conductor_periodo_empleo
          WHERE conductor_id = c.id
          ORDER BY alta DESC LIMIT 1) p ON TRUE
      WHERE c.id = $1`, [Number(conductorId)]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: x.id, nombre: x.nombre, nombreBolt: x.nombre_bolt || '', nombreSS: x.nombre_ss || '',
    dni: x.dni || '', alta: x.alta || '', baja: x.baja || '',
    motivoBaja: x.motivo_baja || '', jornada: x.jornada_horas || null,
  };
}

module.exports = {
  personaConBaja,
  leerConfig, guardarConfig,
  horasDelMes, dineroDelMes, fichasDelMes, justificantesDelMes, sinSellarEnBitacora,
  congelar, leerCongelada, mesesCongelados, descongelar,
  // Expuestos para poder probarlos sin base de datos.
  _fundir: fundir, _segundosNocturnos: segundosNocturnos,
};
