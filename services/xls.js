// ============================================================
// LEER UN .XLS (Excel 97-2003) — sin librerías (25/11/2026)
// ============================================================
// La gestoría manda sus ficheros de A3NOM en .xls (el formato binario antiguo,
// BIFF8 dentro de un «Compound File»), y ExcelJS solo entiende .xlsx. En vez de
// añadir una dependencia, esto lee lo que hace falta: las hojas, los textos,
// los números y el resultado de las fórmulas. NO escribe.
//
//   const libro = xls.leer(buffer);
//   libro.hojas  → [{ nombre, oculta, filas: [[valor, …], …] }]   (fila 0 = la 1 de Excel)
//   xls.valor(hoja, 'B9')  → el valor de una celda
//
// Lo que no hace falta para leer datos (formatos, estilos, comentarios,
// imágenes) se salta. Un fichero cifrado con contraseña de apertura no se
// puede leer y se dice; la protección de hoja no cifra nada y no molesta.
'use strict';

const FIN = 0xFFFFFFFE;
const LIBRE = 0xFFFFFFFF;

// ── El contenedor (Compound File Binary) ───────────────────────────────────
function contenedor(buf) {
  const firma = buf.slice(0, 8).toString('hex');
  if (firma !== 'd0cf11e0a1b11ae1') throw new Error('No es un Excel .xls (97-2003)');
  const tSector = 1 << buf.readUInt16LE(0x1E);
  const tMini = 1 << buf.readUInt16LE(0x20);
  const nFat = buf.readUInt32LE(0x2C);
  const primerDir = buf.readUInt32LE(0x30);
  const corte = buf.readUInt32LE(0x38);
  const primerMiniFat = buf.readUInt32LE(0x3C);
  let difat = buf.readUInt32LE(0x44);
  const nDifat = buf.readUInt32LE(0x48);

  const sector = n => buf.slice(512 + n * tSector, 512 + (n + 1) * tSector);
  // Dónde están los sectores de la FAT: los 109 de la cabecera y, si hay más, la cadena DIFAT.
  const sectoresFat = [];
  for (let i = 0; i < 109 && sectoresFat.length < nFat; i++) {
    const s = buf.readUInt32LE(0x4C + i * 4);
    if (s !== LIBRE) sectoresFat.push(s);
  }
  for (let k = 0; k < nDifat && difat !== FIN && difat !== LIBRE; k++) {
    const d = sector(difat);
    for (let i = 0; i < tSector / 4 - 1 && sectoresFat.length < nFat; i++) {
      const s = d.readUInt32LE(i * 4);
      if (s !== LIBRE) sectoresFat.push(s);
    }
    difat = d.readUInt32LE(tSector - 4);
  }
  const fat = [];
  for (const s of sectoresFat) { const d = sector(s); for (let i = 0; i < tSector; i += 4) fat.push(d.readUInt32LE(i)); }

  const cadena = (inicio, tabla) => {
    const out = [];
    const vistos = new Set();
    for (let s = inicio; s !== FIN && s !== LIBRE && s < tabla.length; s = tabla[s]) {
      if (vistos.has(s)) throw new Error('El .xls está dañado (una cadena de sectores se repite)');
      vistos.add(s); out.push(s);
    }
    return out;
  };
  const flujo = inicio => Buffer.concat(cadena(inicio, fat).map(sector));

  // El directorio: entradas de 128 bytes.
  const dir = flujo(primerDir);
  const entradas = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const largo = dir.readUInt16LE(o + 0x40);
    const tipo = dir[o + 0x42];
    if (!tipo) continue;
    entradas.push({
      nombre: dir.slice(o, o + Math.max(0, largo - 2)).toString('utf16le'),
      tipo, inicio: dir.readUInt32LE(o + 0x74), tam: dir.readUInt32LE(o + 0x78),
    });
  }
  const raiz = entradas.find(e => e.tipo === 5);
  let miniFlujo = null, miniFat = null;
  const leerFlujo = e => {
    if (e.tam >= corte || e.tipo === 5) return flujo(e.inicio).slice(0, e.tam);
    if (!miniFlujo) {
      miniFlujo = flujo(raiz.inicio);
      miniFat = [];
      const mf = flujo(primerMiniFat);
      for (let i = 0; i < mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
    }
    return Buffer.concat(cadena(e.inicio, miniFat).map(n => miniFlujo.slice(n * tMini, (n + 1) * tMini))).slice(0, e.tam);
  };
  return { entradas, leerFlujo };
}

// ── Los números RK (un número en 4 bytes) ──────────────────────────────────
function rk(v) {
  let n;
  if (v & 2) n = v >> 2;                      // entero con signo de 30 bits
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((v & 0xFFFFFFFC) >>> 0, 4);   // los 30 bits altos de un double
    n = b.readDoubleLE(0);
  }
  return v & 1 ? n / 100 : n;
}

// ── Leer cadenas que pueden seguir en registros CONTINUE ───────────────────
// `trozos`: los datos del registro y de sus CONTINUE, por separado. Al cortarse
// una cadena entre dos trozos, el siguiente empieza con un byte de opciones que
// dice si los caracteres que siguen van en 1 o en 2 bytes.
function lector(trozos) {
  let t = 0, o = 0;
  const quedan = () => trozos[t].length - o;
  const avanzar = () => { while (t < trozos.length && o >= trozos[t].length) { t++; o = 0; } };
  const u8 = () => { avanzar(); const v = trozos[t][o]; o += 1; return v; };
  const u16 = () => { avanzar(); if (quedan() >= 2) { const v = trozos[t].readUInt16LE(o); o += 2; return v; } return u8() | (u8() << 8); };
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const saltar = n => { while (n > 0) { avanzar(); const k = Math.min(n, quedan()); o += k; n -= k; } };
  function cadena() {
    const cch = u16();
    let opc = u8();
    const rica = opc & 8 ? u16() : 0;
    const ext = opc & 4 ? u32() : 0;
    let s = '';
    let falta = cch;
    while (falta > 0) {
      avanzar();
      if (o === 0 && s.length) opc = (opc & ~1) | (trozos[t][o++] & 1);   // byte de opciones del CONTINUE
      const ancho = opc & 1 ? 2 : 1;
      const caben = Math.min(falta, Math.floor(quedan() / ancho));
      if (caben <= 0) { t++; o = 0; continue; }
      const trozo = trozos[t].slice(o, o + caben * ancho);
      s += ancho === 2 ? trozo.toString('utf16le') : trozo.toString('latin1');
      o += caben * ancho; falta -= caben;
      if (falta > 0) { t++; o = 0; if (t < trozos.length) { opc = (opc & ~1) | (trozos[t][0] & 1); o = 1; } }
    }
    saltar(rica * 4 + ext);
    return s;
  }
  return { u8, u16, u32, cadena, fin: () => { avanzar(); return t >= trozos.length; } };
}

/** Una cadena de un registro sin CONTINUE: cch (1 o 2 bytes), opciones y caracteres. */
function cadenaCorta(d, o, cchDeUnByte) {
  const cch = cchDeUnByte ? d[o] : d.readUInt16LE(o);
  o += cchDeUnByte ? 1 : 2;
  const opc = d[o]; o += 1;
  return opc & 1 ? d.slice(o, o + cch * 2).toString('utf16le') : d.slice(o, o + cch).toString('latin1');
}

// ── El cifrado que Excel pone solo (RC4 CryptoAPI) ─────────────────────────
// Un libro con la estructura o la escritura protegidas sale cifrado con la
// contraseña por defecto de Excel, «VelvetSweatshop», y Excel lo abre sin
// preguntar. Así llega la proforma de A3NOM. Se descifra con esa contraseña
// (MS-OFFCRYPTO 2.3.5: SHA-1, bloques de 1024 bytes); si el fichero lleva una
// contraseña de verdad, el comprobante no cuadra y se dice.
const crypto = require('crypto');
const CONTRASENA_EXCEL = 'VelvetSweatshop';
// Registros que nunca van cifrados (aunque cuentan para la posición del cifrado).
const SIN_CIFRAR = new Set([0x0809, 0x002F, 0x0194, 0x0195, 0x00E1, 0x0196, 0x0138]);

function rc4(clave) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + clave[i % clave.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  let i = 0, j = 0;
  return n => {
    const out = Buffer.alloc(n);
    for (let k = 0; k < n; k++) {
      i = (i + 1) & 255; j = (j + S[i]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = S[(S[i] + S[j]) & 255];
    }
    return out;
  };
}

/** Descifra el flujo del libro. `fp` son los datos del registro FILEPASS. */
function descifrar(s, fp) {
  if (fp.readUInt16LE(0) !== 1) throw new Error('El .xls está cifrado con un método antiguo que no se puede leer: ábrelo en Excel y guárdalo de nuevo');
  const mayor = fp.readUInt16LE(2);
  const { claveDe } = mayor === 1 ? claveRc4(fp) : claveCryptoApi(fp);
  return aplicar(s, claveDe);
}

const NO_ABRE = 'El .xls tiene contraseña de apertura: hay que abrirlo en Excel, quitársela y subirlo otra vez';

/** RC4 de Office 97 (versión 1.1, MD5): el que pone Excel al proteger la estructura. */
function claveRc4(fp) {
  const sal = fp.slice(6, 22), verif = fp.slice(22, 38), hashVerif = fp.slice(38, 54);
  const md5 = b => crypto.createHash('md5').update(b).digest();
  const h0 = md5(Buffer.from(CONTRASENA_EXCEL, 'utf16le')).slice(0, 5);
  const relleno = Buffer.concat(Array.from({ length: 16 }, () => Buffer.concat([h0, sal])));
  const h1 = md5(relleno).slice(0, 5);
  const claveDe = bloque => { const b = Buffer.alloc(4); b.writeUInt32LE(bloque, 0); return md5(Buffer.concat([h1, b])); };
  const ks = rc4(claveDe(0))(32);
  const v = Buffer.from(verif.map((x, k) => x ^ ks[k]));
  const hv = Buffer.from(hashVerif.map((x, k) => x ^ ks[16 + k]));
  if (!md5(v).equals(hv)) throw new Error(NO_ABRE);
  return { claveDe };
}

/** RC4 CryptoAPI (versiones 2 a 4, SHA-1): el de la proforma de A3NOM. */
function claveCryptoApi(fp) {
  const tamCab = fp.readUInt32LE(10);
  const cab = fp.slice(14, 14 + tamCab);
  const bitsClave = cab.readUInt32LE(16) || 40;
  let o = 14 + tamCab;
  const tamSal = fp.readUInt32LE(o); o += 4;
  const sal = fp.slice(o, o + tamSal); o += tamSal;
  const verif = fp.slice(o, o + 16); o += 16;
  const tamHash = fp.readUInt32LE(o); o += 4;
  const hashVerif = fp.slice(o, o + tamHash);

  const h0 = crypto.createHash('sha1').update(Buffer.concat([sal, Buffer.from(CONTRASENA_EXCEL, 'utf16le')])).digest();
  const claveDe = bloque => {
    const b = Buffer.alloc(4); b.writeUInt32LE(bloque, 0);
    const h = crypto.createHash('sha1').update(Buffer.concat([h0, b])).digest();
    const k = h.slice(0, bitsClave / 8);
    return bitsClave === 40 ? Buffer.concat([k, Buffer.alloc(11)]) : k;
  };
  // El comprobante: con la clave del bloque 0, el verificador y su hash seguidos.
  const ks = rc4(claveDe(0))(16 + tamHash);
  const v = Buffer.from(verif.map((x, k) => x ^ ks[k]));
  const hv = Buffer.from(hashVerif.map((x, k) => x ^ ks[16 + k]));
  if (!crypto.createHash('sha1').update(v).digest().equals(hv.slice(0, 20))) throw new Error(NO_ABRE);
  return { claveDe };
}

/** Descifra los datos de los registros con el flujo de claves de `claveDe(bloque)`. */
function aplicar(s, claveDe) {
  // El flujo de claves, por bloques de 1024 bytes del flujo entero (cabeceras incluidas).
  const bloques = new Map();
  const byte = pos => {
    const b = Math.floor(pos / 1024);
    if (!bloques.has(b)) bloques.set(b, rc4(claveDe(b))(1024));
    return bloques.get(b)[pos % 1024];
  };
  const out = Buffer.from(s);
  let pasado = false;
  for (let p = 0; p + 4 <= s.length;) {
    const tipo = s.readUInt16LE(p), largo = s.readUInt16LE(p + 2);
    const ini = p + 4;
    if (pasado && !SIN_CIFRAR.has(tipo)) {
      const desde = tipo === 0x0085 ? 4 : 0;   // en BOUNDSHEET, la posición de la hoja va en claro
      for (let k = desde; k < largo; k++) out[ini + k] = s[ini + k] ^ byte(ini + k);
    }
    if (tipo === 0x002F) pasado = true;
    p = ini + largo;
  }
  return out;
}

// ── El libro (BIFF8) ───────────────────────────────────────────────────────
/** Lee un .xls: { hojas: [{ nombre, oculta, filas }] }. */
function leer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { entradas, leerFlujo } = contenedor(buf);
  const wb = entradas.find(e => e.nombre === 'Workbook') || entradas.find(e => e.nombre === 'Book');
  if (!wb) throw new Error('El .xls no tiene libro dentro (no es un Excel)');
  let s = leerFlujo(wb);
  let cifrado = false;
  // ¿Cifrado? El FILEPASS va justo detrás del primer BOF.
  for (let o = 0, n = 0; o + 4 <= s.length && n < 8; n++) {
    const tipo = s.readUInt16LE(o), largo = s.readUInt16LE(o + 2);
    if (tipo === 0x002F) { s = descifrar(s, s.slice(o + 4, o + 4 + largo)); cifrado = true; break; }
    o += 4 + largo;
  }

  // Todos los registros: tipo, posición y datos.
  const regs = [];
  for (let o = 0; o + 4 <= s.length;) {
    const tipo = s.readUInt16LE(o), largo = s.readUInt16LE(o + 2);
    regs.push({ tipo, pos: o, datos: s.slice(o + 4, o + 4 + largo) });
    o += 4 + largo;
  }

  // Lo global: las hojas y la tabla de textos compartidos (SST).
  const hojas = [];
  let sst = [];
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    if (r.tipo === 0x0085) {
      hojas.push({ pos: r.datos.readUInt32LE(0), oculta: (r.datos[4] & 3) !== 0, tipo: r.datos[5], nombre: cadenaCorta(r.datos, 6, true) });
    } else if (r.tipo === 0x00FC) {
      const trozos = [r.datos.slice(8)];
      for (let j = i + 1; j < regs.length && regs[j].tipo === 0x003C; j++) trozos.push(regs[j].datos);
      const n = r.datos.readUInt32LE(4);
      const l = lector(trozos);
      sst = [];
      for (let k = 0; k < n && !l.fin(); k++) sst.push(l.cadena());
    } else if (r.tipo === 0x000A) break;   // EOF de lo global
  }

  // Cada hoja de cálculo, desde su BOF hasta su EOF.
  const salida = [];
  for (const h of hojas.filter(x => x.tipo === 0)) {
    const celdas = [];
    const poner = (f, c, v) => { (celdas[f] = celdas[f] || [])[c] = v; };
    let i = regs.findIndex(r => r.pos === h.pos);
    if (i < 0) continue;
    let pendienteTexto = null;   // la fórmula que da un texto: el texto va en el STRING siguiente
    for (i += 1; i < regs.length && regs[i].tipo !== 0x000A; i++) {
      const { tipo, datos: d } = regs[i];
      if (tipo === 0x00FD) poner(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
      else if (tipo === 0x0203) poner(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
      else if (tipo === 0x027E) poner(d.readUInt16LE(0), d.readUInt16LE(2), rk(d.readUInt32LE(6)));
      else if (tipo === 0x00BD) {
        const f = d.readUInt16LE(0), c0 = d.readUInt16LE(2), n = (d.length - 6) / 6;
        for (let k = 0; k < n; k++) poner(f, c0 + k, rk(d.readUInt32LE(4 + k * 6 + 2)));
      } else if (tipo === 0x0204) poner(d.readUInt16LE(0), d.readUInt16LE(2), cadenaCorta(d, 6, false));
      else if (tipo === 0x0006) {
        const f = d.readUInt16LE(0), c = d.readUInt16LE(2);
        if (d.readUInt16LE(12) === 0xFFFF) {
          const clase = d[6];
          if (clase === 0) pendienteTexto = [f, c];
          else if (clase === 1) poner(f, c, !!d[8]);
          else if (clase === 3) poner(f, c, '');
        } else poner(f, c, d.readDoubleLE(6));
      } else if (tipo === 0x0207 && pendienteTexto) {
        poner(pendienteTexto[0], pendienteTexto[1], cadenaCorta(d, 0, false));
        pendienteTexto = null;
      }
    }
    const filas = [];
    for (let f = 0; f < celdas.length; f++) filas.push(celdas[f] ? Array.from(celdas[f], v => (v === undefined ? null : v)) : []);
    salida.push({ nombre: h.nombre, oculta: h.oculta, filas });
  }
  return { hojas: salida, cifrado };
}

/** «B9» → [fila, columna] desde 0. */
function posicion(ref) {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(String(ref).toUpperCase());
  if (!m) throw new Error(`Celda no válida: ${ref}`);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, c - 1];
}

/** El valor de una celda de una hoja leída («B9»), o null. */
function valor(hoja, ref) {
  const [f, c] = posicion(ref);
  const fila = hoja.filas[f];
  return fila && fila[c] !== undefined ? fila[c] : null;
}

module.exports = { leer, valor, posicion, _rk: rk };
