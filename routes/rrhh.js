const express = require('express');
const router = express.Router();
const {
  leerTickets, procesarAltaRRHH, noContinuarRRHH, devolverRRHH, ESTADOS
} = require('../services/tickets');
const { generarAltasExcel } = require('../services/altasExcel');

// Tablero de RRHH: recibe los "Aprobado en BOLT" y tramita el alta.
router.get('/', (req, res) => {
  res.render('rrhh', {
    titulo: 'RRHH',
    seccion: 'rrhh',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const porTramitar = lista.filter(t => t.estado === ESTADOS.APROBADO_BOLT);
    const altas = lista.filter(t => t.estado === ESTADOS.ALTA);
    const noAlta = lista.filter(t => t.estado === ESTADOS.NO_ALTA);
    res.json({
      status: 'ok', porTramitar, altas, noAlta,
      contadores: { porTramitar: porTramitar.length, altas: altas.length, noAlta: noAlta.length }
    });
  } catch (error) {
    console.error('❌ [RRHH] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Tramitar el alta → crea la ficha en AGENDA_V2 (Pendiente Asignar) y pasa a Tráfico.
router.post('/alta', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await procesarAltaRRHH(b.tel, {
      fecha_alta: b.fecha_alta, fecha_habilitado: b.fecha_habilitado
    });
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// RRHH decide no continuar con el alta.
router.post('/no-continuar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await noContinuarRRHH(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// RRHH devuelve la ficha a Selección (Rechazado RRHH) con el motivo.
router.post('/devolver', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await devolverRRHH(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Genera el Excel de Altas para un grupo de fichas + una fecha elegidos por RRHH.
router.post('/altas-excel', async (req, res) => {
  try {
    const { tels, fecha } = req.body || {};
    if (!Array.isArray(tels) || !tels.length) {
      return res.status(400).json({ status: 'error', msg: 'No hay fichas seleccionadas' });
    }
    const { lista } = await leerTickets();
    const pedidos = new Set(tels.map(t => String(t)));
    const fichas = (lista || []).filter(t => pedidos.has(String(t.id)));
    if (!fichas.length) return res.status(400).json({ status: 'error', msg: 'No se encontraron esas fichas' });

    const buffer = await generarAltasExcel(fichas, fecha);
    const etiqueta = String(fecha || '').replace(/[\/]/g, '-') || 'grupo';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Altas ${etiqueta}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ [RRHH] altas-excel:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
