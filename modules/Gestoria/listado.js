// ============================================================
// EL LISTADO DE LA GESTORÍA, LEÍDO Y CRUZADO (módulo 8, 25/11/2026) — puro
// ============================================================
// Lo que manda la gestoría: hoy, la proforma de A3NOM («E07735_…_nom_nov2026.xls»,
// hoja «Conceptos»: empresa, fecha, y por trabajador su «Código» —el legajo sin
// ceros— y su «Nombre», con una columna por concepto); mañana, el listado de
// plantilla en alta. Las dos se leen igual: una fila de cabecera con un código
// de trabajador y un nombre, y debajo, uno por fila.
//
// EL CRUCE es por LEGAJO, nunca por el nombre (la gestoría corta los apellidos
// largos). El nombre solo sirve para avisar de que un legajo parece de otra
// persona y para proponer a quién es un legajo que el ERP no tiene.
'use strict';

const xls = require('../../services/xls');
const { normalizar: legajoEnLimpio } = require('../Conductores/legajo');

const plano = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Las hojas del fichero, como filas de valores: de un .xls o de un .xlsx. */
async function hojasDe(buffer) {
  if (buffer.slice(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') return xls.leer(buffer).hojas;
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (e) { throw new Error('No se puede abrir: tiene que ser un Excel (.xls o .xlsx)'); }
  return wb.worksheets.map(ws => {
    const filas = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const f = [];
      row.eachCell({ includeEmpty: false }, (c, k) => {
        let v = c.value;
        if (v && typeof v === 'object') {
          if (v instanceof Date) v = v.toISOString().slice(0, 10);
          else if (v.result !== undefined) v = v.result;
          else if (v.richText) v = v.richText.map(t => t.text).join('');
          else if (v.text !== undefined) v = v.text;
        }
        f[k - 1] = v;
      });
      filas[n - 1] = Array.from(f, x => (x === undefined ? null : x));
    });
    return { nombre: ws.name, oculta: ws.state !== 'visible', filas: Array.from(filas, x => x || []) };
  });
}

const CAB_CODIGO = new Set(['CODIGO', 'COD', 'LEGAJO', 'N EMPLEADO', 'NUMERO EMPLEADO', 'CODIGO EMPLEADO', 'CODIGO TRABAJADOR', 'N TRABAJADOR']);
const CAB_NOMBRE = new Set(['NOMBRE', 'TRABAJADOR', 'APELLIDOS Y NOMBRE', 'NOMBRE Y APELLIDOS', 'NOMBRE COMPLETO']);
const CAB_DNI = new Set(['DNI', 'NIF', 'NIE', 'DNI NIE', 'NIF NIE', 'DOCUMENTO']);
// El listado de trabajadores de A3 («PLANTILLA TRABAJADORES», 27/11/2026) trae
// además las fechas y la parcialidad de cada uno. La proforma, no.
const CAB_INGRESO = new Set(['FECHA INGRESO', 'FECHA DE INGRESO', 'FECHA ALTA', 'FECHA DE ALTA', 'INGRESO']);
const CAB_BAJA = new Set(['FECHA BAJA', 'FECHA DE BAJA']);
const CAB_COEF = new Set(['COEFICIENTE TIEMPO PARCIAL', 'COEF TIEMPO PARCIAL', 'COEFICIENTE PARCIALIDAD', 'COEF PARCIALIDAD']);
const CAB_CONTRATO = new Set(['CONTRATO', 'TIPO CONTRATO', 'TIPO DE CONTRATO']);
const CONCEPTO = /^(\d{3})\s*-\s*(.+?)\s*(\([A-Z]\))?$/;

/**
 * Una fecha de celda: «2026-07-26» (la de un .xlsx), «26/07/2026» (texto) o un
 * número de serie de Excel (la de un .xls). «00/00/0000» es la «sin fecha» de A3.
 */
function fechaCelda(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^0+\/0+\/0+$/.test(s)) return null;
  return fechaDe(s.slice(0, 10));
}

/**
 * Las horas de su contrato según A3: el coeficiente de parcialidad va en tantos
 * por mil de la jornada completa (40 h): «000» es completa, «800» son 32 h y
 * «750», 30 h. Sin coeficiente, el contrato a tiempo completo también dice 40.
 */
function horasDe(coef, contrato) {
  const c = coef == null ? '' : String(coef).trim();
  if (/^\d+$/.test(c)) return Number(c) === 0 ? 40 : Math.round(Number(c) * 40 / 1000);
  return /TIEMPO COMPLETO/.test(plano(contrato)) ? 40 : null;
}

/** «23 de Noviembre de 2026» o «23/11/2026» → '2026-11-23'. */
function fechaDe(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  let m = /^(\d{1,2}) de ([a-záéíóú]+) de (\d{4})$/.exec(s);
  if (m) {
    const mes = MESES.indexOf(m[2].normalize('NFD').replace(/[̀-ͯ]/g, ''));
    if (mes >= 0) return `${m[3]}-${String(mes + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/**
 * LO QUE DICE EL LISTADO: { hoja, tipo ('proforma' | 'listado'), empresa,
 * fecha, filaCabecera, conceptos: [{ col, codigo, nombre }], trabajadores:
 * [{ fila, legajo, nombre, dni }], avisos }. Lanza si no encuentra la cabecera.
 */
function interpretar(hojas) {
  const vistas = [];
  for (const h of hojas) {
    for (let f = 0; f < Math.min(20, h.filas.length); f++) {
      const fila = h.filas[f] || [];
      const cols = {};
      fila.forEach((v, c) => {
        const p = plano(v);
        if (!p) return;
        if (f < 10) vistas.push(`${h.nombre}: «${String(v).trim().slice(0, 30)}»`);
        if (cols.codigo == null && CAB_CODIGO.has(p)) cols.codigo = c;
        else if (cols.nombre == null && CAB_NOMBRE.has(p)) cols.nombre = c;
        else if (cols.dni == null && CAB_DNI.has(p)) cols.dni = c;
        else if (cols.ingreso == null && CAB_INGRESO.has(p)) cols.ingreso = c;
        else if (cols.baja == null && CAB_BAJA.has(p)) cols.baja = c;
        else if (cols.coef == null && CAB_COEF.has(p)) cols.coef = c;
        else if (cols.contrato == null && CAB_CONTRATO.has(p)) cols.contrato = c;
      });
      if (cols.codigo == null || cols.nombre == null) continue;

      // Lo de encima de la cabecera: la empresa y la fecha.
      let empresa = null, fecha = null;
      for (let k = 0; k < f; k++) {
        const r = h.filas[k] || [];
        r.forEach((v, c) => {
          const p = plano(v);
          if (p === 'EMPRESA' && r[c + 1] != null) empresa = { codigo: String(r[c + 1]).trim(), nombre: r[c + 2] != null ? String(r[c + 2]).trim() : '' };
          if (p === 'FECHA' && !fecha) fecha = fechaDe(r[c + 1]);
          if (!fecha && fechaDe(v) && /\bde\b/i.test(String(v))) fecha = fechaDe(v);
        });
      }
      const conceptos = [];
      fila.forEach((v, c) => {
        const m = CONCEPTO.exec(String(v == null ? '' : v).trim());
        if (m && c !== cols.codigo && c !== cols.nombre) conceptos.push({ col: c, codigo: m[1], nombre: m[2].trim() });
      });
      const trabajadores = [], avisos = [];
      for (let k = f + 1; k < h.filas.length; k++) {
        const r = h.filas[k] || [];
        const cod = r[cols.codigo];
        if (cod == null || String(cod).trim() === '') continue;
        let legajo = null;
        try { legajo = legajoEnLimpio(cod); } catch (_) { avisos.push(`Fila ${k + 1}: «${String(cod).trim()}» no es un código de trabajador`); continue; }
        const t = {
          fila: k + 1, legajo, nombre: r[cols.nombre] != null ? String(r[cols.nombre]).trim() : '',
          dni: cols.dni != null && r[cols.dni] != null ? String(r[cols.dni]).trim() : null,
        };
        if (cols.ingreso != null) t.ingreso = fechaCelda(r[cols.ingreso]);
        if (cols.baja != null) t.baja = fechaCelda(r[cols.baja]);
        if (cols.coef != null || cols.contrato != null) {
          t.jornada = horasDe(cols.coef != null ? r[cols.coef] : null, cols.contrato != null ? r[cols.contrato] : null);
        }
        trabajadores.push(t);
      }
      return {
        hoja: h.nombre, tipo: conceptos.length ? 'proforma' : 'listado', empresa, fecha, filaCabecera: f + 1,
        conceptos, trabajadores, avisos,
        conFechas: !conceptos.length && cols.baja != null,
        conJornada: !conceptos.length && (cols.coef != null || cols.contrato != null),
      };
    }
  }
  const muestra = [...new Set(vistas)].slice(0, 12).join(', ');
  throw new Error('No encuentro la cabecera del listado (una columna «Código» o «Legajo» y otra «Nombre»).'
    + (muestra ? ` He visto: ${muestra}.` : ' El Excel parece vacío.'));
}

/**
 * ¿El nombre de la gestoría y el del ERP son la misma persona? Dos palabras
 * largas DISTINTAS en común bastan. Una palabra cortada por A3 («JEF», de
 * «JEFFERSON») vale si es el principio de la otra. 26/11/2026: contaba dos
 * veces la misma, y «MEDINA MEDINA MÓNICA» casaba con «MEDINA ROMERO CRISTIAN».
 */
function mismoNombre(a, ...otros) {
  return palabrasEnComun(a, ...otros) >= 2;
}

/** Cuántas palabras largas distintas comparte `a` con el que más se le parece de `otros`. */
function palabrasEnComun(a, ...otros) {
  const pa = [...new Set(plano(a).split(' ').filter(p => p.length > 2))];
  const casa = (x, y) => x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)));
  return Math.max(0, ...otros.map(o => {
    const po = [...new Set(plano(o).split(' ').filter(p => p.length > 2))];
    return pa.filter(x => po.some(y => casa(x, y))).length;
  }));
}

const diasEntre = (desde, hasta) => {
  const u = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(hasta) - u(desde)) / 86400000);
};

/**
 * EL CRUCE (puro). `personas`: las fichas del ERP (sin las de pruebas):
 * [{ id, nombre, nombre_ss, legajo, dni_nie, vigente, tipo, alta, baja }]
 * (`tipo`, `alta` y `baja`: los de su último periodo de empleo). `fecha`: la del
 * listado. Devuelve las discrepancias: [{ tipo, clave, conductorId, legajo,
 * nombreGestoria, detalle }].
 *
 *   · alta_gestoria_baja_nuestra: en el listado, y para nosotros se fue antes
 *     de la fecha de corte (en una proforma, antes de que empezara su mes: quien
 *     se va a mitad de mes cobra ese mes).
 *   · alta_nuestra_no_gestoria: plantilla propia de alta desde antes de la
 *     fecha del listado, con legajo, que no sale en él.
 *   · legajo_desconocido: un legajo que el ERP no tiene; si su nombre casa con
 *     una sola persona de plantilla propia en alta sin legajo, se propone.
 *   · legajo_cambiado: un legajo que el ERP no tiene, cuyo nombre casa con
 *     una sola persona de plantilla propia en alta cuyo legajo no sale en el
 *     listado: la misma persona, con otro legajo (pasa al volver a contratar).
 *   · nombre_distinto: el legajo es de alguien del ERP que no se llama así.
 *   · sin_legajo: plantilla propia en alta sin legajo (y que nadie del
 *     listado propone): no se puede cruzar.
 *
 * CON FECHAS (`conFechas`: el listado de trabajadores de A3, que trae a todos,
 * también a los que se fueron, con su fecha de baja; 27/11/2026). Quien tiene
 * baja en la gestoría a la fecha del listado NO está de alta para ellos, y de
 * cada legajo cuenta su fila de ahora (la que no tiene baja, o la última). Y
 * cuatro diferencias más, que decide Diana (corregir el ERP o pedírselo a la
 * gestoría):
 *
 *   · baja_gestoria_alta_nuestra: de baja en la gestoría y de alta con nosotros.
 *   · fecha_alta_distinta: la fecha de alta no es la misma.
 *   · fecha_baja_distinta: los dos le dieron de baja, en fechas distintas (si la
 *     de la gestoría es después, son días cotizados de más).
 *   · jornada_distinta (`conJornada`): las horas de su contrato no son las mismas.
 */
function cruzar({ trabajadores, personas, fecha, tipo, conFechas = false, conJornada = false }) {
  const corte = tipo === 'proforma' ? `${fecha.slice(0, 7)}-01` : fecha;
  // Con fechas, una fila por legajo: la de su contrato de ahora.
  if (conFechas) {
    const deAlta = t => !t.baja || t.baja > fecha;
    const una = new Map();
    for (const t of trabajadores) {
      const ya = una.get(t.legajo);
      if (!ya || (deAlta(t) && !deAlta(ya)) || (deAlta(t) === deAlta(ya) && String(t.ingreso || '') > String(ya.ingreso || ''))) una.set(t.legajo, t);
    }
    trabajadores = [...una.values()];
  }
  const deBajaEnGestoria = t => conFechas && !!t.baja && t.baja <= fecha;
  const porLegajo = new Map(personas.filter(p => p.legajo).map(p => [p.legajo, p]));
  const enListado = new Set(trabajadores.map(t => t.legajo));
  const propiaEnAlta = personas.filter(p => p.vigente && p.tipo === 'propia' && p.alta && p.alta <= fecha);
  const sinLegajo = propiaEnAlta.filter(p => !p.legajo);
  const salida = [];
  const poner = (tipoD, { conductorId = null, legajo = null, nombreGestoria = null, detalle = {} }) =>
    salida.push({ tipo: tipoD, clave: `${tipoD}:${conductorId || ''}:${legajo || ''}`, conductorId: conductorId ? String(conductorId) : null, legajo, nombreGestoria, detalle });
  const propuestos = new Set();
  // De alta con nosotros, con un legajo que no sale en el listado: si su nombre
  // casa con un legajo que el ERP no tiene, es la misma persona con otro legajo.
  const ausentes = propiaEnAlta.filter(p => p.legajo && !enListado.has(p.legajo));
  const cambiados = new Set();

  for (const t of trabajadores) {
    const p = porLegajo.get(t.legajo);
    // Alguien que ya se fue para la gestoría y que el ERP no conoce: es historia.
    if (!p && deBajaEnGestoria(t)) continue;
    if (!p) {
      const otro = ausentes.filter(a => !cambiados.has(String(a.id)) && mismoNombre(t.nombre, a.nombre, a.nombre_ss));
      if (otro.length === 1) {
        cambiados.add(String(otro[0].id));
        poner('legajo_cambiado', { conductorId: otro[0].id, legajo: t.legajo, nombreGestoria: t.nombre,
          detalle: { fila: t.fila, legajoErp: otro[0].legajo } });
        continue;
      }
      // ¿De quién puede ser? Primero, plantilla propia en alta sin legajo; si no,
      // cualquiera sin legajo que se llame así (de ETT, o de baja): también se dice.
      let cand = sinLegajo.filter(s => mismoNombre(t.nombre, s.nombre, s.nombre_ss));
      if (!cand.length) cand = personas.filter(s => !s.legajo && mismoNombre(t.nombre, s.nombre, s.nombre_ss));
      const situacion = s => (!s.vigente ? 'de baja' : s.tipo === 'ett' ? 'de ETT' : s.alta && s.alta > fecha ? 'entra después' : 'de alta');
      const propuesta = cand.length === 1 ? { id: String(cand[0].id), nombre: cand[0].nombre, situacion: situacion(cand[0]) } : null;
      if (propuesta) propuestos.add(propuesta.id);
      poner('legajo_desconocido', { legajo: t.legajo, nombreGestoria: t.nombre, detalle: { fila: t.fila, propuesta, candidatos: cand.length } });
      continue;
    }
    if (t.nombre && !mismoNombre(t.nombre, p.nombre, p.nombre_ss)) {
      poner('nombre_distinto', { conductorId: p.id, legajo: t.legajo, nombreGestoria: t.nombre, detalle: { fila: t.fila, erp: p.nombre } });
    }
    const base = { conductorId: p.id, legajo: t.legajo, nombreGestoria: t.nombre };
    const mirarAlta = () => {
      if (t.ingreso && p.alta && t.ingreso !== p.alta) {
        poner('fecha_alta_distinta', { ...base, detalle: { fila: t.fila, erp: p.alta, gestoria: t.ingreso, abierto: !!p.vigente } });
      }
    };
    if (!deBajaEnGestoria(t)) {
      if (!p.vigente && p.baja && p.baja < corte) {
        poner('alta_gestoria_baja_nuestra', { ...base,
          detalle: { fila: t.fila, baja: p.baja, dias: Math.max(0, diasEntre(p.baja, fecha)) } });
      } else if (conFechas && p.vigente) {
        mirarAlta();
        const horas = p.jornada_horas == null ? null : Number(p.jornada_horas);
        if (conJornada && t.jornada && horas && p.tipo === 'propia' && t.jornada !== horas) {
          poner('jornada_distinta', { ...base, detalle: { fila: t.fila, erp: horas, gestoria: t.jornada } });
        }
      }
    } else if (p.vigente) {
      poner('baja_gestoria_alta_nuestra', { ...base, detalle: { fila: t.fila, bajaGestoria: t.baja, alta: p.alta } });
    } else {
      if (p.baja && p.baja !== t.baja) {
        poner('fecha_baja_distinta', { ...base,
          detalle: { fila: t.fila, erp: p.baja, gestoria: t.baja, dias: Math.max(0, diasEntre(p.baja, t.baja)) } });
      }
      mirarAlta();
    }
  }
  for (const p of propiaEnAlta) {
    if (!p.legajo) {
      if (!propuestos.has(String(p.id))) poner('sin_legajo', { conductorId: p.id, detalle: { alta: p.alta } });
    } else if (!enListado.has(p.legajo) && !cambiados.has(String(p.id))) {
      poner('alta_nuestra_no_gestoria', { conductorId: p.id, legajo: p.legajo, detalle: { alta: p.alta } });
    }
  }
  return salida;
}

module.exports = { hojasDe, interpretar, cruzar, fechaDe, fechaCelda, horasDe, mismoNombre, palabrasEnComun, plano };
