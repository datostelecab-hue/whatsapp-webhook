// ============================================================
// CONVENIO (RRHH) — rutas
// ============================================================
// La interfaz del modulo de convenio: el panel de jornada del mes y la ficha
// del trabajador. El acceso lo controla `controlAcceso` por el prefijo /convenio
// (rol oficina + los admin totales), como el resto de RRHH. La ruta es fina:
// pide al servicio, que solo lee de PostgreSQL.
const express = require('express');
const router = express.Router();
const convenio = require('../services/repo/convenio');

router.get('/', async (req, res) => {
  // El mes de arranque (el ultimo con objetivos) se resuelve aqui para que el
  // selector y la primera carga ya salgan en el mes correcto, sin un parpadeo.
  const mes = await convenio.mesPorDefecto().catch(() => {
    const h = new Date(); return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  res.render('convenio', {
    titulo: 'Convenio · Jornada', seccion: 'convenio', layout: 'layout-gestion',
    anioInicial: mes.anio, mesInicial: mes.mes,
  });
});

const responder = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
};

// Un mes valido, o el que toca por defecto (el ultimo con objetivos).
async function mesDe(req) {
  const a = parseInt(req.query.anio, 10), m = parseInt(req.query.mes, 10);
  if (a >= 2024 && a <= 2100 && m >= 1 && m <= 12) return { anio: a, mes: m };
  return convenio.mesPorDefecto();
}

// El panel: los trabajadores con la cuenta del mes.
router.get('/api/trabajadores', responder(async req => {
  const { anio, mes } = await mesDe(req);
  return { mes: { anio, mes }, filas: await convenio.trabajadores(anio, mes) };
}));

// La ficha de un trabajador (por conductor_id).
router.get('/api/ficha/:id', responder(async req => ({ ficha: await convenio.ficha(req.params.id) })));

module.exports = router;
