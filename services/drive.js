/**
 * Almacén de documentos de conductores en Google Drive.
 *
 * Las cuentas de servicio NO tienen cuota de almacenamiento, así que aquí se usa
 * OAuth con TU propia cuenta (datostelecab@gmail.com): los archivos los subes tú
 * y ocupan tus 15 GB. La cuenta de servicio se sigue usando solo para las hojas.
 *
 * Se autentica con un "refresh token" que se obtiene UNA vez desde la pantalla
 * /documentos/auth. Variables de entorno necesarias:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN   (lo genera la pantalla de conexión)
 *   GOOGLE_OAUTH_REDIRECT        (opcional; si no, se deduce de la petición)
 *
 * Scope drive.file: la app solo ve y gestiona los archivos que ella misma crea.
 * Es el permiso mínimo y no requiere verificación de Google.
 *
 * Estructura:  DocumentosConductores/<clave del conductor>/<archivos>
 * La "clave" es un identificador estable (ID de Bolt, DNI o nombre) para que sus
 * documentos queden siempre en la misma subcarpeta aunque cambie de fila.
 */

const { google } = require('googleapis');
const { Readable } = require('stream');

const CARPETA_MIME = 'application/vnd.google-apps.folder';
const RAIZ_NOMBRE = 'DocumentosConductores';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let driveClient = null;
let rootCache = null;                 // id de la carpeta raíz
const cacheCarpetas = new Map();      // clave → id subcarpeta

/** Cliente OAuth2 (sin token todavía); sirve para el flujo de consentimiento. */
function oauthClient(redirect) {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('Faltan GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    redirect || GOOGLE_OAUTH_REDIRECT
  );
}

/** URL de consentimiento para conectar tu cuenta de Drive. */
function authUrl(redirect) {
  return oauthClient(redirect).generateAuthUrl({
    access_type: 'offline',       // para recibir refresh_token
    prompt: 'consent',            // fuerza que devuelva refresh_token
    scope: SCOPES
  });
}

/** Cambia el "code" del callback por los tokens (incluye refresh_token). */
async function exchangeCode(code, redirect) {
  const { tokens } = await oauthClient(redirect).getToken(code);
  return tokens;
}

function getDrive() {
  if (driveClient) return driveClient;
  const { GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error(
      'Drive no está conectado todavía. Abre /documentos/auth para conectar tu ' +
      'cuenta y define GOOGLE_OAUTH_REFRESH_TOKEN.'
    );
  }
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

const escQ = s => String(s).replace(/'/g, "\\'");

/** Devuelve el id de la carpeta raíz en tu Drive, creándola si no existe. */
async function carpetaRaiz() {
  if (rootCache) return rootCache;
  const drive = getDrive();

  // Si prefieres una carpeta concreta, ponla en DRIVE_DOCS_FOLDER_ID.
  if (process.env.DRIVE_DOCS_FOLDER_ID) {
    rootCache = process.env.DRIVE_DOCS_FOLDER_ID;
    return rootCache;
  }

  const q = `name='${RAIZ_NOMBRE}' and mimeType='${CARPETA_MIME}' ` +
            `and 'root' in parents and trashed=false`;
  const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  if (data.files && data.files.length) {
    rootCache = data.files[0].id;
  } else {
    const creada = await drive.files.create({
      requestBody: { name: RAIZ_NOMBRE, mimeType: CARPETA_MIME, parents: ['root'] },
      fields: 'id'
    });
    rootCache = creada.data.id;
  }
  return rootCache;
}

/** Normaliza la clave del conductor para usarla como nombre de subcarpeta. */
function normClave(clave) {
  return String(clave == null ? '' : clave).trim().replace(/[\\/]/g, '-') || 'sin-clave';
}

/** id de la subcarpeta del conductor (la crea si hace falta). */
async function carpetaConductor(clave) {
  const nombre = normClave(clave);
  if (cacheCarpetas.has(nombre)) return cacheCarpetas.get(nombre);

  const drive = getDrive();
  const raiz = await carpetaRaiz();
  const q = `name='${escQ(nombre)}' and '${raiz}' in parents ` +
            `and mimeType='${CARPETA_MIME}' and trashed=false`;
  const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });

  let id;
  if (data.files && data.files.length) {
    id = data.files[0].id;
  } else {
    const creada = await drive.files.create({
      requestBody: { name: nombre, mimeType: CARPETA_MIME, parents: [raiz] },
      fields: 'id'
    });
    id = creada.data.id;
  }
  cacheCarpetas.set(nombre, id);
  return id;
}

/** Sube un documento (base64 tal cual lo manda el navegador). */
async function subir(clave, { nombre, mime, base64 }) {
  if (!nombre) throw new Error('Falta el nombre del archivo');
  if (!base64) throw new Error('El archivo llegó vacío');
  const drive = getDrive();
  const carpeta = await carpetaConductor(clave);

  const stream = Readable.from(Buffer.from(base64, 'base64'));
  const { data } = await drive.files.create({
    requestBody: { name: nombre, parents: [carpeta] },
    media: { mimeType: mime || 'application/octet-stream', body: stream },
    fields: 'id,name,mimeType,size,createdTime,webViewLink,iconLink'
  });
  return data;
}

/** Lista los documentos de un conductor (vacío si aún no tiene carpeta). */
async function listar(clave) {
  const drive = getDrive();
  const nombre = normClave(clave);
  const raiz = await carpetaRaiz();

  let carpeta = cacheCarpetas.get(nombre);
  if (!carpeta) {
    const q = `name='${escQ(nombre)}' and '${raiz}' in parents ` +
              `and mimeType='${CARPETA_MIME}' and trashed=false`;
    const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    if (!data.files || !data.files.length) return [];
    carpeta = data.files[0].id;
    cacheCarpetas.set(nombre, carpeta);
  }

  const { data } = await drive.files.list({
    q: `'${carpeta}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink,iconLink)',
    orderBy: 'createdTime desc', pageSize: 100
  });
  return data.files || [];
}

/** Borra un documento (solo si cuelga de la carpeta raíz, como salvaguarda). */
async function borrar(fileId) {
  if (!fileId) throw new Error('Falta el ID del archivo');
  const drive = getDrive();
  const raiz = await carpetaRaiz();

  const { data } = await drive.files.get({ fileId, fields: 'id,parents' });
  const padre = (data.parents || [])[0];
  if (padre) {
    const sub = await drive.files.get({ fileId: padre, fields: 'parents' });
    if (!(sub.data.parents || []).includes(raiz)) {
      throw new Error('El archivo no pertenece a la carpeta de documentación');
    }
  }
  await drive.files.delete({ fileId });
  return { borrado: fileId };
}

/** ¿Está la cuenta conectada (hay refresh token)? */
function configurado() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

/** ¿Están al menos las credenciales de cliente, para poder conectar? */
function puedeConectar() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

module.exports = {
  subir, listar, borrar, carpetaConductor, configurado, puedeConectar,
  normClave, authUrl, exchangeCode
};
