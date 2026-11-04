// modules/Control/vistas/controlCampanasInforme.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const TIPOS = DEL_SERVIDOR.tiposJ;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + ' %' : '');
  const hh = n => String(n).padStart(2, '0') + ':00';
  const qsTurno = new URLSearchParams(location.search).get('turno');
  let turnoVista = qsTurno === 'dia' || qsTurno === 'noche' ? qsTurno : null; // null = por reloj

  // Un desglose "etiqueta N" ordenado de más a menos. Vale para resultados y agentes.
  const chips = (obj, tono) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => '<span class="px-2 py-0.5 rounded-lg text-[11px] ' + (tono || 'bg-telecab-card2 text-telecab-text') + '">' +
      esc(k) + ' <b>' + n + '</b></span>').join(' ');

  function tarjetaCampana(meta, colaAhora, st) {
    const s = st || { llamadas: 0, conductores: 0, contactados: 0, noLocalizados: 0, porResultado: {}, porAgente: {} };
    return '<div class="bg-telecab-card border border-telecab-border rounded-2xl p-4">' +
      '<div class="flex items-center justify-between gap-2 mb-1">' +
        '<h2 class="font-semibold text-telecab-text">Campaña ' + meta.n + ' · ' + hh(meta.abre) + '–' + hh(meta.cierra) + '</h2>' +
        (meta.estado === 'abierta'
          ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-telecab-green/15 text-telecab-green font-semibold">abierta</span>'
          : meta.estado === 'terminada'
            ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-telecab-card2 text-telecab-muted">cerrada</span>'
            : '<span class="text-[11px] px-2 py-0.5 rounded-full bg-telecab-card2 text-telecab-muted">abre a las ' + hh(meta.abre) + '</span>') +
      '</div>' +
      '<p class="text-[11px] text-telecab-muted mb-3">' + esc(meta.detalle) + '</p>' +
      '<div class="grid grid-cols-3 gap-2 mb-3 text-center">' +
        '<div class="rounded-xl bg-telecab-card2/60 py-2"><p class="text-lg font-bold leading-none">' + colaAhora + '</p><p class="text-[10px] text-telecab-muted mt-1">en cola ahora</p></div>' +
        '<div class="rounded-xl bg-telecab-card2/60 py-2"><p class="text-lg font-bold leading-none">' + s.llamadas + '</p><p class="text-[10px] text-telecab-muted mt-1">llamadas (' + s.conductores + ' pers.)</p></div>' +
        '<div class="rounded-xl bg-telecab-card2/60 py-2"><p class="text-lg font-bold leading-none text-telecab-green">' + s.contactados + '</p><p class="text-[10px] text-telecab-muted mt-1">contactados · ' + s.noLocalizados + ' no loc.</p></div>' +
      '</div>' +
      (Object.keys(s.porResultado).length
        ? '<p class="text-[10px] text-telecab-muted uppercase tracking-wide mb-1">Resultados</p><div class="flex flex-wrap gap-1.5 mb-2">' + chips(s.porResultado) + '</div>'
        : '<p class="text-xs text-telecab-muted">Sin llamadas apuntadas en esta campaña.</p>') +
      (Object.keys(s.porAgente).length
        ? '<p class="text-[10px] text-telecab-muted uppercase tracking-wide mb-1 mt-2">Quién llamó</p><div class="flex flex-wrap gap-1.5">' + chips(s.porAgente, 'bg-telecab-gold/15 text-telecab-gold') + '</div>'
        : '') +
    '</div>';
  }

  async function cargar() {
    try {
      const r = await fetch('/control/api/campanas-informe' + (turnoVista ? '?turno=' + turnoVista : '')).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'Error');

      document.querySelectorAll('#i-turnos [data-turno]').forEach(b => {
        const on = b.dataset.turno === r.turno;
        b.className = 'px-3 py-2 text-sm transition ' + (on
          ? 'bg-telecab-gold text-telecab-dark font-semibold'
          : 'bg-telecab-card text-telecab-muted hover:text-telecab-text');
      });
      $('#i-ventanas').textContent = 'Las del turno ' + (r.turno === 'noche' ? 'noche' : 'día') +
        ' van de ' + hh(r.campanas[0].abre) + ' a ' + hh(r.campanas[r.campanas.length - 1].cierra) +
        (r.turno !== r.turnoDelReloj ? ' (ahora el reloj va por el turno ' + (r.turnoDelReloj === 'noche' ? 'noche' : 'día') + ').' : '.');
      $('#i-gestor').href = '/control/campanas?vista=gestor' + (turnoVista ? '&turno=' + turnoVista : '');

      $('#g-plan').textContent = r.resumen.plan;
      $('#g-activos').textContent = r.resumen.activos;
      $('#g-activos-pct').textContent = pct(r.resumen.activos, r.resumen.plan);
      $('#g-pend').textContent = r.resumen.pendientes;
      $('#g-just').textContent = r.resumen.justificados;
      $('#g-roja').textContent = r.resumen.listaRoja;

      const st = (r.estadisticas || {}).origenes || {};
      const total = (r.estadisticas || {}).total || { llamadas: 0, conductores: 0 };
      $('#g-llamadas').textContent = total.llamadas;
      $('#g-conds').textContent = total.conductores ? 'a ' + total.conductores + ' pers.' : '';

      // Las J del día por sus cinco tipos, aunque estén a cero: el hueco también informa.
      $('#g-jtipos').innerHTML = '<span class="text-[11px] text-telecab-muted uppercase tracking-wide mr-1 self-center">J por tipo:</span>' +
        TIPOS.map(t => {
          const n = ((r.justificados || {})[t.codigo] || []).length;
          return '<span class="px-2 py-1 rounded-lg text-xs ' + (n ? 'bg-sky-500/15 text-sky-400 font-semibold' : 'bg-telecab-card2 text-telecab-muted') + '">' +
            esc(t.etiqueta) + ' <b>' + n + '</b></span>';
        }).join('');

      const colas = { 1: r.c1.length, 2: r.c2.etiquetados.length + r.c2.interrogacion.length, 3: r.c3.length };
      $('#i-campanas').innerHTML = r.campanas.map(c =>
        tarjetaCampana(c, colas[c.n] || 0, st['campana' + c.n])).join('');

      // Lo llamado desde el cockpit no es de ninguna campaña, pero es trabajo
      // hecho y sin él el informe diría que nadie ha llamado.
      const ck = st.control;
      $('#i-cockpit').innerHTML = ck && ck.llamadas
        ? '<div class="bg-telecab-card border border-telecab-border rounded-2xl p-4">' +
          '<h2 class="font-semibold text-telecab-text mb-1">Desde el cockpit (En directo)</h2>' +
          '<p class="text-[11px] text-telecab-muted mb-2">Llamadas apuntadas fuera de las campañas: ' + ck.llamadas + ' a ' + ck.conductores + ' personas · ' +
            ck.contactados + ' contactados.</p>' +
          '<div class="flex flex-wrap gap-1.5 mb-2">' + chips(ck.porResultado) + '</div>' +
          '<div class="flex flex-wrap gap-1.5">' + chips(ck.porAgente, 'bg-telecab-gold/15 text-telecab-gold') + '</div>' +
        '</div>'
        : '';

      $('#i-actualizado').textContent = '· actualizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      $('#i-campanas').innerHTML = '<p class="px-4 py-8 text-center text-sm text-telecab-red lg:col-span-3">' + esc(e.message) + '</p>';
    }
  }

  document.querySelectorAll('#i-turnos [data-turno]').forEach(b =>
    b.addEventListener('click', () => {
      if (turnoVista === b.dataset.turno) return;
      turnoVista = b.dataset.turno;
      cargar();
    }));
  $('#i-refrescar').addEventListener('click', cargar);
  setInterval(cargar, 60000);
  cargar();
})();
