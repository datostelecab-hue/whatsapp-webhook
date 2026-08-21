// ============================================================
// EXPORTAR — cualquier tabla a Excel
// ============================================================
// Venía de `/plantilla/excel`, donde estaba atado a una pantalla aunque el
// código no tenía nada de ella: recibe filas y columnas y devuelve un .xlsx.
//
// Aquí es de todos. El componente `Listado` lo usa para cualquier listado, así
// que exportar deja de ser algo que hay que volver a programar en cada módulo.
//
// Se exporta lo que el usuario está VIENDO —ya filtrado y ordenado en el
// cliente— y no lo que hay en la base: quien filtra por "fichas incompletas" y
// exporta espera esas filas, no las mil de la tabla entera.

const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();

// Una tabla grande enviada como JSON puede pasarse del límite global.
router.use(express.json({ limit: '12mb' }));

const LIMITE_FILAS = 20000;

router.post('/excel', async (req, res) => {
  try {
    const b = req.body || {};
    const columnas = Array.isArray(b.columnas) ? b.columnas : [];
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!columnas.length) throw new Error('No se ha dicho qué columnas exportar');
    if (filas.length > LIMITE_FILAS) {
      throw new Error(`Son ${filas.length} filas y el máximo es ${LIMITE_FILAS}. Filtra un poco antes de exportar.`);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Telecab';
    wb.created = new Date();
    const hoja = String(b.titulo || 'Datos').slice(0, 30).replace(/[\\/*?:[\]]/g, '');
    const ws = wb.addWorksheet(hoja || 'Datos');

    ws.columns = columnas.map(c => ({
      header: String(c.label || c.titulo || c.key || c.campo),
      key: String(c.key || c.campo),
      // Un ancho fijo deja truncados los nombres largos; se estima por la
      // cabecera y se acota, que es lo que hace legible la hoja al abrirla.
      width: Math.min(48, Math.max(12, String(c.label || c.titulo || c.key || '').length + 6)),
    }));

    filas.forEach(f => ws.addRow(f));

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle' };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E7C4' } };
    // Cabecera congelada y autofiltro: con doscientas filas es lo primero que
    // hace cualquiera nada más abrir el fichero.
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (filas.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const nombre = String(b.titulo || 'datos').replace(/[^\w\-]+/g, '_').toLowerCase();
    const hoy = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}-${hoy}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ [EXPORTAR] /excel:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
