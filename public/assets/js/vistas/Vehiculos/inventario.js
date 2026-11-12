// modules/Vehiculos/vistas/inventario.ejs — el inventario del taller (db/241).
//
// Camilo, 12/11/2026: «un módulo de "Inventario" para las cosas que no tengan
// matrícula, como los de HERGAR […] que se pueda sumar cosas al inventario y
// restar también si las usamos y apuntar en qué matrícula fue y qué fecha».
//
// El stock de cada artículo es la suma de sus movimientos. Restar es ponerlo en
// un coche: se elige la matrícula y la fecha, y la pieza sale además en la ficha
// de ese coche, entre sus mantenimientos. Lo que no es ponerlo en un coche
// (recuento, rotura, devolución) es un ajuste, con su motivo.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const PUEDE = DEL_SERVIDOR.puedeMover;
  const CATS = DEL_SERVIDOR.categorias || [];
  const { fecha, euros, esc, etiqueta } = Listado.fmt;
  const cant = v => (v == null ? '' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 }));
  const hoy = () => new Date().toLocaleDateString('es-ES',
    { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' });
  const etiquetaCat = c => (CATS.find(x => x.codigo === c) || {}).etiqueta || c || '';

  async function post(url, cuerpo) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
    const j = await r.json().catch(() => ({ status: 'error', msg: 'Respuesta ilegible' }));
    if (!r.ok || j.status !== 'ok') throw new Error(j.msg || 'No se pudo guardar');
    return j;
  }

  let COCHES = null;
  async function coches() {
    if (COCHES) return COCHES;
    const r = await fetch('/inventario/api/coches');
    const j = await r.json();
    if (j.status !== 'ok') throw new Error(j.msg || 'No se pudieron cargar los coches');
    COCHES = j.coches;
    return COCHES;
  }

  const lst = Listado.montar({
    raiz: '#modulo',
    titulo: 'Inventario',
    icono: 'fa-boxes-stacked',
    clave: 'id',
    origen: '/inventario/api/lista',
    vacio: 'No hay artículos que coincidan.',
    buscar: { texto: 'Artículo o referencia…', campos: ['descripcion', 'codigo', f => etiquetaCat(f.categoria)] },
    subtitulo: (visibles, todas) => (visibles.length === todas.length
      ? `${todas.length} artículos`
      : `${visibles.length} de ${todas.length} artículos`),

    kpis: filas => {
      const con = filas.filter(f => f.stock > 0);
      const valor = filas.reduce((a, f) => a + (f.valor > 0 ? f.valor : 0), 0);
      return [
        { etiqueta: 'Con stock', valor: con.length, tono: 'gold', pie: `de ${filas.length} artículos`,
          filtro: { id: 'stock', valor: 'con' } },
        { etiqueta: 'Unidades', valor: cant(con.reduce((a, f) => a + f.stock, 0)), pie: 'en el almacén' },
        { etiqueta: 'Valor del stock', valor: euros(valor), pie: 'al último precio · sin IVA',
          ayuda: 'Lo que hay en el almacén por lo que costó la última vez, sin IVA' },
        { etiqueta: 'Agotados', valor: filas.filter(f => f.stock <= 0).length, tono: 'warn',
          pie: 'entraron y ya no queda', filtro: { id: 'stock', valor: 'sin' } },
      ];
    },

    filtros: [
      {
        id: 'stock', etiqueta: 'Stock', textoTodos: 'Todos',
        opciones: filas => [
          { valor: 'con', texto: 'Con stock', cuenta: filas.filter(f => f.stock > 0).length },
          { valor: 'sin', texto: 'Agotados', cuenta: filas.filter(f => f.stock <= 0).length },
        ],
        pasa: (f, v) => (v === 'con' ? f.stock > 0 : f.stock <= 0),
      },
      {
        id: 'categoria', campo: 'categoria', etiqueta: 'Categoría', textoTodos: 'Todas',
        opciones: filas => CATS.map(c => ({ valor: c.codigo, texto: c.etiqueta,
          cuenta: filas.filter(f => f.categoria === c.codigo).length })).filter(o => o.cuenta > 0),
      },
    ],

    acciones: PUEDE ? [
      { texto: 'Nuevo artículo', icono: 'fa-plus', onClick: () => editar(null) },
    ] : [],

    columnas: [
      { titulo: 'Artículo', campo: 'descripcion',
        pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>` +
          (f.codigo ? `<span class="block text-[11px] text-telecab-muted">${esc(f.codigo)}</span>` : '') },
      { titulo: 'Categoría', campo: 'categoria', clase: 'whitespace-nowrap', pinta: v => esc(etiquetaCat(v)) },
      { titulo: 'Stock', campo: 'stock', clase: 'whitespace-nowrap tabular-nums text-right',
        pinta: (v, f) => (v > 0
          ? `<span class="font-semibold">${cant(v)}</span> <span class="text-telecab-muted text-xs">${esc(f.unidad)}</span>`
          : etiqueta('Agotado', 'warn')) },
      { titulo: 'Precio', campo: 'precio', clase: 'whitespace-nowrap tabular-nums text-right',
        ayuda: 'El de la última entrada, sin IVA y con el descuento', pinta: v => (v == null ? '' : euros(v)) },
      { titulo: 'Valor', campo: 'valor', clase: 'whitespace-nowrap tabular-nums text-right',
        pinta: v => (v ? euros(v) : '') },
      { titulo: 'Último movimiento', campo: 'ultimoMovimiento', clase: 'whitespace-nowrap tabular-nums',
        pinta: v => (v ? fecha(v) : '') },
      { titulo: 'Entradas', soloExcel: true, valor: f => f.entradas },
      { titulo: 'Puestas en coches', soloExcel: true, valor: f => f.salidas },
    ],

    detalle: {
      origen: id => `/inventario/api/ficha/${id}`,
      titulo: d => d.descripcion,
      subtitulo: d => [d.codigo, etiquetaCat(d.categoria), d.proveedor].filter(Boolean).join(' · '),
      acciones: [
        { texto: 'Restar: puesta en un coche', icono: 'fa-car-side', principal: true,
          visible: () => PUEDE, activa: d => d.stock > 0,
          ayuda: d => (d.stock > 0 ? 'Apuntar en qué coche se puso y qué día. Sale también en la ficha del coche.' : 'No queda: no se puede poner en ningún coche'),
          onClick: d => salida(d) },
        { texto: 'Sumar', icono: 'fa-plus', visible: () => PUEDE, onClick: d => entrada(d) },
        { texto: 'Ajustar', icono: 'fa-scale-balanced', visible: () => PUEDE, onClick: d => ajuste(d) },
        { texto: 'Editar', icono: 'fa-pen', visible: () => PUEDE, onClick: d => editar(d) },
      ],
      bloques: [
        {
          titulo: 'El artículo', icono: 'fa-box',
          campos: [
            { etiqueta: 'Stock', html: true, valor: d => (d.stock > 0
              ? `<span class="text-2xl font-bold tabular-nums">${cant(d.stock)}</span> <span class="text-telecab-muted">${esc(d.unidad)}</span>`
              : etiqueta('Agotado', 'warn')) },
            { etiqueta: 'Último precio', valor: d => (d.precio == null ? 'Sin precio' : euros(d.precio) + ' sin IVA') },
            { etiqueta: 'Valor del stock', valor: d => (d.valor ? euros(d.valor) : '') },
            { etiqueta: 'Han entrado', valor: d => cant(d.entradas) },
            { etiqueta: 'Puestas en coches', valor: d => cant(d.salidas) },
            { etiqueta: 'Proveedor', valor: d => d.proveedor },
            { etiqueta: 'Notas', valor: d => d.notas, ancho: 'sm:col-span-2 lg:col-span-3' },
          ],
        },
        {
          titulo: 'Movimientos', icono: 'fa-clock-rotate-left',
          tabla: {
            datos: d => d.movimientos,
            vacio: 'Sin movimientos.',
            columnas: [
              { titulo: 'Fecha', campo: 'fecha', clase: 'whitespace-nowrap tabular-nums',
                pinta: (v, f) => `<span class="${f.anuladoAt ? 'line-through text-telecab-muted' : ''}">${fecha(v)}</span>` },
              { titulo: 'Qué', campo: 'tipoEtiqueta', clase: 'whitespace-nowrap',
                pinta: (v, f) => (f.anuladoAt ? etiqueta('Anulado', 'muted') + ' ' : '') + esc(v) },
              { titulo: 'Cantidad', campo: 'cantidad', clase: 'whitespace-nowrap tabular-nums text-right',
                pinta: (v, f) => `<span class="font-semibold ${f.anuladoAt ? 'line-through text-telecab-muted' : (v < 0 ? 'text-telecab-red' : 'text-telecab-green')}">${v > 0 ? '+' : ''}${cant(v)}</span>` },
              { titulo: 'Coche', campo: 'matricula', clase: 'whitespace-nowrap',
                pinta: (v, f) => (v ? `<a class="font-semibold underline underline-offset-2 hover:text-telecab-gold" href="/vehiculos#${encodeURIComponent(f.vehiculoId)}">${esc(v)}</a>` : '') },
              { titulo: 'De dónde', campo: 'facturaNumero', clase: 'text-xs',
                pinta: (v, f) => [
                  v ? `<a class="underline underline-offset-2 hover:text-telecab-gold" href="/facturas#${encodeURIComponent(f.facturaId)}">Factura ${esc(v)}</a>` : '',
                  f.albaran ? 'alb. ' + esc(f.albaran) : '', f.destino ? esc(f.destino) : '',
                  f.notas ? `<span class="text-telecab-muted">${esc(f.notas)}</span>` : '',
                  f.anuladoAt ? `<span class="text-telecab-red">Anulado${f.anuladoPor ? ' por ' + esc(f.anuladoPor) : ''}: ${esc(f.anuladoMotivo || '')}</span>` : '',
                ].filter(Boolean).join(' · ') },
              { titulo: 'Quién', campo: 'usuario', clase: 'text-xs text-telecab-muted whitespace-nowrap',
                pinta: (v, f) => (v ? esc(v) : (f.facturaId ? 'factura' : '')) },
            ],
            acciones: PUEDE ? [
              { titulo: 'Anular', icono: 'fa-ban', visible: f => !f.anuladoAt, onClick: (f, d) => anular(f, d) },
            ] : [],
          },
        },
      ],
    },
  });

  // ── Lo que se mueve ─────────────────────────────────────────────────────
  async function guardarMov(d, cuerpo, hecho) {
    try {
      const r = await post('/inventario/api/movimiento', { articuloId: d.id, ...cuerpo });
      Dialogo.hecho(hecho(r));
      await lst.recargar();
      await lst.abrir(d.id, { historial: false });
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se ha guardado', texto: e.message, tono: 'error' });
    }
  }

  async function salida(d) {
    let lista;
    try { lista = await coches(); }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudieron cargar los coches', texto: e.message, tono: 'error' }); }
    const v = await Dialogo.formulario(`Poner en un coche · ${d.descripcion}`, [
      { id: 'coche', etiqueta: 'Coche', tipo: 'lista', obligatorio: true,
        opciones: lista.map(c => ({ valor: c.id, texto: c.matricula + (c.modelo ? ' · ' + c.modelo : '') })),
        buscador: { marcador: 'Matrícula…' } },
      { id: 'fecha', etiqueta: 'Día', tipo: 'fecha', obligatorio: true, valor: hoy() },
      { id: 'cantidad', etiqueta: `Cantidad (quedan ${cant(d.stock)})`, tipo: 'texto', obligatorio: true, valor: '1', max: 10 },
      { id: 'km', etiqueta: 'Km del coche', tipo: 'texto', max: 9, marcador: 'Opcional',
        ayuda: 'Los del cuadro, si se miraron. Sale en la ficha del coche.' },
      { id: 'notas', etiqueta: 'Nota', tipo: 'texto-largo', max: 300, marcador: 'Opcional' },
    ], { textoBoton: 'Restar y apuntar en el coche',
      nota: 'Sale del inventario y queda en la ficha del coche, entre sus mantenimientos.' });
    if (!v) return;
    await guardarMov(d, { tipo: 'salida', vehiculoId: v.coche, fecha: v.fecha, cantidad: v.cantidad, km: v.km, notas: v.notas },
      r => `Puesto en ${r.matricula}. Quedan ${cant(r.stock)}`);
  }

  async function entrada(d) {
    const v = await Dialogo.formulario(`Sumar · ${d.descripcion}`, [
      { id: 'cantidad', etiqueta: 'Cantidad que entra', tipo: 'texto', obligatorio: true, valor: '1', max: 10 },
      { id: 'fecha', etiqueta: 'Día', tipo: 'fecha', obligatorio: true, valor: hoy() },
      { id: 'precio', etiqueta: 'Precio por unidad, sin IVA', tipo: 'texto', max: 12,
        valor: d.precio == null ? '' : String(d.precio).replace('.', ','), marcador: 'Opcional' },
      { id: 'notas', etiqueta: 'Nota', tipo: 'texto-largo', max: 300, marcador: 'Ej.: compra en Hergar, albarán 123456' },
    ], { textoBoton: 'Sumar' });
    if (!v) return;
    await guardarMov(d, { tipo: 'entrada', cantidad: v.cantidad, fecha: v.fecha, precio: v.precio, notas: v.notas },
      r => `Sumado. Hay ${cant(r.stock)}`);
  }

  async function ajuste(d) {
    const v = await Dialogo.formulario(`Ajustar · ${d.descripcion}`, [
      { id: 'sentido', etiqueta: 'El stock', tipo: 'lista', obligatorio: true, valor: 'menos',
        opciones: [{ valor: 'menos', texto: 'Baja (rotura, pérdida, devolución…)' }, { valor: 'mas', texto: 'Sube (recuento)' }] },
      { id: 'cantidad', etiqueta: `Cuántas (hay ${cant(d.stock)})`, tipo: 'texto', obligatorio: true, max: 10 },
      { id: 'fecha', etiqueta: 'Día', tipo: 'fecha', obligatorio: true, valor: hoy() },
      { id: 'notas', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, max: 300,
        marcador: 'Ej.: recuento del 12/11, había 2 menos' },
    ], { textoBoton: 'Ajustar' });
    if (!v) return;
    const n = Math.abs(Number(String(v.cantidad).replace(',', '.')));
    if (!n) return Dialogo.aviso({ titulo: 'Falta la cantidad', texto: 'Pon cuántas suben o bajan.', tono: 'error' });
    await guardarMov(d, { tipo: 'ajuste', cantidad: v.sentido === 'menos' ? -n : n, fecha: v.fecha, notas: v.notas },
      r => `Ajustado. Hay ${cant(r.stock)}`);
  }

  async function editar(d) {
    const v = await Dialogo.formulario(d ? `Editar · ${d.descripcion}` : 'Nuevo artículo', [
      { id: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', obligatorio: true, valor: d ? d.descripcion : '', max: 300 },
      { id: 'codigo', etiqueta: 'Referencia', tipo: 'texto', valor: d ? d.codigo || '' : '', max: 48,
        marcador: 'La del proveedor, si la tiene' },
      { id: 'categoria', etiqueta: 'Categoría', tipo: 'lista', obligatorio: true, valor: d ? d.categoria : 'otro',
        opciones: CATS.map(c => ({ valor: c.codigo, texto: c.etiqueta })) },
      { id: 'unidad', etiqueta: 'Unidad', tipo: 'texto', valor: d ? d.unidad : 'ud', max: 8, marcador: 'ud, l, kg…' },
      { id: 'precio', etiqueta: 'Precio por unidad, sin IVA', tipo: 'texto', max: 12,
        valor: d && d.precio != null ? String(d.precio).replace('.', ',') : '', marcador: 'Opcional' },
      ...(d ? [] : [{ id: 'cantidad', etiqueta: 'Cantidad que entra ahora', tipo: 'texto', max: 10, marcador: 'Opcional' }]),
      { id: 'notas', etiqueta: 'Notas', tipo: 'texto-largo', valor: d ? d.notas || '' : '', max: 500 },
    ], { textoBoton: d ? 'Guardar' : 'Dar de alta', columnas: 2 });
    if (!v) return;
    try {
      const r = await post(d ? `/inventario/api/articulo/${d.id}` : '/inventario/api/articulo', v);
      Dialogo.hecho(d ? 'Artículo guardado' : 'Artículo dado de alta');
      await lst.recargar();
      await lst.abrir(d ? d.id : r.id, { historial: !d });
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se ha guardado', texto: e.message, tono: 'error' });
    }
  }

  async function anular(f, d) {
    const v = await Dialogo.formulario(`Anular · ${f.tipoEtiqueta.toLowerCase()} del ${fecha(f.fecha)}`, [
      { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto', obligatorio: true, marcador: 'Ej.: era otro coche',
        ayuda: 'No se borra: queda anulado, con tu nombre y el motivo.' +
          (f.tipo === 'salida' ? ' Se quita también de la ficha del coche y la pieza vuelve al inventario.' : '') },
    ], { textoBoton: 'Anular' });
    if (!v) return;
    try {
      const r = await post(`/inventario/api/movimiento/${f.id}/anular`, { motivo: v.motivo });
      Dialogo.hecho(`Anulado. Hay ${cant(r.stock)}`);
      await lst.recargar();
      await lst.abrir(d.id, { historial: false });
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se pudo anular', texto: e.message, tono: 'error' });
    }
  }
})();
