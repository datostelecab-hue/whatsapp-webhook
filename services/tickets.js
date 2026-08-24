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

const { readSheet, writeSheetRaw, ensureSheet, ensureGrid } = require('./sheets');
const { leerPadron, buscarPorTelefono } = require('./conductoresBolt');
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
  coordenadas: 28,
  vacante: 29,         // id de la vacante guardada que se recluta
  // RETIRADO (agosto 2026): ya no se manda al conductor ningun link de alta de
  // BOLT. La columna SE QUEDA: es una hoja, y quitarla correria una posicion
  // todas las de despues y estropearia cada ficha guardada.
  link_bolt: 30,
  // --- Ficha de alta (relevamiento de datos para la FICHA DE ALTA en PDF) ---
  apellidos: 31,
  codigo_postal: 32,
  localidad: 33,       // por defecto MADRID
  provincia: 34,       // por defecto Madrid
  estado_civil: 35,
  num_hijos: 36,
  num_seg_social: 37,  // Nº Seguridad Social
  tipo_carnet: 38,     // por defecto B
  carnet_expedicion: 39,
  carnet_caducidad: 40,
  fecha_inicio: 41,    // fecha de inicio del contrato
  // --- Documentos: cada celda guarda un JSON {id, link, nombre, mime} de Drive ---
  doc_dni: 42,         // DNI/NIE — frente (el reverso va en doc_dni_reverso)
  doc_carnet: 43,      // Carnet de conducir — frente (el reverso va en doc_carnet_reverso)
  doc_bancario: 44,
  doc_seg_social: 45,  // certificado SS o 1ª página de la vida laboral
  doc_penales: 46,     // certificado de delitos sexuales
  // Datos laborales editables (el resto son fijos de empresa):
  tipo_contrato: 47,
  jornada: 48,         // 40 HORAS / 32 HORAS — determina salario y modalidad (CT-100/CT-200)
  ficha_pdf: 49,       // JSON {id, link, nombre} de la FICHA DE ALTA generada en Drive
  nacionalidad: 50,    // se captura en Selección para el Excel de Altas (col N)
  excel_alta: 51,      // fecha del Excel de Altas en el que se incluyó (solo uno)
  pin_ballenoil: 52,   // Administración: PIN de Ballenoil (combustible). Último paso antes del planificador
  // Reversos de DNI/NIE y carnet (el frente sigue en doc_dni / doc_carnet):
  doc_dni_reverso: 53,
  doc_carnet_reverso: 54,
  id_bolt: 55,         // nombre completo tal como sale en BOLT (col C de CONDUCTORES_BOLT) = ID_BOLT en la agenda
  obs_ballenoil: 56,   // Administración: observaciones de Ballenoil (opcional)
  // Los dos datos que la Seguridad Social pide y este funnel no recogia. Sin
  // ellos la ficha nace incompleta y hay que volver a preguntarselo a la
  // persona, que es justo lo que se queria evitar.
  sexo: 57,
  centro_trabajo: 58,  // codigo del centro con el que se cotiza (cat_centro_trabajo)
  // El id de la ficha en PostgreSQL, una vez creada. Es el hilo entre el
  // candidato y la persona, y evita crearla dos veces.
  conductor_id: 59
};
const N_COLS = 60;

const CABECERA = [
  'telefono', 'nombre', 'estado', 'etapa', 'canal', 'zona', 'experiencia',
  'carne_vtc', 'prueba_conduccion', 'apto_medico', 'driver_uuid', 'responsable',
  'notas', 'fecha_creacion', 'fecha_apto', 'fecha_alta', 'fecha_habilitado',
  'fecha_asignado', 'fecha_baja', 'motivo', 'fecha_deteccion',
  'dni', 'email', 'contacto_emergencia', 'fecha_nacimiento', 'turno', 'iban',
  'direccion', 'coordenadas', 'vacante', 'link_bolt',
  'apellidos', 'codigo_postal', 'localidad', 'provincia', 'estado_civil',
  'num_hijos', 'num_seg_social', 'tipo_carnet', 'carnet_expedicion',
  'carnet_caducidad', 'fecha_inicio',
  'doc_dni', 'doc_carnet', 'doc_bancario', 'doc_seg_social', 'doc_penales',
  'tipo_contrato', 'jornada', 'ficha_pdf', 'nacionalidad', 'excel_alta',
  'pin_ballenoil', 'doc_dni_reverso', 'doc_carnet_reverso', 'id_bolt', 'obs_ballenoil',
  'sexo', 'centro_trabajo', 'conductor_id'
];

// Los documentos de la ficha de alta (7 por conductor: DNI y carnet por las dos
// caras). `key` es el identificador en la API/UI, `col` la columna de TICKETS y
// `label` el título tal cual sale en el PDF.
const DOCUMENTOS = [
  { key: 'dni',            col: 'doc_dni',            label: 'DNI/NIE (FRENTE)' },
  { key: 'dni_reverso',    col: 'doc_dni_reverso',    label: 'DNI/NIE (REVERSO)' },
  { key: 'carnet',         col: 'doc_carnet',         label: 'CARNET DE CONDUCIR (FRENTE)' },
  { key: 'carnet_reverso', col: 'doc_carnet_reverso', label: 'CARNET DE CONDUCIR (REVERSO)' },
  { key: 'bancario',       col: 'doc_bancario',       label: 'CERTIFICADO BANCARIO' },
  { key: 'seg_social',     col: 'doc_seg_social',     label: 'CERTIFICADO SEGURIDAD SOCIAL / VIDA LABORAL' },
  { key: 'penales',        col: 'doc_penales',        label: 'CERTIFICADO DE DELITOS SEXUALES' }
];

// Datos mínimos que deben estar completos y guardados ANTES de enviar a BOLT, para
// que cuando el candidato llegue a RRHH la ficha esté entera. Los campos con valor
// por defecto (localidad, provincia, tipo de carnet, contrato, jornada, nº hijos)
// no se exigen porque el PDF ya los rellena.
const REQUERIDOS_ALTA = [
  ['nombre', 'Nombre'], ['apellidos', 'Apellidos'], ['dni', 'DNI/NIE'],
  ['fecha_nacimiento', 'Fecha de nacimiento'], ['sexo', 'Sexo'], ['email', 'Correo'],
  ['direccion', 'Dirección'], ['codigo_postal', 'Código postal'],
  ['estado_civil', 'Estado civil'], ['num_seg_social', 'Nº Seguridad Social'],
  ['iban', 'Certificado bancario (IBAN)'],
  ['carnet_expedicion', 'Carnet: fecha de expedición'],
  ['carnet_caducidad', 'Carnet: fecha de caducidad'],
  ['fecha_inicio', 'Fecha de inicio'],
  ['doc_dni', 'Documento: DNI/NIE (frente)'], ['doc_dni_reverso', 'Documento: DNI/NIE (reverso)'],
  ['doc_carnet', 'Documento: Carnet (frente)'], ['doc_carnet_reverso', 'Documento: Carnet (reverso)'],
  ['doc_bancario', 'Documento: Certificado bancario'],
  ['doc_seg_social', 'Documento: Seg. Social / vida laboral'],
  ['doc_penales', 'Documento: Certificado de delitos sexuales']
];
/** dd/mm/aaaa -> aaaa-mm-dd. La hoja escribe a la española; la base quiere ISO. */
function aIsoFecha(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : null;
}

/**
 * El NAF en las tres piezas que usa la gestoría: provincia, número y control.
 *
 * Se escribe de mil maneras ("28/1234567/89", "28 1234567 89", los doce dígitos
 * seguidos). Solo cuentan los dígitos: 2 + los que haya + 2. Si no salen al
 * menos ocho, no se parte nada — media matrícula de la Seguridad Social es peor
 * que ninguna.
 */
function partirNaf(v) {
  const d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (d.length < 8) return {};
  return { naf_provincia: d.slice(0, 2), naf_numero: d.slice(2, -2), naf_control: d.slice(-2) };
}

/** "40 HORAS" -> 40. */
const horasDeJornada = v => { const m = String(v == null ? '' : v).match(/(\d{1,2})/); return m ? Number(m[1]) : null; };

/**
 * Un ticket de Selección con la forma que quiere la ficha de PostgreSQL.
 *
 * Aquí es donde se despieza lo que el funnel guarda de una pieza: la dirección,
 * el NAF y las coordenadas. Y donde se deduce lo que no hace falta preguntar:
 * un documento que empieza por X, Y o Z es un NIE.
 */
function fichaDeTicket(t) {
  const s = k => { const v = String((t || {})[k] || '').trim(); return v || undefined; };
  const dni = (s('dni') || '').toUpperCase() || undefined;
  const coord = String((t || {}).coordenadas || '').split(',');
  const lat = Number(coord[0]), lng = Number(coord[1]);

  return {
    telefono: t.id,
    nombre: s('nombre'), apellidos: s('apellidos'),
    dni_nie: dni,
    dni_tipo: dni ? (/^[XYZ]/.test(dni) ? 'N.I.E' : 'D.N.I./N.I.F.') : undefined,
    fecha_nacimiento: aIsoFecha(t.fecha_nacimiento) || undefined,
    sexo: s('sexo'), estado_civil: s('estado_civil'), nacionalidad: s('nacionalidad'),
    ...partirNaf(t.num_seg_social),
    centro_codigo: s('centro_trabajo'),
    // La dirección llega en una sola cadena. Va entera al nombre de la vía:
    // despiezarla a ojo inventaría portales y pisos que nadie ha dicho.
    via_nombre: s('direccion'),
    codigo_postal: s('codigo_postal'), localidad: s('localidad'), provincia: s('provincia'),
    lat: isFinite(lat) && lat !== 0 ? lat : undefined,
    lng: isFinite(lng) && lng !== 0 ? lng : undefined,
    email: s('email'), tel_emergencia: s('contacto_emergencia'),
    // El contrato.
    tipo: 'propia',
    alta: aIsoFecha(t.fecha_inicio) || undefined,
    jornadaHoras: horasDeJornada(t.jornada),
  };
}

/** Devuelve las etiquetas de los campos requeridos que están vacíos en el ticket. */
function faltantesAlta(t) {
  return REQUERIDOS_ALTA.filter(([c]) => !String((t || {})[c] || '').trim()).map(([, l]) => l);
}

const ESTADOS = {
  // Funnel de candidatura (etapa Selección), en orden:
  PRESELECCION: 'Preselección',
  COORD_ENTREVISTA: 'Coordinación de entrevista',
  ENTREVISTADO: 'Entrevistado',
  REC_MEDICO: 'Reconocimiento médico',
  // OBSOLETO (agosto 2026): el relevamiento de datos deja de ser una etapa. Los
  // datos se piden durante el funnel y la ficha se crea directamente en
  // PostgreSQL, asi que del reconocimiento medico se pasa derecho a RRHH.
  //
  // NO se borra: hay fichas paradas en este estado y quitarlo las dejaria
  // ilegibles. Se queda para poder leerlas, fuera del recorrido.
  RELEVAMIENTO: 'Relevamiento de datos',
  // Salidas:
  DESCARTADO: 'Descartado',
  // OBSOLETO (agosto 2026): ya no se espera la aprobacion de BOLT. Se conserva
  // solo para que las fichas que se quedaron en este estado sigan legibles.
  PENDIENTE_BOLT: 'Pendiente en BOLT',
  LISTO_RRHH: 'Listo para RRHH',         // acabado el relevamiento, pasa directo
  APROBADO_BOLT: 'Aprobado en BOLT',     // el padrón lo detectó → alerta a RRHH
  RECHAZADO_BOLT: 'Rechazado en BOLT',   // BOLT lo rechazó (marcado a mano)
  PENDIENTE_PIN: 'Pendiente de alta en Ballenoil',  // RRHH ya dio el alta; Administración debe crear el PIN de Ballenoil
  ALTA: 'Alta procesada - habilitado',
  NO_ALTA: 'Alta no realizada',          // RRHH decide no continuar con el alta
  RECHAZADO_RRHH: 'Rechazado RRHH',      // RRHH devuelve la ficha a Selección con motivo
  ASIGNADO: 'Asignado',
  NO_PRUEBA: 'No supera periodo de prueba',
  BAJA: 'Baja empresa',
  AUSENTE: 'Ausente notificado',
  DESPIDO: 'Despido procedente'
};
// Orden del funnel de Selección. Termina en el reconocimiento médico: de ahí
// pasa directo a RRHH.
const ETAPAS_CANDIDATURA = [
  ESTADOS.PRESELECCION, ESTADOS.COORD_ENTREVISTA, ESTADOS.ENTREVISTADO,
  ESTADOS.REC_MEDICO
];
const ETAPAS = { SELECCION: 'Selección', BOLT: 'BOLT', RRHH: 'RRHH', ADMINISTRACION: 'Administración', TRAFICO: 'Tráfico' };
// Leads de dónde viene la gente. Se guarda para poder analizar el origen luego.
// "Bolsa de Empleo (ETT)" es la vía por la que pueden salir contratos 40h/32h ETT.
const CANALES = [
  'InfoJobs', 'LinkedIn', 'Indeed', 'Milanuncios', 'Referido',
  'JobToday (HH)', 'InfoJobs (HH)', 'Publicación', 'Wallapop',
  'Bolsa de Empleo (ETT)', 'JobToday', 'Nextdoor', 'Redes Sociales', 'Otro'
];

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

// Contrato para la agenda (32h/40h, +ETT si el canal fue una ETT), a partir de la
// jornada y el canal de la ficha. Debe casar con CONTRATOS del planificador.
function contratoAgenda(t) {
  const h = String((t && t.jornada) || '').replace(/\D/g, '');
  const base = h === '32' ? '32h' : '40h';
  return /ETT/i.test((t && t.canal) || '') ? base + ' ETT' : base;
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
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:BJ`);
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
  // La hoja tiene el ancho que tenía el día que se creó. Al añadir columnas al
  // ticket, escribir más allá de ese ancho falla con "exceeds grid limits" — y
  // falla al GUARDAR, o sea después de que alguien haya rellenado la ficha
  // entera. Se ensancha antes; si ya cabe, no hace ninguna llamada.
  await ensureGrid(ID_PLANIFICADOR, HOJA, grid.length, N_COLS);
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!A1`, grid);
}

// Estados de la vacante ligada a un ticket (deben casar con ESTADO_VAC de vacantes.js).
const VAC = { PROCESO: 'En proceso de alta', ABIERTA: 'Abierta', CERRADA: 'Cerrada' };

/**
 * Sincroniza la vacante ligada al ticket con su fase: al llegar a RRHH se bloquea
 * ("En proceso de alta"); si el candidato se cae (rechazo/descarte) vuelve a
 * "Abierta". No bloquea el flujo del ticket si la actualización falla.
 */
async function marcarVacante(t, estado) {
  const vId = ((t && t.vacante) || '').toString().trim();
  if (!vId) return;
  try { await require('./vacantes').actualizarEstadoVacante(vId, estado); }
  catch (e) { console.error(`❌ [Tickets] vacante ${vId} → ${estado}: ${e.message}`); }
}

// --- operaciones ------------------------------------------------------------

/**
 * Crea o actualiza un ticket por teléfono. Solo toca los campos que llegan en
 * `datos` (upsert parcial). Un ticket nuevo entra en "En criba" / etapa Selección.
 */
/** Estructura base de un ticket/ficha vacío (todos los campos en su valor por defecto). */
function ticketVacio(tel) {
  return {
    id: tel, nombre: '', estado: ESTADOS.PRESELECCION, etapa: ETAPAS.SELECCION,
    canal: '', zona: '', experiencia: 'No', carne_vtc: 'No', prueba: 'No',
    medico: 'No', driver_uuid: '', responsable: '', notas: '',
    fecha_creacion: ahora(), fecha_apto: '', fecha_alta: '', fecha_habilitado: '',
    fecha_asignado: '', fecha_baja: '', motivo: '', fecha_deteccion: '',
    dni: '', email: '', contacto_emergencia: '', fecha_nacimiento: '',
    turno: '', iban: '', direccion: '', coordenadas: '', vacante: '', link_bolt: '',
    apellidos: '', codigo_postal: '', localidad: '', provincia: '', estado_civil: '',
    num_hijos: '', num_seg_social: '', tipo_carnet: '', carnet_expedicion: '',
    carnet_caducidad: '', fecha_inicio: '',
    doc_dni: '', doc_carnet: '', doc_bancario: '', doc_seg_social: '', doc_penales: '',
    tipo_contrato: '', jornada: '', ficha_pdf: '', nacionalidad: '', excel_alta: '',
    pin_ballenoil: '', doc_dni_reverso: '', doc_carnet_reverso: '', id_bolt: '', obs_ballenoil: ''
  };
}

async function guardarTicket(datos = {}) {
  const tel = normalizarTel(datos.tel || datos.telefono || datos.id);
  if (!telValido(tel)) throw new Error('Teléfono inválido: deben ser 9 dígitos');

  const { porTel, filas } = await leerTickets();
  let t = porTel.get(tel);
  if (!t) { t = ticketVacio(tel); porTel.set(tel, t); }

  // Campos de texto editables desde Selección.
  ['nombre', 'canal', 'zona', 'turno', 'responsable', 'notas', 'dni', 'email',
   'contacto_emergencia', 'fecha_nacimiento', 'iban', 'direccion', 'coordenadas',
   'vacante',
   'apellidos', 'codigo_postal', 'localidad', 'provincia', 'estado_civil',
   'num_hijos', 'num_seg_social', 'tipo_carnet', 'carnet_expedicion',
   'carnet_caducidad', 'fecha_inicio', 'tipo_contrato', 'jornada', 'nacionalidad',
   'sexo', 'centro_trabajo']
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
 * Aquí TERMINA Selección y la ficha pasa a RRHH. Solo se puede cuando el
 * candidato completó el funnel, que ahora acaba en el reconocimiento médico.
 *
 * Ya no se espera a BOLT en ningún caso: si la cuenta existe, se anota; y si no,
 * se pasa igual, porque esperar bloqueaba la contratación sin motivo. Lo que no
 * cambia es que sin cuenta de BOLT no se puede conducir: eso se ve en la ficha
 * y hay que resolverlo antes de que se incorpore.
 */
async function enviarABolt(tel, quien = {}) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  if (t.estado !== ESTADOS.REC_MEDICO) {
    throw new Error('Antes de pasar a RRHH hay que completar el funnel hasta "Reconocimiento médico"');
  }
  // La ficha (datos + documentos) debe estar completa: así RRHH la recibe entera.
  const faltan = faltantesAlta(t);
  if (faltan.length) {
    throw new Error('Antes de enviar a BOLT faltan datos de la ficha: ' + faltan.join(', '));
  }
  // LA FICHA. Aquí deja de ser un candidato y pasa a ser una persona del
  // sistema, en la misma tabla que el resto de la plantilla.
  //
  // `realizar` decide solo si es un alta nueva o una restauración: si esta
  // persona ya trabajó aquí, se le abre un periodo más sobre su ficha de
  // siempre en vez de crear una segunda.
  //
  // Si falla, la transición NO sigue. Es preferible que se quede en Selección y
  // se reintente a que pase a RRHH sin ficha, que es un hueco que nadie ve
  // hasta que hay que planificarle.
  let ficha = null;
  if (!t.conductor_id) {
    ficha = await require('./repo/alta').realizar(fichaDeTicket(t), quien);
    t.conductor_id = String(ficha.id);
  }

  // Con qué cuenta de BOLT se ha quedado, para anotarla en el ticket.
  let enBolt = null;
  try {
    const s = await require('./repo/alta').porTelefono(tel);
    if (s.bolt) enBolt = { driver_uuid: s.bolt.uuid, nombre: s.bolt.nombre };
  } catch (_) { /* informativo: la ficha ya está creada */ }

  if (enBolt) {
    // No hay que crearlo en BOLT: va DIRECTO a RRHH (solo hay que activarlo en la
    // plataforma y darle el alta en Seguridad Social). NO pasa por "Pendiente BOLT".
    t.driver_uuid = enBolt.driver_uuid || t.driver_uuid || '';
    if (!t.nombre && enBolt.nombre) t.nombre = enBolt.nombre;
    // El ID_BOLT (nombre completo tal como sale en BOLT) se captura AQUÍ, cuando el
    // padrón sí lo tiene, para no depender de una re-búsqueda que podría fallar.
    if (enBolt.nombre) t.id_bolt = enBolt.nombre;
    t.estado = ESTADOS.APROBADO_BOLT;
    t.etapa = ETAPAS.RRHH;
    t.fecha_apto = ahora();
    t.fecha_deteccion = ahora();
    await guardarTodos(porTel, filas);
    await marcarVacante(t, VAC.PROCESO);   // su vacante queda bloqueada mientras se tramita
    return t;
  }

  // Conductor NUEVO en BOLT: TAMPOCO se espera. Pasa directo a RRHH sin cuenta.
  // El enlace con BOLT se hace despues desde el cazamiento, cuando alguien elija
  // su ID entre los libres: esperar bloqueaba la contratacion sin motivo, y los
  // ETT entran antes de existir en BOLT.
  t.estado = ESTADOS.LISTO_RRHH;
  t.etapa = ETAPAS.RRHH;
  t.fecha_apto = ahora();
  await guardarTodos(porTel, filas);
  await marcarVacante(t, VAC.PROCESO);
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
  const detectadosTk = [];

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
    if (d.nombre) tk.id_bolt = d.nombre;   // captura el ID_BOLT (nombre completo de BOLT) al detectarlo
    detectados.push({ tel: tk.id, nombre: tk.nombre, driver_uuid: tk.driver_uuid });
    detectadosTk.push(tk);
  });

  if (detectados.length) {
    await guardarTodos(porTel, filas);
    for (const tk of detectadosTk) await marcarVacante(tk, VAC.PROCESO);   // su vacante se bloquea
  }
  return { detectados, total: detectados.length };
}

/**
 * Devuelve una ficha a Selección, al último paso del funnel. Se usa siempre que
 * una ficha se DEVUELVE desde cualquier punto del proceso: se reabre para
 * revisar, corregir y volver a enviar. El motivo queda anotado en las notas.
 */
async function devolverASeleccion(tel, motivo) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  t.estado = ESTADOS.REC_MEDICO;
  t.etapa = ETAPAS.SELECCION;
  const nota = (motivo || '').toString().trim();
  if (nota) t.notas = t.notas ? `${t.notas}\n[Devuelto ${ahora()}] ${nota}` : `[Devuelto ${ahora()}] ${nota}`;
  t.fecha_apto = '';   // se reabre en Selección; se re-sella al reenviar a BOLT
  await guardarTodos(porTel, filas);
  await marcarVacante(t, VAC.ABIERTA);   // nadie se colocó: la vacante vuelve a estar disponible
  return t;
}

/** BOLT rechazó al candidato: vuelve a Selección para corregir y reintentar. */
async function marcarRechazadoBolt(tel, motivo) {
  return devolverASeleccion(tel, 'Rechazado en BOLT' + (motivo ? `: ${motivo}` : ''));
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
  await marcarVacante(t, VAC.ABIERTA);   // el candidato se descarta: la vacante vuelve a estar disponible
  return t;
}

/**
 * RRHH tramita el alta: registra la fecha del alta en Seguridad Social y la fecha
 * desde la que el conductor queda habilitado. El HANDOFF al planificador YA NO se
 * hace aquí: la ficha pasa a ADMINISTRACIÓN para que cree el PIN de Ballenoil
 * (último paso). Solo al guardar ese PIN se crea la ficha en la agenda.
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

  // No se puede dar el alta si la ficha no ha ido antes en un Excel de altas: así
  // RRHH controla que no se repitan altas.
  if (!t.excel_alta) {
    throw new Error('Esta ficha aún no está en ningún Excel de altas. Inclúyela primero en un Excel (RRHH) y luego procesa el alta.');
  }

  // Candado de seguridad: si el conductor no está ACTIVO en BOLT, RRHH NO debe
  // darlo de alta en la Seguridad Social (empezaría a cobrar sin poder trabajar).
  // Pasa sobre todo con reincorporaciones (hay que activarlos a mano en BOLT).
  let boltEstado = '';
  try {
    const { db } = await leerPadron();
    let d = t.driver_uuid ? db.get(t.driver_uuid) : null;
    if (!d) { try { d = await buscarPorTelefono(tel); } catch (_) {} }
    if (d) boltEstado = (d.state || d.estado || '').toString().toLowerCase();
  } catch (_) { /* si el padrón falla, se sigue sin comprobación */ }

  if (boltEstado && boltEstado !== 'active') {
    throw new Error(`El conductor aún no está ACTIVO en BOLT (estado: ${boltEstado}). `
      + 'Actívalo en BOLT antes de procesar el alta — si no, cobraría sin poder trabajar.');
  }

  if (!(t.nombre || '').trim()) throw new Error('El conductor no tiene nombre para la ficha');

  // Se registra el alta, pero la ficha NO va aún al planificador: pasa a
  // Administración para crear el PIN de Ballenoil.
  t.estado = ESTADOS.PENDIENTE_PIN;
  t.etapa = ETAPAS.ADMINISTRACION;
  t.fecha_alta = fechaAlta;
  t.fecha_habilitado = fechaHab;
  await guardarTodos(porTel, filas);
  return t;
}

/**
 * ADMINISTRACIÓN crea el PIN de Ballenoil (tarjeta de combustible) — ÚLTIMO paso
 * del alta. Con el nombre en Ballenoil (el "ID de Ballenoil"), el teléfono y el
 * correo de la ficha, Administración genera el PIN en Ballenoil y lo guarda aquí.
 * Recién entonces se hace el HANDOFF al planificador: se crea la ficha en
 * AGENDA_V2 como "Pendiente Asignar" (reutiliza crearConductor). El ID_BOLT de la
 * agenda = el nombre de Bolt del padrón; la FECHA_ALTA de la agenda = la fecha de
 * habilitación. Primero se crea en la agenda y solo si eso va bien se guarda el
 * PIN y se avanza el ticket a Tráfico.
 */
async function crearPinAdmin(tel, pin, idBolt, obsBallenoil) {
  tel = normalizarTel(tel);
  pin = (pin == null ? '' : pin).toString().trim();
  if (!pin) throw new Error('Falta el PIN de Ballenoil');
  const obsBall = (obsBallenoil == null ? '' : obsBallenoil).toString().trim();

  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  if (t.etapa !== ETAPAS.ADMINISTRACION) throw new Error('Esta ficha no está en Administración');

  // ID_BOLT (nombre completo tal como sale en BOLT) por orden de fiabilidad:
  //  1) el que confirma Administración,  2) el capturado al detectarlo en BOLT,
  //  3) una re-búsqueda en el padrón (por driver_uuid o teléfono).
  let boltNombre = (idBolt == null ? '' : idBolt).toString().trim() || (t.id_bolt || '').trim();
  if (!boltNombre) {
    try {
      const { db } = await leerPadron();
      let d = t.driver_uuid ? db.get(t.driver_uuid) : null;
      if (!d) { try { d = await buscarPorTelefono(tel); } catch (_) {} }
      if (d) boltNombre = (d.nombre || '').trim();
    } catch (_) { /* si el padrón falla, se sigue sin ID_BOLT */ }
  }
  // El ID_BOLT es obligatorio: el planificador enlaza a los conductores por él, así
  // que sin él la ficha llegaría "coja" a la agenda. Administración lo confirma.
  if (!boltNombre) {
    throw new Error('Falta el nombre tal como sale en BOLT (será el ID del conductor en la agenda). Escríbelo en el campo "Nombre en BOLT".');
  }
  const nombre = boltNombre;

  const obs = [
    t.fecha_alta ? `Alta RRHH ${t.fecha_alta}` : '',
    `PIN Ballenoil ${pin}`,
    obsBall ? `Obs. Ballenoil: ${obsBall}` : '',
    t.canal ? `Canal: ${t.canal}` : '',
    t.email ? `Email: ${t.email}` : '',
    t.iban ? `IBAN: ${t.iban}` : '',
    t.fecha_nacimiento ? `Nac.: ${t.fecha_nacimiento}` : ''
  ].filter(Boolean).join(' · ');

  // Solo se pasan campos con valor (validarCampo del planificador rechaza vacíos
  // en turno/coordenadas). FECHA_ALTA de la agenda = fecha de habilitación.
  const datosAgenda = {
    id: boltNombre || '', nombre, telefono: tel,
    fechaAlta: t.fecha_habilitado || t.fecha_alta, observaciones: obs
  };
  if (t.dni) datosAgenda.dni = t.dni;
  if (t.num_seg_social) datosAgenda.naf = t.num_seg_social;   // NAF = nº de la Seguridad Social
  if (t.contacto_emergencia) datosAgenda.telEmergencia = t.contacto_emergencia;
  if (t.turno) datosAgenda.turno = t.turno;                   // Día / Noche / TodoTurno
  const contrato = contratoAgenda(t);                          // 32h / 40h (+ ETT)
  if (contrato) datosAgenda.contrato = contrato;
  if (t.direccion) datosAgenda.direccion = t.direccion;
  if (t.coordenadas) datosAgenda.coordenadas = t.coordenadas;

  try {
    await crearConductor(datosAgenda);
  } catch (e) {
    const m = e.message || '';
    // Duplicado (mismo ID_BOLT o DNI, o archivado en OUT): no se crea la ficha.
    // Se avisa CLARO y NO se avanza el ticket, para no dejar el alta a medias.
    if (/Ya hay un conductor|está archivado/i.test(m)) {
      throw new Error(m + ' · Si es una ficha de prueba, bórrala de AGENDA_V2 '
        + '(y de CONDUCTORES_OUT si estaba archivada) y reintenta.');
    }
    throw e;
  }

  t.pin_ballenoil = pin;
  t.id_bolt = boltNombre;   // deja registrado el ID_BOLT definitivo que fue a la agenda
  t.obs_ballenoil = obsBall;
  t.estado = ESTADOS.ALTA;
  t.etapa = ETAPAS.TRAFICO;
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
  await marcarVacante(t, VAC.ABIERTA);   // no se colocó a nadie: la vacante vuelve a estar disponible
  return t;
}

/**
 * RRHH devuelve la ficha a Selección por algún inconveniente: pasa a "Rechazado
 * RRHH" (etapa Selección) con el motivo, para que Selección sepa por qué volvió y
 * pueda corregir y reenviar.
 */
async function devolverRRHH(tel, motivo) {
  tel = normalizarTel(tel);
  const { porTel, filas } = await leerTickets();
  const t = porTel.get(tel);
  if (!t) throw new Error('No existe un ticket con ese teléfono');
  t.estado = ESTADOS.RECHAZADO_RRHH;
  t.etapa = ETAPAS.SELECCION;
  t.motivo = (motivo || '').toString().trim() || 'Devuelto por RRHH';
  t.notas = t.notas ? `${t.notas}\n[Devuelto por RRHH ${ahora()}] ${t.motivo}` : `[Devuelto por RRHH ${ahora()}] ${t.motivo}`;
  await guardarTodos(porTel, filas);
  await marcarVacante(t, VAC.ABIERTA);   // devuelta a Selección: la vacante vuelve a estar disponible
  return t;
}

// Índice de columna 0-based → letra(s) de Sheets (0→A, 26→AA, 42→AQ…).
function idxACol(n) {
  let s = '';
  for (n = Number(n); n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

/**
 * Escribe SOLO una celda del ticket (localizado por teléfono). Es clave que sea
 * una escritura puntual y no una reescritura de toda la hoja: así varias
 * escrituras a la vez no se pisan entre sí ni revierten otras columnas con una
 * lectura antigua. `campo` es una clave de COL.
 */
async function guardarCelda(tel, campo, valor) {
  tel = normalizarTel(tel);
  if (!(campo in COL)) throw new Error('Campo no válido: ' + campo);
  await ensureSheet(ID_PLANIFICADOR, HOJA);
  const colA = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:A`);
  let fila = -1;
  for (let i = 1; i < colA.length; i++) {
    if (normalizarTel((colA[i] || [])[0]) === tel) { fila = i + 1; break; }   // 1-based
  }
  if (fila === -1) throw new Error('No existe un ticket con ese teléfono');
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!${idxACol(COL[campo])}${fila}`, [[valor == null ? '' : valor]]);
  return { tel, campo, fila };
}

/**
 * Guarda/actualiza el PIN de Ballenoil por TELÉFONO para CUALQUIER conductor (no solo
 * los del funnel de selección). Si no tiene ficha, crea una mínima FUERA del funnel
 * (etapa TRÁFICO) solo para almacenar el PIN, así el bot puede entregarlo al pulsar
 * "VER PIN BALLENOIL". No re-crea nada en la agenda: es un upsert del PIN.
 */
async function guardarPinConductor(tel, pin, nombre, obs) {
  tel = normalizarTel(tel);
  if (!telValido(tel)) throw new Error('Teléfono inválido: deben ser 9 dígitos');
  pin = (pin == null ? '' : pin).toString().trim();
  const { porTel, filas } = await leerTickets();
  let t = porTel.get(tel);
  if (!t) {
    t = ticketVacio(tel);
    t.etapa = ETAPAS.TRAFICO;   // fuera del funnel de selección: la ficha solo guarda el PIN
    porTel.set(tel, t);
  }
  t.pin_ballenoil = pin;
  // La observación solo se toca si viene: así guardar el PIN a secas no borra la nota.
  if (obs != null) t.obs_ballenoil = obs.toString();
  const nom = (nombre || '').toString().trim();
  if (nom && !t.id_bolt) t.id_bolt = nom;
  if (nom && !t.nombre) t.nombre = nom;
  await guardarTodos(porTel, filas);
  return t;
}

/** Guarda (o quita) el enlace de un documento. `tipo` es el `key` de DOCUMENTOS. */
async function guardarDocumento(tel, tipo, doc) {
  const def = DOCUMENTOS.find(d => d.key === tipo);
  if (!def) throw new Error('Tipo de documento no válido: ' + tipo);
  return guardarCelda(tel, def.col, doc ? JSON.stringify(doc) : '');
}

/** Devuelve el ticket como objeto (o null) por teléfono. */
async function leerTicket(tel) {
  const { porTel } = await leerTickets();
  return porTel.get(normalizarTel(tel)) || null;
}

/** Parsea la celda de un documento ({id, link, nombre, mime}) o null. */
function parseDoc(valor) {
  if (!valor) return null;
  try { return JSON.parse(valor); } catch (_) { return null; }
}

// ── Fichas de conductores YA ACTIVOS (creadas desde la agenda) ──────────────
// Campos que se traen de la agenda al crear la ficha; el resto queda vacío para
// completarlo luego. La ficha NO entra en el funnel de Selección (queda Asignado).
const CAMPOS_DESDE_AGENDA = ['nombre', 'apellidos', 'dni', 'id_bolt', 'num_seg_social',
  'turno', 'jornada', 'zona', 'direccion', 'canal', 'fecha_alta'];

function rellenarFicha(t, datos) {
  t.estado = ESTADOS.ASIGNADO;   // ya es conductor, no candidato → no sale en Selección
  t.etapa = ETAPAS.TRAFICO;
  CAMPOS_DESDE_AGENDA.forEach(k => { if (datos[k] != null && String(datos[k]).trim()) t[k] = String(datos[k]).trim(); });
  return t;
}

/** Busca un ticket/ficha por su ID_BOLT (o null). */
async function buscarPorIdBolt(idBolt) {
  const clave = String(idBolt || '').trim().toLowerCase();
  if (!clave) return null;
  const { lista } = await leerTickets();
  return (lista || []).find(t => String(t.id_bolt || '').trim().toLowerCase() === clave) || null;
}

/** Crea la ficha de UN conductor activo (si no existe ya por teléfono). Devuelve el ticket. */
async function crearFichaConductor(datos = {}) {
  const tel = normalizarTel(datos.tel || datos.telefono);
  if (!telValido(tel)) throw new Error('El conductor no tiene teléfono válido (9 dígitos)');
  const { porTel, filas } = await leerTickets();
  if (porTel.has(tel)) return porTel.get(tel);
  const t = rellenarFicha(ticketVacio(tel), datos);
  porTel.set(tel, t);
  await guardarTodos(porTel, filas);
  return t;
}

/**
 * Crea EN LOTE (una sola escritura) las fichas que falten. Se salta las que ya
 * existen (por teléfono) y devuelve aparte las que no tienen teléfono válido.
 */
async function crearFichasConductores(listaDatos = []) {
  const { porTel, filas } = await leerTickets();
  let creadas = 0;
  const sinTelefono = [];
  for (const datos of (listaDatos || [])) {
    const tel = normalizarTel(datos.tel || datos.telefono);
    if (!telValido(tel)) { sinTelefono.push(datos.nombre || datos.id_bolt || '(sin nombre)'); continue; }
    if (porTel.has(tel)) continue;
    porTel.set(tel, rellenarFicha(ticketVacio(tel), datos));
    creadas++;
  }
  if (creadas) await guardarTodos(porTel, filas);
  return { creadas, sinTelefono };
}

module.exports = {
  leerTickets, leerTicket, guardarTicket, cambiarEtapaCandidatura, enviarABolt, descartar,
  conciliarTicketsBolt, marcarRechazadoBolt, devolverASeleccion,
  procesarAltaRRHH, crearPinAdmin, noContinuarRRHH, devolverRRHH,
  guardarDocumento, guardarCelda, guardarPinConductor, parseDoc, faltantesAlta,
  buscarPorIdBolt, crearFichaConductor, crearFichasConductores,
  normalizarTel, telValido, contratoAgenda, ESTADOS, ETAPAS, ETAPAS_CANDIDATURA, CANALES, COL, DOCUMENTOS, REQUERIDOS_ALTA
};
