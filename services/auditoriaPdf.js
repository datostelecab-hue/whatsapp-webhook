// ============================================================
// PDF DEL FLUJO DE KM (Sankey) — auditoría de flota
// ============================================================
// Se dibuja NATIVO en el PDF (vectorial, con drawSvgPath), no como captura: se puede
// ampliar sin pixelar y pesa unos pocos KB. Va en A4 apaisado, con cabecera de la
// empresa y una tabla-resumen debajo, para poder adjuntarlo a un informe.
//
// La geometría es la misma idea que en pantalla (TOTAL → tramos → estados) pero con su
// propio maquetado, pensado para papel.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo-128.png');
const TZ = 'Europe/Madrid';

// Paleta (0-1 como exige pdf-lib).
const C = {
  dark: rgb(0.12, 0.14, 0.19),
  gold: rgb(0.91, 0.72, 0.29),
  texto: rgb(0.16, 0.19, 0.24),
  suave: rgb(0.42, 0.45, 0.51),
  linea: rgb(0.85, 0.87, 0.90),
  verde: rgb(0.13, 0.70, 0.45),
  rojo: rgb(0.90, 0.28, 0.30),
  ambar: rgb(0.96, 0.62, 0.04),
  gris: rgb(0.55, 0.58, 0.63),
  azul: rgb(0.38, 0.65, 0.98)
};

const BUCKETS = [
  { id: 'totalPasajero', txt: 'Con pasajero', color: C.verde },
  { id: 'totalIda', txt: 'Ida a recoger', color: C.gold },
  { id: 'totalEspera', txt: 'Espera (disponible)', color: C.gris },
  { id: 'totalDescanso', txt: 'Descanso (ocupado)', color: C.ambar },
  { id: 'totalFuera', txt: 'Fuera (app cerrada)', color: C.rojo }
];

/**
 * Las fuentes estándar del PDF (WinAnsi) no saben escribir flechas, guiones largos ni
 * emojis: cualquiera de esos caracteres revienta la generación. Se traducen a su
 * equivalente ASCII y se descarta lo que quede fuera de Latin-1 (los acentos y la ñ
 * sí entran, que es lo que importa para los nombres).
 */
const SUSTITUTOS = { '→': '->', '←': '<-', '–': '-', '—': '-', '·': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR' };
const limpiar = s => String(s == null ? '' : s)
  .replace(/[→←–—·…“”‘’€]/g, c => SUSTITUTOS[c])
  .replace(/[^\x00-\xFF]/g, '')      // fuera emojis y demás
  .trim();

const nkm = v => Math.round(v).toLocaleString('es-ES');
const r1 = v => Math.round(v * 10) / 10;
const hoyES = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date());

/** Suma los totales de una lista de matrículas. */
function totalesDe(lista) {
  const a = { totalMapon: 0 };
  BUCKETS.forEach(b => a[b.id] = 0);
  (lista || []).forEach(k => { a.totalMapon += k.totalMapon || 0; BUCKETS.forEach(b => a[b.id] += k[b.id] || 0); });
  return a;
}

/** Cinta entre dos nodos: dos curvas cúbicas cerradas (mismo trazo que en pantalla). */
const cinta = (x1, y1, x2, y2, h1, h2) => {
  const xm = (x1 + x2) / 2;
  return `M ${x1},${y1} C ${xm},${y1} ${xm},${y2} ${x2},${y2} L ${x2},${y2 + h2} C ${xm},${y2 + h2} ${xm},${y1 + h1} ${x1},${y1 + h1} Z`;
};

/**
 * @param {Object} datos  { titulo, subtitulo, rango, tramos: [{txt, color, tot}], matriculas }
 * @returns {Promise<Buffer>}
 */
async function generarPdfFlujo({ titulo, subtitulo, rango, tramos, matriculas }) {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setCreator('Tibus Luxury · Auditoría de flota');
  const pg = doc.addPage([842, 595]);            // A4 apaisado
  const { width: W, height: H } = pg.getSize();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  // ── Cabecera ──
  pg.drawRectangle({ x: 0, y: H - 58, width: W, height: 58, color: C.dark });
  let xTexto = 24;
  if (fs.existsSync(LOGO)) {
    try {
      const img = await doc.embedPng(fs.readFileSync(LOGO));
      pg.drawImage(img, { x: 20, y: H - 50, width: 40, height: 40 });
      xTexto = 72;
    } catch (e) { /* sin logo: la cabecera va igual */ }
  }
  pg.drawText(limpiar('TIBUS LUXURY  ·  Auditoría de flota'), { x: xTexto, y: H - 26, size: 15, font: bold, color: C.gold });
  pg.drawText(limpiar(titulo), { x: xTexto, y: H - 44, size: 10, font: reg, color: rgb(0.8, 0.82, 0.85) });
  pg.drawText(limpiar(`${rango}   ·   ${matriculas} matrículas con actividad en BOLT   ·   generado ${hoyES()}`),
    { x: 24, y: H - 76, size: 9, font: reg, color: C.suave });
  if (subtitulo) pg.drawText(limpiar(subtitulo), { x: 24, y: H - 90, size: 9, font: reg, color: C.suave });

  // ── Geometría del Sankey ──
  const total = tramos.reduce((s, t) => s + t.tot.totalMapon, 0);
  const top = H - 108, bottom = 150;             // deja sitio abajo para el resumen
  const alto = top - bottom, NW = 12, GAP = 14;
  const X = [40, W / 2 - NW / 2, W - 40 - NW];
  const activos = tramos.filter(t => t.tot.totalMapon > 0);
  const sumaBucket = id => activos.reduce((s, t) => s + (t.tot[id] || 0), 0);
  const bucketsAct = BUCKETS.filter(b => sumaBucket(b.id) > 0);

  if (total > 0) {
    const E = Math.min(
      alto / total,
      (alto - GAP * Math.max(activos.length - 1, 0)) / total,
      (alto - GAP * Math.max(bucketsAct.length - 1, 0)) / total
    );
    // En PDF el eje Y crece hacia ARRIBA: se apila desde `top` hacia abajo restando.
    const apilar = (items, valor) => {
      const altoCol = items.reduce((s, i) => s + valor(i) * E, 0) + GAP * (items.length - 1);
      let y = top - (alto - altoCol) / 2;
      return items.map(i => { const h = valor(i) * E; const n = { item: i, yTop: y, h }; y -= h + GAP; return n; });
    };
    const nTotal = { yTop: top - (alto - total * E) / 2, h: total * E };
    const nTramos = apilar(activos, t => t.tot.totalMapon);
    const nBuckets = apilar(bucketsAct, b => sumaBucket(b.id));

    // Nivel 0 → 1
    let yT = nTotal.yTop;
    const cursorTramo = new Map();
    nTramos.forEach(nt => {
      pg.drawSvgPath(cinta(X[0] + NW, yT, X[1], nt.yTop, -nt.h, -nt.h),
        { color: nt.item.color, opacity: 0.25, y: 0, x: 0 });
      yT -= nt.h;
      cursorTramo.set(nt.item.txt, nt.yTop);
    });
    // Nivel 1 → 2
    const cursorBucket = new Map(nBuckets.map(nb => [nb.item.id, nb.yTop]));
    nTramos.forEach(nt => {
      let y1 = cursorTramo.get(nt.item.txt);
      nBuckets.forEach(nb => {
        const v = nt.item.tot[nb.item.id] || 0;
        if (v <= 0) return;
        const h = v * E, y2 = cursorBucket.get(nb.item.id);
        pg.drawSvgPath(cinta(X[1] + NW, y1, X[2], y2, -h, -h), { color: nb.item.color, opacity: 0.35, x: 0, y: 0 });
        y1 -= h; cursorBucket.set(nb.item.id, y2 - h);
      });
    });

    // Nodos y etiquetas
    const pc = v => total > 0 ? Math.round(v / total * 100) + '%' : '';
    const nodo = (x, n, color, txt, sub, derecha) => {
      pg.drawRectangle({ x, y: n.yTop - n.h, width: NW, height: Math.max(n.h, 1), color });
      const anchoTxt = bold.widthOfTextAtSize(limpiar(txt), 9), anchoSub = reg.widthOfTextAtSize(limpiar(sub), 8);
      const tx = derecha ? x - 8 - anchoTxt : x + NW + 8;
      const sx = derecha ? x - 8 - anchoSub : x + NW + 8;
      const cy = n.yTop - n.h / 2;
      pg.drawText(limpiar(txt), { x: tx, y: cy + 2, size: 9, font: bold, color: C.texto });
      pg.drawText(limpiar(sub), { x: sx, y: cy - 9, size: 8, font: reg, color: C.suave });
    };
    nodo(X[0], nTotal, C.dark, 'KM totales', `${nkm(total)} km`, false);
    nTramos.forEach(nt => nodo(X[1], nt, nt.item.color, nt.item.txt,
      `${nkm(nt.item.tot.totalMapon)} km · ${pc(nt.item.tot.totalMapon)}`, false));
    nBuckets.forEach(nb => nodo(X[2], nb, nb.item.color, nb.item.txt,
      `${nkm(sumaBucket(nb.item.id))} km · ${pc(sumaBucket(nb.item.id))}`, true));
  } else {
    pg.drawText(limpiar('Sin kilómetros en este rango.'), { x: 40, y: (top + bottom) / 2, size: 12, font: reg, color: C.suave });
  }

  // ── Resumen inferior: trabajando en BOLT vs no disponible ──
  const s = id => tramos.reduce((a, t) => a + (t.tot[id] || 0), 0);
  const viaje = s('totalPasajero'), camino = s('totalIda'), espera = s('totalEspera');
  const desc = s('totalDescanso'), cerrada = s('totalFuera');
  const enBolt = viaje + camino + espera, noDisp = desc + cerrada;
  const pcT = v => total > 0 ? Math.round(v / total * 100) + '%' : '—';

  pg.drawLine({ start: { x: 40, y: 120 }, end: { x: W - 40, y: 120 }, thickness: 0.7, color: C.linea });
  const caja = (x, titulo, valor, detalle, color) => {
    pg.drawRectangle({ x, y: 40, width: (W - 100) / 2, height: 68, borderColor: C.linea, borderWidth: 0.7, color: rgb(0.99, 0.99, 1) });
    pg.drawText(limpiar(titulo), { x: x + 12, y: 88, size: 9, font: bold, color: C.texto });
    pg.drawText(limpiar(valor), { x: x + 12, y: 66, size: 17, font: bold, color });
    pg.drawText(limpiar(detalle), { x: x + 12, y: 50, size: 8, font: reg, color: C.suave });
  };
  caja(40, 'Trabajando en BOLT', `${pcT(enBolt)}  ·  ${nkm(enBolt)} km`,
    `${nkm(viaje)} de viaje · ${nkm(camino)} de camino · ${nkm(espera)} en espera`, C.verde);
  caja(40 + (W - 100) / 2 + 20, 'No disponible', `${pcT(noDisp)}  ·  ${nkm(noDisp)} km`,
    `${nkm(desc)} en descanso · ${nkm(cerrada)} con la app cerrada`, noDisp > 0 ? C.rojo : C.gris);

  pg.drawText(limpiar('Los km los mide Mapon (GPS punto a punto); BOLT aporta el estado del conductor en cada momento.'),
    { x: 40, y: 24, size: 7.5, font: reg, color: C.suave });

  return Buffer.from(await doc.save());
}

module.exports = { generarPdfFlujo, totalesDe, BUCKETS };
