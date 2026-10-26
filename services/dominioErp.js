// ============================================================
// LA DIRECCIÓN DEL ERP: erptelecab.es, no la de Render (26/10/2026)
// ============================================================
// Camilo: «que si alguien entra a https://whatsapp-webhook-g7wa.onrender.com lo
// redirija a erptelecab.es y ya».
//
// El servicio de Render sigue contestando en su dirección *.onrender.com (no se
// puede apagar) y por ella entran también las MÁQUINAS:
//   · Meta manda ahí los mensajes del bot (POST /) y verifica el webhook
//     (GET /?hub.mode=subscribe&…). Meta no sigue redirecciones en el webhook:
//     si se le contestara con una, el bot se quedaría mudo.
//   · Meta baja los vídeos de /assets (services/videosWhatsapp.js). /assets se
//     sirve en app.js ANTES de esto, así que ni llega aquí.
// A esas no se las toca.
//
// Solo se manda al dominio a una PERSONA con un navegador: un GET o un HEAD que
// pide una página (Accept con text/html, que es lo que manda un navegador al
// abrir una dirección). Todo lo demás pasa como hasta ahora.
//
// Va APAGADO hasta que exista `DOMINIO_ERP` en Render (p. ej. erptelecab.es):
// mandar a la gente a un dominio que aún no tiene el candado sería dejarla en
// la calle. Se pone cuando https://erptelecab.es ya abre.
//
// Redirección TEMPORAL (302), no permanente: el navegador no se la guarda, así
// que quitando la variable se deshace al momento si algo falla con el dominio.
// Un salto más cada vez que alguien escribe la dirección vieja no se nota.

const HOST_VALIDO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** El dominio del ERP de `DOMINIO_ERP`, limpio (sin https:// ni barras), o null. */
function dominio() {
  const d = String(process.env.DOMINIO_ERP || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return HOST_VALIDO.test(d) ? d : null;
}

const esDeRender = req => /\.onrender\.com$/i.test(String(req.hostname || ''));

/** Una persona abriendo una página, y no Meta ni otra máquina. */
function esPersona(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const q = req.query || {};
  if (req.path === '/' && (q['hub.mode'] !== undefined || q['hub.verify_token'] !== undefined)) return false;
  return /text\/html/i.test(String(req.headers && req.headers.accept || ''));
}

function aLaDireccionBuena(req, res, next) {
  const d = dominio();
  if (!d || !esDeRender(req) || !esPersona(req)) return next();
  // Si alguien pusiera la propia dirección de Render en la variable, sería un
  // bucle sin fin.
  if (String(req.hostname || '').toLowerCase() === d) return next();
  return res.redirect(302, 'https://' + d + (req.originalUrl || '/'));
}

module.exports = { aLaDireccionBuena, dominio, esDeRender, esPersona };
