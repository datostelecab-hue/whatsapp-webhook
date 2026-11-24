// ============================================================
// BARCELONA · RECAUDACIÓN — el Excel de lo que debe cada uno
// ============================================================
// Camilo, 24/11/2026: «necesito un excel de recaudación con el monto que debe
// cada uno según los datos de BOLT y lo que nos han dado, pero solo en
// Barcelona», y luego «hazlo ya automático en el ERP, que sea un botón». El
// botón «Descargar Excel» de /barcelona/recaudacion.
//
// LOS NÚMEROS SON LOS DE LA PANTALLA: salen del mismo `repo.cuadro()` que la
// pestaña «Efectivo» (recaudacion.service.excelDeuda arma los datos). Aquí
// solo se pinta. Tres hojas:
//   · Lo que debe cada uno: de más a menos, con BOLT quincena a quincena, y
//     «Total entregado» y «DEBE» como fórmulas (se ve de dónde sale cada cifra);
//     los totales con SUBTOTAL, que siguen cuadrando al filtrar.
//   · Entregas: lo que nos han dado, apunte a apunte, sin los anulados.
//   · Cómo se calcula.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const CONTA = '_-* #,##0.00\\ "€"_-;\\-* #,##0.00\\ "€"_-;_-* "-"\\ "€"_-;_-@_-';
const es = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TIPOS = { presencial: 'En mano', nomina: 'Por nómina', transferencia: 'Transferencia', remesa: 'Remesa',
  entrega: 'Devuelto al conductor', cambio: 'Cambio que se le dio' };
const ROJO = 'FFB91C1C';
const VERDE = 'FF047857';
const fuente = (extra = {}) => ({ name: 'Calibri', size: 10, color: { argb: E.TEXTO }, ...extra });

/** «BOLT 16–30 nov (hasta hoy)»: la cabecera de una quincena. */
function etiquetaQuincena(q, esLaUltima) {
  const fin = q.quincena === 1 ? 15 : new Date(Date.UTC(q.anio, q.mes, 0)).getUTCDate();
  return `BOLT ${q.quincena === 1 ? 1 : 16}–${fin} ${MESES[q.mes]}${esLaUltima ? ' (hasta hoy)' : ''}`;
}

/** La fila de totales, en oro, con SUBTOTAL de las columnas de dinero. */
function filaTotal(ws, r, texto, desde, hasta, columnas, nCols) {
  const fila = ws.getRow(r);
  fila.getCell(1).value = texto;
  columnas.forEach(col => {
    const l = E.colLetra(col);
    fila.getCell(col).value = { formula: `SUBTOTAL(9,${l}${desde}:${l}${hasta})` };
    fila.getCell(col).numFmt = CONTA;
  });
  for (let col = 1; col <= nCols; col++) {
    const cel = fila.getCell(col);
    cel.font = fuente({ bold: true, color: { argb: E.DARK } });
    cel.fill = E.relleno(E.GOLD);
    cel.border = E.TODOS_BORDES;
  }
}

/**
 * El libro. `filas` son las del cuadro (bolt, enMano, nomina, transferencia,
 * remesa, cambio, aRecaudar…); `cierres`, el efectivo de BOLT por persona y
 * quincena ({ quien, anio, mes, quincena, bolt }); `movs`, las entregas.
 * Devuelve los bytes del .xlsx.
 */
async function generar({ filas, cierres, movs, hoy, sede = 'Barcelona' }) {
  const quincenas = [...new Map(cierres.map(q => [`${q.anio}-${q.mes}-${q.quincena}`, q])).values()]
    .sort((a, b) => a.anio - b.anio || a.mes - b.mes || a.quincena - b.quincena);
  const porQ = new Map();
  cierres.forEach(q => {
    const k = `${q.quien}|${q.anio}-${q.mes}-${q.quincena}`;
    porQ.set(k, (porQ.get(k) || 0) + Number(q.bolt || 0));
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  // Que Excel recalcule al abrir: «Total entregado», «DEBE» y los totales son fórmulas.
  wb.calcProperties.fullCalcOnLoad = true;
  const idLogo = E.registrarLogo(wb);
  const titulo = `RECAUDACIÓN ${sede.toUpperCase()}`;

  // ── Hoja 1: lo que debe cada uno ─────────────────────────────────────────
  const DINERO = ['Total cobrado en efectivo (BOLT)', 'Entregado en mano', 'Por nómina', 'Transferencia', 'Remesas',
    'Total entregado', 'Cambio que le dimos', 'DEBE'];
  const cab = ['Conductor', 'Cuenta de BOLT', 'Efectivo en BOLT',
    ...quincenas.map((q, i) => etiquetaQuincena(q, i === quincenas.length - 1)), ...DINERO,
    'Última entrega', 'Días sin entregar'];
  const n = cab.length;
  const c = nombre => cab.indexOf(nombre) + 1;
  const L = nombre => E.colLetra(c(nombre));
  const ws = wb.addWorksheet('Lo que debe cada uno', { views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }] });
  E.bandaCabecera(ws, idLogo, `${titulo} · LO QUE DEBE CADA UNO`,
    `Efectivo cobrado según BOLT y lo que nos han entregado. Datos a ${es(hoy)}.`, n);
  E.cabeceraTabla(ws, 4, cab, { alto: 34, ajustar: true });

  const ordenadas = [...filas].sort((a, b) => b.aRecaudar - a.aRecaudar || String(a.conductor).localeCompare(String(b.conductor)));
  const primera = 5;
  const primeraDinero = 4;   // la primera quincena (o «Total cobrado» si no hay ninguna)
  ordenadas.forEach((f, i) => {
    const r = primera + i;
    const fila = ws.getRow(r);
    fila.values = [f.conductor, f.enPlantilla ? 'Activa' : 'Desactivada',
      f.efectivoActivo == null ? '—' : f.efectivoActivo ? 'Sí' : 'No',
      ...quincenas.map(q => +(porQ.get(`${f.conductorId}|${q.anio}-${q.mes}-${q.quincena}`) || 0).toFixed(2)),
      f.bolt, f.enMano, f.nomina, f.transferencia, f.remesa, null, f.cambio, null,
      f.ultimaEntrega ? es(f.ultimaEntrega) : 'Nunca',
      f.ultimaEntrega ? f.diasSinEntregar : null];
    const entregado = ['Entregado en mano', 'Por nómina', 'Transferencia', 'Remesas'].map(x => `${L(x)}${r}`).join('+');
    fila.getCell(c('Total entregado')).value = {
      formula: entregado, result: +(f.enMano + f.nomina + f.transferencia + f.remesa).toFixed(2),
    };
    fila.getCell(c('DEBE')).value = {
      formula: `${L('Total cobrado en efectivo (BOLT)')}${r}+${L('Cambio que le dimos')}${r}-${L('Total entregado')}${r}`,
      result: f.aRecaudar,
    };
    for (let col = 1; col <= n; col++) {
      const cel = fila.getCell(col);
      cel.border = E.TODOS_BORDES;
      cel.font = fuente();
      if (col >= primeraDinero && col <= c('DEBE')) cel.numFmt = CONTA;
      if (col === 2 || col === 3 || col >= c('Última entrega')) cel.alignment = { horizontal: 'center' };
    }
    // Rojo lo que debe; verde (y negativo) lo que ha entregado de más.
    fila.getCell(c('DEBE')).font = fuente({ bold: true,
      color: { argb: f.aRecaudar > 0.005 ? ROJO : f.aRecaudar < -0.005 ? VERDE : E.TEXTO } });
    if (!f.enPlantilla) fila.getCell(2).font = fuente({ color: { argb: E.TENUE } });
    if (!f.ultimaEntrega && f.aRecaudar > 0.005) fila.getCell(c('Última entrega')).font = fuente({ bold: true, color: { argb: ROJO } });
  });
  const ult = primera + Math.max(ordenadas.length, 1) - 1;
  const colsDinero = [];
  for (let col = primeraDinero; col <= c('DEBE'); col++) colsDinero.push(col);
  filaTotal(ws, ult + 1, `TOTAL (${ordenadas.length} ${ordenadas.length === 1 ? 'cuenta' : 'cuentas'})`, primera, ult, colsDinero, n);
  if (ordenadas.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: ult, column: n } };
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 11;
  colsDinero.forEach(col => { ws.getColumn(col).width = 15; });
  ws.getColumn(c('Última entrega')).width = 13;
  ws.getColumn(c('Días sin entregar')).width = 11;

  // ── Hoja 2: lo que nos han dado, apunte a apunte ─────────────────────────
  const cab2 = ['Fecha', 'Conductor', 'Cómo', 'Importe', 'Observación', 'Referencia'];
  const w2 = wb.addWorksheet('Entregas', { views: [{ state: 'frozen', ySplit: 4 }] });
  E.bandaCabecera(w2, idLogo, `${titulo} · LO QUE NOS HAN DADO`,
    'Cada entrega apuntada en Recaudación, sin las anuladas. «Devuelto al conductor» resta de lo entregado; «Cambio que se le dio» suma a lo que debe.', cab2.length);
  E.cabeceraTabla(w2, 4, cab2, { alto: 22 });
  movs.forEach((m, i) => {
    const fila = w2.getRow(5 + i);
    fila.values = [es(m.fecha), m.conductor, TIPOS[m.tipo] || m.tipo, Number(m.importe), m.observacion || '', m.referencia || ''];
    for (let col = 1; col <= cab2.length; col++) {
      fila.getCell(col).border = E.TODOS_BORDES;
      fila.getCell(col).font = fuente();
    }
    fila.getCell(1).alignment = { horizontal: 'center' };
    fila.getCell(4).numFmt = CONTA;
  });
  if (movs.length) {
    filaTotal(w2, 5 + movs.length, 'TOTAL', 5, 4 + movs.length, [4], cab2.length);
    w2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + movs.length, column: cab2.length } };
  } else {
    w2.getCell('A5').value = 'Todavía no hay ninguna entrega apuntada.';
    w2.getCell('A5').font = fuente({ italic: true, color: { argb: E.TENUE } });
  }
  [12, 34, 20, 14, 50, 22].forEach((w, i) => { w2.getColumn(i + 1).width = w; });

  // ── Hoja 3: cómo se calcula ──────────────────────────────────────────────
  const w3 = wb.addWorksheet('Cómo se calcula');
  E.bandaCabecera(w3, idLogo, `${titulo} · CÓMO SE CALCULA`, `Datos a ${es(hoy)}.`, 2);
  E.cabeceraTabla(w3, 4, ['Concepto', 'Explicación'], { alto: 20 });
  [
    ['Qué es', `Lo mismo que la pantalla de Recaudación de ${sede} (pestaña «Efectivo»), por cuenta de BOLT.`],
    ['Desde cuándo', 'Desde el corte de la sede: el 01/11/2026. Antes no hay nada.'],
    ['Cobrado según BOLT', 'El efectivo de sus viajes terminados y pagados en efectivo, quincena a quincena: precio − descuento de efectivo + tarifa de reserva, más los ajustes con motivo. La quincena en curso llega hasta el último cálculo desde BOLT.'],
    ['Entregado en mano', 'Lo entregado en ventanilla menos lo que se le devolvió.'],
    ['Por nómina, transferencia y remesas', 'También bajan lo que debe, sin pasar por ventanilla.'],
    ['Cambio que le dimos', 'Dinero que le dimos nosotros para cambio y aún no ha vuelto: suma a lo que debe (BOLT no lo sabe).'],
    ['DEBE', 'Total cobrado (BOLT) + cambio − total entregado. En rojo, lo que debe; en verde y en negativo, lo que ha entregado de más.'],
    ['Cuenta de BOLT', '«Desactivada»: la cuenta ya no está activa en BOLT.'],
    ['Efectivo en BOLT', 'Si BOLT le deja cobrar en efectivo ahora mismo.'],
  ].forEach((x, i) => {
    const fila = w3.getRow(5 + i);
    fila.values = x;
    fila.getCell(1).font = fuente({ bold: true });
    fila.getCell(2).font = fuente();
    fila.getCell(1).alignment = { vertical: 'top' };
    fila.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });
  w3.getColumn(1).width = 30;
  w3.getColumn(2).width = 100;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar, etiquetaQuincena };
