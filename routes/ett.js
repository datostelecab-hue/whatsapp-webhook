// ============================================================
// ETT — bolsa de empleo, sobre PostgreSQL
// ============================================================
// Los candidatos de la agencia son candidaturas como las demás, con
// `canal = bolsa_ett`. Una tabla, dos puertas de entrada: en Selección se
// escribe un teléfono, aquí se pega la tabla del correo.
//
// Ya no hay hoja ETT_CANDIDATOS.
//
// Mismo contrato que las demás pantallas: /api/lista → { filas, resumen } y
// /api/ficha/:id.

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
  const filas = await cand.listar({ canal: CANAL, incluirCerradas: true });
  const porEstado = {};
  filas.forEach(f => { porEstado[f.estado] = (porEstado[f.estado] || 0) + 1; });

  return {
    filas,
    resumen: {
      total: filas.length,
      porEstado,
      // Los cuatro números que se miran para contestar a la agencia.
      pendientes: filas.filter(f => f.en_funnel).length,
      contratados: filas.filter(f => !f.en_funnel && !f.es_salida).length,
      noPresentados: porEstado.no_presentado || 0,
      descartados: porEstado.descartado || 0,
    },
  };
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
  const r = await cand.importarMatriz((req.body || {}).texto, await quien(req));
  console.log(`👥 [ETT] ${r.leidas} filas: ${r.creados} nuevas · ${r.vuelven} vuelven · ` +
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

router.post('/api/candidatura/:id/rrhh', responde(async req => {
  // Por esta vía el contrato es de ETT salvo que se diga otra cosa: es de donde
  // viene la persona.
  const r = await cand.pasarARRHH(Number(req.params.id),
    { tipo: 'ett', ettNombre: process.env.ETT_NOMBRE, ...(req.body || {}) },
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

// Las tandas disponibles: cada día de entrevista, con cuánta gente hay y cuánta
// sigue sin resolver. Es lo que se elige antes de mandar nada.
router.get('/api/tandas', responde(async () => ({ tandas: await cand.tandasETT() })));

// `desde` y `hasta` acotan por día de ENTREVISTA. Sin ellos sale todo, que a la
// tercera semana significa devolverle a la agencia gente de hace un mes.
const tandaDe = req => ({
  desde: /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : null,
  hasta: /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : null,
});

// La matriz como texto, para pegarla en la respuesta del mismo hilo.
router.get('/api/matriz', async (req, res) => {
  try { res.type('text/plain; charset=utf-8').send(await cand.matriz(tandaDe(req))); }
  catch (e) {
    console.error('❌ [ETT] matriz:', e.message);
    res.status(500).type('text/plain').send('No se pudo generar: ' + e.message);
  }
});

router.get('/api/excel', async (req, res) => {
  try {
    // Devuelve los bytes ya hechos, no el libro.
    const bytes = await generarExcelETT(await cand.paraETT(tandaDe(req)));
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
