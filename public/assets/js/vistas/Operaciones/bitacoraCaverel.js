// modules/Operaciones/vistas/bitacoraCaverel.ejs — HORAS CAVEREL (10/11/2026, db/238)
//
// Camilo: «vamos a hacer un apartado en la bitácora llamado "Horas Caverel", en
// la cual vamos a poder visualizar las horas mensuales de este archivo por
// nombre, que se vea la utilización, horas totales y desglosadas por espera y
// viaje por el mes que se le ve ahí».
//
// Una fila por persona y mes (del más nuevo al más viejo). Se filtra por mes y
// se busca por nombre; las cifras de arriba son las de lo que se ve, con la
// utilización del tiempo total (no la media de los porcentajes). Al pinchar,
// la ficha de la persona con todos sus meses.

(() => {
  const DEL_SERVIDOR = Casa.datos();
  const { esc, fechaHora } = Listado.fmt;
  const PUEDE = DEL_SERVIDOR.puedeImportar;

  // useGrouping 'always': en castellano Intl no separa los miles de un número de
  // cuatro cifras («7953,3» al lado de «30.562,8»), y en una columna desentona.
  const num = (v, dec = 1) => (v === null || v === undefined ? '' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: dec, useGrouping: 'always' }));
  const h = v => (v === null || v === undefined ? '—' : `${num(v)} h`);
  const pc = v => (v === null || v === undefined ? '—' : `${num(v)} %`);
  const vacio = '<span class="text-telecab-muted">—</span>';

  /** La suma de unas filas: horas, viaje, espera y la utilización del tiempo total. */
  function sumar(filas) {
    let horas = 0, conOcup = 0, viaje = 0, viajes = 0;
    filas.forEach(f => {
      horas += f.horas || 0;
      viajes += f.viajes || 0;
      if (f.utilizacion !== null && f.utilizacion !== undefined) { conOcup += f.horas || 0; viaje += f.viaje || 0; }
    });
    return { horas, viajes, viaje: conOcup ? viaje : null, espera: conOcup ? conOcup - viaje : null,
      utilizacion: conOcup ? Math.round(viaje / conOcup * 1000) / 10 : null };
  }

  // La utilización con una barrita: el número manda; la barra es para pasar la
  // vista por la columna. Un solo tono (el texto): no se juzga, se enseña.
  const barra = v => (v === null || v === undefined ? vacio : `
    <span class="inline-flex items-center gap-2 tabular-nums">
      <span class="w-12 h-1.5 rounded-full bg-telecab-border/60 overflow-hidden" aria-hidden="true">
        <span class="block h-full bg-telecab-text/70" style="width:${Math.max(0, Math.min(100, Number(v)))}%"></span>
      </span>${esc(pc(v))}</span>`);

  function subirCsv(lst) {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = '.csv,text/csv';
    entrada.onchange = async () => {
      const f = entrada.files && entrada.files[0];
      if (!f) return;
      const base64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(f); });
      // Se elige el archivo bastante después del clic: la carga de la casa no lo
      // ve como una acción y hay que abrirla a mano (como en Combustible).
      const carga = window.telecabCarga || { abrir() {}, cerrar() {} };
      carga.abrir();
      let r;
      try {
        r = (await Api.post('/bitacora/caverel/api/importar', { base64, nombre: f.name })).importacion;
      } catch (e) {
        carga.cerrar();
        await Dialogo.aviso({ titulo: 'No se ha importado', texto: e.message, tono: 'error', ancho: 'max-w-xl' });
        return;
      }
      carga.cerrar();
      const aparte = [
        r.sinActividad ? `${r.sinActividad} ${r.sinActividad === 1 ? 'fila' : 'filas'} sin horas ni viajes (no dicen nada)` : '',
        r.sinNombre ? `${r.sinNombre} sin conductor` : '',
        r.repetidas ? `${r.repetidas} repetidas (vale la última)` : '',
      ].filter(Boolean);
      await Dialogo.aviso({
        titulo: 'Horas Caverel subidas', tono: 'ok', ancho: 'max-w-xl',
        html: `<p class="text-sm"><b>${esc(num(r.filas, 0))}</b> filas de <b>${esc(num(r.personas, 0))}</b> personas, de ${esc(r.desde)} a ${esc(r.hasta)} (${esc(num(r.meses, 0))} meses).</p>` +
          `<p class="text-sm mt-2">${esc(num(r.nuevas, 0))} nuevas y ${esc(num(r.cambiadas, 0))} sustituidas: la misma persona y mes se queda con la cifra del archivo nuevo.</p>` +
          (aparte.length ? `<p class="text-xs text-telecab-muted mt-2">No entran: ${esc(aparte.join(' · '))}.</p>` : ''),
      });
      await lst.recargar();
    };
    entrada.click();
  }

  Listado.montar({
    raiz: '#modulo',
    titulo: 'Horas Caverel',
    icono: 'fa-clock-rotate-left',
    clave: 'id',
    origen: '/bitacora/caverel/api/lista',
    porPagina: 100,
    vacio: PUEDE
      ? 'Todavía no hay horas de Caverel. Sube el CSV de BOLT (Fleet Owner Earnings Report, agrupado por meses) con «Subir CSV».'
      : 'Todavía no hay horas de Caverel: falta que alguien con permiso suba el CSV de BOLT.',
    buscar: { texto: 'Buscar por nombre…', campos: ['nombre'] },
    subtitulo: (v, t) => {
      const personas = new Set(v.map(f => f.nombre)).size;
      return `${v.length === t.length ? `${t.length} filas` : `${v.length} de ${t.length} filas`} · ${personas} ${personas === 1 ? 'persona' : 'personas'}` +
        ' · una fila por persona y mes, del informe de BOLT';
    },

    acciones: [
      { texto: 'Volver a la bitácora', icono: 'fa-arrow-left', principal: false, onClick: () => { location.href = '/bitacora'; } },
      ...(PUEDE ? [{ texto: 'Subir CSV', icono: 'fa-file-import', principal: false, onClick: lst => subirCsv(lst) }] : []),
    ],

    // Lo que se está viendo (el mes elegido, lo buscado), sumado.
    cifras: v => {
      const s = sumar(v);
      return [
        { valor: h(s.horas), etiqueta: 'en total', ayuda: 'Total Online Hours de BOLT: el tiempo conectado (viaje + espera).' },
        { valor: h(s.viaje), etiqueta: 'de viaje', ayuda: 'Horas × utilización de cada fila: el tiempo con pasajero.' },
        { valor: h(s.espera), etiqueta: 'de espera', ayuda: 'Lo conectado que no fue viaje.' },
        { valor: pc(s.utilizacion), etiqueta: 'de utilización', tono: 'gold',
          ayuda: 'Viaje / (viaje + espera) del tiempo total de lo que se ve: pesa más quien más horas hizo. No es la media de los porcentajes.' },
        { valor: num(s.viajes, 0), etiqueta: 'viajes' },
      ];
    },

    filtros: [{
      id: 'mes', etiqueta: 'Mes', textoTodos: 'Todos los meses',
      pasa: (f, v) => f.mes === v,
      opciones: (filas, extra) => ((extra && extra.meses) || []).map(m => ({
        valor: m.mes, texto: m.nombre[0].toUpperCase() + m.nombre.slice(1), cuenta: filas.filter(f => f.mes === m.mes).length,
      })),
    }],

    nota: (v, extra) => {
      const u = extra && extra.ultima;
      if (!u) return null;
      return { tono: 'info', icono: 'fa-file-csv',
        texto: `Último CSV subido el ${fechaHora(u.cuando)}${u.quien ? ` por ${u.quien}` : ''}. ` +
          'La utilización es la «Occupation Rate» de BOLT, que viene redondeada a un % entero: el viaje y la espera salen de ella.' };
    },

    columnas: [
      { titulo: 'Mes', campo: 'mesNombre', clase: 'whitespace-nowrap capitalize' },
      { titulo: 'Conductor', campo: 'nombre', clase: 'font-semibold',
        pinta: (v, f) => esc(v) + (f.conductorId ? ' <span class="text-[11px] text-telecab-muted font-normal" title="Tiene ficha en Plantilla (mismo DNI)">· en plantilla</span>' : '') },
      { titulo: 'Horas', campo: 'horas', clase: 'tabular-nums whitespace-nowrap font-semibold', pinta: v => esc(h(v)),
        ayuda: 'Total Online Hours de BOLT: el tiempo conectado (viaje + espera).' },
      { titulo: 'Viaje', campo: 'viaje', clase: 'tabular-nums whitespace-nowrap', pinta: v => (v === null ? vacio : esc(h(v))),
        ayuda: 'Horas × utilización: el tiempo con pasajero.' },
      { titulo: 'Espera', campo: 'espera', clase: 'tabular-nums whitespace-nowrap text-telecab-muted', pinta: v => (v === null ? vacio : esc(h(v))),
        ayuda: 'Lo conectado que no fue viaje.' },
      { titulo: 'Utilización', campo: 'utilizacion', clase: 'whitespace-nowrap', pinta: v => barra(v),
        ayuda: 'Occupation Rate de BOLT: viaje / (viaje + espera). Es la utilización de la casa.' },
      { titulo: 'Viajes', campo: 'viajes', clase: 'tabular-nums text-telecab-muted', pinta: v => esc(num(v, 0)) },
    ],

    detalle: {
      origen: id => `/bitacora/caverel/api/persona/${encodeURIComponent(id)}`,
      titulo: d => d.nombre,
      subtitulo: d => `${d.meses.length} ${d.meses.length === 1 ? 'mes' : 'meses'}${d.primero && d.ultimo && d.primero !== d.ultimo ? ` · de ${d.primero} a ${d.ultimo}` : d.ultimo ? ` · ${d.ultimo}` : ''}` +
        (d.cuentas > 1 ? ` · ${d.cuentas} cuentas de BOLT con el mismo DNI` : ''),
      acciones: [{
        texto: 'Ver su ficha', icono: 'fa-id-card', principal: false,
        visible: d => !!d.conductorId, onClick: d => { location.href = `/plantilla#${encodeURIComponent(d.conductorId)}`; },
      }],
      bloques: [
        {
          titulo: 'En total', icono: 'fa-chart-simple',
          campos: [
            { etiqueta: 'Horas', valor: d => h(d.total.horas), clase: 'font-semibold tabular-nums' },
            { etiqueta: 'Viaje', valor: d => h(d.total.viaje), clase: 'tabular-nums' },
            { etiqueta: 'Espera', valor: d => h(d.total.espera), clase: 'tabular-nums' },
            { etiqueta: 'Utilización', valor: d => pc(d.total.utilizacion), clase: 'tabular-nums font-semibold text-telecab-gold' },
            { etiqueta: 'Viajes', valor: d => num(d.total.viajes, 0), clase: 'tabular-nums' },
            { etiqueta: 'Media al mes', valor: d => (d.media === null ? '' : `${h(d.media)} (meses con horas)`), clase: 'tabular-nums' },
          ],
        },
        {
          titulo: 'Mes a mes', icono: 'fa-calendar',
          tabla: {
            datos: d => d.meses,
            vacio: 'Sin meses.',
            columnas: [
              { titulo: 'Mes', campo: 'mesNombre', clase: 'capitalize whitespace-nowrap' },
              { titulo: 'Horas', campo: 'horas', clase: 'tabular-nums font-semibold whitespace-nowrap', pinta: v => esc(h(v)) },
              { titulo: 'Viaje', campo: 'viaje', clase: 'tabular-nums whitespace-nowrap', pinta: v => (v === null ? vacio : esc(h(v))) },
              { titulo: 'Espera', campo: 'espera', clase: 'tabular-nums whitespace-nowrap text-telecab-muted', pinta: v => (v === null ? vacio : esc(h(v))) },
              { titulo: 'Utilización', campo: 'utilizacion', clase: 'whitespace-nowrap', pinta: v => barra(v) },
              { titulo: 'Viajes', campo: 'viajes', clase: 'tabular-nums text-telecab-muted', pinta: v => esc(num(v, 0)) },
              // Si tuvo varias cuentas, con cuál fue cada mes.
              { titulo: 'Nombre en BOLT', campo: 'nombre', clase: 'text-telecab-muted text-xs' },
            ],
          },
        },
      ],
    },
  });
})();
