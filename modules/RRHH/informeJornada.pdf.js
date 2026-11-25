// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC — el PDF (módulo 5, 25/11/2026)
// ============================================================
// A4 apaisado, con la cabecera de la casa. En este orden: quién y qué periodo,
// los totales, por mes, por semana, por día (con la primera conexión y la
// última desconexión), cada conexión, y al final qué es cada columna, de dónde
// sale cada dato y la huella. Para legal y los abogados.
'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');
const { hm } = require('./informeJornada');

const LOGO = path.join(__dirname, '..', '..', 'public', 'assets', 'logo-128.png');
const EMPRESA = 'TIBUS LUXURY';
const C = {
  dark: rgb(0.12, 0.14, 0.19), cab: rgb(0.22, 0.25, 0.31), gold: rgb(0.91, 0.72, 0.29),
  texto: rgb(0.16, 0.19, 0.24), suave: rgb(0.42, 0.45, 0.51), linea: rgb(0.85, 0.87, 0.90),
  franja: rgb(0.97, 0.97, 0.98), blanco: rgb(1, 1, 1), cabTexto: rgb(0.78, 0.80, 0.84), total: rgb(0.93, 0.94, 0.96),
};
// Las fuentes estándar del PDF no salen de Latin-1.
const SUST = { '→': '->', '–': '-', '—': '-', '·': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR', '≥': '>=' };
const L = s => String(s == null ? '' : s).replace(/[→–—·…“”‘’€≥]/g, c => SUST[c]).replace(/[^\x00-\xFF]/g, '').trim();

const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const FMT_HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
const FMT_FECHA_HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const hora = ms => (ms == null ? '' : FMT_HORA.format(new Date(ms)));
const fechaHora = ms => (ms == null ? '' : FMT_FECHA_HORA.format(new Date(ms)));
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaSemana = iso => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const h = seg => (seg ? hm(seg) : '-');

/** @returns {Promise<Buffer>} */
async function generar(d) {
  const { persona: p, rango, calculo: c, emitido } = d;
  const doc = await PDFDocument.create();
  doc.setTitle(L(`Informe de jornada - ${p.nombre} - ${dmy(rango.desde)} a ${dmy(rango.hasta)}`));
  doc.setCreator(EMPRESA);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  let logo = null;
  if (fs.existsSync(LOGO)) { try { logo = await doc.embedPng(fs.readFileSync(LOGO)); } catch (_) { /* sin logo */ } }

  const W = 842, H = 595, MX = 26, FILA = 12.5;
  let pg = null, y = 0;
  const paginas = [];
  const nuevaPagina = () => {
    pg = doc.addPage([W, H]); paginas.push(pg);
    pg.drawRectangle({ x: 0, y: H - 54, width: W, height: 54, color: C.dark });
    let xt = 22;
    if (logo) { pg.drawImage(logo, { x: 20, y: H - 47, width: 38, height: 38 }); xt = 68; }
    pg.drawText(L(`${EMPRESA}  -  Informe de jornada`), { x: xt, y: H - 24, size: 14, font: bold, color: C.gold });
    pg.drawText(L(`${p.nombre}  -  del ${dmy(rango.desde)} al ${dmy(rango.hasta)}`), { x: xt, y: H - 41, size: 9, font: reg, color: C.cabTexto });
    y = H - 72;
  };
  const sitio = alto => { if (y - alto < 40) nuevaPagina(); };
  const texto = (t, { size = 8.5, font = reg, color = C.texto, x = MX, ancho = W - MX * 2 } = {}) => {
    // Parte en líneas que quepan.
    const palabras = L(t).split(/\s+/);
    let linea = '';
    const lineas = [];
    for (const w of palabras) {
      const prueba = linea ? `${linea} ${w}` : w;
      if (font.widthOfTextAtSize(prueba, size) > ancho && linea) { lineas.push(linea); linea = w; } else linea = prueba;
    }
    if (linea) lineas.push(linea);
    for (const l of lineas) { sitio(size + 3); pg.drawText(l, { x, y: y - size, size, font, color }); y -= size + 3; }
  };
  const titulo = t => { sitio(40); y -= 8; pg.drawText(L(t), { x: MX, y: y - 11, size: 11, font: bold, color: C.dark }); y -= 18; };

  /** Una tabla con cabecera (que se repite al cambiar de página). `filas`: arrays de textos; `total`: la fila de abajo. */
  const tabla = (cols, filas, total = null) => {
    const anchoTotal = cols.reduce((s, x) => s + x.w, 0);
    const cabecera = () => {
      pg.drawRectangle({ x: MX, y: y - 15, width: anchoTotal, height: 16, color: C.cab });
      let x = MX;
      cols.forEach(col => {
        const t = L(col.t);
        const tx = col.al === 'd' ? x + col.w - 4 - bold.widthOfTextAtSize(t, 7) : x + 4;
        pg.drawText(t, { x: tx, y: y - 11, size: 7, font: bold, color: C.blanco });
        x += col.w;
      });
      y -= 16;
    };
    sitio(16 + FILA * 2); cabecera();
    const pinta = (f, i, esTotal) => {
      if (y - FILA < 40) { nuevaPagina(); cabecera(); }
      if (esTotal) pg.drawRectangle({ x: MX, y: y - FILA, width: anchoTotal, height: FILA, color: C.total });
      else if (i % 2) pg.drawRectangle({ x: MX, y: y - FILA, width: anchoTotal, height: FILA, color: C.franja });
      let x = MX;
      cols.forEach((col, k) => {
        const t = L(f[k]);
        const font = esTotal ? bold : reg;
        const tx = col.al === 'd' ? x + col.w - 4 - font.widthOfTextAtSize(t, 7.5) : x + 4;
        pg.drawText(t, { x: tx, y: y - 9, size: 7.5, font, color: C.texto });
        x += col.w;
      });
      y -= FILA;
    };
    filas.forEach((f, i) => pinta(f, i, false));
    if (total) pinta(total, 0, true);
    pg.drawLine({ start: { x: MX, y }, end: { x: MX + anchoTotal, y }, thickness: 0.5, color: C.linea });
    y -= 4;
  };

  nuevaPagina();

  // ── Quién y qué ──
  const t = c.totales;
  const empleo = p.empleo ? `${p.empleo === 'ett' ? 'ETT' : 'Plantilla propia'}, alta el ${dmy(p.alta)}${p.baja ? `, baja el ${dmy(p.baja)}` : ''}` : 'Sin periodo de empleo';
  [['Trabajador', p.nombre_ss || p.nombre], ['Documento', p.dni_nie || '-'], ['Legajo (gestoría)', p.legajo || '-'], ['Empleo', empleo],
    ['Cuentas de BOLT', p.cuentas.length ? `${p.cuentas.length}` : 'Ninguna: no hay horas que contar'],
    ['Periodo', `del ${dmy(rango.desde)} al ${dmy(rango.hasta)}, por días naturales`],
    ['Emitido', `${fechaHora(Date.parse(emitido.cuando))}${emitido.por ? ` por ${emitido.por}` : ''}`]]
    .forEach(([k, v]) => {
      sitio(12);
      pg.drawText(L(k), { x: MX, y: y - 9, size: 8.5, font: bold, color: C.suave });
      pg.drawText(L(v), { x: MX + 110, y: y - 9, size: 8.5, font: reg, color: C.texto });
      y -= 12;
    });

  titulo('Totales del periodo');
  tabla([{ t: 'Trabajo efectivo', w: 100, al: 'd' }, { t: 'Tareas auxiliares', w: 95, al: 'd' }, { t: 'Efectivo con auxiliares', w: 115, al: 'd' },
    { t: 'Espera no efectiva', w: 100, al: 'd' }, { t: 'Presencia', w: 95, al: 'd' }, { t: 'Descanso', w: 90, al: 'd' }, { t: 'Días con actividad', w: 95, al: 'd' }],
  [[h(t.efectivo), h(t.aux), h(t.efectivoConAux), h(t.esperaFuera), h(t.presencia), h(t.descanso), String(t.diasConActividad)]]);

  const colsGrupo = primera => [primera, { t: 'Viaje', w: 70, al: 'd' }, { t: 'Espera en área', w: 75, al: 'd' }, { t: 'Espera no efectiva', w: 85, al: 'd' },
    { t: 'Descanso', w: 70, al: 'd' }, { t: 'Efectivo', w: 70, al: 'd' }, { t: 'Auxiliares', w: 65, al: 'd' }, { t: 'Presencia', w: 70, al: 'd' }];
  const filaGrupo = (et, g) => [et, h(g.viaje), h(g.esperaArea), h(g.esperaFuera), h(g.descanso), h(g.efectivo), h(g.aux), h(g.presencia)];

  titulo('Por mes');
  tabla([...colsGrupo({ t: 'Mes', w: 110 }), { t: 'Días', w: 40, al: 'd' }],
    c.meses.map(m => [...filaGrupo(m.clave.split('-').reverse().join('/'), m), String(m.dias)]),
    [...filaGrupo('Total', t), String(t.diasConActividad)]);

  titulo('Por semana (de lunes a domingo)');
  tabla([...colsGrupo({ t: 'Semana', w: 150 }), { t: 'Días', w: 40, al: 'd' }],
    c.semanas.map(s => [...filaGrupo(`${dmy(s.desde)} - ${dmy(s.hasta)}`, s), String(s.dias)]),
    [...filaGrupo('Total', t), String(t.diasConActividad)]);

  titulo('Por día');
  tabla([{ t: 'Día', w: 105 }, { t: '1.ª conexión', w: 58, al: 'd' }, { t: 'Últ. desconexión', w: 70, al: 'd' }, ...colsGrupo({ t: '', w: 0 }).slice(1)],
    c.dias.map(f => [`${diaSemana(f.dia)} ${dmy(f.dia)}`, hora(f.primera), hora(f.ultima), ...filaGrupo('', f).slice(1)]),
    ['Total', '', '', ...filaGrupo('', t).slice(1)]);

  titulo('Conexiones (de la conexión a la desconexión, seguidas)');
  if (!c.sesiones.length) texto('Ninguna en el periodo.');
  else {
    tabla([{ t: 'Conexión', w: 105 }, { t: 'Desconexión', w: 105 }, { t: 'Duración', w: 75, al: 'd' }, { t: 'Viaje', w: 70, al: 'd' },
      { t: 'Espera en área', w: 75, al: 'd' }, { t: 'Espera no efectiva', w: 85, al: 'd' }, { t: 'Descanso', w: 70, al: 'd' }],
    c.sesiones.map(s => [fechaHora(s.conexion), fechaHora(s.desconexion), h(s.duracion), h(s.viaje), h(s.esperaArea), h(s.esperaFuera), h(s.descanso)]));
  }

  // ── Qué es cada cosa y de dónde sale ──
  titulo('Qué es cada columna (convenio colectivo VTC de la Comunidad de Madrid)');
  [
    'Viaje: desde que acepta un servicio hasta que lo termina (estado «has_order» de BOLT). Trabajo efectivo, art. 18.6.a (TE_A3).',
    'Espera en área: conectado y disponible, sin servicio, dentro del área (zonas de Mapon). Trabajo efectivo, art. 18.6.a (TE_A1).',
    'Espera no efectiva: conectado y disponible, sin servicio, fuera del área. No es trabajo efectivo, art. 18.7 (TE_NO).',
    'Descanso: conectado pero no disponible para la plataforma (estado «busy»). No es trabajo efectivo. Incluye, si lo hubiera, algún estado de BOLT sin clasificar.',
    'Trabajo efectivo = viaje + espera en área. Tareas auxiliares: 20 minutos el día que hubo actividad, art. 18.6.c (TE_C).',
    'Presencia = trabajo efectivo + espera no efectiva: el tiempo conectado y disponible para la plataforma (es el «tiempo de conexión» del informe de BOLT). El descanso no es presencia.',
    d.hayZonas ? '' : 'IMPORTANTE: en el periodo no hay zonas de Mapon con movimientos registrados, así que no consta ninguna espera dentro del área: toda la espera figura como no efectiva.',
  ].filter(Boolean).forEach(l => texto(`- ${l}`));
  titulo('Origen de los datos');
  [d.fuente.datos, `Datos disponibles desde el ${dmy(d.fuente.desde)}.`, d.fuente.area, d.fuente.tope, d.fuente.dia,
    `Regla aplicada (tabla cat_estado_te): ${d.regla.map(r => `${r.estado_bolt} = ${r.cuenta ? (r.condicionado ? `${r.supuesto_te} en área / ${r.supuesto_sin} fuera` : r.supuesto_te) : 'no cuenta'}`).join('; ')}.`,
    'Si dos cuentas de la persona estuvieron conectadas a la vez, cada minuto cuenta una sola vez, con el estado de más trabajo (viaje, después espera, después descanso).',
    `Huella de las cifras (SHA-256): ${d.huella}. El mismo informe de las mismas fechas, emitido otra vez con los mismos datos, da la misma huella.`,
  ].forEach(l => texto(`- ${l}`));

  // Pie con la página.
  paginas.forEach((pp, i) => {
    pp.drawText(L(`${EMPRESA} - Informe de jornada de ${p.nombre} - emitido el ${fechaHora(Date.parse(emitido.cuando))} - página ${i + 1} de ${paginas.length}`),
      { x: MX, y: 20, size: 7, font: reg, color: C.suave });
  });
  return Buffer.from(await doc.save());
}

module.exports = { generar };
