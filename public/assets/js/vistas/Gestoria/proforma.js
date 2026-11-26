// modules/Gestoria/vistas/gestoria.ejs — la pestaña «Proforma» (módulo 4, db/296, 25/11/2026).
//
// La nómina del mes que calcula A3 antes de las variables, cruzada con el ERP:
// lo que no cuadra, caso a caso. Cada uno se marca (corregir en A3, corregir
// en el ERP o está bien) y con los de A3 se prepara el correo a la gestoría.
// Avisa, no frena. Monta también las dos pestañas de la pantalla.

(function () {
  const PUEDE = !!Casa.datos().puedeGestionar;
  const { esc, etiqueta } = Listado.fmt;
  let TIPOS = {}, DECISIONES = {}, MESES = [], PERIODOS = [];
  const $ = s => document.querySelector(s);
  const tipo = f => TIPOS[f.tipo] || { etiqueta: f.tipo, tono: 'muted' };
  const dec = f => DECISIONES[f.decision] || { etiqueta: f.decision, tono: 'muted' };
  const euros = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  let lista = null;

  Pestanas.montar($('#gs-pestanas'), {
    pestanas: [
      { id: 'plantilla', texto: 'Plantilla', icono: 'fa-users', contador: 'gestoria.pendientes' },
      { id: 'altas', texto: 'Altas', icono: 'fa-id-card', contador: 'gestoria.altas' },
      { id: 'proforma', texto: 'Proforma', icono: 'fa-file-invoice-dollar', contador: 'gestoria.proforma' },
      { id: 'variables', texto: 'Variables', icono: 'fa-table-list' },
      { id: 'cierre', texto: 'Cierre del mes', icono: 'fa-flag-checkered', contador: 'gestoria.cierre' },
    ],
    param: 'vista',
    alCambiar: id => {
      $('#gs-plantilla').classList.toggle('hidden', id !== 'plantilla');
      $('#gs-altas').classList.toggle('hidden', id !== 'altas');
      $('#gs-proforma').classList.toggle('hidden', id !== 'proforma');
      $('#gs-cierre').classList.toggle('hidden', id !== 'cierre');
      $('#gs-variables').classList.toggle('hidden', id !== 'variables');
      if (id === 'variables' && window.GestoriaVariables) window.GestoriaVariables.abrir();
      if (id === 'proforma' && !lista) montar();
      // El cierre lo monta su propio fichero (cierre.js), al abrir su pestaña.
      if (id === 'cierre' && window.GestoriaCierre) window.GestoriaCierre.abrir();
      // Las altas, su propio fichero (altas.js), que se monta solo si se entra ya en su pestaña.
      if (id === 'altas' && window.GestoriaAltas) window.GestoriaAltas.abrir();
    },
  });

  function montar() {
    lista = Listado.montar({
      raiz: '#gs-proforma',
      titulo: 'Proforma de la gestoría',
      icono: 'fa-file-invoice-dollar',
      clave: 'id',
      origen: '/gestoria/api/proforma/lista',
      vacio: 'No hay casos que coincidan.',
      filtrosIniciales: { decision: 'pendiente' },
      buscar: { texto: 'Buscar persona o código…', campos: ['nombre_erp', 'nombre_a3', 'legajo'] },

      subtitulo: (v, t) => (v.length === t.length ? `${t.length} casos` : `${v.length} de ${t.length} casos`),

      cifras: (filas, extra) => {
        if (extra && extra.tipos) TIPOS = extra.tipos;
        if (extra && extra.decisiones) DECISIONES = extra.decisiones;
        MESES = [...new Set(filas.map(f => f.mes))];
        PERIODOS = [...new Map(filas.map(f => [f.periodo, { periodo: f.periodo, mes: f.mes }])).values()];
        const pend = filas.filter(f => f.decision === 'pendiente');
        const sinMandar = filas.filter(f => f.decision === 'a3' && !f.enviada).length;
        return [
          { valor: pend.length, etiqueta: 'por decidir', tono: 'warn', filtro: { id: 'decision', valor: 'pendiente' } },
          { valor: sinMandar, etiqueta: 'para la gestoría, sin mandar', tono: sinMandar ? 'red' : undefined, filtro: { id: 'decision', valor: 'a3' } },
          { valor: pend.filter(f => ['baja_medica', 'it_sin_baja', 'suspension', 'sin_contrato'].includes(f.tipo)).length, etiqueta: 'bajas, suspensiones y sin contrato',
            tono: 'red', ayuda: 'Los que más pesan en la nómina: se paga o se cotiza de más (o de menos).' },
        ];
      },

      nota: (filas, extra) => {
        const c = extra && extra.cargas && extra.cargas[0];
        const r = c && c.resultado;
        return [
          ...(extra && extra.sinTabla ? [{ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/296 en Migraciones.' }] : []),
          ...(r ? [{ icono: 'fa-file-excel', texto: `Última proforma: ${r.mes} (${c.nombre}), ${r.trabajadores} trabajadores · bruto ${euros(r.totales && r.totales.bruto)} · líquido ${euros(r.totales && r.totales.liquido)}.` }] : []),
          { icono: 'fa-circle-info', texto: 'Lo que no cuadra entre la proforma de A3 y el ERP. Revisarlo no frena nada: si una proforma nueva del mismo mes ya no lo trae, se cierra solo.' },
        ];
      },

      filtros: [
        { id: 'decision', etiqueta: 'Decisión', textoTodos: 'Cualquiera',
          opciones: () => Object.entries(DECISIONES).map(([valor, d]) => ({ valor, texto: d.etiqueta })), campo: 'decision' },
        { id: 'tipo', etiqueta: 'Qué pasa', campo: 'tipo', textoTodos: 'Cualquier caso',
          opciones: () => Object.entries(TIPOS).map(([valor, t]) => ({ valor, texto: t.etiqueta })) },
        { id: 'mes', etiqueta: 'Mes', campo: 'mes', textoTodos: 'Cualquier mes',
          opciones: () => MESES.map(m => ({ valor: m, texto: m })) },
      ],

      acciones: PUEDE ? [
        { texto: 'Subir proforma', icono: 'fa-file-arrow-up', onClick: () => subir() },
        { id: 'pf-decidir', texto: 'Decidir marcados', icono: 'fa-check-double', principal: false, activa: false, onClick: lst => decidirMarcados(lst) },
        { texto: 'Volver a cruzar', icono: 'fa-rotate', principal: false, onClick: () => recruzar() },
        { texto: 'Correo a la gestoría', icono: 'fa-envelope', principal: false, onClick: () => correo() },
      ] : [],
      seleccion: PUEDE,
      alSeleccionar: marcadas => { const b = document.querySelector('[data-accion="pf-decidir"]'); if (b) b.disabled = !marcadas.length; },

      columnas: [
        { titulo: 'Mes', campo: 'mes', clase: 'whitespace-nowrap text-xs' },
        // Un código que el ERP no tiene: manda el nombre de la proforma (el del ERP es solo a quién se parece).
        { titulo: 'Persona', valor: f => (f.tipo === 'legajo' ? f.nombre_a3 || f.nombre_erp : f.nombre_erp || f.nombre_a3) || '—', clase: 'font-semibold',
          pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Código ${esc(f.legajo)}</span>` : '') },
        { titulo: 'Qué pasa', valor: f => tipo(f).etiqueta, pinta: (v, f) => `${etiqueta(v, tipo(f).tono)}<span class="block text-xs mt-0.5">${esc(f.frase)}</span>` },
        { titulo: 'Nota de la proforma', valor: f => (f.detalle && f.detalle.nota) || '', clase: 'text-xs text-telecab-muted' },
        { titulo: 'Decisión', valor: f => dec(f).etiqueta,
          pinta: (v, f) => etiqueta(v, dec(f).tono) + (f.decision === 'a3' ? `<span class="block text-xs text-telecab-muted">${f.enviada ? `Mandado el ${esc(f.enviada)}` : 'Sin mandar'}</span>` : '') },
      ],

      detalle: {
        origen: id => `/gestoria/api/proforma/caso/${encodeURIComponent(id)}`,
        titulo: d => tipo(d).etiqueta,
        subtitulo: d => `${d.nombre_erp || d.nombre_a3 || ''} · ${d.mes}`,
        acciones: [
          { texto: 'Corregir en A3', icono: 'fa-building-columns', principal: true, visible: d => PUEDE && d.decision !== 'a3', onClick: (d, l) => decidir([d.id], 'a3', l) },
          { texto: 'Corregir en el ERP', icono: 'fa-pen-to-square', visible: d => PUEDE && d.decision !== 'erp', onClick: (d, l) => decidir([d.id], 'erp', l) },
          { texto: 'Está bien', icono: 'fa-check', visible: d => PUEDE && d.decision !== 'bien', onClick: (d, l) => decidir([d.id], 'bien', l) },
          { texto: 'Volver a por decidir', icono: 'fa-rotate-left', visible: d => PUEDE && !['pendiente', 'ya_no_sale'].includes(d.decision), onClick: (d, l) => decidir([d.id], 'pendiente', l) },
        ],
        bloques: [
          { titulo: 'El caso', icono: 'fa-file-invoice-dollar', campos: [
            { etiqueta: 'Qué pasa', html: true, valor: d => etiqueta(tipo(d).etiqueta, tipo(d).tono) },
            { etiqueta: 'Detalle', valor: d => d.frase, ancho: 'sm:col-span-2' },
            { etiqueta: 'En la proforma', valor: d => [d.legajo, d.nombre_a3].filter(Boolean).join(' · ') || 'No está' },
            { etiqueta: 'Nota de la proforma', visible: d => !!(d.detalle && d.detalle.nota), valor: d => d.detalle.nota },
            { etiqueta: 'En el ERP', html: true, valor: d => (d.conductor_id
              ? `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">${esc(d.nombre_erp || 'Su ficha')}</a>` : 'Sin ficha') },
            { etiqueta: 'Mes', valor: d => d.mes },
            { etiqueta: 'Decisión', html: true, valor: d => etiqueta(dec(d).etiqueta, dec(d).tono) },
            { etiqueta: 'Decidido', visible: d => !!d.decidido, valor: d => `${d.decidido}${d.decidido_por_nombre ? ` · ${d.decidido_por_nombre}` : ''}` },
            { etiqueta: 'A la gestoría', visible: d => d.decision === 'a3', valor: d => (d.enviada ? `Mandado el ${d.enviada}` : 'Sin mandar') },
            { etiqueta: 'Nota', visible: d => !!d.nota, valor: d => d.nota, ancho: 'sm:col-span-2' },
            { etiqueta: 'Visto en', valor: d => d.ultimo_fichero || '—' },
          ] },
        ],
      },
    });
  }

  async function decidir(ids, decision, lst) {
    const titulo = (DECISIONES[decision] || {}).etiqueta || 'Decidir';
    const v = decision === 'pendiente' ? {} : await Dialogo.formulario(titulo, [
      { id: 'nota', etiqueta: decision === 'a3' ? 'Qué tiene que corregir la gestoría (opcional)' : 'Nota (opcional)', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: titulo, nota: decision === 'a3' ? 'Irá en el correo a la gestoría.' : '' });
    if (!v) return;
    const r = await Api.post('/gestoria/api/proforma/decidir', { ids, decision, nota: v.nota }, { aviso: 'No se ha podido guardar', bloquea: true });
    if (!r) return;
    Dialogo.hecho(`${r.decididos} ${r.decididos === 1 ? 'caso' : 'casos'}: ${titulo.toLowerCase()}`);
    if (lst && lst.limpiarSeleccion) lst.limpiarSeleccion();
    await (lst || lista).recargar();
  }

  async function decidirMarcados(lst) {
    const marcadas = lst.filasSeleccionadas();
    if (!marcadas.length) return Dialogo.aviso({ titulo: 'Nada marcado', texto: 'Marca los casos que quieras decidir.' });
    const v = await Dialogo.formulario(`Decidir ${marcadas.length} ${marcadas.length === 1 ? 'caso' : 'casos'}`, [
      { id: 'decision', etiqueta: 'Qué se hace', tipo: 'lista', obligatorio: true, valor: 'bien',
        opciones: ['a3', 'erp', 'bien'].map(k => ({ valor: k, texto: DECISIONES[k].etiqueta })) },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: 'Guardar' });
    if (!v) return;
    const r = await Api.post('/gestoria/api/proforma/decidir', { ids: marcadas.map(f => f.id), decision: v.decision, nota: v.nota },
      { aviso: 'No se ha podido guardar', bloquea: true });
    if (!r) return;
    Dialogo.hecho(`${r.decididos} casos: ${DECISIONES[v.decision].etiqueta.toLowerCase()}`);
    if (lst.limpiarSeleccion) lst.limpiarSeleccion();
    await lst.recargar();
  }

  async function subir() {
    const v = await Dialogo.formulario('Subir la proforma de A3', [
      { id: 'fichero', etiqueta: 'La proforma', tipo: 'ficheros', multiple: false, obligatorio: true, accept: '.xls,.xlsx',
        ayuda: 'La nómina del mes «sin variables» que manda la gestoría, tal cual llega.' },
    ], { textoBoton: 'Revisar', nota: 'Primero se enseña qué sale. No se apunta nada hasta que lo confirmes.' });
    if (!v || !v.fichero || !v.fichero[0]) return;
    const file = v.fichero[0];
    let base64;
    try {
      base64 = await new Promise((ok, ko) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(',')[1]);
        fr.onerror = () => ko(new Error('No se pudo leer el fichero'));
        fr.readAsDataURL(file);
      });
    } catch (e) { return Dialogo.aviso({ titulo: 'No se pudo leer', texto: e.message, tono: 'error' }); }
    const previa = await Api.post('/gestoria/api/proforma/subir', { base64, nombre: file.name, confirmar: false }, { aviso: 'No se ha podido leer la proforma' });
    if (!previa) return;
    if (previa.yaCargado) {
      return Dialogo.aviso({ titulo: 'Esa proforma ya se subió', tono: 'aviso',
        texto: `Se subió el ${previa.yaCargado.cuando}${previa.yaCargado.por ? ` (${previa.yaCargado.por})` : ''}. El mismo fichero no se sube dos veces.` });
    }
    const r = previa.resumen;
    const html = `
      <p class="text-sm">Proforma de <b>${esc(r.mes)}</b>${r.empresa ? ` · empresa ${esc(r.empresa.codigo)} ${esc(r.empresa.nombre)}` : ''}</p>
      <p class="text-sm mt-1"><b>${r.trabajadores}</b> trabajadores · bruto <b>${esc(euros(r.totales.bruto))}</b> · líquido <b>${esc(euros(r.totales.liquido))}</b> · coste de empresa ${esc(euros(r.totales.costeEmpresa))}</p>
      <ul class="text-sm mt-2 space-y-0.5">${Object.entries(r.porTipo).map(([t, n]) =>
        `<li><b>${n}</b> ${esc((TIPOS[t] || { etiqueta: t }).etiqueta.toLowerCase())}</li>`).join('') || '<li>Todo cuadra.</li>'}</ul>
      <p class="text-xs text-telecab-muted mt-2">Si ya había una proforma de ese mes, lo decidido se conserva y lo que ya no salga se cierra solo.</p>`;
    const ok = await Dialogo.confirmar({ titulo: 'Subir la proforma', html, ancho: 'max-w-xl', si: 'Subirla', no: 'Cancelar' });
    if (!ok) return;
    const hecho = await Api.post('/gestoria/api/proforma/subir', { base64, nombre: file.name, confirmar: true }, { aviso: 'No se ha podido subir', bloquea: true });
    if (!hecho) return;
    Dialogo.hecho(`Proforma subida: ${hecho.nuevos} nuevos, ${hecho.siguen} siguen${hecho.cerrados ? `, ${hecho.cerrados} ya no salen` : ''}`);
    if (lista) await lista.recargar();
  }

  /** La última proforma del mes, cruzada otra vez con el ERP de ahora (después de corregir legajos, bajas…). */
  async function recruzar() {
    if (!MESES.length && !PERIODOS.length) return Dialogo.aviso({ titulo: 'No hay proforma', texto: 'Sube primero una proforma.' });
    const opciones = PERIODOS.map(p => ({ valor: p.periodo, texto: p.mes }));
    const v = await Dialogo.formulario('Volver a cruzar la proforma', [
      { id: 'periodo', etiqueta: 'Mes', tipo: 'lista', obligatorio: true, opciones, valor: opciones[0] && opciones[0].valor },
    ], { textoBoton: 'Cruzar', nota: 'La última proforma subida de ese mes, contra el ERP de ahora. Lo decidido se conserva; lo que ya no salga se cierra solo.' });
    if (!v) return;
    const r = await Api.post('/gestoria/api/proforma/recruzar', { periodo: v.periodo }, { aviso: 'No se ha podido cruzar', bloquea: true });
    if (!r) return;
    Dialogo.hecho(`Cruzada otra vez: ${r.nuevos} nuevos, ${r.siguen} siguen${r.cerrados ? `, ${r.cerrados} ya no salen` : ''}`);
    if (lista) await lista.recargar();
  }

  async function correo() {
    const c = await Api.get('/gestoria/api/proforma/correo').catch(e => { Dialogo.aviso({ titulo: 'No se pudo preparar', texto: e.message, tono: 'error' }); return null; });
    if (!c) return;
    if (!c.ids || !c.ids.length) return Dialogo.aviso({ titulo: 'Nada que mandar', texto: 'No hay ningún caso marcado «Corregir en A3» sin mandar.' });
    const mailto = `mailto:${encodeURIComponent(c.para || '')}?subject=${encodeURIComponent(c.asunto)}&body=${encodeURIComponent(c.cuerpo)}`;
    const html = `
      <p class="text-sm mb-2">${c.para ? `Para <b>${esc(c.para)}</b>.` : 'Sin correo de la gestoría en Parámetros: cópialo y pégalo en tu correo.'}
        ${c.para ? ` <a class="underline" href="${esc(mailto)}">Abrirlo en el correo</a>` : ''}</p>
      <textarea readonly rows="14" aria-label="Texto del correo" class="w-full px-3 py-2 bg-telecab-card2 border border-telecab-border rounded-xl text-xs font-mono">${esc(c.cuerpo)}</textarea>`;
    const r = await Dialogo.abrir({ titulo: `Correo a la gestoría (${c.ids.length})`, html, ancho: 'max-w-2xl', tono: 'info',
      opciones: [{ texto: 'Cerrar', valor: null }, { texto: 'Copiar el texto', valor: 'copiar' }, { texto: 'Ya lo he mandado', valor: 'enviado', principal: true }] });
    if (r === 'copiar') {
      try { await navigator.clipboard.writeText(c.cuerpo); Dialogo.hecho('Texto copiado'); } catch (_) { Dialogo.aviso('No se pudo copiar: selecciónalo y cópialo a mano.'); }
      return;
    }
    if (r !== 'enviado') return;
    const m = await Api.post('/gestoria/api/proforma/correo/enviado', { ids: c.ids }, { aviso: 'No se ha podido apuntar' });
    if (!m) return;
    Dialogo.hecho(`${m.marcadas} casos marcados como mandados`);
    if (lista) await lista.recargar();
  }
})();
