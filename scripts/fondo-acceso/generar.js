// ============================================================
// LOS FONDOS DEL ACCESO — una escena por sede, hechas con SVG
// ============================================================
// La pantalla de acceso (views/layout-auth.ejs) va sobre una imagen a toda la
// pantalla, y cambia con la sede que se elige: Madrid (las Cuatro Torres y la
// autovía) o Barcelona (la Sagrada Família, la Torre Glòries y el mar). Las
// dos son el mismo atardecer (comun.js) y salen de código con semilla fija:
// siempre la misma imagen. Para rehacerlas:
//
//   node scripts/fondo-acceso/generar.js [madrid|barcelona]     → los SVG, en la carpeta temporal
//   node scripts/fondo-acceso/rasterizar.js [madrid|barcelona]  → public/assets/acceso/<sede>[-1280].webp
//
// Sin sede, las dos. Ver docs/como-se-trabaja/Identidad visual.md («La pantalla
// de acceso»).

const fs = require('fs');
const os = require('os');
const path = require('path');

const ESCENAS = { madrid: require('./madrid'), barcelona: require('./barcelona') };
const salida = sede => path.join(os.tmpdir(), `telecab-fondo-${sede}.svg`);

if (require.main === module) {
  const pedidas = process.argv[2] ? [process.argv[2]] : Object.keys(ESCENAS);
  pedidas.forEach(sede => {
    if (!ESCENAS[sede]) throw new Error(`No hay escena para «${sede}»: ${Object.keys(ESCENAS).join(', ')}`);
    const svg = ESCENAS[sede]();
    fs.writeFileSync(salida(sede), svg);
    console.log(salida(sede), Math.round(svg.length / 1024), 'KB');
  });
}

module.exports = { ESCENAS, salida };
