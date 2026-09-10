// ============================================================
// EXCEL DE TURNOS PARA TRÁFICO — el parte de flota del día
// ============================================================
// Quién sale hoy y los próximos días, con su coche y su teléfono, para poder
// llamar a alguien sin abrir el ordenador.
//
// ── Por qué va POR COCHE y no por conductor ─────────────────────────────────
// Antes esto era la lista de a quién llamar: una fila por conductor que sale. Y
// eso contesta media pregunta. La otra media —CUÁNTOS COCHES SE QUEDAN PARADOS Y
// POR QUÉ— no salía por ninguna parte, porque un coche sin nadie y un coche cuyo
// fijo está de baja se ven exactamente igual cuando solo listas a los que salen:
// no aparecen. Y no son el mismo problema: uno hay que cubrirlo esta mañana y el
// otro hay que reclutarlo.
//
// Ahora la unidad es el COCHE. Salen los operativos del cuadrante —71 hoy—, cada
// uno con sus dos turnos, y cada turno con quien sale o con la razón de que no
// salga. Así el papel cuadra con la flota: 71 filas por turno, siempre, y lo que
// no sale se cuenta solo.
//
// El orden lo pidió Tráfico y se lee de arriba abajo: primero lo que funciona,
// después lo que hay que resolver.
//
//   1. Sale, sin incidencias
//   2. Planificado pero de BAJA MÉDICA
//   3. Planificado pero con PERMISO
//   4. Planificado pero de VACACIONES
//   5. Planificado pero ausente (otros)
//   6. NO SALE · sin nadie planificado
//
// Y detrás, aparte y sin contar en los 71, los coches del cuadrante que NO están
// operativos: no salen porque están en el taller, reservados o de emergencia, y
// esa también es una respuesta.
//
// Sale del MISMO tablero que la Cobertura (f_cobertura sobre PostgreSQL), así que
// lo que se imprime es exactamente lo que se ve en pantalla.

const ExcelJS = require('exceljs');
const { salidasPorCoche } = require('./repo/planificador');
const est = require('./excelEstilo');

const TZ = 'Europe/Madrid';

const DIAS_SEM = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const CAB_DIA = 'FFFDF0D2';     // cabecera del turno de día (dorado suave)
const CAB_NOCHE = 'FFDCE7FA';   // cabecera del turno de noche (azul suave)

// Un tono por grupo. Es lo que se lee antes que el texto: verde sale, rojo baja,
// ámbar permiso, azul vacaciones, violeta sin nadie.
const TONO = {
  sale:        { bg: 'FFEFFBF3', banda: 'FFD1FAE5', fg: 'FF065F46' },
  baja_medica: { bg: 'FFFEF2F2', banda: 'FFFEE2E2', fg: 'FF991B1B' },
  permiso:     { bg: 'FFFFFBEB', banda: 'FFFEF3C7', fg: 'FF92400E' },
  vacaciones:  { bg: 'FFF0F7FF', banda: 'FFDBEAFE', fg: 'FF1E40AF' },
  ausente:     { bg: 'FFFFF7ED', banda: 'FFFFEDD5', fg: 'FF9A3412' },
  sin_nadie:   { bg: 'FFF6F4FF', banda: 'FFEDE9FE', fg: 'FF5B21B6' },
  no_operativo:{ bg: 'FFF7F8FA', banda: 'FFE5E7EB', fg: 'FF4B5563' },
};

const CABECERAS = ['Nº', 'Matrícula', 'Cuadrante', 'Zona', 'Plaza', 'Conductor', 'Teléfono', 'Estado / motivo'];
const ANCHOS = [5, 12, 13, 13, 7, 30, 14, 42];

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const fmtFecha = d => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
}).format(d);
const ddmm = f => { const s = f.toISOString(); return `${s.slice(8, 10)}-${s.slice(5, 7)}`; };
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

/** Teléfono legible: 600 111 222. */
const fmtTel = t => {
  const d = String(t || '').replace(/\D/g, '').slice(-9);
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : (t || '');
};

/** Una banda de separación dentro de la tabla: el título de un grupo. */
function banda(ws, fila, texto, tono) {
  const ultima = est.colLetra(CABECERAS.length);
  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const c = ws.getCell(`A${fila}`);
  c.value = texto;
  c.font = { size: 10, bold: true, color: { argb: tono.fg } };
  c.fill = est.relleno(tono.banda);
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  c.border = est.TODOS_BORDES;
  ws.getRow(fila).height = 18;
  return fila + 1;
}

/** Una fila de coche. `n` es el número dentro del turno (o null en el anexo). */
function filaCoche(ws, fila, c, n, tono) {
  const obs = [c.motivo, c.todoTurno ? 'TodoTurno' : '', (c.otros || []).join(' · ')]
    .filter(Boolean).join(' — ');
  const val = [
    n == null ? '' : n,
    c.matricula,
    c.cuadrante || '',
    c.zona || '',
    c.plaza || '—',
    c.conductor || '—',
    fmtTel(c.telefono),
    obs,
  ];
  const r = ws.getRow(fila);
  val.forEach((v, i) => {
    const cel = r.getCell(i + 1);
    cel.value = v;
    cel.border = est.TODOS_BORDES;
    cel.alignment = {
      vertical: 'middle',
      horizontal: (i === 5 || i === 7) ? 'left' : 'center',
      indent: (i === 5 || i === 7) ? 1 : 0,
      wrapText: i === 7,
    };
    cel.font = { size: 10, color: { argb: i === 7 ? tono.fg : est.TEXTO }, bold: i === 1 };
    cel.fill = est.relleno(tono.bg);
  });
  r.height = 18;
  return fila + 1;
}

/**
 * Un turno entero: cabecera con el recuento, la tabla por grupos y el anexo de
 * coches no operativos.
 */
function bloqueTurno(ws, fila, turno, grupos) {
  const esNoche = turno.codigo === 'noche';
  const ultima = est.colLetra(CABECERAS.length);
  const operativos = turno.coches.filter(c => c.operativo);
  const paran = operativos.length - turno.salen;

  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const tt = ws.getCell(`A${fila}`);
  tt.value = `${esNoche ? '🌙' : '☀️'}  TURNO DE ${turno.etiqueta.toUpperCase()}` +
    `   ·   ${operativos.length} coches operativos   ·   SALEN ${turno.salen}` +
    `   ·   se quedan parados ${paran}`;
  tt.font = { size: 11, bold: true, color: { argb: est.CAB_BG } };
  tt.fill = est.relleno(esNoche ? CAB_NOCHE : CAB_DIA);
  tt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  tt.border = est.TODOS_BORDES;
  ws.getRow(fila).height = 22;
  fila++;

  // El desglose en una línea: es el número que se canta en la reunión.
  const detalle = grupos
    .filter(g => g.codigo !== 'sale' && turno.resumen[g.codigo])
    .map(g => `${turno.resumen[g.codigo]} ${g.etiqueta.replace(/^Planificado pero (de |con )?/, '').replace(/^NO SALE · /, '')}`)
    .join('   ·   ');
  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const sub = ws.getCell(`A${fila}`);
  sub.value = detalle || 'Salen todos: ni un coche parado en este turno.';
  sub.font = { size: 10, color: { argb: est.TENUE } };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(fila).height = 16;
  fila++;

  fila = est.cabeceraTabla(ws, fila, CABECERAS);

  let n = 0, ultimoGrupo = null;
  operativos.forEach(c => {
    if (c.grupo !== ultimoGrupo) {
      ultimoGrupo = c.grupo;
      const g = grupos.find(x => x.codigo === c.grupo) || { etiqueta: c.grupo };
      const cuantos = turno.resumen[c.grupo];
      fila = banda(ws, fila, `${g.etiqueta}   ·   ${cuantos} coche(s)`, TONO[c.grupo] || TONO.sin_nadie);
    }
    fila = filaCoche(ws, fila, c, ++n, TONO[c.grupo] || TONO.sin_nadie);
  });

  if (!operativos.length) {
    ws.mergeCells(`A${fila}:${ultima}${fila}`);
    const v = ws.getCell(`A${fila}`);
    v.value = 'Ningún coche operativo en el cuadrante.';
    v.font = { size: 10, italic: true, color: { argb: 'FF9AA1AC' } };
    v.alignment = { vertical: 'middle', horizontal: 'center' };
    v.border = est.TODOS_BORDES;
    fila++;
  }

  return fila + 1;   // una fila de aire entre bloques
}

/**
 * El anexo del día: los coches del cuadrante que NO están operativos.
 *
 * No cuentan en los 71 —no salen porque el coche no está para salir— pero decir
 * por qué no salen es media respuesta, y si no se listan aquí no se listan en
 * ninguna parte. Va una vez por día y no por turno: el taller no entiende de
 * turnos, y repetir las mismas 24 matrículas dos veces es ruido.
 */
function anexoFuera(ws, fila, coches, operativos) {
  if (!coches.length) return fila;
  fila = banda(ws, fila,
    `FUERA DEL CUADRANTE   ·   ${coches.length} coche(s) con plaza pero no operativos ` +
    `(no cuentan en los ${operativos} de cada turno)`,
    TONO.no_operativo);
  coches
    .slice()
    .sort((a, b) => a.estadoCoche.localeCompare(b.estadoCoche, 'es') || a.matricula.localeCompare(b.matricula))
    .forEach(c => { fila = filaCoche(ws, fila, { ...c, motivo: c.estadoCoche }, null, TONO.no_operativo); });
  return fila + 1;
}

/**
 * @param {Object} opciones
 *   dias  nº de días futuros además del de partida (por defecto 2)
 *   desde día de partida 'YYYY-MM-DD' (por defecto hoy en Madrid)
 * @returns {Promise<{buffer: Buffer, nombre: string}>}
 */
async function generarExcelTurnos({ dias = 2, desde } = {}) {
  const dia0 = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : hoyMadrid();

  // Se parte del mediodía UTC del día de Madrid: así sumar 24 h nunca cae en el
  // día equivocado cuando toca el cambio de hora.
  const base = new Date(dia0 + 'T12:00:00Z');
  const idxHoy = (base.getUTCDay() + 6) % 7;
  const objetivos = [];
  for (let n = 0; n <= dias; n++) {
    const f = new Date(base.getTime() + n * 86400000);
    objetivos.push({ n, fecha: f, iso: f.toISOString().slice(0, 10), idxDia: (idxHoy + n) % 7 });
  }

  // Una consulta por día. Sin red a propósito: si el planificador no responde, la
  // ruta contesta 500. Antes el error se tragaba y la hoja decía "Nadie asignado
  // a este turno" como si fuera verdad, y con eso se iba alguien a casa el viernes.
  const salidas = new Map();
  for (const o of objetivos) salidas.set(o.iso, await salidasPorCoche(o.iso));
  const esHoy = dia0 === hoyMadrid();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tibus Luxury';
  wb.created = new Date();
  const idLogo = est.registrarLogo(wb);

  objetivos.forEach(({ n, fecha, idxDia, iso }) => {
    const r = salidas.get(iso) || { turnos: [], grupos: [], totales: {} };
    const nombreDia = DIAS_SEM[idxDia];
    const dd = ddmm(fecha);   // con guion: Excel no admite "/" en el nombre de una pestaña

    const ws = wb.addWorksheet(`${nombreDia} ${dd}`.slice(0, 31), {
      pageSetup: {
        orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
    });
    ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const etiqueta = (esHoy && ['HOY', 'MAÑANA', 'PASADO MAÑANA'][n]) || nombreDia.toUpperCase();
    const op = r.totales.operativos || 0;
    let fila = est.bandaCabecera(ws, idLogo,
      `${etiqueta} · ${fmtFecha(fecha)}`,
      `${op} coches operativos en el cuadrante, los dos turnos · quien sale y, si no sale, por qué · ` +
      `del planificador · generado el ${sello()}`,
      CABECERAS.length);

    (r.turnos || []).forEach(t => { fila = bloqueTurno(ws, fila, t, r.grupos || []); });

    // Los coches no operativos, una sola vez: se cogen del primer turno porque el
    // estado del coche es el mismo a las 6 de la mañana que a las 6 de la tarde.
    const fuera = ((r.turnos || [])[0] || { coches: [] }).coches.filter(c => !c.operativo);
    fila = anexoFuera(ws, fila, fuera, op);

    ws.views = [{ state: 'frozen', ySplit: 3 }];
  });

  const nombre = `Turnos_Tibus_${dia0}`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre };
}

module.exports = { generarExcelTurnos };
