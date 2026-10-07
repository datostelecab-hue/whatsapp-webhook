// ============================================================
// JORNADA SEMANAL · SERVICIO — ¿cumplió cada uno sus horas de la semana?
// ============================================================
// Pedido por Camilo el 07/10/2026: un informe de semana en semana, solo de la
// PLANTILLA PROPIA, con una pestaña por JORNADA (40 h, 32 h...). Una fila por
// persona: el nombre y de lunes a domingo, y si cumplió o no su jornada. Primero
// los que no cumplieron: de menor a mayor.
//
// ── LAS CUATRO REGLAS ───────────────────────────────────────────────────────
//
// 1. LAS HORAS SON LAS DE LA BITÁCORA. Se lee su rejilla (`bitacora.datos()`),
//    que ya las tiene por la regla del turno de cada conductor (día 00→24, noche
//    12→12) y SELLADAS: el informe de una semana cerrada dice lo mismo hoy que
//    dentro de un mes, y cuadra con la Bitácora casilla a casilla.
//
// 2. UNA J SUMA A LAS HORAS DE BOLT, como en la Bitácora: el día vale lo que
//    hizo en BOLT más las horas de la J. SOLO SI ESTÁ APROBADA: una J pendiente
//    todavía no la ha mirado nadie y, si la rechazan, esas horas nunca
//    existieron. Las pendientes se ven (la celda y la observación lo dicen) pero
//    no cuentan para cumplir.
//
// 3. LA BAJA MÉDICA NO SUMA, PERO SE VE: el día lleva una «B» y cero horas.
//    Igual las vacaciones (V) y los permisos (P). La jornada a cumplir NO se
//    rebaja por esos días: es lo que se pidió.
//
// 4. LO QUE CAE FUERA DE SU CONTRATO NO CUENTA: los días antes del alta o
//    después de la baja salen con «—». Quien entró el jueves tiene la semana
//    a medias, y la observación lo dice.

const bitacora = require('../Operaciones/bitacora.service');
const repo = require('./jornadaSemanal.repo');
const { cierreDe } = require('../../services/flotaViva/repartoTurnos');

const MS_DIA = 86400000;
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
// Lo que dice cada marca de ausencia de la rejilla, para la observación.
const AUSENCIA = { B: 'baja médica', V: 'vacaciones', P: 'permiso' };

const r1 = n => Math.round(n * 10) / 10;
const aUtc = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const deUtc = ms => new Date(ms).toISOString().slice(0, 10);
const sumar = (iso, n) => deUtc(aUtc(iso) + n * MS_DIA);
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** El lunes de la semana de una fecha ('YYYY-MM-DD'). En UTC: no depende de la zona del proceso. */
function lunesDe(iso) {
  const dow = (new Date(aUtc(iso)).getUTCDay() + 6) % 7;   // 0 = lunes
  return sumar(iso, -dow);
}

/**
 * Las semanas que ofrece la pantalla: la en curso y las 8 anteriores, la más
 * reciente primero. Por defecto, la ÚLTIMA CERRADA (la anterior a la de hoy):
 * es la que se revisa el lunes. La decide el servidor, en hora de Madrid, no el
 * navegador.
 */
function semanas(hoyIso = hoyMadrid()) {
  const actual = lunesDe(hoyIso);
  return Array.from({ length: 9 }, (_, k) => {
    const lunes = sumar(actual, -7 * k);
    const domingo = sumar(lunes, 6);
    return {
      lunes, domingo,
      etiqueta: `Del ${ddmm(lunes)} al ${ddmm(domingo)}${k === 0 ? ' · en curso' : k === 1 ? ' · la última cerrada' : ''}`,
      porDefecto: k === 1,
    };
  });
}

/**
 * EL DÍA DE UNA PERSONA, a partir de su fila de la rejilla de la Bitácora.
 * Puro (sin base de datos): lo prueba scripts/comprobar-jornada-semanal.js.
 *
 * @param {Object} c        fila de la rejilla: { dias[], justif{}, horasBolt{} }
 * @param {number} i        índice del día en la rejilla
 * @param {string} iso      el día, 'YYYY-MM-DD'
 * @param {Object} ctx      { hoy, alta, baja }
 * @returns {{tipo: string, horas: number, bolt: number, j: Object|null}}
 *   tipo: 'horas' · 'J' · 'B' · 'V' · 'P' · 'L' · 'ausencia' · 'fuera' · 'futuro'
 *   horas: las que CUENTAN para la semana · bolt: las que hizo en BOLT
 */
function celda(c, i, iso, { hoy, alta, baja }) {
  const v = c.dias ? c.dias[i] : null;
  const boltDe = () => (typeof v === 'number' ? v : Number((c.horasBolt || {})[iso]) || 0);
  if (iso > hoy) return { tipo: 'futuro', horas: 0, bolt: 0, j: null };
  if ((alta && iso < alta) || (baja && iso > baja)) return { tipo: 'fuera', horas: 0, bolt: boltDe(), j: null };
  if (typeof v === 'number') return { tipo: 'horas', horas: r1(v), bolt: r1(v), j: null };
  if (v === 'J') {
    const j = (c.justif || {})[iso] || {};
    const bolt = r1(Number((c.horasBolt || {})[iso]) || 0);
    const jh = Number(j.horas) || 0;
    const aprobada = j.estado === 'aprobada';
    return { tipo: 'J', horas: r1(bolt + (aprobada ? jh : 0)), bolt, j: { horas: jh, estado: j.estado || 'pendiente', obs: j.obs || '' } };
  }
  if (v === 'B' || v === 'V' || v === 'P' || v === 'L') return { tipo: v, horas: 0, bolt: boltDe(), j: null };
  // Hoy sin horas todavía no es una ausencia: la jornada no ha acabado.
  if (iso === hoy) return { tipo: 'futuro', horas: 0, bolt: 0, j: null };
  return { tipo: 'ausencia', horas: 0, bolt: 0, j: null };
}

/**
 * LA SEMANA DE UNA PERSONA: sus siete días, el total, si cumplió y por qué.
 * Pura. `jornada` null = el contrato no la dice: no se puede juzgar.
 */
function semanaDe(c, idx0, dias, { hoy, alta, baja, jornada, cerrada }) {
  const celdas = dias.map((iso, k) => celda(c, idx0 + k, iso, { hoy, alta, baja }));
  const total = r1(celdas.reduce((s, x) => s + x.horas, 0));
  const cumple = jornada == null ? null : total >= jornada - 0.05;

  const obs = [];
  if (alta && alta > dias[0] && alta <= dias[6]) obs.push(`Alta el ${DIAS_LARGOS[dias.indexOf(alta)]} ${ddmm(alta)}`);
  if (baja && baja >= dias[0] && baja < dias[6]) obs.push(`Baja de la empresa el ${DIAS_LARGOS[dias.indexOf(baja)]} ${ddmm(baja)}`);
  for (const m of ['B', 'V', 'P']) {
    const n = celdas.filter(x => x.tipo === m).length;
    if (n) obs.push(`${n} ${n === 1 ? 'día' : 'días'} de ${AUSENCIA[m]}`);
  }
  const pend = celdas.filter(x => x.tipo === 'J' && x.j.estado === 'pendiente');
  if (pend.length) {
    const h = r1(pend.reduce((s, x) => s + x.j.horas, 0));
    obs.push(`${pend.length === 1 ? 'J pendiente' : `${pend.length} J pendientes`} de aprobar: +${h} h si se aprueba${pend.length === 1 ? '' : 'n'}`);
  }
  const ausencias = celdas.filter(x => x.tipo === 'ausencia').length;
  if (ausencias) obs.push(`${ausencias} ${ausencias === 1 ? 'día' : 'días'} sin salir`);
  if (jornada == null) obs.push('El contrato no dice la jornada');

  return {
    celdas, total, jornada, cumple,
    diferencia: jornada == null ? null : r1(total - jornada),
    estado: jornada == null ? '' : !cerrada && !cumple ? 'En curso' : cumple ? 'Sí' : 'No',
    obs: obs.join(' · '),
  };
}

/** De menor a mayor: con la misma jornada, los que no cumplieron quedan arriba solos. */
const ordenar = filas => filas.sort((a, b) => (a.total - b.total) || a.nombre.localeCompare(b.nombre, 'es'));

/**
 * EL INFORME DE UNA SEMANA.
 * @param {string} [lunes]  cualquier día de la semana ('YYYY-MM-DD'); sin él, la última cerrada
 */
async function informe({ lunes } = {}) {
  const hoy = hoyMadrid();
  const pedido = /^\d{4}-\d{2}-\d{2}$/.test(String(lunes || '')) ? String(lunes) : sumar(hoy, -7);
  const l = lunesDe(pedido);
  const domingo = sumar(l, 6);
  if (l > hoy) throw new Error('Esa semana todavía no ha empezado.');

  const [rej, contratos] = await Promise.all([bitacora.datos(), repo.contratosDeLaSemana(l, domingo)]);
  const inicioMs = Date.UTC(rej.inicio.y, rej.inicio.m, rej.inicio.d);
  const idx0 = Math.round((aUtc(l) - inicioMs) / MS_DIA);
  if (idx0 < 0) throw new Error(`La Bitácora empieza el ${deUtc(inicioMs).split('-').reverse().join('/')}: no hay horas de antes.`);
  const dias = Array.from({ length: 7 }, (_, k) => sumar(l, k));
  // La noche del domingo cuenta hasta las 12:00 del lunes: hasta entonces, la
  // semana no ha cerrado.
  const cerrada = Date.now() >= cierreDe(domingo);

  const porJornada = new Map();
  let sinFila = 0;
  const porId = new Map(rej.conductores.map(c => [c.conductorId, c]));
  contratos.forEach((k, cid) => {
    if (k.tipo !== 'propia') return;
    const c = porId.get(cid);
    if (!c) { sinFila++; return; }
    const s = semanaDe(c, idx0, dias, { hoy, alta: k.alta, baja: k.baja, jornada: k.jornada, cerrada });
    // El nombre de BOLT primero, como la Bitácora y el resto de Control: es el que
    // conoce Tráfico. El de la ficha viene con formatos mezclados («APELLIDOS, NOMBRE»).
    const fila = { conductorId: cid, nombre: c.nombreBolt || c.nombre || `Conductor ${cid}`, telefono: c.telefono || '', ...s };
    const clave = k.jornada == null ? 'sin' : k.jornada;
    if (!porJornada.has(clave)) porJornada.set(clave, []);
    porJornada.get(clave).push(fila);
  });

  // Las pestañas: de la jornada más larga a la más corta, y al final quien no la tiene.
  const grupos = [...porJornada.entries()]
    .sort(([a], [b]) => (a === 'sin' ? 1 : b === 'sin' ? -1 : b - a))
    .map(([jornada, filas]) => {
      ordenar(filas);
      // Con la semana abierta, quien aún no llega está «En curso», no «No».
      return {
        jornada: jornada === 'sin' ? null : jornada, filas,
        cumplen: filas.filter(f => f.estado === 'Sí').length,
        noCumplen: filas.filter(f => f.estado === 'No').length,
      };
    });

  return {
    lunes: l, domingo, dias, cabeceras: dias.map((iso, k) => `${DIAS_CORTOS[k]} ${ddmm(iso)}`),
    cerrada, grupos, avisos: { sinFila },
    personas: grupos.reduce((s, g) => s + g.filas.length, 0),
  };
}

module.exports = { informe, semanas, lunesDe, celda, semanaDe, ordenar };
