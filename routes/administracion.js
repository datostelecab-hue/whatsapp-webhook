const express = require('express');
const router = express.Router();
const { leerTickets, crearPinAdmin, guardarCelda, leerTicket, ESTADOS, ETAPAS } = require('../services/tickets');
const { leerPadron } = require('../services/conductoresBolt');
const { enviarBallenoil } = require('../services/whatsapp');
const codigos = require('../services/codigosBallenoil');

// Nombre con el que saludar en la plantilla de Ballenoil: el ID_BOLT (nombre de BOLT)
// si lo hay, y si no el nombre de la ficha.
const nombreSaludo = t => (t && ((t.id_bolt || '').toString().trim()
  || `${t.nombre || ''} ${t.apellidos || ''}`.trim())) || '';

// Tablero de Administración: recibe las fichas que RRHH ya dio de alta y que
// esperan el PIN de Ballenoil (último paso antes del planificador).
router.get('/', (req, res) => {
  res.render('administracion', {
    titulo: 'Administración',
    seccion: 'administracion',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    // El padrón de BOLT, para copiar el NOMBRE tal cual sale en BOLT (es lo que
    // Administración necesita, junto al teléfono y el correo, para pedirle el PIN
    // a Ballenoil). Si el padrón falla, se usa el nombre de la ficha.
    let padron = null, porTelPadron = null;
    try {
      padron = (await leerPadron()).db;
      porTelPadron = new Map();
      const l9 = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
      padron.forEach(d => { const t = l9(d.phone); if (t.length === 9 && !porTelPadron.has(t)) porTelPadron.set(t, d); });
    } catch (_) { /* sin padrón: se usa lo capturado / la ficha */ }
    // Nombre tal como sale en BOLT (= ID_BOLT), por orden de fiabilidad:
    //  1) el capturado al detectarlo,  2) el padrón por driver_uuid,  3) por teléfono.
    const l9 = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
    const nombreBolt = t => {
      if ((t.id_bolt || '').trim()) return t.id_bolt.trim();
      let d = padron && t.driver_uuid ? padron.get(t.driver_uuid) : null;
      if (!d && porTelPadron) d = porTelPadron.get(l9(t.id));
      if (d && (d.nombre || '').trim()) return d.nombre.trim();
      return '';   // vacío → Administración lo teclea (tiene BOLT abierto)
    };
    // Datos que Administración copia para solicitar el PIN a Ballenoil.
    const map = t => ({
      id: t.id, nombre: nombreBolt(t), apellidos: '',
      ficha: `${t.nombre || ''}${t.apellidos ? ' ' + t.apellidos : ''}`.trim(),
      dni: t.dni || '', email: t.email || '', telefono: t.id,
      turno: t.turno || '', fecha_alta: t.fecha_alta || '',
      obs_ballenoil: t.obs_ballenoil || '', pin_ballenoil: t.pin_ballenoil || ''
    });
    const pendientes = lista.filter(t => t.etapa === ETAPAS.ADMINISTRACION).map(map);
    // Historial: fichas que ya tienen PIN (ya pasaron a Tráfico/planificador).
    const hechos = lista.filter(t => (t.pin_ballenoil || '').toString().trim()).map(map);
    res.json({
      status: 'ok', pendientes, hechos,
      contadores: { pendientes: pendientes.length, hechos: hechos.length }
    });
  } catch (error) {
    console.error('❌ [Administración] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Códigos de lavado Ballenoil (un solo uso; los reparte el bot de WhatsApp) ──
router.get('/codigos/api', async (req, res) => {
  try {
    const [resumen, lista] = await Promise.all([codigos.resumen(), codigos.listar()]);
    res.json({ status: 'ok', resumen, lista });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Importa el pegado de dos columnas (Código + Fecha de vencimiento).
router.post('/codigos/importar', async (req, res) => {
  try {
    const r = await codigos.importar((req.body || {}).texto);
    console.log(`💧 [Ballenoil] Importados ${r.añadidos} códigos (${r.duplicados} dup., ${r.invalidos} inválidos)`);
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Borra los códigos NO usados que ya vencieron (los usados se conservan de histórico).
router.post('/codigos/purgar', async (req, res) => {
  try {
    const r = await codigos.purgarVencidos();
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Guarda el PIN de Ballenoil → crea la ficha en AGENDA_V2, pasa a Tráfico y ENVÍA la
// plantilla de bienvenida "ballenoil" (con el botón "VER PIN BALLENOIL"). El envío no
// bloquea: si falla, el PIN ya quedó guardado y se avisa.
router.post('/pin', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await crearPinAdmin(b.tel, b.pin, b.id_bolt, b.obs_ballenoil);
    const env = await enviarBallenoil(t.id, nombreSaludo(t));
    if (!env.ok) console.error(`⚠️ [Ballenoil] Bienvenida NO enviada a ${t.id}: ${env.error}`);
    res.json({ status: 'ok', ticket: t, enviado: env.ok, envioError: env.ok ? null : env.error });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Reenvía la bienvenida de Ballenoil a una ficha YA creada (el PIN cambia a veces):
// actualiza el PIN en su ficha y vuelve a mandar la plantilla. Independiente de la
// etapa (no re-crea nada en la agenda).
router.post('/ballenoil/reenviar', async (req, res) => {
  try {
    const b = req.body || {};
    const tel = (b.tel || '').toString();
    const pin = (b.pin == null ? '' : b.pin).toString().trim();
    if (!pin) throw new Error('Escribe el PIN de Ballenoil');
    await guardarCelda(tel, 'pin_ballenoil', pin);
    if (b.obs_ballenoil != null) await guardarCelda(tel, 'obs_ballenoil', (b.obs_ballenoil || '').toString());
    const t = await leerTicket(tel);
    const env = await enviarBallenoil(tel, nombreSaludo(t));
    if (!env.ok) console.error(`⚠️ [Ballenoil] Reenvío NO entregado a ${tel}: ${env.error}`);
    res.json({ status: 'ok', enviado: env.ok, envioError: env.ok ? null : env.error });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
