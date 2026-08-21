// ============================================================
// CARGA DE VEHÍCULOS desde los Excel al núcleo de PostgreSQL
// ============================================================
//   node scripts/cargar-vehiculos.js [carpeta]
//
// La hoja VEHICULOS de Trafico 2.0 está VACÍA (una sola fila), así que el
// maestro de coches se reconstruye desde PLANIFICADOR_V2, que es lo único que
// hay: cabecera en la fila 8, seis filas por coche (Día, Noche, CT1 Día, CT1
// Noche, CT2 Día, CT2 Noche) y las columnas ESTADO_VEHICULO, MATRICULA y ZONA.
//
// Del coche solo se sabe MATRÍCULA y ESTADO. La ZONA viene en la misma columna
// de al lado y se carga también porque el esquema ya la tiene y no cuesta nada;
// si no la queréis, se quita de aquí y ya.
//
// El estado '✓' de la hoja pasa a 'O' en la base: en la base de datos no entran
// símbolos ni emojis, eso es cosa de la interfaz.

const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../services/db');

const NL = String.fromCharCode(10);
const DIR = process.argv[2] || 'C:/Users/ricar/Downloads';
const LIBRO = 'Trafico 2.0.xlsx';

const txt = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return txt(v.result);
    return '';
  }
  return String(v);
};
const s = v => txt(v).trim();
const matricula = v => {
  const x = s(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[0-9]{4}[A-Z]{3}$/.test(x) ? x : null;   // formato español actual
};

// Lo que hay en la hoja → códigos de cat_estado_vehiculo.
const ESTADO = { '✓': 'O', 'S': 'S', 'T': 'T', 'X': 'X', 'R': 'R', 'B': 'B' };

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DIR, LIBRO));

  // ── 1) Bases ──
  const wsB = wb.getWorksheet('BASES');
  const bases = [];
  wsB.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri < 2) return;
    const nombre = s(r.getCell(1).value);
    const lat = parseFloat(String(s(r.getCell(3).value)).replace(',', '.'));
    const lng = parseFloat(String(s(r.getCell(4).value)).replace(',', '.'));
    if (nombre && isFinite(lat) && isFinite(lng)) bases.push({ nombre, lat, lng });
  });
  console.log(`  BASES: ${bases.length}`);

  // ── 2) Coches del planificador ──
  const ws = wb.getWorksheet('PLANIFICADOR_V2');
  const CAB = 8;
  const cab = (ws.getRow(CAB).values || []).slice(1).map(v => s(v).toUpperCase());
  const col = n => cab.indexOf(n) + 1;
  const cMat = col('MATRICULA'), cEst = col('ESTADO_VEHICULO'), cZona = col('ZONA');
  if (!cMat || !cEst) throw new Error('No encuentro MATRICULA o ESTADO_VEHICULO en la fila 8');

  const coches = new Map();          // matrícula → { estado, zona }
  const estadosRaros = new Map();
  let filasLeidas = 0, sinMatricula = 0;
  ws.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri <= CAB) return;
    filasLeidas++;
    const m = matricula(r.getCell(cMat).value);
    if (!m) { if (s(r.getCell(cMat).value)) sinMatricula++; return; }
    const bruto = s(r.getCell(cEst).value);
    const est = ESTADO[bruto];
    if (bruto && !est) estadosRaros.set(bruto, (estadosRaros.get(bruto) || 0) + 1);
    const zona = cZona ? s(r.getCell(cZona).value) : '';
    // Las 6 filas del coche repiten el mismo estado; se queda el primero no vacío.
    const y = coches.get(m);
    if (!y) coches.set(m, { estado: est || null, zona: zona || null });
    else {
      if (!y.estado && est) y.estado = est;
      if (!y.zona && zona) y.zona = zona;
    }
  });
  console.log(`  PLANIFICADOR_V2: ${filasLeidas} filas → ${coches.size} matrículas distintas` +
              (sinMatricula ? ` · ${sinMatricula} celdas con texto que no es matrícula` : ''));
  if (estadosRaros.size) {
    console.log('  ⚠️  estados no reconocidos: ' +
      [...estadosRaros].map(([k, n]) => JSON.stringify(k) + '×' + n).join(' '));
  }
  const porEstado = {};
  coches.forEach(v => { const k = v.estado || '(sin estado)'; porEstado[k] = (porEstado[k] || 0) + 1; });
  console.log('  por estado: ' + Object.entries(porEstado).map(([k, v]) => k + '=' + v).join(' · '));

  // ── 3) A la base ──
  let nBases = 0, nCoches = 0, nHistEst = 0, nHistBase = 0;
  const avisos = [];
  await db.transaccion(async cli => {
    const intentar = async (sql, params, alFallar) => {
      await cli.query('SAVEPOINT sp');
      try { const r = await cli.query(sql, params); await cli.query('RELEASE SAVEPOINT sp'); return r; }
      catch (err) { await cli.query('ROLLBACK TO SAVEPOINT sp'); if (alFallar) alFallar(err); return null; }
    };

    const idBase = new Map();
    for (const b of bases) {
      const r = await intentar(
        `INSERT INTO base_zona (nombre, lat, lng) VALUES ($1,$2,$3)
         ON CONFLICT (nombre_norm) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng
         RETURNING id, nombre`,
        [b.nombre.slice(0, 80), b.lat, b.lng],
        err => avisos.push(`Base no cargada (${b.nombre}): ${err.message}`));
      if (r) { idBase.set(b.nombre.trim().toLowerCase(), r.rows[0].id); nBases++; }
    }

    // Zonas que usa el planificador y no están en BASES: se crean sin coordenadas
    // para no perder la asignación del coche.
    const zonasSueltas = new Set();
    coches.forEach(v => { if (v.zona && !idBase.has(v.zona.toLowerCase())) zonasSueltas.add(v.zona); });
    for (const z of zonasSueltas) {
      const r = await intentar(
        `INSERT INTO base_zona (nombre, lat, lng, activa) VALUES ($1,0,0,FALSE)
         ON CONFLICT (nombre_norm) DO NOTHING RETURNING id`,
        [z.slice(0, 80)], () => {});
      if (r && r.rows[0]) { idBase.set(z.toLowerCase(), r.rows[0].id); nBases++; }
    }
    if (zonasSueltas.size) console.log(`  zonas del planificador que no estaban en BASES: ${zonasSueltas.size}`);

    const hoy = new Date().toISOString().slice(0, 10);
    for (const [mat, v] of coches) {
      const estado = v.estado || 'O';   // sin estado se asume operativo
      const zonaId = v.zona ? idBase.get(v.zona.toLowerCase()) || null : null;
      const r = await intentar(
        `INSERT INTO vehiculo (matricula, estado_operativo, base_zona_id) VALUES ($1,$2,$3) RETURNING id`,
        [mat, estado, zonaId],
        err => avisos.push(`Coche no creado (${mat}): ${err.message.split(NL)[0]}`));
      if (!r) continue;
      nCoches++;
      const id = r.rows[0].id;

      // Se abre el historial hoy: no sabemos desde cuándo está así, y fingir una
      // fecha anterior sería inventarse datos.
      const h1 = await intentar(
        `INSERT INTO vehiculo_estado_hist (vehiculo_id, estado_codigo, desde) VALUES ($1,$2,$3)`,
        [id, estado, hoy], () => {});
      if (h1) nHistEst++;
      if (zonaId) {
        const h2 = await intentar(
          `INSERT INTO vehiculo_base_hist (vehiculo_id, base_zona_id, desde) VALUES ($1,$2,$3)`,
          [id, zonaId, hoy], () => {});
        if (h2) nHistBase++;
      }
    }
  });

  console.log(NL + `══ EN LA BASE ══`);
  console.log(`  bases ${nBases} · coches ${nCoches} · historial de estado ${nHistEst} · historial de zona ${nHistBase}`);

  const q = await db.consulta(`
    SELECT e.codigo, e.etiqueta, count(v.id) coches
    FROM cat_estado_vehiculo e LEFT JOIN vehiculo v ON v.estado_operativo = e.codigo
    GROUP BY e.codigo, e.etiqueta, e.orden ORDER BY e.orden`);
  q.rows.forEach(r => console.log(`  ${r.codigo}  ${r.etiqueta.padEnd(12)} ${r.coches}`));

  const z = await db.consulta(`
    SELECT b.nombre, count(v.id) coches FROM base_zona b
    LEFT JOIN vehiculo v ON v.base_zona_id = b.id GROUP BY b.nombre ORDER BY 2 DESC`);
  console.log(NL + '  por zona: ' + z.rows.map(r => `${r.nombre}=${r.coches}`).join(' · '));

  if (avisos.length) {
    console.log(NL + `══ ${avisos.length} avisos ══`);
    avisos.slice(0, 10).forEach(a => console.log('  · ' + a));
  }
  await db.cerrar();
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
