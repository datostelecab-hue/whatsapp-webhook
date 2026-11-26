// ============================================================
// LAS ALTAS NUEVAS ANTE LA GESTORÍA (plan de RR. HH., módulo 8, db/304, 26/11/2026)
// ============================================================
// El encargo: «dos riesgos igual de graves: trabajar sin alta y cotizar más de
// dos días por alguien que no se presenta». Lo que decidió Camilo el 26/11/2026:
//
//   · Diana lo marca A MANO: «Alta pedida» y «Alta confirmada» (con el
//     justificante de la gestoría adjunto).
//   · SIN EL ALTA CONFIRMADA NO VINCULA COCHE, ni por el bot ni por el portal
//     (`bloqueaCoche`, que mira `fichaje.iniciar`). Planificarle, sí: en el
//     planificador sale en rojo «Sin alta confirmada».
//   · Si el día antes de su primer turno el alta no está confirmada, aviso
//     urgente a Diana y a Ignacio.
//   · LA NO PRESENTACIÓN se mira pasadas dos horas del inicio de su primer turno:
//     ni ha vinculado un coche ni BOLT le ha visto conectado. Aviso urgente a los
//     dos y una tarjeta a Diana para pedir la anulación (o la baja) ese día, con
//     el contador de días cotizados y su coste. A los dos días cotizados sin
//     resolver, aviso a Ignacio (el encargo: «el contador nunca supera 2 días
//     sin aviso escalado a Ignacio»).
//   · La CARTA DE INCORPORACIÓN («el conductor confirma por firma digital su
//     fecha de incorporación») nace en la cola de Firmas con la plantilla de
//     YouTrust «Carta de incorporación».
//
// Solo plantilla propia (a la ETT la da de alta la agencia) y solo contratos
// desde el 27/11/2026: los de antes ya trabajan.
//
// Quién es Diana: quien tiene la función «Sube el listado de plantilla de la
// gestoría». Quién es Ignacio: quien tiene la llave «/tablero/vencidas» (a quien
// le llegan las tareas vencidas). Las dos se cambian en /usuarios u
// Organización, no aquí.
'use strict';

const repo = require('./altas.repo');
const gestoria = require('./gestoria.service');
const libro = require('../../services/libro');
const parametros = require('../../services/parametros');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const avisos = require('../../services/avisos');
const organizacion = require('../../services/organizacion');
const tareasProgramadas = require('../../services/tareasProgramadas');
const adjuntos = require('../../services/adjuntos');
const contadores = require('../../services/contadores');
const { ENTRA } = require('../../services/flotaViva/repartoTurnos');

const DESDE = '2026-11-27';
const HORAS_PARA_NO_PRESENTADO = 2;
const DIAS_PARA_ESCALAR = 2;
const DUENO = 'alta_gestoria';
const CLAVE_IGNACIO = '/tablero/vencidas';
const T_PEDIR = 'alta_pedir';
const T_NO_PRESENTADO = 'alta_no_presentado';
const A_SIN_CONFIRMAR = 'alta_sin_confirmar';
const A_NO_PRESENTADO = 'alta_no_presentado';
const A_ESCALADA = 'alta_dos_dias';

const ESTADOS = {
  pendiente: { etiqueta: 'Sin pedir', tono: 'warn' },
  solicitada: { etiqueta: 'Pedida a la gestoría', tono: 'gold' },
  confirmada: { etiqueta: 'Confirmada', tono: 'green' },
  anulada: { etiqueta: 'Anulada', tono: 'muted' },
};
const TURNOS = { dia: 'de día', noche: 'de noche', todoturno: 'de todo el día' };
const FIRMA = {
  borrador: 'Carta por aprobar', aprobado: 'Carta aprobada, por enviar', enviado: 'Carta enviada, sin firmar',
  firmado: 'Carta firmada', rechazado: 'No firmó la carta', caducado: 'La carta caducó', error: 'Error al enviar la carta',
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const texto = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const exigir = async (quien, clave) => { if (!await gestoria.puede(quien, clave)) throw error('No tienes permiso para esto', 403); };
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const enlaceDe = id => `/gestoria?vista=altas&alta=${encodeURIComponent(id)}`;

/** Cuándo empieza su turno: a las 05:00 el de día (y el de todo el día), a las 17:00 el de noche. */
function inicioDelTurno(dia, turno) {
  return calendario.instante(dia, (turno === 'noche' ? ENTRA.noche : ENTRA.dia) * 60).getTime();
}

/**
 * Los días que cotiza: desde el alta hasta hoy (o hasta su baja, o hasta que se
 * pidió anularla), contando los dos. Si el alta ni se ha pedido, no cotiza.
 */
function diasCotizados(a, hoy) {
  if (!['solicitada', 'confirmada', 'anulada'].includes(a.estado) || !a.fecha_alta || a.fecha_alta > hoy) return 0;
  if (a.estado === 'anulada' && !a.solicitada) return 0;
  const anulada = a.anulada ? a.anulada.slice(6, 10) + '-' + a.anulada.slice(3, 5) + '-' + a.anulada.slice(0, 2) : null;
  const hasta = [hoy, a.baja, anulada].filter(Boolean).sort()[0];
  return hasta < a.fecha_alta ? 0 : diasEntre(a.fecha_alta, hasta) + 1;
}

/** Cómo va cada una: lo que enseña la lista. */
function situacion(a, hoy) {
  if (a.estado === 'anulada') return { codigo: 'anulada', etiqueta: 'Anulada', tono: 'muted' };
  if (a.no_presentado_hay && !a.presentado_hay) return { codigo: 'no_presentado', etiqueta: 'No se presentó', tono: 'red' };
  if (a.estado !== 'confirmada') {
    const empieza = a.primer_dia || a.fecha_alta;
    if (empieza && empieza <= calendario.sumarDias(hoy, 1)) {
      return { codigo: 'urgente', etiqueta: empieza <= hoy ? 'Ya empezó sin el alta' : 'Empieza mañana sin el alta', tono: 'red' };
    }
    return { codigo: a.estado, ...ESTADOS[a.estado] };
  }
  return a.presentado_hay ? { codigo: 'presentado', etiqueta: 'Confirmada y presentado', tono: 'green' }
    : { codigo: 'confirmada', etiqueta: 'Confirmada', tono: 'green' };
}

async function costeDia() {
  return Number(await parametros.valor('gestoria.coste_ss_dia').catch(() => 0)) || 0;
}
function conCuentas(a, hoy, coste) {
  const dias = diasCotizados(a, hoy);
  return {
    ...a, situacion: situacion(a, hoy), dias_cotizados: dias,
    coste: coste > 0 && dias ? Math.round(dias * coste * 100) / 100 : null,
    turno_texto: a.primer_turno ? TURNOS[a.primer_turno] || a.primer_turno : '',
    firma_texto: a.firma_estado ? FIRMA[a.firma_estado] || a.firma_estado : 'Sin carta',
  };
}

// ── A quién le llega ───────────────────────────────────────────────────────
async function diana() {
  return ((await organizacion.quienes('plantilla_gestoria', { conSuplentes: false }).catch(() => []))[0] || {}).id || null;
}
async function ignacio(cli = null) {
  return repo.conLlave(cli, CLAVE_IGNACIO).catch(() => []);
}
async function destinatarios(cli = null) {
  return [...new Set([await diana(), ...await ignacio(cli)].filter(Boolean).map(Number))];
}
/** El mismo aviso a cada uno (uno por persona: así cada uno lo da por visto). */
async function avisarA(ids, { tipo, origen, titulo, texto: txt, enlace }) {
  for (const id of ids) {
    await avisos.emitir({ tipo, origenId: `${origen}|${id}`, usuarioId: id, urgente: true, titulo, texto: txt, enlace })
      .catch(e => console.error(`❌ [Altas] aviso ${tipo} a ${id}: ${e.message}`));
  }
}
async function resolverAvisos(cli, tipo, origen, nota, autorId = null) {
  for (const id of await destinatarios(cli)) {
    await avisos.resolverPorOrigen({ tipo, origenId: `${origen}|${id}`, nota, autorId }, { cli }).catch(() => null);
  }
}

// ── Crear las que faltan ───────────────────────────────────────────────────
/**
 * Los contratos nuevos de plantilla propia, a la lista (pendientes). A cada uno
 * le nace la tarjeta de pedir el alta y, si aún no ha empezado, su carta de
 * incorporación en la cola de Firmas. Dentro de una transacción firmada.
 */
async function sincronizar(cli, { hoy = calendario.hoy() } = {}) {
  const nuevas = await repo.sincronizar(cli, DESDE);
  if (!nuevas.length) return 0;
  const responsable = await diana();
  for (const n of nuevas) {
    const a = await repo.porId(cli, n.id);
    await tablero.nacer(cli, {
      tipo: T_PEDIR, origenId: a.id, sensible: true, enlace: enlaceDe(a.id),
      titulo: `Pedir el alta a la gestoría: ${a.nombre} (entra el ${dmy(a.fecha_alta)})`,
      descripcion: 'Pídele el alta a la gestoría con al menos un día de antelación a su primer turno. Márcala como pedida en Gestoría › Altas y, cuando la gestoría la confirme, márcala confirmada con su justificante: hasta entonces no puede vincular ningún coche.',
      responsableId: responsable, plazoDias: Math.max(0, diasEntre(hoy, a.fecha_alta) - 1),
    });
    if (a.fecha_alta >= hoy) {
      await require('../RRHH/firmas.service').desdeAlta({ cli, altaId: a.id, conductorId: a.conductor_id, fechaAlta: a.fecha_alta })
        .catch(e => console.error(`❌ [Altas] carta de incorporación de ${a.conductor_id}: ${e.message}`));
    }
  }
  return nuevas.length;
}

// ── La lista y la ficha ────────────────────────────────────────────────────
async function lista(quien = {}) {
  await exigir(quien, gestoria.CLAVE_VER);
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, estados: ESTADOS };
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · altas', accion: 'alta' }, cli => sincronizar(cli));
  const hoy = calendario.hoy();
  const coste = await costeDia();
  return {
    filas: (await repo.lista()).map(a => conCuentas(a, hoy, coste)), sinTabla: false, estados: ESTADOS, costeDia: coste,
    desde: DESDE, puedeGestionar: await gestoria.puede(quien, gestoria.CLAVE_GESTIONAR),
  };
}

async function ficha(id, quien = {}) {
  await exigir(quien, gestoria.CLAVE_VER);
  const a = await repo.porId(null, id);
  if (!a) throw error('Esa alta no existe', 404);
  return conCuentas(a, calendario.hoy(), await costeDia());
}

// ── Lo que marca Diana ─────────────────────────────────────────────────────
async function marcar(id, quien, motivo, fn) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · altas', accion: 'cambio', motivo }, async cli => {
    const a = await repo.porId(cli, id);
    if (!a) throw error('Esa alta no existe', 404);
    return fn(cli, a);
  });
  avisarCambio();
  return r;
}

/** «Alta pedida»: Diana se la ha pedido a la gestoría. */
async function solicitar(id, { nota } = {}, quien = {}) {
  return marcar(id, quien, 'Alta pedida a la gestoría', async (cli, a) => {
    if (a.estado !== 'pendiente') throw error('Solo se marca pedida la que está sin pedir', 409);
    await repo.cambiar(cli, a.id, { estado: 'solicitada', solicitada_at: 'now', solicitada_por: quien.usuarioId, ...(texto(nota) ? { nota: texto(nota) } : {}) });
    await tablero.cerrarPorOrigen(cli, { tipo: T_PEDIR, origenId: a.id, autorId: quien.usuarioId, nota: 'Alta pedida a la gestoría' });
    return { estado: 'solicitada' };
  });
}

/** «Alta confirmada»: la gestoría la confirmó. Hace falta su justificante adjunto. */
async function confirmar(id, { nota } = {}, quien = {}) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  const justificantes = await adjuntos.lista(DUENO, id, { id: quien.usuarioId, usuarioId: quien.usuarioId, rol: quien.rol }).catch(() => []);
  if (!justificantes.length) throw error('Adjunta antes el justificante de la gestoría (el documento del alta)', 409);
  return marcar(id, quien, 'Alta confirmada por la gestoría', async (cli, a) => {
    if (!['pendiente', 'solicitada'].includes(a.estado)) throw error('Esa alta ya está confirmada o anulada', 409);
    await repo.cambiar(cli, a.id, {
      estado: 'confirmada', confirmada_at: 'now', confirmada_por: quien.usuarioId,
      ...(a.estado === 'pendiente' ? { solicitada_at: 'now', solicitada_por: quien.usuarioId } : {}),
      ...(texto(nota) ? { nota: texto(nota) } : {}),
    });
    await tablero.cerrarPorOrigen(cli, { tipo: T_PEDIR, origenId: a.id, autorId: quien.usuarioId, nota: 'Alta confirmada' });
    await resolverAvisos(cli, A_SIN_CONFIRMAR, a.id, 'El alta ya está confirmada', quien.usuarioId);
    return { estado: 'confirmada' };
  });
}

/** «Anulada»: no llegó a empezar y se pidió anular el alta (o la baja). Con motivo. */
async function anular(id, { nota } = {}, quien = {}) {
  const n = texto(nota);
  if (n.length < 3) throw error('Di por qué se anula (por ejemplo, «no se presentó: pedida la anulación el …»)');
  return marcar(id, quien, `Alta anulada: ${n}`, async (cli, a) => {
    if (a.estado === 'anulada') throw error('Ya estaba anulada', 409);
    await repo.cambiar(cli, a.id, { estado: 'anulada', anulada_at: 'now', anulada_por: quien.usuarioId, nota: n });
    for (const t of [T_PEDIR, T_NO_PRESENTADO]) await tablero.cerrarPorOrigen(cli, { tipo: t, origenId: a.id, autorId: quien.usuarioId, nota: `Anulada: ${n}` });
    for (const t of [A_SIN_CONFIRMAR, A_NO_PRESENTADO, A_ESCALADA]) await resolverAvisos(cli, t, a.id, 'Alta anulada', quien.usuarioId);
    return { estado: 'anulada' };
  });
}

/** Deshacer: vuelve a «sin pedir» (se marcó por error). Con motivo. */
async function reabrir(id, { nota } = {}, quien = {}) {
  const n = texto(nota);
  if (n.length < 3) throw error('Di por qué se deshace');
  return marcar(id, quien, `Alta devuelta a sin pedir: ${n}`, async (cli, a) => {
    if (a.estado === 'pendiente') throw error('Ya está sin pedir', 409);
    await repo.cambiar(cli, a.id, {
      estado: 'pendiente', solicitada_at: null, solicitada_por: null, confirmada_at: null, confirmada_por: null,
      anulada_at: null, anulada_por: null, nota: n,
    });
    return { estado: 'pendiente' };
  });
}

// ── El candado del coche (fichaje.iniciar) ──────────────────────────────────
/**
 * ¿Le falta el alta confirmada para vincular un coche? → null (puede) o
 * { fechaAlta, estado }. Ante un fallo de la base, deja pasar: un error aquí no
 * puede dejar a toda la plantilla sin coche.
 */
async function bloqueaCoche(conductorId) {
  if (!conductorId) return null;
  try {
    if (!await repo.hayTabla()) return null;
    const r = await repo.sinConfirmarDe(conductorId, DESDE);
    return r ? { fechaAlta: r.fecha_alta, estado: r.estado } : null;
  } catch (e) {
    console.error(`⚠️ [Altas] no se pudo mirar el alta de ${conductorId}: ${e.message}`);
    return null;
  }
}

/** Para el planificador: id → estado, de quien tiene un contrato abierto sin el alta confirmada. */
async function sinConfirmar() {
  try { return await repo.hayTabla() ? await repo.idsSinConfirmar(DESDE) : new Map(); }
  catch (e) { console.error('⚠️ [Altas] planificador:', e.message); return new Map(); }
}

// ── Cada hora: el día antes, la no presentación y el contador ───────────────
/**
 * La vuelta de cada hora. Crea las que falten, apunta el primer turno de cada
 * una y mira tres cosas: si mañana (o hoy) empieza alguien sin el alta
 * confirmada, si alguien no se ha presentado a las dos horas de su primer turno
 * y si un no presentado lleva ya dos días cotizados sin resolver.
 */
async function revisar({ cli, ahora = new Date(), enSeguida = false }) {
  if (!await repo.hayTabla(cli)) return { sinTabla: true };
  await libro.firmar(cli, { origen: 'gestoria · altas', accion: 'cambio' });
  const hoy = calendario.partesMadrid(ahora).fecha;
  const creadas = await sincronizar(cli, { hoy });
  const coste = await costeDia();
  const para = await destinatarios(cli);
  const jefes = await ignacio(cli);
  const responsable = await diana();
  const pendientes = [];   // los avisos, al final: van con su propia firma y su notificación
  let sinConfirmar = 0, noPresentados = 0, escaladas = 0, presentados = 0;

  for (const a0 of await repo.vigilar(cli)) {
    // Su primer día con turno (el planificador puede moverlo mientras no se presente).
    let a = a0;
    if (!a.presentado_hay && a.de_alta) {
      const p = await repo.primerTurno(cli, a.conductor_id, a.fecha_alta);
      const dia = p ? p.dia : null, turno = p ? p.turno : null;
      if (dia !== a.primer_dia || turno !== a.primer_turno) {
        await repo.cambiar(cli, a.id, { primer_dia: dia, primer_turno: turno });
        a = { ...a, primer_dia: dia, primer_turno: turno };
      }
    }
    const empieza = a.primer_dia || a.fecha_alta;

    // 1 · El día antes (o el mismo día) sin el alta confirmada.
    if (a.estado !== 'confirmada' && a.de_alta && empieza <= calendario.sumarDias(hoy, 1)) {
      sinConfirmar++;
      pendientes.push({
        ids: para, tipo: A_SIN_CONFIRMAR, origen: a.id, enlace: enlaceDe(a.id),
        titulo: `${empieza <= hoy ? 'Ha empezado' : 'Mañana empieza'} ${a.nombre} sin el alta confirmada`,
        texto: `Su primer turno es el ${dmy(empieza)}${a.primer_turno ? ` (${TURNOS[a.primer_turno] || a.primer_turno})` : ''} y el alta está «${ESTADOS[a.estado].etiqueta.toLowerCase()}». Sin el alta confirmada no puede vincular ningún coche.`,
      });
    }

    // 2 · ¿Se presentó? Desde el inicio de su primer turno.
    if (!a.presentado_hay && a.primer_dia && a.primer_dia <= hoy) {
      const inicio = inicioDelTurno(a.primer_dia, a.primer_turno);
      const como = await repo.sePresento(cli, a.conductor_id, inicio - 6 * 3600000);
      if (como) {
        await repo.cambiar(cli, a.id, { presentado_at: 'now' });
        await tablero.cerrarPorOrigen(cli, { tipo: T_NO_PRESENTADO, origenId: a.id, nota: como === 'coche' ? 'Vinculó un coche' : 'BOLT le vio conectado' });
        for (const t of [A_NO_PRESENTADO, A_ESCALADA]) await resolverAvisos(cli, t, a.id, 'Ya se presentó');
        presentados++;
        continue;
      }
      if (!a.no_presentado_hay && ahora.getTime() >= inicio + HORAS_PARA_NO_PRESENTADO * 3600000) {
        await repo.cambiar(cli, a.id, { no_presentado_at: 'now' });
        a = { ...a, no_presentado_hay: true };
        noPresentados++;
        const dias = diasCotizados(a, hoy);
        const cuesta = coste > 0 && dias ? ` (unos ${(dias * coste).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })})` : '';
        await tablero.nacer(cli, {
          tipo: T_NO_PRESENTADO, origenId: a.id, sensible: true, enlace: enlaceDe(a.id),
          titulo: `No se ha presentado: ${a.nombre}. Pedir hoy la anulación del alta`,
          descripcion: `Su primer turno era el ${dmy(a.primer_dia)} ${TURNOS[a.primer_turno] || ''} y no ha vinculado ningún coche ni BOLT le ha visto conectado. Pide hoy a la gestoría la anulación del alta (o la baja) y márcala anulada en Gestoría › Altas: cada día cotiza.`,
          responsableId: responsable, plazoDias: 0,
        });
        pendientes.push({
          ids: para, tipo: A_NO_PRESENTADO, origen: a.id, enlace: enlaceDe(a.id),
          titulo: `${a.nombre} no se ha presentado a su primer turno`,
          texto: `Era el ${dmy(a.primer_dia)} ${TURNOS[a.primer_turno] || ''}: ni coche vinculado ni conectado en BOLT. Hay que pedir hoy la anulación del alta. Días cotizados: ${dias}${cuesta}.`,
        });
      }
    }

    // 3 · El contador: a los dos días cotizados sin resolver, a Ignacio.
    if (a.no_presentado_hay && !a.presentado_hay && !a.escalada && diasCotizados(a, hoy) >= DIAS_PARA_ESCALAR) {
      await repo.cambiar(cli, a.id, { escalada_at: 'now' });
      escaladas++;
      const dias = diasCotizados(a, hoy);
      pendientes.push({
        ids: jefes, tipo: A_ESCALADA, origen: a.id, enlace: enlaceDe(a.id),
        titulo: `${a.nombre} lleva ${dias} días cotizados sin presentarse`,
        texto: `No se presentó el ${dmy(a.primer_dia)} y su alta sigue sin anular.${coste > 0 ? ` Coste acumulado: unos ${(dias * coste).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}.` : ''}`,
      });
    }
  }
  // Los avisos, fuera de esta transacción (cada uno con su notificación). Si
  // algo falla después, la vuelta siguiente los vuelve a pedir y no se repiten:
  // van por su origen.
  const mandar = async () => { for (const p of pendientes) await avisarA(p.ids, p); };
  if (enSeguida) await mandar(); else setImmediate(mandar);
  if (creadas || noPresentados || presentados) avisarCambio();
  return { creadas, sinConfirmar, noPresentados, escaladas, presentados, avisos: pendientes.reduce((n, p) => n + p.ids.length, 0) };
}

tablero.registrarTipo(T_PEDIR, { etiqueta: 'Pedir el alta a la gestoría', abrir: 'Abrir el alta', cierreManual: false });
tablero.registrarTipo(T_NO_PRESENTADO, { etiqueta: 'No presentado: pedir la anulación del alta', abrir: 'Abrir el alta', cierreManual: false });
avisos.registrarTipo(A_SIN_CONFIRMAR, { etiqueta: 'Empieza sin el alta confirmada', modulo: 'gestoria', icono: 'fa-id-card', urgente: true });
avisos.registrarTipo(A_NO_PRESENTADO, { etiqueta: 'No se presentó a su primer turno', modulo: 'gestoria', icono: 'fa-user-xmark', urgente: true });
avisos.registrarTipo(A_ESCALADA, { etiqueta: 'Dos días cotizados sin presentarse', modulo: 'gestoria', icono: 'fa-triangle-exclamation', urgente: true });

tareasProgramadas.registrar({
  clave: 'gestoria.altas',
  descripcion: 'Cada hora: las altas nuevas sin confirmar el día antes de su primer turno, la no presentación (dos horas después del inicio) y los dos días cotizados',
  desde: DESDE,
  // Una vez por hora: «2026-11-27T08».
  toca: ahora => {
    const { fecha, min } = calendario.partesMadrid(ahora);
    return `${fecha}T${String(Math.floor(min / 60)).padStart(2, '0')}`;
  },
  hacer: ({ cli, ahora }) => revisar({ cli, ahora }),
});

// El justificante de la gestoría, en el alta.
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DUENO, {
  etiqueta: 'Justificante del alta de la gestoría',
  ver: async q => gestoria.puede(quienDe(q), gestoria.CLAVE_VER),
  adjuntar: async q => gestoria.puede(quienDe(q), gestoria.CLAVE_GESTIONAR),
});

// El número en la pestaña: las que piden algo hoy (sin pedir, urgentes o no presentados).
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('gestoria_altas'); }
contadores.registrarFuente('gestoria_altas', {
  async contar(q) {
    const ve = q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(gestoria.CLAVE_VER)));
    if (!ve) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.lista(30) : [])).then(f => {
        const hoy = calendario.hoy();
        const s = f.map(a => situacion(a, hoy).codigo);
        return { n: s.filter(c => ['pendiente', 'urgente', 'no_presentado'].includes(c)).length, graves: s.some(c => ['urgente', 'no_presentado'].includes(c)) };
      }) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const { n, graves } = await cuenta.valor;
    return n ? { 'gestoria.altas': { n, tono: graves ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'alta' : 'altas'} por atender` } } : {};
  },
});

module.exports = {
  lista, ficha, solicitar, confirmar, anular, reabrir, bloqueaCoche, sinConfirmar, revisar, sincronizar,
  diasCotizados, situacion, inicioDelTurno, ESTADOS, DESDE, DUENO,
};
