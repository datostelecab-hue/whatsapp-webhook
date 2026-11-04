// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

// ── SESIONES ABIERTAS ───────────────────────────────────────────────────────
// La pantalla NO decide nada: esconde el botón para no prometer lo que no se
// puede hacer, pero quien dice que no es el servidor. `mando` viene de ahí.
(function () {
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;

  const fechaLarga = iso => !iso ? '—' : new Date(iso).toLocaleString('es-ES',
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const soloDia = iso => !iso ? '—' : new Date(iso).toLocaleDateString('es-ES',
    { day: '2-digit', month: 'long', year: 'numeric' });

  /** "hace 3 min", "hace 2 h", "hace 4 días". */
  function hace(iso) {
    if (!iso) return '';
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 2) return 'ahora mismo';
    if (m < 60) return 'hace ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'hace ' + h + ' h';
    const d = Math.round(h / 24);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  function aviso(txt, tono) {
    const e = $('#s-msg');
    e.textContent = txt;
    e.className = 'text-xs ' + (tono === 'error' ? 'text-telecab-red' : tono === 'ok' ? 'text-telecab-green' : 'text-telecab-muted');
    e.classList.remove('hidden');
  }

  function pintar(d) {
    const ses = d.sesiones || [];
    // La línea de arriba explica la regla ANTES de que alguien pulse y se lleve
    // un "no puedes": una prohibición que se entiende no es una prohibición.
    const p = $('#s-padre');
    if (d.padre) {
      p.className = 'text-xs mb-3 rounded-xl border border-telecab-border bg-telecab-card2/40 px-3 py-2 text-telecab-muted';
      p.innerHTML = d.mando
        ? `<i class="fa-solid fa-shield-halved text-telecab-gold"></i> Estás en tu <b class="text-telecab-text">dispositivo principal</b>`
          + ` (${esc(d.padre.etiqueta)}, desde el ${esc(soloDia(d.padre.desde))}), así que desde aquí puedes cerrar cualquier otra sesión.`
        : `<i class="fa-solid fa-lock text-telecab-muted"></i> Tu <b class="text-telecab-text">dispositivo principal</b> es`
          + ` <b class="text-telecab-text">${esc(d.padre.etiqueta)}</b>, donde entraste por primera vez el ${esc(soloDia(d.padre.desde))}.`
          + ` Solo desde ahí se pueden cerrar las demás sesiones; desde aquí puedes cerrar esta.`;
      p.classList.remove('hidden');
    } else p.classList.add('hidden');

    $('#s-todas').classList.toggle('hidden', !d.mando || ses.length < 2);

    $('#s-lista').innerHTML = ses.length ? ses.map(x => `
      <div class="flex items-center gap-3 flex-wrap rounded-xl border px-3 py-2.5 ${
        x.actual ? 'border-telecab-green/40 bg-telecab-green/5' : 'border-telecab-border bg-telecab-card2/30'}">
        <i class="fa-solid ${/Android|iPhone|iPad/i.test(x.etiqueta) ? 'fa-mobile-screen-button' : 'fa-display'} text-telecab-muted"></i>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-telecab-text truncate">${esc(x.etiqueta)}
            ${x.actual ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-telecab-green/15 text-telecab-green border border-telecab-green/30 ml-1">esta sesión</span>' : ''}
            ${x.esPadre ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-telecab-gold/15 text-telecab-gold border border-telecab-gold/30 ml-1">principal</span>' : ''}
            ${x.larga ? '<span class="text-[10px] text-telecab-muted ml-1" title="Sesión de 30 días">recordada</span>' : ''}
          </div>
          <div class="text-[11px] text-telecab-muted">
            Entró el ${esc(fechaLarga(x.desde))} · visto ${esc(hace(x.vista))}${x.ip ? ' · ' + esc(x.ip) : ''}
            ${x.dispositivoDesde ? `<br>Este dispositivo se usa desde el ${esc(soloDia(x.dispositivoDesde))}` : ''}
          </div>
        </div>
        ${(x.actual || d.mando) ? `<button data-cerrar="${esc(x.sid)}"
          class="px-3 py-1.5 rounded-lg border border-telecab-border text-xs text-telecab-muted hover:border-telecab-red hover:text-telecab-red transition whitespace-nowrap">
          <i class="fa-solid fa-xmark mr-1"></i>${x.actual ? 'Salir aquí' : 'Cerrar'}</button>` : ''}
      </div>`).join('')
      : '<p class="text-xs text-telecab-muted">No hay ninguna sesión registrada. Las de antes de esta pantalla no se pueden listar; se van solas al caducar.</p>';

    $('#s-lista').querySelectorAll('[data-cerrar]').forEach(b =>
      b.addEventListener('click', () => cerrar(b.dataset.cerrar)));
  }

  async function pedir(url, opciones) {
    const r = await (await fetch(url, opciones)).json();
    if (r.status !== 'ok') throw new Error(r.msg || 'No se ha podido');
    return r;
  }

  async function cerrar(sid) {
    const esLaMia = (window.__SES || []).some(x => x.sid === sid && x.actual);
    const ok = await Dialogo.confirmar({
      titulo: esLaMia ? '¿Salir en este dispositivo?' : '¿Cerrar esa sesión?',
      texto: esLaMia
        ? 'Se cerrará aquí y volverás a la pantalla de acceso.'
        : 'Ese dispositivo volverá a pedir usuario y contraseña la próxima vez que toque algo.',
      textoBoton: esLaMia ? 'Salir' : 'Cerrar sesión', tono: 'aviso',
    });
    if (!ok) return;
    try {
      const r = await pedir('/configuracion/mis-sesiones/cerrar',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }) });
      if (r.propia) { window.location.href = '/login'; return; }
      window.__SES = r.sesiones; pintar(r);
      aviso('Sesión cerrada.', 'ok');
    } catch (e) { aviso(e.message, 'error'); }
  }

  $('#s-todas').addEventListener('click', async () => {
    const ok = await Dialogo.confirmar({
      titulo: '¿Cerrar todas las demás?',
      texto: 'Todos los demás dispositivos volverán a pedir usuario y contraseña. Esta sesión se queda.',
      textoBoton: 'Cerrar las demás', tono: 'aviso',
    });
    if (!ok) return;
    try {
      const r = await pedir('/configuracion/mis-sesiones/cerrar-las-demas', { method: 'POST' });
      window.__SES = r.sesiones; pintar(r);
      aviso(r.cerradas ? `${r.cerradas} sesión(es) cerradas.` : 'No había otras sesiones abiertas.', 'ok');
    } catch (e) { aviso(e.message, 'error'); }
  });

  (async () => {
    try {
      const r = await pedir('/configuracion/mis-sesiones');
      window.__SES = r.sesiones; pintar(r);
    } catch (e) {
      $('#s-lista').innerHTML = `<p class="text-xs text-telecab-red">${esc(e.message)}</p>`;
    }
  })();
})();
