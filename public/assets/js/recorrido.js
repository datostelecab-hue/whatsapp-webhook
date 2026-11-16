// ============================================================
// RECORRIDO — un paseo guiado por la pantalla, paso a paso (V3)
// ============================================================
// Ilumina una parte de la pantalla, oscurece el resto y explica al lado qué es.
// Nació con las novedades de la V3 (16/11/2026) para enseñar el ERP a quien
// llega; vale para cualquier pantalla que quiera el suyo.
//
//   Recorrido.empezar([
//     { sel: '#menu', titulo: 'El menú', texto: 'Todo lo que puedes abrir.' },
//     { sel: ['#tk-barra', '#notif-btn'], titulo: '…', texto: '…' },   // el primero que se vea
//     { titulo: 'Y ya está', texto: 'Sin `sel`: un paso en el centro.' },
//   ], { alAcabar: como => …  });   // como: 'hecho' (llegó al final) o 'saltado'
//
// · Un paso cuyo elemento no está o no se ve (oculto, fuera de la pantalla)
//   se salta solo: el mismo recorrido vale en el ordenador y en el móvil, con
//   permisos distintos y con el menú plegado o abierto.
// · `antes(el)`: algo que hacer antes de iluminarlo (abrir un grupo del menú).
// · Teclado: → o Intro sigue, ← vuelve, Escape lo deja. El foco va al globo y
//   vuelve a donde estaba al acabar.
// · Con el menú plegado, mientras ilumina algo del menú, lo despliega.
// · Con menos movimiento, sin transiciones.
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MARGEN = 8;       // aire alrededor de lo iluminado
  const SEP = 14;         // del foco al globo

  let activo = null;

  /** El primer elemento de `sel` que existe y se ve. */
  function buscar(sel) {
    if (!sel) return null;
    const lista = Array.isArray(sel) ? sel : [sel];
    for (const s of lista) {
      const el = typeof s === 'string' ? document.querySelector(s) : s;
      if (el && seVe(el)) return el;
    }
    return null;
  }
  function seVe(el) {
    if (!el.isConnected || el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // Fuera de la pantalla (el menú del móvil, escondido a la izquierda).
    return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight + 2000;
  }

  function empezar(pasos, { alAcabar } = {}) {
    if (activo) acabar('saltado');
    const lista = (pasos || []).filter(Boolean);
    if (!lista.length) return;
    const capa = document.createElement('div');
    capa.className = 'tc-recorrido-capa';
    const foco = document.createElement('div');
    foco.className = 'tc-recorrido-foco';
    const globo = document.createElement('div');
    globo.className = 'tc-recorrido-globo';
    globo.setAttribute('role', 'dialog');
    globo.setAttribute('aria-modal', 'true');
    globo.setAttribute('aria-live', 'polite');
    globo.tabIndex = -1;
    document.body.append(capa, foco, globo);
    activo = { pasos: lista, i: -1, capa, foco, globo, alAcabar, volver: document.activeElement, el: null };
    document.documentElement.classList.add('tc-recorriendo');
    capa.addEventListener('click', () => acabar('saltado'));
    globo.addEventListener('click', ev => {
      const b = ev.target.closest('[data-rc]');
      if (!b) return;
      if (b.dataset.rc === 'sig') ir(+1);
      else if (b.dataset.rc === 'ant') ir(-1);
      else acabar('saltado');
    });
    document.addEventListener('keydown', teclas, true);
    addEventListener('resize', recolocar);
    addEventListener('scroll', recolocar, true);
    ir(+1);
  }

  function teclas(ev) {
    if (!activo) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); acabar('saltado'); }
    else if (ev.key === 'ArrowRight' || (ev.key === 'Enter' && !ev.target.closest('button'))) { ev.preventDefault(); ir(+1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); ir(-1); }
    else if (ev.key === 'Tab') {
      // El foco no sale del globo mientras dura.
      const bs = [...activo.globo.querySelectorAll('button')];
      if (!bs.length) return;
      const i = bs.indexOf(document.activeElement);
      ev.preventDefault();
      bs[(i + (ev.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
    }
  }

  // Avanza (o vuelve) al siguiente paso que se pueda enseñar.
  function ir(d) {
    const a = activo;
    let i = a.i;
    for (;;) {
      i += d;
      if (i < 0) return;
      if (i >= a.pasos.length) { acabar('hecho'); return; }
      const p = a.pasos[i];
      if (!p.sel) { mostrar(i, null); return; }
      const el0 = buscar(p.sel);
      if (!el0) continue;
      soltarMenu();
      if (el0.closest('#menu')) document.getElementById('menu').classList.add('tc-recorrido-abierto');
      if (typeof p.antes === 'function') { try { p.antes(el0); } catch (e) { /* el paso sigue */ } }
      const el = buscar(p.sel) || el0;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // Una vuelta de pintado: el menú desplegado y el desplazamiento, ya puestos.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (activo === a) mostrar(i, el); }));
      return;
    }
  }

  // Cuántos pasos se pueden enseñar de verdad (para «3 de 7»), mirado ahora.
  function visibles() {
    return activo.pasos.filter(p => !p.sel || buscar(p.sel)).length;
  }

  function mostrar(i, el) {
    const a = activo;
    const p = a.pasos[i];
    a.i = i; a.el = el;
    const n = visibles();
    const k = a.pasos.slice(0, i + 1).filter(x => !x.sel || buscar(x.sel)).length;
    const ultimo = !a.pasos.slice(i + 1).some(x => !x.sel || buscar(x.sel));
    a.globo.innerHTML = `
      <div class="tc-recorrido-cabeza">
        ${p.icono ? `<span class="tc-recorrido-icono" aria-hidden="true"><i class="fa-solid ${esc(p.icono)}"></i></span>` : ''}
        <h3 class="tc-recorrido-titulo">${esc(p.titulo || '')}</h3>
      </div>
      <p class="tc-recorrido-texto">${esc(p.texto || '')}</p>
      <div class="tc-recorrido-pie">
        <span class="tc-recorrido-cuenta">${k} de ${n}</span>
        <button type="button" class="tc-recorrido-saltar" data-rc="saltar">Saltar</button>
        ${k > 1 ? '<button type="button" class="tc-boton tc-boton--chico" data-rc="ant">Atrás</button>' : ''}
        <button type="button" class="tc-boton tc-boton--chico tc-boton--principal" data-rc="sig">${ultimo ? 'Terminar' : 'Siguiente'}</button>
      </div>
      <div class="tc-recorrido-progreso" aria-hidden="true"><span style="width:${Math.round(100 * k / n)}%"></span></div>`;
    a.globo.setAttribute('aria-label', `${p.titulo || 'Recorrido'}: paso ${k} de ${n}`);
    a.foco.classList.toggle('tc-recorrido-foco--centro', !el);
    recolocar();
    const sig = a.globo.querySelector('[data-rc="sig"]');
    (sig || a.globo).focus({ preventScroll: true });
  }

  function recolocar() {
    const a = activo;
    if (!a) return;
    const g = a.globo;
    const vw = innerWidth, vh = innerHeight;
    if (!a.el) {
      Object.assign(a.foco.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px' });
      g.style.left = `${Math.max(12, (vw - g.offsetWidth) / 2)}px`;
      g.style.top = `${Math.max(12, (vh - g.offsetHeight) / 2)}px`;
      g.dataset.lado = 'centro';
      return;
    }
    const r = a.el.getBoundingClientRect();
    const f = { x: r.left - MARGEN, y: r.top - MARGEN, w: r.width + MARGEN * 2, h: r.height + MARGEN * 2 };
    // Lo que no cabe en la pantalla (el menú entero en una pantalla baja) se recorta.
    f.x = Math.max(4, f.x); f.y = Math.max(4, f.y);
    f.w = Math.min(f.w, vw - f.x - 4); f.h = Math.min(f.h, vh - f.y - 4);
    Object.assign(a.foco.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });

    const gw = g.offsetWidth, gh = g.offsetHeight;
    // Dónde cabe el globo: a la derecha, debajo, encima o a la izquierda.
    const lados = [
      { lado: 'derecha', x: f.x + f.w + SEP, y: f.y + f.h / 2 - gh / 2, cabe: f.x + f.w + SEP + gw < vw - 8 },
      { lado: 'abajo', x: f.x + f.w / 2 - gw / 2, y: f.y + f.h + SEP, cabe: f.y + f.h + SEP + gh < vh - 8 },
      { lado: 'arriba', x: f.x + f.w / 2 - gw / 2, y: f.y - SEP - gh, cabe: f.y - SEP - gh > 8 },
      { lado: 'izquierda', x: f.x - SEP - gw, y: f.y + f.h / 2 - gh / 2, cabe: f.x - SEP - gw > 8 },
    ];
    const elegido = lados.find(l => l.cabe) || { lado: 'centro', x: (vw - gw) / 2, y: vh - gh - 16 };
    g.style.left = `${Math.round(Math.min(Math.max(12, elegido.x), vw - gw - 12))}px`;
    g.style.top = `${Math.round(Math.min(Math.max(12, elegido.y), vh - gh - 12))}px`;
    g.dataset.lado = elegido.lado;
  }

  function soltarMenu() {
    const m = document.getElementById('menu');
    if (m) m.classList.remove('tc-recorrido-abierto');
  }

  function acabar(como) {
    const a = activo;
    if (!a) return;
    activo = null;
    soltarMenu();
    document.documentElement.classList.remove('tc-recorriendo');
    document.removeEventListener('keydown', teclas, true);
    removeEventListener('resize', recolocar);
    removeEventListener('scroll', recolocar, true);
    a.capa.remove(); a.foco.remove(); a.globo.remove();
    if (a.volver && a.volver.focus && a.volver.isConnected) a.volver.focus({ preventScroll: true });
    if (typeof a.alAcabar === 'function') { try { a.alAcabar(como); } catch (e) { /* nada */ } }
  }

  global.Recorrido = { empezar, acabar: () => acabar('saltado'), enMarcha: () => !!activo };
})(window);
