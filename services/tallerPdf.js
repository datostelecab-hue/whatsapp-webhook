// ============================================================
// PDF DEL TALLER — estado de la flota por kilómetros
// ============================================================
// A4 apaisado, con la cabecera de la casa. Tres partes, en el orden en que se
// usan:
//
//   1. El estado de los 95 coches, ordenados por urgencia y no por matrícula:
//      lo primero de la primera página es lo que hay que meter en taller.
//   2. Lo que hay que resolver — coches sin odómetro, sin km de revisión o con
//      dos cifras que se contradicen. Es la lista de deberes, y va aparte
//      porque no se arregla en el taller sino con una llamada o una lectura.
//   3. El historial entero de mantenimientos.
//
// El papel se lleva a una reunión y se lee en voz alta, así que cada fila lleva
// su número: "el 7" es más rápido que deletrear una matrícula.

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
  ambarBg: rgb(0.996, 0.953, 0.831), verdeBg: rgb(0.82, 0.98, 0.90),
  violetaBg: rgb(0.91, 0.88, 0.99), grisBg: rgb(0.93, 0.94, 0.95),
  cabTexto: rgb(0.78, 0.80, 0.84),
};

// Las fuentes estándar del PDF no salen de Latin-1: los acentos y la ñ entran,
// las flechas y los emojis revientan la generación.
const SUST = { '→': '->', '–': '-', '—': '-', '·': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR', '▲': '', '⚠': '' };
const L = s => String(s == null ? '' : s)
  .replace(/[→–—·…“”‘’€▲⚠]/g, c => SUST[c] || '').replace(/[^\x00-\xFF]/g, '').trim();

const ETIQUETA = {
  toca: 'TOCA', pronto: 'A punto', ok: 'Al dia',
  sin_dato: 'Sin dato', revisar: 'Revisar',
};
const TONO = {
  toca: C.rojoBg, pronto: C.ambarBg, ok: C.verdeBg,
  sin_dato: C.grisBg, revisar: C.violetaBg,
};
// El orden del informe: primero lo que hay que hacer, después lo que hay que
// vigilar, y al final lo que está bien. Los datos rotos van antes que los
// vacíos porque un dato roto engaña y un dato vacío solo falta.
const ORDEN = { toca: 0, pronto: 1, revisar: 2, sin_dato: 3, ok: 4 };

const n = v => (v == null ? '-' : Number(v).toLocaleString('es-ES', { useGrouping: 'always', maximumFractionDigits: 0 }));
const n1 = v => (v == null ? '-' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const esFecha = iso => (iso ? iso.split('-').reverse().join('/') : '');
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

/** Qué le falta o qué chirría en este coche, dicho en una línea. */
function pega(f, intervalo) {
  if (f.estado === 'revisar') {
    return f.desde < 0
      ? `La revision (${n(f.revisionKm)}) esta POR ENCIMA del odometro (${n(f.odometro)}): faltan ${n(-f.desde)} km para llegar. Una de las dos cifras esta mal.`
      : `${n(f.desde)} km desde la revision de ${n(f.revisionKm)}. O lleva media vida sin pasar por taller o esa cifra no es de este coche.`;
  }
  if (f.odometro == null && f.revisionKm == null) return 'Sin odometro y sin km de revision: no se sabe nada de este coche.';
  if (f.odometro == null) return `Tiene su revision (${n(f.revisionKm)}) pero no hay odometro: hay que leer el cuadro una vez y anclarlo.`;
  if (f.revisionKm == null) return `Marca ${n(f.odometro)} km pero no consta ninguna revision. Falta el km de la ultima.`;
  return '';
}

/**
 * @param {Object} datos  lo que devuelve services/repo/taller.todo()
 * @returns {Promise<Buffer>}
 */
async function generar({ filas, resumen, historial, intervalo }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Taller - estado de la flota por km`);
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
    if (!cols) return;
    pg.drawRectangle({ x: MX, y: y - 15, width: W - MX * 2, height: 17, color: C.cab });
    let x = MX + 5;
    cols.forEach(c => {
      const t = L(c.titulo);
      pg.drawText(t, {
        x: c.al === 'c' ? x + (c.w - bold.widthOfTextAtSize(t, 7.5)) / 2
          : c.al === 'd' ? x + c.w - bold.widthOfTextAtSize(t, 7.5) - 6 : x,
        y: y - 11, size: 7.5, font: bold, color: C.blanco,
      });
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
      // Se recorta al ancho de su columna: un modelo largo no puede pisar al vecino.
      let t = L(c.valor(d));
      while (t && f.widthOfTextAtSize(t, s) > c.w - 6) t = t.slice(0, -1);
      const an = f.widthOfTextAtSize(t, s);
      pg.drawText(t, {
        x: c.al === 'c' ? x + (c.w - an) / 2 : c.al === 'd' ? x + c.w - an - 6 : x,
        y: y - 8, size: s, font: f, color: c.color ? c.color(d) : C.texto,
      });
      x += c.w;
    });
    pg.drawLine({ start: { x: MX, y: y - 12 }, end: { x: W - MX, y: y - 12 }, thickness: 0.4, color: C.linea });
    y -= FILA;
  };

  const tabla = (titulo, subtitulo, cols, datos, vacio) => {
    nuevaPagina(titulo, subtitulo, cols);
    datos.forEach((d, i) => {
      if (y < 30) nuevaPagina(`${titulo} (cont.)`, subtitulo, cols);
      fila(d, cols, i);
    });
    if (!datos.length) {
      pg.drawText(L(vacio || 'Nada que enseñar aqui.'),
        { x: MX + 5, y: y - 8, size: 9, font: reg, color: C.suave });
    }
  };

  const numDe = lista => { const m = new Map(lista.map((d, i) => [d, i + 1])); return d => String(m.get(d) || ''); };

  const cabecera = `Revision cada ${n(intervalo)} km - ${resumen.total} coches: ` +
    `${resumen.toca} tocan, ${resumen.pronto} a punto, ${resumen.ok} al dia, ` +
    `${resumen.sinDato} sin dato, ${resumen.revisar} con un dato que no cuadra - ${sello()}`;

  // ── 1. El estado de la flota ───────────────────────────────────────────────
  const orden = [...filas].sort((a, b) =>
    (ORDEN[a.estado] - ORDEN[b.estado]) || ((b.desde ?? -1e9) - (a.desde ?? -1e9)) ||
    a.matricula.localeCompare(b.matricula));

  tabla('Taller - estado de la flota por km', cabecera, [
    { titulo: 'Nº', w: 24, al: 'c', bold: true, valor: numDe(orden) },
    { titulo: 'Matricula', w: 62, bold: true, valor: d => d.matricula },
    { titulo: 'Vehiculo', w: 116, size: 7.5, valor: d => d.vehiculo },
    { titulo: 'Estado', w: 50, al: 'c', bold: true, size: 7.5,
      valor: d => ETIQUETA[d.estado] || d.estado, tono: d => TONO[d.estado] },
    { titulo: 'Odometro', w: 62, al: 'd', valor: d => n(d.odometro) },
    { titulo: 'Fte', w: 26, al: 'c', size: 7,
      valor: d => (d.odometroFuente === 'can' ? 'CAN' : d.odometroFuente ? 'ancla' : '-') },
    { titulo: 'Ult. revision', w: 62, al: 'd', valor: d => n(d.revisionKm) },
    { titulo: 'Fecha', w: 46, al: 'c', size: 7.5, valor: d => esFecha(d.revisionFecha) || '-' },
    { titulo: 'Desde', w: 56, al: 'd', bold: true, valor: d => n(d.desde),
      color: d => (d.estado === 'toca' ? C.rojo : C.texto) },
    { titulo: 'Intervalo', w: 52, al: 'd', size: 7.5,
      valor: d => n(d.intervalo) + (d.intervaloPropio ? '*' : '') },
    { titulo: '%', w: 32, al: 'c', bold: true, valor: d => (d.porcentaje == null ? '-' : d.porcentaje + '%') },
    { titulo: 'km/dia', w: 44, al: 'd', valor: d => n1(d.kmDia) },
    { titulo: 'Le queda', w: 60, al: 'd', bold: true,
      valor: d => (d.restan == null ? '-' : d.restan < 0 ? 'pasado ' + n(-d.restan) : n(d.restan) + ' km') },
    { titulo: 'Dias', w: 34, al: 'c', valor: d => (d.dias == null ? '-' : String(d.dias)) },
    { titulo: 'Zona', w: 52, size: 7.5, valor: d => d.zona || '' },
  ], orden);

  // ── 2. Lo que hay que resolver ─────────────────────────────────────────────
  const pendientes = filas
    .filter(f => f.estado === 'revisar' || f.odometro == null || f.revisionKm == null)
    .map(f => ({ ...f, pega: pega(f, intervalo) }))
    .sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) || a.matricula.localeCompare(b.matricula));

  tabla('Lo que hay que resolver',
    `${pendientes.length} coches sobre los que hoy no se puede decidir - ${sello()}`, [
      { titulo: 'Nº', w: 24, al: 'c', bold: true, valor: numDe(pendientes) },
      { titulo: 'Matricula', w: 62, bold: true, valor: d => d.matricula },
      { titulo: 'Vehiculo', w: 110, size: 7.5, valor: d => d.vehiculo },
      { titulo: 'Estado', w: 50, al: 'c', bold: true, size: 7.5,
        valor: d => ETIQUETA[d.estado] || d.estado, tono: d => TONO[d.estado] },
      { titulo: 'Odometro', w: 62, al: 'd', valor: d => n(d.odometro) },
      { titulo: 'Ult. revision', w: 62, al: 'd', valor: d => n(d.revisionKm) },
      { titulo: 'Que pasa', w: 410, size: 7, valor: d => d.pega },
    ], pendientes, 'Nada pendiente: todos los coches tienen odometro y km de revision.');

  // ── 3. El historial ────────────────────────────────────────────────────────
  tabla('Historial de mantenimientos',
    `${historial.length} apuntes vigentes (los anulados no salen) - ${sello()}`, [
      { titulo: 'Nº', w: 24, al: 'c', bold: true, valor: numDe(historial) },
      { titulo: 'Matricula', w: 62, bold: true, valor: d => d.matricula },
      { titulo: 'Tipo', w: 78, size: 7.5, valor: d => d.tipoEtiqueta },
      { titulo: 'Fecha', w: 50, al: 'c', size: 7.5, valor: d => esFecha(d.fecha) || 'sin fecha' },
      { titulo: 'Km', w: 62, al: 'd', bold: true, valor: d => n(d.km) },
      { titulo: 'Taller', w: 92, size: 7.5, valor: d => d.taller || '' },
      { titulo: 'Coste', w: 52, al: 'd', valor: d => (d.coste == null ? '' : n1(d.coste) + ' EUR') },
      { titulo: 'Apuntado', w: 50, al: 'c', size: 7, valor: d => esFecha(d.creadoAt) },
      { titulo: 'Detalle', w: 320, size: 7, valor: d => d.descripcion || '' },
    ], historial, 'Ningun mantenimiento apuntado todavia.');

  // El pie va al final, cuando ya se sabe cuántas páginas hay.
  doc.getPages().forEach((p, i) => {
    p.drawText(L(`Pagina ${i + 1} de ${paginas}   -   el odometro sale del CAN del coche o de una lectura ` +
      'del cuadro anclada a mano   -   "km/dia" es el ritmo real de los ultimos 30 dias   -   ' +
      '* intervalo propio de ese coche'),
    { x: MX, y: 16, size: 7, font: reg, color: C.suave });
  });

  return Buffer.from(await doc.save());
}

module.exports = { generar };
