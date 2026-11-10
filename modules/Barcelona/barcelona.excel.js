// ============================================================
// EXCEL DEL REPORTE DE HORAS DE BARCELONA
// ============================================================
// Tres pestañas, con la cabecera de la casa:
//
//   · Por día        una fila por día y plaza (matrícula + turno) con conductor:
//                    sus horas en SU turno, viaje y espera, y si salió. El color
//                    de las horas es el del reporte de Madrid (verde ≥ 7,6,
//                    amarillo 6,4–7,5, rojo menos); «No salió» en rojo y
//                    «Libra» en gris: desde db/234 (06/11/2026) Barcelona tiene
//                    libranzas, y el día que un fijo libra no es «No salió».
//   · Por conductor  los días que le tocaba, los que salió, los que no y los que
//                    libró, y sus horas. Primero quien más días no salió.
//   · Sin plaza      quien trabajó un día sin trabajar en ninguna plaza: sin
//                    plaza en el planificador, o en su día de libranza.
//
// En las tres, la UTILIZACIÓN (viaje / viaje + espera) y los viajes que no
// cogió, separados: RECHAZADOS A DEDO (driver_rejected) y SIN CONTESTAR
// (driver_did_not_respond). Camilo, 10/11/2026: «agrega al reporte de Barcelona
// el total de utilización de la jornada del conductor y el total de viajes
// rechazados a dedo y rechazados por no contestar separados».
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
// El turno de una plaza: «Día», o «Día · CT» si es de correturnos.
const turnoDe = p => TURNO[p.turno] + (p.rol === 'ct' ? ' · CT' : '');
// El turno asignado en el planificador (y su matrícula). Si cambió en el
// periodo, los dos: «Día / Noche», «1234ABC, 5678DEF».
const turnoAsignado = ps => (ps && ps.length ? [...new Set(ps.map(turnoDe))].join(' / ') : 'Sin plaza');
const matriculaAsignada = ps => (ps && ps.length ? [...new Set(ps.map(p => p.matricula))].join(', ') : '');

// Los colores de las horas: los del reporte de Madrid (reporteHoras.service.js).
const BANDA = { verde: 'FF63BE7B', amarillo: 'FFFFEB84', rojo: 'FFF8696B' };
// Rechazar a dedo no está permitido a ninguna hora (Control Alertas): en rojo.
const ROJO = { bg: 'FFFEE2E2', fg: 'FF991B1B' };
const pc = n => (n == null ? '—' : String(n).replace('.', ',') + ' %');

const ESTADO = {
  salio: { texto: 'Salió', bg: 'FFD1FAE5', fg: 'FF065F46' },
  en_curso: { texto: 'Salió · en curso', bg: 'FFDBEAFE', fg: 'FF1E40AF' },
  todavia: { texto: 'Aún no ha salido', bg: 'FFFEF3C7', fg: 'FF92400E' },
  pendiente: { texto: 'Por empezar', bg: 'FFF3F4F6', fg: 'FF6B7280' },
  no_salio: { texto: 'No salió', bg: 'FFFEE2E2', fg: 'FF991B1B' },
  // El día que libra su plaza: no le tocaba (db/234). Gris, como en el planificador.
  libra: { texto: 'Libra', bg: 'FFF3F4F6', fg: 'FF4B5563' },
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
    const celda = (n, valor, { num, pct, tono, bg, negrita, al } = {}) => {
      const c = r.getCell(n);
      c.value = valor;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: al || (cols[n - 1].izq ? 'left' : 'center'), wrapText: !!cols[n - 1].ajustar };
      c.font = { size: 10, bold: !!negrita, color: { argb: E.TEXTO } };
      if (num) c.numFmt = '0.0';
      // La utilización va en % con un decimal: el valor es 0-100, no 0-1.
      if (pct) c.numFmt = '0.0" %"';
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
      `${r.noSalieron} no salieron · ${r.libran || 0} libran · ${String(r.horas).replace('.', ',')} h · utilización ${pc(r.utilizacion)} · ` +
      `${r.aDedo || 0} rechazados a dedo · ${r.sinContestar || 0} sin contestar · generado el ${sello()}${parcial}`,
    leyenda: 'Horas efectivas (viaje + espera; el descanso no cuenta) en SU turno: el de día de 00:00 a 24:00 y el de noche de 12:00 ' +
      'a 12:00 del día siguiente, como en Madrid · No salió = le tocaba trabajar y no hizo ni un minuto en su turno · ' +
      'Libra = era su día de libranza en el planificador (no cuenta como no salió; si trabajó, sus horas van en la otra plaza que ' +
      'trabajara ese día —se dice en las observaciones— o, si no tenía otra, en «Sin plaza») · ' +
      'el CT (la casilla del cuadrante) sale solo los días que coge la plaza de un fijo que libra, en esa matrícula · ' +
      'verde ≥ 7,6 h, amarillo de 6,4 a 7,5, rojo menos · Utilización = viaje / (viaje + espera) en su turno · ' +
      'A dedo = viajes que rechazó él; Sin contestar = se le ofrecieron y no contestó (cada uno, en el turno en que se le ofreció)',
    cols: [
      { titulo: 'Fecha', ancho: 12 }, { titulo: 'Turno', ancho: 8 }, { titulo: 'Matrícula', ancho: 12 },
      { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
      { titulo: 'Horas', ancho: 9 }, { titulo: 'Viaje', ancho: 8 }, { titulo: 'Espera', ancho: 8 },
      { titulo: 'Utilización', ancho: 12 }, { titulo: 'A dedo', ancho: 9 }, { titulo: 'Sin contestar', ancho: 13 },
      { titulo: 'Estado', ancho: 17 }, { titulo: 'Coche en BOLT', ancho: 16 },
      { titulo: 'Observaciones', ancho: 52, izq: true, ajustar: true },
    ],
    filas: datos.filas,
    vacio: 'Nadie tenía plaza en esas fechas: el planificador de Barcelona está vacío.',
    pintar: (x, celda) => {
      const est = ESTADO[x.estado] || ESTADO.pendiente;
      celda(1, esFecha(x.fecha));
      celda(2, turnoDe(x));
      celda(3, x.matricula, { negrita: true });
      celda(4, x.nombre);
      celda(5, x.telefono);
      const cuenta = x.estado !== 'pendiente' && x.estado !== 'todavia' && x.estado !== 'libra';
      celda(6, cuenta ? x.horas : null, { num: true, negrita: true, bg: x.banda ? BANDA[x.banda] : null });
      celda(7, cuenta ? x.viaje : null, { num: true });
      celda(8, cuenta ? x.espera : null, { num: true });
      celda(9, cuenta ? x.utilizacion : null, { pct: true });
      // Los rechazos se cuentan aunque el turno no cuente (libra, en curso): si
      // los hubo, se dicen.
      celda(10, cuenta ? x.aDedo || 0 : x.aDedo || null, { tono: x.aDedo ? ROJO : null });
      celda(11, cuenta ? x.sinContestar || 0 : x.sinContestar || null);
      celda(12, est.texto, { tono: est });
      celda(13, x.coches.join(', '));
      celda(14, x.obs);
    },
  });

  tabla(wb.addWorksheet('Por conductor'), logo, {
    titulo: 'Horas · Barcelona · por conductor',
    subtitulo: `${periodo[0].toUpperCase() + periodo.slice(1)} · ${datos.porConductor.length} conductores con plaza · primero quien más días no salió · generado el ${sello()}`,
    leyenda: 'Utilización = viaje / (viaje + espera) de todos sus turnos con plaza en el periodo (no la media de los días: pesa más el día que más trabajó) · ' +
      'A dedo y Sin contestar: el total del periodo en sus turnos con plaza; lo de los días sin plaza va en «Sin plaza».',
    cols: [
      { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
      { titulo: 'Turno', ancho: 12 }, { titulo: 'Matrícula', ancho: 14 },
      { titulo: 'Le tocaba', ancho: 11 }, { titulo: 'Salió', ancho: 9 }, { titulo: 'No salió', ancho: 10 },
      { titulo: 'Horas en su turno', ancho: 17 }, { titulo: 'Media al salir', ancho: 14 },
      { titulo: 'Utilización', ancho: 12 }, { titulo: 'A dedo', ancho: 9 }, { titulo: 'Sin contestar', ancho: 13 },
      { titulo: 'Fuera de su turno', ancho: 17 }, { titulo: 'Libró', ancho: 9 },
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
      celda(10, x.utilizacion, { pct: true });
      celda(11, x.aDedo || 0, { tono: x.aDedo ? ROJO : null });
      celda(12, x.sinContestar || 0);
      celda(13, x.fuera || null, { num: true });
      celda(14, x.libra || null, { tono: x.libra ? ESTADO.libra : null });
    },
  });

  tabla(wb.addWorksheet('Sin plaza'), logo, {
    titulo: 'Horas · Barcelona · sin plaza',
    subtitulo: `${periodo[0].toUpperCase() + periodo.slice(1)} · ${r.personasSinPlan} conductores trabajaron sin plaza en el planificador · ` +
      `${String(r.horasSinPlan).replace('.', ',')} h · generado el ${sello()}`,
    leyenda: 'Quien trabajó un día sin trabajar en ninguna plaza: sin plaza ese día, o en su día de libranza («Libraba»). Su turno sale de la hora a la que empezó: antes de las 12:00, día; desde las 12:00, noche (como los NN de Madrid). ' +
      'Una fila con 0 h es de quien no trabajó pero tuvo viajes ofrecidos que no cogió (a dedo o sin contestar).',
    cols: [
      { titulo: 'Fecha', ancho: 12 }, { titulo: 'Turno', ancho: 8 },
      { titulo: 'Conductor', ancho: 32, izq: true }, { titulo: 'Teléfono', ancho: 15 },
      { titulo: 'Horas', ancho: 9 }, { titulo: 'Viaje', ancho: 8 }, { titulo: 'Espera', ancho: 8 },
      { titulo: 'Utilización', ancho: 12 }, { titulo: 'A dedo', ancho: 9 }, { titulo: 'Sin contestar', ancho: 13 },
      { titulo: 'Coche en BOLT', ancho: 18 }, { titulo: 'Por qué', ancho: 26, izq: true },
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
      celda(8, x.utilizacion, { pct: true });
      celda(9, x.aDedo || 0, { tono: x.aDedo ? ROJO : null });
      celda(10, x.sinContestar || 0);
      celda(11, x.coches.join(', '));
      celda(12, x.libraba && x.libraba.length ? `Libraba (${x.libraba.join(', ')})` : 'Sin plaza');
    },
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── LA SEMANA ────────────────────────────────────────────────────────────────
// Una fila por conductor y de lunes a domingo sus horas efectivas en BOLT (su
// turno de día más su turno de noche). Cada día con algo que contar lleva su
// NOTA (el globo de Excel): cuánto fue de día y cuánto de noche, en qué plaza
// estaba, que tenía plaza y no salió, o que libraba («L» en gris). De menor a
// mayor. Con su UTILIZACIÓN de la semana, y una pestaña POR COCHE: las horas de
// cada coche cada día (Camilo, 10/11/2026: «agregues la utilización semanal del
// conductor y hagas otra pestaña por coche, cuántas horas hizo cada coche en la
// semana»).
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const h1t = n => String(Math.round(n * 10) / 10).replace('.', ',');
const TONO_SEMANA = {
  rojo: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  futuro: { bg: 'FFF3F4F6', fg: 'FF9CA3AF' },
  curso: { bg: 'FFEFF6FF', fg: 'FF1E40AF' },
  nada: { bg: null, fg: 'FFB0B5BD' },
  libra: { bg: 'FFF3F4F6', fg: 'FF4B5563' },
};

/** Lo que se escribe en la celda de un día, su color y su nota. */
function celdaSemana(x) {
  const nombrar = ps => ps.map(p => `${p.matricula} (${turnoDe(p).toLowerCase()})`).join(', ');
  const plaza = x.plazas.length ? nombrar(x.plazas) : '';
  const libra = x.libra && x.libra.length ? nombrar(x.libra) : '';
  if (x.estado === 'futuro') return { valor: libra ? 'L' : '', tono: TONO_SEMANA.futuro, nota: libra ? `Libra: ${libra}` : null };
  const partes = [];
  if (x.dia && x.noche) partes.push(`Día ${h1t(x.dia)} h · Noche ${h1t(x.noche)} h`);
  else if (x.noche) partes.push(`De noche: ${h1t(x.noche)} h`);
  if (plaza) partes.push(`Plaza: ${plaza}`);
  else if (libra) partes.push(`Libraba: ${libra}${x.horas ? ' (y trabajó)' : ''}`);
  else if (x.horas) partes.push('Sin plaza en el planificador');
  if (libra && !x.horas) return { valor: 'L', tono: TONO_SEMANA.libra, nota: partes.join('\n') };
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
    { titulo: 'Utilización', ancho: 12 },
  ];
  ws.columns = cols.map(c => ({ width: c.ancho }));
  let fila = E.bandaCabecera(ws, logo, `Horas semanales · Barcelona${r.cerrada ? '' : ' · EN CURSO'}`,
    `Del lunes ${esFecha(datos.lunes)} al domingo ${esFecha(datos.domingo)} · ${r.conductores} conductores · ${h1t(r.horas)} h · ` +
    `utilización ${pc(r.utilizacion)} · ` +
    `${r.noSalio ? r.noSalio + ' día(s) con plaza sin salir · ' : ''}de menor a mayor · generado el ${sello()}` +
    (r.cerrada ? '' : ' · LA SEMANA NO HA TERMINADO: los días en azul aún suman y los grises están por venir'), cols.length);
  ws.mergeCells(3, 1, 3, cols.length);
  const ley = ws.getCell(3, 1);
  ley.value = 'Horas efectivas en BOLT (viaje + espera; el descanso no cuenta) de cada día: su turno de día (00:00 a 24:00) más su turno ' +
    'de noche (12:00 a 12:00 del día siguiente), como el reporte diario · 0 en rojo = le tocaba trabajar y no salió · L = libraba ' +
    '· — = ese día no trabajó · Utilización = viaje / (viaje + espera) de toda su semana · pasa el ratón por un día para ver el detalle';
  ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
  ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(3).height = 26;
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, cols.map(c => c.titulo));
  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 1 }];

  datos.filas.forEach(p => {
    const rr = ws.getRow(fila++);
    const celda = (n, valor, { num, pct, tono, nota, negrita } = {}) => {
      const c = rr.getCell(n);
      c.value = valor;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: cols[n - 1].izq ? 'left' : 'center' };
      c.font = { size: 10, bold: !!negrita, color: { argb: E.TEXTO } };
      if (num) c.numFmt = '0.0';
      if (pct) c.numFmt = '0.0" %"';
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
    celda(15, p.utilizacion, { pct: true });
    rr.height = 18;
  });
  if (!datos.filas.length) {
    ws.getRow(fila).getCell(1).value = 'Ningún conductor activo ni con horas esa semana.';
    ws.getRow(fila).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };

  hojaPorCoche(wb, logo, datos);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * LA PESTAÑA POR COCHE: una fila por coche, sus horas de cada día de la semana
 * (las que hicieron en él sus conductores, repartidas con la misma regla), el
 * total, la utilización y quién lo llevó. De menor a mayor: arriba, el coche que
 * menos trabajó. Un día cerrado sin horas va en rojo: el coche estuvo parado.
 */
function hojaPorCoche(wb, logo, datos) {
  const ws = wb.addWorksheet('Por coche');
  const r = datos.resumen;
  const coches = datos.porCoche || [];
  const cols = [
    { titulo: 'Matrícula', ancho: 12 }, { titulo: 'Modelo', ancho: 22, izq: true },
    ...datos.fechas.map((f, i) => ({ titulo: `${DIAS_CORTOS[i]} ${f.slice(8, 10)}/${f.slice(5, 7)}`, ancho: 10 })),
    { titulo: 'Total', ancho: 9 }, { titulo: 'Días', ancho: 7 }, { titulo: 'Media', ancho: 8 },
    { titulo: 'Utilización', ancho: 12 }, { titulo: 'Conductores (horas en el coche)', ancho: 60, izq: true },
  ];
  ws.columns = cols.map(c => ({ width: c.ancho }));
  const total = coches.reduce((s, c) => s + c.total, 0);
  let fila = E.bandaCabecera(ws, logo, `Horas semanales por coche · Barcelona${r.cerrada ? '' : ' · EN CURSO'}`,
    `Del lunes ${esFecha(datos.lunes)} al domingo ${esFecha(datos.domingo)} · ${coches.filter(c => c.total > 0).length} de ${coches.length} coches trabajaron · ` +
    `${h1t(total)} h · de menor a mayor · generado el ${sello()}`, cols.length);
  ws.mergeCells(3, 1, 3, cols.length);
  const ley = ws.getCell(3, 1);
  ley.value = 'Horas efectivas en BOLT (viaje + espera) hechas en cada coche, el día del turno en que se hicieron (día 00:00 a 24:00, ' +
    'noche 12:00 a 12:00), como la pestaña de los conductores: la suma es la misma · 0 en rojo = día cerrado sin que nadie lo moviera · ' +
    '«Sin coche» = horas en las que BOLT no dice el coche · Utilización = viaje / (viaje + espera) de la semana';
  ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
  ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(3).height = 26;
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, cols.map(c => c.titulo));
  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 1 }];

  coches.forEach(c => {
    const rr = ws.getRow(fila++);
    const celda = (n, valor, { num, pct, tono, negrita } = {}) => {
      const x = rr.getCell(n);
      x.value = valor;
      x.border = E.TODOS_BORDES;
      x.alignment = { vertical: 'middle', horizontal: cols[n - 1].izq ? 'left' : 'center', wrapText: n === cols.length };
      x.font = { size: 10, bold: !!negrita, color: { argb: E.TEXTO } };
      if (num) x.numFmt = '0.0';
      if (pct) x.numFmt = '0.0" %"';
      if (tono) {
        if (tono.bg) x.fill = E.relleno(tono.bg);
        x.font = { size: 10, bold: !!negrita || tono === TONO_SEMANA.rojo, color: { argb: tono.fg } };
      }
    };
    celda(1, c.matricula, { negrita: true });
    // El estado de BOLT, en castellano: el que no está activo se dice.
    const estadoBolt = !c.deLaSede || !c.estado || c.estado === 'active' ? ''
      : c.estado === 'deactivated' ? ' (desactivado en BOLT)' : ` (BOLT: ${c.estado})`;
    celda(2, c.modelo + estadoBolt);
    c.celdas.forEach((d, i) => {
      if (d.estado === 'futuro') return celda(3 + i, '', { tono: TONO_SEMANA.futuro });
      if (!d.horas) {
        return celda(3 + i, d.estado === 'abierto' ? '' : 0,
          { num: d.estado !== 'abierto', tono: d.estado === 'abierto' ? TONO_SEMANA.curso : TONO_SEMANA.rojo });
      }
      return celda(3 + i, d.horas, { num: true, tono: d.estado === 'abierto' ? TONO_SEMANA.curso : null });
    });
    const n = 3 + c.celdas.length;
    celda(n, c.total, { num: true, negrita: true });
    celda(n + 1, c.dias);
    celda(n + 2, c.dias ? Math.round((c.total / c.dias) * 10) / 10 : null, { num: true });
    celda(n + 3, c.utilizacion, { pct: true });
    celda(n + 4, c.conductores.map(p => `${p.nombre} (${h1t(p.horas)} h)`).join(', '));
    rr.height = 18;
  });
  if (!coches.length) {
    ws.getRow(fila).getCell(1).value = 'Ningún coche de Barcelona esa semana.';
    ws.getRow(fila).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
}

module.exports = { generar, generarSemana };
