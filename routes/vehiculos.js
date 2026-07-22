const express = require('express');
const router = express.Router();
const {
  ESTADOS, leerVehiculos, crearVehiculo, actualizarVehiculo, borrarVehiculo
} = require('../services/vehiculos');
const { leerTablero } = require('../services/planificadorV2');

router.get('/', async (req, res) => {
  // Las zonas salen de las bases, para el desplegable de zona.
  let zonas = [];
  try { zonas = (await leerTablero()).bases.map(b => b.nombre); } catch (e) { /* opcional */ }
  res.render('vehiculos', {
    titulo: 'Vehículos', seccion: 'vehiculos', layout: 'layout-gestion',
    estadosVehiculo: ESTADOS, zonas
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    res.json(await leerVehiculos());
  } catch (error) {
    console.error('❌ [VEHICULOS] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/api/vehiculo', async (req, res) => {
  try {
    const r = await crearVehiculo(req.body);
    console.log(`🚗 [VEHICULOS] Alta: ${r.matricula}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [VEHICULOS] POST:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

router.put('/api/vehiculo', async (req, res) => {
  try {
    const { fila, matricula, campos } = req.body || {};
    const r = await actualizarVehiculo(fila ? { fila } : { matricula }, campos);
    console.log(`✏️  [VEHICULOS] fila ${r.fila}: ${r.camposActualizados.join(', ')}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [VEHICULOS] PUT:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

router.delete('/api/vehiculo/:fila', async (req, res) => {
  try {
    const r = await borrarVehiculo(req.params.fila);
    console.log(`🗑️  [VEHICULOS] Borrada fila ${r.borrada}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [VEHICULOS] DELETE:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
