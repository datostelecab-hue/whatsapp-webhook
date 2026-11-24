// modules/Vehiculos/vistas/revisionFotos.ejs — la revisión de las fotos del portal (db/282-283, 24/11/2026).
//
// Cada lote (las cinco fotos de quien desvincula el coche en el portal) se
// compara con el anterior del mismo coche, FOTO A FOTO y tipo Tinder (Camilo:
// «la quiero tipo tinder jajaj, toca aprobar cada foto con su némesis (…) es
// comparación por comparación, dos, dos, dos, dos y dos, cada una con aprobar
// / con daños / Imagen no válida»):
//   · una carta con la foto de antes y la de después; se juzga con los tres
//     botones, con el teclado (A, D, N) o arrastrando la carta: a la derecha
//     aprueba, a la izquierda pregunta si es un daño o una imagen no válida;
//   · al juzgar, la carta se va y entra la siguiente; con la quinta, el
//     resumen de la pareja y «Siguiente» a la próxima por revisar.
// Lo que le deja el servidor llega por Casa.datos().

(function () {
  const PUEDE = !!Casa.datos().puedeCalificar;
  const { esc, etiqueta } = Listado.fmt;
  const RES = {
    aprobada: { texto: 'Aprobada', tono: 'green', punto: 'bg-telecab-green' },
    danos: { texto: 'Con daños', tono: 'red', punto: 'bg-telecab-red' },
    no_valida: { texto: 'Imagen no válida', tono: 'warn', punto: 'bg-telecab-warn' },
  };
  const MOTIVOS = ['Borrosa', 'Oscura', 'No se ve el coche', 'Es otra parte del coche', 'Muy de cerca o tapada'];
  const QUIETO = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CURVA = 'cubic-bezier(0.23, 1, 0.32, 1)';
  let AVISO = 3;
  let DIAS = 20;

  // ══════════ LA LISTA ══════════

  function estado(f) {
    if (f.estado !== 'pendiente') return etiqueta(RES[f.estado].texto, RES[f.estado].tono);
    return f.hechas ? etiqueta(`En curso · ${f.hechas} de ${f.total}`, 'azul') : etiqueta('Por revisar', 'warn');
  }
  /** Las cinco fotos de una pareja en cinco puntos: verde, rojo, ámbar o gris (sin juzgar). */
  function puntos(f) {
    const xs = [1, 2, 3, 4, 5].map(n => f.veredictos && f.veredictos[n]);
    const dicho = xs.map((v, i) => `${i + 1}: ${v ? RES[v.resultado].texto : 'sin juzgar'}`).join(' · ');
    return `<span class="inline-flex gap-1" role="img" aria-label="${esc(dicho)}" title="${esc(dicho)}">${xs.map(v =>
      `<span class="w-2.5 h-2.5 rounded-sm ${v ? RES[v.resultado].punto : 'bg-telecab-border'}"></span>`).join('')}</span>`;
  }
  const loteCorto = l => (l ? `${l.quien}${l.oficina ? ' (oficina)' : ''} · ${l.hasta}` : '');
  const pintaLote = l => (l
    ? `<span class="whitespace-nowrap"><span class="font-medium">${esc(l.quien)}</span>${l.oficina ? ' <span class="text-xs text-telecab-muted">(oficina)</span>' : ''}</span>
       <span class="block text-xs text-telecab-muted whitespace-nowrap">lo dejó el ${esc(l.hasta)}${l.nFotos < 5 ? ` · ${l.nFotos} de 5 fotos` : ''}</span>`
    : '<span class="text-xs text-telecab-muted">Sin lote anterior</span>');

  /** Cuándo se borran sus fotos: en días, en rojo si quedan pocos; «se guardan» si es prueba de algo. */
  function pintaQuedan(f) {
    if (f.quedan == null) return '<span class="text-xs text-telecab-muted" title="Pareja con daños o con imágenes no válidas: sus fotos no se borran.">Se guardan</span>';
    if (f.estado !== 'pendiente') return `<span class="text-xs text-telecab-muted">en ${f.quedan} d</span>`;
    // `quedan` es el día de la purga (de madrugada): 1 = mañana por la mañana.
    const t = f.quedan <= 0 ? 'hoy' : f.quedan === 1 ? 'mañana' : `en ${f.quedan} días`;
    return f.quedan <= AVISO
      ? `<span class="text-telecab-red font-semibold whitespace-nowrap">${t}</span>`
      : `<span class="whitespace-nowrap">${t}</span>`;
  }

  const lista = Listado.montar({
    raiz: '#modulo',
    titulo: 'Revisión de fotos',
    icono: 'fa-images',
    clave: 'turno',
    origen: '/revision-fotos/api/lista',
    vacio: 'No hay lotes de fotos que coincidan.',
    filtrosIniciales: { estado: 'pendiente' },
    buscar: { texto: 'Buscar matrícula o conductor…', campos: [f => `${f.matricula} ${String(f.matricula).replace(/\s|-/g, '')}`, 'quien', 'quienAnterior'] },

    subtitulo: (visibles, todas) => (visibles.length === todas.length
      ? `${todas.length} lotes` : `${visibles.length} de ${todas.length} lotes`),

    cifras: (filas, extra) => {
      if (extra && extra.avisoDias) AVISO = extra.avisoDias;
      if (extra && extra.dias) DIAS = extra.dias;
      const pend = filas.filter(f => f.estado === 'pendiente');
      return [
        { valor: pend.length, etiqueta: 'por revisar', tono: 'warn', filtro: { id: 'estado', valor: 'pendiente' },
          ayuda: 'Lotes que aún no se han comparado, foto a foto, con el anterior de su coche.' },
        { valor: pend.filter(f => f.quedan != null && f.quedan <= AVISO).length, etiqueta: `se borran en ${AVISO} días o menos`, tono: 'red',
          filtro: { id: 'estado', valor: 'urgente' }, ayuda: `Las fotos se guardan ${DIAS} días. Estas se borran pronto: revísalas primero.` },
        { valor: filas.filter(f => f.nDanos).length, etiqueta: 'con daños', tono: 'red', filtro: { id: 'estado', valor: 'danos' } },
        { valor: filas.filter(f => f.nNoValidas).length, etiqueta: 'con imagen no válida', tono: 'warn', filtro: { id: 'estado', valor: 'no_valida' },
          ayuda: 'Lotes con alguna foto mal hecha o que no enseña nada: es de quien hizo el lote nuevo.' },
        { valor: filas.filter(f => f.estado === 'aprobada').length, etiqueta: 'aprobadas', filtro: { id: 'estado', valor: 'aprobada' } },
      ];
    },

    nota: (filas, extra) => [
      extra && extra.sinTabla ? { tono: 'aviso', icono: 'fa-database',
        texto: 'Faltan las migraciones db/282 y db/283 en Migraciones: hasta entonces se ven los lotes, pero no se pueden revisar.' } : null,
      { icono: 'fa-circle-info', texto: `Cada lote son las cinco fotos que hace un conductor al dejar el coche en el portal. Se compara foto a foto con el lote anterior del mismo coche: un daño nuevo o una imagen no válida es de quien hizo el lote nuevo. Las fotos se borran a los ${DIAS} días, menos las que son prueba de un daño o de una imagen no válida.` },
    ],

    filtros: [
      { id: 'estado', etiqueta: 'Estado', textoTodos: 'Cualquier estado', opciones: [
          { valor: 'pendiente', texto: 'Por revisar' },
          { valor: 'urgente', texto: 'Por revisar, se borran pronto' },
          { valor: 'aprobada', texto: 'Aprobadas' },
          { valor: 'danos', texto: 'Con daños' },
          { valor: 'no_valida', texto: 'Con imagen no válida' },
        ],
        pasa: (f, v) => (v === 'urgente' ? f.estado === 'pendiente' && f.quedan != null && f.quedan <= AVISO
          : v === 'danos' ? f.nDanos > 0
          : v === 'no_valida' ? f.nNoValidas > 0
          : f.estado === v) },
    ],

    claseFila: f => (f.nDanos ? 'bg-telecab-red/5' : ''),

    columnas: [
      { titulo: 'Matrícula', campo: 'matricula', clase: 'font-semibold whitespace-nowrap' },
      { titulo: 'Lote anterior', valor: f => loteCorto(f.anterior), ayuda: 'Con lo que se compara: el último lote de ese coche antes del nuevo.',
        pinta: (v, f) => pintaLote(f.anterior) },
      { titulo: 'Lote nuevo', valor: f => loteCorto(f.nuevo), ayuda: 'El que se juzga. Un daño nuevo o una imagen no válida es de esta persona.',
        pinta: (v, f) => pintaLote(f.nuevo) },
      { titulo: 'Fotos', valor: f => `${f.hechas} de ${f.total}`, exportar: false,
        ayuda: 'Las cinco comparaciones: verde aprobada, rojo con daños, ámbar imagen no válida, gris sin juzgar.',
        pinta: (v, f) => puntos(f) },
      { titulo: 'Estado', valor: f => (f.estado === 'pendiente' ? (f.hechas ? `En curso ${f.hechas} de ${f.total}` : 'Por revisar') : RES[f.estado].texto),
        pinta: (v, f) => estado(f) },
      { titulo: 'Se borran', valor: f => (f.quedan == null ? 'Se guardan' : `${f.quedan} días`),
        ayuda: `Cuándo se borran las fotos de la pareja (a los ${DIAS} días de hacerlas). Las que son prueba de un daño o de una imagen no válida se guardan.`,
        pinta: (v, f) => pintaQuedan(f) },
      { titulo: 'Revisado por', valor: f => (f.revision ? `${f.revision.por} · ${f.revision.cuando}` : ''),
        pinta: (v, f) => (f.revision ? `<span class="whitespace-nowrap">${esc(f.revision.por || '—')}</span><span class="block text-xs text-telecab-muted">${esc(f.revision.cuando)}</span>` : '') },
    ],

    // ══════════ LA FICHA ══════════
    detalle: {
      origen: t => `/revision-fotos/api/par/${encodeURIComponent(t)}`,
      titulo: d => d.matricula,
      subtitulo: d => `${d.nuevo.quien}, lo dejó el ${d.nuevo.hasta}` + (d.anterior ? ` · comparado con ${d.anterior.quien}, el ${d.anterior.hasta}` : ' · sin lote anterior')
        + (d.pendientes ? ` · ${d.pendientes} por revisar` : ''),
      acciones: [
        { texto: 'Saltar', icono: 'fa-forward', visible: d => !!d.siguiente,
          ayuda: d => (d.siguiente ? `Dejar esta para luego e ir a la siguiente por revisar: ${d.siguiente.matricula}` : ''),
          onClick: (d, lst) => irA(lst, d.siguiente.turno) },
      ],
      bloques: [
        { titulo: 'Antes y después, foto a foto', icono: 'fa-images', pinta: (d, hueco) => montarRevision(d, hueco) },
      ],
    },
  });

  /** Ir a otra pareja sin dejar una entrada por cada una en el historial: «atrás» vuelve a la lista. */
  function irA(lst, turno) {
    history.replaceState(history.state, '', '#' + encodeURIComponent(turno));
    lst.abierto = String(turno);
    return lst.recargar();
  }

  // ══════════ LA REVISIÓN: carta a carta ══════════

  // Lo de la ficha abierta. Una sola a la vez (el Listado enseña una ficha).
  let R = null;

  function montarRevision(d, hueco) {
    hueco.className = 'p-4 sm:p-5';
    R = { d, hueco, i: 0, panel: null, ocupado: false, repaso: false };
    if (PUEDE && !d.sinTabla && d.estado === 'pendiente') {
      R.i = Math.max(0, d.fotos.findIndex(f => !f.veredicto));
      pintarCarta();
    } else pintarResumen();
  }
  const pieAntes = () => (R.d.anterior ? `${R.d.anterior.quien}, lo dejó el ${R.d.anterior.hasta}` : 'Sin lote anterior');
  const pieDespues = () => `${R.d.nuevo.quien}, lo dejó el ${R.d.nuevo.hasta}`;

  /** Una foto de la carta: se pulsa para verla en grande (zoom y descarga); sin foto, por qué. */
  function celdaFoto(url, titulo, pie, vacio) {
    return url
      ? `<button type="button" class="block w-full h-full" data-foto="${esc(url)}" data-titulo="${esc(titulo)}" data-pie="${esc(pie)}"
           aria-label="Ver en grande: ${esc(titulo)}">
           <img src="${esc(url)}" alt="" draggable="false" decoding="async" class="w-full h-full object-contain">
         </button>`
      : `<div class="w-full h-full flex items-center justify-center text-center p-4 text-sm text-telecab-muted">${esc(vacio)}</div>`;
  }

  function pintarCarta() {
    const { d } = R;
    const f = d.fotos[R.i];
    const v = f.veredicto;
    const boton = (res, icono, texto, tecla, clases) => `
      <button type="button" data-juzgar="${res}" aria-pressed="${v && v.resultado === res ? 'true' : 'false'}"
        class="flex items-center justify-center gap-2 min-h-[52px] px-3 rounded-xl text-sm font-semibold border transition ${clases}
               ${v && v.resultado === res ? 'ring-2 ring-current ring-offset-2 ring-offset-telecab-card' : ''}">
        <i class="fa-solid ${icono}" aria-hidden="true"></i><span>${texto}</span>
        <kbd class="hidden sm:inline text-[11px] font-medium px-1.5 rounded border border-telecab-border text-telecab-muted">${tecla}</kbd>
      </button>`;
    R.hueco.innerHTML = `
      <div data-tinder>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
          <div class="flex gap-1.5" role="group" aria-label="Las cinco fotos">
            ${d.fotos.map((x, k) => `<button type="button" data-ir="${k}"
              class="w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center border transition
                     ${x.veredicto ? RES[x.veredicto.resultado].punto + ' text-white border-transparent' : 'bg-telecab-card2 border-telecab-border text-telecab-muted'}
                     ${k === R.i ? 'ring-2 ring-telecab-gold ring-offset-2 ring-offset-telecab-card' : ''}"
              aria-label="Foto ${k + 1}: ${esc(x.etiqueta)}${x.veredicto ? ', ' + esc(RES[x.veredicto.resultado].texto) : ''}"
              ${k === R.i ? 'aria-current="step"' : ''}>${k + 1}</button>`).join('')}
          </div>
          <p class="text-sm"><span class="font-semibold">${esc(f.etiqueta)}</span>
            <span class="text-telecab-muted">· foto ${R.i + 1} de ${d.fotos.length}</span>
            ${v ? ' ' + etiqueta(RES[v.resultado].texto, RES[v.resultado].tono) : ''}</p>
          <p class="ml-auto text-xs text-telecab-muted hidden lg:block">Arrastra la carta: a la derecha aprueba, a la izquierda, un problema. ← → para moverte.</p>
        </div>

        <div data-carta class="relative select-none touch-pan-y rounded-2xl border border-telecab-border bg-telecab-card2 overflow-hidden cursor-grab active:cursor-grabbing">
          <div class="grid grid-cols-2 gap-px bg-telecab-border">
            <figure class="bg-telecab-card2 flex flex-col">
              <figcaption class="px-3 py-2 text-xs"><span class="font-semibold">Antes</span> <span class="text-telecab-muted">· ${esc(pieAntes())}</span></figcaption>
              <div class="h-[clamp(180px,46vh,560px)] bg-black/80">${celdaFoto(f.antes, `${d.matricula} · ${f.etiqueta} · antes`, pieAntes(),
                d.anterior ? 'No hay foto de antes' : 'Sin lote anterior: es el primero de este coche en el portal, o ya se borró. Mira que el coche esté bien.')}</div>
            </figure>
            <figure class="bg-telecab-card2 flex flex-col">
              <figcaption class="px-3 py-2 text-xs"><span class="font-semibold">Después</span> <span class="text-telecab-muted">· ${esc(pieDespues())}</span></figcaption>
              <div class="h-[clamp(180px,46vh,560px)] bg-black/80">${celdaFoto(f.despues, `${d.matricula} · ${f.etiqueta} · después`, pieDespues(), 'Esta foto no se guardó')}</div>
            </figure>
          </div>
          <div data-sello class="pointer-events-none absolute top-14 px-4 py-2 rounded-xl border-4 text-xl font-extrabold opacity-0 bg-telecab-card/80"></div>
        </div>

        <div data-panel></div>

        <div class="grid grid-cols-3 gap-2 mt-4">
          ${boton('no_valida', 'fa-image', 'Imagen no válida', 'N', 'bg-telecab-warn/10 text-telecab-warn border-telecab-warn/30 hover:bg-telecab-warn/20')}
          ${boton('danos', 'fa-triangle-exclamation', 'Con daños', 'D', 'bg-telecab-red/10 text-telecab-red border-telecab-red/30 hover:bg-telecab-red/20')}
          ${boton('aprobada', 'fa-check', 'Aprobar', 'A', 'bg-telecab-green/15 text-telecab-green border-telecab-green/40 hover:bg-telecab-green/25')}
        </div>
      </div>`;
    const raiz = R.hueco.querySelector('[data-tinder]');
    raiz.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irAFoto(Number(b.dataset.ir))));
    raiz.querySelectorAll('[data-juzgar]').forEach(b => b.addEventListener('click', () => pedir(b.dataset.juzgar)));
    raiz.querySelectorAll('[data-foto]').forEach(b => b.addEventListener('click', () =>
      VisorFoto.abrir({ src: b.dataset.foto, titulo: b.dataset.titulo, pie: b.dataset.pie, descargar: true })));
    const carta = raiz.querySelector('[data-carta]');
    arrastre(carta);
    entrar(carta);
  }

  // ── El movimiento de la carta ──
  function entrar(carta) {
    if (QUIETO) return;
    carta.style.opacity = '0';
    carta.style.transform = 'scale(0.97)';
    requestAnimationFrame(() => {
      carta.style.transition = `transform 180ms ${CURVA}, opacity 180ms ${CURVA}`;
      carta.style.opacity = '1';
      carta.style.transform = 'none';
    });
  }
  /** La carta se va hacia donde se juzgó (derecha aprueba, izquierda daño, abajo no válida). */
  function salir(carta, res) {
    return new Promise(listo => {
      if (!carta || QUIETO) { listo(); return; }
      const hacia = res === 'aprobada' ? 'translateX(110%) rotate(8deg)' : res === 'danos' ? 'translateX(-110%) rotate(-8deg)' : 'translateY(40%)';
      carta.style.transition = `transform 220ms ${CURVA}, opacity 220ms ${CURVA}`;
      carta.style.transform = hacia;
      carta.style.opacity = '0';
      setTimeout(listo, 200);
    });
  }
  function volverAlSitio(carta) {
    carta.style.transition = QUIETO ? 'none' : `transform 200ms ${CURVA}`;
    carta.style.transform = 'none';
    sello(carta, 0);
  }
  function sello(carta, dx) {
    const s = carta.querySelector('[data-sello]');
    if (!s) return;
    const umbral = Math.min(140, carta.offsetWidth * 0.25);
    s.style.opacity = String(Math.min(1, Math.abs(dx) / umbral));
    const bien = dx >= 0;
    s.textContent = bien ? 'Aprobar' : 'Un problema';
    s.style.transform = bien ? 'rotate(-10deg)' : 'rotate(10deg)';
    s.classList.toggle('left-6', bien);
    s.classList.toggle('border-telecab-green', bien);
    s.classList.toggle('text-telecab-green', bien);
    s.classList.toggle('right-6', !bien);
    s.classList.toggle('border-telecab-red', !bien);
    s.classList.toggle('text-telecab-red', !bien);
  }
  /** Arrastrar la carta, con el dedo o el ratón. Un toque sin arrastrar abre la foto. */
  function arrastre(carta) {
    let x0 = null, y0 = 0, dx = 0, moviendo = false, id = null, arrastrado = false;
    carta.addEventListener('pointerdown', e => {
      if (R.ocupado || R.panel || (e.pointerType === 'mouse' && e.button !== 0)) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; moviendo = false; id = e.pointerId;
    });
    carta.addEventListener('pointermove', e => {
      if (x0 === null || e.pointerId !== id) return;
      dx = e.clientX - x0;
      if (!moviendo) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - y0)) return;
        moviendo = true;
        try { carta.setPointerCapture(id); } catch (_) { /* sin captura, sigue igual */ }
        carta.style.transition = 'none';
      }
      carta.style.transform = QUIETO ? `translateX(${dx / 4}px)` : `translateX(${dx}px) rotate(${dx / 30}deg)`;
      sello(carta, dx);
    });
    const soltar = () => {
      if (x0 === null) return;
      x0 = null;
      if (!moviendo) return;
      moviendo = false;
      arrastrado = true;
      const umbral = Math.min(140, carta.offsetWidth * 0.25);
      if (dx > umbral) pedir('aprobada');
      else {
        volverAlSitio(carta);
        if (dx < -umbral) abrirPanel('elegir');
      }
    };
    carta.addEventListener('pointerup', soltar);
    carta.addEventListener('pointercancel', () => { if (x0 !== null) { x0 = null; moviendo = false; volverAlSitio(carta); } });
    // Tras arrastrar, el clic que llega al soltar no abre la foto.
    carta.addEventListener('click', e => { if (arrastrado) { e.stopPropagation(); e.preventDefault(); arrastrado = false; } }, true);
  }

  // ── Juzgar ──
  /** Pedir un veredicto: aprobar va directo; daños y no válida preguntan antes lo suyo. */
  function pedir(res) {
    if (!PUEDE || R.ocupado) return;
    if (res === 'aprobada') return juzgar('aprobada', '');
    abrirPanel(res);
  }

  function abrirPanel(tipo) {
    R.panel = tipo;
    const p = R.hueco.querySelector('[data-panel]');
    const v = R.d.fotos[R.i].veredicto;
    const caja = 'mt-4 p-4 rounded-xl border';
    if (tipo === 'elegir') {
      p.innerHTML = `<div class="${caja} border-telecab-border bg-telecab-card2 flex flex-wrap items-center gap-2">
        <p class="text-sm font-semibold mr-auto">¿Qué le pasa a esta foto?</p>
        <button type="button" data-p="danos" class="tc-boton tc-boton--peligro"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Con daños</button>
        <button type="button" data-p="no_valida" class="tc-boton"><i class="fa-solid fa-image" aria-hidden="true"></i> Imagen no válida</button>
        <button type="button" data-cerrar class="tc-boton tc-boton--chico">Cancelar</button></div>`;
      p.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => abrirPanel(b.dataset.p)));
    } else if (tipo === 'danos') {
      p.innerHTML = `<form class="${caja} border-telecab-red/40 bg-telecab-red/5" data-form>
        <label for="rf-nota" class="block text-sm font-semibold mb-1.5">¿Qué daño se ve en «${esc(R.d.fotos[R.i].etiqueta)}»?</label>
        <textarea id="rf-nota" rows="2" maxlength="500" required class="w-full px-3 py-2 bg-telecab-card border border-telecab-border rounded-xl text-sm resize-y"
          placeholder="Ej.: rayón nuevo en la puerta trasera">${esc(v && v.resultado === 'danos' ? v.nota : '')}</textarea>
        <p class="text-xs text-telecab-muted mt-1">Queda a nombre de ${esc(R.d.nuevo.quien)}. Las fotos de esta pareja se guardan como prueba.</p>
        <div class="flex justify-end gap-2 mt-3">
          <button type="button" data-cerrar class="tc-boton">Cancelar</button>
          <button type="submit" class="tc-boton tc-boton--peligro">Guardar el daño</button></div></form>`;
      const t = p.querySelector('textarea');
      p.querySelector('[data-form]').addEventListener('submit', e => {
        e.preventDefault();
        if (!t.value.trim()) { t.focus(); return; }
        juzgar('danos', t.value.trim());
      });
      // Enter guarda; Mayús+Enter, otra línea.
      t.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.querySelector('[data-form]').requestSubmit(); } });
      t.focus();
    } else {
      p.innerHTML = `<div class="${caja} border-telecab-warn/40 bg-telecab-warn/5">
        <p class="text-sm font-semibold mb-2">¿Por qué no vale la foto de ${esc(R.d.nuevo.quien)}?</p>
        <div class="flex flex-wrap gap-2">${MOTIVOS.map(m => `<button type="button" data-motivo="${esc(m)}" class="tc-boton tc-boton--chico">${esc(m)}</button>`).join('')}</div>
        <form class="flex flex-wrap gap-2 mt-3" data-form>
          <label for="rf-motivo" class="sr-only">Otro motivo</label>
          <input id="rf-motivo" maxlength="500" placeholder="Otro motivo (opcional)" value="${esc(v && v.resultado === 'no_valida' ? v.nota : '')}"
            class="flex-1 min-w-[12rem] px-3 py-2 bg-telecab-card border border-telecab-border rounded-xl text-sm">
          <button type="button" data-cerrar class="tc-boton">Cancelar</button>
          <button type="submit" class="tc-boton tc-boton--principal">Marcar no válida</button></form></div>`;
      p.querySelectorAll('[data-motivo]').forEach(b => b.addEventListener('click', () => juzgar('no_valida', b.dataset.motivo)));
      p.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); juzgar('no_valida', p.querySelector('input').value.trim()); });
      p.querySelector('input').focus();
    }
    p.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', cerrarPanel));
  }
  function cerrarPanel() {
    R.panel = null;
    const p = R.hueco.querySelector('[data-panel]');
    if (p) p.innerHTML = '';
  }

  async function juzgar(res, nota) {
    if (R.ocupado) return;
    R.ocupado = true;
    const { d } = R;
    const f = d.fotos[R.i];
    const carta = R.hueco.querySelector('[data-carta]');
    try {
      const r = await Api.post(`/revision-fotos/api/par/${encodeURIComponent(d.turno)}/foto/${f.n}`,
        { resultado: res, nota }, { aviso: 'No se ha podido guardar' });
      if (!r) return;
      f.veredicto = { resultado: res, etiqueta: RES[res].texto, nota: nota || '' };
      if (r.cerrada) d.estado = r.cerrada.resultado;
      R.panel = null;
      await salir(carta, res);
      // La siguiente: la próxima sin juzgar; repasando, la de al lado; si no queda, el final.
      const resto = d.fotos.map((x, k) => k).filter(k => !d.fotos[k].veredicto);
      if (resto.length) R.i = resto.find(k => k > R.i) ?? resto[0];
      else if (R.repaso && R.i < d.fotos.length - 1) R.i += 1;
      else { pintarFinal(); return; }
      pintarCarta();
    } finally { R.ocupado = false; }
  }

  function irAFoto(k) {
    if (R.ocupado || k < 0 || k >= R.d.fotos.length) return;
    cerrarPanel();
    R.i = k;
    pintarCarta();
  }

  // ── El final de la pareja y el resumen ──
  function filasResumen(d) {
    return d.fotos.map(f => {
      const v = f.veredicto;
      const mini = (url, alt) => (url
        ? `<button type="button" class="block" data-foto="${esc(url)}" data-titulo="${esc(`${d.matricula} · ${f.etiqueta} · ${alt}`)}" data-pie="${esc(alt === 'antes' ? pieAntes() : pieDespues())}" aria-label="Ver en grande: ${esc(f.etiqueta)}, ${alt}">
             <img src="${esc(url)}" alt="" loading="lazy" decoding="async" class="w-24 h-16 object-cover rounded-lg border border-telecab-border hover:border-telecab-gold transition"></button>`
        : '<span class="w-24 h-16 rounded-lg border border-dashed border-telecab-border inline-block"></span>');
      return `<li class="flex flex-wrap items-center gap-3 py-2.5 border-t border-telecab-border/60 first:border-t-0">
        <span class="flex gap-1.5">${mini(f.antes, 'antes')}${mini(f.despues, 'después')}</span>
        <span class="min-w-[10rem] flex-1">
          <span class="block text-sm font-semibold">${esc(f.etiqueta)}</span>
          ${v ? `<span class="block text-sm">${etiqueta(RES[v.resultado].texto, RES[v.resultado].tono)}${v.nota ? ` <span class="text-telecab-muted">${esc(v.nota)}</span>` : ''}</span>`
            : '<span class="text-xs text-telecab-muted">Sin juzgar</span>'}
        </span>
        ${PUEDE && !d.sinTabla ? `<button type="button" class="tc-boton tc-boton--chico" data-repasar="${f.n - 1}" aria-label="Cambiar ${esc(f.etiqueta)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> Cambiar</button>` : ''}
      </li>`;
    }).join('');
  }
  function enganchaResumen() {
    R.hueco.querySelectorAll('[data-foto]').forEach(b => b.addEventListener('click', () =>
      VisorFoto.abrir({ src: b.dataset.foto, titulo: b.dataset.titulo, pie: b.dataset.pie, descargar: true })));
    R.hueco.querySelectorAll('[data-repasar]').forEach(b => b.addEventListener('click', () => {
      R.repaso = true;
      R.i = Number(b.dataset.repasar);
      pintarCarta();
    }));
  }
  /** Quién responde de lo encontrado: el del lote nuevo. */
  function responsable(d) {
    const nd = d.fotos.filter(f => f.veredicto && f.veredicto.resultado === 'danos').length;
    const nv = d.fotos.filter(f => f.veredicto && f.veredicto.resultado === 'no_valida').length;
    if (!nd && !nv) return '';
    const partes = [nd ? `${nd} ${nd === 1 ? 'daño' : 'daños'}` : '', nv ? `${nv} ${nv === 1 ? 'imagen no válida' : 'imágenes no válidas'}` : ''].filter(Boolean);
    return `<p class="text-sm"><span class="text-telecab-muted">Responsable:</span> <span class="font-semibold">${esc(d.nuevo.quien)}</span> · ${partes.join(' y ')}</p>`;
  }

  function pintarFinal() {
    const { d } = R;
    const r = RES[d.estado] || RES.aprobada;
    R.hueco.innerHTML = `
      <div data-final class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <i class="fa-solid ${d.estado === 'aprobada' ? 'fa-circle-check text-telecab-green' : d.estado === 'danos' ? 'fa-triangle-exclamation text-telecab-red' : 'fa-image text-telecab-warn'} text-2xl" aria-hidden="true"></i>
          <div>
            <p class="text-lg font-bold">${esc(d.matricula)}: ${esc(r.texto.toLowerCase())}</p>
            ${responsable(d)}
          </div>
          <div class="ml-auto flex flex-wrap gap-2">
            <button type="button" class="tc-boton" data-lista>Volver a la lista</button>
            ${d.siguiente ? `<button type="button" class="tc-boton tc-boton--principal" data-siguiente>Siguiente: ${esc(d.siguiente.matricula)} <kbd class="text-[11px] font-medium px-1.5 rounded border border-current">Enter</kbd></button>` : ''}
          </div>
        </div>
        ${d.siguiente ? '' : '<p class="text-sm text-telecab-muted">No queda ningún lote por revisar.</p>'}
        <ul>${filasResumen(d)}</ul>
      </div>`;
    enganchaResumen();
    const sig = R.hueco.querySelector('[data-siguiente]');
    if (sig) { sig.addEventListener('click', () => irA(lista, d.siguiente.turno)); sig.focus(); }
    R.hueco.querySelector('[data-lista]').addEventListener('click', async () => { await lista.recargar(); lista.volver(); });
  }

  function pintarResumen() {
    const { d } = R;
    const cab = d.estado === 'pendiente'
      ? `<p class="text-sm text-telecab-muted">${d.sinTabla ? 'Faltan las migraciones db/282 y db/283: aún no se puede revisar.' : 'Sin revisar todavía.'}</p>`
      : `<p class="flex flex-wrap items-center gap-2 text-sm">${estado(d)}
           <span class="text-telecab-muted">por ${esc((d.revision && d.revision.por) || '—')}, el ${esc((d.revision && d.revision.cuando) || '')}</span></p>
         ${responsable(d)}
         ${d.quedan == null ? '<p class="text-xs text-telecab-muted">Las fotos de esta pareja se guardan: son prueba de lo encontrado.</p>' : ''}`;
    R.hueco.innerHTML = `<div class="space-y-3">${cab}
      ${PUEDE && !d.sinTabla && d.estado !== 'pendiente' ? '<button type="button" class="tc-boton" data-otra><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Revisar otra vez, foto a foto</button>' : ''}
      <ul>${filasResumen(d)}</ul></div>`;
    enganchaResumen();
    const otra = R.hueco.querySelector('[data-otra]');
    if (otra) otra.addEventListener('click', () => { R.repaso = true; R.i = 0; pintarCarta(); });
  }

  // ── El teclado: A aprueba, D daño, N no válida, ← → entre fotos, Enter en el final ──
  document.addEventListener('keydown', e => {
    if (!R || !document.body.contains(R.hueco)) return;
    // El visor o un diálogo encima (solo los que se ven: un modal escondido no cuenta).
    if ([...document.querySelectorAll('[aria-modal="true"]')].some(x => x.getClientRects().length)) return;
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
    // Esc con el panel abierto cierra el panel, no la ficha.
    if (e.key === 'Escape' && R.panel) { e.stopImmediatePropagation(); e.preventDefault(); cerrarPanel(); return; }
    if (escribiendo || e.ctrlKey || e.metaKey || e.altKey) return;
    if (R.hueco.querySelector('[data-final]')) {
      if (e.key === 'Enter' && R.d.siguiente && e.target === document.body) { e.preventDefault(); irA(lista, R.d.siguiente.turno); }
      return;
    }
    if (!R.hueco.querySelector('[data-tinder]') || R.panel) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); pedir('aprobada'); }
    else if (k === 'd') { e.preventDefault(); pedir('danos'); }
    else if (k === 'n') { e.preventDefault(); pedir('no_valida'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); irAFoto(R.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); irAFoto(R.i - 1); }
  }, true);

  // Si llega un lote nuevo (otro conductor acaba de dejar un coche), la lista se refresca sola.
  if (window.TiempoReal) {
    TiempoReal.escuchar('contadores', { alLlegar: m => {
      if (m && Array.isArray(m.fuentes) && m.fuentes.includes('revision_fotos') && !lista.abierto) lista.recargar().catch(() => {});
    } });
  }
})();
