// ============================================================
// VACACIONES POR MESES — quién se va y cuándo (pieza global, 17/11/2026)
// ============================================================
// La parrilla de «Vacaciones por meses» de la bitácora (12/11/2026), sacada a
// una pieza para que la use también «La oficina» de /mis-vacaciones (Camilo:
// «ya hay algo parecido en bitácora llamado "Vacaciones por meses", recicla
// ese»). Una parrilla por mes: una fila por persona de vacaciones, una celda por
// día. Lo ya disfrutado va sólido; lo programado (aún no llega), rayado; lo que
// espera aprobación, con el borde discontinuo; los días que no gastan (su
// libranza o un festivo), en claro. La fila «a la vez» dice cuánta gente falta
// cada día: si se pone caliente, ese mes no cabe nadie más. Al final, quién no
// tiene ni un día todavía. Clases globales .tc-vpm-* de telecab.css.
//
//   VacacionesPorMeses.pintar(caja, {
//     hoy: 'AAAA-MM-DD',
//     periodos: [{ id, nombre, detalle, desde, hasta (null = sin fecha de vuelta),
//                  abierta, pendiente, libra: [1..7] }],
//     festivos: ['AAAA-MM-DD'],      // no gastan (opcional)
//     desde: 'AAAA-MM',              // el primer mes de la tira
//     mes: índice año*12+mes,        // el mes que se ve (por defecto, el de hoy)
//     sinVacaciones: [{ id, nombre, detalle }],   // opcional
//     titulo, icono, ayuda, botones: [{ html, titulo, alPulsar }],
//     alAbrir: id => …, alCambiarMes: indice => …,
//   });
(function (global) {
  'use strict';
  const esc = s => global.Casa.esc(s);
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const pad2 = n => String(n).padStart(2, '0');
  const mesIdx = iso => { const [y, m] = iso.split('-').map(Number); return y * 12 + (m - 1); };

  // Las personas de vacaciones en un mes (índice año*12+mes), con sus tramos
  // recortados al mes: [{ ...persona, segs: [{ a, b, ... }] }].
  function filasDeMes(periodos, vm) {
    const y = Math.floor(vm / 12), m = vm % 12;
    const nD = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const iso1 = `${y}-${pad2(m + 1)}-01`, isoN = `${y}-${pad2(m + 1)}-${pad2(nD)}`;
    const porPersona = new Map();
    periodos.forEach(p => {
      const h = p.hasta || '9999-12-31';
      if (p.desde > isoN || h < iso1) return;
      const a = p.desde > iso1 ? Number(p.desde.slice(8, 10)) : 1;
      const b = (p.hasta && p.hasta <= isoN) ? Number(p.hasta.slice(8, 10)) : nD;
      const k = String(p.id);
      if (!porPersona.has(k)) porPersona.set(k, { ...p, segs: [] });
      porPersona.get(k).segs.push({ a, b, abierta: !!p.abierta, pendiente: !!p.pendiente, libra: p.libra || [] });
    });
    return { y, m, nD, filas: [...porPersona.values()].sort((x, z) =>
      Math.min(...x.segs.map(s => s.a)) - Math.min(...z.segs.map(s => s.a)) || x.nombre.localeCompare(z.nombre, 'es')) };
  }

  function pintar(caja, o) {
    const periodos = o.periodos || [];
    const festivos = new Set(o.festivos || []);
    const sin = o.sinVacaciones || null;
    const hoyVm = mesIdx(o.hoy);
    const conPendientes = periodos.some(p => p.pendiente);
    const conLibra = periodos.some(p => (p.libra || []).length) || festivos.size > 0;
    // La tira de meses: desde el primero hasta la última vacación (con 3 meses
    // de margen para poder asignar hacia delante) y como mucho 15 meses vista:
    // una fecha con el año mal tecleado no convierte la tira en una alfombra.
    let maxVm = hoyVm + 3;
    periodos.forEach(p => { maxVm = Math.max(maxVm, mesIdx(p.hasta || p.desde)); });
    maxVm = Math.min(maxVm, hoyVm + 15);
    const primerVm = Math.min(mesIdx((o.desde || o.hoy.slice(0, 7)) + '-01'), hoyVm);
    const meses = []; for (let i = primerVm; i <= maxVm; i++) meses.push(i);
    let vm = o.mes == null || o.mes < primerVm || o.mes > maxVm ? hoyVm : o.mes;

    function repintar() {
      const { y, m, nD, filas } = filasDeMes(periodos, vm);
      const iso = i => `${y}-${pad2(m + 1)}-${pad2(i)}`;
      const dow = i => { const w = new Date(Date.UTC(y, m, i)).getUTCDay(); return w === 0 ? 7 : w; };
      const descanso = i => dow(i) >= 6 || festivos.has(iso(i));
      // Qué es cada día de una persona: vacaciones que gastan, que no gastan
      // (su libranza o festivo), que esperan aprobación, o nada.
      // Las que esperan aprobación van enteras con su borde; los días que
      // gastarían se cuentan igual en su fila, pero no en «a la vez» ni en el
      // total del mes hasta que se aprueben.
      const gasta = (s, i) => !s.libra.includes(dow(i)) && !festivos.has(iso(i));
      const tipo = (s, i) => (s.pendiente ? 'pend' : !gasta(s, i) ? 'libra' : iso(i) > o.hoy ? 'prog' : 'on');
      const diasDe = (f, soloAprobadas) => f.segs.reduce((t, s) => {
        if (soloAprobadas && s.pendiente) return t;
        for (let i = s.a; i <= s.b; i++) if (gasta(s, i)) t++;
        return t;
      }, 0);
      const cuenta = new Array(nD + 1).fill(0);
      filas.forEach(f => f.segs.forEach(s => { if (!s.pendiente) for (let i = s.a; i <= s.b; i++) if (gasta(s, i)) cuenta[i]++; }));
      const maxC = Math.max(1, ...cuenta.slice(1));
      const diasMes = filas.reduce((t, f) => t + diasDe(f, true), 0);
      const programadas = new Set(periodos.filter(p => !p.pendiente && p.desde > o.hoy).map(p => String(p.id)));
      const pendientes = new Set(periodos.filter(p => p.pendiente).map(p => String(p.id)));
      const cols = `grid-template-columns: minmax(9rem, 12rem) repeat(${nD}, minmax(0, 1fr));`;
      const NOMBRE_T = { on: 'de vacaciones', prog: 'vacaciones programadas', libra: 'no gasta (libra o festivo)', pend: 'esperando aprobación' };

      const fila = f => {
        let celdas = '';
        for (let i = 1; i <= nD; i++) {
          const s = f.segs.find(x => i >= x.a && i <= x.b);
          celdas += s ? `<i class="tc-vpm-${tipo(s, i)}" title="${esc(`${f.nombre} · ${i}: ${NOMBRE_T[tipo(s, i)]}`)}"></i>`
                      : `<i class="${descanso(i) ? 'tc-vpm-finde' : ''}"></i>`;
        }
        const dias = diasDe(f, false);
        const abierta = f.segs.some(s => s.abierta);
        const espera = f.segs.some(s => s.pendiente);
        return `<div class="tc-vpm-fila" style="${cols}">
          <button type="button" class="tc-vpm-nombre min-w-0 pr-2 text-sm text-left text-telecab-text truncate" data-abrir="${esc(f.id)}"
            title="${esc(f.nombre + (f.detalle ? ' · ' + f.detalle : '') + ' · ' + dias + ' día(s) este mes' + (abierta ? ' · sin fecha de vuelta' : '') + (espera ? ' · esperando aprobación' : ''))}">${esc(f.nombre)}
            <span class="text-[11px] text-telecab-muted">${dias}d${abierta ? ' →' : ''}</span></button>${celdas}</div>`;
      };
      const kpi = (txt, val, estilo = '') => `<div class="bg-telecab-dark/50 rounded-xl px-3 py-2"><p class="text-[11px] text-telecab-muted">${txt}</p><p class="text-lg font-bold tabular-nums"${estilo}>${val}</p></div>`;
      const kpis = [
        kpi(`De vacaciones en ${MESES[m]}`, filas.length),
        kpi('Días de vacaciones del mes', diasMes),
        kpi('Con vacaciones programadas', programadas.size, ' style="color: rgb(var(--tc-vac))"'),
        conPendientes ? kpi('Esperan aprobación', pendientes.size, ' style="color: rgb(var(--tc-warn))"') : '',
        sin ? kpi('Sin ni un día todavía', sin.length, ' style="color: rgb(var(--tc-warn))"') : '',
      ].filter(Boolean);

      caja.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 class="text-lg font-semibold text-telecab-text flex items-center gap-2">
            <i class="fa-solid ${esc(o.icono || 'fa-umbrella-beach')}" style="color: rgb(var(--tc-vac))" aria-hidden="true"></i> ${esc(o.titulo || 'Vacaciones por meses')}</h2>
          <div class="flex items-center gap-2">${(o.botones || []).map((b, n) =>
            `<button type="button" data-vpm-boton="${n}" class="text-xs px-3 py-2 rounded-lg border border-telecab-border text-telecab-muted hover:text-telecab-gold hover:border-telecab-gold transition"${b.titulo ? ` title="${esc(b.titulo)}"` : ''}>${b.html}</button>`).join('')}</div>
        </div>
        ${o.ayuda ? `<p class="text-xs text-telecab-muted mb-3">${o.ayuda}</p>` : ''}
        <div class="grid grid-cols-2 md:grid-cols-${kpis.length} gap-2 mb-3">${kpis.join('')}</div>
        <div class="flex flex-wrap gap-1 mb-4" role="group" aria-label="Mes">${meses.map(i => {
          const n = filasDeMes(periodos, i).filas.length;
          return `<button type="button" data-vpm-mes="${i}" class="tc-vpm-mes${i === vm ? ' on' : ''}"${i === vm ? ' aria-pressed="true"' : ''}>${MESES[i % 12].slice(0, 3)} ${String(Math.floor(i / 12)).slice(2)}${n ? ` <b>${n}</b>` : ''}${i === hoyVm ? ' ·' : ''}</button>`;
        }).join('')}</div>
        ${filas.length
          ? `<div class="overflow-x-auto"><div class="space-y-[3px] min-w-[44rem]">
              <div class="tc-vpm-fila" style="${cols}"><span></span>${Array.from({ length: nD }, (_, k) =>
                `<span class="text-center text-[10px] ${iso(k + 1) === o.hoy ? 'text-telecab-gold font-bold' : descanso(k + 1) ? 'text-telecab-muted/50' : 'text-telecab-muted'}"${festivos.has(iso(k + 1)) ? ' title="Festivo"' : ''}>${k + 1}</span>`).join('')}</div>
              <div class="tc-vpm-fila" style="${cols}"><span class="text-[10px] text-telecab-muted text-right pr-2">a la vez</span>${cuenta.slice(1).map((c, k) =>
                `<b style="background: rgb(var(--tc-vac) / ${c ? (0.12 + 0.68 * c / maxC).toFixed(2) : 0.04})" title="${c} de vacaciones el ${k + 1}">${c || ''}</b>`).join('')}</div>
              ${filas.map(fila).join('')}
            </div></div>`
          : `<p class="text-sm text-telecab-muted py-6 text-center">Nadie de vacaciones en ${MESES[m]} ${y}.</p>`}
        <div class="tc-vpm-leyenda mt-3">
          <span><i class="tc-vpm-on"></i>Disfrutadas</span>
          <span><i class="tc-vpm-prog"></i>Programadas</span>
          ${conPendientes ? '<span><i class="tc-vpm-pend"></i>Esperan aprobación</span>' : ''}
          ${conLibra ? '<span><i class="tc-vpm-libra"></i>No gasta (su libranza o festivo)</span>' : ''}
        </div>
        ${sin ? `<details class="mt-5"><summary class="cursor-pointer text-sm text-telecab-warn font-semibold">Sin vacaciones todavía (${sin.length}) — a quién le toca asignar</summary>
          <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-1.5 mt-2">${sin.map(c =>
            `<button type="button" data-abrir="${esc(c.id)}" class="text-left px-3 py-1.5 rounded-lg bg-telecab-dark/40 hover:bg-telecab-card2 transition">
              <span class="block text-sm text-telecab-text truncate">${esc(c.nombre)}</span>
              ${c.detalle ? `<span class="block text-[11px] text-telecab-muted">${esc(c.detalle)}</span>` : ''}</button>`).join('')}</div></details>` : ''}`;

      caja.querySelectorAll('[data-vpm-boton]').forEach(b => b.addEventListener('click', () => o.botones[Number(b.dataset.vpmBoton)].alPulsar()));
      caja.querySelectorAll('[data-vpm-mes]').forEach(b => b.addEventListener('click', () => {
        vm = Number(b.dataset.vpmMes);
        if (o.alCambiarMes) o.alCambiarMes(vm);
        repintar();
      }));
      if (o.alAbrir) caja.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => o.alAbrir(b.dataset.abrir)));
    }

    repintar();
    return { get mes() { return vm; } };
  }

  global.VacacionesPorMeses = { pintar, mesIdx };
})(window);
