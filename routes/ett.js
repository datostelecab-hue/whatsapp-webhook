// ============================================================
// ETT — bolsa de empleo, sobre PostgreSQL
// ============================================================
// Los candidatos de la agencia son candidaturas como las demás, con
// `canal = bolsa_ett`. Una tabla, dos puertas de entrada: en Selección se
// escribe un teléfono, aquí se pega la tabla del correo.
//
// Ya no hay hoja ETT_CANDIDATOS.
//
// Mismo contrato que las demás pantallas: /api/lista → { filas, ... } y
// /api/ficha/:id. Aquí el extra son las TANDAS: la unidad con la que se le
// contesta a la agencia, y de la que cuelga si toca mandar Excel o no.

const express = require('express');
const router = express.Router();
const cand = require('../services/repo/candidaturas');
const actor = require('../services/repo/actor');
const { generarExcelETT, nombreFichero } = require('../services/ettExcel');

const quien = async req => ({
  usuarioId: await actor.idDe(req),
  rol: (req.usuario || {}).rol || '',
});

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [ETT] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message, conflicto: e.conflicto });
  }
};

const CANAL = 'bolsa_ett';

router.get('/', async (req, res) => {
  let catalogos = { estados: [], canales: [], turnos: [], zonas: [], campos: [] };
  try { catalogos = await cand.catalogos(); } catch (e) {
    console.error('❌ [ETT] catálogos:', e.message);
  }
  res.render('ett', { titulo: 'ETT · Bolsa de empleo', seccion: 'ett', layout: 'layout-gestion', catalogos });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/lista', responde(async () => {
  // Con las cerradas: a la agencia se le responde también por quien no se
  // presentó o no pasó, así que tienen que verse.
  //
  // Las solicitudes van en la misma respuesta y no en otra llamada: la pantalla
  // filtra por tanda, y para pintar el filtro hace falta saber por qué fase va
  // cada una. Dos viajes para pintar una barra es un viaje de más.
  //
  // Los recuentos NO se mandan: cada fila ya trae `etiqueta_ett` e
  // `inicio_previsto`, así que la pantalla los saca de lo que está enseñando.
  // Contarlos aquí daba números del total mientras se miraba una sola tanda.
  const [filas, solicitudes] = await Promise.all([
    cand.listar({ canal: CANAL, incluirCerradas: true }),
    cand.solicitudesETT(),
  ]);
  return { filas, solicitudes };
}));

router.get('/api/ficha/:id', responde(async req => {
  const f = await cand.ficha(Number(req.params.id));
  if (!f) throw new Error('No existe esa candidatura');
  return { ...f, faltan: await cand.faltantes(f.id) };
}));

router.get('/api/catalogos', responde(() => cand.catalogos()));

// ── Importar la matriz del correo ──────────────────────────────────────────
// Se pega la tabla y de ahí salen las fichas. Idempotente por teléfono: la
// agencia reenvía la misma tabla ampliada cada semana, así que pegarla dos veces
// tiene que ser inofensivo.
router.post('/api/importar', responde(async req => {
  const b = req.body || {};
  // Sin `solicitudId` se abre una solicitud nueva: una tabla pegada es una
  // solicitud. Con él se añade a una que ya existe, que es el caso de la agencia
  // reenviando la misma tabla ampliada.
  const r = await cand.importarMatriz(b.texto, await quien(req), {
    solicitudId: b.solicitudId, referencia: b.referencia, recibida: b.recibida,
  });
  console.log(`👥 [ETT] solicitud ${r.solicitudId} · ${r.leidas} filas: ` +
              `${r.creados} nuevas · ${r.vuelven} vuelven · ` +
              `${r.yaEstaban} ya estaban · ${r.yaTrabajan} ya trabajan aquí · ${r.errores} con error`);
  // Quien ya está en plantilla y la agencia manda como candidato: se deja dicho
  // en el log con nombre, que es una confusión que conviene poder rastrear.
  r.detalle.filter(d => d.que === 'ya_trabaja')
    .forEach(d => console.log(`   ⚠️  ${d.nombre} (${d.telefono}) — ${d.nota}`));
  return r;
}));

// ── Escritura ──────────────────────────────────────────────────────────────

router.put('/api/candidatura/:id', responde(async req =>
  cand.guardar(Number(req.params.id), req.body || {}, await quien(req))));

router.post('/api/candidatura/:id/estado', responde(async req => {
  const b = req.body || {};
  return cand.cambiarEstado(Number(req.params.id), b.estado, { motivo: b.motivo, ...(await quien(req)) });
}));

// No pasa, y por qué. El motivo decide a qué estado va —no presentarse no es no
// superar la entrevista—, así que aquí no se manda ningún estado: se manda el
// motivo y lo demás lo saca el catálogo.
router.post('/api/candidatura/:id/descartar', responde(async req => {
  const b = req.body || {};
  const r = await cand.descartar(Number(req.params.id),
    { motivoCodigo: b.motivoCodigo, detalle: b.detalle, ...(await quien(req)) });
  console.log(`🚫 [ETT] candidatura ${r.id} no pasa: ${b.motivoCodigo} → ${r.estado}`);
  return r;
}));

router.post('/api/candidatura/:id/rrhh', responde(async req => {
  const b = req.body || {};
  // Por esta vía el contrato es de ETT salvo que se diga otra cosa: es de donde
  // viene la persona.
  //
  // El nombre de la ETT va DESPUÉS del cuerpo y no antes: el formulario lo manda
  // vacío cuando no se escribe nada, y colocado delante ese vacío pisaba el
  // configurado en el servidor y el alta se caía por falta de nombre.
  const r = await cand.pasarARRHH(Number(req.params.id),
    { tipo: 'ett', ...b, ettNombre: b.ettNombre || process.env.ETT_NOMBRE },
    await quien(req));
  console.log(`👤 [ETT] ${r.quien} pasa a RRHH (ficha ${r.conductorId})` +
              (r.faltaBolt ? ' — SIN cuenta de BOLT' : ''));
  return r;
}));

// Borrar una candidatura que no debería existir: un teléfono mal tecleado, una
// fila duplicada, una prueba. NO es descartar — descartar deja rastro porque es
// una decisión del proceso. Se niega si la persona ha trabajado aquí.
router.delete('/api/candidatura/:id', responde(async req =>
  cand.eliminar(Number(req.params.id), await quien(req))));

// ── Lo que se le devuelve a la agencia ─────────────────────────────────────
//
// Las solicitudes NO tienen ruta propia: van dentro de `/api/lista`, que es la
// única llamada que hace la pantalla al entrar. Tenerlas también aparte era un
// segundo sitio del que sacar lo mismo.
//
// Y cerrar una a mano tampoco: se cierra sola al mandar el envío en el que ya
// no queda nadie pendiente.

// Ya se le ha contestado. Lo apunta la pantalla justo después de descargar el
// Excel: el correo lo manda una persona, así que el sistema no puede saberlo
// solo. De aquí sale la regla del segundo envío.
router.post('/api/solicitud/:id/enviado', responde(async req => {
  const r = await cand.registrarEnvio(Number(req.params.id),
    { formato: (req.body || {}).formato, ...(await quien(req)) });
  console.log(`📤 [ETT] solicitud ${r.solicitudId} · envío ${r.orden} (${(req.body || {}).formato || 'excel'})` +
              (r.cerrada ? ' — cerrada: no queda nadie pendiente' : ` — quedan ${r.pendientes} pendiente(s)`));
  return r;
}));

const solicitudDe = req => ({
  solicitudId: /^\d+$/.test(req.query.solicitud || '') ? Number(req.query.solicitud) : null,
});

// ¿Se puede mandar esta tanda? Se pregunta ANTES de descargar.
//
// Una descarga del navegador no sabe enseñar un error: si el servidor se niega,
// el fichero simplemente no aparece y no hay forma de saber por qué. Así que
// primero se pregunta aquí —que sí contesta el motivo, con nombres— y solo si
// sale bien se lanza la descarga.
router.get('/api/comprobar', responde(async req => ({ filas: (await cand.paraETT(solicitudDe(req))).length })));

router.get('/api/excel', async (req, res) => {
  try {
    // Devuelve los bytes ya hechos, no el libro.
    const bytes = await generarExcelETT(await cand.paraETT(solicitudDe(req)));
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero()}"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    console.error('❌ [ETT] excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
