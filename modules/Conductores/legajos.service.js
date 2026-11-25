// ============================================================
// LOS LEGAJOS — el código de la gestoría en la ficha (db/284, 25/11/2026)
// ============================================================
// Fase 0 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md). Camilo:
// «Sí, reutiliza Legajo, solo plantilla propia». El legajo es el número de
// empleado que pone la gestoría y es por donde se cruzará cualquier fichero
// suyo: el nombre no sirve (la gestoría corta los apellidos largos).
//
//   · FORMATO: seis cifras con ceros delante («000057»), como los 258 que había
//     el 25/11. «57», «0057» o « 57 » se guardan como «000057»: dos maneras de
//     escribir el mismo número no pueden acabar siendo dos legajos.
//   · OBLIGATORIO para la plantilla propia en alta, sin imponerlo (la gestoría
//     lo da después del alta): falta = «Fichas con huecos» en Plantilla.
//   · CARGA DESDE UN EXCEL: cualquier hoja con una columna de DNI/NIE y otra de
//     legajo (o «código», «nº de empleado»). Se cruza por el DNI, nunca por el
//     nombre. Solo se rellena al que no tiene; lo que no cuadra (otro legajo, un
//     legajo de otra persona, un DNI que no está, un número repetido en el
//     fichero) no se toca y sale como incidencia, para revisarlo a mano. El
//     mismo fichero no se carga dos veces (services/ficherosImportados.js).
'use strict';

const repo = require('./conductores.repo');
const libro = require('../../services/libro');
const ficheros = require('../../services/ficherosImportados');

const { normalizar, claveDni } = require('./legajo');

const TIPO_FICHERO = 'legajos';

const plano = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[º°ª.\/_-]/g, ' ').replace(/\s+/g, ' ').trim();

const CAB_DNI = new Set(['dni', 'nie', 'nif', 'dni nie', 'nif nie', 'dni nif', 'documento', 'n documento', 'numero documento',
  'num documento', 'documento identidad', 'n identificacion', 'identificacion']);
const CAB_LEGAJO = new Set(['legajo', 'n legajo', 'codigo', 'cod', 'codigo empleado', 'cod empleado', 'n empleado', 'numero empleado',
  'num empleado', 'codigo trabajador', 'cod trabajador', 'n trabajador', 'numero trabajador', 'codigo gestoria', 'empleado', 'n emp', 'cod emp']);
const CAB_NOMBRE = new Set(['trabajador', 'nombre', 'apellidos y nombre', 'nombre y apellidos', 'nombre completo', 'empleado nombre']);

/** El valor de una celda de ExcelJS, en texto. */
function valor(c) {
  let v = c && c.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
    else if (v.text !== undefined) v = v.text;
  }
  return v == null ? '' : String(v);
}

/**
 * LEE EL EXCEL: la primera hoja que tenga una columna de DNI y otra de legajo
 * en sus 15 primeras filas. Devuelve { hoja, filaCabecera, columnas, filas:
 * [{ fila, dni, legajo, nombre }] }. Si no las encuentra, lanza diciendo qué
 * cabeceras ha visto.
 */
async function leerExcel(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (e) { throw new Error('No se puede abrir: tiene que ser un Excel (.xlsx)'); }
  const vistas = [];
  for (const ws of wb.worksheets) {
    for (let n = 1; n <= Math.min(15, ws.rowCount); n++) {
      const row = ws.getRow(n);
      const cols = {};
      row.eachCell({ includeEmpty: false }, (c, k) => {
        const h = plano(valor(c));
        if (!h) return;
        if (n <= 3) vistas.push(`${ws.name}: «${valor(c).trim()}»`);
        if (!cols.dni && CAB_DNI.has(h)) cols.dni = k;
        else if (!cols.legajo && CAB_LEGAJO.has(h)) cols.legajo = k;
        else if (!cols.nombre && CAB_NOMBRE.has(h)) cols.nombre = k;
      });
      if (cols.dni && cols.legajo) {
        const filas = [];
        for (let i = n + 1; i <= ws.rowCount; i++) {
          const r = ws.getRow(i);
          const dni = valor(r.getCell(cols.dni)).trim();
          const legajo = valor(r.getCell(cols.legajo)).trim();
          const nombre = cols.nombre ? valor(r.getCell(cols.nombre)).trim() : '';
          if (!dni && !legajo) continue;
          filas.push({ fila: i, dni, legajo, nombre });
        }
        const cab = k => valor(row.getCell(k)).trim();
        return { hoja: ws.name, filaCabecera: n, columnas: { dni: cab(cols.dni), legajo: cab(cols.legajo), nombre: cols.nombre ? cab(cols.nombre) : null }, filas };
      }
    }
  }
  const muestra = [...new Set(vistas)].slice(0, 12).join(', ');
  throw new Error('No encuentro una columna de DNI/NIE y otra de legajo (o «código», «nº de empleado»).'
    + (muestra ? ` He visto: ${muestra}.` : ' El Excel parece vacío.'));
}

const MOTIVOS = {
  dni_vacio: 'Sin DNI',
  legajo_invalido: 'Legajo que no es un número de 1 a 6 cifras',
  desconocido: 'Ese DNI no está en el ERP',
  dni_repetido_erp: 'Ese DNI lo tienen dos fichas del ERP',
  repetido_fichero: 'Repetido en el fichero (el mismo legajo con otro DNI, o el mismo DNI con otro legajo)',
  distinto: 'Ya tiene otro legajo en el ERP',
  ocupado: 'Ese legajo ya lo tiene otra persona en el ERP',
};

/**
 * EL CRUCE (puro): qué se pone, qué ya estaba y qué no cuadra.
 * `personas`: [{ id, nombre, dni_nie, legajo, empleo_vigente, empleo_tipo }].
 */
function cruzar(filas, personas) {
  const porDni = new Map();
  for (const p of personas) {
    const k = claveDni(p.dni_nie);
    if (!k) continue;
    if (!porDni.has(k)) porDni.set(k, []);
    porDni.get(k).push(p);
  }
  const duenoDe = new Map(personas.filter(p => p.legajo).map(p => [p.legajo, p]));

  // Primero, cada fila en limpio; luego, lo repetido dentro del propio fichero.
  const limpias = filas.map(f => {
    const dni = claveDni(f.dni);
    let legajo = null, motivo = null;
    if (!dni) motivo = 'dni_vacio';
    else {
      try { legajo = normalizar(f.legajo); } catch (_) { legajo = null; }
      if (!legajo) motivo = 'legajo_invalido';
    }
    return { ...f, dniClave: dni, legajoNorm: legajo, motivo };
  });
  const legajosDe = new Map(), dnisDe = new Map();
  for (const f of limpias.filter(x => !x.motivo)) {
    if (!legajosDe.has(f.dniClave)) legajosDe.set(f.dniClave, new Set());
    legajosDe.get(f.dniClave).add(f.legajoNorm);
    if (!dnisDe.has(f.legajoNorm)) dnisDe.set(f.legajoNorm, new Set());
    dnisDe.get(f.legajoNorm).add(f.dniClave);
  }

  const poner = [], igual = [], incidencias = [];
  const yaPuesto = new Set();
  for (const f of limpias) {
    const base = { fila: f.fila, dni: f.dni, legajo: f.legajoNorm || f.legajo, nombreFichero: f.nombre || '' };
    if (f.motivo) { incidencias.push({ ...base, motivo: f.motivo }); continue; }
    if (legajosDe.get(f.dniClave).size > 1 || dnisDe.get(f.legajoNorm).size > 1) { incidencias.push({ ...base, motivo: 'repetido_fichero' }); continue; }
    const ps = porDni.get(f.dniClave) || [];
    if (!ps.length) { incidencias.push({ ...base, motivo: 'desconocido' }); continue; }
    if (ps.length > 1) { incidencias.push({ ...base, motivo: 'dni_repetido_erp', ids: ps.map(p => String(p.id)) }); continue; }
    const p = ps[0];
    const quien = { id: String(p.id), nombre: p.nombre, deAlta: !!p.empleo_vigente, ett: p.empleo_tipo === 'ett' };
    if (p.legajo === f.legajoNorm) { if (!yaPuesto.has(quien.id)) igual.push({ ...base, ...quien }); yaPuesto.add(quien.id); continue; }
    if (p.legajo) { incidencias.push({ ...base, ...quien, motivo: 'distinto', legajoErp: p.legajo }); continue; }
    const otro = duenoDe.get(f.legajoNorm);
    if (otro && String(otro.id) !== quien.id) { incidencias.push({ ...base, ...quien, motivo: 'ocupado', de: { id: String(otro.id), nombre: otro.nombre } }); continue; }
    if (yaPuesto.has(quien.id)) continue;   // la misma fila dos veces: una basta
    yaPuesto.add(quien.id);
    poner.push({ ...base, ...quien });
  }
  return {
    leidas: filas.length, poner, igual,
    incidencias: incidencias.map(i => ({ ...i, explicacion: MOTIVOS[i.motivo] || i.motivo })),
  };
}

/** Quién puede cargar y ver los legajos: quien puede escribir los datos de Seguridad Social de la ficha. */
const puede = quien => !!quien && repo.camposDe(quien.rol).includes('legajo');

ficheros.registrarTipo(TIPO_FICHERO, { etiqueta: 'Legajos de la gestoría', ver: async quien => puede(quien) });

/**
 * CARGA LOS LEGAJOS DE UN EXCEL. Sin `confirmar`, solo dice qué haría; con él,
 * pone los que faltan (en una transacción, firmada en el libro) y apunta la
 * carga. Devuelve el cruce, la estructura leída y, si se aplicó, la carga.
 */
async function cargar({ base64, nombre, confirmar = false } = {}, quien = {}) {
  if (!puede(quien)) throw new Error('Cargar legajos es de quien lleva los datos de Seguridad Social de la ficha');
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw new Error('No ha llegado ningún fichero');
  const nombreFichero = String(nombre || 'legajos.xlsx').slice(0, 255);
  const h = ficheros.huella(buffer);
  const leido = await leerExcel(buffer);
  const cruce = cruzar(leido.filas, await repo.personasParaLegajos());
  const estructura = { hoja: leido.hoja, filaCabecera: leido.filaCabecera, columnas: leido.columnas };
  const resumen = {
    leidas: cruce.leidas, poner: cruce.poner.length, igual: cruce.igual.length, incidencias: cruce.incidencias.length,
    ett: cruce.poner.filter(p => p.ett).length, deBaja: cruce.poner.filter(p => !p.deAlta).length,
  };
  if (!confirmar) {
    let ya = null;
    try { await ficheros.exigirNuevo(TIPO_FICHERO, h); } catch (e) { if (e.yaCargado) ya = e.yaCargado; else throw e; }
    return { previa: true, yaCargado: ya, estructura, resumen, poner: cruce.poner, incidencias: cruce.incidencias };
  }
  await ficheros.exigirNuevo(TIPO_FICHERO, h);
  const cargaId = await libro.conFirma({
    usuarioId: quien.usuarioId, origen: 'plantilla · legajos', accion: 'cambio',
    motivo: `Legajos cargados del fichero «${nombreFichero}»`,
  }, async cli => {
    const puestos = await repo.ponerLegajos(cli, cruce.poner.map(p => ({ id: p.id, legajo: p.legajo })));
    return ficheros.apuntar(cli, {
      tipo: TIPO_FICHERO, nombre: nombreFichero, buffer, estructura,
      resultado: { ...resumen, puestos, incidencias: cruce.incidencias },
      incidencias: cruce.incidencias.length, usuarioId: quien.usuarioId,
    });
  });
  await ficheros.guardarOriginal(cargaId, {
    nombre: nombreFichero, buffer, usuarioId: quien.usuarioId,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { previa: false, cargaId, estructura, resumen, poner: cruce.poner, incidencias: cruce.incidencias };
}

/**
 * PONE UN LEGAJO en una ficha (desde la plantilla de la gestoría, módulo 8),
 * por el mismo camino que la ficha: en limpio, y diciendo de quién es si ya lo
 * tiene otra persona. Devuelve el legajo que tenía antes (o null).
 */
async function asignar(conductorId, valor, quien = {}) {
  if (!puede(quien)) throw new Error('Poner legajos es de quien lleva los datos de Seguridad Social de la ficha');
  const antes = await repo.legajoDe(conductorId);
  if (antes === undefined) throw new Error('No existe esa ficha');
  await repo.actualizar(conductorId, { legajo: normalizar(valor) }, { usuarioId: quien.usuarioId, rol: quien.rol });
  return antes;
}

/** Lo que falta: la plantilla propia en alta sin legajo, y las últimas cargas. */
async function estado(quien = {}) {
  if (!puede(quien)) throw new Error('Los legajos los ve quien lleva los datos de Seguridad Social de la ficha');
  const [sinLegajo, cargas] = await Promise.all([repo.propiaSinLegajo(), ficheros.ultimas(TIPO_FICHERO, quien, { limite: 10 })]);
  return { sinLegajo, ...cargas };
}

module.exports = { normalizar, claveDni, leerExcel, cruzar, cargar, estado, asignar, MOTIVOS, TIPO_FICHERO };
