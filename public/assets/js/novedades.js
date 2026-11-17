// ============================================================
// NOVEDADES — la ventana de cada versión, y el recorrido guiado (V3, db/253)
// ============================================================
// Al entrar después de una actualización, a cada persona le sale UNA vez una
// ventana con lo nuevo y con lo que ya tiene a mano, y la invitación a un
// recorrido guiado de un minuto (opcional). Lo pidió Camilo con la V3
// (16/11/2026): «se avisará en una ventana en prod la actualización de toda la
// aplicación con las nuevas funciones que traerá y lo que ya trae».
//
//   · Qué versión es la de ahora y quién la ha visto: el servidor
//     (modules/Novedades, tabla novedad_vista). Sale en cualquier dispositivo
//     hasta que se cierra una vez.
//   · LO QUE DICE CADA VERSIÓN: VERSIONES, aquí abajo. Para la siguiente, se
//     añade arriba su entrada y se cambia ACTUAL en novedades.service.js.
//   · «Lo que ya tienes» sale del MENÚ de quien mira: solo las pantallas que
//     puede abrir, con una línea de qué es cada una (DESCRIPCIONES).
//   · Se vuelve a abrir cuando se quiera desde «Novedades», en el pie del menú
//     (cualquier elemento con data-novedades-abrir).
//
// Usa Api, Recorrido y las clases globales (.tc-boton, .tc-pestanas…).
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = 'telecab-novedades-vistas';

  // ── Lo que dice cada versión ─────────────────────────────────────────────
  // `solo`: la ruta que tiene que estar en su menú para enseñársela.
  // `tono`: el color del icono (acento, verde, ambar, violeta, celeste).
  const VERSIONES = {
    v3: {
      titulo: 'Telecab se ha puesto al día',
      sello: 'Telecab V3',
      bajada: 'Un diseño nuevo, un tablero para todo lo que hay que hacer y avisos que llegan solos.',
      novedades: [
        { icono: 'fa-palette', tono: 'acento', titulo: 'Un diseño nuevo',
          texto: 'Más claro y con más color. Hay temas nuevos, también en claro: elige el tuyo en Configuración.',
          enlace: { href: '/configuracion', texto: 'Elegir mi tema' } },
        { icono: 'fa-table-columns', tono: 'verde', titulo: 'El tablero de tareas',
          texto: 'Todo lo que tienes que hacer, en columnas, con su plazo en días hábiles y su semáforo. Las J, las −J, las correcciones de fichaje y las vacaciones llegan solas a quien las resuelve, y se cierran solas al resolverlas.',
          enlace: { href: '/tablero', texto: 'Abrir mi tablero' } },
        { icono: 'fa-message', tono: 'acento', titulo: 'El chat de la oficina',
          texto: 'Los canales de Slack, ahora dentro de Telecab: escribe en un canal, a una persona o a un grupo, responde en hilos y menciona con @. Llega al momento, sin recargar.',
          enlace: { href: '/chat', texto: 'Abrir el chat' } },
        { icono: 'fa-bell', tono: 'celeste', titulo: 'La campana, con tus avisos',
          texto: 'Cuando otro departamento hace algo que te toca (una cita del taller, por ejemplo), te llega un aviso a la campana. Lo marcas como leído o, cuando está hecho, como resuelto, y desaparece para todo tu equipo.' },
        { icono: 'fa-mobile-screen-button', tono: 'ambar', titulo: 'Avisos en el móvil',
          texto: 'Actívalos en Configuración y te llega el aviso aunque no tengas Telecab abierto: una tarea nueva, una que vence.',
          enlace: { href: '/configuracion', texto: 'Activar los avisos' } },
        { icono: 'fa-bolt', tono: 'violeta', titulo: 'Todo en directo',
          texto: 'Los números del menú y de la barra se ponen al día solos, sin recargar la página.' },
        { icono: 'fa-shield-halved', tono: 'celeste', titulo: 'Todo queda registrado',
          texto: 'Cada cambio importante queda anotado: quién lo hizo, cuándo y por qué.' },
        { icono: 'fa-sitemap', tono: 'acento', titulo: 'Organización', solo: '/organizacion',
          texto: 'Áreas, superiores y funciones: quién aprueba, quién reparte y quién lleva cada cola del tablero.',
          enlace: { href: '/organizacion', texto: 'Abrir Organización' } },
        { icono: 'fa-sliders', tono: 'celeste', titulo: 'Parámetros', solo: '/parametros',
          texto: 'Los plazos y topes de las reglas se cambian aquí, sin tocar el código.',
          enlace: { href: '/parametros', texto: 'Abrir Parámetros' } },
      ],
    },
  };

  // ── Qué es cada pantalla del menú (para «Lo que ya tienes») ──────────────
  const DESCRIPCIONES = {
    '/inicio': 'Tu bienvenida y las cifras del día que te tocan.',
    '/tablero': 'Lo que tienes que hacer, con su plazo y su semáforo.',
    '/chat': 'Los canales de la oficina y los mensajes directos.',
    '/pendientes': 'El buzón de lo que espera por tu departamento.',
    '/justificantes': 'Aprobar o rechazar las J y las −J.',
    '/fichaje': 'Fichar tu jornada y pedir una corrección.',
    '/recaudacion': 'La caja del efectivo que entregan los conductores.',
    '/bitacora': 'Las horas de cada conductor, día a día, con sus marcas.',
    '/vacantes': 'Las plazas libres y la búsqueda de recambio.',
    '/seleccion': 'Los candidatos y su proceso hasta el alta.',
    '/ett': 'La bolsa de empleo de la ETT y las altas rápidas.',
    '/rrhh': 'El panel de RR. HH.',
    '/plantilla': 'Quién trabaja, con su contrato, su ficha y sus documentos.',
    '/vacaciones': 'El saldo de vacaciones de cada uno y las que se piden.',
    '/nominas': 'Las horas extra y las variables de cada mes para la nómina.',
    '/convenio': 'Las reglas del convenio aplicadas a la plantilla.',
    '/planificador': 'El cuadrante: quién lleva cada coche y en qué turno.',
    '/control': 'El día en directo: quién ha salido, las alertas y las llamadas.',
    '/visibilidad': 'Las horas de servicio de la flota, por día y por jornada.',
    '/mapa': 'Dónde está cada coche ahora mismo.',
    '/cobertura': 'Los turnos de los próximos días y sus huecos.',
    '/bloqueo-motor': 'El ciclo de bloqueo y desbloqueo del motor de los coches.',
    '/generador': 'Las vacantes que salen del cuadrante.',
    '/whatsapp': 'Las conversaciones de WhatsApp con los conductores.',
    '/vehiculos': 'La ficha de cada coche: documentos, piezas y su historia.',
    '/taller': 'Los mantenimientos por kilómetros y las citas del taller.',
    '/inspecciones': 'Las inspecciones de los coches.',
    '/inventario': 'Lo que hay en el almacén y sus movimientos.',
    '/facturas': 'Las facturas del taller.',
    '/combustible': 'Los repostajes, cruzados con el GPS de cada coche.',
    '/operaciones': 'Las alertas de Mapon de la flota.',
    '/sanciones': 'Los excesos de velocidad y sus avisos.',
    '/operaciones/auditoria': 'Los kilómetros de la flota, revisados.',
    '/alertas': 'Las alertas de Control, una por caso.',
    '/callcenter': 'Las llamadas de Control, por motivo y por conductor.',
    '/bi': 'Las cifras del negocio para la dirección.',
    '/usuarios': 'Quién entra y qué puede abrir cada uno.',
    '/parametros': 'Los plazos y topes de las reglas.',
    '/organizacion': 'Áreas, superiores y funciones de cada uno.',
    '/adjuntos/banco': 'Dónde se guardan los ficheros, y una prueba.',
    '/tiempo-real/banco': 'La prueba de los avisos en directo.',
    '/explorador': 'Mirar la base de datos.',
    '/migraciones': 'Aplicar los cambios de la base de datos.',
    '/soporte': 'Pedir ayuda a informática.',
    '/tickets-telecab': 'Los tickets de soporte que llegan a informática.',
    '/configuracion': 'Tu tema de colores, los avisos al móvil y las ayudas.',
    '/barcelona': 'El cuadrante de Barcelona.',
    '/barcelona/reportes': 'El reporte de horas de Barcelona.',
    '/barcelona/visibilidad': 'Las horas de servicio de Barcelona.',
    '/barcelona/mantenimientos': 'Los mantenimientos de los coches de Barcelona.',
    '/barcelona/recaudacion': 'La caja de Barcelona.',
  };

  // ── El recorrido por lo que está siempre a mano ──────────────────────────
  const PASOS = [
    { icono: 'fa-route', titulo: 'Telecab en un minuto',
      texto: 'Unas pocas paradas por lo que está siempre a mano. Puedes dejarlo cuando quieras con Escape.' },
    { sel: ['#menu-panel nav', '#menu-abrir'], icono: 'fa-bars', titulo: 'El menú',
      texto: 'Todo lo que puedes abrir, por departamento: solo salen las pantallas que tienes permiso para ver. Con Ctrl+B lo pliegas y lo despliegas.' },
    { sel: '#menu a[href="/tablero"]', icono: 'fa-table-columns', titulo: 'Tu tablero',
      texto: 'Las tareas que llevas, con su plazo. El número rojo dice cuántas te esperan.' },
    { sel: '#menu a[href="/chat"]', icono: 'fa-message', titulo: 'El chat',
      texto: 'Los canales de siempre y los mensajes directos. El número rojo son los directos y las menciones sin leer.' },
    { sel: '#tk-barra', icono: 'fa-ticket', titulo: 'Los tickets de cada departamento',
      texto: 'Cada cuadro es una bandeja con sus pendientes. Púlsalo para abrirla.' },
    { sel: '#fichar-btn', icono: 'fa-stopwatch', titulo: 'Fichar',
      texto: 'Si tienes que fichar tu jornada, el botón está siempre aquí, en cualquier pantalla.' },
    { sel: '#notif-btn', icono: 'fa-bell', titulo: 'Avisos y pendientes',
      texto: 'La campana: arriba los avisos que te mandan otros departamentos, para leer o dar por resueltos; debajo, lo que espera hoy por tu departamento.' },
    { sel: '#sesion-usuario', icono: 'fa-user', titulo: 'Tu sesión',
      texto: 'Tu nombre y tu puesto. Al lado, el botón para salir.' },
    { sel: '#menu a[href="/configuracion"]', icono: 'fa-gear', titulo: 'Configuración',
      texto: 'Tu tema de colores, los avisos al móvil y las ayudas que salen al pasar el cursor.' },
    { sel: '#menu [data-novedades-abrir]', icono: 'fa-wand-magic-sparkles', titulo: 'Novedades',
      texto: 'Esta ventana y este recorrido, cuando quieras.' },
    { icono: 'fa-flag-checkered', titulo: 'Listo',
      texto: 'Ya conoces lo básico. Si algo no sale como esperas, pide ayuda en «Soporte técnico».' },
  ];

  // ── Lo que se ha visto ───────────────────────────────────────────────────
  const leerLS = () => { try { return (localStorage.getItem(LS) || '').split(','); } catch (e) { return []; } };
  const apuntarLS = v => { try { const s = new Set(leerLS().filter(Boolean)); s.add(v); localStorage.setItem(LS, [...s].join(',')); } catch (e) { /* sin almacenamiento */ } };

  let estado = null;      // { version, pendiente, recorrido } del servidor
  let abierta = null;

  async function pedirEstado() {
    if (estado) return estado;
    try { estado = await Api.get('/novedades/api/estado'); } catch (e) { estado = null; }
    return estado;
  }
  function marcar(recorrido) {
    if (!estado) return;
    apuntarLS(estado.version);
    estado.pendiente = false;
    punto(false);
    Api.post('/novedades/api/visto', { version: estado.version, recorrido: recorrido || null }).catch(() => {});
  }
  function punto(si) {
    document.querySelectorAll('[data-novedades-abrir] .tc-novedades-punto').forEach(p => { p.hidden = !si; });
  }

  // ── «Lo que ya tienes», del menú de quien mira ───────────────────────────
  function delMenu() {
    const item = a => {
      if (!a || a.classList.contains('hidden') || a.hasAttribute('data-novedades-abrir')) return null;
      const href = a.getAttribute('href');
      const i = a.querySelector('i[class*="fa-"]');
      const nombre = ((a.querySelector('span.text-sm, span:not(.tc-contador)') || a).textContent || '').trim();
      return href && nombre ? { href, nombre, icono: i ? [...i.classList].find(c => c.startsWith('fa-') && c !== 'fa-solid') : 'fa-circle', texto: DESCRIPCIONES[href] || '' } : null;
    };
    const grupos = [];
    const sueltos = [...document.querySelectorAll('#menu-panel nav > a.nav-item[href]')].map(item).filter(Boolean);
    if (sueltos.length) grupos.push({ nombre: 'Lo de cada día', items: sueltos });
    document.querySelectorAll('#menu-panel .nav-grupo').forEach(g => {
      const nombre = ((g.querySelector('.grupo-btn span.text-sm') || {}).textContent || '').trim();
      const items = [...g.querySelectorAll('.grupo-items a.nav-item[href]')].map(item).filter(Boolean);
      if (items.length) grupos.push({ nombre, items });
    });
    const pie = [...document.querySelectorAll('#menu-panel > div:last-child a.nav-item[href]')].map(item).filter(Boolean);
    if (pie.length) grupos.push({ nombre: 'Tu cuenta y la ayuda', items: pie });
    // Una pantalla que sale en dos departamentos (Plantilla), una vez.
    const vistas = new Set();
    grupos.forEach(g => { g.items = g.items.filter(x => !vistas.has(x.href) && vistas.add(x.href)); });
    return grupos.filter(g => g.items.length);
  }
  const enSuMenu = href => !!document.querySelector(`#menu a[href="${href}"]`);

  // ── La ventana ───────────────────────────────────────────────────────────
  function abrir({ auto = false } = {}) {
    if (abierta) return;
    const version = (estado && estado.version) || 'v3';
    const v = VERSIONES[version];
    if (!v) return;
    const nuevas = v.novedades.filter(n => !n.solo || enSuMenu(n.solo));
    const grupos = delMenu();
    const fondo = document.createElement('div');
    fondo.className = 'tc-novedades-fondo';
    fondo.innerHTML = `
      <div class="tc-novedades" role="dialog" aria-modal="true" aria-labelledby="tcn-titulo">
        <header class="tc-novedades-cabeza">
          <button type="button" class="tc-novedades-cerrar" data-nv="cerrar" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          <span class="tc-novedades-sello"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>${esc(v.sello)}</span>
          <h2 id="tcn-titulo" class="tc-novedades-titulo">${esc(v.titulo)}</h2>
          <p class="tc-novedades-bajada">${esc(v.bajada)}</p>
          <div class="tc-pestanas tc-novedades-pestanas" role="tablist" aria-label="Novedades">
            <button type="button" class="tc-pestana" role="tab" id="tcn-p-nuevo" aria-controls="tcn-nuevo" aria-selected="true">Lo nuevo</button>
            <button type="button" class="tc-pestana" role="tab" id="tcn-p-tienes" aria-controls="tcn-tienes" aria-selected="false" tabindex="-1">Lo que ya tienes</button>
          </div>
        </header>
        <div class="tc-novedades-cuerpo">
          <section id="tcn-nuevo" role="tabpanel" aria-labelledby="tcn-p-nuevo" class="tc-novedades-rejilla">
            ${nuevas.map(n => `
              <article class="tc-novedad">
                <span class="tc-novedad-icono" data-tono="${esc(n.tono || 'acento')}" aria-hidden="true"><i class="fa-solid ${esc(n.icono)}"></i></span>
                <div class="min-w-0">
                  <h3>${esc(n.titulo)}</h3>
                  <p>${esc(n.texto)}</p>
                  ${n.enlace ? `<a class="tc-novedad-enlace" href="${esc(n.enlace.href)}">${esc(n.enlace.texto)} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>` : ''}
                </div>
              </article>`).join('')}
          </section>
          <section id="tcn-tienes" role="tabpanel" aria-labelledby="tcn-p-tienes" hidden>
            <p class="tc-novedades-nota">Las pantallas que puedes abrir, tal y como están en tu menú.</p>
            ${grupos.map(g => `
              <div class="tc-novedades-grupo">
                <h4>${esc(g.nombre)}</h4>
                <div class="tc-novedades-lista">
                  ${g.items.map(x => `
                    <a class="tc-novedades-item" href="${esc(x.href)}">
                      <span class="tc-novedades-item-icono" aria-hidden="true"><i class="fa-solid ${esc(x.icono)}"></i></span>
                      <span class="min-w-0"><b>${esc(x.nombre)}</b>${x.texto ? `<small>${esc(x.texto)}</small>` : ''}</span>
                    </a>`).join('')}
                </div>
              </div>`).join('')}
          </section>
        </div>
        <footer class="tc-novedades-pie">
          <p>Puedes volver a verlo en <b>Novedades</b>, en el pie del menú.</p>
          <button type="button" class="tc-boton" data-nv="cerrar">${auto ? 'Ahora no' : 'Cerrar'}</button>
          <button type="button" class="tc-boton tc-boton--principal" data-nv="recorrido"><i class="fa-solid fa-route" aria-hidden="true"></i>Hacer el recorrido</button>
        </footer>
      </div>`;
    document.body.appendChild(fondo);
    const caja = fondo.querySelector('.tc-novedades');
    abierta = { fondo, volver: document.activeElement };

    // Las dos pestañas.
    const tabs = [...fondo.querySelectorAll('[role="tab"]')];
    const elegir = t => {
      tabs.forEach(x => {
        const on = x === t;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        x.tabIndex = on ? 0 : -1;
        fondo.querySelector('#' + x.getAttribute('aria-controls')).hidden = !on;
      });
      fondo.querySelector('.tc-novedades-cuerpo').scrollTop = 0;
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => elegir(t));
      t.addEventListener('keydown', ev => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault();
        const otra = tabs[(i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        elegir(otra); otra.focus();
      });
    });

    fondo.addEventListener('click', ev => {
      const b = ev.target.closest('[data-nv]');
      if (b && b.dataset.nv === 'cerrar') cerrar();
      else if (b && b.dataset.nv === 'recorrido') { cerrar({ sinMarcar: true }); recorrido(); }
      // Un enlace de dentro lleva a su pantalla: la ventana queda vista.
      else if (ev.target.closest('a[href]')) marcar(null);
    });
    fondo.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); cerrar(); return; }
      if (ev.key !== 'Tab') return;
      const f = [...caja.querySelectorAll('button:not([tabindex="-1"]), a[href]')].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
    });
    (fondo.querySelector('[data-nv="recorrido"]') || caja).focus();
  }

  function cerrar({ sinMarcar = false } = {}) {
    if (!abierta) return;
    const { fondo, volver } = abierta;
    abierta = null;
    if (!sinMarcar) marcar(null);
    fondo.classList.add('tc-novedades-fondo--saliendo');
    setTimeout(() => fondo.remove(), 160);
    if (volver && volver.focus && volver.isConnected) volver.focus({ preventScroll: true });
  }

  function recorrido() {
    if (!global.Recorrido) return;
    global.Recorrido.empezar(PASOS, { alAcabar: como => marcar(como) });
  }

  // ── Al entrar: si falta verla, sale sola ─────────────────────────────────
  // Espera a que la pantalla esté quieta: sin la carga, sin un diálogo ni una
  // ficha abierta. Si no se da en un rato, ya saldrá en la siguiente pantalla.
  function ocupada() {
    const carga = document.getElementById('cargando-overlay');
    return (carga && !carga.classList.contains('hidden'))
      || document.querySelector('.dialogo, .tc-panel, [data-formulario]')
      || (global.Recorrido && global.Recorrido.enMarcha());
  }
  async function alEntrar() {
    if (!document.getElementById('menu')) return;
    const e = await pedirEstadoSiHaceFalta();
    if (!e || !e.pendiente || !VERSIONES[e.version]) return;
    punto(true);
    let intentos = 0;
    const probar = () => {
      if (abierta) return;
      if (ocupada()) { if (++intentos < 20) setTimeout(probar, 1500); return; }
      abrir({ auto: true });
    };
    setTimeout(probar, 900);
  }
  // Si este navegador ya la vio, no se pregunta al servidor en cada pantalla.
  async function pedirEstadoSiHaceFalta() {
    const vistas = leerLS();
    const ultima = Object.keys(VERSIONES)[0];
    if (vistas.includes(ultima)) return { version: ultima, pendiente: false };
    const e = await pedirEstado();
    if (e && !e.pendiente) apuntarLS(e.version);
    return e;
  }

  // «Novedades» en el menú: la abre cuando se quiera.
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-novedades-abrir]');
    if (!b) return;
    ev.preventDefault();
    await pedirEstado();
    abrir();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alEntrar);
  else alEntrar();

  global.Novedades = { abrir, recorrido, PASOS };
})(window);
