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
function semillaDeRol(rol) {
  if (rol === 'oficina') return [...G('General'), ...G('Contratación'), ...G('RRHH'), '/visibilidad'];
  if (rol === 'trafico') return [...G('General'), ...G('Tráfico'), ...G('Flota'), ...G('Operaciones')].filter(c => c !== '/documentos');
  return [];   // superadmin/desarrollador: acceso total, sin filas
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
