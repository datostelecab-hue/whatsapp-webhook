const express = require('express');
const router = express.Router();
const { leerTickets, crearPinAdmin, ESTADOS, ETAPAS } = require('../services/tickets');
const { leerPadron } = require('../services/conductoresBolt');

// Tablero de Administración: recibe las fichas que RRHH ya dio de alta y que
// esperan el PIN de Ballenoil (último paso antes del planificador).
router.get('/', (req, res) => {
  res.render('administracion', {
    titulo: 'Administración',
    seccion: 'administracion',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    // El padrón de BOLT, para copiar el NOMBRE tal cual sale en BOLT (es lo que
    // Administración necesita, junto al teléfono y el correo, para pedirle el PIN
    // a Ballenoil). Si el padrón falla, se usa el nombre de la ficha.
    let padron = null;
    try { padron = (await leerPadron()).db; } catch (_) { /* sin padrón: fallback */ }
    const nombreBolt = t => {
      const d = padron && t.driver_uuid ? padron.get(t.driver_uuid) : null;
      if (d && (d.nombre || '').trim()) return d.nombre.trim();
      return `${t.nombre || ''}${t.apellidos ? ' ' + t.apellidos : ''}`.trim() || t.nombre || '';
    };
    // Datos que Administración copia para solicitar el PIN a Ballenoil.
    const map = t => ({
      id: t.id, nombre: nombreBolt(t), apellidos: '',
      email: t.email || '', telefono: t.id,
      turno: t.turno || '', fecha_alta: t.fecha_alta || '',
      pin_ballenoil: t.pin_ballenoil || ''
    });
    const pendientes = lista.filter(t => t.etapa === ETAPAS.ADMINISTRACION).map(map);
    // Historial: fichas que ya tienen PIN (ya pasaron a Tráfico/planificador).
    const hechos = lista.filter(t => (t.pin_ballenoil || '').toString().trim()).map(map);
    res.json({
      status: 'ok', pendientes, hechos,
      contadores: { pendientes: pendientes.length, hechos: hechos.length }
    });
  } catch (error) {
    console.error('❌ [Administración] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Guarda el PIN de Ballenoil → crea la ficha en AGENDA_V2 y pasa a Tráfico.
router.post('/pin', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await crearPinAdmin(b.tel, b.pin);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
