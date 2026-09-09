// ============================================================
// ASISTENCIA — quién faltó y cuántas veces
// ============================================================
// Una FALTA es un día en el que a alguien le tocaba salir y no hizo NI UNA HORA
// en BOLT, sin justificante que lo explique. Ni más ni menos: quien estuvo en el
// taller y tiene su J no falta, y quien está de vacaciones tampoco, porque esos
// días ni siquiera le tocaba salir.
//
// LA LIBRANZA QUE SE USA ES LA DE HOY, proyectada hacia atrás. Si su coche
// descansa hoy los miércoles y los jueves, se da por hecho que también libró el
// miércoles pasado. Es una simplificación deliberada: el descanso de un coche
// cambia poco y pedirle a Tráfico que reconstruya el cuadrante de hace tres
// semanas para sacar un reporte no es razonable. Si el cuadrante cambió mucho en
// el periodo, el número se queda CORTO (marca menos faltas), que es el lado
// bueno por el que equivocarse en algo que se usa para llamar a la gente.

const db = require('../db');

const SQL = `
WITH
-- La libranza de HOY, proyectada al periodo entero.
libra_hoy AS (
  SELECT DISTINCT a.conductor_id, vdd.dia_semana
    FROM asignacion a
    JOIN plaza p              ON p.id = a.plaza_id AND p.baja_at IS NULL
    JOIN vehiculo_descanso vd ON vd.vehiculo_id = p.vehiculo_id
                             AND vd.desde <= CURRENT_DATE
                             AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)
    JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
   WHERE a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
),
-- Los días que le tocaba salir, con la regla de siempre. Ya deja fuera las
-- vacaciones y las bajas: quien está ausente no aparece en la cobertura.
tocaba AS (
  SELECT DISTINCT conductor_id, dia FROM f_cobertura($1::date, $2::date)
   WHERE conductor_id IS NOT NULL
),
tocaba_neto AS (
  SELECT t.* FROM tocaba t
   WHERE NOT EXISTS (SELECT 1 FROM libra_hoy l
                      WHERE l.conductor_id = t.conductor_id
                        AND l.dia_semana = EXTRACT(ISODOW FROM t.dia)::smallint)
),
horas AS (
  SELECT conductor_id, dia_operativo AS dia, sum(horas_seg)::bigint AS seg
    FROM bitacora_horas WHERE dia_operativo BETWEEN $1::date AND $2::date GROUP BY 1, 2
),
just AS (
  SELECT DISTINCT conductor_id, dia_operativo AS dia FROM justificante
   WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
),
falta AS (
  SELECT tn.conductor_id, tn.dia FROM tocaba_neto tn
    LEFT JOIN horas h ON h.conductor_id = tn.conductor_id AND h.dia = tn.dia
    LEFT JOIN just  j ON j.conductor_id = tn.conductor_id AND j.dia = tn.dia
   WHERE COALESCE(h.seg, 0) = 0 AND j.conductor_id IS NULL
)
SELECT c.id,
       COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
       COALESCE(tel.e164, '')      AS telefono,
       COALESCE(veh.matricula, '') AS coche,
       COALESCE(tur.etiqueta, '')  AS turno,
       (SELECT count(*) FROM tocaba_neto t WHERE t.conductor_id = c.id)::int AS tocaba,
       (SELECT count(*) FROM falta f WHERE f.conductor_id = c.id)::int       AS faltas,
       (SELECT string_agg(to_char(f.dia, 'DD/MM'), ' ' ORDER BY f.dia)
          FROM falta f WHERE f.conductor_id = c.id)                          AS dias_falta,
       (SELECT string_agg(DISTINCT CASE l.dia_semana WHEN 1 THEN 'L' WHEN 2 THEN 'M' WHEN 3 THEN 'X'
               WHEN 4 THEN 'J' WHEN 5 THEN 'V' WHEN 6 THEN 'S' ELSE 'D' END, '')
          FROM libra_hoy l WHERE l.conductor_id = c.id)                      AS libra,
       r.horas_prom, r.letra, r.dias_cero,
       e.alta::text AS alta, e.tipo, COALESCE(e.ett_nombre, '') AS ett,
       (SELECT count(*) FROM conductor_externo ce
         WHERE ce.conductor_id = c.id AND ce.sistema = 'bolt')::int          AS cuentas_bolt,
       (SELECT count(*) FROM bitacora_horas b
         WHERE b.conductor_id = c.id AND b.dia_operativo >= $1::date - 30 AND b.horas_seg > 0)::int AS dias_con_horas,
       (SELECT to_char(max(b.dia_operativo), 'DD/MM') FROM bitacora_horas b
         WHERE b.conductor_id = c.id AND b.horas_seg > 0)                    AS ultimo_dia
  FROM conductor c
  LEFT JOIN LATERAL (SELECT e164 FROM conductor_telefono
                      WHERE conductor_id = c.id AND vigente_hasta IS NULL
                      ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
  LEFT JOIN LATERAL (SELECT * FROM conductor_periodo_empleo
                      WHERE conductor_id = c.id AND baja IS NULL
                      ORDER BY alta DESC LIMIT 1) e ON TRUE
  LEFT JOIN LATERAL (
      SELECT v.matricula, s.turno_id FROM asignacion a
        JOIN plaza p    ON p.id = a.plaza_id AND p.baja_at IS NULL
        JOIN vehiculo v ON v.id = p.vehiculo_id
        JOIN cat_slot s ON s.slot = p.slot
       WHERE a.conductor_id = c.id AND a.desde <= CURRENT_DATE
         AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE) LIMIT 1) veh ON TRUE
  LEFT JOIN turno tur ON tur.id = veh.turno_id
  LEFT JOIN conductor_rendimiento r ON r.conductor_id = c.id
 WHERE c.empleo_vigente AND NOT c.es_centinela`;

/**
 * Por qué una fila NO es de fiar.
 *
 * Sin cuenta de BOLT enlazada las horas no se pueden leer: su 0 no significa que
 * faltara, significa que no lo sabemos. Y a quien entró a mitad del periodo mal
 * se le pueden pedir los días de antes. Estos no se esconden —siguen en la
 * lista, con su motivo— pero van al final: esta lista se usa para llamar a la
 * gente y el primero de la lista tiene que ser alguien a quien llamar de verdad.
 */
function dudoso(x, desde) {
  if (x.cuentas_bolt === 0) return 'sin cuenta de BOLT';
  if (x.dias_con_horas === 0) return 'nunca ha trabajado';
  if (x.alta && x.alta > desde) return `alta el ${x.alta.slice(8, 10)}/${x.alta.slice(5, 7)}`;
  return '';
}

/** Hoy en Madrid, en ISO. */
function hoyMadrid() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
}

/** El día anterior a una fecha ISO. */
function ayerDe(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * El periodo por defecto: del día 1 del mes hasta AYER.
 *
 * Hasta ayer y no hasta hoy porque la jornada de hoy no ha terminado: quien
 * entra a las 17:00 aún no ha faltado a nada.
 */
function periodoPorDefecto() {
  const hoy = hoyMadrid();
  const ayer = ayerDe(hoy);
  // Si hoy es día 1, el mes en curso no tiene ni un día cerrado: se da el
  // anterior entero, que es lo que se querría mirar.
  const desde = ayer.slice(0, 8) + '01';
  return { desde, hasta: ayer };
}

/**
 * Quién faltó en el periodo, ordenado por reincidencia.
 *
 * Devuelve TODA la plantilla activa (el que no faltó sale con 0), porque el
 * mismo cálculo sirve para las dos listas del reporte: los reincidentes y la
 * plantilla entera por promedio.
 */
async function faltas({ desde, hasta } = {}) {
  const p = periodoPorDefecto();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : p.desde;
  const h = /^\d{4}-\d{2}-\d{2}$/.test(hasta || '') ? hasta : p.hasta;
  if (h < d) throw new Error('El periodo termina antes de empezar');

  const { rows } = await db.consulta(SQL, [d, h]);
  const alFinal = x => (dudoso(x, d) ? 1 : 0);
  const prom = x => (x.horas_prom == null ? Infinity : Number(x.horas_prom));

  rows.forEach(x => { x.ojo = dudoso(x, d); });

  return {
    desde: d,
    hasta: h,
    todos: rows,
    // Peor primero: más faltas y, a igualdad, peor promedio.
    reincidentes: rows.filter(x => x.faltas > 0)
      .sort((a, b) => alFinal(a) - alFinal(b) || b.faltas - a.faltas || prom(a) - prom(b)),
    // La plantilla entera de menor a mayor promedio.
    porPromedio: [...rows]
      .sort((a, b) => alFinal(a) - alFinal(b) || prom(a) - prom(b) || b.faltas - a.faltas),
  };
}

module.exports = { faltas, periodoPorDefecto, dudoso, hoyMadrid, ayerDe };
