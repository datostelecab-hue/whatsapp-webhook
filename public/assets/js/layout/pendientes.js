// LA CAMPANA (views/layout-gestion.ejs) — la bandeja de AVISOS y los pendientes de hoy.
//
// Desde el ítem 3 (db/254, 16/11/2026) la campana es la bandeja de avisos entre
// módulos (Camilo: «la campana pasa a ser la bandeja de avisos»):
//   · ARRIBA, LOS AVISOS de su área y los suyos (/avisos/api/mios): sin leer en
//     negrita y con su punto, urgentes en rojo. «Leído» baja su número (cada
//     uno el suyo); «Resuelto», con una nota, lo quita para toda el área.
//     Pulsar el título lleva a su pantalla y lo da por leído.
//   · DEBAJO, LOS PENDIENTES DE HOY (/notificaciones), como estaban: se calculan
//     al momento y desaparecen solos cuando cambia lo que los provoca.
// EL NÚMERO de la campana suma los avisos sin leer y los pendientes (contadores
// «avisos.sin_leer pendientes», A9). Se repinta sola si llega un aviso con la
// campana abierta (tiempo real, canal «avisos»).
(function () {
  const btn = document.getElementById('notif-btn');
  const panel = document.getElementById('notif-panel');
  const lista = document.getElementById('notif-lista');
  const cajaAvisos = document.getElementById('notif-avisos');
  const botonLeidos = document.getElementById('notif-leidos');
  const esc = Casa.esc;
  const rutaCasa = h => /^\/(?!\/)/.test(String(h || ''));

  // QUÉ BANDEJAS VE CADA ROL LO DECIDE EL SERVIDOR (DEPS_ROL de
  // routes/notificaciones.js): solo manda las suyas, y aquí se pinta lo que llega.
  const ORDEN = ['reclutador', 'rrhh', 'trafico', 'operaciones', 'soporte'];
  const NOMBRE = { reclutador: 'Reclutador', rrhh: 'RRHH', trafico: 'Tráfico', operaciones: 'Operaciones', soporte: 'Tickets IT' };
  let datos = null;
  let avisos = [];

  // ── Los pendientes de hoy ────────────────────────────────────────────────
  function pintarPendientes() {
    if (!datos || datos.status !== 'ok') return;
    const deps = ORDEN.filter(k => datos[k]);
    lista.innerHTML = '';
    deps.forEach(dep => {
      const d = datos[dep] || { total: 0, items: [] };
      (d.items || []).forEach(it => {
        const a = document.createElement('a');
        // Solo enlaces de la casa (una ruta que empieza por «/»).
        if (rutaCasa(it.href)) a.href = it.href;
        a.className = 'block px-2 py-1.5 rounded-lg hover:bg-telecab-card2 transition';
        // LOS TEXTOS, COMO TEXTO: títulos de ticket, nombres y motivos que escribe cualquiera.
        const linea = (clase, texto) => {
          const s = document.createElement('span');
          s.className = clase;
          s.textContent = texto;
          a.appendChild(s);
        };
        if (deps.length > 1) linea('block text-[10px] uppercase tracking-wide text-telecab-muted', NOMBRE[dep] || dep);
        linea('block text-xs text-telecab-text', it.texto || '');
        if (it.detalle) linea('block text-[11px] text-telecab-muted truncate', it.detalle);
        lista.appendChild(a);
      });
    });
    if (!lista.children.length) lista.innerHTML = '<p class="tc-bandeja-vacia">Sin pendientes</p>';
  }

  // ── Los avisos ───────────────────────────────────────────────────────────
  function haceCuanto(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  }
  const hasta = iso => {
    const f = new Date(iso);
    return f.toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  };

  function pintarAvisos() {
    const sinLeer = avisos.filter(a => !a.leido).length;
    if (botonLeidos) botonLeidos.hidden = !sinLeer;
    if (!avisos.length) { cajaAvisos.innerHTML = '<p class="tc-bandeja-vacia">Sin avisos: todo al día</p>'; return; }
    cajaAvisos.innerHTML = avisos.map(a => `
      <article class="tc-aviso ${a.leido ? '' : 'tc-aviso--sin-leer'} ${a.urgente ? 'tc-aviso--urgente' : ''}" data-aviso="${a.id}">
        <span class="tc-aviso-icono" aria-hidden="true"><i class="fa-solid ${esc(a.icono)}"></i></span>
        <div class="tc-aviso-cuerpo">
          ${rutaCasa(a.enlace)
            ? `<a class="tc-aviso-titulo" href="${esc(a.enlace)}" data-aviso-abrir>${esc(a.titulo)}</a>`
            : `<p class="tc-aviso-titulo">${esc(a.titulo)}</p>`}
          ${a.texto ? `<p class="tc-aviso-texto">${esc(a.texto)}</p>` : ''}
          <p class="tc-aviso-meta">
            ${a.urgente ? '<span class="tc-pastilla tc-pastilla--rojo">Urgente</span>' : ''}
            <span>${esc(a.paraMi ? 'Para ti' : (a.areaEtiqueta || a.etiqueta))}</span>
            <span>· ${esc(haceCuanto(a.creadoAt))}</span>
            ${a.caducaAt ? `<span>· hasta el ${esc(hasta(a.caducaAt))}</span>` : ''}
          </p>
          <div class="tc-aviso-acciones">
            ${a.leido ? '' : '<button type="button" class="tc-boton tc-boton--chico" data-aviso-leido>Leído</button>'}
            <button type="button" class="tc-boton tc-boton--chico" data-aviso-resolver><i class="fa-solid fa-check" aria-hidden="true"></i>Resuelto</button>
          </div>
        </div>
        ${a.leido ? '' : '<span class="tc-aviso-punto" title="Sin leer"></span>'}
      </article>`).join('');
  }

  const pedirLeidos = (ids, { mantener = false } = {}) => fetch('/avisos/api/leidos', {
    method: 'POST', credentials: 'same-origin', keepalive: mantener,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(ids ? { ids } : {}),
  }).then(() => { if (window.Contadores) window.Contadores.refrescar(); }).catch(() => {});

  if (cajaAvisos) {
    cajaAvisos.addEventListener('click', async ev => {
      const art = ev.target.closest('[data-aviso]');
      if (!art) return;
      const id = Number(art.dataset.aviso);
      const a = avisos.find(x => x.id === id);
      if (!a) return;
      if (ev.target.closest('[data-aviso-abrir]')) {
        // Se va a su pantalla: la petición sigue aunque se cambie de página.
        if (!a.leido) pedirLeidos([id], { mantener: true });
        return;
      }
      if (ev.target.closest('[data-aviso-leido]')) {
        a.leido = true; pintarAvisos();
        await pedirLeidos([id]);
        return;
      }
      if (ev.target.closest('[data-aviso-resolver]')) {
        const v = await Dialogo.formulario(`Resuelto · ${a.titulo}`, [
          { id: 'nota', etiqueta: 'En qué quedó', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000,
            marcador: 'Ej.: llamado, la confirma para mañana',
            ayuda: 'Desaparece para todos los que lo reciben, y queda quién lo resolvió y cuándo.' },
        ], { textoBoton: 'Dar por resuelto' });
        if (!v) return;
        const r = await Api.post(`/avisos/api/${id}/resolver`, { nota: v.nota }, { aviso: 'No se ha resuelto' });
        if (!r) return;
        avisos = avisos.filter(x => x.id !== id);
        pintarAvisos();
        if (window.Contadores) window.Contadores.refrescar();
      }
    });
  }
  if (botonLeidos) {
    botonLeidos.addEventListener('click', async () => {
      avisos.forEach(a => { a.leido = true; });
      pintarAvisos();
      await pedirLeidos(null);
    });
  }

  // EL NOMBRE DE LA CAMPANA: su aria-label tapa el del globo rojo, así que dice el número.
  if (window.Contadores && btn) {
    window.Contadores.alCambiar(() => {
      const v = window.Contadores.valor('avisos.sin_leer pendientes');
      const n = v ? v.n : 0;
      btn.setAttribute('aria-label', n > 0 ? 'Avisos y pendientes: ' + (n > 99 ? '99+' : n) : 'Avisos y pendientes');
    });
  }

  // LO DE DENTRO, AL ABRIRLA: es cuando hace falta, y así sale al día.
  async function cargar() {
    if (cajaAvisos) cajaAvisos.innerHTML = '<p class="tc-bandeja-vacia">Cargando…</p>';
    lista.innerHTML = '<p class="tc-bandeja-vacia">Cargando…</p>';
    const [ra, rp] = await Promise.allSettled([
      Api.get('/avisos/api/mios'),
      fetch('/notificaciones', { credentials: 'same-origin' }).then(r => r.json()),
    ]);
    if (cajaAvisos) {
      if (ra.status === 'fulfilled' && ra.value) { avisos = ra.value.avisos || []; pintarAvisos(); }
      else cajaAvisos.innerHTML = '<p class="tc-bandeja-vacia text-telecab-warn">No se han podido cargar los avisos</p>';
    }
    if (rp.status === 'fulfilled') { datos = rp.value; pintarPendientes(); }
    else lista.innerHTML = '<p class="tc-bandeja-vacia text-telecab-warn">No se han podido cargar</p>';
  }
  const abierta = () => panel && !panel.classList.contains('hidden');

  if (btn) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const oculto = panel.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!oculto));
      if (!oculto) cargar();
    });
    document.addEventListener('click', e => {
      // Un formulario del Dialogo (el de «Resuelto») no cierra la campana.
      if (e.target.closest('.dialogo, [data-formulario]')) return;
      if (panel && !panel.contains(e.target) && !btn.contains(e.target)) { panel.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && abierta() && !document.querySelector('.dialogo, [data-formulario]')) {
        panel.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); btn.focus();
      }
    });
  }

  // Un aviso nuevo (o resuelto por otro) con la campana abierta: se repinta.
  if (window.TiempoReal && cajaAvisos) {
    window.TiempoReal.escuchar('avisos', { alLlegar: () => { if (abierta()) cargar(); } });
  }
})();
