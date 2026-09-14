// ============================================================
// DOCUMENTOS — controlador
// ============================================================
// Tres cosas distintas viven en esta URL:
//
//   1. LA API GENERICA del archivo (/api/de/..., /api/doc/...). Es la buena:
//      pasa por el servicio, guarda indice en PostgreSQL y bytes en Drive, y
//      sirve para cualquier ambito (conductor, vehiculo...).
//   2. EL OAUTH de Google (/auth, /auth/callback). Se usa una vez, para
//      conectar la cuenta de Drive y sacar el refresh_token.
//   3. LAS RUTAS VIEJAS (/api/lista, /api/subir, /api/archivo/:id), que hablan
//      con Drive a pelo. Ver el aviso mas abajo.

const express = require('express');
const router = express.Router();
const drive = require('../../services/drive');
const docs = require('./documentos.service');
const actor = require('../../services/repo/actor');

// Los archivos llegan en base64 dentro del JSON; se sube el límite solo aquí.
router.use(express.json({ limit: '30mb' }));

// URI de redirección OAuth: preferimos la variable de entorno; si no, se deduce
// de la propia petición (protocolo tras el proxy de Render + host).
function redirectUri(req) {
  if (process.env.GOOGLE_OAUTH_REDIRECT) return process.env.GOOGLE_OAUTH_REDIRECT;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}/documentos/auth/callback`;
}

const paginaHTML = (titulo, cuerpo) => `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;background:#0e1116;color:#e6e8ec;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:640px;background:#171b22;border:1px solid #282e39;border-radius:16px;padding:28px}
h1{color:#e8b84b;margin:0 0 12px;font-size:20px}a.btn{display:inline-block;background:#e8b84b;color:#0e1116;
text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px;margin-top:8px}
code,pre{background:#0e1116;border:1px solid #282e39;border-radius:8px;padding:2px 6px;color:#3ecf8e;
word-break:break-all;white-space:pre-wrap}pre{padding:12px;display:block;margin:12px 0}
ol{line-height:1.7}.muted{color:#8b93a1;font-size:14px}</style></head>
<body><div class="card">${cuerpo}</div></body></html>`;

// ¿Está conectada la cuenta de Drive?
router.get('/api/estado', (req, res) => res.json(docs.estadoAlmacen()));

// Inicia el consentimiento OAuth con tu cuenta de Google.
router.get('/auth', (req, res) => {
  try {
    res.redirect(drive.authUrl(redirectUri(req)));
  } catch (error) {
    res.status(500).send(paginaHTML('Conectar Drive', `
      <h1>Falta configurar el cliente OAuth</h1>
      <p>${error.message}</p>
      <p class="muted">Crea un "ID de cliente de OAuth" (tipo Aplicación web) en Google Cloud
      y define <code>GOOGLE_OAUTH_CLIENT_ID</code> y <code>GOOGLE_OAUTH_CLIENT_SECRET</code> en Render.</p>`));
  }
});

// Callback: cambia el code por el refresh_token y lo muestra para copiarlo.
router.get('/auth/callback', async (req, res) => {
  if (req.query.error) {
    return res.status(400).send(paginaHTML('Conectar Drive',
      `<h1>Conexión cancelada</h1><p>Google devolvió: ${req.query.error}</p>`));
  }
  try {
    const tokens = await drive.exchangeCode(req.query.code, redirectUri(req));
    if (!tokens.refresh_token) {
      return res.send(paginaHTML('Conectar Drive', `
        <h1>Casi… falta el refresh token</h1>
        <p>Google no devolvió un <b>refresh_token</b> (suele pasar si ya habías dado permiso antes).</p>
        <p>Ve a <a href="https://myaccount.google.com/permissions" target="_blank">permisos de tu cuenta</a>,
        quita el acceso de esta app y vuelve a <a href="/documentos/auth">conectar</a>.</p>`));
    }
    console.log('🔑 [DOCS] refresh_token obtenido. Cópialo a Render como GOOGLE_OAUTH_REFRESH_TOKEN.');
    res.send(paginaHTML('Drive conectado', `
      <h1>✅ Cuenta conectada</h1>
      <p>Copia este valor y guárdalo en Render como variable de entorno
      <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>, luego pulsa "Manual Deploy":</p>
      <pre>${tokens.refresh_token}</pre>
      <p class="muted">Es un secreto: no lo compartas. Tras guardarlo y redesplegar, ya podrás subir
      documentos desde la ficha de cada conductor. Esta pantalla no volverá a hacer falta.</p>`));
  } catch (error) {
    console.error('❌ [DOCS] callback:', error.message);
    res.status(500).send(paginaHTML('Conectar Drive',
      `<h1>Error al conectar</h1><p>${error.message}</p>
       <p class="muted">Revisa que la URI de redirección registrada en Google coincida exactamente con
       <code>${redirectUri(req)}</code>.</p>`));
  }
});

// ── LA API GENERICA ────────────────────────────────────────────────────────
// Las rutas llevan `de/` y `doc/` a proposito: sin ese prefijo, `/api/:ambito/:id`
// se comeria a `/api/archivo/:id` de abajo (los dos son tres segmentos) y el
// orden de declaracion decidiria cual gana, que es de las cosas que se rompen
// al reordenar un fichero sin darse cuenta.

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [DOCS]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req) });

// Que tipos admite un ambito y cuales caducan.
router.get('/api/tipos/:ambito', responde(async req => ({ tipos: await docs.tipos(req.params.ambito) })));

// Lo que caduca pronto, de personas y de coches.
router.get('/api/vencen', responde(async req => ({ documentos: await docs.porVencer({ dias: req.query.dias }) })));

// Los documentos de alguien (o de algo).
router.get('/api/de/:ambito/:id', responde(async req => ({
  documentos: await docs.listar(req.params.ambito, req.params.id,
    { incluirReemplazados: req.query.historial === '1' }),
})));

// Subir uno. El archivo llega en base64 dentro del JSON (limite de 30mb arriba).
router.post('/api/de/:ambito/:id', responde(async req => {
  const d = await docs.subir(req.params.ambito, req.params.id, req.body || {}, await quien(req));
  console.log(`📎 [DOCS] ${req.params.ambito} ${req.params.id}: subido "${(req.body || {}).tipo}"`);
  return { documento: d };
}));

// Corregir fechas o notas sin volver a subir el archivo.
router.put('/api/doc/:id', responde(async req =>
  ({ documento: await docs.actualizar(req.params.id, req.body || {}, await quien(req)) })));

// Retirar del indice. Con ?archivo=1, tambien de Drive.
router.delete('/api/doc/:id', responde(async req => {
  const r = await docs.retirar(req.params.id, { borrarArchivo: req.query.archivo === '1' }, await quien(req));
  console.log(`🗑️  [DOCS] retirado el documento ${req.params.id}`);
  return { ...(r && typeof r === 'object' ? r : {}) };
}));

// Los bytes.
router.get('/api/doc/:id/descargar', async (req, res) => {
  try {
    const d = await docs.descargar(req.params.id);
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.nombre || 'documento')}"`);
    res.send(d.bytes);
  } catch (e) {
    console.error('❌ [DOCS] descargar:', e.message);
    res.status(404).send('No se encontró el documento');
  }
});

// ── LAS RUTAS VIEJAS ───────────────────────────────────────────────────────
// OJO: estas tres NO pasan por el indice. Hablan con Drive directamente y
// nombran la carpeta con una CLAVE DE TEXTO LIBRE (idBolt, DNI o nombre), que
// es exactamente el fallo que el indice vino a arreglar: cuando llegaba el DNI
// se creaba una segunda carpeta y los archivos de la primera quedaban
// huerfanos.
//
// Hoy no las llama ninguna vista del proyecto. Se dejan porque una ruta puede
// llamarla algo que no esta en este repositorio —un marcador, un script— y un
// 404 sin aviso es peor que una ruta vieja. Se borran en cuanto se confirme.

// Documentos de un conductor. La clave (idBolt/DNI/nombre) va en la query.
router.get('/api/lista', async (req, res) => {
  try {
    const clave = req.query.clave;
    if (!clave) return res.status(400).json({ status: 'error', msg: 'Falta la clave del conductor' });
    res.json({ status: 'ok', archivos: await drive.listar(clave) });
  } catch (error) {
    console.error('❌ [DOCS] lista:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/api/subir', async (req, res) => {
  try {
    const { clave, nombre, mime, base64 } = req.body || {};
    if (!clave) return res.status(400).json({ status: 'error', msg: 'Falta la clave del conductor' });
    const archivo = await drive.subir(clave, { nombre, mime, base64 });
    console.log(`📎 [DOCS] ${clave}: subido "${nombre}"`);
    res.json({ status: 'ok', archivo });
  } catch (error) {
    console.error('❌ [DOCS] subir:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

router.delete('/api/archivo/:id', async (req, res) => {
  try {
    const r = await drive.borrar(req.params.id);
    console.log(`🗑️  [DOCS] borrado ${r.borrado}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [DOCS] borrar:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
