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
const { HORA_DIA } = require('../nucleo');

const tel9 = t => String(t == null ? '' : t).replace(/\D/g, '').slice(-9);
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// La forma que espera el resto del módulo, que venía de la hoja: segundos desde
// 1970 y no fechas. Se traduce aquí para no tocar la lógica de Mapon, que ya
// está probada y habla en `ts`.
const seg = v => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);

const aTurno = x => ({
  id: x.referencia,
  filaId: Number(x.id),
  // 'turno' = un conductor en su jornada; 'viaje' = alguien de la empresa que
  // coge un coche para algo (db/148).
  tipo: x.tipo || 'turno',
  telefono: x.telefono, conductorId: x.conductor_id ? String(x.conductor_id) : null,
  usuarioId: x.usuario_id ? String(x.usuario_id) : null,
  nombre: x.nombre || '',
  matricula: x.matricula || '', unitId: x.unit_id || '',
  driverId: x.mapon_driver_id || '', unitPrevia: x.unit_previa || '',
  inicio: seg(x.inicio), fin: seg(x.fin),
  // Cuándo pulsó «Voy al relevo» (0 = no lo ha pulsado).
  relevo: seg(x.relevo_at),
  km: x.km == null ? null : Number(x.km),
  kmRelevo: x.km_relevo == null ? null : Number(x.km_relevo),
  trayectos: Number(x.trayectos) || 0, atribuidos: Number(x.trayectos_atribuidos) || 0,
  estado: x.estado, notas: x.notas || '',
});

const CAMPOS = `id, referencia, tipo, telefono, conductor_id, usuario_id, nombre, matricula, vehiculo_id,
                unit_id, mapon_driver_id, unit_previa, inicio, fin, relevo_at, km, km_relevo,
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

// Los dos indices unicos que dicen "esta persona / este coche YA tiene turno
// abierto" (db/125). Se miran por su nombre para no confundirlos con cualquier
// otra unicidad de la tabla.
const ABIERTO = new Set(['uq_ft_persona_abierta', 'uq_ft_coche_abierto']);

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
          unit_id, mapon_driver_id, unit_previa, inicio, estado, notas, tipo, usuario_id)
       SELECT $1, $2, $3, $4, $5, v.id, $6, $7, $8, to_timestamp($9), 'abierto', $10, $11, $12
         FROM (SELECT 1) z
         LEFT JOIN vehiculo v
                ON v.matricula_norm = upper(regexp_replace($5, '[^A-Za-z0-9]', '', 'g'))
               AND v.baja_at IS NULL
       RETURNING ${CAMPOS}`,
      [t.id, t.telefono, t.conductorId || null, t.nombre || '', t.matricula,
       t.unitId || '', t.driverId || '', t.unitPrevia || '', t.inicio, t.notas || '',
       t.tipo === 'viaje' ? 'viaje' : 'turno', t.usuarioId || null]);
    return aTurno(r.rows[0]);
  } catch (e) {
    // SOLO los dos indices de "turno abierto" significan "ya lo tiene". Un
    // 23505 cualquiera —la referencia repetida, por ejemplo— NO es eso, y
    // tragarselo aqui lo disfrazaba: el conductor recibia "ya tienes un turno
    // abierto" cuando no lo tenia, y no habia forma de saber por que.
    if (e.code === '23505' && ABIERTO.has(e.constraint)) return null;
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
            mapon_driver_id = $8, unit_previa = $9, km_relevo = $10
      WHERE referencia = $1
      RETURNING ${CAMPOS}`,
    [t.id, t.fin || 0, t.km == null ? null : t.km, t.trayectos || 0, t.atribuidos || 0,
     t.estado, t.notas || '', t.driverId || '', t.unitPrevia || '',
     t.kmRelevo == null ? null : t.kmRelevo]);
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


// ── Quién ficha (db/148) ────────────────────────────────────────────────────

/**
 * QUIÉN ESCRIBE, y si tiene el fichaje encendido.
 *
 * Se mira como usuario Y como conductor a la vez: un mismo número puede ser de
 * las dos cosas. Cuál manda lo decide `fichaje.participa` (primero el usuario).
 * Un conductor vale solo si está DE ALTA —el mismo criterio que el bot de
 * puertas—, y con CUALQUIERA de sus teléfonos vigentes: con el interruptor
 * encendido y de baja en la empresa no puede soltar un motor. Un usuario, solo
 * si está activo.
 *
 * `abierto` dice si ese número tiene un turno o un viaje sin cerrar. Hace falta
 * para una cosa concreta: a quien le apagan el fichaje a mitad de turno tiene
 * que poder terminarlo igual.
 */
async function personaPorTelefono(telefono) {
  const t9 = tel9(telefono);
  if (t9.length < 9) return { conductor: null, usuario: null, abierto: false };
  const r = await db.consulta(
    `SELECT 'conductor' AS de, c.id, c.ficha_coche AS activo, c.empleo_vigente AS vale,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre
       FROM conductor_telefono t
       JOIN conductor c ON c.id = t.conductor_id
      WHERE t.vigente_hasta IS NULL AND t.sufijo9 = $1 AND NOT c.es_centinela
     UNION ALL
     SELECT 'usuario', u.id, u.ficha_coche, (u.estado = 'activo'),
            btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, ''))
       FROM usuario u
      WHERE right(regexp_replace(COALESCE(u.telefono, ''), '[^0-9]', '', 'g'), 9) = $1
        AND length(regexp_replace(COALESCE(u.telefono, ''), '[^0-9]', '', 'g')) >= 9
     UNION ALL
     SELECT 'abierto', NULL, TRUE, TRUE, ''
      WHERE EXISTS (SELECT 1 FROM fichaje_turno f
                     WHERE f.estado = 'abierto'
                       AND right(regexp_replace(f.telefono, '[^0-9]', '', 'g'), 9) = $1)`, [t9]);
  const de = k => r.rows.filter(x => x.de === k).map(x => ({
    id: String(x.id), nombre: (x.nombre || '').trim(), activo: !!x.activo, vale: !!x.vale,
  }));
  // Si hubiera dos fichas con el mismo número, manda la que tiene el fichaje
  // encendido y vale: es la que alguien ha elegido a propósito.
  const elegir = xs => xs.find(x => x.activo && x.vale) || xs[0] || null;
  return {
    conductor: elegir(de('conductor')),
    usuario: elegir(de('usuario')),
    abierto: r.rows.some(x => x.de === 'abierto'),
  };
}

// EL DÍA OPERATIVO, en la base: de 05:00 a 05:00. El de noche que pregunta a
// la 01:00 sigue en la jornada de ayer, y su coche es el de ayer. `n` es el
// número del parámetro que lleva la hora de corte (HORA_DIA).
const diaOperativo = n => `(now() AT TIME ZONE 'Europe/Madrid' - make_interval(hours => $${n}::int))::date`;

/**
 * El coche (o los coches) que el cuadrante le da HOY a un conductor. Es lo que
 * el bot le propone al iniciar turno: «¿Empiezas en 1234ABC?». Sale de
 * f_cobertura con los eventos, igual que lo que pinta el planificador.
 */
async function cochesDelPlan(conductorId) {
  if (!conductorId) return [];
  const r = await db.consulta(
    `SELECT DISTINCT v.matricula, t.etiqueta AS turno, f.turno_id
       FROM f_cobertura(${diaOperativo(2)}, ${diaOperativo(2)}, TRUE) f
       JOIN vehiculo v ON v.id = f.vehiculo_id
       LEFT JOIN turno t ON t.id = f.turno_id
      WHERE f.conductor_id = $1
      ORDER BY f.turno_id, v.matricula`, [Number(conductorId), HORA_DIA]);
  return r.rows.map(x => ({ matricula: x.matricula, turno: x.turno || '' }));
}

/**
 * QUIÉN LLEVA ESTE COCHE, hoy o mañana, según el cuadrante, y si ficha.
 *
 * Es la pregunta que decide si al terminar se puede bloquear: si lo coge luego
 * alguien que todavía no ficha, bloquearlo le deja sin poder arrancar. Se mira
 * hoy Y mañana porque el que entra a las 05:00 ya es «mañana».
 */
async function quienesLlevan(matricula) {
  const r = await db.consulta(
    `SELECT DISTINCT c.id, c.ficha_coche,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre
       FROM f_cobertura(${diaOperativo(2)}, ${diaOperativo(2)} + 1, TRUE) f
       JOIN vehiculo v  ON v.id = f.vehiculo_id
       JOIN conductor c ON c.id = f.conductor_id
      WHERE v.matricula_norm = $1`, [normMat(matricula), HORA_DIA]);
  return r.rows.map(x => ({ conductorId: String(x.id), nombre: (x.nombre || '').trim(), fichaCoche: !!x.ficha_coche }));
}

/**
 * Los coches que lleva, hoy o mañana, ALGUIEN QUE NO FICHA. El repaso no los
 * toca: bloquearlos dejaría a esa persona sin poder arrancar. Una consulta para
 * toda la flota, en vez de una por coche.
 */
async function cochesConQuienNoFicha() {
  const r = await db.consulta(
    `SELECT DISTINCT v.matricula_norm AS matricula
       FROM f_cobertura(${diaOperativo(1)}, ${diaOperativo(1)} + 1, TRUE) f
       JOIN vehiculo v  ON v.id = f.vehiculo_id
       JOIN conductor c ON c.id = f.conductor_id
      WHERE NOT c.ficha_coche`, [HORA_DIA]);
  return new Set(r.rows.map(x => x.matricula));
}

/** Enciende o apaga el fichaje de un conductor, y deja escrito quién y cuándo. */
async function fijarFichaCoche(conductorId, activo, usuarioId) {
  const r = await db.consulta(
    `UPDATE conductor
        SET ficha_coche = $2, ficha_coche_at = now(), ficha_coche_por = $3
      WHERE id = $1
      RETURNING id, ficha_coche`, [Number(conductorId), !!activo, usuarioId || null]);
  if (!r.rowCount) throw new Error('No existe ese conductor');
  return { conductorId: String(r.rows[0].id), fichaCoche: !!r.rows[0].ficha_coche };
}

/** Quién tiene el fichaje encendido: conductores y gente de la empresa. */
async function activados() {
  const r = await db.consulta(
    `SELECT 'conductor' AS de, c.id,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
            to_char(c.ficha_coche_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS desde,
            btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS por,
            c.empleo_vigente AS vale
       FROM conductor c
       LEFT JOIN usuario u ON u.id = c.ficha_coche_por
      WHERE c.ficha_coche
     UNION ALL
     SELECT 'usuario', u.id, btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')),
            NULL, NULL, (u.estado = 'activo')
       FROM usuario u
      WHERE u.ficha_coche
      ORDER BY 1, 3`);
  return r.rows.map(x => ({ de: x.de, id: String(x.id), nombre: (x.nombre || '').trim(),
    desde: x.desde || null, por: (x.por || '').trim() || null, vale: !!x.vale }));
}

/**
 * «VOY AL RELEVO»: apunta (o quita) la hora a la que salió hacia el sitio donde
 * entrega el coche. Solo en un turno abierto y solo si es turno —un viaje no
 * tiene compañero—; la base lo vuelve a comprobar (ck_ft_relevo).
 */
async function marcarRelevo(referencia, si = true) {
  const r = await db.consulta(
    `UPDATE fichaje_turno
        SET relevo_at = CASE WHEN $2 THEN COALESCE(relevo_at, now()) END
      WHERE referencia = $1 AND estado = 'abierto' AND tipo = 'turno'
      RETURNING ${CAMPOS}`, [referencia, !!si]);
  return r.rows.length ? aTurno(r.rows[0]) : null;
}

/** Apunta una orden de motor dada a mano desde el ERP. */
async function registrarOrdenMotor({ matricula, unitId, accion, motivo, hecho, respuesta, usuarioId }) {
  await db.consulta(
    `INSERT INTO fichaje_orden_motor (matricula, unit_id, accion, motivo, hecho, respuesta, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [normMat(matricula), String(unitId || ''), accion, String(motivo || '').trim(), !!hecho,
     String(respuesta || '').slice(0, 1000), usuarioId || null]);
}

module.exports = {
  abiertoDe, abiertoDeCoche, abiertos, unitsConocidos,
  crear, actualizar, quienLlevaba,
  personaPorTelefono, cochesDelPlan, quienesLlevan, cochesConQuienNoFicha,
  fijarFichaCoche, activados, marcarRelevo, registrarOrdenMotor,
};
