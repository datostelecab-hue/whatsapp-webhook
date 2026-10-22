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
// AUDITAR CON MAPON NO ES DE AQUÍ TODAVÍA: cada repostaje nace con
// `auditoria_estado = 'pendiente'` y todo lo que la auditoría necesitará (coche,
// hora, km tecleados, quién lo llevaba, si el remitente está verificado) ya
// queda guardado.

const crypto = require('crypto');
const repo = require('./combustible.repo');
const lector = require('./combustible.lector');
const casar = require('./combustible.casar');
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
// ningún cron) ni con COMBUSTIBLE_CORREO=off. La pantalla lo dice.
const automatica = () => !pruebas.ACTIVO && process.env.COMBUSTIBLE_CORREO !== 'off';

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
 * Quién llevaba el coche en BOLT a la hora del repostaje, y si es el de la
 * tarjeta. `frescura`: hasta dónde llega BOLT por sede (repo.frescuraBolt).
 */
async function mirarBolt(id, { sede, conductorId, cuentaBolt, conductorTexto }, frescura) {
  const otraSede = sede && sede !== SEDE_FLOTA;
  const b = otraSede ? await repo.boltOtraSede(id) : await repo.boltMadrid(id);
  if (!b) return null;
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
  const fila = {
    estado,
    uuid: conPersona ? b.uuid : null,
    conductorId: conPersona ? b.conductorId : null,
    nombre: conPersona ? b.nombre : null,
    situacion: conPersona ? b.situacion : null,
    antiguedadMin: conPersona ? Math.round(b.segundos / 60) : null,
    coincide,
  };
  await repo.ponerBolt(id, fila);
  return fila;
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

    // BOLT, aparte del correo: si falla, el repostaje ya está guardado y se
    // queda sin lo de BOLT (bolt_estado NULL), que la pasada siguiente vuelve a
    // mirar. Cada repostaje se mira una vez por pasada.
    const mirados = new Set();
    const mirar = async (id, quien) => {
      if (mirados.has(id)) return;
      mirados.add(id);
      try {
        const b = await mirarBolt(id, quien, frescura);
        if (b && b.estado !== 'pendiente') c.boltMirados++;
      } catch (e) {
        c.fallos++;
        detalle.fallos.push({ id, error: 'BOLT: ' + e.message });
        console.error(`❌ [Combustible] Quién llevaba el coche del repostaje ${id} en BOLT: ${e.message}`);
      }
    };

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
    // esperan (y los que se quedaron sin mirar por un fallo), otra vez.
    await repo.cerrarSinBolt();
    for (const x of await repo.paraMirarBolt()) await mirar(x.id, x);

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
  return { ultima, ultimaBuena, cadaMin: 10, buzon: ultima ? ultima.buzon : BUZON, automatica: auto, pausada };
}

/**
 * Los repostajes entre dos días (por defecto, los últimos 30), con la última
 * lectura del buzón: la pantalla la pinta encima de la lista.
 */
async function lista({ desde, hasta } = {}) {
  const h = diaValido(hasta) ? hasta : hoyMadrid();
  let d = diaValido(desde) ? desde : restarDias(h, 30);
  if (d > h) d = h;
  try {
    const [filas, lectura] = await Promise.all([repo.lista({ desde: d, hasta: h }), estadoLectura()]);
    return { filas, lectura, desde: d, hasta: h };
  } catch (e) {
    if (faltaMigracion(e)) throw new Error(FALTA_DB212);
    throw e;
  }
}

async function ficha(id) {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('Repostaje no válido');
  const f = await repo.ficha(id);
  if (!f) throw new Error('Ese repostaje no existe');
  return f;
}

const lecturas = limite => repo.lecturas(limite);

module.exports = { leerBuzon, lista, ficha, estadoLectura, lecturas };
