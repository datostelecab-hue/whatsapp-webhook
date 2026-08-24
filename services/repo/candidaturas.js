// ============================================================
// CANDIDATURAS — el embudo de Selección sobre PostgreSQL
// ============================================================
// Sustituye a leer la hoja TICKETS y cruzarla en JavaScript.
//
// LA REGLA DE ESTE MÓDULO: aquí solo vive el PROCESO. El nombre, el DNI, la
// dirección, el NAF y los documentos son de la persona, y la persona ya tiene
// tablas. Cuando llega un dato de esos, se guarda donde le toca — no se copia.
//
// Por eso `guardar()` reparte: lo que es un campo de `conductor` va por
// `conductores.actualizar`, y solo lo que es del embudo se escribe aquí.
//
// Un candidato es una fila de `conductor` SIN periodo de empleo. Eso no es un
// apaño: es literalmente lo que significa "todavía no trabaja aquí". Y le da
// desde el primer día lo que la hoja nunca tuvo — que su DNI no se repita y que
// su teléfono no sea el de otro.

const db = require('../db');
const con = require('./conductores');
const alta = require('./alta');
const audit = require('./auditoria');

// Las columnas del embudo que se pueden escribir desde la pantalla. Lo que no
// esté aquí, o es de la persona o no se toca.
const CAMPOS = {
  canal:             { etiqueta: 'Canal de origen' },
  experiencia:       { etiqueta: 'Experiencia', tipo: 'booleano' },
  carne_vtc:         { etiqueta: 'Carné VTC', tipo: 'booleano' },
  prueba_conduccion: { etiqueta: 'Prueba de conducción', tipo: 'booleano' },
  apto_medico:       { etiqueta: 'Apto médico', tipo: 'booleano' },
  vacante_ref:       { etiqueta: 'Vacante' },
  turno_id:          { etiqueta: 'Turno', tipo: 'numero' },
  base_zona_id:      { etiqueta: 'Zona', tipo: 'numero' },
  inicio_previsto:   { etiqueta: 'Fecha de inicio', tipo: 'fecha' },
  jornada_horas:     { etiqueta: 'Jornada (horas)', tipo: 'numero' },
  tipo_contrato:     { etiqueta: 'Tipo de contrato' },
  responsable:       { etiqueta: 'Responsable' },
  notas:             { etiqueta: 'Notas' },
  num_hijos:         { etiqueta: 'Nº de hijos', tipo: 'numero' },
  tipo_carnet:       { etiqueta: 'Tipo de carné' },
  excel_alta:        { etiqueta: 'Excel de altas' },
  pin_ballenoil:     { etiqueta: 'PIN de Ballenoil' },
  obs_ballenoil:     { etiqueta: 'Observaciones de Ballenoil' },
};

/** Los catálogos que la pantalla necesita para pintar sus desplegables. */
async function catalogos() {
  const [estados, etapas, canales, turnos, zonas] = await Promise.all([
    db.consulta(`SELECT codigo, etiqueta, etapa, orden, en_funnel, es_salida
                   FROM cat_estado_candidatura WHERE NOT obsoleto ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta FROM cat_etapa_candidatura ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta FROM cat_canal_candidatura WHERE activo ORDER BY etiqueta`),
    db.consulta(`SELECT id, codigo, etiqueta FROM turno WHERE activo ORDER BY id`),
    db.consulta(`SELECT id, nombre FROM base_zona ORDER BY nombre`),
  ]);
  // Los campos que la pantalla puede editar, con su etiqueta y su tipo. Salen de
  // aqui y no de una lista escrita en la vista: son los mismos que valida
  // `guardar`, asi que no pueden discrepar.
  const campos = [];
  const PERSONA = ['nombre', 'apellidos', 'dni_nie', 'fecha_nacimiento', 'sexo',
    'estado_civil', 'nacionalidad', 'email', 'tel_emergencia', 'centro_codigo',
    'via_tipo', 'via_nombre', 'via_numero', 'escalera', 'piso', 'puerta',
    'codigo_postal', 'localidad', 'provincia', 'observaciones'];
  for (const k of PERSONA) {
    const def = con.CAMPOS[k];
    if (def) campos.push({ id: k, grupo: def.grupo || 'Persona', ...def });
  }
  // Los que se escriben de una pieza y la base guarda despiezados. No estan en
  // CAMPOS porque no son columnas: son la forma en que los teclea una persona.
  campos.push({ id: 'naf', grupo: 'Seguridad Social', etiqueta: 'Nº Seguridad Social',
                ayuda: 'Los doce dígitos, con separadores o sin ellos' });
  campos.push({ id: 'iban', grupo: 'Seguridad Social', etiqueta: 'IBAN / nº de cuenta',
                ayuda: 'Se guarda cifrado. Si se deja vacío, no se toca el que hubiera' });
  campos.push({ id: 'coordenadas', grupo: 'Dirección', etiqueta: 'Coordenadas',
                ayuda: 'lat, lng — se obtienen del botón de geocodificar' });
  for (const [id, def] of Object.entries(CAMPOS)) {
    campos.push({ id, grupo: 'Proceso', ...def });
  }

  return {
    estados: estados.rows, etapas: etapas.rows, canales: canales.rows,
    turnos: turnos.rows, zonas: zonas.rows, campos,
    // El recorrido de Selección, en orden. La pantalla pinta los pasos con esto
    // en vez de llevar su propia lista, que es como se desincronizan.
    funnel: estados.rows.filter(e => e.en_funnel).map(e => e.codigo),
  };
}

/**
 * El embudo entero.
 *
 * Por omisión salen las candidaturas VIVAS. Las cerradas (descartes, bajas) se
 * piden aparte: son historia y en la pantalla del día a día solo estorban.
 */
async function listar({ incluirCerradas = false, etapa, estado } = {}) {
  const donde = [], params = [];
  if (!incluirCerradas) donde.push('cerrado_at IS NULL');
  if (etapa)  { params.push(etapa);  donde.push(`etapa = $${params.length}`); }
  if (estado) { params.push(estado); donde.push(`estado = $${params.length}`); }

  const r = await db.consulta(
    `SELECT * FROM v_candidatura
      ${donde.length ? 'WHERE ' + donde.join(' AND ') : ''}
      ORDER BY estado_orden, creado_at DESC`, params);
  return r.rows;
}

/** Una candidatura por su id, con la persona resuelta. */
async function ficha(id) {
  const r = await db.consulta('SELECT * FROM v_candidatura WHERE id = $1', [Number(id)]);
  if (!r.rows[0]) return null;
  const c = r.rows[0];
  // Los documentos son de la persona, no del proceso: se leen de su tabla.
  const docs = require('./documentos');
  return { ...c, documentos: await docs.listar({ conductorId: c.conductor_id }) };
}

/**
 * Qué hay detrás de este teléfono, antes de abrir nada.
 *
 * Devuelve la candidatura viva si la hay, y siempre la situación de alta: si
 * tenemos ficha suya, si está en BOLT y con qué número. Es lo que deja decidir
 * entre seguir un proceso, restaurar a alguien o empezar de cero.
 */
async function porTelefono(telefono) {
  const situacion = await alta.porTelefono(telefono);
  let candidatura = null;
  if (situacion.ficha) {
    const r = await db.consulta(
      `SELECT * FROM v_candidatura WHERE conductor_id = $1 AND cerrado_at IS NULL`,
      [situacion.ficha.id]);
    candidatura = r.rows[0] || null;
  }
  return { situacion, candidatura };
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
  const { situacion, candidatura } = await porTelefono(telefono);
  if (candidatura) return { id: candidatura.id, yaExistia: true };

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
    const r = await con.crearPersona({ ...datos, ...partes, telefono }, quien);
    conductorId = r.id;
  }

  const r = await db.consulta(
    `INSERT INTO candidatura (conductor_id, estado, canal, responsable)
     VALUES ($1,'preseleccion',$2,$3) RETURNING id`,
    [conductorId, datos.canal || null, datos.responsable || null]);

  return { id: r.rows[0].id, conductorId, yaExistia: false, situacion };
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
  const c = (await db.consulta('SELECT conductor_id FROM candidatura WHERE id = $1', [Number(id)])).rows[0];
  if (!c) throw new Error('No existe esa candidatura');

  // Lo que una persona teclea de una pieza y la base guarda despiezado. Se
  // normaliza AQUI y no en la pantalla: si lo hiciera la pantalla, cada
  // formulario que quisiera guardar una direccion tendria que repetirlo.
  const d = { ...datos, ...despiezar(datos) };

  const dePersona = {}, deProceso = {};
  for (const [k, v] of Object.entries(d)) {
    if (con.CAMPOS[k]) dePersona[k] = v;
    else if (CAMPOS[k]) deProceso[k] = v;
  }

  if (Object.keys(dePersona).length) await con.actualizar(c.conductor_id, dePersona, quien);

  if (Object.keys(deProceso).length) {
    const cols = [], vals = [];
    for (const [k, v] of Object.entries(deProceso)) {
      cols.push(`${k} = $${cols.length + 1}`);
      vals.push(v === '' ? null : (CAMPOS[k].tipo === 'numero' ? Number(v) : v));
    }
    vals.push(Number(id));
    await db.consulta(
      `UPDATE candidatura SET ${cols.join(', ')}, actualizado_at = now() WHERE id = $${vals.length}`, vals);
  }

  // El teléfono no es un campo de la ficha: tiene su propia tabla y su propia
  // vigencia, así que va por su función.
  if (datos.telefono) await con.guardarTelefono(c.conductor_id, datos.telefono, quien);

  // El IBAN va CIFRADO. En la hoja viajaba en claro, a la vista de cualquiera
  // con acceso al documento; aquí se guarda cifrado y no se devuelve nunca en
  // los listados. Si no hay clave configurada se avisa y no se guarda, en vez
  // de escribirlo en claro «de momento».
  if (datos.iban !== undefined) {
    const cripto = require('../cripto');
    const iban = String(datos.iban || '').replace(/\s+/g, '').toUpperCase();
    if (!iban) {
      await db.consulta('UPDATE conductor SET iban_cifrado = NULL WHERE id = $1', [c.conductor_id]);
    } else if (!cripto.configurada()) {
      throw new Error('No se puede guardar el IBAN: falta la clave de cifrado en el servidor');
    } else {
      await db.consulta('UPDATE conductor SET iban_cifrado = $1 WHERE id = $2',
        [cripto.cifrar(iban), c.conductor_id]);
    }
  }

  return { id: Number(id), conductorId: c.conductor_id };
}

/**
 * Mueve la candidatura de estado.
 *
 * La etapa NO se toca: la dice el catálogo. Guardar las dos era como se
 * conseguía tener una ficha en "Entrevistado" y etapa "RRHH" a la vez.
 */
async function cambiarEstado(id, estado, { motivo, usuarioId } = {}) {
  const e = (await db.consulta(
    'SELECT codigo, etiqueta, es_salida FROM cat_estado_candidatura WHERE codigo = $1', [estado])).rows[0];
  if (!e) throw new Error(`No existe el estado "${estado}"`);

  const antes = (await db.consulta('SELECT estado, conductor_id FROM candidatura WHERE id = $1',
    [Number(id)])).rows[0];
  if (!antes) throw new Error('No existe esa candidatura');

  await db.consulta(
    `UPDATE candidatura
        SET estado = $1,
            motivo = COALESCE($2, motivo),
            -- Una salida cierra la candidatura; volver a un estado vivo la
            -- reabre. Sin esto, reabrir una ficha descartada la dejaba abierta
            -- y cerrada a la vez.
            cerrado_at = CASE WHEN $3 THEN COALESCE(cerrado_at, now()) ELSE NULL END,
            actualizado_at = now()
      WHERE id = $4`,
    [estado, motivo || null, e.es_salida, Number(id)]);

  await audit.registrar({
    tabla: 'candidatura', id: Number(id), usuarioId,
    cambios: [{ campo: 'estado', antes: antes.estado, ahora: estado }],
  });
  return { id: Number(id), estado, etiqueta: e.etiqueta, cerrada: e.es_salida };
}

/**
 * Selección termina: la persona pasa a RRHH con su contrato abierto.
 *
 * Aquí se ve lo que gana el modelo nuevo. En la hoja esto era "convertir un
 * ticket de 60 columnas en una ficha"; aquí la ficha ya existe desde
 * Preselección y lo único que falta es abrirle el periodo de empleo.
 */
async function pasarARRHH(id, contrato = {}, quien = {}) {
  const c = (await db.consulta(
    `SELECT k.conductor_id, k.estado, c.empleo_vigente,
            btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien
       FROM candidatura k JOIN conductor c ON c.id = k.conductor_id
      WHERE k.id = $1`, [Number(id)])).rows[0];
  if (!c) throw new Error('No existe esa candidatura');
  if (c.empleo_vigente) throw new Error(`${c.quien} ya tiene un contrato abierto`);
  // Lo pactado durante la seleccion vale como contrato, salvo que al pasar a
  // RRHH se diga otra cosa. Asi no hay que reescribir lo que ya se acordo.
  const k = (await db.consulta(
    'SELECT inicio_previsto, jornada_horas, tipo_contrato FROM candidatura WHERE id = $1',
    [Number(id)])).rows[0] || {};
  contrato = {
    alta: contrato.alta || (k.inicio_previsto ? String(k.inicio_previsto).slice(0, 10) : null),
    jornadaHoras: contrato.jornadaHoras || k.jornada_horas || null,
    tipo: contrato.tipo || (/ETT/i.test(k.tipo_contrato || '') ? 'ett' : 'propia'),
    ettNombre: contrato.ettNombre,
    finPrueba: contrato.finPrueba,
  };
  if (!contrato.alta) throw new Error('Falta la fecha de inicio del contrato');

  const faltan = await faltantes(Number(id));
  if (faltan.length) throw new Error('Antes de pasar a RRHH faltan datos: ' + faltan.join(', '));

  await con.darDeAlta(c.conductor_id, {
    tipo: contrato.tipo === 'ett' ? 'ett' : 'propia',
    ettNombre: contrato.ettNombre,
    alta: contrato.alta,
    jornadaHoras: contrato.jornadaHoras,
    finPrueba: contrato.finPrueba,
  }, quien);

  await db.consulta(
    `UPDATE candidatura SET estado = 'listo_rrhh', apto_at = now(), actualizado_at = now()
      WHERE id = $1`, [Number(id)]);

  // Sin cuenta de BOLT no puede conducir. Se devuelve para decirlo ahora y no
  // el día que tiene que salir.
  const s = await db.consulta(
    'SELECT situacion_bolt, telefono_bolt FROM v_conductor_alta_bolt WHERE conductor_id = $1',
    [c.conductor_id]);

  return {
    id: Number(id), conductorId: c.conductor_id, quien: c.quien,
    bolt: s.rows[0] || null,
    faltaBolt: !s.rows[0] || s.rows[0].situacion_bolt === 'no_esta_en_bolt',
  };
}

// Lo que tiene que estar antes de pasar a RRHH. Son datos de la PERSONA y de
// sus documentos, así que se preguntan a sus tablas y no a una lista aparte que
// se quedaría vieja.
const OBLIGATORIOS = [
  ['nombre', 'Nombre'], ['apellidos', 'Apellidos'], ['dni_nie', 'DNI/NIE'],
  ['fecha_nacimiento', 'Fecha de nacimiento'], ['sexo', 'Sexo'], ['email', 'Correo'],
  ['via_nombre', 'Dirección'], ['codigo_postal', 'Código postal'],
  ['estado_civil', 'Estado civil'], ['naf_numero', 'Nº Seguridad Social'],
];

async function faltantes(id) {
  const r = await db.consulta(
    `SELECT c.* FROM candidatura k JOIN conductor c ON c.id = k.conductor_id WHERE k.id = $1`,
    [Number(id)]);
  const c = r.rows[0];
  if (!c) return ['la candidatura no existe'];
  const faltan = OBLIGATORIOS.filter(([campo]) => !String(c[campo] == null ? '' : c[campo]).trim())
    .map(([, etiqueta]) => etiqueta);

  // Y los documentos obligatorios. Se preguntan a v_documento_falta_PERSONA y no
  // a v_documento_falta: la segunda solo mira a quien tiene contrato, y un
  // candidato no lo tiene — daria cero documentos que faltan siempre.
  // Solo los PREVIOS al alta. El contrato firmado y el alta en la Seguridad
  // Social tambien son obligatorios, pero no existen hasta que se contrata:
  // exigirlos aqui bloquearia todas las altas pidiendo un papel imposible.
  const docs = await db.consulta(
    `SELECT d.etiqueta
       FROM v_documento_falta_persona d
       JOIN cat_tipo_documento td ON td.codigo = d.tipo
      WHERE d.conductor_id = $1 AND td.previo_alta
      ORDER BY td.orden`,
    [c.id]);
  return [...faltan, ...docs.rows.map(d => 'Documento: ' + d.etiqueta)];
}

/**
 * La candidatura con la forma que espera el generador de la FICHA DE ALTA.
 *
 * El PDF es un consumidor heredado: pide diecisiete claves con nombres suyos.
 * En vez de retorcer el modelo para complacerlo, se traduce aqui — que es lo
 * que es, una traduccion, y se ve de un vistazo.
 *
 * Las fechas del carne salen del DOCUMENTO, no de dos casillas aparte: si el
 * permiso esta subido con su emision y su caducidad, escribirlas otra vez a mano
 * solo sirve para que un dia no coincidan.
 */
async function paraFicha(id) {
  const r = await db.consulta(
    `SELECT k.id, k.inicio_previsto, k.num_hijos,
            c.id AS conductor_id, c.nombre, c.apellidos, c.dni_nie, c.email,
            c.fecha_nacimiento, c.estado_civil, c.naf, c.direccion, c.codigo_postal,
            c.observaciones, c.iban_cifrado,
            tel.e164 AS telefono,
            per.fecha_emision AS carnet_expedicion,
            per.fecha_caduca  AS carnet_caducidad
       FROM candidatura k
       JOIN conductor c ON c.id = k.conductor_id
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
       LEFT JOIN LATERAL (
         SELECT fecha_emision, fecha_caduca FROM documento
          WHERE conductor_id = c.id AND tipo = 'permiso' AND vigente
          ORDER BY id DESC LIMIT 1) per ON TRUE
      WHERE k.id = $1`, [Number(id)]);
  const f = r.rows[0];
  if (!f) throw new Error('No existe esa candidatura');

  const fecha = v => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
  let iban = '';
  if (f.iban_cifrado) {
    const cripto = require('../cripto');
    try { iban = cripto.descifrar(f.iban_cifrado); } catch (e) { iban = '(no se pudo descifrar)'; }
  }

  return {
    conductorId: f.conductor_id,
    id: f.telefono, telefono: f.telefono,
    nombre: f.nombre, apellidos: f.apellidos, dni: f.dni_nie, email: f.email,
    fecha_nacimiento: fecha(f.fecha_nacimiento), estado_civil: f.estado_civil,
    num_hijos: f.num_hijos, num_seg_social: f.naf,
    direccion: f.direccion, codigo_postal: f.codigo_postal,
    carnet_expedicion: fecha(f.carnet_expedicion), carnet_caducidad: fecha(f.carnet_caducidad),
    fecha_inicio: fecha(f.inicio_previsto),
    iban, observaciones: f.observaciones,
  };
}

module.exports = {
  CAMPOS, catalogos, listar, ficha, porTelefono, abrir, guardar,
  cambiarEstado, pasarARRHH, faltantes, paraFicha,
};
