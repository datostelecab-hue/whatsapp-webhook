// La pestaña «Ruedas» de Mantenimientos (db/265, 18/11/2026).
//
// Camilo: «un nuevo submódulo como el de mantenimientos, pero que diga
// "Ruedas", que cada 25K de KM se pase y avise, los KM de los últimos
// mantenimientos deben de sacarse de cambio de ruedas, hay unos de pinchazos en
// las facturas por los que esos no cuentan». Cada coche con su último cambio de
// ruedas (de las facturas, sin los pinchazos, o apuntado a mano), los km que
// lleva desde él y su semáforo. Al pulsarlo, su historia de ruedas en el Panel
// y, a quien puede apuntar, «Apuntar un cambio». Las cuentas son del servidor
// (modules/Vehiculos/ruedas.service.js); aquí solo se pintan.
//
// LAS REVISIONES (db/275, 23/11/2026, Camilo: «que se pueda inputar también la
// última revisión, no mantenimiento sino revisión con su respectiva
// observación»): el día, los km si se saben y lo visto. No son un cambio: no
// mueven los km. Columna «Última revisión», su historia en el Panel y
// «Apuntar una revisión»; una mal apuntada se anula con su motivo.
// Desde db/276 (23/11/2026): la revisión da 15.000 km más (el cambio toca a los
// 45.000) y hay UNA por tramo (desde el último cambio).
//
// La monta taller.js al abrir la pestaña: TallerRuedas.montar({ base, puede }).
(function (global) {
  'use strict';
  const esc = Casa.esc;
  // Con el punto de los miles también en las de cuatro cifras (es-ES no agrupa 2400).
  const miles = v => (v == null ? '—' : String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
  const dia = f => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
  const ESTADO = {
    toca:     ['tc-pastilla--rojo', 'Toca cambiar', 'bg-telecab-red'],
    pronto:   ['tc-pastilla--aviso', 'A punto', 'bg-telecab-warn'],
    ok:       ['tc-pastilla--verde', 'Al día', 'bg-telecab-green'],
    sin_dato: ['', 'Sin dato', 'bg-telecab-border'],
    revisar:  ['tc-pastilla--aviso', 'Dato imposible', 'bg-telecab-warn'],
  };
  const pastilla = e => `<span class="tc-pastilla ${ESTADO[e] ? ESTADO[e][0] : ''}">${esc(ESTADO[e] ? ESTADO[e][1] : e)}</span>`;
  const MOTIVO = {
    sin_cambio: 'Sin cambio de ruedas en las facturas: apúntalo a mano',
    cambio_sin_km: 'El último cambio no trae los km: apúntalo a mano con ellos',
    sin_odometro: 'Sin odómetro: Mapon no da nada de este coche',
  };
  const deDonde = c => [dia(c.fecha), c.km == null ? 'sin km' : `${miles(c.km)} km`, c.taller,
    c.origen === 'manual' ? 'apuntado a mano' : c.referencia].filter(Boolean).join(' · ');

  let lst = null;
  // Cada cuántos km (lo dice el servidor: TALLER_KM_RUEDAS, 30.000 desde el 18/11).
  let intervalo = 30000;
  let prorroga = 15000;
  let cfg = { base: '/taller', puede: false };

  function montar(opciones) {
    cfg = { ...cfg, ...(opciones || {}) };
    if (lst) { lst.recargar(); return; }
    lst = global.Listado.montar({
      raiz: '#r-lista',
      titulo: 'Ruedas',
      icono: 'fa-circle-dot',
      clave: 'id',
      url: false,
      origen: `${cfg.base}/api/ruedas`,
      vacio: 'No hay coches.',
      buscar: { texto: 'Matrícula, modelo o zona…', campos: [f => `${f.matricula} ${String(f.matricula).replace(/^(\d{4})/, '$1 ')}`, 'vehiculo', 'zona'] },
      subtitulo: (v, todas, extra) => `Cada ${miles((extra && extra.intervalo) || intervalo)} km, un cambio de ruedas; con una revisión en el tramo, a los ${miles(((extra && extra.intervalo) || intervalo) + ((extra && extra.prorroga) || prorroga))}. Cuentan los de las facturas (los pinchazos no) y los apuntados a mano.`,
      kpis: (filas, extra) => {
        if (extra && extra.intervalo) intervalo = extra.intervalo;
        if (extra && extra.prorroga) prorroga = extra.prorroga;
        return [
        { etiqueta: 'Toca cambiar', valor: filas.filter(f => f.estado === 'toca').length, tono: filas.some(f => f.estado === 'toca') ? 'red' : 'muted',
          pie: `pasados de ${miles(intervalo)} km, o de ${miles(intervalo + prorroga)} con revisión`, filtro: { id: 'estado', valor: 'toca' } },
        { etiqueta: 'A punto', valor: filas.filter(f => f.estado === 'pronto').length, tono: 'warn',
          pie: 'desde el 85 % o a 15 días', filtro: { id: 'estado', valor: 'pronto' } },
        { etiqueta: 'Al día', valor: filas.filter(f => f.estado === 'ok').length, tono: 'green', filtro: { id: 'estado', valor: 'ok' } },
        { etiqueta: 'Sin dato', valor: filas.filter(f => f.estado === 'sin_dato').length, tono: 'muted',
          pie: 'sin cambio apuntado, o sin km', filtro: { id: 'estado', valor: 'sin_dato' } },
      ]; },
      filtros: [{
        id: 'estado', etiqueta: 'Estado', textoTodos: 'Todos',
        opciones: filas => Object.keys(ESTADO).map(e => ({ valor: e, texto: ESTADO[e][1], cuenta: filas.filter(f => f.estado === e).length }))
          .filter(o => o.cuenta),
        pasa: (f, v) => f.estado === v,
      }],
      claseFila: f => (f.estado === 'toca' ? 'bg-telecab-red/5' : ''),
      columnas: [
        { titulo: 'Coche', campo: 'matricula', pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>` +
          `<span class="block text-[11px] text-telecab-muted">${esc([f.vehiculo, f.zona].filter(Boolean).join(' · '))}</span>` },
        // Con `valor` (el texto del Excel), `pinta` recibe ese texto: lo de la fila se lee de `f`.
        { titulo: 'Estado', campo: 'estado', pinta: (v, f) => pastilla(f.estado), valor: f => (ESTADO[f.estado] || [])[1] || f.estado },
        { titulo: 'Último cambio', campo: 'cambio', valor: f => (f.cambio ? deDonde(f.cambio) : ''),
          pinta: (v, f) => (f.cambio ? `<span class="tabular-nums">${esc(deDonde(f.cambio))}</span>${f.cambio.ruedas ? `<span class="block text-[11px] text-telecab-muted">${f.cambio.ruedas} ruedas</span>` : ''}` +
              (f.revisionTramo ? `<span class="block text-[11px] text-telecab-gold">Revisada: hasta ${miles(f.intervalo)} km</span>` : '')
            : `<span class="text-xs text-telecab-muted">${esc(MOTIVO[f.motivo] || '—')}</span>`) },
        { titulo: 'Última revisión', campo: 'revision',
          valor: f => (f.revision ? `${dia(f.revision.fecha)}${f.revision.km != null ? ` · ${miles(f.revision.km)} km` : ''} · ${f.revision.observacion}` : ''),
          pinta: (v, f) => (f.revision
            ? `<span class="tabular-nums">${esc(dia(f.revision.fecha))}${f.revision.km != null ? ` · ${esc(miles(f.revision.km))} km` : ''}</span>` +
              `<span class="block max-w-[16rem] truncate text-[11px] text-telecab-muted" title="${esc(f.revision.observacion)}">${esc(f.revision.observacion)}</span>`
            : '<span class="text-xs text-telecab-muted">Sin revisión</span>') },
        { titulo: 'Odómetro', campo: 'odometro', clase: 'text-right tabular-nums', pinta: v => (v == null ? '—' : `${miles(v)} km`) },
        { titulo: 'Desde el cambio', campo: 'desde', clase: 'text-right tabular-nums',
          pinta: (v, f) => (v == null ? '—' : `<b class="${f.estado === 'toca' ? 'text-telecab-red' : ''}">${miles(v)} km</b>`) },
        { titulo: 'Avance', campo: 'porcentaje', exportar: false,
          pinta: (v, f) => (v == null ? '<span class="text-xs text-telecab-muted">—</span>'
            : `<div class="h-2 w-28 rounded-full bg-telecab-card2 overflow-hidden"><div class="h-full ${(ESTADO[f.estado] || [])[2] || ''}" style="width:${Math.min(100, v)}%"></div></div>` +
              `<span class="text-[10px] text-telecab-muted">${v} % de ${miles(f.intervalo)}</span>`) },
        { titulo: 'Le quedan', campo: 'restan', clase: 'text-right tabular-nums',
          pinta: (v, f) => (f.estado === 'toca' ? `<span class="text-telecab-red font-semibold">pasado ${miles(-v)} km</span>`
            : v == null ? '—' : `${miles(v)} km${f.dias != null ? ` <span class="text-telecab-muted">· ${f.dias} d</span>` : ''}`) },
      ],
      acciones: cfg.puede ? [
        { texto: 'Apuntar una revisión', icono: 'fa-clipboard-check', onClick: l => revisar(null, l.filas) },
        { texto: 'Apuntar un cambio', icono: 'fa-plus', onClick: l => apuntar(null, l.filas) },
      ] : [],
      alAbrir: f => abrir(f),
    });
  }

  // ── La historia de ruedas de un coche, en el Panel ─────────────────────────
  function abrir(f) {
    const filaCambio = (c, conRuedas) => `<tr class="border-t border-telecab-border/60">
        <td class="py-2 pr-3 whitespace-nowrap tabular-nums">${dia(c.fecha)}</td>
        <td class="py-2 px-3 text-right tabular-nums">${c.km == null ? '—' : `${miles(c.km)} km`}</td>
        <td class="py-2 px-3">${esc(c.taller || '')}${c.origen === 'manual' ? ' <span class="text-[11px] text-telecab-muted">· a mano</span>' : ''}</td>
        ${conRuedas ? `<td class="py-2 pl-3 text-right tabular-nums">${c.ruedas || '—'}</td>` : ''}</tr>`;
    const tabla = (lista, conRuedas) => `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="text-xs text-telecab-muted"><tr><th class="text-left font-medium pb-1 pr-3">Día</th>
          <th class="text-right font-medium pb-1 px-3">Km</th><th class="text-left font-medium pb-1 px-3">Dónde</th>
          ${conRuedas ? '<th class="text-right font-medium pb-1 pl-3">Ruedas</th>' : ''}</tr></thead>
        <tbody>${lista.map(c => filaCambio(c, conRuedas)).join('')}</tbody></table></div>`;
    const cifra = (txt, valor, nota) => `<div class="tc-kpi"><p class="tc-kpi-etiqueta">${esc(txt)}</p><p class="tc-kpi-valor">${valor}</p>${nota ? `<p class="tc-kpi-pie">${esc(nota)}</p>` : ''}</div>`;
    const p = global.Panel.abrir({
      titulo: f.matricula,
      subtitulo: [f.vehiculo, f.zona].filter(Boolean).join(' · '),
      html: `<div class="flex items-center gap-2 mb-3">${pastilla(f.estado)}${f.motivo ? `<span class="text-xs text-telecab-muted">${esc(MOTIVO[f.motivo] || '')}</span>` : ''}</div>
        <div class="grid grid-cols-2 gap-2">
          ${cifra('Odómetro', f.odometro == null ? '—' : `${miles(f.odometro)} km`, f.kmDia ? `${String(f.kmDia).replace('.', ',')} km al día` : '')}
          ${cifra('Desde el último cambio', f.desde == null ? '—' : `${miles(f.desde)} km`,
            f.estado === 'toca' ? `pasado ${miles(-f.restan)} km` : f.restan != null ? `le quedan ${miles(f.restan)} km${f.dias != null ? ` (unos ${f.dias} días)` : ''}` : '')}
        </div>
        ${cfg.puede ? `<div class="flex flex-wrap justify-end gap-2 mt-3">
          ${f.revisionTramo ? '' : `<button type="button" class="tc-boton tc-boton--chico" data-revisar>
            <i class="fa-solid fa-clipboard-check" aria-hidden="true"></i>Apuntar una revisión</button>`}
          <button type="button" class="tc-boton tc-boton--chico" data-apuntar>
            <i class="fa-solid fa-plus" aria-hidden="true"></i>Apuntar un cambio de ruedas</button></div>` : ''}
        <section class="tc-panel-seccion"><h4>Revisiones <span class="font-normal text-telecab-muted">· una por tramo: da ${miles(prorroga)} km más</span></h4>
          ${f.revisionTramo ? `<p class="text-xs text-telecab-muted mb-2">Ya revisada en este tramo (${esc(dia(f.revisionTramo.fecha))}): el cambio toca a los ${esc(miles(f.intervalo))} km. La próxima revisión, después de cambiar las ruedas.</p>` : ''}
          ${f.revisiones && f.revisiones.length ? `<ul class="divide-y divide-telecab-border/60">${f.revisiones.map(r => `<li class="py-2.5">
              <div class="flex items-baseline gap-2">
                <b class="text-sm tabular-nums">${esc(dia(r.fecha))}</b>
                ${r.km != null ? `<span class="text-xs text-telecab-muted tabular-nums">${esc(miles(r.km))} km</span>` : ''}
                <span class="flex-1"></span>
                ${cfg.puede ? `<button type="button" class="text-xs text-telecab-muted hover:text-telecab-red" data-anular-revision="${r.id}">Anular</button>` : ''}
              </div>
              <p class="text-sm mt-0.5 whitespace-pre-line">${esc(r.observacion)}</p>
              ${r.por ? `<p class="text-[11px] text-telecab-muted mt-0.5">${esc(r.por)}</p>` : ''}
            </li>`).join('')}</ul>` : '<p class="text-sm text-telecab-muted">Ninguna apuntada.</p>'}</section>
        <section class="tc-panel-seccion"><h4>Cambios de ruedas</h4>
          ${f.cambios.length ? tabla(f.cambios, true) : '<p class="text-sm text-telecab-muted">Ninguno en las facturas ni apuntado a mano.</p>'}</section>
        <section class="tc-panel-seccion"><h4>Pinchazos <span class="font-normal text-telecab-muted">· no cuentan como cambio</span></h4>
          ${f.pinchazos.length ? tabla(f.pinchazos, false) : '<p class="text-sm text-telecab-muted">Ninguno.</p>'}</section>`,
    });
    const b = p.cuerpo.querySelector('[data-apuntar]');
    if (b) b.addEventListener('click', () => apuntar(f));
    const rv = p.cuerpo.querySelector('[data-revisar]');
    if (rv) rv.addEventListener('click', () => revisar(f));
    p.cuerpo.addEventListener('click', ev => {
      const a = ev.target.closest('[data-anular-revision]');
      if (a) anularRevision(Number(a.dataset.anularRevision));
    });
  }

  // ── Apuntar una revisión (db/275): lo visto, sin tocar los km del cambio ──
  async function revisar(fila, filas) {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    const campos = [];
    if (!fila) {
      campos.push({ id: 'coche', etiqueta: 'Coche', tipo: 'lista', obligatorio: true,
        opciones: (filas || []).filter(f => !f.revisionTramo)
          .map(f => ({ valor: String(f.id), texto: `${f.matricula}${f.vehiculo ? ` · ${f.vehiculo}` : ''}` })) });
    }
    campos.push(
      { id: 'fecha', etiqueta: 'Día de la revisión', tipo: 'fecha', obligatorio: true, valor: dia(hoy) },
      { id: 'km', etiqueta: 'Km del coche ese día', marcador: fila && fila.odometro ? `opcional · hoy marca ${miles(fila.odometro)}` : 'opcional' },
      { id: 'observacion', etiqueta: 'Observación', tipo: 'texto-largo', obligatorio: true, max: 1000,
        marcador: 'Cómo están: dibujo, desgaste, presión, lo que haya que vigilar…' },
    );
    const v = await global.Dialogo.formulario(fila ? `Revisión de ruedas de ${fila.matricula}` : 'Apuntar una revisión de ruedas', campos,
      { textoBoton: 'Apuntar', nota: `La revisión da ${miles(prorroga)} km más: el cambio tocará a los ${miles(intervalo + prorroga)} km desde el último. Solo una por tramo, hasta el próximo cambio.` });
    if (!v) return;
    const r = await global.Api.post(`${cfg.base}/api/ruedas/revision`, {
      vehiculoId: fila ? fila.id : Number(v.coche), fecha: v.fecha, km: v.km || '', observacion: v.observacion || '',
    }, { aviso: 'No se ha podido apuntar' });
    if (!r) return;
    global.Dialogo.hecho('Revisión apuntada');
    const abierto = global.Panel.abierto();
    if (abierto) abierto.cerrar();
    if (lst) lst.recargar();
  }

  async function anularRevision(id) {
    const v = await global.Dialogo.formulario('Anular la revisión', [
      { id: 'motivo', etiqueta: 'Por qué se anula', tipo: 'texto', obligatorio: true, max: 500, marcador: 'p. ej. era de otro coche' },
    ], { textoBoton: 'Anular', nota: 'No se borra: queda guardada como anulada, con el motivo.' });
    if (!v) return;
    const r = await global.Api.post(`${cfg.base}/api/ruedas/revision/${id}/anular`, { motivo: v.motivo }, { aviso: 'No se ha podido anular' });
    if (!r) return;
    global.Dialogo.hecho('Revisión anulada');
    const abierto = global.Panel.abierto();
    if (abierto) abierto.cerrar();
    if (lst) lst.recargar();
  }

  // ── Apuntar un cambio a mano ───────────────────────────────────────────────
  async function apuntar(fila, filas) {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    const campos = [];
    if (!fila) {
      campos.push({ id: 'coche', etiqueta: 'Coche', tipo: 'lista', obligatorio: true,
        opciones: (filas || []).map(f => ({ valor: String(f.id), texto: `${f.matricula}${f.vehiculo ? ` · ${f.vehiculo}` : ''}` })) });
    }
    campos.push(
      { id: 'fecha', etiqueta: 'Día del cambio', tipo: 'fecha', obligatorio: true, valor: dia(hoy) },
      { id: 'km', etiqueta: 'Km del coche ese día', obligatorio: true, marcador: fila && fila.odometro ? `hoy marca ${miles(fila.odometro)}` : 'p. ej. 84.500' },
      { id: 'ruedas', etiqueta: 'Ruedas cambiadas', tipo: 'lista', obligatorio: true, valor: '4',
        opciones: [{ valor: '2', texto: '2 ruedas' }, { valor: '4', texto: '4 ruedas' }] },
      { id: 'taller', etiqueta: 'Taller', marcador: 'iPark, Discom…' },
      { id: 'nota', etiqueta: 'Nota', tipo: 'texto-largo', max: 500 },
    );
    const v = await global.Dialogo.formulario(fila ? `Cambio de ruedas de ${fila.matricula}` : 'Apuntar un cambio de ruedas', campos,
      { textoBoton: 'Apuntar', nota: `Desde estos km se cuentan los ${miles((fila && fila.intervalo) || intervalo)} del próximo cambio. Los pinchazos no se apuntan aquí.` });
    if (!v) return;
    const km = Number(String(v.km || '').replace(/[.\s]/g, '').replace(',', '.'));
    const r = await global.Api.post(`${cfg.base}/api/ruedas/apuntar`, {
      vehiculoId: fila ? fila.id : Number(v.coche), fecha: v.fecha, km: Number.isFinite(km) ? km : v.km, ruedas: Number(v.ruedas) || null,
      taller: v.taller || '', nota: v.nota || '',
    }, { aviso: 'No se ha podido apuntar' });
    if (!r) return;
    global.Dialogo.hecho('Cambio de ruedas apuntado');
    const abierto = global.Panel.abierto();
    if (abierto) abierto.cerrar();
    if (lst) lst.recargar();
  }

  global.TallerRuedas = { montar };
})(window);
