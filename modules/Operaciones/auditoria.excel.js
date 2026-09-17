// ============================================================
// AUDITORÍA DE FLOTA — los Excel
// ============================================================
// UN EXCEL POR TABLA, no un libro con muchas hojas. Cada tabla de la pantalla se
// descarga por separado con TODAS sus columnas —incluidos los conductores que
// BOLT vio en ese tramo, que en pantalla no caben—. Quien pide "la auditoría"
// casi siempre quiere una de las cinco, y un libro de cinco hojas obliga a
// buscar la suya antes de poder mandarla a nadie.
//
// El Sankey no está aquí: se descarga en PDF (vectorial), en `auditoria.pdf`.

const ExcelJS = require('exceljs');

const diaES = iso => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fecha = iso => ddmm(iso) + '/' + iso.slice(0, 4);
const r1 = v => Math.round(v * 10) / 10;

// Nombre corto de cada tramo, para la hoja y para el fichero.
const NOMBRE_TRAMO = {
  dia: 'turno-dia', noche: 'turno-noche', manana: 'mitad-00-12',
  tarde: 'mitad-12-24', completo: 'dia-natural',
};
const TITULO_TRAMO = {
  dia: 'Turno de día', noche: 'Turno de noche', manana: 'Primera mitad 00-12',
  tarde: 'Segunda mitad 12-24', completo: 'Día natural',
};

/** Columnas del detalle de un tramo: exactamente lo que muestra la tabla en pantalla. */
const COLS_TRAMO = [
  { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Vehículo', key: 'veh', width: 20 },
  { header: 'Conductores (BOLT)', key: 'cond', width: 38 },
  { header: 'KM total (Mapon)', key: 'mapon', width: 16 },
  // Con qué vara se midieron esos km. Va pegada al total a propósito: quien lea
  // la columna de al lado tiene que ver en el acto si es el odómetro del coche o
  // la estimación del GPS, que no valen lo mismo.
  { header: 'Medido con', key: 'fuente', width: 12 },
  { header: 'Con pasajero', key: 'pas', width: 13 }, { header: 'Ida a recoger', key: 'ida', width: 13 },
  { header: 'Espera (disponible)', key: 'esp', width: 18 },
  { header: 'DESCANSO (ocupado)', key: 'des', width: 19 }, { header: 'FUERA (app cerrada)', key: 'fue', width: 19 },
  { header: 'KM no disponible', key: 'nod', width: 17 }, { header: '% no disponible', key: 'pctn', width: 15 },
  { header: '% con pasajero', key: 'pctp', width: 14 },
  { header: 'h con pedido', key: 'hped', width: 12 }, { header: 'h espera', key: 'hesp', width: 10 },
  { header: 'h DESCANSO', key: 'hdes', width: 12 }, { header: 'h app cerrada', key: 'hfue', width: 13 },
  { header: 'KM facturado BOLT', key: 'bolt', width: 17 }, { header: 'Viajes', key: 'viajes', width: 8 },
];

/** Remata una hoja: cabecera en negrita, panel congelado y autofiltro. */
function rematar(ws, nCols) {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: nCols } };
}

const libro = () => { const wb = new ExcelJS.Workbook(); wb.creator = 'Tibus Luxury'; return wb; };
const bytes = async wb => Buffer.from(await wb.xlsx.writeBuffer());

// ── Las cinco tablas ───────────────────────────────────────────────────────

function detalleDeTramo(wb, r, tabla) {
  const filas = tabla === 'completo' ? r.km : ((r.segmentos && r.segmentos[tabla]) || []);
  const ws = wb.addWorksheet(TITULO_TRAMO[tabla].slice(0, 31));
  ws.columns = COLS_TRAMO;
  [...filas].sort((a, b) => b.totalNoDisp - a.totalNoDisp).forEach(k => ws.addRow({
    mat: k.matricula, veh: k.vehiculo, cond: (k.conductores || []).join(' · '),
    mapon: k.totalMapon,
    fuente: k.fuenteKm === 'can' ? 'Odómetro' : k.fuenteKm === 'gps' ? 'GPS' : k.fuenteKm === 'mixta' ? 'Odóm. y GPS' : '',
    pas: k.totalPasajero, ida: k.totalIda, esp: k.totalEspera,
    des: k.totalDescanso, fue: k.totalFuera, nod: k.totalNoDisp,
    pctn: k.pctNoDisp == null ? '' : k.pctNoDisp / 100,
    pctp: k.pctPasajero == null ? '' : k.pctPasajero / 100,
    hped: k.hPedido, hesp: k.hEspera, hdes: k.hDescanso, hfue: k.hFuera,
    bolt: k.totalBolt, viajes: k.viajesBolt,
  }));
  ws.getColumn('pctn').numFmt = '0%'; ws.getColumn('pctp').numFmt = '0%';
  rematar(ws, COLS_TRAMO.length);
  return `auditoria-${NOMBRE_TRAMO[tabla]}`;
}

/** Día y noche uno al lado del otro, con el consolidado a la derecha. */
function resumenDeTurnos(wb, r) {
  const ws = wb.addWorksheet('Resumen turnos');
  ws.columns = [
    { header: 'Matrícula', key: 'mat', width: 14 },
    { header: 'DÍA · conductores (BOLT)', key: 'dc', width: 34 },
    { header: 'DÍA · KM total', key: 'dkm', width: 14 }, { header: 'DÍA · con pasajero', key: 'dpas', width: 17 },
    { header: 'DÍA · no disponible', key: 'dnd', width: 18 }, { header: 'DÍA · %', key: 'dp', width: 9 },
    { header: 'NOCHE · conductores (BOLT)', key: 'nc', width: 34 },
    { header: 'NOCHE · KM total', key: 'nkm', width: 16 }, { header: 'NOCHE · con pasajero', key: 'npas', width: 19 },
    { header: 'NOCHE · no disponible', key: 'nnd', width: 20 }, { header: 'NOCHE · %', key: 'np', width: 10 },
    { header: 'Consolidado KM', key: 'tkm', width: 15 }, { header: 'Consolidado no disp.', key: 'tnd', width: 19 },
    { header: 'Consolidado %', key: 'tp', width: 14 },
  ];
  const segDia = new Map(((r.segmentos && r.segmentos.dia) || []).map(k => [k.placa, k]));
  const segNoche = new Map(((r.segmentos && r.segmentos.noche) || []).map(k => [k.placa, k]));
  [...new Set([...segDia.keys(), ...segNoche.keys()])].map(p => ({ d: segDia.get(p), n: segNoche.get(p) }))
    .sort((a, b) => (((b.d && b.d.totalNoDisp) || 0) + ((b.n && b.n.totalNoDisp) || 0)) -
                    (((a.d && a.d.totalNoDisp) || 0) + ((a.n && a.n.totalNoDisp) || 0)))
    .forEach(({ d, n }) => {
      const tkm = r1(((d && d.totalMapon) || 0) + ((n && n.totalMapon) || 0));
      const tnd = r1(((d && d.totalNoDisp) || 0) + ((n && n.totalNoDisp) || 0));
      const fila = ws.addRow({
        mat: (d || n).matricula,
        dc: d ? (d.conductores || []).join(' · ') : '', dkm: d ? d.totalMapon : '', dpas: d ? d.totalPasajero : '',
        dnd: d ? d.totalNoDisp : '', dp: d && d.pctNoDisp != null ? d.pctNoDisp / 100 : '',
        nc: n ? (n.conductores || []).join(' · ') : '', nkm: n ? n.totalMapon : '', npas: n ? n.totalPasajero : '',
        nnd: n ? n.totalNoDisp : '', np: n && n.pctNoDisp != null ? n.pctNoDisp / 100 : '',
        tkm, tnd, tp: tkm > 0 ? tnd / tkm : '',
      });
      ['dp', 'np', 'tp'].forEach(c => fila.getCell(c).numFmt = '0%');
    });
  rematar(ws, 14);
  return 'auditoria-resumen-turnos';
}

/** Día a día: para poder señalar LA jornada concreta en una reclamación. */
function detallePorDia(wb, r) {
  const ws = wb.addWorksheet('Detalle por día');
  ws.columns = [
    { header: 'Día', key: 'dia', width: 12 }, { header: 'Matrícula', key: 'mat', width: 14 },
    { header: 'Conductores (BOLT)', key: 'cond', width: 34 },
    { header: 'KM total', key: 'mapon', width: 10 }, { header: 'Con pasajero', key: 'pas', width: 13 },
    { header: 'Ida a recoger', key: 'ida', width: 13 }, { header: 'Espera', key: 'esp', width: 10 },
    { header: 'DESCANSO', key: 'des', width: 11 }, { header: 'FUERA', key: 'fue', width: 10 },
    { header: 'h DESCANSO', key: 'hdes', width: 12 }, { header: 'h app cerrada', key: 'hfue', width: 13 },
    { header: 'Facturado BOLT', key: 'bolt', width: 14 },
  ];
  r.km.forEach(k => r.dias.forEach(d => {
    const x = k.dias[d]; if (!x) return;
    ws.addRow({
      dia: fecha(d), mat: k.matricula, cond: (x.conductores || []).join(' · '), mapon: x.mapon,
      pas: x.pasajero, ida: x.ida, esp: x.espera, des: x.descanso, fue: x.fuera,
      hdes: x.hDescanso, hfue: x.hFuera, bolt: x.bolt,
    });
  }));
  rematar(ws, 12);
  return 'auditoria-detalle-por-dia';
}

function repostajes(wb, r) {
  const ws = wb.addWorksheet('Repostajes y caídas');
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 8 },
    { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Evento', key: 'tipo', width: 12 },
    { header: 'Litros', key: 'litros', width: 9 }, { header: 'Nivel antes', key: 'antes', width: 11 },
    { header: 'Lugar', key: 'lugar', width: 45 }, { header: 'Fuente', key: 'fuente', width: 8 },
  ];
  r.eventos.forEach(e => ws.addRow({
    fecha: fecha(e.dia), hora: e.hora, mat: e.matricula,
    tipo: e.tipo === 'repostaje' ? 'Repostaje' : 'Caída', litros: e.litros,
    antes: e.nivelAntes, lugar: e.direccion || (e.lat != null ? `${e.lat}, ${e.lng}` : ''), fuente: e.fuente,
  }));
  rematar(ws, 8);
  return 'auditoria-repostajes';
}

/** Los tres bloques de ofensores en una sola hoja, uno debajo de otro. */
function ofensores(wb, r) {
  const ws = wb.addWorksheet('Ofensores');
  const negritas = [];
  const bloque = (titulo, cabecera, filas) => {
    negritas.push(ws.addRow([titulo]).number);
    negritas.push(ws.addRow(cabecera).number);
    filas.forEach(f => ws.addRow(f));
    ws.addRow([]);
  };
  bloque('TOP 5 — más KM sin estar disponible (descanso + app cerrada)',
    ['Matrícula', 'KM no disponible', '% del total', 'de ellos DESCANSO', 'de ellos app cerrada', 'KM total'],
    r.ofensores.fuera.map(o => [o.matricula, o.noDisp, o.pct == null ? '' : o.pct + '%', o.descanso, o.fuera, o.mapon]));
  bloque('TOP 5 — más HORAS marcado "ocupado" (descanso)',
    ['Matrícula', 'Horas en descanso', 'KM rodados en descanso'],
    r.ofensores.descanso.map(o => [o.matricula, o.horas, o.km]));
  bloque('TOP 5 — más repostan', ['Matrícula', 'Litros', 'Repostajes'],
    r.ofensores.repostaje.map(o => [o.matricula, o.litros, o.veces]));
  ws.getColumn(1).width = 18;
  negritas.forEach(n => ws.getRow(n).font = { bold: true });
  return 'auditoria-ofensores';
}

/**
 * LA TABLA QUE SE PIDA. `tabla` es uno de los cinco tramos
 * (dia|noche|manana|tarde|completo) o `resumen-turnos`, `detalle-dia`,
 * `repostajes`, `ofensores`. Cualquier otra cosa es un error del que llama, no
 * una hoja vacía: devolver un Excel en blanco haría pensar que no hubo datos.
 */
async function generar(r, tabla = 'dia') {
  const wb = libro();
  const t = String(tabla);
  let nombre;
  if (NOMBRE_TRAMO[t]) nombre = detalleDeTramo(wb, r, t);
  else if (t === 'resumen-turnos') nombre = resumenDeTurnos(wb, r);
  else if (t === 'detalle-dia') nombre = detallePorDia(wb, r);
  else if (t === 'repostajes') nombre = repostajes(wb, r);
  else if (t === 'ofensores') nombre = ofensores(wb, r);
  else throw new Error(`Tabla desconocida: ${t}`);

  return {
    bytes: await bytes(wb),
    nombre: `${nombre}-${diaES(r.desde)}-a-${diaES(r.hasta)}.xlsx`,
  };
}

module.exports = { generar, diaES, fecha };
