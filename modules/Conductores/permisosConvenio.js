// ============================================================
// LOS PERMISOS DEL CONVENIO: LO QUE DA CADA UNO Y LO QUE LLEVA CADA PERSONA
// ============================================================
// Módulo 1 del plan de RR. HH. y nóminas (25/11/2026). El encargo: «Permisos
// retribuidos: validador configurable, con el saldo por conductor y tipo de
// permiso siempre visible según el convenio. Se pueden modificar o anular, con
// registro y recálculo del saldo».
//
// Lo que da cada permiso está en el catálogo del convenio (`leave_type`, art.
// 22): una duración y SU UNIDAD, que es lo que cambia la cuenta:
//   · por hecho causante (matrimonio 15 naturales, fallecimiento 2 laborables…):
//     se mira cada permiso por separado;
//   · al año (asuntos propios 2 días, acompañamiento médico 8 h): se suman los
//     del año natural;
//   · el resto (lo indispensable, el crédito sindical, las reducciones, la
//     lactancia por minutos) no tiene un número de días que contar.
// Los laborables son los días que le tocaba trabajar: los de la semana menos los
// que libra (su plaza del planificador o, sin plaza, lo apuntado). Cada día de
// un permiso por horas cuenta 8 h (la jornada de un día del convenio, art. 25.c).
//
// Pasarse NO se bloquea (Camilo, 25/11/2026: «avisa y pide motivo»): el
// fallecimiento con desplazamiento son 4 y hay casos raros. Quien lo pone dice
// por qué y queda en el motivo del tramo (y con él, en el libro).
'use strict';

const repo = require('./conductores.repo');
const conductores = require('./conductores.service');

const POR_HECHO = ['CALENDAR_DAYS', 'WORKDAYS'];
const AL_ANIO = ['DAYS_PER_YEAR', 'HOURS_PER_YEAR'];
const AP = 'PR_ASUNTOS_PROPIOS';
const HORAS_DIA = 8;

const diasEntre = (d, h) => Math.round((Date.parse(h + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000) + 1;
const masDia = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = iso => ((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;   // 1 = lunes … 7 = domingo
const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/** Lo que da, en una frase. */
function regla(t) {
  const n = t.duracion == null ? null : String(t.duracion).replace('.', ',');
  const extra = /^\+/.test(String(t.nota || '')) ? ` (${String(t.nota).replace(/\bdias\b/g, 'días')})` : '';
  switch (t.unidad) {
    case 'CALENDAR_DAYS': return `${n} días naturales por hecho causante${extra}`;
    case 'WORKDAYS': return `${n} ${n === '1' ? 'día laborable' : 'días laborables'} por hecho causante${extra}`;
    case 'DAYS_PER_YEAR': return `${n} días al año`;
    case 'HOURS_PER_YEAR': return `${n} horas al año (cada día de permiso cuenta ${HORAS_DIA} h)`;
    case 'MINUTES_PER_DAY': return `${n} minutos al día`;
    case 'INDISPENSABLE': return 'el tiempo indispensable';
    case 'CREDIT_HOURS': return 'su crédito de horas sindicales';
    case 'REDUCTION': return 'una reducción de jornada';
    default: return '';
  }
}
const unidadDe = t => (t.unidad === 'HOURS_PER_YEAR' ? 'horas' : t.unidad === 'WORKDAYS' ? 'días laborables' : 'días');

let cache = null;
async function catalogo() {
  if (!cache || Date.now() - cache.en > 10 * 60000) {
    cache = { en: Date.now(), valor: repo.catalogoPermisos().then(f => new Map(f.map(t => [t.codigo, { ...t, regla: regla(t) }]))) };
    cache.valor.catch(() => { cache = null; });
  }
  return cache.valor;
}

/** Cuánto gasta un tramo, en la unidad de su permiso. `libra`: Set de días de la semana que libra. */
function cuenta(t, desde, hasta, libra) {
  const n = diasEntre(desde, hasta);
  if (n <= 0) return 0;
  if (t.unidad === 'WORKDAYS') {
    let k = 0;
    for (let i = 0; i < n; i++) if (!libra.has(dow(masDia(desde, i)))) k++;
    return k;
  }
  if (t.unidad === 'HOURS_PER_YEAR') return n * HORAS_DIA;
  return n;
}

const codigoDe = (estado, tipo) => (estado === 'asuntos_propios' ? AP
  : estado === 'permiso' ? String(tipo && typeof tipo === 'object' ? tipo.valor : (tipo || '')) : '');

/**
 * ¿Se pasa de lo que da el convenio? `tramo` = { estado, tipo, desde, hasta,
 * excluirId } (el permiso tal como quedaría). → null, o { codigo, nombre,
 * regla, permite, lleva, unidad, anual }
 */
async function comprobar(conductorId, { estado, tipo, desde, hasta, excluirId = null } = {}) {
  const codigo = codigoDe(estado, tipo);
  if (!codigo || !esIso(desde)) return null;
  const t = (await catalogo()).get(codigo);
  if (!t || t.duracion == null || ![...POR_HECHO, ...AL_ANIO].includes(t.unidad)) return null;
  const fin = esIso(hasta) ? hasta : desde;
  if (fin < desde) return null;
  const libra = t.unidad === 'WORKDAYS' ? new Set(await conductores.libranzasDe(conductorId, { momento: desde }).catch(() => [])) : new Set();
  let lleva;
  if (POR_HECHO.includes(t.unidad)) lleva = cuenta(t, desde, fin, libra);
  else {
    const ini = `${desde.slice(0, 4)}-01-01`, cierre = `${desde.slice(0, 4)}-12-31`;
    const recorte = (d, h) => cuenta(t, d < ini ? ini : d, h > cierre ? cierre : h, libra);
    const otros = await repo.permisosEntre(Number(conductorId), codigo, ini, cierre, excluirId);
    lleva = otros.reduce((s, x) => s + recorte(x.desde, x.hasta || x.desde), 0) + recorte(desde, fin);
  }
  if (lleva <= t.duracion) return null;
  return { codigo, nombre: t.nombre, regla: t.regla, permite: t.duracion, lleva, unidad: unidadDe(t), anual: AL_ANIO.includes(t.unidad) };
}

/**
 * Si se pasa, o viene con su motivo (y se devuelve la frase que va al motivo
 * del tramo), o se para con un error que PIDE el motivo: la pantalla lo
 * pregunta y lo vuelve a mandar con `motivoExceso`. → null | 'frase'
 */
async function revisar(conductorId, tramo, motivoExceso) {
  const e = await comprobar(conductorId, tramo);
  if (!e) return null;
  const m = String(motivoExceso || '').trim();
  const cifra = `${String(e.lleva).replace('.', ',')} ${e.unidad}${e.anual ? ' este año' : ''}`;
  if (m.length >= 3) return `Más de lo que da el convenio (${e.nombre}: ${e.regla}; lleva ${cifra}): ${m}`;
  const texto = `${e.nombre}: el convenio da ${e.regla}. Con este, ${cifra}.`;
  throw Object.assign(new Error(`${texto} Para guardarlo, di por qué.`), {
    status: 409,
    pide: { tipo: 'exceso_permiso', campo: 'motivoExceso', titulo: 'Más de lo que da el convenio', texto },
  });
}

/**
 * EL SALDO DE UNA PERSONA, por tipo de permiso, en un año natural: lo que da el
 * convenio, lo que lleva (días o horas, y cuántos permisos) y lo que le queda
 * de los que son al año. Salen todos los tipos; los usados, primero.
 */
async function saldo(conductorId, { anio } = {}) {
  const y = /^\d{4}$/.test(String(anio || '')) ? String(anio) : new Date().toISOString().slice(0, 4);
  const ini = `${y}-01-01`, cierre = `${y}-12-31`;
  const cat = [...(await catalogo()).values()];
  const filas = await Promise.all(cat.map(async t => {
    const tramos = await repo.permisosEntre(Number(conductorId), t.codigo, ini, cierre);
    let usado = 0;
    for (const x of tramos) {
      const d = x.desde < ini ? ini : x.desde;
      const hFin = x.hasta || x.desde;
      const h = hFin > cierre ? cierre : hFin;
      const libra = t.unidad === 'WORKDAYS' ? new Set(await conductores.libranzasDe(conductorId, { momento: x.desde }).catch(() => [])) : new Set();
      usado += cuenta(t, d, h, libra);
    }
    const anual = AL_ANIO.includes(t.unidad) && t.duracion != null;
    return {
      codigo: t.codigo, nombre: t.nombre, regla: t.regla, articulo: t.articulo || '',
      permisos: tramos.length, usado, unidad: unidadDe(t),
      queda: anual ? Math.max(0, t.duracion - usado) : null,
      pasado: t.duracion != null && (anual ? usado > t.duracion : false),
    };
  }));
  return { anio: y, tipos: filas.sort((a, b) => (b.permisos - a.permisos) || a.nombre.localeCompare(b.nombre)) };
}

/** El catálogo con su frase, para las listas donde se elige el permiso. */
async function reglas() {
  return new Map([...(await catalogo()).values()].map(t => [t.codigo, t.regla]));
}

module.exports = { comprobar, revisar, saldo, reglas, regla, cuenta, AP };
