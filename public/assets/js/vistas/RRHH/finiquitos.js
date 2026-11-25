// modules/RRHH/vistas/finiquitos.ejs — los finiquitos (módulo 7, db/291, 25/11/2026).
//
// El finiquito de cada baja, con su resumen de cierre: vacaciones netas (días),
// recaudación pendiente (el 100 %) y variables y bonus pendientes, cada uno con
// su soporte. Diana lo revisa, Ignacio lo aprueba y se manda solo a la gestoría
// (o a la ETT). Luego, el firmado.

(function () {
  const D = Casa.datos();
  const REVISA = !!D.puedeRevisar, APRUEBA = !!D.puedeAprobar;
  const { esc, etiqueta } = Listado.fmt;
  let ESTADOS = {};
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const euros = n => (n == null ? '' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
  const est = f => ESTADOS[f.estado] || { etiqueta: f.estado, tono: 'muted' };
  const contrato = f => (f.tipo === 'ett' ? `ETT${f.ett_nombre ? ` · ${f.ett_nombre}` : ''}` : 'Plantilla propia');
  const quien = (cuando, por) => (cuando ? `${cuando}${por ? ` · ${por}` : ''}` : 'Pendiente');

  function cifra(c) {
    if (c.error) return `<span class="text-telecab-red font-semibold">No se pudo calcular</span>`;
    if (c.noAplica) return '<span class="text-telecab-muted">No aplica</span>';
    if (c.unidad === 'días') return `<b class="tabular-nums">${esc(String(c.cantidad).replace('.', ','))} días</b>`;
    const tono = c.importe < 0 ? 'text-telecab-red' : c.importe > 0 ? 'text-telecab-green' : '';
    return `<b class="tabular-nums ${tono}">${esc(euros(c.importe))}</b>`;
  }

  Listado.montar({
    raiz: '#modulo',
    titulo: 'Finiquitos',
    icono: 'fa-file-signature',
    clave: 'id',
    origen: '/finiquitos/api/lista',
    vacio: 'No hay finiquitos que coincidan.',
    filtrosIniciales: { estado: 'abiertos' },
    buscar: { texto: 'Buscar persona o legajo…', campos: ['nombre', 'legajo'] },

    subtitulo: (v, t) => (v.length === t.length ? `${t.length} finiquitos` : `${v.length} de ${t.length} finiquitos`),

    cifras: (filas, extra) => {
      if (extra && extra.estados) ESTADOS = extra.estados;
      const n = e => filas.filter(f => f.estado === e).length;
      return [
        { valor: n('borrador'), etiqueta: 'por revisar', tono: 'warn', filtro: { id: 'estado', valor: 'borrador' } },
        { valor: n('revisado'), etiqueta: 'por aprobar', tono: 'warn', filtro: { id: 'estado', valor: 'revisado' } },
        { valor: n('aprobado'), etiqueta: 'aprobados sin enviar', tono: 'red', filtro: { id: 'estado', valor: 'aprobado' } },
        { valor: n('enviado'), etiqueta: 'sin firmar', filtro: { id: 'estado', valor: 'enviado' } },
      ];
    },

    nota: (filas, extra) => {
      const notas = [];
      if (extra && extra.sinTabla) notas.push({ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/291 en Migraciones.' });
      if (extra && !extra.sinTabla && (!extra.correoGestoria || !extra.correoEtt)) {
        notas.push({ tono: 'aviso', icono: 'fa-envelope', texto: `Al aprobar uno, se manda solo por correo. Falta ${[
          !extra.correoGestoria ? 'el «Correo de la gestoría»' : '', !extra.correoEtt ? 'el «Correo de la ETT para los finiquitos»' : '']
          .filter(Boolean).join(' y ')} en Parámetros: mientras tanto, esos se mandan a mano y se marcan enviados.` });
      }
      notas.push({ icono: 'fa-circle-info', texto: 'Nace solo al dar la baja (propia y ETT). Recoge las vacaciones que le quedan, lo que debe en Recaudación y las variables que se van sin pagar; el salario del mes y la indemnización los calcula la gestoría.' });
      return notas;
    },

    filtros: [
      { id: 'estado', etiqueta: 'Estado', textoTodos: 'Cualquier estado',
        opciones: () => [{ valor: 'abiertos', texto: 'Sin terminar' }, ...Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta }))],
        pasa: (f, v) => (v === 'abiertos' ? !['firmado', 'anulado'].includes(f.estado) : f.estado === v) },
      { id: 'tipo', etiqueta: 'Contrato', campo: 'tipo', textoTodos: 'Propia y ETT',
        opciones: [{ valor: 'propia', texto: 'Plantilla propia' }, { valor: 'ett', texto: 'ETT' }] },
    ],

    columnas: [
      { titulo: 'Baja', campo: 'fecha_baja', clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(dmy(v)) },
      { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Legajo ${esc(f.legajo)}</span>` : '') },
      { titulo: 'Contrato', valor: contrato, clase: 'whitespace-nowrap' },
      { titulo: 'Vacaciones', valor: f => f.vacaciones, clase: 'whitespace-nowrap tabular-nums text-right',
        pinta: v => (v == null ? '' : `${esc(String(v).replace('.', ','))} días`) },
      { titulo: 'Neto', valor: f => f.neto, clase: 'whitespace-nowrap tabular-nums text-right',
        ayuda: 'Variables pendientes menos lo que debe en Recaudación. Sin salario base ni indemnización.',
        pinta: v => (v == null ? '' : `<span class="${v < 0 ? 'text-telecab-red' : ''}">${esc(euros(v))}</span>`) },
      { titulo: 'Estado', valor: f => est(f).etiqueta, pinta: (v, f) => etiqueta(v, est(f).tono) },
    ],

    detalle: {
      origen: id => `/finiquitos/api/finiquito/${encodeURIComponent(id)}`,
      titulo: d => `Finiquito de ${d.nombre}`,
      subtitulo: d => `${contrato(d)} · baja el ${dmy(d.fecha_baja)} · para ${(d.resumen || {}).destino || ''}`,
      acciones: [
        { texto: 'Ver el PDF', icono: 'fa-file-pdf', onClick: d => window.open(`/finiquitos/api/finiquito/${encodeURIComponent(d.id)}/pdf`, '_blank', 'noopener') },
        { texto: 'Revisado', icono: 'fa-check', principal: true, visible: d => REVISA && d.estado === 'borrador', onClick: (d, l) => revisar(d, l) },
        { texto: 'Aprobar', icono: 'fa-stamp', principal: true, visible: d => APRUEBA && d.estado === 'revisado', onClick: (d, l) => aprobar(d, l) },
        { texto: 'Devolver a revisión', icono: 'fa-rotate-left', visible: d => APRUEBA && d.estado === 'revisado', onClick: (d, l) => conNota(d, l, 'devolver') },
        { texto: 'Recalcular', icono: 'fa-rotate', visible: d => REVISA && ['borrador', 'revisado'].includes(d.estado), onClick: (d, l) => recalcular(d, l) },
        { texto: 'Mandarlo otra vez', icono: 'fa-paper-plane', visible: d => (REVISA || APRUEBA) && d.estado === 'aprobado', onClick: (d, l) => enviar(d, l, false) },
        { texto: 'Lo mandé a mano', icono: 'fa-envelope-circle-check', visible: d => (REVISA || APRUEBA) && d.estado === 'aprobado', onClick: (d, l) => enviar(d, l, true) },
        { texto: 'Firmado', icono: 'fa-signature', visible: d => REVISA && ['aprobado', 'enviado'].includes(d.estado), onClick: (d, l) => accion(d, l, 'firmado', {}, 'Firmado') },
        { texto: 'Anular', icono: 'fa-ban', visible: d => REVISA && !['firmado', 'anulado'].includes(d.estado), onClick: (d, l) => conNota(d, l, 'anular') },
      ],
      bloques: [
        { titulo: 'Quién se va', icono: 'fa-user', campos: [
          { etiqueta: 'Nombre (Seguridad Social)', valor: d => (d.resumen.persona || {}).nombreSs || d.nombre },
          { etiqueta: 'DNI / NIE', valor: d => d.dni_nie || '—' },
          { etiqueta: 'Legajo', valor: d => d.legajo || '—' },
          { etiqueta: 'Contrato', valor: contrato },
          { etiqueta: 'Alta', valor: d => dmy((d.resumen.persona || {}).alta) },
          { etiqueta: 'Baja', valor: d => dmy(d.fecha_baja) },
          { etiqueta: 'Motivo de la baja', valor: d => (d.resumen.persona || {}).motivoBaja || '—', ancho: 'sm:col-span-2' },
          { etiqueta: 'Su ficha', html: true, valor: d => `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">Abrir en Plantilla</a>` },
        ] },
        { titulo: 'Resumen de cierre', icono: 'fa-list-check', pinta: (d, hueco) => {
          hueco.className = 'divide-y divide-telecab-border';
          hueco.innerHTML = (d.resumen.conceptos || []).map(c => `
            <div class="px-5 py-3">
              <div class="flex items-baseline justify-between gap-3"><p class="font-semibold">${esc(c.titulo)}</p><p>${cifra(c)}</p></div>
              ${c.error ? `<p class="text-xs text-telecab-red mt-1">${esc(c.error)}</p>` : ''}
              <ul class="mt-1 space-y-0.5 text-xs text-telecab-muted">${(c.soporte || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
            </div>`).join('') + (() => {
            const t = d.resumen.totales || {};
            return `<div class="px-5 py-3 bg-telecab-card2 grid grid-cols-3 gap-3 text-sm">
              <div><p class="text-xs text-telecab-muted">A su favor</p><b class="tabular-nums text-telecab-green">${esc(euros(t.aFavor))}</b></div>
              <div><p class="text-xs text-telecab-muted">A descontar</p><b class="tabular-nums text-telecab-red">${esc(euros(-(t.aDescontar || 0)))}</b></div>
              <div><p class="text-xs text-telecab-muted">Neto</p><b class="tabular-nums">${esc(euros(t.neto))}</b></div></div>`;
          })();
        } },
        { titulo: 'Trazabilidad', icono: 'fa-clock-rotate-left', campos: [
          { etiqueta: 'Estado', html: true, valor: d => etiqueta(est(d).etiqueta, est(d).tono) },
          { etiqueta: 'Calculado', valor: d => d.calculado },
          { etiqueta: 'Revisado', valor: d => quien(d.revisado, d.revisado_por_nombre) },
          { etiqueta: 'Aprobado', valor: d => quien(d.aprobado, d.aprobado_por_nombre) },
          { etiqueta: 'Enviado', valor: d => (d.enviado ? `${quien(d.enviado, d.enviado_por_nombre)} · a ${d.enviado_a || ''}` : (d.envio_nota || 'Pendiente')) },
          { etiqueta: 'Firmado', valor: d => quien(d.firmado, d.firmado_por_nombre) },
          { etiqueta: 'Nota', valor: d => d.nota || '—', ancho: 'sm:col-span-2' },
        ] },
        { titulo: 'Firmado', icono: 'fa-signature', visible: d => ['aprobado', 'enviado', 'firmado'].includes(d.estado), pinta: (d, hueco) => {
          hueco.className = '';
          Adjuntos.montar(hueco, { tipo: 'finiquito', dueno: d.id, titulo: 'El finiquito firmado', puedeAdjuntar: REVISA, puedeQuitar: REVISA });
        } },
      ],
    },
  });

  async function accion(d, lst, que, cuerpo, hecho) {
    const r = await Api.post(`/finiquitos/api/finiquito/${encodeURIComponent(d.id)}/${que}`, cuerpo || {}, { aviso: 'No se ha podido hacer', bloquea: true });
    if (!r) return null;
    if (hecho) Dialogo.hecho(typeof hecho === 'function' ? hecho(r) : hecho);
    await lst.recargar();
    return r;
  }

  async function revisar(d, lst) {
    const v = await Dialogo.formulario('Dar por revisado', [{ id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 }],
      { textoBoton: 'Revisado', nota: 'Pasa a «por aprobar» y le llega la tarjeta a quien lo aprueba.' });
    if (v) await accion(d, lst, 'revisar', { nota: v.nota }, 'Revisado');
  }

  async function aprobar(d, lst) {
    const ok = await Dialogo.confirmar({ titulo: 'Aprobar el finiquito', si: 'Aprobar', no: 'Cancelar',
      texto: `Se guarda el PDF en sus documentos y se manda solo a ${(d.resumen || {}).destino || 'su destino'} con el Excel de las variables. Después ya no se recalcula.` });
    if (!ok) return;
    await accion(d, lst, 'aprobar', {}, r => (r.aviso && r.aviso.enviado ? `Aprobado y enviado a ${r.aviso.a}` : `Aprobado. Sin enviar: ${(r.aviso || {}).motivo || ''}`));
  }

  async function enviar(d, lst, aMano) {
    if (!aMano) return accion(d, lst, 'enviar', {}, r => (r.aviso && r.aviso.enviado ? `Enviado a ${r.aviso.a}` : `Sin enviar: ${(r.aviso || {}).motivo || ''}`));
    const v = await Dialogo.formulario('Lo mandé a mano', [
      { id: 'a', etiqueta: 'A quién', tipo: 'texto', obligatorio: true, max: 120 },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: 'Marcar enviado', nota: 'El PDF está en «Ver el PDF» y en sus documentos.' });
    if (v) await accion(d, lst, 'enviar', { aMano: true, a: v.a, nota: v.nota }, 'Marcado enviado');
  }

  async function recalcular(d, lst) {
    const r = await Api.post('/finiquitos/api/preparar', { conductorId: d.conductor_id, fechaBaja: d.fecha_baja }, { aviso: 'No se ha podido recalcular', bloquea: true });
    if (!r) return;
    Dialogo.hecho('Recalculado: vuelve a «por revisar»');
    await lst.recargar();
  }

  async function conNota(d, lst, que) {
    const v = await Dialogo.formulario(que === 'anular' ? 'Anular el finiquito' : 'Devolver a revisión', [
      { id: 'nota', etiqueta: que === 'anular' ? 'Por qué se anula' : 'Qué hay que mirar', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000 },
    ], { textoBoton: que === 'anular' ? 'Anular' : 'Devolver' });
    if (v) await accion(d, lst, que, { nota: v.nota }, que === 'anular' ? 'Anulado' : 'Devuelto a revisión');
  }
})();
