// ============================================================
// /soporte — abrir un ticket de soporte técnico
// ============================================================
// Lo puede hacer cualquiera que haya entrado: un fallo, una mejora, una duda.
// Quien lo abre ve LOS SUYOS y solo los suyos; la bandeja entera es del
// desarrollador, en /tickets-telecab.
//
// Desde el 15/09/2026 los tickets viven en la tabla `ticket`, la misma que los
// del formulario. Antes tenían su propia hoja, su propio esquema y su propia
// pantalla, para acabar contestando a las mismas preguntas.

const express = require('express');
const router = express.Router();
const ticketera = require('../modules/Ticketera/ticketera.service');
const actor = require('../services/repo/actor');
const drive = require('../services/drive');

// Los adjuntos llegan en base64 dentro del JSON → se sube el límite solo aquí.
router.use(express.json({ limit: '40mb' }));

const quien = async req => ({
  usuarioId: await actor.idDe(req),
  nombre: `${(req.usuario && req.usuario.nombre) || ''} ${(req.usuario && req.usuario.apellidos) || ''}`.trim()
          || (req.usuario && req.usuario.email) || '',
  rol: (req.usuario && req.usuario.rol) || '',
});

router.get('/', (req, res) => {
  res.render('soporte', { titulo: 'Soporte técnico', seccion: 'soporte', layout: 'layout-gestion' });
});

// Los que ha abierto el propio usuario, para ver en qué van.
router.get('/api/mis-tickets', async (req, res) => {
  try {
    const q = await quien(req);
    res.json({ status: 'ok', ...(await ticketera.mios(q.usuarioId)) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

/**
 * Crea un ticket. Los adjuntos [{nombre, mime, base64}] se suben a Drive y en el
 * ticket queda solo su enlace.
 *
 * SI UN ADJUNTO FALLA, EL TICKET SE CREA IGUAL. Lo que no se puede perder es el
 * reporte: que no haya subido un pantallazo no puede tirar por tierra la
 * descripción de un fallo que alguien acaba de escribir. Se avisa de cuáles
 * fallaron y ya se adjuntarán luego.
 */
router.post('/crear', async (req, res) => {
  try {
    const b = req.body || {};
    const q = await quien(req);
    const adjuntos = [];
    const avisos = [];

    // La carpeta de Drive lleva un nombre provisional porque el código del
    // ticket lo da la base al crearlo, y los ficheros se suben antes.
    const carpeta = `Soporte-${Date.now().toString(36)}`;
    for (const a of (Array.isArray(b.adjuntos) ? b.adjuntos : [])) {
      if (!a || !a.base64) continue;
      try {
        const f = await drive.subir(carpeta, { nombre: a.nombre, mime: a.mime, base64: a.base64 });
        adjuntos.push({ nombre: f.name, link: f.webViewLink || '', id: f.id, mime: f.mimeType || '' });
      } catch (e) {
        avisos.push(`No se pudo subir "${a.nombre || 'archivo'}": ${e.message}`);
      }
    }

    const t = await ticketera.crearSoporte({
      tipo: b.tipo, prioridad: b.prioridad, titulo: b.titulo,
      descripcion: b.descripcion, adjuntos,
    }, q);
    res.json({ status: 'ok', id: t.codigo, adjuntos: adjuntos.length, avisos });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
