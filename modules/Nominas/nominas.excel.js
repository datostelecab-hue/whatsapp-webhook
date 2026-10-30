// ============================================================
// EXCEL DE LA NÓMINA VARIABLE
// ============================================================
// Lo que RRHH manda a la gestoría para que lo sume al recibo del mes. Solo
// plantilla propia: los de ETT los paga la agencia y van en su parte (abajo).
// Cuatro hojas, con el diseño de la casa (banda con el logo, cabecera oscura,
// ámbar para los avisos, rojo para lo que falta y el oro solo en el TOTAL):
//
//   Nómina                 las VARIABLES (mes vencido): una fila por persona,
//                          con el desglose de cada euro.
//   Nómina base            el salario base bruto (del 26 al 25, mes corriente)
//                          más esas variables: la nómina entera (16/10/2026).
//   Resumen por conductor  el cálculo de las variables de cada uno en el orden
//                          en que se hace, con la cuenta escrita en palabras.
//   Cómo se calculó        la config usada y cómo sale cada columna, en tablas.
//
// La segunda hoja no es adorno: cuando alguien pregunta "¿por qué he cobrado
// 212,40 € y mi compañero 318?", la respuesta tiene que estar en el propio
// fichero y no en la cabeza de quien lo generó.
//
// Los importes van como NÚMEROS con formato de euro, nunca como texto: si van
// escritos "1.234,50 €" no se suman, no se ordenan y la gestoría los tiene que
// teclear otra vez.
//
// ── DOS COLUMNAS DE NOMBRE, Y LAS DOS HACEN FALTA ───────────────────────────
// La misma persona se llama de dos maneras y este fichero lo leen dos mundos
// distintos:
//
//   ID de BOLT    "Muhammad Bilal Ashraf" — como figura su cuenta en la
//                 plataforma. Es por donde se cruza esta hoja con cualquier
//                 informe de BOLT y por donde lo busca Tráfico.
//   Nombre de la  "ASHRAF MUHAMMAD, BILAL" — apellidos primero, coma, nombres.
//   seguridad     Es el que entiende la gestoría y el que va en un documento
//   social        oficial.
//
// Ninguna de las dos está mal y ninguna sustituye a la otra: sin la primera no
// se puede comprobar una cifra contra BOLT, y sin la segunda no se puede pasar
// la hoja a nóminas. Por eso van las dos, una al lado de la otra.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

// Los importes, en formato de CONTABILIDAD: un cero sale como "- €" en vez de
// "0,00 €". En una columna de MBO que va a cero en tres de cada cuatro filas,
// los que sí cobran se ven de un vistazo.
const CONTA = '_-* #,##0.00\\ "€"_-;\\-* #,##0.00\\ "€"_-;_-* "-"\\ "€"_-;_-@_-';
const EUROS = CONTA;
const HORAS = '#,##0.0';
const DOS = '#,##0.00';
const PCT = '0.0"%"';

// Los tonos de la casa: ámbar es aviso, rojo es lo que falta, y el oro solo
// para lo que se paga.
const AMBAR = { bg: 'FFFEF3C7', fg: 'FF92400E' };
const ROJO = { bg: 'FFFEE2E2', fg: 'FF991B1B' };
const ORO_SUAVE = 'FFFBF3DC';

const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

const fechaCorta = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

const ARRANQUE = {
  'alta-anterior': 'Ya estaba de alta (mes completo)',
  'alta-en-mes': 'Alta dentro del mes (prorrateado)',
  'primer-log': 'SIN fecha de alta (primer día con horas)',
};

// Título, ancho, clave de la fila y formato. El orden es el de la pantalla.
// Sin columna «Tipo»: desde el 16/10/2026 la nómina es solo de plantilla
// propia, y los de ETT van en su parte.
const COLUMNAS = [
  ['ID de BOLT', 28, 'nombreBolt', null],
  ['Nombre de la seguridad social', 34, 'nombreSS', null],
  ['DNI/NIE', 12, 'dni', null],
  ['Jornada', 9, '_jornada', null],
  ['Fecha alta', 11, '_alta', null],
  ['Desde día', 8, 'primerDia', '0'],
  ['Arranque del prorrateo', 30, '_arranque', null],
  ['Horas rodadas', 10, 'horas', HORAS],
  ['Horas de espera quitadas', 12, 'horasEsperaQuitadas', HORAS],
  ['Horas justificadas', 12, 'horasJustificadas', HORAS],
  ['Días justificados', 11, 'diasJustificados', '0'],
  ['Horas de vacaciones', 11, 'horasVacaciones', HORAS],
  ['Horas de permiso', 10, 'horasPermiso', HORAS],
  ['Objetivo (h)', 10, 'horasObjetivo', HORAS],
  ['Horas no justificadas', 12, 'horasNoJustificadas', HORAS],
  ['Diferencia (h)', 11, 'deltaHoras', HORAS],
  ['% Utilización', 11, '_util', PCT],
  ['Propinas', 12, 'propinas', EUROS],
  ['Peajes', 11, 'peajes', EUROS],
  ['Nocturnas', 12, 'nocturnas', EUROS],
  ['MBO FAS', 12, 'mboFAS', EUROS],
  ['MBO horas extra', 13, 'mboHsExt', EUROS],
  ['Compensación', 13, 'compensacion', EUROS],
  ['Días extra', 9, 'diasExtra', DOS],
  ['TOTAL', 14, 'total', EUROS],
];

// Las que se suman en el pie.
const SUMABLES = new Set(['horas', 'horasEsperaQuitadas', 'horasJustificadas', 'diasJustificados', 'horasNoJustificadas',
  'horasVacaciones', 'horasPermiso',
  'propinas', 'peajes', 'nocturnas', 'mboFAS', 'mboHsExt', 'compensacion', 'diasExtra', 'total']);

function valorDe(f, clave) {
  switch (clave) {
    // Si falta uno de los dos nombres se pone el de la ficha antes que dejar la
    // celda vacía: quien lee la hoja tiene que poder saber de quién es la fila
    // aunque a esa persona le falte un dato.
    case 'nombreBolt': return f.nombreBolt || f.nombre || '';
    case 'nombreSS': return f.nombreSS || f.nombre || '';
    case '_jornada': return f.jornada ? f.jornada + ' h' : '';
    case '_alta': return fechaCorta(f.alta);
    case '_arranque': return ARRANQUE[f.origenArranque] || f.origenArranque || '';
    case '_util': return f.utilPct == null ? null : f.utilPct;
    default: return f[clave];
  }
}

// La posición (1..N) de una columna por su clave. Se busca en vez de escribir el
// número: el día que se meta una columna en medio, los realces no se quedan
// señalando la de al lado.
const COL = clave => COLUMNAS.findIndex(c => c[2] === clave) + 1;

const tono = (c, t, negrita = true) => {
  c.fill = E.relleno(t.bg);
  c.font = { bold: negrita, color: { argb: t.fg } };
};

/** Apaisado y a lo ancho de una hoja: así se imprime sin cortar columnas. */
const PAGINA = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
  margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };

/** El libro. Devuelve los bytes; quien llama solo tiene que servirlo. */
async function generarExcelNomina(r, base = null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const idLogo = E.registrarLogo(wb);
  const cfg = r.config || {};
  // Una congelada de antes del 16/10/2026 podía traer filas de ETT: fuera,
  // como en la pantalla.
  const filas = (r.filas || []).filter(f => !f.ett);

  // ── Hoja 1: la nómina ─────────────────────────────────────────────────────
  const ws = wb.addWorksheet(`Nómina ${r.mesNombre} ${r.ano}`, { pageSetup: PAGINA });
  COLUMNAS.forEach(([, ancho], i) => { ws.getColumn(i + 1).width = ancho; });

  const sub = `Nómina de ${r.mesNombre} ${r.ano} · plantilla propia · a mes vencido: trabajo de ` +
    `${r.mesDatosNombre} ${r.anoDatos} · ${filas.length} conductores · ` +
    (r.congelada ? 'CONGELADA' : 'sin congelar') + ` · generado ${sello()}`;
  let fila = E.bandaCabecera(ws, idLogo, 'NÓMINA VARIABLE', sub, COLUMNAS.length);
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, COLUMNAS.map(c => c[0]), { alto: 32, ajustar: true });
  // El TOTAL, en el oro de la casa: es la columna que se paga.
  const cabTotal = ws.getRow(filaCab).getCell(COL('total'));
  cabTotal.fill = E.relleno(E.GOLD);
  cabTotal.font = { size: 10, bold: true, color: { argb: E.DARK } };
  const primera = fila;

  const umbral = (Number(cfg.utilUmbral) || 0) * 100;
  for (const f of filas) {
    const row = ws.getRow(fila++);
    COLUMNAS.forEach(([, , clave, fmt], i) => {
      const c = row.getCell(i + 1);
      c.value = valorDe(f, clave);
      if (fmt) c.numFmt = fmt;
      c.border = E.TODOS_BORDES;
      c.font = { color: { argb: E.TEXTO } };
    });
    const tot = row.getCell(COL('total'));
    tot.font = { bold: true, color: { argb: E.DARK } };
    tot.fill = E.relleno(ORO_SUAVE);
    // Quien va sin fecha de alta cobra con el criterio viejo: se marca, porque
    // es el único caso en el que la cifra depende de un dato que falta.
    if (f.origenArranque === 'primer-log') tono(row.getCell(COL('_arranque')), AMBAR, false);
    // La espera retirada y la utilización que la provoca, en ámbar: son la
    // explicación de por qué a alguien con muchas horas le sale poca
    // diferencia, y hay que poder encontrarla sin leerse la fila entera.
    if (f.horasEsperaQuitadas > 0) tono(row.getCell(COL('horasEsperaQuitadas')), AMBAR);
    if (f.utilPct != null && umbral && f.utilPct < umbral) tono(row.getCell(COL('_util')), AMBAR, false);
    // Las horas que siguen sin explicación, en rojo. Es la columna por la que se
    // abre esta hoja, y una cifra que hay que buscar a ojo entre veinte no
    // sirve de nada.
    if (f.horasNoJustificadas > 0) tono(row.getCell(COL('horasNoJustificadas')), ROJO);
  }

  // Pie con los totales, en fórmula: si alguien borra una fila, el total baja.
  const ultima = fila - 1;
  const pie = ws.getRow(fila);
  COLUMNAS.forEach(([, , clave, fmt], i) => {
    const c = pie.getCell(i + 1);
    c.fill = E.relleno('FFF3F4F6');
    c.border = E.TODOS_BORDES;
    c.font = { bold: true, color: { argb: E.DARK } };
    if (!SUMABLES.has(clave) || ultima < primera) return;
    const L = E.colLetra(i + 1);
    c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` };
    c.numFmt = fmt;
  });
  pie.getCell(1).value = `TOTAL (${filas.length})`;
  pie.getCell(COL('total')).fill = E.relleno(E.GOLD);
  pie.height = 20;

  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: filaCab }];
  if (ultima >= primera) {
    ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: ultima, column: COLUMNAS.length } };
  }

  if (base) hojaNominaBase(wb, idLogo, base);
  hojaResumen(wb, idLogo, r, filas, cfg);
  hojaComoSeCalculo(wb, idLogo, sub, cfg);
  return wb.xlsx.writeBuffer();
}

// ── Hoja 4: cómo se calculó ─────────────────────────────────────────────────
// Tres tablas de la casa en vez de un texto alineado a espacios (que en una
// letra proporcional nunca quedaba alineado): los parámetros con su valor, cómo
// sale cada columna, y de dónde salen los datos.

const pctTxt = x => `${Math.round((Number(x) || 0) * 100)} %`;
const num = x => (Number(x) || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });

// [etiqueta, clave, formato, qué hace, ¿entra en el total?]
const PARAMS = [
  ['Objetivo del mes con jornada de 40 h', 'horasMetaMes40', HORAS,
    'Las horas que se piden en un mes completo. Otra jornada sale por regla de tres (32 h → 137,6) y se prorratea desde la fecha de alta.', true],
  ['€ por hora extra', 'eurHoraExtra', DOS, 'Cada hora por encima del objetivo, multiplicada además por la utilización.', true],
  ['Utilización con la que no se quitan horas', 'utilUmbral', '0%', 'Quien llega a este porcentaje no pierde ninguna hora.', true],
  ['Utilización exigida a quien no llega', 'utilExigida', '0%', 'A quien se queda por debajo del umbral se le quitan horas de espera hasta dejarlo aquí.', true],
  ['Umbral FAS 40 h (€)', 'umbralFAS40', DOS, 'A partir de esta facturación neta hay MBO FAS, para jornada de 40 h.', true],
  ['Umbral FAS 32 h (€)', 'umbralFAS32', DOS, 'Lo mismo para jornada de 32 h.', true],
  ['% MBO FAS', 'pctMBOFAS', '0%', 'Parte del exceso de facturación sobre el umbral que se paga.', true],
  ['€ hora nocturna', 'eurHoraNoc', DOS, 'Precio de la hora entre las 22:00 y las 06:00.', true],
  ['Factor nocturnas', 'factorNoc', DOS, 'La nocturnidad es € hora × horas × factor.', true],
  ['Horas de un día de permiso', 'horasMetaDia', HORAS, 'Lo que suma cada día de permiso retribuido, y la base del de vacaciones. También cuántas horas hacen un «día extra».', true],
  ['Día de vacaciones', 'pctDiaVacaciones', '0%', 'Lo que vale un día de vacaciones de uno de permiso: 8 × 73 % = 5,84 h. Cuentan por día natural, libranzas incluidas.', true],
  ['€ hora base', 'eurHoraBase', DOS, 'Cada hora de la nómina base: rodadas (con el recorte por utilización) + J + vacaciones + permisos.', true],
  ['Tope del salario base, 40 h (€)', 'sueldoBase40', DOS, 'Lo máximo que paga la base con 40 h, prorrateado por los días de contrato. Lo que pasa lo pagan las variables.', true],
  ['Tope del salario base, 32 h (€)', 'sueldoBase32', DOS, 'Lo mismo con 32 h. Otra jornada: el de 40 h por regla de tres.', true],
];

function reglas(cfg) {
  return [
    ['Objetivo (h)', 'Objetivo del mes de su jornada × (días desde el arranque ÷ días del mes). El arranque es el día 1 si ya estaba de alta, o su día de alta si entró ese mes.'],
    ['Horas justificadas', 'La suma de las horas de sus J APROBADAS: cada J vale las horas que se le pusieron al justificarla, y se SUMAN a las rodadas ese día, igual que en la bitácora. Una J sin horas no suma. Las pendientes y las rechazadas no cuentan.'],
    ['Vacaciones y permisos', `Cada día de vacaciones suma ${num(cfg.horasMetaDia * cfg.pctDiaVacaciones)} h (${num(cfg.horasMetaDia)} × ${pctTxt(cfg.pctDiaVacaciones)}), por día NATURAL: cogen también las libranzas. Cada día de permiso retribuido suma ${num(cfg.horasMetaDia)} h. Desde el arranque del mes y hasta la baja. No suman la suspensión, el permiso sin sueldo ni la baja médica.`],
    ['Horas de espera quitadas', `Utilización = viaje ÷ (viaje + espera). Quien llega al ${pctTxt(cfg.utilUmbral)} no pierde nada. A quien no llega se le exige el ${pctTxt(cfg.utilExigida)}: se le quitan X = (viaje + espera) − viaje ÷ ${num(cfg.utilExigida)} horas de ESPERA, y queda exactamente en el ${pctTxt(cfg.utilExigida)}. Nunca se quita viaje, ni más espera de la que tuvo.`],
    ['Diferencia (h)', 'Horas rodadas − espera quitada + justificadas + vacaciones + permisos − objetivo. Con todo eso dentro: un día justificado o de vacaciones no le resta a nadie sus horas extra.'],
    ['Horas no justificadas', 'La diferencia cuando sale negativa; cero si llegó al objetivo. Es lo que falta y no tiene explicación: va en rojo.'],
    ['MBO horas extra', `Diferencia × ${num(cfg.eurHoraExtra)} € × utilización. Solo si la diferencia es positiva.`],
    ['MBO FAS', `(Facturación neta − umbral de su jornada) × ${pctTxt(cfg.pctMBOFAS)}. Solo si supera el umbral.`],
    ['Nocturnas', `${num(cfg.eurHoraNoc)} € × horas nocturnas × ${num(cfg.factorNoc)}: ${num((Number(cfg.eurHoraNoc) || 0) * (Number(cfg.factorNoc) || 0))} € por cada hora entre las 22:00 y las 06:00. Llevan el mismo recorte que las horas: de la espera que se quita se va también su parte nocturna (el viaje nocturno no se toca).`],
    ['TOTAL', 'Nocturnas + peajes + propinas + el MAYOR de los dos MBO. Los MBO no se suman: se cobra el que salga más alto, y por eso «Compensación» va a cero cuando gana el FAS.'],
    ['Días extra', `La diferencia en días de ${num(cfg.horasMetaDia)} h, cuando pasa de un día. Informativo: no entra en el total.`],
    ['Salario base bruto', `Pestaña «Nómina base», del 26 del mes anterior al 25 de este: (rodadas − espera quitada + J + vacaciones + permisos) × ${eur2(cfg.eurHoraBase)} €, con TOPE en el salario base de su jornada (${eur2(cfg.sueldoBase40)} € con 40 h, ${eur2(cfg.sueldoBase32)} € con 32 h) prorrateado por sus días de contrato. Lo que pasa del tope lo pagan las variables; quien no llega cobra lo que hizo.`],
    ['Nómina entera', 'Salario base bruto (del 26 al 25, mes corriente) + el TOTAL de estas variables (el mes anterior, del 1 al último).'],
  ];
}

const DATOS = [
  ['Horas y nocturnas', 'Los tramos de BOLT ya ingeridos (viaje + espera), por DÍA NATURAL: del 1 a las 00:00 al último a las 23:59, con los ratos de dos cuentas que se pisan contados una vez. La bitácora mide la jornada 05:00 a 05:00, así que para quien trabaja de noche los dos números no coinciden, y es correcto.'],
  ['Utilización', 'Viaje ÷ (viaje + espera). La columna enseña la real, antes del recorte.'],
  ['Propinas, peajes y facturación', 'Las órdenes de BOLT ya ingeridas.'],
  ['Horas justificadas', 'Los justificantes APROBADOS, con sus horas: los mismos que pinta la bitácora.'],
  ['Vacaciones y permisos', 'Los tramos de estado de cada conductor (vacaciones y permiso), los mismos que lee Vacaciones.'],
  ['DNI, jornada y fecha de alta', 'La ficha del conductor y su periodo de empleo.'],
  ['Los dos nombres', 'El de BOLT, del padrón de la plataforma; el de la seguridad social, de la ficha de RRHH.'],
  ['Quién entra', 'Solo plantilla propia, y todo el que tuvo contrato algún día del mes, aunque sea con 0 horas. Los de ETT los paga la agencia y van en el «Parte de trabajo de la ETT»; quien pasó de la ETT a propia ese mes va en los dos, cada uno con sus días.'],
];

/** Alto de una fila con texto partido: unas 15 unidades por línea. */
const altoPara = (texto, anchoCols) => Math.max(18, Math.ceil(String(texto).length / (anchoCols * 1.15)) * 15 + 4);

function hojaComoSeCalculo(wb, idLogo, sub, cfg) {
  const ws = wb.addWorksheet('Cómo se calculó', { pageSetup: { ...PAGINA, orientation: 'portrait' } });
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 84;
  let fila = E.bandaCabecera(ws, idLogo, 'CÓMO SE CALCULÓ', sub, 3);

  const celda = (row, i, v, { fmt, negrita, tono: t, ajustar } = {}) => {
    const c = row.getCell(i);
    c.value = v;
    if (fmt) c.numFmt = fmt;
    c.border = E.TODOS_BORDES;
    c.font = { bold: !!negrita, color: { argb: t || E.TEXTO } };
    c.alignment = { vertical: 'top', wrapText: !!ajustar, horizontal: i === 2 ? 'right' : 'left' };
    return c;
  };

  // Parámetros
  fila = E.cabeceraTabla(ws, fila, ['Parámetro', 'Valor', 'Qué hace']);
  for (const [etiqueta, clave, fmt, que, entra] of PARAMS) {
    const row = ws.getRow(fila++);
    celda(row, 1, etiqueta, { negrita: entra, tono: entra ? E.DARK : E.TENUE });
    celda(row, 2, cfg[clave] == null ? null : Number(cfg[clave]), { fmt, negrita: entra, tono: entra ? E.DARK : E.TENUE });
    celda(row, 3, que, { ajustar: true, tono: entra ? E.TEXTO : E.TENUE });
    row.height = altoPara(que, 84);
  }

  // Cómo sale cada columna, y de dónde salen los datos: la explicación ocupa
  // las columnas B y C juntas.
  const tabla2 = (titulos, lineas) => {
    fila += 1;
    fila = E.cabeceraTabla(ws, fila, titulos);
    ws.mergeCells(fila - 1, 2, fila - 1, 3);
    for (const [quien, como] of lineas) {
      const row = ws.getRow(fila);
      celda(row, 1, quien, { negrita: true, tono: E.DARK });
      ws.mergeCells(fila, 2, fila, 3);
      const c = celda(row, 2, como, { ajustar: true });
      c.alignment = { vertical: 'top', wrapText: true, horizontal: 'left' };
      row.getCell(3).border = E.TODOS_BORDES;
      row.height = altoPara(como, 98);
      fila++;
    }
  };
  tabla2(['Columna', 'Cómo se calcula', ''], reglas(cfg));
  tabla2(['Dato', 'De dónde sale', ''], DATOS);

  const nota = ws.getRow(fila + 1).getCell(1);
  nota.value = 'Nada de esto se pide a ninguna API al generar la nómina ni se lee de ninguna hoja de cálculo: todo está en la base de datos.';
  nota.font = { size: 9, color: { argb: E.TENUE } };
}

// ── Hoja 2: la nómina base (16/10/2026) ─────────────────────────────────────
// La nómina entera de cada uno: el SALARIO BASE BRUTO del 26 del mes anterior
// al 25 de este (mes corriente) más el TOTAL de las variables del mes anterior
// (mes vencido, la hoja «Nómina»). Mientras el periodo no ha cerrado, la base
// va hasta ayer. Ver la regla 8 de nominas.service.js.

/** Los grupos encima de la cabecera: en qué paso del cálculo está cada columna. Devuelve la fila siguiente. */
function filaDeGrupos(ws, fila, grupos, dorado) {
  const n = grupos.length;
  const row = ws.getRow(fila);
  let desde = 1;
  for (let i = 2; i <= n + 1; i++) {
    if (i <= n && grupos[i - 1] === grupos[desde - 1]) continue;
    const nombre = grupos[desde - 1];
    if (i - 1 > desde) ws.mergeCells(fila, desde, fila, i - 1);
    for (let k = desde; k < i; k++) {
      const ck = row.getCell(k);
      ck.fill = E.relleno(nombre ? E.DARK : 'FFFFFFFF');
      if (nombre) ck.border = E.TODOS_BORDES;
    }
    const c = row.getCell(desde);
    c.value = nombre || null;
    c.font = { size: 9, bold: true, color: { argb: nombre === dorado ? E.GOLD : 'FFC9CED6' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    desde = i;
  }
  row.height = 18;
  return fila + 1;
}

const fechaTxt = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/** Lo que hay que saber de la base de alguien, en palabras. */
function notaBase(x, b) {
  const v = b.ventana, n = [];
  if (x.diasContrato === 0) {
    n.push('Sin contrato en este periodo: solo cobra sus variables');
  } else {
    if (x.diasContrato < v.diasPeriodo) {
      n.push(`Tope de ${x.diasContrato} de ${v.diasPeriodo} días` +
        (x.alta > v.desde ? ` (alta el ${fechaTxt(x.alta)})` : '') +
        (x.baja && x.baja < v.cierre ? ` (baja el ${fechaTxt(x.baja)})` : ''));
    }
    n.push(x.llegaAlTope
      ? (x.sobreElTope > 0 ? `Llega al tope: ${eur2(x.sobreElTope)} € de más, que se cobran por las variables` : 'Llega al tope')
      : `Le faltan ${eur2(x.faltaParaElTope)} € para el tope`);
  }
  if (x.diasVacaciones) n.push(`${x.diasVacaciones} ${x.diasVacaciones === 1 ? 'día' : 'días'} de vacaciones`);
  if (x.diasPermiso) n.push(`${x.diasPermiso} ${x.diasPermiso === 1 ? 'día' : 'días'} de permiso`);
  if (x.horasEsperaQuitadas > 0) n.push(`utilización ${h1(x.utilPct)} %: se le exige el ${pctTxt(b.config.utilExigida)}`);
  return n.join(' · ');
}

// [grupo, título, ancho, de dónde, formato]
const COL_BASE = [
  ['', 'Conductor', 32, x => x.nombreSS || x.nombre || '', null],
  ['', 'DNI/NIE', 11, x => x.dni || '', null],
  ['', 'Jornada', 8, x => (x.jornada ? x.jornada + ' h' : ''), null],
  ['', 'Días de contrato', 9, x => x.diasContrato, '0'],
  ['HORAS DE LA BASE', 'Rodadas', 9, x => x.horas, HORAS],
  ['HORAS DE LA BASE', '− Espera quitada', 10, x => x.horasEsperaQuitadas, HORAS],
  ['HORAS DE LA BASE', '+ Justificadas', 11, x => x.horasJustificadas, HORAS],
  ['HORAS DE LA BASE', '+ Vacaciones', 11, x => x.horasVacaciones, HORAS],
  ['HORAS DE LA BASE', '+ Permisos', 10, x => x.horasPermiso, HORAS],
  ['HORAS DE LA BASE', '= Horas base', 10, x => x.horasBase, HORAS],
  ['SALARIO BASE', '× € hora', 9, (x, b) => Number(b.config.eurHoraBase) || 0, DOS],
  ['SALARIO BASE', '= Importe', 12, x => x.importe, EUROS],
  ['SALARIO BASE', 'Tope de su jornada', 12, x => x.tope, EUROS],
  ['SALARIO BASE', 'SALARIO BASE BRUTO', 13, x => x.base, EUROS],
  ['NÓMINA', '+ Variables', 12, x => x.variables, EUROS],
  ['NÓMINA', 'TOTAL NÓMINA', 13, x => x.total, EUROS],
  ['', 'Nota', 64, (x, b) => notaBase(x, b), null],
];
const SUMA_BASE = new Set(['Rodadas', '− Espera quitada', '+ Justificadas', '+ Vacaciones', '+ Permisos', '= Horas base',
  '= Importe', 'Tope de su jornada', 'SALARIO BASE BRUTO', '+ Variables', 'TOTAL NÓMINA']);

function hojaNominaBase(wb, idLogo, b) {
  const ws = wb.addWorksheet('Nómina base', { pageSetup: PAGINA });
  COL_BASE.forEach(([, , ancho], i) => { ws.getColumn(i + 1).width = ancho; });
  const n = COL_BASE.length;
  const v = b.ventana, cfg = b.config;
  const iDe = titulo => COL_BASE.findIndex(c => c[1] === titulo) + 1;
  const deVariables = b.variablesDe ? `${b.variablesDe.mesNombre} ${b.variablesDe.ano}` : 'el mes anterior';
  const sub = `Nómina de ${b.mesNombre} ${b.ano} · base del ${fechaTxt(v.desde)} al ${fechaTxt(v.cierre)}` +
    (v.sinEmpezar ? ' — AÚN NO HA EMPEZADO' : v.enCurso
      ? ` — EN CURSO: con lo trabajado hasta el ${fechaTxt(v.hasta)} (${v.diasHastaAhora} de ${v.diasPeriodo} días)` : '') +
    ` · variables del trabajo de ${deVariables}${b.variablesDe && b.variablesDe.congelada ? ' (congeladas)' : ''}` +
    ` · hora base ${eur2(cfg.eurHoraBase)} € · tope ${eur2(cfg.sueldoBase40)} € con 40 h y ${eur2(cfg.sueldoBase32)} € con 32 h` +
    ` · ${b.filas.length} conductores · generado ${sello()}`;
  let fila = E.bandaCabecera(ws, idLogo, 'NÓMINA BASE · SALARIO BASE + VARIABLES', sub, n);
  fila = filaDeGrupos(ws, fila, COL_BASE.map(c => c[0]), 'NÓMINA');

  const filaCab = fila;
  const titulos = COL_BASE.map(c => (c[1] === '+ Variables' ? `+ Variables de ${deVariables.split(' ')[0].toLowerCase()}` : c[1]));
  fila = E.cabeceraTabla(ws, fila, titulos, { alto: 32, ajustar: true });
  const cabTotal = ws.getRow(filaCab).getCell(iDe('TOTAL NÓMINA'));
  cabTotal.fill = E.relleno(E.GOLD);
  cabTotal.font = { size: 10, bold: true, color: { argb: E.DARK } };
  const primera = fila;

  for (const x of b.filas) {
    const row = ws.getRow(fila++);
    COL_BASE.forEach(([, titulo, , saca, fmt], i) => {
      const c = row.getCell(i + 1);
      const val = saca(x, b);
      c.value = val === undefined ? null : val;
      if (fmt) c.numFmt = fmt;
      c.border = E.TODOS_BORDES;
      c.font = { color: { argb: x.diasContrato === 0 && i > 0 && titulo !== '+ Variables' && titulo !== 'TOTAL NÓMINA' ? E.TENUE : E.TEXTO } };
      c.alignment = { vertical: 'top', wrapText: titulo === 'Nota' };
    });
    row.getCell(iDe('SALARIO BASE BRUTO')).font = { bold: true, color: { argb: E.DARK } };
    const tot = row.getCell(iDe('TOTAL NÓMINA'));
    tot.font = { bold: true, color: { argb: E.DARK } };
    tot.fill = E.relleno(ORO_SUAVE);
    if (x.horasEsperaQuitadas > 0) tono(row.getCell(iDe('− Espera quitada')), AMBAR);
    // Quien llega al tope: la base está asegurada, y lo que pasa va a las variables.
    if (x.llegaAlTope) row.getCell(iDe('Tope de su jornada')).font = { bold: true, color: { argb: E.DARK } };
    row.height = altoPara(notaBase(x, b), 64);
  }

  const ultima = fila - 1;
  const pie = ws.getRow(fila);
  COL_BASE.forEach(([, titulo, , , fmt], i) => {
    const c = pie.getCell(i + 1);
    c.fill = E.relleno('FFF3F4F6');
    c.border = E.TODOS_BORDES;
    c.font = { bold: true, color: { argb: E.DARK } };
    if (!SUMA_BASE.has(titulo) || ultima < primera) return;
    const L = E.colLetra(i + 1);
    c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` };
    c.numFmt = fmt;
  });
  pie.getCell(1).value = `TOTAL (${b.filas.length})`;
  pie.getCell(iDe('TOTAL NÓMINA')).fill = E.relleno(E.GOLD);
  pie.height = 20;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: filaCab }];
  if (ultima >= primera) ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: ultima, column: n } };

  nota(ws, fila, [
    `SALARIO BASE BRUTO = (rodadas − espera quitada + justificadas + vacaciones + permisos) × ${eur2(cfg.eurHoraBase)} €, ` +
      'con TOPE en el salario base de su jornada, prorrateado por sus días de contrato del periodo.',
    `Cada día de vacaciones suma ${num(cfg.horasMetaDia * cfg.pctDiaVacaciones)} h (${num(cfg.horasMetaDia)} × ${pctTxt(cfg.pctDiaVacaciones)}, ` +
      `por día natural) y cada día de permiso retribuido ${num(cfg.horasMetaDia)} h. La espera se quita como en las variables: ` +
      `quien no llega al ${pctTxt(cfg.utilUmbral)} de utilización queda en el ${pctTxt(cfg.utilExigida)}.`,
    'Quien pasa del tope tiene su base asegurada: lo que pasa se cobra por las variables (el MBO de horas o el FAS). ' +
      'Quien no llega cobra lo que hizo.',
    'TOTAL NÓMINA = salario base bruto (del 26 al 25, mes corriente) + el TOTAL de las variables (el mes anterior, del 1 al último).',
    v.enCurso && !v.sinEmpezar
      ? 'El periodo aún no ha cerrado: la base va con lo trabajado hasta ayer contra el tope del periodo entero, así que casi nadie llega todavía.'
      : 'Solo plantilla propia: los de ETT los paga la agencia.',
  ]);
}

// ── Hoja 3: el resumen por conductor (16/10/2026) ───────────────────────────
// Camilo: «Hazme una pestaña con el resumen del cálculo por cada conductor con
// su total». La hoja de la nómina tiene todas las cifras; esta las pone EN EL
// ORDEN EN QUE SE CALCULAN —las horas que cuentan, la diferencia, los dos MBO y
// cuál gana, lo que se cobra— y, al final de cada fila, la cuenta escrita en
// palabras. Es la que se abre cuando alguien pregunta «¿por qué he cobrado
// esto?».
//
// Los números son los de la fila de la nómina, NO fórmulas: la nómina redondea
// cada pieza a céntimos, y una fórmula sobre las piezas redondeadas podría
// diferir en un céntimo del TOTAL de la otra hoja.

// Con el punto de los miles también en cuatro cifras («4.750,00»): el español
// de Intl no lo pone hasta las cinco, y en una cuenta de euros se lee mal.
const eur2 = x => {
  const [ent, dec] = Math.abs(Number(x) || 0).toFixed(2).split('.');
  return ((Number(x) || 0) < 0 ? '−' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
};
const h1 = x => (Number(x) || 0).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const umbralDe = (f, cfg) => (Number(f.jornada) === 32 ? cfg.umbralFAS32 : cfg.umbralFAS40);
const horasQueCuentan = f => Math.round(((Number(f.horas) || 0) - (Number(f.horasEsperaQuitadas) || 0)
  + (Number(f.horasJustificadas) || 0) + (Number(f.horasVacaciones) || 0) + (Number(f.horasPermiso) || 0)) * 100) / 100;
const ganaDe = f => (f.mboHsExt > f.mboFAS ? 'Horas extra' : f.mboFAS > 0 ? 'FAS' : '');

const ESTADO_TXT = { vacaciones: 'de vacaciones', permiso: 'de permiso', asuntos_propios: 'de asuntos propios', baja_medica: 'de baja' };

/** La cuenta de una persona, en palabras. */
function comoSale(f, cfg) {
  const p = [];
  // Las horas que cuentan
  let horas = `${h1(f.horas)} h rodadas`;
  if (f.horasEsperaQuitadas > 0) {
    horas += ` − ${h1(f.horasEsperaQuitadas)} de espera (utilización ${h1(f.utilPct)} %, por debajo del ` +
      `${pctTxt(cfg.utilUmbral)}: se le exige el ${pctTxt(cfg.utilExigida)})`;
  }
  if (f.horasJustificadas > 0) horas += ` + ${h1(f.horasJustificadas)} de J`;
  // Las J que no cuentan porque ese día tenía vacaciones, permiso o baja.
  const tapadas = f.jTapadas || [];
  if (tapadas.length) {
    const cual = t => `del ${String(t.fecha).slice(8, 10)}/${String(t.fecha).slice(5, 7)}, ${ESTADO_TXT[t.estado] || 'con otra marca'}`;
    horas += tapadas.length === 1
      ? ` (sin la J ${cual(tapadas[0])})`
      : ` (sin las J ${tapadas.slice(0, -1).map(cual).join('; ')} y ${cual(tapadas[tapadas.length - 1])})`;
  }
  if (f.horasVacaciones > 0) horas += ` + ${h1(f.horasVacaciones)} de vacaciones (${f.diasVacaciones} ${f.diasVacaciones === 1 ? 'día' : 'días'})`;
  if (f.horasPermiso > 0) horas += ` + ${h1(f.horasPermiso)} de permiso (${f.diasPermiso} ${f.diasPermiso === 1 ? 'día' : 'días'})`;
  if (f.horasEsperaQuitadas > 0 || f.horasJustificadas > 0 || f.horasVacaciones > 0 || f.horasPermiso > 0) {
    horas += ` = ${h1(horasQueCuentan(f))} h`;
  }
  const dif = Number(f.deltaHoras) || 0;
  p.push(`${horas} contra ${h1(f.horasObjetivo)} h de objetivo: ` +
    (dif > 0 ? `+${h1(dif)} h.` : `le faltan ${h1(-dif)} h.`));
  // Los dos MBO
  p.push(f.mboHsExt > 0
    ? `Horas extra: ${h1(dif)} h × ${eur2(cfg.eurHoraExtra)} € × ${h1(f.utilPct)} % = ${eur2(f.mboHsExt)} €.`
    : 'Sin MBO por horas extra.');
  const umbral = umbralDe(f, cfg);
  if (f.mboFAS > 0) {
    p.push(f.neto != null
      ? `FAS: (${eur2(f.neto)} − ${eur2(umbral)}) × ${pctTxt(cfg.pctMBOFAS)} = ${eur2(f.mboFAS)} €.`
      : `FAS: ${eur2(f.mboFAS)} €.`);
  } else {
    p.push(f.neto != null
      ? `FAS: factura ${eur2(f.neto)} €, no llega al umbral de ${eur2(umbral)} €.`
      : `Sin FAS: no llega al umbral de ${eur2(umbral)} €.`);
  }
  const mbo = Math.max(Number(f.mboHsExt) || 0, Number(f.mboFAS) || 0);
  if (f.mboHsExt > 0 && f.mboFAS > 0) p.push(`Se paga el ${ganaDe(f) === 'FAS' ? 'FAS' : 'de horas extra'}, que es el mayor.`);
  // La nocturnidad, con el mismo recorte que las horas (30/10/2026).
  if (f.nocturnasHorasQuitadas > 0) {
    const brutas = (Number(f.nocturnasHoras) || 0) + (Number(f.nocturnasHorasQuitadas) || 0);
    p.push(`Nocturnidad: ${h1(brutas)} h nocturnas − ${h1(f.nocturnasHorasQuitadas)} de la espera quitada = ` +
      `${h1(f.nocturnasHoras)} h × ${eur2((Number(cfg.eurHoraNoc) || 0) * (Number(cfg.factorNoc) || 0))} € = ${eur2(f.nocturnas)} €.`);
  }
  // Lo que se cobra
  const piezas = [[mbo, 'MBO'], [f.nocturnas, 'nocturnidad'], [f.propinas, 'propinas'], [f.peajes, 'peajes']]
    .filter(([v]) => Number(v) > 0);
  p.push(piezas.length > 1
    ? `Total: ${piezas.map(([v, que]) => `${eur2(v)} ${que}`).join(' + ')} = ${eur2(f.total)} €.`
    : piezas.length ? `Total: ${eur2(f.total)} €, todo de ${piezas[0][1]}.` : 'Total: 0,00 €.');
  return p.join(' ');
}

// [grupo, título, ancho, de dónde, formato]
const COL_RESUMEN = [
  ['', 'Conductor', 32, f => f.nombreSS || f.nombre || '', null],
  ['', 'DNI/NIE', 11, f => f.dni || '', null],
  ['', 'Jornada', 8, f => (f.jornada ? f.jornada + ' h' : ''), null],
  ['HORAS', 'Rodadas', 9, f => f.horas, HORAS],
  ['HORAS', '− Espera quitada', 10, f => f.horasEsperaQuitadas, HORAS],
  ['HORAS', '+ Justificadas', 11, f => f.horasJustificadas, HORAS],
  ['HORAS', '+ Vacaciones', 11, f => (f.horasVacaciones == null ? null : f.horasVacaciones), HORAS],
  ['HORAS', '+ Permisos', 10, f => (f.horasPermiso == null ? null : f.horasPermiso), HORAS],
  ['HORAS', '= Cuentan', 9, f => horasQueCuentan(f), HORAS],
  ['HORAS', 'Objetivo', 9, f => f.horasObjetivo, HORAS],
  ['HORAS', 'Diferencia', 10, f => f.deltaHoras, HORAS],
  ['HORAS', 'Utilización', 10, f => (f.utilPct == null ? null : f.utilPct), PCT],
  ['MBO (SE COBRA EL MAYOR)', 'Por horas extra', 11, f => f.mboHsExt, EUROS],
  ['MBO (SE COBRA EL MAYOR)', 'Facturación neta', 12, f => (f.neto == null ? null : f.neto), EUROS],
  ['MBO (SE COBRA EL MAYOR)', 'Umbral FAS', 11, (f, cfg) => umbralDe(f, cfg), EUROS],
  ['MBO (SE COBRA EL MAYOR)', 'FAS', 11, f => f.mboFAS, EUROS],
  ['MBO (SE COBRA EL MAYOR)', 'Gana', 11, f => ganaDe(f), null],
  ['LO QUE COBRA', 'MBO', 11, f => Math.max(Number(f.mboHsExt) || 0, Number(f.mboFAS) || 0), EUROS],
  ['LO QUE COBRA', 'Nocturnidad', 11, f => f.nocturnas, EUROS],
  ['LO QUE COBRA', 'Propinas', 10, f => f.propinas, EUROS],
  ['LO QUE COBRA', 'Peajes', 9, f => f.peajes, EUROS],
  ['LO QUE COBRA', 'TOTAL', 12, f => f.total, EUROS],
  ['', 'Cómo sale su total', 92, (f, cfg) => comoSale(f, cfg), null],
];
const SUMA_RESUMEN = new Set(['Rodadas', '− Espera quitada', '+ Justificadas', '+ Vacaciones', '+ Permisos', '= Cuentan',
  'Por horas extra', 'FAS', 'MBO', 'Nocturnidad', 'Propinas', 'Peajes', 'TOTAL']);

function hojaResumen(wb, idLogo, r, filas, cfg) {
  const ws = wb.addWorksheet('Resumen por conductor', { pageSetup: PAGINA });
  COL_RESUMEN.forEach(([, , ancho], i) => { ws.getColumn(i + 1).width = ancho; });
  const n = COL_RESUMEN.length;
  const iDe = titulo => COL_RESUMEN.findIndex(c => c[1] === titulo) + 1;
  const sub = `Nómina de ${r.mesNombre} ${r.ano} · trabajo de ${r.mesDatosNombre} ${r.anoDatos} · ` +
    `${filas.length} conductores de plantilla propia, de mayor a menor total · el cálculo de cada uno, en el orden en que se hace · generado ${sello()}`;
  let fila = E.bandaCabecera(ws, idLogo, 'RESUMEN POR CONDUCTOR', sub, n);

  // Los grupos, encima de la cabecera: dicen en qué paso del cálculo está cada
  // columna.
  fila = filaDeGrupos(ws, fila, COL_RESUMEN.map(c => c[0]), 'LO QUE COBRA');

  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, COL_RESUMEN.map(c => c[1]), { alto: 32, ajustar: true });
  const cabTotal = ws.getRow(filaCab).getCell(iDe('TOTAL'));
  cabTotal.fill = E.relleno(E.GOLD);
  cabTotal.font = { size: 10, bold: true, color: { argb: E.DARK } };
  const primera = fila;

  // De mayor a menor total (Camilo, 16/10/2026); con el mismo total, por nombre.
  const orden = [...filas].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0)
    || String(a.nombreSS || a.nombre || '').localeCompare(String(b.nombreSS || b.nombre || ''), 'es'));
  for (const f of orden) {
    const row = ws.getRow(fila++);
    COL_RESUMEN.forEach(([, titulo, , saca, fmt], i) => {
      const c = row.getCell(i + 1);
      const v = saca(f, cfg);
      c.value = v === undefined ? null : v;
      if (fmt) c.numFmt = fmt;
      c.border = E.TODOS_BORDES;
      c.font = { color: { argb: E.TEXTO } };
      c.alignment = { vertical: 'top', wrapText: titulo === 'Cómo sale su total' };
    });
    const tot = row.getCell(iDe('TOTAL'));
    tot.font = { bold: true, color: { argb: E.DARK } };
    tot.fill = E.relleno(ORO_SUAVE);
    if (f.horasEsperaQuitadas > 0) tono(row.getCell(iDe('− Espera quitada')), AMBAR);
    if (f.deltaHoras < 0) row.getCell(iDe('Diferencia')).font = { color: { argb: ROJO.fg } };
    if (ganaDe(f)) row.getCell(iDe('Gana')).font = { bold: true, color: { argb: E.DARK } };
    row.height = altoPara(comoSale(f, cfg), 92);
  }

  const ultima = fila - 1;
  const pie = ws.getRow(fila);
  COL_RESUMEN.forEach(([, titulo, , , fmt], i) => {
    const c = pie.getCell(i + 1);
    c.fill = E.relleno('FFF3F4F6');
    c.border = E.TODOS_BORDES;
    c.font = { bold: true, color: { argb: E.DARK } };
    if (!SUMA_RESUMEN.has(titulo) || ultima < primera) return;
    const L = E.colLetra(i + 1);
    c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` };
    c.numFmt = fmt;
  });
  pie.getCell(1).value = `TOTAL (${filas.length})`;
  pie.getCell(iDe('TOTAL')).fill = E.relleno(E.GOLD);
  pie.height = 20;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: filaCab }];
  if (ultima >= primera) ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: ultima, column: n } };

  if (filas.some(f => f.neto == null)) {
    const c = ws.getRow(fila + 2).getCell(1);
    c.value = 'Esta nómina se congeló antes de guardar la facturación neta: el FAS va con su importe, sin la facturación de la que sale.';
    c.font = { size: 9, color: { argb: E.TENUE } };
  }
}

/** nomina-variable-septiembre-2026.xlsx */
function nombreFichero(r) {
  const mes = (r.mesNombre || '').toLowerCase() || String(r.mes);
  return `nomina-variable-${mes}-${r.ano}.xlsx`;
}

// ════════════════════════════════════════════════════════════════════════════
// EL PARTE DE LA ETT
// ════════════════════════════════════════════════════════════════════════════
// A quien viene por agencia lo contrata y lo paga ella. Nosotros le medimos el
// trabajo y se lo facturamos: esto no es una nómina, es LO QUE LE COSTAMOS.
//
// El formato es el que la agencia ya usa, columna por columna. No se ha
// "mejorado" ninguna: un fichero de intercambio lo lee alguien que tiene el
// suyo al lado y lo compara a ojo, y una columna que baila hace dudar de todo
// lo demás. Lo único añadido es la FECHA DE BAJA, que hacía falta.
//
//   Conductor · DNI/NIE · Fecha incorporación · Fecha baja · HORAS · €/h ·
//   €/Total · Horas Nocturnas · Plus Nocturnidad · Total Plus Nocturnidad ·
//   Total coste trabajador · Propinas € · Peajes €
//
// LAS TRES CUENTAS, que son las que la agencia va a repasar:
//   €/Total                = HORAS × €/h
//   Total Plus Nocturnidad = Horas Nocturnas × Plus Nocturnidad
//   Total coste trabajador = €/Total + Total Plus Nocturnidad
//
// EL PLUS NOCTURNO ES € POR HORA (1,31 € cada hora nocturna), no un
// porcentaje. No se parece en nada al de la nómina de casa —que es € hora ×
// horas × un factor— y mezclarlos sería facturar mal.
//
// LAS HORAS LLEVAN EL RECORTE POR UTILIZACIÓN, igual que las de casa. La hora
// de espera de quien no llega al mínimo no se le paga a un conductor nuestro y
// tampoco se le factura a la agencia: es la misma hora y vale lo mismo, la
// cobre quien la cobre. La SEGUNDA PESTAÑA existe para eso: dice a quién se le
// ha descontado, cuánto, y con qué utilización — que es el argumento.
//
// Y va por mes TRABAJADO, no a mes vencido: se elige agosto y salen los datos
// de agosto. La nómina va a mes vencido porque es un pago; un parte de trabajo
// lleva el mes que dice. El subtítulo lo repite para que nadie lo confunda.

// Los importes van en el formato de CONTABILIDAD de arriba (`CONTA`): un cero
// sale como "- €", que es como lo tiene la agencia en su hoja.
const HORAS_ETT = '#,##0.0#';
const FECHA = 'd/m/yyyy';

/**
 * 'AAAA-MM-DD' a una fecha que Excel escriba EN SU DÍA.
 *
 * En UTC a propósito. Un `new Date('2026-07-09')` local es medianoche de
 * Madrid, y esa medianoche en UTC es el día 8 a las 22:00: Excel guarda el
 * instante y al abrirlo se lee el 8. Es el mismo fallo que ya se documentó en
 * el proyecto con las fechas de PostgreSQL, y que se coló una vez entero en el
 * Excel de la gestoría: 249 fechas de ingreso, todas un día antes.
 */
function fechaUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

// Título, ancho, de dónde sale y con qué formato. El orden es el de su hoja.
const COL_ETT = [
  ['Conductor', 34, f => f.nombreSS || f.nombre, null],
  ['DNI/NIE', 13, f => f.dni, null],
  ['Fecha incorporación', 17, f => fechaUTC(f.alta), FECHA],
  ['Fecha baja', 13, f => fechaUTC(f.bajaEnElMes), FECHA],
  ['HORAS', 10, f => f.horasTrabajadas, HORAS_ETT],
  ['€/h', 8, (f, r) => r.eurHora, '#,##0.00'],
  ['€/Total', 12, f => f.importeHoras, '#,##0.00'],
  ['Horas Nocturnas', 14, f => f.nocturnasHoras, HORAS_ETT],
  ['Plus Nocturnidad', 14, (f, r) => r.plusNocturno, '#,##0.00'],
  ['Total Plus Nocturnidad', 18, f => f.plusNocturno, CONTA],
  ['Total coste trabajador', 18, f => f.costeTrabajador, CONTA],
  ['Propinas €', 11, f => f.propinas, CONTA],
  ['Peajes €', 10, f => f.peajes, CONTA],
];

// La segunda pestaña: por qué a alguien se le pagan menos horas de las que
// estuvo conectado. Sin esto, el recorte es un número que la agencia no puede
// discutir ni comprobar, y lo primero que hace un número así es no creerse.
const COL_DESCUENTO = [
  ['Conductor', 34, f => f.nombreSS || f.nombre, null],
  ['DNI/NIE', 13, f => f.dni, null],
  ['Horas conectado', 14, f => f.horas, HORAS_ETT],
  ['De las cuales, en viaje', 18, f => f.horasViaje, HORAS_ETT],
  ['De las cuales, esperando', 19, f => f.horasEspera, HORAS_ETT],
  ['% Utilización', 12, f => (f.utilPct == null ? null : f.utilPct / 100), '0.0%'],
  ['Exigido', 10, (f, r) => r.utilExigida, '0.0%'],
  ['Horas de espera descontadas', 22, f => f.horasEsperaQuitadas, HORAS_ETT],
  ['Horas justificadas', 15, f => f.horasJustificadas, HORAS_ETT],
  ['HORAS QUE SE PAGAN', 18, f => f.horasTrabajadas, HORAS_ETT],
  ['Importe descontado', 16, f => f.importeDescontado, CONTA],
  // Las nocturnas llevan el mismo recorte (30/10/2026): la parte nocturna de la
  // espera descontada, y lo que deja de costar de plus.
  ['Horas nocturnas descontadas', 16, f => f.nocturnasHorasQuitadas || 0, HORAS_ETT],
  ['Plus nocturno descontado', 15, f => f.plusNocturnoDescontado || 0, CONTA],
];

/** Pinta una tabla con la banda de la casa, su cabecera, su pie y su filtro. */
function tabla(ws, idLogo, titulo, subtitulo, columnas, filas, r, { realce, etiquetaTotal } = {}) {
  columnas.forEach(([, ancho], i) => { ws.getColumn(i + 1).width = ancho; });
  ws.pageSetup = { ...ws.pageSetup, ...PAGINA };
  let fila = E.bandaCabecera(ws, idLogo, titulo, subtitulo, columnas.length);
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, columnas.map(c => c[0]), { alto: 32, ajustar: true });
  const primera = fila;

  for (const f of filas) {
    const row = ws.getRow(fila++);
    columnas.forEach(([, , saca, fmt], i) => {
      const c = row.getCell(i + 1);
      const v = saca(f, r);
      c.value = v === undefined ? null : v;
      if (fmt) c.numFmt = fmt;
      c.border = E.TODOS_BORDES;
      c.font = { color: { argb: E.TEXTO } };
    });
    if (realce) realce(row, f);
  }

  const ultima = fila - 1;
  const pie = ws.getRow(fila);
  pie.getCell(1).value = etiquetaTotal || `TOTAL (${filas.length})`;
  pie.getCell(1).font = { bold: true };
  columnas.forEach(([, , , fmt], i) => {
    const c = pie.getCell(i + 1);
    c.fill = E.relleno('FFF3F4F6');
    c.border = E.TODOS_BORDES;
    // Solo se suma lo que tiene sentido sumar. Un precio por hora repetido en
    // doscientas filas no se suma, y un porcentaje tampoco: sumarlos daría un
    // número sin significado en negrita, que es peor que una celda vacía.
    const sumable = fmt && fmt !== FECHA && !/%/.test(fmt) && !['€/h', 'Plus Nocturnidad', 'Exigido'].includes(columnas[i][0]);
    if (!sumable || ultima < primera) return;
    const L = E.colLetra(i + 1);
    c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` };
    c.numFmt = fmt;
    c.font = { bold: true };
  });

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: filaCab }];
  if (ultima >= primera) {
    ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: ultima, column: columnas.length } };
  }
  return fila;
}

/** Una nota al pie, en pequeño. Este fichero sale de la empresa. */
function nota(ws, fila, lineas) {
  lineas.forEach((t, i) => {
    const c = ws.getRow(fila + 2 + i).getCell(1);
    c.value = t;
    c.font = { size: 9, color: { argb: E.TENUE } };
  });
}

/** El parte de la ETT de un mes trabajado. Devuelve los bytes. */
async function generarExcelETT(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const idLogo = E.registrarLogo(wb);

  const sub = `Personal de ETT · TRABAJO DE ${r.mesNombre.toUpperCase()} ${r.ano}` +
    ` (no es a mes vencido: son los datos de ese mismo mes) · ${r.filas.length} conductores` +
    (r.bajasEnElMes ? ` · ${r.bajasEnElMes} baja(s) en el mes` : '') +
    (r.trabajoIncompleto ? ' · ¡EL MES AÚN NO HA TERMINADO!' : '') + ` · generado ${sello()}`;

  // ── Pestaña 1: el parte ───────────────────────────────────────────────────
  const ws = wb.addWorksheet(`ETT ${r.mesNombre} ${r.ano}`);
  const fin = tabla(ws, idLogo, 'PARTE DE TRABAJO · ETT', sub, COL_ETT, r.filas, r, {
    // A quien causó baja ese mes, marcado: es lo primero que la agencia busca.
    realce: (row, f) => {
      if (!f.bajaEnElMes) return;
      const c = row.getCell(4);
      c.fill = E.relleno('FFFEE2E2');
      c.font = { bold: true, color: { argb: 'FF991B1B' } };
    },
  });
  nota(ws, fin, [
    `€/Total = HORAS × ${r.eurHora} €/h.  Total Plus Nocturnidad = Horas Nocturnas × ${r.plusNocturno} € ` +
      '(es € POR HORA nocturna, no un porcentaje).  Total coste trabajador = la suma de los dos.',
    'HORAS = lo rodado en BOLT, menos las horas de espera descontadas por baja utilización, más las ' +
      'horas justificadas (cada J aprobada suma las horas que se le pusieron al justificarla). ' +
      'Las Horas Nocturnas llevan el mismo descuento: sin la parte nocturna de esa espera.',
    'Sale todo el que tuvo contrato con la agencia algún día del mes, aunque sea con 0 horas; quien pasó ' +
      'a plantilla propia sale con su Fecha baja y solo con los días de la agencia.',
    'El detalle de los descuentos, con el porcentaje de utilización de cada uno, está en la segunda pestaña.',
    'Las horas van por día natural: del día 1 a las 00:00 al último a las 23:59.',
  ]);

  // ── Pestaña 2: por qué se descuenta ──────────────────────────────────────
  const conDescuento = r.filas.filter(f => f.horasEsperaQuitadas > 0.005);
  const wd = wb.addWorksheet('Horas descontadas');
  const fin2 = tabla(wd, idLogo, 'HORAS DESCONTADAS POR UTILIZACIÓN',
    `${conDescuento.length} de ${r.filas.length} conductores no llegan al ` +
    `${(r.utilUmbral * 100).toFixed(0)} % de utilización: se les exige el ${(r.utilExigida * 100).toFixed(0)} % · ` +
    `${r.totales.horasEsperaQuitadas} h descontadas en total · trabajo de ${r.mesNombre} ${r.ano}`,
    COL_DESCUENTO, conDescuento, r, {
      realce: (row, f) => {
        const c = row.getCell(6);
        c.fill = E.relleno('FFFEE2E2');
        c.font = { bold: true, color: { argb: 'FF991B1B' } };
      },
    });
  nota(wd, fin2, [
    'La UTILIZACIÓN es el tiempo en viaje sobre el tiempo conectado: viaje ÷ (viaje + espera). ' +
      'Mide cuánto de lo que se factura es servicio y cuánto es esperar.',
    `Quien llega al ${(r.utilUmbral * 100).toFixed(0)} % no pierde nada. A quien no llega se le exige el ` +
      `${(r.utilExigida * 100).toFixed(0)} %: se le retiran horas DE ESPERA —nunca de viaje— hasta dejarlo exactamente ahí.`,
    'Nunca se descuenta más espera de la que esa persona tuvo: sale de la propia fórmula, ' +
      'X = (viaje + espera) − viaje ÷ exigida.',
    'Las HORAS NOCTURNAS llevan el mismo recorte: de la espera descontada se va también su parte nocturna, ' +
      'en la misma proporción. El viaje nocturno no se toca.',
    `A quien llega al ${(r.utilUmbral * 100).toFixed(0)} % no se le quita nada, y por eso no aparece en esta pestaña.`,
  ]);

  return wb.xlsx.writeBuffer();
}

/** El MBO que se paga: el mayor de los dos, como en `calcularFila`. */
const mboDe = f => Math.max(Number(f.mboHsExt) || 0, Number(f.mboFAS) || 0);

/** '2026-09-11' → '11/09/2026'. Un finiquito lo lee una persona, no una máquina. */
const enDiaMesAno = iso => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))
  ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * EL FINIQUITO DE LA VARIABLE: lo que se le debe a quien se va.
 *
 * Una fila por concepto y un bloque por mes, en vez de la tabla ancha de la
 * nómina: aquí se mira UNA persona y lo que importa es de dónde sale cada euro,
 * no comparar a nadie con nadie. Quien lo abre está a punto de pagar.
 */
async function generarExcelFiniquito(r) {
  const p = r.persona;
  const avisos = [
    'Estas son las dos nóminas variables que quedan por pagar: la del mes anterior a la baja ' +
      '—que se habría pagado el mes de la baja— y la del propio mes de la baja.',
  ];
  const mesBaja = r.meses.find(m => m.esMesDeLaBaja);
  if (mesBaja && mesBaja.diasDeAlta < mesBaja.diasDelMes) {
    avisos.push('OJO CON EL OBJETIVO DE HORAS DEL MES DE LA BAJA: se prorratea desde la fecha de alta, ' +
      `pero NO hasta la de baja. A esta persona se le pide el objetivo del mes entero ` +
      `(${mesBaja.fila ? mesBaja.fila.horasObjetivo : '—'} h) habiendo estado de alta ${mesBaja.diasDeAlta} ` +
      `de ${mesBaja.diasDelMes} días, así que su diferencia sale negativa y no cobra MBO por horas extra.`);
  }
  return libroDeMeses(r, {
    hoja: 'Finiquito variable',
    titulo: `COMPENSACIÓN VARIABLE PENDIENTE · ${p.nombre}`,
    subtitulo: `DNI ${p.dni || '—'} · alta ${enDiaMesAno(p.alta)} · baja ${enDiaMesAno(p.baja)}` +
      (p.motivoBaja ? ` (${p.motivoBaja.toLowerCase()})` : '') +
      ` · jornada ${p.jornada || '—'} h · generado ${sello()}`,
    etiquetaTotal: 'TOTAL A PAGAR',
    avisos,
  });
}

/**
 * LAS EXTRAS DE QUIEN SIGUE DE ALTA, de los meses elegidos (06/10/2026). El
 * mismo libro que el finiquito: el resumen de cada mes y una pestaña por mes,
 * día a día.
 */
async function generarExcelExtras(r) {
  const p = r.persona;
  const enCurso = r.meses.find(m => m.enCurso);
  const avisos = [
    `Las extras de ${r.meses.length === 1 ? 'un mes' : r.meses.length + ' meses'}, tal y como las calcula la nómina de cada uno. ` +
      'Son meses TRABAJADOS: la nómina de cada uno se paga el mes siguiente.',
  ];
  if (enCurso) {
    avisos.push(`${enCurso.etiqueta.toUpperCase()} AÚN NO HA TERMINADO: va con lo trabajado hasta hoy y contra el objetivo ` +
      'del mes entero, así que su diferencia de horas sale baja y el MBO por horas extra todavía no se ha ganado. ' +
      'La nocturnidad, las propinas y los peajes de los días que ya han pasado sí son los buenos.');
  }
  return libroDeMeses(r, {
    hoja: 'Extras',
    titulo: `EXTRAS · ${p.nombre}`,
    subtitulo: `DNI ${p.dni || '—'} · alta ${enDiaMesAno(p.alta)}` +
      (p.baja ? ` · baja ${enDiaMesAno(p.baja)}` : '') +
      ` · jornada ${p.jornada || '—'} h · ${r.meses.map(m => m.etiqueta).join(', ')} · generado ${sello()}`,
    etiquetaTotal: r.meses.length > 1 ? 'TOTAL DE LOS MESES ELEGIDOS' : 'TOTAL',
    avisos,
  });
}

/**
 * El libro de uno o varios meses de UNA persona: la hoja resumen (un bloque por
 * mes, con lo que se paga y por qué) y una pestaña por mes, día a día.
 */
async function libroDeMeses(r, { hoja, titulo, subtitulo, etiquetaTotal, avisos }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const idLogo = E.registrarLogo(wb);
  const p = r.persona;
  const ws = wb.addWorksheet(hoja);

  const COLS = [
    ['Concepto', 42], ['Cantidad', 14], ['Importe', 14],
  ];
  COLS.forEach(([, ancho], i) => { ws.getColumn(i + 1).width = ancho; });

  let fila = E.bandaCabecera(ws, idLogo, titulo, subtitulo, COLS.length);

  const linea = (texto, cantidad, importe, { fuerte = false, tono = null } = {}) => {
    const row = ws.getRow(fila++);
    row.getCell(1).value = texto;
    row.getCell(2).value = cantidad === undefined ? null : cantidad;
    row.getCell(3).value = importe === undefined ? null : importe;
    if (importe !== undefined && importe !== null) row.getCell(3).numFmt = '#,##0.00 €';
    [1, 2, 3].forEach(i => {
      const c = row.getCell(i);
      c.border = E.TODOS_BORDES;
      c.font = { size: 11, bold: fuerte, color: { argb: tono || E.TEXTO } };
      c.alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'right', indent: i === 1 ? 1 : 0 };
      if (fuerte) c.fill = E.relleno('FFF3F4F6');
    });
    return row;
  };

  r.meses.forEach(m => {
    const cab = ws.getRow(fila++);
    ws.mergeCells(`A${cab.number}:C${cab.number}`);
    const c = cab.getCell(1);
    c.value = `${m.etiqueta.toUpperCase()}${m.esMesDeLaBaja ? '  ·  MES DE LA BAJA' : ''}` +
      `${m.enCurso ? '  ·  EN CURSO, HASTA HOY' : ''}` +
      `   —   ${m.diasDeAlta} de ${m.diasDelMes} días de alta`;
    c.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = E.relleno(m.esMesDeLaBaja ? 'FF7C2D12' : m.enCurso ? 'FF92400E' : 'FF374151');
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c.border = E.TODOS_BORDES;
    cab.height = 20;

    const f = m.fila;
    if (!f) { linea('Sin actividad en este mes', null, 0); return; }
    linea('Horas nocturnas', f.nocturnasHoras, f.nocturnas);
    if (f.nocturnasHorasQuitadas > 0) linea('   Horas nocturnas descontadas con la espera (baja utilización)', -f.nocturnasHorasQuitadas, null);
    linea('Propinas', null, f.propinas);
    linea('Peajes', null, f.peajes);
    // El MBO que se paga es el MAYOR de los dos. `compensacion` es solo lo que
    // puso el de horas extra, y cuando ganaba el de facturación esta línea salía
    // a 0 aunque el total sí lo llevaba (corregido el 06/10/2026).
    linea('MBO (el mayor de horas extra y facturación)', null, mboDe(f));
    linea(`Total de ${m.etiqueta}`, null, f.total, { fuerte: true });

    // El detalle que explica por qué el MBO es el que es. `f.horas` es lo
    // rodado TAL CUAL: el descuento por baja utilización va en su línea (hasta
    // el 06/10/2026 la etiqueta decía «ya descontada» y no lo estaba).
    linea('   Horas rodadas (viaje + espera)', f.horas, null);
    if (f.horasEsperaQuitadas > 0) linea('   Horas de espera descontadas por baja utilización', -f.horasEsperaQuitadas, null);
    linea('   Horas justificadas', f.horasJustificadas, null);
    if (f.horasVacaciones > 0 || f.horasPermiso > 0) {
      linea('   Vacaciones y permisos', Math.round(((Number(f.horasVacaciones) || 0) + (Number(f.horasPermiso) || 0)) * 100) / 100, null);
    }
    linea('   Objetivo del mes según su jornada', f.horasObjetivo, null);
    linea('   Diferencia sobre el objetivo', f.deltaHoras, null);
    fila++;
  });

  const tot = linea(etiquetaTotal, null, r.total, { fuerte: true });
  tot.getCell(3).font = { size: 12, bold: true, color: { argb: 'FF065F46' } };
  tot.height = 22;

  nota(ws, fila + 1, [
    ...avisos,
    'El desglose de cada mes, día a día (horas, J, nocturnidad, propinas, peajes y facturación), ' +
      'está en las pestañas «Día a día».',
    'Las cifras son las MISMAS que enseña la pantalla de Nóminas para esos meses: este documento ' +
      'no recalcula nada por su cuenta.',
    'Las horas van por día natural (del 1 a las 00:00 al último a las 23:59) y las nocturnas son ' +
      'el trozo entre las 22:00 y las 06:00.',
  ]);

  // ── Una pestaña por mes, día a día (06/10/2026) ──────────────────────────
  r.meses.forEach(m => hojaDiaADia(wb, idLogo, p, m, r.config || {}));
  return wb.xlsx.writeBuffer();
}

const DIA_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Lo que hay que saber de un día, en palabras. Vacío si fue un día normal. */
function notaDelDia(d) {
  const n = [];
  if (d.esLaBaja) n.push('Día de la baja');
  else if (d.despuesDeLaBaja) n.push('De baja');
  if (d.antesDelAlta) n.push('Aún sin alta');
  if (d.jAprobada && !d.jAntesDelArranque) n.push(d.jSinHoras ? 'J aprobada sin horas: no suma' : 'J aprobada');
  if (d.jAntesDelArranque) n.push('J aprobada antes de su alta: no cuenta');
  if (d.jPendiente) n.push('J pendiente de aprobar: no cuenta');
  if (d.jTapada) n.push(`J ${d.jTapadaAprobada ? 'aprobada' : 'pendiente'} en un día ${ESTADO_TXT[d.jTapada] || 'con otra marca'}: no cuenta`);
  if (d.permiso) n.push(d.horasVacPerm ? 'Permiso retribuido' : 'Permiso retribuido (fuera de su mes: no cuenta)');
  else if (d.vacaciones) n.push(d.horasVacPerm ? 'Vacaciones' : 'Vacaciones (fuera de su mes: no cuentan)');
  if (d.hoy) n.push('Hoy: el día va a medias');
  if (d.futuro) n.push('Aún no ha llegado');
  return n.join(' · ');
}

// Cero se deja en blanco: en un mes de treinta días, una columna llena de
// ceros esconde los días que sí tienen algo.
const o = v => (v ? v : null);

const COL_DIA = [
  ['Fecha', 11, d => fechaUTC(d.fecha), FECHA],
  ['Día', 11, d => DIA_SEMANA[fechaUTC(d.fecha).getUTCDay()], null],
  ['Horas rodadas', 12, d => o(d.horas), DOS],
  ['En viaje', 10, d => o(d.viaje), DOS],
  ['Esperando', 11, d => o(d.espera), DOS],
  ['Horas justificadas (J)', 14, d => o(d.horasJustificadas), DOS],
  ['Vacaciones y permisos (h)', 13, d => o(d.horasVacPerm), DOS],
  ['Horas nocturnas', 12, d => o(d.nocturnasHoras), DOS],
  ['Nocturnidad', 13, d => o(d.nocturnas), CONTA],
  ['Propinas', 12, d => o(d.propinas), CONTA],
  ['Peajes', 11, d => o(d.peajes), CONTA],
  ['Extras del día', 14, d => o(d.extras), CONTA],
  ['Facturación neta', 15, d => o(d.neto), CONTA],
  ['Nota', 40, d => notaDelDia(d) || null, null],
];

/**
 * UN MES DÍA A DÍA: lo que hizo cada día de nocturnidad, propinas, peajes…
 *
 * Debajo del total va la fila «Según la nómina» con las cifras de su fila del
 * mes: tienen que salir iguales, porque los días salen de las mismas consultas.
 * Y lo que no se reparte por días —el descuento por baja utilización y el
 * MBO— va aparte, con su porqué.
 */
function hojaDiaADia(wb, idLogo, p, m, cfg) {
  const ws = wb.addWorksheet(`Día a día · ${m.etiqueta}`.slice(0, 31));
  const f = m.fila;
  const sub = `${p.nombre} · DNI ${p.dni || '—'} · ${m.esMesDeLaBaja ? 'mes de la baja · ' : ''}` +
    `${m.enCurso ? 'EN CURSO, con los datos hasta hoy · ' : ''}` +
    `${m.diasDeAlta} de ${m.diasDelMes} días de alta · día natural (00:00 a 23:59) · ` +
    `nocturnidad = horas de 22:00 a 06:00 × ${String(cfg.eurHoraNoc).replace('.', ',')} € × ` +
    String(cfg.factorNoc).replace('.', ',');
  const ultima = tabla(ws, idLogo, `DÍA A DÍA · ${m.etiqueta.toUpperCase()}`, sub, COL_DIA, m.dias || [], {}, {
    etiquetaTotal: 'TOTAL DEL MES',
    realce: (row, d) => {
      if (d.despuesDeLaBaja || d.antesDelAlta || d.futuro) {
        for (let i = 1; i <= COL_DIA.length; i++) row.getCell(i).font = { color: { argb: E.TENUE } };
      }
      if (d.esLaBaja) {
        [1, 2, COL_DIA.length].forEach(i => {
          row.getCell(i).fill = E.relleno('FFFEE2E2');
          row.getCell(i).font = { bold: true, color: { argb: 'FF991B1B' } };
        });
      }
      if (d.horasJustificadas > 0) row.getCell(6).fill = E.relleno('FFFEF3C7');
    },
  });

  // «Según la nómina»: la fila del mes, columna a columna.
  let fila = ultima + 1;
  const seg = ws.getRow(fila++);
  const pon = (col, v, fmt) => {
    const c = seg.getCell(col);
    c.value = v;
    if (fmt) c.numFmt = fmt;
    c.font = { italic: true, color: { argb: E.TENUE } };
    c.border = E.TODOS_BORDES;
  };
  pon(1, 'Según la nómina');
  const nocQuitadas = f ? Number(f.nocturnasHorasQuitadas) || 0 : 0;
  const nocQuitadasEur = nocQuitadas * (Number(cfg.eurHoraNoc) || 0) * (Number(cfg.factorNoc) || 0);
  if (f) {
    pon(3, f.horas, DOS); pon(4, f.horasViaje, DOS); pon(5, f.horasEspera, DOS);
    pon(6, f.horasJustificadas, DOS);
    pon(7, Math.round(((Number(f.horasVacaciones) || 0) + (Number(f.horasPermiso) || 0)) * 100) / 100, DOS);
    // Las nocturnas ANTES del recorte, que es lo que suman los días: el
    // descuento se decide con el mes entero y va abajo, en su línea.
    pon(8, Math.round((f.nocturnasHoras + nocQuitadas) * 100) / 100, DOS); pon(9, Math.round((f.nocturnas + nocQuitadasEur) * 100) / 100, CONTA);
    pon(10, f.propinas, CONTA); pon(11, f.peajes, CONTA);
    pon(12, Math.round((f.nocturnas + nocQuitadasEur + f.propinas + f.peajes) * 100) / 100, CONTA);
  } else {
    pon(3, 'sin fila en la nómina: no trabajó ese mes');
  }

  // Lo que se decide con el mes entero, y el total a pagar.
  const COL_EUROS = 12;
  const resumen = (texto, valor, fmt, { fuerte = false } = {}) => {
    const row = ws.getRow(fila++);
    ws.mergeCells(row.number, 1, row.number, COL_EUROS - 1);
    row.getCell(1).value = texto;
    row.getCell(1).font = { bold: fuerte, color: { argb: E.TEXTO } };
    row.getCell(1).alignment = { horizontal: 'right' };
    const c = row.getCell(COL_EUROS);
    c.value = valor;
    c.numFmt = fmt;
    c.font = { bold: fuerte };
    c.border = E.TODOS_BORDES;
    if (fuerte) c.fill = E.relleno('FFF3F4F6');
  };
  fila++;
  if (f) {
    if (f.horasEsperaQuitadas > 0) {
      resumen('Horas de espera descontadas por baja utilización (se mide con el mes entero, no por días)',
        -f.horasEsperaQuitadas, DOS);
    }
    if (nocQuitadas > 0) {
      resumen(`Nocturnidad descontada con esa espera: ${nocQuitadas.toFixed(2).replace('.', ',')} h nocturnas (se mide con el mes entero, no por días)`,
        -Math.round(nocQuitadasEur * 100) / 100, CONTA);
    }
    resumen('MBO del mes, el mayor de horas extra y facturación (se gana con el mes entero, no por días)',
      mboDe(f), CONTA);
    resumen(`TOTAL A PAGAR DE ${m.etiqueta.toUpperCase()}`, f.total, CONTA, { fuerte: true });
  }

  nota(ws, fila, [
    'Cada día es un día natural, de 00:00 a 23:59: un turno de noche reparte sus horas entre los dos días que toca.',
    'Horas rodadas = viaje + espera, con los ratos que se pisan entre dos cuentas contados una sola vez.',
    'Una J aprobada suma las horas que se le pusieron al justificarla, encima de lo rodado ese día; una sin horas no suma, y las pendientes no cuentan hasta que se aprueben.',
    `Cada día de vacaciones suma ${String(Math.round(cfg.horasMetaDia * cfg.pctDiaVacaciones * 100) / 100).replace('.', ',')} h ` +
      `(por día natural) y cada día de permiso retribuido ${String(cfg.horasMetaDia).replace('.', ',')} h, desde que arranca su mes y hasta la baja.`,
    'Extras del día = nocturnidad + propinas + peajes. La facturación neta solo cuenta para el MBO de facturación.',
    'La fila «Según la nómina» es la de la pantalla de Nóminas para ese mes: tiene que coincidir con el total de los días.',
  ]);
}

/** finiquito-variable-arcos-alcivar-genesis.xlsx */
const nombreFicheroFiniquito = r => 'finiquito-variable-' +
  String(r.persona.nombre || 'conductor').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.xlsx';

/** parte-ett-agosto-2026.xlsx */
const nombreFicheroETT = r => `parte-ett-${(r.mesNombre || '').toLowerCase()}-${r.ano}.xlsx`;

/**
 * extras-samir-hadriya-agosto-2026-septiembre-2026.xlsx, y con más de tres
 * meses, el primero y el último: extras-…-julio-2026-a-octubre-2026.xlsx
 */
const plano = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nombreFicheroExtras = r => {
  const ms = r.meses.map(m => plano(m.etiqueta));
  return `extras-${plano(r.persona.nombre || 'conductor').slice(0, 50)}-` +
    (ms.length > 3 ? `${ms[0]}-a-${ms[ms.length - 1]}` : ms.join('-') || 'sin-mes') + '.xlsx';
};

module.exports = { generarExcelNomina, nombreFichero, generarExcelETT, nombreFicheroETT,
  generarExcelFiniquito, nombreFicheroFiniquito, generarExcelExtras, nombreFicheroExtras,
  // Para el comprobador.
  _comoSale: comoSale };
