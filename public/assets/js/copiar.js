// ============================================================
// COPIAR — el cuadrito para copiar un dato (15/10/2026)
// ============================================================
// Camilo: «en control necesito que los nombres se puedan copiar directamente, el
// teléfono y la matrícula … control no deja, abre directamente las observaciones
// del conductor, déjales el cuadrito de pegado al lado».
//
// En una fila que se abre al pulsarla (En directo) no se puede seleccionar el
// texto: el clic abre la fila. Así que al lado del dato va un botón pequeño que lo
// copia. Es un <button>, y las filas ya ignoran los clics que caen en un botón.
//
//   Copiar.boton(texto, titulo)   → el HTML del botón (cadena)
//
// Basta con pintar el botón: el clic se escucha una sola vez para toda la
// página (delegado en `document`), así que sirve también para lo que se pinta
// después, sin volver a enganchar nada.
(function (global) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function boton(texto, titulo) {
    const t = String(texto == null ? '' : texto).trim();
    if (!t) return '';
    return '<button type="button" data-copiar="' + esc(t) + '" title="' + esc(titulo || 'Copiar') + '" ' +
      'aria-label="' + esc(titulo || 'Copiar') + '" ' +
      'class="tc-copiar shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-telecab-muted ' +
      'hover:text-telecab-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-telecab-gold">' +
      '<i class="fa-regular fa-copy text-[11px]"></i></button>';
  }

  // El portapapeles moderno pide https (o localhost); si no, el de siempre.
  async function copiar(texto) {
    if (navigator.clipboard && global.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }

  // Lo copiado se dice en el propio botón (un visto un momento): con un aviso
  // por cada copia, copiar tres datos seguidos llenaría la pantalla.
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-copiar]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      await copiar(b.dataset.copiar);
      const i = b.querySelector('i');
      if (i) {
        i.className = 'fa-solid fa-check text-[11px] text-emerald-500';
        clearTimeout(b._vuelta);
        b._vuelta = setTimeout(() => { i.className = 'fa-regular fa-copy text-[11px]'; }, 1200);
      }
    } catch (err) {
      if (global.Dialogo) global.Dialogo.aviso({ titulo: 'No se pudo copiar', texto: err.message, tono: 'error' });
    }
  }, true);

  global.Copiar = { boton, copiar };
})(window);
