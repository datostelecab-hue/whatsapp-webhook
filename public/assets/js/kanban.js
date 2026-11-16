// ============================================================
// KANBAN — columnas de tarjetas con arrastrar y soltar (16/11/2026)
// ============================================================
// Lo estrena el tablero de tareas (ítem 1). La casa no tenía ninguna pieza de
// arrastre: esta es la de todos, con las clases globales .tc-kanban* y
// .tc-tarjeta* de telecab.css. Se carga en la vista que la use.
//
//   const k = Kanban.montar(caja, {
//     columnas: [{ id: 'por_hacer', titulo: 'Por hacer', vacia: 'Nada por hacer' }],
//     clave: t => t.id,
//     columnaDe: t => t.estado,
//     pinta: t => '…',                      // el contenido de la tarjeta, YA escapado
//     nombre: t => t.titulo,                // cómo se llama la tarjeta para el lector de pantalla
//     puedeArrastrar: t => true,
//     puedeSoltar: (t, columna) => true,
//     alSoltar: async (t, columna) => {},   // si lanza, la tarjeta vuelve a su sitio
//     alAbrir: t => {},
//   });
//   k.poner(tarjetas);   // repinta con las de ahora
//
// ARRASTRAR ES UN ATAJO, NO LA ÚNICA FORMA: con el teclado o en el móvil (el
// arrastre del navegador no existe en pantallas táctiles), Enter abre la
// tarjeta y su ficha tiene «Mover a…». Mientras se arrastra, las columnas donde
// se puede soltar se marcan y las demás se apagan.
(function (global) {
  'use strict';

  function montar(caja, opciones = {}) {
    const o = {
      columnas: [], clave: t => t.id, columnaDe: t => t.columna, pinta: () => '', nombre: t => String(o.clave(t)),
      puedeArrastrar: () => false, puedeSoltar: () => false, alSoltar: null, alAbrir: null, ...opciones,
    };
    let tarjetas = [];
    let arrastrada = null;
    const esc = s => global.Casa.esc(s);

    caja.classList.add('tc-kanban');
    caja.innerHTML = o.columnas.map(c => `
      <section class="tc-kanban-columna" data-columna="${esc(c.id)}" aria-labelledby="kb-${esc(c.id)}">
        <div class="tc-kanban-cabeza">
          <h3 class="tc-kanban-titulo" id="kb-${esc(c.id)}">${esc(c.titulo)}</h3>
          <span class="tc-kanban-cuenta" data-cuenta></span>
        </div>
        <div class="tc-kanban-lista" data-lista role="list"></div>
      </section>`).join('');
    const columna = id => caja.querySelector(`[data-columna="${CSS.escape(id)}"]`);

    function poner(nuevas) {
      tarjetas = nuevas || [];
      for (const c of o.columnas) {
        const suyas = tarjetas.filter(t => o.columnaDe(t) === c.id);
        const col = columna(c.id);
        col.querySelector('[data-cuenta]').textContent = suyas.length || '';
        col.querySelector('[data-lista]').innerHTML = suyas.length
          ? suyas.map(t => {
            const k = String(o.clave(t));
            const mover = o.puedeArrastrar(t);
            return `<div role="listitem"><div class="tc-tarjeta" tabindex="0" data-tarjeta="${esc(k)}" ${mover ? 'draggable="true"' : ''}
                      aria-label="${esc(o.nombre(t))}">${o.pinta(t)}</div></div>`;
          }).join('')
          : `<p class="tc-kanban-vacia">${esc(c.vacia || 'Nada')}</p>`;
      }
    }

    const deElemento = el => {
      const k = el && el.closest('[data-tarjeta]') && el.closest('[data-tarjeta]').dataset.tarjeta;
      return k == null ? null : tarjetas.find(t => String(o.clave(t)) === k) || null;
    };

    caja.addEventListener('click', e => {
      const t = deElemento(e.target);
      if (t && o.alAbrir) o.alAbrir(t);
    });
    caja.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = deElemento(e.target);
      if (!t || !o.alAbrir) return;
      e.preventDefault();
      o.alAbrir(t);
    });

    // ── Arrastrar y soltar (ratón) ──
    const limpiar = () => {
      caja.querySelectorAll('[data-soltar]').forEach(c => c.removeAttribute('data-soltar'));
      caja.querySelectorAll('.tc-tarjeta--arrastrando').forEach(x => x.classList.remove('tc-tarjeta--arrastrando'));
    };
    caja.addEventListener('dragstart', e => {
      const t = deElemento(e.target);
      if (!t || !o.puedeArrastrar(t)) { e.preventDefault(); return; }
      arrastrada = t;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(o.clave(t)));
      e.target.closest('[data-tarjeta]').classList.add('tc-tarjeta--arrastrando');
      for (const c of o.columnas) {
        const vale = c.id !== o.columnaDe(t) && o.puedeSoltar(t, c.id);
        columna(c.id).setAttribute('data-soltar', vale ? 'si' : (c.id === o.columnaDe(t) ? '' : 'no'));
      }
    });
    caja.addEventListener('dragend', () => { arrastrada = null; limpiar(); });
    caja.addEventListener('dragover', e => {
      const col = e.target.closest('[data-columna]');
      if (arrastrada && col && col.getAttribute('data-soltar') === 'si') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    caja.addEventListener('drop', async e => {
      const col = e.target.closest('[data-columna]');
      const t = arrastrada;
      arrastrada = null;
      limpiar();
      if (!t || !col || !o.alSoltar) return;
      e.preventDefault();
      const destino = col.dataset.columna;
      if (destino === o.columnaDe(t) || !o.puedeSoltar(t, destino)) return;
      try { await o.alSoltar(t, destino); }
      catch (err) { poner(tarjetas); throw err; }
    });

    return { poner, tarjetas: () => tarjetas };
  }

  global.Kanban = { montar };
})(window);
