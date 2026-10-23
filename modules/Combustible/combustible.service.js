// ============================================================
// COMBUSTIBLE · LA PUERTA DEL MÓDULO
// ============================================================
// Los repostajes que llegan por correo: leer el buzón, guardar lo leído, casarlo
// con el coche, con la persona de la tarjeta y con quien llevaba el coche en
// BOLT a esa hora, y dárselo a la pantalla. Desde fuera del módulo se entra por
// aquí, nunca por el repositorio.
//
// EL BUZÓN SE LEE EN SOLO LECTURA. Es datos@telecab.es, el de Camilo en
// Thunderbird: no se marca nada como leído, no se mueve, no se borra
// (services/correo.leerCorreos lo abre con EXAMINE). Su contraseña está CIFRADA
// en la ficha de ese usuario (Mi perfil), igual que la de quien manda correos
// «como» él, y se descifra en memoria con CRED_KEY al entrar. No se escribe en
// ningún sitio, ni en el log.
//
// UNA PASADA NUNCA LANZA. Un correo raro se guarda como «no_leido» con su motivo
// y los demás siguen; uno que la base no acepta se guarda igual, como
// «no_leido» y con el porqué; uno que no se puede bajar se cuenta y se apunta;
// y si no se puede entrar al buzón, la pasada queda escrita con el error —que
// es lo que la pantalla enseña en rojo— y el log lo dice.
//
// AUDITAR CON MAPON va aparte (combustible.auditoria.js, db/213), y se entra
// por aquí: cada repostaje nace con `auditoria_estado = 'pendiente'`, el cron
// lo audita después de leer el buzón (auditarPendientes) y la pantalla lo pinta
// con el color del peor de sus dos criterios (combustible.semaforo.js). Un
// fallo de Mapon no toca la lectura del correo: es otra llamada, después.
//
// PETROPRIX, POR EXCEL (db/215, 23/10/2026). Petroprix no manda un correo por
// repostaje: Camilo baja un Excel de su web y lo sube con «Importar Excel»
// (importarExcel). Cada fila es un repostaje sin correo (`origen = 'excel'`),
// con su clave contra los duplicados, y entra en la misma lista y la misma
// auditoría. No trae quién repostó: lo dicen BOLT y el bot de WhatsApp.
//
// QUIÉN LLEVABA EL COCHE, EN BOLT Y EN EL BOT (atribuir). BOLT como hasta ahora
// (el tramo que contiene la hora, o el último que lo llevó), y el bot: el turno
// abierto en WhatsApp con esa matrícula a esa hora, o el último que se cerró
// antes. Para todos, también los de Ballenoil. En lote: un Excel trae miles.
//
// LO QUE NO ES DEL CORREO (repasos): volver a casar, BOLT pendiente y el bot. Lo
// hace la pasada del buzón y, con el correo apagado, `repasar` desde el cron:
// los del Excel no dependen del correo.

const crypto = require('crypto');
const repo = require('./combustible.repo');
const lector = require('./combustible.lector');
const excel = require('./lector.petroprixExcel');
const casar = require('./combustible.casar');
const G = require('./combustible.gasolinera');
const auditoria = require('./combustible.auditoria');
const semaforo = require('./combustible.semaforo');
const boya = require('./combustible.boya');
const correo = require('../../services/correo');
const configApp = require('../../services/configApp');
const pruebas = require('../../services/modoPruebas');
const { SEDE_FLOTA } = require('../../services/nucleo');

// El buzón donde llegan, y su servidor. Se pueden cambiar sin tocar código con
// `combustible_buzon` y `correo_imap_host` en config_app.
const BUZON = 'datos@telecab.es';
const IMAP = 'imap.dondominio.com';

// Las carpetas que se leen. Spam también: el antispam de DonDominio puede mandar
// ahí un correo con «⛽️» en el asunto, y entonces no se leería nunca. Una
// carpeta que no exista en el servidor se apunta en la pasada y no la para.
const CARPETAS = ['INBOX', 'Spam'];

// Desde cuándo se mira en el buzón. Una semana atrás, o desde la última pasada
// buena si fue antes (el servidor estuvo parado), sin bajar nunca del día en que
// empezaron a llegar: los primeros son del 21/10/2026 y así entra octubre entero.
const DIAS_ATRAS = Number(process.env.COMBUSTIBLE_DIAS_BUZON) || 7;
const PRIMER_DIA = '2026-10-01';

// Más de 12 horas sin nadie con el coche en BOLT es que no lo llevaba nadie, no
// que «lo llevó el último»: no se le cuelga un repostaje a quien lo dejó ayer.
const ULTIMO_HASTA_SEG = 12 * 3600;

// Una pasada que lleva más que esto se da por muerta (una promesa que no volvió
// nunca). El buzón tiene su propio tope de 4 minutos (correo.leerCorreos) y el
// cron salta cada 10: con 8, la siguiente del cron ya puede entrar.
const TOPE_PASADA_MS = 8 * 60 * 1000;

// La lectura automática es el cron de app.js: no arranca en pruebas (como
// ningún cron) ni con COMBUSTIBLE_CORREO=off. La auditoría con Mapon va en el
// mismo cron pero con su propia bandera (COMBUSTIBLE_AUDITORIA=off): los del
// Excel de Petroprix no dependen del correo. La pantalla dice las dos.
const automatica = () => !pruebas.ACTIVO && process.env.COMBUSTIBLE_CORREO !== 'off';
const auditoriaAutomatica = () => !pruebas.ACTIVO && process.env.COMBUSTIBLE_AUDITORIA !== 'off';

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const restarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const diaMadrid = fecha => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(fecha));
// Un texto que va a la base, sin el carácter nulo —PostgreSQL no lo acepta ni
// en TEXT ni en JSONB— y cortado a lo que cabe en su columna.
const limpio = (v, max) => (v == null ? null : String(v).replace(/\u0000/g, '').slice(0, max || undefined));

// ── ENTRAR AL BUZÓN ─────────────────────────────────────────────────────────

/** Qué buzón, en qué servidor y la ficha de su usuario (con la contraseña cifrada). */
async function fichaDelBuzon() {
  const c = await configApp.leerConfig().catch(() => ({}));
  const buzon = String(c.combustible_buzon || '').trim().toLowerCase() || BUZON;
  const host = String(c.correo_imap_host || '').trim() || IMAP;
  const usuarios = require('../Usuarios/usuarios.service');
  return { buzon, host, u: await usuarios.buscarUsuario(buzon), usuarios };
}

// La huella de la contraseña CIFRADA de la ficha, no de la contraseña: dice si
// alguien la ha vuelto a guardar desde la última pasada sin descifrar nada.
const huellaDe = u => (u && u.pass_correo ? crypto.createHash('sha256').update(String(u.pass_correo)).digest('hex').slice(0, 16) : null);
const huellaDelBuzon = async () => huellaDe((await fichaDelBuzon()).u);

const errorDeConfig = msg => Object.assign(new Error(msg), { tipo: 'config' });

/**
 * Con qué se entra. Cada «no» dice qué arreglar: sin esto, lo único que se ve
 * es un «Command failed» de IMAP y nadie sabe si es la contraseña o la llave.
 */
async function credenciales() {
  const { buzon, host, u, usuarios } = await fichaDelBuzon();
  if (!u) throw errorDeConfig(`${buzon} no es la cuenta de nadie en el ERP: su contraseña de correo se guarda en su ficha (Configuración → Mi perfil)`);
  if (!usuarios.tienePassCorreo(u)) throw errorDeConfig(`${buzon} no tiene guardada la contraseña de su correo (Configuración → Mi perfil)`);
  if (!process.env.CRED_KEY) throw errorDeConfig('Falta CRED_KEY en el servidor: sin ella no se puede descifrar la contraseña del buzón');
  const pass = usuarios.descifrarPassCorreo(u);
  if (!pass) throw errorDeConfig(`No se puede descifrar la contraseña de correo de ${buzon}: ¿cambió CRED_KEY? Hay que volver a guardarla en su ficha`);
  return { buzon, host, user: buzon, pass, huella: huellaDe(u) };
}

/**
 * El error de IMAP, dicho para quien lo tiene que arreglar, y de qué tipo es:
 * 'contrasena' (el cron deja de reintentar, ver leerBuzon), 'servidor', 'tope'
 * u 'otro'. imapflow dice ETIMEOUT (no ETIMEDOUT) y, si la conexión cae a
 * medias, NoConnection.
 */
function explicar(e, { buzon, host }) {
  const codigo = (e && e.code) || '';
  const texto = `${codigo} ${(e && e.message) || ''}`;
  if (e && e.authenticationFailed) {
    return { tipo: 'contrasena', msg: `El servidor de correo no acepta la contraseña de ${buzon} (¿se cambió en el buzón y no en su ficha del ERP?)` };
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(texto)) return { tipo: 'servidor', msg: `No se encuentra el servidor ${host}` };
  if (codigo === 'ETOPE') return { tipo: 'tope', msg: `El servidor ${host} no acabó de dar el buzón: ${e.message}` };
  if (/ETIMEDOUT|ETIMEOUT|ECONNREFUSED|ECONNRESET|NoConnection|timeout/i.test(texto)) {
    return { tipo: 'servidor', msg: `El servidor ${host} no contesta (${codigo || e.message})` };
  }
  return { tipo: 'otro', msg: (e && (e.responseText || e.message)) || 'error desconocido' };
}

// ── DE UN CORREO, UNA FILA ──────────────────────────────────────────────────

/**
 * Lo que se guarda de un correo leído: los datos del lector más con qué casa.
 * `candidatos` se carga una vez por pasada (personas que conoce el ERP).
 *
 * LA SEDE. La del coche en Vehículos o, si no está dado de alta, la de la
 * empresa de BOLT que lo tiene. Si nadie conoce el coche, la de la cuenta de
 * BOLT de la persona de la tarjeta: sin eso, un repostaje de Barcelona con un
 * coche aún sin dar de alta salía «sin sede», BOLT se miraba en Madrid y quien
 * entra con la sede de Barcelona no lo veía.
 */
async function casarLeido(r, candidatos) {
  const d = r.datos || {};
  const coche = d.matricula ? await repo.cocheDe(d.matricula) : { vehiculoId: null, sede: null };
  const t = casar.tarjeta(d.conductor_texto);
  const persona = t.nombre ? casar.casarNombre(t.nombre, candidatos, { sede: coche.sede }) : null;
  let sede = coche.sede;
  if (!sede && persona && persona.cuentaBolt) {
    const cuenta = (candidatos || []).find(x => x.cuentaBolt === persona.cuentaBolt && x.sede);
    if (cuenta) sede = cuenta.sede;
  }
  return {
    ...d,
    avisos: r.avisos && r.avisos.length ? r.avisos : null,
    tarjeta_provisional: t.provisional,
    tarjeta_nota: t.nota ? t.nota.slice(0, 200) : null,
    vehiculo_id: coche.vehiculoId,
    sede,
    conductor_id: persona ? persona.conductorId : null,
    conductor_cuenta_bolt: persona ? persona.cuentaBolt : null,
    conductor_como: persona ? persona.como : null,
  };
}

/** El aviso de un correo cuyo remitente no se pudo verificar como el del proveedor. */
const avisoFirma = (proveedor, detalle) => {
  const p = lector.proveedor(proveedor);
  return `El remitente no está verificado (${detalle}): podría no ser de ${p ? p.nombre : proveedor}. No te fíes de este repostaje sin mirarlo`;
};

// «El dato no cabe o no vale» en PostgreSQL: la clase 22 (texto demasiado
// largo, número que desborda, fecha imposible, carácter nulo…) y las
// restricciones NOT NULL y CHECK (23502, 23514).
const errorDeDatos = e => !!e && typeof e.code === 'string' && (/^22/.test(e.code) || e.code === '23502' || e.code === '23514');

/**
 * Guarda un correo y, si la base rechaza lo leído, lo guarda igual como
 * «no_leido» con el porqué y solo lo del correo (sin cifras). Sin esta red, el
 * correo se quedaba sin fila: no entraba en «ya guardados», se volvía a bajar y
 * a fallar en cada pasada y, al salir de la ventana de días, se perdía.
 */
async function guardarConRed(fila, base) {
  try {
    return await repo.guardar(fila);
  } catch (e) {
    if (!errorDeDatos(e)) throw e;
    const motivo = `La base no lo acepta: ${e.message}`;
    return { ...(await repo.guardar({ ...base, estado: 'no_leido', motivo })), motivo };
  }
}

/**
 * Lo que dice BOLT de un repostaje, ya decidido: conectado, el último (hasta
 * 12 h), nadie, el coche no está en BOLT o pendiente (BOLT aún no llega a esa
 * hora). Y si es la persona de la tarjeta. `frescura`: hasta dónde llega BOLT
 * por sede (repo.frescuraBolt).
 */
function filaBolt(b, { sede, conductorId, cuentaBolt, conductorTexto }, frescura) {
  const otraSede = sede && sede !== SEDE_FLOTA;
  const hasta = otraSede ? frescura.otras : frescura.madrid;
  let estado;
  if (!b.enBolt) estado = 'sin_coche';
  else if (!hasta || new Date(hasta) < new Date(b.repostajeAt)) estado = 'pendiente';
  else if (!b.uuid) estado = 'nadie';
  else if (b.conectado) estado = 'conectado';
  else if (b.segundos <= ULTIMO_HASTA_SEG) estado = 'ultimo';
  else estado = 'nadie';

  const conPersona = estado === 'conectado' || estado === 'ultimo';
  const t = casar.tarjeta(conductorTexto);
  const coincide = conPersona && t.nombre
    ? casar.coincide({ conductorId, cuentaBolt, nombre: t.nombre }, { conductorId: b.conductorId, uuid: b.uuid, nombre: b.nombre })
    : null;
  return {
    estado,
    uuid: conPersona ? b.uuid : null,
    conductorId: conPersona ? b.conductorId : null,
    nombre: conPersona ? b.nombre : null,
    situacion: conPersona ? b.situacion : null,
    antiguedadMin: conPersona ? Math.round(b.segundos / 60) : null,
    coincide,
  };
}

/**
 * Lo que dice el bot de WhatsApp de un repostaje: en turno (lo tenía abierto),
 * el último que lo cerró (hasta 12 h antes, como BOLT: no se le cuelga un
 * repostaje a quien dejó el coche ayer) o nadie.
 */
function filaBot(x) {
  if (!x || !x.turnoId) return { estado: 'nadie' };
  const estado = x.dentro ? 'en_turno' : x.segFin <= ULTIMO_HASTA_SEG ? 'ultimo' : 'nadie';
  if (estado === 'nadie') return { estado };
  return { estado, turnoId: x.turnoId, tipo: x.tipo, conductorId: x.conductorId, nombre: x.nombre,
    desde: x.desde, hasta: x.hasta, antiguedadMin: estado === 'ultimo' ? Math.round(x.segFin / 60) : 0 };
}

// Sin db/215 todavía no están las columnas del bot: lo de BOLT sigue igual.
const sinColumna = e => !!e && e.code === '42703';
let avisadoSinBot = false;

/**
 * QUIÉN LLEVABA EL COCHE, en BOLT y en el bot, de muchos repostajes a la vez
 * (un Excel trae miles: una consulta por cada 500, no una por fila). `quienes`:
 * [{ id, sede, conductorId, cuentaBolt, conductorTexto }]. Lo de BOLT y lo del
 * bot se guardan aparte: si falla uno, el otro queda.
 * → { bolt: Map, bot: Map, errorBot }
 *
 * Un fallo de BOLT lanza; uno del bot NO: vuelve en `errorBot`, para que quien
 * llama lo apunte como del bot. Antes salía como «BOLT: …» aunque lo de BOLT sí
 * se hubiera guardado (revisión del 23/10/2026). Los que se quedan sin bot
 * (bot_estado NULL) los vuelve a mirar la pasada siguiente (repo.paraMirarBot).
 */
async function atribuir(quienes, frescura) {
  const bolt = new Map(), bot = new Map();
  let errorBot = null;
  for (let i = 0; i < (quienes || []).length; i += 500) {
    const trozo = quienes.slice(i, i + 500);
    const otra = q => q.sede && q.sede !== SEDE_FLOTA;
    const [bm, bo] = await Promise.all([repo.boltMadridDe(trozo.filter(q => !otra(q)).map(q => q.id)),
      repo.boltOtraSedeDe(trozo.filter(otra).map(q => q.id))]);
    const filas = [];
    for (const q of trozo) {
      const b = bm.get(Number(q.id)) || bo.get(Number(q.id));
      if (!b) continue;
      const f = filaBolt(b, q, frescura);
      bolt.set(Number(q.id), f);
      filas.push({ id: q.id, ...f });
    }
    await repo.ponerBoltDe(filas);
    if (errorBot) continue;
    try {
      const xs = await repo.botDe(trozo.map(q => q.id));
      const fb = trozo.map(q => ({ id: Number(q.id), ...filaBot(xs.get(Number(q.id))) }));
      await repo.ponerBot(fb);
      for (const f of fb) bot.set(f.id, f);
    } catch (e) {
      if (!sinColumna(e)) { errorBot = e.message || String(e); continue; }
      if (!avisadoSinBot) console.warn('⚠️  [Combustible] Falta aplicar db/215: no se mira quién llevaba el coche en el bot hasta entonces');
      avisadoSinBot = true;
    }
  }
  if (errorBot) console.error(`❌ [Combustible] Quién llevaba el coche en el bot: ${errorBot}`);
  return { bolt, bot, errorBot };
}

/**
 * QUIÉN LLEVABA EL COCHE, en una pasada: de uno o de muchos a la vez, cada
 * repostaje una vez por pasada, contado en `c` y con los fallos en `detalle`.
 * Nunca lanza. Los que esperaban a BOLT van todos en una llamada (`atribuir`
 * hace una consulta por cada 500): uno a uno eran cuatro consultas por fila, y
 * con 500 «pendiente» de un Excel, hasta 2.000 cada diez minutos (revisión del
 * 23/10/2026).
 */
function mirador({ c, detalle, frescura }) {
  const mirados = new Set();
  return async function mirar(quienes) {
    const xs = (quienes || []).filter(q => q && !mirados.has(Number(q.id)));
    if (!xs.length) return;
    for (const q of xs) mirados.add(Number(q.id));
    const ids = xs.length === 1 ? { id: xs[0].id } : { repostajes: xs.length };
    try {
      const r = await atribuir(xs, frescura);
      for (const b of r.bolt.values()) if (b.estado !== 'pendiente') c.boltMirados++;
      if (r.errorBot) {
        c.fallos++;
        detalle.fallos.push({ ...ids, error: 'Quién llevaba el coche en el bot: ' + r.errorBot });
      }
    } catch (e) {
      c.fallos++;
      detalle.fallos.push({ ...ids, error: 'BOLT: ' + e.message });
      console.error(`❌ [Combustible] Quién llevaba el coche en BOLT (${xs.length === 1 ? 'repostaje ' + xs[0].id : xs.length + ' repostajes'}): ${e.message}`);
    }
  };
}

// ── LA PASADA ───────────────────────────────────────────────────────────────

// ¿El error es que aún no existen las tablas de db/212?
const faltaMigracion = e => !!e && e.code === '42P01';
const FALTA_DB212 = 'Falta aplicar la migración db/212 (repostajes) desde /migraciones';
let avisadoSinTablas = false;

// UNA CADA VEZ. node-cron no espera a la promesa, y el botón puede pulsarse con
// la del cron dentro: dos pasadas a la vez se bajarían lo mismo y pelearían por
// los mismos índices. La segunda se salta y lo dice. Pero una pasada que no
// vuelve nunca no puede dejar el buzón sin leer para siempre: pasado
// TOPE_PASADA_MS se da por muerta, se cierra su fila con el error y se entra.
// `enCurso` es un objeto por pasada para que la muerta, si un día acaba, ni
// suelte la bandera de la nueva ni le pise su fila.
let enCurso = null;

// La contraseña que el servidor no acepta NO se reintenta cada 10 minutos: 144
// fallos al día desde la IP de Render pueden hacer que DonDominio la bloquee, y
// es la misma IP desde la que el ERP manda los correos de todo @telecab.es. El
// cron espera a que la contraseña de la ficha cambie; el botón lo intenta
// siempre. Se avisa una vez por contraseña, no cada diez minutos.
let avisadaPausa = null;

/**
 * Lee el buzón y guarda lo nuevo. Nunca lanza: devuelve lo que hizo, o el error
 * si no pudo entrar. `origen`: 'cron' o 'manual'; `usuarioId`: quién pulsó.
 */
async function leerBuzon({ origen = 'cron', usuarioId = null } = {}) {
  if (enCurso) {
    const min = Math.round((Date.now() - enCurso.t0) / 60000);
    if (Date.now() - enCurso.t0 < TOPE_PASADA_MS) {
      if (origen === 'cron') console.warn(`⚠️  [Combustible] El cron se salta esta lectura: la anterior sigue (lleva ${min} min)`);
      return { ok: false, saltada: true, error: 'Ya se está leyendo el buzón: espera a que acabe' };
    }
    console.warn(`⚠️  [Combustible] La lectura anterior lleva ${min} min sin acabar: se da por muerta y se vuelve a leer`);
    enCurso.muerta = true;
    if (enCurso.lecturaId) {
      await repo.cerrarLectura(enCurso.lecturaId, { buzon: enCurso.buzon, errorTipo: 'tope',
        error: `No acabó en ${min} minutos y se dio por muerta: la siguiente volvió a leer` }).catch(() => {});
    }
  }
  const yo = { t0: Date.now(), lecturaId: null, buzon: BUZON, muerta: false };
  enCurso = yo;
  try {
    return await pasada({ origen, usuarioId }, yo);
  } finally {
    if (enCurso === yo) enCurso = null;
  }
}

async function pasada({ origen, usuarioId }, yo) {
  const c = { vistos: 0, candidatos: 0, yaEstaban: 0, nuevos: 0, noLeidos: 0, repetidos: 0, releidos: 0,
    recasados: 0, otros: 0, boltMirados: 0, fallos: 0 };
  const detalle = { noLeidos: [], fallos: [], otros: [], carpetas: [] };
  let cred = { buzon: BUZON, host: IMAP };
  // Una pasada dada por muerta no escribe su cierre: ya lo escribió la siguiente.
  const cerrar = extra => (yo.muerta || !yo.lecturaId ? null
    : repo.cerrarLectura(yo.lecturaId, { ...c, buzon: cred.buzon, passHuella: cred.huella || null, ...extra }));
  try {
    const { ultima, ultimaBuena } = await repo.ultimaLectura();

    // La contraseña que no vale, otra vez la misma: el cron no insiste (arriba).
    if (origen === 'cron' && ultima && ultima.error_tipo === 'contrasena' && ultima.pass_huella) {
      const h = await huellaDelBuzon().catch(() => null);
      if (h && h === ultima.pass_huella) {
        if (avisadaPausa !== h) console.warn(`⚠️  [Combustible] ${ultima.buzon || BUZON}: el servidor no acepta su contraseña; el cron no lo vuelve a intentar hasta que se cambie en su ficha (el botón sí)`);
        avisadaPausa = h;
        return { ok: false, saltada: true, pausada: true, error: 'El servidor no acepta la contraseña del buzón: no se reintenta solo hasta que se cambie en su ficha', ...c };
      }
    }

    yo.lecturaId = await repo.empezarLectura({ origen, usuarioId, buzon: BUZON, modoPruebas: pruebas.ACTIVO });
    cred = await credenciales();
    yo.buzon = cred.buzon;
    if (pruebas.ACTIVO) {
      console.log(`🧪 [PRUEBAS] Combustible: se lee el buzón REAL ${cred.buzon} en solo lectura (no se marca, mueve ni borra nada); lo leído se guarda en esta base`);
    }

    // Desde cuándo.
    let desde = restarDias(hoyMadrid(), DIAS_ATRAS);
    if (ultimaBuena && ultimaBuena.empezada_at) {
      const antes = restarDias(diaMadrid(ultimaBuena.empezada_at), 1);
      if (antes < desde) desde = antes;
    } else {
      desde = PRIMER_DIA;   // la primera vez, desde que empezaron a llegar
    }
    if (desde < PRIMER_DIA) desde = PRIMER_DIA;
    c.desde = desde;

    // Lo ya guardado no se vuelve a bajar. Lo del proveedor que no es un
    // repostaje (otro asunto) tampoco, pero se cuenta: si un día cambian el
    // asunto, la pantalla lo dirá.
    const ya = await repo.yaGuardados(desde);
    const elegir = s => {
      if (!lector.deQuien(s)) {
        if (lector.esDelProveedor(s.de)) {
          c.otros++;
          if (detalle.otros.length < 20) detalle.otros.push({ carpeta: s.carpeta, uid: s.uid, de: s.de, asunto: limpio(s.asunto, 200) });
        }
        return false;
      }
      c.candidatos++;
      const id = s.messageId ? s.messageId.slice(0, 400) : null;
      if ((id && ya.ids.has(id)) || (!id && ya.uids.has(repo.claveUid(s.carpeta, s.uidValidity, s.uid)))) {
        c.yaEstaban++;
        return false;
      }
      return true;
    };
    let leido;
    try {
      // A mediodía UTC: IMAP busca por DÍA, y así es el mismo día lo lea el
      // servidor en el huso que lo lea.
      leido = await correo.leerCorreos({ user: cred.user, pass: cred.pass, host: cred.host, carpetas: CARPETAS,
        desde: new Date(desde + 'T12:00:00Z'), elegir, firma: true });
    } catch (e) {
      const x = explicar(e, cred);
      throw Object.assign(new Error(x.msg), { tipo: x.tipo });
    }
    c.vistos = leido.vistos;
    for (const k of leido.carpetas || []) if (k.error) detalle.carpetas.push(k);
    if (leido.error) detalle.conexion = leido.error;

    const frescura = await repo.frescuraBolt();
    let candidatos = null;
    const personas = async () => (candidatos = candidatos || await repo.candidatosNombre());

    // BOLT y el bot, aparte del correo: si falla, el repostaje ya está guardado
    // y se queda sin eso (bolt_estado o bot_estado NULL), que la pasada
    // siguiente vuelve a mirar. Cada repostaje se mira una vez por pasada.
    const mirarLote = mirador({ c, detalle, frescura });
    const mirar = (id, quien) => mirarLote([{ id, ...quien }]);

    for (const m of leido.correos) {
      // No se pudo bajar (se movió mientras se leía, la conexión cayó…): no
      // se guarda nada y la pasada siguiente lo vuelve a intentar.
      if (m.error) {
        c.fallos++;
        detalle.fallos.push({ carpeta: m.carpeta, uid: m.uid, asunto: limpio(m.asunto, 200), error: 'No se pudo bajar: ' + m.error });
        console.error(`❌ [Combustible] No se pudo bajar el correo ${m.carpeta}/${m.uid} («${m.asunto}»): ${m.error}`);
        continue;
      }
      try {
        const r = lector.leerCorreo(m);
        if (!r) { c.candidatos--; continue; }   // un reenvío de la casa que no era de un proveedor
        const firma = lector.firmaDe(r, m.firmas);
        const base = {
          proveedor: r.proveedor, mensaje_id: limpio(m.messageId, 400),
          buzon: cred.buzon, buzon_carpeta: m.carpeta || 'INBOX',
          buzon_uidvalidity: m.uidValidity == null ? leido.uidValidity : m.uidValidity, buzon_uid: m.uid,
          remitente: limpio(r.remitente, 200), reenviado_por: limpio(r.reenviadoPor, 200),
          asunto: limpio(m.asunto, 500),
          recibido_at: m.fecha ? new Date(m.fecha) : new Date(),
          cuerpo_texto: limpio(r.texto) || null,
          // Las partes tal cual llegaron: para releerlo un día con el código de
          // ese día (combustible.lector.releer), no con el texto ya convertido.
          cuerpo_partes: (m.partes || []).length ? m.partes.map(p => ({ tipo: p.tipo, contenido: limpio(p.contenido) })) : null,
          remitente_verificado: firma.verificado, firma_detalle: limpio(firma.detalle, 300),
          lector_version: r.version || 0,
        };
        let fila;
        if (r.ok) {
          fila = { ...base, estado: 'leido', ...(await casarLeido(r, await personas())) };
          if (firma.verificado === false) fila.avisos = [...(fila.avisos || []), avisoFirma(r.proveedor, firma.detalle)];
        } else {
          // No se entiende: se guarda con lo que sí se leyó, para que la ficha
          // enseñe hasta dónde llegó, pero como «no_leido» y con el motivo.
          const d = r.datos || {};
          fila = { ...base, estado: 'no_leido', motivo: r.motivo || 'No se entiende el correo',
            estacion: d.estacion || null, conductor_texto: d.conductor_texto || null, matricula: d.matricula || null };
        }
        const g = await guardarConRed(fila, base);
        if (g.yaEstaba) { c.yaEstaban++; continue; }
        if (g.estado === 'repetido') c.repetidos++;
        else if (g.estado === 'no_leido') {
          const motivo = g.motivo || fila.motivo;
          c.noLeidos++;
          detalle.noLeidos.push({ id: g.id, asunto: base.asunto, motivo });
          console.warn(`⚠️  [Combustible] No se entiende un correo de ${r.proveedor} («${base.asunto}»): ${motivo}`);
        } else {
          c.nuevos++;
          await mirar(g.id, { sede: fila.sede, conductorId: fila.conductor_id,
            cuentaBolt: fila.conductor_cuenta_bolt, conductorTexto: fila.conductor_texto });
        }
      } catch (e) {
        // Un correo que revienta no para a los demás.
        c.fallos++;
        detalle.fallos.push({ carpeta: m.carpeta, uid: m.uid, asunto: limpio(m.asunto, 200), error: e.message });
        console.error(`❌ [Combustible] Correo ${m.carpeta}/${m.uid} («${m.asunto}»): ${e.message}`);
      }
    }

    // Los «no_leido» que el lector de ahora quizá ya entiende.
    for (const x of await repo.paraReleer(lector.versiones())) {
      try {
        const r = lector.releer({ proveedor: x.proveedor, partes: x.cuerpo_partes, texto: x.cuerpo_texto, asunto: x.asunto });
        if (!r) continue;
        if (!r.ok) { await repo.releido(x.id, { estado: 'no_leido', lector_version: r.version, motivo: r.motivo }); continue; }
        const f = { proveedor: x.proveedor, estado: 'leido', lector_version: r.version, ...(await casarLeido(r, await personas())) };
        if (x.remitente_verificado === false) f.avisos = [...(f.avisos || []), avisoFirma(x.proveedor, x.firma_detalle || 'sin firma')];
        let g;
        try {
          g = await repo.releido(x.id, f);
        } catch (e) {
          if (!errorDeDatos(e)) throw e;
          // Lo entiende, pero la base no lo acepta: se apunta con esta versión
          // para no reintentarlo en cada pasada.
          await repo.releido(x.id, { estado: 'no_leido', lector_version: r.version, motivo: `La base no lo acepta: ${e.message}` });
          detalle.noLeidos.push({ id: x.id, asunto: x.asunto, motivo: `La base no lo acepta: ${e.message}` });
          continue;
        }
        c.releidos++;
        if (g.estado === 'leido') {
          await mirar(Number(x.id), { sede: f.sede, conductorId: f.conductor_id, cuentaBolt: f.conductor_cuenta_bolt,
            conductorTexto: f.conductor_texto });
        }
      } catch (e) {
        c.fallos++;
        detalle.fallos.push({ id: x.id, error: e.message });
        console.error(`❌ [Combustible] Al releer el repostaje ${x.id}: ${e.message}`);
      }
    }

    // Lo que no es del correo: volver a casar, BOLT pendiente y el bot.
    await repasos({ c, detalle, personas, mirar, mirarLote });

    const hayDetalle = detalle.noLeidos.length || detalle.fallos.length || detalle.otros.length || detalle.carpetas.length || detalle.conexion;
    await cerrar({ desde, detalle: hayDetalle ? detalle : null });
    await repo.purgarLecturas().catch(() => {});
    const ms = Date.now() - yo.t0;
    if (c.nuevos || c.noLeidos || c.repetidos || c.releidos || c.recasados || c.fallos || origen === 'manual') {
      console.log(`⛽ [Combustible] ${cred.buzon}: ${c.vistos} correo(s) desde el ${desde}, ${c.candidatos} de proveedores · ` +
        `${c.nuevos} nuevo(s), ${c.noLeidos} sin entender, ${c.repetidos} repetido(s), ${c.yaEstaban} ya estaban` +
        `${c.releidos ? `, ${c.releidos} releído(s)` : ''}${c.recasados ? `, ${c.recasados} con coche o sede nuevos` : ''}` +
        `${c.otros ? `, ${c.otros} del proveedor que no son repostajes` : ''}${c.fallos ? `, ${c.fallos} con error` : ''} · ${(ms / 1000).toFixed(1)} s`);
    }
    return { ok: true, ms, ...c };
  } catch (e) {
    // SIN db/212 TODAVÍA (desplegado antes de aplicarla): se dice UNA vez, no
    // cada diez minutos, y no hay dónde apuntar la pasada.
    if (faltaMigracion(e)) {
      if (!avisadoSinTablas) console.warn('⚠️  [Combustible] Falta aplicar db/212 (repostajes): no se lee el buzón hasta entonces');
      avisadoSinTablas = true;
      return { ok: false, error: FALTA_DB212, ...c };
    }
    const msg = e.message || String(e);
    console.error(`❌ [Combustible] No se pudo leer el buzón ${cred.buzon}: ${msg}`);
    await Promise.resolve(cerrar({ error: msg, errorTipo: e.tipo || 'otro' })).catch(() => {});
    return { ok: false, error: msg, ...c };
  }
}

// ── LOS REPASOS: LO QUE NO ES DEL CORREO ────────────────────────────────────

/**
 * Lo que cada pasada vuelve a mirar y no depende del buzón: los leídos que
 * quizá casen mejor hoy, los que esperan a BOLT y los que aún no se miraron en
 * el bot. Lo hace la pasada del buzón, con sus cuentas; y, si el correo está
 * apagado, `repasar` (el cron), porque los del Excel de Petroprix no dependen
 * del correo y también esperan a BOLT. Nunca lanza por un repostaje.
 */
async function repasos({ c, detalle, personas, mirar, mirarLote }) {
  // Los que quizá casen mejor hoy: el coche se dio de alta después, o BOLT
  // no lo tenía. Si cambia algo, se vuelve a mirar BOLT con la sede nueva.
  for (const x of await repo.paraRecasar()) {
    try {
      const n = await casarLeido({ datos: { matricula: x.matricula, conductor_texto: x.conductor_texto } }, await personas());
      const cambia = ['vehiculo_id', 'sede', 'conductor_id', 'conductor_cuenta_bolt', 'conductor_como']
        .some(k => (n[k] == null ? null : String(n[k])) !== (x[k] == null ? null : String(x[k])));
      if (cambia) { await repo.recasado(x.id, n); c.recasados++; }
      if (cambia || x.bolt_estado === 'sin_coche') {
        await mirar(x.id, { sede: n.sede, conductorId: n.conductor_id, cuentaBolt: n.conductor_cuenta_bolt, conductorTexto: x.conductor_texto });
      }
    } catch (e) {
      c.fallos++;
      detalle.fallos.push({ id: x.id, error: 'Al volver a casar: ' + e.message });
      console.error(`❌ [Combustible] Al volver a casar el repostaje ${x.id}: ${e.message}`);
    }
  }

  // Los que esperaron tres días a BOLT y no llegó, cerrados; y los que aún
  // esperan (y los que se quedaron sin mirar por un fallo), otra vez: todos de
  // una vez (mirador).
  await repo.cerrarSinBolt();
  await mirarLote(await repo.paraMirarBolt());

  // Los que aún no se miraron en el bot (los de antes de db/215, o un fallo).
  // El libro de turnos se escribe al momento: no hay que esperar a nada.
  try {
    const sinBot = await repo.paraMirarBot();
    if (sinBot.length) {
      const xs = await repo.botDe(sinBot);
      await repo.ponerBot(sinBot.map(id => ({ id, ...filaBot(xs.get(id)) })));
    }
  } catch (e) {
    if (!sinColumna(e)) {
      c.fallos++;
      detalle.fallos.push({ error: 'Quién llevaba el coche en el bot: ' + e.message });
      console.error(`❌ [Combustible] Quién llevaba el coche en el bot: ${e.message}`);
    }
  }
}

/**
 * LOS REPASOS SIN EL BUZÓN: el cron con el correo apagado
 * (`COMBUSTIBLE_CORREO=off`). Sin esto, apagar el correo dejaba los del Excel
 * de Petroprix esperando a BOLT para siempre (revisión del 23/10/2026). Nunca
 * lanza: devuelve lo que hizo, o el error.
 */
async function repasar() {
  const c = { recasados: 0, boltMirados: 0, fallos: 0 };
  const detalle = { fallos: [] };
  const t0 = Date.now();
  try {
    const frescura = await repo.frescuraBolt();
    let candidatos = null;
    const personas = async () => (candidatos = candidatos || await repo.candidatosNombre());
    const mirarLote = mirador({ c, detalle, frescura });
    await repasos({ c, detalle, personas, mirar: (id, quien) => mirarLote([{ id, ...quien }]), mirarLote });
    if (c.recasados || c.fallos) {
      console.log(`⛽ [Combustible] Repaso sin el buzón: ${c.recasados} con coche o sede nuevos, ${c.boltMirados} mirado(s) en BOLT` +
        `${c.fallos ? `, ${c.fallos} con error` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return { ok: true, ...c, fallosDetalle: detalle.fallos };
  } catch (e) {
    if (faltaMigracion(e)) return { ok: false, error: FALTA_DB212, ...c };
    console.error(`❌ [Combustible] El repaso sin el buzón: ${e.message}`);
    return { ok: false, error: e.message, ...c };
  }
}

// ── LO QUE VE LA PANTALLA ───────────────────────────────────────────────────

// Un día con forma de día y que además existe: «2026-02-31» tiene la forma y
// llegaba a PostgreSQL, que devolvía su error crudo.
const diaValido = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;

/**
 * La última pasada, dicha para la pantalla: cuándo, qué hizo y si falló. Y si
 * la lectura automática está encendida y si el cron está esperando a que se
 * cambie la contraseña (no reintenta una que no vale).
 */
async function estadoLectura() {
  const { ultima, ultimaBuena } = await repo.ultimaLectura();
  const auto = automatica();
  let pausada = false;
  if (auto && ultima && ultima.error_tipo === 'contrasena' && ultima.pass_huella) {
    pausada = (await huellaDelBuzon().catch(() => null)) === ultima.pass_huella;
  }
  return { ultima, ultimaBuena, cadaMin: 10, buzon: ultima ? ultima.buzon : BUZON, automatica: auto, pausada,
    auditoriaAutomatica: auditoriaAutomatica() };
}

/**
 * Los colores de la auditoría, calculados al leer (no se guardan): el del GPS,
 * el de la boya y el de la fila, que es el peor de los dos.
 */
function conColores(f) {
  const gps = semaforo.colorGps(f.gps_distancia_m);
  // LA BOYA SOLO CUENTA LO QUE FALTA (23/10/2026): `boya_error_pct` es el
  // déficit desde db/215, que rehízo los de antes desde lo medido. Se compara
  // con lo pagado, o con la suma si hubo otro repostaje del mismo coche entre
  // las dos lecturas de la boya (`boya_pagados`, combustible.auditoria). Sin déficit guardado
  // es que no se compara (falta la boya, o un mínimo que no llega a lo pagado).
  const deficit = f.boya_error_pct == null ? null : Number(f.boya_error_pct);
  const dif = deficit == null ? null : boya.diferencia(f.boya_litros, f.boya_pagados != null ? f.boya_pagados : f.litros);
  // El aforador topó y no se pudo corregir: lo que subió es un mínimo. Si ya
  // llega a lo pagado es verde; si no, ni se compara (combustible.semaforo).
  const minimo = boya.esMinimo(f);
  const colorBoya = semaforo.colorBoya(deficit, { minimo });
  const quien = casar.boltYBot(f);
  return { ...f, boya_error_pct: deficit, boya_faltan: dif ? dif.faltan : null, boya_de_mas: dif ? dif.deMas : null,
    boya_minimo: minimo, gps_color: gps, boya_color: colorBoya, color: semaforo.peor(gps, colorBoya),
    quien_caso: quien.caso, quien_nombre: quien.nombre };
}

/** Una fila sin las claves que valen null (para la lista: pesa la mitad). */
const sinVacios = f => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined));

// Sin db/213 (o sin db/215) la lista pide columnas y tablas que aún no existen.
const DE_215 = /origen|excel_|metodo_pago|vehiculo_tipo|bot_|importacion|tipo/;
const faltaDb215 = e => !!e && (e.code === '42703' || e.code === '42P01') && DE_215.test(e.message || '');
const faltaDb213 = e => !!e && (e.code === '42703' || (e.code === '42P01' && /gasolinera/.test(e.message || '')));
const FALTA_DB213 = 'Falta aplicar la migración db/213 (auditoría de repostajes con Mapon) desde /migraciones';
const FALTA_DB215 = 'Falta aplicar la migración db/215 (el Excel de Petroprix, el bot y la boya por debajo) desde /migraciones';
const queFalta = e => (faltaDb215(e) ? FALTA_DB215 : faltaDb213(e) ? FALTA_DB213 : null);

/**
 * Los repostajes entre dos días (por defecto, los últimos 30), con la última
 * lectura del buzón: la pantalla la pinta encima de la lista.
 *
 * `filas` son SOLO los leídos, con sus colores. Los repetidos (el mismo
 * repostaje otra vez en otro correo) no salen: se llega a ellos desde la ficha
 * del bueno. Los que no se pudieron leer van aparte, en `noLeidos`, para un
 * aviso encima de la lista con su enlace: no son repostajes que contar.
 */
async function lista({ desde, hasta } = {}) {
  const h = diaValido(hasta) ? hasta : hoyMadrid();
  let d = diaValido(desde) ? desde : restarDias(h, 30);
  if (d > h) d = h;
  try {
    const [todas, lectura, importacion] = await Promise.all([repo.lista({ desde: d, hasta: h }), estadoLectura(),
      repo.ultimaImportacion()]);
    // Sin las columnas vacías: con Petroprix son miles de filas al mes (85 al
    // día) y casi la mitad de sus columnas son de la tarjeta y del correo, que no
    // tiene. 1.886 filas pesaban 3,4 MB, y así 2,0 MB (el servidor no comprime);
    // la pantalla lee igual un null que lo que no viene.
    const filas = todas.filter(f => f.estado === 'leido').map(conColores).map(sinVacios);
    const noLeidos = todas.filter(f => f.estado === 'no_leido')
      .map(f => ({ id: f.id, cuando: f.cuando, proveedor: f.proveedor, motivo: f.motivo, matricula: f.matricula }));
    return { filas, noLeidos, lectura, importacion, umbrales: semaforo.UMBRALES, desde: d, hasta: h,
      ritmo: { porPasada: auditoria.POR_PASADA, cadaMin: 10 } };
  } catch (e) {
    const falta = queFalta(e);
    if (falta) throw new Error(falta);
    if (faltaMigracion(e)) throw new Error(FALTA_DB212);
    throw e;
  }
}

async function ficha(id) {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('Repostaje no válido');
  let f;
  try {
    f = await repo.ficha(id);
  } catch (e) {
    const falta = queFalta(e);
    if (falta) throw new Error(falta);
    throw e;
  }
  if (!f) throw new Error('Ese repostaje no existe');
  return { ...conColores(f), umbrales: semaforo.UMBRALES };
}

const lecturas = limite => repo.lecturas(limite);
const importaciones = limite => repo.importaciones(limite);

// ── EL EXCEL DE PETROPRIX (db/215) ──────────────────────────────────────────

// LO QUE CABE EN UN EXCEL (revisión del 23/10/2026). El de tres semanas son
// 1.866 filas, 85 KB y 632 KB descomprimido. ExcelJS abre el fichero entero en
// memoria y lo recorre sin soltar el hilo, en el mismo proceso que sirve todo el
// ERP, el bot y los crons: sin tope, un fichero con formato hasta la fila
// 1.048.576 (dar formato a columnas enteras y guardar) o un zip que descomprime
// a cientos de MB lo dejaban colgado minutos o sin memoria. 20.000 filas son
// unos siete meses de Petroprix; 25 MB descomprimido, unas 70.000 filas como esas.
const MAX_FILAS_EXCEL = 20000;
const MAX_DESCOMPRIMIDO = 25 * 1024 * 1024;

/**
 * Lo que ocupa descomprimido un .xlsx (que es un zip), por lo que dice su
 * directorio central, SIN descomprimir nada. null si no parece un zip (lo dirá
 * ExcelJS al abrirlo). Un tamaño en ZIP64 (0xFFFFFFFF) cuenta como infinito.
 */
function tamanoDescomprimido(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) return null;
  const n = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16), total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return null;
    const tam = b.readUInt32LE(p + 24);
    total += tam === 0xFFFFFFFF ? Infinity : tam;
    p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return total;
}

const mb = v => `${(v / 1024 / 1024).toFixed(0)} MB`;

/**
 * Las hojas del fichero, con las celdas en texto (lector.petroprixExcel
 * decide qué es cada cosa). Solo las 8 primeras columnas: son las del Excel de
 * Petroprix, y una hoja con más no lo es (lo dice `reconocer`). Solo las filas
 * con algo (`eachRow`): una con formato y sin datos ni se mira.
 */
async function hojasDe(bytes) {
  const tam = tamanoDescomprimido(bytes);
  if (tam != null && tam > MAX_DESCOMPRIMIDO) {
    throw new Error(`Este Excel ocupa ${tam === Infinity ? 'demasiado' : mb(tam)} descomprimido, y como mucho se abren ${mb(MAX_DESCOMPRIMIDO)} ` +
      `(el de tres semanas de Petroprix ocupa menos de 1 MB): bájalo por meses. No se ha importado nada`);
  }
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes); }
  catch (_) { throw new Error('No se pudo abrir el archivo: tiene que ser un Excel (.xlsx)'); }
  return wb.worksheets.map(ws => {
    if (ws.actualRowCount > MAX_FILAS_EXCEL + 1) {
      throw new Error(`La hoja «${ws.name}» tiene ${num(ws.actualRowCount)} filas, y como mucho se importan ${num(MAX_FILAS_EXCEL)} de una vez: ` +
        'bájalo de Petroprix por meses. No se ha importado nada');
    }
    const columnas = Math.max(excel.CABECERA.length, Math.min(ws.columnCount || 0, 20));
    const filas = [];
    ws.eachRow((row, n) => {
      const celdas = [];
      for (let c = 1; c <= columnas; c++) celdas.push(excel.textoCelda(row.getCell(c).value));
      filas.push({ n, celdas });
    });
    return { nombre: ws.name, filas };
  });
}

const num = v => Number(v).toLocaleString('es-ES');

const AVISOS = {
  diesel: 'Diésel en un coche de gasolina',
  pago: 'Pagado sin la app de Petroprix (tarjeta o efectivo)',
  vehiculo: 'Petroprix no dice qué vehículo es («-»)',
  matricula: 'La matrícula no está en Vehículos',
  baja: 'El coche está dado de baja en Vehículos',
  gasolinera: 'La gasolinera no casa con la lista',
  hora: 'La hora pasa dos veces (cambio de hora) o no existe',
  corrida: 'Ya estaba, con la hora corrida (una hora o unos segundos): no se vuelve a meter',
};

/**
 * IMPORTA EL EXCEL DE REPOSTAJES DE PETROPRIX. Lo reconoce por su cabecera
 * exacta (si no es, lo dice y no importa nada); lee cada fila, aparta las que
 * no se entienden con su porqué, y mete las demás que no estaban: la misma fila
 * importada dos veces es la misma clave (lector.petroprixExcel) y no se
 * duplica. A cada una, su coche y su sede, su gasolinera por el texto exacto
 * (db/215) y sus avisos; y quién llevaba el coche en BOLT y en el bot. La
 * auditoría con Mapon la hace sola el cron, al ritmo de auditoria.POR_PASADA.
 *
 * Una fila rara no para las demás: si la base rechaza un trozo, se prueba fila
 * a fila y la que no entra se cuenta como error con lo que dijo la base.
 *
 * → el resumen: filas, nuevas, ya estaban, con error (y cuáles), avisos por
 *   tipo (con las filas), y lo de BOLT y el bot.
 */
async function importarExcel({ base64, nombre } = {}, { usuarioId } = {}) {
  const limpioB64 = String(base64 || '').replace(/^data:[^,]*,/, '');
  if (!limpioB64) throw new Error('No ha llegado ningún archivo');
  const bytes = Buffer.from(limpioB64, 'base64');
  const fichero = String(nombre || '').trim().slice(0, 200) || null;
  const huella = crypto.createHash('sha256').update(bytes).digest('hex');

  const r = excel.reconocer(await hojasDe(bytes));
  if (r.motivo) throw new Error(r.motivo);
  // Lo que sea de después de ahora (un día y un mes cambiados) se aparta.
  const leido = excel.leerFilas(r.filas, { ahora: Date.now() });
  if (!leido.filas.length && !leido.errores.length) throw new Error('El Excel de Petroprix no trae ningún repostaje');

  let antes = null;
  try { antes = await repo.importacionConHuella(huella); }
  catch (e) { const falta = queFalta(e); if (falta) throw new Error(falta); throw e; }
  const impId = await repo.empezarImportacion({ proveedor: excel.PROVEEDOR, fichero, hoja: r.hoja, huella,
    usuarioId, modoPruebas: pruebas.ACTIVO });
  const t0 = Date.now();
  const c = { filas: leido.filas.length + leido.errores.length, nuevas: 0, yaEstaban: 0,
    conError: leido.errores.length, conAviso: 0, repetidasEnFichero: 0 };
  const errores = leido.errores.map(x => ({ fila: x.fila, motivo: x.motivo }));
  const avisos = {};
  const avisar = (tipo, fila) => { (avisos[tipo] = avisos[tipo] || { texto: AVISOS[tipo], filas: [] }).filas.push(fila); };
  const instantes = leido.filas.map(f => f.instante).filter(Number.isFinite);
  const resumenQuien = { conBolt: 0, conBot: 0, mismo: 0, distinto: 0, botCerrado: 0, soloBot: 0, soloBolt: 0, nadie: 0, boltPendiente: 0 };
  const corridas = [];
  const conAvisoFilas = new Set();
  try {
    // La misma fila dos veces en el mismo fichero: una.
    const unicas = new Map();
    for (const f of leido.filas) { if (unicas.has(f.clave)) c.repetidasEnFichero++; else unicas.set(f.clave, f); }
    c.yaEstaban += c.repetidasEnFichero;
    const [coches, gas, ya] = await Promise.all([
      repo.cochesDe([...unicas.values()].map(f => f.matricula)),
      auditoria.cargarGasolineras(),
      repo.clavesYaGuardadas(excel.PROVEEDOR, [...unicas.keys()]),
    ]);
    const nuevas = [];
    for (const f of unicas.values()) {
      const coche = coches.get(f.matricula) || {};
      const e = G.elegir(f.gasolinera, { proveedor: excel.PROVEEDOR, sede: coche.sede, gasolineras: gas.lista,
        alias: gas.alias, textos: gas.textos });
      const fijos = excel.avisosFijos(f, coche.vehiculoId ? coche : null);
      // Los avisos, de todas las filas del fichero (también las que ya estaban):
      // es lo que dice este Excel. Se guardan con el repostaje los que no
      // cambian; los demás los dice la pantalla mientras sigan así.
      let conAviso = fijos.length > 0 || f.avisos.length > 0;
      for (const a of fijos) avisar(a.tipo, f.fila);
      if (f.avisos.length) avisar('hora', f.fila);
      if (!coche.vehiculoId) { avisar('matricula', f.fila); conAviso = true; }
      else if (coche.deBaja) { avisar('baja', f.fila); conAviso = true; }
      if (!e.gasolineraId) { avisar('gasolinera', f.fila); conAviso = true; }
      if (conAviso) conAvisoFilas.add(f.fila);
      if (ya.has(f.clave)) { c.yaEstaban++; continue; }
      nuevas.push({
        proveedor: excel.PROVEEDOR, importacion_id: impId, excel_fila: f.fila, excel_clave: f.clave,
        excel_crudo: { celdas: f.celdas, horaRepetida: f.horaRepetida },
        avisos: [...f.avisos, ...fijos.map(a => a.texto)].length ? [...f.avisos, ...fijos.map(a => a.texto)] : null,
        estacion: G.textoExacto(f.gasolinera).slice(0, 160), matricula: f.matricula,
        repostaje_at: new Date(f.instante).toISOString(), importe: f.importe, litros: f.litros,
        carburante: f.combustible, metodo_pago: f.pago, vehiculo_tipo: f.vehiculo,
        vehiculo_id: coche.vehiculoId || null, sede: coche.sede || null,
        gasolinera_id: e.gasolineraId || null, gasolinera_como: e.como,
        gasolinera_candidatas: e.candidatas && e.candidatas.length ? e.candidatas : null,
      });
    }

    // LA MISMA FILA CON LA HORA CORRIDA (una hora, o unos segundos): ya
    // estaba, aunque su clave sea otra (repo.casiIgualesDelExcel). No se mete
    // otra vez, y se dice: si pasa, es que Petroprix exporta las horas de otra
    // forma, y conviene saberlo.
    if (nuevas.length) {
      const casi = await repo.casiIgualesDelExcel(excel.PROVEEDOR, nuevas.map(x => ({ clave: x.excel_clave, matricula: x.matricula,
        litros: x.litros, importe: x.importe, instante: x.repostaje_at })));
      for (let i = nuevas.length - 1; i >= 0; i--) {
        const m = casi.get(nuevas[i].excel_clave);
        if (!m) continue;
        avisar('corrida', nuevas[i].excel_fila);
        conAvisoFilas.add(nuevas[i].excel_fila);
        corridas.push({ fila: nuevas[i].excel_fila, id: m.id, segundos: m.segundos, guardada: m.guardada });
        c.yaEstaban++;
        nuevas.splice(i, 1);
      }
    }

    c.conAviso = conAvisoFilas.size;

    // A la base, por trozos de 500. Si la base no acepta un trozo (un valor
    // que no cabe), fila a fila: la que no entra es un error, las demás entran.
    const entraron = [];
    for (let i = 0; i < nuevas.length; i += 500) {
      const trozo = nuevas.slice(i, i + 500);
      try {
        entraron.push(...await repo.guardarDelExcel(trozo));
      } catch (e) {
        if (!errorDeDatos(e)) throw e;
        for (const x of trozo) {
          try { entraron.push(...await repo.guardarDelExcel([x])); }
          catch (e2) {
            if (!errorDeDatos(e2)) throw e2;
            errores.push({ fila: x.excel_fila, motivo: `La base no la acepta: ${e2.message}` });
            c.conError++;
          }
        }
      }
    }
    c.nuevas = entraron.length;
    // Las que no entraron sin error: otra importación a la vez las metió antes.
    c.yaEstaban += nuevas.length - entraron.length - (c.conError - leido.errores.length);

    // Quién llevaba el coche, en BOLT y en el bot: de las nuevas.
    const porClave = new Map(nuevas.map(x => [x.excel_clave, x]));
    const quienes = entraron.map(x => ({ id: x.id, sede: (porClave.get(x.clave) || {}).sede || null }));
    const frescura = await repo.frescuraBolt();
    const q = await atribuir(quienes, frescura);
    if (q.errorBot) resumenQuien.errorBot = q.errorBot;
    for (const { id, sede } of quienes) {
      const b = q.bolt.get(id), bo = q.bot.get(id);
      if (b && b.estado === 'pendiente') resumenQuien.boltPendiente++;
      const caso = casar.boltYBot({ sede,
        bolt_estado: b && b.estado, bolt_conductor_id: b && b.conductorId, bolt_conductor_uuid: b && b.uuid, bolt_nombre: b && b.nombre,
        bot_estado: bo && bo.estado, bot_conductor_id: bo && bo.conductorId, bot_nombre: bo && bo.nombre,
      }).caso;
      if (b && (b.estado === 'conectado' || b.estado === 'ultimo')) resumenQuien.conBolt++;
      if (bo && (bo.estado === 'en_turno' || bo.estado === 'ultimo')) resumenQuien.conBot++;
      const k = { mismo: 'mismo', distinto: 'distinto', sin_comparar: 'distinto', bot_cerrado: 'botCerrado', solo_bot: 'soloBot',
        solo_bolt: 'soloBolt', nadie: 'nadie' }[caso];
      if (k) resumenQuien[k]++;
    }
  } catch (e) {
    await repo.cerrarImportacion(impId, { ...c, error: e.message, detalle: { errores: errores.slice(0, 300), avisos } }).catch(() => {});
    const falta = queFalta(e);
    throw new Error(falta || `La importación se quedó a medias: ${e.message}. Lo que entró, entró; vuelve a importar el mismo Excel y entrará el resto (lo que ya estaba no se duplica)`);
  }
  const detalle = { errores: errores.slice(0, 300), avisos, quien: resumenQuien, repetidasEnFichero: c.repetidasEnFichero,
    corridas: corridas.slice(0, 300) };
  // Con reduce y no con Math.min(...): con más de unas 120.000 filas, el
  // «...» revienta la pila DESPUÉS de haber metido las filas, y la importación
  // se quedaba sin cerrar (revisión del 23/10/2026).
  const desde = instantes.length ? instantes.reduce((a, b) => (b < a ? b : a)) : null;
  const hasta = instantes.length ? instantes.reduce((a, b) => (b > a ? b : a)) : null;
  await repo.cerrarImportacion(impId, { ...c, desde, hasta, detalle });
  const ms = Date.now() - t0;
  console.log(`⛽ [Combustible] Excel de Petroprix «${fichero || r.hoja}»: ${c.filas} fila(s), ${c.nuevas} nueva(s), ` +
    `${c.yaEstaban} ya estaban, ${c.conError} con error, ${c.conAviso} con aviso · ${(ms / 1000).toFixed(1)} s`);
  const fmt = ms2 => (ms2 == null ? null : new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms2)));
  return {
    importacionId: impId, fichero, hoja: r.hoja, ...c, errores, avisos, quien: resumenQuien, corridas,
    desde: fmt(desde), hasta: fmt(hasta), yaImportado: antes ? { cuando: antes.empezada_local, usuario: antes.usuario } : null,
    ritmo: { porPasada: auditoria.POR_PASADA, cadaMin: 10 }, ms,
  };
}

const idValido = id => {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('Repostaje no válido');
  return Number(id);
};

/** Audita uno con Mapon ahora mismo (el botón de su ficha). */
const auditarUno = id => auditoria.auditarUno(idValido(id));

/**
 * Casa a mano la estación de un repostaje con una gasolinera de la lista (vale
 * para todos los correos con ese nombre); `gasolineraId` null lo quita.
 */
async function corregirGasolinera(id, gasolineraId, usuarioId) {
  const g = gasolineraId == null || gasolineraId === '' ? null : Number(gasolineraId);
  if (g != null && !Number.isInteger(g)) throw new Error('Gasolinera no válida');
  return auditoria.corregirGasolinera(idValido(id), g, usuarioId);
}

module.exports = {
  leerBuzon, repasar, lista, ficha, estadoLectura, lecturas, importaciones, importarExcel,
  // La auditoría con Mapon (combustible.auditoria): el cron, el botón y la gasolinera a mano.
  auditarPendientes: auditoria.auditarPendientes, auditarUno, corregirGasolinera,
  gasolineras: auditoria.gasolinerasPara,
  // Tras «Leer el buzón ahora»: lo nuevo ya sale con su gasolinera (solo base, sin Mapon). Nunca lanza.
  casarGasolineras: () => auditoria.casarGasolineras().catch(e => {
    if (!faltaDb213(e)) console.error(`❌ [Combustible] Casar las gasolineras: ${e.message}`);
    return 0;
  }),
};
