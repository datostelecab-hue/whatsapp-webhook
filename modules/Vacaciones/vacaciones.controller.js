// ============================================================
// VACACIONES — rutas
// ============================================================
// Mirar los saldos es '/vacaciones'. Poner o borrar unas vacaciones sigue
// siendo de Plantilla, con la llave de aprobar (una sola persona, db/189).
// CAMBIAR las fechas de unas ya aprobadas, solo a futuro, se puede también desde
// aquí (16/10/2026), con la misma llave: la exige el servicio, no la pantalla.

const express = require('express');
const router = express.Router();
const vacaciones = require('./vacaciones.service');
const aprobarVac = require('../../services/aprobarVacaciones');
const actor = require('../../services/repo/actor');

// Quién hace el cambio: lo apunta la historia del ticket.
const quien = async req => ({
  usuarioId: await actor.idDe(req),
  nombre: [(req.usuario || {}).nombre, (req.usuario || {}).apellidos].filter(Boolean).join(' ').trim(),
});

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Vacaciones]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  res.render('vacaciones', {
    titulo: 'Vacaciones', seccion: 'vacaciones', layout: 'layout-gestion',
    reglas: { tasa: vacaciones.TASA, desde: vacaciones.DESDE_HISTORICO, umbralHoras: vacaciones.UMBRAL_FESTIVO / 3600,
      umbralLaborado: vacaciones.UMBRAL_LABORADO / 3600, apPorAnio: vacaciones.AP_POR_ANIO,
      festivosPagadosHasta: vacaciones.FESTIVOS_PAGADOS_HASTA },
    // Solo para enseñar o no el botón de cambiar: lo que manda es el servidor.
    aprueba: await aprobarVac.paraLaPantalla((req.usuario || {}).id),
  });
});

router.get('/api/lista', responde(() => vacaciones.lista()));

// `ficha`: es la clave que busca el componente Listado.
router.get('/api/ficha/:id', responde(async req => ({ ficha: await vacaciones.ficha(req.params.id) })));

// Simular unas vacaciones (06/11/2026): qué días cuentan y cuáles libra. No guarda nada.
router.get('/api/simular/:id', responde(async req => ({ simulacion: await vacaciones.simular(req.params.id, req.query || {}) })));

// Cambiar unas vacaciones ya aprobadas: solo lo que aún no ha llegado.
// Lo que libra según el planificador, para proponer los dos días a mano (db/233).
router.get('/api/libranzas/:id', responde(async req => ({ libranzas: await vacaciones.libranzasSugeridas(req.params.id, req.query.desde) })));

router.put('/api/conductor/:id/vacaciones/:filaId', responde(async req =>
  vacaciones.cambiarVacaciones(req.params.id, req.params.filaId, req.body || {}, await quien(req))));

module.exports = router;
