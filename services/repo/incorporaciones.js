// ============================================================
// INCORPORACIONES — la alerta que no se va hasta aceptarla o rechazarla
// ============================================================
// Cuando alguien se da de alta CON UNA VACANTE —desde Selección, desde la ETT o
// desde el alta rápida—, nace aquí una alerta 'pendiente' con la FOTO de la
// vacante: qué plazas se le prometieron, con qué coche, qué días y desde cuándo.
// Tráfico la ve en el planificador y en Pendientes, y solo hay dos salidas:
//
//   · ACEPTAR  → se coloca en las plazas prometidas (todo o nada). La vacante
//                queda CUBIERTA.
//   · RECHAZAR → el conductor queda en el banquillo para colocarlo a mano y la
//                vacante vuelve a estar ABIERTA.
//
// ── Y DESDE EL 23/09/2026 LA PLAZA SE OCUPA AL DAR EL ALTA ─────────────────
// Quien entra con una vacante elegida NO espera a que nadie acepte: se mete en
// el cuadrante en el acto, desde su fecha prevista de alta (`colocada_at`).
// Mientras esperaba, la plaza seguía libre a la vista de todos y se la podía
// llevar otro, y el recién contratado no estaba en ninguna parte.
//
// La alerta sigue naciendo 'pendiente', pero ya no pregunta: avisa. Aceptar es
// confirmar lo que ya está —no vuelve a colocar a nadie— y RECHAZAR tiene que
// SACARLO del cuadrante, que es lo que antes no hacía falta porque no había
// nada escrito.
//
// ── Qué cambió al mover la vacante a PostgreSQL ─────────────────────────────
// Antes la vacante guardaba MATRÍCULAS, así que aceptar significaba salir a
// buscar una plaza libre de ese coche y turno. Si entre la promesa y el alta
// alguien la ocupaba, el alta fallaba en el último paso —con la persona ya
// contratada— y no había forma de saber que iba a pasar.
//
// Ahora la vacante apunta a la PLAZA desde el primer momento, y eso además hace
// posible el RECAMBIO: la plaza puede estar ocupada por quien se va. Colocar
// cierra su asignación la víspera (lo hace `colocar`, no esto), así que el
// relevo queda encadenado sin un solo día de coche parado.

const db = require('../db');
const vacantes = require('./vacantes');

// Las letras de la semana, para traducir los días de un CT. Del núcleo.
const { LETRAS_DIA: LETRAS } = require('../nucleo');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fecha = d => (ISO.test(String(d || '')) ? String(d) : null);

/**
 * Crea la alerta al dar de alta. Si viene con vacante, toma su foto y la marca
 * "en proceso" para que Selección deje de ofrecerla.
 *
 * SIN VACANTE TAMBIÉN NACE LA ALERTA (18/09/2026). Antes no: alguien se daba de
 * alta sin plaza prometida y el planificador no se enteraba de que había una
 * persona nueva esperando coche. La alerta sin vacante no tiene nada que
 * aceptar —no hay plazas prometidas— y se va sola en cuanto se le da una plaza
 * en el cuadrante, que es lo que quería decir.
 *
 * @param {{conductorId, vacanteId, origen, desde, usuarioId}} o
 *        `vacanteId` acepta el código ('V…') o el id numérico, o nada.
 */
async function crear({ conductorId, vacanteId, origen = 'ett', desde, usuarioId } = {}) {
  const ref = String(vacanteId || '').trim();
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) return null;

  if (!ref) return crearSinVacante({ conductorId: cid, origen, desde, usuarioId });

  const v = await vacantes.ficha(ref);
  if (!v) throw new Error(`No existe la vacante ${ref}`);
  if (v.estado === 'cubierta' || v.estado === 'anulada') {
    throw new Error(`La vacante ${v.codigo} ya está ${v.estado}`);
  }

  const detalle = fotoDe(v, desde);

  const r = await db.consulta(
    `INSERT INTO incorporacion (conductor_id, vacante_id, origen, detalle, usuario_alta)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [cid, v.codigo, origen, JSON.stringify(detalle), usuarioId || null]);

  try { await vacantes.cambiarEstado(v.id, 'proceso', { usuarioId }); } catch (e) {
    console.error(`⚠️  [Incorporación] no se pudo reservar ${v.codigo}: ${e.message}`);
  }
  return { id: String(r.rows[0].id), vacanteId: v.codigo, plazas: detalle.plazas.length, detalle };
}

/**
 * La foto de la vacante que se guarda en la incorporación.
 *
 * Si mañana alguien toca la vacante, la alerta sigue diciendo lo que se
 * prometió el día del alta. Está en su propia función porque ahora la toman
 * DOS caminos: el alta con vacante y la vacante que llega después.
 */
function fotoDe(v, desde) {
  return {
    codigo: v.codigo, vacanteId: v.id, puesto: v.puesto, rol: v.rol,
    turno: v.turno, zonas: v.zonas, libranzas: v.libranzas,
    jornadaHoras: v.jornadaHoras, motivo: v.motivo,
    sustituye: v.sustituye || '', sustituyeA: v.sustituyeA || null,
    salidaPrevista: v.salidaPrevista || null,
    desde: fecha(desde),
    plazas: (v.plazas || []).map(p => ({
      plazaId: p.plazaId, matricula: p.matricula, zona: p.zona,
      rol: p.rol, turno: p.turno,
      dias: p.dias.slice(), letras: p.letras,
      ocupa: p.ocupa || '', ocupaId: p.ocupaId || null,
    })),
    // Se mantiene la forma vieja al lado para que nada de lo que aún la lee se
    // quede sin datos. Los días, en índice 0..6, como los escribía la hoja.
    matriculas: (v.plazas || []).map(p => ({
      m: p.matricula, zona: p.zona, d: p.dias.map(d => d - 1), letras: p.letras.replace(/ /g, ''),
    })),
  };
}

/**
 * Le pone -o le quita- la vacante a quien YA SE DIO DE ALTA pero TODAVÍA NO
 * HA ENTRADO: su incorporación sigue pendiente de colocar en el cuadrante.
 *
 * ── POR QUÉ HACE FALTA (24/09/2026) ─────────────────────────────────────────
 * La incorporación se crea en el alta con la foto de la vacante que tuviera la
 * candidatura EN ESE MOMENTO. A Víctor Jiménez le dieron de alta a las 08:02
 * sin vacante y se la pusieron a las 08:23: la candidatura la aceptó, pero la
 * incorporación nunca se enteró, y el planificador siguió diciendo "sin plaza
 * prometida" con una vacante en proceso a su nombre. No estaba prohibido
 * ponerla después; simplemente no llegaba a ningún sitio.
 *
 * Solo toca la incorporación PENDIENTE. Si ya está colocada, esa persona tiene
 * su sitio en el cuadrante y moverla es cosa del planificador, no de un campo
 * de Selección. Y conserva el `desde` del alta: la fecha de entrada no cambia
 * porque cambie la plaza.
 *
 * Devuelve null si no hay nada pendiente que tocar.
 */
async function ponerVacante(conductorId, ref, { usuarioId } = {}) {
  const inc = (await db.consulta(
    `SELECT id, vacante_id, detalle FROM incorporacion
      WHERE conductor_id = $1 AND estado = 'pendiente'
      ORDER BY id DESC LIMIT 1`, [Number(conductorId)])).rows[0];
  if (!inc) return null;
  const desde = fecha((inc.detalle || {}).desde);

  if (!ref) {
    await db.consulta(
      'UPDATE incorporacion SET vacante_id = NULL, detalle = $2::jsonb WHERE id = $1',
      [inc.id, JSON.stringify({ sinVacante: true, desde })]);
    return { id: String(inc.id), vacanteId: '', plazas: 0 };
  }

  const v = await vacantes.ficha(ref);
  if (!v) throw new Error(`No existe la vacante ${ref}`);
  if (v.estado === 'cubierta' || v.estado === 'anulada') {
    throw new Error(`La vacante ${v.codigo} ya está ${v.estado}`);
  }
  const detalle = fotoDe(v, desde);
  await db.consulta(
    'UPDATE incorporacion SET vacante_id = $2, detalle = $3::jsonb WHERE id = $1',
    [inc.id, v.codigo, JSON.stringify(detalle)]);
  console.log(`📌 [Incorporación ${inc.id}] ahora con la vacante ${v.codigo}` +
              ` (${detalle.plazas.length} plaza/s), por ${usuarioId || 'el sistema'}`);
  return { id: String(inc.id), vacanteId: v.codigo, plazas: detalle.plazas.length };
}

/**
 * La alerta de quien entra SIN plaza prometida: «este ha entrado, hay que
 * colocarlo». No hay foto de vacante que guardar, solo desde cuándo cuenta.
 *
 * No se duplica: si ya tiene una pendiente, se devuelve la que hay. Alguien que
 * cambia de contrato dos veces en una semana no genera dos avisos iguales.
 */
async function crearSinVacante({ conductorId, origen, desde, usuarioId }) {
  const ya = await db.consulta(
    `SELECT id FROM incorporacion
      WHERE conductor_id = $1 AND estado = 'pendiente' AND vacante_id IS NULL`, [conductorId]);
  if (ya.rows.length) return { id: String(ya.rows[0].id), vacanteId: '', plazas: 0, detalle: {} };

  const detalle = { sinVacante: true, desde: fecha(desde) };
  const r = await db.consulta(
    `INSERT INTO incorporacion (conductor_id, vacante_id, origen, detalle, usuario_alta)
     VALUES ($1, NULL, $2, $3::jsonb, $4) RETURNING id`,
    [conductorId, String(origen || 'seleccion').slice(0, 20), JSON.stringify(detalle),
     usuarioId || null]);
  return { id: String(r.rows[0].id), vacanteId: '', plazas: 0, detalle };
}

/** Las alertas pendientes, con el conductor con nombre de BOLT y teléfono. */
async function pendientes() {
  const r = await db.consulta(
    `SELECT i.id, i.conductor_id, i.vacante_id, i.origen, i.detalle, i.creado_at,
            COALESCE(ext.externo_nombre,
                     NULLIF(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')), ''),
                     '#' || c.id::text) AS nombre,
            tel.e164 AS telefono,
            e.alta::text AS alta
       FROM incorporacion i
       JOIN conductor c ON c.id = i.conductor_id
       LEFT JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
       LEFT JOIN LATERAL (
         SELECT externo_nombre FROM conductor_externo
          WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
          ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE i.estado = 'pendiente'
        -- LA ALERTA SIN VACANTE SE VA SOLA AL PLANIFICARLO.
        --
        -- Es lo que significa: «hay alguien nuevo sin coche». En cuanto tiene
        -- una plaza en el cuadrante, ya no hay nada que avisar y nadie tiene
        -- que acordarse de cerrarla. La que SÍ trae vacante no se toca: esa se
        -- acepta o se rechaza, porque además hay una vacante que cubrir o que
        -- volver a abrir.
        AND (i.vacante_id IS NOT NULL OR NOT EXISTS (
              SELECT 1 FROM asignacion a
               WHERE a.conductor_id = i.conductor_id
                 AND a.retirada_at IS NULL
                 AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)))
      ORDER BY i.creado_at`);
  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), nombre: x.nombre,
    telefono: x.telefono || '', alta: x.alta || '', vacanteId: x.vacante_id || '',
    origen: x.origen, detalle: x.detalle || {}, creadoAt: x.creado_at,
  }));
}

async function viva(id) {
  const r = await db.consulta(
    `SELECT id, conductor_id, vacante_id, detalle, colocada_at,
            -- EN TEXTO, no como DATE. El driver devuelve un Date a medianoche
            -- local y "String(fecha).slice(0,10)" da "Mon Sep 28", que la base
            -- rechaza al volver a entrar. Es la trampa de siempre.
            colocada_desde::text AS colocada_desde
       FROM incorporacion
      WHERE id = $1 AND estado = 'pendiente'`, [Number(id)]);
  if (!r.rows.length) throw new Error('Esa incorporación ya no está pendiente');
  return r.rows[0];
}

/**
 * LO QUE HAY QUE ESCRIBIR PARA COLOCARLO: las plazas prometidas, ya en forma de
 * `slots`, y el día desde el que valen.
 *
 * AQUÍ NO SE COLOCA A NADIE, y ese es el cambio: colocar es escribir en el
 * cuadrante, o sea Planificación, y este fichero lo usan también Selección y la
 * ETT. Mientras lo hacía él, un repositorio compartido tenía dentro el
 * repositorio de otro módulo. Ahora prepara el encargo y lo cumple
 * `tablero.service.aceptarIncorporacion`, que es quien tiene el cuadrante.
 *
 * `desde` decide el día. Por defecto, el alta del conductor —empieza cuando
 * empieza él—; si la vacante era de recambio, ese mismo día se cierra la
 * asignación del que se va, la víspera.
 */
async function encargoDeColocar(id, { desde } = {}) {
  const inc = await viva(id);
  const det = inc.detalle || {};

  // Las plazas de la foto. Si la alerta es vieja y solo trae matrículas, se
  // resuelven contra la vacante viva antes de rendirse.
  let plazas = (det.plazas || []).filter(p => p.plazaId);
  if (!plazas.length && inc.vacante_id) {
    const v = await vacantes.ficha(inc.vacante_id);
    plazas = (v && v.plazas) || [];
  }
  if (!plazas.length) throw new Error('La vacante no trae plazas: colócalo a mano desde el planificador');

  const dia = fecha(desde) || fecha(det.desde) || (await db.consulta(
    `SELECT alta::text AS alta FROM conductor_periodo_empleo
      WHERE conductor_id = $1 AND baja IS NULL ORDER BY alta DESC LIMIT 1`,
    [inc.conductor_id])).rows.map(x => x.alta)[0] || null;

  const slots = plazas.map(p => {
    const s = { plazaId: String(p.plazaId), id: String(inc.conductor_id) };
    if (dia) s.desde = dia;
    // Un fijo no lleva días: cubre toda la semana que su coche sale.
    if (p.rol === 'CT' && (p.dias || []).length) {
      s.dias = p.dias.map(d => LETRAS[d - 1]).join(' ');
    }
    return s;
  });

  return { id: inc.id, vacanteId: inc.vacante_id, conductorId: inc.conductor_id, dia, slots };
}

/**
 * Deja constancia de que ya está METIDA EN EL CUADRANTE, sin resolverla.
 *
 * Sigue 'pendiente' a propósito: Tráfico la ve y puede rechazarla. Lo que
 * cambia es que rechazar ya no es gratis —hay que sacarlo—, y esto es lo que
 * deja saberlo.
 */
async function marcarColocada(id, { desde } = {}) {
  const dia = fecha(desde);
  if (!dia) throw new Error('Para dar por colocada una incorporación hace falta el día');
  await db.consulta(
    `UPDATE incorporacion SET colocada_at = now(), colocada_desde = $2::date
      WHERE id = $1 AND estado = 'pendiente'`, [Number(id), dia]);
  return { ok: true, desde: dia };
}

/**
 * LO QUE HAY QUE ESCRIBIR PARA SACARLO: las plazas que ocupa POR ESTA
 * incorporación, en forma de slots vacíos.
 *
 * SOLO LAS QUE SIGUE OCUPANDO ÉL. Entre que se colocó y que alguien la rechaza
 * pueden haber pasado cosas: que le movieran de coche, que otro ocupe ya esa
 * plaza. Vaciar a ciegas sacaría al que no es, así que se comprueba una a una
 * quién está dentro AHORA.
 */
async function encargoDeQuitar(id) {
  const inc = await viva(id);
  if (!inc.colocada_at) return { id: inc.id, dia: null, slots: [] };
  const dia = fecha(inc.colocada_desde);
  const det = inc.detalle || {};
  const plazas = (det.plazas || []).filter(p => p.plazaId).map(p => String(p.plazaId));
  if (!plazas.length) return { id: inc.id, dia, slots: [] };

  const r = await db.consulta(
    `SELECT DISTINCT a.plaza_id
       FROM asignacion a
      WHERE a.plaza_id = ANY($1::bigint[])
        AND a.conductor_id = $2
        AND a.retirada_at IS NULL
        AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)`,
    [plazas, inc.conductor_id]);

  return {
    id: inc.id, dia,
    slots: r.rows.map(x => ({ plazaId: String(x.plaza_id), ...(dia ? { desde: dia } : {}) })),
  };
}

/**
 * Darla por ACEPTADA y cerrar su vacante. Se llama DESPUÉS de colocar: si la
 * colocación falla —`plan.guardar` es todo o nada—, la alerta sigue pendiente y
 * se puede reintentar.
 */
async function marcarAceptada(id, { usuarioId, vacanteId } = {}) {
  await db.consulta(
    `UPDATE incorporacion SET estado = 'aceptada', usuario_res = $2, resuelto_at = now()
      WHERE id = $1 AND estado = 'pendiente'`, [Number(id), usuarioId || null]);
  if (vacanteId) {
    try {
      await vacantes.cambiarEstado(vacanteId, 'cubierta',
        { motivo: 'Cubierta al aceptar la incorporación', usuarioId });
    } catch (e) {
      console.error(`⚠️  [Incorporación] no se pudo cerrar ${vacanteId}: ${e.message}`);
    }
  }
}

/**
 * RECHAZAR: el conductor queda en el banquillo para colocarlo a mano y la
 * vacante vuelve a estar abierta (a esa vacante no llegó a entrar nadie).
 */
async function rechazar(id, { usuarioId, motivo } = {}) {
  const inc = await viva(id);
  await db.consulta(
    `UPDATE incorporacion SET estado = 'rechazada', motivo_rechazo = $2,
            usuario_res = $3, resuelto_at = now()
      WHERE id = $1 AND estado = 'pendiente'`,
    [inc.id, String(motivo || '').trim().slice(0, 300) || null, usuarioId || null]);
  if (inc.vacante_id) {
    try { await vacantes.cambiarEstado(inc.vacante_id, 'abierta', { usuarioId }); } catch (e) {
      console.error(`⚠️  [Incorporación] no se pudo reabrir ${inc.vacante_id}: ${e.message}`);
    }
  }
  return { ok: true };
}

module.exports = {
  crear, ponerVacante, pendientes, encargoDeColocar, encargoDeQuitar,
  marcarColocada, marcarAceptada, rechazar, viva,
};
