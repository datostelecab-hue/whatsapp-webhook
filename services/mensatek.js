// ============================================================
// MENSATEK — el cliente de su API v7 (SMS certificado, 26/11/2026)
// ============================================================
// Documentación: https://www.mensatek.com/api-envio-sms-certificado-y-sms-contrato.html
//
//   · Todo es POST a https://api.mensatek.com/v7/<Función>, con JSON y
//     autenticación básica: el Usuario API y el API Token (Tus Datos →
//     Configurar cuenta). Van en el entorno: MENSATEK_USUARIO y MENSATEK_API_KEY.
//   · Siempre `Resp: 'JSON'`: sin él contesta en el formato antiguo.
//   · La respuesta es un array con un objeto; `Res` > 0 es que fue bien, y los
//     negativos son errores (-1 autenticación, -2/-5 sin créditos, -3 datos…).
//   · OJO: Mensatek trata las conexiones erróneas repetidas como spam y puede
//     bloquear la conexión un rato. Por eso no se reintenta nada a ciegas.
//
// En MODO_PRUEBAS no sale nada: se contesta como si se hubiera mandado.
'use strict';

const BASE = (process.env.MENSATEK_URL || 'https://api.mensatek.com/v7').replace(/\/+$/, '');
const ESPERA_MS = 30000;

const usuario = () => String(process.env.MENSATEK_USUARIO || '').trim();
const clave = () => String(process.env.MENSATEK_API_KEY || '').trim();
const configurado = () => !!(usuario() && clave());
const enPruebas = () => {
  try { return !!require('./modoPruebas').ACTIVO; } catch (_) { return process.env.MODO_PRUEBAS === '1'; }
};

const ERRORES = {
  '-1': 'Mensatek no reconoce el usuario de la API o el token (revisa MENSATEK_USUARIO y MENSATEK_API_KEY)',
  '-2': 'No quedan créditos suficientes en Mensatek',
  '-4': 'Mensatek no admite ese adjunto',
  '-5': 'No quedan créditos suficientes en Mensatek',
  '-15': 'Falta el PDF en el mensaje',
  '-16': 'El PDF no está en la biblioteca de Mensatek',
};
const error = (msg, extra = {}) => Object.assign(new Error(msg), extra);

/** Una llamada. → el objeto de la respuesta (o el Buffer, si contesta con un fichero). */
async function llamar(funcion, cuerpo = {}, { fichero = false } = {}) {
  if (!configurado()) throw error('Mensatek sin configurar: faltan MENSATEK_USUARIO y MENSATEK_API_KEY en el entorno', { sinConfigurar: true });
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), ESPERA_MS);
  let r;
  try {
    r = await fetch(`${BASE}/${funcion}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${usuario()}:${clave()}`).toString('base64'),
      },
      body: JSON.stringify({ ...cuerpo, Resp: 'JSON' }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw error(e.name === 'AbortError' ? 'Mensatek no ha contestado a tiempo' : `No se pudo llamar a Mensatek: ${e.message}`);
  } finally { clearTimeout(reloj); }
  // Sin enseñar las credenciales: cuántos caracteres llegan (32 y 32 las buenas)
  // y lo que dice Mensatek, para saber si es un espacio de más, una variable
  // vacía o un bloqueo suyo.
  if (r.status === 401) {
    const dice = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    throw error(`${ERRORES['-1']}. Al servidor le llegan un usuario de ${usuario().length} caracteres y un token de ${clave().length}${dice ? `; Mensatek dice: «${dice}»` : ''}`, { res: -1 });
  }
  if (!r.ok) throw error(`Mensatek ha contestado ${r.status}`);
  const tipo = String(r.headers.get('content-type') || '');
  if (fichero && !/json|text|xml/i.test(tipo)) return Buffer.from(await r.arrayBuffer());
  const texto = await r.text();
  let datos;
  try { datos = JSON.parse(texto); } catch (_) { throw error(`Mensatek ha contestado algo que no es JSON: ${texto.slice(0, 200)}`); }
  const o = Array.isArray(datos) ? datos[0] || {} : datos || {};
  const res = Number(o.Res);
  if (!(res > 0)) {
    // Con -1 (no le reconoce), lo mismo que con el 401: qué le llega al servidor.
    // La IP del servidor sin autorizar en la cuenta (Tus datos → Configurar → Seguridad).
    const ip = /public IP address \(([^)]+)\)/i.exec(String(o.Error || ''));
    if (res === -1 && ip) {
      throw error(`Mensatek no acepta peticiones desde la IP del servidor (${ip[1]}): hay que autorizarla en Mensatek, en Tus datos → Configurar cuenta → Seguridad (y las demás IPs de salida de Render)`, { res, respuesta: o, ipNoAutorizada: ip[1] });
    }
    const pista = res === -1
      ? `. Al servidor le llegan un usuario de ${usuario().length} caracteres y un token de ${clave().length}; Mensatek dice: «${JSON.stringify(o).slice(0, 160)}»`
      : '';
    throw error((ERRORES[String(res)] || o.Error || `Mensatek ha contestado Res=${o.Res}`) + pista, { res, respuesta: o });
  }
  return o;
}

/** El móvil como lo quiere Mensatek: con el prefijo y sin «+» (34600000000). */
function movilDe(e164) {
  const d = String(e164 || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.length === 9 && /^[67]/.test(d)) return '34' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/**
 * UN SMS CERTIFICADO a un móvil. `identificar`: 'DNI-12345678Z', 'MOVIL', 'OTP'
 * o 'LIBRE'. `pdf`: { base64 } para adjuntar un PDF al mensaje (Mensatek lo
 * custodia). → { idMensaje, creditos, restantes, remitente }.
 */
async function enviarCertificado({ movil, mensaje, referencia, identificar = 'MOVIL', aceptacion = 0, pdf = null, remitente = '',
  contacto, telContacto, cif, diasValidez = 3 }) {
  const m = movilDe(movil);
  if (!m) throw error('El móvil no es válido');
  if (!contacto || !telContacto || !cif) throw error('Faltan los datos del emisor (nombre, teléfono y CIF de la empresa) en Parámetros');
  const texto = pdf && pdf.base64 ? `${mensaje} (BASE64:2:${pdf.base64})` : mensaje;
  const cuerpo = {
    Remitente: remitente || '', Destinatarios: JSON.stringify([{ Movil: m }]), Mensaje: texto,
    Tipocontrato: 0, Referenciausuario: String(referencia || '').slice(0, 60), Report: 1,
    Contacto: contacto, Telcontacto: telContacto, Cifcontacto: cif,
    Vpd: Math.max(1, Math.min(20, Number(diasValidez) || 3)), Vph: 0, Vpm: 0,
    Identificar: identificar, Aceptacion: Math.max(0, Math.min(15, Number(aceptacion) || 0)),
    Unicode: 0, ...(pdf && pdf.base64 ? { Links: 1 } : {}),
  };
  if (enPruebas()) {
    console.log(`🧪 [Mensatek] MODO_PRUEBAS: no se manda el SMS certificado a ${m} (${referencia})`);
    return { idMensaje: null, creditos: 0, restantes: null, remitente: '', simulado: true };
  }
  const o = await llamar('EnviarSMSCERTIFICADO', cuerpo);
  return {
    idMensaje: Number(o.idMensaje || o.Msgid) || null, creditos: Number(o.CreditosUsados) || 0,
    restantes: o.Cred != null ? Number(o.Cred) : null, remitente: o.Remitente || '', noEnviados: Number(o.NoEnviados) || 0,
  };
}

/** El estado de un envío, por destinatario. → [{ fecha, telefono, resultado, estado }] */
async function report(idMensaje) {
  const o = await llamar('GetReportSMSCERTIFICADO', { Idmensaje: Number(idMensaje) });
  let inf = o.Informe;
  // Lo da como texto con comillas simples: «[{'Fecha':'…','Resultado':14}]».
  if (typeof inf === 'string') {
    try { inf = JSON.parse(inf); } catch (_) {
      try { inf = JSON.parse(inf.replace(/'/g, '"')); } catch (_e) { inf = []; }
    }
  }
  return (Array.isArray(inf) ? inf : []).map(x => ({
    fecha: x.Fecha || null, telefono: String(x.Telefono || ''), resultado: Number(x.Resultado), estado: x.Estado || '',
  }));
}

/** El certificado en PDF de un destinatario: el ZIP que da Mensatek, abierto. → Buffer del PDF o null. */
async function certificado(idMensaje, telefono) {
  const zip = await llamar('GetSMSCERTIFICADO', { Idmensaje: Number(idMensaje), Telefono: movilDe(telefono) }, { fichero: true });
  if (!Buffer.isBuffer(zip)) return null;
  if (zip.slice(0, 4).toString('latin1') === '%PDF') return zip;
  const JSZip = require('jszip');
  const z = await JSZip.loadAsync(zip);
  const pdf = Object.values(z.files).find(f => !f.dir && /\.pdf$/i.test(f.name));
  return pdf ? pdf.async('nodebuffer') : null;
}

/** Los créditos que quedan (para enseñarlos; Mensatek pide no llamarlo a menudo). */
async function creditos() {
  const o = await llamar('GetCreditos', {});
  return Number(o.Cred);
}

module.exports = { configurado, enviarCertificado, report, certificado, creditos, movilDe, llamar };
