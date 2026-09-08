// ============================================================
// USUARIOS — cuentas de acceso, ya en PostgreSQL (adiós a la hoja USUARIOS)
// ============================================================
// No hay auto-registro: SOLO el superadmin crea usuarios. Al crear uno se genera
// una contraseña PROVISIONAL que se envía por correo; en su primer acceso la
// plataforma le obliga a poner la suya. Las contraseñas van HASHEADAS (scrypt,
// irreversible); la del BUZÓN de correo va CIFRADA (AES, reversible) porque hay
// que poder usarla contra el SMTP.
//
// La API es LA MISMA que tenía la versión de hoja (por email, con `debe_cambiar`
// como 'si'/'' y las fechas como texto dd/mm/aaaa hh:mm): login, configuración y
// correo no se enteran del cambio. Lo nuevo: cada usuario trae su `id` de la
// base (por fin las acciones se firman) y al crearlo se le siembran los permisos
// típicos de su rol (services/permisos.js), que luego se afinan en /usuarios.

const crypto = require('crypto');
const cripto = require('./cripto');   // cifrado reversible (AES) para la contraseña de correo
const db = require('./db');
const permisos = require('./permisos');

const TZ = 'Europe/Madrid';
const ESTADOS_U = { PROVISIONAL: 'provisional', ACTIVO: 'activo', BLOQUEADO: 'bloqueado' };

// ── LOS ROLES SALEN DE LA BASE ──────────────────────────────────────────────
// Antes eran una lista escrita a mano aquí (`['superadmin','desarrollador',
// 'oficina','trafico']`) y otra copia con sus nombres bonitos en cada vista.
// Añadir un rol obligaba a acordarse de los tres sitios, y el que se olvidara
// dejaba un rol que existe en la tabla pero que nadie puede elegir.
//
// Con caché corta porque esto se pregunta en cada carga de /usuarios y la
// tabla cambia una vez al año.
const TTL_ROLES = 60 * 1000;
let cacheRoles = null;

async function roles() {
  if (cacheRoles && Date.now() - cacheRoles.ts < TTL_ROLES) return cacheRoles.lista;
  const r = await db.consulta('SELECT codigo, etiqueta, acceso_total FROM rol ORDER BY id');
  const lista = r.rows.map(x => ({ codigo: x.codigo, etiqueta: x.etiqueta, accesoTotal: !!x.acceso_total }));
  cacheRoles = { lista, ts: Date.now() };
  return lista;
}

/** ¿Existe ese rol? Lo que sustituye a `ROLES.includes(...)`. */
async function esRol(codigo) {
  return (await roles()).some(r => r.codigo === codigo);
}

function fmt(ts) {
  if (!ts) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(ts));
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

// ── Hashing de contraseñas (scrypt nativo; el formato "saltHex:hashHex" es el
// de siempre, así que los hashes migrados de la hoja siguen valiendo) ─────────
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pwd), salt, 32);
  return salt.toString('hex') + ':' + dk.toString('hex');
}
function verificarHash(pwd, almacenado) {
  const [saltHex, hashHex] = String(almacenado || '').split(':');
  if (!saltHex || !hashHex) return false;
  let dk;
  try { dk = crypto.scryptSync(String(pwd), Buffer.from(saltHex, 'hex'), 32); }
  catch (_) { return false; }
  const guardado = Buffer.from(hashHex, 'hex');
  return guardado.length === dk.length && crypto.timingSafeEqual(guardado, dk);
}

// Contraseña provisional legible (sin caracteres ambiguos: 0/O, 1/I/L).
function generarPasswordProvisional() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(9);
  let s = '';
  for (let i = 0; i < 9; i++) s += abc[b[i] % abc.length];
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6, 9)}`;
}

const normalizarEmail = e => String(e || '').trim().toLowerCase();
const esEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarEmail(e));

// ── Lectura ─────────────────────────────────────────────────────────────────
const SELECT = `
  SELECT u.id, u.email, u.nombre, COALESCE(u.apellidos, '') AS apellidos,
         COALESCE(u.telefono, '') AS telefono, r.codigo AS rol, r.acceso_total,
         u.pass_hash AS hash, u.estado, u.debe_cambiar,
         COALESCE(u.token_reset, '') AS token_reset, u.token_expira,
         convert_from(COALESCE(u.pass_correo_cifrada, ''::bytea), 'UTF8') AS pass_correo,
         COALESCE(u.tema, '') AS tema,
         COALESCE(cp.email, '') AS creado_por,
         u.creado_at, u.ultimo_acceso
    FROM usuario u
    JOIN rol r ON r.id = u.rol_id
    LEFT JOIN usuario cp ON cp.id = u.creado_por`;

function aObjeto(x) {
  if (!x) return null;
  return {
    id: Number(x.id),
    email: x.email, nombre: x.nombre, apellidos: x.apellidos, telefono: x.telefono,
    rol: x.rol, accesoTotal: !!x.acceso_total,
    hash: x.hash, estado: x.estado,
    debe_cambiar: x.debe_cambiar ? 'si' : '',
    token_reset: x.token_reset || '',
    token_expira: x.token_expira ? String(new Date(x.token_expira).getTime()) : '',
    pass_correo: x.pass_correo || '', tema: x.tema || '',
    creado_por: x.creado_por || '',
    fecha_creacion: fmt(x.creado_at), ultimo_acceso: fmt(x.ultimo_acceso),
  };
}

async function leerUsuarios() {
  const r = await db.consulta(SELECT + ' ORDER BY u.creado_at');
  return { lista: r.rows.map(aObjeto), filas: r.rows.length };
}

async function buscarUsuario(email) {
  const e = normalizarEmail(email);
  if (!e) return null;
  const r = await db.consulta(SELECT + ' WHERE lower(u.email) = $1', [e]);
  return aObjeto(r.rows[0]);
}

async function rolId(codigo) {
  const r = await db.consulta('SELECT id FROM rol WHERE codigo = $1', [codigo]);
  if (!r.rows.length) throw new Error(`Rol no válido: "${codigo}"`);
  return r.rows[0].id;
}

/** Da de alta un usuario y devuelve { usuario, passwordProvisional } (para el correo). */
async function crearUsuario({ email, nombre, apellidos, telefono, rol, creado_por }) {
  const e = normalizarEmail(email);
  if (!esEmail(e)) throw new Error('Email no válido');
  if (!await esRol(rol)) throw new Error(`Rol no válido: "${rol}"`);
  if (!String(nombre || '').trim()) throw new Error('Falta el nombre');
  if (await buscarUsuario(e)) throw new Error('Ya existe un usuario con ese email');

  const provisional = generarPasswordProvisional();
  const creador = await buscarUsuario(creado_por);
  const r = await db.consulta(
    `INSERT INTO usuario (email, nombre, apellidos, telefono, rol_id, pass_hash, estado, debe_cambiar, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, 'provisional', TRUE, $7)
     RETURNING id`,
    [e, String(nombre).trim(), String(apellidos || '').trim() || null,
     String(telefono || '').trim() || null, await rolId(rol),
     hashPassword(provisional), creador ? creador.id : null]);
  // Los permisos típicos de su rol, para que entre viendo lo que le toca; luego
  // se afinan uno a uno desde /usuarios.
  await permisos.sembrar(r.rows[0].id, rol, { usuarioMod: creador ? creador.id : null });
  return { usuario: await buscarUsuario(e), passwordProvisional: provisional };
}

// Qué campos del objeto "estilo hoja" van a qué columnas.
const CAMPO_COL = {
  nombre: 'nombre', apellidos: 'apellidos', telefono: 'telefono',
  hash: 'pass_hash', estado: 'estado', tema: 'tema', token_reset: 'token_reset',
};

/** Aplica cambios a un usuario existente (por email) y devuelve el actualizado. */
async function actualizarUsuario(email, cambios = {}) {
  const e = normalizarEmail(email);
  const u = await buscarUsuario(e);
  if (!u) throw new Error('No existe ese usuario');

  const sets = [], vals = [];
  const pon = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  for (const [k, col] of Object.entries(CAMPO_COL)) {
    if (k in cambios) pon(col, cambios[k] === '' ? null : cambios[k]);
  }
  if ('rol' in cambios) pon('rol_id', await rolId(cambios.rol));
  if ('debe_cambiar' in cambios) pon('debe_cambiar', cambios.debe_cambiar === 'si' || cambios.debe_cambiar === true);
  if ('token_expira' in cambios) pon('token_expira', cambios.token_expira ? new Date(Number(cambios.token_expira)) : null);
  if ('pass_correo' in cambios) pon('pass_correo_cifrada', cambios.pass_correo ? Buffer.from(String(cambios.pass_correo), 'utf8') : null);
  if ('ultimo_acceso' in cambios) pon('ultimo_acceso', new Date());

  if (sets.length) {
    vals.push(u.id);
    await db.consulta(`UPDATE usuario SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  }
  return buscarUsuario(e);
}

/** Fija la contraseña definitiva del usuario (primer acceso o cambio). */
async function fijarPassword(email, nueva) {
  const pwd = String(nueva || '');
  if (pwd.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  return actualizarUsuario(email, {
    hash: hashPassword(pwd), estado: ESTADOS_U.ACTIVO,
    debe_cambiar: '', token_reset: '', token_expira: ''
  });
}

/** Genera y guarda un token de reseteo (olvidé mi contraseña). Devuelve el token. */
async function generarTokenReset(email, minutos = 60) {
  const token = crypto.randomBytes(24).toString('hex');
  await actualizarUsuario(email, { token_reset: token, token_expira: String(Date.now() + minutos * 60 * 1000) });
  return token;
}
function tokenResetValido(u, token) {
  if (!u || !u.token_reset || !token) return false;
  if (u.token_reset !== token) return false;
  return Date.now() < Number(u.token_expira || 0);
}

async function registrarAcceso(email) {
  try { await actualizarUsuario(email, { ultimo_acceso: true }); } catch (_) {}
}

// ── Contraseña de correo del usuario (CIFRADA, reversible) ──────────────────
async function guardarPassCorreo(email, passPlano) {
  const p = String(passPlano || '');
  if (!p) throw new Error('La contraseña de correo está vacía');
  if (!cripto.configurada()) throw new Error('Falta CRED_KEY en el servidor para cifrar la contraseña de correo');
  return actualizarUsuario(email, { pass_correo: cripto.cifrar(p) });
}
function descifrarPassCorreo(u) {
  return (u && u.pass_correo) ? cripto.descifrar(u.pass_correo) : null;
}
const tienePassCorreo = u => !!(u && u.pass_correo);

module.exports = {
  roles, esRol, ESTADOS_U,
  leerUsuarios, buscarUsuario, crearUsuario, actualizarUsuario,
  fijarPassword, generarTokenReset, tokenResetValido, registrarAcceso,
  guardarPassCorreo, descifrarPassCorreo, tienePassCorreo,
  hashPassword, verificarHash, generarPasswordProvisional,
  normalizarEmail, esEmail
};
