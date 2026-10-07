// El SVG de cada sede (generar.js) → sus dos WebP del acceso: 2560 × 1440 para
// el escritorio y 1280 × 720 para el móvil. Lo pinta Edge sin ventana (en la
// gráfica dedicada si la hay) y lo comprime Pillow. Hace falta Edge y Python
// con Pillow: es una herramienta de este ordenador, no del servidor.
//
//   node scripts/fondo-acceso/rasterizar.js [madrid|barcelona]
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { ESCENAS, salida } = require('./generar');

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DESTINO = path.join(__dirname, '..', '..', 'public', 'assets', 'acceso');

const pedidas = process.argv[2] ? [process.argv[2]] : Object.keys(ESCENAS);
pedidas.forEach(sede => {
  const png = path.join(os.tmpdir(), `telecab-fondo-${sede}.png`);
  execFileSync(EDGE, [
    '--headless=new', '--force_high_performance_gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=2560,1440', '--screenshot=' + png, pathToFileURL(salida(sede)).href,
  ], { stdio: 'ignore', timeout: 90000 });
  const grande = path.join(DESTINO, `${sede}.webp`), movil = path.join(DESTINO, `${sede}-1280.webp`);
  const py = [
    'from PIL import Image',
    'import os',
    `im = Image.open(r'${png}').convert('RGB')`,
    `im.save(r'${grande}', 'WEBP', quality=84, method=6)`,
    `im.resize((1280, 720), Image.LANCZOS).save(r'${movil}', 'WEBP', quality=84, method=6)`,
    `print('${sede}:', os.path.getsize(r'${grande}') // 1024, 'KB y', os.path.getsize(r'${movil}') // 1024, 'KB')`,
  ].join('\n');
  console.log(execFileSync('python', ['-c', py]).toString().trim());
});
