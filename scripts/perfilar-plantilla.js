// ============================================================
// PERFILAR EL FICHERO DE RRHH antes de cargarlo
// ============================================================
//   node scripts/perfilar-plantilla.js ["ruta/al/PLANTILLA TRABAJADORES.xlsx"]
//
// Mirar cuatro filas de un Excel y decidir no es medir. Esto cuenta: cuántas
// filas de verdad hay en cada pestaña, qué porcentaje de cada columna viene
// relleno, cuáles de las que parecen fechas lo son, y si las pestañas se pueden
// cruzar entre ellas.
//
// Se pasa ANTES de cargar y se vuelve a pasar cuando RRHH manda una versión
// nueva. Lo que salga en rojo aquí es lo que hay que pedirles que arreglen,
// porque después de cargar ya no se distingue un hueco de un cero.

const ExcelJS = require('exceljs');

const RUTA = process.argv[2] || 'C:/Users/ricar/Downloads/PLANTILLA TRABAJADORES.xlsx';

const txt = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return txt(v.result);
    if (v.hyperlink) return '';
    return '';
  }
  return String(v);
};
const s = v => txt(v).trim();

// Emojis y adornos fuera: en la base no pintan nada y estropean cualquier
// comparación. Lo que queda es el valor de verdad.
const limpio = v => s(v).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();

/** ¿Esto es una fecha? Devuelve el año, o null. Sirve para cazar los 0206. */
function anioDe(v) {
  if (v instanceof Date) return v.getFullYear();
  const t = s(v);
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { const a = Number(m[3]); return a < 100 ? 2000 + a : a; }
  const i = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return i ? Number(i[1]) : null;
}

const PARECE_FECHA = /fecha|inicio|fin|ingreso|baja|nacimiento/i;
const pct = (n, t) => t ? Math.round(n * 100 / t) + '%' : '—';

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RUTA);
  console.log('\n' + RUTA + '\n');

  const hojas = {};

  for (const ws of wb.worksheets) {
    // La cabecera es la primera fila con cuatro o más celdas con texto.
    let hCab = 0, cab = [];
    for (let i = 1; i <= Math.min(10, ws.rowCount); i++) {
      const v = ws.getRow(i).values.slice(1).map(s);
      if (v.filter(Boolean).length >= 4) { hCab = i; cab = v; break; }
    }
    if (!hCab) { console.log(`=== ${ws.name} === sin cabecera reconocible\n`); continue; }

    // Filas de verdad: las que tienen algo en las tres primeras columnas con
    // nombre. Las que solo traen un valor suelto son restos de la exportación.
    const filas = [];
    for (let i = hCab + 1; i <= ws.rowCount; i++) {
      const v = ws.getRow(i).values.slice(1);
      const llenas = cab.map((c, k) => c ? s(v[k]) : '').filter(Boolean).length;
      if (llenas >= 3) filas.push(v);
    }
    hojas[ws.name] = { cab, filas };

    console.log(`=== ${ws.name} ===`);
    console.log(`  cabecera en la fila ${hCab} · ${filas.length} filas con datos ` +
                `(de ${ws.rowCount - hCab} posibles)`);

    for (let k = 0; k < cab.length; k++) {
      const nom = cab[k];
      if (!nom) continue;
      const vals = filas.map(f => limpio(f[k]));
      const llenos = vals.filter(Boolean);
      const aviso = [];

      if (PARECE_FECHA.test(nom)) {
        const anios = llenos.map(v => anioDe(v));
        const noFecha = llenos.filter((v, i) => anios[i] === null);
        const raras = anios.filter(a => a !== null && (a < 1930 || a > 2030));
        if (noFecha.length) {
          const muestra = [...new Set(noFecha)].slice(0, 3).join(', ');
          aviso.push(`${noFecha.length} NO son fecha (${muestra})`);
        }
        if (raras.length) aviso.push(`${raras.length} con año imposible (${[...new Set(raras)].slice(0, 3).join(', ')})`);
      }

      // Columnas de pocos valores: se listan enteras, dicen más que un
      // porcentaje.
      const distintos = new Set(llenos);
      if (distintos.size && distintos.size <= 6 && !PARECE_FECHA.test(nom)) {
        aviso.push('valores: ' + [...distintos].slice(0, 6).join(' / '));
      }

      const marca = llenos.length === 0 ? '  VACIA  '
                  : llenos.length < filas.length * 0.5 ? '  ojo    '
                  : '         ';
      console.log(`  ${marca}${pct(llenos.length, filas.length).padStart(4)}  ${nom}` +
                  (aviso.length ? '   -> ' + aviso.join(' · ') : ''));
    }
    console.log('');
  }

  // ── ¿Se pueden cruzar las pestañas? ──
  // BAJAS MEDICAS no trae DNI: solo nombre y numero de afiliacion. Si el NAF no
  // cuadra con el de PLANTILLA, hay que cruzar por nombre, que es justo lo que
  // queriamos dejar de hacer.
  const col = (h, re) => { const i = (hojas[h] || {cab:[]}).cab.findIndex(c => re.test(c || '')); return i; };
  const norm = v => limpio(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

  const P = hojas['PLANTILLA'];
  if (P) {
    const iP = col('PLANTILLA', /NAF\(Prov\)/i), iN = col('PLANTILLA', /NAF\(N.m\)/i);
    const nafs = new Set(), dnis = new Set(), nombres = new Set();
    const iD = col('PLANTILLA', /^DNI$/i), iT = col('PLANTILLA', /Apellidos y Nombre|TRABAJADOR/i);
    for (const f of P.filas) {
      if (iP >= 0 && iN >= 0 && s(f[iP]) && s(f[iN])) nafs.add(norm(s(f[iP]) + s(f[iN])));
      if (iD >= 0 && s(f[iD])) dnis.add(norm(f[iD]));
      if (iT >= 0 && s(f[iT])) nombres.add(norm(f[iT]));
    }
    console.log('=== SE CRUZAN LAS PESTAÑAS? ===');
    console.log(`  PLANTILLA: ${P.filas.length} personas · ${dnis.size} DNI distintos · ${nafs.size} NAF distintos`);
    if (dnis.size && dnis.size < P.filas.length) {
      console.log(`  ojo  ${P.filas.length - dnis.size} fila(s) sin DNI o con DNI repetido`);
    }

    for (const [hoja, reClave, tipo] of [
      ['BAJAS MEDICAS', /Afiliaci.n/i, 'naf'],
      ['VACACIONES',    /^DNI$/i,      'dni'],
      ['PLANTILLA ETT', /^DNI$/i,      'dni'],
    ]) {
      const H = hojas[hoja];
      if (!H) continue;
      const i = col(hoja, reClave);
      const iNom = col(hoja, /Nombre Trabajador|TRABAJADOR/i);
      let cuadran = 0, porNombre = 0, sinNada = 0;
      for (const f of H.filas) {
        const clave = i >= 0 ? norm(f[i]) : '';
        const conjunto = tipo === 'naf' ? nafs : dnis;
        if (clave && conjunto.has(clave)) cuadran++;
        else if (iNom >= 0 && nombres.has(norm(f[iNom]))) porNombre++;
        else sinNada++;
      }
      console.log(`  ${hoja.padEnd(15)} ${String(H.filas.length).padStart(4)} filas -> ` +
        `${cuadran} por ${tipo.toUpperCase()} · ${porNombre} solo por nombre · ${sinNada} sin cuadrar`);
    }
    console.log('');
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
