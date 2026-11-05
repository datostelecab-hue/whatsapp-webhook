// ============================================================
// EL CSS DE TAILWIND, COMPILADO — quién lo genera y cuándo
// ============================================================
// La configuración vive en tailwind.config.js (léelo: explica por qué ya no se
// usa la CDN «Play»). Aquí solo se decide CUÁNDO se compila, con el CLI de la
// misma versión que servía la CDN (3.4.17), a public/assets/css/tailwind.css:
//
//   · En Render, al instalar: `npm install` lanza el postinstall
//     (`node services/tailwind.js`, y detrás las comprobaciones del JavaScript
//     del navegador: scripts/comprobar-al-instalar.js). Si por lo que sea no hubiera fichero al
//     arrancar, se compila entonces: sin CSS, el ERP sale sin estilos.
//   · En local, al arrancar SIEMPRE y otra vez con cada cambio de una vista o un
//     script: una clase nueva tiene que aparecer sin acordarse de nada, igual
//     que pasaba con Play.
//
// El fichero no se versiona (.gitignore): sale siempre del código desplegado.
//
//   node services/tailwind.js     compila una vez (lo que hace el postinstall)

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const CONFIG = path.join(RAIZ, 'tailwind.config.js');
const ENTRADA = path.join(RAIZ, 'scripts', 'tailwind-entrada.css');
const SALIDA = path.join(RAIZ, 'public', 'assets', 'css', 'tailwind.css');
const ARGS = () => [require.resolve('tailwindcss/lib/cli.js'), '-c', CONFIG, '-i', ENTRADA, '-o', SALIDA, '--minify'];

// En un proceso aparte, no dentro del servidor: Tailwind y PostCSS ocupan
// memoria que no hace falta tener cargada el resto del día.
function compilar() {
  const t0 = Date.now();
  execFileSync(process.execPath, ARGS(), { cwd: RAIZ, stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`🎨 [CSS] Tailwind compilado en ${Date.now() - t0} ms (${Math.round(fs.statSync(SALIDA).size / 1024)} KB)`);
}

// ── En local: recompilar al cambiar algo ─────────────────────────────────────
// SONDEANDO LAS FECHAS, NO CON fs.watch. En Windows, fs.watch avisa también
// cuando un fichero solo se LEE (la fecha de último acceso), y EJS relee cada
// vista al servirla: cada pantalla visitada parecía un cambio y recompilaba
// (03/11/2026, nueve veces en un recorrido). Mirar las fechas de modificación
// de los ~360 ficheros cuesta unos 15 ms y no se equivoca. Si llega un cambio
// mientras compila, se vuelve a compilar al acabar: nunca se queda con un CSS
// de antes del cambio.
const CARPETAS = ['views', 'modules', path.join('public', 'assets', 'js'), 'services', 'routes'];
const SUELTOS = [CONFIG, path.join(RAIZ, 'scripts', 'tailwind-safelist.js')];
function huella() {
  let n = 0, suma = 0;
  const mira = f => { try { suma += fs.statSync(f).mtimeMs; n++; } catch (_) { /* borrado: cambia n */ } };
  const recorre = d => {
    let hijos; try { hijos = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of hijos) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) recorre(p);
      else if (/\.(ejs|js)$/.test(e.name)) mira(p);
    }
  };
  CARPETAS.forEach(c => recorre(path.join(RAIZ, c)));
  SUELTOS.forEach(mira);
  return n + ':' + suma;
}
function vigilar() {
  let ultima = huella(), compilando = false, otraVez = false;
  const lanzar = () => {
    if (compilando) { otraVez = true; return; }
    compilando = true;
    const t0 = Date.now();
    execFile(process.execPath, ARGS(), { cwd: RAIZ }, err => {
      compilando = false;
      if (err) console.error('❌ [CSS] No se pudo recompilar Tailwind:', (err.stderr || err.message || '').toString().slice(0, 500));
      else console.log(`🎨 [CSS] Recompilado en ${Date.now() - t0} ms`);
      if (otraVez) { otraVez = false; lanzar(); }
    });
  };
  setInterval(() => {
    const h = huella();
    if (h !== ultima) { ultima = h; lanzar(); }
  }, 2000).unref();
  console.log('🎨 [CSS] Vigilando las vistas: cada cambio recompila Tailwind');
}

function alArrancar() {
  if (process.env.RENDER) {
    if (fs.existsSync(SALIDA)) return;
    console.error('⚠️  [CSS] No hay tailwind.css (¿no corrió el postinstall?): se compila ahora');
    compilar();   // si falla, que falle el arranque: sin estilos no se puede trabajar
    return;
  }
  try { compilar(); } catch (e) {
    console.error('❌ [CSS] No se pudo compilar Tailwind:', (e.stderr || e.message || '').toString().slice(0, 500));
  }
  vigilar();
}

module.exports = { compilar, alArrancar, SALIDA };

if (require.main === module) compilar();
