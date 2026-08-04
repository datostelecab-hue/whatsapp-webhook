// ============================================================
// CÓDIGOS DE LAVADO BALLENOIL — códigos de un solo uso
// ============================================================
// Administración importa una lista (Código + Fecha de vencimiento) que se guarda en
// la hoja "codigos_ballenoil". El bot de WhatsApp entrega uno LIBRE cuando un
// conductor lo pide: lo marca "Usado" y anota qué teléfono e ID_BOLT lo gastó, para
// que no se reparta dos veces. Cada código es de un solo uso.

const { readSheet, writeSheetRaw, appendRows, ensureSheet, getSheetIds, deleteRows } = require('./sheets');
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');

const ID = SPREADSHEET_PLANIFICADOR;
const HOJA = 'codigos_ballenoil';
const RANGO = `${HOJA}!A:F`;
const TZ = 'Europe/Madrid';

const COL = { codigo: 0, fecha_vencimiento: 1, estado: 2, telefono: 3, id_bolt: 4, fecha_uso: 5 };
const N_COLS = 6;
const CABECERA = ['CODIGO', 'FECHA_VENCIMIENTO', 'ESTADO', 'TELEFONO', 'ID_BOLT', 'FECHA_USO'];
const DISPONIBLE = 'Disponible';
const USADO = 'Usado';

// Instructivo que acompaña al código cuando el bot lo entrega.
const INSTRUCTIVO =
`📋 *Instrucciones de uso:*
1. Estacione el vehículo en una pista y recuerde su número de pista.
2. Diríjase al terminal Ballenoil Easy Wash y pase el bono por el lector.
3. Seleccione en la pantalla el número de la pista donde está su vehículo.
4. Regrese al vehículo e inicie el programa de lavado que prefiera.
5. Durante el lavado podrá cambiar de programa tantas veces como desee.

⚠️ *Importante:* este bono solo es válido de lunes a viernes.`;

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

// dd/mm/aaaa → ms (mediodía UTC); null si no parsea. Para saber si un código venció.
function fechaMs(s) { const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], 12) : null; }
function vencido(fecha) {
  const f = fechaMs(fecha);
  if (f == null) return false;   // sin fecha válida → no se considera vencido
  const hoy = new Date();
  return f < Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
}

function filaAObjeto(row, i) {
  const o = { _fila: i + 1 };
  for (const [k, ci] of Object.entries(COL)) o[k] = (row[ci] == null ? '' : row[ci]).toString().trim();
  return o;
}

async function leerFilas() {
  await ensureSheet(ID, HOJA);
  const filas = await readSheet(ID, RANGO);
  if (!filas.length) { await writeSheetRaw(ID, `${HOJA}!A1`, [CABECERA]); return []; }
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const cod = (filas[i][COL.codigo] == null ? '' : filas[i][COL.codigo]).toString().trim();
    if (!cod) continue;
    lista.push(filaAObjeto(filas[i], i));
  }
  return lista;
}

async function listar() {
  const lista = await leerFilas();
  // Los más nuevos abajo → se muestran arriba; disponibles primero.
  return lista.map(c => ({ ...c, vencido: c.estado === DISPONIBLE && vencido(c.fecha_vencimiento) }));
}

async function resumen() {
  const lista = await leerFilas();
  const disponibles = lista.filter(c => c.estado === DISPONIBLE && !vencido(c.fecha_vencimiento));
  const vencidos = lista.filter(c => c.estado === DISPONIBLE && vencido(c.fecha_vencimiento));
  const usados = lista.filter(c => c.estado === USADO);
  return { total: lista.length, disponibles: disponibles.length, usados: usados.length, vencidos: vencidos.length };
}

/**
 * Importa un pegado de dos columnas (Código  Fecha de vencimiento). Acepta tabulador,
 * comas o espacios como separador y salta la cabecera. No añade códigos repetidos.
 */
async function importar(texto) {
  const existentes = new Set((await leerFilas()).map(c => c.codigo));
  const vistos = new Set();
  const nuevas = [];
  let duplicados = 0, invalidos = 0;

  for (const linea of String(texto || '').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const partes = l.split(/[\t;,]+|\s{1,}/).map(s => s.trim()).filter(Boolean);
    const codigo = (partes[0] || '').replace(/\D/g, '');
    const fecha = (partes[1] || '').trim();
    if (!/^\d{4,}$/.test(codigo)) { if (!/c[oó]digo/i.test(partes[0] || '')) invalidos++; continue; }  // cabecera o basura
    if (existentes.has(codigo) || vistos.has(codigo)) { duplicados++; continue; }
    vistos.add(codigo);
    nuevas.push([codigo, fecha, DISPONIBLE, '', '', '']);
  }

  if (nuevas.length) {
    await ensureSheet(ID, HOJA);
    const filas = await readSheet(ID, RANGO);
    if (!filas.length) await writeSheetRaw(ID, `${HOJA}!A1`, [CABECERA]);
    await appendRows(ID, RANGO, nuevas);
  }
  return { añadidos: nuevas.length, duplicados, invalidos };
}

/**
 * Entrega un código LIBRE (Disponible y no vencido) para un conductor y lo marca
 * "Usado" anotando su teléfono e ID_BOLT. Devuelve { codigo, fecha_vencimiento } o
 * null si no quedan. Lo usa el bot de WhatsApp.
 */
async function solicitarCodigo({ telefono, idBolt } = {}) {
  const filas = await readSheet(ID, RANGO);
  let fila = -1, obj = null;
  for (let i = 1; i < filas.length; i++) {
    const o = filaAObjeto(filas[i], i);
    if (!o.codigo) continue;
    if (o.estado === DISPONIBLE && !vencido(o.fecha_vencimiento)) { fila = i + 1; obj = o; break; }
  }
  if (!obj) return null;   // no quedan códigos libres

  // Marca ESTADO..FECHA_USO (C:F) de esa fila en un solo escritura.
  await writeSheetRaw(ID, `${HOJA}!C${fila}:F${fila}`, [[USADO, String(telefono || ''), String(idBolt || ''), ahora()]]);
  return { codigo: obj.codigo, fecha_vencimiento: obj.fecha_vencimiento };
}

/**
 * Borra los códigos NO usados que ya vencieron (Disponible + fecha pasada). Los
 * Usados se conservan siempre (histórico). Se llama a mano desde Administración y
 * automáticamente cada día por un cron.
 */
async function purgarVencidos() {
  const filas = await readSheet(ID, RANGO);
  const aBorrar = [];
  for (let i = 1; i < filas.length; i++) {
    const o = filaAObjeto(filas[i], i);
    if (!o.codigo) continue;
    if (o.estado === DISPONIBLE && vencido(o.fecha_vencimiento)) aBorrar.push(i + 1);   // nº de fila (1-based)
  }
  if (!aBorrar.length) return { borrados: 0 };
  const idHoja = (await getSheetIds(ID))[HOJA];
  if (idHoja == null) throw new Error('No encuentro la hoja codigos_ballenoil');
  await deleteRows(ID, idHoja, aBorrar);
  return { borrados: aBorrar.length };
}

module.exports = { importar, listar, resumen, solicitarCodigo, purgarVencidos, INSTRUCTIVO, HOJA, DISPONIBLE, USADO };
