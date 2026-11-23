// ============================================================
// PUERTAS — abrir y cerrar un coche, y dejarlo apuntado
// ============================================================
// Vivía dentro de routes/botPuertas.js. Salió aquí (28/09/2026) porque abren
// puertas varias conversaciones: la del turno del conductor (su coche es el del
// turno), la de la gente de oficina con el permiso /puertas (su coche es el que
// escriba) y, desde el 20/11/2026, el portal de conductores. Todas dan la orden
// igual y la apuntan igual.
//
// MAPON DIRECTO, SIN APPS SCRIPT (23/11/2026, Camilo: «vamos con la apertura y
// cierre de puertas de forma directa (…) hagámosla de una directo»). Hasta hoy
// la orden iba a un Apps Script de Google que hacía de relé: una dirección
// pública, sin clave, que abría coches. Ahora va del servidor a Mapon
// (`unit_commands/execute`, con open_doors/close_doors), como el motor. Lo que
// importa saber (docs/API_MAPON.md, documentación oficial de Mapon):
//   · «ok» es que Mapon ACEPTÓ la orden, no que el coche haya abierto: no hay
//     forma de confirmarlo. Por eso se dice «orden enviada», no «abierto».
//   · El equipo: el de la matrícula en el padrón de Mapon, con el del turno si es
//     tan bueno como el mejor (mapon.unidadPorMatricula con `actual`). Nunca un
//     equipo que no lleve esa matrícula: si el que llega no es de ella, se usa el
//     de la matrícula y queda apuntado.
//   · Antes de mandar, que el comando esté en el catálogo de ese equipo (en caché).
//   · Dos órdenes al mismo coche van una detrás de otra (la fila de puertas,
//     aparte de la del motor: «Abrir» no espera a un bloqueo). La MISMA orden
//     pulsada otra vez mientras la primera sigue en camino no sale dos veces:
//     comparte su resultado. Ya contestada, volver a pulsar sí la manda otra vez
//     (es lo que se le pide al conductor si el coche no responde).
//   · Todo queda en `puerta_comando`, con el equipo USADO y lo que contestó Mapon.

const otraSede = require('./otraSede');
const { SEDE_FLOTA } = require('./nucleo');

// ── La fila de puertas, por equipo ───────────────────────────────────────────
// Encadena las órdenes de un mismo equipo (un solo proceso: el backend es uno).
// El tope de espera es MAYOR que lo más que puede durar una orden (catálogo 8 s
// + orden 15 s + reintento por 1011 con su espera y otros 15 s ≈ 41 s): con uno
// menor, una «Cerrar» podía salir con la «Abrir» de antes aún en camino y llegar
// las dos a la vez a Mapon. Cada paso ya tiene su plazo: la fila nunca se atasca.
const ESPERA_FILA_MS = 60 * 1000;
const filas = new Map();   // unitId → { cola: Promise, enCurso: { comando, prom } | null }

function enFila(unitId, comando, fn) {
  const k = String(unitId);
  const f = filas.get(k) || { cola: Promise.resolve(), enCurso: null };
  filas.set(k, f);
  // EL DOBLE TOQUE: la misma orden mientras la primera sigue en camino comparte
  // su resultado; no sale otra.
  if (f.enCurso && f.enCurso.comando === comando) return f.enCurso.prom.then(r => ({ ...r, repetida: true }));
  const anterior = f.cola;
  const esta = (async () => {
    let reloj;
    await Promise.race([anterior.catch(() => {}), new Promise(r => { reloj = setTimeout(r, ESPERA_FILA_MS); })]);
    clearTimeout(reloj);
    return fn();
  })();
  const yo = { comando, prom: esta };
  f.enCurso = yo;
  f.cola = esta.catch(() => {}).then(() => { if (f.enCurso === yo) f.enCurso = null; });
  return esta;
}

// Lo que no puede arreglar quien está delante del coche: clave, permisos,
// cuenta. Afecta a TODOS, así que se grita en el log.
const CODIGOS_DE_CONFIGURACION = new Set([1004, 1005, 1006, 1008, 1012, 1013, 1015]);

/**
 * La orden a Mapon: el equipo de la matrícula, el comando de su catálogo, y en
 * fila. Devuelve { status: 'ok' | 'error', motivo, msg, detalle }.
 */
async function porMapon({ matricula, unitId, comando }) {
  const mapon = require('./mapon');
  if (!mapon.configurado()) {
    return { status: 'error', motivo: 'configuracion', msg: 'El servidor no tiene la clave de Mapon (MAPON_API_KEY)', detalle: {} };
  }
  const u = await mapon.unidadPorMatricula(matricula, { actual: unitId || undefined });
  if (!u) return { status: 'error', motivo: 'sin-equipo', msg: `No encuentro el ${matricula} en Mapon`, detalle: { pedida: unitId || null } };
  const usada = String(u.unitId);
  const candidatos = [usada, ...(u.otros || []).map(String)];
  const detalle = { pedida: unitId ? String(unitId) : null, usada, otros: (u.otros || []).map(String) };
  // El equipo que llega del turno o de la sesión NO es de esta matrícula: no se
  // le manda nada a él (podría estar en otro coche). Se usa el de la matrícula.
  if (unitId && !candidatos.includes(String(unitId))) {
    detalle.pedidaAjena = true;
    console.warn(`⚠️ [PUERTAS] ${matricula}: llegó el equipo ${unitId}, que no es de esa matrícula; se usa el ${usada}`);
  }

  return enFila(usada, comando, async () => {
    console.log(`📡 [PUERTAS] ${comando} → ${matricula} (equipo ${usada})`);
    let r;
    try {
      r = await mapon.ejecutarComandoSeguro({ unitId: usada, command: comando });
    } catch (e) {
      // El equipo usado va en el registro también cuando falla: es justo cuando
      // hay que saber a qué equipo pudo llegar la orden.
      return { status: 'error', motivo: motivoDeError(e), msg: e.message,
        detalle: { ...detalle, codigo: e.codigo || null, intentos: e.intentos || undefined } };
    }
    if (!r.ok) {
      if (r.motivo === 'comando-no-disponible') {
        // Si otro equipo de la misma matrícula SÍ lo admite, no se le manda (no se
        // sabe dónde está montado): se apunta para que Tráfico lo mire.
        return { status: 'error', motivo: 'sin-comando',
          msg: `Este coche no admite «${comando}» en Mapon (admite: ${(r.disponibles || []).join(', ') || 'nada'})`,
          detalle: { ...detalle, disponibles: r.disponibles || [] } };
      }
      return { status: 'error', motivo: 'rechazada', msg: `Mapon contestó «${r.status || 'sin estado'}»`, detalle: { ...detalle, mapon: r.status || null } };
    }
    return { status: 'ok', motivo: null, msg: '', detalle: { ...detalle, mapon: r.status, intentos: r.intentos, simulado: r.simulado || undefined } };
  });
}

/**
 * Un error de Mapon (lanzado) → el motivo que se le enseña a quien espera.
 * «sin-respuesta» (no se sabe si llegó) SOLO si la orden ya iba en camino: un
 * plazo vencido leyendo el catálogo o el padrón es que la orden NO salió.
 */
function motivoDeError(e) {
  if (e && e.ordenEnVuelo) return 'sin-respuesta';
  if (e && e.sinRespuesta) return 'no-enviada';
  const c = e && e.codigo;
  if (c === 1010) return 'no-llega';
  if (c === 1011) return 'saturado';
  if (CODIGOS_DE_CONFIGURACION.has(c)) return 'configuracion';
  return 'error';
}

/**
 * Abre o cierra las puertas de un coche y lo apunta en el registro de puertas.
 * Devuelve { ok, motivo, msg, otraSede, sinMapon }. `ok` es que Mapon aceptó la
 * orden (ver arriba): quien llama dice «orden enviada».
 *
 * `sede` es la de los coches que puede tocar quien lo pide: la de Madrid si no
 * se dice; la suya, un conductor de Barcelona; y `null`, todas, que es la gente
 * de oficina con el permiso /puertas (Camilo, 02/10/2026).
 *
 * Se apunta SIEMPRE, salga bien o mal, y sin esperar a que termine: que el
 * registro falle no puede dejar a nadie sin abrir el coche.
 */
async function ejecutar({ telefono, conductorId = null, nombre = '', matricula, unitId = '', abrir, sede = SEDE_FLOTA }) {
  const comando = abrir ? 'open_doors' : 'close_doors';
  const t0 = Date.now();
  const apuntar = (ok, unidad, respuesta) => require('./repo/puertas').registrar({
    telefono, conductorId, conductor: nombre, matricula, unitId: unidad, comando, ok,
    respuesta: respuesta == null ? null : (typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta)).slice(0, 2000),
    ms: Date.now() - t0,
  });
  // CON MAPON CAÍDO NO SE MANDA NADA (05/10/2026): no llegaría. Se apunta igual,
  // y quien llama dice SIN_SERVICIO.
  if (!require('./fichaje').maponDisponible()) {
    apuntar(false, unitId, 'Mapon no está disponible: no se mandó la orden');
    return { ok: false, motivo: 'sin-mapon', msg: 'Mapon no está disponible', sinMapon: true, otraSede: null };
  }
  // UN COCHE DE OTRA SEDE QUE LA DE QUIEN LO PIDE NO SE ABRE NI SE CIERRA
  // (30/09/2026, ver otraSede.js): el 17 y el 18/09 tres conductores de Madrid
  // le abrieron las puertas al 1888LTJ, en Barcelona, escribiendo la matrícula
  // del ejemplo. Si no se puede saber la sede, tampoco se manda. Se apunta igual.
  // Un coche que no está en Vehículos cuenta como de Madrid.
  let result;
  if (sede) {
    try {
      const deCoche = (await otraSede.sedeDe({ matricula, unitId })) || SEDE_FLOTA;
      if (deCoche !== sede) result = { status: 'error', motivo: 'otra-sede', msg: `Coche de ${otraSede.nombreSede(deCoche)}: no se toca`, otraSede: deCoche };
    } catch (e) { result = { status: 'error', motivo: 'sede', msg: 'No se puede comprobar de qué sede es el coche' }; }
  }
  if (!result) {
    console.log(`${abrir ? '🔓 Abriendo' : '🔒 Cerrando'}: ${matricula} (${nombre || telefono})`);
    try {
      result = await porMapon({ matricula, unitId, comando });
    } catch (e) {
      result = { status: 'error', motivo: motivoDeError(e), msg: e.message, detalle: { codigo: e.codigo || null, intentos: e.intentos || undefined } };
    }
    if (result.motivo === 'configuracion') {
      console.error(`🚨 [PUERTAS] Mapon no deja mandar órdenes de puertas (${result.msg}): falla para TODOS. Revisa la clave MAPON_API_KEY y sus permisos.`);
    }
  }
  const ok = result.status === 'ok';
  const detalle = result.detalle || {};
  // Una pulsada que se unió a la misma orden en camino: no salió otra. Lleva el
  // resultado de esa orden (bien o mal) y, en el registro, «misma-orden-en-camino»
  // para no contarla como una orden más a Mapon.
  const resultado = result.repetida ? 'misma-orden-en-camino'
    : ok ? 'aceptada' : (result.motivo === 'sin-respuesta' ? 'desconocida' : 'no-enviada-o-rechazada');
  apuntar(ok, detalle.usada || unitId, {
    via: 'mapon', resultado, motivo: result.motivo || null, msg: result.msg || undefined,
    ...detalle, repetida: result.repetida || undefined,
  });
  return { ok, motivo: ok ? (result.repetida ? 'repetida' : null) : (result.motivo || 'error'), msg: ok ? '' : (result.msg || 'sin respuesta'),
    otraSede: result.otraSede || null, repetida: !!result.repetida };
}

// Lo que se le dice a quien quiere abrir o cerrar con Mapon caído (Camilo,
// 05/10/2026: «que por el momento no está disponible por temas de terceros
// ajenos a nosotros», y que con cada error se comunique con Tráfico).
const SIN_SERVICIO = '🔧 Por el momento no se pueden abrir ni cerrar las puertas desde aquí: hay un problema con un ' +
  'proveedor externo, ajeno a Telecab. Comunícate con Tráfico.';

/** La orden aceptada, dicha igual en todas partes: es una orden ENVIADA, no un coche abierto. */
const textoEnviada = abrir => `${abrir ? '🔓' : '🔒'} Orden de ${abrir ? 'abrir' : 'cerrar'} enviada. ` +
  'Si en unos segundos no responde, vuelve a pulsar una vez; si sigue igual, comunícate con Tráfico.';

/** El emoji del aviso: ⚠️ cuando no se sabe si llegó (no es un «no»), ❌ en lo demás. */
const emojiFallo = r => (r && r.motivo === 'sin-respuesta' ? '⚠️' : '❌');

/** Por qué no se ha podido, dicho para quien está delante del coche (sin emoji: lo pone quien llama). */
function textoFallo(r, abrir) {
  const que = abrir ? 'abrir' : 'cerrar';
  switch (r && r.motivo) {
    case 'sin-mapon':
    case 'configuracion': return SIN_SERVICIO.replace(/^🔧 /, '');
    case 'sin-comando': return `Este coche no se puede ${que} desde aquí. Comunícate con Tráfico.`;
    case 'sin-equipo': return `No encuentro el equipo de este coche para ${que}lo. Comunícate con Tráfico.`;
    case 'no-llega':
    case 'rechazada': return `El coche no ha recibido la orden de ${que} (puede estar sin cobertura). Vuelve a intentarlo en un momento; si sigue igual, comunícate con Tráfico.`;
    case 'sin-respuesta': return `Mapon no ha contestado y no sé si la orden de ${que} ha llegado. Espera unos segundos antes de volver a pulsar; si no responde, comunícate con Tráfico.`;
    case 'no-enviada': return `No he podido consultar Mapon y la orden de ${que} no ha salido. Inténtalo de nuevo en un momento; si sigue igual, comunícate con Tráfico.`;
    case 'saturado': return 'Ahora mismo hay muchas órdenes a la vez. Prueba otra vez en un minuto.';
    default: return `No he podido ${que} las puertas. Inténtalo de nuevo; si sigue igual, comunícate con Tráfico.`;
  }
}

module.exports = { ejecutar, SIN_SERVICIO, textoEnviada, textoFallo, emojiFallo, _filas: filas };
