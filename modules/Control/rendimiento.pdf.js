// ============================================================
// RENDIMIENTO DE LOS CUADRANTES — el ejecutivo en PDF (2 páginas)
// ============================================================
// Camilo, 06/11/2026: «el reporte ejecutivo debe de descargarse junto con el
// excel en telecab» y «No lo quiero tan largo, resumido en 2 páginas, así la
// letra se acorte». Pinta lo que decide rendimiento.service.ejecutivo(); aquí
// no se calcula nada. Dos páginas SIEMPRE: cada bloque tiene su sitio y, si no
// caben todas las filas, se dice cuántas quedan fuera (están en el Excel).
//
//   Página 1: la frase, las cifras, de dónde salen las horas que faltan, las
//             zonas y cómo va cada cuadrante.
//   Página 2: los cuadrantes que peor van y qué les pasa, lo que falta en el
//             planificador, los coches que más tiran hacia abajo y las
//             prioridades.
//
// Nativo (rectángulos y texto, como la cascada de KM): se amplía sin pixelar.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', '..', 'public', 'assets', 'logo-128.png');
const EMPRESA = 'TIBUS LUXURY';
const W = 842, H = 595, MX = 34;

const C = {
  dark: rgb(0.12, 0.14, 0.19), gold: rgb(0.91, 0.72, 0.29),
  texto: rgb(0.16, 0.19, 0.24), suave: rgb(0.42, 0.45, 0.51),
  linea: rgb(0.85, 0.87, 0.90), papel: rgb(0.97, 0.97, 0.98), blanco: rgb(1, 1, 1),
  cabTexto: rgb(0.78, 0.80, 0.84), cabTabla: rgb(0.93, 0.94, 0.96), total: rgb(0.99, 0.95, 0.84),
  verde: rgb(0.12, 0.48, 0.20), ambar: rgb(0.61, 0.35, 0.0), rojo: rgb(0.75, 0.0, 0.0),
  verdeF: rgb(0.30, 0.69, 0.42), ambarF: rgb(0.93, 0.66, 0.20), rojoF: rgb(0.86, 0.33, 0.33), grisF: rgb(0.62, 0.65, 0.70),
};
// Verde 90 % o más, ámbar del 70 al 90 %, rojo por debajo (el semáforo del Excel).
const tono = p => (p == null ? C.suave : p >= 0.9 ? C.verde : p >= 0.7 ? C.ambar : C.rojo);
const relleno = p => (p == null ? C.grisF : p >= 0.9 ? C.verdeF : p >= 0.7 ? C.ambarF : C.rojoF);

// Las fuentes estándar del PDF solo saben Latin-1.
const SUST = { '→': '->', '–': '-', '—': '-', '−': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR' };
const L = s => String(s == null ? '' : s).replace(/[→–—−…“”‘’€]/g, c => SUST[c]).replace(/[^\x20-\xFF]/g, '');
const n0 = v => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pc = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %');

async function generar(e) {
  const doc = await PDFDocument.create();
  doc.setTitle(L(e.titulo));
  doc.setCreator(EMPRESA);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  let logo = null;
  if (fs.existsSync(LOGO)) { try { logo = await doc.embedPng(fs.readFileSync(LOGO)); } catch (_) { /* sin logo */ } }

  // ── Ayudas de dibujo ──
  const ancho = (s, f, t) => f.widthOfTextAtSize(L(s), t);
  const txt = (pg, s, x, y, { f = reg, t = 8, c = C.texto, al = 'izq', w = 0 } = {}) => {
    const s2 = L(s);
    const xx = al === 'der' ? x + w - f.widthOfTextAtSize(s2, t) : al === 'cen' ? x + (w - f.widthOfTextAtSize(s2, t)) / 2 : x;
    pg.drawText(s2, { x: xx, y, size: t, font: f, color: c });
  };
  /** Las líneas de un texto en un ancho. */
  const partir = (s, f, t, w) => {
    const out = []; let linea = '';
    L(s).split(/\s+/).filter(Boolean).forEach(p => {
      const prueba = linea ? linea + ' ' + p : p;
      if (f.widthOfTextAtSize(prueba, t) <= w || !linea) linea = prueba; else { out.push(linea); linea = p; }
    });
    if (linea) out.push(linea);
    return out;
  };
  /** Un texto de una línea que no cabe se corta con «...»: nunca se monta en la columna de al lado. */
  const recortar = (s, f, t, w) => {
    let s2 = L(s);
    if (f.widthOfTextAtSize(s2, t) <= w) return s2;
    while (s2.length > 1 && f.widthOfTextAtSize(s2 + '...', t) > w) s2 = s2.slice(0, -1);
    return s2.trimEnd() + '...';
  };
  const parrafo = (pg, s, x, y, w, { f = reg, t = 8, c = C.texto, lh = t + 2.6 } = {}) => {
    const ls = partir(s, f, t, w);
    ls.forEach((l, i) => pg.drawText(l, { x, y: y - i * lh, size: t, font: f, color: c }));
    return ls.length * lh;
  };
  const cabecera = (pg, alto, num) => {
    pg.drawRectangle({ x: 0, y: H - alto, width: W, height: alto, color: C.dark });
    let xt = MX;
    if (logo) { const s = alto - 12; pg.drawImage(logo, { x: MX - 4, y: H - alto + 6, width: s, height: s }); xt = MX + s + 6; }
    txt(pg, `${EMPRESA}  ·  ${e.titulo}`, xt, H - (alto > 40 ? 20 : 19), { f: bold, t: alto > 40 ? 13 : 11, c: C.gold });
    if (alto > 40) txt(pg, e.sub, xt, H - 34, { t: 7.5, c: C.cabTexto });
    txt(pg, `${num} / 2`, W - MX - 40, H - (alto > 40 ? 20 : 19), { t: 8, c: C.cabTexto, al: 'der', w: 40 });
  };
  const titulo = (pg, s, x, y) => { txt(pg, s, x, y, { f: bold, t: 9.5, c: C.dark }); return y - 6; };

  /**
   * Una tabla con columnas [{ etq, w, al, cel(fila) → { s, f, c } }]. Pinta
   * filas mientras quepan por encima de `suelo`; devuelve { y, fuera }.
   */
  const tabla = (pg, x, y, cols, filas, { t = 7.5, suelo = 40, cabAlto = 16 } = {}) => {
    const wTot = cols.reduce((s, c) => s + c.w, 0);
    pg.drawRectangle({ x, y: y - cabAlto, width: wTot, height: cabAlto, color: C.cabTabla });
    let cx = x;
    cols.forEach(c => {
      const ls = partir(c.etq, bold, 6.5, c.w - 6);
      ls.slice(0, 2).forEach((l, i) => txt(pg, l, cx + 3, y - (ls.length > 1 ? 6.5 : 10) - i * 7.5, { f: bold, t: 6.5, c: C.suave, al: c.al === 'der' ? 'der' : 'izq', w: c.w - 6 }));
      cx += c.w;
    });
    y -= cabAlto;
    let fuera = 0;
    filas.forEach((fila, k) => {
      const celdas = cols.map(c => ({ ...c.cel(fila), w: c.w, al: c.al }));
      const lineas = celdas.map(cl => (cl.envolver ? partir(cl.s, cl.f || reg, cl.t || t, cl.w - 6).slice(0, 4) : [recortar(cl.s, cl.f || reg, cl.t || t, cl.w - 6)]));
      const alto = Math.max(...lineas.map(l => l.length)) * (t + 2.4) + 5;
      if (y - alto < suelo) { fuera++; return; }
      if (fila.fondo) pg.drawRectangle({ x, y: y - alto, width: wTot, height: alto, color: fila.fondo });
      else if (k % 2) pg.drawRectangle({ x, y: y - alto, width: wTot, height: alto, color: C.papel });
      let xx = x;
      celdas.forEach((cl, i) => {
        lineas[i].forEach((l, j) => txt(pg, l, xx + 3, y - 3 - (t) - j * (t + 2.4), { f: cl.f || reg, t: cl.t || t, c: cl.c || C.texto, al: cl.al === 'der' ? 'der' : 'izq', w: cl.w - 6 }));
        xx += cl.w;
      });
      pg.drawLine({ start: { x, y: y - alto }, end: { x: x + wTot, y: y - alto }, thickness: 0.4, color: C.linea });
      y -= alto;
    });
    return { y, fuera };
  };

  // ════════════════ PÁGINA 1 ════════════════
  const p1 = doc.addPage([W, H]);
  cabecera(p1, 46, 1);
  let y = H - 46 - 22;
  y -= parrafo(p1, e.frase, MX, y, W - 2 * MX, { f: bold, t: 13, c: C.texto, lh: 16 });
  if (e.explica) y -= parrafo(p1, e.explica, MX, y - 1, W - 2 * MX, { t: 8.5, c: C.suave, lh: 11 });
  y -= 8;

  // Las cifras.
  const nK = e.kpis.length, gap = 8, kw = (W - 2 * MX - gap * (nK - 1)) / nK, kh = 46;
  e.kpis.forEach((k, i) => {
    const x = MX + i * (kw + gap);
    p1.drawRectangle({ x, y: y - kh, width: kw, height: kh, color: C.papel, borderColor: C.linea, borderWidth: 0.6 });
    txt(p1, k.etq, x + 7, y - 11, { t: 7, c: C.suave });
    txt(p1, k.valor, x + 7, y - 27, { f: bold, t: 13.5, c: k.pct !== undefined ? tono(k.pct) : C.texto });
    const pie = partir(k.pie, reg, 6.5, kw - 14)[0] || '';
    txt(p1, pie, x + 7, y - 39, { t: 6.5, c: C.suave });
  });
  y -= kh + 18;

  // Izquierda: de dónde salen las horas que faltan (barra al 100 %).
  const colI = 318, xD = MX + colI + 22, colD = W - MX - xD;
  let yFinI = y, yFinD = y;
  {
    const pasos = e.cascada.filter(p => p.tipo === 'paso');
    const debian = e.cascada[0].valor, llevan = e.cascada[e.cascada.length - 1].valor;
    const deficit = debian - llevan;
    let yy = titulo(p1, deficit > 0 ? `De dónde salen las ${n0(deficit)} h que faltan` : 'Las horas del mes', MX, y);
    const partes = pasos.filter(p => -p.valor > 0);           // lo que resta
    const aFavor = pasos.filter(p => -p.valor < 0);           // lo que suma (turnos cubiertos de más)
    const totalBarra = partes.reduce((s, p) => s - p.valor, 0);
    const colores = [C.rojoF, C.ambarF, C.grisF];
    yy -= 8;
    if (deficit > 0 && totalBarra > 0) {
      let x = MX;
      partes.forEach((p, i) => {
        const w = (-p.valor / totalBarra) * colI;
        p1.drawRectangle({ x, y: yy - 22, width: w, height: 22, color: colores[pasos.indexOf(p)] || colores[i] });
        const et = `${Math.round((-p.valor / totalBarra) * 100)} %`;
        if (w > ancho(et, bold, 8) + 6) txt(p1, et, x, yy - 14.5, { f: bold, t: 8, c: C.blanco, al: 'cen', w });
        x += w;
      });
      yy -= 34;
      pasos.filter(p => Math.round(p.valor)).forEach(p => {
        const color = colores[pasos.indexOf(p)];
        p1.drawRectangle({ x: MX, y: yy - 1, width: 8, height: 8, color: -p.valor > 0 ? color : C.verdeF });
        txt(p1, `${-p.valor >= 0 ? '' : '+'}${n0(Math.abs(p.valor))} h`, MX + 13, yy, { f: bold, t: 8.5 });
        txt(p1, `${p.txt.toLowerCase() === 'cubiertos' ? 'turnos cubiertos que ' + p.pie : p.txt === 'Sin CT' ? 'turnos sin nadie el día que libra el fijo: falta de CT' : 'turnos del fijo sin nadie (vacante, vacaciones, baja)'}`,
          MX + 62, yy, { t: 7.5, c: C.suave });
        yy -= 13;
      });
      if (aFavor.length) { txt(p1, 'En verde, lo que los turnos cubiertos hacen de más: compensa parte de lo perdido.', MX, yy, { t: 7, c: C.suave }); yy -= 11; }
      yy -= 2;
      txt(p1, `Debían ${n0(debian)} h y llevan ${n0(llevan)} h. Cada turno sin nadie se cuenta a 8 h.`, MX, yy, { t: 7, c: C.suave });
    } else {
      yy -= 10;
      txt(p1, debian ? `Debían ${n0(debian)} h y llevan ${n0(llevan)} h: van por encima.` : 'Aún no hay días cerrados: las horas empiezan a contar mañana.', MX, yy, { t: 8.5 });
    }
    yFinI = yy;
  }

  // Derecha: las zonas.
  {
    const yy = titulo(p1, 'Las zonas, de peor a mejor', xD, y);
    // Una fila «y N zonas más» (z.nota) solo lleva su texto.
    const v = (z, f) => (z.nota ? { s: '' } : f(z));
    const cols = [
      { etq: 'Zona', w: 92, cel: z => ({ s: z.nombre, f: z.total ? bold : reg, c: z.nota ? C.suave : C.texto }) },
      { etq: 'Coches', w: 34, al: 'der', cel: z => v(z, () => ({ s: String(z.coches) })) },
      { etq: 'Debían (h)', w: 46, al: 'der', cel: z => v(z, () => ({ s: n0(z.debian) })) },
      { etq: 'Llevan (h)', w: 46, al: 'der', cel: z => v(z, () => ({ s: n0(z.llevan) })) },
      { etq: e.cerrado ? 'Cómo fueron' : 'Cómo van', w: 40, al: 'der', cel: z => v(z, () => ({ s: pc(z.pct), f: bold, c: tono(z.pct) })) },
      { etq: e.cerrado ? 'Hicieron (h)' : 'A fin de mes (h)', w: 46, al: 'der', cel: z => v(z, () => ({ s: z.ritmo == null ? '—' : n0(z.ritmo) })) },
      { etq: 'Sin conductor (pasados / prev.)', w: 62, al: 'der', cel: z => v(z, () => ({ s: z.sin })) },
    ];
    cols.push({ etq: e.cerrado ? 'Perdidas, h (de CT)' : 'Perdidas y previstas, h (de CT)', w: colD - cols.reduce((s, c) => s + c.w, 0), al: 'der', cel: z => v(z, () => ({ s: `${n0(z.perdidas)} (${n0(z.perdidasCt)})` })) });
    const filas = e.zonas.map(z => ({ ...z, fondo: z.total ? C.total : null }));
    yFinD = tabla(p1, xD, yy - 2, cols, filas, { t: 7.5, suelo: 200 }).y;
  }

  // Abajo: cómo va cada cuadrante, de peor a mejor, contra el 90 % y el 100 %.
  {
    const base = 52, top = Math.min(yFinI, yFinD) - 26;
    const alto = Math.max(80, top - 30 - base);
    titulo(p1, `Cómo va cada cuadrante: ${e.semaforo.verde} en verde, ${e.semaforo.ambar} en ámbar y ${e.semaforo.rojo} en rojo`, MX, top);
    const cs = e.cuadrantes;
    const maxPct = Math.max(1.1, ...cs.map(c => c.pct));
    const escala = alto / maxPct;
    const wCol = (W - 2 * MX) / Math.max(cs.length, 1);
    const wBar = Math.min(18, wCol * 0.62);
    // Las etiquetas de las líneas van a la izquierda: ahí están los que peor
    // van, las barras más bajas, y no las tapan.
    [[1, '100 %: lo que debían'], [0.9, '90 %']].forEach(([v, etq]) => {
      const yl = base + v * escala;
      for (let x = MX; x < W - MX; x += 6) p1.drawLine({ start: { x, y: yl }, end: { x: Math.min(x + 3, W - MX), y: yl }, thickness: 0.5, color: C.suave });
      txt(p1, etq, MX + 1, yl + 2, { t: 6.5, c: C.suave });
    });
    cs.forEach((c, i) => {
      const x = MX + i * wCol + (wCol - wBar) / 2;
      const h = Math.max(1, c.pct * escala);
      p1.drawRectangle({ x, y: base, width: wBar, height: h, color: relleno(c.pct) });
      txt(p1, `${Math.round(c.pct * 100)}`, x - 6, base + h + 2, { f: bold, t: 6.5, c: tono(c.pct), al: 'cen', w: wBar + 12 });
      txt(p1, c.etq, x - 8, base - 9, { f: bold, t: 6.5, c: C.texto, al: 'cen', w: wBar + 16 });
      if (cs.length <= 32) txt(p1, recortar(c.zona, reg, 5.5, wCol - 1), x - (wCol - wBar) / 2, base - 17, { t: 5.5, c: C.suave, al: 'cen', w: wCol });
    });
    p1.drawLine({ start: { x: MX, y: base }, end: { x: W - MX, y: base }, thickness: 0.8, color: C.linea });
    txt(p1, recortar(`% de las horas que debían hasta el corte.${e.mejores.length ? ` Los que mejor ${e.cerrado ? 'fueron' : 'van'}: ${e.mejores.join(', ')}.` : ''}`, reg, 7, W - 2 * MX), MX, 18, { t: 7, c: C.suave });
  }

  // ════════════════ PÁGINA 2 ════════════════
  const p2 = doc.addPage([W, H]);
  cabecera(p2, 32, 2);
  // Lo de abajo se mide primero, para que lo de arriba sepa hasta dónde puede llegar.
  const notaLs = partir(e.nota, reg, 6.5, W - 2 * MX);
  const yNota = 14 + (notaLs.length - 1) * 8.5;
  notaLs.forEach((l, i) => p2.drawText(l, { x: MX, y: yNota - i * 8.5, size: 6.5, font: reg, color: C.suave }));
  // Cada prioridad, tres líneas como mucho: el detalle está en el Excel.
  const prior = e.prioridades.map((s, i) => {
    const ls = partir(`${i + 1}. ${s}`, reg, 8, W - 2 * MX - 10);
    return ls.length > 3 ? [...ls.slice(0, 2), recortar(ls.slice(2).join(' '), reg, 8, W - 2 * MX - 10)] : ls;
  });
  const altoPrior = prior.reduce((s, ls) => s + ls.length * 10.5 + 3, 0) + 18;
  const yPrior = yNota + 14 + altoPrior;

  y = H - 32 - 20;
  // Los cuadrantes que peor van.
  y = titulo(p2, e.cerrado ? 'Los cuadrantes que peor fueron' : 'Los cuadrantes que peor van', MX, y);
  {
    const cols = [
      { etq: 'Cuadrante', w: 50, cel: g => ({ s: g.nombre, f: bold }) },
      { etq: 'Zona', w: 64, cel: g => ({ s: g.zona }) },
      { etq: e.cerrado ? 'Cómo fueron' : 'Cómo van', w: 44, al: 'der', cel: g => ({ s: pc(g.pct), f: bold, c: tono(g.pct) }) },
      { etq: 'Llevan / debían (h)', w: 74, al: 'der', cel: g => ({ s: `${n0(g.llevan)} / ${n0(g.debian)}` }) },
      { etq: 'Sin conductor (pasados / prev.)', w: 66, al: 'der', cel: g => ({ s: g.sin }) },
      { etq: 'De ellos, sin CT', w: 52, al: 'der', cel: g => ({ s: g.sinCt }) },
    ];
    cols.push({ etq: 'Qué pasa', w: W - 2 * MX - cols.reduce((s, c) => s + c.w, 0), cel: g => ({ s: g.que, envolver: true }) });
    const r = tabla(p2, MX, y - 2, cols, e.peores, { t: 7.5, suelo: yPrior + 150 });
    y = r.y;
    if (r.fuera) { txt(p2, `y ${r.fuera} más en el Excel.`, MX, y - 9, { t: 7, c: C.suave }); y -= 10; }
  }
  y -= 16;

  // Dos columnas: lo que falta y los coches.
  const yCols = y, wCol = (W - 2 * MX - 20) / 2, xR = MX + wCol + 20;
  {
    let yy = titulo(p2, e.cerrado ? 'Lo que faltaba en el planificador' : 'Lo que falta en el planificador', MX, yCols);
    const cols = [
      { etq: 'Zona', w: 62, cel: f => ({ s: f.zona }) },
      { etq: 'Cuadrante', w: 52, cel: f => ({ s: f.cu === 'sin cuadrante' ? '—' : f.cu, f: bold }) },
      { etq: 'Coches', w: 96, cel: f => ({ s: f.coches, envolver: true }) },
    ];
    cols.push({ etq: 'Qué falta', w: wCol - cols.reduce((s, c) => s + c.w, 0), cel: f => ({ s: f.que, envolver: true, c: f.peso === 0 ? C.rojo : C.texto }) });
    if (e.cerrado) {
      parrafo(p2, e.faltanNota, MX, yy - 12, wCol, { t: 8, c: C.suave });
    } else {
      const r = tabla(p2, MX, yy - 2, cols, e.faltan, { t: 7.5, suelo: yPrior + 26 });
      const mas = e.faltanMas + r.fuera;
      if (!e.faltan.length) txt(p2, 'No falta nadie: todas las plazas tienen dueño.', MX, yy - 28, { t: 8 });
      else if (mas) txt(p2, `y ${mas} más en el Excel.`, MX, r.y - 9, { t: 7, c: C.suave });
    }
  }
  {
    let yy = titulo(p2, 'Los coches que más tiran hacia abajo', xR, yCols);
    const cols = [
      { etq: 'Coche', w: 50, cel: c => ({ s: c.mat, f: bold }) },
      { etq: 'Dónde', w: 82, cel: c => ({ s: c.donde, envolver: true }) },
      { etq: e.cerrado ? 'Cómo fue' : 'Cómo va', w: 40, al: 'der', cel: c => ({ s: pc(c.pct), f: bold, c: tono(c.pct) }) },
    ];
    cols.push({ etq: 'Por qué', w: wCol - cols.reduce((s, c) => s + c.w, 0), cel: c => ({ s: c.por, envolver: true }) });
    const r = tabla(p2, xR, yy - 2, cols, e.coches, { t: 7.5, suelo: yPrior + 26 });
    if (r.fuera) txt(p2, `y ${r.fuera} más en el Excel.`, xR, r.y - 9, { t: 7, c: C.suave });
  }

  // Las prioridades.
  {
    let yy = yPrior;
    p2.drawLine({ start: { x: MX, y: yy + 12 }, end: { x: W - MX, y: yy + 12 }, thickness: 0.6, color: C.linea });
    yy = titulo(p2, e.cerrado ? 'Lo que quedó pendiente' : 'Prioridades para cerrar el mes', MX, yy) - 6;
    prior.forEach(ls => {
      ls.forEach((l, i) => p2.drawText(l, { x: MX + (i ? 10 : 0), y: yy - i * 10.5, size: 8, font: i ? reg : reg, color: C.texto }));
      yy -= ls.length * 10.5 + 3;
    });
    if (!prior.length) {
      txt(p2, !e.hayDias ? 'Aún no hay días cerrados.' : e.deficit > 0 ? 'Sin acciones pendientes en el planificador: lo que falta se explica en la página 1.'
        : `Nada urgente: ${e.cerrado ? 'fueron' : 'van'} por encima de lo que debían.`, MX, yy, { t: 8 });
    }
  }

  return Buffer.from(await doc.save());
}

module.exports = { generar };
