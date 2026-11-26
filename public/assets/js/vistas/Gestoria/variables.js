// modules/Gestoria/vistas/gestoria.ejs — la pestaña «Variables» (módulo 4, db/300, 26/11/2026).
//
// Lo que se escribe en el lienzo de A3 de cada mes de nómina: una línea por
// persona y concepto, con su origen (la variable del mes, los descuentos o a
// mano). «Preparar desde el ERP» rehace las del ERP; las de a mano llevan
// motivo. El Excel sale con la forma del lienzo. «Conceptos» es el catálogo.

(function () {
  const raiz = document.querySelector('#gs-variables');
  if (!raiz) return;
  const { esc, etiqueta } = Listado.fmt;
  const euros = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  let lista = null, ORIGENES = {}, MESES = [], CONCEPTOS = [];
  const PUEDE = !!Casa.datos().puedeGestionar;

  // El mes de nómina en curso: hasta el 25, el suyo; después, el siguiente.
  const hoy = new Date();
  const enCurso = (() => {
    let y = hoy.getFullYear(), m = hoy.getMonth() + 1;
    if (hoy.getDate() > 25) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return `${y}-${String(m).padStart(2, '0')}`;
  })();
  const origen = f => ORIGENES[f.origen] || { etiqueta: f.origen, tono: 'muted' };
  const firmado = f => (f.tipo === 'deduccion' ? -1 : 1) * f.importe;

  function montar() {
    lista = Listado.montar({
      raiz: '#gs-variables',
      titulo: 'Variables para A3',
      icono: 'fa-table-list',
      clave: 'id',
      origen: '/gestoria/api/variables/lista',
      vacio: 'No hay líneas en este mes. «Preparar desde el ERP» las saca de la variable del mes y de los descuentos.',
      filtrosIniciales: { periodo: enCurso },
      buscar: { texto: 'Buscar persona o código…', campos: ['nombre', 'legajo'] },
      subtitulo: (v, t) => `${v.length} ${v.length === 1 ? 'línea' : 'líneas'}`,
      kpisDeLoVisible: true,
      kpis: (filas, extra) => {
        if (extra && extra.origenes) ORIGENES = extra.origenes;
        if (extra && extra.meses) MESES = extra.meses;
        if (extra && extra.conceptos) CONCEPTOS = extra.conceptos;
        const suma = fn => filas.filter(fn).reduce((s, f) => s + f.importe, 0);
        const personas = new Set(filas.map(f => f.conductor_id));
        const sinCodigo = new Set(filas.filter(f => !f.legajo).map(f => f.conductor_id));
        return [
          { etiqueta: 'A pagar', valor: euros(suma(f => f.tipo === 'devengo')), tono: 'green', icono: 'fa-arrow-up',
            ayuda: 'Lo que suman los conceptos que se pagan (MBO, nocturnidad, propinas, peajes y lo de a mano).' },
          { etiqueta: 'A descontar', valor: euros(suma(f => f.tipo === 'deduccion')), tono: 'red', icono: 'fa-arrow-down',
            ayuda: 'Lo que suman los descuentos (efectivo, vehículo, franquicia…).' },
          { etiqueta: 'Personas', valor: personas.size, icono: 'fa-users' },
          { etiqueta: 'Sin código', valor: sinCodigo.size, tono: sinCodigo.size ? 'warn' : undefined, icono: 'fa-id-badge',
            ayuda: 'Sin código de la gestoría (legajo), A3 no puede importarlos.\nSe le pone en su ficha de Plantilla.' },
        ];
      },
      nota: (filas, extra) => [
        ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/300 en Migraciones.' }] : []),
        { icono: 'fa-circle-info', texto: 'Lo de la variable del mes y los descuentos sale del ERP con «Preparar desde el ERP», que lo rehace entero; lo de a mano se queda. Cuando en «Cierre del mes» se marcan enviadas, el mes ya no cambia.' },
      ],
      filtros: [
        { id: 'periodo', etiqueta: 'Mes', campo: 'periodo', textoTodos: 'Cualquier mes',
          opciones: () => MESES.map(m => ({ valor: m.periodo, texto: m.mes })) },
        { id: 'origen', etiqueta: 'De dónde sale', campo: 'origen', textoTodos: 'Cualquier origen',
          opciones: () => Object.entries(ORIGENES).map(([valor, o]) => ({ valor, texto: o.etiqueta })) },
        { id: 'concepto', etiqueta: 'Concepto', campo: 'concepto', textoTodos: 'Cualquier concepto',
          opciones: () => CONCEPTOS.map(c => ({ valor: c.codigo, texto: `${c.codigo} ${c.nombre}` })) },
      ],
      acciones: [
        ...(PUEDE ? [
          { texto: 'Preparar desde el ERP', icono: 'fa-wand-magic-sparkles', onClick: lst => preparar(lst) },
          { texto: 'Línea a mano', icono: 'fa-plus', principal: false, onClick: lst => apuntar(lst) },
        ] : []),
        { texto: 'Excel para A3', icono: 'fa-file-excel', principal: false, onClick: lst => excel(lst) },
        { texto: 'Conceptos', icono: 'fa-list-ol', principal: false, onClick: () => conceptos() },
      ],
      columnas: [
        { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
          pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Código ${esc(f.legajo)}</span>`
            : '<span class="block text-xs font-normal text-telecab-warn">Sin código</span>') },
        { titulo: 'Concepto', valor: f => `${f.concepto} ${f.concepto_nombre}` },
        { titulo: 'Importe', valor: f => firmado(f), clase: 'text-right tabular-nums whitespace-nowrap',
          pinta: (v, f) => `<span class="${f.tipo === 'deduccion' ? 'text-telecab-red' : ''}">${esc(euros(v))}</span>` },
        { titulo: 'De dónde sale', valor: f => origen(f).etiqueta,
          pinta: (v, f) => etiqueta(v, origen(f).tono) + `<span class="block text-xs text-telecab-muted mt-0.5">${esc(f.motivo || f.detalle || '')}</span>` },
        { titulo: 'Mes', campo: 'mes', clase: 'text-xs whitespace-nowrap' },
      ],
      detalle: {
        origen: id => `/gestoria/api/variables/linea/${encodeURIComponent(id)}`,
        titulo: d => `${d.concepto} ${d.concepto_nombre}`,
        subtitulo: d => `${d.nombre} · ${d.mes}`,
        acciones: [
          { texto: 'Anular', icono: 'fa-ban', visible: d => PUEDE && d.origen === 'manual', onClick: (d, l) => anular(d, l) },
        ],
        bloques: [
          { titulo: 'La línea', icono: 'fa-table-list', campos: [
            { etiqueta: 'Persona', html: true, valor: d => `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">${esc(d.nombre)}</a>` },
            { etiqueta: 'Código de la gestoría', valor: d => d.legajo || 'Sin código' },
            { etiqueta: 'Concepto de A3', valor: d => `${d.concepto} ${d.concepto_nombre} (${d.tipo === 'deduccion' ? 'se descuenta' : 'se paga'})` },
            { etiqueta: 'Importe', valor: d => euros(d.importe) },
            { etiqueta: 'De dónde sale', html: true, valor: d => etiqueta(origen(d).etiqueta, origen(d).tono) },
            { etiqueta: 'Detalle', visible: d => !!d.detalle, valor: d => d.detalle },
            { etiqueta: 'Motivo', visible: d => !!d.motivo, valor: d => d.motivo, ancho: 'sm:col-span-2' },
            { etiqueta: 'Mes de nómina', valor: d => d.mes },
            { etiqueta: 'Apuntada', valor: d => `${d.creado}${d.creado_por_nombre ? ` · ${d.creado_por_nombre}` : ''}` },
          ] },
        ],
      },
    });
  }

  const mesElegido = lst => (lst && lst.filtros && lst.filtros.periodo) || enCurso;
  const nombreMes = p => (MESES.find(m => m.periodo === p) || { mes: p }).mes;

  async function elegirMes(lst, titulo) {
    const v = await Dialogo.formulario(titulo, [
      { id: 'periodo', etiqueta: 'Mes de nómina', tipo: 'lista', obligatorio: true, valor: mesElegido(lst),
        opciones: MESES.map(m => ({ valor: m.periodo, texto: m.mes })) },
    ], { textoBoton: 'Seguir' });
    return v && v.periodo;
  }

  async function preparar(lst) {
    const periodo = await elegirMes(lst, 'Preparar desde el ERP');
    if (!periodo) return;
    if (!await Dialogo.confirmar({ titulo: `Preparar las variables de ${nombreMes(periodo)}`,
      texto: 'Se rehacen las líneas que salen del ERP: la variable del mes (MBO, nocturnidad, propinas y peajes, solo plantilla propia) y los descuentos aprobados. Las de a mano no se tocan.',
      si: 'Preparar', no: 'Cancelar' })) return;
    const r = await Api.post('/gestoria/api/variables/preparar', { periodo }, { aviso: 'No se han podido preparar', bloquea: true });
    if (!r) return;
    await Dialogo.aviso({ titulo: `Variables de ${r.mes}`, tono: r.avisos.length ? 'aviso' : 'info',
      html: `<p class="text-sm"><b>${r.lineas}</b> líneas de <b>${r.personas}</b> personas: variable ${esc(euros(r.variable))}, descuentos ${esc(euros(r.descuentos))}.</p>` +
        `<p class="text-xs text-telecab-muted mt-1">${r.congelada ? 'La variable es la congelada en Nóminas.' : 'La variable es la calculada ahora: en Nóminas no está congelada.'}</p>` +
        (r.avisos.length ? `<ul class="text-sm mt-2 list-disc pl-5">${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '') });
    lst.filtros.periodo = periodo;
    await lst.recargar();
  }

  async function apuntar(lst) {
    const p = await Api.get('/gestoria/api/variables/personas').catch(e => { Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); return null; });
    if (!p) return;
    const v = await Dialogo.formulario('Línea a mano', [
      { id: 'periodo', etiqueta: 'Mes de nómina', tipo: 'lista', obligatorio: true, valor: mesElegido(lst), opciones: MESES.map(m => ({ valor: m.periodo, texto: m.mes })) },
      { id: 'conductorId', etiqueta: 'Persona', tipo: 'lista', obligatorio: true,
        opciones: p.personas.map(x => ({ valor: x.id, texto: x.nombre + (x.legajo ? ` · ${x.legajo}` : ' · sin código') })) },
      { id: 'concepto', etiqueta: 'Concepto de A3', tipo: 'lista', obligatorio: true,
        opciones: CONCEPTOS.filter(c => c.activo).map(c => ({ valor: c.codigo, texto: `${c.codigo} ${c.nombre}` })) },
      { id: 'importe', etiqueta: 'Importe (€)', obligatorio: true, marcador: 'p. ej. 150,00',
        ayuda: 'En positivo: el concepto ya dice si se paga o se descuenta. Una regularización a la baja va en negativo.' },
      { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', obligatorio: true, minimo: 3 },
    ], { textoBoton: 'Apuntar', nota: 'Queda con tu nombre. Preparar desde el ERP no la toca.' });
    if (!v) return;
    const r = await Api.post('/gestoria/api/variables/linea', v, { aviso: 'No se ha podido apuntar' });
    if (!r) return;
    Dialogo.hecho('Apuntada');
    lst.filtros.periodo = v.periodo;
    await lst.recargar();
  }

  async function anular(d, l) {
    const v = await Dialogo.formulario('Anular la línea', [{ id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', obligatorio: true, minimo: 3 }],
      { textoBoton: 'Anular', nota: `${d.concepto} ${d.concepto_nombre} · ${euros(d.importe)} · ${d.nombre}` });
    if (!v) return;
    const r = await Api.post(`/gestoria/api/variables/linea/${encodeURIComponent(d.id)}/anular`, v, { aviso: 'No se ha podido anular' });
    if (!r) return;
    Dialogo.hecho('Anulada');
    if (l && l.volver) l.volver();
    await (l || lista).recargar();
  }

  async function excel(lst) {
    const periodo = await elegirMes(lst, 'Excel para A3');
    if (periodo) location.href = `/gestoria/api/variables/excel/${encodeURIComponent(periodo)}`;
  }

  // ── El catálogo ──
  async function conceptos() {
    const r = await Api.get('/gestoria/api/variables/conceptos').catch(e => { Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); return null; });
    if (!r) return;
    const origenTxt = o => (r.origenes[o] || { etiqueta: o }).etiqueta;
    const html = `
      <p class="text-sm text-telecab-muted mb-3">Los conceptos del lienzo de A3. La cabecera es el texto exacto de su columna en el lienzo.</p>
      <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-telecab-muted"><th class="py-1 pr-3">Código</th><th class="pr-3">Nombre</th><th class="pr-3">De dónde sale</th><th class="pr-3">Tipo</th><th></th></tr></thead>
        <tbody>${r.conceptos.map(c => `
          <tr class="border-t border-telecab-border ${c.activo ? '' : 'opacity-50'}">
            <td class="py-1.5 pr-3 tabular-nums">${esc(c.codigo)}</td>
            <td class="pr-3">${esc(c.nombre)}<span class="block text-xs text-telecab-muted">${esc(c.cabecera)}</span></td>
            <td class="pr-3 text-xs">${esc(origenTxt(c.origen))}</td>
            <td class="pr-3 text-xs">${c.tipo === 'deduccion' ? 'Se descuenta' : 'Se paga'}${c.activo ? '' : ' · desactivado'}</td>
            <td>${r.puedeGestionar ? `<button data-editar="${esc(c.codigo)}" class="tc-boton tc-boton--chico" aria-label="Cambiar el concepto ${esc(c.codigo)}">Cambiar</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>
      ${r.puedeGestionar ? '<div class="mt-3"><button data-nuevo class="tc-boton tc-boton--chico">Nuevo concepto</button></div>' : ''}`;
    const p = Panel.abrir({ titulo: 'Conceptos de A3', subtitulo: `${r.conceptos.length} conceptos`, html });
    p.cuerpo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => editar(r, r.conceptos.find(c => c.codigo === b.dataset.editar), p)));
    const n = p.cuerpo.querySelector('[data-nuevo]');
    if (n) n.addEventListener('click', () => editar(r, null, p));
  }

  async function editar(r, c, panel) {
    const nuevo = !c;
    const v = await Dialogo.formulario(nuevo ? 'Nuevo concepto' : `Concepto ${c.codigo}`, [
      ...(nuevo ? [{ id: 'codigo', etiqueta: 'Código de A3', obligatorio: true, marcador: 'p. ej. 066' }] : []),
      { id: 'nombre', etiqueta: 'Nombre', obligatorio: true, valor: c ? c.nombre : '' },
      { id: 'cabecera', etiqueta: 'Cabecera en el lienzo', valor: c ? c.cabecera : '', marcador: '066 - PACTO PR (I)',
        ayuda: 'El texto exacto de su columna en el lienzo de A3. Vacío, se arma con el código y el nombre.' },
      { id: 'tipo', etiqueta: 'Tipo', tipo: 'lista', obligatorio: true, valor: c ? c.tipo : 'devengo',
        opciones: [{ valor: 'devengo', texto: 'Se paga' }, { valor: 'deduccion', texto: 'Se descuenta' }] },
      { id: 'origen', etiqueta: 'De dónde sale', tipo: 'lista', obligatorio: true, valor: c ? c.origen : 'manual',
        opciones: Object.entries(r.origenes).map(([valor, o]) => ({ valor, texto: o.etiqueta })) },
      { id: 'orden', etiqueta: 'Orden (columna en el Excel)', valor: c ? String(c.orden) : '200' },
      { id: 'activo', etiqueta: 'Activo', tipo: 'lista', obligatorio: true, valor: c && !c.activo ? 'no' : 'si',
        opciones: [{ valor: 'si', texto: 'Sí' }, { valor: 'no', texto: 'No (no sale en el Excel ni en las líneas nuevas)' }] },
    ], { textoBoton: 'Guardar' });
    if (!v) return;
    const res = await Api.post('/gestoria/api/variables/conceptos', { ...v, codigo: nuevo ? v.codigo : c.codigo, nuevo, activo: v.activo === 'si' },
      { aviso: 'No se ha podido guardar' });
    if (!res) return;
    Dialogo.hecho('Guardado');
    panel.cerrar();
    conceptos();
    if (lista) lista.recargar();
  }

  let abierta = false;
  window.GestoriaVariables = { abrir() { if (!abierta) { abierta = true; montar(); } } };
  if (!raiz.classList.contains('hidden')) window.GestoriaVariables.abrir();
})();
