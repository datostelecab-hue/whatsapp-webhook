/**
 * CRUD de vehículos sobre una hoja VEHICULOS del mismo libro que el
 * planificador. Es el inventario maestro de la flota: cada matrícula con su
 * ficha (modelo, ITV, seguro, estado, zona…).
 *
 * Pensado para escalar: las fechas de ITV y seguro generan alertas de
 * vencimiento, y se cruza con el planificador para detectar matrículas que
 * están en uno pero no en el otro.
 */

const { readMany, writeMany, ensureSheet, getSheetIds, deleteRows } = require('./sheets');
const { SPREADSHEET_PLANIFICADOR, ESTADOS_VEHICULO, leerTablero } = require('./planificadorV2');

const HOJA = 'VEHICULOS';
const RANGO = `${HOJA}!A1:K600`;

// Columnas (1-based) y cabeceras.
const V = {
  MATRICULA: 1, MARCA_MODELO: 2, ANIO: 3, MATRICULACION: 4,
  ITV: 5, ASEGURADORA: 6, VENCE_SEGURO: 7, ESTADO: 8, ZONA: 9, KM: 10, NOTAS: 11
};
const HEADERS = [
  'MATRICULA', 'MARCA_MODELO', 'AÑO', 'FECHA_MATRICULACION',
  'ITV', 'ASEGURADORA', 'VENCE_SEGURO', 'ESTADO', 'ZONA', 'KM', 'NOTAS'
];

// Campos editables desde la interfaz (matrícula aparte, es la clave).
const CAMPOS = {
  marcaModelo: V.MARCA_MODELO, anio: V.ANIO, matriculacion: V.MATRICULACION,
  itv: V.ITV, aseguradora: V.ASEGURADORA, venceSeguro: V.VENCE_SEGURO,
  estado: V.ESTADO, zona: V.ZONA, km: V.KM, notas: V.NOTAS
};

const txt = v => String(v == null ? '' : v).trim();
const colLetra = n => { let s = '', x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - m) / 26); } return s; };

/** Normaliza matrícula: sin espacios ni guiones, en mayúsculas. */
function normMatricula(m) {
  return txt(m).toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Interpreta dd/mm/aaaa (o aaaa-mm-dd) y devuelve un Date, o null.
 * Comprueba que el día/mes existan de verdad: JS "corrige" 32/13 a otra fecha,
 * así que se verifica que el Date resultante coincida con lo introducido.
 */
function parseFecha(s) {
  const t = txt(s);
  if (!t) return null;
  let d, mes, a;
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    d = +m[1]; mes = +m[2]; a = +(m[3].length === 2 ? '20' + m[3] : m[3]);
  } else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    a = +m[1]; mes = +m[2]; d = +m[3];
  } else {
    return null;
  }
  const fecha = new Date(a, mes - 1, d);
  if (fecha.getFullYear() !== a || fecha.getMonth() !== mes - 1 || fecha.getDate() !== d) {
    return null;   // día/mes fuera de rango (p. ej. 32/13)
  }
  return fecha;
}

/** 'vencido' | 'proximo' (≤30 días) | 'ok' | null (sin fecha). */
function estadoVencimiento(fechaTxt, hoy) {
  const f = parseFecha(fechaTxt);
  if (!f) return null;
  const dias = Math.floor((f - hoy) / 86400000);
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'proximo';
  return 'ok';
}

async function asegurarHoja() {
  await ensureSheet(SPREADSHEET_PLANIFICADOR, HOJA);
  const [filas] = await readMany(SPREADSHEET_PLANIFICADOR, [`${HOJA}!A1:K1`]);
  const cab = filas[0] || [];
  // Si la cabecera no está puesta, se escribe.
  if (HEADERS.some((h, i) => txt(cab[i]) !== h)) {
    await writeMany(SPREADSHEET_PLANIFICADOR, [{ range: `${HOJA}!A1:${colLetra(HEADERS.length)}1`, values: [HEADERS] }]);
  }
}

/**
 * Lista los vehículos con sus alertas de vencimiento y el cruce con el
 * planificador (si la matrícula está en uso y con qué estado allí).
 */
async function leerVehiculos() {
  await asegurarHoja();
  const [filas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGO]);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  // Matrículas que el planificador tiene en uso, para el cruce.
  let enPlan = new Map();
  try {
    const t = await leerTablero();
    t.coches.forEach(c => { if (c.matricula) enPlan.set(normMatricula(c.matricula), c.estadoVeh); });
  } catch (e) { /* si el planificador no se puede leer, se sigue sin cruce */ }

  const vehiculos = filas.slice(1).map((f, i) => {
    const matricula = txt(f[V.MATRICULA - 1]);
    if (!matricula) return null;
    const norm = normMatricula(matricula);
    return {
      fila: i + 2,
      matricula,
      marcaModelo: txt(f[V.MARCA_MODELO - 1]),
      anio: txt(f[V.ANIO - 1]),
      matriculacion: txt(f[V.MATRICULACION - 1]),
      itv: txt(f[V.ITV - 1]),
      aseguradora: txt(f[V.ASEGURADORA - 1]),
      venceSeguro: txt(f[V.VENCE_SEGURO - 1]),
      estado: txt(f[V.ESTADO - 1]),
      zona: txt(f[V.ZONA - 1]),
      km: txt(f[V.KM - 1]),
      notas: txt(f[V.NOTAS - 1]),
      itvEstado: estadoVencimiento(f[V.ITV - 1], hoy),
      seguroEstado: estadoVencimiento(f[V.VENCE_SEGURO - 1], hoy),
      enPlanificador: enPlan.has(norm),
      estadoEnPlanificador: enPlan.get(norm) || null
    };
  }).filter(Boolean);

  // Avisos: matrículas del planificador sin ficha de vehículo.
  const matriculasFicha = new Set(vehiculos.map(v => normMatricula(v.matricula)));
  const sinFicha = [...enPlan.keys()].filter(m => !matriculasFicha.has(m));

  return { vehiculos, sinFicha, total: vehiculos.length };
}

function validar(campos) {
  const limpio = {};
  Object.entries(campos).forEach(([k, v]) => {
    if (!CAMPOS[k]) return;   // ignora lo que no sea editable
    if (k === 'estado') {
      const e = txt(v);
      if (e && !ESTADOS_VEHICULO.includes(e)) {
        throw new Error(`Estado no válido: "${e}". Opciones: ${ESTADOS_VEHICULO.join(', ')}`);
      }
      limpio[k] = e;
    } else if (k === 'itv' || k === 'venceSeguro' || k === 'matriculacion') {
      const t = txt(v);
      if (t && !parseFecha(t)) throw new Error(`Fecha no válida en ${k}: "${t}". Usa dd/mm/aaaa`);
      limpio[k] = t;
    } else {
      limpio[k] = txt(v);
    }
  });
  return limpio;
}

async function crearVehiculo(datos) {
  const matricula = normMatricula(datos && datos.matricula);
  if (!matricula) throw new Error('La matrícula es obligatoria');

  await asegurarHoja();
  const [filas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGO]);
  if (filas.slice(1).some(f => normMatricula(f[V.MATRICULA - 1]) === matricula)) {
    throw new Error(`Ya existe un vehículo con la matrícula "${matricula}"`);
  }

  const limpio = validar(datos);
  const fila = Array(HEADERS.length).fill('');
  fila[V.MATRICULA - 1] = matricula;
  Object.entries(limpio).forEach(([k, v]) => { fila[CAMPOS[k] - 1] = v; });

  // Escribir justo debajo del último con matrícula (evita el salto al fondo).
  let ultima = 1;
  for (let i = 1; i < filas.length; i++) if (txt(filas[i][V.MATRICULA - 1])) ultima = i + 1;
  const destino = ultima + 1;
  await writeMany(SPREADSHEET_PLANIFICADOR, [{ range: `${HOJA}!A${destino}:${colLetra(HEADERS.length)}${destino}`, values: [fila] }]);
  return { matricula, fila: destino };
}

async function actualizarVehiculo(selector, campos) {
  await asegurarHoja();
  const [filas] = await readMany(SPREADSHEET_PLANIFICADOR, [RANGO]);

  let fila = null;
  if (selector && selector.fila) {
    fila = Number(selector.fila);
  } else {
    const m = normMatricula(selector && selector.matricula);
    filas.slice(1).forEach((f, i) => { if (normMatricula(f[V.MATRICULA - 1]) === m) fila = i + 2; });
  }
  if (!fila || !txt((filas[fila - 1] || [])[V.MATRICULA - 1])) {
    throw new Error('No se encuentra el vehículo');
  }

  const limpio = validar(campos);
  if (!Object.keys(limpio).length) throw new Error('No se ha recibido ningún cambio');
  const datos = Object.entries(limpio).map(([k, v]) => ({
    range: `${HOJA}!${colLetra(CAMPOS[k])}${fila}`, values: [[v]]
  }));
  await writeMany(SPREADSHEET_PLANIFICADOR, datos);
  return { fila, camposActualizados: Object.keys(limpio) };
}

async function borrarVehiculo(fila) {
  const f = Number(fila);
  if (!f || f < 2) throw new Error('Fila no válida');
  const hojas = await getSheetIds(SPREADSHEET_PLANIFICADOR);
  const idHoja = hojas[HOJA];
  if (idHoja === undefined) throw new Error(`No existe la hoja ${HOJA}`);
  await deleteRows(SPREADSHEET_PLANIFICADOR, idHoja, [f]);
  return { borrada: f };
}

module.exports = {
  HOJA, HEADERS, ESTADOS: ESTADOS_VEHICULO,
  leerVehiculos, crearVehiculo, actualizarVehiculo, borrarVehiculo,
  normMatricula, parseFecha, estadoVencimiento
};
