// modules/Vehiculos/vistas/taller.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const PUEDE = DEL_SERVIDOR.puedeApuntar;
  const TIPOS = DEL_SERVIDOR.tipos;
  const GENERAL = DEL_SERVIDOR.intervaloGeneral;
  // La misma pantalla para las dos sedes (04/11/2026): Madrid pregunta a /taller
  // y Barcelona a /barcelona/mantenimientos, sin la pestaña de las citas.
  const BASE = DEL_SERVIDOR.base || '/taller';
  const CON_CITAS = DEL_SERVIDOR.conCitas !== false;
  // Lo que pintan igual Mantenimientos y Control de una cita (citasTaller.js).
  const CT = window.CitasTaller;
  const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

  /**
   * «CITA PUESTA PARA REVISIÓN» en la fila del coche (08/10/2026): el día, la
   * hora y quién lo lleva según el planificador. En ámbar si nadie lo lleva a
   * esa hora o si se avisó a otro; en rojo si dijo que no puede ir.
   */
  function celdaCita(c) {
    const dia = CT.cercania(c.fecha, hoyMadrid()) || CT.diaCorto(c.fecha);
    const quien = !c.responsable
      ? '<span class="text-telecab-warn">Nadie lo lleva en ese turno</span>'
      : c.confirmacion === 'no_puede'
        ? '<span class="text-telecab-red">' + esc(c.responsable.nombre) + ' no puede ir</span>'
        : 'Lo lleva ' + esc(c.responsable.nombre) +
          (c.confirmacion === 'confirmada' ? ' <span class="text-telecab-green">· confirmada</span>' : '') +
          (c.cambioDeConductor ? ' <span class="text-telecab-warn">· se avisó a otro</span>' : '');
    return '<div class="mt-1.5 flex flex-col items-end gap-0.5 font-sans">' +
      '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-telecab-gold/40 bg-telecab-gold/10 ' +
        'text-telecab-gold text-[11px] font-semibold whitespace-nowrap"><i class="fa-solid fa-calendar-check"></i>Cita puesta para revisión</span>' +
      '<span class="text-[11px] text-telecab-text whitespace-nowrap">' + esc(dia) + ' a las ' + esc(c.hora) +
        (c.otras ? ' <span class="text-telecab-muted">(+' + c.otras + ')</span>' : '') + '</span>' +
      '<span class="text-[11px] text-telecab-muted max-w-[220px] text-right">' + quien + '</span>' +
    '</div>';
  }

  const $ = s => document.querySelector(s);
  const n = v => (v == null ? '—' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 0 }));
  const n1 = v => (v == null ? '—' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 }));
  const esc = Casa.esc;
  const dia = f => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : '—');

  const COLOR = {
    toca:     { txt: 'text-telecab-red',    barra: 'bg-telecab-red',    etiqueta: 'Toca revisión' },
    pronto:   { txt: 'text-telecab-warn',   barra: 'bg-telecab-warn',   etiqueta: 'A punto' },
    ok:       { txt: 'text-telecab-green',  barra: 'bg-telecab-green',  etiqueta: 'Al día' },
    sin_dato: { txt: 'text-telecab-muted',  barra: 'bg-telecab-border', etiqueta: 'Sin dato' },
    revisar:  { txt: 'text-telecab-violet', barra: 'bg-telecab-violet', etiqueta: 'Dato imposible' },
  };

  let FILAS = [], TOTAL = 0;

  async function api(url, opciones) {
    const r = await fetch(url, opciones);
    const j = await r.json().catch(() => ({ status: 'error', msg: 'respuesta ilegible' }));
    if (j.status !== 'ok') throw new Error(j.msg || 'Error');
    return j;
  }

  // ── Cargar y pintar ──────────────────────────────────────────────────
  async function cargar() {
    const q = new URLSearchParams();
    if ($('#f-busca').value.trim()) q.set('busca', $('#f-busca').value.trim());
    if ($('#f-estado').value) q.set('estado', $('#f-estado').value);
    const j = await api(BASE + '/api/cuadro?' + q.toString());
    FILAS = j.filas;
    TOTAL = j.resumen.total;      // el total de la flota, no el del filtro
    pintarResumen(j.resumen);
    pintarTabla(j.filas);
  }

  function pintarResumen(r) {
    $('#c-toca').textContent = r.toca;
    $('#c-pronto').textContent = r.pronto;
    // Cuántos de esos ya tienen cita puesta en el taller (null = sin datos de citas).
    const conCita = n => (n == null ? '' : ' · ' + n + ' con cita puesta');
    $('#c-toca-det').textContent = 'Pasan del intervalo' + conCita(r.tocaConCita);
    $('#c-pronto-det').textContent = 'Les quedan menos de 15 días' + conCita(r.prontoConCita);
    $('#c-ok').textContent = r.ok;
    $('#c-sindato').textContent = r.sinDato;
    $('#c-sindato-det').textContent = r.sinOdometro + ' sin odómetro · ' + r.sinRevision + ' sin revisión apuntada';
    $('#c-revisar').textContent = r.revisar;
    $('#c-revisar-caja').classList.toggle('hidden', !r.revisar);
  }

  function pintarTabla(filas) {
    $('#f-cuenta').textContent = filas.length + ' de ' + (TOTAL || filas.length) + ' coches';
    $('#t-vacio').classList.toggle('hidden', filas.length > 0);
    $('#t-cuerpo').innerHTML = filas.map(f => {
      const c = COLOR[f.estado] || COLOR.sin_dato;
      const pct = f.porcentaje == null ? 0 : Math.min(100, f.porcentaje);
      const fuente = f.odometroFuente === 'can' ? 'C'
        : (f.odometroFuente ? 'A' : '');
      const queda = f.estado === 'toca'
        ? '<span class="text-telecab-red font-semibold">pasado ' + n(-f.restan) + ' km</span>'
        : (f.restan == null ? '—'
          : n(f.restan) + ' km' + (f.dias != null ? ' <span class="text-telecab-muted">· ' + f.dias + ' d</span>' : ''));
      return '<tr class="fila hover:bg-telecab-card2 cursor-pointer" data-id="' + f.id + '">' +
        '<td class="px-4 py-3 font-semibold text-telecab-text whitespace-nowrap">' +
          '<span class="inline-block w-2 h-2 rounded-full ' + c.barra + ' mr-2 align-middle" title="' + c.etiqueta + '"></span>' +
          esc(f.matricula) +
          // El mismo aviso que en el mapa: de este coche Mapon no da nada, y sin
          // Mapon no hay odometro que leer.
          (f.conMapon ? '' : ' <span class="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-telecab-red/15 text-telecab-red"'
            + ' title="Mapon no da nada de este coche: no se puede situar en el mapa ni leer su odómetro">sin Mapon</span>') +
          '</td>' +
        '<td class="px-3 py-3 text-telecab-muted">' + esc(f.vehiculo) + '</td>' +
        '<td class="px-3 py-3 text-right tabular-nums text-telecab-text">' + n(f.odometro) +
          (fuente ? ' <span class="text-[10px] text-telecab-muted" title="' +
            (fuente === 'C' ? 'del CAN del coche' : 'de una lectura anclada a mano') + '">' + fuente + '</span>' : '') +
        '</td>' +
        '<td class="px-3 py-3 text-right tabular-nums text-telecab-muted">' + n(f.revisionKm) + '</td>' +
        '<td class="px-3 py-3 text-right tabular-nums font-semibold ' + c.txt + '">' +
          (f.desde == null ? '—' : n(f.desde)) + '</td>' +
        '<td class="px-3 py-3">' +
          (f.porcentaje == null ? '<span class="text-xs text-telecab-muted">—</span>' :
            '<div class="h-2 rounded-full bg-telecab-card2 overflow-hidden"><div class="h-full ' + c.barra +
            '" style="width:' + pct + '%"></div></div>' +
            '<span class="text-[10px] text-telecab-muted">' + f.porcentaje + '% de ' + n(f.intervalo) + '</span>') +
        '</td>' +
        '<td class="px-3 py-3 text-right tabular-nums text-telecab-muted">' +
          (f.kmDia == null ? '—' : n1(f.kmDia) + ' km/d') + '</td>' +
        '<td class="px-4 py-3 text-right tabular-nums">' + queda + (f.cita ? celdaCita(f.cita) : '') + '</td>' +
      '</tr>';
    }).join('');
    document.querySelectorAll('#t-cuerpo .fila').forEach(tr =>
      tr.addEventListener('click', () => abrirFicha(tr.dataset.id)));
  }

  // ── Ficha ────────────────────────────────────────────────────────────
  async function abrirFicha(id) {
    const j = await api(BASE + '/api/ficha/' + id);
    const f = j.ficha;
    const c = COLOR[f.estado] || COLOR.sin_dato;
    $('#pf-matricula').textContent = f.matricula;
    $('#pf-vehiculo').textContent = [f.vehiculo, f.anio, f.estadoOperativo, f.zona].filter(Boolean).join(' · ');

    const dato = (t, v, extra) =>
      '<div><p class="text-[11px] text-telecab-muted uppercase tracking-wide">' + t + '</p>' +
      '<p class="text-lg font-semibold text-telecab-text tabular-nums">' + v +
      (extra ? ' <span class="text-xs font-normal text-telecab-muted">' + extra + '</span>' : '') + '</p></div>';

    let html = '<div class="rounded-xl border ' +
      (f.estado === 'toca' ? 'border-telecab-red/50 bg-telecab-red/10'
        : f.estado === 'pronto' ? 'border-telecab-warn/50 bg-telecab-warn/10'
        : f.estado === 'ok' ? 'border-telecab-green/40 bg-telecab-green/5'
        : 'border-telecab-border bg-telecab-card') + ' px-4 py-3">' +
      '<p class="text-sm font-semibold ' + c.txt + '">' + c.etiqueta + '</p>' +
      '<p class="text-xs text-telecab-muted mt-0.5">' +
        (f.estado === 'sin_dato'
          ? (f.odometro == null ? 'No tenemos su odómetro.' : 'No hay ninguna revisión apuntada.')
          : f.estado === 'revisar'
            ? 'El km de la última revisión no cuadra con el odómetro: uno de los dos está mal.'
            : (f.desde != null ? n(f.desde) + ' km desde la última revisión, de ' + n(f.intervalo) + '.' : '')) +
      '</p></div>';

    // Las citas del taller que tiene puestas, con quien debe llevarlo cada día.
    if ((f.citas || []).length) {
      html += '<div class="rounded-xl border border-telecab-gold/40 bg-telecab-gold/5 px-4 py-3">' +
        '<p class="text-sm font-semibold text-telecab-gold"><i class="fa-solid fa-calendar-check mr-1"></i>Cita puesta para revisión</p>' +
        f.citas.map(x =>
          '<div class="mt-2 text-sm">' +
            '<p class="font-semibold text-telecab-text">' + esc(CT.diaLargo(x.fecha)) + ' a las ' + esc(x.hora) + '</p>' +
            '<div class="mt-1">' + CT.responsable(x) + '</div>' +
            '<div class="mt-1.5 flex flex-wrap items-start gap-x-6 gap-y-1 text-xs">' +
              '<div>' + CT.aviso(x, hoyMadrid()) + '</div><div>' + CT.confirmacion(x) + '</div>' +
            '</div>' +
          '</div>').join('<div class="border-t border-telecab-border/60 my-2"></div>') +
        '<button id="pf-ver-citas" class="mt-3 text-xs font-semibold text-telecab-gold underline underline-offset-2">Ver en Citas del taller</button>' +
      '</div>';
    }

    html += '<div class="grid grid-cols-2 gap-4">' +
      dato('Odómetro hoy', n(f.odometro),
        f.odometroFuente === 'can' ? 'del CAN' : (f.odometroFuente ? 'anclado' : 'sin dato')) +
      dato('Última revisión', n(f.revisionKm), f.revisionFecha ? dia(f.revisionFecha) : 'sin fecha') +
      dato('Desde entonces', f.desde == null ? '—' : n(f.desde) + ' km') +
      dato('Ritmo', f.kmDia == null ? '—' : n1(f.kmDia) + ' km/día',
        f.diasRitmo ? 'medido en ' + f.diasRitmo + ' días' : 'aún sin histórico') +
      '</div>';

    html += '<div class="flex flex-wrap gap-2">';
    if (PUEDE) {
      html += '<button id="pf-apuntar" class="px-3 py-2 rounded-lg bg-telecab-gold text-telecab-dark text-sm font-semibold">' +
        '<i class="fa-solid fa-plus mr-1"></i> Apuntar mantenimiento</button>';
      if (f.odometroFuente !== 'can') {
        html += '<button id="pf-anclar" class="px-3 py-2 rounded-lg bg-telecab-card border border-telecab-border text-sm text-telecab-text">' +
          '<i class="fa-solid fa-anchor mr-1"></i> Anclar odómetro</button>';
      }
      if (CON_CITAS) {
        html += '<button id="pf-cita" class="px-3 py-2 rounded-lg bg-telecab-card border border-telecab-border text-sm text-telecab-text"' +
          ' title="Ponerle una cita del taller a este coche: el día y la hora.">' +
          '<i class="fa-solid fa-calendar-plus mr-1"></i> Poner cita</button>';
      }
      html += '<button id="pf-intervalo" class="px-3 py-2 rounded-lg bg-telecab-card border border-telecab-border text-sm text-telecab-muted">' +
        'Intervalo: ' + n(f.intervalo) + ' km' + (f.intervaloPropio ? ' (propio)' : '') + '</button>';
    }
    html += '</div>';

    html += '<div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-2">Historial (' + f.historial.length + ')</p>' +
      (f.historial.length ? f.historial.map(m =>
        '<div class="border border-telecab-border rounded-xl px-3 py-2 mb-2 ' + (m.anuladoAt ? 'opacity-50' : '') + '">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<span class="text-sm font-semibold text-telecab-text">' + esc(m.tipoEtiqueta) + '</span>' +
            '<span class="text-sm tabular-nums text-telecab-text">' + n(m.km) + ' km</span>' +
          '</div>' +
          '<p class="text-[11px] text-telecab-muted">' +
            (m.fecha ? dia(m.fecha) : 'sin fecha') +
            (m.taller ? ' · ' + esc(m.taller) : '') +
            (m.coste != null ? ' · ' + n1(m.coste) + ' €' : '') +
            (m.usuario ? ' · lo apuntó ' + esc(m.usuario) : '') +
          '</p>' +
          (m.descripcion ? '<p class="text-xs text-telecab-text mt-1">' + esc(m.descripcion) + '</p>' : '') +
          (m.anuladoAt
            ? '<p class="text-[11px] text-telecab-red mt-1">Anulado por ' + esc(m.anuladoPor || '—') + ': ' + esc(m.anuladoMotivo) + '</p>'
            : (PUEDE ? '<button class="anular text-[11px] text-telecab-red underline mt-1" data-id="' + m.id + '">Anular</button>' : '')) +
        '</div>').join('')
        : '<p class="text-sm text-telecab-muted">Ninguno todavía.</p>') +
      '</div>';

    if (f.anclas.length) {
      html += '<div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-2">Lecturas del cuadro</p>' +
        f.anclas.map(a => '<p class="text-xs text-telecab-muted">' + n(a.km) + ' km · ' + esc(a.leidoAt) +
          (a.usuario ? ' · ' + esc(a.usuario) : '') + (a.nota ? ' · ' + esc(a.nota) : '') + '</p>').join('') +
        '</div>';
    }

    $('#pf-cuerpo').innerHTML = html;
    $('#p-ficha').classList.remove('hidden');

    if ($('#pf-apuntar')) $('#pf-apuntar').addEventListener('click', () => abrirMant(f));
    if ($('#pf-ver-citas')) $('#pf-ver-citas').addEventListener('click', () => {
      $('#p-ficha').classList.add('hidden');
      verPestana('citas');
    });
    if ($('#pf-anclar')) $('#pf-anclar').addEventListener('click', () => abrirAncla(f));
    if ($('#pf-cita')) $('#pf-cita').addEventListener('click', async () => {
      if (await nuevaCita({ vehiculoId: f.id })) {
        cargar().catch(() => { /* la lista se repinta en la próxima */ });
        abrirFicha(f.id).catch(() => { /* la ficha ya estaba */ });
      }
    });
    if ($('#pf-intervalo')) $('#pf-intervalo').addEventListener('click', () => cambiarIntervalo(f));
    document.querySelectorAll('#pf-cuerpo .anular').forEach(b => b.addEventListener('click', async () => {
      const motivo = prompt('¿Por qué se anula? Queda apuntado con tu nombre.');
      if (!motivo) return;
      try {
        await api(BASE + '/api/anular', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: b.dataset.id, motivo }),
        });
        await abrirFicha(f.id); await cargar();
      } catch (e) { alert(e.message); }
    }));
  }

  async function cambiarIntervalo(f) {
    const v = prompt('¿Cada cuántos km toca revisión en ' + f.matricula + '?\n' +
      'Vacío = el general del módulo (' + n(GENERAL) + ' km).',
      f.intervaloPropio ? f.intervalo : '');
    if (v === null) return;
    try {
      await api(BASE + '/api/intervalo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculoId: f.id, km: v.trim() }),
      });
      await abrirFicha(f.id); await cargar();
    } catch (e) { alert(e.message); }
  }

  // ── Modales ──────────────────────────────────────────────────────────
  function abrirMant(f) {
    const sel = $('#mm-vehiculo');
    sel.innerHTML = FILAS.map(x =>
      '<option value="' + x.id + '">' + esc(x.matricula) + (x.vehiculo ? ' — ' + esc(x.vehiculo) : '') + '</option>').join('');
    if (f) sel.value = f.id;
    $('#mm-tipo').value = 'revision';
    // El calendario de la casa escribe dd/mm/aaaa; el servidor lo entiende.
    $('#mm-fecha').value = new Date().toLocaleDateString('es-ES',
      { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' });
    $('#mm-km').value = '';
    $('#mm-coste').value = '';
    $('#mm-taller').value = '';
    $('#mm-desc').value = '';
    $('#mm-error').classList.add('hidden');
    pistaKm();
    $('#m-mant').classList.remove('hidden');
  }

  function pistaKm() {
    const f = FILAS.find(x => String(x.id) === $('#mm-vehiculo').value);
    $('#mm-km-pista').textContent = !f ? ''
      : f.odometro == null ? 'No sabemos su odómetro: el km que pongas será el bueno.'
      : 'Hoy marca ' + n(f.odometro) + ' km.';
  }

  function abrirAncla(f) {
    $('#m-ancla').dataset.vehiculo = f.id;
    $('#ma-km').value = '';
    $('#ma-nota').value = '';
    $('#ma-error').classList.add('hidden');
    $('#m-ancla').classList.remove('hidden');
  }

  const cerrarModales = () => {
    $('#m-mant').classList.add('hidden');
    $('#m-ancla').classList.add('hidden');
  };

  // ── Enganches ────────────────────────────────────────────────────────
  $('#f-busca').addEventListener('input', () => { clearTimeout(window._tb); window._tb = setTimeout(cargar, 250); });
  $('#f-estado').addEventListener('change', cargar);
  $('#t-recargar').addEventListener('click', cargar);
  if ($('#t-nuevo')) $('#t-nuevo').addEventListener('click', () => abrirMant(null));
  $('#mm-vehiculo').addEventListener('change', pistaKm);

  document.querySelectorAll('.tarjeta-estado').forEach(b => b.addEventListener('click', () => {
    $('#f-estado').value = $('#f-estado').value === b.dataset.estado ? '' : b.dataset.estado;
    cargar();
  }));

  document.querySelectorAll('[data-cerrar]').forEach(b =>
    b.addEventListener('click', () => $('#p-ficha').classList.add('hidden')));
  document.querySelectorAll('[data-cerrar-modal]').forEach(b => b.addEventListener('click', cerrarModales));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    cerrarModales();
    $('#p-ficha').classList.add('hidden');
  });

  if ($('#mm-guardar')) $('#mm-guardar').addEventListener('click', async () => {
    const err = $('#mm-error');
    err.classList.add('hidden');
    try {
      await Api.post(BASE + '/api/mantenimiento', {
        vehiculoId: $('#mm-vehiculo').value,
        tipo: $('#mm-tipo').value,
        fecha: $('#mm-fecha').value,
        km: $('#mm-km').value,
        coste: $('#mm-coste').value,
        taller: $('#mm-taller').value,
        descripcion: $('#mm-desc').value,
      }, { boton: $('#mm-guardar') });
      cerrarModales();
      $('#p-ficha').classList.add('hidden');
      await cargar();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });

  if ($('#ma-guardar')) $('#ma-guardar').addEventListener('click', async () => {
    const err = $('#ma-error');
    err.classList.add('hidden');
    try {
      const j = await Api.post(BASE + '/api/ancla', {
        vehiculoId: $('#m-ancla').dataset.vehiculo,
        km: $('#ma-km').value,
        nota: $('#ma-nota').value,
      }, { boton: $('#ma-guardar') });
      cerrarModales();
      if (!j.seguira) {
        alert('Anclado. Aviso: este coche no tiene contador de GPS, así que la lectura se queda quieta ' +
              'y habrá que repetirla de vez en cuando.');
      }
      await abrirFicha($('#m-ancla').dataset.vehiculo);
      await cargar();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });

  cargar().catch(e => alert('No se pudo cargar el taller: ' + e.message));

  // Sin citas (Mantenimientos de Barcelona) la pantalla acaba aquí: la vista no
  // pinta ni las pestañas ni la lista de citas.
  if (!CON_CITAS) return;

  // ══════════ LAS CITAS DEL TALLER ══════════
  const C = window.CitasTaller;
  const ESTADOS_CITA = DEL_SERVIDOR.citasEstados;
  const DIAS_ANTES = DEL_SERVIDOR.citasDiasAntes;
  const TRAMOS = [
    { id: 'proximas', texto: 'Próximas' },
    { id: 'pasadas', texto: 'Últimos 30 días' },
  ];
  let tramo = 'proximas', CITAS = null;

  // ── Las pestañas. `#citas` en la dirección abre la de las citas. ──
  function verPestana(p) {
    document.querySelectorAll('.pestana').forEach(b => {
      const on = b.dataset.pestana === p;
      b.className = 'pestana flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition ' +
        (on ? 'bg-telecab-gold text-telecab-dark shadow-gold'
            : 'bg-telecab-card border border-telecab-border text-telecab-muted hover:border-telecab-gold/40 hover:text-telecab-text');
    });
    $('#v-flota').classList.toggle('hidden', p !== 'flota');
    $('#v-citas').classList.toggle('hidden', p !== 'citas');
    try { history.replaceState(null, '', p === 'citas' ? '#citas' : location.pathname); } catch (_) { /* nada */ }
  }
  document.querySelectorAll('.pestana').forEach(b => b.addEventListener('click', () => verPestana(b.dataset.pestana)));
  verPestana(location.hash === '#citas' ? 'citas' : 'flota');

  async function cargarCitas() {
    const hoy = CITAS ? CITAS.hoy : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    const q = tramo === 'pasadas'
      ? { desde: C.sumar(hoy, -30), hasta: C.sumar(hoy, -1) }
      : { desde: hoy, hasta: C.sumar(hoy, 60) };
    CITAS = await api(BASE + '/api/citas?' + new URLSearchParams(q).toString());
    pintarCitas();
  }

  function tarjetaCitas(etq, valor, tono, ayuda) {
    const t = { red: ['border-telecab-red/40', 'text-telecab-red'], warn: ['border-telecab-warn/40', 'text-telecab-warn'],
      green: ['border-telecab-green/40', 'text-telecab-green'], muted: ['border-telecab-border', 'text-telecab-text'] }[tono];
    return `<div class="bg-telecab-card border-2 ${t[0]} rounded-2xl p-4" title="${esc(ayuda || '')}">
      <p class="text-xs text-telecab-muted uppercase tracking-wide">${esc(etq)}</p>
      <p class="text-3xl font-bold mt-1 tabular-nums ${t[1]}">${esc(String(valor))}</p></div>`;
  }

  function pintarCitas() {
    const r = CITAS.resumen;
    // El número en la pestaña: las pendientes. En rojo si alguna pide algo ya.
    const cuenta = $('#ct-cuenta');
    cuenta.textContent = r.pendientes;
    cuenta.className = (tramo !== 'proximas' || !r.pendientes ? 'hidden ' : '') +
      'px-1.5 py-0.5 rounded-md text-[11px] tabular-nums ' + (r.noPueden || r.sinResponsable ? 'bg-telecab-red text-white' : 'bg-telecab-dark/30');

    $('#ct-tramos').innerHTML = TRAMOS.map(t => `<button data-tramo="${t.id}" class="px-3 py-1 rounded-lg text-xs font-semibold ${
      t.id === tramo ? 'bg-telecab-gold text-telecab-dark' : 'text-telecab-muted hover:text-telecab-text'}">${esc(t.texto)}</button>`).join('');
    document.querySelectorAll('#ct-tramos [data-tramo]').forEach(b => b.addEventListener('click', () => {
      tramo = b.dataset.tramo;
      cargarCitas().catch(e => Dialogo.aviso({ titulo: 'No se pudieron cargar las citas', texto: e.message, tono: 'error' }));
    }));

    $('#ct-resumen').innerHTML = tramo === 'pasadas' ? '' :
      tarjetaCitas('Pendientes', r.pendientes, 'muted', 'Citas por hacer desde hoy') +
      tarjetaCitas(`Próximos ${DIAS_ANTES + 1} días sin avisar`, r.sinAvisar, r.sinAvisar ? 'warn' : 'green', 'Hoy, mañana y pasado mañana: a quién no le ha llegado el aviso') +
      tarjetaCitas('No pueden ir', r.noPueden, r.noPueden ? 'red' : 'muted', 'Dijeron que no: hay que buscar quién lleva el coche') +
      tarjetaCitas('Sin conductor', r.sinResponsable, r.sinResponsable ? 'warn' : 'muted', 'A esa hora nadie lleva el coche según el planificador');

    if (!CITAS.citas.length) {
      $('#ct-lista').innerHTML = `<div class="rounded-2xl border border-telecab-border bg-telecab-card px-4 py-10 text-center text-sm text-telecab-muted">
        ${tramo === 'pasadas' ? 'No hubo citas en los últimos 30 días.' : 'No hay citas próximas.' + (PUEDE ? ' Sube el Excel del taller con «Importar Excel del taller» o pon una con «Nueva cita».' : '')}</div>`;
      return;
    }
    $('#ct-lista').innerHTML = C.porDia(CITAS.citas, CITAS.hoy).map(g => `
      <section>
        <h2 class="text-sm font-semibold text-telecab-text mb-2 flex items-center gap-2">
          ${g.cerca ? `<span class="px-2 py-0.5 rounded-full text-[11px] ${g.cerca === 'Hoy' ? 'bg-telecab-gold text-telecab-dark' : 'bg-telecab-card2 text-telecab-text border border-telecab-border'}">${esc(g.cerca)}</span>` : ''}
          ${esc(g.titulo)} <span class="text-telecab-muted font-normal">· ${g.citas.length} cita(s)</span>
        </h2>
        <div class="bg-telecab-card border border-telecab-border rounded-2xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm min-w-[980px]">
              <thead class="bg-telecab-card2 text-telecab-muted text-[11px] uppercase tracking-wide">
                <tr>
                  <th class="text-left px-4 py-2 w-16">Hora</th>
                  <th class="text-left px-3 py-2">Coche</th>
                  <th class="text-left px-3 py-2">Lo lleva</th>
                  <th class="text-left px-3 py-2">Aviso</th>
                  <th class="text-left px-3 py-2">Confirmación</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-telecab-border">${g.citas.map(filaCita).join('')}</tbody>
            </table>
          </div>
        </div>
      </section>`).join('');
    document.querySelectorAll('#ct-lista [data-accion]').forEach(b => b.addEventListener('click', () => accionCita(b.dataset.accion, b.dataset.id)));
  }

  const botonCita = (accion, id, icono, texto, titulo, principal) =>
    `<button data-accion="${accion}" data-id="${id}" title="${esc(titulo)}" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold ${principal
      ? 'bg-telecab-gold text-telecab-dark' : 'bg-telecab-card border border-telecab-border text-telecab-muted hover:text-telecab-text'}">` +
    `<i class="${icono}${texto ? ' mr-1' : ''}"></i>${esc(texto)}</button>`;

  function filaCita(c) {
    const pendiente = c.estado === 'pendiente';
    const atencion = pendiente && (c.confirmacion === 'no_puede' || !c.responsable || c.cambioDeConductor);
    // Falta avisar: nadie lo hizo, o se avisó a otro y ahora lo lleva este.
    const falta = pendiente && c.responsable && (!c.aviso_at || c.cambioDeConductor);
    const acciones = [];
    if (PUEDE && falta) acciones.push(botonCita('avisar', c.id, 'fa-brands fa-whatsapp', 'Avisar', 'Mandarle ahora el aviso con la plantilla de la cita', true));
    if (pendiente && c.responsable) acciones.push(botonCita('copiar', c.id, 'fa-regular fa-copy', 'Copiar', 'Copiar el mensaje para mandarlo a mano desde el chat', false));
    if (PUEDE && falta) acciones.push(botonCita('avisado', c.id, 'fa-solid fa-check', 'Avisado', 'Ya se le avisó a mano: apuntarlo', false));
    if (PUEDE) acciones.push(botonCita('estado', c.id, 'fa-solid fa-flag', 'Estado', 'Hecha, no se presentó o anulada', false));
    acciones.push(botonCita('seguimiento', c.id, 'fa-solid fa-clock-rotate-left', '', 'Todo lo que ha pasado con esta cita', false));
    return `<tr class="${atencion ? 'bg-telecab-red/5' : ''} ${pendiente ? '' : 'opacity-70'} align-top">
      <td class="px-4 py-3 font-semibold tabular-nums text-telecab-text">${esc(c.hora)}</td>
      <td class="px-3 py-3"><span class="font-mono font-semibold text-telecab-text">${esc(c.matricula)}</span>
        <div class="text-[11px] text-telecab-muted">${esc(c.vehiculo || '')}</div>
        ${c.a_mano ? `<div class="text-[11px] text-telecab-muted" title="${esc('No viene del Excel del taller: la puso ' + (c.creado_por_nombre || 'alguien') + ' el ' + (c.creado_at || '—') + '.')}"><i class="fa-solid fa-pen mr-1"></i>Puesta a mano</div>` : ''}</td>
      <td class="px-3 py-3">${C.responsable(c)}</td>
      <td class="px-3 py-3 text-xs">${C.aviso(c, CITAS.hoy, DIAS_ANTES)}</td>
      <td class="px-3 py-3">${C.confirmacion(c)}${c.ultima_llamada ? `<div class="mt-1">${C.ultimaLlamada(c)}</div>` : ''}</td>
      <td class="px-4 py-3"><div class="flex flex-wrap justify-end gap-1">${acciones.join('')}</div></td>
    </tr>`;
  }

  const postCita = (url, cuerpo) => api(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}),
  });

  async function accionCita(accion, id) {
    const c = CITAS.citas.find(x => String(x.id) === String(id));
    if (!c) return;
    try {
      if (accion === 'seguimiento') return C.verSeguimiento(BASE + '/api/citas/' + c.id);
      if (accion === 'copiar') {
        await navigator.clipboard.writeText(c.mensaje);
        return Dialogo.hecho('Mensaje copiado: pégalo en su chat');
      }
      if (accion === 'avisar') {
        const ok = await Dialogo.confirmar({ titulo: 'Avisar por WhatsApp',
          texto: `Se le manda a ${c.responsable.nombre} el aviso de la cita del ${c.matricula} (${C.diaLargo(c.fecha).toLowerCase()} a las ${c.hora}), con los botones «Confirmo» y «No puedo ir».`,
          si: 'Mandar el aviso', no: 'Cancelar' });
        if (!ok) return;
        const r = await postCita(`${BASE}/api/citas/${c.id}/avisar`);
        if (!r.ok) { await Dialogo.aviso({ titulo: 'No salió el aviso', texto: r.error, tono: 'error' }); return cargarCitas(); }
        Dialogo.hecho('Aviso mandado a ' + r.conductor);
      } else if (accion === 'avisado') {
        const v = await Dialogo.formulario(`Avisado a mano · ${c.matricula}`, [
          { id: 'nota', etiqueta: 'Cómo', tipo: 'texto-largo', marcador: 'Por el chat, por teléfono…' },
        ], { textoBoton: 'Apuntar el aviso', nota: `Queda apuntado que se avisó a ${c.responsable.nombre}, con tu nombre y la hora.` });
        if (!v) return;
        await postCita(`${BASE}/api/citas/${c.id}/avisado`, { conductorId: c.responsable.conductorId, nota: v.nota });
        Dialogo.hecho('Aviso apuntado');
      } else if (accion === 'estado') {
        const v = await Dialogo.formulario(`Estado · ${c.matricula}, ${C.diaLargo(c.fecha).toLowerCase()}`, [
          { id: 'estado', etiqueta: 'Estado', tipo: 'lista', obligatorio: true, valor: c.estado,
            opciones: ESTADOS_CITA.map(e => ({ valor: e.codigo, texto: e.etiqueta })) },
          { id: 'nota', etiqueta: 'Nota', tipo: 'texto-largo', marcador: 'Obligatoria si se anula o no se presentó' },
        ], { textoBoton: 'Guardar' });
        if (!v) return;
        await postCita(`${BASE}/api/citas/${c.id}/estado`, { estado: v.estado, nota: v.nota });
        Dialogo.hecho('Estado guardado');
      }
      await cargarCitas();
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudo', texto: e.message, tono: 'error' });
    }
  }

  // ── IMPORTAR EL EXCEL DEL TALLER ──
  // Sin preguntar nada antes: el Excel trae todo lo que hace falta. El informe
  // dice qué entró, qué cambió de hora y qué matrículas no se citan y por qué.
  function importarCitas() {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    entrada.onchange = async () => {
      const f = entrada.files && entrada.files[0];
      if (!f) return;
      const base64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
      try {
        const r = await postCita(BASE + '/api/citas/importar', { base64, nombre: f.name });
        const lista_ = xs => `<ul class="text-sm list-disc pl-5 mt-1">${xs.map(x => `<li>${x}</li>`).join('')}</ul>`;
        await Dialogo.aviso({
          titulo: 'Citas importadas', tono: 'ok', ancho: 'max-w-xl',
          html: `<p class="text-sm">${r.filas} fila(s) leídas de «${esc(r.hoja)}»: <b>${r.nuevas}</b> cita(s) nueva(s), ${r.cambiadas.length} con otra hora, ${r.iguales} igual(es).</p>
            ${r.ignoradas.length ? `<p class="text-sm mt-3 font-semibold">No se citan (${r.ignoradas.length})</p>
              ${lista_(r.ignoradas.map(x => `<span class="font-mono">${esc(x.matricula)}</span> — ${esc(x.motivo)}${x.citas > 1 ? ` (${x.citas} citas)` : ''}`))}
              <p class="text-xs text-telecab-muted mt-1">Aquí solo entran los coches de Madrid dados de alta en Vehículos.</p>` : ''}
            ${r.cambiadas.length ? `<p class="text-sm mt-3 font-semibold">Cambian de hora</p>${lista_(r.cambiadas.map(esc))}` : ''}
            ${r.noVienen.length ? `<p class="text-sm mt-3 font-semibold">Estaban y no vienen en este Excel</p>${lista_(r.noVienen.map(esc))}
              <p class="text-xs text-telecab-muted mt-1">No se anulan solas: si el taller las ha quitado, anúlalas con «Estado».</p>` : ''}
            ${r.pasadas ? `<p class="text-sm mt-3 text-telecab-muted">${r.pasadas} cita(s) de días que ya pasaron: no se importan.</p>` : ''}
            ${(r.avisos || []).length ? `<p class="text-sm mt-3 font-semibold">Avisos</p>${lista_(r.avisos.map(esc))}` : ''}`,
        });
        tramo = 'proximas';
        await cargarCitas();
      } catch (e) {
        await Dialogo.aviso({ titulo: 'No se ha importado nada', tono: 'error', ancho: 'max-w-xl',
          // El servidor junta el titular y las filas malas con « · »: se separan.
          html: (([cab, ...filas]) => `<p class="text-sm">${esc(cab)}</p>${filas.length
            ? `<ul class="text-sm list-disc pl-5 mt-2 max-h-72 overflow-y-auto">${filas.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`)(e.message.split(' · ')) });
      }
    };
    entrada.click();
  }
  if ($('#ct-importar')) $('#ct-importar').addEventListener('click', importarCitas);

  // ── UNA CITA A MANO (21/10/2026) ──
  // Camilo: «un botón en mantenimientos para poner citas de taller a mano, no
  // solamente por medio del excel». El coche, el día y la hora; desde ahí, el
  // mismo camino que las del Excel. Si el servidor no la acepta, el formulario
  // vuelve con lo escrito. Devuelve true si se puso.
  let COCHES = null;
  const aDdmm = iso => (iso ? iso.split('-').reverse().join('/') : '');
  async function nuevaCita({ vehiculoId } = {}) {
    try {
      if (!COCHES) COCHES = (await api(BASE + '/api/citas/coches')).coches;
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudieron cargar los coches', texto: e.message, tono: 'error' });
      return false;
    }
    let previo = { coche: vehiculoId ? String(vehiculoId) : '', fecha: '', hora: '', nota: '' };
    for (;;) {
      const v = await Dialogo.formulario('Nueva cita del taller', [
        { id: 'coche', etiqueta: 'Coche', tipo: 'lista', obligatorio: true, valor: previo.coche,
          opciones: COCHES.map(x => ({ valor: x.id, texto: x.matricula + (x.modelo ? ' · ' + x.modelo : '') })),
          buscador: { marcador: 'Busca la matrícula', tope: 5 } },
        { id: 'fecha', etiqueta: 'Día', tipo: 'fecha', obligatorio: true, valor: aDdmm(previo.fecha) },
        { id: 'hora', etiqueta: 'Hora', tipo: 'texto', obligatorio: true, valor: previo.hora, marcador: '09:30', max: 5 },
        { id: 'nota', etiqueta: 'Nota', tipo: 'texto-largo', valor: previo.nota, max: 300,
          marcador: 'Qué se le hace, quién la pidió… (queda en el seguimiento)' },
      ], { textoBoton: 'Poner la cita',
        nota: 'Sigue el mismo camino que las del Excel: quién lo lleva lo dice el planificador y, ' +
          DIAS_ANTES + ' días antes, el sistema le avisa por WhatsApp.' });
      if (!v) return false;
      previo = v;
      try {
        const r = await postCita(BASE + '/api/citas', { vehiculoId: v.coche, fecha: v.fecha, hora: v.hora, nota: v.nota });
        await Dialogo.aviso({ titulo: 'Cita puesta', tono: 'ok',
          html: `<p class="text-sm"><b class="font-mono">${esc(r.matricula)}</b>, ${esc(r.fechaLarga)} a las ${esc(r.hora)}.` +
            `${r.repuesta ? ' Tenía una anulada ese día: vuelve con esta hora.' : ''}</p>` +
            `<p class="text-sm mt-2 text-telecab-muted">${esc(r.aviso)}</p>` });
        tramo = 'proximas';
        await cargarCitas();
        return true;
      } catch (e) {
        await Dialogo.aviso({ titulo: 'No se ha puesto la cita', texto: e.message, tono: 'error' });
      }
    }
  }
  if ($('#ct-nueva')) $('#ct-nueva').addEventListener('click', () => {
    nuevaCita().then(ok => { if (ok) cargar().catch(() => { /* la flota se repinta en la próxima */ }); });
  });

  cargarCitas().catch(e => { $('#ct-lista').innerHTML = `<p class="px-4 py-10 text-center text-sm text-telecab-red">No se pudieron cargar las citas: ${esc(e.message)}</p>`; });
})();
