// ============================================================
// PARÁMETROS DE NEGOCIO — los números de las reglas, en un solo sitio
// ============================================================
// Hoja de ruta de Ignacio, convención 4: «Todo número de regla es un parámetro.
// Plazos, topes y fechas (5 días, 100 €, día 20, etc.) van en una tabla de
// parámetros editable por un administrador, no en el código». Pieza A3 de
// docs/Hoja de ruta.md (13/11/2026).
//
// EL CATÁLOGO es este fichero: qué parámetros hay, de qué tipo, en qué unidad,
// cuánto valen si nadie los ha cambiado y qué ítem los usa. La base
// (parametro_cambio, db/243) guarda solo los CAMBIOS, sin pisar ninguno. Un
// parámetro nuevo es una entrada más aquí, sin migración.
//
//   const parametros = require('../../services/parametros');
//   const dias = await parametros.valor('sanciones.plazo_dias_habiles');   // 5
//
// El valor sale de una caché de un minuto: se pide en cada uso, no se guarda en
// una constante al arrancar (un cambio tiene que notarse sin desplegar).
//
// UN PLAZO QUE YA CORRE NO CAMBIA. Quien calcula una fecha límite la guarda al
// nacer; cambiar el parámetro solo afecta a lo que nazca después.
//
// Quién los cambia: la llave '/parametros' o el desarrollador por su rol
// (Camilo, 13/11/2026). La pantalla es modules/Parametros.
'use strict';

const repo = require('./repo/parametros');

// ── Los tipos ──────────────────────────────────────────────────────────────
// `entero` lleva su `unidad` (lo que se escribe detrás del número) y sus
// límites; `importe` va en euros con dos decimales; `texto`, con su largo
// máximo; `horario`, los días de la semana (1 = lunes … 7 = domingo) y la hora
// de abrir y de cerrar, en hora de Madrid.
const UNIDADES = {
  dias_habiles: { una: 'día hábil', varias: 'días hábiles' },
  horas_habiles: { una: 'hora hábil', varias: 'horas hábiles' },
  dias: { una: 'día', varias: 'días' },
  anios: { una: 'año', varias: 'años' },
  dia_mes: null,   // «el día 20 de cada mes»
};

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// ── El catálogo ────────────────────────────────────────────────────────────
// `usa`: dónde se usa ya. Los que solo traen `item` son números que la hoja de
// ruta ya fija y que usará ese ítem cuando se haga: están aquí para que se vean
// y se puedan revisar desde ya, pero cambiarlos aún no cambia nada (la pantalla
// lo dice).
const CATALOGO = [
  // Calendario (convención 3)
  { clave: 'oficina.madrid.horario', modulo: 'Calendario', tipo: 'horario',
    etiqueta: 'Horario de la oficina de Madrid',
    defecto: { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' },
    descripcion: 'Las horas que cuentan como hábiles. Fuera de este horario, en fin de semana o en un festivo, un plazo en horas hábiles se para y sigue al abrir la oficina.',
    usa: 'Los días y las horas hábiles de todos los plazos' },

  // Fase 1 — RR. HH.
  { clave: 'expedientes.despido.plazo_dias_habiles', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 3,
    etiqueta: 'Plazo para aplicar un despido',
    descripcion: 'Desde que la propuesta de despido validada por Dirección llega al panel de Laura.' },
  { clave: 'expedientes.recurso.plazo_dias_habiles', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 2,
    etiqueta: 'Plazo para responder un recurso',
    descripcion: 'Recursos de sanciones o de descuentos.' },
  { clave: 'nomina.dia_regularizaciones', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 25,
    etiqueta: 'Día de presentar regularizaciones e indemnizaciones',
    descripcion: 'Laura las presenta ese día de cada mes para que Diana las aplique.' },
  { clave: 'sanciones.plazo_dias_habiles', modulo: 'RR. HH.', item: 5, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 5,
    etiqueta: 'Plazo para comunicar una sanción',
    descripcion: 'Cuenta desde que Ángel, William o Ignacio aprueban el ticket de sanción.' },
  { clave: 'sanciones.dia_limite_suspension', modulo: 'RR. HH.', item: 5, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 26,
    etiqueta: 'Día límite para registrar una suspensión',
    descripcion: 'Una suspensión de empleo y sueldo se registra antes de este día del mes.' },
  { clave: 'cartas.plazo_dias_habiles', modulo: 'RR. HH.', item: 6, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 4,
    etiqueta: 'Plazo de Laura para una carta de descuento',
    descripcion: 'Desde que se registra el motivo del descuento.' },
  { clave: 'cartas.margen_corte_dias_habiles', modulo: 'RR. HH.', item: 6, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 4,
    etiqueta: 'Margen antes del corte de la nómina',
    descripcion: 'Lo registrado después de esa fecha pasa a la nómina del mes siguiente.' },
  { clave: 'nomina.dia_corte', modulo: 'RR. HH.', item: 6, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 25,
    etiqueta: 'Día del corte de la nómina',
    descripcion: 'La «nómina del 25» de la hoja de ruta.' },
  { clave: 'nomina.dia_pendientes', modulo: 'RR. HH.', item: 7, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 20,
    etiqueta: 'Día del informe de pendientes de nómina',
    descripcion: 'Si no es hábil, se genera el hábil anterior.' },
  { clave: 'bajas.plazo_pin_dias_habiles', modulo: 'RR. HH.', item: 8, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 10, defecto: 1,
    etiqueta: 'Plazo para anular credenciales y PIN',
    descripcion: 'Tarea de Daiane al cerrar una baja o un despido.' },

  // Fase 2 — Administración
  { clave: 'multas.urgente_si_quedan_dias_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 5,
    etiqueta: 'Multa urgente si quedan menos de',
    descripcion: 'Días hábiles hasta la fecha límite de identificación al subirla.' },
  { clave: 'multas.urgente_respuesta_horas_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'horas_habiles', min: 1, max: 120, defecto: 24,
    etiqueta: 'Plazo de respuesta de una multa urgente' },
  { clave: 'multas.aviso_dias_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 60, defecto: 10,
    etiqueta: 'Aviso a Daiane antes del vencimiento' },
  { clave: 'multas.identificar_antes_dias_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 5,
    etiqueta: 'Identificar la multa al menos antes del vencimiento' },
  { clave: 'itv.aviso_dias', modulo: 'Administración', item: 14, tipo: 'entero', unidad: 'dias', min: 1, max: 120, defecto: 30,
    etiqueta: 'Aviso de ITV antes de que venza',
    descripcion: 'Aviso a Daiane y tarea de coordinar con tráfico que el coche vaya a la inspección.' },
  { clave: 'reintegros.tope_daiane', modulo: 'Administración', item: 15, tipo: 'importe', min: 0, max: 10000, defecto: 100,
    etiqueta: 'Tope de reintegro que aprueba Daiane',
    descripcion: 'Por encima, la aprobación pasa a Ignacio.' },

  // Fase 3 — Flota y taller
  { clave: 'taller.acuse_dias_habiles', modulo: 'Flota y taller', item: 16, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 10, defecto: 1,
    etiqueta: 'Plazo del acuse de una avería' },
  { clave: 'taller.fecha_taller_dias_habiles', modulo: 'Flota y taller', item: 16, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 5,
    etiqueta: 'Plazo para dar fecha de taller',
    descripcion: 'Insumos comprados y fecha y hora de taller comunicadas al conductor.' },
  { clave: 'taller.acuse_texto', modulo: 'Flota y taller', item: 16, tipo: 'texto', max: 400,
    defecto: 'Recibimos tu aviso y estamos haciendo las comprobaciones para la bajada programada del coche',
    etiqueta: 'Texto del acuse de una avería' },
  { clave: 'taller.antelacion_minima_dias_habiles', modulo: 'Flota y taller', item: 17, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 2,
    etiqueta: 'Antelación mínima de un mantenimiento programado',
    descripcion: 'El sistema no acepta una salida a taller con menos antelación.' },
  { clave: 'siniestros.parte_horas_habiles', modulo: 'Flota y taller', item: 18, tipo: 'entero', unidad: 'horas_habiles', min: 1, max: 72, defecto: 5,
    etiqueta: 'Plazo para abrir el parte de un siniestro' },
  { clave: 'polizas.aviso_dias', modulo: 'Flota y taller', item: 19, tipo: 'entero', unidad: 'dias', min: 1, max: 365, defecto: 60,
    etiqueta: 'Tarea de renovación antes de que venza una póliza' },

  // Fase 0 — Chat
  { clave: 'chat.conservacion_anios', modulo: 'Chat', item: 2, tipo: 'entero', unidad: 'anios', min: 1, max: 20, defecto: 5,
    etiqueta: 'Años que se conserva el chat' },
];

const POR_CLAVE = new Map(CATALOGO.map(p => [p.clave, p]));

function definicion(clave) {
  const p = POR_CLAVE.get(String(clave || ''));
  if (!p) throw new Error(`No existe el parámetro «${clave}»`);
  return p;
}

const copia = v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// ── Validar lo que se escribe ──────────────────────────────────────────────
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function aEntero(v, p) {
  const s = String(v == null ? '' : v).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`«${p.etiqueta}» va en números enteros`);
  const n = Number(s);
  if (p.min != null && n < p.min) throw new Error(`«${p.etiqueta}» no puede ser menos de ${p.min}`);
  if (p.max != null && n > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max}`);
  return n;
}

function aImporte(v, p) {
  const s = String(v == null ? '' : v).replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(s);
  if (!s || !Number.isFinite(n)) throw new Error(`«${p.etiqueta}» va en euros («100» o «99,50»)`);
  const r = Math.round(n * 100) / 100;
  if (p.min != null && r < p.min) throw new Error(`«${p.etiqueta}» no puede ser menos de ${p.min} €`);
  if (p.max != null && r > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max} €`);
  return r;
}

function aHorario(v, p) {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (_) { return null; } })() : v;
  if (!o || typeof o !== 'object') throw new Error(`«${p.etiqueta}»: faltan los días y las horas`);
  const dias = [...new Set((Array.isArray(o.dias) ? o.dias : []).map(Number))]
    .filter(d => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  if (!dias.length) throw new Error(`«${p.etiqueta}»: marca al menos un día`);
  const desde = String(o.desde || '').trim(), hasta = String(o.hasta || '').trim();
  if (!HORA.test(desde) || !HORA.test(hasta)) throw new Error(`«${p.etiqueta}»: las horas van como 09:00`);
  if (desde >= hasta) throw new Error(`«${p.etiqueta}»: la hora de cerrar tiene que ser después de la de abrir`);
  return { dias, desde, hasta };
}

function aTexto(v, p) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new Error(`«${p.etiqueta}» no puede quedar en blanco`);
  if (p.max && s.length > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max} letras`);
  return s;
}

/** Lo que se escribió, convertido al tipo del parámetro. Lanza con un mensaje que se puede enseñar. */
function validar(clave, crudo) {
  const p = definicion(clave);
  if (p.tipo === 'entero') return aEntero(crudo, p);
  if (p.tipo === 'importe') return aImporte(crudo, p);
  if (p.tipo === 'horario') return aHorario(crudo, p);
  if (p.tipo === 'texto') return aTexto(crudo, p);
  throw new Error(`Tipo de parámetro desconocido: ${p.tipo}`);
}

// ── Escribirlo para una persona ────────────────────────────────────────────
const euros = n => Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

function diasEnTexto(dias) {
  const d = [...dias].sort((a, b) => a - b);
  const seguidos = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos && d.length > 2) return `de ${DIAS_SEMANA[d[0] - 1]} a ${DIAS_SEMANA[d[d.length - 1] - 1]}`;
  return d.map(x => DIAS_SEMANA[x - 1]).join(', ');
}

/** «5 días hábiles», «100,00 €», «el día 20 de cada mes», «de lunes a viernes, de 09:00 a 18:00». */
function formatear(clave, valor) {
  const p = definicion(clave);
  if (valor == null) return '';
  if (p.tipo === 'importe') return euros(valor);
  if (p.tipo === 'texto') return String(valor);
  if (p.tipo === 'horario') return `${diasEnTexto(valor.dias)}, de ${valor.desde} a ${valor.hasta}`;
  if (p.unidad === 'dia_mes') return `el día ${valor} de cada mes`;
  const u = UNIDADES[p.unidad];
  return u ? `${valor} ${valor === 1 ? u.una : u.varias}` : String(valor);
}

// ── La caché ───────────────────────────────────────────────────────────────
// Todos los cambios de todos los parámetros son pocas filas: se leen de una vez
// y se guardan un minuto. Quien cambia uno la tira.
const DURA_MS = 60 * 1000;
let cache = null;   // { at, porClave: Map<clave, cambios ordenados por desde> }

async function cargar() {
  if (cache && Date.now() - cache.at < DURA_MS) return cache.porClave;
  const porClave = new Map();
  for (const f of await repo.cambios()) {
    if (!porClave.has(f.clave)) porClave.set(f.clave, []);
    porClave.get(f.clave).push(f);
  }
  cache = { at: Date.now(), porClave };
  return porClave;
}

/** Tira la caché: lo llama quien cambia un parámetro (y los tests entre uno y otro). */
function invalidar() { cache = null; }

/** El cambio que vale en `en` (el último que ya había empezado), o null. */
function vigenteEn(cambios, en) {
  const t = en.getTime();
  let v = null;
  for (const c of cambios || []) if (new Date(c.desde).getTime() <= t) v = c;
  return v;
}

/**
 * El valor de un parámetro ahora (o en `en`, una fecha o un instante). Sin
 * cambios, el del catálogo.
 */
async function valor(clave, { en } = {}) {
  const p = definicion(clave);
  const cuando = en ? new Date(en) : new Date();
  const c = vigenteEn((await cargar()).get(p.clave), cuando);
  return copia(c ? c.valor : p.defecto);
}

/** Lo que pinta la pantalla: cada parámetro con su valor de hoy y su último cambio. */
async function lista() {
  const porClave = await cargar();
  const ahora = new Date();
  return CATALOGO.map(p => {
    const cambios = porClave.get(p.clave) || [];
    const c = vigenteEn(cambios, ahora);
    const v = c ? c.valor : p.defecto;
    return {
      clave: p.clave, modulo: p.modulo, etiqueta: p.etiqueta, descripcion: p.descripcion || '',
      tipo: p.tipo, unidad: p.unidad || null, min: p.min, max: p.max,
      item: p.item || null, usa: p.usa || null, enUso: !!p.usa,
      valor: copia(v), texto: formatear(p.clave, v),
      defecto: copia(p.defecto), textoDefecto: formatear(p.clave, p.defecto),
      esDefecto: !c,
      cambios: cambios.length,
      ultimo: c ? { quien: c.quien || null, cuando: c.desde, motivo: c.motivo } : null,
    };
  });
}

/** La historia de un parámetro, del cambio más nuevo al más viejo. */
async function historial(clave) {
  const p = definicion(clave);
  const cambios = ((await cargar()).get(p.clave) || []).slice().reverse();
  return cambios.map(c => ({
    id: Number(c.id), valor: copia(c.valor), texto: formatear(p.clave, c.valor),
    desde: c.desde, motivo: c.motivo, quien: c.quien || null,
  }));
}

/**
 * Cambia un parámetro desde ahora. Exige el motivo y que sea de verdad otro
 * valor. Devuelve el parámetro como lo pinta la lista.
 */
async function cambiar(clave, crudo, { usuarioId, motivo } = {}) {
  const p = definicion(clave);
  const m = String(motivo == null ? '' : motivo).trim();
  if (m.length < 3) throw new Error('Di por qué se cambia: queda en la historia del parámetro');
  const nuevo = validar(p.clave, crudo);
  const actual = await valor(p.clave);
  if (JSON.stringify(nuevo) === JSON.stringify(actual)) throw new Error('Ese ya es el valor que tiene');
  await repo.insertarCambio({
    clave: p.clave, valorJson: JSON.stringify(nuevo), motivo: m.slice(0, 500), usuarioId: Number(usuarioId) || null,
  });
  invalidar();
  return (await lista()).find(x => x.clave === p.clave);
}

module.exports = { CATALOGO, DIAS_SEMANA, definicion, validar, formatear, valor, lista, historial, cambiar, invalidar };
