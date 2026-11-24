// modules/Vehiculos/vistas/revisionFotos.ejs — la revisión de las fotos del portal (db/282, 24/11/2026).
//
// Cada lote (las cinco fotos de quien desvincula el coche en el portal) se
// compara con el anterior del mismo coche y se califica: «Aprobada» o «Con
// daños». Lo que le deja el servidor llega por Casa.datos().

(function () {
  const PUEDE = !!Casa.datos().puedeCalificar;
  const { esc, etiqueta } = Listado.fmt;
  const ESTADOS = {
    pendiente: { texto: 'Por revisar', tono: 'warn' },
    aprobada: { texto: 'Aprobada', tono: 'green' },
    danos: { texto: 'Con daños', tono: 'red' },
  };
  let AVISO = 3;
  let DIAS = 20;

  const estado = f => etiqueta(ESTADOS[f.estado].texto, ESTADOS[f.estado].tono);
  const loteCorto = l => (l ? `${l.quien}${l.oficina ? ' (oficina)' : ''} · ${l.hasta}` : '');
  const pintaLote = l => (l
    ? `<span class="whitespace-nowrap"><span class="font-medium">${esc(l.quien)}</span>${l.oficina ? ' <span class="text-xs text-telecab-muted">(oficina)</span>' : ''}</span>
       <span class="block text-xs text-telecab-muted whitespace-nowrap">lo dejó el ${esc(l.hasta)}${l.nFotos < 5 ? ` · ${l.nFotos} de 5 fotos` : ''}</span>`
    : '<span class="text-xs text-telecab-muted">Sin lote anterior</span>');

  /** Cuándo se borran sus fotos: en días, en rojo si quedan pocos; «se guardan» si tiene daños. */
  function pintaQuedan(f) {
    if (f.quedan == null) return '<span class="text-xs text-telecab-muted" title="Pareja con daños: sus fotos no se borran.">Se guardan</span>';
    if (f.estado !== 'pendiente') return `<span class="text-xs text-telecab-muted">en ${f.quedan} d</span>`;
    // `quedan` es el día de la purga (de madrugada): 1 = mañana por la mañana.
    const t = f.quedan <= 0 ? 'hoy' : f.quedan === 1 ? 'mañana' : `en ${f.quedan} días`;
    return f.quedan <= AVISO
      ? `<span class="text-telecab-red font-semibold whitespace-nowrap">${t}</span>`
      : `<span class="whitespace-nowrap">${t}</span>`;
  }

  const lista = Listado.montar({
    raiz: '#modulo',
    titulo: 'Revisión de fotos',
    icono: 'fa-images',
    clave: 'turno',
    origen: '/revision-fotos/api/lista',
    vacio: 'No hay lotes de fotos que coincidan.',
    filtrosIniciales: { estado: 'pendiente' },
    buscar: { texto: 'Buscar matrícula o conductor…', campos: [f => `${f.matricula} ${String(f.matricula).replace(/\s|-/g, '')}`, 'quien', 'quienAnterior'] },

    subtitulo: (visibles, todas) => (visibles.length === todas.length
      ? `${todas.length} lotes` : `${visibles.length} de ${todas.length} lotes`),

    cifras: (filas, extra) => {
      if (extra && extra.avisoDias) AVISO = extra.avisoDias;
      if (extra && extra.dias) DIAS = extra.dias;
      const pend = filas.filter(f => f.estado === 'pendiente');
      return [
        { valor: pend.length, etiqueta: 'por revisar', tono: 'warn', filtro: { id: 'estado', valor: 'pendiente' },
          ayuda: 'Lotes que aún no se han comparado con el anterior de su coche.' },
        { valor: pend.filter(f => f.quedan != null && f.quedan <= AVISO).length, etiqueta: `se borran en ${AVISO} días o menos`, tono: 'red',
          filtro: { id: 'estado', valor: 'urgente' }, ayuda: `Las fotos se guardan ${DIAS} días. Estas se borran pronto: revísalas primero.` },
        { valor: filas.filter(f => f.estado === 'danos').length, etiqueta: 'con daños', tono: 'red', filtro: { id: 'estado', valor: 'danos' } },
        { valor: filas.filter(f => f.estado === 'aprobada').length, etiqueta: 'aprobadas', filtro: { id: 'estado', valor: 'aprobada' } },
      ];
    },

    nota: (filas, extra) => [
      extra && extra.sinTabla ? { tono: 'aviso', icono: 'fa-database',
        texto: 'Falta aplicar la migración db/282 en Migraciones: hasta entonces se ven los lotes, pero no se pueden calificar.' } : null,
      { icono: 'fa-circle-info', texto: `Cada lote son las cinco fotos que hace un conductor al dejar el coche en el portal. Se compara con el lote anterior del mismo coche: si aparece un daño, es de quien hizo el lote nuevo. Las fotos se borran a los ${DIAS} días, menos las de las parejas con daños.` },
    ],

    filtros: [
      { id: 'estado', etiqueta: 'Estado', textoTodos: 'Cualquier estado', opciones: [
          { valor: 'pendiente', texto: 'Por revisar' },
          { valor: 'urgente', texto: 'Por revisar, se borran pronto' },
          { valor: 'aprobada', texto: 'Aprobadas' },
          { valor: 'danos', texto: 'Con daños' },
        ],
        pasa: (f, v) => (v === 'urgente' ? f.estado === 'pendiente' && f.quedan != null && f.quedan <= AVISO : f.estado === v) },
    ],

    claseFila: f => (f.estado === 'danos' ? 'bg-telecab-red/5' : ''),

    columnas: [
      { titulo: 'Matrícula', campo: 'matricula', clase: 'font-semibold whitespace-nowrap' },
      { titulo: 'Lote anterior', valor: f => loteCorto(f.anterior), ayuda: 'Con lo que se compara: el último lote de ese coche antes del nuevo.',
        pinta: (v, f) => pintaLote(f.anterior) },
      { titulo: 'Lote nuevo', valor: f => loteCorto(f.nuevo), ayuda: 'El que se califica. Si aparece un daño, es de esta persona.',
        pinta: (v, f) => pintaLote(f.nuevo) },
      { titulo: 'Estado', valor: f => ESTADOS[f.estado].texto, pinta: (v, f) => estado(f) },
      { titulo: 'Se borran', valor: f => (f.quedan == null ? 'Se guardan' : `${f.quedan} días`),
        ayuda: `Cuándo se borran las fotos de la pareja (a los ${DIAS} días de hacerlas). Las de una pareja con daños se guardan.`,
        pinta: (v, f) => pintaQuedan(f) },
      { titulo: 'Revisado por', valor: f => (f.revision ? `${f.revision.por} · ${f.revision.cuando}` : ''),
        pinta: (v, f) => (f.revision ? `<span class="whitespace-nowrap">${esc(f.revision.por || '—')}</span><span class="block text-xs text-telecab-muted">${esc(f.revision.cuando)}</span>` : '') },
    ],

    // ══════════ LA FICHA: las dos tandas, una al lado de la otra ══════════
    detalle: {
      origen: t => `/revision-fotos/api/par/${encodeURIComponent(t)}`,
      titulo: d => d.matricula,
      subtitulo: d => `${d.nuevo.quien}, lo dejó el ${d.nuevo.hasta}` + (d.anterior ? ` · comparado con ${d.anterior.quien}, el ${d.anterior.hasta}` : ' · sin lote anterior')
        + (d.pendientes ? ` · ${d.pendientes} por revisar` : ''),
      acciones: [
        { texto: 'Aprobar', icono: 'fa-check', principal: true, visible: d => PUEDE && d.estado !== 'aprobada',
          activa: d => !d.sinTabla, ayuda: d => (d.sinTabla ? 'Falta aplicar la migración db/282' : ''),
          onClick: (d, lst) => calificar(d, lst, { resultado: 'aprobada' }) },
        { texto: 'Con daños', icono: 'fa-triangle-exclamation', peligro: true, visible: d => PUEDE && d.estado !== 'danos',
          activa: d => !d.sinTabla, ayuda: d => (d.sinTabla ? 'Falta aplicar la migración db/282' : ''),
          onClick: (d, lst) => conDanos(d, lst) },
        { texto: 'Editar los daños', icono: 'fa-pen', visible: d => PUEDE && d.estado === 'danos',
          onClick: (d, lst) => conDanos(d, lst) },
        { texto: 'Siguiente', icono: 'fa-forward', visible: d => !!d.siguiente,
          ayuda: d => (d.siguiente ? `Ir al siguiente por revisar: ${d.siguiente.matricula}` : ''),
          onClick: (d, lst) => irA(lst, d.siguiente.turno) },
      ],
      bloques: [
        { titulo: 'Calificación', icono: 'fa-clipboard-check', visible: d => !!d.revision,
          pinta: (d, hueco) => pintaCalificacion(d, hueco) },
        { titulo: 'Antes y después', icono: 'fa-images', pinta: (d, hueco) => pintaComparar(d, hueco) },
      ],
    },
  });

  function pintaCalificacion(d, hueco) {
    const r = d.revision;
    const fotos = (d.fotos || []).filter(f => f.dano).map(f => f.etiqueta);
    hueco.className = 'p-5 text-sm space-y-2';
    hueco.innerHTML = `
      <p class="flex flex-wrap items-center gap-2">${estado(d)}
        <span class="text-telecab-muted">por ${esc(r.por || '—')}, el ${esc(r.cuando)}</span></p>
      ${r.resultado === 'danos' ? `
        <p><span class="text-telecab-muted">Responsable:</span> <span class="font-semibold">${esc(d.nuevo.quien)}</span>
          <span class="text-telecab-muted">(el lote nuevo)</span></p>
        ${fotos.length ? `<p><span class="text-telecab-muted">Se ve en:</span> ${esc(fotos.join(', '))}</p>` : ''}` : ''}
      ${r.nota ? `<p class="whitespace-pre-line">${esc(r.nota)}</p>` : ''}
      ${d.quedan == null ? '<p class="text-xs text-telecab-muted">Las fotos de esta pareja se guardan: no se borran a los 20 días.</p>' : ''}`;
  }

  /** Una foto que se pulsa para verla en grande (el visor de la casa, con zoom y descarga). */
  const foto = (url, titulo, pie, dano) => (url
    ? `<button type="button" class="block w-full group" data-foto="${esc(url)}" data-titulo="${esc(titulo)}" data-pie="${esc(pie)}"
         aria-label="Ver en grande: ${esc(titulo)}, ${esc(pie)}">
         <img src="${esc(url)}" alt="" loading="lazy" decoding="async"
              class="w-full aspect-[4/3] object-cover rounded-xl bg-telecab-card2 border-2 ${dano ? 'border-telecab-red' : 'border-telecab-border group-hover:border-telecab-gold'} transition">
       </button>`
    : `<div class="w-full aspect-[4/3] rounded-xl border border-dashed border-telecab-border bg-telecab-card2/50 flex items-center justify-center text-center p-3 text-xs text-telecab-muted">${esc(pie)}</div>`);

  function pintaComparar(d, hueco) {
    const a = d.anterior, n = d.nuevo;
    const pieA = a ? `${a.quien}, lo dejó el ${a.hasta}` : 'Sin lote anterior: es el primero de este coche en el portal, o ya se borró';
    const pieN = `${n.quien}, lo dejó el ${n.hasta}`;
    hueco.className = 'p-5';
    hueco.innerHTML = `
      <div class="grid grid-cols-2 gap-3 mb-3 text-sm">
        <p><span class="font-semibold">Antes</span> <span class="text-telecab-muted">· ${esc(a ? pieA : 'sin lote anterior')}</span></p>
        <p><span class="font-semibold">Después</span> <span class="text-telecab-muted">· ${esc(pieN)}</span></p>
      </div>
      <div class="flex flex-col gap-5">
        ${d.fotos.map(f => `
          <section aria-label="${esc(f.etiqueta)}">
            <div class="flex items-center gap-2 mb-2">
              <h4 class="text-sm font-semibold">${esc(f.etiqueta)}</h4>
              ${f.dano ? etiqueta('Daño', 'red') : ''}
              ${f.antes && f.despues ? `<button type="button" class="ml-auto tc-boton tc-boton--chico" data-juntas="${f.n}">
                <i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i> Las dos en grande</button>` : ''}
            </div>
            <div class="grid grid-cols-2 gap-3">
              ${foto(f.antes, `${d.matricula} · ${f.etiqueta} · antes`, a ? pieA : 'Sin foto de antes', false)}
              ${foto(f.despues, `${d.matricula} · ${f.etiqueta} · después`, f.despues ? pieN : 'Esta foto no se guardó', f.dano)}
            </div>
          </section>`).join('')}
      </div>`;
    hueco.querySelectorAll('[data-foto]').forEach(b => b.addEventListener('click', () =>
      VisorFoto.abrir({ src: b.dataset.foto, titulo: b.dataset.titulo, pie: b.dataset.pie, descargar: true })));
    hueco.querySelectorAll('[data-juntas]').forEach(b => b.addEventListener('click', () => {
      const f = d.fotos.find(x => x.n === Number(b.dataset.juntas));
      Dialogo.aviso({
        titulo: `${d.matricula} · ${f.etiqueta}`, ancho: 'max-w-7xl',
        html: `<div class="grid sm:grid-cols-2 gap-3">
          <figure><img src="${esc(f.antes)}" alt="Antes" class="w-full rounded-xl border border-telecab-border">
            <figcaption class="text-xs text-telecab-muted mt-1"><b>Antes</b> · ${esc(pieA)}</figcaption></figure>
          <figure><img src="${esc(f.despues)}" alt="Después" class="w-full rounded-xl border-2 ${f.dano ? 'border-telecab-red' : 'border-telecab-border'}">
            <figcaption class="text-xs text-telecab-muted mt-1"><b>Después</b> · ${esc(pieN)}</figcaption></figure></div>`,
      });
    }));
  }

  /** Ir a otra pareja sin dejar una entrada por cada una en el historial: «atrás» vuelve a la lista. */
  function irA(lst, turno) {
    history.replaceState(history.state, '', '#' + encodeURIComponent(turno));
    lst.abierto = String(turno);
    return lst.recargar();
  }

  /** Guarda y pasa a la siguiente por revisar; si no queda ninguna, a la lista. */
  async function calificar(d, lst, datos) {
    const r = await Api.post(`/revision-fotos/api/par/${encodeURIComponent(d.turno)}/calificar`, datos, { aviso: 'No se ha podido guardar' });
    if (!r) return;
    Dialogo.hecho(`${d.matricula}: ${r.etiqueta.toLowerCase()}`);
    if (d.estado === 'pendiente' && d.siguiente) return irA(lst, d.siguiente.turno);
    if (d.estado === 'pendiente') {
      await lst.recargar();
      lst.volver();
      Dialogo.hecho('No queda ningún lote por revisar');
      return;
    }
    return lst.recargar();
  }

  async function conDanos(d, lst) {
    const r = d.revision && d.revision.resultado === 'danos' ? d.revision : null;
    const v = await Dialogo.formulario(`${d.matricula} · con daños`, [
      { id: 'fotos', etiqueta: '¿En qué foto se ve?', tipo: 'lista', multiple: true, obligatorio: true,
        opciones: d.fotos.map(f => ({ valor: String(f.n), texto: f.etiqueta })),
        valor: r ? r.fotos.map(String) : [] },
      { id: 'nota', etiqueta: 'Qué daño se ve', tipo: 'texto-largo', obligatorio: true, max: 2000, minimo: 3,
        marcador: 'Ej.: rayón nuevo en la puerta trasera derecha', valor: r ? r.nota : '',
        ayuda: `Queda a nombre de ${d.nuevo.quien}, que hizo el lote nuevo. Las fotos de la pareja se guardan (no se borran a los 20 días).` },
    ], { textoBoton: 'Guardar con daños', ancho: 'max-w-lg' });
    if (!v) return;
    return calificar(d, lst, { resultado: 'danos', fotos: v.fotos, nota: v.nota });
  }

  // Si el menú dice que hay lotes nuevos (otro conductor acaba de dejar un coche), la lista se refresca sola.
  if (window.TiempoReal) {
    TiempoReal.escuchar('contadores', { alLlegar: m => {
      if (m && Array.isArray(m.fuentes) && m.fuentes.includes('revision_fotos') && !lista.abierto) lista.recargar().catch(() => {});
    } });
  }
})();
