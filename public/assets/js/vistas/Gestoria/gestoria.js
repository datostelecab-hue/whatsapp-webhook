// modules/Gestoria/vistas/gestoria.ejs — la plantilla de la gestoría (módulo 8, db/287, 25/11/2026).
//
// El listado de la gestoría (la proforma de A3NOM o el de plantilla en alta),
// cruzado por legajo con la plantilla propia. Cada diferencia vive hasta que se
// resuelve; si en el listado siguiente ya no sale, se resuelve sola.

(function () {
  const PUEDE = !!Casa.datos().puedeGestionar;
  const { esc, etiqueta } = Listado.fmt;
  let TIPOS = {};
  let COSTE_DIA = 0;
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const euros = n => (n == null ? '' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
  const tipo = f => TIPOS[f.tipo] || { etiqueta: f.tipo, tono: 'muted' };
  const ESTADOS = { pendiente: ['Pendiente', 'warn'], resuelta: ['Resuelta', 'green'], descartada: ['Descartada', 'muted'] };

  /** Lo que dice cada diferencia, en una frase. */
  function detalle(f) {
    const d = f.detalle || {};
    switch (f.tipo) {
      case 'alta_gestoria_baja_nuestra': return `Baja con nosotros el ${dmy(d.baja)}: ${d.dias} días en su listado desde entonces`;
      case 'alta_nuestra_no_gestoria': return `De alta con nosotros desde el ${dmy(d.alta)} y no sale en su listado`;
      case 'legajo_cambiado': return `En el ERP tiene el ${d.legajoErp}; en la gestoría, el ${f.legajo}`;
      case 'legajo_desconocido': return d.propuesta
        ? `¿Es ${d.propuesta.nombre} (ficha ${d.propuesta.id}, ${d.propuesta.situacion})?`
        : d.candidatos > 1 ? 'Se parece a varias fichas del ERP' : 'No se parece a nadie del ERP';
      case 'nombre_distinto': return `En el ERP, ese legajo es de ${d.erp}`;
      case 'sin_legajo': return `De alta desde el ${dmy(d.alta)}; sin legajo no se puede cruzar`;
      case 'baja_gestoria_alta_nuestra': return `De baja en la gestoría el ${dmy(d.bajaGestoria)}; con nosotros sigue de alta desde el ${dmy(d.alta)}`;
      case 'fecha_alta_distinta': return `Alta el ${dmy(d.gestoria)} en la gestoría y el ${dmy(d.erp)} en el ERP`;
      case 'fecha_baja_distinta': return `Baja el ${dmy(d.gestoria)} en la gestoría y el ${dmy(d.erp)} en el ERP`
        + (d.dias ? `: ${d.dias} días más en la gestoría` : '');
      case 'jornada_distinta': return `${d.gestoria} h en la gestoría y ${d.erp} h en el ERP`;
      default: return '';
    }
  }
  const persona = f => f.nombre_erp || f.nombre_gestoria || '—';
  const FECHAS = ['fecha_alta_distinta', 'fecha_baja_distinta', 'jornada_distinta'];
  const decide = f => !!(TIPOS[f.tipo] && TIPOS[f.tipo].decide);
  const pedida = f => !!(f.detalle && f.detalle.pedir);
  // «Corregir el ERP» solo donde hay un camino seguro: el alta y la jornada del contrato abierto.
  const corregible = f => f.tipo === 'jornada_distinta' || (f.tipo === 'fecha_alta_distinta' && f.detalle && f.detalle.abierto);

  const lista = Listado.montar({
    raiz: '#gs-plantilla',
    titulo: 'Plantilla de la gestoría',
    icono: 'fa-building-columns',
    clave: 'id',
    origen: '/gestoria/api/lista',
    vacio: 'No hay diferencias que coincidan.',
    filtrosIniciales: { estado: 'pendiente' },
    buscar: { texto: 'Buscar persona o legajo…', campos: ['nombre_erp', 'nombre_gestoria', 'legajo'] },

    subtitulo: (v, t) => (v.length === t.length ? `${t.length} diferencias` : `${v.length} de ${t.length} diferencias`),

    cifras: (filas, extra) => {
      if (extra && extra.tipos) TIPOS = extra.tipos;
      COSTE_DIA = (extra && extra.costeDia) || 0;
      const pend = filas.filter(f => f.estado === 'pendiente');
      const n = t => pend.filter(f => f.tipo === t).length;
      const coste = pend.reduce((s, f) => s + (f.coste || 0), 0);
      return [
        { valor: n('alta_gestoria_baja_nuestra'), etiqueta: 'en la gestoría y de baja con nosotros', tono: 'red',
          filtro: { id: 'tipo', valor: 'alta_gestoria_baja_nuestra' }, ayuda: 'La gestoría los sigue teniendo (y cotizando) y para nosotros se fueron.' },
        { valor: n('alta_nuestra_no_gestoria'), etiqueta: 'de alta y no en la gestoría', tono: 'red',
          filtro: { id: 'tipo', valor: 'alta_nuestra_no_gestoria' }, ayuda: 'Trabajan con nosotros y no salen en su listado: ¿se tramitó el alta?' },
        { valor: n('legajo_cambiado') + n('legajo_desconocido') + n('nombre_distinto'), etiqueta: 'legajos que no cuadran', tono: 'warn',
          filtro: { id: 'tipo', valor: 'legajos' } },
        { valor: n('sin_legajo'), etiqueta: 'sin legajo', filtro: { id: 'tipo', valor: 'sin_legajo' } },
        ...(n('baja_gestoria_alta_nuestra') ? [{ valor: n('baja_gestoria_alta_nuestra'), etiqueta: 'de baja en la gestoría y trabajando', tono: 'red',
          filtro: { id: 'tipo', valor: 'baja_gestoria_alta_nuestra' }, ayuda: 'Para la gestoría se fueron y con nosotros siguen de alta.' }] : []),
        ...(FECHAS.some(t => n(t)) ? [{ valor: FECHAS.reduce((a, t) => a + n(t), 0), etiqueta: 'fechas o jornada que no cuadran', tono: 'warn',
          filtro: { id: 'tipo', valor: 'fechas' }, ayuda: 'Las decide quien lleva la gestoría: corregir el ERP o pedírselo a la gestoría.' }] : []),
        ...(COSTE_DIA > 0 ? [{ valor: euros(coste), etiqueta: 'coste estimado', tono: 'red',
          ayuda: `Días en su listado después de la baja × ${euros(COSTE_DIA)} al día (Parámetros).` }] : []),
      ];
    },

    nota: (filas, extra) => {
      const notas = [];
      if (extra && extra.sinTabla) notas.push({ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/287 en Migraciones.' });
      const c = extra && extra.cargas && extra.cargas[0];
      notas.push(c
        ? { icono: 'fa-file-excel', html: `Último listado: <b>${esc(c.nombre)}</b>, subido el ${esc(c.cuando)}${c.por ? ` por ${esc(c.por)}` : ''}`
            + ` (${esc((c.resultado && c.resultado.trabajadores) || 0)} trabajadores, ${esc(c.incidencias)} diferencias).`
            + (c.original ? ` <a class="underline" href="${esc(c.original)}">Descargar el original</a>.` : '') }
        : { icono: 'fa-file-excel', texto: 'Aún no se ha subido ningún listado de la gestoría.' });
      if (c && c.resultado && c.resultado.tipo === 'proforma') {
        notas.push({ icono: 'fa-circle-info', texto: 'Es una proforma de nómina: no trae fechas de alta y baja, así que esas no se comparan. Quien se va a mitad de mes sale en la nómina de ese mes y no cuenta como diferencia.' });
      }
      if (!COSTE_DIA) notas.push({ icono: 'fa-euro-sign', texto: 'Sin coste estimado: falta el «Coste diario estimado de Seguridad Social» en Parámetros.' });
      return notas;
    },

    filtros: [
      { id: 'estado', etiqueta: 'Estado', campo: 'estado', textoTodos: 'Cualquier estado', opciones: [
        { valor: 'pendiente', texto: 'Pendientes' }, { valor: 'resuelta', texto: 'Resueltas' }, { valor: 'descartada', texto: 'Descartadas (no vuelven a salir)' }] },
      { id: 'tipo', etiqueta: 'Tipo', textoTodos: 'Cualquier tipo',
        opciones: () => [...Object.entries(TIPOS).map(([valor, t]) => ({ valor, texto: t.etiqueta })),
          { valor: 'legajos', texto: 'Legajos que no cuadran' }, { valor: 'fechas', texto: 'Fechas o jornada que no cuadran' }],
        pasa: (f, v) => (v === 'legajos' ? ['legajo_cambiado', 'legajo_desconocido', 'nombre_distinto'].includes(f.tipo)
          : v === 'fechas' ? FECHAS.includes(f.tipo) : f.tipo === v) },
    ],

    acciones: PUEDE ? [
      { texto: 'Subir listado', icono: 'fa-file-arrow-up', onClick: () => subirListado() },
      { texto: 'Correo a la gestoría', icono: 'fa-envelope', principal: false, onClick: () => correo() },
    ] : [],

    columnas: [
      { titulo: 'Diferencia', valor: f => tipo(f).etiqueta, pinta: (v, f) => etiqueta(v, tipo(f).tono) },
      { titulo: 'Persona', valor: persona, clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.nombre_erp && f.nombre_gestoria && f.nombre_gestoria !== f.nombre_erp
          ? `<span class="block text-xs font-normal text-telecab-muted">En la gestoría: ${esc(f.nombre_gestoria)}</span>` : '') },
      { titulo: 'Legajo', campo: 'legajo', clase: 'tabular-nums whitespace-nowrap' },
      { titulo: 'Qué pasa', valor: detalle, clase: 'max-w-[28rem]' },
      { titulo: 'Coste', valor: f => f.coste, ayuda: 'Estimado: días en su listado después de la baja × el coste diario (Parámetros).',
        pinta: v => (v == null ? '' : `<span class="text-telecab-red font-semibold whitespace-nowrap">${esc(euros(v))}</span>`) },
      { titulo: 'Detectada', campo: 'detectada', clase: 'whitespace-nowrap' },
      { titulo: 'A la gestoría', valor: f => f.enviada || (pedida(f) ? 'Por pedir' : ''), clase: 'whitespace-nowrap',
        ayuda: 'Cuándo se le mandó en el correo de correcciones («Por pedir»: decidido, aún sin mandar).' },
      { titulo: 'Estado', valor: f => ESTADOS[f.estado][0], pinta: (v, f) => etiqueta(v, ESTADOS[f.estado][1]) },
    ],

    detalle: {
      origen: id => `/gestoria/api/discrepancia/${encodeURIComponent(id)}`,
      titulo: d => tipo(d).etiqueta,
      subtitulo: d => [persona(d), d.legajo ? `legajo ${d.legajo}` : ''].filter(Boolean).join(' · '),
      acciones: [
        { texto: 'Poner el legajo de la gestoría', icono: 'fa-id-badge', principal: true,
          visible: d => PUEDE && d.estado === 'pendiente' && (d.tipo === 'legajo_cambiado' || (d.tipo === 'legajo_desconocido' && d.detalle && d.detalle.propuesta)),
          onClick: (d, lst) => ponerLegajo(d, lst) },
        { texto: 'Corregir el ERP', icono: 'fa-pen', principal: true,
          visible: d => PUEDE && d.estado === 'pendiente' && corregible(d), onClick: (d, lst) => decidir(d, lst, 'erp') },
        { texto: 'Pedírselo a la gestoría', icono: 'fa-envelope',
          visible: d => PUEDE && d.estado === 'pendiente' && decide(d) && !pedida(d), onClick: (d, lst) => decidir(d, lst, 'gestoria') },
        { texto: 'Resuelta', icono: 'fa-check', visible: d => PUEDE && d.estado === 'pendiente', onClick: (d, lst) => cerrar(d, lst, 'resuelta') },
        { texto: 'Descartar', icono: 'fa-ban', visible: d => PUEDE && d.estado === 'pendiente', onClick: (d, lst) => cerrar(d, lst, 'descartada') },
      ],
      bloques: [
        { titulo: 'La diferencia', icono: 'fa-building-columns', campos: [
          { etiqueta: 'Qué pasa', valor: d => detalle(d) },
          { etiqueta: 'En el ERP', valor: d => (d.nombre_erp ? `${d.nombre_erp} (ficha ${d.conductor_id})` : '—') },
          { etiqueta: 'En la gestoría', valor: d => d.nombre_gestoria || '—' },
          { etiqueta: 'Legajo', valor: d => d.legajo || '—' },
          { etiqueta: 'Coste estimado', valor: d => (d.coste == null ? '—' : euros(d.coste)) },
          { etiqueta: 'Detectada', valor: d => d.detectada },
          { etiqueta: 'Último listado en que sale', valor: d => d.ultimo_fichero || '—' },
          { etiqueta: 'Decidido', valor: d => (pedida(d) ? `Pedírselo a la gestoría${d.detalle.pedidoAt ? ` (${d.detalle.pedidoAt})` : ''}` : decide(d) ? 'Aún no' : '—') },
          { etiqueta: 'Enviada a la gestoría', valor: d => d.enviada || 'No' },
          { etiqueta: 'Estado', valor: d => ESTADOS[d.estado][0] + (d.resuelta ? ` el ${d.resuelta}${d.resuelta_por_nombre ? ` por ${d.resuelta_por_nombre}` : ''}` : '') },
          { etiqueta: 'Nota', valor: d => d.nota || '—' },
        ] },
      ],
    },
  });

  async function ponerLegajo(d, lst) {
    const destino = d.tipo === 'legajo_cambiado'
      ? `${d.nombre_erp} (ficha ${d.conductor_id}), que ahora tiene el ${d.detalle.legajoErp}`
      : `${d.detalle.propuesta.nombre} (ficha ${d.detalle.propuesta.id}, ${d.detalle.propuesta.situacion})`;
    const ok = await Dialogo.confirmar({ titulo: `Poner el legajo ${d.legajo}`, si: `Poner el ${d.legajo}`, no: 'Cancelar',
      texto: `Se pone el legajo ${d.legajo} de la gestoría a ${destino}. Queda en el libro de cambios de su ficha.` });
    if (!ok) return;
    const r = await Api.post(`/gestoria/api/discrepancia/${encodeURIComponent(d.id)}/legajo`,
      { conductorId: d.tipo === 'legajo_desconocido' ? d.detalle.propuesta.id : d.conductor_id }, { aviso: 'No se ha podido poner' });
    if (!r) return;
    Dialogo.hecho(`Legajo ${r.legajo} puesto`);
    await lst.recargar();
  }

  async function decidir(d, lst, como) {
    const x = d.detalle || {};
    const cambio = d.tipo === 'jornada_distinta' ? `la jornada de ${x.erp} h a ${x.gestoria} h` : `la fecha de alta del ${dmy(x.erp)} al ${dmy(x.gestoria)}`;
    const ok = await Dialogo.confirmar(como === 'erp'
      ? { titulo: 'Corregir el ERP', si: 'Corregirlo', no: 'Cancelar',
          texto: `Se cambia en su ficha ${cambio}, como la tiene la gestoría, y la diferencia queda resuelta. Queda en el libro de cambios de su ficha.` }
      : { titulo: 'Pedírselo a la gestoría', si: 'Pedírselo', no: 'Cancelar',
          texto: 'Entra en el próximo «Correo a la gestoría». La diferencia sigue pendiente hasta que deje de salir en su listado.' });
    if (!ok) return;
    const r = await Api.post(`/gestoria/api/discrepancia/${encodeURIComponent(d.id)}/decidir`, { como }, { aviso: 'No se ha podido hacer' });
    if (!r) return;
    Dialogo.hecho(como === 'erp' ? 'Corregido en el ERP' : 'Irá en el correo a la gestoría');
    await lst.recargar();
  }

  async function cerrar(d, lst, estado) {
    const v = await Dialogo.formulario(estado === 'resuelta' ? 'Dar por resuelta' : 'Descartar la diferencia', [
      { id: 'nota', etiqueta: estado === 'resuelta' ? 'Qué se hizo (opcional)' : 'Por qué se descarta', tipo: 'texto-largo',
        obligatorio: estado === 'descartada', minimo: estado === 'descartada' ? 3 : undefined, max: 2000 },
    ], { textoBoton: estado === 'resuelta' ? 'Resuelta' : 'Descartar' });
    if (!v) return;
    const r = await Api.post(`/gestoria/api/discrepancia/${encodeURIComponent(d.id)}/cerrar`, { estado, nota: v.nota }, { aviso: 'No se ha podido cerrar' });
    if (!r) return;
    Dialogo.hecho(estado === 'resuelta' ? 'Resuelta' : 'Descartada');
    await lst.recargar();
  }

  async function subirListado() {
    const v = await Dialogo.formulario('Subir el listado de la gestoría', [
      { id: 'fichero', etiqueta: 'El fichero de la gestoría', tipo: 'ficheros', multiple: false, obligatorio: true, accept: '.xls,.xlsx',
        ayuda: 'La proforma de A3NOM o el listado de trabajadores de A3 (con fechas de ingreso y baja), tal cual llega (.xls o .xlsx).' },
      { id: 'fecha', etiqueta: 'Fecha del listado', tipo: 'fecha', valor: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }),
        ayuda: 'Solo cuenta si el fichero no la trae (el listado de trabajadores de A3 no la lleva): el día en que la gestoría lo sacó.' },
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
    const previa = await Api.post('/gestoria/api/subir', { base64, nombre: file.name, fecha: v.fecha, confirmar: false }, { aviso: 'No se ha podido leer el listado' });
    if (!previa) return;
    if (previa.yaCargado) {
      return Dialogo.aviso({ titulo: 'Ese listado ya se subió', tono: 'aviso',
        texto: `Se subió el ${previa.yaCargado.cuando}${previa.yaCargado.por ? ` (${previa.yaCargado.por})` : ''}. El mismo fichero no se sube dos veces.` });
    }
    const r = previa.resumen;
    const html = `
      <p class="text-sm">${r.tipo === 'proforma' ? 'Proforma de nómina' : 'Listado de plantilla'} del <b>${esc(dmy(r.fecha))}</b>
        ${r.empresa ? `· empresa ${esc(r.empresa.codigo)} ${esc(r.empresa.nombre)}` : ''} · hoja «${esc(r.hoja)}»</p>
      <p class="text-sm mt-1"><b>${r.trabajadores}</b> trabajadores${r.conceptos ? ` y ${r.conceptos} conceptos` : ''}${r.conFechas ? `, con fechas de alta y baja${r.conJornada ? ' y jornada' : ''}` : ''}.</p>
      <ul class="text-sm mt-2 space-y-0.5">${Object.entries(r.porTipo).map(([t, n]) =>
        `<li><b>${n}</b> ${esc((TIPOS[t] || { etiqueta: t }).etiqueta.toLowerCase())}</li>`).join('') || '<li>Ninguna diferencia.</li>'}</ul>
      ${(r.avisos || []).length ? `<p class="text-xs text-telecab-warn mt-2">${r.avisos.map(esc).join('<br>')}</p>` : ''}
      <p class="text-xs text-telecab-muted mt-2">Las que ya estaban pendientes se mantienen; las que ya no salgan se dan por resueltas.</p>`;
    const ok = await Dialogo.confirmar({ titulo: 'Subir el listado', html, ancho: 'max-w-xl', si: 'Subirlo', no: 'Cancelar' });
    if (!ok) return;
    const hecho = await Api.post('/gestoria/api/subir', { base64, nombre: file.name, fecha: v.fecha, confirmar: true }, { aviso: 'No se ha podido subir', bloquea: true });
    if (!hecho) return;
    Dialogo.hecho(`Listado subido: ${hecho.nuevas} nuevas, ${hecho.siguen} siguen, ${hecho.resueltas} resueltas${hecho.ignoradas ? `, ${hecho.ignoradas} descartadas antes` : ''}`);
    await lista.recargar();
  }

  async function correo() {
    const c = await Api.get('/gestoria/api/correo').catch(e => { Dialogo.aviso({ titulo: 'No se pudo preparar', texto: e.message, tono: 'error' }); return null; });
    if (!c) return;
    if (!c.ids || !c.ids.length) return Dialogo.aviso({ titulo: 'Nada que mandar', texto: 'No hay ninguna diferencia pendiente que tenga que corregir la gestoría.' });
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
    const m = await Api.post('/gestoria/api/correo/enviado', { ids: c.ids }, { aviso: 'No se ha podido apuntar' });
    if (!m) return;
    Dialogo.hecho(`${m.marcadas} diferencias marcadas como enviadas`);
    await lista.recargar();
  }
})();
