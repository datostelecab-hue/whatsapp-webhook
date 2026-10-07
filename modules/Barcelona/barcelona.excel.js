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
// El turno asignado en el planificador (y su matrícula). Si cambió en el
// periodo, los dos: «Día / Noche», «1234ABC, 5678DEF».
const turnoAsignado = ps => (ps && ps.length ? [...new Set(ps.map(p => TURNO[p.turno]))].join(' / ') : 'Sin plaza');
const matriculaAsignada = ps => (ps && ps.length ? [...new Set(ps.map(p => p.matricula))].join(', ') : '');

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
      { titulo: 'Turno', ancho: 12 }, { titulo: 'Matrícula', ancho: 14 },
      { titulo: 'Le tocaba', ancho: 11 }, { titulo: 'Salió', ancho: 9 }, { titulo: 'No salió', ancho: 10 },
      { titulo: 'Horas en su turno', ancho: 17 }, { titulo: 'Media al salir', ancho: 14 }, { titulo: 'Fuera de su turno', ancho: 17 },
    ],
    filas: datos.porConductor,
    vacio: 'Nadie tenía plaza en esas fechas.',
    pintar: (x, celda) => {
      celda(1, x.nombre);
      celda(2, x.telefono);
      celda(3, turnoAsignado(x.asignadas));
      celda(4, matriculaAsignada(x.asignadas), { negrita: true });
      celda(5, x.plazas);
      celda(6, x.salio);
      celda(7, x.noSalio, { tono: x.noSalio ? ESTADO.no_salio : null });
      celda(8, x.horas, { num: true, negrita: true });
      celda(9, x.media, { num: true });
      celda(10, x.fuera || null, { num: true });
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

// ── LA SEMANA ────────────────────────────────────────────────────────────────
// Una fila por conductor y de lunes a domingo sus horas efectivas en BOLT (su
// turno de día más su turno de noche). Cada día con algo que contar lleva su
// NOTA (el globo de Excel): cuánto fue de día y cuánto de noche, en qué plaza
// estaba, o que tenía plaza y no salió. De menor a mayor.
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const h1t = n => String(Math.round(n * 10) / 10).replace('.', ',');
const TONO_SEMANA = {
  rojo: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  futuro: { bg: 'FFF3F4F6', fg: 'FF9CA3AF' },
  curso: { bg: 'FFEFF6FF', fg: 'FF1E40AF' },
  nada: { bg: null, fg: 'FFB0B5BD' },
};

/** Lo que se escribe en la celda de un día, su color y su nota. */
function celdaSemana(x) {
  const plaza = x.plazas.length ? x.plazas.map(p => `${p.matricula} (${TURNO[p.turno].toLowerCase()})`).join(', ') : '';
  if (x.estado === 'futuro') return { valor: '', tono: TONO_SEMANA.futuro };
  const partes = [];
  if (x.dia && x.noche) partes.push(`Día ${h1t(x.dia)} h · Noche ${h1t(x.noche)} h`);
  else if (x.noche) partes.push(`De noche: ${h1t(x.noche)} h`);
  if (plaza) partes.push(`Plaza: ${plaza}`);
  else if (x.horas) partes.push('Sin plaza en el planificador');
  if (x.estado === 'abierto') partes.push('El día aún no ha terminado: su noche cuenta hasta las 12:00 del día siguiente.');
  if (x.noSalio) return { valor: 0, num: true, tono: TONO_SEMANA.rojo, nota: `Tenía plaza (${plaza}) y no salió.` };
  if (!x.horas) return { valor: x.estado === 'abierto' ? '' : '—', tono: x.estado === 'abierto' ? TONO_SEMANA.curso : TONO_SEMANA.nada, nota: partes.join('\n') || null };
  return { valor: x.horas, num: true, tono: x.estado === 'abierto' ? TONO_SEMANA.curso : null, nota: partes.join('\n') || null };
}

/**
 * @param {Object} datos  lo que devuelve barcelona.service.reporteSemanal()
 * @returns {Promise<Buffer>}
 */
async function generarSemana(datos) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  const ws = wb.addWorksheet('Semana');
  const r = datos.resumen;
  const cols = [
    { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
    { titulo: 'Turno', ancho: 12 }, { titulo: 'Matrícula', ancho: 14 },
    ...datos.fechas.map((f, i) => ({ titulo: `${DIAS_CORTOS[i]} ${f.slice(8, 10)}/${f.slice(5, 7)}`, ancho: 10 })),
    { titulo: 'Total', ancho: 9 }, { titulo: 'Días', ancho: 7 }, { titulo: 'Media', ancho: 8 },
  ];
  ws.columns = cols.map(c => ({ width: c.ancho }));
  let fila = E.bandaCabecera(ws, logo, `Horas semanales · Barcelona${r.cerrada ? '' : ' · EN CURSO'}`,
    `Del lunes ${esFecha(datos.lunes)} al domingo ${esFecha(datos.domingo)} · ${r.conductores} conductores · ${h1t(r.horas)} h · ` +
    `${r.noSalio ? r.noSalio + ' día(s) con plaza sin salir · ' : ''}de menor a mayor · generado el ${sello()}` +
    (r.cerrada ? '' : ' · LA SEMANA NO HA TERMINADO: los días en azul aún suman y los grises están por venir'), cols.length);
  ws.mergeCells(3, 1, 3, cols.length);
  const ley = ws.getCell(3, 1);
  ley.value = 'Horas efectivas en BOLT (viaje + espera; el descanso no cuenta) de cada día: su turno de día (00:00 a 24:00) más su turno ' +
    'de noche (12:00 a 12:00 del día siguiente), como el reporte diario · 0 en rojo = tenía plaza y no salió · — = ese día no trabajó ' +
    '· pasa el ratón por un día para ver el detalle';
  ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
  ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(3).height = 26;
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, cols.map(c => c.titulo));
  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 1 }];

  datos.filas.forEach(p => {
    const rr = ws.getRow(fila++);
    const celda = (n, valor, { num, tono, nota, negrita } = {}) => {
      const c = rr.getCell(n);
      c.value = valor;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: cols[n - 1].izq ? 'left' : 'center' };
      c.font = { size: 10, bold: !!negrita, color: { argb: E.TEXTO } };
      if (num) c.numFmt = '0.0';
      if (tono) {
        if (tono.bg) c.fill = E.relleno(tono.bg);
        c.font = { size: 10, bold: !!negrita || tono === TONO_SEMANA.rojo, color: { argb: tono.fg } };
      }
      if (nota) c.note = nota;
    };
    celda(1, p.nombre + (p.activa ? '' : ' (ya no activa en BOLT)'));
    celda(2, p.telefono);
    celda(3, turnoAsignado(p.asignadas), { tono: p.asignadas && p.asignadas.length ? null : TONO_SEMANA.nada });
    celda(4, matriculaAsignada(p.asignadas), { negrita: true });
    p.celdas.forEach((x, i) => { const d = celdaSemana(x); celda(5 + i, d.valor, d); });
    celda(12, p.total, { num: true, negrita: true });
    celda(13, p.dias);
    celda(14, p.media, { num: true });
    rr.height = 18;
  });
  if (!datos.filas.length) {
    ws.getRow(fila).getCell(1).value = 'Ningún conductor activo ni con horas esa semana.';
    ws.getRow(fila).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar, generarSemana };
