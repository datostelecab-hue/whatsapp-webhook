// ============================================================
// MAPA — servicio
// ============================================================
// LA PUERTA DEL MÓDULO. Aquí vive la única regla del mapa: de qué color va cada
// coche. La base dice dónde está y qué hace; decidir qué significa eso es de
// aquí, no de una consulta ni de la vista.
//
// ── EL SEMÁFORO (24/09/2026) ───────────────────────────────────────────────
//
// El reparto no es por estado de BOLT ni por estado de Mapon: es por LOS DOS A
// LA VEZ, y en este orden, que es el que pidió Camilo para los filtros:
//
//   viaje        verde        de viaje en BOLT. Lo normal.
//   espera       azul         en espera DENTRO de la M-30: donde tiene que estar.
//   esperafuera  azul que     en espera FUERA de la M-30. No es una falta, pero
//                parpadea     hay que mirarlo: la espera se hace dentro.
//   descanso     amarillo     rueda estando en descanso. Conectado, sin dar servicio.
//   suelto       ROJO         RUEDA Y NO HAY NADIE CONECTADO. Lo que más se busca.
//   errorgps     morado       de viaje en BOLT y Mapon lo da por parado. No
//                             puede ser: el GPS no está dando la posición real.
//
// Y lo que no es ninguno de esos seis: `parado` (no se mueve y no está
// trabajando), `singps` y `perdido` (el equipo no fija o no habla) y
// `sinmapon` (de Mapon no hay nada).
//
// Antes «trabajando» juntaba viaje y espera, y solo si el coche rodaba: un
// coche esperando aparcado —que es como se espera— salía apagado, igual que
// uno que nadie usa. La espera va ahora por su lado, se mueva o no, y lo que la
// separa es DÓNDE está.
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
const { dentroDeM30, kmHastaM30 } = require('./m30');

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
// Y NO SON LO MISMO, aunque Mapon los ponga juntos. Lo dijo Camilo el
// 23/09/2026 mirando el mapa: "dice sin señal y en Mapon sí me dice dónde
// están". Tenía razón, y la diferencia es grande:
//
//   nodata  el equipo NO habla. Medido ese día: los 10 que estaban así
//           llevaban 18 días de media callados, y el peor 89. Eso sí es
//           SIN SEÑAL: no se sabe dónde está el coche.
//   nogps   el equipo habla —los 5 de ese día lo habían hecho hacía entre 83
//           y 250 segundos— pero no coge satélite: un garaje, un túnel. La
//           posición que se pinta es la última buena, de hace minutos, y es
//           la MISMA que enseña Mapon en su pantalla. Llamar a eso "sin
//           señal" es acusar al equipo de algo que no pasa.
//
// Así que cada uno va por su lado: `nodata` es gris de "no se sabe", y `nogps`
// es un coche que está donde dice, con el GPS callado.
const PERDIDOS = ['nodata'];
const SIN_GPS = 'nogps';

// EL ERROR DE GPS: de viaje en BOLT y Mapon lo da por parado. Lo pidió Camilo
// el 24/09/2026: «no es posible que un coche esté de viaje en BOLT y Mapon
// diga que está detenido». Medido ese día, el 9590MMX llevaba DOS HORAS así,
// con el equipo sin dar señales nuevas desde hacía cinco minutos.
//
// Pero parado un rato sí puede estar: un semáforo, un atasco, esperando al
// pasajero en la recogida. Diez minutos seguidos parado según Mapon —el
// `start` de su propio estado— ya no es nada de eso. En la muestra de ese día,
// fuera del 9590MMX no hubo ni uno de viaje y parado.
const GPS_PARADO_S = 600;

// CUÁNDO DEJA DE SER DE FIAR LA MITAD DE BOLT. La tubería más lenta de las dos
// —la ingesta— pasa cada 10 min; con el doble y pico ya ha fallado algo. A
// partir de ahí un "rueda sin nadie" no es un hecho, es una foto vieja, y el
// mapa tiene que decirlo en vez de acusar.
const BOLT_FIABLE_S = 1500;

/**
 * La situación de BOLT de un coche, cogiendo la noticia MÁS FRESCA.
 *
 * Hay dos caminos para lo mismo y ninguno es de fiar siempre:
 *
 *   · el APUNTE CRUDO (`bolt_state_log`), que escribe la ingesta cada 10 min;
 *   · el TRAMO abierto (`fv_ahora`), que construye el motor cada 5 min.
 *
 * Los dos salen de los mismos logs de BOLT y traen la hora del apunte, así que
 * se pueden comparar: gana el que tenga la hora más reciente. Cuando los dos
 * funcionan dicen lo mismo —comprobado coche a coche—; cuando uno se cae, el
 * otro sostiene el semáforo en vez de dejarlo mintiendo.
 */
function situacionDe(c) {
  const tCrudo = c.crudo_at ? new Date(c.crudo_at).getTime() : null;
  const tTramo = c.desde_tramo ? new Date(c.desde_tramo).getTime() : null;
  const usaCrudo = tCrudo != null && (tTramo == null || tCrudo >= tTramo);
  // La ETIQUETA y la HORA van con la situacion que se elige, no sueltas: si la
  // situacion sale del apunte y la etiqueta del tramo, la ventanita decia
  // "Desconectado" sobre un coche pintado de verde.
  if (usaCrudo && c.situacion_cruda) {
    return {
      situacion: c.situacion_cruda,
      etiqueta: c.etiqueta_cruda || c.situacion_etiqueta || null,
      desde: c.crudo_at,
      conductor: c.conductor_crudo || c.conductor || null,
      telefono: c.telefono_crudo || c.telefono || null,
      fuente: 'apunte',
    };
  }
  return {
    situacion: c.situacion || null,
    etiqueta: c.situacion_etiqueta || null,
    desde: c.desde_tramo || null,
    conductor: c.conductor || c.conductor_crudo || null,
    telefono: c.telefono || c.telefono_crudo || null,
    fuente: c.situacion ? 'tramo' : null,
  };
}

// LA CACHE VA POR SEDES, NO SUELTA.
//
// Si fuera una sola, la foto ya filtrada del primero se le serviria durante
// diez segundos a todos los demas: quien puede ver Barcelona dejaria de verla
// porque acaba de mirar alguien que no. La clave es la lista de sedes.
const TTL_CACHE_MS = 5000;
const cache = new Map();   // 'madrid' | 'madrid,barcelona' → { ts, datos }
const clave = sedes => (Array.isArray(sedes) && sedes.length ? [...sedes].sort().join(',') : 'todas');

/** De qué color va este coche. La única regla del mapa. Ver EL SEMÁFORO arriba. */
function tono(c, sit) {
  const s = sit === undefined ? situacionDe(c).situacion : sit;
  // Un coche NUESTRO del que Mapon no da ni una posicion: no se puede pintar
  // en el mapa. Esta en taller o siniestrado, o tiene el equipo quitado, o
  // nunca se le puso. Tiene su franja roja arriba.
  if (c.mapon_unit == null) return 'sinmapon';
  const rueda = c.estado_mapon === 'driving';
  // De viaje y parado según Mapon, desde hace rato: el GPS miente. Va ANTES
  // que el `perdido` a propósito: un equipo que no habla en un coche que está
  // haciendo un viaje es justo este error, no un coche del que no se sabe nada.
  //
  // «Desde hace rato» es lo que diga el reloj de Mapon —cuánto lleva en ese
  // estado— o lo que lleve el equipo sin hablar, lo que sea mayor: un equipo
  // callado diez minutos en un coche de viaje tampoco está dando la posición.
  if (s === 'viaje') {
    const rato = Math.max(c.lleva_asi == null ? 0 : Number(c.lleva_asi), c.antiguedad == null ? 0 : Number(c.antiguedad));
    return !rueda && rato >= GPS_PARADO_S ? 'errorgps' : 'viaje';
  }
  // Un equipo que no habla hace días no dice dónde espera nadie: su punto es
  // de cuando se calló.
  if (PERDIDOS.includes(c.estado_mapon)) return 'perdido';
  // La espera, se mueva o no —esperar es estar aparcado—, y por DÓNDE está. El
  // `nogps` pasa: su punto es de hace minutos, vale para saber la zona.
  if (s === 'espera') {
    return dentroDeM30(c.lat == null ? null : Number(c.lat), c.lng == null ? null : Number(c.lng)) === false
      ? 'esperafuera' : 'espera';
  }
  if (c.estado_mapon === SIN_GPS) return 'singps';
  if (!rueda) return 'parado';
  if (s === 'descanso') return 'descanso';
  return 'suelto';
}

/**
 * Por qué está en rojo, dicho con palabras. Se enseña al pinchar el coche.
 *
 * `boltHace` son los segundos desde la última vuelta buena de Flota viva. Si
 * está vieja, el rojo NO es un hecho: lo que se sabe es que el coche rueda y
 * que de BOLT no hay noticias recientes. Decirlo cambia lo que hace el que
 * mira —llamar al conductor o mirar el sistema— y por eso se dice.
 */
function porQue(c, t, boltHace) {
  if (t === 'sinmapon') {
    return c.unidad_conocida
      ? 'Mapon tiene su equipo, pero no da ninguna posición'
      : 'No hay nada de este coche en Mapon: ni equipo ni posición';
  }
  if (t === 'singps') {
    return 'El equipo habla pero no coge satélite. Está donde marca el punto, de hace unos minutos';
  }
  if (t === 'esperafuera') return 'En espera fuera de la M-30';
  if (t === 'errorgps') {
    const parado = c.lleva_asi == null ? '' : ` desde hace ${Math.round(Number(c.lleva_asi) / 60)} min`;
    const base = `BOLT dice que va de viaje y Mapon que está parado${parado}: el GPS no da la posición real`;
    const viejo = boltHace != null && boltHace > BOLT_FIABLE_S;
    return viejo ? base + ` — OJO: lo de BOLT es de hace ${Math.round(boltHace / 60)} min` : base;
  }
  if (t !== 'suelto') return null;
  const viejo = boltHace != null && boltHace > BOLT_FIABLE_S;
  const quien = c.conductor_crudo || c.conductor;
  const base = quien
    ? `Rueda y ${quien} no está conectado en BOLT`
    : 'Rueda y no hay nadie fichado en BOLT con este coche';
  return viejo
    ? base + ` — OJO: lo de BOLT es de hace ${Math.round(boltHace / 60)} min, puede estar conectado y no haberse enterado el sistema`
    : base;
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

  const boltHace = frescura.bolt_hace == null ? null : Number(frescura.bolt_hace);
  const boltFiable = boltHace != null && boltHace <= BOLT_FIABLE_S;

  const coches = filas.map(c => {
    const v = situacionDe(c);
    const t = tono(c, v.situacion);
    return {
      unidad: c.mapon_unit == null ? null : Number(c.mapon_unit),
      // La CLAVE de cada fila en la pantalla. Era la unidad de Mapon, y un coche
      // sin Mapon no la tiene: se usa su id nuestro en su lugar.
      clave: c.mapon_unit != null ? 'u' + c.mapon_unit : 'v' + c.vehiculo_id,
      matricula: c.matricula || null,
      // Sin posicion, NULL y no cero: Number(null) es 0, y el 0,0 es un punto
      // real en el Atlantico frente a Ghana.
      lat: c.lat == null ? null : Number(c.lat),
      lng: c.lng == null ? null : Number(c.lng),
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
      situacion: v.situacion,
      situacionEtiqueta: v.etiqueta,
      // DESDE CUANDO esta en esa situacion, como instante y no como segundos:
      // la pantalla cuenta sola cada segundo ("hace 4 s", "hace 5 s"...) sin
      // tener que volver a preguntar.
      situacionDesde: v.desde ? new Date(v.desde).toISOString() : null,
      conectado: v.situacion != null && v.situacion !== 'desconectado',
      conductor: v.conductor,
      telefono: v.telefono,
      // EL ÚLTIMO QUE LO LLEVÓ EN BOLT, sin ventana de tiempo. La lista enseña a
      // la persona y no la matrícula (Camilo, 24/09/2026): con un coche parado
      // desde ayer, «quién lo tuvo» es lo que se quiere saber.
      ultimoConductor: c.ultimo_conductor || null,
      ultimoHace: c.ultimo_hace == null ? null : Number(c.ultimo_hace),
      // Dentro o fuera de la M-30, para quien lo quiera leer sin repetir la cuenta.
      dentroM30: dentroDeM30(c.lat == null ? null : Number(c.lat), c.lng == null ? null : Number(c.lng)),
      // Dónde dejó al último pasajero y si vuelve hacia la M-30. Ver ultimoDestino.
      ultimoDestino: ultimoDestino(c, dentroDeM30(c.lat == null ? null : Number(c.lat), c.lng == null ? null : Number(c.lng)) === true, v.desde),
      // De cuál de las dos tuberías salió esto. No se pinta, pero contesta
      // "¿por qué dice eso?" sin abrir la base.
      fuente: v.fuente,
      // Segundos que lleva en esa situación; la vista lo pinta como "2 h 14".
      desdeHace: v.desde ? Math.max(0, Math.round((Date.now() - new Date(v.desde).getTime()) / 1000))
        : (c.segundos_situacion == null ? null : Number(c.segundos_situacion)),
      km: c.km == null ? null : Number(c.km),
      sede: c.sede || null,
      tono: t,
      // Un rojo sobre datos de BOLT viejos no es un rojo: es un "no se sabe".
      // La vista lo pinta distinto y el aviso no lo llama. Lo mismo el error de
      // GPS: si lo de BOLT es viejo, el «de viaje» puede haber acabado hace rato.
      dudoso: (t === 'suelto' || t === 'errorgps') && !boltFiable,
      motivo: porQue(c, t, boltHace),
    };
  });

  const cuenta = coches.reduce((a, c) => { a[c.tono] = (a[c.tono] || 0) + 1; return a; }, {});
  const datos = {
    coches,
    cuenta,
    // Lo que de verdad importa del resumen: cuántos hay ahora mismo sueltos.
    sueltos: cuenta.suelto || 0,
    // Y los de la flota de los que Mapon no sabe nada: la alerta de arriba.
    sinMapon: coches.filter(c => c.tono === 'sinmapon')
      .map(c => ({ matricula: c.matricula, estado: c.estadoVehiculo, motivo: c.motivo })),
    frescura: {
      unidades: Number(frescura.dentro || 0),
      hace: frescura.hace == null ? null : Number(frescura.hace),
      // Segundos desde la última vuelta BUENA de Flota viva. Es la edad de las
      // etiquetas (quién va conectado), que no es la de los puntos.
      boltHace, boltFiable,
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
  // SI LA MITAD DE BOLT ESTÁ VIEJA, NO SE AVISA DE NADA. El aviso mueve a
  // alguien a llamar por teléfono, y llamar a un conductor que está trabajando
  // para preguntarle por qué no trabaja se paga dos veces: en el ridículo y en
  // que la próxima vez ya nadie se crea el aviso.
  if (!d.frescura.boltFiable) {
    console.warn(`⏸️  [MAPA] No se avisa de sueltos: lo de BOLT es de hace ${
      d.frescura.boltHace == null ? '¿?' : Math.round(d.frescura.boltHace / 60) + ' min'}`);
    return [];
  }
  return d.coches.filter(c => c.tono === 'suelto'
    && c.llevaAsi != null && c.llevaAsi >= minSegundos);
}

// ── EL ÚLTIMO DESTINO: ¿VUELVE A LA M-30 O DA VUELTAS? ─────────────────────
// Lo pidió Camilo el 25/09/2026 delante de un coche en espera fuera de la M-30.
// Se compara lo lejos que estaba de la M-30 al dejar al pasajero con lo lejos
// que está ahora, y lo que ha rodado entre medias (odómetro CAN):
//
//   vuelve     ahora está al menos 1 km más cerca que al dejarlo
//   se aleja   ahora está al menos 1 km más lejos
//   vueltas    igual de lejos, pero ha rodado más de 3 km desde entonces
//   quieto     igual de lejos y apenas ha rodado: espera donde lo dejó
//
// Un kilómetro de margen porque la M-30 no es un punto: moverse a lo largo de
// ella sin acercarse no es volver.
const KM_MARGEN = 1, KM_VUELTAS = 3;

function ultimoDestino(c, estaDentro, desdeSituacion) {
  // Acaba de dejar a alguien y su pedido aún no ha llegado de BOLT: se dice,
  // en vez de enseñar el viaje de antes con un veredicto que no es suyo. Solo
  // los 20 minutos siguientes al fin del viaje: si para entonces no ha llegado
  // (un viaje reservado con horas de antelación, que la pasada de pedidos no
  // alcanza), se enseña lo que haya.
  const reciente = desdeSituacion && Date.now() - new Date(desdeSituacion).getTime() < 20 * 60 * 1000;
  if (c.viaje_sin_llegar && reciente) {
    return { pendiente: true, texto: 'Acaba de salir de un viaje (terminado o cancelado): el pedido está llegando de BOLT' };
  }
  if (!c.destino && c.destino_lat == null) return null;
  const dLat = c.destino_lat == null ? null : Number(c.destino_lat);
  const dLng = c.destino_lng == null ? null : Number(c.destino_lng);
  const lat = c.lat == null ? null : Number(c.lat), lng = c.lng == null ? null : Number(c.lng);
  const out = {
    direccion: c.destino || null, lat: dLat, lng: dLng,
    dejadoAt: c.dejado_at ? new Date(c.dejado_at).toISOString() : null,
    kmRodados: c.metros_desde_dejado == null ? null : Math.round(Number(c.metros_desde_dejado) / 100) / 10,
    kmAlDestino: null, kmM30Ahora: null, kmM30Destino: null, tendencia: null, texto: null,
  };
  if (dLat == null || lat == null) return out;
  const kx = 111.32 * Math.cos(lat * Math.PI / 180);
  out.kmAlDestino = Math.round(Math.hypot((dLng - lng) * kx, (dLat - lat) * 110.574) * 10) / 10;
  const ahora = kmHastaM30(lat, lng), antes = kmHastaM30(dLat, dLng);
  out.kmM30Ahora = Math.round(ahora * 10) / 10;
  out.kmM30Destino = Math.round(antes * 10) / 10;
  const km = n => String(n).replace('.', ',') + ' km';
  // «A 0 km» no se lee bien: dentro es dentro, y a menos de 100 m es «junto».
  // Con la distancia SIN redondear: a 30 m fuera, el número redondeado es 0 y
  // diría «dentro».
  const donde = (crudo, n) => (crudo === 0 ? 'dentro de la M-30' : crudo < 0.1 ? 'junto a la M-30' : `a ${km(n)} de la M-30`);
  if (estaDentro) { out.tendencia = 'dentro'; return out; }
  const rodado = out.kmRodados == null ? '' : ` y ha rodado ${km(out.kmRodados)}`;
  if (antes - ahora >= KM_MARGEN) {
    out.tendencia = 'vuelve';
    out.texto = `Volviendo a la M-30: lo dejó ${donde(antes, out.kmM30Destino)} y ahora está ${donde(ahora, out.kmM30Ahora)}`;
  } else if (ahora - antes >= KM_MARGEN) {
    out.tendencia = 'aleja';
    out.texto = `Se aleja de la M-30: lo dejó ${donde(antes, out.kmM30Destino)} y ahora está ${donde(ahora, out.kmM30Ahora)}`;
  } else if (out.kmRodados != null && out.kmRodados > KM_VUELTAS) {
    out.tendencia = 'vueltas';
    out.texto = `Dando vueltas: sigue ${donde(ahora, out.kmM30Ahora)}${rodado} desde que dejó al pasajero`;
  } else {
    out.tendencia = 'quieto';
    out.texto = `Espera cerca de donde dejó al pasajero, ${donde(ahora, out.kmM30Ahora)}`;
  }
  return out;
}

/** Se llama al escribir posiciones nuevas: la foto de antes ya no vale. */
const olvidar = () => { cache.clear(); };

module.exports = { frente, sueltos, olvidar, tono, PERDIDOS, SIN_GPS, BOLT_FIABLE_S, GPS_PARADO_S,
  // El anillo, para que la pantalla lo pinte sin tener que saber de dónde sale.
  M30: require('./m30').POLIGONO };
