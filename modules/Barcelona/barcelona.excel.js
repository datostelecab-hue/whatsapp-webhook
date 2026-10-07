// ============================================================
// EXCEL DEL REPORTE DE HORAS DE BARCELONA
// ============================================================
// Tres pestañas, con la cabecera de la casa:
//
//   · Por día        una fila por día y plaza (matrícula + turno) con conductor:
//                    sus horas en SU turno, viaje y espera, y si salió. El color
//                    de las horas es el del reporte de Madrid (verde ≥ 7,6,
//                    amarillo 6,4–7,5, rojo menos); «No salió» en rojo.
//   · Por conductor  los días que le tocaba, los que salió y los que no, y sus
//                    horas. Primero quien más días no salió.
//   · Sin plaza      quien trabajó un día sin tener plaza en el planificador.
//
// Los datos los arma barcelona.horas.js (informe); aquí solo se pinta.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());
const esFecha = iso => iso.split('-').reverse().join('/');
const TURNO = { dia: 'Día', noche: 'Noche' };

// Los colores de las horas: los del reporte de Madrid (reporteHoras.service.js).
const BANDA = { verde: 'FF63BE7B', amarillo: 'FFFFEB84', rojo: 'FFF8696B' };
const ESTADO = {
  salio: { texto: 'Salió', bg: 'FFD1FAE5', fg: 'FF065F46' },
  en_curso: { texto: 'Salió · en curso', bg: 'FFDBEAFE', fg: 'FF1E40AF' },
  todavia: { texto: 'Aún no ha salido', bg: 'FFFEF3C7', fg: 'FF92400E' },
  pendiente: { texto: 'Por empezar', bg: 'FFF3F4F6', fg: 'FF6B7280' },
  no_salio: { texto: 'No salió', bg: 'FFFEE2E2', fg: 'FF991B1B' },
};

/** Una tabla: cabecera, filas y filtro. `pintar(fila, r)` rellena cada fila. */
function tabla(ws, idLogo, { titulo, subtitulo, leyenda, cols, filas, pintar, vacio }) {
  ws.columns = cols.map(c => ({ width: c.ancho }));
  let f = E.bandaCabecera(ws, idLogo, titulo, subtitulo, cols.length);
  if (leyenda) {
    ws.mergeCells(3, 1, 3, cols.length);
    const ley = ws.getCell(3, 1);
    ley.value = leyenda;
    ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
    ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(3).height = 26;
  }
  const filaCab = f;
  f = E.cabeceraTabla(ws, f, cols.map(c => c.titulo));
  ws.views = [{ state: 'frozen', ySplit: filaCab }];
  filas.forEach(x => {
    const r = ws.getRow(f++);
    const celda = (n, valor, { num, tono, bg, negrita, al } = {}) => {
      const c = r.getCell(n);
      c.value = valor;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: al || (cols[n - 1].izq ? 'left' : 'center'), wrapText: !!cols[n - 1].ajustar };
      c.font = { size: 10, bold: !!negrita, color: { argb: E.TEXTO } };
      if (num) c.numFmt = '0.0';
      if (bg) c.fill = E.relleno(bg);
      if (tono) { c.fill = E.relleno(tono.bg); c.font = { size: 10, bold: true, color: { argb: tono.fg } }; }
    };
    pintar(x, celda);
    r.height = 18;
  });
  if (!filas.length) {
    ws.getRow(f).getCell(1).value = vacio;
    ws.getRow(f).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
}

/**
 * @param {Object} datos  lo que devuelve barcelona.service.reporte()
 * @returns {Promise<Buffer>}
 */
async function generar(datos) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  const periodo = datos.desde === datos.hasta ? `el ${esFecha(datos.desde)}` : `del ${esFecha(datos.desde)} al ${esFecha(datos.hasta)}`;
  const r = datos.resumen;
  const parcial = r.abierto ? ' · PARCIAL: la noche del último día cuenta hasta las 12:00 del día siguiente' : '';

  tabla(wb.addWorksheet('Por día'), logo, {
    titulo: 'Horas · Barcelona',
    subtitulo: `${periodo[0].toUpperCase() + periodo.slice(1)} · ${r.plazas} plazas con conductor · ${r.salieron} salieron · ` +
      `${r.noSalieron} no salieron · ${String(r.horas).replace('.', ',')} h · generado el ${sello()}${parcial}`,
    leyenda: 'Horas efectivas (viaje + espera; el descanso no cuenta) en SU turno: el de día de 00:00 a 24:00 y el de noche de 12:00 ' +
      'a 12:00 del día siguiente, como en Madrid · No salió = tenía plaza y no hizo ni un minuto en su turno (Barcelona no tiene libranzas) · ' +
      'verde ≥ 7,6 h, amarillo de 6,4 a 7,5, rojo menos',
    cols: [
      { titulo: 'Fecha', ancho: 12 }, { titulo: 'Turno', ancho: 8 }, { titulo: 'Matrícula', ancho: 12 },
      { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
      { titulo: 'Horas', ancho: 9 }, { titulo: 'Viaje', ancho: 8 }, { titulo: 'Espera', ancho: 8 },
      { titulo: 'Estado', ancho: 17 }, { titulo: 'Coche en BOLT', ancho: 16 },
      { titulo: 'Observaciones', ancho: 52, izq: true, ajustar: true },
    ],
    filas: datos.filas,
    vacio: 'Nadie tenía plaza en esas fechas: el planificador de Barcelona está vacío.',
    pintar: (x, celda) => {
      const est = ESTADO[x.estado] || ESTADO.pendiente;
      celda(1, esFecha(x.fecha));
      celda(2, TURNO[x.turno]);
      celda(3, x.matricula, { negrita: true });
      celda(4, x.nombre);
      celda(5, x.telefono);
      const cuenta = x.estado !== 'pendiente' && x.estado !== 'todavia';
      celda(6, cuenta ? x.horas : null, { num: true, negrita: true, bg: x.banda ? BANDA[x.banda] : null });
      celda(7, cuenta ? x.viaje : null, { num: true });
      celda(8, cuenta ? x.espera : null, { num: true });
      celda(9, est.texto, { tono: est });
      celda(10, x.coches.join(', '));
      celda(11, x.obs);
    },
  });

  tabla(wb.addWorksheet('Por conductor'), logo, {
    titulo: 'Horas · Barcelona · por conductor',
    subtitulo: `${periodo[0].toUpperCase() + periodo.slice(1)} · ${datos.porConductor.length} conductores con plaza · primero quien más días no salió · generado el ${sello()}`,
    cols: [
      { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
      { titulo: 'Le tocaba', ancho: 11 }, { titulo: 'Salió', ancho: 9 }, { titulo: 'No salió', ancho: 10 },
      { titulo: 'Horas en su turno', ancho: 17 }, { titulo: 'Media al salir', ancho: 14 }, { titulo: 'Fuera de su turno', ancho: 17 },
    ],
    filas: datos.porConductor,
    vacio: 'Nadie tenía plaza en esas fechas.',
    pintar: (x, celda) => {
      celda(1, x.nombre);
      celda(2, x.telefono);
      celda(3, x.plazas);
      celda(4, x.salio);
      celda(5, x.noSalio, { tono: x.noSalio ? ESTADO.no_salio : null });
      celda(6, x.horas, { num: true, negrita: true });
      celda(7, x.media, { num: true });
      celda(8, x.fuera || null, { num: true });
    },
  });

  tabla(wb.addWorksheet('Sin plaza'), logo, {
    titulo: 'Horas · Barcelona · sin plaza',
    subtitulo: `${periodo[0].toUpperCase() + periodo.slice(1)} · ${r.personasSinPlan} conductores trabajaron sin plaza en el planificador · ` +
      `${String(r.horasSinPlan).replace('.', ',')} h · generado el ${sello()}`,
    leyenda: 'Quien trabajó un día sin tener plaza ninguna ese día. Su turno sale de la hora a la que empezó: antes de las 12:00, día; desde las 12:00, noche (como los NN de Madrid).',
    cols: [
      { titulo: 'Fecha', ancho: 12 }, { titulo: 'Turno', ancho: 8 },
      { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
      { titulo: 'Horas', ancho: 9 }, { titulo: 'Viaje', ancho: 8 }, { titulo: 'Espera', ancho: 8 },
      { titulo: 'Coche en BOLT', ancho: 18 },
    ],
    filas: datos.sinPlan,
    vacio: 'Nadie trabajó sin plaza en esas fechas.',
    pintar: (x, celda) => {
      celda(1, esFecha(x.fecha));
      celda(2, TURNO[x.turno]);
      celda(3, x.nombre);
      celda(4, x.telefono);
      celda(5, x.horas, { num: true, negrita: true });
      celda(6, x.viaje, { num: true });
      celda(7, x.espera, { num: true });
      celda(8, x.coches.join(', '));
    },
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
