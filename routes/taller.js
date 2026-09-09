// ============================================================
// TALLER — las rutas
// ============================================================
// Dos permisos:
//
//   '/taller'           entrar y mirar el estado de la flota
//   '/taller/apuntar'   apuntar mantenimientos, anclar odómetros y cambiar
//                       intervalos — o sea, mover los números que deciden qué
//                       coche entra a taller
//
// Media empresa tiene motivos para MIRAR esta pantalla (tráfico quiere saber
// qué coche se le va a caer la semana que viene); apuntar es del taller. Por
// eso son dos, igual que leer la bitácora y justificar en ella.
//
// Quién apunta cada cosa sale de la sesión, nunca del cuerpo de la petición.

const express = require('express');
const router = express.Router();
const repo = require('../services/repo/taller');
const actor = require('../services/repo/actor');
const permisos = require('../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Taller]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/** ¿Puede este usuario tocar los números, no solo mirarlos? */
async function puedeApuntar(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has('/taller/apuntar') : false;
  } catch (_) { return false; }
}

/** El candado de verdad. El botón escondido en la vista no es un candado. */
const exigeApuntar = fn => async req => {
  if (!await puedeApuntar(req)) throw new Error('No tienes permiso para apuntar en el taller');
  return fn(req, await quienEs(req));
};

router.get('/', async (req, res) => {
  res.render('taller', {
    titulo: 'Taller',
    seccion: 'taller',
    layout: 'layout-gestion',
    tipos: repo.TIPOS,
    estados: repo.ESTADOS,
    intervaloGeneral: repo.INTERVALO,
    puedeApuntar: await puedeApuntar(req),
  });
});

router.get('/api/cuadro', responde(async req => ({
  filas: await repo.cuadro({ busca: req.query.busca, estado: req.query.estado }),
  resumen: await repo.resumen(),
})));

router.get('/api/ficha/:id', responde(async req => ({ ficha: await repo.ficha(req.params.id) })));

// El informe en PDF. Va SIEMPRE con la flota entera, no con lo que haya
// filtrado en pantalla: el papel se lleva a una reunión y allí nadie sabe qué
// filtro estaba puesto cuando se imprimió.
router.get('/informe.pdf', async (req, res) => {
  try {
    const datos = await repo.todo();
    const pdf = await require('../services/tallerPdf').generar(datos);
    console.log(`📄 [Taller] informe: ${datos.resumen.total} coches, ` +
      `${datos.resumen.toca} tocan revisión, ${datos.historial.length} apuntes`);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="taller-${hoy}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('❌ [Taller] /informe.pdf:', e.stack || e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

router.post('/api/mantenimiento', responde(exigeApuntar((req, usuarioId) =>
  repo.registrar(req.body, { usuarioId }))));

router.post('/api/anular', responde(exigeApuntar((req, usuarioId) =>
  repo.anular(req.body.id, req.body.motivo, { usuarioId }))));

router.post('/api/ancla', responde(exigeApuntar((req, usuarioId) =>
  repo.anclar(req.body, { usuarioId }))));

router.post('/api/intervalo', responde(exigeApuntar(req => repo.intervalo(req.body))));

module.exports = router;
