// ============================================================
// BARCELONA · MANTENIMIENTOS — las rutas
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada (ni la sede: la fija
// mantenimientos.service.js).
//
//   /barcelona/mantenimientos                 la pantalla
//   /barcelona/mantenimientos/api/cuadro      el estado de la flota de Barcelona
//   /barcelona/mantenimientos/api/ficha/:id   un coche, con su historial
//   /barcelona/mantenimientos/informe.xlsx    el informe, en Excel y en PDF
//   POST /barcelona/mantenimientos/api/...    apuntar, anular, anclar, intervalo
//
// MIRAR, como el resto de Barcelona, no tiene clave en el catálogo: lo usa
// quien entra con esa sede (Camilo, 07/10/2026). APUNTAR sí: la misma llave que
// en Madrid, '/taller/apuntar', comprobada aquí en cada escritura.
//
// La pantalla es la de Madrid (modules/Vehiculos/vistas/taller.ejs) con `base`
// (dónde preguntar), `sedeNombre` y sin la pestaña de las citas.

const express = require('express');
const router = express.Router();
const mant = require('./mantenimientos.service');
const actor = require('../../services/repo/actor');   // quién firma

const BASE = '/barcelona/mantenimientos';

/** Envoltorio: el error, legible. Los de las comprobaciones son de quien pregunta (400). */
const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Barcelona · Mantenimientos]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

async function puedeApuntar(req) {
  let usuarioId = null;
  try { usuarioId = await quienEs(req); } catch (_) { /* sin id, sin apuntar */ }
  return mant.puedeApuntar({ rol: (req.usuario || {}).rol, usuarioId });
}

/** El candado de verdad: el botón escondido en la vista no es un candado. */
const exigeApuntar = fn => async req => {
  if (!await puedeApuntar(req)) throw new Error('No tienes permiso para apuntar en el taller');
  return fn(req, { usuarioId: await quienEs(req) });
};

router.get('/', async (req, res) => {
  res.render('taller', {
    titulo: 'Barcelona · Mantenimientos',
    seccion: 'bcn-mantenimientos',
    layout: 'layout-gestion',
    base: BASE,
    sedeNombre: mant.SEDE_NOMBRE,
    conCitas: false,
    tipos: mant.TIPOS,
    estados: mant.ESTADOS,
    intervaloGeneral: mant.INTERVALO,
    puedeApuntar: await puedeApuntar(req),
    // La vista los pinta en la pestaña de las citas, que aquí no sale.
    citasEstados: [],
    citasDiasAntes: 0,
  });
});

router.get('/api/cuadro', responde(req => mant.estadoDeLaFlota({ busca: req.query.busca, estado: req.query.estado })));

router.get('/api/ficha/:id', responde(async req => ({ ficha: await mant.ficha(req.params.id) })));

const descarga = formato => async (req, res) => {
  try {
    const r = await mant.informe(formato);
    console.log(`📄 [Barcelona · Mantenimientos] informe ${formato}: ${r.resumen.total} coches, ` +
      `${r.resumen.toca} tocan revisión, ${r.apuntes} apuntes`);
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
    res.send(r.fichero);
  } catch (e) {
    console.error(`❌ [Barcelona · Mantenimientos] informe ${formato}:`, e.stack || e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};
router.get('/informe.xlsx', descarga('xlsx'));
router.get('/informe.pdf', descarga('pdf'));

router.post('/api/mantenimiento', responde(exigeApuntar((req, quien) => mant.registrar(req.body, quien))));
router.post('/api/anular', responde(exigeApuntar((req, quien) => mant.anular((req.body || {}).id, (req.body || {}).motivo, quien))));
router.post('/api/ancla', responde(exigeApuntar((req, quien) => mant.anclar(req.body, quien))));
router.post('/api/intervalo', responde(exigeApuntar(req => mant.intervalo(req.body))));

module.exports = router;
