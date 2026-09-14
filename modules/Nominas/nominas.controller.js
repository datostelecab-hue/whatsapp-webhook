// ============================================================
// NÓMINAS — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
// DESAPARECIERON TRES RUTAS respecto a la versión sobre hojas, y conviene saber
// por qué para no echarlas de menos:
//
//   POST /generar   y   GET /estado
//       Existían porque bajar el mes de BOLT tardaba minutos: había que lanzarlo
//       en segundo plano y sondear una barra de progreso. Ahora calcular es una
//       consulta a PostgreSQL, así que GET /cargar lo hace y contesta.
//
// Y HAY DOS EXCEL, con dos meses distintos a propósito:
//   GET /nomina.xlsx  va por mes de PAGO    (septiembre paga el trabajo de agosto)
//   GET /ett.xlsx     va por mes TRABAJADO  (agosto son los datos de agosto)
// No es un descuido: la nómina es un pago y el parte de la ETT es un parte de
// trabajo. Cada uno lleva el mes que le corresponde.
//
//   GET /diagnostico
//       Desglosaba los pedidos de una persona llamando a la API de BOLT desde la
//       ruta. Servía para perseguir descuadres entre la hoja y el panel de Bolt;
//       sin hoja de por medio no hay descuadre que perseguir, y una pantalla no
//       debe depender de una API ajena (ver scripts/comprobar-ingesta.js).

const express = require('express');
const router = express.Router();
const nominas = require('./nominas.service');
const excel = require('./nominas.excel');
const actor = require('../../services/repo/actor');
const sesion = require('../../services/sesion');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [NÓMINAS]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quien = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/** Mes y año de la petición, o revienta con un mensaje que se entienda. */
function mesAno(origen) {
  const mes = parseInt(origen.mes, 10), ano = parseInt(origen.ano, 10);
  if (!(mes >= 1 && mes <= 12) || !(ano >= 2024 && ano <= 2100)) throw new Error('Mes o año no válidos');
  return { mes, ano };
}

// ── La pantalla ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const ahora = new Date();
  res.render('nominas', {
    titulo: 'Nóminas', seccion: 'nominas', layout: 'layout-gestion',
    mesActual: ahora.getMonth() + 1, anoActual: ahora.getFullYear(),
    campos: nominas.CONFIG_CAMPOS,
    // Descongelar rehace una nómina ya cerrada: mismo candado que las migraciones.
    esDesarrollador: !!(req.usuario && req.usuario.rol === 'desarrollador'),
  });
});

// ── Config ─────────────────────────────────────────────────────────────────
router.get('/config', responde(async () =>
  ({ config: await nominas.leerConfig(), campos: nominas.CONFIG_CAMPOS })));

router.post('/config', responde(async req =>
  ({ config: await nominas.guardarConfig((req.body && req.body.config) || req.body || {}, await quien(req)) })));

// ── El mes ─────────────────────────────────────────────────────────────────
// Una sola puerta: si está congelado devuelve lo congelado, y si no lo calcula.
router.get('/cargar', responde(async req => {
  const { mes, ano } = mesAno(req.query);
  return nominas.cargar(mes, ano);
}));

// Calcular con una config de prueba SIN guardarla: mover una tarifa y ver a
// quién le cambia cuánto antes de decidir.
router.post('/calcular', responde(async req => {
  const b = req.body || {};
  const { mes, ano } = mesAno(b);
  const config = b.config ? { ...(await nominas.leerConfig()), ...limpiar(b.config) } : null;
  return { fuente: 'calculada', resultado: await nominas.calcular(mes, ano, { config }) };
}));

// Solo claves conocidas y numéricas: lo que llega del navegador no se mete en un
// cálculo de dinero sin mirarlo.
function limpiar(config) {
  const o = {};
  Object.keys(config || {}).forEach(k => {
    if (!(k in nominas.DEFAULTS)) return;
    const v = parseFloat(String(config[k]).replace(',', '.'));
    if (!isNaN(v)) o[k] = v;
  });
  return o;
}

// ── Congelar ───────────────────────────────────────────────────────────────
router.post('/congelar', responde(async req => {
  const { mes, ano } = mesAno(req.body || {});
  return nominas.congelar(mes, ano, await quien(req));
}));

// Descongelar borra una nómina cerrada: solo el desarrollador.
router.post('/descongelar', sesion.requiereDesarrollador, responde(async req => {
  const { mes, ano } = mesAno(req.body || {});
  return { borrada: await nominas.descongelar(mes, ano) };
}));

// Qué meses hay cerrados (para el selector y para saber por dónde va RRHH).
router.get('/congeladas', responde(async () => ({ meses: await nominas.mesesCongelados() })));

// ── Excel ──────────────────────────────────────────────────────────────────
// Con el punto en la ruta a propósito: así el navegador nombra bien la descarga.
router.get('/nomina.xlsx', async (req, res) => {
  try {
    const { mes, ano } = mesAno(req.query);
    const { resultado } = await nominas.cargar(mes, ano);
    if (!resultado) return res.status(404).send('No hay nómina para ese mes');
    const bytes = await excel.generarExcelNomina(resultado);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${excel.nombreFichero(resultado)}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    console.error('❌ [NÓMINAS] excel:', e.message);
    res.status(400).send('Error: ' + e.message);
  }
});

// El parte de la ETT. OJO: el mes de esta ruta es el TRABAJADO, no el de pago.
// Se pide agosto y salen los datos de agosto; la nómina, en cambio, va a mes
// vencido. Son dos documentos distintos y por eso son dos rutas distintas.
router.get('/ett.xlsx', async (req, res) => {
  try {
    const { mes, ano } = mesAno(req.query);
    const r = await nominas.paraETT(mes, ano);
    const bytes = await excel.generarExcelETT(r);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${excel.nombreFicheroETT(r)}"`);
    res.end(Buffer.from(bytes));
  } catch (e) {
    console.error('❌ [NÓMINAS] excel ETT:', e.message);
    res.status(400).send('Error: ' + e.message);
  }
});

module.exports = router;
