// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  function parse(v) {
    if (!v) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]); }
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  const norm = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  // ── Rango permitido de un campo (validación de fechas) ────────────────────
  // Se declara con atributos en el <input>:
  //   data-min / data-max        → 'today', 'today+3', 'today-2' o una fecha fija.
  //   data-min-field / data-max-field (+ *-offset en días) → otro campo (por
  //     data-campo o id), p. ej. caducidad ≥ expedición+1. El límite efectivo es
  //     el más restrictivo de ambos.
  function resolverLimite(spec) {
    if (!spec) return null;
    const s = String(spec).trim();
    const m = s.match(/^today\s*([+-]\s*\d+)?$/i);
    if (m) { const off = m[1] ? parseInt(m[1].replace(/\s/g, ''), 10) : 0; const d = norm(new Date()); d.setDate(d.getDate() + off); return d; }
    const p = parse(s); return p ? norm(p) : null;
  }
  function limiteCampo(input, cual) {
    const ref = input.getAttribute('data-' + cual + '-field');
    if (!ref) return null;
    const otro = document.querySelector('[data-campo="' + ref + '"], #' + (window.CSS && CSS.escape ? CSS.escape(ref) : ref));
    if (!otro) return null;
    const base = parse(otro.value); if (!base) return null;
    const off = parseInt(input.getAttribute('data-' + cual + '-offset') || '0', 10);
    const d = norm(base); d.setDate(d.getDate() + off); return d;
  }
  function rango(input) {
    if (!input) return { min: null, max: null };
    const mins = [resolverLimite(input.getAttribute('data-min')), limiteCampo(input, 'min')].filter(Boolean);
    const maxs = [resolverLimite(input.getAttribute('data-max')), limiteCampo(input, 'max')].filter(Boolean);
    return {
      min: mins.length ? new Date(Math.max(...mins.map(d => d.getTime()))) : null,
      max: maxs.length ? new Date(Math.min(...maxs.map(d => d.getTime()))) : null
    };
  }
  const fuera = (f, r) => (r.min && f < r.min) || (r.max && f > r.max);
  // Marca en rojo el input si la fecha tecleada queda fuera de su rango.
  function marcarValidez(inp) {
    const d = inp.value.trim() ? parse(inp.value) : null;
    const mal = d && fuera(norm(d), rango(inp));
    inp.classList.toggle('!border-telecab-red', !!mal);
    inp.classList.toggle('ring-1', !!mal);
    inp.classList.toggle('ring-telecab-red', !!mal);
    // El aviso va en el `title` y al corregir la fecha se devuelve el que había
    // (04/11/2026). Antes se borraba el `title` sin más y el campo perdía su
    // ayuda y, si no tenía etiqueta, su nombre. Si ayuda.js lo tiene guardado
    // en ese momento, el bueno es el suyo.
    if (mal) {
      if (inp.dataset.tituloPropio == null) {
        inp.dataset.tituloPropio = (inp.dataset.ayuda != null ? inp.dataset.ayuda : inp.getAttribute('title')) || '';
      }
      const r = rango(inp);
      inp.title = 'Fecha fuera de rango' + (r.min ? ' · desde ' + fmt(r.min) : '') + (r.max ? ' · hasta ' + fmt(r.max) : '');
    } else if (inp.dataset.tituloPropio != null) {
      if (inp.dataset.tituloPropio) inp.title = inp.dataset.tituloPropio; else inp.removeAttribute('title');
      delete inp.dataset.tituloPropio;
    }
  }

  const pop = document.createElement('div');
  pop.className = 'fp-pop hidden fixed z-[120] w-72 rounded-2xl border border-telecab-border bg-telecab-card2 shadow-soft p-3 text-telecab-text select-none';
  document.body.appendChild(pop);
  let target = null, vista = null, modo = 'dias';   // 'dias' | 'meses' | 'anios'

  // El nombre de la flecha según la rejilla: mes, año o tanda de doce años.
  const nombreFlecha = n => modo === 'anios' ? (n < 0 ? 'Años anteriores' : 'Años siguientes')
    : modo === 'meses' ? (n < 0 ? 'Año anterior' : 'Año siguiente')
    : (n < 0 ? 'Mes anterior' : 'Mes siguiente');
  const flecha = n => '<button type="button" data-nav="' + n + '" aria-label="' + nombreFlecha(n) + '" class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card hover:text-telecab-text transition">' + (n < 0 ? '‹' : '›') + '</button>';
  const pie =
    '<div class="flex items-center justify-between mt-3 pt-2 border-t border-telecab-border text-xs">' +
      '<button type="button" data-hoy class="px-2.5 py-1 rounded-lg text-telecab-gold hover:bg-telecab-gold/10 transition">Hoy</button>' +
      '<button type="button" data-borrar class="px-2.5 py-1 rounded-lg text-telecab-muted hover:text-telecab-red transition">Borrar</button>' +
    '</div>';

  function render() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const sel = target ? parse(target.value) : null;
    const y = vista.getFullYear(), mo = vista.getMonth();

    // Vista de años: rejilla de 12 años; las flechas saltan de 12 en 12.
    if (modo === 'anios') {
      const base = Math.floor(y / 12) * 12;
      let celdas = '';
      for (let a = base; a < base + 12; a++) {
        const cls = a === y ? 'bg-telecab-gold text-telecab-dark font-semibold' : 'text-telecab-text hover:bg-telecab-card';
        celdas += `<button type="button" data-anio="${a}" class="h-10 rounded-lg text-sm transition ${cls}">${a}</button>`;
      }
      pop.innerHTML =
        '<div class="flex items-center justify-between mb-2">' + flecha(-1) +
          '<div class="text-sm font-semibold">' + base + ' – ' + (base + 11) + '</div>' + flecha(1) + '</div>' +
        '<div class="grid grid-cols-3 gap-1">' + celdas + '</div>' + pie;
      return;
    }

    // Vista de meses: rejilla de 12 meses; las flechas cambian de año.
    if (modo === 'meses') {
      let celdas = '';
      MESES.forEach((m, i) => {
        const cls = i === mo ? 'bg-telecab-gold text-telecab-dark font-semibold' : 'text-telecab-text hover:bg-telecab-card';
        celdas += `<button type="button" data-mes="${i}" aria-label="${m}" class="h-10 rounded-lg text-sm transition ${cls}">${m.slice(0, 3)}</button>`;
      });
      pop.innerHTML =
        '<div class="flex items-center justify-between mb-2">' + flecha(-1) +
          '<button type="button" data-modo="anios" class="text-sm font-semibold px-2 py-1 rounded-lg hover:bg-telecab-card transition">' + y + '</button>' +
          flecha(1) + '</div>' +
        '<div class="grid grid-cols-3 gap-1">' + celdas + '</div>' + pie;
      return;
    }

    // Vista de días (por defecto). El mes y el año del encabezado abren su rejilla.
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7;
    const total = new Date(y, mo + 1, 0).getDate();
    const r = rango(target);
    let celdas = '';
    for (let i = 0; i < offset; i++) celdas += '<div></div>';
    for (let d = 1; d <= total; d++) {
      const f = new Date(y, mo, d);
      if (fuera(norm(f), r)) { celdas += `<div class="h-9 rounded-lg text-sm flex items-center justify-center text-telecab-muted/25 line-through cursor-not-allowed">${d}</div>`; continue; }
      const esSel = sel && f.getTime() === sel.getTime();
      const esHoy = f.getTime() === hoy.getTime();
      const cls = esSel ? 'bg-telecab-gold text-telecab-dark font-semibold shadow-gold'
        : esHoy ? 'ring-1 ring-telecab-gold/60 text-telecab-gold'
        : 'text-telecab-text hover:bg-telecab-card';
      // El día con su mes y su año: el número solo no dice de cuándo es.
      const nombreDia = `${d} de ${MESES[mo].toLowerCase()} de ${y}` + (esHoy ? ', hoy' : '');
      celdas += `<button type="button" data-d="${d}" aria-label="${nombreDia}"${esSel ? ' aria-current="date"' : ''} class="h-9 rounded-lg text-sm transition ${cls}">${d}</button>`;
    }
    pop.innerHTML =
      '<div class="flex items-center justify-between mb-2">' + flecha(-1) +
        '<div class="flex items-center gap-1">' +
          '<button type="button" data-modo="meses" class="text-sm font-semibold px-2 py-1 rounded-lg hover:bg-telecab-card transition">' + MESES[mo] + '</button>' +
          '<button type="button" data-modo="anios" class="text-sm font-semibold px-2 py-1 rounded-lg hover:bg-telecab-card transition">' + y + '</button>' +
        '</div>' + flecha(1) + '</div>' +
      '<div class="grid grid-cols-7 gap-1 mb-1 text-[11px] font-medium text-telecab-muted text-center">' + DIAS.map(x => '<div>' + x + '</div>').join('') + '</div>' +
      '<div class="grid grid-cols-7 gap-1 text-center">' + celdas + '</div>' + pie;
  }

  function abrir(input) {
    target = input;
    const base = parse(input.value) || new Date();
    vista = new Date(base.getFullYear(), base.getMonth(), 1);
    modo = 'dias';
    render();
    pop.classList.remove('hidden');
    const r = input.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function cerrar() { pop.classList.add('hidden'); target = null; }
  function fijar(fecha) {
    if (!target) return;
    if (fecha && fuera(norm(fecha), rango(target))) return;   // no se fija una fecha fuera de rango
    target.value = fecha ? fmt(fecha) : '';
    marcarValidez(target);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    cerrar();
  }

  pop.addEventListener('mousedown', e => e.preventDefault());  // no robar el foco del input
  pop.addEventListener('click', e => {
    // Sin esto, al navegar de mes render() reemplaza el HTML y saca del DOM el
    // botón pulsado; el detector de "clic fuera" lo ve fuera y cierra el calendario.
    e.stopPropagation();
    const modoBtn = e.target.closest('[data-modo]');
    if (modoBtn) { modo = modoBtn.dataset.modo; render(); return; }
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const paso = Number(nav.dataset.nav);
      if (modo === 'anios') vista.setFullYear(vista.getFullYear() + paso * 12);
      else if (modo === 'meses') vista.setFullYear(vista.getFullYear() + paso);
      else vista = new Date(vista.getFullYear(), vista.getMonth() + paso, 1);
      render(); return;
    }
    const anio = e.target.closest('[data-anio]');
    if (anio) { vista.setFullYear(Number(anio.dataset.anio)); modo = 'dias'; render(); return; }
    const mes = e.target.closest('[data-mes]');
    if (mes) { vista.setMonth(Number(mes.dataset.mes)); modo = 'dias'; render(); return; }
    const day = e.target.closest('[data-d]');
    if (day) { fijar(new Date(vista.getFullYear(), vista.getMonth(), Number(day.dataset.d))); return; }
    if (e.target.closest('[data-hoy]')) { fijar(new Date()); return; }
    if (e.target.closest('[data-borrar]')) { fijar(null); return; }
  });

  document.addEventListener('click', e => {
    if (pop.contains(e.target)) return;
    const inp = e.target.closest('input.js-fecha');
    if (inp) abrir(inp); else cerrar();
  });
  document.addEventListener('focusin', e => {
    const inp = e.target.closest('input.js-fecha');
    // Se puede teclear la fecha a mano (además del calendario): al enfocar se
    // quita el readonly para permitir escribir, y se abre el calendario a juego.
    if (inp) { inp.removeAttribute('readonly'); abrir(inp); }
  });
  // Formateo al teclear: solo dígitos, insertando las barras (dd/mm/aaaa) solo.
  document.addEventListener('input', e => {
    const inp = e.target.closest && e.target.closest('input.js-fecha');
    if (!inp) return;
    let v = inp.value.replace(/\D/g, '').slice(0, 8);
    if (v.length >= 5) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
    else if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    inp.value = v;
    marcarValidez(inp);
    const d = parse(inp.value);
    if (d && target === inp) { vista = new Date(d.getFullYear(), d.getMonth(), 1); render(); }   // el calendario sigue lo tecleado
  });
  // Al salir del campo: formato inválido → se limpia; válido → se normaliza y valida.
  document.addEventListener('focusout', e => {
    const inp = e.target.closest && e.target.closest('input.js-fecha');
    if (!inp) return;
    if (!inp.value.trim()) { marcarValidez(inp); return; }
    const d = parse(inp.value);
    if (!d) { inp.value = ''; marcarValidez(inp); return; }
    inp.value = fmt(d);
    marcarValidez(inp);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrar();
    if (e.key === 'Enter' && e.target.closest && e.target.closest('input.js-fecha')) cerrar();
  });
  window.addEventListener('resize', cerrar);
  window.addEventListener('scroll', () => { if (target) cerrar(); }, true);
})();
