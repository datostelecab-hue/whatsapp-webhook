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
// reutilizando Peticiones (crearYAplicar), que abre el tramo de ausencia en
// PostgreSQL. A la persona la identifica Conductores por DNI, teléfono o nombre de
// BOLT —en ese orden, y diciendo que no cuando hay dos que encajan.

const { readSheet, writeMany, appendRows, deleteRows, getSheetIds, ensureSheet } = require('./sheets');
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');

const ID = SPREADSHEET_PLANIFICADOR;
const HOJA_T = 'TICKETS_RRHH';
const HOJA_R = 'RESUELTOS_RRHH';
const RANGO = 'A:Z';
const TZ = 'Europe/Madrid';

// Subtipo del formulario → tipo de petición del planificador (Peticiones).
// Subtipo del formulario → estado del catálogo (`cat_estado_conductor`). El
// código, no la etiqueta: la etiqueta es lo que se enseña y puede cambiar.
const MAPA_PLANNING = { VACACIONES: 'vacaciones', BAJA_AUSENCIA: 'baja_medica', PERMISO_RETRIBUIDO: 'permiso' };
const ETIQUETA_PLANNING = { vacaciones: 'Vacaciones', baja_medica: 'Baja Médica', permiso: 'Permiso Retribuido' };
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
// dd/mm/aaaa → aaaa-mm-dd, que es como entiende las fechas PostgreSQL. Vacío si
// no se entiende: una fecha a medias no se adivina, se rechaza.
function isoDeFecha(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

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
  // CONTRA POSTGRESQL, no contra el tablero. El formulario trae lo que el
  // conductor escribió: a veces su nombre de BOLT, a veces solo el DNI, a veces
  // solo el número desde el que manda. Conductores sabe resolver eso, y sabe
  // decir que NO cuando hay dos personas que encajan —que es mejor que
  // aplicarle las vacaciones a un homónimo.
  const plantilla = require('../modules/Conductores/plantilla.service');
  const idb = String(t.id_bolt || '').trim();
  const c = await plantilla.buscarPersona({
    dni: t.dni,
    telefono: t.telefono,
    nombreBolt: idb.toLowerCase() === 'sin_identificar' ? '' : idb,
  });
  return c ? { id: c.id, nombre: c.nombre, por: c.por } : null;
}

/**
 * Aplica un ticket de Vacaciones / Baja / Permiso: abre el tramo de ausencia en
 * PostgreSQL y deja el ticket como «Ejecutado». NO lo mueve a resueltos: eso lo
 * decide RRHH aparte, por si quiere revisarlo antes.
 *
 * ── POR QUÉ ENTRA POR LA PUERTA DE CONDUCTORES ─────────────────────────────
 * Abrir una ausencia tiene reglas: no puede pisar otro tramo de la misma
 * persona, unas vacaciones necesitan fecha de vuelta o esa persona desaparece
 * del cuadrante para siempre, y cerrar una vigencia y abrir la siguiente va en
 * una transacción. Eso vive en `plantilla.service` y se pide ahí. Repetirlo
 * aquí sería tener dos definiciones de qué es estar de vacaciones, y la de la
 * ticketera sería la floja.
 *
 * (Hasta el 15/09/2026 esto pasaba por el módulo de Peticiones, que a su vez
 *  escribía en dos hojas. Ese módulo se borró: quien puede tocar la Plantilla
 *  cambia la situación en la ficha, y eso es todo el circuito.)
 */
async function aplicarAlPlanificador(ticketId, { usuario, desde, hasta, motivo, tipo } = {}) {
  const { t, idx } = await buscarEnTickets(ticketId);
  const estado = (tipo || MAPA_PLANNING[(t.subtipo || '').toUpperCase()] || '').trim();
  if (!ETIQUETA_PLANNING[estado]) {
    throw new Error(`El subtipo "${t.subtipo || '—'}" no abre una ausencia (solo Vacaciones / Baja / Permiso)`);
  }

  const cond = await resolverConductor(t);
  if (!cond) throw new Error(`No identifico al conductor (ID_BOLT "${t.id_bolt || '—'}", ni por DNI ni por teléfono). ` +
    'Corrige el DNI o el ID_BOLT del ticket antes de aplicar.');

  const d = isoDeFecha(soloFecha(desde || t.fecha_inicio_evento));
  const h = isoDeFecha(soloFecha(hasta || t.fecha_fin_evento));
  if (!d) throw new Error('El ticket no trae fecha de inicio: ponla antes de aplicar');

  // SE APLICA ANTES DE MARCAR EL TICKET. Si el tramo choca con otro suyo, el
  // ticket sigue pendiente en vez de quedar «Ejecutado» sin que se haya
  // ejecutado nada.
  const plantilla = require('../modules/Conductores/plantilla.service');
  await plantilla.anadirAusencia(cond.id, {
    estado, desde: d, hasta: h || null,
    motivo: (motivo || t.descripcion_compilada || '').toString().slice(0, 500) || null,
  }, { usuarioId: null });

  await actualizar(HOJA_T, idx, t._fila, { estado: 'Ejecutado', afecta_planning: 'SÍ' });
  console.log(`✅ [TICKETERA] ${ETIQUETA_PLANNING[estado]} de ${cond.nombre} (por ${cond.por}) ` +
    `${d}${h ? ' → ' + h : ''}, aplicada por ${usuario || '—'}`);
  return { conductorId: cond.id, conductor: cond.nombre, tipo: ETIQUETA_PLANNING[estado], desde: d, hasta: h };
}

module.exports = {
  leerTicketera, leerHoja, resolverConductor,
  asignar, cambiarEstado, guardarObservaciones, resolver, aplicarAlPlanificador,
  ESTADOS_RESOLUCION, MAPA_PLANNING, HOJA_T, HOJA_R
};
