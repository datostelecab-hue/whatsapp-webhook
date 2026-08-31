// ============================================================
// COMPROBADOR DE RUTAS (sin levantar el servidor)
// ============================================================
// Toda URL que una vista pide al servidor tiene que existir como ruta.
//
//   node scripts/comprobar-rutas.js
//
// Pilla el fallo más tonto y más frecuente al portar una pantalla: renombrar
// una ruta y dejar la vista llamando a la vieja. No revienta al arrancar ni lo
// ve ningún editor; aparece cuando alguien pulsa ese botón concreto y recibe un
// 404 que nadie sabe explicar.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// vista → fichero de rutas y prefijo con el que está montada.
const PARES = [
  ['views/plantilla.ejs', 'routes/plantilla.js', '/plantilla'],
  ['views/vehiculos.ejs', 'routes/vehiculos.js', '/vehiculos'],
  ['views/migraciones.ejs', 'routes/migraciones.js', '/migraciones'],
];

let fallos = 0;

for (const [vista, fichero, prefijo] of PARES) {
  const pv = path.join(RAIZ, vista);
  const pr = path.join(RAIZ, fichero);
  if (!fs.existsSync(pv) || !fs.existsSync(pr)) {
    console.log(`  ? ${vista}: falta el fichero, se salta`);
    continue;
  }

  // Los trozos interpolados (`${d.id}`) se sustituyen por un comodín: lo que se
  // comprueba es la FORMA de la URL, no el valor.
  const texto = fs.readFileSync(pv, 'utf8').replace(/\$\{[^}]*\}/g, '_');

  const patron = new RegExp('["\'`](' + prefijo + '/[A-Za-z0-9_\\-/]*)', 'g');
  const pedidas = [...new Set([...texto.matchAll(patron)].map(m => m[1].replace(/\/+$/, '')))];

  const definidas = [...fs.readFileSync(pr, 'utf8').matchAll(/router\.\w+\('([^']+)'/g)]
    .map(m => m[1]);

  const falla = pedidas.filter(p => {
    const cola = p.slice(prefijo.length) || '/';
    return !definidas.some(d => new RegExp('^' + d.replace(/:[^/]+/g, '[^/]+') + '$').test(cola));
  });

  console.log(`  ${falla.length ? 'x' : 'ok'} ${vista}: ${pedidas.length} URL(s)` +
    (falla.length ? ` — SIN RUTA: ${falla.join(', ')}` : ''));
  fallos += falla.length;
}

console.log(fallos ? `\n${fallos} URL(s) sin ruta` : '\nTodas las URL de las vistas tienen ruta');
process.exitCode = fallos ? 1 : 0;
