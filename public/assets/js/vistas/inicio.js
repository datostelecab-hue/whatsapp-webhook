// views/inicio.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const $ = s => document.querySelector(s);
  const num = (n, d) => (n == null ? '—' : Number(n).toLocaleString('es-ES',
    { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const pon = (id, v, d) => { const e = $('#' + id); if (e) e.textContent = num(v, d); };
  const txt = (id, t) => { const e = $('#' + id); if (e) e.textContent = t; };
  const esFecha = iso => { if (!iso) return ''; const [a, m, dd] = iso.split('-'); return `${dd}/${m}/${a}`; };
  const hhmm = h => String(Math.floor(h) % 24).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60) % 60).padStart(2, '0');
  const duracion = h => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  // EL COLOR DE LA META, el mismo de Visibilidad (views/visibilidad.ejs, colorMeta):
  // de rojo a amarillo según se acerca y verde al cumplirla. Si un día cambia allí,
  // que cambie aquí también: las dos pantallas enseñan las mismas metas.
  function colorMeta(pct) {
    const p = Math.max(0, Number(pct) || 0);
    if (p >= 100) return 'hsl(120 72% 42%)';
    const t = Math.max(0, (p - 40) / 60);
    return `hsl(${Math.round(t * 55)} 78% 50%)`;
  }

  async function cargar(forzar) {
    const b = $('#i-refrescar');
    if (b) b.disabled = true;
    try {
      // `forzar` solo cuando se pulsa Actualizar: entrar a la pantalla sirve lo
      // cacheado (instantáneo), pero pedir refresco a mano tiene que recalcular de
      // verdad o el botón no hace nada visible.
      const r = await fetch('/inicio/api/panel' + (forzar ? '?forzar=1' : ''));
      const j = await r.json();
      if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo cargar');
      pintar(j);
      $('#i-error').classList.add('hidden');
    } catch (e) {
      const el = $('#i-error');
      el.textContent = 'No se han podido cargar las cifras: ' + e.message;
      el.classList.remove('hidden');
    } finally { if (b) b.disabled = false; }
  }

  /** Las horas contra su meta: la cifra y la barra con el color de lo cerca que está. */
  function conMeta(id, horas, meta) {
    const bar = $('#' + id + '-bar'), h = $('#' + id + '-h');
    if (!(meta > 0)) {
      txt(id + '-meta', '');
      if (bar) { bar.style.width = '0%'; }
      return null;
    }
    const pct = (Number(horas) || 0) / meta * 100;
    txt(id + '-meta', '/ ' + num(meta) + ' h');
    const color = colorMeta(pct);
    if (bar) { bar.style.width = Math.min(100, pct) + '%'; bar.style.backgroundColor = color; }
    if (h) h.style.color = color;
    const caja = $('#' + id + '-barcaja');
    if (caja) caja.title = `${num(horas, 1)} h de ${num(meta)} · ${num(pct, 1)} % de la meta`;
    return pct;
  }

  /** Los conductores de un turno, como los cuenta Control: los del cuadrante y los NN. */
  function conductores(id, s) {
    pon(id + '-cond', s.conductores);
    const nn = Number(s.conductoresNN) || 0;
    const plan = Math.max(0, (Number(s.conductores) || 0) - nn);
    txt(id + '-cond-det', nn ? `${plan} del cuadrante + ${nn} NN` : 'todos del cuadrante');
    const caja = $('#' + id + '-cond-det');
    if (caja) caja.title = nn
      ? `${plan} del cuadrante (en Control, los que salieron en la pestaña del turno) y ${nn} sin plan con ${num(s.horasNN, 1)} h (los NN, que van por su hora de inicio)`
      : 'Todos los que han salido estaban en el cuadrante';
  }

  /** Las barras del mes, día a día, en SVG: sin librerías y con los colores del tema. */
  function barrasMes(serie) {
    const caja = $('#m-dias');
    if (!caja || !serie || !serie.dias || !serie.dias.length) return;
    const dias = serie.dias, n = dias.length;
    const ultimo = serie.ultimoConDatos || 0, hoyD = serie.hoyDia;
    const tope = Math.max(serie.idealDiario || 0, ...dias.map(d => d.total || 0)) * 1.12 || 1;
    const W = n * 10, H = 60, ancho = 7;
    const y = v => H - (v / tope) * H;
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="w-full h-full overflow-visible" aria-hidden="true">`;
    dias.forEach((d, i) => {
      const x = i * 10 + (10 - ancho) / 2;
      const esHoy = d.dia === hoyD, futuro = d.dia > ultimo;
      if (futuro) {
        s += `<rect x="${x}" y="${H - 1.5}" width="${ancho}" height="1.5" rx="0.75" style="fill: rgb(var(--tc-card2))"><title>${d.dia}: aún no ha llegado</title></rect>`;
        return;
      }
      const alto = Math.max(1.5, H - y(d.total || 0));
      s += `<rect x="${x}" y="${H - alto}" width="${ancho}" height="${alto}" rx="1.2"
               style="fill: rgb(var(--tc-gold) / ${esHoy ? 0.4 : 0.9})"><title>${d.dia}${esHoy ? ' (hoy, en curso)' : ''}: ${num(d.total, 1)} h</title></rect>`;
    });
    if (serie.idealDiario > 0) {
      const yi = y(serie.idealDiario).toFixed(2);
      s += `<line x1="0" x2="${W}" y1="${yi}" y2="${yi}" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"
               style="stroke: rgb(var(--tc-text) / 0.55); stroke-width: 1"><title>Ritmo que pide la meta: ${num(serie.idealDiario)} h al día</title></line>`;
    }
    caja.innerHTML = s + '</svg>';
    // El eje: el 1, cada semana y el último día del mes.
    const marcas = [1, 8, 15, 22, n].filter((v, i, a) => v <= n && a.indexOf(v) === i);
    $('#m-dias-eje').innerHTML = marcas.map(m => `<span>${m}</span>`).join('');
  }

  function pintarMes(j, cfg) {
    const v = j.visibilidad || {}, mes = v.mes || {}, serie = j.mesSerie || {};
    txt('m-nombre', serie.mes ? '· ' + MESES[serie.mes - 1] : '');
    pon('m-h', mes.horasEfectivas, 0);
    txt('m-cond', mes.conductores != null ? `${num(mes.conductores)} conductores` : '');
    const meta = Number(cfg.meta) || 0;
    const total = Number(mes.horasEfectivas) || 0;
    // Lo de los días cerrados y lo de hoy, por separado: el ideal es a cierre de
    // ayer, así que se compara con lo entero, no con lo que aún corre.
    const dias = serie.dias || [], hoyD = serie.hoyDia;
    const ayer = hoyD && hoyD > 1 ? dias[hoyD - 2] : null;
    const cerrado = ayer ? Number(ayer.acumulado) || 0 : 0;
    const deHoy = Math.max(0, total - cerrado);
    const bar = $('#m-bar'), barHoy = $('#m-bar-hoy'), marca = $('#m-ideal');
    if (meta > 0) {
      txt('m-meta', '/ ' + num(meta) + ' h');
      bar.style.width = Math.min(100, cerrado / meta * 100) + '%';
      barHoy.style.width = Math.max(0, Math.min(100 - cerrado / meta * 100, deHoy / meta * 100)) + '%';
      $('#m-barcaja').title = `${num(cerrado, 1)} h de los días cerrados + ${num(deHoy, 1)} h de hoy, de ${num(meta)} h`;
      const pct = total / meta * 100;
      let pie = `${num(pct, 1)} % de la meta`;
      if (ayer) {
        marca.classList.remove('hidden');
        marca.style.left = `calc(${Math.min(100, ayer.ideal / meta * 100)}% - 1px)`;
        marca.title = `El ideal a cierre de ayer: ${num(ayer.ideal)} h`;
        const b = Number(ayer.brecha) || 0;
        pie += ` · a cierre de ayer, <b class="${b >= 0 ? 'text-telecab-green' : 'text-telecab-red'} tabular-nums">${b >= 0 ? '+' : '−'}${num(Math.abs(b))} h</b> ${b >= 0 ? 'por delante del' : 'por detrás del'} ideal`;
      } else marca.classList.add('hidden');
      $('#m-pie').innerHTML = pie;
    } else {
      txt('m-meta', '');
      txt('m-pie', 'Sin meta del mes: se pone en Visibilidad, en Configuración.');
    }
    txt('m-ritmo', serie.idealDiario ? `(${num(serie.idealDiario)} h/día)` : '');
    barrasMes(serie);
  }

  function pintarTurnos(j, cfg) {
    const v = j.visibilidad || {};
    const enCurso = j.turnoActual === 'dia' ? 'dia' : 'noche';
    const actual = (enCurso === 'dia' ? v.turnoDia : v.turnoNoche) || {};
    const antes = (enCurso === 'dia' ? v.turnoNoche : v.turnoDia) || {};
    const metaDe = t => Number(t === 'dia' ? cfg.meta_turno_dia_h : cfg.meta_turno_noche_h) || 0;
    const otro = enCurso === 'dia' ? 'noche' : 'dia';

    // El turno en curso.
    const icono = $('#t-icono');
    icono.className = 'inline-flex w-7 h-7 items-center justify-center rounded-full ' +
      (enCurso === 'dia' ? 'bg-telecab-gold/15 text-telecab-gold' : 'bg-telecab-azul/15 text-telecab-azul');
    icono.innerHTML = `<i class="fa-solid ${enCurso === 'dia' ? 'fa-sun' : 'fa-moon'} text-[13px]"></i>`;
    txt('t-etq', enCurso === 'dia' ? 'Turno de día · en curso' : 'Turno de noche · en curso');
    const [ini, fin] = (j.turnos || {})[enCurso] || [enCurso === 'dia' ? 5 : 17, enCurso === 'dia' ? 17 : 5];
    txt('t-ventana', `${hhmm(ini)} – ${hhmm(fin)}`);
    pon('t-h', actual.horasEfectivas, 1);
    const pct = conMeta('t', actual.horasEfectivas, metaDe(enCurso));
    conductores('t', actual);
    const jornadaH = Number(j.jornadaH) || 8;
    // En vivo: deben salir, han salido y conectados ahora.
    const vivo = actual.enVivo;
    $('#t-vivo').classList.toggle('hidden', !vivo);
    if (vivo) {
      pon('t-vivo-deben', vivo.debenSalir);
      pon('t-vivo-salido', vivo.hanSalido);
      const nn = Number(actual.conductoresNN) || 0;
      txt('t-vivo-salido-det', `${num(Math.max(0, vivo.hanSalido - nn))} del plan + ${num(nn)} NN`);
      // Los conectados y el «han salido» al día llegan aparte y más a menudo
      // (cargarVivo); mientras no lleguen, las cifras del panel.
      turnoEnCurso = enCurso;
      if (vivoTurnos) pintarConectados(); else pon('t-vivo-con', vivo.conectados);
    }
    pintarPrevision('t', actual, {
      titulo: (enCurso === 'dia' ? 'Turno de día' : 'Turno de noche') + ' en curso · quién lleva ya su jornada',
      abierta: true, meta: metaDe(enCurso), jornadaH,
    });
    $('#t-pie').textContent = pct == null ? 'Sin meta del turno: se pone en Visibilidad.'
      : `${num(pct, 1)} % de la meta del turno de ${enCurso === 'dia' ? 'día' : 'noche'}`;
    const vi = Number(actual.viajeH) || 0, es = Number(actual.esperaH) || 0, tot = vi + es;
    $('#t-viaje').style.width = (tot ? vi / tot * 100 : 0) + '%';
    $('#t-espera').style.width = (tot ? es / tot * 100 : 0) + '%';
    pon('t-viaje-h', vi, 1); pon('t-espera-h', es, 1); pon('t-util', actual.utilizacion, 1);
    // El reloj del turno.
    const dur = ((fin - ini) + 24) % 24 || 12;
    const lleva = Math.min(dur, ((Number(j.horaMadrid) - ini) + 24) % 24);
    txt('t-ini', hhmm(ini)); txt('t-fin', hhmm(fin));
    $('#t-reloj').style.width = (lleva / dur * 100) + '%';
    txt('t-queda', lleva < 0.25 ? 'acaba de empezar' : `lleva ${duracion(lleva)} · quedan ${duracion(dur - lleva)}`);
    $('#t-reloj-caja').title = `Ventana estándar del turno: ${hhmm(ini)} a ${hhmm(fin)}`;

    // El turno anterior.
    const ic = $('#p-icono');
    ic.className = 'inline-flex w-6 h-6 items-center justify-center rounded-full ' +
      (otro === 'dia' ? 'bg-telecab-gold/15 text-telecab-gold' : 'bg-telecab-azul/15 text-telecab-azul');
    ic.innerHTML = `<i class="fa-solid ${otro === 'dia' ? 'fa-sun' : 'fa-moon'} text-[11px]"></i>`;
    // «Turno noche · anoche», «Turno día · hoy»…: la etiqueta de Visibilidad.
    txt('p-etq', (antes.etq || (otro === 'dia' ? 'Turno día' : 'Turno noche')).replace(/^Turno (día|noche)/, 'Turno de $1'));
    pon('p-h', antes.horasEfectivas, 1);
    const pp = conMeta('p', antes.horasEfectivas, metaDe(otro));
    conductores('p', antes);
    $('#p-pie').textContent = (pp == null ? '' : `${num(pp, 1)} % de la meta · `) +
      `${num(antes.utilizacion, 1)} % utilización`;
    // Lo que aún puede crecer: la noche suma hasta las 12:00 y el día hasta las 24:00.
    const h = Number(j.horaMadrid);
    const abierto = otro === 'noche' ? (enCurso === 'dia' && h < 12) : (enCurso === 'noche' && h >= 12);
    txt('p-estado', abierto ? (otro === 'noche' ? 'aún suma hasta las 12:00' : 'aún suma hasta las 24:00') : 'cerrado');
    pintarPrevision('p', antes, {
      titulo: ($('#p-etq').textContent || 'Turno anterior') + ' · quién hizo su jornada',
      abierta: abierto, meta: metaDe(otro), jornadaH,
    });
  }

  function pintarJornada(j, cfg) {
    const a = (j.visibilidad || {}).ayerJornada || {};
    txt('j-etq', `Jornada pasada · ${esFecha(a.dia)}`);
    const ic = $('#j-icono'); if (ic) ic.className = 'inline-flex w-6 h-6 items-center justify-center rounded-full bg-telecab-card2 text-telecab-muted';
    txt('j-estado', a.parcial ? 'se cierra a las 12:00' : 'completa');
    pon('j-h', a.horasEfectivas, 1);
    // La meta de la jornada es la suma de las dos de turno, como en Visibilidad.
    const meta = (Number(cfg.meta_turno_dia_h) || 0) + (Number(cfg.meta_turno_noche_h) || 0);
    const pct = conMeta('j', a.horasEfectivas, meta);
    conductores('j', a);
    $('#j-pie').textContent = (pct == null ? '' : `${num(pct, 1)} % de la meta de día + noche · `) +
      `${num(a.utilizacion, 1)} % utilización`;
    const p = a.partes || {}, d = Number(p.dia) || 0, n = Number(p.noche) || 0, t = d + n;
    $('#j-dia').style.width = (t ? d / t * 100 : 0) + '%';
    $('#j-noche').style.width = (t ? n / t * 100 : 0) + '%';
    pon('j-dia-h', d, 1); pon('j-noche-h', n, 1);
    $('#j-split').title = `Turno de día ${num(d, 1)} h · turno de noche ${num(n, 1)} h`;
    // En la jornada, lo de cada uno es su día más su noche.
    pintarPrevision('j', a, {
      titulo: `Jornada pasada · ${esFecha(a.dia)} · quién hizo su jornada`,
      abierta: !!a.parcial, meta, jornadaH: Number(j.jornadaH) || 8,
    });
  }

  // ── QUIÉN LLEVA YA SU JORNADA ─────────────────────────────────────────────
  // Lo de cada tarjeta se guarda aquí para abrir su lista al pulsar.
  const PREV = {};
  const esc = Casa.esc;
  const AHORA = {
    viaje: { txt: 'en viaje', cls: 'text-telecab-green' },
    espera: { txt: 'en espera', cls: 'text-telecab-gold' },
    descanso: { txt: 'en descanso', cls: 'text-telecab-warn' },
  };

  /**
   * El resumen de la tarjeta: cuántos han hecho ya su jornada y a cuántos les
   * falta. `abierta` = el turno aún suma: entonces se dice a cuánto llegaría si
   * los que faltan la completaran; cerrado, cuánto les faltó.
   */
  function pintarPrevision(id, t, { titulo, abierta, meta, jornadaH }) {
    const b = $('#' + id + '-prev');
    const p = t && t.prevision;
    if (!b || !p || !(t.gente || []).length) { if (b) b.classList.add('hidden'); return; }
    PREV[id] = { t, titulo, abierta, meta, jornadaH };
    b.classList.remove('hidden');
    const total = p.cumplen + p.faltan;
    pon(id + '-prev-ok', p.cumplen);
    txt(id + '-prev-ok-txt', `ya llevan sus ${num(jornadaH)} h`);
    pon(id + '-prev-falta', p.faltan);
    // Sin «X h entre todos»: con los planificados que aún no han salido sumaba
    // las 8 h de cada uno y se leía como horas perdidas.
    txt(id + '-prev-falta-txt', t.enVivo && t.enVivo.planSinSalir
      ? `les faltan (${num(t.enVivo.planSinSalir)} aún no han salido)` : 'les faltan');
    $('#' + id + '-prev-bar-ok').style.width = (total ? p.cumplen / total * 100 : 0) + '%';
    $('#' + id + '-prev-bar-falta').style.width = (total ? p.faltan / total * 100 : 0) + '%';
    let pie;
    if (!p.faltan) pie = `Todos han hecho ya sus ${num(jornadaH)} h.`;
    else if (t.enVivo) {
      // El turno en curso: con todos los planificados, también los que aún no han
      // salido. Lo que se puede hacer si cada uno echa su jornada.
      const llega = meta > 0 && p.siCompletan >= meta;
      pie = `Si los ${num(p.todos)} hacen sus ${num(jornadaH)} h, el turno llega a ` +
        `<b class="tabular-nums ${meta > 0 ? (llega ? 'text-telecab-green' : 'text-telecab-red') : 'text-telecab-text'}">${num(p.siCompletan, 1)} h</b>` +
        (meta > 0 ? ` de ${num(meta)}${llega ? '' : ' (no llega)'}` : '') +
        ` · de los que faltan, ${num(p.faltanConectados)} están conectados`;
    } else if (abierta) {
      const llega = meta > 0 && p.siCompletan >= meta;
      pie = `Si los ${num(p.faltan)} completan sus ${num(jornadaH)} h, el turno llega a ` +
        `<b class="tabular-nums ${meta > 0 ? (llega ? 'text-telecab-green' : 'text-telecab-red') : 'text-telecab-text'}">${num(p.siCompletan, 1)} h</b>` +
        (meta > 0 ? ` de ${num(meta)}${llega ? '' : ' (no llega)'}` : '') +
        ` · ${num(p.faltanConectados)} de ellos siguen conectados`;
    } else pie = `A ${num(p.faltan)} les faltaron ${num(p.faltanH, 1)} h para llegar a sus ${num(jornadaH)} h.`;
    $('#' + id + '-prev-pie').innerHTML = pie;
    b.setAttribute('aria-label', `${p.cumplen} ya llevan sus ${jornadaH} h y a ${p.faltan} les faltan. Ver la lista.`);
  }

  /** La lista de la tarjeta, de más horas a menos, partida por la jornada. */
  function abrirLista(id) {
    const x = PREV[id];
    if (!x || !window.Dialogo) return;
    const { t, titulo, abierta, meta, jornadaH } = x;
    const fila = (g, i) => {
      const pct = Math.min(100, g.h / jornadaH * 100);
      const ok = g.h >= jornadaH;
      const a = g.ahora && AHORA[g.ahora.situacion];
      const estado = a ? a.txt : 'desconectado', mat = a && g.ahora.matricula ? esc(g.ahora.matricula) : '';
      // En el móvil no caben cuatro columnas: lo que hace ahora va debajo del nombre.
      return `<div class="flex items-center gap-2 sm:gap-3 py-2 border-b border-telecab-border/50 last:border-0">
        <span class="w-5 sm:w-6 shrink-0 text-right text-[11px] text-telecab-muted tabular-nums">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-telecab-text truncate" title="${esc(g.nombre)}">${esc(g.nombre)}${g.nn ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-telecab-warn/15 text-telecab-warn text-[10px] font-semibold align-middle" title="Sin plan en el cuadrante: va por su hora de inicio">NN</span>' : ''}</p>
          <div class="mt-1 h-1.5 rounded-full bg-telecab-card2 overflow-hidden"><div class="h-full rounded-full ${ok ? 'bg-telecab-green' : 'bg-telecab-warn/70'}" style="width:${pct}%"></div></div>
          <p class="sm:hidden mt-0.5 text-[11px] ${a ? a.cls : 'text-telecab-muted'}">${estado}${mat ? ` <span class="text-telecab-muted tabular-nums">· ${mat}</span>` : ''}</p>
        </div>
        <span class="hidden sm:block w-28 shrink-0 text-[11px] text-right ${a ? a.cls : 'text-telecab-muted'}">${estado}${mat ? `<br><span class="text-telecab-muted tabular-nums">${mat}</span>` : ''}</span>
        <span class="w-[4.5rem] sm:w-24 shrink-0 text-right tabular-nums">
          <b class="text-sm text-telecab-text">${num(g.h, 1)} h</b><br>
          <span class="text-[11px] ${ok ? 'text-telecab-green' : 'text-telecab-warn'}">${ok ? (g.h > jornadaH ? '+' + num(g.h - jornadaH, 1) + ' h' : 'justo') : 'faltan ' + num(jornadaH - g.h, 1) + ' h'}</span>
        </span>
      </div>`;
    };
    const gente = t.gente || [];
    // En el turno en curso, los planificados que aún no han salido van aparte:
    // no es que les falte poco, es que no han empezado.
    const sinSalir = t.enVivo ? gente.filter(g => !g.salio) : [];
    const hechos = gente.filter(g => g.h >= jornadaH);
    const faltan = gente.filter(g => g.h < jornadaH && !sinSalir.includes(g));
    const p = t.prevision || {};
    const grupo = (etq, cls, lista, desde) => lista.length
      ? `<p class="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider ${cls}">${etq} · ${lista.length}</p>` + lista.map((g, i) => fila(g, desde + i)).join('')
      : '';
    const vivo = t.enVivo;
    const cabeza = (vivo ? `<p class="text-sm text-telecab-muted">Deben salir <b class="text-telecab-text tabular-nums">${num(vivo.debenSalir)}</b> · han salido <b class="text-telecab-text tabular-nums">${num(vivo.hanSalido)}</b> · de ellos, conectados ahora <b class="text-telecab-green tabular-nums">${num(vivo.conectados)}</b></p>` : '') +
      `<p class="text-sm text-telecab-muted">${num(gente.length)} conductores · <b class="text-telecab-text tabular-nums">${num(t.horasEfectivas, 1)} h</b>` +
      (meta > 0 ? ` de ${num(meta)}` : '') +
      (p.faltan && abierta ? ` · si todos hacen sus ${num(jornadaH)} h: <b class="tabular-nums ${meta > 0 && p.siCompletan >= meta ? 'text-telecab-green' : 'text-telecab-red'}">${num(p.siCompletan, 1)} h</b>` : '') +
      `</p><p class="text-[11px] text-telecab-muted mt-1">Horas efectivas (viaje + espera) de cada uno en este turno, con la regla de Visibilidad. «Desconectado» es lo que dice BOLT ahora mismo.</p>`;
    Dialogo.aviso({
      titulo, tono: 'info', ancho: 'max-w-2xl', boton: 'Cerrar',
      html: cabeza + `<div class="mt-2 max-h-[60vh] overflow-y-auto pr-1">` +
        grupo(`Ya llevan sus ${num(jornadaH)} h`, 'text-telecab-green', hechos, 0) +
        grupo('Les faltan', 'text-telecab-warn', faltan, hechos.length) +
        grupo('Aún no han salido · del planificador', 'text-telecab-muted', sinSalir, hechos.length + faltan.length) + '</div>',
    });
  }
  ['t', 'p', 'j'].forEach(id => { const b = $('#' + id + '-prev'); if (b) b.addEventListener('click', () => abrirLista(id)); });

  function pintar(j) {
    const v = j.visibilidad || {};
    const cfg = v.config || {};
    // De cuándo es lo que se está viendo. Hace falta decirlo: el panel sirve lo
    // último calculado y refresca por detrás, así que puede tener unos minutos.
    const edad = Math.round((j.edadMs || 0) / 1000);
    $('#i-jornada').textContent = `Jornada del ${esFecha(j.jornadaEnCurso)}` +
      (edad > 60 ? ` · datos de hace ${Math.round(edad / 60)} min` : '');

    pintarMes(j, cfg);
    pintarTurnos(j, cfg);
    pintarJornada(j, cfg);

    // Más cifras.
    pon('k-hoy-h', (v.dia || {}).horasEfectivas, 1);
    pon('k-sem-h', (v.semana || {}).horasEfectivas, 1);
    const mes = v.mes || {};
    pon('k-mes-neto', mes.neto);
    pon('k-mes-viajes', mes.viajes);
    pon('k-mes-util', mes.utilizacion, 1);
    const ne = (j.noEfectivas || {}).cerrada || {};
    const nem = (j.noEfectivas || {}).mes || {};
    $('#i-ne-nota').textContent =
      `· lo «sin hacer» es de la jornada del ${esFecha(j.jornadaCerrada)}, ya cerrada, con ${j.jornadaH} h por persona`;
    pon('k-ne-h', ne.horas, 1);
    pon('k-ne-pct', ne.porcentaje, 1);
    pon('k-ne-sin', ne.sinSalir);
    pon('k-ne-personas', ne.personasDia);
    pon('k-ne-just', ne.justificadas, 1);
    pon('k-ne-mes', nem.horas, 1);
    pon('k-ne-mes-pct', nem.porcentaje, 1);

    // Kilómetros por turno. La barra parte el total en lo que se rodó dentro de
    // BOLT y lo que se rodó fuera; los dos trozos suman el 100 %, así que se ve
    // la proporción sin leer el número.
    const ponKm = (id, k) => {
      if (!k) return;
      const e = $('#' + id + '-etq'); if (e) e.textContent = k.etq || '';
      pon(id + '-tot', k.total);
      pon(id + '-bolt', k.enBolt);
      pon(id + '-fuera', k.fuera);
      pon(id + '-pct', k.porcentajeFuera, 1);
      const t = k.total || 0;
      const pb = t > 0 ? (k.enBolt / t) * 100 : 0;
      const bb = $('#' + id + '-bar-bolt'), bf = $('#' + id + '-bar-fuera');
      if (bb) bb.style.width = pb + '%';
      if (bf) bf.style.width = (t > 0 ? 100 - pb : 0) + '%';
      const barra = $('#' + id + '-barra');
      if (barra) barra.title = `${num(k.enBolt)} km en BOLT · ${num(k.fuera)} km fuera`;
      // Un turno recién empezado son ceros de verdad, no un fallo. Se dice, en vez
      // de enseñar "0 km fuera · — %", que parece la pantalla rota.
      const vacio = t === 0;
      const pie = $('#' + id + '-pie'), aviso = $('#' + id + '-vacio'), caja = $('#' + id + '-barra');
      if (pie) pie.classList.toggle('hidden', vacio);
      if (aviso) aviso.classList.toggle('hidden', !vacio);
      if (caja) caja.classList.toggle('hidden', vacio);
    };
    ponKm('k-kd', (j.km || {}).dia);
    ponKm('k-kn', (j.km || {}).noche);
    ponKm('k-ka', (j.km || {}).ayer);
  }

  // ── LOS CONECTADOS AHORA, POR TURNO (28/10/2026) ──────────────────────────
  // Aparte del panel, que se sirve de caché, y cada 10 s. Con la API v2 de BOLT
  // es su lista de conectados tal cual; cada persona, con el turno que tiene en
  // el planificador a esta hora. El turno en curso va primero.
  let vivoTurnos = null;
  let turnoEnCurso = 'dia';
  function pintarConectados() {
    const v = vivoTurnos;
    if (!v) return;
    pon('t-vivo-con', v.total);
    // Los que están conectados pero en descanso, aparte: conectados, no trabajando.
    const desc = v.descanso || {};
    const enDesc = k => (desc[k] ? ` <span class="text-telecab-muted">(${num(desc[k])} en descanso)</span>` : '');
    const de = t => `<span class="whitespace-nowrap"><i class="fa-solid ${t === 'dia' ? 'fa-sun text-telecab-gold' : 'fa-moon text-telecab-azul'} text-[9px]"></i> ${num(v[t])} ${t === 'dia' ? 'día' : 'noche'}${enDesc(t)}</span>`;
    const partes = (turnoEnCurso === 'noche' ? ['noche', 'dia'] : ['dia', 'noche']).map(de);
    if (v.todoturno) partes.push(`<span class="whitespace-nowrap">${num(v.todoturno)} todo turno${enDesc('todoturno')}</span>`);
    if (v.sinTurno) partes.push(`<span class="whitespace-nowrap">${num(v.sinTurno)} sin turno${enDesc('sinTurno')}</span>`);
    $('#t-vivo-con-det').innerHTML = partes.join(' · ');
    const totalDesc = ['dia', 'noche', 'todoturno', 'sinTurno'].reduce((s, k) => s + (Number(desc[k]) || 0), 0);
    $('#t-vivo-con-caja').title = `${num(v.total)} conectados ahora mismo a BOLT en Madrid: ` +
      `${num(v.dia)} con turno de día y ${num(v.noche)} con turno de noche en el planificador` +
      (v.todoturno ? `, ${num(v.todoturno)} de todo turno` : '') +
      (v.sinTurno ? ` y ${num(v.sinTurno)} sin turno hoy (NN)` : '') +
      `. De ellos, ${num(totalDesc)} en descanso: conectados, pero sin trabajar.` +
      ` ${v.fuente === 'v2' ? 'Lista de conectados de BOLT (API v2).' : 'Según los últimos estados guardados de BOLT.'}`;
    // «HAN SALIDO», AL DÍA: los del plan con horas más los del plan que están
    // ahora trabajando, y los NN por sus horas. Solo si es de este turno.
    const s = v.salido;
    if (s && s.turno === turnoEnCurso) {
      pon('t-vivo-salido', s.total);
      txt('t-vivo-salido-det', `${num(s.plan)} del plan + ${num(s.fuera)} NN`);
    }
  }
  async function cargarVivo() {
    if (document.hidden) return;
    try {
      const r = await fetch('/inicio/api/vivo');
      const j = await r.json();
      if (j.status !== 'ok') return;
      vivoTurnos = j;
      pintarConectados();
    } catch (_) { /* se queda lo último: la cifra del panel sigue ahí */ }
  }

  const b = $('#i-refrescar');
  if (b) b.addEventListener('click', () => { cargar(true); cargarVivo(); });
  cargar();
  cargarVivo();
  setInterval(cargarVivo, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargarVivo(); });
})();
