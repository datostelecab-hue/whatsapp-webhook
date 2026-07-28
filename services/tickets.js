// ============================================================
// TICKETS — pipeline de candidatos (Selección → RRHH → Tráfico)
// ============================================================
// Un ticket por candidato, identificado por su TELÉFONO (9 dígitos). El ticket
// viaja entre etapas y va acumulando datos. La fuente de verdad es esta hoja
// (pestaña TICKETS del Planificador); el correo es solo soporte.
//
// Este módulo cubre el Paso 2 (Selección) pero define ya todas las columnas del
// pipeline completo, para que RRHH/Tráfico/Asistencias solo tengan que rellenar
// las suyas sin cambiar el esquema.

const { readSheet, writeSheetRaw, ensureSheet } = require('./sheets');
const { leerPadron } = require('./conductoresBolt');
const { crearConductor } = require('./planificadorV2');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'TICKETS';
const TZ = 'Europe/Madrid';

// Columnas (0-based) del pipeline completo.
const COL = {
  id: 0,               // teléfono 9 díg — clave del ticket
  nombre: 1,
  estado: 2,
  etapa: 3,
  canal: 4,
  zona: 5,
  experiencia: 6,      // Sí / No
  carne_vtc: 7,        // Sí / No
  prueba: 8,           // Sí / No — prueba de conducción
  medico: 9,           // Sí / No — apto médico
  driver_uuid: 10,     // enlace al padrón CONDUCTORES_BOLT (lo rellena la conciliación)
  responsable: 11,
  notas: 12,
  fecha_creacion: 13,
  fecha_apto: 14,      // Selección declara APTO y manda a BOLT
  fecha_alta: 15,      // RRHH: alta en Seguridad Social procesada
  fecha_habilitado: 16,// RRHH: desde cuándo puede trabajar
  fecha_asignado: 17,  // Tráfico: vehículo + turno
  fecha_baja: 18,      // retorno / baja / descarte
  motivo: 19,          // motivo del retorno / baja / descarte
  fecha_deteccion: 20, // cuándo el padrón detectó al conductor ya en BOLT
  // Datos que recopila Selección durante el funnel:
  dni: 21,             // DNI / NIE
  email: 22,
  contacto_emergencia: 23,
  fecha_nacimiento: 24,
  turno: 25,           // turno de la vacante que se cubre (Día/Noche/TodoTurno)
  iban: 26,            // certificado bancario (IBAN / nº cuenta)
  direccion: 27,
  coordenadas: 28
};
const N_COLS = 29;

const CABECERA = [
  'telefono', 'nombre', 'estado', 'etapa', 'canal', 'zona', 'experiencia',
  'carne_vtc', 'prueba_conduccion', 'apto_medico', 'driver_uuid', 'responsable',
  'notas', 'fecha_creacion', 'fecha_apto', 'fecha_alta', 'fecha_habilitado',
  'fecha_asignado', 'fecha_baja', 'motivo', 'fecha_deteccion',
  'dni', 'email', 'contacto_emergencia', 'fecha_nacimiento', 'turno', 'iban',
  'direccion', 'coordenadas'
];

const ESTADOS = {
  // Funnel de candidatura (etapa Selección), en orden:
  PRESELECCION: 'Preselección',
  COORD_ENTREVISTA: 'Coordinación de entrevista',
  ENTREVISTADO: 'Entrevistado',
  REC_MEDICO: 'Reconocimiento médico',
  RELEVAMIENTO: 'Relevamiento de datos',
  // Salidas:
  DESCARTADO: 'Descartado',
  PENDIENTE_BOLT: 'Pendiente en BOLT',   // enviado a BOLT, esperando aprobación
  APROBADO_BOLT: 'Aprobado en BOLT',     // el padrón lo detectó → alerta a RRHH
  RECHAZADO_BOLT: 'Rechazado en BOLT',   // BOLT lo rechazó (marcado a mano)
  ALTA: 'Alta procesada - habilitado',
  NO_ALTA: 'Alta no realizada',          // RRHH decide no continuar con el alta
  ASIGNADO: 'Asignado',
  NO_PRUEBA: 'No supera periodo de prueba',
  BAJA: 'Baja empresa',
  AUSENTE: 'Ausente notificado',
  DESPIDO: 'Despido procedente'
};
// Orden del funnel de Selección. El "enviar a BOLT" solo se habilita al llegar
// a la última etapa (relevamiento de datos hecho).
const ETAPAS_CANDIDATURA = [
  ESTADOS.PRESELECCION, ESTADOS.COORD_ENTREVISTA, ESTADOS.ENTREVISTADO,
  ESTADOS.REC_MEDICO, ESTADOS.RELEVAMIENTO
];
const ETAPAS = { SELECCION: 'Selección', BOLT: 'BOLT', RRHH: 'RRHH', TRAFICO: 'Tráfico' };
const CANALES = ['Referido', 'ETT', 'Web/Landing', 'Infojobs', 'RRSS', 'Otro'];

// --- utilidades -------------------------------------------------------------

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

/** Deja el teléfono en 9 dígitos (quita prefijos, espacios, +34…). */
function normalizarTel(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}
function telValido(t) { return /^\d{9}$/.test(t); }

function siNo(v) {
  if (v === true || v === 'Sí' || v === 'si' || v === 'sí' || v === 'true' || v === '1') return 'Sí';
  if (v === false || v === 'No' || v === 'no' || v === 'false' || v === '0' || v === '') return 'No';
  return v ? 'Sí' : 'No';
}

function filaAObjeto(row) {
  const o = {};
  for (const [k, i] of Object.entries(COL)) o[k] = (row[i] == null ? '' : row[i]).toString();
  return o;
}
function objetoAFila(o) {
  const fila = new Array(N_COLS).fill('');
  for (const [k, i] of Object.entries(COL)) fila[i] = o[k] == null ? '' : o[k];
  return fila;
}

// --- lectura / escritura ----------------------------------------------------

/** Lee todos los tickets → { lista: [obj], porTel: Map(tel -> obj), filas }. */
async function leerTickets() {
  await ensureSheet(ID_PLANIFICADOR, HOJA);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:AC`);
  const lista = [];
  const porTel = new Map();
  for (let i = 1; i < filas.length; i++) {
    const tel = (filas[i][COL.id] || '').toString().trim();
    if (!tel) continue;
    const o = filaAObjeto(filas[i]);
    o.id = tel;
    if (!porTel.has(tel)) { lista.push(o); porTel.set(tel, o); }
  }
  return { lista, porTel, filas: filas.length };
}

/** Reescribe toda la hoja desde el mapa (cabecera + tickets). */
async function guardarTodos(porTel, filasViejas) {
  const grid = [CABECERA, ...[...porTel.values()].map(objetoAFila)];
  while (grid.length < filasViejas) grid.push(new Array(N_COLS).fill(''));
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!A1`, grid);
}

// --- operaciones ------------------------------------------------------------

/**
 * Crea o actualiza un ticket por teléfono. Solo toca los campos que llegan en
 * `datos` (upsert parcial). Un ticket nuevo entra en "En criba" / etapa Selección.
 */
async function guardarTicket(datos = {}) {
  const tel = normalizarTel(datos.tel || datos.telefono || datos.id);
  if (!telValido(tel)) throw new Error('Teléfono inválido: deben ser 9 dígitos');

  const { porTel, filas } = await leerTickets();
  let t = porTel.get(tel);
  if (!t) {
    t = {
      id: tel, nombre: '', estado: ESTADOS.PRESELECCION, etapa: ETAPAS.SELECCION,
      canal: '', zona: '', experiencia: 'No', carne_vtc: 'No', prueba: 'No',
      medico: 'No', driver_uuid: '', responsable: '', notas: '',
      fecha_creacion: ahora(), fecha_apto: '', fecha_alta: '', fecha_habilitado: '',
      fecha_asignado: '', fecha_baja: '', motivo: '', fecha_deteccion: '',
      dni: '', email: '', contacto_emergencia: '', fecha_nacimiento: '',
      turno: '', iban: '', direccion: '', coordenadas: ''
    };
    porTel.set(tel, t);
  }

  // Campos de texto editables desde Selección.
  ['nombre', 'canal', 'zona', 'turno', 'responsable', 'notas', 'dni', 'email',
   'contacto_emergencia', 'fecha_nacimiento', 'iban', 'direccion', 'coordenadas']
    .forEach(k => { if (datos[k] !== undefined) t[k] = String(datos[k]).trim(); });
  if (datos.experiencia !== undefined) t.experiencia = siNo(datos.experiencia);
  if (datos.carne_vtc !== undefined) t.carne_vtc = siNo(datos.carne_vtc);

  await guardarTodos(porTel, filas);
  return t;
}

/** Mueve el ticket a otra etapa del funnel de candidatura (adelante o atrás). */
async function cambiarEtapaCandidatura(tel, estado) {
  tel = normalizarTel(tel);
  if (!ETAPAS_CANDIDATURA.includes(estado)) throw new Error('Etapa de candidatura no válida');
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  t.estado = estado;
  t.etapa = ETAPAS.SELECCION;
  await guardarTodos(porTel, filas);
  return t;
}

/**
 * Envía la solicitud de alta a BOLT. Aquí TERMINA Selección: solo se puede
 * cuando el candidato completó el funnel (última etapa: "Relevamiento de datos").
 * El ticket queda "Pendiente en BOLT"; RRHH se entera cuando la conciliación
 * detecta al conductor ya creado en BOLT.
 */
async function enviarABolt(tel) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  if (t.estado !== ESTADOS.RELEVAMIENTO) {
    throw new Error('Antes de enviar a BOLT hay que completar el funnel hasta "Relevamiento de datos"');
  }
  t.estado = ESTADOS.PENDIENTE_BOLT;
  t.etapa = ETAPAS.BOLT;
  t.fecha_apto = ahora();
  await guardarTodos(porTel, filas);
  return t;
}

/** Parsea 'dd/mm/aaaa HH:mm(:ss)' → ms UTC comparables (null si no casa). */
function parseFecha(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

/**
 * Cruza los tickets "Pendiente en BOLT" contra el padrón CONDUCTORES_BOLT por
 * teléfono. Si el conductor ya apareció en BOLT (y su alta es POSTERIOR al apto,
 * para no casar con un registro viejo de un reincorporado), pasa el ticket a
 * "Aprobado en BOLT" / etapa RRHH y vincula su driver_uuid. Pensado para correr
 * justo detrás del cron del padrón.
 */
async function conciliarTicketsBolt() {
  const { db } = await leerPadron();
  const porTelPadron = new Map();
  db.forEach(d => {
    const t = normalizarTel(d.phone);
    if (t && !porTelPadron.has(t)) porTelPadron.set(t, d);
  });

  const { porTel, filas } = await leerTickets();
  const ahoraTxt = ahora();
  const detectados = [];

  [...porTel.values()].forEach(tk => {
    if (tk.estado !== ESTADOS.PENDIENTE_BOLT) return;
    const d = porTelPadron.get(normalizarTel(tk.id));
    if (!d) return;
    // El conductor debe haber aparecido en BOLT DESPUÉS del apto (evita casar con
    // el registro viejo de un reincorporado que ya estaba en el padrón).
    const apto = parseFecha(tk.fecha_apto), creado = parseFecha(d.created_at);
    if (apto != null && creado != null && creado < apto) return;

    tk.driver_uuid = d.driver_uuid || '';
    tk.estado = ESTADOS.APROBADO_BOLT;
    tk.etapa = ETAPAS.RRHH;
    tk.fecha_deteccion = ahoraTxt;
    if (!tk.nombre && d.nombre) tk.nombre = d.nombre;
    detectados.push({ tel: tk.id, nombre: tk.nombre, driver_uuid: tk.driver_uuid });
  });

  if (detectados.length) await guardarTodos(porTel, filas);
  return { detectados, total: detectados.length };
}

/** Marca un ticket como rechazado por BOLT (detección manual desde la plataforma). */
async function marcarRechazadoBolt(tel, motivo) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  t.estado = ESTADOS.RECHAZADO_BOLT;
  t.motivo = (motivo || '').toString().trim() || 'Rechazado en BOLT';
  t.fecha_baja = ahora();
  await guardarTodos(porTel, filas);
  return t;
}

/** Descarta un candidato en Selección, con motivo. */
async function descartar(tel, motivo) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  t.estado = ESTADOS.DESCARTADO;
  t.motivo = (motivo || '').toString().trim();
  t.fecha_baja = ahora();
  await guardarTodos(porTel, filas);
  return t;
}

/**
 * RRHH tramita el alta: registra la fecha del alta en Seguridad Social y la
 * fecha desde la que el conductor queda habilitado, y hace el HANDOFF creando la
 * ficha en AGENDA_V2 como "Pendiente Asignar" (reutiliza crearConductor del
 * planificador). El ID_BOLT de la agenda = el nombre de Bolt del padrón; la
 * FECHA_ALTA de la agenda = la fecha de habilitación (desde cuándo puede salir).
 * Primero se crea en la agenda y solo si eso va bien se avanza el ticket.
 */
async function procesarAltaRRHH(tel, datos = {}) {
  tel = normalizarTel(tel);
  const fechaAlta = (datos.fecha_alta || '').toString().trim();
  const fechaHab = (datos.fecha_habilitado || '').toString().trim();
  if (!fechaAlta || !fechaHab) throw new Error('Faltan la fecha de alta y la fecha de habilitación');

  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  if (t.etapa !== ETAPAS.RRHH) throw new Error('Este ticket no está en RRHH');

  // Nombre de Bolt (ID_BOLT) desde el padrón, vía driver_uuid.
  let boltNombre = '';
  if (t.driver_uuid) {
    try {
      const { db } = await leerPadron();
      const d = db.get(t.driver_uuid);
      if (d) boltNombre = (d.nombre || '').trim();
    } catch (_) { /* si el padrón falla, se crea sin ID_BOLT */ }
  }
  const nombre = boltNombre || t.nombre;
  if (!nombre) throw new Error('El conductor no tiene nombre para crear la ficha en la agenda');

  const obs = [
    `Alta RRHH ${fechaAlta}`,
    t.canal ? `Canal: ${t.canal}` : '',
    t.email ? `Email: ${t.email}` : '',
    t.iban ? `IBAN: ${t.iban}` : '',
    t.fecha_nacimiento ? `Nac.: ${t.fecha_nacimiento}` : ''
  ].filter(Boolean).join(' · ');

  // Solo se pasan campos con valor (validarCampo del planificador rechaza vacíos
  // en turno/coordenadas). FECHA_ALTA de la agenda = fecha de habilitación.
  const datosAgenda = {
    id: boltNombre || '', nombre, telefono: tel, fechaAlta: fechaHab, observaciones: obs
  };
  if (t.dni) datosAgenda.dni = t.dni;
  if (t.contacto_emergencia) datosAgenda.telEmergencia = t.contacto_emergencia;
  if (t.turno) datosAgenda.turno = t.turno;           // turno de la vacante cubierta
  if (t.direccion) datosAgenda.direccion = t.direccion;
  if (t.coordenadas) datosAgenda.coordenadas = t.coordenadas;

  try {
    await crearConductor(datosAgenda);
  } catch (e) {
    // Si ya estaba en la agenda, seguimos y marcamos el alta igual. Cualquier
    // otro error (archivado en OUT, DNI duplicado…) se propaga a RRHH.
    if (!/Ya hay un conductor con el ID/i.test(e.message)) throw e;
  }

  t.estado = ESTADOS.ALTA;
  t.etapa = ETAPAS.TRAFICO;
  t.fecha_alta = fechaAlta;
  t.fecha_habilitado = fechaHab;
  await guardarTodos(porTel, filas);
  return t;
}

/** RRHH decide no continuar con el alta, dejándolo registrado. */
async function noContinuarRRHH(tel, motivo) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  t.estado = ESTADOS.NO_ALTA;
  t.motivo = (motivo || '').toString().trim() || 'RRHH decide no continuar';
  t.fecha_baja = ahora();
  await guardarTodos(porTel, filas);
  return t;
}

module.exports = {
  leerTickets, guardarTicket, cambiarEtapaCandidatura, enviarABolt, descartar,
  conciliarTicketsBolt, marcarRechazadoBolt,
  procesarAltaRRHH, noContinuarRRHH,
  normalizarTel, telValido, ESTADOS, ETAPAS, ETAPAS_CANDIDATURA, CANALES, COL
};
