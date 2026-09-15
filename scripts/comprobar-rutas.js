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
//
// ── HASTA DÓNDE LLEGA, Y HASTA DÓNDE NO ─────────────────────────────────────
// Solo ve CADENAS LITERALES que empiecen por el prefijo del módulo. Eso cubre:
//
//   '/ett/api/ficha/' + id            ✔  se comprueba el principio
//   `/ett/api/ficha/${id}`            ✔  el ${…} vale por un segmento
//   '/ett/api/lista'                  ✔  entera
//
// Lo que NO ve es el trozo que va DESPUÉS de una concatenación:
//
//   '/ett/api/solicitud/' + id + '/enviado'
//
// De ahí solo lee `/ett/api/solicitud/`, porque `/enviado` es otra cadena que
// no empieza por el prefijo. Si alguien escribe `/enviadoo`, esto no se entera.
// Está comprobado, y se deja dicho: una herramienta que promete más de lo que
// da es peor que una que avisa de dónde acaba.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// vista → fichero de rutas y prefijo con el que está montada.
const PARES = [
  ['modules/Conductores/vistas/plantilla.ejs', 'modules/Conductores/plantilla.controller.js', '/plantilla'],
  ['modules/Control/vistas/controlDirecto.ejs', 'modules/Control/control.controller.js', '/control'],
  ['modules/Control/vistas/controlCampanas.ejs', 'modules/Control/control.controller.js', '/control'],
  ['modules/Control/vistas/controlCampanasInforme.ejs', 'modules/Control/control.controller.js', '/control'],
  ['modules/Control/vistas/controlHistorico.ejs', 'modules/Control/control.controller.js', '/control'],
  ['modules/Control/vistas/kmTraza.ejs', 'modules/Control/control.controller.js', '/control'],
  ['modules/Control/vistas/alertas.ejs', 'modules/Control/alertas.controller.js', '/alertas'],
  ['modules/Control/vistas/callCenter.ejs', 'modules/Control/callcenter.controller.js', '/callcenter'],
  ['modules/Control/vistas/justificantes.ejs', 'modules/Control/justificantes.controller.js', '/justificantes'],
  ['modules/Vehiculos/vistas/vehiculos.ejs', 'modules/Vehiculos/vehiculos.controller.js', '/vehiculos'],
  ['views/migraciones.ejs', 'routes/migraciones.js', '/migraciones'],
  ['modules/Nominas/vistas/nominas.ejs', 'modules/Nominas/nominas.controller.js', '/nominas'],
  ['modules/Seleccion/vistas/seleccion.ejs', 'modules/Seleccion/seleccion.controller.js', '/seleccion'],
  ['modules/Seleccion/vistas/ett.ejs', 'modules/Seleccion/ett.controller.js', '/ett'],
  ['modules/Seleccion/vistas/vacantes.ejs', 'modules/Seleccion/vacantes.controller.js', '/vacantes'],
  ['modules/Seleccion/vistas/generador.ejs', 'modules/Seleccion/generador.controller.js', '/generador'],
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

  // El PUNTO cuenta como parte de la URL. Hay rutas que lo llevan a propósito
  // —/informe.xlsx, /api/gestoria.xlsx— porque así el navegador nombra bien la
  // descarga. Sin admitirlo, la URL se cortaba en el punto y el comprobador
  // acusaba de "sin ruta" a una que existe: un falso positivo, que en una
  // herramienta como esta es peor que no comprobar nada.
  const patron = new RegExp('["\'`](' + prefijo + '/[A-Za-z0-9_\\-/.]*)', 'g');
  // UNA URL QUE ACABA EN BARRA LLEVA ALGO DETRÁS. No todas las vistas escriben
  // `/api/ficha/${id}`: muchas concatenan —`'/api/ficha/' + id`— y ahí la
  // cadena literal termina en barra. Recortarla sin más dejaba `/api/ficha`,
  // que no casa con `/api/ficha/:id`, y el comprobador acusaba de "sin ruta" a
  // ocho URL que existen. Un falso positivo en una herramienta como esta es
  // peor que no comprobar nada: se deja de mirar la salida.
  //
  // Así que la barra final se sustituye por el comodín, que es lo que de verdad
  // significa: aquí viene un parámetro.
  // UNA CLAVE DE PERMISO NO ES UNA URL, aunque se escriba igual. Los permisos
  // del ERP SON prefijos de ruta —`/alertas/config`— y una vista que pinta media
  // pantalla solo para quien puede lleva dentro
  // `permisos.includes('/alertas/config')`. Eso no es una petición: es una
  // pregunta, y esa clave no tiene por qué existir como ruta suya (debajo
  // cuelgan `/config/api/guardar` y `/config/api/destinatarios`, que sí existen).
  //
  // Sin esta excepción el comprobador acusaba de "sin ruta" a una clave de
  // permiso correcta, que es justo el falso positivo que hace que alguien deje
  // de mirar la salida.
  const claves = new Set([...texto.matchAll(/\.includes\(\s*["'`]([^"'`]+)/g)].map(m => m[1]));

  const pedidas = [...new Set([...texto.matchAll(patron)]
    .filter(m => !claves.has(m[1]))
    .map(m => (m[1].endsWith('/') ? m[1] + '_' : m[1].replace(/\/+$/, ''))))];

  const definidas = [...fs.readFileSync(pr, 'utf8').matchAll(/router\.\w+\('([^']+)'/g)]
    .map(m => m[1]);

  const falla = pedidas.filter(p => {
    const cola = p.slice(prefijo.length) || '/';

    // Las que venían con barra al final llevan un trozo pegado detrás, y ese
    // trozo puede ser más de un segmento: `'/api/solicitud/' + id + '/enviado'`
    // deja en el código la cadena `/api/solicitud/`, y la ruta de verdad es
    // `/api/solicitud/:id/enviado`.
    //
    // Para esas la comparación va AL REVÉS: en vez de preguntar si la ruta casa
    // con la URL, se pregunta si alguna RUTA EMPIEZA POR esa URL. Probarlo del
    // otro lado —la ruta como principio de la URL— parecía equivalente y no lo
    // es: la ruta `/` es principio de absolutamente todo y daba por buena
    // cualquier cosa, incluido un `/api/anularrr/` mal escrito a propósito.
    if (cola.endsWith('/_')) {
      const trozo = cola.slice(0, -1);                       // sin el comodín final
      return !definidas.some(d => d.replace(/:[^/]+/g, '_').startsWith(trozo));
    }

    return !definidas.some(d => new RegExp('^' + d.replace(/:[^/]+/g, '[^/]+') + '$').test(cola));
  });

  console.log(`  ${falla.length ? 'x' : 'ok'} ${vista}: ${pedidas.length} URL(s)` +
    (falla.length ? ` — SIN RUTA: ${falla.join(', ')}` : ''));
  fallos += falla.length;
}

console.log(fallos ? `\n${fallos} URL(s) sin ruta` : '\nTodas las URL de las vistas tienen ruta');
process.exitCode = fallos ? 1 : 0;
