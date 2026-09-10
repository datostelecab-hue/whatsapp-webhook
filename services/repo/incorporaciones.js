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
//                vacante vuelve a estar ABIERTA (a esa vacante nunca entró nadie).
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
const plan = require('./planificador');
const vacantes = require('./vacantes');

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fecha = d => (ISO.test(String(d || '')) ? String(d) : null);

/**
 * Crea la alerta al dar de alta con vacante. Toma la foto de la vacante y la
 * marca "en proceso" para que Selección deje de ofrecerla.
 * Sin vacante no hace nada: el alta sin vacante sigue siendo un alta normal.
 *
 * @param {{conductorId, vacanteId, origen, desde, usuarioId}} o
 *        `vacanteId` acepta el código ('V…') o el id numérico.
 */
async function crear({ conductorId, vacanteId, origen = 'ett', desde, usuarioId } = {}) {
  const ref = String(vacanteId || '').trim();
  const cid = Number(conductorId);
  if (!ref || !Number.isInteger(cid) || cid <= 0) return null;

  const v = await vacantes.ficha(ref);
  if (!v) throw new Error(`No existe la vacante ${ref}`);
  if (v.estado === 'cubierta' || v.estado === 'anulada') {
    throw new Error(`La vacante ${v.codigo} ya está ${v.estado}`);
  }

  // La foto: si mañana alguien toca la vacante, la alerta sigue diciendo lo que
  // se prometió el día del alta.
  const detalle = {
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

  const r = await db.consulta(
    `INSERT INTO incorporacion (conductor_id, vacante_id, origen, detalle, usuario_alta)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [cid, v.codigo, origen, JSON.stringify(detalle), usuarioId || null]);

  try { await vacantes.cambiarEstado(v.id, 'proceso', { usuarioId }); } catch (e) {
    console.error(`⚠️  [Incorporación] no se pudo reservar ${v.codigo}: ${e.message}`);
  }
  return { id: String(r.rows[0].id), vacanteId: v.codigo, plazas: detalle.plazas.length, detalle };
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
      ORDER BY i.creado_at`);
  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), nombre: x.nombre,
    telefono: x.telefono || '', alta: x.alta || '', vacanteId: x.vacante_id || '',
    origen: x.origen, detalle: x.detalle || {}, creadoAt: x.creado_at,
  }));
}

async function viva(id) {
  const r = await db.consulta(
    `SELECT id, conductor_id, vacante_id, detalle FROM incorporacion
      WHERE id = $1 AND estado = 'pendiente'`, [Number(id)]);
  if (!r.rows.length) throw new Error('Esa incorporación ya no está pendiente');
  return r.rows[0];
}

/**
 * ACEPTAR: coloca al conductor en las plazas PROMETIDAS.
 *
 * Todo o nada: `plan.guardar` va en una transacción, así que si una plaza ya no
 * existe no se escribe ninguna y la alerta sigue pendiente.
 *
 * `desde` decide el día. Por defecto, el alta del conductor —empieza cuando
 * empieza él—; si la vacante era de recambio, ese mismo día se cierra la
 * asignación del que se va, la víspera.
 */
async function aceptar(id, { usuarioId, desde } = {}) {
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

  const r = await plan.guardar([{ slots }], { dia, usuarioId });

  await db.consulta(
    `UPDATE incorporacion SET estado = 'aceptada', usuario_res = $2, resuelto_at = now()
      WHERE id = $1 AND estado = 'pendiente'`, [inc.id, usuarioId || null]);
  if (inc.vacante_id) {
    try {
      await vacantes.cambiarEstado(inc.vacante_id, 'cubierta',
        { motivo: 'Cubierta al aceptar la incorporación', usuarioId });
    } catch (e) {
      console.error(`⚠️  [Incorporación] no se pudo cerrar ${inc.vacante_id}: ${e.message}`);
    }
  }
  // Quién se quedó sin plaza al colocarlo: en un recambio, el que se va. Se
  // devuelve para poder decirlo en pantalla en vez de que se descubra solo.
  const relevados = r.hechos.filter(h => h.que === 'coloca' && h.cerrada);
  return { ok: true, plazas: slots.length, desde: dia, relevados: relevados.length, hechos: r.hechos };
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

module.exports = { crear, pendientes, aceptar, rechazar };
