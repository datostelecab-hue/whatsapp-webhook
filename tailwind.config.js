// ============================================================
// TAILWIND COMPILADO — la configuración de la casa, en UN sitio
// ============================================================
// Hasta el 03/11/2026 Tailwind llegaba por la CDN «Play» (cdn.tailwindcss.com):
// 407 KB de JavaScript que compilaban el CSS en el navegador en CADA página, y
// otra vez con cada cambio del DOM. La configuración vivía copiada en los dos
// layouts (y ya no coincidían). Ahora se compila una vez con la MISMA versión
// (3.4.17) y se sirve como un .css que el navegador cachea.
//
// Lo genera services/tailwind.js: en Render al instalar (postinstall) y, si
// faltara, al arrancar; en local, al arrancar y con cada cambio de una vista.
// El resultado (public/assets/css/tailwind.css) NO se versiona: sale siempre
// del código que hay, así que no puede quedarse viejo.
//
// LO QUE HAY QUE SABER AL ESCRIBIR UNA VISTA: el compilador lee el CÓDIGO, no el
// DOM. Una clase existe solo si su nombre COMPLETO está escrito en algún fichero
// de `content`. `text-telecab-${tono}` no lo está: o se escribe entera en un
// mapa ({ ok: 'text-telecab-green', … }) o se añade a `safelist` aquí abajo.
// → docs/como-se-trabaja/Trampas conocidas.md

// Una escala entera de Tailwind (50…950) apuntando a un token: los tonos claros
// al token, los oscuros (600+) a su variante honda si la hay.
const tok = n => 'rgb(var(--tc-' + n + ') / <alpha-value>)';
const escala = (n, hondo) => {
  const e = {};
  [50, 100, 200, 300, 400, 500].forEach(k => { e[k] = tok(n); });
  [600, 700, 800, 900, 950].forEach(k => { e[k] = tok(hondo || n); });
  return e;
};

module.exports = {
  content: [
    './views/**/*.ejs',
    './modules/**/*.{ejs,js}',
    './public/assets/js/**/*.js',
    './services/**/*.js',
    './routes/**/*.js',
    './app.js',
  ],
  // Las clases que se MONTAN en tiempo de ejecución y cuyo nombre completo no
  // está escrito en ningún sitio. Cada una con su porqué en ese fichero.
  safelist: require('./scripts/tailwind-safelist'),
  theme: {
    extend: {
      fontFamily: { sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      colors: {
        // Apuntan a los tokens CSS (public/assets/css/telecab.css). El
        // <alpha-value> conserva los modificadores de opacidad (bg-…/15,
        // border-…/40). Cambiar de tema solo cambia las variables.
        telecab: {
          dark: tok('dark'),
          card: tok('card'),
          card2: tok('card2'),
          border: tok('border'),
          gold: tok('gold'),
          'gold-soft': tok('gold-soft'),
          'gold-deep': tok('gold-deep'),
          red: tok('red'),
          'red-hover': tok('red-hover'),
          green: tok('green'),
          warn: tok('warn'),
          violet: tok('violet'),
          azul: tok('azul'),
          text: tok('text'),
          muted: tok('muted'),
        },
        // Los colores crudos de Tailwind que usan las vistas se redirigen a los
        // tokens, EN TODOS SUS TONOS: text-red-300 ES el rojo de la marca,
        // bg-emerald-500/15 ES el verde de la marca al 15 %. Cambiar el tema
        // los cambia a todos, y ninguna vista puede colar un color suelto.
        // Desde el 27/09/2026 el ámbar y el naranja son AVISO (--tc-warn), no
        // el acento: en las vistas marcan «pendiente», «sin contestar»,
        // «provisional»… y el acento queda para lo que se pulsa o se elige.
        red: escala('red', 'red-hover'), rose: escala('red', 'red-hover'),
        emerald: escala('green'), green: escala('green'),
        amber: escala('warn'), orange: escala('warn'), yellow: escala('warn'),
        sky: escala('azul'), blue: escala('azul'),
        violet: escala('violet'), purple: escala('violet'), indigo: escala('violet'),
      },
      // Sombras neutras y de los tokens: ya no hay sombras de color.
      boxShadow: {
        soft: 'var(--tc-sombra-alta)',
        gold: 'var(--tc-sombra)',
      },
    },
  },
};
