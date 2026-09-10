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
const avisos = require('../services/repo/avisos');

const semanaDe = req => Math.max(0, Math.min(8, parseInt((req.query || {}).semana ?? (req.body || {}).semana, 10) || 0));

// Un día cualquiera de la semana pedida (hoy + N semanas), para el tablero.
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const diaDeSemana = semana => {
  const [y, m, d] = hoyMadrid().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + Number(semana || 0) * 7 * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

// Quién manda, tal como va al registro. La cookie trae id y nombre.
const quienEs = req => ({
  usuarioId: (req.usuario && req.usuario.id) || null,
  usuario: (req.usuario && [req.usuario.nombre, req.usuario.apellidos].filter(Boolean).join(' ')) || null,
});

// El apunte NUNCA tumba el envío: si el registro falla, se manda igual y se llora en el log.
async function apuntar(datos) {
  try { await avisos.registrar(datos); }
  catch (e) { console.error('⚠️ [Turnos] no se pudo registrar el aviso:', e.message); }
}

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
    const h = await avisos.huellas({ dia: diaDeSemana(semana) });
    const base = {
      ...quienEs(req), conductorId: id, telefono: entrada.telefono || null,
      origen: 'cobertura', semanaLunes: h.lunes, huella: h.porConductor.get(id) || '',
    };
    if (!entrada.telefono) {
      await apuntar({ ...base, resultado: 'sin-telefono' });
      throw new Error('Ese conductor no tiene teléfono en su ficha');
    }
    const r = await enviarAvisoTurnos(entrada.telefono, entrada.nombre);
    await apuntar({ ...base, resultado: r.ok ? 'ok' : 'error', detalle: r.ok ? null : r.error });
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
  enviarTurnosBulk(semana, null, { ...quienEs(req), origen: 'cobertura' })
    .catch(e => console.error('❌ [Turnos] bulk:', e.message));
  res.json({ status: 'ok', msg: 'Envío iniciado' });
});

// Envía los turnos a UNA LISTA de conductores (un cuadrante del planificador, por
// ejemplo). Misma maquinaria y mismo ritmo que el envío a todos; el panel sondea
// el mismo /enviar-turnos/estado. `cuadrante` viene del botón del planificador y
// se queda en el registro: "William avisó al cuadrante X".
router.post('/enviar-turnos-varios', (req, res) => {
  if (_progTurnos.activo) return res.status(409).json({ status: 'error', msg: 'Ya hay un envío en marcha' });
  const semana = semanaDe(req);
  const ids = [...new Set((((req.body || {}).ids) || []).map(x => String(x).trim()).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ status: 'error', msg: 'No hay conductores a los que enviar' });
  const cuadrante = String((req.body || {}).cuadrante || '').slice(0, 120) || null;
  enviarTurnosBulk(semana, new Set(ids), { ...quienEs(req), cuadrante, origen: 'planificador' })
    .catch(e => console.error('❌ [Turnos] varios:', e.message));
  res.json({ status: 'ok', msg: 'Envío iniciado', pedidos: ids.length });
});

// ── El estado de los avisos de una semana (para el semáforo del planificador) ──
router.get('/api/avisos-estado', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await avisos.estadoSemana({ dia: diaDeSemana(semanaDe(req)) })) });
  } catch (e) {
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// ── El informe diario: cuántas personas, cuántos envíos y el numerador ──
router.get('/api/avisos-informe', async (req, res) => {
  try {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dia || '')) ? req.query.dia : null;
    res.json({ status: 'ok', ...(await avisos.informeDia({ dia })) });
  } catch (e) {
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

router.get('/enviar-turnos/estado', (req, res) => res.json({ status: 'ok', progreso: progTurnos() }));

async function enviarTurnosBulk(semana, soloIds = null, ctx = {}) {
  _progTurnos = { activo: true, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: sello(), fin: null, detalle: [] };
  try {
    const { porConductor } = await cob.datos({ offsetSemana: semana });
    // La foto de lo que se está avisando, para el registro y el semáforo. Si el
    // registro no puede armarse, el envío sale igual (huella vacía).
    const h = await avisos.huellas({ dia: diaDeSemana(semana) })
      .catch(e => { console.error('⚠️ [Turnos] sin huellas:', e.message); return { lunes: null, porConductor: new Map() }; });
    const apunte = (e, resultado, detalle) => h.lunes && apuntar({
      usuarioId: ctx.usuarioId, usuario: ctx.usuario, conductorId: e.id,
      telefono: e.telefono || null, cuadrante: ctx.cuadrante || null,
      origen: ctx.origen, semanaLunes: h.lunes,
      huella: h.porConductor.get(String(e.id)) || '', resultado, detalle,
    });
    // Solo los que trabajan; con `soloIds`, además, solo los pedidos (el cuadrante).
    const lista = porConductor.filter(e =>
      (!soloIds || soloIds.has(String(e.id))) && e.dias.some(d => d.trabaja));
    _progTurnos.total = lista.length;
    for (const e of lista) {
      if (!e.telefono) {
        _progTurnos.sinTel++; _progTurnos.detalle.push(`${e.nombre}: sin teléfono`);
        await apunte(e, 'sin-telefono');
        continue;
      }
      const r = await enviarAvisoTurnos(e.telefono, e.nombre);
      if (r.ok) { _progTurnos.enviados++; avisoTurnos.marcar(e.telefono, semana); }
      else { _progTurnos.errores++; _progTurnos.detalle.push(`${e.nombre}: ${r.error}`); }
      await apunte(e, r.ok ? 'ok' : 'error', r.ok ? null : r.error);
      await sleep(1200);   // ~50/min, por debajo de los límites de Meta
    }
  } finally {
    _progTurnos.activo = false; _progTurnos.fin = sello();
  }
  console.log(`📅 [Turnos] Bulk semana ${semana}: ${_progTurnos.enviados} enviados · ${_progTurnos.errores} err · ${_progTurnos.sinTel} sin tel`);
}

module.exports = router;
