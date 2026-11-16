// ============================================================
// PANEL — la ficha que se abre al lado (16/11/2026)
// ============================================================
// Un panel que entra por la derecha, encima de la pantalla y sin dejarla: la
// ficha de una tarjeta del tablero, y lo que necesite lo mismo. Uno a la vez.
// Clases globales .tc-panel* de telecab.css. Se carga en la vista que lo use.
//
//   const p = Panel.abrir({ titulo, subtitulo, html, alCerrar });
//   p.cuerpo            el elemento del contenido (para enganchar sus botones)
//   p.poner({ titulo, subtitulo, html })   cambia lo que enseña sin cerrarlo
//   p.cerrar()
//
// Escape y el fondo lo cierran, salvo que haya un Dialogo abierto encima (un
// formulario a medias no se pierde). Al cerrarse, el foco vuelve a donde estaba.
(function (global) {
  'use strict';
  const esc = s => global.Casa.esc(s);
  let abierto = null;

  function abrir({ titulo = '', subtitulo = '', html = '', alCerrar } = {}) {
    if (abierto) abierto.cerrar();
    const antes = document.activeElement;
    const fondo = document.createElement('div');
    fondo.className = 'tc-panel-fondo';
    const panel = document.createElement('aside');
    panel.className = 'tc-panel tc-panel--saliendo';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      <div class="tc-panel-cabeza">
        <div class="min-w-0 flex-1">
          <h2 class="font-bold text-base leading-snug" data-panel-titulo></h2>
          <p class="text-xs text-telecab-muted mt-0.5" data-panel-subtitulo></p>
        </div>
        <button type="button" class="tc-boton tc-boton--chico" data-panel-cerrar aria-label="Cerrar">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <div class="tc-panel-cuerpo" data-panel-cuerpo></div>`;
    document.body.append(fondo, panel);
    const cuerpo = panel.querySelector('[data-panel-cuerpo]');

    function poner({ titulo: t, subtitulo: s, html: h } = {}) {
      if (t !== undefined) panel.querySelector('[data-panel-titulo]').textContent = t;
      if (s !== undefined) panel.querySelector('[data-panel-subtitulo]').textContent = s;
      if (h !== undefined) cuerpo.innerHTML = h;
      panel.setAttribute('aria-label', panel.querySelector('[data-panel-titulo]').textContent);
    }

    const teclado = e => {
      // Con un Dialogo encima (un formulario), Escape es suyo.
      if (e.key === 'Escape' && !document.querySelector('.dialogo, [data-formulario]')) cerrar();
    };
    let cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener('keydown', teclado);
      panel.classList.add('tc-panel--saliendo');
      fondo.remove();
      const quitar = () => panel.remove();
      if (global.matchMedia('(prefers-reduced-motion: reduce)').matches) quitar();
      else setTimeout(quitar, 220);
      if (abierto && abierto.panel === panel) abierto = null;
      if (antes && antes.isConnected && antes.focus) antes.focus();
      if (alCerrar) alCerrar();
    }

    fondo.addEventListener('click', cerrar);
    panel.querySelector('[data-panel-cerrar]').addEventListener('click', cerrar);
    document.addEventListener('keydown', teclado);
    poner({ titulo, subtitulo, html });
    // Entra deslizándose (salvo con el movimiento reducido).
    global.requestAnimationFrame(() => panel.classList.remove('tc-panel--saliendo'));
    panel.querySelector('[data-panel-cerrar]').focus();

    abierto = { panel, cuerpo, poner, cerrar };
    return abierto;
  }

  global.Panel = { abrir, abierto: () => abierto, esc };
})(window);
