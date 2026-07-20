const CONFIG_BOLT = {
  clientId: 'y5fn0aAVi5A9S8Oyfr5RZ',
  clientSecret: '6iLLheyzrPsgwgumCi-I_ixlMadTVoWvh8X9daYtSQW-GvqQLysUfEt0RbiD8TX2m0aM1Noo5FZ_yEGvaSunWQ',
  tokenUrl: 'https://oidc.bolt.eu/token',
  apiBaseUrl: 'https://node.bolt.eu/fleet-integration-gateway',
  // 63530 ya no está operativa, pero conserva histórico de horas hasta junio;
  // se mantiene en la lista para que los meses antiguos salgan completos.
  flotas: [
    { id: 63530, nombre: 'Flota 63530' },
    { id: 143626, nombre: 'Flota 143626' }
  ],
  metaDiariaHoras: 8
};

let accessToken = null;
let tokenExpires = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpires) return accessToken;

  const response = await fetch(CONFIG_BOLT.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CONFIG_BOLT.clientId,
      client_secret: CONFIG_BOLT.clientSecret,
      scope: 'fleet-integration:api'
    })
  });

  const data = await response.json();
  if (data.access_token) {
    accessToken = data.access_token;
    tokenExpires = Date.now() + 540000;
    return accessToken;
  }
  throw new Error('Error token: ' + response.status);
}

async function apiRequest(endpoint, method = 'POST', body = null) {
  const token = await getAccessToken();
  const options = {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(CONFIG_BOLT.apiBaseUrl + endpoint, options);
  if (response.status === 401 || response.status === 403) {
    accessToken = null;
    return apiRequest(endpoint, method, body);
  }
  return { httpCode: response.status, data: await response.json() };
}

async function fetchAllPaginated(endpoint, baseBody, dataKey, pageSize = 1000) {
  const allData = [];
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    const body = { ...baseBody, limit: pageSize, offset };
    const result = await apiRequest(endpoint, 'POST', body);
    if (result.httpCode !== 200) break;

    const batch = result.data?.data?.[dataKey] || result.data?.[dataKey] || [];
    if (batch.length === 0) break;

    allData.push(...batch);
    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  return allData;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Bolt rechaza rangos de más de 31 días. Un mes natural cabe justo, pero en
// octubre el cambio de hora añade 60 minutos al rango y lo deja por encima del
// límite, así que troceamos siempre en bloques de 30 días.
const MAX_DIAS_BLOQUE = 30;
const PAUSA_ENTRE_BLOQUES_MS = 1200;

/**
 * Recorre [startTs, endTs] en bloques de como mucho `maxDias` días y devuelve
 * todos los registros juntos. Los bloques son contiguos y los resultados se
 * fusionan antes de usarlos, así que un intervalo que cruce la frontera entre
 * dos bloques sigue quedando completo (importante para los state logs, que se
 * emparejan log-a-log para medir duraciones).
 */
async function fetchPorBloques(endpoint, baseBody, dataKey, startTs, endTs, opciones = {}) {
  const maxDias = opciones.maxDias || MAX_DIAS_BLOQUE;
  const pausaMs = opciones.pausaMs !== undefined ? opciones.pausaMs : PAUSA_ENTRE_BLOQUES_MS;
  const pageSize = opciones.pageSize || 1000;
  const claveId = opciones.claveId || null;

  const maxSegundos = maxDias * 86400;
  const bloques = [];
  let desde = startTs;
  while (desde <= endTs) {
    const hasta = Math.min(desde + maxSegundos - 1, endTs);
    bloques.push([desde, hasta]);
    desde = hasta + 1;
  }

  const todos = [];
  for (let i = 0; i < bloques.length; i++) {
    const [bDesde, bHasta] = bloques[i];
    const lote = await fetchAllPaginated(
      endpoint,
      { ...baseBody, start_ts: bDesde, end_ts: bHasta },
      dataKey,
      pageSize
    );
    todos.push(...lote);

    if (i < bloques.length - 1 && pausaMs > 0) await sleep(pausaMs);
  }

  if (!claveId) return todos;

  const vistos = new Set();
  return todos.filter(item => {
    const clave = typeof claveId === 'function' ? claveId(item) : item[claveId];
    if (clave === undefined || clave === null) return true;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

module.exports = {
  CONFIG_BOLT,
  getAccessToken,
  apiRequest,
  fetchAllPaginated,
  fetchPorBloques,
  sleep
};