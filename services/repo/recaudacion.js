// ============================================================
// RECAUDACIÓN — el efectivo que cobran en la calle y hay que ingresar
// ============================================================
// Dos columnas y una resta:
//
//   DEUDA     lo que BOLT dice que cobró en efectivo en la quincena (el cierre)
//   RECAUDADO lo que ha entregado: presencial + descontado de nómina, menos lo
//             que se le haya devuelto
//   PENDIENTE deuda − recaudado
//
// El pendiente que importa es el ACUMULADO, no el de una quincena suelta: quien
// debe 300 € de julio y entrega 300 € en agosto está a cero, aunque la quincena
// de agosto salga con "recaudado" y sin deuda. Por eso cada cifra se da en las
// dos alturas —la quincena que se mira y el arrastre— y nunca se mezclan.
//
// LA DEUDA LA CALCULA BOLT, no se teclea. Cada pedido trae `payment_method` y su
// precio desglosado, así que el efectivo de una quincena es:
//
//     Σ (ride_price − cash_discount + booking_fee)  de los pedidos 'cash' 'finished'
//
// Comprobado contra el Excel que llevaban a mano en la quincena 1–15 de agosto:
// los 8 conductores mirados, al céntimo. Aun así la cifra se CONGELA en
// `recaudacion_cierre` cuando se calcula: se está cobrando dinero contra ella y
// no puede moverse sola porque BOLT corrija un viaje tres semanas después. Se
// recalcula cuando alguien lo pide, y se ve que cambió.

const db = require('../db');

// Los billetes y monedas del recibo, de mayor a menor. En CÉNTIMOS: con euros
// en coma flotante, 0.1 + 0.2 no da 0.3 y el recibo no cuadraría con su total.
const DENOMINACIONES = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const ETIQUETA_DEN = c => (c >= 100 ? String(c / 100) : '0,' + String(c).padStart(2, '0'));

// Cada movimiento tiene DOS efectos que NO van juntos, y confundirlos es lo
// que descuadra una caja:
//
//   caja   ¿entra o sale dinero físico del cajón?
//   deuda  ¿el conductor debe menos después de esto?
//
// Un descuento de nómina baja la deuda y no mete un billete en la caja. Una
// salida al banco vacía la caja y no cambia lo que nadie debe.
const TIPOS = [
  { codigo: 'presencial',        etiqueta: 'En mano',               caja: +1, deuda: +1, conductor: true },
  { codigo: 'nomina',            etiqueta: 'Descontado de nómina',  caja:  0, deuda: +1, conductor: true },
  { codigo: 'entrega',           etiqueta: 'Devuelto al conductor', caja: -1, deuda: -1, conductor: true },
  { codigo: 'salida_banco',      etiqueta: 'Banco',                 caja: -1, deuda:  0, conductor: false },
  { codigo: 'salida_gastos',     etiqueta: 'Gastos empresa',        caja: -1, deuda:  0, conductor: false },
  { codigo: 'salida_caja_chica', etiqueta: 'Caja chica',            caja: -1, deuda:  0, conductor: false },
  { codigo: 'salida_nomina',     etiqueta: 'Nómina',                caja: -1, deuda:  0, conductor: false },
  // El traspaso del Excel que llevaban a mano: todo lo que salió de la caja
  // ANTES de que existiera este módulo, sin desglosar porque no lo está en
  // ninguna parte. `interno` lo deja fuera del desplegable: es de un solo uso.
  { codigo: 'salida_apertura',   etiqueta: 'Traspaso de apertura',  caja: -1, deuda:  0, conductor: false, interno: true },
];
const TIPO = c => TIPOS.find(x => x.codigo === c) || null;
const ES_SALIDA = c => /^salida_/.test(String(c || ''));
// Las cuatro bocas por las que sale el dinero de la caja, para el desplegable.
// El traspaso de apertura no está: no se elige, se hizo una vez.
const SALIDAS = TIPOS.filter(t => !t.conductor && !t.interno);
// Todas las salidas, incluida la de apertura, para leer y sumar.
const TODAS_SALIDAS = TIPOS.filter(t => !t.conductor);

// ── LA QUINCENA ────────────────────────────────────────────────────────────
// (año, mes, 1|2). La 1 es del 1 al 15; la 2 del 16 al último del mes, sea 28,
// 30 o 31. Se calcula siempre y no se guarda: dos filas con el corte escrito
// acabarían discrepando el día que alguien lo teclee mal.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ultimoDia = (anio, mes) => new Date(anio, mes, 0).getDate();

function quincenaDe(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(String(fecha).slice(0, 10) + 'T12:00:00');
  return { anio: d.getFullYear(), mes: d.getMonth() + 1, quincena: d.getDate() <= 15 ? 1 : 2 };
}

/** El rango de días de una quincena, en ISO. */
function rangoQuincena({ anio, mes, quincena }) {
  const dd = n => String(n).padStart(2, '0');
  return quincena === 1
    ? { desde: `${anio}-${dd(mes)}-01`, hasta: `${anio}-${dd(mes)}-15` }
    : { desde: `${anio}-${dd(mes)}-16`, hasta: `${anio}-${dd(mes)}-${dd(ultimoDia(anio, mes))}` };
}

const etiquetaQuincena = q => `${q.quincena === 1 ? '1–15' : '16–' + ultimoDia(q.anio, q.mes)} ${MESES[q.mes - 1]} ${q.anio}`;
const cortaQuincena = q => `Q${q.quincena} ${MESES[q.mes - 1]} ${String(q.anio).slice(2)}`;

/** La quincena de hoy, y moverse por ellas sin pelearse con los meses. */
const quincenaHoy = () => quincenaDe(new Date());
function mueveQuincena(q, pasos) {
  let n = (q.anio * 12 + (q.mes - 1)) * 2 + (q.quincena - 1) + pasos;
  const quincena = (n % 2) + 1;
  n = Math.floor(n / 2);
  return { anio: Math.floor(n / 12), mes: (n % 12) + 1, quincena };
}

/** Normaliza lo que llega por la URL; si no vale, la quincena de hoy. */
function quincenaValida(x) {
  const anio = Number((x || {}).anio), mes = Number((x || {}).mes), quincena = Number((x || {}).quincena);
  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return quincenaHoy();
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return quincenaHoy();
  if (quincena !== 1 && quincena !== 2) return quincenaHoy();
  return { anio, mes, quincena };
}

// ── EL RECIBO ──────────────────────────────────────────────────────────────
/**
 * Cuenta el desglose de billetes y monedas y devuelve el total EN CÉNTIMOS.
 * Devuelve también el desglose limpio (solo lo que tiene cantidad), que es lo
 * que se guarda: un recibo con quince ceros no dice nada que no diga el total.
 */
function cuentaDesglose(desglose) {
  const limpio = {};
  let centimos = 0;
  for (const c of DENOMINACIONES) {
    const n = Number((desglose || {})[String(c)] || (desglose || {})[ETIQUETA_DEN(c)] || 0);
    if (!Number.isInteger(n) || n < 0) throw new Error(`La cantidad de ${ETIQUETA_DEN(c)} € tiene que ser un número entero de billetes o monedas`);
    if (n > 100000) throw new Error(`¿${n} unidades de ${ETIQUETA_DEN(c)} €? Revisa el recuento`);
    if (n > 0) { limpio[String(c)] = n; centimos += c * n; }
  }
  return { centimos, desglose: Object.keys(limpio).length ? limpio : null };
}

/** Euros (texto del formulario o número) a céntimos, sin sustos de coma flotante. */
function aCentimos(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('El importe tiene que ser un número de euros, con dos decimales como mucho');
  return Math.round(Number(s) * 100);
}

// ── LECTURA ────────────────────────────────────────────────────────────────
/**
 * El cuadro de una quincena: cada conductor con su deuda, lo entregado y lo
 * que le queda, más el ARRASTRE de todo lo anterior.
 *
 * Sale un conductor si tiene deuda en la quincena, movimiento en ella, o
 * arrastre distinto de cero: los que no deben nada ni han traído nada no
 * ensucian la lista.
 */
async function cuadro(q) {
  const { desde, hasta } = rangoQuincena(q);
  // Las dos consultas son la misma cuenta sobre dos formas de identificar a
  // alguien: por ficha (conductor_id) o por cuenta de BOLT (bolt_uuid), para
  // quien cobró en efectivo y nunca tuvo ficha. `quien` es la clave común.
  const cuentas = clave => `
     WITH cierre AS (
       SELECT ${clave} AS quien, importe + ajuste AS importe, ajuste, ajuste_motivo
         FROM recaudacion_cierre
        WHERE anio = $1 AND mes = $2 AND quincena = $3 AND ${clave} IS NOT NULL),
     cierre_prev AS (
       SELECT ${clave} AS quien, sum(importe + ajuste) AS importe FROM recaudacion_cierre
        WHERE (anio, mes, quincena) < ($1, $2, $3) AND ${clave} IS NOT NULL GROUP BY 1),
     mov AS (
       SELECT ${clave} AS quien,
              sum(importe) FILTER (WHERE tipo = 'presencial') AS presencial,
              sum(importe) FILTER (WHERE tipo = 'nomina')     AS nomina,
              sum(importe) FILTER (WHERE tipo = 'entrega')    AS entrega
         FROM recaudacion_movimiento
        WHERE anulado_at IS NULL AND ${clave} IS NOT NULL
          AND fecha BETWEEN $4::date AND $5::date
        GROUP BY 1),
     mov_prev AS (
       SELECT ${clave} AS quien,
              sum(CASE WHEN tipo = 'entrega' THEN -importe ELSE importe END) AS neto
         FROM recaudacion_movimiento
        WHERE anulado_at IS NULL AND ${clave} IS NOT NULL AND fecha < $4::date
        GROUP BY 1)`;

  const [r, rb] = await Promise.all([
    db.consulta(`${cuentas('conductor_id')}
     SELECT c.id::text AS quien, NULL::text AS bolt_uuid,
            trim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS conductor,
            c.empleo_vigente,
            COALESCE(ci.importe, 0)   AS deuda,
            COALESCE(ci.ajuste, 0)    AS ajuste,
            ci.ajuste_motivo,
            COALESCE(m.presencial, 0) AS presencial,
            COALESCE(m.nomina, 0)     AS nomina,
            COALESCE(m.entrega, 0)    AS entrega,
            COALESCE(cp.importe, 0) - COALESCE(mp.neto, 0) AS arrastre
       FROM conductor c
       LEFT JOIN cierre      ci ON ci.quien = c.id
       LEFT JOIN cierre_prev cp ON cp.quien = c.id
       LEFT JOIN mov         m  ON m.quien  = c.id
       LEFT JOIN mov_prev    mp ON mp.quien = c.id
      WHERE NOT c.es_centinela
        AND (ci.importe IS NOT NULL OR m.quien IS NOT NULL
             OR COALESCE(cp.importe, 0) - COALESCE(mp.neto, 0) <> 0)`,
      [q.anio, q.mes, q.quincena, desde, hasta]),

    // Los que no tienen ficha. El nombre sale del padrón de BOLT.
    db.consulta(`${cuentas('bolt_uuid')},
     gente AS (
       SELECT quien FROM cierre UNION
       SELECT quien FROM cierre_prev UNION
       SELECT quien FROM mov UNION
       SELECT quien FROM mov_prev)
     SELECT g.quien, g.quien AS bolt_uuid,
            COALESCE(e.externo_nombre, 'Cuenta de BOLT ' || left(g.quien, 8)) AS conductor,
            NULL::boolean AS empleo_vigente,
            COALESCE(ci.importe, 0)   AS deuda,
            COALESCE(ci.ajuste, 0)    AS ajuste,
            ci.ajuste_motivo,
            COALESCE(m.presencial, 0) AS presencial,
            COALESCE(m.nomina, 0)     AS nomina,
            COALESCE(m.entrega, 0)    AS entrega,
            COALESCE(cp.importe, 0) - COALESCE(mp.neto, 0) AS arrastre
       FROM gente g
       LEFT JOIN conductor_externo e ON e.sistema = 'bolt' AND e.externo_id = g.quien
       LEFT JOIN cierre      ci ON ci.quien = g.quien
       LEFT JOIN cierre_prev cp ON cp.quien = g.quien
       LEFT JOIN mov         m  ON m.quien  = g.quien
       LEFT JOIN mov_prev    mp ON mp.quien = g.quien`,
      [q.anio, q.mes, q.quincena, desde, hasta]),
  ]);
  r.rows = r.rows.concat(rb.rows).sort((a, b) => a.conductor.localeCompare(b.conductor));

  const filas = r.rows.map(x => {
    const deuda = Number(x.deuda), presencial = Number(x.presencial);
    const nomina = Number(x.nomina), entrega = Number(x.entrega);
    const recaudado = presencial + nomina - entrega;
    const arrastre = Number(x.arrastre);
    return {
      // `conductorId` sigue siendo la clave con la que trabaja la pantalla; en
      // los de BOLT es su uuid, y `sinFicha` es lo que la pinta en rojo.
      conductorId: String(x.quien), conductor: x.conductor,
      sinFicha: !!x.bolt_uuid,
      enPlantilla: !!x.empleo_vigente,
      deuda, presencial, nomina, entrega, recaudado,
      // El arrastre va aparte para poder explicarlo en pantalla: la deuda ya
      // lo lleva sumado.
      ajuste: Number(x.ajuste) || 0,
      ajusteMotivo: x.ajuste_motivo || '',
      // Lo de la quincena y lo que se arrastra de antes, por separado.
      pendienteQuincena: +(deuda - recaudado).toFixed(2),
      arrastre: +arrastre.toFixed(2),
      pendiente: +(arrastre + deuda - recaudado).toFixed(2),
    };
  });

  const suma = campo => +filas.reduce((a, f) => a + f[campo], 0).toFixed(2);
  return {
    quincena: { ...q, etiqueta: etiquetaQuincena(q), corta: cortaQuincena(q), ...rangoQuincena(q) },
    filas,
    total: {
      gente: filas.length,
      deuda: suma('deuda'), presencial: suma('presencial'), nomina: suma('nomina'),
      entrega: suma('entrega'), recaudado: suma('recaudado'),
      pendiente: suma('pendiente'),
      // A cuántos les falta algo: es el número por el que preguntan.
      conDeuda: filas.filter(f => f.pendiente > 0.005).length,
    },
  };
}

/**
 * EL CUADRE DE CAJA, de todo lo habido hasta hoy. Son las dos cifras que se
 * miran al abrir:
 *
 *   EFECTIVO ACTUAL     lo que tiene que haber físicamente en el cajón:
 *                       lo cobrado en mano, menos lo devuelto, menos lo que
 *                       salió al banco, a gastos, a caja chica o a nóminas.
 *   PENDIENTE DE COBRO  lo que los conductores deben en total: toda la deuda
 *                       de BOLT menos todo lo recaudado, por la vía que sea.
 *
 * Van juntas y no se suman: una es dinero que está, la otra dinero que falta.
 */
async function cuadre() {
  const r = await db.consulta(
    `SELECT
       (SELECT COALESCE(sum(importe + ajuste), 0) FROM recaudacion_cierre) AS deuda,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'presencial'), 0)        AS presencial,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'nomina'), 0)            AS nomina,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'entrega'), 0)           AS entrega,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'salida_banco'), 0)      AS banco,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'salida_gastos'), 0)     AS gastos,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'salida_caja_chica'), 0) AS caja_chica,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'salida_nomina'), 0)     AS nominas_pagadas,
       COALESCE(sum(importe) FILTER (WHERE tipo = 'salida_apertura'), 0)   AS apertura,
       -- Lo que deben los que no tienen ficha, aparte: es la cifra que hay que
       -- mirar aunque no se le pueda reclamar a una nómina.
       (SELECT COALESCE(sum(importe + ajuste), 0) FROM recaudacion_cierre WHERE bolt_uuid IS NOT NULL) AS deuda_sin_ficha
     FROM recaudacion_movimiento WHERE anulado_at IS NULL`);
  const x = r.rows[0];
  const n = k => Number(x[k]) || 0;
  const salidas = n('banco') + n('gastos') + n('caja_chica') + n('nominas_pagadas') + n('apertura');
  const dosDec = v => +v.toFixed(2);
  return {
    // Lo que debe haber en el cajón ahora mismo.
    efectivo: dosDec(n('presencial') - n('entrega') - salidas),
    // Lo que queda por cobrarle a la gente.
    pendiente: dosDec(n('deuda') - (n('presencial') + n('nomina') - n('entrega'))),
    deuda: dosDec(n('deuda')),
    entradas: dosDec(n('presencial')),
    nomina: dosDec(n('nomina')),
    devuelto: dosDec(n('entrega')),
    salidas: dosDec(salidas),
    deudaSinFicha: dosDec(n('deuda_sin_ficha')),
    porSalida: {
      salida_banco: dosDec(n('banco')), salida_gastos: dosDec(n('gastos')),
      salida_caja_chica: dosDec(n('caja_chica')), salida_nomina: dosDec(n('nominas_pagadas')),
      salida_apertura: dosDec(n('apertura')),
    },
  };
}

/** Las salidas de caja de una quincena, para verlas donde se hicieron. */
async function salidasDe(q) {
  const { desde, hasta } = rangoQuincena(q);
  const r = await db.consulta(
    `SELECT m.id, m.fecha, m.tipo, m.importe, m.observacion, m.anulado_at, m.anulado_motivo,
            u.nombre AS quien, a.nombre AS anulo
       FROM recaudacion_movimiento m
       LEFT JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN usuario a ON a.id = m.anulado_por
      WHERE m.conductor_id IS NULL AND m.fecha BETWEEN $1::date AND $2::date
      ORDER BY m.fecha DESC, m.id DESC`, [desde, hasta]);
  return r.rows.map(m => ({
    id: String(m.id), fecha: diaIso(m.fecha), tipo: m.tipo, importe: Number(m.importe),
    observacion: m.observacion || '', quien: m.quien || '¿?',
    anulado: !!m.anulado_at, anuladoMotivo: m.anulado_motivo || '', anuladoPor: m.anulo || '',
  }));
}

/**
 * La ficha de un conductor: su histórico entero, quincena a quincena, con los
 * movimientos de cada una. Es lo que se mira antes de cobrarle.
 */
async function ficha(conductorId) {
  // La clave puede ser un id de la plantilla o el uuid de una cuenta de BOLT
  // sin ficha. Un uuid trae guiones, así que distinguirlos es mirar si es un
  // número.
  const esUuid = !/^\d+$/.test(String(conductorId || '').trim());
  const id = esUuid ? String(conductorId).trim() : Number(conductorId);
  if (!esUuid && (!Number.isInteger(id) || id <= 0)) throw new Error('Falta el conductor');
  const col = esUuid ? 'bolt_uuid' : 'conductor_id';

  const [c, cierres, movs] = await Promise.all([
    esUuid
      ? db.consulta(
        `SELECT externo_id AS id, externo_nombre AS conductor, NULL::boolean AS empleo_vigente,
                NULL::text AS telefono
           FROM conductor_externo WHERE sistema = 'bolt' AND externo_id = $1`, [id])
      : db.consulta(
        `SELECT id, trim(nombre || ' ' || COALESCE(apellidos, '')) AS conductor, empleo_vigente,
                (SELECT e164 FROM conductor_telefono t WHERE t.conductor_id = c.id
                  AND t.vigente_hasta IS NULL
                  ORDER BY principal DESC NULLS LAST, id LIMIT 1) AS telefono
           FROM conductor c WHERE id = $1`, [id]),
    db.consulta(
      `SELECT anio, mes, quincena, importe, ajuste, ajuste_motivo, origen
         FROM recaudacion_cierre
        WHERE ${col} = $1 ORDER BY anio, mes, quincena`, [id]),
    db.consulta(
      `SELECT m.id, m.fecha, m.tipo, m.importe, m.desglose, m.observacion, m.creado_at,
              m.anulado_at, m.anulado_motivo,
              u.nombre AS quien, a.nombre AS anulo
         FROM recaudacion_movimiento m
         LEFT JOIN usuario u ON u.id = m.usuario_id
         LEFT JOIN usuario a ON a.id = m.anulado_por
        WHERE m.${col} = $1 ORDER BY m.fecha DESC, m.id DESC`, [id]),
  ]);
  if (!c.rows[0]) throw new Error('Ese conductor no existe');

  const movimientos = movs.rows.map(m => ({
    id: String(m.id), fecha: String(m.fecha).slice(0, 10) === 'Invalid' ? null : diaIso(m.fecha),
    tipo: m.tipo, importe: Number(m.importe), desglose: m.desglose || null,
    observacion: m.observacion || '', quien: m.quien || '¿?',
    creadoAt: m.creado_at,
    anulado: !!m.anulado_at, anuladoMotivo: m.anulado_motivo || '', anuladoPor: m.anulo || '',
  }));

  // Todas las quincenas que tienen algo, de la más nueva a la más vieja, con su
  // deuda y sus movimientos dentro.
  const clave = q => `${q.anio}-${q.mes}-${q.quincena}`;
  const mapa = new Map();
  const meter = q => {
    const k = clave(q);
    if (!mapa.has(k)) mapa.set(k, { ...q, etiqueta: etiquetaQuincena(q), corta: cortaQuincena(q),
      deuda: 0, bolt: 0, ajuste: 0, ajusteMotivo: '', movimientos: [] });
    return mapa.get(k);
  };
  cierres.rows.forEach(x => {
    const q = { anio: x.anio, mes: x.mes, quincena: x.quincena };
    const f = meter(q);
    f.deuda = Number(x.importe) + (Number(x.ajuste) || 0);
    f.bolt = Number(x.importe);
    f.ajuste = Number(x.ajuste) || 0;
    f.ajusteMotivo = x.ajuste_motivo || '';
  });
  movimientos.forEach(m => { if (m.fecha) meter(quincenaDe(m.fecha)).movimientos.push(m); });

  const lista = [...mapa.values()].sort((a, b) =>
    (b.anio - a.anio) || (b.mes - a.mes) || (b.quincena - a.quincena));

  // El saldo se acumula de lo VIEJO a lo nuevo, así que se recorre al revés y
  // luego se le da la vuelta: cada quincena enseña el saldo con el que se cierra.
  let acumulado = 0;
  [...lista].reverse().forEach(q => {
    const vivos = q.movimientos.filter(m => !m.anulado);
    q.presencial = +vivos.filter(m => m.tipo === 'presencial').reduce((a, m) => a + m.importe, 0).toFixed(2);
    q.nomina = +vivos.filter(m => m.tipo === 'nomina').reduce((a, m) => a + m.importe, 0).toFixed(2);
    q.entrega = +vivos.filter(m => m.tipo === 'entrega').reduce((a, m) => a + m.importe, 0).toFixed(2);
    q.recaudado = +(q.presencial + q.nomina - q.entrega).toFixed(2);
    acumulado = +(acumulado + q.deuda - q.recaudado).toFixed(2);
    q.saldo = acumulado;
  });

  return {
    conductor: { id: String(c.rows[0].id), nombre: c.rows[0].conductor,
      telefono: c.rows[0].telefono || '', enPlantilla: !!c.rows[0].empleo_vigente,
      sinFicha: esUuid },
    quincenas: lista,
    total: {
      deuda: +lista.reduce((a, q) => a + q.deuda, 0).toFixed(2),
      recaudado: +lista.reduce((a, q) => a + q.recaudado, 0).toFixed(2),
      pendiente: acumulado,
    },
  };
}

/** Las fechas de PostgreSQL a "AAAA-MM-DD" por sus componentes locales. */
function diaIso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const dd = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
}

/** Los conductores a los que se les puede cobrar, para el desplegable. */
async function candidatos() {
  const r = await db.consulta(
    `SELECT c.id, trim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS conductor, c.empleo_vigente
       FROM conductor c WHERE NOT c.es_centinela
        AND (c.empleo_vigente OR EXISTS (SELECT 1 FROM recaudacion_cierre r WHERE r.conductor_id = c.id)
             OR EXISTS (SELECT 1 FROM recaudacion_movimiento m WHERE m.conductor_id = c.id))
      ORDER BY 2`);
  return r.rows.map(x => ({ id: String(x.id), nombre: x.conductor, enPlantilla: !!x.empleo_vigente }));
}

// ── ESCRITURA ──────────────────────────────────────────────────────────────
/**
 * Apunta una entrega de dinero. `desglose` solo en lo presencial, y su recuento
 * tiene que CUADRAR con el importe: un recibo cuyo total no sale de sus billetes
 * es un recibo que alguien tendrá que explicar.
 */
async function anotar({ conductorId, fecha, tipo, importe, desglose, observacion, usuarioId } = {}) {
  const def = TIPO(tipo);
  if (!def) throw new Error('Ese tipo de movimiento no existe');

  // Lo de un conductor lleva conductor; una salida de caja, no.
  let id = null;
  if (def.conductor) {
    id = Number(conductorId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');
  }
  const obs = (observacion || '').trim();
  if (!def.conductor && !obs) {
    throw new Error('Di a qué va ese dinero: una salida de caja sin explicación no vale.');
  }
  const dia = diaIso(fecha) || diaIso(new Date());
  if (dia > diaIso(new Date())) throw new Error('No se puede apuntar dinero con fecha futura');

  let centimos, limpio = null;
  if (tipo === 'presencial') {
    const cuenta = cuentaDesglose(desglose);
    limpio = cuenta.desglose;
    // Si vino el desglose, MANDA él: es lo que se contó encima de la mesa.
    // Si no vino (un ingreso viejo que se apunta sin recibo), vale el importe.
    centimos = cuenta.centimos > 0 ? cuenta.centimos : aCentimos(importe);
    if (cuenta.centimos > 0 && importe != null && String(importe).trim() !== '' &&
        aCentimos(importe) !== cuenta.centimos) {
      throw new Error(`El recuento suma ${(cuenta.centimos / 100).toFixed(2)} € y el importe dice ` +
        `${(aCentimos(importe) / 100).toFixed(2)} €. Cuadra los billetes antes de guardar.`);
    }
  } else {
    centimos = aCentimos(importe);
  }
  if (centimos <= 0) throw new Error('El importe tiene que ser mayor que cero');

  const r = await db.consulta(
    `INSERT INTO recaudacion_movimiento (conductor_id, fecha, tipo, importe, desglose, observacion, usuario_id)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7) RETURNING id`,
    [id, dia, tipo, (centimos / 100).toFixed(2), limpio ? JSON.stringify(limpio) : null,
      obs.slice(0, 255) || null, usuarioId || null]);
  return { id: String(r.rows[0].id), importe: +(centimos / 100).toFixed(2), fecha: dia, tipo };
}

/** Anula un movimiento. No se borra: el dinero deja rastro o no vale de nada. */
async function anular(movimientoId, { usuarioId, motivo } = {}) {
  const m = (motivo || '').trim();
  if (!m) throw new Error('Hace falta decir por qué se anula: es dinero.');
  const r = await db.consulta(
    `UPDATE recaudacion_movimiento
        SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`,
    [Number(movimientoId), usuarioId || null, m.slice(0, 255)]);
  if (!r.rows[0]) throw new Error('Ese movimiento no existe o ya estaba anulado');
  return { anulado: String(r.rows[0].id) };
}

/**
 * Pone (o corrige) la deuda de una quincena. Se PISA la cifra anterior en vez
 * de sumarla: el cierre de BOLT se vuelve a cargar a menudo y sumar dos cargas
 * duplicaría la deuda de todo el mundo en silencio.
 */
async function guardarCierre({ conductorId, anio, mes, quincena, importe, origen, usuarioId } = {}) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');
  const q = quincenaValida({ anio, mes, quincena });
  if (q.anio !== Number(anio) || q.mes !== Number(mes) || q.quincena !== Number(quincena)) {
    throw new Error('Esa quincena no es válida');
  }
  const centimos = aCentimos(importe);
  const r = await db.consulta(
    `INSERT INTO recaudacion_cierre (conductor_id, anio, mes, quincena, importe, origen, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conductor_id, anio, mes, quincena) DO UPDATE
        SET importe = EXCLUDED.importe, origen = EXCLUDED.origen,
            usuario_id = EXCLUDED.usuario_id, actualizado_at = now()
     RETURNING id, importe`,
    [id, q.anio, q.mes, q.quincena, (centimos / 100).toFixed(2),
      origen === 'importado' ? 'importado' : 'manual', usuarioId || null]);
  return { id: String(r.rows[0].id), importe: Number(r.rows[0].importe) };
}

/**
 * EL EFECTIVO DE UNA QUINCENA SEGÚN BOLT, sin tocar nada: cuánto dinero en mano
 * cobró cada conductor. Es lo que se propone congelar como deuda.
 *
 * Va por `creado_ts` como la ingesta, y en hora de Madrid: una carrera de las
 * 00:30 del día 16 es de la segunda quincena, no de la primera.
 */
async function efectivoBolt(q) {
  const { desde, hasta } = rangoQuincena(q);
  // Se agrupa por CUENTA de BOLT y no por conductor: hay cuentas que rodaron y
  // cobraron en efectivo sin estar enlazadas con nadie de la plantilla, y esas
  // eran justo las que se perdían en silencio. Cada una trae su conductor si lo
  // tiene, y si no, su nombre de BOLT.
  const r = await db.consulta(
    `SELECT o.driver_uuid::text AS uuid, e.conductor_id, e.externo_nombre,
            count(*)::int AS viajes,
            sum(COALESCE(o.precio, 0) - COALESCE(o.dto_efectivo, 0)
                + COALESCE(o.tarifa_reserva, 0))::numeric(12,2) AS efectivo
       FROM bolt_order o
       LEFT JOIN conductor_externo e ON e.sistema = 'bolt' AND e.externo_id = o.driver_uuid::text
      WHERE o.metodo_pago = 'cash'
        AND o.estado = 'finished'
        AND (o.creado_ts AT TIME ZONE 'Europe/Madrid')::date BETWEEN $1::date AND $2::date
      GROUP BY 1, 2, 3
      HAVING sum(COALESCE(o.precio, 0) - COALESCE(o.dto_efectivo, 0) + COALESCE(o.tarifa_reserva, 0)) > 0`,
    [desde, hasta]);

  // Varias cuentas del mismo conductor se suman en una sola línea suya.
  const porConductor = new Map();
  const sinFicha = [];
  r.rows.forEach(x => {
    const importe = Number(x.efectivo);
    if (x.conductor_id) {
      const k = String(x.conductor_id);
      const a = porConductor.get(k) || { conductorId: k, viajes: 0, importe: 0 };
      a.viajes += x.viajes; a.importe = +(a.importe + importe).toFixed(2);
      porConductor.set(k, a);
    } else {
      sinFicha.push({ boltUuid: x.uuid, nombre: x.externo_nombre || ('Cuenta ' + x.uuid.slice(0, 8)),
        viajes: x.viajes, importe });
    }
  });
  return [...porConductor.values(), ...sinFicha];
}

/**
 * Congela en `recaudacion_cierre` lo que dice BOLT de esa quincena.
 *
 * Devuelve lo que CAMBIÓ respecto a lo que había, no solo lo que hay: si una
 * cifra contra la que ya se cobró se mueve, eso hay que verlo, no enterarse
 * cuando no cuadre la caja.
 */
async function calcularDesdeBolt(q, { usuarioId } = {}) {
  const calculado = await efectivoBolt(q);
  const previos = new Map((await db.consulta(
    `SELECT COALESCE(conductor_id::text, bolt_uuid) AS quien, importe, origen
       FROM recaudacion_cierre WHERE anio = $1 AND mes = $2 AND quincena = $3`,
    [q.anio, q.mes, q.quincena]))
    .rows.map(x => [String(x.quien), { importe: Number(x.importe), origen: x.origen }]));

  const conductores = (await db.consulta(
    `SELECT id, trim(nombre || ' ' || COALESCE(apellidos, '')) AS n FROM conductor`)).rows;
  const nombres = new Map(conductores.map(x => [String(x.id), x.n]));

  // RED DE SEGURIDAD. Una cuenta sin enlazar cuyo nombre es EL MISMO que el de
  // alguien de la plantilla casi siempre es esa persona con el enlace sin
  // hacer; darla de alta por su cuenta le apuntaría la deuda DOS VECES, una
  // por su ficha y otra por su cuenta. Se deja fuera y se avisa para que
  // alguien enlace la cuenta, que es el arreglo de verdad.
  const llave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const porNombre = new Map();
  conductores.forEach(c => { const k = llave(c.n); porNombre.set(k, porNombre.has(k) ? null : c); });
  const sospechosas = [];

  // Lo puesto A MANO no se pisa NUNCA, coincida o no con lo que diga BOLT: si
  // Tráfico cuadró una cifra con el conductor por teléfono, o vino del volcado
  // del Excel viejo, esa es la buena. Antes solo se respetaba cuando los
  // números DIFERÍAN, así que el día que BOLT acertaba por casualidad la fila
  // pasaba a 'bolt' y perdía la protección para el siguiente recálculo.
  const esManual = c => (previos.get(c.clave) || {}).origen === 'manual';

  const cambios = [], nuevos = [], respetados = [];
  // La clave de cada línea: la ficha si la tiene, y si no su cuenta de BOLT.
  calculado.forEach(c => { c.clave = c.conductorId || c.boltUuid; });

  // Las cuentas sin ficha que se parecen a alguien de la plantilla, fuera.
  const seguras = calculado.filter(c => {
    if (!c.boltUuid) return true;
    const p = porNombre.get(llave(c.nombre));
    if (p) { sospechosas.push({ ...c, pareceA: p.n, conductorId: String(p.id) }); return false; }
    return true;
  });

  for (const c of seguras) {
    const antes = previos.get(c.clave);
    if (esManual(c)) {
      // Solo se avisa de los que además NO cuadran: los que coinciden no son
      // noticia y llenarían el aviso de ruido.
      if (Math.abs(antes.importe - c.importe) > 0.005) {
        respetados.push({ ...c, conductor: nombreDe(c, nombres), antes: antes.importe });
      }
      continue;
    }
    if (!antes) nuevos.push({ ...c, conductor: nombreDe(c, nombres) });
    else if (Math.abs(antes.importe - c.importe) > 0.005) {
      cambios.push({ ...c, conductor: nombreDe(c, nombres), antes: antes.importe });
    }
  }

  const aGuardar = seguras.filter(c => !esManual(c));
  if (aGuardar.length) {
    await db.transaccion(async cli => {
      for (const c of aGuardar) {
        // Dos índices únicos, uno por ficha y otro por cuenta: el ON CONFLICT
        // tiene que apuntar al que toca en cada caso.
        if (c.conductorId) {
          await cli.query(
            `INSERT INTO recaudacion_cierre (conductor_id, anio, mes, quincena, importe, origen, usuario_id)
             VALUES ($1, $2, $3, $4, $5, 'bolt', $6)
             ON CONFLICT (conductor_id, anio, mes, quincena) WHERE conductor_id IS NOT NULL
             DO UPDATE SET importe = EXCLUDED.importe, origen = 'bolt',
                           usuario_id = EXCLUDED.usuario_id, actualizado_at = now()`,
            [c.conductorId, q.anio, q.mes, q.quincena, c.importe.toFixed(2), usuarioId || null]);
        } else {
          await cli.query(
            `INSERT INTO recaudacion_cierre (bolt_uuid, anio, mes, quincena, importe, origen, usuario_id)
             VALUES ($1, $2, $3, $4, $5, 'bolt', $6)
             ON CONFLICT (bolt_uuid, anio, mes, quincena) WHERE bolt_uuid IS NOT NULL
             DO UPDATE SET importe = EXCLUDED.importe, origen = 'bolt',
                           usuario_id = EXCLUDED.usuario_id, actualizado_at = now()`,
            [c.boltUuid, q.anio, q.mes, q.quincena, c.importe.toFixed(2), usuarioId || null]);
        }
      }
    });
  }
  return {
    quincena: { ...q, etiqueta: etiquetaQuincena(q) },
    conductores: seguras.length,
    total: +seguras.reduce((a, c) => a + c.importe, 0).toFixed(2),
    nuevos, cambios, respetados,
    // Las que no se han tocado por parecerse a alguien de la plantilla.
    sospechosas,
    sinFicha: seguras.filter(c => c.boltUuid).length,
  };
}

/** El nombre de una línea: el de su ficha, o el que da BOLT si no la tiene. */
function nombreDe(c, nombres) {
  return c.conductorId ? (nombres.get(c.conductorId) || '?') : (c.nombre || '?');
}

/**
 * Suma (o resta) un ajuste a una quincena, con su motivo.
 *
 * Es lo que se usa para arrastrar lo que se cerró mal en la quincena anterior:
 * el importe de BOLT se queda como está —que es la verdad de esos viajes— y el
 * arrastre va aparte, explicado. Un recálculo desde BOLT no lo toca.
 *
 * `ajuste` reemplaza al que hubiera, no se acumula: llamar dos veces por el
 * mismo motivo no puede cobrar dos veces.
 */
async function ajustarCierre({ conductorId, anio, mes, quincena, ajuste, motivo, usuarioId } = {}) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');
  const q = quincenaValida({ anio, mes, quincena });
  const m = (motivo || '').trim();
  const signo = String(ajuste).trim().startsWith('-') ? -1 : 1;
  const centimos = signo * aCentimos(String(ajuste).replace('-', ''));
  if (centimos !== 0 && !m) throw new Error('Di por qué se ajusta: un número sin explicación no vale.');

  const r = await db.consulta(
    `INSERT INTO recaudacion_cierre (conductor_id, anio, mes, quincena, importe, ajuste, ajuste_motivo, origen, usuario_id)
     VALUES ($1, $2, $3, $4, 0, $5, $6, 'manual', $7)
     ON CONFLICT (conductor_id, anio, mes, quincena) DO UPDATE
        SET ajuste = EXCLUDED.ajuste, ajuste_motivo = EXCLUDED.ajuste_motivo,
            actualizado_at = now()
     RETURNING importe, ajuste`,
    [id, q.anio, q.mes, q.quincena, (centimos / 100).toFixed(2),
      centimos === 0 ? null : m.slice(0, 255), usuarioId || null]);
  return { importe: Number(r.rows[0].importe), ajuste: Number(r.rows[0].ajuste),
    quincena: { ...q, etiqueta: etiquetaQuincena(q) } };
}

/**
 * Carga el cierre de BOLT de una quincena pegando el Excel tal cual: una línea
 * por conductor, "nombre <tab> importe". Se deja por si un mes hay que meterlo
 * a mano —un histórico viejo, una hoja que mandan de fuera—, pero lo normal es
 * `calcularDesdeBolt`, que no se equivoca escribiendo.
 */
async function importarCierre({ anio, mes, quincena, texto, usuarioId } = {}) {
  const q = quincenaValida({ anio, mes, quincena });
  const lineas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lineas.length) throw new Error('No has pegado nada');
  if (lineas.length > 2000) throw new Error('Demasiadas líneas de golpe (máximo 2000)');

  const padron = (await db.consulta(
    `SELECT c.id, trim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre
       FROM conductor c WHERE NOT c.es_centinela`)).rows;
  // Se compara sin tildes, sin dobles espacios y en minúsculas: el cierre de
  // BOLT escribe los nombres a su manera y así casan igual.
  const llave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const porNombre = new Map();
  padron.forEach(c => {
    const k = llave(c.nombre);
    // Un nombre repetido no se adivina: se deja fuera y se avisa.
    porNombre.set(k, porNombre.has(k) ? null : c);
  });

  const casados = [], sinCasar = [], ambiguos = [];
  for (const linea of lineas) {
    // "Nombre <tab|;|,| 2+ espacios> importe". El importe es lo último.
    const m = linea.match(/^(.*?)[\t;]\s*([-\d.,]+)\s*€?$/) || linea.match(/^(.*?)\s{2,}([-\d.,]+)\s*€?$/)
           || linea.match(/^(.*?)\s+([-\d.,]+)\s*€?$/);
    if (!m) { sinCasar.push({ linea, porque: 'no se ve el importe' }); continue; }
    const nombre = m[1].trim();
    let importe;
    try { importe = aCentimos(m[2].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); }
    catch (_) { sinCasar.push({ linea, porque: 'el importe no se entiende' }); continue; }
    const c = porNombre.get(llave(nombre));
    if (c === null) { ambiguos.push({ linea, porque: 'hay dos conductores con ese nombre' }); continue; }
    if (!c) { sinCasar.push({ linea, porque: 'ese nombre no está en la plantilla' }); continue; }
    casados.push({ conductorId: c.id, nombre: c.nombre, importe: +(importe / 100).toFixed(2) });
  }

  // Se guarda TODO junto o nada: media carga es peor que ninguna, porque nadie
  // sabría por dónde se quedó.
  if (casados.length) {
    await db.transaccion(async cli => {
      for (const c of casados) {
        await cli.query(
          `INSERT INTO recaudacion_cierre (conductor_id, anio, mes, quincena, importe, origen, usuario_id)
           VALUES ($1, $2, $3, $4, $5, 'importado', $6)
           ON CONFLICT (conductor_id, anio, mes, quincena) DO UPDATE
              SET importe = EXCLUDED.importe, origen = 'importado',
                  usuario_id = EXCLUDED.usuario_id, actualizado_at = now()`,
          [c.conductorId, q.anio, q.mes, q.quincena, c.importe.toFixed(2), usuarioId || null]);
      }
    });
  }
  return {
    quincena: { ...q, etiqueta: etiquetaQuincena(q) },
    guardados: casados.length,
    total: +casados.reduce((a, c) => a + c.importe, 0).toFixed(2),
    sinCasar: [...sinCasar, ...ambiguos],
  };
}

module.exports = {
  DENOMINACIONES, ETIQUETA_DEN, TIPOS, TIPO, SALIDAS, TODAS_SALIDAS, ES_SALIDA,
  cuadre, salidasDe,
  quincenaDe, quincenaHoy, quincenaValida, rangoQuincena, mueveQuincena,
  etiquetaQuincena, cortaQuincena,
  cuadro, ficha, candidatos, anotar, anular, guardarCierre, importarCierre,
  efectivoBolt, calcularDesdeBolt, ajustarCierre,
};
