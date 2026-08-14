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
const path = require('path');
const fs = require('fs');
const { leerTablero, DIAS_SEM, TURNOS } = require('./planificadorV2');
const { leerTelefonosDB } = require('./control');
const { normClave } = require('./conductores');

const TZ = 'Europe/Madrid';
const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo-128.png');

// Paleta de la casa en ARGB.
const DARK = 'FF1F2430';
const GOLD = 'FFE8B84B';
const GRIS_BORDE = 'FFD8DCE3';
const CAB_DIA = 'FFFDF0D2';     // cabecera del turno de día (dorado suave)
const CAB_NOCHE = 'FFDCE7FA';   // cabecera del turno de noche (azul suave)
const CAB_TXT = 'FF394150';

const borde = { style: 'thin', color: { argb: GRIS_BORDE } };
const TODOS_BORDES = { top: borde, left: borde, bottom: borde, right: borde };

const CABECERAS = ['Nº', 'Conductor', 'Matrícula', 'Teléfono', 'Zona', 'Obs.'];
const ANCHOS = [6, 30, 14, 16, 16, 14];

let _logoOk = null;
const hayLogo = () => (_logoOk === null ? (_logoOk = fs.existsSync(LOGO)) : _logoOk);

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
 * Quién sale ese día y turno, tal como lo pinta la Cobertura.
 * Devuelve [{ nombre, matricula, telefono, zona, todoTurno }] ordenado por matrícula.
 */
function salidasDe(tablero, telsDB, idxDia, turno) {
  const iT = TURNOS.indexOf(turno);
  if (iT < 0) return [];
  // Teléfono por ID_BOLT desde la propia agenda; si falta, se busca en DB_CONDUCTORES.
  const porId = new Map();
  (tablero.conductores || []).forEach(c => { if (c.idBolt) porId.set(c.idBolt, c); });
  const tel = (id, nombre) => {
    const c = porId.get(id);
    const t = (c && (c.telefono || '').trim()) || '';
    if (t) return t;
    return (telsDB && telsDB.get(normClave(nombre || id))) || '';
  };

  const filas = [];
  (tablero.coches || []).forEach(coche => {
    if (!coche.matricula || !coche.operativo) return;
    const tramo = (coche.semana || [])[idxDia * 2 + iT];
    if (!tramo || !tramo.id) return;
    // TodoTurno = la MISMA persona cubre el día y la noche de este coche.
    const otro = (coche.semana || [])[idxDia * 2 + (iT === 0 ? 1 : 0)];
    const todoTurno = !!(otro && otro.id && otro.id === tramo.id);
    filas.push({
      nombre: (tramo.nombre || tramo.id || '').trim(),
      matricula: coche.matricula,
      telefono: fmtTel(tel(tramo.id, tramo.nombre)),
      zona: coche.zona || '',
      todoTurno
    });
  });
  return filas.sort((a, b) => a.matricula.localeCompare(b.matricula));
}

/** Banda superior con el logo y el título. Devuelve la siguiente fila libre. */
function cabecera(ws, idLogo, titulo, subtitulo, nCols) {
  const ultima = String.fromCharCode(64 + nCols);
  ws.mergeCells(`A1:${ultima}1`);
  const t = ws.getCell('A1');
  t.value = `TIBUS LUXURY · ${titulo}`;
  t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: GOLD } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: idLogo != null ? 6 : 1 };
  ws.getRow(1).height = 44;
  if (idLogo != null) {
    ws.addImage(idLogo, { tl: { col: 0.15, row: 0.12 }, ext: { width: 42, height: 42 }, editAs: 'absolute' });
  }
  ws.mergeCells(`A2:${ultima}2`);
  const s = ws.getCell('A2');
  s.value = subtitulo;
  s.font = { size: 10, color: { argb: 'FF6B7280' } };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 19;
  return 4;   // se deja la fila 3 en blanco
}

/**
 * Pinta un bloque "turno" (título + cabecera + filas). Devuelve la siguiente fila libre.
 */
function bloqueTurno(ws, fila, turno, filas) {
  const esNoche = turno === 'Noche';
  const nCols = CABECERAS.length;
  const ultima = String.fromCharCode(64 + nCols);

  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const tt = ws.getCell(`A${fila}`);
  tt.value = `${esNoche ? '🌙' : '☀️'}  TURNO DE ${turno.toUpperCase()}   ·   ${filas.length} conductor(es)`;
  tt.font = { size: 11, bold: true, color: { argb: CAB_TXT } };
  tt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: esNoche ? CAB_NOCHE : CAB_DIA } };
  tt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  tt.border = TODOS_BORDES;
  ws.getRow(fila).height = 22;
  fila++;

  const cab = ws.getRow(fila);
  CABECERAS.forEach((h, i) => {
    const c = cab.getCell(i + 1);
    c.value = h;
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CAB_TXT } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = TODOS_BORDES;
  });
  cab.height = 20;
  fila++;

  if (!filas.length) {
    ws.mergeCells(`A${fila}:${ultima}${fila}`);
    const v = ws.getCell(`A${fila}`);
    v.value = 'Nadie asignado a este turno.';
    v.font = { size: 10, italic: true, color: { argb: 'FF9AA1AC' } };
    v.alignment = { vertical: 'middle', horizontal: 'center' };
    v.border = TODOS_BORDES;
    return fila + 2;
  }

  filas.forEach((f, i) => {
    const r = ws.getRow(fila);
    const val = [i + 1, f.nombre, f.matricula, f.telefono, f.zona, f.todoTurno ? 'TodoTurno' : ''];
    val.forEach((v, ci) => {
      const c = r.getCell(ci + 1);
      c.value = v;
      c.border = TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'left' : 'center', indent: ci === 1 ? 1 : 0 };
      c.font = { size: 11, color: { argb: 'FF374151' }, bold: ci === 2 };
      // Zebra suave para seguir la fila con el dedo al leer en papel.
      if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } };
      // El que hace las 24 h se resalta: conviene tenerlo presente.
      if (f.todoTurno) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4DA' } };
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
  const telsDB = await leerTelefonosDB().catch(() => new Map());
  const dia0 = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : hoyMadrid();

  // Índice de día (0=lunes … 6=domingo) y semana de cada fecha objetivo.
  // Se parte del mediodía UTC del día de Madrid: así sumar 24 h nunca cae en el día
  // equivocado cuando toca el cambio de hora.
  const base = new Date(dia0 + 'T12:00:00Z');
  const idxHoy = (base.getUTCDay() + 6) % 7;
  const objetivos = [];
  for (let n = 0; n <= dias; n++) {
    const f = new Date(base.getTime() + n * 86400000);
    objetivos.push({ n, fecha: f, idxDia: (idxHoy + n) % 7, offsetSemana: Math.floor((idxHoy + n) / 7) });
  }

  // Se lee cada semana UNA vez (hoy y, si el rango cruza el domingo, la siguiente).
  const tableros = new Map();
  for (const o of [...new Set(objetivos.map(x => x.offsetSemana))]) {
    tableros.set(o, await leerTablero({ offsetSemana: o }));
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tibus Luxury';
  wb.created = new Date();
  // El logo se registra UNA vez y se reutiliza en las tres hojas.
  const idLogo = hayLogo() ? wb.addImage({ filename: LOGO, extension: 'png' }) : null;

  objetivos.forEach(({ n, fecha, idxDia, offsetSemana }) => {
    const tablero = tableros.get(offsetSemana);
    const nombreDia = DIAS_SEM[idxDia];
    const dd = ddmm(fecha);   // con guion: Excel no admite "/" en el nombre de una pestaña
    // HOY solo interesa la noche (el turno de día ya está en la calle cuando se imprime).
    const turnos = n === 0 ? ['Noche'] : ['Día', 'Noche'];

    const ws = wb.addWorksheet(`${nombreDia} ${dd}`.slice(0, 31), {
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
    });
    ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const etiqueta = n === 0 ? 'HOY' : n === 1 ? 'MAÑANA' : 'PASADO MAÑANA';
    let fila = cabecera(ws, idLogo,
      `${etiqueta} · ${fmtFecha(fecha)}`,
      `${n === 0 ? 'Solo turno de noche' : 'Turno de día y turno de noche'}   ·   generado el ${sello()}`,
      CABECERAS.length);

    turnos.forEach(turno => {
      fila = bloqueTurno(ws, fila, turno, salidasDe(tablero, telsDB, idxDia, turno));
    });

    ws.views = [{ state: 'frozen', ySplit: 3 }];
  });

  const nombre = `Turnos_Tibus_${dia0}`;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre };
}

module.exports = { generarExcelTurnos, salidasDe };
