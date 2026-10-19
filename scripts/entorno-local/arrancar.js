// ============================================================
// ENTORNO LOCAL · ARRANCAR — el ERP de este PC, contra la copia local
// ============================================================
//   node scripts/entorno-local/arrancar.js
//
// Arranca el ERP de siempre (app.js) con tres cosas fijadas aquí y que no se
// pueden cambiar desde fuera:
//
//   · LA BASE ES LA LOCAL (127.0.0.1:5433), y tiene que llevar la marca que le
//     pone refrescar.js. Si no la lleva, no arranca: así no hay forma de que
//     este servidor escriba en producción por una variable mal puesta.
//   · MODO_PRUEBAS=1: los crons no arrancan, y el cortafuegos frena todo envío
//     de WhatsApp, toda escritura en Mapon y en las hojas.
//   · EL CORREO VA AL BUZÓN FALSO (Mailpit, http://localhost:8025): ningún
//     correo sale del PC.
//
// Direcciones (los *.localhost los resuelve el navegador solo, sin tocar nada):
//   ERP                   http://erptelecab.localhost:3100
//   Portal de conductores http://conductorestelecab.localhost:3100
//   Buzón de pruebas      http://localhost:8025

const path = require('path');
const { spawnSync } = require('child_process');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';
const PUERTO = 3100;

if (process.env.NODE_ENV === 'production') {
  console.error('NODE_ENV=production: este arranque es solo para el entorno local.');
  process.exit(1);
}

// Que los contenedores estén arriba (no hace nada si ya lo están).
const up = spawnSync('docker', ['compose', '-f', path.join(__dirname, 'docker-compose.yml'), 'up', '-d', '--wait'], { encoding: 'utf8' });
if (up.status !== 0) {
  console.error('No puedo levantar los contenedores (¿está Docker Desktop abierto?):\n' + (up.stderr || up.error || '').toString().trim());
  process.exit(1);
}

// EL CORREO: al buzón falso, o desviado SIEMPRE a datostelecab@gmail.com
// (Camilo, 19/10/2026) si en correo.env hay un SMTP de verdad. Ese fichero no se
// sube a GitHub (lleva una contraseña) y solo puede poner estas claves: nada de
// la base ni del modo pruebas.
// CRED_KEY va aquí para descifrar la contraseña de correo que SMTP_USER tiene en
// su ficha (Mi perfil), en vez de escribirla en claro en SMTP_PASS.
const CLAVES_CORREO = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'CORREO_PRUEBAS_A', 'CRED_KEY'];
const correoEnv = {};
try {
  require('fs').readFileSync(path.join(__dirname, 'correo.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && CLAVES_CORREO.includes(m[1]) && m[2] !== '') correoEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  });
} catch (_) { /* sin correo.env: al buzón falso */ }
const desvio = correoEnv.SMTP_HOST && correoEnv.SMTP_USER && (correoEnv.SMTP_PASS || correoEnv.CRED_KEY);
// Las de SMTP de fuera no valen aquí: o las de correo.env, o ninguna.
CLAVES_CORREO.forEach(k => { delete process.env[k]; });
Object.assign(process.env, correoEnv);
if (desvio && !process.env.CORREO_PRUEBAS_A) process.env.CORREO_PRUEBAS_A = 'datostelecab@gmail.com';

Object.assign(process.env, {
  DATABASE_URL: LOCAL,
  MODO_PRUEBAS: '1',
  CORREO_PRUEBAS: '127.0.0.1:1025',
  PORT: String(PUERTO),
  // Fijo para que las sesiones sobrevivan a reiniciar el servidor local. No es
  // un secreto: solo firma cookies de este PC.
  SESSION_SECRET: 'entorno-local-de-pruebas-no-es-un-secreto',
  ENTORNO_LOCAL: '1',
});

(async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: LOCAL });
  try {
    await c.connect();
    const r = await c.query(`SELECT to_char(max(copiado_at) AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS el
                               FROM entorno_local`);
    console.log(`🧪 [ENTORNO LOCAL] Base local, copia de producción del ${r.rows[0].el}`);
  } catch (e) {
    console.error(`La base local no está lista (${e.message}).\nHaz primero la copia: node scripts/entorno-local/refrescar.js`);
    process.exit(1);
  } finally {
    await c.end().catch(() => {});
  }
  console.log(`🧪 [ENTORNO LOCAL] ERP      http://erptelecab.localhost:${PUERTO}`);
  console.log(`🧪 [ENTORNO LOCAL] Portal   http://conductorestelecab.localhost:${PUERTO}`);
  console.log(desvio
    ? `🧪 [ENTORNO LOCAL] Correos  TODOS desviados a ${process.env.CORREO_PRUEBAS_A} (por ${process.env.SMTP_HOST})`
    : '🧪 [ENTORNO LOCAL] Correos  http://localhost:8025 (sin correo.env: no sale ninguno del PC)');
  process.chdir(path.join(__dirname, '..', '..'));
  require(path.join(__dirname, '..', '..', 'app.js'));
})();
