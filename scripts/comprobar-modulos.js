// ============================================================
// LOS MÓDULOS CARGAN
// ============================================================
//   node scripts/comprobar-modulos.js
//
// `node --check` solo mira la sintaxis. Un `module.exports = { hacerAlgo }` con
// `hacerAlgo` ya no declarado compila perfectamente y revienta al CARGAR — o
// sea, al arrancar el servidor, o al entrar en la pantalla que lo use.
//
// Pasa al reorganizar: se sustituye un bloque, se lleva por delante una función
// de al lado, y la exportación se queda apuntando al vacío. Aquí se cargan de
// verdad, que es lo único que lo detecta.
//
// Solo `services/repo/`: son los que más se mueven y los únicos que se pueden
// cargar sin efectos. Requerir `services/` entero levantaría clientes de Google
// y crones, que es justo lo que no debe hacer una comprobación.
//
// Cargar `repo/` es seguro porque `services/db.js` crea el pool PEREZOSO: no
// conecta hasta la primera consulta.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'services', 'repo');
const ficheros = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();

let fallos = 0;
const exportado = [];

for (const f of ficheros) {
  try {
    const m = require(path.join(DIR, f));
    const nombres = Object.keys(m || {});
    // Un módulo que no exporta nada casi siempre es un olvido, no una decisión.
    if (!nombres.length) {
      fallos++;
      console.log(`  x repo/${f}: no exporta nada`);
      continue;
    }
    // Y una exportación que es `undefined` es el caso que se busca: el nombre
    // está en la lista pero la función ya no existe.
    const vacias = nombres.filter(k => m[k] === undefined);
    if (vacias.length) {
      fallos++;
      console.log(`  x repo/${f}: exporta ${vacias.map(v => '"' + v + '"').join(', ')} como undefined`);
    }
    exportado.push(`  ok repo/${f}: ${nombres.length} exportación(es)`);
  } catch (e) {
    fallos++;
    console.log(`  x repo/${f}: no carga — ${String(e.message).split('\n')[0]}`);
  }
}

if (!fallos) exportado.forEach(l => console.log(l));
console.log(`\n${ficheros.length} módulo(s) de repositorio`);
console.log(fallos ? `${fallos} NO cargan bien` : 'Todos cargan y exportan lo que dicen');

// ============================================================
// LO QUE UNA RUTA LLAMA, EL SERVICIO LO EXPORTA
// ============================================================
// El otro medio fallo de lo mismo: `const exp = require('../services/explorador')`
// y luego `exp.escribir(...)` cuando el servicio nunca exportó `escribir`.
// Compila, arranca, y revienta el día que alguien pulsa ese botón.
//
// Solo se mira el patrón claro —un require con nombre y llamadas `nombre.metodo(`—
// y solo en servicios cuyo `module.exports = { … }` se puede leer entero. Lo que
// no se entiende con seguridad no se marca: un comprobador que grita en falso
// enseña a ignorarlo.

const SERV = path.join(__dirname, '..', 'services');

/** Los nombres que exporta un servicio, o null si no se puede saber. */
function exporta(rel) {
  const ruta = path.join(SERV, rel + '.js');
  if (!fs.existsSync(ruta)) return null;
  const txt = fs.readFileSync(ruta, 'utf8');
  const m = txt.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!m) return null;                       // exporta otra cosa (un router, una clase)
  if (/\.\.\./.test(m[1])) return null;      // hay un spread: no se ve todo
  const nombres = new Set();
  for (const trozo of m[1].split(',')) {
    const t = trozo.replace(/\/\/[^\n]*/g, '').trim();
    const n = t.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (n) nombres.add(n[1]);
  }
  return nombres.size ? nombres : null;
}

let malLlamados = 0, llamadas = 0;
for (const dir of ['routes', 'services']) {
  const carpeta = path.join(__dirname, '..', dir);
  for (const f of fs.readdirSync(carpeta).filter(x => x.endsWith('.js'))) {
    const txt = fs.readFileSync(path.join(carpeta, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    // const alias = require('../services/loQueSea')
    for (const r of txt.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"][^'"]*services\/([\w/]+)['"]\)/g)) {
      const [, alias, rel] = r;
      const nombres = exporta(rel);
      if (!nombres) continue;
      for (const c of txt.matchAll(new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g'))) {
        llamadas++;
        if (nombres.has(c[1])) continue;
        malLlamados++;
        console.log(`  x ${dir}/${f}: llama a ${alias}.${c[1]}() y services/${rel} no lo exporta`);
      }
    }
  }
}

console.log(`\n${llamadas} llamada(s) entre módulos comprobadas`);
console.log(malLlamados ? `${malLlamados} apuntan a algo que no existe` : 'Todas apuntan a algo que existe');

process.exitCode = (fallos || malLlamados) ? 1 : 0;
