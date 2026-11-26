// modules/RRHH/vistas/ausencias.ejs — la pestaña «Bajas médicas» (módulo 1, db/303, 26/11/2026).
//
// Cada baja de la plantilla con sus partes: el de baja (la abre), las
// confirmaciones (cambian la fecha prevista), el alta (la cierra; vuelve al día
// siguiente) y las rectificaciones. A mano hasta que llegue el fichero del
// INSS. Cada baja se abre en un panel al lado (la lista de Ausencias ya usa la
// dirección para sus fichas). Monta también las dos pestañas de la pantalla.

(function () {
  const raiz = document.querySelector('#au-bajas');
  if (!raiz) return;
  const PUEDE = !!Casa.datos().puedeValidar;
  const { esc, etiqueta } = Listado.fmt;
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  let lista = null, CONT = {}, TIPOS = {}, RECIENTES = {};

  Pestanas.montar(document.querySelector('#au-pestanas'), {
    pestanas: [
      { id: 'ausencias', texto: 'Ausencias', icono: 'fa-user-clock' },
      { id: 'bajas', texto: 'Bajas médicas', icono: 'fa-notes-medical' },
    ],
    param: 'vista',
    alCambiar: id => {
      document.querySelector('#modulo').classList.toggle('hidden', id !== 'ausencias');
      raiz.classList.toggle('hidden', id !== 'bajas');
      if (id === 'bajas' && !lista) montar();
    },
  });

  function montar() {
    lista = Listado.montar({
      raiz: '#au-bajas',
      titulo: 'Bajas médicas',
      icono: 'fa-notes-medical',
      clave: 'id',
      url: false,
      origen: '/ausencias/api/baja-medica/lista',
      vacio: 'No hay bajas médicas abiertas ni cerradas en los dos últimos meses.',
      filtrosIniciales: { abierta: 'si' },
      buscar: { texto: 'Buscar persona o legajo…', campos: ['nombre', 'legajo'] },
      subtitulo: (v, t) => `${v.length} de ${t.length} bajas`,
      kpis: (filas, extra) => {
        if (extra && extra.contingencias) CONT = extra.contingencias;
        if (extra && extra.tipos) TIPOS = extra.tipos;
        if (extra && extra.recientes) RECIENTES = extra.recientes;
        const abiertas = filas.filter(f => !f.hasta);
        return [
          { etiqueta: 'De baja hoy', valor: abiertas.length, icono: 'fa-notes-medical', filtro: { id: 'abierta', valor: 'si' } },
          { etiqueta: 'Comprobar prórroga o alta', valor: abiertas.filter(f => ['revisar', 'vencida'].includes(f.estado.clave)).length,
            tono: 'warn', icono: 'fa-calendar-check', filtro: { id: 'estado', valor: 'revisar' },
            ayuda: 'El fin previsto está a dos días hábiles o ya pasó y no ha llegado ni la confirmación ni el alta.' },
          { etiqueta: 'Sin fecha prevista', valor: abiertas.filter(f => !f.prevista).length, tono: 'muted', icono: 'fa-calendar-xmark' },
          { etiqueta: 'Partes en 7 días', valor: Object.values(RECIENTES).reduce((s, n) => s + n, 0), icono: 'fa-file-medical',
            pie: ['baja', 'confirmacion', 'alta', 'rectificacion'].filter(k => RECIENTES[k]).map(k => `${RECIENTES[k]} ${{ baja: 'bajas', confirmacion: 'prórrogas', alta: 'altas', rectificacion: 'rectificaciones' }[k]}`).join(' · ') },
        ];
      },
      nota: (filas, extra) => [
        ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/303 en Migraciones.' }] : []),
        { icono: 'fa-circle-info', texto: 'Se llevan a mano hasta que llegue el fichero del INSS. Cada parte mueve la baja de su ficha: la de baja la abre, la confirmación cambia la fecha prevista y el alta la cierra (vuelve al día siguiente; se avisa a Planificación).' },
      ],
      filtros: [
        { id: 'abierta', etiqueta: 'Abiertas', textoTodos: 'Abiertas y cerradas', opciones: [{ valor: 'si', texto: 'Solo abiertas' }, { valor: 'no', texto: 'Solo con el alta' }],
          campo: f => (f.hasta ? 'no' : 'si') },
        { id: 'estado', etiqueta: 'Cómo va', textoTodos: 'Cualquiera',
          opciones: [{ valor: 'revisar', texto: 'Comprobar prórroga o alta' }, { valor: 'en_plazo', texto: 'En plazo' }, { valor: 'sin_prevista', texto: 'Sin fecha prevista' }, { valor: 'alta', texto: 'Con el alta' }],
          campo: f => (f.estado.clave === 'vencida' ? 'revisar' : f.estado.clave) },
      ],
      acciones: PUEDE ? [{ texto: 'Parte de baja', icono: 'fa-plus', onClick: () => nueva() }] : [],
      alAbrir: f => abrir(f.id),
      columnas: [
        { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
          pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Legajo ${esc(f.legajo)}</span>` : '') },
        { titulo: 'Desde', valor: f => f.desde, pinta: (v, f) => `${esc(dmy(v))}<span class="block text-xs text-telecab-muted">${f.dias} ${f.dias === 1 ? 'día' : 'días'}</span>`, clase: 'whitespace-nowrap' },
        { titulo: 'Cómo va', valor: f => f.estado.etiqueta, pinta: (v, f) => etiqueta(v, f.estado.tono) },
        { titulo: 'Contingencia', valor: f => (CONT[f.contingencia] || '—'), clase: 'text-xs' },
        { titulo: 'Último parte', valor: f => (f.ultimo ? `${TIPOS[f.ultimo.tipo] || f.ultimo.tipo} · ${dmy(f.ultimo.fecha)}` : 'Sin partes (puesta antes)'), clase: 'text-xs' },
      ],
    });
  }

  // ── La baja, en el panel ──
  async function abrir(id) {
    let d;
    try { d = (await Api.get(`/ausencias/api/baja-medica/${encodeURIComponent(id)}`)).ficha; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo abrir', texto: e.message, tono: 'error' }); }
    const historia = d.historia.length ? d.historia.map(p => `
      <li class="py-2 border-t border-telecab-border first:border-t-0">
        <p class="text-sm"><b>${esc(TIPOS[p.tipo] || p.tipo)}</b> · ${esc(dmy(p.fecha))}${p.prevista ? ` · prevista hasta el ${esc(dmy(p.prevista))}` : ''}${p.contingencia ? ` · ${esc(CONT[p.contingencia] || p.contingencia)}` : ''}</p>
        ${p.nota ? `<p class="text-xs text-telecab-muted">${esc(p.nota)}</p>` : ''}
        <p class="text-[11px] text-telecab-muted">${esc(p.creado)}${p.por ? ` · ${esc(p.por)}` : ''}${p.origen === 'fie' ? ' · del fichero del INSS' : ''}</p>
      </li>`).join('') : '<li class="text-sm text-telecab-muted">Sin partes: la baja se puso antes de llevarlos aquí.</li>';
    const botones = PUEDE ? (d.hasta
      ? '<button data-accion="rectificar" class="tc-boton tc-boton--chico">Rectificar</button>'
      : `<button data-accion="confirmacion" class="tc-boton tc-boton--principal tc-boton--chico">Confirmación (prórroga)</button>
         <button data-accion="alta" class="tc-boton tc-boton--chico">Parte de alta</button>
         <button data-accion="rectificar" class="tc-boton tc-boton--chico">Rectificar</button>`) : '';
    const panel = Panel.abrir({ titulo: d.nombre, subtitulo: `Baja médica desde el ${dmy(d.desde)} · ${d.dias} ${d.dias === 1 ? 'día' : 'días'}`, html: `
      <p class="mb-3">${etiqueta(d.estado.etiqueta, d.estado.tono)}</p>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
        <dt class="text-telecab-muted">Desde</dt><dd>${esc(dmy(d.desde))}</dd>
        <dt class="text-telecab-muted">Fin previsto</dt><dd>${esc(dmy(d.prevista) || '—')}</dd>
        <dt class="text-telecab-muted">Alta</dt><dd>${d.hasta ? `${esc(dmy(d.hasta))} · vuelve el ${esc(dmy(d.vuelve))}` : '—'}</dd>
        <dt class="text-telecab-muted">Contingencia</dt><dd>${esc(CONT[d.contingencia] || '—')}</dd>
      </dl>
      ${botones ? `<div class="flex flex-wrap gap-2 mb-4">${botones}</div>` : ''}
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">Los partes</h3>
      <ul class="mb-4">${historia}</ul>
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">Partes escaneados</h3>
      <div data-adjuntos></div>` });
    Adjuntos.montar(panel.cuerpo.querySelector('[data-adjuntos]'), { tipo: 'baja_medica', dueno: d.id, titulo: 'Parte', puedeAdjuntar: PUEDE, puedeQuitar: PUEDE });
    panel.cuerpo.querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', () => accion(b.dataset.accion, d, panel)));
  }

  async function accion(que, d, panel) {
    let campos, url, titulo, boton;
    if (que === 'confirmacion') {
      titulo = 'Confirmación (prórroga)'; boton = 'Apuntar'; url = 'confirmacion';
      campos = [
        { id: 'fecha', etiqueta: 'Día del parte', tipo: 'fecha', obligatorio: true },
        { id: 'prevista', etiqueta: 'Nueva fecha prevista', tipo: 'fecha', obligatorio: true },
        { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo' },
      ];
    } else if (que === 'alta') {
      titulo = 'Parte de alta'; boton = 'Apuntar el alta'; url = 'alta';
      campos = [
        { id: 'fecha', etiqueta: 'Día del alta', tipo: 'fecha', obligatorio: true, ayuda: 'Vuelve a trabajar al día siguiente. Se avisa a Planificación y te llega una tarjeta para su reincorporación.' },
        { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo' },
      ];
    } else {
      titulo = 'Rectificar la baja'; boton = 'Rectificar'; url = 'rectificar';
      campos = [
        { id: 'desde', etiqueta: 'Primer día (si cambia)', tipo: 'fecha', valor: d.desde ? dmy(d.desde) : '' },
        { id: 'prevista', etiqueta: 'Fecha prevista (si cambia)', tipo: 'fecha', valor: d.prevista ? dmy(d.prevista) : '' },
        { id: 'nota', etiqueta: 'Qué se rectifica y por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3 },
      ];
    }
    const v = await Dialogo.formulario(titulo, campos, { textoBoton: boton });
    if (!v) return;
    const r = await Api.post(`/ausencias/api/baja-medica/${encodeURIComponent(d.id)}/${url}`, v, { aviso: 'No se ha podido apuntar', bloquea: true });
    if (!r) return;
    Dialogo.hecho(que === 'alta' ? `Alta apuntada: vuelve el ${dmy(r.vuelve)}` : 'Apuntado');
    panel.cerrar();
    if (lista) await lista.recargar();
    abrir(d.id);
  }

  async function nueva() {
    const p = await Api.get('/ausencias/api/baja-medica/personas').catch(e => { Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); return null; });
    if (!p) return;
    const v = await Dialogo.formulario('Parte de baja', [
      { id: 'conductorId', etiqueta: 'Persona', tipo: 'lista', obligatorio: true,
        opciones: p.personas.map(x => ({ valor: x.id, texto: x.nombre + (x.legajo ? ` · ${x.legajo}` : '') })) },
      { id: 'fecha', etiqueta: 'Día de la baja', tipo: 'fecha', obligatorio: true },
      { id: 'prevista', etiqueta: 'Fecha prevista de fin (si la dice el parte)', tipo: 'fecha' },
      { id: 'contingencia', etiqueta: 'Contingencia', tipo: 'lista', valor: 'comun',
        opciones: Object.entries(CONT).map(([valor, texto]) => ({ valor, texto })) },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo' },
    ], { textoBoton: 'Abrir la baja', nota: 'Se abre la baja médica en su ficha desde ese día: sale del planificador y de la bitácora como siempre.' });
    if (!v) return;
    const r = await Api.post('/ausencias/api/baja-medica', v, { aviso: 'No se ha podido abrir', bloquea: true });
    if (!r) return;
    Dialogo.hecho('Baja abierta');
    if (lista) await lista.recargar();
    abrir(r.id);
  }

  // Desde una tarjeta: /ausencias?vista=bajas&baja=ID abre esa baja.
  const pedida = new URLSearchParams(location.search).get('baja');
  if (pedida) abrir(pedida);
})();
