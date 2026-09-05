// ============================================================
// /bi — Inteligencia de negocio (cuadros de mando para dirección)
// ============================================================
// Solo lee la capa semántica bi_* a través de services/bi.js. El acceso es de
// dirección: en services/sesion.js la ruta '/bi' no tiene roles permitidos, así
// que solo entran superadmin y desarrollador.
const express = require('express');
const router = express.Router();
const bi = require('../services/bi');
const { requiereSuperadmin } = require('../services/sesion');

router.get('/', (req, res) => {
  res.render('bi', { titulo: 'Inteligencia de negocio', seccion: 'bi', layout: 'layout-gestion' });
});

// Cada endpoint recibe el mismo juego de filtros por query: preset|desde+hasta,
// zona, tipo (propia|ett), turno. El servicio los normaliza.
const api = (nombre, fn) => async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await fn(req.query || {})) });
  } catch (e) {
    console.error('❌ [BI] ' + nombre + ':', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
};
router.get('/api/resumen',     api('resumen',     q => bi.resumen(q)));
router.get('/api/serie',       api('serie',       q => bi.serieDiaria(q)));
router.get('/api/kpi-mes',     api('kpi-mes',     async () => ({ meses: await bi.kpiMes() })));
router.get('/api/desglose',    api('desglose',    q => bi.desglose(q)));
router.get('/api/conductores', api('conductores', q => bi.conductores(q)));
router.get('/api/vehiculos',   api('vehiculos',   q => bi.vehiculos(q)));
router.get('/api/plantilla',   api('plantilla',   q => bi.plantilla(q)));
router.get('/api/operacion',   api('operacion',   q => bi.operacion(q)));
router.get('/api/funnel',      api('funnel',      () => bi.funnel()));
router.get('/api/heatmap',     api('heatmap',     q => bi.heatmap(q)));
router.get('/api/catalogo',    api('catalogo',    () => bi.catalogo()));
router.get('/api/meta',        api('meta',        () => bi.meta()));

// Refresco a mano de los hechos materializados (el cron lo hace cada hora).
router.post('/api/refrescar', requiereSuperadmin, api('refrescar', () => bi.refrescar()));

// Cómo conectar Power BI: el host y la base salen de la URL de conexión, la
// contraseña NUNCA. Se recomienda un usuario de solo lectura (ver la pantalla).
router.get('/api/conexion', (req, res) => {
  let host = '', base = '', puerto = '5432';
  try {
    const u = new URL(process.env.DATABASE_URL || '');
    host = u.hostname; base = (u.pathname || '').replace(/^\//, ''); puerto = u.port || '5432';
  } catch (e) { /* sin URL configurada: se deja vacío */ }
  res.json({ status: 'ok', host, base, puerto, ssl: true,
    vistas: Object.entries(bi.EXPORTABLES).map(([clave, e]) => ({ clave, vista: e.vista })) });
});

// Exportar una vista a CSV (Excel lo abre directo; Power BI también lo importa).
router.get('/export/:clave.csv', async (req, res) => {
  try {
    const { vista, columnas, filas } = await bi.exportar(req.params.clave, req.query || {});
    const esc = v => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // Punto y coma y BOM: es lo que Excel en español abre bien sin preguntar.
    const cuerpo = '﻿' + columnas.join(';') + '\r\n' +
      filas.map(f => columnas.map(c => esc(f[c])).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + vista + '.csv"');
    res.send(cuerpo);
  } catch (e) {
    console.error('❌ [BI] export:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
