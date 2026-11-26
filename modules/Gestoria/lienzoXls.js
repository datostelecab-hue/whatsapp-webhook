// ============================================================
// EL LIENZO DE A3 EN .XLS — escribir las variables sin rehacer el fichero
// ============================================================
// Módulo 4 del plan de RR. HH. («primero la prueba del Excel: abrir el
// original, escribir valores y comparar celda a celda»). El lienzo que manda la
// gestoría es la plantilla de importación de A3NOM: un .xls (Excel 97-2003,
// BIFF8) con la hoja «Conceptos» protegida, un trabajador por fila (B el
// código, C el nombre) y una columna por concepto («066 - PACTO PR (I)») en la
// fila 8. Y va CIFRADO con la clave por defecto de Excel («VelvetSweatshop»,
// RC4 CryptoAPI): es lo que Excel hace con un libro protegido sin contraseña de
// apertura. ExcelJS no lee ni escribe .xls, y una librería que lo reescriba
// entero perdería lo que A3 necesita (la fila 1 oculta, los nombres definidos,
// la protección). Así que aquí se toca lo mínimo:
//
//   1. el contenedor OLE2 (Compound File): se lee el flujo «Workbook» y se
//      guardan los demás tal cual;
//   2. se descifra el flujo (RC4 con SHA-1, una clave por cada bloque de 1024
//      bytes; las cabeceras de los registros y unos pocos registros van en
//      claro);
//   3. en la hoja, solo las celdas de los importes: una cifra (NUMBER) donde
//      había un hueco (BLANK o un trozo de MULBLANK), con el MISMO formato
//      (XF: desbloqueada, como estaba); el resto de la fila no se toca;
//   4. se recalculan los índices que apuntan a posiciones (INDEX, DBCELL, y la
//      posición de la hoja en BOUNDSHEET si hiciera falta) y la extensión de la
//      fila (ROW, DIMENSION);
//   5. se vuelve a cifrar con la misma sal y la misma clave, y se monta el
//      OLE2 con los mismos flujos.
//
// La prueba de que no rompe nada: leído y vuelto a montar SIN cambios, el flujo
// sale idéntico byte a byte (`identico`); y escrito, se compara celda a celda
// con el original (todo igual salvo las celdas escritas).
// Formatos: [MS-CFB], [MS-XLS] 2.4 (registros), [MS-OFFCRYPTO] 2.3.5 (RC4 CryptoAPI).
'use strict';

const crypto = require('crypto');

const CLAVE_EXCEL = 'VelvetSweatshop';
const T = {
  BOF: 0x0809, EOF: 0x000A, FILEPASS: 0x002F, BOUNDSHEET: 0x0085, INDEX: 0x020B, DBCELL: 0x00D7, ROW: 0x0208,
  BLANK: 0x0201, MULBLANK: 0x00BE, NUMBER: 0x0203, RK: 0x027E, MULRK: 0x00BD, LABELSST: 0x00FD, LABEL: 0x0204,
  FORMULA: 0x0006, BOOLERR: 0x0205, SST: 0x00FC, CONTINUE: 0x003C, DIMENSION: 0x0200, INTERFACEHDR: 0x00E1,
  USREXCL: 0x0194, FILELOCK: 0x0195, RRDINFO: 0x0196, RRDHEAD: 0x0138,
};
const CELDA = new Set([T.BLANK, T.MULBLANK, T.NUMBER, T.RK, T.MULRK, T.LABELSST, T.LABEL, T.FORMULA, T.BOOLERR]);
// Los que van en claro en un flujo cifrado ([MS-XLS] 2.2.10).
const EN_CLARO = new Set([T.BOF, T.FILEPASS, T.USREXCL, T.FILELOCK, T.INTERFACEHDR, T.RRDINFO, T.RRDHEAD]);

const error = msg => Object.assign(new Error(msg), { status: 400 });

// ── OLE2 (Compound File Binary) ─────────────────────────────────────────────
function leerOle(buf) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) throw error('No es un .xls de Excel 97-2003');
  const SEC = 1 << buf.readUInt16LE(30);
  const numFat = buf.readUInt32LE(44), dirStart = buf.readUInt32LE(48), miniCutoff = buf.readUInt32LE(56);
  const difStart = buf.readUInt32LE(68), numDif = buf.readUInt32LE(72);
  const off = s => 512 + s * SEC;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < numFat; i++) fatSecs.push(buf.readUInt32LE(76 + i * 4));
  for (let d = difStart, k = 0; k < numDif; k++) {
    for (let i = 0; i < SEC / 4 - 1 && fatSecs.length < numFat; i++) fatSecs.push(buf.readUInt32LE(off(d) + i * 4));
    d = buf.readUInt32LE(off(d) + SEC - 4);
  }
  const fat = [];
  fatSecs.forEach(s => { for (let i = 0; i < SEC / 4; i++) fat.push(buf.readUInt32LE(off(s) + i * 4)); });
  const cadena = s => { const out = []; for (let n = 0; s < 0xFFFFFFFA; n++) { if (n > fat.length) throw error('El .xls está dañado'); out.push(s); s = fat[s]; } return out; };
  const leer = (s, n) => Buffer.concat(cadena(s).map(x => buf.subarray(off(x), off(x) + SEC))).subarray(0, n);
  const dir = leer(dirStart, cadena(dirStart).length * SEC);
  const entradas = [];
  for (let i = 0; i < dir.length / 128; i++) {
    const e = Buffer.from(dir.subarray(i * 128, i * 128 + 128));
    entradas.push(e);
  }
  const flujos = new Map();
  entradas.forEach((e, i) => {
    const nl = e.readUInt16LE(64);
    if (!nl || e[66] !== 2) return;
    const tam = e.readUInt32LE(120);
    if (tam < miniCutoff) throw error('El .xls trae flujos pequeños (mini stream): no previsto');
    flujos.set(i, leer(e.readUInt32LE(116), tam));
  });
  const nombre = e => e.subarray(0, Math.max(0, e.readUInt16LE(64) - 2)).toString('utf16le');
  const iWb = entradas.findIndex(e => e.readUInt16LE(64) && e[66] === 2 && /^(Workbook|Book)$/.test(nombre(e)));
  if (iWb < 0) throw error('El .xls no tiene libro (Workbook)');
  return { SEC, entradas, flujos, iWb, cabecera: Buffer.from(buf.subarray(0, 512)) };
}

/** Monta el OLE2 otra vez: los mismos directorios y flujos, en sectores seguidos. */
function escribirOle(ole, flujos) {
  const SEC = 512;
  if (ole.SEC !== 512) throw error('Solo se escriben .xls con sectores de 512 bytes');
  const sectoresDe = n => Math.ceil(n / SEC);
  const orden = [...flujos.keys()].sort((a, b) => a - b);
  const nDir = sectoresDe(ole.entradas.length * 128);
  let nDatos = nDir;
  orden.forEach(i => { nDatos += sectoresDe(flujos.get(i).length); });
  // Los sectores de la FAT se cuentan a sí mismos.
  let nFat = 1;
  while (nFat * (SEC / 4) < nDatos + nFat) nFat++;
  if (nFat > 109) throw error('El .xls sale demasiado grande para este escritor');
  const total = nFat + nDatos;
  const fat = new Array(nFat * (SEC / 4)).fill(0xFFFFFFFF);
  for (let i = 0; i < nFat; i++) fat[i] = 0xFFFFFFFD;          // FATSECT
  let s = nFat;
  const encadenar = n => { const ini = s; for (let k = 0; k < n; k++) { fat[s] = k === n - 1 ? 0xFFFFFFFE : s + 1; s++; } return ini; };
  const dirIni = encadenar(nDir);
  const inicios = new Map();
  orden.forEach(i => inicios.set(i, encadenar(sectoresDe(flujos.get(i).length))));
  const out = Buffer.alloc(512 + total * SEC);
  ole.cabecera.copy(out, 0, 0, 512);
  out.writeUInt16LE(9, 30);
  out.writeUInt32LE(nFat, 44);
  out.writeUInt32LE(dirIni, 48);
  out.writeUInt32LE(0xFFFFFFFE, 60); out.writeUInt32LE(0, 64);  // sin mini FAT
  out.writeUInt32LE(0xFFFFFFFE, 68); out.writeUInt32LE(0, 72);  // sin DIFAT extra
  for (let i = 0; i < 109; i++) out.writeUInt32LE(i < nFat ? i : 0xFFFFFFFF, 76 + i * 4);
  const off = x => 512 + x * SEC;
  fat.forEach((v, i) => out.writeUInt32LE(v >>> 0, off(0) + i * 4));
  ole.entradas.forEach((e, i) => {
    const copia = Buffer.from(e);
    if (flujos.has(i)) { copia.writeUInt32LE(inicios.get(i), 116); copia.writeUInt32LE(flujos.get(i).length, 120); }
    copia.copy(out, off(dirIni) + i * 128);
  });
  orden.forEach(i => flujos.get(i).copy(out, off(inicios.get(i))));
  return out;
}

// ── El cifrado: RC4 CryptoAPI ([MS-OFFCRYPTO] 2.3.5) ─────────────────────────
function rc4(clave) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + clave[i % clave.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
  let i = 0, j = 0;
  return n => {
    const out = Buffer.alloc(n);
    for (let k = 0; k < n; k++) { i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]]; out[k] = S[(S[i] + S[j]) & 255]; }
    return out;
  };
}
const sha1 = (...b) => crypto.createHash('sha1').update(Buffer.concat(b)).digest();

/** Lee el FILEPASS (RC4 CryptoAPI) y prueba la clave. → { claveDe(bloque) } */
function claveDelFilepass(datos, clave = CLAVE_EXCEL) {
  if (datos.readUInt16LE(0) !== 1) throw error('El .xls usa un cifrado que no es RC4');
  const mayor = datos.readUInt16LE(2), menor = datos.readUInt16LE(4);
  if (mayor < 2 || menor !== 2) throw error('El .xls usa un RC4 antiguo, no CryptoAPI: no previsto');
  const tamCab = datos.readUInt32LE(10);
  const cab = datos.subarray(14, 14 + tamCab);
  let bits = cab.readUInt32LE(16);
  if (!bits) bits = 40;
  const ver = datos.subarray(14 + tamCab);
  const sal = ver.subarray(4, 20), verif = ver.subarray(20, 36), hashCifrado = ver.subarray(40, 60);
  const h0 = sha1(sal, Buffer.from(clave, 'utf16le'));
  const claveDe = bloque => {
    const b = Buffer.alloc(4); b.writeUInt32LE(bloque, 0);
    const h = sha1(h0, b);
    return bits === 40 ? Buffer.concat([h.subarray(0, 5), Buffer.alloc(11)]) : h.subarray(0, bits / 8);
  };
  // El verificador y su hash van cifrados seguidos con la clave del bloque 0.
  const flujo = rc4(claveDe(0));
  const ks = flujo(16 + 20);
  const v = Buffer.from(verif.map((x, i) => x ^ ks[i]));
  const hv = Buffer.from(hashCifrado.map((x, i) => x ^ ks[16 + i]));
  if (!sha1(v).equals(hv)) throw error('El .xls está cifrado con una contraseña: pídele a la gestoría uno sin contraseña de apertura');
  return { claveDe };
}

/** XOR del flujo entero con la secuencia de RC4, con clave nueva cada 1024 bytes. */
function xorRc4(flujo, claveDe) {
  const out = Buffer.from(flujo);
  for (let ini = 0, bloque = 0; ini < out.length; ini += 1024, bloque++) {
    const n = Math.min(1024, out.length - ini);
    const ks = rc4(claveDe(bloque))(n);
    for (let i = 0; i < n; i++) out[ini + i] ^= ks[i];
  }
  return out;
}

/** Lo que va en claro en un flujo cifrado: cabeceras, unos registros y la posición de BOUNDSHEET. */
function trozosEnClaro(registros) {
  const claro = [];
  registros.forEach(r => {
    claro.push([r.p, r.p + 4]);
    if (EN_CLARO.has(r.t)) claro.push([r.p + 4, r.p + 4 + r.n]);
    else if (r.t === T.BOUNDSHEET) claro.push([r.p + 4, r.p + 8]);
  });
  return claro;
}

function registrosDe(flujo) {
  const out = [];
  for (let p = 0; p + 4 <= flujo.length;) {
    const t = flujo.readUInt16LE(p), n = flujo.readUInt16LE(p + 2);
    if (p + 4 + n > flujo.length) throw error('El .xls está cortado');
    out.push({ p, t, n });
    p += 4 + n;
  }
  return out;
}

/** El flujo en claro y cómo volver a cifrarlo. */
function descifrar(cifrado, clave = CLAVE_EXCEL) {
  const regs = registrosDe(cifrado);
  const fp = regs.find(r => r.t === T.FILEPASS);
  if (!fp) return { claro: cifrado, cifrar: f => f, cifrado: false };
  const { claveDe } = claveDelFilepass(cifrado.subarray(fp.p + 4, fp.p + 4 + fp.n), clave);
  const xor = xorRc4(cifrado, claveDe);
  trozosEnClaro(regs).forEach(([a, b]) => cifrado.copy(xor, a, a, b));
  const cifrar = claro => {
    const c = xorRc4(claro, claveDe);
    trozosEnClaro(registrosDe(claro)).forEach(([a, b]) => claro.copy(c, a, a, b));
    return c;
  };
  return { claro: xor, cifrar, cifrado: true };
}

// ── BIFF8: textos, cifras y la hoja ─────────────────────────────────────────
/** La tabla de textos compartidos (SST), con sus CONTINUE. */
function leerSst(claro, regs) {
  const i = regs.findIndex(r => r.t === T.SST);
  if (i < 0) return [];
  const trozos = [claro.subarray(regs[i].p + 4, regs[i].p + 4 + regs[i].n)];
  for (let j = i + 1; regs[j] && regs[j].t === T.CONTINUE; j++) trozos.push(claro.subarray(regs[j].p + 4, regs[j].p + 4 + regs[j].n));
  const total = trozos[0].readUInt32LE(4);
  let t = 0, p = 8;
  const quedan = () => trozos[t].length - p;
  const sig = () => { t++; p = 0; };
  const u8 = () => { if (!quedan()) sig(); return trozos[t][p++]; };
  const u16 = () => { if (quedan() < 2) sig(); const v = trozos[t].readUInt16LE(p); p += 2; return v; };
  const u32 = () => { if (quedan() < 4) sig(); const v = trozos[t].readUInt32LE(p); p += 4; return v; };
  const saltar = n => { while (n > 0) { if (!quedan()) sig(); const m = Math.min(n, quedan()); p += m; n -= m; } };
  const out = [];
  for (let s = 0; s < total; s++) {
    const cch = u16();
    let flags = u8();
    const ricos = flags & 8 ? u16() : 0, ext = flags & 4 ? u32() : 0;
    let txt = '', falta = cch;
    while (falta > 0) {
      if (!quedan()) { sig(); flags = trozos[t][p++]; }
      const ancho = flags & 1 ? 2 : 1;
      const n = Math.min(falta, Math.floor(quedan() / ancho));
      const trozo = trozos[t].subarray(p, p + n * ancho);
      txt += ancho === 2 ? trozo.toString('utf16le') : trozo.toString('latin1');
      p += n * ancho; falta -= n;
    }
    saltar(ricos * 4 + ext);
    out.push(txt);
  }
  return out;
}

function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else { const b = Buffer.alloc(8); b.writeInt32LE(v & 0xFFFFFFFC, 4); n = b.readDoubleLE(0); }
  return v & 1 ? n / 100 : n;
}

/** La hoja: sus registros (con su posición), y lo que vale cada celda. */
function leerHoja(claro) {
  const regs = registrosDe(claro);
  const sst = leerSst(claro, regs);
  const bs = regs.find(r => r.t === T.BOUNDSHEET);
  if (!bs) throw error('El .xls no tiene hojas');
  const ini = claro.readUInt32LE(bs.p + 4);
  const a = regs.findIndex(r => r.p === ini);
  if (a < 0 || regs[a].t !== T.BOF) throw error('El .xls está dañado: la hoja no empieza donde dice');
  let b = a + 1;
  while (regs[b] && regs[b].t !== T.EOF) b++;
  const valores = new Map();   // 'fila,col' → valor
  const poner = (row, col, v) => valores.set(`${row},${col}`, v);
  for (let i = a; i <= b; i++) {
    const r = regs[i], d = claro.subarray(r.p + 4, r.p + 4 + r.n);
    if (!CELDA.has(r.t)) continue;
    const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
    if (r.t === T.LABELSST) poner(row, col, sst[d.readUInt32LE(6)]);
    else if (r.t === T.NUMBER) poner(row, col, d.readDoubleLE(6));
    else if (r.t === T.RK) poner(row, col, rk(d.readInt32LE(6)));
    else if (r.t === T.MULRK) { const fin = d.readUInt16LE(r.n - 2); for (let c = col; c <= fin; c++) poner(row, c, rk(d.readInt32LE(4 + (c - col) * 6 + 2))); }
  }
  return { regs, sst, ini: a, fin: b, valores, bsPos: bs.p };
}

// ── Escribir ─────────────────────────────────────────────────────────────────
const rec = (t, datos) => { const h = Buffer.alloc(4); h.writeUInt16LE(t, 0); h.writeUInt16LE(datos.length, 2); return Buffer.concat([h, datos]); };
const numero = (row, col, xf, v) => { const d = Buffer.alloc(14); d.writeUInt16LE(row, 0); d.writeUInt16LE(col, 2); d.writeUInt16LE(xf, 4); d.writeDoubleLE(v, 6); return rec(T.NUMBER, d); };
const huecos = (row, cols) => {     // [{col, xf}] seguidas → BLANK o MULBLANK
  if (!cols.length) return [];
  if (cols.length === 1) { const d = Buffer.alloc(6); d.writeUInt16LE(row, 0); d.writeUInt16LE(cols[0].col, 2); d.writeUInt16LE(cols[0].xf, 4); return [rec(T.BLANK, d)]; }
  const d = Buffer.alloc(6 + cols.length * 2);
  d.writeUInt16LE(row, 0); d.writeUInt16LE(cols[0].col, 2);
  cols.forEach((c, i) => d.writeUInt16LE(c.xf, 4 + i * 2));
  d.writeUInt16LE(cols[cols.length - 1].col, 4 + cols.length * 2);
  return [rec(T.MULBLANK, d)];
};

/**
 * Escribe cifras en celdas vacías de la hoja y rehace sus índices.
 * `cambios`: Map('fila,col' → número), filas y columnas en base 0.
 * → { claro (el flujo nuevo), escritas, ocupadas: [{ celda, antes }] (lo que ya tenía y se sustituyó), faltan }
 */
function escribirCeldas(claro, cambios) {
  const h = leerHoja(claro);
  const { regs } = h;
  const piezas = [];         // { buf, t, row?, esFila? }
  const escritas = [], ocupadas = [];
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    const bruto = claro.subarray(r.p, r.p + 4 + r.n);
    const d = bruto.subarray(4);
    const enHoja = i > h.ini && i < h.fin;
    if (enHoja && (r.t === T.BLANK || r.t === T.MULBLANK)) {
      const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
      const cols = r.t === T.BLANK ? [{ col, xf: d.readUInt16LE(4) }]
        : Array.from({ length: d.readUInt16LE(r.n - 2) - col + 1 }, (_, k) => ({ col: col + k, xf: d.readUInt16LE(4 + k * 2) }));
      if (!cols.some(c => cambios.has(`${row},${c.col}`))) { piezas.push({ buf: bruto, t: r.t, row }); continue; }
      let tramo = [];
      for (const c of cols) {
        const v = cambios.get(`${row},${c.col}`);
        if (v == null) { tramo.push(c); continue; }
        huecos(row, tramo).forEach(b => piezas.push({ buf: b, t: T.BLANK, row }));
        tramo = [];
        piezas.push({ buf: numero(row, c.col, c.xf, v), t: T.NUMBER, row });
        escritas.push(`${row},${c.col}`);
      }
      huecos(row, tramo).forEach(b => piezas.push({ buf: b, t: T.BLANK, row }));
      continue;
    }
    // UNA CIFRA QUE YA ESTABA (el lienzo puede venir con importes): se
    // sustituye, con su mismo formato, y se dice qué había. Un texto o una
    // fórmula no se tocan.
    if (enHoja && (r.t === T.NUMBER || r.t === T.RK)) {
      const row = d.readUInt16LE(0), col = d.readUInt16LE(2), xf = d.readUInt16LE(4);
      const v = cambios.get(`${row},${col}`);
      if (v == null) { piezas.push({ buf: bruto, t: r.t, row }); continue; }
      ocupadas.push({ celda: `${row},${col}`, antes: r.t === T.NUMBER ? d.readDoubleLE(6) : rk(d.readInt32LE(6)) });
      piezas.push({ buf: numero(row, col, xf, v), t: T.NUMBER, row });
      escritas.push(`${row},${col}`);
      continue;
    }
    if (enHoja && r.t === T.MULRK) {
      const row = d.readUInt16LE(0), col = d.readUInt16LE(2), fin = d.readUInt16LE(r.n - 2);
      const cols = Array.from({ length: fin - col + 1 }, (_, k) => ({ col: col + k, xf: d.readUInt16LE(4 + k * 6), rk: d.readInt32LE(6 + k * 6) }));
      if (!cols.some(c => cambios.has(`${row},${c.col}`))) { piezas.push({ buf: bruto, t: r.t, row }); continue; }
      // Cada una por separado: las que no cambian, como RK con su formato.
      for (const c of cols) {
        const v = cambios.get(`${row},${c.col}`);
        if (v == null) {
          const x = Buffer.alloc(10); x.writeUInt16LE(row, 0); x.writeUInt16LE(c.col, 2); x.writeUInt16LE(c.xf, 4); x.writeInt32LE(c.rk, 6);
          piezas.push({ buf: rec(T.RK, x), t: T.RK, row });
        } else {
          ocupadas.push({ celda: `${row},${c.col}`, antes: rk(c.rk) });
          piezas.push({ buf: numero(row, c.col, c.xf, v), t: T.NUMBER, row });
          escritas.push(`${row},${c.col}`);
        }
      }
      continue;
    }
    if (enHoja && CELDA.has(r.t)) {
      const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
      if (cambios.has(`${row},${col}`)) ocupadas.push({ celda: `${row},${col}`, antes: 'texto o fórmula: no se toca' });
      piezas.push({ buf: bruto, t: r.t, row });
      continue;
    }
    piezas.push({ buf: Buffer.from(bruto), t: r.t, row: r.t === T.ROW ? d.readUInt16LE(0) : undefined });
  }
  // LAS QUE NO EXISTÍAN (la fila no tiene registro en esa columna): se crean,
  // en su sitio (las celdas de una fila van por orden de columna) y con el
  // formato que tiene esa columna en las demás filas; la fila y la hoja
  // ensanchan su extensión si hace falta.
  const colDe = x => (x.t === T.ROW || !CELDA.has(x.t) ? null : x.buf.readUInt16LE(6));
  const xfDeColumna = new Map();
  piezas.forEach(x => {
    if (!CELDA.has(x.t) || x.row == null) return;
    const c0 = x.buf.readUInt16LE(6);
    if (x.t === T.MULBLANK) { const fin = x.buf.readUInt16LE(x.buf.length - 2); for (let c = c0; c <= fin; c++) if (!xfDeColumna.has(c)) xfDeColumna.set(c, x.buf.readUInt16LE(8 + (c - c0) * 2)); }
    else if (!xfDeColumna.has(c0)) xfDeColumna.set(c0, x.buf.readUInt16LE(8));
  });
  const faltan = [];
  const nuevas = [...cambios.keys()].filter(k2 => !escritas.includes(k2) && !ocupadas.some(o => o.celda === k2));
  for (const k2 of nuevas) {
    const [row, col] = k2.split(',').map(Number);
    const deFila = piezas.map((x, i) => ({ x, i })).filter(({ x }) => CELDA.has(x.t) && x.row === row);
    if (!deFila.length) { faltan.push(k2); continue; }
    const xf = xfDeColumna.has(col) ? xfDeColumna.get(col) : deFila[deFila.length - 1].x.buf.readUInt16LE(8);
    const despues = deFila.find(({ x }) => colDe(x) > col);
    const en = despues ? despues.i : deFila[deFila.length - 1].i + 1;
    piezas.splice(en, 0, { buf: numero(row, col, xf, cambios.get(k2)), t: T.NUMBER, row });
    escritas.push(k2);
    // La fila: primera columna y la siguiente a la última.
    const fila = piezas.find(x => x.t === T.ROW && x.row === row);
    if (fila) {
      if (col < fila.buf.readUInt16LE(6)) fila.buf.writeUInt16LE(col, 6);
      if (col + 1 > fila.buf.readUInt16LE(8)) fila.buf.writeUInt16LE(col + 1, 8);
    }
    const dim = piezas.find(x => x.t === T.DIMENSION);
    if (dim && col + 1 > dim.buf.readUInt16LE(14)) dim.buf.writeUInt16LE(col + 1, 14);
  }
  const nuevo = Buffer.concat(piezas.map(x => x.buf));
  return { claro: reindexar(nuevo, h), escritas, ocupadas, faltan };
}

/** Rehace las posiciones: BOUNDSHEET, INDEX y cada DBCELL. */
function reindexar(claro, antes) {
  const regs = registrosDe(claro);
  const bofs = regs.filter(r => r.t === T.BOF);
  const bs = regs.find(r => r.t === T.BOUNDSHEET);
  // La hoja es el segundo BOF (el primero es el libro). Las celdas van después de la hoja: su inicio no cambia, pero se escribe igual.
  claro.writeUInt32LE(bofs[1].p, bs.p + 4);
  const a = regs.indexOf(bofs[1]);
  let b = a + 1;
  while (regs[b] && regs[b].t !== T.EOF) b++;
  const hoja = regs.slice(a, b + 1);
  const dbcells = [];
  // Cada bloque: hasta 32 ROW seguidos, sus celdas y un DBCELL.
  for (let i = 0; i < hoja.length; i++) {
    if (hoja[i].t !== T.ROW) continue;
    const filas = [];
    while (hoja[i] && hoja[i].t === T.ROW) { filas.push(hoja[i]); i++; }
    const celdas = [];
    while (hoja[i] && hoja[i].t !== T.DBCELL && hoja[i].t !== T.ROW) { celdas.push(hoja[i]); i++; }
    const db = hoja[i];
    if (!db || db.t !== T.DBCELL) continue;
    dbcells.push(db.p);
    claro.writeUInt32LE(db.p - filas[0].p, db.p + 4);
    // rgdb: la primera, desde el SEGUNDO ROW hasta la primera celda de la primera fila;
    // las demás, desde la primera celda de la fila anterior.
    let previa = filas.length > 1 ? filas[1].p : filas[0].p + 4 + filas[0].n;
    const primeraDe = new Map();
    celdas.forEach(c => { const row = claro.readUInt16LE(c.p + 4); if (!primeraDe.has(row)) primeraDe.set(row, c.p); });
    filas.forEach((f, k) => {
      if (4 + 4 + k * 2 + 2 > 4 + db.n) return;
      const row = claro.readUInt16LE(f.p + 4);
      const p = primeraDe.has(row) ? primeraDe.get(row) : previa;
      claro.writeUInt16LE(p - previa, db.p + 8 + k * 2);
      previa = p;
    });
    i--;
  }
  const idx = hoja.find(r => r.t === T.INDEX);
  if (idx) {
    const n = (idx.n - 16) / 4;
    if (n !== dbcells.length) throw error(`El índice de la hoja no cuadra (${n} bloques en INDEX, ${dbcells.length} DBCELL)`);
    dbcells.forEach((p, k) => claro.writeUInt32LE(p, idx.p + 4 + 16 + k * 4));
    // ibXF: la posición de DEFCOLWIDTH (0x0055), si está.
    const dcw = hoja.find(r => r.t === 0x0055);
    if (dcw) claro.writeUInt32LE(dcw.p, idx.p + 4 + 12);
  }
  void antes;
  return claro;
}

// ── Lo que se usa desde fuera ────────────────────────────────────────────────
/** Lee el lienzo: la fila de la cabecera, sus columnas por concepto y sus filas por código. */
// `clave`: la de apertura; el lienzo de A3 va con la de Excel (las pruebas usan otra).
function leerLienzo(buffer, { clave } = {}) {
  const ole = leerOle(buffer);
  const { claro, cifrado } = descifrar(Buffer.from(ole.flujos.get(ole.iWb)), clave);
  const h = leerHoja(claro);
  // La cabecera: la fila donde está «Código».
  let filaCab = null;
  h.valores.forEach((v, k2) => { if (filaCab == null && typeof v === 'string' && v.trim() === 'Código' && k2.endsWith(',1')) filaCab = Number(k2.split(',')[0]); });
  if (filaCab == null) throw error('El lienzo no tiene la fila de cabecera («Código» en la columna B)');
  const columnas = new Map();   // código de concepto → { col, cabecera }
  h.valores.forEach((v, k2) => {
    const [row, col] = k2.split(',').map(Number);
    if (row !== filaCab || col < 3 || typeof v !== 'string') return;
    const m = v.trim().match(/^(\d{1,4})\s*-/);
    if (m) columnas.set(m[1].padStart(3, '0'), { col, cabecera: v });
  });
  const filas = new Map();      // código del trabajador (sin ceros) → { row, nombre }
  h.valores.forEach((v, k2) => {
    const [row, col] = k2.split(',').map(Number);
    if (row <= filaCab || col !== 1 || v === '' || v == null) return;
    const codigo = String(typeof v === 'number' ? Math.round(v) : String(v).trim()).replace(/^0+/, '');
    if (codigo) filas.set(codigo, { row, nombre: String(h.valores.get(`${row},2`) || '') });
  });
  return { ole, claro, cifrado, filaCab, columnas, filas, valores: h.valores };
}

/**
 * Rellena el lienzo con las líneas: [{ codigo (legajo), concepto ('066'), importe }].
 * Suma las del mismo código y concepto. → { buffer, escritas, sinFila, sinColumna, ocupadas }
 */
function rellenarLienzo(buffer, lineas, { clave } = {}) {
  const l = leerLienzo(buffer, { clave });
  const suma = new Map();
  const sinFila = new Set(), sinColumna = new Set();
  for (const x of lineas) {
    const codigo = String(x.codigo || '').replace(/^0+/, '');
    const concepto = String(x.concepto || '').padStart(3, '0');
    const fila = l.filas.get(codigo), col = l.columnas.get(concepto);
    if (!fila) { sinFila.add(codigo || '(sin código)'); continue; }
    if (!col) { sinColumna.add(concepto); continue; }
    const k2 = `${fila.row},${col.col}`;
    suma.set(k2, Math.round(((suma.get(k2) || 0) + Number(x.importe)) * 100) / 100);
  }
  const cambios = new Map([...suma].filter(([, v]) => v !== 0));
  const flujo = Buffer.from(l.ole.flujos.get(l.ole.iWb));
  const { claro, cifrar } = descifrar(flujo, clave);
  const r = escribirCeldas(claro, cambios);
  const flujos = new Map(l.ole.flujos);
  flujos.set(l.ole.iWb, cifrar(r.claro));
  // Cada celda, con quién y qué concepto es.
  const quien = new Map([...l.filas].map(([codigo, f]) => [f.row, { codigo, nombre: f.nombre }]));
  const que = new Map([...l.columnas].map(([concepto, c]) => [c.col, concepto]));
  const deCelda = k2 => { const [row, col] = k2.split(',').map(Number); return { ...(quien.get(row) || {}), concepto: que.get(col) || null }; };
  return { buffer: escribirOle(l.ole, flujos), escritas: r.escritas.length,
    ocupadas: r.ocupadas.map(o => ({ ...deCelda(o.celda), antes: o.antes, ahora: cambios.get(o.celda) })),
    faltan: r.faltan.map(deCelda),
    sinFila: [...sinFila], sinColumna: [...sinColumna], trabajadores: l.filas.size, conceptos: [...l.columnas.keys()], cifrado: l.cifrado };
}

/** La prueba de ida y vuelta: leído y montado sin cambios, ¿sale idéntico? */
function identico(buffer, { clave } = {}) {
  const ole = leerOle(buffer);
  const flujo = ole.flujos.get(ole.iWb);
  const { claro, cifrar } = descifrar(Buffer.from(flujo), clave);
  const r = escribirCeldas(claro, new Map());
  return cifrar(r.claro).equals(flujo);
}

module.exports = { leerLienzo, rellenarLienzo, identico, _leerOle: leerOle, _descifrar: descifrar, _leerHoja: leerHoja, _escribirOle: escribirOle };
