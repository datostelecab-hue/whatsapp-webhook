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
  'modules/Conductores/cazamiento.repo.js',   // era services/cazamientoBolt.js
  'services/conductoresBolt.js',
  'modules/Vehiculos/vehiculos.service.js',
  'modules/Operaciones/operaciones.service.js',
  'services/mapon.js',
  'services/bolt.js',
  'services/repo/vehiculosBolt.js',
];

// Lo que TODAVÍA llama por su cuenta. Cada línea es una deuda con su motivo.
// Esta lista solo puede encoger.
const PERMITIDOS = {
  'modules/Operaciones/auditoria.service.js':
                                 'Auditoría de KM: ya ES una tarea de ingesta (auditoria_flota), pero la traza GPS ' +
                                 'punto a punto la pide ella y se la come al vuelo: guardarla serían 200.000 puntos ' +
                                 'al día para contestar a lo mismo',
  'modules/Operaciones/mapon.diagnostico.js':
                                 'La herramienta de Mapon: existe justo para preguntarle a la API en crudo. ' +
                                 'No tiene pantalla y no la llama nadie: se pide por URL cuando hace falta',
  // (La tubería de horas sobre hojas —boltHorasCore, boltResumen, boltHistorico—
  //  se borró el 15/09/2026. Ya no hay excepción que apuntar.)
  'services/conductores.js':     'Módulo viejo sobre hojas: muere cuando la agenda pase a PostgreSQL',
  'services/fichaje.js':         'Fichaje: ESCRIBE en Mapon (enlaza conductor y coche), no lee',
  // Nacio en `main`, donde esta regla no existia, y con su PROPIA base de datos
  // (`fv_*`). Entra por la puerta grande el dia que su padron se funda con el
  // nucleo; hasta entonces la excepcion queda apuntada, no escondida.
  'services/flotaViva/fuentes.js': 'Flota viva: modulo aparte con su propia base. Se unifica tras la migracion',
  'services/flotaViva/backfill.js': 'Relleno del núcleo hacia atrás: se lanza a mano y reconstruye meses de ' +
                                 'state-logs coche a coche, justo lo contrario de un latido cada 5 minutos',
};

// Donde NUNCA puede haber una llamada: si una pantalla depende de una API,
// tarda lo que tarde esa API y se cae cuando ella se cae.
const PROHIBIDO_SIEMPRE = [/^routes\//, /^views\//, /\.controller\.js$/, /^modules\/[^/]+\/vistas\//];

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

// `modules/` ENTRA, y faltaba. Mientras no estuvo, cada módulo mudado salía del
// alcance de esta regla sin que nadie lo decidiera: un fichero que llamaba a
// BOLT por su cuenta dejaba de estar vigilado el día que cambiaba de carpeta.
const ficheros = [...ficherosDe('services', ['.js']), ...ficherosDe('routes', ['.js']),
                  ...ficherosDe('modules', ['.js', '.ejs']),
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
