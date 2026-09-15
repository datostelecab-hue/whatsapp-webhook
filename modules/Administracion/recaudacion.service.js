// ============================================================
// RECAUDACIÓN · SERVICIO — el dinero que el conductor debe a la casa
// ============================================================
// BOLT le paga al conductor todo lo que factura, incluido lo que cobró EN
// EFECTIVO y ya tiene en el bolsillo. Ese efectivo es una deuda con la empresa,
// y este módulo la lleva: cuánto debe cada uno, qué ha entregado y por dónde.
//
// ── LAS CINCO COSAS QUE HAY QUE SABER ───────────────────────────────────────
//
// 1. DOS PERMISOS, NO UNO. Entrar y cobrar EN MANO es '/recaudacion'; apuntar
//    lo que se descuenta POR NÓMINA es '/recaudacion/nomina', y eso es de RRHH:
//    quien cobra en ventanilla no tiene por qué poder tocar la nómina de nadie.
//    Ninguno viene sembrado en ningún rol — el módulo nace apagado y los reparte
//    el jefe a mano.
//
// 2. EL PERMISO SE COMPRUEBA AQUÍ, NO SOLO EN EL MENÚ. Esconder un botón no es
//    una autorización: quien conozca la URL la llama igual. Por eso
//    `puedeNomina` se vuelve a preguntar al apuntar, y no solo al pintar.
//
// 3. QUIÉN ES CADA UNO SALE DE LA SESIÓN, NUNCA DEL CUERPO DE LA PETICIÓN. En
//    un módulo de caja, "lo apuntó Fulano" tiene que ser verdad.
//
// 4. LA CIFRA DE BOLT NO SE TECLEA: SE CALCULA Y SE CONGELA. Lo anterior al
//    corte lo manda el Excel que se importó, y el repositorio se niega a
//    tocarlo — si no, un recálculo reescribiría un histórico que ya se cuadró
//    con la gente.
//
// 5. EL CUADRO ES EL ACUMULADO, SIN QUINCENAS. La quincena sigue existiendo por
//    dentro (es la caja donde se guarda cada cierre de BOLT) pero ya no se
//    navega: lo que se pregunta de alguien es cuánto debe EN TOTAL.

const repo = require('./recaudacion.repo');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

/**
 * ¿Puede este usuario apuntar descuentos de nómina? Ver las notas 1 y 2.
 *
 * Si la consulta de permisos falla se responde que NO. En un módulo de caja, la
 * duda se resuelve cerrando: dejar pasar por un fallo de red sería peor que
 * hacerle repetir a alguien que sí podía.
 */
async function puedeNomina(usuario, usuarioId) {
  if (ADMIN_TOTAL.includes((usuario || {}).rol)) return true;
  try {
    return usuarioId ? (await permisos.clavesDe(usuarioId)).has('/recaudacion/nomina') : false;
  } catch (_) { return false; }
}

/** Lo que hace falta para pintar la pantalla: los catálogos y qué puede quien mira. */
const paraLaPantalla = async (usuario, usuarioId) => ({
  denominaciones: repo.DENOMINACIONES.map(c => ({ centimos: c, etiqueta: repo.ETIQUETA_DEN(c) })),
  tiposMovimiento: repo.TIPOS,
  salidasCaja: repo.SALIDAS,
  // Para poner nombre a lo que YA está apuntado, incluido el traspaso de
  // apertura, que se lee pero no se elige.
  etiquetasSalida: repo.TODAS_SALIDAS,
  puedeNomina: await puedeNomina(usuario, usuarioId),
});

// ── Mirar ──────────────────────────────────────────────────────────────────

/** EL CUADRO: quién debe cuánto, más la caja y sus salidas. Ver la nota 5. */
async function cuadro(usuario, usuarioId) {
  const [datos, caja, salidas] = await Promise.all([repo.cuadro(), repo.cuadre(), repo.salidas()]);
  return {
    ...datos, caja, salidas,
    corte: repo.etiquetaQuincena(repo.CORTE),
    puedeNomina: await puedeNomina(usuario, usuarioId),
  };
}

/**
 * ¿CUADRA TODO? Ocho comprobaciones que pueden fallar de verdad. No escribe
 * nada, así que se puede pulsar cuando se quiera.
 */
const comprobar = () => repo.comprobar();

/** La ficha de un conductor: su histórico entero por quincenas. */
const ficha = id => repo.ficha(id);

/** El desplegable de "Nuevo ingreso". */
const candidatos = async () => ({ conductores: await repo.candidatos() });

/**
 * Lo que BOLT dice AHORA MISMO desde el corte, SIN congelar nada: para mirar
 * antes de tocar. Es la vista previa de lo que haría "calcular".
 */
async function loQueDiceBolt() {
  let total = 0;
  const gente = new Set();
  for (const q of repo.quincenasDesdeCorte()) {
    for (const c of await repo.efectivoBolt(q)) {
      total += c.importe;
      gente.add(c.conductorId || c.boltUuid);
    }
  }
  return { desde: repo.etiquetaQuincena(repo.CORTE), conductores: gente.size, total: +total.toFixed(2) };
}

// ── Apuntar ────────────────────────────────────────────────────────────────

/**
 * APUNTAR DINERO. Lo presencial lo hace quien entra; lo de nómina, solo quien
 * tenga su permiso, y se comprueba aquí (nota 2).
 */
async function anotar(b, usuario, usuarioId) {
  if (b.tipo === 'nomina' && !(await puedeNomina(usuario, usuarioId))) {
    throw new Error('Los descuentos de nómina los apunta RRHH; tú puedes apuntar lo que se cobra en mano.');
  }
  return repo.anotar({
    conductorId: b.conductorId, fecha: b.fecha, tipo: b.tipo, importe: b.importe,
    desglose: b.desglose, observacion: b.observacion, usuarioId,
  });
}

/** Anular un movimiento. Queda anulado con su motivo, no se borra. */
const anular = (id, usuarioId, motivo) => repo.anular(id, { usuarioId, motivo });

// ── El cierre de BOLT ──────────────────────────────────────────────────────

/** Poner al día lo que dice BOLT, de la quincena del corte hasta hoy. Ver la nota 4. */
const recalcular = usuarioId => repo.recalcularTodo({ usuarioId });

/**
 * Lo mismo, pero SOLO las quincenas vivas (la de ahora y la anterior). Es lo que
 * corre cada media hora: recalcular el histórico entero treinta veces al día
 * sería trabajo tirado, y lo cerrado no cambia.
 */
const recalcularReciente = opciones => repo.recalcularReciente(opciones || {});

/** Un arrastre (o una corrección) sobre una quincena, con su motivo. */
const ajustarCierre = (b, usuarioId) => repo.ajustarCierre({
  conductorId: b.conductorId, anio: b.anio, mes: b.mes, quincena: b.quincena,
  ajuste: b.ajuste, motivo: b.motivo, usuarioId,
});

/** El cierre de una quincena a mano, conductor a conductor. */
const guardarCierre = (b, usuarioId) => repo.guardarCierre({
  conductorId: b.conductorId, anio: b.anio, mes: b.mes, quincena: b.quincena,
  importe: b.importe, origen: 'manual', usuarioId,
});

/** O pegando el cierre entero desde el Excel. */
const importarCierre = (b, usuarioId) => repo.importarCierre({
  anio: b.anio, mes: b.mes, quincena: b.quincena, texto: b.texto, usuarioId,
});

module.exports = {
  puedeNomina, paraLaPantalla,
  cuadro, comprobar, ficha, candidatos, loQueDiceBolt,
  anotar, anular,
  recalcular, recalcularReciente, ajustarCierre, guardarCierre, importarCierre,
};
