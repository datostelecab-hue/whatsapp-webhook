// ============================================================
// CONVENIO · SERVICIO — la jornada del convenio VTC, mes a mes
// ============================================================
// Lo que el convenio obliga a llevar: la jornada de cada trabajador contra su
// objetivo, el cierre del periodo, la nómina que se manda a la gestoría y el
// cuadro de absentismo.
//
// ── LAS CUATRO COSAS QUE HAY QUE SABER ──────────────────────────────────────
//
// 1. EL MES POR DEFECTO ES EL ÚLTIMO CON OBJETIVOS, no el de hoy. Los objetivos
//    se cargan por adelantado y el mes en curso casi nunca es el que se está
//    revisando. Se resuelve en el servidor para que el selector y la primera
//    carga salgan ya en el mes correcto, sin un parpadeo.
//
// 2. SI NO SE PUEDE SABER, HOY. Que la base no conteste no puede dejar la
//    pantalla en blanco: se cae al mes natural y se sigue.
//
// 3. CERRAR UN MES ES IRREVERSIBLE Y DEJA RASTRO. Fotografía, congela y sella
//    con un manifiesto, y queda apuntado quién lo hizo. Es la pieza que hace
//    que un periodo cerrado siga diciendo lo mismo dentro de un año, que es lo
//    que pide una inspección.
//
// 4. LA REGULARIZACIÓN VA AL MES ABIERTO SIGUIENTE. Lo que sobra o falta de un
//    mes cerrado no se corrige hacia atrás —eso rompería el sello— sino que se
//    apunta en el primer mes abierto. Si no se dice cuál, se toma el siguiente
//    al cerrado, que es el caso normal.

const repo = require('./convenio.repo');

/** Ver las notas 1 y 2. */
async function mesPorDefecto() {
  try { return await repo.mesPorDefecto(); }
  catch (e) {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  }
}

/** Un mes válido de la petición, o el que toca por defecto. */
async function mesDe({ anio, mes } = {}) {
  const a = parseInt(anio, 10), m = parseInt(mes, 10);
  if (a >= 2024 && a <= 2100 && m >= 1 && m <= 12) return { anio: a, mes: m };
  return mesPorDefecto();
}

/** Lo que necesita cualquiera de las cuatro pantallas para arrancar. */
const paraLaPantalla = async () => {
  const { anio, mes } = await mesPorDefecto();
  return { anioInicial: anio, mesInicial: mes };
};

// ── El panel de jornada ────────────────────────────────────────────────────

async function trabajadores(q) {
  const mes = await mesDe(q);
  return { mes, filas: await repo.trabajadores(mes.anio, mes.mes) };
}

const ficha = async id => ({ ficha: await repo.ficha(id) });

// ── Cierre de periodo ──────────────────────────────────────────────────────

const periodos = async () => ({ filas: await repo.periodos() });
const fichaPeriodo = async (anio, mes) => ({ ficha: await repo.fichaPeriodo(anio, mes) });

/** Ver la nota 3. */
async function cerrar({ anio, mes }, quien) {
  const r = await repo.cerrar(anio, mes, quien);
  console.log(`🔒 [CONVENIO] ${quien || '?'} cierra ${anio}-${mes}: ` +
    `${r.contratos} contratos, manifiesto ${String(r.manifiesto || '').slice(0, 12)}…`);
  return { resultado: r };
}

/** Ver la nota 4. */
async function regularizar(b, quien) {
  const oa = Number(b.anio), om = Number(b.mes);
  let aa = Number(b.aplica_anio), am = Number(b.aplica_mes);
  if (!(aa >= 2024 && am >= 1 && am <= 12)) {
    am = om === 12 ? 1 : om + 1;
    aa = om === 12 ? oa + 1 : oa;
  }
  const r = await repo.regularizar(oa, om, aa, am);
  console.log(`♻️  [CONVENIO] ${quien || '?'} regulariza ${oa}-${om} en ${aa}-${am}: ${r.creadas} apunte(s)`);
  return { ...r, aplica: { anio: aa, mes: am } };
}

// ── Absentismo ─────────────────────────────────────────────────────────────

async function absentismo(q) {
  const mes = await mesDe(q);
  return { mes, filas: await repo.absentismo(mes.anio, mes.mes) };
}

async function absentismoModulo(q, modulo) {
  const mes = await mesDe(q);
  return { ficha: await repo.absentismoModulo(mes.anio, mes.mes, modulo) };
}

// ── Nómina ─────────────────────────────────────────────────────────────────

async function nomina(q) {
  const mes = await mesDe(q);
  return { mes, filas: await repo.nominaMes(mes.anio, mes.mes) };
}

async function nominaDetalle(q, id) {
  const mes = await mesDe(q);
  return { ficha: await repo.nominaDetalle(id, mes.anio, mes.mes) };
}

/** El Excel para la gestoría: la nómina del mes y, si las hay, sus bajas. */
async function nominaExcel(q, quien) {
  const { anio, mes } = await mesDe(q);
  const [filas, finiquitos] = await Promise.all([
    repo.nominaMes(anio, mes), repo.finiquitosMes(anio, mes),
  ]);
  const r = await require('./nomina.excel').generar({ anio, mes, filas, finiquitos });
  console.log(`📤 [CONVENIO] ${quien || '?'} exporta nómina ${anio}-${String(mes).padStart(2, '0')}: ` +
    `${filas.length} trabajadores, ${finiquitos.length} finiquitos`);
  return r;
}

module.exports = {
  mesPorDefecto, paraLaPantalla,
  trabajadores, ficha,
  periodos, fichaPeriodo, cerrar, regularizar,
  absentismo, absentismoModulo,
  nomina, nominaDetalle, nominaExcel,
};
