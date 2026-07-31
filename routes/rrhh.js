const express = require('express');
const router = express.Router();
const {
  leerTickets, leerTicket, procesarAltaRRHH, noContinuarRRHH, devolverRRHH,
  guardarCelda, parseDoc, DOCUMENTOS, ESTADOS
} = require('../services/tickets');
const { generarAltasExcel } = require('../services/altasExcel');
const drive = require('../services/drive');

// Una ficha es de ETT según su canal de origen ("… (ETT)"). Las de ETT solo van
// en Excels de ETT; el resto, en los nuestros (general).
const esETT = t => /ETT/i.test(((t && t.canal) || '').toString());

// Tablero de RRHH: recibe los "Aprobado en BOLT" y tramita el alta.
router.get('/', (req, res) => {
  res.render('rrhh', {
    titulo: 'RRHH',
    seccion: 'rrhh',
    layout: 'layout-gestion'
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    // Cada ficha lleva su flag ETT y sus documentos parseados (para verificar en
    // RRHH sin ir a otra pantalla). Las columnas doc_* crudas se quitan del payload.
    const preparar = t => {
      const documentos = DOCUMENTOS.map(d => {
        const doc = parseDoc(t[d.col]);
        return { key: d.key, label: d.label, tiene: !!(doc && doc.id), mime: (doc && doc.mime) || '', link: (doc && doc.link) || '' };
      });
      const fp = parseDoc(t.ficha_pdf);
      const { doc_dni, doc_dni_reverso, doc_carnet, doc_carnet_reverso,
              doc_bancario, doc_seg_social, doc_penales, ficha_pdf, ...campos } = t;
      return { ...campos, ett: esETT(t), documentos, ficha_pdf_link: (fp && fp.link) || '' };
    };
    const porTramitar = lista.filter(t => t.estado === ESTADOS.APROBADO_BOLT).map(preparar);
    const altas = lista.filter(t => t.estado === ESTADOS.ALTA).map(preparar);
    const noAlta = lista.filter(t => t.estado === ESTADOS.NO_ALTA).map(preparar);
    res.json({
      status: 'ok', porTramitar, altas, noAlta,
      contadores: {
        porTramitar: porTramitar.length, altas: altas.length, noAlta: noAlta.length,
        ett: porTramitar.filter(t => t.ett).length, general: porTramitar.filter(t => !t.ett).length
      }
    });
  } catch (error) {
    console.error('❌ [RRHH] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Tramitar el alta → crea la ficha en AGENDA_V2 (Pendiente Asignar) y pasa a Tráfico.
router.post('/alta', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await procesarAltaRRHH(b.tel, {
      fecha_alta: b.fecha_alta, fecha_habilitado: b.fecha_habilitado
    });
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// RRHH decide no continuar con el alta.
router.post('/no-continuar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await noContinuarRRHH(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// RRHH devuelve la ficha a Selección (Rechazado RRHH) con el motivo.
router.post('/devolver', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await devolverRRHH(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Genera el Excel de Altas para un grupo de fichas + una fecha elegidos por RRHH.
router.post('/altas-excel', async (req, res) => {
  try {
    const { tels, fecha } = req.body || {};
    const tipo = (req.body || {}).tipo === 'ett' ? 'ett' : 'general';
    if (!Array.isArray(tels) || !tels.length) {
      return res.status(400).json({ status: 'error', msg: 'No hay fichas seleccionadas' });
    }
    if (!fecha || !String(fecha).trim()) {
      return res.status(400).json({ status: 'error', msg: 'Elige la fecha del grupo de altas' });
    }
    const { lista } = await leerTickets();
    const pedidos = new Set(tels.map(t => String(t)));
    const fichas = (lista || []).filter(t => pedidos.has(String(t.id)));
    if (!fichas.length) return res.status(400).json({ status: 'error', msg: 'No se encontraron esas fichas' });

    // La ETT no se mezcla con lo nuestro: todas las fichas del Excel deben ser del
    // mismo tipo que el Excel que se está generando.
    const noCoincide = fichas.filter(t => esETT(t) !== (tipo === 'ett'));
    if (noCoincide.length) {
      return res.status(400).json({ status: 'error',
        msg: `Estas no son de ${tipo === 'ett' ? 'ETT' : 'nuestras'}: ` + noCoincide.map(t => t.nombre || t.id).join(', ') });
    }

    // El valor de excel_alta lleva "ETT " delante para diferenciar los grupos (y que
    // Plantilla los separe). Una ficha solo puede ir en UN Excel.
    const etiquetaExcel = (tipo === 'ett' ? 'ETT ' : '') + String(fecha).trim();
    const yaEnOtro = fichas.filter(t => t.excel_alta && String(t.excel_alta).trim() !== etiquetaExcel);
    if (yaEnOtro.length) {
      return res.status(400).json({ status: 'error',
        msg: 'Ya están en otro Excel: ' + yaEnOtro.map(t => `${t.nombre || t.id} (${t.excel_alta})`).join(', ') });
    }

    const buffer = await generarAltasExcel(fichas, fecha);
    for (const t of fichas) {
      if (String(t.excel_alta || '').trim() !== etiquetaExcel) {
        try { await guardarCelda(t.id, 'excel_alta', etiquetaExcel); }
        catch (e) { console.error('❌ [RRHH] marcar excel_alta:', e.message); }
      }
    }
    const etiqueta = String(fecha || '').replace(/[\/]/g, '-') || 'grupo';
    const nombre = 'Altas' + (tipo === 'ett' ? ' ETT' : '') + ' ' + etiqueta + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ [RRHH] altas-excel:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Proxy para ver/abrir un documento de Drive sin salir de RRHH: descarga el
// archivo con la cuenta de servicio y lo devuelve con su tipo (para <img> o
// abrir en pestaña). Así RRHH verifica las fotos/PDF desde la propia tarjeta.
router.get('/doc', async (req, res) => {
  try {
    const tel = (req.query.tel || '').toString();
    const tipo = (req.query.tipo || '').toString();
    const col = tipo === 'ficha_pdf' ? 'ficha_pdf' : (DOCUMENTOS.find(d => d.key === tipo) || {}).col;
    if (!col) return res.status(400).send('Tipo de documento no válido');
    const t = await leerTicket(tel);
    if (!t) return res.status(404).send('Ficha no encontrada');
    const doc = parseDoc(t[col]);
    if (!doc || !doc.id) return res.status(404).send('Sin documento');
    const { bytes, mime } = await drive.descargar(doc.id);
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(bytes);
  } catch (error) {
    console.error('❌ [RRHH] doc preview:', error.message);
    res.status(500).send('Error al cargar el documento');
  }
});

module.exports = router;
