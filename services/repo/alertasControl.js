// ============================================================
// ALERTAS DE CONTROL — avisar por WhatsApp de quien se pasa de la raya
// ============================================================
// Dos franjas de vigilancia al día (08:00-13:00 y 20:00-01:00) y tres cosas que
// obligan a llamar a un conductor:
//
//   · sin_respuesta    deja pasar ofertas sin contestar        (5 por defecto)
//   · rechazo_directo  las rechaza él, con el dedo             (5 por defecto)
//   · km_parado        rueda estando en descanso o desconectado (20 km)
//
// LA REGLA: **un mensaje por alerta**. El mismo conductor puede levantar las
// tres en la misma franja —son tres avisos distintos— pero cada una suena UNA
// vez: que siga rechazando después del aviso no vuelve a molestar a nadie. Eso
// NO se resuelve aquí con un `if`, se resuelve con el índice único de db/97:
// aunque dos revisiones se crucen, la base solo deja entrar la primera, y solo
// se manda WhatsApp por la fila que de verdad se insertó.
//
// LOS KM SE PRORRATEAN POR TIEMPO. Un tramo de descanso que empezó antes de que
// abriera la franja trae kilómetros de antes, y cargarlos enteros sería acusar
// a alguien de lo que hizo a otra hora. Se cuenta la parte del tramo que cae
// dentro. Los tramos que nacen y mueren dentro de la franja —la mayoría— van
// enteros y son exactos.
//
// LAS HORAS que se enseñan son las EFECTIVAS (viaje + espera) de su JORNADA
// OPERATIVA (05:00 → ahora), no las de la franja: quien recibe el aviso quiere
// saber si el tío lleva dos horas o diez, no cuánto lleva desde las ocho.

const db = require('../db');
const whatsapp = require('../whatsapp');

// ── EL MODELO: todo lo que se puede discutir, en un sitio ───────────────────
const MODELO = {
  version: '1.0',
  // Las franjas, en hora de Madrid. `fin` menor que `ini` = cruza medianoche.
  franjas: [
    { codigo: 'manana', etiqueta: 'Mañana', ini: 8, fin: 13 },
    { codigo: 'noche', etiqueta: 'Noche', ini: 20, fin: 1 },
  ],
  // Minutos de cortesía DESPUÉS de cerrar la franja. Las órdenes de BOLT llegan
  // con algo de retraso, y sin este margen lo que cruzó el umbral a las 12:58
  // no se llegaba a avisar nunca.
  graciaMin: 10,
  tipos: {
    sin_respuesta: {
      etiqueta: 'Viajes perdidos por NO RESPONDER', corto: 'no responde',
      umbral: 5, unidad: 'viajes', activo: true,
    },
    rechazo_directo: {
      etiqueta: 'Viajes RECHAZADOS por el conductor', corto: 'rechaza',
      umbral: 5, unidad: 'viajes', activo: true,
    },
    km_parado: {
      etiqueta: 'KM rodando en descanso o desconectado', corto: 'rueda parado',
      umbral: 20, unidad: 'km', activo: true,
    },
  },
  // CORTAFUEGOS. Si un día se disparan cuarenta, algo pasa con los datos o con
  // el umbral, y lo último que ayuda es cuarenta WhatsApps. Se avisa de los
  // peores y el resto queda en la pantalla.
  maxPorFranja: 25,
  // En pruebas se registra la alerta y NO se manda nada (estado 'simulada').
  modo: 'test',
  plantilla: (process.env.PLANTILLA_ALERTA_CONTROL || 'alerta_control').trim(),
};

const TZ = 'Europe/Madrid';
const CLAVE_CONFIG = 'parametros';

// ── Fechas, siempre en Madrid ───────────────────────────────────────────────
const partesMadrid = (d = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});

const hoyMadrid = (d = new Date()) => { const p = partesMadrid(d); return `${p.year}-${p.month}-${p.day}`; };
const horaMadrid = (d = new Date()) => Number(partesMadrid(d).hour) % 24;
const minutoMadrid = (d = new Date()) => Number(partesMadrid(d).minute);

/** Suma días a un 'AAAA-MM-DD' caminando el calendario (a prueba de cambio de hora). */
function sumarDias(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * ¿En qué franja estamos AHORA? Devuelve null en el hueco entre franjas — y eso
 * es a propósito: fuera de la vigilancia no se avisa a nadie.
 *
 * `franja_dia` es el día AL QUE PERTENECE la franja, no el del reloj: a las
 * 00:30 seguimos en la franja de noche de AYER, y es ahí donde tiene que contar
 * el conductor para no avisar dos veces de lo mismo al cruzar la medianoche.
 */
function franjaDe(config, ahora = new Date()) {
  const hm = horaMadrid(ahora) * 60 + minutoMadrid(ahora);
  const hoy = hoyMadrid(ahora);
  const gracia = Number(config.graciaMin ?? MODELO.graciaMin) || 0;
  for (const f of (config.franjas || MODELO.franjas)) {
    const ini = f.ini * 60, fin = f.fin * 60 + gracia;
    if (f.fin > f.ini) {
      // No cruza medianoche: 08:00 → 13:00.
      if (hm >= ini && hm < fin) return { ...f, dia: hoy };
    } else {
      // Cruza: 20:00 → 01:00. Antes de medianoche es de HOY; después, de AYER.
      if (hm >= ini) return { ...f, dia: hoy };
      if (hm < fin) return { ...f, dia: sumarDias(hoy, -1) };
    }
  }
  return null;
}

// LOS INSTANTES DE LA FRANJA LOS MONTA POSTGRESQL, no JavaScript.
// `new Date('2026-09-11T08:00:00')` usa el reloj DEL SERVIDOR, y Render va en
// UTC: las ocho de la mañana habrían sido las diez en Madrid, y en invierno las
// nueve. Así que la franja viaja como (día, hora, salto de día) y la base la
// clava con AT TIME ZONE, igual que en Visibilidad y en el núcleo.
const paramsFranja = franja => [franja.dia, String(franja.ini), franja.fin > franja.ini ? 0 : 1, String(franja.fin)];

// ── Config ──────────────────────────────────────────────────────────────────
async function leerConfig() {
  try {
    const r = await db.consulta('SELECT valor FROM alerta_control_config WHERE clave = $1', [CLAVE_CONFIG]);
    const guardado = r.rows[0] ? r.rows[0].valor : {};
    // Los tipos se fusionan uno a uno: añadir un tipo nuevo al MODELO no debe
    // quedar tapado por una config vieja que no lo conoce.
    const tipos = {};
    for (const [k, def] of Object.entries(MODELO.tipos)) tipos[k] = { ...def, ...((guardado.tipos || {})[k] || {}) };
    return { ...MODELO, ...guardado, tipos };
  } catch (e) {
    // Sin la tabla (migración sin aplicar) el módulo se ve, pero no alerta.
    return { ...MODELO, sinTabla: true };
  }
}

async function guardarConfig(patch, { usuarioId } = {}) {
  const actual = await leerConfig();
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  const tipos = {};
  for (const [k, def] of Object.entries(actual.tipos)) {
    const p = ((patch || {}).tipos || {})[k] || {};
    tipos[k] = {
      umbral: Math.max(1, num(p.umbral, def.umbral)),
      activo: p.activo === undefined ? !!def.activo : !!p.activo,
    };
  }
  const valor = {
    tipos,
    maxPorFranja: Math.max(1, num((patch || {}).maxPorFranja, actual.maxPorFranja)),
    modo: (patch || {}).modo === 'live' ? 'live' : 'test',
    plantilla: String((patch || {}).plantilla || actual.plantilla).trim().slice(0, 60) || MODELO.plantilla,
  };
  await db.consulta(
    `INSERT INTO alerta_control_config (clave, valor, actualizado_at, usuario_id)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor,
       actualizado_at = now(), usuario_id = EXCLUDED.usuario_id`,
    [CLAVE_CONFIG, JSON.stringify(valor), usuarioId || null]);
  return leerConfig();
}

// ── Destinatarios ───────────────────────────────────────────────────────────
/**
 * ¿Sirve este teléfono para mandar un WhatsApp?
 *
 * No basta con contar nueve dígitos. En las fichas de usuario hay números de
 * relleno —"000000000", "00000000"— puestos para poder crear la cuenta, y esos
 * pasaban el filtro: el aviso se daba por mandado, Meta lo rechazaba y nadie se
 * enteraba de que el controlador no recibió nada. Un número de un solo dígito
 * repetido no es un teléfono.
 */
function telefonoUtil(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 9) return false;
  return !/^(\d)\1+$/.test(d);
}
/** Todos los usuarios, marcando quién recibe. Es lo que pinta la pantalla. */
async function destinatarios() {
  const r = await db.consulta(
    `SELECT u.id, btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS nombre,
            u.email, u.estado, ro.etiqueta AS rol,
            COALESCE(NULLIF(btrim(d.telefono), ''), u.telefono) AS telefono,
            (d.usuario_id IS NOT NULL AND d.activo)             AS recibe
       FROM usuario u
       JOIN rol ro ON ro.id = u.rol_id
       LEFT JOIN alerta_control_destinatario d ON d.usuario_id = u.id
      WHERE u.estado <> 'bloqueado'
      ORDER BY recibe DESC, nombre`);
  return r.rows.map(x => ({
    id: Number(x.id), nombre: x.nombre, email: x.email, rol: x.rol,
    telefono: x.telefono || '', recibe: !!x.recibe,
    // Un destinatario sin teléfono (o con uno de relleno) no recibe nada, y hay
    // que verlo ANTES de contar con él: si no, el aviso se da por mandado y no
    // llegó a ninguna parte.
    sinTelefono: !telefonoUtil(x.telefono),
  }));
}

/** Fija la lista entera: los que vengan reciben, los demás dejan de recibir. */
async function guardarDestinatarios(ids, { usuarioId } = {}) {
  const limpios = [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  await db.transaccion(async cli => {
    await cli.query('DELETE FROM alerta_control_destinatario WHERE NOT (usuario_id = ANY($1::int[]))', [limpios]);
    for (const id of limpios) {
      await cli.query(
        `INSERT INTO alerta_control_destinatario (usuario_id, activo, usuario_alta)
         VALUES ($1, TRUE, $2)
         ON CONFLICT (usuario_id) DO UPDATE SET activo = TRUE`, [id, usuarioId || null]);
    }
  });
  return destinatarios();
}

/** Los que de verdad van a recibir el WhatsApp (activos y con teléfono). */
async function aQuienAviso() {
  const r = await db.consulta(
    `SELECT u.id, btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS nombre,
            COALESCE(NULLIF(btrim(d.telefono), ''), u.telefono) AS telefono
       FROM alerta_control_destinatario d
       JOIN usuario u ON u.id = d.usuario_id
      WHERE d.activo AND u.estado <> 'bloqueado'
      ORDER BY nombre`);
  return r.rows
    .map(x => ({ id: Number(x.id), nombre: x.nombre, telefono: String(x.telefono || '') }))
    .filter(x => telefonoUtil(x.telefono));
}

// ── QUIÉN SE HA PASADO ──────────────────────────────────────────────────────
/**
 * Los conductores de una franja con sus tres cifras y sus horas. Una sola
 * consulta: órdenes, tramos y ficha viven en la misma base.
 */
async function candidatos(franja, ahora = new Date()) {
  const [dia, hIni, offFin, hFin] = paramsFranja(franja);
  // La jornada operativa a la que pertenece este instante: 05:00 → 05:00. Antes
  // de las cinco seguimos en la jornada de ayer.
  const jornadaDia = horaMadrid(ahora) < 5 ? sumarDias(hoyMadrid(ahora), -1) : hoyMadrid(ahora);

  const r = await db.consulta(
    `WITH f AS (
       SELECT ($1::date + ($2 || ' hours')::interval)            AT TIME ZONE 'Europe/Madrid' AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin,
              ($5::date + interval '5 hours')                     AT TIME ZONE 'Europe/Madrid' AS jini,
              now() AS ahora),
     ords AS (
       SELECT o.driver_uuid AS uuid,
              count(*) FILTER (WHERE o.estado = 'driver_did_not_respond')::int AS sin_respuesta,
              count(*) FILTER (WHERE o.estado = 'driver_rejected')::int        AS rechazo_directo,
              count(*) FILTER (WHERE o.estado = 'finished')::int               AS hechos,
              count(*)::int                                                    AS ofertas
         FROM bolt_order o CROSS JOIN f
        WHERE o.driver_uuid IS NOT NULL
          AND o.creado_ts >= f.ini AND o.creado_ts < LEAST(f.fin, f.ahora)
        GROUP BY 1),
     -- Km rodados en descanso/desconectado, prorrateados por el tiempo que el
     -- tramo pasa DENTRO de la franja.
     tr AS (
       SELECT t.conductor_uuid AS uuid, t.km_m,
              EXTRACT(epoch FROM (LEAST(COALESCE(t.hasta, f.ahora), f.fin, f.ahora)
                                  - GREATEST(t.desde, f.ini)))          AS solape,
              EXTRACT(epoch FROM (COALESCE(t.hasta, f.ahora) - t.desde)) AS total
         FROM fv_tramo t CROSS JOIN f
        WHERE t.situacion IN ('descanso', 'desconectado')
          AND t.conductor_uuid IS NOT NULL
          AND t.desde < LEAST(f.fin, f.ahora) AND COALESCE(t.hasta, f.ahora) > f.ini),
     km AS (
       SELECT uuid,
              sum(km_m * CASE WHEN total > 0 THEN LEAST(1, GREATEST(0, solape / total)) ELSE 0 END) AS km_m
         FROM tr GROUP BY 1),
     -- Horas EFECTIVAS de su jornada operativa (05:00 → ahora).
     horas AS (
       SELECT t.conductor_uuid AS uuid,
              sum(EXTRACT(epoch FROM (LEAST(COALESCE(t.hasta, f.ahora), f.ahora)
                                      - GREATEST(t.desde, f.jini)))) AS seg
         FROM fv_tramo t
         JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
         CROSS JOIN f
        WHERE t.desde < f.ahora AND COALESCE(t.hasta, f.ahora) > f.jini
        GROUP BY 1),
     todos AS (SELECT uuid FROM ords UNION SELECT uuid FROM km)
     SELECT t.uuid,
            COALESCE(o.sin_respuesta, 0)                       AS sin_respuesta,
            COALESCE(o.rechazo_directo, 0)                     AS rechazo_directo,
            COALESCE(o.hechos, 0)                              AS hechos,
            COALESCE(o.ofertas, 0)                             AS ofertas,
            round(COALESCE(k.km_m, 0) / 1000.0, 1)::float8     AS km_parado,
            round(COALESCE(h.seg, 0) / 3600.0, 2)::float8      AS horas_efectivas,
            COALESCE(NULLIF(btrim(fc.nombre), ''),
                     NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')),
                     '#' || t.uuid)                            AS nombre_bolt,
            COALESCE(NULLIF(btrim(tel.e164), ''), fc.telefono) AS telefono,
            ce.conductor_id
       FROM todos t
       LEFT JOIN ords o  ON o.uuid = t.uuid
       LEFT JOIN km   k  ON k.uuid = t.uuid
       LEFT JOIN horas h ON h.uuid = t.uuid
       LEFT JOIN fv_conductor fc ON fc.uuid = t.uuid
       LEFT JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = t.uuid
                                     AND ce.conductor_id IS NOT NULL
       LEFT JOIN conductor c ON c.id = ce.conductor_id
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = ce.conductor_id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE`,
    [dia, hIni, offFin, hFin, jornadaDia]);

  return r.rows.map(x => ({
    uuid: x.uuid,
    conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    nombreBolt: x.nombre_bolt,
    telefono: x.telefono || '',
    horasEfectivas: Number(x.horas_efectivas) || 0,
    valores: {
      sin_respuesta: Number(x.sin_respuesta) || 0,
      rechazo_directo: Number(x.rechazo_directo) || 0,
      km_parado: Number(x.km_parado) || 0,
    },
    hechos: Number(x.hechos) || 0,
    ofertas: Number(x.ofertas) || 0,
  }));
}

// ── El texto que lee el controlador ─────────────────────────────────────────
const fmtNum = n => String(Math.round(Number(n) * 10) / 10).replace('.', ',');
const fmtHoras = h => {
  const t = Math.max(0, Math.round(Number(h) * 60));
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')} min`;
};

/** La cuarta variable de la plantilla: QUÉ ha hecho y en qué franja. */
function textoAlerta(tipo, valor, cfgTipo, franja) {
  const horas = `${String(franja.ini).padStart(2, '0')}:00-${String(franja.fin).padStart(2, '0')}:00`;
  if (tipo === 'km_parado') {
    return `${fmtNum(valor)} km rodando en descanso o desconectado (franja ${horas})`;
  }
  const que = tipo === 'sin_respuesta' ? 'viajes perdidos por NO RESPONDER' : 'viajes RECHAZADOS por él';
  return `${fmtNum(valor)} ${que} (franja ${horas})`;
}

// ── LA REVISIÓN ─────────────────────────────────────────────────────────────
/**
 * Mira la franja en curso, abre las alertas nuevas y las manda.
 *
 * Fuera de franja no hace nada. Lo que ya estaba avisado no vuelve a sonar: lo
 * impide el índice único, no un `if`.
 */
async function revisar({ ahora = new Date(), forzar = false } = {}) {
  const config = await leerConfig();
  if (config.sinTabla) return { activa: false, motivo: 'sin-tabla', nuevas: 0 };

  const franja = franjaDe(config, ahora);
  if (!franja) return { activa: false, motivo: 'fuera-de-franja', nuevas: 0, enviadas: 0 };

  const lista = await candidatos(franja, ahora);
  const gente = await aQuienAviso();
  const simulado = config.modo !== 'live';

  // Los que se pasan, peor primero: si hay que cortar por el tope, que se avise
  // de los gordos.
  const pasados = [];
  for (const c of lista) {
    for (const [tipo, def] of Object.entries(config.tipos)) {
      if (!def.activo) continue;
      const valor = c.valores[tipo];
      if (valor == null || valor < def.umbral) continue;
      pasados.push({ ...c, tipo, valor, umbral: def.umbral, exceso: valor / def.umbral });
    }
  }
  pasados.sort((a, b) => b.exceso - a.exceso);

  const res = { activa: true, franja: franja.codigo, dia: franja.dia, modo: config.modo,
    candidatos: lista.length, pasan: pasados.length, nuevas: 0, enviadas: 0,
    errores: 0, cortadas: 0, destinatarios: gente.length, detalle: [] };

  for (const p of pasados) {
    if (res.nuevas >= config.maxPorFranja && !forzar) { res.cortadas++; continue; }

    // El INSERT es el que decide si esta alerta es nueva. Si ya estaba, no
    // devuelve fila y aquí no se manda nada: un mensaje por alerta.
    const ins = await db.consulta(
      `INSERT INTO alerta_control
         (tipo, franja, franja_dia, driver_uuid, conductor_id, nombre_bolt, telefono,
          valor, umbral, horas_efectivas, estado)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,'pendiente')
       ON CONFLICT (tipo, driver_uuid, franja_dia, franja) DO NOTHING
       RETURNING id`,
      [p.tipo, franja.codigo, franja.dia, p.uuid, p.conductorId, p.nombreBolt,
       p.telefono || null, p.valor, p.umbral, p.horasEfectivas]);
    if (!ins.rowCount) continue;

    res.nuevas++;
    const alertaId = ins.rows[0].id;
    const r = await mandar(alertaId, p, franja, config, gente, simulado);
    res.enviadas += r.ok;
    res.errores += r.fallos;
    res.detalle.push({ tipo: p.tipo, conductor: p.nombreBolt, valor: p.valor, enviados: r.ok, estado: r.estado });
  }

  // Lo que quedó a medias en esta misma franja (un fallo de red, la plantilla
  // aún sin aprobar) se reintenta: la alerta ya existe, así que no se duplica.
  if (gente.length) res.reintentos = await reintentarPendientes(franja, config, gente, simulado);

  return res;
}

/** Manda UNA alerta a todos los destinatarios y apunta el resultado. */
async function mandar(alertaId, p, franja, config, gente, simulado) {
  if (!gente.length) {
    await db.consulta(`UPDATE alerta_control SET estado = 'sin_destinatarios' WHERE id = $1`, [alertaId]);
    return { ok: 0, fallos: 0, estado: 'sin_destinatarios' };
  }
  const texto = textoAlerta(p.tipo, p.valor, config.tipos[p.tipo], franja);
  const vars = [
    p.nombreBolt || '—',
    p.telefono || 'sin teléfono',
    fmtHoras(p.horasEfectivas),
    texto,
  ];

  let ok = 0, fallos = 0;
  for (const d of gente) {
    let r;
    if (simulado) r = { ok: true };
    else r = await whatsapp.enviarPlantillaPosicional(d.telefono, config.plantilla, vars);
    if (r.ok) ok++; else fallos++;
    await db.consulta(
      `INSERT INTO alerta_control_envio (alerta_id, usuario_id, usuario, telefono, ok, simulado, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [alertaId, d.id, d.nombre, d.telefono, !!r.ok, simulado, r.ok ? null : String(r.error || '').slice(0, 300)]);
  }
  const estado = simulado ? 'simulada' : (ok ? 'enviada' : 'error');
  await db.consulta('UPDATE alerta_control SET estado = $2 WHERE id = $1', [alertaId, estado]);
  return { ok, fallos, estado };
}

/** Reintenta las de ESTA franja que no llegaron a salir. Máximo 3 intentos. */
async function reintentarPendientes(franja, config, gente, simulado) {
  const r = await db.consulta(
    `SELECT a.*, (SELECT count(*) FROM alerta_control_envio e WHERE e.alerta_id = a.id) AS intentos
       FROM alerta_control a
      WHERE a.franja_dia = $1::date AND a.franja = $2
        AND a.estado IN ('pendiente', 'error', 'sin_destinatarios')
        AND NOT EXISTS (SELECT 1 FROM alerta_control_envio e WHERE e.alerta_id = a.id AND e.ok)`,
    [franja.dia, franja.codigo]);
  let n = 0;
  for (const a of r.rows) {
    if (Number(a.intentos) >= 3 * gente.length) continue;
    const p = {
      tipo: a.tipo, valor: Number(a.valor), nombreBolt: a.nombre_bolt,
      telefono: a.telefono, horasEfectivas: Number(a.horas_efectivas) || 0,
    };
    const res = await mandar(a.id, p, franja, config, gente, simulado);
    if (res.ok) n++;
  }
  return n;
}

// ── Lo que lee la pantalla ──────────────────────────────────────────────────
async function historial({ dia, limite = 200 } = {}) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : hoyMadrid();
  const r = await db.consulta(
    `SELECT a.id, a.tipo, a.franja, to_char(a.franja_dia, 'YYYY-MM-DD') AS franja_dia,
            a.nombre_bolt, a.telefono, a.conductor_id,
            a.valor::float8 AS valor, a.umbral::float8 AS umbral,
            a.horas_efectivas::float8 AS horas_efectivas, a.estado,
            to_char(a.detectada_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
            (SELECT count(*) FROM alerta_control_envio e WHERE e.alerta_id = a.id AND e.ok)::int AS enviados,
            (SELECT string_agg(DISTINCT e.usuario, ', ') FROM alerta_control_envio e
              WHERE e.alerta_id = a.id AND e.ok) AS a_quien,
            (SELECT e.error FROM alerta_control_envio e
              WHERE e.alerta_id = a.id AND NOT e.ok ORDER BY e.id DESC LIMIT 1) AS error
       FROM alerta_control a
      WHERE a.franja_dia = $1::date
      ORDER BY a.detectada_at DESC
      LIMIT $2`, [d, Math.min(500, Number(limite) || 200)]);
  return { dia: d, alertas: r.rows };
}

/** El panel: config, destinatarios, franja en curso y lo que va de día. */
async function estado({ dia } = {}) {
  const config = await leerConfig();
  const ahora = new Date();
  const franja = franjaDe(config, ahora);
  const [gente, hist] = await Promise.all([destinatarios(), historial({ dia })]);
  let enVivo = null;
  if (franja && !config.sinTabla) {
    // Lo que YA está por encima del umbral ahora mismo, esté avisado o no: es la
    // diferencia entre "saltó una alerta" y "esto está pasando".
    const lista = await candidatos(franja, ahora).catch(() => []);
    enVivo = [];
    for (const c of lista) {
      for (const [tipo, def] of Object.entries(config.tipos)) {
        if (!def.activo || c.valores[tipo] < def.umbral) continue;
        enVivo.push({ tipo, conductor: c.nombreBolt, telefono: c.telefono,
          valor: c.valores[tipo], umbral: def.umbral, horas: c.horasEfectivas });
      }
    }
    enVivo.sort((a, b) => (b.valor / b.umbral) - (a.valor / a.umbral));
  }
  return {
    config, franja, ahora: `${String(horaMadrid(ahora)).padStart(2, '0')}:${String(minutoMadrid(ahora)).padStart(2, '0')}`,
    destinatarios: gente, ...hist, enVivo,
    tipos: Object.entries(config.tipos).map(([k, v]) => ({ codigo: k, ...v })),
  };
}

module.exports = {
  MODELO, revisar, estado, historial, candidatos,
  leerConfig, guardarConfig, destinatarios, guardarDestinatarios, aQuienAviso,
  franjaDe, textoAlerta,
};
