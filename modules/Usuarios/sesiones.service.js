// ============================================================
// SESIONES ABIERTAS · SERVICIO — la puerta, y quién puede cerrar qué
// ============================================================
// La regla del dispositivo padre se aplica AQUÍ y no en la pantalla. Una
// comprobación que solo vive en el botón no protege de nada: basta con llamar a
// la ruta a mano. La vista esconde el botón para no prometer lo que no se puede
// hacer; el que dice que no es este fichero.

const repo = require('./sesiones.repo');

/** Las sesiones abiertas de quien mira, con quién manda y por qué. */
const mias = (usuarioId, sidActual) => repo.listar(usuarioId, sidActual);

/**
 * ¿Puede esta sesión cerrar la de OTRO dispositivo?
 *
 * Solo si está en el dispositivo padre: el del primer inicio de sesión más
 * antiguo, o el que lleve `principal_forzado` puesto desde la base.
 *
 * Sin padre conocido NADIE puede, que es el lado seguro: si la persona no tiene
 * ningún dispositivo registrado —sesiones de antes de esto—, no se reparte el
 * mando por defecto.
 */
async function tieneMando(usuarioId, sidActual) {
  if (!sidActual) return false;
  const [padre, yo] = await Promise.all([repo.padreDe(usuarioId), repo.porSid(sidActual)]);
  if (!padre || !yo || !yo.dispositivo_id) return false;
  return String(yo.dispositivo_id) === String(padre.id);
}

/**
 * Cierra una sesión concreta.
 *
 * DOS PERMISOS DISTINTOS, y hay que separarlos:
 *
 *   · LA PROPIA siempre se puede cerrar. Eso no es echar a nadie, es salir; y
 *     negárselo a quien está en un dispositivo que no manda sería dejarle sin
 *     forma de cerrar el que tiene delante.
 *   · LA DE OTRO DISPOSITIVO, solo desde el padre.
 *
 * Y nunca se cierra la sesión de otra persona: el `usuario_id` de la fila tiene
 * que ser el de quien pide. Sin esa comprobación, un sid ajeno —que es un texto
 * que alguien puede haber visto— cerraría la sesión de cualquiera.
 */
async function cerrarUna({ usuarioId, sidActual, sid }) {
  const objetivo = await repo.porSid(sid);
  if (!objetivo || String(objetivo.usuario_id) !== String(usuarioId)) {
    throw new Error('Esa sesión no es tuya');
  }
  if (objetivo.cerrada_at) return { cerradas: 0, yaEstaba: true };

  const esLaMia = String(sid) === String(sidActual);
  if (!esLaMia && !await tieneMando(usuarioId, sidActual)) {
    const padre = await repo.padreDe(usuarioId);
    throw new Error(padre
      ? `Solo se pueden cerrar otras sesiones desde ${padre.etiqueta || 'el dispositivo principal'}, `
        + 'que es donde entraste por primera vez. Desde aquí solo puedes cerrar esta.'
      : 'Todavía no hay un dispositivo principal registrado: desde aquí solo puedes cerrar esta sesión.');
  }

  const cerradas = await repo.cerrar(sid, { porUsuarioId: usuarioId, motivo: esLaMia ? 'propia' : 'padre' });
  console.log(`🔒 [SESIONES] Usuario ${usuarioId} cierra ${esLaMia ? 'su propia sesión' : 'una sesión ajena'}`);
  return { cerradas, propia: esLaMia };
}

/** Deja solo la de ahora. Es la acción del botón grande, y pide el mando. */
async function cerrarLasDemas({ usuarioId, sidActual }) {
  if (!await tieneMando(usuarioId, sidActual)) {
    const padre = await repo.padreDe(usuarioId);
    throw new Error(padre
      ? `Esto solo se puede hacer desde ${padre.etiqueta || 'el dispositivo principal'}, `
        + 'que es donde entraste por primera vez.'
      : 'Todavía no hay un dispositivo principal registrado.');
  }
  const cerradas = await repo.cerrarLasDemas(usuarioId, sidActual,
    { porUsuarioId: usuarioId, motivo: 'las demas' });
  console.log(`🔒 [SESIONES] Usuario ${usuarioId} cierra ${cerradas} sesión(es) y se queda solo con la suya`);
  return { cerradas };
}

module.exports = {
  mias, tieneMando, cerrarUna, cerrarLasDemas,
  // Para el servicio de sesión, que es quien las abre y las comprueba.
  abrir: repo.abrir, viva: repo.viva, tocar: repo.tocar, cerrar: repo.cerrar,
};
