// ============================================================
// PLANIFICACIÓN · SERVICIO — el cuadrante, y la puerta del módulo
// ============================================================
// Quién conduce qué coche, qué día y en qué turno. De aquí sale el plan contra
// el que Control compara la realidad, el parte que se manda a los conductores y
// la parrilla que se imprime.
//
// ── LAS CINCO COSAS QUE HAY QUE SABER ───────────────────────────────────────
//
// 1. LO QUE SE GUARDA VALE DESDE EL DÍA QUE SE ESTÁ MIRANDO, y lo que hubiera
//    antes se cierra la víspera. Así se puede poner a uno el 25 y a otro el 28
//    en la misma plaza sin borrar lo del 25. Ninguna escritura pisa el pasado.
//
// 2. TODA ESCRITURA DEVUELVE EL TABLERO RECALCULADO. No es comodidad: el front
//    lo sustituye entero, y así no se queda pintando algo que la base ya no
//    dice. Cuando cada botón se refrescaba solo, dos personas moviendo el mismo
//    cuadrante veían cosas distintas hasta recargar.
//
// 3. "EL COCHE YA LO LLEVA OTRO" NO ES UN ERROR: ES UNA PREGUNTA. Viaja con su
//    código y con la comprobación entera, para que la pantalla pueda ofrecer
//    planificar a la fuerza sin volver a consultar.
//
// 4. ESTE FICHERO ES LA PUERTA. Control, Selección y el bot leen el cuadrante;
//    ninguno entra a `planificador.repo`. Mientras otro módulo pueda meter la
//    mano en el repositorio, este no se puede cambiar por dentro — y poder
//    cambiarlo por dentro es lo único que se gana agrupando.
//
// 5. EL BARRIO NO ES LA LOCALIDAD. `barrio` es la zona de casa del conductor
//    ("Aluche", "San Blas") y es operativo: sirve para repartir cuadrantes.
//    `localidad` es el municipio de la gestoría. Se editan en sitios distintos
//    y no se tocan.

const plan = require('./planificador.repo');
const eventos = require('./eventos.repo');
const inc = require('../../services/repo/incorporaciones');
// Por la PUERTA de los otros módulos, no por su repositorio.
const veh = require('../Vehiculos/vehiculos.service');
const conductores = require('../Conductores/plantilla.service');
const { DIAS_CORTOS, LETRAS_DIA } = require('../../services/nucleo');

// ── La pantalla ────────────────────────────────────────────────────────────

/**
 * Lo que hace falta para pintar el tablero. El catálogo de estados de coche se
 * le pide al MÓDULO de Vehículos por su puerta; si falla, la pantalla sale
 * igual —sin la lista de estados— en vez de no salir.
 */
async function paraLaPantalla() {
  const estadosVehiculo = await veh.estadosVehiculo()
    .catch(e => { console.error('❌ [TABLERO] catálogo de estados:', e.message); return []; });
  return { diasSem: DIAS_CORTOS, letrasDia: LETRAS_DIA, estadosVehiculo };
}

// ── Leer ───────────────────────────────────────────────────────────────────

/**
 * El tablero de una semana. `dia` decide cuál; por omisión, hoy.
 *
 * MISMA FIRMA que el repositorio, `{ dia }`, y no `dia` a secas: Control,
 * Selección y los dos repositorios de aquí ya la llamaban así cuando entraban
 * por la puerta de atrás. Cambiarla al poner la puerta habría sido meter un
 * error de firma en cinco sitios a cambio de nada.
 */
const tablero = ({ dia } = {}) => plan.tablero({ dia });

/**
 * Devuelve lo que haya hecho la operación MÁS el tablero recalculado. Ver la
 * nota 2: es la forma de todas las escrituras de este módulo.
 */
const conTablero = async (r, dia) => ({ ...r, tablero: await plan.tablero({ dia }) });

// ── Guardar movimientos ────────────────────────────────────────────────────

async function guardar(cambios, dia, quien) {
  const r = await plan.guardar(cambios || [], { dia, ...quien });
  console.log(`💾 [TABLERO] ${r.hechos.length} movimiento(s) con fecha ${r.dia}`);
  return conTablero(r, dia);
}

/**
 * ¿SE PUEDE PONER A ESTA PERSONA AQUÍ ESTOS DÍAS? Contesta con los días que va a
 * trabajar en esa matrícula y, de cada uno, si choca con otro coche suyo
 * (imposible) o si el coche ya tiene conductor (se puede forzar apartándolo).
 * La pantalla lo pregunta ANTES de guardar.
 */
const comprobar = datos => plan.comprobarPlan(datos || {});

/** Deshacer un relevo: el del cuadrante vuelve a ser quien conduce ese día. */
const quitarRelevo = async (id, dia) => conTablero(await plan.quitarRelevo(id), dia);

/**
 * UN COCHE SE CAMBIA POR OTRO Y SUS CONDUCTORES SE VAN CON ÉL. Pasa a menudo
 * —el coche entra en el taller— y hacerlo plaza por plaza son doce movimientos:
 * basta equivocarse en uno para dejar a alguien sin coche.
 */
async function cambiarCoche({ de, a, dia, turno, forzar } = {}, quien) {
  const r = await plan.cambiarCoche({
    deVehiculoId: de, aVehiculoId: a, dia, soloTurno: turno, forzar: !!forzar,
  }, quien);
  console.log(`🔁 [TABLERO] ${r.movidos.length} conductor(es) del coche ${de} al ${a} desde ${r.dia}`);
  return conTablero(r, dia);
}

/**
 * Reemplazar la matrícula de un bloque por una de emergencia: la nueva hereda
 * cuadrante, días y tripulación. Para cuando un coche se va a taller o siniestro.
 */
async function reemplazarMatricula({ de, a, dia } = {}, quien) {
  const r = await plan.reemplazarMatricula(de, a, { dia, ...quien });
  console.log(`🔧 [TABLERO] matrícula ${de} → ${a} (bloque heredado, ${r.movidos} conductor(es)) desde ${r.dia}`);
  return conTablero(r, dia);
}

/** El descanso de un coche: escribe la libranza de sus dos fijos. */
async function fijarDescanso({ vehiculoId, dias, dia } = {}, quien) {
  const r = await plan.fijarDescanso(vehiculoId, dias, { dia, ...quien });
  console.log(`🛌 [TABLERO] descanso del coche ${vehiculoId} = [${(r.dias || []).join(' ')}] desde ${r.dia}`);
  return conTablero(r, dia);
}

/**
 * CUBRIR A QUIEN ESTÁ DE VACACIONES SIN QUITARLE LA PLAZA: el sustituto entra
 * mientras dura la ausencia y la plaza vuelve sola a su dueño el día que este
 * regresa. Sin fechas, se cogen las de la ausencia.
 */
async function cubrirAusencia(b, quien) {
  const r = await plan.cubrirAusencia({
    plazaId: b.plazaId, conductorId: b.conductorId,
    desde: b.desde || null,
    // `undefined` y `null` NO son lo mismo aquí: sin la clave se conserva el
    // "hasta" que hubiera; con null se borra (cobertura sin fecha de vuelta).
    hasta: b.hasta === undefined ? undefined : (b.hasta || null),
    dias: b.dias,
  }, { dia: b.dia, ...quien });
  console.log(`🛟 [TABLERO] plaza ${b.plazaId} cubierta por ${b.conductorId} ` +
    `del ${r.cubierta.desde} al ${r.cubierta.hasta || 'sin fecha'}` +
    (r.vuelve ? ` · vuelve su titular el ${r.vuelve.desde}` : ' · SIN vuelta programada'));
  return conTablero(r, b.dia);
}

/** La libranza excepcional: el swap de una semana (trabaja un día, libra otro). */
async function libranzaExcepcional(b, quien) {
  const r = await plan.crearLibranzaExcepcional({
    conductorId: b.conductorId, diaTrabaja: b.diaTrabaja, diaLibra: b.diaLibra, motivo: b.motivo,
  }, quien);
  console.log(`🔀 [TABLERO] libranza excepcional del conductor ${b.conductorId}: ` +
    `trabaja ${b.diaTrabaja}, libra ${b.diaLibra}`);
  return conTablero(r, b.dia);
}

const borrarLibranzaExcepcional = async (id, dia) =>
  conTablero(await plan.borrarLibranzaExcepcional(id), dia);

// ── Cuadrantes: el grupo de coches que comparte correturnos ────────────────

const cuadrantes = async () => ({ cuadrantes: await plan.listarCuadrantes() });

async function crearCuadrante(zonaId, quien) {
  const r = await plan.crearCuadrante({ zonaId }, quien);
  console.log(`🧩 [TABLERO] Cuadrante ${r.numero} creado`);
  return { ...r, cuadrantes: await plan.listarCuadrantes() };
}

const borrarCuadrante = async (id, dia) => conTablero(await plan.borrarCuadrante(id), dia);

/** Añadir un bloque (matrícula + días de libranza) a un cuadrante. */
const anadirBloque = async ({ cuadranteId, vehiculoId, dias, dia } = {}, quien) =>
  conTablero(await plan.anadirBloque({ cuadranteId, vehiculoId, dias }, { dia, ...quien }), dia);

/** Meter —o sacar, con `cuadranteId` vacío— un coche de un cuadrante. */
const meterCoche = async ({ vehiculoId, cuadranteId, dia } = {}) =>
  conTablero(await plan.meterCoche(vehiculoId, cuadranteId || null), dia);

/** Asignar (o quitar) el CT de un cuadrante: se reparte entre sus coches. */
async function asignarCT(b, quien) {
  const r = await plan.asignarCTcuadrante({
    cuadranteId: b.cuadranteId, turno: b.turno, conductorId: b.conductorId, vehiculos: b.vehiculos,
  }, { dia: b.dia, ...quien });
  console.log(`🔗 [TABLERO] CT ${b.turno} del cuadrante ${b.cuadranteId} en ${r.coches} coche(s)`);
  return conTablero(r, b.dia);
}

// ── Modo eventos: abrir las plazas de refuerzo unos días ───────────────────
// La F1, una marcha, un concierto: días en los que hay que sacar más coches.
// Abre CT2 de día y de noche con fecha de caducidad, y se cierra solo cuando
// termina el último turno planificado en ellas (los de noche, a las 05:00 del
// día siguiente) — no el día que dice el papel.

const eventoEstado = dia => eventos.estado({ dia });

const crearEvento = async (b, quien) => conTablero(await eventos.crear(b, quien), b.desde);
const editarEvento = async (id, b) => conTablero(await eventos.editar(id, b), b.dia || b.desde);
const cancelarEvento = async (id, b, quien) =>
  conTablero(await eventos.cancelar(id, { ...quien, nota: b.nota }), b.dia);

/**
 * Devolver el cuadrante a la normalidad A MANO. El repaso de las 05:10 lo hace
 * solo, pero a veces hace falta ya.
 */
const restaurarEvento = async (id, b, quien) => conTablero(
  await eventos.restaurar(id, { ...quien, nota: b.nota || 'A mano desde el planificador' }), b.dia);

/**
 * El mensaje que recibiría un conductor por WhatsApp durante el evento. Existe
 * para poder LEERLO antes de mandarlo: es el que explica la vuelta a la
 * normalidad, y ese no se puede mandar mal.
 */
const mensajeDeEvento = telefono => require('./turnos.service').mensajeSiHayEvento({ phone: telefono });

// ── Incorporaciones ────────────────────────────────────────────────────────
// La alerta que no se va hasta aceptarla o rechazarla. Nace al dar de alta con
// vacante (ETT). Aceptar = auto-colocar en las plazas de la vacante, todo o
// nada; rechazar = queda en el banquillo y la vacante vuelve a Abierta.

const incorporaciones = async () => ({ incorporaciones: await inc.pendientes() });

/**
 * ACEPTAR: colocar al conductor en las plazas PROMETIDAS.
 *
 * TODO O NADA: `plan.guardar` va en una transacción, así que si una plaza ya no
 * existe no se escribe ninguna. Por eso la alerta se marca aceptada DESPUÉS de
 * colocar y no antes: si la colocación falla, sigue pendiente y se reintenta.
 *
 * El encargo —qué plazas, desde qué día— lo prepara `repo/incorporaciones`, que
 * es quien guarda la foto de la vacante. Colocar es escribir en el cuadrante, y
 * eso es de aquí: mientras lo hacía aquel, un repositorio compartido por
 * Selección y la ETT tenía dentro el repositorio del planificador.
 */
async function aceptarIncorporacion(id, dia, quien) {
  const encargo = await inc.encargoDeColocar(id, { desde: dia });
  const r = await plan.guardar([{ slots: encargo.slots }],
    { dia: encargo.dia, usuarioId: quien.usuarioId });
  await inc.marcarAceptada(encargo.id, { ...quien, vacanteId: encargo.vacanteId });

  // Quién se quedó sin plaza al colocarlo: en un recambio, el que se va. Se
  // devuelve para poder decirlo en pantalla en vez de que se descubra solo.
  const relevados = r.hechos.filter(h => h.que === 'coloca' && h.cerrada).length;
  console.log(`✅ [TABLERO] Incorporación ${id} aceptada (${encargo.slots.length} plaza(s)` +
    (relevados ? `, ${relevados} relevado(s)` : '') + ')');
  return conTablero(
    { ok: true, plazas: encargo.slots.length, desde: encargo.dia, relevados, hechos: r.hechos },
    dia || encargo.dia);
}

/**
 * RECHAZAR: el conductor queda en el banquillo para colocarlo a mano y la
 * vacante vuelve a estar ABIERTA (a esa vacante nunca llegó a entrar nadie).
 */
async function rechazarIncorporacion(id, motivo, quien) {
  const r = await inc.rechazar(id, { ...quien, motivo });
  console.log(`🚫 [TABLERO] Incorporación ${id} rechazada`);
  return r;
}

// ── El barrio del conductor ────────────────────────────────────────────────

/**
 * Editable desde la carta del cuadrante y el banquillo. Escribe `barrio`, NUNCA
 * `localidad` (ver la nota 5). Va por la puerta de Conductores.
 */
async function guardarBarrio(conductorId, barrio, quien) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');
  const limpio = String(barrio || '').trim().slice(0, 60);
  await conductores.actualizar(id, { barrio }, quien);
  console.log(`📍 [TABLERO] barrio del conductor ${id} = "${limpio}"`);
  return { barrio: limpio };
}

// ── LA PUERTA para los demás módulos ───────────────────────────────────────
// Solo lectura, y solo lo que de verdad piden: Control (el cockpit, el reporte
// 5-5, el Excel de turnos y la parrilla), Selección (el generador de vacantes) y
// el bot. Si alguno necesita algo más, se añade aquí y se ve en el commit.

/** Teléfono y localidad de cada conductor del cuadrante. */
const contactos = () => plan.contactos();

/** Quién sale hoy, agrupado. `GRUPOS_SALIDA` dice qué significa cada grupo. */
const salidasHoy = (...a) => plan.salidasHoy(...a);
const GRUPOS_SALIDA = plan.GRUPOS_SALIDA;

/** Las salidas de los próximos días, coche a coche. Para el Excel de turnos. */
const salidasPorCoche = (...a) => plan.salidasPorCoche(...a);

/** El lunes de la semana en la que cae ese día. */
const lunesDe = (...a) => plan.lunesDe(...a);

/**
 * Soltar y reponer una plaza. Las usa `eventos.repo` al abrir y cerrar un
 * evento; son escrituras del cuadrante, no lecturas, y por eso van con nombre
 * propio en vez de dejar el repositorio abierto.
 */
const liberarPlaza = (...a) => plan.liberarPlaza(...a);
const reponer = (...a) => plan.reponer(...a);

/**
 * EL REPASO DE LAS 05:10: cerrar los eventos que ya terminaron y reconciliar el
 * cuadrante contra la foto de antes, por si algo quedó torcido. Va justo
 * después de que muera el último turno de noche y antes de que nadie mire el
 * tablero.
 */
const repasarEventos = () => eventos.repasar();

/** La parrilla en Excel (formato ANEXO), desde el cuadrante real. */
const parrilla = async dia => {
  const t = await plan.tablero({ dia });
  return Buffer.from(await require('./parrilla.excel').exportar(t));
};

module.exports = {
  paraLaPantalla, tablero,
  guardar, comprobar, quitarRelevo, cambiarCoche, reemplazarMatricula,
  fijarDescanso, cubrirAusencia, libranzaExcepcional, borrarLibranzaExcepcional,
  cuadrantes, crearCuadrante, borrarCuadrante, anadirBloque, meterCoche, asignarCT,
  eventoEstado, crearEvento, editarEvento, cancelarEvento, restaurarEvento, mensajeDeEvento,
  incorporaciones, aceptarIncorporacion, rechazarIncorporacion,
  guardarBarrio,
  // La puerta
  contactos, salidasHoy, salidasPorCoche, lunesDe, parrilla, GRUPOS_SALIDA,

  liberarPlaza, reponer, repasarEventos,
};
