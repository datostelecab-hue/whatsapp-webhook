// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const btn = document.getElementById('notif-btn');
  const panel = document.getElementById('notif-panel');
  const lista = document.getElementById('notif-lista');

  // QUÉ BANDEJAS VE CADA ROL LO DECIDE EL SERVIDOR (DEPS_ROL de
  // routes/notificaciones.js): solo manda las suyas, y aquí se pinta lo que
  // llega. Había una copia del reparto en este fichero y ya no coincidía.
  const ORDEN = ['reclutador', 'rrhh', 'trafico', 'operaciones', 'soporte'];
  const NOMBRE = { reclutador: 'Reclutador', rrhh: 'RRHH', trafico: 'Tráfico', operaciones: 'Operaciones', soporte: 'Tickets IT' };
  let datos = null;

  // Filtra los grupos del menú por rol (general = todos). El grupo de la sección
  // activa se deja SIEMPRE visible para no dejar al usuario sin salida.
  function aplicarRolNav() {
    // El filtrado del menú lo hace el SERVIDOR con los permisos del usuario
    // (usuario_permiso vía res.locals.permisos): aquí no queda nada que esconder.
  }

  function pintar() {
    if (!datos || datos.status !== 'ok') return;
    const deps = ORDEN.filter(k => datos[k]);
    lista.innerHTML = '';
    deps.forEach(dep => {
      const d = datos[dep] || { total: 0, items: [] };
      (d.items || []).forEach(it => {
        const a = document.createElement('a');
        // Solo enlaces de la casa (una ruta que empieza por «/»): el servidor
        // los arma con rutas fijas y aquí no se acepta otra cosa.
        if (/^\/(?!\/)/.test(String(it.href || ''))) a.href = it.href;
        a.className = 'block px-2 py-1.5 rounded-lg hover:bg-telecab-card2 transition';
        // LOS TEXTOS, COMO TEXTO. Son títulos de ticket, nombres y motivos que
        // escribe cualquiera: con innerHTML, un «<» en un título se pintaba como
        // etiqueta. textContent no interpreta nada.
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
    if (!lista.children.length) lista.innerHTML = '<p class="text-xs text-telecab-muted px-2 py-4 text-center">Sin pendientes</p>';
  }

  // EL NÚMERO ES UN CONTADOR (A9): «pendientes», el mismo total, lo pinta
  // contadores.js en la campana y en la entrada del menú. Aquí solo el nombre
  // de la campana, que su aria-label tapa el del globo rojo.
  if (window.Contadores && btn) {
    window.Contadores.alCambiar(() => {
      const v = window.Contadores.valor('pendientes');
      const n = v ? v.n : 0;
      btn.setAttribute('aria-label', n > 0 ? 'Pendientes: ' + (n > 99 ? '99+' : n) : 'Pendientes');
    });
  }

  // LA LISTA, AL ABRIRLA: es cuando hace falta, y así sale al día. Antes se
  // pedía cada dos minutos aunque nadie abriera la campana.
  async function cargar() {
    lista.innerHTML = '<p class="text-xs text-telecab-muted px-2 py-4 text-center">Cargando…</p>';
    try { const r = await fetch('/notificaciones'); datos = await r.json(); pintar(); }
    catch (_) { lista.innerHTML = '<p class="text-xs text-telecab-warn px-2 py-4 text-center">No se han podido cargar</p>'; }
  }

  if (btn) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const oculto = panel.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!oculto));
      if (!oculto) cargar();
    });
    document.addEventListener('click', e => {
      if (panel && !panel.contains(e.target) && !btn.contains(e.target)) { panel.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  aplicarRolNav();
})();
