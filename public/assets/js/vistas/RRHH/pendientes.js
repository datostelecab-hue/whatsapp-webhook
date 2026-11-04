// modules/RRHH/vistas/pendientes.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

  const DEL_SERVIDOR = Casa.datos();
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;

  // Departamentos que ve cada rol (igual que el buzón de la barra superior).
  const DEPS = {
    superadmin: ['reclutador', 'rrhh', 'trafico', 'operaciones'],
    oficina: ['reclutador', 'rrhh'],
    trafico: ['trafico', 'operaciones']
  };
  const META = {
    reclutador: { nombre: 'Reclutador · Selección', icono: 'fa-user-plus' },
    rrhh: { nombre: 'RRHH', icono: 'fa-id-badge' },
    trafico: { nombre: 'Tráfico', icono: 'fa-satellite-dish' },
    operaciones: { nombre: 'Operaciones', icono: 'fa-triangle-exclamation' }
  };
  // Rol REAL de la sesión (lo inyecta el servidor); ya no se elige en el navegador.
  const ROL = DEL_SERVIDOR.rol;

  async function cargar() {
    const rol = ROL;
    const cont = $('#pend-cont');
    cont.innerHTML = '<p class="text-telecab-muted text-sm">Cargando pendientes…</p>';
    let d;
    try { d = await (await fetch('/notificaciones')).json(); }
    catch (e) { cont.innerHTML = '<p class="text-telecab-red text-sm">No se pudieron cargar los pendientes.</p>'; return; }
    if (d.status !== 'ok') { cont.innerHTML = '<p class="text-telecab-red text-sm">Error al cargar.</p>'; return; }

    const deps = DEPS[rol] || [];
    cont.innerHTML = '';
    let total = 0;

    deps.forEach(dep => {
      const grp = d[dep] || { total: 0, items: [] };
      if (!grp.items.length) return;
      total += grp.items.length;
      const m = META[dep];
      const sec = document.createElement('div');
      sec.className = 'bg-telecab-card border border-telecab-border rounded-2xl p-4';
      sec.innerHTML = `<h2 class="text-sm font-semibold text-telecab-text mb-3 flex items-center gap-2">
          <i class="fa-solid ${m.icono} text-telecab-gold"></i> ${m.nombre}
          <span class="text-telecab-muted font-normal">(${grp.items.length})</span></h2>`;
      const list = document.createElement('div'); list.className = 'space-y-2';
      grp.items.forEach(it => {
        const a = document.createElement('a');
        a.href = it.href;
        a.className = 'flex items-center gap-3 px-3 py-2.5 rounded-xl bg-telecab-dark/40 hover:bg-telecab-card2 border border-transparent hover:border-telecab-gold/40 transition';
        a.innerHTML =
          `<span class="min-w-0 flex-1">
             <span class="block text-sm text-telecab-text">${esc(it.texto)}</span>
             ${it.detalle ? `<span class="block text-xs text-telecab-muted">${esc(it.detalle)}</span>` : ''}
           </span>
           <span class="text-xs text-telecab-gold whitespace-nowrap shrink-0">Resolver <i class="fa-solid fa-arrow-right ml-0.5"></i></span>`;
        list.appendChild(a);
      });
      sec.appendChild(list); cont.appendChild(sec);
    });

    if (!total) {
      cont.innerHTML =
        `<div class="bg-telecab-card border border-telecab-border rounded-2xl p-10 text-center">
           <i class="fa-solid fa-circle-check text-3xl text-telecab-green mb-2"></i>
           <p class="text-telecab-text">Sin pendientes</p>
           <p class="text-xs text-telecab-muted mt-1">No hay nada por resolver para este rol.</p>
         </div>`;
    }
  }

  $('#btn-recargar').addEventListener('click', cargar);
  cargar();
