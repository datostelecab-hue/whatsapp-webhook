// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const btn = document.getElementById('notif-btn');
  const panel = document.getElementById('notif-panel');
  const badge = document.getElementById('notif-badge');
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
    let total = 0;
    lista.innerHTML = '';
    deps.forEach(dep => {
      const d = datos[dep] || { total: 0, items: [] };
      total += d.total;
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
    const txt = total > 99 ? '99+' : String(total);
    [badge, document.getElementById('nav-pend-badge')].forEach(b => {
      if (!b) return;
      if (total > 0) { b.textContent = txt; b.classList.remove('hidden'); } else b.classList.add('hidden');
    });
    // El número también en el nombre de la campana: su aria-label tapa el del globo rojo.
    if (btn) btn.setAttribute('aria-label', total > 0 ? 'Pendientes: ' + txt : 'Pendientes');
  }

  async function cargar() {
    try { const r = await fetch('/notificaciones'); datos = await r.json(); pintar(); } catch (_) {}
  }

  if (btn) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const oculto = panel.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!oculto));
    });
    document.addEventListener('click', e => {
      if (panel && !panel.contains(e.target) && !btn.contains(e.target)) { panel.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  aplicarRolNav();
  // Con retraso para que la campana NO entre en el overlay de carga inicial.
  setTimeout(cargar, 1500);
  setInterval(cargar, 120000);   // refresca cada 2 min (en segundo plano)
})();
