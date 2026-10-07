// ============================================================
// EL FONDO DEL ACCESO DE BARCELONA — Barcelona al anochecer, desde el mar
// ============================================================
// El mismo atardecer que Madrid (comun.js), con lo suyo: la sierra de
// Collserola con la Torre de Collserola y el Tibidabo, un skyline plano —el
// Eixample— del que salen la Sagrada Família y la Torre Glòries en el centro y
// las dos torres gemelas del puerto a un lado; delante, el paseo marítimo y el
// mar con los reflejos de la ciudad, y palmeras en las esquinas.

const { lienzo } = require('./comun');

module.exports = function barcelona() {
  const L = lienzo({ semilla: 20261008, HORIZONTE: 930, BASE: 1010, SOL_X: 2560 * 0.22 });
  const { W, H, BASE, azar, entre, r1, op, defs, capas } = L;
  const MAR = 1090;             // donde empieza el agua

  L.cielo();
  L.estrellas();
  L.nubes(
    [[0.14, 770, 640, 18], [0.32, 815, 480, 13], [0.04, 850, 340, 10], [0.46, 750, 420, 11], [0.24, 700, 360, 9], [0.58, 820, 380, 9]],
    [[0.7, 400, 720, 16], [0.86, 540, 540, 12], [0.5, 350, 560, 10]]);
  // Collserola: lomas más suaves que Guadarrama.
  const { cerca } = L.sierra(
    [[0, 870], [W * 0.1, 830], [W * 0.2, 790], [W * 0.3, 810], [W * 0.45, 855], [W * 0.62, 870], [W * 0.82, 885], [W, 895]],
    [[0, 920], [W * 0.12, 880], [W * 0.21, 850], [W * 0.31, 868], [W * 0.44, 905], [W * 0.66, 915], [W * 0.85, 930], [W, 925]]);

  // ── La Torre de Collserola y el Tibidabo, en la loma ─────────────────────
  {
    const x = W * 0.305, pie = L.alturaEn(cerca, x) + 4, alto = 250;
    const plataforma = pie - alto * 0.62;
    capas.push(`<g fill="#2E2342" stroke="#2E2342">
      <path d="M${x - 5} ${pie} L${x - 2.5} ${pie - alto} H${x + 2.5} L${x + 5} ${pie} Z" stroke="none"/>
      <line x1="${x}" y1="${pie - alto}" x2="${x}" y2="${pie - alto - 70}" stroke-width="1.6"/>
      <path d="M${x - 26} ${plataforma} h52 l-6 30 h-40 Z" stroke="none"/>
      <path d="M${x - 30} ${plataforma - 5} h60 v5 h-60 Z" stroke="none"/>
      <line x1="${x - 26}" y1="${plataforma + 4}" x2="${x - 70}" y2="${pie + 2}" stroke-width=".8" stroke-opacity=".5"/>
      <line x1="${x + 26}" y1="${plataforma + 4}" x2="${x + 70}" y2="${pie + 2}" stroke-width=".8" stroke-opacity=".5"/>
    </g>`);
    capas.push(L.baliza(x, pie - alto - 72));
    for (let k = 0; k < 5; k++) capas.push(`<rect x="${r1(x - 22 + k * 9)}" y="${r1(plataforma + 12)}" width="5" height="2.4" fill="#FFD58A" opacity=".7"/>`);
  }
  {
    // El templo del Tibidabo, iluminado, con su figura en lo alto.
    const x = W * 0.205, pie = L.alturaEn(cerca, x) + 2;
    capas.push(`<circle cx="${r1(x)}" cy="${r1(pie - 40)}" r="70" fill="#FFC27A" opacity=".22" filter="url(#brillo)"/>
    <path d="M${x - 30} ${pie} V${pie - 26} H${x - 14} V${pie - 44} H${x - 6} V${pie - 70} H${x + 6} V${pie - 44} H${x + 14} V${pie - 26} H${x + 30} V${pie} Z" fill="#E9B98A" opacity=".85"/>
    <path d="M${x - 2} ${pie - 70} V${pie - 84} H${x - 6} V${pie - 88} H${x - 1.5} V${pie - 94} H${x + 1.5} V${pie - 88} H${x + 6} V${pie - 84} H${x + 2} V${pie - 70} Z" fill="#F6D7A8"/>`);
  }
  L.bruma();

  L.defsCiudad();
  capas.push(L.fila({ desde: -20, hasta: W, pie: BASE, alto: [30, 110], color: 'url(#edificioAtras)', prob: 0, centro: 0.7, anchos: [26, 80], hueco: 4, centroX: W * 0.48 }));

  // ── Las dos torres gemelas del puerto (Hotel Arts y Torre Mapfre) ─────────
  defs.push(`
  <linearGradient id="cristalBcn" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#D99272"/>
    <stop offset=".14" stop-color="#8E5868"/>
    <stop offset=".5" stop-color="#2A2B52"/>
    <stop offset="1" stop-color="#141935"/>
  </linearGradient>
  <pattern id="celosia" width="24" height="24" patternUnits="userSpaceOnUse">
    <path d="M0 0L24 24M24 0L0 24M0 12H24" stroke="#F2E6DA" stroke-opacity=".32" stroke-width="1.1"/>
  </pattern>
  <pattern id="plantasBcn" width="10" height="12" patternUnits="userSpaceOnUse">
    <path d="M0 11.5H10" stroke="#B9C4F0" stroke-opacity=".1" stroke-width="1"/>
    <path d="M9.5 0V12" stroke="#B9C4F0" stroke-opacity=".06" stroke-width="1"/>
  </pattern>`);
  const hitos = [];
  const balizas = [];
  function plantasEncendidas(x, arriba, ancho, pie, prob) {
    for (let y = arriba + 30; y < pie - 24; y += 12) {
      if (azar() < prob) {
        const w = entre(8, ancho * 0.55);
        hitos.push(`<rect x="${r1(x + entre(4, ancho - w - 4))}" y="${r1(y)}" width="${r1(w)}" height="3.2" fill="#FFD58A" opacity="${op(entre(0.3, 0.75))}"/>`);
      }
    }
  }
  [[W * 0.318, 'arts'], [W * 0.318 + 84, 'mapfre']].forEach(([x, cual]) => {
    const w = 58, top = BASE - 440;
    const d = `M${x} ${BASE} V${top} H${x + w} V${BASE} Z`;
    hitos.push(`<path d="${d}" fill="url(#cristalBcn)"/><path d="${d}" fill="url(#plantasBcn)"/>`);
    // El Hotel Arts lleva la estructura de acero por fuera: la celosía blanca.
    if (cual === 'arts') hitos.push(`<path d="${d}" fill="url(#celosia)"/>`);
    plantasEncendidas(x, top, w, BASE, 0.16);
    balizas.push(L.baliza(x + w / 2, top - 8));
  });

  // ── La Sagrada Família: piedra iluminada en el centro ─────────────────────
  defs.push(`
  <linearGradient id="piedra" x1="0" y1="${BASE - 600}" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#F6CF98"/>
    <stop offset=".45" stop-color="#D79A6C"/>
    <stop offset="1" stop-color="#6F4652"/>
  </linearGradient>`);
  const SF = W * 0.452;         // el centro de la basílica
  const agujas = [];
  // Una aguja de Gaudí: un huso que se estrecha y acaba en un remate redondo.
  function aguja(cx, alto, ancho, remate = 'bola') {
    const top = BASE - alto, rb = ancho * 0.36;
    let d = `M${r1(cx - ancho / 2)} ${BASE} L${r1(cx - ancho * 0.36)} ${r1(top + alto * 0.28)} Q${r1(cx - ancho * 0.18)} ${r1(top + 8)} ${r1(cx)} ${r1(top)}`
      + ` Q${r1(cx + ancho * 0.18)} ${r1(top + 8)} ${r1(cx + ancho * 0.36)} ${r1(top + alto * 0.28)} L${r1(cx + ancho / 2)} ${BASE} Z`;
    agujas.push(`<path d="${d}" fill="url(#piedra)"/>`);
    // Los huecos en espiral de las torres: rayitas oscuras.
    for (let y = top + alto * 0.3; y < BASE - 40; y += 16) {
      agujas.push(`<rect x="${r1(cx - ancho * 0.18)}" y="${r1(y)}" width="${r1(ancho * 0.36)}" height="2.2" fill="#5A3442" opacity=".55"/>`);
    }
    if (remate === 'bola') {
      agujas.push(`<circle cx="${r1(cx)}" cy="${r1(top - rb * 0.6)}" r="${r1(rb)}" fill="#F8DDB0"/>`);
    } else if (remate === 'cruz') {
      // La torre de Jesucristo: la cruz de cuatro brazos, encendida.
      agujas.push(`<circle cx="${r1(cx)}" cy="${r1(top - 22)}" r="26" fill="#FFF3D6" opacity=".55" filter="url(#brillo)"/>
        <path d="M${cx - 3} ${top - 2} V${top - 40} H${cx + 3} V${top - 2} Z M${cx - 16} ${top - 25} H${cx + 16} V${top - 19} H${cx - 16} Z" fill="#FFF6E2"/>`);
    } else if (remate === 'estrella') {
      // La torre de la Virgen: la estrella.
      agujas.push(`<circle cx="${r1(cx)}" cy="${r1(top - 16)}" r="18" fill="#FFF3D6" opacity=".5" filter="url(#brillo)"/>
        <path d="M${cx} ${top - 30} L${cx + 4} ${top - 20} L${cx + 13} ${top - 16} L${cx + 4} ${top - 12} L${cx} ${top - 2} L${cx - 4} ${top - 12} L${cx - 13} ${top - 16} L${cx - 4} ${top - 20} Z" fill="#FFF6E2"/>`);
    }
  }
  // La nave: la masa baja de la que salen las torres.
  agujas.push(`<path d="M${SF - 150} ${BASE} V${BASE - 200} L${SF - 110} ${BASE - 250} H${SF + 110} L${SF + 150} ${BASE - 200} V${BASE} Z" fill="url(#piedra)" opacity=".92"/>`);
  // La fachada del Nacimiento (izquierda) y la de la Pasión (derecha): cuatro agujas cada una.
  [[-138, 360], [-112, 410], [-86, 410], [-60, 360]].forEach(([dx, h]) => aguja(SF + dx, h, 22));
  [[60, 350], [86, 400], [112, 400], [138, 350]].forEach(([dx, h]) => aguja(SF + dx, h, 22));
  // Las torres centrales: los evangelistas, la de la Virgen y la de Jesucristo, la más alta.
  aguja(SF - 34, 500, 34);
  aguja(SF + 34, 500, 34);
  aguja(SF - 64, 470, 30, 'estrella');
  aguja(SF, 590, 44, 'cruz');
  hitos.push(...agujas);

  // ── La Torre Glòries: la bala con su piel de luces ────────────────────────
  defs.push(`
  <linearGradient id="glories" x1="0" y1="${BASE - 480}" x2="0" y2="${BASE}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#5C7BFF"/>
    <stop offset=".45" stop-color="#7A4FD0"/>
    <stop offset=".8" stop-color="#C8508F"/>
    <stop offset="1" stop-color="#E77A5F"/>
  </linearGradient>
  <pattern id="puntos" width="7" height="7" patternUnits="userSpaceOnUse">
    <circle cx="3.5" cy="3.5" r="1.3" fill="#FFFFFF" fill-opacity=".4"/>
  </pattern>`);
  {
    const x = W * 0.565, w = 84, alto = 470, top = BASE - alto;
    const d = `M${x} ${BASE} V${top + 140} C${x} ${top + 40} ${x + w * 0.2} ${top} ${x + w / 2} ${top} C${x + w * 0.8} ${top} ${x + w} ${top + 40} ${x + w} ${top + 140} V${BASE} Z`;
    hitos.push(`<path d="${d}" fill="url(#glories)" opacity=".2" filter="url(#brilloAncho)" transform="translate(0 0)"/>
      <path d="${d}" fill="url(#glories)" opacity=".88"/><path d="${d}" fill="url(#puntos)"/>`);
  }
  capas.push(`<g>${hitos.join('')}</g>`);

  // El Eixample: bajo y parejo, del que solo salen los edificios conocidos.
  capas.push(L.fila({ desde: -30, hasta: W, pie: BASE, alto: [26, 120], color: 'url(#edificio)', prob: 0.11, centro: 0.5, anchos: [30, 90], hueco: 2, centroX: W * 0.45 }));
  L.soltarAntenas();
  L.soltarVentanas();
  capas.push(`<g>${balizas.join('')}</g>`);

  // La primera línea de mar: edificios bajos y el paseo con sus farolas.
  capas.push(`<rect y="${BASE - 4}" width="${W}" height="${MAR - BASE + 8}" fill="#0A0B17"/>`);
  capas.push(L.fila({ desde: -20, hasta: W, pie: MAR - 22, alto: [10, 46], color: '#0B0C18', prob: 0.18, centro: 0.3, anchos: [30, 100], hueco: 2 }));
  L.soltarVentanas();
  L.contaminacion();

  // ── El mar ───────────────────────────────────────────────────────────────
  defs.push(`
  <linearGradient id="mar" x1="0" y1="${MAR}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#3B2B4D"/>
    <stop offset=".25" stop-color="#171A35"/>
    <stop offset="1" stop-color="#04050B"/>
  </linearGradient>`);
  capas.push(`<rect y="${MAR}" width="${W}" height="${H - MAR}" fill="url(#mar)"/>`);
  // El reflejo del cielo encendido, a la izquierda (debajo del sol).
  capas.push(`<ellipse cx="${r1(L.SOL_X)}" cy="${MAR + 30}" rx="${W * 0.32}" ry="60" fill="#E8875E" opacity=".22" filter="url(#difuso)"/>`);
  // El paseo: la línea del muelle y las farolas.
  const farolas = [];
  const reflejos = [];
  // Un reflejo: rayas horizontales que se abren y se apagan hacia abajo.
  function reflejo(x, color, fuerza, largo = 18) {
    for (let k = 0; k < largo; k++) {
      const y = MAR + 10 + k * 11 + entre(-2, 2);
      const ancho = entre(10, 34) * (1 + k * 0.08) * fuerza;
      const o = (1 - k / largo) * entre(0.25, 0.7) * fuerza;
      if (o < 0.04) continue;
      reflejos.push(`<rect x="${r1(x - ancho / 2 + entre(-6, 6))}" y="${r1(y)}" width="${r1(ancho)}" height="2" fill="${color}" opacity="${op(Math.min(0.85, o))}"/>`);
    }
  }
  for (let i = 0; i < 22; i++) {
    const x = (i + 0.5) * (W / 22);
    farolas.push(`<line x1="${r1(x)}" y1="${MAR - 4}" x2="${r1(x)}" y2="${MAR - 52}" stroke="#2B2C46" stroke-width="2"/>
      <circle cx="${r1(x)}" cy="${MAR - 54}" r="15" fill="#FFC56E" opacity=".38" filter="url(#brillo)"/>
      <circle cx="${r1(x)}" cy="${MAR - 54}" r="2.6" fill="#FFE6B0"/>`);
    reflejo(x, '#FFC97A', 0.7, 14);
  }
  // Los reflejos de los edificios conocidos.
  reflejo(SF, '#F2B57E', 1.3, 22);
  reflejo(W * 0.565 + 42, '#8C78FF', 1.1, 20);
  reflejo(W * 0.318 + 29, '#FFD58A', 0.8, 16);
  reflejo(W * 0.318 + 113, '#FFD58A', 0.8, 16);
  capas.push(`<path d="M0 ${MAR} H${W}" stroke="#454767" stroke-width="3"/>`);
  capas.push(`<g>${farolas.join('')}</g>`);
  capas.push(`<g>${reflejos.join('')}</g>`);
  // Las olas: rayas largas y tenues.
  const olas = [];
  for (let k = 0; k < 40; k++) {
    const y = MAR + 20 + Math.pow(azar(), 0.8) * (H - MAR - 20);
    const x = entre(-100, W);
    olas.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(entre(120, 520))}" height="1.4" fill="#9AA6D6" opacity="${op(entre(0.05, 0.16))}"/>`);
  }
  capas.push(`<g>${olas.join('')}</g>`);

  // ── Las palmeras de las esquinas ─────────────────────────────────────────
  function palmera(x, pie, alto, inclina) {
    const tx = x + inclina, ty = pie - alto;
    // El tronco: grueso abajo, fino arriba, con la curva de la inclinación.
    let d = `M${r1(x - 15)} ${pie} Q${r1(x + inclina * 0.25 - 10)} ${r1(pie - alto * 0.5)} ${r1(tx - 6)} ${r1(ty + 4)} L${r1(tx + 6)} ${r1(ty + 4)} Q${r1(x + inclina * 0.25 + 10)} ${r1(pie - alto * 0.5)} ${r1(x + 15)} ${pie} Z`;
    // Las hojas: once palmas en abanico que se arquean y caen por su peso.
    const largo = alto * 0.44;
    [-176, -158, -140, -120, -100, -80, -60, -40, -20, -4, 12].forEach(g => {
      const a = (g + entre(-5, 5)) * Math.PI / 180;
      const lf = largo * entre(0.82, 1.08);
      const caida = lf * (0.3 + 0.35 * Math.abs(Math.cos(a)));
      const ex = tx + Math.cos(a) * lf, ey = ty + Math.sin(a) * lf * 0.7 + caida;
      const cx = tx + Math.cos(a) * lf * 0.55, cy = ty + Math.sin(a) * lf * 0.55 - lf * 0.18;
      const grosor = lf * 0.11;
      d += ` M${r1(tx)} ${r1(ty)} Q${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)} Q${r1(cx)} ${r1(cy + grosor)} ${r1(tx)} ${r1(ty + 9)} Z`;
    });
    // El penacho del centro, donde nacen las hojas.
    d += ` M${r1(tx)} ${r1(ty - 10)} m-12 0 a12 9 0 1 0 24 0 a12 9 0 1 0 -24 0 Z`;
    return `<path d="${d}" fill="#03040A"/>`;
  }
  const palmeras = [];
  [[90, 560, 40], [230, 430, -30], [-10, 380, 60]].forEach(([x, a, i]) => palmeras.push(palmera(x, H + 12, a, i)));
  [[W - 110, 520, -50], [W - 250, 400, 30]].forEach(([x, a, i]) => palmeras.push(palmera(x, H + 12, a, i)));
  capas.push(`<g>${palmeras.join('')}</g>`);

  L.vinetaYGrano();
  return L.svg();
};
