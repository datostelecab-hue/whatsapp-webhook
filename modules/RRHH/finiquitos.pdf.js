// ============================================================
// LOS FINIQUITOS — el PDF del resumen de cierre (módulo 7, db/291)
// ============================================================
// A4 vertical, con la cabecera de la casa (como el informe de jornada): quién se
// va y cuándo, cada concepto con su cifra y su soporte, los totales, y quién lo
// revisó y lo aprobó. Va a la gestoría (o a la ETT) y a los documentos de la persona.
'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', '..', 'public', 'assets', 'logo-128.png');
const EMPRESA = 'TIBUS LUXURY';
const C = {
  dark: rgb(0.12, 0.14, 0.19), gold: rgb(0.91, 0.72, 0.29), texto: rgb(0.16, 0.19, 0.24),
  suave: rgb(0.42, 0.45, 0.51), linea: rgb(0.85, 0.87, 0.90), franja: rgb(0.97, 0.97, 0.98),
  cabTexto: rgb(0.78, 0.80, 0.84), rojo: rgb(0.72, 0.16, 0.16), verde: rgb(0.10, 0.48, 0.27),
};
const SUST = { '→': '->', '–': '-', '—': '-', '·': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR', '−': '-' };
const L = s => String(s == null ? '' : s).replace(/[→–—·…“”‘’€−]/g, c => SUST[c]).replace(/[^\x00-\xFF]/g, '').trim();
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const euros = n => `${n < 0 ? '-' : ''}${Math.abs(Number(n) || 0).toFixed(2).replace('.', ',')} EUR`;

/** @returns {Promise<Uint8Array>} */
async function generar(f) {
  const r = f.resumen || {};
  const p = r.persona || {};
  const doc = await PDFDocument.create();
  doc.setTitle(L(`Finiquito - ${f.nombre} - baja ${dmy(f.fecha_baja)}`));
  doc.setCreator(EMPRESA);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  let logo = null;
  if (fs.existsSync(LOGO)) { try { logo = await doc.embedPng(fs.readFileSync(LOGO)); } catch (_) { /* sin logo */ } }

  const W = 595, H = 842, MX = 40;
  let pg, y;
  const nueva = () => {
    pg = doc.addPage([W, H]);
    pg.drawRectangle({ x: 0, y: H - 60, width: W, height: 60, color: C.dark });
    let xt = 40;
    if (logo) { pg.drawImage(logo, { x: 36, y: H - 52, width: 42, height: 42 }); xt = 88; }
    pg.drawText(L(`${EMPRESA}  -  Finiquito: resumen de cierre`), { x: xt, y: H - 27, size: 14, font: bold, color: C.gold });
    pg.drawText(L(`${f.nombre}  -  baja el ${dmy(f.fecha_baja)}  -  para ${r.destino || ''}`), { x: xt, y: H - 45, size: 9, font: reg, color: C.cabTexto });
    y = H - 84;
  };
  const sitio = alto => { if (y - alto < 50) nueva(); };
  const parrafo = (t, { size = 9, font = reg, color = C.texto, x = MX, ancho = W - MX * 2 } = {}) => {
    const lineas = [];
    let linea = '';
    for (const w of L(t).split(/\s+/)) {
      const prueba = linea ? `${linea} ${w}` : w;
      if (font.widthOfTextAtSize(prueba, size) > ancho && linea) { lineas.push(linea); linea = w; } else linea = prueba;
    }
    if (linea) lineas.push(linea);
    for (const l of lineas) { sitio(size + 4); pg.drawText(l, { x, y: y - size, size, font, color }); y -= size + 4; }
  };
  const titulo = t => { sitio(34); y -= 10; pg.drawText(L(t), { x: MX, y: y - 12, size: 12, font: bold, color: C.dark }); y -= 18;
    pg.drawLine({ start: { x: MX, y }, end: { x: W - MX, y }, thickness: 0.6, color: C.linea }); y -= 6; };
  const dato = (et, v) => {
    sitio(14);
    pg.drawText(L(et), { x: MX, y: y - 9, size: 8.5, font: reg, color: C.suave });
    pg.drawText(L(v || '-'), { x: MX + 150, y: y - 9, size: 9, font: bold, color: C.texto });
    y -= 14;
  };

  nueva();
  titulo('Quién se va');
  dato('Nombre (Seguridad Social)', p.nombreSs || f.nombre);
  dato('DNI / NIE', p.dni);
  dato('Legajo de la gestoría', p.legajo);
  dato('Contrato', p.tipo === 'ett' ? `ETT${p.ett ? ` (${p.ett})` : ''}` : 'Plantilla propia');
  dato('Alta', dmy(p.alta));
  dato('Baja', dmy(p.baja));
  if (p.antiguedad) dato('Antigüedad reconocida', dmy(p.antiguedad));
  if (p.motivoBaja) dato('Motivo de la baja', p.motivoBaja);

  titulo('Conceptos');
  for (const c of r.conceptos || []) {
    sitio(40);
    pg.drawRectangle({ x: MX, y: y - 18, width: W - MX * 2, height: 18, color: C.franja });
    pg.drawText(L(c.titulo), { x: MX + 6, y: y - 13, size: 10, font: bold, color: C.dark });
    const cifra = c.error ? 'No se pudo calcular' : c.noAplica ? 'No aplica'
      : c.unidad === 'días' ? `${String(c.cantidad).replace('.', ',')} días` : euros(c.importe);
    const color = c.error ? C.rojo : c.importe < 0 ? C.rojo : c.importe > 0 ? C.verde : C.texto;
    const ancho = bold.widthOfTextAtSize(L(cifra), 10);
    pg.drawText(L(cifra), { x: W - MX - 6 - ancho, y: y - 13, size: 10, font: bold, color });
    y -= 24;
    if (c.error) parrafo(`Error: ${c.error}`, { color: C.rojo, x: MX + 10, ancho: W - MX * 2 - 20 });
    for (const s of c.soporte || []) parrafo(`- ${s}`, { size: 8.5, color: C.suave, x: MX + 10, ancho: W - MX * 2 - 20 });
    y -= 4;
  }

  titulo('Totales');
  const t = r.totales || {};
  if (t.vacacionesDias != null) dato('Vacaciones pendientes', `${String(t.vacacionesDias).replace('.', ',')} días (las valora la gestoría)`);
  dato('A su favor', euros(t.aFavor));
  dato('A descontar', euros(-(t.aDescontar || 0)));
  dato('Neto de estos conceptos', euros(t.neto));
  parrafo('Las cifras salen de los mismos cálculos que las pantallas del ERP: Vacaciones (saldo a la fecha de baja), Recaudación (lo que debe, al céntimo) y Nóminas (las dos nóminas variables que quedan sin pagar). No incluye el salario base del mes, la indemnización ni la parte de las pagas: eso lo calcula la gestoría.',
    { size: 8, color: C.suave });

  titulo('Trazabilidad');
  dato('Calculado', f.calculado || '');
  dato('Revisado', f.revisado ? `${f.revisado}${f.revisado_por_nombre ? ` por ${f.revisado_por_nombre}` : ''}` : 'Pendiente');
  dato('Aprobado', f.aprobado ? `${f.aprobado}${f.aprobado_por_nombre ? ` por ${f.aprobado_por_nombre}` : ''}` : 'Pendiente');
  if (f.nota) dato('Nota', f.nota);

  const paginas = doc.getPages();
  paginas.forEach((pp, i) => pp.drawText(L(`${EMPRESA} - Finiquito de ${f.nombre} - página ${i + 1} de ${paginas.length}`),
    { x: MX, y: 24, size: 7.5, font: reg, color: C.suave }));
  return doc.save();
}

module.exports = { generar };
