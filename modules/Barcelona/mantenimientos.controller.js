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
//   /barcelona/mantenimientos/api/citas       las citas del taller: SOLO AGENDA
//                                             (leer, una a mano, el Excel, anular)
//
// MIRAR, como el resto de Barcelona, no tiene clave en el catálogo: lo usa
// quien entra con esa sede (Camilo, 07/10/2026). APUNTAR sí: la misma llave que
// en Madrid, '/taller/apuntar', comprobada aquí en cada escritura.
//
// La pantalla es la de Madrid (modules/Vehiculos/vistas/taller.ejs) con `base`
// (dónde preguntar), `sedeNombre` y `citasAgenda`: las citas sin aviso y sin
// confirmación, y de su estado solo anular. Aquí no hay rutas para lo demás.

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
    citasAgenda: true,
    tipos: mant.TIPOS,
    categorias: mant.CATEGORIAS,
    estados: mant.ESTADOS,
    intervaloGeneral: mant.INTERVALO,
    puedeApuntar: await puedeApuntar(req),
    // Las citas de agenda no cambian de estado ni se avisan: la vista no los usa.
    citasEstados: [],
    citasDiasAntes: 2,
  });
});

router.get('/api/cuadro', responde(req => mant.estadoDeLaFlota({ busca: req.query.busca, estado: req.query.estado })));

router.get('/api/ficha/:id', responde(async req => ({ ficha: await mant.ficha(req.params.id) })));
// El historial de mantenimientos con sus piezas (db/241), como en Madrid.
router.get('/api/historial', responde(async req => ({ filas: await mant.historial({ desde: req.query.desde, hasta: req.query.hasta }) })));
router.get('/api/historial/:id', responde(async req => ({ ficha: await mant.mantenimiento(req.params.id) })));

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

// ── LAS CITAS DEL TALLER: SOLO AGENDA (04/11/2026) ─────────────────────────
// Mirarlas, como la pantalla; añadirlas y anularlas, con la llave de apuntar.
// Sin avisar y sin confirmar (Camilo: «solo agregar citas», y luego «ponle
// también anular las citas»).
router.get('/api/citas', responde(req => mant.citas({ desde: req.query.desde, hasta: req.query.hasta })));
// Antes que '/api/citas/:id', que si no se quedaría con «coches» como si fuera un id.
router.get('/api/citas/coches', responde(() => mant.cochesParaCita()));
router.get('/api/citas/:id', responde(async req => ({ cita: await mant.cita(req.params.id) })));
router.post('/api/citas', responde(exigeApuntar((req, quien) => mant.crearCita(req.body || {}, quien))));
// El Excel viaja en base64: esta ruta está en SUBEN_ARCHIVOS de app.js, se salta
// el parser global de 2 MB y pone el suyo, como la de Madrid.
router.post('/api/citas/importar', express.json({ limit: '15mb' }),
  responde(exigeApuntar((req, quien) => mant.importarCitas(req.body || {}, quien))));
router.post('/api/citas/:id/anular', responde(exigeApuntar((req, quien) =>
  mant.anularCita(req.params.id, (req.body || {}).motivo, quien))));

module.exports = router;
