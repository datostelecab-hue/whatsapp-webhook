// ============================================================
// CRIPTO — cifrado REVERSIBLE (AES-256-GCM) para secretos que hay que reusar
// ============================================================
// Se usa para la contraseña del correo saliente: a diferencia de las contraseñas
// de los usuarios (que van HASHEADAS, irreversibles), esta hay que descifrarla para
// autenticarse en el servidor SMTP. La clave vive en CRED_KEY (variable de entorno,
// nunca en la hoja ni en el código). Si CRED_KEY cambia, lo cifrado deja de leerse.

const crypto = require('crypto');

function clave() {
  const raw = process.env.CRED_KEY || '';
  if (!raw) return null;
  // Se deriva a 32 bytes con SHA-256, así CRED_KEY puede ser cualquier cadena.
  return crypto.createHash('sha256').update(raw).digest();
}

function cifrar(texto) {
  const key = clave();
  if (!key) throw new Error('CRED_KEY no configurada: no se puede cifrar el secreto');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function descifrar(blob) {
  const key = clave();
  if (!key) return null;
  const p = String(blob || '').split(':');
  if (p[0] !== 'v1' || p.length !== 4) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p[1], 'base64'));
    d.setAuthTag(Buffer.from(p[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(p[3], 'base64')), d.final()]).toString('utf8');
  } catch (_) { return null; }
}

const configurada = () => !!clave();

module.exports = { cifrar, descifrar, configurada };
