// modules/RRHH/vistas/firmas.ejs — el envío a firma (módulo 6, db/293, 25/11/2026).
//
// Un documento para una persona. Diana sube el PDF y decide si se manda; los
// aprobados esperan a que Claude los mande por YouTrust en su nombre (con un
// «sí» en el chat por cada tanda); el firmado se adjunta.

(function () {
  const APRUEBA = !!Casa.datos().puedeAprobar;
  const { esc, etiqueta } = Listado.fmt;
  let ESTADOS = {}, TIPOS = {};
  const est = f => ESTADOS[f.estado] || { etiqueta: f.estado, tono: 'muted' };
  const quien = (cuando, por) => (cuando ? `${cuando}${por ? ` · ${por}` : ''}` : '—');
  const falta = f => [!f.documentos ? 'el PDF' : '', !f.firmante_email ? 'el email' : '', !f.firmante_movil ? 'el móvil' : ''].filter(Boolean);

  Listado.montar({
    raiz: '#modulo',
    titulo: 'Firmas',
    icono: 'fa-file-signature',
    clave: 'id',
    origen: '/firmas/api/lista',
    vacio: 'No hay envíos que coincidan.',
    filtrosIniciales: { estado: 'abiertos' },
    buscar: { texto: 'Buscar persona o documento…', campos: ['nombre', 'titulo', 'legajo'] },

    subtitulo: (v, t) => (v.length === t.length ? `${t.length} envíos` : `${v.length} de ${t.length} envíos`),

    cifras: (filas, extra) => {
      if (extra && extra.estados) ESTADOS = extra.estados;
      if (extra && extra.tipos) TIPOS = extra.tipos;
      const n = e => filas.filter(f => f.estado === e).length;
      return [
        { valor: n('borrador'), etiqueta: 'por aprobar', tono: 'warn', filtro: { id: 'estado', valor: 'borrador' } },
        { valor: n('aprobado'), etiqueta: 'aprobados, por enviar', tono: 'gold', filtro: { id: 'estado', valor: 'aprobado' } },
        { valor: n('enviado'), etiqueta: 'enviados, sin firmar', filtro: { id: 'estado', valor: 'enviado' } },
        { valor: n('error'), etiqueta: 'con error', tono: 'red', filtro: { id: 'estado', valor: 'error' } },
      ];
    },

    nota: (filas, extra) => [
      ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/293 en Migraciones.' }] : []),
      { icono: 'fa-circle-info', texto: 'Se firma por YouTrust, con un código por SMS al móvil del firmante. Los aprobados los manda el Bot telecab en nombre de quien los aprobó, cuando una persona lo pide.' },
    ],

    filtros: [
      { id: 'estado', etiqueta: 'Estado', textoTodos: 'Cualquier estado',
        opciones: () => [{ valor: 'abiertos', texto: 'Sin terminar' }, ...Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta }))],
        pasa: (f, v) => (v === 'abiertos' ? ['borrador', 'aprobado', 'enviado', 'error'].includes(f.estado) : f.estado === v) },
      { id: 'tipo', etiqueta: 'Documento', campo: 'tipo', textoTodos: 'Cualquier documento',
        opciones: () => Object.entries(TIPOS).map(([valor, texto]) => ({ valor, texto })) },
    ],

    acciones: APRUEBA ? [{ texto: 'Nuevo envío', icono: 'fa-plus', onClick: lst => nuevo(lst) }] : [],

    columnas: [
      { titulo: 'Entró', campo: 'creado', clase: 'whitespace-nowrap tabular-nums' },
      { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Legajo ${esc(f.legajo)}</span>` : '') },
      { titulo: 'Documento', campo: 'titulo', pinta: (v, f) => `${esc(v)}<span class="block text-xs text-telecab-muted">${esc(TIPOS[f.tipo] || f.tipo)}</span>` },
      { titulo: 'Falta', valor: f => (f.estado === 'borrador' ? falta(f).join(', ') : ''), clase: 'text-telecab-warn text-xs' },
      { titulo: 'Estado', valor: f => est(f).etiqueta, pinta: (v, f) => etiqueta(v, est(f).tono) },
    ],

    detalle: {
      origen: id => `/firmas/api/envio/${encodeURIComponent(id)}`,
      titulo: d => d.titulo,
      subtitulo: d => `${TIPOS[d.tipo] || d.tipo} · ${d.nombre}`,
      acciones: [
        { texto: 'Aprobar para firma', icono: 'fa-check', principal: true, visible: d => APRUEBA && d.estado === 'borrador', onClick: (d, l) => aprobar(d, l) },
        { texto: 'Volver a borrador', icono: 'fa-rotate-left', visible: d => APRUEBA && ['aprobado', 'error'].includes(d.estado), onClick: (d, l) => accion(d, l, 'borrador', {}, 'Vuelve a borrador') },
        { texto: 'Firmado', icono: 'fa-signature', visible: d => APRUEBA && d.estado === 'enviado', onClick: (d, l) => accion(d, l, 'cerrar', { estado: 'firmado' }, 'Firmado') },
        { texto: 'No lo firmó', icono: 'fa-user-xmark', visible: d => APRUEBA && d.estado === 'enviado', onClick: (d, l) => conNota(d, l, 'cerrar', { estado: 'rechazado' }, 'Qué pasó', 'Marcado: no lo firmó') },
        { texto: 'Caducado', icono: 'fa-hourglass-end', visible: d => APRUEBA && d.estado === 'enviado', onClick: (d, l) => accion(d, l, 'cerrar', { estado: 'caducado' }, 'Marcado caducado') },
        { texto: 'Descartar', icono: 'fa-ban', visible: d => APRUEBA && ['borrador', 'aprobado', 'error'].includes(d.estado), onClick: (d, l) => conNota(d, l, 'descartar', {}, 'Por qué no se manda', 'Descartado') },
      ],
      bloques: [
        { titulo: 'El envío', icono: 'fa-file-signature', campos: [
          { etiqueta: 'Estado', html: true, valor: d => etiqueta(est(d).etiqueta, est(d).tono) },
          { etiqueta: 'Documento', valor: d => TIPOS[d.tipo] || d.tipo },
          { etiqueta: 'Firmante', valor: d => d.firmante_nombre || d.nombre },
          { etiqueta: 'Email', html: true, valor: d => esc(d.firmante_email || '') || '<span class="text-telecab-warn">Falta en su ficha</span>' },
          { etiqueta: 'Móvil (código por SMS)', html: true, valor: d => esc(d.firmante_movil || '') || '<span class="text-telecab-warn">Falta en su ficha</span>' },
          { etiqueta: 'Cambió en la ficha', visible: d => d.firmanteHoy && ['borrador'].includes(d.estado) === false
              && (d.firmanteHoy.email !== d.firmante_email || d.firmanteHoy.movil !== d.firmante_movil),
            valor: d => `Hoy: ${d.firmanteHoy.email || 'sin email'} · ${d.firmanteHoy.movil || 'sin móvil'}` },
          { etiqueta: 'Entró', valor: d => quien(d.creado, d.creado_por_nombre) },
          { etiqueta: 'Aprobado', valor: d => quien(d.aprobado, d.aprobado_por_nombre) },
          { etiqueta: 'Enviado', valor: d => (d.enviado ? `${d.enviado} · ${d.enviado_por_nombre || ''}${d.en_nombre_de_nombre ? `, en nombre de ${d.en_nombre_de_nombre}` : ''}` : '—') },
          { etiqueta: 'En YouTrust', html: true, valor: d => (d.proveedor_url ? `<a class="underline" href="${esc(d.proveedor_url)}" target="_blank" rel="noopener noreferrer">Abrir el sobre</a>` : '—') },
          { etiqueta: 'Cerrado', valor: d => quien(d.cerrado, d.cerrado_por_nombre) },
          { etiqueta: 'Nota', valor: d => d.nota || '—', ancho: 'sm:col-span-2' },
          { etiqueta: 'Su ficha', html: true, valor: d => `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">Abrir en Plantilla</a>${d.origen === 'finiquito' ? ` · <a class="underline" href="/finiquitos#${encodeURIComponent(d.origen_id)}">Su finiquito</a>` : ''}` },
        ] },
        { titulo: 'Documento a firmar', icono: 'fa-file-pdf', pinta: (d, hueco) => {
          hueco.className = '';
          Adjuntos.montar(hueco, { tipo: 'firma_envio', dueno: d.id, titulo: 'El PDF que se manda a firmar',
            puedeAdjuntar: APRUEBA && d.estado === 'borrador', puedeQuitar: APRUEBA && d.estado === 'borrador' });
        } },
        { titulo: 'Firmado', icono: 'fa-signature', visible: d => ['enviado', 'firmado'].includes(d.estado), pinta: (d, hueco) => {
          hueco.className = '';
          Adjuntos.montar(hueco, { tipo: 'firma_firmada', dueno: d.id, titulo: 'El PDF firmado (descárgalo de YouTrust y súbelo aquí)',
            puedeAdjuntar: APRUEBA, puedeQuitar: APRUEBA });
        } },
      ],
    },
  });

  async function accion(d, lst, que, cuerpo, hecho) {
    const r = await Api.post(`/firmas/api/envio/${encodeURIComponent(d.id)}/${que}`, cuerpo || {}, { aviso: 'No se ha podido hacer', bloquea: true });
    if (!r) return;
    Dialogo.hecho(hecho);
    await lst.recargar();
  }

  async function conNota(d, lst, que, cuerpo, etiquetaNota, hecho) {
    const v = await Dialogo.formulario(hecho, [{ id: 'nota', etiqueta: etiquetaNota, tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000 }],
      { textoBoton: 'Guardar' });
    if (v) await accion(d, lst, que, { ...cuerpo, nota: v.nota }, hecho);
  }

  async function aprobar(d, lst) {
    const ok = await Dialogo.confirmar({ titulo: 'Aprobar para firma', si: 'Aprobar', no: 'Cancelar',
      texto: `Se mandará «${d.titulo}» a ${d.firmante_nombre || d.nombre} por YouTrust, en tu nombre, con un código por SMS. `
        + 'Queda esperando a que se mande la tanda. Se toman el email y el móvil de su ficha de ahora.' });
    if (ok) await accion(d, lst, 'aprobar', {}, 'Aprobado: espera a que se mande');
  }

  async function nuevo(lst) {
    let gente;
    try { gente = (await Api.get('/firmas/api/personas')).personas; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo cargar', texto: e.message, tono: 'error' }); }
    const v = await Dialogo.formulario('Nuevo envío a firma', [
      { id: 'conductorId', etiqueta: 'Quién firma', tipo: 'opciones', obligatorio: true,
        opciones: gente.map(p => ({ valor: p.id, texto: `${p.nombre}${p.alta ? '' : ' (de baja)'}` })), buscador: { marcador: 'Buscar…', tope: 12 } },
      { id: 'tipo', etiqueta: 'Qué documento es', tipo: 'lista', obligatorio: true, opciones: Object.entries(TIPOS).map(([valor, texto]) => ({ valor, texto })) },
      { id: 'titulo', etiqueta: 'Título (opcional)', tipo: 'texto', max: 200, ayuda: 'Lo que verá en YouTrust. Vacío: el tipo y su nombre.' },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: 'Crear', nota: 'Después, en su ficha, sube el PDF y apruébalo.' });
    if (!v || !v.conductorId) return;
    const r = await Api.post('/firmas/api/envio', { conductorId: v.conductorId.valor, tipo: v.tipo, titulo: v.titulo, nota: v.nota }, { aviso: 'No se ha podido crear' });
    if (!r) return;
    await lst.recargar();
    lst.abrir(r.id);
  }
})();
