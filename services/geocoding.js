/**
 * Geocodificación de direcciones con Nominatim (OpenStreetMap).
 *
 * Es gratis y sin clave, pero su política de uso exige:
 *   · un User-Agent identificativo,
 *   · como mucho 1 petición por segundo.
 * Por eso las llamadas en lote van serializadas con pausa; nunca en paralelo.
 *
 * Hay dos modos:
 *   · geocodificar(direccion, cp)        → búsqueda libre (una sola cadena).
 *   · geocodificarEstructurado({...})    → búsqueda ESTRUCTURADA (street/city/
 *       postalcode/state/country). Es mucho más fiable porque Nominatim sabe qué
 *       es cada parte; se usa desde Selección con la dirección en campos separados.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'TelecabFleet/1.0 (gestión interna de flota)';
const PAUSA_MS = 1100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Lanza la consulta a Nominatim (params ya montados) y normaliza el resultado. */
async function consultar(params) {
  params.set('format', 'jsonv2');
  params.set('limit', '1');
  params.set('countrycodes', 'es');
  const url = `${NOMINATIM}?${params.toString()}`;

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

/**
 * Búsqueda LIBRE. Devuelve { lat, lng, precision, etiqueta } o null.
 * Se le añade "Madrid, España" y el código postal para acotar: las direcciones
 * del anexo vienen sin ciudad y Nominatim, a secas, las coloca en cualquier país.
 */
async function geocodificar(direccion, codigoPostal) {
  const dir = String(direccion || '').trim();
  if (!dir) return null;
  const partes = [dir];
  if (codigoPostal) partes.push(String(codigoPostal).trim());
  partes.push('Madrid', 'España');
  return consultar(new URLSearchParams({ q: partes.join(', ') }));
}

/**
 * Búsqueda ESTRUCTURADA. Recibe los componentes por separado y arma los campos
 * que entiende Nominatim. Si no encuentra nada, reintenta en modo libre con todo
 * junto (por si el portal exacto no está pero sí la calle).
 */
async function geocodificarEstructurado(comp = {}) {
  const numero = String(comp.numero || '').trim();
  const via = String(comp.via || comp.calle || '').trim();
  const cp = String(comp.codigoPostal || comp.codigo_postal || '').trim();
  const localidad = String(comp.localidad || '').trim() || 'Madrid';
  const provincia = String(comp.provincia || '').trim() || 'Madrid';
  if (!via && !cp) return null;

  // "street" en Nominatim es "<número> <nombre de la vía>".
  const street = [numero, via].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams();
  if (street) params.set('street', street);
  params.set('city', localidad);
  if (provincia) params.set('state', provincia);
  if (cp) params.set('postalcode', cp);
  params.set('country', 'España');

  const r = await consultar(params);
  if (r && !r.error) return r;
  // Respaldo: búsqueda libre con todo concatenado (incluye tipo de vía si vino).
  const libre = [comp.tipo_via, via, numero].filter(Boolean).join(' ').trim();
  if (!libre) return r;   // nada más que intentar
  return geocodificar(libre, cp);
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

module.exports = { geocodificar, geocodificarEstructurado, geocodificarLote };
