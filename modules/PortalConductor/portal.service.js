// ============================================================
// PORTAL DEL CONDUCTOR — la puerta
// ============================================================
// Camilo, 09/10/2026: los conductores entran a ver su información básica, con su
// TELÉFONO y su DNI/NIE como contraseña, por su propio dominio
// (services/dominios.js). Esta es la primera parte: entrar y salir.
//
// LO QUE DECIDE ESTE FICHERO:
//
//   · QUIÉN ENTRA. Quien tiene ese teléfono vigente en su ficha, contrato en
//     vigor (`empleo_vigente`) y ese DNI/NIE. El teléfono se compara por sus
//     nueve últimas cifras (con o sin +34, con espacios), y el documento sin
//     mirar mayúsculas, espacios, puntos ni guiones.
//   · QUE NO SE PUEDA PROBAR A LO LOCO. Ocho fallos seguidos frenan quince
//     minutos ese teléfono y esa IP (services/limiteIntentos). El mensaje de
//     error es el mismo falle lo que falle: no dice si el teléfono existe.
//   · LA SESIÓN, APARTE DE LA DE LA OFICINA. Otra cookie (`telecab_conductor`)
//     firmada con OTRA clave, sacada de SESSION_SECRET: una sesión de conductor
//     no vale en el ERP ni al revés, aunque algún día compartieran dominio.
//   · QUE SE CORTE SOLA. En cada petición se mira (con un minuto de caché) que
//     siga con contrato: a quien se da de baja se le acaba el acceso aunque su
//     cookie dure 30 días.

const crypto = require('crypto');
const repo = require('./portal.repo');
const limite = require('../../services/limiteIntentos');
const { nombreDePila } = require('../../services/nucleo');

const COOKIE = 'telecab_conductor';
const DURACION_MS = 12 * 60 * 60 * 1000;             // sin «recordarme»
const DURACION_LARGA_MS = 30 * 24 * 60 * 60 * 1000;  // «recordarme en este móvil»
const PROD = process.env.NODE_ENV === 'production';

// ── Las reglas, sueltas para las pruebas ────────────────────────────────────

/** Las nueve últimas cifras del teléfono escrito, o null si no hay nueve. */
function sufijoTelefono(t) {
  const d = String(t == null ? '' : t).replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

/** El documento como se compara: letras y números, en mayúsculas. */
const normalizarDocumento = d => String(d == null ? '' : d).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** ¿Es el mismo documento? En tiempo constante: no deja adivinarlo por lo que tarda. */
function mismoDocumento(escrito, guardado) {
  const a = normalizarDocumento(escrito), b = normalizarDocumento(guardado);
  if (!a || !b) return false;
  const h = s => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// ── La sesión del conductor ─────────────────────────────────────────────────
// La misma idea que la de la oficina (services/sesion.js): un token firmado
// con HMAC en una cookie, sin guardar nada en el servidor. La clave es OTRA,
// derivada del mismo secreto, y el token dice para qué es (`para`).
let _clave = null;
function clave() {
  if (_clave) return _clave;
  let base = process.env.SESSION_SECRET;
  if (!base) {
    base = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  [PORTAL] SESSION_SECRET no está definida: las sesiones de los conductores no sobrevivirán a un reinicio');
  }
  _clave = crypto.createHmac('sha256', base).update('portal-conductor').digest();
  return _clave;
}

function firmar(datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return cuerpo + '.' + crypto.createHmac('sha256', clave()).update(cuerpo).digest('base64url');
}

/** El token, si es bueno, para el portal y no ha caducado. Si no, null. */
function leerToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [cuerpo, firma] = token.split('.');
  const esperada = crypto.createHmac('sha256', clave()).update(cuerpo).digest('base64url');
  const a = Buffer.from(firma || ''), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString()); } catch (_) { return null; }
  if (!p || p.para !== 'conductor' || !p.cid || !p.exp || Date.now() > p.exp) return null;
  return p;
}

function leerCookie(req) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function ponerSesion(res, conductor, { recordar } = {}) {
  const dura = recordar ? DURACION_LARGA_MS : DURACION_MS;
  res.cookie(COOKIE, firmar({ para: 'conductor', cid: Number(conductor.id), iat: Date.now(), exp: Date.now() + dura }),
    { httpOnly: true, sameSite: 'lax', secure: PROD, path: '/', maxAge: dura });
}

function quitarSesion(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: PROD, path: '/' });
}

// ¿Sigue con contrato? Un minuto de caché: es lo que tarda como mucho en
// quedarse fuera quien se da de baja, y una visita normal hace una consulta.
const _activos = new Map();
async function sigueActivo(cid) {
  const c = _activos.get(cid);
  if (c && c.hasta > Date.now()) return c.datos;
  const d = await repo.datos(cid);
  const ok = !!(d && d.empleo_vigente && !d.es_centinela);
  if (!ok) { _activos.delete(cid); return null; }
  _activos.set(cid, { hasta: Date.now() + 60000, datos: d });
  if (_activos.size > 2000) for (const [k, v] of _activos) if (v.hasta <= Date.now()) _activos.delete(k);
  return d;
}

/**
 * Lee la sesión de la petición: el conductor (con sus datos), o null. Si la
 * cookie es buena pero ya no tiene contrato, se borra.
 */
async function sesionDe(req, res) {
  const t = leerToken(leerCookie(req));
  if (!t) return null;
  const d = await sigueActivo(t.cid);
  if (!d) { quitarSesion(res); return null; }
  return { ...d, pila: nombreDePila({ nombre: d.nombre_ficha, apellidos: d.apellidos, nombreBolt: d.nombre_bolt }) || d.nombre };
}

// ── Entrar ──────────────────────────────────────────────────────────────────

const ERROR = 'El teléfono o el DNI/NIE no son correctos.';

/**
 * EL LOGIN. Devuelve { ok: true, conductor } o { ok: false, error }. Nunca
 * dice si el fallo es el teléfono o el documento. Cada intento se apunta
 * (db/189); si apuntarlo falla, se entra igual.
 */
async function entrar({ telefono, documento, ip, agente }) {
  const suf = sufijoTelefono(telefono);
  const claves = ['portal-ip:' + (ip || '?'), 'portal-tel:' + (suf || String(telefono || '').slice(-12))];
  const apuntar = x => repo.apuntarAcceso({ ip, agente, ...x })
    .catch(e => console.error('⚠️  [PORTAL] no se pudo apuntar el acceso:', e.message));
  const falla = async (motivo, x = {}) => {
    claves.forEach(k => limite.registrarFallo(k));
    await apuntar({ ok: false, motivo, ...x });
    return { ok: false, error: ERROR };
  };

  const espera = Math.max(...claves.map(k => limite.segundosBloqueo(k)));
  if (espera > 0) {
    await apuntar({ ok: false, motivo: 'frenado', telFinal: suf ? suf.slice(-4) : null });
    return { ok: false, error: `Demasiados intentos. Espera ${Math.ceil(espera / 60)} min y vuelve a probar.` };
  }
  // Sin un teléfono de nueve cifras o sin documento, ni se busca.
  if (!suf || !normalizarDocumento(documento)) return falla('incompleto', { telFinal: suf ? suf.slice(-4) : null });

  const candidatos = await repo.porTelefono(suf);
  if (!candidatos.length) return falla('sin_telefono', { telFinal: suf.slice(-4) });
  const bueno = candidatos.find(c => mismoDocumento(documento, c.dni_nie));
  if (!bueno) {
    const sinDoc = candidatos.every(c => !normalizarDocumento(c.dni_nie));
    return falla(sinDoc ? 'sin_documento' : 'documento', { conductorId: candidatos[0].id });
  }
  if (!bueno.empleo_vigente || bueno.es_centinela) return falla('inactivo', { conductorId: bueno.id });

  claves.forEach(k => limite.limpiar(k));
  await apuntar({ ok: true, motivo: 'ok', conductorId: bueno.id });
  console.log(`🚗 [PORTAL] Entra el conductor ${bueno.id}`);
  return { ok: true, conductor: bueno };
}

module.exports = {
  COOKIE, entrar, sesionDe, ponerSesion, quitarSesion,
  // Sueltas para las pruebas.
  sufijoTelefono, normalizarDocumento, mismoDocumento, leerToken, firmar, ERROR,
};
