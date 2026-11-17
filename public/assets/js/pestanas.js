// ============================================================
// PESTAÑAS — el componente de la casa (16/11/2026)
// ============================================================
// Hasta aquí cada pantalla pintaba las suyas (el taller, el call center…),
// cada una con sus clases. Esta es la de todas, con las clases globales
// .tc-pestanas / .tc-pestana de telecab.css. Se carga en la vista que la use.
//
//   const p = Pestanas.montar(document.querySelector('#pestanas'), {
//     pestanas: [{ id: 'mias', texto: 'Mi tablero', icono: 'fa-table-columns', contador: 'tareas.mias' }],
//     param: 'vista',                 // la elegida va en la dirección: ?vista=mias
//     alCambiar: id => pintar(id),
//   });
//   p.ir('equipo'); p.actual();
//
// Con el teclado: flechas izquierda y derecha, Inicio y Fin (como manda ARIA).
// `contador`: una marca de Contadores (A9) al lado del texto.
(function (global) {
  'use strict';
  const esc = s => global.Casa.esc(s);

  function montar(caja, { pestanas = [], param = 'vista', inicial = null, alCambiar } = {}) {
    const ids = pestanas.map(p => p.id);
    const deUrl = new URLSearchParams(global.location.search).get(param);
    let actual = ids.includes(deUrl) ? deUrl : (ids.includes(inicial) ? inicial : ids[0]);

    caja.classList.add('tc-pestanas');
    caja.setAttribute('role', 'tablist');
    caja.innerHTML = pestanas.map(p => `
      <button type="button" role="tab" class="tc-pestana" data-pestana="${esc(p.id)}" id="pestana-${esc(p.id)}">
        ${p.icono ? `<i class="fa-solid ${esc(p.icono)}" aria-hidden="true"></i>` : ''}<span>${esc(p.texto)}</span>
        ${p.contador ? `<span class="tc-contador" data-contador="${esc(p.contador)}" hidden></span>` : ''}
      </button>`).join('');
    const botones = [...caja.querySelectorAll('[data-pestana]')];

    function marcar() {
      botones.forEach(b => {
        const si = b.dataset.pestana === actual;
        b.setAttribute('aria-selected', String(si));
        b.tabIndex = si ? 0 : -1;
      });
    }

    function ir(id, { avisar = true, foco = false } = {}) {
      if (!ids.includes(id)) return;
      actual = id;
      marcar();
      const u = new URL(global.location.href);
      u.searchParams.set(param, id);
      global.history.replaceState(global.history.state, '', u);
      if (foco) caja.querySelector(`[data-pestana="${CSS.escape(id)}"]`).focus();
      if (avisar && alCambiar) alCambiar(id);
    }

    caja.addEventListener('click', e => {
      const b = e.target.closest('[data-pestana]');
      if (b) ir(b.dataset.pestana);
    });
    caja.addEventListener('keydown', e => {
      const i = ids.indexOf(actual);
      const destino = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i - 1 + ids.length) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key];
      if (!destino) return;
      e.preventDefault();
      ir(destino, { foco: true });
    });

    marcar();
    if (global.Contadores) global.Contadores.refrescar();
    return { ir, actual: () => actual };
  }

  global.Pestanas = { montar };
})(window);
