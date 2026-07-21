const { google } = require('googleapis');

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function readSheet(spreadsheetId, range) {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  return response.data.values || [];
}

async function writeSheet(spreadsheetId, range, values) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
}

async function clearSheet(spreadsheetId, range) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range
  });
}

async function ensureSheet(spreadsheetId, sheetName) {
  const sheets = getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);
  
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });
    console.log(`📄 Hoja "${sheetName}" creada`);
  }
}

/**
 * Lee varios rangos en UNA sola petición.
 * Devuelve un array paralelo a `ranges` con los valores de cada uno.
 */
async function readMany(spreadsheetId, ranges) {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const valueRanges = response.data.valueRanges || [];
  return ranges.map((_, i) => (valueRanges[i] && valueRanges[i].values) || []);
}

/**
 * Escribe varios rangos en UNA sola petición.
 * @param {Array<{range: string, values: Array[]}>} datos
 *
 * Esto es lo que sustituye a los ~1000 setValue del Apps Script: aunque se
 * manden 250 rangos distintos (las celdas combinadas obligan a ir una a una),
 * sigue siendo un único viaje a Google.
 */
async function writeMany(spreadsheetId, datos) {
  if (!datos.length) return { updatedCells: 0 };
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: datos }
  });
  return {
    updatedCells: response.data.totalUpdatedCells || 0,
    updatedRanges: response.data.totalUpdatedRanges || 0
  };
}

/** Mapa nombre de hoja → id numérico (necesario para borrar filas). */
async function getSheetIds(spreadsheetId) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const mapa = {};
  (meta.data.sheets || []).forEach(s => {
    mapa[s.properties.title] = s.properties.sheetId;
  });
  return mapa;
}

/** Añade filas al final de una hoja. */
async function appendRows(spreadsheetId, range, values) {
  if (!values.length) return { updatedRows: 0 };
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });
  return { updatedRows: (response.data.updates || {}).updatedRows || 0 };
}

/**
 * Borra filas por número de fila (1-based, como se ven en la hoja).
 * Se ordenan de mayor a menor: borrar de abajo arriba evita que el borrado de
 * una fila desplace a las siguientes y se acabe eliminando la equivocada.
 */
async function deleteRows(spreadsheetId, sheetId, filas) {
  if (!filas.length) return { borradas: 0 };
  const sheets = getSheetsClient();
  const ordenadas = [...new Set(filas)].sort((a, b) => b - a);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: ordenadas.map(fila => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: fila - 1, endIndex: fila }
        }
      }))
    }
  });
  return { borradas: ordenadas.length, filas: ordenadas };
}

module.exports = {
  readSheet, writeSheet, clearSheet, ensureSheet,
  readMany, writeMany, getSheetIds, appendRows, deleteRows
};