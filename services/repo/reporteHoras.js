// ============================================================
// REPORTE DE HORAS DEL DÍA — desde PostgreSQL, y solo desde ahí
// ============================================================
// Es el Excel que Tráfico descarga en Control: quién salió el día X, cuántas
// horas efectivas hizo, con qué coche y cuántos km.
//
// POR QUÉ SE REESCRIBIÓ (07/09/2026). El reporte del domingo 06/09 decía 752 h
// y Visibilidad, del mismo día, 825,3 h. La causa no era el cálculo de las
// horas sino DE DÓNDE SALÍA LA LISTA DE GENTE: las filas venían de las hojas
// (AGENDA_V2 para el plan y Datos_API para los NN) y las horas de PostgreSQL,
// y las dos partes se cruzaban POR EL NOMBRE. Todo el que se escribiera
// distinto en los dos sitios entraba con 0 h, y quien no estuviera en ninguna
// hoja no entraba siquiera. Encima a cada uno se le medía SOLO la ventana de su
// turno (día 05→17, noche 17→05) según lo que dijera la hoja: el de día que
// alargó hasta las 20:00 perdía esas horas y nadie las veía.
//
// Ahora la lista y las horas salen del MISMO sitio y se cruzan por el
// conductor_uuid de BOLT, que es un identificador y no un nombre:
//
//   · Horas   → actividadPorConductor(iso, 'operativo'): la jornada 05→05
//               entera, viaje + espera, con los solapes fundidos. Es la MISMA
//               ventana y la misma definición que la tarjeta "AYER · JORNADA"
//               de Visibilidad, así que los dos números tienen que coincidir.
//   · Quién   → todo el que trabajó (aunque no estuviera planificado y aunque
//               no tenga ficha nuestra: esos son los NN) + todo el que estaba
//               en el cuadrante (aunque no saliera) + todo el que tenga una J.
//   · Turno   → el de su plaza ese día (f_cobertura). Al que trabajó sin estar
//               en el cuadrante se le deduce por dónde cayeron sus horas.
//   · KM      → de la misma llamada, por uuid. Sin cruces por nombre.
//   · J       → la tabla `justificante` de PostgreSQL, la misma que la bitácora
//               y que el botón de justificar de Control. Antes se leía la hoja
//               JUSTIFICANTES, así que una J puesta desde la bitácora no salía
//               en el Excel.

const db = require('../db');
const TZ = 'Europe/Madrid';

const r1 = n => Math.round(n * 10) / 10;
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Fecha para una "clave de día" de Control: 0=Hoy, 1=Ayer, 2=Hace 2, 3=Hace 3. */
function fechaDeClave(key) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [Y, M, D] = s.split('-').map(Number);
  const f = new Date(Date.UTC(Y, M - 1, D - Number(key || 0), 12));
  const y = f.getUTCFullYear(), m = f.getUTCMonth() + 1, d = f.getUTCDate();
  const pad = n => String(n).padStart(2, '0');
  return { Y: y, M: m, D: d, str: `${pad(d)}/${pad(m)}/${y}`, iso: `${y}-${pad(m)}-${pad(d)}`,
    idx: (f.getUTCDay() + 6) % 7 };
}

/** Banda de color + observación automática para los NO justificados. */
function banda(h) {
  if (h == null) return { color: 'gris', obs: '' };
  if (h >= 9) return { color: 'verde', obs: 'Muy efectivo' };
  if (h >= 7.6) return { color: 'verde', obs: 'Efectivo' };
  if (h >= 6.4) return { color: 'amarillo', obs: 'Poco efectivo' };
  return { color: 'rojo', obs: 'No cumplieron' };
}

// ── El plan del día: quién debía salir, en qué turno, y quién libraba ────────
// f_cobertura es la ÚNICA definición de "ese día le tocaba" en todo el sistema
// (la misma que usan el planificador, la cobertura y la bitácora). Quien tiene
// plaza y no aparece en f_cobertura ese día es que libraba.
async function planDelDia(iso) {
  const r = await db.consulta(
    `WITH cubre AS (
       SELECT f.conductor_id, min(f.turno_id) AS turno_id,
              string_agg(DISTINCT v.matricula, ', ' ORDER BY v.matricula) AS matriculas
         FROM f_cobertura($1::date, $1::date) f
         JOIN vehiculo v ON v.id = f.vehiculo_id
        WHERE f.conductor_id IS NOT NULL
        GROUP BY f.conductor_id
     ),
     asignados AS (
       SELECT DISTINCT a.conductor_id
         FROM asignacion a
         JOIN plaza p ON p.id = a.plaza_id AND p.baja_at IS NULL
        WHERE a.conductor_id IS NOT NULL
          AND a.desde <= $1::date AND (a.hasta IS NULL OR a.hasta >= $1::date)
     )
     SELECT a.conductor_id,
            (c.conductor_id IS NOT NULL) AS debia_salir,
            t.etiqueta AS turno,
            c.matriculas AS matriculas_plan
       FROM asignados a
       LEFT JOIN cubre c ON c.conductor_id = a.conductor_id
       LEFT JOIN turno t ON t.id = c.turno_id`, [iso]);
  const m = new Map();
  r.rows.forEach(x => m.set(Number(x.conductor_id), {
    debiaSalir: !!x.debia_salir,
    libra: !x.debia_salir,
    turno: x.turno || '',
    matriculaPlan: x.matriculas_plan || '',
  }));
  return m;
}

// ── Quién es cada cuenta de BOLT, y quién es cada conductor nuestro ──────────
// El puente duro: conductor_externo.externo_id = el conductor_uuid del núcleo.
// Nada de nombres.
async function padron() {
  const r = await db.consulta(
    `SELECT c.id,
            COALESCE(NULLIF(btrim(ce.externo_nombre), ''),
                     btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)) AS nombre,
            tel.e164 AS telefono,
            ce.externo_id AS uuid,
            c.empleo_vigente
       FROM conductor c
       LEFT JOIN LATERAL (
         SELECT externo_id, externo_nombre FROM conductor_externo
          WHERE conductor_id = c.id AND sistema = 'bolt'
          ORDER BY (estado_externo = 'active') DESC, visto_at DESC NULLS LAST LIMIT 1) ce ON TRUE
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE NOT c.es_centinela`);
  const porId = new Map(), idDeUuid = new Map();
  r.rows.forEach(x => {
    porId.set(Number(x.id), { id: Number(x.id), nombre: x.nombre, telefono: x.telefono || '', vigente: x.empleo_vigente });
    if (x.uuid) idDeUuid.set(x.uuid, Number(x.id));
  });
  // TODAS las cuentas de BOLT enlazadas, no solo la principal: hay gente con
  // varias y sus horas viejas cuelgan de la cuenta antigua (ver el enlace de
  // cuentas hermanas). Si no se recogen aquí, esas horas se irían a "NN".
  const todas = await db.consulta(
    `SELECT externo_id, conductor_id FROM conductor_externo
      WHERE sistema = 'bolt' AND conductor_id IS NOT NULL`);
  todas.rows.forEach(x => idDeUuid.set(x.externo_id, Number(x.conductor_id)));
  return { porId, idDeUuid };
}

/**
 * El reporte de un día. `key`: 0=Hoy, 1=Ayer, 2=Hace 2, 3=Hace 3.
 */
async function reporteDia(key) {
  const { str: fecha, iso, idx } = fechaDeClave(key);
  const rutas = require('../flotaViva/rutas');
  const repoJust = require('./justificantes');
  await require('../flotaViva/db').preparar();

  const [act, plan, pad, justis] = await Promise.all([
    // LA JORNADA ENTERA (05→05), no la ventana del turno: es lo que mide
    // Visibilidad y es lo que la persona trabajó, empiece cuando empiece.
    rutas.actividadPorConductor(iso, 'operativo'),
    planDelDia(iso),
    padron(),
    repoJust.leerPorFecha(iso).catch(() => new Map()),
  ]);

  // Los justificantes vienen indexados por nombre; aquí hace falta por persona.
  const justPorId = new Map();
  for (const j of justis.values()) if (j.conductorId) justPorId.set(Number(j.conductorId), j);

  // ── 1. Todo el que TRABAJÓ (o al menos se conectó) ────────────────────────
  const filasPorId = new Map();   // conductor_id → fila
  const sueltos = [];             // los que ni ficha tienen: NN puros
  for (const a of act.porUuid.values()) {
    const horas = r1((a.minutos || 0) / 60);
    const cid = pad.idDeUuid.get(a.uuid);
    const p = cid ? pad.porId.get(cid) : null;
    const pl = cid ? plan.get(cid) : null;
    const fila = {
      conductorId: cid || null,
      nombre: (p && p.nombre) || a.nombre || `#${String(a.uuid).slice(0, 8)}`,
      telefono: (p && p.telefono) || a.telefono || '',
      // El turno del cuadrante manda. Al que trabajó sin estar planificado se
      // le pone el turno donde cayeron sus horas: decir "(sin turno)" de quien
      // hizo la noche entera no ayuda a nadie.
      turno: (pl && pl.turno) || turnoDeHecho(a),
      horas,
      libra: !!(pl && pl.libra),
      debiaSalir: !!(pl && pl.debiaSalir),
      // NN = trabajó sin que el cuadrante lo esperase. Es el que hay que mirar.
      esNN: !pl || !pl.debiaSalir,
      sinFicha: !cid,
      matricula: (a.matriculas && a.matriculas.length) ? a.matriculas.join(', ') : null,
      kmBolt: a.km, kmDesc: a.kmFuera,
      // Fichó en BOLT con un coche pero Mapon no midió nada: no se puede dar el
      // km por bueno. Lo cuadra Tráfico, que conoce el apaño del taller.
      revisar: !!(a.matriculas && a.matriculas.length) && !a.km && !a.kmFuera && (a.minutos || 0) > 0,
      just: cid ? justPorId.get(cid) : null,
    };
    if (fila.revisar) { fila.kmBolt = 'REVISAR'; fila.kmDesc = 'REVISAR'; }
    if (cid) filasPorId.set(cid, fila); else sueltos.push(fila);
  }

  // ── 2. Los que DEBÍAN salir y no aparecen en BOLT: 0 h ────────────────────
  for (const [cid, pl] of plan.entries()) {
    if (filasPorId.has(cid) || !pl.debiaSalir) continue;
    const p = pad.porId.get(cid);
    filasPorId.set(cid, {
      conductorId: cid, nombre: (p && p.nombre) || `#${cid}`, telefono: (p && p.telefono) || '',
      turno: pl.turno || '', horas: 0, libra: false, debiaSalir: true, esNN: false, sinFicha: false,
      matricula: pl.matriculaPlan || null, kmBolt: null, kmDesc: null, revisar: false,
      just: justPorId.get(cid) || null,
    });
  }

  // ── 3. Los justificados que no hayan entrado por las dos vías anteriores ──
  for (const [cid, j] of justPorId.entries()) {
    if (filasPorId.has(cid)) continue;
    const p = pad.porId.get(cid);
    const pl = plan.get(cid);
    filasPorId.set(cid, {
      conductorId: cid, nombre: (p && p.nombre) || j.nombre || `#${cid}`, telefono: (p && p.telefono) || '',
      turno: (pl && pl.turno) || '', horas: 0, libra: !!(pl && pl.libra), debiaSalir: !!(pl && pl.debiaSalir),
      esNN: !pl, sinFicha: false, matricula: null, kmBolt: null, kmDesc: null, revisar: false, just: j,
    });
  }

  // Quien libraba y no trabajó no sale en el reporte: no es una falta.
  const bruto = [...filasPorId.values(), ...sueltos]
    .filter(f => f.horas > 0 || f.debiaSalir || f.just);

  // No justificados primero (mayor→menor); justificados al final.
  const cmp = (a, b) => (b.horas ?? -1) - (a.horas ?? -1) || a.nombre.localeCompare(b.nombre, 'es');
  const orden = bruto.filter(f => !f.just).sort(cmp).concat(bruto.filter(f => f.just).sort(cmp));

  const filas = orden.map((f, i) => {
    const comun = {
      nro: i + 1, nombre: f.nombre, telefono: f.telefono, turno: f.turno, horas: f.horas,
      libra: f.libra, debiaSalir: f.debiaSalir, esNN: f.esNN, sinFicha: f.sinFicha,
      matricula: f.matricula, kmBolt: f.kmBolt, kmDesc: f.kmDesc, revisar: f.revisar,
    };
    if (f.just) {
      const horasTexto = (f.horas != null && f.horas > 0) ? `${r1(f.horas)} (J)` : 'J';
      return { ...comun, horasTexto, color: 'azul', observacion: f.just.observacion || '', esJ: true };
    }
    const b = banda(f.horas);
    // El aviso va con la observación automática: el que salió sin estar en el
    // cuadrante es justo el que hay que mirar, y antes no se distinguía.
    const nota = f.sinFicha ? 'Solo en BOLT · sin ficha'
      : f.esNN && f.horas > 0 ? 'Fuera del cuadrante'
      : '';
    return {
      ...comun,
      horasTexto: (f.horas != null ? String(r1(f.horas)) : ''),
      color: b.color,
      observacion: [b.obs, nota].filter(Boolean).join(' · '),
      esJ: false,
    };
  });

  return {
    fecha, diaSemana: DIAS[idx], dia: Number(key), iso,
    filas, resumen: resumirFilas(filas),
  };
}

/**
 * El turno de quien trabajó sin estar en el cuadrante: donde cayó la mayor
 * parte de sus horas. La ventana de día es 05→17 en Madrid.
 */
function turnoDeHecho(a) {
  if (!a.primera) return '';
  const h = Number(new Intl.DateTimeFormat('en-GB',
    { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(a.primera)));
  return (h >= 5 && h < 17) ? 'Día' : 'Noche';
}

// ── Resumen del día ─────────────────────────────────────────────────────────
// Se calcula SOBRE LAS FILAS QUE SE IMPRIMEN, para que quien lea el Excel pueda
// sumar a mano y le cuadre.
function resumirFilas(filas) {
  const hizo = f => (f.horas ?? 0) > 0;
  const porTurno = {};
  filas.forEach(f => {
    const t = (f.turno || '').trim() || '(sin turno)';
    porTurno[t] = r1((porTurno[t] || 0) + (f.horas ?? 0));
  });
  return {
    salieron: filas.filter(hizo).length,
    // Se les esperaba y no aparecieron. La libranza no cuenta como falta.
    noSalieron: filas.filter(f => !hizo(f) && !f.libra).length,
    cumplieron8: filas.filter(f => (f.horas ?? 0) >= 8).length,
    menos4: filas.filter(f => hizo(f) && f.horas < 4).length,
    justificados: filas.filter(f => f.esJ).length,
    // Los que salieron sin estar en el cuadrante: el número que antes no existía.
    fueraDelPlan: filas.filter(f => f.esNN && hizo(f)).length,
    horasFueraDelPlan: r1(filas.filter(f => f.esNN && hizo(f)).reduce((s, f) => s + (f.horas ?? 0), 0)),
    horasDia: porTurno['Día'] || 0,
    horasNoche: porTurno['Noche'] || 0,
    horasTodoTurno: porTurno['TodoTurno'] || 0,
    horasSinTurno: porTurno['(sin turno)'] || 0,
    horasTotal: r1(filas.reduce((s, f) => s + (f.horas ?? 0), 0)),
    personas: filas.length,
  };
}

module.exports = { reporteDia, resumirFilas, banda, fechaDeClave, planDelDia };
