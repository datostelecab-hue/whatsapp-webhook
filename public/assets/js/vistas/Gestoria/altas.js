// modules/Gestoria/vistas/gestoria.ejs — la pestaña «Altas» (módulo 8, db/304, 26/11/2026).
//
// El alta ante la gestoría de cada contrato nuevo de plantilla propia: se pide,
// la gestoría la confirma (con su justificante) y, hasta entonces, la persona no
// puede vincular coche. Si no se presenta a su primer turno, el contador de días
// cotizados y su coste, hasta que se anula. Cada alta se abre en un panel (las
// otras pestañas usan la dirección para sus fichas).

(function () {
  const raiz = document.querySelector('#gs-altas');
  if (!raiz) return;
  const { esc, etiqueta } = Listado.fmt;
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const euros = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  let lista = null, PUEDE = !!Casa.datos().puedeGestionar, COSTE = 0;

  function montar() {
    lista = Listado.montar({
      raiz: '#gs-altas',
      titulo: 'Altas nuevas',
      icono: 'fa-id-card',
      clave: 'id',
      url: false,
      origen: '/gestoria/api/altas/lista',
      vacio: 'No hay altas nuevas de plantilla propia en los últimos cuatro meses.',
      filtrosIniciales: { abierta: 'si' },
      buscar: { texto: 'Buscar persona, DNI o código…', campos: ['nombre', 'dni', 'legajo'] },
      subtitulo: (v, t) => `${v.length} de ${t.length} altas`,
      kpis: (filas, extra) => {
        if (extra) { PUEDE = !!extra.puedeGestionar; COSTE = extra.costeDia || 0; }
        const de = c => filas.filter(f => f.situacion.codigo === c).length;
        const noPres = filas.filter(f => f.situacion.codigo === 'no_presentado');
        const coste = noPres.reduce((s, f) => s + (f.coste || 0), 0);
        return [
          { etiqueta: 'Sin pedir', valor: de('pendiente'), tono: 'warn', icono: 'fa-paper-plane', filtro: { id: 'como', valor: 'pendiente' },
            ayuda: 'Hay que pedírsela a la gestoría con al menos un día de antelación al primer turno.' },
          { etiqueta: 'Empiezan sin el alta', valor: de('urgente'), tono: de('urgente') ? 'red' : undefined, icono: 'fa-triangle-exclamation',
            filtro: { id: 'como', valor: 'urgente' }, ayuda: 'Su primer turno es mañana (o ya pasó) y el alta no está confirmada: no pueden vincular coche.' },
          { etiqueta: 'Pedidas, sin confirmar', valor: de('solicitada'), tono: 'gold', icono: 'fa-hourglass-half', filtro: { id: 'como', valor: 'solicitada' } },
          { etiqueta: 'No se presentaron', valor: noPres.length, tono: noPres.length ? 'red' : undefined, icono: 'fa-user-xmark',
            filtro: { id: 'como', valor: 'no_presentado' }, pie: coste ? `${euros(coste)} cotizados` : '',
            ayuda: 'Ni vincularon coche ni BOLT les vio conectados en su primer turno. Hay que pedir la anulación del alta el mismo día.' },
        ];
      },
      nota: (filas, extra) => [
        ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/304 en Migraciones.' }] : []),
        { icono: 'fa-circle-info', texto: `Cada contrato de plantilla propia desde el ${dmy((extra && extra.desde) || '2026-11-27')}. Sin el alta confirmada no puede vincular coche (ni por el bot ni por el portal); en el planificador sale en rojo. Si no se presenta a su primer turno, a las dos horas llega el aviso.` },
        ...(extra && !extra.sinTabla && !extra.costeDia ? [{ icono: 'fa-euro-sign', texto: 'Sin el coste diario de Seguridad Social (Parámetros) no se calcula lo cotizado.' }] : []),
      ],
      filtros: [
        { id: 'abierta', etiqueta: 'Por atender', textoTodos: 'Todas', opciones: [{ valor: 'si', texto: 'Solo por atender' }],
          campo: f => (['pendiente', 'solicitada', 'urgente', 'no_presentado'].includes(f.situacion.codigo) ? 'si' : 'no') },
        { id: 'como', etiqueta: 'Cómo va', textoTodos: 'Cualquiera', campo: f => f.situacion.codigo, opciones: [
          { valor: 'pendiente', texto: 'Sin pedir' }, { valor: 'urgente', texto: 'Empieza sin el alta' }, { valor: 'solicitada', texto: 'Pedida a la gestoría' },
          { valor: 'confirmada', texto: 'Confirmada' }, { valor: 'presentado', texto: 'Confirmada y presentado' },
          { valor: 'no_presentado', texto: 'No se presentó' }, { valor: 'anulada', texto: 'Anulada' },
        ] },
      ],
      alAbrir: f => abrir(f.id),
      columnas: [
        { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
          pinta: (v, f) => esc(v) + `<span class="block text-xs font-normal text-telecab-muted">${f.dni ? esc(f.dni) : 'Sin DNI'}${f.legajo ? ` · código ${esc(f.legajo)}` : ''}</span>` },
        { titulo: 'Alta', valor: f => f.fecha_alta, clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(dmy(v)) },
        { titulo: 'Primer turno', valor: f => f.primer_dia || '', clase: 'whitespace-nowrap tabular-nums',
          pinta: (v, f) => (v ? `${esc(dmy(v))}<span class="block text-xs text-telecab-muted">${esc(f.turno_texto)}</span>` : '<span class="text-xs text-telecab-muted">Sin turno en el planificador</span>') },
        { titulo: 'Cómo va', valor: f => f.situacion.etiqueta,
          pinta: (v, f) => etiqueta(v, f.situacion.tono) + (f.situacion.codigo === 'no_presentado'
            ? `<span class="block text-xs text-telecab-red mt-0.5 tabular-nums">${f.dias_cotizados} ${f.dias_cotizados === 1 ? 'día cotizado' : 'días cotizados'}${f.coste ? ` · ${esc(euros(f.coste))}` : ''}</span>` : '') },
        { titulo: 'Carta de incorporación', valor: f => f.firma_texto, clase: 'text-xs' },
      ],
    });
  }

  // ── El alta, en el panel ──
  async function abrir(id) {
    let d;
    try { d = (await Api.get(`/gestoria/api/altas/${encodeURIComponent(id)}`)).ficha; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo abrir', texto: e.message, tono: 'error' }); }
    const fila = (t, v) => `<dt class="text-telecab-muted">${esc(t)}</dt><dd>${v}</dd>`;
    const quien = (cuando, por) => (cuando ? `${esc(cuando)}${por ? ` · ${esc(por)}` : ''}` : '—');
    const botones = !PUEDE ? '' : [
      d.estado === 'pendiente' ? '<button data-accion="solicitar" class="tc-boton tc-boton--principal tc-boton--chico">Alta pedida</button>' : '',
      ['pendiente', 'solicitada'].includes(d.estado) ? `<button data-accion="confirmar" class="tc-boton ${d.estado === 'solicitada' ? 'tc-boton--principal ' : ''}tc-boton--chico">Alta confirmada</button>` : '',
      d.estado !== 'anulada' ? '<button data-accion="anular" class="tc-boton tc-boton--chico">Anular</button>' : '',
      d.estado !== 'pendiente' ? '<button data-accion="reabrir" class="tc-boton tc-boton--chico">Deshacer</button>' : '',
    ].join('');
    const contador = d.situacion.codigo === 'no_presentado' || (d.no_presentado_hay && d.estado === 'anulada')
      ? `<div class="rounded-lg border border-telecab-red/40 bg-telecab-red/10 p-3 mb-4">
          <p class="text-sm font-semibold text-telecab-red">No se presentó a su primer turno</p>
          <p class="text-sm mt-1 tabular-nums">${d.dias_cotizados} ${d.dias_cotizados === 1 ? 'día cotizado' : 'días cotizados'}${d.coste ? ` · ${esc(euros(d.coste))}` : ''}${d.dias_cotizados >= 2 && d.estado !== 'anulada' ? ' · avisado a Dirección' : ''}</p>
          ${d.estado !== 'anulada' ? '<p class="text-xs text-telecab-muted mt-1">Pide hoy a la gestoría la anulación del alta (o la baja) y márcala anulada: cada día cotiza.</p>' : ''}
        </div>` : '';
    const panel = Panel.abrir({ titulo: d.nombre, subtitulo: `Alta del ${dmy(d.fecha_alta)}${d.de_alta ? '' : ` · contrato cerrado el ${dmy(d.baja)}`}`, html: `
      <p class="mb-3">${etiqueta(d.situacion.etiqueta, d.situacion.tono)}</p>
      ${contador}
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
        ${fila('Persona', `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">${esc(d.nombre)}</a>`)}
        ${fila('DNI', esc(d.dni || 'Sin DNI'))}
        ${fila('Código de la gestoría', esc(d.legajo || 'Sin código'))}
        ${fila('Primer turno', d.primer_dia ? `${esc(dmy(d.primer_dia))} ${esc(d.turno_texto)}` : 'Sin turno en el planificador')}
        ${fila('Pedida', quien(d.solicitada, d.solicitada_por_nombre))}
        ${fila('Confirmada', quien(d.confirmada, d.confirmada_por_nombre))}
        ${d.anulada ? fila('Anulada', quien(d.anulada, d.anulada_por_nombre)) : ''}
        ${d.presentado ? fila('Se presentó', esc(d.presentado)) : ''}
        ${fila('Carta de incorporación', d.firma_id ? `<a class="underline" href="/firmas#${encodeURIComponent(d.firma_id)}">${esc(d.firma_texto)}</a>` : esc(d.firma_texto))}
        ${d.nota ? `<dt class="text-telecab-muted col-span-2">Nota</dt><dd class="col-span-2">${esc(d.nota)}</dd>` : ''}
      </dl>
      ${botones ? `<div class="flex flex-wrap gap-2 mb-4">${botones}</div>` : ''}
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">Justificante de la gestoría</h3>
      <div data-adjuntos></div>` });
    Adjuntos.montar(panel.cuerpo.querySelector('[data-adjuntos]'), { tipo: 'alta_gestoria', dueno: d.id, titulo: 'Justificante', puedeAdjuntar: PUEDE, puedeQuitar: PUEDE });
    panel.cuerpo.querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', () => accion(b.dataset.accion, d, panel)));
  }

  const ACCIONES = {
    solicitar: { titulo: 'Alta pedida a la gestoría', boton: 'Marcar pedida', hecho: 'Alta marcada como pedida',
      campos: [{ id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo' }] },
    confirmar: { titulo: 'Alta confirmada por la gestoría', boton: 'Marcar confirmada', hecho: 'Alta confirmada: ya puede vincular coche',
      nota: 'Antes, adjunta abajo el justificante que manda la gestoría. Desde ese momento puede vincular coche.',
      campos: [{ id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo' }] },
    anular: { titulo: 'Anular el alta', boton: 'Anular', hecho: 'Alta anulada',
      campos: [{ id: 'nota', etiqueta: 'Por qué (por ejemplo, «no se presentó: pedida la anulación el …»)', tipo: 'texto-largo', obligatorio: true, minimo: 3 }] },
    reabrir: { titulo: 'Deshacer', boton: 'Volver a «sin pedir»', hecho: 'Vuelve a estar sin pedir',
      campos: [{ id: 'nota', etiqueta: 'Por qué se deshace', tipo: 'texto-largo', obligatorio: true, minimo: 3 }] },
  };

  async function accion(que, d, panel) {
    const a = ACCIONES[que];
    const v = await Dialogo.formulario(a.titulo, a.campos, { textoBoton: a.boton, nota: a.nota });
    if (!v) return;
    const r = await Api.post(`/gestoria/api/altas/${encodeURIComponent(d.id)}/${que}`, v, { aviso: 'No se ha podido', bloquea: true });
    if (!r) return;
    Dialogo.hecho(a.hecho);
    panel.cerrar();
    if (lista) await lista.recargar();
    abrir(d.id);
  }

  window.GestoriaAltas = { abrir: () => { if (!lista) montar(); } };
  // Si la pantalla se abrió ya en esta pestaña (las pestañas se montan antes que este fichero).
  if (new URLSearchParams(location.search).get('vista') === 'altas') window.GestoriaAltas.abrir();

  // Desde una tarjeta o un aviso: /gestoria?vista=altas&alta=ID abre esa alta.
  const pedida = new URLSearchParams(location.search).get('alta');
  if (pedida) abrir(pedida);
})();
