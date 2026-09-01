// ============================================================
// CONVENIO (RRHH) — rutas
// ============================================================
// La interfaz del modulo de convenio: el panel de jornada del mes y la ficha
// del trabajador. El acceso lo controla `controlAcceso` por el prefijo /convenio
// (rol oficina + los admin totales), como el resto de RRHH. La ruta es fina:
// pide al servicio, que solo lee de PostgreSQL.
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const convenio = require('../services/repo/convenio');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

router.get('/', async (req, res) => {
  // El mes de arranque (el ultimo con objetivos) se resuelve aqui para que el
  // selector y la primera carga ya salgan en el mes correcto, sin un parpadeo.
  const mes = await convenio.mesPorDefecto().catch(() => {
    const h = new Date(); return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  res.render('convenio', {
    titulo: 'Convenio · Jornada', seccion: 'convenio', layout: 'layout-gestion', sub: 'jornada',
    anioInicial: mes.anio, mesInicial: mes.mes,
  });
});

// La pantalla de cierre de periodo.
router.get('/cierre', (req, res) => {
  res.render('convenioCierre', {
    titulo: 'Convenio · Cierre', seccion: 'convenio', layout: 'layout-gestion', sub: 'cierre',
  });
});

// La nómina del mes (export a gestoría).
router.get('/nomina', async (req, res) => {
  const mes = await convenio.mesPorDefecto().catch(() => {
    const h = new Date(); return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  res.render('convenioNomina', {
    titulo: 'Convenio · Nómina', seccion: 'convenio', layout: 'layout-gestion', sub: 'nomina',
    anioInicial: mes.anio, mesInicial: mes.mes,
  });
});

// El cuadro de absentismo.
router.get('/absentismo', async (req, res) => {
  const mes = await convenio.mesPorDefecto().catch(() => {
    const h = new Date(); return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  res.render('convenioAbsentismo', {
    titulo: 'Convenio · Absentismo', seccion: 'convenio', layout: 'layout-gestion', sub: 'absentismo',
    anioInicial: mes.anio, mesInicial: mes.mes,
  });
});

const responder = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
};

// Un mes valido, o el que toca por defecto (el ultimo con objetivos).
async function mesDe(req) {
  const a = parseInt(req.query.anio, 10), m = parseInt(req.query.mes, 10);
  if (a >= 2024 && a <= 2100 && m >= 1 && m <= 12) return { anio: a, mes: m };
  return convenio.mesPorDefecto();
}

// El panel: los trabajadores con la cuenta del mes.
router.get('/api/trabajadores', responder(async req => {
  const { anio, mes } = await mesDe(req);
  return { mes: { anio, mes }, filas: await convenio.trabajadores(anio, mes) };
}));

// La ficha de un trabajador (por conductor_id).
router.get('/api/ficha/:id', responder(async req => ({ ficha: await convenio.ficha(req.params.id) })));

// ── Cierre de periodo ───────────────────────────────────────────────────────
router.get('/api/periodos', responder(async () => ({ filas: await convenio.periodos() })));
router.get('/api/periodo/:anio/:mes', responder(async req =>
  ({ ficha: await convenio.fichaPeriodo(req.params.anio, req.params.mes) })));

// Cerrar un mes. Escritura: fotografia, congela y sella. Queda el rastro de quien.
router.post('/api/cerrar', responder(async req => {
  const b = req.body || {};
  const r = await convenio.cerrar(b.anio, b.mes, (req.usuario || {}).email);
  console.log(`🔒 [CONVENIO] ${(req.usuario || {}).email || '?'} cierra ${b.anio}-${b.mes}: ` +
              `${r.contratos} contratos, manifiesto ${String(r.manifiesto || '').slice(0, 12)}…`);
  return { resultado: r };
}));

// Regularizar hacia el mes abierto. El mes de aplicacion, si no viene, es el
// siguiente al cerrado (el primer mes abierto habitual).
router.post('/api/regularizar', responder(async req => {
  const b = req.body || {};
  const oa = Number(b.anio), om = Number(b.mes);
  let aa = Number(b.aplica_anio), am = Number(b.aplica_mes);
  if (!(aa >= 2024 && am >= 1 && am <= 12)) {
    am = om === 12 ? 1 : om + 1;
    aa = om === 12 ? oa + 1 : oa;
  }
  const r = await convenio.regularizar(oa, om, aa, am);
  console.log(`♻️  [CONVENIO] ${(req.usuario || {}).email || '?'} regulariza ${oa}-${om} en ${aa}-${am}: ${r.creadas} apunte(s)`);
  return { ...r, aplica: { anio: aa, mes: am } };
}));

// ── Cuadro de absentismo ────────────────────────────────────────────────────
router.get('/api/absentismo', responder(async req => {
  const { anio, mes } = await mesDe(req);
  return { mes: { anio, mes }, filas: await convenio.absentismo(anio, mes) };
}));
router.get('/api/absentismo/:modulo', responder(async req => {
  const { anio, mes } = await mesDe(req);
  return { ficha: await convenio.absentismoModulo(anio, mes, req.params.modulo) };
}));

// ── Nómina del mes / export a gestoría ──────────────────────────────────────
router.get('/api/nomina', responder(async req => {
  const { anio, mes } = await mesDe(req);
  return { mes: { anio, mes }, filas: await convenio.nominaMes(anio, mes) };
}));
router.get('/api/nomina/detalle/:id', responder(async req => {
  const { anio, mes } = await mesDe(req);
  return { ficha: await convenio.nominaDetalle(req.params.id, anio, mes) };
}));

// La descarga: un Excel con dos hojas (nómina y finiquitos). No pasa por
// `responder` porque escribe el fichero en la respuesta, no JSON.
router.get('/api/nomina/export', async (req, res) => {
  try {
    const { anio, mes } = await mesDe(req);
    const [filas, finiquitos] = await Promise.all([
      convenio.nominaMes(anio, mes), convenio.finiquitosMes(anio, mes),
    ]);
    const num = v => (v === null || v === undefined) ? null : Number(v);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Nómina ${MESES[mes - 1]} ${anio}`);
    ws.columns = [
      { header: 'DNI/NIE', key: 'dni', width: 14 },
      { header: 'NAF', key: 'naf', width: 16 },
      { header: 'Trabajador', key: 'nombre', width: 30 },
      { header: 'Propinas', key: 'propinas', width: 12 },
      { header: 'Plus calidad', key: 'plus_calidad', width: 13 },
      { header: 'Bonus', key: 'bonus', width: 12 },
      { header: 'Garantía', key: 'garantia', width: 12 },
      { header: 'H. extra (min)', key: 'extra_min', width: 13 },
      { header: 'H. extra (€)', key: 'extra_eur', width: 12 },
      { header: 'Nocturn. (min)', key: 'nocturnidad_min', width: 14 },
      { header: 'Nocturn. (€)', key: 'nocturnidad_eur', width: 12 },
      { header: 'Descuentos', key: 'descuentos', width: 12 },
      { header: 'TOTAL €', key: 'total', width: 13 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
    filas.forEach(f => ws.addRow({
      dni: f.dni, naf: f.naf, nombre: f.nombre,
      propinas: num(f.propinas), plus_calidad: num(f.plus_calidad), bonus: num(f.bonus),
      garantia: num(f.garantia), extra_min: num(f.extra_min), extra_eur: num(f.extra_eur),
      nocturnidad_min: num(f.nocturnidad_min), nocturnidad_eur: num(f.nocturnidad_eur),
      descuentos: num(f.descuentos), total: num(f.total),
    }));
    ['propinas', 'plus_calidad', 'bonus', 'garantia', 'extra_eur', 'nocturnidad_eur', 'descuentos', 'total']
      .forEach(k => { ws.getColumn(k).numFmt = '#,##0.00 €'; });
    ['extra_min', 'nocturnidad_min'].forEach(k => { ws.getColumn(k).numFmt = '#,##0'; });

    // Segunda hoja: finiquitos con baja en el mes (solo si los hay).
    if (finiquitos.length) {
      const wf = wb.addWorksheet('Finiquitos');
      wf.columns = [
        { header: 'DNI/NIE', key: 'dni', width: 14 },
        { header: 'NAF', key: 'naf', width: 16 },
        { header: 'Trabajador', key: 'nombre', width: 30 },
        { header: 'Fecha baja', key: 'fecha_baja', width: 13 },
        { header: 'Tipo', key: 'tipo_baja', width: 16 },
        { header: 'Preaviso', key: 'preaviso', width: 12 },
        { header: 'Finiquito €', key: 'total', width: 13 },
        { header: 'Estado', key: 'estado', width: 12 },
      ];
      wf.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      wf.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
      finiquitos.forEach(f => wf.addRow({
        dni: f.dni, naf: f.naf, nombre: f.nombre,
        fecha_baja: f.fecha_baja ? new Date(f.fecha_baja) : null, tipo_baja: f.tipo_baja,
        preaviso: `${f.dias_preavisados}/${f.preaviso_exigido}`, total: num(f.total), estado: f.estado,
      }));
      wf.getColumn('total').numFmt = '#,##0.00 €';
      wf.getColumn('fecha_baja').numFmt = 'dd/mm/yyyy';
    }

    const pad = n => String(n).padStart(2, '0');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nomina-gestoria-${anio}-${pad(mes)}.xlsx"`);
    console.log(`📤 [CONVENIO] ${(req.usuario || {}).email || '?'} exporta nómina ${anio}-${pad(mes)}: ${filas.length} trabajadores, ${finiquitos.length} finiquitos`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
