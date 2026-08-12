// ============================================================
// ETT — rutas del módulo de bolsa de empleo (empresa de trabajo temporal)
// ============================================================
const express = require('express');
const router = express.Router();
const ett = require('../services/ett');

router.get('/', (req, res) => {
  res.render('ett', { titulo: 'ETT · Bolsa de empleo', seccion: 'ett', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const d = await ett.datos();
    res.json({ status: 'ok', ...d });
  } catch (e) {
    console.error('❌ [ETT] /api/datos:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Importa la matriz pegada del correo de la ETT (crea los candidatos nuevos).
router.post('/importar', async (req, res) => {
  try {
    const r = await ett.importar((req.body || {}).texto);
    console.log(`👥 [ETT] Importados ${r.añadidos} candidatos (${r.yaEstaban} ya estaban)`);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Marca la decisión de Selección (Presentó / No se presentó / Contratado / No pasa).
router.post('/decision', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await ett.guardarDecision((b.tel || '').toString(), (b.estado || '').toString());
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Guarda los datos que crea Selección para los contratados (fecha alta, jornada, turno, zona).
router.post('/campos', async (req, res) => {
  try {
    const b = req.body || {};
    await ett.guardarCampos((b.tel || '').toString(), b);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Devuelve la matriz (texto separado por tabulaciones) para pegar en la respuesta a la ETT.
router.get('/exportar', async (req, res) => {
  try {
    const texto = await ett.exportarMatriz();
    res.type('text/plain; charset=utf-8').send(texto);
  } catch (e) {
    res.status(500).type('text/plain').send('Error: ' + e.message);
  }
});

// Excel ya maquetado para ADJUNTAR al correo de la ETT (lo normal); el texto de
// arriba se conserva por si alguien prefiere pegarlo en el cuerpo del mensaje.
router.get('/exportar/excel', async (req, res) => {
  try {
    const { generarExcelETT, nombreFichero } = require('../services/ettExcel');
    const lista = await ett.leer();
    const buffer = await generarExcelETT(lista);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero()}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('❌ [ETT] /exportar/excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
