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

  const mats = (data.matriculas || [])
    .map(m => ({
      m: (m.matricula || '').toString().trim(),
      d: (m.dias || []).slice().sort((a, b) => a - b),
      fijo: (m.fijo || '').toString(), zona: (m.zona || '').toString()
    }))
    .filter(m => m.m && m.d.length);
  if (!mats.length) throw new Error('La vacante no tiene matrículas con huecos');

  const turno = data.turno === 'Noche' ? 'Noche' : 'Día';
  const cubiertos = new Set(mats.flatMap(m => m.d));
  const libranzas = [0, 1, 2, 3, 4, 5, 6].filter(d => !cubiertos.has(d)).map(d => LETRA[d]).join(' ');
  const zonas = [...new Set(mats.map(m => m.zona).filter(Boolean))].join(' - ');
  const puesto = (mats.length > 1 ? 'CT' : 'Fijo') + ' ' + turno;   // correturno vs fijo
  const id = 'V' + Date.now().toString(36).toUpperCase();

  const fila = [id, 'Abierta', puesto, turno, zonas, JSON.stringify(mats),
    libranzas, cubiertos.size, Number(data.objetivo) || cubiertos.size, ahora(), ''];
  await appendRows(ID_PLANIFICADOR, `${HOJA_VAC}!A:K`, [fila]);

  return { id, puesto, turno, zonas, libranzas, dias: cubiertos.size };
}

module.exports = { vacantesPorZona, leerVacantesGuardadas, guardarVacante };
