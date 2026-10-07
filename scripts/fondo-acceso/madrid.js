// ============================================================
// EL FONDO DEL ACCESO DE MADRID — Madrid al anochecer
// ============================================================
// La sierra de Guadarrama con el sol recién puesto, el skyline con las Cuatro
// Torres en el centro y una autovía con las estelas de luz de los coches
// delante; pinos en las esquinas. Lo común (cielo, sierra, ciudad) está en
// comun.js.

const { lienzo } = require('./comun');

module.exports = function madrid() {
  const L = lienzo({ semilla: 20261007, HORIZONTE: 940, BASE: 1040, SOL_X: 2560 * 0.25 });
  const { W, H, BASE, azar, entre, r1, op, defs, capas } = L;

  L.cielo();
  L.estrellas();
  L.nubes(
    [[0.18, 760, 620, 20], [0.36, 820, 520, 14], [0.08, 845, 360, 10], [0.5, 735, 460, 12], [0.3, 690, 380, 9], [0.62, 805, 420, 10]],
    [[0.72, 420, 700, 16], [0.88, 520, 520, 12], [0.55, 360, 600, 10]]);
  L.sierra(
    [[0, 880], [W * 0.1, 800], [W * 0.22, 720], [W * 0.34, 760], [W * 0.48, 840], [W * 0.66, 870], [W * 0.85, 880], [W, 905]],
    [[0, 950], [W * 0.15, 880], [W * 0.3, 915], [W * 0.46, 945], [W * 0.66, 935], [W * 0.85, 955], [W, 950]]);
  L.bruma();

  L.defsCiudad();
  capas.push(L.fila({ desde: -20, hasta: W, pie: BASE, alto: [40, 150], color: 'url(#edificioAtras)', prob: 0, centro: 0.9, anchos: [22, 70], hueco: 4 }));

  // ── Las Cuatro Torres: el centro de la imagen ────────────────────────────
  // La luz del sol viene de la izquierda: la cara izquierda del cristal se
  // enciende; la derecha queda en sombra.
  defs.push(`
  <linearGradient id="cristal" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#E09A72"/>
    <stop offset=".12" stop-color="#9A5C6C"/>
    <stop offset=".45" stop-color="#2C2D55"/>
    <stop offset="1" stop-color="#151A36"/>
  </linearGradient>
  <linearGradient id="cristalAlto" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity=".16"/>
    <stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>
  <pattern id="plantas" width="10" height="12" patternUnits="userSpaceOnUse">
    <path d="M0 11.5H10" stroke="#B9C4F0" stroke-opacity=".1" stroke-width="1"/>
    <path d="M9.5 0V12" stroke="#B9C4F0" stroke-opacity=".06" stroke-width="1"/>
  </pattern>`);
  const torres = [];
  const balizas = [];
  function torre(d, x, arriba, ancho) {
    torres.push(`<path d="${d}" fill="url(#cristal)" fill-rule="evenodd"/>
    <path d="${d}" fill="url(#plantas)" fill-rule="evenodd"/>
    <path d="${d}" fill="url(#cristalAlto)" fill-rule="evenodd"/>`);
    for (let y = arriba + 46; y < BASE - 30; y += 12) {
      if (azar() < 0.18) {
        const w = entre(10, ancho * 0.55);
        torres.push(`<rect x="${r1(x + entre(5, ancho - w - 5))}" y="${r1(y)}" width="${r1(w)}" height="3.4" fill="#FFD58A" opacity="${op(entre(0.3, 0.75))}"/>`);
      }
    }
    balizas.push(L.baliza(x + ancho / 2, arriba - 8));
  }
  const T0 = W * 0.448, PASO = 104;
  // 1 · Como la Torre Cepsa: un marco, con el gran hueco arriba por el que se ve el cielo.
  { const x = T0, w = 86, top = BASE - 690;
    torre(`M${x} ${BASE} V${top} H${x + w} V${BASE} Z M${x + 16} ${top + 20} V${top + 150} H${x + w - 16} V${top + 20} Z`, x, top, w); }
  // 2 · Como la Torre PwC: el cuerpo de esquinas suaves y la corona que se abre.
  { const x = T0 + PASO, w = 78, top = BASE - 660;
    torre(`M${x + 6} ${BASE} V${top + 120} Q${x + 2} ${top + 90} ${x - 12} ${top + 14} Q${x + w / 2} ${top - 8} ${x + w + 12} ${top + 14} Q${x + w - 2} ${top + 90} ${x + w - 6} ${top + 120} V${BASE} Z`, x, top, w); }
  // 3 · Como la Torre de Cristal: la más esbelta, con la cubierta en bisel.
  { const x = T0 + PASO * 2, w = 72, top = BASE - 720;
    torre(`M${x} ${BASE} V${top} L${x + w} ${top + 78} V${BASE} Z`, x, top, w); }
  // 4 · Como la Torre Emperador: un lado se curva y se estrecha al subir.
  { const x = T0 + PASO * 3, w = 80, top = BASE - 630;
    torre(`M${x} ${BASE} V${top} H${x + w * 0.55} C${x + w + 4} ${top + 120} ${x + w + 8} ${top + 360} ${x + w} ${BASE} Z`, x, top, w); }
  capas.push(`<g>${torres.join('')}</g>`);
  // La fila principal, delante de las torres (les tapa el pie).
  capas.push(L.fila({ desde: -30, hasta: W, pie: BASE, alto: [30, 250], color: 'url(#edificio)', prob: 0.1, centro: 1.0, anchos: [18, 76], hueco: 3 }));
  L.soltarAntenas();
  L.soltarVentanas();
  capas.push(`<g>${balizas.join('')}</g>`);

  // La ciudad baja, entre el skyline y la autovía: muchas luces pequeñas.
  capas.push(`<rect y="${BASE - 4}" width="${W}" height="${H - BASE + 4}" fill="#0A0B17"/>`);
  capas.push(L.fila({ desde: -20, hasta: W, pie: BASE + 70, alto: [14, 60], color: '#0B0C18', prob: 0.16, centro: 0.3, anchos: [24, 90], hueco: 2 }));
  L.soltarVentanas();
  L.contaminacion();

  // ── La autovía con las estelas ───────────────────────────────────────────
  // Un viaducto que cruza delante, en curva suave. Las estelas son el paso de
  // los coches con exposición larga: rojas las que se alejan, blancas y
  // doradas las que vienen.
  const curva = (y0, y1, dy) => `M-60 ${y0} C${W * 0.3} ${y0 + dy} ${W * 0.62} ${y1 - dy * 0.6} ${W + 60} ${y1}`;
  defs.push(`
  <linearGradient id="calzada" x1="0" y1="1130" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#11132A"/><stop offset=".35" stop-color="#0A0B18"/><stop offset="1" stop-color="#040509"/>
  </linearGradient>`);
  const PRETIL = [1170, 1120, 36];
  capas.push(`<path d="${curva(...PRETIL)} L${W + 60} ${H + 10} L-60 ${H + 10} Z" fill="url(#calzada)"/>`);
  const farolas = [];
  for (let i = 0; i < 18; i++) {
    const t = (i + 0.5) / 18;
    const x = -60 + (W + 120) * t;
    const y = PRETIL[0] + (PRETIL[1] - PRETIL[0]) * t + Math.sin(t * Math.PI) * 14 - 2;
    farolas.push(`<ellipse cx="${r1(x)}" cy="${r1(y + 30)}" rx="60" ry="9" fill="#FFB860" opacity=".12" filter="url(#brillo)"/>
    <path d="M${r1(x)} ${r1(y)} V${r1(y - 64)} q0 -6 8 -6" fill="none" stroke="#2B2C46" stroke-width="2.2"/>
    <circle cx="${r1(x + 9)}" cy="${r1(y - 69)}" r="18" fill="#FFC56E" opacity=".38" filter="url(#brillo)"/>
    <circle cx="${r1(x + 9)}" cy="${r1(y - 69)}" r="3" fill="#FFE6B0"/>`);
  }
  capas.push(`<g>${farolas.join('')}</g>`);
  capas.push(`<path d="${curva(...PRETIL)}" fill="none" stroke="#454767" stroke-width="3"/>`);
  capas.push(`<path d="${curva(PRETIL[0] + 6, PRETIL[1] + 6, PRETIL[2])}" fill="none" stroke="#1C1E34" stroke-width="5"/>`);
  const estelas = [];
  function estela(y0, y1, dy, color, ancho, o) {
    const d = curva(y0, y1, dy);
    const a = Math.round(entre(420, 1300)), b = Math.round(entre(30, 160));
    const desfase = Math.round(entre(0, 1600));
    estelas.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(ancho * 5)}" stroke-opacity="${op(o * 0.3)}" stroke-linecap="round"
      stroke-dasharray="${a} ${b}" stroke-dashoffset="${desfase}" filter="url(#brilloAncho)"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(ancho)}" stroke-opacity="${op(o)}" stroke-linecap="round"
      stroke-dasharray="${a} ${b}" stroke-dashoffset="${desfase}"/>`);
  }
  [[1196, 1143, 38], [1210, 1156, 40], [1224, 1169, 42]].forEach(([a, b, c]) => {
    for (let k = 0; k < 3; k++) estela(a + entre(-2.5, 2.5), b + entre(-2.5, 2.5), c, ['#FF2E3A', '#FF5A48', '#FF7A3D'][k], entre(1.8, 3), entre(0.6, 0.95));
  });
  capas.push(`<path d="${curva(1242, 1186, 43)}" fill="none" stroke="#D8C08A" stroke-opacity=".3" stroke-width="2" stroke-dasharray="34 38"/>`);
  [[1260, 1203, 45], [1277, 1219, 47], [1294, 1236, 49]].forEach(([a, b, c]) => {
    for (let k = 0; k < 3; k++) estela(a + entre(-2.5, 2.5), b + entre(-2.5, 2.5), c, ['#FFF6E2', '#FFE6B0', '#FFD27A'][k], entre(2.2, 3.4), entre(0.55, 0.95));
  });
  capas.push(`<g>${estelas.join('')}</g>`);
  capas.push(`<path d="${curva(1322, 1262, 50)}" fill="none" stroke="#3A3C5C" stroke-width="2.5"/>`);
  capas.push(`<path d="${curva(1330, 1270, 50)} L${W + 60} ${H + 10} L-60 ${H + 10} Z" fill="#05060B"/>`);

  // ── Los pinos de las esquinas: enmarcan, como en la sierra ───────────────
  function pino(x, base, alto) {
    const ancho = alto * 0.34;
    let d = `M${x - 4} ${base} V${base - alto * 0.12} H${x + 4} V${base} Z`;
    const pisos = 8;
    for (let i = 0; i < pisos; i++) {
      const t = i / pisos;
      const y = base - alto * 0.1 - t * alto * 0.86;
      const a = ancho * (1 - t * 0.82) * entre(0.85, 1.12);
      const caida = entre(4, 12);
      d += ` M${r1(x - a)} ${r1(y + caida)} Q${r1(x - a * 0.4)} ${r1(y - alto * 0.04)} ${r1(x)} ${r1(y - alto * 0.2)} Q${r1(x + a * 0.4)} ${r1(y - alto * 0.04)} ${r1(x + a)} ${r1(y + caida)} Z`;
    }
    return `<path d="${d}" fill="#03040A"/>`;
  }
  const pinos = [];
  [[40, 470], [150, 620], [265, 420], [-40, 360], [350, 300]].forEach(([x, a]) => pinos.push(pino(x, H + 12, a)));
  [[W - 60, 520], [W - 190, 400], [W + 20, 380], [W - 290, 280]].forEach(([x, a]) => pinos.push(pino(x, H + 12, a)));
  capas.push(`<g>${pinos.join('')}</g>`);

  L.vinetaYGrano();
  return L.svg();
};
