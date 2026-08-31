// ============================================================
// VEHÍCULOS — rutas
// ============================================================
// Lee y escribe en PostgreSQL a través de `repo/vehiculos`. Antes esto tiraba
// de la hoja VEHICULOS, que además estaba vacía: el maestro real se reconstruyó
// desde el planificador durante la migración.
//
// Las rutas son las que espera el componente `Listado`:
//   · /api/lista       → todo lo que la tabla necesita, en una llamada
//   · /api/ficha/:id   → la ficha de uno solo, cuando se pincha
//
// Es el mismo par que usarán conductores, sanciones y las demás pantallas de
// listado, así que conviene que la forma no cambie de un módulo a otro.

const express = require('express');
const router = express.Router();
const veh = require('../services/repo/vehiculos');
const actor = require('../services/repo/actor');

router.get('/', async (req, res) => {
  let catalogos = { estados: [], zonas: [] };
  try { catalogos = await veh.catalogos(); } catch (e) {
    console.error('❌ [VEHICULOS] catálogos:', e.message);
  }
  res.render('vehiculos', {
    titulo: 'Vehículos', seccion: 'vehiculos', layout: 'layout-gestion',
    estadosVehiculo: catalogos.estados, zonas: catalogos.zonas,
  });
});

// ---------- lectura ----------

// La lista y los contadores viajan juntos: son una sola pantalla y así no se
// pintan desincronizados.
router.get('/api/lista', async (req, res) => {
  try {
    const [filas, resumen] = await Promise.all([
      veh.listar({ incluirBajas: req.query.bajas === '1' }),
      veh.resumen(),
    ]);
    res.json({ filas, resumen });
  } catch (error) {
    console.error('❌ [VEHICULOS] /api/lista:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.get('/api/ficha/:id', async (req, res) => {
  try {
    const f = await veh.ficha(Number(req.params.id));
    if (!f) return res.status(404).json({ status: 'error', msg: 'No existe ese vehículo' });
    res.json(f);
  } catch (error) {
    console.error('❌ [VEHICULOS] /api/ficha:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.get('/api/catalogos', async (req, res) => {
  try { res.json(await veh.catalogos()); }
  catch (error) { res.status(500).json({ status: 'error', msg: error.message }); }
});

// ---------- escritura ----------

router.post('/api/vehiculo', async (req, res) => {
  try {
    const id = await veh.crear(req.body || {}, await actor.idDe(req));
    console.log(`🚗 [VEHICULOS] Alta: ${(req.body || {}).matricula} (id ${id})`);
    res.json({ status: 'ok', id });
  } catch (error) {
    console.error('❌ [VEHICULOS] POST:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

router.put('/api/vehiculo/:id', async (req, res) => {
  try {
    await veh.actualizar(Number(req.params.id), req.body || {}, await actor.idDe(req));
    console.log(`✏️  [VEHICULOS] Actualizado ${req.params.id}`);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('❌ [VEHICULOS] PUT:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

router.delete('/api/vehiculo/:id', async (req, res) => {
  try {
    await veh.darDeBaja(Number(req.params.id), await actor.idDe(req));
    console.log(`🗑️  [VEHICULOS] Baja del vehículo ${req.params.id}`);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('❌ [VEHICULOS] DELETE:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// ---------- Mapon ----------
// Solo se LEE de Mapon; lo único que se escribe es en nuestra base.

router.get('/api/mapon/simular', async (req, res) => {
  try { res.json({ status: 'ok', ...(await require('../services/sincroMapon').enlazar({ soloVer: true })) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/api/mapon/sincronizar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await require('../services/sincroMapon').diaria()) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
