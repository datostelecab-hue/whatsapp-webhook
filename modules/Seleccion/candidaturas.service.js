// ============================================================
// CANDIDATURAS — lo que el embudo hace con la persona
// ============================================================
// El embudo es de Selección y la persona es de Conductores. Hasta el 01/10/2026
// las dos cosas vivían en `candidaturas.repo.js`, que para escribir la ficha
// entraba en el repositorio de Conductores por la puerta de atrás (el puente
// `services/repo/conductores`). Un repositorio no coordina módulos, así que lo
// que coordina vive aquí y entra por las puertas: `Conductores/conductores.service`
// para la persona y `Documentos/documentos.service` para sus papeles.
//
// LA REGLA DEL MÓDULO no cambia: en la candidatura solo vive el PROCESO. Cuando
// llega un dato de la persona, se guarda donde le toca —no se copia—. Por eso
// `guardar()` reparte: lo que es un campo de `conductor` va por
// `conductores.actualizar`, y solo lo que es del embudo se escribe en la
// candidatura.
//
// El SQL no se ha movido: está en el repositorio, en funciones pequeñas con el
// mismo texto que tenía. Lo demás que se exporta aquí —listar, descartar, las
// tablas de la ETT, el tramo final— es del repositorio tal cual, y se reexporta
// para que Selección y la ETT tengan una sola puerta.

const repo = require('./candidaturas.repo');
const conductores = require('../Conductores/conductores.service');   // la puerta de Conductores
const docs = require('../Documentos/documentos.service');
const alta = require('../../services/repo/alta');

/** Los catálogos que la pantalla necesita para pintar sus desplegables. */
async function catalogos() {
  const { estados, etapas, canales, turnos, zonas, jornadas, motivos } = await repo.catalogosBase();
  // Los campos que la pantalla puede editar, con su etiqueta y su tipo. Salen de
  // aqui y no de una lista escrita en la vista: son los mismos que valida
  // `guardar`, asi que no pueden discrepar.
  const campos = [];
  const PERSONA = ['nombre', 'apellidos', 'dni_nie', 'fecha_nacimiento', 'sexo',
    'estado_civil', 'nacionalidad', 'email', 'tel_emergencia', 'centro_codigo',
    'via_tipo', 'via_nombre', 'via_numero', 'escalera', 'piso', 'puerta',
    'codigo_postal', 'localidad', 'provincia', 'observaciones'];
  for (const k of PERSONA) {
    const def = conductores.CAMPOS[k];
    if (def) campos.push({ id: k, grupo: def.grupo || 'Persona', ...def });
    // LAS FECHAS DEL CARNE, justo detras del estado civil: es el hueco que deja
    // la lista del sexo a su lado, y ahi las pidio Camilo el 24/09/2026. La
    // ficha de alta las exige y no habia donde escribirlas: se veia el aviso
    // "falta Fecha de expedicion del carne" sin forma de arreglarlo.
    //
    // No son columnas de la persona: son las fechas del DOCUMENTO del permiso
    // (tabla documento, tipo 'permiso'). Por eso no estan en CAMPOS y las
    // guarda el servicio, por la puerta de Documentos.
    if (k === 'estado_civil') {
      campos.push({ id: 'carnet_expedicion', grupo: def ? def.grupo : 'Identidad',
                    etiqueta: 'Fecha de expedición del carné', tipo: 'fecha' });
      campos.push({ id: 'carnet_caducidad', grupo: def ? def.grupo : 'Identidad',
                    etiqueta: 'Fecha de caducidad del carné', tipo: 'fecha' });
    }
  }
  // Los que se escriben de una pieza y la base guarda despiezados. No estan en
  // CAMPOS porque no son columnas: son la forma en que los teclea una persona.
  campos.push({ id: 'naf', grupo: 'Seguridad Social', etiqueta: 'Nº Seguridad Social',
                ayuda: 'Los doce dígitos, con separadores o sin ellos' });
  campos.push({ id: 'iban', grupo: 'Seguridad Social', etiqueta: 'IBAN / nº de cuenta',
                ayuda: 'Se guarda cifrado. Si se deja vacío, no se toca el que hubiera' });
  campos.push({ id: 'coordenadas', grupo: 'Dirección', etiqueta: 'Coordenadas',
                ayuda: 'lat, lng — se obtienen del botón de geocodificar' });
  for (const [id, def] of Object.entries(repo.CAMPOS)) {
    campos.push({ id, grupo: 'Proceso', ...def });
  }

  return {
    estados, etapas, canales,
    turnos,
    jornadas, zonas, motivos, campos,
    // El recorrido de Selección, en orden. La pantalla pinta los pasos con esto
    // en vez de llevar su propia lista, que es como se desincronizan.
    funnel: estados.filter(e => e.en_funnel).map(e => e.codigo),
  };
}

/** Una candidatura por su id, con la persona resuelta. */
async function ficha(id) {
  const c = await repo.filaFicha(id);
  if (!c) return null;
  // Los documentos son de la persona, no del proceso: se leen de su módulo.
  return { ...c, documentos: await docs.listar('conductor', c.conductor_id) };
}

/**
 * Rellena de una ficha SOLO lo que está vacío.
 *
 * Antes, cuando la persona ya existía, todo lo que traía la fila —DNI, correo,
 * dirección, fecha de nacimiento— se perdía sin decir nada: aparecía en la lista
 * con las casillas en blanco y sin explicar por qué.
 *
 * Se rellena, no se pisa. Lo que trae la agencia es información nueva donde no
 * teníamos nada; no es autoridad para reemplazar lo que alguien ya escribió a
 * mano, que casi siempre estará mejor comprobado.
 */
async function rellenarHuecos(conductorId, datos, quien) {
  const actual = await repo.personaCruda(conductorId);
  if (!actual) return {};

  const huecos = {};
  for (const [k, v] of Object.entries({ ...datos, ...despiezar(datos) })) {
    if (!conductores.CAMPOS[k] || v === '' || v === null || v === undefined) continue;
    const tiene = actual[k];
    if (tiene === null || tiene === undefined || String(tiene).trim() === '') huecos[k] = v;
  }
  if (Object.keys(huecos).length) await conductores.actualizar(conductorId, huecos, quien);
  return huecos;
}

/**
 * Abre una candidatura: crea a la persona si no la conocíamos y le arranca el
 * proceso en Preselección.
 *
 * Si ya tenemos ficha suya NO se crea otra — se le abre el proceso sobre la que
 * hay. Es el caso de quien ya trabajó aquí y vuelve a presentarse, y en la hoja
 * acababa siendo una segunda ficha con el mismo DNI.
 */
async function abrir(telefono, datos = {}, quien = {}) {
  const { situacion, candidatura } = await repo.porTelefono(telefono);

  // Ya hay un proceso vivo con ese número. No se abre otro, pero SÍ se aprovecha
  // lo que venga: la agencia manda una fila más completa a la semana siguiente, y
  // repegar la tabla tiene que servir para algo más que decir "ya estaba".
  if (candidatura) {
    await rellenarHuecos(candidatura.conductor_id, datos, quien);
    return { id: candidatura.id, conductorId: candidatura.conductor_id, yaExistia: true };
  }

  let conductorId = situacion.ficha ? situacion.ficha.id : null;
  if (!conductorId) {
    const entero = String(datos.nombre || situacion.nombreSugerido || '').trim();
    if (!entero) throw new Error('Falta el nombre para abrir la candidatura');
    // Si vienen los apellidos aparte, se respetan. Si no y el nombre lleva coma
    // —"Bedoya Corrales, Andres Camilo", que es como lo escriben la gestoria y
    // la ETT—, se parte. Sin coma va entero al nombre: partir "Andres Camilo
    // Bedoya Corrales" por el primer espacio acierta a veces y falla siempre que
    // hay un nombre compuesto.
    const partes = String(datos.apellidos || '').trim()
      ? { nombre: entero, apellidos: String(datos.apellidos).trim() }
      : alta.partirNombre(entero);
    const r = await conductores.crearPersona({ ...datos, ...partes, telefono }, quien);
    conductorId = r.id;
  } else {
    await rellenarHuecos(conductorId, datos, quien);
  }

  const id = await repo.insertarPreseleccion(conductorId, datos);
  return { id, conductorId, yaExistia: false, situacion };
}

/**
 * La candidatura de quien YA ESTA CONTRATADO, abierta al final del proceso.
 *
 * El alta rapida de la ETT crea la ficha y abre el contrato sin pasar por
 * seleccion: dos campos y a trabajar. Pero la pantalla de la ETT y el Excel que
 * se le manda a la agencia leen CANDIDATURAS, asi que quien entra por esa puerta
 * no existe para la agencia — y es justo a quien hay que facturarle.
 *
 * Por eso aqui no se abre un proceso: se abre YA TERMINADO. Mismo estado en el
 * que lo deja `pasarARRHH` (`listo_rrhh`, que es "contratado, papeles en RRHH")
 * y con la fecha de alta escrita, que es lo que hace que el Excel diga
 * «Contratado» en vez de «Pendiente» (ver `mapearParaETT`).
 *
 * Si ya tenia una candidatura viva no se abre otra: se le completa lo que le
 * falte. Dos candidaturas de la misma persona son dos filas en el Excel de la
 * agencia, y la agencia cobra por fila.
 */
async function abrirContratada(conductorId, datos = {}, quien = {}) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');

  const viva = await repo.vivaDe(id);

  if (viva) {
    // LA QUE YA EXISTE SE ADELANTA HASTA EL FINAL (ver `adelantarAListo` en el
    // repositorio: solo hacia adelante, y nunca pisa una salida).
    const adelantada = await repo.adelantarAListo(Number(viva.id), datos.alta);
    if (!adelantada && datos.alta && !viva.inicio_previsto) {
      // No se ha movido de estado (ya estaba al final, o es una salida), pero la
      // fecha de alta si le falta y sin ella el Excel la cuenta como "sin decidir".
      await guardar(Number(viva.id), { inicio_previsto: datos.alta }, quien);
    }
    return { id: Number(viva.id), conductorId: id, yaExistia: true, adelantada };
  }

  // `soloSiExiste`: al dar de alta desde la ficha no se inventa un candidato.
  // Quien no traia proceso —una alta de plantilla propia, un traspaso— no tiene
  // por que aparecer en la bolsa de la agencia.
  if (datos.soloSiExiste) return { id: null, conductorId: id, yaExistia: false, creada: false };

  const nueva = await repo.insertarContratada(id, datos);
  return { id: Number(nueva), conductorId: id, yaExistia: false };
}

/**
 * Convierte lo que se escribe de una pieza en lo que la base guarda separado.
 *
 * Tres casos, y los tres por la misma razon: la gestoria pide la direccion
 * despiezada y el NAF en tres trozos, pero nadie los teclea asi. Y las
 * coordenadas se pegan como "lat, lng" porque es como las da un mapa.
 *
 * Lo que no venga, no se toca: devolver un objeto solo con lo que ha llegado
 * evita borrar la mitad de una direccion al guardar la otra mitad.
 */
function despiezar(datos) {
  const fuera = {};

  // "28/1234567/89", "28 1234567 89" o los doce digitos seguidos.
  const naf = datos.naf || datos.num_seg_social;
  if (naf !== undefined) {
    const n = String(naf || '').replace(/[^0-9]/g, '');
    if (n.length >= 8) {
      fuera.naf_provincia = n.slice(0, 2);
      fuera.naf_numero = n.slice(2, -2);
      fuera.naf_control = n.slice(-2);
    }
  }

  // "40.23578, -3.76983". Fuera de España se descarta: una coma mal puesta manda
  // a alguien al Atlantico, y esto lo usa el planificador para las recogidas.
  if (datos.coordenadas !== undefined) {
    const m = String(datos.coordenadas || '').match(/^\s*(-?\d+[.,]?\d*)\s*,\s*(-?\d+[.,]?\d*)\s*$/);
    if (m) {
      const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
      if (isFinite(lat) && isFinite(lng) && lat >= 27 && lat <= 44 && lng >= -19 && lng <= 5) {
        fuera.lat = lat; fuera.lng = lng;
      }
    } else if (!String(datos.coordenadas || '').trim()) {
      fuera.lat = null; fuera.lng = null;
    }
  }

  // Una direccion pegada entera, cuando no vienen las partes por separado. Va
  // al nombre de la via: partirla a ojo inventaria portales y pisos.
  if (datos.direccion !== undefined && datos.via_nombre === undefined) {
    fuera.via_nombre = String(datos.direccion || '').slice(0, 120) || null;
  }

  return fuera;
}

/**
 * Guarda lo que venga, mandando cada dato a su tabla.
 *
 * Este reparto es el módulo entero en una función: los campos de la persona
 * a `conductor`, los del proceso a `candidatura`. Sin él volveríamos a tener
 * dos copias del nombre y del DNI, que es de lo que veníamos huyendo.
 */
async function guardar(id, datos = {}, quien = {}) {
  const c = await repo.conductorDe(id);
  if (!c) throw new Error('No existe esa candidatura');

  // Lo que una persona teclea de una pieza y la base guarda despiezado. Se
  // normaliza AQUI y no en la pantalla: si lo hiciera la pantalla, cada
  // formulario que quisiera guardar una direccion tendria que repetirlo.
  const d = { ...datos, ...despiezar(datos) };

  const dePersona = {}, deProceso = {};
  for (const [k, v] of Object.entries(d)) {
    if (conductores.CAMPOS[k]) dePersona[k] = v;
    else if (repo.CAMPOS[k]) deProceso[k] = v;
  }

  if (Object.keys(dePersona).length) await conductores.actualizar(c.conductor_id, dePersona, quien);

  if (Object.keys(deProceso).length) await repo.guardarProceso(id, deProceso);

  // LA VACANTE SE RESERVA AL ENGANCHARLA, Y SE SUELTA AL SOLTARLA.
  //
  // Una vacante con candidato deja de ofrecerse: si no, dos reclutadores
  // trabajan la misma plaza y el segundo se entera el día del alta. Y si a este
  // candidato se le quita, vuelve a estar disponible — a esa vacante nunca
  // llegó a entrar nadie.
  if (deProceso.vacante_id !== undefined) await repo.engancharVacante(Number(id), deProceso.vacante_id, quien);

  // El teléfono no es un campo de la ficha: tiene su propia tabla y su propia
  // vigencia, así que va por su función.
  if (datos.telefono) await conductores.guardarTelefono(c.conductor_id, datos.telefono, quien);

  // El IBAN va CIFRADO. En la hoja viajaba en claro, a la vista de cualquiera
  // con acceso al documento; aquí se guarda cifrado y no se devuelve nunca en
  // los listados. Si no hay clave configurada se avisa y no se guarda, en vez
  // de escribirlo en claro «de momento».
  // La regla es la de Conductores (`guardarIban`), la misma que usa Plantilla.
  if (datos.iban !== undefined) await conductores.guardarIban(c.conductor_id, datos.iban, quien);

  return { id: Number(id), conductorId: c.conductor_id };
}

/**
 * Selección termina: la persona pasa a RRHH con su contrato abierto.
 *
 * Aquí se ve lo que gana el modelo nuevo. En la hoja esto era "convertir un
 * ticket de 60 columnas en una ficha"; aquí la ficha ya existe desde
 * Preselección y lo único que falta es abrirle el periodo de empleo.
 */
async function pasarARRHH(id, contrato = {}, quien = {}) {
  const c = await repo.paraContratar(id);
  if (!c) throw new Error('No existe esa candidatura');
  if (c.empleo_vigente) throw new Error(`${c.quien} ya tiene un contrato abierto`);

  // LO QUE SE DECIDE AL CONTRATAR SE GUARDA ANTES DE ABRIR NADA.
  //
  // Contratar es el momento en que se deciden fecha, jornada, turno y zona, asi
  // que se decide y se escribe aqui mismo. Antes habia que pasar por otro boton
  // a rellenarlo y luego volver a este, y lo que pasaba de verdad es que la
  // gente contrataba sin turno: la persona llegaba al planificador sin poder
  // colocarse, con el dato en la cabeza de quien la entrevisto.
  //
  // Se escribe en la candidatura y no solo en el contrato porque es SU decision:
  // queda dicha aunque el alta falle mas adelante.
  const decidido = {};
  if (contrato.alta) decidido.inicio_previsto = contrato.alta;
  if (contrato.jornadaHoras) decidido.jornada_horas = contrato.jornadaHoras;
  if (contrato.turnoId) decidido.turno_id = contrato.turnoId;
  if (contrato.zonaId) decidido.base_zona_id = contrato.zonaId;
  if (Object.keys(decidido).length) await guardar(id, decidido, quien);

  // Lo pactado durante la seleccion vale como contrato, salvo que al pasar a
  // RRHH se diga otra cosa. Asi no hay que reescribir lo que ya se acordo.
  const k = (await repo.pactado(id)) || {};
  contrato = {
    alta: contrato.alta || (k.inicio_previsto ? String(k.inicio_previsto).slice(0, 10) : null),
    jornadaHoras: contrato.jornadaHoras || k.jornada_horas || null,
    tipo: contrato.tipo || (/ETT/i.test(k.tipo_contrato || '') ? 'ett' : 'propia'),
    ettNombre: contrato.ettNombre,
    finPrueba: contrato.finPrueba,
  };
  if (!contrato.alta) throw new Error('Falta la fecha de inicio del contrato');

  const faltan = await repo.faltantes(Number(id), contrato.tipo);
  if (faltan.length) throw new Error('Antes de pasar a RRHH faltan datos: ' + faltan.join(', '));

  await conductores.darDeAlta(c.conductor_id, {
    tipo: contrato.tipo === 'ett' ? 'ett' : 'propia',
    ettNombre: contrato.ettNombre,
    alta: contrato.alta,
    jornadaHoras: contrato.jornadaHoras,
    finPrueba: contrato.finPrueba,
  }, quien);

  // EL TURNO TIENE QUE VIAJAR CON LA PERSONA.
  //
  // Se decide en Selección —viene hasta en la tabla de la agencia— pero vivía
  // solo en la candidatura. El planificador no la mira: mira el historial de
  // turnos del conductor, y sin turno nadie es planificable
  // (`listoParaPlanificar = idBolt && turno`).
  //
  // Así que la persona llegaba al planificador sin turno y no se podía colocar,
  // con el dato escrito dos pantallas atrás.
  //
  // Desde la fecha de alta, no desde hoy: su turno empieza cuando empieza él.
  if (k.turno_id) {
    try {
      await conductores.cambiarTurno(c.conductor_id, { turnoId: k.turno_id, desde: contrato.alta }, quien);
    } catch (e) {
      console.error(`⚠️  [CANDIDATURA] turno no aplicado a ${c.quien}: ${e.message}`);
    }
  }

  // QUEDA DADO DE ALTA, NO «ESPERANDO A RRHH» (18/09/2026).
  //
  // El recorrido tenía dos paradas más —«Listo para RRHH» y «Pendiente de alta
  // en Ballenoil»— y ninguna de las dos hacía nada que no estuviera ya hecho
  // aquí: el contrato está abierto, el turno puesto y la cuenta de BOLT
  // enlazada. Lo que le falta a esta persona no es papeleo nuestro, es un coche
  // en el cuadrante, y de eso avisa la incorporación que nace abajo.
  //
  // Las 32 fichas que estaban en «Listo para RRHH» el día del cambio se quedan
  // donde están: su bandeja sigue funcionando hasta que se vacíe sola.
  await repo.marcarDadoDeAlta(id);

  // ENLACE AUTOMÁTICO A BOLT por teléfono — mismo criterio que
  // `conductores.realizarAlta`: si existe una cuenta de BOLT con ese número y no
  // es de nadie, se enlaza SOLA, INCLUIDAS las desactivadas (se enlazan igual y
  // se avisa de que hay que reactivarlas). Antes esto quedaba como sugerencia de
  // 1 clic; ahora es automático.
  let boltEnlazada = false, boltEstado = null, boltAvisos = [];
  try {
    const info = c.telefono ? await alta.porTelefono(c.telefono) : null;
    if (info && info.bolt) {
      boltEstado = info.bolt.estado;          // 'active' / 'deactivated' / …
      boltAvisos = info.avisos || [];
      // No es de nadie → se enlaza (aunque esté desactivada). Si ya es de otro, el
      // aviso de porTelefono lo dice y NO se pisa el enlace ajeno.
      if (!info.bolt.enlazadaCon) {
        await conductores.enlazarBolt(c.conductor_id, info.bolt.cuentaId, quien);
        boltEnlazada = true;
      }
    }
  } catch (e) {
    console.error(`⚠️  [CANDIDATURA] auto-enlace BOLT de ${c.quien}: ${e.message}`);
  }

  // Sin cuenta de BOLT no puede conducir. Se devuelve para decirlo ahora y no
  // el día que tiene que salir.
  const sb = await repo.situacionBolt(c.conductor_id);

  // LA VACANTE TIENE QUE LLEGAR AL PLANIFICADOR.
  //
  // Contratar a alguien para una vacante y que Tráfico no se entere es el
  // agujero que quedaba: la alerta de incorporación solo nacía por la vía de la
  // ETT, así que a quien venía por Selección se le abría el contrato y su plaza
  // seguía figurando vacía. Alguien tenía que acordarse de colocarlo, mirando
  // una pantalla distinta.
  //
  // Ahora nace aquí también, con la foto de las plazas prometidas y la fecha de
  // alta: en el planificador sale "entra Fulano el día X" antes de que llegue, y
  // si era un RECAMBIO, sale al lado de quien se va.
  // Y SIN VACANTE TAMBIÉN AVISA. Quien entra sin plaza prometida necesita una
  // igual; la alerta se queda en el planificador hasta que alguien le dé una.
  let incorporacion = null, avisoVacante = null;
  const vref = await repo.vacanteRefDe(id);
  try {
    incorporacion = await require('./incorporaciones.repo').crear({
      conductorId: c.conductor_id, vacanteId: vref || null, origen: 'seleccion',
      desde: contrato.alta, usuarioId: quien.usuarioId,
    });
    if (incorporacion) {
      console.log(`🔔 [CANDIDATURA] Incorporación ${incorporacion.id} · ${c.quien} → ` +
        (vref ? `${vref} (${incorporacion.plazas} plaza(s), desde ${contrato.alta})`
              : `sin vacante, desde ${contrato.alta}`));
    }
  } catch (e) {
    avisoVacante = vref
      ? `El alta salió bien, pero la vacante ${vref} no se pudo reservar: ${e.message}`
      : `El alta salió bien, pero no se pudo avisar al planificador: ${e.message}`;
    console.error(`⚠️  [CANDIDATURA] ${avisoVacante}`);
  }

  return {
    id: Number(id), conductorId: c.conductor_id, quien: c.quien,
    bolt: sb || null,
    // Dónde y cuándo cae en el planificador. Es lo que Selección tiene que poder
    // contestar sin llamar a Tráfico.
    vacante: vref || null,
    incorporacion: incorporacion ? {
      id: incorporacion.id, plazas: incorporacion.plazas,
      puesto: (incorporacion.detalle || {}).puesto || '',
      matriculas: ((incorporacion.detalle || {}).plazas || []).map(x => x.matricula).join(' · '),
      libranzas: (incorporacion.detalle || {}).libranzas || '',
      sustituye: (incorporacion.detalle || {}).sustituye || '',
      desde: contrato.alta,
    } : null,
    avisoVacante,
    // Resultado del auto-enlace: si se enganchó, en qué estado está la cuenta, y los
    // avisos (p.ej. "está desactivada, reactívala en BOLT").
    boltEnlazada, boltEstado, boltAvisos,
    boltReactivar: boltEstado != null && boltEstado !== 'active',
    faltaBolt: !sb || sb.situacion_bolt === 'no_esta_en_bolt',
  };
}

// ── La matriz que manda la ETT ──────────────────────────────────────────────
// Cómo se lee la tabla pegada (columnas, teléfono como clave) está en
// `parsearMatriz`, en el repositorio: es leer texto, no coordinar a nadie.

const horasDe = v => { const m = String(v == null ? '' : v).match(/(\d{1,2})/); return m ? Number(m[1]) : null; };

/**
 * Crea las candidaturas de una matriz pegada, y DICE qué ha pasado con cada una.
 *
 * Contar "creados y ya estaban" no basta. Lo que de verdad interesa de una tabla
 * de la agencia es a quién de esa lista YA CONOCEMOS, y por qué: gente que ya
 * pasó por aquí, o —lo importante— gente que ya está trabajando con nosotros.
 * Eso solo se puede saber teniendo una base con el DNI y el teléfono de todos, y
 * si se sabe hay que decirlo.
 *
 * Se busca por TELÉFONO y por DNI. Por los dos, porque la agencia manda a veces
 * a alguien con un número nuevo: sin mirar el DNI, esa fila reventaba con un
 * error de clave duplicada en vez de decir de quién se trata.
 *
 * Idempotente: repegar la tabla no duplica a nadie, y de paso rellena los huecos
 * de quien ya estaba.
 */
async function importarMatriz(texto, quien = {}, { solicitudId, referencia, recibida } = {}) {
  const filas = repo.parsearMatriz(texto);
  if (!filas.length) {
    throw new Error('No he reconocido ninguna fila. Copia la tabla del correo con sus columnas, ' +
                    'incluyendo la del teléfono.');
  }

  const [{ turnos, zonas }, ] = await Promise.all([catalogos()]);
  const sinTildes = s => String(s == null ? '' : s).normalize('NFD')
    .replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const turnoDe = v => (turnos.find(x => sinTildes(x.etiqueta) === sinTildes(v)
    || sinTildes(x.codigo) === sinTildes(v)) || {}).id || null;
  const zonaDe = v => (zonas.find(x => sinTildes(x.nombre) === sinTildes(v)) || {}).id || null;

  // Lo que la agencia da de cada persona. Se arma una vez y se usa en los dos
  // caminos: al crear la candidatura y al rellenar huecos de una que ya existe.
  const dePersona = f => ({
    dni_nie: f.dni || undefined,
    email: f.correo || undefined,
    via_nombre: f.direccion || undefined,
    codigo_postal: f.cp || f.cpDeDireccion || undefined,
    fecha_nacimiento: f.nacimiento || undefined,
  });

  // LA SOLICITUD. Una tabla pegada es una solicitud, y esa es la unidad con la
  // que se le responde a la agencia. Si se pasa un `solicitudId` se añade a una
  // que ya existe —la agencia reenvía la misma tabla ampliada—; si no, se abre
  // una nueva.
  let solicitud = Number(solicitudId) || null;
  if (!solicitud) solicitud = await repo.abrirSolicitud(recibida, referencia, quien.usuarioId);

  const detalle = [];
  const anota = (f, que, nota) => detalle.push({
    nombre: f.nombre || '(sin nombre)', telefono: f.telefono, dni: f.dni || null, que, nota: nota || null,
  });

  for (const f of filas) {
    try {
      const { situacion, candidatura } = await repo.porTelefono(f.telefono);
      // ¿Conocemos a esta persona? Por el DNI, aunque venga con otro número.
      const porElDni = situacion.ficha ? null : await repo.personaPorDni(f.dni);
      const conocida = situacion.ficha || porElDni;

      // ── Ya trabaja aquí ──
      // Es el aviso que importa. La agencia lo manda como candidato nuevo y
      // resulta que es alguien de la plantilla. No se abre nada.
      if (conocida && (conocida.empleoVigente || conocida.empleo_vigente)) {
        anota(f, 'ya_trabaja',
          `${conocida.quien} ya tiene contrato abierto con nosotros` +
          (porElDni ? ` (le hemos reconocido por el DNI; su número aquí es ${porElDni.telefono || 'otro'})` : ''));
        continue;
      }

      // ── Ya tiene un proceso vivo ──
      // No se abre otro, pero se aprovecha la fila: la agencia manda una versión
      // más completa a la semana siguiente, y repegar la tabla tiene que servir
      // para algo más que decir "ya estaba".
      if (candidatura) {
        // Aunque ya estuviera, se le ata a esta solicitud si no tenía ninguna:
        // así una tabla reenviada no deja filas huérfanas.
        await repo.atarASolicitud(candidatura.id, solicitud);
        const puestos = await rellenarHuecos(candidatura.conductor_id, dePersona(f), quien);
        const n = Object.keys(puestos).length;
        anota(f, 'ya_estaba', n ? `Ya estaba en el proceso. Se han rellenado ${n} dato(s) que faltaban.`
                                : 'Ya estaba en el proceso, sin nada nuevo que añadir.');
        continue;
      }

      // ── Esta misma cita ya se importó ──
      // `porTelefono` solo devuelve la candidatura VIVA, así que sin esto pasaba
      // lo siguiente: se pega la tabla, se descarta a alguien, se vuelve a pegar
      // —que es lo normal— y reaparecía con una candidatura nueva, dejando dos.
      //
      // Se compara por la CITA: si vuelve a presentarse dentro de unos meses la
      // fecha será otra, y entonces sí son dos procesos distintos y las dos son
      // historia legítima. Sin cita no se puede distinguir, y ante la duda no se
      // duplica.
      if (situacion.ficha) {
        if (await repo.yaImportada(situacion.ficha.id, f.entrevista)) {
          const puestos = await rellenarHuecos(situacion.ficha.id, dePersona(f), quien);
          const n = Object.keys(puestos).length;
          anota(f, 'ya_estaba', 'Esta entrevista ya se importó' +
            (n ? `. Se han rellenado ${n} dato(s) que faltaban.` : '.'));
          continue;
        }
      }

      // ── Le conocemos, pero no está en ningún proceso ──
      // Ya pasó por aquí antes. Se le abre uno nuevo sobre SU ficha, no otra.
      const vuelve = Boolean(conocida);

      const r = await abrir(porElDni ? porElDni.telefono || f.telefono : f.telefono, {
        nombre: f.nombre,
        canal: 'bolsa_ett',
        ...dePersona(f),
      }, quien);

      // El resto va en una segunda pasada: `abrir` crea a la persona y arranca
      // el proceso, y esto es lo que la agencia añade encima.
      await repo.completarDeMatriz(r.id, solicitud, {
        // Con cita puesta ya no esta en preseleccion: hay entrevista acordada.
        estado: f.noSePresento ? 'no_presentado' : (f.entrevista ? 'coord_entrevista' : 'preseleccion'),
        entrevista: f.entrevista, jornadaEtt: f.jornada_ett, turnoEtt: f.turno_ett,
        jornadaHoras: horasDe(f.jornada), turnoId: turnoDe(f.turno), zonaId: zonaDe(f.zona),
        inicioPrevisto: f.alta && /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}$/.test(f.alta)
          ? f.alta.split(/[\/\-.]/).reverse().join('-') : null,
      });

      anota(f, vuelve ? 'vuelve' : 'creada',
        vuelve ? `Ya teníamos ficha de ${conocida.quien}: no se ha creado otra, se le abre un proceso nuevo` +
                 (porElDni ? ' (reconocido por el DNI, viene con otro número)' : '')
               : null);
    } catch (e) {
      anota(f, 'error', String(e.message).split('\n')[0]);
    }
  }

  const cuantos = q => detalle.filter(d => d.que === q).length;
  return {
    solicitudId: solicitud,
    leidas: filas.length,
    creados: cuantos('creada'),
    vuelven: cuantos('vuelve'),
    yaEstaban: cuantos('ya_estaba'),
    yaTrabajan: cuantos('ya_trabaja'),
    errores: cuantos('error'),
    detalle,
    // Se mantiene para quien lo leía antes: los avisos son las filas que no
    // acabaron en una candidatura nueva.
    avisos: detalle.filter(d => d.que === 'error').map(d => `${d.nombre}: ${d.nota}`),
  };
}

/**
 * RRHH tramita: la ficha queda DE ALTA.
 *
 * NO da de alta a nadie en el sentido del contrato: eso ya lo hizo
 * `pasarARRHH`. Aquí solo se apuntan las fechas que decide RRHH y se cierra el
 * recorrido.
 *
 * Hasta el 24/09/2026 pasaba antes por «Pendiente de alta en Ballenoil», a
 * esperar que Administración le pusiera el PIN de la tarjeta de combustible.
 * Ballenoil ya no se usa —ahora es Petroprix, que no necesita nada de los
 * conductores—, así que esa parada sobraba. `asignado_at` lo ponía aquel paso;
 * ahora se pone aquí.
 */
async function tramitarAlta(id, { fechaAlta, fechaHabilitado } = {}, quien = {}) {
  const c = await repo.paraTramitar(id);
  if (!c) throw new Error('No existe esa candidatura');
  if (c.estado !== 'listo_rrhh') throw new Error('Esta ficha no está esperando a RRHH');
  if (!c.excel_alta) {
    throw new Error('Esta ficha aún no ha ido en ningún Excel de altas. ' +
      'Inclúyela primero en un Excel y luego tramítala.');
  }
  if (!await repo.tramitar(id, fechaAlta, fechaHabilitado)) {
    throw new Error('Alguien la tramitó mientras tanto: vuelve a cargar');
  }
  return ficha(id);
}

module.exports = {
  // Lo que coordina con Conductores y Documentos: vive aquí.
  catalogos, ficha, abrir, abrirContratada, guardar, pasarARRHH, importarMatriz, tramitarAlta,
  // Lo demás es del repositorio tal cual.
  CAMPOS: repo.CAMPOS,
  listar: (...a) => repo.listar(...a),
  porTelefono: (...a) => repo.porTelefono(...a),
  cambiarEstado: (...a) => repo.cambiarEstado(...a),
  descartar: (...a) => repo.descartar(...a),
  eliminar: (...a) => repo.eliminar(...a),
  faltantes: (...a) => repo.faltantes(...a),
  paraFicha: (...a) => repo.paraFicha(...a),
  paraFichaDeConductor: (...a) => repo.paraFichaDeConductor(...a),
  parsearMatriz: (...a) => repo.parsearMatriz(...a),
  paraETT: (...a) => repo.paraETT(...a),
  paraETTElegidos: (...a) => repo.paraETTElegidos(...a),
  solicitudesETT: (...a) => repo.solicitudesETT(...a),
  registrarEnvio: (...a) => repo.registrarEnvio(...a),
  // El tramo final: RRHH y Administración.
  tramoFinal: (...a) => repo.tramoFinal(...a),
  paraAltasExcel: (...a) => repo.paraAltasExcel(...a),
  marcarExcelAlta: (...a) => repo.marcarExcelAlta(...a),
};
