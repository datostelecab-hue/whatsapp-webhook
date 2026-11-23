// ============================================================
// PORTAL · MI COCHE — el mapa en vivo y las cinco fotos (23/11/2026)
// ============================================================
// Sin esto la página funciona igual (formularios normales); con esto:
//   · «Ver ubicación en vivo»: el mapa (MapLibre + OpenFreeMap, como el mapa de
//     flota del ERP) y el estado del coche, refrescados cada 15 s mientras está
//     abierto y la pestaña se ve (GET /coche/vivo).
//   · Las fotos: se ve cada una al hacerla y, al enviar, se ALIGERAN en el móvil
//     (1600 px, JPEG) para no gastar datos ni esperar: una foto del móvil pesa
//     3-6 MB y aquí van cinco. Si el navegador no puede, van tal cual.
(function () {
  'use strict';

  // ── En vivo ────────────────────────────────────────────────────────────────
  const vivo = document.querySelector('[data-vivo]');
  if (vivo) {
    const boton = vivo.querySelector('[data-vivo-abrir]');
    const cuerpo = vivo.querySelector('[data-vivo-cuerpo]');
    const lista = vivo.querySelector('[data-vivo-estado]');
    const caja = vivo.querySelector('[data-vivo-mapa]');
    const pie = vivo.querySelector('[data-vivo-pie]');
    let mapa = null, marca = null, reloj = null, abierto = false;
    boton.hidden = false;

    const pintarEstado = d => {
      lista.innerHTML = '';
      (d.lineas || [d.sinDatos ? 'Ahora mismo no hay datos de este coche.' : 'No se ha podido saber dónde está.']).forEach((t, i) => {
        const li = document.createElement('li');
        li.textContent = t;
        if (i === 0) li.className = 'vivo-principal vivo-' + (d.tono || 'gris');
        lista.appendChild(li);
      });
      pie.textContent = d.posicion || '';
    };

    const ponerEnMapa = d => {
      if (d.lat == null || d.lng == null || !window.maplibregl) { caja.hidden = true; return; }
      caja.hidden = false;
      const punto = [d.lng, d.lat];
      if (!mapa) {
        mapa = new window.maplibregl.Map({
          container: caja, style: 'https://tiles.openfreemap.org/styles/liberty',
          center: punto, zoom: 15, attributionControl: { compact: true },
          // En el móvil, un dedo baja la página y dos mueven el mapa: si no, el
          // mapa se «traga» el scroll y no se llega a las fotos de abajo.
          cooperativeGestures: true,
        });
        mapa.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        const el = document.createElement('div');
        el.className = 'vivo-marca';
        marca = new window.maplibregl.Marker({ element: el }).setLngLat(punto).addTo(mapa);
      } else {
        marca.setLngLat(punto);
        mapa.easeTo({ center: punto, duration: 600 });
      }
      marca.getElement().className = 'vivo-marca' + (d.rueda ? ' vivo-marca--rueda' : '');
    };

    const traer = async () => {
      if (!abierto || document.hidden) return;
      try {
        const r = await fetch('/coche/vivo', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        const d = await r.json();
        pintarEstado(d);
        ponerEnMapa(d);
      } catch (_) {
        pintarEstado({ lineas: ['Sin conexión: se vuelve a intentar en unos segundos.'], tono: 'gris' });
      }
    };

    boton.addEventListener('click', () => {
      abierto = !abierto;
      cuerpo.hidden = !abierto;
      boton.setAttribute('aria-expanded', String(abierto));
      boton.lastChild.textContent = abierto ? ' Ocultar ubicación' : ' Ver ubicación en vivo';
      clearInterval(reloj);
      if (abierto) { traer(); reloj = setInterval(traer, 15000); if (mapa) setTimeout(() => mapa.resize(), 50); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) traer(); });
  }

  // ── Las cinco fotos ────────────────────────────────────────────────────────
  const form = document.querySelector('[data-fotos-form]');
  if (!form) return;

  form.querySelectorAll('input[type=file]').forEach(input => {
    input.addEventListener('change', () => {
      const campo = input.closest('.foto-campo');
      const mini = campo.querySelector('[data-foto-mini]');
      const estado = campo.querySelector('[data-foto-estado]');
      const f = input.files && input.files[0];
      if (!f) { mini.hidden = true; estado.textContent = 'Pulsa para hacer la foto'; campo.classList.remove('foto-hecha'); return; }
      mini.src = URL.createObjectURL(f);
      mini.hidden = false;
      estado.textContent = 'Hecha. Pulsa para repetirla';
      campo.classList.add('foto-hecha');
    });
  });

  /** Una foto aligerada: como mucho 1600 px de lado, en JPEG. null si no se puede. */
  async function aligerar(f) {
    if (!/^image\//.test(f.type) || !window.createImageBitmap || !window.DataTransfer) return null;
    const img = await createImageBitmap(f);
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob || blob.size >= f.size) return null;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  let enviando = false;
  form.addEventListener('submit', async ev => {
    if (enviando) return;
    ev.preventDefault();
    const boton = form.querySelector('[data-fotos-enviar]');
    const aviso = form.querySelector('[data-fotos-aviso]');
    boton.disabled = true;
    aviso.hidden = false;
    aviso.textContent = 'Preparando las fotos…';
    for (const input of form.querySelectorAll('input[type=file]')) {
      const f = input.files && input.files[0];
      if (!f) continue;
      try {
        const ligera = await aligerar(f);
        if (ligera) { const dt = new DataTransfer(); dt.items.add(ligera); input.files = dt.files; }
      } catch (_) { /* va la original */ }
    }
    aviso.textContent = 'Subiendo las fotos y desvinculando…';
    enviando = true;
    form.submit();
  });
})();
