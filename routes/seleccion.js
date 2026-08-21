const express = require('express');
const multer = require('multer');
const router = express.Router();
const { leerVacantesGuardadas, vacanteDisponible } = require('../services/vacantes');
const { buscarPorTelefono } = require('../services/conductoresBolt');
const { geocodificar, geocodificarEstructurado } = require('../services/geocoding');
const drive = require('../services/drive');
const { generarFichaPDF } = require('../services/fichaAlta');
const {
  leerTickets, leerTicket, guardarTicket, cambiarEtapaCandidatura, enviarABolt, descartar,
  guardarDocumento, guardarCelda, parseDoc,
  CANALES, ETAPAS_CANDIDATURA, ESTADOS, ETAPAS, DOCUMENTOS, normalizarTel
} = require('../services/tickets');

// Los archivos llegan como multipart (no JSON), así que esquivan el límite global
// de 2 MB de app.js. En memoria; hasta 25 MB por archivo.
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Clave estable para la carpeta de Drive del candidato. Se prefiere el DNI (que
// también usará la agenda cuando pase a activo), luego el nombre, luego el tel.
function claveDe(t) {
  return (t.dni || t.nombre || t.id || '').toString().trim();
}

// Vista de Selección (funnel de candidatos).
router.get('/', async (req, res) => {
  let vacantes = [];
  try {
    // Solo vacantes DISPONIBLES: las "En proceso de alta" ya tienen un candidato
    // y las Cerradas están resueltas, así que no se pueden volver a reclutar.
    vacantes = (await leerVacantesGuardadas()).filter(vacanteDisponible);
  } catch (e) { console.error('❌ [Selección] vacantes:', e.message); }
  res.render('seleccion', {
    titulo: 'Selección',
    seccion: 'seleccion',
    layout: 'layout-gestion',
    canales: CANALES,
    etapas: ETAPAS_CANDIDATURA,
    vacantes
  });
});

// Candidatos del funnel, agrupados por etapa de candidatura.
router.get('/api/datos', async (req, res) => {
  try {
    const { lista } = await leerTickets();
    const enFunnel = lista.filter(t => t.etapa === ETAPAS.SELECCION
      && ETAPAS_CANDIDATURA.includes(t.estado));
    const porEtapa = {};
    ETAPAS_CANDIDATURA.forEach(e => { porEtapa[e] = []; });
    enFunnel.forEach(t => porEtapa[t.estado].push(t));

    const descartados = lista.filter(t => t.estado === ESTADOS.DESCARTADO).length;
    // Fichas que RRHH devolvió a Selección, con su motivo, para revisarlas.
    const rechazadosRRHH = lista.filter(t => t.estado === ESTADOS.RECHAZADO_RRHH);

    res.json({
      status: 'ok',
      porEtapa, rechazadosRRHH,
      contadores: {
        funnel: enFunnel.length,
        porEtapa: ETAPAS_CANDIDATURA.reduce((a, e) => (a[e] = porEtapa[e].length, a), {}), descartados, rechazadosRRHH: rechazadosRRHH.length
      }
    });
  } catch (error) {
    console.error('❌ [Selección] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Un ticket concreto por teléfono (para cargarlo en la ficha).
router.get('/api/ticket/:tel', async (req, res) => {
  try {
    const { normalizarTel } = require('../services/tickets');
    const tel = normalizarTel(req.params.tel);
    const { porTel } = await leerTickets();
    const t = porTel.get(tel) || null;
    let bolt = null;
    try { bolt = await buscarPorTelefono(tel); } catch (_) { /* histórico opcional */ }
    res.json({ status: 'ok', ticket: t, enBolt: !!bolt, boltNombre: bolt ? bolt.nombre : '' });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Crear / actualizar ticket (upsert por teléfono).
router.post('/ticket', async (req, res) => {
  try {
    const t = await guardarTicket(req.body || {});
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Mover de etapa dentro del funnel.
router.post('/etapa', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await cambiarEtapaCandidatura(b.tel, b.estado);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Enviar la solicitud a BOLT (solo tras completar el funnel).
router.post('/bolt', async (req, res) => {
  try {
    const t = await enviarABolt((req.body || {}).tel);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Descartar candidato.
router.post('/descartar', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await descartar(b.tel, b.motivo);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Geocodifica una dirección. Si llegan las partes (via/numero/CP/localidad/…),
// usa la búsqueda estructurada (más fiable); si no, la libre por compatibilidad.
router.post('/geocodificar', async (req, res) => {
  try {
    const b = req.body || {};
    // Estructurada solo si hay nombre de vía; si no (p. ej. dirección pegada entera),
    // búsqueda libre para no perder la calle.
    const r = (b.via && b.via.trim())
      ? await geocodificarEstructurado({
          tipo_via: b.tipo_via, via: b.via, numero: b.numero,
          codigo_postal: b.codigo_postal, localidad: b.localidad, provincia: b.provincia
        })
      : await geocodificar(b.direccion, b.codigoPostal || b.codigo_postal);
    if (!r) return res.json({ status: 'ok', encontrado: false });
    if (r.error) return res.status(502).json({ status: 'error', msg: r.mensaje });
    res.json({ status: 'ok', encontrado: true, ...r, coordenadas: `${r.lat}, ${r.lng}` });
  } catch (error) {
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Sube UNO de los 7 documentos de la ficha a Drive y guarda su enlace en el
// ticket. multipart: campo 'archivo' + campos de texto tel y tipo.
router.post('/documento', subida.single('archivo'), async (req, res) => {
  try {
    const tel = normalizarTel((req.body || {}).tel);
    const tipo = (req.body || {}).tipo;
    const def = DOCUMENTOS.find(d => d.key === tipo);
    if (!def) return res.status(400).json({ status: 'error', msg: 'Tipo de documento no válido' });
    if (!req.file) return res.status(400).json({ status: 'error', msg: 'No llegó ningún archivo' });

    // El ticket se crea solo si aún no existía (sin pisar nada: guardarDocumento
    // escribe luego únicamente la celda del documento).
    let t = await leerTicket(tel);
    if (!t) { await guardarTicket({ tel }); t = await leerTicket(tel); }

    // Si ya había un documento de este tipo, se sobrescribe (mismo archivo/enlace).
    const previo = parseDoc(t[def.col]);
    const nombre = `${tipo.toUpperCase()} — ${req.file.originalname}`;
    const archivo = await drive.subir(claveDe(t), {
      nombre, mime: req.file.mimetype, base64: req.file.buffer.toString('base64'),
      fileId: previo && previo.id
    });
    const doc = { id: archivo.id, link: archivo.webViewLink, nombre: archivo.name, mime: archivo.mimeType };
    await guardarDocumento(tel, tipo, doc);
    res.json({ status: 'ok', doc });
  } catch (error) {
    console.error('❌ [Selección] documento:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Quita un documento (lo borra de Drive y limpia la celda del ticket).
router.delete('/documento', async (req, res) => {
  try {
    const tel = normalizarTel((req.body || {}).tel);
    const tipo = (req.body || {}).tipo;
    const def = DOCUMENTOS.find(d => d.key === tipo);
    if (!def) return res.status(400).json({ status: 'error', msg: 'Tipo de documento no válido' });
    const t = await leerTicket(tel);
    const doc = t ? parseDoc(t[def.col]) : null;
    if (doc && doc.id) { try { await drive.borrar(doc.id); } catch (_) { /* ya no estaba */ } }
    await guardarDocumento(tel, tipo, null);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('❌ [Selección] borrar documento:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Genera la FICHA DE ALTA (PDF): formulario + cada documento adjunto. La guarda
// en la carpeta de Drive del candidato y devuelve el enlace para abrirla.
router.post('/ficha', async (req, res) => {
  try {
    const tel = normalizarTel((req.body || {}).tel);
    const t = await leerTicket(tel);
    if (!t) return res.status(400).json({ status: 'error', msg: 'No existe el ticket' });

    // Descarga los documentos ya subidos para incrustarlos.
    const documentos = [];
    for (const def of DOCUMENTOS) {
      const doc = parseDoc(t[def.col]);
      if (!doc || !doc.id) continue;
      try {
        const { bytes, mime } = await drive.descargar(doc.id);
        documentos.push({ label: def.label, bytes, mime });
      } catch (e) {
        console.error(`❌ [Selección] no se pudo descargar ${def.key}:`, e.message);
      }
    }

    const pdf = await generarFichaPDF(t, documentos);
    const nombreFicha = `FICHA DE ALTA - ${(t.nombre || tel).toString().trim()}.pdf`;
    // Si ya se había generado, se sobrescribe el mismo PDF (mismo enlace).
    const fichaPrev = parseDoc(t.ficha_pdf);
    const archivo = await drive.subir(claveDe(t), {
      nombre: nombreFicha, mime: 'application/pdf', base64: Buffer.from(pdf).toString('base64'),
      fileId: fichaPrev && fichaPrev.id
    });
    const ficha = { id: archivo.id, link: archivo.webViewLink, nombre: archivo.name, mime: 'application/pdf' };
    await guardarCelda(tel, 'ficha_pdf', JSON.stringify(ficha));
    res.json({ status: 'ok', ficha, link: archivo.webViewLink, nombre: nombreFicha, adjuntos: documentos.length });
  } catch (error) {
    console.error('❌ [Selección] ficha:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
