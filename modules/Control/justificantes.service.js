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
const menosJ = require('../../services/repo/menosJ');
const kmj = require('../../services/repo/kmJustificacion');
const permisos = require('../../services/permisos');
const contadores = require('../../services/contadores');

const TIPOS_J = repo.TIPOS_J;
const CASUISTICAS_MENOS_J = menosJ.CASUISTICAS;

// LA −J (30/10/2026, db/227) tiene su pestaña en esta misma cola: nace
// pendiente y se aprueba o se rechaza aquí, como una J. Es constancia: no toca
// horas, nómina ni letra. `tipo` = 'menos_j' es esa pestaña.
const MENOS_J = 'menos_j';

// LAS JUSTIFICACIONES DE KM (18/11/2026, db/268) también tienen aquí su
// pestaña: los km fuera de BOLT que no cuentan en el banco de KM. Control las
// apunta (aquí, en la ficha del banco o en la misma J) y las aprueba QUIEN
// APRUEBA LAS J, la llave «/justificantes» (Camilo, 26/11/2026: «quien aprueba
// las J»), o quien tenga la de KM, «/justificantes/km», para darla sin las J.
// `tipo` = 'km' es esa pestaña.
const KM = 'km';
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];
const CLAVE_J = '/justificantes';
const apruebaConClaves = claves => claves.has(CLAVE_J) || claves.has(kmj.CLAVE_APROBAR);
/** ¿Aprueba justificaciones de KM? quien = { id, rol }. */
async function apruebaKm(quien) {
  if (!quien || !quien.id) return false;
  if (ADMIN_TOTAL.includes(quien.rol)) return true;
  try { return apruebaConClaves(await permisos.clavesDe(quien.id)); } catch (_) { return false; }
}
const sinTabla = (p, valor) => p.catch(e => { if (kmj.faltaMigracion(e)) return valor; throw e; });

/** Las pendientes de cada pestaña: las de cada tipo de J y las −J. */
async function pendientesTodas() {
  const [porTipo, n, km] = await Promise.all([repo.pendientesPorTipo(), menosJ.pendientes(), sinTabla(kmj.pendientes(), 0)]);
  return { ...porTipo, [MENOS_J]: n, [KM]: km };
}

/**
 * LA COLA con lo que hace falta para pintarla de una vez: las filas del filtro,
 * cuántas pendientes hay por tipo (los contadores de las pestañas) y las
 * cuentas del periodo. Las tres a la vez porque la pantalla las pide juntas y
 * tres peticiones sueltas se desincronizan entre sí.
 */
async function cola({ estado, tipo, desde, hasta } = {}, quien = null) {
  if (tipo === KM) {
    const [filas, pendientes, cuentas, aprueba] = await Promise.all([
      sinTabla(kmj.listar({ estado: estado || 'pendiente', desde, hasta }), []),
      pendientesTodas(),
      sinTabla(kmj.cuentas({ desde, hasta }), {}),
      apruebaKm(quien),
    ]);
    return { filas, pendientes, cuentas, km: true, aprueba };
  }
  if (tipo === MENOS_J) {
    const [filas, pendientes, cuentas] = await Promise.all([
      menosJ.listar({ estado: estado || 'pendiente', desde, hasta }),
      pendientesTodas(),
      menosJ.cuentas({ desde, hasta }),
    ]);
    return { filas, pendientes, cuentas, menosJ: true };
  }
  const [filas, pendientes, cuentas] = await Promise.all([
    repo.listar({ estado: estado || 'pendiente', tipo: tipo || undefined, desde, hasta }),
    pendientesTodas(),
    repo.cuentas({ desde, hasta }),
  ]);
  // Las J «Por compañero» que ya llevan la −J de quien lo causó: a esas no se
  // les vuelve a ofrecer.
  const conMenos = await menosJ.deJustificantes(filas.filter(f => f.tipo === 'companero').map(f => f.id));
  filas.forEach(f => { if (f.tipo === 'companero') f.conMenosJ = conMenos.has(f.id); });
  return { filas, pendientes, cuentas };
}

const aprobar = (id, usuarioId) => repo.aprobar(id, { usuarioId });
const rechazar = (id, usuarioId, motivo) => repo.rechazar(id, { usuarioId, motivo });

/** Rehacerla con las horas buenas. Los datos nuevos llegan en el cuerpo. */
const rehacer = (id, usuarioId, datos) => repo.rehacer(id, { ...(datos || {}), usuarioId });

/** Cerrarla sin rehacerla: se llamó, se habló y no hay horas que justificar. */
const cerrar = (id, usuarioId, nota) => repo.cerrar(id, { usuarioId, nota });

const reabrir = (id, usuarioId) => repo.reabrir(id, { usuarioId });

// ── La −J ──
/** Desde aquí nace siempre de una J «Por compañero»: la de quien salió perjudicado. */
const ponerMenosJ = (b, usuarioId) => menosJ.poner({ ...b, origen: 'justificante', pantalla: 'justificantes', usuarioId });
const aprobarMenosJ = (id, usuarioId) => menosJ.aprobar(id, { usuarioId });
const rechazarMenosJ = (id, usuarioId, motivo) => menosJ.rechazar(id, { usuarioId, motivo });
const personasMenosJ = () => menosJ.personas();

// ── Las justificaciones de KM ──
const ponerKm = (b, quien) => kmj.poner({ ...(b || {}), origen: 'justificantes', usuarioId: quien && quien.id });
async function exigirKm(quien) {
  if (!await apruebaKm(quien)) {
    const e = new Error('Aprobar o rechazar justificaciones de KM es de quien tiene esa llave');
    e.status = 403;
    throw e;
  }
}
async function aprobarKm(id, quien) { await exigirKm(quien); return kmj.aprobar(id, { usuarioId: quien.id }); }
async function rechazarKm(id, quien, motivo) { await exigirKm(quien); return kmj.rechazar(id, { usuarioId: quien.id, motivo }); }
kmj.avisarCambios(() => contadores.cambio('km_justificados'));

// El número del menú, para quien las aprueba.
contadores.registrarFuente('km_justificados', {
  async contar(q) {
    const aprueba = q && (q.permisos === null || ADMIN_TOTAL.includes(q.rol)
      || (Array.isArray(q.permisos) && apruebaConClaves(new Set(q.permisos))));
    if (!aprueba) return {};
    const n = await sinTabla(kmj.pendientes(), 0);
    return { 'justificantes.km': { n, tono: n ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'justificación' : 'justificaciones'} de KM por aprobar` } };
  },
});

module.exports = {
  TIPOS_J, CASUISTICAS_MENOS_J, cola, aprobar, rechazar, rehacer, cerrar, reabrir,
  ponerMenosJ, aprobarMenosJ, rechazarMenosJ, personasMenosJ,
  ponerKm, aprobarKm, rechazarKm, apruebaKm,
};

