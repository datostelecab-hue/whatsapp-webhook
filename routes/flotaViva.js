// ============================================================
// FLOTA VIVA — rutas
// ============================================================
// Fichero nuevo y aparte: no toca ninguna ruta existente.

const express = require('express');
const router = express.Router();

const panel = require('../services/flotaViva/panel');
const motor = require('../services/flotaViva/motor');
const db = require('../services/flotaViva/db');

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [FLOTA VIVA] ${req.method} ${req.path}: ${e.message}`);
    res.status(500).json({ status: 'error', msg: e.message });
  }
};

router.get('/', (req, res) => {
  res.render('flotaViva', {
    titulo: 'Flota viva', seccion: 'flota-viva', layout: 'layout-gestion',
  });
});

// El reporte: que paso en cada franja y que se hizo.
router.get('/partes', (req, res) => {
  res.render('flotaVivaPartes', {
    titulo: 'Partes de incidencias', seccion: 'flota-viva', layout: 'layout-gestion',
  });
});

router.get('/api/estado', responde(async () => {
  await db.preparar();
  return panel.estado();
}));

router.get('/api/historial/:matricula', responde(async req =>
  ({ historial: await panel.historial(req.params.matricula, Number(req.query.dias) || 2) })));

// Fuerza una vuelta sin esperar al cron. Es lo que se pulsa cuando alguien dice
// "acabo de desconectarme y no sale".
router.post('/api/refrescar', responde(async () => {
  const r = await motor.pasada();
  return { ...r, ...(await panel.estado()) };
}));

// ── Las franjas criticas ──────────────────────────────────────────────────

// Lo que hay que llamar ahora. Se pide aparte del estado porque se mira mucho
// mas a menudo y pesa mucho menos.
router.get('/api/incidencias', responde(async req => {
  await db.preparar();
  return {
    incidencias: await panel.incidencias({
      dia: req.query.dia, franja: req.query.franja,
      incluirJustificadas: req.query.todas === '1',
    }),
  };
}));

// Como se clasifica esta incidencia en el Call Center y que resultados admite.
// Se pide al abrir el dialogo: los resultados validos dependen del motivo, y
// mandar uno que no le corresponde hace que la llamada no se registre.
router.get('/api/incidencia/:id/clasificacion', responde(async req =>
  ({ clasificacion: await panel.clasificacionDe(req.params.id) })));

// Alguien ha llamado y cuenta que paso. Sin motivo no se cierra.
//
// Ademas de justificarla aqui, se REGISTRA LA LLAMADA en el Call Center: es una
// llamada de verdad y tiene que contar en sus KPIs y en su reincidencia.
router.post('/api/incidencia/:id/justificar', responde(async req => {
  const b = req.body || {};
  const quien = (req.usuario && (req.usuario.nombre || req.usuario.email)) || '';
  const r = await panel.justificar(req.params.id, {
    motivo: b.motivo, resultado: b.resultado, accion: b.accion, quien,
  });
  console.log(`✍️  [FLOTA VIVA] Incidencia ${r.id} justificada por ${quien || '(sin nombre)'}` +
              (r.llamada ? ` · llamada ${r.llamada}` : ` · SIN llamada: ${r.sinLlamada}`));
  return r;
}));

// El parte de una franja. Es lo que se mira al cierre.
router.get('/api/cierre', responde(async req =>
  panel.cierre({ dia: req.query.dia, franja: req.query.franja })));

// Los partes de varios dias, para elegir cual mirar. La columna que importa es
// la de "sin revisar".
router.get('/api/partes', responde(async req =>
  ({ partes: await panel.partes({ desde: req.query.desde, hasta: req.query.hasta }) })));

// Lo que manda Mapon TAL CUAL para una matricula.
//
// Existe porque los km salieron mal y no habia forma de saber si el fallo estaba
// en la cuenta o en lo que llega. Los nombres de los campos de Mapon —`mileage`,
// `last_update`— y sus unidades no estan documentados en ningun sitio nuestro:
// aqui se ven, y se deja de suponer.
router.get('/api/mapon/:matricula', responde(async req => {
  const fuentes = require('../services/flotaViva/fuentes');
  const mat = fuentes.normMat(req.params.matricula);
  const flota = await fuentes.flotaMapon();
  const u = flota.get(mat);
  return {
    matricula: mat,
    encontrado: !!u,
    // Lo que hemos entendido nosotros...
    interpretado: u || null,
    // ...y lo que llega de verdad, para poder comparar.
    crudo: await (async () => {
      const j = await fuentes.crudoDeUnidad(mat);
      return j;
    })(),
  };
}));

module.exports = router;
