// El planificador · paneles — Los paneles: KPIs, el semáforo de avisos, bajas, próximas incorporaciones, laterales y fin del periodo de prueba.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».

  async function cargarAvisosTurnos() {
    const mio = ++_avToken;
    AV = null;
    const off = Math.round((new Date(T.lunes + 'T00:00:00') - new Date(lunesDeIso(hoyISO()) + 'T00:00:00')) / 6048e5);
    if (off < 0 || off > 8) { pintarChipsAviso(); return; }
    try {
      const j = await (await fetchPlan('/cobertura/api/avisos-estado?semana=' + off)).json();
      if (mio !== _avToken) return;                    // llegó tarde: ya se mira otra semana
      if (j.status === 'ok') { AV = j; pintarChipsAviso(); }
    } catch (_) { /* sin registro no hay semáforo, y ya está */ }
  }

  // El chip del cuadrante: VERDE avisado, ROJO cambiado desde el aviso, gris sin
  // avisar. Se decide con la gente que tiene turnos AHORA en estos coches: si a
  // alguien le cambió la semana después del aviso (o entró alguien sin avisar),
  // el aviso ya no vale y toca reenviar.
  function chipAvisoCuadrante(lista) {
    if (!AV || !AV.conductores) return '';
    const conTurnos = new Set(AV.conTurnos || []);
    const ids = [...new Set(lista.flatMap(c => (c.personas || []).filter(p => p && p.id).map(p => String(p.id))))]
      .filter(id => conTurnos.has(id));
    if (!ids.length) return '';
    const infos = ids.map(id => AV.conductores[id]).filter(Boolean);
    const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border';
    if (!infos.length) {
      return `<span class="${base} border-telecab-border text-telecab-muted" title="A esta gente aún no se le han enviado los turnos de esta semana">
        <i class="fa-regular fa-bell"></i> Sin avisar</span>`;
    }
    const u = infos.reduce((a, b) => (b.ultimoTs > a.ultimoTs ? b : a));
    const cambiados = infos.filter(i => i.cambiado).length;
    const sinAviso = ids.length - infos.length;
    const veces = Math.max(...infos.map(i => i.veces));
    // A quién de este cuadrante se le ha avisado más veces, y de quién eran
    // esos avisos (12/11/2026). «×6» con el nombre del último se leía como «lo
    // mandó él seis veces».
    const masAvisado = infos.reduce((a, b) => (b.veces > a.veces ? b : a));
    const reparto = masAvisado.porUsuario || [];
    const ultimoPila = String(u.ultimoPor || '').split(' ')[0];
    const otros = reparto.filter(x => x.pila !== ultimoPila);
    const cuantas = veces > 1
      ? ` · ${veces} envíos esta semana` + (otros.length ? ` (${otros.map(x => `${x.veces} de ${x.pila}`).join(', ')})` : '')
      : '';
    const idMas = ids.find(id => AV.conductores[id] === masAvisado);
    const masAvisadoNombre = (idMas && (porId.get(idMas) || {}).nombre) || '';
    const detalleQuien = veces > 1 && reparto.length
      ? ` A quien más se le ha avisado esta semana${masAvisadoNombre ? ' (' + masAvisadoNombre + ')' : ''}: ${veces} veces, ${reparto.map(x => `${x.veces} de ${x.nombre}`).join(', ')}.`
      : '';
    if (cambiados || sinAviso) {
      const que = [cambiados ? `${cambiados} con los turnos CAMBIADOS desde el aviso` : '',
                   sinAviso ? `${sinAviso} sin avisar` : ''].filter(Boolean).join(' y ');
      return `<span class="${base} bg-telecab-red/15 text-telecab-red border-telecab-red/40"
        title="${esc(`El cuadrante cambió después de avisar: ${que}. Último aviso ${u.ultimoAt}${u.ultimoPor ? ' por ' + u.ultimoPor : ''}. Toca volver a enviar los turnos.`)}">
        <i class="fa-solid fa-triangle-exclamation"></i> Cambiado · reavisar</span>`;
    }
    return `<span class="${base} bg-telecab-green/15 text-telecab-green border-telecab-green/40"
      title="${esc(`Último aviso ${u.ultimoAt}${u.ultimoPor ? ' por ' + u.ultimoPor : ''}, sin cambios desde entonces.${detalleQuien}`)}">
      <i class="fa-solid fa-check"></i> Avisado ${esc(u.ultimoAt)}${u.ultimoPor ? ' · ' + esc(u.ultimoPor) : ''}${esc(cuantas)}</span>`;
  }

  // EL CHIP VA EN SU PROPIO HUECO (03/11/2026). El semáforo llega aparte y
  // después del tablero; antes, al llegar, se repintaba el cuadrante ENTERO
  // solo para cambiar estos chips (unos 80 ms de pantalla congelada en cada
  // guardado). Ahora se rellena el hueco y nada más. `contents` hace que el
  // envoltorio no cuente en la fila: el chip sigue siendo un hijo más del flex.
  const huecoChipAviso = lista => `<span data-chip-aviso class="contents">${chipAvisoCuadrante(lista)}</span>`;
  const guardarListaChip = (cab, lista) => { const h = cab.querySelector('[data-chip-aviso]'); if (h) h._lista = lista; };
  function pintarChipsAviso() {
    document.querySelectorAll('#cuadrante [data-chip-aviso]').forEach(h => { h.innerHTML = chipAvisoCuadrante(h._lista || []); });
  }

  // ── KPIs y subtítulo ────────────────────────────────────────────────────────
  function pintarKpis() {
    // Con una base abierta, las MISMAS tarjetas con los números de esa base
    // (`resumen.porZona`, iceberg.js), contados con la misma regla que el total.
    const r = resumenActual();
    const b = baseActual();
    $('#k-ambito').textContent = b ? b.zona : 'Todas las bases';
    $('#k-ambito-sub').textContent = b
      ? `${b.cochesTotal} coche${b.cochesTotal === 1 ? '' : 's'} · ${b.cuadrantes} cuadrante${b.cuadrantes === 1 ? '' : 's'}` +
        (b.cochesTotal ? ` · ${fmtH(b.iceberg.horas)} h instaladas esta semana` : '')
      : 'Las tarjetas cuentan toda la flota. Elige una base para ver solo la suya.';
    $('#k-ambito-sub').title = b && b.cochesTotal
      ? 'Horas instaladas: por cada día y turno de la semana, el promedio de horas por día trabajado de quien lo cubre (su calificación), sumado en los coches que ruedan.'
      : '';
    $('#b-todas').classList.toggle('hidden', !ZONA);
    $('#b-todas').classList.toggle('inline-flex', !!ZONA);
    $('#k-coches').textContent = r.coches ?? '—';
    // El bruto grande, el neto al lado. El neto SOLO se pinta si difiere: cuando
    // no hay nadie de vacaciones, repetir el mismo número dos veces es ruido.
    const par = (id, bruto, neto) => {
      $('#' + id).textContent = bruto ?? '—';
      const n = $('#' + id + '-n');
      const hay = bruto != null && neto != null && neto !== bruto;
      n.textContent = hay ? '· ' + neto : '';
      n.title = hay ? `${bruto - neto} de vacaciones o de baja` : '';
    };
    par('k-fd', r.fijoDia, r.fijoDiaNeto);
    par('k-fn', r.fijoNoche, r.fijoNocheNeto);
    par('k-ctd', r.ctDia, r.ctDiaNeto);
    par('k-ctn', r.ctNoche, r.ctNocheNeto);
    par('k-flojos', r.ctFlojos, r.ctFlojosNeto);
    // Quién cuenta sin tener plaza HOY porque llega a una plaza VACÍA (28/09/2026):
    // en el 1194LCK sin fijo, Jonathan ya cuenta; quien llega a una plaza ocupada,
    // no (el 0431MMZ son dos fijos aunque salgan cuatro nombres).
    [['k-fd', 'fijoDia'], ['k-fn', 'fijoNoche'], ['k-ctd', 'ctDia'], ['k-ctn', 'ctNoche']].forEach(([id, k]) => {
      const xs = (r.llegan || []).filter(x => x.tarjeta === k);
      const caja = $('#' + id).closest('div, button');
      if (caja) caja.title = xs.length
        ? 'Incluye a quien llega a una plaza vacía:\n' + xs.map(x => `· ${x.nombre} → ${x.plazas}, desde el ${isoAes(x.desde)}`).join('\n')
        : '';
    });
    // Sin ninguno, la tarjeta deja de gritar: el rojo tiene que significar algo.
    const caja = $('#k-flojos-caja');
    caja.classList.toggle('border-telecab-red/60', (r.ctFlojos || 0) > 0);
    caja.classList.toggle('bg-telecab-red/5', (r.ctFlojos || 0) > 0);
    $('#k-flojos').classList.toggle('text-telecab-red', (r.ctFlojos || 0) > 0);
    $('#k-flojos').classList.toggle('text-telecab-muted', (r.ctFlojos || 0) === 0);
    // Las dos tarjetas cuentan CÓMO QUEDA cada plaza con todo lo ya escrito
    // (28/09/2026): vacía hoy con su próximo dueño planificado no falta, llega;
    // ocupada hoy por alguien que se va sin relevo, sí falta. Debajo se dice
    // cuántas de cada; al pasar el ratón, quién, dónde y cuándo.
    const plan = r.planificados || [], van = r.seVan || [];
    const de = (xs, rol) => xs.filter(p => p.rol === rol);
    const lineaPlan = p => `· ${p.matricula} ${String(p.turno || '').toLowerCase()} → ${p.nombre}, desde el ${isoAes(p.desde)}` +
      (p.dias ? ` (${p.dias} días)` : '');
    const lineaVa = p => `· ${p.matricula} ${String(p.turno || '').toLowerCase()}: ${p.nombre} hasta el ${isoAes(p.hasta)}`;
    const detalle = rol => [
      de(plan, rol).length ? `${de(plan, rol).length} ya planificada(s)` : '',
      de(van, rol).length ? `${de(van, rol).length} se queda(n) vacía(s)` : '',
    ].filter(Boolean).join(' · ');
    const ayuda = rol => (de(plan, rol).length ? '\n\nNo cuentan, porque ya tienen a alguien planificado:\n' + de(plan, rol).map(lineaPlan).join('\n') : '') +
      (de(van, rol).length ? '\n\nSí cuentan, aunque hoy estén ocupadas, porque se quedan sin nadie:\n' + de(van, rol).map(lineaVa).join('\n') : '');
    const fijoFalta = (r.fijosQueFaltanDia || 0) + (r.fijosQueFaltanNoche || 0);
    $('#k-fijofalta').textContent = fijoFalta;
    $('#k-fijofalta-sub').textContent = ['plazas de fijo sin nadie', detalle('FIJO')].filter(Boolean).join(' · ');
    $('#k-fijofalta').parentElement.title =
      `${r.fijosQueFaltanDia || 0} de día y ${r.fijosQueFaltanNoche || 0} de noche: plazas de fijo sin nadie, ` +
      'contando lo que ya está planificado para más adelante.' + ayuda('FIJO');
    const ctFalta = (r.ctQueFaltanDia || 0) + (r.ctQueFaltanNoche || 0);
    $('#k-ct').textContent = ctFalta;
    $('#k-ct-sub').textContent = ['solo de coches con su fijo', detalle('CT')].filter(Boolean).join(' · ');
    $('#k-ct').parentElement.title =
      `${r.ctQueFaltanDia || 0} de día y ${r.ctQueFaltanNoche || 0} de noche. ` +
      'Son los días que libra un fijo y NADIE tiene escritos en su cuadrante, contando lo que ya está planificado ' +
      'para más adelante, a seis días por correturnos. No mira la semana que tengas abierta: un día ya pasado no es un hueco. ' +
      'Y solo de coches que tienen su fijo (o lo tienen planificado): un coche sin fijo necesita un fijo, no un correturnos.' + ayuda('CT');
    $('#k-huerf').textContent = b ? (r.huerfanos || 0) : (T.huerfanos || []).length;
    $('#k-banq').textContent = (T.pendientes || []).length;
    // La gente no tiene base hasta que se le da coche: el banquillo es de todas.
    $('#k-banq').parentElement.title = b ? 'El banquillo es de todas las bases: la gente no tiene base hasta que se le da un coche.' : '';
    const semana = (T.fechas && T.fechas.length) ? `${isoAes(T.fechas[0])} – ${isoAes(T.fechas[6])}` : '';
    $('#sub').textContent = `Semana ${semana} · efectivo desde el ${isoAes(T.dia)}`;
  }
  // «NSPP» es jerga de RRHH: se dice al lado qué significa.
  const glosaMotivo = m => (/\bNSPP\b/i.test(m) ? ' (no superó el periodo de prueba)' : '');
  const MOTIVO_LLEGADA = {
    nuevo:       { texto: 'Nuevo',                 cls: 'bg-telecab-green/15 text-telecab-green border-telecab-green/30' },
    vacaciones:  { texto: 'Vuelve de vacaciones',  cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
    baja_medica: { texto: 'Vuelve de baja médica', cls: 'bg-telecab-violet/15 text-telecab-violet border-telecab-violet/30' },
  };
  const diaYMes = iso => isoAes(iso).slice(0, 5);

  function pintarLlegadas() {
    // Con una base abierta, solo quien entra en un coche de esa base.
    const lista = (T.proximasIncorporaciones || [])
      .filter(p => !ZONA || (p.plazas || []).some(x => (x.zonaClave || SIN_BASE) === ZONA));
    $('#panel-llegadas').classList.toggle('hidden', lista.length === 0);
    $('#llegadas-n').textContent = lista.length || '';
    $('#llegadas').innerHTML = lista.map(p => {
      const abierta = llegadasAbiertas.has(p.conductorId);
      const m = MOTIVO_LLEGADA[p.motivo] || MOTIVO_LLEGADA.nuevo;
      const coches = [...new Set((p.plazas || []).map(x => x.matricula))].join(' · ');
      // Un botón por cuadrante distinto; sin cuadrante, se va a su coche.
      const destinos = [];
      (p.plazas || []).forEach(x => {
        const k = x.cuadranteId || ('v' + x.vehiculoId);
        if (!destinos.some(d => d.k === k)) destinos.push({ k, ...x });
      });
      const botones = destinos.map(d => `
        <button type="button" data-ir-cuadrante="${esc(d.cuadranteId)}" data-ir-vehiculo="${esc(d.vehiculoId)}" data-ir-zona="${esc(d.zonaClave)}"
                class="tc-pulsable inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-telecab-gold/40 text-telecab-gold hover:bg-telecab-gold/10">
          <i class="fa-solid fa-arrow-right text-[10px]"></i>${destinos.length > 1
            ? 'Ver ' + esc(d.cuadrante || d.matricula)
            : (d.cuadranteId ? 'Ver su cuadrante' : 'Ver su coche')}</button>`).join('');
      const fila = (etq, valor) => `<p><span class="text-telecab-muted">${etq}:</span> <span class="font-medium">${valor}</span></p>`;
      const plazas = (p.plazas || []).map(x => `
        <div class="rounded-md bg-telecab-card2/60 px-2 py-1">
          <p class="font-medium">${esc(x.matricula)} · ${esc(x.esFijo ? 'Fijo' : 'CT')} ${esc(String(x.puesto || '').replace(/^\S+\s/, ''))}</p>
          <p class="text-telecab-muted">${esc(x.cuadrante || 'Sin cuadrante')}${x.zona ? ' · ' + esc(x.zona) : ''}${
            x.desde !== p.desde ? ' · desde el ' + esc(diaYMes(x.desde)) : ''}</p>
        </div>`).join('');
      const detalle = p.motivo === 'nuevo'
        ? (p.alta ? fila('Alta', esc(isoAes(p.alta))) : '')
        : fila('Fuera', `${esc((m.texto.replace('Vuelve de ', '')))} del ${esc(diaYMes(p.ausencia.desde))}` +
                        `${p.ausencia.hasta ? ' al ' + esc(diaYMes(p.ausencia.hasta)) : ', sin fecha de vuelta'}`) +
          fila('Antes', (p.antes && p.antes.cuadrantes.length)
            ? esc(p.antes.cuadrantes.join(', ')) + (p.antes.matriculas.length ? ` <span class="text-telecab-muted">(${esc(p.antes.matriculas.join(', '))})</span>` : '')
            : (p.antes && p.antes.matriculas.length ? esc(p.antes.matriculas.join(', ')) + ' <span class="text-telecab-muted">(sin cuadrante)</span>' : 'sin coche'));
      return `
        <div class="rounded-lg bg-telecab-card border border-telecab-border">
          <button type="button" data-llegada="${esc(p.conductorId)}" aria-expanded="${abierta}"
                  class="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-lg hover:bg-telecab-card2 transition-colors">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">${esc(p.nombre)}</div>
              <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                <span class="inline-flex px-1.5 rounded border text-[10px] font-semibold ${m.cls}">${esc(m.texto)}</span>
                <span class="text-[11px] text-telecab-muted">entra el ${esc(diaYMes(p.desde))} · ${esc(coches)}</span>
              </div>
            </div>
            <i class="fa-solid fa-chevron-down text-[10px] text-telecab-muted transition-transform ${abierta ? 'rotate-180' : ''}"></i>
          </button>
          <div class="px-2 pb-2 text-xs space-y-1 ${abierta ? '' : 'hidden'}">
            ${fila('Teléfono', p.telefono ? `<span class="font-mono tabular-nums">${esc(p.telefono)}</span>` : '<span class="text-telecab-warn">sin teléfono</span>')}
            ${fila('Incorporación', esc(isoAes(p.desde)))}
            ${detalle}
            <div class="space-y-1">${plazas}</div>
            <div class="flex flex-wrap gap-1.5 pt-1">${botones}${botonFicha(p.conductorId)}</div>
          </div>
        </div>`;
    }).join('');
  }

  /**
   * «Ver su cuadrante»: lleva la vista a su cuadrante (o a su coche, si no está
   * en ninguno) y lo marca un momento. Si el buscador o «solo con huecos» lo
   * esconderían, se quitan; si hay otra base abierta, se abre la suya.
   */
  function irAlCuadrante({ cuadranteId, vehiculoId, zonaClave }) {
    let repintar = false;
    if (plano($('#f-busca').value).trim()) { $('#f-busca').value = ''; repintar = true; }
    if ($('#f-huecos').checked) { $('#f-huecos').checked = false; repintar = true; }
    if (ZONA && ZONA !== (zonaClave || SIN_BASE)) elegirBase(zonaClave || SIN_BASE);
    else if (repintar) pintar();
    const destino = document.querySelector(cuadranteId
      ? `[data-cuadrante="${CSS.escape(cuadranteId)}"]` : `[data-vehiculo="${CSS.escape(vehiculoId)}"]`);
    if (!destino) {
      Dialogo.aviso({ titulo: 'No está a la vista', tono: 'aviso',
        texto: 'Ese cuadrante no sale en la semana que estás mirando. Prueba con «Hoy».' });
      return;
    }
    const suave = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    destino.scrollIntoView({ block: 'start', behavior: suave ? 'smooth' : 'auto' });
    const coche = cuadranteId && vehiculoId ? destino.querySelector(`[data-vehiculo="${CSS.escape(vehiculoId)}"]`) : null;
    [destino, coche].filter(Boolean).forEach(el => {
      el.classList.add('tc-resalte');
      setTimeout(() => el.classList.remove('tc-resalte'), 2600);
    });
  }

  function pintarBajas() {
    const B = T.bajasRecientes || { dias: 5, lista: [] };
    const lista = B.lista || [];
    $('#panel-bajas').classList.toggle('hidden', lista.length === 0);
    $('#bajas-tit').textContent = `Bajas · últimos ${B.dias} días`;
    $('#bajas-n').textContent = lista.length || '';
    $('#bajas').innerHTML = lista.map(b => {
      const abierta = bajasAbiertas.has(b.conductorId);
      const contrato = b.tipo === 'ett' ? `ETT${b.ett ? ' ' + b.ett : ''}` : 'Plantilla propia';
      const coche = b.matricula ? `${b.matricula}${b.turno ? ' · ' + b.turno : ''}` : 'sin coche';
      const motivo = b.motivo
        ? `<p><span class="text-telecab-muted">Motivo:</span> <span class="font-medium">${esc(b.motivo)}</span>${esc(glosaMotivo(b.motivo))}</p>`
        : '<p class="text-telecab-warn" title="Al darle de baja no se apuntó el motivo.">Sin motivo apuntado</p>';
      return `
        <div class="rounded-lg bg-telecab-card border border-telecab-border">
          <button type="button" data-baja="${esc(b.conductorId)}" aria-expanded="${abierta}"
                  class="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-lg hover:bg-telecab-card2 transition">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">${esc(b.nombre)}</div>
              <div class="text-[11px] text-telecab-muted">Baja el ${esc(isoAes(b.baja).slice(0, 5))} · ${esc(coche)}</div>
            </div>
            <i class="fa-solid fa-chevron-down text-[10px] text-telecab-muted transition-transform ${abierta ? 'rotate-180' : ''}"></i>
          </button>
          <div class="px-2 pb-2 text-xs space-y-0.5 ${abierta ? '' : 'hidden'}">
            ${motivo}
            <p class="text-telecab-muted">${esc(contrato)} · baja el ${esc(isoAes(b.baja))}</p>
            ${VER_FICHAS ? `<div class="pt-1">${botonFicha(b.conductorId)}</div>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // ── Paneles laterales ─────────────────────────────────────────────────────
  function pintarLaterales() {
    // Huérfanos: con una base abierta, los de esa base (lo mismo que su tarjeta).
    const huerf = (T.huerfanos || []).filter(h => !ZONA || (h.zonaClave || SIN_BASE) === ZONA);
    $('#panel-huerfanos').classList.toggle('hidden', huerf.length === 0);
    $('#huerfanos').innerHTML = huerf.map(h => `
      <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-telecab-card border border-telecab-border">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium truncate">${nombreConFicha(h.conductorId, h.conductor)}</div>
          <div class="text-[11px] text-telecab-muted">${esc(h.matricula)} · ${esc(h.estado)} · ${esc(h.turno)}</div>
        </div>
      </div>`).join('');

    // Emergencia
    const emer = T.emergencia || [];
    $('#panel-emergencia').classList.toggle('hidden', emer.length === 0);
    $('#emergencia').innerHTML = emer.map(e => `
      <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-telecab-gold/10 text-telecab-gold border border-telecab-gold/30">
        <i class="fa-solid fa-car-side"></i>${esc(e.matricula)}${e.zona ? ` <span class="text-telecab-muted">${esc(e.zona)}</span>` : ''}
      </span>`).join('');

    pintarLlegadas();
    pintarBajas();
    pintarBanquillo();
    pintarAusentes();
  }

  /**
   * Los que NO se pueden planificar hoy, en sus propias tarjetas.
   *
   * Están fuera del banquillo a propósito: el banquillo es la lista de a quién
   * puedo poner en un coche, y mezclar ahí a quien está de vacaciones obliga a
   * leérsela entera para saber quién sirve. Pero tienen que verse —el de baja
   * médica antes no salía en ninguna parte y su ausencia no se explicaba sola.
   */
  function pintarAusentes() {
    const pinta = (lista, idPanel, idLista, idNum, conFecha) => {
      const l = lista || [];
      $('#' + idPanel).classList.toggle('hidden', !l.length);
      $('#' + idNum).textContent = l.length;
      $('#' + idLista).innerHTML = l.map(p => `
        <div class="px-2 py-1.5 rounded-lg bg-telecab-card2/40 border border-telecab-border/70">
          <div class="text-sm truncate">${nombreConFicha(p.id, p.nombre)}</div>
          <div class="text-[11px] text-telecab-muted">${esc(p.estado || '')}${
            conFecha && p.vuelveEl ? ` · vuelve <span class="text-telecab-gold">${isoAes(p.vuelveEl)}</span>` : ''
          }${p.turno ? ' · ' + esc(p.turno) : ''}</div>
        </div>`).join('');
    };
    pinta(T.ausentesConVuelta, 'panel-vuelven', 'vuelven', 'vuelven-n', true);
    pinta(T.ausentesSinFecha, 'panel-sinfecha', 'sinfecha', 'sinfecha-n', false);
  }
  function pintarBanquillo() {
    const q = ($('#banq-busca').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const gente = (T.pendientes || []).filter(p => {
      if (banqTab === 'ett' && !p.esEtt) return false;
      if (banqTab === 'propios' && p.esEtt) return false;
      if (!q) return true;
      // También por el contrato: escribir «40x4» deja solo a los de cuatro días.
      const t = (p.nombre + ' ' + (p.dni || '') + ' ' + (p.ettNombre || '') + ' ' + (p.telefono || '') + ' ' + (p.barrio || '') + ' ' + (p.turno || '') + ' ' + (p.contrato || '') + ' ' + ((p.rendimiento && p.rendimiento.letra) || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return t.includes(q);
    });
    document.querySelectorAll('.banq-tab').forEach(b => {
      const on = b.dataset.banqTab === banqTab;
      b.className = 'banq-tab px-2.5 py-1 rounded-lg text-xs font-semibold border transition ' +
        (on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold' : 'bg-telecab-card border-telecab-border text-telecab-muted hover:border-telecab-gold/40');
    });
    $('#banq-n').textContent = `${gente.length}/${(T.pendientes || []).length}`;
    $('#banquillo').innerHTML = gente.length ? gente.map(p => `
      <div class="px-2 py-1.5 rounded-lg bg-telecab-card2/50 border border-telecab-border">
        <div class="text-sm font-medium truncate">${nombreConFicha(p.id, p.nombre)}${p.esEtt ? ` <span class="text-telecab-violet text-xs">ETT${p.ettNombre ? ' ' + esc(p.ettNombre) : ''}</span>` : ''} ${chipRend(p.rendimiento)}</div>
        <div class="text-[11px] text-telecab-muted">${p.telefono ? `<span class="font-mono tabular-nums">${esc(p.telefono)}</span> · ` : ''}${esc(p.turno || 'sin turno')}${p.contrato ? ' · ' + esc(p.contrato) : ''}${p.boltPendiente ? ' · <span class="text-telecab-warn">sin BOLT</span>' : ''}</div>
        ${p.faltanDias ? `<div class="text-[11px] text-telecab-gold"><i class="fa-solid fa-calendar-day text-[9px]"></i> correturnos a medio poner: ${p.diasPuestos} de ${p.diasQueDebeCT} días${
          (p.diasDePlaza || []).length ? ` (lleva ${p.diasDePlaza.map(d => 'LMXJVSD'[d - 1] || '?').join('')})` : ''}</div>` : ''}
        ${p.llega ? `<div class="text-[11px] text-telecab-violet"><i class="fa-solid fa-arrow-right-to-bracket text-[9px]"></i> ya entra el ${isoAes(p.llega.desde)} en ${esc(p.llega.matriculas.join(' · '))}</div>` : ''}
        <button data-barrio="${p.id}" class="block text-[11px] text-left ${p.barrio ? 'text-telecab-gold/80' : 'text-telecab-muted/50'} hover:text-telecab-gold transition"><i class="fa-solid fa-house text-[9px]"></i> ${p.barrio ? esc(p.barrio) : 'poner zona'}</button>
        ${p.ausente ? `<div class="text-[11px] text-telecab-warn"><i class="fa-solid fa-plane-departure"></i> ${esc(p.estado)}${p.vuelveEl ? ` · vuelve ${isoAes(p.vuelveEl)}` : ''}</div>` : ''}
      </div>`).join('') : '<p class="text-xs text-telecab-muted text-center py-4">Nadie en el banquillo.</p>';
    $('#banquillo').querySelectorAll('[data-barrio]').forEach(b => b.addEventListener('click', () => {
      const c = porId.get(String(b.dataset.barrio));
      if (c) editarBarrio(c);
    }));
  }

  function pintarAvisos(avisos) {
    const btn = $('#btn-avisos');
    btn.classList.toggle('hidden', !avisos.length);
    btn.classList.toggle('flex', avisos.length > 0);
    $('#btn-avisos-n').textContent = avisos.length;
    const cont = $('#avisos');
    if (!avisos.length) { cont.classList.add('hidden'); return; }
    cont.innerHTML = `
      <div class="rounded-2xl border border-telecab-warn/30 bg-telecab-warn/5 p-3">
        <ul class="space-y-1 text-sm">${avisos.map(a => `<li class="flex items-start gap-2"><i class="fa-solid fa-circle text-[5px] mt-2 text-telecab-warn"></i><span>${esc(a.msg)}</span></li>`).join('')}</ul>
      </div>`;
  }

  // ── Fin del periodo de prueba, del más próximo al más lejano ──────────────
  // Los 3 meses de convenio desde el alta (o la fecha apuntada, si la hay). Solo
  // quienes SIGUEN en prueba: para ver venir a quién hay que decidirle pronto.
  function pintarPrueba() {
    const hoy = hoyISO();
    const lista = (T.conductores || [])
      .filter(c => c.finPrueba && c.finPrueba >= hoy)
      .sort((a, b) => a.finPrueba.localeCompare(b.finPrueba));
    $('#prueba-n').textContent = lista.length ? `${lista.length}` : '';
    const dias = f => Math.round((new Date(f + 'T00:00:00') - new Date(hoy + 'T00:00:00')) / 864e5);
    $('#prueba-lista').innerHTML = lista.length ? lista.map(c => {
      const n = dias(c.finPrueba);
      const tono = n <= 14 ? 'text-telecab-warn' : 'text-telecab-muted';
      return `<div class="px-2 py-1.5 rounded-lg bg-telecab-card2/50 border border-telecab-border flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm truncate">${esc(c.nombre)}${c.esEtt ? ' <span class="text-telecab-violet text-xs">ETT</span>' : ''}</div>
          <div class="text-[11px] text-telecab-muted">${c.alta ? 'alta ' + isoAes(c.alta) : ''}${c.barrio ? ' · ' + esc(c.barrio) : ''}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-xs font-semibold tabular-nums ${tono}">${isoAes(c.finPrueba)}</div>
          <div class="text-[11px] ${tono}">${n === 0 ? 'hoy' : 'en ' + n + ' día' + (n === 1 ? '' : 's')}</div>
        </div>
      </div>`;
    }).join('') : '<p class="text-xs text-telecab-muted text-center py-3">Nadie en periodo de prueba.</p>';
  }
