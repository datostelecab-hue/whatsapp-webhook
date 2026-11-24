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

  const inputs = [...form.querySelectorAll('input[type=file]')];
  const campos = inputs.map(i => i.closest('.foto-campo'));
  const etiquetas = campos.map(c => c.querySelector('b').textContent);
  // La imagen de referencia de cada foto (24/11/2026): se ve en la casilla y en la cámara.
  const guias = campos.map(c => c.dataset.guia || '');

  /** Pinta una casilla según tenga foto o no. */
  function pintarCasilla(i) {
    const campo = campos[i];
    const mini = campo.querySelector('[data-foto-mini]');
    const estado = campo.querySelector('[data-foto-estado]');
    const f = inputs[i].files && inputs[i].files[0];
    if (!f) { mini.hidden = true; estado.textContent = 'Pulsa para hacer la foto'; campo.classList.remove('foto-hecha'); return; }
    mini.src = URL.createObjectURL(f);
    mini.hidden = false;
    estado.textContent = 'Hecha. Pulsa para repetirla';
    campo.classList.add('foto-hecha');
  }
  inputs.forEach((input, i) => input.addEventListener('change', () => { pintarCasilla(i); pintarPack(); }));

  // ── EL PACK: las cinco seguidas con la cámara de la app (23/11/2026) ───────
  // Camilo: «un solo botón para subir 5 fotos, sin tener que salir una por una
  // (…) abra su cámara y pueda tomar las 5 fotos de una vez, como un "pack"».
  // La cámara del navegador (getUserMedia), a pantalla completa, diciendo cuál
  // toca; cada foto se mete en su casilla (y se ve), y se puede repetir
  // cualquiera tocando su miniatura. Sin cámara desde el navegador (o si se
  // niega el permiso), las cinco casillas de siempre.
  const pack = form.querySelector('[data-pack]');
  const cam = document.querySelector('[data-cam]');
  const hayCamara = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.DataTransfer && cam);
  const hechas = () => inputs.filter(i => i.files && i.files[0]).length;
  function pintarPack() {
    if (!pack) return;
    const n = hechas();
    pack.querySelector('[data-pack-texto]').textContent =
      n === 0 ? 'Hacer las 5 fotos' : n < inputs.length ? `Seguir con las fotos (${n} de ${inputs.length})` : 'Repetir las fotos';
    pack.classList.toggle('boton-claro', n === inputs.length);
  }

  if (hayCamara) {
    const video = cam.querySelector('[data-cam-video]');
    const lienzo = cam.querySelector('[data-cam-lienzo]');
    const ref = cam.querySelector('[data-cam-ref]');
    const tit = cam.querySelector('[data-cam-tit]');
    const error = cam.querySelector('[data-cam-error]');
    const disparo = cam.querySelector('[data-cam-disparo]');
    const listo = cam.querySelector('[data-cam-listo]');
    const tira = [...cam.querySelectorAll('[data-cam-ir]')];
    let flujo = null, actual = 0;

    form.classList.add('con-camara');
    pack.hidden = false;
    pintarPack();

    const pintarCam = () => {
      ref.src = guias[actual];
      tit.textContent = etiquetas[actual];
      tira.forEach((b, i) => {
        const f = inputs[i].files && inputs[i].files[0];
        b.classList.toggle('cam-hecha', !!f);
        b.classList.toggle('cam-actual', i === actual);
        // Hecha: la foto; si no, su imagen de referencia.
        b.style.backgroundImage = `url("${f ? URL.createObjectURL(f) : guias[i]}")`;
      });
      listo.hidden = hechas() < inputs.length;
    };

    async function abrir(desde) {
      actual = desde != null ? desde : Math.max(0, inputs.findIndex(i => !(i.files && i.files[0])));
      cam.hidden = false;
      document.body.classList.add('con-cam');
      error.hidden = true;
      pintarCam();
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        video.srcObject = flujo;
        await video.play().catch(() => {});
        disparo.disabled = false;
      } catch (e) {
        // Sin permiso o sin cámara: se dice POR QUÉ (24/11/2026), y quedan las
        // casillas de siempre.
        disparo.disabled = true;
        error.hidden = false;
        const casillas = 'o cierra y haz las fotos una a una en las casillas.';
        const nombre = e && e.name;
        error.textContent = nombre === 'NotAllowedError' || nombre === 'SecurityError'
          ? `No has dado permiso para usar la cámara. Permítelo en el candado de la barra de direcciones y vuelve a abrirla, ${casillas}`
          : nombre === 'NotFoundError' || nombre === 'OverconstrainedError'
            ? `No encuentro la cámara de este móvil: ${casillas.replace(/^o /, '')}`
            : nombre === 'NotReadableError'
              ? `La cámara la está usando otra aplicación. Ciérrala y vuelve a abrirla, ${casillas}`
              : `No se puede abrir la cámara desde aquí. Si abriste el portal desde WhatsApp o el correo, ábrelo en Chrome o Safari, ${casillas}`;
      }
    }
    function cerrar() {
      if (flujo) flujo.getTracks().forEach(t => t.stop());
      flujo = null;
      video.srcObject = null;
      cam.hidden = true;
      document.body.classList.remove('con-cam');
      pintarPack();
    }

    disparo.addEventListener('click', async () => {
      if (!flujo || !video.videoWidth) return;
      disparo.disabled = true;
      // Como mucho 1600 px de lado, en JPEG: ligera desde el principio.
      const escala = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      lienzo.width = Math.round(video.videoWidth * escala);
      lienzo.height = Math.round(video.videoHeight * escala);
      lienzo.getContext('2d').drawImage(video, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', 0.85));
      disparo.disabled = false;
      if (!blob) return;
      const dt = new DataTransfer();
      dt.items.add(new File([blob], `foto-${actual + 1}.jpg`, { type: 'image/jpeg' }));
      inputs[actual].files = dt.files;
      pintarCasilla(actual);
      cam.classList.remove('cam-flash'); void cam.offsetWidth; cam.classList.add('cam-flash');
      // A la siguiente que falte; si ya están las cinco, se queda y sale «Listo».
      const falta = inputs.findIndex(i => !(i.files && i.files[0]));
      if (falta >= 0) actual = falta;
      pintarCam();
    });
    tira.forEach((b, i) => b.addEventListener('click', () => { actual = i; pintarCam(); }));
    listo.addEventListener('click', cerrar);
    cam.querySelector('[data-cam-cerrar]').addEventListener('click', cerrar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !cam.hidden) cerrar(); });
    pack.addEventListener('click', () => abrir(hechas() === inputs.length ? 0 : null));
    // Tocar una casilla también abre la cámara, en esa foto.
    campos.forEach((c, i) => c.addEventListener('click', ev => { ev.preventDefault(); abrir(i); }));
  }

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
