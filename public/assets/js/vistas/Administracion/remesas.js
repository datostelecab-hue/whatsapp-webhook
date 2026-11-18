// La pestaña «Remesas» de Recaudación (db/266, 18/11/2026).
//
// Camilo: «Vamos a sacar las funcionalidades de este excel y agregarlo a
// recaudación en un apartado llamado "Remesas"». Una remesa es un gasto que
// pagó el conductor y se le devuelve. Sus estados, editables todos: pendiente
// de aprobación, pendiente de pago, pagado con efectivo de BOLT (baja lo que
// debe entregar), pagado en nómina y pagado en su cuenta. Las reglas son del
// servidor (modules/Administracion/remesas.service.js); aquí se pintan.
//
// También las pestañas de la pantalla: «Efectivo» (lo de siempre) y «Remesas».
//
// EL COMPROBANTE DE PAGO, SÍ O SÍ (18/11/2026). Camilo: «obligatoriamente debe
// de haber un comprobante de pago, puede ser en cualquier formato». Al apuntarla
// se elige el fichero (o varios) en el formulario; se suben a un borrador y la
// remesa se apunta con él. Las que no lo tienen (las del Excel) salen en rojo, y
// en su ficha se sube.
(function (global) {
  'use strict';
  const esc = Casa.esc;
  const DATOS = Casa.datos();
  const BASE = DATOS.base || '/recaudacion';
  const API = `${BASE}/api/remesas`;
  const $ = s => document.querySelector(s);
  const eur = v => (v == null ? '—' : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const dia = f => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
  const TONO = {
    pendiente_aprobacion: 'tc-pastilla--aviso', pendiente_pago: 'tc-pastilla--azul',
    efectivo_bolt: 'tc-pastilla--verde', nomina: 'tc-pastilla--verde', cuenta: 'tc-pastilla--verde',
  };
  const pastilla = f => `<span class="tc-pastilla ${TONO[f.estado] || ''}">${esc(f.estadoTexto)}</span>`;
  const sinComprobante = '<span class="tc-pastilla tc-pastilla--rojo" title="Súbelo en su ficha: sin él no se le puede cambiar el estado">sin comprobante</span>';
  let lst = null, ESTADOS = [], APRUEBA = false, YO = null;

  // ── Las pestañas ───────────────────────────────────────────────────────────
  function verPestana(p) {
    const remesas = p === 'remesas';
    document.querySelectorAll('.r-pestana').forEach(b => {
      const on = b.dataset.rPestana === p;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.className = 'r-pestana flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition ' +
        (on ? 'bg-telecab-gold text-telecab-dark shadow-gold'
          : 'bg-telecab-card border border-telecab-border text-telecab-muted hover:border-telecab-gold/40 hover:text-telecab-text');
    });
    $('#v-efectivo').classList.toggle('hidden', remesas);
    $('#v-remesas').classList.toggle('hidden', !remesas);
    // Los botones de arriba son del efectivo.
    const acc = $('#r-acciones');
    if (acc) acc.classList.toggle('hidden', remesas);
    try {
      const q = new URLSearchParams(location.search);
      if (remesas) q.set('vista', 'remesas'); else q.delete('vista');
      history.replaceState(history.state, '', location.pathname + (q.toString() ? `?${q}` : ''));
    } catch (_) { /* nada */ }
    if (remesas) montar();
  }
  document.querySelectorAll('.r-pestana').forEach(b => b.addEventListener('click', () => verPestana(b.dataset.rPestana)));
  verPestana(new URLSearchParams(location.search).get('vista') === 'remesas' ? 'remesas' : 'efectivo');

  // ── La lista ───────────────────────────────────────────────────────────────
  async function montar() {
    if (lst) { lst.recargar(); return; }
    let primero;
    try { primero = await Api.get(API); } catch (e) {
      $('#rm-lista').innerHTML = `<p class="p-6 text-sm text-telecab-red">No se han podido leer las remesas: ${esc(e.message)}</p>`;
      return;
    }
    if (primero.sinMigracion) {
      $('#rm-lista').innerHTML = '<p class="p-6 text-sm text-telecab-warn">Para las remesas falta aplicar la migración db/266 en /migraciones.</p>';
      return;
    }
    ESTADOS = primero.estados || [];
    APRUEBA = !!primero.puedeAprobar;
    YO = primero.yo || null;
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()).slice(0, 7);
    const suma = xs => xs.reduce((s, f) => s + f.importe, 0);
    lst = Listado.montar({
      raiz: '#rm-lista',
      titulo: 'Remesas',
      icono: 'fa-receipt',
      clave: 'id',
      url: false,
      origen: API,
      vacio: 'Todavía no hay remesas.',
      buscar: { texto: 'Conductor, concepto o ticket…', campos: ['conductor', 'beneficiario', 'concepto', 'numeroDocumento', 'cif'] },
      subtitulo: () => 'Los gastos que pagó el conductor y se le devuelven. Pagada con su efectivo de BOLT, baja lo que tiene que entregar.',
      kpisDeLoVisible: true,
      kpis: filas => {
        const por = e => filas.filter(f => f.estado === e);
        const pagadas = filas.filter(f => ['efectivo_bolt', 'nomina', 'cuenta'].includes(f.estado));
        return [
          { etiqueta: 'Por aprobar', valor: por('pendiente_aprobacion').length, tono: por('pendiente_aprobacion').length ? 'warn' : 'muted',
            pie: eur(suma(por('pendiente_aprobacion'))), filtro: { id: 'estado', valor: 'pendiente_aprobacion' } },
          { etiqueta: 'Pendiente de pago', valor: eur(suma(por('pendiente_pago'))), tono: 'azul',
            pie: `${por('pendiente_pago').length} ${por('pendiente_pago').length === 1 ? 'remesa' : 'remesas'}`, filtro: { id: 'estado', valor: 'pendiente_pago' } },
          { etiqueta: 'Pagado este mes', valor: eur(suma(pagadas.filter(f => (f.fecha || '').startsWith(mes)))), tono: 'green',
            pie: 'con efectivo, en nómina o en su cuenta' },
          { etiqueta: 'Con su efectivo de BOLT', valor: eur(suma(por('efectivo_bolt'))), tono: 'muted',
            pie: 'lo que se descontó de lo que entregan', filtro: { id: 'estado', valor: 'efectivo_bolt' } },
          { etiqueta: 'Sin comprobante', valor: filas.filter(f => !f.comprobantes).length, tono: filas.some(f => !f.comprobantes) ? 'red' : 'muted',
            pie: 'súbelo en su ficha', filtro: { id: 'comprobante', valor: 'sin' } },
        ];
      },
      filtros: [{
        id: 'estado', etiqueta: 'Estado', textoTodos: 'Todos los estados',
        opciones: filas => ESTADOS.map(e => ({ valor: e.codigo, texto: e.etiqueta, cuenta: filas.filter(f => f.estado === e.codigo).length })).filter(o => o.cuenta),
        pasa: (f, v) => f.estado === v,
      }, {
        id: 'sin', etiqueta: 'Conductor', textoTodos: 'Con y sin conductor',
        opciones: filas => [{ valor: 'sin', texto: 'Sin conductor (del Excel)', cuenta: filas.filter(f => !f.conductorId).length }].filter(o => o.cuenta),
        pasa: f => !f.conductorId,
      }, {
        id: 'comprobante', etiqueta: 'Comprobante', textoTodos: 'Con y sin comprobante',
        opciones: filas => [{ valor: 'sin', texto: 'Sin comprobante de pago', cuenta: filas.filter(f => !f.comprobantes).length }].filter(o => o.cuenta),
        pasa: f => !f.comprobantes,
      }],
      claseFila: f => (f.estado === 'pendiente_aprobacion' ? 'bg-telecab-warn/5' : ''),
      columnas: [
        { titulo: 'Fecha', campo: 'fecha', clase: 'whitespace-nowrap tabular-nums', pinta: v => dia(v) },
        { titulo: 'Conductor', campo: 'conductor', valor: f => f.conductor || f.beneficiario,
          pinta: (v, f) => (f.conductorId ? `<span class="font-semibold">${esc(f.conductor)}</span>`
            : `<span class="font-semibold">${esc(f.beneficiario)}</span> <span class="tc-pastilla tc-pastilla--rojo" title="Del Excel: no se supo de qué conductor es. Ábrela y elígelo">sin conductor</span>`) },
        { titulo: 'Concepto', campo: 'concepto', valor: f => f.concepto,
          pinta: (v, f) => `${esc(f.concepto || '—')}${f.numeroDocumento || f.fechaDocumento
            ? `<span class="block text-[11px] text-telecab-muted">${esc([f.fechaDocumento ? `ticket del ${dia(f.fechaDocumento)}` : '', f.numeroDocumento ? `nº ${f.numeroDocumento}` : '', f.cif].filter(Boolean).join(' · '))}</span>` : ''}` },
        { titulo: 'Importe', campo: 'importe', clase: 'text-right tabular-nums whitespace-nowrap', pinta: v => `<b>${eur(v)}</b>` },
        { titulo: 'Estado', campo: 'estado', valor: f => f.estadoTexto,
          pinta: (v, f) => `<span class="inline-flex flex-wrap gap-1">${pastilla(f)}${f.comprobantes ? '' : sinComprobante}</span>` },
      ],
      acciones: [
        { texto: 'Nueva remesa', icono: 'fa-plus', onClick: () => nueva() },
        ...(APRUEBA ? [{ texto: 'Importar el Excel', icono: 'fa-file-import', principal: false,
          ayuda: 'Una sola vez: las remesas que llevabais en el Excel «Remesas Conductores»', onClick: () => importar() }] : []),
      ],
      alAbrir: f => abrir(f),
    });
  }
  const recargar = () => { if (lst) lst.recargar(); };

  // ── Los formularios ────────────────────────────────────────────────────────
  let CONDUCTORES = null;
  async function conductores() {
    if (!CONDUCTORES) CONDUCTORES = (await Api.get(`${API}/conductores`)).conductores;
    return CONDUCTORES;
  }
  const opcionesConductor = cs => cs.map(c => ({
    valor: String(c.id),
    texto: `${c.nombre}${c.pendiente > 0.005 ? ` · tiene ${eur(c.pendiente)} por entregar` : ''}${c.vigente ? '' : ' · ya no está'}`,
  }));
  const camposDatos = (f = {}) => [
    { id: 'importe', etiqueta: 'Importe (€)', obligatorio: true, valor: f.importe != null ? String(f.importe).replace('.', ',') : '', marcador: 'p. ej. 24,50' },
    { id: 'concepto', etiqueta: 'Qué pagó', obligatorio: true, valor: f.concepto || '', marcador: 'Combustible, ITV, lavado, parking, peaje…' },
    { id: 'fechaDocumento', etiqueta: 'Fecha del ticket', tipo: 'fecha', valor: f.fechaDocumento ? dia(f.fechaDocumento) : '' },
    { id: 'numeroDocumento', etiqueta: 'Nº del ticket o factura', valor: f.numeroDocumento || '' },
    { id: 'cif', etiqueta: 'CIF de quien lo cobró', valor: f.cif || '' },
    { id: 'iban', etiqueta: 'IBAN (solo si se le paga en su cuenta)', valor: '',
      marcador: f.iban ? `guardado: ${f.iban} (déjalo vacío para no cambiarlo)` : 'si no se pone, el de su ficha', ayuda: 'Se guarda cifrado' },
    { id: 'notas', etiqueta: 'Notas', tipo: 'texto-largo', max: 1000, valor: f.notas || '' },
  ];

  async function nueva() {
    let cs;
    try { cs = await conductores(); } catch (e) { Dialogo.aviso({ titulo: 'No se puede', texto: e.message, tono: 'error' }); return; }
    const campos = [
      { id: 'conductorId', etiqueta: 'Conductor', tipo: 'lista', obligatorio: true, opciones: opcionesConductor(cs) },
      { id: 'comprobante', etiqueta: 'Comprobante de pago', tipo: 'ficheros', obligatorio: true,
        ayuda: 'El ticket o la factura de lo que pagó: foto, PDF o el formato que sea. Sin él no se apunta.' },
      ...camposDatos(),
    ];
    if (APRUEBA) {
      campos.push({ id: 'estado', etiqueta: 'Estado', tipo: 'lista', obligatorio: true, valor: 'auto',
        opciones: [{ valor: 'auto', texto: 'El que toque: con su efectivo si tiene por entregar; si no, pendiente de pago' },
          ...ESTADOS.map(e => ({ valor: e.codigo, texto: e.etiqueta }))] });
    }
    const v = await Dialogo.formulario('Nueva remesa', campos, {
      textoBoton: 'Apuntar',
      nota: APRUEBA ? 'Pagada con su efectivo de BOLT, baja lo que tiene que entregar en la recaudación.'
        : 'Queda pendiente de aprobación: la aprueba quien tiene esa llave.',
    });
    if (!v) return;
    // El comprobante, primero: a un borrador mío. Si no sube, no se apunta nada.
    const borrador = nuevoBorrador();
    const ficheros = v.comprobante || [];
    delete v.comprobante;
    try {
      for (const [i, fichero] of ficheros.entries()) {
        Dialogo.hecho(ficheros.length > 1 ? `Subiendo el comprobante (${i + 1} de ${ficheros.length})…` : 'Subiendo el comprobante…', { tono: 'info', segundos: 2 });
        await Adjuntos.subir({ tipo: 'remesa_borrador', dueno: borrador, fichero });
      }
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se ha subido el comprobante', texto: `${e.message} La remesa no se ha apuntado.`, tono: 'error' });
      return;
    }
    const r = await Api.post(API, { ...v, iban: v.iban || undefined, borrador }, { aviso: 'No se ha podido apuntar' });
    if (!r) return;
    Dialogo.hecho(`Remesa apuntada · ${(ESTADOS.find(e => e.codigo === r.estado) || {}).etiqueta || ''}`);
    recargar();
  }

  /** «<mi id>-<al azar>»: donde se sube el comprobante antes de apuntar la remesa. */
  function nuevoBorrador() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return `${YO}-${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  }

  async function editar(f) {
    let cs;
    try { cs = await conductores(); } catch (e) { Dialogo.aviso({ titulo: 'No se puede', texto: e.message, tono: 'error' }); return; }
    const v = await Dialogo.formulario(`Remesa nº ${f.id}`, [
      { id: 'conductorId', etiqueta: 'Conductor', tipo: 'lista', obligatorio: true, valor: f.conductorId ? String(f.conductorId) : '', opciones: opcionesConductor(cs) },
      { id: 'fecha', etiqueta: 'Fecha de la remesa', tipo: 'fecha', obligatorio: true, valor: dia(f.fecha) },
      ...camposDatos(f),
    ], { textoBoton: 'Guardar', nota: f.conMovimiento ? 'Si cambias el importe o el conductor, el descuento en la recaudación se rehace.' : '' });
    if (!v) return;
    const datos = { ...v };
    if (!v.iban) delete datos.iban;          // vacío: no se toca el que tenga
    const r = await Api.post(`${API}/${f.id}`, datos, { aviso: 'No se ha podido guardar' });
    if (!r) return;
    Dialogo.hecho('Guardada');
    cerrarPanel();
    recargar();
  }

  async function cambiarEstado(f) {
    const deAprobacion = f.estado === 'pendiente_aprobacion';
    const opciones = ESTADOS.filter(e => APRUEBA || (e.codigo !== 'pendiente_aprobacion' && !deAprobacion))
      .map(e => ({ valor: e.codigo, texto: e.etiqueta }));
    if (!opciones.length) { Dialogo.aviso({ titulo: 'Espera aprobación', texto: 'La aprueba quien tiene la llave de aprobar remesas.' }); return; }
    // Al aprobarla, lo que se propone: con su efectivo si tiene por entregar («sí o sí»).
    const propuesto = deAprobacion ? (f.pendienteConductor > 0.005 ? 'efectivo_bolt' : 'pendiente_pago') : f.estado;
    const v = await Dialogo.formulario(deAprobacion ? `Aprobar la remesa nº ${f.id}` : `Estado de la remesa nº ${f.id}`, [
      { id: 'estado', etiqueta: 'Estado', tipo: 'lista', obligatorio: true, valor: propuesto, opciones },
      { id: 'nota', etiqueta: 'Nota (si hace falta)', tipo: 'texto-largo', max: 300 },
    ], {
      textoBoton: deAprobacion ? 'Aprobar' : 'Cambiar',
      nota: f.conductorId
        ? (f.pendienteConductor > 0.005 ? `${f.conductor} tiene ${eur(f.pendienteConductor)} por entregar: pagarla con su efectivo de BOLT se lo baja en ${eur(f.importe)}.`
          : `${f.conductor} no tiene efectivo por entregar.`)
        : 'Sin conductor no se puede pagar con su efectivo: elígelo antes en «Editar».',
    });
    if (!v) return;
    const r = await Api.post(`${API}/${f.id}/estado`, v, { aviso: 'No se ha podido cambiar' });
    if (!r) return;
    Dialogo.hecho((ESTADOS.find(e => e.codigo === r.estado) || {}).etiqueta || 'Hecho');
    cerrarPanel();
    recargar();
  }

  async function anular(f) {
    const v = await Dialogo.formulario(`Anular la remesa nº ${f.id}`, [
      { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 500 },
    ], { textoBoton: 'Anularla', nota: f.conMovimiento ? 'También se anula su descuento en la recaudación: volverá a deber ese dinero.' : '' });
    if (!v) return;
    const r = await Api.post(`${API}/${f.id}/anular`, v, { aviso: 'No se ha podido anular' });
    if (!r) return;
    Dialogo.hecho('Anulada');
    cerrarPanel();
    recargar();
  }

  async function verIban(f, boton) {
    const r = await Api.get(`${API}/${f.id}/iban`).catch(e => ({ error: e }));
    if (r.error) { Dialogo.aviso({ titulo: 'No se puede', texto: r.error.message, tono: 'error' }); return; }
    boton.outerHTML = `<span class="font-mono tabular-nums select-all">${esc((r.iban || '—').replace(/(.{4})/g, '$1 ').trim())}</span>${r.deLaFicha ? ' <span class="text-[11px] text-telecab-muted">(de su ficha)</span>' : ''}`;
  }

  // ── La ficha, en el Panel ──────────────────────────────────────────────────
  function cerrarPanel() { const a = Panel.abierto(); if (a) a.cerrar(); }
  function abrir(f) {
    const fila = (etq, v) => (v ? `<div class="flex justify-between gap-4 py-1.5 border-b border-telecab-border/50"><span class="text-telecab-muted">${esc(etq)}</span><span class="text-right">${v}</span></div>` : '');
    const ibanTxt = f.iban || f.ibanDeLaFicha;
    const p = Panel.abrir({
      titulo: `${eur(f.importe)} · ${f.conductor || f.beneficiario}`,
      subtitulo: `Remesa nº ${f.id} · ${f.concepto || ''}`,
      html: `<div class="flex flex-wrap items-center gap-2 mb-3">${pastilla(f)}${f.comprobantes ? '' : sinComprobante}${f.conMovimiento ? '<span class="text-xs text-telecab-muted">descontada de lo que entrega</span>' : ''}</div>
        ${f.comprobantes ? '' : `<p class="mb-3 rounded-xl border border-telecab-red/40 bg-telecab-red/5 px-3 py-2 text-sm">Falta el comprobante de pago. Súbelo abajo: sin él no se le puede cambiar el estado.</p>`}
        <div class="text-sm">
          ${fila('Fecha', dia(f.fecha))}
          ${fila('Conductor', f.conductorId ? esc(f.conductor) : `${esc(f.beneficiario)} <span class="tc-pastilla tc-pastilla--rojo">sin conductor</span>`)}
          ${fila('Por entregar ahora', f.conductorId && f.pendienteConductor != null ? eur(f.pendienteConductor) : '')}
          ${fila('Qué pagó', esc(f.concepto))}
          ${fila('Ticket', esc([f.fechaDocumento ? dia(f.fechaDocumento) : '', f.numeroDocumento ? `nº ${f.numeroDocumento}` : ''].filter(Boolean).join(' · ')))}
          ${fila('CIF', esc(f.cif))}
          ${fila('IBAN', ibanTxt ? `<span class="tabular-nums">${esc(ibanTxt)}</span>${f.ibanDeLaFicha ? ' <span class="text-[11px] text-telecab-muted">(de su ficha)</span>' : ''}${APRUEBA ? ' <button type="button" class="tc-boton tc-boton--chico ml-1" data-ver-iban>Ver entero</button>' : ''}` : '')}
          ${fila('Notas', esc(f.notas))}
          ${fila('Apuntada', esc([f.creadoPor, f.importada ? 'del Excel' : ''].filter(Boolean).join(' · ')))}
          ${fila('Aprobada por', esc(f.aprobadaPor || ''))}
        </div>
        <div class="flex flex-wrap justify-end gap-2 mt-4">
          ${f.puedeTocar ? '<button type="button" class="tc-boton tc-boton--chico" data-editar><i class="fa-solid fa-pen" aria-hidden="true"></i>Editar</button>' : ''}
          ${f.puedeTocar || APRUEBA ? `<button type="button" class="tc-boton tc-boton--chico tc-boton--principal" data-estado><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>${f.estado === 'pendiente_aprobacion' && APRUEBA ? 'Aprobar' : 'Cambiar estado'}</button>` : ''}
          ${APRUEBA || f.estado === 'pendiente_aprobacion' ? '<button type="button" class="tc-boton tc-boton--chico tc-boton--peligro" data-anular>Anular</button>' : ''}
        </div>
        <div class="mt-4" data-comprobante></div>`,
    });
    // El comprobante de pago: verlo, subir otro, quitar uno que sobre (el último no).
    let tenia = f.comprobantes;
    Adjuntos.montar(p.cuerpo.querySelector('[data-comprobante]'), {
      tipo: 'remesa', dueno: f.id, titulo: 'Comprobante de pago', puedeAdjuntar: f.puedeTocar, puedeQuitar: f.puedeTocar,
      alCambiar: lista => { if ((lista.length > 0) !== (tenia > 0)) recargar(); tenia = lista.length; f.comprobantes = lista.length; },
    });
    const en = (sel, fn) => { const b = p.cuerpo.querySelector(sel); if (b) b.addEventListener('click', () => fn(f, b)); };
    en('[data-editar]', editar);
    en('[data-estado]', cambiarEstado);
    en('[data-anular]', anular);
    en('[data-ver-iban]', verIban);
  }

  // ── Importar el Excel, una vez ────────────────────────────────────────────
  function importar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const base64 = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => ko(new Error('No se pudo leer el fichero')); fr.readAsDataURL(file); });
      const previa = await Api.post(`${API}/importar`, { base64, confirmar: false }, { aviso: 'No se ha podido leer el Excel' });
      if (!previa) return;
      const r = previa.resumen;
      const lista = (t, xs) => (xs.length ? `<p class="text-sm mt-3 font-semibold">${esc(t)} (${xs.length})</p><div class="mt-1 max-h-32 overflow-y-auto text-xs text-telecab-muted">${xs.map(esc).join('<br>')}</div>` : '');
      if (!r.nuevas) { Dialogo.aviso({ titulo: 'Nada nuevo', texto: `Las ${r.leidas} remesas del Excel ya estaban.` }); return; }
      const ok = await Dialogo.confirmar({
        titulo: `Importar ${r.nuevas} remesas (${r.importe} €)`, si: `Importar ${r.nuevas}`, no: 'Cancelar', ancho: 'max-w-xl',
        html: `<p class="text-sm">De la hoja «Remesas». Entran con su estado y <b>sin tocar la recaudación</b>: lo del Excel ya se saldó en su día.</p>
          <p class="text-sm mt-2">${r.porEstado.map(x => `${esc(x.estado)}: <b>${x.n}</b>`).join(' · ')}</p>
          ${r.yaEstaban ? `<p class="text-sm mt-2 text-telecab-muted">${r.yaEstaban} ya estaban: no se repiten.</p>` : ''}
          ${lista('No sé de qué conductor son: entran sin él y se lo pones después', r.sinConductor)}`,
      });
      if (!ok) return;
      const hecho = await Api.post(`${API}/importar`, { base64, confirmar: true }, { aviso: 'No se ha podido importar' });
      if (!hecho) return;
      Dialogo.hecho(`${hecho.resumen.nuevas} remesas importadas`);
      recargar();
    });
    input.click();
  }

  global.Remesas = { montar, verPestana };
})(window);
