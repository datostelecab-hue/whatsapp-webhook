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

module.exports = { readSheet, writeSheet, clearSheet, ensureSheet, readMany, writeMany };