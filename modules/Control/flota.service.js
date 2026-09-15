// ============================================================
// FLOTA · SERVICIO — la traza del coche que alimenta "En directo"
// ============================================================
// LAS PANTALLAS DE FLOTA VIVA YA NO EXISTEN (11/09/2026). El mural de coches y
// su histórico de partes contaban un sistema de alertas de vehículo apagado
// desde el 08/09, así que enseñaban una foto fija: quien entraba veía un tablero
// en verde de un día que no era hoy. El histórico es ahora `/control/historico`.
//
// Lo que sigue vivo son las APIs, y las consume el cockpit: la traza de un
// conductor, las incidencias del coche y su gestión. Por eso están aquí y no en
// `services/`: su único cliente es Control.
//
// ── LO QUE HAY QUE SABER ────────────────────────────────────────────────────
//
// · EL NÚCLEO NO ES DE ESTE MÓDULO. `fv_tramo`, `fv_ruta` y las franjas viven en
//   `services/flotaViva/` y los leen también Nóminas, Visibilidad, Bitácora,
//   Sanciones e Inicio. Aquí se entra a ellos, no se guardan.
//
// · UN RANGO LARGO NO PUEDE IR SÍNCRONO. Un backfill de un mes son minutos y el
//   HTTP se corta a la mitad, dejando el trabajo hecho a medias y sin respuesta.
//   A partir del umbral se lanza en segundo plano y se sigue por los logs. Todos
//   los backfills son idempotentes, así que repetir una ventana no duplica nada.
//
// · LAS HORAS QUE SE VIGILAN LAS DICE LA BASE, no la pantalla. Se cambian con un
//   UPDATE y sin desplegar; un texto fijo en el .ejs quedaría desfasado el día
//   que alguien mueve un turno, y encima diciendo que no se avisa a unas horas
//   a las que sí se avisa.
//
// · LAS DOS RUTAS DE MAPON EN CRUDO SON DEPURACIÓN, y existen por un motivo: los
//   km salieron mal y no había forma de saber si el fallo estaba en la cuenta o
//   en lo que llega. Los nombres de los campos de Mapon —`mileage`,
//   `last_update`— y sus unidades no están documentados en ningún sitio nuestro.

const panel = require('./panel.service');
const motor = require('../../services/flotaViva/motor');
const franjasRepo = require('../../services/flotaViva/franjas');
const rutas = require('../../services/flotaViva/rutas');
const fuentes = require('../../services/flotaViva/fuentes');

/** Hoy en Madrid, 'YYYY-MM-DD'. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ── El panel y sus incidencias ─────────────────────────────────────────────

const estado = () => panel.estado();

const historial = (matricula, dias) => panel.historial(matricula, Number(dias) || 2);

/** Como el anterior pero POR CONDUCTOR: sus trazos en cualquier coche. */
const historialConductor = (conductorId, dias) =>
  panel.historialConductor(conductorId, Number(dias) || 1);

/** Fuerza una vuelta sin esperar al cron: "acabo de desconectarme y no salgo". */
const refrescar = async () => ({ ...(await motor.pasada()), ...(await panel.estado()) });

/**
 * Lo que hay que llamar ahora. Se pide aparte del estado porque se mira mucho
 * más a menudo y pesa mucho menos.
 */
const incidencias = ({ dia, franja, todas } = {}) =>
  panel.incidencias({ dia, franja, incluirJustificadas: todas === '1' });

/**
 * Cómo se clasifica esta incidencia en el Call Center y qué resultados admite.
 * Se pide al abrir el diálogo: los resultados válidos dependen del motivo, y
 * mandar uno que no le corresponde hace que la llamada no se registre.
 */
const clasificacionDe = id => panel.clasificacionDe(id);

/** Las horas que se vigilan, tal como están en la base AHORA. */
async function franjas() {
  const f = await franjasRepo.franjas();
  return f.map(x => ({
    codigo: x.codigo, etiqueta: x.etiqueta, inicioMin: x.inicio_min, finMin: x.fin_min,
  }));
}

/** Las formas de cerrar una incidencia. Cuál crea llamada lo dice la base. */
const gestiones = () => panel.gestiones();

/**
 * CERRAR una incidencia: llamando o ignorándola. Las dos exigen motivo y las dos
 * quedan con nombre y hora — ignorar no es hacerla desaparecer.
 *
 * Si la gestión crea llamada, además se REGISTRA EN EL CALL CENTER: es una
 * llamada de verdad y tiene que contar en sus KPIs y en su reincidencia.
 */
async function justificar(id, datos, quien) {
  const b = datos || {};
  const r = await panel.justificar(id, {
    gestion: b.gestion, motivo: b.motivo, resultado: b.resultado, accion: b.accion, quien,
  });
  if (r.yaEstaba) {
    console.log(`🤝 [FLOTA] Incidencia ${r.id}: ${quien || '(sin nombre)'} llegó tarde, ` +
      `ya la cerró ${r.por || '(sin nombre)'} — ${r.gestionEtiqueta || r.gestion}`);
  } else {
    console.log(`✍️  [FLOTA] Incidencia ${r.id} — ${r.gestionEtiqueta} — por ${quien || '(sin nombre)'}` +
      (r.llamada ? ` · llamada ${r.llamada}` : r.sinLlamada ? ` · SIN llamada: ${r.sinLlamada}` : ''));
  }
  return r;
}

/**
 * "He llamado" — un intento desde En directo. NO cierra la incidencia ni crea
 * llamada en el Call Center: solo deja rastro. Se puede pulsar tantas veces como
 * se llame (no cogen, se vuelve a marcar).
 */
async function heLlamado(id, quien, nota) {
  const r = await panel.seguir(id, { quien, nota });
  console.log(`📞 [FLOTA] "He llamado" incidencia ${r.id} (intento nº ${r.veces}) — ${quien || '(sin nombre)'}`);
  return r;
}

const seguimientos = id => panel.seguimientos(id);
const cierre = ({ dia, franja } = {}) => panel.cierre({ dia, franja });
const partes = ({ desde, hasta } = {}) => panel.partes({ desde, hasta });

// ── Mapon en crudo (depuración) ────────────────────────────────────────────

/** Lo que manda Mapon TAL CUAL para una matrícula, y lo que entendemos de ello. */
async function maponDe(matricula) {
  const mat = fuentes.normMat(matricula);
  const u = (await fuentes.flotaMapon()).get(mat);
  return {
    matricula: mat,
    encontrado: !!u,
    interpretado: u || null,          // lo que hemos entendido nosotros...
    crudo: await fuentes.crudoDeUnidad(mat),   // ...y lo que llega de verdad
  };
}

/**
 * Los trayectos de Mapon de un coche en las últimas N horas, TAL CUAL. Es la
 * distancia BUENA —la de "Informes/Rutas"— para construir los km encima: el
 * `mileage` de unit/list llega estancado (marca un odómetro de hace horas y no
 * cambia entre vueltas, así que la resta da cero).
 */
async function maponRutas(matricula, horas) {
  const mat = fuentes.normMat(matricula);
  const u = (await fuentes.flotaMapon()).get(mat);
  if (!u) return { matricula: mat, encontrado: false };
  // Mapon exige ISO 8601 con T y Z (no 'AAAA-MM-DD HH:MM:SS'): ese fue el error.
  const iso = d => d.toISOString().slice(0, 19) + 'Z';
  const n = Math.min(Math.max(Number(horas) || 24, 1), 168);
  const fin = new Date();
  const ini = new Date(fin.getTime() - n * 3600 * 1000);
  return {
    matricula: mat, unitId: u.unitId, desde: iso(ini), hasta: iso(fin),
    crudo: await fuentes.rutasDeUnidad(u.unitId, iso(ini), iso(fin)),
  };
}

// ── Ingesta manual (rellenar un hueco, o el histórico) ─────────────────────

/** Días entre `desde` y ahora. Sin `desde`, uno. */
const diasDesde = desde => (desde ? (Date.now() - new Date(desde).getTime()) / 86400000 : 1);

const ENSEGUNDOPLANO = 'Corre en segundo plano. Mira los logs de Render (progreso por ventana)';

/**
 * BACKFILL de km: pide a Mapon los trayectos del rango y los mete en `fv_ruta`.
 * Sirve para rellenar ayer+hoy en pruebas, o para tapar un hueco si el cron
 * estuvo caído. Idempotente (clave unit_id + route_id).
 */
async function ingestarRutas({ desde, hasta, dias, bg } = {}) {
  let d = desde;
  if (!d && dias) d = new Date(Date.now() - Number(dias) * 86400000).toISOString();

  if (bg === '1' || diasDesde(d) > 7) {
    rutas.ingestarRutas({ desde: d, hasta })
      .then(r => console.log(`🛰️  [FLOTA] Backfill rutas TERMINADO: ${r.trayectos} trayecto(s), ${r.km} km`))
      .catch(e => console.error('❌ [FLOTA] Backfill rutas falló:', e.message));
    return {
      iniciado: true, desde: d || '(auto)', hasta: hasta || '(ahora)',
      nota: `${ENSEGUNDOPLANO} o /flota-viva/api/km-hoy.`,
    };
  }

  const r = await rutas.ingestarRutas({ desde: d, hasta });
  console.log(`🛰️  [FLOTA] Backfill rutas: ${r.trayectos} trayecto(s), ${r.km} km (${r.desde} → ${r.hasta})`);
  return r;
}

/**
 * BACKFILL de HORAS (`fv_tramo`): reconstruye del histórico de BOLT
 * (state-logs). Idempotente (borra y reinserta el rango, sin tocar el tramo
 * vivo, que aún se está cerrando).
 */
const backfillTramos = ({ desde, hasta, bg } = {}) =>
  enSegundoPlanoSiHaceFalta('backfill-tramos', { desde, hasta, bg },
    (d, h) => require('../../services/flotaViva/backfill').backfillTramos({ desde: d, hasta: h }),
    'hasta el tramo vivo', 'luego se ve en /visibilidad');

/** BACKFILL FINANCIERO (`bolt_order`: neto y viajes). Idempotente (ON CONFLICT). */
const backfillOrders = ({ desde, hasta, bg } = {}) =>
  enSegundoPlanoSiHaceFalta('backfill-orders', { desde, hasta, bg },
    (d, h) => require('../../services/flotaViva/backfill').backfillOrders({ desde: d, hasta: h }),
    'ahora', '');

/** El umbral de los dos backfills del histórico es más corto: reconstruyen coche a coche. */
async function enSegundoPlanoSiHaceFalta(tarea, { desde, hasta, bg }, correr, sinHasta, extra) {
  if (!desde) throw new Error('Falta ?desde=AAAA-MM-DD');
  if (bg === '1' || diasDesde(desde) > 3) {
    correr(desde, hasta).catch(e => console.error(`❌ [FLOTA] ${tarea} falló:`, e.stack || e.message));
    return {
      iniciado: true, tarea, desde, hasta: hasta || `(${sinHasta})`,
      nota: `${ENSEGUNDOPLANO}${extra ? '; ' + extra : ''}.`,
    };
  }
  return correr(desde, hasta);
}

/**
 * Los km de hoy por coche que verá el cockpit, del núcleo. Es la comprobación:
 * si esto sale con datos y el cockpit no, el problema es de pintado; si sale
 * vacío, es de ingesta o del cruce por `unit_id`.
 */
async function kmDeHoy(dia) {
  const d = dia || hoyMadrid();
  const m = await rutas.kmPorCoche(d);
  const coches = [...m.entries()].map(([matricula, x]) => ({ matricula, ...x })).sort((a, b) => b.km - a.km);
  return {
    dia: d, coches: coches.length,
    kmTotal: Math.round(coches.reduce((s, c) => s + c.km, 0) * 10) / 10,
    top: coches.slice(0, 15),
  };
}

module.exports = {
  estado, historial, historialConductor, refrescar,
  incidencias, clasificacionDe, franjas, gestiones,
  justificar, heLlamado, seguimientos, cierre, partes,
  maponDe, maponRutas,
  ingestarRutas, backfillTramos, backfillOrders, kmDeHoy,
};
