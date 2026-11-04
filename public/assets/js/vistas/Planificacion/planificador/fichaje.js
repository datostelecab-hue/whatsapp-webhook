// El planificador · fichaje — Quién ficha con el bot (el bloqueo de motor) desde el planificador.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  const llaveFichaje = persona => (persona && persona.fichaCoche
    ? ' <i class="fa-solid fa-key text-[10px] text-telecab-gold" title="Bloqueo de motor encendido: al terminar su turno se le bloquea el coche"></i>'
    : '');

  const fichan = () => (T && T.conductores ? T.conductores.filter(c => c.fichaCoche) : []);

  function pintarContadorFichaje() {
    const n = $('#btn-fichaje-n');
    if (n) n.textContent = fichan().length ? `· ${fichan().length}` : '';
  }

  // Con quién comparte coche esta semana: los que salen en sus coches y NO fichan.
  function companerosSinFichaje(c) {
    const out = new Map();
    (T.coches || []).forEach(coche => {
      const ps = (coche.personas || []).filter(x => x && x.id);
      if (!ps.some(x => String(x.id) === String(c.id))) return;
      ps.forEach(x => {
        if (String(x.id) === String(c.id)) return;
        const q = porId.get(String(x.id));
        if (q && !q.fichaCoche) out.set(String(q.id), { nombre: q.nombre, matricula: coche.matricula });
      });
    });
    return [...out.values()];
  }

  async function fjPost(url, cuerpo) {
    const r = await fetchPlan(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status !== 'ok') throw new Error(j.msg || 'Error ' + r.status);
    return j;
  }

  async function abrirFichaje() {
    fjAbierto = !fjAbierto;
    $('#panel-fichaje').classList.toggle('hidden', !fjAbierto);
    if (fjAbierto) await cargarFichaje();
  }

  async function cargarFichaje() {
    try {
      const r = await fetchPlan('/planificador-v2/api/fichaje');
      const j = await r.json();
      if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo leer');
      FJ = j;
    } catch (e) { FJ = { error: e.message }; }
    pintarFichaje();
  }

  function filaConductor(c) {
    const sin = c.fichaCoche ? companerosSinFichaje(c) : [];
    const aviso = sin.length
      ? `<span class="block text-[11px] text-telecab-warn" title="El motor se bloquea por coche. Mientras quien comparte coche con él no tenga el bloqueo, al terminar su turno el motor se queda libre.">
           <i class="fa-solid fa-lock-open text-[9px]"></i> ${esc(sin.map(x => x.matricula).filter((v, i, a) => a.indexOf(v) === i).join(', '))}
           también lo lleva ${esc(sin.map(x => x.nombre).join(', '))}, sin bloqueo: el motor se quedará libre</span>`
      : '';
    return `
      <label class="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-telecab-card2/60 cursor-pointer">
        <input type="checkbox" data-fj-conductor="${esc(c.id)}" ${c.fichaCoche ? 'checked' : ''}
               class="w-4 h-4 mt-0.5 accent-telecab-gold shrink-0">
        <span class="min-w-0">
          <span class="block text-sm font-medium truncate">${esc(c.nombre)}</span>
          <span class="block text-[11px] text-telecab-muted">${c.telefono
            ? `<span class="font-mono tabular-nums">${esc(c.telefono)}</span>`
            : '<span class="text-telecab-red">sin teléfono: no podrá usar el bot</span>'}${c.turno ? ' · ' + esc(c.turno) : ''}</span>
          ${aviso}
        </span>
      </label>`;
  }

  function pintarFichaje() {
    const caja = $('#panel-fichaje');
    if (!caja || !fjAbierto) return;
    if (!FJ) { caja.innerHTML = '<div class="rounded-2xl border border-telecab-border bg-telecab-card p-4 text-sm text-telecab-muted">Cargando…</div>'; return; }
    if (FJ.error) {
      caja.innerHTML = `<div class="rounded-2xl border border-telecab-red/40 bg-telecab-red/10 p-4 text-sm text-telecab-red">No se pudo leer el fichaje: ${esc(FJ.error)}</div>`;
      return;
    }
    const activos = fichan().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const q = fjBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const candidatos = q.length < 2 ? [] : (T.conductores || [])
      .filter(c => !c.fichaCoche)
      .filter(c => ((c.nombre || '') + ' ' + (c.telefono || '') + ' ' + (c.dni || '')).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q))
      .slice(0, 12);
    const empresa = (FJ.activados || []).filter(x => x.de === 'usuario');
    const abiertos = FJ.abiertos || [];

    caja.innerHTML = `
      <div class="rounded-2xl border border-telecab-border bg-telecab-card p-4 space-y-4">
        <div class="flex flex-wrap items-start gap-3">
          <div class="flex-1 min-w-[240px]">
            <div class="font-semibold flex items-center gap-2"><i class="fa-solid fa-key text-telecab-gold"></i> Turnos por WhatsApp y bloqueo de motor</div>
            <p class="text-xs text-telecab-muted mt-0.5 max-w-3xl">
              Todo conductor de alta abre su turno escribiendo la <b class="text-telecab-text">matrícula</b> al WhatsApp de la
              empresa: se le suelta el motor. En el cambio de turno pulsa <b class="text-telecab-text">Entregar coche</b> justo antes
              de salir hacia donde entrega el coche. Al terminar, el motor solo se bloquea a quien está marcado aquí, y solo si
              <b class="text-telecab-text">todos</b> los que llevan ese coche hoy y mañana lo están.</p>
          </div>
          ${FJ.bloqueoActivo
            ? '<span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-500" title="FICHAJE_BLOQUEO_MOTOR está a 1 en el servidor">Corte de motor encendido</span>'
            : '<span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-telecab-warn/15 text-telecab-warn" title="FICHAJE_BLOQUEO_MOTOR no está a 1 en Render: se apuntan los turnos, pero no se bloquea ningún motor">Corte de motor apagado en el servidor</span>'}
          <button data-fj-cerrar class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-text" title="Plegar"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="grid lg:grid-cols-3 gap-4">
          <section class="min-w-0">
            <h3 class="text-[11px] uppercase tracking-wide text-telecab-muted mb-1.5">Con bloqueo de motor · ${activos.length}</h3>
            <div class="space-y-0.5 max-h-80 overflow-y-auto">${activos.length ? activos.map(filaConductor).join('')
              : '<p class="text-xs text-telecab-muted px-2 py-3">Nadie todavía. Búscalo abajo y márcalo.</p>'}</div>
            <input data-fj-busca value="${esc(fjBusca)}" placeholder="Buscar a alguien para activarle el bloqueo…" aria-label="Buscar conductor para activarle el bloqueo"
                   class="mt-2 w-full px-3 py-2 rounded-xl bg-telecab-dark border border-telecab-border text-sm">
            ${candidatos.length ? `<div class="mt-1 space-y-0.5">${candidatos.map(filaConductor).join('')}</div>`
              : (q.length >= 2 ? '<p class="text-xs text-telecab-muted px-2 py-2">Nadie más con ese nombre en la plantilla.</p>' : '')}
          </section>

          <section class="min-w-0">
            <h3 class="text-[11px] uppercase tracking-wide text-telecab-muted mb-1.5">Ahora mismo · ${abiertos.length}</h3>
            ${abiertos.length ? `<ul class="space-y-1">${abiertos.map(a => `
              <li class="px-2 py-1.5 rounded-lg bg-telecab-card2/50 text-sm">
                <span class="font-medium">${esc(a.nombre)}</span>
                <span class="text-telecab-muted"> · ${a.tipo === 'viaje' ? 'viaje' : 'turno'} en <b class="text-telecab-text">${esc(a.matricula)}</b> desde el ${esc(a.desde)}</span>
                ${a.relevo ? `<span class="block text-[11px] text-sky-400"><i class="fa-solid fa-rotate text-[9px]"></i> salió a entregar el coche el ${esc(a.relevo)}</span>` : ''}
              </li>`).join('')}</ul>`
              : '<p class="text-xs text-telecab-muted px-2 py-3">Nadie tiene un turno ni un viaje abierto.</p>'}
            <h3 class="text-[11px] uppercase tracking-wide text-telecab-muted mt-4 mb-1.5">Gente de la empresa · ${empresa.length}</h3>
            <p class="text-xs text-telecab-muted px-2">${empresa.length ? esc(empresa.map(x => x.nombre).join(', ')) : 'Nadie.'}
              Hacen <b class="text-telecab-text">viajes</b>, no turnos, y se activan en <a href="/usuarios" class="text-telecab-gold hover:underline">Usuarios</a>.</p>
          </section>

          <section class="min-w-0" id="fj-motores"></section>
        </div>
      </div>`;

    caja.querySelector('[data-fj-cerrar]').addEventListener('click', abrirFichaje);
    const busca = caja.querySelector('[data-fj-busca]');
    busca.addEventListener('input', () => {
      fjBusca = busca.value;
      const pos = busca.selectionStart;
      pintarFichaje();
      const nuevo = $('#panel-fichaje [data-fj-busca]');
      if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
    });
    caja.querySelectorAll('[data-fj-conductor]').forEach(chk => chk.addEventListener('change', () =>
      cambiarFichaje(chk.dataset.fjConductor, chk.checked, chk)));
    pintarMotores();
  }

  async function cambiarFichaje(id, activo, chk) {
    const c = porId.get(String(id));
    if (!c) return;
    const abierto = (FJ && FJ.abiertos || []).find(a => String(a.conductorId) === String(id));
    if (!activo && abierto) {
      const ok = await Dialogo.confirmar({
        titulo: 'Apagar el bloqueo de ' + c.nombre, tono: 'pregunta', si: 'Apagar', no: 'Cancelar',
        texto: `Tiene un turno abierto en ${abierto.matricula}. Si lo apagas, al terminarlo el motor se quedará libre.`,
      });
      if (!ok) { chk.checked = true; return; }
    }
    try {
      await fjPost('/planificador-v2/api/fichaje/conductor', { conductorId: id, activo });
      c.fichaCoche = activo;
      if (activo) fjBusca = '';
      Dialogo.hecho(activo ? `${c.nombre}: bloqueo de motor encendido` : `${c.nombre}: bloqueo de motor apagado`);
      pintarContadorFichaje();
      pintar();
      await cargarFichaje();
    } catch (e) {
      chk.checked = !activo;
      await Dialogo.aviso({ titulo: 'No se pudo guardar', texto: e.message, tono: 'error' });
    }
  }

  // LOS MOTORES CORTADOS YA NO SE MIRAN AQUÍ (30/09/2026): viven en su módulo,
  // «Ciclo de bloqueo de motor», con quién bloqueó cada coche, quién lo coge
  // después y el botón de soltarlo. Aquí queda el enlace, para no tener dos
  // sitios desde los que soltar un motor.
  function pintarMotores() {
    const caja = $('#fj-motores');
    if (!caja) return;
    caja.innerHTML = `
      <h3 class="text-[11px] uppercase tracking-wide text-telecab-muted mb-1.5">Motores bloqueados</h3>
      <p class="text-xs text-telecab-muted px-2">Los bloquea el conductor al <b class="text-telecab-text">terminar</b> su turno y
        los suelta el siguiente al <b class="text-telecab-text">empezar</b>. El sistema no bloquea nada por su cuenta.</p>
      <a href="/bloqueo-motor" class="mt-2 mx-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-telecab-border text-sm hover:border-telecab-gold/50">
        <i class="fa-solid fa-lock text-xs"></i> Ciclo de bloqueo de motor</a>
      <p class="text-[11px] text-telecab-muted px-2 mt-2">Ahí se ve qué coche está bloqueado, quién lo coge después, y se suelta el que se queda en el taller.</p>`;
  }
