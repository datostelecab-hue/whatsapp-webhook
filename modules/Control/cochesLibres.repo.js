// ============================================================
// COCHES SIN CUADRANTE · REPOSITORIO — el coche como sujeto
// ============================================================
// Todo Control mira a PERSONAS: quién no ha salido, quién rueda con la app
// cerrada, a quién hay que llamar. Esta pantalla mira COCHES, y no es la misma
// pregunta: no es «a quién llamo», es «quién está usando esto».
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
//
// El 16/09/2026 el 5646MDM rodó un miércoles y un jueves. No aparecía en
// ninguna pantalla de Control, y no por un fallo: es que para Control no
// existía. Su correturnos, José Ignacio, está de baja médica, así que esos dos
// días la plaza no la cubre nadie; y un coche que nadie tiene planificado no
// sale en un tablero que se construye a partir de la gente. Lo condujo alguien
// de fuera de la empresa.
//
// Ese es el agujero: el sistema vigila muy bien a quien está en el cuadrante, y
// no vigilaba en absoluto a los que no están en él. Un coche sin nadie
// planificado que rueda es, por definición, alguien que conduce sin fichar.
//
// ── LAS TRES LISTAS, Y POR QUÉ SON TRES ─────────────────────────────────────
//
//   · SIN NADIE PLANIFICADO. Tiene plaza y cuadrante, pero ese turno de ese día
//     no lo cubre nadie —una baja, unas vacaciones sin cubrir, un hueco—. Es el
//     caso del 5646MDM y el más peligroso, porque el coche está operativo y con
//     llaves.
//   · DE RESERVA. Operativo y sin ninguna plaza: no es de nadie. Si se mueve,
//     alguien lo ha cogido, y no hay cuadrante contra el que comprobarlo.
//   · FUERA DE COBERTURA. En taller, siniestro o emergencia. No debería moverse
//     en absoluto, y si lo hace no es Tráfico quien lo está moviendo.
//
// ── CÓMO SE MIDE QUE «RODÓ» ─────────────────────────────────────────────────
//
// Con `fv_ruta`, que es la fuente de la casa para kilómetros: los trayectos de
// Mapon, que no dependen de que nadie se conecte a BOLT. Es justamente la
// gracia — un coche que nadie ficha no genera un solo apunte de BOLT, así que
// preguntarle a BOLT por él devuelve silencio.
//
// El mínimo son 3 km (`CONTROL_MIN_KM_SIN_PLAN`). Por debajo es moverlo dentro
// del parking o el error del GPS parado, y una lista que grita por cada coche
// que se recolocó no la mira nadie.

const db = require('../../services/db');

const MIN_KM = Number(process.env.CONTROL_MIN_KM_SIN_PLAN || 3);

/**
 * La foto de una jornada (05:00 → 05:00): qué coches rodaron sin que hubiera
 * nadie puesto para llevarlos.
 *
 * Una sola consulta. Los km, el cuadrante, la cobertura y el estado del coche
 * viven todos en la misma base, y partirlo en cuatro viajes solo serviría para
 * que las cuatro fotos fueran de instantes distintos.
 */
async function delDia(dia) {
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + interval '5 hours')  AT TIME ZONE 'Europe/Madrid'       AS d_ini,
              ($1::date + interval '17 hours') AT TIME ZONE 'Europe/Madrid'       AS d_fin,
              (($1::date + 1) + interval '5 hours') AT TIME ZONE 'Europe/Madrid'  AS n_fin
     ),
     j AS (SELECT d_ini, LEAST(d_fin, now()) AS d_fin2, d_fin,
                  LEAST(n_fin, now()) AS n_fin2 FROM v),
     -- LO QUE RODO CADA COCHE EN CADA TURNO, sin mirar quien iba dentro. De
     -- Mapon, no de BOLT: un coche que nadie ficha no deja un solo apunte de
     -- BOLT, y preguntarle a BOLT por el devuelve silencio.
     rodo AS (
       SELECT veh.matricula, veh.mapon_unit,
              CASE WHEN r.inicio < j.d_fin THEN 'dia' ELSE 'noche' END AS turno,
              sum(r.metros)  AS metros,
              count(*)       AS trayectos,
              min(r.inicio)  AS primera,
              max(r.fin)     AS ultima
         FROM fv_ruta r
         CROSS JOIN j
         JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
        WHERE r.fin IS NOT NULL AND r.fin > r.inicio
          AND r.inicio >= j.d_ini AND r.inicio < j.n_fin2
        GROUP BY 1, 2, 3
     ),
     -- QUIEN ESTUVO CONECTADO con el en ese turno, si es que alguien lo estuvo.
     -- Separa "rodo sin plan pero fichado" de "rodo y no habia nadie".
     fichados AS (
       SELECT veh.matricula,
              CASE WHEN t.desde < j.d_fin THEN 'dia' ELSE 'noche' END AS turno,
              string_agg(DISTINCT COALESCE(NULLIF(btrim(fc.nombre), ''), t.conductor_uuid), ', ') AS gente
         FROM fv_tramo t
         CROSS JOIN j
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
         LEFT JOIN fv_conductor fc ON fc.uuid = t.conductor_uuid
        WHERE t.conductor_uuid IS NOT NULL
          AND t.desde < j.n_fin2 AND COALESCE(t.hasta, j.n_fin2) > j.d_ini
        GROUP BY 1, 2
     ),
     -- CUANTA GENTE HABIA PLANIFICADA, POR COCHE Y POR TURNO.
     --
     -- Por TURNO y no por coche, que es la diferencia entre ver el caso y no
     -- verlo: el 5646MDM tiene fijo de dia, asi que mirando el coche entero
     -- siempre sale "planificado" y sus miercoles y jueves de noche —los dias
     -- que libra el fijo y su correturnos esta de baja— no aparecian en ningun
     -- sitio. Que es exactamente el coche que se fue con alguien de fuera.
     --
     -- Aqui f_cobertura SI es la fuente buena: la pregunta es literalmente
     -- "quien sale hoy con este coche".
     plan AS (
       SELECT c.vehiculo_id, tu.codigo AS turno, count(DISTINCT c.conductor_id) AS personas
         FROM f_cobertura($1::date, $1::date, TRUE) c
         JOIN turno tu ON tu.id = c.turno_id
        GROUP BY 1, 2
     ),
     -- Y LAS SALIDAS DE ZONA del dia, que es la otra cosa que hay que saber de
     -- un coche que no deberia estar rodando.
     zonas AS (
       SELECT z.unit_id,
              CASE WHEN z.ocurrio_at < j.d_fin THEN 'dia' ELSE 'noche' END AS turno,
              count(*) AS salidas, string_agg(DISTINCT btrim(z.zona), ', ') AS de_donde
         FROM mapon_zona_alerta z
         CROSS JOIN j
        WHERE z.tipo = 'not_in_obj'
          AND z.ocurrio_at >= j.d_ini AND z.ocurrio_at < j.n_fin2
        GROUP BY 1, 2
     )
     SELECT ve.matricula, ro.turno,
            ve.estado_operativo, cev.etiqueta AS estado, cev.es_operativo,
            bz.nombre AS zona_base,
            (SELECT count(*) FROM plaza p
              WHERE p.vehiculo_id = ve.id AND p.baja_at IS NULL) AS plazas,
            COALESCE(pl.personas, 0) AS planificados,
            round((ro.metros / 1000.0)::numeric, 1)::float8 AS km,
            ro.trayectos,
            to_char(ro.primera AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS desde_hora,
            to_char(ro.ultima  AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hasta_hora,
            fi.gente AS fichados,
            COALESCE(zo.salidas, 0) AS salidas_zona,
            zo.de_donde AS zonas_salidas
       FROM rodo ro
       JOIN vehiculo ve ON ve.matricula = ro.matricula AND ve.baja_at IS NULL
       JOIN cat_estado_vehiculo cev ON cev.codigo = ve.estado_operativo
       LEFT JOIN base_zona bz ON bz.id = ve.base_zona_id
       LEFT JOIN fichados fi ON fi.matricula = ro.matricula AND fi.turno = ro.turno
       LEFT JOIN plan pl     ON pl.vehiculo_id = ve.id      AND pl.turno = ro.turno
       LEFT JOIN zonas zo    ON zo.unit_id = ro.mapon_unit  AND zo.turno = ro.turno
      -- Solo interesa lo que SE MOVIO. Un coche parado sin plan esta bien
      -- parado, y meterlo aqui convertiria la lista en el padron de la flota.
      WHERE ro.metros / 1000.0 >= $2
      ORDER BY ro.metros DESC`,
    [dia, MIN_KM]);

  const coches = r.rows.map(x => {
    const plazas = Number(x.plazas) || 0;
    const planificados = Number(x.planificados) || 0;
    // EL ORDEN DE LAS PREGUNTAS IMPORTA. Un coche en taller que rueda es un
    // coche en taller que rueda, tenga plazas o no: ese titular manda sobre
    // cualquier otro.
    // NADIE DETRAS es la lista que importa, y va la primera pase lo que pase
    // con el coche. Rodo, no habia nadie planificado y tampoco nadie conectado
    // en BOLT: eso no es un hueco de cuadrante, es alguien conduciendo sin
    // fichar. Es el caso del 5646MDM.
    //
    // Que el coche este operativo, de reserva o en taller cambia LO GRAVE que
    // es, no lo que hay que hacer: llamar y preguntar quien lo tiene.
    const nadie = planificados === 0 && !x.fichados;
    const lista = nadie ? 'sin_nadie'
      : !x.es_operativo ? 'fuera_cobertura'
      : plazas === 0 ? 'reserva'
      // Hay alguien fichado pero el cuadrante no lo puso: es un hueco de
      // planificacion, no un robo. Se ve aparte para no tapar lo de arriba.
      : planificados === 0 ? 'sin_plan'
      : null;
    return {
      matricula: x.matricula,
      turno: x.turno === 'noche' ? 'Noche' : 'Día',
      turnoCodigo: x.turno,
      estadoVeh: x.estado_operativo,
      estado: x.estado,
      operativo: !!x.es_operativo,
      zona: x.zona_base || '',
      plazas, planificados,
      km: Number(x.km) || 0,
      trayectos: Number(x.trayectos) || 0,
      desdeHora: x.desde_hora || '',
      hastaHora: x.hasta_hora || '',
      // Quién estuvo fichado con él, si alguien lo estuvo. Vacío es la señal.
      fichados: x.fichados || '',
      salidasZona: Number(x.salidas_zona) || 0,
      zonasSalidas: x.zonas_salidas || '',
      lista,
    };
  }).filter(c => c.lista);

  return {
    dia, minKm: MIN_KM,
    sinNadie: coches.filter(c => c.lista === 'sin_nadie'),
    sinPlan: coches.filter(c => c.lista === 'sin_plan'),
    reserva: coches.filter(c => c.lista === 'reserva'),
    fueraCobertura: coches.filter(c => c.lista === 'fuera_cobertura'),
    // Los km que se han movido sin NADIE detrás: ni planificado ni fichado. Es
    // la cifra que resume la pantalla, y la que de verdad no tiene dueño.
    kmSinNadie: Math.round(coches.filter(c => !c.fichados)
      .reduce((s, c) => s + c.km, 0) * 10) / 10,
    kmTotal: Math.round(coches.reduce((s, c) => s + c.km, 0) * 10) / 10,
  };
}

module.exports = { delDia, MIN_KM };
