// ============================================================
// FICHAJE DE TURNO — SQL
// ============================================================
// Quién llevaba qué coche y en qué ventana. Antes eran cuatro funciones sobre
// una pestaña; aquí son consultas con índice.
//
// El cambio que importa no es la velocidad: es que un turno abierto por persona
// y por coche lo garantizan DOS ÍNDICES ÚNICOS (db/125), no el orden en que
// lleguen dos mensajes de WhatsApp. Con la hoja, dos personas abriendo turno
// sobre el mismo coche a la vez escribían dos filas y las dos se creían dueñas.

const db = require('../db');

const tel9 = t => String(t == null ? '' : t).replace(/\D/g, '').slice(-9);
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// La forma que espera el resto del módulo, que venía de la hoja: segundos desde
// 1970 y no fechas. Se traduce aquí para no tocar la lógica de Mapon, que ya
// está probada y habla en `ts`.
const seg = v => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);

const aTurno = x => ({
  id: x.referencia,
  filaId: Number(x.id),
  telefono: x.telefono, conductorId: x.conductor_id ? String(x.conductor_id) : null,
  nombre: x.nombre || '',
  matricula: x.matricula || '', unitId: x.unit_id || '',
  driverId: x.mapon_driver_id || '', unitPrevia: x.unit_previa || '',
  inicio: seg(x.inicio), fin: seg(x.fin),
  km: x.km == null ? null : Number(x.km),
  trayectos: Number(x.trayectos) || 0, atribuidos: Number(x.trayectos_atribuidos) || 0,
  estado: x.estado, notas: x.notas || '',
});

const CAMPOS = `id, referencia, telefono, conductor_id, nombre, matricula, vehiculo_id,
                unit_id, mapon_driver_id, unit_previa, inicio, fin, km,
                trayectos, trayectos_atribuidos, estado, notas`;

/** El turno abierto de un teléfono, o null. */
async function abiertoDe(telefono) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM fichaje_turno
      WHERE estado = 'abierto'
        AND right(regexp_replace(telefono, '[^0-9]', '', 'g'), 9) = $1`, [tel9(telefono)]);
  return r.rows.length ? aTurno(r.rows[0]) : null;
}

/** Turno abierto sobre esa matrícula por OTRA persona, o null. */
async function abiertoDeCoche(matricula, telefono) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM fichaje_turno
      WHERE estado = 'abierto'
        AND upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) = $1
        AND right(regexp_replace(telefono, '[^0-9]', '', 'g'), 9) <> $2`,
    [normMat(matricula), tel9(telefono)]);
  return r.rows.length ? aTurno(r.rows[0]) : null;
}

/** Todos los turnos abiertos. Los pide el cierre automático y el repaso. */
async function abiertos() {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM fichaje_turno WHERE estado = 'abierto' ORDER BY inicio`);
  return r.rows.map(aTurno);
}

/**
 * Los coches que han pasado alguna vez por el fichaje.
 *
 * Es lo que limita hasta dónde llega el repaso de bloqueos: al fichaje solo
 * llegan los teléfonos autorizados, así que el aislamiento por número alcanza
 * también al cron sin tener que apuntar matrículas a mano.
 */
async function unitsConocidos() {
  const r = await db.consulta(
    `SELECT DISTINCT unit_id FROM fichaje_turno WHERE btrim(unit_id) <> ''`);
  return r.rows.map(x => x.unit_id);
}

/**
 * Abre un turno.
 *
 * Si la base dice que ya hay uno abierto —de esa persona o de ese coche— se
 * devuelve `null` en vez de reventar: quien llama ya tiene un mensaje bueno para
 * cada caso, y la carrera entre dos mensajes casi simultáneos es un caso
 * normal, no un error del programa.
 */
async function crear(t) {
  try {
    const r = await db.consulta(
      `INSERT INTO fichaje_turno
         (referencia, telefono, conductor_id, nombre, matricula, vehiculo_id,
          unit_id, mapon_driver_id, unit_previa, inicio, estado, notas)
       SELECT $1, $2, $3, $4, $5, v.id, $6, $7, $8, to_timestamp($9), 'abierto', $10
         FROM (SELECT 1) z
         LEFT JOIN vehiculo v
                ON v.matricula_norm = upper(regexp_replace($5, '[^A-Za-z0-9]', '', 'g'))
               AND v.baja_at IS NULL
       RETURNING ${CAMPOS}`,
      [t.id, t.telefono, t.conductorId || null, t.nombre || '', t.matricula,
       t.unitId || '', t.driverId || '', t.unitPrevia || '', t.inicio, t.notas || '']);
    return aTurno(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return null;      // ya hay uno abierto
    throw e;
  }
}

/** Guarda los cambios de un turno (cerrarlo, sus km, sus notas). */
async function actualizar(t) {
  const r = await db.consulta(
    `UPDATE fichaje_turno
        SET fin = CASE WHEN $2::bigint > 0 THEN to_timestamp($2::bigint) END,
            km = $3, trayectos = $4, trayectos_atribuidos = $5,
            estado = $6, notas = $7,
            mapon_driver_id = $8, unit_previa = $9
      WHERE referencia = $1
      RETURNING ${CAMPOS}`,
    [t.id, t.fin || 0, t.km == null ? null : t.km, t.trayectos || 0, t.atribuidos || 0,
     t.estado, t.notas || '', t.driverId || '', t.unitPrevia || '']);
  return r.rows.length ? aTurno(r.rows[0]) : null;
}

/**
 * QUIÉN LLEVABA ESTE COCHE A ESTA HORA. La pregunta para la que existe todo
 * esto: la auditoría de flota puede pasar de señalar matrículas a señalar
 * personas.
 *
 * Un turno sin cerrar cuenta hasta ahora: alguien que sigue fuera sigue siendo
 * quien lleva el coche.
 */
async function quienLlevaba(matricula, cuandoTs) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM fichaje_turno
      WHERE upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) = $1
        AND inicio <= to_timestamp($2)
        AND COALESCE(fin, now()) >= to_timestamp($2)
      ORDER BY inicio DESC LIMIT 1`, [normMat(matricula), Number(cuandoTs)]);
  return r.rows.length ? aTurno(r.rows[0]) : null;
}

module.exports = {
  abiertoDe, abiertoDeCoche, abiertos, unitsConocidos,
  crear, actualizar, quienLlevaba,
};
