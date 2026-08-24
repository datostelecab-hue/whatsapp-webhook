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
process.exitCode = fallos ? 1 : 0;
