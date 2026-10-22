// ============================================================
// CORREO — envío de avisos y correos de proceso (nodemailer), y
//          leer un buzón en solo lectura (imapflow, `leerCorreos`)
// ============================================================
// Las credenciales de envío salen, por orden:
//   1) De la app: Configuración → "Correo para procesos" (hoja CONFIG; la
//      contraseña va CIFRADA con CRED_KEY).
//   2) De variables de entorno (SMTP_HOST / SMTP_USER / SMTP_PASS …).
// Si no hay ninguna, no envía: solo registra en el log (útil en el arranque, para
// no perder la contraseña provisional del primer superadmin).
//
// Para telecab.es (DonDominio): host smtp.dondominio.com, puerto 587 (STARTTLS).

const configApp = require('./configApp');
const { descifrar } = require('./cripto');

const CORREO_TRAFICO = process.env.CORREO_TRAFICO || 'traficotelecab@gmail.com';

// ── EN PRUEBAS, NINGÚN CORREO SALE (19/10/2026) ─────────────────────────────
// El cortafuegos de modoPruebas frenaba WhatsApp, Mapon y las hojas, pero no el
// correo: un servidor de ensayo con la configuración de producción podía mandar
// por DonDominio a gente de verdad. Con MODO_PRUEBAS=1, todo correo —el de
// procesos y el que va «como» un usuario— va al buzón falso de CORREO_PRUEBAS
// (Mailpit en el entorno local, ver scripts/entorno-local), y solo si ese buzón
// está en este mismo PC. Sin CORREO_PRUEBAS se frena y se apunta, como lo demás.
//
// O A UN BUZÓN DE VERDAD, PERO SIEMPRE EL MISMO (19/10/2026). Camilo: «que en
// entorno de pruebas siempre llegue a datostelecab@gmail.com». Con
// CORREO_PRUEBAS_A (UNA dirección) y un SMTP de verdad en SMTP_HOST/USER/PASS,
// el correo sale de verdad pero TODO va a esa dirección, sea para quien sea:
// el destinatario original no recibe nada, y se dice en el asunto y arriba del
// texto a quién habría ido. Esto manda sobre el buzón falso.
//
// LA CONTRASEÑA, SIN ESCRIBIRLA EN NINGÚN SITIO. Camilo: «usa la contraseña que
// puse en la base de datos que está bien cifrada». Sin SMTP_PASS, se usa la
// contraseña de correo que SMTP_USER tiene guardada en su ficha (Mi perfil,
// cifrada con CRED_KEY), descifrada en memoria al enviar, como hace
// `enviarComoUsuario`. Si no se puede descifrar, al buzón falso.
const pruebas = require('./modoPruebas');

function buzonDePruebas() {
  const m = /^(127\.0\.0\.1|localhost):(\d{2,5})$/.exec(String(process.env.CORREO_PRUEBAS || '').trim());
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

/** La dirección a la que se desvía todo en pruebas: UNA, bien escrita, o nada. */
function desvioDePruebas() {
  const a = String(process.env.CORREO_PRUEBAS_A || '').trim();
  const smtp = process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.CRED_KEY);
  return smtp && /^[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}$/.test(a) ? a : null;
}

/** La contraseña del desvío: SMTP_PASS, o la cifrada en la ficha de SMTP_USER. */
async function passDelDesvio() {
  if (process.env.SMTP_PASS) return process.env.SMTP_PASS;
  try {
    const usuarios = require('../modules/Usuarios/usuarios.service');
    return usuarios.descifrarPassCorreo(await usuarios.buscarUsuario(process.env.SMTP_USER)) || null;
  } catch (_) { return null; }
}

const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function enviarEnPruebas(mail) {
  const a = desvioDePruebas();
  const pass = a ? await passDelDesvio() : null;
  if (a && !pass) console.log(`🧪 [PRUEBAS] No puedo descifrar la contraseña de correo de ${process.env.SMTP_USER} (¿CRED_KEY?): va al buzón falso`);
  if (a && pass) {
    const port = Number(process.env.SMTP_PORT) || 587;
    const aviso = `Entorno de pruebas: en producción este correo iría a ${mail.to}.`;
    const banda = `<p style="margin:0;padding:10px 14px;background:#fff4e0;color:#7a4a00;font:13px/1.4 Segoe UI,Arial,sans-serif;">${escHtml(aviso)}</p>`;
    const html = mail.html
      ? (/<body[^>]*>/i.test(mail.html) ? mail.html.replace(/<body[^>]*>/i, m => m + banda) : banda + mail.html)
      : undefined;
    const transport = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, to: a,
      subject: `[PRUEBAS] ${mail.subject || ''}`,
      text: `${aviso}\n\n${mail.text || ''}`, html, attachments: mail.attachments,
    });
    console.log(`🧪 [PRUEBAS] Correo DESVIADO a ${a} (iba a ${mail.to}) · «${mail.subject}»`);
    return { enviado: true, id: info.messageId, pruebas: true, desviadoA: a };
  }
  const b = buzonDePruebas();
  if (!b) {
    pruebas.permite('Correo', `«${mail.subject}» → ${mail.to}`);
    return { enviado: false, motivo: 'modo pruebas: el correo no sale' };
  }
  const transport = require('nodemailer').createTransport({ host: b.host, port: b.port, secure: false, ignoreTLS: true });
  const info = await transport.sendMail(mail);
  console.log(`🧪 [PRUEBAS] Correo al buzón de pruebas (${b.host}:${b.port}) · «${mail.subject}» → ${mail.to}`);
  return { enviado: true, id: info.messageId, pruebas: true };
}

/** Resuelve los ajustes SMTP (app primero, luego entorno) o null si no hay. */
async function ajustesEnvio() {
  try {
    const c = await configApp.leerConfig();
    if (c.correo_activo === 'si' && c.correo_host && c.correo_user && c.correo_pass_cifrada) {
      const pass = descifrar(c.correo_pass_cifrada);
      if (pass) {
        const port = Number(c.correo_port) || 587;
        return { host: c.correo_host, port, secure: port === 465, user: c.correo_user, pass,
          from: c.correo_from || c.correo_user, origen: 'app' };
      }
    }
  } catch (_) { /* la hoja CONFIG puede no existir aún */ }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 587;
    return { host: process.env.SMTP_HOST, port, secure: port === 465, user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM || process.env.SMTP_USER, origen: 'env' };
  }
  return null;
}

/** Estado para la pantalla de Configuración (nunca expone la contraseña). */
async function estadoCorreo() {
  const c = await configApp.leerConfig().catch(() => ({}));
  return {
    activo: c.correo_activo === 'si',
    host: c.correo_host || '',
    port: c.correo_port || '587',
    user: c.correo_user || '',
    from: c.correo_from || '',
    tienePass: !!c.correo_pass_cifrada,
    envCredenciales: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  };
}

/** Envía (o registra) un correo. Nunca lanza: un fallo de correo no rompe el flujo. */
async function enviarCorreo({ to, subject, text, html } = {}) {
  try {
    if (pruebas.ACTIVO) return await enviarEnPruebas({ from: 'Telecab <pruebas@telecab.local>', to, subject, text, html });
    const a = await ajustesEnvio();
    if (!a) {
      console.log(`✉️  [CORREO] Sin configurar → no se envía a ${to} · «${subject}» (revisa "Correo para procesos" y la variable CRED_KEY)`);
      return { enviado: false, motivo: 'sin credenciales (revisa Correo para procesos / CRED_KEY)' };
    }
    // Log de diagnóstico (sin la contraseña): de dónde salen los ajustes y a dónde va.
    console.log(`✉️  [CORREO] Enviando (origen ${a.origen}) por ${a.host}:${a.port} secure=${a.secure} user=${a.user} from=${a.from} → ${to}`);
    const nodemailer = require('nodemailer');   // lazy: la app arranca aunque no esté instalado
    const transport = nodemailer.createTransport({
      host: a.host, port: a.port, secure: a.secure,
      requireTLS: !a.secure,                     // en 587 fuerza STARTTLS (nunca manda en claro)
      auth: { user: a.user, pass: a.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    const info = await transport.sendMail({ from: a.from, to, subject, text, html });
    console.log(`✅ [CORREO] Enviado a ${to} · id=${info.messageId || '?'} · ${info.response || ''}`);
    return { enviado: true, id: info.messageId };
  } catch (e) {
    // Detalle SMTP completo para diagnosticar (código, respuesta del servidor…).
    const detalle = [e.message, e.code && `code=${e.code}`, e.responseCode && `smtp=${e.responseCode}`, e.response && `«${e.response}»`].filter(Boolean).join(' · ');
    console.error(`❌ [CORREO] Fallo enviando a ${to}: ${detalle}`);
    return { enviado: false, motivo: detalle || 'error desconocido' };
  }
}

/**
 * Envía un correo COMO un usuario concreto (desde su propio buzón @telecab.es), para
 * la trazabilidad: se sabe quién hizo cada proceso. Autentica con la contraseña de
 * correo CIFRADA guardada en su ficha. El SMTP es el mismo para todos (@telecab.es):
 * host/puerto salen de "correo para procesos" o, por defecto, de DonDominio.
 */
// Guarda una copia del mensaje (RFC822 crudo) en la carpeta "Enviados" por IMAP,
// porque enviar por SMTP NO la deja ahí (eso lo hace el cliente aparte). Busca la
// carpeta por su marca especial \Sent y, si no, por nombre (Sent/Enviados).
async function guardarEnEnviados({ user, pass, host, port = 993 }, raw) {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false, emitLogs: false });
  // Sin oyente de 'error', un corte de la conexión ya conectada se LANZA desde el
  // socket (ver leerCorreos): aquí basta con que la promesa pendiente falle.
  client.on('error', () => {});
  await client.connect();
  try {
    let carpeta = 'Sent';
    try {
      const list = await client.list();
      const bySpecial = list.find(m => m.specialUse === '\\Sent');
      const byName = list.find(m => /(^|[./])(sent|enviados)$/i.test(m.path || '') || /^(sent|enviados)$/i.test(m.name || ''));
      carpeta = (bySpecial && bySpecial.path) || (byName && byName.path) || 'Sent';
    } catch (_) { /* sin LIST: probamos con "Sent" */ }
    await client.append(carpeta, raw, ['\\Seen']);
    return carpeta;
  } finally {
    await client.logout().catch(() => {});
  }
}

// ── LEER UN BUZÓN, EN SOLO LECTURA (22/10/2026) ─────────────────────────────
// Lo estrenaron los repostajes de Ballenoil (modules/Combustible), que llegan a
// datos@telecab.es. Ese buzón lo usa Camilo en Thunderbird, así que leerlo NO
// puede cambiar nada de lo que él ve:
//
//   · La carpeta se abre con EXAMINE (`readOnly: true`), no con SELECT: en ese
//     modo el servidor no deja cambiar marcas, así que un correo sin leer sigue
//     sin leer aunque se baje entero. No se mueve, no se borra, no se marca.
//   · Primero se baja SOLO EL SOBRE (remitente, asunto, Message-ID) de lo que
//     llegó desde `desde`, y `elegir(sobre)` decide qué merece bajarse entero.
//     El resto ni se abre: el adaptador no sabe de repostajes y no tiene por
//     qué leer el correo de nadie.
//   · Tiempos límite cortos: un IMAP que no contesta no puede dejar colgada la
//     pasada siguiente. Y un tope para la lectura entera (`topeMs`): un servidor
//     que contesta a goteo no salta el tiempo de socket, y sin tope la pasada
//     no acabaría nunca.
//   · UN CORREO QUE NO SE PUEDE BAJAR NO TUMBA A LOS DEMÁS. Si se borra o se
//     mueve entre el sobre y el cuerpo (Camilo lo archiva en Thunderbird justo
//     entonces), `download` no trae contenido; ese correo vuelve con `error` y
//     los demás siguen.
//   · Varias carpetas en la misma conexión (`carpetas`): INBOX y Spam, porque el
//     antispam de DonDominio puede mandar ahí un correo con «⛽️» en el asunto.
//     Los UID son POR CARPETA: cada correo vuelve con la suya.
//
// Devuelve el texto de cada parte text/plain y text/html ya decodificado
// (imapflow quita el quoted-printable y pasa el charset a UTF-8). Con `firma`,
// además, la comprobación DKIM de cada correo elegido (services/dkim), sobre el
// correo en crudo. Lo que se haga con todo ello es cosa de quien llama.
const MAX_PARTE = 512 * 1024;       // un correo de repostaje son 4 KB; esto es un tope, no un tamaño
const MAX_CRUDO = 2 * 1024 * 1024;  // el correo entero, para la firma
const TOPE_LECTURA = 4 * 60 * 1000;

/** Lee un flujo hasta `max` bytes. `cortado`: no cabía entero. */
async function leerFlujo(flujo, max) {
  const trozos = [];
  let total = 0;
  for await (const t of flujo) { total += t.length; if (total <= max) trozos.push(t); }
  return { buf: Buffer.concat(trozos), cortado: total > max };
}

/** Las partes de texto de un correo (no los adjuntos), de su estructura MIME. */
function partesDeTexto(estructura) {
  const partes = [];
  const recorrer = n => {
    if (!n) return;
    if (n.childNodes) return n.childNodes.forEach(recorrer);
    const tipo = String(n.type || '').toLowerCase();
    if ((tipo === 'text/plain' || tipo === 'text/html') && String(n.disposition || '').toLowerCase() !== 'attachment') {
      partes.push({ parte: n.part || '1', tipo });
    }
  };
  recorrer(estructura);
  return partes;
}

async function leerCorreos({ user, pass, host, port = 993, carpeta = 'INBOX', carpetas, desde, elegir = () => true,
  firma = false, topeMs = TOPE_LECTURA } = {}) {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host, port, secure: port === 993, auth: { user, pass }, logger: false, emitLogs: false,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
  });
  // EL OYENTE DE 'error' NO ES OPCIONAL. Ya conectado, imapflow avisa de un
  // corte (tiempo de socket, ECONNRESET, un BYE del servidor) EMITIENDO 'error';
  // sin oyente, Node lo lanza desde el manejador del socket: en el ERP lo recoge
  // la red de app.js como «excepción no capturada» y un script se cae entero. Y
  // la promesa pendiente falla con un «Connection not available» que no dice
  // nada: lo que se relanza es el error de verdad, que sí lo dice.
  let errorImap = null;
  client.on('error', e => { if (!errorImap) errorImap = e; });
  const tope = setTimeout(() => {
    if (!errorImap) errorImap = Object.assign(new Error(`el servidor tardó más de ${Math.round(topeMs / 1000)} s en dar el buzón`), { code: 'ETOPE' });
    try { client.close(); } catch (_) { /* ya estaba cerrada */ }
  }, topeMs);

  const lista = carpetas && carpetas.length ? carpetas : [carpeta];
  const res = { carpeta: lista[0], uidValidity: null, vistos: 0, correos: [], carpetas: [] };
  const cacheDns = new Map();
  try {
    await client.connect();
    for (const [i, c] of lista.entries()) {
      let lock;
      try {
        lock = await client.getMailboxLock(c, { readOnly: true });
      } catch (e) {
        // La primera (INBOX) tiene que abrirse. Las demás pueden no existir en
        // otro servidor, o la conexión caerse antes: se apunta y se devuelve lo
        // que ya se bajó, que no tiene por qué perderse.
        if (i === 0) throw e;
        res.carpetas.push({ carpeta: c, error: (errorImap && errorImap.message) || e.responseText || e.message });
        continue;
      }
      try {
        const uidValidity = client.mailbox && client.mailbox.uidValidity != null ? Number(client.mailbox.uidValidity) : null;
        const uids = (await client.search(desde ? { since: desde } : { all: true }, { uid: true })) || [];

        // Los sobres, todos de una vez. Mientras dura este bucle no se puede pedir
        // nada más al servidor (imapflow se quedaría esperando a sí mismo): por eso
        // los cuerpos se bajan después.
        const sobres = [];
        if (uids.length) {
          for await (const m of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
            const env = m.envelope || {};
            const de = (env.from && env.from[0]) || {};
            sobres.push({
              carpeta: c, uid: m.uid, uidValidity,
              messageId: env.messageId ? String(env.messageId).trim() : null,
              de: (de.address || '').toLowerCase(), deNombre: de.name || '',
              asunto: env.subject || '',
              fecha: m.internalDate || env.date || null,
              estructura: m.bodyStructure || null,
            });
          }
        }
        if (i === 0) res.uidValidity = uidValidity;
        res.vistos += sobres.length;
        res.carpetas.push({ carpeta: c, uidValidity, vistos: sobres.length });

        for (const s of sobres) {
          if (!elegir(s)) continue;
          const { estructura, ...sobre } = s;
          const correo = { ...sobre, partes: [] };
          try {
            if (errorImap || !client.usable) throw errorImap || new Error('la conexión con el servidor se cerró');
            for (const p of partesDeTexto(estructura)) {
              const { content } = await client.download(String(s.uid), p.parte, { uid: true });
              if (!content) throw new Error(`el servidor no dio la parte ${p.parte} (¿se movió o se borró mientras se leía?)`);
              correo.partes.push({ tipo: p.tipo, contenido: (await leerFlujo(content, MAX_PARTE)).buf.toString('utf8') });
            }
            if (firma) {
              // La firma es un dato más: si no se puede comprobar, el correo sigue.
              correo.firmas = null;
              try {
                const { content } = await client.download(String(s.uid), undefined, { uid: true });
                const crudo = content ? await leerFlujo(content, MAX_CRUDO) : null;
                if (crudo && !crudo.cortado) correo.firmas = await require('./dkim').comprobar(crudo.buf, { cache: cacheDns });
              } catch (_) { /* queda en null: no se pudo comprobar */ }
            }
          } catch (e) {
            correo.error = (errorImap && errorImap.message) || e.message;
          }
          res.correos.push(correo);
        }
      } finally {
        lock.release();
      }
    }
    // Si la conexión cayó a medias, lo bajado vale y los correos que faltaron
    // traen su `error`; esto dice por qué, para quien lo apunte.
    res.error = errorImap ? errorImap.message : null;
    return res;
  } catch (e) {
    throw errorImap || e;
  } finally {
    clearTimeout(tope);
    await client.logout().catch(() => {});
  }
}

// Construye el mensaje crudo (RFC822) que se guardará en Enviados.
function componerRaw(mail) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  return new Promise((resolve, reject) => {
    new MailComposer(mail).compile().build((err, message) => err ? reject(err) : resolve(message));
  });
}

async function enviarComoUsuario(emailRemitente, { to, subject, text, html, attachments } = {}) {
  try {
    if (pruebas.ACTIVO) {
      return { ...(await enviarEnPruebas({ from: emailRemitente, to, subject, text, html, attachments })), from: emailRemitente };
    }
    const usuarios = require('../modules/Usuarios/usuarios.service');
    const u = await usuarios.buscarUsuario(emailRemitente);
    if (!u) return { enviado: false, motivo: `El remitente ${emailRemitente} no existe` };
    const pass = usuarios.descifrarPassCorreo(u);
    if (!pass) return { enviado: false, motivo: `${emailRemitente} no tiene contraseña de correo configurada (Configuración → Mi perfil)` };

    const c = await configApp.leerConfig().catch(() => ({}));
    const host = c.correo_host || 'smtp.dondominio.com';
    const port = Number(c.correo_port) || 587;
    const from = u.email;   // se envía SIEMPRE como el propio usuario

    console.log(`✉️  [CORREO] Como ${from} por ${host}:${port} → ${to}`);
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: from, pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    const info = await transport.sendMail({ from, to, subject, text, html, attachments });
    console.log(`✅ [CORREO] Enviado como ${from} → ${to} · id=${info.messageId || '?'}${attachments && attachments.length ? ` · ${attachments.length} adj.` : ''}`);

    // Deja copia en "Enviados" por IMAP. Si falla, el correo YA salió: solo se avisa.
    try {
      const raw = await componerRaw({ from, to, subject, text, html, attachments, messageId: info.messageId });
      const imapHost = (c.correo_imap_host || '').trim() || host.replace(/^smtp\./i, 'imap.');
      const carpeta = await guardarEnEnviados({ user: from, pass, host: imapHost }, raw);
      console.log(`📥 [CORREO] Copia guardada en "${carpeta}" de ${from}`);
    } catch (e) {
      console.error(`⚠️ [CORREO] No se pudo guardar copia en Enviados: ${e.message}`);
    }
    return { enviado: true, id: info.messageId, from };
  } catch (e) {
    const detalle = [e.message, e.code && `code=${e.code}`, e.responseCode && `smtp=${e.responseCode}`, e.response && `«${e.response}»`].filter(Boolean).join(' · ');
    console.error(`❌ [CORREO] Fallo enviando como ${emailRemitente}: ${detalle}`);
    return { enviado: false, motivo: detalle || 'error desconocido' };
  }
}

// Compatibilidad: indica si hay credenciales por entorno (uso heredado).
function configurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

module.exports = { enviarCorreo, enviarComoUsuario, estadoCorreo, ajustesEnvio, configurado, leerCorreos, CORREO_TRAFICO };
