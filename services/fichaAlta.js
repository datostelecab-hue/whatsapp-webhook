// ============================================================
// FICHA DE ALTA — genera el PDF "ALTA CONDUCTORES VTC"
// ============================================================
// Página 1: el formulario con los datos del conductor.
// Páginas siguientes: un documento por sección (DNI, carnet, etc.). Si el
// documento es una imagen se incrusta escalada; si ya es un PDF se copian sus
// páginas tal cual (poniendo la etiqueta arriba en la primera).
//
// Los campos fijos (empresa, centro, jornada, salario…) van por defecto pero se
// pueden sobreescribir pasándolos en `ficha`.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const A4 = [595.28, 841.89];
const M = 40;                       // margen
const ANCHO = A4[0] - 2 * M;        // ancho útil de la tabla

const NEGRO = rgb(0, 0, 0);
const BORDE = rgb(0.35, 0.35, 0.35);
const LABEL_BG = rgb(0.94, 0.94, 0.94);
const ROJO = rgb(0.72, 0.10, 0.10);      // cabeceras de sección
const ROJO_NOTA = rgb(0.80, 0.05, 0.05);
const AMARILLO = rgb(1, 0.93, 0.30);     // resaltado del título

// Valores fijos de la empresa (se pueden sobreescribir con la ficha).
const FIJOS = {
  localidad: 'MADRID',
  provincia: 'Madrid',
  tipo_carnet: 'B',
  tipo_contrato: 'INDEFINIDO',
  jornada: '40 HORAS',
  motivo: 'CONDUCTOR VTC',
  fin: 'INDEFINIDO',
  empresa: 'TIBUS LUXURY',
  centro: 'Avenida de Valdelaparra, 49, Alcobendas, España',
  salario: '1.442,14'
};

// pdf-lib usa WinAnsi: quita cualquier carácter fuera de ese set para no romper.
function limpio(s) {
  return String(s == null ? '' : s).replace(/ /g, ' ');
}

// Salario bruto mensual según la jornada: 32 h → 1.154,39 · resto (40 h) →
// 1.442,14. Un valor explícito en ficha.salario tiene prioridad.
function salarioDe(ficha) {
  if (ficha.salario) return limpio(ficha.salario);
  const h = String(ficha.jornada || FIJOS.jornada).replace(/\D/g, '');
  return h === '32' ? '1.154,39' : '1.442,14';
}

// Dibuja texto encogiéndolo hasta que quepa en maxW.
function texto(page, s, x, baseline, font, size, color, maxW) {
  s = limpio(s);
  let fs = size;
  if (maxW) { while (fs > 6 && font.widthOfTextAtSize(s, fs) > maxW) fs -= 0.5; }
  // Si aun al mínimo no cabe, recorta con puntos suspensivos.
  if (maxW && font.widthOfTextAtSize(s, fs) > maxW) {
    while (s.length > 1 && font.widthOfTextAtSize(s + '…', fs) > maxW) s = s.slice(0, -1);
    s += '…';
  }
  page.drawText(s, { x, y: baseline, size: fs, font, color: color || NEGRO });
}

/**
 * Dibuja una fila de celdas etiqueta/valor.
 * segmentos: [{label, value, lw, vw}] (anchos en pt). Devuelve la nueva y (top).
 */
function fila(page, top, h, segmentos, fonts) {
  let x = M;
  for (const seg of segmentos) {
    const lw = seg.lw, vw = seg.vw;
    // celda etiqueta
    page.drawRectangle({ x, y: top - h, width: lw, height: h, color: LABEL_BG, borderColor: BORDE, borderWidth: 0.7 });
    texto(page, seg.label, x + 4, top - h + (h - 7.5) / 2 + 1.5, fonts.bold, 7.5, NEGRO, lw - 8);
    x += lw;
    // celda valor
    page.drawRectangle({ x, y: top - h, width: vw, height: h, borderColor: BORDE, borderWidth: 0.7 });
    texto(page, seg.value, x + 5, top - h + (h - 9) / 2 + 1.5, fonts.reg, 9, NEGRO, vw - 10);
    x += vw;
  }
  return top - h;
}

// Fila de una sola celda ancha "ETIQUETA: valor".
function filaAncha(page, top, h, label, value, fonts) {
  page.drawRectangle({ x: M, y: top - h, width: ANCHO, height: h, borderColor: BORDE, borderWidth: 0.7 });
  const baseline = top - h + (h - 8.5) / 2 + 1.5;
  texto(page, label, M + 5, baseline, fonts.bold, 8.5, NEGRO);
  const lw = fonts.bold.widthOfTextAtSize(limpio(label), 8.5);
  texto(page, value, M + 5 + lw + 6, baseline, fonts.reg, 8.5, NEGRO, ANCHO - lw - 16);
  return top - h;
}

function esPng(b) { return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }
function esPdf(b) { return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; } // %PDF

/** Añade un documento (imagen incrustada o PDF copiado) con su etiqueta. */
async function anexarDocumento(pdf, fonts, label, bytes, mime) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdfDoc = mime === 'application/pdf' || esPdf(buf);

  if (pdfDoc) {
    let src;
    try { src = await PDFDocument.load(buf, { ignoreEncryption: true }); }
    catch (_) { return anexarError(pdf, fonts, label); }
    const paginas = await pdf.copyPages(src, src.getPageIndices());
    paginas.forEach((pg, i) => {
      pdf.addPage(pg);
      if (i === 0) {
        pg.drawText(limpio(label) + ':', { x: 22, y: pg.getHeight() - 22, size: 9, font: fonts.bold, color: NEGRO });
      }
    });
    return;
  }

  // Imagen
  const page = pdf.addPage(A4);
  const H = A4[1];
  texto(page, label + ':', M, H - M, fonts.bold, 10, NEGRO);
  let img;
  try { img = esPng(buf) ? await pdf.embedPng(buf) : await pdf.embedJpg(buf); }
  catch (_) { return; }   // formato no soportado (webp/heic): se omite la imagen
  const areaW = ANCHO, areaH = H - 2 * M - 22;
  const s = Math.min(areaW / img.width, areaH / img.height);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img, { x: M + (areaW - w) / 2, y: H - M - 22 - h, width: w, height: h });
}

function anexarError(pdf, fonts, label) {
  const page = pdf.addPage(A4);
  texto(page, label + ':', M, A4[1] - M, fonts.bold, 10, NEGRO);
  texto(page, '(No se pudo incrustar el documento)', M, A4[1] - M - 20, fonts.reg, 9, ROJO_NOTA);
}

/**
 * Genera el PDF de la ficha de alta.
 * @param {object} ficha  - datos del conductor (ticket).
 * @param {Array}  documentos - [{label, bytes, mime}] ya descargados.
 * @returns {Promise<Uint8Array>}
 */
async function generarFichaPDF(ficha = {}, documentos = []) {
  const pdf = await PDFDocument.create();
  const fonts = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const g = k => limpio(ficha[k] || '');
  const of = k => limpio(ficha[k] || FIJOS[k]);

  const page = pdf.addPage(A4);
  const H = A4[1];
  let y = H - M;

  // Título con resaltado amarillo (arriba a la derecha, como el original).
  const titulo = 'ALTA CONDUCTORES VTC';
  const tw = fonts.bold.widthOfTextAtSize(titulo, 13);
  page.drawRectangle({ x: A4[0] - M - tw - 6, y: y - 15, width: tw + 6, height: 17, color: AMARILLO });
  page.drawText(titulo, { x: A4[0] - M - tw - 3, y: y - 11, size: 13, font: fonts.bold, color: NEGRO });
  y -= 30;

  // ── DATOS PERSONALES ──
  texto(page, 'DATOS PERSONALES', M, y, fonts.bold, 10, ROJO);
  y -= 14;
  const HF = 22;   // alto de fila
  y = fila(page, y, HF, [{ label: 'NOMBRE', value: g('nombre'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'APELLIDOS', value: g('apellidos'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'DIRECCIÓN', value: g('direccion'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [
    { label: 'CÓDIGO POSTAL', value: g('codigo_postal'), lw: 90, vw: 70 },
    { label: 'LOCALIDAD', value: of('localidad'), lw: 70, vw: 70 },
    { label: 'PROVINCIA', value: of('provincia'), lw: 70, vw: 145 }
  ], fonts);
  y = fila(page, y, HF, [
    { label: 'FECHA DE NACIMIENTO', value: g('fecha_nacimiento'), lw: 115, vw: 75 },
    { label: 'ESTADO CIVIL', value: g('estado_civil'), lw: 75, vw: 70 },
    { label: 'Nº HIJOS', value: g('num_hijos'), lw: 60, vw: 120 }
  ], fonts);
  y = fila(page, y, HF, [
    { label: 'Nº D.N.I.', value: g('dni'), lw: 70, vw: 120 },
    { label: 'Nº SEG.SOCIAL', value: g('num_seg_social'), lw: 95, vw: 230 }
  ], fonts);
  y = fila(page, y, HF, [
    { label: 'TELEFONOS', value: g('id') || g('telefono'), lw: 75, vw: 120 },
    { label: 'Nº CUENTA BANCARIA', value: g('iban'), lw: 120, vw: 200 }
  ], fonts);
  y = fila(page, y, HF, [{ label: 'MAIL', value: g('email'), lw: 130, vw: 385 }], fonts);

  y -= 16;

  // ── DATOS LABORALES ──
  texto(page, 'DATOS LABORALES', M, y, fonts.bold, 10, ROJO);
  y -= 14;
  y = fila(page, y, HF, [{ label: 'TIPO DE CARNET', value: of('tipo_carnet'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'FECHA EXPEDICIÓN', value: g('carnet_expedicion'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'FECHA CADUCIDAD', value: g('carnet_caducidad'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'TIPO DE CONTRATO', value: of('tipo_contrato'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'JORNADA SEMANAL', value: of('jornada'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [{ label: 'MOTIVO DEL CONTRATO', value: of('motivo'), lw: 130, vw: 385 }], fonts);
  y = fila(page, y, HF, [
    { label: 'FECHA DE INICIO', value: g('fecha_inicio'), lw: 100, vw: 90 },
    { label: 'FECHA DE FINALIZACION', value: of('fin'), lw: 140, vw: 185 }
  ], fonts);
  y = filaAncha(page, y, HF, 'OBSERVACIONES:', g('observaciones'), fonts);
  y = filaAncha(page, y, HF, 'EMPRESA:', of('empresa'), fonts);
  y = filaAncha(page, y, HF, 'CENTRO DE TRABAJO:', of('centro'), fonts);
  y = filaAncha(page, y, HF, 'SALARIO BRUTO MENSUAL (PAGAS EXTRAS PRORRATEADAS):', salarioDe(ficha), fonts);

  y -= 18;
  texto(page, '* Es obligatorio rellenar todos los campos', M, y, fonts.bold, 8.5, ROJO_NOTA);
  const fdo = 'Fdo: Recursos Humanos';
  texto(page, fdo, A4[0] - M - fonts.bold.widthOfTextAtSize(fdo, 9), y - 18, fonts.bold, 9, NEGRO);

  // ── Documentos ──
  for (const d of documentos) {
    if (!d || !d.bytes) continue;
    await anexarDocumento(pdf, fonts, d.label, d.bytes, d.mime);
  }

  return pdf.save();
}

module.exports = { generarFichaPDF, FIJOS };
