const express = require('express');
const router = express.Router();
const { leerTickets, ESTADOS, ETAPAS } = require('../services/tickets');
const { leerVacantesGuardadas } = require('../services/vacantes');
const { resolver } = require('../services/incorporaciones');

// Incorporaciones de Tráfico: conductores que llegaron de Administración (creados
// en la agenda como Pendiente Asignar) esperando que Tráfico los coloque.
router.get('/', (req, res) => {
  res.render('incorporaciones', { titulo: 'Incorporaciones', seccion: 'incorporaciones', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const [{ lista }, vacantes] = await Promise.all([leerTickets(), leerVacantesGuardadas().catch(() => [])]);
    const porId = new Map((vacantes || []).map(v => [v.id, v]));
    const incorporaciones = (lista || [])
      .filter(t => t.etapa === ETAPAS.TRAFICO && t.estado === ESTADOS.ALTA)
      .map(t => {
        const v = t.vacante ? porId.get(t.vacante) : null;
        return {
          tel: t.id, id_bolt: t.id_bolt || '', nombre: t.id_bolt || t.nombre || '(sin nombre)',
          turno: t.turno || '', fecha_alta: t.fecha_alta || '',
          vacante: v ? {
            id: v.id, puesto: v.puesto || '', turno: v.turno || '', libranzas: v.libranzas || '',
            matriculas: (v.matriculas || []).map(m => ({ m: m.m, letras: m.letras || '', zona: m.zona || '' }))
          } : null
        };
      });
    res.json({ status: 'ok', incorporaciones });
  } catch (error) {
    console.error('❌ [Incorporaciones] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

router.post('/aceptar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await resolver((req.body || {}).tel, 'aceptar')) }); }
  catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});
router.post('/manual', async (req, res) => {
  try { res.json({ status: 'ok', ...(await resolver((req.body || {}).tel, 'manual')) }); }
  catch (error) { res.status(400).json({ status: 'error', msg: error.message }); }
});

module.exports = router;
