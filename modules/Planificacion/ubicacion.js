// ============================================================
// LA UBICACIÓN DE UNA ZONA — de lo que pega la gente a lat/lng
// ============================================================
// Una zona (`base_zona`) lleva sus coordenadas obligatorias: el generador de
// vacantes las usa para proponer la base más cercana cuando una zona no llega a
// completar un correturnos. Nadie se sabe una latitud de memoria, así que se
// acepta lo que da Google Maps tal cual:
//
//   · las coordenadas que copia el clic derecho sobre el mapa: «40.4617, -3.7856»
//   · las mismas con coma decimal, como se escriben aquí: «40,4617; -3,7856»
//   · el enlace largo de la barra del navegador (…/@40.46,-3.78,17z o !3d…!4d…)
//
// El enlace corto (maps.app.goo.gl) no lleva las coordenadas dentro: para
// sacarlas habría que abrirlo desde el servidor, y no se hace. Se dice qué
// hacer en su lugar.
//
// Puro, sin base: lo prueba scripts/comprobar-zonas.js.

// España entera, Canarias incluidas. Lo que caiga fuera es casi siempre una
// latitud y una longitud puestas al revés, o un número a medio copiar.
const ESPANA = { latMin: 27, latMax: 44.5, lngMin: -19, lngMax: 5 };

const COMO = 'Pega las coordenadas de la base («40.4617, -3.7856»: en Google Maps, clic derecho sobre el sitio y se copian) o el enlace largo de la barra del navegador';

const dentro = (lat, lng) =>
  lat >= ESPANA.latMin && lat <= ESPANA.latMax && lng >= ESPANA.lngMin && lng <= ESPANA.lngMax;

/** Los dos números de un texto ya limpio, o null. */
function par(s) {
  // Punto decimal: «40.4617, -3.7856», «40.4617 -3.7856», «40.4617;-3.7856».
  let m = s.match(/^(-?\d{1,3}\.\d+)\s*(?:[,;]\s*|\s+)(-?\d{1,3}\.\d+)$/);
  if (m) return [m[1], m[2]];
  // Coma decimal: «40,4617; -3,7856», «40,4617 -3,7856» y «40,4617, -3,7856»
  // (con espacio detrás de la coma que separa; sin él no se sabe cuál es cuál).
  m = s.match(/^(-?\d{1,3},\d+)\s*(?:;\s*|,\s+|\s+)(-?\d{1,3},\d+)$/);
  if (m) return [m[1].replace(',', '.'), m[2].replace(',', '.')];
  return null;
}

/** Las coordenadas de un enlace de Google Maps, o null. */
function deEnlace(s) {
  const u = s.replace(/%2C/gi, ',');
  // !3d…!4d… es el sitio marcado; @lat,lng es el centro de lo que se ve. Si
  // vienen los dos, manda el sitio.
  const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
         || u.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
         || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? [m[1], m[2]] : null;
}

/**
 * De lo escrito a `{ lat, lng }` con seis decimales (lo que guarda la tabla).
 * Lanza un error que se puede enseñar tal cual si no se entiende.
 */
function leerUbicacion(texto) {
  const s = String(texto == null ? '' : texto).trim();
  if (!s) throw new Error(`Falta la ubicación. ${COMO}.`);
  const esEnlace = /^https?:\/\//i.test(s) || /google\.[a-z.]+\/maps|goo\.gl/i.test(s);
  if (esEnlace && /goo\.gl\//i.test(s) && !/[@!]\d/.test(s)) {
    throw new Error('Ese enlace es el corto y no lleva las coordenadas dentro. Ábrelo y copia el largo de la barra del navegador, o pega las coordenadas (clic derecho sobre el sitio en Google Maps).');
  }
  const nums = esEnlace ? deEnlace(s) : par(s);
  if (!nums) throw new Error(`No entiendo «${s.length > 60 ? s.slice(0, 60) + '…' : s}». ${COMO}.`);
  const lat = Number(nums[0]), lng = Number(nums[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`No entiendo esas coordenadas. ${COMO}.`);
  if (!dentro(lat, lng)) {
    if (dentro(lng, lat)) throw new Error('Esas coordenadas parecen al revés: primero va la latitud (la de Madrid empieza por 40) y luego la longitud (empieza por -3).');
    throw new Error('Esas coordenadas caen fuera de España. Revisa que estén enteras.');
  }
  const r6 = n => Math.round(n * 1e6) / 1e6;
  return { lat: r6(lat), lng: r6(lng) };
}

/** Para enseñarlas en el formulario de editar: «40.4617, -3.7856». */
const escribirUbicacion = (lat, lng) =>
  (lat == null || lng == null) ? '' : `${Number(lat)}, ${Number(lng)}`;

module.exports = { leerUbicacion, escribirUbicacion };
