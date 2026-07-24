const express = require('express');
const router = express.Router();
const { sincronizarLibranzas, diagnosticarLibranzas } = require('../services/libranzas');
const { verificarIdBolt, auditarAgenda } = require('../services/conductores');

// Audita AGENDA_V2: duplicados por ID_BOLT, duplicados por nombre y quién no
// tiene ID_BOLT, con el número de fila real. No escribe.
router.get('/agenda-audit', async (req, res) => {
  try {
    const r = await auditarAgenda();
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [Conductores] /agenda-audit:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Comprueba si los ID_BOLT de AGENDA_V2 casan con los conductores de la API de
// Bolt. Decide si podemos unir horas por ID en vez de por nombre. No escribe.
router.get('/idcheck', async (req, res) => {
  try {
    const r = await verificarIdBolt();
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [Conductores] /idcheck:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Escribe L_Acumuladas con la semana actual de AGENDA_V2.
router.post('/sync', async (req, res) => {
  try {
    const r = await sincronizarLibranzas();
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [Libranzas] /sync:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// No escribe: lista conductores con libranza cuyo nombre no casa con VISTA_FINAL.
router.get('/diagnostico', async (req, res) => {
  try {
    const r = await diagnosticarLibranzas();
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [Libranzas] /diagnostico:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
