const express = require('express');
const router = express.Router();
const {
  leerTickets, leerTicket, DOCUMENTOS, parseDoc, faltantesAlta,
  buscarPorIdBolt, crearFichaConductor, crearFichasConductores, normalizarTel, telValido
} = require('../services/tickets');
const { leerTablero, leerOut, cambiarEstados } = require('../services/planificadorV2');

// Estados que se pueden fijar directamente desde la ficha (sin fechas). Las ausencias
// temporales (Vacaciones / Baja Médica / Permiso) van por Peticiones, que llevan fechas.
const ESTADOS_FICHA = ['Activo', 'Pendiente Asignar', 'Suspendido', 'Baja Empresa'];

// Un conductor de la agenda → datos para crear su ficha (los que falten van vacíos).
const jornadaDe = contrato => /32/.test(contrato || '') ? '32 HORAS' : (/40/.test(contrato || '') ? '40 HORAS' : '');
const canalDe = contrato => /ETT/i.test(contrato || '') ? 'Bolsa de Empleo (ETT)' : '';
function fichaDesdeConductor(c) {
  return {
    tel: c.telefono, nombre: c.nombre, id_bolt: c.idBolt, dni: c.dni, num_seg_social: c.naf,
    turno: c.turno, direccion: c.direccion, fecha_alta: c.fechaAlta,
    jornada: jornadaDe(c.contrato), canal: canalDe(c.contrato)
  };
}
function fichaDesdeOut(f) {
  return { tel: f.telefono, nombre: f.nombre, id_bolt: f.id, turno: f.turno, jornada: jornadaDe(f.contrato), canal: canalDe(f.contrato) };
}

// Fichas de conductores: toda la info recopilada + documentos. Consulta (solo
// lectura) para RRHH, Selección y Administración. Tráfico no la necesita (tiene
// los datos básicos en la agenda, sin documentos).
router.get('/', (req, res) => {
  res.render('fichas', { titulo: 'Fichas', seccion: 'fichas', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const [{ lista }, tablero, out] = await Promise.all([
      leerTickets(),
      leerTablero().catch(() => null),
      leerOut().catch(() => ({ fichas: [] }))
    ]);
    const norm = s => String(s || '').trim().toLowerCase();
    // Estado OPERATIVO por ID_BOLT: de la agenda activa o "archivado" si está en OUT.
    const opPorId = new Map();
    ((tablero && tablero.conductores) || []).forEach(c => {
      if (c.idBolt) opPorId.set(norm(c.idBolt), { estado: c.estadoCalculado || c.estado || '', enAgenda: true });
    });
    ((out && out.fichas) || []).forEach(f => {
      if (f.id && !opPorId.has(norm(f.id))) opPorId.set(norm(f.id), { estado: f.estado || 'Baja Empresa', enAgenda: false });
    });

    const fichas = (lista || [])
      .filter(t => (t.nombre || '').toString().trim() || (t.apellidos || '').toString().trim())
      .map(t => {
        const documentos = DOCUMENTOS.map(d => {
          const doc = parseDoc(t[d.col]);
          return { key: d.key, label: d.label, link: (doc && doc.link) || '', nombre: (doc && doc.nombre) || '' };
        });
        const fp = parseDoc(t.ficha_pdf);
        const faltan = faltantesAlta(t);
        const op = opPorId.get(norm(t.id_bolt)) || null;
        // Se quitan las columnas de documentos crudas (JSON): ya van parseadas.
        const { doc_dni, doc_dni_reverso, doc_carnet, doc_carnet_reverso,
                doc_bancario, doc_seg_social, doc_penales, ficha_pdf, ...campos } = t;
        return {
          ...campos, documentos,
          ficha_pdf_link: (fp && fp.link) || '',
          faltan, completa: faltan.length === 0,
          estado_agenda: op ? op.estado : '', en_agenda: op ? op.enAgenda : false
        };
      })
      .sort((a, b) => `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`, 'es'));
    res.json({ status: 'ok', fichas });
  } catch (error) {
    console.error('❌ [Fichas] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Cambia el estado OPERATIVO (agenda) de un conductor desde su ficha.
router.post('/estado', async (req, res) => {
  try {
    const b = req.body || {};
    const idBolt = String(b.idBolt || '').trim();
    const estado = String(b.estado || '').trim();
    if (!idBolt) throw new Error('Falta el ID_BOLT');
    if (!ESTADOS_FICHA.includes(estado)) throw new Error('Ese estado no se puede fijar desde la ficha (usa Peticiones para las ausencias)');
    await cambiarEstados([{ id: idBolt, estado }]);
    res.json({ status: 'ok', estado });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Datos completos de UNA ficha (por teléfono), con su estado operativo. Para el
// detalle que abre Plantilla al pinchar un conductor.
router.get('/api/ficha/:tel', async (req, res) => {
  try {
    const tel = String(req.params.tel || '').replace(/\D/g, '').slice(-9);
    const [t, tablero, out] = await Promise.all([
      leerTicket(tel), leerTablero().catch(() => null), leerOut().catch(() => ({ fichas: [] }))
    ]);
    if (!t) return res.status(404).json({ status: 'error', msg: 'Ficha no encontrada' });
    const norm = s => String(s || '').trim().toLowerCase();
    let op = null;
    const c = ((tablero && tablero.conductores) || []).find(x => norm(x.idBolt) === norm(t.id_bolt));
    if (c) op = { estado: c.estadoCalculado || c.estado || '', enAgenda: true };
    else { const o = ((out && out.fichas) || []).find(x => norm(x.id) === norm(t.id_bolt)); if (o) op = { estado: o.estado || 'Baja Empresa', enAgenda: false }; }

    const documentos = DOCUMENTOS.map(d => { const doc = parseDoc(t[d.col]); return { key: d.key, label: d.label, link: (doc && doc.link) || '', nombre: (doc && doc.nombre) || '' }; });
    const fp = parseDoc(t.ficha_pdf);
    const faltan = faltantesAlta(t);
    const { doc_dni, doc_dni_reverso, doc_carnet, doc_carnet_reverso,
            doc_bancario, doc_seg_social, doc_penales, ficha_pdf, ...campos } = t;
    res.json({
      status: 'ok',
      ficha: { ...campos, documentos, ficha_pdf_link: (fp && fp.link) || '', faltan, completa: faltan.length === 0, estado_agenda: op ? op.estado : '', en_agenda: op ? op.enAgenda : false }
    });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Asegura la ficha de un conductor por su ID_BOLT: la busca; si no está, la crea con
// los datos de la agenda (o de las bajas). Devuelve el teléfono para abrir su ficha.
router.post('/asegurar', async (req, res) => {
  try {
    const idBolt = String((req.body || {}).idBolt || '').trim();
    if (!idBolt) throw new Error('Falta el ID_BOLT');
    const existente = await buscarPorIdBolt(idBolt);
    if (existente) return res.json({ status: 'ok', tel: existente.id, creada: false });

    const norm = s => String(s || '').trim().toLowerCase();
    const [tablero, out] = await Promise.all([leerTablero().catch(() => null), leerOut().catch(() => ({ fichas: [] }))]);
    let datos = ((tablero && tablero.conductores) || []).filter(c => norm(c.idBolt) === norm(idBolt)).map(fichaDesdeConductor)[0];
    if (!datos) datos = ((out && out.fichas) || []).filter(f => norm(f.id) === norm(idBolt)).map(fichaDesdeOut)[0];
    if (!datos) throw new Error('No encuentro ese conductor en la agenda ni en las bajas');

    if (!telValido(normalizarTel(datos.tel))) {
      return res.json({ status: 'ok', creada: false, sinTelefono: true, msg: 'El conductor no tiene teléfono en la agenda; ponlo primero para crear la ficha.' });
    }
    const t = await crearFichaConductor(datos);
    res.json({ status: 'ok', tel: t.id, creada: true });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// Crea de una vez las fichas de TODOS los conductores (agenda + bajas) que no la tengan.
router.post('/crear-todas', async (req, res) => {
  try {
    const [{ lista }, tablero, out] = await Promise.all([leerTickets(), leerTablero().catch(() => null), leerOut().catch(() => ({ fichas: [] }))]);
    const norm = s => String(s || '').trim().toLowerCase();
    const yaTienen = new Set((lista || []).map(t => norm(t.id_bolt)).filter(Boolean));
    const datos = [
      ...((tablero && tablero.conductores) || []).filter(c => c.idBolt && !yaTienen.has(norm(c.idBolt))).map(fichaDesdeConductor),
      ...((out && out.fichas) || []).filter(f => f.id && !yaTienen.has(norm(f.id))).map(fichaDesdeOut)
    ];
    const r = await crearFichasConductores(datos);
    res.json({ status: 'ok', creadas: r.creadas, sinTelefono: r.sinTelefono, yaTenian: yaTienen.size });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
