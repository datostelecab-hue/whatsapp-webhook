const express = require('express');
const router = express.Router();
const drive = require('../services/drive');

// Los archivos llegan en base64 dentro del JSON; se sube el límite solo aquí.
router.use(express.json({ limit: '30mb' }));

// ¿Está configurado el almacén de Drive?
router.get('/api/estado', (req, res) => {
  res.json({ configurado: drive.configurado() });
});

// Documentos de un conductor. La clave (idBolt/DNI/nombre) va en la query.
router.get('/api/lista', async (req, res) => {
  try {
    const clave = req.query.clave;
    if (!clave) return res.status(400).json({ status: 'error', msg: 'Falta la clave del conductor' });
    res.json({ status: 'ok', archivos: await drive.listar(clave) });
  } catch (error) {
    console.error('❌ [DOCS] lista:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/api/subir', async (req, res) => {
  try {
    const { clave, nombre, mime, base64 } = req.body || {};
    if (!clave) return res.status(400).json({ status: 'error', msg: 'Falta la clave del conductor' });
    const archivo = await drive.subir(clave, { nombre, mime, base64 });
    console.log(`📎 [DOCS] ${clave}: subido "${nombre}"`);
    res.json({ status: 'ok', archivo });
  } catch (error) {
    console.error('❌ [DOCS] subir:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

router.delete('/api/archivo/:id', async (req, res) => {
  try {
    const r = await drive.borrar(req.params.id);
    console.log(`🗑️  [DOCS] borrado ${r.borrado}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [DOCS] borrar:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
