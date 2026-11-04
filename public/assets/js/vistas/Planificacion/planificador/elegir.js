// El planificador · elegir — Los selectores de conductor y de coche (modal con búsqueda).
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── Selector de conductor (modal con búsqueda) ────────────────────────────
  // `ficha` es la persona de la que va el clic (la de la plaza, o a quien se
  // cubre): arriba del todo sale su nombre con «Ver su ficha», que abre su
  // ficha de Plantilla en otra pestaña para que el cuadrante se quede como
  // estaba. Así, pinchar a alguien en el cuadrante siempre deja ver su perfil.
  function pickConductor({ titulo, turno, actual, ficha }) {
    return new Promise(resolve => {
      const fondo = document.createElement('div');
      fondo.className = 'fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto';
      // Elegibles: el banquillo primero, luego el resto de la plantilla del turno.
      const mismoTurno = c => !turno || !c.turnoCodigo || c.turnoCodigo === turno;
      const lista = [...(T.conductores || [])].filter(c => c.id).sort((a, b) =>
        (b.plazas === 0) - (a.plazas === 0) || a.nombre.localeCompare(b.nombre));
      fondo.innerHTML = `
        <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft w-full max-w-md my-8">
          <div class="flex items-center justify-between px-4 py-3 border-b border-telecab-border">
            <h3 class="font-semibold">${esc(titulo)}</h3>
            <button data-x class="w-8 h-8 rounded-lg hover:bg-telecab-card2 text-telecab-muted" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          </div>
          <div class="p-3">
            ${ficha && ficha.id ? `
            <div data-persona class="flex items-center gap-3 mb-3 px-3 py-2 rounded-xl bg-telecab-card2/60 border border-telecab-border">
              <div class="min-w-0 flex-1">
                <div class="text-[11px] text-telecab-muted">${esc(ficha.nota || 'En esta plaza')}</div>
                <div class="text-sm font-semibold truncate">${esc(ficha.nombre || '')}</div>
              </div>
              ${VER_FICHAS ? `<a data-ficha href="${hrefFicha(ficha.id)}" target="_blank" rel="noopener"
                 title="Abre su ficha de Plantilla en otra pestaña: el cuadrante se queda como está."
                 class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-telecab-gold/40 text-telecab-gold text-sm font-semibold hover:bg-telecab-gold/10 transition-colors">
                <i class="fa-solid fa-id-card text-xs"></i>Ver su ficha</a>` : ''}
            </div>` : ''}
            <input data-busca type="search" placeholder="Buscar nombre, DNI, teléfono…" aria-label="Buscar conductor" class="w-full mb-2 px-3 py-2 bg-telecab-card2 border border-telecab-border rounded-lg text-sm">
            ${actual ? '<button data-quitar class="w-full mb-2 px-3 py-2 rounded-lg border border-telecab-red/40 text-telecab-red text-sm hover:bg-telecab-red/10"><i class="fa-solid fa-user-minus"></i> Dejar la plaza vacía</button>' : ''}
            <div data-lista class="space-y-1 max-h-[50vh] overflow-y-auto"></div>
          </div>
        </div>`;
      const cerrar = v => { document.body.removeChild(fondo); resolve(v); };
      fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(undefined); });
      fondo.querySelector('[data-x]').addEventListener('click', () => cerrar(undefined));
      const q = fondo.querySelector('[data-quitar]');
      if (q) q.addEventListener('click', () => cerrar(''));
      // La ficha se abre en otra pestaña y este diálogo se cierra: al volver, el
      // cuadrante está como se dejó. Se cierra un instante después y no en el
      // propio clic, porque un enlace que se quita de la página mientras se
      // pulsa ya no navega.
      const fi = fondo.querySelector('[data-ficha]');
      if (fi) fi.addEventListener('click', () => setTimeout(() => cerrar(undefined), 0));

      const cont = fondo.querySelector('[data-lista]');
      const pinta = () => {
        const txt = (fondo.querySelector('[data-busca]').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const vis = lista.filter(c => {
          const t = (c.nombre + ' ' + (c.dni || '') + ' ' + (c.telefono || '') + ' ' + (c.barrio || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return t.includes(txt);
        });
        cont.innerHTML = vis.slice(0, 80).map(c => `
          <button data-id="${esc(c.id)}" class="w-full text-left px-3 py-2 rounded-lg border transition
                  ${String(c.id) === String(actual) ? 'border-telecab-gold bg-telecab-gold/10' : 'border-telecab-border hover:bg-telecab-card2'}
                  ${!mismoTurno(c) ? 'opacity-60' : ''}">
            <div class="text-sm font-medium">${esc(c.nombre)}${c.esEtt ? ' <span class="text-telecab-violet text-xs">ETT</span>' : ''}</div>
            <div class="text-[11px] text-telecab-muted">${c.telefono ? `<span class="font-mono tabular-nums">${esc(c.telefono)}</span> · ` : ''}${esc(c.turno || 'sin turno')}${c.plazas ? ' · ya colocado' : ' · banquillo'}${!mismoTurno(c) ? ' · otro turno' : ''}${c.barrio ? ' · ' + esc(c.barrio) : ''}</div>
          </button>`).join('') || '<p class="text-xs text-telecab-muted text-center py-4">Nadie coincide.</p>';
        cont.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => cerrar(b.dataset.id)));
      };
      fondo.querySelector('[data-busca]').addEventListener('input', pinta);
      document.body.appendChild(fondo);
      pinta();
      fondo.querySelector('[data-busca]').focus();
    });
  }

  function pickCoche({ titulo, coches }) {
    return new Promise(resolve => {
      const fondo = document.createElement('div');
      fondo.className = 'fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto';
      fondo.innerHTML = `
        <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft w-full max-w-md my-8">
          <div class="flex items-center justify-between px-4 py-3 border-b border-telecab-border">
            <h3 class="font-semibold">${esc(titulo)}</h3>
            <button data-x class="w-8 h-8 rounded-lg hover:bg-telecab-card2 text-telecab-muted" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          </div>
          <div class="p-3">
            <input data-busca type="search" placeholder="Buscar matrícula, zona…" aria-label="Buscar coche" class="w-full mb-2 px-3 py-2 bg-telecab-card2 border border-telecab-border rounded-lg text-sm">
            <div data-lista class="space-y-1 max-h-[50vh] overflow-y-auto"></div>
          </div>
        </div>`;
      const cerrar = v => { document.body.removeChild(fondo); resolve(v); };
      fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(null); });
      fondo.querySelector('[data-x]').addEventListener('click', () => cerrar(null));
      const cont = fondo.querySelector('[data-lista]');
      const pinta = () => {
        const q = (fondo.querySelector('[data-busca]').value || '').toLowerCase();
        const vis = coches.filter(c => `${c.matricula} ${c.zona || ''}`.toLowerCase().includes(q));
        cont.innerHTML = vis.slice(0, 100).map(c => `
          <button data-id="${esc(c.vehiculoId)}" class="w-full text-left px-3 py-2 rounded-lg border border-telecab-border hover:bg-telecab-card2 transition">
            <span class="text-sm font-medium">${esc(c.matricula)}</span>${c.zona ? ` <span class="text-[11px] text-telecab-muted">${esc(c.zona)}</span>` : ''}
          </button>`).join('') || '<p class="text-xs text-telecab-muted text-center py-4">Ningún coche coincide.</p>';
        cont.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => cerrar(b.dataset.id)));
      };
      fondo.querySelector('[data-busca]').addEventListener('input', pinta);
      document.body.appendChild(fondo);
      pinta();
      fondo.querySelector('[data-busca]').focus();
    });
  }
