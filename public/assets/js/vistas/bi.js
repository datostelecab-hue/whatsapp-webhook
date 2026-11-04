// views/bi.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const $ = s => document.querySelector(s);
  const raiz = document.documentElement;
  const cv = (n, a) => { const v = getComputedStyle(raiz).getPropertyValue(n).trim(); return a == null ? `rgb(${v})` : `rgb(${v} / ${a})`; };
  const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const esc = Casa.esc;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const raya = '<span class="text-telecab-border">—</span>';
  const v = (x, f) => (x == null ? raya : f(x));
  const diaCorto = iso => { const d = new Date(iso + 'T12:00:00'); return ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()] + ' ' + d.getDate(); };
  const mesCorto = ym => { const [y, m] = ym.split('-'); return ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1] + ' ' + y.slice(2); };

  if (window.Chart) {
    Chart.defaults.color = cv('--tc-muted');
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.borderColor = cv('--tc-border', 0.5);
    if (window.ChartDataLabels) { Chart.register(ChartDataLabels); Chart.defaults.set('plugins.datalabels', { display: false }); }
  }
  const charts = {};
  const grafico = (id, cfg) => {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = document.getElementById(id); if (!el) return null;
    const caja = el.parentElement;
    const vacio = !cfg.data.labels.length || cfg.data.datasets.every(d => !d.data.some(x => x != null && x !== 0));
    let aviso = caja.querySelector('.g-vacio');
    if (vacio) {
      if (!aviso) { aviso = document.createElement('p'); aviso.className = 'g-vacio absolute inset-0 flex items-center justify-center text-sm text-telecab-muted'; caja.appendChild(aviso); }
      aviso.textContent = 'Sin datos en el periodo.'; el.style.visibility = 'hidden'; return null;
    }
    if (aviso) aviso.remove(); el.style.visibility = '';
    charts[id] = new Chart(el, cfg); return charts[id];
  };
  const grid = () => cv('--tc-border', 0.35);
  const ejeY = (fmt, extra) => Object.assign({ beginAtZero: true, grid: { color: grid() }, ticks: { callback: fmt || (x => nf0.format(x)) } }, extra || {});
  const ejeX = () => ({ grid: { display: false } });
  const leyenda = () => ({ labels: { boxWidth: 12, usePointStyle: true } });

  // ── Estado: periodo, filtros y pestaña. Se guarda en la URL para poder compartirla.
  const estado = { preset: 'mes', desde: '', hasta: '', zona: '', tipo: '', turno: '', tab: 'resumen' };
  (function leerURL() {
    const u = new URLSearchParams(location.search);
    Object.keys(estado).forEach(k => { if (u.get(k)) estado[k] = u.get(k); });
  })();
  const query = () => {
    const p = new URLSearchParams();
    if (estado.desde && estado.hasta) { p.set('desde', estado.desde); p.set('hasta', estado.hasta); } else p.set('preset', estado.preset);
    ['zona', 'tipo', 'turno'].forEach(k => { if (estado[k]) p.set(k, estado[k]); });
    return p.toString();
  };
  const guardarURL = () => { const p = new URLSearchParams(query()); p.set('tab', estado.tab); history.replaceState(null, '', '?' + p.toString()); };
  const api = async (ruta, extra) => {
    const r = await fetch('/bi/api/' + ruta + '?' + query() + (extra ? '&' + extra : '')).then(x => x.json()).catch(() => null);
    return r && r.status === 'ok' ? r : null;
  };

  // ── Delta frente al periodo anterior. `mejorAlto` dice si subir es bueno.
  function delta(id, actual, anterior, fmt, mejorAlto = true) {
    const e = document.getElementById(id + '-delta'); if (!e) return;
    if (actual == null || anterior == null || anterior === 0) { e.textContent = ''; return; }
    const pct = (actual - anterior) / Math.abs(anterior) * 100;
    const bueno = mejorAlto ? pct >= 0 : pct <= 0;
    e.className = 'text-[11px] tabular-nums font-medium ' + (Math.abs(pct) < 0.5 ? 'text-telecab-muted' : bueno ? 'text-telecab-green' : 'text-telecab-red');
    e.textContent = (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '= ') + nf1.format(Math.abs(pct)) + ' %' + (fmt ? ' · antes ' + fmt(anterior) : '');
  }

  // ══ RESUMEN ══════════════════════════════════════════════════════════════
  async function cargarResumen() {
    const [r, s, m, d] = await Promise.all([api('resumen'), api('serie'), api('kpi-mes'), api('desglose')]);
    if (r) {
      const a = r.actual, b = r.anterior;
      set('k-neto', eur.format(a.neto || 0)); delta('k-neto', a.neto, b.neto, eur.format);
      set('k-horas', nf0.format(a.horas || 0) + ' h'); delta('k-horas', a.horas, b.horas, x => nf0.format(x) + ' h');
      set('k-eurh', a.eurosHora == null ? '—' : eur2.format(a.eurosHora)); delta('k-eurh', a.eurosHora, b.eurosHora, eur2.format);
      set('k-viajes', nf0.format(a.viajes || 0) + (a.eurosViaje != null ? ' · ' + eur2.format(a.eurosViaje) : '')); delta('k-viajes', a.viajes, b.viajes, nf0.format);
      set('k-util', a.utilizacion == null ? '—' : nf1.format(a.utilizacion) + ' %'); delta('k-util', a.utilizacion, b.utilizacion, x => nf1.format(x) + ' %');
      set('k-perd', a.pctPerdidas == null ? '—' : nf1.format(a.pctPerdidas) + ' %'); delta('k-perd', a.pctPerdidas, b.pctPerdidas, x => nf1.format(x) + ' %', false);
      set('k-coches', nf0.format(a.coches || 0) + (a.horasPorCocheDia != null ? ' · ' + nf1.format(a.horasPorCocheDia) + ' h/día' : '')); delta('k-coches', a.horasPorCocheDia, b.horasPorCocheDia, x => nf1.format(x) + ' h/día');
      set('k-plant', (a.plantilla == null ? '—' : nf0.format(a.plantilla)) + (a.pctAbsentismo != null ? ' · ' + nf1.format(a.pctAbsentismo) + ' % aus.' : '')); delta('k-plant', a.pctAbsentismo, b.pctAbsentismo, x => nf1.format(x) + ' %', false);
    }
    if (s) {
      const dias = s.dias.filter(x => x.neto != null || x.horas != null);
      grafico('g-r-dia', { type: 'bar', data: { labels: dias.map(x => diaCorto(x.dia)), datasets: [
        { type: 'line', label: 'Horas efectivas', data: dias.map(x => x.horas), yAxisID: 'y2', borderColor: cv('--tc-text', 0.85), borderWidth: 2, pointRadius: 2, tension: 0.3, order: 0 },
        { label: 'Neto', data: dias.map(x => x.neto), backgroundColor: dias.map(x => x.esFinde ? cv('--tc-gold', 0.85) : cv('--tc-gold', 0.55)), borderRadius: 3, order: 1 },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: leyenda(), tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (c.dataset.yAxisID === 'y2' ? nf0.format(c.parsed.y) + ' h' : eur.format(c.parsed.y)) } } },
        scales: { x: ejeX(), y: ejeY(x => eur.format(x)), y2: ejeY(x => nf0.format(x) + ' h', { position: 'right', grid: { display: false } }) } } });
    }
    if (m) {
      const ms = m.meses;
      grafico('g-r-meses', { type: 'bar', data: { labels: ms.map(x => mesCorto(x.anio_mes)), datasets: [
        { type: 'line', label: '€ / hora', data: ms.map(x => x.euros_hora), yAxisID: 'y2', borderColor: cv('--tc-green'), borderWidth: 2, pointRadius: 4, tension: 0.3, order: 0,
          datalabels: { display: true, align: 'top', color: cv('--tc-green'), font: { weight: '600', size: 11 }, formatter: x => (x == null ? '' : nf2.format(x)) } },
        { label: 'Neto', data: ms.map(x => x.neto), backgroundColor: cv('--tc-gold', 0.6), borderRadius: 4, order: 1,
          datalabels: { display: true, anchor: 'end', align: 'start', color: cv('--tc-text', 0.9), font: { size: 10 }, formatter: x => (x == null ? '' : eur.format(x)) } },
      ] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: leyenda() }, scales: { x: ejeX(), y: ejeY(x => eur.format(x)), y2: ejeY(x => eur2.format(x), { position: 'right', grid: { display: false } }) } } });
    }
    if (d) {
      $('#t-r-zona').innerHTML = d.zona.map(z => `<tr class="border-b border-telecab-border/40">
        <td class="px-3 py-1.5 text-telecab-text">${esc(z.clave)}</td><td class="px-3 py-1.5 text-right text-telecab-gold">${v(z.neto, eur.format)}</td>
        <td class="px-3 py-1.5 text-right">${v(z.horas, x => nf0.format(x))}</td><td class="px-3 py-1.5 text-right">${v(z.eurosHora, eur2.format)}</td>
        <td class="px-3 py-1.5 text-right text-telecab-muted">${z.conductores || raya}</td><td class="px-3 py-1.5 text-right ${z.pctPerdidas > 35 ? 'text-telecab-red' : 'text-telecab-muted'}">${v(z.pctPerdidas, x => nf1.format(x) + ' %')}</td></tr>`).join('');
      set('t-r-zona-n', d.zona.length + ' zonas');
    }
  }

  // ══ NEGOCIO ══════════════════════════════════════════════════════════════
  async function cargarNegocio() {
    const [r, s, h, d] = await Promise.all([api('resumen'), api('serie'), api('heatmap'), api('desglose')]);
    if (r) {
      const a = r.actual, b = r.anterior;
      set('n-eurh', a.eurosHora == null ? '—' : eur2.format(a.eurosHora)); delta('n-eurh', a.eurosHora, b.eurosHora, eur2.format);
      set('n-eurv', a.eurosViaje == null ? '—' : eur2.format(a.eurosViaje)); delta('n-eurv', a.eurosViaje, b.eurosViaje, eur2.format);
      set('n-vh', a.viajesHora == null ? '—' : nf2.format(a.viajesHora)); delta('n-vh', a.viajesHora, b.viajesHora, nf2.format);
      set('n-conv', a.pctConversion == null ? '—' : nf1.format(a.pctConversion) + ' %'); delta('n-conv', a.pctConversion, b.pctConversion, x => nf1.format(x) + ' %');
    }
    if (s) {
      const dias = s.dias.filter(x => x.horas != null);
      grafico('g-n-ratios', { type: 'line', data: { labels: dias.map(x => diaCorto(x.dia)), datasets: [
        { label: '€ / hora', data: dias.map(x => x.eurosHora), borderColor: cv('--tc-gold'), borderWidth: 2, pointRadius: 2, tension: 0.3, yAxisID: 'y' },
        { label: 'Viajes / hora', data: dias.map(x => x.viajesHora), borderColor: cv('--tc-text', 0.7), borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y2' },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
        scales: { x: ejeX(), y: ejeY(x => eur2.format(x)), y2: ejeY(x => nf2.format(x), { position: 'right', grid: { display: false } }) } } });
      const of = s.dias.filter(x => x.ofertas);
      grafico('g-n-ofertas', { type: 'bar', data: { labels: of.map(x => diaCorto(x.dia)), datasets: [
        { label: 'Viajes', data: of.map(x => x.viajes), backgroundColor: cv('--tc-green', 0.7), stack: 'o' },
        { label: 'Perdidas por el conductor', data: of.map(x => x.perdidas), backgroundColor: cv('--tc-red', 0.7), stack: 'o' },
        { label: 'Canceladas por el cliente', data: of.map(x => x.cancCliente), backgroundColor: cv('--tc-muted', 0.5), stack: 'o' },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
        scales: { x: Object.assign(ejeX(), { stacked: true }), y: ejeY(null, { stacked: true }) } } });
    }
    if (h) pintarHeatmap(h.celdas);
    if (d) {
      $('#t-n-turnohora').innerHTML = d.turnoHora.map(t => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text">${esc(t.clave)}</td>
        <td class="px-3 py-1.5 text-right">${nf0.format(t.viajes)}</td><td class="px-3 py-1.5 text-right text-telecab-gold">${v(t.neto, eur.format)}</td>
        <td class="px-3 py-1.5 text-right ${t.pctPerdidas > 35 ? 'text-telecab-red' : 'text-telecab-muted'}">${v(t.pctPerdidas, x => nf1.format(x) + ' %')}</td></tr>`).join('');
      const filaDesg = z => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text">${esc(z.clave)}</td>
        <td class="px-3 py-1.5 text-right text-telecab-gold">${v(z.neto, eur.format)}</td><td class="px-3 py-1.5 text-right">${v(z.horas, x => nf0.format(x))}</td>
        <td class="px-3 py-1.5 text-right">${v(z.eurosHora, eur2.format)}</td><td class="px-3 py-1.5 text-right text-telecab-muted">${z.conductores || raya}</td></tr>`;
      $('#t-n-contrato').innerHTML = d.contrato.map(filaDesg).join('');
      $('#t-n-turno').innerHTML = d.turno.map(filaDesg).join('');
    }
  }

  // El mapa de calor es una rejilla CSS de 7 × 24: más control que un canvas y se
  // lee igual de bien.
  function pintarHeatmap(celdas) {
    const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const m = new Map(celdas.map(c => [c.dow + '-' + c.hora, c]));
    const max = Math.max(1, ...celdas.map(c => c.neto || 0));
    const color = x => `rgb(${getComputedStyle(raiz).getPropertyValue('--tc-gold').trim()} / ${x <= 0 ? 0.04 : 0.12 + 0.88 * Math.pow(x / max, 0.6)})`;
    let html = '<div class="grid gap-px text-[10px]" style="grid-template-columns: 2.4rem repeat(24, minmax(1.6rem, 1fr))">';
    html += '<div></div>' + Array.from({ length: 24 }, (_, h) => `<div class="text-center text-telecab-muted">${h}</div>`).join('');
    for (let d = 1; d <= 7; d++) {
      html += `<div class="text-telecab-muted pr-1 flex items-center">${DIAS[d - 1]}</div>`;
      for (let h = 0; h < 24; h++) {
        const c = m.get(d + '-' + h);
        html += `<div class="h-7 rounded-sm" style="background:${color(c ? c.neto : 0)}" title="${DIAS[d - 1]} ${h}:00 · ${c ? eur.format(c.neto) + ' · ' + c.viajes + ' viajes' : 'sin viajes'}"></div>`;
      }
    }
    $('#b-heat').innerHTML = html + '</div>';
    $('#b-heat-escala').innerHTML = [0.1, 0.3, 0.5, 0.7, 1].map(x => `<span class="inline-block w-4 h-3 rounded-sm" style="background:${color(x * max)}"></span>`).join('');
  }

  // ══ FLOTA ════════════════════════════════════════════════════════════════
  let cochesFilas = [], cochesOrden = { col: 'neto', desc: true };
  async function cargarFlota() {
    const [r, s, vh] = await Promise.all([api('resumen'), api('serie'), api('vehiculos')]);
    if (r) {
      const a = r.actual, b = r.anterior;
      set('f-hcd', a.horasPorCocheDia == null ? '—' : nf1.format(a.horasPorCocheDia) + ' h'); delta('f-hcd', a.horasPorCocheDia, b.horasPorCocheDia, x => nf1.format(x) + ' h');
      set('f-ecd', a.eurosPorCocheDia == null ? '—' : eur.format(a.eurosPorCocheDia)); delta('f-ecd', a.eurosPorCocheDia, b.eurosPorCocheDia, eur.format);
      set('f-km', nf0.format(a.kmBolt || 0) + ' km' + (a.kmFuera ? ' · ' + nf0.format(a.kmFuera) + ' fuera' : '')); delta('f-km', a.kmBolt, b.kmBolt, x => nf0.format(x) + ' km');
      set('f-ekm', a.eurosKm == null ? '—' : eur2.format(a.eurosKm)); delta('f-ekm', a.eurosKm, b.eurosKm, eur2.format);
    }
    if (s) {
      const dias = s.dias.filter(x => x.horas != null);
      grafico('g-f-coches', { type: 'bar', data: { labels: dias.map(x => diaCorto(x.dia)), datasets: [
        { type: 'line', label: 'Horas por coche', data: dias.map(x => (x.coches ? Math.round(x.horas / x.coches * 10) / 10 : null)), yAxisID: 'y2', borderColor: cv('--tc-gold'), borderWidth: 2, pointRadius: 2, tension: 0.3, order: 0 },
        { label: 'Coches con horas', data: dias.map(x => x.coches), backgroundColor: cv('--tc-text', 0.25), borderRadius: 3, order: 1 },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
        scales: { x: ejeX(), y: ejeY(), y2: ejeY(x => nf1.format(x) + ' h', { position: 'right', grid: { display: false } }) } } });
      const km = s.dias.filter(x => x.kmBolt != null);
      grafico('g-f-km', { type: 'bar', data: { labels: km.map(x => diaCorto(x.dia)), datasets: [
        { label: 'Km en BOLT', data: km.map(x => x.kmBolt), backgroundColor: cv('--tc-green', 0.65), stack: 'k' },
        { label: 'Km fuera', data: km.map(x => x.kmFuera), backgroundColor: cv('--tc-warn', 0.75), stack: 'k' },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
        scales: { x: Object.assign(ejeX(), { stacked: true }), y: ejeY(x => nf0.format(x) + ' km', { stacked: true }) } } });
    }
    if (vh) { cochesFilas = vh.filas; pintarCoches(); }
  }
  function pintarCoches() {
    const { col, desc } = cochesOrden;
    const filas = cochesFilas.slice().sort((a, b) => ((b[col] ?? -1e9) - (a[col] ?? -1e9)) * (desc ? 1 : -1));
    $('#t-f-coches').innerHTML = filas.map(c => `<tr class="border-b border-telecab-border/40 hover:bg-telecab-card2/40">
      <td class="px-3 py-1.5 font-mono text-telecab-text">${esc(c.matricula)}</td><td class="px-3 py-1.5 text-telecab-muted">${esc(c.zona || '—')}</td>
      <td class="px-3 py-1.5 text-telecab-muted truncate max-w-[10rem]">${esc(c.modelo || '')}</td>
      <td class="px-3 py-1.5 text-right ${c.diasSalio < c.diasPeriodo * 0.7 ? 'text-telecab-red' : ''}">${c.diasSalio} / ${c.diasPeriodo}</td>
      <td class="px-3 py-1.5 text-right ${c.horasDia != null && c.horasDia < 10 ? 'text-telecab-red' : ''}">${v(c.horasDia, x => nf1.format(x))}</td>
      <td class="px-3 py-1.5 text-right">${v(c.eurosDia, eur.format)}</td><td class="px-3 py-1.5 text-right">${v(c.eurosHora, eur2.format)}</td>
      <td class="px-3 py-1.5 text-right text-telecab-muted">${v(c.kmTotal, x => nf0.format(x))}</td>
      <td class="px-3 py-1.5 text-right ${c.pctKmFuera > 20 ? 'text-telecab-red' : 'text-telecab-muted'}">${v(c.pctKmFuera, x => nf1.format(x) + ' %')}</td>
      <td class="px-3 py-1.5 text-right text-telecab-gold">${v(c.neto, eur.format)}</td></tr>`).join('');
    set('t-f-coches-n', filas.length + ' coches · orden: ' + col);
  }
  const COLS_COCHES = ['matricula', 'zona', 'modelo', 'diasSalio', 'horasDia', 'eurosDia', 'eurosHora', 'kmTotal', 'pctKmFuera', 'neto'];
  document.querySelectorAll('#t-f-coches').forEach(tb => tb.closest('table').querySelectorAll('th').forEach((th, i) => {
    th.classList.add('cursor-pointer', 'hover:text-telecab-text');
    th.addEventListener('click', () => { const c = COLS_COCHES[i]; cochesOrden = { col: c, desc: cochesOrden.col === c ? !cochesOrden.desc : true }; pintarCoches(); });
  }));

  // ══ PERSONAS ═════════════════════════════════════════════════════════════
  async function cargarPersonas() {
    const [p, r] = await Promise.all([api('plantilla'), api('resumen')]);
    if (p) {
      const tot = p.hoy.reduce((s, x) => s + x.n, 0), aus = p.hoy.reduce((s, x) => s + x.ausentes, 0), sinBolt = p.hoy.reduce((s, x) => s + x.sinBolt, 0);
      set('p-plant', nf0.format(tot) + ' · ' + p.hoy.map(x => x.n + ' ' + x.tipo).join(' + '));
      set('p-aus', nf0.format(aus) + (tot ? ' · ' + nf1.format(aus / tot * 100) + ' %' : ''));
      if (r) { set('p-altas', nf0.format(r.actual.altas) + ' altas · ' + nf0.format(r.actual.bajas) + ' bajas'); }
      set('p-sinbolt', nf0.format(sinBolt));
      const s = p.serie;
      grafico('g-p-plantilla', { type: 'line', data: { labels: s.map(x => diaCorto(x.dia)), datasets: [
        { label: 'Propia', data: s.map(x => x.propia), borderColor: cv('--tc-gold'), backgroundColor: cv('--tc-gold', 0.25), fill: true, tension: 0.2, pointRadius: 0, stack: 'p' },
        { label: 'ETT', data: s.map(x => x.ett), borderColor: cv('--tc-violet'), backgroundColor: cv('--tc-violet', 0.25), fill: true, tension: 0.2, pointRadius: 0, stack: 'p' },
        { label: 'Ausentes', data: s.map(x => x.ausentes), borderColor: cv('--tc-red'), borderWidth: 2, pointRadius: 0, tension: 0.2, fill: false },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
        scales: { x: ejeX(), y: ejeY(null, { stacked: true }) } } });
      const tonos = [cv('--tc-red', 0.8), cv('--tc-gold', 0.8), cv('--tc-warn', 0.8), cv('--tc-violet', 0.8), cv('--tc-muted', 0.6)];
      grafico('g-p-ausentes', { type: 'doughnut', data: { labels: p.ausentesHoy.map(x => x.estado), datasets: [{ data: p.ausentesHoy.map(x => x.n), backgroundColor: tonos, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, usePointStyle: true } },
          datalabels: { display: true, color: cv('--tc-text'), font: { weight: '700' } } } } });
      grafico('g-p-altasbajas', { type: 'bar', data: { labels: s.map(x => diaCorto(x.dia)), datasets: [
        { label: 'Altas', data: s.map(x => x.altas), backgroundColor: cv('--tc-green', 0.7) },
        { label: 'Bajas', data: s.map(x => -x.bajas), backgroundColor: cv('--tc-red', 0.7) },
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda(), tooltip: { callbacks: { label: c => c.dataset.label + ': ' + Math.abs(c.parsed.y) } } },
        scales: { x: Object.assign(ejeX(), { stacked: true }), y: { stacked: true, grid: { color: grid() }, ticks: { callback: x => Math.abs(x) } } } } });
      const barras = (id, datos, color) => grafico(id, { type: 'bar', data: { labels: datos.map(x => x.tramo), datasets: [{ data: datos.map(x => x.n), backgroundColor: color, borderRadius: 4,
        datalabels: { display: true, anchor: 'end', align: 'top', color: cv('--tc-text'), font: { weight: '600', size: 11 } } }] },
        options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } }, plugins: { legend: { display: false } }, scales: { x: ejeX(), y: ejeY() } } });
      barras('g-p-antig', p.antiguedad, cv('--tc-gold', 0.7));
      barras('g-p-edad', p.edad, cv('--tc-violet', 0.7));
      $('#t-p-bajas').innerHTML = p.bajasMotivo.length ? p.bajasMotivo.map(m => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text">${esc(m.motivo)}</td><td class="px-3 py-1.5 text-right">${m.n}</td></tr>`).join('')
        : '<tr><td colspan="2" class="px-3 py-4 text-center text-telecab-muted">Sin bajas reales en el periodo.</td></tr>';
    }
    await cargarRanking();
  }
  async function cargarRanking() {
    const c = await api('conductores', 'orden=' + $('#p-orden').value + '&limite=' + $('#p-limite').value);
    if (!c) return;
    set('p-min', nf0.format(c.minHoras || 0));
    $('#t-p-cond').innerHTML = c.filas.map((f, i) => `<tr class="border-b border-telecab-border/40 hover:bg-telecab-card2/40 ${f.vigente === false ? 'opacity-60' : ''}">
      <td class="px-3 py-1.5 text-telecab-muted">${i + 1}</td>
      <td class="px-3 py-1.5"><div class="text-telecab-text font-medium truncate max-w-[16rem]" title="${esc(f.nombre)}">${esc(f.nombre)}</div>
        <div class="text-[11px] text-telecab-muted font-mono">${f.sinEnlazar ? '<span class="text-telecab-warn">sin enlazar a plantilla</span>' : esc(f.telefono || '')}</div></td>
      <td class="px-3 py-1.5 text-telecab-muted">${esc(f.tipo || '—')}</td><td class="px-3 py-1.5 text-telecab-muted">${esc(f.zona || '—')}</td>
      <td class="px-3 py-1.5 text-right">${f.dias}</td><td class="px-3 py-1.5 text-right">${v(f.horas, x => nf1.format(x))}</td>
      <td class="px-3 py-1.5 text-right ${f.horasDia != null && f.horasDia < 8 ? 'text-telecab-red' : ''}">${v(f.horasDia, x => nf1.format(x))}</td>
      <td class="px-3 py-1.5 text-right">${nf0.format(f.viajes)}</td><td class="px-3 py-1.5 text-right text-telecab-gold">${v(f.neto, eur.format)}</td>
      <td class="px-3 py-1.5 text-right">${v(f.eurosHora, eur2.format)}</td><td class="px-3 py-1.5 text-right text-telecab-muted">${v(f.utilizacion, x => nf0.format(x) + ' %')}</td>
      <td class="px-3 py-1.5 text-right ${f.pctPerdidas > 35 ? 'text-telecab-red' : 'text-telecab-muted'}">${v(f.pctPerdidas, x => nf0.format(x) + ' %')}</td></tr>`).join('');
  }
  $('#p-orden').addEventListener('change', cargarRanking);
  $('#p-limite').addEventListener('change', cargarRanking);

  // ══ OPERACIÓN ════════════════════════════════════════════════════════════
  async function cargarOperacion() {
    const o = await api('operacion'); if (!o) return;
    grafico('g-o-cobertura', { type: 'bar', data: { labels: o.cobertura.map(x => diaCorto(x.dia)), datasets: [
      { label: 'Cubiertas', data: o.cobertura.map(x => x.cubiertas), backgroundColor: cv('--tc-green', 0.7), stack: 'c' },
      { label: 'Huecos', data: o.cobertura.map(x => x.huecos), backgroundColor: cv('--tc-red', 0.75), stack: 'c',
        datalabels: { display: true, color: cv('--tc-text'), font: { weight: '700', size: 11 }, formatter: x => (x > 0 ? x : '') } },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
      scales: { x: Object.assign(ejeX(), { stacked: true }), y: ejeY(null, { stacked: true }) } } });
    grafico('g-o-incidencias', { type: 'bar', data: { labels: o.incidenciasDia.map(x => diaCorto(x.dia)), datasets: [
      { label: 'Avisos', data: o.incidenciasDia.map(x => x.n - x.graves), backgroundColor: cv('--tc-warn', 0.6), stack: 'i' },
      { label: 'Graves', data: o.incidenciasDia.map(x => x.graves), backgroundColor: cv('--tc-red', 0.75), stack: 'i' },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: leyenda() },
      scales: { x: Object.assign(ejeX(), { stacked: true }), y: ejeY(null, { stacked: true }) } } });
    const vacio = (n, t) => `<tr><td colspan="${n}" class="px-3 py-4 text-center text-telecab-muted">${t}</td></tr>`;
    $('#t-o-tipo').innerHTML = o.incidenciasTipo.length ? o.incidenciasTipo.map(t => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text">${esc(t.tipo)}</td>
      <td class="px-3 py-1.5 text-right ${t.gravedad >= 4 ? 'text-telecab-red' : 'text-telecab-muted'}">${t.gravedad}</td><td class="px-3 py-1.5 text-right">${t.n}</td>
      <td class="px-3 py-1.5 text-right text-telecab-muted">${t.gestionadas}</td><td class="px-3 py-1.5 text-right text-telecab-muted">${t.minMedia || raya}</td></tr>`).join('') : vacio(5, 'Sin avisos en el periodo.');
    $('#t-o-reinc').innerHTML = o.reincidentes.length ? o.reincidentes.map(t => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text truncate max-w-[14rem]">${esc(t.conductor)}</td>
      <td class="px-3 py-1.5 font-mono text-telecab-muted">${esc(t.matricula)}</td><td class="px-3 py-1.5 text-right">${t.n}</td>
      <td class="px-3 py-1.5 text-right ${t.gravedad >= 4 ? 'text-telecab-red' : 'text-telecab-muted'}">${t.gravedad}</td></tr>`).join('') : vacio(4, 'Nadie con avisos en el periodo.');
    $('#t-o-bitacora').innerHTML = o.bitacora.length ? o.bitacora.map(b => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text">${mesCorto(b.mes)}</td>
      <td class="px-3 py-1.5 text-telecab-muted">${esc(b.marca)} · ${esc(b.etiqueta)}</td><td class="px-3 py-1.5 text-right">${b.n}</td></tr>`).join('') : vacio(3, 'Sin marcas en la bitácora.');
  }

  // ══ CONTRATACIÓN ═════════════════════════════════════════════════════════
  async function cargarContratacion() {
    const f = await api('funnel'); if (!f) return;
    const enFunnel = f.estados.filter(x => x.enFunnel).reduce((s, x) => s + x.n, 0);
    const salidas = f.estados.filter(x => x.esSalida).reduce((s, x) => s + x.n, 0);
    const altas = f.canales.reduce((s, x) => s + x.altas, 0);
    set('c-total', nf0.format(f.total)); set('c-funnel', nf0.format(enFunnel)); set('c-salidas', nf0.format(salidas));
    set('c-altas', nf0.format(altas) + (f.diasHastaAlta && f.diasHastaAlta.media != null ? ' · ' + nf1.format(f.diasHastaAlta.media) + ' días' : ''));
    grafico('g-c-funnel', { type: 'bar', data: { labels: f.estados.map(x => x.estado), datasets: [{ data: f.estados.map(x => x.n),
      backgroundColor: f.estados.map(x => x.esSalida ? cv('--tc-red', 0.6) : x.enFunnel ? cv('--tc-gold', 0.7) : cv('--tc-green', 0.7)), borderRadius: 4,
      datalabels: { display: true, anchor: 'end', align: 'end', color: cv('--tc-text'), font: { weight: '600' } } }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 24 } }, plugins: { legend: { display: false } },
        scales: { x: ejeY(), y: { grid: { display: false } } } } });
    $('#t-c-canales').innerHTML = f.canales.map(c => `<tr class="border-b border-telecab-border/40"><td class="px-3 py-1.5 text-telecab-text">${esc(c.canal)}</td>
      <td class="px-3 py-1.5 text-right">${c.n}</td><td class="px-3 py-1.5 text-right text-telecab-green">${c.altas}</td>
      <td class="px-3 py-1.5 text-right text-telecab-muted">${c.n ? nf0.format(c.altas / c.n * 100) + ' %' : raya}</td></tr>`).join('');
  }

  // ══ POWER BI ═════════════════════════════════════════════════════════════
  const DESCRIPCION = {
    bi_kpi_mes: ['Los indicadores de la empresa mes a mes: horas, neto, km, plantilla y sus ratios. Empieza por aquí.', 'mes'],
    bi_conductor_mes: ['La ficha de rendimiento de cada persona: horas, neto, €/h, ofertas perdidas.', 'persona × mes'],
    bi_vehiculo_dia: ['Cada coche cada día: horas, km en BOLT y fuera, neto atribuido, si salió.', 'coche × día'],
    bi_hecho_horas_dia: ['Segundos por situación (viaje, espera, descanso, desconectado).', 'día × persona × coche'],
    bi_hecho_ingresos_dia: ['Viajes, neto, propinas y ofertas perdidas por quién.', 'día × cuenta BOLT × turno'],
    bi_hecho_km_dia: ['Km de Mapon partidos en BOLT y fuera.', 'día × coche'],
    bi_plantilla_dia: ['Cuántos éramos cada día, cuántos faltaban y por qué, altas y bajas.', 'día'],
    bi_hecho_incidencias: ['Los avisos del control en directo con su persona y coche.', 'aviso'],
    bi_hecho_bitacora: ['Las marcas del día (J, L, V, B, P) por persona.', 'persona × día'],
    bi_funnel_candidaturas: ['El embudo de selección.', 'candidatura'],
    bi_dim_conductor: ['Quién es cada persona: contrato, zona, turno, antigüedad, estado, cuenta BOLT.', 'persona'],
    bi_dim_vehiculo: ['Qué es cada coche: modelo, zona, cuadrante, estado, vencimientos.', 'coche'],
  };
  async function cargarPowerBI() {
    const c = await fetch('/bi/api/conexion').then(x => x.json()).catch(() => null); if (!c) return;
    set('pb-host', c.host || '(no configurado)'); set('pb-base', c.base || '—');
    $('#t-pb-vistas').innerHTML = c.vistas.map(x => { const d = DESCRIPCION[x.vista] || ['', '']; return `<tr class="border-b border-telecab-border/40">
      <td class="px-4 py-2 font-mono text-telecab-gold">${esc(x.vista)}</td><td class="px-3 py-2 text-telecab-muted">${d[0]}</td><td class="px-3 py-2 text-telecab-muted whitespace-nowrap">${d[1]}</td>
      <td class="px-4 py-2 text-right"><a href="/bi/export/${x.clave}.csv?${query()}" class="text-xs text-telecab-muted hover:text-telecab-text"><i class="fa-solid fa-download mr-1"></i>CSV</a></td></tr>`; }).join('');
    const sel = $('#b-export');
    if (sel.options.length <= 1) c.vistas.forEach(x => { const o = document.createElement('option'); o.value = x.clave; o.textContent = x.vista; sel.appendChild(o); });
  }

  // ── Orquestación ─────────────────────────────────────────────────────────
  const CARGADORES = { resumen: cargarResumen, negocio: cargarNegocio, flota: cargarFlota, personas: cargarPersonas, operacion: cargarOperacion, contratacion: cargarContratacion, powerbi: cargarPowerBI };
  function pintarControles() {
    document.querySelectorAll('.b-preset').forEach(b => {
      const activo = !estado.desde && b.dataset.preset === estado.preset;
      b.className = 'b-preset px-3 py-1.5 rounded-lg border text-xs ' + (activo ? 'border-telecab-gold bg-telecab-gold/10 text-telecab-text' : 'border-telecab-border text-telecab-muted hover:text-telecab-text');
    });
    document.querySelectorAll('.b-tab').forEach(b => {
      const activo = b.dataset.tab === estado.tab;
      b.className = 'b-tab px-3 py-2 rounded-xl border text-sm flex items-center gap-2 ' + (activo ? 'border-telecab-gold bg-telecab-gold/10 text-telecab-text' : 'border-telecab-border bg-telecab-card text-telecab-muted hover:text-telecab-text');
    });
    document.querySelectorAll('.b-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== estado.tab));
    $('#b-desde').value = estado.desde; $('#b-hasta').value = estado.hasta;
    $('#b-zona').value = estado.zona; $('#b-tipo').value = estado.tipo; $('#b-turno').value = estado.turno;
  }
  async function cargar() {
    pintarControles(); guardarURL();
    const r = await api('resumen');
    if (r) set('b-rango', r.rango.desde.split('-').reverse().join('/') + ' → ' + r.rango.hasta.split('-').reverse().join('/') + ' · ' + r.rango.dias + ' días');
    await (CARGADORES[estado.tab] || cargarResumen)();
  }
  async function cargarMeta() {
    const m = await fetch('/bi/api/meta').then(x => x.json()).catch(() => null);
    if (m && m.refrescoAt) set('b-meta', '· datos de las ' + new Date(m.refrescoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + (m.detalle ? ' (' + Math.round(m.detalle.reduce((s, x) => s + x.ms, 0) / 1000) + ' s de cálculo)' : ''));
  }
  async function cargarCatalogo() {
    const c = await fetch('/bi/api/catalogo').then(x => x.json()).catch(() => null); if (!c) return;
    c.zonas.forEach(z => { const o = document.createElement('option'); o.value = z; o.textContent = z; $('#b-zona').appendChild(o); });
    c.turnos.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; $('#b-turno').appendChild(o); });
    $('#b-zona').value = estado.zona; $('#b-turno').value = estado.turno;
  }

  document.querySelectorAll('.b-preset').forEach(b => b.addEventListener('click', () => { estado.preset = b.dataset.preset; estado.desde = ''; estado.hasta = ''; cargar(); }));
  document.querySelectorAll('.b-tab').forEach(b => b.addEventListener('click', () => { estado.tab = b.dataset.tab; cargar(); }));
  ['desde', 'hasta'].forEach(k => $('#b-' + k).addEventListener('change', () => { estado[k] = $('#b-' + k).value; if (estado.desde && estado.hasta) cargar(); }));
  ['zona', 'tipo', 'turno'].forEach(k => $('#b-' + k).addEventListener('change', () => { estado[k] = $('#b-' + k).value; cargar(); }));
  $('#b-export').addEventListener('change', e => { if (e.target.value) { location.href = '/bi/export/' + e.target.value + '.csv?' + query(); e.target.value = ''; } });
  $('#b-refrescar').addEventListener('click', async () => {
    const b = $('#b-refrescar'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-rotate fa-spin mr-1"></i> Recalculando…';
    await fetch('/bi/api/refrescar', { method: 'POST' }).catch(() => null);
    b.disabled = false; b.innerHTML = '<i class="fa-solid fa-rotate mr-1"></i> Refrescar datos';
    cargarMeta(); cargar();
  });

  cargarCatalogo().then(() => { cargarPowerBI(); cargar(); });
  cargarMeta();
})();
