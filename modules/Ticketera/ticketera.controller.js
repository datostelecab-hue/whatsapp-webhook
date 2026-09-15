// ============================================================
// TICKETERA — HTTP. No decide nada.
// ============================================================
// UN controlador, CINCO montajes. Cada área tiene su bandeja colgando del
// módulo al que pertenece el trabajo, y el permiso sale solo del prefijo:
//
//   /ticketera              RRHH         (RRHH)
//   /administracion/tickets ADMIN        (RRHH → Administración)
//   /planificador/tickets   TRAFICO      (Tráfico)
//   /taller/tickets         TALLER       (Flota)
//   /operaciones/sin-traza  OPERACIONES  (Operaciones) — los que no se entienden
//
// No se crean permisos nuevos: quien puede abrir Administración ve los tickets
// de Administración. Separar la bandeja es una cosa y separar quién entra es
// otra; lo segundo no lo ha pedido nadie y dejaría a todo el mundo fuera hasta
// que alguien fuera concediéndolos uno a uno.

const express = require('express');
const ticketera = require('./ticketera.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({
  usuarioId: await actor.idDe(req),
  nombre: [(req.usuario || {}).nombre, (req.usuario || {}).apellidos].filter(Boolean).join(' ').trim(),
  rol: (req.usuario || {}).rol || '',
});

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Ticketera]', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

/**
 * La bandeja de un área. `titulo` y `subtitulo` los pone cada montaje: la de
 * Operaciones no se llama «Ticketera» sino «Tickets sin traza», y explicar qué
 * es eso en su propia pantalla ahorra la pregunta.
 */
function para(areaCodigo, { titulo, seccion, subtitulo } = {}) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.render('ticketera', {
      titulo: titulo || 'Ticketera',
      subtitulo: subtitulo || '',
      seccion: seccion || 'ticketera',
      layout: 'layout-gestion',
      area: areaCodigo,
      base: req.baseUrl,
      yo: [(req.usuario || {}).nombre, (req.usuario || {}).apellidos].filter(Boolean).join(' ').trim(),
    });
  });

  router.get('/api/datos', responde(async req =>
    await ticketera.datos(areaCodigo, { cerrados: req.query.cerrados === '1' })));

  router.get('/api/ticket/:id', responde(async req => await ticketera.ficha(req.params.id)));

  router.post('/asignar', responde(async req =>
    ({ ticket: await ticketera.asignar(req.body.id, req.body, await quien(req)) })));

  router.post('/estado', responde(async req =>
    ({ ticket: await ticketera.cambiarEstado(req.body.id, req.body, await quien(req)) })));

  router.post('/observaciones', responde(async req =>
    ({ ticket: await ticketera.observaciones(req.body.id, req.body.texto, await quien(req)) })));

  router.post('/enlazar', responde(async req =>
    ({ ticket: await ticketera.enlazar(req.body.id, req.body.conductorId, await quien(req)) })));

  router.post('/reclasificar', responde(async req =>
    ({ ticket: await ticketera.reclasificar(req.body.id, req.body.subtipo, await quien(req)) })));

  // Convierte el ticket en el hecho: abre la ausencia en la ficha de la persona.
  router.post('/aplicar', responde(async req =>
    ({ ticket: await ticketera.aplicar(req.body.id, req.body, await quien(req)) })));

  // Quién es quién, para poder enlazar a mano un ticket sin identificar.
  router.get('/api/personas', responde(async () => {
    const plantilla = require('../Conductores/plantilla.service');
    const { filas } = await plantilla.lista({});
    return { personas: filas
      .filter(c => !c.es_centinela)
      .map(c => ({ id: String(c.id), nombre: c.nombre_completo || c.nombre,
                   vigente: !!c.empleo_vigente, dni: c.dni_nie || '' }))
      .sort((a, b) => Number(b.vigente) - Number(a.vigente) || a.nombre.localeCompare(b.nombre, 'es')) };
  }));

  // Qué está leyendo del formulario y qué no. Sin esto, que una pregunta deje de
  // casar es invisible: el ticket sale con un campo vacío y nadie se entera.
  router.get('/api/formulario', responde(async () => await ticketera.diagnostico()));

  // Traer ahora lo que haya, sin esperar a la ingesta.
  router.post('/sincronizar', responde(async () => await ticketera.sincronizar()));

  return router;
}

module.exports = { para };
