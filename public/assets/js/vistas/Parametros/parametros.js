// modules/Parametros/vistas/parametros.ejs — los parámetros de negocio (db/243).
//
// Hoja de ruta de Ignacio, convención 4: «Todo número de regla es un parámetro.
// Plazos, topes y fechas (5 días, 100 €, día 20, etc.) van en una tabla de
// parámetros editable por un administrador, no en el código».
//
// Un parámetro por fila con su valor de hoy. En la ficha: qué es, quién lo usa,
// su valor por defecto y la historia de sus cambios. «Cambiar» pide el valor
// nuevo y el porqué; el cambio vale desde ese momento y no pisa los anteriores.
// Los que aún no usa nadie lo dicen: cambiarlos no cambia nada hasta que se
// haga su ítem.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const DIAS = DEL_SERVIDOR.diasSemana || [];
  const { fechaHora, esc, etiqueta } = Listado.fmt;
  const URL = '/parametros';

  const estado = f => (f.enUso
    ? etiqueta('En uso', 'green')
    : etiqueta(f.item ? `Ítem ${f.item}, aún sin usar` : 'Aún sin usar', 'muted'));

  const cambiado = f => (f.esDefecto
    ? '<span class="text-telecab-muted text-xs">Por defecto</span>'
    : `<span class="text-xs">Cambiado${f.ultimo && f.ultimo.quien ? ' por ' + esc(f.ultimo.quien) : ''}</span>` +
      (f.ultimo ? `<span class="block text-[11px] text-telecab-muted tabular-nums">${esc(fechaHora(f.ultimo.cuando))}</span>` : ''));

  const lst = Listado.montar({
    raiz: '#modulo',
    titulo: 'Parámetros',
    icono: 'fa-sliders',
    clave: 'clave',
    origen: URL + '/api/lista',
    vacio: 'No hay parámetros que coincidan.',
    buscar: { texto: 'Parámetro…', campos: ['etiqueta', 'descripcion', 'modulo', 'texto', 'clave'] },
    subtitulo: (visibles, todas) => (visibles.length === todas.length
      ? `${todas.length} parámetros · los números de las reglas de la hoja de ruta`
      : `${visibles.length} de ${todas.length} parámetros`),
    nota: () => ({ texto: 'Cada cambio vale desde ese momento y queda en la historia del parámetro, con quién y por qué. Un plazo que ya está corriendo no cambia: guardó su fecha límite al nacer.' }),

    kpis: filas => [
      { etiqueta: 'En uso', valor: filas.filter(f => f.enUso).length, tono: 'gold', pie: `de ${filas.length} parámetros`,
        filtro: { id: 'uso', valor: 'si' }, ayuda: 'Los que ya usa alguna parte del ERP: cambiarlos se nota desde ya' },
      { etiqueta: 'Cambiados', valor: filas.filter(f => !f.esDefecto).length, pie: 'no valen lo de la hoja de ruta',
        filtro: { id: 'cambiado', valor: 'si' } },
      { etiqueta: 'Aún sin usar', valor: filas.filter(f => !f.enUso).length, pie: 'los usará su ítem',
        filtro: { id: 'uso', valor: 'no' } },
    ],

    filtros: [
      {
        id: 'modulo', campo: 'modulo', etiqueta: 'Área', textoTodos: 'Todas',
        opciones: filas => [...new Set(filas.map(f => f.modulo))]
          .map(m => ({ valor: m, texto: m, cuenta: filas.filter(f => f.modulo === m).length })),
      },
      {
        id: 'uso', etiqueta: 'Uso', textoTodos: 'Todos',
        opciones: filas => [
          { valor: 'si', texto: 'En uso', cuenta: filas.filter(f => f.enUso).length },
          { valor: 'no', texto: 'Aún sin usar', cuenta: filas.filter(f => !f.enUso).length },
        ],
        pasa: (f, v) => (v === 'si' ? f.enUso : !f.enUso),
      },
      {
        id: 'cambiado', etiqueta: 'Valor', textoTodos: 'Todos',
        opciones: filas => [
          { valor: 'si', texto: 'Cambiados', cuenta: filas.filter(f => !f.esDefecto).length },
          { valor: 'no', texto: 'Por defecto', cuenta: filas.filter(f => f.esDefecto).length },
        ],
        pasa: (f, v) => (v === 'si' ? !f.esDefecto : f.esDefecto),
      },
    ],

    columnas: [
      { titulo: 'Parámetro', campo: 'etiqueta',
        pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>` +
          (f.descripcion ? `<span class="block text-[11px] text-telecab-muted">${esc(f.descripcion)}</span>` : '') },
      { titulo: 'Valor', campo: 'texto', clase: 'tabular-nums',
        pinta: v => `<span class="font-semibold">${esc(v)}</span>` },
      { titulo: 'Área', campo: 'modulo', clase: 'whitespace-nowrap', pinta: v => esc(v) },
      { titulo: 'Uso', valor: f => (f.enUso ? 'En uso' : (f.item ? `Ítem ${f.item}` : 'Sin usar')), clase: 'whitespace-nowrap',
        pinta: (v, f) => estado(f) },
      { titulo: 'Último cambio', valor: f => (f.esDefecto ? 'Por defecto' : (f.ultimo && f.ultimo.quien) || 'Cambiado'),
        clase: 'whitespace-nowrap', pinta: (v, f) => cambiado(f) },
      { titulo: 'Por defecto', soloExcel: true, valor: f => f.textoDefecto },
      { titulo: 'Clave', soloExcel: true, valor: f => f.clave },
    ],

    detalle: {
      origen: clave => `${URL}/api/ficha/${encodeURIComponent(clave)}`,
      titulo: d => d.etiqueta,
      subtitulo: d => [d.modulo, d.enUso ? 'En uso' : (d.item ? `Lo usará el ítem ${d.item}` : 'Aún sin usar')].join(' · '),
      acciones: [
        { texto: 'Cambiar', icono: 'fa-pen', principal: true, onClick: d => cambiar(d) },
      ],
      bloques: [
        {
          titulo: 'El parámetro', icono: 'fa-sliders',
          campos: [
            { etiqueta: 'Vale hoy', html: true, valor: d => `<span class="text-xl font-bold tabular-nums">${esc(d.texto)}</span>` },
            { etiqueta: 'Por defecto', valor: d => d.textoDefecto },
            { etiqueta: 'Uso', html: true, valor: d => (d.enUso
              ? `${etiqueta('En uso', 'green')} <span class="text-sm">${esc(d.usa)}</span>`
              : `${estado(d)} <span class="text-sm text-telecab-muted">Cambiarlo aún no cambia nada: lo usará ${d.item ? 'el ítem ' + esc(d.item) + ' de la hoja de ruta' : 'el módulo que lo necesite'}.</span>`) },
            { etiqueta: 'Qué es', valor: d => d.descripcion, ancho: 'sm:col-span-2 lg:col-span-3' },
            { etiqueta: 'Clave', valor: d => d.clave },
          ],
        },
        {
          titulo: 'Historia', icono: 'fa-clock-rotate-left',
          tabla: {
            datos: d => d.historial,
            vacio: 'Nadie lo ha cambiado: vale lo de la hoja de ruta.',
            columnas: [
              { titulo: 'Desde', campo: 'desde', clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(fechaHora(v)) },
              { titulo: 'Valor', campo: 'texto', clase: 'tabular-nums', pinta: v => `<span class="font-semibold">${esc(v)}</span>` },
              { titulo: 'Quién', campo: 'quien', clase: 'whitespace-nowrap', pinta: v => esc(v || '') },
              { titulo: 'Por qué', campo: 'motivo', pinta: v => esc(v) },
            ],
          },
        },
      ],
    },
  });

  // ── Cambiar ─────────────────────────────────────────────────────────────
  const MOTIVO = { id: 'motivo', etiqueta: 'Por qué se cambia', tipo: 'texto-largo', obligatorio: true, max: 500,
    marcador: 'Ej.: lo pide la asesoría; cambia el horario en verano', ayuda: 'Queda en la historia del parámetro, con tu nombre.' };

  function camposDe(d) {
    if (d.tipo === 'horario') {
      return [
        { id: 'dias', etiqueta: 'Días de oficina', tipo: 'lista', multiple: true, obligatorio: true,
          valor: (d.valor.dias || []).map(String),
          opciones: DIAS.map((n, i) => ({ valor: String(i + 1), texto: n.charAt(0).toUpperCase() + n.slice(1) })) },
        { id: 'desde', etiqueta: 'Abre a las', tipo: 'texto', obligatorio: true, max: 5, valor: d.valor.desde, marcador: '09:00' },
        { id: 'hasta', etiqueta: 'Cierra a las', tipo: 'texto', obligatorio: true, max: 5, valor: d.valor.hasta, marcador: '18:00' },
        MOTIVO,
      ];
    }
    const limites = d.min != null && d.max != null ? `Entre ${d.min} y ${d.max}.` : '';
    if (d.tipo === 'texto') {
      return [{ id: 'valor', etiqueta: 'Texto', tipo: 'texto-largo', obligatorio: true, max: 400, valor: d.valor }, MOTIVO];
    }
    const unidad = d.tipo === 'importe' ? 'euros' : String(d.textoDefecto || '').replace(/^[\d.,]+\s*/, '').replace(/^el día \d+ /, 'día ');
    return [
      { id: 'valor', etiqueta: `Valor${unidad ? ' (' + unidad + ')' : ''}`, tipo: 'texto', obligatorio: true, max: 10,
        valor: d.tipo === 'importe' ? String(d.valor).replace('.', ',') : String(d.valor), ayuda: limites },
      MOTIVO,
    ];
  }

  async function cambiar(d) {
    const v = await Dialogo.formulario(`Cambiar · ${d.etiqueta}`, camposDe(d), {
      textoBoton: 'Cambiar desde ahora',
      nota: d.enUso
        ? `Hoy vale ${d.texto}. El cambio se nota desde ya en lo que nazca a partir de ahora.`
        : `Hoy vale ${d.texto}. Aún no lo usa nadie: se guardará para cuando se haga su ítem.`,
    });
    if (!v) return;
    const valor = d.tipo === 'horario'
      ? { dias: (v.dias || []).map(Number), desde: String(v.desde || '').trim(), hasta: String(v.hasta || '').trim() }
      : v.valor;
    try {
      await Api.post(`${URL}/api/cambiar/${encodeURIComponent(d.clave)}`, { valor, motivo: v.motivo });
      Dialogo.hecho('Parámetro cambiado');
      await lst.recargar();
      await lst.abrir(d.clave, { historial: false });
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se ha cambiado', texto: e.message, tono: 'error' });
    }
  }
})();
