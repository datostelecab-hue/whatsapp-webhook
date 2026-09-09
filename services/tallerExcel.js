// ============================================================
// EXCEL DEL TALLER — estado de la flota por kilómetros
// ============================================================
// Tres hojas con la cabecera de la casa y el filtro puesto. Es la versión que
// se usa de verdad: el PDF se imprime y se lleva a la reunión, pero esto se
// ordena por lo que interese, se filtra por zona y se le manda a cada taller su
// trozo. Un PDF no deja hacer nada de eso.
//
//   Estado de la flota  los 95 coches, de más urgente a menos
//   Por resolver        los que hoy no permiten decidir, y por qué
//   Historial           todos los apuntes vigentes
//
// Los números van como NÚMEROS, no como texto con puntos de millar: si el km va
// escrito "224.595" Excel no lo suma, no lo ordena bien y las fórmulas del
// taller no funcionan. El separador de millares lo pone el formato de celda.

const ExcelJS = require('exceljs');
const E = require('./excelEstilo');

const esFecha = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const n1 = v => (v == null ? null : Math.round(Number(v) * 10) / 10);
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

const MILES = '#,##0';
const EUROS = '#,##0.00 "€"';

// Los mismos colores que el semáforo de la pantalla, para no tener que
// aprenderse otros distintos.
const TONO = {
  toca:     { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  pronto:   { bg: 'FFFEF3C7', fg: 'FF92400E' },
  ok:       { bg: 'FFD1FAE5', fg: 'FF065F46' },
  sin_dato: { bg: 'FFF3F4F6', fg: 'FF4B5563' },
  revisar:  { bg: 'FFEDE9FE', fg: 'FF5B21B6' },
};
const ETIQUETA = {
  toca: 'TOCA REVISIÓN', pronto: 'A punto', ok: 'Al día',
  sin_dato: 'Sin dato', revisar: 'Dato imposible',
};
// Primero lo que hay que hacer, después lo que hay que vigilar, y al final lo
// que está bien. Los datos rotos van antes que los vacíos: un dato roto engaña
// y un dato vacío solo falta.
const ORDEN = { toca: 0, pronto: 1, revisar: 2, sin_dato: 3, ok: 4 };

const FUENTE = { can: 'CAN del coche', ancla: 'Ancla + GPS', ancla_fija: 'Ancla (sin GPS)' };

/** Qué le falta o qué chirría en este coche, dicho en una línea. */
function pega(f) {
  const km = v => Number(v).toLocaleString('es-ES');
  if (f.estado === 'revisar') {
    return f.desde < 0
      ? `La revisión (${km(f.revisionKm)}) está POR ENCIMA del odómetro (${km(f.odometro)}): faltan ` +
        `${km(-f.desde)} km para llegar. Una de las dos cifras está mal.`
      : `${km(f.desde)} km desde la revisión de ${km(f.revisionKm)}. O lleva media vida sin pasar por ` +
        `taller, o esa cifra no es de este coche.`;
  }
  if (f.odometro == null && f.revisionKm == null) return 'Sin odómetro y sin km de revisión: no se sabe nada de este coche.';
  if (f.odometro == null) return `Tiene su revisión (${km(f.revisionKm)}) pero no hay odómetro: hay que leer el cuadro una vez y anclarlo.`;
  if (f.revisionKm == null) return `Marca ${km(f.odometro)} km pero no consta ninguna revisión. Falta el km de la última.`;
  return '';
}

/** Una hoja con su banda, su cabecera, sus filas y el filtro puesto. */
function hoja(wb, idLogo, nombre, titulo, subtitulo, cols, filas, vacio) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = cols.map(c => ({ width: c.ancho }));
  let f = E.bandaCabecera(ws, idLogo, titulo, subtitulo, cols.length);
  const filaCab = f;
  f = E.cabeceraTabla(ws, f, cols.map(c => c.titulo));
  // Congelado JUSTO bajo los títulos, calculado y no a ojo: la banda de arriba
  // cambia de alto según el subtítulo.
  ws.views = [{ state: 'frozen', ySplit: filaCab }];

  filas.forEach(d => {
    const r = ws.getRow(f++);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      cel.value = c.valor(d);
      cel.border = E.TODOS_BORDES;
      cel.font = { size: 10, color: { argb: c.rojo ? 'FFB91C1C' : E.TEXTO } };
      cel.alignment = { vertical: 'middle', horizontal: c.al || 'left', wrapText: !!c.envuelve };
      if (c.formato) cel.numFmt = c.formato;
      const t = c.tono && c.tono(d);
      if (t) { cel.fill = E.relleno(t.bg); cel.font = { size: 10, bold: true, color: { argb: t.fg } }; }
    });
    r.height = 17;
  });

  if (!filas.length) {
    const c = ws.getRow(f).getCell(1);
    c.value = vacio || 'Nada que enseñar aquí.';
    c.font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
  return ws;
}

/**
 * @param {Object} datos  lo que devuelve services/repo/taller.todo()
 * @returns {Promise<Buffer>}
 */
async function generar({ filas, resumen, historial, intervalo }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);

  // El número de cada uno, por Map y no por indexOf: con 95 filas, indexOf
  // recorre la lista entera en cada celda.
  const numDe = lista => { const m = new Map(lista.map((d, i) => [d, i + 1])); return d => m.get(d) || null; };

  const pie = `generado el ${sello()}`;
  const cifras = `${resumen.total} coches · ${resumen.toca} tocan revisión · ${resumen.pronto} a punto · ` +
    `${resumen.ok} al día · ${resumen.sinDato} sin dato · ${resumen.revisar} con un dato que no cuadra`;

  // ── 1. Estado de la flota ──────────────────────────────────────────────────
  const orden = [...filas].sort((a, b) =>
    (ORDEN[a.estado] - ORDEN[b.estado]) || ((b.desde ?? -1e9) - (a.desde ?? -1e9)) ||
    a.matricula.localeCompare(b.matricula));

  hoja(wb, logo, 'Estado de la flota',
    'Taller · mantenimiento por kilómetros',
    `Revisión cada ${intervalo.toLocaleString('es-ES')} km · ${cifras} · ordenados por urgencia · ${pie}`,
    [
      { titulo: '#', ancho: 5, al: 'center', valor: numDe(orden) },
      { titulo: 'Matrícula', ancho: 11, valor: d => d.matricula },
      { titulo: 'Vehículo', ancho: 24, valor: d => d.vehiculo },
      { titulo: 'Año', ancho: 7, al: 'center', valor: d => d.anio },
      { titulo: 'Estado', ancho: 16, al: 'center',
        valor: d => ETIQUETA[d.estado] || d.estado, tono: d => TONO[d.estado] },
      { titulo: 'Odómetro', ancho: 12, al: 'right', formato: MILES, valor: d => d.odometro },
      { titulo: 'De dónde sale', ancho: 15, valor: d => FUENTE[d.odometroFuente] || 'no hay' },
      { titulo: 'Últ. revisión', ancho: 12, al: 'right', formato: MILES, valor: d => d.revisionKm },
      { titulo: 'Fecha revisión', ancho: 13, al: 'center', valor: d => esFecha(d.revisionFecha) },
      { titulo: 'Km desde la revisión', ancho: 18, al: 'right', formato: MILES,
        valor: d => d.desde, tono: d => (d.estado === 'toca' ? TONO.toca : null) },
      { titulo: 'Intervalo', ancho: 10, al: 'right', formato: MILES, valor: d => d.intervalo },
      { titulo: 'Intervalo propio', ancho: 14, al: 'center', valor: d => (d.intervaloPropio ? 'sí' : '') },
      { titulo: '% consumido', ancho: 12, al: 'center', formato: '0"%"', valor: d => d.porcentaje },
      { titulo: 'Km/día', ancho: 9, al: 'right', formato: '#,##0.0', valor: d => n1(d.kmDia) },
      { titulo: 'Le quedan km', ancho: 13, al: 'right', formato: MILES, valor: d => d.restan },
      { titulo: 'Le quedan días', ancho: 13, al: 'center', valor: d => d.dias },
      { titulo: 'Estado operativo', ancho: 15, valor: d => d.estadoOperativo || '' },
      { titulo: 'Zona', ancho: 14, valor: d => d.zona || '' },
      { titulo: 'Apuntes', ancho: 9, al: 'center', valor: d => d.movimientos },
    ], orden);

  // ── 2. Lo que hay que resolver ─────────────────────────────────────────────
  const pendientes = filas
    .filter(f => f.estado === 'revisar' || f.odometro == null || f.revisionKm == null)
    .map(f => ({ ...f, pega: pega(f) }))
    .sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) || a.matricula.localeCompare(b.matricula));

  hoja(wb, logo, 'Por resolver',
    'Lo que hay que resolver',
    `${pendientes.length} coches sobre los que hoy no se puede decidir · esto no se arregla en el taller: ` +
    `se arregla leyendo un cuadro o pidiendo el km de la última revisión · ${pie}`,
    [
      { titulo: '#', ancho: 5, al: 'center', valor: numDe(pendientes) },
      { titulo: 'Matrícula', ancho: 11, valor: d => d.matricula },
      { titulo: 'Vehículo', ancho: 24, valor: d => d.vehiculo },
      { titulo: 'Estado', ancho: 16, al: 'center',
        valor: d => ETIQUETA[d.estado] || d.estado, tono: d => TONO[d.estado] },
      { titulo: 'Odómetro', ancho: 12, al: 'right', formato: MILES, valor: d => d.odometro },
      { titulo: 'Últ. revisión', ancho: 12, al: 'right', formato: MILES, valor: d => d.revisionKm },
      { titulo: 'Qué pasa', ancho: 96, envuelve: true, valor: d => d.pega },
      { titulo: 'Km que hay que pedir', ancho: 20, valor: () => '' },
    ], pendientes,
    'Nada pendiente: todos los coches tienen odómetro y km de revisión.');

  // ── 3. El historial ────────────────────────────────────────────────────────
  hoja(wb, logo, 'Historial',
    'Historial de mantenimientos',
    `${historial.length} apuntes vigentes · los anulados no salen · ${pie}`,
    [
      { titulo: '#', ancho: 5, al: 'center', valor: numDe(historial) },
      { titulo: 'Matrícula', ancho: 11, valor: d => d.matricula },
      { titulo: 'Tipo', ancho: 16, valor: d => d.tipoEtiqueta },
      { titulo: 'Fecha', ancho: 12, al: 'center', valor: d => esFecha(d.fecha) },
      { titulo: 'Km', ancho: 12, al: 'right', formato: MILES, valor: d => d.km },
      { titulo: 'Taller', ancho: 22, valor: d => d.taller || '' },
      { titulo: 'Coste', ancho: 12, al: 'right', formato: EUROS, valor: d => d.coste },
      { titulo: 'Apuntado el', ancho: 12, al: 'center', valor: d => esFecha(d.creadoAt) },
      { titulo: 'Lo apuntó', ancho: 18, valor: d => d.usuario || '' },
      { titulo: 'Detalle', ancho: 80, envuelve: true, valor: d => d.descripcion || '' },
    ], historial, 'Ningún mantenimiento apuntado todavía.');

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
