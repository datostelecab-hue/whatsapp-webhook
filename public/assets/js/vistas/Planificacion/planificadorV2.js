// modules/Planificacion/vistas/planificadorV2.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.
//
// EL PLANIFICADOR, PARTIDO POR ÁREAS (FRO-4, 04/11/2026). Aquí queda lo que se
// ejecuta al cargar, en su orden: el estado, los ayudantes y el arranque. Las
// funciones de cada área están en planificador/*.js, que se cargan ANTES que
// este (ver la vista). Ya no va dentro de una IIFE: los ficheros tienen que
// verse entre sí, y eso es el ámbito global de la página.
//
// EL CANDADO DE SOLO LECTURA SE LLAMA fetchPlan. Antes era un `const fetch`
// dentro de la IIFE; fuera de ella taparía el fetch de toda la página (los
// componentes compartidos volverían a recibir el 403 falso, como antes del
// 03/11/2026). ESLint no deja usar fetch en estos ficheros.

  const DEL_SERVIDOR = Casa.datos();
  // ── SOLO LECTURA ──────────────────────────────────────────────────────────
  // El candado DE VERDAD esta en el servidor: cualquier peticion al
  // planificador que no sea un GET exige el permiso '/planificador/editar'.
  // Esto de aqui es para que la pantalla no mienta.
  //
  // Se envuelve el fetch del cuadrante en vez de apagar los botones uno a uno a
  // proposito: en este cuadrante se escribe desde treinta sitios —arrastrar una
  // persona, el menu de un coche, el panel de eventos, los relevos— y una lista
  // de botones se queda corta el dia que se añada el treinta y uno. Asi
  // cualquier camino que intente escribir se para en el mismo sitio y con el
  // mismo aviso.
  //
  // PERO ES EL DE ESTA PANTALLA, NO EL DE TODA LA PÁGINA (03/11/2026). Antes se
  // reemplazaba window.fetch, y los componentes compartidos que también viven
  // aquí —felicitar un cumpleaños, la −J, la foto de una persona— recibían el
  // mismo 403 falso con el aviso del cuadrante. Por eso es una constante aparte,
  // `fetchPlan` (FRO-4, 04/11/2026; antes, un `const fetch` dentro de la IIFE):
  // solo la usan los ficheros del planificador, y el fetch de la página sigue
  // siendo el de siempre. Lo que la protege es el NOMBRE: npm run lint no deja
  // escribir con fetch, window.fetch, Api.post… en estos ficheros.
  const PUEDE_EDITAR = DEL_SERVIDOR.puedeEditar;
  // eslint-disable-next-line no-restricted-properties -- aquí se define el candado
  const fetchPlan = PUEDE_EDITAR ? window.fetch.bind(window) : (function () {
    // eslint-disable-next-line no-restricted-properties -- aquí se define el candado
    const fetchReal = window.fetch.bind(window);
    let avisando = false;
    return function (url, opciones) {
      const metodo = String((opciones && opciones.method) || 'GET').toUpperCase();
      if (metodo === 'GET') return fetchReal(url, opciones);
      if (!avisando) {
        avisando = true;
        Promise.resolve(Dialogo.aviso({
          titulo: 'Solo lectura', tono: 'aviso',
          html: '<p>Puedes mirar el cuadrante, pero no cambiarlo.</p>' +
                '<p class="mt-2 text-sm text-telecab-muted">Si necesitas planificar, pide el permiso ' +
                '<b>Planificador · editar</b> a quien lleve los usuarios.</p>',
        })).catch(() => {}).then(() => { avisando = false; });
      }
      return Promise.resolve(new Response(
        JSON.stringify({ status: 'error', msg: 'Solo lectura' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }));
    };
  })();

  // Si quien mira puede abrir Plantilla: sin el permiso no se le ofrece «Ver su ficha».
  const VER_FICHAS = DEL_SERVIDOR.verFichas;
  // La ficha de Plantilla se abre siempre en OTRA pestaña: el cuadrante se queda
  // como estaba (su base, su vista, su scroll).
  const hrefFicha = id => '/plantilla#' + encodeURIComponent(id);
  // En las tarjetas del lateral (banquillo, quién vuelve, huérfanos) el nombre
  // lleva a su ficha. Sin permiso de Plantilla, el nombre a secas.
  function nombreConFicha(id, nombre) {
    if (!VER_FICHAS || !id) return esc(nombre);
    return `<a href="${hrefFicha(id)}" target="_blank" rel="noopener" title="Abrir su ficha en Plantilla (otra pestaña)"
              class="hover:text-telecab-gold hover:underline underline-offset-2">${esc(nombre)}</a>`;
  }
  // En las que se despliegan al pincharlas (llegadas, bajas), un botón dentro.
  const botonFicha = id => (VER_FICHAS && id
    ? `<a href="${hrefFicha(id)}" target="_blank" rel="noopener" title="Abre su ficha de Plantilla en otra pestaña"
          class="tc-pulsable inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-telecab-gold/40 text-telecab-gold hover:bg-telecab-gold/10">
         <i class="fa-solid fa-id-card text-[10px]"></i>Ver su ficha</a>`
    : '');
  const DIAS_LETRA = DEL_SERVIDOR.letrasDia;              // ['L','M','X','J','V','S','D']
  const ESTADOS = DEL_SERVIDOR.estadosVehiculo;           // catálogo de estados del coche
  const ESTADO_ETQ = new Map(ESTADOS.map(e => [e.codigo, e.etiqueta]));
  const esc = Casa.esc;

  // Tono del estado del coche. El operativo en verde; lo que sale de cobertura,
  // en rojo/ámbar. Es el de la casa (nucleo.js): el mismo color que en Vehículos.
  const tonoEstado = Casa.tonoEstadoCoche;

  let T = null;                       // el tablero que llega del servidor
  let AV = null;                      // avisos de turnos de la semana mirada (semáforo por cuadrante)
  let DIA = null;                     // fecha efectiva (AAAA-MM-DD)
  const porId = new Map();            // conductor id -> conductor

  // LA BASE ABIERTA ('' = ninguna: se ven las bases y las tarjetas de toda la
  // flota). Es la `clave` de `resumen.porZona`: el id de la base, o 'sin' para
  // los coches que no tienen ninguna. Viaja en la dirección (#base=getafe) para
  // que recargar o pasar el enlace abra la misma base, y «atrás» vuelva a las bases.
  let ZONA = '';
  let ZONA_PEDIDA = null;             // la de la dirección, hasta que llegue el tablero
  // LA VISTA: 'horizontal' (una fila por coche) o 'vertical' (una tarjeta por
  // coche). Se recuerda en este navegador; si no se puede, se queda en horizontal.
  let VISTA = 'horizontal';
  try { if (localStorage.getItem('planificador-vista') === 'vertical') VISTA = 'vertical'; } catch (_) {}
  // EL ORDEN DE LOS CUADRANTES (12/11/2026): 'iceberg' (cada base de mejor a
  // peor, el de siempre) o 'numero' (del 1 al último, sin agrupar por base).
  let ORDEN = 'iceberg';
  try { if (localStorage.getItem('planificador-orden') === 'numero') ORDEN = 'numero'; } catch (_) {}

  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const isoAes = iso => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
  const esAiso = txt => { const m = String(txt || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : ''; };
  const sumarDias = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  /** [1,3] -> "L X". Vacío si no hay. */
  const diasTexto = arr => (arr || []).map(d => DIAS_LETRA[d - 1]).join(' ');

  // ── El semáforo de avisos: qué cuadrantes están avisados y cuáles cambiaron ──
  // Se pide aparte del tablero (es otra pregunta: al registro de envíos) y se
  // repinta cuando llega. Si la semana mirada ya pasó, no hay nada que avisar.
  let _avToken = 0;

  // ── Las bajas de los últimos días ───────────────────────────────────────────
  // Cada nombre se despliega por su cuenta. Lo abierto se recuerda: el tablero
  // se repinta entero al mover a alguien, y sin esto se plegarían solas.
  const bajasAbiertas = new Set();
  // ── Las próximas incorporaciones (06/10/2026) ──────────────────────────────
  // Gente nueva y quien vuelve de vacaciones o de baja médica a OTRO cuadrante
  // (la lista la decide el servidor: planificador.repo.proximasIncorporaciones).
  // Cada nombre se despliega por su cuenta, y lo abierto sobrevive al repintado.
  const llegadasAbiertas = new Set();

  // LA BARRA DE HORAS: llena son 14 turnos a 9 h, la S de la calificación. Es la
  // misma escala para un coche y para la media por coche de un cuadrante.
  const HORAS_LLENO = 14 * 9;

  // ── REPINTAR SOLO LO QUE HA CAMBIADO (03/11/2026) ───────────────────────────
  //
  // Cada guardado trae el tablero entero y antes se rehacía el cuadrante entero:
  // unos 7.800 nodos y, sobre todo, recalcular sus estilos y su maqueta, que era
  // lo caro (unos 100 de los 130 ms que se quedaba congelada la pantalla en un
  // portátil rápido). Pero un guardado toca uno o dos cuadrantes de treinta.
  //
  // Cada sección lleva una FIRMA: todo lo que su pintado lee, en una cadena. Si
  // no ha cambiado, la sección que ya está en pantalla vale tal cual, con sus
  // botones. Las piezas pequeñas (cabeceras de base, franjas del iceberg) no
  // llevan firma —cuentan cosas de toda la base—: se hacen fuera del documento,
  // que es barato, y si salen IGUALES a la que ya está, se queda la de antes.
  // Meter un nodo nuevo, aunque sea idéntico, obliga a maquetar de nuevo todo
  // lo que va detrás.
  let SECCIONES = new Map();   // clave → { firma, nodo }

  let banqTab = 'todos';   // todos | ett | propios

  // ══════════ FICHAJE (db/148) ══════════
  //
  // Desde el 28/09/2026 TODO conductor de alta abre su turno por WhatsApp al
  // escribir la matrícula (se le suelta el motor). Lo que se enciende aquí,
  // PERSONA A PERSONA, es que al terminar se le BLOQUEE el motor.
  //
  // La regla que hay que tener delante, y por eso el panel la cuenta coche a
  // coche: el motor se bloquea por COCHE y el interruptor es por PERSONA. Si el
  // compañero de alguien no lo tiene, al terminar el motor SE QUEDA LIBRE —si
  // no, el compañero se encontraría el coche cortado sin saber por qué—.

  let FJ = null;        // lo que manda /api/fichaje
  let fjAbierto = false;
  let fjBusca = '';

  // ── Navegación de semana ──────────────────────────────────────────────────
  const irA = async dia => { try { await cargar(dia); } catch (e) { alert(e.message); } };
  $('#sem-prev').addEventListener('click', () => irA(sumarDias(DIA, -7)));
  $('#sem-next').addEventListener('click', () => irA(sumarDias(DIA, 7)));
  $('#hoy').addEventListener('click', () => irA(hoyISO()));
  $('#f-dia').addEventListener('change', e => { const iso = esAiso(e.target.value); if (iso) irA(iso); });
  // Las bases: pinchar una la abre; pinchar la abierta vuelve a todas.
  $('#bases').addEventListener('click', e => {
    const b = e.target.closest('[data-base]');
    if (b) elegirBase(b.dataset.base === ZONA ? '' : b.dataset.base);
  });
  $('#b-todas').addEventListener('click', () => elegirBase(''));
  $('#b-sinbase').addEventListener('click', () => elegirBase(ZONA === SIN_BASE ? '' : SIN_BASE));
  // «Atrás» y «adelante» del navegador recorren las bases abiertas.
  window.addEventListener('popstate', () => {
    if (!T) return;
    elegirBase(claveDeNombre(baseDeLaUrl()), { apilar: false });
  });
  // La vista. Cambiarla no recarga nada: se repinta con lo que ya hay.
  function pintarVista() {
    document.querySelectorAll('#f-vista [data-vista]').forEach(b => {
      const on = b.dataset.vista === VISTA;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('bg-telecab-gold/15', on);
      b.classList.toggle('text-telecab-gold', on);
      b.classList.toggle('font-semibold', on);
      b.classList.toggle('text-telecab-muted', !on);
    });
  }
  document.querySelectorAll('#f-vista [data-vista]').forEach(b => b.addEventListener('click', () => {
    if (VISTA === b.dataset.vista) return;
    VISTA = b.dataset.vista;
    try { localStorage.setItem('planificador-vista', VISTA); } catch (_) {}
    pintarVista();
    if (T) pintar();
  }));
  pintarVista();
  function pintarOrden() {
    document.querySelectorAll('#f-orden [data-orden]').forEach(b => {
      const on = b.dataset.orden === ORDEN;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('bg-telecab-gold/15', on);
      b.classList.toggle('text-telecab-gold', on);
      b.classList.toggle('font-semibold', on);
      b.classList.toggle('text-telecab-muted', !on);
    });
  }
  document.querySelectorAll('#f-orden [data-orden]').forEach(b => b.addEventListener('click', () => {
    if (ORDEN === b.dataset.orden) return;
    ORDEN = b.dataset.orden;
    try { localStorage.setItem('planificador-orden', ORDEN); } catch (_) {}
    pintarOrden();
    if (T) pintar();
  }));
  pintarOrden();
  $('#f-huecos').addEventListener('change', pintar);
  { let t; $('#f-busca').addEventListener('input', () => { clearTimeout(t); t = setTimeout(pintar, 150); }); }
  $('#banq-busca').addEventListener('input', pintarBanquillo);
  document.querySelectorAll('.banq-tab').forEach(b =>
    b.addEventListener('click', () => { banqTab = b.dataset.banqTab; pintarBanquillo(); }));
  $('#k-flojos-caja').addEventListener('click', verCtFlojos);
  // Un nombre de las próximas incorporaciones: despliega (o pliega) su ficha; y
  // «Ver su cuadrante» lleva hasta él.
  $('#llegadas').addEventListener('click', e => {
    const ir = e.target.closest('[data-ir-vehiculo]');
    if (ir) {
      irAlCuadrante({ cuadranteId: ir.dataset.irCuadrante, vehiculoId: ir.dataset.irVehiculo, zonaClave: ir.dataset.irZona });
      return;
    }
    const b = e.target.closest('[data-llegada]');
    if (!b) return;
    const id = b.dataset.llegada;
    const abrir = !llegadasAbiertas.has(id);
    if (abrir) llegadasAbiertas.add(id); else llegadasAbiertas.delete(id);
    b.setAttribute('aria-expanded', String(abrir));
    b.querySelector('i').classList.toggle('rotate-180', abrir);
    b.nextElementSibling.classList.toggle('hidden', !abrir);
  });
  // Un nombre del panel de bajas: despliega (o pliega) su motivo.
  $('#bajas').addEventListener('click', e => {
    const b = e.target.closest('[data-baja]');
    if (!b) return;
    const id = b.dataset.baja;
    const abrir = !bajasAbiertas.has(id);
    if (abrir) bajasAbiertas.add(id); else bajasAbiertas.delete(id);
    b.setAttribute('aria-expanded', String(abrir));
    b.querySelector('i').classList.toggle('rotate-180', abrir);
    b.nextElementSibling.classList.toggle('hidden', !abrir);
  });
  $('#btn-avisos').addEventListener('click', () => $('#avisos').classList.toggle('hidden'));
  // Estos dos no existen en modo solo lectura (los quita la plantilla).
  if ($('#btn-nuevo-cua')) $('#btn-nuevo-cua').addEventListener('click', nuevoCuadrante);
  if ($('#btn-zonas')) $('#btn-zonas').addEventListener('click', gestionarZonas);
  if ($('#btn-evento')) $('#btn-evento').addEventListener('click', abrirEvento);
  if ($('#btn-fichaje')) $('#btn-fichaje').addEventListener('click', abrirFichaje);

  // Arranque. La base de la dirección (#base=getafe) se abre en cuanto llegue
  // el tablero, que es quien sabe qué bases hay.
  ZONA_PEDIDA = baseDeLaUrl() || null;
  irA(hoyISO());
