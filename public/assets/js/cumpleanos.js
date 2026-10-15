/* ============================================================
 * CUMPLEAÑOS — las tarjetas que salen en todas las pantallas
 * ============================================================
 * Camilo, 15/10/2026: «En el perfil de TODOS (sin excepción) saldrán tarjetas
 * de notificación de los conductores que están cumpliendo años ese día… una
 * ventanita emergente que saldrá automáticamente en la pantalla de todos los
 * usuarios, no se podrá cerrar hasta que manualmente le dé click en la x; si
 * son varias, una sobre otra; que diga si es conductor o si es de oficina…
 * al que sea el cumpleañero el sistema lo felicitará a nombre de Telecab».
 *
 * Y el mismo día: «Cuando sea de oficina, poder mandar felicitaciones tipo
 * "Camilo te ha enviado felicitaciones" y que salgan globos o algo de parte de
 * Camilo en la pantalla de la persona… quizá mañana lo vea» (db/205).
 *
 * Un MAZO abajo a la derecha: la de arriba se lee entera y las demás asoman
 * detrás. Solo se cierran con la X; cerrada una, sale la siguiente. Lo cerrado
 * se apunta por persona y día en este navegador, para no volver a salir en
 * cada pantalla; si el navegador no deja apuntar, vuelve a salir (es lo seguro).
 * Las felicitaciones recibidas no: esas se dan por vistas en la base, porque
 * quien cumple puede verlas otro día y desde otro ordenador.
 *
 * Cuatro caras:
 *   · CONDUCTOR       azul, «Cumpleaños de un conductor».
 *   · OFICINA         oro, «Cumpleaños en la oficina», con el botón Felicitar.
 *   · TÚ              la felicitación de Telecab, para quien cumple.
 *   · FELICITACIONES  «Camilo te ha enviado felicitaciones», encima de todo,
 *                     con globos (uno con el nombre de cada compañero) la
 *                     primera vez que se ven en este navegador.
 *
 * Quien cumple hoy pregunta cada minuto si le ha llegado alguna nueva, para
 * que los globos le salgan sin tener que recargar.
 *
 * Lo carga layout-gestion.ejs con el id de quien está dentro (data-usuario).
 */
(function () {
  const yo = (document.currentScript && document.currentScript.dataset.usuario) || '';
  if (!yo) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pila = n => String(n || '').trim().split(/\s+/)[0] || '';
  const tit = s => String(s || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const sinMovimiento = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const leer = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch (_) { return new Set(); } };
  const guardar = (k, s) => { try { localStorage.setItem(k, JSON.stringify([...s].slice(-100))); } catch (_) {} };

  // ── Lo cerrado, por persona y día ──────────────────────────────────────────
  // v2 (15/10/2026): las de hoy vuelven a salir a todos. Las habíamos cerrado
  // antes de que se pudiera felicitar, y la idea fue de una compañera.
  const clave = dia => `telecab:cumple:v2:${yo}:${dia}`;
  const apuntar = (dia, id) => { const s = leer(clave(dia)); s.add(id); guardar(clave(dia), s); };

  // Las felicitaciones que ya han tenido sus globos en este navegador.
  const CELEBRADAS = `telecab:cumple:globos:${yo}`;

  // ── El estilo, una vez ─────────────────────────────────────────────────────
  const css = `
  #cumple-pila { position: fixed; right: 16px; bottom: 16px; z-index: 90; width: min(360px, calc(100vw - 32px));
    display: grid; animation: cumple-entra .32s cubic-bezier(.23, 1, .32, 1); }
  @keyframes cumple-entra { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  #cumple-pila > .cumple-t { grid-area: 1 / 1; align-self: end; transform-origin: 50% 100%;
    transition: transform .26s cubic-bezier(.23, 1, .32, 1), opacity .26s cubic-bezier(.23, 1, .32, 1); }
  .cumple-t { position: relative; border-radius: 1rem; padding: 14px 16px 14px 18px; overflow: hidden;
    background: rgb(var(--tc-card)); color: rgb(var(--tc-text));
    border: 1px solid rgb(var(--tc-border)); box-shadow: 0 18px 40px -18px rgb(0 0 0 / .55); }
  .cumple-t::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: rgb(var(--cumple-tono)); }
  .cumple-t.conductor { --cumple-tono: var(--tc-azul); }
  .cumple-t.oficina   { --cumple-tono: var(--tc-gold); }
  .cumple-t.yo, .cumple-t.felicitaciones { --cumple-tono: var(--tc-gold); border-color: rgb(var(--tc-gold) / .55);
    background: linear-gradient(160deg, rgb(var(--tc-gold) / .10), transparent 55%), rgb(var(--tc-card)); }
  .cumple-tipo { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
    color: rgb(var(--cumple-tono)); margin-right: 28px; }
  .cumple-nombre { font-size: 16px; font-weight: 700; line-height: 1.25; margin-top: 4px; text-wrap: balance; }
  .cumple-texto { font-size: 12.5px; line-height: 1.45; color: rgb(var(--tc-muted)); margin-top: 4px; }
  .cumple-chip { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 6px;
    background: rgb(var(--tc-border) / .5); color: rgb(var(--tc-muted)); margin-left: 6px; vertical-align: 2px; }
  .cumple-x { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: 10px;
    display: grid; place-items: center; color: rgb(var(--tc-muted)); background: transparent; border: 0; cursor: pointer; }
  .cumple-x:hover { background: rgb(var(--tc-border) / .45); color: rgb(var(--tc-text)); }
  .cumple-x:focus-visible, .cumple-btn:focus-visible { outline: 2px solid rgb(var(--tc-gold)); outline-offset: 1px; }
  .cumple-cuenta { font-size: 10.5px; color: rgb(var(--tc-muted)); margin-top: 8px; }
  .cumple-firma { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; font-weight: 600; color: rgb(var(--tc-gold)); }
  .cumple-firma img { width: 26px; height: 26px; border-radius: 6px; }
  .cumple-t.yo .cumple-nombre, .cumple-t.felicitaciones .cumple-nombre { font-size: 18px; }
  .cumple-acciones { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .cumple-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 14px; border-radius: 10px;
    font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid transparent;
    background: rgb(var(--tc-gold)); color: rgb(var(--tc-on-gold));
    transition: background-color .15s ease, transform .12s cubic-bezier(.23, 1, .32, 1); }
  .cumple-btn:active:not(:disabled) { transform: scale(.97); }
  @media (hover: hover) and (pointer: fine) { .cumple-btn:hover:not(:disabled) { background: rgb(var(--tc-gold-soft)); } }
  .cumple-btn.suave { background: transparent; color: rgb(var(--tc-text)); border-color: rgb(var(--tc-border)); }
  @media (hover: hover) and (pointer: fine) { .cumple-btn.suave:hover { background: rgb(var(--tc-border) / .45); } }
  .cumple-btn:disabled { cursor: default; background: transparent; color: rgb(var(--tc-muted)); border-color: rgb(var(--tc-border)); }
  .cumple-btn .fa-check { color: rgb(var(--tc-green)); }
  .cumple-error { font-size: 12px; line-height: 1.4; color: rgb(var(--tc-warn)); margin-top: 8px; }

  #cumple-globos { position: fixed; inset: 0; z-index: 89; pointer-events: none; overflow: hidden; }
  .cumple-globo { position: absolute; top: 100%; aspect-ratio: 3 / 5; color: rgb(var(--globo));
    animation: cumple-sube var(--dura) linear var(--tarda) both; }
  @keyframes cumple-sube { to { transform: translateY(calc(-100vh - 100% - 48px)); } }
  .cumple-globo-vaiven { position: relative; width: 100%; height: 100%; transform-origin: 50% 0;
    animation: cumple-vaiven var(--vaiven) ease-in-out infinite alternate; }
  @keyframes cumple-vaiven { from { transform: translateX(-7px) rotate(-5deg); } to { transform: translateX(7px) rotate(5deg); } }
  .cumple-globo svg { display: block; width: 100%; height: 100%; overflow: visible;
    filter: drop-shadow(0 10px 14px rgb(0 0 0 / .22)); }
  .cumple-globo-nombre { position: absolute; top: calc(100% + 2px); left: 50%; transform: translateX(-50%);
    white-space: nowrap; font-size: 12px; font-weight: 600; line-height: 1; padding: 5px 9px; border-radius: 8px;
    background: rgb(var(--tc-card)); color: rgb(var(--tc-text)); border: 1px solid rgb(var(--globo) / .7);
    box-shadow: var(--tc-sombra); }
  @media (prefers-reduced-motion: reduce) {
    #cumple-pila { animation: none; }
    #cumple-pila > .cumple-t { transition: opacity .2s ease; }
    #cumple-globos { display: none; }
  }
  @media print { #cumple-pila, #cumple-globos { display: none; } }`;

  function estilo() {
    if (document.getElementById('cumple-estilo')) return;
    const st = document.createElement('style');
    st.id = 'cumple-estilo';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ── Los globos ─────────────────────────────────────────────────────────────
  // Uno por compañero, con su nombre colgando, por el centro de la pantalla; y
  // otros tantos sin nombre alrededor. Suben, se mecen y se van: unos diez
  // segundos. No se pueden tocar ni tapan nada (pointer-events: none).
  const TONOS = ['--tc-gold', '--tc-gold-soft', '--tc-gold-deep', '--tc-azul'];
  let nGlobo = 0;
  const azar = (a, b) => a + Math.random() * (b - a);

  function dibujoGlobo() {
    const id = 'cumple-brillo-' + (++nGlobo);
    const cuerpo = 'M30 3 C14 3 4 16 4 31 C4 49 18 63 30 68 C42 63 56 49 56 31 C56 16 46 3 30 3 Z';
    return `<svg viewBox="0 0 60 100" aria-hidden="true">
      <defs><radialGradient id="${id}" cx=".34" cy=".26" r=".8">
        <stop offset="0" stop-color="#fff" stop-opacity=".5"/>
        <stop offset=".32" stop-color="#fff" stop-opacity=".06"/>
        <stop offset="1" stop-color="#000" stop-opacity=".22"/>
      </radialGradient></defs>
      <path d="M30 72 C26 79 34 85 30 92 C27 96 31 98 30 100" fill="none" stroke-width="1.1" style="stroke: rgb(var(--tc-muted))"/>
      <path d="M26.5 72.5 L33.5 72.5 L30 66.5 Z" fill="currentColor"/>
      <path d="${cuerpo}" fill="currentColor"/>
      <path d="${cuerpo}" fill="url(#${id})"/>
      <ellipse cx="19" cy="20" rx="4.2" ry="8" transform="rotate(-24 19 20)" fill="#fff" fill-opacity=".35"/>
    </svg>`;
  }

  function globos(nombres) {
    if (sinMovimiento()) return;
    estilo();
    const viejo = document.getElementById('cumple-globos');
    if (viejo) viejo.remove();
    const capa = document.createElement('div');
    capa.id = 'cumple-globos';
    capa.setAttribute('aria-hidden', 'true');

    const conNombre = nombres.slice(0, 8);
    const sueltos = Math.max(10, 18 - conNombre.length);
    const piezas = [
      // Los que llevan nombre: repartidos por el centro, despacio, de los primeros.
      ...conNombre.map((nombre, k) => ({
        nombre, izq: 22 + 56 * (k + .5) / conNombre.length + azar(-4, 4),
        ancho: 78, dura: azar(8.5, 9.5), tarda: .3 + k * .45,
      })),
      // Los demás, por toda la pantalla.
      ...Array.from({ length: sueltos }, (_, k) => ({
        nombre: '', izq: (k + azar(.1, .9)) * 96 / sueltos,
        ancho: azar(40, 66), dura: azar(7, 10.5), tarda: azar(0, 2.8),
      })),
    ];

    let fin = 0;
    piezas.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'cumple-globo';
      el.style.left = `calc(${p.izq.toFixed(1)}% - ${(p.ancho / 2).toFixed(0)}px)`;
      el.style.width = `min(${p.ancho.toFixed(0)}px, ${p.nombre ? 18 : 13}vw)`;
      el.style.setProperty('--globo', `var(${TONOS[i % TONOS.length]})`);
      el.style.setProperty('--dura', p.dura.toFixed(2) + 's');
      el.style.setProperty('--tarda', p.tarda.toFixed(2) + 's');
      el.style.setProperty('--vaiven', azar(2.2, 3.4).toFixed(2) + 's');
      el.innerHTML = `<div class="cumple-globo-vaiven">${dibujoGlobo()}${p.nombre
        ? `<span class="cumple-globo-nombre">${esc(p.nombre)}</span>` : ''}</div>`;
      capa.appendChild(el);
      fin = Math.max(fin, p.tarda + p.dura);
    });
    document.body.appendChild(capa);
    setTimeout(() => capa.remove(), Math.ceil(fin * 1000) + 300);
  }

  const nombresDe = lista => [...new Set(lista.map(f => tit(pila(f.nombre))).filter(Boolean))];

  // Mientras la marca de «Cargando» tapa la pantalla (layout-gestion), los
  // globos subirían por debajo sin que nadie los viera: se espera a que se quite.
  function cuandoSeVea(fn) {
    const capa = document.getElementById('cargando-overlay');
    const tapada = () => !!capa && !capa.classList.contains('hidden');
    if (!tapada()) { setTimeout(() => (tapada() ? cuandoSeVea(fn) : fn()), 400); return; }
    const obs = new MutationObserver(() => { if (!tapada()) { obs.disconnect(); cuandoSeVea(fn); } });
    obs.observe(capa, { attributes: true, attributeFilter: ['class'] });
  }

  /** Globos solo para las felicitaciones que aún no los han tenido en este navegador. */
  function celebrar(lista) {
    const hechas = leer(CELEBRADAS);
    const nuevas = lista.filter(f => !hechas.has(f.id));
    if (!nuevas.length) return;
    nuevas.forEach(f => hechas.add(f.id));
    guardar(CELEBRADAS, hechas);
    cuandoSeVea(() => globos(nombresDe(nuevas)));
  }

  // ── Cada tarjeta ───────────────────────────────────────────────────────────
  function quienes(lista) {
    if (lista.length === 1) return tit(`${lista[0].nombre} ${pila(lista[0].apellidos)}`.trim());
    const n = nombresDe(lista);
    if (n.length === 1) return n[0];
    if (n.length <= 3) return `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
    return `${n.slice(0, 3).join(', ')} y ${n.length - 3} más`;
  }

  function cuandoFue(lista) {
    const dias = [...new Set(lista.map(f => f.dia))];
    if (dias.length === 1 && dias[0] === estado.dia) return 'Por tu cumpleaños, hoy. Que lo disfrutes.';
    const [, m, d] = String(dias[dias.length - 1] || '').split('-').map(Number);
    return m ? `Por tu cumpleaños, el ${d} de ${MESES[m - 1]}.` : 'Por tu cumpleaños.';
  }

  function htmlDe(t, total, pos) {
    const cuenta = total > 1 ? `<p class="cumple-cuenta">${pos} de ${total} · al cerrar esta sale la siguiente</p>` : '';
    const x = '<button type="button" class="cumple-x" aria-label="Cerrar" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>';
    if (t.tipo === 'felicitaciones') {
      const varias = t.lista.length > 1;
      const otraVez = sinMovimiento() ? '' : `<div class="cumple-acciones">
          <button type="button" class="cumple-btn suave" data-accion="globos"><i class="fa-solid fa-rotate-right"></i>Ver los globos otra vez</button></div>`;
      return `${x}
        <p class="cumple-tipo"><i class="fa-solid fa-gift"></i>${varias ? `${t.lista.length} felicitaciones` : 'Una felicitación'}</p>
        <p class="cumple-nombre">${esc(quienes(t.lista))} ${varias ? 'te han' : 'te ha'} enviado felicitaciones</p>
        <p class="cumple-texto">${esc(cuandoFue(t.lista))}</p>${otraVez}${cuenta}`;
    }
    if (t.tipo === 'yo') {
      return `${x}
        <p class="cumple-tipo"><i class="fa-solid fa-cake-candles"></i>Hoy es tu día</p>
        <p class="cumple-nombre">¡Feliz cumpleaños, ${esc(tit(pila(t.nombre)))}!</p>
        <p class="cumple-texto">Todo el equipo te desea un día estupendo. Gracias por lo que haces cada día.</p>
        <p class="cumple-firma"><img src="/assets/logo-128.png" alt="">De parte de Telecab</p>${cuenta}`;
    }
    if (t.tipo === 'oficina') {
      const quien = esc(tit(pila(t.nombre)));
      const boton = t.yaFelicitado
        ? '<button type="button" class="cumple-btn" disabled><i class="fa-solid fa-check"></i>Felicitación enviada</button>'
        : `<button type="button" class="cumple-btn" data-accion="felicitar"><i class="fa-solid fa-gift"></i>Felicitar a ${quien}</button>`;
      return `${x}
        <p class="cumple-tipo"><i class="fa-solid fa-cake-candles"></i>Cumpleaños en la oficina</p>
        <p class="cumple-nombre">${esc(tit(`${t.nombre} ${t.apellidos || ''}`.trim()))}${t.rol ? `<span class="cumple-chip">${esc(t.rol)}</span>` : ''}</p>
        <p class="cumple-texto">${t.yaFelicitado
          ? `Ya has felicitado a ${quien}: le saldrán globos de tu parte en su pantalla.`
          : 'Hoy cumple años. Felicítale y le saldrán globos de tu parte en su pantalla.'}</p>
        <div class="cumple-acciones">${boton}</div>${t.error ? `<p class="cumple-error" role="alert">${esc(t.error)}</p>` : ''}${cuenta}`;
    }
    return `${x}
      <p class="cumple-tipo"><i class="fa-solid fa-cake-candles"></i>Cumpleaños de un conductor</p>
      <p class="cumple-nombre">${esc(tit(t.nombre))}${t.ett ? '<span class="cumple-chip">ETT</span>' : ''}</p>
      <p class="cumple-texto">Hoy cumple años. Si hablas hoy con ${esc(tit(pila(t.nombre)))}, felicítale de parte de Telecab.</p>${cuenta}`;
  }

  // ── El mazo ────────────────────────────────────────────────────────────────
  // Lo que hay en pantalla: el día (de Madrid, lo dice el servidor) y las
  // tarjetas, la primera arriba.
  const estado = { dia: '', mazo: [] };

  async function enviar(url, cuerpo) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.status !== 'ok') throw new Error(d.msg || 'No se pudo enviar. Prueba otra vez en un momento.');
    return d;
  }

  function montar(el, t, total, pos) {
    el.innerHTML = htmlDe(t, total, pos);
    el.querySelector('.cumple-x').addEventListener('click', () => cerrar(el, t));
    const fel = el.querySelector('[data-accion="felicitar"]');
    if (fel) fel.addEventListener('click', async () => {
      fel.disabled = true;
      fel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Enviando…';
      try {
        await enviar('/cumpleanos/api/felicitar', { usuarioId: t.id });
        t.yaFelicitado = true;
        t.error = '';
      } catch (e) {
        t.error = e.message;
      }
      montar(el, t, total, pos);
      el.querySelector('.cumple-x').focus();
    });
    const otra = el.querySelector('[data-accion="globos"]');
    if (otra) otra.addEventListener('click', () => globos(nombresDe(t.lista)));
  }

  function cerrar(el, t) {
    if (el.dataset.cerrando) return;
    el.dataset.cerrando = '1';
    const conFoco = el.contains(document.activeElement);
    if (t.tipo === 'felicitaciones') {
      // Vistas en la base: no vuelven a salir en ningún ordenador. Con
      // sendBeacon, que no pasa por el fetch del layout: cerrar una tarjeta no
      // saca la marca de «Cargando».
      const ids = t.lista.map(f => f.id);
      let ido = false;
      try {
        ido = !!navigator.sendBeacon && navigator.sendBeacon('/cumpleanos/api/vistas',
          new Blob([JSON.stringify({ ids })], { type: 'application/json' }));
      } catch (_) { ido = false; }
      if (!ido) enviar('/cumpleanos/api/vistas', { ids }).catch(() => {});
    } else {
      apuntar(estado.dia, t.clave);
    }
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px) scale(.98)';
    setTimeout(() => {
      estado.mazo = estado.mazo.filter(x => x !== t);
      pintar();
      const sig = conFoco && document.querySelector('#cumple-pila .cumple-x');
      if (sig) sig.focus();
    }, 180);
  }

  function pintar() {
    let mazo = document.getElementById('cumple-pila');
    const tarjetas = estado.mazo;
    if (!tarjetas.length) { if (mazo) mazo.remove(); return; }
    if (!mazo) {
      estilo();
      mazo = document.createElement('div');
      mazo.id = 'cumple-pila';
      mazo.setAttribute('role', 'region');
      mazo.setAttribute('aria-label', 'Cumpleaños de hoy');
      document.body.appendChild(mazo);
    }
    mazo.innerHTML = '';
    const total = tarjetas.length;
    tarjetas.forEach((t, i) => {
      const el = document.createElement('article');
      el.className = 'cumple-t ' + t.tipo;
      montar(el, t, total, i + 1);
      // La de arriba entera; detrás asoman dos como mucho.
      const atras = Math.min(i, 3);
      el.style.zIndex = String(100 - i);
      el.style.transform = `translateY(${-10 * atras}px) scale(${1 - 0.04 * atras})`;
      el.style.opacity = i > 2 ? '0' : String(1 - 0.18 * atras);
      el.style.pointerEvents = i === 0 ? 'auto' : 'none';
      if (i > 0) el.setAttribute('aria-hidden', 'true');
      mazo.appendChild(el);
    });
  }

  /** Las felicitaciones sin ver: una tarjeta encima de todo y globos para las nuevas. */
  const conocidas = new Set();
  function recibir(lista) {
    const nuevas = (lista || []).filter(f => !conocidas.has(f.id));
    if (!nuevas.length) return;
    nuevas.forEach(f => conocidas.add(f.id));
    const t = estado.mazo.find(x => x.tipo === 'felicitaciones');
    if (t) t.lista = [...t.lista, ...nuevas];
    else estado.mazo.unshift({ tipo: 'felicitaciones', clave: 'f', lista: nuevas });
    pintar();
    celebrar(nuevas);
  }

  // Quien cumple hoy pregunta cada minuto (y al volver a la pestaña) si le ha
  // llegado alguna: así ve los globos sin recargar.
  let ultima = 0;
  async function mirar() {
    if (document.hidden || Date.now() - ultima < 15000) return;
    ultima = Date.now();
    try {
      const r = await fetch('/cumpleanos/api/mias', { headers: { Accept: 'application/json' } });
      const d = r.ok ? await r.json() : null;
      if (d && d.status === 'ok') recibir(d.felicitaciones);
    } catch (_) { /* lo intenta en el siguiente minuto */ }
  }

  async function cargar() {
    try {
      const r = await fetch('/cumpleanos/api/hoy', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      if (d.status !== 'ok') return;
      estado.dia = d.dia;
      const cerradas = leer(clave(d.dia));
      estado.mazo = [
        ...(d.felicitar ? [{ tipo: 'yo', clave: 'yo', ...d.felicitar }] : []),
        ...(d.oficina || []).map(o => ({ tipo: 'oficina', clave: 'o' + o.id, ...o })),
        ...(d.conductores || []).map(c => ({ tipo: 'conductor', clave: 'c' + c.id, ...c })),
      ].filter(t => !cerradas.has(t.clave));
      if ((d.felicitaciones || []).length) recibir(d.felicitaciones);
      else pintar();
      if (d.felicitar) {
        ultima = Date.now();
        setInterval(mirar, 60000);
        document.addEventListener('visibilitychange', mirar);
      }
    } catch (_) { /* sin tarjetas: la pantalla sigue igual */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cargar);
  else cargar();
})();
