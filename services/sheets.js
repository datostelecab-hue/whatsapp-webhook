// ============================================================
// GOOGLE SHEETS — solo LECTURA
// ============================================================
// El ERP ya no escribe en ninguna hoja (01/10/2026). Lo que queda de Google
// Sheets son lecturas: las respuestas del formulario de la ticketera
// (`Ticketera/formulario.js`) y los rescates únicos de `configApp` y de
// `TICKETS_IT`. La última escritora fue la boda, y con ella se fueron las diez
// funciones de escribir (writeSheet, appendRows, deleteRows…): están en el
// historial de git si algún día hicieran falta.
//
// Por eso el permiso que se le pide a Google es `spreadsheets.readonly`: aunque
// alguien volviera a llamar a una escritura, la cuenta de servicio no podría
// hacerla. Ver docs/integraciones/Google Drive y Sheets.md.

const { google } = require('googleapis');

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Reintenta cuando Google responde "Resource has been exhausted": su cuota es de 60
 * peticiones por minuto y usuario, y al agotarse falla TODO lo que lee Sheets — hasta
 * el login. Con una espera creciente, un pico puntual (un backfill, varios paneles a la
 * vez) se absorbe en vez de tumbar el ERP. Si tras los reintentos sigue fallando, se
 * propaga el error para que se vea en los logs.
 */
const esCuota = e => {
  const m = (e && (e.message || '')) + ' ' + ((e && e.code) || '');
  return /exhaust|quota|rate limit|RESOURCE_EXHAUSTED|\b429\b/i.test(m);
};
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function conReintento(etiqueta, fn, intentos = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!esCuota(e) || i >= intentos) throw e;
      const espera = 1500 * Math.pow(2, i - 1);   // 1,5s · 3s · 6s
      console.warn(`⏳ [Sheets] cuota agotada en ${etiqueta} — reintento ${i}/${intentos - 1} en ${espera / 1000}s`);
      await dormir(espera);
    }
  }
}

async function readSheet(spreadsheetId, range, options = {}) {
  const sheets = getSheetsClient();
  const response = await conReintento('readSheet', () => sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    // Por defecto Google devuelve el valor tal como se ve (con coma decimal,
    // fechas formateadas…). Con UNFORMATTED_VALUE los números vuelven como
    // números y sobreviven al ida y vuelta sin depender del idioma de la hoja.
    valueRenderOption: options.valueRenderOption
  }));
  return response.data.values || [];
}

/**
 * Lee varios rangos en UNA sola petición.
 * Devuelve un array paralelo a `ranges` con los valores de cada uno.
 */
async function readMany(spreadsheetId, ranges) {
  const sheets = getSheetsClient();
  const response = await conReintento('readMany', () => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }));
  const valueRanges = response.data.valueRanges || [];
  return ranges.map((_, i) => (valueRanges[i] && valueRanges[i].values) || []);
}

/**
 * Mapa nombre de pestaña → id numérico. Lo usa el formulario para saber qué
 * pestañas tiene el libro antes de elegir de cuál leer.
 */
async function getSheetIds(spreadsheetId) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const mapa = {};
  (meta.data.sheets || []).forEach(s => {
    mapa[s.properties.title] = s.properties.sheetId;
  });
  return mapa;
}

module.exports = { readSheet, readMany, getSheetIds };
