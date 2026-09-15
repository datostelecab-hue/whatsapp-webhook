// ============================================================
// JUSTIFICANTES · SERVICIO — la cola de aprobación de las J
// ============================================================
// Las J nacen PENDIENTES desde el cockpit o desde las campañas, y aquí el área
// responsable las aprueba o las rechaza: una J de tráfico la aprueba Tráfico,
// una de RRHH la aprueba RRHH.
//
// ── LO QUE HAY QUE SABER ────────────────────────────────────────────────────
//
// · PENDIENTE = PRESUNTA. Cuenta como hora presunta (azul) hasta que alguien la
//   mira. La APROBADA es la única que entra en bitácora y en nómina; la
//   RECHAZADA es una alerta para volver a llamar, no un silencio.
//
// · EL MÓDULO NO ATA TIPOS A ROLES, a propósito. Quién entra a esta pantalla lo
//   decide el desarrollador en `/usuarios` con la clave '/justificantes'. Ese
//   reparto lo eligen ellos y cambia: hoy lo aprueba una persona, mañana un
//   departamento entero.
//
// · RECHAZAR ANULA POR EL CIRCUITO DE SIEMPRE —fuera de bitácora y de los
//   reportes— con quién y por qué. El que la puso tiene que poder saberlo.
//
// · UNA J RECHAZADA TIENE DOS FINALES: rehacerla (con las horas buenas) o
//   cerrarla. Sin ellos el caso se quedaba abierto para siempre: la alerta
//   "Justificación rechazada" pedía llamar y no había forma de decir que ya se
//   había llamado.
//
// El repositorio sigue en `services/repo/justificantes` y NO se muda aquí: la
// Bitácora también lee las J (las aprobadas son horas), y un repositorio puede
// llamar a otro repositorio. Si entrara en este módulo, Bitácora estaría
// entrando al repositorio de Control.

const repo = require('../../services/repo/justificantes');

const TIPOS_J = repo.TIPOS_J;

/**
 * LA COLA con lo que hace falta para pintarla de una vez: las filas del filtro,
 * cuántas pendientes hay por tipo (los contadores de las pestañas) y las
 * cuentas del periodo. Las tres a la vez porque la pantalla las pide juntas y
 * tres peticiones sueltas se desincronizan entre sí.
 */
async function cola({ estado, tipo, desde, hasta } = {}) {
  const [filas, pendientes, cuentas] = await Promise.all([
    repo.listar({ estado: estado || 'pendiente', tipo: tipo || undefined, desde, hasta }),
    repo.pendientesPorTipo(),
    repo.cuentas({ desde, hasta }),
  ]);
  return { filas, pendientes, cuentas };
}

const aprobar = (id, usuarioId) => repo.aprobar(id, { usuarioId });
const rechazar = (id, usuarioId, motivo) => repo.rechazar(id, { usuarioId, motivo });

/** Rehacerla con las horas buenas. Los datos nuevos llegan en el cuerpo. */
const rehacer = (id, usuarioId, datos) => repo.rehacer(id, { ...(datos || {}), usuarioId });

/** Cerrarla sin rehacerla: se llamó, se habló y no hay horas que justificar. */
const cerrar = (id, usuarioId, nota) => repo.cerrar(id, { usuarioId, nota });

const reabrir = id => repo.reabrir(id);

module.exports = { TIPOS_J, cola, aprobar, rechazar, rehacer, cerrar, reabrir };
