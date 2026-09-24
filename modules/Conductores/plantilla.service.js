// ============================================================
// PLANTILLA · SERVICIO — quién trabaja aquí, y en qué condiciones
// ============================================================
// La misma plantilla la miran dos áreas y buscan cosas distintas: Tráfico
// quiere saber quién puede conducir hoy, y RRHH quién está de alta y con qué
// contrato. Por eso la ficha no es una sola cosa sino dos —la administrativa,
// con sus historiales y sus acciones, y la de un vistazo— y por eso lo que se
// puede editar depende del rol de quien mira.
//
// Aquí vive lo que el controlador tenía dentro y no le tocaba: la lista con su
// resumen, los campos editables según el rol, el Excel de la gestoría y la
// orquestación de los papeles.

const con = require('./conductores.repo');
const ficha360 = require('./ficha360.repo');
const cazamiento = require('./cazamiento.repo');
const gestoria = require('./gestoria.excel');
// Por la PUERTA del módulo de Documentos, no por su repositorio: así el archivo
// puede cambiar por dentro (otro almacén, otro ámbito) sin tocar esta pantalla.
const docs = require('../Documentos/documentos.service');
const audit = require('../../services/repo/auditoria');
const alta = require('../../services/repo/alta');

// ── Lo que hace falta para pintar la pantalla ──────────────────────────────

/** Los catálogos al abrir. Si fallan, la plantilla se ve igual. */
async function paraLaPantalla() {
  const catalogos = await con.catalogos()
    .catch(e => { console.error('❌ [PLANTILLA] catálogos:', e.message); return { situaciones: [], turnos: [], tipos: [] }; });
  return { catalogos };
}

/**
 * La lista con su resumen.
 *
 * Salen TODOS por omisión —activos, ausentes y quien ya causó baja—, porque la
 * pregunta más frecuente incluye a los que se fueron: "¿este trabajó aquí?".
 * Con `soloVigentes` se limita a los contratados ahora mismo.
 *
 * `momento` deja mirar la plantilla de una fecha pasada: quién estaba de alta,
 * en qué turno y en qué coche. Con las hojas esto no se podía preguntar.
 */
async function lista({ momento, soloVigentes } = {}) {
  const opciones = { momento: momento || null, soloVigentes: !!soloVigentes };
  const [filas, resumen] = await Promise.all([con.listar(opciones), con.resumen(opciones)]);
  return { filas, resumen };
}

/** La ficha administrativa. Revienta si no existe, en vez de devolver nada. */
async function ficha(id, { momento } = {}) {
  const f = await con.ficha(Number(id), { momento: momento || null });
  if (!f) throw new Error('No existe ese conductor');
  // Las cuentas prestadas van en la ficha y no en una llamada aparte porque la
  // pantalla las pinta en una tarjeta más, igual que las suyas. Si esto fallara
  // no debe tumbar la ficha entera: se ve sin ellas.
  const fant = require('./fantasma.service');
  f.fantasmas = await fant.listar(id).catch(() => []);
  // El libro solo si tiene enlaces: a la inmensa mayoría de fichas le sobra una
  // consulta más para devolver una lista vacía.
  f.fantasmaLibro = f.fantasmas.length ? await fant.libro(id).catch(() => []) : [];
  // La foto va como el id de su documento, no como imagen: la pantalla la pide
  // aparte con ese id en la URL, y asi el navegador la guarda y solo la vuelve
  // a bajar cuando alguien sube otra. Sin foto, null: se pinta la silueta.
  f.foto_id = await fotoVigente(id).then(x => (x ? String(x.id) : null)).catch(() => null);
  // Lo que pide la ficha de alta y no es una columna: las fechas del carné (del
  // documento del permiso) y si hay cuenta guardada. El IBAN NUNCA sale entero:
  // solo sus cuatro últimas cifras. Y el cifrado tampoco viaja a la pantalla.
  const carne = await docs.fechasCarne(id).catch(() => ({}));
  f.carnet_expedicion = carne.expedicion || null;
  f.carnet_caducidad = carne.caducidad || null;
  f.iban_guardado = con.ibanEnmascarado(f.iban_cifrado);
  delete f.iban_cifrado;
  return f;
}

// ── La foto de la persona ──────────────────────────────────────────────────
// La logica vive en Documentos, que es donde se guarda: la usan tambien
// Seleccion y la ETT. Aqui solo se dice de quien es.
const fotoVigente = conductorId => docs.fotoDe(conductorId);
const foto = conductorId => docs.foto(conductorId);
const subirFoto = (conductorId, datos, quien) => docs.subirFoto(conductorId, datos || {}, quien || {});

// ── La ficha de alta ────────────────────────────────────────────────────────
// La misma que genera Selección, y se guarda igual en sus documentos. Aquí es
// OPCIONAL: la mayoría de la plantilla entró antes de que existiera y nadie se
// la exige. La genera quien puede tocar los datos de la persona —Tráfico no—,
// porque lleva su DNI, su cuenta y su dirección.
async function fichaDeAlta(conductorId, quien = {}) {
  if (quien.rol === 'trafico') throw new Error('La ficha de alta lleva datos personales: la genera RRHH');
  const r = await require('../Seleccion/seleccion.service')
    .fichaPDFDeConductor(conductorId, { guardar: true }, quien);
  return { link: r.link, docId: r.docId, nombre: r.nombre, adjuntos: r.adjuntos };
}

/**
 * LA HOJA DE UNA PERSONA: calificación, mes, papeles, conducción y lo hablado.
 *
 * Va aparte de la ficha a propósito: aquella es la administrativa —con sus
 * historiales y sus acciones— y esta es la de un vistazo. Se piden las dos,
 * pero la segunda solo cuando alguien abre a alguien, y no en cada listado.
 */
const hoja = id => ficha360.leer(id);

const catalogos = () => con.catalogos();

/**
 * Qué campos puede tocar quien está mirando.
 *
 * La pantalla lo usa para enseñar unos editables y otros de solo lectura, en
 * vez de dejar intentarlo y fallar. `campos()` y no la constante: las listas
 * que viven en una tabla —el centro de trabajo— se resuelven contra la base
 * antes de mandarlas.
 */
async function campos(rol) {
  // LO QUE PIDE LA FICHA DE ALTA Y NO ES UNA COLUMNA (24/09/2026): las fechas del
  // carné —van en el documento del permiso— y el IBAN —va cifrado—. Sin ellos no
  // había forma de completar la ficha desde aquí. Van donde se leen: las fechas
  // detrás del estado civil, como en Selección, y la cuenta con la Seguridad
  // Social. Son datos personales: Tráfico no los toca.
  const base = await con.campos();
  const out = {};
  for (const [k, def] of Object.entries(base)) {
    out[k] = def;
    if (k === 'estado_civil') {
      out.carnet_expedicion = { grupo: def.grupo, etiqueta: 'Fecha de expedición del carné', ambito: 'sensible', tipo: 'fecha',
        ayuda: 'Se guarda en el documento del carné: súbelo antes en Documentos' };
      out.carnet_caducidad = { grupo: def.grupo, etiqueta: 'Fecha de caducidad del carné', ambito: 'sensible', tipo: 'fecha' };
    }
    if (k === 'naf_control') {
      out.iban = { grupo: def.grupo, etiqueta: 'IBAN / nº de cuenta', ambito: 'sensible' };
    }
  }
  const extra = rol === 'trafico' ? [] : ['carnet_expedicion', 'carnet_caducidad', 'iban'];
  return { campos: out, editables: [...con.camposDe(rol || ''), ...extra] };
}

// ── BOLT ───────────────────────────────────────────────────────────────────
// Nada de esto llama a BOLT: los datos los trae la ingesta cada pocos minutos y
// aquí solo se lee de PostgreSQL. Lo único que se ofrece es saber DE CUÁNDO
// son, que es lo que sustituye a preguntar.

const boltLibres = q => con.boltLibres(q);

/**
 * Cuentas libres con dueño propuesto POR EL TELÉFONO. Es lo que convierte el
 * enlace en un clic en vez de buscar a mano entre cientos de nombres.
 */
const boltSugerencias = todos => cazamiento.sugerencias({ soloEmpleados: todos !== '1' });

/**
 * Enlaza de un tirón todas las cuentas que casan por teléfono 1:1. Devuelve
 * cuántas enlazó y quiénes quedan sin cuenta, para resolverlos a mano.
 *
 * El nombre NO decide nada, ni aquí ni en la pasada automática: los homónimos
 * existen —hay tres en el padrón real— y una cuenta enlazada con la persona
 * equivocada le imputa las horas a otro.
 */
const boltAuto = (todos, usuarioId) =>
  cazamiento.autoEnlazar({ soloEmpleados: todos !== true, usuarioId });

/**
 * Cómo está cada persona respecto a BOLT: enlazada, en BOLT sin enlazar, sin
 * teléfono, o directamente sin dar de alta.
 */
const altaEnBolt = ({ todos, situacion } = {}) =>
  cazamiento.altaEnBolt({ soloEmpleados: todos !== '1', situacion });

const boltEstado = () => cazamiento.estado();
const frescura = () => require('../../services/ingesta').estado();

/**
 * ¿Quién es esta persona? Por DNI, teléfono o nombre de BOLT, en ese orden.
 * La usa la ticketera para saber a quién aplicarle lo que pide un formulario.
 */
const buscarPersona = pistas => con.buscarPersona(pistas || {});

// ── Escritura ──────────────────────────────────────────────────────────────
// Casi todo es pasar el recado: la regla de cada cambio vive en el repositorio,
// que es quien sabe cerrar una vigencia y abrir la siguiente en una sola
// transacción. Lo que NO se hace aquí es escribir fechas "hasta" a mano.

const crear = (datos, quien) => con.crear(datos, quien);
/**
 * Guarda los datos de la ficha. Las fechas del carné y el IBAN se apartan: no
 * son columnas de la persona (ver `campos`). Se COMPRUEBA TODO ANTES DE
 * GUARDAR NADA: si las fechas no valen o no hay carné subido, se dice sin haber
 * tocado el resto del formulario.
 */
async function actualizar(id, datos = {}, quien = {}) {
  const { carnet_expedicion: exp, carnet_caducidad: cad, iban, ...resto } = datos || {};
  const tocaIban = iban !== undefined && String(iban).trim() !== '';
  if ((exp !== undefined || cad !== undefined || tocaIban) && quien.rol === 'trafico') {
    throw new Error('Las fechas del carné y la cuenta son datos personales: los cambia RRHH');
  }
  if (tocaIban && !require('../../services/cripto').configurada()) {
    throw new Error('No se puede guardar el IBAN: falta la clave de cifrado en el servidor');
  }
  const fechas = await docs.prepararFechasCarne(id, { expedicion: exp, caducidad: cad });
  const r = Object.keys(resto).length ? await con.actualizar(Number(id), resto, quien) : {};
  if (fechas) await fechas.aplicar(quien);
  if (tocaIban) await con.guardarIban(Number(id), iban, quien);
  return r;
}

const cambiarSituacion = async (id, datos, quien) =>
  ({ vigencia: await con.cambiarSituacion(Number(id), datos, quien) });

/**
 * AÑADIR un tramo de ausencia suelto: las vacaciones partidas, 13 días este mes
 * y 3 en noviembre. No reemplaza nada; si pisa otro tramo, lo dice.
 */
const anadirAusencia = (id, datos, quien) => con.anadirAusencia(Number(id), datos, quien);

/**
 * CORREGIR una ausencia ya puesta, o borrarla. No es lo mismo que cambiar la
 * situación: esa abre un tramo nuevo desde una fecha; estas dos tocan la fila
 * que ya hay, que es lo que hace falta cuando lo que se metió está mal.
 */
const editarAusencia = (id, filaId, datos, quien) =>
  con.editarAusencia(Number(id), Number(filaId), datos, quien);
const borrarAusencia = (id, filaId, quien) =>
  con.borrarAusencia(Number(id), Number(filaId), quien);

const cambiarTurno = async (id, datos, quien) =>
  ({ vigencia: await con.cambiarTurno(Number(id), datos, quien) });

const guardarLibranza = (id, { dias, desde }, quien) =>
  con.guardarLibranza(Number(id), dias, { desde, ...quien });

const guardarTelefono = async (id, e164, quien) =>
  ({ telefono: await con.guardarTelefono(Number(id), e164, quien) });

/**
 * `cuentaId` es el id de la FILA de conductor_externo, el que dan las vistas de
 * libres y sugerencias. NO es el driver_uuid: ese identifica en BOLT, no aquí.
 */
/**
 * ENLAZAR UNA CUENTA NO BASTA: HAY QUE REHACER SUS DÍAS.
 *
 * Las horas viven en `bitacora_horas`, que se sella por jornada. Una jornada ya
 * sellada no se vuelve a calcular sola, así que enlazar hoy una cuenta que
 * rodó la semana pasada dejaba esas horas en tierra para siempre: no salían en
 * la bitácora, ni en la asistencia, ni en el promedio, ni en la nómina.
 *
 * Pasó de verdad: a Oualid Saguiri se le enlazó su cuenta el 10/09 y sus casi
 * cinco horas del día 2 —sellado el día 8— no llegaron nunca a su ficha.
 * Se descubrió comparando el cálculo con lo sellado, no porque nadie lo notara.
 */
async function rehacerDiasDeLaCuenta(cuentaId) {
  const desde = await con.primerDiaDeCuenta(Number(cuentaId));
  if (!desde) return { resellado: null };
  const fantasma = require('./fantasma.service');
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  return fantasma.rehacer(fantasma.rangoAfectado({
    desde: desde < fantasma.MINIMO ? fantasma.MINIMO : desde, hasta: hoy,
  }));
}

const enlazarBolt = async (id, cuentaId, quien) => {
  const r = await con.enlazarBolt(Number(id), cuentaId, quien);
  return { ...(r && typeof r === 'object' ? r : {}), ...(await rehacerDiasDeLaCuenta(cuentaId)) };
};
const soltarBolt = async (id, cuentaId, quien) => ({
  soltada: await con.soltarBolt(Number(id), Number(cuentaId), quien),
  // Al soltarla, sus horas dejan de ser de esa persona: mismo problema al revés.
  ...(await rehacerDiasDeLaCuenta(cuentaId)),
});

/**
 * Dar de alta desde la ficha.
 *
 * Y de paso poner al dia su candidatura, si tenia una a medias. Antes no: el
 * alta se daba aqui y el proceso se quedaba donde estaba, asi que la ETT veia
 * «Coordinacion de entrevista» para alguien que llevaba tres dias conduciendo
 * —y el Excel que se le manda a la agencia le contaba como pendiente—.
 *
 * Se entra por el servicio de Seleccion, que es su puerta, y se pide aqui
 * dentro porque los dos modulos se llaman entre si. Si falla, el alta NO se
 * cae: la persona ya tiene contrato y eso es lo que importa.
 */
const darDeAlta = async (id, datos, quien) => {
  const periodoId = await con.darDeAlta(Number(id), datos, quien);
  let candidatura = null;
  try {
    candidatura = await require('../Seleccion/seleccion.service')
      .alContratar(Number(id), { alta: (datos || {}).alta }, quien);
  } catch (e) {
    console.error('⚠️  [PLANTILLA] candidatura no actualizada al dar de alta:', e.message);
  }
  return { periodoId, candidatura };
};
const darDeBaja = async (id, datos, quien) =>
  ({ dado: await con.darDeBaja(Number(id), datos, quien) });

/**
 * El paso de ETT a plantilla propia, a los tres meses. NO es una baja seguida
 * de un alta: la persona sigue en su coche y en su turno, y la antigüedad de la
 * ETT se arrastra al contrato nuevo.
 */
const aPropia = (id, datos, quien) => alta.convertirAPropia(Number(id), datos, quien);

/** Las horas del contrato abierto (32, 40…). No abre periodo: es una novación. */
const cambiarJornada = (id, datos, quien) => con.cambiarJornada(Number(id), datos, quien);

/** Quién tocó qué y cuándo en una ficha. */
const cambios = async id => ({ cambios: await audit.historial('conductor', Number(id)) });

/** La misma persona en dos coches el mismo día. */
const conflictos = async momento => ({ conflictos: await con.doblePlaza({ momento }) });

// ── El Excel de la gestoría ────────────────────────────────────────────────

/**
 * La MISMA pestaña que nos mandan ellos, devuelta con nuestros datos.
 *
 * SOLO PLANTILLA PROPIA: a la gente de la ETT la contrata la agencia y sus
 * altas las lleva ella; mandárselas a nuestra gestoría sería pedirle que
 * tramite a gente que no es nuestra. El filtro no está aquí, está en la
 * consulta, que es donde no se puede desactivar sin querer.
 */
async function excelGestoria(estado) {
  const alcance = ['alta', 'baja', 'todos'].includes(estado) ? estado : 'alta';
  const filas = await con.paraGestoria({ estado: alcance });
  const bytes = await gestoria.generarExcelGestoria(filas);
  console.log(`📄 [PLANTILLA] Excel para la gestoría (${alcance}): ${filas.length} fila(s)`);
  return { bytes, nombre: gestoria.nombreFichero(alcance) };
}

// ── Los papeles ────────────────────────────────────────────────────────────
// Van a la tabla `documento`, que es de la PERSONA. Los bytes siguen en Drive.

const tiposDocumento = () => docs.tipos('conductor');
const documentosDe = (id, historico) =>
  docs.listar('conductor', id, { incluirReemplazados: historico === '1' });
const subirDocumento = async ({ conductorId, ...datos }, quien) =>
  ({ documento: await docs.subir('conductor', conductorId, datos, quien) });
const actualizarDocumento = async (id, datos, quien) =>
  ({ documento: await docs.actualizar(Number(id), datos, quien) });

/**
 * Por omisión solo se retira del índice y el archivo se queda: son papeles
 * laborales y borrarlos de verdad no tiene vuelta atrás.
 */
const retirarDocumento = async (id, borrarArchivo, quien) =>
  ({ retirado: await docs.retirar(Number(id), { borrarArchivo: borrarArchivo === '1', ...quien }) });

const descargarDocumento = id => docs.descargar(Number(id));

/** Lo que caduca pronto, de personas y de coches. Alimenta los avisos. */
const documentosQueVencen = dias => docs.porVencer({ dias });

module.exports = {
  paraLaPantalla, lista, ficha, hoja, catalogos, campos, buscarPersona,
  boltLibres, boltSugerencias, boltAuto, altaEnBolt, boltEstado, frescura,
  crear, actualizar, cambiarSituacion, anadirAusencia, editarAusencia, borrarAusencia,
  cambiarTurno, guardarLibranza, guardarTelefono, enlazarBolt, soltarBolt,
  darDeAlta, darDeBaja, aPropia, cambiarJornada, cambios, conflictos,
  excelGestoria,
  tiposDocumento, documentosDe, subirDocumento, actualizarDocumento, foto, subirFoto, fichaDeAlta,
  retirarDocumento, descargarDocumento, documentosQueVencen,
};
