// ============================================================
// VACACIONES POR MESES — quién se va y cuándo (pieza global, 17/11/2026)
// ============================================================
// La parrilla de «Vacaciones por meses» de la bitácora (12/11/2026), sacada a
// una pieza que usa también «La oficina» de /mis-vacaciones (Camilo: «ya hay
// algo parecido en bitácora llamado "Vacaciones por meses", recicla ese»).
//
// SEGUIDA, NO MES A MES (17/11/2026, Camilo: «que no se vea mes a mes sino que
// se pueda arrastrar como en la bitácora general para saber quién pisa a quién
// en los lapsos y no se partan por los meses»): una sola tira de días, de la
// primera fecha a la última vacación (como mucho 15 meses vista), que se
// arrastra con el ratón (o se desplaza a los lados). Cada vacación es una
// barra entera aunque cruce de mes. Una fila por persona.
//
// Dentro de cada barra: lo ya disfrutado, sólido; lo programado, rayado; lo
// que espera aprobación, en aviso con el borde discontinuo; y EN GRIS los días
// que no gastan (su libranza y los festivos). La fila «a la vez» dice cuánta
// gente falta cada día (lo aprobado y solo los días que gastan): si se pone
// caliente, ahí no cabe nadie más. Clases globales .tc-vpm-* de telecab.css.
//
//   VacacionesPorMeses.pintar(caja, {
//     hoy: 'AAAA-MM-DD',
//     periodos: [{ id, nombre, detalle, desde, hasta (null = sin fecha de vuelta),
//                  abierta, pendiente, libra: [1..7],
//                  clase, etiqueta }],   // clase: 'asuntos' | 'retribuido' (permisos de la
//                                        // oficina, 20/11/2026), con su color; sin clase, vacaciones
//     festivos: ['AAAA-MM-DD'],      // no gastan (opcional)
//     desde: 'AAAA-MM',              // el primer mes de la tira
//     sinVacaciones: [{ id, nombre, detalle }],   // opcional
//     titulo, icono, ayuda, botones: [{ html, titulo, alPulsar }],
//     alAbrir: id => …,
//   });
// Al volver a pintar en la misma caja, se queda donde estaba (no salta a hoy).
(function (global) {
  'use strict';
  const esc = s => global.Casa.esc(s);
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const W = 22;          // px de un día
  const NOMBRE = 200;    // px de la columna del nombre
  const DIA = 86400000;
  // Tailwind compila lo que está ESCRITO: las columnas de las cifras, enteras (no `md:grid-cols-${n}`).
  const COLUMNAS = { 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' };
  const ms = iso => Date.parse(iso + 'T00:00:00Z');
  const isoDe = t => new Date(t).toISOString().slice(0, 10);
  const dowDe = iso => { const w = new Date(ms(iso)).getUTCDay(); return w === 0 ? 7 : w; };
  const f = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const mesIdx = iso => { const [y, m] = iso.split('-').map(Number); return y * 12 + (m - 1); };
  const finDeMes = vm => isoDe(Date.UTC(Math.floor(vm / 12), vm % 12 + 1, 0));
  const suave = () => !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function pintar(caja, o) {
    const periodos = o.periodos || [];
    const festivos = new Set(o.festivos || []);
    const sin = o.sinVacaciones || null;
    const hoy = o.hoy;
    const hoyVm = mesIdx(hoy);

    // La tira: del primer mes a la última vacación, con 3 meses de margen para
    // poder asignar hacia delante y como mucho 15 meses vista: una fecha con el
    // año mal tecleado no convierte la tira en una alfombra hasta 2029.
    let finVm = hoyVm + 3;
    periodos.forEach(p => { finVm = Math.max(finVm, mesIdx(p.hasta || p.desde)); });
    finVm = Math.min(finVm, hoyVm + 15);
    const desdeMes = o.desde || hoy.slice(0, 7);
    const inicio = (mesIdx(desdeMes + '-01') <= hoyVm ? desdeMes : hoy.slice(0, 7)) + '-01';
    const fin = finDeMes(finVm);
    const N = Math.round((ms(fin) - ms(inicio)) / DIA) + 1;
    const idx = iso => Math.round((ms(iso) - ms(inicio)) / DIA);
    const dias = Array.from({ length: N }, (_, i) => isoDe(ms(inicio) + i * DIA));
    const descanso = iso => dowDe(iso) >= 6 || festivos.has(iso);

    // Cada vacación, recortada a la tira.
    const tramos = periodos.map(p => {
      const h = p.hasta || fin;
      const a = p.desde < inicio ? inicio : p.desde, b = h > fin ? fin : h;
      return a > b ? null : { ...p, a, b, libra: p.libra || [], corteIzq: p.desde < inicio, corteDer: !p.hasta || p.hasta > fin };
    }).filter(Boolean);
    const gasta = (t, iso) => !t.libra.includes(dowDe(iso)) && !festivos.has(iso);
    const tipo = (t, iso) => (!gasta(t, iso) ? 'libra' : t.pendiente ? 'pend' : iso > hoy ? 'prog' : 'on');
    const diasDe = t => { let n = 0; for (let d = t.a; d <= t.b; d = isoDe(ms(d) + DIA)) if (gasta(t, d)) n++; return n; };

    // Los permisos (con `clase`) se pintan y cuentan en «a la vez» (esa persona
    // falta), pero no en las cifras ni en los días de vacaciones de cada uno.
    const esVac = t => !t.clase;
    const hayPermisos = tramos.some(t => t.clase);
    const quien = hayPermisos ? 'fuera' : 'de vacaciones';

    // «A la vez»: lo aprobado, los días que gastan.
    const cuenta = new Array(N).fill(0);
    tramos.forEach(t => { if (!t.pendiente) for (let i = idx(t.a); i <= idx(t.b); i++) if (gasta(t, dias[i])) cuenta[i]++; });
    const maxC = Math.max(1, ...cuenta);

    // Una fila por persona: primero quien tiene algo de hoy en adelante (por
    // fecha de salida, para ver la escalera de quién pisa a quién) y después
    // quien solo tiene vacaciones pasadas, de la más reciente a la más vieja.
    const porPersona = new Map();
    tramos.forEach(t => {
      const k = String(t.id);
      if (!porPersona.has(k)) porPersona.set(k, { id: t.id, nombre: t.nombre, detalle: t.detalle || '', tramos: [] });
      porPersona.get(k).tramos.push(t);
    });
    const filas = [...porPersona.values()].map(r => {
      const vivos = r.tramos.filter(t => (t.hasta || '9999-12-31') >= hoy);
      return { ...r, dias: r.tramos.filter(esVac).reduce((n, t) => n + diasDe(t), 0),
        permisos: r.tramos.filter(t => !esVac(t)).reduce((n, t) => n + diasDe(t), 0),
        orden: vivos.length ? [0, vivos.map(t => t.desde).sort()[0]] : [1, r.tramos.map(t => t.b).sort().pop()] };
    }).sort((x, z) => x.orden[0] - z.orden[0]
      || (x.orden[0] === 0 ? x.orden[1].localeCompare(z.orden[1]) : z.orden[1].localeCompare(x.orden[1]))
      || x.nombre.localeCompare(z.nombre, 'es'));

    // Las cifras de arriba.
    const fueraHoy = new Set(tramos.filter(t => esVac(t) && !t.pendiente && t.a <= hoy && t.b >= hoy).map(t => String(t.id)));
    const programadas = new Set(periodos.filter(p => esVac(p) && !p.pendiente && p.desde > hoy).map(p => String(p.id)));
    const pendientes = periodos.filter(p => p.pendiente).length;
    let pico = 0, picoDia = null;
    for (let i = Math.max(0, idx(hoy)); i < N; i++) if (cuenta[i] > pico) { pico = cuenta[i]; picoDia = dias[i]; }
    const kpi = (txt, val, estilo = '', pie = '') => `<div class="bg-telecab-dark/50 rounded-xl px-3 py-2"><p class="text-[11px] text-telecab-muted">${txt}</p><p class="text-lg font-bold tabular-nums"${estilo}>${val}${pie ? ` <span class="text-xs font-normal text-telecab-muted">${pie}</span>` : ''}</p></div>`;
    const kpis = [
      kpi('De vacaciones hoy', fueraHoy.size),
      kpi('Con vacaciones programadas', programadas.size, ' style="color: rgb(var(--tc-vac))"'),
      kpi('Lo más lleno que viene', pico ? `${pico} a la vez` : '—', '', picoDia ? `el ${picoDia.slice(8, 10)}/${picoDia.slice(5, 7)}` : ''),
      pendientes ? kpi('Esperan aprobación', pendientes, ' style="color: rgb(var(--tc-warn))"') : '',
      sin ? kpi('Sin ni un día todavía', sin.length, ' style="color: rgb(var(--tc-warn))"') : '',
    ].filter(Boolean);

    const NOMBRE_T = { on: 'disfrutadas', prog: 'programadas', pend: 'esperando aprobación' };
    const barra = t => {
      // Los tramos de un mismo color, seguidos, dentro de la barra.
      const trozos = [];
      for (let d = t.a; d <= t.b; d = isoDe(ms(d) + DIA)) {
        const k = tipo(t, d);
        if (trozos.length && trozos[trozos.length - 1].k === k) trozos[trozos.length - 1].n++; else trozos.push({ k, n: 1 });
      }
      const n = diasDe(t);
      const conGris = trozos.some(x => x.k === 'libra');
      const estado = t.pendiente ? NOMBRE_T.pend
        : esVac(t) ? (t.b < hoy ? NOMBRE_T.on : t.a > hoy ? NOMBRE_T.prog : 'de vacaciones ahora')
          : (t.b < hoy ? 'ya pasado' : t.a > hoy ? 'programado' : 'ahora');
      const texto = `${t.nombre}: ${t.etiqueta ? t.etiqueta + ', ' : ''}${t.desde === t.hasta ? `el ${f(t.desde)}` : `del ${f(t.desde)} ${t.hasta ? `al ${f(t.hasta)}` : 'sin fecha de vuelta'}`} · ${n} ${n === 1 ? 'día' : 'días'}${conGris ? ' (sin contar libranzas ni festivos)' : ''} · ${estado}`;
      const clases = ['tc-vpm-barra', t.pendiente ? 'tc-vpm-barra--pend' : '', t.corteIzq ? 'tc-vpm-barra--corte-izq' : '', t.corteDer ? 'tc-vpm-barra--corte-der' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${clases}"${t.clase ? ` data-vpm-clase="${esc(t.clase)}"` : ''} data-abrir="${esc(t.id)}" style="left:${idx(t.a) * W + 1}px;width:${(idx(t.b) - idx(t.a) + 1) * W - 2}px" title="${esc(texto)}" aria-label="${esc(texto)}">${
        trozos.map(x => `<i class="tc-vpm-${x.k}" style="flex-grow:${x.n}"></i>`).join('')}</button>`;
    };

    const meses = [];
    for (let vm = mesIdx(inicio); vm <= finVm; vm++) {
      const a = isoDe(Date.UTC(Math.floor(vm / 12), vm % 12, 1));
      meses.push({ a, n: idx(finDeMes(vm)) - idx(a) + 1, nombre: `${MESES[vm % 12]} ${Math.floor(vm / 12)}` });
    }

    const html = `
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 class="text-lg font-semibold text-telecab-text flex items-center gap-2">
          <i class="fa-solid ${esc(o.icono || 'fa-umbrella-beach')}" style="color: rgb(var(--tc-vac))" aria-hidden="true"></i> ${esc(o.titulo || 'Vacaciones por meses')}</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="inline-flex rounded-lg border border-telecab-border overflow-hidden" role="group" aria-label="Moverse en el tiempo">
            <button type="button" data-vpm-ir="-30" class="px-2.5 py-2 text-xs text-telecab-muted hover:text-telecab-gold" aria-label="Un mes atrás"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
            <button type="button" data-vpm-ir="hoy" class="px-3 py-2 text-xs text-telecab-muted hover:text-telecab-gold border-x border-telecab-border">Ir a hoy</button>
            <button type="button" data-vpm-ir="30" class="px-2.5 py-2 text-xs text-telecab-muted hover:text-telecab-gold" aria-label="Un mes adelante"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
          </div>
          ${(o.botones || []).map((b, n) =>
            `<button type="button" data-vpm-boton="${n}" class="text-xs px-3 py-2 rounded-lg border border-telecab-border text-telecab-muted hover:text-telecab-gold hover:border-telecab-gold transition"${b.titulo ? ` title="${esc(b.titulo)}"` : ''}>${b.html}</button>`).join('')}
        </div>
      </div>
      ${o.ayuda ? `<p class="text-xs text-telecab-muted mb-3">${o.ayuda}</p>` : ''}
      <div class="grid grid-cols-2 ${COLUMNAS[kpis.length] || 'md:grid-cols-5'} gap-2 mb-3">${kpis.join('')}</div>
      ${filas.length ? `
      <div class="tc-vpm-marco" tabindex="0" aria-label="Las vacaciones día a día: arrastra o desplázate a los lados para moverte en el tiempo">
        <div class="tc-vpm-lienzo" style="width:${NOMBRE + N * W}px;--vpm-dia:${W}px;--vpm-nombre:${NOMBRE}px;--vpm-ancho:${N * W}px;--vpm-finde:${-(dowDe(inicio) - 1) * W}px">
          <div class="tc-vpm-capa" aria-hidden="true">
            ${dias.map((d, i) => (festivos.has(d) && dowDe(d) < 6 ? `<span class="tc-vpm-capa-festivo" style="left:${i * W}px"></span>` : '')).join('')}
            ${meses.slice(1).map(m => `<span class="tc-vpm-capa-mes" style="left:${idx(m.a) * W}px"></span>`).join('')}
            ${idx(hoy) >= 0 && idx(hoy) < N ? `<span class="tc-vpm-capa-hoy" style="left:${idx(hoy) * W}px"></span>` : ''}
          </div>
          <div class="tc-vpm-cabeza">
            <div class="tc-vpm-fila"><span class="tc-vpm-izq"></span><div class="tc-vpm-pista">${meses.map(m =>
              `<span class="tc-vpm-mes-et" style="left:${idx(m.a) * W}px;width:${m.n * W}px"><b>${m.nombre}</b></span>`).join('')}</div></div>
            <div class="tc-vpm-fila"><span class="tc-vpm-izq"></span><div class="tc-vpm-pista tc-vpm-dias">${dias.map(d =>
              `<span class="${d === hoy ? 'hoy' : descanso(d) ? 'descanso' : ''}"${festivos.has(d) ? ' title="Festivo"' : ''}>${Number(d.slice(8))}</span>`).join('')}</div></div>
            <div class="tc-vpm-fila"><span class="tc-vpm-izq text-[11px] text-telecab-muted">a la vez</span><div class="tc-vpm-pista tc-vpm-vez">${cuenta.map((c, i) =>
              `<b style="background: rgb(var(--tc-vac) / ${c ? (0.14 + 0.66 * c / maxC).toFixed(2) : 0.04})" title="${c} ${quien} el ${f(dias[i])}">${c || ''}</b>`).join('')}</div></div>
          </div>
          ${filas.map(r => `<div class="tc-vpm-fila tc-vpm-fila--persona">
            <span class="tc-vpm-izq"><button type="button" class="tc-vpm-nombre" data-abrir="${esc(r.id)}" title="${esc(r.nombre + (r.detalle ? ' · ' + r.detalle : '') + ' · ' + r.dias + ' día(s) de vacaciones en la parrilla' + (r.permisos ? ` y ${r.permisos} de permisos` : ''))}">
              <span class="truncate">${esc(r.nombre)}</span><span class="tc-vpm-nombre-dias">${r.dias}d</span></button></span>
            <div class="tc-vpm-pista tc-vpm-persona">${r.tramos.map(barra).join('')}</div></div>`).join('')}
        </div>
      </div>` : `<p class="text-sm text-telecab-muted py-6 text-center">Nadie tiene vacaciones de ${MESES[mesIdx(inicio) % 12]} de ${inicio.slice(0, 4)} en adelante.</p>`}
      <div class="tc-vpm-leyenda mt-3">
        <span><i class="tc-vpm-on"></i>Disfrutadas</span>
        <span><i class="tc-vpm-prog"></i>Programadas</span>
        ${pendientes ? '<span><i class="tc-vpm-pend tc-vpm-muestra-pend"></i>Esperan aprobación</span>' : ''}
        ${tramos.some(t => t.clase === 'asuntos') ? '<span><i class="tc-vpm-on" data-vpm-clase="asuntos"></i>Asuntos propios</span>' : ''}
        ${tramos.some(t => t.clase === 'retribuido') ? '<span><i class="tc-vpm-on" data-vpm-clase="retribuido"></i>Permisos retribuidos</span>' : ''}
        <span><i class="tc-vpm-libra"></i>No gasta (su libranza o festivo)</span>
        <span><i class="tc-vpm-muestra-hoy"></i>Hoy</span>
        <span>Arrastra la parrilla para moverte en el tiempo</span>
      </div>
      ${sin ? `<details class="mt-5"><summary class="cursor-pointer text-sm text-telecab-warn font-semibold">Sin vacaciones todavía (${sin.length}) — a quién le toca asignar</summary>
        <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-1.5 mt-2">${sin.map(c =>
          `<button type="button" data-abrir="${esc(c.id)}" class="text-left px-3 py-1.5 rounded-lg bg-telecab-dark/40 hover:bg-telecab-card2 transition">
            <span class="block text-sm text-telecab-text truncate">${esc(c.nombre)}</span>
            ${c.detalle ? `<span class="block text-[11px] text-telecab-muted">${esc(c.detalle)}</span>` : ''}</button>`).join('')}</div></details>` : ''}`;

    caja.innerHTML = html;
    if (caja._vpmCtl) caja._vpmCtl.abort();
    const ctl = caja._vpmCtl = new AbortController();
    const marco = caja.querySelector('.tc-vpm-marco');

    if (marco) {
      // Donde estaba, o hoy con diez días de antes a la vista.
      marco.scrollLeft = caja._vpmScroll != null ? caja._vpmScroll : Math.max(0, (idx(hoy) - 10) * W);
      marco.addEventListener('scroll', () => { caja._vpmScroll = marco.scrollLeft; }, { signal: ctl.signal });
      // Arrastrar con el ratón, como la bitácora general. Arrastrar no abre la ficha.
      let arr = null, movido = false;
      marco.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        arr = { x: e.clientX, y: e.clientY, sx: marco.scrollLeft, sy: marco.scrollTop };
        movido = false;
      }, { signal: ctl.signal });
      global.addEventListener('pointermove', e => {
        if (!arr) return;
        const dx = e.clientX - arr.x, dy = e.clientY - arr.y;
        if (!movido && Math.abs(dx) + Math.abs(dy) > 4) { movido = true; marco.classList.add('arrastrando'); }
        if (movido) { marco.scrollLeft = arr.sx - dx; marco.scrollTop = arr.sy - dy; }
      }, { signal: ctl.signal });
      global.addEventListener('pointerup', () => { arr = null; marco.classList.remove('arrastrando'); }, { signal: ctl.signal });
      marco.addEventListener('click', e => { if (movido) { e.stopPropagation(); e.preventDefault(); movido = false; } }, { capture: true, signal: ctl.signal });
    }

    caja.querySelectorAll('[data-vpm-ir]').forEach(b => b.addEventListener('click', () => {
      if (!marco) return;
      const v = b.dataset.vpmIr;
      const left = v === 'hoy' ? Math.max(0, (idx(hoy) - 10) * W) : marco.scrollLeft + Number(v) * W;
      marco.scrollTo({ left, behavior: suave() ? 'smooth' : 'auto' });
    }));
    caja.querySelectorAll('[data-vpm-boton]').forEach(b => b.addEventListener('click', () => o.botones[Number(b.dataset.vpmBoton)].alPulsar()));
    if (o.alAbrir) caja.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => o.alAbrir(b.dataset.abrir)));
  }

  global.VacacionesPorMeses = { pintar, mesIdx };
})(window);
