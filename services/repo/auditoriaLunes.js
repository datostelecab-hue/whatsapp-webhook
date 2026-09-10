// ============================================================
// AUDITORÍA DE LOS LUNES — quién debía salir, quién salió y por qué no
// ============================================================
// El lunes es el día que más horas se cae, y hasta ahora no había forma de mirar
// por qué. Esto contesta las dos preguntas por separado:
//
//   · POR CONDUCTOR  — de los N últimos lunes, en cuáles le tocaba salir, en
//                      cuáles salió, cuántas horas hizo, y si no salió, la razón:
//                      vacaciones, baja médica, un justificante o nada.
//   · POR MATRÍCULA  — el mismo lunes visto desde el coche: cada plaza (día y
//                      noche) con quien la tenía asignada, y los huecos, que es
//                      donde se pierden las horas de verdad.
//
// ── El plan es el de HOY, proyectado hacia atrás ────────────────────────────
// En PostgreSQL no hay planificación anterior al 3 de septiembre: todas las
// asignaciones vivas nacen ese día o después. Así que "le tocaba salir" se
// resuelve con el cuadrante ACTUAL —matrícula incluida— aplicado a los cuatro
// lunes. Es lo que se pidió y es lo que refleja la realidad: el planificador
// lleva semanas igual. Se dice en la cabecera del Excel para que nadie lo lea
// como una foto histórica.
//
// ── Quién entra ─────────────────────────────────────────────────────────────
// Solo quien tiene plaza y a quien le toca LUNES:
//   · FIJO → si su coche no descansa los lunes.
//   · CT   → si su asignación tiene el lunes marcado (el correturnos que cubre el
//            descanso de los fijos de ese coche).
// Los fijos de un coche que descansa L-M no salen NUNCA un lunes: fuera del
// reporte ("siempre son los mismos"). Los de baja en la empresa, tampoco.
//
// ── La regla del alta ───────────────────────────────────────────────────────
// Un lunes anterior a su fecha de alta NO es exigible: no se le puede acusar de
// faltar a un día en el que todavía no trabajaba aquí. Quien entró el martes
// pasado tiene un solo lunes que contar.

const db = require('../db');

// El descanso del coche se guarda como ISODOW (1 = lunes).
const LUNES = 1;
const DIA_LETRA = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };

const h1 = seg => (seg == null ? 0 : Math.round((Number(seg) / 3600) * 10) / 10);
const esFecha = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// ── Los lunes ───────────────────────────────────────────────────────────────
// Los N últimos lunes YA CERRADOS. El de esta semana entra solo si ya pasó: si
// hoy es lunes, la jornada aún no ha terminado y contarla sería acusar a medio
// mundo de no haber salido todavía.
async function ultimosLunes(n) {
  const r = await db.consulta(
    `WITH hoy AS (SELECT (now() AT TIME ZONE 'Europe/Madrid')::date AS d),
     base AS (
       SELECT CASE WHEN date_trunc('week', d)::date < d
                   THEN date_trunc('week', d)::date
                   ELSE (date_trunc('week', d) - interval '7 days')::date END AS lunes
         FROM hoy)
     SELECT to_char(g.d, 'YYYY-MM-DD') AS dia
       FROM base, generate_series(base.lunes - ($1::int - 1) * 7, base.lunes, interval '7 days') g(d)
      ORDER BY g.d`, [Math.max(1, Math.min(Number(n) || 4, 12))]);
  return r.rows.map(x => x.dia);
}

// ── El plan del lunes, sacado del cuadrante actual ───────────────────────────
// Misma regla que f_cobertura PERO sin descontar a los ausentes: aquí interesa
// justamente quién debía salir y no salió porque estaba de vacaciones o de baja.
const SQL_PLAN = `
  WITH descansa_lunes AS (
    SELECT DISTINCT vd.vehiculo_id
      FROM vehiculo_descanso vd
      JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
     WHERE vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)
       AND vdd.dia_semana = ${LUNES})
  SELECT p.id AS plaza_id, p.vehiculo_id, p.slot, s.rol, s.orden_ct,
         s.turno_id, t.etiqueta AS turno,
         a.id AS asignacion_id, a.conductor_id,
         to_char(a.desde, 'YYYY-MM-DD') AS asignado_desde
    FROM asignacion a
    JOIN plaza p    ON p.id = a.plaza_id AND p.baja_at IS NULL
    JOIN cat_slot s ON s.slot = p.slot
    JOIN turno t    ON t.id = s.turno_id
    JOIN vehiculo v ON v.id = p.vehiculo_id AND v.baja_at IS NULL
   WHERE a.hasta IS NULL
     AND (CASE WHEN s.rol = 'CT'
               THEN EXISTS (SELECT 1 FROM asignacion_dia ad
                             WHERE ad.asignacion_id = a.id AND ad.dia_semana = ${LUNES})
               ELSE p.vehiculo_id NOT IN (SELECT vehiculo_id FROM descansa_lunes)
          END)`;

// Los coches del cuadrante: todos los que tienen plaza viva, con su estado y sus
// días de descanso. Los no operativos también salen —un coche en el taller es una
// razón perfectamente válida de por qué no rodó— pero marcados.
const SQL_COCHES = `
  SELECT v.id, v.matricula, COALESCE(v.marca_modelo, '') AS modelo,
         v.estado_operativo, COALESCE(e.etiqueta, v.estado_operativo) AS estado,
         COALESCE(e.es_operativo, FALSE) AS operativo,
         (SELECT array_agg(DISTINCT vdd.dia_semana ORDER BY vdd.dia_semana)
            FROM vehiculo_descanso vd
            JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
           WHERE vd.vehiculo_id = v.id
             AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)) AS descansos
    FROM vehiculo v
    LEFT JOIN cat_estado_vehiculo e ON e.codigo = v.estado_operativo
   WHERE v.baja_at IS NULL
     AND EXISTS (SELECT 1 FROM plaza p WHERE p.vehiculo_id = v.id AND p.baja_at IS NULL)
   ORDER BY (e.es_operativo IS NOT TRUE), v.matricula`;

/**
 * El informe entero. Devuelve los lunes, la lista por conductor, la lista por
 * matrícula y el resumen que va en la primera hoja.
 */
async function informe({ lunes = 4 } = {}) {
  const dias = await ultimosLunes(lunes);
  const desde = dias[0], hasta = dias[dias.length - 1];

  const [plan, coches, roster, horas, ausencias, justis, bolt] = await Promise.all([
    db.consulta(SQL_PLAN),
    db.consulta(SQL_COCHES),
    // El nombre de BOLT manda, como en toda la casa.
    db.consulta(
      `SELECT conductor_id,
              COALESCE(NULLIF(btrim(bolt_nombre), ''),
                       NULLIF(btrim(nombre), '') || ' (sin nombre de BOLT)',
                       'Conductor ' || conductor_id) AS nombre,
              telefono, tipo_contrato, zona, empleo_vigente,
              alta::text AS alta, baja::text AS baja, estado_etiqueta
         FROM bi_dim_conductor`),
    db.consulta(
      `SELECT conductor_id, to_char(dia_operativo, 'YYYY-MM-DD') AS dia, horas_seg
         FROM bitacora_horas WHERE dia_operativo = ANY($1::date[])`, [dias]),
    // Las ausencias que TOCAN alguno de los lunes: el periodo puede empezar antes
    // y acabar después, así que se cruza por solape y luego se mira lunes a lunes.
    db.consulta(
      `SELECT h.conductor_id, ce.etiqueta, ce.marca_bitacora AS marca,
              to_char(h.desde, 'YYYY-MM-DD') AS desde,
              to_char(h.hasta, 'YYYY-MM-DD') AS hasta
         FROM conductor_estado_hist h
         JOIN cat_estado_conductor ce ON ce.codigo = h.estado
        WHERE ce.es_ausencia
          AND h.desde <= $2::date AND (h.hasta IS NULL OR h.hasta >= $1::date)`, [desde, hasta]),
    db.consulta(
      `SELECT conductor_id, to_char(dia_operativo, 'YYYY-MM-DD') AS dia,
              COALESCE(tipo, '') AS tipo, horas_seg_momento, COALESCE(observacion, '') AS observacion
         FROM justificante
        WHERE anulado_at IS NULL AND dia_operativo = ANY($1::date[])`, [dias]),
    // Quién tiene cuenta de BOLT enlazada: sin ella un 0 no significa que faltara,
    // significa que no se puede leer.
    db.consulta(
      `SELECT DISTINCT conductor_id FROM conductor_externo
        WHERE sistema = 'bolt' AND conductor_id IS NOT NULL`),
  ]);

  const rosterDe = new Map(roster.rows.map(r => [Number(r.conductor_id), r]));
  const conBolt = new Set(bolt.rows.map(r => Number(r.conductor_id)));

  const hDe = new Map();                                    // 'cid|dia' -> horas
  horas.rows.forEach(r => hDe.set(`${r.conductor_id}|${r.dia}`, h1(r.horas_seg)));

  const jDe = new Map();                                    // 'cid|dia' -> justificante
  justis.rows.forEach(r => jDe.set(`${r.conductor_id}|${r.dia}`, {
    tipo: r.tipo, horas: r.horas_seg_momento == null ? null : h1(r.horas_seg_momento),
    obs: r.observacion,
  }));

  const ausDe = new Map();                                  // cid -> [periodos]
  ausencias.rows.forEach(r => {
    const cid = Number(r.conductor_id);
    if (!ausDe.has(cid)) ausDe.set(cid, []);
    ausDe.get(cid).push(r);
  });
  const ausenciaEn = (cid, dia) =>
    (ausDe.get(cid) || []).find(a => a.desde <= dia && (!a.hasta || a.hasta >= dia)) || null;

  const cocheDe = new Map(coches.rows.map(v => [Number(v.id), {
    id: Number(v.id), matricula: v.matricula, modelo: v.modelo,
    estado: v.estado, operativo: !!v.operativo, estadoCodigo: v.estado_operativo,
    descansos: (v.descansos || []).map(d => DIA_LETRA[d] || d).join('·'),
    descansaLunes: (v.descansos || []).includes(LUNES),
  }]));

  // ── La celda: qué pasó ese lunes con esa persona ──────────────────────────
  // El orden importa. Primero si el lunes le era exigible (alta), después si
  // rodó —que es un hecho y manda sobre cualquier etiqueta—, y solo si no rodó
  // se busca la razón: ausencia, justificante, o nada.
  function celda(cid, dia) {
    const p = rosterDe.get(cid) || {};
    if (p.alta && dia < p.alta) return { estado: 'no_exigible', horas: null, motivo: `Alta el ${esFecha(p.alta)}` };
    if (p.baja && dia > p.baja) return { estado: 'no_exigible', horas: null, motivo: `Baja el ${esFecha(p.baja)}` };

    const hrs = hDe.get(`${cid}|${dia}`) || 0;
    const aus = ausenciaEn(cid, dia);
    const j = jDe.get(`${cid}|${dia}`);

    if (hrs > 0) {
      // Rodó. Si además constaba ausente o tenía J, se dice: es justo el tipo de
      // cosa que hay que mirar a mano.
      const nota = aus ? `Rodó constando ${String(aus.etiqueta).toLowerCase()}`
        : j ? `Rodó con J de ${j.tipo || 'sin tipo'}${j.horas != null ? ` (${j.horas} h justificadas)` : ''}`
          : '';
      return { estado: 'salio', horas: hrs, motivo: nota };
    }
    if (aus) return { estado: 'ausencia', horas: 0, motivo: aus.etiqueta, marca: aus.marca };
    if (j) {
      return {
        estado: 'justificado', horas: 0,
        motivo: `J · ${j.tipo || 'sin tipo'}${j.horas != null ? ` · ${j.horas} h` : ''}` +
          (j.obs ? ` · ${j.obs}` : ''),
      };
    }
    if (!conBolt.has(cid)) return { estado: 'sin_bolt', horas: 0, motivo: 'Sin cuenta de BOLT enlazada' };
    return { estado: 'no_salio', horas: 0, motivo: 'No salió — sin justificar' };
  }

  // ── POR CONDUCTOR ─────────────────────────────────────────────────────────
  // Una persona puede tener dos plazas (día y noche en coches distintos): se
  // juntan en una fila, con las dos matrículas, porque sus horas son unas.
  const porConductor = new Map();
  plan.rows.forEach(f => {
    const cid = Number(f.conductor_id);
    const p = rosterDe.get(cid);
    if (!p || !p.empleo_vigente) return;                    // los de baja en la empresa, fuera
    const v = cocheDe.get(Number(f.vehiculo_id));
    if (!porConductor.has(cid)) {
      porConductor.set(cid, {
        conductorId: cid, nombre: p.nombre, telefono: p.telefono || '',
        contrato: p.tipo_contrato || '', zona: p.zona || '',
        alta: p.alta || null, estadoHoy: p.estado_etiqueta || '',
        bolt: conBolt.has(cid), plazas: [], dias: {},
      });
    }
    porConductor.get(cid).plazas.push({
      matricula: v ? v.matricula : '?', turno: f.turno, rol: f.rol,
      descansos: v ? v.descansos : '', estadoCoche: v ? v.estado : '',
      cocheOperativo: v ? v.operativo : false,
    });
  });

  porConductor.forEach(c => {
    c.matriculas = [...new Set(c.plazas.map(p => p.matricula))].join(' · ');
    c.turnos = [...new Set(c.plazas.map(p => p.turno))].join(' · ');
    c.rol = [...new Set(c.plazas.map(p => p.rol))].join(' · ');
    c.descansos = [...new Set(c.plazas.map(p => p.descansos).filter(Boolean))].join(' · ');
    c.estadoCoche = [...new Set(c.plazas.map(p => p.estadoCoche).filter(Boolean))].join(' · ');
    dias.forEach(d => { c.dias[d] = celda(c.conductorId, d); });
    const cs = dias.map(d => c.dias[d]);
    c.exigibles = cs.filter(x => x.estado !== 'no_exigible').length;
    c.salidas = cs.filter(x => x.estado === 'salio').length;
    c.faltas = cs.filter(x => x.estado === 'no_salio').length;
    c.justificados = cs.filter(x => x.estado === 'justificado').length;
    c.ausentes = cs.filter(x => x.estado === 'ausencia').length;
    c.horas = Math.round(cs.reduce((a, x) => a + (x.horas || 0), 0) * 10) / 10;
    c.media = c.salidas ? Math.round((c.horas / c.salidas) * 10) / 10 : 0;
    c.cumple = c.exigibles ? Math.round((c.salidas / c.exigibles) * 100) : null;
  });

  // ── POR MATRÍCULA ─────────────────────────────────────────────────────────
  // La unidad es la PLAZA del lunes: cada coche tiene una de día y una de noche,
  // ocupada por su fijo o —si ese coche descansa los lunes— por el correturnos.
  // Un hueco aquí es un coche parado, y es la mitad de la respuesta.
  const planPorSitio = new Map();                           // 'vehId|turnoId' -> fila del plan
  plan.rows.forEach(f => planPorSitio.set(`${f.vehiculo_id}|${f.turno_id}`, f));

  const porCoche = [];
  coches.rows.forEach(v => {
    const veh = cocheDe.get(Number(v.id));
    [{ id: 1, etiqueta: 'Día' }, { id: 2, etiqueta: 'Noche' }].forEach(t => {
      const f = planPorSitio.get(`${v.id}|${t.id}`);
      const cid = f ? Number(f.conductor_id) : null;
      const p = cid ? rosterDe.get(cid) : null;
      const fila = {
        matricula: veh.matricula, modelo: veh.modelo, estadoCoche: veh.estado,
        operativo: veh.operativo, descansos: veh.descansos, descansaLunes: veh.descansaLunes,
        turno: t.etiqueta,
        conductorId: cid, conductor: p ? p.nombre : '', telefono: p ? p.telefono || '' : '',
        rol: f ? f.rol : '', vigente: p ? !!p.empleo_vigente : false,
        dias: {},
      };
      dias.forEach(d => {
        if (!cid) {
          fila.dias[d] = {
            estado: 'sin_plan', horas: null,
            motivo: veh.descansaLunes ? 'Sin correturnos asignado el lunes' : 'Sin nadie planificado',
          };
        } else if (!fila.vigente) {
          fila.dias[d] = { estado: 'sin_plan', horas: null, motivo: 'Plaza de alguien ya de baja' };
        } else {
          fila.dias[d] = celda(cid, d);
        }
      });
      const cs = dias.map(d => fila.dias[d]);
      fila.salidas = cs.filter(x => x.estado === 'salio').length;
      fila.horas = Math.round(cs.reduce((a, x) => a + (x.horas || 0), 0) * 10) / 10;
      fila.huecos = cs.filter(x => x.estado === 'sin_plan' || x.estado === 'no_salio').length;
      porCoche.push(fila);
    });
  });

  // ── EL DETALLE, FILA A FILA ───────────────────────────────────────────────
  // Todo lo que NO fue un lunes normal de trabajo: las faltas, las J con sus horas
  // (las de BOLT y las justificadas, como en la bitácora), las ausencias, y también
  // las rarezas —quien rodó constando de vacaciones—. Es la lista con la que se
  // llama por teléfono, así que va plana y ordenada por día.
  const detalle = [];
  const lista0 = [...porConductor.values()];
  lista0.forEach(c => dias.forEach(d => {
    const x = c.dias[d];
    if (x.estado === 'salio' && !x.motivo) return;          // un lunes normal no se detalla
    if (x.estado === 'no_exigible') return;                 // ni un día en el que no estaba
    const j = jDe.get(`${c.conductorId}|${d}`);
    detalle.push({
      dia: d, conductorId: c.conductorId, nombre: c.nombre, telefono: c.telefono,
      matricula: c.matriculas, turno: c.turnos, rol: c.rol,
      estado: x.estado, motivo: x.motivo,
      horasBolt: x.horas, horasJ: j ? j.horas : null, tipoJ: j ? j.tipo : '',
      observacion: j ? j.obs : '',
    });
  }));
  detalle.sort((a, b) => a.dia.localeCompare(b.dia) || a.nombre.localeCompare(b.nombre, 'es'));

  // ── RESUMEN ───────────────────────────────────────────────────────────────
  const lista = lista0;
  const cuenta = (arr, e) => arr.filter(x => x.estado === e).length;
  const porLunes = dias.map(d => {
    const cs = lista.map(c => c.dias[d]);
    const sitios = porCoche.filter(f => f.operativo).map(f => f.dias[d]);
    return {
      dia: d,
      exigibles: cs.length - cuenta(cs, 'no_exigible'),
      salidas: cuenta(cs, 'salio'),
      faltas: cuenta(cs, 'no_salio'),
      justificados: cuenta(cs, 'justificado'),
      ausentes: cuenta(cs, 'ausencia'),
      sinBolt: cuenta(cs, 'sin_bolt'),
      noExigibles: cuenta(cs, 'no_exigible'),
      horas: Math.round(cs.reduce((a, x) => a + (x.horas || 0), 0) * 10) / 10,
      plazas: sitios.length,
      plazasCubiertas: cuenta(sitios, 'salio'),
      plazasSinPlan: cuenta(sitios, 'sin_plan'),
    };
  });

  return {
    dias,
    generado: new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()),
    conductores: lista.sort((a, b) =>
      (b.faltas - a.faltas) || (a.horas - b.horas) || a.nombre.localeCompare(b.nombre, 'es')),
    coches: porCoche,
    detalle,
    porLunes,
    totales: {
      conductores: lista.length,
      coches: coches.rows.length,
      cochesOperativos: coches.rows.filter(v => v.operativo).length,
      plazasLunes: porCoche.filter(f => f.operativo).length,
      conPlan: plan.rows.length,
      horas: Math.round(porLunes.reduce((a, x) => a + x.horas, 0) * 10) / 10,
      faltas: porLunes.reduce((a, x) => a + x.faltas, 0),
    },
  };
}

module.exports = { informe, ultimosLunes };
