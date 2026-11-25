// ============================================================
// EL ENVÍO A FIRMA — LA PUERTA (módulo 6, db/293, 25/11/2026)
// ============================================================
// Camilo: «Diana verá si se hace o no … esperará a que te mandemos a ti a
// enviar los documentos, pero a nombre de Diana ya que ella es lo que lo
// aprueba, siempre debe de ser un humano». Plan Plus de YouTrust (la
// aplicación: firmas ilimitadas y autenticación por SMS); sin la API.
//
//   · LA COLA: un documento (PDF) para una persona. Entra a mano (una carta de
//     suspensión, un descuento…) o solo: al aprobarse un finiquito, a falta del
//     finiquito de la gestoría.
//   · DIANA APRUEBA (llave '/firmas/aprobar'): con el PDF subido, el email y el
//     móvil del firmante. O lo descarta, con motivo. Le nace una tarjeta por
//     cada borrador.
//   · CLAUDE LO MANDA: los aprobados esperan. Cuando una persona lo pide en el
//     chat y dice que sí a la tanda, Claude los manda por la aplicación de
//     YouTrust en la cuenta de Diana (firma simple con código por SMS) y los
//     apunta con `scripts/firmas/bot.js`: «enviado por Bot telecab, en nombre
//     de Diana». Esas funciones (`delBot`) solo las usa el usuario Bot telecab:
//     no tienen ruta.
//   · FIRMADO: con el PDF firmado adjunto (lo sube Diana) o lo apunta el bot
//     con el enlace de YouTrust. Si era un finiquito, el finiquito queda firmado.
'use strict';

const repo = require('./firmas.repo');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const contadores = require('../../services/contadores');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const adjuntos = require('../../services/adjuntos');

const CLAVE_VER = '/firmas';
const CLAVE_APROBAR = '/firmas/aprobar';
const TOTAL = ['superadmin', 'desarrollador'];
const T_APROBAR = 'firma_aprobar';
const DOC = 'firma_envio';        // el PDF que se manda a firmar
const FIRMADO = 'firma_firmada';  // el PDF firmado

const TIPOS = {
  finiquito: 'Finiquito', suspension: 'Suspensión de empleo y sueldo', sancion: 'Carta de sanción',
  descuento: 'Descuento en nómina', contrato: 'Contrato',
  comunicacion: 'Comunicación de horas (ausencias)', otro: 'Otro documento',
};
// Cómo se manda cada tipo. `plantilla`: el documento es una plantilla de
// YouTrust (no se sube PDF); `sms`: la firma lleva código por SMS (hace falta
// el móvil). Camilo (25/11/2026), de las comunicaciones de horas: «sin SMS de
// autenticación, directo a su correo electrónico».
// La plantilla de YouTrust de las comunicaciones (creada el 25/11/2026):
// firmante de marcador «Conductor» (firma simple, sin código) y los textos de
// solo lectura «Incidencias» y «Total». Va sin espacio de trabajo: al crear la
// solicitud hay que decir el de la cuenta («Datos telecab»).
const COMO = {
  comunicacion: {
    plantilla: 'Comunicación al trabajador', sms: false,
    plantillaId: '4dd646df-3e2d-455a-b363-664b032c446c', workspaceId: '8cca36ee-1d49-4385-985c-d0d98930707a',
  },
};
const comoSe = tipo => ({ plantilla: null, sms: true, ...(COMO[tipo] || {}) });
const ESTADOS = {
  borrador: { etiqueta: 'Por aprobar', tono: 'warn' },
  aprobado: { etiqueta: 'Aprobado, por enviar', tono: 'gold' },
  enviado: { etiqueta: 'Enviado, sin firmar', tono: 'azul' },
  firmado: { etiqueta: 'Firmado', tono: 'green' },
  rechazado: { etiqueta: 'No lo firmó', tono: 'red' },
  caducado: { etiqueta: 'Caducado', tono: 'red' },
  descartado: { etiqueta: 'Descartado', tono: 'muted' },
  error: { etiqueta: 'Error al enviar', tono: 'red' },
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
// La solicitud en la aplicación de YouTrust (el `url` que da su conector).
const YOUTRUST_APP = 'https://yousign.app/auth/workspace/requests/';
// Lo que dice YouTrust de una solicitud → cómo queda aquí.
const ESTADO_YOUTRUST = {
  done: { estado: 'firmado', nota: 'Firmado en YouTrust' },
  declined: { estado: 'rechazado', nota: 'No lo firmó (rechazado en YouTrust)' },
  expired: { estado: 'caducado', nota: 'Caducó en YouTrust' },
  canceled: { estado: 'caducado', nota: 'Cancelado en YouTrust' },
};
const texto = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const emailValido = e => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(String(e || ''));

async function puede(quien, llave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol) && llave === CLAVE_VER) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(llave); } catch (_) { return false; }
}
const exigir = async (quien, llave, que) => { if (!await puede(quien, llave)) throw error(que || 'No tienes permiso para esto', 403); };

async function cargar(cli, id) {
  const f = await repo.porId(String(id), cli);
  if (!f) throw error('No existe ese envío', 404);
  return f;
}

// ── La tarjeta de Diana ────────────────────────────────────────────────────
tablero.registrarTipo(T_APROBAR, { etiqueta: 'Documento para firma', abrir: 'Decidir si se manda', cierreManual: false });

async function tarjeta(cli, id, titulo) {
  const titulares = await organizacion.quienes('firmas_aprobar', { conSuplentes: false }).catch(() => []);
  await tablero.nacer(cli, {
    tipo: T_APROBAR, origenId: String(id), enlace: `/firmas#${id}`, sensible: true,
    titulo: `Para firma: ${titulo}`.slice(0, 200),
    descripcion: 'Sube el PDF si falta, comprueba el email y el móvil del firmante, y decide si se manda a firmar.',
    responsableId: titulares.length ? titulares[0].id : null, plazoDias: 1,
  });
}
const cerrarTarjeta = (cli, id, autorId, nota) => tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: String(id), autorId, nota });

// ── Entrar en la cola ──────────────────────────────────────────────────────
/** A mano: un documento para una persona. → { id } (el PDF se sube después, en su ficha). */
async function crear({ conductorId, tipo, titulo, nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Los envíos a firma los prepara quien los aprueba');
  if (!TIPOS[tipo]) throw error('Elige qué documento es');
  const firmante = await repo.firmanteDe(Number(conductorId));
  if (!firmante) throw error('No encuentro a esa persona');
  const t = texto(titulo, 200) || `${TIPOS[tipo]} de ${firmante.nombre}`;
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'firmas', accion: 'alta', motivo: 'Envío a firma preparado a mano' }, async cli => {
    const id = await repo.insertar(cli, { tipo, titulo: t, conductorId: Number(conductorId), firmante, nota: texto(nota), creadoPor: quien.usuarioId });
    await tarjeta(cli, id, t);
    return { id };
  });
  avisarCambio();
  return r;
}

/**
 * Solo, al aprobarse un finiquito: el envío nace en borrador, a falta de subir
 * el finiquito de la gestoría (es el documento que se firma, con los importes;
 * el resumen del ERP no lo es). No lanza: el finiquito ya está aprobado.
 */
async function desdeFiniquito(f) {
  try {
    if (!await repo.hayTabla()) return null;
    const bot = await repo.bot();
    const firmante = await repo.firmanteDe(Number(f.conductor_id));
    const titulo = `Finiquito de ${f.nombre} (baja el ${String(f.fecha_baja).split('-').reverse().join('/')})`;
    const r = await libro.conFirma({ usuarioId: bot, origen: 'firmas', accion: 'alta', motivo: 'Finiquito aprobado: a la cola de firmas' }, async cli => {
      if (await repo.deOrigen(cli, 'finiquito', f.id)) return null;
      const id = await repo.insertar(cli, { tipo: 'finiquito', titulo, origen: 'finiquito', origenId: f.id, conductorId: Number(f.conductor_id),
        firmante, nota: 'Sube el finiquito que prepare la gestoría (el documento con los importes) y apruébalo para mandarlo a firmar.', creadoPor: bot });
      await tarjeta(cli, id, titulo);
      return { id };
    });
    avisarCambio();
    return r;
  } catch (e) { console.error(`❌ [Firmas] el finiquito ${f.id} no entró en la cola: ${e.message}`); return null; }
}

// ── Lo que decide Diana ────────────────────────────────────────────────────
/**
 * APROBAR: se manda. Hace falta el PDF y el email y el móvil del firmante (se
 * toman de su ficha en este momento: si estaban mal, se corrigen allí y se
 * vuelve a aprobar). Queda «en nombre de» quien lo aprueba.
 */
async function aprobar(id, { nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aprobar envíos a firma es de quien tiene la llave «Firmas · aprobar»');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'firmas', accion: 'cambio', motivo: `Aprobado para firma${texto(nota) ? `: ${texto(nota)}` : ''}` }, async cli => {
    const f = await cargar(cli, id);
    await comprobarParaAprobar(cli, f);
    const p = await repo.firmanteDe(Number(f.conductor_id), cli);
    await repo.cambiar(cli, f.id, { estado: 'aprobado', aprobado_at: 'now', aprobado_por: quien.usuarioId, en_nombre_de: quien.usuarioId,
      firmante_nombre: p.nombre, firmante_email: p.email, firmante_movil: p.movil, ...(texto(nota) ? { nota: texto(nota) } : {}) });
    await cerrarTarjeta(cli, f.id, quien.usuarioId, 'Aprobado: espera a que se mande');
    if (f.origen === 'semana') await require('./comunicaciones.service').cerrarSiHecha(cli, f.origen_id, quien.usuarioId);
    return { estado: 'aprobado' };
  });
  avisarCambio();
  return r;
}

/** Lo que tiene que tener para aprobarse: el PDF (si no es plantilla), el email y, con SMS, el móvil. */
async function comprobarParaAprobar(cli, f) {
  const como = comoSe(f.tipo);
  if (f.estado !== 'borrador') throw error('Solo se aprueba el que está por aprobar', 409);
  if (!como.plantilla && !f.documentos) throw error('Falta el PDF que se va a firmar: súbelo en «Documento a firmar»', 409);
  const p = await repo.firmanteDe(Number(f.conductor_id), cli);
  if (!emailValido(p.email)) {
    throw error(f.tipo === 'comunicacion' ? `${f.nombre}: falta el email del conductor. Ponlo en su ficha (Plantilla) para poder mandársela.`
      : 'Falta el email de la persona (o está mal) en su ficha: YouTrust manda la invitación por correo', 409);
  }
  if (como.sms && !/^\+\d{8,15}$/.test(String(p.movil || ''))) throw error('Falta su móvil en la ficha: la firma lleva un código por SMS', 409);
}

/**
 * APROBAR VARIAS a la vez (las comunicaciones de la semana). Las que no se
 * pueden (sin email…) se quedan como estaban y se dice por qué.
 * → { aprobadas, fallos: [{ id, nombre, motivo }] }
 */
async function aprobarVarias({ ids } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aprobar envíos a firma es de quien tiene la llave «Firmas · aprobar»');
  const lista_ = [...new Set([].concat(ids || []).map(String).filter(x => /^\d+$/.test(x)))];
  if (!lista_.length) throw error('No hay ninguno marcado');
  let aprobadas = 0;
  const fallos = [];
  for (const id of lista_) {
    try { await aprobar(id, {}, quien); aprobadas++; }
    catch (e) { const f = await repo.porId(id).catch(() => null); fallos.push({ id, nombre: f ? f.nombre : '', motivo: e.message }); }
  }
  return { aprobadas, fallos };
}

async function descartar(id, { nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Descartar envíos a firma es de quien los aprueba');
  const n = texto(nota);
  if (n.length < 3) throw error('Di por qué no se manda');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'firmas', accion: 'cambio', motivo: `Descartado: ${n}` }, async cli => {
    const f = await cargar(cli, id);
    if (!['borrador', 'aprobado', 'error'].includes(f.estado)) throw error('Ese ya se mandó: no se descarta', 409);
    await repo.cambiar(cli, f.id, { estado: 'descartado', cerrado_at: 'now', cerrado_por: quien.usuarioId, nota: `Descartado: ${n}` });
    await cerrarTarjeta(cli, f.id, quien.usuarioId, 'Descartado');
    if (f.origen === 'semana') await require('./comunicaciones.service').cerrarSiHecha(cli, f.origen_id, quien.usuarioId);
    return { estado: 'descartado' };
  });
  avisarCambio();
  return r;
}

/** Uno aprobado, o que dio error, vuelve a borrador (para corregir el PDF o los datos). */
async function aBorrador(id, { nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'firmas', accion: 'cambio', motivo: `Vuelve a borrador${texto(nota) ? `: ${texto(nota)}` : ''}` }, async cli => {
    const f = await cargar(cli, id);
    if (!['aprobado', 'error'].includes(f.estado)) throw error('Solo vuelve a borrador el aprobado sin enviar o el que dio error', 409);
    await repo.cambiar(cli, f.id, { estado: 'borrador', aprobado_at: null, aprobado_por: null, en_nombre_de: null });
    await tarjeta(cli, f.id, f.titulo);
    return { estado: 'borrador' };
  });
  avisarCambio();
  return r;
}

/** Cerrarlo por su resultado desde la pantalla: firmado (con el firmado adjunto), no lo firmó o caducado. */
async function cerrar(id, { estado, nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR);
  return cerrarComo(id, estado, texto(nota), quien);
}

async function cerrarComo(id, estado, nota, quien) {
  if (!['firmado', 'rechazado', 'caducado'].includes(estado)) throw error('Ese cierre no existe');
  const f0 = await cargar(null, id);
  if (estado === 'firmado' && !quien.bot && !f0.firmados) throw error('Sube antes el PDF firmado en «Firmado»', 409);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'firmas', accion: 'cambio',
    motivo: `${ESTADOS[estado].etiqueta}${quien.bot && quien.enNombreDe ? ' (Bot telecab)' : ''}${nota ? `: ${nota}` : ''}` }, async cli => {
    const f = await cargar(cli, id);
    if (f.estado !== 'enviado') throw error('Solo se cierra el que está enviado', 409);
    await repo.cambiar(cli, f.id, { estado, cerrado_at: 'now', cerrado_por: quien.usuarioId, ...(nota ? { nota } : {}) });
    // Si era un finiquito, el finiquito queda firmado.
    if (estado === 'firmado' && f.origen === 'finiquito') {
      await require('./finiquitos.repo').cambiar(cli, f.origen_id, { estado: 'firmado', firmado_at: 'now', firmado_por: quien.usuarioId });
    }
    return { estado };
  });
  avisarCambio();
  return r;
}

// ── Lo que hace Claude (el usuario Bot telecab), sin ruta ─────────────────
async function comoBot() {
  const id = await repo.bot();
  if (!id) throw error('No existe el usuario Bot telecab: falta aplicar la migración db/293');
  return { usuarioId: id, bot: true };
}

const delBot = {
  /** Los aprobados, con todo lo que hace falta para mandarlos. */
  async pendientes() {
    return repo.porEstado('aprobado');
  },
  /**
   * Mandado por YouTrust: el número de la solicitud (`ref`, el de su conector)
   * y su enlace (si no se da, el de la aplicación). En nombre de quien lo aprobó.
   */
  async enviado(id, { url, ref } = {}) {
    const bot = await comoBot();
    const r0 = texto(ref, 120);
    if (!/^[0-9a-f-]{36}$/i.test(r0)) throw error('Falta el número de la solicitud de YouTrust');
    const u = texto(url, 500) || `${YOUTRUST_APP}${r0}`;
    if (!/^https:\/\//.test(u)) throw error('El enlace de la solicitud no es válido');
    const r = await libro.conFirma({ usuarioId: bot.usuarioId, origen: 'firmas · Bot telecab', accion: 'cambio', motivo: `Enviado a firma por YouTrust: ${u}` }, async cli => {
      const f = await cargar(cli, id);
      if (f.estado !== 'aprobado') throw error(`Está «${ESTADOS[f.estado].etiqueta}»: solo se manda el aprobado`, 409);
      await repo.cambiar(cli, f.id, { estado: 'enviado', enviado_at: 'now', enviado_por: bot.usuarioId, proveedor_url: u, proveedor_ref: r0 });
      return { estado: 'enviado', enNombreDe: f.aprobado_por_nombre };
    });
    avisarCambio();
    return r;
  },
  /** No se pudo mandar (vuelve a Diana para corregir). */
  async error(id, { motivo } = {}) {
    const bot = await comoBot();
    const m = texto(motivo);
    if (m.length < 3) throw error('Di qué pasó');
    const r = await libro.conFirma({ usuarioId: bot.usuarioId, origen: 'firmas · Bot telecab', accion: 'cambio', motivo: `Error al enviar: ${m}` }, async cli => {
      const f = await cargar(cli, id);
      if (f.estado !== 'aprobado') throw error('Solo da error el que se iba a mandar', 409);
      await repo.cambiar(cli, f.id, { estado: 'error', nota: `Error al enviar: ${m}` });
      await tarjeta(cli, f.id, f.titulo);
      return { estado: 'error' };
    });
    avisarCambio();
    return r;
  },
  /** Firmado, no lo firmó o caducó, según YouTrust. */
  async cerrar(id, { estado, nota } = {}) {
    return cerrarComo(id, estado, texto(nota), await comoBot());
  },
  /** Los enviados, con el número de su solicitud: lo que hay que consultar en YouTrust. */
  async enviados() {
    return repo.porEstado('enviado');
  },
  /**
   * PONERLO AL DÍA con lo que dice YouTrust de su solicitud (el `status` de
   * get-signature-request del conector): done → firmado, declined → no lo
   * firmó, expired o canceled → caducado. Lo demás (ongoing…) no cambia nada.
   * → { estado } o { sinCambios: true }
   */
  async sincronizar(id, { estado: suyo, cuando, motivo } = {}) {
    const a = ESTADO_YOUTRUST[String(suyo || '')];
    if (!a) return { sinCambios: true, youtrust: suyo || null };
    const nota = [a.nota, cuando ? `el ${new Date(cuando).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}` : '', texto(motivo)]
      .filter(Boolean).join(' ');
    return cerrarComo(id, a.estado, nota, await comoBot());
  },
};

// ── Leer ───────────────────────────────────────────────────────────────────
async function lista(quien) {
  await exigir(quien, CLAVE_VER);
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, estados: ESTADOS, tipos: TIPOS };
  return { filas: await repo.lista(), sinTabla: false, estados: ESTADOS, tipos: TIPOS, como: COMO, puedeAprobar: await puede(quien, CLAVE_APROBAR) };
}

async function ficha(id, quien) {
  await exigir(quien, CLAVE_VER);
  const f = await cargar(null, id);
  // El firmante de HOY, para ver si cambió en la ficha desde que se preparó.
  const hoy = await repo.firmanteDe(Number(f.conductor_id));
  return { ...f, firmanteHoy: hoy, puedeAprobar: await puede(quien, CLAVE_APROBAR) };
}

async function personas(quien) {
  await exigir(quien, CLAVE_APROBAR);
  return { personas: await repo.personas() };
}

// ── Los PDF: el que se firma y el firmado ──────────────────────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DOC, {
  etiqueta: 'Documento a firmar',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async q => puede(quienDe(q), CLAVE_APROBAR),
});
adjuntos.registrarDueno(FIRMADO, {
  etiqueta: 'Documento firmado',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async q => puede(quienDe(q), CLAVE_APROBAR),
});

// ── El número del menú ─────────────────────────────────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('firmas'); }
contadores.registrarFuente('firmas', {
  async contar(q) {
    const tiene = c => q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(c)));
    if (!tiene(CLAVE_APROBAR)) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.cuantos() : { borradores: 0 })) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const n = (await cuenta.valor).borradores;
    return { 'firmas.pendientes': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'documento' : 'documentos'} para firma por decidir` } };
  },
});

module.exports = {
  crear, desdeFiniquito, aprobar, aprobarVarias, comoSe, descartar, aBorrador, cerrar, lista, ficha, personas, puede, delBot,
  TIPOS, ESTADOS, CLAVE_VER, CLAVE_APROBAR, DOC, FIRMADO,
};
