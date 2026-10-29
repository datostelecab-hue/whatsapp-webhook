// ============================================================
// HORAS Y MINUTOS — el campo de las horas que se justifican (29/10/2026)
// ============================================================
// Camilo: «que en justificaciones se puedan elegir las horas y los minutos en vez
// de inputarlos por números decimales: 0 h 30 m = 0,5 h justificadas en bitácora
// y en nóminas. Es para no complicarle la vida al que lo pone haciéndolo calcular
// a él el número exacto que debe de poner».
//
// Dos casillas, horas y minutos, y al lado lo que da en decimal («= 1,33 h»), que
// es como lo cuentan la bitácora y las nóminas. Lo que sale de aquí son HORAS en
// decimal y sin redondear (1 h 20 min → 80/60): el servidor lo guarda en segundos
// (`Math.round(h * 3600)`) y 1 h 20 min queda en 4.800 s justos.
//
//   HorasMin.html({ id, minutos, clase })  → el HTML (cadena); `minutos` = lo que trae puesto
//   HorasMin.leer(el)                      → { vacio, minutos, horas, error }
//   HorasMin.poner(el, minutos)            → lo rellena (null = en blanco)
//   HorasMin.texto(minutos)                → «1 h 20 min»
//   HorasMin.deHoras(7.5)                  → 450 (minutos), para lo que venga en decimal
//
// `horas` es una cadena: '' si las dos casillas están en blanco (una J sin horas,
// como hasta ahora) y si no, el decimal («0.5»). Así `v.horas || ''` sigue
// distinguiendo «sin horas» de «0 h».
//
// El «= x h» se repinta al escribir con un solo oyente para toda la página
// (delegado en `document`): vale para lo que se pinte después sin enganchar nada.
(function (global) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

  const deHoras = h => {
    const n = Number(String(h == null ? '' : h).trim().replace(',', '.'));
    return String(h == null ? '' : h).trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 60);
  };

  function texto(minutos) {
    if (minutos == null) return '';
    const h = Math.floor(minutos / 60), m = Math.round(minutos - h * 60);
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
  }

  function html({ id, minutos = null, clase = '' } = {}) {
    const h = minutos == null ? '' : Math.floor(minutos / 60);
    const m = minutos == null ? '' : Math.round(minutos - Math.floor(minutos / 60) * 60);
    const casilla = (dato, valor, max, paso, nombre) =>
      `<input data-hm-${dato} type="number" inputmode="numeric" min="0" max="${max}" step="${paso}" value="${valor}"
         placeholder="0" aria-label="${nombre}" class="w-20 text-right tabular-nums ${esc(clase)}">`;
    return `<div data-hm${id ? ` id="${esc(id)}"` : ''} class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        ${casilla('h', h, 24, 1, 'Horas')}<span class="text-sm text-telecab-muted">h</span>
        ${casilla('m', m, 59, 5, 'Minutos')}<span class="text-sm text-telecab-muted">min</span>
        <span data-hm-eq class="text-xs tabular-nums ml-1">${eq(minutos)}</span>
      </div>`;
  }

  // Lo de al lado: en decimal, como sale en la bitácora y en las nóminas.
  function eq(minutos, error) {
    if (error) return `<span class="text-telecab-red">${esc(error)}</span>`;
    if (minutos == null) return '<span class="text-telecab-muted">sin horas</span>';
    return `<span class="text-telecab-muted">=</span> <b class="text-telecab-text font-semibold">${nf.format(minutos / 60)} h</b>`;
  }

  const caja = el => (!el ? null : el.matches('[data-hm]') ? el : el.querySelector('[data-hm]'));

  function leer(el) {
    const c = caja(el);
    if (!c) return { vacio: true, minutos: null, horas: '', error: '' };
    const ih = c.querySelector('[data-hm-h]'), im = c.querySelector('[data-hm-m]');
    // Un número a medio escribir («7,») o letras: el navegador da '' y lo marca.
    if ((ih.validity && ih.validity.badInput) || (im.validity && im.validity.badInput)) {
      return { vacio: false, minutos: null, horas: '', error: 'Solo números en las horas y los minutos.' };
    }
    const th = ih.value.trim(), tm = im.value.trim();
    if (th === '' && tm === '') return { vacio: true, minutos: null, horas: '', error: '' };
    // Las horas admiten decimales («7,5») por costumbre; los minutos, enteros.
    const h = th === '' ? 0 : Number(th.replace(',', '.'));
    const m = tm === '' ? 0 : Number(tm.replace(',', '.'));
    let error = '';
    if (!Number.isFinite(h) || !Number.isFinite(m)) error = 'Solo números en las horas y los minutos.';
    else if (h < 0 || m < 0) error = 'Ni las horas ni los minutos pueden ser negativos.';
    else if (m > 59) error = 'Los minutos van de 0 a 59.';
    else if (!Number.isInteger(m)) error = 'Los minutos, sin decimales.';
    else if (h * 60 + m > 24 * 60) error = 'No se pueden justificar más de 24 h en un día.';
    if (error) return { vacio: false, minutos: null, horas: '', error };
    const minutos = h * 60 + m;
    return { vacio: false, minutos, horas: String(minutos / 60), error: '' };
  }

  function pintar(c) {
    const r = leer(c);
    const sitio = c.querySelector('[data-hm-eq]');
    if (sitio) sitio.innerHTML = eq(r.minutos, r.error);
  }

  function poner(el, minutos) {
    const c = caja(el);
    if (!c) return;
    const h = minutos == null ? '' : Math.floor(minutos / 60);
    c.querySelector('[data-hm-h]').value = h;
    c.querySelector('[data-hm-m]').value = minutos == null ? '' : Math.round(minutos - h * 60);
    pintar(c);
  }

  document.addEventListener('input', e => {
    const c = e.target && e.target.closest && e.target.closest('[data-hm]');
    if (c) pintar(c);
  });

  global.HorasMin = { html, leer, poner, texto, deHoras };
})(window);
