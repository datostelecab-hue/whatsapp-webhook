// ============================================================
// LOS COMUNICADOS A LA PLANTILLA (plan de RR. HH., módulos 6 y 9, db/305, 26/11/2026)
// ============================================================
// El encargo: «comunicaciones con acuse: normativa interna, nuevos códigos de
// descuento y similares. Envío masivo a toda la plantilla o a un grupo, con
// seguimiento de quién ha firmado y recordatorios automáticos». Y en la prueba
// de aceptación: «un envío masivo muestra en tiempo real quién ha firmado y
// quién no».
//
// Lo que decidió Camilo el 26/11/2026:
//   · EL ACUSE es el «Lo he leído» del portal de conductores: queda el día, la
//     hora, la IP y el navegador de su sesión (entró con su DNI y un código a
//     su correo). Gratis y para 250 personas a la vez.
//   · SE AVISA por correo, con el enlace al portal, y en el portal (tarjeta en
//     el inicio). Nada de WhatsApp: desde el 01/10 Meta cobra cada plantilla.
//   · A QUIEN NO LO HA LEÍDO, un recordatorio por correo cada 2 días hábiles,
//     3 como mucho. Después queda como «no lo ha leído» y decide Diana.
//   · LO PREPARA Diana (llave «preparar») y NO SALE hasta que lo aprueba otra
//     persona (llave «aprobar»; Ignacio). Quien lo preparó no lo aprueba.
//
// Al aprobarse se hace la FOTO de a quién va (la plantilla de alta en ese
// momento, por su alcance) y salen los correos, en segundo plano.
//
// Y desde el 27/11/2026 (db/310):
//   · UN PDF (una circular, una norma), adjunto del dueño 'comunicado', que se
//     sube mientras es borrador. Se abre SOLO en el portal (Camilo: «en el
//     portal; el correo avisa»): así queda cuándo lo abrió cada uno (`pdf_at`).
//   · A QUIEN NO LO HA LEÍDO, un SMS certificado cuando Diana lo decida: el
//     botón prepara el borrador en /sms (origen 'comunicado'), con el PDF.
'use strict';

const repo = require('./comunicados.repo');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const tareasProgramadas = require('../../services/tareasProgramadas');
const contadores = require('../../services/contadores');
const correo = require('../../services/correo');
const adjuntos = require('../../services/adjuntos');

const DUENO_PDF = 'comunicado';

const CLAVE_VER = '/comunicados';
const CLAVE_PREPARAR = '/comunicados/preparar';
const CLAVE_APROBAR = '/comunicados/aprobar';
const TOTAL = ['superadmin', 'desarrollador'];
const T_APROBAR = 'comunicado_aprobar';
const PORTAL = (process.env.PORTAL_URL || 'https://conductorestelecab.es').replace(/\/+$/, '');
const RECORDAR_CADA = 2;      // días hábiles
const RECORDATORIOS = 3;

const ALCANCES = {
  todos: 'Toda la plantilla de alta',
  propia: 'La plantilla propia',
  ett: 'Los de ETT',
  personas: 'Unas personas',
};
const ESTADOS = {
  borrador: { etiqueta: 'Borrador', tono: 'muted' },
  por_aprobar: { etiqueta: 'Por aprobar', tono: 'warn' },
  enviado: { etiqueta: 'Enviado', tono: 'green' },
  anulado: { etiqueta: 'Anulado', tono: 'muted' },
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function puede(quien, clave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol)) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(clave); } catch (_) { return false; }
}
const exigir = async (quien, clave, msg = 'No tienes permiso para esto') => { if (!await puede(quien, clave)) throw error(msg, 403); };

function limpiar(b = {}) {
  const titulo = texto(b.titulo, 160);
  const cuerpo = texto(b.cuerpo, 20000);
  const alcance = ALCANCES[b.alcance] ? b.alcance : null;
  if (!titulo) throw error('Falta el título');
  if (cuerpo.length < 10) throw error('Escribe el texto del comunicado');
  if (!alcance) throw error('Di a quién va');
  const personas = alcance === 'personas'
    ? [...new Set([].concat(b.personas || []).map(Number).filter(n => Number.isInteger(n) && n > 0))] : null;
  if (alcance === 'personas' && !personas.length) throw error('Elige al menos una persona');
  return { titulo, cuerpo, alcance, personas };
}

// ── La oficina ─────────────────────────────────────────────────────────────
async function lista(quien = {}) {
  await exigir(quien, CLAVE_VER);
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, estados: ESTADOS, alcances: ALCANCES };
  const [prepara, aprueba] = await Promise.all([puede(quien, CLAVE_PREPARAR), puede(quien, CLAVE_APROBAR)]);
  return { filas: (await repo.lista()).map(publico), sinTabla: false, estados: ESTADOS, alcances: ALCANCES, puedePreparar: prepara, puedeAprobar: aprueba };
}

const publico = m => ({ ...m, alcance_texto: ALCANCES[m.alcance] || m.alcance, sin_leer: m.total - m.leidos });

/** El comunicado con cómo va cada persona (lo que se refresca en pantalla). */
async function ficha(id, quien = {}) {
  await exigir(quien, CLAVE_VER);
  const m = await repo.porId(null, id);
  if (!m) throw error('Ese comunicado no existe', 404);
  const personas = m.estado === 'enviado' ? await repo.destinatarios(id) : [];
  // Antes de mandarlo, a cuántos iría (y cuántos sin correo).
  const previa = m.estado !== 'enviado' && m.estado !== 'anulado'
    ? await repo.destinatariosDe(null, { alcance: m.alcance, personas: m.personas }) : null;
  return {
    ...publico(m), personas,
    previa: previa ? { total: previa.length, sinCorreo: previa.filter(p => !p.email).length } : null,
    puedePreparar: await puede(quien, CLAVE_PREPARAR), puedeAprobar: await puede(quien, CLAVE_APROBAR),
    puedeSms: await puede(quien, '/sms/enviar'),
    esSuyo: Number(m.creado_por) === Number(quien.usuarioId),
  };
}

/** Para elegir «unas personas»: la plantilla de alta. */
async function personas(quien = {}) {
  await exigir(quien, CLAVE_PREPARAR);
  return { personas: await repo.destinatariosDe(null, { alcance: 'todos' }) };
}

async function crear(b = {}, quien = {}) {
  await exigir(quien, CLAVE_PREPARAR, 'Preparar comunicados es de quien tiene la llave «Comunicados · preparar»');
  const x = limpiar(b);
  const id = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'comunicados', accion: 'alta', motivo: `Comunicado: ${x.titulo}` },
    cli => repo.insertar(cli, { ...x, creadoPor: quien.usuarioId }));
  avisarCambio();
  return { id };
}

async function editar(id, b = {}, quien = {}) {
  await exigir(quien, CLAVE_PREPARAR, 'Preparar comunicados es de quien tiene la llave «Comunicados · preparar»');
  const x = limpiar(b);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'comunicados', accion: 'cambio', motivo: 'Comunicado corregido' }, async cli => {
    const m = await repo.porId(cli, id);
    if (!m) throw error('Ese comunicado no existe', 404);
    if (m.estado !== 'borrador') throw error('Solo se corrige un borrador (si está por aprobar, que te lo devuelvan)', 409);
    await repo.cambiar(cli, id, { titulo: x.titulo, cuerpo: x.cuerpo, alcance: x.alcance, personas: x.personas });
  });
  avisarCambio();
  return { id };
}

/** Pedir que se apruebe: nace la tarjeta a quien aprueba. */
async function pedir(id, quien = {}) {
  await exigir(quien, CLAVE_PREPARAR, 'Preparar comunicados es de quien tiene la llave «Comunicados · preparar»');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'comunicados', accion: 'cambio', motivo: 'Pedido que se apruebe' }, async cli => {
    const m = await repo.porId(cli, id);
    if (!m) throw error('Ese comunicado no existe', 404);
    if (m.estado !== 'borrador') throw error('Ya estaba pedido o mandado', 409);
    const van = await repo.destinatariosDe(cli, { alcance: m.alcance, personas: m.personas });
    if (!van.length) throw error('No va a nadie: no hay nadie de alta en ese grupo', 409);
    await repo.cambiar(cli, id, { estado: 'por_aprobar', pedido_at: 'now', nota: null });
    const aprueban = (await repo.conLlave(cli, CLAVE_APROBAR)).filter(u => u !== Number(quien.usuarioId));
    await tablero.nacer(cli, {
      tipo: T_APROBAR, origenId: String(id), enlace: `/comunicados#${encodeURIComponent(id)}`,
      titulo: `Aprobar el comunicado «${m.titulo}» (${van.length} ${van.length === 1 ? 'persona' : 'personas'})`,
      descripcion: 'Léelo y, si está bien, apruébalo: sale por correo y al portal a cada persona, que tiene que pulsar «Lo he leído». Si hay que cambiar algo, devuélvelo con una nota.',
      responsableId: aprueban[0] || null, plazoDias: 1,
    });
  });
  avisarCambio();
  return { estado: 'por_aprobar' };
}

/** Devolverlo al borrador, con nota (lo hace quien aprueba, o quien lo preparó para corregirlo). */
async function devolver(id, { nota } = {}, quien = {}) {
  const [aprueba, prepara] = await Promise.all([puede(quien, CLAVE_APROBAR), puede(quien, CLAVE_PREPARAR)]);
  if (!aprueba && !prepara) throw error('No tienes permiso para esto', 403);
  const n = texto(nota, 2000);
  if (aprueba && n.length < 3) throw error('Di qué hay que cambiar');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'comunicados', accion: 'cambio', motivo: `Devuelto al borrador${n ? `: ${n}` : ''}` }, async cli => {
    const m = await repo.porId(cli, id);
    if (!m) throw error('Ese comunicado no existe', 404);
    if (m.estado !== 'por_aprobar') throw error('Solo se devuelve uno que está por aprobar', 409);
    await repo.cambiar(cli, id, { estado: 'borrador', nota: n || null });
    await tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: String(id), autorId: quien.usuarioId, nota: `Devuelto${n ? `: ${n}` : ''}` });
  });
  avisarCambio();
  return { estado: 'borrador' };
}

/**
 * APROBAR: se hace la foto de a quién va y sale. Quien lo preparó no lo aprueba.
 * Los correos salen después, en segundo plano (`esperar` para las pruebas).
 */
async function aprobar(id, quien = {}, { esperar = false } = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aprobar comunicados es de quien tiene la llave «Comunicados · aprobar»');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'comunicados', accion: 'cambio', motivo: 'Comunicado aprobado y enviado' }, async cli => {
    const m = await repo.porId(cli, id);
    if (!m) throw error('Ese comunicado no existe', 404);
    if (m.estado !== 'por_aprobar') throw error('Solo se aprueba uno que está por aprobar', 409);
    if (Number(m.creado_por) === Number(quien.usuarioId)) throw error('Lo preparaste tú: lo tiene que aprobar otra persona', 409);
    const van = await repo.destinatariosDe(cli, { alcance: m.alcance, personas: m.personas });
    if (!van.length) throw error('No va a nadie: no hay nadie de alta en ese grupo', 409);
    await repo.guardarDestinatarios(cli, id, van);
    await repo.cambiar(cli, id, { estado: 'enviado', aprobado_por: quien.usuarioId, aprobado_at: 'now' });
    await tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: String(id), autorId: quien.usuarioId, nota: 'Aprobado y enviado' });
    return { personas: van.length, sinCorreo: van.filter(p => !p.email).length };
  });
  avisarCambio();
  const envio = mandarCorreos(id).catch(e => console.error(`❌ [Comunicados] correos del ${id}: ${e.message}`));
  if (esperar) await envio;
  return { estado: 'enviado', ...r };
}

async function anular(id, { nota } = {}, quien = {}) {
  const [aprueba, prepara] = await Promise.all([puede(quien, CLAVE_APROBAR), puede(quien, CLAVE_PREPARAR)]);
  if (!aprueba && !prepara) throw error('No tienes permiso para esto', 403);
  const n = texto(nota, 2000);
  if (n.length < 3) throw error('Di por qué se anula');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'comunicados', accion: 'anulacion', motivo: n }, async cli => {
    const m = await repo.porId(cli, id);
    if (!m) throw error('Ese comunicado no existe', 404);
    if (m.estado === 'anulado') throw error('Ya estaba anulado', 409);
    // Uno enviado ya lo han recibido: anularlo solo lo puede hacer quien aprueba (lo quita del portal).
    if (m.estado === 'enviado' && !aprueba) throw error('Uno ya enviado solo lo anula quien aprueba', 403);
    await repo.cambiar(cli, id, { estado: 'anulado', anulado_por: quien.usuarioId, anulado_at: 'now', nota: n });
    await tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: String(id), autorId: quien.usuarioId, nota: `Anulado: ${n}` });
  });
  avisarCambio();
  return { estado: 'anulado' };
}

// ── Los correos ────────────────────────────────────────────────────────────
function correoDe({ pila, titulo, id, recordatorio = 0, conPdf = false }) {
  const enlace = `${PORTAL}/comunicados/${encodeURIComponent(id)}`;
  const hola = `Hola${pila ? `, ${pila}` : ''}:`;
  const que = recordatorio
    ? `Todavía no has confirmado que has leído el comunicado «${titulo}» de Telecab.`
    : `Tienes un comunicado nuevo de Telecab: «${titulo}».`;
  const pide = conPdf
    ? 'Lleva un documento: ábrelo en tu portal de conductores y pulsa «Lo he leído» al final.'
    : 'Léelo en tu portal de conductores y pulsa «Lo he leído» al final.';
  const entrar = 'Se entra con tu DNI y el código que te llega a este correo.';
  return {
    subject: recordatorio ? `Recordatorio: ${titulo}` : `Comunicado de Telecab: ${titulo}`,
    text: `${hola}\n\n${que}\n${pide}\n\n${enlace}\n\n${entrar}\n`,
    html: `<p>${esc(hola)}</p><p>${esc(que)}<br>${esc(pide)}</p>`
      + `<p><a href="${esc(enlace)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Leer el comunicado</a></p>`
      + `<p style="color:#64748b;font-size:13px">${esc(entrar)}</p>`,
  };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Los correos que faltan de un comunicado, uno a uno. Cada uno queda apuntado (o su error). */
async function mandarCorreos(id) {
  const m = await repo.porId(null, id);
  if (!m || m.estado !== 'enviado') return { mandados: 0 };
  let mandados = 0, fallidos = 0;
  const conPdf = await tienePdf(id);
  for (const d of await repo.correosPorMandar(id)) {
    try {
      const r = await correo.enviarCorreo({ to: d.email, ...correoDe({ pila: d.pila, titulo: m.titulo, id, conPdf }) });
      if (r && r.enviado === false) throw new Error(r.motivo || 'no se mandó');
      await repo.apuntarCorreo(d.id);
      mandados++;
    } catch (e) {
      await repo.apuntarCorreo(d.id, { error: texto(e.message, 300) || 'error' }).catch(() => null);
      fallidos++;
    }
  }
  if (mandados || fallidos) console.log(`📣 [Comunicados] ${id}: ${mandados} correos mandados${fallidos ? `, ${fallidos} fallidos` : ''}`);
  return { mandados, fallidos };
}

/**
 * LOS RECORDATORIOS (cada día a las 09:00, si es hábil): a quien no lo ha
 * leído, si desde el último correo han pasado 2 días hábiles y lleva menos de 3.
 */
async function recordar({ cli = null, hoy = calendario.hoy() } = {}) {
  if (!await repo.hayTabla(cli)) return { sinTabla: true };
  const cal = await calendario.de('madrid');
  if (!cal.esHabil(hoy)) return { saltada: 'no es hábil' };
  const tocan = (await repo.sinLeer(cli)).filter(d => d.recordatorios < RECORDATORIOS && cal.diasHabilesEntre(d.ultimo, hoy) >= RECORDAR_CADA);
  let mandados = 0;
  const pdfs = new Map();
  for (const d of tocan) {
    try {
      if (!pdfs.has(d.comunicado_id)) pdfs.set(d.comunicado_id, await tienePdf(d.comunicado_id));
      const r = await correo.enviarCorreo({ to: d.email, ...correoDe({ pila: d.pila, titulo: d.titulo, id: d.comunicado_id,
        recordatorio: d.recordatorios + 1, conPdf: pdfs.get(d.comunicado_id) }) });
      if (r && r.enviado === false) throw new Error(r.motivo || 'no se mandó');
      await repo.apuntarCorreo(d.id, { recordatorio: true });
      mandados++;
    } catch (e) { console.error(`❌ [Comunicados] recordatorio ${d.id}: ${e.message}`); }
  }
  return { recordatorios: mandados };
}

// ── El portal ──────────────────────────────────────────────────────────────
/** Los suyos (los sin leer primero). */
async function delConductor(persona) {
  if (!persona || !await repo.hayTabla()) return [];
  return repo.deConductor(persona.id);
}

/** ¿Lleva PDF? */
async function tienePdf(id) {
  try { return (await adjuntos.delDueno(DUENO_PDF, id)).some(a => /pdf/i.test(a.mime)); } catch (_) { return false; }
}

/** Abrir uno: queda que lo ha visto (aún no que lo ha leído). Con sus documentos. */
async function abrirEnPortal(persona, id) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const m = await repo.unoDeConductor(persona.id, id);
  if (!m) return null;
  await repo.visto(m.dest_id).catch(() => null);
  const documentos = await adjuntos.delDueno(DUENO_PDF, m.id).catch(() => []);
  return { ...m, documentos };
}

/**
 * EL PDF EN EL PORTAL: solo a quien se le mandó ese comunicado, y queda la
 * primera vez que lo abrió. → { nombre, mime, buffer } | null
 */
async function documentoEnPortal(persona, id, adjuntoId) {
  if (!/^\d+$/.test(String(id || '')) || !/^\d+$/.test(String(adjuntoId || ''))) return null;
  const m = await repo.unoDeConductor(persona.id, id);
  if (!m) return null;
  const a = await adjuntos.leerDelDueno(DUENO_PDF, m.id, adjuntoId);
  if (!a) return null;
  await repo.pdfAbierto(m.dest_id).catch(() => null);
  avisarCambio();
  return a;
}

/** Quién no lo ha leído aún (para el SMS certificado desde el comunicado). */
async function sinLeer(id) {
  return repo.sinLeerDe(id);
}

/** «Lo he leído»: el acuse, con la IP y el navegador. → el comunicado. */
async function acusar(persona, id, { ip, agente } = {}) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const m = await repo.unoDeConductor(persona.id, id);
  if (!m) return null;
  if (!m.leido) {
    await repo.leido(m.dest_id, { ip: texto(ip, 64), agente: texto(agente, 300) });
    avisarCambio();
  }
  return repo.unoDeConductor(persona.id, id);
}

// ── Registro ───────────────────────────────────────────────────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DUENO_PDF, {
  etiqueta: 'PDF del comunicado',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  // Solo en el borrador: lo que se aprobó es lo que se mandó.
  adjuntar: async (q, id) => {
    if (!await puede(quienDe(q), CLAVE_PREPARAR)) return false;
    const m = await repo.porId(null, id);
    if (m && m.estado !== 'borrador') throw error('Ya no es un borrador: el documento no se puede cambiar', 409);
    return !!m;
  },
});

tablero.registrarTipo(T_APROBAR, { etiqueta: 'Aprobar un comunicado', abrir: 'Abrir el comunicado', cierreManual: false });

tareasProgramadas.registrar({
  clave: 'comunicados.recordar',
  descripcion: 'Cada día hábil a las 09:00: recordatorio por correo a quien no ha leído un comunicado (cada 2 días hábiles, 3 como mucho)',
  desde: '2026-11-27',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '09:00' }),
  hacer: ({ cli, periodo }) => recordar({ cli, hoy: periodo }),
});

let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('comunicados'); }
contadores.registrarFuente('comunicados', {
  async contar(q) {
    const ve = q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(CLAVE_VER)));
    if (!ve) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.lista() : [])).then(f => f.filter(m => m.estado === 'por_aprobar').length) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const n = await cuenta.valor;
    return n ? { 'comunicados.pendientes': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'comunicado' : 'comunicados'} por aprobar` } } : {};
  },
});

module.exports = {
  lista, ficha, personas, crear, editar, pedir, devolver, aprobar, anular, mandarCorreos, recordar,
  delConductor, abrirEnPortal, documentoEnPortal, acusar, sinLeer, tienePdf, puede, correoDe, DUENO_PDF,
  ALCANCES, ESTADOS, CLAVE_VER, CLAVE_PREPARAR, CLAVE_APROBAR,
};
