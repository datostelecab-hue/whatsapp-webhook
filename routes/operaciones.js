const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { TIPOS, UMBRAL, MAX_DIAS, leerAlertas, listarSetups, leerKmPorDia, leerCombustible } = require('../services/mapon');

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

// ── Auditoría de flota: repostajes/caídas de combustible y km diarios ─────────

router.get('/auditoria', (req, res) => {
  res.render('auditoriaFlota', {
    titulo: 'Auditoría de flota', seccion: 'auditoria', layout: 'layout-gestion',
    maxDias: MAX_DIAS
  });
});

// Km por matrícula y día natural (varias llamadas troceadas: puede tardar unos segundos).
router.get('/api/km', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const r = await leerKmPorDia({ desde, hasta });
    console.log(`🛣️  [OPERACIONES] km/día: ${r.filas.length} vehículos · ${r.dias.length} días`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/km:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Repostajes, caídas de nivel y resumen de combustible por vehículo.
router.get('/api/combustible', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const r = await leerCombustible({ desde, hasta });
    console.log(`⛽ [OPERACIONES] combustible: ${r.eventos.length} eventos · ${r.resumen.length} vehículos`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/combustible:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Excel de la auditoría: KM por día (matriz), Repostajes y Resumen combustible.
router.get('/auditoria/excel', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const [km, comb] = await Promise.all([
      leerKmPorDia({ desde, hasta }),
      leerCombustible({ desde, hasta })
    ]);
    const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

    const wb = new ExcelJS.Workbook();

    const wsKm = wb.addWorksheet('KM por día');
    wsKm.columns = [
      { header: 'Matrícula', key: 'mat', width: 14 },
      { header: 'Vehículo', key: 'veh', width: 22 },
      ...km.dias.map(d => ({ header: ddmm(d), key: d, width: 9 })),
      { header: 'Total km', key: 'total', width: 11 },
      { header: 'Viajes', key: 'viajes', width: 9 }
    ];
    km.filas.forEach(f => wsKm.addRow({ mat: f.matricula, veh: f.vehiculo, ...f.km, total: f.total, viajes: f.viajes }));
    wsKm.getRow(1).font = { bold: true };

    const wsEv = wb.addWorksheet('Repostajes y caídas');
    wsEv.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 8 },
      { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Evento', key: 'tipo', width: 12 },
      { header: 'Litros', key: 'litros', width: 9 }, { header: 'Nivel antes', key: 'antes', width: 11 },
      { header: 'Lugar', key: 'lugar', width: 45 }, { header: 'Fuente', key: 'fuente', width: 8 }
    ];
    comb.eventos.forEach(e => wsEv.addRow({
      fecha: e.fecha, hora: e.hora, mat: e.matricula,
      tipo: e.tipo === 'repostaje' ? 'Repostaje' : 'Caída', litros: e.litros,
      antes: e.nivelAntes, lugar: e.direccion || (e.lat != null ? `${e.lat}, ${e.lng}` : ''), fuente: e.fuente
    }));
    wsEv.getRow(1).font = { bold: true };

    const wsRes = wb.addWorksheet('Resumen combustible');
    wsRes.columns = [
      { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Vehículo', key: 'veh', width: 22 },
      { header: 'Repostado (l)', key: 'rep', width: 13 }, { header: 'Drenado (l)', key: 'dre', width: 12 },
      { header: 'Consumido (l)', key: 'con', width: 13 }, { header: 'Consumo medio', key: 'med', width: 14 },
      { header: 'Medida', key: 'medida', width: 11 }, { header: 'Fuente', key: 'fuente', width: 8 }
    ];
    comb.resumen.forEach(r2 => wsRes.addRow({
      mat: r2.matricula, veh: r2.vehiculo, rep: r2.repostado, dre: r2.drenado,
      con: r2.consumido, med: r2.consumoMedio, medida: r2.medida, fuente: r2.fuente || 'sin datos'
    }));
    wsRes.getRow(1).font = { bold: true };

    // Nombre con los días en hora peninsular (km.desde/hasta vienen en UTC).
    const diaES = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const nombre = `auditoria-flota-${diaES(km.desde)}-a-${diaES(km.hasta)}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (error) {
    console.error('❌ [OPERACIONES] /auditoria/excel:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
