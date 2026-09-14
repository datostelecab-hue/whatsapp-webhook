// ============================================================
// EXCEL PARA LA GESTORÍA
// ============================================================
// Reproduce EXACTAMENTE la pestaña PLANTILLA del fichero que la gestoría nos
// manda y al que respondemos — el mismo con el que se hizo la migración inicial.
//
// "Exactamente" no es una forma de hablar: al otro lado hay un programa de
// nóminas que lee esas columnas por posición y por título. Por eso aquí NO hay
// ni logo, ni colores de la casa, ni una columna de más "que viene bien". Todos
// los demás Excel del sistema llevan la cabecera de la empresa; este no, y esa
// es la diferencia entre un informe (lo lee una persona) y un fichero de
// intercambio (lo lee una máquina).
//
// Lo que se copia del original, y no se toca:
//   · La pestaña se llama PLANTILLA.
//   · Las filas 1 y 2 van VACÍAS y la cabecera está en la 3. Los datos, desde
//     la 4.
//   · La columna A va vacía: los datos empiezan en la B.
//   · 40 columnas, en su orden, con sus anchos.
//   · Casi todo es TEXTO. Solo "Fecha Ingreso" e "Inicio Contrato" son fechas
//     de verdad, con formato d/MM/yyyy.
//   · Una fecha que no existe se escribe "00/00/0000", que es como lo hace su
//     programa. Un hueco en blanco no significa lo mismo para él.
//
// SOLO PLANTILLA PROPIA. La gente de la ETT la contrata la agencia y sus altas
// las lleva ella; mandárselas a nuestra gestoría sería pedirle que tramite a
// gente que no es nuestra. El filtro no está aquí: está en la consulta
// (`repo/conductores.paraGestoria`), que es donde no se puede desactivar sin
// querer.

const ExcelJS = require('exceljs');

// ── Las 40 columnas, en su orden, con su ancho del fichero original ─────────
// El ancho importa más de lo que parece: quien lo abre lo compara a ojo con el
// suyo, y una columna que baila hace dudar de todo lo demás.
const COLUMNAS = [
  ['Legajo', 7], ['TRABAJADOR', 42], ['Tipo DNI', 10], ['DNI', 10],
  ['Centro', 6], ['Nombre Centro de Trabajo', 35], ['Apellidos y Nombre', 41],
  ['Fecha Nacimiento', 15], ['NAF(Prov)', 9], ['NAF(Núm)', 9], ['NAF(D.Ctr)', 10],
  ['Sexo', 7], ['E.Civil', 8], ['Cod.País Nacimiento', 18], ['País Nacimiento', 31],
  ['Tipo Vía', 8], ['Vía Pública', 28], ['Número', 7], ['Escalera', 8], ['Piso', 5],
  ['Puerta', 6], ['Municipio', 23], ['Cod.Postal', 10], ['Provincia', 13],
  ['Cod.País', 8], ['País', 8], ['Teléfono', 13], ['E-Mail', 38],
  ['Categoría', 25], ['Cod.Puesto', 10], ['Puesto', 12],
  ['Fecha Ingreso', 12], ['Fecha Baja', 10], ['Cod.Contrato', 12], ['Contrato', 29],
  ['Inicio Contrato', 13], ['Fin Contrato', 11],
  ['Coeficiente Tiempo Parcial', 22], ['Horas/Mes Tiempo Parcial', 22],
  ['Fecha Antigüedad', 16],
];

// Las columnas que su programa escribe como FECHA de verdad. El resto de fechas
// van como texto, igual que en el original.
const COL_FECHA = new Set(['Fecha Ingreso', 'Inicio Contrato']);

// Una fecha que no existe. No se deja en blanco: su programa distingue.
const SIN_FECHA = '00/00/0000';

// Los valores que son iguales para toda la plantilla. Salen del propio fichero
// original, donde son el 100 % de las filas.
const CATEGORIA = 'CONDUCTOR DE APLICACIÓN';
const COD_PUESTO = '01';
const PUESTO = 'CONDUCTOR';
const HORAS_MES = '       0,00';   // con sus espacios: así viene

// Cómo escribe la gestoría el tipo de documento.
const TIPO_DNI = { DNI: 'D.N.I./N.I.F.', NIE: 'N.I.E' };

/**
 * De las horas de jornada a las tres columnas de contrato.
 *
 * El coeficiente es la parte de jornada en milésimas: 40 h son 000 (completo),
 * 32 h son 800, 30 h son 750. Sale así en el fichero original y es como lo
 * espera su programa.
 */
function contratoDe(horas) {
  const h = Number(horas);
  if (!h) return { cod: '', nombre: '', coef: '' };   // sin jornada: en blanco
  if (h >= 40) return { cod: '100', nombre: 'INDEFINIDO A TIEMPO COMPLETO', coef: '000' };
  return {
    cod: '200', nombre: 'INDEFINIDO A TIEMPO PARCIAL',
    coef: String(Math.round(h * 1000 / 40)).padStart(3, '0'),
  };
}

const txt = v => (v == null || v === '' ? '' : String(v));

/**
 * 'AAAA-MM-DD' a una fecha que Excel escriba EN SU DIA.
 *
 * En UTC a proposito. Un `new Date('2022-04-21')` local es medianoche de
 * Madrid, y esa medianoche en UTC es el dia 20 a las 22:00: Excel guarda el
 * instante y al abrirlo se lee el 20. Con Date.UTC el instante ES el dia 21 y
 * no hay desfase que corregir. Es el mismo fallo que ya se documento en el
 * proyecto para las fechas de PostgreSQL.
 */
function fechaUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** El nombre como lo escribe la Seguridad Social. Si no lo tenemos, se compone. */
function comoLaSS(f) {
  if (f.nombre_ss) return f.nombre_ss;
  const ap = txt(f.apellidos), no = txt(f.nombre);
  return ap && no ? ap + ', ' + no : (ap || no);
}

/**
 * El libro. Devuelve los bytes, no el workbook: quien llama solo tiene que
 * servirlo.
 */
async function generarExcelGestoria(filas) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const ws = wb.addWorksheet('PLANTILLA');

  // La columna A vacía y los anchos del original. `getColumn(1)` es la A.
  ws.getColumn(1).width = 3;
  COLUMNAS.forEach(([, ancho], i) => { ws.getColumn(i + 2).width = ancho; });

  // Filas 1 y 2 vacías; la cabecera en la 3, como en el fichero que nos mandan.
  const cab = ws.getRow(3);
  COLUMNAS.forEach(([titulo], i) => {
    const c = cab.getCell(i + 2);
    c.value = titulo;
    c.font = { bold: true };
  });

  let fila = 4;
  for (const f of filas) {
    const r = ws.getRow(fila++);
    const ct = contratoDe(f.jornada_horas);
    const nombreSS = comoLaSS(f);

    // El orden es el de COLUMNAS y no puede cambiar: al otro lado se lee por
    // posición.
    const valores = [
      txt(f.legajo),
      nombreSS,
      TIPO_DNI[txt(f.dni_tipo)] || txt(f.dni_tipo),
      txt(f.dni_nie),
      txt(f.centro_codigo),
      txt(f.centro_nombre),
      nombreSS,
      txt(f.nacimiento),
      txt(f.naf_provincia),
      txt(f.naf_numero),
      txt(f.naf_control),
      txt(f.sexo),
      txt(f.estado_civil),
      txt(f.pais_nacimiento_codigo),
      txt(f.pais_nacimiento),
      txt(f.via_tipo),
      txt(f.via_nombre),
      txt(f.via_numero),
      txt(f.escalera),
      txt(f.piso),
      txt(f.puerta),
      txt(f.localidad),
      txt(f.codigo_postal),
      txt(f.provincia),
      txt(f.pais_codigo),
      txt(f.pais),
      txt(f.telefono),
      txt(f.email),
      CATEGORIA,
      COD_PUESTO,
      PUESTO,
      fechaUTC(f.alta),                  // FECHA de verdad
      txt(f.baja) || SIN_FECHA,
      ct.cod,
      ct.nombre,
      fechaUTC(f.alta),                  // Inicio Contrato = la fecha de ingreso
      SIN_FECHA,                         // Fin Contrato: indefinidos, nunca hay
      ct.coef,
      HORAS_MES,
      txt(f.antiguedad),
    ];

    valores.forEach((v, i) => {
      const c = r.getCell(i + 2);
      const esFecha = COL_FECHA.has(COLUMNAS[i][0]);
      if (esFecha) {
        // Sin fecha, su programa espera el texto, no una celda vacía.
        if (v) { c.value = v; c.numFmt = 'd/MM/yyyy'; }
        else c.value = SIN_FECHA;
      } else {
        c.value = v;
      }
    });
  }

  return wb.xlsx.writeBuffer();
}

/** PLANTILLA TRABAJADORES 2026-09-14.xlsx */
function nombreFichero(estado) {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const que = estado === 'baja' ? ' BAJAS' : estado === 'todos' ? ' COMPLETA' : '';
  return `PLANTILLA TRABAJADORES${que} ${hoy}.xlsx`;
}

module.exports = { generarExcelGestoria, nombreFichero, COLUMNAS };
