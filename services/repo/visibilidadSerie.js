// ============================================================
// VISIBILIDAD · LAS FOTOS DE UN RANGO — el SQL de las series largas
// ============================================================
// Las series largas de Visibilidad (el gráfico de los días con rangos, «cómo
// vamos» y «cómo hemos crecido») NO recalculan el núcleo día a día: leen las
// fotos diarias que ya existen. Son dos tablas, y este fichero solo las lee:
//
//   · visibilidad_dia            la foto del núcleo (fv_tramo), que escribe el
//                                cron y el relleno perezoso de serieMes.
//   · visibilidad_dia_historico  los días de ANTES de que el núcleo tuviera
//                                datos (antes del 01/07/2026), sacados de los
//                                estados de BOLT. La crea y la carga db/217;
//                                el núcleo nunca la recalcula ni la pisa.
//
// Qué vale cada día (el contrato entre las dos) NO se decide aquí: es una regla
// y vive en services/visibilidadTendencia.js (`fundirDias`), donde la prueba el
// comprobador. Aquí solo se devuelven las filas tal cual.
//
// SIN db/217 la tabla del histórico no existe (42P01): se devuelve vacía y con
// `falta: true`, para que la pantalla siga funcionando con lo del núcleo y lo
// pueda decir. Es la trampa de «una columna de la migración que aún no está para
// un cron entero» (Trampas conocidas): Camilo aplica las migraciones DESPUÉS de
// desplegar.

const db = require('../db');
const fv = require('../flotaViva/db');

const falta = e => !!e && e.code === '42P01';
const num = x => Number(x) || 0;

/** Las fotos del núcleo entre dos días ('AAAA-MM-DD', los dos incluidos). */
async function fotos(desde, hasta) {
  if (!db.HAY_BD) return [];
  const r = await db.consulta(
    `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, viaje_seg, espera_seg, conductores
       FROM visibilidad_dia
      WHERE dia >= $1::date AND dia <= $2::date
      ORDER BY dia`, [desde, hasta]);
  return r.rows.map(x => ({ dia: x.dia, viajeSeg: num(x.viaje_seg), esperaSeg: num(x.espera_seg), conductores: num(x.conductores) }));
}

/**
 * Los días del histórico de BOLT entre dos días. `{ filas, falta }`: sin la
 * tabla (db/217 sin aplicar), filas vacías y `falta: true`.
 */
async function historico(desde, hasta) {
  if (!db.HAY_BD) return { filas: [], falta: false };
  try {
    const r = await db.consulta(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, viaje_seg, espera_seg, conductores, fuente
         FROM visibilidad_dia_historico
        WHERE dia >= $1::date AND dia <= $2::date
        ORDER BY dia`, [desde, hasta]);
    return {
      falta: false,
      filas: r.rows.map(x => ({
        dia: x.dia, viajeSeg: num(x.viaje_seg), esperaSeg: num(x.espera_seg),
        // Un hueco no es un cero: sin el dato de conductores, null.
        conductores: x.conductores == null ? null : num(x.conductores),
        fuente: x.fuente || null,
      })),
    };
  } catch (e) {
    if (falta(e)) return { filas: [], falta: true };
    throw e;
  }
}

/**
 * El primer día con horas de verdad en cualquiera de las dos tablas, o null.
 * visibilidad_dia tiene filas a cero desde el 01/05/2026 (mayo y junio, de antes
 * de encender la ingesta): por eso se busca el primero CON horas, no el primero.
 */
async function primerDia() {
  if (!db.HAY_BD) return null;
  const nucleo = db.consulta(
    `SELECT to_char(min(dia), 'YYYY-MM-DD') AS d FROM visibilidad_dia WHERE viaje_seg + espera_seg > 0`);
  const hist = db.consulta(
    `SELECT to_char(min(dia), 'YYYY-MM-DD') AS d FROM visibilidad_dia_historico WHERE viaje_seg + espera_seg > 0`)
    .catch(e => { if (falta(e)) return { rows: [] }; throw e; });
  const [a, b] = await Promise.all([nucleo, hist]);
  const dias = [a.rows[0] && a.rows[0].d, b.rows[0] && b.rows[0].d].filter(Boolean).sort();
  return dias[0] || null;
}

// El primer día que tiene el núcleo (fv_tramo). Antes de él no hay nada que
// recalcular: serieMes rehacía cada vez los 30 días a cero de junio (30 consultas
// al núcleo para escribir otra vez ceros) solo por abrir julio y compararlo con
// junio. Se guarda diez minutos: solo se mueve si alguien rellena tramos viejos.
let _primerTramo = { valor: undefined, at: 0 };
async function primerDiaNucleo() {
  if (!fv.HAY_BD) return null;
  if (_primerTramo.valor !== undefined && Date.now() - _primerTramo.at < 10 * 60 * 1000) return _primerTramo.valor;
  await fv.preparar();
  const r = await fv.consulta(
    `SELECT to_char(min(desde) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS d FROM fv_tramo`);
  _primerTramo = { valor: (r.rows[0] && r.rows[0].d) || null, at: Date.now() };
  return _primerTramo.valor;
}

module.exports = { fotos, historico, primerDia, primerDiaNucleo };
