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
    titulo: 'Control · Flota viva', seccion: 'control', layout: 'layout-gestion',
  });
});

// El reporte: que paso en cada franja y que se hizo.
router.get('/partes', (req, res) => {
  res.render('flotaVivaPartes', {
    titulo: 'Control · Histórico', seccion: 'control', layout: 'layout-gestion',
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

// Las horas que se vigilan, tal como estan en la base AHORA.
//
// La pantalla no puede llevarlas escritas: se cambian con un UPDATE y sin
// desplegar, asi que un texto fijo queda desfasado el dia que alguien mueve un
// turno — y encima diciendo que no se avisa a unas horas a las que si se avisa.
router.get('/api/franjas', responde(async () => {
  await db.preparar();
  const f = await require('../services/flotaViva/franjas').franjas();
  return {
    franjas: f.map(x => ({
      codigo: x.codigo, etiqueta: x.etiqueta,
      inicioMin: x.inicio_min, finMin: x.fin_min,
    })),
  };
}));

// Las formas de cerrar una incidencia. Las pide la pantalla para pintar los
// botones: cuales hay y cual crea llamada lo dice la base, no el front.
router.get('/api/gestiones', responde(async () => {
  await db.preparar();
  return { gestiones: await panel.gestiones() };
}));

// Cerrar una incidencia: llamando o ignorandola. Las dos exigen motivo y las dos
// quedan con nombre y hora — ignorar no es hacerla desaparecer.
//
// Si la gestion crea llamada, ademas se REGISTRA EN EL CALL CENTER: es una
// llamada de verdad y tiene que contar en sus KPIs y en su reincidencia.
router.post('/api/incidencia/:id/justificar', responde(async req => {
  const b = req.body || {};
  const quien = (req.usuario && (req.usuario.nombre || req.usuario.email)) || '';
  const r = await panel.justificar(req.params.id, {
    gestion: b.gestion, motivo: b.motivo, resultado: b.resultado, accion: b.accion, quien,
  });
  if (r.yaEstaba) {
    console.log(`🤝 [FLOTA VIVA] Incidencia ${r.id}: ${quien || '(sin nombre)'} llegó tarde, ` +
                `ya la cerró ${r.por || '(sin nombre)'} — ${r.gestionEtiqueta || r.gestion}`);
  } else {
    console.log(`✍️  [FLOTA VIVA] Incidencia ${r.id} — ${r.gestionEtiqueta} — por ${quien || '(sin nombre)'}` +
                (r.llamada ? ` · llamada ${r.llamada}` : r.sinLlamada ? ` · SIN llamada: ${r.sinLlamada}` : ''));
  }
  return r;
}));

// "He llamado" — un intento de llamada desde En directo. NO cierra la incidencia
// ni crea llamada en el Call Center: solo deja rastro de que se ha intentado. Se
// puede pulsar tantas veces como se llame (no cogen, se vuelve a marcar).
router.post('/api/incidencia/:id/he-llamado', responde(async req => {
  const quien = (req.usuario && (req.usuario.nombre || req.usuario.email)) || '';
  const r = await panel.seguir(req.params.id, { quien, nota: (req.body || {}).nota });
  console.log(`📞 [FLOTA VIVA] "He llamado" incidencia ${r.id} (intento nº ${r.veces}) — ${quien || '(sin nombre)'}`);
  return r;
}));

// Los intentos de llamada de una incidencia, en orden. Para ver el rastro.
router.get('/api/incidencia/:id/seguimientos', responde(async req =>
  ({ seguimientos: await panel.seguimientos(req.params.id) })));

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

// DEPURACIÓN: los trayectos de Mapon de un coche en un día (por defecto hoy), TAL
// CUAL. Es la distancia BUENA —la de "Informes/Rutas"— para construir los km
// encima: el `mileage` de unit/list llega estancado (marca un odómetro de hace
// horas y no cambia entre vueltas, así que la resta da cero). Con esto se ve el
// formato exacto (campo de distancia y unidades) antes de tocar el motor.
router.get('/api/mapon-rutas/:matricula', responde(async req => {
  const fuentes = require('../services/flotaViva/fuentes');
  const mat = fuentes.normMat(req.params.matricula);
  const u = (await fuentes.flotaMapon()).get(mat);
  if (!u) return { matricula: mat, encontrado: false };
  // Mapon exige ISO 8601 con T y Z (no 'YYYY-MM-DD HH:MM:SS'): ese fue el error.
  // Ventana: últimas N horas (24 por defecto), suficiente para ver el formato.
  const iso = d => d.toISOString().slice(0, 19) + 'Z';
  const horas = Math.min(Math.max(Number(req.query.horas) || 24, 1), 168);
  const fin = new Date();
  const ini = new Date(fin.getTime() - horas * 3600 * 1000);
  return {
    matricula: mat, unitId: u.unitId, desde: iso(ini), hasta: iso(fin),
    crudo: await fuentes.rutasDeUnidad(u.unitId, iso(ini), iso(fin)),
  };
}));

module.exports = router;
