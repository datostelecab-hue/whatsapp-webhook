// ============================================================
// BITÁCORA — lectura de VISTA_FINAL para la vista visual
// ============================================================
// VISTA_FINAL es la rejilla histórica: filas = conductores (col B = ID_BOLT),
// columnas = días (col D en adelante, empezando el 1 jun 2026). Cada celda:
//   · número → horas trabajadas ese día
//   · 'L'    → libranza
//   · V/B/P  → ausencia (Vacaciones / Baja Médica / Permiso Retribuido)
//   · '' / 0 → sin datos / día pasado sin horas
// Este módulo solo LEE y normaliza: toda la agregación (año/mes/semana, KPIs,
// rangos de ausencia) la hace el cliente a partir de los arrays de días.

const { readSheet } = require('./sheets');

const ID_GESTION = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA = 'VISTA_FINAL';
const TZ = 'Europe/Madrid';
const INICIO = { y: 2026, m: 5, d: 1 };   // 1 jun 2026 (mes 0-based: 5 = junio)

function hoyMadridMs() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function idxHoy() {
  return Math.round((hoyMadridMs() - Date.UTC(INICIO.y, INICIO.m, INICIO.d)) / 86400000);
}

// Celda de VISTA_FINAL → valor normalizado: número (horas), 'V'/'B'/'P'/'L', o null.
function codificar(cell) {
  if (cell == null || cell === '') return null;
  const s = cell.toString().trim();
  if (!s) return null;
  if (/^[VBPL]$/i.test(s)) return s.toUpperCase();
  const n = Number(s.replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Estado limpio (VISTA_FINAL guarda "✅ Activo", "🩹 Baja Médica"…): quita el emoji.
function limpiarEstado(v) {
  return (v == null ? '' : v.toString()).replace(/[^\p{L}\p{N} ]+/gu, '').trim();
}

/**
 * Lee VISTA_FINAL y devuelve, por conductor, su array de días (0 = 1 jun 2026)
 * hasta HOY (el futuro va vacío y lo pinta el cliente). Se saltan las filas de
 * cabecera sueltas (col B vacía o 'CONDUCTOR', o 'ESTADO' en col A).
 */
async function leerBitacora() {
  const filas = await readSheet(ID_GESTION, `${HOJA}!A:ZZ`, { valueRenderOption: 'UNFORMATTED_VALUE' });
  const hoyIdx = idxHoy();
  const nDias = Math.max(0, hoyIdx + 1);

  const conductores = [];
  for (let i = 3; i < filas.length; i++) {
    const row = filas[i] || [];
    const nombre = (row[1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase() === 'CONDUCTOR') continue;
    if ((row[0] || '').toString().trim().toUpperCase() === 'ESTADO') continue;

    const dias = new Array(nDias);
    for (let d = 0; d < nDias; d++) dias[d] = codificar(row[3 + d]);
    conductores.push({
      id: nombre,
      estado: limpiarEstado(row[0]),
      turno: limpiarEstado(row[2]),
      dias
    });
  }
  conductores.sort((a, b) => a.id.localeCompare(b.id, 'es'));
  return { conductores, hoyIdx, inicio: INICIO };
}

module.exports = { leerBitacora, INICIO };
