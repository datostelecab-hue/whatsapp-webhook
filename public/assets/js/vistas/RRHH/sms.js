// modules/RRHH/vistas/sms.ejs — el SMS certificado de Mensatek (módulo 9, db/306, 26/11/2026).
//
// Cada envío: a quién va, el texto (libre o de una plantilla que se rellena con
// los datos de cada uno), el PDF si lo lleva y, una vez mandado, cómo va cada
// persona: entregado, certificado, si la abrió con su DNI, si la aceptó, y su
// certificado en PDF. El panel se refresca solo mientras está abierto.

(function () {
  const { esc, etiqueta } = Listado.fmt;
  const PUEDE = !!Casa.datos().puedeEnviar;
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const REFRESCO_MS = 20000;
  let ESTADOS = {}, ALCANCES = {}, PLANTILLAS = {}, lista = null;
  const estado = e => ESTADOS[e.estado] || { etiqueta: e.estado, tono: 'muted' };

  lista = Listado.montar({
    raiz: '#modulo',
    titulo: 'SMS certificado',
    icono: 'fa-comment-sms',
    clave: 'id',
    url: false,
    origen: '/sms/api/lista',
    vacio: 'No hay envíos. Con «Nuevo SMS certificado» se prepara uno a una persona, a un grupo o a toda la plantilla.',
    buscar: { texto: 'Buscar por asunto…', campos: ['asunto'] },
    subtitulo: (v, t) => `${v.length} de ${t.length} envíos`,
    kpis: (filas, extra) => {
      if (extra) { ESTADOS = extra.estados || ESTADOS; ALCANCES = extra.alcances || ALCANCES; PLANTILLAS = extra.plantillas || PLANTILLAS; }
      const enviados = filas.filter(e => ['enviado', 'enviando', 'error'].includes(e.estado));
      const suma = k => enviados.reduce((s, e) => s + (e[k] || 0), 0);
      return [
        { etiqueta: 'Borradores', valor: filas.filter(e => e.estado === 'borrador').length, tono: 'muted', icono: 'fa-pen', filtro: { id: 'estado', valor: 'borrador' } },
        { etiqueta: 'Mandados', valor: suma('total'), icono: 'fa-paper-plane', ayuda: 'Personas a las que se ha mandado un SMS certificado (los envíos de la lista).' },
        { etiqueta: 'Certificados', valor: suma('certificados'), tono: 'green', icono: 'fa-certificate', ayuda: 'Entregados y certificados por Mensatek: su certificado en PDF está en el envío y en el expediente.' },
        { etiqueta: 'Con error', valor: suma('fallidos'), tono: suma('fallidos') ? 'red' : undefined, icono: 'fa-triangle-exclamation',
          ayuda: 'Sin móvil en la ficha, o Mensatek no lo aceptó.' },
      ];
    },
    nota: (filas, extra) => [
      ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/306 en Migraciones.' }] : []),
      ...(extra && !extra.sinTabla && !extra.configurado ? [{ tono: 'aviso', icono: 'fa-plug', texto: 'Mensatek no está configurado en el servidor (falta el usuario y el token de la API): se pueden preparar, no mandar.' }] : []),
      ...(extra && extra.faltaEmisor && extra.faltaEmisor.length ? [{ tono: 'aviso', icono: 'fa-building', texto: `Falta ${extra.faltaEmisor.join(' y ')} de la empresa en Parámetros: Mensatek lo pide en cada envío.` }] : []),
      { icono: 'fa-circle-info', texto: 'Cada persona recibe un SMS certificado y, para abrir la notificación, escribe su DNI (sin DNI en su ficha, su móvil). Cada envío gasta créditos de Mensatek. El certificado de entrega se guarda solo en el envío y en el expediente del conductor.' },
    ],
    filtros: [
      { id: 'estado', etiqueta: 'Estado', campo: 'estado', textoTodos: 'Cualquiera',
        opciones: () => Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta })) },
    ],
    acciones: [
      ...(PUEDE ? [{ texto: 'Nuevo SMS certificado', icono: 'fa-plus', onClick: () => redactar(null) }] : []),
      { texto: 'Créditos de Mensatek', icono: 'fa-coins', principal: false, onClick: () => creditos() },
    ],
    alAbrir: e => abrir(e.id),
    columnas: [
      { titulo: 'Envío', campo: 'asunto', clase: 'font-semibold',
        pinta: (v, e) => esc(v) + `<span class="block text-xs font-normal text-telecab-muted">${esc(e.alcance_texto)} · ${esc(e.plantilla_texto)}${e.origen !== 'manual' ? ` · desde ${e.origen === 'sancion' ? 'Sanciones' : 'Finiquitos'}` : ''}</span>` },
      { titulo: 'Estado', valor: e => estado(e).etiqueta, pinta: (v, e) => etiqueta(v, estado(e).tono) },
      { titulo: 'Entregados', valor: e => (e.total ? e.entregados / e.total : -1), clase: 'whitespace-nowrap tabular-nums',
        pinta: (v, e) => (!e.total ? '<span class="text-xs text-telecab-muted">—</span>'
          : `<span class="font-semibold">${e.entregados}</span> de ${e.total}<span class="block text-xs text-telecab-muted">${e.certificados} certificados · ${e.abiertos} abiertos</span>`) },
      { titulo: 'Mandado', valor: e => e.enviado_dia || '', clase: 'whitespace-nowrap tabular-nums text-xs', pinta: v => esc(dmy(v)) },
    ],
  });

  // ── El envío, en el panel ──
  let panel = null, reloj = null;
  async function abrir(id) {
    let d;
    try { d = (await Api.get(`/sms/api/envio/${encodeURIComponent(id)}`)).ficha; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se pudo abrir', texto: e.message, tono: 'error' }); }
    if (panel) panel.cerrar();
    panel = Panel.abrir({ titulo: d.asunto, subtitulo: `${d.alcance_texto} · ${estado(d).etiqueta}`, html: cuerpo(d), ancho: 'max-w-2xl',
      alCerrar: () => { clearInterval(reloj); reloj = null; panel = null; } });
    enganchar(d);
    clearInterval(reloj);
    if (d.estado !== 'borrador' && d.estado !== 'anulado') {
      reloj = setInterval(async () => {
        if (!panel || document.hidden) return;
        try {
          const n = (await Api.get(`/sms/api/envio/${encodeURIComponent(id)}`)).ficha;
          if (panel) { panel.cuerpo.innerHTML = cuerpo(n); enganchar(n); }
        } catch (_) { /* se reintenta en la próxima vuelta */ }
      }, REFRESCO_MS);
    }
  }

  function cuerpo(d) {
    const borrador = d.estado === 'borrador';
    const botones = PUEDE && borrador ? `
      <button data-accion="editar" class="tc-boton tc-boton--chico">Corregir</button>
      <button data-accion="enviar" class="tc-boton tc-boton--principal tc-boton--chico">Mandar</button>
      <button data-accion="anular" class="tc-boton tc-boton--chico">Anular</button>` : '';
    const previa = d.previa ? `<p class="text-sm mb-3">Iría a <b>${d.previa.total}</b> ${d.previa.total === 1 ? 'persona' : 'personas'}${
      d.previa.sinMovil ? `; <span class="text-telecab-red">${d.previa.sinMovil} sin móvil</span> (no se les manda)` : ''}${
      d.previa.sinDni ? `; ${d.previa.sinDni} sin DNI en su ficha (abrirán con su móvil)` : ''}.</p>` : '';
    const ejemplo = d.previa && d.previa.ejemplo
      ? `<h3 class="text-xs font-semibold text-telecab-muted mb-1">Así le llega a la primera persona</h3>
         <div class="text-sm whitespace-pre-line rounded-lg border border-telecab-border p-3 mb-4">${esc(d.previa.ejemplo)}</div>` : '';
    return `
      <p class="mb-3">${etiqueta(estado(d).etiqueta, estado(d).tono)}${d.error ? ` <span class="text-xs text-telecab-red">${esc(d.error)}</span>` : ''}</p>
      ${previa}
      ${botones ? `<div class="flex flex-wrap gap-2 mb-4">${botones}</div>` : ''}
      ${borrador ? '' : seguimiento(d)}
      ${ejemplo}
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">El texto${d.plantilla !== 'libre' ? ` (plantilla «${esc(d.plantilla_texto)}»)` : ''}</h3>
      <div class="text-sm whitespace-pre-line rounded-lg border border-telecab-border p-3 mb-2">${esc(d.mensaje)}</div>
      <p class="text-xs text-telecab-muted mb-4">${d.aceptacion ? `Tiene que aceptarla o rechazarla antes de verla (caduca a los ${d.aceptacion} días).` : 'Sin aceptación: la abre y la ve.'}</p>
      <h3 class="text-xs font-semibold text-telecab-muted mb-1">PDF adjunto${borrador ? ' (opcional: uno solo)' : ''}</h3>
      <div data-adjuntos class="mb-4"></div>
      <p class="text-xs text-telecab-muted">Creado ${esc(d.creado)}${d.creado_por_nombre ? ` por ${esc(d.creado_por_nombre)}` : ''}${d.enviado ? ` · mandado ${esc(d.enviado)}${d.enviado_por_nombre ? ` por ${esc(d.enviado_por_nombre)}` : ''}` : ''}${d.creditos ? ` · ${d.creditos} créditos` : ''}</p>`;
  }

  function seguimiento(d) {
    const fila = p => {
      const marcas = [
        p.error ? `<span class="text-telecab-red">${esc(p.error)}</span>` : esc(p.estado_texto || 'Esperando a Mensatek'),
        p.abierto ? `abierta ${esc(p.abierto)}` : '', p.aceptado ? '<span class="text-telecab-green">aceptada</span>' : '',
        p.rechazado ? '<span class="text-telecab-red">rechazada</span>' : '',
      ].filter(Boolean).join(' · ');
      const cert = p.certificado_adjunto_id ? `<a class="text-xs text-telecab-gold hover:underline" href="/adjuntos/${encodeURIComponent(p.certificado_adjunto_id)}/fichero" target="_blank" rel="noopener">Certificado</a>` : '';
      return `<li class="py-1.5 border-t border-telecab-border first:border-t-0 flex flex-wrap gap-x-3 items-baseline">
        <a class="text-sm font-medium hover:underline" href="/plantilla#${encodeURIComponent(p.conductor_id)}">${esc(p.nombre)}</a>
        <span class="text-xs text-telecab-muted">${marcas}${p.identificar === 'MOVIL' ? ' · abre con su móvil' : ''}</span>${cert}</li>`;
    };
    return `
      <div class="grid grid-cols-3 gap-2 mb-3 text-center">
        <div class="rounded-lg border border-telecab-border p-2"><p class="text-xl font-semibold tabular-nums">${d.entregados}</p><p class="text-xs text-telecab-muted">entregados</p></div>
        <div class="rounded-lg border border-telecab-border p-2"><p class="text-xl font-semibold tabular-nums">${d.certificados}</p><p class="text-xs text-telecab-muted">certificados</p></div>
        <div class="rounded-lg border border-telecab-border p-2"><p class="text-xl font-semibold tabular-nums">${d.abiertos}</p><p class="text-xs text-telecab-muted">la abrieron</p></div>
      </div>
      <p class="text-[11px] text-telecab-muted mb-2">Se actualiza solo cada 20 segundos.</p>
      <ul class="mb-4">${d.personas.map(fila).join('') || '<li class="text-sm text-telecab-muted">Preparando el envío…</li>'}</ul>`;
  }

  function enganchar(d) {
    const caja = panel.cuerpo.querySelector('[data-adjuntos]');
    if (caja) Adjuntos.montar(caja, { tipo: 'sms_envio', dueno: d.id, titulo: 'PDF', puedeAdjuntar: PUEDE && d.estado === 'borrador', puedeQuitar: PUEDE && d.estado === 'borrador' });
    panel.cuerpo.querySelectorAll('[data-accion]').forEach(b => b.addEventListener('click', () => accion(b.dataset.accion, d)));
  }

  async function accion(que, d) {
    if (que === 'editar') return redactar(d);
    if (que === 'enviar') {
      const n = d.previa ? d.previa.total - d.previa.sinMovil : 0;
      const ok = await Dialogo.confirmar({
        titulo: 'Mandar el SMS certificado', si: 'Mandar', no: 'Cancelar', tono: 'aviso',
        texto: `Sale ahora a ${n} ${n === 1 ? 'persona' : 'personas'}${d.pdfs ? ', con el PDF adjunto' : ', sin PDF'}. Cada uno gasta créditos de Mensatek y no se puede deshacer.`,
      });
      if (!ok) return;
      const r = await Api.post(`/sms/api/envio/${encodeURIComponent(d.id)}/enviar`, {}, { aviso: 'No se ha podido mandar', bloquea: true });
      if (!r) return;
      Dialogo.hecho('Mandándose: el estado de cada uno se actualiza solo');
    } else if (que === 'anular') {
      const ok = await Dialogo.confirmar({ titulo: 'Anular el borrador', si: 'Anular', no: 'Cancelar', texto: 'No se manda a nadie.' });
      if (!ok) return;
      if (!await Api.post(`/sms/api/envio/${encodeURIComponent(d.id)}/anular`, {}, { aviso: 'No se ha podido', bloquea: true })) return;
      Dialogo.hecho('Anulado');
    }
    await lista.recargar();
    abrir(d.id);
  }

  async function redactar(d) {
    let gente = [];
    try { gente = (await Api.get('/sms/api/personas')).personas; }
    catch (e) { return Dialogo.aviso({ titulo: 'No se ha podido', texto: e.message, tono: 'error' }); }
    // Primero la plantilla (rellena el texto); luego el resto.
    let plantilla = d ? d.plantilla : null;
    if (!d) {
      const p = await Dialogo.formulario('Nuevo SMS certificado', [
        { id: 'plantilla', etiqueta: 'Plantilla', tipo: 'lista', obligatorio: true, valor: 'libre',
          opciones: Object.entries(PLANTILLAS).map(([valor, x]) => ({ valor, texto: x.nombre })) },
      ], { textoBoton: 'Seguir', nota: 'El texto de la plantilla se puede cambiar en el paso siguiente.' });
      if (!p) return;
      plantilla = p.plantilla;
    }
    const base = PLANTILLAS[plantilla] || { asunto: '', texto: '' };
    const v = await Dialogo.formulario(d ? 'Corregir el SMS certificado' : 'Nuevo SMS certificado', [
      { id: 'asunto', etiqueta: 'Asunto (para reconocerlo en la lista)', tipo: 'texto', obligatorio: true, max: 160, valor: d ? d.asunto : base.asunto },
      { id: 'mensaje', etiqueta: 'Texto del SMS', tipo: 'texto-largo', obligatorio: true, minimo: 10, max: 1500, valor: d ? d.mensaje : base.texto,
        ayuda: 'Se rellena con los datos de cada uno: {nombre}, {pila}, {dni} y {fecha}. Las tildes salen sin tilde (salvo la é): así cada SMS cabe en menos mensajes.' },
      { id: 'alcance', etiqueta: 'A quién va', tipo: 'lista', obligatorio: true, valor: d ? d.alcance : 'personas',
        opciones: Object.entries(ALCANCES).map(([valor, texto]) => ({ valor, texto })) },
      { id: 'personas', etiqueta: 'Las personas (solo con «Unas personas»)', tipo: 'lista', multiple: true, valor: d && d.personas ? d.personas : [],
        opciones: gente.map(p => ({ valor: p.id, texto: p.nombre + (p.alta ? '' : ' · de baja') + (p.con_movil ? '' : ' · sin móvil') + (p.con_dni ? '' : ' · sin DNI') })),
        buscador: { marcador: 'Busca por nombre…', tope: 12 } },
      { id: 'aceptacion', etiqueta: 'Pedir que la acepte o rechace antes de verla', tipo: 'lista', valor: String(d ? d.aceptacion : 0),
        opciones: [{ valor: '0', texto: 'No' }, { valor: '5', texto: 'Sí, con 5 días para hacerlo' }, { valor: '10', texto: 'Sí, con 10 días' }, { valor: '15', texto: 'Sí, con 15 días' }] },
    ], { textoBoton: 'Guardar el borrador', ancho: 'max-w-2xl', nota: 'Se guarda como borrador: después puedes adjuntar el PDF y mandarlo.' });
    if (!v) return;
    const cuerpoPost = { ...v, plantilla, personas: v.alcance === 'personas' ? v.personas : [] };
    const r = await Api.post(d ? `/sms/api/envio/${encodeURIComponent(d.id)}` : '/sms/api/envio', cuerpoPost, { aviso: 'No se ha podido guardar', bloquea: true });
    if (!r) return;
    Dialogo.hecho('Guardado');
    await lista.recargar();
    abrir(r.id);
  }

  async function creditos() {
    try {
      const r = await Api.get('/sms/api/creditos');
      Dialogo.aviso({ titulo: 'Créditos de Mensatek', texto: `Quedan ${Number(r.creditos).toLocaleString('es-ES')} créditos. La conexión con Mensatek funciona.` });
    } catch (e) { Dialogo.aviso({ titulo: 'No se ha podido consultar', texto: e.message, tono: 'error' }); }
  }

  // Desde Sanciones o Finiquitos (o un enlace): /sms#ID abre ese envío.
  const pedido = decodeURIComponent((location.hash || '').slice(1));
  if (/^\d+$/.test(pedido)) abrir(pedido);
})();
