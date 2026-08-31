// ============================================================
// SELECCIÓN — rutas
// ============================================================
// Lee y escribe en PostgreSQL. Ya no toca la hoja TICKETS.
//
// Mismo contrato que Vehículos y Plantilla, para que el componente `Listado` no
// tenga que aprender nada nuevo:
//   · /api/lista      → { filas, resumen }
//   · /api/ficha/:id  → la ficha entera
//
// La clave es el ID DE LA CANDIDATURA. El teléfono sirve para BUSCAR a alguien
// —es lo que se sabe de un candidato antes que nada—, pero no identifica: una
// persona puede cambiar de número y haber tenido dos procesos.

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { leerVacantesGuardadas, vacanteDisponible } = require('../services/vacantes');
const { geocodificar, geocodificarEstructurado } = require('../services/geocoding');
const drive = require('../services/drive');
const { generarFichaPDF } = require('../services/fichaAlta');
const cand = require('../services/repo/candidaturas');
const docs = require('../services/repo/documentos');
const actor = require('../services/repo/actor');

// Los archivos llegan como multipart (no JSON), así que esquivan el límite
// global de 2 MB de app.js. En memoria; hasta 25 MB por archivo.
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Quién hace el cambio. Todo lo que escribe pasa por aquí. */
const quien = async req => ({
  usuarioId: await actor.idDe(req),
  rol: (req.usuario || {}).rol || '',
});

/** Recoge el error y lo devuelve legible, sin repetirlo diez veces. */
const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [SELECCIÓN] ${req.method} ${req.path}: ${e.message}`);
    // `conflicto` y `situacion` viajan con el error: dicen de QUIÉN se trata y
    // qué se puede hacer. Sin eso la pantalla solo puede enseñar un mensaje y
    // dejar a quien lo lee sin salida.
    res.status(400).json({ status: 'error', msg: e.message, conflicto: e.conflicto, situacion: e.situacion });
  }
};

// Los documentos que pide la ficha de alta, con el nombre corto que usa la
// pantalla y el tipo que usa la base. La pantalla dice "carnet"; el catálogo,
// "permiso de conducir". La traducción vive aquí y no en los dos sitios.
const DOCUMENTOS = [
  { key: 'dni',            tipo: 'dni',             label: 'DNI/NIE (frente)' },
  { key: 'dni_reverso',    tipo: 'dni_reverso',     label: 'DNI/NIE (reverso)' },
  { key: 'carnet',         tipo: 'permiso',         label: 'Carné de conducir (frente)' },
  { key: 'carnet_reverso', tipo: 'permiso_reverso', label: 'Carné de conducir (reverso)' },
  { key: 'bancario',       tipo: 'cuenta',          label: 'Certificado bancario' },
  { key: 'seg_social',     tipo: 'vida_laboral',    label: 'Vida laboral / certificado SS' },
  { key: 'penales',        tipo: 'penales',         label: 'Certificado de delitos sexuales' },
];

router.get('/', async (req, res) => {
  let vacantes = [], catalogos = { estados: [], canales: [], turnos: [], zonas: [], funnel: [] };
  try {
    // Solo vacantes DISPONIBLES: las "En proceso de alta" ya tienen candidato y
    // las Cerradas están resueltas.
    vacantes = (await leerVacantesGuardadas()).filter(vacanteDisponible);
  } catch (e) { console.error('❌ [Selección] vacantes:', e.message); }
  try { catalogos = await cand.catalogos(); } catch (e) {
    console.error('❌ [Selección] catálogos:', e.message);
  }
  res.render('seleccion', {
    titulo: 'Selección', seccion: 'seleccion', layout: 'layout-gestion',
    vacantes, catalogos, documentos: DOCUMENTOS,
  });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/lista', responde(async req => {
  const filas = await cand.listar({ incluirCerradas: req.query.cerradas === '1' });
  const { estados, funnel } = await cand.catalogos();

  // El resumen se calcula sobre lo que ya se ha traído: son contadores de una
  // lista de decenas de filas, no hace falta otra consulta.
  const porEstado = {};
  filas.forEach(f => { porEstado[f.estado] = (porEstado[f.estado] || 0) + 1; });

  return {
    filas,
    resumen: {
      total: filas.length,
      enFunnel: filas.filter(f => f.en_funnel).length,
      porEstado,
      // El recorrido, en orden y con su etiqueta, para que la pantalla no lleve
      // su propia copia de las etapas.
      funnel: funnel.map(c => {
        const e = estados.find(x => x.codigo === c) || {};
        return { codigo: c, etiqueta: e.etiqueta, cuantos: porEstado[c] || 0 };
      }),
    },
  };
}));

router.get('/api/ficha/:id', responde(async req => {
  const f = await cand.ficha(Number(req.params.id));
  if (!f) { const e = new Error('No existe esa candidatura'); throw e; }
  return { ...f, faltan: await cand.faltantes(f.id), documentosPedidos: DOCUMENTOS };
}));

router.get('/api/catalogos', responde(() => cand.catalogos()));

// Qué hay detrás de un teléfono ANTES de abrir nada: si hay proceso vivo, si
// tenemos ficha suya y si está en BOLT, con qué número. Es lo que deja decidir
// entre continuar, restaurar o empezar de cero.
router.get('/api/telefono/:tel', responde(req => cand.porTelefono(req.params.tel)));

// ── Escritura ──────────────────────────────────────────────────────────────

router.post('/api/candidatura', responde(async req =>
  cand.abrir((req.body || {}).telefono, req.body || {}, await quien(req))));

router.put('/api/candidatura/:id', responde(async req =>
  cand.guardar(Number(req.params.id), req.body || {}, await quien(req))));

router.post('/api/candidatura/:id/estado', responde(async req => {
  const b = req.body || {};
  return cand.cambiarEstado(Number(req.params.id), b.estado, { motivo: b.motivo, ...(await quien(req)) });
}));

// Selección termina: se le abre el contrato y pasa a RRHH.
router.post('/api/candidatura/:id/rrhh', responde(async req => {
  const r = await cand.pasarARRHH(Number(req.params.id), req.body || {}, await quien(req));
  console.log(`👤 [SELECCIÓN] ${r.quien} pasa a RRHH (ficha ${r.conductorId})` +
              (r.faltaBolt ? ' — SIN cuenta de BOLT' : ''));
  return r;
}));

// Borrar una candidatura que no debería existir: un teléfono mal tecleado, una
// fila duplicada, una prueba. NO es descartar — descartar deja rastro porque es
// una decisión del proceso. Se niega si la persona ha trabajado aquí.
router.delete('/api/candidatura/:id', responde(async req =>
  cand.eliminar(Number(req.params.id), await quien(req))));

// ── Documentos ─────────────────────────────────────────────────────────────
// Van a la tabla `documento`, que es de la PERSONA. Los bytes siguen en Drive;
// lo que cambia es que ahora están indexados, con su tipo y su caducidad, en vez
// de ser un JSON dentro de una celda.

router.post('/api/candidatura/:id/documento', subida.single('archivo'), responde(async req => {
  const b = req.body || {};
  const def = DOCUMENTOS.find(d => d.key === b.tipo);
  if (!def) throw new Error('Tipo de documento no válido');
  if (!req.file) throw new Error('No llegó ningún archivo');

  const id = Number(req.params.id);
  const f = await cand.ficha(id);
  if (!f) throw new Error('No existe esa candidatura');

  const doc = await docs.subir({
    conductorId: f.conductor_id,
    tipo: def.tipo,
    nombre: `${def.label} — ${req.file.originalname}`,
    mime: req.file.mimetype,
    base64: req.file.buffer.toString('base64'),
    fechaEmision: b.emision || null,
    fechaCaduca: b.caduca || null,
  }, await quien(req));

  return { doc, faltan: await cand.faltantes(id) };
}));

router.delete('/api/documento/:docId', responde(async req =>
  ({ retirado: await docs.retirar(Number(req.params.docId), {
    borrarArchivo: true, ...(await quien(req)),
  }) })));

// ── La FICHA DE ALTA en PDF ────────────────────────────────────────────────
router.post('/api/candidatura/:id/ficha-pdf', responde(async req => {
  const id = Number(req.params.id);
  const datos = await cand.paraFicha(id);
  const f = await cand.ficha(id);

  // Los documentos ya subidos, para incrustarlos en el PDF.
  const adjuntos = [];
  for (const def of DOCUMENTOS) {
    const d = (f.documentos || []).find(x => x.tipo === def.tipo && x.vigente);
    if (!d) continue;
    try {
      const a = await docs.descargar(d.id);
      adjuntos.push({ label: def.label.toUpperCase(), bytes: a.bytes, mime: a.mime });
    } catch (e) {
      console.error(`❌ [Selección] no se pudo descargar ${def.key}: ${e.message}`);
    }
  }

  const pdf = await generarFichaPDF(datos, adjuntos);
  const nombre = `FICHA DE ALTA - ${(datos.nombre || datos.telefono || id).toString().trim()}.pdf`;
  const archivo = await drive.subir(String(datos.conductorId), {
    nombre, mime: 'application/pdf', base64: Buffer.from(pdf).toString('base64'),
  });
  return { link: archivo.webViewLink, nombre, adjuntos: adjuntos.length };
}));

// ── Geocodificación ────────────────────────────────────────────────────────
// Se queda igual: es un servicio externo que no tiene que ver con dónde se
// guarden los datos.
router.post('/api/geocodificar', responde(async req => {
  const b = req.body || {};
  return (b.via && b.via.trim())
    ? geocodificarEstructurado({
      via: b.via, numero: b.numero, tipoVia: b.tipoVia,
      codigoPostal: b.codigo_postal, localidad: b.localidad, provincia: b.provincia,
    })
    : geocodificar(b.direccion);
}));

module.exports = router;
