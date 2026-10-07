// ============================================================
// LO COMÚN A LOS FONDOS DEL ACCESO — el cielo, la sierra y la ciudad
// ============================================================
// Cada sede tiene su escena (madrid.js, barcelona.js), pero las dos son el
// mismo atardecer: el mismo cielo, las mismas estrellas y nubes, las mismas
// montañas a contraluz y la misma ciudad con sus ventanas. Aquí vive eso; cada
// escena pone lo suyo (sus edificios conocidos y lo que tiene delante).
//
// `lienzo()` devuelve un objeto que va acumulando las capas en orden; al final,
// `svg()` las junta. El azar es un mulberry32 con semilla fija: cada escena
// sale siempre igual.

const W = 2560, H = 1440;
const r1 = n => Math.round(n * 10) / 10;
const op = n => Math.round(n * 100) / 100;

function lienzo({ semilla, HORIZONTE, BASE, SOL_X }) {
  let s = semilla;
  function azar() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const entre = (a, b) => a + (b - a) * azar();
  const defs = [];
  const capas = [];
  const L = { W, H, HORIZONTE, BASE, SOL_X, azar, entre, r1, op, defs, capas };

  // ── Una cresta de montañas por desplazamiento del punto medio ─────────────
  L.cresta = (puntos, iteraciones, rugosidad, amplitud) => {
    let pts = puntos.map(([x, y]) => ({ x, y }));
    let amp = amplitud;
    for (let i = 0; i < iteraciones; i++) {
      const nuevos = [pts[0]];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1];
        nuevos.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + entre(-amp, amp) }, b);
      }
      pts = nuevos;
      amp *= rugosidad;
    }
    return pts;
  };
  L.camino = (pts, fondoY) => `M0 ${fondoY} L${pts.map(p => `${r1(p.x)} ${r1(p.y)}`).join(' L')} L${W} ${fondoY} Z`;
  /** La altura de una cresta en x (para poner algo encima). */
  L.alturaEn = (pts, x) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      if (pts[k].x <= x && pts[k + 1].x >= x) {
        const t = (x - pts[k].x) / ((pts[k + 1].x - pts[k].x) || 1);
        return pts[k].y + (pts[k + 1].y - pts[k].y) * t;
      }
    }
    return pts[pts.length - 1].y;
  };

  // ── El cielo: de la noche arriba al oro del horizonte, y el sol puesto ────
  L.cielo = () => {
    defs.push(`
  <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#060918"/>
    <stop offset=".26" stop-color="#0F1638"/>
    <stop offset=".47" stop-color="#29295A"/>
    <stop offset=".62" stop-color="#5C3B69"/>
    <stop offset=".74" stop-color="#A9566A"/>
    <stop offset=".84" stop-color="#E8845D"/>
    <stop offset=".92" stop-color="#FFB06A"/>
    <stop offset="1" stop-color="#FFD48C"/>
  </linearGradient>
  <radialGradient id="resplandor" cx="${SOL_X}" cy="${HORIZONTE}" r="${W * 0.55}" gradientUnits="userSpaceOnUse"
                  gradientTransform="translate(${SOL_X} ${HORIZONTE}) scale(1 .5) translate(${-SOL_X} ${-HORIZONTE})">
    <stop offset="0" stop-color="#FFF0C4" stop-opacity="1"/>
    <stop offset=".12" stop-color="#FFC27A" stop-opacity=".8"/>
    <stop offset=".32" stop-color="#F08A5E" stop-opacity=".42"/>
    <stop offset=".6" stop-color="#8E4468" stop-opacity=".14"/>
    <stop offset="1" stop-color="#2A1F45" stop-opacity="0"/>
  </radialGradient>
  <filter id="difuso" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="11"/></filter>
  <filter id="sol" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="38"/></filter>
  <filter id="brillo" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
  <filter id="brilloAncho" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id="grano" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="r"/>
    <feColorMatrix in="r" type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .9 0"/>
  </filter>`);
    capas.push(`<rect width="${W}" height="${H}" fill="url(#cielo)"/>`);
    capas.push(`<rect width="${W}" height="${BASE + 60}" fill="url(#resplandor)"/>`);
    capas.push(`<circle cx="${SOL_X}" cy="${HORIZONTE - 70}" r="110" fill="#FFE7B4" opacity=".75" filter="url(#sol)"/>`);
  };

  // ── Las estrellas, arriba y lejos del sol ──────────────────────────────────
  L.estrellas = (n = 300) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = Math.pow(azar(), 1.5) * HORIZONTE * 0.5;
      const x = azar() * W;
      const lejosDelSol = Math.min(1, Math.abs(x - SOL_X) / (W * 0.45));
      const o = (1 - y / (HORIZONTE * 0.5)) * entre(0.2, 0.85) * (0.25 + 0.75 * lejosDelSol);
      if (o < 0.07) continue;
      const r = azar() < 0.06 ? entre(1.6, 2.3) : entre(0.6, 1.3);
      out.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="#E9EDFF" opacity="${op(o)}"/>`);
    }
    capas.push(`<g>${out.join('')}</g>`);
  };

  // ── Nubes: jirones encendidos por debajo cerca del sol, y altos fríos ──────
  L.nubes = (bajas, altas) => {
    defs.push(`
  <linearGradient id="nube" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4A3462"/>
    <stop offset=".6" stop-color="#D5786E"/>
    <stop offset="1" stop-color="#FFC08A"/>
  </linearGradient>
  <linearGradient id="nubeAlta" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1E2148"/>
    <stop offset="1" stop-color="#6A4570"/>
  </linearGradient>`);
    const out = [];
    function jiron(cx, cy, largo, grosor, relleno, opacidad) {
      const piezas = Math.round(entre(3, 6));
      for (let i = 0; i < piezas; i++) {
        const x = cx + entre(-largo * 0.35, largo * 0.35);
        const y = cy + entre(-grosor * 0.8, grosor * 0.8);
        out.push(`<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(largo * entre(0.25, 0.5))}" ry="${r1(grosor * entre(0.5, 1))}"
      fill="url(#${relleno})" opacity="${op(opacidad * entre(0.7, 1))}" filter="url(#difuso)"/>`);
      }
    }
    bajas.forEach(([x, y, l, g]) => jiron(W * x, y, l, g, 'nube', 0.55));
    altas.forEach(([x, y, l, g]) => jiron(W * x, y, l, g, 'nubeAlta', 0.5));
    capas.push(`<g>${out.join('')}</g>`);
  };

  // ── Dos crestas de montaña a contraluz, con bruma al pie ───────────────────
  L.sierra = (puntosLejos, puntosCerca) => {
    const lejos = L.cresta(puntosLejos, 7, 0.55, 44);
    const cerca = L.cresta(puntosCerca, 7, 0.52, 28);
    defs.push(`
  <linearGradient id="sierraLejos" x1="0" y1="700" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#7A5276"/><stop offset="1" stop-color="#D07A62"/>
  </linearGradient>
  <linearGradient id="sierraCerca" x1="0" y1="850" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#3E2E54"/><stop offset="1" stop-color="#7A4458"/>
  </linearGradient>
  <linearGradient id="bruma" x1="0" y1="${HORIZONTE - 90}" x2="0" y2="${BASE + 40}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFB070" stop-opacity="0"/>
    <stop offset=".55" stop-color="#F29563" stop-opacity=".4"/>
    <stop offset="1" stop-color="#8A4458" stop-opacity="0"/>
  </linearGradient>`);
    capas.push(`<path d="${L.camino(lejos, BASE + 40)}" fill="url(#sierraLejos)" opacity=".92"/>`);
    capas.push(`<path d="${L.camino(cerca, BASE + 40)}" fill="url(#sierraCerca)"/>`);
    return { lejos, cerca };
  };
  L.bruma = () => capas.push(`<rect y="${HORIZONTE - 90}" width="${W}" height="${BASE - HORIZONTE + 130}" fill="url(#bruma)"/>`);

  // ── La ciudad: filas de edificios con sus ventanas ─────────────────────────
  L.ventanas = [];
  L.antenas = [];
  L.defsCiudad = () => defs.push(`
  <linearGradient id="edificioAtras" x1="0" y1="${BASE - 170}" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#3A2C4C"/><stop offset="1" stop-color="#55344C"/>
  </linearGradient>
  <linearGradient id="edificio" x1="0" y1="${BASE - 320}" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#181930"/><stop offset="1" stop-color="#0E0F1F"/>
  </linearGradient>`);
  function ventanasDe(x, y, w, h, prob, pie) {
    // Por plantas: una planta encendida tiende a estarlo entera (oficinas).
    for (let fy = y + 7; fy < pie - 5; fy += 8) {
      const planta = azar() < prob * 2.2;
      for (let fx = x + 4; fx < x + w - 4; fx += 6) {
        if (azar() < (planta ? 0.55 : prob * 0.35)) {
          const tono = azar() < 0.82 ? '#FFD58A' : '#CFE0FF';
          L.ventanas.push(`<rect x="${r1(fx)}" y="${r1(fy)}" width="2.6" height="3.6" fill="${tono}" opacity="${op(entre(0.35, 0.95))}"/>`);
        }
      }
    }
  }
  L.fila = ({ desde, hasta, pie, alto, color, prob, centro, anchos, hueco, centroX = W * 0.52 }) => {
    const out = [];
    let x = desde;
    while (x < hasta) {
      const w = entre(anchos[0], anchos[1]);
      const cerca = 1 - Math.min(1, Math.abs(x - centroX) / (W * 0.48));
      // La mayoría bajos; de vez en cuando uno alto, más hacia el centro.
      const alto2 = azar() < 0.14 + 0.2 * cerca ? entre(alto[1] * 0.6, alto[1]) : entre(alto[0], alto[1] * 0.45);
      const h = alto2 * (0.6 + centro * cerca);
      const y = pie - h;
      let d = `M${r1(x)} ${pie + 2} V${r1(y)} H${r1(x + w)} V${pie + 2} Z`;
      if (azar() < 0.35) {        // azotea escalonada
        const w2 = w * entre(0.35, 0.7), h2 = entre(10, 36), x2 = x + (w - w2) * entre(0.2, 0.8);
        d += ` M${r1(x2)} ${r1(y + 1)} V${r1(y - h2)} H${r1(x2 + w2)} V${r1(y + 1)} Z`;
        if (azar() < 0.3) {       // antena con su baliza
          const ax = x2 + w2 / 2, ay = y - h2 - entre(20, 50);
          L.antenas.push(`<line x1="${r1(ax)}" y1="${r1(y - h2)}" x2="${r1(ax)}" y2="${r1(ay)}" stroke="${color.startsWith('url') ? '#1A1B30' : color}" stroke-width="1.6"/>
          <circle cx="${r1(ax)}" cy="${r1(ay)}" r="1.8" fill="#FF5A4A"/>`);
        }
      }
      out.push(`<path d="${d}" fill="${color}"/>`);
      if (prob) ventanasDe(x, y, w, h, prob, pie);
      x += w + entre(-hueco, hueco * 0.6);
    }
    return out.join('');
  };
  L.soltarVentanas = () => { capas.push(`<g>${L.ventanas.join('')}</g>`); L.ventanas.length = 0; };
  L.soltarAntenas = () => { capas.push(`<g>${L.antenas.join('')}</g>`); L.antenas.length = 0; };

  /** La luz de la ciudad que sube al cielo, justo encima del suelo. */
  L.contaminacion = () => {
    defs.push(`
  <linearGradient id="contaminacion" x1="0" y1="${BASE - 60}" x2="0" y2="${BASE + 90}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FF9E5E" stop-opacity="0"/>
    <stop offset=".55" stop-color="#E7885C" stop-opacity=".28"/>
    <stop offset="1" stop-color="#0A0B16" stop-opacity="0"/>
  </linearGradient>`);
    capas.push(`<rect y="${BASE - 60}" width="${W}" height="150" fill="url(#contaminacion)"/>`);
  };

  /** Una baliza roja de aviso a los aviones, con su halo. */
  L.baliza = (x, y) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="12" fill="#FF3B3B" opacity=".5" filter="url(#brillo)"/>
    <circle cx="${r1(x)}" cy="${r1(y)}" r="3" fill="#FF7A6A"/>`;

  // ── Viñeta y grano (el grano evita las bandas del degradado al comprimir) ──
  L.vinetaYGrano = () => {
    defs.push(`
  <radialGradient id="vineta" cx=".5" cy=".55" r=".78">
    <stop offset=".5" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity=".5"/>
  </radialGradient>`);
    capas.push(`<rect width="${W}" height="${H}" fill="url(#vineta)"/>`);
    capas.push(`<rect width="${W}" height="${H}" filter="url(#grano)" opacity=".05"/>`);
  };

  L.svg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs.join('')}</defs>
${capas.join('\n')}
</svg>`;
  return L;
}

module.exports = { W, H, r1, op, lienzo };
