const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const tk = require('../services/ticketsRRHH');

// El usuario en sesión (para la trazabilidad: quién asigna / resuelve / aplica).
const emailDe = req => (req.usuario && req.usuario.email) || '';

router.get('/', (req, res) => {
  res.render('ticketera', { titulo: 'Ticketera RRHH', seccion: 'ticketera', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { pendientes, resueltos } = await tk.leerTicketera();
    const cuenta = (lista, campo) => lista.reduce((m, t) => { const k = (t[campo] || '').trim() || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
    res.json({
      status: 'ok',
      pendientes, resueltos,
      contadores: {
        pendientes: pendientes.length,
        resueltos: resueltos.length,
        afectaPlanning: pendientes.filter(t => /^s/i.test((t.afecta_planning || '').trim())).length
      },
      porSubtipo: cuenta(pendientes, 'subtipo'),
      porEstado: cuenta(pendientes, 'estado')
    });
  } catch (error) {
    console.error('❌ [Ticketera] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Exporta a Excel las filas (ya filtradas en el cliente) con las columnas dadas.
router.post('/excel', async (req, res) => {
  try {
    const b = req.body || {};
    const columnas = Array.isArray(b.columnas) ? b.columnas : [];
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!columnas.length) throw new Error('Sin columnas');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tickets');
    ws.columns = columnas.map(c => ({ header: String(c.label || c.key), key: String(c.key), width: 24 }));
    filas.forEach(f => ws.addRow(f));
    ws.getRow(1).font = { bold: true };
    const buffer = await wb.xlsx.writeBuffer();
    const nombre = String(b.titulo || 'tickets_rrhh').replace(/[^\w\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ [Ticketera] /excel:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ---- Acciones (escriben en TICKETS_RRHH; requieren que la hoja sea nativa) ----
router.post('/asignar', async (req, res) => {
  try {
    const b = req.body || {};
    const email = (b.email || '').toString().trim() || emailDe(req);   // sin email → autoasignación
    await tk.asignar(b.ticketId, email);
    res.json({ status: 'ok', email });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/estado', async (req, res) => {
  try {
    const b = req.body || {};
    await tk.cambiarEstado(b.ticketId, b.estado);
    res.json({ status: 'ok', estado: (b.estado || '').toString().trim() });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/observaciones', async (req, res) => {
  try {
    const b = req.body || {};
    await tk.guardarObservaciones(b.ticketId, b.texto);
    res.json({ status: 'ok' });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/resolver', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await tk.resolver(b.ticketId, { usuario: emailDe(req), estado: b.estado, observaciones: b.observaciones });
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Aplica un ticket de Vacaciones / Baja / Permiso al planificador (vía Peticiones).
router.post('/aplicar-planificador', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await tk.aplicarAlPlanificador(b.ticketId, {
      usuario: emailDe(req), desde: b.desde, hasta: b.hasta, motivo: b.motivo, tipo: b.tipo
    });
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
