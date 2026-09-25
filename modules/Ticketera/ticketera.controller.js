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
const permisos = require('../../services/permisos');

// ── LAS CINCO BANDEJAS, EN LA BARRA DE ARRIBA (25/09/2026) ─────────────────
// Camilo: «sobre la barra superior tiene que haber un cuadro por ticket de
// departamento; quítalos de allá y ponlos arriba». Ya no están en el menú
// lateral: cada una es un cuadro en la barra, con su nombre y sus PENDIENTES
// DE ESTE MES. Esta lista es la única que hay: la usan la barra y el recuento.
const BANDEJAS = [
  { area: 'RRHH',        href: '/ticketera',               etiqueta: 'RRHH' },
  { area: 'ADMIN',       href: '/administracion/tickets',  etiqueta: 'Administración' },
  { area: 'TRAFICO',     href: '/planificador/tickets',    etiqueta: 'Tráfico' },
  { area: 'TALLER',      href: '/taller/tickets',          etiqueta: 'Taller' },
  { area: 'OPERACIONES', href: '/operaciones/sin-traza',   etiqueta: 'Sin traza' },
];

/**
 * Las bandejas que puede abrir quien mira. Con la MISMA regla que el control de
 * acceso (la llave de la ruta, `claveDeRuta`): un cuadro que da «sin permiso»
 * al pincharlo es peor que no tenerlo. `permisos` en null es acceso total.
 */
function visibles(res) {
  const mias = res.locals.permisos;
  return BANDEJAS.filter(b => {
    if (mias == null) return true;
    const clave = permisos.claveDeRuta(b.href, 'GET');
    return !clave || mias.includes(clave);
  });
}

/** Deja en la vista qué cuadros pintar. Va después de sesion.cargarPermisos. */
function enLaBarra(req, res, next) {
  res.locals.bandejasBarra = req.usuario ? visibles(res).map(({ area, href, etiqueta }) => ({ area, href, etiqueta })) : [];
  next();
}

/**
 * Los pendientes de este mes de las bandejas que puede ver: lo que pintan los
 * cuadros. Se monta en `/bandejas`, que no es de ningún módulo, y por eso filtra
 * aquí: nadie recibe el número de una bandeja que no puede abrir.
 */
function resumen() {
  const router = express.Router();
  router.get('/api/pendientes', async (req, res) => {
    try {
      const mias = visibles(res);
      const r = await ticketera.pendientesDelMes(mias.map(b => b.area));
      res.json({ status: 'ok', mes: r.mes,
        bandejas: mias.map(b => ({ ...b, pendientes: r.pendientes[b.area] || 0 })) });
    } catch (e) {
      console.error('❌ [Ticketera] pendientes de la barra:', e.message);
      res.status(400).json({ status: 'error', msg: e.message });
    }
  });
  return router;
}

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
function para(areaCodigo, { titulo, seccion, subtitulo, soloMes = true } = {}) {
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

  // Solo lo pedido ESTE MES (los de antes son de la hoja vieja), salvo el
  // ticket del enlace directo (`?ticket=CÓDIGO`), que se trae sea del mes que sea.
  router.get('/api/datos', responde(async req =>
    await ticketera.datos(areaCodigo, { cerrados: req.query.cerrados === '1', soloMes, codigo: req.query.ticket || null })));

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

module.exports = { para, resumen, enLaBarra, BANDEJAS };
