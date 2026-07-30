// ============================================================
// PETICIONES — Tráfico solicita · RRHH aprueba / rechaza / aplica directo
// ============================================================
// Bajas y ausencias (vacaciones / baja médica / permiso) NO se tocan a mano en la
// agenda. Hay dos caminos:
//   · Tráfico crea una PETICIÓN (queda Pendiente) → RRHH la aprueba o la rechaza.
//   · RRHH la crea y la aplica directamente (sin pasar por Tráfico).
// TODAS las peticiones llevan rango Desde–Hasta (lo pone RRHH). Al aplicarse:
//   · Baja      → el conductor pasa a "Baja Empresa" (se archiva en OUT).
//   · Ausencia  → estado de la ausencia AL MOMENTO + reincorporación (Hasta+1) +
//                 letras (V/B/P) en la bitácora del rango.
// Cada resolución avisa por correo a Tráfico (stub por ahora). El responsable
// (quién solicita y quién de RRHH resuelve) se digita a mano mientras no haya login.

const { readSheet, writeSheetRaw, ensureSheet } = require('./sheets');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'PETICIONES';
const TZ = 'Europe/Madrid';

const COL = {
  id: 0, fecha_solicitud: 1, solicitante: 2, tipo: 3, id_conductor: 4, conductor: 5,
  desde: 6, hasta: 7, motivo: 8, estado: 9, fecha_resolucion: 10, motivo_rechazo: 11,
  resuelto_por: 12   // responsable de RRHH que aprobó/rechazó/aplicó (a mano, sin login)
};
const N_COLS = 13;
const CABECERA = ['id', 'fecha_solicitud', 'solicitante', 'tipo', 'id_conductor', 'conductor',
  'desde', 'hasta', 'motivo', 'estado', 'fecha_resolucion', 'motivo_rechazo', 'resuelto_por'];

const TIPOS = ['Baja Empresa', 'Vacaciones', 'Baja Médica', 'Permiso Retribuido', 'Reingreso'];
// El reingreso restaura desde el archivo; no cambia estado ni escribe letras.
const SIN_FECHAS = ['Reingreso'];
const LETRA = { 'Vacaciones': 'V', 'Baja Médica': 'B', 'Permiso Retribuido': 'P' };  // ausencias
// Tipo de petición → estado en la agenda (debe casar con ESTADOS_CONDUCTOR).
const ESTADO_AGENDA = {
  'Baja Empresa': 'Baja Empresa', 'Vacaciones': 'Vacaciones',
  'Baja Médica': 'Baja Médica', 'Permiso Retribuido': 'Permiso Retribuido'
};
const ESTADO = { PENDIENTE: 'Pendiente', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' };

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

/** dd/mm/aaaa + n días → dd/mm/aaaa (''  si no casa). */
function sumarDias(fechaStr, n) {
  const m = String(fechaStr || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1] + n, 12));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function filaAObjeto(row) {
  const o = {};
  for (const [k, i] of Object.entries(COL)) o[k] = (row[i] == null ? '' : row[i]).toString();
  return o;
}
function objetoAFila(o) {
  const f = new Array(N_COLS).fill('');
  for (const [k, i] of Object.entries(COL)) f[i] = o[k] == null ? '' : o[k];
  return f;
}

async function leerPeticiones() {
  await ensureSheet(ID_PLANIFICADOR, HOJA);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:M`);
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const id = (filas[i][COL.id] || '').toString().trim();
    if (!id) continue;
    lista.push(filaAObjeto(filas[i]));
  }
  return { lista, filas: filas.length };
}

async function guardarTodas(lista, filasViejas) {
  const grid = [CABECERA, ...lista.map(objetoAFila)];
  while (grid.length < filasViejas) grid.push(new Array(N_COLS).fill(''));
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!A1`, grid);
}

/** Valida y normaliza los datos base de una petición (tipo, conductor, fechas). */
function validarBase(datos) {
  const tipo = TIPOS.includes(datos.tipo) ? datos.tipo : null;
  if (!tipo) throw new Error('Tipo de petición no válido');
  const id_conductor = (datos.id_conductor || '').toString().trim();
  if (!id_conductor) throw new Error('Falta el conductor');
  // El reingreso es inmediato, sin rango de fechas; el resto sí lo lleva.
  if (SIN_FECHAS.includes(tipo)) return { tipo, id_conductor, desde: '', hasta: '' };
  const desde = (datos.desde || '').toString().trim();
  const hasta = (datos.hasta || '').toString().trim();
  if (!desde || !hasta) throw new Error('Faltan las fechas Desde/Hasta');
  return { tipo, id_conductor, desde, hasta };
}

/**
 * Aplica el efecto de una petición (ya con sus fechas puestas): cambia el estado
 * del conductor AL MOMENTO y, si es ausencia, fija la reincorporación (Hasta+1) y
 * rellena las letras (V/B/P) en la bitácora del rango Desde–Hasta.
 *   · Baja     → "Baja Empresa" (se archiva en OUT).
 *   · Ausencia → estado de la ausencia + reincorporación + letras.
 */
async function aplicarEfecto(pet) {
  const planif = require('./planificadorV2');

  if (pet.tipo === 'Reingreso') {
    // Reingreso: el conductor archivado vuelve a la agenda como "Pendiente Asignar".
    await planif.restaurarDesdeOut([pet.id_conductor]);
    return;
  }
  const estadoAgenda = ESTADO_AGENDA[pet.tipo];
  if (pet.tipo === 'Baja Empresa') {
    // Baja de empresa: cambia el estado y se archiva. Las fechas quedan de registro.
    await planif.cambiarEstados([{ id: pet.id_conductor, estado: estadoAgenda }]);
    return;
  }
  // Ausencia: el sistema fija la reincorporación (Hasta+1) — ya no se teclea a mano
  // en la agenda — y rellena las letras de la bitácora en el rango.
  try { await planif.actualizarConductor(pet.id_conductor, { reincorporacion: sumarDias(pet.hasta, 1) }); } catch (_) {}
  const vf = require('./vistaFinal');
  await vf.escribirLetrasRango(pet.id_conductor, LETRA[pet.tipo], pet.desde, pet.hasta);
  // El estado cambia el DÍA en que empieza la ausencia (o al momento si Desde es
  // hoy): aplicarAusenciasAutomaticas mira la letra de HOY. Antes de esa fecha la
  // bitácora ya queda marcada, pero la cobertura no saca al conductor todavía.
  try { await vf.aplicarAusenciasAutomaticas(); } catch (_) {}
}

function avisarTrafico(asunto, texto) {
  const { enviarCorreo, CORREO_TRAFICO } = require('./correo');
  enviarCorreo({ to: CORREO_TRAFICO, subject: asunto, text: texto }).catch(() => {});
}

/** Tráfico crea una petición: queda PENDIENTE hasta que RRHH la resuelve. */
async function crearPeticion(datos = {}) {
  const { tipo, id_conductor, desde, hasta } = validarBase(datos);
  // Sin login, el responsable que solicita se digita a mano y es obligatorio.
  const solicitante = (datos.solicitante || '').toString().trim();
  if (!solicitante) throw new Error('Falta el responsable que hace la petición');

  const { lista, filas } = await leerPeticiones();
  const pet = {
    id: 'P' + Date.now().toString(36),
    fecha_solicitud: ahora(),
    solicitante, tipo, id_conductor,
    conductor: (datos.conductor || '').toString().trim(),
    desde, hasta,
    motivo: (datos.motivo || '').toString().trim(),
    estado: ESTADO.PENDIENTE, fecha_resolucion: '', motivo_rechazo: '', resuelto_por: ''
  };
  lista.push(pet);
  await guardarTodas(lista, filas);
  return pet;
}

/**
 * RRHH aprueba una petición pendiente. Puede ajustar las fechas al confirmar.
 * Aplica el efecto al momento y avisa a Tráfico. `resuelto_por` obligatorio.
 */
async function aprobarPeticion(id, opciones = {}) {
  const responsable = (opciones.resuelto_por || '').toString().trim();
  if (!responsable) throw new Error('Falta el responsable de RRHH que aprueba');

  const { lista, filas } = await leerPeticiones();
  const pet = lista.find(p => p.id === id);
  if (!pet) throw new Error('No existe esa petición');
  if (pet.estado !== ESTADO.PENDIENTE) throw new Error('Esa petición ya está resuelta');

  // RRHH pone/ajusta las fechas (salvo el reingreso, que es inmediato sin rango).
  if (!SIN_FECHAS.includes(pet.tipo)) {
    const desde = (opciones.desde || pet.desde || '').toString().trim();
    const hasta = (opciones.hasta || pet.hasta || '').toString().trim();
    if (!desde || !hasta) throw new Error('Faltan las fechas Desde/Hasta para aprobar');
    pet.desde = desde; pet.hasta = hasta;
  }

  await aplicarEfecto(pet);

  pet.estado = ESTADO.APROBADA;
  pet.resuelto_por = responsable;
  pet.fecha_resolucion = ahora();
  await guardarTodas(lista, filas);

  const rango = pet.desde ? `\nDesde ${pet.desde} hasta ${pet.hasta}.` : '';
  avisarTrafico(
    `Petición APROBADA — ${pet.tipo} de ${pet.conductor}`,
    `RRHH (${responsable}) aprobó la ${pet.tipo} de ${pet.conductor}.${rango}`
  );
  return pet;
}

/** RRHH rechaza una petición pendiente. `resuelto_por` obligatorio; avisa a Tráfico. */
async function rechazarPeticion(id, motivo, resuelto_por) {
  const responsable = (resuelto_por || '').toString().trim();
  if (!responsable) throw new Error('Falta el responsable de RRHH que rechaza');

  const { lista, filas } = await leerPeticiones();
  const pet = lista.find(p => p.id === id);
  if (!pet) throw new Error('No existe esa petición');
  if (pet.estado !== ESTADO.PENDIENTE) throw new Error('Esa petición ya está resuelta');

  pet.estado = ESTADO.RECHAZADA;
  pet.motivo_rechazo = (motivo || '').toString().trim() || 'Rechazada por RRHH';
  pet.resuelto_por = responsable;
  pet.fecha_resolucion = ahora();
  await guardarTodas(lista, filas);

  avisarTrafico(
    `Petición RECHAZADA — ${pet.tipo} de ${pet.conductor}`,
    `RRHH (${responsable}) rechazó la ${pet.tipo} de ${pet.conductor}.\nMotivo: ${pet.motivo_rechazo}`
  );
  return pet;
}

/**
 * RRHH crea y aplica una petición directamente, sin pasar por Tráfico. Queda ya
 * APROBADA (solicitante = responsable = quién de RRHH la hace) y se aplica al momento.
 */
async function crearYAplicar(datos = {}) {
  const { tipo, id_conductor, desde, hasta } = validarBase(datos);
  const responsable = (datos.responsable || datos.resuelto_por || '').toString().trim();
  if (!responsable) throw new Error('Falta el responsable de RRHH');

  const { lista, filas } = await leerPeticiones();
  const pet = {
    id: 'P' + Date.now().toString(36),
    fecha_solicitud: ahora(),
    solicitante: responsable, tipo, id_conductor,
    conductor: (datos.conductor || '').toString().trim(),
    desde, hasta,
    motivo: (datos.motivo || '').toString().trim(),
    estado: ESTADO.APROBADA, fecha_resolucion: ahora(), motivo_rechazo: '', resuelto_por: responsable
  };

  // Se aplica ANTES de guardar la petición: si el efecto falla, no queda registrada
  // una aprobación que no se llegó a aplicar.
  await aplicarEfecto(pet);

  lista.push(pet);
  await guardarTodas(lista, filas);

  const rango = pet.desde ? `\nDesde ${pet.desde} hasta ${pet.hasta}.` : '';
  avisarTrafico(
    `RRHH aplicó ${pet.tipo} — ${pet.conductor}`,
    `RRHH (${responsable}) registró y aplicó la ${pet.tipo} de ${pet.conductor}.${rango}`
  );
  return pet;
}

module.exports = { leerPeticiones, crearPeticion, aprobarPeticion, rechazarPeticion, crearYAplicar, TIPOS, ESTADO };
