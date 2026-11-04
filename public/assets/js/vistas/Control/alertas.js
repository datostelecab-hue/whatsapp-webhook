// modules/Control/vistas/alertas.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(() => {
  const DEL_SERVIDOR = Casa.datos();
  const PUEDE_CONFIG = DEL_SERVIDOR.puedeConfig;
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const n1 = v => String(Math.round(Number(v) * 10) / 10).replace('.', ',');
  const horas = h => { const t = Math.max(0, Math.round(Number(h) * 60)); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')} m`; };

  const TONO = {
    sin_respuesta:   { cls: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40', ico: 'fa-phone-slash' },
    rechazo_directo: { cls: 'bg-telecab-warn/15 text-telecab-warn border-telecab-warn/40', ico: 'fa-ban' },
    km_parado:       { cls: 'bg-telecab-violet/15 text-telecab-violet border-telecab-violet/40', ico: 'fa-road' },
    // Las dos de zona, en rojo las dos: salir de la zona no es un umbral que se
    // roza, es un sitio donde el coche no debería estar.
    zona_notificacion: { cls: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40', ico: 'fa-location-crosshairs' },
    zona_madrid:       { cls: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40', ico: 'fa-map-location-dot' },
    // Las dos del mapa. El coche suelto salía con la campana gris de «sin tipo».
    rueda_suelto:      { cls: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40', ico: 'fa-triangle-exclamation' },
    no_vuelve_m30:     { cls: 'bg-telecab-warn/15 text-telecab-warn border-telecab-warn/40', ico: 'fa-route' },
  };
  let E = null;

  function chipTipo(tipo, etiqueta) {
    const t = TONO[tipo] || { cls: 'border-telecab-border text-telecab-muted', ico: 'fa-bell' };
    return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold ${t.cls}">
      <i class="fa-solid ${t.ico} text-[9px]"></i>${esc(etiqueta)}</span>`;
  }
  const etqTipo = tipo => ((E && E.tipos) || []).find(t => t.codigo === tipo) || { etiqueta: tipo, unidad: '', corto: tipo };

  // ── Cargar ────────────────────────────────────────────────────────────────
  async function cargar() {
    const dia = $('#a-dia').value;
    const r = await fetch('/alertas/api/estado' + (dia ? '?dia=' + dia : '')).then(x => x.json()).catch(() => null);
    if (!r || r.status !== 'ok') return;
    E = r;
    if (!$('#a-dia').value) $('#a-dia').value = r.dia;
    pintarEstado();
    pintarVivo();
    pintarTabla();
    if (PUEDE_CONFIG) rellenarConfig();
  }

  function pintarEstado() {
    const c = E.config || {};
    const f = E.franja;
    const reciben = (E.destinatarios || []).filter(d => d.recibe);
    const sinTel = reciben.filter(d => d.sinTelefono);
    const franjas = (c.franjas || []).map(x => `${String(x.ini).padStart(2, '0')}:00-${String(x.fin).padStart(2, '0')}:00`).join(' y ');
    $('#a-sub').textContent = `Vigilancia de ${franjas} · son las ${E.ahora}`;

    const caja = (tono, ico, titulo, cuerpo, pie) => `
      <div class="rounded-2xl border px-4 py-3 ${tono}">
        <div class="text-[11px] uppercase tracking-wide opacity-80"><i class="fa-solid ${ico} mr-1"></i>${titulo}</div>
        <div class="text-lg font-bold mt-0.5">${cuerpo}</div>
        ${pie ? `<div class="text-xs opacity-80 mt-0.5">${pie}</div>` : ''}
      </div>`;

    const enVivo = f
      ? caja('border-telecab-green/40 bg-telecab-green/10 text-telecab-green', 'fa-satellite-dish', 'Franja en curso',
          esc(f.etiqueta), `${String(f.ini).padStart(2, '0')}:00 – ${String(f.fin).padStart(2, '0')}:00 · día ${esc(f.dia)}`)
      : caja('border-telecab-border bg-telecab-card text-telecab-muted', 'fa-moon', 'Fuera de franja',
          'No se vigila', `Vuelve a las ${String((c.franjas || [])[0]?.ini ?? 8).padStart(2, '0')}:00`);

    const modoLive = c.modo === 'live';
    const modo = modoLive
      ? caja('border-telecab-green/40 bg-telecab-green/10 text-telecab-green', 'fa-paper-plane', 'Envío', 'Activo',
          'Los avisos salen por WhatsApp')
      : caja('border-telecab-warn/50 bg-telecab-warn/10 text-telecab-warn', 'fa-flask', 'Envío', 'EN PRUEBAS',
          'Las alertas se registran pero NO se manda nada');

    const dest = caja(
      reciben.length ? 'border-telecab-border bg-telecab-card text-telecab-text' : 'border-telecab-red/40 bg-telecab-red/10 text-telecab-red',
      'fa-users', 'Reciben los avisos',
      reciben.length ? esc(reciben.map(d => d.nombre.split(' ')[0]).join(', ')) : 'NADIE',
      reciben.length
        ? (sinTel.length ? `${sinTel.length} sin teléfono: no les llega` : `${reciben.length} controlador(es)`)
        : 'Elige a quién en Ajustes');

    $('#a-estado').innerHTML = enVivo + modo + dest;
  }

  function pintarVivo() {
    const v = E.enVivo || [];
    $('#a-vivo-caja').classList.toggle('hidden', !v.length);
    $('#a-vivo-n').textContent = v.length ? `· ${v.length}` : '';
    $('#a-vivo').innerHTML = v.map(x => {
      const t = etqTipo(x.tipo);
      return `<div class="rounded-xl border border-telecab-border bg-telecab-card px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-telecab-text truncate">${esc(x.conductor)}</span>
          ${chipTipo(x.tipo, n1(x.valor) + ' ' + esc(t.unidad || ''))}
        </div>
        <div class="text-[11px] text-telecab-muted mt-0.5">
          ${x.telefono ? `<span class="font-mono tabular-nums">${esc(x.telefono)}</span> · ` : ''}${horas(x.horas)} conectado
          <span class="opacity-70">· umbral ${n1(x.umbral)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function pintarTabla() {
    const a = E.alertas || [];
    const ok = a.filter(x => x.estado === 'enviada').length;
    const sim = a.filter(x => x.estado === 'simulada').length;
    const mal = a.filter(x => x.estado === 'error' || x.estado === 'sin_destinatarios').length;
    $('#a-resumen').textContent = a.length
      ? `${a.length} alerta(s) · ${ok} enviada(s)${sim ? ` · ${sim} simulada(s)` : ''}${mal ? ` · ${mal} sin salir` : ''}`
      : 'Ninguna alerta este día.';
    $('#a-tabla').innerHTML = a.map(x => {
      const t = etqTipo(x.tipo);
      const est = x.estado === 'enviada' ? '<span class="text-telecab-green">✓</span>'
        : x.estado === 'simulada' ? '<span class="text-telecab-warn">simulada</span>'
        : x.estado === 'sin_destinatarios' ? '<span class="text-telecab-red">sin destinatarios</span>'
        : `<span class="text-telecab-red" title="${esc(x.error || '')}">error</span>`;
      return `<tr class="border-t border-telecab-border/50 hover:bg-telecab-card2/40">
        <td class="px-3 py-2 tabular-nums">${esc(x.hora)}</td>
        <td class="px-3 py-2 text-telecab-muted">${esc(x.franja === 'noche' ? 'Noche' : 'Mañana')}</td>
        <td class="px-3 py-2 font-medium">${x.nombre_bolt ? esc(x.nombre_bolt)
            : '<span class="text-telecab-red">SIN CONDUCTOR FICHADO</span>'}
          ${x.lugar ? `<div class="text-[11px] text-telecab-muted font-normal">
            <i class="fa-solid fa-location-dot text-[9px]"></i> ${esc(x.lugar)}${
              x.hora_salida ? ' · ' + esc(x.hora_salida) : ''}</div>` : ''}</td>
        <td class="px-3 py-2 font-mono tabular-nums text-telecab-muted">${esc(x.telefono || '—')}</td>
        <td class="px-3 py-2">${chipTipo(x.tipo, x.mapon_alerta_id
            ? esc(String(x.zona || '').trim() || 'zona')
            : n1(x.valor) + ' ' + esc(t.unidad || ''))}
          <span class="text-[11px] text-telecab-muted ml-1">${esc(t.etiqueta)}</span></td>
        <td class="px-3 py-2 text-center text-telecab-muted">${x.mapon_alerta_id
            ? `<span class="font-mono text-xs">${esc(x.matricula || '—')}</span>`
            : horas(x.horas_efectivas)}</td>
        <td class="px-3 py-2 text-telecab-muted text-xs">${est}${x.a_quien ? ' ' + esc(x.a_quien) : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="px-3 py-6 text-center text-telecab-muted text-sm">Sin alertas.</td></tr>';
  }

  // ── Revisar ahora ─────────────────────────────────────────────────────────
  $('#a-revisar').addEventListener('click', async e => {
    const b = e.currentTarget, prev = b.innerHTML;
    b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Revisando…';
    try {
      const j = await (await fetch('/alertas/api/revisar', { method: 'POST' })).json();
      if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo revisar');
      E = j; pintarEstado(); pintarVivo(); pintarTabla();
      const r = j.resultado || {};
      await Dialogo.aviso({
        titulo: r.activa ? 'Revisión hecha' : 'Fuera de franja',
        tono: r.activa ? 'ok' : 'aviso',
        texto: r.activa
          ? `${r.pasan || 0} por encima del umbral · ${r.nuevas || 0} alerta(s) nueva(s) · ${r.enviadas || 0} envío(s)`
            + (r.modo !== 'live' ? ' (en pruebas: no se ha mandado nada)' : '')
            + (r.cortadas ? ` · ${r.cortadas} no avisadas por el tope` : '')
          : 'Ahora mismo no hay franja de vigilancia: no se avisa a nadie.',
      });
    } catch (err) {
      await Dialogo.aviso({ titulo: 'No se pudo', texto: err.message, tono: 'error' });
    }
    b.disabled = false; b.innerHTML = prev;
  });

  $('#a-dia').addEventListener('change', cargar);

  // Fuera del if: declarada dentro de un bloque, solo existía para cargar()
  // por la regla de compatibilidad de los navegadores (Anexo B); con 'use strict'
  // les fallaría a quien puede configurar. Solo se llama si PUEDE_CONFIG.
  function rellenarConfig() {
    const c = E.config || {};
    $('#a-tipos').innerHTML = (E.tipos || []).map(t => `
      <div class="flex flex-wrap items-center gap-3 px-3 py-2 rounded-xl border border-telecab-border bg-telecab-card2/40">
        <label class="flex items-center gap-2 flex-1 min-w-[220px]">
          <input type="checkbox" data-activo="${esc(t.codigo)}" class="w-4 h-4 accent-telecab-gold" ${t.activo ? 'checked' : ''}>
          <span class="text-sm font-medium">${esc(t.etiqueta)}</span>
        </label>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-telecab-muted">avisar a partir de</span>
          <input type="number" min="1" step="1" data-umbral="${esc(t.codigo)}" value="${esc(t.umbral)}"
                 aria-label="Avisar a partir de (${esc(t.unidad)}): ${esc(t.etiqueta)}"
                 class="w-20 px-2 py-1 bg-telecab-card border border-telecab-border rounded-lg text-sm text-center tabular-nums">
          <span class="text-xs text-telecab-muted">${esc(t.unidad)}</span>
        </div>
        <label class="flex items-center gap-1.5 w-full">
          <span class="text-xs text-telecab-muted whitespace-nowrap">plantilla propia</span>
          <input data-plantilla="${esc(t.codigo)}" value="${esc((c.plantillasPorTipo || {})[t.codigo] || '')}"
                 aria-label="Plantilla propia: ${esc(t.etiqueta)}"
                 placeholder="vacío = usa la general"
                 class="flex-1 min-w-[160px] px-2 py-1 bg-telecab-card border border-telecab-border rounded-lg text-xs">
        </label>
      </div>`).join('');
    $('#a-dest').innerHTML = (E.destinatarios || []).map(d => `
      <label class="flex items-center gap-2 px-3 py-2 rounded-xl border ${d.recibe ? 'border-telecab-gold/40 bg-telecab-gold/5' : 'border-telecab-border'} ${d.sinTelefono ? 'opacity-60' : ''}">
        <input type="checkbox" data-dest="${d.id}" class="w-4 h-4 accent-telecab-gold" ${d.recibe ? 'checked' : ''} ${d.sinTelefono ? 'disabled' : ''}>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium truncate">${esc(d.nombre)}</span>
          <span class="block text-[11px] text-telecab-muted">${esc(d.rol || '')}${d.sinTelefono ? ' · sin teléfono' : ' · ' + esc(d.telefono)}</span>
        </span>
      </label>`).join('');
    $('#a-modo').checked = c.modo === 'live';
    $('#a-plantilla').value = c.plantilla || '';
    $('#a-max').value = c.maxPorFranja || 25;
  }

  // ── Ajustes ───────────────────────────────────────────────────────────────
  if (PUEDE_CONFIG) {
    const modal = $('#a-config');
    const abrir = () => { rellenarConfig(); modal.classList.remove('hidden'); };
    const cerrar = () => modal.classList.add('hidden');
    $('#a-config-btn').addEventListener('click', abrir);
    $('#a-config-x').addEventListener('click', cerrar);
    $('#a-config-cancel').addEventListener('click', cerrar);
    modal.addEventListener('mousedown', e => { if (e.target === modal) cerrar(); });

    $('#a-config-save').addEventListener('click', async e => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const tipos = {};
        document.querySelectorAll('[data-umbral]').forEach(i => {
          const k = i.dataset.umbral;
          tipos[k] = {
            umbral: Number(i.value) || 1,
            activo: document.querySelector(`[data-activo="${k}"]`).checked,
          };
        });
        // Vacía = ese tipo sale por la general. Se manda igualmente para poder
        // BORRAR una que ya no se quiere: si no se enviara, quedaría puesta.
        const plantillasPorTipo = {};
        document.querySelectorAll('[data-plantilla]').forEach(i => {
          plantillasPorTipo[i.dataset.plantilla] = i.value.trim();
        });
        const cuerpo = {
          tipos, plantillasPorTipo, modo: $('#a-modo').checked ? 'live' : 'test',
          plantilla: $('#a-plantilla').value.trim(),
          maxPorFranja: Number($('#a-max').value) || 25,
        };
        const ids = [...document.querySelectorAll('[data-dest]:checked')].map(i => Number(i.dataset.dest));
        const r1 = await (await fetch('/alertas/config/api/guardar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })).json();
        if (r1.status !== 'ok') throw new Error(r1.msg || 'No se pudieron guardar los ajustes');
        const r2 = await (await fetch('/alertas/config/api/destinatarios', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })).json();
        if (r2.status !== 'ok') throw new Error(r2.msg || 'No se pudieron guardar los destinatarios');
        cerrar();
        await cargar();
      } catch (err) {
        await Dialogo.aviso({ titulo: 'No se pudo guardar', texto: err.message, tono: 'error' });
      }
      b.disabled = false;
    });
  }

  cargar();
  // El panel se refresca solo: dentro de franja esto es una pantalla de guardia.
  setInterval(cargar, 2 * 60 * 1000);
})();
