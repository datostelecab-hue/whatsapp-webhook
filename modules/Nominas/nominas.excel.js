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
const SUMABLES = new Set(['horas', 'horasJustificadas', 'diasJustificados', 'horasNoJustificadas',
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
    'Diferencia         = (horas hechas + horas justificadas) − objetivo.',
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
    'Horas y nocturnas   de los tramos de BOLT ya ingeridos (viaje + espera), por jornada',
    '                    operativa de 05:00 a 05:00 y con los solapes fundidos: si alguien',
    '                    tiene dos cuentas que se pisan, ese rato cuenta una vez.',
    'Utilización         viaje ÷ (viaje + espera). Es el has_order sobre el tiempo conectado.',
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

module.exports = { generarExcelNomina, nombreFichero };
