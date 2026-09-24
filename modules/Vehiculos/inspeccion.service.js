// ============================================================
// INSPECCIÓN DE VEHÍCULOS — la puerta
// ============================================================
// El primer submódulo de taller (24/09/2026). Lo que decide este servicio y no
// el repositorio:
//
//   · CÓMO SE LEE EL EXCEL del taller. Las columnas se buscan por su TÍTULO, no
//     por su posición: si alguien mete una columna en medio, no se desplaza
//     todo un sitio y se apunta la V16 donde iba el chaleco.
//   · QUÉ SE IMPORTA. Solo los coches que están en nuestro sistema, de la sede
//     que sean; las matrículas que no están se IGNORAN y se devuelven en una
//     lista para darlas de alta a mano. Lo pidió Camilo.
//   · QUE NO SE DUPLIQUE. Cada fila deja una huella; reimportar el mismo Excel
//     no apunta nada, y uno nuevo solo añade inspección a los coches que
//     cambiaron.
//   · LOS COCHES QUE NO VIENEN EN EL EXCEL y no tienen ninguna inspección se
//     apuntan con TODO EN «FALTA», también por decisión de Camilo: así salen
//     como pendientes de inspeccionar en vez de desaparecer de la lista. Solo
//     los que no tienen ninguna: a uno que ya tenga inspección no se le pisa.
//   · SE COMPRUEBA TODO ANTES DE ESCRIBIR NADA. Un valor que no se entiende en
//     cualquier fila para la importación entera, y se dice cuál y dónde.

const crypto = require('crypto');
const repo = require('./inspeccion.repo');
const { SEDE_FLOTA } = require('../../services/nucleo');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Sin acentos, sin emojis, sin signos, en minúsculas y con los espacios justos. */
const plano = v => String(v == null ? '' : v)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const normMat = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** El texto de una celda de exceljs, venga como venga (texto, número, fórmula, texto enriquecido). */
function texto(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('').trim();
    if (v.result !== undefined) return texto(v.result);
    if (v.text !== undefined) return texto(v.text);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

// ── Cómo se traduce cada valor del Excel ────────────────────────────────────

/** «✅ Correcto» → 'correcto'. Vacío = no se revisó. Lo que no se entiende, error. */
function estadoDe(valor) {
  const p = plano(valor);
  if (!p) return null;
  if (p.includes('no se requiere') || p.includes('no aplica')) return 'no_aplica';
  if (p.includes('deteriorad')) return 'deteriorado';
  if (p.includes('falta')) return 'falta';
  if (p.includes('correcto')) return 'correcto';
  throw new Error(`no se entiende el estado «${valor}»`);
}

/** «✅ Apto — Todo en orden» → 'apto'. «No apto» se mira antes: también dice «apto». */
function resultadoDe(valor) {
  const p = plano(valor);
  if (!p) return null;
  if (p.includes('no apto')) return 'no_apto';
  if (p.includes('observ')) return 'apto_obs';
  if (p.includes('apto')) return 'apto';
  throw new Error(`no se entiende el resultado «${valor}»`);
}

/** «Marzo» o «3» → 3. Vacío → null. */
function mesDe(valor) {
  const p = plano(valor);
  if (!p) return null;
  const n = Number(p);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const i = MESES.indexOf(p);
  if (i >= 0) return i + 1;
  throw new Error(`no se entiende el mes «${valor}»`);
}

/** «2027» → 2027. Vacío → null. */
function anioDe(valor) {
  const p = plano(valor);
  if (!p) return null;
  const n = Number(p);
  if (Number.isInteger(n) && n >= 2000 && n <= 2100) return n;
  throw new Error(`no se entiende el año «${valor}»`);
}

// Las columnas que no son elementos, por su título ya «plano». Si el Excel
// cambia un título, se cambia aquí; los elementos van en su catálogo (db/150).
const COLUMNAS_FIJAS = {
  matricula: ['matricula del vehiculo', 'matricula'],
  marca: ['marca'],
  modelo: ['modelo'],
  itvMes: ['itv mes de caducidad'],
  itvAnio: ['itv ano de caducidad'],
  vtcDelanteraMes: ['pegatina vtc delantera mes de caducidad'],
  vtcDelanteraAnio: ['pegatina vtc delantera ano de caducidad'],
  vtcTraseraMes: ['pegatina vtc trasera mes de caducidad'],
  vtcTraseraAnio: ['pegatina vtc trasera ano de caducidad'],
  observaciones: ['observaciones adicionales', 'observaciones'],
  resultado: ['resultado final de la inspeccion', 'resultado'],
};

/**
 * Lee el Excel del taller. Devuelve { filas, errores }: cada fila con la
 * matrícula y lo que se entendió; cada error con la fila y la columna.
 */
async function leerExcel(bytes, elementos) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes); }
  catch (e) { throw new Error('No se pudo abrir el archivo: tiene que ser un Excel (.xlsx)'); }

  // La hoja es la que tenga la columna de la matrícula en la primera fila.
  const cabeceraDe = ws => {
    const m = new Map();
    ws.getRow(1).eachCell({ includeEmpty: false }, (c, col) => m.set(plano(texto(c.value)), col));
    return m;
  };
  let ws = null, cab = null;
  for (const h of wb.worksheets) {
    const c = cabeceraDe(h);
    if (COLUMNAS_FIJAS.matricula.some(t => c.has(t))) { ws = h; cab = c; break; }
  }
  if (!ws) throw new Error('No encuentro la hoja: ninguna tiene la columna «Matrícula del vehículo» en la primera fila');

  const col = alias => { for (const t of alias) if (cab.has(t)) return cab.get(t); return null; };
  const fijas = Object.fromEntries(Object.entries(COLUMNAS_FIJAS).map(([k, a]) => [k, col(a)]));
  const deElemento = elementos.map(e => ({ codigo: e.codigo, etiqueta: e.etiqueta, col: col([plano(e.cabecera_excel || e.etiqueta)]) }));
  const sinColumna = deElemento.filter(e => !e.col).map(e => e.etiqueta);

  const filas = [], errores = [];
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const val = c => (c ? texto(row.getCell(c).value) : '');
    const matricula = normMat(val(fijas.matricula));
    if (!matricula) continue;                        // filas vacías o de relleno
    const f = { fila: n, matricula, elementos: {} };
    const intenta = (columna, fn) => { try { return fn(); } catch (e) { errores.push(`Fila ${n} (${matricula}), ${columna}: ${e.message}`); return null; } };
    f.marca = val(fijas.marca) || null;
    f.modelo = val(fijas.modelo) || null;
    f.itvMes = intenta('ITV — mes', () => mesDe(val(fijas.itvMes)));
    f.itvAnio = intenta('ITV — año', () => anioDe(val(fijas.itvAnio)));
    f.vtcDelanteraMes = intenta('Pegatina VTC delantera — mes', () => mesDe(val(fijas.vtcDelanteraMes)));
    f.vtcDelanteraAnio = intenta('Pegatina VTC delantera — año', () => anioDe(val(fijas.vtcDelanteraAnio)));
    f.vtcTraseraMes = intenta('Pegatina VTC trasera — mes', () => mesDe(val(fijas.vtcTraseraMes)));
    f.vtcTraseraAnio = intenta('Pegatina VTC trasera — año', () => anioDe(val(fijas.vtcTraseraAnio)));
    f.observaciones = val(fijas.observaciones) || null;
    f.resultado = intenta('Resultado', () => resultadoDe(val(fijas.resultado)));
    deElemento.filter(e => e.col).forEach(e => {
      const est = intenta(e.etiqueta, () => estadoDe(val(e.col)));
      if (est) f.elementos[e.codigo] = est;
    });
    filas.push(f);
  }
  return { hoja: ws.name, filas, errores, sinColumna };
}

/** Lo que identifica una inspección leída: si no cambia, no se vuelve a apuntar. */
function huellaDe(d) {
  const lo = {
    marca: d.marca || null, modelo: d.modelo || null,
    itv: [d.itvMes || null, d.itvAnio || null],
    vtcD: [d.vtcDelanteraMes || null, d.vtcDelanteraAnio || null],
    vtcT: [d.vtcTraseraMes || null, d.vtcTraseraAnio || null],
    obs: d.observaciones || null, res: d.resultado || null,
    el: Object.keys(d.elementos || {}).sort().map(k => [k, d.elementos[k]]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(lo)).digest('hex');
}

const FALTA_OBS = 'No venía en el Excel de inspecciones del taller: todo en «Falta» hasta que se inspeccione.';

/**
 * IMPORTA EL EXCEL del taller.
 *
 * `fecha` (AAAA-MM-DD) es opcional: el Excel no dice cuándo se hizo cada
 * inspección, y si quien lo sube lo sabe, se apunta. Si no, quedan sin fecha.
 *
 * Devuelve el informe: cuántas se apuntaron, cuántas no cambiaban, qué
 * matrículas se ignoraron por no estar en el sistema y qué coches quedaron con
 * todo en «Falta».
 */
async function importar({ base64, fecha } = {}, quien = {}) {
  const limpio = String(base64 || '').replace(/^data:[^,]*,/, '');
  if (!limpio) throw new Error('No ha llegado ningún archivo');
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw new Error('La fecha tiene que ser dd/mm/aaaa');

  const cat = await repo.catalogos();
  const leido = await leerExcel(Buffer.from(limpio, 'base64'), cat.elementos);
  if (leido.errores.length) {
    const e = new Error(`No se ha importado nada: hay ${leido.errores.length} valor(es) que no se entienden. ` +
      leido.errores.slice(0, 12).join(' · ') + (leido.errores.length > 12 ? ' · …' : ''));
    e.errores = leido.errores;
    throw e;
  }

  // La misma matrícula dos veces: vale la ÚLTIMA fila, y se avisa.
  const avisos = [];
  const porMat = new Map();
  leido.filas.forEach(f => {
    if (porMat.has(f.matricula)) avisos.push(`${f.matricula} sale dos veces (filas ${porMat.get(f.matricula).fila} y ${f.fila}): vale la ${f.fila}`);
    porMat.set(f.matricula, f);
  });
  if (leido.sinColumna.length) avisos.push('El Excel no trae la columna de: ' + leido.sinColumna.join(', '));

  const coches = await repo.vehiculosPorMatricula([...porMat.keys()]);
  const ignoradas = [...porMat.keys()].filter(m => !coches.has(m)).sort();
  const huellas = await repo.ultimasHuellas([...coches.values()].map(c => c.id));

  const apuntadas = [], sinCambios = [];
  for (const f of porMat.values()) {
    const coche = coches.get(f.matricula);
    if (!coche) continue;
    const d = { ...f, vehiculoId: coche.id, fecha: fecha || null, origen: 'excel' };
    d.huella = huellaDe(d);
    if (huellas.get(String(coche.id)) === d.huella) { sinCambios.push(coche.matricula); continue; }
    await repo.crear(d, quien);
    apuntadas.push(coche.matricula);
  }

  // Los que no vienen en el Excel y no tienen NINGUNA inspección: todo en «Falta».
  const enFalta = [];
  const todos = Object.fromEntries(cat.elementos.map(e => [e.codigo, 'falta']));
  for (const v of await repo.sinNingunaInspeccion()) {
    if (porMat.has(normMat(v.matricula))) continue;
    const d = { vehiculoId: v.id, fecha: null, origen: 'excel', elementos: todos, observaciones: FALTA_OBS };
    d.huella = huellaDe(d);
    await repo.crear(d, quien);
    enFalta.push(v.matricula + (v.sede && v.sede !== SEDE_FLOTA ? ` (${v.sede})` : ''));
  }

  console.log(`🔎 [INSPECCIÓN] Excel «${leido.hoja}»: ${apuntadas.length} apuntada(s), ${sinCambios.length} sin cambios, ` +
    `${ignoradas.length} ignorada(s), ${enFalta.length} en «Falta»`);
  return { hoja: leido.hoja, filas: leido.filas.length, apuntadas: apuntadas.length, sinCambios: sinCambios.length,
    ignoradas, enFalta, avisos };
}

// ── Apuntar a mano ──────────────────────────────────────────────────────────

const entero = (v, min, max, que) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${que}: tiene que ser un número entre ${min} y ${max}`);
  return n;
};

/**
 * Apunta una inspección hecha en el taller. La fecha es obligatoria —lo
 * apuntado a mano sí sabe cuándo se hizo—; lo demás, lo que se haya revisado.
 */
async function crear(vehiculoId, b = {}, quien = {}) {
  const cat = await repo.catalogos();
  const fecha = String(b.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Pon la fecha de la inspección (dd/mm/aaaa)');
  const estados = new Set(cat.estados.map(e => e.codigo));
  const elementos = {};
  cat.elementos.forEach(e => {
    const v = (b.elementos || {})[e.codigo];
    if (!v) return;
    if (!estados.has(v)) throw new Error(`«${e.etiqueta}»: estado desconocido`);
    elementos[e.codigo] = v;
  });
  if (!Object.keys(elementos).length) throw new Error('No se ha revisado ningún elemento');
  const resultado = b.resultado || null;
  if (resultado && !cat.resultados.some(r => r.codigo === resultado)) throw new Error('Resultado desconocido');

  const d = {
    vehiculoId: Number(vehiculoId), fecha, origen: 'manual', elementos, resultado,
    marca: String(b.marca || '').trim() || null, modelo: String(b.modelo || '').trim() || null,
    itvMes: entero(b.itvMes, 1, 12, 'Mes de la ITV'), itvAnio: entero(b.itvAnio, 2000, 2100, 'Año de la ITV'),
    vtcDelanteraMes: entero(b.vtcDelanteraMes, 1, 12, 'Mes de la pegatina VTC delantera'),
    vtcDelanteraAnio: entero(b.vtcDelanteraAnio, 2000, 2100, 'Año de la pegatina VTC delantera'),
    vtcTraseraMes: entero(b.vtcTraseraMes, 1, 12, 'Mes de la pegatina VTC trasera'),
    vtcTraseraAnio: entero(b.vtcTraseraAnio, 2000, 2100, 'Año de la pegatina VTC trasera'),
    observaciones: String(b.observaciones || '').trim() || null,
  };
  d.huella = huellaDe(d);
  const r = await repo.crear(d, quien);
  console.log(`🔎 [INSPECCIÓN] Apuntada a mano la del vehículo ${vehiculoId} (${fecha}) por el usuario ${quien.usuarioId || '?'}`);
  return r;
}

/** Anula una inspección mal apuntada. Hay que decir por qué. */
async function anular(id, motivo, quien = {}) {
  if (!String(motivo || '').trim()) throw new Error('Di por qué se anula: queda escrito');
  return repo.anular(id, motivo, quien);
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/** La lista: la flota que se vigila y los coches de cualquier sede con inspección. */
async function lista() {
  const [filas, catalogos] = await Promise.all([repo.lista({ sede: SEDE_FLOTA }), repo.catalogos()]);
  return { filas, catalogos };
}

async function ficha(vehiculoId) {
  const f = await repo.ficha(vehiculoId);
  if (!f) throw new Error('No existe ese vehículo');
  return f;
}

const catalogos = () => repo.catalogos();

module.exports = {
  MESES, lista, ficha, catalogos, crear, anular, importar,
  // Sueltas para las pruebas.
  leerExcel, estadoDe, resultadoDe, mesDe, anioDe, huellaDe,
};
