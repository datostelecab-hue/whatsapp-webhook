const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { TIPOS, UMBRAL, MAX_DIAS, leerAlertas, listarSetups } = require('../services/mapon');
const { cargarAuditoria } = require('../services/auditoriaFlota');

router.get('/', (req, res) => {
  res.render('operaciones', {
    titulo: 'Alertas Mapon', seccion: 'operaciones', layout: 'layout-gestion',
    tipos: TIPOS, umbral: UMBRAL, maxDias: MAX_DIAS
  });
});

router.get('/api/alertas', async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const r = await leerAlertas({ desde, hasta, tipo });
    console.log(`🛰️  [OPERACIONES] ${r.alertas.length} alertas (${tipo || 'todas'}) ${desde || '-7d'} → ${hasta || 'hoy'}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/alertas:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Diagnóstico: con qué límite está avisando Mapon ahora mismo.
router.get('/api/setups', async (req, res) => {
  try {
    res.json({ status: 'ok', setups: await listarSetups() });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/setups:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Auditoría de flota: KM (Mapon vs BOLT) + repostajes, con histórico en Sheet ──

router.get('/auditoria', (req, res) => {
  res.render('auditoriaFlota', {
    titulo: 'Auditoría de flota', seccion: 'auditoria', layout: 'layout-gestion',
    maxDias: MAX_DIAS
  });
});

// Datos de la auditoría del rango (se sirven del histórico; solo hoy+ayer tocan las APIs).
router.get('/api/auditoria', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const r = await cargarAuditoria({ desde, hasta });
    console.log(`📊 [OPERACIONES] auditoría: ${r.km.length} matrículas · ${r.eventos.length} repostajes · ` +
      `${r.dias.length} días · ${r.refrescados} refrescados`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/auditoria:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Excel de la auditoría (mismos datos cacheados): KM (Mapon/BOLT/dif), Repostajes y Ofensores.
router.get('/auditoria/excel', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const r = await cargarAuditoria({ desde, hasta });
    const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const wb = new ExcelJS.Workbook();

    // Hoja KM: una fila por matrícula con Mapon, BOLT, diferencia y % en vacío + días.
    const wsKm = wb.addWorksheet('KM Mapon vs BOLT');
    wsKm.columns = [
      { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Vehículo', key: 'veh', width: 20 },
      { header: 'KM Mapon', key: 'mapon', width: 11 }, { header: 'KM BOLT', key: 'bolt', width: 11 },
      { header: 'Diferencia', key: 'diff', width: 11 }, { header: '% vacío', key: 'pct', width: 9 },
      { header: 'Viajes', key: 'viajes', width: 8 },
      ...r.dias.map(d => ({ header: ddmm(d), key: 'd_' + d, width: 8 }))
    ];
    r.km.forEach(k => {
      const fila = { mat: k.matricula, veh: k.vehiculo, mapon: k.totalMapon, bolt: k.totalBolt,
        diff: k.diff, pct: k.pct == null ? '' : k.pct / 100, viajes: k.viajesBolt };
      r.dias.forEach(d => {
        const m = k.mapon[d], b = k.bolt[d];
        fila['d_' + d] = (m != null || b != null) ? `${m || 0}/${b || 0}` : '';   // Mapon/BOLT
      });
      wsKm.addRow(fila);
    });
    wsKm.getColumn('pct').numFmt = '0%';
    wsKm.getRow(1).font = { bold: true };

    const wsEv = wb.addWorksheet('Repostajes y caídas');
    wsEv.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 8 },
      { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Evento', key: 'tipo', width: 12 },
      { header: 'Litros', key: 'litros', width: 9 }, { header: 'Nivel antes', key: 'antes', width: 11 },
      { header: 'Lugar', key: 'lugar', width: 45 }, { header: 'Fuente', key: 'fuente', width: 8 }
    ];
    r.eventos.forEach(e => wsEv.addRow({
      fecha: ddmm(e.dia) + '/' + e.dia.slice(0, 4), hora: e.hora, mat: e.matricula,
      tipo: e.tipo === 'repostaje' ? 'Repostaje' : 'Caída', litros: e.litros,
      antes: e.nivelAntes, lugar: e.direccion || (e.lat != null ? `${e.lat}, ${e.lng}` : ''), fuente: e.fuente
    }));
    wsEv.getRow(1).font = { bold: true };

    const wsTop = wb.addWorksheet('Ofensores');
    wsTop.addRow(['TOP 5 — más KM sin facturar (Mapon − BOLT)']);
    wsTop.addRow(['Matrícula', 'KM Mapon', 'KM BOLT', 'Diferencia', '% vacío']);
    r.ofensores.kmDiff.forEach(o => wsTop.addRow([o.matricula, o.totalMapon, o.totalBolt, o.diff, o.pct == null ? '' : o.pct + '%']));
    wsTop.addRow([]);
    wsTop.addRow(['TOP 5 — más repostan']);
    wsTop.addRow(['Matrícula', 'Litros', 'Repostajes']);
    r.ofensores.repostaje.forEach(o => wsTop.addRow([o.matricula, o.litros, o.veces]));
    wsTop.getColumn(1).width = 16;
    [wsTop.getRow(1), wsTop.getRow(2), wsTop.getRow(r.ofensores.kmDiff.length + 4), wsTop.getRow(r.ofensores.kmDiff.length + 5)].forEach(f => f.font = { bold: true });

    const diaES = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const nombre = `auditoria-flota-${diaES(r.desde)}-a-${diaES(r.hasta)}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (error) {
    console.error('❌ [OPERACIONES] /auditoria/excel:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
