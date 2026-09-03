// ============================================================
// EXCEL DE TURNOS PARA TRÁFICO (fin de semana)
// ============================================================
// Pensado para el viernes: quién sale ESTA NOCHE y quién sale el sábado y el domingo,
// con su coche y su teléfono, para poder llamar a alguien sin abrir el ordenador.
//
//   Hoja 1  HOY · solo turno de NOCHE
//   Hoja 2  mañana      · dos tablas: turno de día y turno de noche
//   Hoja 3  pasado      · dos tablas: turno de día y turno de noche
//
// Sale del MISMO tablero que la Cobertura (planificador), así que lo que se imprime es
// exactamente lo que se ve en pantalla. Un conductor de TodoTurno ocupa las dos plazas
// del coche, así que aparece en las dos tablas —marcado como tal— porque de verdad
// cubre los dos turnos.

const ExcelJS = require('exceljs');
const { salidasHoy } = require('./repo/planificador');   // planificador REAL (PostgreSQL, f_cobertura)
const est = require('./excelEstilo');

const TZ = 'Europe/Madrid';

// Lunes … Domingo (0=lunes, como el índice del Cuadrante) para el nombre de la pestaña.
const DIAS_SEM = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const CAB_DIA = 'FFFDF0D2';     // cabecera del turno de día (dorado suave)
const CAB_NOCHE = 'FFDCE7FA';   // cabecera del turno de noche (azul suave)

const CABECERAS = ['Nº', 'Conductor', 'Matrícula', 'Teléfono', 'Zona', 'Obs.'];
const ANCHOS = [6, 30, 14, 16, 16, 14];

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const fmtFecha = d => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
}).format(d);
// "14-08" a partir de la fecha (que siempre es mediodía UTC del día de Madrid, así que
// la parte de fecha del ISO ya es el día correcto). Intl con solo día y mes no rellena
// con ceros en es-ES, y "14-8" queda pobre en el nombre de la pestaña.
const ddmm = f => { const s = f.toISOString(); return `${s.slice(8, 10)}-${s.slice(5, 7)}`; };
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date());

/** Teléfono legible: 600 111 222. */
const fmtTel = t => {
  const d = String(t || '').replace(/\D/g, '').slice(-9);
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : (t || '');
};

/**
 * Convierte un turno de `salidasHoy` (planificador) en las filas del Excel: una
 * por CONDUCTOR (un CT con varios coches sale una vez con sus matrículas juntas).
 * Ya viene ordenado y sin librantes ni ausentes: es lo que hay que llamar.
 * Devuelve [{ nombre, matricula, telefono, zona, todoTurno }].
 */
function filasDeTurno(turno) {
  return ((turno && turno.conductores) || []).map(c => ({
    nombre: c.conductor || '',
    matricula: (c.matriculas || []).join(' · '),
    telefono: fmtTel(c.telefono),
    zona: c.zona || c.cuadrante || '',
    todoTurno: !!c.todoTurno,
  }));
}

/**
 * Pinta un bloque "turno" (título + cabecera + filas). Devuelve la siguiente fila libre.
 */
function bloqueTurno(ws, fila, turno, filas) {
  const esNoche = turno === 'Noche';
  const ultima = est.colLetra(CABECERAS.length);

  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const tt = ws.getCell(`A${fila}`);
  tt.value = `${esNoche ? '🌙' : '☀️'}  TURNO DE ${turno.toUpperCase()}   ·   ${filas.length} conductor(es)`;
  tt.font = { size: 11, bold: true, color: { argb: est.CAB_BG } };
  tt.fill = est.relleno(esNoche ? CAB_NOCHE : CAB_DIA);
  tt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  tt.border = est.TODOS_BORDES;
  ws.getRow(fila).height = 22;
  fila++;

  fila = est.cabeceraTabla(ws, fila, CABECERAS);

  if (!filas.length) {
    ws.mergeCells(`A${fila}:${ultima}${fila}`);
    const v = ws.getCell(`A${fila}`);
    v.value = 'Nadie asignado a este turno.';
    v.font = { size: 10, italic: true, color: { argb: 'FF9AA1AC' } };
    v.alignment = { vertical: 'middle', horizontal: 'center' };
    v.border = est.TODOS_BORDES;
    return fila + 2;
  }

  filas.forEach((f, i) => {
    const r = ws.getRow(fila);
    const val = [i + 1, f.nombre, f.matricula, f.telefono, f.zona, f.todoTurno ? 'TodoTurno' : ''];
    val.forEach((v, ci) => {
      const c = r.getCell(ci + 1);
      c.value = v;
      c.border = est.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'left' : 'center', indent: ci === 1 ? 1 : 0 };
      c.font = { size: 11, color: { argb: est.TEXTO }, bold: ci === 2 };
      // Zebra suave para seguir la fila con el dedo al leer en papel.
      if (i % 2) c.fill = est.relleno('FFFAFBFC');
      // El que hace las 24 h se resalta: conviene tenerlo presente.
      if (f.todoTurno) c.fill = est.relleno('FFFFF4DA');
    });
    r.height = 19;
    fila++;
  });
  return fila + 1;   // una fila de aire entre bloques
}

/**
 * @param {Object} opciones
 *   dias  nº de días futuros con los dos turnos (por defecto 2: sábado y domingo)
 *   desde día de partida 'YYYY-MM-DD' (por defecto hoy en Madrid)
 * @returns {Promise<{buffer: Buffer, nombre: string}>}
 */
async function generarExcelTurnos({ dias = 2, desde } = {}) {
  const dia0 = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : hoyMadrid();

  // Índice de día (0=lunes … 6=domingo) y fecha ISO de cada objetivo. Se parte del
  // mediodía UTC del día de Madrid: así sumar 24 h nunca cae en el día equivocado
  // cuando toca el cambio de hora.
  const base = new Date(dia0 + 'T12:00:00Z');
  const idxHoy = (base.getUTCDay() + 6) % 7;
  const objetivos = [];
  for (let n = 0; n <= dias; n++) {
    const f = new Date(base.getTime() + n * 86400000);
    objetivos.push({ n, fecha: f, iso: f.toISOString().slice(0, 10), idxDia: (idxHoy + n) % 7 });
  }

  // Una consulta por día (pocas): cada `salidasHoy` ya trae día y noche del
  // planificador (f_cobertura), deduplicado por persona y sin librantes ni ausentes.
  const salidas = new Map();
  for (const o of objetivos) salidas.set(o.iso, await salidasHoy(o.iso).catch(() => ({ turnos: [] })));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tibus Luxury';
  wb.created = new Date();
  // El logo se registra UNA vez y se reutiliza en las tres hojas.
  const idLogo = est.registrarLogo(wb);

  objetivos.forEach(({ n, fecha, idxDia, iso }) => {
    const porCodigo = new Map(((salidas.get(iso) || {}).turnos || []).map(t => [t.codigo, t]));
    const nombreDia = DIAS_SEM[idxDia];
    const dd = ddmm(fecha);   // con guion: Excel no admite "/" en el nombre de una pestaña
    // HOY solo interesa la noche (el turno de día ya está en la calle cuando se imprime).
    const codigos = n === 0 ? ['noche'] : ['dia', 'noche'];

    const ws = wb.addWorksheet(`${nombreDia} ${dd}`.slice(0, 31), {
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
    });
    ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const etiqueta = ['HOY', 'MAÑANA', 'PASADO MAÑANA'][n] || nombreDia.toUpperCase();
    let fila = est.bandaCabecera(ws, idLogo,
      `${etiqueta} · ${fmtFecha(fecha)}`,
      `${n === 0 ? 'Solo turno de noche' : 'Turno de día y turno de noche'}   ·   del planificador   ·   generado el ${sello()}`,
      CABECERAS.length);

    codigos.forEach(codigo => {
      const t = porCodigo.get(codigo) || { etiqueta: codigo === 'noche' ? 'Noche' : 'Día', conductores: [] };
      fila = bloqueTurno(ws, fila, t.etiqueta, filasDeTurno(t));
    });

    ws.views = [{ state: 'frozen', ySplit: 3 }];
  });

  const nombre = `Turnos_Tibus_${dia0}`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre };
}

module.exports = { generarExcelTurnos };
