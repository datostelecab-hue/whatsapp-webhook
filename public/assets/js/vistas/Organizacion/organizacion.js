// modules/Organizacion/vistas/organizacion.ejs — la organización (db/248).
//
// Pieza A5 de la hoja de ruta. Una persona de la oficina por fila: su área, su
// superior y lo que le toca hacer (sus funciones). En la ficha, además, las
// llaves que se salen de las de su rol.
//
// UNA FUNCIÓN NO ES UNA LLAVE: la llave abre una pantalla (se cambia en Usuarios
// y permisos); la función dice a quién le llega una tarea o quién aprueba. Y se
// mira en la persona: ni el superadmin ni el desarrollador la tienen por su rol.

(function () {
  const { fecha, esc, etiqueta } = Listado.fmt;
  const URL = '/organizacion';
  const SIN_AREA = '__sin';

  const SI_NO = [{ valor: 'si', texto: 'Sí' }, { valor: 'no', texto: 'No' }];

  /** Las funciones de una fila, en pastillas; con muchas, las tres primeras y «+N». */
  function pastillas(fs) {
    if (!fs.length) return '<span class="text-telecab-muted text-xs">Ninguna</span>';
    const vistas = fs.slice(0, 3).map(f => `<span class="inline-block max-w-[16rem] truncate align-middle px-2 py-0.5 rounded-lg text-xs
        bg-telecab-card2 border border-telecab-border" title="${esc(f.etiqueta)}">${esc(f.etiqueta)}${
        f.suplente ? ' <span class="text-telecab-muted">(suplente)</span>' : ''}</span>`);
    if (fs.length > 3) vistas.push(`<span class="text-xs text-telecab-muted" title="${esc(fs.slice(3).map(f => f.etiqueta).join(', '))}">+${fs.length - 3}</span>`);
    return `<span class="flex flex-wrap items-center gap-1">${vistas.join('')}</span>`;
  }

  const superiorHtml = f => (f.superior
    ? esc(f.superior) + (f.superiorPorque === 'puesto' ? ''
      : '<span class="block text-[11px] text-telecab-muted">por ser responsable del área</span>')
    : '<span class="text-telecab-muted text-xs">Sin superior</span>');

  const lst = Listado.montar({
    raiz: '#modulo',
    titulo: 'Organización',
    icono: 'fa-sitemap',
    clave: 'id',
    origen: URL + '/api/lista',
    vacio: 'No hay nadie que coincida.',
    buscar: { texto: 'Persona o función…', campos: ['nombre', 'areaEtiqueta', 'superior', 'rolEtiqueta', f => f.funciones.map(x => x.etiqueta).join(' ')] },
    subtitulo: (visibles, todas) => (visibles.length === todas.length
      ? `${todas.length} personas de la oficina · área, superior y qué le toca a cada una`
      : `${visibles.length} de ${todas.length} personas`),

    nota: (v, extra) => {
      const notas = [{ texto: 'Una función no abre ninguna pantalla: dice a quién le llega una tarea o quién aprueba. Las pantallas que abre cada uno (sus llaves) se cambian en Usuarios y permisos.' }];
      const sin = (extra && extra.sinNadie) || [];
      if (sin.length) {
        notas.push({ tono: 'aviso', icono: 'fa-triangle-exclamation',
          texto: `${sin.length === 1 ? 'Una función no la tiene' : sin.length + ' funciones no las tiene'} nadie: ${sin.map(f => f.etiqueta).join(' · ')}. Lo que dependa de ella no tendrá a quién llegar.` });
      }
      return notas;
    },

    kpis: (filas, extra) => [
      { etiqueta: 'Sin área', valor: filas.filter(f => !f.area).length, tono: filas.some(f => !f.area) ? 'warn' : 'text',
        pie: `de ${filas.length} personas`, filtro: { id: 'area', valor: SIN_AREA },
        ayuda: 'Sin área no tiene responsable de área: sus tareas no suben a nadie' },
      { etiqueta: 'Sin superior', valor: filas.filter(f => !f.superior).length, pie: 'ni puesto ni por su área',
        filtro: { id: 'superior', valor: 'no' } },
      { etiqueta: 'Con alguna función', valor: filas.filter(f => f.funciones.length).length, tono: 'gold',
        pie: `${filas.reduce((n, f) => n + f.funciones.length, 0)} funciones repartidas`, filtro: { id: 'tiene', valor: 'si' } },
      { etiqueta: 'Funciones sin nadie', valor: ((extra && extra.sinNadie) || []).length,
        tono: ((extra && extra.sinNadie) || []).length ? 'warn' : 'text',
        pie: `de ${((extra && extra.funciones) || []).length} del catálogo`,
        ayuda: ((extra && extra.sinNadie) || []).map(f => f.etiqueta).join(', ') || 'Todas tienen a alguien' },
    ],

    filtros: [
      {
        id: 'area', etiqueta: 'Área', textoTodos: 'Todas',
        opciones: (filas, extra) => ((extra && extra.areas) || [])
          .map(a => ({ valor: a.codigo, texto: a.etiqueta, cuenta: filas.filter(f => f.area === a.codigo).length }))
          .filter(o => o.cuenta)
          .concat([{ valor: SIN_AREA, texto: 'Sin área', cuenta: filas.filter(f => !f.area).length }]),
        pasa: (f, v) => (v === SIN_AREA ? !f.area : f.area === v),
      },
      {
        id: 'funcion', etiqueta: 'Función', textoTodos: 'Todas',
        opciones: (filas, extra) => ((extra && extra.funciones) || [])
          .map(x => ({ valor: x.codigo, texto: x.etiqueta, cuenta: filas.filter(f => f.funciones.some(y => y.codigo === x.codigo)).length }))
          .filter(o => o.cuenta),
        pasa: (f, v) => f.funciones.some(y => y.codigo === v),
      },
      {
        id: 'superior', etiqueta: 'Superior', textoTodos: 'Todos',
        opciones: filas => [
          { valor: 'si', texto: 'Con superior', cuenta: filas.filter(f => f.superior).length },
          { valor: 'no', texto: 'Sin superior', cuenta: filas.filter(f => !f.superior).length },
        ],
        pasa: (f, v) => (v === 'si' ? !!f.superior : !f.superior),
      },
      {
        id: 'tiene', etiqueta: 'Funciones', textoTodos: 'Todas',
        opciones: filas => [
          { valor: 'si', texto: 'Con alguna', cuenta: filas.filter(f => f.funciones.length).length },
          { valor: 'no', texto: 'Ninguna', cuenta: filas.filter(f => !f.funciones.length).length },
        ],
        pasa: (f, v) => (v === 'si' ? f.funciones.length > 0 : !f.funciones.length),
      },
    ],

    columnas: [
      { titulo: 'Persona', campo: 'nombre',
        pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>` +
          `<span class="block text-[11px] text-telecab-muted">${esc(f.rolEtiqueta || f.rol || '')}</span>` },
      { titulo: 'Área', valor: f => f.areaEtiqueta || 'Sin área', clase: 'whitespace-nowrap',
        pinta: (v, f) => (f.area
          ? esc(f.areaEtiqueta) + (f.responsableDe.length ? ' ' + etiqueta('Responsable', 'gold') : '')
          : '<span class="text-telecab-muted text-xs">Sin área</span>') },
      { titulo: 'Superior', valor: f => f.superior || '', clase: 'whitespace-nowrap', pinta: (v, f) => superiorHtml(f) },
      { titulo: 'Funciones', valor: f => f.funciones.map(x => x.etiqueta + (x.suplente ? ' (suplente)' : '')).join('; '),
        pinta: (v, f) => pastillas(f.funciones) },
      { titulo: 'Correo', soloExcel: true, valor: f => f.email || '' },
      { titulo: 'Rol', soloExcel: true, valor: f => f.rolEtiqueta || f.rol || '' },
    ],

    detalle: {
      origen: id => `${URL}/api/ficha/${encodeURIComponent(id)}`,
      titulo: d => d.nombre,
      subtitulo: d => [d.rolEtiqueta || d.rol, d.areaEtiqueta || 'Sin área'].filter(Boolean).join(' · '),
      acciones: [
        { texto: 'Cambiar área y superior', icono: 'fa-sitemap', principal: true, onClick: d => cambiarArea(d) },
        { texto: 'Dar una función', icono: 'fa-plus', onClick: d => darFuncion(d) },
      ],
      bloques: [
        {
          titulo: 'Dónde está', icono: 'fa-sitemap',
          campos: [
            { etiqueta: 'Área', html: true, valor: d => (d.area
              ? esc(d.areaEtiqueta) + (d.responsableDe.length ? ' ' + etiqueta('Responsable del área', 'gold') : '')
              : '<span class="text-telecab-muted">Sin área</span>') },
            { etiqueta: 'Superior', html: true, valor: d => superiorHtml(d) },
            { etiqueta: 'Rol', valor: d => d.rolEtiqueta || d.rol },
            { etiqueta: 'Correo', valor: d => d.email },
          ],
        },
        {
          titulo: 'Funciones', icono: 'fa-list-check',
          tabla: {
            datos: d => d.funciones,
            vacio: 'No tiene ninguna función: no le llega ninguna tarea por lo que hace.',
            columnas: [
              { titulo: 'Función', campo: 'etiqueta',
                pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>` +
                  (f.nota ? `<span class="block text-[11px] text-telecab-muted">${esc(f.nota)}</span>` : '') },
              { titulo: 'Como', campo: 'suplente', clase: 'whitespace-nowrap',
                pinta: v => (v ? etiqueta('Suplente', 'muted') : 'Titular') },
              { titulo: 'Desde', campo: 'desde', clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(fecha(v)) },
              { titulo: 'Se la dio', campo: 'dadaPor', clase: 'whitespace-nowrap', pinta: v => esc(v || '—') },
            ],
            acciones: [
              { icono: 'fa-xmark', titulo: 'Quitar', onClick: (f, d) => quitarFuncion(f, d) },
            ],
          },
        },
        {
          titulo: 'Llaves que se salen de su rol', icono: 'fa-key',
          pinta: (d, hueco) => { hueco.innerHTML = llavesHtml(d); },
        },
      ],
    },
  });

  function llavesHtml(d) {
    const ll = d.llaves || {};
    const pie = '<p class="text-xs text-telecab-muted mt-4">Las llaves se cambian en <a class="text-telecab-gold hover:underline" href="/usuarios">Usuarios y permisos</a>.</p>';
    if (ll.accesoTotal) {
      return `<p class="text-sm">Su rol (${esc(d.rolEtiqueta || d.rol)}) abre todas las pantallas: no tiene excepciones.</p>` +
        '<p class="text-xs text-telecab-muted mt-1">Las funciones, en cambio, no le vienen por el rol: solo las que tenga dadas.</p>';
    }
    if (!(ll.deMas || []).length && !(ll.deMenos || []).length) {
      return `<p class="text-sm">Tiene justo las llaves de su rol (${esc(d.rolEtiqueta || d.rol)}).</p>` + pie;
    }
    const lista = (titulo, xs, tono) => (xs.length ? `
      <div>
        <p class="text-xs text-telecab-muted uppercase tracking-wide mb-2">${esc(titulo)} <span class="tabular-nums">(${xs.length})</span></p>
        <ul class="space-y-1">${xs.map(k => `<li class="flex items-start gap-2 text-sm">
          <i class="fa-solid ${tono === 'mas' ? 'fa-plus text-telecab-gold' : 'fa-minus text-telecab-muted'} text-[10px] mt-1.5" aria-hidden="true"></i>
          <span>${esc(k.etiqueta)}</span></li>`).join('')}</ul>
      </div>` : '');
    return `<div class="grid gap-6 sm:grid-cols-2">
        ${lista('Tiene además de las de su rol', ll.deMas || [], 'mas')}
        ${lista('Le faltan de las de su rol', ll.deMenos || [], 'menos')}
      </div>` + pie;
  }

  // ── Cambiar ─────────────────────────────────────────────────────────────
  async function guardar(url, cuerpo, hecho, d) {
    try {
      await Api.post(url, cuerpo);
      Dialogo.hecho(hecho);
      await lst.recargar();
      await lst.abrir(d.id, { historial: false });
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se ha guardado', texto: e.message, tono: 'error' });
    }
  }

  async function cambiarArea(d) {
    const extra = lst.extra || {};
    const areas = (extra.areas || []).filter(a => a.activa);
    const gente = (lst.filas || []).filter(p => p.id !== d.id);
    const v = await Dialogo.formulario(`Área y superior · ${d.nombre}`, [
      { id: 'area', etiqueta: 'Área', tipo: 'lista', valor: d.area || '',
        opciones: areas.map(a => ({ valor: a.codigo, texto: a.etiqueta + (a.responsable && a.responsable_id !== d.id ? ` (responsable: ${a.responsable})` : '') })) },
      { id: 'responsable', etiqueta: '¿Es la responsable de su área?', tipo: 'lista', obligatorio: true,
        valor: d.responsableDe.length ? 'si' : 'no', opciones: SI_NO,
        ayuda: 'Si el área ya tenía responsable, pasa a ser esta persona. Lleva solo el área en la que está.' },
      { id: 'superiorId', etiqueta: 'Superior', tipo: 'lista', valor: d.superiorId ? String(d.superiorId) : '',
        opciones: gente.map(p => ({ valor: String(p.id), texto: p.nombre + (p.areaEtiqueta ? ` · ${p.areaEtiqueta}` : '') })),
        ayuda: 'Déjalo sin dato y su superior será el responsable de su área.' },
    ], { textoBoton: 'Guardar' });
    if (!v) return;
    await guardar(`${URL}/api/area/${d.id}`,
      { area: v.area || null, superiorId: v.superiorId || null, responsable: v.responsable === 'si' },
      'Guardado', d);
  }

  async function darFuncion(d) {
    const ya = new Set(d.funciones.map(f => f.codigo));
    const catalogo = ((lst.extra || {}).funciones || []).filter(f => !ya.has(f.codigo));
    if (!catalogo.length) {
      await Dialogo.aviso({ titulo: 'Ya las tiene todas', texto: `${d.nombre} tiene todas las funciones del catálogo.` });
      return;
    }
    const v = await Dialogo.formulario(`Dar una función · ${d.nombre}`, [
      { id: 'funcion', etiqueta: 'Función', tipo: 'lista', obligatorio: true,
        opciones: catalogo.map(f => ({ valor: f.codigo, texto: f.etiqueta })) },
      { id: 'suplente', etiqueta: '¿Como suplente?', tipo: 'lista', obligatorio: true, valor: 'no', opciones: SI_NO,
        ayuda: 'El suplente la hace cuando falta el titular.' },
      { id: 'nota', etiqueta: 'Nota', tipo: 'texto-largo', max: 500, marcador: 'Opcional. Ej.: solo los de Madrid; hasta que vuelva Laura' },
    ], { textoBoton: 'Dar la función', nota: 'Desde ya le llegan las tareas de esa función. Queda en su historia, con tu nombre.' });
    if (!v) return;
    await guardar(`${URL}/api/funcion/${d.id}`, { funcion: v.funcion, suplente: v.suplente === 'si', nota: v.nota }, 'Función dada', d);
  }

  async function quitarFuncion(f, d) {
    const v = await Dialogo.formulario(`Quitar · ${f.etiqueta}`, [
      { id: 'motivo', etiqueta: 'Por qué se le quita', tipo: 'texto-largo', obligatorio: true, max: 500,
        marcador: 'Ej.: ahora lo lleva Daiane; cambia de área', ayuda: 'Queda en su historia, con tu nombre. No se borra nada.' },
    ], { textoBoton: 'Quitar la función', nota: `${d.nombre} deja de recibir las tareas de «${f.etiqueta}» desde ya.` });
    if (!v) return;
    await guardar(`${URL}/api/funcion/${f.id}/quitar`, { motivo: v.motivo }, 'Función quitada', d);
  }
})();
