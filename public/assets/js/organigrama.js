// ============================================================
// ORGANIGRAMA — los puestos en árbol, y la gente que se arrastra (db/255)
// ============================================================
// Pieza global de la casa (17/11/2026), con las clases .tc-org* de telecab.css.
// Camilo: «¿se puede hacer un organigrama con los usuarios? Que sea gráfico y
// se arrastren». La organización va por PUESTOS (db/255): cada puesto cuelga
// del puesto al que reporta, y dentro de cada puesto, las personas que lo
// ocupan. Arrastrar a una persona a otro puesto se lo cambia (y con él su área,
// su superior y sus funciones).
//
//   const org = Organigrama.montar(caja, {
//     alSoltar: async ({ persona, desde, hacia }) => …,   // hacia: código del puesto, o null (sin puesto)
//     alAbrir: persona => …,                              // pulsar a una persona
//   });
//   org.pintar({ puestos, sinPuesto });
//     puestos:   [{ codigo, nombre, reportaA, area, areaEtiqueta, dirige: [], funciones: [{ etiqueta }], ocupan: [{ id, nombre }] }]
//     sinPuesto: [{ id, nombre }]
//
// · Los hijos de cada puesto se AGRUPAN POR ÁREA: RR. HH. sale como un bloque
//   con sus cuatro puestos, no como cuatro ramas. Cada área, con su color
//   (--tc-area-<código>).
// · Arrastrar es un atajo: con el teclado o en el móvil (donde no se arrastra),
//   pulsar a la persona abre su ficha, que tiene «Cambiar el puesto».
// · Más grande o más pequeño (− / + / Ajustar a lo ancho); se recuerda en este
//   navegador.
(function (global) {
  'use strict';
  const esc = s => global.Casa.esc(s);
  const LS = 'telecab-organigrama-zoom';
  const iniciales = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x.charAt(0)).join('').toUpperCase() || '·';
  const leerZoom = () => { try { const z = Number(localStorage.getItem(LS)); return z >= 0.4 && z <= 1.5 ? z : 1; } catch (e) { return 1; } };
  const guardarZoom = z => { try { localStorage.setItem(LS, String(z)); } catch (e) { /* sin almacenamiento */ } };

  function persona(p, puesto) {
    return `<button type="button" class="tc-org-persona" draggable="true" data-persona="${esc(p.id)}" data-desde="${esc(puesto || '')}"
        title="Arrastra para cambiarle el puesto · pulsa para abrir su ficha">
        <span class="tc-avatar tc-avatar--chico" aria-hidden="true">${esc(iniciales(p.nombre))}</span>
        <span class="tc-org-nombre">${esc(p.nombre)}</span>
      </button>`;
  }

  function tarjeta(p) {
    const fs = p.funciones || [];
    return `<section class="tc-org-puesto ${p.ocupan.length ? '' : 'tc-org-puesto--vacante'}" data-puesto="${esc(p.codigo)}"
        aria-label="Puesto ${esc(p.nombre)}">
        <header class="tc-org-cabeza">
          <h4>${esc(p.nombre)}</h4>
          ${(p.dirige || []).length ? `<span class="tc-pastilla tc-pastilla--oro" title="Dirige ${esc(p.dirige.join(', '))}">Dirige</span>` : ''}
        </header>
        <div class="tc-org-gente">
          ${p.ocupan.map(x => persona(x, p.codigo)).join('') || '<span class="tc-org-vacio">Vacante</span>'}
        </div>
        ${fs.length ? `<footer class="tc-org-pie" title="${esc(fs.map(f => f.etiqueta + (f.suplente ? ' (suplente)' : '')).join('\n'))}">
          <i class="fa-solid fa-list-check" aria-hidden="true"></i>${fs.length} ${fs.length === 1 ? 'función' : 'funciones'}</footer>` : ''}
      </section>`;
  }

  function montar(caja, { alSoltar, alAbrir } = {}) {
    let zoom = leerZoom();
    caja.classList.add('tc-org');
    caja.innerHTML = `
      <div class="tc-org-barra">
        <p class="tc-org-ayuda"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>Arrastra a una persona a otro puesto para cambiárselo. Pulsa su nombre para abrir su ficha.</p>
        <div class="tc-org-zoom" role="group" aria-label="Tamaño del organigrama">
          <button type="button" class="tc-boton tc-boton--chico" data-zoom="-" aria-label="Más pequeño"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
          <span class="tc-org-zoom-valor" data-zoom-valor></span>
          <button type="button" class="tc-boton tc-boton--chico" data-zoom="+" aria-label="Más grande"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
          <button type="button" class="tc-boton tc-boton--chico" data-zoom="ajustar"><i class="fa-solid fa-expand" aria-hidden="true"></i>Ajustar</button>
        </div>
      </div>
      <section class="tc-org-sin" data-sin-puesto aria-label="Sin puesto">
        <h4>Sin puesto</h4>
        <div class="tc-org-gente" data-sin-gente></div>
      </section>
      <div class="tc-org-marco"><div class="tc-org-lienzo" data-lienzo></div></div>`;
    const lienzo = caja.querySelector('[data-lienzo]');
    const marco = caja.querySelector('.tc-org-marco');
    const sinGente = caja.querySelector('[data-sin-gente]');

    function ponerZoom(z) {
      zoom = Math.min(1.5, Math.max(0.4, Math.round(z * 100) / 100));
      lienzo.style.zoom = String(zoom);
      caja.querySelector('[data-zoom-valor]').textContent = `${Math.round(zoom * 100)} %`;
      guardarZoom(zoom);
    }
    function ajustar() {
      lienzo.style.zoom = '1';
      const ancho = lienzo.scrollWidth;
      ponerZoom(ancho ? Math.min(1, (marco.clientWidth - 8) / ancho) : 1);
    }
    caja.querySelector('.tc-org-zoom').addEventListener('click', ev => {
      const b = ev.target.closest('[data-zoom]');
      if (!b) return;
      if (b.dataset.zoom === 'ajustar') ajustar();
      else ponerZoom(zoom + (b.dataset.zoom === '+' ? 0.1 : -0.1));
    });

    function pintar({ puestos = [], sinPuesto = [] } = {}) {
      const codigos = new Set(puestos.map(p => p.codigo));
      const hijos = new Map();
      puestos.forEach(p => {
        const k = p.reportaA && codigos.has(p.reportaA) ? p.reportaA : '';
        if (!hijos.has(k)) hijos.set(k, []);
        hijos.get(k).push(p);
      });
      // Los de un nivel, agrupados por área (en el orden en que llegan).
      const rama = lista => {
        const grupos = new Map();
        lista.forEach(p => { if (!grupos.has(p.area)) grupos.set(p.area, []); grupos.get(p.area).push(p); });
        return `<ul class="tc-org-nivel">${[...grupos.values()].map(g => {
          const debajo = g.flatMap(p => hijos.get(p.codigo) || []);
          return `<li class="tc-org-rama">
              <div class="tc-org-grupo" data-area="${esc(g[0].area)}">
                <span class="tc-org-area">${esc(g[0].areaEtiqueta || g[0].area)}</span>
                ${g.map(tarjeta).join('')}
              </div>
              ${debajo.length ? rama(debajo) : ''}
            </li>`;
        }).join('')}</ul>`;
      };
      lienzo.innerHTML = rama(hijos.get('') || []);
      sinGente.innerHTML = sinPuesto.map(x => persona(x, '')).join('') || '<span class="tc-org-vacio">Todos tienen puesto</span>';
      ponerZoom(zoom);
    }

    // ── Arrastrar ─────────────────────────────────────────────────────────
    let arrastre = null;
    const destino = el => el && el.closest('[data-puesto], [data-sin-puesto]');
    const codigoDe = d => (d.hasAttribute('data-sin-puesto') ? '' : d.dataset.puesto);
    const limpiar = () => {
      caja.querySelectorAll('.tc-org-soltar').forEach(x => x.classList.remove('tc-org-soltar'));
      caja.querySelectorAll('.tc-org-persona--arrastrando').forEach(x => x.classList.remove('tc-org-persona--arrastrando'));
      caja.classList.remove('tc-org--arrastrando');
      arrastre = null;
    };
    caja.addEventListener('dragstart', ev => {
      const p = ev.target.closest('[data-persona]');
      if (!p) return;
      arrastre = { persona: Number(p.dataset.persona), desde: p.dataset.desde || '', nombre: p.querySelector('.tc-org-nombre').textContent };
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(arrastre.persona));
      p.classList.add('tc-org-persona--arrastrando');
      caja.classList.add('tc-org--arrastrando');
    });
    caja.addEventListener('dragover', ev => {
      const d = arrastre && destino(ev.target);
      if (!d || codigoDe(d) === arrastre.desde) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      if (!d.classList.contains('tc-org-soltar')) {
        caja.querySelectorAll('.tc-org-soltar').forEach(x => x.classList.remove('tc-org-soltar'));
        d.classList.add('tc-org-soltar');
      }
    });
    caja.addEventListener('dragleave', ev => {
      const d = destino(ev.target);
      if (d && !d.contains(ev.relatedTarget)) d.classList.remove('tc-org-soltar');
    });
    caja.addEventListener('drop', async ev => {
      const d = arrastre && destino(ev.target);
      if (!d) return;
      ev.preventDefault();
      const hacia = codigoDe(d);
      const a = arrastre;
      limpiar();
      if (hacia === a.desde || typeof alSoltar !== 'function') return;
      await alSoltar({ persona: a.persona, nombre: a.nombre, desde: a.desde || null, hacia: hacia || null });
    });
    caja.addEventListener('dragend', limpiar);
    caja.addEventListener('click', ev => {
      const p = ev.target.closest('[data-persona]');
      if (p && typeof alAbrir === 'function') alAbrir(Number(p.dataset.persona));
    });

    return { pintar, ajustar };
  }

  global.Organigrama = { montar };
})(window);
