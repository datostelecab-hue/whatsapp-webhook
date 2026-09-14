// ============================================================
// EXCEL DE LA NÓMINA VARIABLE
// ============================================================
// Lo que RRHH manda a la gestoría para que lo sume al recibo del mes. Dos hojas:
//
//   Nómina   una fila por persona, con el desglose de cada euro y el total.
//   Cómo se calculó   la config usada y las fórmulas escritas en cristiano.
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

const EUROS = '#,##0.00 "€"';
const HORAS = '#,##0.0';
const DOS = '#,##0.00';

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
const COLUMNAS = [
  ['ID de BOLT', 30, 'nombreBolt', null],
  ['Nombre de la seguridad social', 36, 'nombreSS', null],
  ['DNI/NIE', 13, 'dni', null],
  ['Tipo', 8, '_tipo', null],
  ['Jornada', 9, '_jornada', null],
  ['Fecha alta', 11, '_alta', null],
  ['Desde día', 10, 'primerDia', '0'],
  ['Arranque del prorrateo', 32, '_arranque', null],
  ['Horas', 9, 'horas', HORAS],
  ['Horas quitadas en espera para llegar a la utilización mínima', 26, 'horasEsperaQuitadas', HORAS],
  ['Horas justificadas', 15, 'horasJustificadas', HORAS],
  ['Días justificados', 14, 'diasJustificados', '0'],
  ['Objetivo (h)', 11, 'horasObjetivo', HORAS],
  ['Horas no justificadas', 18, 'horasNoJustificadas', HORAS],
  ['Diferencia (h)', 12, 'deltaHoras', HORAS],
  ['% Utilización', 12, '_util', '0.0"%"'],
  ['Propinas', 11, 'propinas', EUROS],
  ['Peajes', 10, 'peajes', EUROS],
  ['Nocturnas', 11, 'nocturnas', EUROS],
  ['MBO FAS', 11, 'mboFAS', EUROS],
  ['MBO horas extra', 15, 'mboHsExt', EUROS],
  ['Compensación', 13, 'compensacion', EUROS],
  ['Días extra', 10, 'diasExtra', DOS],
  ['TOTAL', 13, 'total', EUROS],
];

// Las que se suman en el pie.
const SUMABLES = new Set(['horas', 'horasEsperaQuitadas', 'horasJustificadas', 'diasJustificados', 'horasNoJustificadas',
  'propinas', 'peajes', 'nocturnas', 'mboFAS', 'mboHsExt', 'compensacion', 'diasExtra', 'total']);

function valorDe(f, clave) {
  switch (clave) {
    // Si falta uno de los dos nombres se pone el de la ficha antes que dejar la
    // celda vacía: quien lee la hoja tiene que poder saber de quién es la fila
    // aunque a esa persona le falte un dato.
    case 'nombreBolt': return f.nombreBolt || f.nombre || '';
    case 'nombreSS': return f.nombreSS || f.nombre || '';
    case '_tipo': return f.ett ? 'ETT' : 'Propia';
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

/** El libro. Devuelve los bytes; quien llama solo tiene que servirlo. */
async function generarExcelNomina(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const idLogo = E.registrarLogo(wb);

  // ── Hoja 1: la nómina ─────────────────────────────────────────────────────
  const ws = wb.addWorksheet(`Nómina ${r.mesNombre} ${r.ano}`);
  COLUMNAS.forEach(([, ancho], i) => { ws.getColumn(i + 1).width = ancho; });

  const sub = `Nómina de ${r.mesNombre} ${r.ano} · a mes vencido: trabajo de ` +
    `${r.mesDatosNombre} ${r.anoDatos} · ${r.filas.length} conductores · ` +
    (r.congelada ? 'CONGELADA' : 'sin congelar') + ` · generado ${sello()}`;
  let fila = E.bandaCabecera(ws, idLogo, 'NÓMINA VARIABLE', sub, COLUMNAS.length);
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, COLUMNAS.map(c => c[0]));
  const primera = fila;

  for (const f of r.filas) {
    const row = ws.getRow(fila++);
    COLUMNAS.forEach(([, , clave, fmt], i) => {
      const c = row.getCell(i + 1);
      c.value = valorDe(f, clave);
      if (fmt) c.numFmt = fmt;
      c.border = E.TODOS_BORDES;
      if (clave === 'total') c.font = { bold: true };
    });
    // Quien va sin fecha de alta cobra con el criterio viejo: se marca, porque
    // es el único caso en el que la cifra depende de un dato que falta.
    if (f.origenArranque === 'primer-log') {
      const c = row.getCell(COL('_arranque'));
      c.fill = E.relleno('FFFEF3C7');
      c.font = { color: { argb: 'FF92400E' } };
    }
    // La espera retirada, en ámbar: es la explicación de por qué a alguien con
    // muchas horas le sale poca diferencia, y hay que poder encontrarla sin
    // leerse la fila entera.
    if (f.horasEsperaQuitadas > 0) {
      const c = row.getCell(COL('horasEsperaQuitadas'));
      c.fill = E.relleno('FFFEF3C7');
      c.font = { bold: true, color: { argb: 'FF92400E' } };
    }
    // Las horas que siguen sin explicación, en rojo. Es la columna por la que se
    // abre esta hoja, y una cifra que hay que buscar a ojo entre veinte no
    // sirve de nada.
    if (f.horasNoJustificadas > 0) {
      const c = row.getCell(COL('horasNoJustificadas'));
      c.fill = E.relleno('FFFEE2E2');
      c.font = { bold: true, color: { argb: 'FF991B1B' } };
    }
  }

  // Pie con los totales, en fórmula: si alguien borra una fila, el total baja.
  const ultima = fila - 1;
  const pie = ws.getRow(fila);
  pie.getCell(1).value = `TOTAL (${r.filas.length})`;
  pie.getCell(1).font = { bold: true };
  COLUMNAS.forEach(([, , clave, fmt], i) => {
    const c = pie.getCell(i + 1);
    c.fill = E.relleno('FFF7F8FA');
    c.border = E.TODOS_BORDES;
    if (!SUMABLES.has(clave) || ultima < primera) return;
    const L = E.colLetra(i + 1);
    c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` };
    c.numFmt = fmt;
    c.font = { bold: true };
  });

  ws.views = [{ state: 'frozen', ySplit: filaCab }];
  if (ultima >= primera) {
    ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: ultima, column: COLUMNAS.length } };
  }

  // ── Hoja 2: cómo se calculó ───────────────────────────────────────────────
  const wc = wb.addWorksheet('Cómo se calculó');
  wc.getColumn(1).width = 46;
  wc.getColumn(2).width = 16;
  wc.getColumn(3).width = 70;
  let f2 = E.bandaCabecera(wc, null, 'CÓMO SE CALCULÓ', sub, 3);

  const cfg = r.config || {};
  f2 = E.cabeceraTabla(wc, f2, ['Parámetro', 'Valor', 'Qué hace']);
  const PARAMS = [
    ['Horas meta por día', 'horasMetaDia', 'Las horas que se esperan de un día operativo.'],
    ['Días operativos objetivo', 'diasObjetivo', 'Días de un mes completo. El objetivo se prorratea desde la fecha de alta.'],
    ['€ por hora extra', 'eurHoraExtra', 'Cada hora por encima del objetivo, multiplicada además por la utilización.'],
    ['Umbral FAS 40h (€)', 'umbralFAS40', 'A partir de esta facturación neta hay MBO FAS, para jornada de 40 h.'],
    ['Umbral FAS 32h (€)', 'umbralFAS32', 'Lo mismo para jornada de 32 h.'],
    ['% MBO FAS', 'pctMBOFAS', 'Fracción del exceso de facturación sobre el umbral. 0,4 = 40 %.'],
    ['€ hora nocturna', 'eurHoraNoc', 'Precio de la hora entre las 22:00 y las 06:00.'],
    ['Factor nocturnas', 'factorNoc', 'Multiplicador de las nocturnas: € hora × horas × factor.'],
    ['Sueldo base 40h (€)', 'sueldoBase40', 'Informativo: no entra en este total.'],
    ['Sueldo base 32h (€)', 'sueldoBase32', 'Informativo: no entra en este total.'],
    ['L utilización', 'lUtilizacion', 'Informativo: no entra en este total.'],
  ];
  for (const [etiqueta, clave, que] of PARAMS) {
    const row = wc.getRow(f2++);
    row.getCell(1).value = etiqueta;
    row.getCell(2).value = cfg[clave] == null ? '' : Number(cfg[clave]);
    row.getCell(3).value = que;
    [1, 2, 3].forEach(i => { row.getCell(i).border = E.TODOS_BORDES; });
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
  }

  f2 += 1;
  const EXPLICA = [
    'LAS FÓRMULAS, UNA A UNA',
    '',
    'Objetivo de horas  = (días desde el arranque ÷ días del mes) × días objetivo × horas meta.',
    '   El arranque es el día 1 si ya estaba de alta, o su día de alta si entró ese mes.',
    'Horas justificadas = por cada día con J APROBADA, lo que le faltara a ese día para la jornada.',
    '   Un día en el que no salió nada suma la jornada entera; uno en el que rodó 3 h suma 5.',
    '   No se distingue el tipo ni el motivo de la J, y nunca suma por encima de la jornada:',
    '   una J cubre lo que no se pudo hacer, no se añade a lo que sí se hizo.',
    '   Las J PENDIENTES de aprobar no cuentan, y las rechazadas tampoco.',
    'Horas quitadas     = las de ESPERA que se retiran para llegar a la utilización mínima.',
    'en espera            utilización = viaje ÷ (viaje + espera). Si no llega al mínimo, se quita',
    '                     X = (viaje + espera) − viaje ÷ mínimo, y queda exactamente en el mínimo.',
    '                     NUNCA se quita viaje, y nunca más espera de la que esa persona tuvo.',
    'Diferencia         = (horas hechas − horas quitadas en espera + horas justificadas) − objetivo.',
    '   Con las justificadas DENTRO: un día justificado no le resta a nadie. Quien rodó',
    '   205,6 h y tuvo dos días justificados lleva 221,6 contra un objetivo de 176, y su',
    '   exceso son 45,6 h, no 29,6.',
    'Horas NO justif.   = la diferencia, cuando sale negativa.  Cero si llegó al objetivo.',
    '   Es lo que falta y no tiene explicación. La columna va en rojo cuando no es cero.',
    'MBO horas extra    = diferencia × € por hora extra × utilización.  Solo si la diferencia es positiva.',
    'MBO FAS            = (facturación neta − umbral) × % MBO FAS.  Solo si supera el umbral de SU jornada.',
    'Nocturnas          = € hora nocturna × horas nocturnas × factor.',
    '',
    'TOTAL = nocturnas + peajes + propinas + el MAYOR de los dos MBO.',
    '   Los dos MBO no se suman: se cobra el que salga más alto. Por eso en muchas filas',
    '   la columna "Compensación" va a cero aunque "MBO horas extra" tenga un número:',
    '   ese mes ganó el MBO FAS.',
    '',
    'POR QUÉ SE QUITAN HORAS DE ESPERA',
    '',
    'La hora extra se paga por CONDUCIR de más, no por estar conectado de más. Las horas',
    'efectivas son viaje + espera, así que quien pasa el mes con la app abierta y poca carrera',
    'acumula horas igual que quien no para. Con 211,4 h y un 52,7 % de utilización, 100 de esas',
    'horas fueron espera: el recorte deja 171,3 h y su exceso sobre el objetivo desaparece.',
    '',
    'A quien ya llega al mínimo no se le quita nada, y a nadie se le toca una hora de viaje.',
    '',
    'POR QUÉ LAS J NO REGALAN HORAS EXTRA',
    '',
    'Porque una J está TOPADA: nunca sube un día por encima de la jornada. Un día justificado',
    'vale exactamente lo que habría valido trabajado, ni una hora más, así que las justificadas',
    'solo pueden llevar a alguien HASTA su objetivo. Para pasarse de ahí hay que haber rodado',
    'de más los otros días, que es justo lo que la hora extra paga.',
    '',
    'Las dos reglas van juntas —la J vale el día entero, pero topada—: separarlas rompe el',
    'cálculo. Sin el tope, quien rodó 3 h un día justificado sumaría 11 h de ese día y cobraría',
    'extras por horas que no hizo.',
    '',
    'DE DÓNDE SALEN LOS DATOS',
    '',
    'Horas y nocturnas   de los tramos de BOLT ya ingeridos (viaje + espera), por DÍA NATURAL',
    '                    (del 1 a las 00:00 al último a las 23:59) y con los solapes fundidos:',
    '                    si alguien tiene dos cuentas que se pisan, ese rato cuenta una vez.',
    '                    OJO: la bitácora mide por jornada 05:00-05:00, que es control de TURNOS.',
    '                    Para quien trabaja de noche los dos números NO coinciden, y es correcto:',
    '                    la nómina paga lo que cayó EN EL MES.',
    'Utilización         viaje ÷ (viaje + espera). Es el has_order sobre el tiempo conectado.',
    '                    La columna enseña la REAL, antes del recorte: es el diagnóstico.',
    'Propinas, peajes    de las órdenes de BOLT ya ingeridas.',
    'y facturación neta',
    'DNI, jornada,       de la ficha del conductor y de su periodo de empleo.',
    'ETT y fecha de alta',
    'Horas justificadas  de los justificantes APROBADOS, los mismos que pinta la bitácora.',
    'Los dos nombres     el de BOLT, del padrón de la plataforma; el de la seguridad social,',
    '                    de la ficha de RRHH.',
    '',
    'Nada de esto se pide a ninguna API al generar la nómina ni se lee de ninguna hoja de',
    'cálculo: todo está en la base de datos.',
  ];
  for (const linea of EXPLICA) {
    const row = wc.getRow(f2++);
    const c = row.getCell(1);
    c.value = linea;
    if (linea && linea === linea.toUpperCase() && linea.length > 6) c.font = { bold: true, color: { argb: E.DARK } };
    else c.font = { color: { argb: E.TEXTO } };
  }

  return wb.xlsx.writeBuffer();
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

// Formato de CONTABILIDAD: un cero sale como "- €" en vez de "0,00 €", que es
// como lo tiene la agencia en su hoja y como se lee de un vistazo una columna
// con muchos ceros.
const CONTA = '_-* #,##0.00\\ "€"_-;\\-* #,##0.00\\ "€"_-;_-* "-"\\ "€"_-;_-@_-';
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
  ['Mínimo exigido', 13, (f, r) => r.utilMinima, '0.0%'],
  ['Horas de espera descontadas', 22, f => f.horasEsperaQuitadas, HORAS_ETT],
  ['Horas justificadas', 15, f => f.horasJustificadas, HORAS_ETT],
  ['HORAS QUE SE PAGAN', 18, f => f.horasTrabajadas, HORAS_ETT],
  ['Importe descontado', 16, f => f.importeDescontado, CONTA],
];

/** Pinta una tabla con la banda de la casa, su cabecera, su pie y su filtro. */
function tabla(ws, idLogo, titulo, subtitulo, columnas, filas, r, { realce } = {}) {
  columnas.forEach(([, ancho], i) => { ws.getColumn(i + 1).width = ancho; });
  let fila = E.bandaCabecera(ws, idLogo, titulo, subtitulo, columnas.length);
  const filaCab = fila;
  fila = E.cabeceraTabla(ws, fila, columnas.map(c => c[0]));
  const primera = fila;

  for (const f of filas) {
    const row = ws.getRow(fila++);
    columnas.forEach(([, , saca, fmt], i) => {
      const c = row.getCell(i + 1);
      const v = saca(f, r);
      c.value = v === undefined ? null : v;
      if (fmt) c.numFmt = fmt;
      c.border = E.TODOS_BORDES;
    });
    if (realce) realce(row, f);
  }

  const ultima = fila - 1;
  const pie = ws.getRow(fila);
  pie.getCell(1).value = `TOTAL (${filas.length})`;
  pie.getCell(1).font = { bold: true };
  columnas.forEach(([, , , fmt], i) => {
    const c = pie.getCell(i + 1);
    c.fill = E.relleno('FFF7F8FA');
    c.border = E.TODOS_BORDES;
    // Solo se suma lo que tiene sentido sumar. Un precio por hora repetido en
    // doscientas filas no se suma, y un porcentaje tampoco: sumarlos daría un
    // número sin significado en negrita, que es peor que una celda vacía.
    const sumable = fmt && fmt !== FECHA && !/%/.test(fmt) && !['€/h', 'Plus Nocturnidad', 'Mínimo exigido'].includes(columnas[i][0]);
    if (!sumable || ultima < primera) return;
    const L = E.colLetra(i + 1);
    c.value = { formula: `SUM(${L}${primera}:${L}${ultima})` };
    c.numFmt = fmt;
    c.font = { bold: true };
  });

  ws.views = [{ state: 'frozen', ySplit: filaCab }];
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
      'horas justificadas (una J cubre la jornada del día, 8 h, sin pasar de ahí).',
    'El detalle de los descuentos, con el porcentaje de utilización de cada uno, está en la segunda pestaña.',
    'Las horas van por día natural: del día 1 a las 00:00 al último a las 23:59.',
  ]);

  // ── Pestaña 2: por qué se descuenta ──────────────────────────────────────
  const conDescuento = r.filas.filter(f => f.horasEsperaQuitadas > 0.005);
  const wd = wb.addWorksheet('Horas descontadas');
  const fin2 = tabla(wd, idLogo, 'HORAS DESCONTADAS POR UTILIZACIÓN',
    `${conDescuento.length} de ${r.filas.length} conductores no llegan al ` +
    `${(r.utilMinima * 100).toFixed(0)} % de utilización · ` +
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
    `Quien no llega al ${(r.utilMinima * 100).toFixed(0)} % se le retiran horas DE ESPERA —nunca de viaje— ` +
      'hasta que lo alcanza. Después del descuento, todos quedan exactamente en ese mínimo.',
    'Nunca se descuenta más espera de la que esa persona tuvo: sale de la propia fórmula, ' +
      'X = (viaje + espera) − viaje ÷ mínimo.',
    'A quien ya llega al mínimo no se le quita nada, y por eso no aparece en esta pestaña.',
  ]);

  return wb.xlsx.writeBuffer();
}

/** parte-ett-agosto-2026.xlsx */
const nombreFicheroETT = r => `parte-ett-${(r.mesNombre || '').toLowerCase()}-${r.ano}.xlsx`;

module.exports = { generarExcelNomina, nombreFichero, generarExcelETT, nombreFicheroETT };
