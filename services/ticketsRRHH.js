// ============================================================
// TICKETERA RRHH — tickets que los conductores mandan por un Formulario
// ============================================================
// Viven en el MISMO libro que la agenda (SPREADSHEET_PLANIFICADOR):
//   · TICKETS_RRHH   → activos (bandeja de entrada)
//   · RESUELTOS_RRHH → archivo (al resolver, la fila se MUEVE aquí)
// Los dos esquemas NO son idénticos (la col 17 es "NUMERO DE DIAS" en TICKETS y
// "MATRICULA" en RESUELTOS), por eso todo se mapea POR NOMBRE DE CABECERA, nunca
// por posición. Cada tipo de gestión trae su info en DESCRIPCION_COMPILADA.
//
// Vacaciones / Baja / Permiso llevan AFECTA_PLANNING = SÍ: al aprobarlas se aplican
// al planificador reutilizando Peticiones (crearYAplicar), que libera la plaza y
// escribe las letras V/B/P. El conductor se resuelve por ID_BOLT y, si el formulario
// no lo identificó (SIN_IDENTIFICAR), por DNI o teléfono contra el tablero.

const { readSheet, writeMany, appendRows, deleteRows, getSheetIds, ensureSheet } = require('./sheets');
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');

const ID = SPREADSHEET_PLANIFICADOR;
const HOJA_T = 'TICKETS_RRHH';
const HOJA_R = 'RESUELTOS_RRHH';
const RANGO = 'A:Z';
const TZ = 'Europe/Madrid';

// Subtipo del formulario → tipo de petición del planificador (Peticiones).
const MAPA_PLANNING = { VACACIONES: 'Vacaciones', BAJA_AUSENCIA: 'Baja Médica', PERMISO_RETRIBUIDO: 'Permiso Retribuido' };
// Estados con los que se puede archivar un ticket.
const ESTADOS_RESOLUCION = ['Ejecutado', 'Aprobado', 'Rechazado', 'No procede'];

// Cabecera "NUMERO DE DIAS" → numero_de_dias, "AFECTA_PLANNING" → afecta_planning, etc.
const slug = h => String(h || '').trim().toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// 0-based → letra de columna (0→A, 25→Z).
function colLetra(i) { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

function parseFechaHora(s) {
  const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) : null;
}
// Horas entre creación y resolución, con coma decimal como en la hoja ("165,4").
function horasEntre(a, b) {
  const ta = parseFechaHora(a), tb = parseFechaHora(b);
  if (ta == null || tb == null) return '';
  return (Math.max(0, tb - ta) / 3600000).toFixed(1).replace('.', ',');
}
// "01/08/2026 00:00" → "01/08/2026" (Peticiones trabaja con dd/mm/aaaa sin hora).
function soloFecha(s) { const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : ''; }

// ---- Lectura ----
async function leerHoja(hoja) {
  await ensureSheet(ID, hoja);
  const filas = await readSheet(ID, `${hoja}!${RANGO}`);
  if (!filas.length) return { headers: [], idx: {}, tickets: [] };
  const headers = filas[0].map(h => String(h || '').trim());
  const idx = {};
  headers.forEach((h, i) => { const k = slug(h); if (k && !(k in idx)) idx[k] = i; });
  const tickets = [];
  for (let i = 1; i < filas.length; i++) {
    const row = filas[i];
    const id = (row[idx.ticket_id] == null ? '' : row[idx.ticket_id]).toString().trim();
    if (!id) continue;
    const o = { _fila: i + 1 };
    for (const [k, ci] of Object.entries(idx)) o[k] = (row[ci] == null ? '' : row[ci]).toString();
    tickets.push(o);
  }
  return { headers, idx, tickets };
}

async function leerTicketera() {
  const [t, r] = await Promise.all([
    leerHoja(HOJA_T),
    leerHoja(HOJA_R).catch(() => ({ headers: [], idx: {}, tickets: [] }))
  ]);
  return { pendientes: t.tickets, resueltos: r.tickets, headersT: t.headers, headersR: r.headers };
}

// ---- Escritura por cabecera ----
async function actualizar(hoja, idx, fila, cambios) {
  const datos = [];
  for (const [k, v] of Object.entries(cambios)) {
    if (!(k in idx)) continue;   // esa hoja no tiene esa columna → se ignora
    datos.push({ range: `${hoja}!${colLetra(idx[k])}${fila}`, values: [[v == null ? '' : v]] });
  }
  if (datos.length) await writeMany(ID, datos);
}

async function buscarEnTickets(ticketId) {
  const { idx, tickets } = await leerHoja(HOJA_T);
  const t = tickets.find(x => x.ticket_id === ticketId);
  if (!t) throw new Error('No encuentro ese ticket (¿ya está resuelto?)');
  return { t, idx };
}

// ---- Acciones sobre un ticket activo ----
async function asignar(ticketId, email) {
  const email2 = (email || '').toString().trim();
  if (!email2) throw new Error('Falta el correo del responsable');
  const { t, idx } = await buscarEnTickets(ticketId);
  await actualizar(HOJA_T, idx, t._fila, { responsable_email: email2, fecha_asignacion: t.fecha_asignacion || ahora() });
  return { ok: true };
}

async function cambiarEstado(ticketId, estado) {
  const estado2 = (estado || '').toString().trim();
  if (!estado2) throw new Error('Falta el estado');
  const { t, idx } = await buscarEnTickets(ticketId);
  await actualizar(HOJA_T, idx, t._fila, { estado: estado2 });
  return { ok: true };
}

async function guardarObservaciones(ticketId, texto) {
  const { t, idx } = await buscarEnTickets(ticketId);
  await actualizar(HOJA_T, idx, t._fila, { observaciones_gestion: (texto || '').toString() });
  return { ok: true };
}

/**
 * Resuelve un ticket: rellena los campos de resolución (fecha, quién lo resolvió,
 * horas) y MUEVE la fila a RESUELTOS_RRHH (se añade allí y se borra de TICKETS_RRHH).
 * Se añade primero al archivo y luego se borra el original: si algo falla, el ticket
 * no se pierde.
 */
async function resolver(ticketId, { usuario, estado, observaciones } = {}) {
  const tk = await leerHoja(HOJA_T);
  const t = tk.tickets.find(x => x.ticket_id === ticketId);
  if (!t) throw new Error('No encuentro ese ticket (¿ya está resuelto?)');
  const rz = await leerHoja(HOJA_R);
  if (!rz.headers.length) throw new Error('La hoja RESUELTOS_RRHH no tiene cabecera');

  const fechaRes = ahora();
  const merged = {
    ...t,
    estado: (estado || 'Ejecutado').toString().trim(),
    usuario_resolucion: (usuario || '').toString().trim(),
    fecha_resolucion: fechaRes,
    tiempo_resolucion_horas: horasEntre(t.fecha_creacion || t.marca_temporal, fechaRes)
  };
  if (observaciones != null && observaciones !== '') merged.observaciones_gestion = observaciones.toString();

  // La fila para RESUELTOS se arma EN EL ORDEN de la cabecera de RESUELTOS (mapeo por
  // nombre): así la diferencia de esquema (MATRICULA vs NUMERO DE DIAS) no descoloca nada.
  // Si ya estaba archivado (reintento tras un fallo a mitad), no se duplica.
  const yaArchivado = rz.tickets.some(x => x.ticket_id === ticketId);
  if (!yaArchivado) {
    const filaR = rz.headers.map(h => { const k = slug(h); return merged[k] != null ? merged[k] : ''; });
    await appendRows(ID, `${HOJA_R}!${RANGO}`, [filaR]);
  }

  // Se re-localiza la fila por TICKET_ID justo antes de borrar: entre la lectura y
  // ahora otra operación pudo mover filas, y borrar por número viejo tumbaría la que
  // no es. Si ya no está, se da por hecho.
  const rel = await leerHoja(HOJA_T);
  const actual = rel.tickets.find(x => x.ticket_id === ticketId);
  if (actual) {
    const ids = await getSheetIds(ID);
    const idHoja = ids[HOJA_T];
    if (idHoja == null) throw new Error('No encuentro la hoja TICKETS_RRHH para borrar la fila');
    await deleteRows(ID, idHoja, [actual._fila]);
  }
  return { ok: true, estado: merged.estado };
}

// ---- Enganche con el planificador (Peticiones) ----
/**
 * Resuelve el conductor de un ticket contra el tablero: por ID_BOLT y, si el
 * formulario no lo identificó (SIN_IDENTIFICAR / vacío), por DNI o por teléfono.
 * Devuelve { idBolt, nombre } o null.
 */
async function resolverConductor(t) {
  const planif = require('./planificadorV2');
  const norm = s => String(s || '').trim().toLowerCase();
  const tel9 = s => String(s || '').replace(/\D/g, '').slice(-9);
  const tablero = await planif.leerTablero().catch(() => null);
  const conductores = (tablero && tablero.conductores) || [];

  const idb = norm(t.id_bolt), dni = norm(t.dni), tel = tel9(t.telefono);
  let c = null;
  if (idb && idb !== 'sin_identificar') c = conductores.find(x => x.idBolt && norm(x.idBolt) === idb);
  if (!c && dni) c = conductores.find(x => x.dni && norm(x.dni) === dni);
  if (!c && tel) c = conductores.find(x => tel9(x.telefono) === tel);
  return c ? { idBolt: c.idBolt, nombre: c.nombre } : null;
}

/**
 * Aplica un ticket de Vacaciones / Baja / Permiso al planificador (vía Peticiones):
 * resuelve el conductor, mapea el subtipo a tipo de petición y llama a crearYAplicar,
 * que libera la plaza y escribe las letras. Deja el ticket como "Ejecutado". NO lo
 * mueve a resueltos (eso lo decide RRHH aparte, por si quiere revisar antes).
 */
async function aplicarAlPlanificador(ticketId, { usuario, desde, hasta, motivo, tipo } = {}) {
  const { t, idx } = await buscarEnTickets(ticketId);
  const tipoPet = (tipo || MAPA_PLANNING[(t.subtipo || '').toUpperCase()] || '').trim();
  if (!tipoPet) throw new Error(`El subtipo "${t.subtipo || '—'}" no se aplica al planificador (solo Vacaciones / Baja / Permiso)`);

  const cond = await resolverConductor(t);
  if (!cond) throw new Error(`No identifico al conductor en la agenda (ID_BOLT "${t.id_bolt || '—'}", ni por DNI/teléfono). Corrige el ID_BOLT o el DNI del ticket antes de aplicar.`);

  const d = soloFecha(desde || t.fecha_inicio_evento);
  const h = soloFecha(hasta || t.fecha_fin_evento);

  const peticiones = require('./peticiones');
  await peticiones.crearYAplicar({
    tipo: tipoPet, id_conductor: cond.idBolt, conductor: cond.nombre,
    desde: d, hasta: h,
    motivo: (motivo || t.descripcion_compilada || '').toString(),
    responsable: (usuario || '').toString().trim()
  });

  await actualizar(HOJA_T, idx, t._fila, { estado: 'Ejecutado', afecta_planning: 'SÍ' });
  return { idBolt: cond.idBolt, conductor: cond.nombre, tipo: tipoPet, desde: d, hasta: h };
}

module.exports = {
  leerTicketera, leerHoja, resolverConductor,
  asignar, cambiarEstado, guardarObservaciones, resolver, aplicarAlPlanificador,
  ESTADOS_RESOLUCION, MAPA_PLANNING, HOJA_T, HOJA_R
};
