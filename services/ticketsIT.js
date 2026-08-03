// ============================================================
// TICKETS IT — ticketera interna de soporte / desarrollo
// ============================================================
// Cualquier usuario abre tickets desde "Soporte técnico" (bugs, requerimientos,
// mejoras…) y se guardan con su email/nombre/rol de sesión. El DESARROLLADOR los
// gestiona desde "Tickets Telecab" (solo él los ve). Esquema propio y fijo (lo
// controlamos nosotros), en la hoja TICKETS_IT del libro del planificador.
// Los adjuntos (pantallazos/documentos) van a Google Drive; aquí se guarda su
// enlace en una columna JSON.

const { readSheet, writeSheetRaw, appendRows, ensureSheet } = require('./sheets');
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');

const ID = SPREADSHEET_PLANIFICADOR;
const HOJA = 'TICKETS_IT';
const RANGO = `${HOJA}!A:N`;
const TZ = 'Europe/Madrid';

const COL = {
  id: 0, fecha_creacion: 1, solicitante_email: 2, solicitante_nombre: 3, solicitante_rol: 4,
  tipo: 5, prioridad: 6, titulo: 7, descripcion: 8, estado: 9, adjuntos: 10,
  notas_dev: 11, fecha_actualizacion: 12, fecha_resolucion: 13
};
const N_COLS = 14;
const CABECERA = ['ID', 'FECHA_CREACION', 'SOLICITANTE_EMAIL', 'SOLICITANTE_NOMBRE', 'SOLICITANTE_ROL',
  'TIPO', 'PRIORIDAD', 'TITULO', 'DESCRIPCION', 'ESTADO', 'ADJUNTOS', 'NOTAS_DEV', 'FECHA_ACTUALIZACION', 'FECHA_RESOLUCION'];

const TIPOS = ['Bug', 'Requerimiento', 'Mejora', 'Consulta', 'Otro'];
const PRIORIDADES = ['Baja', 'Media', 'Alta'];
const ESTADOS = ['Nuevo', 'En curso', 'Resuelto', 'Descartado'];
const CERRADOS = ['Resuelto', 'Descartado'];

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

function parseAdjuntos(v) { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }

function filaAObjeto(row, i) {
  const o = { _fila: i + 1 };
  for (const [k, ci] of Object.entries(COL)) o[k] = (row[ci] == null ? '' : row[ci]).toString();
  o.adjuntos = parseAdjuntos(row[COL.adjuntos]);
  return o;
}
function objetoAFila(o) {
  const f = new Array(N_COLS).fill('');
  for (const [k, ci] of Object.entries(COL)) f[ci] = o[k] == null ? '' : o[k];
  f[COL.adjuntos] = JSON.stringify(Array.isArray(o.adjuntos) ? o.adjuntos : []);
  return f;
}

async function leerFilas() {
  await ensureSheet(ID, HOJA);
  const filas = await readSheet(ID, RANGO);
  if (!filas.length) { await writeSheetRaw(ID, `${HOJA}!A1`, [CABECERA]); return []; }
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const id = (filas[i][COL.id] == null ? '' : filas[i][COL.id]).toString().trim();
    if (!id) continue;
    lista.push(filaAObjeto(filas[i], i));
  }
  return lista;
}

// Más nuevos primero (se añaden al final → mayor número de fila).
const ordenarNuevos = lista => lista.sort((a, b) => b._fila - a._fila);

async function leerTickets() { return ordenarNuevos(await leerFilas()); }

async function leerMisTickets(email) {
  const e = String(email || '').trim().toLowerCase();
  return ordenarNuevos((await leerFilas()).filter(t => (t.solicitante_email || '').toLowerCase() === e));
}

const nuevoId = () => 'IT-' + Date.now().toString(36);

/** Crea un ticket. `id` opcional (para poder subir adjuntos a su carpeta antes). */
async function crearTicket({ id, solicitante = {}, tipo, prioridad, titulo, descripcion, adjuntos } = {}) {
  const tit = String(titulo || '').trim();
  if (!tit) throw new Error('Falta el título del ticket');
  const o = {
    id: id || nuevoId(),
    fecha_creacion: ahora(),
    solicitante_email: String(solicitante.email || '').trim(),
    solicitante_nombre: String(solicitante.nombre || '').trim(),
    solicitante_rol: String(solicitante.rol || '').trim(),
    tipo: TIPOS.includes(tipo) ? tipo : 'Otro',
    prioridad: PRIORIDADES.includes(prioridad) ? prioridad : 'Media',
    titulo: tit,
    descripcion: String(descripcion || '').trim(),
    estado: 'Nuevo',
    adjuntos: Array.isArray(adjuntos) ? adjuntos : [],
    notas_dev: '', fecha_actualizacion: '', fecha_resolucion: ''
  };
  await ensureSheet(ID, HOJA);
  const filas = await readSheet(ID, RANGO);
  if (!filas.length) await writeSheetRaw(ID, `${HOJA}!A1`, [CABECERA]);
  await appendRows(ID, RANGO, [objetoAFila(o)]);
  return o;
}

/** Modifica un ticket existente (localiza la fila por ID y reescribe esa fila). */
async function actualizar(id, cambios) {
  const filas = await readSheet(ID, RANGO);
  let idx = -1;
  for (let i = 1; i < filas.length; i++) {
    if ((filas[i][COL.id] == null ? '' : filas[i][COL.id]).toString().trim() === id) { idx = i; break; }
  }
  if (idx < 0) throw new Error('No encuentro ese ticket');
  const o = filaAObjeto(filas[idx], idx);
  Object.assign(o, cambios);
  o.fecha_actualizacion = ahora();
  await writeSheetRaw(ID, `${HOJA}!A${idx + 1}`, [objetoAFila(o)]);
  return o;
}

async function cambiarEstado(id, estado) {
  if (!ESTADOS.includes(estado)) throw new Error('Estado no válido');
  return actualizar(id, { estado, fecha_resolucion: CERRADOS.includes(estado) ? ahora() : '' });
}

async function guardarNotas(id, notas) { return actualizar(id, { notas_dev: String(notas || '') }); }

async function guardarAdjuntos(id, adjuntos) { return actualizar(id, { adjuntos: Array.isArray(adjuntos) ? adjuntos : [] }); }

module.exports = {
  leerTickets, leerMisTickets, crearTicket, cambiarEstado, guardarNotas, guardarAdjuntos,
  nuevoId, TIPOS, PRIORIDADES, ESTADOS, HOJA
};
