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

const SPREADSHEET_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';

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
  ESTADO_FLAT: 9, MATRICULA_FLAT: 10
};

// Columnas de AGENDA_V2 (1-based)
const A = {
  ACTIVO: 1, ESTADO: 2, NOMBRE: 3, ID_BOLT: 4, DNI: 5, NAF: 6, FECHA_ALTA: 7,
  FIN_PRUEBA: 8, EN_PRUEBA: 9, RECOMENDADOR: 10, TURNO: 11, CONTRATO: 12,
  L_LUN: 13, L_MAR: 14, L_MIE: 15, L_JUE: 16, L_VIE: 17, L_SAB: 18, L_DOM: 19,
  MATRICULA: 20, BINOMIO: 21, COORDENADAS: 22, DIRECCION: 23, TELEFONO: 24,
  TEL_EMERG: 25, OBSERVACIONES: 26,
  ASG_LUN: 27, ASG_MAR: 28, ASG_MIE: 29, ASG_JUE: 30, ASG_VIE: 31, ASG_SAB: 32, ASG_DOM: 33
};

const A_HEADERS = [
  'ACTIVO', 'ESTADO', 'NOMBRE_APELLIDOS', 'ID_BOLT', 'DNI_NIE', 'NAF', 'FECHA_ALTA',
  'FIN_PERIODO_PRUEBA', 'EN_PRUEBA', 'RECOMENDADOR', 'TURNO', 'CONTRATO',
  'LIB_LUN', 'LIB_MAR', 'LIB_MIE', 'LIB_JUE', 'LIB_VIE', 'LIB_SAB', 'LIB_DOM',
  'MATRICULA', 'BINOMIO', 'COORDENADAS', 'DIRECCION_COMPLETA', 'TELEFONO',
  'TEL_EMERGENCIA', 'OBSERVACIONES',
  'ASG_LUN', 'ASG_MAR', 'ASG_MIE', 'ASG_JUE', 'ASG_VIE', 'ASG_SAB', 'ASG_DOM'
];

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

const DIAS_SEM = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const LETRAS_DIA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const TURNOS = ['Día', 'Noche'];

const ESTADOS_CONDUCTOR = ['Activo', 'Pendiente Asignar', 'Vacaciones', 'Baja Médica', 'Baja Empresa', 'Suspendido'];
const ESTADOS_ESPECIALES = ['Vacaciones', 'Baja Médica', 'Baja Empresa', 'Suspendido'];
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

function parseCoords(txt) {
  if (txt == null || txt === '') return null;
  const s = String(txt).trim();

  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
  if (m) {
    const la = parseFloat(m[1]);
    const lo = parseFloat(m[2]);
    if (!isNaN(la) && !isNaN(lo)) return { lat: la, lng: lo };
  }

  // Coma decimal europea: "40,39 -3,60"
  const partes = s.split(/\s+/);
  if (partes.length >= 2) {
    const a = parseFloat(partes[0].replace(',', '.'));
    const b = parseFloat(partes[1].replace(',', '.'));
    if (!isNaN(a) && !isNaN(b)) return { lat: a, lng: b };
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

// ============================================================
// MOTOR — función pura, sin red
// ============================================================

/**
 * @param {Array[]} agendaVals  filas de AGENDA_V2 SIN cabecera
 * @param {Array[]} planVals    filas de PLANIFICADOR_V2 desde PLAN_FILA_INI
 * @param {Array}   bases       [{nombre, lat, lng}]
 * @returns tablero resuelto: coches, conductores, avisos y resumen
 */
function calcularTablero(agendaVals, planVals, bases = []) {
  // ---- 1. Índice de conductores por ID ----
  const porId = new Map();
  const conductores = [];

  agendaVals.forEach((v, idx) => {
    const id = txt(v[A.ID_BOLT - 1]);
    if (!id) return;

    const libra = LIB_COL.map(c => esCheck(v[c - 1]));
    const info = {
      fila: idx + 2,                     // fila real en la hoja
      id,
      nombre: txt(v[A.NOMBRE - 1]),
      turno: txt(v[A.TURNO - 1]),
      contrato: txt(v[A.CONTRATO - 1]),
      estado: txt(v[A.ESTADO - 1]),
      telefono: txt(v[A.TELEFONO - 1]),
      coordenadas: txt(v[A.COORDENADAS - 1]),
      libra,
      trabaja: libra.map(l => !l)
    };
    porId.set(id, info);
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
        huerfano: Boolean(id) && !porId.has(id)
      });
    }

    coches.push({
      idx: c,
      filaTop: PLAN_FILA_INI + base,
      estadoVeh: txt(filaTop[P.ESTADO_VEH - 1]),
      matricula: txt(filaTop[P.MATRICULA - 1]),
      zona: txt(filaTop[P.ZONA - 1]),
      personas
    });
  }

  // ---- 3. Días que cubre cada persona ----
  // Ocupación global, para detectar a la misma persona en dos coches a la vez.
  const ocupacionGlobal = new Map();   // "id|dia|turno" → Set(matriculas)
  const asignacionPorDia = new Map();  // id → [7] matrícula

  coches.forEach(coche => {
    // Los correturnos mandan: los días que ellos cubren se los quitan al fijo
    // del mismo turno, que es lo que hace que el binomio no duplique jornada.
    const tomadosPorCT = { 'Día': Array(7).fill(false), 'Noche': Array(7).fill(false) };
    coche.personas.forEach(p => {
      if (!p.id || p.rol !== 'CT' || !p.diasManual) return;
      p.diasManual.forEach((v, d) => { if (v) tomadosPorCT[p.turno][d] = true; });
    });

    const grid = {};   // "dia|turno" → [ids]

    coche.personas.forEach(p => {
      p.diasCubre = Array(7).fill(false);
      if (!p.id) return;

      const info = porId.get(p.id);
      if (!info) return;   // huérfano: no cubre nada, ya está marcado

      if (p.rol === 'CT') {
        // El correturno cubre exactamente lo que tenga escrito, ni más ni menos.
        p.diasCubre = p.diasManual ? p.diasManual.slice() : Array(7).fill(false);
      } else {
        const partida = p.diasManual ? p.diasManual : info.trabaja;
        p.diasCubre = partida.map((v, d) => v && !tomadosPorCT[p.turno][d]);
      }

      p.diasTexto = diasALetras(p.diasCubre);

      p.diasCubre.forEach((cubre, d) => {
        if (!cubre) return;

        const key = `${d}|${p.turno}`;
        (grid[key] = grid[key] || []).push(p.id);

        if (coche.matricula) {
          if (!asignacionPorDia.has(p.id)) asignacionPorDia.set(p.id, Array(7).fill(''));
          const asg = asignacionPorDia.get(p.id);
          if (!asg[d]) asg[d] = coche.matricula;
        }

        const gk = `${p.id}|${d}|${p.turno}`;
        if (!ocupacionGlobal.has(gk)) ocupacionGlobal.set(gk, new Set());
        ocupacionGlobal.get(gk).add(coche.matricula || `coche#${coche.idx + 1}`);
      });
    });

    coche._grid = grid;
  });

  // ---- 4. Huecos, solapes y resumen ----
  const salen = { 'Día': Array(7).fill(0), 'Noche': Array(7).fill(0) };
  const estadoAutos = { '✓': 0, 'X': 0, 'T': 0, 'S': 0, 'R': 0, 'B': 0 };
  const avisos = [];

  coches.forEach(coche => {
    if (coche.estadoVeh && estadoAutos[coche.estadoVeh] !== undefined) {
      estadoAutos[coche.estadoVeh]++;
    }

    coche.operativo = coche.estadoVeh === ESTADO_OPERATIVO;
    coche.huecos = [];
    coche.conflictos = [];

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
        });

        if (lista.length === 0) {
          coche.huecos.push({ dia: d, turno, etiqueta: `(${turno === 'Día' ? 'D' : 'N'}) ${DIAS_SEM[d]}` });
        } else {
          salen[turno][d]++;
        }
      });
    }

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

  // ---- 5. Estado derivado de cada conductor ----
  const matriculaPrincipal = new Map();
  const binomio = new Map();

  coches.forEach(coche => {
    if (!coche.matricula) return;
    const idDia = coche.personas[0].id;
    const idNoche = coche.personas[1].id;
    coche.personas.forEach(p => {
      if (p.id && !matriculaPrincipal.has(p.id)) matriculaPrincipal.set(p.id, coche.matricula);
    });
    if (idDia) binomio.set(idDia, idNoche || '');
    if (idNoche) binomio.set(idNoche, idDia || '');
  });

  conductores.forEach(info => {
    const asg = asignacionPorDia.get(info.id) || Array(7).fill('');
    info.matricula = matriculaPrincipal.get(info.id) || '';
    info.binomio = binomio.get(info.id) || '';
    info.asignacion = info.libra.map((libra, d) => (libra ? 'L' : (asg[d] || '')));

    // Activo solo si cada día laborable tiene coche. Los estados especiales
    // (vacaciones, bajas, suspendido) los pone una persona y no se tocan.
    const especial = ESTADOS_ESPECIALES.includes(info.estado);
    const laborables = info.libra.filter(l => !l).length;
    const cubiertos = info.libra.reduce((n, l, d) => n + (!l && asg[d] ? 1 : 0), 0);

    info.diasLaborables = laborables;
    info.diasCubiertos = cubiertos;
    info.estadoCalculado = info.estado;

    if (!especial && laborables > 0) {
      info.estadoCalculado = cubiertos === laborables ? ESTADO_ACTIVO : ESTADO_PENDIENTE;
    }
    info.estadoCambia = info.estadoCalculado !== info.estado;
  });

  // ---- 6. Matching contra bases ----
  const pendientes = conductores
    .filter(c => c.estadoCalculado === ESTADO_PENDIENTE)
    .map(c => {
      const coord = parseCoords(c.coordenadas);
      if (!coord || !bases.length) return { ...c, distancias: [], baseCercana: null };
      const distancias = bases.map(b => ({
        nombre: b.nombre,
        km: Math.round(haversine(coord.lat, coord.lng, b.lat, b.lng) * 100) / 100
      }));
      const baseCercana = distancias.reduce((a, b) => (b.km < a.km ? b : a));
      return { ...c, distancias, baseCercana };
    });

  // ---- 7. Demanda ----
  const demanda = { fijosDia: 0, fijosNoche: 0, ctDia: 0, ctNoche: 0 };
  coches.forEach(coche => {
    if (!coche.operativo) return;
    if (!coche.personas[0].id) demanda.fijosDia++;
    if (!coche.personas[1].id) demanda.fijosNoche++;
    if (!coche.personas[2].id && !coche.personas[4].id) demanda.ctDia++;
    if (!coche.personas[3].id && !coche.personas[5].id) demanda.ctNoche++;
  });

  return {
    coches,
    conductores,
    pendientes,
    bases,
    avisos,
    resumen: {
      salen,
      estadoAutos,
      demanda,
      cochesOperativos: estadoAutos['✓'],
      totalHuecos: coches.reduce((n, c) => n + (c.numLibres || 0), 0),
      cochesConError: coches.filter(c => c.hayError).length
    }
  };
}

// ============================================================
// LECTURA / ESCRITURA CONTRA LA HOJA
// ============================================================

const { readMany, writeMany } = require('./sheets');

const ULTIMA_FILA_PLAN = PLAN_FILA_INI + N_MAT * FILAS_POR_COCHE - 1;

const RANGOS = {
  agenda: `${HOJAS.AGENDA}!A1:AG1000`,
  plan: `${HOJAS.PLAN}!A${PLAN_FILA_CAB}:J${ULTIMA_FILA_PLAN}`,
  bases: `${HOJAS.BASES}!A1:D60`
};

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

/** Lee las tres hojas en una sola petición, sin interpretar nada. */
async function leerCrudo() {
  const [agendaFilas, planFilas, basesFilas] = await readMany(
    SPREADSHEET_PLANIFICADOR,
    [RANGOS.agenda, RANGOS.plan, RANGOS.bases]
  );

  const bases = basesFilas.slice(1)
    .map(f => {
      const nombre = txt(f[0]);
      const coord = parseCoords(f[1]);
      return nombre && coord ? { nombre, lat: coord.lat, lng: coord.lng } : null;
    })
    .filter(Boolean);

  return {
    agendaFilas,
    planFilas,
    bases,
    esquema: validarEsquema(agendaFilas, planFilas)
  };
}

/** Lee y devuelve el tablero ya calculado. */
async function leerTablero() {
  const crudo = await leerCrudo();
  const tablero = calcularTablero(crudo.agendaFilas.slice(1), crudo.planFilas.slice(1), crudo.bases);
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
      if (s.id !== undefined) fila[P.ID_BOLT - 1] = txt(s.id);
      if (s.dias !== undefined) {
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
    });

    aplicados.push(c);
  });

  return { datos, aplicados };
}

/**
 * Ciclo completo de guardado: relee, aplica, recalcula y escribe.
 * Devuelve el tablero recalculado para que la interfaz se refresque sin
 * tener que volver a pedirlo.
 */
async function guardarCambios(cambios) {
  const crudo = await leerCrudo();

  if (!crudo.esquema.ok) {
    throw new Error('El esquema de la hoja no coincide: ' + crudo.esquema.problemas.join(' | '));
  }

  const { datos, aplicados } = aplicarCambios(crudo.planFilas, cambios);
  const tablero = calcularTablero(crudo.agendaFilas.slice(1), datos, crudo.bases);
  tablero.esquema = crudo.esquema;

  const res = await guardarTablero(tablero);
  return { tablero, escritura: res, cochesAplicados: aplicados };
}

/**
 * Vuelca a la hoja todo lo que el motor ha calculado.
 *
 * Las columnas B, C, E, G y H del planificador son celdas combinadas
 * verticalmente (6 filas por coche), así que no se puede escribir un bloque
 * continuo: hay que dirigirse a la celda superior de cada combinación. Se
 * generan como rangos independientes, pero todos viajan en la misma petición.
 */
async function guardarTablero(tablero, opciones = {}) {
  if (tablero.esquema && !tablero.esquema.ok && !opciones.forzar) {
    throw new Error('El esquema de la hoja no coincide: ' + tablero.esquema.problemas.join(' | '));
  }

  const datos = [];
  const P_ini = PLAN_FILA_INI;

  // --- Planificador: columnas NO combinadas, en bloque ---
  const colIds = [];
  const colDias = [];
  tablero.coches.forEach(coche => {
    coche.personas.forEach(p => {
      colIds.push([p.id || '']);
      // En las filas de correturno se respeta lo que escribió la persona;
      // en las de fijo se pone lo que ha calculado el motor.
      colDias.push([p.rol === 'CT' ? diasALetras(p.diasManual) : (p.diasTexto || '')]);
    });
  });
  datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.ID_BOLT)}${P_ini}:${colLetra(P.ID_BOLT)}${ULTIMA_FILA_PLAN}`, values: colIds });
  datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.DIAS_TRABAJA)}${P_ini}:${colLetra(P.DIAS_TRABAJA)}${ULTIMA_FILA_PLAN}`, values: colDias });

  // --- Planificador: columnas combinadas, celda superior de cada coche ---
  tablero.coches.forEach(coche => {
    const f = coche.filaTop;
    datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.ESTADO_VEH)}${f}`, values: [[coche.estadoVeh || '']] });
    datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.MATRICULA)}${f}`, values: [[coche.matricula || '']] });
    datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.ZONA)}${f}`, values: [[coche.zona || '']] });
    datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.TURNOS_LIBRES)}${f}`, values: [[coche.textoLibres || '']] });
    datos.push({ range: `${HOJAS.PLAN}!${colLetra(P.NUM_LIBRES)}${f}`, values: [[coche.numLibres || 0]] });
  });

  // --- Agenda: matrícula, binomio, asignación por día y estado ---
  // Se escribe fila a fila porque los conductores no ocupan filas contiguas
  // necesariamente (puede haber huecos en la agenda).
  tablero.conductores.forEach(c => {
    datos.push({ range: `${HOJAS.AGENDA}!${colLetra(A.MATRICULA)}${c.fila}`, values: [[c.matricula || '']] });
    datos.push({ range: `${HOJAS.AGENDA}!${colLetra(A.BINOMIO)}${c.fila}`, values: [[c.binomio || '']] });
    datos.push({
      range: `${HOJAS.AGENDA}!${colLetra(ASG_COL[0])}${c.fila}:${colLetra(ASG_COL[6])}${c.fila}`,
      values: [c.asignacion]
    });
    if (c.estadoCambia) {
      datos.push({ range: `${HOJAS.AGENDA}!${colLetra(A.ESTADO)}${c.fila}`, values: [[c.estadoCalculado]] });
    }
  });

  const res = await writeMany(SPREADSHEET_PLANIFICADOR, datos);
  return { ...res, rangos: datos.length };
}

module.exports = {
  SPREADSHEET_PLANIFICADOR,
  RANGOS, ULTIMA_FILA_PLAN, colLetra,
  validarEsquema, leerCrudo, leerTablero, guardarTablero,
  aplicarCambios, guardarCambios,
  HOJAS,
  PLAN_FILA_CAB, PLAN_FILA_INI, FILAS_POR_COCHE, N_MAT,
  P, A, A_HEADERS, P_HEADERS, LIB_COL, ASG_COL, SLOTS,
  DIAS_SEM, LETRAS_DIA, TURNOS,
  ESTADOS_CONDUCTOR, ESTADOS_VEHICULO, ESTADO_PENDIENTE, ESTADO_ACTIVO, ESTADO_OPERATIVO,
  parseDiasTrabaja, analizarDias, diasALetras, parseCoords, haversine,
  calcularTablero
};
