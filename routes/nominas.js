// ============================================================
// NÓMINAS EXTRAS (RRHH) — rutas
// ============================================================
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const nomina = require('../services/nominaExtras');

const validarMesAno = (mes, ano) => (mes >= 1 && mes <= 12) && (ano >= 2024 && ano <= 2100);

// Página
router.get('/', (req, res) => {
  const ahora = new Date();
  res.render('nominas', {
    titulo: 'Nóminas extras', seccion: 'nominas', layout: 'layout-gestion',
    mesActual: ahora.getMonth() + 1, anoActual: ahora.getFullYear(),
    campos: nomina.CONFIG_CAMPOS
  });
});

// Config actual (defaults + lo guardado en NOMINA_CONFIG)
router.get('/config', async (req, res) => {
  try { res.json({ status: 'ok', config: await nomina.leerConfig(), campos: nomina.CONFIG_CAMPOS }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Guardar config
router.post('/config', async (req, res) => {
  try { res.json({ status: 'ok', config: await nomina.guardarConfig((req.body && req.body.config) || req.body || {}) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Generar (PESADO: descarga Bolt del mes). Corre en segundo plano; el panel sondea /estado.
router.post('/generar', (req, res) => {
  const b = req.body || {};
  const mes = parseInt(b.mes, 10), ano = parseInt(b.ano, 10);
  if (!validarMesAno(mes, ano)) return res.status(400).json({ status: 'error', msg: 'Mes/año no válidos' });
  try {
    nomina.generarEnFondo(mes, ano, { actualizar: !(b.actualizar === false || b.actualizar === 'false') });
    res.json({ status: 'ok' });
  } catch (e) { res.status(409).json({ status: 'error', msg: e.message }); }
});

// Estado + progreso (para la barra)
router.get('/estado', (req, res) => res.json({ status: 'ok', ...nomina.estado() }));

// Recalcular con el config editado (RÁPIDO: no re-descarga, solo reaplica fórmulas)
router.post('/recalcular', async (req, res) => {
  const b = req.body || {};
  const mes = parseInt(b.mes, 10), ano = parseInt(b.ano, 10);
  if (!validarMesAno(mes, ano)) return res.status(400).json({ status: 'error', msg: 'Mes/año no válidos' });
  try { res.json({ status: 'ok', resultado: await nomina.recalcular(mes, ano, b.config) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Congelar (escribe la hoja NOMINA_mes-año inmutable, con el config usado)
router.post('/congelar', async (req, res) => {
  const b = req.body || {};
  const mes = parseInt(b.mes, 10), ano = parseInt(b.ano, 10);
  if (!validarMesAno(mes, ano)) return res.status(400).json({ status: 'error', msg: 'Mes/año no válidos' });
  try { res.json({ status: 'ok', ...(await nomina.congelar(mes, ano)) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Carga rápida SIN Bolt para la vista (al elegir mes): congelada, o snapshot recalculado.
router.get('/cargar', async (req, res) => {
  const mes = parseInt(req.query.mes, 10), ano = parseInt(req.query.ano, 10);
  if (!validarMesAno(mes, ano)) return res.status(400).json({ status: 'error', msg: 'Mes/año no válidos' });
  try { res.json({ status: 'ok', ...(await nomina.cargar(mes, ano)) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Ver una nómina ya congelada (sin recalcular)
router.get('/congelada', async (req, res) => {
  const mes = parseInt(req.query.mes, 10), ano = parseInt(req.query.ano, 10);
  if (!validarMesAno(mes, ano)) return res.status(400).json({ status: 'error', msg: 'Mes/año no válidos' });
  try { res.json({ status: 'ok', resultado: await nomina.leerCongelada(mes, ano) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Descargar en Excel (usa la congelada si existe; si no, calcula sin re-descargar)
router.get('/descargar', async (req, res) => {
  const mes = parseInt(req.query.mes, 10), ano = parseInt(req.query.ano, 10);
  if (!validarMesAno(mes, ano)) return res.status(400).send('Mes/año no válidos');
  try {
    const cong = await nomina.leerCongelada(mes, ano);
    const r = cong || await nomina.recalcular(mes, ano);
    const filas = cong ? cong.filas : r.filas;
    const nombreMes = nomina.MESES_NOM[mes - 1];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Nómina ${nombreMes} ${ano}`);
    ws.columns = [
      { header: 'Nombre', key: 'nombre', width: 34 },
      { header: 'DNI/NIE', key: 'dni', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 8 },
      { header: 'Jornada', key: 'jornada', width: 11 },
      { header: 'Desde día', key: 'primerDia', width: 10 },
      { header: 'Horas', key: 'horas', width: 9 },
      { header: 'Propinas (€)', key: 'propinas', width: 12 },
      { header: 'Peajes (€)', key: 'peajes', width: 11 },
      { header: 'Nocturnas (€)', key: 'nocturnas', width: 13 },
      { header: 'MBO FAS (€)', key: 'mboFAS', width: 12 },
      { header: 'Compensación (€)', key: 'compensacion', width: 15 },
      { header: 'Días extra', key: 'diasExtra', width: 10 },
      { header: '%Utilización', key: 'util', width: 12 },
      { header: 'TOTAL (€)', key: 'total', width: 13 }
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    filas.forEach(f => ws.addRow({
      nombre: f.nombre, dni: f.dni, tipo: f.ett ? 'ETT' : 'Tibus', jornada: f.jornada ? f.jornada + ' horas' : '',
      primerDia: f.primerDia, horas: f.horas,
      propinas: f.propinas, peajes: f.peajes, nocturnas: f.nocturnas, mboFAS: f.mboFAS,
      compensacion: f.compensacion, diasExtra: f.diasExtra,
      util: f.utilPct == null ? '' : f.utilPct / 100, total: f.total
    }));
    ['propinas', 'peajes', 'nocturnas', 'mboFAS', 'compensacion', 'total'].forEach(k => { ws.getColumn(k).numFmt = '#,##0.00 €'; });
    ws.getColumn('util').numFmt = '0.0%';
    ws.getColumn('diasExtra').numFmt = '#,##0.00';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nomina-extras-${nomina.hojaMes(mes, ano)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

/**
 * DIAGNÓSTICO de un conductor y mes: desglosa sus pedidos por estado y por flota,
 * para ver de dónde sale cada euro cuando el total no cuadra con el panel de Bolt.
 *   /nominas/diagnostico?conductor=Jose Enrique&mes=7&ano=2026
 * El mes es el de TRABAJO (julio = los datos que paga la nómina de agosto).
 */
router.get('/diagnostico', async (req, res) => {
  try {
    const mes = parseInt(req.query.mes, 10), ano = parseInt(req.query.ano, 10);
    const q = (req.query.conductor || '').toString().trim().toLowerCase();
    if (!validarMesAno(mes, ano)) return res.status(400).json({ status: 'error', msg: 'Mes/año no válidos' });
    if (!q) return res.status(400).json({ status: 'error', msg: 'Falta ?conductor=' });

    const { fetchRangoCompleto, CONFIG_BOLT } = require('../services/bolt');
    const diasDelMes = new Date(ano, mes, 0).getDate();
    const startTs = Math.floor(new Date(ano, mes - 1, 1, 0, 0, 0).getTime() / 1000);
    const endTs = Math.floor(new Date(ano, mes - 1, diasDelMes, 23, 59, 59).getTime() / 1000);
    const local = ts => new Date(ts * 1000).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

    const porEstado = {}, porFlota = {}, porDia = {};
    let total = { propinas: 0, peajes: 0, neto: 0, pedidos: 0 };
    const bordes = [];   // pedidos de los días 1 y último: los sospechosos del descuadre

    for (const f of CONFIG_BOLT.flotas) {
      const ordenes = await fetchRangoCompleto('/fleetIntegration/v1/getFleetOrders',
        { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created' },
        'orders', startTs, endTs, 1000, `diag ${f.id}`);

      ordenes.forEach(o => {
        const nombre = (o.driver_name || '').toString().toLowerCase();
        if (!nombre.includes(q)) return;
        const p = o.order_price || {};
        const tip = p.tip || 0, toll = p.toll_fee || 0, net = p.net_earnings || 0;
        const est = o.order_status || '(sin estado)';

        const acumular = (mapa, clave) => {
          mapa[clave] = mapa[clave] || { pedidos: 0, propinas: 0, peajes: 0, neto: 0 };
          mapa[clave].pedidos++; mapa[clave].propinas += tip;
          mapa[clave].peajes += toll; mapa[clave].neto += net;
        };
        acumular(porEstado, est);
        acumular(porFlota, String(f.id));

        const ts = Number(o.order_created_timestamp) || Number(o.order_accepted_timestamp) || 0;
        const dia = ts ? new Date(ts * 1000).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) : '?';
        acumular(porDia, dia);

        total.pedidos++; total.propinas += tip; total.peajes += toll; total.neto += net;

        // Los pedidos del primer y último día del mes son los que suelen explicar
        // la diferencia con Bolt (ellos cuentan cuando la tarifa es final).
        const d = ts ? new Date(ts * 1000) : null;
        if (d) {
          const diaMes = Number(d.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric' }));
          if (diaMes === 1 || diaMes === diasDelMes) {
            bordes.push({ estado: est, cuando: local(ts), propina: tip, peaje: toll, neto: +net.toFixed(2) });
          }
        }
      });
    }

    const r2 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, {
      ...v, propinas: +v.propinas.toFixed(2), peajes: +v.peajes.toFixed(2), neto: +v.neto.toFixed(2)
    }]));

    res.json({
      status: 'ok',
      conductor: q, mes, ano,
      ventana: { desde: local(startTs), hasta: local(endTs) },
      total: { ...total, propinas: +total.propinas.toFixed(2), peajes: +total.peajes.toFixed(2), neto: +total.neto.toFixed(2) },
      porEstado: r2(porEstado),
      porFlota: r2(porFlota),
      porDia: r2(porDia),
      pedidosEnLosBordesDelMes: bordes.sort((a, b) => a.cuando.localeCompare(b.cuando)),
      nota: 'Bolt registra los ingresos cuando la tarifa es FINAL; aquí se filtra por fecha de creación del viaje. ' +
            'El dinero se suma de TODOS los pedidos, sin filtrar por estado: mira "porEstado" para ver si alguno no debería contar.'
    });
  } catch (e) {
    console.error('❌ [NÓMINAS] /diagnostico:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
