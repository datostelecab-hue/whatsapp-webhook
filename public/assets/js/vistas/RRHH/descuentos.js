// modules/RRHH/vistas/descuentos.ejs — los descuentos en nómina (módulo 4.2, db/298, 26/11/2026).
//
// Efectivo sin entregar, km fuera de la aplicación (del Banco de KM), siniestros
// y combustible. Cada uno con su prueba; ninguno entra en la nómina sin aprobar.
// Al cerrar el mes se descuenta lo de ese mes (o su parte) y lo que queda se
// aplaza al siguiente; el efectivo queda saldado en Recaudación.

(function () {
  const P = Casa.datos().puede || {};
  const { esc, etiqueta } = Listado.fmt;
  let ORIGENES = {}, ESTADOS = {}, PERIODO = '', PERIODOS = [];
  const est = d => ESTADOS[d.estado] || { etiqueta: d.estado, tono: 'muted' };
  const euros = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const mesDe = p => `${MESES[Number(p.slice(5, 7)) - 1]} de ${p.slice(0, 4)}`;
  const ABIERTOS = ['pendiente', 'aprobado', 'aplazado'];

  const lista = Listado.montar({
    raiz: '#modulo',
    titulo: 'Descuentos en nómina',
    icono: 'fa-hand-holding-dollar',
    clave: 'id',
    origen: '/descuentos/api/lista',
    vacio: 'No hay descuentos que coincidan.',
    filtrosIniciales: { estado: 'abiertos' },
    buscar: { texto: 'Buscar persona o motivo…', campos: ['nombre', 'legajo', 'motivo'] },

    subtitulo: (v, t) => (v.length === t.length ? `${t.length} descuentos` : `${v.length} de ${t.length} descuentos`),

    cifras: (filas, extra) => {
      if (extra && extra.origenes) ORIGENES = extra.origenes;
      if (extra && extra.estados) ESTADOS = extra.estados;
      if (extra && extra.periodoActual) PERIODO = extra.periodoActual;
      PERIODOS = [...new Set([PERIODO, ...filas.map(f => f.periodo)].filter(Boolean))].sort().reverse();
      const delMes = filas.filter(f => f.periodo === PERIODO && ['aprobado', 'aplazado'].includes(f.estado));
      const aDescontar = delMes.reduce((s, f) => s + Math.min(f.a_descontar || f.saldo, f.saldo), 0);
      return [
        { valor: filas.filter(f => f.estado === 'pendiente').length, etiqueta: 'por aprobar', tono: 'warn', filtro: { id: 'estado', valor: 'pendiente' } },
        { valor: euros(aDescontar), etiqueta: PERIODO ? `a descontar en la nómina de ${mesDe(PERIODO)}` : 'a descontar este mes', tono: 'gold',
          filtro: { id: 'mes', valor: PERIODO } },
        { valor: filas.filter(f => f.estado === 'aplazado').length, etiqueta: 'aplazados con saldo', filtro: { id: 'estado', valor: 'aplazado' } },
      ];
    },

    nota: (filas, extra) => [
      ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/298 en Migraciones.' }] : []),
      { icono: 'fa-circle-info', texto: 'Nada se descuenta sin aprobar. Los km llegan solos del Banco de KM cada semana cerrada; el efectivo, desde Recaudación. Al cerrar el mes, lo que no se descuenta entero queda aplazado con su saldo.' },
    ],

    filtros: [
      { id: 'estado', etiqueta: 'Estado', textoTodos: 'Cualquier estado',
        opciones: () => [{ valor: 'abiertos', texto: 'Sin terminar' }, ...Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta }))],
        pasa: (f, v) => (v === 'abiertos' ? ABIERTOS.includes(f.estado) : f.estado === v) },
      { id: 'origen', etiqueta: 'Origen', campo: 'origen', textoTodos: 'Cualquier origen',
        opciones: () => Object.entries(ORIGENES).map(([valor, o]) => ({ valor, texto: o.etiqueta })) },
      { id: 'mes', etiqueta: 'Nómina', campo: 'periodo', textoTodos: 'Cualquier nómina',
        opciones: () => PERIODOS.map(p => ({ valor: p, texto: `Nómina de ${mesDe(p)}` })) },
    ],

    acciones: [
      ...(P.proponer ? [{ texto: 'Nuevo descuento', icono: 'fa-plus', onClick: l => nuevo(l) }] : []),
      { texto: 'Excel del mes', icono: 'fa-file-excel', principal: false, onClick: () => excel() },
      ...(P.aprobar ? [{ texto: 'Cerrar la nómina del mes', icono: 'fa-lock', principal: false, onClick: l => cerrar(l) }] : []),
    ],

    columnas: [
      { titulo: 'Nómina', valor: f => mesDe(f.periodo), clase: 'whitespace-nowrap text-xs' },
      { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Legajo ${esc(f.legajo)}</span>` : '') },
      { titulo: 'Origen', valor: f => (ORIGENES[f.origen] || {}).etiqueta || f.origen,
        pinta: (v, f) => `${esc(v)}<span class="block text-xs text-telecab-muted">${esc(f.motivo)}</span>` },
      { titulo: 'Concepto A3', campo: 'concepto', clase: 'tabular-nums text-xs' },
      { titulo: 'Importe', valor: f => f.importe, clase: 'whitespace-nowrap tabular-nums text-right',
        pinta: (v, f) => esc(euros(v)) + (f.saldo < f.importe && f.estado !== 'anulado'
          ? `<span class="block text-xs text-telecab-muted">Queda ${esc(euros(f.saldo))}</span>` : '')
          + (f.a_descontar ? `<span class="block text-xs text-telecab-muted">Este mes ${esc(euros(f.a_descontar))}</span>` : '') },
      { titulo: 'Estado', valor: f => est(f).etiqueta, pinta: (v, f) => etiqueta(v, est(f).tono) },
    ],

    detalle: {
      origen: id => `/descuentos/api/descuento/${encodeURIComponent(id)}`,
      titulo: d => `${(ORIGENES[d.origen] || {}).etiqueta || d.origen}: ${euros(d.importe)}`,
      subtitulo: d => `${d.nombre} · nómina de ${d.mes}`,
      acciones: [
        { texto: 'Aprobar', icono: 'fa-check', principal: true, visible: d => d.puede.aprobar && d.estado === 'pendiente', onClick: (d, l) => aprobar(d, l) },
        { texto: 'Aplazar', icono: 'fa-forward', visible: d => d.puede.aprobar && ['aprobado', 'aplazado'].includes(d.estado), onClick: (d, l) => aplazar(d, l) },
        { texto: 'Anular', icono: 'fa-ban', visible: d => (d.puede.aprobar || d.puede.anularPropio) && ABIERTOS.includes(d.estado) && !d.descontado,
          onClick: (d, l) => anular(d, l) },
      ],
      bloques: [
        { titulo: 'El descuento', icono: 'fa-hand-holding-dollar', campos: [
          { etiqueta: 'Estado', html: true, valor: d => etiqueta(est(d).etiqueta, est(d).tono) },
          { etiqueta: 'Origen', valor: d => (ORIGENES[d.origen] || {}).etiqueta || d.origen },
          { etiqueta: 'Concepto de A3', valor: d => d.concepto },
          { etiqueta: 'Importe', valor: d => euros(d.importe) },
          { etiqueta: 'Descontado', valor: d => euros(d.descontado) },
          { etiqueta: 'Le queda', valor: d => euros(d.saldo) },
          { etiqueta: 'Este mes', visible: d => !!d.a_descontar, valor: d => `${euros(d.a_descontar)} (el resto se aplaza al cerrar)` },
          { etiqueta: 'Nómina', valor: d => `Nómina de ${d.mes}` },
          { etiqueta: 'Día', valor: d => dmy(d.fecha) },
          { etiqueta: 'Motivo', valor: d => d.motivo, ancho: 'sm:col-span-2' },
          { etiqueta: 'Visto bueno de Legal', visible: d => d.origen === 'combustible', valor: d => d.visto_legal || 'Falta: sin él no se aprueba' },
          { etiqueta: 'Entró', valor: d => `${d.creado}${d.creado_por_nombre ? ` · ${d.creado_por_nombre}` : ''}` },
          { etiqueta: 'Aprobado', visible: d => !!d.aprobado, valor: d => `${d.aprobado}${d.aprobado_por_nombre ? ` · ${d.aprobado_por_nombre}` : ''}` },
          { etiqueta: 'Nota', visible: d => !!d.nota, valor: d => d.nota, ancho: 'sm:col-span-2' },
          { etiqueta: 'Su ficha', html: true, valor: d => `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">Abrir en Plantilla</a>`
              + (d.origen === 'efectivo' ? ' · <a class="underline" href="/recaudacion">Recaudación</a>' : '')
              + (d.origen === 'km' ? ' · <a class="underline" href="/operaciones/banco-km">Banco de KM</a>' : '') },
        ] },
        { titulo: 'Los km de la semana', icono: 'fa-road', visible: d => d.origen === 'km' && !!d.evidencia, pinta: (d, hueco) => {
          const x = d.evidencia;
          hueco.className = 'p-5 text-sm space-y-1';
          hueco.innerHTML = `
            <p>Del ${esc(dmy(x.lunes))} al ${esc(dmy(x.domingo))}: <b>${esc(String(x.km).replace('.', ','))} km</b> fuera de la aplicación
              (${esc(String(x.kmFuera).replace('.', ','))} km, menos ${esc(String(x.justificados).replace('.', ','))} km justificados)
              contra un límite de <b>${esc(String(x.limite).replace('.', ','))} km</b> (${esc(String(x.horasViaje).replace('.', ','))} h de viaje).</p>
            <p>De más: <b>${esc(String(x.exceso).replace('.', ','))} km</b> a ${esc(String(x.precio).replace('.', ','))} €/km.</p>
            ${x.pendientesDeJustificar ? `<p class="text-telecab-warn">Tenía ${esc(String(x.pendientesDeJustificar).replace('.', ','))} km por justificar pendientes de aprobar: si se aprueban, este descuento baja.</p>` : ''}
            ${(x.matriculas || []).length ? `<p class="text-xs text-telecab-muted">Coches: ${x.matriculas.map(m => `${esc(m.matricula)} (${esc(String(m.km).replace('.', ','))} km)`).join(', ')}</p>` : ''}`;
        } },
        { titulo: 'Pruebas', icono: 'fa-paperclip', pinta: (d, hueco) => {
          hueco.className = '';
          Adjuntos.montar(hueco, { tipo: 'descuento', dueno: d.id, titulo: 'Fotos del siniestro, el ticket, el parte…',
            puedeAdjuntar: (P.proponer || P.aprobar) && ABIERTOS.includes(d.estado), puedeQuitar: P.aprobar && d.estado === 'pendiente' });
        } },
        { titulo: 'Lo descontado', icono: 'fa-receipt', visible: d => (d.aplicaciones || []).length > 0, pinta: (d, hueco) => {
          hueco.className = 'p-5 text-sm';
          hueco.innerHTML = `<ul class="space-y-1">${d.aplicaciones.map(a => `<li>Nómina de ${esc(mesDe(a.periodo))}: <b>${esc(euros(a.importe))}</b>
            · ${esc(a.cuando)}${a.por ? ` · ${esc(a.por)}` : ''}${a.movimiento_id ? ' · saldado en Recaudación' : ''}</li>`).join('')}</ul>`;
        } },
      ],
    },
  });

  async function post(url, cuerpo, aviso) {
    return Api.post(url, cuerpo || {}, { aviso: aviso || 'No se ha podido hacer', bloquea: true });
  }

  async function aprobar(d, l) {
    const campos = d.origen === 'combustible'
      ? [{ id: 'vistoLegal', etiqueta: 'Visto bueno de Legal', tipo: 'texto-largo', obligatorio: true, minimo: 3, ayuda: 'Quién lo dio y cuándo. Sin él no se aprueba.' }]
      : [];
    const v = await Dialogo.formulario('Aprobar el descuento', [...campos, { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 }],
      { textoBoton: 'Aprobar', nota: `${euros(d.importe)} en la nómina de ${d.mes}, concepto ${d.concepto} de A3.` });
    if (!v) return;
    if (await post(`/descuentos/api/descuento/${encodeURIComponent(d.id)}/aprobar`, v)) { Dialogo.hecho('Aprobado'); await l.recargar(); }
  }

  async function aplazar(d, l) {
    const v = await Dialogo.formulario('Aplazar', [
      { id: 'importe', etiqueta: 'Descontar este mes (opcional)', tipo: 'texto', marcador: `menos de ${euros(d.saldo)}`,
        ayuda: 'Vacío: todo pasa a la nómina del mes siguiente. Con un importe, eso se descuenta este mes y el resto se aplaza al cerrarlo.' },
      { id: 'nota', etiqueta: 'Por qué (opcional)', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: 'Aplazar' });
    if (!v) return;
    const r = await post(`/descuentos/api/descuento/${encodeURIComponent(d.id)}/aplazar`, v);
    if (r) { Dialogo.hecho(r.aDescontar ? `Este mes ${euros(r.aDescontar)}; el resto, al siguiente` : `Pasa a la nómina de ${mesDe(r.periodo)}`); await l.recargar(); }
  }

  async function anular(d, l) {
    const v = await Dialogo.formulario('Anular el descuento', [{ id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000 }],
      { textoBoton: 'Anular' });
    if (v && await post(`/descuentos/api/descuento/${encodeURIComponent(d.id)}/anular`, v)) { Dialogo.hecho('Anulado'); await l.recargar(); }
  }

  async function elegirMes(titulo, texto) {
    const v = await Dialogo.formulario(titulo, [
      { id: 'periodo', etiqueta: 'Nómina', tipo: 'lista', obligatorio: true, valor: PERIODO,
        opciones: PERIODOS.map(p => ({ valor: p, texto: `Nómina de ${mesDe(p)}` })) },
    ], { textoBoton: titulo, nota: texto });
    return v && v.periodo;
  }

  async function excel() {
    const p = await elegirMes('Bajar el Excel', 'Persona, concepto de A3 e importe de cada descuento de esa nómina: lo aprobado y lo ya descontado.');
    if (p) location.href = `/descuentos/api/excel/${encodeURIComponent(p)}`;
  }

  async function cerrar(l) {
    const p = await elegirMes('Cerrar la nómina', 'Se descuenta lo aprobado de esa nómina (o la parte marcada); lo que queda pasa a la siguiente, aplazado. El efectivo queda saldado en Recaudación. No se puede deshacer.');
    if (!p) return;
    const ok = await Dialogo.confirmar({ titulo: `Cerrar la nómina de ${mesDe(p)}`, si: 'Cerrarla', no: 'Cancelar', tono: 'peligro',
      texto: 'Se apuntan como descontados y el efectivo se salda en Recaudación. No se puede deshacer.' });
    if (!ok) return;
    const r = await post('/descuentos/api/cerrar-mes', { periodo: p }, 'No se ha podido cerrar');
    if (r) { Dialogo.hecho(`${r.descontados} descuentos, ${euros(r.total)}${r.aplazados ? `; ${r.aplazados} siguen con saldo` : ''}`); await l.recargar(); }
  }

  async function nuevo(l) {
    let gente;
    try { gente = (await Api.get('/descuentos/api/personas')).personas; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo cargar', texto: e.message, tono: 'error' }); }
    const v = await Dialogo.formulario('Nuevo descuento en nómina', [
      { id: 'conductorId', etiqueta: 'Quién', tipo: 'opciones', obligatorio: true,
        opciones: gente.map(p => ({ valor: p.id, texto: `${p.nombre}${p.alta ? '' : ' (de baja)'}` })), buscador: { marcador: 'Buscar…', tope: 12 } },
      { id: 'origen', etiqueta: 'De dónde sale', tipo: 'lista', obligatorio: true,
        opciones: Object.entries(ORIGENES).filter(([k]) => k !== 'km').map(([valor, o]) => ({ valor, texto: o.etiqueta })) },
      { id: 'importe', etiqueta: 'Importe (€)', tipo: 'texto', obligatorio: true, marcador: '125,50' },
      { id: 'fecha', etiqueta: 'Día', tipo: 'fecha', ayuda: 'Decide la nómina: hasta el 25, la de ese mes; desde el 26, la del siguiente. Vacío, hoy.' },
      { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000,
        ayuda: 'Un siniestro: el coche, qué pasó y la fecha. Combustible: el caso; necesitará el visto bueno de Legal para aprobarse.' },
      { id: 'pruebas', etiqueta: 'Pruebas (opcional)', tipo: 'ficheros', ayuda: 'Fotos, el ticket, el parte… También se pueden subir después.' },
    ], { textoBoton: 'Apuntar', ancho: 'max-w-xl' });
    if (!v || !v.conductorId) return;
    const r = await post('/descuentos/api/descuento', { conductorId: v.conductorId.valor, origen: v.origen, importe: v.importe, fecha: v.fecha, motivo: v.motivo },
      'No se ha podido apuntar');
    if (!r) return;
    for (const fichero of v.pruebas || []) {
      try { await Adjuntos.subir({ tipo: 'descuento', dueno: r.id, fichero }); }
      catch (e) { Dialogo.aviso({ titulo: 'Una prueba no se subió', texto: `${fichero.name}: ${e.message}. Súbela desde su ficha.`, tono: 'aviso' }); }
    }
    Dialogo.hecho(r.estado === 'aprobado' ? 'Apuntado y aprobado' : 'Apuntado: a la espera de ser aprobado');
    await l.recargar();
    l.abrir(r.id);
  }
  void lista;
})();
