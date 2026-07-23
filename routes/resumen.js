const express = require('express');
const router = express.Router();
const { actualizarTodo } = require('../services/boltResumen');

// Todo pasa por actualizarTodo: regenera las hojas de Madrid y Barcelona en una
// pasada y tiene cooldown propio. Los endpoints antiguos (/unificadas, /15dias,
// /pordia) importaban funciones que nunca existieron y respondían 500; se
// mantienen como alias para no romper a quien los tuviera guardados.
async function ejecutar(res) {
  try {
    const result = await actualizarTodo();
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
}

router.post('/todo', (req, res) => ejecutar(res));
router.post('/unificadas', (req, res) => ejecutar(res));
router.post('/15dias', (req, res) => ejecutar(res));
router.post('/pordia', (req, res) => ejecutar(res));

module.exports = router;
