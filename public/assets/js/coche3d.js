// ============================================================
// EL COCHE EN 3D — el resumen del estado de las piezas
// ============================================================
// La pestaña «3D» del bloque «Estado de las piezas» de la ficha del vehículo
// (Camilo, 25/09/2026). No se edita aquí: el 3D RESUME lo que se marca en el
// dibujo 2D. Encima de cada pieza en mal estado sale un punto rojo —fijo si hay
// que arreglarla, parpadeando si hay que cambiarla— y al pasar por encima dice
// qué pieza es y la observación. Pinchar un punto la abre en el editor de al
// lado, como pinchar la pieza en el dibujo.
//
// El coche es un Toyota Corolla sedán hecho en Blender por un script
// (scripts/modelo-coche-3d.py → public/assets/3d/coche.glb). Lleva un ancla
// invisible por pieza del catálogo, `p_<código>`, y aquí el punto se pone en su
// ancla: las coordenadas viven en un solo sitio.
//
// Carga perezosa: three.js (public/assets/vendor/three-coche.min.js, ~630 KB) y
// el modelo (~600 KB) solo se descargan la primera vez que alguien abre la
// pestaña. Hay UN visor por página (un solo contexto WebGL, que el navegador
// limita): cada ficha que lo enseña se lo lleva a su hueco.
//
// Uso:
//   Coche3D.montar(hueco, { clave: vehiculoId, marcas: [{ codigo, nombre, estado,
//                           observacion, vista }], sel, alElegir: cod => … })

(function (global) {
  'use strict';

  // La misma versión que el propio script (?v=…), para que el paquete y el
  // modelo se renueven con cada despliegue.
  const V = (() => { try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch (e) { return ''; } })();
  const conV = r => (V ? `${r}?v=${encodeURIComponent(V)}` : r);
  const LIB = '/assets/vendor/three-coche.min.js';
  const MODELO = '/assets/3d/coche.glb';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ETIQUETA = { arreglar: 'Mal estado · Arreglar', cambio: 'Mal estado · Cambio' };
  const menosMovimiento = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function estilos() {
    if (document.getElementById('c3-estilos')) return;
    const st = document.createElement('style');
    st.id = 'c3-estilos';
    st.textContent = `
      .c3-visor { position: relative; height: clamp(320px, 58vh, 560px); user-select: none; }
      @media (max-width: 640px) { .c3-visor { height: clamp(260px, 78vw, 420px); } }
      .c3-lienzo { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; outline: none; }
      .c3-lienzo:active { cursor: grabbing; }
      .c3-lienzo.c3-sobre { cursor: pointer; }
      .c3-botones { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; }
      .c3-botones button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px;
        font-size: 12px; font-weight: 600; background: rgb(var(--tc-card) / .85); border: 1px solid rgb(var(--tc-border));
        color: rgb(var(--tc-muted)); backdrop-filter: blur(6px); }
      .c3-botones button:hover { color: rgb(var(--tc-text)); }
      .c3-botones button[aria-pressed="true"] { color: rgb(var(--tc-gold)); border-color: rgb(var(--tc-gold) / .6); background: rgb(var(--tc-gold) / .15); }
      .c3-botones button:focus-visible { outline: 2px solid rgb(var(--tc-gold)); outline-offset: 2px; }
      .c3-etiquetas { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
      .c3-etiqueta { position: absolute; left: 0; top: 0; max-width: 240px; padding: 6px 9px; border-radius: 10px;
        font-size: 12px; line-height: 1.3; background: rgb(var(--tc-card) / .96); border: 1px solid rgb(var(--tc-red) / .5);
        color: rgb(var(--tc-text)); box-shadow: 0 6px 18px rgb(0 0 0 / .25); }
      .c3-etiqueta b { display: block; }
      .c3-etiqueta small { color: rgb(var(--tc-red)); font-weight: 700; font-size: 11px; }
      .c3-etiqueta em { display: block; color: rgb(var(--tc-muted)); font-style: normal; margin-top: 2px; }
      .c3-etiqueta.c3-elegida { border-color: rgb(var(--tc-gold)); }
      .c3-ayuda { position: absolute; left: 12px; bottom: 8px; font-size: 11px; color: rgb(var(--tc-muted)); pointer-events: none; }
      .c3-aviso { padding: 28px 20px; font-size: 14px; color: rgb(var(--tc-muted)); text-align: center; }
      .c3-todo-bien { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); padding: 5px 11px; border-radius: 999px;
        font-size: 12px; font-weight: 600; background: rgb(var(--tc-green) / .15); color: rgb(var(--tc-green));
        border: 1px solid rgb(var(--tc-green) / .4); pointer-events: none; white-space: nowrap; }
    `;
    document.head.appendChild(st);
  }

  // Se mira UNA vez: cada getContext abre un contexto WebGL, y el navegador tira
  // los más viejos (el del visor incluido) cuando hay demasiados.
  let hayWebgl = null;
  function webgl() {
    if (hayWebgl === null) {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        hayWebgl = !!gl;
        const ext = gl && gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch (e) { hayWebgl = false; }
    }
    return hayWebgl;
  }

  function cargarLib() {
    if (global.THREE_COCHE) return Promise.resolve(global.THREE_COCHE);
    return new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = conV(LIB);
      s.async = true;
      s.onload = () => (global.THREE_COCHE ? ok(global.THREE_COCHE) : ko(new Error('el visor 3D no arrancó')));
      s.onerror = () => ko(new Error('no se pudo descargar el visor 3D'));
      document.head.appendChild(s);
    });
  }

  // El rojo de la casa, del tema que haya puesto (los tokens van como «239 68 68»).
  function rojo() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--tc-red').trim();
    return /^\d+\s+\d+\s+\d+$/.test(v) ? `rgb(${v.split(/\s+/).join(',')})` : '#ef4444';
  }
  function oro() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--tc-gold').trim();
    return /^\d+\s+\d+\s+\d+$/.test(v) ? `rgb(${v.split(/\s+/).join(',')})` : '#d4a93a';
  }

  // ── El visor: uno por página ─────────────────────────────────────────────
  let visor = null;
  let cargando = null;

  async function crear() {
    const T = await cargarLib();
    const gltf = await new Promise((ok, ko) => new T.GLTFLoader().load(conV(MODELO), ok, undefined,
      () => ko(new Error('no se pudo cargar el modelo del coche'))));
    return construir(T, gltf);
  }

  function construir(T, gltf) {
    const el = document.createElement('div');
    el.className = 'c3-visor';
    el.innerHTML = `
      <canvas class="c3-lienzo" aria-label="El coche en 3D con las piezas en mal estado marcadas"></canvas>
      <div class="c3-etiquetas"></div>
      <div class="c3-botones">
        <button type="button" data-c3="dentro" aria-pressed="false" title="Aclarar la carrocería para ver el interior y la mecánica">
          <i class="fa-solid fa-eye"></i><span>Ver por dentro</span></button>
        <button type="button" data-c3="centrar" title="Volver a la vista de inicio" aria-label="Volver a la vista de inicio">
          <i class="fa-solid fa-rotate-left"></i></button>
      </div>
      <p class="c3-ayuda">Arrastra para girar · rueda o pellizco para acercar</p>`;
    const canvas = el.querySelector('canvas');
    const capaEtiquetas = el.querySelector('.c3-etiquetas');
    const btnDentro = el.querySelector('[data-c3="dentro"]');

    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    const escena = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer);
    escena.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const sol = new T.DirectionalLight(0xffffff, 1.2);
    sol.position.set(2.5, 6, 3);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    Object.assign(sol.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 1, far: 15 });
    sol.shadow.radius = 4;
    escena.add(sol);

    // El suelo solo pone la sombra: el fondo es el de la tarjeta, en los dos temas.
    const suelo = new T.Mesh(new T.PlaneGeometry(16, 16), new T.ShadowMaterial({ opacity: 0.22 }));
    suelo.rotation.x = -Math.PI / 2;
    suelo.receiveShadow = true;
    escena.add(suelo);

    const camara = new T.PerspectiveCamera(35, 1, 0.1, 60);
    const INICIO = { pos: new T.Vector3(-4.6, 2.4, -5.4), mira: new T.Vector3(0, 0.55, 0) };
    camara.position.copy(INICIO.pos);

    const controles = new T.OrbitControls(camara, canvas);
    controles.target.copy(INICIO.mira);
    controles.enableDamping = true;
    controles.enablePan = false;
    controles.minDistance = 3.2;
    controles.maxDistance = 11;
    controles.maxPolarAngle = Math.PI * 0.48;
    controles.autoRotate = !menosMovimiento();
    controles.autoRotateSpeed = 0.7;
    controles.addEventListener('start', () => { controles.autoRotate = false; animCam = null; tocado = true; });
    // Gira solo mientras nadie lo mira: con el ratón encima se para, que un
    // punto que se mueve no se acierta.
    canvas.addEventListener('pointerenter', () => { controles.autoRotate = false; });
    controles.update();

    // El coche. Lo de fuera («cascarón») se puede aclarar para ver lo de dentro;
    // las ruedas, los frenos y el interior («int_*») se quedan como están.
    const modelo = gltf.scene;
    escena.add(modelo);
    const nombreDe = o => { for (let p = o; p; p = p.parent) if (p.name) return p.name; return ''; };
    const cascaron = [];       // mallas de fuera, con su material propio (clonado)
    const opacos = [];         // las que tapan los puntos (no los cristales)
    const clonados = new Map();
    modelo.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const n = nombreDe(o);
      if (/^int_/.test(n) || /^(rueda_|freno_|pinza_)/.test(n)) {
        if (!/^int_/.test(n)) opacos.push(o);
        return;
      }
      const base = o.material;
      if (!clonados.has(base.uuid)) clonados.set(base.uuid, base.clone());
      o.material = clonados.get(base.uuid);
      const cristal = base.name === 'vidrio';
      // El cristal refleja menos que la chapa: si no, el parabrisas sale quemado.
      if (cristal) { o.material.envMapIntensity = 0.45; o.material.roughness = 0.12; }
      cascaron.push({ malla: o, cristal });
      if (!cristal) opacos.push(o);
    });
    modelo.updateMatrixWorld(true);

    const rayo = new T.Raycaster();
    let ocultosSucio = true, ultimoOcultos = 0;
    let dentro = false;
    function ponerDentro(si) {
      dentro = !!si;
      btnDentro.setAttribute('aria-pressed', String(dentro));
      for (const { malla, cristal } of cascaron) {
        const m = malla.material;
        const opacidad = cristal ? (dentro ? 0.08 : 0.55) : (dentro ? 0.1 : 1);
        m.transparent = opacidad < 1;
        m.opacity = opacidad;
        m.depthWrite = opacidad >= 1;
        m.needsUpdate = true;
        malla.castShadow = !dentro || !cristal;
      }
      ocultosSucio = true;
    }
    ponerDentro(false);
    btnDentro.addEventListener('click', () => ponerDentro(!dentro));

    // ── Los puntos ──
    const texturas = {};
    function textura(tipo) {
      if (texturas[tipo]) return texturas[tipo];
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      if (tipo === 'halo') {
        const gr = g.createRadialGradient(64, 64, 20, 64, 64, 62);
        gr.addColorStop(0, rojo()); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.55; g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(64, 67, 58, 0, Math.PI * 2); g.fill();
        g.fillStyle = tipo === 'elegido' ? oro() : '#ffffff'; g.beginPath(); g.arc(64, 64, 57, 0, Math.PI * 2); g.fill();
        g.fillStyle = rojo(); g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.fill();
        if (tipo === 'cambio-quieto') {            // sin animación: «cambio» lleva un aro por dentro
          g.strokeStyle = '#ffffff'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 24, 0, Math.PI * 2); g.stroke();
        }
      }
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      return (texturas[tipo] = t);
    }
    const sprite = (tipo, orden) => {
      const s = new T.Sprite(new T.SpriteMaterial({ map: textura(tipo), depthTest: false, depthWrite: false,
        transparent: true, sizeAttenuation: false }));
      s.renderOrder = orden;
      return s;
    };

    let marcas = [];               // [{ codigo, nombre, estado, observacion, vista, puntos: [{ pos, nucleo, halo, oculto }] }]
    let sel = null, sobre = null, alElegir = null, ultimoClic = null, clave = null;

    function limpiarMarcas() {
      for (const m of marcas) for (const p of m.puntos) { escena.remove(p.nucleo); escena.remove(p.halo); p.nucleo.material.dispose(); p.halo.material.dispose(); }
      marcas = [];
    }

    function ponerMarcas(lista) {
      limpiarMarcas();
      const quieto = menosMovimiento();
      for (const d of lista) {
        const puntos = [];
        for (const nombre of ['p_' + d.codigo, 'p_' + d.codigo + '__2']) {
          const ancla = modelo.getObjectByName(nombre);
          if (!ancla) continue;
          const pos = new T.Vector3();
          ancla.getWorldPosition(pos);
          const tipo = d.codigo === sel ? 'elegido' : (d.estado === 'cambio' && quieto ? 'cambio-quieto' : 'punto');
          const nucleo = sprite(tipo, 20);
          const halo = sprite('halo', 19);
          nucleo.position.copy(pos); halo.position.copy(pos);
          nucleo.userData.codigo = d.codigo;
          escena.add(halo); escena.add(nucleo);
          puntos.push({ pos, nucleo, halo, oculto: false });
        }
        if (puntos.length) marcas.push({ ...d, puntos });
      }
      medir();
      ocultosSucio = true;
      claveEtiquetas = null;
    }

    // ── Tamaño: el punto mide siempre lo mismo en pantalla ──
    let alto = 1, ancho = 1;
    function medir() {
      const px = 20;                                   // diámetro del punto, en píxeles
      const k = (2 * Math.tan((camara.fov * Math.PI / 180) / 2)) / Math.max(alto, 1);
      for (const m of marcas) for (const p of m.puntos) {
        const s = px * k * (m.codigo === sel ? 1.25 : 1);
        p.base = s;
        p.nucleo.scale.set(s, s, 1);
        p.halo.scale.set(s * 2.2, s * 2.2, 1);
      }
    }
    // La distancia a la que el coche cabe a lo ancho: en un móvil, en vertical,
    // hay que alejarse más. Mientras nadie haya movido la cámara, se aplica sola.
    let tocado = false;
    const DIST_INICIO = INICIO.pos.distanceTo(INICIO.mira);
    function distanciaQueCabe() {
      const medioAncho = Math.atan(Math.tan((camara.fov * Math.PI / 180) / 2) * camara.aspect);
      return Math.max(DIST_INICIO, 2.6 / Math.tan(medioAncho));
    }
    const ro = new ResizeObserver(() => {
      // Fuera de la página (entre un repintado y otro) no se mide: saldría 0.
      if (!el.isConnected || !el.clientWidth) return;
      ancho = el.clientWidth; alto = el.clientHeight;
      renderer.setSize(ancho, alto, false);
      camara.aspect = ancho / alto;
      camara.updateProjectionMatrix();
      const cabe = distanciaQueCabe();
      controles.maxDistance = Math.max(11, cabe * 1.3);
      if (!tocado) camara.position.sub(controles.target).setLength(cabe).add(controles.target);
      medir();
    });
    ro.observe(el);

    // ── Lo que tapa la carrocería se ve más flojo ──
    // Los puntos se pintan siempre por encima (una pieza de dentro tiene que
    // verse), pero si entre la cámara y el punto hay chapa, se aclaran: así se
    // distingue la puerta izquierda de la derecha.
    controles.addEventListener('change', () => { ocultosSucio = true; });
    function calcularOcultos(ahora) {
      if (!ocultosSucio || ahora - ultimoOcultos < 120) return;
      ocultosSucio = false; ultimoOcultos = ahora;
      for (const m of marcas) for (const p of m.puntos) {
        if (dentro) { p.oculto = false; continue; }
        const dir = p.pos.clone().sub(camara.position);
        const dist = dir.length();
        rayo.set(camara.position, dir.normalize());
        rayo.far = dist - 0.06;               // lo que roza el ancla no la tapa
        p.oculto = rayo.intersectObjects(opacos, false).length > 0;
      }
    }

    // ── Etiquetas: la del punto que se señala y la de la pieza elegida ──
    // El texto solo se rehace cuando cambia qué se enseña; en cada fotograma
    // solo se mueve. Cerca del borde de arriba, la etiqueta va debajo del punto.
    const v = new T.Vector3();
    let claveEtiquetas = null;
    function pintarEtiquetas() {
      const ver = [];
      if (sobre) ver.push(sobre);
      if (sel && sel !== sobre) ver.push(sel);
      const ms = ver.map(cod => marcas.find(x => x.codigo === cod)).filter(Boolean);
      const clave = ms.map(m => `${m.codigo}${m.codigo === sel ? '*' : ''}`).join('|');
      if (clave !== claveEtiquetas) {
        claveEtiquetas = clave;
        capaEtiquetas.innerHTML = ms.map(m => {
          const obs = m.observacion
            ? `<em>«${esc(m.observacion.length > 120 ? m.observacion.slice(0, 117) + '…' : m.observacion)}»</em>` : '';
          return `<div class="c3-etiqueta${m.codigo === sel ? ' c3-elegida' : ''}">
            <b>${esc(m.nombre)}</b><small>${esc(ETIQUETA[m.estado] || m.estado)}</small>${obs}</div>`;
        }).join('');
      }
      ms.forEach((m, i) => {
        const div = capaEtiquetas.children[i];
        if (!div) return;
        v.copy(m.puntos[0].pos).project(camara);
        if (v.z > 1) { div.style.display = 'none'; return; }
        div.style.display = '';
        const x = Math.round((v.x + 1) / 2 * ancho), y = Math.round((1 - v.y) / 2 * alto);
        div.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${y > 90 ? 'calc(-100% - 16px)' : '16px'})`;
      });
    }

    // ── Señalar y pinchar ──
    const puntero = new T.Vector2();
    function puntoBajo(ev) {
      const r = canvas.getBoundingClientRect();
      puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(puntero, camara);
      rayo.far = Infinity;
      const nucleos = [];
      for (const m of marcas) for (const p of m.puntos) nucleos.push(p.nucleo);
      const hit = rayo.intersectObjects(nucleos, false)[0];
      return hit ? hit.object.userData.codigo : null;
    }
    canvas.addEventListener('pointermove', ev => {
      if (ev.buttons) return;
      const cod = puntoBajo(ev);
      if (cod !== sobre) { sobre = cod; canvas.classList.toggle('c3-sobre', !!cod); }
    });
    canvas.addEventListener('pointerleave', () => { sobre = null; canvas.classList.remove('c3-sobre'); });
    let abajo = null;
    canvas.addEventListener('pointerdown', ev => { abajo = { x: ev.clientX, y: ev.clientY }; });
    canvas.addEventListener('pointerup', ev => {
      if (!abajo || Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y) > 6) return;
      const cod = puntoBajo(ev);
      if (cod && alElegir) { ultimoClic = cod; alElegir(cod); }
    });

    // ── Llevar la cámara hasta una pieza ──
    let animCam = null;
    function enfocar(cod) {
      const m = marcas.find(x => x.codigo === cod);
      if (!m) return;
      const p = m.puntos[0].pos;
      const desde = camara.position.clone().sub(controles.target);
      const r = desde.length();
      let az = Math.atan2(p.x, p.z);
      if (Math.hypot(p.x, p.z) < 0.35) az = Math.atan2(desde.x, desde.z);     // en el centro: no se gira
      // Un poco de lado, que se entienda qué parte del coche es.
      az += p.x < -0.3 ? 0.35 : p.x > 0.3 ? -0.35 : 0;
      const el0 = 0.42;
      const hasta = new T.Vector3(Math.sin(az) * Math.cos(el0) * r, Math.sin(el0) * r, Math.cos(az) * Math.cos(el0) * r);
      controles.autoRotate = false;
      if (menosMovimiento()) { camara.position.copy(controles.target).add(hasta); controles.update(); return; }
      animCam = { t0: performance.now(), desde, hasta, dur: 700 };
    }
    function moverCamara(ahora) {
      if (!animCam) return;
      const t = Math.min((ahora - animCam.t0) / animCam.dur, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // Por la esfera y no en línea recta, para no atravesar el coche.
      const a = animCam.desde, b = animCam.hasta;
      const r = a.length() + (b.length() - a.length()) * e;
      const dir = a.clone().normalize().lerp(b.clone().normalize(), e).normalize();
      camara.position.copy(controles.target).add(dir.multiplyScalar(r));
      ocultosSucio = true;
      if (t >= 1) animCam = null;
    }

    el.querySelector('[data-c3="centrar"]').addEventListener('click', () => {
      tocado = false;
      animCam = { t0: performance.now(), desde: camara.position.clone().sub(controles.target),
        hasta: INICIO.pos.clone().sub(INICIO.mira).setLength(distanciaQueCabe()), dur: 600 };
    });

    // ── El bucle: solo mientras el visor está en la página ──
    let corriendo = false;
    function bucle(ahora) {
      if (!el.isConnected) { corriendo = false; return; }
      requestAnimationFrame(bucle);
      moverCamara(ahora);
      controles.update();
      calcularOcultos(ahora);
      const quieto = menosMovimiento();
      const fase = (ahora % 1000) / 1000;
      const pulso = 0.5 - 0.5 * Math.cos(fase * Math.PI * 2);      // 0 → 1 → 0 cada segundo
      for (const m of marcas) for (const p of m.puntos) {
        const flojo = p.oculto ? 0.5 : 1;
        const parpadeo = m.estado === 'cambio' && !quieto && m.codigo !== sel ? 0.25 + 0.75 * (1 - pulso) : 1;
        p.nucleo.material.opacity = flojo * parpadeo;
        const crece = quieto ? 0.5 : pulso;
        p.halo.material.opacity = p.oculto ? 0 : (1 - crece) * 0.9;
        const s = p.base * 2.2 * (0.7 + 0.6 * crece);
        p.halo.scale.set(s, s, 1);
        const k = p.oculto ? 0.8 : 1;
        p.nucleo.scale.set(p.base * k, p.base * k, 1);
      }
      renderer.render(escena, camara);
      pintarEtiquetas();
    }
    function arrancar() {
      if (corriendo) return;
      corriendo = true;
      requestAnimationFrame(bucle);
    }

    return {
      el,
      /** Pone el visor en `hueco` con las piezas en mal estado de un coche. */
      poner(hueco, opciones) {
        const nuevoCoche = opciones.clave !== clave;
        clave = opciones.clave;
        alElegir = opciones.alElegir || null;
        const selAntes = sel;
        sel = opciones.sel || null;
        if (hueco.firstChild !== el) { hueco.innerHTML = ''; hueco.appendChild(el); }
        const lista = (opciones.marcas || []).filter(m => m.estado === 'arreglar' || m.estado === 'cambio');
        ponerMarcas(lista);
        let aviso = el.querySelector('.c3-todo-bien');
        if (!lista.length && !aviso) {
          aviso = document.createElement('div');
          aviso.className = 'c3-todo-bien';
          aviso.innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i>Todo en buen estado';
          el.appendChild(aviso);
        } else if (lista.length && aviso) aviso.remove();
        if (nuevoCoche) {
          // Si todo lo malo está dentro, se empieza viéndolo por dentro.
          ponerDentro(lista.length > 0 && lista.every(m => m.vista === 'interior'));
          sobre = null;
        }
        const elegida = lista.find(m => m.codigo === sel);
        if (elegida && elegida.vista === 'interior' && !dentro) ponerDentro(true);
        if (sel && sel !== selAntes && sel !== ultimoClic) enfocar(sel);
        ultimoClic = null;
        arrancar();
      },
    };
  }

  /**
   * Monta el coche 3D en `hueco`. La primera vez descarga three.js y el modelo;
   * las siguientes solo mueve el visor y cambia los puntos.
   */
  async function montar(hueco, opciones = {}) {
    estilos();
    if (!webgl()) {
      hueco.innerHTML = '<p class="c3-aviso">Este navegador no puede enseñar el 3D. El dibujo de «Exterior» e «Interior y mecánica» tiene lo mismo.</p>';
      return;
    }
    if (!visor) {
      hueco.innerHTML = '<p class="c3-aviso"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Cargando el coche en 3D…</p>';
      try {
        visor = await (cargando || (cargando = crear()));
      } catch (e) {
        cargando = null;
        if (hueco.isConnected) hueco.innerHTML = `<p class="c3-aviso">No se pudo cargar el 3D: ${esc(e.message)}. Prueba a recargar la página.</p>`;
        return;
      }
      // Mientras cargaba se pudo cambiar de pestaña o de coche.
      if (!hueco.isConnected) return;
    }
    visor.poner(hueco, opciones);
  }

  global.Coche3D = { montar };
})(window);
