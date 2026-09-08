// ============================================================
// CASCADA DE KM — la versión del Sankey que se entiende sin explicarla
// ============================================================
// El Sankey estaba bien hecho pero pide que te expliquen cómo se lee: hay que
// seguir cintas de grosor variable y comparar anchos a ojo. Para dirección eso
// es un peaje, y si hay que explicar el gráfico, el gráfico no vale.
//
// Esto es una CASCADA, el gráfico de toda la vida de contabilidad: se empieza en
// el bruto, se van restando conceptos y se acaba en el neto. Es exactamente la
// forma de una cuenta de resultados, y esa sí la lee cualquiera que haya visto
// un cierre de mes:
//
//   Todo lo que rodó la flota      28.646 km
//     - sin nadie fichado          -3.676
//     - en descanso                -1.058
//     - esperando aviso            -4.044
//   = Kilómetros con pasajero      19.867 km   (69 %)
//
// Y debajo, las mismas cuatro partes en una barra por turno, para comparar día y
// noche de un vistazo. La cifra que se lleva la reunión va arriba en una frase:
// "de cada 100 km que rueda la flota, 69 llevan pasajero".
//
// Se dibuja NATIVO (rectángulos y texto), no como captura: se amplía sin
// pixelar y pesa unos pocos KB.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo-128.png');
const EMPRESA = 'TIBUS LUXURY';

const C = {
  dark: rgb(0.12, 0.14, 0.19), gold: rgb(0.91, 0.72, 0.29),
  texto: rgb(0.16, 0.19, 0.24), suave: rgb(0.42, 0.45, 0.51),
  linea: rgb(0.85, 0.87, 0.90), papel: rgb(0.97, 0.97, 0.98), blanco: rgb(1, 1, 1),
  verde: rgb(0.13, 0.70, 0.45), ambar: rgb(0.96, 0.62, 0.04),
  gris: rgb(0.55, 0.58, 0.63), rojo: rgb(0.90, 0.28, 0.30),
  cabTexto: rgb(0.78, 0.80, 0.84),
};

// Las cuatro partes en las que se reparte cada kilómetro, de la peor a la mejor.
// El ORDEN es el del relato: primero lo que no tiene defensa (nadie fichado),
// al final lo que produce. Restar en otro orden contaría otra historia.
const PARTES = [
  { id: 'totalFuera',    txt: 'Sin nadie fichado',   pie: 'app cerrada',            color: C.rojo },
  { id: 'totalDescanso', txt: 'En descanso',         pie: 'ocupado en BOLT',        color: C.ambar },
  { id: 'totalEspera',   txt: 'Esperando aviso',     pie: 'disponible, sin viaje',  color: C.gris },
];
const FINAL = { id: 'totalPasajero', txt: 'Con pasajero', pie: 'lo que produce', color: C.verde };

const SUST = { '→': '->', '–': '-', '—': '-', '·': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR' };
const L = s => String(s == null ? '' : s)
  .replace(/[→–—·…“”‘’€]/g, c => SUST[c]).replace(/[^\x00-\xFF]/g, '').trim();

const km = v => Math.round(Number(v) || 0).toLocaleString('es-ES');
const pc = (v, t) => (t > 0 ? (Math.round((v / t) * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1 }) : '0,0');

/** Suma los tramos (turno día + turno noche) en un solo total de jornada. */
function totalDe(tramos) {
  const t = { totalMapon: 0, totalPasajero: 0, totalEspera: 0, totalDescanso: 0, totalFuera: 0 };
  (tramos || []).forEach(x => Object.keys(t).forEach(k => { t[k] += Number((x.tot || {})[k]) || 0; }));
  return t;
}

/**
 * @param {Object} datos { titulo, subtitulo, tramos: [{txt, tot}], matriculas }
 * @returns {Promise<Buffer>}
 */
async function generarPdfCascada({ titulo, subtitulo, tramos, matriculas }) {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo || 'Kilómetros de la flota');
  doc.setCreator(EMPRESA);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  const W = 842, H = 595, MX = 40;
  const pg = doc.addPage([W, H]);

  // ── Cabecera de la casa ──
  pg.drawRectangle({ x: 0, y: H - 58, width: W, height: 58, color: C.dark });
  let xt = 24;
  if (fs.existsSync(LOGO)) {
    try {
      const img = await doc.embedPng(fs.readFileSync(LOGO));
      pg.drawImage(img, { x: 20, y: H - 50, width: 40, height: 40 });
      xt = 72;
    } catch (e) { /* va sin logo */ }
  }
  pg.drawText(L(`${EMPRESA}  -  Kilometros de la flota`), { x: xt, y: H - 26, size: 15, font: bold, color: C.gold });
  pg.drawText(L(titulo || ''), { x: xt, y: H - 44, size: 10, font: reg, color: C.cabTexto });

  const T = totalDe(tramos);
  const total = T.totalMapon || 0;

  // ── LA FRASE. Es lo que se lleva la reunión; el resto es el porqué. ──
  let y = H - 92;
  pg.drawText(L(`De cada 100 km que rueda la flota, ${Math.round((T.totalPasajero / (total || 1)) * 100)} llevan pasajero.`),
    { x: MX, y, size: 19, font: bold, color: C.texto });
  y -= 17;
  pg.drawText(L(subtitulo || ''), { x: MX, y, size: 9.5, font: reg, color: C.suave });

  // ── LA CASCADA ──
  // Cada barra arranca donde la dejó la anterior, así que se ve cómo se va
  // comiendo el total. La primera y la última salen del suelo: son totales.
  // La base del gráfico va ALTA (195) para que sus etiquetas de eje no se coman
  // el bloque de turnos de abajo: con 150 se solapaban.
  const CX = MX, CY = 195, CH = 245, CW = W - MX * 2;
  const pasos = [
    { txt: 'Todo lo que rodo', pie: `${matriculas || 0} coches`, valor: total, color: C.dark, base: 0, alto: total, esTotal: true },
  ];
  let restante = total;
  PARTES.forEach(p => {
    const v = Number(T[p.id]) || 0;
    restante -= v;
    pasos.push({ txt: p.txt, pie: p.pie, valor: -v, color: p.color, base: restante, alto: v });
  });
  pasos.push({ txt: FINAL.txt, pie: FINAL.pie, valor: T.totalPasajero, color: FINAL.color, base: 0, alto: T.totalPasajero, esTotal: true });

  const hueco = 26;
  const anchoBarra = (CW - hueco * (pasos.length - 1)) / pasos.length;
  const escala = total > 0 ? CH / total : 0;

  pasos.forEach((p, i) => {
    const x = CX + i * (anchoBarra + hueco);
    const alto = Math.max(1.5, p.alto * escala);
    const yb = CY + p.base * escala;

    pg.drawRectangle({ x, y: yb, width: anchoBarra, height: alto, color: p.color });

    // El valor, encima de la barra. Con signo en las restas: es lo que hace que
    // se lea como una cuenta y no como cuatro barras sueltas.
    const etq = (p.valor < 0 ? '-' : '') + km(Math.abs(p.valor)) + ' km';
    pg.drawText(L(etq), {
      x: x + (anchoBarra - bold.widthOfTextAtSize(L(etq), p.esTotal ? 12 : 11)) / 2,
      y: yb + alto + 6, size: p.esTotal ? 12 : 11, font: bold, color: p.esTotal ? C.texto : p.color });

    // El % del total, dentro de la barra si cabe.
    if (!p.esTotal && alto > 16) {
      const t2 = pc(p.alto, total) + ' %';
      pg.drawText(L(t2), {
        x: x + (anchoBarra - bold.widthOfTextAtSize(L(t2), 10)) / 2,
        y: yb + alto / 2 - 3.5, size: 10, font: bold, color: C.blanco });
    }

    // El nombre, debajo del eje.
    pg.drawText(L(p.txt), {
      x: x + (anchoBarra - bold.widthOfTextAtSize(L(p.txt), 10)) / 2,
      y: CY - 16, size: 10, font: bold, color: C.texto });
    pg.drawText(L(p.pie), {
      x: x + (anchoBarra - reg.widthOfTextAtSize(L(p.pie), 8)) / 2,
      y: CY - 27, size: 8, font: reg, color: C.suave });

    // La línea de puntos que enlaza con la barra siguiente: es lo que convierte
    // barras sueltas en una cascada.
    if (i < pasos.length - 1) {
      const ySig = CY + (pasos[i + 1].esTotal ? pasos[i + 1].alto : pasos[i + 1].base + pasos[i + 1].alto) * escala;
      const yEnlace = p.esTotal ? yb + alto : yb + alto;
      if (Math.abs(yEnlace - ySig) < 0.5 || true) {
        for (let xx = x + anchoBarra; xx < x + anchoBarra + hueco; xx += 5) {
          pg.drawLine({ start: { x: xx, y: yEnlace }, end: { x: Math.min(xx + 2.5, x + anchoBarra + hueco), y: yEnlace },
            thickness: 0.8, color: C.linea });
        }
      }
    }
  });

  // El suelo.
  pg.drawLine({ start: { x: CX, y: CY }, end: { x: CX + CW, y: CY }, thickness: 1, color: C.linea });

  // ── LAS MISMAS PARTES, POR TURNO ──
  // Una barra al 100 % por turno: aquí no importan los kilómetros absolutos
  // (la noche siempre rueda menos), importa el REPARTO.
  y = 118;
  pg.drawText(L('El reparto de cada turno'), { x: MX, y: y + 24, size: 11, font: bold, color: C.texto });

  const ORDEN = [FINAL, ...PARTES];
  const anchoTira = CW - 190;
  (tramos || []).forEach((tr, i) => {
    const yy = y - i * 26;
    const t = tr.tot || {};
    const tt = Number(t.totalMapon) || 0;
    pg.drawText(L(tr.txt), { x: MX, y: yy + 3, size: 9.5, font: bold, color: C.texto });
    pg.drawText(L(`${km(tt)} km`), { x: MX + 96, y: yy + 3, size: 9.5, font: reg, color: C.suave });

    let x = MX + 168;
    ORDEN.forEach(p => {
      const v = Number(t[p.id]) || 0;
      const w = tt > 0 ? (v / tt) * anchoTira : 0;
      if (w <= 0) return;
      pg.drawRectangle({ x, y: yy - 3, width: w, height: 16, color: p.color });
      const et = pc(v, tt) + '%';
      if (w > bold.widthOfTextAtSize(et, 8) + 8) {
        pg.drawText(L(et), { x: x + (w - bold.widthOfTextAtSize(et, 8)) / 2, y: yy + 1.5, size: 8, font: bold, color: C.blanco });
      }
      x += w;
    });
  });

  // ── Leyenda ──
  let lx = MX;
  const ly = 34;
  ORDEN.forEach(p => {
    pg.drawRectangle({ x: lx, y: ly, width: 10, height: 10, color: p.color });
    pg.drawText(L(p.txt), { x: lx + 14, y: ly + 1.5, size: 8.5, font: reg, color: C.texto });
    lx += 24 + reg.widthOfTextAtSize(L(p.txt), 8.5);
  });

  pg.drawText(L('Los km salen de los trayectos de Mapon repartidos entre las situaciones de BOLT, en proporcion al tiempo. '
    + 'Es la misma cuenta que el cockpit y los reportes.'),
  { x: MX, y: 16, size: 7.5, font: reg, color: C.suave });

  return Buffer.from(await doc.save());
}

module.exports = { generarPdfCascada, totalDe, PARTES, FINAL };
