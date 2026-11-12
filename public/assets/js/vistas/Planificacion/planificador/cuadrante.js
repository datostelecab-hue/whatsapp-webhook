// El planificador · cuadrante — El cuadrante: cargar el tablero, pintarlo por zona, los coches sin correturnos, repintar solo lo cambiado y las horas.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── Cargar ────────────────────────────────────────────────────────────────
  async function cargar(dia) {
    const q = dia ? ('?dia=' + encodeURIComponent(dia)) : '';
    const r = await fetchPlan('/planificador-v2/api/tablero' + q);
    const j = await r.json();
    if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo cargar el cuadrante');
    aplicar(j);
  }

  // ── El cuadrante, por zona ───────────────────────────────────────────────────
  const plano = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Un HUECO = una PLAZA VISIBLE (fijo día/noche o CT día/noche = slots 0-3) sin
  // nadie asignado. Incluye los huecos de CORRETURNOS, no solo los de fijos. (No
  // cuenta "días sin cubrir": casi todo coche tiene el finde sin CT y eso mostraba a
  // todos con "solo con huecos".)
  const tieneHueco = c => [0, 1, 2, 3].some(s => !((c.personas || [])[s] || {}).id);
  // LA BASE de un coche o de un cuadrante la dice el servidor (iceberg.js): la
  // del CUADRANTE si el coche está en uno, y si no, la suya. Así lo que se ve y
  // lo que cuentan las tarjetas no se pueden separar.
  const zonaDe = x => (x && x.iceberg && x.iceberg.zona) || SIN_BASE;
  const ordenIce = x => (x && x.iceberg && x.iceberg.orden != null ? x.iceberg.orden : 1e6);
  const ordenBase = clave => { const i = bases().findIndex(b => b.clave === clave); return i < 0 ? 1e3 : i; };
  function cochesVisibles() {
    const soloHuecos = $('#f-huecos').checked;
    const q = plano($('#f-busca').value).trim();
    return (T.coches || []).filter(c => {
      if (ZONA && zonaDe(c) !== ZONA) return false;
      if (soloHuecos && !tieneHueco(c)) return false;
      if (q) {
        // TAMBIÉN LOS QUE ESTÁN POR LLEGAR. Una plaza puede estar vacía hoy y
        // tener dueño para el lunes («→ Cristian · llega 21/09»), y buscar por
        // su nombre contestaba «no hay nada» justo cuando lo que quieres es ver
        // dónde cae. Lo mismo con la vacante que tiene prometida la plaza.
        const txt = plano(c.matricula + ' ' + (c.personas || []).map(p => {
          if (!p) return '';
          const per = p.id ? (porId.get(String(p.id)) || {}) : {};
          return [p.nombre, per.telefono, per.barrio,
            p.futuro && p.futuro.nombre,
            p.vacante && (p.vacante.codigo || p.vacante.sustituye)].filter(Boolean).join(' ');
        }).join(' '));
        if (!txt.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => ordenIce(a) - ordenIce(b));
  }

  // Las 4 columnas del Excel: Fijo día/noche, CT día/noche (slots 0,1,2,3).
  // LAS COLUMNAS DEL TABLERO. Las cuatro de siempre, y en MODO EVENTOS dos más:
  // las plazas de refuerzo. No son nuevas —los slots 4 y 5 existen en la base
  // desde el primer día para los 100 coches— simplemente no se enseñaban, porque
  // abrirlas a mano significa que alguien tiene que acordarse de cerrarlas.
  const COLS_BASE = [
    { slot: 0, tit: 'Fijo día',  turno: 'dia' },
    { slot: 1, tit: 'Fijo noche', turno: 'noche' },
    { slot: 2, tit: 'CT día',    turno: 'dia' },
    { slot: 3, tit: 'CT noche',  turno: 'noche' },
  ];
  const COLS_REFUERZO = [
    { slot: 4, tit: 'CT día 2',   turno: 'dia',   refuerzo: true },
    { slot: 5, tit: 'CT noche 2', turno: 'noche', refuerzo: true },
  ];
  const cols = () => (T && T.refuerzoVisible ? COLS_BASE.concat(COLS_REFUERZO) : COLS_BASE);

  // ── COCHES SIN CORRETURNOS (15/10/2026, db/203) ───────────────────────────
  // No llevan CT y cada fijo libra sus días. Sus columnas de correturnos no se
  // enseñan: si toda la tabla son coches así, desaparecen; si se mezclan, en su
  // fila va el aviso en su lugar.
  const AVISO_SIN_CT = 'Este coche no tiene correturnos: no se pueden agregar personas en esta matrícula.';
  const colsDe = coche => cols().filter(c => !(coche.sinCT && c.slot >= 2));
  const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  /** Desde cuándo vale un cambio de «sin correturnos»: el día que se mira, nunca antes de hoy. */
  const desdeSinCT = () => (DIA && DIA > hoyLocal() ? DIA : hoyLocal());

  /** Los dos botones de libranza de un coche sin correturnos: el del fijo de día y el de noche. */
  function botonesLibranzaFijos(coche, compacto) {
    const t = coche.descansoTurno || {};
    const boton = (turno, icono) => {
      const dias = t[turno] || [];
      const txt = dias.length ? diasTexto(dias) : 'no libra';
      return `<button type="button" data-desc-turno="${turno}" title="${esc(`Los días que libra el fijo de ${turno === 'dia' ? 'día' : 'noche'}. Ese turno, esos días, el coche no sale.`)}"
                class="inline-flex items-center gap-1 ${compacto ? 'px-1.5 py-0.5 rounded-md text-[11px]' : 'px-2 py-1 rounded-lg text-xs'} font-semibold border transition-colors hover:border-telecab-gold/50
                       ${dias.length ? 'bg-telecab-gold/10 text-telecab-gold border-telecab-gold/30' : 'border-dashed border-telecab-border text-telecab-muted'}">
                <i class="fa-solid ${icono} text-[9px]"></i>${esc(txt)}</button>`;
    };
    return boton('dia', 'fa-sun') + boton('noche', 'fa-moon');
  }

  /** La marca del coche sin correturnos, con el aviso en el título. */
  const chipSinCT = coche => `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide
      bg-telecab-card2 border border-telecab-border text-telecab-muted" title="${esc(AVISO_SIN_CT + (coche.sinCTDesde ? ' Desde el ' + isoAes(coche.sinCTDesde) + '.' : ''))}">
      <i class="fa-solid fa-user-slash text-[9px]"></i>Sin correturnos</span>`;

  // El CT (día/noche) de un cuadrante: el ocupante de la plaza CT en sus coches.
  // Si es el mismo en todos, ese es el CT del cuadrante; si difieren, 'varios'.
  function ctDelCuadrante(lista, slot) {
    const ids = new Set();
    lista.forEach(c => { const p = (c.personas || [])[slot]; if (p && p.id) ids.add(String(p.id)); });
    if (ids.size === 1) return porId.get([...ids][0]) || null;
    return ids.size > 1 ? 'varios' : null;
  }

  // La libranza de un CT = el complemento de los días de SUS BLOQUES (su patrón:
  // la unión de los descansos de los coches donde es CT), no de lo que cubrió esa
  // semana en concreto (que depende de cuándo empezó la asignación).
  const libraCT = persona => {
    if (!persona) return '';
    const trabaja = new Set();
    (T.coches || []).forEach(c => [2, 3].forEach(slot => {
      const p = (c.personas || [])[slot];
      if (p && String(p.id) === String(persona.id)) (c.descanso || []).forEach(d => trabaja.add(Number(d)));
    }));
    return [1, 2, 3, 4, 5, 6, 7].filter(d => !trabaja.has(d)).map(d => DIAS_LETRA[d - 1]).join(' ');
  };

  function tablaCoches(lista, enCuadrante) {
    // Si TODOS son coches sin correturnos, sus columnas sobran (db/203).
    const columnas = lista.length && lista.every(c => c.sinCT) ? cols().filter(c => c.slot < 2) : cols();
    const wrap = document.createElement('div');
    wrap.className = 'overflow-x-auto border border-telecab-border rounded-2xl';
    wrap.innerHTML = `
      <table class="w-full text-sm border-collapse">
        <thead class="bg-telecab-card2 text-telecab-muted text-[11px] uppercase tracking-wide">
          <tr>
            <th class="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Matrícula</th>
            <th class="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Descanso</th>
            ${columnas.map(c => `<th class="text-left font-semibold px-3 py-2.5">${c.tit}</th>`).join('')}
            <th class="w-10"></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>`;
    const tb = wrap.querySelector('tbody');
    lista.forEach(coche => tb.appendChild(filaCoche(coche, enCuadrante, columnas)));
    return wrap;
  }

  /** El cuerpo de un grupo de coches, en la vista elegida. */
  const cochesEnVista = (lista, enCuadrante) =>
    (VISTA === 'vertical' ? tarjetasCoches(lista, enCuadrante) : tablaCoches(lista, enCuadrante));

  /**
   * Las horas instaladas de un cuadrante, para su cabecera. Se ordena por la
   * MEDIA por coche: con la suma, uno de tres coches flojos pasaba delante de
   * uno de dos muy buenos solo por tener más coches.
   */
  function horasDelCuadrante(cu) {
    const ic = cu.iceberg;
    if (!ic || !ic.coches) return '';
    const tit = `Horas instaladas esta semana: ${fmtH1(ic.horas)} h entre sus ${ic.coches} coches, ${fmtH1(ic.media)} h de media por coche.\n` +
      'Cada turno suma el promedio de horas por día trabajado de quien lo cubre. El cuadrante se ordena por la media, ' +
      'para que uno de tres coches no pase delante solo por tener más. La barra llena son 14 turnos a 9 h.';
    return `<span class="inline-flex items-center gap-1.5 text-xs text-telecab-muted tabular-nums" title="${esc(tit)}">
      ${medidor(ic.media)}<b class="text-telecab-text font-semibold">${fmtH(ic.horas)} h</b>
      <span>· ${fmtH(ic.media)} h por coche</span></span>`;
  }

  function seccionCuadrante(cu, lista) {
    const sec = document.createElement('section');
    sec.dataset.cuadrante = cu.id;
    sec.className = 'scroll-mt-24';   // que la barra de arriba no tape la cabecera al saltar aquí
    // El CT del cuadrante es de los coches que llevan correturnos; los que no
    // (db/203) están en el cuadrante para tenerlo, no para que el CT los cubra.
    const conCT = lista.filter(c => !c.sinCT);
    const nSinCT = lista.length - conCT.length;
    const ctDia = ctDelCuadrante(conCT, 2), ctNoche = ctDelCuadrante(conCT, 3);
    const chipCT = (persona, turno) => {
      const nombre = persona === 'varios' ? 'Varios' : (persona ? persona.nombre : null);
      const libra = (persona && persona !== 'varios') ? libraCT(persona) : '';
      return `<button data-ct="${turno}" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition
                ${nombre ? 'bg-telecab-violet/10 text-telecab-violet border-telecab-violet/30' : 'border-dashed border-telecab-border text-telecab-muted'} hover:border-telecab-gold/50">
              <i class="fa-solid fa-user-group"></i>CT ${turno}: ${nombre ? esc(nombre) : 'asignar'}${libra ? ` <span class="text-telecab-muted">libra ${esc(libra)}</span>` : ''}</button>`;
    };
    // La zona del cuadrante. Quien puede editar la cambia aquí mismo
    // (21/10/2026): sus coches van con él.
    const zonaCab = !PUEDE_EDITAR ? (cu.zona ? esc(cu.zona) + ' · ' : '')
      : `<button type="button" data-zona-cua title="Cambiar la zona de este cuadrante: sus coches van con él"
                 class="tc-pulsable inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-telecab-gold">
           <i class="fa-solid fa-location-dot text-[10px]"></i>${cu.zona ? esc(cu.zona) : 'poner zona'}</button> · `;
    const cab = document.createElement('div');
    cab.className = 'flex flex-wrap items-center gap-2 mb-2';
    cab.innerHTML = `
      <h3 class="text-sm font-semibold uppercase tracking-wide text-telecab-gold flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${ESCALON[escalonDe(cu)].punto}" title="${esc(ESCALON[escalonDe(cu)].tit)}"></span>
        ${esc(cu.nombre)}
        <span class="text-telecab-muted font-normal normal-case">${zonaCab}${conCT.length} bloque(s)${
          nSinCT ? ` · ${nSinCT} sin correturnos` : ''}</span>
      </h3>
      ${horasDelCuadrante(cu)}
      <button data-bloque class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-telecab-card border border-telecab-border hover:border-telecab-gold/50 transition"><i class="fa-solid fa-plus"></i> Bloque</button>
      <div class="flex items-center gap-2 ml-1">${chipCT(ctDia, 'día')}${chipCT(ctNoche, 'noche')}</div>
      ${lista.length ? `<span class="ml-auto"></span>${huecoChipAviso(lista)}<button data-waturnos class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600/15 text-green-400 hover:bg-green-600/25 transition"
              title="Enviar por WhatsApp a la gente de este cuadrante sus turnos de la semana que estás mirando">
        <i class="fa-brands fa-whatsapp"></i> Enviar turnos</button>` : ''}
      <button data-borrar-cua class="${lista.length ? '' : 'ml-auto '}text-xs text-telecab-muted hover:text-telecab-red transition"><i class="fa-solid fa-trash"></i> borrar cuadrante</button>`;
    const bWa = cab.querySelector('[data-waturnos]');
    if (bWa) bWa.addEventListener('click', e => enviarTurnosCuadrante(cu.nombre, lista, e.currentTarget));
    cab.querySelector('[data-bloque]').addEventListener('click', () => anadirBloque(cu.id));
    cab.querySelector('[data-ct="día"]').addEventListener('click', () =>
      asignarCTCuadrante(cu.id, 'dia', conCT, (ctDia && ctDia !== 'varios') ? ctDia.id : null));
    cab.querySelector('[data-ct="noche"]').addEventListener('click', () =>
      asignarCTCuadrante(cu.id, 'noche', conCT, (ctNoche && ctNoche !== 'varios') ? ctNoche.id : null));
    cab.querySelector('[data-borrar-cua]').addEventListener('click', () => borrarCuadranteUI(cu.id, cu.nombre));
    guardarListaChip(cab, lista);
    const bZona = cab.querySelector('[data-zona-cua]');
    if (bZona) bZona.addEventListener('click', () => cambiarZonaDe(cu, lista.length));
    sec.appendChild(cab);
    if (lista.length) {
      sec.appendChild(cochesEnVista(lista, true));
    } else {
      const vac = document.createElement('p');
      vac.className = 'text-xs text-telecab-muted px-3 py-4 border border-dashed border-telecab-border rounded-2xl text-center';
      vac.textContent = 'Cuadrante vacío. Pulsa "Bloque" para añadir días + matrícula.';
      sec.appendChild(vac);
    }
    return sec;
  }

  function seccionSueltos(lista) {
    const sec = document.createElement('section');
    const cab = document.createElement('div');
    cab.className = 'flex flex-wrap items-center gap-2 mb-2';
    cab.innerHTML = `
      <h3 class="text-sm font-semibold uppercase tracking-wide text-telecab-muted flex items-center gap-2">
        <i class="fa-solid fa-car-side"></i>Coches sueltos <span class="font-normal normal-case">${lista.length}</span></h3>
      <span class="ml-auto"></span>${huecoChipAviso(lista)}
      <button data-waturnos class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600/15 text-green-400 hover:bg-green-600/25 transition"
              title="Enviar por WhatsApp a la gente de estos coches sus turnos de la semana que estás mirando">
        <i class="fa-brands fa-whatsapp"></i> Enviar turnos</button>`;
    cab.querySelector('[data-waturnos]').addEventListener('click', e => enviarTurnosCuadrante('coches sueltos', lista, e.currentTarget));
    guardarListaChip(cab, lista);
    sec.appendChild(cab);
    sec.appendChild(cochesEnVista(lista, false));
    return sec;
  }

  /**
   * La franja que abre cada escalón del iceberg: qué es, cuántos cuadrantes y
   * coches caen en él, y en qué orden van.
   */
  function franjaEscalon(escalon, cuadrantes, porCua) {
    const e = ESCALON[escalon];
    const coches = cuadrantes.reduce((s, cu) => s + (porCua.get(String(cu.id)) || []).length, 0);
    const div = document.createElement('div');
    div.className = 'flex items-center gap-3 pt-1';
    div.innerHTML = `
      <span class="w-2.5 h-2.5 rounded-full shrink-0 ${e.punto}"></span>
      <h3 class="text-xs font-semibold uppercase tracking-wider whitespace-nowrap">${esc(e.tit)}</h3>
      <span class="text-xs text-telecab-muted tabular-nums whitespace-nowrap" title="${esc(e.txt)}">${cuadrantes.length} cuadrante${cuadrantes.length === 1 ? '' : 's'}${
        coches ? ` · ${coches} coche${coches === 1 ? '' : 's'}` : ''}</span>
      <span class="flex-1 h-px bg-telecab-border"></span>`;
    return div;
  }

  /**
   * Sin base abierta, cada base abre su tramo con su nombre, lo que tiene y lo
   * que le falta: lo mismo que su tarjeta de arriba. Pincharla deja solo esa.
   */
  function cabeceraBase(clave) {
    const b = bases().find(x => x.clave === clave);
    const fijos = b ? (b.fijosQueFaltanDia || 0) + (b.fijosQueFaltanNoche || 0) : 0;
    const cts = b ? (b.ctQueFaltanDia || 0) + (b.ctQueFaltanNoche || 0) : 0;
    const falta = (fijos || cts) ? 'Faltan ' + [fijos ? `${fijos} fijo${fijos === 1 ? '' : 's'}` : '', cts ? `${cts} CT` : ''].filter(Boolean).join(' · ') : '';
    const div = document.createElement('div');
    div.className = 'flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-4 border-t border-telecab-border first:pt-0 first:border-t-0';
    div.innerHTML = `
      <h3 class="text-base font-semibold whitespace-nowrap">${esc(b ? b.zona : 'Sin base')}</h3>
      ${b ? `<span class="text-xs text-telecab-muted tabular-nums">${b.cochesTotal} coche${b.cochesTotal === 1 ? '' : 's'} · ${b.cuadrantes} cuadrante${b.cuadrantes === 1 ? '' : 's'}</span>` : ''}
      ${falta ? `<span class="text-xs font-semibold text-telecab-warn">${esc(falta)}</span>` : ''}
      ${b ? `<button type="button" data-solo-base class="tc-pulsable ml-auto text-xs text-telecab-muted hover:text-telecab-gold">Ver solo ${b.clave === SIN_BASE ? 'estos' : esc(b.zona)} <i class="fa-solid fa-arrow-right text-[10px]"></i></button>` : ''}`;
    const btn = div.querySelector('[data-solo-base]');
    if (btn) btn.addEventListener('click', () => elegirBase(b.clave));
    return div;
  }

  /** Una base abierta sin cuadrantes todavía. */
  function baseVacia(b) {
    const div = document.createElement('div');
    div.className = 'px-6 py-10 text-center border border-dashed border-telecab-border rounded-2xl';
    div.innerHTML = `
      <p class="text-sm font-semibold">${esc(b.zona)} todavía no tiene cuadrantes</p>
      ${PUEDE_EDITAR ? '<p class="mt-1 text-xs text-telecab-muted">Crea uno y añádele bloques (días + matrícula).</p>' : ''}
      ${PUEDE_EDITAR && b.clave !== SIN_BASE ? `<button type="button" data-crear class="tc-pulsable mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-telecab-gold text-telecab-dark font-semibold text-sm">
        <i class="fa-solid fa-plus"></i>Nuevo cuadrante en ${esc(b.zona)}</button>` : ''}`;
    const btn = div.querySelector('[data-crear]');
    if (btn) btn.addEventListener('click', nuevoCuadrante);
    return div;
  }

  // EL ICEBERG. Los cuadrantes de cada base de mejor a peor: primero los
  // completos, luego los que tienen plazas vacías y al final los que no tienen
  // a nadie; dentro de cada escalón, los que ruedan antes que los del taller, y
  // más horas instaladas primero. El ORDEN lo pone el servidor (`iceberg.orden`):
  // aquí solo se agrupa. Ya no se ordena por número.
  //
  // SIN PULSAR NADA SE VEN TODOS (06/10/2026, Camilo): base a base, en el orden
  // de las tarjetas de arriba, y dentro de cada una su iceberg. Al pinchar una
  // base queda solo la suya.
  function pintar() {
    const cont = $('#cuadrante');
    const buscando = !!plano($('#f-busca').value).trim();
    const filtrando = buscando || $('#f-huecos').checked;

    const coches = cochesVisibles();

    // Coches por cuadrante; los sueltos aparte.
    const porCua = new Map(); const sueltos = [];
    coches.forEach(c => {
      if (c.cuadranteId) { const k = String(c.cuadranteId); if (!porCua.has(k)) porCua.set(k, []); porCua.get(k).push(c); }
      else sueltos.push(c);
    });

    // Los cuadrantes de la base (incluidos los vacíos, recién creados). Al
    // FILTRAR (buscando o solo-huecos), un cuadrante sin coches que pasen el
    // filtro se oculta: si no, salía como "vacío" y parecía que el filtro no
    // hacía nada. Sin filtro, los vacíos siguen (para poder añadir bloques).
    // POR NÚMERO (12/11/2026, Camilo: «que los cuadrantes del planificador
    // puedan ordenarse por número … desde el 1 hasta el último»): del 1 al
    // último, sin agrupar por base ni partir en escalones. El iceberg sigue
    // siendo lo de siempre (`ORDEN`, el selector de la barra).
    const porNumero = ORDEN === 'numero';
    const numDe = cu => Number(cu.numero) || Number(String(cu.nombre || '').replace(/\D+/g, '')) || 1e6;
    const cuadrantes = (T.cuadrantes || [])
      .filter(cu => (!ZONA || zonaDe(cu) === ZONA) && (!filtrando || (porCua.get(String(cu.id)) || []).length))
      .sort(porNumero
        ? (a, b) => numDe(a) - numDe(b)
        : (a, b) => (ZONA ? 0 : ordenBase(zonaDe(a)) - ordenBase(zonaDe(b))) || ordenIce(a) - ordenIce(b));

    const hayAlgo = cuadrantes.length || sueltos.length;
    const b = baseActual();
    if (!hayAlgo && b && !filtrando) {
      cont.classList.remove('hidden');
      $('#vacio').classList.add('hidden');
      ponerSecciones(cont, [{ crear: () => baseVacia(b) }]);
      return;
    }
    $('#vacio').classList.toggle('hidden', hayAlgo > 0);
    cont.classList.toggle('hidden', !hayAlgo);

    // Sin base abierta, cada base lleva su cabecera; dentro de cada base, una
    // franja por escalón. Buscando, solo la cabecera de base: con pocos
    // resultados, las franjas serían más ruido que ayuda.
    const piezas = [];
    let base = null, escalon = null;
    cuadrantes.forEach(cu => {
      const z = zonaDe(cu);
      // Por número no hay bases ni escalones que separar: la lista va seguida.
      if (!porNumero && !ZONA && z !== base) {
        base = z; escalon = null;
        piezas.push({ clave: 'base:' + z, crear: () => cabeceraBase(z) });
      }
      const e = escalonDe(cu);
      if (!porNumero && !buscando && e !== escalon) {
        escalon = e;
        const delEscalon = cuadrantes.filter(x => zonaDe(x) === z && escalonDe(x) === e);
        piezas.push({ clave: 'franja:' + z + ':' + e, crear: () => franjaEscalon(e, delEscalon, porCua) });
      }
      const lista = porCua.get(String(cu.id)) || [];
      piezas.push({ clave: 'cu:' + cu.id, firma: firmaSeccion(cu, lista), crear: () => seccionCuadrante(cu, lista) });
    });
    // Los coches sin cuadrante, al final: con todas las bases a la vista, bajo
    // su propia cabecera para que no parezcan de la última base.
    if (sueltos.length) {
      if (!ZONA) piezas.push({ clave: 'base:' + SIN_BASE, crear: () => cabeceraBase(SIN_BASE) });
      piezas.push({ clave: 'sueltos', firma: firmaSeccion(null, sueltos), crear: () => seccionSueltos(sueltos) });
    }
    ponerSecciones(cont, piezas);
  }

  // LA FIRMA: lo que leen seccionCuadrante/seccionSueltos y todo lo que llaman
  // al pintar (sacado del código ese día). Sus coches; la ficha de su gente en
  // porId (nombre, ausencias, letra, bloqueo de motor…); la libranza de sus CT,
  // que sale de los coches de OTROS cuadrantes (libraCT); la vista y las
  // columnas; el día y la fecha de hoy (las ausencias, «sin CT desde»); y la
  // mediana de horas del título de cada coche. El chip de avisos NO: se rellena
  // aparte (pintarChipsAviso). Si un día el pintado de una sección lee algo
  // más, tiene que entrar aquí: si no, esa sección no se repintaría al cambiar.
  //
  // Lo que se deja FUERA: `iceberg.orden`, el puesto de cada coche en toda la
  // flota. Un coche que cambia de estado los renumera a todos (46 de 46 en la
  // prueba) y rehacía 25 secciones de 31 por un número que no se pinta: solo
  // ordena, y el orden ya está en la firma —es el de la propia lista—.
  const SIN_ORDEN = (k, v) => (k === 'orden' ? undefined : v);
  function firmaSeccion(cu, lista) {
    const gente = new Set();
    lista.forEach(c => (c.personas || []).forEach(p => { if (p && p.id) gente.add(String(p.id)); }));
    const conCT = lista.filter(c => !c.sinCT);
    const libras = [2, 3].map(slot => {
      const p = ctDelCuadrante(conCT, slot);
      return p && p !== 'varios' ? libraCT(p) : '';
    });
    return JSON.stringify([cu, lista, [...gente].map(id => porId.get(id) || null), libras,
      VISTA, !!(T && T.refuerzoVisible), DIA, hoyLocal(), ((T && T.resumen) || {}).horasEstimadas], SIN_ORDEN);
  }

  // Pone las piezas en orden SIN desenganchar las que se quedan: un nodo que
  // sale del documento pierde sus estilos calculados y, al volver, se recalcula
  // entero, que es justo lo que se quiere ahorrar. Primero se quitan las que
  // sobran; luego cada pieza nueva entra delante de la que le toca. Una que se
  // queda solo se mueve si cambia de puesto (el iceberg la sube o la baja).
  function ponerSecciones(cont, piezas) {
    const nuevas = new Map();
    piezas.forEach(p => {
      // Una clave repetida en la misma pasada no reutiliza nada: dos piezas con
      // el mismo nodo dejarían una de ellas fuera de la pantalla.
      if (p.clave && nuevas.has(p.clave)) p.clave = null;
      const vieja = p.clave && SECCIONES.get(p.clave);
      if (p.firma !== undefined) {
        p.nodo = vieja && vieja.firma === p.firma ? vieja.nodo : p.crear();
      } else {
        p.nodo = p.crear();
        if (vieja && vieja.nodo.outerHTML === p.nodo.outerHTML) p.nodo = vieja.nodo;
      }
      if (p.clave) nuevas.set(p.clave, { firma: p.firma, nodo: p.nodo });
    });
    const quedan = new Set(piezas.map(p => p.nodo));
    [...cont.childNodes].forEach(n => { if (!quedan.has(n)) n.remove(); });
    let cursor = cont.firstChild;
    piezas.forEach(p => {
      if (p.nodo === cursor) cursor = cursor.nextSibling;
      else cont.insertBefore(p.nodo, cursor);
    });
    SECCIONES = nuevas;
  }

  function filaCoche(coche, enCuadrante, columnas = cols()) {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-telecab-border/70 align-top scroll-mt-24';
    tr.dataset.vehiculo = coche.vehiculoId;   // para «Ver su cuadrante»
    const tono = tonoEstado(coche.estadoVeh);

    // Celda de matrícula + estado.
    const tdMat = document.createElement('td');
    tdMat.className = 'px-3 py-2.5 whitespace-nowrap';
    tdMat.innerHTML = `
      <div class="font-semibold">${esc(coche.matricula)}</div>
      <button class="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold
                     bg-telecab-${tono}/15 text-telecab-${tono} border border-telecab-${tono}/30 hover:bg-telecab-${tono}/25 transition"
              data-estado>${esc(ESTADO_ETQ.get(coche.estadoVeh) || coche.estadoVeh)}<i class="fa-solid fa-chevron-down text-[9px]"></i></button>`;
    tdMat.querySelector('[data-estado]').addEventListener('click', () => cambiarEstado(coche));
    if (coche.sinCT) tdMat.insertAdjacentHTML('beforeend', `<div class="mt-1">${chipSinCT(coche)}</div>`);
    tdMat.insertAdjacentHTML('beforeend', lineaHoras(coche));
    // Taller/siniestro: el coche se queda en su bloque, pero avisa de que hay que
    // cambiar la matrícula ahí (sus conductores quedan "huérfanos imaginarios").
    if (!coche.visibleCobertura) {
      tr.classList.add('bg-telecab-red/5');
      const tieneGente = (coche.personas || []).some(p => p && p.id);
      const b = document.createElement('button');
      b.className = 'mt-1 block text-[11px] text-telecab-red font-semibold hover:underline';
      b.innerHTML = tieneGente
        ? '<i class="fa-solid fa-triangle-exclamation"></i> cambiar matrícula aquí'
        : '<i class="fa-solid fa-triangle-exclamation"></i> fuera de cobertura';
      if (tieneGente) {
        b.title = 'Intercambia el coche por otro (libre o con bloque): las tripulaciones se quedan en su cuadrante y días, cambia la matrícula';
        b.addEventListener('click', () => reemplazarMatriculaUI(coche));
      } else {
        b.className = 'mt-1 block text-[11px] text-telecab-red';
      }
      tdMat.appendChild(b);
    }
    tr.appendChild(tdMat);

    // Descanso del coche (el bloque): vive en el coche. Sus fijos libran esos
    // días. Editable siempre (es del coche, no del fijo).
    const descTxt = (coche.descanso && coche.descanso.length) ? diasTexto(coche.descanso) : '';
    const tdDesc = document.createElement('td');
    tdDesc.className = 'px-3 py-2.5 whitespace-nowrap';
    if (coche.sinCT) {
      // Sin correturnos: un descanso por fijo (db/203).
      tdDesc.innerHTML = `<div class="flex flex-col items-start gap-1">${botonesLibranzaFijos(coche, false)}</div>`;
      tdDesc.querySelectorAll('[data-desc-turno]').forEach(b =>
        b.addEventListener('click', () => fijarDescansoCoche(coche, b.dataset.descTurno)));
    } else {
      tdDesc.innerHTML = `
        <button class="px-2 py-1 rounded-lg text-xs font-semibold border transition hover:border-telecab-gold/50
                       ${descTxt ? 'bg-telecab-gold/10 text-telecab-gold border-telecab-gold/30' : 'border-dashed border-telecab-border text-telecab-muted'}"
                data-desc title="Editar el descanso del coche (día y noche)">
          ${descTxt ? esc(descTxt) : 'sin descanso'}
        </button>`;
      tdDesc.querySelector('[data-desc]').addEventListener('click', () => fijarDescansoCoche(coche));
    }
    tr.appendChild(tdDesc);

    // Las columnas de puestos. Las de correturnos de un coche sin ellos se
    // juntan en una sola celda con el aviso (si la tabla las enseña).
    columnas.forEach(col => {
      if (coche.sinCT && col.slot >= 2) return;
      const p = (coche.personas || [])[col.slot] || {};
      const td = document.createElement('td');
      td.className = 'px-3 py-2.5';
      td.appendChild(celdaPuesto(coche, p, col));
      tr.appendChild(td);
    });
    const huecosCT = coche.sinCT ? columnas.filter(c => c.slot >= 2).length : 0;
    if (huecosCT) {
      const td = document.createElement('td');
      td.colSpan = huecosCT;
      td.className = 'px-3 py-2.5 align-middle';
      td.innerHTML = `<p class="text-xs text-telecab-muted flex items-center gap-2 max-w-md">
        <i class="fa-solid fa-user-slash shrink-0"></i>${esc(AVISO_SIN_CT)}</p>`;
      tr.appendChild(td);
    }

    // Acciones del coche.
    const tdAcc = document.createElement('td');
    tdAcc.className = 'px-2 py-2.5 text-right whitespace-nowrap';
    tdAcc.innerHTML = `
      <button class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition" data-cua
              title="${enCuadrante ? 'Sacar del cuadrante' : 'Meter en un cuadrante'}"><i class="fa-solid ${enCuadrante ? 'fa-object-ungroup' : 'fa-object-group'}"></i></button>
      <button class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition" data-swap
              title="Intercambiar coche por otro (cada tripulación se queda en su cuadrante y días; solo cambia la matrícula)"><i class="fa-solid fa-shuffle"></i></button>
      <button class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition" data-cambiar
              title="Cambiar de coche (llevarse la tripulación a una matrícula libre)"><i class="fa-solid fa-right-left"></i></button>
      <button class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition" data-sinct
              title="${coche.sinCT ? 'Volver a tener correturnos' : 'Sin correturnos: quitar sus correturnos y dar a cada fijo su propio descanso'}"><i class="fa-solid ${coche.sinCT ? 'fa-user-plus' : 'fa-user-slash'}"></i></button>`;
    tdAcc.querySelector('[data-sinct]').addEventListener('click', () => sinCorreturnosUI(coche));
    tdAcc.querySelector('[data-cua]').addEventListener('click', e => enCuadrante ? sacarDeCuadrante(coche, e.currentTarget) : meterEnCuadrante(coche));
    tdAcc.querySelector('[data-swap]').addEventListener('click', () => reemplazarMatriculaUI(coche));
    tdAcc.querySelector('[data-cambiar]').addEventListener('click', () => cambiarCoche(coche));
    tr.appendChild(tdAcc);

    return tr;
  }

  // ── Las horas instaladas de un coche, y lo que le falta ─────────────────────
  // Por cada día y turno de la semana, el promedio de horas por día trabajado
  // de quien lo cubre (su calificación). Un turno sin nadie suma 0, y quien aún
  // no tiene calificación cuenta con la mediana de la flota (iceberg.js).
  function tituloHoras(coche) {
    const ic = coche.iceberg || {};
    return `Horas instaladas esta semana: ${fmtH1(ic.horas)} h en ${ic.turnos} de 14 turnos.\n` +
      'Cada turno suma el promedio de horas por día trabajado de quien lo cubre (su calificación); un turno sin nadie suma 0.' +
      (ic.estimados ? `\n${ic.estimados} turno(s) con alguien sin calificación todavía: cuentan ${fmtH1((T.resumen || {}).horasEstimadas)} h, la mediana de la flota.` : '') +
      '\nLa barra llena son 14 turnos a 9 h.';
  }

  /** «falta fijo noche · 2 días de CT de día», o nada si está completo. */
  function textoFalta(coche) {
    const f = (coche.iceberg || {}).falta;
    if (!f) return '';
    const dias = n => `${n} día${n === 1 ? '' : 's'}`;
    return [
      f.fijoDia ? 'fijo de día' : '', f.fijoNoche ? 'fijo de noche' : '',
      f.ctDiasDia ? `${dias(f.ctDiasDia)} de CT de día` : '', f.ctDiasNoche ? `${dias(f.ctDiasNoche)} de CT de noche` : '',
    ].filter(Boolean).join(' · ');
  }

  function lineaHoras(coche) {
    const ic = coche.iceberg;
    if (!ic) return '';
    const falta = textoFalta(coche);
    return `
      <div class="mt-1 flex items-center gap-1.5 text-[11px] text-telecab-muted tabular-nums" title="${esc(tituloHoras(coche))}">
        ${medidor(ic.horas)}<span><b class="text-telecab-text font-semibold">${fmtH(ic.horas)} h</b>${ic.huecos ? ` · ${ic.huecos} sin nadie` : ''}</span>
      </div>
      ${falta ? `<div class="mt-0.5 text-[11px] text-telecab-warn max-w-[11rem] whitespace-normal leading-tight">Falta ${esc(falta)}</div>` : ''}`;
  }

  // ── Cuadrantes ────────────────────────────────────────────────────────────
  async function pedirTablero(url, body, metodo) {
    const r = await fetchPlan(url, {
      method: metodo || 'POST', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo guardar');
    if (j.tablero) aplicar(j.tablero);
    return j;
  }
