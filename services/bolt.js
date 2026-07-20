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

module.exports = {
  CONFIG_BOLT,
  getAccessToken,
  apiRequest,
  fetchAllPaginated,
  sleep
};