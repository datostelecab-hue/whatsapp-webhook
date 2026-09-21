// ============================================================
// VEHÍCULOS — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio y su respuesta a JSON. Nada más: aquí no
// se decide nada. Todo pasa por `vehiculos.service`, que es la puerta del
// módulo; el repositorio no se toca desde aquí.
//
// Los datos salen de PostgreSQL. Antes esto tiraba de la hoja VEHICULOS, que
// además estaba vacía: el maestro real se reconstruyó desde el planificador
// durante la migración.
//
// Las rutas son las que espera el componente `Listado`:
//   · /api/lista       → todo lo que la tabla necesita, en una llamada
//   · /api/ficha/:id   → la ficha de uno solo, cuando se pincha
//
// Es el mismo par que usarán conductores, sanciones y las demás pantallas de
// listado, así que conviene que la forma no cambie de un módulo a otro.

const express = require('express');
const router = express.Router();
// Por el SERVICIO, que es la puerta del modulo. Ni este controlador ni nadie de
// fuera llama al repositorio: ver vehiculos.service.js.
const veh = require('./vehiculos.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');
const facturas = require('./facturas.service');

router.get('/', async (req, res) => {
  let catalogos = { estados: [], zonas: [], sedes: [] };
  try { catalogos = await veh.catalogos(); } catch (e) {
    console.error('❌ [VEHICULOS] catálogos:', e.message);
  }
  res.render('vehiculos', {
    titulo: 'Vehículos', seccion: 'vehiculos', layout: 'layout-gestion',
    estadosVehiculo: catalogos.estados, zonas: catalogos.zonas, sedes: catalogos.sedes,
    // Solo quien ve las DOS sedes necesita una columna que las distinga: a quien
    // ve Madrid entero, una columna con "Madrid" en las 89 filas no le dice nada.
    verTodasLasSedes: (await sedesDe(req)).length > 1,
  });
});

// ---------- lectura ----------

// La lista y los contadores viajan juntos: son una sola pantalla y así no se
// pintan desincronizados.
/**
 * Las sedes que ve quien pregunta. El sistema se usa en Madrid: quien no tenga
 * '/vehiculos/sedes' ve solo Madrid, que es lo que Óscar controla. Ante
 * cualquier fallo, Madrid — nunca de más.
 */
async function sedesDe(req) {
  const u = req.usuario || {};
  if (['superadmin', 'desarrollador'].includes(u.rol)) return facturas.SEDES;
  try {
    const id = (u && u.id) || await actor.idDe(req);
    const claves = id ? await permisos.clavesDe(id) : null;
    return claves && claves.has('/vehiculos/sedes') ? facturas.SEDES : [facturas.SEDE_POR_DEFECTO];
  } catch (_) { return [facturas.SEDE_POR_DEFECTO]; }
}

router.get('/api/lista', async (req, res) => {
  try {
    const sedes = await sedesDe(req);
    const [filas, resumen] = await Promise.all([
      veh.listar({ incluirBajas: req.query.bajas === '1', sedes }),
      veh.resumen(sedes),
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
  try { res.json({ status: 'ok', ...(await veh.enlazar({ soloVer: true })) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/api/mapon/sincronizar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await veh.diaria()) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
