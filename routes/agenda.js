const express = require('express');
const router = express.Router();
const {
  leerTablero, leerOut, cambiarEstados, migrarBajasEmpresa, restaurarDesdeOut,
  actualizarConductor, crearConductor, importarConductores,
  ESTADOS_CONDUCTOR, DIAS_SEM, TURNOS, CONTRATOS
} = require('../services/planificadorV2');
const { geocodificar } = require('../services/geocoding');
const { avisosAgenda } = require('../services/conductores');

/** La interfaz. */
router.get('/', (req, res) => {
  res.render('agenda', {
    titulo: 'Agenda',
    seccion: 'agenda',
    layout: 'layout-gestion',
    estadosConductor: ESTADOS_CONDUCTOR,
    diasSem: DIAS_SEM,
    turnos: TURNOS,
    contratos: CONTRATOS
  });
});

/** Conductores con su estado calculado y su asignación semanal. */
router.get('/api/datos', async (req, res) => {
  try {
    const t = await leerTablero();
    // Avisos PROPIOS de la agenda (sin ID_BOLT, duplicados). Los avisos del
    // planificador (coches/turnos/asignación) se quedan en el planificador.
    const { avisos, pendientes } = avisosAgenda(t.conductores);
    res.json({
      esquema: t.esquema,
      conductores: t.conductores,
      avisos,
      pendientes,
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

/**
 * Edita los datos de un conductor. Se identifica por su número de fila (así
 * también se puede editar a quien aún no tiene ID de Bolt) o por el ID.
 */
router.put('/api/conductor', async (req, res) => {
  try {
    const { fila, id, campos } = req.body || {};
    const selector = fila !== undefined ? { fila } : id;
    const r = await actualizarConductor(selector, campos);
    console.log(`✏️  [AGENDA] fila ${r.fila}: ${r.camposActualizados.join(', ')}`);
    res.json({ status: 'ok', id: r.id, fila: r.fila, camposActualizados: r.camposActualizados });
  } catch (error) {
    console.error('❌ [AGENDA] PUT conductor:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** Geocodifica una dirección suelta (botón "obtener coordenadas" en la ficha). */
router.post('/api/geocodificar', async (req, res) => {
  try {
    const { direccion, codigoPostal } = req.body || {};
    const r = await geocodificar(direccion, codigoPostal);
    if (!r) return res.json({ status: 'ok', encontrado: false });
    if (r.error) return res.status(502).json({ status: 'error', msg: r.mensaje });
    res.json({ status: 'ok', encontrado: true, ...r, coordenadas: `${r.lat}, ${r.lng}` });
  } catch (error) {
    console.error('❌ [AGENDA] /api/geocodificar:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/** Alta masiva desde el anexo (el cliente ya ha parseado el xlsx). */
router.post('/api/importar', async (req, res) => {
  try {
    const lista = req.body && req.body.conductores;
    const conGeo = !req.body || req.body.geocodificar !== false;
    const r = await importarConductores(lista, { geocodificar: conGeo ? geocodificar : null });
    console.log(`📥 [AGENDA] Importados: ${r.creados} creados, ${r.errores} con error`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [AGENDA] /api/importar:', error.message);
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
