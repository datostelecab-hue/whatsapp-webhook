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
 *   · El turno se apunta en un libro (Google Sheet) con conductor, matrícula y horas.
 *     Esa es la prueba: la atribución se hace por VENTANA TEMPORAL, igual que ya se
 *     hace con los timestamps de BOLT, sin depender de cómo trate Mapon el histórico.
 *   · Además, al abrir turno se ASIGNA el conductor a la unidad en Mapon (y al cerrar
 *     se le quita), para que en su plataforma se vea el nombre en vivo. Al terminar se
 *     comprueba si Mapon atribuyó los trayectos (route/list include=driver_id): así
 *     sabremos de verdad si ese enlace queda SELLADO en el histórico o no.
 *
 * EN PRUEBAS: solo responde a los teléfonos de FICHAJE_TELEFONOS (por defecto, el del
 * responsable). Al resto del bot no le afecta nada.
 */

const mapon = require('./mapon');
const sheets = require('./sheets');

const ID_FICHAJE = process.env.ID_FICHAJE || '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA = 'FICHAJE_TURNOS';
const CAB = ['id', 'telefono', 'nombre', 'matricula', 'unit_id', 'mapon_driver_id',
  'inicio', 'fin', 'km', 'trayectos', 'trayectos_atribuidos', 'estado', 'notas', 'unit_previa'];
const RANGO = `${HOJA}!A:N`;

// Teléfonos autorizados MIENTRAS está en pruebas, con el NOMBRE que se les pone (el
// mismo que se crea/asigna en Mapon: la mayoría de conductores no están dados de alta
// allí, así que el nombre lo decidimos aquí). Formato: '640389649:Claude code,600111222:Otro'.
const PRUEBAS = (process.env.FICHAJE_TELEFONOS || '640389649:Claude code')
  .split(',').map(s => s.trim()).filter(Boolean)
  .reduce((m, par) => { const [t, n] = par.split(':'); m[tel9(t)] = (n || '').trim(); return m; }, {});

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
  if (porOrden) return null;

  if (info.segSinSenal != null && info.segSinSenal > MAX_SIN_SENAL * 60) {
    return `sin señal desde hace ${Math.round(info.segSinSenal / 60)} min`;
  }
  if (info.ignicion === true) return 'tiene el contacto puesto';
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
  if (!BLOQUEO_ACTIVO) return { hecho: false, motivo: 'desactivado' };
  try {
    const info = await mapon.relesDeUnidad(unitId);
    const rele = mapon.releDeCorte(info);
    if (!rele || !rele.habilitado) return { hecho: false, motivo: 'sin relé de corte' };
    // El equipo declara control_while_moving=0: con el coche rodando no se toca,
    // ni para bloquear ni para liberar.
    //
    // `reintentable` porque el repaso SÍ lo recogerá cuando el coche pare. Sin
    // esta marca el mensaje se quedaba en "no se ha bloqueado" a secas, y quien
    // lo leía no sabía si tenía que hacer algo o no.
    if (info.enMarcha) {
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
// Para el turno basta con `FICHAJE_TELEFONOS`: solo ese número abre y cierra, y
// solo se toca el coche que él diga. Cualquier matrícula vale — se coge el que
// haya abajo y se ficha en él.
//
// El problema es el repaso, que NO tiene número: es un cron que mira la flota, y
// sin límite bloquearía coches de gente que ni sabe que esto existe.
//
// El límite lo pone el LIBRO, no una lista de matrículas: el repaso solo toca
// coches que han pasado por el fichaje, y al fichaje solo llegan los teléfonos
// autorizados. Así el aislamiento por número alcanza también al cron, y sigue
// sirviendo cualquier coche: fichas en él y desde ese momento entra.
//
// FICHAJE_MATRICULAS queda para el día que esto sea de todos:
//   vacío             = solo los coches que han pasado por el fichaje
//   '1888LTJ,0417MMZ' = además, esos
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

/** ¿Este teléfono participa en la prueba? */
const esPruebas = telefono => Object.prototype.hasOwnProperty.call(PRUEBAS, tel9(telefono));
/** Nombre con el que saludar (el configurado en la lista de pruebas, si lo hay). */
const nombreDe = telefono => PRUEBAS[tel9(telefono)] || '';

// ── Libro de turnos ───────────────────────────────────────────────────────────

async function leerLibro() {
  await sheets.ensureSheet(ID_FICHAJE, HOJA);
  const filas = await sheets.readSheet(ID_FICHAJE, RANGO);
  if (!filas.length) {
    await sheets.writeSheetRaw(ID_FICHAJE, `${HOJA}!A1`, [CAB]);
    return [];
  }
  return filas.slice(1).map((r, i) => ({
    fila: i + 2,
    id: String(r[0] || ''), telefono: String(r[1] || ''), nombre: String(r[2] || ''),
    matricula: String(r[3] || ''), unitId: String(r[4] || ''), driverId: String(r[5] || ''),
    inicio: Number(r[6]) || 0, fin: Number(r[7]) || 0,
    km: r[8] === '' || r[8] == null ? null : Number(r[8]),
    trayectos: Number(r[9]) || 0, atribuidos: Number(r[10]) || 0,
    estado: String(r[11] || ''), notas: String(r[12] || ''), unitPrevia: String(r[13] || '')
  })).filter(t => t.id);
}

const aFila = t => [t.id, t.telefono, t.nombre, t.matricula, t.unitId, t.driverId,
  t.inicio || '', t.fin || '', t.km == null ? '' : t.km, t.trayectos || '', t.atribuidos || '',
  t.estado, t.notas || '', t.unitPrevia || ''];

async function guardarFila(t) {
  await sheets.writeSheetRaw(ID_FICHAJE, `${HOJA}!A${t.fila}:N${t.fila}`, [aFila(t)]);
}
async function añadirFila(t) {
  await sheets.appendRows(ID_FICHAJE, RANGO, [aFila(t)]);
}

/** Turno abierto de un teléfono (o null). */
const abiertoDe = (libro, telefono) =>
  libro.find(t => t.estado === 'abierto' && tel9(t.telefono) === tel9(telefono)) || null;
/** Turno abierto sobre una matrícula por OTRA persona (o null). */
const abiertoDeCoche = (libro, matricula, telefono) =>
  libro.find(t => t.estado === 'abierto' && normMat(t.matricula) === normMat(matricula)
    && tel9(t.telefono) !== tel9(telefono)) || null;

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
async function conductorMapon(nombre, telefono) {
  const nom = String(nombre || '').trim();
  if (!nom) return null;
  let lista = [];
  try { lista = await mapon.listarConductores(); } catch (e) { console.error('⚠️ [FICHAJE] driver/list:', e.message); }
  const clave = nom.toLowerCase();
  const encontrado = lista.find(d => `${d.name || ''} ${d.surname || ''}`.trim().toLowerCase() === clave);
  if (encontrado) return encontrado.id || encontrado.driver_id;

  const partes = nom.split(/\s+/);
  const id = await mapon.crearConductor({
    nombre: partes[0],
    apellidos: partes.slice(1).join(' ') || '-',
    telefono: telefono ? `+34${tel9(telefono)}` : undefined
  });
  console.log(`🆕 [FICHAJE] Conductor creado en Mapon: "${nom}" (id ${id})`);
  return id;
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
async function cerrarOlvidados(libro) {
  const limite = ahoraSeg() - MAX_HORAS_TURNO * 3600;
  for (const t of libro.filter(x => x.estado === 'abierto' && x.inicio && x.inicio < limite)) {
    try { await soltarEnMapon(t); } catch (e) { /* se cierra igual */ }
    // Se bloquea también en el cierre automático, PERO sin `porOrden`: aquí no ha
    // dicho nadie que haya terminado. Solo lo dice el reloj, y el reloj se
    // equivoca — un turno de 14 horas puede seguir en la calle con un cliente
    // dentro. Así que pasa por la regla estricta: quieto un buen rato, sin
    // contacto y con datos frescos. Si no se cumple, el turno se cierra igual y
    // el coche lo bloquea el repaso cuando de verdad esté parado.
    let mot = { hecho: false, motivo: 'no intentado' };
    try { mot = await bloquearMotor(t.unitId); } catch (e) { mot = { hecho: false, motivo: e.message }; }
    t.fin = t.inicio + MAX_HORAS_TURNO * 3600;
    t.estado = 'auto-cerrado';
    t.notas = `Cerrado solo tras ${MAX_HORAS_TURNO} h sin terminar` +
      (BLOQUEO_ACTIVO && !mot.hecho ? ` · motor NO bloqueado: ${mot.motivo}` : '');
    await guardarFila(t);
    console.log(`⏱️ [FICHAJE] Turno de ${t.nombre} (${t.matricula}) auto-cerrado`);
  }
}

/** Estado actual: { abierto, turno } */
async function estado(telefono) {
  const libro = await leerLibro();
  await cerrarOlvidados(libro);
  const t = abiertoDe(libro, telefono);
  return { abierto: !!t, turno: t };
}

/**
 * Abre turno: resuelve la matrícula en Mapon, comprueba que nadie más la tenga,
 * asigna el conductor en Mapon y apunta el turno en el libro.
 */
async function iniciar({ telefono, nombre, matricula }) {
  const libro = await leerLibro();
  await cerrarOlvidados(libro);

  const yaAbierto = abiertoDe(libro, telefono);
  if (yaAbierto) {
    return { ok: false, motivo: 'ya-abierto', turno: yaAbierto };
  }
  const unidad = await mapon.unidadPorMatricula(matricula);
  if (!unidad) return { ok: false, motivo: 'sin-matricula' };

  const ocupado = abiertoDeCoche(libro, unidad.matricula, telefono);
  if (ocupado) return { ok: false, motivo: 'coche-ocupado', turno: ocupado };

  // El enlace en Mapon no debe impedir fichar: si falla, el turno se abre igual y se
  // anota — la prueba de quién llevaba el coche es nuestro libro, no Mapon.
  // OJO: driver/update con `unit` MUEVE al conductor de coche. Si ya tenía uno puesto
  // (caso normal si es un conductor real que ya existía en Mapon), se apunta cuál era
  // para devolvérselo al terminar y no dejarle la ficha tocada.
  let driverId = '', notas = '', unitPrevia = '', errorMapon = '';
  try {
    driverId = await conductorMapon(nombre, telefono);
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

  const turno = {
    id: `${tel9(telefono)}-${ahoraSeg()}`, telefono: tel9(telefono), nombre,
    matricula: unidad.matricula, unitId: String(unidad.unitId), driverId: String(driverId || ''),
    inicio: ahoraSeg(), fin: 0, km: null, trayectos: 0, atribuidos: 0, estado: 'abierto', notas, unitPrevia
  };
  await añadirFila(turno);
  // Con el turno YA registrado se libera el motor: si algo fallara, el turno consta
  // igual y el coche se puede desbloquear a mano desde el panel.
  const mot = await liberarMotor(unidad.unitId);
  console.log(`🟢 [FICHAJE] ${nombre} inicia turno en ${unidad.matricula} (unit ${unidad.unitId})` +
    (BLOQUEO_ACTIVO ? ` · motor ${mot.hecho ? 'LIBRE' : 'NO liberado: ' + mot.motivo}` : ''));
  return { ok: true, turno, vehiculo: unidad.vehiculo, enlazado: !!driverId, errorMapon, motor: mot, bloqueoActivo: BLOQUEO_ACTIVO };
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
  const libro = await leerLibro();
  await cerrarOlvidados(libro);
  const t = abiertoDe(libro, telefono);
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
  if (BLOQUEO_ACTIVO) {
    const m = await estadoMotor(t.unitId);
    if (m.sabemos && m.enMarcha) {
      return { ok: false, motivo: 'coche-en-marcha', velocidad: m.velocidad, turno: t };
    }
  }

  const fin = ahoraSeg();
  const km = await kmDelTurno(t, fin);
  try { await soltarEnMapon(t); }
  catch (e) { t.notas = `${t.notas ? t.notas + ' · ' : ''}Mapon no soltó el coche: ${e.message}`; }

  // Al cerrar, el coche queda bloqueado hasta que alguien vuelva a fichar en él.
  //
  // `porOrden`: lo ha pedido el conductor, así que basta con que no esté rodando.
  // No hace falta esperar a que lleve veinte minutos quieto — acaba de decir que
  // ha terminado, y eso es mejor información que cualquier sensor.
  const mot = await bloquearMotor(t.unitId, { porOrden: true });
  if (BLOQUEO_ACTIVO && !mot.hecho) t.notas = `${t.notas ? t.notas + ' · ' : ''}Motor NO bloqueado: ${mot.motivo}`;

  t.fin = fin;
  t.km = km ? km.km : null;
  t.trayectos = km ? km.trayectos : 0;
  t.atribuidos = km ? km.conConductor : 0;
  t.estado = 'cerrado';
  await guardarFila(t);
  console.log(`🔴 [FICHAJE] ${t.nombre} termina turno en ${t.matricula}: ${t.km} km` +
    (BLOQUEO_ACTIVO ? ` · motor ${mot.hecho ? 'BLOQUEADO' : 'NO bloqueado: ' + mot.motivo}` : ''));
  return { ok: true, turno: t, km, motor: mot, bloqueoActivo: BLOQUEO_ACTIVO };
}

// ── El repaso ─────────────────────────────────────────────────────────────────

/**
 * Deja bloqueado todo coche que nadie esté usando.
 *
 * Sin esto el control tiene dos agujeros, y los dos dejan un coche libre para
 * siempre sin que nadie se entere:
 *
 *   · El bloqueo al terminar turno FALLA a veces —el coche estaba rodando, o sin
 *     cobertura— y no hay quien lo reintente.
 *   · Un coche que nunca ha tenido un turno no se bloquea nunca.
 *
 * El repaso los cierra: mira la flota entera, se queda con los que tienen el
 * motor libre y NO tienen turno abierto, y bloquea los que de verdad llevan
 * parados. Los que no cumplen la regla se dejan para la vuelta siguiente — no
 * hay prisa, y equivocarse aquí es dejar tirado a alguien.
 *
 * Es idempotente: pasarlo dos veces seguidas no hace nada la segunda.
 */
async function repasarBloqueos({ soloMirar = false } = {}) {
  if (!BLOQUEO_ACTIVO && !soloMirar) {
    return { activo: false, motivo: 'FICHAJE_BLOQUEO_MOTOR no está a 1', bloqueados: [], omitidos: [] };
  }
  const libro = await leerLibro();
  const conTurno = new Set(libro.filter(t => t.estado === 'abierto').map(t => String(t.unitId)));

  // HASTA DÓNDE LLEGA EL REPASO.
  //
  // Solo los coches que han pasado por el fichaje, y al fichaje solo llegan los
  // teléfonos autorizados. Así el aislamiento por número alcanza también al
  // cron, sin tener que apuntar matrículas: coges el coche que quieras, fichas
  // en él, y desde ese momento entra.
  //
  // Sin esto el cron miraría la flota entera y bloquearía coches de gente que ni
  // sabe que esto existe, con la llave en la mano.
  const conocidos = new Set(libro.map(t => String(t.unitId)).filter(Boolean));
  const alcanza = v => TODA_LA_FLOTA
    || conocidos.has(String(v.unitId))
    || MATRICULAS.includes(normMat(v.matricula));

  const flota = await mapon.relesDeFlota();
  const bloqueados = [], omitidos = [], fallidos = [];

  for (const v of (flota.vehiculos || [])) {
    if (!alcanza(v)) continue;
    const rele = (v.reles || []).find(r => r.tipo === 'engine_block' && r.habilitado);
    if (!rele) continue;
    // Ya está bloqueado: nada que hacer.
    if (Number(rele.activo) === RELE_BLOQUEADO) continue;
    // Alguien lo está usando y lo ha dicho. Se respeta.
    if (conTurno.has(String(v.unitId))) {
      omitidos.push({ matricula: v.matricula, motivo: 'turno abierto' });
      continue;
    }

    const info = await mapon.relesDeUnidad(v.unitId).catch(() => null);
    const no = puedeInmovilizar(info, { porOrden: false });
    if (no) { omitidos.push({ matricula: v.matricula, motivo: no }); continue; }
    if (soloMirar) { bloqueados.push({ matricula: v.matricula, simulado: true }); continue; }

    const r = await motor(v.unitId, true, { porOrden: false });
    if (r.hecho) bloqueados.push({ matricula: v.matricula, unitId: v.unitId });
    else fallidos.push({ matricula: v.matricula, motivo: r.motivo });
  }

  if (bloqueados.length || fallidos.length) {
    console.log(`🔒 [FICHAJE] Repaso: ${bloqueados.length} bloqueado(s)` +
      (fallidos.length ? `, ${fallidos.length} sin poder` : '') +
      (omitidos.length ? `, ${omitidos.length} en uso` : ''));
  }
  return { activo: BLOQUEO_ACTIVO, soloMirar, bloqueados, omitidos, fallidos };
}

module.exports = {
  esPruebas, nombreDe, estado, iniciar, terminar, kmDelTurno,
  liberarMotor, bloquearMotor, estadoMotor, puedeInmovilizar, repasarBloqueos,
  horaES, duracion, MAX_HORAS_TURNO, BLOQUEO_ACTIVO, MIN_PARADO,
  MATRICULAS, TODA_LA_FLOTA
};
