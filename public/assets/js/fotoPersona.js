// ============================================================
// FOTO DE LA PERSONA — el cuadro con la foto o la silueta
// ============================================================
// Lo usan las fichas de Plantilla, de Selección y de la ETT. Estaba escrito
// dentro de Plantilla y al pedirlo en Selección se sacó aquí: tres copias de lo
// mismo envejecen cada una por su lado.
//
// ── LO QUE HACE ────────────────────────────────────────────────────────────
//   · Un cuadrado fijo de 96 px, y la foto SE AJUSTA A ÉL (object-fit: cover):
//     vertical, apaisada o selfie, llena el cuadro sin deformarse.
//   · Sin foto, una SILUETA pintada con los colores del tema (--tc-card2 y
//     --tc-muted): cambia sola entre claro, oscuro y azul, sin una imagen por
//     tema. Si la foto existe pero no carga, también la silueta.
//   · Con permiso, un botón con una cámara en la esquina, SIEMPRE visible: en un
//     móvil no hay ratón para descubrirlo al pasar por encima.
//   · La foto se reduce en el navegador antes de subirla: de los 4-5 MB de un
//     móvil a ~100 KB, con el lado largo a 640 px.
//
// La foto es OPCIONAL en todas partes: no entra en lo que se exige para
// contratar y una ficha sin ella funciona igual.
//
// Uso:
//   FotoPersona.pintar(hueco, {
//     url: '/seleccion/api/candidatura/12/foto',  // GET la sirve, POST la guarda
//     fotoId: '87' | null,                         // el documento vigente, o nada
//     nombre: 'Víctor Jiménez',
//     puede: true,                                 // si se pinta la cámara
//   });
(function (global) {
  'use strict';

  const esc = t => String(t == null ? '' : t)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SILUETA = '<svg viewBox="0 0 64 64" class="w-full h-full" aria-hidden="true">'
    + '<circle cx="32" cy="25" r="12" fill="currentColor"/>'
    + '<path d="M9 64c1.5-14 11.5-22 23-22s21.5 8 23 22z" fill="currentColor"/></svg>';
  const hueco_silueta = titulo => '<div class="w-full h-full px-2 pt-3" title="' + esc(titulo) + '">' + SILUETA + '</div>';

  /**
   * La foto, reducida ANTES de subirla. Devuelve el base64 sin la cabecera
   * "data:". Aquí se ve en un cuadro de 96 px: subir la del móvil tal cual serían
   * cinco megas para nada.
   */
  function reducir(archivo, lado) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(archivo);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, lado / Math.max(im.naturalWidth, im.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(im.naturalWidth * k));
        cv.height = Math.max(1, Math.round(im.naturalHeight * k));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        ok(cv.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      im.onerror = () => {
        URL.revokeObjectURL(url);
        mal(new Error('No se pudo leer esa imagen. Prueba con una foto JPG o PNG.'));
      };
      im.src = url;
    });
  }

  async function mandar(url, base64) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mime: 'image/jpeg' }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.status === 'error') throw new Error((j && j.msg) || 'Error ' + r.status);
    return j;
  }

  function pintar(hueco, o) {
    const opc = o || {};
    const titulo = opc.fotoId ? 'Cambiar la foto' : 'Subir una foto';
    hueco.innerHTML = `
      <div class="relative w-24 h-24">
        <div class="w-24 h-24 rounded-3xl overflow-hidden border border-telecab-border bg-telecab-card2 text-telecab-muted/50">
          ${opc.fotoId
            ? `<img src="${esc(opc.url)}?v=${esc(opc.fotoId)}" alt="Foto de ${esc(opc.nombre || '')}"
                    class="w-full h-full object-cover" data-foto>`
            : hueco_silueta('Sin foto')}
        </div>
        ${opc.puede ? `<button type="button" data-cambiar-foto
                   class="absolute -bottom-2 -right-2 w-9 h-9 rounded-full bg-telecab-gold text-telecab-dark
                          border-2 border-telecab-card shadow-soft flex items-center justify-center text-sm
                          hover:scale-105 transition"
                   title="${titulo}" aria-label="${titulo}">
                 <i class="fa-solid fa-camera"></i></button>` : ''}
      </div>`;

    const img = hueco.querySelector('[data-foto]');
    if (img) img.addEventListener('error', () => {
      img.parentElement.innerHTML = hueco_silueta('No se pudo cargar la foto');
    }, { once: true });

    if (!opc.puede) return;
    const boton = hueco.querySelector('[data-cambiar-foto]');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    boton.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const archivo = input.files && input.files[0];
      if (!archivo) return;
      boton.disabled = true;
      boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      try {
        const r = await mandar(opc.url, await reducir(archivo, 640));
        opc.fotoId = r.fotoId;
        if (typeof opc.alGuardar === 'function') opc.alGuardar(r.fotoId);
        pintar(hueco, opc);
        if (global.Dialogo && global.Dialogo.hecho) global.Dialogo.hecho('Foto guardada');
      } catch (e) {
        if (global.Dialogo) await global.Dialogo.aviso({ titulo: 'No se pudo guardar la foto', texto: e.message, tono: 'error' });
        pintar(hueco, opc);
      }
    });
  }

  global.FotoPersona = { pintar, reducir };
})(window);
