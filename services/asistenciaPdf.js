// ============================================================
// PDF DE ASISTENCIA — reincidentes y plantilla por promedio
// ============================================================
// A4 apaisado, con la cabecera de la casa. Dos tablas seguidas: primero quién
// faltó y cuántas veces (que es lo que se lleva a la reunión) y después la
// plantilla entera de menor a mayor promedio.
//
// Cada fila lleva su NÚMERO al lado: el reporte se lee en voz alta y "el 7" es
// más rápido que repetir el nombre entero.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo-128.png');
const EMPRESA = 'TIBUS LUXURY';

const C = {
  dark: rgb(0.12, 0.14, 0.19), cab: rgb(0.22, 0.25, 0.31), gold: rgb(0.91, 0.72, 0.29),
  texto: rgb(0.16, 0.19, 0.24), suave: rgb(0.42, 0.45, 0.51),
  linea: rgb(0.85, 0.87, 0.90), franja: rgb(0.97, 0.97, 0.98), blanco: rgb(1, 1, 1),
  rojo: rgb(0.90, 0.28, 0.30), rojoBg: rgb(0.996, 0.886, 0.886),
  ambarBg: rgb(0.996, 0.953, 0.831), verdeBg: rgb(0.82, 0.98, 0.90), azulBg: rgb(0.86, 0.92, 1.0),
  cabTexto: rgb(0.78, 0.80, 0.84),
};

// Las fuentes estándar del PDF no salen de Latin-1: los acentos y la ñ entran,
// las flechas y los emojis revientan la generación.
const SUST = { '→': '->', '–': '-', '—': '-', '·': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR' };
const L = s => String(s == null ? '' : s)
  .replace(/[→–—·…“”‘’€]/g, c => SUST[c]).replace(/[^\x00-\xFF]/g, '').trim();

const TONO = { S: C.verdeBg, A: C.ambarBg, B: C.ambarBg, C: C.rojoBg, N: C.azulBg };
const n1 = v => (v == null ? '-' : Number(v).toFixed(1).replace('.', ','));
const esFecha = iso => (iso ? iso.split('-').reverse().join('/') : '');
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

/**
 * @param {Object} datos  lo que devuelve services/repo/asistencia.faltas()
 * @returns {Promise<Buffer>}
 */
async function generar({ desde, hasta, reincidentes, porPromedio }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Asistencia ${esFecha(desde)} - ${esFecha(hasta)}`);
  doc.setCreator(EMPRESA);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  let logo = null;
  if (fs.existsSync(LOGO)) { try { logo = await doc.embedPng(fs.readFileSync(LOGO)); } catch (e) { /* va sin logo */ } }

  const W = 842, H = 595, MX = 26, FILA = 13;
  let pg = null, y = 0, paginas = 0;

  const nuevaPagina = (titulo, subtitulo, cols) => {
    pg = doc.addPage([W, H]); paginas++;
    pg.drawRectangle({ x: 0, y: H - 54, width: W, height: 54, color: C.dark });
    let xt = 22;
    if (logo) { pg.drawImage(logo, { x: 20, y: H - 47, width: 38, height: 38 }); xt = 68; }
    pg.drawText(L(`${EMPRESA}  -  ${titulo}`), { x: xt, y: H - 24, size: 14, font: bold, color: C.gold });
    pg.drawText(L(subtitulo), { x: xt, y: H - 41, size: 8.5, font: reg, color: C.cabTexto });
    y = H - 74;
    // Cabecera de la tabla.
    pg.drawRectangle({ x: MX, y: y - 15, width: W - MX * 2, height: 17, color: C.cab });
    let x = MX + 5;
    cols.forEach(c => {
      const t = L(c.titulo);
      pg.drawText(t, { x: c.al === 'c' ? x + (c.w - bold.widthOfTextAtSize(t, 7.5)) / 2 : x,
        y: y - 11, size: 7.5, font: bold, color: C.blanco });
      x += c.w;
    });
    y -= 20;
  };

  const fila = (d, cols, i) => {
    if (i % 2 === 1) pg.drawRectangle({ x: MX, y: y - 11, width: W - MX * 2, height: FILA, color: C.franja });
    let x = MX + 5;
    cols.forEach(c => {
      const bg = c.tono && c.tono(d);
      if (bg) pg.drawRectangle({ x: x - 3, y: y - 11, width: c.w - 3, height: FILA, color: bg });
      const f = c.bold ? bold : reg, s = c.size || 8;
      // Se recorta al ancho de su columna: un nombre largo no puede pisar al vecino.
      let t = L(c.valor(d));
      while (t && f.widthOfTextAtSize(t, s) > c.w - 6) t = t.slice(0, -1);
      pg.drawText(t, { x: c.al === 'c' ? x + (c.w - f.widthOfTextAtSize(t, s)) / 2 : x,
        y: y - 8, size: s, font: f, color: c.color ? c.color(d) : C.texto });
      x += c.w;
    });
    pg.drawLine({ start: { x: MX, y: y - 12 }, end: { x: W - MX, y: y - 12 }, thickness: 0.4, color: C.linea });
    y -= FILA;
  };

  const tabla = (titulo, subtitulo, cols, filas) => {
    nuevaPagina(titulo, subtitulo, cols);
    filas.forEach((d, i) => {
      if (y < 30) nuevaPagina(`${titulo} (cont.)`, subtitulo, cols);
      fila(d, cols, i);
    });
    if (!filas.length) {
      pg.drawText(L('Nadie. Ni una falta en el periodo.'),
        { x: MX + 5, y: y - 8, size: 9, font: reg, color: C.suave });
    }
  };

  // El numerador de cada lista. Va al lado del nombre porque el reporte se lee
  // en voz alta y "el 7" es mas rapido que el nombre entero.
  const numDe = lista => { const m = new Map(lista.map((d, i) => [d, i + 1])); return d => String(m.get(d) || ''); };
  const periodo = `Del ${esFecha(desde)} al ${esFecha(hasta)}`;

  tabla('Faltas de asistencia',
    `${periodo} - ${reincidentes.length} personas con al menos una falta - la libranza es la de HOY proyectada hacia atras - ${sello()}`,
    [
      { titulo: 'Nº', w: 26, al: 'c', bold: true, valor: numDe(reincidentes) },
      { titulo: 'Nombre', w: 178, bold: true, valor: d => d.nombre },
      { titulo: 'Telefono', w: 72, valor: d => d.telefono },
      { titulo: 'Coche', w: 56, al: 'c', valor: d => d.coche },
      { titulo: 'Turno', w: 42, al: 'c', valor: d => d.turno },
      { titulo: 'Libra', w: 38, al: 'c', valor: d => d.libra || '-' },
      { titulo: 'Tocaba', w: 40, al: 'c', valor: d => String(d.tocaba) },
      { titulo: 'Falto', w: 34, al: 'c', bold: true, valor: d => String(d.faltas),
        tono: d => (d.faltas >= 3 ? C.rojoBg : d.faltas === 2 ? C.ambarBg : null) },
      { titulo: 'Dias que falto', w: 118, size: 7.5, valor: d => d.dias_falta || '' },
      { titulo: 'Prom.', w: 38, al: 'c', valor: d => n1(d.horas_prom) },
      { titulo: 'Nota', w: 30, al: 'c', bold: true, valor: d => d.letra || '-', tono: d => TONO[d.letra] || null },
      { titulo: 'Ult. dia', w: 44, al: 'c', valor: d => d.ultimo_dia || 'nunca' },
      { titulo: 'Ojo', w: 74, size: 7.5, valor: d => d.ojo || '', color: () => C.rojo },
    ], reincidentes);

  tabla('Plantilla por promedio',
    `Mes corrido - ${porPromedio.length} personas en activo - de menor a mayor promedio - ` +
    `S >=9h  A 8-9  B 6-8  C <6  N recien incorporado - ${sello()}`,
    [
      { titulo: 'Nº', w: 26, al: 'c', bold: true, valor: numDe(porPromedio) },
      { titulo: 'Nombre', w: 192, bold: true, valor: d => d.nombre },
      { titulo: 'Telefono', w: 72, valor: d => d.telefono },
      { titulo: 'Coche', w: 56, al: 'c', valor: d => d.coche },
      { titulo: 'Turno', w: 42, al: 'c', valor: d => d.turno },
      { titulo: 'Contrato', w: 60, al: 'c', valor: d => (d.tipo === 'ett' ? (d.ett || 'ETT') : 'Propia') },
      { titulo: 'Promedio', w: 48, al: 'c', bold: true, valor: d => n1(d.horas_prom) },
      { titulo: 'Nota', w: 30, al: 'c', bold: true, valor: d => d.letra || '-', tono: d => TONO[d.letra] || null },
      { titulo: 'Dias a 0', w: 42, al: 'c', valor: d => (d.dias_cero == null ? '-' : String(d.dias_cero)) },
      { titulo: 'Faltas', w: 36, al: 'c', bold: true, valor: d => String(d.faltas),
        tono: d => (d.faltas >= 3 ? C.rojoBg : d.faltas === 2 ? C.ambarBg : null) },
      { titulo: 'Ult. dia', w: 44, al: 'c', valor: d => d.ultimo_dia || 'nunca' },
      { titulo: 'Ojo', w: 76, size: 7.5, valor: d => d.ojo || '', color: () => C.rojo },
    ], porPromedio);

  // El pie va al final, cuando ya se sabe cuántas páginas hay.
  doc.getPages().forEach((p, i) => {
    p.drawText(L(`Pagina ${i + 1} de ${paginas}   -   una falta es 0 horas en BOLT sin justificante   -   ` +
      'los marcados en "Ojo" van al final: su 0 no significa que faltaran'),
    { x: MX, y: 16, size: 7, font: reg, color: C.suave });
  });

  return Buffer.from(await doc.save());
}

module.exports = { generar };
