// ============================================================
// ¿SE ENTERA EL ERP DE QUE MAPON ESTÁ CAÍDO? (sin llamar a Mapon)
// ============================================================
//   node scripts/probar-mapon-caido.js
//
// El 05/10/2026 Mapon suspendió la cuenta por un pago pendiente y contestaba a
// todo «Company suspended». services/mapon.js lo detecta en cada respuesta
// (fetchMapon) y lo dice con `disponible()`; el fichaje y las puertas lo miran.
// Aquí se sustituye `fetch` por un Mapon de mentira que contesta lo que toque.
let respuesta = { status: 200, cuerpo: { data: { units: [{ unit_id: 1, number: '1111AAA', make: 'Toyota', model: 'Corolla' }] } } };
let llamadas = 0;
global.fetch = async () => {
  llamadas++;
  const texto = JSON.stringify(respuesta.cuerpo);
  const r = { ok: respuesta.status < 400, status: respuesta.status, text: async () => texto, json: async () => JSON.parse(texto) };
  r.clone = () => ({ text: async () => texto });
  return r;
};
const mapon = require('../services/mapon');

let mal = 0;
const comprobar = (t, ok, d) => { if (!ok) mal++; console.log(`  ${ok ? 'ok' : 'MAL'}  ${t}${!ok && d ? '  → ' + d : ''}`); };
const SUSPENDIDA = { status: 200, cuerpo: { error: { code: 1, msg: 'Company suspended' } } };

(async () => {
  console.log('\n1. Mapon contesta bien');
  const u = await mapon.unidadPorMatricula('1111AAA');
  comprobar('encuentra la matrícula', u && String(u.unitId) === '1');
  comprobar('y está disponible', mapon.disponible() && mapon.estadoCaida() === null);

  console.log('\n2. La cuenta, suspendida');
  respuesta = SUSPENDIDA;
  let e1 = null;
  try { await mapon.leerAlertas({}); } catch (e) { e1 = e; }
  comprobar('la llamada falla con el motivo', e1 && /Company suspended/.test(e1.message), e1 && e1.message);
  comprobar('Mapon queda NO disponible', !mapon.disponible());
  comprobar('y se sabe por qué', (mapon.estadoCaida() || {}).motivo === 'Company suspended', JSON.stringify(mapon.estadoCaida()));

  console.log('\n3. Un error de negocio no tumba nada');
  respuesta = { status: 200, cuerpo: { data: { units: [] } } };   // una respuesta buena levanta la caída…
  try { await mapon.leerAlertas({}); } catch (_) { /* da igual */ }
  comprobar('una respuesta buena la levanta', mapon.disponible());
  respuesta = { status: 200, cuerpo: { error: { code: 5, msg: 'Driver with this phone already exists' } } };
  try { await mapon.leerAlertas({}); } catch (_) { /* da igual */ }
  comprobar('«ya existe» no lo da por caído', mapon.disponible());

  console.log('\n4. El padrón de unidades, sin nada en caché');
  delete require.cache[require.resolve('../services/mapon')];
  const limpio = require('../services/mapon');
  respuesta = SUSPENDIDA;
  let e2 = null;
  try { await limpio.unidades(); } catch (e) { e2 = e; }
  comprobar('lanza en vez de guardar un padrón vacío', e2 && /Company suspended/.test(e2.message), e2 && e2.message);
  respuesta = { status: 200, cuerpo: { data: { units: [{ unit_id: 1, number: '1111AAA' }] } } };
  const m = await limpio.unidades();
  comprobar('en cuanto vuelve, el padrón entra entero', m.size === 1 && limpio.disponible());

  console.log(mal ? `\n${mal} MAL` : '\nTodo cuadra');
  process.exitCode = mal ? 1 : 0;
})();
