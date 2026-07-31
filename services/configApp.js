// ============================================================
// CONFIG — ajustes de la plataforma guardados en la hoja CONFIG (clave/valor)
// ============================================================
// Para preferencias que deben compartir todos (no del navegador), como los datos
// del "correo para procesos". Los secretos se guardan CIFRADOS (ver services/cripto).

const { readSheet, writeSheetRaw, ensureSheet } = require('./sheets');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'CONFIG';

async function leerConfig() {
  await ensureSheet(ID_PLANIFICADOR, HOJA);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:B`);
  const o = {};
  for (let i = 1; i < filas.length; i++) {
    const k = (filas[i][0] || '').toString().trim();
    if (k) o[k] = (filas[i][1] == null ? '' : filas[i][1]).toString();
  }
  return o;
}

/** Fusiona `cambios` con lo existente y reescribe la hoja. */
async function guardarConfig(cambios = {}) {
  await ensureSheet(ID_PLANIFICADOR, HOJA);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:B`);
  const actual = {};
  for (let i = 1; i < filas.length; i++) {
    const k = (filas[i][0] || '').toString().trim();
    if (k) actual[k] = (filas[i][1] == null ? '' : filas[i][1]).toString();
  }
  const merged = { ...actual, ...cambios };
  const grid = [['clave', 'valor'], ...Object.entries(merged).map(([k, v]) => [k, v == null ? '' : String(v)])];
  while (grid.length < filas.length) grid.push(['', '']);   // limpia filas sobrantes
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!A1`, grid);
  return merged;
}

module.exports = { leerConfig, guardarConfig };
