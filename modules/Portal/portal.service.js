// ============================================================
// PORTAL DE CONDUCTORES — servicio (conductorestelecab.es, 19/10/2026)
// ============================================================
// Lo que ve cada conductor de sí mismo, desde su móvil. Camilo: «la idea es que
// todavía no vean sus horas, solo turnos y la puntuación que llevan semana tras
// semana» y «el login es con su DNI y el sistema le enviará un código de
// verificación al email que fue dado de alta».
//
// EL ACCESO, SIN CONTRASEÑAS:
//   1. Escribe su DNI (o NIE). Si es de alguien con contrato y con email en su
//      ficha, se le manda un código de 6 cifras a ese email.
//   2. Escribe el código: 10 minutos, 5 intentos, un solo uso. Pedir otro anula
//      el anterior.
//   3. Queda dentro 30 días desde la última vez que entra. La sesión vive en la
//      base (db/211): al darle de baja deja de valer sola.
//
// LO QUE NO SE DICE: si un DNI está o no en la casa. A quien no se encuentra,
// a quien no tiene email y a quien no tiene contrato se le contesta lo mismo
// («habla con RRHH»), para que el formulario no sirva para averiguar quién
// trabaja aquí. Y se limita cuánto se puede pedir, por persona y por IP.

const crypto = require('crypto');
const repo = require('./portal.repo');
const correo = require('../../services/correo');
const cobertura = require('../Planificacion/cobertura.service');
const puntuacion = require('../../services/repo/puntuacionSemanal');
const nominas = require('../Nominas/nominas.service');
const recaudacion = require('../Administracion/recaudacion.service');
const { nombrePropio } = require('./formato');

const CODIGO_MINUTOS = 10;
const CODIGO_INTENTOS = 5;
const SESION_DIAS = 30;
// Cuántos códigos se pueden pedir en VENTANA minutos: por persona y por IP.
const VENTANA = 15, MAX_PERSONA = 3, MAX_IP = 10;
// Y cuántas búsquedas de DNI por IP y hora (las de DNIs que no existen no
// dejan código, así que se cuentan aquí, en memoria).
const MAX_BUSQUEDAS_HORA = 30;

// La llave de las huellas de los códigos. Sin PORTAL_SECRETO, la de las
// sesiones del ERP; sin ninguna, una de este arranque (un reinicio deja sin
// valor los códigos a medio usar, nada más).
const LLAVE = process.env.PORTAL_SECRETO || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const huellaCodigo = (conductorId, codigo) =>
  crypto.createHmac('sha256', LLAVE).update(`${conductorId}:${codigo}`).digest('hex');
const huellaTestigo = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const iguales = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** «12.345.678-z» → «12345678Z». Vale para DNI, NIE y pasaporte. */
const normalizarDni = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const pareceDni = s => /^[0-9A-Z]{5,20}$/.test(s);
const pareceEmail = s => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(String(s || '').trim());

/** «camilo.bedoya@gmail.com» → «ca•••@gmail.com»: lo justo para que sepa a qué buzón mirar. */
function ocultarEmail(email) {
  const [u, d] = String(email || '').trim().split('@');
  if (!d) return '';
  return `${u.slice(0, Math.min(2, Math.max(1, u.length - 1)))}•••@${d}`;
}

/** «JUAN CARLOS» → «Juan»: el nombre de pila del saludo. */
function pilaDe(nombre) {
  const p = String(nombre || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

// ── Cuántas búsquedas por IP (en memoria: un solo proceso) ───────────────────
const _busquedas = new Map();   // ip -> [ms, ...]
function busquedaPermitida(ip) {
  const ahora = Date.now(), hora = 3600 * 1000;
  const lista = (_busquedas.get(ip) || []).filter(t => ahora - t < hora);
  if (lista.length >= MAX_BUSQUEDAS_HORA) { _busquedas.set(ip, lista); return false; }
  lista.push(ahora);
  _busquedas.set(ip, lista);
  if (_busquedas.size > 5000) _busquedas.clear();   // que no crezca sin fin
  return true;
}

// ── El correo con el código ──────────────────────────────────────────────────
function correoDelCodigo(pila, codigo) {
  const saludo = pila ? `Hola, ${pila}:` : 'Hola:';
  const text = [
    saludo, '',
    `Tu código para entrar en el portal de conductores de Telecab es: ${codigo}`, '',
    `Caduca en ${CODIGO_MINUTOS} minutos y solo sirve una vez.`,
    'Si no lo has pedido tú, no hagas nada: sin el código nadie puede entrar.', '',
    'Telecab',
  ].join('\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #dee2e7;border-radius:12px;font-family:'IBM Plex Sans',Segoe UI,Helvetica,Arial,sans-serif;color:#181c22;">
<tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:600;letter-spacing:-.01em;">Tele<span style="color:#966a00;">cab</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.5;">${saludo}<br>este es tu código para entrar en el portal de conductores.</td></tr>
<tr><td style="padding:20px 28px;">
<div style="font-size:34px;font-weight:600;letter-spacing:.32em;text-align:center;padding:16px 0 16px .32em;border:1px solid #dee2e7;border-radius:10px;background:#f4f5f7;font-variant-numeric:tabular-nums;">${codigo}</div>
</td></tr>
<tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.55;color:#626a76;">Caduca en ${CODIGO_MINUTOS} minutos y solo sirve una vez. Si no lo has pedido tú, no hagas nada: sin el código nadie puede entrar.</td></tr>
</table>
</td></tr></table></body></html>`;
  return { subject: `Tu código de Telecab: ${codigo}`, text, html };
}

// ── El acceso ────────────────────────────────────────────────────────────────

/**
 * PASO 1: el DNI. Devuelve { ok: true, email } (oculto) si se mandó el código,
 * o { ok: false, motivo } con 'dni' (no parece un documento), 'no-podemos'
 * (no está, sin contrato o sin email: se contesta lo mismo), 'espera'
 * (demasiados intentos) o 'correo' (el correo no salió).
 */
async function pedirCodigo({ dni, ip }) {
  const doc = normalizarDni(dni);
  if (!pareceDni(doc)) return { ok: false, motivo: 'dni' };
  if (!busquedaPermitida(ip || '')) return { ok: false, motivo: 'espera' };

  const p = await repo.porDni(doc);
  if (!p || !pareceEmail(p.email)) return { ok: false, motivo: 'no-podemos' };

  const n = await repo.codigosRecientes({ conductorId: p.id, ip, minutos: VENTANA });
  if (n.persona >= MAX_PERSONA || n.ip >= MAX_IP) return { ok: false, motivo: 'espera' };

  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const id = await repo.nuevoCodigo({
    conductorId: p.id, huella: huellaCodigo(p.id, codigo), email: p.email, minutos: CODIGO_MINUTOS, ip,
  });
  const envio = await correo.enviarCorreo({ to: p.email, ...correoDelCodigo(pilaDe(p.nombre), codigo) });
  if (!envio.enviado) {
    console.error(`❌ [Portal] el código de la ficha ${p.id} no salió: ${envio.motivo}`);
    return { ok: false, motivo: 'correo' };
  }
  await repo.marcarEnviado(id);
  console.log(`🔑 [Portal] código mandado a la ficha ${p.id} (${ocultarEmail(p.email)})`);
  return { ok: true, email: ocultarEmail(p.email) };
}

/**
 * PASO 2: el código. Devuelve { ok: true, testigo } —lo que va en la cookie— o
 * { ok: false, motivo: 'codigo', quedan } / 'caducado' / 'agotado'.
 */
async function entrar({ dni, codigo, ip, agente }) {
  const doc = normalizarDni(dni);
  const cod = String(codigo || '').replace(/\D/g, '');
  const p = pareceDni(doc) ? await repo.porDni(doc) : null;
  const vivo = p ? await repo.codigoVivo(p.id) : null;
  if (!vivo) return { ok: false, motivo: 'caducado' };

  const acierta = cod.length === 6 && iguales(huellaCodigo(p.id, cod), vivo.huella);
  const r = await repo.intentar(vivo.id, acierta, CODIGO_INTENTOS);
  if (!r) return { ok: false, motivo: 'caducado' };
  if (!acierta || !r.usado) {
    return r.anulado ? { ok: false, motivo: 'agotado' } : { ok: false, motivo: 'codigo', quedan: CODIGO_INTENTOS - r.intentos };
  }

  const testigo = crypto.randomBytes(32).toString('base64url');
  await repo.nuevaSesion({ conductorId: p.id, huella: huellaTestigo(testigo), dias: SESION_DIAS, ip, agente });
  console.log(`🔓 [Portal] entra la ficha ${p.id}`);
  return { ok: true, testigo };
}

/** La persona de una cookie, o null. Alarga la sesión una vez al día. */
async function quienEs(testigo) {
  if (!testigo || String(testigo).length < 20) return null;
  const s = await repo.sesion(huellaTestigo(testigo));
  if (!s) return null;
  if (s.renovar) await repo.renovar(s.sesion_id, SESION_DIAS).catch(() => {});
  return { id: s.id, nombre: nombrePropio(s.nombre_completo), pila: pilaDe(s.nombre) };
}

async function salir(testigo) {
  if (testigo) await repo.cerrar(huellaTestigo(testigo));
}

// ── Lo que ve ────────────────────────────────────────────────────────────────

/** Sus turnos de hoy a 7 días (lo mismo que «Ver mis turnos» en WhatsApp). */
async function turnos(persona) {
  const t = await cobertura.proximosDe(persona.id);
  return {
    desde: t.desde, hasta: t.hasta, evento: t.evento,
    dias: t.entrada ? t.entrada.dias.map(d => ({
      fecha: d.fecha, hoy: !!d.hoy, trabaja: !!d.trabaja, sinPlan: !!d.sinPlan,
      turno: d.turno || '', matricula: d.matricula || '',
      recibeDe: d.recibeDe ? { nombre: nombrePropio(d.recibeDe.nombre), telefono: d.recibeDe.telefono || '', fecha: d.recibeDe.fecha, directo: !!d.recibeDe.directo } : null,
      entregaA: d.entregaA ? { nombre: nombrePropio(d.entregaA.nombre), telefono: d.entregaA.telefono || '', fecha: d.entregaA.fecha, directo: !!d.entregaA.directo } : null,
    })) : [],
  };
}

/** Sus semanas, de la más reciente a la más antigua, y cómo se calcula la nota. */
async function semanas(persona) {
  const M = puntuacion.MODELO;
  return {
    semanas: await puntuacion.semanasDe(persona.id),
    modelo: {
      pesos: { horas: Math.round(M.pesos.horas * 100), utilizacion: Math.round(M.pesos.utilizacion * 100), velocidad: Math.round(M.pesos.velocidad * 100) },
      bandas: M.bandas.filter(b => Number.isFinite(b.desde)).map(b => ({ letra: b.letra, desde: b.desde })),
      minDias: M.minDiasTrabajados,
    },
  };
}

// ── El dinero del mes ───────────────────────────────────────────────────────
//
// LA FACTURACIÓN, CON SU OBJETIVO (19/10/2026). Camilo: «una barra de progreso
// de la facturación que lleva, dependiendo si es 32 o 40 horas … si tiene que
// llegar a 4750 o 3750 euros», y luego: «los de la ETT exclúyeles esta función
// ya que ellos no tienen tal cosa. Las propinas y peajes ponlas también, pero
// recuerda que es a mes vencido esto de los extras. Las propinas y peajes sí
// deben de poder verlos los de la ETT».
//
//   · El objetivo es el UMBRAL DEL MBO FAS de su jornada, el mismo número que
//     usa la nómina (nominas.umbralFASDe): 40 h → 4.750, 32 h → 3.750, y las
//     demás jornadas, el de 40 h, como en la nómina. Se cambia en /nominas.
//   · El dinero es el de la nómina: facturación neta, propinas y peajes por DÍA
//     NATURAL (nominas.dineroDe), del día 1 a hoy.
//   · LA ETT NO VE LA BARRA: el MBO es solo de plantilla propia. Sí ve sus
//     propinas y peajes.
//   · A MES VENCIDO: lo de este mes va en la nómina del mes que viene, y se
//     dice. Por eso se enseña también el mes pasado, que es lo que entra en la
//     nómina de este mes.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dos = n => String(n).padStart(2, '0');

async function dinero(persona, hoy = hoyMadrid()) {
  const [y, m] = hoy.split('-').map(Number);
  const ant = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const finAnt = new Date(Date.UTC(ant.y, ant.m, 0)).getUTCDate();
  const [c, actual, anterior] = await Promise.all([
    repo.contrato(persona.id),
    nominas.dineroDe(persona.id, `${y}-${dos(m)}-01`, hoy),
    nominas.dineroDe(persona.id, `${ant.y}-${dos(ant.m)}-01`, `${ant.y}-${dos(ant.m)}-${dos(finAnt)}`),
  ]);
  const ett = !c || c.tipo === 'ett';
  const algo = d => d.neto > 0 || d.propinas > 0 || d.peajes > 0;
  return {
    ett, hoy,
    objetivo: ett ? null : await nominas.umbralFASDe(c.jornada),
    mes: { nombre: MESES[m - 1], cobro: MESES[m % 12], ...actual },
    anterior: algo(anterior) ? { nombre: MESES[ant.m - 1], cobro: MESES[m - 1], ...anterior } : null,
  };
}

/**
 * SU EFECTIVO: lo que ha cobrado en efectivo en BOLT y lo que ha entregado,
 * quincena a quincena desde junio, de la ficha de Recaudación
 * (recaudacion.extractoDe). Quien no tiene ficha allí, sin nada.
 */
async function efectivo(persona) {
  try { return await recaudacion.extractoDe(persona.id); }
  catch (e) {
    if (/no existe/.test(e.message)) return { pendiente: 0, saldoInicial: 0, cobrado: 0, entregado: 0, dado: 0, quincenas: [] };
    throw e;
  }
}

/** La portada: el próximo turno, el dinero del mes, el efectivo y la última nota. */
async function inicio(persona) {
  // Si el dinero o el efectivo no se pueden leer, la portada sale igual, sin esa tarjeta.
  const fallo = que => e => { console.error(`❌ [Portal] ${que}:`, e.message); return null; };
  const [t, s, d, ef] = await Promise.all([
    turnos(persona), puntuacion.semanasDe(persona.id),
    dinero(persona).catch(fallo('dinero')),
    efectivo(persona).catch(fallo('efectivo')),
  ]);
  return {
    hoy: t.desde, hasta: t.hasta, dinero: d, efectivo: ef,
    proximo: t.dias.find(d => d.trabaja) || null,
    hayPlan: t.dias.some(d => !d.sinPlan),
    evento: t.evento,
    ultima: s[0] || null,
    anterior: s[1] || null,
  };
}

module.exports = {
  pedirCodigo, entrar, quienEs, salir, inicio, turnos, semanas, dinero, efectivo,
  SESION_DIAS,
  // Para el comprobador.
  _normalizarDni: normalizarDni, _ocultarEmail: ocultarEmail, _pilaDe: pilaDe, _correoDelCodigo: correoDelCodigo,
};
