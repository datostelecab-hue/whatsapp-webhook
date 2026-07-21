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
      activo: esCheck(v[A.ACTIVO - 1]),
      nombre: txt(v[A.NOMBRE - 1]),
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
      if (ESTADOS_ESPECIALES.includes(info.estado)) {
        p.retirar = true;
        p.motivoRetiro = info.estado;
        problemas.push({
          tipo: 'estado-retira', idx: coche.idx, matricula: coche.matricula, id: p.id,
          msg: `${info.nombre || p.id} está en "${info.estado}": se libera su plaza en ` +
               `${nombreCoche} (${p.etiqueta}) y se borran sus días`
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
      } else if (info.turno !== p.turno) {
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
      p.diasManual.forEach((v, d) => { if (v) tomadosPorCT[p.turno][d] = true; });
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

      if (p.rol === 'CT') {
        // El correturno cubre exactamente lo que tenga escrito, ni más ni menos.
        p.diasCubre = p.diasManual ? p.diasManual.slice() : Array(7).fill(false);

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
        const partida = p.diasManual ? p.diasManual : info.trabaja;
        p.diasCubre = partida.map((v, d) => v && !tomadosPorCT[p.turno][d]);
      }

      p.diasTexto = diasALetras(p.diasCubre);

      p.diasCubre.forEach((cubre, d) => {
        if (!cubre) return;

        const key = `${d}|${p.turno}`;
        (grid[key] = grid[key] || []).push(p.id);

        // Un coche en taller, siniestrado o de baja no cuenta: quien esté en él
        // sigue como "Pendiente Asignar" y no recibe ni días ni matrícula,
        // porque en la práctica no tiene coche con el que salir.
        if (!coche.operativo) return;

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

    // Los problemas detectados arriba marcan el coche en rojo. Se listan en sus
    // conflictos para que se vean en la propia tarjeta, no solo en los avisos.
    problemas
      .filter(x => x.idx === coche.idx)
      .forEach(x => {
        if (['turno-cruzado', 'estado-retira', 'trabaja-en-libranza', 'matricula-duplicada'].includes(x.tipo)) {
          coche.conflictos.push({ tipo: x.tipo, msg: x.msg });
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

const { readMany, writeMany, getSheetIds, appendRows, deleteRows } = require('./sheets');

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
      if (s.id !== undefined) {
        fila[P.ID_BOLT - 1] = txt(s.id);
        // Al quitar al conductor se van sus días con él: si se quedaran, el
        // siguiente que entre heredaría una jornada que nadie le ha asignado.
        if (!txt(s.id)) fila[P.DIAS_TRABAJA - 1] = '';
      }
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
      // Vacaciones, baja o suspensión liberan la plaza: se va la persona y se
      // van sus días con ella. Dejar los días sueltos haría creer que ese turno
      // sigue cubierto.
      if (p.retirar) {
        colIds.push(['']);
        colDias.push(['']);
        return;
      }
      colIds.push([p.id || '']);
      // Sin conductor no hay días que guardar. En las filas de correturno se
      // respeta lo que escribió la persona; en las de fijo, lo que calcula el motor.
      if (!p.id) colDias.push(['']);
      else colDias.push([p.rol === 'CT' ? diasALetras(p.diasManual) : (p.diasTexto || '')]);
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

// ============================================================
// CONDUCTORES_OUT — bajas de empresa y restauración
// ============================================================

const HOJA_OUT = 'CONDUCTORES_OUT';
const RANGO_OUT = `${HOJA_OUT}!A1:AH1000`;   // AG + FECHA_BAJA
const COL_FECHA_BAJA = A_HEADERS.length + 1;  // 34 → AH
const ESTADO_BAJA_EMPRESA = 'Baja Empresa';

/**
 * Campos que se pueden editar desde la interfaz.
 *
 * Fuera de esta lista quedan a propósito:
 *   · ID_BOLT — es la clave con la que el planificador referencia a la persona.
 *     Cambiarlo dejaría su plaza apuntando a un fantasma, así que solo se fija
 *     al crear la ficha.
 *   · FIN_PERIODO_PRUEBA, EN_PRUEBA, MATRICULA, BINOMIO y los siete ASG_*
 *     los calcula el motor; escribirlos a mano duraría hasta el siguiente
 *     recálculo y solo generaría confusión.
 */
const CAMPOS_EDITABLES = {
  activo: { col: A.ACTIVO, tipo: 'bool' },
  nombre: { col: A.NOMBRE, tipo: 'texto' },
  dni: { col: A.DNI, tipo: 'texto' },
  naf: { col: A.NAF, tipo: 'texto' },
  fechaAlta: { col: A.FECHA_ALTA, tipo: 'texto' },
  recomendador: { col: A.RECOMENDADOR, tipo: 'texto' },
  turno: { col: A.TURNO, tipo: 'lista', valores: TURNOS },
  contrato: { col: A.CONTRATO, tipo: 'lista', valores: ['40h Fijo', '32h Correturno'] },
  coordenadas: { col: A.COORDENADAS, tipo: 'coords' },
  direccion: { col: A.DIRECCION, tipo: 'texto' },
  telefono: { col: A.TELEFONO, tipo: 'texto' },
  telEmergencia: { col: A.TEL_EMERG, tipo: 'texto' },
  observaciones: { col: A.OBSERVACIONES, tipo: 'texto' },
  libLun: { col: A.L_LUN, tipo: 'bool' },
  libMar: { col: A.L_MAR, tipo: 'bool' },
  libMie: { col: A.L_MIE, tipo: 'bool' },
  libJue: { col: A.L_JUE, tipo: 'bool' },
  libVie: { col: A.L_VIE, tipo: 'bool' },
  libSab: { col: A.L_SAB, tipo: 'bool' },
  libDom: { col: A.L_DOM, tipo: 'bool' }
};

const CAMPOS_LIBRANZA = ['libLun', 'libMar', 'libMie', 'libJue', 'libVie', 'libSab', 'libDom'];

/** Comprueba y normaliza un valor según el tipo de su campo. */
function validarCampo(nombre, valor) {
  const def = CAMPOS_EDITABLES[nombre];
  if (!def) throw new Error(`El campo "${nombre}" no se puede editar desde aquí`);

  if (def.tipo === 'bool') return valor === true || valor === 'true' || valor === 'TRUE';

  if (def.tipo === 'lista') {
    const v = txt(valor);
    if (v && !def.valores.includes(v)) {
      throw new Error(`"${v}" no vale para ${nombre}. Opciones: ${def.valores.join(', ')}`);
    }
    return v;
  }

  if (def.tipo === 'coords') {
    const v = txt(valor);
    if (!v) return '';
    const c = parseCoords(v);
    if (!c) throw new Error(`Coordenadas no reconocidas: "${v}". Usa "40.41, -3.70"`);
    // Se guardan canónicas para que el matching no dependa del formato tecleado
    return `${Math.round(c.lat * 1e8) / 1e8}, ${Math.round(c.lng * 1e8) / 1e8}`;
  }

  return txt(valor);
}

/** Edita los datos de un conductor ya existente. */
async function actualizarConductor(id, campos) {
  const idBusca = txt(id);
  if (!idBusca) throw new Error('Falta el ID del conductor');
  if (!campos || !Object.keys(campos).length) throw new Error('No se ha recibido ningún cambio');

  const [agendaFilas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGOS.agenda]);
  let fila = null;
  agendaFilas.slice(1).forEach((f, i) => {
    if (txt(f[A.ID_BOLT - 1]) === idBusca) fila = i + 2;
  });
  if (!fila) throw new Error(`El conductor "${idBusca}" no está en la agenda`);

  // Se valida primero TODO y después se escribe: así un campo prohibido o un
  // valor inválido aborta la operación entera en vez de dejarla a medias.
  const datos = Object.entries(campos).map(([nombre, valor]) => {
    const limpio = validarCampo(nombre, valor);
    return {
      range: `${HOJAS.AGENDA}!${colLetra(CAMPOS_EDITABLES[nombre].col)}${fila}`,
      values: [[limpio]]
    };
  });

  await writeMany(SPREADSHEET_PLANIFICADOR, datos);

  // Tocar la libranza o el turno cambia lo que cubre esa persona, así que se
  // recalcula el planificador para que huecos y estados queden al día.
  const tablero = await leerTablero();
  if (tablero.esquema.ok) await guardarTablero(tablero);

  return { id: idBusca, fila, camposActualizados: Object.keys(campos), tablero };
}

/** Da de alta a un conductor nuevo. */
async function crearConductor(datos) {
  const id = txt(datos && datos.id);
  if (!id) throw new Error('El ID de Bolt es obligatorio');
  if (!txt(datos.nombre)) throw new Error('El nombre es obligatorio');
  if (!txt(datos.turno)) throw new Error('El turno es obligatorio');

  const [agendaFilas, outFilas] = await readMany(
    SPREADSHEET_PLANIFICADOR, [RANGOS.agenda, RANGO_OUT]);

  const existe = agendaFilas.slice(1).some(f => txt(f[A.ID_BOLT - 1]) === id);
  if (existe) throw new Error(`Ya hay un conductor con el ID "${id}" en la agenda`);

  const archivado = outFilas.slice(1).some(f => txt(f[A.ID_BOLT - 1]) === id);
  if (archivado) {
    throw new Error(
      `"${id}" está archivado en ${HOJA_OUT}. Restáuralo desde la pestaña Archivo ` +
      `en vez de crearlo de nuevo, así conserva su historial.`
    );
  }

  const fila = Array(A_HEADERS.length).fill('');
  fila[A.ID_BOLT - 1] = id;
  fila[A.ESTADO - 1] = ESTADO_PENDIENTE;
  fila[A.ACTIVO - 1] = true;

  Object.entries(datos).forEach(([nombre, valor]) => {
    if (nombre === 'id') return;
    if (!CAMPOS_EDITABLES[nombre]) return;
    fila[CAMPOS_EDITABLES[nombre].col - 1] = validarCampo(nombre, valor);
  });

  await appendRows(SPREADSHEET_PLANIFICADOR, `${HOJAS.AGENDA}!A1`, [fila]);

  // Verificar que ha entrado antes de dar el alta por buena
  const [despues] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGOS.agenda]);
  if (!despues.slice(1).some(f => txt(f[A.ID_BOLT - 1]) === id)) {
    throw new Error(`No se ha podido crear a "${id}" en la agenda`);
  }

  return { id, nombre: txt(datos.nombre) };
}

/**
 * Cambia el estado de uno o varios conductores en la agenda.
 * Si alguno queda en "Baja Empresa", se migra a CONDUCTORES_OUT acto seguido.
 */
async function cambiarEstados(cambios) {
  if (!Array.isArray(cambios) || !cambios.length) {
    throw new Error('No se ha recibido ningún cambio de estado');
  }

  const [agendaFilas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGOS.agenda]);
  const filaDe = new Map();
  agendaFilas.slice(1).forEach((f, i) => {
    const id = txt(f[A.ID_BOLT - 1]);
    if (id) filaDe.set(id, i + 2);
  });

  const datos = [];
  const aplicados = [];

  cambios.forEach(c => {
    const id = txt(c.id);
    const estado = txt(c.estado);
    if (!filaDe.has(id)) throw new Error(`El conductor "${id}" no está en la agenda`);
    if (!ESTADOS_CONDUCTOR.includes(estado)) {
      throw new Error(`Estado no válido: "${estado}". Debe ser uno de: ${ESTADOS_CONDUCTOR.join(', ')}`);
    }
    datos.push({
      range: `${HOJAS.AGENDA}!${colLetra(A.ESTADO)}${filaDe.get(id)}`,
      values: [[estado]]
    });
    aplicados.push({ id, estado });
  });

  await writeMany(SPREADSHEET_PLANIFICADOR, datos);

  // El cambio de estado puede haber liberado plazas del planificador: se
  // recalcula y se guarda para que la hoja quede coherente al momento.
  const tablero = await leerTablero();
  if (tablero.esquema.ok) await guardarTablero(tablero);

  let migracion = null;
  if (aplicados.some(a => a.estado === ESTADO_BAJA_EMPRESA)) {
    migracion = await migrarBajasEmpresa();
  }

  return { aplicados, migracion };
}

/** Lee CONDUCTORES_OUT y devuelve las fichas archivadas. */
async function leerOut() {
  const [filas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGO_OUT]);
  const cabecera = filas[0] || [];

  const fichas = filas.slice(1)
    .map((f, i) => {
      const id = txt(f[A.ID_BOLT - 1]);
      if (!id) return null;
      return {
        fila: i + 2,
        id,
        nombre: txt(f[A.NOMBRE - 1]),
        dni: txt(f[A.DNI - 1]),
        turno: txt(f[A.TURNO - 1]),
        telefono: txt(f[A.TELEFONO - 1]),
        estado: txt(f[A.ESTADO - 1]),
        fechaAlta: txt(f[A.FECHA_ALTA - 1]),
        fechaBaja: txt(f[COL_FECHA_BAJA - 1]),
        datos: f
      };
    })
    .filter(Boolean);

  return { cabecera, fichas };
}

/**
 * Mueve a CONDUCTORES_OUT a todo el que esté en "Baja Empresa".
 *
 * El orden importa y es innegociable: primero se copia, después se comprueba
 * releyendo que la copia está de verdad, y solo entonces se borra de la agenda.
 * Si el borrado fuera primero y fallara la copia, se perdería la ficha entera
 * de alguien que llevas meses rellenando a mano.
 */
async function migrarBajasEmpresa() {
  const crudo = await leerCrudo();
  if (!crudo.esquema.ok) {
    throw new Error('El esquema de la hoja no coincide: ' + crudo.esquema.problemas.join(' | '));
  }

  const candidatos = crudo.agendaFilas.slice(1)
    .map((f, i) => ({ fila: i + 2, id: txt(f[A.ID_BOLT - 1]), estado: txt(f[A.ESTADO - 1]), datos: f }))
    .filter(x => x.id && x.estado === ESTADO_BAJA_EMPRESA);

  if (!candidatos.length) return { migrados: [], omitidos: [], msg: 'No hay nadie en Baja Empresa' };

  const out = await leerOut();
  const yaArchivados = new Set(out.fichas.map(f => f.id));

  const nuevos = candidatos.filter(c => !yaArchivados.has(c.id));
  const omitidos = candidatos.filter(c => yaArchivados.has(c.id)).map(c => c.id);

  // ---- 1. Copiar ----
  if (nuevos.length) {
    const hoy = new Date().toLocaleDateString('es-ES');
    const filas = nuevos.map(c => {
      const fila = c.datos.slice(0, A_HEADERS.length);
      while (fila.length < A_HEADERS.length) fila.push('');
      fila.push(hoy);
      return fila;
    });
    await appendRows(SPREADSHEET_PLANIFICADOR, `${HOJA_OUT}!A1`, filas);

    // ---- 2. Verificar que la copia está antes de borrar nada ----
    const comprobacion = await leerOut();
    const archivadosAhora = new Set(comprobacion.fichas.map(f => f.id));
    const noLlegaron = nuevos.filter(c => !archivadosAhora.has(c.id)).map(c => c.id);
    if (noLlegaron.length) {
      throw new Error(
        `No se ha podido archivar a ${noLlegaron.join(', ')} en ${HOJA_OUT}. ` +
        `NO se ha borrado nada de la agenda.`
      );
    }
  }

  // ---- 3. Ahora sí, borrar de la agenda ----
  const hojas = await getSheetIds(SPREADSHEET_PLANIFICADOR);
  const idAgenda = hojas[HOJAS.AGENDA];
  if (idAgenda === undefined) throw new Error(`No se encuentra la hoja ${HOJAS.AGENDA}`);

  await deleteRows(SPREADSHEET_PLANIFICADOR, idAgenda, candidatos.map(c => c.fila));

  return {
    migrados: nuevos.map(c => ({ id: c.id, nombre: txt(c.datos[A.NOMBRE - 1]) })),
    omitidos,
    filasBorradas: candidatos.length
  };
}

/**
 * Devuelve a la agenda a quien estaba archivado.
 * Vuelve como "Pendiente Asignar" y sin rastro de su asignación anterior:
 * matrícula, binomio y los siete días se limpian, porque el coche que tenía
 * hace meses seguramente ya es de otro.
 */
async function restaurarDesdeOut(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('No se ha indicado a quién restaurar');

  const out = await leerOut();
  const aRestaurar = out.fichas.filter(f => ids.includes(f.id));
  if (!aRestaurar.length) throw new Error('Ninguno de esos IDs está en ' + HOJA_OUT);

  const [agendaFilas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGOS.agenda]);
  const yaEnAgenda = new Set(agendaFilas.slice(1).map(f => txt(f[A.ID_BOLT - 1])).filter(Boolean));

  const duplicados = aRestaurar.filter(f => yaEnAgenda.has(f.id)).map(f => f.id);
  if (duplicados.length) {
    throw new Error(`${duplicados.join(', ')} ya está en la agenda. No se restaura para no duplicarlo.`);
  }

  // ---- 1. Copiar de vuelta, ya limpio ----
  const filas = aRestaurar.map(f => {
    const fila = f.datos.slice(0, A_HEADERS.length);
    while (fila.length < A_HEADERS.length) fila.push('');
    fila[A.ESTADO - 1] = ESTADO_PENDIENTE;
    fila[A.MATRICULA - 1] = '';
    fila[A.BINOMIO - 1] = '';
    ASG_COL.forEach(c => { fila[c - 1] = ''; });
    return fila;
  });
  await appendRows(SPREADSHEET_PLANIFICADOR, `${HOJAS.AGENDA}!A1`, filas);

  // ---- 2. Verificar antes de borrar del archivo ----
  const [agendaDespues] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGOS.agenda]);
  const enAgendaAhora = new Set(agendaDespues.slice(1).map(f => txt(f[A.ID_BOLT - 1])).filter(Boolean));
  const noLlegaron = aRestaurar.filter(f => !enAgendaAhora.has(f.id)).map(f => f.id);
  if (noLlegaron.length) {
    throw new Error(
      `No se ha podido devolver a ${noLlegaron.join(', ')} a la agenda. ` +
      `NO se ha borrado nada de ${HOJA_OUT}.`
    );
  }

  // ---- 3. Quitar del archivo ----
  const hojas = await getSheetIds(SPREADSHEET_PLANIFICADOR);
  const idOut = hojas[HOJA_OUT];
  if (idOut === undefined) throw new Error(`No se encuentra la hoja ${HOJA_OUT}`);

  await deleteRows(SPREADSHEET_PLANIFICADOR, idOut, aRestaurar.map(f => f.fila));

  return { restaurados: aRestaurar.map(f => ({ id: f.id, nombre: f.nombre })) };
}

module.exports = {
  SPREADSHEET_PLANIFICADOR,
  HOJA_OUT, RANGO_OUT, ESTADO_BAJA_EMPRESA,
  leerOut, migrarBajasEmpresa, restaurarDesdeOut, cambiarEstados,
  actualizarConductor, crearConductor, CAMPOS_EDITABLES, CAMPOS_LIBRANZA, validarCampo,
  ESTADOS_CONDUCTOR, ESTADOS_ESPECIALES, HOJAS, DIAS_SEM, LETRAS_DIA, ESTADOS_VEHICULO, TURNOS,
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
