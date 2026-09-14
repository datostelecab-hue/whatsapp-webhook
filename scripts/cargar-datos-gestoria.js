// ============================================================
// RELLENAR LO QUE FALTA DEL FICHERO DE LA GESTORÍA
// ============================================================
//   node scripts/cargar-datos-gestoria.js            dice qué haría
//   node scripts/cargar-datos-gestoria.js --go       lo escribe
//   node scripts/cargar-datos-gestoria.js --go "ruta/al.xlsx"
//
// La migración inicial cargó la plantilla desde "PLANTILLA TRABAJADORES.xlsx"
// pero se dejó seis campos por el camino. No se notaba en ninguna pantalla
// —nadie los mira— hasta que hizo falta devolverle a la gestoría SU MISMO
// fichero: seis de las cuarenta columnas salían en blanco.
//
// Los seis están en ese Excel y en ninguna otra parte:
//
//   País Nacimiento / Cod.País Nacimiento   el país de nacimiento (18 distintos)
//   País / Cod.País                         el de la dirección
//   Centro                                  00003 o 00002
//   TRABAJADOR                              el nombre como lo escribe la
//                                           Seguridad Social, que NO es
//                                           "apellidos, nombre" siempre
//
// ── SOLO RELLENA HUECOS ─────────────────────────────────────────────────────
// Nunca pisa un dato que ya esté puesto. Si alguien corrigió a mano su país
// porque el fichero de la gestoría estaba mal, esa corrección gana: el fichero
// es de agosto y la base se ha seguido tocando desde entonces.
//
// Cruza por DNI, que es la identidad de esta migración. Nunca por nombre: el
// mismo nombre escrito de dos formas es la causa número uno de cruzar a dos
// personas distintas.

const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../services/db');

const GO = process.argv.includes('--go');
const RUTA = process.argv.slice(2).find(a => !a.startsWith('--')) ||
             'C:/Users/ricar/Downloads/PLANTILLA TRABAJADORES.xlsx';
const NL = String.fromCharCode(10);

const s = v => (v == null ? '' : (v.text !== undefined ? String(v.text) : String(v))).trim();
const dniLimpio = v => s(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
const nulo = (v, max) => { const t = s(v); return t ? t.slice(0, max) : null; };

// Los seis campos, con la columna del Excel de la que sale cada uno.
const CAMPOS = [
  ['pais_nacimiento',        'País Nacimiento',     60],
  ['pais_nacimiento_codigo', 'Cod.País Nacimiento',  5],
  ['pais',                   'País',                60],
  ['pais_codigo',            'Cod.País',             5],
  ['centro_codigo',          'Centro',              10],
  ['nombre_ss',              'TRABAJADOR',         200],
];

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RUTA);
  const ws = wb.getWorksheet('PLANTILLA');
  if (!ws) throw new Error('Falta la pestaña PLANTILLA en ' + RUTA);

  // Cabecera en la fila 3, datos desde la 4. Si el fichero cambia de forma,
  // esto falla en voz alta y no a medias.
  const cab = ws.getRow(3).values.slice(1).map(s);
  const iDni = cab.indexOf('DNI');
  if (iDni < 0) throw new Error('No encuentro la columna DNI en la fila 3');

  const porDni = new Map();
  for (let i = 4; i <= ws.rowCount; i++) {
    const v = ws.getRow(i).values.slice(1);
    const dni = dniLimpio(v[iDni]);
    if (!dni) continue;
    const o = {};
    for (const [campo, col, max] of CAMPOS) {
      const k = cab.indexOf(col);
      o[campo] = k >= 0 ? nulo(v[k], max) : null;
    }
    porDni.set(dni, o);
  }
  console.log(NL + RUTA);
  console.log('  ' + porDni.size + ' fila(s) con DNI en la pestaña PLANTILLA' + NL);

  // A quién le falta algo. Solo plantilla propia: el fichero es de esa pestaña.
  const r = await db.consulta(`
    SELECT c.id, c.dni_nie, btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS quien,
           ${CAMPOS.map(([k]) => 'c.' + k).join(', ')}
      FROM conductor c
      JOIN conductor_periodo_empleo pe ON pe.conductor_id = c.id AND pe.tipo = 'propia'
     WHERE NOT c.es_centinela AND c.dni_nie IS NOT NULL`);

  const cuenta = Object.fromEntries(CAMPOS.map(([k]) => [k, 0]));
  const cambios = [];
  const sinFicha = [];

  for (const p of r.rows) {
    const src = porDni.get(dniLimpio(p.dni_nie));
    if (!src) { sinFicha.push(p.quien); continue; }
    const set = {};
    for (const [campo] of CAMPOS) {
      // SOLO HUECOS: lo que ya tiene valor no se toca.
      if (p[campo] != null && String(p[campo]).trim() !== '') continue;
      if (src[campo] == null) continue;
      set[campo] = src[campo];
      cuenta[campo]++;
    }
    if (Object.keys(set).length) cambios.push({ id: p.id, quien: p.quien, set });
  }

  console.log('DE LOS ' + r.rowCount + ' DE PLANTILLA PROPIA:');
  console.log('  ' + cambios.length + ' con algo que rellenar');
  console.log('  ' + sinFicha.length + ' sin fila en el Excel (alta posterior a agosto)');
  console.log(NL + 'HUECOS QUE SE RELLENAN, POR CAMPO:');
  for (const [k, n] of Object.entries(cuenta)) console.log('  ' + k.padEnd(24) + n);

  if (cambios.length) {
    console.log(NL + 'Ejemplos:');
    cambios.slice(0, 3).forEach(c =>
      console.log('  ' + c.quien.padEnd(32) + JSON.stringify(c.set).slice(0, 90)));
  }

  if (!GO) {
    console.log(NL + 'Esto ha sido un ensayo. Para escribirlo: --go' + NL);
    return;
  }

  // Todo en una transacción: o se rellena entero o no se toca nada.
  await db.consulta('BEGIN');
  try {
    for (const c of cambios) {
      const claves = Object.keys(c.set);
      const sets = claves.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await db.consulta(`UPDATE conductor SET ${sets}, actualizado_at = now() WHERE id = $1`,
        [c.id, ...claves.map(k => c.set[k])]);
    }
    await db.consulta('COMMIT');
  } catch (e) {
    await db.consulta('ROLLBACK');
    throw e;
  }
  console.log(NL + cambios.length + ' persona(s) actualizada(s).' + NL);
})()
  .then(() => db.cerrar())
  .catch(e => { console.error('ERROR: ' + (e.stack || e.message)); process.exit(1); });
