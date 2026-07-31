// ============================================================
// VACANTES
// ============================================================
// Dos cosas:
//   · vacantesPorZona(): en vivo desde la cobertura (huecos por zona/turno). Lo
//     usa el generador por dentro; ya no lo ve Selección directamente.
//   · Vacantes GUARDADAS (hoja VACANTES): las que Tráfico arma en el generador y
//     decide guardar. Son las que ve Selección para reclutar (proceso semimanual).

const { leerTablero } = require('./planificadorV2');
const { readSheet, writeSheetRaw, ensureSheet, appendRows } = require('./sheets');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA_VAC = 'VACANTES';
const TZ = 'Europe/Madrid';
const LETRA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const CAB_VAC = ['id', 'estado', 'puesto', 'turno', 'zonas', 'matriculas',
  'libranzas', 'dias', 'objetivo', 'fecha', 'notas'];

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

/** Huecos por zona/turno en vivo desde la cobertura (uso interno del generador). */
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
        disponiblesNoche: z.disponiblesNoche || 0
      };
    })
    .sort((a, b) => b.faltanTotal - a.faltanTotal);
}

/** Añade una fila con letras de día a cada matrícula, para mostrarla legible. */
function conLetras(mats) {
  return mats.map(m => ({ ...m, letras: (m.d || []).map(d => LETRA[d]).join('') }));
}

/** Lee las vacantes guardadas (parseando las matrículas del JSON). */
async function leerVacantesGuardadas() {
  await ensureSheet(ID_PLANIFICADOR, HOJA_VAC);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA_VAC}!A:K`);
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const id = (filas[i][0] || '').toString().trim();
    if (!id) continue;
    let mats = [];
    try { mats = JSON.parse(filas[i][5] || '[]'); } catch (_) { mats = []; }
    lista.push({
      id, estado: (filas[i][1] || '').toString(), puesto: (filas[i][2] || '').toString(),
      turno: (filas[i][3] || '').toString(), zonas: (filas[i][4] || '').toString(),
      matriculas: conLetras(mats), libranzas: (filas[i][6] || '').toString(),
      dias: parseInt(filas[i][7]) || 0, objetivo: parseInt(filas[i][8]) || 0,
      fecha: (filas[i][9] || '').toString(), notas: (filas[i][10] || '').toString()
    });
  }
  return lista;
}

/**
 * Guarda una vacante que armó Tráfico en el generador.
 * @param {{turno, objetivo, matriculas:[{matricula,zona,dias:[idx],fijo}]}} data
 */
async function guardarVacante(data = {}) {
  await ensureSheet(ID_PLANIFICADOR, HOJA_VAC);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA_VAC}!A:K`);
  if (!filas.length) await writeSheetRaw(ID_PLANIFICADOR, `${HOJA_VAC}!A1`, [CAB_VAC]);

  const tipoFijo = data.tipo === 'fijo';   // un fijo = una sola matrícula, día o noche
  const mats = (data.matriculas || [])
    .map(m => ({
      m: (m.matricula || '').toString().trim(),
      d: (m.dias || []).slice().sort((a, b) => a - b),
      fijoDia: (m.fijoDia || '').toString(), fijoNoche: (m.fijoNoche || '').toString(),
      zona: (m.zona || '').toString()
    }))
    .filter(m => m.m);
  if (!mats.length) throw new Error('La vacante no tiene matrículas');

  const turno = data.turno === 'Noche' ? 'Noche' : 'Día';
  const cubiertos = new Set(mats.flatMap(m => m.d));
  const zonas = [...new Set(mats.map(m => m.zona).filter(Boolean))].join(' - ');
  const puesto = tipoFijo ? `Fijo ${turno}` : ((mats.length > 1 ? 'CT' : 'Fijo') + ' ' + turno);
  // El fijo libra 2 días a definir; el CT deja el hueco de los días no cubiertos.
  const libranzas = tipoFijo ? 'a definir'
    : [0, 1, 2, 3, 4, 5, 6].filter(d => !cubiertos.has(d)).map(d => LETRA[d]).join(' ');
  const dias = tipoFijo ? '' : cubiertos.size;
  const id = 'V' + Date.now().toString(36).toUpperCase();

  const fila = [id, 'Abierta', puesto, turno, zonas, JSON.stringify(mats),
    libranzas, dias, Number(data.objetivo) || dias || '', ahora(), ''];
  await appendRows(ID_PLANIFICADOR, `${HOJA_VAC}!A:K`, [fila]);

  return { id, puesto, turno, zonas, libranzas, dias: tipoFijo ? '—' : cubiertos.size };
}

/**
 * Reservas de huecos por matrícula desde las vacantes ABIERTAS (en pleno
 * reclutamiento). Devuelve { MATRICULA: [ {id, turno, puesto, dias:[0..6], letras} ] }.
 * Sirve para avisar en el planificador de que esa matrícula/hueco ya está
 * comprometida en una vacante, para no asignar dos veces la misma plaza.
 */
async function reservasPorMatricula() {
  const vac = await leerVacantesGuardadas();
  const abiertas = vac.filter(v => v.estado !== 'Cerrada' && v.estado !== 'Cubierta');
  const mapa = {};
  abiertas.forEach(v => {
    (v.matriculas || []).forEach(m => {
      const key = (m.m || '').toString().trim().toUpperCase();
      if (!key) return;
      (mapa[key] = mapa[key] || []).push({
        id: v.id, turno: v.turno, puesto: v.puesto,
        dias: (m.d || []).slice(),
        letras: m.letras || (m.d || []).map(d => LETRA[d]).join('')
      });
    });
  });
  return mapa;
}

// Ciclo de vida de una vacante (es única): se genera Abierta; cuando un candidato
// llega a RRHH se bloquea "En proceso de alta" (no admite otro candidato); cuando
// Tráfico la resuelve se Cierra (pasa a "resueltas"). Si el candidato se cae antes
// de completar, vuelve a Abierta (nunca se colocó a nadie).
const ESTADO_VAC = { ABIERTA: 'Abierta', PROCESO: 'En proceso de alta', CERRADA: 'Cerrada' };

// Una vacante se puede reclutar/asignar solo si NO está ya comprometida o resuelta.
function vacanteDisponible(v) {
  const e = (v && v.estado || '').toString().trim();
  return e !== ESTADO_VAC.PROCESO && e !== ESTADO_VAC.CERRADA && e !== 'Cubierta';
}

/** Cambia el estado de una vacante (por id). Escritura puntual de la celda estado. */
async function actualizarEstadoVacante(id, estado, notas) {
  id = (id == null ? '' : id).toString().trim();
  if (!id) return { ok: false, motivo: 'sin id' };
  await ensureSheet(ID_PLANIFICADOR, HOJA_VAC);
  const colA = await readSheet(ID_PLANIFICADOR, `${HOJA_VAC}!A:A`);
  let fila = -1;
  for (let i = 1; i < colA.length; i++) {
    if (((colA[i] || [])[0] || '').toString().trim() === id) { fila = i + 1; break; }  // 1-based
  }
  if (fila === -1) return { ok: false, motivo: 'no existe' };
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA_VAC}!B${fila}`, [[estado]]);   // col B = estado
  if (notas !== undefined) await writeSheetRaw(ID_PLANIFICADOR, `${HOJA_VAC}!K${fila}`, [[notas]]);  // col K = notas
  return { ok: true, fila, id, estado };
}

module.exports = {
  vacantesPorZona, leerVacantesGuardadas, guardarVacante, reservasPorMatricula,
  actualizarEstadoVacante, vacanteDisponible, ESTADO_VAC
};
