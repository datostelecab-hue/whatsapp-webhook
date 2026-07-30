// ============================================================
// PETICIONES — Tráfico solicita, RRHH aprueba/rechaza
// ============================================================
// Tráfico no puede dar bajas ni ausencias (vacaciones / baja médica / permiso)
// por su cuenta: crea una PETICIÓN. RRHH la aprueba o la rechaza. Al aprobar:
//   · Baja      → el conductor pasa a "Baja Empresa" (se archiva en OUT).
//   · Ausencia  → se fija la fecha de reincorporación y botcito rellena las letras
//                 (V/B/P) en la bitácora del rango Desde–Hasta.
// En ambas resoluciones se avisa por correo a Tráfico (stub por ahora).

const { readSheet, writeSheetRaw, ensureSheet } = require('./sheets');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'PETICIONES';
const TZ = 'Europe/Madrid';

const COL = {
  id: 0, fecha_solicitud: 1, solicitante: 2, tipo: 3, id_conductor: 4, conductor: 5,
  desde: 6, hasta: 7, motivo: 8, estado: 9, fecha_resolucion: 10, motivo_rechazo: 11
};
const N_COLS = 12;
const CABECERA = ['id', 'fecha_solicitud', 'solicitante', 'tipo', 'id_conductor', 'conductor',
  'desde', 'hasta', 'motivo', 'estado', 'fecha_resolucion', 'motivo_rechazo'];

const TIPOS = ['Baja', 'Vacaciones', 'Baja Médica', 'Permiso Retribuido'];
const LETRA = { 'Vacaciones': 'V', 'Baja Médica': 'B', 'Permiso Retribuido': 'P' };  // ausencias
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
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:L`);
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

/** Tráfico crea una petición. */
async function crearPeticion(datos = {}) {
  const tipo = TIPOS.includes(datos.tipo) ? datos.tipo : null;
  if (!tipo) throw new Error('Tipo de petición no válido');
  const id_conductor = (datos.id_conductor || '').toString().trim();
  if (!id_conductor) throw new Error('Falta el conductor');
  const esAusencia = tipo !== 'Baja';
  if (esAusencia && (!datos.desde || !datos.hasta)) throw new Error('Faltan las fechas Desde/Hasta');

  const { lista, filas } = await leerPeticiones();
  const pet = {
    id: 'P' + Date.now().toString(36),
    fecha_solicitud: ahora(),
    solicitante: (datos.solicitante || 'Tráfico').toString().trim(),
    tipo, id_conductor,
    conductor: (datos.conductor || '').toString().trim(),
    desde: esAusencia ? (datos.desde || '').toString().trim() : '',
    hasta: esAusencia ? (datos.hasta || '').toString().trim() : '',
    motivo: (datos.motivo || '').toString().trim(),
    estado: ESTADO.PENDIENTE, fecha_resolucion: '', motivo_rechazo: ''
  };
  lista.push(pet);
  await guardarTodas(lista, filas);
  return pet;
}

/** RRHH rechaza: se avisa a Tráfico con el motivo. */
async function rechazarPeticion(id, motivo) {
  const { lista, filas } = await leerPeticiones();
  const pet = lista.find(p => p.id === id);
  if (!pet) throw new Error('No existe esa petición');
  if (pet.estado !== ESTADO.PENDIENTE) throw new Error('Esa petición ya está resuelta');

  pet.estado = ESTADO.RECHAZADA;
  pet.motivo_rechazo = (motivo || '').toString().trim() || 'Rechazada por RRHH';
  pet.fecha_resolucion = ahora();
  await guardarTodas(lista, filas);

  const { enviarCorreo, CORREO_TRAFICO } = require('./correo');
  enviarCorreo({
    to: CORREO_TRAFICO,
    subject: `Petición RECHAZADA — ${pet.tipo} de ${pet.conductor}`,
    text: `RRHH rechazó la petición de ${pet.tipo} para ${pet.conductor}.\nMotivo: ${pet.motivo_rechazo}`
  }).catch(() => {});
  return pet;
}

/**
 * RRHH aprueba. Puede ajustar las fechas Desde/Hasta al confirmar. Aplica el
 * efecto (archivo o ausencia) y avisa a Tráfico con las fechas.
 */
async function aprobarPeticion(id, opciones = {}) {
  const { lista, filas } = await leerPeticiones();
  const pet = lista.find(p => p.id === id);
  if (!pet) throw new Error('No existe esa petición');
  if (pet.estado !== ESTADO.PENDIENTE) throw new Error('Esa petición ya está resuelta');

  const planif = require('./planificadorV2');

  if (pet.tipo === 'Baja') {
    await planif.cambiarEstados([{ id: pet.id_conductor, estado: 'Baja Empresa' }]);
  } else {
    const desde = (opciones.desde || pet.desde || '').toString().trim();
    const hasta = (opciones.hasta || pet.hasta || '').toString().trim();
    if (!desde || !hasta) throw new Error('Faltan las fechas Desde/Hasta para aprobar');
    const letra = LETRA[pet.tipo];
    // Reincorporación = día siguiente al "hasta". Si no está en la agenda, se sigue.
    try { await planif.actualizarConductor(pet.id_conductor, { reincorporacion: sumarDias(hasta, 1) }); } catch (_) {}
    // botcito rellena la bitácora del rango aprobado.
    const vf = require('./vistaFinal');
    await vf.escribirLetrasRango(pet.id_conductor, letra, desde, hasta);
    // Si la ausencia ya está vigente hoy, fija el estado al momento.
    try { await vf.aplicarAusenciasAutomaticas(); } catch (_) {}
    pet.desde = desde; pet.hasta = hasta;
  }

  pet.estado = ESTADO.APROBADA;
  pet.fecha_resolucion = ahora();
  await guardarTodas(lista, filas);

  const { enviarCorreo, CORREO_TRAFICO } = require('./correo');
  const detalle = pet.tipo === 'Baja' ? '' : `\nDesde ${pet.desde} hasta ${pet.hasta}.`;
  enviarCorreo({
    to: CORREO_TRAFICO,
    subject: `Petición APROBADA — ${pet.tipo} de ${pet.conductor}`,
    text: `RRHH aprobó la petición de ${pet.tipo} para ${pet.conductor}.${detalle}`
  }).catch(() => {});
  return pet;
}

module.exports = { leerPeticiones, crearPeticion, aprobarPeticion, rechazarPeticion, TIPOS, ESTADO };
