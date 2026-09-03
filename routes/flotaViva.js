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

// BACKFILL / INGESTA MANUAL del núcleo de km. Solo desarrollador/superadmin: pide
// a Mapon los trayectos del rango y los mete en fv_ruta. Sirve para rellenar
// ayer+hoy en el servidor de pruebas, o para tapar un hueco si el cron estuvo
// caído. Es idempotente (clave unit_id+route_id): repetirlo no duplica.
//   /flota-viva/api/ingestar-rutas?dias=2
//   /flota-viva/api/ingestar-rutas?desde=2026-09-01&hasta=2026-09-02T23:59:59Z
router.get('/api/ingestar-rutas', responde(async (req, res) => {
  const rol = req.usuario && req.usuario.rol;
  if (rol !== 'superadmin' && rol !== 'desarrollador') {
    res.status(403).json({ status: 'error', msg: 'Solo desarrollador/superadmin' });
    return;
  }
  let desde = req.query.desde, hasta = req.query.hasta;
  if (!desde && req.query.dias) {
    desde = new Date(Date.now() - Number(req.query.dias) * 86400000).toISOString();
  }
  const rutas = require('../services/flotaViva/rutas');

  // Rango largo (el backfill de la migración, desde el 1 de agosto) NO puede ir
  // síncrono: son minutos y el HTTP se corta. Se lanza en segundo plano y se
  // sigue por los logs (progreso por ventana) o por /api/km-hoy.
  const diasRango = desde ? (Date.now() - new Date(desde).getTime()) / 86400000 : 1;
  if (req.query.bg === '1' || diasRango > 7) {
    rutas.ingestarRutas({ desde, hasta })
      .then(r => console.log(`🛰️  [FLOTA VIVA] Backfill rutas TERMINADO: ${r.trayectos} trayecto(s), ${r.km} km`))
      .catch(e => console.error('❌ [FLOTA VIVA] Backfill rutas falló:', e.message));
    return {
      iniciado: true, desde: desde || '(auto)', hasta: hasta || '(ahora)',
      nota: 'Corre en segundo plano. Mira los logs de Render (progreso por ventana) o /flota-viva/api/km-hoy.',
    };
  }

  const r = await rutas.ingestarRutas({ desde, hasta });
  console.log(`🛰️  [FLOTA VIVA] Backfill rutas: ${r.trayectos} trayecto(s), ${r.km} km ` +
              `(${r.desde} → ${r.hasta})`);
  return r;
}));

// BACKFILL de HORAS (fv_tramo) — reconstruye del histórico de BOLT (state-logs). Solo
// desarrollador/superadmin. Idempotente (delete+reinsert del rango, sin tocar el tramo
// vivo). Rango largo → segundo plano. Ej (migración): ?desde=2026-07-01
router.get('/api/backfill-tramos', responde(async (req, res) => {
  const rol = req.usuario && req.usuario.rol;
  if (rol !== 'superadmin' && rol !== 'desarrollador') {
    res.status(403).json({ status: 'error', msg: 'Solo desarrollador/superadmin' });
    return;
  }
  const { desde, hasta } = req.query;
  if (!desde) throw new Error('Falta ?desde=AAAA-MM-DD');
  const backfill = require('../services/flotaViva/backfill');
  const diasRango = (Date.now() - new Date(desde).getTime()) / 86400000;
  if (req.query.bg === '1' || diasRango > 3) {
    backfill.backfillTramos({ desde, hasta })
      .catch(e => console.error('❌ [FLOTA VIVA] Backfill tramos falló:', e.stack || e.message));
    return {
      iniciado: true, tarea: 'backfill-tramos', desde, hasta: hasta || '(hasta el tramo vivo)',
      nota: 'Corre en segundo plano. Progreso en los logs de Render; luego se ve en /visibilidad.',
    };
  }
  return await backfill.backfillTramos({ desde, hasta });
}));

// BACKFILL FINANCIERO (bolt_order: neto/viajes) del histórico. Solo dev/superadmin.
// Idempotente (ON CONFLICT). Rango largo → segundo plano. Ej: ?desde=2026-07-01
router.get('/api/backfill-orders', responde(async (req, res) => {
  const rol = req.usuario && req.usuario.rol;
  if (rol !== 'superadmin' && rol !== 'desarrollador') {
    res.status(403).json({ status: 'error', msg: 'Solo desarrollador/superadmin' });
    return;
  }
  const { desde, hasta } = req.query;
  if (!desde) throw new Error('Falta ?desde=AAAA-MM-DD');
  const backfill = require('../services/flotaViva/backfill');
  const diasRango = (Date.now() - new Date(desde).getTime()) / 86400000;
  if (req.query.bg === '1' || diasRango > 3) {
    backfill.backfillOrders({ desde, hasta })
      .catch(e => console.error('❌ [FLOTA VIVA] Backfill orders falló:', e.stack || e.message));
    return {
      iniciado: true, tarea: 'backfill-orders', desde, hasta: hasta || '(ahora)',
      nota: 'Corre en segundo plano. Progreso en los logs de Render.',
    };
  }
  return await backfill.backfillOrders({ desde, hasta });
}));

// Comprobación: los km de hoy por coche que verá el cockpit, del núcleo. Si esto
// sale con datos y el cockpit no, el problema es de pintado; si sale vacío, es de
// ingesta o del cruce por unit_id.
router.get('/api/km-hoy', responde(async req => {
  const dia = req.query.dia || new Intl.DateTimeFormat('en-CA',
    { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const m = await require('../services/flotaViva/rutas').kmPorCoche(dia);
  const coches = [...m.entries()].map(([matricula, x]) => ({ matricula, ...x })).sort((a, b) => b.km - a.km);
  return {
    dia, coches: coches.length,
    kmTotal: Math.round(coches.reduce((s, c) => s + c.km, 0) * 10) / 10,
    top: coches.slice(0, 15),
  };
}));

module.exports = router;
