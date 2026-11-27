// modules/RRHH/vistas/comunicados.ejs — los comunicados a la plantilla (módulos 6 y 9, db/305, 26/11/2026).
//
// Diana los redacta y pide que se aprueben; otra persona los aprueba y salen
// por correo y al portal. En el panel de cada uno, quién lo ha leído y quién
// no: se refresca solo cada 20 segundos mientras está abierto (el encargo:
// «un envío masivo muestra en tiempo real quién ha firmado y quién no»).

(function () {
  const { esc, etiqueta } = Listado.fmt;
  const DATOS = Casa.datos();
  const PREPARA = !!DATOS.puedePreparar, APRUEBA = !!DATOS.puedeAprobar;
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const REFRESCO_MS = 20000;
  let ESTADOS = {}, ALCANCES = {}, lista = null;
  const estado = m => ESTADOS[m.estado] || { etiqueta: m.estado, tono: 'muted' };
  const pct = m => (m.total ? Math.round(m.leidos / m.total * 100) : 0);

  lista = Listado.montar({
    raiz: '#modulo',
    titulo: 'Comunicados',
    icono: 'fa-bullhorn',
    clave: 'id',
    url: false,
    origen: '/comunicados/api/lista',
    vacio: 'No hay comunicados. Con «Nuevo comunicado» se redacta uno para toda la plantilla o para un grupo.',
    buscar: { texto: 'Buscar por título…', campos: ['titulo'] },
    subtitulo: (v, t) => `${v.length} de ${t.length} comunicados`,
    kpis: (filas, extra) => {
      if (extra && extra.estados) ESTADOS = extra.estados;
      if (extra && extra.alcances) ALCANCES = extra.alcances;
      const enviados = filas.filter(m => m.estado === 'enviado');
      const sinLeer = enviados.reduce((s, m) => s + m.sin_leer, 0);
      return [
        { etiqueta: 'Por aprobar', valor: filas.filter(m => m.estado === 'por_aprobar').length, tono: 'warn', icono: 'fa-hourglass-half', filtro: { id: 'estado', valor: 'por_aprobar' } },
        { etiqueta: 'Borradores', valor: filas.filter(m => m.estado === 'borrador').length, tono: 'muted', icono: 'fa-pen', filtro: { id: 'estado', valor: 'borrador' } },
        { etiqueta: 'Enviados', valor: enviados.length, tono: 'green', icono: 'fa-paper-plane', filtro: { id: 'estado', valor: 'enviado' } },
        { etiqueta: 'Sin leer', valor: sinLeer, tono: sinLeer ? 'red' : undefined, icono: 'fa-envelope',
          ayuda: 'Personas que aún no han pulsado «Lo he leído», sumando todos los comunicados enviados.' },
      ];
    },
    nota: (filas, extra) => [
      ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/305 en Migraciones.' }] : []),
      { icono: 'fa-circle-info', texto: 'Salen por correo y al portal de conductores, donde cada uno pulsa «Lo he leído» (queda el día y la hora). A quien no lo lee se le recuerda por correo cada 2 días hábiles, 3 veces como mucho. Lo prepara una persona y lo aprueba otra.' },
    ],
    filtros: [
      { id: 'estado', etiqueta: 'Estado', campo: 'estado', textoTodos: 'Cualquiera',
        opciones: () => Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta })) },
    ],
    acciones: PREPARA ? [{ texto: 'Nuevo comunicado', icono: 'fa-plus', onClick: () => redactar(null) }] : [],
    alAbrir: m => abrir(m.id),
    columnas: [
      { titulo: 'Comunicado', campo: 'titulo', clase: 'font-semibold',
        pinta: (v, m) => esc(v) + `<span class="block text-xs font-normal text-telecab-muted">${esc(m.alcance_texto)} · ${esc(m.creado)}${m.creado_por_nombre ? ` · ${esc(m.creado_por_nombre)}` : ''}</span>` },
      { titulo: 'Estado', valor: m => estado(m).etiqueta, pinta: (v, m) => etiqueta(v, estado(m).tono) },
      { titulo: 'Leído', valor: m => (m.estado === 'enviado' ? pct(m) : -1), clase: 'whitespace-nowrap tabular-nums',
        pinta: (v, m) => (m.estado !== 'enviado' ? '<span class="text-xs text-telecab-muted">—</span>'
          : `<span class="font-semibold">${m.leidos}</span> de ${m.total} <span class="text-xs text-telecab-muted">(${pct(m)} %)</span>`) },
      { titulo: 'Enviado', valor: m => m.enviado_dia || '', clase: 'whitespace-nowrap tabular-nums text-xs', pinta: v => esc(dmy(v)) },
    ],
  });

  // ── El comunicado, en el panel (con su seguimiento) ──
  let panel = null, reloj = null;
  async function abrir(id) {
    let d;
    try { d = (await Api.get(`/comunicados/api/comunicado/${encodeURIComponent(id)}`)).ficha; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo abrir', texto: e.message, tono: 'error' }); }
    if (panel) panel.cerrar();
    panel = Panel.abrir({ titulo: d.titulo, subtitulo: `${d.alcance_texto} · ${estado(d).etiqueta}`, html: cuerpo(d), ancho: 'max-w-2xl',
      alCerrar: () => { clearInterval(reloj); reloj = null; panel = null; } });
    enganchar(d);
    clearInterval(reloj);
    if (d.estado === 'enviado') {
      reloj = setInterval(async () => {
        if (!panel || document.hidden) return;
        try {
          const n = (await Api.get(`/comunicados/api/comunicado/${encodeURIComponent(id)}`)).ficha;
          if (!panel) return;
          panel.cuerpo.innerHTML = cuerpo(n);
          enganchar(n);
        } catch (_) { /* se reintenta en la próxima vuelta */ }
      }, REFRESCO_MS);
    }
  }

  function cuerpo(d) {
    const botones = [
      d.estado === 'borrador' && PREPARA ? '<button data-accion="editar" class="tc-boton tc-boton--chico">Corregir</button>' : '',
      d.estado === 'borrador' && PREPARA ? '<button data-accion="pedir" class="tc-boton tc-boton--principal tc-boton--chico">Pedir que se apruebe</button>' : '',
      d.estado === 'por_aprobar' && APRUEBA && !d.esSuyo ? '<button data-accion="aprobar" class="tc-boton tc-boton--principal tc-boton--chico">Aprobar y enviar</button>' : '',
      d.estado === 'por_aprobar' && (APRUEBA || PREPARA) ? '<button data-accion="devolver" class="tc-boton tc-boton--chico">Devolver al borrador</button>' : '',
      d.estado !== 'anulado' && (d.estado !== 'enviado' ? (APRUEBA || PREPARA) : APRUEBA) ? '<button data-accion="anular" class="tc-boton tc-boton--chico">Anular</button>' : '',
      // A quien no lo ha leído, un SMS certificado cuando se decida (db/310): prepara el borrador en /sms.
      d.estado === 'enviado' && d.puedeSms && d.total > d.leidos
        ? `<button data-accion="sms" class="tc-boton tc-boton--chico">SMS certificado a quien falta (${d.total - d.leidos})</button>` : '',
    ].join('');
    const previa = d.previa ? `<p class="text-sm mb-3">Iría a <b>${d.previa.total}</b> ${d.previa.total === 1 ? 'persona' : 'personas'}${d.previa.sinCorreo ? `; <span class="text-telecab-warn">${d.previa.sinCorreo} sin correo</span> (lo verán solo al entrar en el portal)` : ''}.</p>` : '';
    const espera = d.estado === 'por_aprobar' && d.esSuyo ? '<p class="text-xs text-telecab-muted mb-3">Lo preparaste tú: lo aprueba otra persona.</p>' : '';
    const nota = d.nota ? `<p class="text-sm rounded-lg border border-telecab-border p-3 mb-3"><span class="text-telecab-muted">Nota:</span> ${esc(d.nota)}</p>` : '';
    return `
      <p class="mb-3">${etiqueta(estado(d).etiqueta, estado(d).tono)}</p>
      ${nota}${previa}${espera}
      ${botones ? `<div class="flex flex-wrap gap-2 mb-4">${botones}</div>` : ''}
      ${d.estado === 'enviado' ? seguimiento(d) : ''}
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">El texto</h3>
      <div class="text-sm whitespace-pre-line rounded-lg border border-telecab-border p-3 mb-4">${esc(d.cuerpo)}</div>
      <div data-adjuntos class="mb-4"></div>
      <p class="text-xs text-telecab-muted">Creado ${esc(d.creado)}${d.creado_por_nombre ? ` por ${esc(d.creado_por_nombre)}` : ''}${d.aprobado ? ` · aprobado ${esc(d.aprobado)}${d.aprobado_por_nombre ? ` por ${esc(d.aprobado_por_nombre)}` : ''}` : ''}</p>`;
  }

  function seguimiento(d) {
    const faltan = d.personas.filter(p => !p.ha_leido), ya = d.personas.filter(p => p.ha_leido);
    const fila = p => `<li class="py-1.5 border-t border-telecab-border first:border-t-0 flex flex-wrap gap-x-3 items-baseline">
        <a class="text-sm font-medium underline-offset-2 hover:underline" href="/plantilla#${encodeURIComponent(p.conductor_id)}">${esc(p.nombre)}</a>
        <span class="text-xs text-telecab-muted">${p.ha_leido ? `leído ${esc(p.leido)}`
          : [p.email ? (p.correo_error ? `<span class="text-telecab-red">el correo falló</span>` : p.correo ? `correo ${esc(p.correo)}` : 'correo por salir') : '<span class="text-telecab-warn">sin correo</span>',
            p.visto ? `lo abrió ${esc(p.visto)}` : '', p.pdf ? `abrió el PDF ${esc(p.pdf)}` : '', p.recordatorios ? `${p.recordatorios} ${p.recordatorios === 1 ? 'recordatorio' : 'recordatorios'}` : ''].filter(Boolean).join(' · ')}</span></li>`;
    return `
      <div class="grid grid-cols-3 gap-2 mb-3 text-center">
        <div class="rounded-lg border border-telecab-border p-2"><p class="text-xl font-semibold tabular-nums">${d.leidos}</p><p class="text-xs text-telecab-muted">lo han leído</p></div>
        <div class="rounded-lg border border-telecab-border p-2"><p class="text-xl font-semibold tabular-nums ${faltan.length ? 'text-telecab-red' : ''}">${faltan.length}</p><p class="text-xs text-telecab-muted">faltan</p></div>
        <div class="rounded-lg border border-telecab-border p-2"><p class="text-xl font-semibold tabular-nums">${d.total ? Math.round(d.leidos / d.total * 100) : 0} %</p><p class="text-xs text-telecab-muted">de ${d.total}</p></div>
      </div>
      <p class="text-[11px] text-telecab-muted mb-3">Se actualiza solo cada 20 segundos.</p>
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">Faltan (${faltan.length})</h3>
      <ul class="mb-4">${faltan.length ? faltan.map(fila).join('') : '<li class="text-sm text-telecab-muted">Lo han leído todos.</li>'}</ul>
      <details class="mb-4"><summary class="text-xs font-semibold text-telecab-muted cursor-pointer">Lo han leído (${ya.length})</summary>
        <ul class="mt-1">${ya.map(fila).join('')}</ul></details>`;
  }

  function enganchar(d) {
    panel.cuerpo.querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', () => accion(b.dataset.accion, d)));
    // El PDF (db/310): se sube mientras es borrador; cada uno lo abre en su portal.
    const caja = panel.cuerpo.querySelector('[data-adjuntos]');
    const editable = PREPARA && d.estado === 'borrador';
    if (caja && window.Adjuntos) {
      Adjuntos.montar(caja, { tipo: 'comunicado', dueno: d.id, titulo: 'Documento (PDF; cada uno lo abre en su portal)', puedeAdjuntar: editable, puedeQuitar: editable });
    }
  }

  async function accion(que, d) {
    if (que === 'editar') return redactar(d);
    if (que === 'sms') {
      const ok = await Dialogo.confirmar({ titulo: 'SMS certificado a quien falta', si: 'Preparar el SMS', no: 'Cancelar',
        texto: `Se prepara un borrador de SMS certificado a las ${d.total - d.leidos} personas que aún no lo han leído, con el documento si lo lleva. No sale hasta que lo mandes desde «SMS certificado» (9 créditos por persona).` });
      if (!ok) return;
      const s = await Api.post('/sms/api/desde', { origen: 'comunicado', origenId: d.id }, { aviso: 'No se ha podido preparar', bloquea: true });
      if (s) location.href = `/sms#${encodeURIComponent(s.id)}`;
      return;
    }
    let r;
    if (que === 'pedir') {
      r = await Api.post(`/comunicados/api/comunicado/${encodeURIComponent(d.id)}/pedir`, {}, { aviso: 'No se ha podido', bloquea: true });
      if (r) Dialogo.hecho('Pedido: le llega a quien aprueba');
    } else if (que === 'aprobar') {
      const ok = await Dialogo.confirmar({
        titulo: 'Aprobar y enviar', si: 'Enviar', no: 'Cancelar', tono: 'aviso',
        texto: `Sale ahora a ${d.previa ? d.previa.total : 'todas las'} personas por correo y al portal. Después no se puede cambiar el texto.`,
      });
      if (!ok) return;
      r = await Api.post(`/comunicados/api/comunicado/${encodeURIComponent(d.id)}/aprobar`, {}, { aviso: 'No se ha podido enviar', bloquea: true });
      if (r) Dialogo.hecho(`Enviado a ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}`);
    } else {
      const v = await Dialogo.formulario(que === 'anular' ? 'Anular el comunicado' : 'Devolver al borrador', [
        { id: 'nota', etiqueta: que === 'anular' ? 'Por qué se anula' : 'Qué hay que cambiar', tipo: 'texto-largo', obligatorio: que === 'anular' || APRUEBA, minimo: 3 },
      ], { textoBoton: que === 'anular' ? 'Anular' : 'Devolver',
        nota: que === 'anular' && d.estado === 'enviado' ? 'Ya enviado: desaparece del portal de cada uno; los correos ya salieron.' : undefined });
      if (!v) return;
      r = await Api.post(`/comunicados/api/comunicado/${encodeURIComponent(d.id)}/${que}`, v, { aviso: 'No se ha podido', bloquea: true });
      if (r) Dialogo.hecho(que === 'anular' ? 'Anulado' : 'Devuelto al borrador');
    }
    if (!r) return;
    await lista.recargar();
    abrir(d.id);
  }

  async function redactar(d) {
    let gente = [];
    try { gente = (await Api.get('/comunicados/api/personas')).personas; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
    const v = await Dialogo.formulario(d ? 'Corregir el comunicado' : 'Nuevo comunicado', [
      { id: 'titulo', etiqueta: 'Título', tipo: 'texto', obligatorio: true, max: 160, valor: d ? d.titulo : '', marcador: 'Por ejemplo: Nuevos códigos de descuento' },
      { id: 'cuerpo', etiqueta: 'Texto', tipo: 'texto-largo', obligatorio: true, minimo: 10, max: 20000, valor: d ? d.cuerpo : '',
        ayuda: 'Es lo que leerá cada uno en el portal antes de pulsar «Lo he leído». Los saltos de línea se respetan.' },
      { id: 'alcance', etiqueta: 'A quién va', tipo: 'lista', obligatorio: true, valor: d ? d.alcance : 'todos',
        opciones: Object.entries(ALCANCES).map(([valor, texto]) => ({ valor, texto })) },
      { id: 'personas', etiqueta: 'Las personas (solo con «Unas personas»)', tipo: 'lista', multiple: true, valor: d && d.personas ? d.personas : [],
        opciones: gente.map(p => ({ valor: p.id, texto: p.nombre + (p.email ? '' : ' · sin correo') })), buscador: { marcador: 'Busca por nombre…', tope: 12 } },
    ], { textoBoton: d ? 'Guardar' : 'Guardar el borrador', ancho: 'max-w-2xl',
      nota: 'Se guarda como borrador. Luego «Pedir que se apruebe»: no sale hasta que lo aprueba otra persona.' });
    if (!v) return;
    const cuerpoPost = { ...v, personas: v.alcance === 'personas' ? v.personas : [] };
    const r = await Api.post(d ? `/comunicados/api/comunicado/${encodeURIComponent(d.id)}` : '/comunicados/api/comunicado', cuerpoPost,
      { aviso: 'No se ha podido guardar', bloquea: true });
    if (!r) return;
    Dialogo.hecho('Guardado');
    await lista.recargar();
    abrir(r.id);
  }

  // Desde una tarjeta: /comunicados#ID abre ese comunicado.
  const pedido = decodeURIComponent((location.hash || '').slice(1));
  if (/^\d+$/.test(pedido)) abrir(pedido);
})();
