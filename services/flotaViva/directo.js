// ============================================================
// EN DIRECTO — la fusión: plan del Cuadrante × realidad viva
// ============================================================
// El cockpit de tráfico. Junta tres cosas que hasta ahora vivían separadas:
//
//   PLAN      quién DEBÍA ir hoy en cada coche, turno de día y de noche.
//             Sale del Cuadrante (planificador V2, Postgres) vía `tablero()`.
//   REALIDAD  quién está conectado AHORA, en qué (viaje/espera/descanso), cuánto
//             lleva y cuántos km. Sale de Flota Viva (`fv_ahora`).
//   ALERTAS   lo que hay que llamar: las incidencias abiertas del coche, con sus
//             botones (Justificar / He llamado) y el teléfono.
//
// NO SE HACE JOIN EN SQL entre los dos mundos. El Cuadrante vive en la base
// principal y Flota Viva puede vivir en otra (FLOTA_VIVA_DB_URL). Se piden por
// separado —cada uno a su pool— y se cruzan aquí en JS por matrícula normalizada,
// que es lo único que comparten. Así funciona apunten donde apunten las dos.

const panel = require('./panel');
const { normMat } = require('./fuentes');

const TZ = 'Europe/Madrid';

// LA JORNADA OPERATIVA de ahora mismo ('YYYY-MM-DD'): va de 05:00 a 05:00, así
// que de madrugada (00:00–05:00) seguimos en la de AYER, porque la noche que
// está rodando empezó la víspera. Es la MISMA regla que usan el telefonito y la
// J (repo/llamadas), y tiene que serlo: antes esto era la fecha de calendario y
// entre las 00:00 y las 05:00 el cockpit enseñaba el plan del día siguiente —la
// noche en curso no salía en ninguna pestaña, NN vacío, 0 personas— mientras
// las llamadas y las J se grababan en la jornada anterior. Cinco horas cada
// noche sin ver a quien estaba trabajando.
const { diaOperativoHoy } = require('../repo/llamadas');

/** El día anterior a una fecha 'YYYY-MM-DD'. */
function ayerDe(iso) {
  const [Y, M, D] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D - 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Índice del día en la semana del Cuadrante: 0=Lunes … 6=Domingo. */
function idxDiaSemana(iso) {
  const [Y, M, D] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D, 12));
  return (d.getUTCDay() + 6) % 7;
}

/** El nombre de una celda de cobertura (semana[]) o '' si no hay nadie. */
function nombreCelda(celda) {
  return celda && celda.nombre ? String(celda.nombre) : '';
}

/**
 * Normaliza un nombre para cruzar el plan (agenda) con quien trabajó (BOLT): en
 * minúsculas, sin acentos y con los tokens ordenados, así "Juan Perez Gomez" y
 * "Gomez, Juan Pérez" caen en la misma clave. Es la misma idea que normClave, pero
 * local para no acoplar Flota Viva a services/conductores.
 */
function normNombre(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

/**
 * El estado de un coche de un vistazo. Es lo que pinta el chip.
 *
 * Precedencia pensada para tráfico: primero lo que exige acción (una alerta
 * abierta manda sobre todo lo demás), luego lo que está roto (fuera de servicio),
 * luego lo que rueda, y al final lo que debía salir y no aparece.
 */
function calcEstado({ plan, vivo, nIncidencias, operativo }) {
  const debia = !!(plan.dia || plan.noche);
  if (nIncidencias > 0) {
    return { codigo: 'alerta', etiqueta: nIncidencias + (nIncidencias > 1 ? ' avisos' : ' aviso'), tono: 'error' };
  }
  if (!operativo) return { codigo: 'fuera', etiqueta: 'Fuera de servicio', tono: 'muted' };
  if (vivo && vivo.conectado) {
    if (vivo.situacion === 'descanso') {
      return vivo.km
        ? { codigo: 'descanso_rodando', etiqueta: 'En descanso · rodando', tono: 'aviso' }
        : { codigo: 'descanso', etiqueta: 'En descanso', tono: 'ok' };
    }
    return { codigo: 'trabajando', etiqueta: vivo.etiqueta || 'Conectado', tono: 'ok' };
  }
  if (debia) return { codigo: 'sin_conexion', etiqueta: 'Debía salir · sin conexión', tono: 'aviso' };
  if (vivo) return { codigo: 'desconectado', etiqueta: 'Desconectado', tono: 'muted' };
  return { codigo: 'idle', etiqueta: '—', tono: 'muted' };
}


/**
 * ¿HA SALIDO? Es LA pregunta del cockpit: a quién hay que llamar.
 *
 *   pendiente  su turno todavía no ha empezado (la noche, a las 09:00). No es lo
 *              mismo que "no ha salido": es que aún no le toca.
 *   conectado  está rodando ahora mismo.
 *   salio      trabajó dentro de SU ventana, aunque ahora esté parado.
 *   no_salio   la ventana corre y de esta persona no hay ni rastro. A llamar.
 *
 * Trabajar es viaje o espera. Los km rodados ESTANDO DESCONECTADO no cuentan:
 * son el coche moviéndose sin que la persona esté disponible en BOLT, casi
 * siempre porque el relevo ya se lo llevó. Contarlos era lo que ponía "Salió"
 * a quien había terminado su noche a las 03:51 — sus sobras cruzaban el corte
 * de las 05:00 y se le imputaban al turno de día.
 */
const UMBRAL_SALIDA_MIN = Number(process.env.CONTROL_UMBRAL_SALIDA_MIN || 0);
function salidaDe(a, vent) {
  if (!vent || !vent.empezada) return 'pendiente';
  if (!a) return 'no_salio';
  // El DESCANSO ('busy' en BOLT) es estar con el coche y la app abierta pero NO
  // trabajando. Salió —el coche está con él— pero no es lo mismo que estar rodando,
  // así que se dice aparte y no se pinta de verde. Sus minutos nunca cuentan.
  if (a.conectadoAhora && a.situacionAhora === 'descanso') return 'descanso';
  if (a.conectadoAhora) return 'conectado';
  if (a.minutos > UMBRAL_SALIDA_MIN || a.km > 0) return 'salio';
  return 'no_salio';
}

/**
 * El cockpit entero.
 *
 * Una fila por coche que importe AHORA: los que estaban planificados hoy, los que
 * están conectados aunque no tocara, y los que tienen una alerta abierta. Cada
 * fila trae su plan, su realidad y sus alertas ya cruzados.
 */
async function enDirecto({ dia } = {}) {
  const hoy = (dia && String(dia).slice(0, 10)) || diaOperativoHoy();
  const ayer = ayerDe(hoy);
  const idx = idxDiaSemana(hoy);

  // Las tablas fv_* tienen que existir antes de consultarlas. Es idempotente y
  // se cachea: solo hace algo la primera vez tras arrancar.
  await require('./db').preparar().catch(() => {});

  // Cada fuente a su pool. Si Flota Viva se cae, el plan se ve igual (y al revés).
  const plani = require('../repo/planificador');   // base principal (Cuadrante)
  const rutas = require('./rutas');
  const [tab, est, incHoy, incAyer, kmHoy, contac, actDia, actNoche, actOper] = await Promise.all([
    plani.tablero({ dia: hoy }).catch(e => { console.error('❌ [EN DIRECTO] Cuadrante:', e.message); return null; }),
    panel.estado().catch(e => { console.error('❌ [EN DIRECTO] Flota viva:', e.message); return null; }),
    // Las incidencias abiertas de hoy y de ayer: la franja de noche empieza hoy y
    // termina de madrugada con el día operativo de ayer, así que a las 02:00 lo
    // que sigue vivo es "de ayer". Se juntan las dos y se quitan duplicados.
    panel.incidencias({ dia: hoy }).catch(() => []),
    panel.incidencias({ dia: ayer }).catch(() => []),
    // Los km de hoy salen del NÚCLEO (fv_ruta, route/list), no del `mileage`
    // estancado. Si aún no se ha ingerido, sale vacío y el coche muestra 0.
    rutas.kmPorCoche(hoy).catch(() => new Map()),
    // EL TELÉFONO, del padrón. Tiene que salir SIEMPRE al lado del nombre: la pantalla
    // existe para llamar. Y no puede venir del trazo vivo, porque justo al que hay que
    // llamar —el que no ha salido— no le queda ni un tramo del que sacarlo.
    plani.contactos().catch(() => new Map()),
    // LA ACTIVIDAD DE CADA PERSONA, EN LA VENTANA DE SU TURNO. Una consulta por
    // turno, no una sola del día operativo: el de noche que terminó a las 03:51 y
    // dejó el coche rodando hasta las 07:50 aparecía como que había salido de DÍA,
    // porque sus sobras cruzaban el corte de las 05:00. Y la del día operativo
    // entero (05→05) es la que sirve para los NN, que no tienen turno asignado.
    rutas.actividadPorConductor(hoy, 'dia').catch(e => { console.error('❌ [EN DIRECTO] actividad día:', e.message); return null; }),
    rutas.actividadPorConductor(hoy, 'noche').catch(e => { console.error('❌ [EN DIRECTO] actividad noche:', e.message); return null; }),
    rutas.actividadPorConductor(hoy, 'operativo').catch(e => { console.error('❌ [EN DIRECTO] actividad jornada:', e.message); return null; }),
  ]);

  // ── Realidad viva: matrícula normalizada → su fila de fv_ahora ──────────────
  const vivos = new Map();
  if (est) {
    [].concat(est.conectados || [], est.recienCaidos || [], est.parados || [])
      .forEach(v => { if (v.matricula) vivos.set(normMat(v.matricula), v); });
  }

  // ── Alertas abiertas, por COCHE y por PERSONA ────────────────────────────────
  const porInc = new Map();
  const porIncCond = new Map();     // uuid de BOLT → [incidencias que provocó]
  const vistas = new Set();
  [].concat(incAyer || [], incHoy || []).forEach(i => {
    if (vistas.has(i.id)) return;      // hoy pisa a ayer si por lo que sea saliera en las dos
    vistas.add(i.id);
    const k = normMat(i.matricula);
    if (!porInc.has(k)) porInc.set(k, []);
    porInc.get(k).push(i);
    // Y por quien lo provocó. La incidencia guarda el conductor_uuid del que iba
    // al volante, así que el aviso viaja CON LA PERSONA: si hoy se han cambiado el
    // coche —pasa a diario— el aviso sigue siendo suyo y no se queda colgado en la
    // plaza del cuadrante, donde lo veía quien no tuvo nada que ver.
    if (i.conductorUuid) {
      if (!porIncCond.has(i.conductorUuid)) porIncCond.set(i.conductorUuid, []);
      porIncCond.get(i.conductorUuid).push(i);
    }
  });

  // ── El plan: una fila por coche del Cuadrante ───────────────────────────────
  const filas = [];
  const usadas = new Set();
  const coches = (tab && tab.coches) || [];

  // El cuadrante se etiqueta como en el planificador: por su POSICIÓN VIVA (1..N,
  // sin huecos), no por el nombre congelado en la BD (`v_plaza.cuadrante`), que se
  // desincroniza al borrar cuadrantes ("CUADRANTE 12" cuando ya es el 11). Se mapea
  // por cuadranteId contra `tab.cuadrantes` (la misma fuente que numera el plan).
  const etiquetaCuad = new Map();
  ((tab && tab.cuadrantes) || []).forEach(cu =>
    etiquetaCuad.set(String(cu.id), cu.nombre + (cu.zona ? ' · ' + cu.zona : '')));
  const cuadDe = c => etiquetaCuad.get(String(c.cuadranteId)) || c.cuadrante || '';

  coches.forEach(c => {
    const k = normMat(c.matricula);
    usadas.add(k);
    const plan = {
      dia: nombreCelda(c.semana && c.semana[idx * 2]),
      noche: nombreCelda(c.semana && c.semana[idx * 2 + 1]),
    };
    const vivo = vivos.get(k) || null;
    const incidencias = porInc.get(k) || [];
    const kmc = kmHoy.get(k) || {};
    filas.push({
      matricula: c.matricula, matriculaNorm: k,
      zona: c.zona || '', cuadrante: cuadDe(c),
      estadoVeh: c.estadoVeh || '', operativo: c.operativo !== false,
      plan, vivo, incidencias,
      km: kmc.km || 0, viajes: kmc.viajes || 0,
      enPlan: true,
      estado: calcEstado({ plan, vivo, nIncidencias: incidencias.length, operativo: c.operativo !== false }),
    });
  });

  // ── Los que ruedan (o avisan) sin estar en el plan de hoy ───────────────────
  // Un coche conectado que hoy no tocaba, o con una alerta y sin plaza en el
  // Cuadrante. Tráfico tiene que verlos igual: son justo los que se escapan.
  const extra = new Set();
  vivos.forEach((v, k) => { if (!usadas.has(k) && v.conectado) extra.add(k); });
  porInc.forEach((_, k) => { if (!usadas.has(k)) extra.add(k); });
  extra.forEach(k => {
    const vivo = vivos.get(k) || null;
    const incidencias = porInc.get(k) || [];
    const kmc = kmHoy.get(k) || {};
    const plan = { dia: '', noche: '' };
    filas.push({
      matricula: (vivo && vivo.matricula) || (incidencias[0] && incidencias[0].matricula) || k,
      matriculaNorm: k,
      zona: '', cuadrante: '', estadoVeh: '', operativo: true,
      plan, vivo, incidencias,
      km: kmc.km || 0, viajes: kmc.viajes || 0,
      enPlan: false,
      estado: calcEstado({ plan, vivo, nIncidencias: incidencias.length, operativo: true }),
    });
  });

  // Orden: primero lo que pide acción (alertas), luego descanso rodando, luego el
  // resto; dentro de cada grupo, por matrícula.
  const peso = { alerta: 0, descanso_rodando: 1, sin_conexion: 2, descanso: 3, trabajando: 4, desconectado: 5, fuera: 6, idle: 7 };
  filas.sort((a, b) =>
    (peso[a.estado.codigo] ?? 9) - (peso[b.estado.codigo] ?? 9) ||
    a.matricula.localeCompare(b.matricula));

  // ── EL ENLACE PLAN ↔ TRAZO: por IDENTIFICADOR, no por nombre ────────────────
  // conductor_externo.externo_id ES el uuid del conductor en BOLT, el mismo que
  // guarda fv_tramo.conductor_uuid. Cruzar por ahí es exacto y no se rompe porque
  // el nombre de la plantilla y el de BOLT difieran ("Tukieth" vs "Yulieth"). El
  // nombre normalizado se deja de red, por si alguna cuenta vieja no trae el id.
  // Una persona puede tener VARIAS cuentas de BOLT (recontrataciones, altas
  // duplicadas): se guardan todas, la activa primero. Antes se quedaba con una
  // sola —la última del SELECT— y a 11 personas les tocaba justo la que no tenía
  // actividad: el cockpit decía "No ha salido" a quien estaba rodando con la otra.
  const uuidsDeId = new Map();         // conductor_id (plan) → [uuid de BOLT, …]
  const idDeUuid = new Map();          // uuid de BOLT        → conductor_id (plan)
  try {
    const rid = await require('../db').consulta(
      `SELECT conductor_id, externo_id
         FROM conductor_externo
        WHERE sistema = 'bolt' AND conductor_id IS NOT NULL AND externo_id IS NOT NULL
        ORDER BY conductor_id, (estado_externo = 'active') DESC, visto_at DESC NULLS LAST`);
    rid.rows.forEach(x => {
      const cid = Number(x.conductor_id);
      if (!uuidsDeId.has(cid)) uuidsDeId.set(cid, []);
      uuidsDeId.get(cid).push(String(x.externo_id));
      idDeUuid.set(String(x.externo_id), cid);
    });
  } catch (e) { console.error('⚠️  [EN DIRECTO] mapa BOLT→conductor:', e.message); }

  /** Una sola actividad a partir de las de varias cuentas de la misma persona. */
  function fundirActividad(lista) {
    if (lista.length === 1) return lista[0];
    const f = { ...lista[0], matriculas: [...(lista[0].matriculas || [])] };
    for (const a of lista.slice(1)) {
      f.minutos += a.minutos || 0;
      f.minDescanso += a.minDescanso || 0;
      f.minDesconectado += a.minDesconectado || 0;
      f.km = Math.round((f.km + (a.km || 0)) * 10) / 10;
      f.kmFuera = Math.round((f.kmFuera + (a.kmFuera || 0)) * 10) / 10;
      if (a.primera && (!f.primera || a.primera < f.primera)) f.primera = a.primera;
      if (a.ultima && (!f.ultima || a.ultima > f.ultima)) f.ultima = a.ultima;
      // La cuenta que está conectada AHORA es la que manda (y la que se traza).
      if (a.conectadoAhora) { f.conectadoAhora = true; f.situacionAhora = a.situacionAhora; f.uuid = a.uuid; }
      (a.matriculas || []).forEach(m => { if (!f.matriculas.includes(m)) f.matriculas.push(m); });
      if (!f.nombre) f.nombre = a.nombre;
      if (!f.telefono) f.telefono = a.telefono;
    }
    f.matricula = f.matriculas[0] || null;
    return f;
  }

  /** La actividad de una persona del plan dentro de una ventana ya calculada. */
  function actividadDe(vent, conductorId, nombre) {
    if (!vent) return null;
    const con = (uuidsDeId.get(Number(conductorId)) || [])
      .filter(u => vent.porUuid.has(u)).map(u => vent.porUuid.get(u));
    if (con.length) return fundirActividad(con);
    const clave = normNombre(nombre);
    if (!clave) return null;
    for (const a of vent.porUuid.values()) if (normNombre(a.nombre) === clave) return a;
    return null;
  }

  /** La actividad, con los nombres que espera la pantalla. */
  function paraPintar(a) {
    if (!a) return null;
    return {
      minutos: a.minutos, km: a.km, kmFuera: a.kmFuera,
      minDescanso: a.minDescanso, minDesconectado: a.minDesconectado,
      conectado: a.conectadoAhora, situacion: a.situacionAhora,
      primera: a.primera, ultima: a.ultima,
      matriculas: a.matriculas || [], uuid: a.uuid,
    };
  }

  // ── SALIERON FUERA DEL PLAN (NN) ────────────────────────────────────────────
  // TODO el que ha salido hoy —o rueda ahora— sin estar PINTADO en las pestañas
  // del plan (las celdas del cuadrante de hoy). Sin importar qué: de vacaciones,
  // de baja, en el banquillo o ni siquiera en la plataforma — si BOLT lo vio
  // rodar, aquí sale con su nombre de BOLT y su porqué. Antes se excluía a toda
  // la PLANTILLA (tab.conductores) y el de vacaciones que sí trabajó no salía
  // en NINGUNA pestaña: invisible. Se mira la jornada operativa entera (05→05)
  // porque un NN no tiene turno que mirar.
  const idsPlan = new Set();
  const meter = v => { const n = Number(v); if (n) idsPlan.add(n); };
  const nombresPlan = new Set();
  const anota = n => { const k = normNombre(n); if (k) nombresPlan.add(k); };
  // SOLO las celdas de HOY, más la NOCHE DE AYER (remata pasadas las 05:00 y
  // caería en NN sin ser nadie fuera del plan). Antes se recorría la semana
  // entera, y quien libraba hoy pero estaba pintado otro día —y salía a hacer
  // un doble— no aparecía en Día, ni en Noche, ni en NN: invisible.
  const celdasPlan = co => {
    const s = co.semana || [];
    const cs = [s[idx * 2], s[idx * 2 + 1]];
    // idx 0 = lunes: la noche de ayer es de la semana anterior, que el tablero de
    // hoy no trae. Se acepta ese ruido una madrugada a la semana.
    if (idx > 0) cs.push(s[(idx - 1) * 2 + 1]);
    return cs.filter(Boolean);
  };
  ((tab && tab.coches) || []).forEach(co => {
    celdasPlan(co).forEach(cell => {
      meter(cell.id); anota(cell.nombre);
      // En una celda con conflicto (dos personas en el mismo coche, turno y día)
      // tablero() solo guarda el NOMBRE de los demás: que no caigan en NN.
      (cell.otros || []).forEach(anota);
    });
  });

  // El promedio de horas del mes y su letra, para que quien llama sepa a quién
  // tiene al otro lado. Sale del mismo sitio que en el planificador.
  const rend = await require('../repo/rendimiento').leer().catch(() => new Map());

  // El porqué de cada uno: su situación en la plataforma (o que no está en ella).
  const gentePorId = new Map((((tab && tab.conductores) || [])).map(c => [Number(c.id), c]));
  const gentePorNombre = new Map((((tab && tab.conductores) || [])).map(c => [normNombre(c.nombre), c]));
  const situacionDe = uuid => {
    const cid = idDeUuid.get(uuid);
    if (!cid) return { codigo: 'sin_ficha', etiqueta: 'Solo en BOLT · sin ficha' };
    const ficha = gentePorId.get(cid);
    if (!ficha) return { codigo: 'baja_empresa', etiqueta: 'De baja en la empresa' };
    if (ficha.ausente) return { codigo: 'ausente', etiqueta: ficha.estado || 'Ausente' };
    return { codigo: 'sin_plaza', etiqueta: 'En plantilla · sin plaza hoy' };
  };

  const sinPlan = [...((actOper && actOper.porUuid) || new Map()).values()]
    .filter(a => !idsPlan.has(idDeUuid.get(a.uuid)))
    .filter(a => !nombresPlan.has(normNombre(a.nombre)))
    .filter(a => a.minutos > 0 || a.km > 0 || a.conectadoAhora)
    .map(a => ({
      conductor: a.nombre || ('#' + String(a.uuid).slice(0, 8)),
      telefono: a.telefono || '',
      conductorId: idDeUuid.get(a.uuid) || '',
      rendimiento: rend.get(idDeUuid.get(a.uuid)) || null,
      situacion: situacionDe(a.uuid),
      matricula: a.matricula, matriculas: a.matriculas,
      enBolt: a.km, desconectado: a.kmFuera,
      total: Math.round((a.km + a.kmFuera) * 10) / 10,
      minutos: a.minutos, conectadoAhora: a.conectadoAhora,
      primera: a.primera || null,
      // Sus avisos: los provocó él, aunque no esté en el plan. Antes se contaban
      // en la cabecera y no se podían ver en ninguna pestaña.
      incidencias: porIncCond.get(a.uuid) || [],
    }))
    .sort((a, b) => Number(b.conectadoAhora) - Number(a.conectadoAhora) || b.total - a.total);

  // Cuánta gente se ha conectado HOY a la plataforma (jornada 05→05), sea del
  // plan o no: el número que responde "¿cuántos han salido?" sin letra pequeña.
  // PERSONAS, no cuentas: dos cuentas de BOLT del mismo conductor son una.
  const personasSalieron = new Set([...((actOper && actOper.porUuid) || new Map()).values()]
    .filter(a => a.minutos > 0)
    .map(a => idDeUuid.get(a.uuid) || a.uuid)).size;

  const resumen = {
    coches: filas.length,
    enPlan: filas.filter(f => f.enPlan).length,
    conectados: filas.filter(f => f.vivo && f.vivo.conectado).length,
    enDescanso: filas.filter(f => f.estado.codigo === 'descanso' || f.estado.codigo === 'descanso_rodando').length,
    sinConexion: filas.filter(f => f.estado.codigo === 'sin_conexion').length,
    alertas: filas.reduce((s, f) => s + f.incidencias.length, 0),
    fueraDePlan: filas.filter(f => !f.enPlan).length,
    // Km de toda la flota hoy, del núcleo. Es el número que hoy salía en 0.
    kmHoy: Math.round(filas.reduce((s, f) => s + (f.km || 0), 0) * 10) / 10,
    // Conductores que trabajaron sin estar en el plan.
    sinPlan: sinPlan.length,
    // Personas distintas que se conectaron hoy (plan + fuera del plan).
    personasSalieron,
  };

  // ── POR TURNO, POR CONDUCTOR (pestañas Día / Noche / TodoTurno / NN) ─────────
  // Cada fila es una PERSONA del cuadrante de hoy (la celda día/noche del tablero,
  // que trae conductor_id + nombre), con su trazo VIVO medido en LA VENTANA DE SU
  // TURNO: el de día contra 05→17, el de noche contra 17→05. Antes los dos se
  // medían contra el día operativo entero y se pisaban el uno al otro.
  const ventanaDe = { dia: actDia, noche: actNoche, todoturno: actOper };
  const crudo = { dia: [], noche: [], todoturno: [] };
  coches.forEach(c => {
    const rolDe = new Map();
    (c.personas || []).forEach(p => { if (p && p.id) rolDe.set(String(p.id), p.rol || ''); });
    const cd = (c.semana && c.semana[idx * 2]) || {};       // quién cubre DÍA hoy
    const cn = (c.semana && c.semana[idx * 2 + 1]) || {};    // quién cubre NOCHE hoy
    const add = (cell, turno) => {
      if (!cell.id && !cell.nombre) return;                  // sin cubrir hoy → nadie
      const act = actividadDe(ventanaDe[turno], cell.id, cell.nombre);
      crudo[turno].push({
        conductorId: cell.id || '', conductor: cell.nombre || '', turno,
        telefono: (contac.get(String(cell.id)) || {}).telefono || (act && act.telefono) || '',
        uuid: (act && act.uuid) || (uuidsDeId.get(Number(cell.id)) || [])[0] || '',
        uuids: uuidsDeId.get(Number(cell.id)) || [],
        rol: rolDe.get(String(cell.id)) || '',
        matricula: c.matricula, cuadrante: cuadDe(c),
        actividad: act,
        incidencias: porInc.get(normMat(c.matricula)) || [],
        conflicto: !!cell.conflicto,
      });
      // Los DEMÁS de una celda en conflicto también son del plan: tienen su fila
      // (tablero() solo guarda su nombre; se busca su id en la plantilla) para
      // que se vean y se les llame. Antes la segunda persona del solape no
      // existía para el cockpit, y si salía caía en NN "sin plaza".
      (cell.otros || []).forEach(nombre => {
        const g = gentePorNombre.get(normNombre(nombre));
        add({ id: g ? g.id : '', nombre, conflicto: true }, turno);
      });
    };
    add(cd, 'dia'); add(cn, 'noche');
    // TODOTURNO = quien hoy cubre el día Y la noche del mismo coche: está doblando.
    // Esta pestaña llevaba siempre 0/0 porque nadie la rellenaba nunca. Se mide
    // contra la jornada entera (05→05), que es lo que de verdad va a hacer.
    const mismoId = cd.id && cn.id && String(cd.id) === String(cn.id);
    if (mismoId) {
      const act = actividadDe(actOper, cd.id, cd.nombre);
      crudo.todoturno.push({
        conductorId: cd.id, conductor: cd.nombre || '', turno: 'todoturno',
        telefono: (contac.get(String(cd.id)) || {}).telefono || (act && act.telefono) || '',
        uuid: (act && act.uuid) || (uuidsDeId.get(Number(cd.id)) || [])[0] || '',
        uuids: uuidsDeId.get(Number(cd.id)) || [],
        rol: rolDe.get(String(cd.id)) || '',
        matricula: c.matricula, cuadrante: cuadDe(c),
        actividad: act,
        incidencias: porInc.get(normMat(c.matricula)) || [],
      });
    }
  });
  const agrupaConductor = (plazas, vent) => {
    const m = new Map();
    plazas.forEach(p => {
      const clave = p.conductorId ? ('id:' + p.conductorId) : ('n:' + normNombre(p.conductor));
      if (!m.has(clave)) m.set(clave, { clave, conductorId: p.conductorId, conductor: p.conductor,
        uuid: p.uuid, uuids: p.uuids || [], telefono: p.telefono, turno: p.turno, roles: new Set(), matriculas: [], cuadrantes: new Set(),
        actividad: p.actividad, incidencias: [], conflicto: !!p.conflicto });
      const f = m.get(clave);
      if (p.conflicto) f.conflicto = true;
      if (p.rol) f.roles.add(p.rol);
      if (p.uuid && !f.uuid) f.uuid = p.uuid;
      if (p.telefono && !f.telefono) f.telefono = p.telefono;
      if (p.matricula && !f.matriculas.includes(p.matricula)) f.matriculas.push(p.matricula);
      if (p.cuadrante) f.cuadrantes.add(p.cuadrante);
      if (!f.actividad && p.actividad) f.actividad = p.actividad;
      (p.incidencias || []).forEach(i => { if (!f.incidencias.some(x => x.id === i.id)) f.incidencias.push(i); });
    });
    return [...m.values()].map(f => {
      // El coche a trazar: el que de verdad rodó (actividad), o el primero asignado.
      const trazoMat = (f.actividad && (f.actividad.matriculas || [])[0]) || f.matriculas[0] || '';
      // LOS AVISOS SON DE QUIEN LOS PROVOCÓ, no de la plaza del cuadrante. Se le
      // dan los suyos —los haya hecho en el coche que sea, que se cambian a diario—
      // más los del coche que tenía asignado que no tienen dueño (nadie conectado
      // en ese momento): esos no hay a quién dárselos y se quedan a la vista.
      // …de CUALQUIERA de sus cuentas de BOLT.
      const suyos = [];
      new Set([f.uuid, ...(f.uuids || [])].filter(Boolean)).forEach(u =>
        (porIncCond.get(u) || []).forEach(i => { if (!suyos.some(x => x.id === i.id)) suyos.push(i); }));
      const huerfanos = f.incidencias.filter(i => !i.conductorUuid);
      const mios = suyos.concat(huerfanos.filter(h => !suyos.some(x => x.id === h.id)));
      // Un coche distinto al planificado no es un error, pero tráfico quiere verlo.
      const vivas = (f.actividad && f.actividad.matriculas) || [];
      const cocheCambiado = vivas.length > 0 && !vivas.some(m => f.matriculas.includes(m));
      return {
        clave: f.clave, conductorId: f.conductorId, conductor: f.conductor, uuid: f.uuid, telefono: f.telefono || '',
        rendimiento: rend.get(Number(f.conductorId)) || null,
        turno: f.turno,
        rol: f.roles.has('FIJO') ? 'FIJO' : (f.roles.has('CT') ? 'CT' : ''),
        matriculas: f.matriculas, trazoMat, matriculaNorm: trazoMat ? normMat(trazoMat) : '',
        cuadrante: [...f.cuadrantes][0] || '', cuadrantes: [...f.cuadrantes],
        actividad: paraPintar(f.actividad),
        salida: salidaDe(f.actividad, vent),
        incidencias: mios,
        avisosDelCoche: f.incidencias.length,
        cocheCambiado,
        conflicto: f.conflicto,
      };
    });
  };
  const porTurno = {
    dia: agrupaConductor(crudo.dia, actDia),
    noche: agrupaConductor(crudo.noche, actNoche),
    todoturno: agrupaConductor(crudo.todoturno, actOper),
    nn: sinPlan,
  };
  const PESO_SALIDA = { no_salio: 0, pendiente: 1, descanso: 2, conectado: 3, salio: 4 };
  const ordena = arr => arr.sort((a, b) =>
    (a.cuadrante || '').localeCompare(b.cuadrante || '', undefined, { numeric: true }) ||
    ((PESO_SALIDA[a.salida] ?? 9) - (PESO_SALIDA[b.salida] ?? 9)) ||   // los que faltan, primero
    (a.conductor || '').localeCompare(b.conductor || ''));
  ordena(porTurno.dia); ordena(porTurno.noche); ordena(porTurno.todoturno);

  // La cabecera decía "3 avisos" y no había forma de llegar a ellos: los de un
  // coche sin plaza o de alguien fuera del plan no caían en ninguna fila. Ahora
  // los NN llevan los suyos, y lo que aun así no tiene dueño se dice aparte.
  const atribuidos = new Set();
  ['dia', 'noche', 'todoturno', 'nn'].forEach(t =>
    (porTurno[t] || []).forEach(f => (f.incidencias || []).forEach(i => atribuidos.add(i.id))));
  resumen.alertas = vistas.size;
  resumen.alertasSinDueno = [...vistas].filter(id => !atribuidos.has(id)).length;

  return {
    dia: hoy,
    fecha: hoy.split('-').reverse().join('/'),
    hayCuadrante: !!tab,
    hayFlotaViva: !!est,
    // Si el núcleo no responde, salidaDe() devuelve 'pendiente' para todos y la
    // pantalla pintaba "0 por llamar" en verde, sin aviso. Ahora lo sabe.
    hayActividad: !!(actDia && actNoche && actOper),
    ultimaVuelta: est ? est.ultimaVuelta : null,
    resumen,
    coches: filas,
    sinPlan,
    porTurno,
    // La ventana de cada turno, para que la pantalla sepa si ya ha empezado. Un
    // turno que no ha arrancado no tiene a nadie "sin salir": no le toca a nadie.
    ventanas: {
      dia:   actDia   ? { ini: actDia.ini,   fin: actDia.finPlan,   empezada: actDia.empezada,   terminada: actDia.terminada }   : null,
      noche: actNoche ? { ini: actNoche.ini, fin: actNoche.finPlan, empezada: actNoche.empezada, terminada: actNoche.terminada } : null,
    },
  };
}

module.exports = { enDirecto, salidaDe };
