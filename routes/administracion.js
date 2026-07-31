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
    let padron = null, porTelPadron = null;
    try {
      padron = (await leerPadron()).db;
      porTelPadron = new Map();
      const l9 = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
      padron.forEach(d => { const t = l9(d.phone); if (t.length === 9 && !porTelPadron.has(t)) porTelPadron.set(t, d); });
    } catch (_) { /* sin padrón: se usa lo capturado / la ficha */ }
    // Nombre tal como sale en BOLT (= ID_BOLT), por orden de fiabilidad:
    //  1) el capturado al detectarlo,  2) el padrón por driver_uuid,  3) por teléfono.
    const l9 = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
    const nombreBolt = t => {
      if ((t.id_bolt || '').trim()) return t.id_bolt.trim();
      let d = padron && t.driver_uuid ? padron.get(t.driver_uuid) : null;
      if (!d && porTelPadron) d = porTelPadron.get(l9(t.id));
      if (d && (d.nombre || '').trim()) return d.nombre.trim();
      return '';   // vacío → Administración lo teclea (tiene BOLT abierto)
    };
    // Datos que Administración copia para solicitar el PIN a Ballenoil.
    const map = t => ({
      id: t.id, nombre: nombreBolt(t), apellidos: '',
      ficha: `${t.nombre || ''}${t.apellidos ? ' ' + t.apellidos : ''}`.trim(),
      dni: t.dni || '', email: t.email || '', telefono: t.id,
      turno: t.turno || '', fecha_alta: t.fecha_alta || '',
      obs_ballenoil: t.obs_ballenoil || '', pin_ballenoil: t.pin_ballenoil || ''
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
    const t = await crearPinAdmin(b.tel, b.pin, b.id_bolt, b.obs_ballenoil);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
