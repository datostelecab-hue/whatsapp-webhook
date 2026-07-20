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

// Tope de páginas. Antes eran 100 (100.000 registros): un mes movido de dos
// flotas puede superarlo, y como la API devuelve los logs del más reciente al
// más antiguo, al cortar se perdían justo los primeros días del mes.
const MAX_PAGINAS = 2000;

/**
 * Además de los datos, deja en `fetchAllPaginated.ultimoDiagnostico` el detalle
 * de lo ocurrido (páginas, cortes, errores HTTP) para poder registrarlo.
 */
async function fetchAllPaginated(endpoint, baseBody, dataKey, pageSize = 1000, etiqueta = '') {
  const allData = [];
  let offset = 0;
  let paginas = 0;
  let motivo = 'fin-de-datos';
  let errorHttp = null;

  for (let page = 0; page < MAX_PAGINAS; page++) {
    const body = { ...baseBody, limit: pageSize, offset };
    const result = await apiRequest(endpoint, 'POST', body);
    paginas++;

    if (result.httpCode !== 200) {
      // Antes se cortaba en silencio y el mes se escribía incompleto sin avisar.
      motivo = 'error-http';
      errorHttp = result.httpCode;
      console.error(
        `❌ [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} HTTP ${result.httpCode} ` +
        `en página ${paginas} (offset ${offset}) — se devuelven ${allData.length} registros PARCIALES`
      );
      break;
    }

    const batch = result.data?.data?.[dataKey] || result.data?.[dataKey] || [];
    if (batch.length === 0) break;

    allData.push(...batch);
    offset += pageSize;

    if (batch.length < pageSize) break;

    if (page === MAX_PAGINAS - 1) {
      motivo = 'tope-paginas';
      console.error(
        `❌ [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} alcanzó el tope de ` +
        `${MAX_PAGINAS} páginas — HAY DATOS SIN LEER (${allData.length} registros)`
      );
    }
  }

  fetchAllPaginated.ultimoDiagnostico = {
    endpoint, dataKey, paginas, registros: allData.length, motivo, errorHttp
  };

  return allData;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  CONFIG_BOLT,
  getAccessToken,
  apiRequest,
  fetchAllPaginated,
  sleep
};