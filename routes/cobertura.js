// ============================================================
// COBERTURA — la semana, sobre PostgreSQL
// ============================================================
// Lee del TABLERO del planificador (repo/cobertura, que se apoya en
// repo/planificador.tablero). Cero hojas: lo que se ve aquí es exactamente lo que
// hay en el cuadrante.

const express = require('express');
const router = express.Router();
const cob = require('../services/repo/cobertura');
const { enviarAvisoTurnos } = require('../services/whatsapp');
const avisoTurnos = require('../services/avisoTurnos');

const semanaDe = req => Math.max(0, Math.min(8, parseInt((req.query || {}).semana ?? (req.body || {}).semana, 10) || 0));

router.get('/', (req, res) => {
  res.render('cobertura', {
    titulo: 'Cobertura',
    seccion: 'cobertura',
    layout: 'layout-gestion',
    diasSem: cob.DIAS_SEM,
    turnos: cob.TURNOS,
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    res.json(await cob.datos({ offsetSemana: semanaDe(req) }));
  } catch (error) {
    console.error('❌ [COBERTURA] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Aviso de turnos por WhatsApp (plantilla con botón; el detalle lo manda el bot) ──
const TZ = 'Europe/Madrid';
const sello = () => new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _progTurnos = { activo: false, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: null, fin: null, detalle: [] };
const progTurnos = () => ({ ..._progTurnos, detalle: _progTurnos.detalle.slice(-15) });

// Envía los turnos de la semana a UN conductor.
router.post('/enviar-turnos', async (req, res) => {
  try {
    const b = req.body || {};
    const semana = semanaDe(req);
    // `idBolt` es como lo llama la pantalla desde siempre; hoy es el id del conductor.
    const id = String(b.idBolt || b.id || '').trim();
    if (!id) throw new Error('Falta el conductor');
    const { porConductor } = await cob.datos({ offsetSemana: semana });
    const entrada = porConductor.find(e => String(e.id) === id);
    if (!entrada) throw new Error('Ese conductor no tiene turnos esta semana');
    if (!entrada.telefono) throw new Error('Ese conductor no tiene teléfono en su ficha');
    const r = await enviarAvisoTurnos(entrada.telefono, entrada.nombre);
    if (!r.ok) throw new Error(r.error);
    avisoTurnos.marcar(entrada.telefono, semana);   // al pulsar el botón verá ESTA semana
    console.log(`📅 [Turnos] Aviso enviado a ${entrada.nombre} (semana ${semana})`);
    res.json({ status: 'ok', enviado: true });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Envía los turnos a TODOS los que trabajan esa semana (en segundo plano; el panel sondea).
router.post('/enviar-turnos-todos', (req, res) => {
  if (_progTurnos.activo) return res.status(409).json({ status: 'error', msg: 'Ya hay un envío en marcha' });
  const semana = semanaDe(req);
  enviarTurnosBulk(semana).catch(e => console.error('❌ [Turnos] bulk:', e.message));
  res.json({ status: 'ok', msg: 'Envío iniciado' });
});

router.get('/enviar-turnos/estado', (req, res) => res.json({ status: 'ok', progreso: progTurnos() }));

async function enviarTurnosBulk(semana) {
  _progTurnos = { activo: true, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: sello(), fin: null, detalle: [] };
  try {
    const { porConductor } = await cob.datos({ offsetSemana: semana });
    const lista = porConductor.filter(e => e.dias.some(d => d.trabaja));   // solo los que trabajan
    _progTurnos.total = lista.length;
    for (const e of lista) {
      if (!e.telefono) { _progTurnos.sinTel++; _progTurnos.detalle.push(`${e.nombre}: sin teléfono`); continue; }
      const r = await enviarAvisoTurnos(e.telefono, e.nombre);
      if (r.ok) { _progTurnos.enviados++; avisoTurnos.marcar(e.telefono, semana); }
      else { _progTurnos.errores++; _progTurnos.detalle.push(`${e.nombre}: ${r.error}`); }
      await sleep(1200);   // ~50/min, por debajo de los límites de Meta
    }
  } finally {
    _progTurnos.activo = false; _progTurnos.fin = sello();
  }
  console.log(`📅 [Turnos] Bulk semana ${semana}: ${_progTurnos.enviados} enviados · ${_progTurnos.errores} err · ${_progTurnos.sinTel} sin tel`);
}

module.exports = router;
