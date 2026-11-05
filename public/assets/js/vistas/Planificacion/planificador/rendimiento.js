// El planificador · rendimiento — El rendimiento («10,4 h · S» al lado del nombre) y la celda de cada puesto.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── EL RENDIMIENTO: "10,4 h · S" al lado del nombre ─────────────────────────
  // Promedio de horas del MES CORRIDO y su letra (S >=9 · A 8-9 · B 6-8 · C <6).
  // Cuenta lo de BOLT MÁS lo justificado (2 h de taller + 6 rodando = 8), y los
  // días que debía salir y no salió sin justificar cuentan como 0. Librar, las
  // vacaciones y las bajas no cuentan.
  const REND_TONO = {
    A: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    B: 'bg-telecab-gold/20 text-telecab-gold border-telecab-gold/40',
    C: 'bg-amber-500/15 text-amber-500 border-amber-500/40',
    D: 'bg-red-500/15 text-red-500 border-red-500/40',
    N: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
  };
  // LA LETRA ES LA CALIFICACIÓN A–D, no el promedio de horas.
  //
  // A partir del modelo ABCD, el chip pesa tres cosas: horas (50 %), utilización
  // (30 %) y excesos de velocidad (20 %) sobre los últimos 14 días. El número que
  // va delante sigue siendo las horas, porque es lo que se mira de un vistazo,
  // pero la letra ya no sale solo de ahí.
  function tituloRend(r) {
    if (!r || !r.total && r.total !== 0) return 'Calificación ' + ((r && r.letra) || '');
    const n = v => String(v == null ? '—' : v).replace('.', ',');
    let t = 'Calificación ' + r.letra + ' · ' + n(r.total) + ' puntos'
      + (r.desde ? ' (' + r.desde.slice(8, 10) + '/' + r.desde.slice(5, 7)
                 + ' – ' + r.hasta.slice(8, 10) + '/' + r.hasta.slice(5, 7) + ')' : '')
      // Los primeros días del mes es la letra del mes CERRADO (db/175): se dice.
      + (window.FichaConductor && FichaConductor.mesCerrado(r.hasta) ? '\n' + FichaConductor.mesCerrado(r.hasta) : '')
      + '\n· Horas ' + n(r.horas) + ' h/día en ' + r.dias + ' día(s) → ' + r.ptsHoras + ' pts (50 %)'
      + '\n· Utilización ' + n(r.utilProm) + ' % → ' + r.ptsUtilizacion + ' pts (30 %)'
      + '\n· Excesos de velocidad ' + n(r.excesos) + ' → ' + r.ptsVelocidad + ' pts (20 %)';
    if (r.topeAplicado) t += '\nAviso: por puntos sería ' + r.letraPorPuntos + ': la baja el tope por velocidad.';
    if (r.diasTelemetria != null && r.diasTelemetria < 14) {
      t += '\nAviso: solo ' + r.diasTelemetria + ' día(s) de telemetría: faltan excesos por contar.';
    }
    return t;
  }

  function chipRend(r, mini) {
    if (!r) return '';
    // Recién incorporado: no se promedia hasta el cuarto día. "0 h · C" en
    // alguien que lleva dos días no dice nada malo de él, dice que no se sabe.
    // Sin calificación todavía (menos de 5 días trabajados, o sin telemetría).
    if (r.nuevo) return `<span class="shrink-0 inline-flex items-center px-1.5 py-0 rounded border text-[10px] font-bold leading-[1.4] ${REND_TONO.N}" title="${esc('Sin calificar: ' + (r.motivo || 'datos insuficientes'))}">N/E</span>`;
    if (!r.dias) return '';
    const h = String(r.horas).replace('.', ',');
    return `<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0 rounded border text-[10px] font-bold leading-[1.4] ${REND_TONO[r.letra] || REND_TONO.D}" title="${esc(tituloRend(r))}">` +
      `${h} h<span class="opacity-80">·</span>${r.letra}${r.topeAplicado ? '<i class="fa-solid fa-triangle-exclamation text-[8px] ml-0.5 align-middle"></i>' : ''}</span>`;
  }

  function celdaPuesto(coche, p, col) {
    const esFijo = p.rol === 'FIJO' || col.slot < 2;
    const wrap = document.createElement('div');
    const persona = p.id ? porId.get(String(p.id)) : null;

    // Aviso del PRÓXIMO DUEÑO: quien tiene esta plaza reservada para más adelante.
    // Se ve aunque ahora esté vacía o con un temporal ("→ Carlos · llega el 12/09").
    const fut = p.futuro
      ? `<span class="block text-[11px] text-telecab-gold font-semibold mt-0.5"><i class="fa-solid fa-arrow-right-long"></i> ${esc(p.futuro.nombre)} · llega ${isoAes(p.futuro.desde)}</span>`
      : '';

    // LA PLAZA ESTÁ PROMETIDA en una vacante. El cuadrante era el último en
    // enterarse: un hueco que Tráfico ve rojo puede llevar dos semanas
    // reclutándose, y se colocaba a alguien a mano encima de una plaza ya
    // ofrecida. Ahora lo dice la propia celda, y dice qué fase lleva.
    const vac = p.vacante;
    const vacHtml = !vac ? '' : (() => {
      const quien = vac.candidato
        ? `${esc(vac.candidato)}${vac.inicioPrevisto ? ' · entra ' + isoAes(vac.inicioPrevisto) : ''}`
        : 'sin candidato todavía';
      const releva = vac.motivo === 'recambio'
        ? ` · releva a ${esc((vac.sale || '').split(' ')[0] || '')}` +
          (vac.salidaPrevista ? ` (sale ${isoAes(vac.salidaPrevista)})` : '')
        : '';
      const tono = vac.estado === 'proceso' ? 'text-telecab-violet' : 'text-sky-400';
      const icono = vac.motivo === 'recambio' ? 'fa-right-left' : 'fa-briefcase';
      return `<span class="block text-[11px] ${tono} font-semibold mt-0.5"
                    title="Vacante ${esc(vac.codigo)}${vac.letras ? ' · días ' + esc(vac.letras) : ''}. ${vac.estado === 'proceso' ? 'Ya tiene candidato en proceso.' : 'Selección la está reclutando.'}">
                <i class="fa-solid ${icono} text-[9px]"></i> ${esc(vac.codigo)} · ${quien}${releva}</span>`;
    })();

    if (p.id) {
      // Sub-línea: para el fijo, los días que libra; para el CT, sus días.
      let sub = '';
      // En un coche sin correturnos (db/203), los de SU turno.
      if (esFijo) sub = 'libra ' + (diasTexto(coche.sinCT ? (coche.descansoTurno || {})[col.turno] : coche.descanso) || '—');
      else if (!esFijo) {
        const dias = (p.diasManual || []).some(Boolean)
          ? (p.diasManual || []).map((v, i) => v ? DIAS_LETRA[i] : null).filter(Boolean).join(' ')
          : diasTexto((p.diasSugeridos || []).map(d => d + 1));
        sub = dias ? ('días ' + dias) : 'sin días';
      }
      const ett = persona && persona.esEtt ? ' <span class="text-telecab-violet">ETT</span>' : '';
      const av = avisoAusencia(persona);
      const nombreCls = av && av.tachado ? 'line-through text-telecab-muted' : 'font-medium group-hover:text-telecab-gold';
      // El teléfono SIEMPRE a la vista bajo el nombre. El envío por WhatsApp va en
      // la cabecera del cuadrante: UN botón por cuadrante, no uno por persona.
      const tel = (persona && persona.telefono) || '';
      wrap.innerHTML = `
        <button class="text-left w-full group" data-asignar>
          <span class="${nombreCls} transition">${esc(persona ? persona.nombre : p.nombre)}${ett}${llaveFichaje(persona)}</span>
          ${chipRend(persona && persona.rendimiento)}
          ${tel ? `<span class="block text-[11px] text-telecab-muted font-mono tabular-nums">${esc(tel)}</span>`
                : `<span class="block text-[11px] text-telecab-warn/80">sin teléfono</span>`}
          <span data-barrio class="block text-[11px] ${(persona && persona.barrio) ? 'text-telecab-gold/80' : 'text-telecab-muted/50'} hover:text-telecab-gold transition" title="La zona del conductor (Aluche, San Blas…): pincha para cambiarla"><i class="fa-solid fa-house text-[9px]"></i> ${(persona && persona.barrio) ? esc(persona.barrio) : 'poner zona'}</span>
          <span class="block text-xs text-telecab-muted">${esc(sub)}${persona && persona.modalidad === '40x4'
            ? ' <span class="ml-1 px-1 rounded bg-telecab-gold/15 text-telecab-gold text-[10px] font-semibold" title="Contrato de 40 horas repartido en 4 días">40x4</span>' : ''}</span>
          ${av ? `<span class="block text-[11px] text-telecab-${av.tono} font-semibold"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(av.texto)}${av.hueco ? ' · sin cubrir' : ''}</span>` : ''}
          ${fut}
          ${vacHtml}
        </button>`;
      wrap.querySelector('[data-asignar]').addEventListener('click', () => asignar(coche, p, col));
      // La zona se edita desde su propia línea, sin disparar el "asignar" de la carta.
      wrap.querySelector('[data-barrio]').addEventListener('click', e => {
        e.stopPropagation();
        editarBarrio(persona || { id: p.id, nombre: p.nombre, barrio: '' });
      });
    } else {
      // Un hueco tiene que SALTAR a la vista para localizarlos rápido: fondo tintado
      // + icono de aviso. El fijo vacío en rojo (crítico); el CT vacío en ámbar.
      // Un hueco YA PROMETIDO no es el mismo hueco: no hay que salir a buscar a
      // nadie, hay que esperar a que llegue. Se pinta distinto para que no se
      // cuente dos veces la misma falta.
      const cls = vac
        ? 'border-sky-500/60 bg-sky-500/10 text-sky-400'
        : esFijo
          ? 'border-telecab-red/60 bg-telecab-red/10 text-telecab-red'
          : 'border-telecab-warn/60 bg-telecab-warn/10 text-telecab-warn';
      const texto = vac
        ? (vac.candidato ? 'Hueco · candidato en camino' : 'Hueco · en vacante')
        : (esFijo ? 'Hueco · sin fijo' : 'Hueco · colocar CT');
      wrap.innerHTML = `
        <button class="text-left w-full px-2 py-1 rounded-lg border border-dashed font-semibold transition ${cls} hover:brightness-110"
                data-asignar>
          <i class="fa-solid ${vac ? 'fa-hourglass-half' : 'fa-triangle-exclamation'} text-xs"></i> ${texto}
        </button>
        ${vacHtml}
        ${fut}`;
      wrap.querySelector('[data-asignar]').addEventListener('click', () => asignar(coche, p, col));
    }

    // AUSENTE Y OCUPANDO PLAZA: la casilla para poner a quien lo cubre. Va aquí,
    // pegada al aviso de que está de vacaciones, porque es justo cuando se
    // piensa en ello: el que ve el hueco es el que sabe a quién meter.
    if (p.id && persona && persona.ausente) {
      const b = document.createElement('button');
      b.className = 'mt-1 w-full text-left px-2 py-1 rounded-lg border border-dashed '
        + 'border-telecab-gold/50 bg-telecab-gold/5 text-[11px] font-semibold text-telecab-gold '
        + 'hover:bg-telecab-gold/15 transition';
      b.innerHTML = '<i class="fa-solid fa-user-plus"></i> Cubrir esta plaza';
      b.title = persona.vuelveEl
        ? `Poner a alguien mientras ${persona.nombre.split(' ')[0]} no está. La plaza vuelve a ser suya el ${isoAes(persona.vuelveEl)}.`
        : `Poner a alguien mientras ${persona.nombre.split(' ')[0]} no está. Su ausencia no tiene fecha de vuelta.`;
      b.addEventListener('click', e => { e.stopPropagation(); cubrirUI(coche, p, col, persona); });
      wrap.appendChild(b);
    }

    // En un fijo colocado, atajo a la libranza excepcional.
    if (esFijo && p.id) {
      const b = document.createElement('button');
      b.className = 'mt-1 text-[11px] text-telecab-muted hover:text-telecab-gold transition';
      b.innerHTML = '<i class="fa-solid fa-calendar-day"></i> libranza excepcional';
      b.addEventListener('click', () => libranzaExcepcional(persona || { id: p.id, nombre: p.nombre }));
      wrap.appendChild(b);
    }
    return wrap;
  }
