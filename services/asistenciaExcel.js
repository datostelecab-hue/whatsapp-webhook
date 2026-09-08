// ============================================================
// EXCEL DE ASISTENCIA — reincidentes y plantilla por promedio
// ============================================================
// Dos hojas, la cabecera de la casa y filtros puestos: esto se abre para
// ordenar, filtrar por turno y mandarle a alguien su trozo, que es lo que no
// deja hacer un PDF.
//
// Cada fila lleva su NÚMERO al lado, igual que en el PDF: el reporte se lee en
// voz alta en la reunión y "el 7" es más rápido que el nombre entero.

const ExcelJS = require('exceljs');
const E = require('./excelEstilo');

const esFecha = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const n1 = v => (v == null ? null : Math.round(Number(v) * 10) / 10);
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

// Los mismos colores que la nota en pantalla, para no tener que aprenderse otros.
const TONO = {
  S: { bg: 'FFD1FAE5', fg: 'FF065F46' }, A: { bg: 'FFFEF3C7', fg: 'FF92400E' },
  B: { bg: 'FFFFEDD5', fg: 'FF9A3412' }, C: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  N: { bg: 'FFDBEAFE', fg: 'FF1E40AF' },
};
const tonoFaltas = d => (d.faltas >= 3 ? TONO.C : d.faltas === 2 ? TONO.B : null);

/** Una hoja con su banda, su cabecera, sus filas y el filtro puesto. */
function hoja(wb, idLogo, nombre, titulo, subtitulo, cols, filas) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = cols.map(c => ({ width: c.ancho }));
  let f = E.bandaCabecera(ws, idLogo, titulo, subtitulo, cols.length);
  const filaCab = f;
  f = E.cabeceraTabla(ws, f, cols.map(c => c.titulo));
  // Se congela JUSTO bajo la fila de títulos, calculada y no a ojo: la banda de
  // arriba puede ocupar dos filas o tres según el subtítulo, y con un número fijo
  // se quedaba congelada también la primera persona de la lista.
  ws.views = [{ state: 'frozen', ySplit: filaCab }];

  filas.forEach(d => {
    const r = ws.getRow(f++);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      cel.value = c.valor(d);
      cel.border = E.TODOS_BORDES;
      cel.font = { size: 10, color: { argb: c.rojo ? 'FFB91C1C' : E.TEXTO } };
      cel.alignment = { vertical: 'middle', horizontal: c.al || 'left' };
      if (c.formato) cel.numFmt = c.formato;
      const t = c.tono && c.tono(d);
      if (t) { cel.fill = E.relleno(t.bg); cel.font = { size: 10, bold: true, color: { argb: t.fg } }; }
    });
    r.height = 17;
  });

  if (!filas.length) {
    ws.getRow(f).getCell(1).value = 'Nadie. Ni una falta en el periodo.';
    ws.getRow(f).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
  return ws;
}

/**
 * @param {Object} datos  lo que devuelve services/repo/asistencia.faltas()
 * @returns {Promise<Buffer>}
 */
async function generar({ desde, hasta, reincidentes, porPromedio }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  const periodo = `Del ${esFecha(desde)} al ${esFecha(hasta)}`;

  // El número de cada uno, por Map y no por indexOf: con 220 filas, indexOf
  // recorre la lista entera en cada celda.
  const numDe = lista => { const m = new Map(lista.map((d, i) => [d, i + 1])); return d => m.get(d) || null; };

  hoja(wb, logo, 'Faltas',
    'Faltas de asistencia',
    `${periodo} · ${reincidentes.length} personas con al menos una falta · la libranza es la de HOY ` +
    `proyectada hacia atrás · una falta es 0 h en BOLT sin justificante · generado el ${sello()}`,
    [
      { titulo: '#', ancho: 5, al: 'center', valor: numDe(reincidentes) },
      { titulo: 'Nombre', ancho: 34, valor: d => d.nombre },
      { titulo: 'Teléfono', ancho: 14, valor: d => d.telefono },
      { titulo: 'Coche', ancho: 10, al: 'center', valor: d => d.coche },
      { titulo: 'Turno', ancho: 9, al: 'center', valor: d => d.turno },
      { titulo: 'Libra', ancho: 7, al: 'center', valor: d => d.libra || '' },
      { titulo: 'Le tocaba', ancho: 10, al: 'center', valor: d => d.tocaba },
      { titulo: 'Faltó', ancho: 8, al: 'center', valor: d => d.faltas, tono: tonoFaltas },
      { titulo: 'Días que faltó', ancho: 30, valor: d => d.dias_falta || '' },
      { titulo: 'Promedio', ancho: 10, al: 'center', formato: '0.0', valor: d => n1(d.horas_prom) },
      { titulo: 'Nota', ancho: 7, al: 'center', valor: d => d.letra || '', tono: d => TONO[d.letra] || null },
      { titulo: 'Últ. día con horas', ancho: 16, al: 'center', valor: d => d.ultimo_dia || 'nunca' },
      { titulo: 'Ojo', ancho: 26, rojo: true, valor: d => d.ojo || '' },
    ], reincidentes);

  hoja(wb, logo, 'Plantilla por promedio',
    'Plantilla entera por promedio',
    `Mes corrido · ${porPromedio.length} personas en activo · de menor a mayor promedio · ` +
    `S ≥9 h · A 8-9 · B 6-8 · C <6 · N recién incorporado · generado el ${sello()}`,
    [
      { titulo: '#', ancho: 5, al: 'center', valor: numDe(porPromedio) },
      { titulo: 'Nombre', ancho: 34, valor: d => d.nombre },
      { titulo: 'Teléfono', ancho: 14, valor: d => d.telefono },
      { titulo: 'Coche', ancho: 10, al: 'center', valor: d => d.coche },
      { titulo: 'Turno', ancho: 9, al: 'center', valor: d => d.turno },
      { titulo: 'Contrato', ancho: 12, al: 'center', valor: d => (d.tipo === 'ett' ? (d.ett || 'ETT') : 'Propia') },
      { titulo: 'Promedio', ancho: 10, al: 'center', formato: '0.0', valor: d => n1(d.horas_prom) },
      { titulo: 'Nota', ancho: 7, al: 'center', valor: d => d.letra || '', tono: d => TONO[d.letra] || null },
      { titulo: 'Días a 0', ancho: 9, al: 'center', valor: d => d.dias_cero },
      { titulo: `Faltas ${esFecha(desde)}-${esFecha(hasta)}`, ancho: 20, al: 'center',
        valor: d => d.faltas, tono: tonoFaltas },
      { titulo: 'Alta', ancho: 12, al: 'center', valor: d => esFecha(d.alta) },
      { titulo: 'Últ. día con horas', ancho: 16, al: 'center', valor: d => d.ultimo_dia || 'nunca' },
      { titulo: 'Ojo', ancho: 26, rojo: true, valor: d => d.ojo || '' },
    ], porPromedio);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
