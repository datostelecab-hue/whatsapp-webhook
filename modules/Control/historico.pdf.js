// ============================================================
// INFORME DE SALIDAS EN PDF — el histórico de un turno, para dirección
// ============================================================
// El Excel del histórico lo cuenta todo, persona a persona y llamada a llamada:
// es para trabajar. Esto es lo contrario (15/10/2026, sobre el modelo que pasó
// Control): una hoja que se lee en un minuto y dice cómo fue un turno. Arriba
// las cuatro cifras y una frase que las cuenta; debajo, los nombres agrupados
// por lo que pasó con cada uno, primero lo que hay que explicar:
//
//   · NO SALIERON SIN AVISAR   con lo que dijo la última llamada, o «sin llamar»
//   · NO SALDRÁN               los que avisaron, con su motivo
//   · COCHES SIN CONDUCTOR     plazas del plan que nadie cubría ese turno
//   · SALIERON                 nombre, hora de salida y coche, a dos columnas
//   · FUERA DEL PLAN           los que rodaron sin plaza
//   · LLAMADAS Y ALERTAS       quién llamó a cuántos, y qué alertas se atendieron
//
// Los datos son los de la pantalla y el Excel (historico.service.parte), así
// que los tres cuentan lo mismo. Se dibuja nativo con pdf-lib, como los demás
// PDF de la casa (asistencia, cascada de km, Sankey): cabecera oscura con el
// logo y el oro, en Helvetica. Las fuentes estándar no salen de WinAnsi, de ahí
// `L()`: los acentos y la ñ entran; las flechas y los emojis, no.

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', '..', 'public', 'assets', 'logo-128.png');
const EMPRESA = 'TIBUS LUXURY';

const C = {
  dark: rgb(0.12, 0.14, 0.19), gold: rgb(0.91, 0.72, 0.29), cabTexto: rgb(0.78, 0.80, 0.84),
  texto: rgb(0.16, 0.19, 0.24), suave: rgb(0.42, 0.45, 0.51), tenue: rgb(0.66, 0.69, 0.73),
  linea: rgb(0.86, 0.88, 0.91), franja: rgb(0.965, 0.968, 0.975), blanco: rgb(1, 1, 1),
  verde: rgb(0.09, 0.53, 0.34), verdeBg: rgb(0.91, 0.97, 0.93),
  ambar: rgb(0.78, 0.49, 0.02), ambarBg: rgb(0.995, 0.962, 0.88),
  rojo: rgb(0.78, 0.19, 0.21), rojoBg: rgb(0.99, 0.925, 0.925),
  gris: rgb(0.36, 0.39, 0.45), grisBg: rgb(0.945, 0.95, 0.96),
};

/** Los turnos que se pueden pedir y a quién recogen (TodoTurno va en los dos). */
const TURNOS = {
  dia: { etiqueta: 'Turno de día', horario: 'Turno de 05:00 a 17:00', incluye: ['dia', 'todoturno'] },
  noche: { etiqueta: 'Turno de noche', horario: 'Turno de 17:00 a 05:00', incluye: ['noche', 'todoturno'] },
  todo: { etiqueta: 'Día completo', horario: 'Jornada de 05:00 a 05:00, los dos turnos', incluye: ['dia', 'noche', 'todoturno'] },
};
const turnoValido = t => (TURNOS[t] ? t : 'todo');

// ── Texto ────────────────────────────────────────────────────────────────────

// Lo que WinAnsi sabe escribir fuera de Latin-1. Todo lo demás (flechas,
// emojis, saltos de línea) revienta la generación, así que se traduce o se va.
const WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const L = s => [...String(s == null ? '' : s)
  .replace(/[→⇒]/g, '->').replace(/←/g, '<-').replace(/\s/g, ' ')]
  .filter(ch => {
    const c = ch.codePointAt(0);
    return (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WINANSI.includes(ch);
  }).join('').replace(/ {2,}/g, ' ').trim();

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** '2026-10-14' → 'Miércoles 14 de octubre de 2026'. */
function fechaLarga(dia) {
  const d = new Date(Date.parse(dia + 'T12:00:00Z'));
  const t = `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const corta = dia => String(dia || '').split('-').reverse().join('/');
const sello = () => {
  const p = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { fecha: `${p.day}/${p.month}/${p.year}`, hora: `${p.hour}:${p.minute}` };
};
const n1 = v => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const hhmm = v => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
const ROL = { FIJO: 'Fijo', CT: 'Correturnos' };

// ── Lo que se cuenta (pura: la prueba scripts/comprobar-historico-pdf.js) ────

const SALIO = ['salio', 'conectado', 'descanso'];

/**
 * EL TURNO REPARTIDO EN GRUPOS, a partir del parte del día.
 *
 * Cada persona del plan cae en UN grupo: si salió, salió (aunque tuviera un
 * «No saldrá» puesto); si no, o avisó (No saldrá), o es una ausencia sin aviso,
 * o todavía no le tocaba (el informe se puede sacar con el turno en marcha).
 */
function resumen(parte, turno) {
  const T = turnoValido(turno);
  const incluye = TURNOS[T].incluye;
  const gente = (parte.conductores || []).filter(c => incluye.includes(c.turno));
  const salio = c => SALIO.includes(c.salida);
  const salieron = gente.filter(salio)
    .sort((a, b) => String(a.conductor).localeCompare(String(b.conductor), 'es'));
  const noSaldran = gente.filter(c => !salio(c) && c.noSale);
  const ausencias = gente.filter(c => !salio(c) && !c.noSale && c.salida === 'no_salio');
  const pendientes = gente.filter(c => !salio(c) && !c.noSale && c.salida !== 'no_salio');

  const sc = parte.sinConductor || {};
  const sinConductor = (T === 'todo' ? ['dia', 'noche'] : [T])
    .flatMap(t => (sc[t] || []).map(x => ({ ...x, turno: t })));

  // Los de fuera del plan: un NN tiene una fila por turno a propósito; en el
  // día completo se queda una por persona (la de más horas: las dos ventanas
  // se solapan y sumarlas contaría dos veces lo mismo).
  const nnTodas = (parte.sinPlan || []).filter(n => T === 'todo' || (n.turno || 'dia') === T);
  const nnPor = new Map();
  nnTodas.forEach(n => {
    const k = n.conductorId || n.conductor;
    const ya = nnPor.get(k);
    if (!ya || (n.horasBolt || 0) > (ya.horasBolt || 0)) nnPor.set(k, n);
  });
  const fueraDelPlan = [...nnPor.values()]
    .sort((a, b) => String(a.conductor).localeCompare(String(b.conductor), 'es'));

  // Las llamadas del turno: las de su gente y las de los de fuera del plan, una
  // vez cada una (quien dobla sale en los dos turnos con las mismas llamadas).
  const llamadas = new Map();
  [...gente, ...nnTodas].forEach(c => (c.llamadas || []).forEach(l => llamadas.set(l.id || `${c.conductorId}|${l.hora}`, l)));
  const porAgente = new Map();
  [...llamadas.values()].forEach(l => {
    const a = porAgente.get(l.agente) || { agente: l.agente, llamadas: 0, conductores: new Set(), respuestas: 0 };
    a.llamadas++;
    a.conductores.add(l.conductorId);
    a.respuestas += (l.alertas || []).length;
    porAgente.set(l.agente, a);
  });
  const agentes = [...porAgente.values()].map(a => ({ ...a, conductores: a.conductores.size }))
    .sort((x, y) => y.llamadas - x.llamadas);

  // Las alertas que saltaron (las rojas, las que piden llamada) y cuántas se atendieron.
  const porAlerta = new Map();
  gente.forEach(c => (c.alertas || []).filter(a => a.tono === 'error').forEach(a => {
    const x = porAlerta.get(a.codigo) || { codigo: a.codigo, nombre: a.nombre || a.codigo, n: 0, atendidas: 0 };
    x.n++;
    if (a.contestada) x.atendidas++;
    porAlerta.set(a.codigo, x);
  }));
  const alertas = [...porAlerta.values()].sort((a, b) => b.n - a.n);

  const js = gente.map(c => c.justificante).filter(Boolean);
  return {
    turno: T, dia: parte.dia,
    planificados: gente.length,
    salieron, noSaldran, ausencias, pendientes, sinConductor, fueraDelPlan,
    ausenciasLlamadas: ausencias.filter(c => (c.llamadas || []).length).length,
    llamadas: llamadas.size,
    llamados: new Set([...llamadas.values()].map(l => l.conductorId)).size,
    agentes, alertas,
    alertasTotal: alertas.reduce((s, a) => s + a.n, 0),
    alertasAtendidas: alertas.reduce((s, a) => s + a.atendidas, 0),
    jAprobadas: js.filter(j => j.estado === 'aprobada').length,
    horasJAprobadas: js.filter(j => j.estado === 'aprobada').reduce((s, j) => s + (Number(j.horas) || 0), 0),
    jPendientes: js.filter(j => j.estado === 'pendiente').length,
  };
}

/** La frase de arriba: las cifras contadas como se dirían en voz alta. */
function frase(r) {
  const partes = [`Salieron ${r.salieron.length} de ${pl(r.planificados, 'conductor planificado', 'conductores planificados')} (${pct(r.salieron.length, r.planificados)} %).`];
  if (r.noSaldran.length) partes.push(r.noSaldran.length === 1 ? '1 avisó de que no saldría.' : `${r.noSaldran.length} avisaron de que no saldrían.`);
  const n = r.ausencias.length;
  if (n) {
    const sinLlamar = n - r.ausenciasLlamadas;
    const llamada = sinLlamar === 0 ? (n === 1 ? 'Control le llamó' : 'Control les llamó a todos')
      : r.ausenciasLlamadas === 0 ? (n === 1 ? 'nadie le ha llamado' : 'nadie les ha llamado')
        : `${r.ausenciasLlamadas} con llamada de Control y ${sinLlamar} sin llamar`;
    partes.push(`${n === 1 ? '1 no salió' : `${n} no salieron`} sin avisar: ${llamada}.`);
  } else if (r.planificados) {
    partes.push('Nadie faltó sin avisar.');
  }
  const p = r.pendientes.length;
  if (p) partes.push(`A ${p} aún no ${p === 1 ? 'le' : 'les'} tocaba salir.`);
  if (r.sinConductor.length) partes.push(`${pl(r.sinConductor.length, 'coche del plan se quedó', 'coches del plan se quedaron')} sin conductor.`);
  return partes.join(' ');
}

// ── El dibujo ────────────────────────────────────────────────────────────────

/**
 * @param {Object} parte  lo que devuelve historico.service.parte(dia)
 * @param {{turno: 'dia'|'noche'|'todo'}} opciones
 * @returns {Promise<Buffer>}
 */
async function generar(parte, { turno } = {}) {
  const r = resumen(parte, turno);
  const TT = TURNOS[r.turno];
  const ahora = sello();

  const doc = await PDFDocument.create();
  doc.setTitle(`Informe de salidas - ${TT.etiqueta} - ${corta(r.dia)}`);
  doc.setAuthor(EMPRESA);
  doc.setCreator(`${EMPRESA} - Control y Tráfico`);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  let logo = null;
  if (fs.existsSync(LOGO)) { try { logo = await doc.embedPng(fs.readFileSync(LOGO)); } catch (e) { /* va sin logo */ } }

  const W = 595, H = 842, MX = 40, ANCHO = W - MX * 2, SUELO = 54;
  let pg = null, y = 0;
  let enCurso = null;             // la sección abierta, para repetir su título al saltar de página

  const ancho = (t, f, s) => f.widthOfTextAtSize(t, s);
  const texto = (t, x, yy, { f = reg, s = 9, c = C.texto } = {}) => {
    const v = L(t);
    if (v) pg.drawText(v, { x, y: yy, size: s, font: f, color: c });
    return v;
  };
  const derecha = (t, xd, yy, o = {}) => {
    const v = L(t);
    texto(v, xd - ancho(v, o.f || reg, o.s || 9), yy, o);
  };
  /** Recorta a lo que cabe, con puntos suspensivos. */
  const cabe = (t, f, s, max) => {
    let v = L(t);
    if (ancho(v, f, s) <= max) return v;
    while (v.length > 1 && ancho(v + '...', f, s) > max) v = v.slice(0, -1);
    return v.trimEnd() + '...';
  };
  /** Parte un texto en líneas que caben en `max`. */
  const partir = (t, f, s, max) => {
    const lineas = [];
    let linea = '';
    L(t).split(' ').filter(Boolean).forEach(p => {
      const prueba = linea ? linea + ' ' + p : p;
      if (ancho(prueba, f, s) <= max || !linea) linea = prueba;
      else { lineas.push(linea); linea = p; }
    });
    if (linea) lineas.push(linea);
    return lineas.map(x => cabe(x, f, s, max));
  };

  // ── Las páginas ──
  const nuevaPagina = primera => {
    pg = doc.addPage([W, H]);
    const alto = primera ? 66 : 38;
    pg.drawRectangle({ x: 0, y: H - alto, width: W, height: alto, color: C.dark });
    pg.drawRectangle({ x: 0, y: H - alto - 2.5, width: W, height: 2.5, color: C.gold });
    if (primera) {
      let xt = MX;
      if (logo) { pg.drawImage(logo, { x: MX - 4, y: H - 56, width: 46, height: 46 }); xt = MX + 52; }
      texto(EMPRESA, xt, H - 31, { f: bold, s: 15, c: C.gold });
      texto('Área de Control y Tráfico', xt, H - 47, { s: 9, c: C.cabTexto });
      derecha('INFORME DE SALIDAS', W - MX, H - 31, { f: bold, s: 8, c: C.cabTexto });
      derecha(corta(r.dia), W - MX, H - 47, { f: bold, s: 11, c: C.blanco });
      y = H - alto - 2.5;
    } else {
      if (logo) pg.drawImage(logo, { x: MX - 2, y: H - 32, width: 26, height: 26 });
      texto(`${EMPRESA}  ·  Informe de salidas  ·  ${TT.etiqueta}  ·  ${corta(r.dia)}`, MX + (logo ? 32 : 0), H - 23, { f: bold, s: 9, c: C.gold });
      y = H - alto - 2.5 - 8;
    }
  };
  /** Que quepa `alto`; si no, página nueva con el título de la sección repetido. */
  const asegura = alto => {
    if (y - alto >= SUELO) return;
    nuevaPagina(false);
    if (enCurso) cabeceraSeccion(enCurso, true);
  };
  const cabeceraSeccion = (s, sigue) => {
    y -= 20;
    const t = L(s.titulo + (sigue ? ' (sigue)' : ''));
    texto(t, MX, y, { f: bold, s: 10, c: C.texto });
    texto(String(s.n), MX + ancho(t, bold, 10) + 7, y, { f: bold, s: 10, c: s.color });
    if (s.nota && !sigue) derecha(s.nota, W - MX, y, { s: 7.5, c: C.suave });
    y -= 6;
    pg.drawLine({ start: { x: MX, y }, end: { x: W - MX, y }, thickness: 0.8, color: C.linea });
    y -= 2;
  };
  const seccion = (titulo, n, color, nota) => {
    enCurso = null;
    asegura(52);
    enCurso = { titulo, n, color, nota };
    cabeceraSeccion(enCurso, false);
  };
  const vacio = t => {
    asegura(16);
    y -= 13;
    texto(t, MX, y, { s: 8.5, c: C.suave });
  };

  /**
   * UNA PERSONA con su porqué: el nombre y lo que es a la izquierda, el coche a
   * la derecha y debajo las notas (la llamada, el motivo…), hasta tres líneas.
   */
  const fila = ({ nombre, extra, matricula, notas = [] }) => {
    const lineas = notas.flatMap(n => partir(n.t, n.f || reg, 8.3, ANCHO - 14).slice(0, 3)
      .map(t => ({ t, f: n.f || reg, c: n.c || C.suave })));
    asegura(15 + lineas.length * 10.5 + 5);
    y -= 13;
    const mat = L(matricula || '');
    const anchoMat = mat ? ancho(mat, mono, 8.5) + 12 : 0;
    const nom = cabe(nombre, bold, 9.3, ANCHO - anchoMat - 6);
    texto(nom, MX, y, { f: bold, s: 9.3 });
    if (extra) {
      const xe = MX + ancho(nom, bold, 9.3) + 7;
      texto(cabe(extra, reg, 7.8, W - MX - anchoMat - xe), xe, y, { s: 7.8, c: C.suave });
    }
    if (mat) derecha(mat, W - MX, y, { f: mono, s: 8.5 });
    lineas.forEach(l => { y -= 10.5; texto(l.t, MX + 10, y, { f: l.f, s: 8.3, c: l.c }); });
    y -= 5;
    pg.drawLine({ start: { x: MX, y }, end: { x: W - MX, y }, thickness: 0.4, color: C.linea });
  };

  /** UNA LISTA CORTA A DOS COLUMNAS (de arriba abajo y luego la de al lado). */
  const dosColumnas = (items, pinta) => {
    const ALTO = 13.5, HUECO = 22, COL = (ANCHO - HUECO) / 2;
    let i = 0;
    while (i < items.length) {
      asegura(ALTO + 4);
      const caben = Math.max(1, Math.floor((y - SUELO - 4) / ALTO));
      const resto = items.length - i;
      const porCol = Math.min(caben, Math.ceil(resto / 2));
      const tanda = items.slice(i, i + porCol * 2);
      const y0 = y;
      tanda.forEach((it, k) => {
        const col = k < porCol ? 0 : 1;
        const fy = y0 - ((col ? k - porCol : k) + 1) * ALTO + 3;
        if ((col ? k - porCol : k) % 2 === 1) {
          pg.drawRectangle({ x: MX + col * (COL + HUECO) - 3, y: fy - 3.5, width: COL + 6, height: ALTO, color: C.franja });
        }
        pinta(it, MX + col * (COL + HUECO), fy, COL);
      });
      y = y0 - porCol * ALTO - 4;
      i += tanda.length;
      if (i < items.length) { y = SUELO - 1; asegura(1); }
    }
  };

  // ════ Página 1 ════
  nuevaPagina(true);

  y -= 34;
  texto(`Informe de salidas · ${TT.etiqueta}`, MX, y, { f: bold, s: 19 });
  y -= 16;
  texto(`${fechaLarga(r.dia)}   |   ${TT.horario}   |   Generado el ${ahora.fecha} a las ${ahora.hora}`,
    MX, y, { s: 8.8, c: C.suave });

  // ── Las cuatro cifras ──
  const sinLlamar = r.ausencias.length - r.ausenciasLlamadas;
  const cifras = [
    { t: 'SALIERON', n: r.salieron.length, c: C.verde, bg: C.verdeBg,
      sub: r.planificados ? `${pct(r.salieron.length, r.planificados)} % de ${r.planificados} planificados` : 'nadie planificado' },
    { t: 'NO SALDRÁN', n: r.noSaldran.length, c: C.ambar, bg: C.ambarBg, sub: 'avisaron, con motivo' },
    { t: 'SIN AVISAR', n: r.ausencias.length, c: C.rojo, bg: C.rojoBg,
      sub: r.ausencias.length ? (sinLlamar ? `${sinLlamar} sin llamar` : 'todos llamados') : 'ninguna ausencia' },
    { t: 'SIN CONDUCTOR', n: r.sinConductor.length, c: C.gris, bg: C.grisBg, sub: 'coches del plan vacíos' },
  ];
  y -= 18;
  const HUECO = 10, TW = (ANCHO - HUECO * 3) / 4, TH = 62;
  cifras.forEach((k, i) => {
    const x = MX + i * (TW + HUECO);
    pg.drawRectangle({ x, y: y - TH, width: TW, height: TH, color: k.bg });
    pg.drawRectangle({ x, y: y - 2.2, width: TW, height: 2.2, color: k.c });
    texto(k.t, x + 10, y - 15, { f: bold, s: 7.3, c: C.suave });
    texto(String(k.n).padStart(2, '0'), x + 10, y - 41, { f: bold, s: 25, c: k.c });
    texto(cabe(k.sub, reg, 7.3, TW - 20), x + 10, y - 54, { s: 7.3, c: C.suave });
  });
  y -= TH;

  // La barra: el mismo reparto en una tira al 100 %.
  if (r.planificados) {
    y -= 9;
    const trozos = [
      [r.salieron.length, C.verde], [r.noSaldran.length, C.ambar],
      [r.ausencias.length, C.rojo], [r.pendientes.length, C.tenue],
    ];
    let x = MX;
    trozos.forEach(([n, c]) => {
      if (!n) return;
      const w = (n / r.planificados) * ANCHO;
      pg.drawRectangle({ x, y: y - 5, width: w, height: 5, color: c });
      x += w;
    });
    y -= 5;
  }

  // ── La frase ──
  y -= 8;
  partir(frase(r), reg, 10, ANCHO).forEach(l => { y -= 14; texto(l, MX, y, { s: 10 }); });

  // ── Lo que hizo Control ──
  y -= 14;
  const BH = 40;
  pg.drawRectangle({ x: MX, y: y - BH, width: ANCHO, height: BH, color: C.franja });
  const datos = [
    { t: 'LLAMADAS DE CONTROL', v: String(r.llamadas),
      sub: r.llamadas ? ['a ' + pl(r.llamados, 'conductor', 'conductores')] : ['ninguna apuntada'] },
    { t: 'ALERTAS', v: String(r.alertasTotal),
      sub: r.alertasTotal ? [pl(r.alertasAtendidas, 'atendida', 'atendidas'), `${r.alertasTotal - r.alertasAtendidas} sin atender`] : ['ninguna'] },
    { t: 'JUSTIFICACIONES', v: String(r.jAprobadas),
      sub: [`aprobadas, ${n1(r.horasJAprobadas)} h`, pl(r.jPendientes, 'pendiente', 'pendientes')] },
    { t: 'FUERA DEL PLAN', v: String(r.fueraDelPlan.length), sub: ['rodaron sin plaza'] },
  ];
  const DW = ANCHO / datos.length;
  datos.forEach((d, i) => {
    const x = MX + 12 + i * DW;
    const xs = x + ancho(L(d.v), bold, 14) + 6;
    texto(d.t, x, y - 13, { f: bold, s: 6.8, c: C.suave });
    texto(d.v, x, y - 31, { f: bold, s: 14 });
    d.sub.forEach((s, k) => texto(cabe(s, reg, 7.3, DW - 18 - (xs - x)), xs,
      d.sub.length === 1 ? y - 30 : y - 25 - k * 9, { s: 7.3, c: C.suave }));
  });
  y -= BH + 4;

  // ════ Los nombres ════
  const queEs = c => [ROL[c.rol] || '', c.cuadrante || '', r.turno === 'todo' || c.turno === 'todoturno' ? c.turnoEtiqueta : '']
    .filter(Boolean).join(' · ');
  const coches = c => (c.matriculas || []).join(' / ');
  const nombre = c => c.conductor || `Sin nombre en la ficha (n.º ${c.conductorId})`;

  // 1. NO SALIERON SIN AVISAR: lo que hay que explicar, con la última llamada.
  seccion('NO SALIERON SIN AVISAR', r.ausencias.length, C.rojo,
    r.ausencias.length ? `${r.ausenciasLlamadas} con llamada · ${sinLlamar} sin llamar` : '');
  if (!r.ausencias.length) vacio('Nadie del plan se quedó sin salir sin avisar.');
  r.ausencias.forEach(c => {
    const ll = c.llamadas || [];
    const u = ll[ll.length - 1];
    const notas = u
      ? [{ t: `Llamada ${u.hora} (${u.agente}): ${u.resultado || 'sin resultado'}${u.nota ? ' - ' + u.nota : ''}` +
          (ll.length > 1 ? `  ·  ${ll.length} llamadas ese día` : '') }]
      : [{ t: 'Sin llamada de Control', f: bold, c: C.rojo }];
    if (c.justificante) {
      const h = Number(c.justificante.horas) || 0;
      notas.push({ t: `Justificación ${c.justificante.estado === 'aprobada' ? 'aprobada' : 'pendiente'}` +
        (h ? `: ${n1(h)} h` : '') + (c.justificante.obs ? ' - ' + c.justificante.obs : '') });
    }
    fila({ nombre: nombre(c), extra: queEs(c), matricula: coches(c), notas });
  });

  // 2. NO SALDRÁN: avisaron, y con qué motivo.
  if (r.noSaldran.length) {
    seccion('NO SALDRÁN', r.noSaldran.length, C.ambar, 'avisaron a Control');
    r.noSaldran.forEach(c => {
      const ns = c.noSale || {};
      const quien = [ns.quien, ns.hora].filter(Boolean).join(', ');
      fila({ nombre: nombre(c), extra: queEs(c), matricula: coches(c),
        notas: [{ t: `${ns.etiqueta || 'No saldrá'}${ns.comentario ? ': ' + ns.comentario : ''}${quien ? `  (${quien})` : ''}` }] });
    });
  }

  // 3. AÚN NO LES TOCABA (solo si el informe se saca con el turno en marcha).
  if (r.pendientes.length) {
    seccion('AÚN NO LES TOCABA SALIR', r.pendientes.length, C.gris, 'turno sin empezar al generar');
    dosColumnas(r.pendientes, (c, x, fy, w) => {
      const mat = L(coches(c));
      texto(cabe(nombre(c), reg, 8.5, w - ancho(mat, mono, 8) - 10), x, fy, { s: 8.5 });
      derecha(mat, x + w, fy, { f: mono, s: 8 });
    });
  }

  // 4. COCHES SIN CONDUCTOR.
  if (r.sinConductor.length) {
    seccion('COCHES SIN CONDUCTOR', r.sinConductor.length, C.gris, 'plazas del plan que nadie cubría');
    dosColumnas(r.sinConductor, (k, x, fy, w) => {
      texto(k.matricula, x, fy, { f: mono, s: 8.5 });
      const det = [k.cuadrante, r.turno === 'todo' ? (k.turno === 'noche' ? 'noche' : 'día') : ''].filter(Boolean).join(' · ');
      derecha(cabe(det, reg, 8, w - 70), x + w, fy, { s: 8, c: C.suave });
    });
  }

  // 5. SALIERON: nombre, hora de la primera conexión y coche.
  seccion('SALIERON', r.salieron.length, C.verde, 'hora de la primera conexión y coche (+ si llevó más de uno)');
  if (!r.salieron.length) vacio('Nadie del plan salió en este turno.');
  dosColumnas(r.salieron, (c, x, fy, w) => {
    const mat = L((c.matriculas || [])[0] || '') + ((c.matriculas || []).length > 1 ? '+' : '');
    const hora = hhmm(c.primera);
    const dcha = ancho(mat, mono, 8) + (hora ? ancho(hora, reg, 7.8) + 8 : 0);
    texto(cabe(nombre(c), reg, 8.5, w - dcha - 10), x, fy, { s: 8.5 });
    derecha(mat, x + w, fy, { f: mono, s: 8 });
    if (hora) derecha(hora, x + w - ancho(mat, mono, 8) - 8, fy, { s: 7.8, c: C.suave });
  });

  // 6. FUERA DEL PLAN: rodaron sin tener plaza ese turno.
  if (r.fueraDelPlan.length) {
    seccion('RODARON FUERA DEL PLAN', r.fueraDelPlan.length, C.gris, 'horas en BOLT y coche');
    dosColumnas(r.fueraDelPlan, (n, x, fy, w) => {
      const mat = L((n.matriculas || [])[0] || '');
      const h = `${n1(n.horasBolt)} h`;
      const dcha = ancho(mat, mono, 8) + ancho(h, reg, 7.8) + 8;
      texto(cabe(n.conductor, reg, 8.5, w - dcha - 10), x, fy, { s: 8.5 });
      derecha(mat, x + w, fy, { f: mono, s: 8 });
      derecha(h, x + w - ancho(mat, mono, 8) - 8, fy, { s: 7.8, c: C.suave });
    });
  }

  // 7. LLAMADAS Y ALERTAS: quién hizo el trabajo y qué quedó sin atender.
  if (r.agentes.length || r.alertas.length) {
    seccion('LLAMADAS Y ALERTAS', r.llamadas, C.gold, 'quién llamó y qué alertas se atendieron');
    const filas = Math.max(r.agentes.length, r.alertas.length);
    const COL = (ANCHO - 22) / 2, X2 = MX + COL + 22;
    asegura(28);
    y -= 13;
    texto('Agente', MX, y, { f: bold, s: 7.3, c: C.suave });
    derecha('Llamadas', MX + COL - 60, y, { f: bold, s: 7.3, c: C.suave });
    derecha('Conductores', MX + COL, y, { f: bold, s: 7.3, c: C.suave });
    texto('Alerta', X2, y, { f: bold, s: 7.3, c: C.suave });
    derecha('Saltaron', X2 + COL - 60, y, { f: bold, s: 7.3, c: C.suave });
    derecha('Atendidas', X2 + COL, y, { f: bold, s: 7.3, c: C.suave });
    for (let i = 0; i < filas; i++) {
      asegura(14);
      y -= 13;
      const a = r.agentes[i], al = r.alertas[i];
      if (a) {
        texto(cabe(a.agente, reg, 8.5, COL - 130), MX, y, { s: 8.5 });
        derecha(String(a.llamadas), MX + COL - 60, y, { f: bold, s: 8.5 });
        derecha(String(a.conductores), MX + COL, y, { s: 8.5 });
      }
      if (al) {
        texto(cabe(al.nombre, reg, 8.5, COL - 130), X2, y, { s: 8.5 });
        derecha(String(al.n), X2 + COL - 60, y, { s: 8.5 });
        derecha(String(al.atendidas), X2 + COL, y, { f: bold, s: 8.5, c: al.atendidas < al.n ? C.rojo : C.verde });
      }
    }
  }

  // ── El pie de todas las páginas ──
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: MX, y: 36 }, end: { x: W - MX, y: 36 }, thickness: 0.5, color: C.linea });
    p.drawText(L('Fuente: planificador, BOLT y llamadas apuntadas en Control. Las horas que cuentan son las de BOLT más las justificaciones aprobadas.'),
      { x: MX, y: 24, size: 6.8, font: reg, color: C.suave });
    const pag = L(`Página ${i + 1} de ${paginas.length}`);
    p.drawText(pag, { x: W - MX - ancho(pag, bold, 6.8), y: 24, size: 6.8, font: bold, color: C.suave });
  });

  return Buffer.from(await doc.save());
}

module.exports = { generar, resumen, frase, TURNOS, L };
