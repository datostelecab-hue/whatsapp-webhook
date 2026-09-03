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
  const [estados, etapas, canales, turnos, zonas, jornadas, motivos] = await Promise.all([
    db.consulta(`SELECT codigo, etiqueta, etapa, orden, en_funnel, es_salida, etiqueta_ett
                   FROM cat_estado_candidatura WHERE NOT obsoleto ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta FROM cat_etapa_candidatura ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta FROM cat_canal_candidatura WHERE activo ORDER BY etiqueta`),
    // `asignable` distingue los turnos que se ELIGEN al contratar de los que
    // solo existen para leer datos viejos. La pantalla no tiene que saberse
    // cuales son.
    db.consulta(`SELECT id, codigo, etiqueta, asignable FROM turno WHERE activo ORDER BY id`),
    db.consulta(`SELECT id, nombre FROM base_zona ORDER BY nombre`),
    db.consulta(`SELECT horas, etiqueta FROM cat_jornada WHERE activa ORDER BY orden`),
    // Cada motivo lleva a SU estado: no presentarse no es no pasar la
    // entrevista, y la agencia los lee distinto.
    db.consulta(`SELECT codigo, etiqueta, estado, pide_texto
                   FROM cat_motivo_descarte WHERE activo ORDER BY orden`),
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
    turnos: turnos.rows,
    jornadas: jornadas.rows, zonas: zonas.rows, motivos: motivos.rows, campos,
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
async function listar({ incluirCerradas = false, etapa, estado, canal } = {}) {
  const donde = [], params = [];
  if (!incluirCerradas) donde.push('cerrado_at IS NULL');
  if (etapa)  { params.push(etapa);  donde.push(`etapa = $${params.length}`); }
  if (estado) { params.push(estado); donde.push(`estado = $${params.length}`); }
  // Por canal: es lo que separa la pantalla de la ETT de la de Seleccion. Misma
  // tabla, misma consulta, distinta puerta de entrada.
  if (canal)  { params.push(canal);  donde.push(`canal = $${params.length}`); }

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
  const actual = (await db.consulta(
    'SELECT * FROM conductor WHERE id = $1', [conductorId])).rows[0];
  if (!actual) return {};

  const huecos = {};
  for (const [k, v] of Object.entries({ ...datos, ...despiezar(datos) })) {
    if (!con.CAMPOS[k] || v === '' || v === null || v === undefined) continue;
    const tiene = actual[k];
    if (tiene === null || tiene === undefined || String(tiene).trim() === '') huecos[k] = v;
  }
  if (Object.keys(huecos).length) await con.actualizar(conductorId, huecos, quien);
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
  const { situacion, candidatura } = await porTelefono(telefono);

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
    const r = await con.crearPersona({ ...datos, ...partes, telefono }, quien);
    conductorId = r.id;
  } else {
    await rellenarHuecos(conductorId, datos, quien);
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
async function cambiarEstado(id, estado, { motivo, motivoCodigo, usuarioId } = {}) {
  const e = (await db.consulta(
    'SELECT codigo, etiqueta, es_salida FROM cat_estado_candidatura WHERE codigo = $1', [estado])).rows[0];
  if (!e) throw new Error(`No existe el estado "${estado}"`);

  const antes = (await db.consulta('SELECT estado, conductor_id FROM candidatura WHERE id = $1',
    [Number(id)])).rows[0];
  if (!antes) throw new Error('No existe esa candidatura');

  // Volver a un estado VIVO borra el motivo, si no se da otro.
  //
  // El motivo es la explicación de por qué esa persona no siguió. Quien vuelve
  // al proceso ya no tiene ninguna, y arrastrar la vieja significaba que un
  // candidato reabierto seguía diciendo "No se presentó" en su ficha y en el
  // Excel de la agencia.
  const limpia = !e.es_salida && !motivo;

  await db.consulta(
    `UPDATE candidatura
        SET estado = $1,
            motivo        = CASE WHEN $5 THEN NULL ELSE COALESCE($2, motivo) END,
            motivo_codigo = CASE WHEN $5 THEN NULL ELSE COALESCE($6, motivo_codigo) END,
            -- Una salida cierra la candidatura; volver a un estado vivo la
            -- reabre. Sin esto, reabrir una ficha descartada la dejaba abierta
            -- y cerrada a la vez.
            cerrado_at = CASE WHEN $3 THEN COALESCE(cerrado_at, now()) ELSE NULL END,
            actualizado_at = now()
      WHERE id = $4`,
    [estado, motivo || null, e.es_salida, Number(id), limpia, motivoCodigo || null]);

  await audit.registrar({
    tabla: 'candidatura', id: Number(id), usuarioId,
    cambios: [{ campo: 'estado', antes: antes.estado, ahora: estado }],
  });
  return { id: Number(id), estado, etiqueta: e.etiqueta, cerrada: e.es_salida };
}

/**
 * No pasa, y por qué.
 *
 * El motivo NO es un adorno: decide a qué estado va la persona. No presentarse a
 * la entrevista y no superarla son dos cosas distintas, y la agencia las lee
 * distinto en su Excel. Esa correspondencia vive en `cat_motivo_descarte`, así
 * que ni la pantalla ni esta función eligen el estado: lo leen.
 *
 * Se guarda dos veces a propósito. `motivo` es como se lee —la etiqueta y, si la
 * hay, la explicación—, y es lo que acaba en el justificante que se le manda a
 * la agencia. `motivo_codigo` es como se cuenta: "cuántos no se presentan" es
 * una pregunta que se hace de verdad, y en prosa no se responde.
 */
async function descartar(id, { motivoCodigo, detalle, usuarioId } = {}) {
  if (!motivoCodigo) throw new Error('Falta el motivo: hay que decir por qué no pasa');
  const m = (await db.consulta(
    'SELECT codigo, etiqueta, estado, pide_texto FROM cat_motivo_descarte WHERE codigo = $1 AND activo',
    [motivoCodigo])).rows[0];
  if (!m) throw new Error(`No existe el motivo "${motivoCodigo}"`);

  const texto = String(detalle || '').trim();
  if (m.pide_texto && !texto) {
    throw new Error(`"${m.etiqueta}" hay que explicarlo: escribe qué pasó.`);
  }

  return cambiarEstado(id, m.estado, {
    motivo: m.etiqueta + (texto ? ' — ' + texto : ''),
    motivoCodigo: m.codigo,
    usuarioId,
  });
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
            btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
            (SELECT e164 FROM conductor_telefono
              WHERE conductor_id = c.id AND vigente_hasta IS NULL
              ORDER BY principal DESC, id DESC LIMIT 1) AS telefono
       FROM candidatura k JOIN conductor c ON c.id = k.conductor_id
      WHERE k.id = $1`, [Number(id)])).rows[0];
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
  const k = (await db.consulta(
    'SELECT inicio_previsto, jornada_horas, tipo_contrato, turno_id FROM candidatura WHERE id = $1',
    [Number(id)])).rows[0] || {};
  contrato = {
    alta: contrato.alta || (k.inicio_previsto ? String(k.inicio_previsto).slice(0, 10) : null),
    jornadaHoras: contrato.jornadaHoras || k.jornada_horas || null,
    tipo: contrato.tipo || (/ETT/i.test(k.tipo_contrato || '') ? 'ett' : 'propia'),
    ettNombre: contrato.ettNombre,
    finPrueba: contrato.finPrueba,
  };
  if (!contrato.alta) throw new Error('Falta la fecha de inicio del contrato');

  const faltan = await faltantes(Number(id), contrato.tipo);
  if (faltan.length) throw new Error('Antes de pasar a RRHH faltan datos: ' + faltan.join(', '));

  await con.darDeAlta(c.conductor_id, {
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
      await con.cambiarTurno(c.conductor_id, { turnoId: k.turno_id, desde: contrato.alta }, quien);
    } catch (e) {
      console.error(`⚠️  [CANDIDATURA] turno no aplicado a ${c.quien}: ${e.message}`);
    }
  }

  await db.consulta(
    `UPDATE candidatura SET estado = 'listo_rrhh', apto_at = now(), actualizado_at = now()
      WHERE id = $1`, [Number(id)]);

  // ENLACE AUTOMÁTICO A BOLT por teléfono — mismo criterio que alta.realizar: si
  // existe una cuenta de BOLT con ese número y no es de nadie, se enlaza SOLA,
  // INCLUIDAS las desactivadas (se enlazan igual y se avisa de que hay que
  // reactivarlas). Antes esto quedaba como sugerencia de 1 clic; ahora es automático.
  let boltEnlazada = false, boltEstado = null, boltAvisos = [];
  try {
    const alta = require('./alta');
    const info = c.telefono ? await alta.porTelefono(c.telefono) : null;
    if (info && info.bolt) {
      boltEstado = info.bolt.estado;          // 'active' / 'deactivated' / …
      boltAvisos = info.avisos || [];
      // No es de nadie → se enlaza (aunque esté desactivada). Si ya es de otro, el
      // aviso de porTelefono lo dice y NO se pisa el enlace ajeno.
      if (!info.bolt.enlazadaCon) {
        await con.enlazarBolt(c.conductor_id, info.bolt.cuentaId, quien);
        boltEnlazada = true;
      }
    }
  } catch (e) {
    console.error(`⚠️  [CANDIDATURA] auto-enlace BOLT de ${c.quien}: ${e.message}`);
  }

  // Sin cuenta de BOLT no puede conducir. Se devuelve para decirlo ahora y no
  // el día que tiene que salir.
  const s = await db.consulta(
    'SELECT situacion_bolt, telefono_bolt FROM v_conductor_alta_bolt WHERE conductor_id = $1',
    [c.conductor_id]);

  return {
    id: Number(id), conductorId: c.conductor_id, quien: c.quien,
    bolt: s.rows[0] || null,
    // Resultado del auto-enlace: si se enganchó, en qué estado está la cuenta, y los
    // avisos (p.ej. "está desactivada, reactívala en BOLT").
    boltEnlazada, boltEstado, boltAvisos,
    boltReactivar: boltEstado != null && boltEstado !== 'active',
    faltaBolt: !s.rows[0] || s.rows[0].situacion_bolt === 'no_esta_en_bolt',
  };
}

/**
 * Qué le falta a esta candidatura para poder contratarla.
 *
 * El listón lo pone `repo/exigencia`, que es el mismo que se aplica a los tres
 * meses al pasar de ETT a propia. `tipo` decide cuál; si no se dice, se deduce
 * del canal: quien viene por la bolsa de la ETT se contrata por ETT.
 */
async function faltantes(id, tipo) {
  const r = await db.consulta(
    `SELECT k.conductor_id, k.canal, k.tipo_contrato
       FROM candidatura k WHERE k.id = $1`, [Number(id)]);
  const k = r.rows[0];
  if (!k) return ['la candidatura no existe'];
  const via = tipo || (k.canal === 'bolsa_ett' || /ETT/i.test(k.tipo_contrato || '') ? 'ett' : 'propia');
  return require('./exigencia').faltaPara(k.conductor_id, via);
}

/**
 * La candidatura con la forma que espera el generador de la FICHA DE ALTA.
 *
 * El PDF es un consumidor heredado: pide diecisiete claves con nombres suyos. En
 * vez de retorcer el modelo para complacerlo, se traduce aqui — que es lo que
 * es, una traduccion, y se ve de un vistazo.
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

// ── La matriz que manda la ETT ──────────────────────────────────────────────
//
// La agencia manda por correo una TABLA, no un fichero. Se copia y se pega, y de
// ahi salen las fichas. El orden de sus columnas es el suyo y no se negocia:
//
//   0 Fecha entrevista · 1 Hora · 2 Jornada · 3 Turno · 4 Nombre · 5 DNI/NIE ·
//   6 TELEFONO · 7 Direccion · 8 CP · 9 Correo
//   [ 10 Fecha de alta · 11 Jornada · 12 Turno · 13 Zona ]  <- las rellenamos
//     nosotros y se las devolvemos
//
// El telefono es la clave: una fila sin nueve digitos ahi es la cabecera, una
// linea en blanco o una nota suelta, y se salta sin ruido.

/** "05/08/2026" + "12:00h" -> un instante. Sin hora, las 00:00. */
function citaDe(dia, hora) {
  const d = String(dia || '').match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!d) return null;
  const h = String(hora || '').match(/(\d{1,2})[:.h]?(\d{2})?/);
  const iso = d[3] + '-' + d[2].padStart(2, '0') + '-' + d[1].padStart(2, '0')
    + 'T' + String(h ? h[1] : '0').padStart(2, '0') + ':' + ((h && h[2]) || '00') + ':00';
  return isNaN(new Date(iso)) ? null : iso;
}

const soloDigitos = v => String(v == null ? '' : v).replace(/\D/g, '');
const horasDe = v => { const m = String(v == null ? '' : v).match(/(\d{1,2})/); return m ? Number(m[1]) : null; };

/**
 * Que hay de verdad en la columna que la agencia titula "CODIGO POSTAL".
 *
 * Unas veces un codigo postal y otras una fecha de nacimiento. No se discute con
 * la agencia por el titulo de una columna: se lee lo que hay.
 */
function leerOchava(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return {};
  const f = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (f) {
    const anio = Number(f[3]);
    // Una fecha de nacimiento plausible. Fuera de rango es un error de tecleo y
    // se descarta antes que guardarlo.
    if (anio >= 1930 && anio <= 2010) {
      return { nacimiento: f[3] + '-' + f[2].padStart(2, '0') + '-' + f[1].padStart(2, '0') };
    }
    return {};
  }
  const cp = s.match(/^(\d{4,5})$/);
  return cp ? { cp: cp[1].padStart(5, '0') } : {};
}

function parsearMatriz(texto) {
  const filas = [];
  for (const linea of String(texto || '').split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const c = linea.split('\t').map(s => String(s == null ? '' : s).trim());
    if (c.length < 7) continue;
    const tel = soloDigitos(c[6]).slice(-9);
    if (tel.length !== 9) continue;   // cabecera, o fila sin telefono valido

    // Lo que va detras de la columna 10 puede traer un "no se presento" escrito
    // a mano en cualquiera de esas celdas.
    const cola = c.slice(10).join(' ');
    const noSePresento = /no se present/i.test(cola);

    filas.push({
      telefono: tel,
      entrevista: citaDe(c[0], c[1]),
      jornada_ett: c[2] || null, turno_ett: c[3] || null,
      nombre: c[4] || '', dni: (c[5] || '').toUpperCase(),
      direccion: c[7] || null, correo: c[9] || null,
      // La columna 8 la titulan "CÓDIGO POSTAL", pero lo que mandan ahí es la
      // FECHA DE NACIMIENTO. Se mira el contenido y no el titulo: una fecha es
      // una fecha y cinco digitos son un codigo postal, y confiar en la cabecera
      // habria guardado "24/07/1977" como codigo postal de alguien.
      ...leerOchava(c[8]),
      // Y si el codigo postal no venia solo, suele estar dentro de la direccion:
      // "c/Juan Miro 1 bajo A, 28770 Colmenar viejo".
      cpDeDireccion: (String(c[7] || '').match(/\b(\d{5})\b/) || [])[1] || null,
      // Si no se presento, lo que venga en estas celdas no es una decision.
      alta: noSePresento ? null : (c[10] || null),
      jornada: noSePresento ? null : (c[11] || null),
      turno: noSePresento ? null : (c[12] || null),
      zona: noSePresento ? null : (c[13] || null),
      noSePresento,
    });
  }
  return filas;
}

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
  const filas = parsearMatriz(texto);
  if (!filas.length) {
    throw new Error('No he reconocido ninguna fila. Copia la tabla del correo con sus columnas, ' +
                    'incluyendo la del teléfono.');
  }

  const [{ turnos, zonas }, ] = await Promise.all([catalogos()]);
  const sinTildes = s => String(s == null ? '' : s).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
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

  /** ¿Conocemos a esta persona? Por el DNI, aunque venga con otro número. */
  async function porDni(dni) {
    if (!dni) return null;
    const r = await db.consulta(
      `SELECT c.id, c.empleo_vigente,
              btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
              (SELECT e164 FROM conductor_telefono
                WHERE conductor_id = c.id AND vigente_hasta IS NULL
                ORDER BY principal DESC, id LIMIT 1) AS telefono
         FROM conductor c
        WHERE upper(btrim(c.dni_nie)) = $1 AND NOT c.es_centinela`,
      [String(dni).trim().toUpperCase()]);
    return r.rows[0] || null;
  }

  // LA SOLICITUD. Una tabla pegada es una solicitud, y esa es la unidad con la
  // que se le responde a la agencia. Si se pasa un `solicitudId` se añade a una
  // que ya existe —la agencia reenvía la misma tabla ampliada—; si no, se abre
  // una nueva.
  let solicitud = Number(solicitudId) || null;
  if (!solicitud) {
    const r = await db.consulta(
      `INSERT INTO solicitud_ett (recibida_at, referencia, usuario_id)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3) RETURNING id`,
      [recibida || null, referencia || null, quien.usuarioId || null]);
    solicitud = r.rows[0].id;
  }

  const detalle = [];
  const anota = (f, que, nota) => detalle.push({
    nombre: f.nombre || '(sin nombre)', telefono: f.telefono, dni: f.dni || null, que, nota: nota || null,
  });

  for (const f of filas) {
    try {
      const { situacion, candidatura } = await porTelefono(f.telefono);
      const porElDni = situacion.ficha ? null : await porDni(f.dni);
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
        await db.consulta(
          'UPDATE candidatura SET solicitud_id = COALESCE(solicitud_id, $1) WHERE id = $2',
          [solicitud, candidatura.id]);
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
        const ya = await db.consulta(
          `SELECT 1 FROM candidatura
            WHERE conductor_id = $1 AND canal = 'bolsa_ett'
              AND ($2::timestamptz IS NULL OR entrevista_at = $2)
            LIMIT 1`, [situacion.ficha.id, f.entrevista]);
        if (ya.rows.length) {
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
      await db.consulta(
        `UPDATE candidatura
            SET estado = $1, entrevista_at = $2, jornada_ett = $3, turno_ett = $4,
                jornada_horas = $5, turno_id = $6, base_zona_id = $7,
                inicio_previsto = $8, solicitud_id = $10, actualizado_at = now()
          WHERE id = $9`,
        [
          // Con cita puesta ya no esta en preseleccion: hay entrevista acordada.
          f.noSePresento ? 'no_presentado' : (f.entrevista ? 'coord_entrevista' : 'preseleccion'),
          f.entrevista, f.jornada_ett, f.turno_ett,
          horasDe(f.jornada), turnoDe(f.turno), zonaDe(f.zona),
          f.alta && /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}$/.test(f.alta)
            ? f.alta.split(/[\/\-.]/).reverse().join('-') : null,
          r.id, solicitud,
        ]);

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

// ── Lo que se le devuelve a la agencia ──────────────────────────────────────
//
// Una sola forma de contestarle: SU Excel, con sus columnas y en su orden. Hubo
// tambien una version en texto para pegarla en el correo, y sobraba — hacia lo
// mismo peor, y era una segunda definicion del mismo formato que podia quedarse
// atras sin que nadie lo notara.

// Nuestros estados, dichos en el vocabulario de la agencia.
//
// Ellos manejan cinco y solo cinco, y su Excel pinta y cuenta por ese nombre.
// Mandarles "Rechazado RRHH" o "Listo para RRHH" no es informarles mejor: es
// contarles nuestro proceso interno, que ni les sirve ni entienden. Y de paso
// dejaba las filas sin pintar y los contadores a cero.
/**
 * Las solicitudes de la agencia, con sus números.
 *
 * Cada una es UNA tabla pegada. Los tres números que deciden qué hacer con ella
 * vienen calculados de la base, no contados aquí: `sin_decidir` impide mandar
 * nada, `pendientes` obliga a un segundo envío, y `contratados` es lo resuelto.
 */
async function solicitudesETT({ incluirCerradas = true } = {}) {
  const r = await db.consulta(
    `SELECT * FROM v_solicitud_ett
      ${incluirCerradas ? '' : 'WHERE cerrada_at IS NULL'}
      ORDER BY recibida_at DESC, id DESC`);
  return r.rows;
}

/**
 * Por que una solicitud NO se puede mandar. Un solo texto para los dos sitios
 * que lo preguntan: el que genera el Excel y el que apunta que ya se mando.
 */
function porQueNoSeManda(s) {
  if (s.cerrada_at) return 'Esta solicitud ya está cerrada: se le contestó entera a la agencia.';
  if (s.sin_decidir) {
    return `Faltan ${s.sin_decidir} por decidir. La solicitud se manda entera, así que ` +
           'hay que resolverlos antes.';
  }
  // EL SEGUNDO ENVÍO ES PARA DECIR QUE YA NO HAY PENDIENTES.
  //
  // Con pendientes todavía sin regularizar, la agencia recibiría dos veces la
  // misma tabla: la primera diciendo "estos tres están pendientes" y la segunda
  // diciendo exactamente lo mismo. Un envío que no cuenta nada nuevo.
  if (s.pendientes) {
    return `Todavía hay ${s.pendientes} pendiente(s) de asignar. El segundo envío es ` +
           'justo para contar que ya no lo están, así que antes tienen que quedar todos ' +
           'contratados con fecha o fuera con su motivo.';
  }
  return 'Ya se le contestó y no queda nada nuevo que contarle.';
}

/**
 * Deja constancia de que a la agencia ya se le contestó por esta solicitud.
 *
 * No lo puede saber el sistema solo —el correo lo manda una persona—, así que lo
 * apunta la pantalla justo después de copiar la tabla o descargar el Excel. De
 * ahí sale lo único que de verdad importa saber de una tanda: si ya salió, y si
 * queda algo por contar.
 *
 * Guarda la FOTO de lo que se dijo. Recontarlo un mes después daría otro número,
 * porque los pendientes de entonces ya se resolvieron.
 */
async function registrarEnvio(solicitudId, { formato = 'excel', usuarioId } = {}) {
  const id = Number(solicitudId);
  if (!id) throw new Error('Falta la solicitud');
  return db.transaccion(async cli => {
    const s = (await cli.query('SELECT * FROM v_solicitud_ett WHERE id = $1', [id])).rows[0];
    if (!s) throw new Error('No existe esa solicitud');
    if (!s.puede_enviar) throw new Error(porQueNoSeManda(s));

    const r = await cli.query(
      `INSERT INTO solicitud_ett_envio
         (solicitud_id, orden, formato, candidatos, contratados, pendientes, descartados, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, orden, enviado_at`,
      [id, s.envios + 1, formato, s.candidatos, s.contratados, s.pendientes, s.descartados,
       usuarioId || null]);

    // Sin nadie pendiente de asignar la tanda queda contestada del todo, así que
    // se cierra sola. Dejarla abierta sería ofrecer un segundo envío que no
    // existe, que es justo lo que hacía antes.
    const cerrada = !s.pendientes;
    if (cerrada) {
      await cli.query(
        'UPDATE solicitud_ett SET cerrada_at = now() WHERE id = $1 AND cerrada_at IS NULL', [id]);
    }
    return { ...r.rows[0], solicitudId: id, cerrada, pendientes: s.pendientes };
  });
}

// Cerrar una solicitud A MANO ya no existe, y por eso `cerrada_at` la escribe
// solo `registrarEnvio` unas líneas más arriba.
//
// Se cierra sola al mandar el envío en el que no queda nadie pendiente de
// asignar, que es LA definición de "ya no hay nada que contarle a la agencia".
// El botón que había pedía a una persona que repitiera ese razonamiento y
// acertara; podía cerrarla antes de tiempo o dejarla abierta para siempre, y en
// los dos casos la pantalla decía algo que no era.

/**
 * Las candidaturas de una SOLICITUD, con la forma que espera su tabla y su Excel.
 *
 * Se responde por solicitud, que es lo que la agencia mandó. Agrupar por fecha
 * de entrevista mezclaba dos solicitudes que citaran el mismo día y partía en
 * dos las que ocupaban dos jornadas.
 */
async function paraETT({ solicitudId } = {}) {
  // SOLO HAY SEGUNDO ENVIO SI QUEDA ALGUIEN PENDIENTE DE ASIGNAR.
  //
  // Se comprueba antes de construir nada: de poco sirve dejar generar un Excel
  // que no habria que mandar. La regla la decide la vista —esta escrita una sola
  // vez, en `puede_enviar`—, y aqui solo se obedece.
  if (solicitudId) {
    const s = (await db.consulta('SELECT * FROM v_solicitud_ett WHERE id = $1',
      [Number(solicitudId)])).rows[0];
    if (!s) throw new Error('No existe esa solicitud');
    // El "sin decidir" se deja pasar aposta: unas lineas mas abajo se vuelve a
    // mirar y alli si se puede decir QUIENES faltan, que es lo accionable.
    if (!s.puede_enviar && !s.sin_decidir) throw new Error(porQueNoSeManda(s));
  }

  let filas = await listar({ canal: 'bolsa_ett', incluirCerradas: true });
  if (solicitudId) filas = filas.filter(c => String(c.solicitud_id) === String(solicitudId));

  // LA SOLICITUD SE MANDA ENTERA. Si alguien sigue sin decidir, no se genera nada.
  //
  // Mandarla a medias sería peor que no mandarla: la agencia da por cerrado lo
  // que recibe, y quien saliera en blanco quedaría en tierra de nadie — ni
  // contratado, ni descartado, ni esperando. Se para aquí y se dice quién falta.
  //
  // "Sin decidir" lo dice la base: `etiqueta_ett` en NULL. Estaba escrito en una
  // constante aquí, y era un dato disfrazado de código.
  const sinDecidir = filas.filter(c => !c.inicio_previsto && !c.etiqueta_ett);
  if (sinDecidir.length) {
    const e = new Error(
      porQueNoSeManda({ sin_decidir: sinDecidir.length }) +
      ' Faltan: ' + sinDecidir.map(c => c.quien).join(', '));
    e.sinDecidir = sinDecidir.map(c => ({ id: c.id, quien: c.quien, estado: c.estado_etiqueta }));
    throw e;
  }

  const dosCifras = n => String(n).padStart(2, '0');

  // Una fecha como la escribe la agencia: DD/MM/AAAA.
  //
  // Con getDate() y NO con getUTCDate(). El driver devuelve un DATE como
  // medianoche LOCAL, así que en horario de verano el UTC de esa medianoche cae
  // en el día anterior: leerlo en UTC restaba un día a todas las fechas.
  const aDiaMesAnio = v => {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return '';
    return `${dosCifras(d.getDate())}/${dosCifras(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  return filas.map(c => {
    const cita = c.entrevista_at ? new Date(c.entrevista_at) : null;

    // CONTRATADO LO DICE LA FECHA DE ALTA, no tener contrato abierto.
    //
    // El orden importa y va al revés de lo que parece: este Excel es lo que HACE
    // que la agencia dé el alta en la Seguridad Social. Si esperásemos a que el
    // contrato exista para decirles "contratado", no se lo diríamos nunca —
    // están esperando a que se lo digamos nosotros.
    //
    // Poner fecha de alta es la decisión de contratar, y además es lo que
    // significa "ya está planificado".
    //
    // Una salida manda sobre la fecha: quien no se presentó no es un contratado
    // aunque alguien le hubiera puesto fecha antes de saberlo.
    const dicho = c.etiqueta_ett;
    const estado = (dicho === 'No pasa' || dicho === 'No se presentó') ? dicho
      : c.inicio_previsto ? 'Contratado'
        : (dicho || 'Pendiente');

    // A la agencia se le contesta con el MOTIVO, no con un hueco: si alguien no
    // se presentó o no pasó, eso es justo lo que tiene que leer en esa casilla.
    let alta = aDiaMesAnio(c.inicio_previsto);
    let jor = c.jornada_horas ? c.jornada_horas + 'h' : '';
    let tur = c.turno || '';
    let zon = c.zona || '';
    // A quien no pasa se le manda EL MOTIVO, no una frase hecha.
    //
    // Antes en esa casilla iba siempre "No pasa la entrevista", dijera lo que
    // dijera la realidad: la agencia recibía la misma frase para el que rechazó
    // la oferta y para el que no cumplía los requisitos. Ahora va lo que se
    // eligió del catálogo, que es el justificante que ellos esperan.
    if (estado === 'No se presentó' || estado === 'No pasa') {
      alta = c.motivo || (estado === 'No se presentó' ? 'No se presentó' : 'No pasa la entrevista');
      jor = tur = zon = '';
    }

    return {
      fecha_entrevista: cita ? `${dosCifras(cita.getDate())}/${dosCifras(cita.getMonth() + 1)}/${cita.getFullYear()}` : '',
      hora_entrevista: cita ? `${dosCifras(cita.getHours())}:${dosCifras(cita.getMinutes())}h` : '',
      jornada_ett: c.jornada_ett || '', turno_ett: c.turno_ett || '',
      nombre: c.quien || '', dni: c.dni_nie || '', telefono: c.telefono || '',
      direccion: c.via_nombre || c.direccion || '', cp: c.codigo_postal || '',
      correo: c.email || '',
      fecha_alta: alta, jornada: jor, turno: tur, zona: zon,
      estado,
    };
  });
}

/**
 * Borra una candidatura, y a la persona si solo existia por ella.
 *
 * NO es lo mismo que descartar. Descartar es una decision del proceso y deja
 * rastro: esa persona se presento y no paso, y eso es historia que sirve. Esto
 * es para cuando la candidatura NO DEBERIA EXISTIR — un telefono mal tecleado,
 * una fila duplicada, una prueba.
 *
 * Se niega en seco si la persona ha tenido algun periodo de empleo, aunque este
 * cerrado. Eso ya no es un candidato: es alguien que trabajo aqui, y su
 * historial laboral no se borra desde una pantalla de seleccion.
 *
 * A la persona solo se la lleva por delante si no le queda nada mas: ni empleo,
 * ni otra candidatura. Si la ficha ya existia antes (una restauracion), se
 * queda: no la creo este proceso y no le toca a este proceso borrarla.
 */
async function eliminar(id, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    const k = (await cli.query(
      `SELECT k.conductor_id, k.estado,
              btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
              (SELECT count(*)::int FROM conductor_periodo_empleo e
                WHERE e.conductor_id = k.conductor_id)              AS empleos,
              (SELECT count(*)::int FROM candidatura o
                WHERE o.conductor_id = k.conductor_id AND o.id <> k.id) AS otras
         FROM candidatura k JOIN conductor c ON c.id = k.conductor_id
        WHERE k.id = $1`, [Number(id)])).rows[0];
    if (!k) throw new Error('No existe esa candidatura');

    if (k.empleos) {
      throw new Error(`${k.quien} ha trabajado aquí: su ficha no se borra desde Selección. ` +
                      'Si no debe seguir en el proceso, descártala en vez de borrarla.');
    }

    await cli.query('DELETE FROM candidatura WHERE id = $1', [Number(id)]);

    // La persona, solo si no le queda nada. El resto de sus cosas —telefonos,
    // alias, documentos— caen solas por las claves foraneas.
    let personaBorrada = false;
    if (!k.otras) {
      await cli.query('DELETE FROM conductor WHERE id = $1', [k.conductor_id]);
      personaBorrada = true;
    }

    // El registro SI se queda. Es una tabla sin clave foranea a proposito, justo
    // para poder decir que existio algo que ya no existe.
    await audit.registrar({
      tabla: 'candidatura', id: Number(id), usuarioId,
      cambios: [{ campo: 'eliminada', antes: `${k.quien} · ${k.estado}`, ahora: null }],
    });

    return { id: Number(id), quien: k.quien, personaBorrada };
  });
}

module.exports = {
  CAMPOS, catalogos, listar, ficha, porTelefono, abrir, guardar,
  cambiarEstado, descartar, pasarARRHH, eliminar, faltantes, paraFicha, importarMatriz, parsearMatriz,
  paraETT, solicitudesETT, registrarEnvio,
};
