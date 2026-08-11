const express = require('express');
const router = express.Router();
const { leerTickets, crearPinAdmin, guardarCelda, guardarPinConductor, leerTicket, ESTADOS, ETAPAS } = require('../services/tickets');
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

// ── PIN a CUALQUIER conductor (independiente de selección) ─────────────────────
// Lista: conductores de la AGENDA (con ficha) + gente del padrón de BOLT SIN ficha
// (para crearla al vuelo). A cada uno se le puede asignar/actualizar el PIN.
router.get('/conductores', async (req, res) => {
  try {
    const { leerTablero, ESTADOS_ESPECIALES } = require('../services/planificadorV2');
    const l9 = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
    // Solo gente OPERATIVA: fuera vacaciones, baja médica, permiso, baja de empresa y
    // suspendidos. Se quedan "Activo" y "Pendiente Asignar" (y el estado en blanco, que
    // se asume operativo). Así la lista de PIN no arrastra a quien ahora no conduce.
    const noOperativo = e => ESTADOS_ESPECIALES.includes((e || '').toString().trim());
    const [tablero, tks, padron] = await Promise.all([
      leerTablero(),
      leerTickets(),
      leerPadron().catch(() => ({ db: new Map() }))
    ]);
    // Por teléfono: PIN, y los datos de la ficha (DNI + correo) que Administración copia
    // para pedirle el PIN a Ballenoil. También el correo del padrón de BOLT como respaldo
    // (el padrón trae correo pero no DNI).
    const pinPorTel = new Map();
    const fichaPorTel = new Map();     // tel9 -> { dni, email } (de la ficha de RRHH)
    const emailPadronTel = new Map();  // tel9 -> correo del padrón de BOLT (respaldo)
    const telConFicha = new Set();
    (tks.lista || []).forEach(t => {
      const k = l9(t.id); if (!k) return;
      pinPorTel.set(k, t.pin_ballenoil || '');
      fichaPorTel.set(k, { dni: (t.dni || '').toString().trim(), email: (t.email || '').toString().trim() });
      telConFicha.add(k);
    });
    (padron.db || new Map()).forEach(d => { const k = l9(d.phone); if (k && d.email && !emailPadronTel.has(k)) emailPadronTel.set(k, d.email.toString().trim()); });
    // OJO: telConFicha se llena con TODOS los de agenda (incluidos los no operativos) para
    // que un suspendido/baja no se cuele luego por el padrón de BOLT.
    (tablero.conductores || []).forEach(c => { const k = l9(c.telefono); if (k) telConFicha.add(k); });

    const out = [];
    const vistos = new Set();
    // 1) Agenda: conductores con ficha, SOLO activos / pendientes de asignar.
    (tablero.conductores || []).forEach(c => {
      if (noOperativo(c.estado)) return;   // fuera bajas, vacaciones, permisos, suspendidos
      const tel = l9(c.telefono);
      const key = tel || 'bolt:' + ((c.idBolt || c.id || '').toLowerCase());
      if (vistos.has(key)) return; vistos.add(key);
      const f = tel ? fichaPorTel.get(tel) : null;
      out.push({
        id_bolt: c.idBolt || c.id || '', nombre: c.nombre || '',
        telefono: (c.telefono || '').toString().trim(), turno: c.turno || '',
        dni: (c.dni || (f && f.dni) || '').toString().trim(),
        email: ((f && f.email) || (tel && emailPadronTel.get(tel)) || '').toString().trim(),
        estado: (c.estado || '').toString().trim(),
        pin_ballenoil: tel ? (pinPorTel.get(tel) || '') : '', con_ficha: true
      });
    });
    // 2) Padrón de BOLT (activos) SIN ficha: para crear ficha + PIN de una vez. No tienen
    //    DNI en el padrón (sí correo); el DNI se rellena al crearles la ficha.
    (padron.db || new Map()).forEach(d => {
      if ((d.state || '').toLowerCase() !== 'active') return;
      const tel = l9(d.phone);
      if (!tel || vistos.has(tel) || telConFicha.has(tel)) return;
      vistos.add(tel);
      out.push({
        id_bolt: (d.nombre || '').trim(), nombre: (d.nombre || '').trim(),
        telefono: (d.phone || '').toString().trim(), turno: '',
        dni: '', email: (d.email || '').toString().trim(),
        estado: '', pin_ballenoil: '', con_ficha: false
      });
    });
    out.sort((a, b) => (a.con_ficha === b.con_ficha ? 0 : a.con_ficha ? -1 : 1)
      || (a.nombre || a.id_bolt).localeCompare(b.nombre || b.id_bolt));
    const conPin = c => !!(c.pin_ballenoil || '').toString().trim();
    res.json({
      status: 'ok', conductores: out,
      contadores: { total: out.length, conPin: out.filter(conPin).length, sinPin: out.filter(c => !conPin(c)).length }
    });
  } catch (e) {
    console.error('❌ [Administración] /conductores:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Asigna/actualiza el PIN a cualquier conductor (crea la ficha si no la tiene) y le
// envía la bienvenida de Ballenoil. Dos procesos de una vez: ficha + PIN.
router.post('/ballenoil/conductor', async (req, res) => {
  try {
    const b = req.body || {};
    const tel = (b.tel || '').toString();
    const pin = (b.pin == null ? '' : b.pin).toString().trim();
    const nombre = (b.nombre || '').toString().trim();
    if (!tel) throw new Error('Falta el teléfono del conductor');
    if (!pin) throw new Error('Escribe el PIN de Ballenoil');
    const t = await guardarPinConductor(tel, pin, nombre);
    const env = await enviarBallenoil(tel, nombreSaludo(t) || nombre);
    if (!env.ok) console.error(`⚠️ [Ballenoil] Bienvenida NO enviada a ${tel}: ${env.error}`);
    res.json({ status: 'ok', enviado: env.ok, envioError: env.ok ? null : env.error });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
