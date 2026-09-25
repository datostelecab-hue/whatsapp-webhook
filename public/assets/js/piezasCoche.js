// ============================================================
// PIEZAS DEL COCHE — el dibujo para marcar el estado de cada pieza
// ============================================================
// Para el taller (Camilo, 25/09/2026): en la ficha del vehículo, un coche visto
// desde arriba donde se pincha una pieza —una rueda, un retrovisor, el
// limpiaparabrisas…— y se dice cómo está:
//
//   Buen estado                verde suave (lo que está todo al principio)
//   Mal estado · Arreglar      rojo
//   Mal estado · Cambio        rojo que parpadea
//
// con una observación en los dos malos. Dos dibujos: el EXTERIOR (carrocería,
// cristales, luces, espejos, ruedas…) y el INTERIOR CON LA MECÁNICA (asientos,
// volante, salpicadero, motor, batería, frenos…).
//
// POR QUÉ 2D Y NO 3D. No hay un modelo 3D de verdad de los coches de la flota,
// y uno hecho con cajas parecería un juguete; y en 3D pinchar un retrovisor o
// una escobilla desde el móvil es una pelea. Un dibujo vectorial visto desde
// arriba se ve nítido a cualquier tamaño, cabe entero en pantalla y cada pieza
// es fácil de acertar.
//
// Uso (dentro de un bloque de la ficha del Listado):
//   { titulo: 'Estado de las piezas', pinta: (d, hueco, lista) =>
//       PiezasCoche.montar(hueco, { vehiculoId: d.id, puedeEditar, lista }) }
//
// Los datos: GET /vehiculos/api/ficha/:id/piezas y POST /vehiculos/api/piezas/:id.

(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fechaHora = iso => {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // ── Las formas ─────────────────────────────────────────────────────────────
  // viewBox 0 0 400 820, el coche mirando hacia arriba (el frontal arriba). Las
  // piezas de la derecha son las de la izquierda en espejo.
  const P = d => `<path d="${d}"/>`;
  const R = (x, y, w, h, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r || 0}"/>`;
  const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  // Un trazo lleva debajo otro invisible y gordo: una escobilla de 4 px no se
  // acierta con el dedo.
  const L = (x1, y1, x2, y2) => `<line class="pc-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const Z = (x, y0, y1) => {           // un muelle, de y0 a y1
    let d = `M${x},${y0}`;
    for (let y = y0, i = 0; y < y1; y += 8, i++) d += ` L${x + (i % 2 ? -10 : 10)},${y + 4}`;
    return `<path class="pc-hit" d="${d}"/><path d="${d}"/>`;
  };
  const ESPEJO = s => `<g transform="translate(400,0) scale(-1,1)">${s}</g>`;

  // La silueta de fondo, para las dos vistas.
  const SILUETA = 'M122,40 Q200,32 278,40 Q326,48 330,92 L332,240 Q336,262 332,300 L330,704 Q328,768 280,778 Q200,788 120,778 Q72,768 70,704 L68,300 Q64,262 68,240 L70,92 Q74,48 122,40 Z';

  const aleta = 'M74,104 L94,104 Q90,176 96,248 L72,248 Q70,176 74,104 Z';
  const puertaDel = 'M72,252 L97,252 L97,430 L70,430 Q68,340 72,252 Z';
  const puertaTra = 'M70,434 L97,434 L97,598 L72,598 Q68,516 70,434 Z';
  const aletaTra = 'M72,602 L97,602 L98,696 L76,696 Q70,650 72,602 Z';
  const ventDel = 'M100,256 L116,334 L116,430 L100,430 Z';
  const ventTra = 'M100,434 L116,434 L116,536 L100,596 Z';
  const faro = 'M100,106 L150,106 L146,124 Q120,129 101,122 Z';
  const piloto = 'M101,678 L148,682 L150,697 L101,697 Z';
  const retrovisor = 'M73,262 Q50,256 44,270 Q44,288 73,286 Z';

  // [código, tipo, forma]. El orden es el de pintado: lo de encima, después.
  const EXTERIOR = [
    ['paragolpes_del', 'panel', P('M122,44 Q200,36 278,44 Q318,50 324,86 L324,100 L76,100 L76,86 Q82,50 122,44 Z')],
    ['capo', 'panel', P('M98,104 L302,104 Q306,176 300,246 Q200,236 100,246 Q94,176 98,104 Z')],
    ['aleta_del_izq', 'panel', P(aleta)], ['aleta_del_der', 'panel', ESPEJO(P(aleta))],
    ['puerta_del_izq', 'panel', P(puertaDel)], ['puerta_del_der', 'panel', ESPEJO(P(puertaDel))],
    ['puerta_tra_izq', 'panel', P(puertaTra)], ['puerta_tra_der', 'panel', ESPEJO(P(puertaTra))],
    ['aleta_tra_izq', 'panel', P(aletaTra)], ['aleta_tra_der', 'panel', ESPEJO(P(aletaTra))],
    ['techo', 'panel', P('M118,334 Q200,327 282,334 L282,536 Q200,543 118,536 Z')],
    ['maletero', 'panel', P('M100,604 Q200,614 300,604 L300,696 L100,696 Z')],
    ['paragolpes_tra', 'panel', P('M76,700 L324,700 L324,716 Q320,762 278,772 Q200,780 122,772 Q80,762 76,716 Z')],
    ['parabrisas', 'cristal', P('M100,250 Q200,240 300,250 L284,330 Q200,322 116,330 Z')],
    ['luna_trasera', 'cristal', P('M116,540 Q200,547 284,540 L298,600 Q200,610 102,600 Z')],
    ['vent_del_izq', 'cristal', P(ventDel)], ['vent_del_der', 'cristal', ESPEJO(P(ventDel))],
    ['vent_tra_izq', 'cristal', P(ventTra)], ['vent_tra_der', 'cristal', ESPEJO(P(ventTra))],
    ['faro_izq', 'luz', P(faro)], ['faro_der', 'luz', ESPEJO(P(faro))],
    ['antiniebla_izq', 'luz', C(104, 82, 7)], ['antiniebla_der', 'luz', C(296, 82, 7)],
    ['piloto_izq', 'luz', P(piloto)], ['piloto_der', 'luz', ESPEJO(P(piloto))],
    ['matricula_del', 'pequena', R(168, 58, 64, 16, 3)],
    ['matricula_tra', 'pequena', R(168, 744, 64, 16, 3)],
    ['escape', 'pequena', R(110, 771, 24, 10, 4)],
    ['tapa_deposito', 'pequena', R(84, 640, 12, 16, 3)],
    ['antena', 'pequena', P('M194,512 Q200,494 206,512 L206,530 L194,530 Z')],
    ['limpia_del', 'trazo', L(128, 322, 196, 302) + L(208, 322, 276, 302)],
    ['limpia_tra', 'trazo', L(206, 596, 250, 578)],
    ['retrovisor_izq', 'panel', P(retrovisor)], ['retrovisor_der', 'panel', ESPEJO(P(retrovisor))],
    ['rueda_del_izq', 'rueda', R(52, 146, 32, 86, 11)], ['rueda_del_der', 'rueda', R(316, 146, 32, 86, 11)],
    ['rueda_tra_izq', 'rueda', R(52, 612, 32, 86, 11)], ['rueda_tra_der', 'rueda', R(316, 612, 32, 86, 11)],
  ];

  const asiento = R(118, 336, 62, 68, 14) + R(121, 408, 56, 30, 10) + R(134, 441, 30, 11, 5);
  const INTERIOR = [
    ['suelo_maletero', 'panel', R(106, 604, 188, 92, 12)],
    ['rueda_repuesto', 'rueda', C(200, 650, 30)],
    ['radiador', 'mecanica', R(130, 106, 140, 14, 4)],
    ['bateria', 'mecanica', R(102, 128, 30, 40, 5)],
    ['motor', 'mecanica', R(140, 132, 120, 88, 12)],
    ['liquidos', 'mecanica', R(270, 130, 26, 46, 7)],
    ['frenos_del', 'mecanica', C(68, 189, 15) + C(332, 189, 15)],
    ['frenos_tra', 'mecanica', C(68, 655, 15) + C(332, 655, 15)],
    ['suspension_del', 'trazo', Z(96, 160, 216) + ESPEJO(Z(96, 160, 216))],
    ['suspension_tra', 'trazo', Z(96, 626, 682) + ESPEJO(Z(96, 626, 682))],
    ['salpicadero', 'panel', P('M104,250 Q200,240 296,250 L294,284 Q200,276 106,284 Z')],
    ['retrovisor_int', 'pequena', R(184, 232, 32, 9, 4)],
    ['climatizacion', 'pequena', R(118, 258, 24, 10, 3) + R(258, 258, 24, 10, 3)],
    ['multimedia', 'pequena', R(180, 254, 40, 24, 4)],
    ['alfombrillas', 'panel', R(116, 290, 62, 40, 8) + R(222, 290, 62, 40, 8)],
    ['consola', 'panel', R(188, 290, 24, 140, 9)],
    ['volante', 'trazo', `<circle class="pc-hit" cx="150" cy="300" r="22"/><circle cx="150" cy="300" r="22"/>` + L(128, 300, 172, 300)],
    ['asiento_cond', 'asiento', asiento], ['asiento_copi', 'asiento', ESPEJO(asiento)],
    ['asientos_tra', 'asiento', R(112, 478, 176, 58, 16) + R(114, 540, 172, 26, 11)],
    ['cinturones', 'trazo', L(126, 340, 172, 432) + L(274, 340, 228, 432) + L(124, 482, 166, 560) + L(276, 482, 234, 560)],
  ];

  // Lo que se ve pero no se pincha: las líneas que hacen que parezca un coche.
  const ADORNO_EXT = `
    <path class="pc-linea" d="M200,108 L200,236"/>
    <path class="pc-linea" d="M150,112 Q148,180 152,238 M250,112 Q252,180 248,238"/>
    <path class="pc-linea" d="M130,610 L270,610"/>`;
  const ADORNO_INT = `
    ${R(52, 146, 32, 86, 11).replace('<rect', '<rect class="pc-sombra-rueda"')}
    ${R(316, 146, 32, 86, 11).replace('<rect', '<rect class="pc-sombra-rueda"')}
    ${R(52, 612, 32, 86, 11).replace('<rect', '<rect class="pc-sombra-rueda"')}
    ${R(316, 612, 32, 86, 11).replace('<rect', '<rect class="pc-sombra-rueda"')}
    <path class="pc-linea" d="M100,248 Q200,238 300,248 M100,600 Q200,610 300,600"/>`;

  // ── Los estilos, una sola vez por página ──────────────────────────────────
  function estilos() {
    if (document.getElementById('pc-estilos')) return;
    const st = document.createElement('style');
    st.id = 'pc-estilos';
    st.textContent = `
      .pc-svg { width: 100%; height: auto; max-height: 74vh; display: block; margin: 0 auto; }
      .pc-fondo { fill: rgb(var(--tc-card2)); stroke: rgb(var(--tc-border)); stroke-width: 2; }
      .pc-linea { fill: none; stroke: rgb(var(--tc-border)); stroke-width: 1.2; pointer-events: none; }
      .pc-sombra-rueda { fill: rgb(var(--tc-text) / .08); stroke: rgb(var(--tc-border)); stroke-dasharray: 3 3; pointer-events: none; }
      .pc-rotulo { fill: rgb(var(--tc-muted)); font: 600 11px 'Plus Jakarta Sans', system-ui, sans-serif; letter-spacing: .14em; text-anchor: middle; pointer-events: none; }
      .pc-pieza { cursor: pointer; outline: none; }
      .pc-pieza > *, .pc-pieza > g > * { transition: fill .18s ease, stroke .18s ease, filter .18s ease; }
      .pc-hit { fill: none !important; stroke: transparent !important; stroke-width: 16 !important; pointer-events: stroke; }

      /* BUEN ESTADO: verde suave. Las ruedas, oscuras como un neumático. */
      .pc-bien { fill: rgb(var(--tc-green) / .15); stroke: rgb(var(--tc-green) / .6); stroke-width: 1.4; }
      .pc-bien.pc-cristal { fill: rgb(var(--tc-green) / .07); }
      /* Un neumático es negro en cualquier tema: con el color del texto, en el
         tema oscuro las ruedas salían blancas. */
      .pc-bien.pc-rueda { fill: #23262b; stroke: rgb(var(--tc-green) / .85); stroke-width: 2; }
      .pc-bien.pc-trazo { fill: none; stroke: rgb(var(--tc-green) / .9); stroke-width: 4; stroke-linecap: round; }

      /* MAL ESTADO · ARREGLAR: rojo. */
      .pc-arreglar { fill: rgb(var(--tc-red) / .6); stroke: rgb(var(--tc-red)); stroke-width: 1.8; }
      .pc-arreglar.pc-trazo, .pc-cambio.pc-trazo { fill: none; stroke: rgb(var(--tc-red)); stroke-width: 5; stroke-linecap: round; }

      /* MAL ESTADO · CAMBIO: rojo que parpadea. */
      .pc-cambio { fill: rgb(var(--tc-red) / .75); stroke: rgb(var(--tc-red)); stroke-width: 2; }
      .pc-cambio > :not(.pc-hit), .pc-cambio > g > :not(.pc-hit), .pc-parpadea { animation: pc-parpadeo 1s ease-in-out infinite; }
      @keyframes pc-parpadeo { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }

      .pc-pieza:hover > :not(.pc-hit), .pc-pieza:hover > g > :not(.pc-hit),
      .pc-pieza:focus-visible > :not(.pc-hit) { filter: brightness(1.18) drop-shadow(0 0 3px rgb(var(--tc-gold) / .5)); }
      .pc-sel > :not(.pc-hit), .pc-sel > g > :not(.pc-hit) {
        stroke: rgb(var(--tc-gold)) !important; stroke-width: 3.5 !important;
        filter: drop-shadow(0 0 7px rgb(var(--tc-gold) / .75));
      }
      /* Menos movimiento: el cambio deja de parpadear y va a rayas. */
      @media (prefers-reduced-motion: reduce) {
        .pc-cambio > :not(.pc-hit), .pc-cambio > g > :not(.pc-hit), .pc-parpadea { animation: none; stroke-dasharray: 5 3; }
      }
      .pc-punto { width: 10px; height: 10px; border-radius: 999px; display: inline-block; flex-shrink: 0; }
      .pc-punto.bien { background: rgb(var(--tc-green) / .55); }
      .pc-punto.arreglar { background: rgb(var(--tc-red)); }
      .pc-punto.cambio { background: rgb(var(--tc-red)); animation: pc-parpadeo 1s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .pc-punto.cambio { animation: none; box-shadow: 0 0 0 2px rgb(var(--tc-red) / .35); } }
    `;
    document.head.appendChild(st);
  }

  // Lo que se recuerda de cada coche mientras la página está abierta: qué vista
  // y qué pieza. Si la ficha se repinta, se vuelve a donde se estaba.
  const memoria = new Map();

  function svgDe(vista, estadoDe, nombreDe, sel) {
    const lista = vista === 'interior' ? INTERIOR : EXTERIOR;
    const piezas = lista.map(([cod, tipo, forma]) => {
      const e = estadoDe(cod);
      return `<g class="pc-pieza pc-${tipo} pc-${e}${sel === cod ? ' pc-sel' : ''}" data-pieza="${cod}"
                 tabindex="0" role="button" aria-label="${esc(nombreDe(cod))}: ${esc(ETIQUETA[e])}">
                <title>${esc(nombreDe(cod))} · ${esc(ETIQUETA[e])}</title>${forma}</g>`;
    }).join('');
    return `<svg class="pc-svg" viewBox="0 0 400 820" xmlns="http://www.w3.org/2000/svg" role="group"
                 aria-label="${vista === 'interior' ? 'Interior y mecánica del coche' : 'Exterior del coche'}">
      <path class="pc-fondo" d="${SILUETA}"/>
      ${vista === 'interior' ? ADORNO_INT : ADORNO_EXT}
      ${piezas}
      <text class="pc-rotulo" x="200" y="22">DELANTE</text>
      <text class="pc-rotulo" x="200" y="808">DETRÁS</text>
    </svg>`;
  }

  const ETIQUETA = { bien: 'Buen estado', arreglar: 'Mal estado · Arreglar', cambio: 'Mal estado · Cambio' };

  /**
   * Monta el dibujo en `hueco`. `lista` es el Listado de la pantalla: al
   * guardar, se le actualiza la fila del coche (la columna «Piezas») sin
   * repintar la ficha entera.
   */
  async function montar(hueco, { vehiculoId, puedeEditar = false, lista = null } = {}) {
    estilos();
    const id = Number(vehiculoId);
    const mem = memoria.get(id) || { vista: 'exterior', sel: null };
    memoria.set(id, mem);
    hueco.innerHTML = '<p class="text-sm text-telecab-muted">Cargando el coche…</p>';

    let D = null;
    const traer = async () => {
      const r = await (await fetch(`/vehiculos/api/ficha/${id}/piezas`)).json();
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo cargar');
      D = r;
      D.porCodigo = new Map(D.piezas.map(p => [p.codigo, p]));
      D.ahora = new Map(D.actual.map(a => [a.pieza, a]));
    };
    const estadoDe = cod => (D.ahora.get(cod) || {}).estado || 'bien';
    const nombreDe = cod => (D.porCodigo.get(cod) || {}).nombre || cod;

    // Lo que se está editando (el estado elegido antes de guardar).
    let borrador = null;

    function pintar() {
      const mal = D.piezas.filter(p => estadoDe(p.codigo) !== 'bien');
      const nCambio = mal.filter(p => estadoDe(p.codigo) === 'cambio').length;
      const vistaPiezas = D.piezas.filter(p => p.vista === mem.vista);
      const grupos = [...new Set(vistaPiezas.map(p => p.grupo))];
      const malOtra = mal.filter(p => p.vista !== mem.vista).length;

      hueco.innerHTML = `
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <div class="inline-flex rounded-xl border border-telecab-border overflow-hidden text-sm" role="tablist">
            ${[['exterior', 'Exterior', 'fa-car-side'], ['interior', 'Interior y mecánica', 'fa-gears']].map(([v, t, i]) => `
              <button data-vista="${v}" role="tab" aria-selected="${mem.vista === v}"
                class="px-3 py-1.5 ${mem.vista === v ? 'bg-telecab-gold/20 text-telecab-gold font-semibold' : 'text-telecab-muted hover:text-telecab-text'}">
                <i class="fa-solid ${i} mr-1"></i>${t}${v !== mem.vista && malOtra ? ` <span class="ml-1 text-telecab-red font-semibold">· ${malOtra}</span>` : ''}</button>`).join('')}
          </div>
          <div class="flex-1"></div>
          <div class="flex flex-wrap items-center gap-3 text-xs text-telecab-muted">
            <span class="inline-flex items-center gap-1.5"><i class="pc-punto bien"></i>Buen estado</span>
            <span class="inline-flex items-center gap-1.5"><i class="pc-punto arreglar"></i>Arreglar</span>
            <span class="inline-flex items-center gap-1.5"><i class="pc-punto cambio"></i>Cambio</span>
          </div>
        </div>

        <div class="rounded-xl px-3 py-2 mb-4 text-sm ${mal.length ? 'bg-telecab-red/10 border border-telecab-red/30' : 'bg-telecab-green/10 border border-telecab-green/30'}">
          ${mal.length
            ? `<b class="text-telecab-red">${mal.length} pieza${mal.length === 1 ? '' : 's'} en mal estado</b>
               <span class="text-telecab-muted">· ${nCambio} para cambiar · ${mal.length - nCambio} para arreglar</span>
               <div class="flex flex-wrap gap-1.5 mt-2">${mal.map(p => `
                 <button data-ir="${p.codigo}" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs border border-telecab-red/40 text-telecab-text hover:border-telecab-red">
                   <i class="pc-punto ${estadoDe(p.codigo)}"></i>${esc(p.nombre)}</button>`).join('')}</div>`
            : '<i class="fa-solid fa-circle-check text-telecab-green mr-1"></i><b class="text-telecab-green">Todo en buen estado</b>'}
        </div>

        <div class="grid gap-5 lg:grid-cols-[minmax(240px,340px)_1fr] items-start">
          <div class="pc-lienzo rounded-2xl bg-telecab-dark/40 border border-telecab-border p-3">
            ${svgDe(mem.vista, estadoDe, nombreDe, mem.sel)}
          </div>
          <div class="space-y-4">
            <div data-editor class="rounded-2xl border border-telecab-border p-4"></div>
            <div class="rounded-2xl border border-telecab-border overflow-hidden">
              ${grupos.map(g => `
                <div class="px-4 py-2 text-[11px] uppercase tracking-wider text-telecab-muted bg-telecab-card2/60">${esc(g)}</div>
                ${vistaPiezas.filter(p => p.grupo === g).map(p => {
                  const e = estadoDe(p.codigo);
                  return `<button data-ir="${p.codigo}" class="w-full flex items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-telecab-card2 ${mem.sel === p.codigo ? 'bg-telecab-gold/10' : ''}">
                    <i class="pc-punto ${e}"></i><span class="flex-1">${esc(p.nombre)}</span>
                    ${e !== 'bien' ? `<span class="text-xs font-semibold text-telecab-red">${e === 'cambio' ? 'Cambio' : 'Arreglar'}</span>` : ''}</button>`;
                }).join('')}`).join('')}
            </div>
          </div>
        </div>`;

      pintarEditor();

      // Enganches.
      hueco.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
        mem.vista = b.dataset.vista; borrador = null; pintar();
      }));
      hueco.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => elegir(b.dataset.ir)));
      hueco.querySelectorAll('.pc-pieza').forEach(g => {
        g.addEventListener('click', () => elegir(g.dataset.pieza));
        g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(g.dataset.pieza); } });
      });
    }

    function elegir(cod) {
      const p = D.porCodigo.get(cod);
      if (!p) return;
      mem.sel = cod;
      if (p.vista !== mem.vista) mem.vista = p.vista;
      borrador = null;
      pintar();
      const g = hueco.querySelector(`.pc-pieza[data-pieza="${cod}"]`);
      if (g && g.focus) g.focus({ preventScroll: true });
    }

    function pintarEditor() {
      const caja = hueco.querySelector('[data-editor]');
      if (!mem.sel) {
        caja.innerHTML = `<p class="text-sm text-telecab-muted"><i class="fa-solid fa-hand-pointer mr-1.5"></i>
          Pincha una pieza del coche, o de la lista, para ver cómo está${puedeEditar ? ' y cambiar su estado' : ''}.</p>`;
        return;
      }
      const p = D.porCodigo.get(mem.sel);
      const a = D.ahora.get(mem.sel);
      const e = estadoDe(mem.sel);
      const elegido = borrador ? borrador.estado : e;
      const obs = borrador ? borrador.obs : ((a && a.observacion) || '');
      const hist = D.historial.filter(h => h.pieza === mem.sel).slice(0, 6);
      const boton = (cod, texto, clases) => `
        <button data-estado="${cod}" ${puedeEditar ? '' : 'disabled'}
          class="px-3 py-2 rounded-xl text-sm font-semibold border transition ${elegido === cod ? clases.on : clases.off} ${puedeEditar ? '' : 'opacity-60 cursor-not-allowed'}">
          ${texto}</button>`;
      caja.innerHTML = `
        <div class="flex items-start gap-3 mb-3">
          <div class="flex-1">
            <p class="text-[11px] uppercase tracking-wider text-telecab-muted">${esc(p.grupo)}</p>
            <h4 class="text-base font-bold text-telecab-text">${esc(p.nombre)}</h4>
          </div>
          <span class="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-lg ${e === 'bien' ? 'bg-telecab-green/15 text-telecab-green' : 'bg-telecab-red/15 text-telecab-red'}">
            <i class="pc-punto ${e}"></i>${esc(ETIQUETA[e])}</span>
        </div>
        ${a ? `<p class="text-xs text-telecab-muted mb-3">Desde el ${esc(fechaHora(a.creado_at))}${a.usuario ? ` · lo puso ${esc(a.usuario)}` : ''}</p>`
            : '<p class="text-xs text-telecab-muted mb-3">Nunca se ha tocado: está en buen estado desde el principio.</p>'}
        <div class="flex flex-wrap items-center gap-2">
          ${boton('bien', '<i class="fa-solid fa-check mr-1"></i>Buen estado',
            { on: 'bg-telecab-green/20 border-telecab-green text-telecab-green', off: 'border-telecab-border text-telecab-muted hover:border-telecab-green hover:text-telecab-green' })}
          <span class="text-xs text-telecab-muted ml-1">Mal estado:</span>
          ${boton('arreglar', '<i class="fa-solid fa-screwdriver-wrench mr-1"></i>Arreglar',
            { on: 'bg-telecab-red/20 border-telecab-red text-telecab-red', off: 'border-telecab-border text-telecab-muted hover:border-telecab-red hover:text-telecab-red' })}
          ${boton('cambio', '<i class="fa-solid fa-rotate mr-1 pc-parpadea"></i>Cambio',
            { on: 'bg-telecab-red/25 border-telecab-red text-telecab-red', off: 'border-telecab-border text-telecab-muted hover:border-telecab-red hover:text-telecab-red' })}
        </div>
        ${elegido !== 'bien' ? `
          <label class="block mt-3 text-xs text-telecab-muted">Observación
            <textarea data-obs rows="3" maxlength="1000" ${puedeEditar ? '' : 'readonly'}
              placeholder="${elegido === 'cambio' ? 'p. ej. neumático sin dibujo, pedido el recambio' : 'p. ej. raya en la puerta, arreglar en chapa'}"
              class="mt-1 w-full bg-telecab-dark border border-telecab-border rounded-xl px-3 py-2 text-sm text-telecab-text focus:outline-none focus:border-telecab-gold">${esc(obs)}</textarea>
          </label>` : ''}
        ${puedeEditar && borrador ? `
          <div class="flex items-center gap-2 mt-3">
            <button data-guardar class="px-4 py-2 rounded-xl bg-telecab-gold text-telecab-dark text-sm font-semibold"><i class="fa-solid fa-floppy-disk mr-1"></i>Guardar</button>
            <button data-cancelar class="px-3 py-2 rounded-xl text-sm text-telecab-muted hover:text-telecab-text">Cancelar</button>
          </div>` : ''}
        ${!puedeEditar ? '<p class="text-xs text-telecab-muted mt-3"><i class="fa-solid fa-lock mr-1"></i>Para cambiar el estado hace falta el permiso «Vehículos · marcar el estado de las piezas».</p>' : ''}
        <p data-msg class="text-xs mt-2 hidden"></p>
        ${hist.length ? `
          <div class="mt-4 pt-3 border-t border-telecab-border/60">
            <p class="text-[11px] uppercase tracking-wider text-telecab-muted mb-1.5">Historial de esta pieza</p>
            ${hist.map(h => `<div class="flex items-start gap-2 py-1 text-xs">
              <i class="pc-punto ${h.estado} mt-1"></i>
              <div class="flex-1"><b class="text-telecab-text">${esc(ETIQUETA[h.estado] || h.estado)}</b>
                <span class="text-telecab-muted">· ${esc(fechaHora(h.creado_at))}${h.usuario ? ' · ' + esc(h.usuario) : ''}</span>
                ${h.observacion ? `<div class="text-telecab-muted">«${esc(h.observacion)}»</div>` : ''}</div></div>`).join('')}
          </div>` : ''}`;

      if (!puedeEditar) return;
      caja.querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', () => {
        const ta = caja.querySelector('[data-obs]');
        borrador = { estado: b.dataset.estado, obs: ta ? ta.value : obs };
        pintarEditor();
        const nuevo = caja.querySelector('[data-obs]');
        if (nuevo) nuevo.focus();
      }));
      const ta = caja.querySelector('[data-obs]');
      if (ta) ta.addEventListener('input', () => {
        if (!borrador) { borrador = { estado: elegido, obs: ta.value }; const pos = ta.selectionStart; pintarEditor(); const t2 = caja.querySelector('[data-obs]'); if (t2) { t2.focus(); t2.setSelectionRange(pos, pos); } }
        else borrador.obs = ta.value;
      });
      const cancelar = caja.querySelector('[data-cancelar]');
      if (cancelar) cancelar.addEventListener('click', () => { borrador = null; pintarEditor(); });
      const guardar = caja.querySelector('[data-guardar]');
      if (guardar) guardar.addEventListener('click', () => guardarCambio(caja));
    }

    async function guardarCambio(caja) {
      const msg = caja.querySelector('[data-msg]');
      const aviso = (t, mal) => { msg.textContent = t; msg.className = 'text-xs mt-2 ' + (mal ? 'text-telecab-red' : 'text-telecab-muted'); };
      aviso('Guardando…');
      try {
        const r = await (await fetch(`/vehiculos/api/piezas/${id}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieza: mem.sel, estado: borrador.estado, observacion: borrador.estado === 'bien' ? '' : borrador.obs }),
        })).json();
        if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo guardar');
        borrador = null;
        await traer();
        pintar();
        // La fila del coche en la lista, sin repintar la ficha entera.
        if (lista && Array.isArray(lista.filas) && typeof lista.pintarFilas === 'function') {
          const f = lista.filas.find(x => Number(x.id) === id);
          if (f) {
            f.piezas_mal = D.piezas.filter(p => estadoDe(p.codigo) !== 'bien').length;
            f.piezas_cambio = D.piezas.filter(p => estadoDe(p.codigo) === 'cambio').length;
            lista.pintarFilas();
          }
        }
        const nuevo = hueco.querySelector('[data-editor] [data-msg]');
        if (nuevo) { nuevo.textContent = r.sinCambios ? 'Ya estaba así: no se ha cambiado nada.' : '✓ Guardado.'; nuevo.className = 'text-xs mt-2 text-telecab-green'; }
      } catch (e) { aviso('Error: ' + e.message, true); }
    }

    try { await traer(); pintar(); }
    catch (e) { hueco.innerHTML = `<p class="text-sm text-telecab-red">No se pudo cargar el estado de las piezas: ${esc(e.message)}</p>`; }
  }

  global.PiezasCoche = { montar, _formas: { EXTERIOR, INTERIOR } };
})(window);
