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

// Reintentos ante 429 (límite de peticiones): 5s, 10s, 20s, 40s.
const MAX_REINTENTOS_429 = 4;
const ESPERA_BASE_429_MS = 5000;

// Bolt devuelve HTTP 200 con el error dentro del cuerpo. Los 498xxx son
// errores de negocio (rango inválido, empresa inactiva) y no tiene sentido
// insistir; estos otros son fallos pasajeros del servidor y sí se reintentan.
const CODIGOS_TRANSITORIOS = new Set([998, 999]);

// Un timeout se reintenta UNA vez y corto: significa que el rango pesa
// demasiado, así que insistir con el mismo rango sale caro y no suele servir.
// Lo que lo arregla es partirlo, y de eso se encarga fetchRangoCompleto.
const MAX_REINTENTOS_TIMEOUT = 1;
const ESPERA_TIMEOUT_MS = 3000;

function esCodigoTransitorio(codigo) {
  return CODIGOS_TRANSITORIOS.has(codigo);
}

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
  let codigoCuerpo = null;
  let mensajeCuerpo = null;
  let totalRows = null;
  let reintentos = 0;
  let reintentosTimeout = 0;

  for (let page = 0; page < MAX_PAGINAS; page++) {
    const body = { ...baseBody, limit: pageSize, offset };
    const result = await apiRequest(endpoint, 'POST', body);
    paginas++;

    if (result.httpCode !== 200) {
      // 429 = límite de peticiones. Pasa cuando el backfill y los crons
      // coinciden. Se reintenta con espera creciente en vez de devolver datos
      // incompletos, que es lo que hacía antes en silencio.
      if (result.httpCode === 429 && reintentos < MAX_REINTENTOS_429) {
        reintentos++;
        const espera = ESPERA_BASE_429_MS * Math.pow(2, reintentos - 1);
        console.error(
          `⏳ [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} HTTP 429 en página ` +
          `${paginas} — reintento ${reintentos}/${MAX_REINTENTOS_429} en ${espera / 1000}s`
        );
        await sleep(espera);
        page--;          // no cuenta como página consumida
        paginas--;
        continue;        // se repite el mismo offset
      }

      motivo = 'error-http';
      errorHttp = result.httpCode;
      console.error(
        `❌ [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} HTTP ${result.httpCode} ` +
        `en página ${paginas} (offset ${offset}) — se devuelven ${allData.length} registros PARCIALES`
      );
      break;
    }

    reintentos = 0;   // la respuesta HTTP ha entrado bien

    // Bolt responde HTTP 200 aunque haya error: el código real viene en el
    // cuerpo (498805 INVALID_START_DATE, 498806 INVALID_DATE_RANGE,
    // 498809 COMPANY_NOT_ACTIVE...). Si no lo miramos, un error se confunde
    // con "no hay datos" y el mes se escribe vacío sin avisar.
    codigoCuerpo = result.data?.code;
    mensajeCuerpo = result.data?.message;
    // Los state logs lo llaman total_rows y los pedidos total_orders.
    if (totalRows === null) {
      const t = result.data?.data;
      if (t?.total_rows !== undefined) totalRows = t.total_rows;
      else if (t?.total_orders !== undefined) totalRows = t.total_orders;
    }

    const batch = result.data?.data?.[dataKey] || result.data?.[dataKey] || [];

    if (batch.length === 0) {
      // CLIENT_TIMEOUT y similares llegan como HTTP 200 con 0 registros: si no
      // se reintentan, se pierde el tramo entero creyendo que no había datos.
      if (esCodigoTransitorio(codigoCuerpo) && reintentosTimeout < MAX_REINTENTOS_TIMEOUT) {
        reintentosTimeout++;
        console.error(
          `⏳ [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} code=${codigoCuerpo} ` +
          `"${mensajeCuerpo}" en página ${paginas} — reintento en ${ESPERA_TIMEOUT_MS / 1000}s`
        );
        await sleep(ESPERA_TIMEOUT_MS);
        page--;
        paginas--;
        continue;
      }

      if (paginas === 1) {
        motivo = esCodigoTransitorio(codigoCuerpo) ? 'timeout' : 'sin-datos';
        console.error(
          `⚠️  [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} devolvió 0 registros ` +
          `— code=${codigoCuerpo} message="${mensajeCuerpo}" total_rows=${totalRows}`
        );
      }
      break;
    }

    // Solo aquí se sabe que la página trajo datos de verdad. Resetear el
    // contador antes sería un bucle infinito: CLIENT_TIMEOUT viaja con HTTP
    // 200, así que la respuesta "entra bien" aunque no traiga nada.
    reintentosTimeout = 0;

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

  // total_rows nos dice cuántos registros existen de verdad: si hemos leído
  // menos, es que la paginación se ha quedado corta.
  if (totalRows !== null && allData.length < totalRows) {
    console.error(
      `❌ [API${etiqueta ? ' ' + etiqueta : ''}] ${endpoint} INCOMPLETO: ` +
      `leídos ${allData.length} de ${totalRows} registros (motivo: ${motivo})`
    );
  }

  fetchAllPaginated.ultimoDiagnostico = {
    endpoint, dataKey, paginas, registros: allData.length,
    motivo, errorHttp, codigoCuerpo, mensajeCuerpo, totalRows
  };

  return allData;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// La API rechaza rangos de más de 31 días con 498806 INVALID_DATE_RANGE.
const LIMITE_RANGO_SEG = 31 * 86400 - 3600;   // 31 días menos 1 h de margen

/**
 * Como fetchAllPaginated, pero si el rango supera el máximo que acepta la API
 * lo pide en dos tramos y los junta.
 *
 * Solo ocurre en octubre: del 1 a las 00:00 al 31 a las 23:59 hay 31 días y
 * una hora, porque esa madrugada se atrasan los relojes. Los dos tramos se
 * fusionan ANTES de procesar nada, así que un turno que cruce el corte se
 * sigue midiendo entero.
 */
const MAX_PARTICIONES = 4;              // hasta 16 tramos
const RANGO_MINIMO_SEG = 6 * 3600;      // no se parte por debajo de 6 h

async function fetchRangoCompleto(endpoint, baseBody, dataKey, startTs, endTs, pageSize, etiqueta, nivel = 0) {
  const duracion = endTs - startTs;

  // Rango dentro de lo permitido: una sola petición.
  if (duracion <= LIMITE_RANGO_SEG) {
    const datos = await fetchAllPaginated(
      endpoint, { ...baseBody, start_ts: startTs, end_ts: endTs }, dataKey, pageSize, etiqueta
    );
    const diag = fetchAllPaginated.ultimoDiagnostico;

    // Un timeout del servidor significa que el rango pesa demasiado para una
    // sola consulta: insistir con el mismo rango volvería a fallar, así que se
    // parte por la mitad.
    const debePartirse = diag.motivo === 'timeout' && datos.length === 0 &&
                         nivel < MAX_PARTICIONES && duracion > RANGO_MINIMO_SEG;

    if (debePartirse) {
      console.log(`✂️  [${etiqueta}] Timeout con ${(duracion / 86400).toFixed(2)} días: ` +
                  `se parte por la mitad (nivel ${nivel + 1})`);
      return partirRango(endpoint, baseBody, dataKey, startTs, endTs,
                         startTs + Math.floor(duracion / 2), pageSize, etiqueta, nivel + 1);
    }

    return datos;
  }

  // Por encima del máximo que acepta la API: pasa en octubre, cuando el mes
  // mide 31 días y una hora por el cambio de horario.
  console.log(`✂️  [${etiqueta}] Rango de ${(duracion / 86400).toFixed(2)} días: ` +
              `supera el máximo de la API, se pide en 2 tramos`);
  return partirRango(endpoint, baseBody, dataKey, startTs, endTs,
                     startTs + LIMITE_RANGO_SEG, pageSize, etiqueta, nivel);
}

/** Pide [inicio, corte] y [corte+1, fin] y junta los resultados. */
async function partirRango(endpoint, baseBody, dataKey, startTs, endTs, corte, pageSize, etiqueta, nivel) {
  const tramo1 = await fetchRangoCompleto(endpoint, baseBody, dataKey, startTs, corte, pageSize, etiqueta, nivel);
  const diag1 = { ...fetchAllPaginated.ultimoDiagnostico };

  await sleep(1500);

  const tramo2 = await fetchRangoCompleto(endpoint, baseBody, dataKey, corte + 1, endTs, pageSize, etiqueta, nivel);
  const diag2 = fetchAllPaginated.ultimoDiagnostico;

  fetchAllPaginated.ultimoDiagnostico = {
    ...diag2,
    paginas: (diag1.paginas || 0) + (diag2.paginas || 0),
    registros: tramo1.length + tramo2.length,
    totalRows: (diag1.totalRows || 0) + (diag2.totalRows || 0),
    motivo: diag1.motivo === 'fin-de-datos' ? diag2.motivo : diag1.motivo
  };

  return tramo1.concat(tramo2);
}

module.exports = {
  CONFIG_BOLT,
  getAccessToken,
  apiRequest,
  fetchAllPaginated,
  fetchRangoCompleto,
  sleep
};