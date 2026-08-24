// ============================================================
// LA REGLA DE LA INGESTA
// ============================================================
//   node scripts/comprobar-ingesta.js
//
// REGLA: los datos externos entran por UN sitio. `services/ingesta.js` llama a
// BOLT y a Mapon; todo lo demás lee de PostgreSQL.
//
// Una regla que solo está escrita en un comentario dura hasta que alguien tiene
// prisa. Esto la comprueba: si una ruta o una pantalla vuelve a llamar a una
// API, sale aquí antes de desplegar.
//
// Los módulos que todavía llaman por su cuenta están en PERMITIDOS, con su
// motivo. La lista solo puede encoger: cada uno que se migre, se borra de ahí.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Cómo se reconoce una llamada a una API externa.
const SENALES = [
  { patron: /fetchAllPaginated|fetchRangoCompleto|getAccessToken|apiRequest\s*\(/, api: 'BOLT' },
  { patron: /require\(['"][^'"]*\/mapon['"]\)|require\(['"]\.\/mapon['"]\)/, api: 'Mapon' },
  { patron: /require\(['"][^'"]*\/bolt['"]\)|require\(['"]\.\/bolt['"]\)/, api: 'BOLT' },
];

// La única puerta.
const PUERTA = ['services/ingesta.js'];

// Lo que la ingesta usa por debajo: son sus brazos, no puertas nuevas.
const BRAZOS = [
  'services/cazamientoBolt.js',
  'services/conductoresBolt.js',
  'services/sincroMapon.js',
  'services/mapon.js',
  'services/bolt.js',
  'services/repo/vehiculosBolt.js',
];

// Lo que TODAVÍA llama por su cuenta. Cada línea es una deuda con su motivo.
// Esta lista solo puede encoger.
const PERMITIDOS = {
  'services/auditoriaFlota.js':  'Auditoría de KM: pide rangos históricos que la ingesta no guarda todavía',
  'services/auditoriaVivo.js':   'Auditoría en vivo: necesita el estado al segundo, no cada 5 minutos',
  'services/boltHorasCore.js':   'Tubería de horas: su propio ciclo incremental cada 10 minutos',
  'services/boltResumen.js':     'Resumen de BOLT: se migra con la tubería de horas',
  'services/boltHistorico.js':   'Relleno de meses pasados: se lanza a mano y pide hasta 16 meses atrás, ' +
                                 'que es justo lo contrario de un latido cada 5 minutos',
  'services/conductores.js':     'Módulo viejo sobre hojas: muere cuando la agenda pase a PostgreSQL',
  'services/sanciones.js':       'Sanciones: lee excesos de velocidad de Mapon en su propio cron',
  'services/fichaje.js':         'Fichaje: ESCRIBE en Mapon (enlaza conductor y coche), no lee',
  'routes/nominas.js':           'Nóminas: se migra con la tubería de horas',
  'routes/operaciones.js':       'Panel de operaciones: se migra con las auditorías',
};

// Donde NUNCA puede haber una llamada: si una pantalla depende de una API,
// tarda lo que tarde esa API y se cae cuando ella se cae.
const PROHIBIDO_SIEMPRE = [/^routes\//, /^views\//];

function ficherosDe(dir, ext) {
  const salida = [];
  const rec = d => {
    for (const e of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') rec(rel); continue; }
      if (ext.some(x => e.name.endsWith(x))) salida.push(rel);
    }
  };
  rec(dir);
  return salida;
}

const ficheros = [...ficherosDe('services', ['.js']), ...ficherosDe('routes', ['.js']),
                  ...ficherosDe('views', ['.ejs'])];

let infracciones = 0, deuda = 0;
const usados = new Set();

for (const f of ficheros) {
  if (PUERTA.includes(f) || BRAZOS.includes(f)) continue;
  const txt = fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\/\/[^\n]*/g, '');

  const apis = new Set();
  for (const s of SENALES) if (s.patron.test(txt)) apis.add(s.api);
  if (!apis.size) continue;

  const lista = [...apis].join(' y ');
  if (PERMITIDOS[f]) {
    usados.add(f);
    deuda++;
    console.log(`  · ${f} → ${lista}`);
    console.log(`      ${PERMITIDOS[f]}`);
    continue;
  }

  const esPantalla = PROHIBIDO_SIEMPRE.some(rx => rx.test(f));
  infracciones++;
  console.log(`  ${esPantalla ? 'X' : 'x'} ${f} llama a ${lista} por su cuenta` +
    (esPantalla ? ' — y es una RUTA O VISTA, que nunca debe' : ''));
  console.log(`      Los datos externos entran por services/ingesta.js. Lee de PostgreSQL.`);
}

// Un permiso que ya no hace falta se queda ahí engordando la lista y haciendo
// creer que la deuda es mayor de lo que es.
const sobran = Object.keys(PERMITIDOS).filter(f => !usados.has(f));
if (sobran.length) {
  console.log(`\n  Permisos que ya no hacen falta (bórralos de la lista):`);
  sobran.forEach(f => console.log(`      ${f}`));
}

const total = ficheros.length;
console.log(`\n${total} ficheros revisados`);
console.log(`${deuda} módulo(s) llaman todavía por su cuenta, con motivo apuntado`);
console.log(infracciones
  ? `${infracciones} INFRACCIÓN(ES): alguien saltándose la regla sin apuntarlo`
  : 'Nadie se salta la regla sin apuntarlo');

process.exitCode = infracciones ? 1 : 0;
