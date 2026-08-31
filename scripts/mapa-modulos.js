// ============================================================
// MAPA DE MÓDULOS — de qué come cada pantalla
// ============================================================
//   node scripts/mapa-modulos.js
//
// Para planificar una migración hace falta saber qué lee cada módulo y de quién
// depende. Esto lo saca del código en vez de de la memoria de nadie.
//
// Clasifica cada ruta por sus FUENTES: hojas de cálculo, PostgreSQL, APIs
// externas. Y por su TAMAÑO, que es lo que de verdad predice el trabajo.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = p => { try { return fs.readFileSync(path.join(RAIZ, p), 'utf8'); } catch (e) { return ''; } };

// Servicios que hablan con cada fuente. Un módulo "come" de una fuente si él o
// alguno de sus servicios la toca.
const SERV_HOJAS = new Set();
const SERV_PG = new Set();
const SERV_API = new Set();

for (const f of fs.readdirSync(path.join(RAIZ, 'services'))) {
  if (!f.endsWith('.js')) continue;
  const t = leer('services/' + f);
  if (/require\(['"]\.\/sheets['"]\)|readMany|writeSheet|writeMany|SPREADSHEET_/.test(t)) SERV_HOJAS.add(f);
  if (/require\(['"]\.\/db['"]\)|require\(['"]\.\/repo\//.test(t)) SERV_PG.add(f);
  if (/fetchAllPaginated|fetchRangoCompleto|apiRequest|require\(['"]\.\/mapon['"]\)/.test(t)) SERV_API.add(f);
}

const rutas = fs.readdirSync(path.join(RAIZ, 'routes')).filter(f => f.endsWith('.js'));
const filas = [];

for (const r of rutas) {
  const t = leer('routes/' + r);
  const nombre = r.replace('.js', '');
  const usa = [...t.matchAll(/require\(['"]\.\.\/services\/([a-zA-Z0-9]+)['"]\)/g)].map(m => m[1] + '.js');

  const hojas = new Set(), pg = new Set(), api = new Set();
  if (/require\(['"]\.\.\/services\/sheets['"]\)|readMany|writeSheet/.test(t)) hojas.add('(directo)');
  if (/require\(['"]\.\.\/services\/db['"]\)|require\(['"]\.\.\/services\/repo\//.test(t)) pg.add('(directo)');
  if (/fetchAllPaginated|fetchRangoCompleto|require\(['"]\.\.\/services\/mapon['"]\)/.test(t)) api.add('(directo)');
  usa.forEach(s => {
    if (SERV_HOJAS.has(s)) hojas.add(s);
    if (SERV_PG.has(s)) pg.add(s);
    if (SERV_API.has(s)) api.add(s);
  });

  // La vista, si la hay: su tamaño manda tanto como el de la ruta.
  const posibles = [nombre, nombre.replace(/s$/, ''), { tablero: 'planificadorV2', boltHoras: 'control' }[nombre]];
  const vista = posibles.filter(Boolean).map(v => 'views/' + v + '.ejs').find(p => fs.existsSync(path.join(RAIZ, p)));

  const lineas = t.split('\n').length + (vista ? leer(vista).split('\n').length : 0);
  const serviciosPropios = usa.filter(s => fs.existsSync(path.join(RAIZ, 'services', s)));
  const lineasServicios = serviciosPropios.reduce((n, s) => n + leer('services/' + s).split('\n').length, 0);

  filas.push({
    modulo: nombre,
    vista: vista ? vista.replace('views/', '') : '—',
    hojas: [...hojas],
    pg: [...pg],
    api: [...api],
    lineas,
    lineasServicios,
    total: lineas + lineasServicios,
    servicios: serviciosPropios,
  });
}

const estado = f => {
  if (f.hojas.length && f.pg.length) return 'MIXTO';
  if (f.pg.length) return 'PostgreSQL';
  if (f.hojas.length) return 'Hojas';
  return 'sin datos';
};

filas.sort((a, b) => b.total - a.total);

console.log(`${filas.length} módulos con ruta propia\n`);
console.log('MÓDULO           ESTADO        LÍNEAS   API   SERVICIOS QUE USA');
console.log('─'.repeat(100));
for (const f of filas) {
  console.log(
    f.modulo.padEnd(17) +
    estado(f).padEnd(13) +
    String(f.total).padStart(6) + '   ' +
    (f.api.length ? 'sí ' : '   ') + '   ' +
    f.servicios.slice(0, 4).map(s => s.replace('.js', '')).join(', ') +
    (f.servicios.length > 4 ? ` +${f.servicios.length - 4}` : ''));
}

const porEstado = {};
filas.forEach(f => { porEstado[estado(f)] = (porEstado[estado(f)] || 0) + 1; });
console.log('\nPOR ESTADO:');
Object.entries(porEstado).sort((a, b) => b[1] - a[1]).forEach(([e, n]) => console.log(`  ${e}: ${n}`));

const enHojas = filas.filter(f => f.hojas.length);
console.log(`\nLíneas por migrar (módulos que aún tocan hojas): ${enHojas.reduce((n, f) => n + f.total, 0)}`);

// Los servicios más compartidos: migrar uno de esos arrastra a muchos.
const cuantos = {};
filas.forEach(f => f.servicios.forEach(s => { cuantos[s] = (cuantos[s] || 0) + 1; }));
console.log('\nSERVICIOS MÁS COMPARTIDOS (migrar uno arrastra a todos sus módulos):');
Object.entries(cuantos).filter(([s]) => SERV_HOJAS.has(s)).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([s, n]) => console.log(`  ${String(n).padStart(2)} módulos → ${s.replace('.js', '')}`));
