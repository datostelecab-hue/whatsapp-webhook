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
// Por el SERVICIO, que es la puerta. El repositorio no se toca desde aqui.
const taller = require('./taller.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');
const facturas = require('./facturas.service');

/**
 * Las sedes que ve quien pregunta. Sin la llave '/vehiculos/sedes', solo Madrid
 * — que es la flota que Óscar mantiene. Ante cualquier fallo, Madrid.
 */
//
// SOLO MADRID, para todo el mundo (24/09/2026): la flota que mantiene Oscar,
// la misma que sale en el mapa. Antes quien tenia la llave '/vehiculos/sedes'
// veia tambien Barcelona, y Mantenimientos y el mapa no contaban los mismos
// coches. `req` se deja en la firma para no tocar a quien la llama.
async function sedesDe(req) { // eslint-disable-line no-unused-vars
  return [facturas.SEDE_POR_DEFECTO];
}

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
    tipos: taller.TIPOS,
    estados: taller.ESTADOS,
    intervaloGeneral: taller.INTERVALO,
    puedeApuntar: await puedeApuntar(req),
  });
});

router.get('/api/cuadro', responde(async req => ({
  filas: await taller.cuadro({ busca: req.query.busca, estado: req.query.estado, sedes: await sedesDe(req) }),
  resumen: await taller.resumen(),
})));

router.get('/api/ficha/:id', responde(async req => ({ ficha: await taller.ficha(req.params.id) })));

// El informe, en Excel y en PDF. Quien decide QUE lleva y como se llama es el
// servicio; aqui solo se ponen las cabeceras y se manda.
//
// El Excel es el que se usa: se ordena, se filtra por zona y se le manda a cada
// taller su trozo. El PDF es para imprimirlo y llevarlo a la reunion.
const descarga = formato => async (req, res) => {
  try {
    const r = await taller.informe(formato);
    console.log(`📄 [Taller] informe ${formato}: ${r.resumen.total} coches, ` +
      `${r.resumen.toca} tocan revisión, ${r.apuntes} apuntes`);
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
    res.send(r.fichero);
  } catch (e) {
    console.error(`❌ [Taller] informe ${formato}:`, e.stack || e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/informe.xlsx', descarga('xlsx'));
router.get('/informe.pdf', descarga('pdf'));

router.post('/api/mantenimiento', responde(exigeApuntar((req, usuarioId) =>
  taller.registrar(req.body, { usuarioId }))));

router.post('/api/anular', responde(exigeApuntar((req, usuarioId) =>
  taller.anular(req.body.id, req.body.motivo, { usuarioId }))));

router.post('/api/ancla', responde(exigeApuntar((req, usuarioId) =>
  taller.anclar(req.body, { usuarioId }))));

router.post('/api/intervalo', responde(exigeApuntar(req => taller.intervalo(req.body))));

module.exports = router;
