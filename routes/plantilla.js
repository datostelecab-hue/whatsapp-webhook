const express = require('express');
const router = express.Router();
const { leerTickets, contratoAgenda } = require('../services/tickets');
const { leerTablero, leerOut, ESTADO_BAJA_EMPRESA } = require('../services/planificadorV2');

// Histórico de RRHH: qué fichas/Excels se han dado de alta, la plantilla activa de
// la empresa y las bajas. La ETT siempre se discrimina (40h ETT / 32h ETT).
router.get('/', (req, res) => {
  res.render('plantilla', {
    titulo: 'Plantilla',
    seccion: 'plantilla',
    layout: 'layout-gestion'
  });
});

// dd/mm/aaaa → número comparable (aaaammdd); lo que no parsea va al final.
function claveFecha(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? Number(m[3] + m[2] + m[1]) : 0;
}

router.get('/api/datos', async (req, res) => {
  try {
    const [{ lista }, tablero, out] = await Promise.all([
      leerTickets(),
      leerTablero().catch(() => null),
      leerOut().catch(() => ({ fichas: [] }))
    ]);
    const L = lista || [];

    // --- 1. Altas por Excel: agrupa las fichas por su Excel (fecha) ---
    const grupos = new Map();
    L.filter(t => (t.excel_alta || '').toString().trim()).forEach(t => {
      const k = t.excel_alta.toString().trim();
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push({
        id: t.id, nombre: t.nombre || '', apellidos: t.apellidos || '',
        dni: t.dni || '', contrato: contratoAgenda(t), fecha_inicio: t.fecha_inicio || '',
        estado: t.estado || '', etapa: t.etapa || ''
      });
    });
    const altas = [...grupos.entries()]
      .map(([excel, fichas]) => ({ excel, total: fichas.length, fichas }))
      .sort((a, b) => claveFecha(b.excel) - claveFecha(a.excel));

    // --- 2. Plantilla activa: los conductores de la agenda (no archivados ni en
    // Baja Empresa). La ETT se ve en su contrato (40h ETT / 32h ETT). ---
    const conductores = (tablero && tablero.conductores) || [];
    const activos = conductores
      .filter(c => c.idBolt && c.estado !== ESTADO_BAJA_EMPRESA)
      .map(c => ({
        id: c.idBolt, nombre: c.nombre || c.idBolt, turno: c.turno || '',
        contrato: c.contrato || '', telefono: c.telefono || '',
        estado: c.estadoCalculado || c.estado || '', ett: /ETT/i.test(c.contrato || '')
      }))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    // Resumen por contrato (para el desglose, con la ETT separada).
    const resumen = {};
    activos.forEach(a => { const k = (a.contrato || '').trim() || '(sin contrato)'; resumen[k] = (resumen[k] || 0) + 1; });
    const ettTotal = activos.filter(a => a.ett).length;

    // --- 3. Bajas: fichas archivadas en CONDUCTORES_OUT ---
    const bajas = ((out && out.fichas) || [])
      .map(f => ({
        id: f.id, nombre: f.nombre || f.id, turno: f.turno || '',
        contrato: f.contrato || '', telefono: f.telefono || '',
        estado: f.estado || '', fechaAlta: f.fechaAlta || '', fechaBaja: f.fechaBaja || '',
        ett: /ETT/i.test(f.contrato || '')
      }))
      .sort((a, b) => claveFecha(b.fechaBaja) - claveFecha(a.fechaBaja));

    res.json({
      status: 'ok',
      altas, activos, bajas, resumen, ettTotal,
      contadores: {
        excels: altas.length,
        altas: altas.reduce((n, g) => n + g.total, 0),
        activos: activos.length,
        bajas: bajas.length
      },
      agendaError: !tablero
    });
  } catch (error) {
    console.error('❌ [Plantilla] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
