// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC — el Excel (módulo 5, 25/11/2026)
// ============================================================
// Lo mismo que el PDF, para trabajarlo: «Resumen» (quién, totales, qué es cada
// columna y de dónde sale), «Por día», «Por semana», «Por mes» y «Conexiones».
// Las horas van en horas decimales (para sumar) y en «h min» (para leer).
'use strict';

const ExcelJS = require('exceljs');
const est = require('../../services/excelEstilo');
const { hm, horas } = require('./informeJornada');

const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const FMT_FECHA_HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const FMT_HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
const fechaHora = ms => (ms == null ? '' : FMT_FECHA_HORA.format(new Date(ms)));
const hora = ms => (ms == null ? '' : FMT_HORA.format(new Date(ms)));

const GRUPO = [['Viaje (h)', 'viaje'], ['Espera en área (h)', 'esperaArea'], ['Espera no efectiva (h)', 'esperaFuera'], ['Descanso (h)', 'descanso'],
  ['Trabajo efectivo (h)', 'efectivo'], ['Tareas auxiliares (h)', 'aux'], ['Presencia (h)', 'presencia']];

/** Una hoja con banda, cabecera, filas y fila de total. */
function hoja(wb, logo, nombre, titulo, subtitulo, cabecera, filas, total, anchos) {
  const ws = wb.addWorksheet(nombre);
  let f = est.bandaCabecera(ws, logo, titulo, subtitulo, cabecera.length);
  est.cabeceraTabla(ws, f, cabecera, { ajustar: true, alto: 32 });
  ws.views = [{ state: 'frozen', ySplit: f }];
  f++;
  for (const fila of filas) { ws.getRow(f).values = fila; f++; }
  if (total) { const r = ws.getRow(f); r.values = total; r.font = { bold: true }; }
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cabecera.forEach((c, i) => { if (/\(h\)$/.test(c)) ws.getColumn(i + 1).numFmt = '0.00'; });
  return ws;
}

/** @returns {Promise<Buffer>} */
async function generar(d) {
  const { persona: p, rango, calculo: c, emitido } = d;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const logo = est.registrarLogo(wb);
  const sub = `${p.nombre} · del ${dmy(rango.desde)} al ${dmy(rango.hasta)} · emitido el ${fechaHora(Date.parse(emitido.cuando))}`;
  const g = x => GRUPO.map(([, k]) => horas(x[k]));
  const t = c.totales;

  // ── Resumen ──
  const ws = wb.addWorksheet('Resumen');
  let f = est.bandaCabecera(ws, logo, 'Informe de jornada', sub, 3);
  const linea = (a, b) => { ws.getRow(f).values = [a, b]; ws.getCell(f, 1).font = { bold: true }; f++; };
  linea('Trabajador', p.nombre_ss || p.nombre);
  linea('Documento', p.dni_nie || '');
  linea('Legajo (gestoría)', p.legajo || '');
  linea('Empleo', p.empleo ? `${p.empleo === 'ett' ? 'ETT' : 'Plantilla propia'}, alta el ${dmy(p.alta)}${p.baja ? `, baja el ${dmy(p.baja)}` : ''}` : '');
  linea('Periodo', `del ${dmy(rango.desde)} al ${dmy(rango.hasta)}, por días naturales`);
  linea('Emitido', `${fechaHora(Date.parse(emitido.cuando))}${emitido.por ? ` por ${emitido.por}` : ''}`);
  linea('Huella de las cifras (SHA-256)', d.huella);
  f++;
  linea('Trabajo efectivo', hm(t.efectivo));
  linea('Tareas auxiliares', hm(t.aux));
  linea('Efectivo con auxiliares', hm(t.efectivoConAux));
  linea('Espera no efectiva', hm(t.esperaFuera));
  linea('Presencia', hm(t.presencia));
  linea('Descanso', hm(t.descanso));
  linea('Días con actividad', t.diasConActividad);
  f++;
  [
    'Viaje: desde que acepta un servicio hasta que lo termina («has_order» de BOLT). Trabajo efectivo, art. 18.6.a (TE_A3).',
    'Espera en área: conectado y disponible, sin servicio, dentro del área (zonas de Mapon). Trabajo efectivo, art. 18.6.a (TE_A1).',
    'Espera no efectiva: conectado y disponible, sin servicio, fuera del área. No es trabajo efectivo, art. 18.7 (TE_NO).',
    'Descanso: conectado pero no disponible («busy»). No es trabajo efectivo.',
    'Trabajo efectivo = viaje + espera en área. Tareas auxiliares: 20 min el día con actividad, art. 18.6.c (TE_C).',
    'Presencia = trabajo efectivo + espera no efectiva (el «tiempo de conexión» del informe de BOLT). El descanso no es presencia.',
    d.hayZonas ? '' : 'IMPORTANTE: no hay zonas de Mapon con movimientos en el periodo: toda la espera figura como no efectiva.',
    `Origen: ${d.fuente.datos} Desde el ${dmy(d.fuente.desde)}.`, d.fuente.area, d.fuente.tope, d.fuente.dia,
    `Regla (cat_estado_te): ${d.regla.map(r => `${r.estado_bolt} = ${r.cuenta ? (r.condicionado ? `${r.supuesto_te} en área / ${r.supuesto_sin} fuera` : r.supuesto_te) : 'no cuenta'}`).join('; ')}.`,
  ].filter(Boolean).forEach(l => { ws.getRow(f).values = [l]; ws.mergeCells(f, 1, f, 3); ws.getCell(f, 1).alignment = { wrapText: true, vertical: 'top' }; ws.getRow(f).height = 30; f++; });
  ws.getColumn(1).width = 34; ws.getColumn(2).width = 70; ws.getColumn(3).width = 20;

  // ── Por día ──
  hoja(wb, logo, 'Por día', 'Por día', sub,
    ['Día', 'Primera conexión', 'Última desconexión', ...GRUPO.map(([e]) => e), 'Efectivo (h min)', 'Presencia (h min)'],
    c.dias.map(x => [dmy(x.dia), hora(x.primera), hora(x.ultima), ...g(x), hm(x.efectivo), hm(x.presencia)]),
    ['Total', '', '', ...g(t), hm(t.efectivo), hm(t.presencia)], [12, 12, 12, 11, 12, 13, 11, 13, 12, 11, 14, 14]);

  hoja(wb, logo, 'Por semana', 'Por semana (de lunes a domingo)', sub,
    ['Desde', 'Hasta', 'Días', ...GRUPO.map(([e]) => e)],
    c.semanas.map(s => [dmy(s.desde), dmy(s.hasta), s.dias, ...g(s)]),
    ['Total', '', t.diasConActividad, ...g(t)], [12, 12, 8, 11, 12, 13, 11, 13, 12, 11]);

  hoja(wb, logo, 'Por mes', 'Por mes', sub,
    ['Mes', 'Días', ...GRUPO.map(([e]) => e)],
    c.meses.map(m => [m.clave.split('-').reverse().join('/'), m.dias, ...g(m)]),
    ['Total', t.diasConActividad, ...g(t)], [12, 8, 11, 12, 13, 11, 13, 12, 11]);

  hoja(wb, logo, 'Conexiones', 'Conexiones (de la conexión a la desconexión)', sub,
    ['Conexión', 'Desconexión', 'Duración (h)', 'Viaje (h)', 'Espera en área (h)', 'Espera no efectiva (h)', 'Descanso (h)'],
    c.sesiones.map(s => [fechaHora(s.conexion), fechaHora(s.desconexion), horas(s.duracion), horas(s.viaje), horas(s.esperaArea), horas(s.esperaFuera), horas(s.descanso)]),
    null, [18, 18, 11, 11, 12, 13, 11]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
