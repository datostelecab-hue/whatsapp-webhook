// modules/Chat/vistas/chatSlack.ejs — la migración de Slack (2d, db/259).
//
// Arriba, el estado (token, cuenta de Slack, lo que esté en marcha) con
// «Simular» y «Migrar». Mientras va, se mira el avance cada dos segundos (sin
// preguntar a Slack: ?ligero=1). Debajo, dos Listados en pestañas: qué se trae
// (del último informe) y quién es quién (se corrige pulsando la fila).

(function () {
  const esc = Casa.esc;
  const URL = '/chat/slack/api';
  const caja = document.querySelector('#sl-estado');
  const num = n => Number(n || 0).toLocaleString('es-ES');
  let estado = null;
  let mirando = null;

  // ── El estado y los botones ────────────────────────────────────────────────
  const aviso = (html, tono = 'warn', icono = 'fa-triangle-exclamation') => `
    <div class="flex items-start gap-2 px-4 py-3 rounded-xl border text-sm bg-telecab-${tono}/10 border-telecab-${tono}/30 text-telecab-${tono}">
      <i class="fa-solid ${icono} mt-0.5 text-xs" aria-hidden="true"></i><span>${html}</span>
    </div>`;

  const hora = iso => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
  const ultimoInforme = () => (estado && estado.proceso && estado.proceso.informe) || null;

  function pintarEstado() {
    if (!estado) {
      caja.innerHTML = '<p class="text-sm text-telecab-muted" role="status">Comprobando la conexión con Slack…</p>';
      return;
    }
    const e = estado;
    if (!e.token) {
      caja.innerHTML = aviso(`El servidor no tiene el token de Slack. Hace falta <b>SLACK_MIGRACION_TOKEN</b> en Render
        (el «User OAuth Token» de la app de Slack, que empieza por <b>xoxp-</b>) y volver a desplegar.`);
      return;
    }
    const p = e.proceso;
    const enMarcha = p && !p.acabado;
    const simulado = p && p.acabado && p.informe;
    const cuenta = e.slack
      ? `Slack de <b>${esc(e.slack.equipo)}</b>, con la cuenta de <b>${esc(e.slack.usuario)}</b>`
      : (e.problema ? '' : 'Comprobando la conexión con Slack…');
    let linea = '';
    if (enMarcha) {
      linea = `<i class="fa-solid fa-circle-notch fa-spin text-telecab-gold mr-1.5" aria-hidden="true"></i>${
        p.modo === 'migrar' ? 'Migrando' : 'Simulando'} desde las ${hora(p.empezado)} · ${esc(p.avance || '')}`;
    } else if (p && p.error) {
      linea = `<span class="text-telecab-red"><i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>${
        p.modo === 'migrar' ? 'La migración' : 'La simulación'} se paró a las ${hora(p.acabadoAt)}: ${esc(p.error)}</span>`;
    } else if (simulado) {
      linea = `<i class="fa-solid fa-check text-telecab-gold mr-1.5" aria-hidden="true"></i>${
        p.modo === 'migrar' ? 'Migración hecha' : 'Simulación hecha'} a las ${hora(p.acabadoAt)}. Lo de abajo es lo que ${
        p.modo === 'migrar' ? 'se ha traído' : 'traería'}.`;
    } else {
      linea = 'Empieza por simular: no escribe ningún mensaje y dice qué traería y quién es quién.';
    }
    caja.innerHTML = `
      <div class="bg-telecab-card border border-telecab-border rounded-2xl p-5 space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <p class="text-sm flex-1 min-w-[16rem]">${cuenta}</p>
          <button type="button" data-simular class="tc-boton" ${enMarcha ? 'disabled' : ''}
                  title="Lee Slack entero y dice qué traería. Apunta quién es quién, pero no escribe ningún mensaje">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>Simular
          </button>
          <button type="button" data-migrar class="tc-boton tc-boton--principal" ${enMarcha || !simulado ? 'disabled' : ''}
                  title="${simulado ? 'Trae lo que dice la simulación. Se puede repetir: lo ya traído no se duplica' : 'Primero, simular'}">
            <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>Migrar
          </button>
        </div>
        ${e.problema ? aviso(esc(e.problema)) : ''}
        <p class="text-sm text-telecab-muted" role="status">${linea}</p>
      </div>`;
    caja.querySelector('[data-simular]').addEventListener('click', ev => lanzar('simular', ev.currentTarget));
    caja.querySelector('[data-migrar]').addEventListener('click', ev => confirmarMigrar(ev.currentTarget));
  }

  async function lanzar(modo, boton) {
    const r = await Api.post(`${URL}/${modo}`, {}, { boton, aviso: modo === 'migrar' ? 'No se ha podido migrar' : 'No se ha podido simular' });
    if (!r) return;
    estado = { ...estado, proceso: r.proceso };
    pintarEstado();
    seguir();
  }

  async function confirmarMigrar(boton) {
    const inf = ultimoInforme();
    const t = (inf && inf.totales) || {};
    const directos = ((inf && inf.canales) || []).filter(c => c.tipo !== 'publico' && c.tipo !== 'privado' && c.destino !== 'no se trae').length;
    const si = await Dialogo.confirmar({
      titulo: 'Migrar Slack al chat',
      texto: `Se traerán ${num(t.nuevos)} mensajes nuevos (de ${num(t.mensajes + t.respuestas)}, con sus respuestas) y ${num(t.ficheros)} ficheros, `
        + `${directos ? `con ${directos} conversaciones directas, ` : ''}sin avisar a nadie. `
        + 'Quien no tenga usuario del ERP saldrá con su nombre de Slack. Se puede repetir después: lo ya traído no se duplica.',
      si: `Migrar ${num(t.nuevos)} mensajes`, no: 'Cancelar',
    });
    if (si) await lanzar('migrar', boton);
  }

  /** Mientras va, el avance cada dos segundos; al acabar, se repintan las listas. */
  function seguir() {
    clearTimeout(mirando);
    mirando = setTimeout(async () => {
      try {
        const r = await Api.get(`${URL}/estado?ligero=1`);
        const antes = estado && estado.proceso;
        estado = { ...estado, token: r.token, proceso: r.proceso };
        pintarEstado();
        if (r.proceso && !r.proceso.acabado) { seguir(); return; }
        if (antes && !antes.acabado) { canales.recargar(); personas.recargar(); }
      } catch (_) { seguir(); }
    }, 2000);
  }

  // ── Qué se trae ────────────────────────────────────────────────────────────
  const TIPO = { publico: 'Canal', privado: 'Privado', directo: 'Directo', grupo: 'Grupo' };
  const seTrae = f => f.destino !== 'no se trae';

  const canales = Listado.montar({
    raiz: '#sl-canales',
    titulo: 'Qué se trae',
    icono: 'fa-comments',
    clave: 'id',
    origen: () => ({ filas: (ultimoInforme() || {}).canales || [], informe: ultimoInforme() }),
    vacio: 'Todavía no hay nada que enseñar: pulsa «Simular».',
    buscar: { texto: 'Canal, persona o destino…', campos: ['slack', 'destino', 'motivo'] },
    subtitulo: (v, todas) => (todas.length ? `${todas.filter(seTrae).length} de ${todas.length} conversaciones de Slack se traen` : ''),
    kpisDeLoVisible: true,
    kpis: visibles => {
      const van = visibles.filter(seTrae);
      const suma = k => van.reduce((n, f) => n + (f[k] || 0), 0);
      return [
        { etiqueta: 'Mensajes', valor: num(suma('mensajes')), icono: 'fa-message', pie: `y ${num(suma('respuestas'))} respuestas en hilos` },
        { etiqueta: 'Nuevos', valor: num(suma('nuevos')), tono: 'gold', pie: 'los que aún no están en el chat',
          ayuda: 'Al repetir la migración, solo entra lo nuevo' },
        { etiqueta: 'Ficheros', valor: num(suma('ficheros')), icono: 'fa-paperclip', pie: 'van a R2, como los del chat' },
        { etiqueta: 'No se traen', valor: visibles.length - van.length, tono: visibles.length > van.length ? 'warn' : 'text',
          pie: 'conversaciones', filtro: { id: 'trae', valor: 'no' } },
      ];
    },
    nota: (v, extra) => {
      const inf = extra && extra.informe;
      if (!inf) return null;
      const notas = [];
      if (inf.totales.reaccionesFuera) {
        notas.push({ texto: `${num(inf.totales.reaccionesFuera)} reacciones no son de las seis del chat (ok, hecho, visto, gracias, risa y corazón) y no se traen.` });
      }
      if (inf.modo === 'migrar' && inf.totales.ficheros) {
        notas.push({ texto: `Ficheros subidos en esta pasada: ${num(inf.totales.ficherosSubidos)}. Los que fallen se vuelven a intentar al repetir la migración.` });
      }
      (inf.avisos || []).slice(0, 12).forEach(a => notas.push({ tono: 'aviso', icono: 'fa-triangle-exclamation', texto: a }));
      if ((inf.avisos || []).length > 12) notas.push({ tono: 'aviso', texto: `Y ${inf.avisos.length - 12} avisos más.` });
      return notas;
    },
    filtros: [
      { id: 'tipo', etiqueta: 'Tipo', textoTodos: 'Todos',
        opciones: filas => Object.keys(TIPO).map(k => ({ valor: k, texto: TIPO[k], cuenta: filas.filter(f => f.tipo === k).length })).filter(o => o.cuenta),
        pasa: (f, v) => f.tipo === v },
      { id: 'trae', etiqueta: 'Se trae', textoTodos: 'Todas',
        opciones: filas => [
          { valor: 'si', texto: 'Se trae', cuenta: filas.filter(seTrae).length },
          { valor: 'no', texto: 'No se trae', cuenta: filas.filter(f => !seTrae(f)).length },
        ],
        pasa: (f, v) => (v === 'si') === seTrae(f) },
    ],
    columnas: [
      { titulo: 'En Slack', campo: 'slack',
        pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span><span class="block text-[11px] text-telecab-muted">${esc(TIPO[f.tipo] || f.tipo)}</span>` },
      { titulo: 'Adónde va', valor: f => (seTrae(f) ? f.destino : `No se trae: ${f.motivo || ''}`),
        pinta: (v, f) => (seTrae(f)
          ? esc(f.destino) + (f.gente && f.tipo === 'privado' ? `<span class="block text-[11px] text-telecab-muted">${f.gente.length} personas dentro</span>` : '')
          : `<span class="tc-pastilla tc-pastilla--aviso">No se trae</span><span class="block text-[11px] text-telecab-muted mt-0.5">${esc(f.motivo || '')}</span>`) },
      { titulo: 'Mensajes', campo: 'mensajes', clase: 'text-right tabular-nums', pinta: v => num(v) },
      { titulo: 'Respuestas', campo: 'respuestas', clase: 'text-right tabular-nums', pinta: v => num(v) },
      { titulo: 'Ficheros', campo: 'ficheros', clase: 'text-right tabular-nums', pinta: v => num(v) },
      { titulo: 'Nuevos', campo: 'nuevos', clase: 'text-right tabular-nums',
        ayuda: 'Los que aún no están en el chat', pinta: v => (v ? `<b>${num(v)}</b>` : '<span class="text-telecab-muted">0</span>') },
    ],
    alAbrir: f => verConversacion(f),
  });

  /** El detalle de una conversación, sin dejar la lista. */
  function verConversacion(f) {
    const fila = (etiqueta, valor) => `<div class="flex justify-between gap-4 py-1.5 border-b border-telecab-border/60 last:border-0">
      <span class="text-telecab-muted">${esc(etiqueta)}</span><span class="text-right tabular-nums">${valor}</span></div>`;
    const html = seTrae(f)
      ? `<div class="text-sm">
          ${fila('Adónde va', esc(f.destino))}
          ${f.gente ? fila('Personas del ERP dentro', num(f.gente.length)) : ''}
          ${fila('Mensajes', num(f.mensajes))}
          ${fila('Respuestas en hilos', num(f.respuestas))}
          ${fila('Ficheros', num(f.ficheros))}
          ${fila('Nuevos (aún no están en el chat)', `<b>${num(f.nuevos)}</b>`)}
          ${f.reaccionesFuera ? fila('Reacciones que no se traen', num(f.reaccionesFuera)) : ''}
        </div>`
      : `<p class="text-sm">No se trae: ${esc(f.motivo || '')}.</p>`;
    Dialogo.aviso({ titulo: f.slack, html, tono: seTrae(f) ? 'info' : 'aviso' });
  }

  // ── Quién es quién ─────────────────────────────────────────────────────────
  const COMO = {
    email: { texto: 'Por el correo', clase: 'tc-pastilla--verde' },
    nombre: { texto: 'Por el nombre', clase: 'tc-pastilla--aviso', ayuda: 'Salió por el nombre: compruébalo' },
    'a mano': { texto: 'A mano', clase: 'tc-pastilla--azul' },
  };

  const personas = Listado.montar({
    raiz: '#sl-personas',
    titulo: 'Quién es quién',
    icono: 'fa-users',
    clave: 'slackId',
    origen: async () => { const r = await Api.get(`${URL}/personas`); return { filas: r.personas, usuarios: r.usuarios }; },
    vacio: 'Todavía no hay nadie: al simular se apunta cada persona de Slack.',
    buscar: { texto: 'Nombre, correo o usuario…', campos: ['nombre', 'email', 'usuario'] },
    subtitulo: (v, todas) => (todas.length ? `${todas.length} personas en Slack · pulsa una para cambiar su usuario del ERP` : ''),
    nota: () => ({ texto: 'Los mensajes de quien tenga usuario del ERP salen como suyos; los demás, con su nombre de Slack. Sus menciones y reacciones, igual. Lo que pongas a mano no lo cambia otra simulación.' }),
    kpis: filas => [
      { etiqueta: 'Por el correo', valor: filas.filter(f => f.como === 'email').length, tono: 'green', filtro: { id: 'como', valor: 'email' } },
      { etiqueta: 'Por el nombre', valor: filas.filter(f => f.como === 'nombre').length, tono: filas.some(f => f.como === 'nombre') ? 'warn' : 'text',
        pie: 'compruébalos', filtro: { id: 'como', valor: 'nombre' } },
      { etiqueta: 'A mano', valor: filas.filter(f => f.como === 'a mano').length, filtro: { id: 'como', valor: 'a mano' } },
      { etiqueta: 'Sin usuario', valor: filas.filter(f => !f.usuarioId && !f.bot).length, pie: 'saldrán con su nombre de Slack',
        filtro: { id: 'como', valor: 'sin' } },
    ],
    filtros: [
      { id: 'como', etiqueta: 'Cómo', textoTodos: 'Todos',
        opciones: filas => [
          ...Object.keys(COMO).map(k => ({ valor: k, texto: COMO[k].texto, cuenta: filas.filter(f => f.como === k).length })),
          { valor: 'sin', texto: 'Sin usuario', cuenta: filas.filter(f => !f.usuarioId).length },
        ].filter(o => o.cuenta),
        pasa: (f, v) => (v === 'sin' ? !f.usuarioId : f.como === v) },
    ],
    columnas: [
      { titulo: 'En Slack', campo: 'nombre',
        pinta: (v, f) => `<span class="font-semibold">${esc(v)}</span>${f.bot ? ' <span class="tc-pastilla">Integración</span>' : ''}`
          + (f.email ? `<span class="block text-[11px] text-telecab-muted">${esc(f.email)}</span>` : '') },
      { titulo: 'Usuario del ERP', valor: f => f.usuario || '',
        pinta: (v, f) => (f.usuarioId ? esc(v) : '<span class="text-telecab-muted text-xs">Ninguno: saldrá con su nombre de Slack</span>') },
      { titulo: 'Cómo', valor: f => (COMO[f.como] || {}).texto || '',
        pinta: (v, f) => (COMO[f.como] ? `<span class="tc-pastilla ${COMO[f.como].clase}"${COMO[f.como].ayuda ? ` title="${esc(COMO[f.como].ayuda)}"` : ''}>${esc(v)}</span>` : '') },
    ],
    alAbrir: f => cambiar(f),
  });

  async function cambiar(f) {
    const usuarios = (personas.extra || {}).usuarios || [];
    const v = await Dialogo.formulario(`Usuario del ERP · ${f.nombre}`, [
      { id: 'usuario', etiqueta: 'Usuario', tipo: 'lista', valor: f.usuarioId ? String(f.usuarioId) : '',
        opciones: usuarios.map(u => ({ valor: String(u.id), texto: `${u.nombre}${u.oficina ? '' : ' (conductor)'}` })),
        ayuda: 'Déjalo sin dato y sus mensajes saldrán con su nombre de Slack.' },
    ], { textoBoton: 'Guardar', nota: f.email ? `En Slack: ${f.email}` : 'En Slack no tiene correo.' });
    if (!v) return;
    const r = await Api.post(`${URL}/personas`, { slackId: f.slackId, usuarioId: v.usuario || null }, { aviso: 'No se ha podido guardar' });
    if (!r) return;
    Dialogo.hecho('Guardado');
    personas.recargar();
  }

  // ── Las pestañas ───────────────────────────────────────────────────────────
  Pestanas.montar(document.getElementById('sl-pestanas'), {
    pestanas: [
      { id: 'canales', texto: 'Qué se trae', icono: 'fa-comments' },
      { id: 'personas', texto: 'Quién es quién', icono: 'fa-users' },
    ],
    param: 'vista',
    alCambiar: id => mostrar(id),
  });
  function mostrar(id) {
    document.getElementById('sl-canales').classList.toggle('hidden', id === 'personas');
    document.getElementById('sl-personas').classList.toggle('hidden', id !== 'personas');
  }
  mostrar(new URLSearchParams(location.search).get('vista') || 'canales');

  // ── Al entrar ──────────────────────────────────────────────────────────────
  (async () => {
    pintarEstado();
    try {
      estado = await Api.get(`${URL}/estado`);
    } catch (err) {
      caja.innerHTML = aviso(`No se ha podido leer el estado: ${esc(err.message)}`);
      return;
    }
    pintarEstado();
    canales.recargar();
    if (estado.proceso && !estado.proceso.acabado) seguir();
  })();
})();
