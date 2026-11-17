// modules/Organizacion/vistas/organizacion.ejs — la organización (db/248, db/255).
//
// Pieza A5 de la hoja de ruta. Una persona de la oficina por fila: su PUESTO
// (db/255) y lo que le viene de él —su área, su superior y sus funciones—, más
// lo que tenga a mano por encima. En la ficha, además, las llaves que se salen
// de las de su rol. Camilo, 17/11/2026: «no lo veas tanto por nombres sino por
// roles: si mañana se va una Karen, puede que venga otra persona y tome su rol».
// Por eso lo primero de cada persona es su puesto.
//
// UNA FUNCIÓN NO ES UNA LLAVE: la llave abre una pantalla (se cambia en Usuarios
// y permisos); la función dice a quién le llega una tarea o quién aprueba. Y se
// mira en la persona: ni el superadmin ni el desarrollador la tienen por su rol.

(function () {
  const { fecha, esc, etiqueta } = Listado.fmt;
  const URL = '/organizacion';
  const SIN_AREA = '__sin';
  const SIN_PUESTO = '__sin';

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

  const PORQUE = { 'a mano': 'puesto a mano', 'responsable del área': 'por dirigir su área' };
  const superiorHtml = f => (f.superior
    ? esc(f.superior) + (PORQUE[f.superiorPorque]
      ? `<span class="block text-[11px] text-telecab-muted">${esc(PORQUE[f.superiorPorque])}</span>` : '')
    : '<span class="text-telecab-muted text-xs">Sin superior</span>');
  const puestoHtml = f => (f.puestoNombre
    ? `<span class="font-medium">${esc(f.puestoNombre)}</span>` +
      (f.puestoReportaA ? `<span class="block text-[11px] text-telecab-muted">reporta a ${esc(f.puestoReportaA)}</span>` : '')
    : '<span class="text-telecab-muted text-xs">Sin puesto</span>');
  const vacantes = extra => ((extra && extra.puestos) || []).filter(p => !p.ocupan.length);

  const lst = Listado.montar({
    raiz: '#modulo',
    titulo: 'Organización',
    icono: 'fa-sitemap',
    clave: 'id',
    origen: URL + '/api/lista',
    vacio: 'No hay nadie que coincida.',
    buscar: { texto: 'Persona, puesto o función…', campos: ['nombre', 'puestoNombre', 'areaEtiqueta', 'superior', 'rolEtiqueta', f => f.funciones.map(x => x.etiqueta).join(' ')] },
    subtitulo: (visibles, todas) => (visibles.length === todas.length
      ? `${todas.length} personas de la oficina · su puesto, y de él su área, su superior y lo que le toca`
      : `${visibles.length} de ${todas.length} personas`),

    nota: (v, extra) => {
      const notas = [
        { texto: 'Cada persona tiene un puesto, y de él le vienen su área, su superior (quien ocupe el puesto al que reporta) y sus funciones. Si alguien se va, quien ocupe su puesto lo hereda todo.' },
        { texto: 'Una función no abre ninguna pantalla: dice a quién le llega una tarea o quién aprueba. Las pantallas que abre cada uno (sus llaves) se cambian en Usuarios y permisos.' },
      ];
      const libres = vacantes(extra);
      if (libres.length) {
        notas.push({ tono: 'aviso', icono: 'fa-user-slash',
          texto: `${libres.length === 1 ? 'Un puesto no lo ocupa' : libres.length + ' puestos no los ocupa'} nadie: ${libres.map(p => p.nombre).join(' · ')}. Sus funciones no le llegan a nadie, y quien reportaba a él sube al puesto de encima.` });
      }
      const sin = (extra && extra.sinNadie) || [];
      if (sin.length) {
        notas.push({ tono: 'aviso', icono: 'fa-triangle-exclamation',
          texto: `${sin.length === 1 ? 'Una función no la tiene' : sin.length + ' funciones no las tiene'} nadie: ${sin.map(f => f.etiqueta).join(' · ')}. Lo que dependa de ella no tendrá a quién llegar.` });
      }
      return notas;
    },

    kpis: (filas, extra) => [
      { etiqueta: 'Sin puesto', valor: filas.filter(f => !f.puesto).length, tono: filas.some(f => !f.puesto) ? 'warn' : 'text',
        icono: 'fa-id-badge', pie: `de ${filas.length} personas`, filtro: { id: 'puesto', valor: SIN_PUESTO },
        ayuda: 'Sin puesto no le viene ni área, ni superior, ni funciones: solo lo que tenga a mano' },
      { etiqueta: 'Sin superior', valor: filas.filter(f => !f.superior).length, pie: 'ni puesto ni por su área',
        filtro: { id: 'superior', valor: 'no' } },
      { etiqueta: 'Puestos sin nadie', valor: vacantes(extra).length, tono: vacantes(extra).length ? 'warn' : 'text',
        icono: 'fa-user-slash', pie: `de ${((extra && extra.puestos) || []).length} puestos`,
        ayuda: vacantes(extra).map(p => p.nombre).join(', ') || 'Todos tienen a alguien' },
      { etiqueta: 'Funciones sin nadie', valor: ((extra && extra.sinNadie) || []).length,
        tono: ((extra && extra.sinNadie) || []).length ? 'warn' : 'text',
        pie: `de ${((extra && extra.funciones) || []).length} del catálogo`,
        ayuda: ((extra && extra.sinNadie) || []).map(f => f.etiqueta).join(', ') || 'Todas tienen a alguien' },
    ],

    filtros: [
      {
        id: 'puesto', etiqueta: 'Puesto', textoTodos: 'Todos',
        opciones: (filas, extra) => ((extra && extra.puestos) || [])
          .map(p => ({ valor: p.codigo, texto: p.nombre, cuenta: filas.filter(f => f.puesto === p.codigo).length }))
          .filter(o => o.cuenta)
          .concat([{ valor: SIN_PUESTO, texto: 'Sin puesto', cuenta: filas.filter(f => !f.puesto).length }]),
        pasa: (f, v) => (v === SIN_PUESTO ? !f.puesto : f.puesto === v),
      },
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
      { titulo: 'Puesto', valor: f => f.puestoNombre || 'Sin puesto', pinta: (v, f) => puestoHtml(f) },
      { titulo: 'Área', valor: f => f.areaEtiqueta || 'Sin área', clase: 'whitespace-nowrap',
        pinta: (v, f) => (f.area
          ? esc(f.areaEtiqueta) + (f.responsableDe.length ? ' ' + etiqueta('Dirige', 'gold') : '')
            + (f.areaAMano ? '<span class="block text-[11px] text-telecab-muted">puesta a mano</span>' : '')
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
      subtitulo: d => [d.puestoNombre || 'Sin puesto', d.areaEtiqueta || 'Sin área'].filter(Boolean).join(' · '),
      acciones: [
        { texto: 'Cambiar el puesto', icono: 'fa-id-badge', principal: true, onClick: d => cambiarPuesto(d) },
        { texto: 'Área o superior a mano', icono: 'fa-sitemap', onClick: d => cambiarArea(d) },
        { texto: 'Dar una función de más', icono: 'fa-plus', onClick: d => darFuncion(d) },
      ],
      bloques: [
        {
          titulo: 'Dónde está', icono: 'fa-sitemap',
          campos: [
            { etiqueta: 'Puesto', html: true, valor: d => puestoHtml(d) },
            { etiqueta: 'Área', html: true, valor: d => (d.area
              ? esc(d.areaEtiqueta) + (d.responsableDe.length ? ' ' + etiqueta(`Dirige ${d.responsableDe.join(', ')}`, 'gold') : '')
                + (d.areaAMano ? ' <span class="text-[11px] text-telecab-muted">(puesta a mano, no la de su puesto)</span>' : '')
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
            vacio: 'No tiene ninguna función: no le llega ninguna tarea por lo que hace. Le vendrían de su puesto.',
            columnas: [
              { titulo: 'Función', campo: 'etiqueta',
                pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>` +
                  (f.nota ? `<span class="block text-[11px] text-telecab-muted">${esc(f.nota)}</span>` : '') },
              { titulo: 'Como', campo: 'suplente', clase: 'whitespace-nowrap',
                pinta: v => (v ? etiqueta('Suplente', 'muted') : 'Titular') },
              { titulo: 'Le viene', campo: 'dePuesto', clase: 'whitespace-nowrap',
                pinta: (v, f) => (v ? `De su puesto` : `A mano${f.dadaPor ? ` · ${esc(f.dadaPor)}` : ''}`) },
              { titulo: 'Desde', campo: 'desde', clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(fecha(v)) },
            ],
            // Las de su puesto no se le quitan a la persona: se le cambia el puesto.
            acciones: [
              { icono: 'fa-xmark', titulo: 'Quitar', visible: f => !f.dePuesto, onClick: (f, d) => quitarFuncion(f, d) },
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
    const v = await Dialogo.formulario(`Área y superior a mano · ${d.nombre}`, [
      { id: 'area', etiqueta: 'Área', tipo: 'lista', valor: d.areaAMano ? (d.area || '') : '',
        opciones: areas.map(a => ({ valor: a.codigo, texto: a.etiqueta + (a.responsable && a.responsable_id !== d.id ? ` (responsable: ${a.responsable})` : '') })) },
      { id: 'responsable', etiqueta: '¿Es la responsable de su área?', tipo: 'lista', obligatorio: true,
        valor: d.responsableDe.length ? 'si' : 'no', opciones: SI_NO,
        ayuda: 'Si el área ya tenía responsable, pasa a ser esta persona. Lleva solo el área en la que está.' },
      { id: 'superiorId', etiqueta: 'Superior', tipo: 'lista', valor: d.superiorId ? String(d.superiorId) : '',
        opciones: gente.map(p => ({ valor: String(p.id), texto: p.nombre + (p.areaEtiqueta ? ` · ${p.areaEtiqueta}` : '') })),
        ayuda: 'Déjalo sin dato y su superior será quien ocupe el puesto al que reporta el suyo.' },
    ], { textoBoton: 'Guardar', nota: 'Solo para excepciones: lo normal es que el área y el superior le vengan de su puesto.' });
    if (!v) return;
    // El «Sí» de responsable viene de su área de ANTES y el formulario no lo
    // recalcula al elegir otra: si va a llevar otra área, o a quitarle el puesto
    // a quien la llevaba, se pregunta con los nombres antes de guardar.
    const nueva = areas.find(a => a.codigo === v.area);
    const otro = nueva && nueva.responsable_id && nueva.responsable_id !== d.id ? nueva.responsable : null;
    if (v.responsable === 'si' && nueva && (v.area !== d.area || otro)) {
      const frase = t => (/[.!?]$/.test(t) ? t : t + '.');   // «RR. HH.» ya trae su punto
      const lineas = [frase(`${d.nombre} pasa a ser responsable de ${nueva.etiqueta}${otro ? `, en lugar de ${otro}` : ''}`)];
      if (d.responsableDe.length && v.area !== d.area) {
        lineas.push(`${d.areaEtiqueta} se queda sin responsable: quien no tenga superior puesto se queda sin superior.`);
      }
      const si = await Dialogo.confirmar({ titulo: '¿Cambiar de responsable?', texto: lineas.join(' '),
        si: 'Sí, que sea la responsable', no: 'Volver' });
      if (!si) return;
    }
    await guardar(`${URL}/api/area/${d.id}`,
      { area: v.area || null, superiorId: v.superiorId || null, responsable: v.responsable === 'si' },
      'Guardado', d);
  }

  async function cambiarPuesto(d) {
    const puestos = (lst.extra || {}).puestos || [];
    const v = await Dialogo.formulario(`Puesto · ${d.nombre}`, [
      { id: 'puesto', etiqueta: 'Puesto', tipo: 'lista', valor: d.puesto || '',
        opciones: puestos.map(p => ({ valor: p.codigo, texto: `${p.nombre} · ${p.areaEtiqueta}` +
          (p.ocupan.length ? ` (${p.ocupan.map(x => x.nombre).join(', ')})` : ' (vacante)') })),
        ayuda: 'Déjalo sin dato y se queda sin puesto: solo le valdrá lo que tenga a mano.' },
    ], { textoBoton: 'Guardar', nota: 'Desde ya le vienen el área, el superior y las funciones de ese puesto. Lo que tenga a mano se queda.' });
    if (!v) return;
    await guardar(`${URL}/api/puesto/${d.id}`, { puesto: v.puesto || null }, 'Puesto guardado', d);
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
