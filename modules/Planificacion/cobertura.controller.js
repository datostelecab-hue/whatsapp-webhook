// ============================================================
// COBERTURA — controlador
// ============================================================
// La semana sobre PostgreSQL, y el aviso de turnos por WhatsApp. Las reglas
// —el ritmo de envío, a quién se avisa, qué se apunta— están en el servicio.

const express = require('express');
const router = express.Router();
const cobertura = require('./cobertura.service');

const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [COBERTURA] ${req.method} ${req.path}: ${e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** La semana llega por query en los GET y por cuerpo en los POST. */
const semanaDe = req => cobertura.semanaDe((req.query || {}).semana ?? (req.body || {}).semana);

/** Quién manda, tal como va al registro. La cookie trae id y nombre. */
const quienEs = req => ({
  usuarioId: (req.usuario && req.usuario.id) || null,
  usuario: (req.usuario && [req.usuario.nombre, req.usuario.apellidos].filter(Boolean).join(' ')) || null,
});

router.get('/', (req, res) => {
  res.render('cobertura', {
    titulo: 'Cobertura', seccion: 'cobertura', layout: 'layout-gestion',
    ...cobertura.paraLaPantalla(),
  });
});

// Sin `status: 'ok'` a propósito: la pantalla lleva desde siempre leyendo la
// respuesta de `datos()` en la raíz.
router.get('/api/datos', async (req, res) => {
  try { res.json(await cobertura.datos(semanaDe(req))); }
  catch (e) {
    console.error('❌ [COBERTURA] /api/datos:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// ── Aviso de turnos por WhatsApp ───────────────────────────────────────────
// Plantilla con botón; el detalle lo manda el bot cuando el conductor lo pulsa.

router.post('/enviar-turnos', responde(async req => {
  const b = req.body || {};
  return cobertura.enviarAUno({ id: b.idBolt || b.id, semana: semanaDe(req) }, quienEs(req));
}, 400));

// Los envíos HACEN COLA (12/11/2026): antes el segundo recibía un 409 y no
// salía. Cada petición deja su trabajo y devuelve su número; el botón sondea el
// suyo con /enviar-turnos/estado?trabajo=N.

// A TODOS los que trabajan esa semana.
router.post('/enviar-turnos-todos', (req, res) => {
  const t = cobertura.lanzarMasivo(semanaDe(req), null, { ...quienEs(req), origen: 'cobertura' });
  res.json({ status: 'ok', msg: t.enCola ? `En cola (${t.enCola}.º): sale en cuanto acabe lo de delante` : (t.repetido ? 'Ese envío ya está saliendo' : 'Envío iniciado'), trabajo: t.trabajo, enCola: t.enCola, repetido: !!t.repetido });
});

// A UNA LISTA (un cuadrante del planificador, por ejemplo).
router.post('/enviar-turnos-varios', (req, res) => {
  const b = req.body || {};
  const ids = [...new Set((b.ids || []).map(x => String(x).trim()).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ status: 'error', msg: 'No hay conductores a los que enviar' });
  const cuadrante = String(b.cuadrante || '').slice(0, 120) || null;
  const t = cobertura.lanzarMasivo(semanaDe(req), new Set(ids),
    { ...quienEs(req), cuadrante, origen: 'planificador' });
  res.json({ status: 'ok', msg: t.enCola ? `En cola (${t.enCola}.º): sale en cuanto acabe lo de delante` : (t.repetido ? 'Ese envío ya está saliendo' : 'Envío iniciado'), pedidos: ids.length,
    trabajo: t.trabajo, enCola: t.enCola, repetido: !!t.repetido });
});

// Con ?trabajo=N, el de ese envío; sin él, el que está saliendo y cuántos esperan.
router.get('/enviar-turnos/estado', (req, res) =>
  res.json({ status: 'ok', progreso: cobertura.progreso((req.query || {}).trabajo) }));

// El estado de los avisos de una semana (el semáforo del planificador).
router.get('/api/avisos-estado', responde(req => cobertura.estadoDeAvisos(semanaDe(req))));

// El informe diario: cuántas personas, cuántos envíos y el numerador.
router.get('/api/avisos-informe', responde(req => cobertura.informeDeAvisos(req.query.dia)));

module.exports = router;
