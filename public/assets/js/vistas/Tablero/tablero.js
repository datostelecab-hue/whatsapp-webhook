// modules/Tablero/vistas/tablero.ejs — el tablero de tareas (ítem 1, entrega 1b).
//
// Las vistas en pestañas (Pestanas), las columnas con arrastrar y soltar
// (Kanban), la ficha al lado (Panel) y la lista (Listado). Lo que se puede
// hacer con cada tarjeta lo dice el servidor en `tarjeta.puede`: aquí solo se
// enseñan esos botones, y el servidor lo vuelve a comprobar.

(function () {
  const esc = Casa.esc;
  const API = '/tablero/api';
  const FINALES = ['cerrada', 'rechazada', 'anulada'];
  const TRABAJANDO = ['por_hacer', 'en_curso', 'bloqueada'];

  const COLUMNAS = {
    trabajo: [
      { id: 'por_aprobar', titulo: 'Por aprobar', vacia: 'Nada esperando aprobación' },
      { id: 'por_hacer', titulo: 'Por hacer', vacia: 'Nada por hacer' },
      { id: 'en_curso', titulo: 'En curso', vacia: 'Nada en curso' },
      { id: 'bloqueada', titulo: 'Bloqueada', vacia: 'Nada bloqueado' },
      { id: 'cerrada', titulo: 'Cerrada', vacia: 'Nada cerrado estos 14 días' },
    ],
    pendientes: [
      { id: 'por_aprobar', titulo: 'Por aprobar', vacia: 'Ninguna tarea espera tu aprobación' },
      { id: 'por_asignar', titulo: 'Por asignar', vacia: 'Ninguna tarjeta por asignar' },
    ],
  };

  const yo = { id: null, aprueba: false, asigna: false, todos: false };
  let personas = [];
  let vista = 'mias';
  let kanban = null;
  let lista = null;
  let panel = null;          // { id, p } la ficha abierta
  let pidiendo = null;
  let otraVez = false;       // se pidió recargar mientras otra recarga estaba en marcha
  // Cada lectura de la ficha lleva su número: una que se pidió ANTES de un
  // cambio y llega DESPUÉS no puede pintar encima de lo nuevo.
  let turnoFicha = 0;

  // ── Formatos ────────────────────────────────────────────────────────────
  const dia = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const fechaHora = v => {
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const iniciales = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
  const nombreDe = id => (personas.find(p => p.id === id) || {}).nombre || `#${id}`;

  /** «Vence hoy», «Quedan 3 días», «Vencida (12/11)». Vacío sin plazo. */
  function semaforo(t, { largo = false } = {}) {
    const s = t.plazo && t.plazo.semaforo;
    if (!s) return t.plazo && t.plazo.venceEl && !FINALES.includes(t.estado)
      ? `<span class="text-telecab-muted">Vence el ${esc(dia(t.plazo.venceEl))}</span>` : '';
    const q = t.plazo.quedan;
    const texto = s === 'rojo' ? `Vencida${largo ? ' el ' + dia(t.plazo.venceEl) : ` (${dia(t.plazo.venceEl).slice(0, 5)})`}`
      : s === 'amarillo' ? 'Vence hoy'
        : `${q === 1 ? 'Queda 1 día' : `Quedan ${q} días`}${largo ? ` · vence el ${dia(t.plazo.venceEl)}` : ''}`;
    return `<span class="tc-semaforo tc-semaforo--${s}" title="Vence el ${esc(dia(t.plazo.venceEl))} (días hábiles)">${esc(texto)}</span>`;
  }

  const TONO_ESTADO = { por_aprobar: 'aviso', por_asignar: 'aviso', por_hacer: '', en_curso: 'azul', bloqueada: 'rojo', cerrada: 'verde', rechazada: '', anulada: '' };
  const pastillaEstado = t => `<span class="tc-pastilla ${TONO_ESTADO[t.estado] ? 'tc-pastilla--' + TONO_ESTADO[t.estado] : ''}">${esc(t.estadoEtiqueta)}</span>`;
  const pastillaTipo = t => `<span class="tc-pastilla ${t.tipo === 'ticket' ? 'tc-pastilla--azul' : 'tc-pastilla--oro'}">${esc(t.tipoEtiqueta)}</span>`;

  // ── La tarjeta en una columna ───────────────────────────────────────────
  function pintaTarjeta(t) {
    const resp = t.responsable;
    return `
      <p class="tc-tarjeta-titulo">${t.sensible ? '<i class="fa-solid fa-lock text-telecab-muted mr-1" aria-hidden="true" title="Con datos sensibles: se miran en su origen"></i>' : ''}${esc(t.titulo)}</p>
      <div class="tc-tarjeta-pie">
        ${pastillaTipo(t)}
        ${semaforo(t)}
        ${t.comentarios ? `<span title="${t.comentarios} comentario${t.comentarios === 1 ? '' : 's'}"><i class="fa-regular fa-comment" aria-hidden="true"></i> ${t.comentarios}</span>` : ''}
        ${t.colaboradores.length ? `<span title="${t.colaboradores.length} colaborando"><i class="fa-solid fa-user-group" aria-hidden="true"></i> ${t.colaboradores.length}</span>` : ''}
        <span class="ml-auto">${resp
          ? `<span class="tc-iniciales" title="Lleva: ${esc(resp.nombre)}">${esc(iniciales(resp.nombre))}</span>`
          : '<span class="text-telecab-muted" title="Sin responsable">Sin asignar</span>'}</span>
      </div>`;
  }

  function nombreTarjeta(t) {
    const partes = [t.titulo, t.tipoEtiqueta, t.estadoEtiqueta];
    if (t.responsable) partes.push('lleva ' + t.responsable.nombre);
    if (t.plazo && t.plazo.semaforo === 'rojo') partes.push('vencida');
    return partes.join(', ');
  }

  // ── Traer ───────────────────────────────────────────────────────────────
  async function traer(v) {
    const r = await Api.get(`${API}/tarjetas?vista=${encodeURIComponent(v)}`);
    return r.tarjetas || [];
  }

  /** Todas las que veo (para la lista): las de cada vista, sin repetir. */
  async function todas() {
    const vistas = ['mias', 'equipo'].concat(yo.aprueba || yo.asigna ? ['pendientes'] : []);
    const grupos = await Promise.all(vistas.map(traer));
    const porId = new Map();
    grupos.flat().forEach(t => porId.set(t.id, t));
    return [...porId.values()];
  }

  // ── Las columnas ────────────────────────────────────────────────────────
  function montarKanban() {
    const columnas = vista === 'pendientes' ? COLUMNAS.pendientes : COLUMNAS.trabajo;
    // Cada vista en un elemento nuevo: montar dos veces sobre el mismo
    // engancharía sus clics dos veces.
    const caja = document.querySelector('#t-tablero');
    caja.innerHTML = '<div></div>';
    kanban = Kanban.montar(caja.firstElementChild, {
      columnas,
      clave: t => t.id,
      columnaDe: t => (FINALES.includes(t.estado) ? 'cerrada' : t.estado),
      pinta: pintaTarjeta,
      nombre: nombreTarjeta,
      puedeArrastrar: t => !!(t.puede.mover || t.puede.cerrar),
      puedeSoltar: (t, col) => (TRABAJANDO.includes(col) ? t.puede.mover : col === 'cerrada' ? t.puede.cerrar : false),
      alSoltar: async (t, col) => {
        const hecho = col === 'cerrada' ? await cerrar(t) : await mover(t, col);
        if (!hecho) kanban.poner(kanban.tarjetas());   // se canceló: vuelve a su sitio
      },
      alAbrir: t => abrirFicha(t.id),
    });
  }

  async function recargar() {
    if (vista === 'lista') { if (lista) await lista.recargar(); return; }
    // Con una recarga en marcha, se repite al acabar: la que va puede ser de
    // antes de un cambio, y lo nuevo no se perdería.
    if (pidiendo) { otraVez = true; return pidiendo; }
    pidiendo = (async () => {
      try {
        do {
          otraVez = false;
          const v = vista;
          const tarjetas = await traer(v);
          if (v === vista && kanban) kanban.poner(tarjetas);
        } while (otraVez);
      } catch (e) { document.querySelector('#t-tablero').innerHTML = `<p class="text-sm text-telecab-warn">No se ha podido cargar el tablero: ${esc(e.message)}</p>`; }
      finally { pidiendo = null; }
    })();
    return pidiendo;
  }
  let tRecargar = null;
  const recargarPronto = () => { clearTimeout(tRecargar); tRecargar = setTimeout(recargar, 400); };

  // ── La lista (Listado) ──────────────────────────────────────────────────
  function montarLista() {
    lista = Listado.montar({
      raiz: '#t-lista',
      titulo: 'Todas las tarjetas que ves',
      icono: 'fa-list-check',
      clave: 'id',
      origen: async () => todas(),
      vacio: 'No hay tarjetas que coincidan.',
      alAbrir: t => abrirFicha(t.id),
      buscar: { texto: 'Título o persona…', campos: ['titulo', t => (t.responsable ? t.responsable.nombre : ''), t => (t.creadaPor ? t.creadaPor.nombre : '')] },
      kpis: filas => [
        { etiqueta: 'Abiertas', valor: filas.filter(t => !FINALES.includes(t.estado)).length, tono: 'gold' },
        { etiqueta: 'Vencidas', valor: filas.filter(t => t.plazo.semaforo === 'rojo').length,
          tono: filas.some(t => t.plazo.semaforo === 'rojo') ? 'red' : 'text', filtro: { id: 'semaforo', valor: 'rojo' } },
        { etiqueta: 'Por aprobar', valor: filas.filter(t => t.estado === 'por_aprobar').length, filtro: { id: 'estado', valor: 'por_aprobar' } },
        { etiqueta: 'Por asignar', valor: filas.filter(t => t.estado === 'por_asignar').length, filtro: { id: 'estado', valor: 'por_asignar' } },
      ],
      filtros: [
        { id: 'estado', etiqueta: 'Estado', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.map(t => [t.estado, t.estadoEtiqueta]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.estado === valor).length })),
          pasa: (t, v) => t.estado === v },
        { id: 'responsable', etiqueta: 'Responsable', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.filter(t => t.responsable).map(t => [String(t.responsable.id), t.responsable.nombre]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.responsable && String(t.responsable.id) === valor).length })),
          pasa: (t, v) => !!t.responsable && String(t.responsable.id) === v },
        { id: 'tipo', etiqueta: 'Tipo', textoTodos: 'Todos',
          opciones: filas => [...new Map(filas.map(t => [t.tipo, t.tipoEtiqueta]))]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.tipo === valor).length })),
          pasa: (t, v) => t.tipo === v },
        { id: 'semaforo', etiqueta: 'Plazo', textoTodos: 'Todos',
          opciones: filas => [['rojo', 'Vencidas'], ['amarillo', 'Vencen hoy'], ['verde', 'En plazo']]
            .map(([valor, texto]) => ({ valor, texto, cuenta: filas.filter(t => t.plazo.semaforo === valor).length })),
          pasa: (t, v) => t.plazo.semaforo === v },
      ],
      columnas: [
        { titulo: 'Tarjeta', campo: 'titulo', pinta: (v, t) => `<span class="font-semibold">${esc(v)}</span><span class="block mt-0.5">${pastillaTipo(t)}</span>` },
        { titulo: 'Responsable', valor: t => (t.responsable ? t.responsable.nombre : ''), clase: 'whitespace-nowrap',
          pinta: v => (v ? esc(v) : '<span class="text-telecab-muted text-xs">Sin asignar</span>') },
        { titulo: 'Estado', valor: t => t.estadoEtiqueta, clase: 'whitespace-nowrap', pinta: (v, t) => pastillaEstado(t) },
        { titulo: 'Plazo', valor: t => t.plazo.venceEl || '', clase: 'whitespace-nowrap', pinta: (v, t) => semaforo(t, { largo: true }) || '<span class="text-telecab-muted text-xs">Sin plazo</span>' },
        { titulo: 'Creada', valor: t => t.creadaAt, clase: 'whitespace-nowrap', pinta: v => esc(fechaHora(v)) },
      ],
    });
  }

  // ── Elegir vista ────────────────────────────────────────────────────────
  function cambiarVista(v) {
    vista = v;
    const enLista = v === 'lista';
    document.querySelector('#t-tablero').classList.toggle('hidden', enLista);
    document.querySelector('#t-lista').classList.toggle('hidden', !enLista);
    if (enLista) { if (!lista) montarLista(); else lista.recargar(); return; }
    montarKanban();
    recargar();
  }

  // ── Formularios ─────────────────────────────────────────────────────────
  const campoPersona = (id, etiqueta, valor, ayuda) => ({
    id, etiqueta, tipo: 'lista', obligatorio: true, ayuda,
    opciones: personas.map(p => ({ valor: String(p.id), texto: p.nombre || `#${p.id}` })),
    valor: valor ? String(valor) : '',
  });
  const camposPlazo = (diasPorDefecto = '') => [
    { id: 'dias', etiqueta: 'Plazo en días hábiles', tipo: 'texto', valor: diasPorDefecto === '' ? '' : String(diasPorDefecto), marcador: 'Ej.: 3',
      ayuda: 'Cuentan desde mañana, sin fines de semana ni festivos. O pon una fecha límite abajo (si pones las dos, manda la fecha).' },
    { id: 'fecha', etiqueta: 'O fecha límite', tipo: 'fecha' },
  ];
  const plazoDe = v => (v.fecha ? { venceEl: v.fecha } : { plazoDias: v.dias === '' ? null : Number(String(v.dias).replace(',', '.')) });

  /** POST a una acción de la tarjeta; muestra el error si lo hay. → la tarjeta, o null. */
  async function hacer(id, accion, datos, aviso) {
    const r = await Api.post(`${API}/tarjetas/${id}/${accion}`, datos || {}, { aviso: aviso || 'No se ha podido' });
    if (!r) return null;
    recargarPronto();
    if (panel && panel.id === id) { turnoFicha++; pintarFicha(r.tarjeta); }
    return r.tarjeta;
  }

  async function nueva() {
    const v = await Dialogo.formulario('Nueva tarea', [
      { id: 'titulo', etiqueta: 'Qué hay que hacer', tipo: 'texto', obligatorio: true, max: 200, minimo: 3, marcador: 'Ej.: Llamar a la gestoría por el contrato de Luis' },
      { id: 'descripcion', etiqueta: 'Detalle (si hace falta)', tipo: 'texto-largo', max: 4000 },
      campoPersona('responsable', 'Quién la hace', yo.id, 'Puedes pedírtela a ti o a otra persona.'),
      ...camposPlazo(2),
    ], {
      textoBoton: yo.aprueba ? 'Crear la tarea' : 'Pedir la tarea',
      nota: yo.aprueba ? 'La creas tú, que apruebas: empieza a contar ya.' : 'Le llega a quien aprueba las tareas; el plazo empieza a contar cuando la apruebe.',
    });
    if (!v) return;
    const r = await Api.post(`${API}/tarjetas`, { titulo: v.titulo, descripcion: v.descripcion, responsableId: Number(v.responsable), ...plazoDe(v) },
      { aviso: 'No se ha creado' });
    if (!r) return;
    Dialogo.hecho(r.tarjeta.estado === 'por_aprobar' ? 'Pedida: espera la aprobación' : 'Tarea creada');
    recargarPronto();
    abrirFicha(r.tarjeta.id);
  }

  async function mover(t, estado) {
    let motivo = null;
    if (estado === 'bloqueada') {
      const v = await Dialogo.formulario(`Bloquear · ${t.titulo}`, [
        { id: 'motivo', etiqueta: 'Qué la bloquea', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000,
          marcador: 'Ej.: falta el justificante del conductor', ayuda: 'Se avisa a quien reparte las tarjetas, para que pueda desbloquearla.' },
      ], { textoBoton: 'Bloquear' });
      if (!v) return null;
      motivo = v.motivo;
    }
    return hacer(t.id, 'mover', { estado, motivo }, 'No se ha movido');
  }

  async function cerrar(t) {
    const vencida = t.plazo && t.plazo.semaforo === 'rojo';
    const campos = [
      { id: 'nota', etiqueta: 'En qué quedó', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 4000, marcador: 'Ej.: Hecho, se le mandó el contrato firmado' },
    ];
    if (t.tipo === 'ticket') {
      campos.push({ id: 'estadoOrigen', etiqueta: 'Cómo queda el ticket', tipo: 'lista', obligatorio: true, valor: 'ejecutado',
        opciones: [{ valor: 'ejecutado', texto: 'Ejecutado' }, { valor: 'rechazado', texto: 'Rechazado' }, { valor: 'no_procede', texto: 'No procede' }],
        ayuda: 'Cerrar la tarjeta cierra el ticket. Las vacaciones, bajas y permisos se «aplican» en su bandeja.' });
    }
    if (vencida) {
      campos.push({ id: 'motivoDemora', etiqueta: 'Por qué se cierra tarde', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000,
        ayuda: `Venció el ${dia(t.plazo.venceEl)}. Queda para medir los plazos.` });
    }
    const v = await Dialogo.formulario(`Cerrar · ${t.titulo}`, campos, { textoBoton: 'Cerrar la tarjeta' });
    if (!v) return null;
    return hacer(t.id, 'cerrar', { nota: v.nota, estadoOrigen: v.estadoOrigen, motivoDemora: v.motivoDemora }, 'No se ha cerrado');
  }

  const ACCIONES = {
    async aprobar(t) {
      const v = await Dialogo.formulario(`Aprobar · ${t.titulo}`, [
        campoPersona('responsable', 'Quién la hace', t.responsable && t.responsable.id),
        ...camposPlazo(t.plazo.dias == null ? '' : t.plazo.dias),
      ], { textoBoton: 'Aprobar', nota: 'El plazo empieza a contar ahora.' });
      if (!v) return;
      if (await hacer(t.id, 'aprobar', { responsableId: Number(v.responsable), ...plazoDe(v) }, 'No se ha aprobado')) Dialogo.hecho('Aprobada');
    },
    async rechazar(t) {
      const v = await Dialogo.formulario(`No aprobar · ${t.titulo}`, [
        { id: 'motivo', etiqueta: 'Por qué no', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'Le llega a quien la pidió.' },
      ], { textoBoton: 'No aprobarla' });
      if (v && await hacer(t.id, 'rechazar', { motivo: v.motivo }, 'No se ha rechazado')) Dialogo.hecho('No aprobada');
    },
    async asignar(t) {
      const v = await Dialogo.formulario(`Asignar · ${t.titulo}`, [campoPersona('responsable', 'Quién la lleva'), ...camposPlazo('')],
        { textoBoton: 'Asignar', nota: 'Responsable y plazo, los dos. El plazo empieza a contar ahora.' });
      if (v && await hacer(t.id, 'asignar', { responsableId: Number(v.responsable), ...plazoDe(v) }, 'No se ha asignado')) Dialogo.hecho('Asignada');
    },
    async reasignar(t) {
      const v = await Dialogo.formulario(`Reasignar · ${t.titulo}`, [
        campoPersona('responsable', 'Quién la lleva ahora'),
        { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'Se avisa a los dos y queda en su historia.' },
      ], { textoBoton: 'Reasignar' });
      if (v && await hacer(t.id, 'reasignar', { responsableId: Number(v.responsable), motivo: v.motivo }, 'No se ha reasignado')) Dialogo.hecho('Reasignada');
    },
    async plazo(t) {
      const v = await Dialogo.formulario(`Cambiar el plazo · ${t.titulo}`, [
        ...camposPlazo(''),
        { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'Cuenta desde ahora y queda en su historia.' },
      ], { textoBoton: 'Cambiar el plazo' });
      if (v && await hacer(t.id, 'plazo', { ...plazoDe(v), motivo: v.motivo }, 'No se ha cambiado')) Dialogo.hecho('Plazo cambiado');
    },
    async mover(t) {
      const opciones = TRABAJANDO.filter(e => e !== t.estado).map(e => ({ texto: COLUMNAS.trabajo.find(c => c.id === e).titulo, valor: e }));
      const destino = await Dialogo.elegir({ titulo: `Mover · ${t.titulo}`, texto: 'A qué columna.', opciones });
      if (destino) await mover(t, destino);
    },
    async cerrar(t) { if (await cerrar(t)) Dialogo.hecho('Cerrada'); },
    async anular(t) {
      const v = await Dialogo.formulario(`Anular · ${t.titulo}`, [
        { id: 'motivo', etiqueta: 'Por qué se anula', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 2000, ayuda: 'No se borra: queda anulada, con su historia.' },
      ], { textoBoton: 'Anular la tarjeta' });
      if (v && await hacer(t.id, 'anular', { motivo: v.motivo }, 'No se ha anulado')) Dialogo.hecho('Anulada');
    },
    async colaborador(t) {
      const v = await Dialogo.formulario(`Añadir a alguien · ${t.titulo}`, [campoPersona('persona', 'Quién colabora')], { textoBoton: 'Añadir' });
      if (v) await hacer(t.id, 'colaboradores', { usuarioId: Number(v.persona) }, 'No se ha añadido');
    },
  };
  const BOTONES = [
    ['aprobar', 'aprobar', 'fa-check', 'Aprobar', true], ['aprobar', 'rechazar', 'fa-xmark', 'No aprobar'],
    ['asignar', 'asignar', 'fa-user-check', 'Asignar', true],
    ['mover', 'mover', 'fa-arrow-right-arrow-left', 'Mover a…'], ['cerrar', 'cerrar', 'fa-circle-check', 'Cerrar', true],
    ['reasignar', 'reasignar', 'fa-user-pen', 'Reasignar'], ['cambiarPlazo', 'plazo', 'fa-calendar-days', 'Cambiar el plazo'],
    ['anular', 'anular', 'fa-ban', 'Anular', false, true],
  ];

  // ── La ficha (Panel) ────────────────────────────────────────────────────
  const HISTORIA = {
    creada: e => (e.datos && e.datos.origen ? 'Nació de su origen' : `La pidió ${e.autor || 'alguien'}`),
    aprobada: e => (e.datos && e.datos.porQuienLaCrea ? 'Aprobada al crearla' : `${e.autor || 'Alguien'} la aprobó`),
    rechazada: e => `${e.autor || 'Alguien'} no la aprobó`,
    asignada: e => (e.datos && e.datos.porSuOrigen ? 'Se hizo cargo desde su bandeja' : `${e.autor || 'Alguien'} la asignó a ${e.datos.responsable || '—'}`),
    reasignada: e => `${e.autor || 'Alguien'} la pasó de ${e.datos.de || '—'} a ${e.datos.a || '—'}`,
    plazo: e => `${e.autor || 'Alguien'} cambió el plazo al ${dia(e.datos.venceEl)}`,
    estado: e => `${e.autor || 'Alguien'} la movió de «${(COLUMNAS.trabajo.find(c => c.id === e.datos.de) || {}).titulo || e.datos.de}» a «${(COLUMNAS.trabajo.find(c => c.id === e.datos.a) || {}).titulo || e.datos.a}»`,
    cerrada: e => (e.datos && e.datos.porSuOrigen ? 'Se cerró en su origen' : `${e.autor || 'Alguien'} la cerró${e.datos && e.datos.tarde ? ' (tarde)' : ''}`),
    anulada: e => `${e.autor || 'Alguien'} la anuló`,
    colaborador: e => `${e.autor || 'Alguien'} añadió a ${e.datos.persona}`,
    colaborador_fuera: e => `${e.autor || 'Alguien'} quitó a ${e.datos.persona}`,
    vencida: () => 'Venció: se avisó a quien la lleva y a su superior',
  };

  function pintarFicha(t) {
    if (!panel) return;
    const fila = (etq, html) => `<div class="flex gap-3 text-sm py-1"><span class="w-28 shrink-0 text-telecab-muted">${esc(etq)}</span><span class="min-w-0 flex-1">${html}</span></div>`;
    const botones = BOTONES.filter(([permiso]) => t.puede[permiso]).map(([, accion, icono, texto, principal, peligro]) =>
      `<button type="button" class="tc-boton ${principal ? 'tc-boton--principal' : ''} ${peligro ? 'tc-boton--peligro' : ''}" data-accion="${accion}">
        <i class="fa-solid ${icono}" aria-hidden="true"></i>${esc(texto)}</button>`).join('');
    const html = `
      <div class="flex flex-wrap items-center gap-2">${pastillaTipo(t)} ${pastillaEstado(t)} ${semaforo(t, { largo: true })}</div>
      ${botones ? `<div class="flex flex-wrap gap-2">${botones}</div>` : ''}
      <section class="tc-panel-seccion">
        <h4>Datos</h4>
        ${fila('Lleva', t.responsable ? esc(t.responsable.nombre) : '<span class="text-telecab-muted">Sin asignar</span>')}
        ${fila('Plazo', t.plazo.venceEl ? `${esc(dia(t.plazo.venceEl))}${t.plazo.dias != null ? ` <span class="text-telecab-muted">(${t.plazo.dias} días hábiles)</span>` : ''}`
          : t.plazo.dias != null ? `${t.plazo.dias} días hábiles <span class="text-telecab-muted">desde que se apruebe</span>` : '<span class="text-telecab-muted">Sin plazo</span>')}
        ${fila(t.tipo === 'manual' ? 'La pidió' : 'Nació', `${t.creadaPor ? esc(t.creadaPor.nombre) + ' · ' : ''}${esc(fechaHora(t.creadaAt))}`)}
        ${t.enlace ? fila('Origen', `<a class="text-telecab-gold hover:underline" href="${esc(t.enlace)}">${t.tipo === 'ticket' ? 'Abrir el ticket' : 'Abrir'} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i></a>`) : ''}
        ${t.bloqueoMotivo ? fila('La bloquea', `<span class="text-telecab-red">${esc(t.bloqueoMotivo)}</span>`) : ''}
        ${t.cierreNota ? fila(t.estado === 'cerrada' ? 'En qué quedó' : 'Motivo', esc(t.cierreNota)) : ''}
        ${t.motivoDemora ? fila('Por qué tarde', esc(t.motivoDemora)) : ''}
      </section>
      ${t.sensible ? '<p class="text-xs text-telecab-muted"><i class="fa-solid fa-lock mr-1" aria-hidden="true"></i>Lleva datos sensibles: el detalle se mira en su origen, con sus permisos.</p>'
        : t.descripcion ? `<section class="tc-panel-seccion"><h4>Detalle</h4><p class="text-sm whitespace-pre-line">${esc(t.descripcion)}</p></section>` : ''}
      <section class="tc-panel-seccion">
        <h4>Colaboran</h4>
        <div class="flex flex-wrap gap-2 items-center">
          ${t.colaboradores.map(id => `<span class="tc-pastilla">${esc(nombreDe(id))}${t.puede.colaboradores
            ? ` <button type="button" class="hover:text-telecab-red" data-quitar-colaborador="${id}" aria-label="Quitar a ${esc(nombreDe(id))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ''}</span>`).join('')
            || '<span class="text-xs text-telecab-muted">Nadie más</span>'}
          ${t.puede.colaboradores ? '<button type="button" class="tc-boton tc-boton--chico" data-accion="colaborador"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Añadir</button>' : ''}
        </div>
      </section>
      <section class="tc-panel-seccion">
        <h4>Comentarios</h4>
        <div class="space-y-2">${(t.comentariosLista || []).map(c => `
          <div class="rounded-xl bg-telecab-card2 border border-telecab-border px-3 py-2">
            <div class="flex items-center gap-2 text-[11px] text-telecab-muted">
              <span class="font-semibold text-telecab-text">${esc(c.autor || '—')}</span><span>${esc(fechaHora(c.en))}</span>
              ${c.mio ? `<button type="button" class="ml-auto hover:text-telecab-red" data-quitar-comentario="${c.id}" aria-label="Quitar mi comentario"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>` : ''}
            </div>
            <p class="text-sm whitespace-pre-line mt-1">${esc(c.texto)}</p>
          </div>`).join('') || '<p class="text-xs text-telecab-muted">Sin comentarios.</p>'}
        </div>
        ${t.puede.comentar ? `
          <form data-comentar class="mt-2 flex flex-col gap-2">
            <label for="t-comentario" class="sr-only">Escribe un comentario</label>
            <textarea id="t-comentario" rows="2" maxlength="4000" class="inp" placeholder="Escribe un comentario…"></textarea>
            <button type="submit" class="tc-boton self-end"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Comentar</button>
          </form>` : ''}
      </section>
      <section class="tc-panel-seccion">
        <h4>Historia</h4>
        <ol class="space-y-1.5">${(t.historia || []).map(e => `
          <li class="text-sm flex gap-2"><span class="text-[11px] text-telecab-muted w-32 shrink-0 tabular-nums">${esc(fechaHora(e.en))}</span>
            <span>${esc((HISTORIA[e.tipo] || (() => e.tipo))(e))}${e.motivo ? `<span class="block text-xs text-telecab-muted">${esc(e.motivo)}</span>` : ''}</span></li>`).join('')}
        </ol>
      </section>`;
    panel.p.poner({ titulo: t.titulo, subtitulo: `${t.tipoEtiqueta} · ${t.estadoEtiqueta}`, html });
    panel.t = t;
  }

  async function abrirFicha(id) {
    const p = Panel.abrir({
      titulo: 'Cargando…', html: '<p class="text-sm text-telecab-muted">Cargando…</p>',
      alCerrar: () => {
        if (panel && panel.p === p) panel = null;
        const u = new URL(location.href);
        if (u.searchParams.has('tarjeta')) { u.searchParams.delete('tarjeta'); history.replaceState(history.state, '', u); }
      },
    });
    panel = { id, p, t: null };
    p.cuerpo.addEventListener('click', alPulsarFicha);
    p.cuerpo.addEventListener('submit', alComentar);
    const turno = ++turnoFicha;
    const r = await Api.get(`${API}/tarjetas/${id}`).catch(e => { p.poner({ titulo: 'No se ha podido abrir', html: `<p class="text-sm text-telecab-warn">${esc(e.message)}</p>` }); return null; });
    if (r && panel && panel.p === p && turno === turnoFicha) pintarFicha(r.tarjeta);
  }

  async function refrescarFicha() {
    if (!panel) return;
    const turno = ++turnoFicha;
    const id = panel.id;
    const r = await Api.get(`${API}/tarjetas/${id}`).catch(() => null);
    if (r && panel && panel.id === id && turno === turnoFicha) pintarFicha(r.tarjeta);
  }

  async function alPulsarFicha(e) {
    if (!panel || !panel.t) return;
    const t = panel.t;
    const b = e.target.closest('[data-accion], [data-quitar-colaborador], [data-quitar-comentario]');
    if (!b) return;
    if (b.dataset.accion && ACCIONES[b.dataset.accion]) return ACCIONES[b.dataset.accion](t);
    if (b.dataset.quitarColaborador) {
      return hacer(t.id, 'colaboradores', { usuarioId: Number(b.dataset.quitarColaborador), quitar: true }, 'No se ha quitado');
    }
    if (b.dataset.quitarComentario) {
      const si = await Dialogo.confirmar({ titulo: 'Quitar tu comentario', texto: 'Deja de verse; queda en el libro.', si: 'Quitarlo', no: 'Cancelar' });
      if (!si) return;
      const r = await Api.post(`${API}/comentarios/${b.dataset.quitarComentario}/anular`, {}, { aviso: 'No se ha quitado' });
      if (r) { turnoFicha++; pintarFicha(r.tarjeta); }
    }
  }

  async function alComentar(e) {
    if (!e.target.matches('[data-comentar]') || !panel) return;
    e.preventDefault();
    const caja = e.target.querySelector('textarea');
    const texto = caja.value.trim();
    if (!texto) { caja.focus(); return; }
    const r = await Api.post(`${API}/tarjetas/${panel.id}/comentarios`, { texto }, { aviso: 'No se ha guardado el comentario', boton: e.target.querySelector('button') });
    if (r) { turnoFicha++; pintarFicha(r.tarjeta); recargarPronto(); }
  }

  // ── Arranque ────────────────────────────────────────────────────────────
  (async function () {
    try {
      const [y, p] = await Promise.all([Api.get(`${API}/yo`), Api.get(`${API}/personas`)]);
      Object.assign(yo, y.yo);
      personas = p.personas || [];
    } catch (e) {
      document.querySelector('#t-tablero').innerHTML = `<p class="text-sm text-telecab-warn">No se ha podido abrir el tablero: ${esc(e.message)}</p>`;
      return;
    }
    const pestanas = [
      { id: 'mias', texto: 'Mi tablero', icono: 'fa-table-columns', contador: 'tareas.mias' },
      { id: 'equipo', texto: yo.todos ? 'Todo el equipo' : 'Mi equipo', icono: 'fa-people-group' },
    ];
    if (yo.aprueba || yo.asigna) pestanas.push({ id: 'pendientes', texto: 'Por repartir', icono: 'fa-inbox', contador: yo.asigna ? 'tareas.por_asignar' : 'tareas.por_aprobar' });
    pestanas.push({ id: 'lista', texto: 'Lista', icono: 'fa-list' });
    const p = Pestanas.montar(document.querySelector('#t-pestanas'), { pestanas, param: 'vista', alCambiar: cambiarVista });
    cambiarVista(p.actual());

    document.querySelector('#t-nueva').addEventListener('click', nueva);
    // Lo que cambia en el servidor llega solo (A7); sin directo, cada minuto.
    TiempoReal.escuchar('tablero', {
      alLlegar: d => { recargarPronto(); if (panel && d && d.id === panel.id) refrescarFicha(); },
      sondear: () => { recargar(); refrescarFicha(); },
      cada: 60000,
    });
    // ?tarjeta=ID: la que trae una notificación o un enlace.
    const id = Number(new URLSearchParams(location.search).get('tarjeta'));
    if (Number.isSafeInteger(id) && id > 0) abrirFicha(id);
  })();
})();
