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
//   · Horas   → desde el 06/10/2026, POR EL TURNO DE CADA UNO
//               (repartoTurnos.js): su turno de día de ese día (00:00 → 24:00)
//               más su turno de noche (12:00 → 12:00 del día siguiente); los NN
//               por su hora de inicio. Viaje + espera, cada segundo una vez. Es
//               la misma regla que Control, Visibilidad y la Bitácora. Antes era
//               la jornada 05→05 entera.
//   · Quién   → todo el que trabajó (aunque no estuviera planificado y aunque
//               no tenga ficha nuestra: esos son los NN) + todo el que estaba
//               en el cuadrante (aunque no saliera) + todo el que tenga una J.
//   · Turno   → el de su plaza ese día (f_cobertura). Al que trabajó sin estar
//               en el cuadrante se le deduce por dónde cayeron sus horas.
//   · KM      → de la misma llamada, por uuid. Sin cruces por nombre. Y desde
//               el 12/11/2026, LOS DE FUERA DE BOLT CON EL FICHAJE (Camilo: «Hazlo
//               con la versión ligera entonces. Si no hay nadie fichado en los
//               KM rodados por fuera, entonces se le suman al último que estuvo
//               en BOLT»): los KM BOLT siguen siendo de la cuenta conectada; los
//               de fuera de un coche, de quien lo tenía fichado por WhatsApp en
//               ese rato y, si no había nadie, del último en BOLT con él, como
//               siempre (services/flotaViva/kmFichaje.js). Si esa cuenta no sale
//               a tiempo, el reporte sale sin ella y lo dice (`sinFichaje`).
//   · J       → la tabla `justificante` de PostgreSQL, la misma que la bitácora
//               y que el botón de justificar de Control. Antes se leía la hoja
//               JUSTIFICANTES, así que una J puesta desde la bitácora no salía
//               en el Excel.

const db = require('../../services/db');
const { SEDE_FLOTA } = require('../../services/nucleo');
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
              count(DISTINCT f.turno_id) AS turnos,
              string_agg(DISTINCT v.matricula, ', ' ORDER BY v.matricula) AS matriculas
         FROM f_cobertura($1::date, $1::date) f
         JOIN vehiculo v ON v.id = f.vehiculo_id
        WHERE f.conductor_id IS NOT NULL
        GROUP BY f.conductor_id
     ),
     -- SU PLAZA, cubra o no ese día. El turno de una persona lo dice la plaza que
     -- ocupa (cat_slot.turno_id), no si ese día le tocaba trabajar: un fijo de
     -- NOCHE sigue siendo de noche el día que libra. Antes el turno salía solo de
     -- f_cobertura y al librante se le quedaba en blanco; el reporte caía entonces
     -- en "deducirlo" por sus horas y a Daniel Arenas (fijo noche que libra L y M)
     -- le ponía "Día".
     asignados AS (
       SELECT a.conductor_id,
              count(DISTINCT s.turno_id)                                   AS turnos_plaza,
              min(s.turno_id)                                              AS turno_id,
              string_agg(DISTINCT v.matricula, ', ' ORDER BY v.matricula)  AS matriculas
         FROM asignacion a
         JOIN plaza p    ON p.id = a.plaza_id AND p.baja_at IS NULL
         JOIN cat_slot s ON s.slot = p.slot
         JOIN vehiculo v ON v.id = p.vehiculo_id
        WHERE a.conductor_id IS NOT NULL
          AND a.desde <= $1::date AND (a.hasta IS NULL OR a.hasta >= $1::date)
        GROUP BY a.conductor_id
     )
     SELECT a.conductor_id,
            (c.conductor_id IS NOT NULL) AS debia_salir,
            -- Quien cubre (o tiene plaza en) día Y noche está doblando: TodoTurno.
            CASE WHEN COALESCE(c.turnos, a.turnos_plaza) > 1 THEN 'TodoTurno'
                 ELSE COALESCE(tc.etiqueta, ta.etiqueta) END AS turno,
            COALESCE(c.matriculas, a.matriculas) AS matriculas_plan
       FROM asignados a
       LEFT JOIN cubre c ON c.conductor_id = a.conductor_id
       LEFT JOIN turno tc ON tc.id = c.turno_id
       LEFT JOIN turno ta ON ta.id = a.turno_id`, [iso]);
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
async function padron(iso) {
  const r = await db.consulta(
    `SELECT c.id,
            COALESCE(NULLIF(btrim(ce.externo_nombre), ''),
                     btrim(COALESCE(NULLIF(btrim(c.nombre_bolt), ''), COALESCE(c.apellidos || ', ', '') || c.nombre))) AS nombre,
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

  // Y LAS PRESTADAS DE ESE DIA, que van DESPUES a proposito: si una cuenta
  // estaba prestada ese dia, sus horas son de quien la usaba, no de su titular.
  // Sin esto el reporte las mandaba a "NN" o se las apuntaba a otro.
  const fantasmaDe = new Map();        // uuid -> nombre de la cuenta prestada
  if (iso) {
    const pres = await db.consulta(
      `SELECT ce.externo_id, f.conductor_id,
              COALESCE(ce.externo_nombre, '(sin nombre en BOLT)') AS cuenta
         FROM cuenta_fantasma f
         JOIN conductor_externo ce ON ce.id = f.cuenta_id
        WHERE f.anulado_at IS NULL
          AND f.desde <= $1::date AND (f.hasta IS NULL OR f.hasta >= $1::date)`, [iso]);
    pres.rows.forEach(x => {
      idDeUuid.set(x.externo_id, Number(x.conductor_id));
      fantasmaDe.set(x.externo_id, x.cuenta);
    });
  }
  return { porId, idDeUuid, fantasmaDe };
}

// ── LOS COCHES DE OTRA SEDE ─────────────────────────────────────────────────
// La flota que se vigila es la de Madrid (services/nucleo.js). En el reporte la
// gente sigue saliendo con sus horas —Control no cambia—, pero los km de un
// coche de Barcelona no se cuentan: la celda dice «Barcelona» y ya. Lo pidió
// Camilo el 24/09/2026.
const normPlaca = m => String(m == null ? '' : m).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** matrícula → nombre de su sede ('Barcelona'), solo de los coches de otra sede. */
async function cochesDeOtraSede() {
  const r = await db.consulta(
    `SELECT matricula_norm AS matricula, sede FROM vehiculo WHERE sede <> $1`, [SEDE_FLOTA]);
  return new Map(r.rows.map(x => [x.matricula, x.sede.charAt(0).toUpperCase() + x.sede.slice(1)]));
}

/**
 * Aparta de una fila los km de los coches de otra sede.
 *
 *   · Si TODOS sus coches de ese día son de allí, las dos celdas de km dicen el
 *     nombre de la sede en vez del número. No es un REVISAR: no falta nada.
 *   · Si llevó uno de Madrid y otro de Barcelona —pasa: el 22/09 hubo tres—, se
 *     dan los km del de Madrid y se aparta solo lo del otro, que queda en
 *     `kmAparte` para que el Excel lo diga en una nota. Antes se sumaban.
 *
 * La matrícula lleva la sede al lado, para que se vea de dónde sale la cosa sin
 * tener que saberse las placas.
 */
function apartarOtraSede(fila, a, otraSede) {
  const sedeDe = m => otraSede.get(normPlaca(m));
  const mats = a.matriculas || [];
  const deOtra = mats.filter(sedeDe);
  const kmOtra = Object.entries(a.kmPorCoche || {}).filter(([m]) => sedeDe(m));
  if (!deOtra.length && !kmOtra.length) return;

  const sede = sedeDe(deOtra[0] || kmOtra[0][0]);
  if (deOtra.length) fila.matricula = mats.map(m => (sedeDe(m) ? `${m} (${sedeDe(m)})` : m)).join(', ');
  const suma = campo => r1(kmOtra.reduce((t, [, k]) => t + (k[campo] || 0), 0));
  fila.kmAparte = { sede, matriculas: [...new Set([...deOtra, ...kmOtra.map(([m]) => m)])], km: r1(suma('km') + suma('kmFuera')) };

  if (!mats.some(m => !sedeDe(m))) {
    fila.otraSede = sede;
    fila.kmBolt = sede; fila.kmDesc = sede;
    fila.fuenteKm = null; fila.revisar = false;
    return;
  }
  fila.kmBolt = Math.max(0, r1((Number(a.km) || 0) - suma('km')));
  fila.kmDesc = Math.max(0, r1((Number(a.kmFuera) || 0) - suma('kmFuera')));
  // La vara de medir, solo con los coches que se quedan.
  const propios = Object.entries(a.kmPorCoche || {}).filter(([m]) => !sedeDe(m)).map(([, k]) => k);
  const can = propios.some(k => k.can), gps = propios.some(k => k.gps);
  fila.fuenteKm = can && gps ? 'mixta' : (gps ? 'gps' : (can ? 'can' : null));
  fila.revisar = !fila.kmBolt && !fila.kmDesc && (a.minutos || 0) > 0;
}

/** La misma forma que fechaDeClave, de una fecha ISO. */
function fechaDeIso(isoDia) {
  const [y, m, d] = isoDia.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d, 12));
  const pad = n => String(n).padStart(2, '0');
  return { Y: y, M: m, D: d, str: `${pad(d)}/${pad(m)}/${y}`, iso: isoDia, idx: (f.getUTCDay() + 6) % 7 };
}

// ── LOS FICHAJES DEL DÍA (12/11/2026) ───────────────────────────────────────
// Los turnos fichados por WhatsApp que tocan el día del reporte (de las 00:00
// del día a las 12:00 del siguiente: su turno de día y su turno de noche). Cada
// uno con su dueño: el conductor si se le reconoció; si no, su teléfono; y los
// viajes de la oficina, su usuario. Es una consulta pequeña: una fila por fichaje.
async function fichajesDelDia(iso) {
  const r = await db.consulta(
    `SELECT f.id, f.tipo, f.conductor_id, f.usuario_id, f.telefono, f.matricula, f.inicio, f.fin,
            COALESCE(NULLIF(btrim(f.nombre), ''), btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')), f.telefono) AS nombre
       FROM fichaje_turno f
       LEFT JOIN usuario u ON u.id = f.usuario_id
      WHERE f.inicio < (($1::date + 1) + interval '12 hours') AT TIME ZONE 'Europe/Madrid'
        AND COALESCE(f.fin, now()) > ($1::date)::timestamp AT TIME ZONE 'Europe/Madrid'
        AND f.inicio >= $1::date - interval '3 days'
      ORDER BY f.inicio`, [iso]);
  return r.rows.map(x => ({
    id: String(x.id), tipo: x.tipo, conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    usuarioId: x.usuario_id ? Number(x.usuario_id) : null, telefono: x.telefono || '', nombre: x.nombre || '',
    matricula: normPlaca(x.matricula), inicio: new Date(x.inicio), fin: x.fin ? new Date(x.fin) : null,
  }));
}

/** De quién es un fichaje (o una fila de km de fichaje): la misma clave para los dos. */
const duenoFichaje = x => (x.conductorId || x.conductor_id ? `c${Number(x.conductorId || x.conductor_id)}`
  : (x.usuarioId || x.usuario_id) ? `u${Number(x.usuarioId || x.usuario_id)}` : `t${x.telefono || ''}`);

const horaMadrid = d => new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/**
 * El texto de la columna «Fichaje»: las horas de cada turno fichado («05:02–17:10»,
 * «desde 05:02» si sigue abierto), por coche. Quien ficha y vuelve a fichar el
 * mismo coche muchas veces va en una línea: «06:28–21:10 (5 fichajes)».
 */
function textoFichaje(lista) {
  if (!lista.length) return '';
  const coches = [...new Set(lista.map(f => f.matricula))];
  const tramo = f => (f.fin ? `${horaMadrid(f.inicio)}–${horaMadrid(f.fin)}` : `desde ${horaMadrid(f.inicio)}`);
  return coches.map(m => {
    const suyos = lista.filter(f => f.matricula === m);
    const ultimo = suyos[suyos.length - 1];
    const texto = suyos.length > 2
      ? `${horaMadrid(suyos[0].inicio)}–${ultimo.fin ? horaMadrid(ultimo.fin) : 'abierto'} (${suyos.length} fichajes)`
      : suyos.map(tramo).join(' · ');
    return texto + (coches.length > 1 ? ` ${m}` : '');
  }).join(' · ');
}

/**
 * El reporte de un día. `key`: 0=Hoy, 1=Ayer, 2=Hace 2, 3=Hace 3, o una fecha
 * ISO (AAAA-MM-DD), que es como se comprueba con un día pasado.
 */
async function reporteDia(key) {
  const { str: fecha, iso, idx } = /^\d{4}-\d{2}-\d{2}$/.test(String(key)) ? fechaDeIso(String(key)) : fechaDeClave(key);
  const rutas = require('../../services/flotaViva/rutas');
  const repoJust = require('../../services/repo/justificantes');
  await require('../../services/flotaViva/db').preparar();

  const reparto = require('../../services/flotaViva/repartoTurnos');
  const [vent, horasRep, plan, pad, justis, prom, otraSede, fichajes] = await Promise.all([
    // LAS VENTANAS DE LOS TURNOS (las de Control): de ahí salen los km, los
    // coches y quién se conectó. Quien dobla, la de sus dos turnos juntos.
    rutas.actividadDeVariosTurnos(iso, ['diaControl', 'nocheControl', 'todoturnoControl']),
    // LAS HORAS, POR EL TURNO DE CADA UNO (06/10/2026): su día más su noche.
    reparto.porPersonaYDia([iso]),
    planDelDia(iso),
    padron(iso),
    // Sin red: si las J no se pueden leer, el Excel no sale (antes salía sin
    // ninguna J y nadie lo sabía).
    repoJust.leerPorFecha(iso),
    // El promedio de horas del MES CORRIDO de cada uno. Va al lado del nombre
    // para poder leer el día contra su costumbre: 6 h son pocas en alguien de
    // 9 de media y normales en alguien de 6. Sin la letra: en un Excel que se
    // manda fuera, una nota escolar al lado de un nombre sobra.
    require('../../services/repo/rendimiento').leer().catch(() => new Map()),
    cochesDeOtraSede(),
    // Los turnos fichados por WhatsApp que tocan el día (una fila por fichaje).
    fichajesDelDia(iso),
  ]);
  // LOS KM DE FUERA CON EL FICHAJE, aparte y con su tope (kmFichaje.js). Si no
  // salen —se pasan del tope, o falla algo—, el reporte sale igual con la regla
  // de antes y lo dice: mejor un Excel con los km de siempre que ninguno. Va
  // DESPUÉS de lo de arriba, no a la vez: así no se suma a la carga de la base.
  let kmF = null, sinFichaje = null;
  try {
    kmF = await require('../../services/flotaViva/kmFichaje').kmFueraConFichaje(iso,
      ['diaControl', 'nocheControl', 'todoturnoControl'].map(c => { const [hIni, off, hFin] = rutas.TURNOS[c]; return { codigo: c, hIni, off, hFin }; }));
  } catch (e) {
    sinFichaje = e.message;
    console.error(`⚠️  [Reporte de horas] ${iso}: los km con el fichaje no salieron (${e.message}); va sin ellos`);
  }

  // Los justificantes, por persona (la clave 'id:<conductor_id>').
  const justPorId = new Map();
  for (const [k, j] of justis.entries()) if (k.startsWith('id:')) justPorId.set(Number(j.conductorId), j);

  // Las horas de cada persona ese día: su turno de día más su turno de noche.
  const horasDe = clave => (horasRep.get(clave) || new Map()).get(iso) || { dia: 0, noche: 0 };
  const claveDe = uuid => { const cid = pad.idDeUuid.get(uuid); return cid ? 'c' + cid : 'u' + uuid; };
  /**
   * El turno DE HECHO de quien trabajó sin estar en el cuadrante: el de sus
   * horas, por la misma regla (los NN, por su hora de inicio). Antes era donde
   * caía el grueso de sus horas por el reloj (05→17 y 17→05), y antes aún la
   * hora de su primera conexión.
   */
  const turnoDeHecho = clave => {
    const x = horasDe(clave);
    if (!x.dia && !x.noche) return '';
    return x.noche > x.dia ? 'Noche' : 'Día';
  };
  // Cada cuenta, con la actividad de la ventana del turno de su dueño: de día,
  // la del día; de noche, la de la noche; si hizo los dos, la de los dos. Así
  // los km y los coches son los de las mismas horas que se cuentan.
  const ventanaDe = { dia: vent.get('diaControl'), noche: vent.get('nocheControl'), todo: vent.get('todoturnoControl') };
  const cuentas = new Set();
  Object.values(ventanaDe).forEach(v => v && v.porUuid.forEach((_, u) => cuentas.add(u)));
  const CODIGO_DE = { dia: 'diaControl', noche: 'nocheControl', todo: 'todoturnoControl' };
  // La actividad de una cuenta y el código de la ventana de la que sale (para
  // casar con ella lo que el fichaje le quita).
  const actividadYVentana = uuid => {
    const x = horasDe(claveDe(uuid));
    const k = x.dia > 0 && x.noche > 0 ? 'todo' : x.noche > 0 ? 'noche' : 'dia';
    for (const kk of [k, 'dia', 'noche']) {
      const v = ventanaDe[kk];
      const a = v && v.porUuid.get(uuid);
      if (a) return { a, codigo: CODIGO_DE[kk] };
    }
    return { a: null, codigo: null };
  };
  // LO QUE EL FICHAJE LE QUITA A CADA CUENTA (12/11/2026): sus km de fuera de
  // BOLT que caen dentro del fichaje de otro coche o de otra persona. Por
  // ventana, cuenta y coche.
  const restaDe = new Map();
  if (kmF) kmF.forEach((v, codigo) => v.restas.forEach(x => {
    const k = `${codigo}|${x.uuid}`;
    if (!restaDe.has(k)) restaDe.set(k, new Map());
    const m = restaDe.get(k);
    m.set(x.matricula, r1((m.get(x.matricula) || 0) + (Number(x.km_fuera) || 0)));
  }));
  /** La actividad con sus km de fuera ya sin lo que se lleva el fichaje. */
  const conResta = (a, codigo) => {
    const m = restaDe.get(`${codigo}|${a.uuid}`);
    if (!m) return a;
    const kmPorCoche = {};
    let quita = 0;
    Object.entries(a.kmPorCoche || {}).forEach(([mat, k]) => {
      const q = Math.min(k.kmFuera || 0, m.get(mat) || 0);
      quita += q;
      kmPorCoche[mat] = { ...k, kmFuera: r1((k.kmFuera || 0) - q) };
    });
    return { ...a, kmPorCoche, kmFuera: Math.max(0, r1((Number(a.kmFuera) || 0) - quita)) };
  };

  // ── 1. Todo el que TRABAJÓ (o al menos se conectó) ────────────────────────
  const filasPorId = new Map();   // conductor_id → fila
  const sueltos = [];             // los que ni ficha tienen: NN puros
  const conHoras = new Set();     // personas a las que ya se les pusieron sus horas
  for (const uuid of cuentas) {
    const { a: a0, codigo } = actividadYVentana(uuid);
    if (!a0) continue;
    const a = conResta(a0, codigo);
    // Las horas son de la PERSONA (todas sus cuentas ya juntas, cada segundo
    // una vez): se ponen en su primera cuenta y las demás suman cero.
    const clave = claveDe(uuid);
    const x = horasDe(clave);
    const horas = conHoras.has(clave) ? 0 : r1((x.dia + x.noche) / 3600);
    conHoras.add(clave);
    const cid = pad.idDeUuid.get(a.uuid);
    const p = cid ? pad.porId.get(cid) : null;
    const pl = cid ? plan.get(cid) : null;
    const fila = {
      conductorId: cid || null,
      nombre: (p && p.nombre) || a.nombre || `#${String(a.uuid).slice(0, 8)}`,
      telefono: (p && p.telefono) || a.telefono || '',
      // EL TURNO DE SU PLAZA MANDA, libre o no. Solo se deduce por las horas
      // (día vs noche) cuando la persona no tiene plaza: ahí no hay nada mejor.
      turno: (pl && pl.turno) || turnoDeHecho(clave),
      uuids: [a.uuid],
      horas,
      libra: !!(pl && pl.libra),
      debiaSalir: !!(pl && pl.debiaSalir),
      // NN = trabajó sin que el cuadrante lo esperase. Es el que hay que mirar.
      esNN: !pl || !pl.debiaSalir,
      // Trabajó EN SU LIBRANZA: tiene plaza, pero ese día su coche descansaba o
      // no le tocaba. No es lo mismo que "no está en el cuadrante", y para el
      // convenio es justo lo que hay que ver.
      enLibranza: !!(pl && pl.libra),
      sinFicha: !cid,
      matricula: (a.matriculas && a.matriculas.length) ? a.matriculas.join(', ') : null,
      kmBolt: a.km, kmDesc: a.kmFuera,
      // CON QUÉ VARA SE MIDIERON ESOS KM. 'can' es el odómetro del cuadro del
      // coche; 'gps' es la estimación de Mapon uniendo los puntos, que es lo
      // único que hay en los coches cuyo equipo no lee el CAN. No es lo mismo y
      // el reporte lo dice, porque si no, dos filas con el mismo número parecen
      // igual de firmes y no lo son.
      fuenteKm: a.fuenteKm || null,
      // Fichó en BOLT con un coche pero Mapon no midió nada: no se puede dar el
      // km por bueno. Lo cuadra Tráfico, que conoce el apaño del taller.
      revisar: !!(a.matriculas && a.matriculas.length) && !a.km && !a.kmFuera && (a.minutos || 0) > 0,
      just: cid ? justPorId.get(cid) : null,
    };
    // Los km de un coche de Barcelona no cuentan: ver `apartarOtraSede`.
    apartarOtraSede(fila, a, otraSede);
    // «REVISAR» se escribe al final: antes se suman los km de su fichaje.
    if (!cid) { sueltos.push(fila); continue; }
    if (!filasPorId.has(cid)) { filasPorId.set(cid, fila); continue; }
    // La MISMA persona con otra cuenta de BOLT ese día: se suma, no se pisa.
    const f = filasPorId.get(cid);
    f.horas = r1(f.horas + fila.horas);
    f.uuids.push(a.uuid);
    if (!pl || !pl.turno) f.turno = turnoDeHecho(clave);
    f.matricula = [...new Set([...(f.matricula ? f.matricula.split(', ') : []), ...(fila.matricula ? fila.matricula.split(', ') : [])])].join(', ') || null;
    const num = v => (typeof v === 'number' ? v : 0);
    const revisar = f.revisar || fila.revisar;
    // Las dos cuentas con coches de otra sede: la celda sigue diciendo cuál.
    // Si solo una, cuentan los km de la otra (el texto suma cero).
    const soloOtra = f.otraSede && fila.otraSede ? f.otraSede : null;
    f.fuenteKm = f.fuenteKm === fila.fuenteKm ? f.fuenteKm : (f.fuenteKm && fila.fuenteKm ? 'mixta' : (f.fuenteKm || fila.fuenteKm));
    f.kmBolt = soloOtra || Math.round((num(f.kmBolt) + num(fila.kmBolt)) * 10) / 10;
    f.kmDesc = soloOtra || Math.round((num(f.kmDesc) + num(fila.kmDesc)) * 10) / 10;
    f.revisar = revisar;
    f.otraSede = soloOtra;
    if (fila.kmAparte) {
      f.kmAparte = f.kmAparte
        ? { sede: f.kmAparte.sede, matriculas: [...new Set([...f.kmAparte.matriculas, ...fila.kmAparte.matriculas])],
            km: r1(f.kmAparte.km + fila.kmAparte.km) }
        : fila.kmAparte;
    }
  }

  // ── 1b. LOS FICHAJES (12/11/2026): sus km de fuera de BOLT ─────────────────
  // Cada persona, con la ventana de su turno —por sus horas; sin horas, por su
  // plaza; sin plaza, por la hora a la que fichó (antes de las 12:00, día)—, se
  // lleva los km de fuera de BOLT de los coches que tenía fichados en esa
  // ventana. Si no tenía fila (fichó y no estuvo en BOLT, o es de la oficina),
  // se le hace una. La columna «Fichaje» sale aunque los km no se hayan podido
  // calcular.
  const ventanaPara = (cid, susFichajes) => {
    if (cid) {
      const x = horasDe(`c${cid}`);
      if (x.dia > 0 && x.noche > 0) return 'todo';
      if (x.noche > 0) return 'noche';
      if (x.dia > 0) return 'dia';
      const t = ((plan.get(cid) || {}).turno || '').trim();
      if (t === 'TodoTurno') return 'todo';
      if (t === 'Noche') return 'noche';
      if (t === 'Día' || t === 'Dia') return 'dia';
    }
    const h = Number(horaMadrid(susFichajes[0].inicio).slice(0, 2));
    return h < 12 ? 'dia' : 'noche';
  };
  const ventanaMs = codigo => { const v = vent.get(codigo); return [new Date(v.ini).getTime(), new Date(v.finPlan || v.fin).getTime()]; };
  const fichajesDe = new Map();
  fichajes.forEach(f => { const k = duenoFichaje(f); if (!fichajesDe.has(k)) fichajesDe.set(k, []); fichajesDe.get(k).push(f); });
  for (const [dueno, susFichajes] of fichajesDe.entries()) {
    const cid = dueno.startsWith('c') ? Number(dueno.slice(1)) : null;
    const codigo = CODIGO_DE[ventanaPara(cid, susFichajes)];
    const [ini, fin] = ventanaMs(codigo);
    const enVentana = susFichajes.filter(f => f.inicio.getTime() < fin && (f.fin ? f.fin.getTime() : Date.now()) > ini);
    if (!enVentana.length) continue;
    let fila = cid ? filasPorId.get(cid) : null;
    // Quien solo fichó coches de otra sede (Barcelona) no entra en este reporte.
    if (!fila && enVentana.every(f => otraSede.has(f.matricula))) continue;
    if (!fila) {
      const p = cid ? pad.porId.get(cid) : null;
      const pl = cid ? plan.get(cid) : null;
      const f0 = enVentana[0];
      fila = {
        conductorId: cid, nombre: (p && p.nombre) || f0.nombre || `#${cid || f0.telefono}`,
        telefono: (p && p.telefono) || f0.telefono || '',
        turno: (pl && pl.turno) || '', horas: 0, libra: !!(pl && pl.libra), debiaSalir: !!(pl && pl.debiaSalir),
        esNN: !pl || !pl.debiaSalir, enLibranza: !!(pl && pl.libra), sinFicha: !cid && f0.tipo !== 'viaje',
        deOficina: f0.tipo === 'viaje',
        matricula: null, kmBolt: 0, kmDesc: 0, fuenteKm: null, revisar: false,
        just: cid ? justPorId.get(cid) || null : null,
      };
      if (cid) filasPorId.set(cid, fila); else sueltos.push(fila);
    }
    fila.fichajes = enVentana;
    // Los km de fuera de sus fichajes, coche a coche (los de otra sede, aparte).
    const km = kmF ? (kmF.get(codigo) || { fichajes: [] }).fichajes.filter(x => duenoFichaje(x) === dueno) : [];
    let kf = 0, can = false, gps = false;
    km.forEach(x => {
      const k = Number(x.km_fuera) || 0;
      const sede = otraSede.get(normPlaca(x.matricula));
      if (sede) {
        const ap = fila.kmAparte || (fila.kmAparte = { sede, matriculas: [], km: 0 });
        if (!ap.matriculas.includes(x.matricula)) ap.matriculas.push(x.matricula);
        ap.km = r1(ap.km + k);
        return;
      }
      kf += k;
      if (x.hay_can) can = true;
      if (x.hay_gps) gps = true;
    });
    if (typeof fila.kmDesc !== 'string') {
      const num = v => (typeof v === 'number' ? v : 0);
      fila.kmBolt = r1(num(fila.kmBolt));
      fila.kmDesc = r1(num(fila.kmDesc) + kf);
    }
    const fuente = can && gps ? 'mixta' : gps ? 'gps' : can ? 'can' : null;
    if (fuente) fila.fuenteKm = !fila.fuenteKm || fila.fuenteKm === fuente ? fuente : 'mixta';
    // El coche fichado va primero en la matrícula.
    const fichados = [...new Set(enVentana.map(f => f.matricula).filter(Boolean))];
    fila.matricula = [...new Set([...fichados, ...(fila.matricula ? fila.matricula.split(', ') : [])])].join(', ') || null;
    if (kf > 0) fila.revisar = false;
  }
  // REVISAR, ahora sí: estuvo en BOLT con un coche y ni BOLT ni el fichaje dan km.
  [...filasPorId.values(), ...sueltos].forEach(f => {
    if (f.revisar && !f.otraSede) { f.kmBolt = 'REVISAR'; f.kmDesc = 'REVISAR'; }
  });

  // ── 2. Los que DEBÍAN salir y no aparecen en BOLT: 0 h ────────────────────
  for (const [cid, pl] of plan.entries()) {
    if (filasPorId.has(cid) || !pl.debiaSalir) continue;
    const p = pad.porId.get(cid);
    filasPorId.set(cid, {
      conductorId: cid, nombre: (p && p.nombre) || `#${cid}`, telefono: (p && p.telefono) || '',
      turno: pl.turno || '', horas: 0, libra: false, debiaSalir: true, esNN: false, sinFicha: false,
      matricula: pl.matriculaPlan || null, kmBolt: null, kmDesc: null, fuenteKm: null, revisar: false,
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
      esNN: !pl, sinFicha: false, matricula: null, kmBolt: null, kmDesc: null, fuenteKm: null, revisar: false, just: j,
    });
  }

  // Quien libraba y no trabajó no sale en el reporte: no es una falta.
  const bruto = [...filasPorId.values(), ...sueltos]
    .filter(f => f.horas > 0 || f.debiaSalir || f.just || (f.fichajes && f.fichajes.length));

  // ORGANIZADO POR TURNO. Tráfico lee el reporte por turnos, no en una lista
  // de 138 nombres mezclados: primero el bloque de DÍA, luego el de NOCHE, luego
  // TodoTurno y, al final, quien no tiene turno. Dentro de cada bloque, los no
  // justificados de más a menos horas y los justificados al final.
  const ORDEN_TURNO = { 'Día': 0, 'Dia': 0, 'Noche': 1, 'TodoTurno': 2 };
  const pesoTurno = f => ORDEN_TURNO[(f.turno || '').trim()] ?? 3;
  const cmp = (a, b) => (b.horas ?? -1) - (a.horas ?? -1) || a.nombre.localeCompare(b.nombre, 'es');
  const orden = bruto.slice().sort((a, b) =>
    pesoTurno(a) - pesoTurno(b) ||
    Number(!!a.just) - Number(!!b.just) ||
    cmp(a, b));

  const filas = orden.map((f, i) => {
    const comun = {
      nro: i + 1, nombre: f.nombre, telefono: f.telefono, turno: f.turno, horas: f.horas,
      // null cuando no hay promedio: alguien recién dado de alta, o un NN sin
      // ficha. Se deja vacío en vez de poner un cero que parecería un suspenso.
      promedioMes: (f.conductorId && (prom.get(Number(f.conductorId)) || {}).horas) ?? null,
      libra: f.libra, debiaSalir: f.debiaSalir, esNN: f.esNN, sinFicha: f.sinFicha,
      enLibranza: f.enLibranza,
      matricula: f.matricula, kmBolt: f.kmBolt, kmDesc: f.kmDesc, fuenteKm: f.fuenteKm || null, revisar: f.revisar,
      otraSede: f.otraSede || null, kmAparte: f.kmAparte || null,
      // EL FICHAJE (12/11/2026): sus horas, o «Sin fichar» si trabajó o movió
      // un coche sin fichar. Quien no salió no lleva nada.
      fichaje: f.fichajes && f.fichajes.length ? textoFichaje(f.fichajes) : '',
      sinFichar: !(f.fichajes && f.fichajes.length) && !f.otraSede
        && ((f.horas || 0) > 0 || (typeof f.kmBolt === 'number' && f.kmBolt > 0) || (typeof f.kmDesc === 'number' && f.kmDesc > 0)),
      deOficina: !!f.deOficina,
    };
    if (f.just) {
      const horasTexto = (f.horas != null && f.horas > 0) ? `${r1(f.horas)} (J)` : 'J';
      // Las horas justificadas SE SUMAN a las de BOLT: van delante del motivo,
      // que es lo que mira nómina. Antes el Excel decía "vale 8 h" para toda J.
      const hj = f.just.horasJ;
      const observacion = (hj != null ? `J ${String(hj).replace('.', ',')} h · ` : 'J · ') + (f.just.observacion || '');
      return { ...comun, horasTexto, horasJ: hj, color: 'azul', observacion, esJ: true };
    }
    // La oficina no hace turnos: su fila es solo para sus km (un viaje fichado).
    if (f.deOficina) {
      return { ...comun, horasTexto: '', color: 'gris', observacion: 'Oficina · viaje fichado', esJ: false };
    }
    const b = banda(f.horas);
    // El aviso va con la observación automática: el que salió sin estar en el
    // cuadrante es justo el que hay que mirar, y antes no se distinguía.
    const nota = f.sinFicha ? (f.fichajes && f.fichajes.length && !(f.uuids || []).length ? 'Fichó por WhatsApp · sin ficha' : 'Solo en BOLT · sin ficha')
      : (f.enLibranza && f.horas > 0) ? 'Trabajó en su libranza'
      : (f.esNN && f.horas > 0) ? 'Fuera del cuadrante'
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
    // Antes de las 12:00 del día siguiente, el día sigue abierto: la noche
    // cuenta hasta esa hora (06/10/2026). El Excel lo dice, no lo esconde.
    parcial: Date.now() < reparto.cierreDe(iso),
    // Si los km con el fichaje no salieron, el motivo (el Excel lo dice arriba).
    sinFichaje,
    filas, resumen: resumirFilas(filas),
  };
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
    noSalieron: filas.filter(f => !hizo(f) && !f.libra && !f.deOficina).length,
    cumplieron8: filas.filter(f => (f.horas ?? 0) >= 8).length,
    menos4: filas.filter(f => hizo(f) && f.horas < 4).length,
    justificados: filas.filter(f => f.esJ).length,
    // Horas justificadas en total: se SUMAN a las de BOLT para la nómina.
    horasJustificadas: r1(filas.filter(f => f.esJ).reduce((s, f) => s + (f.horasJ || 0), 0)),
    // Los que salieron sin estar en el cuadrante: el número que antes no existía.
    fueraDelPlan: filas.filter(f => f.esNN && hizo(f)).length,
    horasFueraDelPlan: r1(filas.filter(f => f.esNN && hizo(f)).reduce((s, f) => s + (f.horas ?? 0), 0)),
    // De esos, los que SÍ tienen plaza y trabajaron el día que libraban.
    enLibranza: filas.filter(f => f.enLibranza && hizo(f)).length,
    horasEnLibranza: r1(filas.filter(f => f.enLibranza && hizo(f)).reduce((s, f) => s + (f.horas ?? 0), 0)),
    horasDia: porTurno['Día'] || 0,
    horasNoche: porTurno['Noche'] || 0,
    horasTodoTurno: porTurno['TodoTurno'] || 0,
    horasSinTurno: porTurno['(sin turno)'] || 0,
    horasTotal: r1(filas.reduce((s, f) => s + (f.horas ?? 0), 0)),
    personas: filas.length,
    // Cuántos ficharon por WhatsApp y cuántos trabajaron (o movieron un coche) sin fichar.
    ficharon: filas.filter(f => f.fichaje).length,
    sinFichar: filas.filter(f => f.sinFichar).length,
  };
}

module.exports = { reporteDia, resumirFilas, banda, fechaDeClave, planDelDia };
