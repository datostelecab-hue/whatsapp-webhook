// ============================================================
// MIGRACIONES — panel de control de la base de datos (solo desarrollador)
// ============================================================
// Aplicar migraciones cambia el esquema, así que queda tras el rol más alto.
const express = require('express');
const router = express.Router();
const sesion = require('../services/sesion');
const db = require('../services/db');
const migra = require('../services/migraciones');

router.use(sesion.requiereDesarrollador);

// La página. Faltaba: el menú lleva a /migraciones desde siempre y respondía
// "Cannot GET" porque aquí solo había API.
router.get('/', (req, res) => {
  res.render('migraciones', {
    titulo: 'Migraciones', seccion: 'migraciones', layout: 'layout-gestion',
  });
});

// Estado de la conexión y qué migraciones hay aplicadas o pendientes.
router.get('/api/estado', async (req, res) => {
  try {
    res.json({ status: 'ok', bd: await db.estado(), migraciones: await migra.estado() });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Qué se aplicaría, sin tocar nada.
router.get('/api/simular', async (req, res) => {
  try { res.json({ status: 'ok', ...(await migra.aplicar({ soloVer: true })) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Aplica lo pendiente. POST a propósito: no debe dispararse abriendo una URL.
router.post('/api/aplicar', async (req, res) => {
  try {
    const r = await migra.aplicar();
    console.log(`🐘 [MIGRA] Lanzada por ${(req.usuario || {}).email || '?'}: ` +
      `${r.aplicadas.filter(x => x.ok).length} aplicada(s)${r.parado ? ' — PARADO por error' : ''}`);
    res.status(r.parado ? 500 : 200).json({ status: r.parado ? 'error' : 'ok', ...r });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Compara la agenda de la hoja con la de PostgreSQL. No cambia nada: es el
// paso previo a que 24 modulos dejen de leer AGENDA_V2.
router.get('/api/comparar-agenda', async (req, res) => {
  try {
    const t0 = Date.now();
    const r = await require('../services/repo/compararAgenda').comparar();
    console.log(`🔍 [AGENDA] Comparadas ${r.emparejadas} filas · ${r.conDiferencias} con diferencias`);
    res.json({ status: 'ok', segundos: ((Date.now() - t0) / 1000).toFixed(1), ...r });
  } catch (e) {
    console.error('❌ [AGENDA] comparar:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// De dónde se están leyendo los conductores ahora mismo.
router.get('/api/origen-agenda', (req, res) => {
  res.json({ status: 'ok', origen: require('../services/planificadorV2').AGENDA_ORIGEN });
});

// Radiografía de lo que hay creado.
router.get('/api/inventario', async (req, res) => {
  try { res.json({ status: 'ok', ...(await migra.inventario()) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Vacía la base y la reconstruye. Solo con MODO_PRUEBAS=1 y confirmación exacta.
router.post('/api/reiniciar', async (req, res) => {
  try {
    const r = await migra.reiniciar({ confirmar: (req.body || {}).confirmar });
    console.log(`🧹 [MIGRA] REINICIO lanzado por ${(req.usuario || {}).email || '?'}`);
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
