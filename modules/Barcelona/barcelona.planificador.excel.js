// ============================================================
// EXCEL DEL PLANIFICADOR DE BARCELONA (sustituye a «Imprimir»)
// ============================================================
// Camilo, 06/11/2026: «Arregla de una vez la impresión del planificador,
// perdona, no era imprimir sino exportar en excel … de una vez actualiza el
// excel y elimina lo de "imprimir", no necesitamos eso en PDF sino en excel».
// Y de la hoja impresa que había: «con casi el mismo formato que se pinta el
// front».
//
// Así que esto es LA PANTALLA EN UNA HOJA: el día que se mira, la zona abierta y
// lo que deja el buscador, con el mismo filtro que la pantalla (filtrar, abajo,
// replica pintarCuadrantes de public/assets/js/vistas/Barcelona/
// barcelona-planificador.js). Una sola hoja, «Planificador», apaisada y a una
// página de ancho:
//
//   · la banda de la casa: «PLANIFICADOR · BARCELONA · viernes 6 de noviembre de
//     2026», la zona, las cifras y «Exportado el …» (un Excel no se actualiza:
//     tiene que decir de cuándo es);
//   · zona a zona, en el orden de sus tarjetas, cada cuadrante con su tabla:
//     Matrícula · Descanso · Fijo día · Fijo noche · una columna por casilla de
//     CT, con UNA celda combinada en todas las filas del cuadrante («los
//     correturnos sí o sí van a ser una sola casilla cogiendo los coches que
//     estén ahí»);
//   · los cuadrantes libres (los coches sin cuadrante) y, al final, «Sin plaza».
//
// LA REJILLA. Las casillas cambian de un cuadrante a otro (ninguna, día, noche,
// día y noche, o todoturno) y la hoja tiene unas mismas columnas para todo. Se
// reservan, después de Fijo noche, tantas columnas de CT como pida el cuadrante
// que más pida de lo exportado: la de día y la de noche, una cada una; la
// todoturno, DOS combinadas, porque cubre los dos turnos («si es todoturno es
// una sola casilla»). Cada cuadrante lleva su propia fila de cabecera y solo
// pinta las columnas de SUS casillas, de izquierda a derecha (día, noche o
// todoturno); las que le sobran se quedan en blanco. Así cada tabla es la de la
// pantalla («una columna por casilla») y la hoja sigue siendo una rejilla.
//
// Los colores, los de los Excel de turnos de la casa (rendimiento.excel.js):
// fijo de día azul, fijo de noche caqui, CT de día verde, CT de noche morado y
// el todoturno gris claro; los huecos en rojo y lo que libra en gris. Las
// reglas (quién libra, quién cubre, qué es hueco) las decide el servidor en el
// tablero (barcelona.service + barcelona.plan): aquí no se calcula ninguna,
// solo se pinta lo que llega.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const DIAS_LETRA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DIAS_NOMBRE = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

// Los colores de los turnos: los del Excel de rendimiento (FONDO) y los de la
// hoja impresa que había; el todoturno, gris claro (cubre los dos turnos: ni
// verde ni morado), más oscuro que el gris de «libra» para no confundirlos.
const FONDO = { fijoDia: 'FFDDEBF7', fijoNoche: 'FFEDE3C5', dia: 'FFE2EFDA', noche: 'FFE4DFEC', todoturno: 'FFE5E7EB' };
const FONDO_HUECO = 'FFFDE2E2';
const FONDO_LIBRA = 'FFF3F4F6';
const FONDO_CUADRANTE = 'FFFDF3D7';
const NEGRO = 'FF1F2430', GRIS = 'FF6B7280', ROJO = 'FFC00000', AMBAR = 'FF9C5A00', VIOLETA = 'FF5B3FA8', CLARO = 'FFC9CED6';

// La tarjeta «Sin zona» de la pantalla (los cuadrantes sin zona y los coches sin
// cuadrante). La pantalla la manda como zona=libres; 'sin' y 'sin-zona' (su
// clave y su nombre en la dirección) valen igual.
const SIN = 'sin';
const ALIAS_SIN = ['libres', 'sin', 'sin-zona'];

// Las columnas de la tabla de un cuadrante: las cuatro de siempre y, desde la
// quinta, las casillas de CT. Anchos en caracteres de Excel.
const ANCHOS = [14, 13, 28, 28];
const ANCHO_CT = 28;
const ORDEN_JORNADA = { dia: 0, noche: 1, todoturno: 2 };
const CABECERA_CT = { dia: '☀ CT día', noche: '☾ CT noche', todoturno: 'CT todoturno' };

// ── Fechas y textos (los de la pantalla) ────────────────────────────────────

const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const ddmm = iso => (esIso(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
/** 1 = lunes … 7 = domingo, como `isodow` en la base. */
const isodow = iso => ((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
const diaLargo = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DIAS_NOMBRE[isodow(iso) - 1]} ${d} de ${MESES[m - 1]} de ${y}`;
};
/** [1, 3] → «L X». Vacío si no hay. */
const diasTexto = arr => [...new Set((arr || []).map(Number))].filter(d => d >= 1 && d <= 7)
  .sort((a, b) => a - b).map(d => DIAS_LETRA[d - 1]).join(' ');
const fmt1 = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : (varios || uno + 's')}`;
const nombreTurno = t => (t === 'noche' ? 'noche' : 'día');
const primero = v => (Array.isArray(v) ? v[0] : v);
// Sin tildes y en minúsculas, como el buscador de la pantalla: quien busca
// «Nunez» tiene que encontrar a «Núñez» (NFD separa la letra de su tilde, y la
// tilde, una marca \p{M}, se quita).
const plano = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const slug = s => plano(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fechaDe = v => (v instanceof Date ? enMadrid(v).iso : String(v || '').slice(0, 10));

/**
 * EL MOMENTO DE LA EXPORTACIÓN, en hora de Madrid (el servidor vive en UTC):
 * el día, para cuando el tablero no lo trae, y el sello «06/11/2026 a las 17:30».
 */
function enMadrid(ahora) {
  let t = ahora instanceof Date ? ahora : new Date(ahora == null ? Date.now() : ahora);
  if (Number.isNaN(t.getTime())) t = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map(x => [x.type, x.value]));
  return { fecha: t, iso: `${p.year}-${p.month}-${p.day}`, sello: `${p.day}/${p.month}/${p.year} a las ${p.hour}:${p.minute}` };
}

// ── Lo que se ve: el filtro de la pantalla ──────────────────────────────────

/** La zona que se pide, como la entiende la pantalla: su id, SIN o '' (todas). */
function claveDeZona(zonas, zona) {
  const z = String(primero(zona) == null ? '' : primero(zona)).trim();
  if (!z) return '';
  const porId = zonas.find(x => String(x.id) === z);
  if (porId) return String(porId.id);
  if (ALIAS_SIN.includes(z.toLowerCase())) return SIN;
  // La dirección de la pantalla lleva la zona por su nombre (#zona=eixample): también vale.
  const porNombre = zonas.find(x => slug(x.nombre) === slug(z));
  // Una zona que ya no existe: todas, como la pantalla (aplicar).
  return porNombre ? String(porNombre.id) : '';
}

/**
 * LO QUE SE VE CON ESA ZONA Y ESE BUSCADOR: la misma cuenta que pintarCuadrantes
 * de la pantalla, para que el Excel tenga justo lo que se está viendo.
 *
 *   · Zona: los cuadrantes de esa zona; con «Sin zona», los que no tienen zona
 *     y los coches sin cuadrante (los cuadrantes libres); sin zona, todo.
 *   · Buscador: un coche pasa si su matrícula, su modelo o el nombre o el
 *     teléfono de uno de sus fijos lo contienen (sin tildes ni mayúsculas). Si
 *     lo contiene la persona de una casilla de CT, sale su cuadrante con TODOS
 *     sus coches: la casilla los coge a todos. Un cuadrante sin nada que
 *     coincida se quita; si no, parece que no ha buscado nada.
 *   · El orden: las zonas como sus tarjetas (las da el servidor por nombre), al
 *     final los cuadrantes sin zona; dentro, como llegan (por número); los
 *     coches de un cuadrante, en su orden (cu.coches).
 */
function filtrar(T, { zona, q } = {}) {
  const zonas = T.zonas || [];
  const cuadrantes = T.cuadrantes || [];
  const coches = T.coches || [];
  const cuadPorId = new Map(cuadrantes.map(cu => [String(cu.id), cu]));
  const clave = claveDeZona(zonas, zona);
  const buscado = String(primero(q) == null ? '' : primero(q)).trim();
  const texto = plano(buscado).trim();

  const enZona = cu => (cu && cu.zonaId != null && cu.zonaId !== '' ? String(cu.zonaId) : SIN);
  const cuadDe = c => (c.cuadranteId != null ? cuadPorId.get(String(c.cuadranteId)) : null);
  const gente = c => Object.values(c.plazas || {}).filter(Boolean);
  const pasaPersona = p => plano(`${p.nombre} ${p.telefono || ''}`).includes(texto);
  const pasa = c => !texto || plano([c.matricula, c.modelo, ...gente(c).map(p => `${p.nombre} ${p.telefono || ''}`)].join(' ')).includes(texto);
  const cochesDe = cu => {
    const orden = (cu.coches || []).map(String);
    const pos = m => { const i = orden.indexOf(m); return i < 0 ? 1e6 : i; };
    return coches.filter(c => c.cuadranteId != null && String(c.cuadranteId) === String(cu.id))
      .sort((a, b) => pos(a.matricula) - pos(b.matricula));
  };

  const cuads = cuadrantes.filter(cu => !clave || enZona(cu) === clave);
  const libres = !clave || clave === SIN ? coches.filter(c => c.cuadranteId == null).filter(pasa) : [];
  const grupos = [];
  zonas.map(z => String(z.id)).concat(SIN).forEach(k => {
    const deZona = cuads.filter(cu => enZona(cu) === k)
      .map(cu => {
        const delCT = !!texto && casillasDe(cu).some(x => x.persona && pasaPersona(x.persona));
        return { cu, delCT, coches: delCT ? cochesDe(cu) : cochesDe(cu).filter(pasa) };
      })
      .filter(x => !texto || x.coches.length || x.delCT);
    if (deZona.length) grupos.push({ clave: k, cuadrantes: deZona });
  });

  /**
   * Lo que tiene una zona ese día, sin buscador: `coches` son todos los suyos
   * (cuentaZona de la pantalla, para su título) y `activos`, los que cuentan en
   * las cifras de la banda (cifrasHoja de la hoja impresa que había, con la regla
   * del resumen del servidor). Los turnos, solo de los coches activos: uno
   * desactivado no sale, y su turno sin nadie no es un hueco que cubrir.
   */
  const zonaDeCoche = c => (c.cuadranteId != null ? enZona(cuadDe(c)) : SIN);
  const cuenta = k => {
    const suyos = coches.filter(c => zonaDeCoche(c) === k);
    const activos = suyos.filter(c => c.activo !== false);
    const estados = activos.flatMap(c => [(c.turnos || {}).dia, (c.turnos || {}).noche]);
    return {
      coches: suyos.length,
      activos: activos.length,
      cuadrantes: cuadrantes.filter(cu => enZona(cu) === k).length,
      turnos: estados.filter(x => x && x !== 'libra').length,
      cubiertos: estados.filter(x => x === 'trabaja' || x === 'cubre-ct').length,
      huecos: estados.filter(x => x === 'hueco').length,
      libran: estados.filter(x => x === 'libra').length,
    };
  };

  return { clave, buscado, grupos, libres, cuenta, nombreZona: k => nombreZona(zonas, k) };
}

const nombreZona = (zonas, k) => (k === SIN ? 'Sin zona' : (zonas.find(z => String(z.id) === k) || {}).nombre || 'Zona');

/** Las casillas de un cuadrante, de izquierda a derecha: día, noche, todoturno. */
const casillasDe = cu => ((cu && cu.casillas) || []).filter(k => k && ORDEN_JORNADA[k.jornada] != null)
  .sort((a, b) => ORDEN_JORNADA[a.jornada] - ORDEN_JORNADA[b.jornada]);
const ocupa = k => (k.jornada === 'todoturno' ? 2 : 1);
const columnasCT = cu => casillasDe(cu).reduce((s, k) => s + ocupa(k), 0);

// ── Las celdas de varias líneas ─────────────────────────────────────────────

/**
 * Una celda de varias líneas, cada trozo con su letra (richText). Sabe además
 * cuánto alto pide para un ancho dado: ExcelJS no ajusta el alto de las filas
 * y Excel, al abrir, tampoco lo hace con las filas que ya traen alto (y una
 * celda combinada no lo ajusta nunca). Es una estimación por caracteres, del
 * lado holgado.
 */
function texto() {
  const runs = [];
  const fuente = f => ({ size: 9, color: { argb: NEGRO }, ...f });
  const t = {
    linea(txt, f = {}) { runs.push({ text: (runs.length ? '\n' : '') + txt, font: fuente(f) }); return t; },
    /** Sigue en la misma línea. */
    mas(txt, f = {}) { runs.push({ text: txt, font: fuente(f) }); return t; },
    valor: () => (runs.length ? { richText: runs } : ''),
    alto(ancho) {
      const lineas = [{ n: 0, size: 9 }];
      runs.forEach(r => String(r.text).split('\n').forEach((trozo, i) => {
        if (i) lineas.push({ n: 0, size: r.font.size });
        const l = lineas[lineas.length - 1];
        l.n += trozo.length;
        l.size = Math.max(l.size, r.font.size || 9);
      }));
      return lineas.reduce((s, l) => {
        const porLinea = Math.max(1, Math.floor(ancho * (11 / l.size) * 0.9));
        // 1,65 veces la letra por línea: medido exportando a PDF desde Excel en
        // un Windows al 125 % (el de la oficina), una línea de 9 ocupa unos 15
        // puntos de fila. Con menos se cortaba la última línea de la celda.
        return s + Math.max(1, Math.ceil(l.n / porLinea)) * l.size * 1.65;
      }, 6);
    },
  };
  return t;
}

/** «9,4 h», «9,4 h · oct» (el del mes anterior) o «N/E»: el chip de la pantalla, sin letra. */
function textoPromedio(pr) {
  if (!pr) return '';
  if (pr.ne || pr.horas == null) return 'N/E';
  const m = Number(String(pr.periodo || '').slice(5, 7));
  return `${fmt1(pr.horas)} h${pr.mesAnterior && MESES_CORTO[m - 1] ? ' · ' + MESES_CORTO[m - 1] : ''}`;
}

/** El desglose del promedio, el de la ayuda del chip: va en la nota de la celda. */
function notaPromedio(p) {
  const pr = p && p.promedio;
  if (!pr) return null;
  if (pr.ne || pr.horas == null) {
    return `${p.nombre}: sin promedio todavía (${pr.ne || 'no hay días cerrados que contar'}). Hace falta salir 5 días en el mes; cuenta del día 1 a ayer.`;
  }
  const m = Number(String(pr.periodo || '').slice(5, 7));
  const mes = MESES[m - 1] || 'este mes';
  const salio = Number(pr.salio || 0), aus = Number(pr.ausencias || 0);
  const total = typeof pr.total === 'number' ? `${fmt1(pr.total)} h en ` : '';
  return `${p.nombre} · promedio de ${mes}: ${fmt1(pr.horas)} h por día.\n${total}${plural(salio, 'día')} que salió` +
    (aus ? ` + ${plural(aus, 'ausencia')} a 0 h` : '') + '.' +
    (aus && pr.media != null ? `\nMedia de los días que salió: ${fmt1(pr.media)} h.` : '') +
    (pr.mesAnterior ? `\nEs el de ${mes} entero: este mes aún no lleva 5 días que salió.` : '\nCuentan los días cerrados hasta ayer.');
}

// 'deactivated' es el que de verdad da BOLT: sin traducirlo, la fila diría «deactivated en BOLT».
const estadoBolt = e => ({ inactive: 'desactivado', deactivated: 'desactivado', blocked: 'bloqueado', suspended: 'suspendido' }[String(e || '').toLowerCase()] || e || 'desactivado');

// ── El Excel ────────────────────────────────────────────────────────────────

/**
 * @param {Object} o
 * @param {Object} o.tablero  el de barcelona.service.tablero (la forma: docs/modulos/Barcelona.md)
 * @param {string} [o.zona]   id de zona, 'libres' (la tarjeta «Sin zona»: cuadrantes sin zona y cuadrantes libres; 'sin' vale igual) o vacío (todas)
 * @param {string} [o.q]      el texto del buscador
 * @param {Date|number} [o.ahora]  el momento de la exportación (por defecto, ahora)
 * @returns {Promise<Buffer>}
 */
async function generar({ tablero, zona, q, ahora } = {}) {
  const T = tablero || {};
  const reloj = enMadrid(ahora);
  const dia = esIso(T.fecha) ? T.fecha : reloj.iso;
  const hoy = esIso(T.hoy) ? T.hoy : reloj.iso;
  // «libra hoy» un sábado que no es hoy mentiría: «libra el S 07/11».
  const cuando = dia === hoy ? 'hoy' : `el ${DIAS_LETRA[isodow(dia) - 1]} ${ddmm(dia)}`;
  const vista = filtrar(T, { zona, q });
  const nCT = Math.max(0, ...vista.grupos.flatMap(g => g.cuadrantes.map(x => columnasCT(x.cu))));
  const N = ANCHOS.length + nCT;
  const ancho = col => (col <= ANCHOS.length ? ANCHOS[col - 1] : ANCHO_CT);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = reloj.fecha;
  const logo = E.registrarLogo(wb);
  const ws = wb.addWorksheet('Planificador', {
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
    },
  });
  for (let c = 1; c <= N; c++) ws.getColumn(c).width = ancho(c);
  ws.headerFooter.oddFooter = `&L&8Planificador · Barcelona · ${diaLargo(dia)}&R&8Página &P de &N`;

  // ── La banda: qué, qué día, qué zona, las cifras y cuándo se exportó. Sin
  // zona, las cifras del servidor (las de arriba en la pantalla); con una, las
  // de sus coches activos, con la misma regla.
  const k0 = vista.clave ? vista.cuenta(vista.clave) : null;
  const r = k0 ? { ...k0, coches: k0.activos } : (T.resumen || {});
  const n = v => Number(v || 0);
  const zonaTxt = !vista.clave ? 'Todas las zonas'
    : vista.clave === SIN ? 'Sin zona y cuadrantes libres' : `Zona ${vista.nombreZona(vista.clave)}`;
  // «Sin plaza» es de toda Barcelona: una persona no es de ninguna zona.
  const sinPlaza = n((T.resumen || {}).sinPlaza != null ? T.resumen.sinPlaza : (T.sinPlaza || []).length);
  const sub = [
    zonaTxt,
    plural(n(r.coches), 'coche'),
    `${n(r.cubiertos)} / ${n(r.turnos)} turnos cubiertos`,
    plural(n(r.huecos), 'hueco'),
    `${n(r.libran)} ${n(r.libran) === 1 ? 'libra' : 'libran'} (el coche no sale)`,
    `${sinPlaza} sin plaza${vista.clave ? ' en Barcelona' : ''}`,
    // Con el buscador puesto, el Excel no lo tiene todo: se dice.
    ...(vista.buscado ? [`solo lo que coincide con «${vista.buscado}»`] : []),
    `Exportado el ${reloj.sello}`,
  ].join(' · ');
  E.bandaCabecera(ws, logo, `PLANIFICADOR · BARCELONA · ${diaLargo(dia)}`, sub, N);
  const anchoTotal = Array.from({ length: N }, (_, i) => ancho(i + 1)).reduce((s, x) => s + x, 0);
  ws.getCell(2, 1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(2).height = sub.length > anchoTotal * 1.1 ? 32 : 19;
  ws.mergeCells(3, 1, 3, N);
  const ley = ws.getCell(3, 1);
  ley.value = 'Colores: ☀ fijo de día azul · ☾ fijo de noche caqui · ☀ CT de día verde · ☾ CT de noche morado · CT todoturno gris · ' +
    'en rojo, los huecos (el turno tiene que salir y no lo lleva nadie) · «libra» en gris: ese turno el coche no sale, es lo ' +
    'planificado. Cada casilla de CT es del cuadrante entero: cubre los días que libran sus fijos y libra los que no cubre.';
  ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
  ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(3).height = ley.value.length > anchoTotal * 1.15 ? 30 : 18;
  let f = 5;                       // la fila por la que va la hoja (la 4, de respiro)

  // ── Piezas sueltas.

  /** Estilo y valor de una celda (o de un rango combinado: el estilo, ANTES de combinar, para que lo copie entero). */
  function poner(f1, c1, { valor, fill, font, al = 'left', nota, f2 = f1, c2 = c1 }) {
    for (let y = f1; y <= f2; y++) {
      for (let x = c1; x <= c2; x++) {
        const c = ws.getCell(y, x);
        c.border = E.TODOS_BORDES;
        c.alignment = { vertical: 'top', horizontal: al, wrapText: true, indent: al === 'left' ? 1 : 0 };
        if (fill) c.fill = E.relleno(fill);
        // La letra de base de la celda: con varias líneas, Excel la usa para el
        // alto de cada línea aunque el texto vaya más pequeño (con la de 11
        // por defecto, cada línea de 9 ocupaba 15 puntos y no cabían).
        c.font = font || { size: 9, color: { argb: NEGRO } };
      }
    }
    if (f2 > f1 || c2 > c1) ws.mergeCells(f1, c1, f2, c2);
    const c = ws.getCell(f1, c1);
    c.value = valor == null ? '' : valor;
    if (nota) c.note = nota;
    return c;
  }

  /** Una fila de título a lo ancho de la hoja. */
  function titulo(trozos, { fill, alto = 22 }) {
    ws.mergeCells(f, 1, f, N);
    const c = ws.getCell(f, 1);
    c.value = { richText: trozos };
    c.fill = E.relleno(fill);
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(f).height = alto;
    f++;
  }
  const tituloZona = (nombre, resto) => titulo([
    { text: nombre.toUpperCase(), font: { size: 11, bold: true, color: { argb: E.GOLD } } },
    ...(resto ? [{ text: '   ' + resto, font: { size: 10, color: { argb: CLARO } } }] : []),
  ], { fill: E.DARK });

  /** Una línea en cursiva gris a lo ancho (explicaciones, vacíos). */
  function nota(txt) {
    ws.mergeCells(f, 1, f, N);
    const c = ws.getCell(f, 1);
    c.value = txt;
    c.font = { size: 9, italic: true, color: { argb: E.TENUE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(f).height = txt.length > anchoTotal * 1.15 ? 28 : 16;
    f++;
  }

  /** La cabecera de la tabla de un cuadrante (o de los libres): las cuatro de siempre y sus casillas. */
  function cabecera(casillas) {
    const textos = ['Matrícula', 'Descanso', '☀ Fijo día', '☾ Fijo noche'];
    casillas.forEach(k => { textos.push(CABECERA_CT[k.jornada]); if (ocupa(k) === 2) textos.push(''); });
    E.cabeceraTabla(ws, f, textos, { alto: 20 });
    // Las columnas de turno con su color, como el Excel de rendimiento: el ojo las sigue hacia abajo.
    const pinta = (col, argb) => { const c = ws.getCell(f, col); c.fill = E.relleno(argb); c.font = { size: 10, bold: true, color: { argb: NEGRO } }; };
    pinta(3, FONDO.fijoDia);
    pinta(4, FONDO.fijoNoche);
    let col = ANCHOS.length + 1;
    casillas.forEach(k => {
      pinta(col, FONDO[k.jornada]);
      if (ocupa(k) === 2) { pinta(col + 1, FONDO[k.jornada]); ws.mergeCells(f, col, f, col + 1); }
      col += ocupa(k);
    });
    f++;
  }

  /**
   * La persona de una plaza o de una casilla: nombre con su promedio, teléfono,
   * sus días (`sub`) y desde y hasta cuándo (lo suyo o, si no viene, `desde` y
   * `hasta`: lo de la casilla).
   */
  function persona(t, p, { sub = '', desde = null, hasta = null } = {}) {
    const inactiva = p.activa === false;
    t.linea(p.nombre || 'Cuenta de BOLT desconocida', { size: 10, bold: !inactiva, strike: inactiva, color: { argb: inactiva ? GRIS : NEGRO } });
    const pr = textoPromedio(p.promedio);
    if (pr) t.mas(`   ${pr}`, { size: 9, bold: true, color: { argb: GRIS } });
    if (p.telefono) t.linea(String(p.telefono), { color: { argb: GRIS } });
    else t.linea('sin teléfono', { italic: true, color: { argb: AMBAR } });
    const d = fechaDe(p.desde) || fechaDe(desde);
    const h = fechaDe(p.hasta) || fechaDe(hasta);
    const linea = [sub, d ? `desde ${ddmm(d)}` : '', h ? `hasta ${ddmm(h)}` : ''].filter(Boolean).join(' · ');
    if (linea) t.linea(linea, { color: { argb: GRIS } });
    if (inactiva) t.linea('ya no está activa en BOLT', { bold: true, color: { argb: AMBAR } });
  }

  /** La matrícula: el modelo y los avisos (no está en BOLT, desactivado). */
  function celdaMatricula(c) {
    const t = texto();
    const apagado = c.activo === false;
    t.linea(c.matricula, { size: 11, bold: true, color: { argb: apagado ? GRIS : NEGRO } });
    if (c.modelo) t.linea(c.modelo, { size: 8, color: { argb: GRIS } });
    if (apagado) t.linea(`${estadoBolt(c.estadoBolt)}${c.enBolt ? ' en BOLT' : ''}`, { size: 8, bold: true, color: { argb: AMBAR } });
    else if (!c.enBolt) t.linea('No está dado de alta en BOLT', { size: 8, bold: true, color: { argb: AMBAR } });
    return t;
  }

  /** El descanso de los dos fijos: «☀ libra L M» / «☾ no libra». */
  function celdaDescanso(c) {
    const t = texto();
    [['dia', '☀'], ['noche', '☾']].forEach(([turno, icono]) => {
      const dias = diasTexto(((c.descansoTurno || {})[turno]) || []);
      t.linea(`${icono} ${dias ? 'libra ' + dias : 'no libra'}`, dias ? { bold: true, color: { argb: NEGRO } } : { color: { argb: GRIS } });
    });
    return t;
  }

  /**
   * Cómo está el turno de un fijo ese día (`turnos` del tablero, que decide el
   * servidor), con las palabras de la pantalla (lineaTurno): «libra hoy · lo
   * cubre el CT», «libra hoy · hueco» (la casilla está vacía), «libra hoy» (no
   * hay casilla de ese turno: el coche no sale) o «hueco hoy» (sin fijo). En el
   * Excel no hay ayuda al pasar el ratón: quien cubre va entre paréntesis.
   */
  function estadoTurno(c, turno, cu) {
    const st = (c.turnos || {})[turno];
    const fijo = (c.plazas || {})[turno === 'dia' ? 'fijoDia' : 'fijoNoche'];
    // Un coche desactivado (o que ya no es de la sede) no sale: su turno sin
    // nadie no es un hueco que cubrir, y tampoco cuenta en las cifras.
    if (c.activo === false && st === 'hueco') return { texto: `no sale · ${c.enBolt ? 'coche desactivado' : 'ya no es de la sede'}`, tono: 'libra' };
    if (st === 'libra') return { texto: `libra ${cuando}`, tono: 'libra' };
    if (st === 'cubre-ct' || (st === 'trabaja' && fijo && fijo.libraHoy)) {
      const casillas = casillasDe(cu);
      const k = casillas.find(x => x.hoy && x.hoy.matricula === c.matricula && x.hoy.turno === turno)
        || casillas.find(x => x.jornada === turno || x.jornada === 'todoturno');
      return { texto: `libra ${cuando} · lo cubre el CT${k && k.persona ? ` (${k.persona.nombre})` : ''}`, tono: 'ct' };
    }
    if (st === 'hueco') {
      // La libranza es de la plaza (matrícula y turno): libra aunque no tenga fijo.
      const libra = (((c.descansoTurno || {})[turno]) || []).map(Number).includes(isodow(dia)) || !!(fijo && fijo.libraHoy);
      return { texto: libra ? `libra ${cuando} · hueco` : `hueco ${cuando}`, tono: 'hueco' };
    }
    return null;
  }

  /** La celda de un fijo: la persona (o «Sin conductor») y el estado del día; hueco en rojo, libra en gris. */
  function celdaFijo(c, turno, cu) {
    const t = texto();
    const p = (c.plazas || {})[turno === 'dia' ? 'fijoDia' : 'fijoNoche'];
    const dias = diasTexto(((c.descansoTurno || {})[turno]) || []);
    if (p) persona(t, p, { sub: dias ? 'libra ' + dias : 'no libra' });
    else t.linea('Sin conductor', { size: 10, italic: true, color: { argb: GRIS } });
    const st = estadoTurno(c, turno, cu);
    if (st) {
      const color = st.tono === 'hueco' ? ROJO : st.tono === 'ct' ? VIOLETA : GRIS;
      t.linea(st.texto, { bold: true, color: { argb: color } });
    }
    const fill = st && st.tono === 'hueco' ? FONDO_HUECO : st && st.tono === 'libra' ? FONDO_LIBRA
      : turno === 'dia' ? FONDO.fijoDia : FONDO.fijoNoche;
    return { t, fill, nota: p ? notaPromedio(p) : null };
  }

  /**
   * La casilla de CT, con los textos de la pantalla (celdaCasilla): la persona
   * (o «Sin asignar»), lo que coge («cubre: L 1111AAA · M 2222BBB»; en la
   * todoturno, cada plaza con su turno), lo que libra (los días que no coge
   * nada) y el estado del día: «cubre hoy 1111AAA de día», «libra hoy» o, vacía,
   * el hueco que deja («hueco hoy · 1111AAA de noche»).
   */
  function celdaCasilla(k) {
    const t = texto();
    const p = k.persona;
    if (p) persona(t, p, { desde: k.desde, hasta: k.hasta });
    else {
      t.linea('Sin asignar', { size: 10, italic: true, bold: true, color: { argb: GRIS } });
      const vale = [fechaDe(k.desde) ? `desde ${ddmm(fechaDe(k.desde))}` : '', fechaDe(k.hasta) ? `hasta ${ddmm(fechaDe(k.hasta))}` : ''].filter(Boolean);
      if (vale.length) t.linea(`casilla ${vale.join(' · ')}`, { color: { argb: GRIS } });
    }
    // Por día de la semana, y de día antes que de noche. En la de día o la de
    // noche el turno solo se dice si no es el suyo (no debería pasar, pero así
    // no engaña).
    const cubre = (k.cubre || []).slice()
      .sort((a, b) => Number(a.dia) - Number(b.dia) || Number(a.turno === 'noche') - Number(b.turno === 'noche'));
    if (cubre.length) {
      t.linea('cubre: ' + cubre.map(x => `${DIAS_LETRA[Number(x.dia) - 1] || '?'} ${x.matricula}` +
        (k.jornada === 'todoturno' || x.turno !== k.jornada ? ` (${nombreTurno(x.turno)})` : '')).join(' · '), { color: { argb: NEGRO } });
      // La libranza se calcula (los días que no coge nada); si no viene, se saca de lo que coge.
      const libra = (Array.isArray(k.libra) ? k.libra : [1, 2, 3, 4, 5, 6, 7].filter(d => !cubre.some(x => Number(x.dia) === d))).map(Number);
      t.linea(`libra: ${libra.length >= 7 ? 'todos los días' : libra.length ? diasTexto(libra) : 'no libra'}`, { color: { argb: GRIS } });
      // «Ninguna plaza se puede repetir» (Camilo): las escrituras no lo dejan,
      // pero si el tablero trae alguna repetida (`repetidas`), se avisa.
      (k.repetidas || []).forEach(x => t.linea(`ojo: el ${DIAS_LETRA[Number(x.dia) - 1] || '?'} coge ` +
        (x.plazas || []).map(y => y.matricula + (k.jornada === 'todoturno' ? ` (${nombreTurno(y.turno)})` : '')).join(' y ') +
        ' a la vez: ninguna plaza se puede repetir', { bold: true, color: { argb: AMBAR } }));
      // Ni que su persona doble con una plaza fija suya (`dobles`, lo pudo
      // dejar db/236): se avisa igual.
      if (p) {
        (k.dobles || []).filter(x => (x.dias || []).length).forEach(x => t.linea(
          `ojo: ${p.nombre || 'su CT'} también es fija del ${x.matricula} de ${nombreTurno(x.turno)} los ${diasTexto(x.dias)}: dobla turno`,
          { bold: true, color: { argb: AMBAR } }));
      }
    } else {
      t.linea(`Todavía no coge nada: ${k.jornada === 'todoturno' ? 'ningún fijo' : `ningún fijo de ${nombreTurno(k.jornada)}`} del cuadrante libra.`,
        { italic: true, color: { argb: GRIS } });
    }
    if (k.hoy && p) t.linea(`cubre ${cuando} ${k.hoy.matricula} de ${nombreTurno(k.hoy.turno)}`, { bold: true, color: { argb: VIOLETA } });
    else if (k.hoy) t.linea(`hueco ${cuando} · ${k.hoy.matricula} de ${nombreTurno(k.hoy.turno)}`, { bold: true, color: { argb: ROJO } });
    else if (p) t.linea(`libra ${cuando}`, { bold: true, color: { argb: GRIS } });
    return { t, fill: FONDO[k.jornada], nota: p ? notaPromedio(p) : null };
  }

  /**
   * La tabla de un cuadrante (o de los libres, sin casillas): una fila por coche
   * y cada casilla en UNA celda combinada en todas las filas. Sin coches (un
   * cuadrante vacío), una fila que lo dice, con sus casillas al lado.
   */
  function tabla(cu, coches) {
    const casillas = casillasDe(cu);
    cabecera(casillas);
    const f1 = f;
    if (!coches.length) {
      poner(f, 1, { valor: 'Cuadrante vacío: todavía no tiene coches.', c2: ANCHOS.length, font: { size: 9, italic: true, color: { argb: GRIS } } });
      ws.getRow(f).height = 30;
      f++;
    }
    coches.forEach(c => {
      const piezas = [
        { t: celdaMatricula(c), fill: c.activo === false ? FONDO_LIBRA : null },
        { t: celdaDescanso(c) },
        celdaFijo(c, 'dia', cu),
        celdaFijo(c, 'noche', cu),
      ];
      piezas.forEach((x, i) => poner(f, i + 1, { valor: x.t.valor(), fill: x.fill, nota: x.nota }));
      ws.getRow(f).height = Math.max(30, ...piezas.map((x, i) => x.t.alto(ANCHOS[i])));
      f++;
    });
    const f2 = f - 1;
    // Las casillas, combinadas en todas las filas del cuadrante. Si su texto
    // pide más alto que el que suman las filas, se reparte lo que falta.
    let col = ANCHOS.length + 1;
    casillas.forEach(k => {
      const x = celdaCasilla(k);
      const c2 = col + ocupa(k) - 1;
      poner(f1, col, { valor: x.t.valor(), fill: x.fill, nota: x.nota, f2, c2 });
      const falta = x.t.alto(ANCHO_CT * ocupa(k)) - Array.from({ length: f2 - f1 + 1 }, (_, i) => ws.getRow(f1 + i).height || 15)
        .reduce((s, h) => s + h, 0);
      if (falta > 0) for (let y = f1; y <= f2; y++) ws.getRow(y).height += falta / (f2 - f1 + 1);
      col = c2 + 1;
    });
  }

  // ── Las zonas y sus cuadrantes.
  // Sin la migración el servidor no puede montar el tablero y lo dice así (como la pantalla).
  if (T.faltaMigracion) {
    const cual = typeof T.faltaMigracion === 'string' ? ` ${T.faltaMigracion}` : '';
    nota(`Falta aplicar la migración${cual} (en Migraciones): hasta entonces el planificador de Barcelona no se puede exportar.`);
  }
  vista.grupos.forEach(g => {
    const k = vista.cuenta(g.clave);
    tituloZona(vista.nombreZona(g.clave),
      `${plural(k.coches, 'coche')} · ${plural(k.cuadrantes, 'cuadrante')}${k.huecos ? ` · ${plural(k.huecos, 'hueco')} ${cuando}` : ''}`);
    g.cuadrantes.forEach(({ cu, coches }) => {
      f++;
      titulo([
        { text: `C${cu.numero}${cu.nombre ? ' · ' + cu.nombre : ''} · ${cu.zona || 'sin zona'}`, font: { size: 11, bold: true, color: { argb: NEGRO } } },
        { text: `   —   ${plural((cu.coches || []).length, 'coche')}` +
          (casillasDe(cu).length ? ` · CT: ${casillasDe(cu).map(x => CABECERA_CT[x.jornada].replace('CT ', '')).join(' + ')}` : ' · sin casillas de CT'),
        font: { size: 10, color: { argb: GRIS } } },
      ], { fill: FONDO_CUADRANTE, alto: 20 });
      tabla(cu, coches);
    });
    f++;
  });

  // ── Los cuadrantes libres: los coches sin cuadrante, sin casillas (no llevan CT).
  if (vista.libres.length) {
    tituloZona('Cuadrantes libres', `${plural(vista.libres.length, 'coche')} sin cuadrante · no llevan CT: el día que libra un fijo, ese turno el coche no sale`);
    tabla(null, vista.libres);
    f++;
  }

  // ── Si no queda nada, se dice por qué (como la pantalla).
  if (!vista.grupos.length && !vista.libres.length && !T.faltaMigracion) {
    nota(vista.buscado ? `No hay coches que coincidan con «${vista.buscado}».`
      : vista.clave === SIN ? 'Todos los cuadrantes tienen zona y todos los coches están en un cuadrante.'
        : vista.clave ? `${vista.nombreZona(vista.clave)} todavía no tiene cuadrantes.`
          : 'Todavía no hay coches de Barcelona: la ingesta los trae de BOLT cada seis horas, y los de Vehículos salen si tienen la sede Barcelona.');
    f++;
  }

  // ── Sin plaza: de toda Barcelona, sin zona ni buscador (como la pantalla).
  const gente = (T.sinPlaza || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  tituloZona('Sin plaza', gente.length ? plural(gente.length, 'persona') : '');
  nota('Cuentas activas en BOLT Barcelona que ese día no están en ninguna matrícula, con su promedio de horas del mes. Es de toda Barcelona: no depende de la zona ni del buscador.');
  if (!gente.length) {
    nota('Todos tienen plaza.');
  } else {
    E.cabeceraTabla(ws, f, ['Nombre', '', 'Teléfono', 'Promedio'], { alto: 20 });
    ws.mergeCells(f, 1, f, 2);
    f++;
    gente.forEach(p => {
      const inactiva = p.activa === false;
      poner(f, 1, { valor: p.nombre || 'Cuenta de BOLT desconocida', c2: 2,
        font: { size: 10, bold: !inactiva, strike: inactiva, color: { argb: inactiva ? GRIS : NEGRO } } });
      poner(f, 3, { valor: p.telefono || 'sin teléfono', font: { size: 9, italic: !p.telefono, color: { argb: p.telefono ? GRIS : AMBAR } } });
      const t = texto();
      const pr = p.promedio;
      t.linea(textoPromedio(pr) || '—', { size: 10, bold: true, color: { argb: pr && !pr.ne && pr.horas != null ? NEGRO : GRIS } });
      if (pr && (pr.ne || pr.horas == null)) t.linea(pr.ne || 'sin días cerrados', { color: { argb: GRIS } });
      else if (pr) t.linea(`${plural(Number(pr.salio || 0), 'día')} que salió${pr.ausencias ? ` · ${plural(Number(pr.ausencias), 'ausencia')}` : ''}`, { color: { argb: GRIS } });
      poner(f, 4, { valor: t.valor(), nota: notaPromedio(p) });
      ws.getRow(f).height = Math.max(18, t.alto(ANCHOS[3]));
      f++;
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
