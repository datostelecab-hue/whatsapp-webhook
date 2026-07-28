// ============================================================
// VACANTES — en vivo desde la cobertura del planificador
// ============================================================
// "Qué zonas y turnos hay que cubrir": por zona, cuántos conductores faltan de
// Día y de Noche (plazas fijas + correturnos sin cubrir) y cuántos pendientes ya
// hay disponibles. Sale directo de resumen.demandaPorZona, así que no hay nada
// que mantener a mano: refleja el estado real de la operación.

const { leerTablero } = require('./planificadorV2');

async function vacantesPorZona(opciones = {}) {
  const t = await leerTablero(opciones);
  const dz = (t.resumen && t.resumen.demandaPorZona) || [];
  return dz
    .map(z => {
      const faltanDia = (z.fijosDia || 0) + (z.ctDia || 0);
      const faltanNoche = (z.fijosNoche || 0) + (z.ctNoche || 0);
      return {
        zona: z.zona,
        faltanDia, faltanNoche,
        faltanTotal: faltanDia + faltanNoche,
        disponiblesDia: z.disponiblesDia || 0,
        disponiblesNoche: z.disponiblesNoche || 0
      };
    })
    .sort((a, b) => b.faltanTotal - a.faltanTotal);
}

module.exports = { vacantesPorZona };
