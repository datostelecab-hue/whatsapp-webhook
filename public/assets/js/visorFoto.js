// ============================================================
// VISOR DE FOTOS — ver una foto en grande sin salir de la pantalla
// ============================================================
// Camilo, 07/10/2026: «cuando le dé clic a la foto, que se vea grande sin
// tener que ir a su ficha». Una capa encima de todo con la foto a lo grande y
// su título; se cierra con la X, con Escape o pinchando fuera. Abrirla en otra
// pestaña sacaba de la conversación para mirar una foto.
//
// ── CÓMO SE USA ─────────────────────────────────────────────────────────────
//
//   VisorFoto.abrir({ src: '/whatsapp/api/foto/96?v=501', titulo: 'Andrés Garrido', pie: '+34 604…' });
//
// `original: true` añade el enlace «Abrir el original» (a la misma dirección,
// en otra pestaña), para descargarla o verla a su tamaño.

(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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

  function abrir({ src, titulo = '', pie = '', original = false } = {}) {
    if (!src) return;
    cerrar();
    const capa = document.createElement('div');
    capa.className = 'visor-foto fixed inset-0 z-[140] flex flex-col items-center justify-center gap-3 p-4 bg-black/80 backdrop-blur-sm';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', titulo || 'Foto');
    capa.innerHTML = `
      <button type="button" data-cerrar aria-label="Cerrar"
              class="absolute top-3 right-3 w-10 h-10 rounded-xl bg-telecab-card/80 border border-telecab-border text-telecab-text hover:border-telecab-gold/60">
        <i class="fa-solid fa-xmark"></i></button>
      <div class="visor-caja relative flex items-center justify-center max-w-[92vw] max-h-[80vh]">
        <span data-cargando class="text-sm text-white/70"><i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i>Cargando…</span>
        <img alt="${esc(titulo)}" class="hidden max-w-[92vw] max-h-[80vh] rounded-2xl object-contain shadow-2xl bg-telecab-card">
      </div>
      ${titulo || pie || original ? `<div class="text-center max-w-[92vw]">
        ${titulo ? `<div class="text-sm font-semibold text-white">${esc(titulo)}</div>` : ''}
        ${pie ? `<div class="text-xs text-white/70 mt-0.5">${esc(pie)}</div>` : ''}
        ${original ? `<a href="${esc(src)}" target="_blank" rel="noopener" class="inline-block mt-1 text-xs text-white/70 underline underline-offset-2 hover:text-white">Abrir el original</a>` : ''}
      </div>` : ''}`;
    const img = capa.querySelector('img');
    img.addEventListener('load', () => { capa.querySelector('[data-cargando]').remove(); img.classList.remove('hidden'); });
    img.addEventListener('error', () => { capa.querySelector('[data-cargando]').textContent = 'No se pudo cargar la foto.'; });
    img.src = src;

    // Se cierra pinchando fuera de la foto (no en ella) o en la X.
    capa.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar]') || (!e.target.closest('img') && !e.target.closest('a'))) cerrar();
    });
    // Escape cierra; el Tab no se escapa de la capa.
    const alTeclado = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
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
    @media (prefers-reduced-motion: reduce) { .visor-foto .visor-caja { transform: none; transition: none; } }`;
  document.head.appendChild(css);

  global.VisorFoto = { abrir, cerrar };
})(window);
