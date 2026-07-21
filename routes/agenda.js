const express = require('express');
const router = express.Router();
const {
  leerTablero, leerOut, cambiarEstados, migrarBajasEmpresa, restaurarDesdeOut,
  actualizarConductor, crearConductor,
  ESTADOS_CONDUCTOR, DIAS_SEM, TURNOS
} = require('../services/planificadorV2');

/** La interfaz. */
router.get('/', (req, res) => {
  res.render('agenda', {
    titulo: 'Agenda',
    seccion: 'agenda',
    layout: 'layout-gestion',
    estadosConductor: ESTADOS_CONDUCTOR,
    diasSem: DIAS_SEM,
    turnos: TURNOS,
    contratos: ['40h Fijo', '32h Correturno']
  });
});

/** Conductores con su estado calculado y su asignación semanal. */
router.get('/api/datos', async (req, res) => {
  try {
    const t = await leerTablero();
    res.json({
      esquema: t.esquema,
      conductores: t.conductores,
      avisos: t.avisos,
      resumen: {
        total: t.conductores.length,
        porEstado: t.conductores.reduce((acc, c) => {
          acc[c.estadoCalculado] = (acc[c.estadoCalculado] || 0) + 1;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('❌ [AGENDA] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/**
 * Cambia el estado de uno o varios conductores.
 * Si alguno pasa a "Baja Empresa", se archiva en CONDUCTORES_OUT en la misma
 * operación (copiando antes de borrar, nunca al revés).
 */
router.post('/api/estado', async (req, res) => {
  try {
    const resultado = await cambiarEstados(req.body && req.body.cambios);
    const migrados = resultado.migracion ? resultado.migracion.migrados.length : 0;
    console.log(`👤 [AGENDA] ${resultado.aplicados.length} estados cambiados` +
                (migrados ? ` · ${migrados} archivados en CONDUCTORES_OUT` : ''));
    res.json({ status: 'ok', ...resultado });
  } catch (error) {
    console.error('❌ [AGENDA] /api/estado:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/** Fichas archivadas. */
router.get('/api/out', async (req, res) => {
  try {
    const out = await leerOut();
    res.json({ fichas: out.fichas });
  } catch (error) {
    console.error('❌ [AGENDA] /api/out:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/** Vuelve a meter en la agenda a quien estaba archivado. */
router.post('/api/restaurar', async (req, res) => {
  try {
    const ids = req.body && req.body.ids;
    const resultado = await restaurarDesdeOut(ids);
    console.log(`♻️  [AGENDA] Restaurados: ${resultado.restaurados.map(r => r.id).join(', ')}`);
    res.json({ status: 'ok', ...resultado });
  } catch (error) {
    console.error('❌ [AGENDA] /api/restaurar:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/** Edita los datos de un conductor (libranza, teléfono, turno, dirección…). */
router.put('/api/conductor/:id', async (req, res) => {
  try {
    const r = await actualizarConductor(req.params.id, req.body && req.body.campos);
    console.log(`✏️  [AGENDA] ${r.id}: ${r.camposActualizados.join(', ')}`);
    res.json({ status: 'ok', id: r.id, camposActualizados: r.camposActualizados });
  } catch (error) {
    console.error('❌ [AGENDA] PUT conductor:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** Da de alta a un conductor nuevo. */
router.post('/api/conductor', async (req, res) => {
  try {
    const r = await crearConductor(req.body);
    console.log(`➕ [AGENDA] Alta: ${r.id} · ${r.nombre}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [AGENDA] POST conductor:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** Archiva a quien ya estuviera marcado como Baja Empresa en la hoja. */
router.post('/api/migrar', async (req, res) => {
  try {
    const resultado = await migrarBajasEmpresa();
    res.json({ status: 'ok', ...resultado });
  } catch (error) {
    console.error('❌ [AGENDA] /api/migrar:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
