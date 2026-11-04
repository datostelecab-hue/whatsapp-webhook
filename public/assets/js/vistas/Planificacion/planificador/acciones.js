// El planificador · acciones — Las acciones: asignar, cubrir, cambiar estado, coche o matrícula, el barrio y el descanso del coche.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── Acciones ─────────────────────────────────────────────────────────────
  async function guardarCambios(cambios) {
    const r = await fetchPlan('/planificador-v2/api/guardar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dia: DIA, cambios }),
    });
    const j = await r.json();
    if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo guardar');
    if (j.tablero) aplicar(j.tablero);
    return j;
  }

  /** Pregunta al servidor qué días haría y con qué choca. */
  async function comprobarPlan(cuerpo) {
    const r = await fetchPlan('/planificador-v2/api/comprobar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json();
    if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo comprobar');
    return j.plan;
  }

  /** El parte de la comprobación, día a día, para enseñarlo antes de guardar. */
  function htmlPlan(plan) {
    const fila = f => {
      const choca = f.choca.length;
      const ocup = f.ocupado.length;
      const tono = choca ? 'text-telecab-red' : ocup ? 'text-telecab-warn' : 'text-telecab-green';
      const icono = choca ? 'fa-ban' : ocup ? 'fa-user-xmark' : 'fa-check';
      const dice = choca
        ? `ya lleva ${esc(f.choca.map(c => c.matricula + ' (' + c.turno.toLowerCase() + ')').join(', '))}`
        : ocup
          ? `lo lleva ${esc(f.ocupado.map(o => o.conductor).join(', '))}`
          : 'el coche está libre';
      return `<tr class="border-t border-telecab-border/60">
        <td class="py-1.5 pr-3 font-semibold">${f.letra} <span class="text-telecab-muted font-normal">${isoAes(f.dia)}</span></td>
        <td class="py-1.5 pr-3 text-[11px] ${f.esLibranza ? 'text-telecab-green' : 'text-telecab-muted'}">
          ${f.esLibranza ? 'libra ese día' : 'no es su libranza'}</td>
        <td class="py-1.5 ${tono}"><i class="fa-solid ${icono} text-[10px] mr-1"></i>${dice}</td>
      </tr>`;
    };
    return `
      <p class="text-sm text-telecab-muted mb-2">
        <b class="text-telecab-text">${esc(plan.conductor)}</b> haría
        <b class="text-telecab-gold">${esc(plan.letras || '—')}</b> en <b>${esc(plan.matricula)}</b>
        (${esc(plan.etiqueta)}).</p>
      <table class="w-full text-sm"><tbody>${plan.filas.map(fila).join('')}</tbody></table>`;
  }

  // Colocar / cambiar / quitar a alguien en un puesto.
  //
  // Colocar ya no es "elige a alguien y listo". Antes de guardar hay que saber
  // QUÉ DÍAS va a trabajar en esa matrícula y comprobar dos cosas que el tablero
  // dejaba hacer en silencio: que nadie lleve dos coches el mismo día (imposible,
  // y además tienen que descansar) y que el coche esté libre ese día. Lo segundo
  // se puede forzar; lo primero no.
  async function asignar(coche, p, col) {
    if (!p.plazaId) { await Dialogo.aviso({ titulo: 'Recarga', texto: 'Esta plaza no existe todavía en la base. Recarga el cuadrante.', tono: 'aviso' }); return; }
    const ev = (T.eventos || {}).vigente;
    // Si la plaza tiene DUEÑO FUTURO, se recuerda en el título: estás planificando
    // "mientras llega él".
    const tit = `${col.tit} · ${coche.matricula}` +
      (p.futuro ? ` · llega ${(p.futuro.nombre || '').split(' ')[0]} el ${isoAes(p.futuro.desde)}` : '');
    const enPlaza = p.id ? (porId.get(String(p.id)) || { id: p.id, nombre: p.nombre }) : null;
    const id = await pickConductor({ titulo: tit, turno: col.turno, actual: p.id ? String(p.id) : null,
      ficha: enPlaza && { id: String(enPlaza.id), nombre: enPlaza.nombre } });
    if (id === undefined) return;   // cancelado

    // QUITAR A ALGUIEN. No necesita comprobación, pero CON EVENTO hay que
    // preguntar lo mismo que al colocar: quitarlo estos días o quitarlo del
    // todo. Fue justo esto lo que rompió el finde de la F1 — se vaciaron las
    // plazas de correturnos para dejar solo fijos y se quedaron vacías para
    // siempre, así que el lunes esa gente no tenía plaza y el WhatsApp se lo
    // dijo. Ahora por defecto se les devuelve la plaza al acabar el evento.
    if (!id) {
      let slotVacio = { plazaId: p.plazaId, id: '' };
      if (ev && p.id) {
        const q = await Dialogo.formulario(`Quitar a ${p.nombre} de ${coche.matricula}`, [
          { id: 'alcance', etiqueta: '¿Lo quitas para siempre o solo estos días?', tipo: 'opciones',
            obligatorio: true, valor: 'evento', opciones: [
              { valor: 'evento', texto: `Solo durante el evento (${isoAes(ev.desde)} → ${isoAes(ev.hasta)})`,
                detalle: 'Recupera su plaza al acabar, y su WhatsApp de la semana que viene sale bien.' },
              { valor: 'permanente', texto: 'Quitarlo del cuadrante',
                detalle: 'Deja de tener esa plaza. No vuelve solo.' },
            ] },
        ], { textoBoton: 'Quitar', ancho: 'max-w-lg' });
        if (!q) return;
        if (((q.alcance || {}).valor || 'evento') === 'evento') slotVacio.eventoId = ev.id;
      }
      try {
        const j = await guardarCambios([{ vehiculoId: coche.vehiculoId, slots: [slotVacio] }]);
        if (slotVacio.eventoId) {
          await Dialogo.aviso({ titulo: 'Quitado solo durante el evento', tono: 'ok',
            texto: `${p.nombre} recupera ${coche.matricula} el ${isoAes(ev.hasta)} +1. ` +
              'En su WhatsApp verá que esos días libra y que la semana que viene vuelve a lo de siempre.' });
        }
      } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
      return;
    }

    // Los días de partida: los suyos si ya los tenía, si no los sugeridos (los
    // que libra el fijo del coche). Un FIJO no elige: hace todos menos el
    // descanso del coche, y eso lo calcula el servidor.
    const esCT = p.rol === 'CT' || col.slot >= 2;
    const diasPrevios = (p.diasManual || []).some(Boolean)
      ? (p.diasManual || []).map((v, i) => v ? i + 1 : null).filter(Boolean)
      : (p.diasSugeridos || []).map(d => d + 1);

    // El refuerzo de un evento CADUCA con el evento: las fechas vienen puestas y
    // no hay que acordarse de cerrarlas. Eso es lo que lo hace "momentáneo".
    const campos = [];
    if (esCT) {
      campos.push({ id: 'dias', etiqueta: 'Qué días trabaja en esta matrícula', tipo: 'semana',
        valor: diasPrevios });
    }
    // CON EVENTO VIVO, LA PRIMERA PREGUNTA ES OTRA: ¿esto es un apaño de estos
    // días o un cambio de verdad? De la respuesta depende que el cuadrante
    // vuelva solo a lo de antes. Un apaño se cierra con el evento y AL QUE SE
    // ECHA se le repone con fecha de vuelta en el mismo movimiento.
    if (ev) {
      campos.push({ id: 'alcance', etiqueta: '¿Hasta cuándo?', tipo: 'opciones',
        obligatorio: true, valor: 'evento', opciones: [
          { valor: 'evento', texto: `Solo durante el evento (${isoAes(ev.desde)} → ${isoAes(ev.hasta)})`,
            detalle: 'Al terminar, el cuadrante vuelve solo a como estaba y al que estaba aquí se le repone.' },
          { valor: 'permanente', texto: 'Cambio permanente',
            detalle: 'Se queda después del evento. Al que estaba aquí NO se le repone.' },
        ] });
    }
    campos.push({ id: 'desde', etiqueta: 'Desde', tipo: 'fecha',
      valor: ev && ev.desde > DIA ? isoAes(ev.desde) : '',
      ayuda: ev ? `Vacío = hoy. El evento "${ev.nombre}" va del ${isoAes(ev.desde)} al ${isoAes(ev.hasta)}.`
                : 'Vacío = desde el día que estás mirando.' });
    campos.push({ id: 'hasta', etiqueta: 'Hasta (último día)', tipo: 'fecha',
      valor: p.hasta ? isoAes(p.hasta) : '',
      ayuda: ev
        ? 'Si es del evento, se rellena solo con la fecha de fin: no hace falta tocarlo.'
        : (p.futuro ? `Vacío = hasta la víspera de que llegue ${p.futuro.nombre} (${isoAes(p.futuro.desde)}).`
                    : 'Vacío = indefinido.') });

    const v = await Dialogo.formulario(tit, campos, {
      textoBoton: 'Comprobar y colocar', ancho: 'max-w-lg',
      nota: esCT
        ? 'Se comprobará que esos días los tiene libres y que el coche no lo lleva ya otro.'
        : 'Un fijo hace todos los días menos el descanso del coche. Se comprobará igual.',
    });
    if (!v) return;

    // Con evento, "solo durante el evento" es lo normal: si no se toca nada, eso
    // es lo que sale, que es lo que casi siempre se quiere un viernes por la tarde.
    const deEvento = !!ev && ((v.alcance || {}).valor || 'evento') === 'evento';
    const base = {
      plazaId: p.plazaId, conductorId: id,
      dias: esCT ? (v.dias || []) : [],
      desde: (v.desde || '').trim() || DIA,
      hasta: deEvento ? ev.hasta : ((v.hasta || '').trim() || null),
    };
    if (esCT && !base.dias.length) {
      await Dialogo.aviso({ titulo: 'Faltan los días', tono: 'aviso',
        texto: 'Un correturnos sin días no cubre nada: marca al menos uno.' });
      return;
    }

    let plan;
    try { plan = await comprobarPlan(base); }
    catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido comprobar', texto: e.message, tono: 'error' }); return; }

    // IMPOSIBLE: ya lleva otro coche esos días. No hay "a la fuerza" que valga.
    if (plan.bloqueado) {
      await Dialogo.aviso({
        titulo: 'No puede llevar dos coches el mismo día', tono: 'error', ancho: 'max-w-lg',
        html: htmlPlan(plan) +
          '<p class="text-sm text-telecab-red mt-3">Para ponerlo aquí, primero hay que sacarlo del otro coche ' +
          'esos días (o cambiarle los días).</p>',
      });
      return;
    }

    // FORZABLE: el coche ya tiene conductor ese día. Se puede, apartándolo.
    let forzar = null;
    if (plan.forzable) {
      const f = await Dialogo.formulario('El coche ya tiene conductor esos días', [
        { id: 'motivoCodigo', etiqueta: 'Por qué se aparta al del cuadrante', tipo: 'opciones',
          obligatorio: true, opciones: (plan.motivos || []).map(m => ({ valor: m.codigo, texto: m.etiqueta })) },
        { id: 'motivo', etiqueta: 'Cuéntalo con tus palabras', tipo: 'texto-largo', obligatorio: true },
      ], {
        textoBoton: 'Planificar a la fuerza', ancho: 'max-w-lg',
        nota: 'No se le quita la plaza: se le aparta SOLO esos días. El día que llegue, Control dirá que ' +
          'conduce ' + plan.conductor + ' y por qué.',
      });
      if (!f) return;
      forzar = { forzar: true, motivoCodigo: (f.motivoCodigo || {}).valor || 'otro', motivo: f.motivo };
    }

    try {
      const slot = { plazaId: p.plazaId, id, dias: base.dias, desde: base.desde,
        ...(base.hasta ? { hasta: base.hasta } : {}), ...(forzar || {}),
        ...(deEvento ? { eventoId: ev.id } : {}) };
      const j = await guardarCambios([{ vehiculoId: coche.vehiculoId, slots: [slot] }]);
      const apartados = (j.hechos || []).filter(h => h.que === 'aparta');
      const repuestos = (j.hechos || []).filter(h => h.que === 'repone');
      if (apartados.length || repuestos.length) {
        const L = [];
        if (apartados.length) {
          L.push(`${plan.conductor} lleva ${coche.matricula} esos días. Se ha apartado a ` +
            [...new Set(apartados.map(a => a.sale))].join(', ') + ` (${apartados.length} día(s)).`);
        }
        if (repuestos.length) {
          // Lo que hace que el cuadrante vuelva solo: el que sale ya tiene fecha
          // de vuelta puesta, y se dice para que nadie tenga que fiarse.
          L.push(`La plaza vuelve a su dueño el ${isoAes(repuestos[0].desde)}: no hay que acordarse de nada.`);
        }
        await Dialogo.aviso({ titulo: apartados.length ? 'Colocado a la fuerza' : 'Colocado por el evento',
          tono: apartados.length ? 'aviso' : 'ok', texto: L.join(' ') });
      }
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  /**
   * Cubrir a quien está ausente SIN quitarle la plaza.
   *
   * Lo que lo diferencia de colocar a alguien a secas: la plaza vuelve a ser del
   * titular el día que regresa, sin que nadie tenga que acordarse dentro de tres
   * semanas. Por defecto el reemplazo dura lo que dura su ausencia; las dos
   * fechas se pueden tocar porque a veces el sustituto entra dos días después.
   */
  async function cubrirUI(coche, p, col, titular) {
    if (!p.plazaId) { await Dialogo.aviso({ titulo: 'Recarga', texto: 'Esta plaza no existe todavía en la base. Recarga el cuadrante.', tono: 'aviso' }); return; }
    const nom = (titular.nombre || '').split(' ')[0];
    const id = await pickConductor({
      titulo: `Cubrir a ${nom} · ${coche.matricula} · ${col.tit}`,
      turno: col.turno, actual: null,
      ficha: { id: String(titular.id || p.id), nombre: titular.nombre,
        nota: 'Titular de la plaza' + (titular.estado ? ' · ' + String(titular.estado).toLowerCase() : '') },
    });
    if (!id) return;   // cancelado o "dejar vacía": aquí no aplica

    const v = await Dialogo.formulario(`Mientras ${nom} está de ${String(titular.estado || '').toLowerCase()}`, [
      { id: 'desde', etiqueta: 'Desde (opcional)', tipo: 'fecha',
        ayuda: 'Vacío = desde que empieza su ausencia (o desde hoy, si ya empezó).' },
      { id: 'hasta', etiqueta: 'Hasta (opcional)', tipo: 'fecha',
        // El campo fecha del formulario se escribe dd/mm/aaaa (él lo devuelve en
        // ISO). Aquí decía isoDeFecha(), una función que NUNCA existió: con
        // fecha de vuelta —el caso normal, unas vacaciones— el diálogo reventaba
        // antes de abrirse y "Cubrir esta plaza" no hacía nada.
        valor: titular.vuelveEl ? isoAes(titular.vuelveEl) : '',
        ayuda: titular.vuelveEl
          ? `Vacío = hasta el ${isoAes(titular.vuelveEl)}, el último día de su ausencia. Al siguiente la plaza vuelve a ser suya.`
          : 'Su ausencia NO tiene fecha de vuelta, así que sin esta fecha la plaza se queda del sustituto '
            + 'hasta que alguien diga otra cosa.' },
    ], { textoBoton: 'Cubrir' });
    if (v === undefined || v === null) return;

    try {
      // `pedirTablero` ya repinta con el tablero que devuelve la ruta.
      const r = await pedirTablero('/planificador-v2/api/cubrir', {
        plazaId: p.plazaId, conductorId: id, dia: DIA,
        desde: (v.desde || '').trim() || null,
        hasta: (v.hasta || '').trim() || null,
      });
      const quien = ((T.conductores || []).find(c => String(c.id) === String(id)) || {}).nombre || 'El sustituto';
      await Dialogo.aviso({
        titulo: 'Plaza cubierta', tono: 'ok',
        texto: `${quien} lleva ${coche.matricula} del ${isoAes(r.cubierta.desde)} `
             + (r.cubierta.hasta ? `al ${isoAes(r.cubierta.hasta)}.` : 'en adelante, SIN fecha de fin.')
             + (r.vuelve ? ` ${nom} recupera su plaza el ${isoAes(r.vuelve.desde)}.`
                         : ` OJO: ${nom} no tiene vuelta programada; cuando vuelva habrá que devolvérsela a mano.`),
      });
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  /**
   * Quiénes son los correturnos flojos y cómo tienen repartidos los días.
   *
   * La cifra sola no se puede arreglar: hace falta el nombre, el teléfono para
   * llamarle y VER el reparto, porque casi siempre el problema es que le falta
   * el segundo cuadrante, no que sobre él.
   */
  async function verCtFlojos() {
    const lista = resumenActual().ctFlojosLista || [];
    if (!lista.length) {
      await Dialogo.aviso({ titulo: 'Ningún correturnos corto', tono: 'ok',
        texto: 'Todos los correturnos colocados llegan a 4 días o más entre todos sus cuadrantes.' });
      return;
    }
    const filas = lista.map(x => `
      <tr class="border-t border-telecab-border/60">
        <td class="py-1.5 pr-2">
          <div class="font-medium">${esc(x.nombre)}</div>
          <div class="text-[11px] text-telecab-muted font-mono tabular-nums">${esc(x.telefono || 'sin teléfono')}</div>
        </td>
        <td class="py-1.5 px-2 text-center text-telecab-muted">${esc(x.turno)}${
          x.ausente ? `<div class="text-[10px] text-telecab-warn">${esc(x.ausente)}</div>` : ''}</td>
        <td class="py-1.5 px-2 text-center">
          <span class="px-1.5 py-0.5 rounded font-bold ${x.dias <= 2 ? 'bg-telecab-red/15 text-telecab-red' : 'bg-telecab-warn/15 text-telecab-warn'}">${x.dias}</span>
        </td>
        <td class="py-1.5 pl-2 text-[11px] text-telecab-muted">${esc(x.reparto)}</td>
      </tr>`).join('');
    await Dialogo.aviso({
      titulo: `${lista.length} correturnos con menos de 4 días`,
      ancho: 'max-w-2xl', tono: 'aviso',
      html: `
        <p class="text-sm text-telecab-muted mb-3">Los días son los que tiene ESCRITOS sumando todos sus
          cuadrantes: dos en un coche y dos en otro son cuatro, no dos. No es lo que cubre esta semana —a quien
          entra un viernes no le faltan días, es que aún no había llegado—; son los del reparto de la derecha.</p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-[11px] uppercase tracking-wide text-telecab-muted">
              <tr><th class="text-left pb-1">Conductor</th><th class="pb-1">Turno</th>
                  <th class="pb-1">Días</th><th class="text-left pb-1 pl-2">Reparto</th></tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>`,
    });
  }

  async function cambiarEstado(coche) {
    const opciones = ESTADOS.map(e => ({ valor: e.codigo, texto: e.etiqueta }));
    const cod = await Dialogo.elegir({
      titulo: `Estado de ${coche.matricula}`,
      texto: 'Vale desde el día que estás mirando. Un coche que sale de cobertura deja a su gente en huérfanos.',
      opciones,
    });
    if (!cod || cod === coche.estadoVeh) return;
    try {
      await guardarCambios([{ vehiculoId: coche.vehiculoId, estadoVeh: cod }]);
    } catch (e) { alert(e.message); }
  }

  // Taller/siniestro: la matrícula nueva (de emergencia) hereda el bloque entero.
  async function reemplazarMatriculaUI(coche) {
    // Se puede intercambiar por una matrícula LIBRE (de emergencia) o por otra que
    // YA lleve bloque: en ese caso se intercambian (cada tripulación se queda en su
    // cuadrante y días, solo cambia la matrícula que lleva).
    const emergencia = (T.emergencia || []).map(e => ({ vehiculoId: e.vehiculoId, matricula: e.matricula + '  · libre', zona: e.zona }));
    const ocupados = (T.coches || [])
      .filter(c => String(c.vehiculoId) !== String(coche.vehiculoId) && (c.personas || []).some(p => p && p.id))
      .map(c => ({ vehiculoId: c.vehiculoId, matricula: c.matricula, zona: c.zona || (c.cuadrante || '') }));
    const opciones = ocupados.concat(emergencia);
    if (!opciones.length) { await Dialogo.aviso({ titulo: 'No hay con qué intercambiar', texto: 'No hay otra matrícula (ni libre ni con bloque) disponible.', tono: 'aviso' }); return; }
    const destino = await pickCoche({ titulo: `Intercambiar el coche de ${coche.matricula} por…`, coches: opciones });
    if (!destino) return;
    const destCoche = (T.coches || []).find(c => String(c.vehiculoId) === String(destino));
    const ocupado = destCoche && (destCoche.personas || []).some(p => p && p.id);
    const ok = await Dialogo.confirmar({
      titulo: `Intercambiar ${coche.matricula}`, si: 'Intercambiar', no: 'Cancelar',
      html: ocupado
        ? `<p>Se <b>intercambian</b> los coches: cada tripulación se queda en su <b>cuadrante</b> y sus <b>días</b>, y solo cambia la <b>matrícula</b> que lleva. ${esc(coche.matricula)} ⇄ ${esc(destCoche.matricula)}.</p>`
        : `<p>La matrícula nueva hereda el <b>cuadrante</b>, los <b>días</b> y la <b>tripulación</b>. ${esc(coche.matricula)} queda libre (en el taller).</p>`,
    });
    if (!ok) return;
    try {
      await pedirTablero('/planificador-v2/api/reemplazar-matricula', { de: coche.vehiculoId, a: destino, dia: DIA });
    } catch (e) { alert(e.message); }
  }

  async function cambiarCoche(coche, soloEmergencia) {
    // La matrícula nueva SOLO puede ser una que no tenga a nadie (de emergencia):
    // si llevara gente, moverla la dejaría sin sitio. Por eso, para el cambio de
    // un coche en taller/siniestro, solo se ofrecen las de emergencia.
    const emergencia = (T.emergencia || []).map(e => ({ vehiculoId: e.vehiculoId, matricula: e.matricula, zona: e.zona }));
    if (soloEmergencia && !emergencia.length) {
      await Dialogo.aviso({ titulo: 'Sin coches de emergencia', texto: 'No hay ninguna matrícula libre (sin nadie asignado) para meter aquí.', tono: 'aviso' });
      return;
    }
    const otros = soloEmergencia ? emergencia
      : (T.coches || []).filter(c => c.vehiculoId !== coche.vehiculoId)
          .concat(emergencia.map(e => ({ ...e, matricula: e.matricula + ' (emergencia)' })));
    const destino = await pickCoche({
      titulo: soloEmergencia ? `Matrícula de emergencia para ${coche.matricula}` : `Mover la tripulación de ${coche.matricula} a…`,
      coches: otros,
    });
    if (!destino) return;
    try {
      const r = await fetchPlan('/planificador-v2/api/cambiar-coche', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ de: coche.vehiculoId, a: destino, dia: DIA }),
      });
      const j = await r.json();
      if (!r.ok || j.status === 'error') {
        if (j.ocupantes) {
          const ok = await Dialogo.confirmar({ titulo: 'El coche de destino lleva gente', tono: 'aviso', si: 'Quitarles la plaza y mover', no: 'Cancelar', html: `<p>${esc(j.ocupantes.join(', '))}</p>` });
          if (!ok) return;
          const r2 = await fetchPlan('/planificador-v2/api/cambiar-coche', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ de: coche.vehiculoId, a: destino, dia: DIA, forzar: true }),
          });
          const j2 = await r2.json();
          if (!r2.ok || j2.status === 'error') throw new Error(j2.msg);
          if (j2.tablero) aplicar(j2.tablero);
          return;
        }
        throw new Error(j.msg);
      }
      if (j.tablero) aplicar(j.tablero);
    } catch (e) { alert(e.message); }
  }

  // ── El barrio (la zona del conductor: "Aluche", "San Blas"…) ──────────────
  // Texto libre de Tráfico. Se escribe en la ficha (conductor.barrio) y se
  // repinta en el sitio, sin recargar el tablero entero.
  async function editarBarrio(c) {
    const v = await Dialogo.formulario(`Zona de ${c.nombre}`, [
      { id: 'barrio', etiqueta: 'Barrio / zona', tipo: 'texto', valor: c.barrio || '',
        ayuda: 'Con tus palabras: Aluche, San Blas, Getafe… Vacío = quitarla.' },
    ], { textoBoton: 'Guardar' });
    if (v == null) return;
    try {
      const r = await fetchPlan('/planificador-v2/api/barrio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conductorId: c.id, barrio: (v.barrio || '').trim() }),
      });
      const j = await r.json();
      if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo guardar');
      const per = porId.get(String(c.id));
      if (per) per.barrio = j.barrio || '';
      pintar(); pintarLaterales(); pintarPrueba();
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se pudo guardar la zona', texto: e.message, tono: 'error' });
    }
  }

  // ── Descanso del coche (día + noche a la vez), o el de un fijo ────────────
  // Con `turno` ('dia' / 'noche'): el de ese fijo, en un coche sin correturnos.
  async function fijarDescansoCoche(coche, turno) {
    const deUnFijo = !!turno;
    const quien = turno === 'noche' ? 'noche' : 'día';
    const dias = await editarDescanso(deUnFijo
      ? { titulo: `Libranza del fijo de ${quien} · ${coche.matricula}`, actual: (coche.descansoTurno || {})[turno] || [],
          nota: `Los días que libra el fijo de ${quien}. El coche no tiene correturnos: esos días, el turno de ${quien} no sale.` }
      : { titulo: `Descanso de ${coche.matricula}`, actual: coche.descanso || [] });
    if (dias === undefined) return;   // cancelado
    try {
      const r = await fetchPlan('/planificador-v2/api/descanso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehiculoId: coche.vehiculoId, dias, dia: DIA, turno: turno || undefined }),
      });
      const j = await r.json();
      if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo guardar el descanso');
      if (j.tablero) aplicar(j.tablero);
    } catch (e) { alert(e.message); }
  }

  // El nombre entero de cada día, para el lector de pantalla (el botón enseña la
  // letra, y el nombre la lleva dentro: quien maneja la pantalla por voz dice «X»).
  const NOMBRE_DIA = ['Lunes', 'Martes', 'Miércoles (X)', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  function editarDescanso({ titulo, actual, nota }) {
    return new Promise(resolve => {
      const sel = new Set(actual || []);
      const fondo = document.createElement('div');
      fondo.className = 'fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4';
      fondo.innerHTML = `
        <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft w-full max-w-sm my-16">
          <div class="flex items-center justify-between px-4 py-3 border-b border-telecab-border">
            <h3 class="font-semibold">${esc(titulo)}</h3>
            <button data-x class="w-8 h-8 rounded-lg hover:bg-telecab-card2 text-telecab-muted" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          </div>
          <div class="p-4">
            <p class="text-xs text-telecab-muted mb-3">${esc(nota || 'Los días que libran los fijos (día y noche a la vez). El correturnos cubre justo esos días.')}</p>
            <div class="flex flex-wrap gap-1.5 justify-center" data-dias role="group" aria-label="Días que libra"></div>
            <div class="flex gap-2 mt-4">
              <button data-guardar class="flex-1 px-3 py-2 rounded-xl bg-telecab-gold text-telecab-dark font-semibold text-sm">Guardar</button>
              <button data-cancelar class="px-3 py-2 rounded-xl bg-telecab-card border border-telecab-border text-sm">Cancelar</button>
            </div>
          </div>
        </div>`;
      const cerrar = v => { document.body.removeChild(fondo); resolve(v); };
      const cont = fondo.querySelector('[data-dias]');
      const pinta = () => {
        cont.innerHTML = DIAS_LETRA.map((l, i) => {
          const d = i + 1, on = sel.has(d);
          return `<button data-d="${d}" aria-label="${NOMBRE_DIA[i]}" aria-pressed="${on}" class="w-10 h-10 rounded-xl border text-sm font-semibold transition ${on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold' : 'bg-telecab-card2 border-telecab-border text-telecab-muted hover:border-telecab-gold/40'}">${l}</button>`;
        }).join('');
        cont.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
          const d = Number(b.dataset.d); if (sel.has(d)) sel.delete(d); else sel.add(d); pinta();
        }));
      };
      fondo.querySelector('[data-x]').addEventListener('click', () => cerrar(undefined));
      fondo.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(undefined));
      fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(undefined); });
      fondo.querySelector('[data-guardar]').addEventListener('click', () => cerrar([...sel].sort((a, b) => a - b)));
      document.body.appendChild(fondo);
      pinta();
    });
  }
