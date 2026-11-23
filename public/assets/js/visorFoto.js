// ============================================================
// VISOR DE FOTOS — ver una foto en grande sin salir de la pantalla
// ============================================================
// Camilo, 07/10/2026: «cuando le dé clic a la foto, que se vea grande sin
// tener que ir a su ficha». Una capa encima de todo con la foto a lo grande y
// su título; se cierra con la X, con Escape o pinchando fuera. Abrirla en otra
// pestaña sacaba de la conversación para mirar una foto.
//
// ZOOM Y DESCARGA (23/11/2026, Camilo: «hacer zoom a las imágenes y
// descargarlas directamente del chat»). Para todas las pantallas que usan el
// visor:
//   · acercar y alejar con la rueda (hacia donde apunta el ratón), con doble
//     clic (de ajustada a 2,5× y vuelta), pellizcando en el móvil, con los
//     botones de abajo y con las teclas + − y 0;
//   · con la foto acercada, se mueve arrastrándola;
//   · «Descargar», si quien abre el visor dice cómo (`descargar`).
//
// ── CÓMO SE USA ─────────────────────────────────────────────────────────────
//
//   VisorFoto.abrir({ src: '/whatsapp/api/foto/96?v=501', titulo: 'Andrés Garrido', pie: '+34 604…' });
//
// `original: true` añade el enlace «Abrir el original» (a la misma dirección,
// en otra pestaña). `descargar`: una función (la llama el botón) o `true` para
// bajar `src` tal cual, con el nombre del título.

(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MIN = 1, MAX = 6;
  let abierto = null;

  function cerrar() {
    if (!abierto) return;
    const { capa, antes, alTeclado } = abierto;
    abierto = null;
    document.removeEventListener('keydown', alTeclado, true);
    capa.classList.remove('visor-dentro');
    setTimeout(() => capa.remove(), 160);
    if (antes && antes.focus) antes.focus();
  }

  const boton = (dato, icono, etiqueta) =>
    `<button type="button" ${dato} aria-label="${etiqueta}" title="${etiqueta}"
       class="w-9 h-9 grid place-items-center rounded-lg text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
       <i class="fa-solid ${icono}" aria-hidden="true"></i></button>`;

  function abrir({ src, titulo = '', pie = '', original = false, descargar = null } = {}) {
    if (!src) return;
    cerrar();
    const capa = document.createElement('div');
    capa.className = 'visor-foto fixed inset-0 z-[140] flex flex-col items-center justify-center gap-3 p-4 bg-black/85 backdrop-blur-sm overflow-hidden';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', titulo || 'Foto');
    capa.innerHTML = `
      <button type="button" data-cerrar aria-label="Cerrar"
              class="absolute top-3 right-3 z-10 w-10 h-10 rounded-xl bg-telecab-card/80 border border-telecab-border text-telecab-text hover:border-telecab-gold/60">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="visor-caja relative flex items-center justify-center max-w-[92vw] max-h-[74vh]">
        <span data-cargando class="text-sm text-white/70"><i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i>Cargando…</span>
        <img alt="${esc(titulo || 'Foto')}" draggable="false" class="visor-img hidden max-w-[92vw] max-h-[74vh] rounded-2xl object-contain shadow-2xl bg-telecab-card select-none">
      </div>
      <div class="visor-pie relative z-10 flex flex-col items-center gap-2 max-w-[92vw]">
        <div class="flex items-center gap-0.5 rounded-xl bg-black/55 border border-white/10 px-1 py-1" role="toolbar" aria-label="Zoom">
          ${boton('data-menos', 'fa-magnifying-glass-minus', 'Alejar')}
          <button type="button" data-ajustar title="Ajustar a la pantalla" aria-label="Ajustar a la pantalla"
                  class="min-w-[3.6rem] h-9 px-2 rounded-lg text-xs font-semibold tabular-nums text-white/85 hover:bg-white/10 hover:text-white">100 %</button>
          ${boton('data-mas', 'fa-magnifying-glass-plus', 'Acercar')}
          ${descargar ? `<span class="w-px h-5 bg-white/15 mx-1" aria-hidden="true"></span>${boton('data-descargar', 'fa-download', 'Descargar')}` : ''}
        </div>
        ${titulo || pie || original ? `<div class="text-center">
          ${titulo ? `<div class="text-sm font-semibold text-white">${esc(titulo)}</div>` : ''}
          ${pie ? `<div class="text-xs text-white/70 mt-0.5">${esc(pie)}</div>` : ''}
          ${original ? `<a href="${esc(src)}" target="_blank" rel="noopener" class="inline-block mt-1 text-xs text-white/70 underline underline-offset-2 hover:text-white">Abrir el original</a>` : ''}
        </div>` : ''}
      </div>`;
    const img = capa.querySelector('img');
    const etiqueta = capa.querySelector('[data-ajustar]');
    img.addEventListener('load', () => { capa.querySelector('[data-cargando]').remove(); img.classList.remove('hidden'); });
    img.addEventListener('error', () => { capa.querySelector('[data-cargando]').textContent = 'No se pudo cargar la foto.'; });
    img.src = src;

    // ── El zoom: escala y desplazamiento, con transform (no toca el layout) ──
    let z = 1, x = 0, y = 0;
    const limitar = () => {
      // Que la foto no se pierda: como mucho, su borde llega al centro.
      const r = img.getBoundingClientRect();
      const w = r.width / z, h = r.height / z;
      const mx = (w * z) / 2, my = (h * z) / 2;
      x = Math.max(-mx, Math.min(mx, x));
      y = Math.max(-my, Math.min(my, y));
      if (z === 1) { x = 0; y = 0; }
    };
    const pintar = ({ suave = false } = {}) => {
      img.style.transition = suave ? 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)' : 'none';
      img.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      img.style.cursor = z > 1 ? 'grab' : 'zoom-in';
      etiqueta.textContent = `${Math.round(z * 100)} %`;
    };
    // Acercar hacia un punto de la pantalla (cx, cy): ese punto se queda donde está.
    const zoomA = (nuevo, cx, cy, opciones) => {
      nuevo = Math.max(MIN, Math.min(MAX, nuevo));
      if (nuevo === z) return;
      const caja = img.parentElement.getBoundingClientRect();
      const ox = (cx == null ? caja.left + caja.width / 2 : cx) - (caja.left + caja.width / 2);
      const oy = (cy == null ? caja.top + caja.height / 2 : cy) - (caja.top + caja.height / 2);
      x = ox - (ox - x) * (nuevo / z);
      y = oy - (oy - y) * (nuevo / z);
      z = nuevo;
      limitar();
      pintar(opciones);
    };
    const ajustar = () => { z = 1; x = 0; y = 0; pintar({ suave: true }); };

    capa.addEventListener('wheel', e => {
      if (img.classList.contains('hidden')) return;
      e.preventDefault();
      zoomA(z * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    img.addEventListener('dblclick', e => {
      if (z > 1) ajustar(); else zoomA(2.5, e.clientX, e.clientY, { suave: true });
    });

    // Arrastrar para moverse y pellizcar para acercar (punteros: ratón, dedo o lápiz).
    const punteros = new Map();
    let movido = false, pellizco = null;
    img.addEventListener('pointerdown', e => {
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      img.setPointerCapture(e.pointerId);
      movido = false;
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        pellizco = { d: Math.hypot(a.x - b.x, a.y - b.y), z };
      }
      if (z > 1) img.style.cursor = 'grabbing';
    });
    img.addEventListener('pointermove', e => {
      const antes = punteros.get(e.pointerId);
      if (!antes) return;
      const ahora = { x: e.clientX, y: e.clientY };
      punteros.set(e.pointerId, ahora);
      if (punteros.size === 2 && pellizco) {
        const [a, b] = [...punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomA(pellizco.z * (d / pellizco.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
        movido = true;
        return;
      }
      if (z <= 1) return;
      const dx = ahora.x - antes.x, dy = ahora.y - antes.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) movido = true;
      x += dx; y += dy;
      limitar();
      pintar();
    });
    const soltar = e => {
      punteros.delete(e.pointerId);
      if (punteros.size < 2) pellizco = null;
      if (z > 1) img.style.cursor = 'grab';
    };
    img.addEventListener('pointerup', soltar);
    img.addEventListener('pointercancel', soltar);
    img.style.touchAction = 'none';

    // Se cierra pinchando fuera de la foto (no en ella ni en la barra) o en la X.
    capa.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar]')) { cerrar(); return; }
      if (e.target.closest('[data-mas]')) { zoomA(z * 1.5, null, null, { suave: true }); return; }
      if (e.target.closest('[data-menos]')) { zoomA(z / 1.5, null, null, { suave: true }); return; }
      if (e.target.closest('[data-ajustar]')) { ajustar(); return; }
      if (e.target.closest('[data-descargar]')) {
        if (typeof descargar === 'function') descargar();
        else {
          const a = document.createElement('a');
          a.href = src; a.download = titulo || ''; document.body.appendChild(a); a.click(); a.remove();
        }
        return;
      }
      if (e.target.closest('img')) { if (!movido && z === 1) zoomA(2.5, e.clientX, e.clientY, { suave: true }); return; }
      if (!e.target.closest('a') && !e.target.closest('.visor-pie')) cerrar();
    });
    // Escape cierra; + − 0 hacen zoom; el Tab no se escapa de la capa.
    const alTeclado = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomA(z * 1.5, null, null, { suave: true }); return; }
      if (e.key === '-') { e.preventDefault(); zoomA(z / 1.5, null, null, { suave: true }); return; }
      if (e.key === '0') { e.preventDefault(); ajustar(); return; }
      if (e.key === 'Tab') {
        const f = [...capa.querySelectorAll('button, a')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', alTeclado, true);
    abierto = { capa, antes: document.activeElement, alTeclado };
    document.body.appendChild(capa);
    pintar();
    // Se fuerza el reflujo para que la entrada se anime aunque la pestaña no pinte (ver ayuda.js).
    void capa.offsetHeight;
    capa.classList.add('visor-dentro');
    capa.querySelector('[data-cerrar]').focus();
  }

  // La entrada: aparece y la foto crece un poco, sin rebote. Con movimiento
  // reducido, solo aparece.
  const css = document.createElement('style');
  css.textContent = `
    .visor-foto { opacity: 0; transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1); }
    .visor-foto .visor-caja { transform: scale(0.96); transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1); }
    .visor-foto.visor-dentro { opacity: 1; }
    .visor-foto.visor-dentro .visor-caja { transform: none; }
    .visor-foto .visor-img { transform-origin: center center; will-change: transform; }
    @media (prefers-reduced-motion: reduce) { .visor-foto .visor-caja { transform: none; transition: none; } .visor-foto .visor-img { transition: none !important; } }`;
  document.head.appendChild(css);

  global.VisorFoto = { abrir, cerrar };
})(window);
