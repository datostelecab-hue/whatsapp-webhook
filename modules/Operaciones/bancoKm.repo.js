// ============================================================
// EL BANCO DE KM — el SQL (db/267, 18/11/2026)
// ============================================================
// Desde fuera se entra por bancoKm.service.js. Aquí solo se lee y se escribe la
// foto de cada jornada (km_banco_dia, km_banco_coche, km_banco_calculo).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, params) => (cli ? cli.query(sql, params) : db.consulta(sql, params));
const n1 = v => Math.round((Number(v) || 0) * 10) / 10;

/**
 * Los días ya calculados entre dos fechas: Map('aaaa-mm-dd' → versión de la
 * regla con que se calcularon). Sin db/268 falla (faltaMigracion): la tarea no
 * hace nada hasta que esté, en vez de gastar sus reintentos.
 */
async function calculados(desde, hasta, cli = null) {
  const r = await q(cli, `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, version FROM km_banco_calculo WHERE dia BETWEEN $1::date AND $2::date`, [desde, hasta]);
  return new Map(r.rows.map(x => [x.dia, Number(x.version) || 1]));
}

/** Cuándo se calculó cada día de un rango: Map(dia → { at, usuario }). */
async function calculos(desde, hasta) {
  const r = await db.consulta(
    `SELECT to_char(k.dia, 'YYYY-MM-DD') AS dia, k.calculado_at, k.usuario_id,
            btrim(u.nombre || COALESCE(' ' || u.apellidos, '')) AS usuario
       FROM km_banco_calculo k LEFT JOIN usuario u ON u.id = k.usuario_id
      WHERE k.dia BETWEEN $1::date AND $2::date`, [desde, hasta]);
  return new Map(r.rows.map(x => [x.dia, { at: x.calculado_at, usuario: x.usuario || null }]));
}

/**
 * Guarda la foto de una jornada: borra la que hubiera y escribe la nueva, todo
 * con `cli` (la transacción de quien la llama). `filas`: las personas del día;
 * `coches`: sus km coche a coche.
 */
async function guardarDia(cli, dia, { filas, coches, milisegundos, usuarioId, version = 2 }) {
  await cli.query('DELETE FROM km_banco_dia WHERE dia = $1::date', [dia]);
  if (filas.length) {
    await cli.query(
      `INSERT INTO km_banco_dia (dia, persona, conductor_id, nombre, turno, programado, trabajo, horas, oficina,
                                 justificado, limite_km, km_fuera, revisar, fichaje, sin_fichar, horas_viaje)
       SELECT $1::date, x.persona, c.id, x.nombre, x.turno, x.programado, x.trabajo, x.horas, x.oficina,
              x.justificado, x.limite_km, x.km_fuera, x.revisar, x.fichaje, x.sin_fichar, COALESCE(x.horas_viaje, 0)
         FROM jsonb_to_recordset($2::jsonb) AS x(persona text, conductor_id bigint, nombre text, turno text,
              programado boolean, trabajo boolean, horas numeric, oficina boolean, justificado boolean,
              limite_km numeric, km_fuera numeric, revisar boolean, fichaje text, sin_fichar boolean, horas_viaje numeric)
         LEFT JOIN conductor c ON c.id = x.conductor_id`,
      [dia, JSON.stringify(filas)]);
  }
  if (coches.length) {
    await cli.query(
      `INSERT INTO km_banco_coche (dia, persona, matricula, km_fuera)
       SELECT $1::date, x.persona, x.matricula, x.km_fuera
         FROM jsonb_to_recordset($2::jsonb) AS x(persona text, matricula text, km_fuera numeric)`,
      [dia, JSON.stringify(coches)]);
  }
  await cli.query(
    `INSERT INTO km_banco_calculo (dia, calculado_at, personas, km_fuera, milisegundos, usuario_id, version)
     VALUES ($1::date, now(), $2, $3, $4, $5, $6)
     ON CONFLICT (dia) DO UPDATE SET calculado_at = now(), personas = EXCLUDED.personas, km_fuera = EXCLUDED.km_fuera,
                                     milisegundos = EXCLUDED.milisegundos, usuario_id = EXCLUDED.usuario_id, version = EXCLUDED.version`,
    [dia, filas.length, n1(filas.reduce((s, f) => s + (Number(f.km_fuera) || 0), 0)), milisegundos || null, usuarioId || null, version]);
}

/** Las personas de unos días, con sus coches. */
async function dias(desde, hasta) {
  const [p, c] = await Promise.all([
    db.consulta(
      `SELECT to_char(d.dia, 'YYYY-MM-DD') AS dia, d.persona, d.conductor_id, d.nombre, d.turno, d.programado, d.trabajo,
              d.horas, d.oficina, d.justificado, d.limite_km, d.km_fuera, d.revisar, d.fichaje, d.sin_fichar, d.horas_viaje
         FROM km_banco_dia d
        WHERE d.dia BETWEEN $1::date AND $2::date
        ORDER BY d.dia`, [desde, hasta]),
    db.consulta(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, persona, matricula, km_fuera
         FROM km_banco_coche WHERE dia BETWEEN $1::date AND $2::date ORDER BY dia, km_fuera DESC`, [desde, hasta]),
  ]);
  return {
    personas: p.rows.map(x => ({
      dia: x.dia, persona: x.persona, conductorId: x.conductor_id == null ? null : Number(x.conductor_id), nombre: x.nombre,
      turno: x.turno, programado: x.programado, trabajo: x.trabajo, horas: n1(x.horas), oficina: x.oficina,
      justificado: x.justificado, limite: n1(x.limite_km), km: n1(x.km_fuera), revisar: x.revisar,
      horasViaje: Math.round((Number(x.horas_viaje) || 0) * 100) / 100,
      fichaje: x.fichaje, sinFichar: x.sin_fichar,
    })),
    coches: c.rows.map(x => ({ dia: x.dia, persona: x.persona, matricula: x.matricula, km: n1(x.km_fuera) })),
  };
}

/**
 * Las semanas de una persona (lunes → { limite, km, dias }), desde un lunes.
 * `km`: lo que gastó, ya sin los km justificados y aprobados de cada día.
 */
async function semanasDe(persona, desde, hasta) {
  const r = await db.consulta(
    `SELECT to_char(date_trunc('week', d.dia)::date, 'YYYY-MM-DD') AS lunes,
            sum(d.limite_km) AS limite, sum(GREATEST(0, d.km_fuera - COALESCE(j.km, 0))) AS km,
            count(*) FILTER (WHERE d.limite_km > 0)::int AS dias
       FROM km_banco_dia d
       LEFT JOIN (SELECT 'c' || conductor_id AS persona, dia, sum(km) AS km FROM km_justificacion
                   WHERE aprobado_at IS NOT NULL AND anulado_at IS NULL AND dia BETWEEN $2::date AND $3::date
                   GROUP BY 1, 2) j ON j.persona = d.persona AND j.dia = d.dia
      WHERE d.persona = $1 AND d.dia BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY 1 DESC`, [persona, desde, hasta]);
  return r.rows.map(x => ({ lunes: x.lunes, limite: n1(x.limite), km: n1(x.km), dias: x.dias }));
}

// ── EL DESGLOSE DE UNA PERSONA (18/11/2026) ──────────────────────────────────
// Lo que hace falta para repartir sus km por causa (bancoKm.desglose.js): solo
// sus coches de esa semana. Todo va por índices (fv_tramo por coche y por
// cuenta, fv_odometro y fv_ruta por equipo, el fichaje por fecha): son unos
// miles de filas, no la flota.

/** Sus días y sus coches de una semana, de la foto. */
async function diasDe(persona, desde, hasta) {
  const [d, c] = await Promise.all([
    db.consulta(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, turno, km_fuera FROM km_banco_dia
        WHERE persona = $1 AND dia BETWEEN $2::date AND $3::date ORDER BY dia`, [persona, desde, hasta]),
    db.consulta(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, matricula, km_fuera FROM km_banco_coche
        WHERE persona = $1 AND dia BETWEEN $2::date AND $3::date ORDER BY dia, km_fuera DESC`, [persona, desde, hasta]),
  ]);
  return {
    dias: d.rows.map(x => ({ dia: x.dia, turno: x.turno || '', km: n1(x.km_fuera) })),
    coches: c.rows.map(x => ({ dia: x.dia, matricula: x.matricula, km: n1(x.km_fuera) })),
  };
}

const ms = v => (v == null ? null : new Date(v).getTime());

/**
 * Los datos crudos de unos coches entre dos instantes (ms): sus tramos de BOLT
 * (y los de esas cuentas en otros coches, para el corte), sus km (odómetro y
 * GPS), sus fichajes y quién es cada cuenta.
 */
async function crudoDesglose({ matriculas, ini, fin }) {
  const desde = new Date(ini).toISOString(), hasta = new Date(fin).toISOString();
  const veh = (await db.consulta(
    `SELECT uuid, matricula, mapon_unit FROM fv_vehiculo WHERE matricula = ANY($1::text[])`, [matriculas])).rows;
  const uuids = veh.map(v => v.uuid);
  const units = veh.filter(v => v.mapon_unit != null).map(v => String(v.mapon_unit));
  if (!uuids.length) return { vehiculos: [], tramos: [], odometro: [], rutas: [], fichajes: [], cuentas: [], fantasmas: [] };

  const aTramo = x => ({ id: Number(x.id), vehiculo: x.vehiculo_uuid, cuenta: x.conductor_uuid, situacion: x.situacion, desde: ms(x.desde), hasta: ms(x.hasta) });
  const propios = (await db.consulta(
    `SELECT id, vehiculo_uuid, conductor_uuid, situacion, desde, hasta FROM fv_tramo
      WHERE vehiculo_uuid = ANY($1::text[]) AND conductor_uuid IS NOT NULL
        AND desde >= $2::timestamptz - interval '12 hours' AND desde < $3::timestamptz`, [uuids, desde, hasta])).rows.map(aTramo);
  const cuentas = [...new Set(propios.map(t => t.cuenta))];
  const [fuera, odo, rut, fich, ext, fan] = await Promise.all([
    // Las mismas cuentas en otros coches: el corte de un tramo cuando él aparece en otro.
    cuentas.length ? db.consulta(
      `SELECT id, vehiculo_uuid, conductor_uuid, situacion, desde, hasta FROM fv_tramo
        WHERE conductor_uuid = ANY($1::text[]) AND NOT (vehiculo_uuid = ANY($2::text[]))
          AND desde >= $3::timestamptz - interval '12 hours' AND desde < $4::timestamptz`, [cuentas, uuids, desde, hasta]) : { rows: [] },
    units.length ? db.consulta(
      `SELECT unit_id, inicio, fin, metros FROM fv_odometro
        WHERE unit_id = ANY($1::bigint[]) AND inicio >= $2::timestamptz - interval '1 hour' AND inicio < $3::timestamptz AND fin > inicio`,
      [units, desde, hasta]) : { rows: [] },
    units.length ? db.consulta(
      `SELECT unit_id, inicio, fin, metros FROM fv_ruta
        WHERE unit_id = ANY($1::bigint[]) AND inicio >= $2::timestamptz - interval '1 day' AND inicio < $3::timestamptz
          AND fin IS NOT NULL AND fin > inicio`, [units, desde, hasta]) : { rows: [] },
    db.consulta(
      `SELECT id, conductor_id, usuario_id, telefono, unit_id, upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) AS matricula,
              inicio, fin, estado
         FROM fichaje_turno
        WHERE inicio >= $2::timestamptz - interval '3 days' AND inicio < $3::timestamptz AND COALESCE(fin, now()) > $2::timestamptz
          AND (unit_id = ANY($4::text[]) OR upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g')) = ANY($1::text[]))`,
      [matriculas, desde, hasta, units]),
    cuentas.length ? db.consulta(
      `SELECT ce.externo_id, ce.conductor_id,
              COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || COALESCE(' ' || c.apellidos, '')), ce.externo_nombre) AS nombre
         FROM conductor_externo ce LEFT JOIN conductor c ON c.id = ce.conductor_id
        WHERE ce.sistema = 'bolt' AND ce.externo_id = ANY($1::text[])`, [cuentas]) : { rows: [] },
    // Las cuentas prestadas: ese día, sus km son de quien la usaba.
    cuentas.length ? db.consulta(
      `SELECT ce.externo_id, f.conductor_id, to_char(f.desde, 'YYYY-MM-DD') AS desde, to_char(f.hasta, 'YYYY-MM-DD') AS hasta,
              COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || COALESCE(' ' || c.apellidos, ''))) AS nombre
         FROM cuenta_fantasma f JOIN conductor_externo ce ON ce.id = f.cuenta_id LEFT JOIN conductor c ON c.id = f.conductor_id
        WHERE f.anulado_at IS NULL AND ce.externo_id = ANY($1::text[])`, [cuentas]) : { rows: [] },
  ]);
  const seg = x => ({ unit: String(x.unit_id), inicio: ms(x.inicio), fin: ms(x.fin), metros: Number(x.metros) || 0 });
  return {
    vehiculos: veh.map(v => ({ uuid: v.uuid, matricula: v.matricula, unit: v.mapon_unit == null ? null : String(v.mapon_unit) })),
    tramos: [...propios, ...fuera.rows.map(aTramo)],
    odometro: odo.rows.map(seg),
    rutas: rut.rows.map(seg),
    fichajes: fich.rows.map(x => ({
      id: Number(x.id), unit: x.unit_id || '', matricula: x.matricula,
      dueno: x.conductor_id ? `c${Number(x.conductor_id)}` : x.usuario_id ? `u${Number(x.usuario_id)}` : `t${x.telefono || ''}`,
      inicio: ms(x.inicio), fin: ms(x.fin), estado: x.estado,
    })),
    cuentas: ext.rows.map(x => ({ cuenta: x.externo_id, conductorId: x.conductor_id == null ? null : Number(x.conductor_id), nombre: x.nombre || '' })),
    fantasmas: fan.rows.map(x => ({ cuenta: x.externo_id, conductorId: Number(x.conductor_id), desde: x.desde, hasta: x.hasta, nombre: x.nombre || '' })),
  };
}

// 42P01: falta la tabla (db/267); 42703: falta una columna (db/268).
const faltaMigracion = e => e && (e.code === '42P01' || e.code === '42703' || /km_banco_|horas_viaje/.test(String(e.message || '')));

module.exports = { calculados, calculos, guardarDia, dias, semanasDe, diasDe, crudoDesglose, faltaMigracion };
