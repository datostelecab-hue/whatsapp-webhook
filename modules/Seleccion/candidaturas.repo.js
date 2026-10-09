// ============================================================
// CANDIDATURAS — el embudo de Selección sobre PostgreSQL
// ============================================================
// Sustituye a leer la hoja TICKETS y cruzarla en JavaScript.
//
// LA REGLA DE ESTE MÓDULO: aquí solo vive el PROCESO. El nombre, el DNI, la
// dirección, el NAF y los documentos son de la persona, y la persona ya tiene
// tablas. Cuando llega un dato de esos, se guarda donde le toca — no se copia.
//
// Un candidato es una fila de `conductor` SIN periodo de empleo. Eso no es un
// apaño: es literalmente lo que significa "todavía no trabaja aquí". Y le da
// desde el primer día lo que la hoja nunca tuvo — que su DNI no se repita y que
// su teléfono no sea el de otro.
//
// AQUÍ SOLO HAY DATOS (01/10/2026). Lo que coordina con Conductores —abrir,
// guardar, pasar a RRHH, importar la matriz, tramitar— vive en
// `candidaturas.service.js` y entra por la puerta de Conductores; hasta ese día
// vivía aquí y entraba en su repositorio por la puerta de atrás. Sus consultas
// se han quedado en este fichero, cada una con el texto que tenía. Desde fuera
// se entra por el servicio.

const db = require('../../services/db');
const alta = require('../../services/repo/alta');
const audit = require('../../services/repo/auditoria');
const largos = require('../../services/repo/largos');

// Las columnas del embudo que se pueden escribir desde la pantalla. Lo que no
// esté aquí, o es de la persona o no se toca.
// FUERA DE ESTA LISTA, A PROPOSITO (18/09/2026):
//
//   · `carne_vtc`      no se exige para contratar y obligaba a teclear "true"
//                      en un hueco de texto para poder seguir.
//   · `excel_alta`     lo escribe `marcarExcel` cuando la ficha va en un envio,
//                      no una persona a mano.
//   · `pin_ballenoil`  y sus observaciones: Ballenoil ya no forma parte del alta.
//
// Las columnas se quedan en la base por lo ya escrito; lo que desaparece es el
// hueco donde teclearlas.
const CAMPOS = {
  canal:             { etiqueta: 'Canal de origen' },
  experiencia:       { etiqueta: 'Experiencia', tipo: 'booleano' },
  prueba_conduccion: { etiqueta: 'Prueba de conducción', tipo: 'booleano' },
  apto_medico:       { etiqueta: 'Apto médico', tipo: 'booleano' },
  // La vacante que este candidato viene a cubrir. `vacante_ref` era el id de la
  // hoja y se queda por lo escrito; la verdad es la foránea.
  vacante_id:        { etiqueta: 'Vacante', tipo: 'numero' },
  vacante_ref:       { etiqueta: 'Vacante (referencia vieja)' },
  turno_id:          { etiqueta: 'Turno', tipo: 'numero' },
  base_zona_id:      { etiqueta: 'Zona', tipo: 'numero' },
  inicio_previsto:   { etiqueta: 'Fecha de inicio', tipo: 'fecha' },
  jornada_horas:     { etiqueta: 'Jornada (horas)', tipo: 'numero' },
  tipo_contrato:     { etiqueta: 'Tipo de contrato' },
  responsable:       { etiqueta: 'Responsable' },
  notas:             { etiqueta: 'Notas' },
  num_hijos:         { etiqueta: 'Nº de hijos', tipo: 'numero' },
  tipo_carnet:       { etiqueta: 'Tipo de carné' },
};

/**
 * Las tablas de los desplegables, tal cual.
 *
 * Lo que recibe la pantalla —con los campos editables y el recorrido— lo arma
 * `candidaturas.service.catalogos`: para eso hay que saber qué campos son de la
 * persona, y eso lo dice Conductores.
 */
async function catalogosBase() {
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
  return {
    estados: estados.rows, etapas: etapas.rows, canales: canales.rows, turnos: turnos.rows,
    zonas: zonas.rows, jornadas: jornadas.rows, motivos: motivos.rows,
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
  return conCarnet(r.rows);
}

/**
 * Pega a cada candidatura las fechas del carne, para que el formulario de Datos
 * salga relleno con lo que ya haya.
 *
 * Una sola consulta para toda la lista, no una por fila. Y en dd/mm/aaaa ya
 * desde la base: un DATE pasado por JS se va al dia anterior en Madrid (ver la
 * trampa de toISOString en el vault).
 */
async function conCarnet(filas) {
  const ids = [...new Set((filas || []).map(f => f.conductor_id).filter(Boolean).map(String))];
  if (!ids.length) return filas;
  const r = await db.consulta(
    `SELECT DISTINCT ON (conductor_id) conductor_id,
            to_char(fecha_emision, 'DD/MM/YYYY') AS exp,
            to_char(fecha_caduca,  'DD/MM/YYYY') AS cad
       FROM documento
      WHERE tipo = 'permiso' AND vigente AND conductor_id = ANY($1::bigint[])
      ORDER BY conductor_id, id DESC`, [ids]);
  const m = new Map(r.rows.map(x => [String(x.conductor_id), x]));
  filas.forEach(f => {
    const x = m.get(String(f.conductor_id));
    f.carnet_expedicion = x ? x.exp : null;
    f.carnet_caducidad = x ? x.cad : null;
  });
  return filas;
}

/**
 * La fila de una candidatura, con las fechas del carné. Los documentos no: son
 * de la persona, y los pone `candidaturas.service.ficha` desde Documentos.
 */
async function filaFicha(id) {
  const r = await db.consulta('SELECT * FROM v_candidatura WHERE id = $1', [Number(id)]);
  if (!r.rows[0]) return null;
  return (await conCarnet([r.rows[0]]))[0];
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

// ── Las consultas de lo que coordina el servicio ────────────────────────────
//
// `abrir`, `abrirContratada`, `guardar`, `pasarARRHH`, `importarMatriz` y
// `tramitarAlta` viven en `candidaturas.service.js` desde el 01/10/2026. El
// porqué de cada paso está allí; aquí, lo que escriben y leen.

/** Una persona tal cual está en su tabla: para ver qué huecos tiene. */
async function personaCruda(conductorId) {
  return (await db.consulta(
    'SELECT * FROM conductor WHERE id = $1', [conductorId])).rows[0];
}

/** Arranca el proceso en Preselección sobre una persona que ya existe. Devuelve el id. */
async function insertarPreseleccion(conductorId, datos = {}) {
  const r = await db.consulta(
    `INSERT INTO candidatura (conductor_id, estado, canal, responsable)
     VALUES ($1,'preseleccion',$2,$3) RETURNING id`,
    [conductorId, datos.canal || null, datos.responsable || null]);
  return r.rows[0].id;
}

/** La candidatura viva de alguien, si la tiene. */
async function vivaDe(conductorId) {
  return (await db.consulta(
    `SELECT id, inicio_previsto FROM candidatura
      WHERE conductor_id = $1 AND cerrado_at IS NULL
      ORDER BY id DESC LIMIT 1`, [conductorId])).rows[0];
}

/**
 * Lleva una candidatura viva hasta el final del embudo. Dice si se ha movido.
 *
 * Es el caso que se veia raro en la pantalla: alguien que entro por la matriz de
 * la agencia, se le dio de alta desde otro sitio, y la ETT lo seguia viendo en
 * «Coordinacion de entrevista» tres dias despues de estar conduciendo.
 *
 * Solo hacia adelante y solo desde el embudo: lo dice el ORDEN del catalogo,
 * no una lista escrita aqui. Quien ya esta en `pendiente_pin` o mas alla no
 * retrocede, y a una salida —descartado, no se presento— no se la pisa:
 * esas son decisiones de una persona y tienen orden 89 para arriba.
 */
async function adelantarAListo(id, fechaAlta) {
  const r = await db.consulta(
    `UPDATE candidatura k
        SET estado = 'listo_rrhh',
            inicio_previsto = COALESCE(k.inicio_previsto, $2::date),
            apto_at = COALESCE(k.apto_at, now()),
            actualizado_at = now()
       FROM cat_estado_candidatura e
      WHERE k.id = $1 AND e.codigo = k.estado
        AND e.orden < (SELECT orden FROM cat_estado_candidatura WHERE codigo = 'listo_rrhh')
      RETURNING k.id`,
    [id, fechaAlta || null]);
  return !!r.rows.length;
}

/** La candidatura de quien ya está contratado, abierta ya terminada. Devuelve el id. */
async function insertarContratada(conductorId, datos = {}) {
  const r = await db.consulta(
    `INSERT INTO candidatura
       (conductor_id, estado, canal, inicio_previsto, jornada_horas, tipo_contrato,
        responsable, apto_at)
     VALUES ($1, 'listo_rrhh', $2, $3, $4, $5, $6, now())
     RETURNING id`,
    [conductorId, datos.canal || null, datos.alta || null, datos.jornadaHoras || null,
     datos.tipoContrato || null, datos.responsable || null]);
  return r.rows[0].id;
}

/**
 * El valor tal y como va a la columna. Vaciar es vaciar: `''`, `null` y
 * `undefined` son lo mismo.
 *
 * `Number(null)` es 0, y ese 0 se escribía en la columna. Quitarle la vacante a
 * una ficha intentaba apuntar a la vacante 0 —que no existe— y reventaba la
 * clave ajena; quitarle el turno o la zona habría hecho lo mismo, y quitarle la
 * jornada habría dejado a alguien con un contrato de 0 horas sin que se viera.
 */
function valorDe(def, v) {
  if (v === '' || v === null || v === undefined) return null;
  if ((def || {}).tipo !== 'numero') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** De quién es una candidatura. Nada si no existe. */
async function conductorDe(id) {
  return (await db.consulta('SELECT conductor_id FROM candidatura WHERE id = $1', [Number(id)])).rows[0];
}

/**
 * Escribe las columnas del embudo que vengan.
 *
 * Solo las de CAMPOS, y se comprueba aquí porque el nombre va dentro del SQL. El
 * reparto entre lo de la persona y lo del proceso lo hace
 * `candidaturas.service.guardar`.
 */
async function guardarProceso(id, deProceso) {
  // Que quepa en su columna, dicho con el nombre de la casilla (09/10/2026).
  await largos.comprobar('candidatura', deProceso, k => (CAMPOS[k] && CAMPOS[k].etiqueta) || k);
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(deProceso)) {
    if (!CAMPOS[k]) throw new Error(`"${k}" no es un campo del proceso`);
    cols.push(`${k} = $${cols.length + 1}`);
    vals.push(valorDe(CAMPOS[k], v));
  }
  vals.push(Number(id));
  await db.consulta(
    `UPDATE candidatura SET ${cols.join(', ')}, actualizado_at = now() WHERE id = $${vals.length}`, vals);
}

/**
 * Engancha (o suelta) la vacante de una candidatura y mueve su estado.
 *
 * Se llama al guardar la ficha y al cerrarla. Nunca lanza por culpa de la
 * vacante: que una reserva no se pueda mover no puede impedir guardar los datos
 * de una persona, pero sí tiene que quedar dicho en el registro.
 */
async function engancharVacante(id, vacanteId, quien = {}) {
  const vac = require('./vacantes.repo');
  try {
    const k = (await db.consulta(
      'SELECT vacante_id, vacante_ref, estado, conductor_id FROM candidatura WHERE id = $1',
      [Number(id)])).rows[0] || {};
    const nueva = vacanteId ? String(vacanteId) : null;

    // SI YA SE DIO DE ALTA, LA VACANTE TIENE QUE LLEGAR A SU INCORPORACIÓN.
    // La incorporación se crea en el alta con la vacante de ese momento; una
    // puesta después se quedaba en la candidatura y el planificador seguía
    // diciendo "sin plaza prometida". Solo si aún no ha entrado: ver
    // `ponerVacante`.
    const aLaIncorporacion = async ref => {
      if (k.estado !== 'alta' || !k.conductor_id) return null;
      return require('./incorporaciones.repo')
        .ponerVacante(k.conductor_id, ref, { usuarioId: quien.usuarioId });
    };

    // La que tenía antes, si es otra, vuelve a estar disponible.
    if (k.vacante_ref && (!nueva || String(k.vacante_id) !== nueva)) {
      await vac.cambiarEstado(k.vacante_ref, 'abierta', { usuarioId: quien.usuarioId });
    }
    if (!nueva) {
      await db.consulta('UPDATE candidatura SET vacante_ref = NULL WHERE id = $1', [Number(id)]);
      await aLaIncorporacion(null);
      return { vacante: null };
    }
    const v = await vac.ficha(nueva);
    if (!v) throw new Error(`No existe la vacante ${nueva}`);
    // El código se guarda al lado: es lo que se lee en la ficha y lo que
    // entienden los módulos que todavía hablan el idioma de la hoja.
    await db.consulta('UPDATE candidatura SET vacante_ref = $2 WHERE id = $1', [Number(id), v.codigo]);
    await vac.cambiarEstado(v.id, 'proceso', { usuarioId: quien.usuarioId });
    const inc = await aLaIncorporacion(v.codigo);
    return { vacante: v.codigo, puesto: v.puesto, incorporacion: inc ? inc.id : null };
  } catch (e) {
    console.error(`⚠️  [CANDIDATURA ${id}] vacante ${vacanteId}: ${e.message}`);
    return { vacante: null, aviso: e.message };
  }
}

/** Suelta la vacante de una candidatura que se cierra: nadie llegó a ocuparla. */
async function soltarVacante(id, quien = {}) {
  const k = (await db.consulta(
    'SELECT vacante_ref FROM candidatura WHERE id = $1', [Number(id)])).rows[0] || {};
  if (!k.vacante_ref) return;
  try {
    await require('./vacantes.repo').cambiarEstado(k.vacante_ref, 'abierta', { usuarioId: quien.usuarioId });
  } catch (e) {
    console.error(`⚠️  [CANDIDATURA ${id}] no se pudo liberar ${k.vacante_ref}: ${e.message}`);
  }
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

  // Se cae del proceso: su vacante vuelve a ofrecerse. Sin esto, un descarte
  // dejaba la plaza bloqueada para siempre y había que acordarse de reabrirla a
  // mano —o sea, nunca—.
  if (e.es_salida) await soltarVacante(id, { usuarioId });

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

/** Lo que hay que saber de la persona antes de contratarla. */
async function paraContratar(id) {
  return (await db.consulta(
    `SELECT k.conductor_id, k.estado, c.empleo_vigente,
            btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
            (SELECT e164 FROM conductor_telefono
              WHERE conductor_id = c.id AND vigente_hasta IS NULL
              ORDER BY principal DESC, id DESC LIMIT 1) AS telefono
       FROM candidatura k JOIN conductor c ON c.id = k.conductor_id
      WHERE k.id = $1`, [Number(id)])).rows[0];
}

/** Lo pactado durante la selección: vale como contrato si no se dice otra cosa. */
async function pactado(id) {
  return (await db.consulta(
    'SELECT inicio_previsto, jornada_horas, tipo_contrato, turno_id FROM candidatura WHERE id = $1',
    [Number(id)])).rows[0];
}

/** La candidatura queda en `alta`: el contrato ya está abierto (ver `pasarARRHH`). */
async function marcarDadoDeAlta(id) {
  await db.consulta(
    `UPDATE candidatura
        SET estado = 'alta',
            apto_at = now(),
            alta_at = COALESCE(alta_at, now()),
            actualizado_at = now()
      WHERE id = $1`, [Number(id)]);
}

/** Si la persona está en BOLT, y con qué número. */
async function situacionBolt(conductorId) {
  return (await db.consulta(
    'SELECT situacion_bolt, telefono_bolt FROM v_conductor_alta_bolt WHERE conductor_id = $1',
    [conductorId])).rows[0];
}

/** El código de la vacante que viene a cubrir, si tiene. */
async function vacanteRefDe(id) {
  return (await db.consulta('SELECT vacante_ref FROM candidatura WHERE id = $1', [Number(id)]))
    .rows.map(x => x.vacante_ref)[0];
}

/**
 * Qué le falta a esta candidatura para poder contratarla.
 *
 * El listón lo pone `exigencia.repo`, que es el mismo que se aplica a los tres
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
  return require('./exigencia.repo').faltaPara(k.conductor_id, via);
}

// Las columnas y las uniones de la ficha, UNA VEZ: se piden por candidatura
// (Selección) y por persona (Plantilla), y dos copias de esta consulta serían
// dos fichas que un día dejan de parecerse.
const FICHA_COLUMNAS = `k.id, k.num_hijos,
            c.id AS conductor_id, c.nombre, c.apellidos, c.dni_nie, c.email,
            c.estado_civil, c.naf, c.direccion, c.codigo_postal,
            c.observaciones, c.iban_cifrado,
            tel.e164 AS telefono,
            -- LAS FECHAS SALEN YA ESCRITAS DE LA BASE, en dd/mm/aaaa.
            --
            -- Antes venían como DATE y se formateaban en JS con
            -- String(v).slice(0,10), que sobre un Date de node no da
            -- "2000-07-06" sino "Thu Jul 06 2000 ...". La ficha que se manda a
            -- la gestoría salía con "Thu Jul 06" en la fecha de nacimiento y
            -- con "Thu Dec 12" en la del carné. Es la trampa de siempre: un
            -- DATE de PostgreSQL se formatea con to_char y no con toISOString
            -- ni con String().
            to_char(c.fecha_nacimiento, 'DD/MM/YYYY') AS fecha_nacimiento,
            to_char(per.fecha_emision,  'DD/MM/YYYY') AS carnet_expedicion,
            to_char(per.fecha_caduca,   'DD/MM/YYYY') AS carnet_caducidad,
            -- La fecha de inicio es la prevista mientras es candidato y la REAL
            -- en cuanto se le abre el contrato: si no, la ficha de alguien que
            -- ya entró salía con el hueco en blanco, que es justo el dato que
            -- la gestoría necesita para el alta en la Seguridad Social.
            --
            -- CON CONTRATO ABIERTO MANDA SU ALTA (08/10/2026). Antes iba primero
            -- la prevista, y la ficha de quien ya tenía contrato salía con la
            -- fecha que se previó al seleccionarle, no con la de su alta.
            to_char(CASE WHEN emp.abierto THEN emp.alta ELSE COALESCE(k.inicio_previsto, emp.alta) END, 'DD/MM/YYYY') AS fecha_inicio,
            -- LA JORNADA, que la ficha no recibía: a todo el mundo le salían
            -- 40 horas y el salario de 40, también a quien tiene 32. La del
            -- contrato abierto y, si aún no lo tiene, la de su candidatura.
            CASE WHEN emp.abierto THEN emp.jornada_horas ELSE COALESCE(k.jornada_horas, emp.jornada_horas) END AS jornada_horas`;
const FICHA_UNIONES = `       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
       LEFT JOIN LATERAL (
         SELECT fecha_emision, fecha_caduca FROM documento
          WHERE conductor_id = c.id AND tipo = 'permiso' AND vigente
          ORDER BY id DESC LIMIT 1) per ON TRUE
       LEFT JOIN LATERAL (
         SELECT alta, jornada_horas, (baja IS NULL) AS abierto FROM conductor_periodo_empleo
          WHERE conductor_id = c.id ORDER BY (baja IS NULL) DESC, alta DESC LIMIT 1) emp ON TRUE`;

/** De la fila a lo que imprime la ficha. El IBAN se descifra aquí. */
function aDatosFicha(f) {
  let iban = '';
  if (f.iban_cifrado) {
    const cripto = require('../../services/cripto');
    try { iban = cripto.descifrar(f.iban_cifrado); } catch (e) { iban = '(no se pudo descifrar)'; }
  }

  return {
    conductorId: f.conductor_id,
    id: f.telefono, telefono: f.telefono,
    nombre: f.nombre, apellidos: f.apellidos, dni: f.dni_nie, email: f.email,
    fecha_nacimiento: f.fecha_nacimiento || '', estado_civil: f.estado_civil,
    num_hijos: f.num_hijos, num_seg_social: f.naf,
    direccion: f.direccion, codigo_postal: f.codigo_postal,
    carnet_expedicion: f.carnet_expedicion || '', carnet_caducidad: f.carnet_caducidad || '',
    fecha_inicio: f.fecha_inicio || '',
    // Sin jornada, la ficha pone la de por defecto (40 horas).
    ...(f.jornada_horas ? { jornada: `${f.jornada_horas} HORAS` } : {}),
    iban, observaciones: f.observaciones,
  };
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
    `SELECT ${FICHA_COLUMNAS}
       FROM candidatura k
       JOIN conductor c ON c.id = k.conductor_id
${FICHA_UNIONES}
      WHERE k.id = $1`, [Number(id)]);
  const f = r.rows[0];
  if (!f) throw new Error('No existe esa candidatura');
  return aDatosFicha(f);
}

/**
 * Los mismos datos, pedidos por la PERSONA: es lo que usa Plantilla. De los 220
 * de alta el 24/09/2026 solo 30 tenían candidatura —el resto entró antes de que
 * Selección existiera—, y la ficha es casi entera de la persona: de la
 * candidatura solo salen el nº de hijos y la fecha de inicio prevista. Sin
 * candidatura, la fecha de inicio es la de su alta y el nº de hijos va en blanco.
 */
async function paraFichaDeConductor(conductorId) {
  const r = await db.consulta(
    `SELECT ${FICHA_COLUMNAS}
       FROM conductor c
       LEFT JOIN LATERAL (
         SELECT id, num_hijos, inicio_previsto, jornada_horas FROM candidatura
          WHERE conductor_id = c.id ORDER BY creado_at DESC LIMIT 1) k ON TRUE
${FICHA_UNIONES}
      WHERE c.id = $1`, [Number(conductorId)]);
  const f = r.rows[0];
  if (!f) throw new Error('No existe esa persona');
  return aDatosFicha(f);
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

// Las consultas de `candidaturas.service.importarMatriz`, que es quien decide
// qué se hace con cada fila.

/** ¿Conocemos a esta persona? Por el DNI, aunque venga con otro número. */
async function personaPorDni(dni) {
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

/** Una tabla pegada es una solicitud: se abre y se devuelve su id. */
async function abrirSolicitud(recibida, referencia, usuarioId) {
  const r = await db.consulta(
    `INSERT INTO solicitud_ett (recibida_at, referencia, usuario_id)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3) RETURNING id`,
    [recibida || null, referencia || null, usuarioId || null]);
  return r.rows[0].id;
}

/** Ata la candidatura a la solicitud, si no tenía ninguna. */
async function atarASolicitud(candidaturaId, solicitudId) {
  await db.consulta(
    'UPDATE candidatura SET solicitud_id = COALESCE(solicitud_id, $1) WHERE id = $2',
    [solicitudId, candidaturaId]);
}

/** ¿Esta misma cita de la bolsa ya se importó? Sin cita, vale cualquiera de la bolsa. */
async function yaImportada(conductorId, entrevista) {
  const ya = await db.consulta(
    `SELECT 1 FROM candidatura
      WHERE conductor_id = $1 AND canal = 'bolsa_ett'
        AND ($2::timestamptz IS NULL OR entrevista_at = $2)
      LIMIT 1`, [conductorId, entrevista]);
  return ya.rows.length > 0;
}

/** Lo que la agencia añade al abrir: la cita, lo que pide y lo que decidimos. */
async function completarDeMatriz(id, solicitudId, m) {
  await db.consulta(
    `UPDATE candidatura
        SET estado = $1, entrevista_at = $2, jornada_ett = $3, turno_ett = $4,
            jornada_horas = $5, turno_id = $6, base_zona_id = $7,
            inicio_previsto = $8, solicitud_id = $10, actualizado_at = now()
      WHERE id = $9`,
    [m.estado, m.entrevista, m.jornadaEtt, m.turnoEtt, m.jornadaHoras, m.turnoId, m.zonaId,
     m.inicioPrevisto, id, solicitudId]);
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
/**
 * Los candidatos ELEGIDOS a mano para un Excel suelto.
 *
 * Es la otra forma de mandarle algo a la agencia, y no sustituye a la de la
 * tanda entera: aquella tiene reglas —la solicitud se manda completa o no se
 * manda— porque es LA respuesta oficial a una peticion suya. Esta es para el
 * resto de veces: "mandame otra vez estos cinco", gente de tandas distintas, o
 * lo que se quedo a medias.
 *
 * LA UNICA REGLA QUE SE MANTIENE: solo sale quien tiene algo que decir. Mandar
 * a alguien sin decidir deja a esa persona en tierra de nadie al otro lado —ni
 * contratada, ni descartada, ni esperando—, y eso da igual si va en una tanda o
 * en una lista suelta.
 */
async function paraETTElegidos(ids) {
  const lista = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!lista.length) throw new Error('No has elegido a nadie');

  let filas = await listar({ canal: 'bolsa_ett', incluirCerradas: true });
  const porId = new Map(filas.map(c => [Number(c.id), c]));

  const faltan = lista.filter(id => !porId.has(id));
  if (faltan.length) throw new Error('Hay ' + faltan.length + ' candidato(s) que ya no estan en la bolsa');

  const elegidos = lista.map(id => porId.get(id));
  const sinDecidir = elegidos.filter(c => !c.inicio_previsto && !c.etiqueta_ett);
  if (sinDecidir.length) {
    const e = new Error('Hay ' + sinDecidir.length + ' sin decidir y no se pueden mandar: '
      + sinDecidir.map(c => c.quien).join(', '));
    e.sinDecidir = sinDecidir.map(c => ({ id: c.id, quien: c.quien, estado: c.estado_etiqueta }));
    throw e;
  }
  return mapearParaETT(elegidos);
}

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

  return mapearParaETT(filas);
}

/**
 * De filas de la base a las columnas que espera la agencia.
 *
 * Vive aparte porque lo usan LAS DOS formas de generar el Excel —la tanda
 * entera y los elegidos a mano— y el formato tiene que ser el mismo byte a
 * byte: la agencia lee las columnas tal cual, y dos mapeos que se parecen es
 * como acaban diferenciandose.
 */
function mapearParaETT(filas) {
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
              -- Solo cuenta como "ha trabajado aquí" un empleo que YA EMPEZÓ. Un alta
              -- FUTURA (una prueba que se quedó ahí, sin arrancar) no cuenta: se puede
              -- borrar. Justo es el caso que la base no deja dar de baja (baja < alta),
              -- así que borrarla es lo único que se puede hacer con ella.
              (SELECT count(*)::int FROM conductor_periodo_empleo e
                WHERE e.conductor_id = k.conductor_id AND e.alta <= CURRENT_DATE) AS empleos,
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
      // Sus cuentas de BOLT/Mapon NO son suyas: se SUELTAN (vuelven a estar libres),
      // no se borran. A mano, porque al borrar el conductor la FK solo pondría
      // conductor_id a NULL y dejaría el resto del enlace puesto -> violaría
      // ck_cext_enlace ((conductor_id IS NULL) = (enlazado_at IS NULL)).
      await cli.query(
        `UPDATE conductor_externo SET conductor_id = NULL, enlazado_at = NULL, enlazado_por = NULL
          WHERE conductor_id = $1`, [k.conductor_id]);
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

// ============================================================
// EL TRAMO FINAL: RRHH y ADMINISTRACIÓN
// ============================================================
// Lo que pasa DESPUÉS de «Listo para RRHH». Vivía en `services/tickets.js`,
// sobre la pestaña TICKETS, con su propio embudo en paralelo al de aquí.
//
// ── Y ESO TENÍA UN AGUJERO ──────────────────────────────────────────────────
// El último paso de aquel camino llamaba a `crearConductor`, que escribe la
// ficha en la hoja AGENDA_V2. Desde que el cuadrante se lee de PostgreSQL, esa
// hoja NO LA LEE NADIE: quien pasara por ahí no aparecía en la Plantilla ni en
// el cuadrante. Sin error y sin aviso.
//
// Aquí no hace falta ningún traspaso: `pasarARRHH` YA dio de alta a la persona
// —abrió su contrato, le puso el turno y le enlazó la cuenta de BOLT—. Lo que
// queda de RRHH y de Administración es papeleo sobre alguien que ya existe: el
// Excel para la gestoría y el PIN de la tarjeta de combustible.

/**
 * Las fichas del tramo final. Tres montones, que son las tres preguntas que se
 * hacen en esas dos pantallas:
 *
 *   porTramitar  esperando a RRHH (listo_rrhh)
 *   hechas       de alta, o ya en Tráfico
 *   noAlta       las que no siguieron
 *
 * `pendiente_pin` se sigue leyendo aunque ya no se entre ahí (24/09/2026): el
 * servicio lo cuenta como de alta, por si alguien quedó en esa parada.
 */
async function tramoFinal() {
  // Los papeles vienen EN LA MISMA CONSULTA, como un array de tipos vigentes.
  // RRHH mira «qué le falta a este» de un vistazo sobre la lista entera; pedirlos
  // ficha a ficha serían veinte consultas para pintar una pantalla.
  const r = await db.consulta(
    `SELECT v.*, COALESCE(d.tipos, ARRAY[]::text[]) AS docs
       FROM v_candidatura v
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT doc.tipo) AS tipos
           FROM documento doc
          WHERE doc.conductor_id = v.conductor_id AND doc.vigente) d ON TRUE
      WHERE v.estado IN ('listo_rrhh', 'pendiente_pin', 'alta', 'asignado', 'no_alta', 'rechazado_rrhh')
      ORDER BY v.estado_orden, v.creado_at DESC`);
  return r.rows;
}

/**
 * Las fichas que van en un Excel de altas, con lo que pide la gestoría.
 *
 * EL IBAN SE DESCIFRA AQUÍ y solo aquí: en la base está cifrado (`iban_cifrado`)
 * y el Excel que se le manda a la gestoría lo necesita en claro. Va en una sola
 * consulta y no ficha a ficha —son grupos de diez o quince—.
 */
async function paraAltasExcel(ids) {
  if (!ids || !ids.length) return [];
  const r = await db.consulta(
    `SELECT k.id, c.nombre, c.apellidos, c.dni_nie, c.email, c.nacionalidad,
            c.direccion, c.codigo_postal, c.naf, c.iban_cifrado,
            to_char(c.fecha_nacimiento, 'DD/MM/YYYY') AS fecha_nacimiento,
            to_char(k.inicio_previsto, 'DD/MM/YYYY')  AS fecha_inicio,
            to_char(k.deteccion_at, 'DD/MM/YYYY')     AS fecha_deteccion,
            COALESCE(k.jornada_horas, pe.jornada_horas) AS jornada,
            tel.e164 AS telefono
       FROM candidatura k
       JOIN conductor c ON c.id = k.conductor_id
       LEFT JOIN conductor_periodo_empleo pe ON pe.conductor_id = c.id AND pe.baja IS NULL
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE k.id = ANY($1::bigint[])
      ORDER BY c.apellidos, c.nombre`, [ids.map(Number)]);

  const cripto = require('../../services/cripto');
  return r.rows.map(f => {
    let iban = '';
    if (f.iban_cifrado) {
      // Si no se puede descifrar se DICE en la celda, no se deja en blanco: un
      // hueco pasa desapercibido y la gestoría da el alta sin cuenta.
      try { iban = cripto.descifrar(f.iban_cifrado); } catch (_) { iban = '(no se pudo descifrar)'; }
    }
    return {
      id: f.telefono || '', nombre: f.nombre || '', apellidos: f.apellidos || '',
      dni: f.dni_nie || '', email: f.email || '', nacionalidad: f.nacionalidad || '',
      direccion: f.direccion || '', codigo_postal: f.codigo_postal || '',
      num_seg_social: f.naf || '', fecha_nacimiento: f.fecha_nacimiento || '',
      fecha_inicio: f.fecha_inicio || '', fecha_deteccion: f.fecha_deteccion || '',
      jornada: f.jornada ? String(f.jornada) : '', iban,
    };
  });
}

/**
 * Apunta que la ficha ya fue en un Excel de altas, y con cuál.
 *
 * Es lo que impide dar la misma alta dos veces: RRHH no puede tramitar a quien
 * no ha ido antes en un Excel. La regla viene del camino viejo y se conserva
 * porque el motivo sigue vivo —la gestoría cobra por alta—.
 */
async function marcarExcelAlta(ids, referencia) {
  if (!ids || !ids.length) return 0;
  const r = await db.consulta(
    `UPDATE candidatura SET excel_alta = $2, actualizado_at = now()
      WHERE id = ANY($1::bigint[]) RETURNING id`,
    [ids.map(Number), String(referencia || '').slice(0, 120)]);
  return r.rowCount;
}

/** Dónde está una candidatura del tramo final (lo mira `tramitarAlta`). */
async function paraTramitar(id) {
  return (await db.consulta(
    'SELECT estado, excel_alta, conductor_id FROM candidatura WHERE id = $1', [Number(id)])).rows[0];
}

/**
 * RRHH apunta sus fechas y la cierra. Devuelve cuántas filas tocó: 0 es que
 * alguien la tramitó mientras tanto.
 */
async function tramitar(id, fechaAlta, fechaHabilitado) {
  const r = await db.consulta(
    `UPDATE candidatura
        SET estado = 'alta',
            alta_at = COALESCE($2::timestamptz, now()),
            habilitado_at = $3::timestamptz,
            asignado_at = COALESCE(asignado_at, now()),
            actualizado_at = now()
      WHERE id = $1 AND estado = 'listo_rrhh'
      RETURNING id`,
    [Number(id), fechaAlta || null, fechaHabilitado || null]);
  return r.rowCount;
}

module.exports = {
  CAMPOS, listar, porTelefono, cambiarEstado, descartar, eliminar, faltantes,
  paraFicha, paraFichaDeConductor, parsearMatriz,
  paraETT, paraETTElegidos, solicitudesETT, registrarEnvio,
  // El tramo final: RRHH y Administración.
  tramoFinal, paraAltasExcel, marcarExcelAlta,
  // Las consultas de lo que coordina `candidaturas.service.js`.
  catalogosBase, filaFicha, personaCruda, insertarPreseleccion, vivaDe, adelantarAListo,
  insertarContratada, conductorDe, guardarProceso, engancharVacante,
  paraContratar, pactado, marcarDadoDeAlta, situacionBolt, vacanteRefDe,
  personaPorDni, abrirSolicitud, atarASolicitud, yaImportada, completarDeMatriz,
  paraTramitar, tramitar,
};
