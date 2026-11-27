// modules/Tablero/vistas/tablero.ejs — el tablero de tareas (ítem 1, entrega 1b).
//
// Las vistas en pestañas (Pestanas), las columnas con arrastrar y soltar
// (Kanban), la ficha al lado (Panel) y la lista (Listado). Lo que se puede
// hacer con cada tarjeta lo dice el servidor en `tarjeta.puede`: aquí solo se
// enseñan esos botones, y el servidor lo vuelve a comprobar.

(function () {
  const esc = Casa.esc;
  const API = '/tablero/api';
  const FINALES = ['cerrada', 'rechazada', 'anulada'];
  const TRABAJANDO = ['por_hacer', 'en_curso', 'bloqueada'];

  const COLUMNAS = {
    trabajo: [
      { id: 'por_aprobar', titulo: 'Por aprobar', vacia: 'Nada esperando aprobación' },
      { id: 'por_hacer', titulo: 'Por hacer', vacia: 'Nada por hacer' },
      { id: 'en_curso', titulo: 'En curso', vacia: 'Nada en curso' },
      { id: 'bloqueada', titulo: 'Bloqueada', vacia: 'Nada bloqueado' },
      { id: 'cerrada', titulo: 'Cerrada', vacia: 'Nada cerrado estos 14 días' },
    ],
    pendientes: [
      { id: 'por_aprobar', titulo: 'Por aprobar', vacia: 'Ninguna tarea espera tu aprobación' },
      { id: 'por_asignar', titulo: 'Por asignar', vacia: 'Ninguna tarjeta por asignar' },
    ],
  };

  const yo = { id: null, aprueba: false, asigna: false, todos: false };
  let personas = [];
  let vista = 'mias';
  let kanban = null;
  let lista = null;
  // EL EQUIPO, PERSONA A PERSONA (20/11/2026, Camilo: «que estén las tarjetas
  // de todos encima del tablero de Ignacio como "filtro"… al clickear en uno ya
  // no se vea el tablero general sino el individual»). En la pestaña del equipo,
  // una tarjeta por persona encima del tablero; pulsarla deja solo lo que LLEVA
  // ella (?persona=ID); pulsarla otra vez, o «Todos», vuelve al general.
  let carga = [];
  let persona = leerPersona();
  // POR TIPO DE TAREA (27/11/2026, Camilo: «sepárale a Diana el tablero por
  // tareas: altas, bajas, etc.; todo se le está acumulando»). Encima de las
  // columnas, una pestaña por grupo (altas, bajas médicas, ausencias, nómina…)
  // con sus abiertas; pulsarla deja solo esas (?grupo=…). El grupo lo dice el
  // servidor (`tarjeta.grupo`). Se ve en todas las vistas de columnas.
  let grupo = new URLSearchParams(location.search).get('grupo') || null;
  let ultimas = [];          // lo último que llegó, sin filtrar por grupo
  let panel = null;          // { id, p } la ficha abierta
  let pidiendo = null;
  let otraVez = false;       // se pidió recargar mientras otra recarga estaba en marcha
  // Cada lectura de la ficha lleva su número: una que se pidió ANTES de un
  // cambio y llega DESPUÉS no puede pintar encima de lo nuevo.
  let turnoFicha = 0;

  // LOS FICHEROS DE UN COMENTARIO (18/11/2026, db/270): lo que se sube a un borrador de
  // quien escribe antes de mandar el comentario, y el texto a medias. Vive aquí y no en la
  // ficha, que se vuelve a pintar entera cada vez.
  let pendientes = { borrador: null, items: [], texto: '' };
  let temporizadorGif = null;
  const ICONO_FICHERO = { imagen: 'fa-image', pdf: 'fa-file-pdf', video: 'fa-film', audio: 'fa-music', otro: 'fa-file' };

  // ── Formatos ────────────────────────────────────────────────────────────
  const dia = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const fechaHora = v => {
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const iniciales = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
  const nombreDe = id => (personas.find(p => p.id === id) || {}).nombre || `#${id}`;

  /** «Vence hoy», «Quedan 3 días», «Vencida (12/11)». Vacío sin plazo. */
  function semaforo(t, { largo = false } = {}) {
    const s = t.plazo && t.plazo.semaforo;
    if (!s) return t.plazo && t.plazo.venceEl && !FINALES.includes(t.estado)
      ? `<span class="text-telecab-muted">Vence el ${esc(dia(t.plazo.venceEl))}</span>` : '';
    const q = t.plazo.quedan;
    const texto = s === 'rojo' ? `Vencida${largo ? ' el ' + dia(t.plazo.venceEl) : ` (${dia(t.plazo.venceEl).slice(0, 5)})`}`
      : s === 'amarillo' ? 'Vence hoy'
        : `${q === 1 ? 'Queda 1 día' : `Quedan ${q} días`}${largo ? ` · vence el ${dia(t.plazo.venceEl)}` : ''}`;
    return `<span class="tc-semaforo tc-semaforo--${s}" title="Vence el ${esc(dia(t.plazo.venceEl))} (días hábiles)">${esc(texto)}</span>`;
  }

  const TONO_ESTADO = { por_aprobar: 'aviso', por_asignar: 'aviso', por_hacer: '', en_curso: 'azul', bloqueada: 'rojo', cerrada: 'verde', rechazada: '', anulada: '' };
  const pastillaEstado = t => `<span class="tc-pastilla ${TONO_ESTADO[t.estado] ? 'tc-pastilla--' + TONO_ESTADO[t.estado] : ''}">${esc(t.estadoEtiqueta)}</span>`;
  const pastillaTipo = t => `<span class="tc-pastilla ${t.tipo === 'ticket' ? 'tc-pastilla--azul' : 'tc-pastilla--oro'}">${esc(t.tipoEtiqueta)}</span>`;

  // ── La tarjeta en una columna ───────────────────────────────────────────
  function pintaTarjeta(t) {
    const resp = t.responsable;
    return `
      <p class="tc-tarjeta-titulo">${t.sensible ? '<i class="fa-solid fa-lock text-telecab-muted mr-1" aria-hidden="true" title="Con datos sensibles: se miran en su origen"></i>' : ''}${esc(t.titulo)}</p>
      <div class="tc-tarjeta-pie">
        ${pastillaTipo(t)}
        ${semaforo(t)}
        ${t.comentarios ? `<span title="${t.comentarios} comentario${t.comentarios === 1 ? '' : 's'}"><i class="fa-regular fa-comment" aria-hidden="true"></i> ${t.comentarios}</span>` : ''}
        ${t.colaboradores.length ? `<span title="${t.colaboradores.length} colaborando"><i class="fa-solid fa-user-group" aria-hidden="true"></i> ${t.colaboradores.length}</span>` : ''}
        <span class="ml-auto">${resp
          ? `<span class="tc-iniciales" title="Lleva: ${esc(resp.nombre)}">${esc(iniciales(resp.nombre))}</span>`
          : '<span class="text-telecab-muted" title="Sin responsable">Sin asignar</span>'}</span>
      </div>`;
  }

  function nombreTarjeta(t) {
    const partes = [t.titulo, t.tipoEtiqueta, t.estadoEtiqueta];
    if (t.responsable) partes.push('lleva ' + t.responsable.nombre);
    if (t.plazo && t.plazo.semaforo === 'rojo') partes.push('vencida');
    return partes.join(', ');
  }

  // ── La persona elegida en el tablero del equipo, en la URL ──────────────
  function leerPersona() {
    const n = Number(new URLSearchParams(location.search).get('persona'));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  function ponerPersona(p) {
    persona = p;
    const u = new URL(location.href);
    if (p == null) u.searchParams.delete('persona'); else u.searchParams.set('persona', String(p));
    history.replaceState(history.state, '', u);
  }
  const textoTodos = () => (yo.todos ? 'Todo el equipo' : 'Mi equipo');

  // ── El grupo elegido, en la URL ─────────────────────────────────────────
  function ponerGrupo(g) {
    grupo = g;
    const u = new URL(location.href);
    if (g == null) u.searchParams.delete('grupo'); else u.searchParams.set('grupo', g);
    history.replaceState(history.state, '', u);
  }
  const delGrupo = ts => (grupo ? ts.filter(t => t.grupo === grupo) : ts);

  /**
   * Las pestañas por tipo de tarea: «Todas» y una por grupo que tenga alguna
   * tarjeta, con cuántas siguen abiertas (en rojo, las vencidas). Con un solo
   * grupo no hacen falta y no salen (salvo que haya uno elegido).
   */
  function pintarGrupos() {
    const caja = document.querySelector('#t-grupos');
    if (!caja) return;
    const abiertas = ultimas.filter(t => !FINALES.includes(t.estado));
    const grupos = [...new Map(ultimas.map(t => [t.grupo, t.grupoEtiqueta]))]
      .map(([id, etiqueta]) => ({ id, etiqueta, n: abiertas.filter(t => t.grupo === id).length,
        v: abiertas.filter(t => t.grupo === id && t.plazo && t.plazo.semaforo === 'rojo').length }))
      .sort((a, b) => (b.n - a.n) || a.etiqueta.localeCompare(b.etiqueta, 'es'));
    if (grupos.length < 2 && !grupo) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
    caja.classList.remove('hidden');
    const vencidasTodas = abiertas.filter(t => t.plazo && t.plazo.semaforo === 'rojo').length;
    const chip = (id, etiqueta, n, v) => {
      const elegida = (id || null) === (grupo || null);
      return `<button type="button" data-grupo="${esc(id || '')}" aria-pressed="${elegida}"
          class="flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition ${elegida
            ? 'border-telecab-gold bg-telecab-gold/10 font-semibold' : 'border-telecab-border bg-telecab-card2 hover:border-telecab-gold'}">
        ${esc(etiqueta)}
        <span class="tabular-nums text-xs ${n ? '' : 'text-telecab-muted'}">${n}</span>
        ${v ? `<span class="tabular-nums text-xs text-telecab-red font-semibold" title="${v} vencida${v === 1 ? '' : 's'}">· ${v}</span>` : ''}
      </button>`;
    };
    caja.innerHTML = `<div class="flex gap-2 overflow-x-auto pb-1 mb-2" role="group" aria-label="Ver solo un tipo de tarea">
        ${chip(null, 'Todas', abiertas.length, vencidasTodas)}
        ${grupos.map(g => chip(g.id, g.etiqueta, g.n, g.v)).join('')}
      </div>`;
    caja.querySelectorAll('[data-grupo]').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.grupo || null;
      ponerGrupo(id === grupo ? null : id);
      if (kanban) kanban.poner(delGrupo(ultimas));
      pintarGrupos();
    }));
  }

  // ── Traer ───────────────────────────────────────────────────────────────
  /** Las de una vista. En la del equipo con una persona elegida, solo lo que lleva ella. */
  async function traer(v, p = null) {
    const q = v === 'equipo' && p ? `vista=persona&persona=${encodeURIComponent(p)}` : `vista=${encodeURIComponent(v)}`;
    const r = await Api.get(`${API}/tarjetas?${q}`);
    return r.tarjetas || [];
  }
  async function traerCarga() {
    const r = await Api.get(`${API}/equipo`);
    carga = r.personas || [];
    return carga;
  }

  /** Todas las que veo (para la lista): las de cada vista, sin repetir. */
  async function todas() {
    const vistas = ['mias', 'equipo'].concat(yo.aprueba || yo.asigna ? ['pendientes'] : []);
    const grupos = await Promise.all(vistas.map(traer));
    const porId = new Map();
    grupos.flat().forEach(t => porId.set(t.id, t));
    return [...porId.values()];
  }

  // ── Las columnas ────────────────────────────────────────────────────────
  function montarKanban() {
    const columnas = vista === 'pendientes' ? COLUMNAS.pendientes : COLUMNAS.trabajo;
    // Cada vista en un elemento nuevo: montar dos veces sobre el mismo
    // engancharía sus clics dos veces.
    const caja = document.querySelector('#t-tablero');
    caja.innerHTML = '<div></div>';
    kanban = Kanban.montar(caja.firstElementChild, {
      columnas,
      clave: t => t.id,
      columnaDe: t => (FINALES.includes(t.estado) ? 'cerrada' : t.estado),
      pinta: pintaTarjeta,
      nombre: nombreTarjeta,
      puedeArrastrar: t => !!(t.puede.mover || t.puede.cerrar),
      puedeSoltar: (t, col) => (TRABAJANDO.includes(col) ? t.puede.mover : col === 'cerrada' ? t.puede.cerrar : false),
      alSoltar: async (t, col) => {
        const hecho = col === 'cerrada' ? await cerrar(t) : await mover(t, col);
        if (!hecho) kanban.poner(kanban.tarjetas());   // se canceló: vuelve a su sitio
      },
      alAbrir: t => abrirFicha(t.id),
    });
  }

  async function recargar() {
    if (vista === 'lista') { if (lista) await lista.recargar(); return; }
    // Con una recarga en marcha, se repite al acabar: la que va puede ser de
    // antes de un cambio, y lo nuevo no se perdería.
    if (pidiendo) { otraVez = true; return pidiendo; }
    pidiendo = (async () => {
      try {
        do {
          otraVez = false;
          const v = vista, p = persona;
          // En la del equipo, también cuántas lleva cada uno (las tarjetas del filtro).
          const [tarjetas] = await Promise.all([traer(v, v === 'equipo' ? p : null), v === 'equipo' ? traerCarga().catch(() => carga) : null]);
          if (v !== vista || p !== persona) continue;
          ultimas = tarjetas;
          if (kanban) kanban.poner(delGrupo(tarjetas));
          pintarGrupos();
          if (v === 'equipo') pintarFiltro();
        } while (otraVez);
      } catch (e) { document.querySelector('#t-tablero').innerHTML = `<p class="text-sm text-telecab-warn">No se ha podido cargar el tablero: ${esc(e.message)}</p>`; }
      finally { pidiendo = null; }
    })();
    return pidiendo;
  }
  let tRecargar = null;
  const recargarPronto = () => { clearTimeout(tRecargar); tRecargar = setTimeout(recargar, 400); };

  // ── La lista (Listado) ──────────────────────────────────────────────────
  function montarLista() {
    lista = Listado.montar({
      raiz: '#t-lista',
      titulo: 'Todas las tarjetas que ves',
      icono: 'fa-list-check',
      clave: 'id',
      origen: async () => todas(),
      vacio: 'No hay tarjetas que coincidan.',
      alAbrir: t => abrirFicha(t.id),
      buscar: { texto: 'Título o persona…', campos: ['titulo', t => (t.responsable ? t.responsable.nombre : ''), t => (t.creadaPor ? t.creadaPor.nombre : '')] },
      kpis: filas => [
        { etiqueta: 'Abiertas', valor: filas.filter(t => !FINALES.includes(t.estado)).length, tono: 'gold' },
        { etiqueta: 'Vencidas', valor: filas.filter(t => t.plazo.semaforo === 'rojo').length,
          tono: filas.some(t => t.plazo.semaforo === 'rojo') ? 'red' : 'text', filtro: { id: 'semaforo', valor: 'rojo' } },
        { etiqueta: 'Por aprobar', valor: filas.filter(t => t.estado === 'por_aprobar').length, filtro: { id: 'estado', valor: 'por_aprobar' } },
        { etiqueta: 'Por asignar', valor: filas.filter(t => t.estado === 'por_asignar').length, filtro: { id: 'estado', valor: 'por_asignar' } },
      ],
      filtros: [
        { id: 'estado', etiqueta: 'Estado', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.map(t => [t.estado, t.estadoEtiqueta]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.estado === valor).length })),
          pasa: (t, v) => t.estado === v },
        { id: 'responsable', etiqueta: 'Responsable', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.filter(t => t.responsable).map(t => [String(t.responsable.id), t.responsable.nombre]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.responsable && String(t.responsable.id) === valor).length })),
          pasa: (t, v) => !!t.responsable && String(t.responsable.id) === v },
        { id: 'grupo', etiqueta: 'Grupo', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.map(t => [t.grupo, t.grupoEtiqueta]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.grupo === valor).length })),
          pasa: (t, v) => t.grupo === v },
        { id: 'tipo', etiqueta: 'Tipo', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.map(t => [t.tipo, t.tipoEtiqueta]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.tipo === valor).length })),
          pasa: (t, v) => t.tipo === v },
        { id: 'semaforo', etiqueta: 'Plazo', textoTodos: 'Todos',
          opciones: filas => [['rojo', 'Vencidas'], ['amarillo', 'Vencen hoy'], ['verde', 'En plazo']]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.plazo.semaforo === valor).length })),
          pasa: (t, v) => t.plazo.semaforo === v },
      ],
      columnas: [
        { titulo: 'Tarjeta', campo: 'titulo', pinta: (v, t) => `<span class="font-semibold">${esc(v)}</span><span class="block mt-0.5">${pastillaTipo(t)}</span>` },
        { titulo: 'Responsable', valor: t => (t.responsable ? t.responsable.nombre : ''), clase: 'whitespace-nowrap',
          pinta: v => (v ? esc(v) : '<span class="text-telecab-muted text-xs">Sin asignar</span>') },
        { titulo: 'Estado', valor: t => t.estadoEtiqueta, clase: 'whitespace-nowrap', pinta: (v, t) => pastillaEstado(t) },
        { titulo: 'Plazo', valor: t => t.plazo.venceEl || '', clase: 'whitespace-nowrap', pinta: (v, t) => semaforo(t, { largo: true }) || '<span class="text-telecab-muted text-xs">Sin plazo</span>' },
        { titulo: 'Creada', valor: t => t.creadaAt, clase: 'whitespace-nowrap', pinta: v => esc(fechaHora(v)) },
      ],
    });
  }

  // ── El filtro por persona, encima del tablero del equipo ────────────────
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  /**
   * Una tarjeta por persona que se ve (de las que más vencidas y abiertas lleva
   * a las que menos; quien no lleva nada, al final y apagada), y «Todos» delante.
   * La elegida, resaltada. Cuenta solo lo que cada uno LLEVA.
   */
  function pintarFiltro() {
    const caja = document.querySelector('#t-persona');
    const gente = [...carga].sort((a, b) => (b.vencidas - a.vencidas) || (b.abiertas - a.abiertas) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
    const abiertas = gente.reduce((n, x) => n + x.abiertas, 0);
    const vencidas = gente.reduce((n, x) => n + x.vencidas, 0);
    const resalte = 'border-color: rgb(var(--tc-gold)); background: rgb(var(--tc-gold) / .12);';
    const sub = (a, v) => `<span class="block text-[11px] text-telecab-muted whitespace-nowrap">${plural(a, 'abierta', 'abiertas')}${
      v ? ` · <span class="text-telecab-red font-semibold">${plural(v, 'vencida', 'vencidas')}</span>` : ''}</span>`;
    const boton = (id, cabeza, nombre, a, v, apagada) => {
      const elegida = String(id) === String(persona == null ? 'todos' : persona);
      return `<button type="button" data-filtro-persona="${esc(id)}" aria-pressed="${elegida}"
          class="flex-none flex items-center gap-2 px-3 py-2 rounded-xl border border-telecab-border bg-telecab-card2 hover:border-telecab-gold text-left transition"
          style="${elegida ? resalte : ''}${apagada && !elegida ? 'opacity:.55;' : ''}"
          title="${id === 'todos' ? 'El tablero de todo el equipo' : `El tablero de ${esc(nombre)}: solo lo que lleva`}">
        ${cabeza}
        <span class="min-w-0"><span class="block text-sm font-semibold truncate max-w-[11rem]">${esc(nombre)}</span>${sub(a, v)}</span>
      </button>`;
    };
    const elegido = persona ? ((carga.find(x => x.id === persona) || {}).nombre || nombreDe(persona)) : '';
    caja.innerHTML = `
      <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Ver el tablero de una persona">
        ${boton('todos', '<span class="tc-iniciales"><i class="fa-solid fa-people-group" aria-hidden="true"></i></span>', textoTodos(), abiertas, vencidas, false)}
        ${gente.map(x => boton(x.id, `<span class="tc-iniciales">${esc(iniciales(x.nombre))}</span>`, x.nombre, x.abiertas, x.vencidas, !x.abiertas)).join('')}
      </div>
      ${persona ? `<p class="text-xs text-telecab-muted mt-1">Tablero de <b class="text-telecab-text">${esc(elegido)}</b>: solo lo que lleva. Pulsa otra vez su tarjeta, o «${esc(textoTodos())}», para volver al general.</p>` : ''}`;
    caja.querySelectorAll('[data-filtro-persona]').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.filtroPersona === 'todos' ? null : Number(el.dataset.filtroPersona);
      elegirPersona(id === persona ? null : id);
    }));
  }

  /** El tablero de una persona, o el general con null. */
  function elegirPersona(p) {
    ponerPersona(p);
    mostrar();
  }

  // ── Elegir vista ────────────────────────────────────────────────────────
  /** Al cambiar de pestaña se quita el filtro por persona; al abrir la página, no (viene en el enlace). */
  function cambiarVista(v, { conservarPersona = false } = {}) {
    if (!conservarPersona && persona != null) ponerPersona(null);
    vista = v;
    mostrar();
  }

  function mostrar() {
    const enLista = vista === 'lista';
    const enEquipo = vista === 'equipo';
    document.querySelector('#t-tablero').classList.toggle('hidden', enLista);
    document.querySelector('#t-lista').classList.toggle('hidden', !enLista);
    document.querySelector('#t-persona').classList.toggle('hidden', !enEquipo);
    if (enLista) {
      const g = document.querySelector('#t-grupos');
      if (g) g.classList.add('hidden');
      if (!lista) montarLista(); else lista.recargar();
      return;
    }
    if (enEquipo) pintarFiltro();
    montarKanban();
    recargar();
  }

  // ── Formularios ─────────────────────────────────────────────────────────
  const campoPersona = (id, etiqueta, valor, ayuda) => ({
    id, etiqueta, tipo: 'lista', obligatorio: true, ayuda,
    opciones: personas.map(p => ({ valor: String(p.id), texto: p.nombre || `#${p.id}` })),
    valor: valor ? String(valor) : '',
  });
  const camposPlazo = (diasPorDefecto = '') => [
    { id: 'dias', etiqueta: 'Plazo en días hábiles', tipo: 'texto', valor: diasPorDefecto === '' ? '' : String(diasPorDefecto), marcador: 'Ej.: 3',
      ayuda: 'Cuentan desde mañana, sin fines de semana ni festivos. O pon una fecha límite abajo (si pones las dos, manda la fecha).' },
    { id: 'fecha', etiqueta: 'O fecha límite', tipo: 'fecha' },
  ];
  const plazoDe = v => (v.fecha ? { venceEl: v.fecha } : { plazoDias: v.dias === '' ? null : Number(String(v.dias).replace(',', '.')) });

  /** POST a una acción de la tarjeta; muestra el error si lo hay. → la tarjeta, o null. */
  async function hacer(id, accion, datos, aviso) {
    const r = await Api.post(`${API}/tarjetas/${id}/${accion}`, datos || {}, { aviso: aviso || 'No se ha podido' });
    if (!r) return null;
    recargarPronto();
    if (panel && panel.id === id) { turnoFicha++; pintarFicha(r.tarjeta); }
    return r.tarjeta;
  }

  async function nueva() {
    const v = await Dialogo.formulario('Nueva tarea', [
      { id: 'titulo', etiqueta: 'Qué hay que hacer', tipo: 'texto', obligatorio: true, max: 200, minimo: 3, marcador: 'Ej.: Llamar a la gestoría por el contrato de Luis' },
      { id: 'descripcion', etiqueta: 'Detalle (si hace falta)', tipo: 'texto-largo', max: 4000 },
      campoPersona('responsable', 'Quién la hace', yo.id, 'Puedes pedírtela a ti o a otra persona.'),
      ...camposPlazo(2),
    ], {
      textoBoton: 'Crear la tarea',
      nota: yo.aprueba ? 'La creas tú, que apruebas: empieza a contar ya.' : 'Si es para ti, empieza a contar ya. Si es para otra persona, estará a la espera de ser aprobada y el plazo empieza a contar cuando se apruebe.',
    });
    if (!v) return;
    const r = await Api.post(`${API}/tarjetas`, { titulo: v.titulo, descripcion: v.descripcion, responsableId: Number(v.responsable), ...plazoDe(v) },
      { aviso: 'No se ha creado' });
    if (!r) return;
    Dialogo.hecho(r.tarjeta.estado === 'por_aprobar' ? 'Pedida: espera la aprobación' : 'Tarea creada');
    recargarPronto();
    abrirFicha(r.tarjeta.id);
  }

  async function mover(t, estado) {
    let motivo = null;
    if (estado === 'bloqueada') {
      const v = await Dialogo.formulario(`Bloquear · ${t.titulo}`, [
        { id: 'motivo', etiqueta: 'Qué la bloquea', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000,
          marcador: 'Ej.: falta el justificante del conductor', ayuda: 'Se avisa a quien reparte las tarjetas, para que pueda desbloquearla.' },
      ], { textoBoton: 'Bloquear' });
      if (!v) return null;
      motivo = v.motivo;
    }
    return hacer(t.id, 'mover', { estado, motivo }, 'No se ha movido');
  }

  async function cerrar(t) {
    const vencida = t.plazo && t.plazo.semaforo === 'rojo';
    const campos = [
      { id: 'nota', etiqueta: 'En qué quedó', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 4000, marcador: 'Ej.: Hecho, se le mandó el contrato firmado' },
    ];
    if (t.tipo === 'ticket') {
      campos.push({ id: 'estadoOrigen', etiqueta: 'Cómo queda el ticket', tipo: 'lista', obligatorio: true, valor: 'ejecutado',
        opciones: [{ valor: 'ejecutado', texto: 'Ejecutado' }, { valor: 'rechazado', texto: 'Rechazado' }, { valor: 'no_procede', texto: 'No procede' }],
        ayuda: 'Cerrar la tarjeta cierra el ticket. Las vacaciones, bajas y permisos se «aplican» en su bandeja.' });
    }
    if (vencida) {
      campos.push({ id: 'motivoDemora', etiqueta: 'Por qué se cierra tarde', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000,
        ayuda: `Venció el ${dia(t.plazo.venceEl)}. Queda para medir los plazos.` });
    }
    const v = await Dialogo.formulario(`Cerrar · ${t.titulo}`, campos, { textoBoton: 'Cerrar la tarjeta' });
    if (!v) return null;
    return hacer(t.id, 'cerrar', { nota: v.nota, estadoOrigen: v.estadoOrigen, motivoDemora: v.motivoDemora }, 'No se ha cerrado');
  }

  const ACCIONES = {
    async aprobar(t) {
      const v = await Dialogo.formulario(`Aprobar · ${t.titulo}`, [
        campoPersona('responsable', 'Quién la hace', t.responsable && t.responsable.id),
        ...camposPlazo(t.plazo.dias == null ? '' : t.plazo.dias),
      ], { textoBoton: 'Aprobar', nota: 'El plazo empieza a contar ahora.' });
      if (!v) return;
      if (await hacer(t.id, 'aprobar', { responsableId: Number(v.responsable), ...plazoDe(v) }, 'No se ha aprobado')) Dialogo.hecho('Aprobada');
    },
    async rechazar(t) {
      const v = await Dialogo.formulario(`No aprobar · ${t.titulo}`, [
        { id: 'motivo', etiqueta: 'Por qué no', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'Le llega a quien la pidió.' },
      ], { textoBoton: 'No aprobarla' });
      if (v && await hacer(t.id, 'rechazar', { motivo: v.motivo }, 'No se ha rechazado')) Dialogo.hecho('No aprobada');
    },
    async asignar(t) {
      const v = await Dialogo.formulario(`Asignar · ${t.titulo}`, [campoPersona('responsable', 'Quién la lleva'), ...camposPlazo('')],
        { textoBoton: 'Asignar', nota: 'Responsable y plazo, los dos. El plazo empieza a contar ahora.' });
      if (v && await hacer(t.id, 'asignar', { responsableId: Number(v.responsable), ...plazoDe(v) }, 'No se ha asignado')) Dialogo.hecho('Asignada');
    },
    async reasignar(t) {
      const v = await Dialogo.formulario(`Reasignar · ${t.titulo}`, [
        campoPersona('responsable', 'Quién la lleva ahora'),
        { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'Se avisa a los dos y queda en su historia.' },
      ], { textoBoton: 'Reasignar' });
      if (v && await hacer(t.id, 'reasignar', { responsableId: Number(v.responsable), motivo: v.motivo }, 'No se ha reasignado')) Dialogo.hecho('Reasignada');
    },
    async plazo(t) {
      const v = await Dialogo.formulario(`Cambiar el plazo · ${t.titulo}`, [
        ...camposPlazo(''),
        { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'Cuenta desde ahora y queda en su historia.' },
      ], { textoBoton: 'Cambiar el plazo' });
      if (v && await hacer(t.id, 'plazo', { ...plazoDe(v), motivo: v.motivo }, 'No se ha cambiado')) Dialogo.hecho('Plazo cambiado');
    },
    async mover(t) {
      const opciones = TRABAJANDO.filter(e => e !== t.estado).map(e => ({ texto: COLUMNAS.trabajo.find(c => c.id === e).titulo, valor: e }));
      const destino = await Dialogo.elegir({ titulo: `Mover · ${t.titulo}`, texto: 'A qué columna.', opciones });
      if (destino) await mover(t, destino);
    },
    async cerrar(t) { if (await cerrar(t)) Dialogo.hecho('Cerrada'); },
    async anular(t) {
      const v = await Dialogo.formulario(`Anular · ${t.titulo}`, [
        { id: 'motivo', etiqueta: 'Por qué se anula', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'No se borra: queda anulada, con su historia.' },
      ], { textoBoton: 'Anular la tarjeta' });
      if (v && await hacer(t.id, 'anular', { motivo: v.motivo }, 'No se ha anulado')) Dialogo.hecho('Anulada');
    },
    async colaborador(t) {
      const v = await Dialogo.formulario(`Añadir a alguien · ${t.titulo}`, [campoPersona('persona', 'Quién colabora')], { textoBoton: 'Añadir' });
      if (v) await hacer(t.id, 'colaboradores', { usuarioId: Number(v.persona) }, 'No se ha añadido');
    },
  };
  const BOTONES = [
    ['aprobar', 'aprobar', 'fa-check', 'Aprobar', true], ['aprobar', 'rechazar', 'fa-xmark', 'No aprobar'],
    ['asignar', 'asignar', 'fa-user-check', 'Asignar', true],
    ['mover', 'mover', 'fa-arrow-right-arrow-left', 'Mover a…'], ['cerrar', 'cerrar', 'fa-circle-check', 'Cerrar', true],
    ['reasignar', 'reasignar', 'fa-user-pen', 'Reasignar'], ['cambiarPlazo', 'plazo', 'fa-calendar-days', 'Cambiar el plazo'],
    ['anular', 'anular', 'fa-ban', 'Anular', false, true],
  ];

  // ── La ficha (Panel) ────────────────────────────────────────────────────
  const HISTORIA = {
    creada: e => (e.datos && e.datos.origen
      ? `Nació de su origen${e.datos.responsable ? `, a nombre de ${e.datos.responsable}` : ''}` : `La pidió ${e.autor || 'alguien'}`),
    reabierta: e => `Volvió a estar pendiente en su origen: se reabrió${e.datos && e.datos.responsable ? ` a nombre de ${e.datos.responsable}` : ''}`,
    aprobada: e => (e.datos && e.datos.porQuienLaCrea ? 'Aprobada al crearla'
      : e.datos && e.datos.paraSiMismo ? 'Para sí: no pasa por aprobación' : `${e.autor || 'Alguien'} la aprobó`),
    rechazada: e => `${e.autor || 'Alguien'} no la aprobó`,
    asignada: e => (e.datos && e.datos.porSuOrigen ? 'Se hizo cargo desde su bandeja' : `${e.autor || 'Alguien'} la asignó a ${e.datos.responsable || '—'}`),
    reasignada: e => (e.datos && e.datos.porSuOrigen ? `Cambió en su origen: pasó de ${e.datos.de || '—'} a ${e.datos.a || '—'}`
      : `${e.autor || 'Alguien'} la pasó de ${e.datos.de || '—'} a ${e.datos.a || '—'}`),
    plazo: e => `${e.autor || 'Alguien'} cambió el plazo al ${dia(e.datos.venceEl)}`,
    estado: e => `${e.autor || 'Alguien'} la movió de «${(COLUMNAS.trabajo.find(c => c.id === e.datos.de) || {}).titulo || e.datos.de}» a «${(COLUMNAS.trabajo.find(c => c.id === e.datos.a) || {}).titulo || e.datos.a}»`,
    cerrada: e => (e.datos && e.datos.porSuOrigen ? 'Se cerró en su origen' : `${e.autor || 'Alguien'} la cerró${e.datos && e.datos.tarde ? ' (tarde)' : ''}`),
    anulada: e => `${e.autor || 'Alguien'} la anuló`,
    colaborador: e => `${e.autor || 'Alguien'} añadió a ${e.datos.persona}`,
    colaborador_fuera: e => `${e.autor || 'Alguien'} quitó a ${e.datos.persona}`,
    vencida: () => 'Venció: se avisó a quien la lleva y a su superior',
  };

  /**
   * El mensaje del que nace la tarea, dentro de la ficha (17/11/2026): quien
   * aprueba no tiene por qué estar en su canal. Si no está, no se le enseña el
   * enlace (le diría «no existe»), y se le dice por qué.
   */
  function origenHtml(t) {
    const o = t.origen;
    if (!o || o.tipo !== 'mensaje') return '';
    const cuerpo = o.anulado ? '<p class="text-sm italic text-telecab-muted">El mensaje se anuló.</p>'
      : `<p class="text-sm whitespace-pre-line">${esc(o.texto || '')}</p>`
        + (o.conFicheros ? '<p class="text-xs text-telecab-muted mt-1"><i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>Lleva ficheros: se ven en el chat.</p>' : '');
    return `<section class="tc-panel-seccion">
        <h4>El mensaje</h4>
        <div class="rounded-xl bg-telecab-card2 border border-telecab-border px-3 py-2">
          <div class="flex flex-wrap items-center gap-x-2 text-[11px] text-telecab-muted mb-1">
            <span class="font-semibold text-telecab-text">${esc(o.autor || '—')}</span><span>${esc(fechaHora(o.creadoAt))}</span><span>· ${esc(o.donde || '')}</span>
          </div>
          ${cuerpo}
        </div>
        ${o.puedeAbrir ? '' : '<p class="text-xs text-telecab-muted mt-1"><i class="fa-solid fa-lock mr-1" aria-hidden="true"></i>Es de un canal en el que no estás: aquí tienes el mensaje, pero no el resto de la conversación.</p>'}
      </section>`;
  }

  function pintarFicha(t) {
    if (!panel) return;
    const fila = (etq, html) => `<div class="flex gap-3 text-sm py-1"><span class="w-28 shrink-0 text-telecab-muted">${esc(etq)}</span><span class="min-w-0 flex-1">${html}</span></div>`;
    const botones = BOTONES.filter(([permiso]) => t.puede[permiso]).map(([, accion, icono, texto, principal, peligro]) =>
      `<button type="button" class="tc-boton ${principal ? 'tc-boton--principal' : ''} ${peligro ? 'tc-boton--peligro' : ''}" data-accion="${accion}">
        <i class="fa-solid ${icono}" aria-hidden="true"></i>${esc(texto)}</button>`).join('');
    const html = `
      <div class="flex flex-wrap items-center gap-2">${pastillaTipo(t)} ${pastillaEstado(t)} ${semaforo(t, { largo: true })}</div>
      ${botones ? `<div class="flex flex-wrap gap-2">${botones}</div>` : ''}
      <section class="tc-panel-seccion">
        <h4>Datos</h4>
        ${fila('Lleva', t.responsable ? esc(t.responsable.nombre) : '<span class="text-telecab-muted">Sin asignar</span>')}
        ${fila('Plazo', t.plazo.venceEl ? `${esc(dia(t.plazo.venceEl))}${t.plazo.dias != null ? ` <span class="text-telecab-muted">(${t.plazo.dias} días hábiles)</span>` : ''}`
          : t.plazo.dias != null ? `${t.plazo.dias} días hábiles <span class="text-telecab-muted">desde que se apruebe</span>` : '<span class="text-telecab-muted">Sin plazo</span>')}
        ${fila(t.tipo === 'manual' ? 'La pidió' : 'Nació', `${t.creadaPor ? esc(t.creadaPor.nombre) + ' · ' : ''}${esc(fechaHora(t.creadaAt))}`)}
        ${t.enlace && !(t.origen && t.origen.puedeAbrir === false) ? fila('Origen', `<a class="text-telecab-gold hover:underline" href="${esc(t.enlace)}">${esc(t.abrir || 'Abrir')} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i></a>`
          + (t.seCierraEnSuOrigen && !['cerrada', 'rechazada', 'anulada'].includes(t.estado)
            ? '<span class="block text-xs text-telecab-muted mt-0.5">Se cierra sola al resolverla allí.</span>' : '')) : ''}
        ${t.bloqueoMotivo ? fila('La bloquea', `<span class="text-telecab-red">${esc(t.bloqueoMotivo)}</span>`) : ''}
        ${t.cierreNota ? fila(t.estado === 'cerrada' ? 'En qué quedó' : 'Motivo', esc(t.cierreNota)) : ''}
        ${t.motivoDemora ? fila('Por qué tarde', esc(t.motivoDemora)) : ''}
      </section>
      <section class="tc-panel-seccion">
        <div data-ficheros-tarjeta></div>
      </section>
      ${origenHtml(t)}
      ${t.sensible ? '<p class="text-xs text-telecab-muted"><i class="fa-solid fa-lock mr-1" aria-hidden="true"></i>Lleva datos sensibles: el detalle se mira en su origen, con sus permisos.</p>'
        : t.descripcion ? `<section class="tc-panel-seccion"><h4>Detalle</h4><p class="text-sm whitespace-pre-line">${esc(t.descripcion)}</p></section>` : ''}
      <section class="tc-panel-seccion">
        <h4>Colaboran</h4>
        <div class="flex flex-wrap gap-2 items-center">
          ${t.colaboradores.map(id => `<span class="tc-pastilla">${esc(nombreDe(id))}${t.puede.colaboradores
            ? ` <button type="button" class="hover:text-telecab-red" data-quitar-colaborador="${id}" aria-label="Quitar a ${esc(nombreDe(id))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ''}</span>`).join('')
            || '<span class="text-xs text-telecab-muted">Nadie más</span>'}
          ${t.puede.colaboradores ? '<button type="button" class="tc-boton tc-boton--chico" data-accion="colaborador"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Añadir</button>' : ''}
        </div>
      </section>
      <section class="tc-panel-seccion">
        <h4>Comentarios</h4>
        <div class="space-y-2">${(t.comentariosLista || []).map(c => `
          <div class="rounded-xl bg-telecab-card2 border border-telecab-border px-3 py-2">
            <div class="flex items-center gap-2 text-[11px] text-telecab-muted">
              <span class="font-semibold text-telecab-text">${esc(c.autor || '—')}</span><span>${esc(fechaHora(c.en))}</span>
              ${c.mio ? `<button type="button" class="ml-auto hover:text-telecab-red" data-quitar-comentario="${c.id}" aria-label="Quitar mi comentario"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : ''}
            </div>
            ${c.texto ? `<p class="text-sm whitespace-pre-line mt-1">${esc(c.texto)}</p>` : ''}
            ${adjuntosHtml(c.adjuntos)}
          </div>`).join('') || '<p class="text-xs text-telecab-muted">Sin comentarios.</p>'}
        </div>
        ${t.puede.comentar ? `
          <form data-comentar class="mt-2 flex flex-col gap-2">
            <label for="t-comentario" class="sr-only">Escribe un comentario</label>
            <textarea id="t-comentario" rows="2" maxlength="4000" class="inp" placeholder="Escribe un comentario…"></textarea>
            <div data-pendientes class="flex flex-col gap-1.5"></div>
            <div data-gifs hidden class="rounded-xl border border-telecab-border bg-telecab-card2 p-2">
              <div class="flex items-center gap-2">
                <input type="search" data-gif-q class="inp" placeholder="Buscar un GIF en KLIPY…" aria-label="Buscar un GIF" autocomplete="off">
                <button type="button" data-gif-cerrar class="tc-boton tc-boton--chico" aria-label="Cerrar los GIF"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
              </div>
              <div data-gif-rejilla class="grid grid-cols-3 gap-1.5 mt-2 max-h-56 overflow-y-auto" aria-live="polite"></div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <label class="tc-boton tc-boton--chico cursor-pointer" title="Adjuntar ficheros: imágenes, vídeos, Word, Excel…">
                <i class="fa-solid fa-paperclip" aria-hidden="true"></i>Adjuntar
                <input type="file" multiple class="sr-only" data-fichero aria-label="Adjuntar ficheros al comentario">
              </label>
              <button type="button" class="tc-boton tc-boton--chico" data-gif-abrir title="Buscar un GIF"><i class="fa-solid fa-face-smile" aria-hidden="true"></i>GIF</button>
              <button type="submit" class="tc-boton ml-auto"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Comentar</button>
            </div>
          </form>` : ''}
      </section>
      <section class="tc-panel-seccion">
        <h4>Historia</h4>
        <ol class="space-y-1.5">${(t.historia || []).map(e => `
          <li class="text-sm flex gap-2"><span class="text-[11px] text-telecab-muted w-32 shrink-0 tabular-nums">${esc(fechaHora(e.en))}</span>
            <span>${esc((HISTORIA[e.tipo] || (() => e.tipo))(e))}${e.motivo ? `<span class="block text-xs text-telecab-muted">${esc(e.motivo)}</span>` : ''}</span></li>`).join('')}
        </ol>
      </section>`;
    panel.p.poner({ titulo: t.titulo, subtitulo: `${t.tipoEtiqueta} · ${t.estadoEtiqueta}`, html });
    panel.t = t;
    if (t.yo) yo.id = t.yo;
    // Los ficheros de la tarjeta: los pinta y los sube el componente de la casa.
    const cajaFicheros = panel.p.cuerpo.querySelector('[data-ficheros-tarjeta]');
    if (cajaFicheros && window.Adjuntos) {
      Adjuntos.montar(cajaFicheros, { tipo: 'tarea', dueno: t.id, titulo: 'Ficheros', puedeAdjuntar: !!t.puede.adjuntar, puedeQuitar: !!t.puede.adjuntar });
    }
    // El comentario a medias y sus ficheros sobreviven a volver a pintar la ficha.
    const ta = panel.p.cuerpo.querySelector('#t-comentario');
    if (ta && pendientes.texto) ta.value = pendientes.texto;
    pintarPendientes();
  }

  async function abrirFicha(id) {
    // Un comentario a medias es de la tarjeta en la que se escribió.
    pendientes = { borrador: null, items: [], texto: '' };
    const p = Panel.abrir({
      titulo: 'Cargando…', html: '<p class="text-sm text-telecab-muted">Cargando…</p>',
      alCerrar: () => {
        if (panel && panel.p === p) panel = null;
        const u = new URL(location.href);
        if (u.searchParams.has('tarjeta')) { u.searchParams.delete('tarjeta'); history.replaceState(history.state, '', u); }
      },
    });
    panel = { id, p, t: null };
    p.cuerpo.addEventListener('click', alPulsarFicha);
    p.cuerpo.addEventListener('submit', alComentar);
    p.cuerpo.addEventListener('change', alElegirFichero);
    p.cuerpo.addEventListener('input', alEscribirComentario);
    const turno = ++turnoFicha;
    const r = await Api.get(`${API}/tarjetas/${id}`).catch(e => { p.poner({ titulo: 'No se ha podido abrir', html: `<p class="text-sm text-telecab-warn">${esc(e.message)}</p>` }); return null; });
    if (r && panel && panel.p === p && turno === turnoFicha) pintarFicha(r.tarjeta);
  }

  async function refrescarFicha() {
    if (!panel) return;
    const turno = ++turnoFicha;
    const id = panel.id;
    const r = await Api.get(`${API}/tarjetas/${id}`).catch(() => null);
    if (r && panel && panel.id === id && turno === turnoFicha) pintarFicha(r.tarjeta);
  }

  async function alPulsarFicha(e) {
    if (!panel || !panel.t) return;
    const t = panel.t;
    const b = e.target.closest('[data-accion], [data-quitar-colaborador], [data-quitar-comentario], [data-ver-adjunto], [data-quitar-pendiente], [data-gif-id], [data-gif-abrir], [data-gif-cerrar]');
    if (!b) return;
    if (b.dataset.verAdjunto) {
      const a = adjuntoDeLaFicha(t, b.dataset.verAdjunto);
      if (a) Adjuntos.ver(a);
      return;
    }
    if (b.dataset.quitarPendiente) return quitarPendiente(b.dataset.quitarPendiente);
    if (b.dataset.gifId) return alElegirGif(b.dataset.gifId);
    if ('gifAbrir' in b.dataset) return cajaGifs(true);
    if ('gifCerrar' in b.dataset) return cajaGifs(false);
    if (b.dataset.accion && ACCIONES[b.dataset.accion]) return ACCIONES[b.dataset.accion](t);
    if (b.dataset.quitarColaborador) {
      return hacer(t.id, 'colaboradores', { usuarioId: Number(b.dataset.quitarColaborador), quitar: true }, 'No se ha quitado');
    }
    if (b.dataset.quitarComentario) {
      const si = await Dialogo.confirmar({ titulo: 'Quitar tu comentario', texto: 'Deja de verse; queda en el libro.', si: 'Quitarlo', no: 'Cancelar' });
      if (!si) return;
      const r = await Api.post(`${API}/comentarios/${b.dataset.quitarComentario}/anular`, {}, { aviso: 'No se ha quitado' });
      if (r) { turnoFicha++; pintarFicha(r.tarjeta); }
    }
  }

  // ── Ficheros y GIF de un comentario (18/11/2026, db/270) ───────────────────

  /** Pinta un fichero de un comentario o de la tarjeta: las imágenes y los GIF, a la vista. */
  function adjuntosHtml(adjs) {
    if (!adjs || !adjs.length) return '';
    return `<div class="mt-2 flex flex-wrap gap-2">${adjs.map(a => (a.clase === 'imagen'
      ? `<button type="button" data-ver-adjunto="${a.id}" class="block rounded-lg overflow-hidden border border-telecab-border bg-telecab-card" aria-label="Ver ${esc(a.nombre)}" title="${esc(a.nombre)}"><img src="${esc(a.url)}" alt="${esc(a.nombre)}" loading="lazy" class="max-h-48 max-w-full block"></button>`
      : `<button type="button" data-ver-adjunto="${a.id}" class="tc-pastilla hover:text-telecab-gold" title="${esc(a.nombre)}"><i class="fa-solid ${ICONO_FICHERO[a.clase] || 'fa-file'}" aria-hidden="true"></i> ${esc(a.nombre)}</button>`)).join('')}</div>`;
  }

  /** Un fichero de la ficha abierta (de la tarjeta o de un comentario), por su id. */
  function adjuntoDeLaFicha(t, id) {
    const todos = [...(t.adjuntos || []), ...(t.comentariosLista || []).flatMap(c => c.adjuntos || [])];
    return todos.find(a => String(a.id) === String(id));
  }

  function nuevoBorrador() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return `${yo.id}-${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  }

  /** La lista de lo que se va a mandar con el comentario, con su progreso o su error. */
  function pintarPendientes() {
    const caja = panel && panel.p.cuerpo.querySelector('[data-pendientes]');
    if (!caja) return;
    caja.innerHTML = pendientes.items.map(it => `
      <div class="flex items-center gap-2 text-xs rounded-lg bg-telecab-card2 border border-telecab-border px-2 py-1.5">
        ${it.adjunto && it.adjunto.clase === 'imagen'
          ? `<img src="${esc(it.adjunto.url)}" alt="" class="h-10 w-10 object-cover rounded">`
          : `<i class="fa-solid ${it.estado === 'error' ? 'fa-triangle-exclamation text-telecab-warn' : 'fa-paperclip text-telecab-muted'}" aria-hidden="true"></i>`}
        <span class="min-w-0 flex-1 truncate" title="${esc(it.nombre)}">${esc(it.nombre)}</span>
        <span class="tabular-nums text-telecab-muted">${it.estado === 'subiendo' ? `${it.pct} %` : it.estado === 'error' ? esc(it.error) : ''}</span>
        <button type="button" data-quitar-pendiente="${esc(it.id)}" class="hover:text-telecab-red" aria-label="Quitar ${esc(it.nombre)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>`).join('');
  }

  /** Lo que se escribe: el texto (para no perderlo al volver a pintar) y la búsqueda de GIF. */
  function alEscribirComentario(e) {
    if (e.target.matches('#t-comentario')) { pendientes.texto = e.target.value; return; }
    if (e.target.matches('[data-gif-q]')) {
      clearTimeout(temporizadorGif);
      const q = e.target.value.trim();
      temporizadorGif = setTimeout(() => buscarGifs(q), 400);
    }
  }

  /** Los ficheros que se eligen (o se sueltan) se suben ya a un borrador, con su progreso. */
  function alElegirFichero(e) {
    const input = e.target.closest('[data-fichero]');
    if (!input || !input.files || !input.files.length) return;
    const ficheros = [...input.files];
    input.value = '';
    ficheros.forEach(subirAlBorrador);
  }

  function subirAlBorrador(fichero) {
    pendientes.borrador = pendientes.borrador || nuevoBorrador();
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nombre: fichero.name, estado: 'subiendo', pct: 0, adjunto: null, error: null };
    pendientes.items.push(item);
    pintarPendientes();
    Adjuntos.subir({ tipo: 'tarea_borrador', dueno: pendientes.borrador, fichero, alProgresar: p => { item.pct = Math.round(p * 100); pintarPendientes(); } })
      .then(a => {
        item.estado = 'listo'; item.adjunto = a;
        // Si se quitó mientras subía, no se queda en el borrador.
        if (!pendientes.items.includes(item)) anularAdjunto(a.id);
      })
      .catch(err => { item.estado = 'error'; item.error = err.message; })
      .finally(pintarPendientes);
  }

  /** Quitar un fichero de los que van con el comentario: se anula en el servidor si ya estaba subido. */
  function quitarPendiente(id) {
    const it = pendientes.items.find(x => x.id === id);
    if (!it) return;
    pendientes.items = pendientes.items.filter(x => x !== it);
    pintarPendientes();
    if (it.adjunto) anularAdjunto(it.adjunto.id);
  }

  function anularAdjunto(id) {
    Api.post(`/adjuntos/api/${id}/anular`, { motivo: 'Quitado antes de mandar el comentario' }).catch(() => {});
  }

  /** Abrir o cerrar la caja de los GIF; al abrirla, se pone el cursor en la búsqueda. */
  function cajaGifs(abrir) {
    const caja = panel && panel.p.cuerpo.querySelector('[data-gifs]');
    if (!caja) return;
    caja.hidden = !abrir;
    if (abrir) {
      const q = caja.querySelector('[data-gif-q]');
      q.focus();
      if (!caja.querySelector('[data-gif-id]')) buscarGifs('');
    }
  }

  /** Busca GIF en KLIPY (lo que pide el servidor); sin texto, los más vistos. */
  async function buscarGifs(q) {
    const rejilla = panel && panel.p.cuerpo.querySelector('[data-gif-rejilla]');
    if (!rejilla) return;
    rejilla.innerHTML = '<p class="text-xs text-telecab-muted col-span-full">Buscando…</p>';
    const r = await Api.get(`${API}/gifs?q=${encodeURIComponent(q)}`).catch(err => {
      rejilla.innerHTML = `<p class="text-xs text-telecab-warn col-span-full">${esc(err.message)}</p>`;
      return null;
    });
    if (!r) return;
    rejilla.innerHTML = r.gifs.map(g => `
      <button type="button" data-gif-id="${esc(g.id)}" title="${esc(g.titulo || 'GIF')}" aria-label="Añadir el GIF ${esc(g.titulo || '')}" class="rounded-lg overflow-hidden border border-telecab-border hover:border-telecab-gold">
        <img src="${esc(g.vista.url)}" alt="" loading="lazy" class="w-full h-20 object-cover block">
      </button>`).join('') || '<p class="text-xs text-telecab-muted col-span-full">Ningún GIF con eso.</p>';
  }

  /** Un GIF elegido: se trae al borrador y sale en la lista, con los ficheros. */
  async function alElegirGif(gifId) {
    pendientes.borrador = pendientes.borrador || nuevoBorrador();
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nombre: 'GIF', estado: 'subiendo', pct: 0, adjunto: null, error: null };
    pendientes.items.push(item);
    pintarPendientes();
    const r = await Api.post(`${API}/gif`, { gifId, borrador: pendientes.borrador }, { aviso: 'No se ha podido traer el GIF' });
    if (r && r.adjunto) {
      item.estado = 'listo'; item.adjunto = r.adjunto; item.nombre = r.adjunto.nombre;
      if (!pendientes.items.includes(item)) anularAdjunto(r.adjunto.id);
    } else {
      item.estado = 'error'; item.error = 'No se ha podido traer el GIF';
    }
    pintarPendientes();
  }

  /** Mandar el comentario: con texto, con ficheros o con GIF; no sale si alguno no se ha subido. */
  async function alComentar(e) {
    if (!e.target.matches('[data-comentar]') || !panel) return;
    e.preventDefault();
    const caja = e.target.querySelector('textarea');
    const texto = caja.value.trim();
    if (pendientes.items.some(x => x.estado === 'subiendo')) {
      Dialogo.aviso({ titulo: 'Espera un momento', texto: 'Aún se están subiendo ficheros: el comentario sale cuando acaben.' });
      return;
    }
    if (pendientes.items.some(x => x.estado === 'error')) {
      Dialogo.aviso({ titulo: 'Un fichero no se ha subido', texto: 'Quítalo con la ✕ o vuelve a elegirlo antes de comentar.', tono: 'error' });
      return;
    }
    const listos = pendientes.items.filter(x => x.estado === 'listo');
    if (!texto && !listos.length) { caja.focus(); return; }
    const r = await Api.post(`${API}/tarjetas/${panel.id}/comentarios`, { texto, borrador: listos.length ? pendientes.borrador : null },
      { aviso: 'No se ha guardado el comentario', boton: e.target.querySelector('button[type="submit"]') });
    if (r) {
      pendientes = { borrador: null, items: [], texto: '' };
      turnoFicha++; pintarFicha(r.tarjeta); recargarPronto();
    }
  }

  // ── El recorrido, la primera vez (y con el botón, cuando se quiera) ───────
  // Camilo (17/11/2026): «un recorrido por el tablero de tareas». Los pasos se
  // miran al empezar; una columna que no está en la vista de ahora se salta.
  function pasosTablero() {
    return [
      { icono: 'fa-table-columns', titulo: 'El tablero de tareas',
        texto: 'Todo lo que hay que hacer en la oficina, en un solo sitio: lo que te piden, lo que pides y lo que llega solo de otras pantallas. Te lo enseño en un minuto.' },
      { sel: '#t-pestanas', icono: 'fa-layer-group', titulo: 'Las vistas',
        texto: '«Mi tablero»: lo que llevas, lo que pediste y donde colaboras. «Mi equipo»: lo de tu gente; arriba, una tarjeta por persona: púlsala y ves solo lo que lleva. «Por repartir», solo a quien aprueba o reparte. «Lista»: todo, con buscador, filtros y Excel.' },
      { sel: '#t-nueva', icono: 'fa-plus', titulo: 'Nueva tarea',
        texto: 'Para ti o para otra persona: qué hay que hacer, quién la hace y el plazo en días hábiles (sin fines de semana ni festivos). También nace desde un mensaje del chat, con «Convertir en tarea».' },
      { sel: '[data-columna="por_aprobar"]', icono: 'fa-user-check', titulo: 'Por aprobar',
        texto: 'Si no apruebas tareas, la que pides para otra persona estará aquí a la espera de ser aprobada; su plazo empieza a contar cuando se apruebe. Si se rechaza, te llega el porqué. La que te pides a ti no espera.' },
      { sel: '[data-columna="por_hacer"]', icono: 'fa-arrows-left-right', titulo: 'Por hacer y en curso',
        texto: 'Cuando empieces, arrastra la tarjeta a «En curso» (o ábrela y cámbiala). Con el teclado, Intro la abre.' },
      { sel: ['#t-tablero .tc-tarjeta', '[data-columna="en_curso"]'], icono: 'fa-traffic-light', titulo: 'El semáforo del plazo',
        texto: 'Verde: queda plazo. Amarillo: vence hoy. Rojo: vencida. Si vence, os llega un aviso a ti y a tu superior. Al abrir la tarjeta ves su ficha: comentarios, quién colabora y toda su historia.' },
      { sel: '[data-columna="bloqueada"]', icono: 'fa-hand', titulo: 'Bloqueada',
        texto: 'Si algo te frena, bloquéala diciendo qué: se avisa a quien reparte las tareas para que pueda desbloquearla.' },
      { sel: '[data-columna="cerrada"]', icono: 'fa-circle-check', titulo: 'Cerrada',
        texto: 'Al cerrarla dices en qué quedó (y, si va tarde, por qué). Las que llegan solas (las J, las −J, las correcciones de fichaje, las vacaciones y los tickets) se cierran solas al resolverlas en su pantalla. La que nació en el chat responde en el hilo de su mensaje.' },
      { sel: '#t-recorrido', icono: 'fa-route', titulo: 'Otra vez',
        texto: 'Este recorrido, cuando quieras.' },
    ];
  }
  // novedades.js se carga con `defer`: puede llegar después que esta pantalla.
  const conNovedades = fn => {
    if (window.Novedades) fn(window.Novedades);
    else addEventListener('DOMContentLoaded', () => { if (window.Novedades) fn(window.Novedades); });
  };
  document.querySelector('#t-recorrido').addEventListener('click', () => conNovedades(N => N.recorridoDe('tablero', pasosTablero)));

  // ── Arranque ────────────────────────────────────────────────────────────
  (async function () {
    try {
      const [y, p] = await Promise.all([Api.get(`${API}/yo`), Api.get(`${API}/personas`)]);
      Object.assign(yo, y.yo);
      personas = p.personas || [];
    } catch (e) {
      document.querySelector('#t-tablero').innerHTML = `<p class="text-sm text-telecab-warn">No se ha podido abrir el tablero: ${esc(e.message)}</p>`;
      return;
    }
    const pestanas = [
      { id: 'mias', texto: 'Mi tablero', icono: 'fa-table-columns', contador: 'tareas.mias' },
      { id: 'equipo', texto: textoTodos(), icono: 'fa-people-group' },
    ];
    if (yo.aprueba || yo.asigna) pestanas.push({ id: 'pendientes', texto: 'Por repartir', icono: 'fa-inbox', contador: yo.asigna ? 'tareas.por_asignar' : 'tareas.por_aprobar' });
    pestanas.push({ id: 'lista', texto: 'Lista', icono: 'fa-list' });
    const p = Pestanas.montar(document.querySelector('#t-pestanas'), { pestanas, param: 'vista', alCambiar: v => cambiarVista(v) });
    cambiarVista(p.actual(), { conservarPersona: true });

    document.querySelector('#t-nueva').addEventListener('click', nueva);
    // Lo que cambia en el servidor llega solo (A7); sin directo, cada minuto.
    TiempoReal.escuchar('tablero', {
      alLlegar: d => { recargarPronto(); if (panel && d && d.id === panel.id) refrescarFicha(); },
      sondear: () => { recargar(); refrescarFicha(); },
      cada: 60000,
    });
    // ?tarjeta=ID: la que trae una notificación o un enlace.
    const id = Number(new URLSearchParams(location.search).get('tarjeta'));
    if (Number.isSafeInteger(id) && id > 0) abrirFicha(id);
    // La primera vez que entra, el recorrido (espera a que no haya una ficha abierta).
    conNovedades(N => N.primeraVez('tablero', pasosTablero));
  })();
})();
