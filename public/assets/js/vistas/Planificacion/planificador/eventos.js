// El planificador · eventos — Eventos, incorporaciones y relevos: la alerta que no se va hasta aceptarla o rechazarla.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── Incorporaciones: la alerta que NO se va hasta aceptarla o rechazarla ──
  // Alguien se dio de alta con una vacante del generador. Aceptar lo coloca en
  // las plazas de la vacante (todo o nada); rechazar lo deja en el banquillo.
  async function cargarIncorporaciones() {
    let lista = [], fallo = null;
    try { lista = (await Api.get('/planificador-v2/api/incorporaciones')).incorporaciones || []; }
    catch (e) { fallo = e; }
    const cont = $('#incorporaciones');
    // LA ALERTA QUE NO SE VA NO PUEDE IRSE EN SILENCIO (03/11/2026). Si la
    // consulta fallaba, la caja se escondía como si no hubiera nadie esperando,
    // y una incorporación por aceptar se pasaba por alto sin aviso.
    if (fallo) {
      cont.classList.remove('hidden');
      cont.innerHTML = `<div class="px-4 py-3 rounded-2xl border border-telecab-red/40 bg-telecab-red/10 text-sm text-telecab-red flex items-center gap-3">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>No se pudieron leer las incorporaciones pendientes y puede haber alguien esperando: recarga la página. <span class="text-telecab-muted">${esc(fallo.message)}</span></span></div>`;
      return;
    }
    cont.classList.toggle('hidden', !lista.length);
    cont.innerHTML = lista.map(i => {
      const det = i.detalle || {};
      const mats = (det.matriculas || []).map(m =>
        `<span class="font-mono">${esc(m.m)}</span> <span class="text-telecab-muted">(${esc(m.letras || '')}${m.zona ? ' · ' + esc(m.zona) : ''})</span>`).join(' + ');
      // SIN VACANTE NO HAY NADA QUE ACEPTAR: no se le prometió ninguna plaza, así
      // que no hay un «todo o nada» que colocar. El aviso solo dice que hay
      // alguien nuevo sin coche, y se va solo en cuanto se le dé una plaza.
      const sinVacante = !i.vacanteId;
      return `<div class="px-4 py-3 rounded-2xl border ${sinVacante ? 'border-telecab-border' : 'border-telecab-gold/50'} ${sinVacante ? 'bg-telecab-card2/60' : 'bg-telecab-gold/10'} flex flex-wrap items-center gap-3">
        <i class="fa-solid ${sinVacante ? 'fa-user-plus text-telecab-muted' : 'fa-bell text-telecab-gold'}"></i>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-telecab-text"><a href="${hrefFicha(i.conductorId)}" target="_blank" rel="noopener" title="Abrir su ficha en Plantilla (otra pestaña)"
              class="hover:text-telecab-gold hover:underline underline-offset-2">${esc(i.nombre)}<i class="fa-solid fa-arrow-up-right-from-square text-[10px] ml-1.5 text-telecab-muted"></i></a>
            ${i.telefono ? `<span class="font-mono font-normal text-xs text-telecab-muted ml-1">${esc(i.telefono)}</span>` : ''}
            <span class="font-normal text-telecab-muted">— ${sinVacante ? 'se dio de alta' : 'incorporación'}${i.alta ? ' · alta ' + isoAes(i.alta) : ''}</span></div>
          <div class="text-xs text-telecab-muted mt-0.5">${sinVacante
            ? 'Sin plaza prometida: dale una en el cuadrante y este aviso desaparece.'
            : esc(det.puesto || '') + (mats ? ' → ' + mats : '')}</div>
        </div>
        ${sinVacante ? '' : `<button data-inc-ok="${esc(i.id)}" class="px-3 py-1.5 rounded-lg bg-telecab-gold text-telecab-dark text-xs font-semibold whitespace-nowrap">
          <i class="fa-solid fa-check mr-1"></i>Aceptar y colocar</button>
        <button data-inc-no="${esc(i.id)}" class="px-3 py-1.5 rounded-lg border border-telecab-border text-xs text-telecab-muted hover:border-telecab-red hover:text-telecab-red whitespace-nowrap">
          Rechazar</button>`}
      </div>`;
    }).join('');
    cont.querySelectorAll('[data-inc-ok]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await fetchPlan('/planificador-v2/api/incorporaciones/' + b.dataset.incOk + '/aceptar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dia: DIA }) });
        const j = await r.json();
        if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo colocar');
        if (j.tablero) aplicar(j.tablero);
        else cargar(DIA);
      } catch (e) {
        b.disabled = false;
        await Dialogo.aviso({ titulo: 'No se pudo colocar', texto: e.message + ' La alerta se queda hasta que lo resuelvas (o recházala y colócalo a mano).', tono: 'error' });
      }
    }));
    cont.querySelectorAll('[data-inc-no]').forEach(b => b.addEventListener('click', async () => {
      const v = await Dialogo.formulario('Rechazar la incorporación', [
        { id: 'motivo', etiqueta: 'Motivo (opcional)', tipo: 'texto' },
      ], { textoBoton: 'Rechazar', nota: 'El conductor queda en el banquillo para colocarlo a mano y la vacante vuelve a Abierta.' });
      if (v == null) return;
      try {
        const r = await fetchPlan('/planificador-v2/api/incorporaciones/' + b.dataset.incNo + '/rechazar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: v.motivo || '' }) });
        const j = await r.json();
        if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo rechazar');
        cargarIncorporaciones();
      } catch (e) {
        await Dialogo.aviso({ titulo: 'No se pudo rechazar', texto: e.message, tono: 'error' });
      }
    }));
  }

  function aplicar(j) {
    T = j;
    DIA = j.dia;
    porId.clear();
    (j.conductores || []).forEach(c => { if (c.id) porId.set(String(c.id), c); });
    $('#f-dia').value = isoAes(j.dia);
    // La base de la dirección se resuelve cuando ya se sabe qué bases hay; y si
    // la abierta desaparece (los coches sin base se colocaron), se vuelve a todas.
    if (ZONA_PEDIDA != null) { ZONA = claveDeNombre(ZONA_PEDIDA); ZONA_PEDIDA = null; }
    if (ZONA && !baseActual()) ZONA = '';
    pintarBases();
    pintarKpis();
    pintarEvento();
    pintarRelevos();
    pintarContadorFichaje();
    if (fjAbierto) pintarFichaje();
    pintar();
    pintarLaterales();
    pintarPrueba();
    pintarAvisos(j.avisos || []);
    cargarIncorporaciones();
    cargarAvisosTurnos();
  }

  // ══════════ MODO EVENTOS ══════════
  //
  // Un evento abre las dos plazas de refuerzo (CT2 día y noche) y se cierra
  // SOLO. La hora de cierre no es la del papel: es la del final del ÚLTIMO turno
  // planificado en refuerzo, y los turnos de noche mueren a las 05:00 del día
  // siguiente. Esa frase es lo que va en la franja, porque es la pregunta que se
  // hace Tráfico ("¿y cuándo vuelve esto a la normalidad?").

  const horaLarga = ts => new Date(ts).toLocaleString('es-ES', {
    weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  function pintarEvento() {
    const caja = $('#franja-evento');
    const ev = (T.eventos || {}).vigente;
    // En solo lectura el boton de eventos no esta en la pagina, pero la FRANJA
    // si se pinta: saber que hay un evento abierto es mirar, no tocar.
    const btn = $('#btn-evento');
    if (btn) {
      $('#btn-evento-txt').textContent = ev ? ev.nombre : 'Modo eventos';
      btn.classList.toggle('bg-telecab-gold', !!ev);
      btn.classList.toggle('text-telecab-dark', !!ev);
      btn.classList.toggle('font-semibold', !!ev);
      btn.classList.toggle('border-telecab-gold', !!ev);
    }

    if (!ev) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
    caja.classList.remove('hidden');
    const enRefuerzo = ev.genteRefuerzo || 0;
    caja.innerHTML = `
      <div class="rounded-2xl border border-telecab-gold/40 bg-telecab-gold/10 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-2 font-bold text-telecab-gold">
          <i class="fa-solid fa-bolt"></i>${esc(ev.nombre)}</span>
        <span class="text-sm">${isoAes(ev.desde)} → ${isoAes(ev.hasta)}</span>
        <span class="text-sm text-telecab-muted">Refuerzo abierto: <b class="text-telecab-text">CT día 2</b>
          y <b class="text-telecab-text">CT noche 2</b>${enRefuerzo ? ` · ${enRefuerzo} persona(s)` : ' · sin nadie todavía'}</span>
        <span class="text-sm ${ev.alargado ? 'text-telecab-warn' : 'text-telecab-muted'}">
          <i class="fa-solid fa-clock text-[11px]"></i>
          vuelve a la normalidad el <b>${esc(horaLarga(ev.cierraAt))}</b>${
            ev.alargado ? ' <span class="text-[11px]">(el último turno de refuerzo acaba después del evento)</span>' : ''}</span>
        ${ev.nota ? `<span class="text-[11px] text-telecab-muted italic">${esc(ev.nota)}</span>` : ''}
        <span class="ml-auto flex items-center gap-2">
          <button data-ev-wa class="px-2.5 py-1.5 rounded-lg bg-telecab-card border border-telecab-border text-xs hover:border-telecab-gold/50"
                  title="Ver el WhatsApp que recibe un conductor durante el evento, antes de mandarlo">
            <i class="fa-brands fa-whatsapp"></i> Ver aviso</button>
          <button data-ev-editar class="px-2.5 py-1.5 rounded-lg bg-telecab-card border border-telecab-border text-xs hover:border-telecab-gold/50">
            <i class="fa-solid fa-pen"></i> Fechas</button>
          <button data-ev-volver class="px-2.5 py-1.5 rounded-lg bg-telecab-card border border-telecab-border text-xs hover:border-telecab-gold/50"
                  title="Devolver el cuadrante a como estaba antes del evento (se hace solo a las 05:10, esto es para adelantarlo)">
            <i class="fa-solid fa-rotate-left"></i> Volver ya</button>
          <button data-ev-cancelar class="px-2.5 py-1.5 rounded-lg bg-telecab-red/10 border border-telecab-red/40 text-telecab-red text-xs">
            <i class="fa-solid fa-xmark"></i> Cancelar</button>
        </span>
      </div>
      ${(ev.ultimos || []).length ? `
        <p class="text-[11px] text-telecab-muted mt-1.5 pl-1">Último en salir:
          ${esc(ev.ultimos[0].conductor)} · ${esc(ev.ultimos[0].matricula)} ·
          ${esc(ev.ultimos[0].turno)} del ${isoAes(ev.ultimos[0].dia)}</p>` : ''}`;
    caja.querySelector('[data-ev-editar]').addEventListener('click', () => editarEvento(ev));
    caja.querySelector('[data-ev-cancelar]').addEventListener('click', () => cancelarEvento(ev));
    caja.querySelector('[data-ev-volver]').addEventListener('click', () => volverEvento(ev));
    caja.querySelector('[data-ev-wa]').addEventListener('click', () => verAvisoEvento(ev));
  }

  /**
   * EL WHATSAPP DEL EVENTO, ANTES DE MANDARLO.
   *
   * Durante un evento, "Ver mis turnos" no contesta con el cuadro de siempre:
   * contesta con los días del apaño, a quién entrega el coche al terminar y su
   * semana normal siguiente. Esto lo enseña tal cual, para poder leerlo antes de
   * que lo lean cien personas.
   */
  async function verAvisoEvento(ev) {
    const ejemplo = ((ev.ultimos || [])[0] || {});
    const v = await Dialogo.formulario('Ver el aviso de un conductor', [
      { id: 'telefono', etiqueta: 'Teléfono del conductor', tipo: 'texto', obligatorio: true,
        marcador: '6XXXXXXXX',
        ayuda: ejemplo.conductor ? `Por ejemplo, el de ${ejemplo.conductor}.` : 'El de cualquiera del cuadrante.' },
    ], { textoBoton: 'Ver el mensaje', ancho: 'max-w-md' });
    if (!v) return;
    try {
      const r = await fetchPlan('/planificador-v2/api/eventos/mensaje?telefono=' + encodeURIComponent(v.telefono));
      const j = await r.json();
      if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo');
      if (!j.mensaje) {
        await Dialogo.aviso({ titulo: 'Sin mensaje de evento', tono: 'aviso',
          texto: 'Con ese teléfono no sale el aviso del evento: o no lo reconozco, o no hay evento vivo. ' +
            'Recibiría el mensaje normal de turnos.' });
        return;
      }
      await Dialogo.aviso({
        titulo: 'Esto es lo que recibe por WhatsApp', ancho: 'max-w-lg',
        html: '<pre class="whitespace-pre-wrap text-[13px] leading-relaxed bg-telecab-card2/60 ' +
          'border border-telecab-border rounded-xl p-3">' + esc(j.mensaje.texto) + '</pre>',
      });
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  async function volverEvento(ev) {
    const ok = await Dialogo.confirmar({
      titulo: `¿Devolver el cuadrante a como estaba antes de "${ev.nombre}"?`,
      texto: 'Los apaños del evento se cierran y cada plaza vuelve a quien la tenía en la foto de antes. ' +
        'Lo ya trabajado no se toca. Esto pasa solo a las 05:10; el botón es para adelantarlo.',
      si: 'Devolver ya', tono: 'aviso' });
    if (!ok) return;
    try {
      const j = await pedirTablero(`/planificador-v2/api/eventos/${ev.id}/restaurar`, { dia: DIA });
      await Dialogo.aviso({ titulo: 'Cuadrante devuelto a la normalidad', tono: 'ok',
        texto: j.arreglos.length
          ? `${j.arreglos.length} plaza(s) recolocadas: ` +
            j.arreglos.slice(0, 6).map(a => `${a.matricula} → ${a.vuelve}`).join(', ') +
            (j.arreglos.length > 6 ? '…' : '')
          : 'No hizo falta mover nada: cada apaño ya tenía su fecha de vuelta puesta.' });
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  /** Lo planificado a la fuerza esta semana, con quién lo hizo y por qué. */
  function pintarRelevos() {
    const caja = $('#franja-relevos');
    const lista = T.relevos || [];
    if (!lista.length) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
    caja.classList.remove('hidden');
    caja.innerHTML = `
      <div class="rounded-2xl border border-telecab-warn/40 bg-telecab-warn/5 px-4 py-3">
        <p class="text-sm font-semibold text-telecab-warn mb-2">
          <i class="fa-solid fa-user-xmark"></i> ${lista.length} planificación(es) a la fuerza esta semana
          <span class="font-normal text-telecab-muted">· en Control saldrá quien de verdad conduce</span></p>
        <div class="space-y-1.5">
          ${lista.map(r => `
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-rel="${esc(r.id)}">
              <span class="font-mono text-xs text-telecab-muted w-20">${isoAes(r.dia)}</span>
              <span class="font-semibold">${esc(r.matricula)}</span>
              <span class="text-xs text-telecab-muted">${esc(r.turnoCodigo === 'noche' ? 'noche' : 'día')}</span>
              <span><span class="line-through text-telecab-muted">${esc(r.sale)}</span>
                <i class="fa-solid fa-arrow-right-long text-telecab-gold text-[10px] mx-1"></i>
                <b>${esc(r.entra)}</b></span>
              <span class="text-xs text-telecab-muted italic">«${esc(r.motivo)}»${r.quien ? ' — ' + esc(r.quien) : ''}</span>
              <button data-deshacer class="ml-auto px-2 py-0.5 rounded-lg border border-telecab-border text-[11px] text-telecab-muted hover:text-telecab-text">
                deshacer</button>
            </div>`).join('')}
        </div>
      </div>`;
    caja.querySelectorAll('[data-rel]').forEach(el => {
      const r = lista.find(x => x.id === el.dataset.rel);
      el.querySelector('[data-deshacer]').addEventListener('click', async () => {
        const ok = await Dialogo.confirmar({
          titulo: `¿${r.sale} vuelve a conducir ${r.matricula} el ${isoAes(r.dia)}?`,
          texto: 'Se deshace el apartado. El cuadrante vuelve a mandar ese día.', tono: 'aviso' });
        if (!ok) return;
        try { await pedirTablero(`/planificador-v2/api/relevo/${r.id}/quitar`, { dia: DIA }); }
        catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
      });
    });
  }

  async function abrirEvento() {
    const ev = (T.eventos || {}).vigente;
    if (ev) { await editarEvento(ev); return; }
    const v = await Dialogo.formulario('Modo eventos', [
      { id: 'nombre', etiqueta: 'Qué evento es', tipo: 'texto', obligatorio: true,
        marcador: 'F1 Madrid, Marcha del Orgullo, concierto…' },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', obligatorio: true, valor: isoAes(DIA) },
      { id: 'hasta', etiqueta: 'Hasta', tipo: 'fecha', obligatorio: true },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto' },
    ], {
      textoBoton: 'Abrir el refuerzo', ancho: 'max-w-lg', columnas: 2,
      nota: 'Se abren CT día 2 y CT noche 2 en todos los coches. Se cierran SOLAS cuando termine el último ' +
        'turno planificado en ellas: si el último es de noche, a las 05:00 del día siguiente.',
    });
    if (!v) return;
    try {
      const j = await pedirTablero('/planificador-v2/api/eventos', {
        nombre: v.nombre, desde: v.desde, hasta: v.hasta, nota: v.nota,
      });
      const nuevo = (j.tablero.eventos || {}).vigente;
      await Dialogo.aviso({ titulo: 'Refuerzo abierto', tono: 'ok',
        texto: nuevo
          ? `${nuevo.nombre}: ya puedes colocar gente en CT día 2 y CT noche 2. ` +
            `Vuelve a la normalidad el ${horaLarga(nuevo.cierraAt)}.`
          : 'El evento queda programado; las columnas se abren al llegar la fecha.' });
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  async function editarEvento(ev) {
    const v = await Dialogo.formulario(`Fechas de "${ev.nombre}"`, [
      { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', valor: ev.nombre },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: isoAes(ev.desde) },
      { id: 'hasta', etiqueta: 'Hasta', tipo: 'fecha', valor: isoAes(ev.hasta) },
      { id: 'nota', etiqueta: 'Nota', tipo: 'texto', valor: ev.nota },
    ], { textoBoton: 'Guardar', ancho: 'max-w-lg', columnas: 2,
         nota: 'Alargarlo o acortarlo no borra lo ya planificado en el refuerzo.' });
    if (!v) return;
    try { await pedirTablero(`/planificador-v2/api/eventos/${ev.id}`, { ...v, dia: DIA }); }
    catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  async function cancelarEvento(ev) {
    const v = await Dialogo.formulario(`Cancelar "${ev.nombre}"`, [
      { id: 'nota', etiqueta: 'Por qué se cancela', tipo: 'texto-largo', obligatorio: true },
    ], { textoBoton: 'Cancelar el evento', ancho: 'max-w-lg',
         nota: 'Lo ya trabajado se queda. Lo planificado en refuerzo que aún no ha empezado se quita, y lo que ' +
           'está en curso se cierra hoy: si no, quedarían plazas abiertas sin evento que las sostenga.' });
    if (!v) return;
    try {
      const j = await pedirTablero(`/planificador-v2/api/eventos/${ev.id}/cancelar`, { nota: v.nota, dia: DIA });
      await Dialogo.aviso({ titulo: 'Evento cancelado', tono: 'ok',
        texto: `${j.borradas} plaza(s) de refuerzo sin empezar quitadas y ${j.cerradas} cerrada(s).` });
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }
