// modules/Control/vistas/controlCampanas.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const hora = ts => (ts ? new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');

  // El buzón y los tipos de J los manda el servidor: una sola lista para todo.
  const RESULTADOS = DEL_SERVIDOR.resultadosLlamada;
  const TIPOS_J = DEL_SERVIDOR.tiposJ;

  let D = null;              // el estado que manda /api/campanas
  let tabVista = null;       // qué campaña se está mirando (null = la activa)
  const qsTurno = new URLSearchParams(location.search).get('turno');
  let turnoVista = qsTurno === 'dia' || qsTurno === 'noche' ? qsTurno : null; // null = por reloj
  const hh = n => String(n).padStart(2, '0') + ':00';

  // ── La calificación al lado del nombre, igual que en el cockpit ──
  const REND_TONO = { A: 'bg-emerald-500/20 text-emerald-400', B: 'bg-telecab-gold/20 text-telecab-gold',
    C: 'bg-amber-500/15 text-amber-500', D: 'bg-red-500/15 text-red-500', N: 'bg-sky-500/15 text-sky-400' };
  function chipRend(r) {
    if (!r) return '';
    if (r.nuevo) return '<span class="px-1.5 rounded text-[10px] font-bold ' + REND_TONO.N + '">N/E</span>';
    if (!r.dias) return '';
    return '<span class="px-1.5 rounded text-[10px] font-bold ' + (REND_TONO[r.letra] || REND_TONO.D) + '">' +
      String(r.horas).replace('.', ',') + ' h · ' + r.letra + '</span>';
  }

  // ── Una fila de conductor, con su teléfono y sus botones ──
  function fila(p, { conEtiqueta = false, conVerificacion = false } = {}) {
    const etq = conEtiqueta && p.etiqueta
      ? '<div class="text-[11px] mt-0.5"><span class="px-1.5 py-0.5 rounded bg-telecab-card2 text-telecab-text font-semibold">' + esc(p.etiqueta) + '</span>' +
        ' <span class="text-telecab-muted">por <b>' + esc(p.etiquetadoPor || '¿?') + '</b> a las ' + hora(p.etiquetadoA) +
        (p.llamadas > 1 ? ' · ' + p.llamadas + ' llamadas' : '') + '</span>' +
        (p.nota ? '<div class="text-telecab-muted mt-0.5">«' + esc(p.nota) + '»</div>' : '') + '</div>'
      : '';
    const verif = conVerificacion && p.verificacion
      ? (p.verificacion === 'cumplio'
        ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400"><i class="fa-solid fa-check"></i> se conectó</span>'
        : '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-telecab-red/15 text-telecab-red"><i class="fa-solid fa-xmark"></i> dijo que salía y sigue sin conectarse</span>')
      : '';
    return '<div class="px-4 py-2.5 border-b border-telecab-border/50 flex items-start gap-3" data-cid="' + esc(p.conductorId) + '">' +
      '<div class="min-w-0 flex-1">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="font-medium text-sm">' + esc(p.conductor) + '</span>' + chipRend(p.rendimiento) + verif +
        '</div>' +
        '<div class="text-[11px] text-telecab-muted font-mono tabular-nums">' + (esc(p.telefono) || 'sin teléfono') +
          (p.matricula ? ' · ' + esc(p.matricula) : '') + (p.turno === 'todoturno' ? ' · TodoTurno' : '') + '</div>' +
        etq +
      '</div>' +
      '<div class="flex items-center gap-1.5 shrink-0">' +
        (p.telefono ? '<a href="tel:' + esc(p.telefono) + '" class="w-8 h-8 rounded-lg bg-telecab-card2 border border-telecab-border flex items-center justify-center text-telecab-green" title="Llamar"><i class="fa-solid fa-phone"></i></a>' : '') +
        '<button data-etiquetar class="px-2.5 h-8 rounded-lg bg-telecab-gold text-telecab-dark text-xs font-semibold" title="Apuntar la llamada con su resultado">Etiquetar</button>' +
        '<button data-j class="w-8 h-8 rounded-lg bg-telecab-card2 border border-telecab-border text-sky-400 text-xs font-bold" title="Justificar el día">J</button>' +
      '</div>' +
    '</div>';
  }

  function seccion(titulo, filasHtml, vacio) {
    return '<div class="bg-telecab-card border border-telecab-border rounded-2xl overflow-hidden mb-3">' +
      '<div class="px-4 py-2.5 border-b border-telecab-border text-xs font-semibold uppercase tracking-wide text-telecab-muted">' + titulo + '</div>' +
      (filasHtml || '<p class="px-4 py-6 text-center text-sm text-telecab-muted">' + vacio + '</p>') +
    '</div>';
  }

  // ── Las tres campañas ──
  // Sin campaña abierta, se abre la 1 si aún no empiezan o la 3 si ya cerraron.
  const vistaPorDefecto = () => tabVista || D.campanaActiva ||
    (D.campanas.every(c => c.estado === 'terminada') ? 3 : 1);

  function pintarTabs() {
    const vista = vistaPorDefecto();
    $('#c-tabs').innerHTML = D.campanas.map(c => {
      const on = c.n === vista;
      return '<button data-tab="' + c.n + '" class="px-3.5 py-2 rounded-xl text-sm font-semibold border transition ' +
        (on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold' :
              'bg-telecab-card border-telecab-border text-telecab-muted hover:text-telecab-text') + '">' +
        'Campaña ' + c.n + ' · ' + hh(c.abre) + '–' + hh(c.cierra) +
        (c.estado === 'abierta' ? ' <span class="ml-1 inline-block w-2 h-2 rounded-full ' + (on ? 'bg-telecab-dark' : 'bg-telecab-green') + '"></span>' : '') +
        (c.estado === 'pronto' ? ' <span class="opacity-60">(aún no abre)</span>' : '') +
        (c.estado === 'terminada' ? ' <span class="opacity-60">(cerrada)</span>' : '') +
        '</button>';
    }).join('');
    $('#c-tabs').querySelectorAll('[data-tab]').forEach(b =>
      b.addEventListener('click', () => { tabVista = Number(b.dataset.tab); pintar(); }));
  }

  function pintarDetalle() {
    const vista = vistaPorDefecto();
    const meta = D.campanas.find(c => c.n === vista) || {};
    let html = '<p class="text-sm text-telecab-muted mb-3"><b class="text-telecab-text">' + esc(meta.titulo) + '.</b> ' + esc(meta.detalle) + '.' +
      (meta.estado === 'pronto' ? ' <span class="text-telecab-warn">Abre a las ' + hh(meta.abre) + '; se puede adelantar si hace falta.</span>' : '') +
      (meta.estado === 'terminada' ? ' <span class="text-telecab-muted/80">Su ventana (' + hh(meta.abre) + '–' + hh(meta.cierra) + ') ya se cerró.</span>' : '') + '</p>';

    if (vista === 1) {
      html += seccion('Sin conectar y sin llamar · ' + D.c1.length,
        D.c1.map(p => fila(p)).join(''), 'Nadie pendiente de primera llamada.');
    } else if (vista === 2) {
      html += seccion('Etiquetados en la primera · a insistir · ' + D.c2.etiquetados.length,
        D.c2.etiquetados.map(p => fila(p, { conEtiqueta: true, conVerificacion: true })).join(''),
        'Nadie etiquetado pendiente.');
      html += seccion('Con interrogación · nadie los ha llamado · ' + D.c2.interrogacion.length,
        D.c2.interrogacion.map(p => fila(p)).join(''), 'No queda nadie sin llamar.');
      html += seccion('Dijeron que salían y CUMPLIERON · ' + D.c2.cumplieron.length,
        D.c2.cumplieron.map(p => fila(p, { conEtiqueta: true, conVerificacion: true })).join(''),
        'Todavía ninguno verificado.');
    } else {
      html += seccion('Repaso · siguen sin conectarse · ' + D.c3.length,
        D.c3.map(p => fila(p, { conEtiqueta: true, conVerificacion: true })).join(''),
        'Nadie pendiente: todos conectados, justificados o avisados.');
    }
    $('#c-detalle').innerHTML = html;

    // Los botones de cada fila.
    $('#c-detalle').querySelectorAll('[data-cid]').forEach(el => {
      const p = buscar(el.dataset.cid);
      if (!p) return;
      const be = el.querySelector('[data-etiquetar]');
      if (be) be.addEventListener('click', () => etiquetar(p));
      const bj = el.querySelector('[data-j]');
      if (bj) bj.addEventListener('click', () => justificar(p));
    });
  }

  function buscar(cid) {
    const todos = [].concat(D.c3, D.c2.cumplieron, D.activos, D.listaRoja, D.noAsisten,
      ...Object.values(D.justificados || {}));
    return todos.find(p => p && String(p.conductorId) === String(cid)) || null;
  }

  // ── Las listas de consulta ──
  function pintarListas() {
    $('#t-activos').textContent = D.activos.length;
    $('#l-activos').innerHTML = D.activos.map(p =>
      '<div class="px-4 py-2 border-b border-telecab-border/50 flex items-center gap-2 text-sm">' +
        '<i class="fa-solid fa-circle text-[6px] text-telecab-green"></i>' +
        '<span class="flex-1 min-w-0 truncate">' + esc(p.conductor) + '</span>' +
        '<span class="text-[11px] text-telecab-muted tabular-nums">' + Math.floor(p.minutos / 60) + 'h' + String(p.minutos % 60).padStart(2, '0') + '</span>' +
      '</div>').join('') || '<p class="px-4 py-6 text-center text-sm text-telecab-muted">Nadie conectado todavía.</p>';

    const tot = Object.values(D.justificados || {}).reduce((a, l) => a + l.length, 0);
    $('#t-just').textContent = tot;
    $('#l-just').innerHTML = TIPOS_J.map(t => {
      const lista = (D.justificados || {})[t.codigo] || [];
      if (!lista.length) return '';
      return '<div class="px-4 py-1.5 bg-telecab-card2/60 text-[11px] font-semibold uppercase tracking-wide text-telecab-muted">' +
          esc(t.etiqueta) + ' · ' + lista.length + '</div>' +
        lista.map(p => '<div class="px-4 py-2 border-b border-telecab-border/50 text-sm">' +
          '<div class="flex items-center gap-2"><span class="flex-1 min-w-0 truncate">' + esc(p.conductor) + '</span>' +
          (p.j.horas != null ? '<span class="text-[11px] text-sky-400 font-semibold">J ' + String(p.j.horas).replace('.', ',') + ' h</span>' : '<span class="text-[11px] text-sky-400 font-semibold">J</span>') + '</div>' +
          '<div class="text-[11px] text-telecab-muted truncate">«' + esc(p.j.obs) + '» · ' + esc(p.j.quien || '') + '</div>' +
        '</div>').join('');
    }).join('') || '<p class="px-4 py-6 text-center text-sm text-telecab-muted">Ninguna J hoy.</p>';

    $('#t-roja').textContent = D.listaRoja.length;
    $('#l-roja').innerHTML = D.listaRoja.map(p =>
      '<div class="px-4 py-2 border-b border-telecab-border/50 text-sm" data-cid="' + esc(p.conductorId) + '">' +
        '<div class="flex items-center gap-2">' +
          '<span class="flex-1 min-w-0 truncate font-medium">' + esc(p.conductor) + '</span>' + chipRend(p.rendimiento) +
          '<button data-etiquetar class="px-2 h-7 rounded-lg bg-telecab-gold text-telecab-dark text-[11px] font-semibold">Etiquetar</button>' +
        '</div>' +
        '<div class="text-[11px] text-telecab-muted font-mono tabular-nums">' + (esc(p.telefono) || 'sin teléfono') +
          (p.etiqueta ? ' · ' + esc(p.etiqueta) + ' (' + esc(p.etiquetadoPor || '') + ')' : ' · sin llamar') + '</div>' +
      '</div>').join('') || '<p class="px-4 py-6 text-center text-sm text-telecab-muted">Vacía. Buen día.</p>';
    $('#l-roja').querySelectorAll('[data-cid]').forEach(el => {
      const p = buscar(el.dataset.cid);
      const b = el.querySelector('[data-etiquetar]');
      if (p && b) b.addEventListener('click', () => etiquetar(p));
    });
  }

  // ── Acciones: etiquetar (llamada) y justificar, contra las APIs de siempre ──
  async function etiquetar(p) {
    const v = await Dialogo.formulario('He llamado a ' + p.conductor, [
      { id: 'resultado', etiqueta: 'Qué ha pasado', tipo: 'lista', obligatorio: true,
        valor: RESULTADOS[0], opciones: RESULTADOS },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo' },
    ], { nota: 'Queda la traza: tú, la hora y el resultado. La etiqueta decide su cola en la campaña siguiente.' });
    if (!v || !v.resultado) return;
    try {
      const r = await fetch('/control/api/llamada', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conductorId: p.conductorId, conductor: p.conductor, telefono: p.telefono,
          matricula: p.matricula, turno: p.turno || D.turno,
          resultado: v.resultado, nota: v.nota || '', dia: D.dia,
          // Se apunta a la campaña ABIERTA; mirando otra pestaña con una
          // abierta, la llamada sigue siendo de la abierta (es la hora la
          // que manda). Sin ninguna abierta, a la que se está mirando.
          origen: 'campana' + (D.campanaActiva || tabVista || 1),
        }),
      }).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo guardar');
      cargar();
    } catch (e) { Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  async function justificar(p) {
    const v = await Dialogo.formulario('Justificar a ' + p.conductor, [
      { id: 'tipo', etiqueta: 'Tipo', tipo: 'lista', obligatorio: true,
        valor: TIPOS_J[0].codigo, opciones: TIPOS_J.map(t => ({ valor: t.codigo, texto: t.etiqueta })) },
      { id: 'horas', etiqueta: 'Horas que se justifican (opcional)', tipo: 'horas', ayuda: 'Se SUMAN a las de BOLT.' },
      { id: 'observacion', etiqueta: 'Observación', tipo: 'texto-largo', obligatorio: true },
    ], { nota: 'La J lo saca de las campañas y lo apunta en la bitácora con tu nombre.' });
    if (!v || !v.observacion) return;
    try {
      const r = await fetch('/control/api/justificar-directo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conductorId: p.conductorId, dia: D.dia,
          horas: v.horas || '', observacion: v.observacion, tipo: v.tipo }),
      }).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo justificar');
      cargar();
    } catch (e) { Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  // ── Carga y refresco ──
  function pintarTurnos() {
    $('#c-turnos').querySelectorAll('[data-turno]').forEach(b => {
      const on = b.dataset.turno === D.turno;
      b.className = 'px-3 py-2 text-sm transition ' + (on
        ? 'bg-telecab-gold text-telecab-dark font-semibold'
        : 'bg-telecab-card text-telecab-muted hover:text-telecab-text');
    });
    const c = D.campanas;
    $('#c-ventanas').textContent = 'Las del turno ' + (D.turno === 'noche' ? 'noche' : 'día') +
      ' van de ' + hh(c[0].abre) + ' a ' + hh(c[c.length - 1].cierra) +
      (D.turno !== D.turnoDelReloj ? ' (ahora el reloj va por el turno ' + (D.turnoDelReloj === 'noche' ? 'noche' : 'día') + ').' : '.') +
      (D.resumen.aunNoLesToca ? ' ' + D.resumen.aunNoLesToca + ' del plan aún no arrancan su turno.' : '');
    const a = $('#c-informe');
    if (a) a.href = '/control/campanas' + (turnoVista ? '?turno=' + turnoVista : '');
  }

  function pintar() { pintarTurnos(); pintarTabs(); pintarDetalle(); pintarListas(); }

  async function cargar() {
    try {
      const r = await fetch('/control/api/campanas' + (turnoVista ? '?turno=' + turnoVista : '')).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'Error');
      D = r;
      $('#r-plan').textContent = D.resumen.plan;
      $('#r-activos').textContent = D.resumen.activos;
      $('#r-pendientes').textContent = D.resumen.pendientes;
      $('#r-sinllamar').textContent = D.resumen.sinLlamar;
      $('#r-just').textContent = D.resumen.justificados;
      $('#r-roja').textContent = D.resumen.listaRoja;
      $('#c-actualizado').textContent = '· actualizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      pintar();
    } catch (e) {
      $('#c-detalle').innerHTML = '<p class="px-4 py-8 text-center text-sm text-telecab-red">' + esc(e.message) + '</p>';
    }
  }

  document.querySelectorAll('[data-abre]').forEach(b =>
    b.addEventListener('click', () => $('#' + b.dataset.abre).classList.toggle('hidden')));
  $('#c-turnos').querySelectorAll('[data-turno]').forEach(b =>
    b.addEventListener('click', () => {
      if (turnoVista === b.dataset.turno) return;
      turnoVista = b.dataset.turno;
      tabVista = null;
      cargar();
    }));
  $('#c-refrescar').addEventListener('click', cargar);
  // El mismo pulso que el cockpit: cada 45 s, sin pisar un diálogo abierto.
  setInterval(() => { if (!document.querySelector('.fixed.inset-0.z-\\[120\\]')) cargar(); }, 45000);
  cargar();
})();
