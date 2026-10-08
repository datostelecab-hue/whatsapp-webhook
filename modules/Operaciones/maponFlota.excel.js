// ============================================================
// EXCEL DE LA FLOTA DE MAPON — qué sabe hacer cada unidad
// ============================================================
// Tres pestañas, con la cabecera de la casa:
//
//   · Flota     una fila por unidad de Mapon, con un ✓ verde o una ✗ roja por
//               función (y «?» si no se pudo saber), Madrid primero.
//   · Resumen   cuántas tienen cada función, por sede.
//   · Leyenda   de dónde sale cada columna, para que el ✓ no se discuta.
//
// Los datos los arma maponFlota.service (inventario); aquí solo se pinta.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const TZ = 'Europe/Madrid';
const fecha = ms => (ms == null ? '' : new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(ms)));

const SI = { texto: '✓', bg: 'FFD1FAE5', fg: 'FF047857' };
const NO = { texto: '✗', bg: 'FFFEE2E2', fg: 'FFB91C1C' };
const NOSE = { texto: '?', bg: 'FFF3F4F6', fg: 'FF6B7280' };
const marca = v => (v === true ? SI : v === false ? NO : NOSE);

// Las columnas de funciones, en el orden en que se leen, con lo que significan.
const FUNCIONES = [
  { campo: 'enviaDatos', titulo: 'Envía datos (24 h)', explica: 'La unidad ha mandado algo a Mapon en las últimas 24 horas.' },
  { campo: 'gpsSenal', titulo: 'GPS con señal', explica: 'Su último estado no es «sin GPS» ni «sin datos» y tiene posición. Un coche en un parking subterráneo puede salir sin señal un rato.' },
  { campo: 'gpsBueno', titulo: 'GPS bueno', explica: 'Las dos anteriores a la vez: envía datos y con posición.' },
  { campo: 'can', titulo: 'CAN', explica: 'Lee el bus CAN del coche: da el odómetro del cuadro (can.odom). Sin CAN, los km solo salen del GPS.' },
  { campo: 'combustible', titulo: 'Combustible', explica: 'Da el nivel de combustible, por sensor o por el CAN.' },
  { campo: 'contacto', titulo: 'Contacto', explica: 'Dice si el contacto está puesto (ignición). Lo necesita el corte de motor para no cortar con el coche en marcha.' },
  { campo: 'corteMotor', titulo: 'Corte de motor', explica: 'Tiene un relé configurado como «Bloqueo Motor» (engine_block) y ACTIVADO. Tener relés no basta, y un corte configurado pero desactivado en Mapon tampoco: no cortaría (sale en Observaciones).' },
  { campo: 'abrirPuertas', titulo: 'Abrir puertas', explica: 'Su catálogo de órdenes en Mapon admite abrir las puertas (open_doors).' },
  { campo: 'cerrarPuertas', titulo: 'Cerrar puertas', explica: 'Su catálogo de órdenes en Mapon admite cerrar las puertas (close_doors).' },
  { campo: 'puertasProbadas', titulo: 'Puertas probadas', explica: 'El bot de WhatsApp ha abierto o cerrado ese coche alguna vez y Mapon dijo que sí. Es la prueba de que la orden llega: estar en el catálogo no lo garantiza.' },
  { campo: 'maletero', titulo: 'Maletero', explica: 'Admite abrir el maletero (open_trunk).' },
  { campo: 'warnings', titulo: 'Warnings', explica: 'Admite encender las luces de emergencia (hazard_lights).' },
  { campo: 'ventanillas', titulo: 'Ventanillas', explica: 'Admite abrir o cerrar las ventanillas. Probado en agosto: Mapon dice que sí, pero no llegan al coche.' },
  { campo: 'bateriaHibrida', titulo: 'Batería híbrida', explica: 'Manda el nivel de la batería del híbrido o eléctrico (can_ev_battery_rel), con su % en la columna de al lado.' },
  { campo: 'camara', titulo: 'Cámara', explica: 'Hay un equipo de vídeo (cámara, DVR, ADAS…) registrado en Mapon para esa unidad, según su lista de dispositivos. El 08/10/2026 la cuenta no tenía ninguno: solo localizadores.' },
];

function cabecera(ws, logo, titulo, subtitulo, leyenda, cols) {
  ws.columns = cols.map(c => ({ width: c.ancho }));
  const f = E.bandaCabecera(ws, logo, titulo, subtitulo, cols.length);
  if (leyenda) {
    ws.mergeCells(3, 1, 3, cols.length);
    const c = ws.getCell(3, 1);
    c.value = leyenda;
    c.font = { size: 9, italic: true, color: { argb: E.TENUE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(3).height = 30;
  }
  return f;
}

function celdaDe(r, cols) {
  return (n, valor, { tono, al, num, negrita } = {}) => {
    const c = r.getCell(n);
    c.value = valor;
    c.border = E.TODOS_BORDES;
    c.alignment = { vertical: 'middle', horizontal: al || (cols[n - 1].izq ? 'left' : 'center'), wrapText: !!cols[n - 1].ajustar };
    c.font = { size: 10, bold: !!negrita, color: { argb: E.TEXTO } };
    if (num) c.numFmt = num;
    if (tono) { c.fill = E.relleno(tono.bg); c.font = { size: 11, bold: true, color: { argb: tono.fg } }; }
  };
}

/**
 * @param {Object} datos  lo que devuelve maponFlota.service.inventario()
 * @returns {Promise<Buffer>}
 */
async function generar(datos) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  const filas = datos.filas;
  const n = s => filas.filter(f => f.sede === s).length;

  // ── Flota ──────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Flota');
  const cols = [
    { titulo: 'Matrícula', ancho: 12, negrita: true }, { titulo: 'Sede', ancho: 11 },
    { titulo: 'Vehículo', ancho: 22, izq: true }, { titulo: 'Unidad Mapon', ancho: 12 },
    { titulo: 'Equipo', ancho: 20, izq: true }, { titulo: 'Equipo en uso', ancho: 10 },
    { titulo: 'Estado en Telecab', ancho: 14 }, { titulo: 'Último dato', ancho: 16 }, { titulo: 'Estado en Mapon', ancho: 14 },
    ...FUNCIONES.slice(0, 4).map(c => ({ titulo: c.titulo, ancho: 10, f: c.campo })),
    { titulo: 'Km del cuadro', ancho: 12 },
    ...FUNCIONES.slice(4, 10).map(c => ({ titulo: c.titulo, ancho: 10, f: c.campo })),
    { titulo: 'Última vez que el bot abrió o cerró', ancho: 16 },
    ...FUNCIONES.slice(10, 13).map(c => ({ titulo: c.titulo, ancho: 10, f: c.campo })),
    { titulo: FUNCIONES[13].titulo, ancho: 10, f: FUNCIONES[13].campo }, { titulo: 'Batería %', ancho: 9 },
    { titulo: FUNCIONES[14].titulo, ancho: 10, f: FUNCIONES[14].campo },
    { titulo: 'Otros comandos', ancho: 26, izq: true, ajustar: true },
    { titulo: 'Datos que da por CAN', ancho: 26, izq: true, ajustar: true },
    { titulo: 'Observaciones', ancho: 48, izq: true, ajustar: true },
  ];
  const conGps = filas.filter(f => f.gpsBueno).length, conCan = filas.filter(f => f.can).length;
  const conPuertas = filas.filter(f => f.abrirPuertas && f.cerrarPuertas).length;
  let fila = cabecera(ws, logo, 'Flota en Mapon · qué sabe hacer cada unidad',
    `${filas.length} unidades (Madrid ${n('Madrid')}, Barcelona ${n('Barcelona')}, sin enlazar ${n('Sin enlazar')}) · ` +
    `${conGps} con GPS bueno · ${conCan} con CAN · ${conPuertas} abren y cierran puertas · generado el ${fecha(datos.generado)}`,
    '✓ = la tiene · ✗ = no la tiene · ? = no se pudo saber (Mapon no contestó por esa unidad). Una fila por UNIDAD de Mapon: una matrícula con ' +
    'dos equipos sale dos veces y «Equipo en uso» dice cuál usa el ERP. De dónde sale cada columna, en la pestaña «Leyenda».', cols);
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, cols.map(c => c.titulo));
  ws.getRow(filaCab).height = 32;
  ws.getRow(filaCab).eachCell(c => { c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 1 }];

  filas.forEach(x => {
    const r = ws.getRow(fila++);
    const celda = celdaDe(r, cols);
    cols.forEach((c, i) => {
      const k = i + 1;
      if (c.f) return celda(k, marca(x[c.f]).texto, { tono: marca(x[c.f]) });
      switch (c.titulo) {
        case 'Matrícula': return celda(k, x.matricula, { negrita: true });
        case 'Sede': return celda(k, x.sede);
        case 'Vehículo': return celda(k, x.vehiculo);
        case 'Unidad Mapon': return celda(k, Number(x.unitId) || x.unitId);
        case 'Equipo': return celda(k, x.equipo);
        case 'Equipo en uso': return celda(k, marca(x.enUso).texto, { tono: marca(x.enUso) });
        case 'Estado en Telecab': return celda(k, x.estadoTelecab);
        case 'Último dato': return celda(k, x.ultimoDato ? fecha(x.ultimoDato) : 'Nunca');
        case 'Estado en Mapon': return celda(k, x.estado);
        case 'Km del cuadro': return celda(k, x.kmCan, { num: '#,##0' });
        case 'Batería %': return celda(k, x.bateriaPct);
        case 'Última vez que el bot abrió o cerró': return celda(k, x.ultimaPuertaOk ? fecha(x.ultimaPuertaOk) : '');
        case 'Otros comandos': return celda(k, x.otrosComandos);
        case 'Datos que da por CAN': return celda(k, x.datosCan);
        case 'Observaciones': return celda(k, x.observaciones);
        default: return celda(k, '');
      }
    });
    r.height = x.observaciones.length > 60 || x.otrosComandos.length > 30 ? 30 : 18;
  });
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };

  // ── Resumen ────────────────────────────────────────────────────────────
  const wr = wb.addWorksheet('Resumen');
  const sedes = ['Madrid', 'Barcelona', 'Sin enlazar'];
  const colsR = [{ titulo: 'Función', ancho: 26, izq: true }, ...sedes.map(s => ({ titulo: s, ancho: 16 })), { titulo: 'Total', ancho: 16 }];
  let fr = cabecera(wr, logo, 'Flota en Mapon · resumen', `Unidades que tienen cada función, de las que hay en cada sede · generado el ${fecha(datos.generado)}`,
    'Cuenta todas las unidades, también los equipos sobrantes de una matrícula con dos. «?» no cuenta como que la tenga.', colsR);
  fr = E.cabeceraTabla(wr, fr, colsR.map(c => c.titulo));
  const pct = (a, b) => (b ? `${a} de ${b} (${Math.round(a * 100 / b)} %)` : '—');
  [{ titulo: 'Unidades', campo: null }, ...FUNCIONES.map(f => ({ titulo: f.titulo, campo: f.campo }))].forEach(fn => {
    const r = wr.getRow(fr++);
    const celda = celdaDe(r, colsR);
    celda(1, fn.titulo, { negrita: !fn.campo });
    [...sedes, null].forEach((s, i) => {
      const de = s ? filas.filter(f => f.sede === s) : filas;
      celda(i + 2, fn.campo ? pct(de.filter(f => f[fn.campo] === true).length, de.length) : de.length, { negrita: !fn.campo });
    });
    r.height = 18;
  });

  // ── Leyenda ────────────────────────────────────────────────────────────
  const wl = wb.addWorksheet('Leyenda');
  const colsL = [{ titulo: 'Columna', ancho: 26, izq: true }, { titulo: 'Qué quiere decir y de dónde sale', ancho: 110, izq: true, ajustar: true }];
  let fl = cabecera(wl, logo, 'Flota en Mapon · leyenda', 'De dónde sale cada columna de la pestaña «Flota»', null, colsL);
  fl = E.cabeceraTabla(wl, fl, colsL.map(c => c.titulo));
  [
    ['Equipo en uso', 'Si una matrícula tiene varios equipos en Mapon, el que usa el ERP (el que da CAN, luego el del corte de motor, luego el que tiene GPS). Los demás sobran y conviene darlos de baja en Mapon.'],
    ['Estado en Mapon', 'Circulando, Parado, Sin GPS, Sin datos o En servicio técnico: el último estado que da Mapon.'],
    ...FUNCIONES.map(f => [f.titulo, f.explica]),
    ['Equipo', 'El modelo del localizador según la lista de dispositivos de Mapon (TELTONIKA FMC880…).'],
    ['Km del cuadro', 'El odómetro del coche leído por el CAN, en km. Vacío si la unidad no lee el CAN.'],
    ['Batería %', 'El nivel de la batería del híbrido o eléctrico en su último dato.'],
    ['Última vez que el bot abrió o cerró', 'La última orden de puertas del bot de WhatsApp que salió bien para ese coche.'],
    ['Otros comandos', 'Las órdenes de su catálogo en Mapon que no son ninguna de las de arriba, tal como las nombra Mapon.'],
    ['Datos que da por CAN', 'Los datos que manda del bus CAN (odómetro, combustible, revoluciones…), tal como los nombra Mapon.'],
  ].forEach(([a, b]) => {
    const r = wl.getRow(fl++);
    const celda = celdaDe(r, colsL);
    celda(1, a, { negrita: true });
    celda(2, b);
    r.height = b.length > 110 ? 30 : 18;
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { generar, FUNCIONES };
