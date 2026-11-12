// ============================================================
// MANTENIMIENTOS DEL COCHE — lo que se le ha hecho, uno por uno
// ============================================================
// Camilo, 12/11/2026: «en la ficha del vehículo listar sus mantenimientos, uno
// por uno, como por ejemplo […] el 0348MMZ digamos que tuvo un cambio de aceite
// el día XXXX, que se liste por debajo del historial de situaciones».
//
// Cada mantenimiento es una tarjeta: el día y los km arriba, lo que se hizo en
// una línea («Aceite motor 5W30, filtro de aire…»), sus categorías, el taller y
// el coste, y las piezas de la factura desplegables (un <details>: se abre con
// el teclado y no necesita JavaScript). Sale igual en la ficha del vehículo y en
// la del taller, y por eso vive aquí y no en cada pantalla.
//
// Uso:
//   MantenimientosCoche.pintar(hueco, lista, { anular: m => …, vacio: '…' })
// `lista` es lo que da taller.repo.deCoche (cada uno con sus `lineas`).
// Con `anular`, cada uno no anulado lleva su botón.

(function (global) {
  'use strict';
  const esc = global.Casa.esc;

  const fecha = f => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : 'Sin fecha');
  const km = v => (v == null ? null : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' km');
  const euros = v => (v == null ? '' : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
  const cant = v => (v == null ? '' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 }));

  const ORIGEN = {
    factura:    { texto: 'Factura',    icono: 'fa-file-invoice' },
    inventario: { texto: 'Inventario', icono: 'fa-boxes-stacked' },
    manual:     { texto: 'A mano',     icono: 'fa-pen' },
  };

  /** El icono que abre el PDF de la factura (lo sirve el ERP, desde Drive). */
  const enlacePdf = m => `<a href="/facturas/api/factura/${encodeURIComponent(m.facturaId)}/pdf" target="_blank" rel="noopener"
      class="inline-flex items-center gap-1 text-telecab-gold hover:underline" title="Ver la factura en PDF"
      aria-label="Ver la factura ${esc(m.facturaNumero || '')} en PDF"><i class="fa-solid fa-file-pdf" aria-hidden="true"></i>PDF</a>`;

  /** De dónde sale: «Discom · Factura 2026/000566», «Pieza del inventario», «Apuntado por Óscar». */
  function procedencia(m) {
    const partes = [];
    if (m.taller) partes.push(esc(m.taller));
    if (m.origen === 'factura' && m.facturaNumero) {
      const num = 'Factura ' + esc(m.facturaNumero);
      partes.push(m.facturaId
        ? `<a href="/facturas#${encodeURIComponent(m.facturaId)}" class="underline underline-offset-2 decoration-telecab-border hover:text-telecab-gold">${num}</a>` +
          // El PDF de la factura, sin ir a Facturas (12/11/2026).
          (m.facturaEnlace ? ` ${enlacePdf(m)}` : '')
        : num);
    } else if (m.origen === 'inventario') {
      partes.push('Pieza del inventario');
    }
    if (m.referencia && m.origen !== 'inventario') partes.push(esc(m.referencia));
    if (m.usuario && m.origen !== 'factura') partes.push('lo apuntó ' + esc(m.usuario));
    return partes.join(' · ');
  }

  function tablaPiezas(lineas) {
    const conImporte = lineas.some(l => l.importe != null);
    return `
      <div class="overflow-x-auto mt-2">
        <table class="w-full text-xs">
          <thead class="text-telecab-muted">
            <tr>
              <th class="text-left font-medium py-1 pr-3">Descripción</th>
              <th class="text-left font-medium py-1 pr-3">Código</th>
              <th class="text-right font-medium py-1 pr-3">Cant.</th>
              ${conImporte ? '<th class="text-right font-medium py-1">Importe</th>' : ''}
            </tr>
          </thead>
          <tbody class="divide-y divide-telecab-border/60">
            ${lineas.map(l => `
              <tr class="${l.categoria === 'nota' ? 'text-telecab-muted' : 'text-telecab-text'}">
                <td class="py-1 pr-3">${esc(l.descripcion)}</td>
                <td class="py-1 pr-3 text-telecab-muted whitespace-nowrap">${esc(l.codigo || '')}</td>
                <td class="py-1 pr-3 text-right tabular-nums whitespace-nowrap">${cant(l.cantidad)}</td>
                ${conImporte ? `<td class="py-1 text-right tabular-nums whitespace-nowrap">${
                  l.importe == null ? '' : euros(l.importe)}${l.dto ? ` <span class="text-telecab-muted">(−${cant(l.dto)} %)</span>` : ''}</td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function tarjeta(m, { anular } = {}) {
    const o = ORIGEN[m.origen] || ORIGEN.manual;
    const cats = (m.categoriasEtiqueta && m.categoriasEtiqueta.length) ? m.categoriasEtiqueta : [m.tipoEtiqueta];
    const lineas = m.lineas || [];
    const piezas = lineas.filter(l => l.categoria !== 'nota');
    return `
      <article class="rounded-xl border border-telecab-border bg-telecab-card px-4 py-3 ${m.anuladoAt ? 'opacity-60' : ''}"
               data-mant="${m.id}">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p class="text-sm font-semibold text-telecab-text tabular-nums">
            ${esc(fecha(m.fecha))}${km(m.km) ? `<span class="text-telecab-muted font-normal"> · ${esc(km(m.km))}</span>` : ''}
          </p>
          ${m.coste != null ? `<p class="text-sm font-semibold tabular-nums text-telecab-text" title="Sin IVA">${esc(euros(m.coste))}</p>` : ''}
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          ${cats.map(c => `<span class="px-2 py-0.5 rounded-md bg-telecab-card2 border border-telecab-border text-[11px] text-telecab-text">${esc(c)}</span>`).join('')}
        </div>
        ${m.descripcion ? `<p class="mt-1.5 text-sm text-telecab-text">${esc(m.descripcion)}</p>` : ''}
        <p class="mt-1 text-[11px] text-telecab-muted flex items-center gap-1.5">
          <i class="fa-solid ${o.icono}" aria-hidden="true"></i><span>${procedencia(m) || esc(o.texto)}</span>
        </p>
        ${lineas.length ? `
          <details class="mt-1.5 group">
            <summary class="cursor-pointer select-none text-[11px] font-semibold text-telecab-muted hover:text-telecab-text list-none flex items-center gap-1">
              <i class="fa-solid fa-chevron-right text-[9px] transition-transform group-open:rotate-90" aria-hidden="true"></i>
              ${piezas.length} ${piezas.length === 1 ? 'línea' : 'líneas'} de la factura
            </summary>
            ${tablaPiezas(lineas)}
          </details>` : ''}
        ${m.anuladoAt
          ? `<p class="mt-1.5 text-[11px] text-telecab-red">Anulado${m.anuladoPor ? ' por ' + esc(m.anuladoPor) : ''}: ${esc(m.anuladoMotivo || '')}</p>`
          : (anular ? `<button type="button" data-anular="${m.id}" class="mt-1.5 text-[11px] text-telecab-red underline underline-offset-2">Anular</button>` : '')}
      </article>`;
  }

  /** Pinta la lista en `hueco`. Devuelve el hueco. */
  function pintar(hueco, lista, opciones = {}) {
    const l = lista || [];
    if (!l.length) {
      hueco.innerHTML = `<p class="text-sm text-telecab-muted">${esc(opciones.vacio || 'Ningún mantenimiento todavía.')}</p>`;
      return hueco;
    }
    hueco.innerHTML = `<div class="space-y-2.5">${l.map(m => tarjeta(m, opciones)).join('')}</div>`;
    if (opciones.anular) {
      hueco.querySelectorAll('[data-anular]').forEach(b => b.addEventListener('click', () => {
        const m = l.find(x => String(x.id) === b.dataset.anular);
        if (m) opciones.anular(m);
      }));
    }
    return hueco;
  }

  global.MantenimientosCoche = { pintar };
})(window);
