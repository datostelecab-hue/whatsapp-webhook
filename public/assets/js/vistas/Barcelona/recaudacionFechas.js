// ============================================================
// RECAUDACIÓN · BARCELONA — «POR FECHAS», DE X A Y (23/11/2026)
// ============================================================
// Camilo: «necesito que en Barcelona la recaudación se pueda elegir de fecha X a
// fecha Y, para elegir los montos correspondientes por rango de fechas». Una
// pestaña más de la recaudación de Barcelona, al lado de «Efectivo»: se eligen
// las fechas (o un atajo) y sale, por cada cuenta de BOLT, lo cobrado en
// efectivo, lo entregado, lo que se le dio y la diferencia de esos días. Es una
// consulta: no cierra ni cambia nada (recaudacion.repo.porFechas). Con el
// componente Listado (buscador, totales y Excel).
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const DATOS = JSON.parse(($('#datos-servidor') || {}).textContent || '{}');
  const BASE = DATOS.base || '/barcelona/recaudacion';
  const eur = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fecha = s => (s ? s.split('-').reverse().join('/') : '');
  let lista = null;
  
  // ── Las pestañas: «Efectivo» (lo de siempre) y «Por fechas» ──────────────
  function verPestana(p) {
    const fechas = p === 'fechas';
    document.querySelectorAll('.r-pestana').forEach(b => {
      const on = b.dataset.rPestana === p;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.className = 'r-pestana flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition ' +
        (on ? 'bg-telecab-gold text-telecab-dark shadow-gold'
          : 'bg-telecab-card border border-telecab-border text-telecab-muted hover:border-telecab-gold/40 hover:text-telecab-text');
    });
    $('#v-efectivo').classList.toggle('hidden', fechas);
    $('#v-fechas').classList.toggle('hidden', !fechas);
    const acc = $('#r-acciones');
    if (acc) acc.classList.toggle('hidden', fechas);   // cobrar, nómina, salida… son del efectivo
    try {
      const q = new URLSearchParams(location.search);
      if (fechas) q.set('vista', 'fechas'); else q.delete('vista');
      history.replaceState(history.state, '', location.pathname + (q.toString() ? `?${q}` : ''));
    } catch (_) { /* nada */ }
    if (fechas) { if (!lista) montar(); else lista.recargar(); }
  }

  // ── Los atajos ───────────────────────────────────────────────────────────
  function atajo(que) {
    const hoy = new Date();
    const lunes = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    let d, h;
    if (que === 'semana') { d = lunes(hoy); h = hoy; }
    else if (que === 'semana-pasada') { d = lunes(hoy); d.setDate(d.getDate() - 7); h = new Date(d); h.setDate(h.getDate() + 6); }
    else if (que === 'mes') { d = new Date(hoy.getFullYear(), hoy.getMonth(), 1); h = hoy; }
    else { d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); h = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
    $('#rf-desde').value = iso(d);
    $('#rf-hasta').value = iso(h);
  }

  // El Listado trae la URL y se queda con la respuesta entera en `extra` (totales y rango).
  const url = () => `${BASE}/api/fechas?desde=${encodeURIComponent($('#rf-desde').value)}&hasta=${encodeURIComponent($('#rf-hasta').value)}`;

  function montar() {
    lista = Listado.montar({
      raiz: '#rf-lista',
      titulo: 'Por cuenta de BOLT',
      clave: 'id',
      origen: url,
      vacio: 'Nadie cobró ni entregó efectivo esos días.',
      buscar: { texto: 'Buscar cuenta…', campos: ['nombre'] },
      kpis: (filas, r) => {
        const t = (r && r.total) || {};
        const rango = r && r.desde ? `del ${fecha(r.desde)} al ${fecha(r.hasta)}${r.recortado ? ' (recortado al corte o a hoy)' : ''}` : '';
        return [
          { etiqueta: 'Cobrado en efectivo (BOLT)', valor: eur(t.cobrado), pie: rango },
          { etiqueta: 'Entregado', valor: eur(t.entregado), tono: 'green' },
          { etiqueta: 'Le dimos (cambio, devoluciones)', valor: eur(t.dado) },
          { etiqueta: 'Diferencia', valor: eur(t.diferencia), tono: t.diferencia > 0 ? 'red' : 'green' },
        ];
      },
      columnas: [
        { titulo: 'Cuenta', campo: 'nombre', pinta: v => `<span class="font-semibold">${esc(v)}</span>` },
        { titulo: 'Viajes en efectivo', campo: 'viajes', clase: 'tabular-nums text-right' },
        { titulo: 'Cobrado (BOLT)', campo: 'cobrado', clase: 'tabular-nums text-right', pinta: v => esc(eur(v)) },
        { titulo: 'Entregado', campo: 'entregado', clase: 'tabular-nums text-right',
          pinta: (v, f) => `${esc(eur(v))}${f.entregas ? `<span class="block text-[11px] text-telecab-muted">${f.entregas} ${f.entregas === 1 ? 'vez' : 'veces'}</span>` : ''}` },
        { titulo: 'Le dimos', campo: 'dado', clase: 'tabular-nums text-right', pinta: v => (v ? esc(eur(v)) : '<span class="text-telecab-muted">—</span>') },
        { titulo: 'Diferencia', campo: 'diferencia', clase: 'tabular-nums text-right',
          pinta: v => `<span class="font-semibold ${v > 0 ? 'text-telecab-red' : 'text-telecab-green'}">${esc(eur(v))}</span>` },
      ],
    });
  }

  document.querySelectorAll('.r-pestana').forEach(b => b.addEventListener('click', () => verPestana(b.dataset.rPestana)));
  document.querySelectorAll('[data-rf-atajo]').forEach(b => b.addEventListener('click', () => { atajo(b.dataset.rfAtajo); if (lista) lista.recargar(); else montar(); }));
  $('#rf-ver').addEventListener('click', () => { if (lista) lista.recargar(); else montar(); });
  atajo('mes');
  verPestana(new URLSearchParams(location.search).get('vista') === 'fechas' ? 'fechas' : 'efectivo');
})();
