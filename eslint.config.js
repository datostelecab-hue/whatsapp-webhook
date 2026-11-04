// ============================================================
// ESLINT DEL JAVASCRIPT DEL NAVEGADOR (FRO-4, 04/11/2026)
// ============================================================
//   npm run lint
//
// Solo public/assets/js: los componentes de la casa y, desde el FRO-4, el
// JavaScript de cada pantalla (vistas/) y del layout (layout/), que antes vivía
// dentro de los .ejs, donde ninguna herramienta podía mirarlo.
//
// Lo que importa es `no-undef`: un nombre que no existe —una errata, una
// función que se quitó de otro sitio— no avisa en ninguna parte hasta que
// alguien pulsa justo ese botón. `scripts/comprobar-vistas.js` solo mira la
// sintaxis. Lo que no se usa (`no-unused-vars`) va en aviso: limpiarlo es otra
// tanda, y no debe impedir nada.
//
// LOS GLOBALES DE LA CASA SE LEEN DEL CÓDIGO, no de una lista escrita aquí: cada
// componente se cuelga de window (`global.Listado = …`, `window.X = …`), y lo que
// se cuelga en un fichero existe para todos los demás. Un componente nuevo entra
// solo.

const fs = require('fs');
const path = require('path');
const globals = require('globals');

const JS = path.join(__dirname, 'public', 'assets', 'js');

function globalesDeLaCasa(dir = JS, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) globalesDeLaCasa(p, out);
    else if (e.name.endsWith('.js')) {
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/\b(?:global|window)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out[m[1]] = 'readonly';
    }
  }
  return out;
}

module.exports = [
  {
    files: ['public/assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      // Scripts clásicos, no módulos: comparten el ámbito global de la página.
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globalesDeLaCasa(),
        // Los de fuera, que llegan de cdnjs.
        Chart: 'readonly',
        ChartDataLabels: 'readonly',
        maplibregl: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // `vars: 'local'`: lo de primer nivel de un script clásico es global y lo
      // puede usar otro script de la página; eso no se cuenta como sin usar.
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    },
  },
];
