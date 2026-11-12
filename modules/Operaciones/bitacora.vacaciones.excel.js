// ============================================================
// BITÁCORA — «Vacaciones por meses» en Excel (12/11/2026)
// ============================================================
// Camilo: «el excel lo quiero en base a esto [el calendario «Vacaciones por
// meses» de la bitácora], no las que disfrutaron ni nada, quiero más que todo
// las proyectadas y las que pasaron hace un mes máximo. Entonces será: mes
// pasado, mes cursante y los próximos meses hasta el último que tenga
// vacaciones programadas».
//
// Es la misma pantalla, en papel: una hoja por mes, una fila por persona de
// vacaciones ese mes y una columna por día; lo que ya pasó, sólido, y lo
// programado, rayado. Arriba de los días, la fila «A la vez» (cuánta gente falta
// cada día, más oscura cuanta más). Al final, una hoja con quien no tiene ni un
// día todavía. Los datos son los de la pantalla (bitacora.repo.leerVacaciones).

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_SEM = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const pad2 = n => String(n).padStart(2, '0');
const mesIdx = iso => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

// El color de las vacaciones de la bitácora (la «V»): sólido lo que pasó, rayado lo programado.
const VAC = 'FF5B7BE8';
const VAC_CLARO = 'FFDCE4FB';
const FINDE = 'FFF3F4F6';
const SOLIDO = { type: 'pattern', pattern: 'solid', fgColor: { argb: VAC } };
const RAYADO = { type: 'pattern', pattern: 'lightUp', fgColor: { argb: VAC }, bgColor: { argb: VAC_CLARO } };
// «A la vez»: de casi blanco a azul fuerte según cuánta gente falta ese día.
const calor = (c, max) => {
  if (!c) return null;
  const t = 0.15 + 0.85 * c / Math.max(1, max);
  const mezcla = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0').toUpperCase();
  return 'FF' + mezcla(0xEE, 0x5B) + mezcla(0xF2, 0x7B) + mezcla(0xFE, 0xE8);
};

/**
 * Los meses del Excel: el pasado, el que corre y los siguientes hasta el último
 * con vacaciones programadas (como mucho 15 meses vista, como la pantalla: una
 * fecha con el año mal tecleado no puede alargarlo hasta 2029).
 */
function mesesDelExcel(vac) {
  const hoyVm = mesIdx(vac.hoy);
  let ultimo = hoyVm;
  (vac.periodos || []).forEach(p => {
    const fin = p.hasta || p.desde;
    if (fin >= vac.hoy) ultimo = Math.max(ultimo, mesIdx(fin));
  });
  ultimo = Math.min(ultimo, hoyVm + 15);
  const out = [];
  for (let i = hoyVm - 1; i <= ultimo; i++) out.push(i);
  return out;
}

/** Quién está de vacaciones en un mes, con sus tramos recortados al mes (como la pantalla). */
function filasDeMes(vac, vm) {
  const y = Math.floor(vm / 12), m = vm % 12;
  const nD = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso1 = `${y}-${pad2(m + 1)}-01`, isoN = `${y}-${pad2(m + 1)}-${pad2(nD)}`;
  const porCond = new Map();
  (vac.periodos || []).forEach(p => {
    const h = p.hasta || '9999-12-31';
    if (p.desde > isoN || h < iso1) return;
    const a = p.desde > iso1 ? Number(p.desde.slice(8, 10)) : 1;
    const b = (p.hasta && p.hasta <= isoN) ? Number(p.hasta.slice(8, 10)) : nD;
    if (!porCond.has(p.conductorId)) porCond.set(p.conductorId, { ...p, segs: [] });
    porCond.get(p.conductorId).segs.push({ a, b, abierta: p.abierta });
  });
  const filas = [...porCond.values()].sort((x, z) =>
    Math.min(...x.segs.map(s => s.a)) - Math.min(...z.segs.map(s => s.a)) || x.nombre.localeCompare(z.nombre, 'es'));
  return { y, m, nD, iso1, filas };
}

/**
 * @param {Object} vac  lo que devuelve bitacora.service.vacaciones(): { hoy, periodos, sinVacaciones }
 * @returns {Promise<Buffer>}
 */
async function generar(vac) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  const meses = mesesDelExcel(vac);
  const programadas = new Set((vac.periodos || []).filter(p => p.desde > vac.hoy).map(p => p.conductorId));

  meses.forEach(vm => {
    const { y, m, nD, filas } = filasDeMes(vac, vm);
    const esHoy = vm === mesIdx(vac.hoy);
    const ws = wb.addWorksheet(`${MESES[m].slice(0, 3)} ${String(y).slice(2)}`, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const FIJAS = [{ t: 'Conductor', w: 34 }, { t: 'Teléfono', w: 14 }, { t: 'Turno', w: 9 }, { t: 'Días', w: 6 }];
    const nCols = FIJAS.length + nD;
    FIJAS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
    for (let d = 1; d <= nD; d++) ws.getColumn(FIJAS.length + d).width = 3.6;

    const cuenta = new Array(nD + 1).fill(0);
    filas.forEach(f => f.segs.forEach(s => { for (let i = s.a; i <= s.b; i++) cuenta[i]++; }));
    const maxC = Math.max(1, ...cuenta.slice(1));
    const diasMes = filas.reduce((t, f) => t + f.segs.reduce((s2, s) => s2 + (s.b - s.a + 1), 0), 0);
    const finde = d => { const w = new Date(Date.UTC(y, m, d)).getUTCDay(); return w === 0 || w === 6; };
    const isoDe = d => `${y}-${pad2(m + 1)}-${pad2(d)}`;

    let fila = E.bandaCabecera(ws, logo, `Vacaciones · ${MESES[m]} ${y}${esHoy ? ' · mes en curso' : vm < mesIdx(vac.hoy) ? ' · mes pasado' : ''}`,
      `${filas.length} de vacaciones · ${diasMes} días de vacaciones en el mes · pico de ${Math.max(0, ...cuenta.slice(1))} a la vez · ` +
      `${programadas.size} con vacaciones programadas · ${(vac.sinVacaciones || []).length} sin ni un día todavía · generado el ${sello()}`, nCols);
    ws.mergeCells(fila, 1, fila, nCols);
    const ley = ws.getCell(fila, 1);
    ley.value = 'Lo que ya pasó va en sólido; lo programado, rayado. «A la vez» es cuánta gente falta cada día: cuanto más oscuro, menos sitio queda ese día. ' +
      'Los fines de semana, en gris. «→» = sin fecha de vuelta.';
    ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
    ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(fila).height = 26;
    fila++;

    // La cabecera: los datos fijos y, por cada día, su número y la inicial del día.
    const cab = ws.getRow(fila);
    const pintaCab = (c, v, gris) => {
      c.value = v;
      c.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = E.relleno(gris ? 'FF6B7280' : E.CAB_BG);
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = E.TODOS_BORDES;
    };
    FIJAS.forEach((c, i) => pintaCab(cab.getCell(i + 1), c.t));
    for (let d = 1; d <= nD; d++) {
      pintaCab(cab.getCell(FIJAS.length + d), `${DIAS_SEM[new Date(Date.UTC(y, m, d)).getUTCDay()]}\n${d}`, finde(d));
    }
    cab.height = 26;
    const filaCab = fila;
    fila++;

    // «A la vez».
    const av = ws.getRow(fila++);
    ws.mergeCells(av.number, 1, av.number, FIJAS.length);
    av.getCell(1).value = 'A la vez';
    av.getCell(1).font = { size: 9, bold: true, color: { argb: E.TENUE } };
    av.getCell(1).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    for (let d = 1; d <= nD; d++) {
      const c = av.getCell(FIJAS.length + d);
      c.value = cuenta[d] || null;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      const bg = calor(cuenta[d], maxC);
      if (bg) c.fill = E.relleno(bg);
      c.font = { size: 9, bold: true, color: { argb: cuenta[d] / maxC > 0.55 ? 'FFFFFFFF' : E.TEXTO } };
    }
    av.height = 18;

    filas.forEach(f => {
      const r = ws.getRow(fila++);
      const dias = f.segs.reduce((t, s) => t + (s.b - s.a + 1), 0);
      const abierta = f.segs.some(s => s.abierta);
      [f.nombre, f.telefono, f.turno, dias + (abierta ? ' →' : '')].forEach((v, i) => {
        const c = r.getCell(i + 1);
        c.value = v;
        c.border = E.TODOS_BORDES;
        c.font = { size: 10, color: { argb: E.TEXTO }, bold: i === 0 };
        c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
      });
      for (let d = 1; d <= nD; d++) {
        const c = r.getCell(FIJAS.length + d);
        c.border = E.TODOS_BORDES;
        const s = f.segs.find(x => d >= x.a && d <= x.b);
        if (s) c.fill = isoDe(d) > vac.hoy ? RAYADO : SOLIDO;
        else if (finde(d)) c.fill = E.relleno(FINDE);
      }
      r.height = 17;
    });
    if (!filas.length) {
      ws.getRow(fila).getCell(1).value = `Nadie de vacaciones en ${MESES[m]} de ${y}.`;
      ws.getRow(fila).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
    }
    ws.views = [{ state: 'frozen', ySplit: filaCab + 1, xSplit: 1 }];
  });

  // Quien no tiene ni un día todavía: a quién le toca asignar.
  const sin = wb.addWorksheet('Sin vacaciones');
  [34, 14, 9, 16].forEach((w, i) => { sin.getColumn(i + 1).width = w; });
  let f2 = E.bandaCabecera(sin, logo, 'Sin vacaciones todavía',
    `${(vac.sinVacaciones || []).length} de alta sin ni un día de vacaciones · a quién le toca asignar · generado el ${sello()}`, 4);
  f2 = E.cabeceraTabla(sin, f2, ['Conductor', 'Teléfono', 'Turno', 'Zona']);
  (vac.sinVacaciones || []).forEach(c => {
    const r = sin.getRow(f2++);
    [c.nombre, c.telefono, c.turno, c.zona].forEach((v, i) => {
      const x = r.getCell(i + 1);
      x.value = v || '';
      x.border = E.TODOS_BORDES;
      x.font = { size: 10, color: { argb: E.TEXTO } };
      x.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
    });
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
