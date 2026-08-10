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
      nombre: f.nombre, dni: f.dni, primerDia: f.primerDia, horas: f.horas,
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

module.exports = router;
