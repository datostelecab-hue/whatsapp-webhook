/**
 * PLANIFICADOR V2 — motor portado desde Apps Script.
 *
 * La lógica es la misma que la del .gs original, pero aquí se calcula en
 * memoria: lo que allí costaba ~1000 viajes a la API de Google (720 de ellos
 * solo para repintar desplegables) aquí son dos lecturas y una escritura.
 *
 * El cálculo vive en `calcularTablero`, que es una función PURA: recibe los
 * valores de las hojas y devuelve el tablero resuelto, sin tocar la red. Así se
 * puede probar a fondo, que es lo que importa cuando un fallo silencioso te
 * descuadra la planificación de 87 coches.
 */

// LOS NOMBRES DE LAS HOJAS SE QUEDAN, aunque ya no se abra ninguna. El motor
// habla en el idioma de aquella cuadrícula —fila de cabecera, seis filas por
// coche, columnas combinadas— y los mensajes de error la nombran. Traducirlo
// todo ahora sería reescribir el motor entero por un nombre.
const HOJAS = {
  AGENDA: 'AGENDA_V2',
  PLAN: 'PLANIFICADOR_V2',
  BASES: 'BASES'
};

// ---- Layout de PLANIFICADOR_V2 (debe coincidir con el .gs) ----
const PLAN_FILA_CAB = 8;
const PLAN_FILA_INI = 9;
const FILAS_POR_COCHE = 6;
const N_MAT = 120;

// Columnas de PLANIFICADOR_V2 (1-based)
const P = {
  TURNO: 1, ESTADO_VEH: 2, MATRICULA: 3, ID_BOLT: 4, ZONA: 5,
  DIAS_TRABAJA: 6, TURNOS_LIBRES: 7, NUM_LIBRES: 8,
  ESTADO_FLAT: 9, MATRICULA_FLAT: 10,
  // Ventana de vigencia de la asignación (opcionales). Columnas K y L.
  DESDE: 11, HASTA: 12
};

// Columnas de AGENDA_V2 (1-based)
// El mapa de columnas de la agenda vive en el NUCLEO: es un contrato de datos
// (donde esta cada cosa), no una regla de negocio, y lo necesitan tambien dos
// repositorios. Mientras vivio aqui dentro, esos repositorios tenian que llamar
// hacia arriba para saber en que columna va el telefono. Se sigue reexportando
// para no cambiar a los diez sitios que ya lo piden a este modulo.
const { A, A_HEADERS } = require('./nucleo');

const P_HEADERS = [
  'TURNO', 'ESTADO_VEHICULO', 'MATRICULA', 'ID_BOLT', 'ZONA',
  'DIAS_TRABAJA', 'TURNOS_LIBRES_COCHE', 'NUM_TURNOS_LIBRES',
  '_ESTADO_FLAT', '_MATRICULA_FLAT'
];

const LIB_COL = [A.L_LUN, A.L_MAR, A.L_MIE, A.L_JUE, A.L_VIE, A.L_SAB, A.L_DOM];
const ASG_COL = [A.ASG_LUN, A.ASG_MAR, A.ASG_MIE, A.ASG_JUE, A.ASG_VIE, A.ASG_SAB, A.ASG_DOM];

const SLOTS = [
  { etiqueta: 'Día', turno: 'Día', rol: 'FIJO' },
  { etiqueta: 'Noche', turno: 'Noche', rol: 'FIJO' },
  { etiqueta: 'CT1 Día', turno: 'Día', rol: 'CT' },
  { etiqueta: 'CT1 Noche', turno: 'Noche', rol: 'CT' },
  { etiqueta: 'CT2 Día', turno: 'Día', rol: 'CT' },
  { etiqueta: 'CT2 Noche', turno: 'Noche', rol: 'CT' }
];

// Del núcleo: había seis copias de esto repartidas por el proyecto.
const { DIAS_CORTOS: DIAS_SEM, LETRAS_DIA } = require('./nucleo');
const TURNOS = ['Día', 'Noche'];                        // turnos de una plaza de coche
const TURNOS_CONDUCTOR = ['Día', 'Noche', 'TodoTurno']; // turno que puede tener un conductor
const CONTRATOS = ['32h', '40h', '32h ETT', '40h ETT'];

const ESTADOS_CONDUCTOR = ['Activo', 'Pendiente Asignar', 'Vacaciones', 'Baja Médica', 'Permiso Retribuido', 'Baja Empresa', 'Suspendido'];
const ESTADOS_ESPECIALES = ['Vacaciones', 'Baja Médica', 'Permiso Retribuido', 'Baja Empresa', 'Suspendido'];
const ESTADO_PENDIENTE = 'Pendiente Asignar';
const ESTADO_ACTIVO = 'Activo';
const ESTADOS_VEHICULO = ['✓', 'S', 'T', 'X', 'R', 'B'];
const ESTADO_OPERATIVO = '✓';

// ============================================================
// UTILIDADES
// ============================================================

/**
 * "L M X" → [true,true,true,false,false,false,false]
 * Devuelve null si está vacío, que significa "usa la libranza de la agenda"
 * en vez de "no trabaja ningún día". Esa distinción es la que separa a un
 * binomio fijo (celda vacía) de un correturno (días escritos a mano).
 */
const MAPA_DIA = { L: 0, M: 1, X: 2, J: 3, V: 4, S: 5, D: 6 };

/**
 * Analiza el texto de días y dice además si se ha entendido.
 *
 * Acepta "L M X", "L,M,X" y "LMX", pero RECHAZA texto libre. El parser
 * original recorría carácter a carácter y aceptaba cualquier letra suelta que
 * encontrara: escribir "sabado domingo" acababa guardando "M S D", porque la M
 * venía de "doMingo". Un martes fantasma en la planificación no lo detecta
 * nadie hasta que falta un conductor, así que ahora se prefiere avisar.
 */
function analizarDias(txt) {
  if (txt == null) return { dias: null, valido: true, vacio: true };
  const s = String(txt).trim();
  if (s === '') return { dias: null, valido: true, vacio: true };

  const up = s.toUpperCase();
  const tokens = up.split(/[\s,;/|.\-_]+/).filter(Boolean);
  const res = [false, false, false, false, false, false, false];

  // "L M X" o "L,M,X": cada trozo es una letra válida
  if (tokens.length && tokens.every(t => t.length === 1 && t in MAPA_DIA)) {
    tokens.forEach(t => { res[MAPA_DIA[t]] = true; });
    return { dias: res, valido: true, vacio: false };
  }

  // "LMX": todo pegado, como mucho 7 letras y todas válidas
  if (tokens.length === 1 && tokens[0].length <= 7 && [...tokens[0]].every(ch => ch in MAPA_DIA)) {
    [...tokens[0]].forEach(ch => { res[MAPA_DIA[ch]] = true; });
    return { dias: res, valido: true, vacio: false };
  }

  return { dias: null, valido: false, vacio: false, texto: s };
}

function parseDiasTrabaja(txt) {
  return analizarDias(txt).dias;
}

function diasALetras(dias) {
  if (!dias) return '';
  return dias.map((v, i) => (v ? LETRAS_DIA[i] : null)).filter(Boolean).join(' ');
}

/**
 * Acepta "40.41 -3.70", "40.41, -3.70" y el formato europeo "40,41 -3,70".
 *
 * El europeo se detecta ANTES que nada: si no, la expresión regular general
 * lee "40,41 -3,70" como latitud 40 y longitud 41 —tomando la coma decimal por
 * separador— y coloca a un conductor de Madrid a 3.000 km, sin dar ningún
 * error. Como estas coordenadas alimentan el cálculo de distancia a las bases,
 * el fallo pasaría desapercibido hasta que alguien mirase el matching.
 */
function parseCoords(txt) {
  if (txt == null || txt === '') return null;
  const s = String(txt).trim();

  // Dos comas entre dígitos ⇒ son decimales, no separadores.
  const comasDecimales = (s.match(/\d,\d/g) || []).length;
  if (comasDecimales === 2) {
    const partes = s.split(/\s+/);
    if (partes.length >= 2) {
      const a = parseFloat(partes[0].replace(',', '.'));
      const b = parseFloat(partes[1].replace(',', '.'));
      if (!isNaN(a) && !isNaN(b)) return { lat: a, lng: b };
    }
    return null;
  }

  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
  if (m) {
    const la = parseFloat(m[1]);
    const lo = parseFloat(m[2]);
    if (!isNaN(la) && !isNaN(lo)) return { lat: la, lng: lo };
  }
  return null;
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const esCheck = v => v === true || v === 'TRUE' || v === 'VERDADERO';
const txt = v => String(v == null ? '' : v).trim();
// Date (UTC) → "dd/mm/aaaa", para mostrar la reincorporación derivada de la bitácora.
const fmtFecha = d => d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '';

// ============================================================
// FECHAS — ventanas de vigencia (alta, reincorporación, desde/hasta)
// ============================================================

// Estados de ausencia TEMPORAL: el conductor sigue en su plaza pero no cuenta
// hasta reincorporarse (lo cubre el CT2). "Baja Empresa" es definitiva y no entra.
const AUSENCIAS_TEMPORALES = ['Vacaciones', 'Baja Médica', 'Permiso Retribuido', 'Suspendido'];

/**
 * Fecha desde una celda: acepta dd/mm/aaaa, aaaa-mm-dd, un Date, o lo que
 * devuelva Sheets. Se fija a mediodía UTC para que comparar por día no baile
 * con el cambio de hora. Devuelve null si no se entiende (campo opcional).
 */
function parseFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12));
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);   // dd/mm/aaaa
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(y, +m[2] - 1, +m[1], 12)); }
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);         // aaaa-mm-dd
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  // Fallback (formatos raros, p.ej. con hora): normalizar también a mediodía UTC
  // del día que salga, para no romper la invariante de comparar por día.
  const d = new Date(s);
  return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
}

/**
 * Días (mediodía UTC) de lunes a domingo de la semana actual en la zona de la
 * flota. La planificación es semanal, así que las ventanas de fecha se evalúan
 * contra los días reales de ESTA semana.
 */
function fechasSemanaActual(offsetSemanas = 0) {
  const str = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [Y, M, D] = str.split('-').map(Number);
  const hoy = new Date(Date.UTC(Y, M - 1, D, 12));   // el día REAL, no cambia con el offset
  const offLun = (hoy.getUTCDay() + 6) % 7;
  const lunes = new Date(hoy);
  lunes.setUTCDate(hoy.getUTCDate() - offLun + (Number(offsetSemanas) || 0) * 7);
  const dias = [];
  for (let i = 0; i < 7; i++) { const f = new Date(lunes); f.setUTCDate(lunes.getUTCDate() + i); dias.push(f); }
  return { dias, hoy, lunes };
}

/**
 * ¿Cuenta esta persona en su plaza en una fecha dada? Considera el "desde"
 * (explícito o su fecha de alta), el "hasta" de la asignación y las ausencias
 * temporales (no cuenta hasta la reincorporación). Devuelve el motivo si no.
 */
function activoEnFecha(p, info, fecha) {
  // El "desde" efectivo es la fecha MÁS TARDÍA entre el alta del conductor y el
  // desde de la asignación: no puede empezar antes de ninguna de las dos.
  const cand = [p.desdeD, info && info.fechaAltaD].filter(Boolean);
  const desde = cand.length ? new Date(Math.max.apply(null, cand.map(d => d.getTime()))) : null;
  if (desde && fecha < desde) return { activo: false, motivo: 'pre-alta' };
  if (p.hastaD && fecha > p.hastaD) return { activo: false, motivo: 'hasta-vencido' };
  if (info && info.ausenteTemporal && (!info.reincorporacionD || fecha < info.reincorporacionD)) {
    return { activo: false, motivo: 'ausente' };
  }
  return { activo: true };
}

// ============================================================
// MOTOR — función pura, sin red
// ============================================================

/**
 * @param {Array[]} agendaVals  filas de AGENDA_V2 SIN cabecera
 * @param {Array[]} planVals    filas de PLANIFICADOR_V2 desde PLAN_FILA_INI
 * @param {Array}   bases       [{nombre, lat, lng}]
 * @returns tablero resuelto: coches, conductores, avisos y resumen
 */
function calcularTablero(agendaVals, planVals, bases = [], opciones = {}) {
  // Semana a mostrar (offset 0 = actual; >0 = futuro, para "ver el futuro" en
  // cobertura). "hoy" es siempre el día real, así las alertas no se desplazan.
  const offsetSemana = Number(opciones.offsetSemana) || 0;
  const { dias: fechasSemana, hoy: fechaHoy, lunes: lunesSemana } = fechasSemanaActual(offsetSemana);


  // ---- 1. Índice de conductores ----
  // porId indexa solo a los que tienen ID de Bolt: son los únicos que se pueden
  // vincular con el planificador. `conductores` incluye a TODOS los que tengan
  // nombre, aunque aún no tengan ID de Bolt, para que aparezcan en la agenda y
  // se les puedan completar los datos.
  const porId = new Map();
  const conductores = [];

  agendaVals.forEach((v, idx) => {
    const idBolt = txt(v[A.ID_BOLT - 1]);
    const nombre = txt(v[A.NOMBRE - 1]);
    // Fila realmente vacía: ni ID ni nombre. Se ignora.
    if (!idBolt && !nombre) return;

    const libra = LIB_COL.map(c => esCheck(v[c - 1]));
    const info = {
      fila: idx + 2,                     // fila real en la hoja
      idBolt,
      id: idBolt,                        // el planificador enlaza por este campo
      // Su clave es provisional: todavía no está dado de alta en BOLT. Se
      // planifica igual y se avisa.
      boltPendiente: txt(v[A.BOLT_PENDIENTE - 1]).toUpperCase() === 'SI',
      activo: esCheck(v[A.ACTIVO - 1]),
      nombre,
      dni: txt(v[A.DNI - 1]),
      naf: txt(v[A.NAF - 1]),
      fechaAlta: txt(v[A.FECHA_ALTA - 1]),
      finPrueba: txt(v[A.FIN_PRUEBA - 1]),
      enPrueba: txt(v[A.EN_PRUEBA - 1]),
      recomendador: txt(v[A.RECOMENDADOR - 1]),
      turno: txt(v[A.TURNO - 1]),
      contrato: txt(v[A.CONTRATO - 1]),
      estado: txt(v[A.ESTADO - 1]),
      telefono: txt(v[A.TELEFONO - 1]),
      telEmergencia: txt(v[A.TEL_EMERG - 1]),
      direccion: txt(v[A.DIRECCION - 1]),
      observaciones: txt(v[A.OBSERVACIONES - 1]),
      coordenadas: txt(v[A.COORDENADAS - 1]),
      libra,
      trabaja: libra.map(l => !l),
      // Ventana del conductor: alta como "desde" por defecto; reincorporación
      // para volver de una ausencia temporal.
      fechaAltaD: parseFecha(txt(v[A.FECHA_ALTA - 1])),
      // Cuándo vuelve. Sale de la columna REINCORPORACION de la agenda, que en
      // PostgreSQL es el `hasta_previsto` de la ausencia: se pone sola al abrir
      // el tramo y desaparece al cerrarlo. Antes había que deducirla releyendo
      // dónde se acababan las letras V/B/P en una hoja.
      reincorporacion: txt(v[A.REINCORPORACION - 1]),
      reincorporacionD: parseFecha(txt(v[A.REINCORPORACION - 1]))
    };
    info.ausenteTemporal = AUSENCIAS_TEMPORALES.includes(info.estado);
    if (idBolt) porId.set(idBolt, info);
    conductores.push(info);
  });

  // ---- 2. Coches ----
  const coches = [];
  for (let c = 0; c < N_MAT; c++) {
    const base = c * FILAS_POR_COCHE;
    const filaTop = planVals[base] || [];

    const personas = [];
    for (let k = 0; k < FILAS_POR_COCHE; k++) {
      const fila = planVals[base + k] || [];
      const id = txt(fila[P.ID_BOLT - 1]);
      const dias = analizarDias(fila[P.DIAS_TRABAJA - 1]);
      personas.push({
        slot: k,
        etiqueta: SLOTS[k].etiqueta,
        turno: SLOTS[k].turno,
        rol: SLOTS[k].rol,
        filaHoja: PLAN_FILA_INI + base + k,
        id,
        diasManual: dias.dias,
        diasIlegibles: dias.valido ? null : dias.texto,
        nombre: id && porId.has(id) ? porId.get(id).nombre : '',
        // Un ID que ya no está en la agenda es un dato huérfano: se avisa.
        huerfano: Boolean(id) && !porId.has(id),
        // Ventana de vigencia de ESTA asignación (opcional; sustituto temporal).
        desde: txt(fila[P.DESDE - 1]),
        hasta: txt(fila[P.HASTA - 1]),
        desdeD: parseFecha(fila[P.DESDE - 1]),
        hastaD: parseFecha(fila[P.HASTA - 1])
      });
    }

    const estadoVeh = txt(filaTop[P.ESTADO_VEH - 1]);
    coches.push({
      idx: c,
      filaTop: PLAN_FILA_INI + base,
      estadoVeh,
      // Se resuelve aquí porque la cobertura ya depende de ello: un coche que
      // no sale a la calle no asigna días ni matrícula a nadie.
      operativo: estadoVeh === ESTADO_OPERATIVO,
      matricula: txt(filaTop[P.MATRICULA - 1]),
      zona: txt(filaTop[P.ZONA - 1]),
      personas
    });
  }

  // ---- 3. Validaciones previas y días que cubre cada persona ----
  // Ocupación global, para detectar a la misma persona en dos coches a la vez.
  const ocupacionGlobal = new Map();   // "id|dia|turno" → Set(matriculas)
  // La misma persona NO puede estar en dos coches el mismo dia, aunque sea en
  // turnos distintos: son dos jornadas seguidas. La de arriba va por turno y
  // por eso se le escapaba el caso Dia en un coche + Noche en otro.
  const ocupacionDia = new Map();      // "id|dia" → Map(matricula → Set(turnos))
  const asignacionPorDia = new Map();  // id → [7] matrícula
  const problemas = [];                // se convierten en avisos más abajo

  // Matrículas repetidas: dos coches con la misma placa descuadran cualquier
  // asignación, porque la agenda no sabría a cuál se refiere.
  const vistasMatriculas = new Map();
  coches.forEach(coche => {
    if (!coche.matricula) return;
    if (vistasMatriculas.has(coche.matricula)) {
      problemas.push({
        tipo: 'matricula-duplicada', idx: coche.idx, matricula: coche.matricula,
        msg: `La matrícula ${coche.matricula} está en dos coches (posiciones ` +
             `${vistasMatriculas.get(coche.matricula) + 1} y ${coche.idx + 1})`
      });
    } else {
      vistasMatriculas.set(coche.matricula, coche.idx);
    }
  });

  coches.forEach(coche => {
    const nombreCoche = coche.matricula || '#' + (coche.idx + 1);

    // ---- 3a. Personas que no deben seguir en el planificador ----
    coche.personas.forEach(p => {
      if (!p.id) return;
      const info = porId.get(p.id);
      if (!info) return;

      // Vacaciones, bajas o suspensión: la plaza se libera. Se marca aquí y al
      // guardar se escribe vacío en la hoja.
      if (info.estado === 'Baja Empresa') {
        // Definitiva: se libera la plaza (y luego se archiva).
        p.retirar = true;
        p.motivoRetiro = info.estado;
        problemas.push({
          tipo: 'estado-retira', idx: coche.idx, matricula: coche.matricula, id: p.id,
          msg: `${info.nombre || p.id} está en "Baja Empresa": se libera su plaza en ` +
               `${nombreCoche} (${p.etiqueta}) y se borran sus días`
        });
      } else if (AUSENCIAS_TEMPORALES.includes(info.estado)) {
        // Temporal: NO se libera la plaza. Sigue en su sitio con su matrícula,
        // pero esos días el coche no sale hasta la reincorporación.
        const quien = info.nombre || p.id;
        const msg = info.reincorporacion
          ? `${quien} está en "${info.estado}" y se reincorpora el ${info.reincorporacion}: esos días ${nombreCoche} (${p.etiqueta}) no sale; organiza su cobertura.`
          : `${quien} está en "${info.estado}" y está planificado en ${nombreCoche} (${p.etiqueta}): añade la fecha de reincorporación.`;
        problemas.push({
          tipo: 'ausencia-temporal', idx: coche.idx, matricula: coche.matricula, id: p.id, msg
        });
      }

      // Ocupa plaza en un coche que no sale a la calle: sigue pendiente.
      if (!coche.operativo && !ESTADOS_ESPECIALES.includes(info.estado)) {
        problemas.push({
          tipo: 'coche-parado', idx: coche.idx, matricula: coche.matricula, id: p.id,
          msg: `${info.nombre || p.id} está en ${nombreCoche}, que no está operativo ` +
               `(${coche.estadoVeh || 'sin estado'}): sigue como pendiente de asignar`
        });
      }

      // Turno cruzado: un conductor de día no puede ocupar una plaza de noche.
      if (!info.turno) {
        problemas.push({
          tipo: 'sin-turno', idx: coche.idx, matricula: coche.matricula, id: p.id,
          msg: `${info.nombre || p.id} no tiene TURNO en la agenda: no se puede ` +
               `comprobar si encaja en ${nombreCoche} (${p.etiqueta})`
        });
      } else if (info.turno !== 'TodoTurno' && info.turno !== p.turno) {
        p.turnoIncorrecto = true;
        problemas.push({
          tipo: 'turno-cruzado', idx: coche.idx, matricula: coche.matricula, id: p.id,
          msg: `${info.nombre || p.id} es de turno ${info.turno} y está puesto en ` +
               `${p.etiqueta} de ${nombreCoche}: no cubre ese turno`
        });
      }
    });

    // ---- 3b. La misma persona repetida en el mismo coche ----
    const cuenta = new Map();
    coche.personas.forEach(p => {
      if (!p.id) return;
      cuenta.set(p.id, (cuenta.get(p.id) || 0) + 1);
    });
    cuenta.forEach((n, id) => {
      if (n > 1) {
        problemas.push({
          tipo: 'repetido-en-coche', idx: coche.idx, matricula: coche.matricula, id,
          msg: `${id} aparece ${n} veces en ${nombreCoche}: revisa si es intencionado`
        });
      }
    });

    // Los correturnos mandan: los días que ellos cubren se los quitan al fijo
    // del mismo turno, que es lo que hace que el binomio no duplique jornada.
    // Solo cuentan los que de verdad van a cubrirlos.
    const tomadosPorCT = { 'Día': Array(7).fill(false), 'Noche': Array(7).fill(false) };
    coche.personas.forEach(p => {
      if (!p.id || p.rol !== 'CT' || !p.diasManual) return;
      if (p.retirar || p.turnoIncorrecto || p.huerfano) return;
      const infoCT = porId.get(p.id);
      p.diasManual.forEach((v, d) => {
        if (!v) return;
        // Un CT fuera de su ventana de fecha (vacaciones, desde futuro, hasta
        // vencido) NO reserva el día: si no, se lo robaría al fijo y quedaría un
        // hueco fantasma que nadie cubre.
        if (!activoEnFecha(p, infoCT, fechasSemana[d]).activo) return;
        tomadosPorCT[p.turno][d] = true;
      });
    });

    const grid = {};   // "dia|turno" → [ids]

    coche.personas.forEach(p => {
      p.diasCubre = Array(7).fill(false);
      if (!p.id) return;

      const info = porId.get(p.id);
      if (!info) return;   // huérfano: no cubre nada, ya está marcado

      // Quien está de vacaciones o en el turno equivocado no cubre nada: así el
      // hueco aflora en vez de quedar tapado por alguien que no va a ir.
      if (p.retirar || p.turnoIncorrecto) {
        p.diasTexto = '';
        return;
      }

      // Turnos que ocupa esta persona: el de su plaza; salvo un fijo TodoTurno,
      // que ocupa día Y noche del mismo coche.
      let turnosCubre = [p.turno];

      if (p.rol === 'CT') {
        // El correturno cubre exactamente lo que tenga escrito, ni más ni menos.
        // Se registra el motivo de los días que NO cubre por fechas (pre-alta,
        // hasta vencido, ausente) igual que en los fijos: así el hueco se explica
        // ("entra el X") en vez de salir como "sin conductor" a secas.
        p.diasCubre = (p.diasManual ? p.diasManual.slice() : Array(7).fill(false))
          .map((v, d) => {
            if (!v) return false;
            const gate = activoEnFecha(p, info, fechasSemana[d]);
            if (!gate.activo) { (p.inactivoPorDia = p.inactivoPorDia || {})[d] = gate.motivo; return false; }
            return true;
          });

        if (!p.diasManual) {
          problemas.push({
            tipo: 'ct-sin-dias', idx: coche.idx, matricula: coche.matricula, id: p.id,
            msg: `${info.nombre || p.id} ocupa ${p.etiqueta} de ${nombreCoche} sin días asignados: no cubre nada`
          });
        } else {
          // Un correturno puesto a trabajar el día que libra según su agenda.
          const enLibranza = p.diasManual
            .map((v, d) => (v && info.libra[d] ? DIAS_SEM[d] : null))
            .filter(Boolean);
          if (enLibranza.length) {
            p.diasEnLibranza = enLibranza;
            problemas.push({
              tipo: 'trabaja-en-libranza', idx: coche.idx, matricula: coche.matricula, id: p.id,
              msg: `${info.nombre || p.id} tiene libranza el ${enLibranza.join(' y ')} ` +
                   `pero en ${nombreCoche} (${p.etiqueta}) se le asignan esos días`
            });
          }
        }
      } else {
        // Un FIJO parte SIEMPRE de su patrón de la agenda (todos sus días no-libranza):
        // la celda DIAS_TRABAJA de su fila NO se lee como restricción. Antes sí se leía,
        // y como guardarTablero persistía ahí los días COMPUTADOS (ya recortados por
        // pre-alta/ausencias), un fijo con alta a mitad de semana quedaba capado a esos
        // días PARA SIEMPRE (bug "Publio": alta el viernes → "V S D" eterno).
        const partida = info.trabaja;
        // Un estado especial (vacaciones, baja médica, suspensión…) o estar fuera
        // de su ventana de fecha significa que NO cubre esos días: se muestran como
        // hueco en el planificador, no como turno cubierto.
        p.diasCubre = partida.map((v, d) => v && !tomadosPorCT[p.turno][d]
          && activoEnFecha(p, info, fechasSemana[d]).activo);
        if (info.turno === 'TodoTurno') turnosCubre = ['Día', 'Noche'];
      }

      p.diasTexto = diasALetras(p.diasCubre);
      // Días CRUDOS asignados (lo que el usuario escribió en DIAS_TRABAJA). El input
      // editable del correturno debe mostrar ESTO, no diasTexto (los calculados): si
      // no, al guardar se re-envía la versión recortada por el Desde/Hasta y los días
      // se van borrando poco a poco.
      p.diasManualTexto = p.diasManual ? diasALetras(p.diasManual) : '';
      p.turnosCubre = turnosCubre;

      // Base de días antes de recortar por el CT de cada turno. Para el fijo, SIEMPRE
      // su patrón de la agenda (ver arriba: DIAS_TRABAJA no restringe a los fijos).
      const baseDias = p.rol === 'CT' ? p.diasCubre : info.trabaja;

      turnosCubre.forEach(turnoCubre => {
        baseDias.forEach((cubre, d) => {
          if (!cubre) return;
          // Ventana de fechas: no cuenta antes del alta/desde, tras el hasta, ni
          // durante una ausencia temporal (hasta la reincorporación).
          const gate = activoEnFecha(p, info, fechasSemana[d]);
          if (!gate.activo) {
            (p.inactivoPorDia = p.inactivoPorDia || {})[d] = gate.motivo;
            return;
          }
          // El correturno del turno manda sobre el fijo (incluido el TodoTurno).
          if (p.rol !== 'CT' && tomadosPorCT[turnoCubre][d]) return;

          const key = `${d}|${turnoCubre}`;
          (grid[key] = grid[key] || []).push(p.id);

          // Un coche en taller, siniestrado o de baja no cuenta: quien esté en él
          // sigue como "Pendiente Asignar" y no recibe ni días ni matrícula.
          if (!coche.operativo) return;

          if (coche.matricula) {
            if (!asignacionPorDia.has(p.id)) asignacionPorDia.set(p.id, Array(7).fill(''));
            const asg = asignacionPorDia.get(p.id);
            if (!asg[d]) asg[d] = coche.matricula;
          }

          const nombreC = coche.matricula || `coche#${coche.idx + 1}`;
          const gk = `${p.id}|${d}|${turnoCubre}`;
          if (!ocupacionGlobal.has(gk)) ocupacionGlobal.set(gk, new Set());
          ocupacionGlobal.get(gk).add(nombreC);

          const dk = `${p.id}|${d}`;
          if (!ocupacionDia.has(dk)) ocupacionDia.set(dk, new Map());
          const porCoche = ocupacionDia.get(dk);
          if (!porCoche.has(nombreC)) porCoche.set(nombreC, new Set());
          porCoche.get(nombreC).add(turnoCubre);
        });
      });
    });

    coche._grid = grid;
  });

  // Se declara aquí (y no en la sección 4) porque el bloque 3c de abajo ya
  // empuja avisos; con const, usarla antes de declararla la deja en la zona
  // muerta temporal y reventaría todo el cálculo.
  const avisos = [];

  // ---- 3c. Alertas de fechas ----
  // Vencimientos (avisar un día antes y el día), altas futuras y
  // reincorporaciones que ya pasaron pero el estado sigue en ausencia.
  const UN_DIA = 86400000;
  const fmtF = d => d
    ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    : '';
  coches.forEach(coche => {
    coche.personas.forEach(p => {
      if (!p.id) return;
      const info = porId.get(p.id);
      const quien = (info && info.nombre) || p.id;
      const nombreCoche = coche.matricula || '#' + (coche.idx + 1);

      if (p.hastaD) {
        const dif = Math.round((p.hastaD - fechaHoy) / UN_DIA);
        if (dif === 1) avisos.push({ tipo: 'fecha-hasta-manana', matricula: coche.matricula, id: p.id,
          msg: `${quien} deja ${p.etiqueta} de ${nombreCoche} MAÑANA (${fmtF(p.hastaD)}): reasignar` });
        else if (dif === 0) avisos.push({ tipo: 'fecha-hasta-hoy', matricula: coche.matricula, id: p.id,
          msg: `${quien} deja ${p.etiqueta} de ${nombreCoche} HOY (${fmtF(p.hastaD)}): reasignar` });
        else if (dif < 0) avisos.push({ tipo: 'fecha-hasta-vencida', matricula: coche.matricula, id: p.id,
          msg: `La asignación de ${quien} en ${nombreCoche} (${p.etiqueta}) venció el ${fmtF(p.hastaD)}` });
      }

      if (info && info.fechaAltaD && info.fechaAltaD > fechaHoy) {
        avisos.push({ tipo: 'fecha-alta-futura', matricula: coche.matricula, id: p.id,
          msg: `${quien} en ${nombreCoche} (${p.etiqueta}) se incorpora el ${fmtF(info.fechaAltaD)}: aún no cuenta` });
      }

      if (info && info.ausenteTemporal && info.reincorporacionD && info.reincorporacionD <= fechaHoy) {
        avisos.push({ tipo: 'fecha-reincorporacion-pasada', matricula: coche.matricula, id: p.id,
          msg: `${quien} debía reincorporarse el ${fmtF(info.reincorporacionD)} pero sigue en "${info.estado}": revisar estado` });
      }
    });
  });

  // ---- 4. Huecos, solapes y resumen ----
  const salen = { 'Día': Array(7).fill(0), 'Noche': Array(7).fill(0) };
  const estadoAutos = { '✓': 0, 'X': 0, 'T': 0, 'S': 0, 'R': 0, 'B': 0 };
  // avisos ya está declarado más arriba (antes de la sección 3c).

  coches.forEach(coche => {
    if (coche.estadoVeh && estadoAutos[coche.estadoVeh] !== undefined) {
      estadoAutos[coche.estadoVeh]++;
    }

    coche.huecos = [];
    coche.conflictos = [];
    coche.avisos = [];   // no bloqueantes (p. ej. trabaja en su libranza): solo avisan
    coche.preAltas = []; // días sin salir porque el asignado entra más tarde (alta/Desde futuro)

    const nombreCoche = coche.matricula || '#' + (coche.idx + 1);
    coche.personas.forEach(p => {
      if (p.huerfano) {
        avisos.push({
          tipo: 'huerfano',
          matricula: coche.matricula,
          id: p.id,
          msg: `El ID "${p.id}" del coche ${nombreCoche} no existe en la agenda`
        });
      }
      if (p.diasIlegibles) {
        avisos.push({
          tipo: 'dias-ilegibles',
          matricula: coche.matricula,
          id: p.id,
          msg: `Coche ${nombreCoche}, ${p.etiqueta}: "${p.diasIlegibles}" no se entiende como días. ` +
               `Usa las letras L M X J V S D (ej. "S D"). No se cuenta ningún día.`
        });
      }
    });

    // Los problemas detectados arriba marcan el coche en rojo. Se listan en sus
    // conflictos para que se vean en la propia tarjeta, no solo en los avisos.
    problemas
      .filter(x => x.idx === coche.idx)
      .forEach(x => {
        if (['turno-cruzado', 'estado-retira', 'matricula-duplicada'].includes(x.tipo)) {
          coche.conflictos.push({ tipo: x.tipo, msg: x.msg });
        } else if (x.tipo === 'trabaja-en-libranza') {
          // NO bloquea: el conductor PUEDE trabajar su día de libranza (se le añade
          // como CT). Solo se avisa por si es un despiste; el día SÍ cuenta en la
          // cobertura y el coche no queda en "Error".
          coche.avisos.push({ tipo: x.tipo, msg: x.msg });
        }
      });

    if (!coche.operativo) return;

    for (let d = 0; d < 7; d++) {
      TURNOS.forEach(turno => {
        const lista = coche._grid[`${d}|${turno}`] || [];

        if (lista.length > 1) {
          coche.conflictos.push({
            dia: DIAS_SEM[d], turno,
            msg: `${DIAS_SEM[d]} ${turno}: ${lista.length} conductores a la vez (${lista.join(', ')})`
          });
        }

        lista.forEach(id => {
          const matrs = ocupacionGlobal.get(`${id}|${d}|${turno}`);
          if (matrs && matrs.size > 1) {
            coche.conflictos.push({
              dia: DIAS_SEM[d], turno,
              msg: `${id} está en ${matrs.size} coches el ${DIAS_SEM[d]} ${turno} (${[...matrs].join(', ')})`
            });
          }
          // Y el mismo día en dos coches distintos aunque sea en turnos
          // distintos: nadie hace un día y una noche seguidos.
          const porCoche = ocupacionDia.get(`${id}|${d}`);
          if (porCoche && porCoche.size > 1 && !(matrs && matrs.size > 1)) {
            const detalle = [...porCoche.entries()]
              .map(([m, turnos]) => `${m} (${[...turnos].join('/')})`).join(' y ');
            const quien = (porId.get(id) || {}).nombre || id;
            coche.conflictos.push({
              dia: DIAS_SEM[d], turno,
              msg: `${quien} está el ${DIAS_SEM[d]} en dos coches: ${detalle}`
            });
          }
        });

        if (lista.length === 0) {
          const etiqueta = `(${turno === 'Día' ? 'D' : 'N'}) ${DIAS_SEM[d]}`;
          // ¿El hueco lo explica alguien YA asignado que entra MÁS TARDE (fecha de
          // alta futura o "Desde" de la asignación)? Entonces la plaza NO está libre:
          // el coche no sale ese día, pero no hay que buscar a nadie. No cuenta como
          // "libre" ni marca el coche como incompleto; se avisa abajo (ámbar).
          const pPre = coche.personas.find(x => x.id && x.inactivoPorDia && x.inactivoPorDia[d] === 'pre-alta' &&
            (x.turno === turno || (x.turnosCubre && x.turnosCubre.includes(turno))));
          if (pPre) coche.preAltas.push({ dia: d, turno, etiqueta, id: pPre.id, p: pPre });
          else coche.huecos.push({ dia: d, turno, etiqueta });
        } else {
          salen[turno][d]++;
        }
      });
    }

    // Un aviso por cada persona que entra más tarde, con sus días agrupados.
    const prePorPersona = new Map();
    coche.preAltas.forEach(h => {
      if (!prePorPersona.has(h.id)) prePorPersona.set(h.id, { p: h.p, dias: [] });
      prePorPersona.get(h.id).dias.push(h.etiqueta);
    });
    prePorPersona.forEach(({ p, dias }) => {
      const info = porId.get(p.id);
      const cand = [p.desdeD, info && info.fechaAltaD].filter(Boolean);
      const desde = cand.length ? new Date(Math.max.apply(null, cand.map(x => x.getTime()))) : null;
      coche.avisos.push({
        tipo: 'pre-alta',
        msg: `${(info && info.nombre) || p.id} se incorpora el ${fmtF(desde)}: hasta entonces ${dias.join(' · ')} sin salir (la plaza ya es suya, no cuenta como libre)`
      });
    });

    coche.hayError = coche.conflictos.length > 0;
    coche.numLibres = coche.hayError ? 0 : coche.huecos.length;
    coche.textoLibres = coche.hayError
      ? 'Error'
      : (coche.huecos.length ? coche.huecos.map(h => h.etiqueta).join('  ·  ') : 'Completo');
  });

  coches.forEach(coche => {
    if (coche.operativo) return;
    coche.hayError = false;
    coche.numLibres = 0;
    coche.textoLibres = '';
  });

  // Todo lo detectado en las validaciones sube a la lista de avisos.
  problemas.forEach(x => avisos.push(x));

  // ---- 5. Estado derivado de cada conductor ----
  const matriculaPrincipal = new Map();
  const binomio = new Map();

  coches.forEach(coche => {
    if (!coche.matricula || !coche.operativo) return;
    const idDia = coche.personas[0].id;
    const idNoche = coche.personas[1].id;
    coche.personas.forEach(p => {
      if (p.id && !matriculaPrincipal.has(p.id)) matriculaPrincipal.set(p.id, coche.matricula);
    });
    if (idDia) binomio.set(idDia, idNoche || '');
    if (idNoche) binomio.set(idNoche, idDia || '');
  });

  // Ventanas de presencia de cada conductor = Desde/Hasta de TODAS sus plazas (puede
  // estar en dos coches con fechas que se relevan). Sirve para NO marcarlo "Pendiente"
  // por días fuera de su ventana: los previos a su primer "Desde" (aún no llega) o
  // posteriores a su "Hasta" (ya se fue) son transiciones planificadas, no huecos suyos.
  // Un conductor SIN plaza sí necesita coche para toda su semana.
  const ventanasPorConductor = new Map();
  coches.forEach(coche => coche.personas.forEach(p => {
    if (!p.id) return;
    if (!ventanasPorConductor.has(p.id)) ventanasPorConductor.set(p.id, []);
    ventanasPorConductor.get(p.id).push({ desdeD: p.desdeD, hastaD: p.hastaD });
  }));

  conductores.forEach(info => {
    const asg = asignacionPorDia.get(info.id) || Array(7).fill('');
    info.matricula = matriculaPrincipal.get(info.id) || '';
    info.binomio = binomio.get(info.id) || '';
    info.asignacion = info.libra.map((libra, d) => (libra ? 'L' : (asg[d] || '')));

    // Activo solo si cada día laborable DENTRO de su ventana de presencia tiene
    // coche. Los días fuera de ventana (antes de su "Desde" o después de su "Hasta")
    // no cuentan como hueco suyo: son transiciones (relevo, salida por vacaciones…).
    // Los estados especiales (vacaciones, bajas, suspendido) los pone una persona.
    const especial = ESTADOS_ESPECIALES.includes(info.estado);
    const ventanas = ventanasPorConductor.get(info.id) || [];
    const tienePlaza = ventanas.length > 0;

    // ¿El día d entra en alguna ventana Desde/Hasta del conductor? El "desde" efectivo
    // es el más tardío entre su alta y el Desde de la asignación (igual que activoEnFecha).
    // Sin plaza, todos sus días laborables cuentan: necesita coche.
    const dentroVentana = d => !tienePlaza || ventanas.some(w => {
      const cand = [w.desdeD, info.fechaAltaD].filter(Boolean);
      const desdeEff = cand.length ? new Date(Math.max.apply(null, cand.map(x => x.getTime()))) : null;
      return (!desdeEff || fechasSemana[d] >= desdeEff) && (!w.hastaD || fechasSemana[d] <= w.hastaD);
    });

    let esperados = 0, cubiertos = 0;
    info.libra.forEach((libra, d) => {
      if (libra || !dentroVentana(d)) return;   // libranza o fuera de ventana: no cuenta
      esperados++;
      if (asg[d]) cubiertos++;
    });

    info.diasLaborables = esperados;
    info.diasCubiertos = cubiertos;
    info.estadoCalculado = info.estado;

    // Solo se recalcula si es planificable y se le espera algún día (dentro de ventana).
    // Sin días esperados (p. ej. una asignación que empieza la semana que viene) se
    // respeta su estado de la hoja: no se marca "Pendiente" por adelantado.
    if (info.idBolt && !especial && esperados > 0) {
      info.estadoCalculado = cubiertos === esperados ? ESTADO_ACTIVO : ESTADO_PENDIENTE;
    }
    info.estadoCambia = info.estadoCalculado !== info.estado;

    // Qué le falta para poder trabajar. Sin ID de Bolt o sin turno no se puede
    // ni planificar; sin coordenadas no entra en el matching por zona.
    const faltan = [];
    // El alta en BOLT es un AVISO, no un impedimento.
    //
    // Antes sin ID de Bolt no se podía planificar, porque no había clave con la
    // que escribir en el cuadrante. Ahora la agenda siempre da una —el nombre de
    // la persona si no hay cuenta— así que el coche sale igual y aquí solo se
    // deja dicho que falta el trámite, que es de RRHH.
    if (info.boltPendiente) faltan.push('alta en BOLT');
    if (!info.idBolt) faltan.push('ID de Bolt');
    if (!info.turno) faltan.push('turno');
    if (!parseCoords(info.coordenadas)) faltan.push('coordenadas');
    if (!info.dni) faltan.push('DNI/NIE');
    if (!info.telefono) faltan.push('teléfono');
    info.faltan = faltan;
    info.listoParaPlanificar = Boolean(info.idBolt && info.turno);
  });

  // ---- 6. Matching contra bases ----
  const pendientes = conductores
    .filter(c => c.estadoCalculado === ESTADO_PENDIENTE)
    .map(c => {
      const coord = parseCoords(c.coordenadas);
      if (!coord || !bases.length) {
        return { ...c, distancias: [], baseCercana: null, sinCoordenadas: !coord };
      }
      const distancias = bases.map(b => ({
        nombre: b.nombre,
        km: Math.round(haversine(coord.lat, coord.lng, b.lat, b.lng) * 100) / 100
      })).sort((a, b) => a.km - b.km);
      return { ...c, distancias, baseCercana: distancias[0], sinCoordenadas: false };
    });

  // ---- 7. Demanda, global y por zona ----
  // Por zona es lo que sirve para reclutar: saber que faltan 2 correturnos de
  // día en Getafe es accionable; saber que faltan 9 en total, no tanto.
  const demanda = { coches: 0, fijosDia: 0, fijosNoche: 0, ctDia: 0, ctNoche: 0, huecos: 0, conError: 0 };
  const porZona = new Map();

  const sumar = (acc, coche) => {
    acc.coches++;
    if (!coche.personas[0].id) acc.fijosDia++;
    if (!coche.personas[1].id) acc.fijosNoche++;
    if (!coche.personas[2].id && !coche.personas[4].id) acc.ctDia++;
    if (!coche.personas[3].id && !coche.personas[5].id) acc.ctNoche++;
    acc.huecos += coche.numLibres || 0;
    if (coche.hayError) acc.conError++;
  };

  coches.forEach(coche => {
    if (!coche.operativo) return;

    sumar(demanda, coche);

    const zona = coche.zona || '(sin zona)';
    if (!porZona.has(zona)) {
      porZona.set(zona, {
        zona, coches: 0, fijosDia: 0, fijosNoche: 0,
        ctDia: 0, ctNoche: 0, huecos: 0, conError: 0
      });
    }
    sumar(porZona.get(zona), coche);
  });

  // Conductores libres por zona: solo cuentan los pendientes, y su zona es la
  // del coche donde ya estén (un correturno a medio asignar sigue disponible).
  const zonaDeConductor = new Map();
  coches.forEach(coche => {
    if (!coche.zona) return;
    coche.personas.forEach(p => {
      if (p.id && !zonaDeConductor.has(p.id)) zonaDeConductor.set(p.id, coche.zona);
    });
  });

  const demandaPorZona = [...porZona.values()]
    .map(z => {
      // demanda.coches lo suma `sumar`, pero aquí sobra el contador global
      const pendientes = conductores.filter(c =>
        c.estadoCalculado === ESTADO_PENDIENTE && zonaDeConductor.get(c.id) === z.zona);
      return {
        ...z,
        disponiblesDia: pendientes.filter(c => c.turno === 'Día').length,
        disponiblesNoche: pendientes.filter(c => c.turno === 'Noche').length,
        totalFaltan: z.fijosDia + z.fijosNoche + z.ctDia + z.ctNoche
      };
    })
    .sort((a, b) => b.totalFaltan - a.totalFaltan);

  // ---- 7bis. Cobertura semanal y relevos ----
  // La semana de un coche son 14 tramos encadenados (7 días × día/noche). Un
  // relevo es el paso de un tramo al siguiente cambiando de conductor: es lo
  // que hay que saber para decirle a cada uno a quién le entrega las llaves.
  const nombreDe = id => (porId.get(id) ? porId.get(id).nombre : '') || id;

  coches.forEach(coche => {
    const tramos = [];
    for (let d = 0; d < 7; d++) {
      TURNOS.forEach(turno => {
        const lista = coche._grid[`${d}|${turno}`] || [];
        // Qué plaza ocupa quien conduce ese tramo (Día, CT1 Noche…)
        const persona = coche.personas.find(p => p.id && lista.includes(p.id) && p.turno === turno);
        tramos.push({
          dia: d,
          diaNombre: DIAS_SEM[d],
          turno,
          ids: lista,
          id: lista.length === 1 ? lista[0] : null,
          nombre: lista.length === 1 ? nombreDe(lista[0]) : '',
          plaza: persona ? persona.etiqueta : '',
          vacio: lista.length === 0,
          conflicto: lista.length > 1
        });
      });
    }
    coche.semana = tramos;

    if (!coche.operativo) { coche.relevos = []; return; }

    // Se recorre la semana enlazando cada tramo ocupado con el anterior
    // ocupado. Si por medio quedaron tramos vacíos, el coche estuvo parado y se
    // dice, porque el que entra no lo recibe en mano: lo recoge donde quedó.
    const relevos = [];
    const ocupados = tramos.map((t, i) => ({ ...t, i })).filter(t => t.id);

    ocupados.forEach((tramo, n) => {
      const anterior = n === 0 ? ocupados[ocupados.length - 1] : ocupados[n - 1];
      if (!anterior || anterior.id === tramo.id) return;

      // Huecos entre ambos: si el índice no es consecutivo (con vuelta al
      // principio en el cierre de semana), el coche se quedó parado.
      const salto = (tramo.i - anterior.i + tramos.length) % tramos.length;
      relevos.push({
        matricula: coche.matricula,
        zona: coche.zona,
        entrega: { id: anterior.id, nombre: anterior.nombre, plaza: anterior.plaza, dia: anterior.diaNombre, turno: anterior.turno },
        recibe: { id: tramo.id, nombre: tramo.nombre, plaza: tramo.plaza, dia: tramo.diaNombre, turno: tramo.turno },
        directo: salto === 1,
        tramosParado: salto - 1,
        cierraSemana: n === 0
      });
    });

    coche.relevos = relevos;
  });

  // Por qué un coche no sale: estado del vehículo (no operativo) o falta de
  // conductor ese día. El motivo va en cada entrada para poder verlo al abrir.
  const MOTIVO_VEH = { S: 'Siniestro', T: 'Transporte', X: 'En taller', R: 'Reservado', B: 'Baja' };

  // Si un día/turno queda vacío porque su titular está fuera por FECHA (alta
  // futura, baja hasta X, asignación vencida), lo explica en el hueco.
  function motivoHuecoFecha(coche, d, turno) {
    const p = coche.personas.find(x => x.id && x.inactivoPorDia && x.inactivoPorDia[d] &&
      (x.turno === turno || (x.turnosCubre && x.turnosCubre.includes(turno))));
    if (!p) return null;
    const info = porId.get(p.id);
    const quien = (info && info.nombre) || p.id;
    const cod = p.inactivoPorDia[d];
    if (cod === 'pre-alta') return { tipo: 'titular-pre-alta',
      motivo: `${quien} aún no incorporado${info && info.fechaAltaD ? ` (alta ${fmtF(info.fechaAltaD)})` : ''}` };
    if (cod === 'ausente') return { tipo: 'titular-ausente',
      motivo: `${quien} en ${info ? info.estado : 'ausencia'}${info && info.reincorporacionD ? ` hasta ${fmtF(info.reincorporacionD)}` : ''}` };
    if (cod === 'hasta-vencido') return { tipo: 'asignacion-vencida',
      motivo: `Asignación de ${quien} terminó${p.hastaD ? ` el ${fmtF(p.hastaD)}` : ''}` };
    return null;
  }

  // Cobertura por día y turno, para responder "¿quién sale el sábado de noche?"
  const cobertura = [];
  for (let d = 0; d < 7; d++) {
    TURNOS.forEach(turno => {
      const enCalle = [];
      const sinConductor = [];
      coches.forEach(coche => {
        if (!coche.matricula) return;
        // No operativo: solo se muestran los de Transporte (T). Siniestro,
        // taller, reservado y baja se sabe que no salen y no ensucian la lista.
        if (!coche.operativo) {
          if (coche.estadoVeh === 'T') {
            sinConductor.push({ matricula: coche.matricula, zona: coche.zona, tipo: 'vehiculo', motivo: 'Transporte' });
          }
          return;
        }
        const tramo = coche.semana[d * 2 + TURNOS.indexOf(turno)];
        if (tramo.id) enCalle.push({ matricula: coche.matricula, zona: coche.zona, id: tramo.id, nombre: tramo.nombre, plaza: tramo.plaza });
        else if (tramo.conflicto) sinConductor.push({ matricula: coche.matricula, zona: coche.zona, tipo: 'conflicto', motivo: 'Conflicto de asignación' });
        else {
          const ficha = motivoHuecoFecha(coche, d, turno);
          sinConductor.push({
            matricula: coche.matricula, zona: coche.zona,
            tipo: ficha ? ficha.tipo : 'sin_conductor',
            motivo: ficha ? ficha.motivo : 'Sin conductor asignado ese día'
          });
        }
      });
      cobertura.push({
        dia: d, diaNombre: DIAS_SEM[d], turno,
        enCalle: enCalle.sort((a, b) => a.matricula.localeCompare(b.matricula)),
        sinConductor: sinConductor.sort((a, b) => a.matricula.localeCompare(b.matricula))
      });
    });
  }

  // ---- 8. Sugerencias: cruzar quién está libre con dónde falta gente ----
  // Una tabla de distancias no dice qué hacer; esto sí: para cada conductor
  // pendiente, las zonas que tienen hueco EN SU TURNO, de más cerca a más lejos.
  // Plazas vacías concretas por zona y turno, no un simple contador: hacen
  // falta la matrícula y el slot para poder asignar desde la propia pantalla.
  const plazasPorZonaTurno = new Map();   // "zona|turno" → [{coche, matricula, slot…}]
  coches.forEach(coche => {
    if (!coche.operativo || !coche.zona) return;
    coche.personas.forEach(p => {
      if (p.id) return;
      const k = `${coche.zona}|${p.turno}`;
      if (!plazasPorZonaTurno.has(k)) plazasPorZonaTurno.set(k, []);
      plazasPorZonaTurno.get(k).push({
        coche: coche.idx,
        matricula: coche.matricula,
        slot: p.slot,
        etiqueta: p.etiqueta,
        rol: p.rol,
        // Días que ese coche tiene sin cubrir en este turno
        huecos: coche.huecos.filter(h => h.turno === p.turno).map(h => h.dia)
      });
    });
  });

  const sugerencias = pendientes.map(c => {
    const opciones = c.distancias
      .map(d => {
        const plazas = (plazasPorZonaTurno.get(`${d.nombre}|${c.turno}`) || []).map(pl => ({
          ...pl,
          // Para un correturno se propone cubrir los huecos del coche que esa
          // persona puede hacer de verdad, quitando sus días de libranza.
          diasSugeridos: pl.rol === 'CT'
            ? diasALetras(Array.from({ length: 7 }, (_, d2) =>
                pl.huecos.includes(d2) && c.trabaja[d2]))
            : ''
        }));
        return { zona: d.nombre, km: d.km, plazasLibres: plazas.length, plazas };
      })
      .filter(o => o.plazasLibres > 0);

    return {
      id: c.id,
      nombre: c.nombre,
      turno: c.turno,
      contrato: c.contrato,
      telefono: c.telefono,
      diasLibres: c.diasLaborables - c.diasCubiertos,
      sinCoordenadas: c.sinCoordenadas,
      opciones,
      mejor: opciones[0] || null
    };
  }).sort((a, b) => {
    // Primero quien tiene una opción clara y cerca; al final, los que no
    // encajan en ningún sitio (por coordenadas o porque no hay plazas).
    if (!a.mejor && !b.mejor) return 0;
    if (!a.mejor) return 1;
    if (!b.mejor) return -1;
    return a.mejor.km - b.mejor.km;
  });

  // Titulares que SIGUEN en su plaza estando de Vacaciones / Baja Médica / etc. (aún
  // no se les ha quitado): esos turnos NO salen hasta que vuelvan o se libere la plaza.
  // Se listan aparte para destacarlos en Cobertura.
  const ausentesEnPlaza = [];
  coches.forEach(coche => {
    if (!coche.matricula || !coche.operativo) return;
    coche.personas.forEach(p => {
      if (!p.id) return;
      const info = porId.get(p.id);
      if (!info || !info.ausenteTemporal) return;
      const dias = p.inactivoPorDia
        ? Object.keys(p.inactivoPorDia).filter(d => p.inactivoPorDia[d] === 'ausente')
            .map(Number).sort((a, b) => a - b).map(d => DIAS_SEM[d])
        : [];
      ausentesEnPlaza.push({
        matricula: coche.matricula, zona: coche.zona || '',
        plaza: p.etiqueta, turno: p.turno,
        id: p.id, nombre: info.nombre || p.id,
        estado: info.estado,
        reincorporacion: info.reincorporacion || '',
        dias
      });
    });
  });

  return {
    coches,
    conductores,
    pendientes,
    sugerencias,
    cobertura,
    ausentesEnPlaza,
    bases,
    avisos,
    semanaInfo: {
      offset: offsetSemana,
      esActual: offsetSemana === 0,
      inicio: lunesSemana,
      fin: fechasSemana[6]
    },
    resumen: {
      salen,
      estadoAutos,
      demanda,
      demandaPorZona,
      cochesOperativos: estadoAutos['✓'],
      totalHuecos: coches.reduce((n, c) => n + (c.numLibres || 0), 0),
      cochesConError: coches.filter(c => c.hayError).length
    }
  };
}

// ============================================================
// LECTURA / ESCRITURA CONTRA LA HOJA
// ============================================================


const ULTIMA_FILA_PLAN = PLAN_FILA_INI + N_MAT * FILAS_POR_COCHE - 1;

/** Número de columna (1-based) → letra: 1→A, 27→AA */
function colLetra(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - m) / 26);
  }
  return s;
}

/**
 * Comprueba que la hoja real tiene el layout que espera el motor. Se ejecuta
 * antes de escribir nada: si alguien movió una columna, es preferible parar con
 * un mensaje claro que machacar datos en el sitio equivocado.
 */
function validarEsquema(agendaFilas, planFilas) {
  const problemas = [];

  const cabAgenda = agendaFilas[0] || [];
  A_HEADERS.forEach((esperado, i) => {
    const real = txt(cabAgenda[i]);
    if (real !== esperado) {
      problemas.push(`AGENDA_V2 columna ${colLetra(i + 1)}: se esperaba "${esperado}" y hay "${real}"`);
    }
  });

  const cabPlan = planFilas[0] || [];
  P_HEADERS.forEach((esperado, i) => {
    const real = txt(cabPlan[i]);
    if (real !== esperado) {
      problemas.push(`PLANIFICADOR_V2 columna ${colLetra(i + 1)}: se esperaba "${esperado}" y hay "${real}"`);
    }
  });

  // La primera fila de datos debe ser el slot "Día" del primer coche.
  const primerTurno = txt((planFilas[1] || [])[P.TURNO - 1]);
  if (primerTurno && primerTurno !== SLOTS[0].etiqueta) {
    problemas.push(`PLANIFICADOR_V2 fila ${PLAN_FILA_INI}: se esperaba TURNO "${SLOTS[0].etiqueta}" y hay "${primerTurno}"`);
  }

  return { ok: problemas.length === 0, problemas };
}

/**
 * LOS CONDUCTORES SALEN DE POSTGRESQL. Punto.
 *
 * Esto vivió detrás de la variable `AGENDA_ORIGEN`, apagada por defecto, y tenía
 * sentido mientras la base no estaba lista: de esta función cuelgan la
 * cobertura, el control de horas, el bot y las nóminas, y poder volver atrás sin
 * desplegar valía más que ahorrarse la variable.
 *
 * Ya no. La variable se quita (15/09/2026) porque mantenerla cuesta más de lo
 * que protege:
 *
 *   · LA HOJA YA NO SE EDITA. `/agenda` era la única pantalla que escribía en
 *     AGENDA_V2 y se borró: hoy el turno, la libranza y el coche se tocan en
 *     Plantilla y en el planificador, que escriben en la base. Volver a la hoja
 *     sería volver a una foto que ya nadie actualiza — o sea, no es una vuelta
 *     atrás, es leer datos viejos creyendo que son los de hoy.
 *   · UN INTERRUPTOR QUE NADIE VA A ACCIONAR ES UNA RAMA QUE NADIE PRUEBA. Con
 *     dos caminos, el que no se usa se pudre en silencio y el día que hiciera
 *     falta tampoco funcionaría.
 *
 * Si la base falla, esto REVIENTA en vez de seguir con una agenda vacía: eso
 * dejaría a todo el mundo sin turno ni libranzas y el planificador lo daría por
 * bueno. Un error ruidoso es mejor que un cuadrante en blanco que parece cierto.
 *
 * Y DESDE EL 15/09/2026, EL PLANIFICADOR Y LAS BASES TAMPOCO SE LEEN DE GOOGLE.
 * Esta función ya no abre el libro: los conductores salen de `repo/agenda`, y
 * los coches, sus plazas y las zonas del módulo de Planificación, que es donde
 * viven de verdad desde la migración.
 *
 * La hoja `PLANIFICADOR_V2` era, a estas alturas, una COPIA: el cuadrante que se
 * usa a diario ya estaba en PostgreSQL —35 cuadrantes, 600 plazas, 459
 * asignaciones— y la hoja solo servía para alimentar a este motor. Dos fuentes
 * para el mismo dato, y una de ellas sin nadie que la actualizara.
 *
 * Se siguen produciendo FILAS con la forma de la hoja a propósito:
 * `calcularTablero` son mil líneas de reglas probadas contra 87 coches, y
 * reescribirlas para que lean otra forma es justo el cambio que no se puede
 * revisar de un vistazo. La forma rara vive en `Planificacion/hoja.repo`, en un
 * solo sitio, y se tira entera el día que este motor muera.
 */
async function leerCrudo() {
  const plani = require('../modules/Planificacion/tablero.service');
  const [agendaFilas, planFilas, bases] = await Promise.all([
    require('./repo/agenda').filas().catch(e => {
      throw new Error(`No se pudo leer la agenda de PostgreSQL: ${e.message}`);
    }),
    plani.filasDeHoja({ P, cabecera: P_HEADERS, porCoche: FILAS_POR_COCHE, maxCoches: N_MAT })
      .catch(e => { throw new Error(`No se pudo leer el cuadrante de PostgreSQL: ${e.message}`); }),
    // Las zonas son para calcular a qué base le pilla más cerca cada conductor.
    // Si fallan, el tablero sale igual y solo se queda sin esa sugerencia: no
    // vale la pena tumbar el cuadrante entero por una distancia.
    plani.basesDeZona().catch(e => {
      console.error('⚠️ [PLANIFICADOR] No se pudieron leer las zonas:', e.message);
      return [];
    }),
  ]);

  return {
    agendaFilas,
    planFilas,
    bases,
    origenAgenda: 'postgres',
    esquema: validarEsquema(agendaFilas, planFilas),
  };
}

/** Lee y devuelve el tablero ya calculado. */
async function leerTablero(opciones = {}) {
  const crudo = await leerCrudo();
  // LAS REINCORPORACIONES YA VIENEN EN LA AGENDA. Antes se sacaban releyendo la
  // hoja VISTA_FINAL para ver dónde se acababan las letras V/B/P. Ahora la
  // ausencia es un tramo con fecha de fin en PostgreSQL, y `v_agenda` la trae
  // ya en la columna REINCORPORACION (= `hasta_previsto`). No hay nada que
  // deducir ni una segunda fuente que pueda decir otra cosa.
  const tablero = calcularTablero(crudo.agendaFilas.slice(1), crudo.planFilas.slice(1), crudo.bases, opciones);
  tablero.esquema = crudo.esquema;
  return tablero;
}

/**
 * Aplica los cambios de la interfaz sobre las filas crudas del planificador.
 *
 * Se trabaja sobre una lectura FRESCA de la hoja, no sobre lo que tenía la
 * pantalla del navegador: así, si alguien tocó otro coche mientras tanto, no se
 * lo pisamos. Solo se sobrescribe lo que el usuario ha cambiado de verdad.
 */
/** Hoy en dd/mm/aaaa, que es el formato con el que se escribe en la hoja. */
function hoyDDMMAAAA() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function aplicarCambios(planFilas, cambios) {
  const datos = planFilas.slice(1);   // sin la cabecera
  const aplicados = [];

  (cambios || []).forEach(cambio => {
    const c = Number(cambio.coche);
    if (!Number.isInteger(c) || c < 0 || c >= N_MAT) {
      throw new Error(`Índice de coche fuera de rango: ${cambio.coche}`);
    }
    const base = c * FILAS_POR_COCHE;

    const asegurarFila = i => {
      while (datos.length <= i) datos.push([]);
      if (!datos[i]) datos[i] = [];
      while (datos[i].length < P_HEADERS.length) datos[i].push('');
      return datos[i];
    };

    if (cambio.estadoVeh !== undefined) {
      asegurarFila(base)[P.ESTADO_VEH - 1] = txt(cambio.estadoVeh);
    }
    if (cambio.matricula !== undefined) {
      asegurarFila(base)[P.MATRICULA - 1] = txt(cambio.matricula);
    }
    if (cambio.zona !== undefined) {
      asegurarFila(base)[P.ZONA - 1] = txt(cambio.zona);
    }

    (cambio.slots || []).forEach(s => {
      const k = Number(s.slot);
      if (!Number.isInteger(k) || k < 0 || k >= FILAS_POR_COCHE) {
        throw new Error(`Slot fuera de rango: ${s.slot}`);
      }
      const fila = asegurarFila(base + k);
      if (s.id !== undefined) {
        fila[P.ID_BOLT - 1] = txt(s.id);
        // Al quitar al conductor se van sus días con él: si se quedaran, el
        // siguiente que entre heredaría una jornada que nadie le ha asignado.
        if (!txt(s.id)) fila[P.DIAS_TRABAJA - 1] = '';
      }
      if (s.dias !== undefined && SLOTS[k].rol === 'CT') {
        // Solo los CORRETURNOS tienen días manuales. Para un FIJO se ignora lo que
        // llegue: sus días son su patrón de libranza de la agenda, y aceptar texto
        // aquí era una vía para capar a un fijo sin querer (bug "Publio").
        // Se rechaza aquí, no en la hoja: quien está escribiendo ve el error en
        // el momento, en vez de descubrir semanas después que a ese coche le
        // faltaba un turno porque su texto no se entendió.
        const analisis = analizarDias(s.dias);
        if (!analisis.valido) {
          throw new Error(
            `Coche ${c + 1}, ${SLOTS[k].etiqueta}: "${analisis.texto}" no se entiende como días. ` +
            `Usa las letras L M X J V S D (por ejemplo "S D").`
          );
        }
        fila[P.DIAS_TRABAJA - 1] = diasALetras(analisis.dias);
      }
      // Ventana de la asignación. Texto tal cual; el motor lo parsea.
      if (s.desde !== undefined) fila[P.DESDE - 1] = txt(s.desde);
      if (s.hasta !== undefined) fila[P.HASTA - 1] = txt(s.hasta);

      // El DESDE es obligatorio en cuanto hay alguien en la plaza. Si no llega
      // ninguno y la fila tampoco lo tenía, se pone el día en que se planifica:
      // sin fecha, el motor da la asignación por vigente desde siempre y las
      // coberturas de semanas pasadas salen mal.
      //
      // Solo afecta a las plazas que se TOCAN. Las que ya estaban ahí sin fecha
      // se quedan como están: son de cuando esto no se pedía, y reescribirlas
      // todas de golpe les inventaría un histórico que nadie ha decidido.
      if (s.id !== undefined && txt(s.id) && !txt(fila[P.DESDE - 1])) {
        fila[P.DESDE - 1] = hoyDDMMAAAA();
      }
    });

    aplicados.push(c);
  });

  return { datos, aplicados };
}

// ============================================================
// LO QUE SE BORRÓ AQUÍ, Y POR QUÉ (15/09/2026)
// ============================================================
// Este fichero tenía once funciones que ESCRIBÍAN en las hojas AGENDA_V2,
// PLANIFICADOR_V2 y CONDUCTORES_OUT: guardar el tablero, crear un conductor,
// actualizarlo, cambiar estados, archivar bajas, restaurarlas.
//
// Desde que el cuadrante se lee de PostgreSQL, ESAS HOJAS NO LAS LEE NADIE. Y
// eso no dejaba las escrituras inofensivas: las dejaba MUDAS. Cada una parecía
// funcionar y no llegaba a ninguna parte. Se encontraron tres por el camino:
//
//   · `actualizarConductor` — aprobar unas vacaciones dejaba el estado en una
//     hoja muerta y el planificador seguía dando la plaza por ocupada.
//   · `crearConductor` — el último paso del alta desde Administración creaba la
//     ficha donde nadie la iba a ver: esa persona no salía en la Plantilla.
//   · `cambiarEstados` — lo mismo con las bajas.
//
// Ninguna tenía ya quien la llamara cuando se borraron: cayeron solas al mudar
// Peticiones, VISTA_FINAL y Selección. Se comprobó nombre a nombre.
//
// LO QUE QUEDA es lo único que este fichero hace de verdad hoy: el MOTOR.
// `calcularTablero` y `aplicarCambios` son funciones PURAS —reciben filas,
// devuelven filas— y por eso se prueban sin base y sin red
// (`scripts/probar-planificador.js`). `leerCrudo` les da de comer desde
// PostgreSQL.
//
// El fichero ya no sabe que existe Google.

module.exports = {
  // El motor, que es lo único que hace este fichero.
  calcularTablero, aplicarCambios, leerCrudo, leerTablero, validarEsquema,
  // Sus ayudantes, todos puros.
  parseDiasTrabaja, analizarDias, diasALetras, parseCoords, haversine, colLetra,
  // El layout de la cuadrícula y los catálogos con los que habla.
  HOJAS, PLAN_FILA_CAB, PLAN_FILA_INI, FILAS_POR_COCHE, N_MAT, ULTIMA_FILA_PLAN,
  P, A, A_HEADERS, P_HEADERS, LIB_COL, ASG_COL, SLOTS,
  DIAS_SEM, LETRAS_DIA, TURNOS, TURNOS_CONDUCTOR, CONTRATOS,
  ESTADOS_CONDUCTOR, ESTADOS_ESPECIALES, ESTADOS_VEHICULO,
  ESTADO_PENDIENTE, ESTADO_ACTIVO, ESTADO_OPERATIVO,
};
