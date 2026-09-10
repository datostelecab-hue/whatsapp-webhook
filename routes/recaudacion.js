// ============================================================
// RECAUDACIÓN — las rutas
// ============================================================
// Dos permisos, no uno:
//
//   '/recaudacion'        entrar, mirar y cobrar EN MANO (el recibo)
//   '/recaudacion/nomina' apuntar lo que se descuenta por nómina — es de RRHH,
//                         y quien cobra en ventanilla no tiene por qué poder
//                         tocar la nómina de nadie
//
// Ninguno de los dos viene sembrado en ningún rol: el módulo nace apagado para
// todo el mundo y los reparte el jefe a mano en /usuarios.
//
// Quién sea cada uno sale de la sesión, nunca del cuerpo de la petición: en un
// módulo de caja, "lo apuntó Fulano" tiene que ser verdad.

const express = require('express');
const router = express.Router();
const repo = require('../services/repo/recaudacion');
const actor = require('../services/repo/actor');
const permisos = require('../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Recaudación]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/** ¿Puede este usuario apuntar descuentos de nómina? */
async function puedeNomina(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quienEs(req);
    return id ? (await permisos.clavesDe(id)).has('/recaudacion/nomina') : false;
  } catch (_) { return false; }
}

router.get('/', async (req, res) => {
  res.render('recaudacion', {
    titulo: 'Recaudación',
    seccion: 'recaudacion',
    layout: 'layout-gestion',
    denominaciones: repo.DENOMINACIONES.map(c => ({ centimos: c, etiqueta: repo.ETIQUETA_DEN(c) })),
    tiposMovimiento: repo.TIPOS,
    salidasCaja: repo.SALIDAS,
    // Para poner nombre a lo que ya está apuntado, incluido el traspaso de
    // apertura, que se lee pero no se elige.
    etiquetasSalida: repo.TODAS_SALIDAS,
    puedeNomina: await puedeNomina(req),
  });
});

// El cuadro: el acumulado de todo, sin quincenas. La quincena sigue estando
// por dentro (es la caja donde se guarda cada cierre de BOLT) pero ya no se
// navega: lo que se pregunta de alguien es cuánto debe en total.
router.get('/api/cuadro', responde(async req => {
  const [cuadro, caja, salidas] = await Promise.all([
    repo.cuadro(), repo.cuadre(), repo.salidas(),
  ]);
  return {
    ...cuadro,
    caja, salidas,
    corte: repo.etiquetaQuincena(repo.CORTE),
    puedeNomina: await puedeNomina(req),
  };
}));

// La ficha de un conductor: su histórico entero por quincenas.
router.get('/api/conductor/:id', responde(async req => repo.ficha(req.params.id)));

// El desplegable de "Nuevo ingreso".
router.get('/api/candidatos', responde(async () => ({ conductores: await repo.candidatos() })));

// Apuntar dinero. Lo presencial lo hace quien entra; lo de nómina, solo quien
// tenga su permiso. Se comprueba AQUÍ y no solo en el menú.
router.post('/api/movimiento', responde(async req => {
  const b = req.body || {};
  if (b.tipo === 'nomina' && !(await puedeNomina(req))) {
    throw new Error('Los descuentos de nómina los apunta RRHH; tú puedes apuntar lo que se cobra en mano.');
  }
  return repo.anotar({
    conductorId: b.conductorId, fecha: b.fecha, tipo: b.tipo, importe: b.importe,
    desglose: b.desglose, observacion: b.observacion, usuarioId: await quienEs(req),
  });
}));

router.post('/api/movimiento/:id/anular', responde(async req => repo.anular(req.params.id, {
  usuarioId: await quienEs(req), motivo: (req.body || {}).motivo,
})));

// Poner al día lo que dice BOLT, de la quincena del corte hasta hoy. La cifra
// no se teclea: se calcula y se congela. Lo anterior al corte lo manda el
// Excel y el repo se niega a tocarlo.
router.post('/api/cierre/calcular', responde(async req =>
  repo.recalcularTodo({ usuarioId: await quienEs(req) })));

// Lo que BOLT dice AHORA MISMO desde el corte, sin congelar nada: para mirar
// antes de tocar.
router.get('/api/cierre/bolt', responde(async () => {
  let total = 0;
  const gente = new Set();
  for (const q of repo.quincenasDesdeCorte()) {
    for (const c of await repo.efectivoBolt(q)) {
      total += c.importe;
      gente.add(c.conductorId || c.boltUuid);
    }
  }
  return { desde: repo.etiquetaQuincena(repo.CORTE), conductores: gente.size, total: +total.toFixed(2) };
}));

// Un arrastre (o una corrección) sobre una quincena, con su motivo.
router.post('/api/cierre/ajuste', responde(async req => {
  const b = req.body || {};
  return repo.ajustarCierre({
    conductorId: b.conductorId, anio: b.anio, mes: b.mes, quincena: b.quincena,
    ajuste: b.ajuste, motivo: b.motivo, usuarioId: await quienEs(req),
  });
}));

// El cierre de BOLT de una quincena: a mano, conductor a conductor.
router.post('/api/cierre', responde(async req => {
  const b = req.body || {};
  return repo.guardarCierre({
    conductorId: b.conductorId, anio: b.anio, mes: b.mes, quincena: b.quincena,
    importe: b.importe, origen: 'manual', usuarioId: await quienEs(req),
  });
}));

// O pegando el cierre entero desde el Excel.
router.post('/api/cierre/importar', responde(async req => {
  const b = req.body || {};
  return repo.importarCierre({
    anio: b.anio, mes: b.mes, quincena: b.quincena, texto: b.texto,
    usuarioId: await quienEs(req),
  });
}));

module.exports = router;
