// ============================================================
// NO SE INSTALA (NI SE DESPLIEGA) UNA PANTALLA ROTA (04/11/2026)
// ============================================================
//   postinstall: node services/tailwind.js && node scripts/comprobar-al-instalar.js
//
// Cada `npm install` SIN ARGUMENTOS lanza el postinstall (`npm install <paquete>`
// y `--ignore-scripts` no: después de añadir un paquete, `npm run comprobar` y
// `npm run lint` a mano), y aquí se pasan las dos comprobaciones del
// JavaScript del navegador:
//   · `npm run comprobar` (scripts/comprobar-vistas.js): sintaxis, nonce,
//     nombres globales repetidos, datos del servidor que no llegan…
//   · `npm run lint` (ESLint, solo los errores): un nombre que no existe.
// Si una falla, este script sale con 1 y el `npm install` termina en error.
//
//   · EN RENDER el build es ese `npm install`: falla el build y NO se despliega.
//     Render sigue sirviendo la versión anterior, la que funcionaba. Un error que
//     antes solo se veía cuando alguien pulsaba justo ese botón se queda ahora en
//     el log del build, con su fichero y su línea.
//   · EN LOCAL avisa igual (decidido así el 04/11/2026). Las dependencias ya
//     están instaladas cuando corre el postinstall: el error no deja el proyecto
//     sin node_modules, solo dice qué arreglar.
//
// Se lanzan las dos aunque la primera falle: en el log salen todos los
// problemas de una vez, no uno por intento.
//
// ESLint mira cada fichero suelto y da por definido en todos lo que cualquier
// componente cuelga de window. Lo que cada PÁGINA trae de verdad lo mira
// comprobar-vistas (desde el 05/11/2026, revisarNombres): un `Graficos` en una
// pantalla que no carga graficos.js, o un nombre que no existe en los arranques
// en línea de los layouts, también paran el build.
//
// LO QUE NO VE: un <script> dentro de un `<% if %>` de EJS cuenta como cargado
// siempre; lo que se carga o se crea en tiempo de ejecución (un import(), un
// `window[nombre] =`) no lo conoce; y no mira el ORDEN de carga (usar al cargar
// algo que define un script posterior).
//
// LAS HERRAMIENTAS (eslint, espree, globals) VAN EN `dependencies` Y CON LA
// VERSIÓN EXACTA, como tailwindcss. En dependencies, porque se instalan siempre,
// ponga lo que ponga NODE_ENV al construir (Render solo lo pone al ejecutar,
// pero si alguien lo añadiera en el panel, npm se saltaría las devDependencies
// y el build se rompería por no tener ESLint). Exactas, porque no hay
// package-lock: con un rango, Render instalaría lo último, y un `globals` nuevo
// con un nombre más del navegador haría fallar comprobar-vistas sin que nadie
// hubiera tocado el código.

const { spawnSync } = require('child_process');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

/** Lanza un script de Node con la salida a la vista; true si acaba bien. */
function pasar(nombre, args) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: RAIZ, stdio: 'inherit' });
  const ok = r.status === 0;
  if (r.error) console.error(r.error);
  console.log(`${ok ? '✅' : '❌'} [COMPROBAR] ${nombre} (${Date.now() - t0} ms)`);
  return ok;
}

const ESLINT = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');

const resultados = [
  pasar('comprobar-vistas', [path.join('scripts', 'comprobar-vistas.js')]),
  pasar('ESLint', [ESLINT, '--quiet', path.join('public', 'assets', 'js')]),
];

if (resultados.includes(false)) {
  console.error('❌ [COMPROBAR] El JavaScript del navegador tiene errores: en Render no se despliega. Arréglalos (npm run comprobar, npm run lint) y vuelve a subir.');
  process.exit(1);
}
