// ============================================================
// EL AVISO DEL EFECTIVO SIN ENTREGAR — las reglas
// ============================================================
//   node scripts/comprobar-aviso-efectivo.js
//
// La tarjeta como las de cumpleaños con quien tiene el efectivo activado en BOLT
// y nunca ha entregado en ventanilla (27/10/2026). Solo para quien tenga la
// llave '/avisos/efectivo' (Víctor y Daiane, db/220). Ver
// modules/Administracion/avisoEfectivo.service.js.
//
// No toca ninguna base: permisos y Recaudación se sustituyen. El catálogo y la
// siembra por rol se leen del módulo de verdad.
const path = require('path');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// ── 1. El catálogo: la llave existe y no la reparte ningún rol ──────────────
const P = require('../services/permisos');
const item = P.CATALOGO.flatMap(g => g.items.flatMap(i => [i, ...(i.hijos || [])])).find(i => i.clave === '/avisos/efectivo');
igual('La llave está en el catálogo (se puede dar en Usuarios y permisos)', !!item, true);
igual('…y es manual: no entra con el catálogo entero', !!(item && item.manual), true);
const ROLES = ['oficina', 'trafico', 'jefe_trafico', 'gestor_trafico', 'taller', 'reclutador', 'administracion',
  'operaciones', 'gerencia', 'direccion', 'superadmin', 'desarrollador'];
igual('Ningún rol la siembra', ROLES.filter(r => (P.semillaDeRol(r) || []).includes('/avisos/efectivo')), []);
igual('La ruta del aviso la guarda esa llave', P.claveDeRuta('/avisos/efectivo/api', 'GET'), '/avisos/efectivo');

// ── 2. El servicio, con dobles ──────────────────────────────────────────────
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};
let llaves = {};               // usuario → Set de claves
let leidas = 0;
sustituir('services/permisos.js', {
  clavesDe: async id => { if (llaves[id] instanceof Error) throw llaves[id]; return llaves[id] || new Set(); },
});
sustituir('modules/Administracion/recaudacion.repo.js', {
  conEfectivoSinEntregar: async () => { leidas++; return [
    { id: '10', nombre: 'ANA RUIZ', enPlantilla: false, telefono: '+34600000001', ett: true, baja: '2026-09-21' },
    { id: '11', nombre: 'LUIS PEÑA', enPlantilla: true, telefono: null, ett: false, baja: null },
    { id: '12', nombre: 'EVA SANZ', enPlantilla: true, telefono: '+34600000003', ett: false, baja: null },
    { id: '13', nombre: 'JOSÉ GIL', enPlantilla: false, telefono: null, ett: true, baja: '2026-10-01' },
  ]; },
  cuadro: async () => ({ filas: [
    { conductorId: '10', sinFicha: false, aRecaudar: 120.5 },
    { conductorId: '11', sinFicha: false, aRecaudar: 15 },
    { conductorId: '12', sinFicha: false, aRecaudar: 80.256 },
    { conductorId: '13', sinFicha: false, aRecaudar: -4 },
    // Una cuenta de BOLT sin ficha con el mismo «id» no se mezcla con nadie.
    { conductorId: '11', sinFicha: true, aRecaudar: 999 },
  ] }),
});
const A = require('../modules/Administracion/avisoEfectivo.service');

(async () => {
  llaves = { 7: new Set(['/recaudacion']), 3: new Set(['/avisos/efectivo']), 9: new Set(['/avisos/efectivo', '/recaudacion']) };

  leidas = 0;
  igual('Sin la llave no se ve, aunque entre en Recaudación', await A.paraLaTarjeta(7), { ver: false });
  igual('…ni el que tiene acceso total por su rol', await A.paraLaTarjeta(7, { rolTotal: true }), { ver: false });
  igual('…y ni se lee la lista', leidas, 0);
  igual('Sin usuario, no', await A.paraLaTarjeta(undefined), { ver: false });
  llaves[5] = new Error('la base no contesta');
  igual('Si no se puede mirar la llave, no se enseña', await A.paraLaTarjeta(5), { ver: false });

  const v = await A.paraLaTarjeta(3);
  igual('Víctor la ve', v.ver, true);
  igual('Primero los que siguen en plantilla, y dentro quien más debe; luego los que no',
    v.gente.map(g => g.nombre), ['EVA SANZ', 'LUIS PEÑA', 'ANA RUIZ', 'JOSÉ GIL']);
  igual('Lo que debe es lo del cuadro de Recaudación, redondeado; nunca negativo; sin mezclar cuentas sin ficha',
    v.gente.map(g => g.debe), [80.26, 15, 120.5, 0]);
  igual('Víctor no entra en Recaudación: sin botón para abrirla', v.puedeRecaudacion, false);
  igual('Daiane sí', (await A.paraLaTarjeta(9)).puedeRecaudacion, true);
  llaves[7] = new Set(['/avisos/efectivo']);
  igual('Con la llave y acceso total por su rol, también el botón', (await A.paraLaTarjeta(7, { rolTotal: true })).puedeRecaudacion, true);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
