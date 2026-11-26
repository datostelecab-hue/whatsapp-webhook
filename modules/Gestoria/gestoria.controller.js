// ============================================================
// LA PLANTILLA DE LA GESTORÍA — las rutas (módulo 8, db/287)
// ============================================================
// Se monta en `/gestoria`. Dos llaves:
//   '/gestoria'            mirar las discrepancias y las cargas
//   '/gestoria/gestionar'  subir el listado, resolver y el correo (marcada
//                          `escribir`: toda petición que no sea un GET la exige)
// El servicio lo vuelve a comprobar: el botón escondido no es un candado.
'use strict';

const express = require('express');
const router = express.Router();
const gestoria = require('./gestoria.service');
// La proforma de A3 (módulo 4, db/296): la pestaña «Proforma», con las mismas llaves.
const proforma = require('./proforma.service');
// El cierre de la nómina del mes (módulo 4, db/299): la pestaña «Cierre».
const cierre = require('./cierre.service');
// El catálogo de conceptos de A3 y las líneas del mes (módulo 4, db/300): la pestaña «Variables».
const variables = require('./variables.service');
// Las altas nuevas ante la gestoría (módulo 8, db/304): la pestaña «Altas».
// Cargarlo aquí registra su tarea de cada hora y el candado del coche.
const altas = require('./altas.service');
const actor = require('../../services/repo/actor');

// El listado viaja en base64 dentro del JSON: con su propio límite.
router.use('/api/subir', express.json({ limit: '20mb' }));
router.use('/api/proforma/subir', express.json({ limit: '20mb' }));
router.use('/api/variables/lienzo', express.json({ limit: '20mb' }));

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Gestoría]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  res.render('gestoria', {
    titulo: 'Plantilla de la gestoría', seccion: 'gestoria', layout: 'layout-gestion',
    puedeGestionar: await gestoria.puede(await quien(req), gestoria.CLAVE_GESTIONAR),
  });
});

router.get('/api/lista', responde(async req => gestoria.lista(await quien(req))));
router.get('/api/discrepancia/:id', responde(async req => ({ ficha: await gestoria.ficha(req.params.id, await quien(req)) })));
router.post('/api/subir', responde(async req => gestoria.subir(req.body || {}, await quien(req))));
router.post('/api/discrepancia/:id/cerrar', responde(async req => gestoria.cerrar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/discrepancia/:id/legajo', responde(async req => gestoria.ponerLegajo(req.params.id, req.body || {}, await quien(req))));
router.get('/api/correo', responde(async req => gestoria.correo(await quien(req))));
router.post('/api/correo/enviado', responde(async req => gestoria.marcarEnviadas(req.body || {}, await quien(req))));

router.get('/api/proforma/lista', responde(async req => proforma.lista(await quien(req))));
router.get('/api/proforma/caso/:id', responde(async req => ({ ficha: await proforma.ficha(req.params.id, await quien(req)) })));
router.post('/api/proforma/subir', responde(async req => proforma.subir(req.body || {}, await quien(req))));
router.post('/api/proforma/recruzar', responde(async req => proforma.recruzar(req.body || {}, await quien(req))));
router.post('/api/proforma/decidir', responde(async req => proforma.decidir(req.body || {}, await quien(req))));
router.get('/api/proforma/correo', responde(async req => proforma.correo(await quien(req))));
router.post('/api/proforma/correo/enviado', responde(async req => proforma.marcarEnviadas(req.body || {}, await quien(req))));

router.get('/api/altas/lista', responde(async req => altas.lista(await quien(req))));
router.get('/api/altas/:id', responde(async req => ({ ficha: await altas.ficha(req.params.id, await quien(req)) })));
router.post('/api/altas/:id/solicitar', responde(async req => altas.solicitar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/altas/:id/confirmar', responde(async req => altas.confirmar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/altas/:id/anular', responde(async req => altas.anular(req.params.id, req.body || {}, await quien(req))));
router.post('/api/altas/:id/reabrir', responde(async req => altas.reabrir(req.params.id, req.body || {}, await quien(req))));

router.get('/api/cierre', responde(async req => cierre.vista({ periodo: req.query.periodo }, await quien(req))));
router.post('/api/cierre/marcar', responde(async req => cierre.marcar(req.body || {}, await quien(req))));
router.post('/api/cierre/deshacer', responde(async req => cierre.deshacer(req.body || {}, await quien(req))));

router.get('/api/variables/lista', responde(async req => variables.lista(await quien(req))));
router.get('/api/variables/linea/:id', responde(async req => ({ ficha: await variables.ficha(req.params.id, await quien(req)) })));
router.get('/api/variables/personas', responde(async req => variables.personas(await quien(req))));
router.get('/api/variables/conceptos', responde(async req => variables.catalogo(await quien(req))));
router.post('/api/variables/conceptos', responde(async req => variables.guardarConcepto(req.body || {}, await quien(req))));
router.post('/api/variables/preparar', responde(async req => variables.preparar(req.body || {}, await quien(req))));
router.post('/api/variables/linea', responde(async req => variables.apuntar(req.body || {}, await quien(req))));
router.post('/api/variables/lienzo', responde(async req => variables.lienzo(req.body || {}, await quien(req))));
router.post('/api/variables/linea/:id/anular', responde(async req => variables.anular(req.params.id, req.body || {}, await quien(req))));
router.get('/api/variables/excel/:periodo', async (req, res) => {
  try {
    const { buffer, nombre } = await variables.excel(req.params.periodo, await quien(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    res.send(buffer);
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 400).send(e.message);
  }
});

module.exports = router;
