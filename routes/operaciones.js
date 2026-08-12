const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { TIPOS, UMBRAL, MAX_DIAS, leerAlertas, listarSetups } = require('../services/mapon');
const auditoria = require('../services/auditoriaFlota');
const { cargarAuditoria } = auditoria;

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

// Procesa (o reprocesa) un rango de días: es PESADO — una llamada a Mapon por coche y
// día —, así que corre en segundo plano y el panel sondea el progreso. Lo normal es que
// lo haga el cron de las 5am; esto es para backfill o para rehacer un día concreto.
router.post('/auditoria/procesar', (req, res) => {
  try {
    const b = req.body || {};
    if (auditoria.progreso().activo) return res.status(409).json({ status: 'error', msg: 'Ya hay un procesado en marcha' });
    auditoria.procesarRango({ desde: b.desde, hasta: b.hasta }).catch(e => console.error('❌ [AUDITORÍA] procesar:', e.message));
    res.json({ status: 'ok', msg: 'Procesado iniciado' });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

router.get('/auditoria/procesar/estado', (req, res) => res.json({ status: 'ok', progreso: auditoria.progreso() }));

// Excel de la auditoría (mismos datos cacheados): KM (Mapon/BOLT/dif), Repostajes y Ofensores.
router.get('/auditoria/excel', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const r = await cargarAuditoria({ desde, hasta });
    const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const wb = new ExcelJS.Workbook();

    // Hoja KM: desglose forense por matrícula (los 4 buckets suman el total de Mapon).
    const wsKm = wb.addWorksheet('KM por estado');
    wsKm.columns = [
      { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Vehículo', key: 'veh', width: 20 },
      { header: 'KM total (Mapon)', key: 'mapon', width: 16 },
      { header: 'Con pasajero', key: 'pas', width: 13 }, { header: 'Ida a recoger', key: 'ida', width: 13 },
      { header: 'Cruising (BOLT abierto)', key: 'cru', width: 21 }, { header: 'FUERA (BOLT cerrado)', key: 'fue', width: 19 },
      { header: '% fuera', key: 'pctf', width: 9 }, { header: '% con pasajero', key: 'pctp', width: 14 },
      { header: 'KM facturado BOLT', key: 'bolt', width: 17 }, { header: 'Viajes', key: 'viajes', width: 8 }
    ];
    r.km.forEach(k => wsKm.addRow({
      mat: k.matricula, veh: k.vehiculo, mapon: k.totalMapon, pas: k.totalPasajero, ida: k.totalIda,
      cru: k.totalCruising, fue: k.totalFuera,
      pctf: k.pctFuera == null ? '' : k.pctFuera / 100, pctp: k.pctPasajero == null ? '' : k.pctPasajero / 100,
      bolt: k.totalBolt, viajes: k.viajesBolt
    }));
    wsKm.getColumn('pctf').numFmt = '0%';
    wsKm.getColumn('pctp').numFmt = '0%';
    wsKm.getRow(1).font = { bold: true };

    // Detalle día a día (para poder señalar la jornada concreta en una reclamación).
    const wsDia = wb.addWorksheet('Detalle por día');
    wsDia.columns = [
      { header: 'Día', key: 'dia', width: 12 }, { header: 'Matrícula', key: 'mat', width: 14 },
      { header: 'KM total', key: 'mapon', width: 10 }, { header: 'Con pasajero', key: 'pas', width: 13 },
      { header: 'Ida a recoger', key: 'ida', width: 13 }, { header: 'Cruising', key: 'cru', width: 11 },
      { header: 'FUERA', key: 'fue', width: 10 }, { header: 'Facturado BOLT', key: 'bolt', width: 14 }
    ];
    r.km.forEach(k => r.dias.forEach(d => {
      const x = k.dias[d]; if (!x) return;
      wsDia.addRow({ dia: ddmm(d) + '/' + d.slice(0, 4), mat: k.matricula, mapon: x.mapon,
        pas: x.pasajero, ida: x.ida, cru: x.cruising, fue: x.fuera, bolt: x.bolt });
    }));
    wsDia.getRow(1).font = { bold: true };

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
    wsTop.addRow(['TOP 5 — más KM con BOLT CERRADO (km "por fuera")']);
    wsTop.addRow(['Matrícula', 'KM fuera', '% del total', 'KM total (Mapon)']);
    r.ofensores.fuera.forEach(o => wsTop.addRow([o.matricula, o.fuera, o.pct == null ? '' : o.pct + '%', o.mapon]));
    const corte = r.ofensores.fuera.length + 4;
    wsTop.addRow([]);
    wsTop.addRow(['TOP 5 — más repostan']);
    wsTop.addRow(['Matrícula', 'Litros', 'Repostajes']);
    r.ofensores.repostaje.forEach(o => wsTop.addRow([o.matricula, o.litros, o.veces]));
    wsTop.getColumn(1).width = 16;
    [wsTop.getRow(1), wsTop.getRow(2), wsTop.getRow(corte), wsTop.getRow(corte + 1)].forEach(f => f.font = { bold: true });

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
