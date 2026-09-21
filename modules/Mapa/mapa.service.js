// ============================================================
// MAPA — servicio
// ============================================================
// LA PUERTA DEL MÓDULO. Aquí vive la única regla del mapa: de qué color va cada
// coche. La base dice dónde está y qué hace; decidir qué significa eso es de
// aquí, no de una consulta ni de la vista.
//
// ── EL SEMÁFORO ────────────────────────────────────────────────────────────
//
// La pregunta que hay que contestar de un vistazo es «¿hay algún coche rodando
// sin que nadie esté dando servicio?». Por eso el reparto no es por estado de
// BOLT ni por estado de Mapon: es por LOS DOS A LA VEZ.
//
//   trabajando  verde   rueda y está en viaje o en espera. Lo normal.
//   parado      apagado no se mueve. Da igual lo que diga BOLT: no hay nada que mirar.
//   descanso    ámbar   rueda estando en descanso. Conectado, pero no da servicio.
//   suelto      ROJO    RUEDA Y NO HAY NADIE CONECTADO. Esto es lo que se busca.
//   perdido     gris    el equipo lleva rato sin hablar: no se sabe.
//
// `suelto` incluye dos casos distintos a propósito: el coche que está en BOLT
// con el conductor desconectado, y el equipo que no casa con ningún coche de
// BOLT. Los dos son «se mueve y nadie responde por él», que es la pregunta.
// Cuál de los dos es se dice en el detalle, no en el color.
//
// ── POR QUÉ HAY CACHÉ ──────────────────────────────────────────────────────
//
// La consulta cuesta unos 340 ms, casi todo de `fv_ahora`, que es una vista que
// trabaja. Con quince pantallas abiertas refrescando cada 30 s serían quince
// veces ese trabajo para devolver EXACTAMENTE lo mismo: el dato solo cambia
// cuando corre la vuelta de Mapon.
//
// Así que se calcula una vez y se reparte. Diez segundos de caché es menos de
// lo que tarda el dato en cambiar (~67 s el equipo del coche), así que no se
// enseña nada más viejo de lo que ya era.

const repo = require('./mapa.repo');

// Un dato que no ha hablado en este rato deja de ser «dónde está el coche» y
// pasa a ser «dónde estuvo». Diez minutos: el equipo renueva cada ~67 s
// conduciendo y cada ~3 min parado, así que llegar a diez es estar callado.
const SEGUNDOS_PERDIDO = 600;

const TTL_CACHE_MS = 10000;
let cache = { ts: 0, datos: null };

/** De qué color va este coche. La única regla del mapa. */
function tono(c) {
  if (c.antiguedad != null && c.antiguedad > SEGUNDOS_PERDIDO) return 'perdido';
  if (c.estado_mapon !== 'driving') return 'parado';
  if (c.situacion === 'viaje' || c.situacion === 'espera') return 'trabajando';
  if (c.situacion === 'descanso') return 'descanso';
  return 'suelto';
}

/** Por qué está en rojo, dicho con palabras. Se enseña al pinchar el coche. */
function porQue(c, t) {
  if (t !== 'suelto') return null;
  return c.situacion
    ? `Rueda y ${c.conductor || 'su conductor'} no está conectado en BOLT`
    : 'Rueda y este equipo no casa con ningún coche de BOLT';
}

/**
 * La foto entera del mapa: los coches ya clasificados y el recuento por tono.
 *
 * `forzar` se salta la caché. Lo usa el botón de recargar a mano, que es el que
 * alguien pulsa justo cuando no se fía de lo que está viendo.
 */
async function frente({ forzar = false } = {}) {
  if (!forzar && cache.datos && Date.now() - cache.ts < TTL_CACHE_MS) {
    return { ...cache.datos, deCache: true };
  }

  const [filas, frescura] = await Promise.all([repo.coches(), repo.frescura()]);

  const coches = filas.map(c => {
    const t = tono(c);
    return {
      unidad: Number(c.mapon_unit),
      matricula: c.matricula || null,
      lat: Number(c.lat), lng: Number(c.lng),
      velocidad: c.velocidad == null ? null : Number(c.velocidad),
      rumbo: c.rumbo == null ? null : Number(c.rumbo),
      antiguedad: c.antiguedad == null ? null : Number(c.antiguedad),
      rueda: c.estado_mapon === 'driving',
      estadoMapon: c.estado_mapon || null,
      situacion: c.situacion || null,
      situacionEtiqueta: c.situacion_etiqueta || null,
      conectado: c.conectado === true,
      conductor: c.conductor || null,
      telefono: c.telefono || null,
      // Segundos que lleva en esa situación; la vista lo pinta como "2 h 14".
      desdeHace: c.segundos_situacion == null ? null : Number(c.segundos_situacion),
      km: c.km == null ? null : Number(c.km),
      deLaFlota: c.de_la_flota === true,
      sede: c.sede || null,
      tono: t,
      motivo: porQue(c, t),
    };
  });

  const cuenta = coches.reduce((a, c) => { a[c.tono] = (a[c.tono] || 0) + 1; return a; }, {});
  const datos = {
    coches,
    cuenta,
    // Lo que de verdad importa del resumen: cuántos hay ahora mismo sueltos.
    sueltos: cuenta.suelto || 0,
    frescura: {
      unidades: frescura.unidades || 0,
      hace: frescura.hace == null ? null : Number(frescura.hace),
    },
  };
  cache = { ts: Date.now(), datos };
  return { ...datos, deCache: false };
}

/** Se llama al escribir posiciones nuevas: la foto de antes ya no vale. */
const olvidar = () => { cache = { ts: 0, datos: null }; };

module.exports = { frente, olvidar, SEGUNDOS_PERDIDO };
