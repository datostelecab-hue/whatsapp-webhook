// ============================================================
// ENTORNO LOCAL · UN USUARIO DE PRUEBA PARA ENTRAR AL ERP
// ============================================================
//   node scripts/entorno-local/usuario-de-prueba.js
//
// Crea (o deja al día) en la COPIA LOCAL un usuario de desarrollo para entrar a
// http://erptelecab.localhost:3100 y probar pantallas sin usar la cuenta de
// nadie de verdad. La contraseña se genera al azar cada vez y se guarda en
// scripts/entorno-local/usuario.env, que git ignora (como correo.env). No se
// escribe por pantalla.
//
// Solo funciona contra la base local (lleva la marca de refrescar.js); la
// próxima copia de producción lo borra, y basta con volver a lanzarlo.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';
const EMAIL = 'pruebas@telecab.localhost';
const FICHERO = path.join(__dirname, 'usuario.env');

// El mismo formato que modules/Usuarios/usuarios.service.js (scrypt, "salt:hash").
function hash(pwd) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pwd, salt, 32).toString('hex');
}

(async () => {
  const c = new Client({ connectionString: LOCAL });
  await c.connect();
  try {
    await c.query('SELECT 1 FROM entorno_local LIMIT 1');
  } catch (_) {
    console.error('Esta base no lleva la marca de copia local: no toco nada.');
    process.exit(1);
  }
  const clave = crypto.randomBytes(12).toString('base64url');
  const rol = (await c.query(`SELECT id FROM rol WHERE codigo = 'desarrollador'`)).rows[0];
  if (!rol) throw new Error('No hay rol desarrollador en esta base');
  await c.query(
    `INSERT INTO usuario (email, nombre, apellidos, rol_id, pass_hash, estado, debe_cambiar)
     VALUES ($1, 'Pruebas', 'Entorno local', $2, $3, 'activo', FALSE)
     ON CONFLICT ((lower(email::text))) DO UPDATE
        SET rol_id = EXCLUDED.rol_id, pass_hash = EXCLUDED.pass_hash,
            estado = 'activo', debe_cambiar = FALSE`, [EMAIL, rol.id, hash(clave)]);
  fs.writeFileSync(FICHERO, `# Usuario de pruebas del ERP local (no es de nadie). Lo rehace usuario-de-prueba.js.\nEMAIL=${EMAIL}\nCLAVE=${clave}\n`);
  console.log(`Usuario ${EMAIL} listo (desarrollador). La contraseña está en ${path.relative(process.cwd(), FICHERO)}.`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
