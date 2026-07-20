const { procesarYUnificar, limpiarCacheDrivers } = require('./boltHorasCore');
const { sleep } = require('./bolt');

// Nombre de las hojas: abril-2025, mayo-2025, ...
const MESES_SLUG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

// Bolt no sirve datos de más de 16 meses atrás. Dejamos un mes de colchón
// para no pedir justo en el borde de la ventana.
const LIMITE_MESES_API = 16;
const MARGEN_DIAS_SEGURIDAD = 5;

// Pausas para no saturar la API: entre meses y entre las dos consultas que se
// hacen dentro de cada mes (conductores y state logs).
const PAUSA_ENTRE_MESES_MS = 8000;
const PAUSA_ENTRE_LLAMADAS_MS = 1500;

// Rango por defecto del backfill: mayo y junio de 2026 ya están hechos.
const RANGO_DEFECTO = {
  desde: { mes: 4, ano: 2025 },
  hasta: { mes: 4, ano: 2026 }
};

// Estado en memoria para poder consultar el progreso mientras corre.
let estado = {
  enCurso: false,
  cancelado: false,
  iniciado: null,
  terminado: null,
  totalMeses: 0,
  procesados: 0,
  actual: null,
  resultados: []
};

/**
 * Pide que el backfill pare. No corta el mes que se esté procesando ahora
 * mismo (dejarlo a medias escribiría una hoja incompleta): termina ese y no
 * arranca el siguiente.
 */
function cancelar() {
  if (!estado.enCurso) return { status: 'nada-que-parar' };
  estado.cancelado = true;
  console.log(`🛑 [HISTÓRICO] Cancelación pedida — se parará al terminar ${estado.actual}`);
  return { status: 'cancelando', terminandoMes: estado.actual, procesados: estado.procesados };
}

function nombreHojaMes(mes, ano) {
  return `${MESES_SLUG[mes - 1]}-${ano}`;
}

function listarMeses(desde, hasta) {
  const meses = [];
  let mes = desde.mes;
  let ano = desde.ano;

  // Tope de seguridad por si llegan parámetros invertidos o absurdos.
  for (let i = 0; i < 120; i++) {
    if (ano > hasta.ano || (ano === hasta.ano && mes > hasta.mes)) break;
    meses.push({ mes, ano });
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }

  return meses;
}

/**
 * Un mes es consultable si su primer día sigue dentro de la ventana de 16
 * meses que acepta la API, y si no es un mes todavía por venir.
 */
function estadoDelMes(mes, ano) {
  const hoy = new Date();

  const limite = new Date();
  limite.setMonth(limite.getMonth() - LIMITE_MESES_API);
  limite.setDate(limite.getDate() + MARGEN_DIAS_SEGURIDAD);

  const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0);

  if (inicioMes < limite) {
    return {
      ok: false,
      motivo: `fuera de la ventana de ${LIMITE_MESES_API} meses de la API ` +
              `(el límite está en ${limite.toLocaleDateString('es-ES')})`
    };
  }

  if (inicioMes > hoy) {
    return { ok: false, motivo: 'el mes aún no ha empezado' };
  }

  return { ok: true };
}

function getEstado() {
  return {
    ...estado,
    resultados: [...estado.resultados]
  };
}

/**
 * Recorre mes a mes creando/actualizando una hoja por mes. Cada mes se procesa
 * de forma independiente: si uno falla, se registra y se sigue con el
 * siguiente en lugar de abortar todo el backfill.
 */
async function procesarHistorico(opciones = {}) {
  if (estado.enCurso) {
    return { status: 'ya-en-curso', ...getEstado() };
  }

  const desde = opciones.desde || RANGO_DEFECTO.desde;
  const hasta = opciones.hasta || RANGO_DEFECTO.hasta;
  const pausaMeses = opciones.pausaMeses !== undefined ? opciones.pausaMeses : PAUSA_ENTRE_MESES_MS;
  const pausaLlamadas = opciones.pausaLlamadas !== undefined ? opciones.pausaLlamadas : PAUSA_ENTRE_LLAMADAS_MS;

  const meses = listarMeses(desde, hasta);

  if (meses.length === 0) {
    return {
      status: 'error',
      msg: `Rango vacío: ${desde.mes}/${desde.ano} → ${hasta.mes}/${hasta.ano}`
    };
  }

  estado = {
    enCurso: true,
    cancelado: false,
    iniciado: new Date().toISOString(),
    terminado: null,
    totalMeses: meses.length,
    procesados: 0,
    actual: null,
    resultados: []
  };

  // El padrón de conductores se recarga en cada pasada, no vale el de la
  // anterior por si ha entrado gente nueva.
  limpiarCacheDrivers();

  console.log(
    `📚 [HISTÓRICO] ${meses.length} meses: ` +
    `${nombreHojaMes(desde.mes, desde.ano)} → ${nombreHojaMes(hasta.mes, hasta.ano)}`
  );

  for (let i = 0; i < meses.length; i++) {
    if (estado.cancelado) {
      console.log(`🛑 [HISTÓRICO] Cancelado tras ${estado.procesados} meses`);
      break;
    }

    const { mes, ano } = meses[i];
    const hoja = nombreHojaMes(mes, ano);
    estado.actual = hoja;

    const disponible = estadoDelMes(mes, ano);
    if (!disponible.ok) {
      console.log(`⏭️  [HISTÓRICO] ${hoja} omitido: ${disponible.motivo}`);
      estado.resultados.push({ hoja, mes, ano, status: 'omitido', msg: disponible.motivo });
      estado.procesados++;
      continue;
    }

    console.log(`🔄 [HISTÓRICO] (${i + 1}/${meses.length}) ${hoja}...`);
    const t0 = Date.now();

    try {
      const result = await procesarYUnificar(mes, ano, {
        hojaDestino: hoja,
        pausaMs: pausaLlamadas,
        // El histórico lleva a todos los conductores con sus cifras reales,
        // despedidos incluidos. Filtrar por estado es cosa del mes en curso.
        incluirTodos: true,
        // Logs primero, nombres después: ver boltHorasCore.
        modoHistorico: true
      });

      const segundos = Math.round((Date.now() - t0) / 1000);
      console.log(`✅ [HISTÓRICO] ${hoja}: ${result.conductores} conductores (${segundos}s)`);

      estado.resultados.push({
        hoja, mes, ano,
        status: 'ok',
        conductores: result.conductores,
        segundos
      });
    } catch (error) {
      console.error(`❌ [HISTÓRICO] ${hoja}: ${error.message}`);
      estado.resultados.push({ hoja, mes, ano, status: 'error', msg: error.message });
    }

    estado.procesados++;

    if (i < meses.length - 1 && pausaMeses > 0) {
      console.log(`⏸️  [HISTÓRICO] Pausa de ${pausaMeses / 1000}s antes del siguiente mes`);
      await sleep(pausaMeses);
    }
  }

  estado.enCurso = false;
  estado.actual = null;
  estado.terminado = new Date().toISOString();

  const ok = estado.resultados.filter(r => r.status === 'ok').length;
  const fallos = estado.resultados.filter(r => r.status === 'error').length;
  const omitidos = estado.resultados.filter(r => r.status === 'omitido').length;

  console.log(`🏁 [HISTÓRICO] Fin: ${ok} ok | ${fallos} con error | ${omitidos} omitidos`);

  return { status: 'completado', ok, fallos, omitidos, ...getEstado() };
}

module.exports = {
  procesarHistorico,
  cancelar,
  getEstado,
  nombreHojaMes,
  listarMeses,
  RANGO_DEFECTO
};
