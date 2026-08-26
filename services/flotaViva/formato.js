// ============================================================
// FLOTA VIVA — poner los números en castellano
// ============================================================
// Cosas de dar formato, sin nada de negocio dentro. Vive aparte porque las usan
// tanto el panel —para pintar— como el vigilante —para escribir el detalle de
// una incidencia—, y una duración no debería escribirse de dos maneras según
// quién la cuente.

/** Segundos a algo que se lee: `3 h 05 min`, `48 min`, `2 d 4 h`. */
const duracion = seg => {
  if (seg == null) return '';
  const s = Math.max(0, Math.floor(seg));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
};

module.exports = { duracion };
