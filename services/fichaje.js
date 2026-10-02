/**
 * FICHAJE DE TURNO por WhatsApp — "Iniciar turno" / "Terminar turno".
 *
 * Para qué: BOLT solo sabe quién conduce mientras su app está ABIERTA. En cuanto el
 * conductor se pone inactive dejan de existir logs, y justo ahí está el km que
 * persigue la auditoría (/operaciones/auditoria). Con el fichaje sabemos QUIÉN tenía
 * el coche en cada momento, aunque BOLT esté cerrado: la auditoría puede pasar de
 * señalar matrículas a señalar personas.
 *
 * Cómo:
 *   · El turno se apunta en un libro (fichaje_turno, db/125) con conductor, matrícula y horas.
 *     Esa es la prueba: la atribución se hace por VENTANA TEMPORAL, igual que ya se
 *     hace con los timestamps de BOLT, sin depender de cómo trate Mapon el histórico.
 *   · Además, al abrir turno se ASIGNA el conductor a la unidad en Mapon (y al cerrar
 *     se le quita), para que en su plataforma se vea el nombre en vivo. Al terminar se
 *     comprueba si Mapon atribuyó los trayectos (route/list include=driver_id): así
 *     sabremos de verdad si ese enlace queda SELLADO en el histórico o no.
 *
 * QUIÉN (desde el 28/09/2026): TODO CONDUCTOR DE ALTA abre su turno al escribir la
 * matrícula en el bot —es la puerta de entrada al coche—. Lo que se sigue encendiendo
 * persona a persona (el botón «Fichaje» del planificador, `conductor.ficha_coche`) es
 * el BLOQUEO DE MOTOR al terminar: un coche solo se corta si todos los que lo llevan
 * lo tienen encendido. La gente de la empresa hace VIAJES (coge un coche para algo y
 * lo devuelve) y esos siguen encendiéndose uno a uno en /usuarios.
 *
 * BARCELONA (02/10/2026): sus conductores no tienen ficha; el bot los reconoce
 * por su cuenta activa de BOLT de la empresa de Barcelona (`participa`) y abren
 * turno en coches de Barcelona, nunca en uno de Madrid (ni al revés). Su motor
 * no se toca: ni se suelta al empezar ni se corta al terminar. Ver
 * docs/nucleo/Sedes.md.
 *
 * QUIÉN BLOQUEA (30/09/2026): SOLO EL CONDUCTOR, AL TERMINAR. Camilo: «no quiero
 * ningún repaso; los únicos que bloquearán son los conductores cuando inicien
 * turnos y terminen; el sistema no bloquea nada sino que suelta». Se quitó el
 * repaso (un cron que cortaba cada diez minutos todo coche parado de los que
 * habían pasado alguna vez por el libro: así se quedó cortado días el 1888LTJ,
 * de Barcelona) y el corte del cierre automático. El ciclo de cada coche —se
 * bloquea al terminar, se suelta al empezar— se ve y se suelta a mano en el
 * módulo «Ciclo de bloqueo de motor» (modules/BloqueoMotor).
 *
 * OJO CON LAS PALABRAS (28/09/2026): al conductor NO se le habla de «fichar» ni de
 * «fichaje». Esto no es el registro de jornada —ese es /fichaje— sino quién tiene
 * qué coche y cuántos km hace; llamarlo igual invitaría a tomarlo por lo otro.
 */

const mapon = require('./mapon');
const repo = require('./repo/fichajeTurno');
// La sede de cada coche: el turno, solo en uno de la sede de la persona; y el
// motor de otra sede (Barcelona) no se corta nunca.
const otraSede = require('./otraSede');
const { SEDE_FLOTA } = require('./nucleo');

// Si alguien olvida cerrar, el turno se cierra solo pasadas estas horas: así no queda
// un coche asignado indefinidamente en Mapon ni un turno abierto eterno en el libro.
const MAX_HORAS_TURNO = Number(process.env.FICHAJE_MAX_HORAS || 14);

// ── Corte de motor ───────────────────────────────────────────────────────────
// Los vehículos llevan relé `engine_block` ("Bloqueo Motor", relay_id 1). Verificado en
// el coche real: con el coche en servicio normal el relé está en 0, así que 0 = motor
// LIBRE y 1 = motor BLOQUEADO (inverted=0). Se dejan en variables por si alguna
// instalación viniera invertida.
const RELE_LIBRE = Number(process.env.FICHAJE_RELE_LIBRE ?? 0);
const RELE_BLOQUEADO = Number(process.env.FICHAJE_RELE_BLOQUEADO ?? 1);

// APAGADO por defecto: inmovilizar un coche es irreversible desde el móvil del
// conductor, así que no se activa solo por desplegar. Se enciende con
// FICHAJE_BLOQUEO_MOTOR=1 cuando se quiera probar de verdad.
const BLOQUEO_ACTIVO = process.env.FICHAJE_BLOQUEO_MOTOR === '1';

// Minutos que un coche tiene que llevar parado para que se le pueda inmovilizar
// SIN que nadie haya pulsado "Terminar turno".
const MIN_PARADO = Number(process.env.FICHAJE_MIN_PARADO || 20);
// Con datos más viejos que esto no se decide nada: no se sabe dónde está.
const MAX_SIN_SENAL = Number(process.env.FICHAJE_MAX_SIN_SENAL || 15);

/**
 * ¿Se puede inmovilizar este coche ahora mismo?
 *
 * ESTA ES LA FUNCIÓN DELICADA DEL MÓDULO. Cortar el motor de un coche que está
 * trabajando deja a un conductor tirado, y puede que con un cliente dentro. Así
 * que la regla es al revés de lo normal: ante la duda, NO.
 *
 * "Velocidad 0" no vale como prueba de que nadie lo usa. Un taxi parado
 * recogiendo a alguien, en un semáforo o esperando en la parada del aeropuerto
 * va a 0 km/h. Lo que sí vale es que lleve un buen rato quieto y sin contacto.
 *
 * `porOrden` es cuando lo pide una persona —pulsó "Terminar turno"—: ahí sí ha
 * dicho que ha acabado, y solo se comprueba que no esté rodando.
 */
function puedeInmovilizar(info, { porOrden = false } = {}) {
  if (!info) return 'no se puede leer el estado del coche';
  if (info.enMarcha || info.velocidad > 0) return `coche en marcha (${info.velocidad} km/h)`;

  // EL CONTACTO PUESTO PARA A TODO EL MUNDO, también a quien lo pide.
  //
  // Cortar con el coche encendido no lo apaga: lo deja a medias. En el Corolla
  // se comprobó el 16/09/2026 — arranca, anda… y ya no se puede apagar, porque
  // el corte está metido en la línea que el coche necesita para completar el
  // apagado. El conductor se queda con un coche encendido que no responde.
  //
  // Antes esto no frenaba nada por dos motivos a la vez: `porOrden` se saltaba
  // la comprobación, y además `ignicion` se leía siempre como false (ver
  // `contactoPuesto` en mapon.js). Los dos están arreglados.
  if (info.ignicion === true) return 'el coche está encendido';
  if (porOrden) return null;

  if (info.segSinSenal != null && info.segSinSenal > MAX_SIN_SENAL * 60) {
    return `sin señal desde hace ${Math.round(info.segSinSenal / 60)} min`;
  }
  // null = Mapon no lo dice. No es una autorización.
  if (info.segParado == null) return 'no se sabe cuánto lleva parado';
  if (info.segParado < MIN_PARADO * 60) {
    return `solo lleva ${Math.round(info.segParado / 60)} min parado (hacen falta ${MIN_PARADO})`;
  }
  return null;
}

/**
 * Pone el motor libre o bloqueado y CONFIRMA el estado real (change_relay solo dice que
 * la orden salió). Devuelve { hecho, motivo } — `hecho:false` con su motivo si no se pudo.
 *
 * Liberar es seguro y se hace siempre que se pueda. Bloquear pasa por
 * `puedeInmovilizar`, salvo que lo haya pedido el conductor.
 */
async function motor(unitId, bloquear, { porOrden = false } = {}) {
  // El interruptor apaga el BLOQUEO, no el desbloqueo. Si no, apagar la función
  // dejaría encerrados para siempre a los coches que ya estuvieran cortados, y el
  // interruptor de seguridad sería justo lo que impide arreglarlo.
  if (bloquear && !BLOQUEO_ACTIVO) return { hecho: false, motivo: 'desactivado' };
  // UN COCHE DE OTRA SEDE NO SE CORTA NUNCA (30/09/2026, ver otraSede.js). Va
  // aquí, por donde sale TODA orden de corte: da igual quién la pida. Si no se
  // puede saber la sede, tampoco: ante la duda, no.
  //
  // Y DESDE EL 02/10/2026 TAMPOCO SE SUELTA: con los conductores de Barcelona en
  // el bot, uno de allí puede pulsar «Desbloquear» en su coche. Su motor se lleva
  // desde Mapon, y si está cortado es que Barcelona lo ha querido. Soltar sin
  // saber la sede sí: soltar no deja tirado a nadie, y negarse sí.
  let sedes = null;
  try { sedes = await otraSede.cochesDeOtraSede(); }
  catch (e) {
    if (bloquear) return { hecho: false, motivo: 'no se puede comprobar de qué sede es el coche', reintentable: true };
  }
  const ajenaUnit = otraSede.sedeAjenaEn(sedes, { unitId });
  if (ajenaUnit) return { hecho: false, motivo: `coche de ${otraSede.nombreSede(ajenaUnit)}: no se toca`, otraSede: ajenaUnit };
  try {
    const info = await mapon.relesDeUnidad(unitId);
    // Y por su matrícula, que es lo que está seguro en Vehículos aunque el
    // equipo de Mapon cambie.
    const ajena = info && otraSede.sedeAjenaEn(sedes, { matricula: info.matricula });
    if (ajena) return { hecho: false, motivo: `coche de ${otraSede.nombreSede(ajena)}: no se toca`, otraSede: ajena };
    const rele = mapon.releDeCorte(info);
    if (!rele || !rele.habilitado) return { hecho: false, motivo: 'sin relé de corte' };
    // CON EL COCHE EN MARCHA NO SE CORTA. Pero SOLTAR sí se intenta siempre.
    //
    // Antes esta regla valía para las dos cosas, y eso cerraba una trampa: el
    // 5646MDM (16/09/2026) se quedó parado con el corte puesto y, como Mapon lo
    // daba por "Conduciendo" a 0 km/h, no había forma de soltarlo —y sin soltarlo
    // no se podía apagar, y sin apagarlo no dejaba de estar "conduciendo"—. Para
    // salir hubo que mandar la orden a mano, saltando esta comprobación.
    //
    // Soltar no deja tirado a nadie nunca; negarse a soltar, sí. Si el equipo lo
    // rechaza de verdad (control_while_moving=0), lo dirá Mapon y se verá en el
    // motivo — pero la decisión es suya, no nuestra.
    //
    // `reintentable`: el conductor puede volver a pulsar cuando pare. Sin esta
    // marca el mensaje se quedaba en "no se ha bloqueado" a secas, y quien lo
    // leía no sabía si tenía que hacer algo o no. (Hasta el 30/09/2026 lo
    // recogía además el repaso; ya no existe: lo que no se bloquea lo ve
    // Tráfico en el ciclo de bloqueo de motor.)
    if (bloquear && info.enMarcha) {
      return { hecho: false, motivo: `coche en marcha (${info.velocidad} km/h)`, reintentable: true };
    }
    // YA ESTÁ COMO SE QUIERE: no se manda nada.
    //
    // No es solo ahorrarse una llamada. `cambiarReleConfirmado` espera hasta
    // diez segundos a que el coche confirme, y eso son diez segundos de silencio
    // en una conversación de WhatsApp — el conductor pulsa "Iniciar turno" y no
    // pasa nada. Al principio casi ningún coche estará bloqueado, así que este
    // es el caso NORMAL, no la excepción.
    const objetivo = bloquear ? RELE_BLOQUEADO : RELE_LIBRE;
    if (Number(rele.estado) === objetivo) {
      return { hecho: true, motivo: '', yaEstaba: true };
    }
    if (bloquear) {
      const no = puedeInmovilizar(info, { porOrden });
      if (no) return { hecho: false, motivo: no, reintentable: true };
    }
    const r = await mapon.cambiarReleConfirmado({
      unitId, relayId: rele.relay_id, estado: bloquear ? RELE_BLOQUEADO : RELE_LIBRE
    });
    if (r.confirmado) return { hecho: true, motivo: '' };
    return { hecho: false, motivo: 'la orden salió pero el coche no la confirmó (¿sin cobertura?)', reintentable: true };
  } catch (e) {
    console.error('⚠️ [FICHAJE] motor:', e.message);
    return { hecho: false, motivo: e.message, reintentable: true };
  }
}
const liberarMotor = unitId => motor(unitId, false);

/**
 * Como esta el motor de un coche, sin tocarlo.
 *
 * Hace falta para poder decirselo al conductor cuando pregunta, y para el boton
 * de reintentar: si el desbloqueo fallo por cobertura, tiene que poder verlo y
 * volver a intentarlo sin cerrar y reabrir el turno.
 */
async function estadoMotor(unitId) {
  try {
    const info = await mapon.relesDeUnidad(unitId);
    const rele = mapon.releDeCorte(info);
    if (!rele) return { sabemos: false, motivo: 'sin rele de corte' };
    return {
      sabemos: true,
      bloqueado: Number(rele.estado) === RELE_BLOQUEADO,
      enMarcha: info.enMarcha,
      velocidad: info.velocidad,
      estado: info.estado,
      ignicion: info.ignicion,
      ignicionSeg: info.ignicionSeg,
    };
  } catch (e) {
    return { sabemos: false, motivo: e.message };
  }
}
// Con orden: lo ha pedido el conductor al terminar su turno.
const bloquearMotor = (unitId, opciones) => motor(unitId, true, opciones);

const ZONA = 'Europe/Madrid';
const ahoraSeg = () => Math.floor(Date.now() / 1000);
function tel9(t) { const d = String(t == null ? '' : t).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; }
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// HASTA DÓNDE LLEGA EL CORTE DE MOTOR.
//
// Para el turno basta con quién tiene el fichaje encendido: solo esa persona
// abre y cierra, y solo se toca el coche que ella diga.
//
// (Hasta el 30/09/2026 aquí mandaba el REPASO, un cron que cortaba la flota; se
// quitó. Lo que sigue queda para «liberar todos», la herramienta de deshacer
// del diagnóstico, que solo suelta.) Los límites eran:
//
//   · El LIBRO: solo toca coches que han pasado por el fichaje, y al fichaje
//     solo llega quien lo tiene encendido.
//   · El CUADRANTE (24/09/2026): nunca el coche que lleva hoy o mañana alguien
//     que todavía no ficha (`cochesConQuienNoFicha`). El fichaje se enciende
//     persona a persona y un coche lo comparten dos.
//   · La SEDE (30/09/2026): nunca un coche de otra sede, pase lo que pase en
//     el libro (`otraSede.js`). El cuadrante no protegía a los de Barcelona,
//     que no salen en él: justo por eso quedaban al descubierto.
//
// FICHAJE_MATRICULAS queda para el día que esto sea de todos:
//   vacío             = solo los coches que han pasado por el fichaje
//   '1204MJY,0417MMZ' = además, esos (nunca uno de otra sede: ver arriba)
//   '*'               = toda la flota
//
// El '*' se mira ANTES de normalizar: `normMat` quita todo lo que no sea letra o
// número, así que un asterisco normalizado es una cadena vacía y desaparecía.
const _MAT_CRUDAS = String(process.env.FICHAJE_MATRICULAS || '')
  .split(',').map(x => x.trim()).filter(Boolean);
const TODA_LA_FLOTA = _MAT_CRUDAS.includes('*');
const MATRICULAS = _MAT_CRUDAS.map(x => normMat(x)).filter(Boolean);

const horaES = seg => new Intl.DateTimeFormat('es-ES', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date(seg * 1000));
function duracion(seg) {
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

// ── Quién ficha ─────────────────────────────────────────────────────────────
//
// Se pregunta en CADA mensaje que llega al bot —el fichaje mira primero si es
// cosa suya—, así que la respuesta se guarda unos segundos. Al encender o apagar
// a alguien desde el ERP se olvida al momento: si no, tardaría en enterarse y
// parecería que el interruptor no hace nada.
const CACHE_MS = 20 * 1000;
const _cache = new Map();   // tel9 -> { hasta, valor }
const olvidar = telefono => (telefono ? _cache.delete(tel9(telefono)) : _cache.clear());

/**
 * ¿PARTICIPA este teléfono en el fichaje? Devuelve null si no, o
 * `{ tipo: 'turno'|'viaje', nombre, conductorId, usuarioId }`.
 *
 * EL ORDEN LO DIO CAMILO (24/09/2026): primero se mira si el número es de un
 * USUARIO del sistema; si no, si es de un CONDUCTOR DE ALTA con cualquiera de
 * sus números vigentes. De baja en la empresa no ficha.
 *
 *   · Usuario activo con el fichaje encendido → hace viajes.
 *   · Si no, conductor DE ALTA → hace turnos. Desde el 28/09/2026 todos: el
 *     interruptor del planificador ya solo dice si su coche se BLOQUEA al
 *     terminar (`motor`).
 *   · Si no, una CUENTA ACTIVA DE BOLT DE OTRA SEDE (Barcelona, 02/10/2026) →
 *     hace turnos, sin ficha: con el nombre de BOLT, sin cuadrante y sin que se
 *     le toque nunca el motor (`motor: false`).
 *   · Si no, pero tiene un turno o un viaje SIN CERRAR, participa igual: a quien
 *     causa baja a mitad de turno hay que dejarle terminarlo. Si no, el coche
 *     se quedaría asignado y el turno abierto hasta el cierre solo.
 *
 * `pila` es su nombre de pila, para saludarle: «Hola, David». `sede` es la de
 * los coches que puede llevar: la de Madrid para todos menos los de Barcelona.
 *
 * Si la base falla se contesta null: el mensaje sigue al bot de puertas, que es
 * lo que pasaba antes de que esto existiera.
 */
async function participa(telefono) {
  const t9 = tel9(telefono);
  if (t9.length < 9) return null;
  const c = _cache.get(t9);
  if (c && c.hasta > Date.now()) return c.valor;
  let valor = null;
  try {
    const p = await repo.personaPorTelefono(t9);
    const con = p.conductor, usu = p.usuario;
    // Solo si el número no es de nadie de aquí: es una consulta más por mensaje.
    // Y si falla, se sigue sin ella: no puede impedir que alguien de aquí cierre
    // lo que tiene abierto.
    const otra = (usu && usu.activo && usu.vale) || (con && con.vale) ? null
      : await repo.cuentaDeOtraSede(t9).catch(e => {
        console.error('⚠️ [FICHAJE] no se pudo mirar si es una cuenta de otra sede:', e.message);
        return null;
      });
    if (usu && usu.activo && usu.vale) {
      valor = { tipo: 'viaje', nombre: usu.nombre, pila: usu.pila, conductorId: null, usuarioId: usu.id, motor: true,
        sede: SEDE_FLOTA };
    } else if (con && con.vale) {
      valor = { tipo: 'turno', nombre: con.nombre, pila: con.pila, conductorId: con.id, usuarioId: null, motor: con.activo,
        sede: SEDE_FLOTA };
    } else if (otra) {
      valor = { tipo: 'turno', nombre: otra.nombre, pila: otra.pila, conductorId: null, usuarioId: null, motor: false,
        sede: otra.sede, cuentaBolt: otra.id };
    } else if (p.abierto) {
      // Con algo abierto: el tipo lo dice lo que tenga abierto.
      const t = await repo.abiertoDe(t9);
      if (t) {
        const quien = con || usu || {};
        valor = { tipo: t.tipo, nombre: t.nombre || quien.nombre || '', pila: quien.pila || '',
          conductorId: t.conductorId, usuarioId: t.usuarioId, soloCerrar: true, motor: !!quien.activo };
      }
    }
  } catch (e) {
    console.error('⚠️ [FICHAJE] no se pudo saber si participa:', e.message);
    return null;   // sin cachear: que el siguiente mensaje lo vuelva a intentar
  }
  _cache.set(t9, { hasta: Date.now() + CACHE_MS, valor });
  return valor;
}

/** Sin acentos, sin dobles espacios y en minúsculas: para comparar nombres. */
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * QUIÉN ESTÁ FICHANDO, con su nombre de verdad.
 *
 * El nombre no es un adorno de la conversación: es el que se crea y se asigna
 * en MAPON, así que es el que Tráfico va a ver sobre el coche en el mapa y el
 * que queda en el histórico de la plataforma. Que ahí pusiera "Claude code" —el
 * nombre que traía la lista de pruebas— era justo lo que había que quitar.
 *
 * El orden dice quién manda:
 *   1 · su FICHA de conductor, si conduce para nosotros. Además ata el turno a
 *       su id, que es lo que permite a la auditoría señalar personas y no
 *       matrículas.
 *   2 · su USUARIO del sistema: la gente de la empresa que coge un coche.
 *
 * Los dos salen de `participa`: quien no tiene el fichaje encendido no tiene
 * nombre aquí, y por tanto no abre turno.
 *
 * Si ninguna sabe su nombre se devuelve vacío y el turno NO se abre: fichar sin
 * nombre dejaría un coche asignado a nadie en Mapon, que es peor que no fichar.
 */
async function quienFicha(telefono) {
  const p = await participa(telefono);
  if (!p || !p.nombre) return { nombre: '', conductorId: null, usuarioId: null, origen: 'desconocido' };
  return { nombre: p.nombre, conductorId: p.conductorId || null, usuarioId: p.usuarioId || null,
    origen: p.cuentaBolt ? `cuenta de BOLT de ${otraSede.nombreSede(p.sede)}` : p.tipo === 'turno' ? 'conductor' : 'usuario',
    tipo: p.tipo };
}

/** Con quién se habla en el WhatsApp. El mismo nombre que verá Mapon. */
const nombreParaSaludar = async telefono => (await quienFicha(telefono)).nombre || '';

/**
 * La referencia del turno: la que sale en los mensajes y en el panel.
 *
 * Lleva MILÉSIMAS y no segundos, y no es un detalle: terminar un turno y abrir
 * otro dentro del mismo segundo daba dos veces la misma referencia, la base la
 * rechazaba por repetida —es UNIQUE— y el conductor recibía un "ya tienes un
 * turno abierto" cuando acababa de cerrarlo. Un doble toque en el botón bastaba.
 */
const referencia = telefono => `${tel9(telefono)}-${Date.now()}`;

// ── Libro de turnos ───────────────────────────────────────────────────────────

// ── El libro ────────────────────────────────────────────────────────────────
// Era una pestaña; desde el 15/09/2026 es una tabla (db/125). Lo que se gana no
// es velocidad —aunque leer el libro entero para saber si alguien tiene turno
// abierto tampoco era gratis—: es que UN TURNO ABIERTO POR PERSONA Y POR COCHE
// lo garantizan dos índices únicos.
//
// En la hoja no había forma de impedirlo. Dos personas abriendo turno sobre el
// mismo coche a la vez escribían dos filas y las dos se creían dueñas —que es
// justo lo que este libro tiene que poder contestar sin dudas—.

/** Turno abierto de un teléfono (o null). */
const abiertoDe = telefono => repo.abiertoDe(telefono);
/** Turno abierto sobre una matrícula por OTRA persona (o null). */
const abiertoDeCoche = (matricula, telefono) => repo.abiertoDeCoche(matricula, telefono);
// ── Conductor en Mapon ────────────────────────────────────────────────────────

/**
 * Devuelve el driver_id de Mapon para el NOMBRE que le pasamos, creándolo si no
 * existe. La identidad la manda NUESTRO nombre, no lo que haya en Mapon:
 *
 *   · La mayoría de conductores NO están dados de alta en Mapon, así que hay que
 *     poder crearlos sobre la marcha con el nombre que decidamos.
 *   · Antes se buscaba primero por TELÉFONO, y eso reutilizaba a un conductor real ya
 *     existente (aparecía su nombre completo en vez del que queríamos) y además le
 *     movía el coche que tuviera puesto. Ya no: se casa por nombre exacto.
 */
async function conductorMapon(nombre, telefono, { crear = true } = {}) {
  const nom = String(nombre || '').trim();
  if (!nom) return null;
  const t9 = tel9(telefono);
  const listar = async () => {
    try { return await mapon.listarConductores(); }
    catch (e) { console.error('⚠️ [FICHAJE] driver/list:', e.message); return []; }
  };
  let lista = await listar();
  const idDe = d => d.id || d.driver_id;

  // 1 · POR TELÉFONO, que es lo único que no se escribe de dos maneras. Buscar
  // solo por nombre creaba un conductor nuevo cada vez que alguien tenía un
  // acento de más o el apellido en otro orden, y en Mapon se acumulaban
  // "Camilo Bedoya" y "Camilo Bedoya Corrales" como si fueran dos personas.
  //
  // Y se mira en TODOS los campos del conductor, no en una lista de nombres que
  // nos hayamos imaginado ('phone', 'mobile'...). Mapon no documenta cómo se
  // llama ese campo ni si viene, y darlo por hecho dejó al fichaje sin enlace:
  // no encontrábamos a nadie, creyéndolo nuevo lo creábamos, y Mapon contestaba
  // 1002 "The phone has already been taken" — el turno se abría pero el coche se
  // quedaba sin nombre en el mapa, que es justo lo que este módulo existe para
  // poner. Solo se comparan valores con pinta de teléfono, para que un id largo
  // o una fecha no pasen por uno.
  const PINTA_DE_TEL = /^[\d\s+()-]{9,20}$/;
  const tieneElTelefono = d => !!t9 && Object.values(d || {}).some(v => {
    const txt = String(v == null ? '' : v);
    return PINTA_DE_TEL.test(txt) && tel9(txt) === t9;
  });
  if (t9) {
    const porTel = lista.find(tieneElTelefono);
    if (porTel) return idDe(porTel);
  }

  // 2 · Por nombre, ya sin acentos ni mayúsculas.
  const clave = norm(nom);
  const mismoNombre = d => norm(`${d.name || ''} ${d.surname || ''}`) === clave;
  const porNombre = lista.find(mismoNombre);
  if (porNombre) return idDe(porNombre);

  // 3 · No está. Con `crear:false` se dice que no está y ya: así el diagnóstico
  // puede preguntar "¿a quién resolvería este teléfono?" sin dar de alta a nadie.
  if (!crear) return null;
  const partes = nom.split(/\s+/);
  const alta = { nombre: partes[0], apellidos: partes.slice(1).join(' ') || '-' };
  try {
    const id = await mapon.crearConductor({ ...alta, telefono: t9 ? `+34${t9}` : undefined });
    console.log(`🆕 [FICHAJE] Conductor creado en Mapon: "${nom}"${t9 ? ` · +34${t9}` : ''} (id ${id})`);
    return id;
  } catch (e) {
    if (!/1002|already been taken/i.test(e.message)) throw e;

    // EL TELÉFONO YA ES DE ALGUIEN EN MAPON y la lista no nos lo enseñó. Antes,
    // esto tumbaba el enlace entero: sin driver no se asigna el coche, y el
    // turno quedaba anotado "Mapon no enlazó al conductor". Que Mapon no sepa
    // enseñar un teléfono no puede costar el nombre sobre el coche.
    lista = await listar();
    const ya = lista.find(tieneElTelefono) || lista.find(mismoNombre);
    if (ya) {
      console.log(`♻️ [FICHAJE] El teléfono ya era de un conductor de Mapon: se reutiliza (id ${idDe(ya)})`);
      return idDe(ya);
    }
    // Ni por teléfono ni por nombre. Se crea SIN teléfono: el nombre sobre el
    // coche vale más que la ficha completa, y el teléfono se puede añadir luego.
    const id = await mapon.crearConductor(alta);
    console.log(`🆕 [FICHAJE] Conductor creado en Mapon SIN teléfono (+34${t9} ya estaba cogido): "${nom}" (id ${id})`);
    return id;
  }
}

// ── Operaciones ───────────────────────────────────────────────────────────────

/**
 * Deshace el enlace en Mapon: si el conductor tenía otro coche antes del turno, se le
 * DEVUELVE; si no tenía ninguno, se le quita. Así un fichaje nunca deja peor la ficha
 * de un conductor real de lo que estaba.
 */
async function soltarEnMapon(t) {
  if (!t.driverId) return;
  if (t.unitPrevia) await mapon.asignarConductor(t.driverId, t.unitPrevia);
  else await mapon.desasignarConductor(t.driverId);
}

/** Cierra los turnos que llevan demasiado tiempo abiertos (olvidos). */
async function cerrarOlvidados() {
  const limite = ahoraSeg() - MAX_HORAS_TURNO * 3600;
  for (const t of (await repo.abiertos()).filter(x => x.inicio && x.inicio < limite)) {
    try { await soltarEnMapon(t); } catch (e) { /* se cierra igual */ }
    // EL MOTOR NO SE TOCA (30/09/2026). Antes se intentaba bloquear aquí con la
    // regla estricta, y lo que no se podía lo recogía el repaso. Camilo: «el
    // sistema no bloquea nada sino que suelta; los únicos que bloquean son los
    // conductores cuando terminan». Un turno olvidado lo cierra el reloj, y el
    // reloj no ha terminado ningún turno: el coche se queda como esté.
    t.fin = t.inicio + MAX_HORAS_TURNO * 3600;
    t.estado = 'auto-cerrado';
    t.notas = `${t.notas ? t.notas + ' · ' : ''}Cerrado solo tras ${MAX_HORAS_TURNO} h sin terminar (el motor no se toca)`;
    await repo.actualizar(t);
    console.log(`⏱️ [FICHAJE] Turno de ${t.nombre} (${t.matricula}) auto-cerrado`);
  }
}

/**
 * ¿SE PUEDE BLOQUEAR ESTE COCHE AL TERMINAR?
 *
 * El motor se bloquea por COCHE, pero el fichaje se enciende por PERSONA, y un
 * coche lo comparten el de día y el de noche. Si al terminar se bloquea y el
 * que lo coge después todavía no ficha, se encuentra el coche cortado y sin
 * forma de arrancarlo.
 *
 *   · TURNO de un conductor: solo se bloquea si él tiene el bloqueo encendido
 *     y TODOS los que llevan ese coche hoy o mañana también. Si no, se queda
 *     libre. Desde el 28/09/2026 todo conductor abre turno, pero el bloqueo se
 *     sigue encendiendo persona a persona (`sinControl` = él no lo tiene).
 *   · VIAJE de alguien de la empresa: se bloquea siempre, que es lo que se
 *     pidió; pero si lo lleva alguien sin el bloqueo se le avisa con su
 *     nombre, para que sepa que Tráfico tendrá que soltárselo.
 *
 * Devuelve { bloquear, faltan: [nombres], sinControl }.
 */
async function decidirBloqueo(t) {
  if (t.tipo === 'turno') {
    let suyo = false;
    try { suyo = await repo.controlMotorDe(t.conductorId); }
    catch (e) { console.error('⚠️ [FICHAJE] no se pudo mirar si tiene el bloqueo:', e.message); }
    if (!suyo) return { bloquear: false, faltan: [], sinControl: true };
  }
  let faltan = [];
  try {
    faltan = (await repo.quienesLlevan(t.matricula))
      .filter(p => !p.fichaCoche && String(p.conductorId) !== String(t.conductorId || ''))
      .map(p => p.nombre);
  } catch (e) {
    // Sin saber quién lo lleva, un turno NO se bloquea: la duda no puede dejar
    // a nadie sin coche. Un viaje sí, como se pidió.
    console.error('⚠️ [FICHAJE] no se pudo mirar quién lleva el coche:', e.message);
    return { bloquear: t.tipo === 'viaje', faltan: [], desconocido: true };
  }
  if (t.tipo === 'viaje') return { bloquear: true, faltan };
  return { bloquear: faltan.length === 0, faltan };
}

/** Estado actual: { abierto, turno } */
async function estado(telefono) {
  await cerrarOlvidados();
  const t = await abiertoDe(telefono);
  return { abierto: !!t, turno: t };
}

/**
 * Abre turno: resuelve la matrícula en Mapon, comprueba que nadie más la tenga,
 * asigna el conductor en Mapon y apunta el turno en el libro.
 */
async function iniciar({ telefono, nombre, matricula }) {
  await cerrarOlvidados();

  const yaAbierto = await abiertoDe(telefono);
  if (yaAbierto) {
    return { ok: false, motivo: 'ya-abierto', turno: yaAbierto };
  }

  // QUIÉN ES, antes que nada: su nombre es lo que va a ver Mapon sobre el coche.
  // Y si no tiene el fichaje encendido, no abre nada.
  const p = await participa(telefono);
  if (!p || p.soloCerrar) return { ok: false, motivo: 'no-participa' };
  const quien = await quienFicha(telefono);
  const nom = quien.nombre || String(nombre || '').trim();
  if (!nom) return { ok: false, motivo: 'sin-nombre' };
  const unidad = await mapon.unidadPorMatricula(matricula);
  if (!unidad) return { ok: false, motivo: 'sin-matricula' };
  // EL COCHE TIENE QUE SER DE LA SEDE DE QUIEN LO COGE. Hasta el 30/09/2026 un
  // coche de Barcelona entraba como cualquiera, y un viaje de prueba con el
  // 1888LTJ le dejó el motor cortado allí durante días (ver otraSede.js). Desde
  // el 02/10 el bot lo usan también los de Barcelona: cada uno, los de su sede.
  // Los viajes de la empresa, solo Madrid. Un coche que no está en Vehículos
  // cuenta como de Madrid; a uno de Barcelona se le dice que no lo conocemos,
  // que es la verdad, y no que es de Madrid.
  const sedePersona = p.sede || SEDE_FLOTA;
  const sedeConocida = await otraSede.sedeDe({ matricula: unidad.matricula, unitId: unidad.unitId });
  const sedeCoche = sedeConocida || SEDE_FLOTA;
  if (sedeCoche !== sedePersona) {
    return { ok: false, motivo: sedeConocida ? 'otra-sede' : 'coche-sin-sede', matricula: unidad.matricula,
      sede: otraSede.nombreSede(sedeCoche), sedePersona: otraSede.nombreSede(sedePersona) };
  }
  // El motor, solo el de Madrid. Uno de otra sede no se corta nunca (`motor`) y
  // al empezar tampoco se suelta: si Barcelona lo ha cortado, ha sido desde
  // Mapon y a propósito.
  const motorNuestro = sedeCoche === SEDE_FLOTA;

  // EL COCHE LO TIENE OTRO: SE LO QUEDA QUIEN ESCRIBE LA MATRÍCULA (29/09/2026).
  //
  // Lo dijo Camilo: si alguien empieza en una matrícula es porque la va a usar, y
  // desde ese momento el responsable del coche es él. El turno del otro se cierra
  // aquí como RELEVADO, lo pulsara o no —un olvido de «Entregar coche» no puede
  // dejar a nadie en la acera—. Antes solo pasaba si el otro había pulsado el
  // botón o si el cuadrante le daba hoy ese coche al que entra; el resto recibía
  // «figura todavía con…» y no podía ni abrir las puertas (David Urbano con el
  // 1205MJY de Rachid Lakraa, 29/09 a las 21:07).
  //
  // EL MOTOR NO SE CORTA EN EL RELEVO: el coche sigue trabajando, pasa del uno al
  // otro. Aun así, si al que lo tenía se le bloquearía al terminar —el coche tiene
  // relé de corte y él el bloqueo encendido—, se pide lo mismo que en «Terminar
  // turno»: parado y apagado. Sin relé, o sin bloqueo, se cierra y ya.
  //
  // Queda anotado si no pulsó el botón (sin su hora de salida no hay km del
  // trayecto de entrega) y si al que entra no le tocaba ese coche en el cuadrante,
  // que es lo que Tráfico querrá mirar si algo no cuadra.
  let relevoDe = null;
  const ocupado = await abiertoDeCoche(unidad.matricula, telefono);
  if (ocupado) {
    if (BLOQUEO_ACTIVO && (await decidirBloqueo(ocupado)).bloquear) {
      const m = await estadoMotor(unidad.unitId);
      if (m.sabemos && m.enMarcha) {
        return { ok: false, motivo: 'ocupado-en-marcha', velocidad: m.velocidad, turno: ocupado };
      }
      if (m.sabemos && m.ignicion === true && (m.ignicionSeg == null || m.ignicionSeg <= 10 * 60)) {
        return { ok: false, motivo: 'ocupado-encendido', turno: ocupado };
      }
    }
    const entregando = ocupado.tipo === 'turno' && !!ocupado.relevo;
    let fueraDelPlan = false;
    if (!entregando && p.tipo === 'turno' && p.conductorId) {
      const plan = await repo.cochesDelPlan(p.conductorId).catch(() => null);
      fueraDelPlan = !!plan && !plan.some(c => normMat(c.matricula) === normMat(unidad.matricula));
    }
    relevoDe = await cerrarPorRelevo(ocupado, p.nombre, { sinBoton: !entregando, fueraDelPlan });
  }

  // El enlace en Mapon no debe impedir fichar: si falla, el turno se abre igual y se
  // anota — la prueba de quién llevaba el coche es nuestro libro, no Mapon.
  // OJO: driver/update con `unit` MUEVE al conductor de coche. Si ya tenía uno puesto
  // (caso normal si es un conductor real que ya existía en Mapon), se apunta cuál era
  // para devolvérselo al terminar y no dejarle la ficha tocada.
  let driverId = '', notas = '', unitPrevia = '', errorMapon = '';
  try {
    driverId = await conductorMapon(nom, telefono);
    if (driverId) {
      const previa = await mapon.unidadDeConductor(driverId).catch(() => null);
      if (previa && String(previa.unitId) !== String(unidad.unitId)) {
        unitPrevia = String(previa.unitId);
        notas = `Tenía asignado ${previa.matricula || previa.unitId}; se le devolverá al terminar`;
      }
      await mapon.asignarConductor(driverId, unidad.unitId);
    }
  } catch (e) {
    notas = `Mapon no enlazó al conductor: ${e.message}`;
    errorMapon = e.message;
    console.error('⚠️ [FICHAJE] asignar:', e.message);
  }

  // La ficha, si la tiene. Puede faltar —el fichaje responde a teléfonos que no
  // tienen por qué ser conductores— y el turno se abre igual; pero cuando se
  // sabe, se ata: es lo que permite que la auditoría pase de señalar matrículas
  // a señalar personas.
  const conductorId = quien.conductorId || null;

  const turno = {
    id: referencia(telefono), telefono: tel9(telefono), nombre: nom, conductorId,
    tipo: p.tipo, usuarioId: p.usuarioId || null,
    matricula: unidad.matricula, unitId: String(unidad.unitId), driverId: String(driverId || ''),
    inicio: ahoraSeg(), fin: 0, km: null, trayectos: 0, atribuidos: 0, estado: 'abierto', notas, unitPrevia
  };
  // Si entre la comprobación de arriba y este INSERT ha entrado otro mensaje,
  // la base lo para y aquí se contesta lo mismo que si se hubiera visto antes.
  const guardado = await repo.crear(turno);
  if (!guardado) {
    const otro = await abiertoDeCoche(unidad.matricula, telefono) || await abiertoDe(telefono);
    return { ok: false, motivo: otro && otro.telefono !== turno.telefono ? 'coche-ocupado' : 'ya-abierto', turno: otro };
  }
  // Con el turno YA registrado se libera el motor: si algo fallara, el turno consta
  // igual y el coche se puede desbloquear a mano desde el panel.
  const mot = motorNuestro ? await liberarMotor(unidad.unitId)
    : { hecho: false, sinControl: true, motivo: `coche de ${otraSede.nombreSede(sedeCoche)}: el motor se lleva desde Mapon` };
  // Al libro del ciclo, si se soltó de verdad (o no se pudo): un coche que ya
  // estaba libre no cambia nada y no se apunta.
  if (motorNuestro && !mot.yaEstaba && mot.motivo !== 'sin relé de corte') {
    await apuntarCiclo(turno, 'soltar', mot, `Empieza ${p.tipo === 'viaje' ? 'un viaje' : 'su turno'}: ${nom}`);
  }
  console.log(`🟢 [FICHAJE] ${nom} (${quien.origen}) inicia ${p.tipo} en ${unidad.matricula} (unit ${unidad.unitId})` +
    (driverId ? ` · Mapon driver ${driverId}` : ' · SIN enlace en Mapon') +
    (BLOQUEO_ACTIVO && motorNuestro ? ` · motor ${mot.hecho ? 'LIBRE' : 'NO liberado: ' + mot.motivo}` : '') +
    (motorNuestro ? '' : ` · ${otraSede.nombreSede(sedeCoche)}: el motor no se toca`));
  // Lo que sabe la caché de esta persona ha cambiado: ahora tiene algo abierto.
  olvidar(telefono);
  // `bloqueoActivo` dice si al conductor se le habla del motor: en un coche de
  // otra sede, nunca.
  return { ok: true, turno, vehiculo: unidad.vehiculo, enlazado: !!driverId, errorMapon,
    motor: mot, bloqueoActivo: BLOQUEO_ACTIVO && motorNuestro, quien, relevoDe };
}

/**
 * Cierra el turno (o el viaje) del que tenía el coche: lo ha cogido otro. No se
 * bloquea el motor —el coche sigue trabajando— y se apuntan los km del turno y
 * los del trayecto al relevo. `sinBoton` y `fueraDelPlan` solo van a las notas
 * y al aviso: el turno se cierra igual.
 */
async function cerrarPorRelevo(t, quienEntra, { sinBoton = false, fueraDelPlan = false } = {}) {
  const fin = ahoraSeg();
  const [km, kmRel] = await Promise.all([kmDelTurno(t, fin), t.relevo ? kmDelTurno({ ...t, inicio: t.relevo }, fin) : null]);
  try { await soltarEnMapon(t); } catch (e) { /* se cierra igual */ }
  t.fin = fin;
  t.km = km ? km.km : null;
  t.kmRelevo = kmRel ? kmRel.km : null;
  t.trayectos = km ? km.trayectos : 0;
  t.atribuidos = km ? km.conConductor : 0;
  t.estado = 'relevado';
  t.notas = `${t.notas ? t.notas + ' · ' : ''}Relevado por ${quienEntra || 'su compañero'}` +
    (sinBoton ? ' (no pulsó «Entregar coche»)' : '') +
    (fueraDelPlan ? ` · ${quienEntra || 'quien entra'} no tenía ese coche en el cuadrante de hoy` : '');
  await repo.actualizar(t);
  olvidar(t.telefono);
  t.sinBoton = sinBoton;
  console.log(`🔄 [FICHAJE] ${t.nombre} entrega ${t.matricula} a ${quienEntra}: ${t.km} km (relevo ${t.kmRelevo} km)`);
  return t;
}

/**
 * «ENTREGAR COCHE» (antes «Voy al relevo»). Se pulsa JUSTO ANTES de arrancar
 * hacia el sitio donde se le da el coche al compañero: desde esa hora se cuentan
 * los km del trayecto de entrega. `si = false` lo deshace, por si se pulsó sin querer.
 */
async function marcarRelevo(telefono, si = true) {
  const t = await abiertoDe(telefono);
  if (!t) return { ok: false, motivo: 'sin-turno' };
  if (t.tipo !== 'turno') return { ok: false, motivo: 'es-viaje', turno: t };
  const r = await repo.marcarRelevo(t.id, si);
  return r ? { ok: true, turno: r } : { ok: false, motivo: 'sin-turno' };
}

/** El coche que el cuadrante le da hoy a quien escribe (solo conductores). */
async function cochesDelPlan(telefono) {
  const p = await participa(telefono);
  if (!p || p.tipo !== 'turno' || !p.conductorId) return [];
  return repo.cochesDelPlan(p.conductorId).catch(e => {
    console.error('⚠️ [FICHAJE] coche del plan:', e.message);
    return [];
  });
}

/** Km recorridos por el coche desde que empezó el turno hasta ahora. */
async function kmDelTurno(turno, hasta) {
  try {
    return await mapon.kmEnVentana({ unitId: turno.unitId, fromTs: turno.inicio, tillTs: hasta || ahoraSeg() });
  } catch (e) {
    console.error('⚠️ [FICHAJE] km:', e.message);
    return null;
  }
}

/** Cierra el turno: quita la asignación en Mapon y calcula los km del periodo. */
async function terminar(telefono) {
  await cerrarOlvidados();
  const t = await abiertoDe(telefono);
  if (!t) return { ok: false, motivo: 'sin-turno' };

  // EN MARCHA NO SE TERMINA EL TURNO.
  //
  // Terminar es lo que corta el motor, así que cerrar el turno rodando deja el
  // bloqueo pendiente y el coche se inmoviliza donde quiera que pare: un carril,
  // una salida, la puerta de un cliente. El turno se queda ABIERTO y se le pide
  // que aparque primero — es un minuto para él y evita dejar un coche cruzado.
  //
  // Solo cuando el corte está encendido: sin él, terminar no inmoviliza nada y
  // no hay motivo para no dejarle cerrar.
  //
  // Y solo si SABEMOS que va en marcha. Si Mapon no contesta se le deja cerrar:
  // la duda nunca puede dejar a alguien sin poder terminar su jornada.
  // Y CON EL COCHE ENCENDIDO TAMPOCO.
  //
  // Es el mismo problema un paso más cerca: parado pero con el contacto puesto,
  // el corte entra y el coche ya no se deja apagar. Primero se apaga, luego se
  // termina. El turno se queda abierto mientras tanto.
  //
  // No hay forma de saltarse esto: con el coche encendido el turno NO ha
  // terminado. La única salida es la duda — si Mapon calla o la medida es vieja
  // se le deja cerrar, porque no saberlo no puede dejar a nadie atrapado.
  // Si este coche no se va a bloquear —lo coge luego alguien que no ficha—, no
  // hace falta pedirle que aparque y apague: terminar no inmoviliza nada.
  const dec = await decidirBloqueo(t);
  if (BLOQUEO_ACTIVO && dec.bloquear) {
    const m = await estadoMotor(t.unitId);
    if (m.sabemos && m.enMarcha) {
      return { ok: false, motivo: 'coche-en-marcha', velocidad: m.velocidad, turno: t };
    }
    if (m.sabemos && m.ignicion === true && (m.ignicionSeg == null || m.ignicionSeg <= 10 * 60)) {
      return { ok: false, motivo: 'coche-encendido', turno: t };
    }
  }

  const fin = ahoraSeg();
  const [km, kmRel] = await Promise.all([kmDelTurno(t, fin),
    t.relevo ? kmDelTurno({ ...t, inicio: t.relevo }, fin) : null]);
  try { await soltarEnMapon(t); }
  catch (e) { t.notas = `${t.notas ? t.notas + ' · ' : ''}Mapon no soltó el coche: ${e.message}`; }

  // Al cerrar, el coche queda bloqueado hasta que alguien vuelva a fichar en él.
  //
  // `porOrden`: lo ha pedido el conductor, así que basta con que no esté rodando.
  // No hace falta esperar a que lleve veinte minutos quieto — acaba de decir que
  // ha terminado, y eso es mejor información que cualquier sensor.
  // Sin el bloqueo encendido (`sinControl`) no se intenta nada y no se anota:
  // no es un fallo, es que a esa persona todavía no se le ha encendido.
  const mot = dec.bloquear
    ? await bloquearMotor(t.unitId, { porOrden: true })
    : { hecho: false, seQuedaLibre: true, sinControl: !!dec.sinControl,
        motivo: dec.sinControl ? 'sin bloqueo de motor' : 'lo lleva alguien sin el bloqueo encendido' };
  if (BLOQUEO_ACTIVO && !mot.hecho && !mot.sinControl) t.notas = `${t.notas ? t.notas + ' · ' : ''}Motor NO bloqueado: ${mot.motivo}`;
  // AL LIBRO DEL CICLO: es EL momento en que se bloquea un coche, el único
  // (30/09/2026). Salga bien o mal: lo que no se pudo bloquear lo tiene que ver
  // Tráfico en el módulo, porque ya no hay repaso que lo reintente.
  if (BLOQUEO_ACTIVO && dec.bloquear) {
    await apuntarCiclo(t, 'bloquear', mot, `Termina ${t.tipo === 'viaje' ? 'el viaje' : 'el turno'}: ${t.nombre}`);
  }

  t.fin = fin;
  t.km = km ? km.km : null;
  t.kmRelevo = kmRel ? kmRel.km : null;
  t.trayectos = km ? km.trayectos : 0;
  t.atribuidos = km ? km.conConductor : 0;
  t.estado = 'cerrado';
  await repo.actualizar(t);
  console.log(`🔴 [FICHAJE] ${t.nombre} termina turno en ${t.matricula}: ${t.km} km` +
    (BLOQUEO_ACTIVO && !mot.sinControl ? ` · motor ${mot.hecho ? 'BLOQUEADO' : 'NO bloqueado: ' + mot.motivo}` : ''));
  // Si le apagaron el fichaje a mitad de turno, al cerrarlo deja de participar ya.
  olvidar(telefono);
  return { ok: true, turno: t, km, motor: mot, bloqueoActivo: BLOQUEO_ACTIVO, faltan: dec.faltan };
}

// ── El ciclo: lo que se bloquea y se suelta, apuntado ───────────────────────
//
// NO HAY REPASO (30/09/2026). Hubo un cron que cada diez minutos cortaba todo
// coche parado de los que habían pasado ALGUNA VEZ por el libro. Guardaba para
// siempre: un viaje de prueba de 21 segundos con el 1888LTJ, de Barcelona, lo
// dejó dentro, y se lo cortaba cada vez que llevaba veinte minutos aparcado.
// Camilo: «no quiero ningún repaso; los únicos que bloquearán son los
// conductores cuando inicien turnos y terminen». Lo que el repaso reintentaba
// (un corte que falló al terminar) ahora lo VE Tráfico en el módulo, y decide.

/**
 * Apunta en el libro del ciclo (`fichaje_orden_motor`) lo que acaba de hacer el
 * conductor con el motor: bloquear al terminar o soltar al empezar. Sin usuario:
 * con usuario es Tráfico a mano. Que el apunte falle no puede impedir a nadie
 * empezar ni terminar: se llora en el log y se sigue.
 */
async function apuntarCiclo(t, accion, mot, motivo) {
  try {
    await repo.registrarOrdenMotor({
      matricula: t.matricula, unitId: t.unitId, accion, motivo,
      hecho: !!mot.hecho,
      respuesta: mot.hecho ? (mot.yaEstaba ? (accion === 'bloquear' ? 'ya estaba bloqueado' : 'ya estaba libre')
        : (accion === 'bloquear' ? 'bloqueado' : 'libre')) : (mot.motivo || 'sin respuesta'),
      usuarioId: null,
    });
  } catch (e) {
    console.error(`⚠️ [FICHAJE] No se pudo apuntar en el ciclo (${accion} ${t.matricula}):`, e.message);
  }
}

/**
 * Qué coches puede tocar el fichaje: los que han pasado por él (y los que diga
 * FICHAJE_MATRICULAS). Desde el 30/09/2026 solo lo usa «liberar todos»: el
 * repaso, que también lo usaba, ya no existe.
 */
async function alcanceDelFichaje({ soloConControl = false } = {}) {
  const [conocidos, sedes] = await Promise.all([
    (soloConControl ? repo.unitsConControl() : repo.unitsConocidos()).then(l => new Set(l.map(String))),
    otraSede.cochesDeOtraSede(),
  ]);
  // La sede PRIMERO, también antes que el '*': un coche de Barcelona no entra ni
  // aunque salga en el libro. Y así «liberar todos» tampoco le suelta un motor
  // que Barcelona haya cortado a propósito desde Mapon.
  return v => !otraSede.sedeAjenaEn(sedes, v) && (TODA_LA_FLOTA
    || conocidos.has(String(v.unitId))
    || MATRICULAS.includes(normMat(v.matricula)));
}

/**
 * SUELTA el motor de todos los coches que el fichaje haya podido bloquear.
 *
 * Existe por lo mismo que existe el freno de mano:
 * porque hay que poder deshacerlo. Sirve para dejar la flota como estaba después
 * de unas pruebas, y para abrir la mano de golpe si algo va mal.
 *
 * Liberar no deja a nadie tirado, así que no hay condiciones que cumplir: lo
 * único que no se toca es un coche en marcha, y de eso ya se encarga `motor`.
 */
async function liberarConocidos({ soloMirar = false } = {}) {
  const alcanza = await alcanceDelFichaje();
  const flota = await mapon.relesDeFlota();
  const liberados = [], yaLibres = [], fallidos = [];

  for (const v of (flota.vehiculos || [])) {
    if (!alcanza(v)) continue;
    const rele = (v.reles || []).find(r => r.tipo === 'engine_block' && r.habilitado);
    if (!rele) continue;
    if (Number(rele.activo) !== RELE_BLOQUEADO) { yaLibres.push(v.matricula); continue; }
    if (soloMirar) { liberados.push({ matricula: v.matricula, unitId: v.unitId, simulado: true }); continue; }
    const r = await motor(v.unitId, false);
    if (r.hecho) liberados.push({ matricula: v.matricula, unitId: v.unitId });
    else fallidos.push({ matricula: v.matricula, motivo: r.motivo });
  }

  if (!soloMirar && (liberados.length || fallidos.length)) {
    console.log(`🔓 [FICHAJE] Liberados ${liberados.length} coche(s)` +
      (fallidos.length ? `, ${fallidos.length} sin poder` : ''));
  }
  return { soloMirar, liberados, yaLibres, fallidos };
}


// ── Lo que usa el ERP (el panel «Fichaje» del planificador y /usuarios) ─────

/** Enciende o apaga el fichaje de un conductor. Se olvida la caché al momento. */
async function activarConductor(conductorId, activo, quien = {}) {
  const r = await repo.fijarFichaCoche(conductorId, activo, quien.usuarioId || null);
  olvidar();
  console.log(`🔑 [FICHAJE] Conductor ${conductorId}: fichaje ${r.fichaCoche ? 'ENCENDIDO' : 'apagado'}` +
    (quien.usuarioId ? ` — por el usuario ${quien.usuarioId}` : ''));
  return r;
}

/** Lo que pinta el panel: quién ficha, qué hay abierto ahora y si el corte está encendido. */
async function estadoParaPanel() {
  await cerrarOlvidados().catch(() => {});
  // El panel es el del planificador de MADRID: los turnos de Barcelona
  // (02/10/2026) no salen. Sin saber la sede se enseñan todos.
  const [activos, abiertosAhora, sedes] = await Promise.all([repo.activados(), repo.abiertos(),
    otraSede.cochesDeOtraSede().catch(() => null)]);
  return {
    bloqueoActivo: BLOQUEO_ACTIVO,
    activados: activos,
    abiertos: abiertosAhora.filter(t => !otraSede.sedeAjenaEn(sedes, t)).map(t => ({
      tipo: t.tipo, nombre: t.nombre, conductorId: t.conductorId, matricula: t.matricula,
      desde: horaES(t.inicio), relevo: t.relevo ? horaES(t.relevo) : null,
    })),
  };
}

/**
 * SOLTAR A MANO el motor de un coche, desde el módulo «Ciclo de bloqueo de
 * motor» (hasta el 30/09/2026, desde el panel del planificador). Es lo que hace
 * Tráfico con el coche que se queda en el taller: sale del ciclo, y no se
 * vuelve a bloquear hasta que alguien empiece y termine un turno en él.
 *
 * Soltar nunca deja tirado a nadie, así que no hay más condiciones que las del
 * propio `motor`; pero hay que decir por qué, y queda escrito CON QUIÉN
 * (fichaje_orden_motor). El usuario no es un detalle: en el libro, una orden
 * sin usuario es del conductor, y el ciclo la leería al revés.
 */
async function soltarCoche({ matricula, motivo }, quien = {}) {
  if (!String(motivo || '').trim()) throw new Error('Di por qué se suelta el motor: queda escrito');
  if (!quien.usuarioId) throw new Error('No sé quién eres: vuelve a entrar en el ERP y repite');
  const unidad = await mapon.unidadPorMatricula(matricula);
  if (!unidad) throw new Error(`La matrícula ${matricula} no está en Mapon`);
  // De otra sede, tampoco a mano: su motor es cosa suya y se lleva desde Mapon.
  const ajena = await otraSede.sedeAjena({ matricula: unidad.matricula, unitId: unidad.unitId });
  if (ajena) throw new Error(`El ${unidad.matricula} es de ${otraSede.nombreSede(ajena)}: su motor no se toca desde aquí. Si hace falta, desde Mapon.`);
  const r = await motor(unidad.unitId, false);
  await repo.registrarOrdenMotor({
    matricula: unidad.matricula, unitId: unidad.unitId, accion: 'soltar', motivo,
    hecho: r.hecho, respuesta: r.hecho ? (r.yaEstaba ? 'ya estaba libre' : 'libre') : r.motivo,
    usuarioId: quien.usuarioId,
  });
  console.log(`🔓 [FICHAJE] ${unidad.matricula} soltado a mano por el usuario ${quien.usuarioId}: ` +
    (r.hecho ? 'LIBRE' : 'NO — ' + r.motivo));
  return { matricula: unidad.matricula, hecho: r.hecho, yaEstaba: !!r.yaEstaba, motivo: r.motivo || '' };
}

module.exports = {
  participa, olvidar, decidirBloqueo, marcarRelevo, cochesDelPlan,
  activarConductor, estadoParaPanel, soltarCoche,
  quienFicha, nombreParaSaludar, estado, iniciar, terminar, kmDelTurno,
  conductorMapon,
  liberarMotor, bloquearMotor, estadoMotor, puedeInmovilizar, liberarConocidos,
  RELE_BLOQUEADO,
  horaES, duracion, MAX_HORAS_TURNO, BLOQUEO_ACTIVO, MIN_PARADO,
  MATRICULAS, TODA_LA_FLOTA
};
