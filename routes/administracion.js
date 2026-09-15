// ============================================================
// /administracion — el PIN de Ballenoil, y los códigos de lavado
// ============================================================
// El último paso del alta: Administración pide el PIN de la tarjeta de
// combustible a Ballenoil, lo apunta aquí y se le manda al conductor por
// WhatsApp con el instructivo.
//
// ── QUÉ CAMBIÓ AL SALIR DE LAS HOJAS (15/09/2026) ───────────────────────────
// Dos cosas, y la primera era un agujero:
//
//   · AQUÍ YA NO SE CREA NINGUNA FICHA. El camino viejo llamaba a
//     `crearConductor`, que escribe en la hoja AGENDA_V2 — una hoja que desde el
//     corte del planificador NO LEE NADIE. Quien pasara por ahí no aparecía en
//     la Plantilla ni en el cuadrante, sin error y sin aviso.
//
//     No hace falta: la persona lleva de alta desde que Selección la pasó a
//     RRHH (`pasarARRHH` abre el contrato, pone el turno y enlaza BOLT). Esto
//     solo guarda el PIN y mueve la ficha de montón.
//
//   · EL PIN ES DE LA PERSONA, no de su candidatura (db/124). Por eso se le
//     puede poner a cualquiera, cambia con el tiempo y se reenvía.

const express = require('express');
const router = express.Router();
const seleccion = require('../modules/Seleccion/seleccion.service');
const plantilla = require('../modules/Conductores/plantilla.service');
const { enviarBallenoil } = require('../services/whatsapp');
const codigos = require('../services/codigosBallenoil');
const actor = require('../services/repo/actor');

const quien = async req => ({ usuarioId: await actor.idDe(req) });
const tel9 = v => String(v == null ? '' : v).replace(/\D/g, '').slice(-9);

// Nombre con el que saludar en la plantilla de Ballenoil.
const nombreSaludo = p => (p && (p.idBolt || p.quien || p.nombre)) || '';

router.get('/', (req, res) => {
  res.render('administracion', {
    titulo: 'Administración', seccion: 'administracion', layout: 'layout-gestion',
  });
});

/**
 * Las dos bandejas: quien espera su PIN y quien ya lo tiene.
 *
 * Se sigue devolviendo `id` = teléfono porque es la llave con la que la pantalla
 * llama a todo lo demás. Debajo ya no hay ninguna hoja indexada por teléfono:
 * hay una candidatura con su id, y el teléfono se resuelve al recibirlo.
 */
router.get('/api/datos', async (req, res) => {
  try {
    const t = await seleccion.tramoFinal();
    const map = c => ({
      id: c.telefono, candidaturaId: c.id, conductorId: c.conductorId,
      nombre: c.quien, ficha: c.quien,
      dni: c.dni, email: c.email, telefono: c.telefono,
      turno: c.turno, fecha_alta: c.altaAt ? String(c.altaAt).slice(0, 10) : '',
      obs_ballenoil: c.obsPin, pin_ballenoil: c.pin,
    });
    const pendientes = t.pendientePin.map(map);
    const hechos = t.hechas.filter(c => c.pin).map(map);
    res.json({
      status: 'ok', pendientes, hechos,
      contadores: { pendientes: pendientes.length, hechos: hechos.length },
    });
  } catch (error) {
    console.error('❌ [Administración] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Códigos de lavado Ballenoil (un solo uso; los reparte el bot) ────────────

router.get('/codigos/api', async (req, res) => {
  try {
    const [resumen, lista] = await Promise.all([codigos.resumen(), codigos.listar()]);
    res.json({ status: 'ok', resumen, lista });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/codigos/importar', async (req, res) => {
  try {
    const r = await codigos.importar((req.body || {}).texto);
    console.log(`💧 [Ballenoil] Importados ${r.añadidos} códigos (${r.duplicados} dup., ${r.invalidos} inválidos)`);
    res.json({ status: 'ok', ...r });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/codigos/purgar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await codigos.purgarVencidos()) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

// ── El PIN ──────────────────────────────────────────────────────────────────

/**
 * Guarda el PIN de una ficha que estaba esperándolo y manda la bienvenida.
 *
 * EL ENVÍO NO BLOQUEA: si WhatsApp falla, el PIN ya quedó guardado y se avisa.
 * Al revés —no guardar porque no se pudo avisar— obligaría a repetir la gestión
 * con Ballenoil, que es la parte cara.
 */
router.post('/pin', async (req, res) => {
  try {
    const b = req.body || {};
    const tel = String(b.tel || '').trim();
    if (!tel) throw new Error('Falta el teléfono');

    const t = await seleccion.tramoFinal();
    const ficha = t.pendientePin.find(c => tel9(c.telefono) === tel9(tel));
    if (!ficha) throw new Error('Esa ficha no está esperando el PIN de Ballenoil');

    await seleccion.guardarPin(ficha.id, { pin: b.pin, obs: b.obs_ballenoil }, await quien(req));
    const env = await enviarBallenoil(tel, ficha.quien);
    if (!env.ok) console.error(`⚠️ [Ballenoil] Bienvenida NO enviada a ${tel}: ${env.error}`);
    res.json({ status: 'ok', enviado: env.ok, envioError: env.ok ? null : env.error });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/**
 * Corrige el PIN de alguien que YA lo tenía (el PIN cambia a veces) y, si se
 * pide, le vuelve a mandar la bienvenida.
 *
 * Sin `enviar` solo se corrige: es lo que hace falta cuando se arregla un dígito
 * o se añade una nota y no procede volver a escribirle al conductor.
 */
router.post('/ballenoil/reenviar', async (req, res) => {
  try {
    const b = req.body || {};
    const tel = String(b.tel || '').trim();
    const pin = String(b.pin == null ? '' : b.pin).trim();
    const enviar = b.enviar !== false && b.enviar !== 'false';
    if (!pin) throw new Error('Escribe el PIN de Ballenoil');

    const p = await plantilla.buscarPersona({ telefono: tel });
    if (!p) throw new Error('No encuentro a nadie con ese teléfono');

    await plantilla.guardarPinBallenoil(p.id,
      { pin, obs: b.obs_ballenoil == null ? null : String(b.obs_ballenoil) }, await quien(req));

    if (!enviar) {
      console.log(`💾 [Ballenoil] PIN/observación actualizados a ${p.nombre} (sin enviar)`);
      return res.json({ status: 'ok', guardado: true, enviado: false });
    }
    const env = await enviarBallenoil(tel, p.nombre);
    if (!env.ok) console.error(`⚠️ [Ballenoil] Reenvío NO entregado a ${tel}: ${env.error}`);
    res.json({ status: 'ok', guardado: true, enviado: env.ok, envioError: env.ok ? null : env.error });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// ── PIN a CUALQUIER conductor ───────────────────────────────────────────────

/**
 * A quién se le puede poner un PIN: gente OPERATIVA (fuera vacaciones, bajas,
 * permisos y suspendidos — no van a repostar) más las cuentas de BOLT que aún
 * no son de nadie, que salen marcadas «sin ficha».
 */
router.get('/conductores', async (req, res) => {
  try {
    const lista = await plantilla.paraBallenoil();
    const conductores = lista.map(c => ({
      id_bolt: c.idBolt, nombre: c.nombre, telefono: c.telefono,
      turno: c.turno, dni: c.dni, email: c.email, estado: c.estado,
      obs_ballenoil: c.obs, pin_ballenoil: c.pin, con_ficha: c.conFicha,
      conductor_id: c.conductorId,
    }));
    const conPin = c => !!(c.pin_ballenoil || '').trim();
    res.json({
      status: 'ok', conductores,
      contadores: {
        total: conductores.length,
        conPin: conductores.filter(conPin).length,
        sinPin: conductores.filter(c => !conPin(c)).length,
      },
    });
  } catch (e) {
    console.error('❌ [Administración] /conductores:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

/**
 * Asigna o corrige el PIN de cualquier conductor.
 *
 * ── LO QUE YA NO HACE: CREAR LA FICHA AL VUELO ──────────────────────────────
 * Antes, darle un PIN a alguien que salía en BOLT pero no tenía ficha se la
 * creaba en el momento. Eso metía en la plantilla a una persona sin DNI, sin
 * contrato y sin turno, solo porque tenía cuenta en BOLT — y esa ficha a medias
 * luego hay que completarla a mano o arrastra para siempre.
 *
 * Para que alguien entre está Selección, que pide lo que hace falta. Aquí se
 * dice que no y se explica dónde.
 */
router.post('/ballenoil/conductor', async (req, res) => {
  try {
    const b = req.body || {};
    const tel = String(b.tel || '').trim();
    const pin = String(b.pin == null ? '' : b.pin).trim();
    const obs = b.obs == null ? null : String(b.obs);   // null = no tocar la nota
    const enviar = b.enviar !== false && b.enviar !== 'false';
    if (!tel) throw new Error('Falta el teléfono del conductor');
    if (!pin) throw new Error('Escribe el PIN de Ballenoil');

    const p = await plantilla.buscarPersona({ telefono: tel });
    if (!p) {
      throw new Error('Esa persona no tiene ficha todavía, así que no hay dónde guardarle el PIN. '
        + 'Dale de alta primero desde Selección y vuelve aquí.');
    }

    await plantilla.guardarPinBallenoil(p.id, { pin, obs }, await quien(req));
    if (!enviar) {
      console.log(`💾 [Ballenoil] PIN/observación guardados a ${p.nombre} (sin enviar WhatsApp)`);
      return res.json({ status: 'ok', guardado: true, enviado: false });
    }
    const env = await enviarBallenoil(tel, p.nombre || String(b.nombre || ''));
    if (!env.ok) console.error(`⚠️ [Ballenoil] Bienvenida NO enviada a ${tel}: ${env.error}`);
    res.json({ status: 'ok', guardado: true, enviado: env.ok, envioError: env.ok ? null : env.error });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
