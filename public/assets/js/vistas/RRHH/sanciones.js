// modules/RRHH/vistas/sanciones.ejs — faltas y sanciones (módulo 3, db/295, 25/11/2026).
//
// La abre la oficina con los hechos y sus pruebas, o la propone el ERP (las
// ausencias injustificadas y la reincidencia); la aprueban Ángel, William o
// Ignacio dentro de la horquilla del convenio; Diana manda la carta a firmar.
// Una suspensión entra en la ficha cuando la carta queda firmada (o no la firma, o caduca).

(function () {
  const P = Casa.datos().puede || {};
  const { esc, etiqueta } = Listado.fmt;
  let ESTADOS = {}, GRAVEDAD = {}, MEDIDAS = {};
  const est = s => ESTADOS[s.estado] || { etiqueta: s.estado, tono: 'muted' };
  const grav = s => GRAVEDAD[s.gravedad] || { etiqueta: s.gravedad, tono: 'muted' };
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const quien = (cuando, por) => (cuando ? `${cuando}${por ? ` · ${por}` : ''}` : '—');
  const medida = s => (s.medida === 'suspension' ? `Suspensión de ${s.dias} ${s.dias === 1 ? 'día' : 'días'}` : s.medida ? MEDIDAS[s.medida] : '');
  const ABIERTAS = ['propuesta', 'abierta', 'aprobada', 'en_firma'];

  Listado.montar({
    raiz: '#modulo',
    titulo: 'Faltas y sanciones',
    icono: 'fa-gavel',
    clave: 'id',
    origen: '/disciplina/api/lista',
    vacio: 'No hay sanciones que coincidan.',
    filtrosIniciales: { estado: 'abiertas' },
    buscar: { texto: 'Buscar persona o falta…', campos: ['nombre', 'falta', 'legajo', 'articulo'] },

    subtitulo: (v, t) => (v.length === t.length ? `${t.length} sanciones` : `${v.length} de ${t.length} sanciones`),

    cifras: (filas, extra) => {
      if (extra && extra.estados) ESTADOS = extra.estados;
      if (extra && extra.gravedades) GRAVEDAD = extra.gravedades;
      if (extra && extra.medidas) MEDIDAS = extra.medidas;
      const n = e => filas.filter(f => f.estado === e).length;
      const tarde = filas.filter(f => f.estado === 'aprobada' && f.comunicar_antes && f.comunicar_antes < hoy()).length;
      return [
        { valor: n('propuesta'), etiqueta: 'propuestas por el ERP', tono: 'warn', filtro: { id: 'estado', valor: 'propuesta' } },
        { valor: n('abierta'), etiqueta: 'por aprobar', tono: 'gold', filtro: { id: 'estado', valor: 'abierta' } },
        { valor: n('aprobada'), etiqueta: tarde ? `cartas por preparar (${tarde} fuera de plazo)` : 'cartas por preparar', tono: tarde ? 'red' : undefined, filtro: { id: 'estado', valor: 'aprobada' } },
        { valor: n('en_firma'), etiqueta: 'cartas en firma', filtro: { id: 'estado', valor: 'en_firma' } },
      ];
    },

    nota: (filas, extra) => [
      ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/295 en Migraciones.' }] : []),
      { icono: 'fa-circle-info', texto: 'El ERP propone las faltas por ausencias injustificadas y la reincidencia, pero no sanciona solo: una persona la abre o la descarta. Una suspensión entra en el planificador cuando la carta queda firmada, o cuando no la firma o caduca.' },
    ],

    filtros: [
      { id: 'estado', etiqueta: 'Estado', textoTodos: 'Cualquier estado',
        opciones: () => [{ valor: 'abiertas', texto: 'Sin terminar' }, ...Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta }))],
        pasa: (f, v) => (v === 'abiertas' ? ABIERTAS.includes(f.estado) : f.estado === v) },
      { id: 'gravedad', etiqueta: 'Gravedad', campo: 'gravedad', textoTodos: 'Cualquier gravedad',
        opciones: () => Object.entries(GRAVEDAD).map(([valor, g]) => ({ valor, texto: g.etiqueta })) },
      { id: 'origen', etiqueta: 'Origen', campo: 'origen', textoTodos: 'Cualquier origen',
        opciones: () => [{ valor: 'propuesta', texto: 'Propuesta por el ERP' }, { valor: 'manual', texto: 'Abierta a mano' }] },
    ],

    acciones: P.abrir ? [{ texto: 'Nueva sanción', icono: 'fa-plus', onClick: lst => nueva(lst) }] : [],

    columnas: [
      { titulo: 'Hechos', campo: 'fecha_hechos', clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(dmy(v)) },
      { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Legajo ${esc(f.legajo)}</span>` : '') },
      { titulo: 'Falta', campo: 'falta', pinta: (v, f) => `${etiqueta(grav(f).etiqueta, grav(f).tono)} <span class="text-xs text-telecab-muted">${esc(f.articulo || '')}</span>
          <span class="block text-xs">${esc(v)}</span>` },
      { titulo: 'Sanción', valor: f => medida(f), clase: 'text-sm' },
      { titulo: 'Plazo', valor: f => (f.estado === 'aprobada' ? f.comunicar_antes : f.estado === 'propuesta' || f.estado === 'abierta' ? f.prescribe : null),
        clase: 'whitespace-nowrap tabular-nums text-xs',
        ayuda: 'Por aprobar: el día en que prescribe (art. 60 del Estatuto, desde los hechos). Aprobada: hasta cuándo hay para comunicarla.',
        pinta: (v, f) => (!v ? '' : `<span class="${v < hoy() ? 'text-telecab-red font-semibold' : ''}">${f.estado === 'aprobada' ? 'Comunicar antes del' : 'Prescribe el'} ${esc(dmy(v))}</span>`) },
      { titulo: 'Estado', valor: f => est(f).etiqueta, pinta: (v, f) => etiqueta(v, est(f).tono) },
    ],

    detalle: {
      origen: id => `/disciplina/api/sancion/${encodeURIComponent(id)}`,
      titulo: d => `${grav(d).etiqueta}: ${d.falta}`,
      subtitulo: d => `${d.nombre} · ${dmy(d.fecha_hechos)}`,
      acciones: [
        { texto: 'Abrir la sanción', icono: 'fa-folder-open', principal: true, visible: d => d.puede.abrir && d.estado === 'propuesta', onClick: (d, l) => abrir(d, l) },
        { texto: 'Aprobar', icono: 'fa-check', principal: true, visible: d => d.puede.aprobar && d.estado === 'abierta', onClick: (d, l) => aprobar(d, l) },
        { texto: 'Mandar la carta a firmar', icono: 'fa-file-signature', principal: true, visible: d => d.puede.carta && d.estado === 'aprobada', onClick: (d, l) => carta(d, l) },
        { texto: 'Ver la carta en Firmas', icono: 'fa-pen-nib', visible: d => !!d.firma_envio_id, onClick: d => { location.href = `/firmas#${encodeURIComponent(d.firma_envio_id)}`; } },
        { texto: 'Descartar', icono: 'fa-ban', visible: d => (d.estado === 'propuesta' ? d.puede.abrir : d.puede.aprobar && ['abierta', 'aprobada'].includes(d.estado)),
          onClick: (d, l) => descartar(d, l) },
      ],
      bloques: [
        { titulo: 'La falta', icono: 'fa-gavel', campos: [
          { etiqueta: 'Estado', html: true, valor: d => etiqueta(est(d).etiqueta, est(d).tono) },
          { etiqueta: 'Gravedad', html: true, valor: d => etiqueta(grav(d).etiqueta, grav(d).tono) },
          { etiqueta: 'Artículo', valor: d => d.articulo || '—' },
          { etiqueta: 'Falta', valor: d => d.falta, ancho: 'sm:col-span-2' },
          { etiqueta: 'Qué sanción cabe', valor: d => d.horquilla, ancho: 'sm:col-span-2' },
          { etiqueta: 'Día de los hechos', valor: d => dmy(d.fecha_hechos) },
          { etiqueta: 'Prescribe', html: true, visible: d => ['propuesta', 'abierta'].includes(d.estado),
            valor: d => `<span class="${d.prescribe < hoy() ? 'text-telecab-red font-semibold' : ''}">${esc(dmy(d.prescribe))}</span>`,
            ayuda: 'Art. 60.2 del Estatuto: leves a los 10 días, graves a los 20 y muy graves a los 60, desde que la empresa lo supo. Aquí se cuenta desde los hechos.' },
          { etiqueta: 'Origen', valor: d => (d.origen === 'propuesta' ? 'Propuesta por el ERP' : 'Abierta a mano') },
          { etiqueta: 'Entró', valor: d => quien(d.creado, d.creado_por_nombre) },
          { etiqueta: 'Abierta', valor: d => quien(d.abierta, d.abierta_por_nombre) },
          { etiqueta: 'Su ficha', html: true, valor: d => `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">Abrir en Plantilla</a>` },
        ] },
        { titulo: 'Los hechos', icono: 'fa-align-left', pinta: (d, hueco) => {
          hueco.className = 'p-5 space-y-2 text-sm';
          const dias = d.detalle && d.detalle.dias ? `<p class="text-xs text-telecab-muted">Ausencias injustificadas que la sostienen: ${d.detalle.dias.map(x => esc(dmy(x))).join(', ')}.
            <a class="underline" href="/ausencias">Ausencias</a></p>` : '';
          hueco.innerHTML = `<p class="whitespace-pre-line">${esc(d.hechos || 'Sin escribir todavía.')}</p>${dias}`;
        } },
        { titulo: 'Pruebas', icono: 'fa-paperclip', pinta: (d, hueco) => {
          hueco.className = '';
          Adjuntos.montar(hueco, { tipo: 'sancion', dueno: d.id, titulo: 'Fotos, capturas, el parte…',
            puedeAdjuntar: d.puede.abrir && ['propuesta', 'abierta'].includes(d.estado), puedeQuitar: d.puede.abrir && ['propuesta', 'abierta'].includes(d.estado) });
        } },
        { titulo: 'La decisión', icono: 'fa-scale-balanced', visible: d => !!d.medida, campos: [
          { etiqueta: 'Sanción', valor: d => medida(d) },
          { etiqueta: 'Aprobada', valor: d => quien(d.aprobada, d.aprobada_por_nombre) },
          { etiqueta: 'Comunicar antes del', html: true, visible: d => d.estado === 'aprobada',
            valor: d => `<span class="${d.comunicar_antes < hoy() ? 'text-telecab-red font-semibold' : ''}">${esc(dmy(d.comunicar_antes))}</span>` },
          { etiqueta: 'Suspensión', visible: d => !!d.suspension_desde, valor: d => `Del ${dmy(d.suspension_desde)} al ${dmy(d.suspension_hasta)}` },
          { etiqueta: 'Aviso', visible: d => !!d.avisoNomina, valor: d => d.avisoNomina, ancho: 'sm:col-span-2' },
          { etiqueta: 'Nota de quien aprobó', visible: d => !!d.decision_nota, valor: d => d.decision_nota, ancho: 'sm:col-span-2' },
          { etiqueta: 'Comunicada', visible: d => !!d.comunicada, valor: d => d.comunicada },
          { etiqueta: 'En su ficha', html: true, visible: d => d.estado === 'comunicada' && d.medida === 'suspension',
            valor: d => (d.situacion_id ? 'Suspendido, puesto en su ficha' : '<span class="text-telecab-warn">Falta ponerla en su ficha</span>') },
          { etiqueta: 'Nota', visible: d => !!d.nota, valor: d => d.nota, ancho: 'sm:col-span-2' },
        ] },
        { titulo: 'La carta', icono: 'fa-envelope-open-text', visible: d => ['abierta', 'aprobada', 'en_firma', 'comunicada'].includes(d.estado), pinta: (d, hueco) => {
          hueco.className = 'p-5 space-y-2 text-sm';
          const c = d.carta;
          hueco.innerHTML = `
            <p><b>Hechos.</b> ${esc(c.hechos || '')}</p>
            <p><b>Calificación.</b> ${esc(c.calificacion)}</p>
            <p><b>Sanción.</b> ${d.medida ? esc(c.sancion) : '<span class="text-telecab-muted">La que se apruebe.</span>'}</p>
            <p class="text-xs text-telecab-muted">Va con la plantilla de YouTrust «Carta de sanción», con código por SMS al móvil de su ficha.</p>`;
        } },
        { titulo: 'Su historial', icono: 'fa-clock-rotate-left', visible: d => (d.historial || []).length > 0, pinta: (d, hueco) => {
          hueco.className = 'p-5 text-sm';
          hueco.innerHTML = `<ul class="space-y-1">${d.historial.map(h => `<li><a class="underline" href="/disciplina#${encodeURIComponent(h.id)}">${esc(dmy(h.fecha_hechos))}</a>
            · ${etiqueta(grav(h).etiqueta, grav(h).tono)} ${esc(h.falta)} · ${esc(medida(h) || '')} · ${etiqueta(est(h).etiqueta, est(h).tono)}</li>`).join('')}</ul>`;
        } },
      ],
    },
  });

  async function post(d, que, cuerpo, aviso) {
    return Api.post(`/disciplina/api/sancion/${encodeURIComponent(d.id)}/${que}`, cuerpo || {}, { aviso: aviso || 'No se ha podido hacer', bloquea: true });
  }

  async function abrir(d, lst) {
    const v = await Dialogo.formulario('Abrir la sanción', [
      { id: 'hechos', etiqueta: 'Los hechos', tipo: 'texto-largo', obligatorio: true, minimo: 10, max: 4000, valor: d.hechos || '',
        ayuda: 'Es lo que dirá la carta. El ERP lo dejó escrito: revísalo y añade lo que haga falta.' },
    ], { textoBoton: 'Abrir', nota: 'Pasa a aprobación. Las pruebas se suben en su ficha.' });
    if (!v) return;
    if (await post(d, 'abrir', { hechos: v.hechos })) { Dialogo.hecho('Abierta: pasa a aprobación'); await lst.recargar(); }
  }

  async function aprobar(d, lst) {
    const g = GRAVEDAD[d.gravedad] || {};
    const opciones = [...(g.amonestacion ? [{ valor: 'amonestacion', texto: 'Amonestación por escrito' }] : []),
      { valor: 'suspension', texto: `Suspensión de empleo y sueldo (${g.min} a ${g.max} días)` }];
    const v = await Dialogo.formulario('Aprobar la sanción', [
      { id: 'medida', etiqueta: 'Sanción', tipo: 'lista', obligatorio: true, opciones, valor: opciones[0].valor },
      { id: 'dias', etiqueta: 'Días de suspensión', tipo: 'texto', marcador: `${g.min} a ${g.max}`, ayuda: 'Solo si es una suspensión.' },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: 'Aprobar', nota: `Cabe: ${d.horquilla}. Desde que se aprueba corre el plazo para comunicarla.` });
    if (!v) return;
    const r = await post(d, 'aprobar', { medida: v.medida, dias: v.medida === 'suspension' ? Number(String(v.dias).replace(',', '.')) : null, nota: v.nota });
    if (r) { Dialogo.hecho(`Aprobada: comunicar antes del ${dmy(r.comunicarAntes)}`); await lst.recargar(); }
  }

  async function carta(d, lst) {
    let campos = [];
    if (d.medida === 'suspension') {
      const m = new Date(Date.now() + 86400000).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' });
      campos = [
        { id: 'desde', etiqueta: 'Suspendido desde', tipo: 'fecha', obligatorio: true, valor: m },
        { id: 'hasta', etiqueta: 'Hasta (incluido)', tipo: 'fecha', obligatorio: true, ayuda: `${d.dias} ${d.dias === 1 ? 'día' : 'días'} de suspensión.` },
      ];
    }
    const texto = 'Entra en la cola de Firmas con la plantilla «Carta de sanción» y se aprueba a la vez si tienes la llave de Firmas. '
      + (d.medida === 'suspension' ? 'La suspensión entra en su ficha cuando la carta quede firmada, o cuando no la firme o caduque.' : '');
    const v = campos.length
      ? await Dialogo.formulario('Mandar la carta a firmar', campos, { textoBoton: 'Mandar a firmar', nota: texto })
      : (await Dialogo.confirmar({ titulo: 'Mandar la carta a firmar', si: 'Mandar a firmar', no: 'Cancelar', texto })) ? {} : null;
    if (!v) return;
    const r = await post(d, 'carta', { desde: v.desde, hasta: v.hasta });
    if (!r) return;
    if (r.aprobada) Dialogo.hecho('Carta aprobada en Firmas: espera a que se mande la tanda');
    else await Dialogo.aviso({ titulo: 'Carta en la cola de Firmas', tono: 'aviso', texto: `Queda por aprobar en Firmas. ${r.falta || ''}` });
    await lst.recargar();
  }

  async function descartar(d, lst) {
    const v = await Dialogo.formulario('Descartar', [{ id: 'nota', etiqueta: 'Por qué se descarta', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000 }],
      { textoBoton: 'Descartar' });
    if (v && await post(d, 'descartar', { nota: v.nota })) { Dialogo.hecho('Descartada'); await lst.recargar(); }
  }

  async function nueva(lst) {
    let cat;
    try { cat = await Api.get('/disciplina/api/catalogo'); }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo cargar', texto: e.message, tono: 'error' }); }
    const OTRA = '__otra';
    const v = await Dialogo.formulario('Nueva sanción', [
      { id: 'conductorId', etiqueta: 'Quién', tipo: 'opciones', obligatorio: true,
        opciones: cat.personas.map(p => ({ valor: p.id, texto: `${p.nombre}${p.alta ? '' : ' (de baja)'}` })), buscador: { marcador: 'Buscar…', tope: 12 } },
      { id: 'regla', etiqueta: 'La falta (art. 39 del convenio)', tipo: 'lista', obligatorio: true,
        opciones: [...cat.reglas.map(r => ({ valor: r.codigo, texto: `${(cat.gravedades[r.gravedad] || {}).etiqueta} · ${r.articulo} · ${r.falta}` })),
          { valor: OTRA, texto: 'Otra falta (la describo yo)' }] },
      { id: 'gravedad', etiqueta: 'Gravedad (si es otra falta)', tipo: 'lista',
        opciones: Object.entries(cat.gravedades).map(([valor, g]) => ({ valor, texto: g.etiqueta })) },
      { id: 'falta', etiqueta: 'Qué falta es (si es otra)', tipo: 'texto', max: 400 },
      { id: 'fechaHechos', etiqueta: 'Día de los hechos', tipo: 'fecha', obligatorio: true },
      { id: 'hechos', etiqueta: 'Qué pasó', tipo: 'texto-largo', obligatorio: true, minimo: 10, max: 4000,
        ayuda: 'Es lo que dirá la carta: cuándo, dónde y qué hizo, sin opiniones.' },
      { id: 'pruebas', etiqueta: 'Pruebas (opcional)', tipo: 'ficheros', ayuda: 'Fotos, capturas, el parte… También se pueden subir después.' },
    ], { textoBoton: 'Abrir', nota: 'Pasa a aprobación.', ancho: 'max-w-xl' });
    if (!v || !v.conductorId) return;
    const otra = v.regla === OTRA;
    const r = await Api.post('/disciplina/api/sancion', {
      conductorId: v.conductorId.valor, regla: otra ? null : v.regla, gravedad: otra ? v.gravedad : null, falta: otra ? v.falta : null,
      fechaHechos: v.fechaHechos, hechos: v.hechos,
    }, { aviso: 'No se ha podido abrir', bloquea: true });
    if (!r) return;
    for (const fichero of v.pruebas || []) {
      try { await Adjuntos.subir({ tipo: 'sancion', dueno: r.id, fichero }); }
      catch (e) { Dialogo.aviso({ titulo: 'Una prueba no se subió', texto: `${fichero.name}: ${e.message}. Súbela desde su ficha.`, tono: 'aviso' }); }
    }
    Dialogo.hecho('Abierta: pasa a aprobación');
    await lst.recargar();
    lst.abrir(r.id);
  }
})();
