const { google } = require('googleapis');
const pruebas = require('./modoPruebas');

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

async function writeSheet(spreadsheetId, range, values) {
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${range} (${values.length} filas)`)) return;
  const sheets = getSheetsClient();
  await conReintento('write', () => sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  }));
}

// Como writeSheet pero SIN que Sheets interprete los valores: 'YYYY-MM-DD' se
// queda como texto y no se convierte a fecha con formato local. Se usa para
// cabeceras que son claves (L_Acumuladas), donde el texto debe sobrevivir al
// ida y vuelta.
async function writeSheetRaw(spreadsheetId, range, values) {
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${range} (${values.length} filas)`)) return;
  const sheets = getSheetsClient();
  await conReintento('write', () => sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values }
  }));
}

async function clearSheet(spreadsheetId, range) {
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${range}`)) return;
  const sheets = getSheetsClient();
  await conReintento('clear', () => sheets.spreadsheets.values.clear({
    spreadsheetId,
    range
  }));
}

async function ensureSheet(spreadsheetId, sheetName) {
  const sheets = getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);

  if (!exists) {
    // La comprobación es una LECTURA y pasa siempre; lo que se frena en modo
    // pruebas es crear la pestaña, que sí modificaría el libro de producción.
    if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… crear hoja ${sheetName}`)) return;
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
  const response = await conReintento('readMany', () => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }));
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
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${datos.length} rango(s)`)) return;
  if (!datos.length) return { updatedCells: 0 };
  const sheets = getSheetsClient();
  const response = await conReintento('writeMany', () => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data: datos }
  }));
  return {
    updatedCells: response.data.totalUpdatedCells || 0,
    updatedRanges: response.data.totalUpdatedRanges || 0
  };
}

/** Envía requests crudas a spreadsheets.batchUpdate (formato, visibilidad…). */
async function batchUpdate(spreadsheetId, requests) {
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${requests.length} petición(es)`)) return {};
  const reqs = (requests || []).filter(Boolean);
  if (!reqs.length) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: reqs } });
}

/**
 * Oculta / muestra tramos de filas (hiddenByUser). Un tramo es
 * { startIndex, endIndex, hidden } con índices 0-based y endIndex exclusivo.
 * Todo en una sola petición.
 */
async function setRowVisibility(spreadsheetId, sheetId, tramos) {
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… visibilidad de filas`)) return;
  const reqs = (tramos || []).filter(t => t.endIndex > t.startIndex);
  if (!reqs.length) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: reqs.map(t => ({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: t.startIndex, endIndex: t.endIndex },
          properties: { hiddenByUser: !!t.hidden },
          fields: 'hiddenByUser'
        }
      }))
    }
  });
}

/**
 * Se asegura de que la hoja tenga AL MENOS `filas` filas y `columnas` columnas.
 * values.update NO amplía la rejilla: escribir más filas de las que tiene la hoja
 * (1000 por defecto) falla con "exceeds grid limits", así que hay que crecerla antes.
 */
// Tamaño conocido de cada pestaña: pedir los metadatos en CADA escritura multiplicaba
// las llamadas a la API y agotaba la cuota (60/min por usuario). Solo se consulta si no
// se conoce o si hace falta crecer de verdad.
const _grid = new Map();   // 'spreadsheetId|hoja' -> { filas, columnas }

async function ensureGrid(spreadsheetId, sheetName, filas, columnas) {
  const clave = `${spreadsheetId}|${sheetName}`;
  const conocido = _grid.get(clave);
  if (conocido && (!filas || conocido.filas >= filas) && (!columnas || conocido.columnas >= columnas)) return;

  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const hoja = (meta.data.sheets || []).find(s => s.properties.title === sheetName);
  if (!hoja) throw new Error(`No existe la hoja "${sheetName}"`);
  const g = hoja.properties.gridProperties || {};
  const reqs = [];
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ampliar ${sheetName} a ${filas}x${columnas}`)) return;
  if (filas && (g.rowCount || 0) < filas) {
    reqs.push({ appendDimension: { sheetId: hoja.properties.sheetId, dimension: 'ROWS', length: filas - (g.rowCount || 0) } });
  }
  if (columnas && (g.columnCount || 0) < columnas) {
    reqs.push({ appendDimension: { sheetId: hoja.properties.sheetId, dimension: 'COLUMNS', length: columnas - (g.columnCount || 0) } });
  }
  if (reqs.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: reqs } });
    console.log(`📐 Hoja "${sheetName}" ampliada a ${Math.max(filas || 0, g.rowCount || 0)} filas`);
  }
  _grid.set(clave, {
    filas: Math.max(filas || 0, g.rowCount || 0),
    columnas: Math.max(columnas || 0, g.columnCount || 0)
  });
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
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${range} (+${values.length})`)) return { updatedRows: 0 };
  if (!values.length) return { updatedRows: 0 };
  const sheets = getSheetsClient();
  const response = await conReintento('append', () => sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  }));
  return { updatedRows: (response.data.updates || {}).updatedRows || 0 };
}

/**
 * Borra filas por número de fila (1-based, como se ven en la hoja).
 * Se ordenan de mayor a menor: borrar de abajo arriba evita que el borrado de
 * una fila desplace a las siguientes y se acabe eliminando la equivocada.
 */
async function deleteRows(spreadsheetId, sheetId, filas) {
  if (!pruebas.permite('Sheets', `${spreadsheetId.slice(0,8)}… ${filas.length} fila(s)`)) return { borradas: 0 };
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
  readSheet, writeSheet, writeSheetRaw, clearSheet, ensureSheet, ensureGrid,
  readMany, writeMany, getSheetIds, appendRows, deleteRows, setRowVisibility,
  batchUpdate
};