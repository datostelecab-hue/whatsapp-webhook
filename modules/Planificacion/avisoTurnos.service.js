// ============================================================
// AVISO DE TURNOS — recuerda a qué SEMANA corresponde el aviso de cada teléfono
// ============================================================
// Cuando desde Cobertura se manda el aviso "tus turnos están listos" para una semana
// (offset 0 = actual, 1 = la que viene…), se apunta aquí. Al pulsar el conductor el
// botón "Ver mis turnos", el bot lee este apunte y le muestra ESA semana, no siempre la
// actual. En memoria: si Render reinicia, se cae a la semana actual (offset 0).

const _sem = new Map();   // tel9 -> { offset, ts }
const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);

function marcar(telefono, offset) {
  const k = tel9(telefono);
  if (k) _sem.set(k, { offset: Number(offset) || 0, ts: Date.now() });
}

function offsetDe(telefono) {
  const r = _sem.get(tel9(telefono));
  if (r && Date.now() - r.ts < 12 * 86400 * 1000) return r.offset;   // el apunte vale 12 días
  return 0;
}

module.exports = { marcar, offsetDe };
