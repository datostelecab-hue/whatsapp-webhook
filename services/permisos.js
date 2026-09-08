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
    { clave: '/peticiones', etiqueta: 'Peticiones' },
    { clave: '/bitacora',   etiqueta: 'Bitácora' },
    { clave: '/plantilla',  etiqueta: 'Plantilla' },
    { clave: '/documentos', etiqueta: 'Documentos' },
  ] },
  { grupo: 'Contratación', items: [
    { clave: '/vacantes',  etiqueta: 'Vacantes' },
    { clave: '/seleccion', etiqueta: 'Selección' },
    { clave: '/ett',       etiqueta: 'ETT' },
  ] },
  { grupo: 'RRHH', items: [
    { clave: '/rrhh',           etiqueta: 'RRHH' },
    { clave: '/fichas',         etiqueta: 'Fichas (datos sensibles)' },
    { clave: '/administracion', etiqueta: 'Administración' },
    { clave: '/ticketera',      etiqueta: 'Ticketera RRHH' },
    { clave: '/reportes',       etiqueta: 'Reportes RRHH' },
    { clave: '/nominas',        etiqueta: 'Nóminas extras' },
    { clave: '/convenio',       etiqueta: 'Convenio' },
  ] },
  { grupo: 'Tráfico', items: [
    { clave: '/planificador',    etiqueta: 'Planificador' },
    { clave: '/agenda',          etiqueta: 'Agenda' },
    { clave: '/control',         etiqueta: 'Control · En directo', hijos: [
      { clave: '/flota-viva',       etiqueta: 'Flota viva + Histórico' },
      { clave: '/control/km',       etiqueta: 'KM y traza' },
      { clave: '/control/reportes', etiqueta: 'Reportes de control' },
    ] },
    { clave: '/visibilidad', etiqueta: 'Visibilidad' },
    { clave: '/cobertura',   etiqueta: 'Cobertura' },
    { clave: '/generador',   etiqueta: 'Generar vacantes' },
  ] },
  { grupo: 'Flota', items: [
    { clave: '/matching',    etiqueta: 'Matching' },
    { clave: '/vehiculos',   etiqueta: 'Vehículos' },
    { clave: '/conductores', etiqueta: 'Conductores' },
  ] },
  { grupo: 'Operaciones', items: [
    { clave: '/operaciones', etiqueta: 'Alertas Mapon', hijos: [
      { clave: '/operaciones/auditoria', etiqueta: 'Auditoría flota' },
      { clave: '/operaciones/vivo',      etiqueta: 'Auditoría en vivo' },
    ] },
    { clave: '/sanciones',  etiqueta: 'Sanciones velocidad' },
    { clave: '/callcenter', etiqueta: 'Call Center' },
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
// La lista de llamadas la lee el Histórico (Flota viva), así que es suya.
const RUTA_A_CLAVE = [
  ['/control/reporte/',           '/control/reportes'],
  ['/control/sankey/',            '/control/reportes'],
  ['/control/turnos/',            '/control/reportes'],
  ['/control/planificador/',      '/control/reportes'],
  ['/control/reporte-turnos/',    '/control/reportes'],
  ['/control/api/km-traza',       '/control/km'],
  ['/control/api/km-diagnostico', '/control/km'],
  ['/control/api/llamadas',       '/flota-viva'],
];

// Todas las claves, aplanadas y de la más larga a la más corta (para que en el
// control de acceso mande el prefijo más específico).
const CLAVES = [];
CATALOGO.forEach(g => g.items.forEach(i => {
  CLAVES.push(i.clave);
  (i.hijos || []).forEach(h => CLAVES.push(h.clave));
}));
CLAVES.sort((a, b) => b.length - a.length);
const ES_CLAVE = new Set(CLAVES);

/** La clave del catálogo que gobierna esta ruta (la más específica), o null si es libre. */
function claveDeRuta(path) {
  let p = String(path || '');
  const seg = '/' + (p.split('/')[1] || '');
  if (ALIAS[seg]) p = ALIAS[seg] + p.slice(seg.length);
  for (const [ruta, clave] of RUTA_A_CLAVE) {
    if (p === ruta || p.startsWith(ruta)) return clave;
  }
  for (const c of CLAVES) {
    if (p === c || p.startsWith(c + '/')) return c;
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
// Todas las claves del catálogo, para los roles que las llevan todas.
const TODO = () => CATALOGO.flatMap(g =>
  g.items.flatMap(i => [i.clave, ...(i.hijos || []).map(h => h.clave)]));

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
    case 'trafico': return [...G('General'), ...G('Tráfico'), ...G('Flota'), ...G('Operaciones')].filter(c => c !== '/documentos');

    // --- tráfico, en dos alturas ---
    // El jefe lleva su área entera y además ve el negocio; el gestor hace el
    // día a día y no entra ni en documentos ni en sanciones, que son de quien
    // manda.
    case 'jefe_trafico': return [...G('General'), ...G('Tráfico'), ...G('Flota'), ...G('Operaciones'), '/bi']
      .filter(c => c !== '/documentos');
    case 'gestor_trafico': return [
      '/inicio', '/pendientes', '/peticiones', '/bitacora', '/plantilla',
      ...G('Tráfico'), ...G('Flota'), '/callcenter',
    ];

    // El taller vive en los coches. Nada de personas más allá de saber quién
    // lleva cada uno.
    case 'taller': return ['/pendientes', '/peticiones', '/vehiculos', '/conductores', '/matching',
      '/operaciones', '/operaciones/auditoria', '/control/km'];

    // Quien recluta necesita el embudo entero y ver la plantilla para saber
    // qué hueco está tapando. Las nóminas y las fichas sensibles, no.
    case 'reclutador': return ['/pendientes', '/peticiones', '/plantilla', '/documentos',
      ...G('Contratación'), '/generador', '/cobertura'];

    // Administración es el papel y el dinero: contratos, nóminas, convenio.
    // No planifica ni ve el directo.
    case 'administracion': return ['/inicio', '/pendientes', '/peticiones', '/plantilla', '/documentos', '/bitacora',
      '/rrhh', '/fichas', '/administracion', '/ticketera', '/reportes', '/nominas', '/convenio', '/ett'];

    // Operaciones es el control de lo que pasa en la calle.
    case 'operaciones': return [...G('General'), ...G('Operaciones'), ...G('Flota'),
      '/control', '/flota-viva', '/control/km', '/control/reportes', '/visibilidad', '/bitacora']
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

module.exports = { CATALOGO, CLAVES, ALIAS, claveDeRuta, semillaDeRol, clavesDe, guardar, sembrar, invalidar };
