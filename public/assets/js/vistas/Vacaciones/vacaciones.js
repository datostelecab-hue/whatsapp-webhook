// modules/Vacaciones/vistas/vacaciones.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const { esc, etiqueta } = Listado.fmt;
  const R = DEL_SERVIDOR.reglas;
  // Quien aprueba vacaciones (una sola persona, db/189): solo para enseñar el
  // botón de cambiar. Lo que manda es el servidor.
  const APRUEBA = DEL_SERVIDOR.aprueba;

  // Fechas de la base en 'AAAA-MM-DD' → dd/mm/aaaa, sin pasar por Date (un
  // DATE leído como Date puede caer en el día anterior).
  const f = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
  const fc = s => (s ? f(s).slice(0, 5) : '');
  // Días con su coma. El signo menos es el de verdad (−), no un guion.
  const num = (v, dec = 1) => Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const conSigno = (v, dec = 1) => (v < 0 ? '−' : '') + num(Math.abs(v), dec);
  const DASH = '<span class="text-telecab-muted">—</span>';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const tasa = num(R.tasa, 5);
  // Un día laborado: más de estas horas (06/11/2026).
  const umbralL = num(R.umbralLaborado, 0);
  // Los dos días que libra en unas vacaciones (db/233), en palabras: «miércoles y jueves».
  const DIA_NOMBRE = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const nombresLibra = l => (l || []).map(n => DIA_NOMBRE[Number(n) - 1]).filter(Boolean).join(' y ');
  // Los festivos hasta este día se pagaron (06/11/2026): suman los de después.
  const diaSiguiente = d => (d ? new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10) : '');
  const horasTxt = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return s ? `${h} h ${String(m).padStart(2, '0')} min` : '—'; };

  // EL SALDO, debajo del nombre (lo pidió Camilo así). El color no va solo: el
  // signo y la palabra dicen lo mismo para quien no distingue el rojo.
  function saldoTexto(x) {
    const neg = x.saldo < 0;
    return `<span class="text-telecab-muted">Saldo</span>
      <b class="tabular-nums ${neg ? 'text-telecab-red' : 'text-telecab-text'}">${conSigno(x.saldo)} días</b>`;
  }
  // EL BANCO DE ASUNTOS PROPIOS, al lado y aparte (29/10/2026): no se mezcla con
  // el saldo de vacaciones. Son días enteros.
  const dia = n => `${n} día${Math.abs(n) === 1 ? '' : 's'}`;
  function apTexto(x) {
    const a = x.asuntosPropios || {};
    const neg = a.saldo < 0;
    return `<span class="text-telecab-muted" title="Su banco de asuntos propios: ${R.apPorAnio} días al año, aparte de las vacaciones.">Asuntos propios</span>
      <b class="tabular-nums ${neg ? 'text-telecab-red' : 'text-telecab-text'}">${neg ? '−' : ''}${dia(Math.abs(a.saldo || 0))}</b>`;
  }

  const AYUDA_SALDO = `Generadas: ${tasa} días por cada día trabajado más de ${umbralL} h, con una J aprobada o de baja médica (no las libranzas; sin plaza o antes del planificador, cada día de baja vale 5/7), desde el alta (o desde el ${f(R.desde)}).\n` +
    `+ 1 día por cada festivo en el que trabajó más de ${R.umbralHoras} h, desde el ${f(diaSiguiente(R.festivosPagadosHasta))} (los de antes se pagaron en la nómina).\n− Vacaciones disfrutadas: solo los días que le tocaba trabajar; los dos que libra en cada vacaciones (puestos a mano) no cuentan.\n` +
    `Los asuntos propios van aparte: ${R.apPorAnio} días al año, y cada día que coge resta de ese banco, no de las vacaciones.`;

  const ESTADO_FESTIVO = {
    'suma': '<span class="font-semibold">+1 día</span>',
    // De septiembre de 2026 para atrás (06/11/2026): el festivo trabajado se pagó.
    'pagado': '<span class="text-telecab-muted" title="Los festivos hasta septiembre de 2026 se pagaron en la nómina: no suman vacaciones.">Pagado en nómina</span>',
    'no-suma': `<span class="text-telecab-muted">No (menos de ${R.umbralHoras} h)</span>`,
    'sin-datos': '<span class="text-telecab-muted" title="BOLT no guarda las horas de antes de mediados de junio de 2025.">Sin datos</span>',
    'pendiente': '<span class="text-telecab-warn" title="El sistema calcula las horas de un festivo cuando BOLT ha terminado de mandar ese día.">Calculándose</span>',
    'hoy': '<span class="text-telecab-muted">Hoy</span>',
  };

  const lst = Listado.montar({
    raiz: '#modulo',
    titulo: 'Vacaciones',
    icono: 'fa-umbrella-beach',
    origen: '/vacaciones/api/lista',
    clave: 'id',
    vacio: 'No hay nadie de plantilla propia que coincida.',
    buscar: { campos: ['nombre', 'dni'] },
    // Se abre con los de alta; quien se fue está en «De baja» (21/10/2026).
    filtrosIniciales: { situacion: 'alta' },

    // Solo plantilla propia (16/10/2026): a los de ETT las vacaciones se las da la agencia.
    subtitulo: (visibles, todas) => `${visibles.length} de ${todas.length} personas de plantilla propia · saldo a hoy (a quien se fue, a su baja)`,

    // Las cifras de siempre son de la gente de alta; quien se fue va aparte.
    kpis: todas => {
      const filas = todas.filter(x => !x.deBaja);
      const bajas = todas.filter(x => x.deBaja);
      const pendientes = filas.reduce((s, x) => s + Math.max(0, x.saldo), 0);
      const porLiquidar = bajas.reduce((s, x) => s + Math.max(0, x.saldo), 0);
      const negativos = filas.filter(x => x.saldo < 0).length;
      const hoy = filas.filter(x => x.deVacacionesHasta).length;
      const ap = filas.reduce((s, x) => s + Math.max(0, (x.asuntosPropios || {}).saldo || 0), 0);
      return [
        { etiqueta: 'Personas', valor: filas.length, pie: 'de plantilla propia, de alta' },
        { etiqueta: 'Días por disfrutar', valor: num(pendientes, 0), pie: 'suma de los saldos a favor',
          ayuda: 'Lo que la empresa debe en vacaciones a día de hoy, sumando a todos los que tienen saldo a favor.' },
        { etiqueta: 'Asuntos propios', valor: ap, pie: 'días por coger, entre todos',
          ayuda: `El banco de asuntos propios de cada uno (${R.apPorAnio} días al año, aparte de las vacaciones), sumado.` },
        { etiqueta: 'En negativo', valor: negativos, tono: negativos ? 'red' : 'text', pie: 'han disfrutado más de lo generado',
          filtro: { id: 'saldo', valor: 'negativo' }, ayuda: 'Pulsa para verlos.' },
        { etiqueta: 'De vacaciones hoy', valor: hoy, pie: 'según su ficha',
          filtro: { id: 'saldo', valor: 'hoy' }, ayuda: 'Pulsa para verlos.' },
        { etiqueta: 'Dados de baja', valor: bajas.length, pie: `${num(porLiquidar, 0)} días sin disfrutar a su baja`,
          filtro: { id: 'situacion', valor: 'baja' },
          ayuda: `Quien se fue desde el ${f(R.desde)}: lo que generó y no disfrutó hasta el día de su baja, para su finiquito. Pulsa para verlos.` },
      ];
    },

    nota: () => ({ tono: 'info', icono: 'fa-scale-balanced',
      texto: `Saldo = ${tasa} días por cada día trabajado más de ${umbralL} h, justificado o de baja médica (sin plaza, a 5 de cada 7), desde el alta (o desde el ${f(R.desde)}) · ` +
        `+ 1 día por festivo trabajado más de ${R.umbralHoras} h desde el ${f(diaSiguiente(R.festivosPagadosHasta))} (los de antes se pagaron) · − vacaciones disfrutadas, sin los dos días que libra. ` +
        `Los asuntos propios, aparte: ${R.apPorAnio} días al año, y cada día que coge resta de ese banco.` }),

    filtros: [
      { id: 'situacion', etiqueta: 'Situación', textoTodos: 'De alta y de baja', opciones: [
          { valor: 'alta', texto: 'De alta' },
          { valor: 'baja', texto: 'De baja' },
        ],
        pasa: (x, v) => (v === 'baja' ? x.deBaja : !x.deBaja) },
      { id: 'saldo', etiqueta: 'Saldo', textoTodos: 'Cualquier saldo', opciones: [
          { valor: 'negativo', texto: 'En negativo' },
          { valor: 'mas30', texto: 'Más de 30 días' },
          { valor: 'hoy', texto: 'De vacaciones hoy' },
        ],
        pasa: (x, v) => (v === 'negativo' ? x.saldo < 0 : v === 'mas30' ? x.saldo > 30 : v === 'hoy' ? !!x.deVacacionesHasta : true) },
    ],

    columnas: [
      { titulo: 'Conductor', campo: 'nombre', ayuda: AYUDA_SALDO,
        pinta: (v, x) => `
          <div class="min-w-[14rem]">
            <p class="font-semibold leading-tight">${esc(v)}</p>
            <p class="mt-1 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">${saldoTexto(x)}${
              x.programadas
                ? `<span class="text-xs text-telecab-muted tabular-nums" title="Lo que le quedará cuando pasen las vacaciones ya puestas en su ficha.">→ ${conSigno(x.saldoTras)} tras lo programado</span>` : ''}
              <span class="text-telecab-border" aria-hidden="true">|</span>${apTexto(x)}${
              x.deVacacionesHasta ? etiqueta('De vacaciones hasta el ' + fc(x.deVacacionesHasta), 'green') : ''}${
              x.deBaja ? etiqueta('Baja el ' + f(x.baja) + ' · saldo a esa fecha', 'muted')
                : x.baja ? etiqueta('Baja programada el ' + f(x.baja), 'muted') : ''}</p>
          </div>` },
      { titulo: 'Desde', campo: 'inicio', clase: 'whitespace-nowrap tabular-nums text-sm',
        ayuda: `Desde cuándo se le calcula: su alta, o el ${f(R.desde)} si entró antes (el histórico de vacaciones empieza ahí).`,
        pinta: (v, x) => `${f(v)}${x.desdeElAlta ? '' : '<span class="block text-[11px] text-telecab-muted">alta ' + f(x.alta) + '</span>'}` },
      { titulo: 'Generadas', campo: 'generadas', clase: 'tabular-nums whitespace-nowrap',
        ayuda: `${tasa} días por cada día que trabajó más de ${umbralL} h (viaje + espera de BOLT, el día de la bitácora), con una J aprobada o de baja médica en un día que no libraba. Sin plaza, o antes del planificador (03/09/2026), cada día de baja vale 5/7.`,
        pinta: v => '+' + num(v) },
      { titulo: 'Festivos', campo: 'festivosSuman', clase: 'tabular-nums whitespace-nowrap',
        ayuda: `Festivos nacionales y de la Comunidad de Madrid en los que trabajó más de ${R.umbralHoras} h: cada uno suma 1 día.`,
        pinta: (v, x) => (v ? '+' + v : DASH) + (x.festivosSinDatos
          ? `<span class="block text-[11px] text-telecab-muted" title="Festivos de enero a mayo de 2025: BOLT ya no guarda esas horas.">${x.festivosSinDatos} sin datos</span>` : '') },
      { titulo: 'Disfrutadas', campo: 'disfrutadas', clase: 'tabular-nums whitespace-nowrap',
        pinta: v => (v ? '−' + num(v, 0) : DASH) },
      { titulo: 'Asuntos propios', campo: 'asuntosPropios.saldo', clase: 'tabular-nums whitespace-nowrap',
        ayuda: `Su banco, aparte de las vacaciones: ${R.apPorAnio} días al año, menos los que ha cogido. Lo que queda, de lo que lleva sumado.`,
        pinta: (v, x) => `${v} de ${x.asuntosPropios.generados}` + (x.asuntosPropios.programados
          ? `<span class="block text-[11px] text-telecab-muted">${x.asuntosPropios.programados} programado(s)</span>` : '') },
      { titulo: 'Programadas', campo: 'programadas', clase: 'tabular-nums whitespace-nowrap',
        ayuda: 'Vacaciones ya puestas en su ficha de mañana en adelante. No restan del saldo de hoy.',
        pinta: v => (v ? num(v, 0) + ' días' : DASH) },
      { titulo: 'Saldo', campo: 'saldo', soloExcel: true },
      { titulo: 'Saldo tras lo programado', campo: 'saldoTras', soloExcel: true },
      { titulo: 'Asuntos propios sumados', campo: 'asuntosPropios.generados', soloExcel: true },
      { titulo: 'Asuntos propios cogidos', campo: 'asuntosPropios.usados', soloExcel: true },
      { titulo: 'Asuntos propios programados', campo: 'asuntosPropios.programados', soloExcel: true },
      { titulo: 'DNI / NIE', campo: 'dni', soloExcel: true },
      { titulo: 'Baja', campo: 'baja', soloExcel: true, valor: x => (x.deBaja ? f(x.baja) : '') },
      { titulo: 'Motivo de la baja', campo: 'motivoBaja', soloExcel: true, valor: x => (x.deBaja ? x.motivoBaja : '') },
    ],

    detalle: {
      origen: id => `/vacaciones/api/ficha/${encodeURIComponent(id)}`,
      titulo: d => d.nombre,
      subtitulo: d => `Alta ${f(d.alta)}` + (d.deBaja ? ` · baja ${f(d.baja)}` : '') + ` · contrato ${d.contrato}` +
        (d.desdeElAlta ? '' : ` · se le calcula desde el ${f(d.inicio)}`),

      acciones: [
        // SIMULAR UNAS VACACIONES (06/11/2026): qué días cuentan y cuáles libra.
        { texto: 'Simular vacaciones', icono: 'fa-calendar-days', principal: true,
          visible: d => !d.deBaja, onClick: d => simular(d) },
        { texto: 'Abrir en Plantilla', icono: 'fa-id-card',
          onClick: d => { window.location.href = '/plantilla#' + encodeURIComponent(d.id); } },
      ],

      bloques: [
        { titulo: 'Saldo', icono: 'fa-scale-balanced', pinta: (d, hueco) => { hueco.innerHTML = extracto(d); } },
        { titulo: 'Asuntos propios', icono: 'fa-user-clock', pinta: (d, hueco) => { hueco.innerHTML = extractoAP(d); } },
        // LOS DÍAS LABORADOS, MES A MES (06/11/2026): de dónde sale lo generado.
        {
          titulo: 'Días laborados, mes a mes', icono: 'fa-calendar-check',
          pinta: (d, hueco) => { hueco.innerHTML = mesAMes(d); },
        },
        {
          titulo: 'Festivos', icono: 'fa-calendar-day',
          tabla: {
            datos: d => d.detalle.festivos.slice().reverse(),
            vacio: 'Ningún festivo desde que se le calcula.',
            columnas: [
              { titulo: 'Fecha', campo: 'fecha', clase: 'whitespace-nowrap tabular-nums', pinta: v => f(v) },
              { titulo: 'Festivo', campo: 'nombre', pinta: (v, x) => esc(v) + `<span class="block text-[11px] text-telecab-muted">${x.ambito === 'madrid' ? 'Comunidad de Madrid' : 'Nacional'}</span>` },
              { titulo: 'Trabajó', campo: 'segundos', clase: 'whitespace-nowrap tabular-nums',
                pinta: (v, x) => (x.estado === 'sin-datos' || x.estado === 'pendiente' || x.estado === 'hoy' ? DASH : horasTxt(v)) },
              { titulo: 'Suma', campo: 'estado', clase: 'whitespace-nowrap', pinta: v => ESTADO_FESTIVO[v] || esc(v) },
            ],
          },
        },
        {
          titulo: 'Vacaciones', icono: 'fa-umbrella-beach',
          tabla: {
            datos: d => d.detalle.vacaciones.slice().reverse(),
            vacio: 'Sin vacaciones desde que se le calcula.',
            columnas: [
              { titulo: 'Desde', campo: 'desde', clase: 'whitespace-nowrap tabular-nums', pinta: v => f(v) },
              { titulo: 'Hasta', campo: 'hasta', clase: 'whitespace-nowrap tabular-nums', pinta: v => f(v) || DASH },
              { titulo: 'Días', campo: 'dias', clase: 'tabular-nums', ayuda: 'Días naturales, del primero al último.' },
              { titulo: 'Libranzas', campo: 'libranzas', clase: 'whitespace-nowrap tabular-nums',
                ayuda: 'Los días que libra en esas vacaciones: no cuentan. Las nuevas llevan sus dos días puestos a mano; las de antes, los del cuadrante.',
                pinta: (v, x) => (v ? String(v) : DASH) + ((x.libraDias || []).length
                  ? `<span class="block text-[11px] text-telecab-muted" title="Puestos a mano al aprobarlas">libra ${esc(nombresLibra(x.libraDias))}</span>` : '') + (x.sinCuadrante
                  ? `<span class="block text-[11px] text-telecab-muted" title="Antes del planificador (03/09/2026), o sin plaza: no se sabe qué libraba y el día cuenta.">${x.sinCuadrante} sin cuadrante</span>` : '') },
              { titulo: 'Cuentan', campo: 'disfrutados', clase: 'whitespace-nowrap tabular-nums',
                pinta: (v, x) => (x.programados && !v ? '<span class="text-telecab-muted">programadas</span>'
                  : (v ? '−' + v : DASH) + (x.programados ? `<span class="block text-[11px] text-telecab-muted">y ${x.programados} programado(s)</span>` : '')) },
              // Sin motivo, lo único que dice de dónde sale es quién lo puso a mano.
              { titulo: 'De dónde sale', campo: 'motivo', pinta: (v, x) => (v ? `<span class="text-sm text-telecab-muted">${esc(v)}</span>`
                  : x.quien ? `<span class="text-sm text-telecab-muted">Lo puso ${esc(x.quien)} el ${f(x.puesto)}</span>` : DASH) },
              // El ticket del que salieron: sigue unido al tramo aunque se cambien las fechas.
              { titulo: 'Ticket', campo: 'ticket', clase: 'whitespace-nowrap',
                pinta: v => (v ? `<a href="/ticketera?ticket=${encodeURIComponent(v.codigo)}" title="Abrir el ticket del que salieron"
                    class="px-1.5 py-0.5 rounded-md text-[11px] border border-telecab-border text-telecab-muted hover:text-telecab-gold hover:border-telecab-gold transition">
                    <i class="fa-solid fa-ticket mr-1"></i>${esc(v.codigo)}</a>` : DASH) },
            ],
            // CAMBIAR LAS FECHAS (16/10/2026): solo las que aún no han pasado, y
            // solo quien las aprueba.
            acciones: [
              { icono: 'fa-pen', titulo: 'Cambiar las fechas', onClick: cambiar,
                visible: x => APRUEBA.puede && x.editable },
            ],
          },
        },
        {
          titulo: 'Asuntos propios, permisos y suspensiones', icono: 'fa-file-signature',
          visible: d => d.detalle.asuntos.length > 0 || d.detalle.permisos.length > 0 || d.detalle.suspensiones.length > 0,
          tabla: {
            datos: d => d.detalle.asuntos.map(x => ({ ...x, clase: 'asuntos' }))
              .concat(d.detalle.permisos.map(x => ({ ...x, clase: 'permiso' })))
              .concat(d.detalle.suspensiones.map(x => ({ ...x, clase: 'suspension' })))
              .sort((a, b) => b.desde.localeCompare(a.desde)),
            columnas: [
              { titulo: 'Qué', campo: 'clase', pinta: (v, x) => (v === 'asuntos' ? 'Asuntos propios'
                  : v === 'permiso'
                  ? 'Permiso retribuido' + (x.tipo ? `<span class="block text-[11px] text-telecab-muted">${esc(x.tipo)}</span>` : '')
                  : (x.estado === 'suspension_permiso' ? 'Suspensión por retirada del permiso' : 'Suspensión')) },
              { titulo: 'Desde', campo: 'desde', clase: 'whitespace-nowrap tabular-nums', pinta: v => f(v) },
              { titulo: 'Hasta', campo: 'hasta', clase: 'whitespace-nowrap tabular-nums', pinta: v => f(v) || 'sin fecha' },
              { titulo: 'Efecto', campo: 'clase', clase: 'whitespace-nowrap tabular-nums',
                pinta: (v, x) => (v === 'asuntos'
                  ? (x.usados ? `−${x.usados} del banco de asuntos propios` : '') +
                    (x.programados ? `${x.usados ? '<br>' : ''}<span class="text-telecab-muted">${x.programados} programado(s)</span>` : '')
                  : v === 'permiso' ? '<span class="text-telecab-muted" title="Los permisos retribuidos no tocan las vacaciones.">No resta</span>'
                  : `${x.sinGenerar} día(s) de vacaciones sin generar`) },
              { titulo: 'Motivo', campo: 'motivo', pinta: v => (v ? `<span class="text-sm text-telecab-muted">${esc(v)}</span>` : DASH) },
            ],
          },
        },
      ],
    },
  });

  /**
   * SIMULA UNAS VACACIONES (06/11/2026). Camilo: «en un calendario, simula los
   * días que X trabajador ha pedido. Si pongo por ejemplo de 11/08 al 12/09, me
   * tiene que decir cuántos días de libranza coge el trabajador saltando también
   * sus futuras libranzas». Pide las fechas, el servidor dice día a día qué le
   * tocaba (su plaza; si ese día no tiene, la última) y aquí se pinta el
   * calendario. No guarda nada.
   */
  // Los dos días que libra en unas vacaciones (db/233): lo que propone el
  // planificador y el texto que lo explica. Si no responde, se eligen igual.
  async function propuestaLibra(id, desde) {
    try {
      const r = await fetch(`/vacaciones/api/libranzas/${encodeURIComponent(id)}${desde ? '?desde=' + encodeURIComponent(desde) : ''}`);
      const j = await r.json();
      if (r.ok && j.status === 'ok') return j.libranzas;
    } catch (e) { /* sin propuesta */ }
    return { propuestos: [], texto: '' };
  }
  const NOTA_LIBRA = 'Siempre dos días. Solo valen para estas vacaciones: esos días no cuentan y, al volver, libra lo que diga el planificador.';

  async function simular(d, antes) {
    // LOS DOS DÍAS QUE LIBRA, A MANO (06/11/2026). Camilo: «En el simulador debe
    // de decir los días que libra pero A MANO … sí o sí tienen que ser dos días».
    // Se proponen los del planificador; quien simula los cambia.
    const sug = antes ? { propuestos: antes.libra, texto: '' } : await propuestaLibra(d.id);
    const v = await Dialogo.formulario(`Simular vacaciones de ${d.nombre}`, [
      { id: 'desde', etiqueta: 'Primer día', tipo: 'fecha', obligatorio: true, valor: antes ? f(antes.desde) : '' },
      { id: 'hasta', etiqueta: 'Último día', tipo: 'fecha', obligatorio: true, valor: antes ? f(antes.hasta) : '' },
      { id: 'libra', etiqueta: 'Los dos días que libra en las vacaciones', tipo: 'semana', exactos: 2,
        valor: sug.propuestos || [], ayuda: sug.texto || NOTA_LIBRA },
    ], { textoBoton: 'Simular', textoCancelar: 'Cerrar',
         nota: 'Cuentan todos los días menos los dos que libra cada semana. Sus libranzas del planificador no cambian: al volver, libra lo suyo. No se guarda nada.' });
    if (!v) return;
    let s;
    try {
      const q = new URLSearchParams({ desde: Dialogo.aISO(v.desde) || v.desde, hasta: Dialogo.aISO(v.hasta) || v.hasta, libra: (v.libra || []).join(',') });
      const r = await fetch(`/vacaciones/api/simular/${encodeURIComponent(d.id)}?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status !== 'ok') throw new Error(j.msg || `Error ${r.status}`);
      s = j.simulacion;
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se ha podido simular', texto: e.message, tono: 'error' });
      return;
    }
    const otra = await Dialogo.elegir({
      titulo: `${d.nombre}: del ${f(s.desde)} al ${f(s.hasta)}`, tono: 'info', ancho: 'max-w-3xl',
      html: calendario(s),
      opciones: [{ texto: 'Otras fechas', valor: 'otra' }, { texto: 'Cerrar', valor: true, principal: true }],
    });
    if (otra === 'otra') return simular(d, s);
  }

  // El calendario de la simulación: un mes por bloque, de lunes a domingo.
  function calendario(s) {
    const SEM = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const porMes = new Map();
    s.dias.forEach(x => { const m = x.dia.slice(0, 7); if (!porMes.has(m)) porMes.set(m, []); porMes.get(m).push(x); });
    const celda = x => {
      const n = Number(x.dia.slice(8));
      const titulo = [x.cuenta ? 'Cuenta como vacaciones' : 'Libra: no cuenta',
        x.por === 'a-mano' ? '' :
        x.por === 'su-ultima-plaza' ? 'según la última plaza que tuvo' : x.por === 'excepcional' ? 'libranza excepcional'
          : x.trabaja === null ? (x.por === 'antes-del-cuadrante' ? 'antes del planificador: no se sabe si libraba' : 'sin plaza: no se sabe si libraba') : '',
        x.festivo ? 'Festivo: ' + x.festivo : '', x.ya ? 'Ya tiene puesto: ' + x.ya.replace(/_/g, ' ') : ''].filter(Boolean).join(' · ');
      const clase = !x.cuenta
        ? 'bg-telecab-card2 text-telecab-muted line-through decoration-telecab-muted/60'
        : x.trabaja === null ? 'bg-telecab-card2 text-telecab-text border border-dashed border-telecab-warn/70'
          : 'bg-telecab-gold/20 text-telecab-text border border-telecab-gold/40 font-semibold';
      return `<div class="h-9 rounded-lg flex flex-col items-center justify-center text-sm tabular-nums relative ${clase}" title="${esc(titulo)}">
        <span>${n}</span>${x.ya ? '<span class="absolute top-0.5 right-1 w-1.5 h-1.5 rounded-full bg-telecab-text/60" aria-hidden="true"></span>' : ''}
        ${x.festivo ? '<span class="absolute bottom-0.5 left-1 text-[9px] leading-none text-telecab-gold" aria-hidden="true">F</span>' : ''}</div>`;
    };
    const mes = (m, lista) => {
      const hueco = lista[0].dow - 1;
      return `<div>
        <p class="text-sm font-semibold mb-2">${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</p>
        <div class="grid grid-cols-7 gap-1 text-[11px] text-telecab-muted text-center mb-1">${SEM.map(x => `<span>${x}</span>`).join('')}</div>
        <div class="grid grid-cols-7 gap-1">${'<div></div>'.repeat(hueco)}${lista.map(celda).join('')}</div>
      </div>`;
    };
    const neg = s.quedaria < 0;
    const cifra = (txt, valor, nota) => `<div class="rounded-xl bg-telecab-card2 border border-telecab-border px-3 py-2">
        <p class="text-xs text-telecab-muted">${txt}</p><p class="text-xl font-bold tabular-nums">${valor}</p>${nota ? `<p class="text-[11px] text-telecab-muted">${nota}</p>` : ''}</div>`;
    const avisos = [];
    if (s.yaDeVacaciones) avisos.push(`${s.yaDeVacaciones} de esos días ya los tiene de vacaciones: no se cuentan dos veces.`);
    if (s.otraAusencia) avisos.push(`${s.otraAusencia} día(s) ya tienen otra ausencia puesta (punto en el día).`);
    if (s.sinCuadrante) avisos.push(`${s.sinCuadrante} día(s) sin cuadrante (antes del 03/09/2026 o sin plaza): no se sabe si libraba y cuentan.`);
    const plan = s.segunPlanificador || [];
    if (String(plan) !== String(s.libra || [])) {
      avisos.push(plan.length ? `El planificador le tiene libranza el ${nombresLibra(plan)}; en las vacaciones libra el ${nombresLibra(s.libra)}, y al volver, lo del planificador.`
        : s.sinPlan ? 'El planificador no dice qué libra (sin plaza o antes del 03/09/2026).' : 'Según el planificador no libra ningún día esa semana.');
    }
    return `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        ${cifra('Días naturales', s.naturales)}
        ${cifra('Libranzas', s.libranzas, 'libra ' + nombresLibra(s.libra) + ', a mano')}
        ${cifra('Vacaciones que gasta', s.cuentan, 'días que le toca trabajar')}
        ${cifra('Le quedarían', `<span class="${neg ? 'text-telecab-red' : ''}">${conSigno(s.quedaria, 2)}</span>`, `hoy ${conSigno(s.saldo, 2)}${s.programadas ? `, ${s.programadas} ya programadas` : ''}`)}
      </div>
      ${avisos.length ? `<p class="text-sm text-telecab-warn mb-3">${avisos.map(esc).join(' ')}</p>` : ''}
      <div class="grid sm:grid-cols-2 gap-5 max-h-[52vh] overflow-y-auto pr-1">${[...porMes].map(([m, l]) => mes(m, l)).join('')}</div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs text-telecab-muted">
        <span><span class="inline-block w-3 h-3 rounded bg-telecab-gold/20 border border-telecab-gold/40 align-middle mr-1"></span>Cuenta como vacaciones</span>
        <span><span class="inline-block w-3 h-3 rounded bg-telecab-card2 align-middle mr-1"></span>Libra: no cuenta</span>
        <span><span class="text-telecab-gold font-semibold mr-1">F</span>Festivo</span>
      </div>`;
  }

  /**
   * CAMBIA UNAS VACACIONES YA APROBADAS. Solo lo que aún no ha llegado: si ya
   * empezaron, el primer día se queda (no se pregunta) y solo se mueve la
   * vuelta. El servidor lo vuelve a mirar todo: esto solo evita pedir lo que no
   * se puede.
   */
  async function cambiar(x, d) {
    const hoy = d.hoy;
    const campos = [];
    if (!x.empezadas) campos.push({ id: 'desde', etiqueta: 'Primer día', tipo: 'fecha', valor: f(x.desde) });
    campos.push(
      { id: 'hasta', etiqueta: 'Último día', tipo: 'fecha', valor: f(x.hasta),
        ayuda: 'El último día de vacaciones. Al siguiente vuelve al cuadrante solo.' });
    // Los dos días que libra (db/233), mientras no hayan empezado. Las de antes
    // no los tienen: se proponen los del planificador y hay que elegirlos.
    // Las empezadas que aún no los llevan (de antes de db/233) los reciben una vez.
    if (!x.empezadas || !(x.libraDias || []).length) {
      const sug = (x.libraDias || []).length ? { propuestos: x.libraDias, texto: '' } : await propuestaLibra(d.id, x.desde);
      campos.push({ id: 'libraDias', etiqueta: 'Los dos días que libra en las vacaciones', tipo: 'semana', exactos: 2,
        valor: sug.propuestos || [], ayuda: sug.texto || NOTA_LIBRA });
    }
    campos.push({ id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', valor: x.motivo || '' });
    const nota = (x.empezadas
      ? `Empezaron el ${f(x.desde)}: ese día ya pasó y se queda. Se puede adelantar la vuelta (como pronto, hoy) o retrasarla.`
      : 'Solo a días que aún no han llegado: como pronto, desde mañana.') +
      (x.ticket ? ` Siguen unidas al ticket ${x.ticket.codigo}, que apunta el cambio en su historia.` : '');
    const v = await Dialogo.formulario(`Cambiar las vacaciones de ${d.nombre}`, campos, { nota, textoBoton: 'Cambiar las fechas' });
    if (!v) return;
    try {
      const r = await fetch(`/vacaciones/api/conductor/${encodeURIComponent(d.id)}/vacaciones/${encodeURIComponent(x.fila)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desde: v.desde || x.desde, hasta: v.hasta, motivo: v.motivo, ...(v.libraDias ? { libraDias: v.libraDias } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status !== 'ok') throw new Error(j.msg || `Error ${r.status}`);
      Dialogo.hecho('Vacaciones cambiadas' + (j.ticket ? ` · apuntado en ${j.ticket}` : ''));
      await lst.recargar();
      await lst.abrir(d.id, { historial: false });
    } catch (e) {
      await Dialogo.aviso({ titulo: 'No se han cambiado', texto: e.message, tono: 'error' });
    }
  }

  // EL DESGLOSE, como un extracto: cada línea con su signo y de dónde sale, y
  // el saldo debajo de la raya. Es la forma que se lee sin explicarla.
  function extracto(d) {
    const linea = (concepto, valor, explica, signo) => `
      <div class="flex items-baseline gap-4 py-2.5 border-b border-telecab-border/60">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">${concepto}</p>
          ${explica ? `<p class="text-xs text-telecab-muted mt-0.5">${explica}</p>` : ''}
        </div>
        <p class="tabular-nums text-right whitespace-nowrap font-semibold w-28">${signo} ${num(valor, 2)}</p>
      </div>`;
    const fest = d.detalle.festivos.length;
    const sinD = d.festivosSinDatos ? ` · ${d.festivosSinDatos} sin datos` : '';
    const pend = d.festivosPendientes ? ` · ${d.festivosPendientes} calculándose` : '';
    // Los de septiembre para atrás se pagaron en la nómina (06/11/2026): no suman.
    const pagados = d.detalle.festivos.filter(x => x.estado === 'pagado').length;
    const pag = pagados ? ` · ${pagados} hasta el ${f(R.festivosPagadosHasta)}, pagados en nómina` : '';
    const neg = d.saldo < 0;
    const tramosVac = d.detalle.vacaciones.filter(v => v.disfrutados).length;
    const libVac = d.detalle.vacaciones.reduce((n, v) => n + (v.libranzas || 0), 0);
    return `
      <div class="px-5 py-2">
        ${linea('Generadas', d.generadas, `${num(d.diasQueGeneran, Number.isInteger(d.diasQueGeneran) ? 0 : 2)} día(s) desde el ${f(d.inicio)} × ${tasa}: ${generanTxt(d)}`, '+')}
        ${linea('Festivos trabajados', d.festivosSuman, `${d.festivosSuman} de ${fest - pagados} festivo(s) con más de ${R.umbralHoras} h${pag}${sinD}${pend}`, '+')}
        ${linea('Vacaciones disfrutadas', d.disfrutadas, (tramosVac ? `${tramosVac} tramo(s) hasta ${d.deBaja ? 'su baja' : 'hoy'}` : `Ninguna hasta ${d.deBaja ? 'su baja' : 'hoy'}`) + (libVac ? ` · sin ${libVac} día(s) de libranza, que no cuentan` : ''), '−')}
        <div class="flex items-baseline gap-4 pt-4 pb-2">
          <p class="flex-1 text-sm font-semibold uppercase tracking-wide text-telecab-muted">${d.deBaja ? 'Saldo a su baja (' + f(d.baja) + ')' : 'Saldo a hoy'}</p>
          <p class="tabular-nums text-right whitespace-nowrap">
            <span class="text-3xl font-bold ${neg ? 'text-telecab-red' : 'text-telecab-text'}">${conSigno(d.saldo, 2)}</span>
            <span class="text-sm text-telecab-muted ml-1">días${neg ? ' en contra' : ''}</span>
          </p>
        </div>
        ${d.programadas ? `
          <div class="mt-1 mb-2 rounded-xl bg-telecab-card2 border border-telecab-border px-4 py-3 text-sm flex items-baseline gap-4">
            <p class="flex-1 text-telecab-muted">Ya programado en su ficha: ${d.programadas} día(s) de vacaciones.
              Cuando pasen le quedarán</p>
            <p class="tabular-nums font-semibold whitespace-nowrap">${conSigno(d.saldoTras, 2)} días</p>
          </div>` : ''}
      </div>`;
  }

  // De qué salen los días que generan (06/11/2026).
  function generanTxt(d) {
    const partes = [`${d.diasLaborados} trabajado(s) más de ${umbralL} h`];
    if (d.diasJustificados) partes.push(`${d.diasJustificados} justificado(s)`);
    if (d.diasBaja) partes.push(`${d.diasBaja} de baja médica`);
    // Sin saber qué libraría (sin plaza, o antes del planificador): 5 de cada 7.
    if (d.diasBajaSupuestos) partes.push(`${d.diasBajaSupuestos} de baja sin plaza o antes del planificador, a 5 de cada 7 (${num(d.diasBajaSupuestos * 5 / 7, 2)})`);
    return partes.join(' · ');
  }
  // Los días de baja de un mes: los de su plaza, y los que no se sabe a 5/7.
  const bajasMes = m => {
    if (!m.bajas && !m.bajasSupuestas) return '—';
    const s = m.bajasSupuestas
      ? `<span class="block text-[11px] text-telecab-muted" title="Sin plaza, o antes del planificador (03/09/2026): no se sabe qué libraría y cada día vale 5/7.">${m.bajasSupuestas} sin plaza o antes del 03/09 × 5/7</span>` : '';
    return (m.bajas ? String(m.bajas) : '') + s;
  };

  // LOS DÍAS LABORADOS, MES A MES (06/11/2026): cuántos días pasaron de las
  // horas que hacen falta, cuántos se quedaron cortos y lo que generó cada mes.
  function mesAMes(d) {
    const meses = (d.detalle.meses || []).slice().reverse();
    const nota = R.sinHistorico || (d.reglas && d.reglas.sinHistorico)
      ? `<p class="text-sm text-telecab-warn mt-3">Falta aplicar la migración db/231: los días de antes del ${f(R.nucleoDesde || '2026-07-01')} todavía no cuentan.</p>`
      : `<p class="text-xs text-telecab-muted mt-3">Generan los días que trabajó más de ${umbralL} h (viaje + espera de BOLT, por el día de la bitácora; antes del 01/07/2026, del historial de estados de BOLT), los que tienen una J aprobada y los de baja médica que le tocaba trabajar (sin plaza, o antes del planificador, cada día de baja vale 5/7). Las libranzas, las vacaciones y las ausencias sin justificar no. Lo de hoy y ayer suma cuando la bitácora cierra la jornada.</p>`;
    if (!meses.length) return `<div class="px-5 py-4"><p class="text-sm text-telecab-muted">Ningún día trabajado desde el ${f(d.inicio)}.</p>${nota}</div>`;
    const fila = m => `
      <tr class="border-t border-telecab-border/60">
        <td class="py-2 pr-3 whitespace-nowrap">${MESES[Number(m.mes.slice(5)) - 1]} ${m.mes.slice(0, 4)}</td>
        <td class="py-2 px-3 text-right tabular-nums font-semibold">${m.laborados}</td>
        <td class="py-2 px-3 text-right tabular-nums">${m.justificados || '—'}</td>
        <td class="py-2 px-3 text-right tabular-nums">${bajasMes(m)}</td>
        <td class="py-2 px-3 text-right tabular-nums text-telecab-muted">${m.cortos || '—'}</td>
        <td class="py-2 px-3 text-right tabular-nums whitespace-nowrap">${horasTxt(m.segundos)}</td>
        <td class="py-2 pl-3 text-right tabular-nums whitespace-nowrap">+ ${num(m.generadas, 2)}</td>
      </tr>`;
    return `
      <div class="px-5 py-3 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-xs text-telecab-muted">
            <tr>
              <th class="text-left font-medium pb-1 pr-3">Mes</th>
              <th class="text-right font-medium pb-1 px-3" title="Días que trabajó más de ${umbralL} h.">Trabajó más de ${umbralL} h</th>
              <th class="text-right font-medium pb-1 px-3" title="Días con una J aprobada (y sin llegar a ${umbralL} h).">Justificados</th>
              <th class="text-right font-medium pb-1 px-3" title="Días de baja médica que le tocaba trabajar: los que caían en su libranza no suman. Sin plaza, o antes del planificador (03/09/2026), cada día vale 5/7.">Baja médica</th>
              <th class="text-right font-medium pb-1 px-3" title="Días que trabajó, pero no más de ${umbralL} h, y sin J: no suman.">${umbralL} h o menos</th>
              <th class="text-right font-medium pb-1 px-3">Horas del mes</th>
              <th class="text-right font-medium pb-1 pl-3">Generadas</th>
            </tr>
          </thead>
          <tbody>${meses.map(fila).join('')}</tbody>
        </table>
        ${nota}
      </div>`;
  }

  // EL BANCO DE ASUNTOS PROPIOS, con la misma forma de extracto y aparte del
  // saldo de vacaciones (29/10/2026). Días enteros.
  function extractoAP(d) {
    const a = d.asuntosPropios;
    const linea = (concepto, valor, explica, signo) => `
      <div class="flex items-baseline gap-4 py-2.5 border-b border-telecab-border/60">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">${concepto}</p>
          ${explica ? `<p class="text-xs text-telecab-muted mt-0.5">${explica}</p>` : ''}
        </div>
        <p class="tabular-nums text-right whitespace-nowrap font-semibold w-28">${signo} ${valor}</p>
      </div>`;
    const hasta = d.deBaja ? 'su baja' : 'hoy';
    const anios = a.anios === 1 ? `${a.desde}` : `de ${a.desde} a ${Number(a.desde) + a.anios - 1}`;
    const veces = d.detalle.asuntos.filter(x => x.usados).length;
    const neg = a.saldo < 0;
    return `
      <div class="px-5 py-2">
        ${linea('Sumados', a.generados, `${a.porAnio} días por año (${anios}). Lo que no se coge se queda en el banco.`, '+')}
        ${linea('Cogidos', a.usados, veces ? `${veces === 1 ? 'Una vez' : veces + ' veces'} hasta ${hasta}; cada día resta uno entero` : `Ninguno hasta ${hasta}`, '−')}
        <div class="flex items-baseline gap-4 pt-4 pb-2">
          <p class="flex-1 text-sm font-semibold uppercase tracking-wide text-telecab-muted">${d.deBaja ? 'Le quedaban a su baja' : 'Le quedan'}</p>
          <p class="tabular-nums text-right whitespace-nowrap">
            <span class="text-3xl font-bold ${neg ? 'text-telecab-red' : 'text-telecab-text'}">${neg ? '−' : ''}${Math.abs(a.saldo)}</span>
            <span class="text-sm text-telecab-muted ml-1">${Math.abs(a.saldo) === 1 ? 'día' : 'días'}${neg ? ' en contra' : ''}</span>
          </p>
        </div>
        ${a.programados ? `
          <div class="mt-1 mb-2 rounded-xl bg-telecab-card2 border border-telecab-border px-4 py-3 text-sm flex items-baseline gap-4">
            <p class="flex-1 text-telecab-muted">Ya programado en su ficha: ${a.programados} día(s) de asuntos propios. Cuando pasen le quedarán</p>
            <p class="tabular-nums font-semibold whitespace-nowrap">${a.saldoTras} días</p>
          </div>` : ''}
        <p class="text-xs text-telecab-muted pb-2">No toca las vacaciones: se pone en Plantilla con la situación «Asuntos propios».</p>
      </div>`;
  }
})();
