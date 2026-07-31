// ============================================================
// USUARIOS — cuentas de acceso a la plataforma (login por contraseña)
// ============================================================
// No hay auto-registro: SOLO el superadmin crea usuarios y asigna roles (y puede
// crear otros superadmin). Al crear uno se genera una contraseña PROVISIONAL que
// se le envía por correo; en su primer acceso la plataforma le obliga a poner la
// suya propia. Las contraseñas se guardan HASHEADAS (scrypt, irreversible): ni
// nosotros podemos leerlas.
//
// Roles:
//   · superadmin → todo el sistema + gestión de usuarios (es todos los roles).
//   · oficina    → Contratación + RRHH + Administración (reclutamiento y personal).
//   · trafico    → Tráfico + Flota + Operaciones.

const crypto = require('crypto');
const { readSheet, writeSheetRaw, ensureSheet } = require('./sheets');

const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'USUARIOS';
const TZ = 'Europe/Madrid';

const ROLES = ['superadmin', 'oficina', 'trafico'];
const ESTADOS_U = { PROVISIONAL: 'provisional', ACTIVO: 'activo', BLOQUEADO: 'bloqueado' };

const COL = {
  email: 0,          // clave (en minúsculas) — identidad del usuario
  nombre: 1,
  rol: 2,            // superadmin | oficina | trafico
  hash: 3,           // scrypt: "saltHex:hashHex" (nunca la contraseña en claro)
  estado: 4,         // provisional | activo | bloqueado
  debe_cambiar: 5,   // 'si' mientras use la provisional (fuerza cambio en el 1er acceso)
  token_reset: 6,    // token de "olvidé mi contraseña" (hex)
  token_expira: 7,   // epoch ms hasta cuando vale el token
  creado_por: 8,     // email del superadmin que lo dio de alta
  fecha_creacion: 9,
  ultimo_acceso: 10
};
const N_COLS = 11;
const CABECERA = ['email', 'nombre', 'rol', 'hash', 'estado', 'debe_cambiar',
  'token_reset', 'token_expira', 'creado_por', 'fecha_creacion', 'ultimo_acceso'];

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

// ── Hashing de contraseñas (scrypt nativo, sin dependencias que compilen) ────
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

// ── Lectura / escritura de la hoja ──────────────────────────────────────────
function filaAObjeto(row) {
  const o = {};
  for (const [k, i] of Object.entries(COL)) o[k] = (row[i] == null ? '' : row[i]).toString();
  return o;
}
function objetoAFila(o) {
  const f = new Array(N_COLS).fill('');
  for (const [k, i] of Object.entries(COL)) f[i] = o[k] == null ? '' : o[k];
  return f;
}

async function leerUsuarios() {
  await ensureSheet(ID_PLANIFICADOR, HOJA);
  const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:K`);
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const email = normalizarEmail(filas[i][COL.email]);
    if (!email) continue;
    lista.push(filaAObjeto(filas[i]));
  }
  return { lista, filas: filas.length };
}

async function guardarTodos(lista, filasViejas) {
  const grid = [CABECERA, ...lista.map(objetoAFila)];
  while (grid.length < filasViejas) grid.push(new Array(N_COLS).fill(''));
  await writeSheetRaw(ID_PLANIFICADOR, `${HOJA}!A1`, grid);
}

async function buscarUsuario(email) {
  const e = normalizarEmail(email);
  const { lista } = await leerUsuarios();
  return lista.find(u => normalizarEmail(u.email) === e) || null;
}

/** Da de alta un usuario y devuelve { usuario, passwordProvisional } (para el correo). */
async function crearUsuario({ email, nombre, rol, creado_por }) {
  const e = normalizarEmail(email);
  if (!esEmail(e)) throw new Error('Email no válido');
  if (!ROLES.includes(rol)) throw new Error('Rol no válido');
  if (!String(nombre || '').trim()) throw new Error('Falta el nombre');

  const { lista, filas } = await leerUsuarios();
  if (lista.some(u => normalizarEmail(u.email) === e)) throw new Error('Ya existe un usuario con ese email');

  const provisional = generarPasswordProvisional();
  const usuario = {
    email: e, nombre: String(nombre).trim(), rol,
    hash: hashPassword(provisional),
    estado: ESTADOS_U.PROVISIONAL, debe_cambiar: 'si',
    token_reset: '', token_expira: '',
    creado_por: normalizarEmail(creado_por) || 'sistema',
    fecha_creacion: ahora(), ultimo_acceso: ''
  };
  lista.push(usuario);
  await guardarTodos(lista, filas);
  return { usuario, passwordProvisional: provisional };
}

/** Aplica cambios a un usuario existente (por email) y guarda. */
async function actualizarUsuario(email, cambios = {}) {
  const e = normalizarEmail(email);
  const { lista, filas } = await leerUsuarios();
  const u = lista.find(x => normalizarEmail(x.email) === e);
  if (!u) throw new Error('No existe ese usuario');
  Object.assign(u, cambios);
  await guardarTodos(lista, filas);
  return u;
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
  const expira = String(Date.now() + minutos * 60 * 1000);
  await actualizarUsuario(email, { token_reset: token, token_expira: expira });
  return token;
}
function tokenResetValido(u, token) {
  if (!u || !u.token_reset || !token) return false;
  if (u.token_reset !== token) return false;
  return Date.now() < Number(u.token_expira || 0);
}

async function registrarAcceso(email) {
  try { await actualizarUsuario(email, { ultimo_acceso: ahora() }); } catch (_) {}
}

module.exports = {
  ROLES, ESTADOS_U, COL,
  leerUsuarios, buscarUsuario, crearUsuario, actualizarUsuario,
  fijarPassword, generarTokenReset, tokenResetValido, registrarAcceso,
  hashPassword, verificarHash, generarPasswordProvisional,
  normalizarEmail, esEmail
};
