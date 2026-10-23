// ============================================================
// COMBUSTIBLE — las rutas
// ============================================================
// Se monta en `/combustible`. Dos llaves, como Inspección de vehículos:
//
//   '/combustible'        mirar los repostajes, su auditoría y el estado de la lectura
//   '/combustible/leer'   «Leer el buzón ahora», «Auditar ahora», corregir la gasolinera
//                         e «Importar Excel» (Petroprix, db/215)
//
// La segunda está marcada `escribir` en el catálogo: cualquier petición que no
// sea un GET a /combustible la exige sola (`controlAcceso`), así que un endpoint
// nuevo nace cerrado. Aquí se vuelve a comprobar, porque el botón escondido en
// la vista no es un candado. Desde el 22/10/2026 (db/213) esa misma llave abre
// también «Auditar ahora» y corregir a mano la gasolinera de un repostaje.

const express = require('express');
const router = express.Router();
const combustible = require('./combustible.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Combustible]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

async function puedeLeer(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has('/combustible/leer') : false;
  } catch (_) { return false; }
}

router.get('/', async (req, res) => {
  res.render('combustible', {
    titulo: 'Combustible',
    seccion: 'combustible',
    layout: 'layout-gestion',
    puedeLeer: await puedeLeer(req),
    // La sede de la sesión (`sede`) ya la pone services/sesion en res.locals.
  });
});

router.get('/api/lista', responde(req => combustible.lista({ desde: req.query.desde, hasta: req.query.hasta })));

// `ficha`: es la clave que busca el componente Listado.
router.get('/api/repostaje/:id', responde(async req => ({ ficha: await combustible.ficha(req.params.id) })));

router.get('/api/lecturas', responde(async () => ({ lecturas: await combustible.lecturas(30) })));
router.get('/api/importaciones', responde(async () => ({ importaciones: await combustible.importaciones(30) })));

// El Excel de repostajes de Petroprix (db/215). Viaja en base64 dentro del
// JSON, como el del taller y el de inspecciones: esta ruta está en
// SUBEN_ARCHIVOS de app.js, se salta el parser global de 2 MB y pone el suyo.
// El de 1.866 filas pesa 85 KB (113 KB en base64): en 4 MB caben unas 60.000
// filas como esas, y el servicio no abre más de 20.000 de una vez. Eran 15, y
// con 15 MB cabía un fichero que dejaba el ERP colgado al abrirlo (revisión del
// 23/10/2026; el servicio, además, mira lo que ocupa descomprimido antes).
// Un fichero de más: con su mensaje en JSON, como los demás errores. Sin esto
// llegaba la página de error de Express y la pantalla solo decía «Error 413».
const jsonExcel = express.json({ limit: '4mb' });
const leerExcel = (req, res, next) => jsonExcel(req, res, e => {
  if (!e) return next();
  const grande = e.type === 'entity.too.large';
  res.status(grande ? 413 : 400).json({ status: 'error', msg: grande
    ? 'El fichero pasa de 4 MB, y un Excel de Petroprix de tres semanas ocupa 85 KB: ¿es el de repostajes? Si lo es, bájalo por meses. No se ha importado nada'
    : 'No se pudo leer lo que se ha enviado. No se ha importado nada' });
});
router.post('/api/importar', leerExcel, responde(async req => {
  if (!await puedeLeer(req)) throw new Error('No tienes permiso para importar repostajes');
  return { importacion: await combustible.importarExcel(req.body || {}, { usuarioId: await quienEs(req) }) };
}));

// Lee el buzón ahora. Tarda lo que tarde el servidor de correo (unos segundos):
// la pantalla tapa con la carga de la casa mientras tanto. Si no puede entrar,
// no es un 400: la pasada queda escrita con su error y se devuelve tal cual.
router.post('/api/leer', responde(async req => {
  if (!await puedeLeer(req)) throw new Error('No tienes permiso para leer el buzón');
  const lectura = await combustible.leerBuzon({ origen: 'manual', usuarioId: await quienEs(req) });
  // Lo nuevo sale ya con su gasolinera; la auditoría con Mapon la hace el cron
  // (a los 45 min del repostaje) o el botón de la ficha.
  if (lectura && lectura.ok) await combustible.casarGasolineras();
  return { lectura };
}));

// La auditoría con Mapon de UN repostaje, ya. Solo lectura de Mapon, pero
// tarda unos segundos (tres o cuatro preguntas): la pantalla tapa mientras.
router.post('/api/repostaje/:id/auditar', responde(async req => {
  if (!await puedeLeer(req)) throw new Error('No tienes permiso para auditar repostajes');
  return { auditoria: await combustible.auditarUno(req.params.id) };
}));

// Las gasolineras de la lista del proveedor, para elegir a mano.
router.get('/api/gasolineras', responde(async req => ({ gasolineras: await combustible.gasolineras(req.query.proveedor) })));

// Casar a mano la estación de un repostaje con una gasolinera (vale para todos
// los correos con ese nombre de estación); sin `gasolineraId`, quitarlo.
router.post('/api/repostaje/:id/gasolinera', responde(async req => {
  if (!await puedeLeer(req)) throw new Error('No tienes permiso para corregir la gasolinera');
  const b = req.body || {};
  return { resultado: await combustible.corregirGasolinera(req.params.id, b.gasolineraId, await quienEs(req)) };
}));

module.exports = router;
