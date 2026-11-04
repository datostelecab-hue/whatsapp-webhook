// El planificador · vertical — La vista vertical: una tarjeta por coche.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── LA VISTA VERTICAL: una tarjeta por coche ────────────────────────────────
  // Lo mismo que la fila de la tabla, apilado: arriba la matrícula, su estado y
  // sus horas; debajo las plazas, el DÍA a la izquierda y la NOCHE a la derecha.
  // El teléfono y la zona de casa van en la ayuda del nombre para que quepan más
  // coches a la vista; la libranza excepcional y la zona de casa se editan en la
  // vista horizontal.
  function tarjetasCoches(lista, enCuadrante) {
    const wrap = document.createElement('div');
    wrap.className = 'grid gap-2 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3';
    lista.forEach(coche => wrap.appendChild(tarjetaCoche(coche, enCuadrante)));
    return wrap;
  }

  function tarjetaCoche(coche, enCuadrante) {
    const art = document.createElement('article');
    art.dataset.vehiculo = coche.vehiculoId;  // para «Ver su cuadrante»
    const tono = tonoEstado(coche.estadoVeh);
    const parado = !coche.visibleCobertura;
    const ic = coche.iceberg || {};
    const falta = textoFalta(coche);
    const descTxt = (coche.descanso && coche.descanso.length) ? diasTexto(coche.descanso) : '';
    art.className = `rounded-2xl border p-3 flex flex-col gap-2 min-w-0 scroll-mt-24 ${parado ? 'border-telecab-red/40 bg-telecab-red/5' : 'border-telecab-border bg-telecab-card'}`;
    const accion = (data, icono, titulo) =>
      `<button type="button" ${data} title="${esc(titulo)}" class="w-7 h-7 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition-colors"><i class="fa-solid ${icono} text-xs"></i></button>`;
    art.innerHTML = `
      <header class="flex items-center gap-2 min-w-0">
        <span class="w-2 h-2 rounded-full shrink-0 ${ESCALON[escalonDe(coche)].punto}" title="${esc(ESCALON[escalonDe(coche)].tit)}"></span>
        <span class="font-semibold tabular-nums">${esc(coche.matricula)}</span>
        <button type="button" data-estado class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold
                       bg-telecab-${tono}/15 text-telecab-${tono} border border-telecab-${tono}/30 hover:bg-telecab-${tono}/25 transition-colors">
          ${esc(ESTADO_ETQ.get(coche.estadoVeh) || coche.estadoVeh)}<i class="fa-solid fa-chevron-down text-[8px]"></i></button>
        <span class="ml-auto flex items-center gap-1.5 text-[11px] text-telecab-muted tabular-nums whitespace-nowrap" title="${esc(tituloHoras(coche))}">
          ${medidor(ic.horas)}<b class="text-telecab-text font-semibold">${fmtH(ic.horas)} h</b></span>
      </header>
      <div class="flex items-center gap-1 -mt-1">
        ${coche.sinCT ? botonesLibranzaFijos(coche, true) : `<button type="button" data-desc title="Editar el descanso del coche (día y noche)"
                class="px-1.5 py-0.5 rounded-md text-[11px] font-semibold border transition-colors hover:border-telecab-gold/50
                       ${descTxt ? 'bg-telecab-gold/10 text-telecab-gold border-telecab-gold/30' : 'border-dashed border-telecab-border text-telecab-muted'}">
          ${descTxt ? 'libra ' + esc(descTxt) : 'sin descanso'}</button>`}
        ${falta ? `<span class="min-w-0 truncate text-[11px] text-telecab-warn" title="${esc('Falta ' + falta)}">Falta ${esc(falta)}</span>` : ''}
        <span class="ml-auto flex items-center shrink-0">
          ${accion('data-cua', enCuadrante ? 'fa-object-ungroup' : 'fa-object-group', enCuadrante ? 'Sacar del cuadrante' : 'Meter en un cuadrante')}
          ${accion('data-swap', 'fa-shuffle', 'Intercambiar coche por otro (cada tripulación se queda en su cuadrante y días; solo cambia la matrícula)')}
          ${accion('data-cambiar', 'fa-right-left', 'Cambiar de coche (llevarse la tripulación a una matrícula libre)')}
          ${accion('data-sinct', coche.sinCT ? 'fa-user-plus' : 'fa-user-slash', coche.sinCT ? 'Volver a tener correturnos' : 'Sin correturnos: quitar sus correturnos y dar a cada fijo su propio descanso')}
        </span>
      </div>
      ${coche.sinCT ? `<div class="-mt-1">${chipSinCT(coche)}</div>` : ''}
      <div class="grid grid-cols-2 gap-x-2 gap-y-1" data-plazas>
        <div class="px-2 text-[10px] font-semibold uppercase tracking-wider text-telecab-muted"><i class="fa-solid fa-sun mr-1"></i>Día</div>
        <div class="px-2 text-[10px] font-semibold uppercase tracking-wider text-telecab-muted"><i class="fa-solid fa-moon mr-1"></i>Noche</div>
      </div>`;
    art.querySelector('[data-estado]').addEventListener('click', () => cambiarEstado(coche));
    const bDesc = art.querySelector('[data-desc]');
    if (bDesc) bDesc.addEventListener('click', () => fijarDescansoCoche(coche));
    art.querySelectorAll('[data-desc-turno]').forEach(b =>
      b.addEventListener('click', () => fijarDescansoCoche(coche, b.dataset.descTurno)));
    art.querySelector('[data-sinct]').addEventListener('click', () => sinCorreturnosUI(coche));
    art.querySelector('[data-cua]').addEventListener('click', e => enCuadrante ? sacarDeCuadrante(coche, e.currentTarget) : meterEnCuadrante(coche));
    art.querySelector('[data-swap]').addEventListener('click', () => reemplazarMatriculaUI(coche));
    art.querySelector('[data-cambiar]').addEventListener('click', () => cambiarCoche(coche));
    // Las plazas van por orden de slot (0 fijo día, 1 fijo noche, 2 CT día…):
    // en una rejilla de dos columnas eso deja el día a la izquierda.
    const rejilla = art.querySelector('[data-plazas]');
    colsDe(coche).forEach(col => rejilla.appendChild(plazaCompacta(coche, (coche.personas || [])[col.slot] || {}, col)));
    if (coche.sinCT) {
      const aviso = document.createElement('p');
      aviso.className = 'col-span-2 px-2 pt-1 text-[11px] text-telecab-muted flex items-center gap-1.5';
      aviso.innerHTML = `<i class="fa-solid fa-user-slash"></i>${esc(AVISO_SIN_CT)}`;
      rejilla.appendChild(aviso);
    }
    if (parado) {
      const tieneGente = (coche.personas || []).some(p => p && p.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'self-start text-[11px] text-telecab-red font-semibold ' + (tieneGente ? 'hover:underline' : 'cursor-default');
      b.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${tieneGente ? 'cambiar matrícula aquí' : 'fuera de cobertura'}`;
      if (tieneGente) {
        b.title = 'Intercambia el coche por otro (libre o con bloque): las tripulaciones se quedan en su cuadrante y días, cambia la matrícula';
        b.addEventListener('click', () => reemplazarMatriculaUI(coche));
      }
      art.appendChild(b);
    }
    return art;
  }

  /** Una plaza en una línea: quién, su chip de horas y, debajo, lo que hay que saber. */
  function plazaCompacta(coche, p, col) {
    const esFijo = col.slot < 2;
    const rol = esFijo ? 'Fijo' : (col.refuerzo ? 'CT2' : 'CT');
    const persona = p.id ? porId.get(String(p.id)) : null;
    const div = document.createElement('div');
    div.className = 'min-w-0';
    const notas = [];
    if (p.futuro) notas.push(`<span class="text-telecab-gold"><i class="fa-solid fa-arrow-right-long"></i> ${esc((p.futuro.nombre || '').split(' ')[0])} llega ${esc(isoAes(p.futuro.desde).slice(0, 5))}</span>`);
    if (p.vacante) notas.push(`<span class="${p.vacante.estado === 'proceso' ? 'text-telecab-violet' : 'text-sky-400'}" title="${esc('Vacante ' + p.vacante.codigo + (p.vacante.candidato ? ' · ' + p.vacante.candidato : ' · sin candidato todavía'))}"><i class="fa-solid fa-briefcase text-[9px]"></i> ${esc(p.vacante.codigo)}</span>`);

    if (p.id) {
      const av = avisoAusencia(persona);
      const dias = esFijo ? '' : ((p.diasManual || []).some(Boolean)
        ? (p.diasManual || []).map((v, i) => (v ? DIAS_LETRA[i] : null)).filter(Boolean).join(' ')
        : diasTexto((p.diasSugeridos || []).map(d => d + 1)));
      if (!esFijo) notas.unshift(`<span>${dias ? esc(dias) : 'sin días'}</span>`);
      if (av) notas.unshift(`<span class="text-telecab-${av.tono} font-semibold"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(av.texto)}</span>`);
      const nombre = persona ? persona.nombre : p.nombre;
      const ayuda = [nombre, (persona && persona.telefono) ? 'Tel. ' + persona.telefono : 'Sin teléfono',
        persona && persona.barrio ? 'Vive en ' + persona.barrio : '',
        VER_FICHAS ? 'Pincha para ver su ficha, cambiarlo o quitarlo.' : 'Pincha para cambiar o quitar.'].filter(Boolean).join('\n');
      // El nombre se queda con todo el ancho de la línea; el chip de horas y lo
      // demás van debajo. Con el chip al lado, en una tarjeta estrecha el nombre
      // se quedaba en «Carl…».
      const rend = chipRend(persona && persona.rendimiento);
      div.innerHTML = `
        <button type="button" data-asignar title="${esc(ayuda)}" class="group w-full text-left px-2 py-1 rounded-lg hover:bg-telecab-card2 transition-colors">
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="text-[10px] font-semibold text-telecab-muted w-7 shrink-0">${rol}</span>
            <span class="min-w-0 truncate text-[13px] ${av && av.tachado ? 'line-through text-telecab-muted' : 'font-medium group-hover:text-telecab-gold'}">${esc(nombre)}</span>
            ${llaveFichaje(persona)}
          </span>
          ${(rend || notas.length) ? `<span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 pl-[2.125rem] text-[10px] leading-tight text-telecab-muted">${rend}${notas.join('')}</span>` : ''}
        </button>`;
    } else {
      // Un hueco salta a la vista: el de fijo en rojo, el de CT en naranja, el que
      // ya está prometido en una vacante en azul (hay que esperarlo, no buscarlo).
      const cls = p.vacante ? 'border-sky-500/60 bg-sky-500/10 text-sky-400'
        : esFijo ? 'border-telecab-red/60 bg-telecab-red/10 text-telecab-red'
          : 'border-telecab-warn/60 bg-telecab-warn/10 text-telecab-warn';
      div.innerHTML = `
        <button type="button" data-asignar class="w-full text-left px-2 py-1 rounded-lg border border-dashed text-xs font-semibold transition hover:brightness-110 ${cls}">
          <span class="text-[10px] w-7 inline-block">${rol}</span>${p.vacante ? 'En vacante' : 'Hueco'}
        </button>
        ${notas.length ? `<span class="flex flex-wrap gap-x-2 pl-[2.125rem] mt-0.5 text-[10px] leading-tight text-telecab-muted">${notas.join('')}</span>` : ''}`;
    }
    div.querySelector('[data-asignar]').addEventListener('click', () => asignar(coche, p, col));
    // Ausente y ocupando plaza: el atajo para poner a quien lo cubre.
    if (p.id && persona && persona.ausente) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ml-[2.125rem] mt-0.5 text-[10px] font-semibold text-telecab-gold hover:underline';
      b.innerHTML = '<i class="fa-solid fa-user-plus"></i> Cubrir';
      b.title = `Poner a alguien mientras ${persona.nombre.split(' ')[0]} no está.` +
        (persona.vuelveEl ? ` La plaza vuelve a ser suya el ${isoAes(persona.vuelveEl)}.` : ' Su ausencia no tiene fecha de vuelta.');
      b.addEventListener('click', e => { e.stopPropagation(); cubrirUI(coche, p, col, persona); });
      div.appendChild(b);
    }
    return div;
  }

  // El aviso de ausencia de un conductor: vacaciones (libera la plaza -> hueco),
  // baja/permiso (alerta, sigue asignado), o una ausencia que entra pronto.
  function avisoAusencia(c) {
    if (!c) return null;
    // LA BAJA PROGRAMADA (db/191): sigue en su plaza hasta ese día, y se dice.
    const seVa = c.bajaPrevista ? `se va el ${isoAes(c.bajaPrevista).slice(0, 5)}` : '';
    if (c.ausente) {
      const vuelve = c.vuelveEl && c.vuelveEl <= sumarDias(DIA, 7) ? ` · vuelve ${isoAes(c.vuelveEl)}` : '';
      // Cualquier ausente deja el dia sin cubrir (hueco); el tachado (se quita del
      // cuadrante) es solo para las que liberan la plaza, como vacaciones.
      return { tono: c.liberaPlaza ? 'red' : 'warn', texto: c.estado + vuelve + (seVa ? ' · ' + seVa : ''), hueco: true, tachado: !!c.liberaPlaza };
    }
    if (seVa) return { tono: 'red', texto: seVa, hueco: false };
    if (c.proxAusencia && c.proxAusencia.desde && c.proxAusencia.desde <= sumarDias(DIA, 7)) {
      return { tono: 'gold', texto: `entra en ${String(c.proxAusencia.estado || '').toLowerCase()} el ${isoAes(c.proxAusencia.desde)}`, hueco: false };
    }
    return null;
  }
