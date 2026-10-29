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
 * LA EXCEPCIÓN DE LAS 14 H (26/10/2026, db/219). Un turno que nadie ha cerrado
 * en 14 h se cierra solo y SE BLOQUEA EL MOTOR, pero solo con el coche
 * detenido (quieto, apagado y con señal); si anda, se le pregunta por WhatsApp
 * si sigue en el coche y el turno sigue abierto. Ver `revisarTurnosLargos`.
 *
 * OJO CON LAS PALABRAS (28/09/2026): al conductor NO se le habla de «fichar» ni de
 * «fichaje». Esto no es el registro de jornada —ese es /fichaje— sino quién tiene
 * qué coche y cuántos km hace; llamarlo igual invitaría a tomarlo por lo otro.
 */

const mapon = require('./mapon');
const repo = require('./repo/fichajeTurno');
// ¿Contesta Mapon? Si no (la cuenta suspendida por un pago, 05/10/2026), el turno
// se abre solo en nuestra base y no se tocan ni motores ni puertas. Las pruebas
// usan un Mapon de mentira sin esta función: para ellas, Mapon funciona.
const maponDisponible = () => typeof mapon.disponible !== 'function' || mapon.disponible();
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

  // SIN QUE NADIE LO PIDA (desde el 26/10/2026, solo el cierre de las 14 h) hay
  // que SABER que está apagado, y desde hace rato. La revisión del 26/10 lo
  // pilló: un contacto que Mapon no dice (null) pasaba por apagado, y el rato
  // «parado» de Mapon cuenta también el ralentí (no tiene un estado para eso):
  // quien esperaba 40 min con el aire puesto y quitaba el contacto ya daba
  // «parado 40 min y apagado» en el repaso siguiente.
  if (info.ignicion !== false) return 'no se sabe si el coche está apagado';
  if (info.segSinSenal == null) return 'no se sabe cuándo dio señal el coche por última vez';
  if (info.segSinSenal > MAX_SIN_SENAL * 60) {
    return `sin señal desde hace ${Math.round(info.segSinSenal / 60)} min`;
  }
  // null = Mapon no lo dice. No es una autorización.
  if (info.segParado == null) return 'no se sabe cuánto lleva parado';
  if (info.segParado < MIN_PARADO * 60) {
    return `solo lleva ${Math.round(info.segParado / 60)} min parado (hacen falta ${MIN_PARADO})`;
  }
  if (info.ignicionDesdeSeg == null) return 'no se sabe cuánto lleva apagado';
  if (info.ignicionDesdeSeg < MIN_PARADO * 60) {
    return `solo lleva ${Math.round(info.ignicionDesdeSeg / 60)} min apagado (hacen falta ${MIN_PARADO})`;
  }
  return null;
}

// ── Una orden de motor por coche a la vez (11/10/2026) ───────────────────────
//
// El 11/10 a las 07:56:55 Hamid pulsó «Terminar turno» en el 1067MJY y Javier
// escribió la matrícula nueve segundos después. Bloquear tarda unos 14 s (los
// km, la orden y esperar a que el coche la confirme). El «soltar» de Javier
// miró el relé en medio, lo vio todavía libre y no mandó nada; tres segundos
// después entró el corte de Hamid. Javier trabajó el día entero con un coche
// que al final no se dejaba apagar.
//
// Ahora las órdenes de un mismo coche van EN FILA: la segunda espera a que
// acabe la primera y decide con el relé ya como lo dejó. En memoria y no en la
// base a propósito: el backend es UN solo proceso (services/db.js), y un
// candado de la base tendría una conexión cogida los ~15 s de cada orden —al
// cambio de turno, con varios coches a la vez, eso se come el pool—. Lo que se
// escapara (dos procesos un instante, en un despliegue) lo recoge la
// comprobación de después de bloquear (`peligroTrasBloquear`).
//
// Si la de delante no acaba (Mapon colgado), no se espera para siempre:
// bloquear se rinde —ya lo verá Tráfico en el ciclo— y soltar se manda igual,
// porque soltar no deja tirado a nadie y negarse sí.
const esperaFilaMs = () => Number(process.env.FICHAJE_ESPERA_FILA_MS || 45000);
const filaMotor = new Map();   // unitId → la última orden en la fila (una promesa que nunca falla)

async function enFilaDelCoche(unitId, fn) {
  const clave = String(unitId);
  const anterior = filaMotor.get(clave) || Promise.resolve();
  let acabar;
  const mia = new Promise(r => { acabar = r; });
  const cola = anterior.then(() => mia);
  filaMotor.set(clave, cola);
  try {
    let plazo;
    const aTiempo = await Promise.race([
      anterior.then(() => true),
      new Promise(r => { plazo = setTimeout(() => r(false), esperaFilaMs()); }),
    ]);
    clearTimeout(plazo);
    return await fn({ aTiempo });
  } finally {
    acabar();
    if (filaMotor.get(clave) === cola) filaMotor.delete(clave);
  }
}

// ── Y después de bloquear, se mira otra vez (11/10/2026) ─────────────────────
//
// Lo que se comprueba antes de cortar (`puedeInmovilizar`) vale para ESE
// instante, y la orden tarda unos segundos en entrar. Si en medio alguien pone
// el contacto, el corte entra con el coche encendido y ya no se deja apagar; y
// si alguien abre turno en ese coche, se le corta a él. Así que con el corte ya
// confirmado se vuelve a mirar —lo que leyó la confirmación y, un momento
// después, el coche otra vez— y, si pasa cualquiera de las dos cosas, se suelta
// en el acto.
const comprobarTrasBloqueoMs = () => Number(process.env.FICHAJE_COMPROBAR_TRAS_BLOQUEO_MS ?? 3000);

/** Quién más tiene abierto ese coche, sin contar a quien termina. Si no se puede mirar, nadie. */
async function otroEnElCoche(matricula, excepto) {
  if (!matricula || excepto == null) return null;
  try { return await repo.abiertoDeCoche(matricula, excepto); }
  catch (e) { console.error('⚠️ [FICHAJE] ¿Quién lleva el coche?:', e.message); return null; }
}

async function peligroTrasBloquear({ unitId, matricula, excepto, info }) {
  const encendido = i => (!i ? null
    : i.enMarcha ? 'el coche se puso en marcha mientras se bloqueaba'
      : i.ignicion === true ? 'el coche se encendió mientras se bloqueaba' : null);
  let motivo = encendido(info);
  if (!motivo) {
    const ms = comprobarTrasBloqueoMs();
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
    motivo = encendido(await mapon.relesDeUnidad(unitId).catch(() => null));
  }
  if (motivo) return { motivo };
  const otro = await otroEnElCoche(matricula, excepto);
  return otro ? { motivo: `${otro.nombre} ha cogido el coche mientras se bloqueaba`, cogidoPor: otro.nombre } : null;
}

/** Suelta lo que se acaba de bloquear y dice cómo ha ido. Va dentro de la fila del coche. */
async function deshacerBloqueo(unitId, relayId, peligro) {
  let suelto = false;
  try {
    suelto = !!(await mapon.cambiarReleConfirmado({ unitId, relayId, estado: RELE_LIBRE })).confirmado;
  } catch (e) { console.error('⚠️ [FICHAJE] deshacer el bloqueo:', e.message); }
  console.error(`⚠️ [FICHAJE] unit ${unitId}: ${peligro.motivo} → ${suelto ? 'SOLTADO otra vez' : 'NO SE HA PODIDO SOLTAR'}`);
  return {
    hecho: false, deshecho: true, suelto, cogidoPor: peligro.cogidoPor || null,
    motivo: `${peligro.motivo}: ` +
      (suelto ? 'se ha vuelto a soltar' : 'se mandó soltar y el coche no lo ha confirmado, avisa a Tráfico'),
  };
}

/**
 * Pone el motor libre o bloqueado y CONFIRMA el estado real (change_relay solo dice que
 * la orden salió). Devuelve { hecho, motivo } — `hecho:false` con su motivo si no se pudo.
 *
 * Liberar es seguro y se hace siempre que se pueda. Bloquear pasa por
 * `puedeInmovilizar`, salvo que lo haya pedido el conductor.
 *
 * `excepto` y `matricula` (al terminar): el teléfono de quien termina y su
 * coche, para saber si OTRO lo ha cogido. Sin ellos no se mira.
 */
async function motor(unitId, bloquear, { porOrden = false, excepto = null, matricula = '' } = {}) {
  // El interruptor apaga el BLOQUEO, no el desbloqueo. Si no, apagar la función
  // dejaría encerrados para siempre a los coches que ya estuvieran cortados, y el
  // interruptor de seguridad sería justo lo que impide arreglarlo.
  if (bloquear && !BLOQUEO_ACTIVO) return { hecho: false, motivo: 'desactivado' };
  // CON MAPON CAÍDO NO SE MANDA NADA (05/10/2026): la orden no llegaría, y
  // esperar diez segundos a una confirmación imposible deja al conductor mirando
  // el móvil. Se dice tal cual.
  if (!maponDisponible()) return { hecho: false, motivo: 'Mapon no está disponible ahora mismo', sinMapon: true, reintentable: true };
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
  // De aquí en adelante, en la fila del coche: leer el relé, decidir y mandar
  // van juntos, sin que otra orden del mismo coche se meta en medio.
  return enFilaDelCoche(unitId, async ({ aTiempo }) => {
    if (!aTiempo) {
      if (bloquear) return { hecho: false, motivo: 'había otra orden de motor en curso en este coche', reintentable: true };
      console.error(`⚠️ [FICHAJE] unit ${unitId}: la orden anterior no acaba; se suelta igual`);
    }
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
      const delCoche = matricula || info.matricula;
      if (bloquear) {
        const no = puedeInmovilizar(info, { porOrden });
        if (no) return { hecho: false, motivo: no, reintentable: true };
        // Si otro ya ha abierto turno en este coche, el coche es suyo: no se corta.
        const otro = await otroEnElCoche(delCoche, excepto);
        if (otro) return { hecho: false, motivo: `el coche ya lo lleva ${otro.nombre}`, cogidoPor: otro.nombre };
      }
      const r = await mapon.cambiarReleConfirmado({
        unitId, relayId: rele.relay_id, estado: bloquear ? RELE_BLOQUEADO : RELE_LIBRE
      });
      if (!r.confirmado) return { hecho: false, motivo: 'la orden salió pero el coche no la confirmó (¿sin cobertura?)', reintentable: true };
      if (bloquear) {
        const peligro = await peligroTrasBloquear({ unitId, matricula: delCoche, excepto, info: r.info });
        if (peligro) return deshacerBloqueo(unitId, rele.relay_id, peligro);
      }
      return { hecho: true, motivo: '' };
    } catch (e) {
      console.error('⚠️ [FICHAJE] motor:', e.message);
      return { hecho: false, motivo: e.message, reintentable: true };
    }
  });
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
  if (!maponDisponible()) return { sabemos: false, motivo: 'Mapon no está disponible ahora mismo' };
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
      ignicionDesdeSeg: info.ignicionDesdeSeg,
      // Cuándo se supo del coche por última vez: lo que dice si el dato es de ahora.
      segSinSenal: info.segSinSenal,
    };
  } catch (e) {
    return { sabemos: false, motivo: e.message };
  }
}
// Con orden: lo ha pedido el conductor al terminar su turno.
const bloquearMotor = (unitId, opciones) => motor(unitId, true, opciones);

/**
 * ¿Tiene que parar y apagar antes de cerrar? Para «Terminar turno» y para el
 * relevo (cuando otro coge el coche). 'en-marcha', 'encendido' o null (cierra).
 *
 * LA REGLA (21/10/2026). Camilo: «si Mapon está funcionando correctamente, que
 * le diga siempre que debe apagar el coche, sí o sí; cuando falle o la API esté
 * bloqueada, que pueda cerrar el turno».
 *
 *   · Mapon caído, bloqueado o sin contestar (`sabemos: false`) → cierra.
 *   · En marcha → no cierra.
 *   · Sin señal del coche desde hace más de MAX_SIN_SENAL minutos → cierra. Lo
 *     que dice Mapon es de antes y el corte tampoco le llegaría; sin esto, un
 *     coche apagado en un garaje sin cobertura no dejaría terminar nunca.
 *   · Encendido → no cierra, lleve lo que lleve encendido.
 *
 * `m` es `estadoMotor`, que le pregunta a Mapon EN ESE MOMENTO por ese coche, no
 * a la ingesta, que va con unos minutos de retraso. Es a propósito la excepción a
 * «se lee de PostgreSQL»: aquí un minuto de retraso es cortar un coche encendido.
 *
 * El fallo que arregla: se tomaba la hora del contacto por la de la lectura, y es
 * la hora a la que se ENCENDIÓ. Con más de 10 minutos encendido parecía un dato
 * viejo y se le dejaba cerrar: Carlos Mario Cavadia, 0698MMZ, el 21/10 a las
 * 02:53, con el coche encendido desde las 21:36 del día anterior.
 */
function hayQueApagar(m) {
  if (!m || !m.sabemos) return null;
  if (m.enMarcha) return 'en-marcha';
  if (m.segSinSenal != null && m.segSinSenal > MAX_SIN_SENAL * 60) return null;
  if (m.ignicion === true) return 'encendido';
  return null;
}

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
  // Sin Mapon no se intenta: fallaría igual, y el conductor no se queda colgado
  // de nada que importe (05/10/2026).
  if (!t.driverId || !maponDisponible()) return;
  if (t.unitPrevia) await mapon.asignarConductor(t.driverId, t.unitPrevia);
  else await mapon.desasignarConductor(t.driverId);
}

/**
 * Cierra los turnos que llevan demasiado tiempo abiertos (olvidos), sin mirar
 * el coche ni tocar el motor. Es lo de antes de db/219: se llama al empezar,
 * terminar o mirar un turno, y desde db/219 ya no hace nada, porque lo lleva el
 * repaso con el coche delante (`revisarTurnosLargos`). Si lo siguiera haciendo,
 * quien pulsa «Sigo en el coche» a las 14 h vería su turno cerrado antes de que
 * su «sí» llegara a apuntarse. Si no se puede saber si está db/219 (un fallo de
 * la base), tampoco: no se cierra a ciegas a quien quizá dijo que sigue.
 */
async function cerrarOlvidados() {
  if ((await haySeguimiento()) !== false) return;
  const limite = ahoraSeg() - MAX_HORAS_TURNO * 3600;
  for (const t of (await repo.abiertos()).filter(x => x.inicio && x.inicio < limite)) {
    // Uno que no se deja cerrar no puede tumbar a los demás: esto va delante de
    // empezar, terminar y mirar un turno, de todo el mundo.
    try { await cerrarSinMotor(t, `Cerrado solo tras ${MAX_HORAS_TURNO} h sin terminar (el motor no se toca)`); }
    catch (e) { console.error(`❌ [FICHAJE] No se pudo cerrar el turno olvidado de ${t.nombre} (${t.matricula}):`, e.message); }
  }
}

/**
 * EL FIN DE UN TURNO QUE SE CIERRA SOLO: el que toque, pero nunca antes de su
 * «Entregar coche» (la base lo exige: ck_ft_relevo, db/148) ni de su último
 * «Sigo en el coche» (`s`, el seguimiento de db/219). Con db/219 un turno puede
 * seguir abierto pasadas las 14 h, y ahí se le puede pulsar cualquiera de los dos.
 */
const finSeguro = (t, fin, s) => Math.max(fin, t.inicio + 1, t.relevo || 0, (s && s.confirmadoAt) || 0);

/**
 * Guarda el cierre SOLO si el turno sigue abierto: si en medio lo ha cerrado
 * otro camino («Terminar turno», un relevo), no se pisa. → el turno, o null.
 * (Un repositorio sin `cerrarSiAbierto` —las pruebas de antes— guarda sin más.)
 */
const guardarCierre = t => (typeof repo.cerrarSiAbierto === 'function' ? repo.cerrarSiAbierto(t) : repo.actualizar(t));

/** Cierra un turno olvidado sin tocar el motor: lo de antes de db/219, y lo que no se sabe. → el turno, o null. */
async function cerrarSinMotor(t, nota, { s } = {}) {
  const cerrado = { ...t, fin: finSeguro(t, t.inicio + MAX_HORAS_TURNO * 3600, s), estado: 'auto-cerrado',
    notas: `${t.notas ? t.notas + ' · ' : ''}${nota}` };
  if (!(await guardarCierre(cerrado))) return null;
  try { await soltarEnMapon(t); } catch (e) { /* cerrado igual */ }
  olvidar(t.telefono);
  console.log(`⏱️ [FICHAJE] Turno de ${t.nombre} (${t.matricula}) auto-cerrado (el motor no se toca)`);
  return cerrado;
}

/**
 * CERRAR EL TURNO DE OTRO DESDE LA OFICINA (27/10/2026). Camilo: «Marcos López
 * García tiene el turno abierto, se le olvidó cerrarlo al entregárselo al
 * compañero. Ciérrale el turno, quítalo de base de datos a él como responsable,
 * yo bloquearé el coche manualmente y le diré al compañero que debe iniciar el
 * turno él».
 *
 * Hasta hoy no había forma: db/177 (María del Mar, 05/10) lo hizo con una
 * migración. Ahora va desde la ficha del coche en Bloqueo de motor.
 *
 *   · SIN TOCAR EL MOTOR: el coche puede estar rodando con el compañero.
 *   · `fin` es la HORA DE LA ENTREGA: lo que pase después ya no es suyo. Ni
 *     antes de que empezara, ni antes de su «Entregar coche» (ck_ft_relevo), ni
 *     en el futuro.
 *   · `auto-cerrado`: no lo cerró él, y la nota dice quién y por qué.
 *   · En Mapon deja de ser el conductor del coche (`soltarEnMapon`).
 *
 * → { nombre, matricula, inicio, fin, km }
 */
async function cerrarDesdeOficina({ matricula, fin, motivo } = {}, quien = {}) {
  if (!String(motivo || '').trim()) throw new Error('Di por qué se cierra: queda escrito');
  if (!quien.usuarioId) throw new Error('No sé quién eres: vuelve a entrar en el ERP y repite');
  const mat = String(matricula || '').toUpperCase().replace(/[\s-]/g, '');
  const abiertos = (await repo.abiertos()).filter(x => String(x.matricula || '').toUpperCase().replace(/[\s-]/g, '') === mat);
  if (!abiertos.length) throw new Error(`Nadie tiene un turno abierto en el ${mat}`);
  if (abiertos.length > 1) throw new Error(`Hay ${abiertos.length} turnos abiertos en el ${mat} (${abiertos.map(x => x.nombre).join(', ')}): avisa a desarrollo`);
  const t = abiertos[0];
  const ahora = ahoraSeg();
  const hasta = fin == null || fin === '' ? ahora : Math.floor(Number(fin));
  if (!Number.isFinite(hasta)) throw new Error('La hora de la entrega no vale');
  if (hasta > ahora + 60) throw new Error('La hora de la entrega no puede ser en el futuro');
  if (hasta <= t.inicio) throw new Error(`Su turno empezó el ${horaES(t.inicio)}: la entrega tiene que ser después`);
  if (t.relevo && hasta < t.relevo) throw new Error(`Pulsó «Entregar coche» el ${horaES(t.relevo)}: la entrega no puede ser antes`);

  const km = await kmDelTurno(t, hasta);
  const quienCierra = String(quien.nombre || '').trim() || 'la oficina';
  const cerrado = {
    ...t, fin: hasta, estado: 'auto-cerrado',
    km: km ? km.km : t.km, trayectos: km ? km.trayectos : t.trayectos, atribuidos: km ? km.conConductor : t.atribuidos,
    notas: `${t.notas ? t.notas + ' · ' : ''}Cerrado desde el ERP por ${quienCierra}: ${String(motivo).trim()} (el motor no se toca)`,
  };
  if (!(await guardarCierre(cerrado))) throw new Error('Ese turno ya no estaba abierto: lo ha cerrado otro camino');
  try { await soltarEnMapon(t); } catch (e) { /* cerrado igual */ }
  olvidar(t.telefono);
  console.log(`🗂️ [FICHAJE] Turno de ${t.nombre} (${t.matricula}) cerrado desde el ERP por el usuario ${quien.usuarioId} ` +
    `a las ${horaES(hasta)} (el motor no se toca)`);
  return { nombre: t.nombre, matricula: t.matricula, inicio: t.inicio, fin: hasta, km: km ? km.km : null };
}

// ── EL CIERRE DE LAS 14 H, CON EL COCHE DELANTE (26/10/2026, db/219) ─────────
//
// Camilo: «si alguien no cerró turno, que lo cierre 14 horas después, pero si el
// coche está en movimiento lo mantengas así, y le envíes un mensaje por WhatsApp
// diciéndole que confirme que sigue en el coche y así no bloquearle el coche, ya
// que si no hay nadie logueado en el bot y el coche está parado, se cierra
// automáticamente el turno y se bloquea el motor; solo si está detenido, claro».
//
// Cambia la regla del 30/09/2026 («el sistema no bloquea nada»): ahora el
// sistema SÍ bloquea, pero solo esto y solo así. Lo lleva un repaso cada 5
// minutos (app.js → fichajeBot.repasarTurnosLargos), y con cada turno de más de
// MAX_HORAS_TURNO h:
//
//   · Si dijo que sigue en el coche, no se toca hasta que pase su prórroga
//     (PRORROGA_HORAS).
//   · DETENIDO —quieto y con el contacto quitado MIN_PARADO minutos o más, y con
//     señal: la regla estricta de `puedeInmovilizar`, la de cortar sin que nadie
//     lo pida— se cierra el turno y se bloquea el motor con las mismas reglas que
//     «Terminar turno» (`decidirBloqueo`: solo si todos los que lo llevan tienen
//     el bloqueo; y `motor` vuelve a mirarlo todo antes y después de cortar).
//   · EN MARCHA, ENCENDIDO O PARADO DE HACE POCO: el turno sigue abierto y se le
//     pregunta por WhatsApp si sigue en el coche (como mucho cada
//     REPREGUNTA_HORAS). Si no contesta y el coche se queda detenido, se cierra
//     y se bloquea en el repaso siguiente.
//   · SIN SABER CÓMO ESTÁ EL COCHE (Mapon caído, sin equipo, sin señal desde hace
//     más de MAX_SIN_SENAL minutos, o sin decir si tiene el contacto puesto):
//     como antes, se cierra sin tocar el motor. No saberlo no inmoviliza nada.
//   · EL TOPE: pasadas TOPE_HORAS sin cerrarse (un coche que no para nunca, o
//     del que Mapon no dice cuánto lleva parado), se cierra sin tocar el motor.
//     Para entonces ya no se le puede escribir: WhatsApp solo deja dentro de las
//     24 h de su último mensaje.
const PRORROGA_HORAS = Number(process.env.FICHAJE_PRORROGA_HORAS || 2);
const REPREGUNTA_HORAS = Number(process.env.FICHAJE_REPREGUNTA_HORAS || 2);
const TOPE_HORAS = Number(process.env.FICHAJE_TOPE_HORAS || 24);

// Los turnos que el repaso está cerrando AHORA (un solo proceso, como la fila
// del motor): un «Sigo en el coche» que llega en esos segundos no se apunta
// como si nada, se le dice que se acaba de cerrar.
const cerrandoAhora = new Set();

/**
 * ¿Lo lleva el repaso de las 14 h? true: sí (db/219, y no apagado con
 * FICHAJE_CIERRE_14H=off). false: no, lo de antes. null: no se sabe (un fallo
 * de la base al mirarlo): esa vez no se cierra nada, ni de una forma ni de otra.
 */
async function haySeguimiento() {
  if (process.env.FICHAJE_CIERRE_14H === 'off') return false;
  if (typeof repo.haySeguimiento !== 'function') return false;
  try { return !!(await repo.haySeguimiento()); }
  catch (e) {
    console.error('⚠️ [FICHAJE] ¿Está db/219? No se ha podido mirar:', e.message);
    return null;
  }
}

/**
 * Cómo está el coche de un turno para el cierre de las 14 h.
 * → { sabemos: false, motivo } | { sabemos: true, detenido: true, info }
 *   | { sabemos: true, detenido: false, porque: 'en-marcha'|'encendido'|'parado-poco', motivo, info }
 */
async function comoEstaElCoche(t) {
  if (!t.unitId) return { sabemos: false, motivo: 'el turno no tiene equipo de Mapon' };
  if (!maponDisponible()) return { sabemos: false, motivo: 'Mapon no está disponible' };
  let info = null;
  try { info = await mapon.relesDeUnidad(t.unitId); }
  catch (e) { return { sabemos: false, motivo: `Mapon no contestó: ${e.message}` }; }
  if (!info) return { sabemos: false, motivo: 'Mapon no da el estado del coche' };
  if (info.segSinSenal == null) return { sabemos: false, motivo: 'Mapon no dice cuándo dio señal el coche por última vez' };
  if (info.segSinSenal > MAX_SIN_SENAL * 60) {
    return { sabemos: false, motivo: `el coche no da señal desde hace ${Math.round(info.segSinSenal / 60)} min` };
  }
  const anda = info.enMarcha || info.velocidad > 0;
  if (!anda && info.ignicion !== true && info.ignicion !== false) {
    return { sabemos: false, motivo: 'Mapon no dice si el coche tiene el contacto puesto' };
  }
  const no = puedeInmovilizar(info);
  if (!no) return { sabemos: true, detenido: true, info };
  const porque = anda ? 'en-marcha' : info.ignicion === true ? 'encendido' : 'parado-poco';
  return { sabemos: true, detenido: false, porque, motivo: no, info };
}

/** ¿Sigue abierto este turno, y sin un «Sigo en el coche» recién llegado? Justo antes de cerrarlo. */
async function sigueSinConfirmar(t) {
  const a = await repo.abiertoDe(t.telefono);
  if (!a || a.id !== t.id) return false;
  const s = (await repo.seguimientos([t.filaId])).get(t.filaId) || {};
  return !(s.sigueHasta && s.sigueHasta > ahoraSeg());
}

/**
 * Cierra un turno de más de 14 h con el coche detenido y bloquea el motor, como
 * «Terminar turno» pero sin que nadie lo pida: por eso con la regla estricta
 * (`porOrden: false`), que `motor` vuelve a comprobar antes de cortar. El fin
 * del turno es cuando el coche se paró, no ahora. → el resultado, o null si al
 * ir a cerrarlo ya no tocaba (lo cerró otro, o acaba de decir que sigue).
 */
async function cerrarSoloYBloquear(t, info, s) {
  const dec = await decidirBloqueo(t);
  const fin = finSeguro(t, info && info.segParado > 0 ? ahoraSeg() - Math.round(info.segParado) : ahoraSeg(), s);
  const km = await kmDelTurno(t, fin);
  if (!(await sigueSinConfirmar(t))) return null;
  cerrandoAhora.add(t.filaId);
  try {
    const mot = dec.bloquear
      ? await bloquearMotor(t.unitId, { porOrden: false, excepto: t.telefono, matricula: t.matricula })
      : { hecho: false, seQuedaLibre: true, sinControl: !!dec.sinControl,
          motivo: dec.sinControl ? 'sin bloqueo de motor' : 'lo lleva alguien sin el bloqueo encendido' };
    // UN CORTE QUE SALIÓ Y EL COCHE NO CONFIRMÓ podría entrar más tarde, cuando
    // ya lo lleve otro y sin ninguna de las comprobaciones: se manda soltar.
    if (dec.bloquear && !mot.hecho && /no la confirmó/.test(mot.motivo || '')) {
      const suelto = await liberarMotor(t.unitId).catch(() => null);
      mot.motivo += suelto && suelto.hecho ? ' (se ha mandado soltar)' : ' (se mandó soltar y tampoco lo confirmó: avisa a Tráfico)';
    }
    if (BLOQUEO_ACTIVO && dec.bloquear) {
      await apuntarCiclo(t, 'bloquear', mot, `Cierre automático tras ${MAX_HORAS_TURNO} h con el coche detenido: ${t.nombre}`);
    }
    const parado = info && info.segParado > 0 ? `parado ${Math.round(info.segParado / 60)} min y apagado` : 'parado y apagado';
    const cerrado = {
      ...t, fin, estado: 'auto-cerrado',
      km: km ? km.km : null, trayectos: km ? km.trayectos : 0, atribuidos: km ? km.conConductor : 0,
      notas: `${t.notas ? t.notas + ' · ' : ''}Cerrado solo tras ${MAX_HORAS_TURNO} h sin terminar, con el coche ${parado}` +
        (BLOQUEO_ACTIVO && !mot.sinControl ? ` · motor ${mot.hecho ? 'bloqueado' : 'NO bloqueado: ' + mot.motivo}` : ''),
    };
    let guardado;
    try { guardado = await guardarCierre(cerrado); }
    catch (e) {
      // Bloqueado y sin poder cerrar el turno, el coche se quedaría cortado con
      // un turno abierto: se suelta y se reintenta en el repaso siguiente.
      if (mot.hecho) await liberarMotor(t.unitId).catch(() => null);
      throw e;
    }
    if (!guardado) return null;
    try { await soltarEnMapon(t); } catch (e) { /* cerrado igual */ }
    olvidar(t.telefono);
    console.log(`⏱️ [FICHAJE] Turno de ${t.nombre} (${t.matricula}) cerrado solo tras ${MAX_HORAS_TURNO} h con el coche detenido` +
      (BLOQUEO_ACTIVO && !mot.sinControl ? ` · motor ${mot.hecho ? 'BLOQUEADO' : 'NO bloqueado: ' + mot.motivo}` : ''));
    return { turno: cerrado, motor: mot, faltan: dec.faltan, bloqueoActivo: BLOQUEO_ACTIVO };
  } finally {
    cerrandoAhora.delete(t.filaId);
  }
}

/**
 * EL REPASO DE LOS TURNOS DE MÁS DE 14 H (cada 5 minutos). No manda mensajes:
 * devuelve lo que ha hecho con cada uno para que la capa del bot
 * (fichajeBot.repasarTurnosLargos) se lo diga a quien toque.
 * → [{ tipo: 'preguntar', turno, porque, sinMotor } | { tipo: 'cerrado', turno, motor, faltan, sinSaber?, tope? }]
 */
async function revisarTurnosLargos() {
  const hay = await haySeguimiento();
  if (hay === null) return [];                               // no se sabe si está db/219: esta vez, nada
  if (!hay) { await cerrarOlvidados(); return []; }          // sin db/219, lo de antes
  const ahora = ahoraSeg();
  const limite = ahora - MAX_HORAS_TURNO * 3600;
  const largos = (await repo.abiertos()).filter(t => t.inicio && t.inicio < limite);
  if (!largos.length) return [];
  const seguimiento = await repo.seguimientos(largos.map(t => t.filaId));
  const acciones = [];
  for (const t of largos) {
    const s = seguimiento.get(t.filaId) || {};
    if (s.sigueHasta && s.sigueHasta > ahora) continue;   // dijo que sigue en el coche
    try {
      if (ahora - t.inicio > TOPE_HORAS * 3600) {
        const c = (await sigueSinConfirmar(t)) && await cerrarSinMotor(t, `Cerrado solo: llevaba más de ${TOPE_HORAS} h abierto (el motor no se toca)`, { s });
        if (c) acciones.push({ tipo: 'cerrado', turno: c, motor: null, faltan: [], sinSaber: 'tope', tope: true });
        continue;
      }
      const coche = await comoEstaElCoche(t);
      if (!coche.sabemos) {
        const c = (await sigueSinConfirmar(t)) && await cerrarSinMotor(t,
          `Cerrado solo tras ${MAX_HORAS_TURNO} h sin terminar; no se sabía cómo estaba el coche (${coche.motivo}): el motor no se toca`, { s });
        if (c) acciones.push({ tipo: 'cerrado', turno: c, motor: null, faltan: [], sinSaber: coche.motivo });
      } else if (coche.detenido) {
        const r = await cerrarSoloYBloquear(t, coche.info, s);
        if (r) acciones.push({ tipo: 'cerrado', ...r });
      } else if (!s.preguntadoAt || ahora - s.preguntadoAt >= REPREGUNTA_HORAS * 3600) {
        const dec = await decidirBloqueo(t);
        await repo.apuntarPregunta(t.filaId);
        acciones.push({ tipo: 'preguntar', turno: t, porque: coche.porque, sinMotor: !(BLOQUEO_ACTIVO && dec.bloquear) });
      }
    } catch (e) {
      console.error(`❌ [FICHAJE] Cierre de las ${MAX_HORAS_TURNO} h de ${t.nombre} (${t.matricula}):`, e.message);
    }
  }
  return acciones;
}

/**
 * «SIGO EN EL COCHE»: quien lleva más de 14 h con el turno abierto contesta que
 * sí. Hasta dentro de PRORROGA_HORAS no se le cierra ni se le bloquea, aunque
 * pare. Sin db/219 no hay dónde apuntarlo, y su turno tampoco se cerraría así.
 * Si llega justo mientras el repaso le está cerrando el turno, se le dice.
 */
async function confirmarSigue(telefono) {
  const t = await abiertoDe(telefono);
  if (!t) return { ok: false, motivo: 'sin-turno' };
  if (cerrandoAhora.has(t.filaId)) return { ok: false, motivo: 'cerrando', turno: t };
  const hasta = ahoraSeg() + PRORROGA_HORAS * 3600;
  if (await haySeguimiento()) await repo.confirmarSigue(t.filaId, hasta);
  console.log(`✅ [FICHAJE] ${t.nombre} sigue en ${t.matricula}: no se mira hasta dentro de ${PRORROGA_HORAS} h`);
  return { ok: true, turno: t, hasta, horas: PRORROGA_HORAS };
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
  // EL COCHE, EN MAPON; Y SI MAPON NO CONTESTA, EN NUESTRA BASE (05/10/2026).
  // Con la cuenta de Mapon suspendida nadie podía abrir turno. Camilo: «que
  // busque en la base de datos la matrícula y que solo fiche en nuestra base».
  // El turno se abre igual, pero sin conductor en Mapon y sin tocar el motor.
  let unidad = null;
  if (maponDisponible()) {
    try { unidad = await mapon.unidadPorMatricula(matricula); }
    catch (e) { if (maponDisponible()) throw e; }   // si ha sido la caída, se sigue por la base
  }
  const sinMapon = !maponDisponible();
  if (!unidad && sinMapon) unidad = await repo.cocheDeLaBase(matricula);
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
      const falta = hayQueApagar(m);
      if (falta === 'en-marcha') return { ok: false, motivo: 'ocupado-en-marcha', velocidad: m.velocidad, turno: ocupado };
      if (falta === 'encendido') return { ok: false, motivo: 'ocupado-encendido', turno: ocupado };
    }
    const entregando = !!ocupado.relevo;
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
  if (sinMapon) {
    const caida = typeof mapon.estadoCaida === 'function' ? mapon.estadoCaida() : null;
    notas = `Abierto solo en la base: Mapon no estaba disponible${caida ? ` (${caida.motivo})` : ''}. ` +
      'Sin conductor en Mapon ni motor.';
    errorMapon = 'Mapon no está disponible ahora mismo';
  } else try {
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
  const mot = sinMapon ? { hecho: false, sinControl: true, sinMapon: true, motivo: 'Mapon no está disponible ahora mismo' }
    : motorNuestro ? await liberarMotor(unidad.unitId)
    : { hecho: false, sinControl: true, motivo: `coche de ${otraSede.nombreSede(sedeCoche)}: el motor se lleva desde Mapon` };
  // Al libro del ciclo, si se soltó de verdad (o no se pudo): un coche que ya
  // estaba libre no cambia nada y no se apunta.
  if (motorNuestro && !sinMapon && !mot.yaEstaba && mot.motivo !== 'sin relé de corte') {
    await apuntarCiclo(turno, 'soltar', mot, `Empieza ${p.tipo === 'viaje' ? 'un viaje' : 'su turno'}: ${nom}`);
  }
  console.log(`🟢 [FICHAJE] ${nom} (${quien.origen}) inicia ${p.tipo} en ${unidad.matricula} (unit ${unidad.unitId})` +
    (sinMapon ? ' · SOLO EN LA BASE: Mapon no está disponible'
      : (driverId ? ` · Mapon driver ${driverId}` : ' · SIN enlace en Mapon') +
        (BLOQUEO_ACTIVO && motorNuestro ? ` · motor ${mot.hecho ? 'LIBRE' : 'NO liberado: ' + mot.motivo}` : '') +
        (motorNuestro ? '' : ` · ${otraSede.nombreSede(sedeCoche)}: el motor no se toca`)));
  // Lo que sabe la caché de esta persona ha cambiado: ahora tiene algo abierto.
  olvidar(telefono);
  // `bloqueoActivo` dice si al conductor se le habla del motor: en un coche de
  // otra sede, nunca; sin Mapon, tampoco (se le dice `sinMapon`).
  return { ok: true, turno, vehiculo: unidad.vehiculo, enlazado: !!driverId, errorMapon,
    motor: mot, bloqueoActivo: BLOQUEO_ACTIVO && motorNuestro && !sinMapon, sinMapon, quien, relevoDe };
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
 *
 * También en los VIAJES de la oficina desde el 29/10/2026 (Camilo: «que tengan
 * algo parecido a los conductores, todo igual»). La base lo admite desde db/224;
 * antes, la apuntaba solo en turnos.
 */
async function marcarRelevo(telefono, si = true) {
  const t = await abiertoDe(telefono);
  if (!t) return { ok: false, motivo: 'sin-turno' };
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
  if (!turno.unitId || !maponDisponible()) return null;   // sin Mapon no hay km que leer
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
  // Y CON EL COCHE ENCENDIDO TAMPOCO.
  //
  // Es el mismo problema un paso más cerca: parado pero con el contacto puesto,
  // el corte entra y el coche ya no se deja apagar. Primero se apaga, luego se
  // termina. El turno se queda abierto mientras tanto.
  //
  // Con Mapon funcionando no hay forma de saltarse esto, lleve el coche lo que
  // lleve encendido. Solo cierra si Mapon falla o el coche no da señal: no
  // saberlo no puede dejar a nadie atrapado (`hayQueApagar`, 21/10/2026).
  // Si este coche no se va a bloquear —lo coge luego alguien que no ficha—, no
  // hace falta pedirle que aparque y apague: terminar no inmoviliza nada.
  const dec = await decidirBloqueo(t);
  if (BLOQUEO_ACTIVO && dec.bloquear) {
    const m = await estadoMotor(t.unitId);
    const falta = hayQueApagar(m);
    if (falta === 'en-marcha') return { ok: false, motivo: 'coche-en-marcha', velocidad: m.velocidad, turno: t };
    if (falta === 'encendido') return { ok: false, motivo: 'coche-encendido', turno: t };
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
  // `excepto`/`matricula`: para que, si su compañero ya ha abierto turno en el
  // coche mientras esto se bloquea, se le deje libre a él (11/10/2026).
  const mot = dec.bloquear
    ? await bloquearMotor(t.unitId, { porOrden: true, excepto: t.telefono, matricula: t.matricula })
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
  activarConductor, estadoParaPanel, soltarCoche, cerrarDesdeOficina,
  quienFicha, nombreParaSaludar, estado, iniciar, terminar, kmDelTurno, abiertoDeCoche,
  revisarTurnosLargos, confirmarSigue, PRORROGA_HORAS,
  conductorMapon,
  liberarMotor, bloquearMotor, estadoMotor, puedeInmovilizar, hayQueApagar, liberarConocidos, maponDisponible,
  enFilaDelCoche,
  RELE_BLOQUEADO,
  horaES, duracion, MAX_HORAS_TURNO, BLOQUEO_ACTIVO, MIN_PARADO,
  MATRICULAS, TODA_LA_FLOTA
};
