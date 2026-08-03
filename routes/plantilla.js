const express = require('express');
const ExcelJS = require('exceljs');
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
    // Baja Empresa). SS (nombre) e ID_BOLT separados; la ETT es su propia columna. ---
    const conductores = (tablero && tablero.conductores) || [];
    const coches = (tablero && tablero.coches) || [];
    const DIAS_LIB = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    // Zona(s) de cada conductor: de los coches donde está asignado.
    const zonaPorId = new Map();
    coches.forEach(co => (co.personas || []).forEach(p => {
      const z = (co.zona || '').trim();
      if (!p.id || !z) return;
      if (!zonaPorId.has(p.id)) zonaPorId.set(p.id, new Set());
      zonaPorId.get(p.id).add(z);
    }));
    const libranzasDe = c => (c.libra || []).map((rest, i) => rest ? DIAS_LIB[i] : '').filter(Boolean).join(' ');
    const soloHoras = contrato => (contrato || '').replace(/\s*ETT/i, '').trim();   // "40h ETT" → "40h"

    const activosRaw = conductores.filter(c => c.idBolt && c.estado !== ESTADO_BAJA_EMPRESA);
    const activos = activosRaw.map(c => ({
      id: c.idBolt, nombreSS: c.nombre || '', turno: c.turno || '', telefono: c.telefono || '',
      contrato: soloHoras(c.contrato), ett: /ETT/i.test(c.contrato || ''),
      estado: c.estadoCalculado || c.estado || '',
      libranzas: libranzasDe(c), zona: [...(zonaPorId.get(c.idBolt) || [])].join(', ')
    })).sort((a, b) => (a.nombreSS || a.id).localeCompare(b.nombreSS || b.id, 'es'));

    // Resumen por contrato completo (con la ETT), para los chips del desglose.
    const resumen = {};
    activosRaw.forEach(c => { const k = (c.contrato || '').trim() || '(sin contrato)'; resumen[k] = (resumen[k] || 0) + 1; });
    const ettTotal = activosRaw.filter(c => /ETT/i.test(c.contrato || '')).length;

    // --- 3. Bajas: fichas archivadas en CONDUCTORES_OUT ---
    const bajas = ((out && out.fichas) || [])
      .map(f => ({
        id: f.id, nombreSS: f.nombre || '', turno: f.turno || '', telefono: f.telefono || '',
        contrato: soloHoras(f.contrato), ett: /ETT/i.test(f.contrato || ''),
        estado: f.estado || '', fechaAlta: f.fechaAlta || '', fechaBaja: f.fechaBaja || ''
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

// Exporta a Excel las filas (ya filtradas en el cliente) con las columnas dadas.
router.post('/excel', async (req, res) => {
  try {
    const b = req.body || {};
    const columnas = Array.isArray(b.columnas) ? b.columnas : [];
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!columnas.length) throw new Error('Sin columnas');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Plantilla');
    ws.columns = columnas.map(c => ({ header: String(c.label || c.key), key: String(c.key), width: 22 }));
    filas.forEach(f => ws.addRow(f));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle' };

    const buffer = await wb.xlsx.writeBuffer();
    const nombre = String(b.titulo || 'plantilla').replace(/[^\w\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ [Plantilla] /excel:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
