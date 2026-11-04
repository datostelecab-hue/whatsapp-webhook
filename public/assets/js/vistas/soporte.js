// views/soporte.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const MAX_FILES = 5, MAX_MB = 8;

  const badge = e => {
    const map = { 'Nuevo': 'bg-telecab-gold/15 text-telecab-gold border-telecab-gold/40', 'En curso': 'bg-sky-500/15 text-sky-400 border-sky-500/40',
      'Resuelto': 'bg-telecab-green/15 text-telecab-green border-telecab-green/40', 'Descartado': 'bg-telecab-dark text-telecab-muted border-telecab-border' };
    return `<span class="text-xs px-2 py-0.5 rounded-lg border whitespace-nowrap ${map[e] || 'bg-telecab-dark text-telecab-muted border-telecab-border'}">${esc(e || '—')}</span>`;
  };

  function opciones(sel, arr, def) { sel.innerHTML = arr.map(o => `<option ${o === def ? 'selected' : ''}>${esc(o)}</option>`).join(''); }

  // Archivos elegidos (en memoria, como base64).
  let archivos = [];
  function pintarArchivos() {
    $('#t-lista-archivos').innerHTML = archivos.map((a, i) =>
      `<span class="inline-flex items-center gap-1.5 text-xs bg-telecab-dark border border-telecab-border rounded-lg px-2 py-1">
        <i class="fa-solid ${/^image\//.test(a.mime) ? 'fa-image' : 'fa-file'} text-telecab-muted"></i>${esc(a.nombre)}
        <button data-i="${i}" class="quita text-telecab-red hover:text-telecab-red/80" aria-label="Quitar ${esc(a.nombre)}">✕</button></span>`).join('');
    $('#t-lista-archivos').querySelectorAll('.quita').forEach(b => b.addEventListener('click', () => { archivos.splice(+b.dataset.i, 1); pintarArchivos(); }));
  }
  const leerBase64 = file => new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = err; r.readAsDataURL(file); });

  $('#t-archivos').addEventListener('change', async e => {
    for (const file of [...e.target.files]) {
      if (archivos.length >= MAX_FILES) { alert(`Máximo ${MAX_FILES} archivos.`); break; }
      if (file.size > MAX_MB * 1024 * 1024) { alert(`"${file.name}" supera los ${MAX_MB} MB.`); continue; }
      archivos.push({ nombre: file.name, mime: file.type, base64: await leerBase64(file) });
    }
    e.target.value = ''; pintarArchivos();
  });

  const aviso = (t, cls) => { const m = $('#t-msg'); m.textContent = t; m.className = 'text-xs ' + cls; m.classList.remove('hidden'); };

  $('#t-enviar').addEventListener('click', async () => {
    const titulo = $('#t-titulo').value.trim();
    if (!titulo) return aviso('Ponle un título.', 'text-telecab-red');
    const btn = $('#t-enviar'); btn.disabled = true;
    aviso(archivos.length ? 'Enviando (subiendo adjuntos)…' : 'Enviando…', 'text-telecab-muted');
    try {
      const body = { tipo: $('#t-tipo').value, prioridad: $('#t-prioridad').value, titulo, descripcion: $('#t-descripcion').value, adjuntos: archivos };
      const r = await (await fetch('/soporte/crear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (r.status !== 'ok') throw new Error(r.msg || 'error');
      let t = '¡Ticket enviado! Gracias.';
      if (r.avisos && r.avisos.length) t += ' (Algún adjunto no se pudo subir: ' + esc(r.avisos.join('; ')) + ')';
      aviso(t, r.avisos && r.avisos.length ? 'text-telecab-gold' : 'text-telecab-green');
      $('#t-titulo').value = ''; $('#t-descripcion').value = ''; archivos = []; pintarArchivos();
      cargarMios();
    } catch (e) { aviso('No se pudo enviar: ' + e.message, 'text-telecab-red'); }
    btn.disabled = false;
  });

  async function cargarMios() {
    try {
      const r = await (await fetch('/soporte/api/mis-tickets')).json();
      if (r.status !== 'ok') throw new Error(r.msg || 'error');
      if (!$('#t-tipo').options.length) { opciones($('#t-tipo'), r.tipos, 'Bug'); opciones($('#t-prioridad'), r.prioridades, 'Media'); }
      const cont = $('#mis-tickets');
      if (!r.tickets.length) { cont.innerHTML = '<p class="text-xs text-telecab-muted">Aún no has abierto ningún ticket.</p>'; return; }
      cont.innerHTML = r.tickets.map(t => `
        <div class="bg-telecab-card border border-telecab-border rounded-xl p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm text-telecab-text font-medium truncate">${esc(t.titulo)}</p>
              <p class="text-[11px] text-telecab-muted">${esc(t.tipo)} · ${esc(t.prioridad)} · ${esc(t.fecha_creacion)}${(t.adjuntos && t.adjuntos.length) ? ' · <i class="fa-solid fa-paperclip"></i> ' + t.adjuntos.length : ''}</p>
            </div>
            ${badge(t.estado)}
          </div>
          ${t.notas_dev ? `<p class="text-xs text-telecab-muted mt-2 border-t border-telecab-border/60 pt-2"><b class="text-telecab-text">Respuesta:</b> ${esc(t.notas_dev)}</p>` : ''}
        </div>`).join('');
    } catch (e) { $('#mis-tickets').innerHTML = '<p class="text-xs text-telecab-red">No se pudieron cargar tus tickets.</p>'; }
  }

  cargarMios();
