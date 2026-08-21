// ============================================================
// CONDUCTORES — rutas
// ============================================================
// La plantilla, leída de PostgreSQL. Sustituye a `/plantilla`, que cruzaba tres
// hojas por nombre en JavaScript.
//
// Mismo contrato que vehículos, para que el componente `Listado` no tenga que
// aprender nada nuevo:
//   · /api/lista       → { filas, resumen }
//   · /api/ficha/:id   → la ficha entera
//
// Lo ve Tráfico y lo ve RRHH: es la misma plantilla, solo que cada uno mira una
// cosa. Tráfico quién puede conducir hoy; RRHH quién está de alta y con qué.

const express = require('express');
const router = express.Router();
const con = require('../services/repo/conductores');

router.get('/', async (req, res) => {
  let catalogos = { situaciones: [], turnos: [], tipos: [] };
  try { catalogos = await con.catalogos(); } catch (e) {
    console.error('❌ [CONDUCTORES] catálogos:', e.message);
  }
  res.render('conductores', {
    titulo: 'Conductores', seccion: 'conductores', layout: 'layout-gestion',
    catalogos,
  });
});

// `momento` deja mirar la plantilla de una fecha pasada: quién estaba de alta,
// en qué turno y en qué coche. Con las hojas esto no se podía preguntar.
const momentoDe = req => (req.query.momento || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.momento : null;

router.get('/api/lista', async (req, res) => {
  try {
    const opciones = {
      momento: momentoDe(req),
      incluirBajas: req.query.bajas === '1',
    };
    const [filas, resumen] = await Promise.all([
      con.listar(opciones),
      con.resumen(opciones),
    ]);
    res.json({ filas, resumen });
  } catch (error) {
    console.error('❌ [CONDUCTORES] /api/lista:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.get('/api/ficha/:id', async (req, res) => {
  try {
    const f = await con.ficha(Number(req.params.id), { momento: momentoDe(req) });
    if (!f) return res.status(404).json({ status: 'error', msg: 'No existe ese conductor' });
    res.json(f);
  } catch (error) {
    console.error('❌ [CONDUCTORES] /api/ficha:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Cuentas de BOLT sin dueño: es la lista que se ofrece para enlazar a mano.
router.get('/api/bolt-libres', async (req, res) => {
  try { res.json({ cuentas: await con.boltLibres() }); }
  catch (error) { res.status(500).json({ status: 'error', msg: error.message }); }
});

router.get('/api/catalogos', async (req, res) => {
  try { res.json(await con.catalogos()); }
  catch (error) { res.status(500).json({ status: 'error', msg: error.message }); }
});

module.exports = router;
