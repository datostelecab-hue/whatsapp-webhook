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

// EL «SIN SEÑAL» LO DICE MAPON, NO UN CRONÓMETRO NUESTRO.
//
// La primera versión marcaba en gris todo lo que llevara más de diez minutos sin
// hablar. Estaba mal por los dos lados: un coche aparcado con el contacto
// quitado tarda de sobra ese rato en volver a decir algo y no le pasa nada, y en
// cambio un equipo desenchufado hace tres meses salía igual de gris que uno que
// acaba de callarse. Y peor: en cuanto la vuelta de posiciones se paraba, TODO
// el mapa se iba poniendo gris solo, sin que ningún coche tuviera nada.
//
// Mapon ya contesta esa pregunta él mismo y no hay que adivinarla:
//   · `nodata`  el equipo NO está hablando. Medido el 21/09: los 18 que estaban
//               así llevaban 13 días de media callados, y el peor 87.
//   · `nogps`   el equipo habla pero no coge satélite (un garaje). Son minutos.
//   · `driving` / `standing`  hay dato y es de hace un minuto o cuatro.
//
// Lo que sí es nuestro es si la VUELTA va con retraso, y eso se dice una vez y
// arriba (`frescura`), no pintando cien coches de gris.
const PERDIDOS = ['nodata', 'nogps'];

// LA CACHE VA POR SEDES, NO SUELTA.
//
// Si fuera una sola, la foto ya filtrada del primero se le serviria durante
// diez segundos a todos los demas: quien puede ver Barcelona dejaria de verla
// porque acaba de mirar alguien que no. La clave es la lista de sedes.
const TTL_CACHE_MS = 10000;
const cache = new Map();   // 'madrid' | 'madrid,barcelona' → { ts, datos }
const clave = sedes => (Array.isArray(sedes) && sedes.length ? [...sedes].sort().join(',') : 'todas');

/** De qué color va este coche. La única regla del mapa. */
function tono(c) {
  if (PERDIDOS.includes(c.estado_mapon)) return 'perdido';
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
    : 'Rueda y no hay nadie fichado en BOLT con este coche';
}

/**
 * La foto entera del mapa: los coches ya clasificados y el recuento por tono.
 *
 * `forzar` se salta la caché. Lo usa el botón de recargar a mano, que es el que
 * alguien pulsa justo cuando no se fía de lo que está viendo.
 */
async function frente({ forzar = false, sedes = null } = {}) {
  const k = clave(sedes);
  const guardado = cache.get(k);
  if (!forzar && guardado && Date.now() - guardado.ts < TTL_CACHE_MS) {
    return { ...guardado.datos, deCache: true };
  }

  const [filas, frescura] = await Promise.all([repo.coches(sedes), repo.frescura(sedes)]);

  const coches = filas.map(c => {
    const t = tono(c);
    return {
      unidad: Number(c.mapon_unit),
      matricula: c.matricula || null,
      lat: Number(c.lat), lng: Number(c.lng),
      velocidad: c.velocidad == null ? null : Number(c.velocidad),
      rumbo: c.rumbo == null ? null : Number(c.rumbo),
      antiguedad: c.antiguedad == null ? null : Number(c.antiguedad),
      // Segundos que lleva en ese estado SEGUN MAPON, no segun una cuenta
      // nuestra. Es lo que deja decir "rodando desde hace 12 min" y lo que
      // decide si un rojo ya es de fiar.
      llevaAsi: c.lleva_asi == null ? null : Number(c.lleva_asi),
      rueda: c.estado_mapon === 'driving',
      estadoVehiculo: c.estado_vehiculo || null,
      operativo: c.coche_operativo !== false,
      estadoMapon: c.estado_mapon || null,
      situacion: c.situacion || null,
      situacionEtiqueta: c.situacion_etiqueta || null,
      conectado: c.conectado === true,
      conductor: c.conductor || null,
      telefono: c.telefono || null,
      // Segundos que lleva en esa situación; la vista lo pinta como "2 h 14".
      desdeHace: c.segundos_situacion == null ? null : Number(c.segundos_situacion),
      km: c.km == null ? null : Number(c.km),
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
      unidades: Number(frescura.dentro || 0),
      hace: frescura.hace == null ? null : Number(frescura.hace),
      // Los que NO se pintan, para poder decirlo. Desaparecer a la vista es
      // limpiar; desaparecer en silencio es que un dia falte un coche y nadie
      // sepa por que.
      sinFicha: Number(frescura.sin_ficha || 0),
      otraSede: Number(frescura.otra_sede || 0),
    },
  };
  cache.set(k, { ts: Date.now(), datos });
  return { ...datos, deCache: false };
}

/**
 * Los que están en rojo AHORA y ya llevan un rato así. Es lo que mira el aviso.
 *
 * `minSegundos` es la clave de que esto no sea un timbre: un coche tiene que
 * llevar rodando ese rato seguido —según el reloj de Mapon, no según una cuenta
 * nuestra que se perdería en cada despliegue— antes de contar como suelto.
 * Medido el 21/09/2026 muestreando cada 30 s durante cinco minutos: de cinco
 * rojos, ninguno parpadeó y tres aguantaron las diez vueltas. El rojo es señal
 * sólida; el rato de espera es solo por si BOLT llega tarde al conectarse.
 */
async function sueltos({ sedes = null, minSegundos = 180 } = {}) {
  const d = await frente({ forzar: true, sedes });
  return d.coches.filter(c => c.tono === 'suelto'
    && c.llevaAsi != null && c.llevaAsi >= minSegundos);
}

/** Se llama al escribir posiciones nuevas: la foto de antes ya no vale. */
const olvidar = () => { cache.clear(); };

module.exports = { frente, sueltos, olvidar, tono, PERDIDOS };
