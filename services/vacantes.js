// ============================================================
// VACANTES — capa de compatibilidad
// ============================================================
// La vacante VIVE EN POSTGRESQL (`services/repo/vacantes`). Este fichero ya no
// lee ni escribe en la hoja VACANTES: traduce, para los sitios que todavía
// hablan el idioma viejo —el de la hoja—, lo que ahora dice la base.
//
// Se mantiene por una razón concreta: la vacante la miran seis módulos (ETT,
// notificaciones, Selección, el generador, las incorporaciones y los tickets de
// Administración), y cambiarlos todos de golpe habría sido un salto sin red.
// Aquí la forma vieja se sigue sirviendo, y quien quiera lo bueno —las plazas
// reales, el recambio, la jornada calculada— pide el repositorio directamente.
//
// La traducción tiene dos trampas que conviene tener escritas:
//   · Los ESTADOS. La hoja decía 'Abierta' / 'En proceso de alta' / 'Cerrada';
//     la base dice abierta / proceso / cubierta / anulada.
//   · Los DÍAS. La hoja los guardaba de 0 a 6 (índice de la letra) y la base de
//     1 a 7 (ISODOW, como todo lo demás). Un desfase de uno aquí coloca a un
//     correturnos el día equivocado, así que la conversión es explícita.

const repo = require('./repo/vacantes');
const { leerTablero } = require('./planificadorV2');

const LETRA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Ciclo de vida, en el idioma viejo.
const ESTADO_VAC = { ABIERTA: 'Abierta', PROCESO: 'En proceso de alta', CERRADA: 'Cerrada' };

const A_HOJA = { abierta: ESTADO_VAC.ABIERTA, proceso: ESTADO_VAC.PROCESO,
  cubierta: ESTADO_VAC.CERRADA, anulada: ESTADO_VAC.CERRADA };
const A_BASE = { [ESTADO_VAC.ABIERTA]: 'abierta', [ESTADO_VAC.PROCESO]: 'proceso',
  [ESTADO_VAC.CERRADA]: 'cubierta', Cubierta: 'cubierta', Anulada: 'anulada' };

const esFecha = t => (t ? new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(t)) : '');

/** Una vacante de la base, con la forma que tenía la fila de la hoja. */
function aFormaVieja(v) {
  return {
    id: v.codigo,                                   // el código ES el id de siempre
    vacanteId: v.id,                                // el numérico, por si se quiere
    estado: A_HOJA[v.estado] || ESTADO_VAC.ABIERTA,
    puesto: v.puesto,
    turno: v.turno || 'Día',
    zonas: v.zonas || '',
    // Los días vuelven a 0..6, que es como los lee todo el código viejo.
    matriculas: (v.plazas || []).map(p => ({
      m: p.matricula,
      d: (p.dias || []).map(d => d - 1),
      letras: p.letras.replace(/ /g, ''),
      zona: p.zona || '',
      plazaId: p.plazaId,
      ocupa: p.ocupa || '',
    })),
    libranzas: v.libranzas || (v.rol === 'FIJO' ? 'a definir' : ''),
    dias: v.dias || 0,
    objetivo: v.dias || 0,
    fecha: esFecha(v.creadoAt),
    notas: v.notas || '',
    // Lo que la hoja no sabía decir y ahora sí. Quien lo entienda, lo usa.
    motivo: v.motivo,
    rol: v.rol,
    jornadaHoras: v.jornadaHoras,
    sustituye: v.sustituye || '',
    sustituyeA: v.sustituyeA || null,
    salidaPrevista: v.salidaPrevista || null,
    candidato: v.candidato || '',
    inicioPrevisto: v.inicioPrevisto || null,
  };
}

/** Todas las vacantes, incluidas las cerradas (como devolvía la hoja). */
async function leerVacantesGuardadas() {
  return (await repo.listar({ incluirCerradas: true })).map(aFormaVieja);
}

/** Cambia el estado. Acepta el nombre viejo ('Abierta') o el nuevo ('abierta'). */
async function actualizarEstadoVacante(id, estado, notas) {
  const nuevo = A_BASE[estado] || (repo.ESTADOS.includes(estado) ? estado : null);
  if (!nuevo) return { ok: false, motivo: `estado no válido: ${estado}` };
  return repo.cambiarEstado(id, nuevo, { motivo: notas });
}

/** Se puede reclutar/asignar si no está ya comprometida ni resuelta. */
function vacanteDisponible(v) {
  const e = ((v && v.estado) || '').toString().trim();
  return e !== ESTADO_VAC.PROCESO && e !== ESTADO_VAC.CERRADA && e !== 'Cubierta'
    && e !== 'proceso' && e !== 'cubierta' && e !== 'anulada';
}

/**
 * Qué huecos hay reservados por matrícula, desde las vacantes vivas. Lo usa el
 * planificador viejo para avisar de que esa plaza ya está prometida.
 *
 * Lo bueno de verdad es `repo.comprometidas()`, que va POR PLAZA: aquí una
 * matrícula con dos plazas prometidas se ve como dos entradas, no como una.
 */
async function reservasPorMatricula() {
  const vivas = (await repo.listar()).map(aFormaVieja);
  const mapa = {};
  vivas.forEach(v => {
    (v.matriculas || []).forEach(m => {
      const key = String(m.m || '').trim().toUpperCase();
      if (!key) return;
      (mapa[key] = mapa[key] || []).push({
        id: v.id, turno: v.turno, puesto: v.puesto,
        dias: (m.d || []).slice(),
        letras: m.letras || (m.d || []).map(d => LETRA[d]).join(''),
      });
    });
  });
  return mapa;
}

/**
 * Huecos por zona/turno, en vivo desde la cobertura. No tiene que ver con las
 * vacantes guardadas: es la demanda, y el generador la usa por dentro.
 */
async function vacantesPorZona(opciones = {}) {
  const t = await leerTablero(opciones);
  const dz = (t.resumen && t.resumen.demandaPorZona) || [];
  return dz
    .map(z => {
      const faltanDia = (z.fijosDia || 0) + (z.ctDia || 0);
      const faltanNoche = (z.fijosNoche || 0) + (z.ctNoche || 0);
      return {
        zona: z.zona, faltanDia, faltanNoche,
        faltanTotal: faltanDia + faltanNoche,
        disponiblesDia: z.disponiblesDia || 0,
        disponiblesNoche: z.disponiblesNoche || 0,
      };
    })
    .sort((a, b) => b.faltanTotal - a.faltanTotal);
}

module.exports = {
  vacantesPorZona, leerVacantesGuardadas, reservasPorMatricula,
  actualizarEstadoVacante, vacanteDisponible, ESTADO_VAC, aFormaVieja,
  // El repositorio, para quien ya hable el idioma nuevo.
  repo,
};
