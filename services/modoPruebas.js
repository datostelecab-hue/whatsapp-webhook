// ============================================================
// MODO PRUEBAS — cortafuegos para el servidor de ensayo
// ============================================================
// Con MODO_PRUEBAS=1 el servidor puede LEER todo lo de producción (hojas, BOLT,
// Mapon) pero no puede CAMBIAR nada fuera de sí mismo. Existe porque el servidor
// de pruebas arranca los mismos 9 crons que el de producción y usa las mismas
// credenciales: sin esto, dos instancias reescribirían las mismas hojas a la vez,
// duplicarían el gasto de la cuota de Sheets (60/min, compartida — ya tumbó el
// ERP entero una vez) y mandarían WhatsApps a conductores de verdad.
//
// Se bloquean TRES cosas:
//   1. Toda escritura en Google Sheets (services/sheets.js llama a `permite`).
//   2. Todo envío de WhatsApp — se corta en `fetch`, así también cae lo que
//      manda routes/botPuertas.js por su cuenta.
//   3. Toda escritura en Mapon (crear/mover conductores, relés, comandos): el
//      fichaje mueve conductores REALES entre coches REALES.
//
// Lo que NO se bloquea: las lecturas. El ensayo necesita leer datos de verdad.
//
// Cada bloqueo se registra en el log con lo que se habría hecho, para poder
// comprobar que el ensayo hace lo que debe sin que llegue a hacerlo.

const ACTIVO = process.env.MODO_PRUEBAS === '1';

let _bloqueos = [];   // últimas acciones frenadas, para /modo-pruebas

function anotar(tipo, detalle) {
  const linea = { ts: Date.now(), tipo, detalle };
  _bloqueos.push(linea);
  if (_bloqueos.length > 500) _bloqueos = _bloqueos.slice(-500);
  console.log(`🧪 [PRUEBAS] BLOQUEADO ${tipo}: ${detalle}`);
}

/**
 * ¿Se deja pasar esta escritura? Devuelve false y la registra si estamos en
 * modo pruebas. Quien llama debe devolver algo inocuo, no lanzar: el objetivo
 * es que el ensayo siga su curso, no que reviente a mitad.
 */
function permite(operacion, detalle) {
  if (!ACTIVO) return true;
  anotar(operacion, detalle);
  return false;
}

// ── Cortafuegos de red ───────────────────────────────────────────────────────
// Se envuelve `fetch` una sola vez. Es más fiable que parchear cada punto de
// llamada: recoge también lo que no hemos encontrado buscando.
const ESCRITURAS_MAPON = /(driver\/(create|update|delete)|change_relay|unit_commands\/execute|unit\/edit)/i;

function instalarCortafuegos() {
  if (!ACTIVO || global.fetch.__pruebas) return;
  const original = global.fetch;

  const envoltorio = async (url, opciones) => {
    const u = String(url);
    const metodo = ((opciones && opciones.method) || 'GET').toUpperCase();

    // WhatsApp: cualquier POST a la API de Meta es un envío o un cambio.
    if (/graph\.facebook\.com/.test(u) && metodo !== 'GET') {
      let a_quien = '';
      try { a_quien = (JSON.parse((opciones && opciones.body) || '{}').to) || ''; } catch (_) {}
      anotar('WhatsApp', `${metodo} ${u.replace(/\/\d+\//, '/<phone_id>/')}${a_quien ? ` → ${a_quien}` : ''}`);
      return respuestaFalsa({ messaging_product: 'whatsapp', messages: [{ id: 'PRUEBAS-' + Date.now() }] });
    }

    // Mapon: los POST cambian cosas, y algunos GET también (relés, comandos).
    if (/mapon\.com/.test(u) && (metodo !== 'GET' || ESCRITURAS_MAPON.test(u))) {
      anotar('Mapon', `${metodo} ${u.replace(/key=[^&]*/, 'key=***')}`);
      return respuestaFalsa({ data: { simulado: true } });
    }

    return original(url, opciones);
  };
  envoltorio.__pruebas = true;
  global.fetch = envoltorio;
  console.log('🧪 [PRUEBAS] Cortafuegos de red activo: WhatsApp y escrituras de Mapon bloqueados');
}

/** Respuesta con la forma que espera quien llamó, para no romper el flujo. */
function respuestaFalsa(cuerpo) {
  const texto = JSON.stringify(cuerpo);
  return {
    ok: true, status: 200, statusText: 'OK (modo pruebas)',
    json: async () => cuerpo,
    text: async () => texto,
    headers: new Map()
  };
}

/** Resumen para la ruta de diagnóstico. */
const estado = () => ({
  activo: ACTIVO,
  bloqueos: _bloqueos.length,
  porTipo: _bloqueos.reduce((a, b) => ({ ...a, [b.tipo]: (a[b.tipo] || 0) + 1 }), {}),
  ultimos: _bloqueos.slice(-40).reverse()
});

module.exports = { ACTIVO, permite, instalarCortafuegos, estado, anotar };
