// ============================================================
// REPORTE DE CONTROL DEL DÍA — todos los conductores (no solo el plan)
// ============================================================
// El "DATOS_API" del día: cuenta a TODO conductor con actividad o previsto, no solo
// a los planificados. Por cada uno, su celda del día (como VISTA_FINAL): las HORAS
// trabajadas o la marca L/V/B/P/J. Cruzando esa celda con quién ESTABA PREVISTO hoy
// (f_cobertura) y un umbral fijo de horas, sale el semáforo:
//
//   salió           = trabajó > 0 h (planificado o no)
//   no salió        = estaba previsto y no trabajó (sin justificar)
//   cumplió horas   = horas >= umbral, o Justificado (J cuenta como trabajado)
//   no cumplió      = salió pero se quedó por debajo del umbral
//
// Reutiliza leerBitacora (la rejilla ya montada, cero hojas) y salidasHoy (el plan).

const { leerBitacora, INICIO } = require('./repo/bitacora');
const { salidasHoy } = require('./repo/planificador');
const db = require('./db');

const TZ = 'Europe/Madrid';
const MS_DIA = 86400000;
const INICIO_MS = Date.UTC(INICIO.y, INICIO.m, INICIO.d);

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// Índice de un día 'YYYY-MM-DD' en la rejilla de la bitácora (0 = INICIO).
const idxDe = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - INICIO_MS) / MS_DIA);
};

// Semáforo de las celdas de HORAS (las marcas L/V/B/P/J traen su propio color de BD).
const SEMAFORO = {
  cumplio:    '#22C55E',   // verde  — llegó al umbral
  no_cumplio: '#FB923C',   // naranja— salió pero corto
  no_salio:   '#EF4444',   // rojo   — previsto y no salió
  sin_dato:   '#94A3B8',   // gris   — ni previsto ni actividad
};

/** Colores y etiquetas de las marcas del día (cat_marca_dia): L/V/B/P/J. */
async function coloresMarca() {
  const m = new Map();
  try {
    const r = await db.consulta('SELECT codigo, etiqueta, color_hex FROM cat_marca_dia');
    r.rows.forEach(x => m.set(x.codigo, { etiqueta: x.etiqueta, color: x.color_hex || '#94A3B8' }));
  } catch (_) { /* sin BD → colores por defecto abajo */ }
  return m;
}

/**
 * @param {string} dia    'YYYY-MM-DD' (por defecto hoy en Madrid)
 * @param {number} umbral horas mínimas para "cumplir" (fijo para todos)
 */
async function reporteDia(dia, umbral = 8) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoyMadrid();
  const umb = Number(umbral) > 0 ? Number(umbral) : 8;

  const [bit, plan, marcas] = await Promise.all([
    leerBitacora(),
    salidasHoy(d),
    coloresMarca(),
  ]);
  const idx = idxDe(d);
  if (idx < 0 || idx > bit.hoyIdx) throw new Error('Ese día está fuera de la rejilla (desde ' +
    `${INICIO.d}/${INICIO.m + 1}/${INICIO.y} hasta hoy)`);

  // Quién estaba PREVISTO hoy (cubre en f_cobertura): el denominador de "no salió".
  const esperados = new Set();
  plan.turnos.forEach(t => t.conductores.forEach(c => esperados.add(String(c.conductorId))));

  const marca = cod => marcas.get(cod) || { etiqueta: cod, color: '#94A3B8' };
  const filas = bit.conductores.map(c => {
    const v = c.dias[idx];                       // número (horas) | 'L'|'V'|'B'|'P'|'J' | null
    const esperado = esperados.has(String(c.conductorId));
    const horas = typeof v === 'number' ? v : null;

    let estado, etiqueta, color, cuenta = {};
    if (typeof v === 'number') {
      if (v >= umb)      { estado = 'cumplio';    etiqueta = 'Cumplió';    color = SEMAFORO.cumplio;    cuenta = { salio: 1, cumplio: 1 }; }
      else if (v > 0)    { estado = 'no_cumplio'; etiqueta = 'No cumplió'; color = SEMAFORO.no_cumplio; cuenta = { salio: 1, noCumplio: 1 }; }
      else               { estado = esperado ? 'no_salio' : 'sin_dato'; etiqueta = esperado ? 'No salió' : '—'; color = esperado ? SEMAFORO.no_salio : SEMAFORO.sin_dato; cuenta = esperado ? { noSalio: 1 } : {}; }
    } else if (v === 'J') { estado = 'justificado'; etiqueta = marca('J').etiqueta; color = marca('J').color; cuenta = { cumplio: 1, justificado: 1 }; }
    else if (v === 'L')   { estado = 'libra';       etiqueta = marca('L').etiqueta; color = marca('L').color; cuenta = { libra: 1 }; }
    else if (v === 'V' || v === 'B' || v === 'P') { estado = 'ausente'; etiqueta = marca(v).etiqueta; color = marca(v).color; cuenta = { ausente: 1, ['marca_' + v]: 1 }; }
    else                  { estado = esperado ? 'no_salio' : 'sin_dato'; etiqueta = esperado ? 'No salió' : '—'; color = esperado ? SEMAFORO.no_salio : SEMAFORO.sin_dato; cuenta = esperado ? { noSalio: 1 } : {}; }

    return {
      conductorId: c.conductorId, nombre: c.id, turno: c.turno || '',
      esperado, horas, valor: v, marca: /^[LVBPJ]$/.test(v) ? v : null,
      estado, etiqueta, color,
      _cuenta: cuenta,
    };
  });

  // Contadores.
  const acc = (k) => filas.reduce((s, f) => s + (f._cuenta[k] || 0), 0);
  const contadores = {
    total: filas.length,
    esperados: esperados.size,
    salieron: acc('salio'),
    noSalieron: acc('noSalio'),
    cumplieron: acc('cumplio'),
    noCumplieron: acc('noCumplio'),
    justificados: acc('justificado'),
    libranzas: acc('libra'),
    ausencias: acc('ausente'),
    marcas: { V: acc('marca_V'), B: acc('marca_B'), P: acc('marca_P') },
    horasTotal: Math.round(filas.reduce((s, f) => s + (f.horas || 0), 0) * 10) / 10,
  };

  // Orden: primero lo que pide acción (no salió), luego no cumplió, cumplió, y el
  // resto (justificados, libranzas, ausencias) al final. Dentro, por nombre.
  const PRIO = { no_salio: 0, no_cumplio: 1, cumplio: 2, justificado: 3, libra: 4, ausente: 5, sin_dato: 6 };
  filas.sort((a, b) => (PRIO[a.estado] - PRIO[b.estado]) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  filas.forEach(f => delete f._cuenta);

  return {
    fecha: d.split('-').reverse().join('/'), dia: d, umbral: umb,
    contadores, conductores: filas,
  };
}

module.exports = { reporteDia };
