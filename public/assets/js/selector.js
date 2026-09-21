// ============================================================
// SELECTOR — elegir una opción, con la cara de la casa
// ============================================================
// El `<select>` del navegador se pinta con los colores del sistema operativo:
// fondo blanco y azul de Windows en medio de una pantalla oscura. `Dialogo`
// ya tenía su propio selector, pero vivía DENTRO de `Dialogo.formulario` y no
// había forma de usarlo en un formulario montado a mano.
//
// Esto es esa misma idea, suelta: un grupo de botones que se comporta como un
// campo. Sirve para lo que hay hoy —estado, zona, sede— y para lo que venga.
//
// ── CÓMO SE USA ─────────────────────────────────────────────────────────────
//
//   <input type="hidden" id="fm-sede" value="madrid">
//   <div class="tc-selector" data-para="fm-sede">
//     <button type="button" data-v="madrid">Madrid</button>
//     <button type="button" data-v="barcelona">Barcelona</button>
//   </div>
//
// EL VALOR VIVE EN EL `<input type="hidden">`, y ese es el truco: el formulario
// sigue leyendo y escribiendo `campo('sede').value` como si fuera un `<select>`
// de toda la vida. Cambiar el aspecto no obliga a tocar la lógica de nadie.
//
// Al elegir se dispara `change` sobre el input, así que quien ya escuchara ese
// evento se entera igual.

(function (global) {
  'use strict';

  const destino = sel => document.getElementById(sel.dataset.para || '');

  /** Deja marcado el botón que toca. Sin valor, ninguno. */
  function pintar(sel) {
    const inp = destino(sel);
    const v = inp ? String(inp.value == null ? '' : inp.value) : '';
    sel.querySelectorAll('button[data-v]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.v === v));
    });
  }

  /** Elige un valor desde fuera (al abrir el formulario, por ejemplo). */
  function poner(sel, valor) {
    const inp = destino(sel);
    if (!inp) return;
    inp.value = valor == null ? '' : String(valor);
    pintar(sel);
  }

  /** Repasa todos los de la página. Se puede llamar cuantas veces haga falta. */
  function montar(raiz) {
    (raiz || document).querySelectorAll('.tc-selector[data-para]').forEach(pintar);
  }

  // Delegado en el documento: vale para los que ya están y para los que se
  // pinten después, sin tener que acordarse de montarlos.
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.tc-selector[data-para] button[data-v]');
    if (!b) return;
    e.preventDefault();
    const sel = b.closest('.tc-selector');
    const inp = destino(sel);
    if (!inp || inp.disabled) return;
    inp.value = b.dataset.v;
    pintar(sel);
    // Los dos eventos, como hace el calendario de la casa: hay pantallas que
    // escuchan `input` y otras `change`, y ninguna tiene que saber cuál usamos.
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Con el teclado: flechas para moverse dentro del grupo.
  document.addEventListener('keydown', e => {
    const b = e.target.closest && e.target.closest('.tc-selector[data-para] button[data-v]');
    if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const bs = [...b.closest('.tc-selector').querySelectorAll('button[data-v]')];
    const i = bs.indexOf(b);
    const j = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length;
    e.preventDefault();
    bs[j].focus(); bs[j].click();
  });

  // Y cuando alguien cambia el input a mano (el formulario al abrirse), el
  // grupo se entera: así nadie tiene que acordarse de repintar.
  document.addEventListener('change', e => {
    if (!e.target || !e.target.id) return;
    document.querySelectorAll(`.tc-selector[data-para="${CSS.escape(e.target.id)}"]`).forEach(pintar);
  });

  global.Selector = { montar, poner, pintar };
  if (document.readyState !== 'loading') montar();
  else document.addEventListener('DOMContentLoaded', () => montar());
})(window);
