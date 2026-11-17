// modules/TiempoReal/vistas/tiempoRealBanco.ejs — el banco de tiempo real (A7).
//
// Abre el directo (también en local), se manda avisos por el canal «prueba» y
// enseña cuánto tardan, el estado de la conexión y lo que dice el servidor.

(function () {
  const esc = Casa.esc;
  const cajaEstado = document.querySelector('#estado');
  const cajaRegistro = document.querySelector('#registro');
  const registro = [];
  let servidor = null;
  let pedidoEn = null;   // performance.now() al pedir un aviso suelto

  const ESTADO = {
    directo: { texto: 'En directo', clase: 'bg-telecab-gold/15 text-telecab-gold border-telecab-gold/40', icono: 'fa-circle' },
    conectando: { texto: 'Conectando…', clase: 'bg-telecab-card2 text-telecab-muted border-telecab-border', icono: 'fa-circle-notch fa-spin' },
    sondeo: { texto: 'Por sondeo', clase: 'bg-telecab-warn/10 text-telecab-warn border-telecab-warn/30', icono: 'fa-rotate' },
    parado: { texto: 'Parado', clase: 'bg-telecab-card2 text-telecab-muted border-telecab-border', icono: 'fa-circle-pause' },
  };

  const hora = () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function apuntar(texto) {
    registro.unshift({ hora: hora(), texto });
    registro.length = Math.min(registro.length, 30);
    pintarRegistro();
  }

  function pintarEstado() {
    const e = ESTADO[TiempoReal.estado()] || ESTADO.parado;
    const s = servidor;
    const canales = s && s.porCanal ? Object.entries(s.porCanal).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') : '';
    cajaEstado.innerHTML = `
      <div class="bg-telecab-card border border-telecab-border rounded-2xl p-5 space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-semibold ${e.clase}" role="status" aria-live="polite">
            <i class="fa-solid ${e.icono} text-[10px]" aria-hidden="true"></i>${e.texto}</span>
          <span class="text-xs text-telecab-muted">Último aviso visto: <span class="tabular-nums">${esc(TiempoReal.ultimoId() || 'ninguno')}</span></span>
        </div>
        ${s ? `<div class="grid gap-4 sm:grid-cols-3 text-sm">
          <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Conexiones abiertas</p>
            <p class="tabular-nums">${esc(s.conexiones)} en total · ${esc(s.mias)} tuyas</p>
            ${canales ? `<p class="text-[11px] text-telecab-muted mt-1">${canales}</p>` : ''}</div>
          <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Avisos guardados</p>
            <p class="tabular-nums">${esc(s.guardados)} (los de los últimos 10 minutos)</p></div>
          <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Este servidor</p>
            <p class="tabular-nums text-[12px] break-all">${esc(s.instancia)}</p>
            <p class="text-[11px] text-telecab-muted mt-1">Si cambia, el servidor se ha reiniciado.</p></div>
        </div>` : ''}
        <div class="flex flex-wrap gap-2">
          ${boton('uno', 'fa-paper-plane', 'Mandarme un aviso')}
          ${boton('hueco', 'fa-scissors', 'Cortar, mandar 3 y volver')}
          ${boton('volver', 'fa-plug', 'Volver a conectar')}
        </div>
      </div>`;
  }
  const boton = (accion, icono, texto) => `
    <button type="button" data-accion="${accion}" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition
      bg-telecab-card2 border-telecab-border text-telecab-muted hover:border-telecab-gold/50 hover:text-telecab-gold">
      <i class="fa-solid ${icono} mr-1" aria-hidden="true"></i>${texto}</button>`;

  function pintarRegistro() {
    cajaRegistro.innerHTML = `
      <div class="bg-telecab-card border border-telecab-border rounded-2xl overflow-hidden">
        <div class="px-5 py-3 border-b border-telecab-border"><h3 class="font-semibold text-sm uppercase tracking-wide text-telecab-muted">Lo que ha pasado</h3></div>
        <ul class="divide-y divide-telecab-border/60">${registro.length
          ? registro.map(r => `<li class="px-5 py-2 text-sm flex gap-3"><span class="text-telecab-muted tabular-nums text-xs pt-0.5">${esc(r.hora)}</span><span>${esc(r.texto)}</span></li>`).join('')
          : '<li class="px-5 py-4 text-sm text-telecab-muted">Todavía nada.</li>'}</ul>
      </div>`;
  }

  async function leerServidor() {
    try { servidor = await Api.get('/tiempo-real/api/estado'); } catch (_) { /* Api ya lo dice */ }
    pintarEstado();
  }

  cajaEstado.addEventListener('click', async e => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const accion = b.dataset.accion;
    if (accion === 'uno') {
      pedidoEn = performance.now();
      await Api.post('/tiempo-real/api/probar', { veces: 1 }, { aviso: 'No se ha mandado' });
    } else if (accion === 'hueco') {
      // Lo que se manda con la conexión cortada tiene que llegar al volver.
      TiempoReal.cortar();
      apuntar('Cortado. Mando 3 avisos sin conexión…');
      const r = await Api.post('/tiempo-real/api/probar', { veces: 3 }, { aviso: 'No se han mandado' });
      if (r) apuntar(`Mandados ${r.ids.length}. Vuelvo a conectar: tienen que llegar los 3.`);
      TiempoReal.reconectar();
    } else if (accion === 'volver') {
      TiempoReal.reconectar();
    }
    setTimeout(leerServidor, 300);
  });

  TiempoReal.alCambiar((nuevo, antes) => {
    apuntar(`Estado: de ${(ESTADO[antes] || {}).texto || antes} a ${(ESTADO[nuevo] || {}).texto || nuevo}`);
    pintarEstado();
  });

  // En local las pantallas van por sondeo (HTTP/1.1); aquí, en directo.
  TiempoReal.forzarDirecto();
  TiempoReal.escuchar('prueba', {
    alLlegar: (d, aviso) => {
      let texto = `Aviso ${d.n} de ${d.de} (${aviso.id})`;
      if (pedidoEn !== null && d.de === 1) {
        texto += `: llegó ${Math.round(performance.now() - pedidoEn)} ms después de pedirlo`;
        pedidoEn = null;
      }
      apuntar(texto);
      pintarEstado();
    },
    sondear: () => { apuntar('Me pongo al día (sondeo o reinicio)'); return leerServidor(); },
    cada: 10000,
  });

  pintarEstado();
  pintarRegistro();
  leerServidor();
  setInterval(() => { if (!document.hidden) leerServidor(); }, 15000);
})();
