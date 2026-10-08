// ============================================================
// EL ESTADO DEL COCHE Y SU HISTORIAL, SIEMPRE JUNTOS
// ============================================================
// El estado del coche vive en dos sitios: `vehiculo.estado_operativo` (el de
// ahora) y `vehiculo_estado_hist` (desde cuándo). El 08/10/2026 había 20 coches
// con los dos descuadrados: el desplegable de estado del planificador cambiaba
// la columna y no el historial, y la ficha de Vehículos del 0715MMZ decía «En
// taller» arriba y «Operativo, hasta ahora» en su historial (db/188).
//
//   node scripts/comprobar-estado-coche.js
//
// No toca la base: la transacción del planificador se sustituye por una que
// apunta lo que se le pide.
const fs = require('fs');
const path = require('path');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

const db = require('../services/db');
const plan = require('../modules/Planificacion/planificador.repo');

/** Una transacción de mentira: el coche tiene `actual` y se apunta cada consulta. */
function simular(actual) {
  const hechas = [];
  db.transaccion = async fn => fn({
    query: async (sql, p) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT estado_operativo, base_zona_id FROM vehiculo/.test(s)) return { rows: [actual], rowCount: 1 };
      if (/^SELECT id FROM base_zona/.test(s)) return { rows: [{ id: 5 }], rowCount: 1 };
      hechas.push({ s, p });
      return { rows: [{}], rowCount: 1 };
    },
  });
  return hechas;
}
const de = (hechas, re) => hechas.filter(h => re.test(h.s));

(async () => {
  // ── El planificador cambia el estado: columna E historial ──────────────
  let h = simular({ estado_operativo: 'O', base_zona_id: 3 });
  await plan.guardar([{ vehiculoId: 11, estadoVeh: 'X' }], { usuarioId: 7 });
  igual('Se cambia la columna', de(h, /^UPDATE vehiculo SET/).map(x => x.p), [['X', 11]]);
  igual('Se cierra lo que había en el historial', de(h, /^UPDATE vehiculo_estado_hist SET hasta/).length, 1);
  const alta = de(h, /^INSERT INTO vehiculo_estado_hist/)[0];
  igual('Y se abre «En taller» desde hoy, con quién lo cambió',
    alta && [alta.p[0], alta.p[2], alta.p[3], /^\d{4}-\d{2}-\d{2}$/.test(alta.p[1])], [11, 'X', 7, true]);

  h = simular({ estado_operativo: 'X', base_zona_id: 3 });
  await plan.guardar([{ vehiculoId: 11, estadoVeh: 'X' }], { usuarioId: 7 });
  igual('El mismo estado no abre historial', de(h, /vehiculo_estado_hist/).length, 0);

  // ── Y la zona, con el suyo ───────────────────────────────────────────────
  h = simular({ estado_operativo: 'O', base_zona_id: 3 });
  await plan.guardar([{ vehiculoId: 11, zona: 'Getafe' }], { usuarioId: 7 });
  igual('Otra zona: historial de zona', de(h, /^INSERT INTO vehiculo_base_hist/).map(x => x.p[2]), [5]);
  igual('Sin tocar el de estado', de(h, /vehiculo_estado_hist/).length, 0);
  h = simular({ estado_operativo: 'O', base_zona_id: 3 });
  await plan.guardar([{ vehiculoId: 11, zona: '' }], { usuarioId: 7 });
  igual('Sin zona: se cierra la que tenía', de(h, /^UPDATE vehiculo_base_hist SET hasta/).length, 1);

  // ── Nadie escribe el estado a pelo ───────────────────────────────────────
  // Todo fichero que escriba `estado_operativo` tiene que abrir su historial
  // (`reemplazar('estadoVehiculo'`). Las migraciones van aparte: db/188 cuadra
  // lo que dejaron.
  const raiz = path.join(__dirname, '..');
  const ficheros = [];
  const recorrer = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', 'archivo'].includes(e.name)) recorrer(p); }
    else if (e.name.endsWith('.js')) ficheros.push(p);
  });
  ['modules', 'services', 'routes'].forEach(d => recorrer(path.join(raiz, d)));
  const sinHistorial = ficheros.filter(f => {
    const s = fs.readFileSync(f, 'utf8');
    return /\bestado_operativo\s*=\s*\$/.test(s) && !s.includes("reemplazar('estadoVehiculo'");
  }).map(f => path.relative(raiz, f).replace(/\\/g, '/'));
  igual('Quien escribe el estado del coche abre su historial', sinHistorial, []);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
