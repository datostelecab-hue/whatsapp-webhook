// ============================================================
// VACANTES — rutas
// ============================================================
// Lo que Tráfico armó en el generador y Selección tiene que reclutar. Todo de
// PostgreSQL: la vacante, sus plazas y el candidato que la tiene enganchado.
//
// Los candidatos salían de la hoja TICKETS, que lleva muerta desde que Selección
// se migró: la lista de "candidatos de esta vacante" estaba SIEMPRE vacía y
// nadie podía verlo, porque una lista vacía no parece un error. Ahora salen de
// `candidatura`, que es donde están.

const express = require('express');
const router = express.Router();
const vac = require('../services/repo/vacantes');
const actor = require('../services/repo/actor');

const quien = async req => ({ usuarioId: await actor.idDe(req) });

router.get('/', (req, res) => {
  res.render('vacantes', {
    titulo: 'Vacantes',
    seccion: 'vacantes',
    layout: 'layout-gestion',
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const todas = await vac.listar({ incluirCerradas: true });
    const pendientes = todas.filter(v => v.estado === 'abierta' || v.estado === 'proceso');
    const resueltas = todas.filter(v => v.estado === 'cubierta' || v.estado === 'anulada');

    res.json({
      status: 'ok',
      vacantes: pendientes, resueltas,
      contadores: {
        abiertas: pendientes.filter(v => v.estado === 'abierta').length,
        proceso: pendientes.filter(v => v.estado === 'proceso').length,
        resueltas: resueltas.length,
        dia: pendientes.filter(v => v.turno === 'Día').length,
        noche: pendientes.filter(v => v.turno === 'Noche').length,
        recambios: pendientes.filter(v => v.motivo === 'recambio').length,
        // Cuántas plazas hay prometidas: es el número que dice de verdad cuánto
        // coche está esperando gente.
        plazas: pendientes.reduce((a, v) => a + v.nPlazas, 0),
      },
    });
  } catch (error) {
    console.error('❌ [Vacantes] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.get('/api/ficha/:id', async (req, res) => {
  try {
    const v = await vac.ficha(req.params.id);
    if (!v) return res.status(404).json({ status: 'error', msg: 'No existe esa vacante' });
    res.json({ status: 'ok', vacante: v });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Anular una vacante que ya no hace falta (el coche se fue al taller, el que se
// iba se queda). No se borra: anular deja rastro de que existió y por qué murió.
router.post('/api/anular/:id', async (req, res) => {
  try {
    const r = await vac.cambiarEstado(req.params.id, 'anulada',
      { motivo: (req.body || {}).motivo, ...(await quien(req)) });
    if (!r.ok) throw new Error('No existe esa vacante');
    console.log(`🗂️  [Vacantes] ${r.codigo} anulada`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Reabrirla: el candidato se cayó y a esa vacante nunca llegó a entrar nadie.
router.post('/api/reabrir/:id', async (req, res) => {
  try {
    const r = await vac.cambiarEstado(req.params.id, 'abierta', await quien(req));
    if (!r.ok) throw new Error('No existe esa vacante');
    res.json({ status: 'ok', ...r });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
