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
//   · PEGAR UNA IMAGEN (26/10/2026, Camilo: «que sea solo poner encima el cursor
//     y pegar la imagen que traigo»): con el cursor encima de la foto, Ctrl+V
//     guarda la imagen que haya en el portapapeles, igual que la cámara. Solo si
//     lo pegado es una imagen: pegar texto en una casilla no se toca. Al pasar
//     el ratón se dice («Pega con Ctrl+V»).
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

  // Las fotos pintadas con permiso, para saber a cuál va un Ctrl+V: a la que
  // tenga el cursor encima. Una sola escucha del pegado para toda la página.
  const conPermiso = new Map();   // hueco → { opc, guardar }
  let escuchandoPegar = false;

  /** La primera imagen del portapapeles de un evento de pegar, o null. */
  function imagenPegada(e) {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile();
    }
    return null;
  }

  function escucharPegar() {
    if (escuchandoPegar) return;
    escuchandoPegar = true;
    document.addEventListener('paste', e => {
      let destino = null;
      for (const [hueco, x] of conPermiso) {
        if (!hueco.isConnected) { conPermiso.delete(hueco); continue; }
        const cuadro = hueco.querySelector('[data-cuadro-foto]');
        if (cuadro && cuadro.matches(':hover')) destino = x;
      }
      if (!destino) return;
      const archivo = imagenPegada(e);
      // Si no es una imagen (texto, por ejemplo), el pegado sigue su camino.
      if (!archivo) return;
      e.preventDefault();
      destino.guardar(archivo);
    });
  }

  function pintar(hueco, o) {
    const opc = o || {};
    const titulo = opc.fotoId ? 'Cambiar la foto' : 'Subir una foto';
    hueco.innerHTML = `
      <div class="relative w-24 h-24 group" data-cuadro-foto
           ${opc.puede ? `title="${titulo}: pulsa la cámara, o pega una imagen (Ctrl+V) con el cursor encima"` : ''}>
        <div class="w-24 h-24 rounded-3xl overflow-hidden border border-telecab-border bg-telecab-card2 text-telecab-muted/50">
          ${opc.fotoId
            ? `<img src="${esc(opc.url)}?v=${esc(opc.fotoId)}" alt="Foto de ${esc(opc.nombre || '')}"
                    class="w-full h-full object-cover" data-foto>`
            : hueco_silueta('Sin foto')}
        </div>
        ${opc.puede ? `<div data-pista-pegar aria-hidden="true"
                   class="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-3xl bg-black/60 text-white
                          text-[10px] leading-tight text-center py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                 Pega con Ctrl+V</div>
               <button type="button" data-cambiar-foto
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

    if (!opc.puede) { conPermiso.delete(hueco); return; }
    const boton = hueco.querySelector('[data-cambiar-foto]');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    boton.addEventListener('click', () => input.click());

    // La cámara y el Ctrl+V guardan igual: reducida y por la misma URL.
    let guardando = false;
    async function guardar(archivo) {
      if (!archivo || guardando) return;
      guardando = true;
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
    }
    input.addEventListener('change', () => guardar(input.files && input.files[0]));
    conPermiso.set(hueco, { opc, guardar });
    escucharPegar();
  }

  global.FotoPersona = { pintar, reducir, _imagenPegada: imagenPegada };
})(window);
