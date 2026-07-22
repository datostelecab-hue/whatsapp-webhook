/**
 * Geocodificación de direcciones con Nominatim (OpenStreetMap).
 *
 * Es gratis y sin clave, pero su política de uso exige:
 *   · un User-Agent identificativo,
 *   · como mucho 1 petición por segundo.
 * Por eso las llamadas en lote van serializadas con pausa; nunca en paralelo.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'TelecabFleet/1.0 (gestión interna de flota)';
const PAUSA_MS = 1100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Devuelve { lat, lng, precision, etiqueta } o null si no se encuentra.
 * Se le añade "Madrid, España" y el código postal para acotar: las direcciones
 * del anexo vienen sin ciudad y Nominatim, a secas, las coloca en cualquier país.
 */
async function geocodificar(direccion, codigoPostal) {
  const dir = String(direccion || '').trim();
  if (!dir) return null;

  const partes = [dir];
  if (codigoPostal) partes.push(String(codigoPostal).trim());
  partes.push('Madrid', 'España');
  const consulta = partes.join(', ');

  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=es&q=${encodeURIComponent(consulta)}`;

  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es' } });
  } catch (e) {
    return { error: 'red', mensaje: e.message };
  }

  if (resp.status === 429) return { error: 'limite', mensaje: 'Demasiadas consultas seguidas' };
  if (!resp.ok) return { error: 'http', mensaje: `HTTP ${resp.status}` };

  const datos = await resp.json();
  if (!Array.isArray(datos) || !datos.length) return null;

  const r = datos[0];
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  if (isNaN(lat) || isNaN(lng)) return null;

  return {
    lat: Math.round(lat * 1e7) / 1e7,
    lng: Math.round(lng * 1e7) / 1e7,
    // Nominatim indica cuán fina es la coincidencia: "house"/"building" es
    // portal exacto; "road"/"postcode" es aproximado a calle o barrio.
    precision: r.addresstype || r.type || 'desconocida',
    etiqueta: r.display_name || ''
  };
}

/** Geocodifica una lista respetando el límite de 1/seg. */
async function geocodificarLote(items, onProgreso) {
  const resultados = [];
  for (let i = 0; i < items.length; i++) {
    const { direccion, codigoPostal } = items[i];
    const r = await geocodificar(direccion, codigoPostal);
    resultados.push(r);
    if (onProgreso) onProgreso(i + 1, items.length, r);
    if (i < items.length - 1) await sleep(PAUSA_MS);
  }
  return resultados;
}

module.exports = { geocodificar, geocodificarLote };
