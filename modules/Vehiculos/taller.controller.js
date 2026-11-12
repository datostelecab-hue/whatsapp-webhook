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
const facturas = require('./facturas.service');
const citas = require('./citas.service');

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

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Taller]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/**
 * ¿Puede este usuario tocar los números, no solo mirarlos? La regla es del
 * servicio (la misma para Mantenimientos de Barcelona); aquí solo se saca de la
 * sesión quién es.
 */
async function puedeApuntar(req) {
  const u = req.usuario || {};
  let usuarioId = null;
  try { usuarioId = await quienEs(req); } catch (_) { /* sin id, sin apuntar */ }
  return taller.puedeApuntar({ rol: u.rol, usuarioId });
}

/**
 * El candado de verdad. El botón escondido en la vista no es un candado.
 * Y cada escritura lleva las sedes de la pantalla: Madrid no apunta en un coche
 * de Barcelona aunque alguien mande su id a mano (04/11/2026).
 */
const exigeApuntar = fn => async req => {
  if (!await puedeApuntar(req)) throw new Error('No tienes permiso para apuntar en el taller');
  return fn(req, { usuarioId: await quienEs(req), sedes: await sedesDe(req) });
};

router.get('/', async (req, res) => {
  res.render('taller', {
    titulo: 'Mantenimientos',
    seccion: 'taller',
    layout: 'layout-gestion',
    tipos: taller.TIPOS,
    categorias: taller.CATEGORIAS,
    estados: taller.ESTADOS,
    intervaloGeneral: taller.INTERVALO,
    puedeApuntar: await puedeApuntar(req),
    citasEstados: citas.ESTADOS,
    citasDiasAntes: citas.DIAS_ANTES,
  });
});

// Cada fila con su próxima cita del taller (db/187), y las cifras de arriba.
router.get('/api/cuadro', responde(async req =>
  taller.estadoDeLaFlota({ busca: req.query.busca, estado: req.query.estado, sedes: await sedesDe(req) })));

router.get('/api/ficha/:id', responde(async req => ({ ficha: await taller.ficha(req.params.id, { sedes: await sedesDe(req) }) })));

// El historial de mantenimientos (db/241): la lista de la pestaña y cada uno con
// sus piezas. Va en '/api/historial' y no en '/api/mantenimiento/:id' porque
// esa ruta está en RUTA_A_CLAVE con la llave de apuntar, mire el método que mire.
router.get('/api/historial', responde(async req => ({
  filas: await taller.historial({ sedes: await sedesDe(req), desde: req.query.desde, hasta: req.query.hasta }),
})));
router.get('/api/historial/:id', responde(async req => ({
  ficha: await taller.mantenimiento(req.params.id, { sedes: await sedesDe(req) }),
})));

// El informe, en Excel y en PDF. Quien decide QUE lleva y como se llama es el
// servicio; aqui solo se ponen las cabeceras y se manda.
//
// El Excel es el que se usa: se ordena, se filtra por zona y se le manda a cada
// taller su trozo. El PDF es para imprimirlo y llevarlo a la reunion.
const descarga = formato => async (req, res) => {
  try {
    // Las mismas sedes que la pantalla (04/11/2026): antes llevaba también Barcelona.
    const r = await taller.informe(formato, { sedes: await sedesDe(req) });
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

router.post('/api/mantenimiento', responde(exigeApuntar((req, quien) =>
  taller.registrar(req.body, quien))));

router.post('/api/anular', responde(exigeApuntar((req, quien) =>
  taller.anular(req.body.id, req.body.motivo, quien))));

router.post('/api/ancla', responde(exigeApuntar((req, quien) =>
  taller.anclar(req.body, quien))));

router.post('/api/intervalo', responde(exigeApuntar((req, quien) =>
  taller.intervalo(req.body, { sedes: quien.sedes }))));

// ── LAS CITAS DEL TALLER (db/187) ───────────────────────────────────────────
// Mirarlas es de '/taller'; subir el Excel, avisar y cambiar su estado, de
// '/taller/apuntar'. Las llamadas para confirmarlas son de Control
// (/control/citas-taller).
//
// Las de Madrid (el servicio lo hace así si no se dice otra sede): las de
// Barcelona son de su Mantenimientos, solo agenda (04/11/2026).
router.get('/api/citas', responde(req => citas.lista({ desde: req.query.desde, hasta: req.query.hasta })));
// Los coches para poner una cita a mano. Antes que '/api/citas/:id', que si no
// se quedaría con «coches» como si fuera el id de una cita.
router.get('/api/citas/coches', responde(() => citas.cochesParaCita()));
router.get('/api/citas/:id', responde(async req => ({ cita: await citas.ficha(req.params.id, { sede: (await sedesDe(req))[0] }) })));

// Una cita a mano (21/10/2026): lo mismo que una fila del Excel, de una en una.
router.post('/api/citas', responde(exigeApuntar((req, { usuarioId }) =>
  citas.crear(req.body || {}, { usuarioId }))));

// El Excel viaja en base64 dentro del JSON: esta ruta está en SUBEN_ARCHIVOS de
// app.js, se salta el parser global de 2 MB y pone el suyo.
router.post('/api/citas/importar', express.json({ limit: '15mb' }), responde(exigeApuntar((req, { usuarioId }) =>
  citas.importar(req.body || {}, { usuarioId }))));

router.post('/api/citas/:id/avisar', responde(exigeApuntar((req, { usuarioId }) =>
  citas.avisar(req.params.id, { usuarioId }))));

router.post('/api/citas/:id/avisado', responde(exigeApuntar((req, { usuarioId }) =>
  citas.marcarAvisado(req.params.id, req.body || {}, { usuarioId }))));

router.post('/api/citas/:id/estado', responde(exigeApuntar((req, { usuarioId, sedes }) =>
  citas.cambiarEstado(req.params.id, req.body || {}, { usuarioId }, { sede: sedes[0] }))));

module.exports = router;
