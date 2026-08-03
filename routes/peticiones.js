const express = require('express');
const router = express.Router();
const { leerPeticiones, crearPeticion, aprobarPeticion, rechazarPeticion, crearYAplicar, TIPOS } = require('../services/peticiones');
const { leerTablero, leerOut } = require('../services/planificadorV2');

router.get('/', (req, res) => {
  res.render('peticiones', {
    titulo: 'Peticiones',
    seccion: 'peticiones',
    layout: 'layout-gestion',
    tipos: TIPOS
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const [{ lista }, tablero, out] = await Promise.all([
      leerPeticiones(),
      leerTablero().catch(() => null),
      leerOut().catch(() => ({ fichas: [] }))
    ]);
    // Conductores de la agenda, para bajas/ausencias.
    // Se muestra e identifica por ID_BOLT (el nombre de la plataforma de Bolt), no
    // por el nombre de SS. Así la petición guarda el ID_BOLT y todo casa después.
    const conductores = ((tablero && tablero.conductores) || [])
      .filter(c => c.idBolt || c.nombre)
      .map(c => ({ id: c.idBolt || c.nombre, nombre: c.idBolt || c.nombre, turno: c.turno || '', estado: c.estado || '' }))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    // Conductores archivados (CONDUCTORES_OUT), para el reingreso.
    const archivados = ((out && out.fichas) || [])
      .filter(f => f.id || f.nombre)
      .map(f => ({ id: f.id || f.nombre, nombre: f.id || f.nombre, turno: f.turno || '', estado: f.estado || '' }))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    res.json({ status: 'ok', peticiones: lista, conductores, archivados });
  } catch (error) {
    console.error('❌ [Peticiones] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/crear', async (req, res) => {
  try { res.json({ status: 'ok', peticion: await crearPeticion(req.body || {}) }); }
  catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

// RRHH crea y aplica directamente (sin pasar por Tráfico).
router.post('/crear-directa', async (req, res) => {
  try { res.json({ status: 'ok', peticion: await crearYAplicar(req.body || {}) }); }
  catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

router.post('/aprobar', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ status: 'ok', peticion: await aprobarPeticion(b.id, { desde: b.desde, hasta: b.hasta, resuelto_por: b.resuelto_por }) });
  } catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

router.post('/rechazar', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ status: 'ok', peticion: await rechazarPeticion(b.id, b.motivo, b.resuelto_por) });
  } catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

module.exports = router;
