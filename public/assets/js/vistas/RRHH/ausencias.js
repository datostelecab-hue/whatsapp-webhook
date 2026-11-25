// modules/RRHH/vistas/ausencias.ejs — las ausencias que valida RR. HH. (módulo 1, db/289, 25/11/2026).
//
// Las «Ausencias» de la bitácora de la plantilla propia (le tocaba salir, no
// salió y no hay nada que lo explique), desde el 26/10/2026. RR. HH. decide de
// cada una: baja médica, permiso, justificada o injustificada. Solo las
// injustificadas son absentismo. Arriba, el % de plantilla de baja.

(function () {
  const PUEDE = !!Casa.datos().puedeValidar;
  const { esc, etiqueta } = Listado.fmt;
  let ESTADOS = {};
  let TIPOS_PERMISO = [];
  const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const est = f => ESTADOS[f.estado] || { etiqueta: f.estado, tono: 'muted' };
  const DECIDIBLES = ['pendiente', 'injustificada', 'justificada'];
  const decidible = d => PUEDE && DECIDIBLES.includes(d.estado);
  const pct = n => `${String(n).replace('.', ',')} %`;

  /** Cómo se resolvió, en una línea. */
  function resolucion(d) {
    if (d.estado === 'pendiente') return 'Sin revisar';
    const quien = d.automatica ? 'el sistema' : (d.resuelta_por_nombre || '—');
    return `${est(d).etiqueta} · ${d.resuelta || ''} · ${quien}`;
  }
  function situacion(d) {
    if (!d.situacion_estado) return '';
    const que = d.situacion_estado === 'baja_medica' ? 'Baja médica' : `Permiso${d.situacion_tipo ? ` (${d.situacion_tipo})` : ''}`;
    return `${que} del ${dmy(d.situacion_desde)}${d.situacion_hasta ? ` al ${dmy(d.situacion_hasta)}` : ', sin fecha de alta'}`;
  }

  Listado.montar({
    raiz: '#modulo',
    titulo: 'Ausencias',
    icono: 'fa-user-clock',
    clave: 'id',
    origen: '/ausencias/api/lista',
    vacio: 'No hay ausencias que coincidan.',
    filtrosIniciales: { estado: 'pendiente' },
    buscar: { texto: 'Buscar persona o legajo…', campos: ['nombre', 'legajo'] },
    seleccion: PUEDE,
    alSeleccionar: elegidas => {
      ['injustificadas', 'justificadas'].forEach(id => {
        const b = document.querySelector(`[data-accion="${id}"]`);
        if (b) b.disabled = !elegidas.length;
      });
    },

    subtitulo: (v, t, extra) => `Plantilla propia, desde el ${dmy(extra.desde || '2026-10-26')} · `
      + (v.length === t.length ? `${t.length} ausencias` : `${v.length} de ${t.length} ausencias`),

    cifras: (filas, extra) => {
      if (extra && extra.estados) ESTADOS = extra.estados;
      if (extra && extra.tiposPermiso) TIPOS_PERMISO = extra.tiposPermiso;
      const n = e => filas.filter(f => f.estado === e).length;
      const b = extra && extra.baja;
      return [
        { valor: n('pendiente'), etiqueta: 'por revisar', tono: 'warn', filtro: { id: 'estado', valor: 'pendiente' } },
        { valor: n('injustificada'), etiqueta: 'injustificadas (absentismo)', tono: 'red', filtro: { id: 'estado', valor: 'injustificada' },
          ayuda: 'Las únicas que cuentan como absentismo.' },
        { valor: n('justificada'), etiqueta: 'justificadas', filtro: { id: 'estado', valor: 'justificada' } },
        { valor: n('baja_medica') + n('permiso'), etiqueta: 'baja o permiso', filtro: { id: 'estado', valor: 'situacion' } },
        b ? { valor: pct(b.pct), etiqueta: `de la plantilla de baja hoy (${b.baja} de ${b.alta})`, tono: 'azul',
          ayuda: 'Plantilla propia de alta con una baja médica abierta hoy. El histórico, en «Plantilla de baja».' } : null,
      ];
    },

    nota: (filas, extra) => {
      const notas = [];
      if (extra && extra.sinTabla) notas.push({ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/289 en Migraciones.' });
      notas.push({ icono: 'fa-circle-info', texto: 'Cada día a las 13:00 entran las ausencias de ayer. Las que caen dentro de una baja médica o de un permiso se reclasifican solas, también las ya revisadas; las que dejan de ser ausencia en la bitácora (una J, sus horas, una libranza) se cierran solas.' });
      return notas;
    },

    filtros: [
      { id: 'estado', etiqueta: 'Estado', campo: 'estado', textoTodos: 'Cualquier estado',
        opciones: () => [...Object.entries(ESTADOS).map(([valor, e]) => ({ valor, texto: e.etiqueta })),
          { valor: 'situacion', texto: 'Baja médica o permiso' }],
        pasa: (f, v) => (v === 'situacion' ? f.estado === 'baja_medica' || f.estado === 'permiso' : f.estado === v) },
      { id: 'periodo', etiqueta: 'Nómina', campo: 'periodo', textoTodos: 'Cualquier nómina',
        opciones: (filas, extra) => ((extra && extra.periodos) || []) },
      { id: 'racha', etiqueta: 'Seguidas', textoTodos: 'Sueltas o seguidas',
        opciones: [{ valor: '2', texto: '2 días seguidos o más' }, { valor: '3', texto: '3 días seguidos o más' }],
        pasa: (f, v) => (f.racha || 0) >= Number(v) },
    ],

    acciones: [
      ...(PUEDE ? [
        { id: 'injustificadas', texto: 'Injustificadas', icono: 'fa-user-xmark', activa: false,
          ayuda: 'Las marcadas pasan a injustificadas: cuentan como absentismo.', onClick: lst => enBloque(lst, 'injustificada') },
        { id: 'justificadas', texto: 'Justificadas', icono: 'fa-user-check', principal: false, activa: false,
          ayuda: 'Las marcadas pasan a justificadas, con una nota.', onClick: lst => enBloque(lst, 'justificada') },
      ] : []),
      { texto: 'Plantilla de baja', icono: 'fa-chart-line', principal: false, onClick: () => historico() },
    ],

    columnas: [
      { titulo: 'Día', valor: f => f.dia, clase: 'whitespace-nowrap tabular-nums',
        pinta: (v, f) => `${esc(dmy(v))}<span class="block text-xs text-telecab-muted">${esc(DIAS[f.dow] || '')}</span>` },
      { titulo: 'Persona', campo: 'nombre', clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.legajo ? `<span class="block text-xs font-normal text-telecab-muted tabular-nums">Legajo ${esc(f.legajo)}</span>` : '') },
      { titulo: 'Seguidas', valor: f => f.racha || 0, clase: 'whitespace-nowrap',
        ayuda: 'Días seguidos sin salir de esta persona. Tres o más suelen ser una baja.',
        pinta: v => (v >= 2 ? etiqueta(`${v} días seguidos`, v >= 3 ? 'red' : 'warn') : '') },
      { titulo: 'Estado', valor: f => est(f).etiqueta, pinta: (v, f) => etiqueta(v, est(f).tono) },
      { titulo: 'Nómina', campo: 'periodo_texto', clase: 'whitespace-nowrap text-telecab-muted' },
      { titulo: 'Revisada', valor: f => (f.estado === 'pendiente' ? '' : (f.automatica ? 'Sola' : (f.resuelta_por_nombre || ''))), clase: 'whitespace-nowrap' },
    ],

    detalle: {
      origen: id => `/ausencias/api/ausencia/${encodeURIComponent(id)}`,
      titulo: d => `${d.nombre}`,
      subtitulo: d => `Ausencia del ${DIAS[d.dow] || ''} ${dmy(d.dia)}`,
      acciones: [
        { texto: 'Baja médica', icono: 'fa-notes-medical', principal: true, visible: decidible, onClick: (d, lst) => abrirSituacion(d, lst, 'baja_medica') },
        { texto: 'Permiso', icono: 'fa-file-signature', visible: decidible, onClick: (d, lst) => abrirSituacion(d, lst, 'permiso') },
        { texto: 'Justificada', icono: 'fa-user-check', visible: d => decidible(d) && d.estado !== 'justificada', onClick: (d, lst) => una(d, lst, 'justificada') },
        { texto: 'Injustificada', icono: 'fa-user-xmark', visible: d => decidible(d) && d.estado !== 'injustificada', onClick: (d, lst) => una(d, lst, 'injustificada') },
      ],
      bloques: [
        { titulo: 'La ausencia', icono: 'fa-user-clock', campos: [
          { etiqueta: 'Día', valor: d => `${DIAS[d.dow] || ''} ${dmy(d.dia)}` },
          { etiqueta: 'Nómina', valor: d => d.periodo_texto },
          { etiqueta: 'Días seguidos sin salir', valor: d => (d.racha > 1 ? `${d.racha} días` : 'Solo este') },
          { etiqueta: 'Estado', html: true, valor: d => etiqueta(est(d).etiqueta, est(d).tono) },
          { etiqueta: 'Revisada', valor: resolucion },
          { etiqueta: 'Su baja o su permiso', valor: d => situacion(d) || '—', visible: d => !!d.situacion_estado },
          { etiqueta: 'Nota', valor: d => d.nota || '—', ancho: 'sm:col-span-2' },
          { etiqueta: 'Su ficha', html: true, valor: d => `<a class="underline" href="/plantilla#${encodeURIComponent(d.conductor_id)}">Abrir en Plantilla</a>`
            + ` · <a class="underline" href="/bitacora">Bitácora</a>` },
        ] },
        { titulo: 'Llamadas de Control ese día', icono: 'fa-phone', tabla: {
          vacio: 'Control no apuntó ninguna llamada ese día.',
          datos: d => d.llamadas || [],
          columnas: [
            { titulo: 'Hora', campo: 'hora', clase: 'whitespace-nowrap tabular-nums' },
            { titulo: 'Resultado', campo: 'resultado' },
            { titulo: 'Nota', campo: 'nota' },
            { titulo: 'Quién', campo: 'quien', clase: 'whitespace-nowrap' },
          ],
        } },
        { titulo: 'Sus otras ausencias', icono: 'fa-calendar-xmark', tabla: {
          vacio: 'No tiene otras desde el 26/10/2026.',
          datos: d => d.otras || [],
          columnas: [
            { titulo: 'Día', campo: 'dia', clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(dmy(v)) },
            { titulo: 'Estado', valor: f => f.estado, campo: 'estado', pinta: v => etiqueta((ESTADOS[v] || {}).etiqueta || v, (ESTADOS[v] || {}).tono || 'muted') },
          ],
        } },
        { titulo: 'Justificante', icono: 'fa-paperclip', pinta: (d, hueco) => {
          hueco.className = '';
          Adjuntos.montar(hueco, { tipo: 'ausencia_rrhh', dueno: d.id, titulo: 'Justificante', puedeAdjuntar: PUEDE, puedeQuitar: PUEDE });
        } },
      ],
    },
  });

  // ── Decidir ──────────────────────────────────────────────────────────────
  async function mandar(cuerpo, hecho, lst) {
    const r = await Api.post('/ausencias/api/decidir', cuerpo, { aviso: 'No se ha podido guardar', bloquea: true });
    if (!r) return null;
    Dialogo.hecho(hecho(r));
    if (lst.limpiarSeleccion) lst.limpiarSeleccion();
    await lst.recargar();
    return r;
  }

  const campoNota = estado => ({ id: 'nota', etiqueta: estado === 'justificada' ? 'Por qué está justificada' : 'Nota (opcional)',
    tipo: 'texto-largo', obligatorio: estado === 'justificada', minimo: estado === 'justificada' ? 3 : undefined, max: 2000 });

  async function una(d, lst, estado) {
    const v = await Dialogo.formulario(estado === 'justificada' ? 'Justificada' : 'Injustificada', [campoNota(estado)], {
      textoBoton: estado === 'justificada' ? 'Justificada' : 'Injustificada',
      nota: estado === 'injustificada'
        ? `La ausencia del ${dmy(d.dia)} cuenta como absentismo: ese día no devenga salario.`
        : `La ausencia del ${dmy(d.dia)} no cuenta como absentismo. La bitácora no cambia.`,
    });
    if (!v) return;
    await mandar({ ids: [d.id], estado, nota: v.nota }, () => (estado === 'justificada' ? 'Justificada' : 'Injustificada'), lst);
  }

  async function enBloque(lst, estado) {
    const filas = lst.filasSeleccionadas().filter(f => DECIDIBLES.includes(f.estado));
    if (!filas.length) {
      return Dialogo.aviso({ titulo: 'No hay ninguna marcada', tono: 'aviso',
        texto: 'Marca las casillas de las ausencias que quieras decidir. Las bajas, los permisos y las que ya no son ausencia no se deciden aquí.' });
    }
    const v = await Dialogo.formulario(`${filas.length} ${estado === 'justificada' ? 'justificadas' : 'injustificadas'}`, [campoNota(estado)], {
      textoBoton: estado === 'justificada' ? 'Justificarlas' : 'Marcarlas injustificadas',
      nota: estado === 'injustificada'
        ? `Las ${filas.length} cuentan como absentismo. Si alguna es una baja o un permiso, ábrela y elígelo ahí.`
        : `Las ${filas.length} quedan justificadas con la misma nota.`,
    });
    if (!v) return;
    await mandar({ ids: filas.map(f => f.id), estado, nota: v.nota }, r => `${r.decididas} ${estado === 'justificada' ? 'justificadas' : 'injustificadas'}`, lst);
  }

  async function abrirSituacion(d, lst, estado) {
    const esBaja = estado === 'baja_medica';
    const campos = [
      ...(esBaja ? [] : [{ id: 'tipo', etiqueta: 'Qué permiso es', tipo: 'lista', obligatorio: true,
        opciones: TIPOS_PERMISO.map(t => ({ valor: t.codigo, texto: t.regla ? `${t.etiqueta} · ${t.regla}` : t.etiqueta })) }]),
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: dmy(d.dia), obligatorio: true },
      { id: 'hasta', etiqueta: esBaja ? 'Hasta (vacío si sigue de baja)' : 'Hasta', tipo: 'fecha', valor: dmy(d.dia), obligatorio: !esBaja,
        ayuda: esBaja ? 'Sin fecha, la baja queda abierta hasta que se le dé el alta en Plantilla.' : '' },
      { id: 'nota', etiqueta: 'Nota (opcional)', tipo: 'texto-largo', max: 2000 },
    ];
    const v = await Dialogo.formulario(esBaja ? `Baja médica de ${d.nombre}` : `Permiso de ${d.nombre}`, campos, {
      textoBoton: esBaja ? 'Abrir la baja' : 'Abrir el permiso',
      nota: `Se abre ${esBaja ? 'la baja médica' : 'el permiso'} en su ficha, como desde Plantilla, y sale del absentismo. `
        + 'Las ausencias suyas de esas fechas quedan resueltas con ella. El justificante se sube en el bloque «Justificante».',
    });
    if (!v) return;
    const cuerpo = { ids: [d.id], estado, desde: v.desde, hasta: v.hasta || null, tipoPermiso: v.tipo, nota: v.nota };
    const hecho = r => `${esBaja ? 'Baja médica abierta' : 'Permiso abierto'}: ${r.decididas} ${r.decididas === 1 ? 'ausencia resuelta' : 'ausencias resueltas'}`;
    // Un permiso que se pasa de lo que da el convenio pide su motivo antes de guardarse.
    try {
      const r = await Api.post('/ausencias/api/decidir', cuerpo, { bloquea: true });
      Dialogo.hecho(hecho(r));
      await lst.recargar();
    } catch (e) {
      const pide = e.respuesta && e.respuesta.pide;
      if (!pide) return Dialogo.aviso({ titulo: 'No se ha podido guardar', texto: e.message, tono: 'error' });
      const extra = await Dialogo.loQuePide(pide);
      if (extra) await mandar({ ...cuerpo, ...extra }, hecho, lst);
    }
  }

  // ── El % de plantilla de baja ─────────────────────────────────────────────
  async function historico() {
    const h = await Api.get('/ausencias/api/bajas').catch(e => { Dialogo.aviso({ titulo: 'No se pudo cargar', texto: e.message, tono: 'error' }); return null; });
    if (!h) return;
    const max = Math.max(1, ...h.dias.map(x => x.pct));
    const barras = h.dias.map(x => `<span title="${esc(dmy(x.dia))}: ${esc(pct(x.pct))} (${x.baja} de ${x.alta})"
      class="flex-1 bg-telecab-gold/70 rounded-t-sm" style="height:${Math.max(2, Math.round((x.pct / max) * 100))}%"></span>`).join('');
    const html = `
      ${h.hoy ? `<p class="text-sm mb-3">Hoy, <b>${esc(pct(h.hoy.pct))}</b> de la plantilla propia está de baja médica: ${h.hoy.baja} de ${h.hoy.alta} personas de alta.</p>` : ''}
      <p class="text-xs text-telecab-muted mb-1">Los últimos ${h.dias.length} días</p>
      <div class="flex items-end gap-px h-24 mb-4 border-b border-telecab-border" role="img" aria-label="Porcentaje de plantilla de baja, día a día">${barras}</div>
      <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left text-[11px] uppercase tracking-wider text-telecab-muted">
          <th class="py-1.5 pr-3">Mes</th><th class="py-1.5 pr-3 text-right">Media</th><th class="py-1.5 pr-3 text-right">Día más alto</th><th class="py-1.5 text-right">Día más bajo</th></tr></thead>
        <tbody>${h.meses.map(m => `<tr class="border-t border-telecab-border/60">
          <td class="py-1.5 pr-3">${esc(m.texto)}${m.dias < 28 ? ` <span class="text-xs text-telecab-muted">(${m.dias} días)</span>` : ''}</td>
          <td class="py-1.5 pr-3 text-right tabular-nums font-semibold">${esc(pct(m.media))}</td>
          <td class="py-1.5 pr-3 text-right tabular-nums">${esc(pct(m.max.pct))} <span class="text-xs text-telecab-muted">el ${esc(dmy(m.max.dia).slice(0, 5))}</span></td>
          <td class="py-1.5 text-right tabular-nums">${esc(pct(m.min.pct))} <span class="text-xs text-telecab-muted">el ${esc(dmy(m.min.dia).slice(0, 5))}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="text-xs text-telecab-muted mt-3">Plantilla propia de alta cada día y cuántos tenían una baja médica abierta (Plantilla). Desde el 01/07/2026.</p>`;
    await Dialogo.abrir({ titulo: 'Plantilla de baja', html, ancho: 'max-w-2xl', tono: 'info', opciones: [{ texto: 'Cerrar', valor: null, principal: true }] });
  }
})();
