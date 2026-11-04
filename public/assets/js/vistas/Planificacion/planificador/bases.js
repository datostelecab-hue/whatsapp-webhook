// El planificador · bases — Las bases (zonas): las tarjetas, elegir una y gestionarlas (cuadrantes, bloques, correturnos).
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ══════════ LAS BASES (05/10/2026) ══════════
  //
  // Las cinco bases son la entrada al cuadrante. Cada tarjeta es su iceberg:
  // cuántos coches están completos, cuántos tienen plazas vacías y cuántos no
  // tienen a nadie, y lo que le falta. Al pincharla se abren sus cuadrantes y las
  // tarjetas de arriba pasan a contar solo esa base. Las cuentas vienen hechas
  // del servidor (`resumen.porZona`, iceberg.js): aquí solo se pintan.

  const SIN_BASE = 'sin';
  const bases = () => (T && T.resumen && T.resumen.porZona) || [];
  const baseActual = () => (ZONA ? bases().find(b => b.clave === ZONA) || null : null);
  const resumenActual = () => baseActual() || (T && T.resumen) || {};
  const nombreEnUrl = s => plano(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const claveDeNombre = nombre => {
    const b = bases().find(x => nombreEnUrl(x.zona) === nombreEnUrl(nombre));
    return b ? b.clave : '';
  };
  const fmtH = n => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 });
  const fmtH1 = n => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  const medidor = h => `<span class="relative inline-block w-10 h-1 shrink-0 rounded-full bg-telecab-card2 overflow-hidden" aria-hidden="true">
      <span class="absolute inset-y-0 left-0 rounded-full bg-telecab-muted" style="width:${Math.min(100, Math.round((Number(h) || 0) / HORAS_LLENO * 100))}%"></span></span>`;

  // Los escalones del iceberg, de arriba abajo. Rojo, naranja y verde son
  // ESTADOS (Identidad visual): aquí lo son.
  const ESCALON = {
    completo:  { tit: 'Completos', punto: 'bg-telecab-green',
                 txt: 'Todas sus plazas tienen dueño, hoy o ya escrito. De más a menos horas instaladas.' },
    vacante:   { tit: 'Con plazas vacías', punto: 'bg-telecab-warn',
                 txt: 'Les falta un fijo o días de correturnos. De más a menos horas instaladas.' },
    vacio:     { tit: 'Sin nadie', punto: 'bg-telecab-red',
                 txt: 'Ni una persona puesta ni por llegar.' },
    sinCoches: { tit: 'Sin coches', punto: 'bg-telecab-muted',
                 txt: 'Cuadrantes creados sin ningún bloque todavía.' },
  };
  const escalonDe = x => (x && x.iceberg && ESCALON[x.iceberg.escalon]) ? x.iceberg.escalon : 'vacante';

  function tarjetaBase(b) {
    const on = ZONA === b.clave;
    const ic = b.iceberg || {};
    const total = b.cochesTotal || 0;
    const fijos = (b.fijosQueFaltanDia || 0) + (b.fijosQueFaltanNoche || 0);
    const cts = (b.ctQueFaltanDia || 0) + (b.ctQueFaltanNoche || 0);
    const falta = !total ? 'Sin coches todavía'
      : (fijos || cts) ? 'Faltan ' + [fijos ? `${fijos} fijo${fijos === 1 ? '' : 's'}` : '', cts ? `${cts} CT` : ''].filter(Boolean).join(' · ')
      : 'Nada por cubrir';
    const tramo = (n, cls) => (n ? `<span class="${cls}" style="flex:${n} 1 0%"></span>` : '');
    const titulo = !total
      ? `${b.zona} todavía no tiene coches. Pincha para crear su primer cuadrante.`
      : `${b.zona}: ${total} coches en ${b.cuadrantes} cuadrantes.\n` +
        `${ic.completo} completos · ${ic.vacante} con plazas vacías · ${ic.vacio} sin nadie` +
        (ic.parados ? ` · ${ic.parados} parado(s) en taller o siniestro` : '') + '.\n' +
        `Faltan ${b.fijosQueFaltanDia || 0} fijo(s) de día y ${b.fijosQueFaltanNoche || 0} de noche, ` +
        `y ${b.ctQueFaltanDia || 0} CT de día y ${b.ctQueFaltanNoche || 0} de noche.\n` +
        'Pincha para ver sus cuadrantes, de mejor a peor.';
    return `
      <button type="button" data-base="${esc(b.clave)}" aria-pressed="${on}" title="${esc(titulo)}"
              class="tc-pulsable text-left rounded-2xl border p-3 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-telecab-gold/50
                     ${on ? 'border-telecab-gold bg-telecab-gold/5' : 'border-telecab-border bg-telecab-card hover:border-telecab-gold/40'}">
        <span class="flex items-baseline gap-2 min-w-0">
          <span class="font-semibold truncate ${on ? 'text-telecab-gold' : ''}">${esc(b.zona)}</span>
          <span class="ml-auto text-xs text-telecab-muted tabular-nums whitespace-nowrap">${total} coche${total === 1 ? '' : 's'}</span>
        </span>
        <span class="mt-2 flex h-1.5 gap-px rounded-full overflow-hidden bg-telecab-card2" aria-hidden="true">
          ${tramo(ic.completo, 'bg-telecab-green')}${tramo(ic.vacante, 'bg-telecab-warn')}${tramo(ic.vacio, 'bg-telecab-red')}
        </span>
        <span class="mt-2 block text-[11px] text-telecab-muted tabular-nums truncate">${total
          ? `${ic.completo} completo${ic.completo === 1 ? '' : 's'} · ${ic.vacante} con vacías${ic.vacio ? ` · ${ic.vacio} sin nadie` : ''}`
          : 'Ningún cuadrante'}</span>
        <span class="block text-xs font-semibold mt-0.5 truncate ${total && (fijos || cts) ? 'text-telecab-warn' : 'text-telecab-muted'}">${falta}</span>
      </button>`;
  }

  function pintarBases() {
    const todas = bases();
    const visibles = todas.filter(b => b.clave !== SIN_BASE);
    $('#bases').innerHTML = visibles.map(tarjetaBase).join('');
    // Los coches sin base no son una sexta base: son coches por colocar. Salen
    // como un aviso pequeño, y solo si los hay.
    const sin = todas.find(b => b.clave === SIN_BASE);
    const bSin = $('#b-sinbase');
    bSin.classList.toggle('hidden', !sin);
    bSin.classList.toggle('inline-flex', !!sin);
    if (sin) {
      bSin.querySelector('span').textContent = `${sin.cochesTotal} coche${sin.cochesTotal === 1 ? '' : 's'} sin base`;
      bSin.setAttribute('aria-pressed', String(ZONA === SIN_BASE));
      bSin.classList.toggle('border-telecab-gold', ZONA === SIN_BASE);
      bSin.classList.toggle('text-telecab-gold', ZONA === SIN_BASE);
    }
  }

  /**
   * Abrir una base ('' = volver a todas). Con `apilar`, el navegador lo apunta
   * como un paso: «atrás» vuelve a las bases en vez de salir del planificador.
   */
  function elegirBase(clave, { apilar = true } = {}) {
    ZONA = clave || '';
    const b = baseActual();
    const destino = location.pathname + location.search + (b ? '#base=' + nombreEnUrl(b.zona) : '');
    try {
      if (apilar) history.pushState({ base: ZONA }, '', destino);
      else history.replaceState({ base: ZONA }, '', destino);
    } catch (_) { /* sin historial, la base se elige igual */ }
    pintarBases();
    pintarKpis();
    pintar();
    pintarLaterales();
    if (b) window.scrollTo({ top: Math.min(window.scrollY, $('#bases').offsetTop), behavior: 'auto' });
  }

  const baseDeLaUrl = () => {
    const m = String(location.hash || '').match(/base=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  // ── Zonas: las bases (21/10/2026) ─────────────────────────────────────────
  // Crear una zona, cambiarle el nombre o la ubicación, y pasar un cuadrante a
  // otra. Lo pidió Camilo el día que los coches de Usera pasaron a Getafe y se
  // abrió Aravaca. La ubicación la lee el servidor (ubicacion.js): coordenadas o
  // el enlace largo de Google Maps, y si no la entiende dice qué hacer.
  const AYUDA_UBICACION = 'Las coordenadas de la base («40.4617, -3.7856»: en Google Maps, clic derecho sobre el sitio y se copian) o el enlace largo de Google Maps. Sirven para proponer la zona más cercana al buscar correturnos.';

  async function gestionarZonas() {
    const porClave = new Map(bases().map(b => [String(b.clave), b]));
    const opciones = (T.zonas || []).map(z => {
      const b = porClave.get(String(z.id)) || {};
      const n = b.cochesTotal || 0, c = b.cuadrantes || 0;
      return { valor: String(z.id), texto: `${z.nombre} (${n
        ? `${n} coche${n === 1 ? '' : 's'} en ${c} cuadrante${c === 1 ? '' : 's'}`
        : (c ? `${c} cuadrante${c === 1 ? '' : 's'} sin coches` : 'sin cuadrantes')})` };
    });
    opciones.push({ valor: '__nueva__', texto: 'Nueva zona…' });
    const datos = await Dialogo.formulario('Zonas', [
      { id: 'zona', etiqueta: 'Elige una para cambiarle el nombre o la ubicación', tipo: 'lista', opciones, obligatorio: true },
    ], { textoBoton: 'Seguir', nota: 'Las zonas son las bases del planificador. A un cuadrante se le cambia la zona desde su cabecera.' });
    if (!datos || !datos.zona) return;
    await editarZona(datos.zona === '__nueva__' ? null : (T.zonas || []).find(z => String(z.id) === datos.zona));
  }

  /**
   * Crear una zona (`zona` vacía) o editarla. Si el servidor no la acepta, el
   * formulario vuelve con lo escrito y el motivo.
   */
  async function editarZona(zona) {
    let valores = {
      nombre: zona ? zona.nombre : '',
      ubicacion: zona && zona.lat != null ? `${zona.lat}, ${zona.lng}` : '',
    };
    for (;;) {
      const datos = await Dialogo.formulario(zona ? `Zona ${zona.nombre}` : 'Nueva zona', [
        { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', valor: valores.nombre, obligatorio: true, marcador: 'Aravaca' },
        { id: 'ubicacion', etiqueta: 'Ubicación de la base', tipo: 'texto', valor: valores.ubicacion, obligatorio: true,
          marcador: '40.4617, -3.7856', ayuda: AYUDA_UBICACION },
      ], {
        textoBoton: zona ? 'Guardar' : 'Crear zona',
        nota: zona ? 'El nombre nuevo sale a la vez en todas las pantallas.'
                   : 'Nace sin cuadrantes. Después creas uno en ella, o pasas uno que ya existe desde su cabecera.',
      });
      if (!datos) return;
      valores = datos;
      try {
        const j = await pedirTablero(
          zona ? `/planificador-v2/api/zonas/${encodeURIComponent(zona.id)}` : '/planificador-v2/api/zonas',
          { nombre: datos.nombre, ubicacion: datos.ubicacion, dia: DIA });
        // Si la renombrada es la base abierta, la dirección cambia con ella.
        if (zona && ZONA === String(zona.id)) elegirBase(ZONA, { apilar: false });
        Dialogo.hecho(zona ? `Zona ${j.zona.nombre} guardada` : `Zona ${j.zona.nombre} creada`);
        return;
      } catch (e) {
        await Dialogo.aviso({ titulo: zona ? 'No se pudo guardar la zona' : 'No se pudo crear la zona', texto: e.message, tono: 'error' });
      }
    }
  }

  /** Pasar un cuadrante a otra zona. Con una base abierta, se va de la vista: se dice adónde. */
  async function cambiarZonaDe(cu, nCoches) {
    const opciones = (T.zonas || []).map(z => ({ valor: String(z.id), texto: z.nombre }));
    const datos = await Dialogo.formulario(`Zona del ${cu.nombre}`, [
      { id: 'zona', etiqueta: 'Zona', tipo: 'lista', opciones, obligatorio: true, valor: cu.zonaId ? String(cu.zonaId) : '' },
    ], {
      textoBoton: 'Cambiar zona',
      nota: nCoches ? `Sus ${nCoches} coche${nCoches === 1 ? '' : 's'} pasa${nCoches === 1 ? '' : 'n'} con él: la zona de un coche es la de su cuadrante.`
                    : 'Todavía no tiene coches.',
    });
    if (!datos || !datos.zona || datos.zona === String(cu.zonaId || '')) return;
    try {
      const j = await pedirTablero(`/planificador-v2/api/cuadrantes/${encodeURIComponent(cu.id)}/zona`,
        { zonaId: Number(datos.zona), dia: DIA });
      Dialogo.hecho(`${cu.nombre} pasa a ${j.zona}`);
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se pudo cambiar la zona', texto: e.message, tono: 'error' });
    }
  }

  async function nuevoCuadrante() {
    const zonas = (T.zonas || []).map(z => ({ valor: String(z.id), texto: z.nombre }));
    if (!zonas.length) { await Dialogo.aviso({ titulo: 'Sin zonas', texto: 'No hay zonas dadas de alta.', tono: 'aviso' }); return null; }
    // Con una base abierta, el cuadrante nuevo nace en ella.
    const datos = await Dialogo.formulario('Nuevo cuadrante',
      [{ id: 'zona', etiqueta: 'Base', tipo: 'lista', opciones: zonas, obligatorio: true,
         valor: (ZONA && ZONA !== SIN_BASE) ? ZONA : '' }],
      { nota: 'El número se asigna solo. Después le añades los bloques (días + matrícula).' });
    if (!datos || !datos.zona) return null;
    try {
      const r = await fetchPlan('/planificador-v2/api/cuadrantes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zonaId: Number(datos.zona) }),
      });
      const j = await r.json();
      if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo crear');
      // Se abre su base y se lleva la vista hasta él: un cuadrante vacío va al
      // fondo del iceberg, y sin esto había que bajar a buscarlo.
      const otraBase = String(datos.zona) !== ZONA;
      await cargar(DIA);   // refresca cuadrantes/zonas en el payload
      if (otraBase) elegirBase(String(datos.zona), { apilar: false });
      if (j.id) {
        const sec = document.querySelector(`[data-cuadrante="${CSS.escape(String(j.id))}"]`);
        if (sec) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return j.id ? String(j.id) : null;
    } catch (e) { alert(e.message); return null; }
  }

  // Añadir un bloque: días (checkbox) + matrícula. La matrícula sale de los
  // coches sin cuadrante y del pool de emergencia (los que no tienen a nadie).
  async function anadirBloque(cuadranteId) {
    const dias = await editarDescanso({ titulo: 'Días del bloque', actual: [] });
    if (dias === undefined) return;
    if (!dias.length) { alert('Elige al menos un día'); return; }
    const candidatos = [
      // Un coche sin correturnos no hace bloque: entra con «Meter en un cuadrante».
      ...(T.coches || []).filter(c => !c.cuadranteId && !c.sinCT).map(c => ({ vehiculoId: c.vehiculoId, matricula: c.matricula, zona: c.zona })),
      ...(T.emergencia || []).map(c => ({ vehiculoId: c.vehiculoId, matricula: c.matricula, zona: c.zona })),
    ];
    const vistos = new Set(); const unicos = candidatos.filter(c => !vistos.has(c.vehiculoId) && vistos.add(c.vehiculoId));
    const vehiculoId = await pickCoche({ titulo: `Matrícula del bloque ${dias.map(d => DIAS_LETRA[d - 1]).join('/')}`, coches: unicos });
    if (!vehiculoId) return;
    try {
      await pedirTablero('/planificador-v2/api/cuadrante/bloque', { cuadranteId, vehiculoId, dias, dia: DIA });
    } catch (e) { alert(e.message); }
  }

  async function meterEnCuadrante(coche) {
    const opciones = (T.cuadrantes || []).map(c => ({ valor: c.id, texto: `${c.nombre}${c.zona ? ' · ' + c.zona : ''} (${c.coches})` }));
    opciones.push({ valor: '__nuevo__', texto: '＋ Nuevo cuadrante…' });
    const elegido = await Dialogo.elegir({ titulo: `Meter ${coche.matricula} en un cuadrante`, opciones });
    if (!elegido) return;
    let id = elegido;
    if (elegido === '__nuevo__') { id = await nuevoCuadrante(); if (!id) return; }
    try {
      await pedirTablero('/planificador-v2/api/cuadrante/coche', { vehiculoId: coche.vehiculoId, cuadranteId: id, dia: DIA });
    } catch (e) { alert(e.message); }
  }

  // Escribe sin diálogo de por medio: el botón se apaga mientras dura, porque
  // sin el velo de los clics un doble clic lo mandaba dos veces (03/11/2026).
  async function sacarDeCuadrante(coche, boton) {
    const estaba = boton ? boton.disabled : false;
    if (boton) boton.disabled = true;
    try {
      await pedirTablero('/planificador-v2/api/cuadrante/coche', { vehiculoId: coche.vehiculoId, cuadranteId: null, dia: DIA });
    } catch (e) { alert(e.message); }
    finally { if (boton) boton.disabled = estaba; }
  }

  async function borrarCuadranteUI(id, nombre) {
    const ok = await Dialogo.confirmar({
      titulo: `Borrar el cuadrante ${nombre}`, tono: 'aviso', si: 'Borrar', no: 'Cancelar',
      html: '<p>Los coches quedan sueltos. No se toca su gente ni su libranza.</p>',
    });
    if (!ok) return;
    try {
      await pedirTablero(`/planificador-v2/api/cuadrantes/${encodeURIComponent(id)}?dia=${encodeURIComponent(DIA)}`, null, 'DELETE');
    } catch (e) { alert(e.message); }
  }

  async function asignarCTCuadrante(cuadranteId, turno, lista, actual) {
    // `actual` = el CT que ya tiene el cuadrante (si es uno solo): así el selector
    // ofrece "Dejar la plaza vacía", que es el ÚNICO camino para quitar un CT de
    // todos los bloques de golpe — el servidor lo admite desde siempre
    // (conductorId vacío) pero la pantalla no daba forma de pedirlo.
    const ct = actual ? porId.get(String(actual)) : null;
    const id = await pickConductor({ titulo: `CT ${turno} del cuadrante`, turno, actual: actual || null,
      ficha: ct && { id: String(ct.id), nombre: ct.nombre, nota: `CT de ${turno === 'dia' ? 'día' : turno} del cuadrante` } });
    if (id === undefined) return;   // cancelado
    let vehiculos = [];
    if (id) {
      // Qué bloques (matrículas) cubre este CT. Por defecto, todos.
      vehiculos = await elegirBloques(lista || []);
      if (vehiculos === undefined) return;               // cancelado
      if (!vehiculos.length) { alert('Elige al menos un bloque para el CT'); return; }
    }
    try {
      const j = await pedirTablero('/planificador-v2/api/cuadrante/ct',
        { cuadranteId, turno, conductorId: id || '', vehiculos, dia: DIA });
      // Los bloques que ese día ya tenían conductor NO se tocan en bloque:
      // meterse ahí es apartar a alguien, y eso lleva motivo y nombre.
      if ((j.saltados || []).length) {
        await Dialogo.aviso({
          titulo: 'Hay bloques que ya tenían conductor', tono: 'aviso',
          texto: `No se ha tocado ${j.saltados.join(', ')}: esos días ya los cubre otro. ` +
            'Si aun así tiene que entrar, hazlo coche a coche desde su columna y di por qué se aparta al otro.',
        });
      }
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  /**
   * «SIN CORRETURNOS» (db/203). Ponerlo quita sus correturnos desde el día que
   * se mira (nunca antes de hoy), oculta sus columnas y le da a cada fijo su
   * descanso, que empieza siendo el del coche. Quitarlo pide el descanso que
   * vuelve a tener el coche, el que cubrirá su correturnos.
   */
  async function sinCorreturnosUI(coche) {
    const desde = isoAes(desdeSinCT());
    if (coche.sinCT) {
      const dias = await editarDescanso({ titulo: `Volver a tener correturnos · ${coche.matricula}`,
        actual: (coche.descansoTurno || {}).dia || [],
        nota: `Desde el ${desde}. El descanso del coche (los dos fijos a la vez), que es lo que cubrirá su correturnos. Después se pone el correturnos como en cualquier coche.` });
      if (dias === undefined) return;
      try {
        await pedirTablero('/planificador-v2/api/sin-correturnos', { vehiculoId: coche.vehiculoId, activar: false, dias, dia: DIA });
        Dialogo.hecho(`${coche.matricula} vuelve a llevar correturnos`);
      } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
      return;
    }
    // Quién deja de llevarlo: los correturnos de hoy y los que estaban por llegar.
    const cts = [];
    (coche.personas || []).forEach(p => {
      if (!p || p.slot < 2) return;
      if (p.id) cts.push(`${p.nombre} (${p.etiqueta})`);
      if (p.futuro) cts.push(`${p.futuro.nombre} (${p.etiqueta}, llegaba el ${isoAes(p.futuro.desde)})`);
    });
    const descanso = (coche.descanso || []).length ? diasTexto(coche.descanso) : '';
    const ok = await Dialogo.confirmar({
      titulo: `Sin correturnos · ${coche.matricula}`, tono: 'aviso', ancho: 'max-w-lg',
      si: 'Quitar correturnos', no: 'Cancelar',
      html: `<p class="text-sm mb-2">Desde el <b>${esc(desde)}</b> este coche no lleva correturnos:</p>
        <ul class="text-sm list-disc pl-5 space-y-1 mb-2">
          <li>${cts.length ? 'Se quitan de este coche: <b>' + cts.map(esc).join(', ') + '</b>. Si no tienen otra plaza, pasan al banquillo.' : 'Ahora no tiene correturnos puestos.'}</li>
          <li>Se ocultan sus columnas de correturnos y no se pueden agregar personas en ellas.</li>
          <li>Cada fijo pasa a tener su propio descanso${descanso ? `; los dos empiezan con el del coche (<b>${esc(descanso)}</b>) y luego se cambia el de cada uno` : ''}. Los días que libre un fijo, ese turno el coche no sale.</li>
          <li>Puede seguir en su cuadrante: es para tener uno.</li>
        </ul>`,
    });
    if (!ok) return;
    try {
      const j = await pedirTablero('/planificador-v2/api/sin-correturnos', { vehiculoId: coche.vehiculoId, dia: DIA });
      const quitados = (j.quitados || []).map(q => `${q.nombre} (CT ${String(q.turno || '').toLowerCase()})`);
      if (quitados.length || (j.vacantes || []).length) {
        await Dialogo.aviso({
          titulo: `${coche.matricula} ya no lleva correturnos`, tono: 'aviso',
          texto: (quitados.length ? `Se han quitado de este coche: ${quitados.join(', ')}. Si no tienen otra plaza, están en el banquillo. ` : '') +
            ((j.vacantes || []).length ? `Ojo: la vacante ${j.vacantes.join(', ')} tenía prometida una de sus plazas de correturnos; díselo a Selección.` : ''),
        });
      } else {
        Dialogo.hecho(`${coche.matricula} sin correturnos`);
      }
    } catch (e) { await Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
  }

  // Elegir qué bloques (coches del cuadrante) cubre un CT. Por defecto, todos.
  function elegirBloques(lista) {
    return new Promise(resolve => {
      const sel = new Set((lista || []).map(c => String(c.vehiculoId)));
      const fondo = document.createElement('div');
      fondo.className = 'fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4';
      fondo.innerHTML = `
        <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft w-full max-w-sm my-16">
          <div class="flex items-center justify-between px-4 py-3 border-b border-telecab-border">
            <h3 class="font-semibold">¿Qué días/bloques cubre?</h3>
            <button data-x class="w-8 h-8 rounded-lg hover:bg-telecab-card2 text-telecab-muted" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          </div>
          <div class="p-4">
            <p class="text-xs text-telecab-muted mb-3">Los bloques que cubre el correturnos. Los demás días serán su libranza.</p>
            <div class="space-y-1.5" data-lista></div>
            <div class="flex gap-2 mt-4">
              <button data-guardar class="flex-1 px-3 py-2 rounded-xl bg-telecab-gold text-telecab-dark font-semibold text-sm">Guardar</button>
              <button data-cancelar class="px-3 py-2 rounded-xl bg-telecab-card border border-telecab-border text-sm">Cancelar</button>
            </div>
          </div>
        </div>`;
      const cerrar = v => { document.body.removeChild(fondo); resolve(v); };
      const cont = fondo.querySelector('[data-lista]');
      const pinta = () => {
        cont.innerHTML = (lista || []).map(c => {
          const on = sel.has(String(c.vehiculoId));
          const dias = (c.descanso && c.descanso.length) ? diasTexto(c.descanso) : '—';
          return `<button data-v="${esc(c.vehiculoId)}" aria-pressed="${on}" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition ${on ? 'bg-telecab-gold/10 border-telecab-gold/40' : 'border-telecab-border hover:bg-telecab-card2'}">
            <i class="fa-${on ? 'solid fa-square-check text-telecab-gold' : 'regular fa-square text-telecab-muted'}" aria-hidden="true"></i>
            <span class="text-sm font-medium">${esc(c.matricula)}</span><span class="text-xs text-telecab-muted ml-auto">${esc(dias)}</span></button>`;
        }).join('') || '<p class="text-xs text-telecab-muted text-center py-3">El cuadrante no tiene bloques.</p>';
        cont.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
          const v = b.dataset.v; if (sel.has(v)) sel.delete(v); else sel.add(v); pinta();
        }));
      };
      fondo.querySelector('[data-x]').addEventListener('click', () => cerrar(undefined));
      fondo.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(undefined));
      fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(undefined); });
      fondo.querySelector('[data-guardar]').addEventListener('click', () => cerrar([...sel]));
      document.body.appendChild(fondo);
      pinta();
    });
  }
