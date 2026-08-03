const express = require('express');
const router = express.Router();
const it = require('../services/ticketsIT');
const drive = require('../services/drive');

// Los adjuntos llegan en base64 dentro del JSON → se sube el límite solo aquí.
router.use(express.json({ limit: '40mb' }));

const solicitanteDe = req => ({
  email: (req.usuario && req.usuario.email) || '',
  nombre: `${(req.usuario && req.usuario.nombre) || ''} ${(req.usuario && req.usuario.apellidos) || ''}`.trim(),
  rol: (req.usuario && req.usuario.rol) || ''
});

// Página para montar un ticket (todos los usuarios).
router.get('/', (req, res) => {
  res.render('soporte', { titulo: 'Soporte técnico', seccion: 'soporte', layout: 'layout-gestion' });
});

// Los tickets que ha abierto el propio usuario (para ver su estado).
router.get('/api/mis-tickets', async (req, res) => {
  try {
    res.json({ status: 'ok', tickets: await it.leerMisTickets((req.usuario || {}).email), tipos: it.TIPOS, prioridades: it.PRIORIDADES });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Crea un ticket. Los adjuntos [{nombre, mime, base64}] se suben a Drive primero
// (a la carpeta del ticket) y en la hoja solo queda su enlace. Si un adjunto falla,
// el ticket se crea igual (no se pierde el reporte) y se avisa de cuáles fallaron.
router.post('/crear', async (req, res) => {
  try {
    const b = req.body || {};
    const titulo = String(b.titulo || '').trim();
    if (!titulo) throw new Error('Ponle un título al ticket');

    const id = it.nuevoId();
    const adjuntos = [];
    const avisos = [];
    for (const a of (Array.isArray(b.adjuntos) ? b.adjuntos : [])) {
      if (!a || !a.base64) continue;
      try {
        const f = await drive.subir(`Soporte-${id}`, { nombre: a.nombre, mime: a.mime, base64: a.base64 });
        adjuntos.push({ nombre: f.name, link: f.webViewLink || '', id: f.id, mime: f.mimeType || '' });
      } catch (e) {
        avisos.push(`No se pudo subir "${a.nombre || 'archivo'}": ${e.message}`);
      }
    }

    const t = await it.crearTicket({
      id, solicitante: solicitanteDe(req),
      tipo: b.tipo, prioridad: b.prioridad, titulo, descripcion: b.descripcion, adjuntos
    });
    console.log(`🎫 [Soporte] ${t.id} "${t.titulo}" por ${t.solicitante_email}${adjuntos.length ? ` (+${adjuntos.length} adj.)` : ''}`);
    res.json({ status: 'ok', id: t.id, adjuntos: adjuntos.length, avisos });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
