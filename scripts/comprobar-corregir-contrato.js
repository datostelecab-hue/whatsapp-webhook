// ============================================================
// CORREGIR EL TIPO DE CONTRATO DESDE PLANTILLA — las reglas
// ============================================================
//   node scripts/comprobar-corregir-contrato.js
//
// 27/10/2026: a Maria Del Pilar Torres Galan la dieron de alta como ETT el
// 24/10 por error y no tenía candidatura, así que no había forma de corregirlo
// (solo se podía desde Selección). Ahora hay «Corregir contrato» en su ficha:
// el mismo contrato y la misma alta, en sus primeros 30 días. Ver
// modules/Conductores/plantilla.service.js (corregirContrato).
//
// No toca ninguna base: el repositorio de conductores se sustituye.
const path = require('path');
const f = require.resolve(path.join(__dirname, '..', 'modules/Conductores/conductores.repo.js'));

let contrato = null, llamadas = [];
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const haceDias = n => new Date(Date.parse(hoy) - n * 86400000).toISOString().slice(0, 10);
require.cache[f] = { id: f, filename: f, loaded: true, exports: new Proxy({
  contratoAbierto: async () => contrato,
  corregirTipoContrato: async (id, datos, quien) => { llamadas.push({ id, datos, usuarioId: quien.usuarioId }); return true; },
}, { get: (o, k) => (k in o ? o[k] : async () => null) }) };

const P = require('../modules/Conductores/plantilla.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const rrhh = { usuarioId: 7, rol: 'oficina' };
const intento = async (datos, quien = rrhh) => {
  llamadas = [];
  try { return { ok: await P.corregirContrato(290, datos, quien) }; } catch (e) { return { error: e.message }; }
};

(async () => {
  // ── Lo de María del Pilar: ETT desde hace 3 días, es propia ──────────────
  contrato = { id: 1, tipo: 'ett', ettNombre: 'GiGroup', alta: haceDias(3) };
  const r = await intento({ tipo: 'propia' });
  igual('Con 3 días de contrato, ETT pasa a propia', r.ok && r.ok.cambiado, true);
  igual('…el MISMO contrato, con su alta, firmado por quien lo hace', llamadas, [{ id: 290, datos: { tipo: 'propia' }, usuarioId: 7 }]);

  // ── Lo que no ────────────────────────────────────────────────────────────
  igual('Tráfico no lo toca', (await intento({ tipo: 'propia' }, { usuarioId: 5, rol: 'trafico' })).error, 'El tipo de contrato es cosa de RRHH');
  igual('Un tipo que no existe, no', /«propia» o «ett»/.test((await intento({ tipo: 'autonomo' })).error || ''), true);
  contrato = { id: 1, tipo: 'ett', ettNombre: 'GiGroup', alta: haceDias(45) };
  const viejo = await intento({ tipo: 'propia' });
  igual('Con 45 días ya no es un error de alta: a «Pasar a propia»', /45 días.*Pasar a propia/.test(viejo.error || ''), true);
  igual('…y no se cambia nada', llamadas.length, 0);
  contrato = { id: 1, tipo: 'propia', ettNombre: null, alta: haceDias(3) };
  igual('Si ya es de ese tipo, no se toca', (await intento({ tipo: 'propia' })).ok, { cambiado: false, tipo: 'propia', alta: haceDias(3) });
  igual('…sin escribir', llamadas.length, 0);
  contrato = null;
  igual('Sin contrato abierto, se dice', (await intento({ tipo: 'propia' })).error, 'Esta persona no tiene ningún contrato abierto');

  // Y al revés también: alguien de plantilla propia que era de la ETT.
  contrato = { id: 1, tipo: 'propia', ettNombre: null, alta: haceDias(30) };
  igual('Con 30 días justos, de propia a ETT también', (await intento({ tipo: 'ett' })).ok.cambiado, true);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
