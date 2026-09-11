// ============================================================
// EXCEL DEL HISTÓRICO DE CONTROL — el porqué de los horarios
// ============================================================
// Seis hojas, y cada una contesta una pregunta que hoy se contesta de memoria:
//
//   1. Resumen      — cómo fue el día en diez números, con las alertas por tipo
//                     y las llamadas por agente.
//   2. Conductores  — persona a persona: si salió, cuántas horas hizo, cuántas
//                     le cuentan de verdad y qué alertas levantó.
//   3. Llamadas     — una fila por llamada: quién llamó, a quién, a qué hora y
//                     qué contestó. Es el "sí lo llamé" con fecha y hora.
//   4. Alertas      — una fila por alerta, con el comentario de la llamada al
//                     lado. Lo que queda SIN comentario es lo que falta por
//                     hacer, y se ve de un vistazo.
//   5. Justificantes— las J del día con su estado: presunta, aprobada o
//                     rechazada, con el motivo del rechazo y quién lo firmó.
//   6. Sin plan     — los que rodaron sin que les tocara.
//
// Varios días se apilan en las mismas hojas con la fecha delante: así el mes
// entero se filtra y se suma en una tabla dinámica sin pegar seis ficheros.

const ExcelJS = require('exceljs');
const E = require('./excelEstilo');

const esFecha = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// Un estado, un color y una palabra: lo que se lee antes que el número.
const TONO_SALIDA = {
  no_salio: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  salio: { bg: 'FFD1FAE5', fg: 'FF065F46' },
  conectado: { bg: 'FFD1FAE5', fg: 'FF065F46' },
  descanso: { bg: 'FFFEF3C7', fg: 'FF92400E' },
  pendiente: { bg: 'FFF3F4F6', fg: 'FF6B7280' },
};
const TONO_J = {
  aprobada: { bg: 'FFD1FAE5', fg: 'FF065F46' },
  pendiente: { bg: 'FFDBEAFE', fg: 'FF1E40AF' },   // azul: presunta, como en pantalla
  rechazada: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
};
const SI_NO = { si: { bg: 'FFD1FAE5', fg: 'FF065F46' }, no: { bg: 'FFFEE2E2', fg: 'FF991B1B' } };

const TURNO = { dia: 'Día', noche: 'Noche', todoturno: 'TodoTurno' };

/** Una hoja declarativa: banda, cabecera, filas, filtro y panel congelado. */
function hoja(wb, idLogo, nombre, titulo, subtitulo, cols, filas, vacio) {
  const ws = wb.addWorksheet(nombre, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = cols.map(c => ({ width: c.ancho }));
  const filaCab = E.bandaCabecera(ws, idLogo, titulo, subtitulo, cols.length);
  let f = E.cabeceraTabla(ws, filaCab, cols.map(c => c.titulo));
  ws.views = [{ state: 'frozen', xSplit: cols.filter(c => c.fija).length, ySplit: filaCab }];

  filas.forEach(d => {
    const r = ws.getRow(f++);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      const v = c.valor(d);
      cel.value = v === undefined || v === null ? '' : v;
      cel.border = E.TODOS_BORDES;
      cel.font = { size: 10, color: { argb: E.TEXTO } };
      cel.alignment = { vertical: 'top', horizontal: c.al || 'left', wrapText: !!c.parrafo };
      if (c.formato) cel.numFmt = c.formato;
      const t = c.tono && c.tono(d);
      if (t) { cel.fill = E.relleno(t.bg); cel.font = { size: 10, bold: !!c.fuerte, color: { argb: t.fg } }; }
    });
    r.height = 17;
  });

  if (!filas.length) {
    const c = ws.getRow(f).getCell(1);
    c.value = vacio || 'Sin datos.';
    c.font = { size: 10, italic: true, color: { argb: E.TENUE } };
  } else {
    ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
  }
  return ws;
}

/** La columna de fecha que abre todas las hojas cuando el informe es de varios días. */
const colFecha = varios => (varios
  ? [{ titulo: 'Fecha', ancho: 11, al: 'center', fija: true, valor: d => esFecha(d.dia) }]
  : []);

/**
 * @param {object[]} partes uno o varios partes de repo/historicoControl
 */
async function generar(partes) {
  const dias = partes.map(p => p.dia);
  const varios = dias.length > 1;
  const rango = varios ? `${esFecha(dias[0])} – ${esFecha(dias[dias.length - 1])}` : esFecha(dias[0]);
  const pie = `Jornada operativa 05:00 → 05:00 · generado ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab ERP';
  const idLogo = E.registrarLogo(wb);

  // Se aplana todo una vez, con la fecha pegada a cada fila.
  const conductores = partes.flatMap(p => p.conductores.map(c => ({ ...c, dia: p.dia })));
  const llamadas = partes.flatMap(p => [...p.conductores, ...p.sinPlan]
    .flatMap(c => (c.llamadas || []).map(l => ({ ...l, dia: p.dia, conductor: c.conductor, telefono: c.telefono }))));
  const alertas = partes.flatMap(p => [...p.conductores, ...p.sinPlan]
    .flatMap(c => (c.alertas || []).map(a => ({ ...a, dia: p.dia, conductor: c.conductor,
      telefono: c.telefono, turno: c.turno, salida: c.salida, salidaEtiqueta: c.salidaEtiqueta || 'Fuera del plan' }))));
  const justis = partes.flatMap(p => p.conductores.flatMap(c => {
    const out = [];
    if (c.justificante) out.push({ ...c.justificante, dia: p.dia, conductor: c.conductor, estado: c.justificante.estado });
    (c.jRechazadas || []).forEach(r => out.push({ ...r, dia: p.dia, conductor: c.conductor, estado: 'rechazada' }));
    return out;
  }));
  const sinPlan = partes.flatMap(p => p.sinPlan.map(n => ({ ...n, dia: p.dia })));

  // ── 1. RESUMEN ──────────────────────────────────────────────────────────
  // Tres bloques en una hoja: el día en números, las alertas y los agentes.
  const ws = wb.addWorksheet('Resumen', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 44 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }];
  let f = E.bandaCabecera(ws, idLogo, 'Control · Histórico', `${rango} · ${pie}`, 5);

  const titulo = texto => {
    const c = ws.getRow(f).getCell(1);
    c.value = texto;
    c.font = { size: 11, bold: true, color: { argb: E.DARK } };
    ws.getRow(f).height = 20;
    f += 1;
  };
  const linea = (etq, valor, tono) => {
    const r = ws.getRow(f++);
    const a = r.getCell(1); a.value = etq;
    a.font = { size: 10, color: { argb: E.TEXTO } }; a.border = E.TODOS_BORDES;
    const b = r.getCell(2); b.value = valor;
    b.font = { size: 10, bold: true, color: { argb: tono ? tono.fg : E.TEXTO } };
    b.alignment = { horizontal: 'center' }; b.border = E.TODOS_BORDES;
    if (tono) b.fill = E.relleno(tono.bg);
  };

  const T = partes.reduce((a, p) => {
    Object.entries(p.resumen).forEach(([k, v]) => { a[k] = (a[k] || 0) + v; });
    return a;
  }, {});
  titulo('EL DÍA');
  linea('Conductores con plaza en el cuadrante', T.conductores);
  linea('NO SALIÓ', T.noSalieron, T.noSalieron ? SI_NO.no : null);
  linea('Con alguna alerta', T.conAlerta);
  linea('Con alertas SIN comentario de llamada', T.sinAtender, T.sinAtender ? SI_NO.no : SI_NO.si);
  linea('Rodaron sin estar en el plan (NN)', sinPlan.length);
  f += 1;
  titulo('LAS LLAMADAS');
  linea('Llamadas apuntadas', T.llamadas);
  linea('Conductores llamados', T.llamados);
  linea('Respuestas apuntadas alerta por alerta', T.respuestasPorAlerta);
  f += 1;
  titulo('LAS HORAS JUSTIFICADAS');
  linea('J aprobadas (las únicas que cuentan)', T.jAprobadas, TONO_J.aprobada);
  linea('Horas aprobadas', Math.round(T.horasJAprobadas * 10) / 10, TONO_J.aprobada);
  linea('J pendientes (horas presuntas)', T.jPendientes, TONO_J.pendiente);
  linea('Horas presuntas', Math.round(T.horasJPendientes * 10) / 10, TONO_J.pendiente);
  linea('J rechazadas', T.jRechazadas, T.jRechazadas ? TONO_J.rechazada : null);
  f += 2;

  // Alertas por tipo, sumando todos los días del informe.
  const porTipo = {};
  partes.forEach(p => p.alertas.forEach(a => {
    const x = porTipo[a.codigo] || (porTipo[a.codigo] = { ...a, n: 0, contestadas: 0 });
    x.n += a.n; x.contestadas += a.contestadas;
  }));
  titulo('LAS ALERTAS, POR TIPO');
  f = E.cabeceraTabla(ws, f, ['Alerta', 'Veces', 'Con comentario', 'Sin comentario', '% atendidas']);
  Object.values(porTipo).sort((a, b) => b.n - a.n).forEach(a => {
    const r = ws.getRow(f++);
    const pct = a.n ? a.contestadas / a.n : 0;
    [a.etiqueta, a.n, a.contestadas, a.n - a.contestadas, pct].forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.border = E.TODOS_BORDES;
      c.font = { size: 10, color: { argb: E.TEXTO } };
      c.alignment = { vertical: 'middle', horizontal: i ? 'center' : 'left' };
      if (i === 4) { c.numFmt = '0%'; c.fill = E.relleno(pct >= 0.999 ? SI_NO.si.bg : SI_NO.no.bg); }
    });
  });
  f += 2;

  const agentes = {};
  partes.forEach(p => p.agentes.forEach(a => {
    const x = agentes[a.agente] || (agentes[a.agente] = { agente: a.agente, llamadas: 0, conductores: 0, alertasContestadas: 0 });
    x.llamadas += a.llamadas; x.conductores += a.conductores; x.alertasContestadas += a.alertasContestadas;
  }));
  titulo('LAS LLAMADAS, POR AGENTE');
  f = E.cabeceraTabla(ws, f, ['Agente', 'Llamadas', 'Conductores', 'Alertas resueltas', '']);
  Object.values(agentes).sort((a, b) => b.llamadas - a.llamadas).forEach(a => {
    const r = ws.getRow(f++);
    [a.agente, a.llamadas, a.conductores, a.alertasContestadas, ''].forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.border = E.TODOS_BORDES;
      c.font = { size: 10, color: { argb: E.TEXTO } };
      c.alignment = { vertical: 'middle', horizontal: i ? 'center' : 'left' };
    });
  });

  // ── 2. CONDUCTORES ──────────────────────────────────────────────────────
  hoja(wb, idLogo, 'Conductores', 'Control · Conductores del plan', `${rango} · ${pie}`, [
    ...colFecha(varios),
    { titulo: 'Conductor', ancho: 30, fija: true, valor: d => d.conductor },
    { titulo: 'Teléfono', ancho: 14, al: 'center', valor: d => d.telefono },
    { titulo: 'Turno', ancho: 11, al: 'center', valor: d => TURNO[d.turno] || d.turno },
    { titulo: 'Cuadrante', ancho: 11, al: 'center', valor: d => d.cuadrante },
    { titulo: 'Coche', ancho: 16, al: 'center', valor: d => (d.matriculas || []).join(', ') },
    { titulo: '¿Salió?', ancho: 15, al: 'center', fuerte: true,
      valor: d => d.salidaEtiqueta, tono: d => TONO_SALIDA[d.salida] },
    { titulo: '1.ª conexión', ancho: 12, al: 'center', valor: d => d.primera || '' },
    { titulo: 'h BOLT', ancho: 9, al: 'center', formato: '0.0', valor: d => d.horasBolt },
    { titulo: 'h que cuentan', ancho: 13, al: 'center', formato: '0.0', fuerte: true,
      valor: d => d.horasFirmes,
      tono: d => (d.horasFirmes >= 8 ? TONO_J.aprobada : d.horasFirmes < 6 ? TONO_J.rechazada : null) },
    { titulo: 'h con presuntas', ancho: 14, al: 'center', formato: '0.0',
      valor: d => d.horasPresuntas,
      tono: d => (d.horasPresuntas > d.horasFirmes ? TONO_J.pendiente : null) },
    { titulo: 'J', ancho: 11, al: 'center',
      valor: d => (d.justificante ? d.justificante.estado : ((d.jRechazadas || []).length ? 'rechazada' : '')),
      tono: d => TONO_J[d.justificante ? d.justificante.estado : ((d.jRechazadas || []).length ? 'rechazada' : '')] },
    { titulo: 'Km', ancho: 9, al: 'center', formato: '0.0', valor: d => d.km },
    { titulo: 'Km fuera app', ancho: 12, al: 'center', formato: '0.0', valor: d => d.kmFuera },
    { titulo: 'Ofertas', ancho: 9, al: 'center', valor: d => (d.rechazos ? d.rechazos.ofertas : '') },
    { titulo: 'Rechazó', ancho: 9, al: 'center',
      valor: d => (d.rechazos ? d.rechazos.rechazados : ''),
      tono: d => (d.rechazos && d.rechazos.rechazados ? SI_NO.no : null) },
    { titulo: 'Sin contestar', ancho: 12, al: 'center', valor: d => (d.rechazos ? d.rechazos.sinResponder : '') },
    { titulo: '% aceptados', ancho: 11, al: 'center', formato: '0%',
      valor: d => (d.rechazos && d.rechazos.tasa != null ? d.rechazos.tasa / 100 : ''),
      tono: d => (d.rechazos && d.rechazos.tasa != null
        ? (d.rechazos.tasa >= 80 ? SI_NO.si : d.rechazos.tasa < 60 ? SI_NO.no : TONO_SALIDA.descanso) : null) },
    { titulo: 'Alertas', ancho: 9, al: 'center', fuerte: true,
      valor: d => d.alertas.length || '',
      tono: d => (d.alertas.some(a => a.tono === 'error' && !a.contestada) ? SI_NO.no
        : d.alertas.length ? SI_NO.si : null) },
    { titulo: 'Qué alertas', ancho: 46, parrafo: true,
      valor: d => d.alertas.map(a => a.nombre).join(' · ') },
    { titulo: 'Llamadas', ancho: 9, al: 'center', valor: d => d.llamadas.length || '' },
    { titulo: 'Qué se le dijo', ancho: 60, parrafo: true,
      valor: d => d.llamadas.map(l => `${l.hora} ${l.agente}: ${l.resultado || l.tipo || '—'}` +
        (l.nota ? ` (${l.nota})` : '')).join(' | ') },
  ], conductores, 'No hay cuadrante para estos días.');

  // ── 3. LLAMADAS ─────────────────────────────────────────────────────────
  hoja(wb, idLogo, 'Llamadas', 'Control · Llamadas de seguimiento', `${rango} · ${pie}`, [
    ...colFecha(varios),
    { titulo: 'Hora', ancho: 8, al: 'center', fija: true, valor: d => d.hora },
    { titulo: 'Agente', ancho: 18, fija: true, valor: d => d.agente },
    { titulo: 'Conductor', ancho: 30, valor: d => d.conductor },
    { titulo: 'Teléfono', ancho: 14, al: 'center', valor: d => d.telefono },
    { titulo: 'Turno', ancho: 10, al: 'center', valor: d => TURNO[d.turno] || d.turno },
    { titulo: 'Tipo', ancho: 13, al: 'center', valor: d => d.tipo || 'seguimiento' },
    { titulo: 'Qué pasó', ancho: 30, valor: d => d.resultado },
    { titulo: 'Observaciones', ancho: 55, parrafo: true, valor: d => d.nota },
    { titulo: 'Respuestas por alerta', ancho: 60, parrafo: true,
      valor: d => (d.alertas || []).map(a => `${a.etiqueta || a.alerta}: ${a.comentario}`).join(' | ') },
    { titulo: 'Desde', ancho: 12, al: 'center', valor: d => d.origen },
  ], llamadas, 'No se apuntó ninguna llamada.');

  // ── 4. ALERTAS ──────────────────────────────────────────────────────────
  hoja(wb, idLogo, 'Alertas', 'Control · Alertas y qué se contestó', `${rango} · ${pie}`, [
    ...colFecha(varios),
    { titulo: 'Conductor', ancho: 30, fija: true, valor: d => d.conductor },
    { titulo: 'Teléfono', ancho: 14, al: 'center', valor: d => d.telefono },
    { titulo: 'Turno', ancho: 11, al: 'center', valor: d => TURNO[d.turno] || d.turno },
    { titulo: '¿Salió?', ancho: 15, al: 'center', valor: d => d.salidaEtiqueta, tono: d => TONO_SALIDA[d.salida] },
    { titulo: 'Alerta', ancho: 30, fuerte: true, valor: d => d.nombre },
    { titulo: 'Franja', ancho: 10, al: 'center', valor: d => (d.franja === 'manana' ? 'Mañana' : d.franja === 'noche' ? 'Noche' : 'Jornada') },
    { titulo: 'Dato', ancho: 26, valor: d => d.etiqueta },
    { titulo: 'Qué dice el sistema', ancho: 60, parrafo: true, valor: d => d.detalle },
    { titulo: '¿Se llamó?', ancho: 11, al: 'center', fuerte: true,
      valor: d => (d.contestada ? 'SÍ' : 'NO'), tono: d => (d.contestada ? SI_NO.si : SI_NO.no) },
    { titulo: 'Quién llamó', ancho: 18, valor: d => d.respuestas.map(r => r.agente).join(', ') },
    { titulo: 'Hora', ancho: 8, al: 'center', valor: d => d.respuestas.map(r => r.hora).join(', ') },
    { titulo: 'Qué contestó', ancho: 60, parrafo: true,
      valor: d => d.respuestas.map(r => r.comentario).join(' | ') },
  ], alertas, 'Ningún conductor levantó alertas.');

  // ── 5. JUSTIFICANTES ────────────────────────────────────────────────────
  hoja(wb, idLogo, 'Justificantes', 'Control · Horas justificadas', `${rango} · ${pie}`, [
    ...colFecha(varios),
    { titulo: 'Conductor', ancho: 30, fija: true, valor: d => d.conductor },
    { titulo: 'Horas', ancho: 9, al: 'center', formato: '0.0', valor: d => d.horas },
    { titulo: 'Estado', ancho: 13, al: 'center', fuerte: true,
      valor: d => ({ aprobada: 'Aprobada', pendiente: 'Presunta', rechazada: 'Rechazada' })[d.estado] || d.estado,
      tono: d => TONO_J[d.estado] },
    { titulo: '¿Cuenta?', ancho: 10, al: 'center',
      valor: d => (d.estado === 'aprobada' ? 'SÍ' : 'NO'),
      tono: d => (d.estado === 'aprobada' ? SI_NO.si : SI_NO.no) },
    { titulo: 'Tipo', ancho: 16, al: 'center', valor: d => d.tipo },
    { titulo: 'Motivo que dio', ancho: 60, parrafo: true, valor: d => d.obs },
    { titulo: 'La pidió', ancho: 18, valor: d => d.quien },
    { titulo: 'La firmó', ancho: 18, valor: d => d.aprobadaPor || d.porQuien || '' },
    { titulo: 'Por qué se rechazó', ancho: 50, parrafo: true, valor: d => d.motivo || '' },
  ], justis, 'No se pidió ninguna justificación de horas.');

  // ── 6. SIN PLAN ─────────────────────────────────────────────────────────
  hoja(wb, idLogo, 'Sin plan', 'Control · Rodaron sin estar en el cuadrante', `${rango} · ${pie}`, [
    ...colFecha(varios),
    { titulo: 'Conductor', ancho: 30, fija: true, valor: d => d.conductor },
    { titulo: 'Teléfono', ancho: 14, al: 'center', valor: d => d.telefono },
    { titulo: 'Turno', ancho: 10, al: 'center', valor: d => d.turnoEtiqueta || TURNO[d.turno] || d.turno },
    { titulo: 'Por qué no estaba', ancho: 28, valor: d => d.situacion },
    { titulo: 'Coche', ancho: 16, al: 'center', valor: d => (d.matriculas || []).join(', ') },
    { titulo: 'Horas', ancho: 9, al: 'center', formato: '0.0', valor: d => d.horasBolt },
    { titulo: 'Km en BOLT', ancho: 11, al: 'center', formato: '0.0', valor: d => d.km },
    { titulo: 'Km fuera app', ancho: 12, al: 'center', formato: '0.0', valor: d => d.kmFuera },
    { titulo: 'Alertas', ancho: 40, parrafo: true, valor: d => d.alertas.map(a => a.nombre).join(' · ') },
    { titulo: 'Llamadas', ancho: 60, parrafo: true,
      valor: d => d.llamadas.map(l => `${l.hora} ${l.agente}: ${l.resultado || l.tipo || '—'}` +
        (l.nota ? ` (${l.nota})` : '')).join(' | ') },
  ], sinPlan, 'Todo el mundo salió donde le tocaba.');

  return wb.xlsx.writeBuffer();
}

module.exports = { generar };
