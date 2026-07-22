const express = require('express');
const router = express.Router();
const drive = require('../services/drive');

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
router.get('/api/estado', (req, res) => {
  res.json({ configurado: drive.configurado(), puedeConectar: drive.puedeConectar() });
});

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
