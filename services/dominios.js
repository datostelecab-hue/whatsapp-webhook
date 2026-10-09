// ============================================================
// DOMINIOS — qué aplicación atiende cada petición
// ============================================================
// Camilo, 09/10/2026: los conductores van a tener su propia entrada, con su
// dominio, para que no compartan login con la oficina. La oficina tendrá otro.
// Una sola aplicación en Render, y el DOMINIO de la petición decide qué se ve:
//
//   DOMINIO_CONDUCTORES   (p. ej. «conductores.telecab.es») → el portal del
//                         conductor y NADA MÁS: cualquier otra ruta da 404.
//   DOMINIO_GESTION       (p. ej. «erp.telecab.es") → el ERP de siempre. Si
//                         está puesta, quien abra el ERP por otra dirección (la
//                         de onrender.com) se va a esta.
//
// Las dos admiten varios separados por comas. Sin ninguna puesta, todo sigue
// como hasta ahora: el ERP en cualquier dirección y el portal en ninguna.
//
// SE LEEN EN CADA PETICIÓN y no al arrancar: así las pruebas pueden ponerlas
// sin reiniciar nada, y son cuatro comparaciones de texto.

const lista = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const host = req => String(req.hostname || '').toLowerCase();

const deConductores = () => lista(process.env.DOMINIO_CONDUCTORES);
const deGestion = () => lista(process.env.DOMINIO_GESTION);

/** ¿Esta petición es del portal de los conductores? */
const esDeConductores = req => deConductores().includes(host(req));

/**
 * Si el ERP se abre por una dirección que no es la suya, adónde mandarlo. Solo
 * para quien navega con el navegador (un GET que pide una página): el webhook
 * de WhatsApp, la comprobación de salud de Render y cualquier API siguen
 * entrando por donde entraban. null = se queda donde está.
 */
function redireccionAGestion(req) {
  const suyos = deGestion();
  if (!suyos.length || suyos.includes(host(req)) || esDeConductores(req)) return null;
  if (req.method !== 'GET') return null;
  if (req.query && req.query['hub.mode']) return null;                 // la verificación de Meta
  if (req.path.startsWith('/assets') || req.path.includes('/api/')) return null;
  if (!String(req.get('accept') || '').includes('text/html')) return null;
  return `https://${suyos[0]}${req.originalUrl || '/'}`;
}

module.exports = { esDeConductores, redireccionAGestion, deConductores, deGestion };
