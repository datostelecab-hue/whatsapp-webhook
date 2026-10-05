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

const otraSede = require('./otraSede');
const { SEDE_FLOTA } = require('./nucleo');

const APPS_SCRIPT_URL ='https://script.google.com/macros/s/AKfycbzPJUuuWtrR-r_kV3ADry2FyTFQAvGmW94wsYO5MohqTFLOQ1YTusKOdjOjLa5ggv50/exec';

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
 * `sede` es la de los coches que puede tocar quien lo pide: la de Madrid si no
 * se dice; la suya, un conductor de Barcelona; y `null`, todas, que es la gente
 * de oficina con el permiso /puertas (Camilo, 02/10/2026).
 *
 * Se apunta SIEMPRE, salga bien o mal, y sin esperar a que termine: que el
 * registro falle no puede dejar a nadie sin abrir el coche.
 */
async function ejecutar({ telefono, conductorId = null, nombre = '', matricula, unitId = '', abrir, sede = SEDE_FLOTA }) {
  const comando = abrir ? 'open_doors' : 'close_doors';
  const t0 = Date.now();
  // CON MAPON CAÍDO NO SE MANDA NADA (05/10/2026): la orden va a Mapon por el
  // Apps Script y no llegaría. Se apunta igual, y quien llama dice SIN_SERVICIO.
  if (!require('./fichaje').maponDisponible()) {
    require('./repo/puertas').registrar({
      telefono, conductorId, conductor: nombre, matricula, unitId, comando, ok: false,
      respuesta: 'Mapon no está disponible: no se mandó la orden', ms: Date.now() - t0,
    });
    return { ok: false, msg: 'Mapon no está disponible', sinMapon: true, otraSede: null };
  }
  // UN COCHE DE OTRA SEDE QUE LA DE QUIEN LO PIDE NO SE ABRE NI SE CIERRA
  // (30/09/2026, ver otraSede.js): el 17 y el 18/09 tres conductores de Madrid
  // le abrieron las puertas al 1888LTJ, en Barcelona, escribiendo la matrícula
  // del ejemplo. Si no se puede saber la sede, tampoco se manda. Se apunta igual.
  // Un coche que no está en Vehículos cuenta como de Madrid.
  let result;
  if (sede) {
    try {
      const deCoche = (await otraSede.sedeDe({ matricula, unitId })) || SEDE_FLOTA;
      if (deCoche !== sede) result = { status: 'error', msg: `Coche de ${otraSede.nombreSede(deCoche)}: no se toca`, otraSede: deCoche };
    } catch (e) { result = { status: 'error', msg: 'No se puede comprobar de qué sede es el coche' }; }
  }
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

// Lo que se le dice a quien quiere abrir o cerrar con Mapon caído (Camilo,
// 05/10/2026: «que por el momento no está disponible por temas de terceros
// ajenos a nosotros», y que con cada error se comunique con Tráfico).
const SIN_SERVICIO = '🔧 Por el momento no se pueden abrir ni cerrar las puertas desde aquí: hay un problema con un ' +
  'proveedor externo, ajeno a Telecab. Comunícate con Tráfico.';

module.exports = { ejecutar, callAppsScript, SIN_SERVICIO };
