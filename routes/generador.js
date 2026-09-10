// ============================================================
// GENERADOR DE VACANTES — rutas
// ============================================================
// Dos maneras de armar el puesto que hay que cubrir:
//   · HUECO    — plazas vacías encadenadas hasta completar el contrato.
//   · RECAMBIO — se elige a quien se va y la vacante sale de lo que ocupa hoy.
// Lo que se guarda son PLAZAS reales, en PostgreSQL, y lo ve Selección.

const express = require('express');
const router = express.Router();
const gen = require('../services/generadorVacantes');
const vac = require('../services/repo/vacantes');
const actor = require('../services/repo/actor');

const quien = async req => ({ usuarioId: await actor.idDe(req) });

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req);
    res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [Generador] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('generador', {
    titulo: 'Generador de vacantes',
    seccion: 'generador',
    layout: 'layout-gestion',
  });
});

// Zonas → matrículas con huecos (para los desplegables).
router.get('/api/datos', responde(() => gen.datosGenerador()));

// Genera una propuesta de vacante a partir de zona + turno + contrato + matrícula.
router.post('/api/generar', responde(req => gen.generarVacante(req.body || {})));

// Guarda la vacante de hueco que armó Tráfico → la verá Selección.
router.post('/api/guardar', responde(async req => gen.guardar(req.body || {}, await quien(req))));

// ── Buscar recambio ─────────────────────────────────────────────────────────
// La plantilla planificada, para elegir a quién se saca. Se puede filtrar por
// nombre, matrícula o teléfono; sale ordenada por quien menos horas hace, que
// es por donde se empieza a mirar.
router.get('/api/plantilla', responde(req =>
  gen.plantillaPlanificada({ busca: req.query.q, limite: req.query.limite })
    .then(filas => ({ filas }))));

// La propuesta de recambio de una persona: sus plazas, su zona, sus libranzas y
// el contrato que sale de todo eso. No escribe nada.
router.get('/api/recambio/:conductorId', responde(req =>
  gen.propuestaRecambio(req.params.conductorId)));

// Y guardarla. Se puede quitar alguna plaza (a veces se sustituye solo una parte).
router.post('/api/recambio', responde(async req =>
  gen.guardarRecambio(req.body || {}, await quien(req))));

// Las vacantes vivas, para no salir de la pantalla a comprobar qué hay abierto.
router.get('/api/vacantes', responde(async req =>
  ({ vacantes: await vac.listar({ incluirCerradas: req.query.cerradas === '1' }) })));

// Borrar una vacante recién generada que no debería existir. Si ya tiene
// candidato o se cubrió, no se borra: se anula, que deja rastro.
router.delete('/api/vacante/:id', responde(async req =>
  vac.eliminar(req.params.id, await quien(req))));

module.exports = router;
