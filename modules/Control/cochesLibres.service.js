// ============================================================
// COCHES SIN CUADRANTE · SERVICIO — la puerta del submódulo
// ============================================================
// Fino a propósito: la regla entera vive en el repositorio, que es quien habla
// con la base. Lo que se gana poniéndolo aquí es la puerta — desde fuera del
// módulo se entra por este fichero y no por la consulta.

const repo = require('./cochesLibres.repo');

const ES_DIA = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

/**
 * La jornada de hoy. Antes de las 05:00 seguimos en la de ayer, y esa es
 * justamente la hora a la que esta pantalla se mira: los coches que se van sin
 * nadie se van de madrugada.
 */
function hoyOperativo(ahora = new Date()) {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(ahora);
  const p = Object.fromEntries(f.map(x => [x.type, x.value]));
  const d = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  if (Number(p.hour) < 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Lo que pinta la pantalla de un día. */
async function delDia(dia) {
  const d = ES_DIA(dia) ? dia : hoyOperativo();
  const r = await repo.delDia(d);
  return {
    ...r,
    // Lo primero que se lee: cuántos coches se movieron sin nadie detrás.
    resumen: {
      sinNadie: r.sinNadie.length,
      sinPlan: r.sinPlan.length,
      reserva: r.reserva.length,
      fueraCobertura: r.fueraCobertura.length,
      kmSinNadie: r.kmSinNadie,
    },
  };
}

module.exports = { delDia, hoyOperativo };
