// modules/Operaciones/vistas/sanciones.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const n1 = v => (v == null ? '—' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 }));
  const dia = f => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) + (f.length > 10 ? ' ' + f.slice(11, 16) : '') : '—');
  const hoyDdmm = () => { const d = new Date(); const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
  const aIso = v => { const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

  const ESTADO = {
    avisado:       { txt: 'Avisado',           cls: 'bg-telecab-green/15 text-telecab-green' },
    simulado:      { txt: 'Simulado',          cls: 'bg-telecab-card2 text-telecab-muted' },
    sin_conductor: { txt: 'Sin conductor',     cls: 'bg-telecab-card2 text-telecab-muted' },
    dudoso:        { txt: 'Atribución dudosa', cls: 'bg-telecab-warn/15 text-telecab-warn' },
    error:         { txt: 'Falló el envío',    cls: 'bg-telecab-red/20 text-telecab-red' },
    agrupado:      { txt: 'Con el aviso anterior', cls: 'bg-telecab-card2 text-telecab-muted' },
  };

  let D = null, tab = 'cond', busca = '';

  function verTab(t) {
    tab = t;
    document.querySelectorAll('.v-tab').forEach(b => {
      const on = b.dataset.tab === t;
      b.className = 'v-tab px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition ' +
        (on ? 'text-telecab-gold border-telecab-gold' : 'text-telecab-muted border-transparent hover:text-telecab-text');
    });
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== t));
  }

  function aviso(t) {
    const b = $('#v-aviso');
    if (!t) return b.classList.add('hidden');
    b.classList.remove('hidden');
    b.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-2"></i>' + esc(t);
  }

  function pintarModo() {
    const b = $('#v-modo');
    const live = D.modo === 'live';
    b.className = 'mb-4 rounded-xl px-4 py-3 text-sm border ' + (live
      ? 'border-telecab-green/40 bg-telecab-green/5 text-telecab-text'
      : 'border-telecab-warn/50 bg-telecab-warn/10 text-telecab-text');
    b.innerHTML = live
      ? `<i class="fa-solid fa-paper-plane text-telecab-green mr-2"></i>Modo <b>real</b>: cada exceso atribuido
         manda un WhatsApp con la plantilla <span class="font-mono text-xs">${esc(D.plantilla || '')}</span>.`
      : `<i class="fa-solid fa-flask text-telecab-warn mr-2"></i>Modo <b>pruebas</b>: se registra todo pero
         <b>no sale ningún WhatsApp</b>. Los excesos salen como «simulado». Para enviar de verdad,
         <span class="font-mono text-xs">SANCIONES_MODO=live</span>.`;
    b.classList.remove('hidden');
  }

  function pintarCifras() {
    const r = D.resumen || {};
    $('#v-excesos').textContent = r.excesos ?? 0;
    $('#v-gente').textContent = r.gente ? r.gente + (r.gente === 1 ? ' conductor' : ' conductores') : '';
    $('#v-avisos').textContent = r.avisos ?? 0;
    // Un simulado NO es un aviso: es lo que se habría mandado. Mezclarlos hacía
    // que la pantalla dijera que a alguien se le avisó cinco veces cuando no
    // había recibido ninguno.
    // Lo que va a menos de 5 min de un aviso no es otro aviso (29/10/2026).
    const det = [];
    if (r.simulados) det.push(`y ${r.simulados} simulado(s), que NO se enviaron`);
    if (r.agrupados) det.push(`${r.agrupados} exceso(s) más fueron con el aviso anterior`);
    $('#v-avisos-det').textContent = det.join('; ') || 'Uno por exceso, con 5 min entre avisos';
    $('#v-sinavisar').textContent = r.sin_avisar ?? 0;
    $('#v-punta').textContent = r.punta ? n1(r.punta) + ' km/h' : '—';
    $('#v-fallos').textContent = r.fallos ? r.fallos + ' envío(s) fallidos' : '';
  }

  function pintarCond() {
    const filas = (D.conductores || []).filter(f =>
      !busca || (f.conductor || '').toLowerCase().includes(busca));
    $('#v-vacio-cond').classList.toggle('hidden', filas.length > 0);
    // La barra mide INSISTENCIA: avisos por día transcurrido desde el primero.
    // Es lo que separa un mal día de una costumbre.
    const ritmo = f => (f.avisos || 0) / Math.max(1, f.dias_entre || 1);
    const tope = Math.max(...filas.map(ritmo), 0.001);

    $('#v-tbody-cond').innerHTML = filas.map(f => {
      const r = ritmo(f), pct = Math.round(r / tope * 100);
      const grave = f.avisos >= 5, medio = f.avisos >= 3;
      return `<tr class="hover:bg-telecab-card2/50 transition ${grave ? 'bg-telecab-red/[0.04]' : ''}">
        <td class="px-4 py-2.5 sticky left-0 bg-telecab-card whitespace-nowrap">
          <span class="font-semibold">${esc(f.conductor)}</span>
          ${f.conductor_id
            ? `<a href="/plantilla?id=${f.conductor_id}" class="ml-1.5 text-telecab-muted hover:text-telecab-gold" title="Abrir su ficha"><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a>`
            : '<span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-telecab-card2 text-telecab-muted" title="Su cuenta de BOLT no está enlazada con ninguna ficha">sin ficha</span>'}
          ${f.telefono ? `<div class="text-[11px] text-telecab-muted">${esc(f.telefono)}</div>` : ''}
        </td>
        <td class="px-3 py-2.5 text-center tabular-nums font-bold ${grave ? 'text-telecab-red' : medio ? 'text-telecab-warn' : 'text-telecab-text'}">${f.avisos}
          ${f.simulados ? `<div class="text-[10px] font-normal text-telecab-muted" title="En modo pruebas: no se le envió nada">+${f.simulados} simul.</div>` : ''}</td>
        <td class="px-3 py-2.5 text-center tabular-nums text-telecab-muted">${f.excesos}</td>
        <td class="px-3 py-2.5 text-right tabular-nums text-telecab-red">${n1(f.punta)}</td>
        <td class="px-3 py-2.5 text-right tabular-nums text-telecab-muted">+${n1(f.exceso_medio)}</td>
        <td class="px-3 py-2.5 text-center tabular-nums text-telecab-muted">${f.coches}</td>
        <td class="px-3 py-2.5 text-telecab-muted text-xs">${dia(f.primero)}</td>
        <td class="px-3 py-2.5 text-telecab-muted text-xs">${dia(f.ultimo)}</td>
        <td class="px-3 py-2.5">
          <div class="h-2 rounded-full bg-telecab-dark overflow-hidden">
            <div class="h-full ${grave ? 'bg-telecab-red' : medio ? 'bg-telecab-warn' : 'bg-telecab-gold'}" style="width:${pct}%"></div>
          </div>
          <span class="text-[10px] text-telecab-muted">${n1(r)} al día · ${f.dias_entre} d</span>
        </td>
      </tr>`;
    }).join('');
  }

  function pintarHist() {
    const q = busca;
    const filas = (D.historico || []).filter(h =>
      !q || (`${h.conductor || ''} ${h.placa || ''}`).toLowerCase().includes(q));
    $('#v-cuenta').textContent = filas.length
      ? filas.length + (filas.length === 1 ? ' exceso' : ' excesos') : '';
    $('#v-vacio-hist').classList.toggle('hidden', filas.length > 0);
    $('#v-tbody-hist').innerHTML = filas.map(h => {
      const e = ESTADO[h.estado] || { txt: h.estado, cls: 'bg-telecab-card2 text-telecab-muted' };
      return `<tr class="hover:bg-telecab-card2/50 transition">
        <td class="px-4 py-2.5 whitespace-nowrap text-telecab-muted">${esc(h.cuando)}</td>
        <td class="px-3 py-2.5 font-semibold whitespace-nowrap">${esc(h.placa || '—')}</td>
        <td class="px-3 py-2.5">${h.conductor ? esc(h.conductor) : '<span class="text-telecab-muted">—</span>'}</td>
        <td class="px-3 py-2.5 text-right tabular-nums font-semibold">${n1(h.velocidad)}</td>
        <td class="px-3 py-2.5 text-right tabular-nums text-telecab-muted">${n1(h.limite)}</td>
        <td class="px-3 py-2.5 text-right tabular-nums font-bold text-telecab-red">+${n1(h.exceso)}</td>
        <td class="px-3 py-2.5">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${e.cls}" ${h.nota ? `title="${esc(h.nota)}"` : ''}>${e.txt}</span>
        </td>
        <td class="px-3 py-2.5 text-xs">${h.lat != null && h.lng != null
          ? `<a href="https://maps.google.com/?q=${h.lat},${h.lng}" target="_blank" rel="noopener"
               class="text-telecab-muted hover:text-telecab-gold">ver mapa <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i></a>`
          : '<span class="text-telecab-muted/50">—</span>'}</td>
      </tr>`;
    }).join('');
  }

  async function cargar() {
    aviso('');
    try {
      const q = new URLSearchParams();
      if (aIso($('#v-desde').value)) q.set('desde', aIso($('#v-desde').value));
      if (aIso($('#v-hasta').value)) q.set('hasta', aIso($('#v-hasta').value));
      if ($('#v-estado').value) q.set('estado', $('#v-estado').value);
      const r = await fetch('/sanciones/api/datos?' + q.toString());
      const j = await r.json();
      if (j.status !== 'ok') throw new Error(j.msg || 'no se pudo cargar');
      D = j;
      if (!$('#v-desde').value) $('#v-desde').value = dia(j.desde) + '/' + j.desde.slice(0, 4);
      if (!$('#v-hasta').value) $('#v-hasta').value = dia(j.hasta) + '/' + j.hasta.slice(0, 4);
      pintarModo(); pintarCifras(); pintarCond(); pintarHist();
    } catch (e) { aviso('No se pudo cargar: ' + e.message); }
  }

  // ── Enganches ────────────────────────────────────────────────────────
  document.querySelectorAll('.v-tab').forEach(b => b.addEventListener('click', () => verTab(b.dataset.tab)));
  $('#v-consultar').addEventListener('click', cargar);
  $('#v-estado').addEventListener('change', cargar);
  $('#v-busca').addEventListener('input', () => {
    busca = $('#v-busca').value.trim().toLowerCase();
    if (D) { pintarCond(); pintarHist(); }
  });
  $('#v-procesar').addEventListener('click', async () => {
    const b = $('#v-procesar');
    b.disabled = true; b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Revisando…';
    try {
      const r = await fetch('/sanciones/api/procesar', { method: 'POST' });
      const j = await r.json();
      if (j.status !== 'ok') throw new Error(j.msg || 'error');
      await cargar();
      await Dialogo.aviso({
        titulo: j.nuevas ? `${j.nuevas} exceso(s) nuevo(s)` : 'Sin excesos nuevos',
        tono: j.errores ? 'aviso' : 'info',
        html: `<p>${j.leidas} exceso(s) pendiente(s) en la ingesta de Mapon.</p>
          <ul class="mt-2 text-xs space-y-0.5">
            <li>· <b>${j.avisos}</b> aviso(s) ${j.modo === 'live' ? 'enviados' : 'simulados'}</li>
            <li>· ${j.sinConductor} sin conductor identificable</li>
            <li>· ${j.dudosas} con atribución dudosa (no se avisa)</li>
            ${j.esperando ? `<li>· ${j.esperando} esperando a la ingesta de Bolt — se resuelven en la próxima pasada</li>` : ''}
            ${j.errores ? `<li class="text-telecab-red">· ${j.errores} envío(s) fallidos</li>` : ''}
          </ul>`,
      });
    } catch (e) { aviso('No se pudo revisar: ' + e.message); }
    finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-bolt mr-1"></i> Revisar ahora'; }
  });

  verTab('cond');
  cargar();
})();
