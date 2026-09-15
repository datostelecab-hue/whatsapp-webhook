// ============================================================
// COBERTURA · SERVICIO — la semana, y el aviso de turnos
// ============================================================
// Qué plazas quedan sin cubrir esta semana, y el WhatsApp que le dice a cada
// conductor cuándo trabaja. Lee del TABLERO del planificador: cero hojas, lo
// que se ve aquí es exactamente lo que hay en el cuadrante.
//
// ── LAS CINCO COSAS QUE HAY QUE SABER ───────────────────────────────────────
//
// 1. EL APUNTE NUNCA TUMBA EL ENVÍO. Si el registro del aviso falla, el
//    WhatsApp sale igual y el fallo se queda en el log. Al revés —no avisar a
//    nadie porque no se pudo escribir una fila— sería cambiar un problema de
//    contabilidad por uno de operación.
//
// 2. SE MANDA LA PLANTILLA, NO EL DETALLE. El mensaje lleva un botón; el
//    conductor lo pulsa y es el BOT quien le cuenta sus turnos. Por eso al
//    enviar se marca la semana (`avisoTurnos.marcar`): cuando pulse, tiene que
//    ver ESA semana y no la de hoy.
//
// 3. UN ENVÍO A LA VEZ. El masivo guarda su progreso en memoria y el panel lo
//    sondea; dos a la vez se pisarían el contador y, peor, duplicarían mensajes.
//    El segundo recibe un 409, no una cola.
//
// 4. 1,2 SEGUNDOS ENTRE MENSAJES. Son ~50/min, por debajo de los límites de
//    Meta. Un bulk de 200 personas son cuatro minutos: por eso va en segundo
//    plano y no colgado de la petición.
//
// 5. SOLO SE AVISA A QUIEN TRABAJA. Quien libra toda la semana no recibe nada;
//    quien no tiene teléfono en su ficha se apunta como 'sin-telefono' —que es
//    un dato para RRHH— en vez de contarse como error de envío.

const cob = require('./cobertura.repo');
const avisos = require('./avisos.repo');
const avisoTurnos = require('./avisoTurnos.service');
const { enviarAvisoTurnos } = require('../../services/whatsapp');

const TZ = 'Europe/Madrid';

/** La semana pedida: 0 = esta, 1 = la que viene… Tope de 8 para no pedir el año. */
const semanaDe = v => Math.max(0, Math.min(8, parseInt(v, 10) || 0));

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Un día cualquiera de la semana pedida (hoy + N semanas), para el tablero. */
function diaDeSemana(semana) {
  const [y, m, d] = hoyMadrid().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + Number(semana || 0) * 7 * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const sello = () => new Intl.DateTimeFormat('es-ES',
  { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RITMO_MS = 1200;   // ~50/min, por debajo de los límites de Meta

// ── La pantalla ────────────────────────────────────────────────────────────

const paraLaPantalla = () => ({ diasSem: cob.DIAS_SEM, turnos: cob.TURNOS });

const datos = semana => cob.datos({ offsetSemana: semanaDe(semana) });

/**
 * QUIÉN ES, por su teléfono. Lo usa el bot de las puertas: el sufijo de 9
 * dígitos identifica solo, y autoriza a quien está DE ALTA —quien ya causó baja
 * deja de abrir puertas—.
 *
 * Está en la puerta del módulo y no en su repositorio porque el bot vive fuera:
 * es la única forma de que este módulo pueda cambiar por dentro sin romperlo.
 */
const conductorPorTelefono = telefono => cob.conductorPorTelefono(telefono);

const estadoDeAvisos = semana => avisos.estadoSemana({ dia: diaDeSemana(semanaDe(semana)) });

const informeDeAvisos = dia =>
  avisos.informeDia({ dia: /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : null });

// ── El aviso de turnos ─────────────────────────────────────────────────────

/** Ver la nota 1: el registro se intenta, y si falla se llora en el log. */
async function apuntar(datos) {
  try { await avisos.registrar(datos); }
  catch (e) { console.error('⚠️ [Turnos] no se pudo registrar el aviso:', e.message); }
}

/** A UN conductor. `idBolt` es como lo llama la pantalla desde siempre; hoy es su id. */
async function enviarAUno({ id, semana }, quienEs) {
  const conductorId = String(id || '').trim();
  if (!conductorId) throw new Error('Falta el conductor');
  const s = semanaDe(semana);

  const { porConductor } = await cob.datos({ offsetSemana: s });
  const entrada = porConductor.find(e => String(e.id) === conductorId);
  if (!entrada) throw new Error('Ese conductor no tiene turnos esta semana');

  const h = await avisos.huellas({ dia: diaDeSemana(s) });
  const base = {
    ...quienEs, conductorId, telefono: entrada.telefono || null,
    origen: 'cobertura', semanaLunes: h.lunes, huella: h.porConductor.get(conductorId) || '',
  };

  if (!entrada.telefono) {
    await apuntar({ ...base, resultado: 'sin-telefono' });
    throw new Error('Ese conductor no tiene teléfono en su ficha');
  }

  const r = await enviarAvisoTurnos(entrada.telefono, entrada.nombre);
  await apuntar({ ...base, resultado: r.ok ? 'ok' : 'error', detalle: r.ok ? null : r.error });
  if (!r.ok) throw new Error(r.error);

  avisoTurnos.marcar(entrada.telefono, s);   // al pulsar el botón verá ESTA semana
  console.log(`📅 [Turnos] Aviso enviado a ${entrada.nombre} (semana ${s})`);
  return { enviado: true };
}

// El progreso del masivo vive en memoria: lo sondea el panel mientras dura y no
// hace falta guardarlo. Si el proceso se reinicia a mitad, lo que interesa —qué
// se mandó y a quién— está en `aviso_turnos`, no aquí.
let _prog = { activo: false, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: null, fin: null, detalle: [] };

/** Los últimos 15 renglones bastan: el panel enseña una cola, no un histórico. */
const progreso = () => ({ ..._prog, detalle: _prog.detalle.slice(-15) });

const hayEnvioEnMarcha = () => _prog.activo;

/**
 * A TODOS los que trabajan esa semana, o a UNA LISTA (un cuadrante del
 * planificador). Misma maquinaria y mismo ritmo; el panel sondea lo mismo.
 *
 * `cuadrante` viene del botón del planificador y se queda en el registro:
 * "William avisó al cuadrante X".
 */
async function enviarABastantes(semana, soloIds = null, ctx = {}) {
  const s = semanaDe(semana);
  _prog = { activo: true, total: 0, enviados: 0, errores: 0, sinTel: 0, iniciado: sello(), fin: null, detalle: [] };
  try {
    const { porConductor } = await cob.datos({ offsetSemana: s });
    // La foto de lo que se está avisando, para el registro y el semáforo. Si no
    // puede armarse, el envío sale igual (huella vacía).
    const h = await avisos.huellas({ dia: diaDeSemana(s) })
      .catch(e => { console.error('⚠️ [Turnos] sin huellas:', e.message); return { lunes: null, porConductor: new Map() }; });

    const apunte = (e, resultado, detalle) => h.lunes && apuntar({
      usuarioId: ctx.usuarioId, usuario: ctx.usuario, conductorId: e.id,
      telefono: e.telefono || null, cuadrante: ctx.cuadrante || null,
      origen: ctx.origen, semanaLunes: h.lunes,
      huella: h.porConductor.get(String(e.id)) || '', resultado, detalle,
    });

    // Solo los que trabajan; con `soloIds`, además, solo los pedidos.
    const lista = porConductor.filter(e =>
      (!soloIds || soloIds.has(String(e.id))) && e.dias.some(d => d.trabaja));
    _prog.total = lista.length;

    for (const e of lista) {
      if (!e.telefono) {
        _prog.sinTel++; _prog.detalle.push(`${e.nombre}: sin teléfono`);
        await apunte(e, 'sin-telefono');
        continue;
      }
      const r = await enviarAvisoTurnos(e.telefono, e.nombre);
      if (r.ok) { _prog.enviados++; avisoTurnos.marcar(e.telefono, s); }
      else { _prog.errores++; _prog.detalle.push(`${e.nombre}: ${r.error}`); }
      await apunte(e, r.ok ? 'ok' : 'error', r.ok ? null : r.error);
      await sleep(RITMO_MS);
    }
  } finally {
    _prog.activo = false; _prog.fin = sello();
  }
  console.log(`📅 [Turnos] Bulk semana ${s}: ${_prog.enviados} enviados · ` +
    `${_prog.errores} err · ${_prog.sinTel} sin tel`);
}

/**
 * Lanza el masivo EN SEGUNDO PLANO y vuelve enseguida: son minutos (ver la nota
 * 4) y la petición se cortaría. El panel sondea `progreso()`.
 */
function lanzarMasivo(semana, soloIds, ctx) {
  enviarABastantes(semana, soloIds, ctx)
    .catch(e => console.error('❌ [Turnos] bulk:', e.message));
}

module.exports = {
  paraLaPantalla, datos, conductorPorTelefono, estadoDeAvisos, informeDeAvisos,
  enviarAUno, lanzarMasivo, progreso, hayEnvioEnMarcha,
  semanaDe, diaDeSemana,
};
