const express = require('express');
const router = express.Router();
const { leerTickets, DOCUMENTOS, parseDoc, faltantesAlta } = require('../services/tickets');

// Fichas de conductores: toda la info recopilada + documentos. Consulta (solo
// lectura) para RRHH, Selección y Administración. Tráfico no la necesita (tiene
// los datos básicos en la agenda, sin documentos).
router.get('/', (req, res) => {
  res.render('fichas', { titulo: 'Fichas', seccion: 'fichas', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const fichas = (lista || [])
      .filter(t => (t.nombre || '').toString().trim() || (t.apellidos || '').toString().trim())
      .map(t => {
        const documentos = DOCUMENTOS.map(d => {
          const doc = parseDoc(t[d.col]);
          return { key: d.key, label: d.label, link: (doc && doc.link) || '', nombre: (doc && doc.nombre) || '' };
        });
        const fp = parseDoc(t.ficha_pdf);
        const faltan = faltantesAlta(t);
        // Se quitan las columnas de documentos crudas (JSON) del payload: ya van
        // parseadas en `documentos`, y así la lista de 300+ no pesa de más.
        const { doc_dni, doc_dni_reverso, doc_carnet, doc_carnet_reverso,
                doc_bancario, doc_seg_social, doc_penales, ficha_pdf, ...campos } = t;
        return {
          ...campos, documentos,
          ficha_pdf_link: (fp && fp.link) || '',
          faltan, completa: faltan.length === 0
        };
      })
      .sort((a, b) => `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`, 'es'));
    res.json({ status: 'ok', fichas });
  } catch (error) {
    console.error('❌ [Fichas] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
