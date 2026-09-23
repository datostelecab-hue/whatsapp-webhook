// ============================================================
// PERMISOS — qué módulos puede abrir cada usuario, elegidos uno a uno
// ============================================================
// Antes el acceso iba por ROL con un mapa fijo (sesion.ACCESO). Ahora cada
// usuario lleva SUS módulos y submódulos en `usuario_permiso`, elegidos desde
// /usuarios. El CATÁLOGO de aquí es la única fuente de verdad y lo usan tres
// sitios: el control de acceso (sesion.js), el menú lateral (layout-gestion) y
// la matriz de la pantalla de usuarios.
//
//   · La CLAVE de un permiso es el prefijo de ruta del módulo ('/control',
//     '/control/km'…). Manda el prefijo MÁS LARGO que case con la URL: tener
//     '/control' no abre '/control/km' si ese submódulo está en el catálogo
//     aparte — así los submódulos se conceden de verdad uno a uno.
//   · Los roles con acceso_total (superadmin, desarrollador) lo abren todo sin
//     filas. Lo que no está en el catálogo (configuración, soporte, exportar,
//     perfil…) es libre para cualquier usuario dentro.
//   · Al crear un usuario se le siembran los permisos TÍPICOS de su rol (el
//     reparto de siempre: oficina ↔ trafico); luego se afinan a mano.

const db = require('./db');

// ── El catálogo: grupos → módulos (con sus submódulos) ──────────────────────
// `hijos` son submódulos con clave propia (prefijo más largo = permiso aparte).
const CATALOGO = [
  { grupo: 'General', items: [
    // El panel de inicio. Su pantalla se abre SIEMPRE (es donde cae todo el
    // mundo al entrar); esta clave decide si se ven las cifras de la empresa o
    // el panel vacío. Ver la excepción de `controlAcceso` en services/sesion.js.
    { clave: '/inicio',     etiqueta: 'Panel de inicio (cifras)' },
    { clave: '/pendientes', etiqueta: 'Pendientes' },
    { clave: '/bitacora',   etiqueta: 'Bitácora' },
    { clave: '/plantilla',  etiqueta: 'Plantilla' },
    // Enlazar una cuenta fantasma MUEVE HORAS de una persona a otra, y las
    // horas son nómina, promedio y cuadrante. Va aparte de '/plantilla'
    // porque ahí entra medio RRHH y esto no es de medio RRHH.
    { clave: '/plantilla/fantasma', etiqueta: 'Enlazar cuentas fantasma' },
    { clave: '/documentos', etiqueta: 'Documentos' },
  ] },
  { grupo: 'Contratación', items: [
    { clave: '/vacantes',  etiqueta: 'Vacantes' },
    { clave: '/seleccion', etiqueta: 'Selección' },
    { clave: '/ett',       etiqueta: 'ETT' },
  ] },
  { grupo: 'RRHH', items: [
    { clave: '/rrhh',           etiqueta: 'RRHH' },
    { clave: '/administracion', etiqueta: 'Administración' },
    { clave: '/ticketera',      etiqueta: 'Ticketera RRHH' },
    { clave: '/reportes',       etiqueta: 'Reportes RRHH' },
    { clave: '/nominas',        etiqueta: 'Nóminas' },
    { clave: '/convenio',       etiqueta: 'Convenio' },
  ] },
  { grupo: 'Tráfico', items: [
    // MIRAR el planificador lo necesita media empresa: RRHH quiere saber dónde
    // cae una persona, Operaciones qué coche sale mañana, el taller cuándo
    // puede llevarse un coche. TOCARLO es de Tráfico.
    //
    // Y aquí el permiso de escribir NO va por una lista de rutas como en la
    // bitácora o el taller: va por MÉTODO. El tablero tiene veinte endpoints
    // que escriben y una lista a mano se queda corta el día que alguien añade
    // el veintiuno — que es justo el día en que un candado tiene que seguir
    // cerrado. Ver `claveDeRuta`.
    { clave: '/planificador', etiqueta: 'Planificador', hijos: [
      { clave: '/planificador/editar', etiqueta: 'Planificador · editar (guardar cambios)',
        escribir: true },
    ] },
    { clave: '/control',         etiqueta: 'Control · En directo', hijos: [
      { clave: '/control/historico', etiqueta: 'Histórico de control' },
      { clave: '/control/km',       etiqueta: 'KM y traza' },
      { clave: '/control/reportes', etiqueta: 'Reportes de control' },
    ] },
    { clave: '/visibilidad', etiqueta: 'Visibilidad' },
    { clave: '/mapa',        etiqueta: 'Mapa de flota' },
    { clave: '/cobertura',   etiqueta: 'Cobertura' },
    { clave: '/generador',   etiqueta: 'Generar vacantes' },
  ] },
  { grupo: 'Taller', items: [
    { clave: '/vehiculos',   etiqueta: 'Vehículos', hijos: [
      // El sistema se usa en Madrid. Quien no tenga esta llave ve SOLO Madrid,
      // que es lo que Óscar controla; con ella se ven también los de Barcelona.
      // `manual` porque no la reparte ningún rol: se da persona a persona.
      { clave: '/vehiculos/sedes', etiqueta: 'Ver también los vehículos de Barcelona', manual: true },
    ] },
    { clave: '/conductores', etiqueta: 'Conductores' },
    // MIRAR el taller lo quiere media empresa: tráfico necesita saber qué coche
    // se le cae la semana que viene. APUNTAR es del taller, y es lo que mueve
    // los números que deciden qué coche entra. Por eso son dos permisos, como
    // leer la bitácora y justificar en ella.
    { clave: '/taller', etiqueta: 'Mantenimientos', hijos: [
      { clave: '/taller/apuntar', etiqueta: 'Mantenimientos · apuntar revisiones y odómetros' },
    ] },
    // MIRAR lo que se gasta en la flota lo quiere dirección; METERLO es del
    // taller. Mismo reparto que en mantenimientos, y por el mismo motivo.
    { clave: '/facturas', etiqueta: 'Facturas de taller', hijos: [
      { clave: '/facturas/apuntar', etiqueta: 'Facturas · dar de alta y anular' },
    ] },
  ] },
  { grupo: 'Operaciones', items: [
    { clave: '/operaciones', etiqueta: 'Alertas Mapon', hijos: [
      { clave: '/operaciones/auditoria', etiqueta: 'Auditoría flota' },
    ] },
    { clave: '/sanciones',  etiqueta: 'Sanciones velocidad' },
    { clave: '/callcenter', etiqueta: 'Call Center' },
    // MIRAR las alertas es una cosa; decidir QUIÉN las recibe y a partir de
    // cuántos rechazos suenan es otra, y esa segunda no la reparte ningún rol:
    // `manual` la deja apagada hasta para quien lleva el catálogo entero, y se
    // da usuario a usuario desde /usuarios.
    { clave: '/alertas', etiqueta: 'Alertas de control (rechazos y km)', hijos: [
      { clave: '/alertas/config', etiqueta: 'Alertas · elegir destinatarios y umbrales', manual: true },
    ] },
  ] },
  { grupo: 'Aprobaciones', items: [
    // Quién entra aquí lo decide el desarrollador usuario a usuario: el módulo
    // no viene sembrado en ningún rol (salvo los que llevan TODO el catálogo).
    { clave: '/justificantes', etiqueta: 'Justificantes (aprobación)' },
    // PONER la J (y quitarla, y marcar libranza) desde la bitácora. Es un
    // poder aparte de ABRIR la bitácora: media empresa la mira, y solo algunos
    // escriben en ella. Antes era una lista de roles escrita en la vista
    // —['trafico','desarrollador','superadmin']— así que el de taller no podía
    // justificar sus propias averías y no había forma de dárselo sin tocar
    // código. Y la API no comprobaba nada: el candado era solo el botón.
    { clave: '/bitacora/justificar', etiqueta: 'Justificar días en la bitácora' },
    // FICHAR lo hace cualquiera que tenga el fichaje activado en su ficha, y
    // por eso '/fichaje' NO está en el catálogo (ver db/106): un permiso para
    // fichar sería una forma más de que alguien no pueda fichar el día que le
    // toca. Esto es lo otro: ver el registro de TODOS, corregir las horas y
    // darlas por buenas.
    //
    // `manual` de verdad: no la siembra ningún rol y no entra ni en TODO(), así
    // que ni gerencia ni dirección la reciben por llevar el catálogo entero.
    // Las horas que aquí se aprueban son las que luego se cobran; quién las
    // firma no se decide por descarte.
    { clave: '/fichaje/revisar', etiqueta: 'Fichajes · corregir y aprobar horas', manual: true },
  ] },
  { grupo: 'Caja', items: [
    // Nacen APAGADOS para todo el mundo, hasta para dirección: `manual` los
    // saca de TODO(), así que ni siquiera los roles que llevan el catálogo
    // entero los reciben. Los reparte el jefe uno a uno en /usuarios. Es una
    // caja: quién puede tocarla no se decide por descarte.
    { clave: '/recaudacion',        etiqueta: 'Recaudación del efectivo', manual: true },
    { clave: '/recaudacion/nomina', etiqueta: 'Recaudación · descuentos de nómina (RRHH)', manual: true },
  ] },
  { grupo: 'Puertas', items: [
    // ESTO NO ES UNA PANTALLA: es abrir la puerta de un coche por WhatsApp.
    // Nace apagado para TODO el mundo, incluidos los roles que llevan el
    // catálogo entero, igual que la caja. Una puerta es física y quién la abre
    // no se decide por descarte: se da una a una.
    //
    // Los conductores NO lo necesitan —ellos abren su coche por estar de alta y
    // activos en BOLT—. Esto es para la gente de oficina.
    { clave: '/puertas', etiqueta: 'Abrir puertas por WhatsApp', manual: true },
  ] },
  { grupo: 'Dirección', items: [
    { clave: '/bi', etiqueta: 'Inteligencia de negocio' },
  ] },
];

// Rutas que son el MISMO módulo con otro nombre (el front del planificador
// llama a /planificador-v2/api/*).
const ALIAS = { '/planificador-v2': '/planificador' };

// Rutas que viven bajo un prefijo pero PERTENECEN a otro submódulo del catálogo.
// Sin esto, '/control/reporte/excel' no casa con '/control/reportes' (el prefijo
// exige '/control/reportes/…') y caía en '/control': quien solo tenía "Reportes
// de control" abría la pestaña y cada botón le daba 403, y quien tenía "En
// directo" sin Reportes descargaba todo igualmente. Lo mismo con KM y traza.
// La lista de llamadas la lee el Histórico, así que es suya.
//
// Y '/flota-viva' ya no es un módulo: sus pantallas se retiraron el 11/09 y lo
// que queda son las APIs del núcleo que consume En directo (la traza de un
// conductor, las incidencias del coche). Sin esta línea quedarían SIN dueño en
// el catálogo, o sea, abiertas a cualquiera que tenga sesión.
const RUTA_A_CLAVE = [
  ['/flota-viva',                 '/control'],
  // Los tickets de Tráfico cuelgan de /planificador pero NO son planificar:
  // cerrarlos o comentarlos son POST, y sin esta línea el reparto por método
  // les exigiría el permiso de editar el tablero. Quien abre la bandeja puede
  // trabajarla.
  ['/planificador/tickets',       '/planificador'],
  ['/control/reporte/',           '/control/reportes'],
  ['/control/sankey/',            '/control/reportes'],
  ['/control/cascada/',           '/control/reportes'],
  ['/control/turnos/',            '/control/reportes'],
  ['/control/planificador/',      '/control/reportes'],
  ['/control/reporte-turnos/',    '/control/reportes'],
  ['/control/asistencia',         '/control/reportes'],
  ['/control/api/km-traza',       '/control/km'],
  ['/control/api/km-diagnostico', '/control/km'],
  ['/control/api/llamadas',       '/control/historico'],
  ['/control/api/trazos',         '/control/historico'],
  // El historial cuelga de '/control' y no del Histórico: se abre también desde
  // «En directo», que es donde se decide a quién llamar, y quien lleva el
  // directo tiene que poder ver si a esa persona ya se le llamó sin que haya
  // que darle además el módulo del Histórico entero.
  ['/control/api/historial-llamadas', '/control'],
  // LAS CUENTAS FANTASMA CUELGAN TODAS DE UN PREFIJO LIMPIO, y por eso las
  // rutas se llaman así: enlazar mueve horas —y dinero— de una persona a otra.
  // Si alguna colgara de '/plantilla/api/conductor/...' caería en '/plantilla'
  // por prefijo y cualquiera que abre la plantilla podría hacerlo.
  //
  // Mirar la lista NO pasa por aquí: va dentro de la ficha, con '/plantilla'.
  // Ver que alguien trabajó con una cuenta prestada es información de RRHH;
  // moverla, no.
  ['/plantilla/api/fantasma', '/plantilla/fantasma'],
  ['/control/api/historico',      '/control/historico'],
  ['/control/campanas',           '/control'],
  // Escribir en la bitácora es otro permiso que leerla: sin estas tres líneas
  // caerían en '/bitacora' y cualquiera que la abre podría justificar por API.
  // Apuntar en el taller es otro permiso que mirarlo: sin estas cuatro líneas
  // caerían en '/taller' y cualquiera que abre la pantalla podría escribir por
  // API el km que le diera la gana.
  ['/taller/api/mantenimiento', '/taller/apuntar'],
  ['/taller/api/anular',        '/taller/apuntar'],
  ['/taller/api/ancla',         '/taller/apuntar'],
  ['/taller/api/intervalo',     '/taller/apuntar'],
  ['/bitacora/api/justificar',          '/bitacora/justificar'],
  ['/bitacora/api/anular-justificante', '/bitacora/justificar'],
  ['/bitacora/api/libranza',            '/bitacora/justificar'],
];

// Los módulos que separan LEER de ESCRIBIR por método: clave base → clave de
// escritura. Sale del propio catálogo, así que marcar el hijo con
// `escribir: true` es lo único que hay que hacer para partir un módulo en dos.
const CLAVE_ESCRIBIR = new Map();
CATALOGO.forEach(g => g.items.forEach(i =>
  (i.hijos || []).forEach(h => { if (h.escribir) CLAVE_ESCRIBIR.set(i.clave, h.clave); })));

// HEAD y OPTIONS van con GET a propósito: ninguno cambia nada, y OPTIONS lo
// manda el navegador solo.
const SOLO_LEE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Todas las claves, aplanadas y de la más larga a la más corta (para que en el
// control de acceso mande el prefijo más específico).
const CLAVES = [];
CATALOGO.forEach(g => g.items.forEach(i => {
  CLAVES.push(i.clave);
  (i.hijos || []).forEach(h => CLAVES.push(h.clave));
}));
CLAVES.sort((a, b) => b.length - a.length);
const ES_CLAVE = new Set(CLAVES);

/**
 * La clave del catálogo que gobierna esta ruta (la más específica), o null si es
 * libre.
 *
 * EL MÉTODO IMPORTA en los módulos partidos en mirar/tocar: un GET a
 * /planificador pide '/planificador' y un POST pide '/planificador/editar'. Así
 * el candado no depende de acordarse de apuntar cada endpoint nuevo en una
 * lista — se cierra solo.
 *
 * La tabla explícita (`RUTA_A_CLAVE`) manda por encima de todo esto: lo que
 * está ahí apuntado se resuelve tal cual, mire lo que mire el método. Es la
 * puerta de atrás para los casos que no son lo que parecen, como la bandeja de
 * tickets que cuelga del planificador.
 */
function claveDeRuta(path, metodo) {
  let p = String(path || '');
  const seg = '/' + (p.split('/')[1] || '');
  if (ALIAS[seg]) p = ALIAS[seg] + p.slice(seg.length);
  for (const [ruta, clave] of RUTA_A_CLAVE) {
    if (p === ruta || p.startsWith(ruta)) return clave;
  }
  const lee = SOLO_LEE.has(String(metodo || 'GET').toUpperCase());
  for (const c of CLAVES) {
    if (p === c || p.startsWith(c + '/')) {
      const escribir = CLAVE_ESCRIBIR.get(c);
      return escribir && !lee ? escribir : c;
    }
  }
  return null;
}

// ── Los permisos típicos de cada rol (la semilla, el reparto de siempre) ─────
const G = nombre => {
  const g = CATALOGO.find(x => x.grupo === nombre);
  const out = [];
  (g ? g.items : []).forEach(i => { out.push(i.clave); (i.hijos || []).forEach(h => out.push(h.clave)); });
  return out;
};
// Todas las claves del catálogo, para los roles que las llevan todas. Las
// marcadas `manual` NO entran ni aquí: son las que se dan una a una.
const TODO = () => CATALOGO.flatMap(g =>
  g.items.filter(i => !i.manual).flatMap(i => [i.clave, ...(i.hijos || []).filter(h => !h.manual).map(h => h.clave)]));

/**
 * Con qué se ESTRENA cada rol. No es lo que puede ver para siempre: en cuanto
 * el usuario existe, el permiso real es el suyo y se afina uno a uno en
 * /usuarios. Esto solo evita que entre a una pantalla vacía el primer día.
 *
 * La regla al repartir: cada uno con lo SUYO y nada más. Es más fácil añadirle
 * un módulo a quien lo pide que enterarse de que lleva un año viendo las
 * nóminas de los demás.
 */
function semillaDeRol(rol) {
  switch (rol) {
    // --- los de siempre ---
    case 'oficina': return [...G('General'), ...G('Contratación'), ...G('RRHH'), '/visibilidad'];
    // '/bitacora/justificar' va suelto y no por el grupo: Tráfico es quien
    // justifica de siempre, pero el grupo 'Aprobaciones' lleva además la
    // pantalla de aprobación, y esa la reparte el jefe a mano.
    case 'trafico': return [...G('General'), ...G('Tráfico'), ...G('Taller'), ...G('Operaciones'), '/bitacora/justificar']
      .filter(c => c !== '/documentos');

    // --- tráfico, en dos alturas ---
    // El jefe lleva su área entera y además ve el negocio; el gestor hace el
    // día a día y no entra ni en documentos ni en sanciones, que son de quien
    // manda.
    case 'jefe_trafico': return [...G('General'), ...G('Tráfico'), ...G('Taller'), ...G('Operaciones'), '/bi']
      .filter(c => c !== '/documentos');
    case 'gestor_trafico': return [
      '/inicio', '/pendientes', '/bitacora', '/plantilla',
      ...G('Tráfico'), ...G('Taller'), '/callcenter',
    ];

    // El taller vive en los coches. Nada de personas más allá de saber quién
    // lleva cada uno.
    case 'taller': return ['/pendientes', '/vehiculos', '/conductores',
      '/operaciones', '/operaciones/auditoria', '/control/km'];

    // Quien recluta necesita el embudo entero y ver la plantilla para saber
    // qué hueco está tapando. Las nóminas y las fichas sensibles, no.
    case 'reclutador': return ['/pendientes', '/plantilla', '/documentos',
      ...G('Contratación'), '/generador', '/cobertura'];

    // Administración es el papel y el dinero: contratos, nóminas, convenio.
    // No planifica ni ve el directo.
    case 'administracion': return ['/inicio', '/pendientes', '/plantilla', '/documentos', '/bitacora',
      '/rrhh', '/administracion', '/ticketera', '/reportes', '/nominas', '/convenio', '/ett'];

    // Operaciones es el control de lo que pasa en la calle.
    case 'operaciones': return [...G('General'), ...G('Operaciones'), ...G('Taller'),
      '/control', '/control/historico', '/control/km', '/control/reportes', '/visibilidad',
      '/mapa', '/bitacora']
      .filter(c => c !== '/documentos');

    // Dirección lo ve TODO, pero por la matriz y no por `acceso_total`: así se
    // ve en /usuarios lo que alcanza y se le puede quitar algo sin tocar código.
    case 'gerencia':
    case 'directiva': return TODO();

    default: return [];   // superadmin/desarrollador: acceso total, sin filas
  }
}

// ── Lectura con caché (el control de acceso corre en cada petición) ──────────
const TTL = 60 * 1000;
const cache = new Map();   // usuario_id -> { claves:Set, ts }

async function clavesDe(usuarioId) {
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id <= 0) return new Set();
  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < TTL) return hit.claves;
  const r = await db.consulta('SELECT clave FROM usuario_permiso WHERE usuario_id = $1', [id]);
  const claves = new Set(r.rows.map(x => x.clave));
  cache.set(id, { claves, ts: Date.now() });
  return claves;
}
const invalidar = usuarioId => cache.delete(Number(usuarioId));

/** Reemplaza los permisos de un usuario por esta lista (solo claves del catálogo). */
async function guardar(usuarioId, claves, { usuarioMod } = {}) {
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el usuario');
  const limpias = [...new Set((claves || []).filter(c => ES_CLAVE.has(c)))];
  await db.transaccion(async cli => {
    await cli.query('DELETE FROM usuario_permiso WHERE usuario_id = $1', [id]);
    for (const c of limpias) {
      await cli.query(
        'INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod) VALUES ($1, $2, $3)',
        [id, c, usuarioMod || null]);
    }
  });
  invalidar(id);
  return { claves: limpias };
}

/** Siembra los permisos del rol si el usuario aún no tiene NINGUNO. */
async function sembrar(usuarioId, rol, { usuarioMod, cli } = {}) {
  const q = cli ? cli.query.bind(cli) : db.consulta;
  const hay = await q('SELECT 1 FROM usuario_permiso WHERE usuario_id = $1 LIMIT 1', [usuarioId]);
  if (hay.rows.length) return 0;
  const claves = semillaDeRol(rol);
  for (const c of claves) {
    await q('INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [usuarioId, c, usuarioMod || null]);
  }
  invalidar(usuarioId);
  return claves.length;
}

module.exports = { CATALOGO, CLAVES, ALIAS, CLAVE_ESCRIBIR, claveDeRuta, semillaDeRol, clavesDe, guardar, sembrar, invalidar };
