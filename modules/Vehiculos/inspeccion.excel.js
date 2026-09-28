// ============================================================
// INSPECCIÓN DE VEHÍCULOS — el Excel
// ============================================================
// Camilo, 28/09/2026: el «Exportar» genérico del listado sacaba una columna por
// dato de la pantalla; él quiere el FORMATO DEL TALLER —un coche por fila y una
// columna por elemento con su estado— «más moderno y elegante, pero con los
// datos completos».
//
// Tres hojas:
//   · Inspección de vehículos: el formato del taller, con los MISMOS títulos de
//     columna que su Excel (`cabecera_excel` del catálogo). Por eso el fichero
//     también SE PUEDE VOLVER A IMPORTAR: el importador busca la cabecera en
//     las primeras filas, por encima de la banda con el logo.
//   · Resumen: las cifras y, por elemento, cuántos coches lo tienen bien, en
//     falta o deteriorado. En fórmulas: si el taller corrige una celda, cuadra.
//   · Qué hay que reponer: solo los coches con algo que falta o deteriorado.
//
// Los colores de los estados son FORMATO CONDICIONAL y las celdas llevan una
// lista desplegable: si alguien cambia «Falta» por «Correcto», la celda se
// pinta sola. Las caducidades se pintan a fecha de HOY (lo dice la cabecera).

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const AVISO_DIAS = 60;
const TZ = 'Europe/Madrid';

// Cómo se escribe cada estado en la celda: con un signo delante, como las
// casillas del Excel del taller, y con las palabras que entiende el importador.
const SIGNO = { correcto: '✓', deteriorado: '!', falta: '✗', no_aplica: '—' };
const COLORES = {
  green: { bg: 'FFD1FAE5', fg: 'FF065F46' },
  warn: { bg: 'FFFEF3C7', fg: 'FF92400E' },
  red: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  muted: { bg: 'FFF3F4F6', fg: 'FF6B7280' },
  azul: { bg: 'FFEFF3FA', fg: 'FF1F2430' },
};
const F = { size: 10, color: { argb: E.TEXTO } };
const FB = { size: 10, bold: true, color: { argb: E.TEXTO } };
const TENUE = { size: 9, color: { argb: E.TENUE } };
const CENTRO = { vertical: 'middle', horizontal: 'center', wrapText: true };
const IZQ = { vertical: 'middle', horizontal: 'left', wrapText: true };

const diaMadrid = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hoyMadrid = () => diaMadrid(new Date());
const aEs = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/** Cuánto le queda a un vencimiento de mes y año (caduca el último día del mes). */
function vence(mes, anio, hoy) {
  if (!anio) return null;
  const [y, m, d] = hoy.split('-').map(Number);
  const h = Date.UTC(y, m - 1, d);
  if (!mes) return anio < y ? -1 : null;      // solo el año: se avisa si ya pasó
  return Math.round((Date.UTC(anio, mes, 0) - h) / 86400000);
}
const tonoVence = dias => (dias == null ? null : dias < 0 ? 'red' : dias <= AVISO_DIAS ? 'warn' : null);

// Una regla de formato condicional «si la celda contiene…».
const contiene = (celda, texto, tono) => ({
  type: 'expression', formulae: [`ISNUMBER(SEARCH("${texto}",${celda}))`],
  style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORES[tono].bg } },
    font: { color: { argb: COLORES[tono].fg }, bold: tono !== 'green' && tono !== 'muted' } },
});

/**
 * El libro. `filas` son las de `repo.lista()` (un coche con su última
 * inspección); `cat` los catálogos. Devuelve el Buffer del .xlsx.
 */
async function generar({ filas, cat, faltaObs, filtrado }) {
  const hoy = hoyMadrid();
  const elementos = cat.elementos;
  const estadoDe = c => cat.estados.find(e => e.codigo === c) || { etiqueta: c, tono: 'muted', es_fallo: false };
  const textoEstado = c => (c ? `${SIGNO[c] || ''} ${estadoDe(c).etiqueta}`.trim() : '');
  const resultadoDe = c => cat.resultados.find(r => r.codigo === c);
  const inspeccionados = filas.filter(f => f.inspeccion_id && f.observaciones !== faltaObs);
  const fallosDe = f => (f.elementos || []).filter(x => estadoDe(x.estado).es_fallo);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab ERP';
  wb.created = new Date();
  const idLogo = E.registrarLogo(wb);
  const sub = `${filas.length} coches${filtrado ? ' (los que se veían filtrados en la pantalla)' : ''} · ` +
    `caducidades a fecha de ${aEs(hoy)} · ✓ Correcto · ! Deteriorado · ✗ Falta · — No se requiere`;

  // ═════════ 1 · INSPECCIÓN DE VEHÍCULOS (el formato del taller) ═════════
  const ws = wb.addWorksheet('Inspección de vehículos', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  // Las columnas, en el orden del Excel del taller; al final, lo que el taller
  // no trae y el ERP sí sabe.
  const cols = [
    { t: 'Matrícula del vehículo', w: 13, grupo: 'Vehículo', v: f => f.matricula, estilo: 'mat' },
    { t: 'MARCA', w: 11, grupo: 'Vehículo', v: f => f.marca || (f.marca_modelo || '').split(' ')[0] || '' },
    { t: 'MODELO', w: 13, grupo: 'Vehículo', v: f => f.modelo || (f.marca_modelo || '').split(' ').slice(1).join(' ') || '' },
    ...elementos.map(e => ({ t: e.cabecera_excel || e.etiqueta, w: 13, grupo: e.grupo || 'Elementos', estado: true,
      v: f => textoEstado(((f.elementos || []).find(x => x.elemento === e.codigo) || {}).estado) })),
    { t: 'ITV — Mes de caducidad', w: 11, grupo: 'Caducidades', v: f => (f.itv_mes ? MESES[f.itv_mes - 1] : ''), vence: f => vence(f.itv_mes, f.itv_anio, hoy) },
    { t: 'ITV — Año de caducidad', w: 10, grupo: 'Caducidades', v: f => f.itv_anio || '', vence: f => vence(f.itv_mes, f.itv_anio, hoy) },
    { t: 'Pegatina VTC Delantera — Mes de caducidad', w: 12, grupo: 'Caducidades', v: f => (f.vtc_delantera_mes ? MESES[f.vtc_delantera_mes - 1] : ''), vence: f => vence(f.vtc_delantera_mes, f.vtc_delantera_anio, hoy) },
    { t: 'Pegatina VTC Delantera — Año de caducidad', w: 11, grupo: 'Caducidades', v: f => f.vtc_delantera_anio || '', vence: f => vence(f.vtc_delantera_mes, f.vtc_delantera_anio, hoy) },
    { t: 'Pegatina VTC Trasera — Mes de caducidad', w: 12, grupo: 'Caducidades', v: f => (f.vtc_trasera_mes ? MESES[f.vtc_trasera_mes - 1] : ''), vence: f => vence(f.vtc_trasera_mes, f.vtc_trasera_anio, hoy) },
    { t: 'Pegatina VTC Trasera — Año de caducidad', w: 11, grupo: 'Caducidades', v: f => f.vtc_trasera_anio || '', vence: f => vence(f.vtc_trasera_mes, f.vtc_trasera_anio, hoy) },
    { t: 'Observaciones adicionales', w: 38, grupo: 'Resultado', v: f => (f.inspeccion_id ? f.observaciones || '' : 'Sin ninguna inspección todavía'), izq: true },
    { t: 'Resultado final de la inspección', w: 20, grupo: 'Resultado', resultado: true, v: f => (resultadoDe(f.resultado) || {}).etiqueta || '' },
    { t: 'Fecha de la inspección', w: 14, grupo: 'Registro', v: f => (!f.inspeccion_id ? '' : f.fecha ? aEs(f.fecha) : `Excel del taller (importado el ${aEs(diaMadrid(new Date(f.creado_at)))})`) },
    { t: 'Sede', w: 10, grupo: 'Registro', v: f => (f.sede ? f.sede.charAt(0).toUpperCase() + f.sede.slice(1) : '') },
    { t: 'Incidencias', w: 10, grupo: 'Registro', v: f => (f.inspeccion_id && f.observaciones !== faltaObs ? fallosDe(f).length : ''), num: true },
  ];
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  let fila = E.bandaCabecera(ws, idLogo, 'Inspección de vehículos', sub, cols.length) - 1;   // sin fila de respiro

  // Fila de grupos: «Identificación», «Seguridad», «Caducidades»… combinadas.
  const rg = ws.getRow(fila);
  let ini = 0;
  for (let i = 1; i <= cols.length; i++) {
    if (i < cols.length && cols[i].grupo === cols[ini].grupo) continue;
    if (i - 1 > ini) ws.mergeCells(fila, ini + 1, fila, i);
    const c = rg.getCell(ini + 1);
    c.value = cols[ini].grupo;
    c.font = { size: 9, bold: true, color: { argb: E.GOLD } };
    c.fill = E.relleno(E.DARK);
    c.alignment = CENTRO;
    c.border = E.TODOS_BORDES;
    ini = i;
  }
  rg.height = 18;
  fila++;
  // La cabecera, con los títulos EXACTOS del taller.
  const cab = fila;
  E.cabeceraTabla(ws, fila, cols.map(c => c.t));
  ws.getRow(fila).height = 58;
  ws.getRow(fila).eachCell(c => { c.alignment = CENTRO; });
  fila++;
  const primera = fila;

  filas.forEach(f => {
    const r = ws.getRow(fila);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      cel.value = c.v(f);
      cel.border = E.TODOS_BORDES;
      cel.font = F;
      cel.alignment = c.izq ? IZQ : CENTRO;
      if (c.estilo === 'mat') { cel.font = { size: 11, bold: true, color: { argb: E.DARK } }; cel.fill = E.relleno(COLORES.azul.bg); }
      if (c.vence) {
        const t = tonoVence(c.vence(f));
        if (t && cel.value !== '') { cel.fill = E.relleno(COLORES[t].bg); cel.font = { size: 10, bold: true, color: { argb: COLORES[t].fg } }; }
      }
      if (!f.inspeccion_id && c.izq) cel.font = { size: 10, italic: true, color: { argb: COLORES.warn.fg } };
    });
    r.height = 20;
    fila++;
  });
  const ultima = Math.max(fila - 1, primera);

  // Estados: formato condicional (se repinta si alguien cambia la celda) y lista.
  const colEl = cols.map((c, i) => (c.estado ? i + 1 : null)).filter(Boolean);
  if (colEl.length && filas.length) {
    const a = E.colLetra(colEl[0]), b = E.colLetra(colEl[colEl.length - 1]);
    const ref = `${a}${primera}:${b}${ultima}`, c0 = `${a}${primera}`;
    ws.addConditionalFormatting({ ref, rules: [
      contiene(c0, 'Falta', 'red'), contiene(c0, 'Deteriorado', 'warn'),
      contiene(c0, 'Correcto', 'green'), contiene(c0, 'No se requiere', 'muted'),
    ] });
    const lista = cat.estados.map(e => textoEstado(e.codigo));
    for (let r = primera; r <= ultima; r++) {
      colEl.forEach(k => {
        ws.getCell(r, k).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${lista.join(',')}"`],
          showErrorMessage: true, errorTitle: 'Estado', error: 'Elige un estado de la lista' };
      });
    }
  }
  const kRes = cols.findIndex(c => c.resultado) + 1;
  if (kRes && filas.length) {
    const L = E.colLetra(kRes), c0 = `${L}${primera}`;
    // «No apto» antes que «Apto»: también contiene «Apto».
    ws.addConditionalFormatting({ ref: `${L}${primera}:${L}${ultima}`, rules: [
      { ...contiene(c0, 'No apto', 'red'), stopIfTrue: true },
      { ...contiene(c0, 'observaciones', 'warn'), stopIfTrue: true },
      contiene(c0, 'Apto', 'green'),
    ] });
    const lista = cat.resultados.map(r => r.etiqueta);
    for (let r = primera; r <= ultima; r++) {
      ws.getCell(r, kRes).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${lista.join(',')}"`] };
    }
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: cab }];
  if (filas.length) ws.autoFilter = { from: { row: cab, column: 1 }, to: { row: cab, column: cols.length } };

  // ═════════ 2 · RESUMEN ═════════
  const wr = wb.addWorksheet('Resumen', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 } });
  wr.columns = [{ width: 44 }, { width: 16 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }];
  let f2 = E.bandaCabecera(wr, idLogo, 'Inspección de vehículos · resumen', sub, 7);
  const titulo = t => { const c = wr.getRow(f2++).getCell(1); c.value = t; c.font = { size: 11, bold: true, color: { argb: E.DARK } }; wr.getRow(f2 - 1).height = 22; };
  const cifra = (etq, valor, tono) => {
    const r = wr.getRow(f2++);
    r.getCell(1).value = etq; r.getCell(1).font = F; r.getCell(1).border = E.TODOS_BORDES;
    const c = r.getCell(2); c.value = valor; c.font = FB; c.alignment = { horizontal: 'right' }; c.border = E.TODOS_BORDES;
    if (tono && valor) { c.fill = E.relleno(COLORES[tono].bg); c.font = { size: 10, bold: true, color: { argb: COLORES[tono].fg } }; }
  };
  const itv = f => vence(f.itv_mes, f.itv_anio, hoy);
  const vtc = f => [vence(f.vtc_delantera_mes, f.vtc_delantera_anio, hoy), vence(f.vtc_trasera_mes, f.vtc_trasera_anio, hoy)];
  titulo('LA FLOTA');
  cifra('Coches en el listado', filas.length);
  cifra('Inspeccionados', inspeccionados.length, 'green');
  cifra('Pendientes de inspeccionar', filas.length - inspeccionados.length, 'warn');
  cifra('Sin ninguna incidencia', inspeccionados.filter(f => !fallosDe(f).length).length, 'green');
  cifra('Con algo que FALTA', inspeccionados.filter(f => fallosDe(f).some(x => x.estado === 'falta')).length, 'red');
  cifra('Con algo DETERIORADO', inspeccionados.filter(f => fallosDe(f).some(x => x.estado === 'deteriorado')).length, 'warn');
  cifra('No aptos', inspeccionados.filter(f => f.resultado === 'no_apto').length, 'red');
  f2++;
  titulo(`CADUCIDADES (a ${aEs(hoy)})`);
  cifra('ITV caducada', filas.filter(f => { const d = itv(f); return d != null && d < 0; }).length, 'red');
  cifra(`ITV en ${AVISO_DIAS} días`, filas.filter(f => { const d = itv(f); return d != null && d >= 0 && d <= AVISO_DIAS; }).length, 'warn');
  cifra('Alguna pegatina VTC caducada', filas.filter(f => vtc(f).some(d => d != null && d < 0)).length, 'red');
  cifra(`Alguna pegatina VTC en ${AVISO_DIAS} días`, filas.filter(f => vtc(f).some(d => d != null && d >= 0 && d <= AVISO_DIAS)).length, 'warn');
  f2++;
  titulo('ELEMENTO A ELEMENTO (cuenta la hoja «Inspección de vehículos»: si se corrige allí, cuadra aquí)');
  const cabR = ['Elemento', 'Grupo', '✓ Correcto', '! Deteriorado', '✗ Falta', '— No se requiere', 'Sin revisar'];
  E.cabeceraTabla(wr, f2, cabR);
  f2++;
  const hoja = `'Inspección de vehículos'`;
  elementos.forEach((e, i) => {
    const k = colEl[i];
    const rango = `${hoja}!$${E.colLetra(k)}$${primera}:$${E.colLetra(k)}$${ultima}`;
    const est = cod => filas.filter(f => ((f.elementos || []).find(x => x.elemento === e.codigo) || {}).estado === cod).length;
    const r = wr.getRow(f2);
    const vals = [
      e.etiqueta, e.grupo || '',
      { formula: `COUNTIF(${rango},"*Correcto*")`, result: est('correcto') },
      { formula: `COUNTIF(${rango},"*Deteriorado*")`, result: est('deteriorado') },
      { formula: `COUNTIF(${rango},"*Falta*")`, result: est('falta') },
      { formula: `COUNTIF(${rango},"*No se requiere*")`, result: est('no_aplica') },
      { formula: `COUNTBLANK(${rango})`, result: filas.length - est('correcto') - est('deteriorado') - est('falta') - est('no_aplica') },
    ];
    vals.forEach((v, j) => {
      const c = r.getCell(j + 1);
      c.value = v; c.border = E.TODOS_BORDES; c.font = j === 0 ? FB : F;
      c.alignment = j < 2 ? IZQ : { horizontal: 'center', vertical: 'middle' };
    });
    r.height = 18;
    f2++;
  });
  // Los ceros no se pintan; lo que hay, sí.
  const pr = f2 - elementos.length;
  [['C', 'green'], ['D', 'warn'], ['E', 'red']].forEach(([L, t]) => {
    wr.addConditionalFormatting({ ref: `${L}${pr}:${L}${f2 - 1}`, rules: [{ type: 'expression', formulae: [`${L}${pr}>0`],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLORES[t].bg } }, font: { color: { argb: COLORES[t].fg }, bold: true } } }] });
  });

  // ═════════ 3 · QUÉ HAY QUE REPONER ═════════
  const wp = wb.addWorksheet('Qué hay que reponer', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  wp.columns = [{ width: 13 }, { width: 22 }, { width: 50 }, { width: 40 }, { width: 22 }, { width: 40 }];
  let f3 = E.bandaCabecera(wp, idLogo, 'Qué hay que reponer', 'Los coches inspeccionados con algo que falta o está deteriorado · ' +
    `${aEs(hoy)}`, 6);
  E.cabeceraTabla(wp, f3, ['Matrícula', 'Vehículo', '✗ Falta', '! Deteriorado', 'Resultado', 'Observaciones']);
  wp.views = [{ state: 'frozen', ySplit: f3 }];
  f3++;
  const conFallos = inspeccionados.filter(f => fallosDe(f).length)
    .sort((a, b) => fallosDe(b).length - fallosDe(a).length || a.matricula.localeCompare(b.matricula));
  const nombreEl = c => (elementos.find(e => e.codigo === c) || {}).etiqueta || c;
  conFallos.forEach(f => {
    const r = wp.getRow(f3++);
    const falta = fallosDe(f).filter(x => x.estado === 'falta').map(x => nombreEl(x.elemento));
    const det = fallosDe(f).filter(x => x.estado === 'deteriorado').map(x => nombreEl(x.elemento));
    [f.matricula, [f.marca, f.modelo].filter(Boolean).join(' ') || f.marca_modelo || '', falta.join(', '), det.join(', '),
      (resultadoDe(f.resultado) || {}).etiqueta || '', f.observaciones || ''].forEach((v, j) => {
      const c = r.getCell(j + 1);
      c.value = v; c.border = E.TODOS_BORDES; c.alignment = IZQ;
      c.font = j === 0 ? { size: 11, bold: true, color: { argb: E.DARK } } : F;
      if (j === 2 && v) c.font = { size: 10, bold: true, color: { argb: COLORES.red.fg } };
      if (j === 3 && v) c.font = { size: 10, bold: true, color: { argb: COLORES.warn.fg } };
    });
    r.height = Math.max(20, 15 * Math.ceil(Math.max(falta.join(', ').length / 55, det.join(', ').length / 45, 1)));
  });
  if (!conFallos.length) { const c = wp.getRow(f3).getCell(1); c.value = 'Ningún coche inspeccionado tiene nada que reponer.'; c.font = TENUE; }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
