// ============================================================
// ALERTAS DE CONTROL · SERVICIO — qué se avisa, y a quién
// ============================================================
// La vigilancia de las franjas críticas: km rodando en descanso, ofertas sin
// contestar, rechazos a dedo. Cuando alguien pasa un umbral, un WhatsApp a los
// controladores elegidos.
//
// ── LO QUE HAY QUE SABER ────────────────────────────────────────────────────
//
// · NACE EN MODO PRUEBAS Y SIN DESTINATARIOS. Registra las alertas y no manda
//   nada. Hasta que no se elige a alguien en `/alertas/config` y se pasa el modo
//   a `live`, no sale un solo WhatsApp por mucho que alguien rechace viajes.
//
// · UN MENSAJE POR ALERTA LO GARANTIZA LA BASE, NO LA APLICACIÓN. Es un índice
//   único, no un `if`: dos pasadas del cron a la vez —o el botón de "Revisar
//   ahora" pulsado mientras corre el cron— no pueden mandar el mismo aviso dos
//   veces. Un guardia escrito en JavaScript sí se lo salta.
//
// · REVISAR A MANO HACE EXACTAMENTE LO MISMO QUE EL CRON. No es un camino
//   distinto con sus propias reglas: si la franja está cerrada no manda nada, y
//   lo ya avisado no se repite. Por eso el botón es seguro de pulsar.
//
// · QUIEN NO TIENE TELÉFONO NO RECIBE. Un destinatario con el hueco vacío —o
//   con un número de relleno— se guarda igual, pero el repositorio lo deja
//   fuera del envío en vez de gastar un intento que va a fallar.
//
// Este servicio es fino a propósito: la regla de cada umbral y el orden del
// envío viven en `alertas.repo`, que es quien habla con la base y con WhatsApp.
// Lo que se gana poniéndolo aquí es la puerta: desde fuera del módulo —el cron
// de `app.js`, por ejemplo— se entra por este fichero y no por el repositorio.

const repo = require('./alertas.repo');

/** Cómo va la franja de ahora: quién pasa el umbral y qué se ha avisado ya. */
const estado = ({ dia } = {}) => repo.estado({ dia });

/** Lo avisado en un día, para poder mirar hacia atrás. */
const historial = ({ dia } = {}) => repo.historial({ dia });

/**
 * REVISAR AHORA (el botón). Lo mismo que el cron, y se devuelve el estado
 * recién calculado para que la pantalla se repinte sin una segunda petición.
 */
async function revisar() {
  const resultado = await repo.revisar({});
  console.log(`🔔 [ALERTAS] Revisión: ${resultado.nuevas || 0} nueva(s), ${resultado.enviadas || 0} envío(s)` +
    (resultado.modo && resultado.modo !== 'live' ? ' (PRUEBAS)' : ''));
  return resultado;
}

/** El botón, con el estado detrás: una sola vuelta para la pantalla. */
const revisarYMirar = async () => ({ resultado: await revisar(), ...(await estado({})) });

/**
 * EL AVISO DEL COCHE SUELTO, AL MOMENTO.
 *
 * Va aparte de `revisar()` porque va a otro ritmo: aquella mira franjas y
 * umbrales de kilómetros y corre cada cinco minutos dentro de unas horas
 * concretas; esta cuelga de la vuelta del mapa, cada treinta segundos y a
 * cualquier hora. Un coche rodando solo a las cuatro de la mañana es MÁS raro,
 * no menos.
 *
 * AQUÍ SE JUNTAN LOS DOS MÓDULOS, y es el único sitio donde pasa: el mapa dice
 * QUIÉNES están en rojo —la regla vive allí, una sola vez— y las alertas saben
 * a quién avisar, cómo no repetirse y cómo mandarlo. Ninguno de los dos
 * repositorios sabe del otro.
 *
 * Solo Madrid: el aviso se recorta como la pantalla. Quien mire el mapa y
 * reciba el mensaje tiene que ver lo mismo.
 */
async function avisarSueltos({ sedes = ['madrid'] } = {}) {
  const mapa = require('../Mapa/mapa.service');
  const def = repo.MODELO.tipos.rueda_suelto || {};
  const coches = await mapa.sueltos({ sedes, minSegundos: (def.umbral || 3) * 60 });
  if (!coches.length) return { vistos: 0, nuevas: 0, enviadas: 0 };

  const r = await repo.revisarSueltos({ coches });
  if (r.nuevas) {
    console.log(`🚨 [ALERTAS] ${r.nuevas} coche(s) rodando sin nadie: `
      + r.detalle.map(d => `${d.matricula} (${d.minutos} min, ${d.conductor})`).join(', ')
      + ` · ${r.enviadas} envío(s)${r.modo !== 'live' ? ' (PRUEBAS)' : ''}`);
  }
  return r;
}

// ── Ajustes (permiso aparte: '/alertas/config') ────────────────────────────
// Ver las alertas es una cosa y decidir a quién le llegan es otra. El permiso
// de configuración nace apagado para todo el mundo y lo reparte el
// desarrollador uno a uno: era el requisito, "solo yo elijo a quién le llegan".

async function guardarConfig(patch, quien) {
  const config = await repo.guardarConfig(patch || {}, quien);
  console.log(`⚙️ [ALERTAS] Ajustes guardados · modo ${config.modo}`);
  return { config };
}

async function guardarDestinatarios(ids, quien) {
  const destinatarios = await repo.guardarDestinatarios(ids, quien);
  const reciben = destinatarios.filter(x => x.recibe);
  console.log(`👥 [ALERTAS] Reciben ahora: ${reciben.map(x => x.nombre).join(', ') || '(nadie)'}`);
  return { destinatarios };
}

module.exports = {
  estado, historial, revisar, revisarYMirar, avisarSueltos,
  guardarConfig, guardarDestinatarios,
  // Para el cockpit y el histórico, que reconstruyen las franjas de un día.
  leerConfig: repo.leerConfig, candidatos: repo.candidatos, franjaDe: repo.franjaDe,
};
