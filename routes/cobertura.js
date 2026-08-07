const express = require('express');
const router = express.Router();
const { leerTablero, DIAS_SEM, TURNOS } = require('../services/planificadorV2');
const { instruccionesPorConductor, planSemanaTexto } = require('../services/turnosConductor');
const { enviarTurnosSemana } = require('../services/whatsapp');
const { leerTelefonosDB } = require('../services/control');

router.get('/', (req, res) => {
  res.render('cobertura', {
    titulo: 'Cobertura',
    seccion: 'cobertura',
    layout: 'layout-gestion',
    diasSem: DIAS_SEM,
    turnos: TURNOS
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    // ?semana=N: 0 = actual, 1 = la que viene, etc. Para "ver el futuro".
    const offsetSemana = Math.max(0, Math.min(8, parseInt(req.query.semana) || 0));
    const [t, telsDB] = await Promise.all([leerTablero({ offsetSemana }), leerTelefonosDB().catch(() => new Map())]);

    // Los relevos de todos los coches, en una sola lista para poder filtrarlos
    // por persona: cada conductor quiere saber a quién entrega y de quién recibe.
    const relevos = [];
    t.coches.forEach(c => (c.relevos || []).forEach(r => relevos.push(r)));

    res.json({
      semanaInfo: t.semanaInfo,
      cobertura: t.cobertura,
      ausentesEnPlaza: t.ausentesEnPlaza || [],
      relevos,
      porConductor: instruccionesPorConductor(t, telsDB),
      coches: t.coches
        .filter(c => c.matricula && c.operativo)
        .map(c => ({
          matricula: c.matricula, zona: c.zona,
          semana: c.semana, relevos: c.relevos,
          numLibres: c.numLibres, hayError: c.hayError
        })),
      resumen: t.resumen
    });
  } catch (error) {
    console.error('❌ [COBERTURA] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Envío de turnos por WhatsApp (plantilla turnosdeconductores) ─────────────
const TZ = 'Europe/Madrid';
const sello = () => new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _progTurnos = { activo: false, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: null, fin: null, detalle: [] };
const progTurnos = () => ({ ..._progTurnos, detalle: _progTurnos.detalle.slice(-15) });

// Envía los turnos de la semana a UN conductor (por su ID_BOLT).
router.post('/enviar-turnos', async (req, res) => {
  try {
    const b = req.body || {};
    const semana = Math.max(0, Math.min(8, Number(b.semana) || 0));
    const idBolt = (b.idBolt || '').toString().trim();
    if (!idBolt) throw new Error('Falta el conductor');
    const [t, telsDB] = await Promise.all([leerTablero({ offsetSemana: semana }), leerTelefonosDB().catch(() => new Map())]);
    const entrada = instruccionesPorConductor(t, telsDB).find(e => e.id === idBolt);
    if (!entrada) throw new Error('Ese conductor no tiene turnos esta semana');
    if (!entrada.telefono) throw new Error('Ese conductor no tiene teléfono en la agenda');
    const r = await enviarTurnosSemana(entrada.telefono, entrada.nombre, planSemanaTexto(entrada));
    if (!r.ok) throw new Error(r.error);
    console.log(`📅 [Turnos] Enviado a ${entrada.nombre}`);
    res.json({ status: 'ok', enviado: true });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Envía los turnos a TODOS los que trabajan esa semana (en segundo plano; el panel sondea).
router.post('/enviar-turnos-todos', (req, res) => {
  if (_progTurnos.activo) return res.status(409).json({ status: 'error', msg: 'Ya hay un envío en marcha' });
  const semana = Math.max(0, Math.min(8, Number((req.body || {}).semana) || 0));
  enviarTurnosBulk(semana).catch(e => console.error('❌ [Turnos] bulk:', e.message));
  res.json({ status: 'ok', msg: 'Envío iniciado' });
});

router.get('/enviar-turnos/estado', (req, res) => res.json({ status: 'ok', progreso: progTurnos() }));

async function enviarTurnosBulk(semana) {
  _progTurnos = { activo: true, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: sello(), fin: null, detalle: [] };
  try {
    const [t, telsDB] = await Promise.all([leerTablero({ offsetSemana: semana }), leerTelefonosDB().catch(() => new Map())]);
    const lista = instruccionesPorConductor(t, telsDB).filter(e => e.dias.some(d => d.trabaja));   // solo los que trabajan
    _progTurnos.total = lista.length;
    for (const e of lista) {
      if (!e.telefono) { _progTurnos.sinTel++; _progTurnos.detalle.push(`${e.nombre}: sin teléfono`); continue; }
      const r = await enviarTurnosSemana(e.telefono, e.nombre, planSemanaTexto(e));
      if (r.ok) _progTurnos.enviados++;
      else { _progTurnos.errores++; _progTurnos.detalle.push(`${e.nombre}: ${r.error}`); }
      await sleep(1200);   // ~50/min, por debajo de los límites de Meta
    }
  } finally {
    _progTurnos.activo = false; _progTurnos.fin = sello();
  }
  console.log(`📅 [Turnos] Bulk semana ${semana}: ${_progTurnos.enviados} enviados · ${_progTurnos.errores} err · ${_progTurnos.sinTel} sin tel`);
}

module.exports = router;
