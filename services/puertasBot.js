// ============================================================
// PUERTAS DESDE EL BOT — abrir y cerrar un coche, y dejarlo apuntado
// ============================================================
// Vivía dentro de routes/botPuertas.js. Salió aquí (28/09/2026) porque ahora
// abren puertas DOS conversaciones: la del turno del conductor (su coche es el
// del turno) y la de la gente de oficina con el permiso /puertas (su coche es el
// que escriba). Las dos tienen que dar la orden igual y apuntarla igual.
//
// La orden va a Mapon a través del Apps Script (`ejecutar_comando`), que hace de
// relé: no es una hoja, es el único sitio con las credenciales de comandos.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzPJUuuWtrR-r_kV3ADry2FyTFQAvGmW94wsYO5MohqTFLOQ1YTusKOdjOjLa5ggv50/exec';

async function callAppsScript(accion, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('accion', accion);
  Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));

  console.log(`📞 Apps Script: ${accion}`, params);
  const response = await fetch(url.toString());
  const texto = await response.text();
  try {
    return JSON.parse(texto);
  } catch (_) {
    // El Apps Script devolvió HTML (normalmente una excepción no controlada dentro
    // de la acción → Google sirve su página de error). No reventamos: lo registramos
    // y devolvemos un error manejable para que el conductor reciba un aviso claro.
    console.error(`❌ Apps Script "${accion}" no devolvió JSON (HTTP ${response.status}). Inicio de la respuesta: ${texto.slice(0, 300).replace(/\s+/g, ' ')}`);
    return { status: 'error', msg: 'El servicio de comandos no respondió (revisa el Apps Script)', _sinJson: true };
  }
}

/**
 * Abre o cierra las puertas de un coche y lo apunta en el registro de puertas.
 * Devuelve { ok, msg }.
 *
 * Se apunta SIEMPRE, salga bien o mal, y sin esperar a que termine: que el
 * registro falle no puede dejar a nadie sin abrir el coche.
 */
async function ejecutar({ telefono, conductorId = null, nombre = '', matricula, unitId = '', abrir }) {
  const comando = abrir ? 'open_doors' : 'close_doors';
  const t0 = Date.now();
  // UN COCHE DE OTRA SEDE NO SE ABRE NI SE CIERRA DESDE AQUÍ (30/09/2026, ver
  // otraSede.js): el 17 y el 18/09 tres conductores de Madrid le abrieron las
  // puertas al 1888LTJ, en Barcelona, escribiendo la matrícula del ejemplo. Si
  // no se puede saber la sede, tampoco se manda. Se apunta igual.
  let ajena = null, result;
  try { ajena = await require('./otraSede').sedeAjena({ matricula, unitId }); }
  catch (e) { result = { status: 'error', msg: 'No se puede comprobar de qué sede es el coche' }; }
  if (ajena) result = { status: 'error', msg: `Coche de ${require('./otraSede').nombreSede(ajena)}: no se toca`, otraSede: ajena };
  if (!result) {
    console.log(`${abrir ? '🔓 Abriendo' : '🔒 Cerrando'}: ${matricula} (${nombre || telefono})`);
    try { result = await callAppsScript('ejecutar_comando', { matricula, comando }); }
    catch (e) { result = { status: 'error', msg: e.message }; }
  }
  const ok = result.status === 'ok';

  require('./repo/puertas').registrar({
    telefono, conductorId, conductor: nombre,
    matricula, unitId, comando, ok,
    respuesta: ok ? null : (result.msg || JSON.stringify(result).slice(0, 500)),
    ms: Date.now() - t0,
  });
  return { ok, msg: ok ? '' : (result.msg || 'sin respuesta'), otraSede: result.otraSede || null };
}

module.exports = { ejecutar, callAppsScript };
