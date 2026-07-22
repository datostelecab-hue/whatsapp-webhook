/**
 * Almacén de documentos de conductores en Google Drive, con la misma cuenta de
 * servicio que ya usa el proyecto.
 *
 * La cuenta de servicio NO tiene cuota de almacenamiento propia, así que los
 * archivos viven en una carpeta de TU Drive compartida con ella. Esa carpeta se
 * indica en la variable de entorno DRIVE_DOCS_FOLDER_ID.
 *
 * Estructura:  [carpeta raíz]/<clave del conductor>/<archivos>
 * La "clave" es un identificador estable del conductor (ID de Bolt, DNI o su
 * nombre normalizado) para que sus documentos queden siempre en la misma
 * subcarpeta aunque cambie de fila.
 */

const { google } = require('googleapis');

const CARPETA_MIME = 'application/vnd.google-apps.folder';
let driveClient = null;
// Cache clave→idSubcarpeta para no re-buscar en cada operación.
const cacheCarpetas = new Map();

function getDrive() {
  if (driveClient) return driveClient;
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function carpetaRaiz() {
  const id = process.env.DRIVE_DOCS_FOLDER_ID;
  if (!id) {
    throw new Error(
      'Falta configurar DRIVE_DOCS_FOLDER_ID: crea una carpeta en tu Drive, ' +
      'compártela con el correo de la cuenta de servicio y pon aquí su ID.'
    );
  }
  return id;
}

/** Normaliza la clave del conductor para usarla como nombre de subcarpeta. */
function normClave(clave) {
  return String(clave == null ? '' : clave).trim().replace(/[\\/]/g, '-') || 'sin-clave';
}

/** Escapa comillas simples para las consultas q de la API de Drive. */
const escQ = s => String(s).replace(/'/g, "\\'");

/** Devuelve el ID de la subcarpeta del conductor, creándola si no existe. */
async function carpetaConductor(clave) {
  const nombre = normClave(clave);
  if (cacheCarpetas.has(nombre)) return cacheCarpetas.get(nombre);

  const drive = getDrive();
  const raiz = carpetaRaiz();
  const q = `name='${escQ(nombre)}' and '${raiz}' in parents ` +
            `and mimeType='${CARPETA_MIME}' and trashed=false`;
  const { data } = await drive.files.list({
    q, fields: 'files(id,name)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true
  });

  let id;
  if (data.files && data.files.length) {
    id = data.files[0].id;
  } else {
    const creada = await drive.files.create({
      requestBody: { name: nombre, mimeType: CARPETA_MIME, parents: [raiz] },
      fields: 'id', supportsAllDrives: true
    });
    id = creada.data.id;
  }
  cacheCarpetas.set(nombre, id);
  return id;
}

/**
 * Sube un documento. `contenido` es el archivo en base64 (tal cual lo manda el
 * navegador con FileReader). Devuelve los metadatos del archivo creado.
 */
async function subir(clave, { nombre, mime, base64 }) {
  if (!nombre) throw new Error('Falta el nombre del archivo');
  if (!base64) throw new Error('El archivo llegó vacío');
  const drive = getDrive();
  const carpeta = await carpetaConductor(clave);

  const { Readable } = require('stream');
  const buffer = Buffer.from(base64, 'base64');
  const stream = Readable.from(buffer);

  const { data } = await drive.files.create({
    requestBody: { name: nombre, parents: [carpeta] },
    media: { mimeType: mime || 'application/octet-stream', body: stream },
    fields: 'id,name,mimeType,size,createdTime,webViewLink,iconLink',
    supportsAllDrives: true
  });
  return data;
}

/** Lista los documentos de un conductor (vacío si aún no tiene carpeta). */
async function listar(clave) {
  const drive = getDrive();
  const nombre = normClave(clave);
  const raiz = carpetaRaiz();

  // Busca la subcarpeta sin crearla, para no ensuciar el Drive al solo mirar.
  let carpeta = cacheCarpetas.get(nombre);
  if (!carpeta) {
    const q = `name='${escQ(nombre)}' and '${raiz}' in parents ` +
              `and mimeType='${CARPETA_MIME}' and trashed=false`;
    const { data } = await drive.files.list({
      q, fields: 'files(id)', pageSize: 1,
      supportsAllDrives: true, includeItemsFromAllDrives: true
    });
    if (!data.files || !data.files.length) return [];
    carpeta = data.files[0].id;
    cacheCarpetas.set(nombre, carpeta);
  }

  const { data } = await drive.files.list({
    q: `'${carpeta}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink,iconLink)',
    orderBy: 'createdTime desc', pageSize: 100,
    supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  return data.files || [];
}

/**
 * Borra un documento. Solo se permite borrar archivos que estén dentro de la
 * carpeta raíz configurada, como salvaguarda ante un ID cualquiera.
 */
async function borrar(fileId) {
  if (!fileId) throw new Error('Falta el ID del archivo');
  const drive = getDrive();
  const raiz = carpetaRaiz();

  const { data } = await drive.files.get({
    fileId, fields: 'id,parents', supportsAllDrives: true
  });
  const dentro = (data.parents || []);
  // El padre directo debe ser una subcarpeta cuya raíz sea la nuestra.
  const padre = dentro[0];
  if (padre) {
    const sub = await drive.files.get({ fileId: padre, fields: 'parents', supportsAllDrives: true });
    if (!(sub.data.parents || []).includes(raiz)) {
      throw new Error('El archivo no pertenece a la carpeta de documentación');
    }
  }
  await drive.files.delete({ fileId, supportsAllDrives: true });
  return { borrado: fileId };
}

/** Indica si el almacén está configurado (para avisar en la interfaz). */
function configurado() {
  return Boolean(process.env.DRIVE_DOCS_FOLDER_ID && process.env.GOOGLE_CREDENTIALS);
}

module.exports = { subir, listar, borrar, carpetaConductor, configurado, normClave };
