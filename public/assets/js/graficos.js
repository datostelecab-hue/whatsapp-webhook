// ============================================================
// GRÁFICOS — las piezas de un gráfico con la cara de la casa
// ============================================================
// Nacieron con los gráficos nuevos de Visibilidad (25/10/2026), hechos con la
// skill de visualización (dataviz), y viven aquí para que la siguiente pantalla
// con un gráfico no los vuelva a escribir de otra manera. Encima de Chart.js
// 4.4.1 y chartjs-plugin-datalabels 2.2.0, que carga cada vista ANTES que este
// fichero; la letra, el gris de los ejes y el globo por defecto los pone ya
// layout-gestion para todos los gráficos.
//
// LAS REGLAS QUE TRAEN DENTRO (las de la skill, en los tokens de la casa):
//   · Un acento (el oro, o el color del tema de cada uno) para lo que importa; el
//     gris para el contexto y la tinta para una media. Rojo y verde, solo estados.
//   · Un solo eje Y, desde cero, con la rejilla fina y lisa (nunca discontinua:
//     la raya discontinua es «objetivo» o «previsión»).
//   · El globo con todas las series del punto, el valor delante y una raya de su
//     color como clave (no una caja); la cruceta marca el día que se mira.
//   · La leyenda siempre (en HTML, con la forma de la marca), y una tabla gemela
//     de cada gráfico para quien no lo pueda ver.
//   · Sin animación para quien pide al sistema reducir el movimiento.
//
// CÓMO SE USA (ver views/visibilidad.ejs):
//   const G = Graficos, pal = G.paleta();
//   new Chart(lienzo, { …, options: { animation: G.ANIMA,
//     plugins: { cruceta: { color: pal.rejilla }, tooltip: G.globo(pal, { callbacks }) },
//     scales: { x: G.ejeX(pal), y: G.ejeEscalado(pal, valores) } }, plugins: [G.cruceta] });
//   G.leyenda('id', [{ tipo: 'barra'|'linea'|'discontinua'|'punto', color, texto, hueco }]);
//   backgroundColor: G.area('--tc-gold')   (el área que se apaga debajo de una línea)
//   caja.innerHTML = G.cifra({ etq, valor, unidad, sub, tono, flecha, ayuda });
//   G.tablaVista('id', columnas, filas);  G.botonesTabla();
// Apuntado en docs/como-se-trabaja/Componentes de la casa.md.

(function (global) {
  'use strict';

  // Color desde los tokens del tema, en el momento de pintar (claro, oscuro y el
  // acento de cada tema); los tokens van en canales RGB («227 178 60»).
  const cv = (n, a) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return a == null ? `rgb(${v})` : `rgb(${v} / ${a})`;
  };
  const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Sin movimiento para quien lo pidió al sistema.
  const QUIETO = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ANIMA = QUIETO ? false : { duration: 350 };

  // La letra, el gris de los ejes y el globo los pone layout-gestion para todos.
  // Las etiquetas de valor, solo donde un gráfico las pida: por defecto, apagadas.
  if (global.Chart && global.ChartDataLabels) {
    Chart.register(ChartDataLabels);
    Chart.defaults.set('plugins.datalabels', { display: false });
  }

  /**
   * LA PALETA DE LOS GRÁFICOS, de los tokens del tema, en el momento de pintar.
   * Un acento (el oro, o el color del tema de cada uno) para lo que importa, el
   * gris para el contexto y la tinta para la media. Comprobado con el validador
   * de la skill de visualización (25/10/2026): oro y gris se distinguen también
   * con daltonismo (ΔE 18 en oscuro, 22 en claro). En claro el gris del contexto
   * va más claro que el del texto: con el gris del texto, oro y gris quedaban a
   * ΔE 14, por debajo del mínimo de 15, y se confundían hasta sin daltonismo.
   */
  function paleta() {
    const t = document.documentElement.getAttribute('data-theme') || 'dark';
    const claro = t === 'light' || t.indexOf('claro-') === 0;
    return {
      claro,
      acento: cv('--tc-gold'),
      acentoHover: cv('--tc-gold-soft'),
      acentoSuave: cv('--tc-gold', claro ? 0.34 : 0.38),
      acentoLavado: cv('--tc-gold', 0.10),
      contexto: claro ? cv('--tc-muted', 0.55) : cv('--tc-muted', 0.9),
      tinta: cv('--tc-text', claro ? 0.85 : 0.9),
      apagado: cv('--tc-muted'),
      texto: cv('--tc-text'),
      rejilla: cv('--tc-border', claro ? 1 : 0.8),
      superficie: cv('--tc-card'),
      rojo: cv('--tc-red'),
      rojoLavado: cv('--tc-red', 0.07),
      verde: cv('--tc-green'),          // solo para un estado (por delante del ideal)
    };
  }

  // ── Piezas comunes de los gráficos ────────────────────────────────────────
  /**
   * LA CRUCETA: una raya fina en el día que se mira. Se apunta a una fecha, no a
   * una raya de dos píxeles: con el globo en modo «índice», lo que diga el globo
   * es lo que corta la raya.
   */
  const cruceta = {
    id: 'cruceta',
    afterDatasetsDraw(chart, args, opts) {
      const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!act.length) return;
      const x = act[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = opts.color || 'rgba(128,128,128,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      ctx.restore();
    },
  };

  /**
   * ETIQUETAS AL FINAL DE CADA LÍNEA, sin pisarse. Si dos finales caen casi a la
   * misma altura (la previsión de cierre y el total del mes anterior pueden ir a
   * cien horas), en vez de montarse se separan lo justo y una raya fina las une a
   * su punto. El texto va en tinta del tema; el color de la serie, en la rayita
   * de delante, que es la que dice de quién es.
   *   items: [{ ds, i, texto, color, fondo }]  (fondo: una píldora detrás, para
   *   la que va dentro del gráfico y no a la derecha)
   *   anchoMinimo: por debajo de ese ancho del gráfico solo se pintan las de
   *   dentro (las de fondo). Se mira al dibujar, no al crear el gráfico: así sale
   *   bien al volver de la tabla, al girar el móvil o al cambiar la ventana.
   */
  const etiquetasFinales = {
    id: 'etiquetasFinales',
    afterDatasetsDraw(chart, args, opts) {
      const estrecho = opts.anchoMinimo && chart.width < opts.anchoMinimo;
      const items = (opts.items || []).filter(it => !estrecho || it.fondo).map(it => {
        const meta = chart.getDatasetMeta(it.ds);
        const p = meta && !meta.hidden && meta.data[it.i];
        if (!p || p.skip || p.y == null || isNaN(p.y)) return null;
        return { ...it, x: p.x, y0: p.y, y: p.y };
      }).filter(Boolean);
      if (!items.length) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 10.5px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const { top, bottom } = chart.chartArea;
      // Las de fuera (a la derecha) se reparten para no pisarse; la de dentro va sola.
      const fuera = items.filter(i => !i.fondo).sort((a, b) => a.y - b.y);
      const GAP = 13;
      for (let k = 1; k < fuera.length; k++) if (fuera[k].y - fuera[k - 1].y < GAP) fuera[k].y = fuera[k - 1].y + GAP;
      const exceso = fuera.length ? fuera[fuera.length - 1].y - (bottom - 4) : 0;
      if (exceso > 0) fuera.forEach(i => { i.y -= exceso; });
      for (let k = fuera.length - 2; k >= 0; k--) if (fuera[k + 1].y - fuera[k].y < GAP) fuera[k].y = fuera[k + 1].y - GAP;
      fuera.forEach(i => { if (i.y < top + 4) i.y = top + 4; });
      fuera.forEach(i => {
        const x = i.x + 6;
        if (Math.abs(i.y - i.y0) > 2) {           // la raya que la une a su punto
          ctx.strokeStyle = opts.raya; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(i.x + 2, i.y0); ctx.lineTo(x, i.y); ctx.stroke();
        }
        ctx.strokeStyle = i.color; ctx.lineWidth = 2; ctx.setLineDash(i.discontinua ? [3, 2] : []);
        ctx.beginPath(); ctx.moveTo(x + 2, i.y); ctx.lineTo(x + 10, i.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = opts.tinta; ctx.textAlign = 'left';
        ctx.fillText(i.texto, x + 13, i.y);
      });
      items.filter(i => i.fondo).forEach(i => {
        const w = ctx.measureText(i.texto).width + 10, h = 17;
        let x = i.x - w / 2, y = i.y0 - 14 - h / 2;
        if (y < top) y = i.y0 + 8;
        x = Math.max(chart.chartArea.left, Math.min(x, chart.chartArea.right - w));
        ctx.fillStyle = i.fondo; ctx.strokeStyle = i.color; ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, 5); else ctx.rect(x, y, w, h);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = opts.tinta; ctx.textAlign = 'center';
        ctx.fillText(i.texto, x + w / 2, y + h / 2 + 0.5);
      });
      ctx.restore();
    },
  };

  /** El globo de la casa con claves de raya (no cajas) y el valor delante. */
  function globo(pal, extra) {
    return Object.assign({
      backgroundColor: cv('--tc-card'), borderColor: cv('--tc-border'), borderWidth: 1,
      titleColor: pal.texto, bodyColor: pal.texto, footerColor: pal.apagado,
      titleFont: { weight: '600', size: 12 }, bodyFont: { size: 12 }, footerFont: { size: 11, weight: '400' },
      padding: 10, cornerRadius: 8, boxPadding: 5, usePointStyle: true,
      filter: it => it.parsed && it.parsed.y != null,
      itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
    }, extra || {});
  }

  /**
   * EL ÁREA DEBAJO DE UNA LÍNEA: el color de la serie, que se apaga hacia el
   * suelo. Va como color «scriptable» de Chart.js porque el degradado necesita
   * el alto del gráfico, y ese solo se sabe al dibujar (y cambia con la ventana).
   */
  function area(token, arriba = 0.18, abajo = 0) {
    return c => {
      const a = c.chart.chartArea;
      if (!a) return cv(token, arriba / 2);
      const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, cv(token, arriba));
      g.addColorStop(1, cv(token, abajo));
      return g;
    };
  }

  /** Un eje Y de horas: desde cero, rejilla fina y lisa, sin raya de eje. */
  function ejeY(pal, extra) {
    return Object.assign({
      beginAtZero: true, grace: '6%',
      grid: { color: pal.rejilla, lineWidth: 1, drawTicks: false },
      border: { display: false },
      ticks: { color: pal.apagado, padding: 6, callback: v => nf0.format(v), maxTicksLimit: 6 },
    }, extra || {});
  }
  /**
   * La escala del eje: lo más alto más un 4 %, con un paso redondo (1, 2, 2,5 o 5
   * por su potencia de diez) que lo parta en `tramos` como mucho (siete, o menos
   * en un gráfico bajo). Sin ella, Chart.js subía de 31.200 a 40.000 y el cuarto
   * de arriba quedaba vacío.
   */
  function escala(v, tramos = 7) {
    if (!(v > 0)) return {};
    const tope = v * 1.04, base = Math.pow(10, Math.floor(Math.log10(tope)) - 1);
    const paso = [1, 2, 2.5, 5, 10, 20, 25, 50].map(k => k * base).find(p => Math.ceil(tope / p) <= tramos) || base * 100;
    return { max: Math.ceil(tope / paso) * paso, paso };
  }
  /**
   * Un eje Y con la escala de arriba para unos valores (los null no cuentan).
   * `opc.tramos`: cuántos tramos como mucho (por defecto siete).
   *
   * SIN `grace`. El 6 % de margen de ejeY se suma DESPUÉS del techo: con el techo
   * en 35.000 y pasos de 5.000, Chart.js veía 36.050, siete tramos ya no le
   * cabían, doblaba el paso a 10.000 y añadía el techo como raya suelta
   * (0 · 10.000 · 20.000 · 30.000 · 35.000). El margen ya lo pone escala().
   */
  function ejeEscalado(pal, valores, extra, opc = {}) {
    const e = escala((valores || []).reduce((m, x) => (x != null && x > m ? x : m), 0), opc.tramos);
    return ejeY(pal, Object.assign(e.max ? { max: e.max, grace: 0, ticks: { color: pal.apagado, padding: 6, stepSize: e.paso, autoSkip: false, callback: v => nf0.format(v) } } : {}, extra || {}));
  }
  const ejeX = (pal, extra) => Object.assign({
    grid: { display: false }, border: { color: pal.rejilla },
    ticks: { color: pal.apagado, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 },
  }, extra || {});

  /**
   * La leyenda en HTML: siempre está, con la misma forma que la marca (barra,
   * raya o punto). `hueco: true` en un punto es el anillo de lo que aún corre.
   */
  function leyenda(id, items) {
    const caja = document.getElementById(id);
    if (!caja) return;
    caja.innerHTML = '';
    items.filter(Boolean).forEach(it => {
      const s = document.createElement('span');
      s.className = 'inline-flex items-center gap-1.5';
      const m = document.createElement('span');
      m.setAttribute('aria-hidden', 'true');
      if (it.tipo === 'barra') { m.className = 'inline-block w-2.5 h-2.5 rounded-sm'; m.style.background = it.color; }
      else if (it.tipo === 'punto') { m.className = 'inline-block w-2.5 h-2.5 rounded-full'; m.style.border = `2px solid ${it.color}`; m.style.background = it.hueco ? 'transparent' : it.color; }
      else { m.className = 'inline-block w-4'; m.style.borderTop = `2px ${it.tipo === 'discontinua' ? 'dashed' : 'solid'} ${it.color}`; }
      const t = document.createElement('span');
      t.textContent = it.texto;
      s.append(m, t);
      caja.appendChild(s);
    });
  }

  /**
   * UNA CIFRA DE TARJETA (etiqueta, valor, unidad, debajo). `tono` tiñe solo el
   * valor de un cambio (verde si va a mejor, rojo si a peor) y siempre va con su
   * flecha: el color no es lo único que lo dice.
   */
  function cifra({ etq, valor, unidad, sub, tono, flecha, ayuda }) {
    const color = tono === 'bien' ? 'text-telecab-green' : tono === 'mal' ? 'text-telecab-red' : tono === 'aviso' ? 'text-telecab-warn' : 'text-telecab-text';
    const ico = flecha === 'arriba' ? '<i class="fa-solid fa-arrow-trend-up text-sm mr-1" aria-hidden="true"></i>'
      : flecha === 'abajo' ? '<i class="fa-solid fa-arrow-trend-down text-sm mr-1" aria-hidden="true"></i>' : '';
    return `<div class="rounded-xl border border-telecab-border bg-telecab-card2/40 px-3 py-2.5 min-w-0"${ayuda ? ` title="${esc(ayuda)}"` : ''}>
      <p class="text-xs text-telecab-muted leading-snug">${esc(etq)}</p>
      <p class="text-xl font-semibold leading-tight mt-0.5 ${color} whitespace-nowrap">${ico}${esc(valor)}${unidad ? ` <span class="text-xs font-normal text-telecab-muted">${esc(unidad)}</span>` : ''}</p>
      ${sub ? `<p class="text-[11px] text-telecab-muted mt-0.5 leading-snug">${esc(sub)}</p>` : ''}
    </div>`;
  }
  const flechaDe = x => (x > 0 ? 'arriba' : x < 0 ? 'abajo' : null);
  const tonoDe = x => (x > 0 ? 'bien' : x < 0 ? 'mal' : null);

  /** La tabla gemela de un gráfico: lo mismo, para leerlo sin el dibujo. */
  function tablaVista(id, columnas, filas) {
    const caja = document.getElementById(id);
    if (!caja) return;
    const th = columnas.map((c, k) => `<th scope="col" class="${k ? 'text-right' : 'text-left'} px-3 py-2 font-medium whitespace-nowrap">${esc(c)}</th>`).join('');
    const tr = filas.map(f => `<tr class="border-t border-telecab-border/50">${f.map((v, k) =>
      `<td class="${k ? 'text-right' : 'text-left'} px-3 py-1.5 whitespace-nowrap ${k ? 'text-telecab-muted' : 'text-telecab-text'}">${esc(v == null || v === '' ? '·' : v)}</td>`).join('')}</tr>`).join('');
    caja.innerHTML = `<table class="w-full text-xs tabular-nums"><thead class="sticky top-0 bg-telecab-card"><tr class="text-telecab-muted">${th}</tr></thead><tbody>${tr}</tbody></table>`;
  }

  /**
   * EL BOTÓN DE LA TABLA: cambia el dibujo por su tabla gemela y vuelta. Cada
   * `[data-tabla="x"]` maneja `#<prefijo>x-caja` (el dibujo), `#<prefijo>x-tabla`
   * y `#<prefijo>x-leyenda` (la leyenda es del dibujo: se va con él). Se recuerda
   * en el propio botón (aria-pressed), así que repintar respeta lo elegido.
   */
  function botonesTabla({ prefijo = 'g-', raiz = document } = {}) {
    raiz.querySelectorAll('[data-tabla]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.tabla;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('text-telecab-gold', on);
      b.classList.toggle('border-telecab-gold/50', on);
      const el = sufijo => document.getElementById(prefijo + id + '-' + sufijo);
      if (el('caja')) el('caja').classList.toggle('hidden', on);
      if (el('tabla')) el('tabla').classList.toggle('hidden', !on);
      if (el('leyenda')) el('leyenda').classList.toggle('hidden', on);
    }));
  }

  // Mientras llega lo nuevo, lo de antes se queda a media luz: sin saltos ni parpadeo.
  const atenuar = (id, si) => { const e = document.getElementById(id); if (e) e.style.opacity = si ? '0.45' : ''; };
  const errorEn = (id, msg) => {
    const e = document.getElementById(id);
    if (e) e.innerHTML = `<div class="col-span-full rounded-xl border border-telecab-warn/40 bg-telecab-warn/10 px-3 py-2 text-xs text-telecab-warn"><i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>${esc(msg)}</div>`;
  };

  global.Graficos = {
    cv, esc, QUIETO, ANIMA, paleta, cruceta, etiquetasFinales, globo, area, ejeX, ejeY, escala, ejeEscalado,
    leyenda, cifra, flechaDe, tonoDe, tablaVista, botonesTabla, atenuar, errorEn,
  };
})(window);
