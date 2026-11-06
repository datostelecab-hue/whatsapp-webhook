// ============================================================
// RENDIMIENTO POR CUADRANTES — el Excel
// ============================================================
// «Separados siempre por cuadrantes, un cuadrante por pestaña en el excel con su
// respectivo resumen» (Camilo, 06/11/2026). Pinta lo que cuenta
// rendimiento.service.js; aquí no se decide nada.
//
//   · «Resumen»: zona a zona, cada cuadrante en una fila (con enlace a su
//     pestaña), el total de los cuadrantes y los coches sin cuadrante aparte.
//   · Una pestaña por cuadrante: su resumen, la parrilla de colores (fijo día
//     azul, fijo noche caqui, CT día verde, CT noche morado; SIN los mal
//     planificados) con lo que le falta y las horas de cada coche, y el día a día.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const FONDO = { fijoDia: 'FFDDEBF7', fijoNoche: 'FFEDE3C5', ctDia: 'FFE2EFDA', ctNoche: 'FFE4DFEC' };
const NEGRO = 'FF1F2430', GRIS = 'FF6B7280', ROJO = 'FFC00000', AMBAR = 'FF9C5A00', VERDE = 'FF1E7B34';
const LETRA_COLOR = { A: VERDE, B: VERDE, C: AMBAR, D: ROJO, E: ROJO, F: ROJO, S: VERDE };
// El semáforo de cómo van: verde 90 % o más, ámbar del 70 al 90 %, rojo por debajo.
const SEMAFORO = p => (p == null ? null : p >= 0.9 ? { bg: 'FFE5F4E4', fg: VERDE } : p >= 0.7 ? { bg: 'FFFEF3C7', fg: AMBAR } : { bg: 'FFFDE2E2', fg: ROJO });

const es = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const isodow = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const r1 = x => Math.round(x * 10) / 10;
const telefono = t => { const d = String(t || '').replace(/\D/g, ''); const n = d.length === 11 && d.startsWith('34') ? d.slice(2) : d; return n.length === 9 ? n.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4') : String(t || ''); };

/**
 * @param {Object} inf  rendimiento.service.informe()
 * @returns {Promise<Buffer>}
 */
async function generar(inf) {
  const { per, horasTurno: HT, diasPorCt, personas, contactos, modelo, etiquetaEstado } = inf;
  const nombreAsignacion = inf.nombreAsignacion || new Map();
  const conFalta = per.enCurso;          // «lo que falta» es una foto: solo en el mes en curso
  const mes = per.nombre.split(' ')[0];
  const lista = inf.grupos;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Telecab';
  const idLogo = E.registrarLogo(wb);
  const fino = { style: 'thin', color: { argb: E.GRIS_BORDE } };
  const bordes = { top: fino, left: fino, bottom: fino, right: fino };
  const H = '#,##0', P = '0%', H1 = '#,##0.0';
  const hastaTxt = !per.cerrados ? '(aún sin días cerrados)' : per.enCurso ? `hasta ayer (${es(per.ayer)})` : `hasta el ${es(per.ayer)}`;
  const regla = `Deben hacer: ${HT} h por plaza y turno (con correturnos, 4 plazas y ${2 * HT} h al día; sin correturnos, los días que libra cada fijo no cuentan; los días del coche en taller tampoco). ` +
    (per.cerrados ? `Llevan: horas del coche en BOLT (viaje + espera) del 1 al ${es(per.ayer)}. Cómo van: llevan ÷ lo que debían llevar ${hastaTxt}.` : 'Llevan: aún no hay ningún día cerrado este mes.') +
    (per.enCurso ? '' : ' El reparto en cuadrantes es el de hoy; lo que falta (fijos y CT) solo se da en el mes en curso.');
  const nombreHoja = new Set();
  const hojaDe = g => {
    let n = (g.k === 'sin' ? 'Sin cuadrante' : `C${g.numero} ${g.zona}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    while (nombreHoja.has(n)) n = n.slice(0, 29) + '·' + nombreHoja.size;
    nombreHoja.add(n);
    return n;
  };
  const hoja = new Map(lista.map(g => [g.k, hojaDe(g)]));
  const pinta = (c, s) => { if (!s) return; c.fill = E.relleno(s.bg); c.font = { bold: true, color: { argb: s.fg } }; };

  // ── RESUMEN ──
  {
    const cols = [['Zona / cuadrante', 24], ['Coches', 8], ['Fijos que faltan hoy', 9], ['Días de CT que faltan hoy (día / noche)', 12], [`CT que faltan (÷ ${diasPorCt})`, 9],
      ['Turnos sin conductor en el mes (pasados / previstos)', 13], ['De ellos, el día que libra el fijo: falta de CT (pasados / previstos)', 14],
      ['Horas que se pierden por falta de conductor', 12], ['De ellas, por falta de CT', 11],
      [`Deben hacer en ${mes} (h)`, 12], [`Debían llevar ${hastaTxt} (h)`, 12], ['Llevan (h)', 11], ['Cómo van', 9], ['A este ritmo, a fin de mes (h)', 12], ['Les faltan para llegar (h)', 12]];
    const ws = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    let fl = E.bandaCabecera(ws, idLogo, `RENDIMIENTO POR ZONAS Y CUADRANTES · ${per.nombre.toUpperCase()}`,
      `${per.enCurso ? `El planificador del ${es(per.diaPlan)}. ` : ''}${regla} Cada cuadrante tiene su pestaña.`, cols.length);
    ws.getRow(2).height = 44; ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    fl = E.cabeceraTabla(ws, fl, cols.map(c => c[0]), { alto: 44, ajustar: true });
    const fila = (txt, x, { zona, total, enlace } = {}) => {
      const r = ws.getRow(fl++);
      r.values = [txt, x.coches, conFalta ? x.fijosFaltan : '—', conFalta ? `${x.ctDia} / ${x.ctNoche}` : '—', conFalta ? x.ctFaltan : '—', `${x.sinPasados} / ${x.sinPrevistos}`, `${x.sinCtPasados} / ${x.sinCtPrevistos}`,
        x.perdidas, x.perdidasCt, x.objMes, x.objAyer, x.llevan, x.pct, x.ritmo, x.faltan];
      if (enlace) r.getCell(1).value = { text: txt, hyperlink: `#'${enlace}'!A1` };
      [8, 9, 10, 11, 12, 14, 15].forEach(k => { r.getCell(k).numFmt = H; });
      r.getCell(13).numFmt = P;
      for (let k = 1; k <= cols.length; k++) {
        const c = r.getCell(k); c.border = bordes;
        c.alignment = { vertical: 'middle', horizontal: k === 1 ? 'left' : 'center', indent: k === 1 && !zona && !total ? 1 : 0 };
        if (zona || total) { c.font = { bold: true, color: { argb: zona ? E.GOLD : NEGRO } }; c.fill = E.relleno(zona ? E.DARK : 'FFFDF3D7'); }
        else if (enlace && k === 1) c.font = { color: { argb: 'FF2563EB' }, underline: true };
      }
      if (!zona && !total) pinta(r.getCell(13), SEMAFORO(x.pct));
      if (x.sinMes && !zona && !total) [6, 8].forEach(k => { r.getCell(k).font = { bold: true, color: { argb: ROJO } }; });
      if (x.sinCtMes && !zona && !total) [7, 9].forEach(k => { r.getCell(k).font = { bold: true, color: { argb: ROJO } }; });
      if (conFalta && x.fijosFaltan && !zona && !total) r.getCell(3).font = { bold: true, color: { argb: ROJO } };
      if (conFalta && x.ctFaltan && !zona && !total) r.getCell(5).font = { bold: true, color: { argb: AMBAR } };
    };
    inf.zonas.forEach(z => {
      fila(z.zona.toUpperCase(), z.tot, { zona: true });
      z.grupos.forEach(g => fila(g.nombre, g.tot, { enlace: hoja.get(g.k) }));
    });
    if (inf.sinCuadrante) {
      fila('SIN CUADRANTE', inf.sinCuadrante.tot, { zona: true });
      fila('Coches sin cuadrante', inf.sinCuadrante.tot, { enlace: hoja.get('sin') });
    }
    fila('TOTAL DE LOS CUADRANTES', inf.total, { total: true });
    fl++;
    [`Cada plaza, ${HT} h por turno: un coche con correturnos son 4 plazas (2 fijos y 2 CT) y ${2 * HT} h al día. Si falta el CT, los días que libran los fijos se quedan sin nadie y bajan el rendimiento del cuadrante y de la zona. Turnos sin conductor: los que le tocaban al coche y no tenían a nadie en el cuadrante (quien está de vacaciones o de baja no cubre), los que ya pasaron y los previstos hasta fin de mes; de ellos, los que caen el día que libra el fijo son falta de CT, y el resto, falta de fijo (o el fijo fuera). Horas que se pierden: esos turnos × ${HT} h.`,
      `Fijos que faltan hoy: plazas de fijo sin nadie el ${es(per.diaPlan)} ni escrito para más adelante. Días de CT que faltan: los días que libra un fijo y ningún correturnos tiene puestos (de día / de noche); en un turno sin fijo no se cuentan (falta el fijo). Los CT que faltan son esos días ÷ ${diasPorCt}, hacia arriba. Las dos cosas, como en el planificador: es la foto de ese día y solo de los coches que ruedan. Un coche configurado sin correturnos no pide CT.`,
      `Deben hacer: cada turno que le toca al coche en el mes a ${HT} h. Con correturnos, los dos turnos todos los días; sin correturnos, el turno del fijo que libra no se pide (con la configuración de cada día). Los días que el coche estuvo parado según su historial (taller, Policía…) no se piden ni cuentan sus horas, salvo que BOLT diga que rodó 1 h o más (el historial de antes del 08/10/2026 no es del todo fiable). Un coche que entró en el planificador a mitad de mes cuenta desde su primera plaza.`,
      'Cómo van: en verde el 90 % o más de lo que debían llevar; en ámbar del 70 al 90 %; en rojo por debajo. A este ritmo: lo que harían en el mes si siguen igual. El total no incluye los coches sin cuadrante.',
    ].forEach(txt => { ws.mergeCells(fl, 1, fl, cols.length); const c = ws.getCell(fl, 1); c.value = txt; c.font = { size: 9, color: { argb: E.TENUE } }; c.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(fl).height = 12 * Math.ceil(txt.length / 210) + 6; fl++; });
  }

  // ── Las personas en sus celdas ──
  const vigente = p => p && p.id && p.desde && p.desde <= per.diaPlan && !(p.hasta && p.hasta < per.diaPlan);
  const diasDe = arr => (arr || []).map((v, i) => (v ? DIAS[i] : null)).filter(Boolean).join('/');
  const diasIso = arr => (arr || []).map(d => DIAS[d - 1]).filter(Boolean).join('/');
  const librasDe = coche => {
    const dt = coche.descansoTurno || {};
    return { dia: (dt.dia && dt.dia.length ? dt.dia : coche.descanso) || [], noche: (dt.noche && dt.noche.length ? dt.noche : coche.descanso) || [] };
  };
  const libranzasFijo = (c, coche, turno) => {
    const propias = c && (c.libra || []).some(Boolean) ? diasDe(c.libra) : '';
    if (propias) return propias;
    if (coche.sinCT) return diasIso(librasDe(coche)[turno === 'Noche' ? 'noche' : 'dia']);
    return diasIso(coche.descanso);
  };
  /** Nombre, contrato, teléfono, letra, si está fuera, sus días, hasta cuándo y quién llega. */
  function ficha(p, extra) {
    const c = personas.get(String(p.id)) || {};
    const tel = (contactos.get(String(p.id)) || {}).telefono || c.telefono || '';
    const letra = (c.rendimiento && c.rendimiento.letra) || '';
    const runs = [];
    const linea = (txt, font) => runs.push({ text: (runs.length ? '\n' : '') + txt, font: { size: 9, color: { argb: NEGRO }, ...font } });
    linea(c.nombre || p.nombre || '#' + p.id, { size: 10, bold: true });
    linea(c.esEtt ? 'ETT' + (c.ettNombre ? ' · ' + c.ettNombre : '') : 'Propia' + (c.contrato ? ' · ' + c.contrato.replace(/ ETT$/, '') : ''), { color: { argb: c.esEtt ? AMBAR : NEGRO } });
    if (tel) linea('Tel: ' + telefono(tel));
    if (letra) linea('Letra: ' + letra, { bold: true, color: { argb: LETRA_COLOR[letra] || NEGRO } });
    if (c.ausente) linea((c.estado || 'Ausente') + (c.vuelveEl ? ' hasta el ' + es(c.vuelveEl) : ''), { italic: true, bold: true, color: { argb: ROJO } });
    extra.forEach(x => linea(x));
    if (p.hasta) linea('Hasta el ' + es(p.hasta) + (p.futuro ? '' : ' · sin relevo'), { italic: true, bold: !p.futuro, color: { argb: p.futuro ? AMBAR : ROJO } });
    if (p.futuro) linea('→ ' + p.futuro.nombre + ' · llega el ' + es(p.futuro.desde), { bold: true, color: { argb: AMBAR } });
    return { richText: runs };
  }
  const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
  /** Tenía la plaza ese día pero ya no está en plantilla: el tablero lo da sin nombre. */
  const yaNoEsta = p => !!(p && p.asignacionId && !p.id && nombreAsignacion.get(String(p.asignacionId)));
  const exPlantilla = (p, dias) => ({ richText: [
    { text: nombreAsignacion.get(String(p.asignacionId)), font: { size: 10, bold: true, color: { argb: NEGRO } } },
    { text: '\nYa no está en plantilla', font: { size: 9, italic: true, color: { argb: GRIS } } },
    { text: '\n' + dias, font: { size: 9, color: { argb: NEGRO } } },
    ...(p.hasta ? [{ text: '\nHasta el ' + es(p.hasta), font: { size: 9, italic: true, color: { argb: GRIS } } }] : []),
  ] });
  /** Una plaza sin nadie: con su próximo dueño, si lo tiene escrito. */
  const vaciaCon = (p, texto, color, dias) => {
    if (p && p.futuro) {
      return { richText: [
        { text: texto + ' hoy', font: { size: 9, italic: true, color: { argb: GRIS } } },
        { text: '\n→ ' + p.futuro.nombre + ' · llega el ' + es(p.futuro.desde), font: { size: 9, bold: true, color: { argb: AMBAR } } },
        ...(dias ? [{ text: '\n' + dias, font: { size: 9, color: { argb: NEGRO } } }] : []),
      ] };
    }
    return { richText: [{ text: texto, font: { size: 9, italic: true, color: { argb: color } } }] };
  };

  // ── UNA PESTAÑA POR CUADRANTE ──
  for (const g of lista) {
    const sinCu = g.k === 'sin';
    const cols = [['Matrícula', 13], ['Fijo día', 27], ['Fijo noche', 27], ['CT día', 27], ['CT noche', 27], ['Lo que falta hoy', 18],
      ['Turnos sin conductor (pasados / previstos)', 11], ['De ellos, falta de CT (pasados / previstos)', 11], ['Horas que se pierden', 10], ['De ellas, por falta de CT', 10],
      [`Deben hacer en ${mes} (h)`, 11], [`Debían llevar ${hastaTxt} (h)`, 11], ['Llevan (h)', 10], ['Cómo van', 8], ['A este ritmo (h)', 10], ['Les faltan (h)', 10], ['Necesitan por turno de aquí a fin de mes (h)', 12]];
    const N = cols.length;
    const ws = wb.addWorksheet(hoja.get(g.k), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    let fl = E.bandaCabecera(ws, idLogo, sinCu ? `COCHES SIN CUADRANTE · ${per.nombre.toUpperCase()}` : `${g.nombre.toUpperCase()} · ${g.zona.toUpperCase()} · ${per.nombre.toUpperCase()}`,
      `${per.enCurso ? `El planificador del ${es(per.diaPlan)}. ` : ''}${regla}`, N);
    ws.getRow(2).height = 40; ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

    const x = g.tot;
    const datos = [
      ['Coches', x.coches, '0'],
      ['Fijos que faltan hoy', conFalta ? x.fijosFaltan : '—', conFalta ? '0' : null],
      ['Días de CT que faltan hoy (día / noche)', conFalta ? `${x.ctDia} / ${x.ctNoche}` : '—', null],
      [`CT que faltan (días ÷ ${diasPorCt})`, conFalta ? x.ctFaltan : '—', conFalta ? '0' : null],
      ['Turnos sin conductor en el mes (pasados / previstos)', `${x.sinPasados} / ${x.sinPrevistos}`, null],
      ['De ellos, el día que libra el fijo: falta de CT', `${x.sinCtPasados} / ${x.sinCtPrevistos}`, null],
      [`Horas que se pierden por falta de conductor (× ${HT} h)`, x.perdidas, H + ' "h"'],
      ['De ellas, por falta de CT', x.perdidasCt, H + ' "h"'],
      ...(x.diasParado ? [[`Días de coche parado hasta el ${es(per.ayer)} (no se piden)`, x.diasParado, '0']] : []),
      [`Deben hacer en ${mes}`, x.objMes, H + ' "h"'],
      [`Debían llevar hasta el ${es(per.ayer)}`, x.objAyer, H + ' "h"'],
      ['Llevan', x.llevan, H + ' "h"'],
      ['Cómo van', x.pct, P],
      ['A este ritmo, a fin de mes', x.ritmo, H + ' "h"'],
      ['Les faltan para llegar', x.faltan, H + ' "h"'],
    ];
    fl = E.cabeceraTabla(ws, fl, [sinCu ? 'Resumen de los coches sin cuadrante' : 'Resumen del cuadrante', ''], { alto: 20 });
    datos.forEach(([etq, v, fmt]) => {
      const r = ws.getRow(fl++);
      r.getCell(1).value = etq;
      r.getCell(2).value = v == null ? '—' : v; if (fmt && v != null) r.getCell(2).numFmt = fmt;
      r.getCell(1).font = { color: { argb: E.TEXTO } }; r.getCell(2).font = { bold: true, color: { argb: NEGRO } };
      r.getCell(2).alignment = { horizontal: 'left' };
      [1, 2].forEach(k => { r.getCell(k).border = bordes; });
      if (etq === 'Cómo van') pinta(r.getCell(2), SEMAFORO(v));
      if ((etq === 'Fijos que faltan hoy' || /^Turnos sin conductor|^Horas que se pierden|^De ell/.test(etq)) && v && v !== '0 / 0' && v !== '—') r.getCell(2).font = { bold: true, color: { argb: ROJO } };
    });
    ws.getColumn(1).width = 30;          // la etiqueta, que se lea entera
    fl++;
    const enlaceR = ws.getRow(fl++).getCell(1);
    enlaceR.value = { text: '← Volver al resumen', hyperlink: "#'Resumen'!A1" }; enlaceR.font = { color: { argb: 'FF2563EB' }, underline: true };
    fl++;

    // La parrilla.
    const cabParrilla = fl;
    fl = E.cabeceraTabla(ws, fl, cols.map(c => c[0]), { alto: 46, ajustar: true });
    [[2, FONDO.fijoDia], [3, FONDO.fijoNoche], [4, FONDO.ctDia], [5, FONDO.ctNoche]].forEach(([k, c]) => {
      const cc = ws.getRow(cabParrilla).getCell(k); cc.fill = E.relleno(c); cc.font = { size: 10, bold: true, color: { argb: NEGRO } };
    });
    const FONDO_COL = { 2: FONDO.fijoDia, 3: FONDO.fijoNoche, 4: FONDO.ctDia, 5: FONDO.ctNoche };
    const C_PCT = 14;
    for (const cx of g.coches) {
      const coche = cx.coche;
      const r = ws.getRow(fl++);
      const estado = etiquetaEstado.get(coche.estadoVeh) || coche.estadoVeh || 'parado';
      r.getCell(1).value = { richText: [
        { text: coche.matricula, font: { size: 11, bold: true, color: { argb: NEGRO } } },
        { text: '\n' + (modelo.get(String(coche.vehiculoId)) || ''), font: { size: 8, color: { argb: GRIS } } },
        ...(cx.rueda ? [] : [{ text: '\n' + (coche.extra ? 'Ya no está en el planificador' : cx.estadoCorte ? `Parado el ${es(per.fin)}: ${cx.estadoCorte}` : 'Hoy: ' + estado), font: { size: 8, bold: true, color: { argb: ROJO } } }]),
        ...(coche.extra ? [{ text: `\nCon plaza hasta el ${es(cx.hasta)}`, font: { size: 8, color: { argb: GRIS } } }] : []),
        ...(cx.diasParado ? [{ text: `\n${cx.diasParado} día${cx.diasParado === 1 ? '' : 's'} parado en ${mes}`, font: { size: 8, color: { argb: GRIS } } }] : []),
        ...(coche.sinCT ? [{ text: '\nSin correturnos', font: { size: 8, color: { argb: GRIS } } }] : []),
        ...(cx.desde > per.ini ? [{ text: '\nEn el planificador desde el ' + es(cx.desde), font: { size: 8, color: { argb: GRIS } } }] : []),
      ] };
      if (coche.extra) {
        [2, 3, 4, 5].forEach(k => { r.getCell(k).value = { richText: [{ text: '—', font: { size: 9, color: { argb: GRIS } } }] }; });
      } else {
        [0, 1].forEach(slot => {
          const p = (coche.personas || [])[slot];
          r.getCell(2 + slot).value = vigente(p) ? ficha(p, ['Libra: ' + (libranzasFijo(personas.get(String(p.id)), coche, p.turno) || '—')])
            : yaNoEsta(p) ? exPlantilla(p, 'Libra: ' + (libranzasFijo(null, coche, p.turno) || '—')) : vaciaCon(p, 'Sin conductor', ROJO, '');
        });
        [[2, 4], [3, 5]].forEach(([s1, s2], i) => {
          const celda = r.getCell(4 + i);
          if (coche.sinCT) { celda.value = { richText: [{ text: 'Sin correturnos', font: { size: 9, italic: true, color: { argb: GRIS } } }] }; return; }
          // Los CT de ese día, quien ya no está y los que solo están por llegar (con su día de entrada).
          const ps = [s1, s2].map(s => (coche.personas || [])[s]).filter(p => vigente(p) || yaNoEsta(p) || (p && p.futuro));
          if (!ps.length) { celda.value = { richText: [{ text: 'Sin correturnos puesto', font: { size: 9, italic: true, color: { argb: (i ? cx.ctNoche : cx.ctDia) ? ROJO : GRIS } } }] }; return; }
          const partes = ps.map(p => (vigente(p)
            ? ficha(p, ['Cubre: ' + (diasDe(p.diasManual) || 'sin días puestos')])
            : yaNoEsta(p) ? exPlantilla(p, 'Cubría: ' + (diasDe(p.diasManual) || 'sin días puestos'))
              : vaciaCon(p, 'Sin correturnos', GRIS, 'Cubrirá: ' + (diasIso(p.futuro.dias) || 'sin días puestos'))).richText);
          celda.value = { richText: partes.reduce((acc, runs, k) => acc.concat(k ? [{ text: '\n—\n', font: { size: 8, color: { argb: GRIS } } }] : [], runs), []) };
        });
      }
      const sinFoto = cx.falta == null || coche.extra;
      r.getCell(6).value = sinFoto ? '—' : !cx.rueda ? 'Coche parado: no pide conductores' : cx.falta.length ? mayus((cx.falta.length > 1 || /^([2-9]|\d{2,})/.test(cx.falta[0]) ? 'faltan ' : 'falta ') + cx.falta.join(', ')) : 'Completo';
      r.getCell(6).font = { size: 10, bold: !sinFoto && !!cx.falta.length, color: { argb: sinFoto || !cx.rueda ? GRIS : cx.falta.length ? ROJO : VERDE } };
      r.getCell(7).value = `${cx.sinPasados} / ${cx.sinPrevistos}`;
      r.getCell(8).value = `${cx.sinCtPasados} / ${cx.sinCtPrevistos}`;
      r.getCell(9).value = cx.perdidas; r.getCell(9).numFmt = H;
      r.getCell(10).value = cx.perdidasCt; r.getCell(10).numFmt = H;
      [cx.objMes, cx.objAyer, cx.llevan, cx.pct, cx.ritmo, cx.faltan, cx.porTurno].forEach((v, i) => {
        const c = r.getCell(11 + i); c.value = v == null ? '—' : v; c.numFmt = i === 3 ? P : i === 6 ? H1 : H;
      });
      r.height = 104;
      for (let k = 1; k <= N; k++) {
        const c = r.getCell(k); c.border = bordes;
        c.alignment = { vertical: 'middle', horizontal: k >= 7 ? 'center' : 'left', wrapText: true, indent: k >= 2 && k <= 5 ? 1 : 0 };
        if (FONDO_COL[k]) c.fill = E.relleno(FONDO_COL[k]);
        const rojo = ((k === 7 || k === 9) && cx.sinMes) || ((k === 8 || k === 10) && cx.sinCtMes);
        if (k >= 7 && k !== C_PCT) c.font = { size: 11, bold: k === 13 || rojo, color: { argb: rojo ? ROJO : NEGRO } };
      }
      pinta(r.getCell(C_PCT), SEMAFORO(cx.pct));
    }
    // El total del cuadrante, bajo la parrilla.
    {
      const r = ws.getRow(fl++);
      r.getCell(1).value = sinCu ? 'Sin cuadrante' : 'Cuadrante';
      r.getCell(6).value = !conFalta ? '—' : x.fijosFaltan || x.ctFaltan ? `Faltan ${[x.fijosFaltan ? `${x.fijosFaltan} fijo${x.fijosFaltan === 1 ? '' : 's'}` : '', x.ctFaltan ? `${x.ctFaltan} CT` : ''].filter(Boolean).join(' y ')}` : 'Completo';
      r.getCell(7).value = `${x.sinPasados} / ${x.sinPrevistos}`;
      r.getCell(8).value = `${x.sinCtPasados} / ${x.sinCtPrevistos}`;
      r.getCell(9).value = x.perdidas; r.getCell(9).numFmt = H;
      r.getCell(10).value = x.perdidasCt; r.getCell(10).numFmt = H;
      [x.objMes, x.objAyer, x.llevan, x.pct, x.ritmo, x.faltan, x.porTurno].forEach((v, i) => { const c = r.getCell(11 + i); c.value = v == null ? '—' : v; c.numFmt = i === 3 ? P : i === 6 ? H1 : H; });
      for (let k = 1; k <= N; k++) { const c = r.getCell(k); c.border = bordes; c.font = { bold: true, color: { argb: NEGRO } }; c.fill = E.relleno('FFFDF3D7'); c.alignment = { vertical: 'middle', horizontal: k >= 6 ? 'center' : 'left', wrapText: true }; }
      pinta(r.getCell(C_PCT), SEMAFORO(x.pct));
    }
    fl++;

    // El día a día: un día por fila y un coche por columna.
    const t0 = ws.getRow(fl++).getCell(1);
    t0.value = `Día a día · horas de cada coche en ${mes}`;
    t0.font = { bold: true, size: 11, color: { argb: E.DARK } };
    const nota = ws.getRow(fl++).getCell(1);
    nota.value = `Verde: 90 % o más de lo que le tocaba ese día (${HT} h por turno); ámbar: del 70 al 90 %; rojo: menos. Gris: aún no ha acabado, ese día no le tocaba salir o el coche estaba parado (no se pide). «sin nadie»: turnos que le tocaban sin conductor en el cuadrante; «falta CT», el día que libraba el fijo.`;
    nota.font = { size: 9, color: { argb: E.TENUE } };
    fl = E.cabeceraTabla(ws, fl, ['Día', ...g.coches.map(cx => cx.coche.matricula)], { alto: 20 });
    per.dias.forEach((d, i) => {
      const r = ws.getRow(fl++);
      const dia = r.getCell(1);
      dia.value = `${DIAS[isodow(d) - 1]} ${Number(d.slice(8))}`;
      dia.font = { size: 9, bold: isodow(d) >= 6, color: { argb: NEGRO } }; dia.border = bordes;
      g.coches.forEach((cx, j) => {
        const dd = cx.dias[i];
        const c = r.getCell(2 + j);
        c.border = bordes; c.alignment = { horizontal: 'center' }; c.font = { size: 9, color: { argb: NEGRO } };
        if (dd.antes || dd.despues) { c.value = dd.antes ? 'aún no estaba' : 'ya no estaba'; c.font = { size: 8, color: { argb: GRIS } }; c.fill = E.relleno('FFF3F4F6'); return; }
        if (dd.parado) { c.value = String(dd.parado).toLowerCase(); c.font = { size: 8, italic: true, color: { argb: GRIS } }; c.fill = E.relleno('FFF3F4F6'); return; }
        const sin = dd.sin ? `${dd.sin} turno${dd.sin === 1 ? '' : 's'} sin nadie` + (dd.sinCt ? (dd.sinCt === dd.sin ? ' (falta CT)' : ` (${dd.sinCt} de CT)`) : '') : '';
        if (dd.h == null) {   // aún no ha acabado: solo lo que ya se sabe que falta
          c.fill = E.relleno('FFF3F4F6');
          if (sin) { c.value = sin; c.font = { size: 8, bold: true, color: { argb: ROJO } }; }
          return;
        }
        const horas = r1(dd.h).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' h';
        c.value = sin ? { richText: [{ text: horas, font: { size: 9, bold: true } }, { text: '\n' + sin, font: { size: 8, bold: true, color: { argb: ROJO } } }] } : horas;
        if (sin) { c.alignment = { horizontal: 'center', wrapText: true }; r.height = 26; }
        if (!dd.obj) { c.fill = E.relleno('FFF3F4F6'); return; }
        const s = SEMAFORO(dd.h / dd.obj);
        c.fill = E.relleno(s.bg);
        if (!sin) c.font = { size: 9, bold: true, color: { argb: s.fg } };
      });
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
