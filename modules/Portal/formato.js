// ============================================================
// PORTAL DE CONDUCTORES — cómo se escriben las fechas y las notas
// ============================================================
// Funciones puras que usan las vistas del portal (llegan como `f`). Todas las
// fechas son 'AAAA-MM-DD' y se leen en UTC a mediodía: sin toISOString ni zona
// horaria que mueva el día.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

const partes = iso => String(iso || '').slice(0, 10).split('-').map(Number);
const diaSemana = iso => { const [y, m, d] = partes(iso); return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); };
const mayus = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** «martes 21/10». */
function fecha(iso) {
  if (!iso) return '';
  const [, m, d] = partes(iso);
  return `${DIAS[diaSemana(iso)]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Cómo se llama un día de sus turnos: «Hoy», «Mañana» o «Miércoles», y su fecha aparte. */
function nombreDia(iso, hoy) {
  const [, m, d] = partes(iso);
  const corta = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  const dif = Math.round((Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') - Date.parse(String(hoy).slice(0, 10) + 'T12:00:00Z')) / 86400000);
  const nombre = dif === 0 ? 'Hoy' : dif === 1 ? 'Mañana' : mayus(DIAS[diaSemana(iso)]);
  return { nombre, fecha: dif <= 1 ? `${DIAS[diaSemana(iso)]} ${corta}` : corta };
}

/** La semana: «12 – 18 oct», o «28 sep – 4 oct» si cruza de mes. */
function semana(desde, hasta) {
  const [, m1, d1] = partes(desde), [, m2, d2] = partes(hasta);
  return m1 === m2 ? `${d1} – ${d2} ${MESES[m2 - 1]}` : `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]}`;
}

/** La semana con palabras: «del 12 al 18 de octubre». */
function semanaLarga(desde, hasta) {
  const [, m1, d1] = partes(desde), [, m2, d2] = partes(hasta);
  return m1 === m2 ? `del ${d1} al ${d2} de ${MESES_LARGOS[m2 - 1]}`
    : `del ${d1} de ${MESES_LARGOS[m1 - 1]} al ${d2} de ${MESES_LARGOS[m2 - 1]}`;
}

/** El día de la barra de la racha: «12/10». */
const corta = iso => { const [, m, d] = partes(iso); return `${d}/${m}`; };

/** «637945245» → «637 94 52 45»; y el enlace para llamar. */
function telefono(t) {
  const n = String(t || '').replace(/\D/g, '').slice(-9);
  return n.length === 9 ? `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}` : String(t || '');
}
const telHref = t => { const n = String(t || '').replace(/\D/g, '').slice(-9); return n.length === 9 ? `tel:+34${n}` : ''; };

/** El total como se lee: 88, o 84,5 si tiene decimales. */
const total = n => (n == null ? '' : String(Math.round(Number(n) * 10) / 10).replace('.', ','));

/** «4750» → «4.750,00 €»; con 0 decimales, «4.750 €». El punto de los miles también en cuatro cifras. */
function euros(n, decimales = 2) {
  const v = Number(n) || 0;
  const [ent, dec] = Math.abs(v).toFixed(decimales).split('.');
  // Con espacio que no se parte: el «€» nunca se queda solo en otra línea.
  return (v < 0 ? '−' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '') + '\u00a0€';
}

/** Por qué una semana no tiene nota, dicho para el conductor. */
function sinNota(motivo) {
  const m = String(motivo || '');
  if (/menos de \d+ días/.test(m)) return 'Esa semana contaste menos de 5 días, y con tan pocos no se puede poner nota.';
  if (/ni salidas ni ausencias/.test(m)) return 'Esa semana no tuviste turnos.';
  if (/ningún día con actividad/.test(m)) return 'Esa semana no hubo trabajo que medir (vacaciones, baja o permiso).';
  if (/telemetría/.test(m)) return 'Esa semana faltan datos del coche para poner la nota.';
  return 'Esa semana no tiene nota.';
}

/** La clase de la letra (N/E no vale como clase). */
const claseLetra = l => (l === 'N/E' ? 'NE' : l);

// «JUAN FRANCISCO RUIZ DE LA CRUZ» → «Juan Francisco Ruiz de la Cruz». Solo si
// viene todo en mayúsculas o todo en minúsculas: un nombre ya bien escrito se
// respeta tal cual (con sus tildes y sus mayúsculas raras).
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'do', 'dos', 'e', 'van', 'von']);
function nombrePropio(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t || (t !== t.toUpperCase() && t !== t.toLowerCase())) return t;
  return t.toLowerCase().split(' ').map((w, i) => (i > 0 && PARTICULAS.has(w) ? w
    : w.replace(/(^|[-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()))).join(' ');
}

module.exports = { fecha, nombreDia, semana, semanaLarga, corta, telefono, telHref, total, euros, sinNota, claseLetra, nombrePropio };
