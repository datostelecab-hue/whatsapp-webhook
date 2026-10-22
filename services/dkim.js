// ============================================================
// DKIM — ¿el correo lo firmó de verdad el dominio que dice?
// ============================================================
// Lo estrenaron los repostajes de Ballenoil (modules/Combustible, 22/10/2026):
// un repostaje se va a auditar contra un conductor, y cualquiera puede mandar a
// datos@telecab.es un correo con «From: noreply@ballenoil.es». La cabecera From
// no prueba nada; la firma DKIM sí: el servidor de Ballenoil firma el correo con
// su clave privada y la pública está en su DNS.
//
// POR QUÉ SE COMPRUEBA AQUÍ Y NO SE LEE DEL SERVIDOR. Lo normal es que el
// servidor que recibe deje su veredicto en la cabecera Authentication-Results
// («dkim=pass header.d=ballenoil.es»). DonDominio NO la pone: en los diez
// primeros correos de Ballenoil solo hay Return-Path, X-Spam-Status y la propia
// DKIM-Signature (d=ballenoil.es, s=authsmtp, rsa-sha256, relaxed/relaxed). Así
// que la firma se comprueba aquí, con lo que trae Node (crypto y dns): sin
// dependencias nuevas.
//
// Lo que se comprueba es lo de la RFC 6376 que usan los correos de verdad:
// rsa-sha256, canonicalización simple o relaxed, y la etiqueta l=. Lo que no se
// sabe comprobar (otro algoritmo, una clave que no es RSA) no es «falsa»: es
// «no se pudo comprobar», y quien llama decide.
//
// LAS LÍNEAS LARGAS QUE PARTE UN SERVIDOR POR EL CAMINO. Ninguno de los ocho
// correos directos de Ballenoil cuadraba de primeras: las cabeceras firmadas sí,
// el cuerpo no. Su pie legal es una línea de más de mil caracteres, y un
// servidor del camino (sendmail lo hace con las de más de 990) la parte
// metiendo «!», salto y un espacio —en el correo se lee «comerciale! s»—,
// DESPUÉS de firmar. Si el cuerpo no cuadra tal cual, se prueba deshaciendo ese
// corte, y con eso cuadran los ocho. No abre ninguna puerta: para cuadrar, el
// cuerpo sin los cortes tiene que ser, byte a byte, el que se firmó.

const crypto = require('crypto');
const dns = require('dns').promises;

// ── EL CORREO EN CRUDO ──────────────────────────────────────────────────────
// Todo en 'latin1': un byte, un carácter. Las firmas se calculan sobre BYTES, y
// pasar el correo por UTF-8 cambiaría los que no son ASCII.

/** Cabeceras (cada una con su texto crudo, plegado incluido) y cuerpo. */
function partir(raw) {
  const s = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw || '');
  let corte = s.indexOf('\r\n\r\n'), salto = 4;
  if (corte < 0) { corte = s.indexOf('\n\n'); salto = 2; }
  const cab = corte < 0 ? s : s.slice(0, corte);
  const cuerpo = corte < 0 ? '' : s.slice(corte + salto);
  // Sin CRLF no hay firma que cuadre (se firma con CRLF): se normaliza.
  const lineas = cab.replace(/\r?\n/g, '\r\n').split('\r\n');
  const campos = [];
  for (const l of lineas) {
    if (/^[ \t]/.test(l) && campos.length) campos[campos.length - 1].crudo += '\r\n' + l;
    else if (l) campos.push({ crudo: l });
  }
  for (const c of campos) {
    const i = c.crudo.indexOf(':');
    c.nombre = (i < 0 ? c.crudo : c.crudo.slice(0, i)).trim().toLowerCase();
    c.valor = i < 0 ? '' : c.crudo.slice(i + 1);
  }
  return { campos, cuerpo: cuerpo.replace(/\r?\n/g, '\r\n') };
}

/** Las etiquetas «k=v; k=v» de una firma o de un registro DNS. */
function etiquetas(txt) {
  const out = {};
  for (const trozo of String(txt || '').replace(/\r\n/g, '').split(';')) {
    const i = trozo.indexOf('=');
    if (i < 0) continue;
    out[trozo.slice(0, i).trim().toLowerCase()] = trozo.slice(i + 1).trim();
  }
  return out;
}

// ── LA CANONICALIZACIÓN (RFC 6376, 3.4) ─────────────────────────────────────

function cuerpoSimple(c) {
  const t = c.replace(/(\r\n)*$/, '');
  return t + '\r\n';
}

function cuerpoRelaxed(c) {
  const t = c.split('\r\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/ $/, '')).join('\r\n').replace(/(\r\n)*$/, '');
  return t ? t + '\r\n' : '';
}

/** Deshace el corte de las líneas largas de sendmail: «!», salto y espacio. */
const sinCortes = c => c.replace(/!\r\n /g, '');

const cabeceraRelaxed = (nombre, valor) =>
  `${nombre.toLowerCase().trim()}:${valor.replace(/\r\n(?=[ \t])/g, '').replace(/[ \t]+/g, ' ').trim()}`;

// ── LA CLAVE PÚBLICA, DEL DNS ───────────────────────────────────────────────

async function clavePublica(selector, dominio, cache) {
  const nombre = `${selector}._domainkey.${dominio}`;
  if (cache && cache.has(nombre)) return cache.get(nombre);
  const p = (async () => {
    // Que el selector no exista en su DNS es que la firma no vale (un correo
    // falso puede traer una DKIM-Signature inventada); que el DNS no conteste
    // es «no se pudo comprobar», que no es lo mismo.
    const registros = await dns.resolveTxt(nombre).catch(e => {
      if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) throw Object.assign(new Error(`${nombre} no existe en el DNS`), { sinClave: true });
      throw e;
    });
    const txt = registros.map(trozos => trozos.join('')).find(t => /(^|;)\s*p\s*=/.test(t));
    if (!txt) throw Object.assign(new Error(`${nombre} no tiene clave DKIM`), { sinClave: true });
    const t = etiquetas(txt);
    if (!t.p) throw Object.assign(new Error(`La clave DKIM de ${dominio} está revocada`), { sinClave: true });
    if (t.k && t.k.toLowerCase() !== 'rsa') throw Object.assign(new Error(`Clave DKIM «${t.k}»: solo se comprueba RSA`), { noSe: true });
    const b64 = t.p.replace(/\s+/g, '');
    return crypto.createPublicKey(`-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`);
  })();
  if (cache) cache.set(nombre, p);
  return p;
}

// ── COMPROBAR ───────────────────────────────────────────────────────────────

/**
 * Comprueba las firmas DKIM de un correo en crudo (Buffer o texto).
 *
 * → [{ dominio, selector, resultado, motivo }], una por firma, con
 *   `resultado`: 'valida' | 'no_valida' | 'no_se_pudo'. Lista vacía si el
 *   correo no trae ninguna firma.
 *
 * `cache`: un Map para no preguntar al DNS por la misma clave en cada correo
 * de una pasada. Nunca lanza.
 */
async function comprobar(raw, { cache } = {}) {
  const { campos, cuerpo } = partir(raw);
  const firmas = campos.filter(c => c.nombre === 'dkim-signature');
  const out = [];
  for (const f of firmas) {
    const t = etiquetas(f.valor);
    const r = { dominio: (t.d || '').toLowerCase(), selector: t.s || '', resultado: 'no_se_pudo', motivo: '' };
    out.push(r);
    try {
      if (t.v !== '1' || !t.d || !t.s || !t.h || !t.b || !t.bh) { r.resultado = 'no_valida'; r.motivo = 'la firma está incompleta'; continue; }
      if ((t.a || '').toLowerCase() !== 'rsa-sha256') { r.motivo = `algoritmo «${t.a}»: solo se comprueba rsa-sha256`; continue; }
      const [cc, cb] = String(t.c || 'simple/simple').toLowerCase().split('/');
      const canonCab = cc || 'simple', canonCuerpo = cb || 'simple';

      // 1. El cuerpo: su huella tiene que ser la de la firma (bh=). Tal cual
      //    y, si no, sin los cortes de línea de sendmail (arriba).
      const huella = cu => {
        let c = canonCuerpo === 'relaxed' ? cuerpoRelaxed(cu) : cuerpoSimple(cu);
        if (t.l != null && /^\d+$/.test(t.l)) c = c.slice(0, Number(t.l));
        return crypto.createHash('sha256').update(Buffer.from(c, 'latin1')).digest('base64');
      };
      const bh = t.bh.replace(/\s+/g, '');
      if (huella(cuerpo) !== bh && !(/!\r\n /.test(cuerpo) && huella(sinCortes(cuerpo)) === bh)) {
        r.resultado = 'no_valida'; r.motivo = 'el cuerpo no es el que se firmó'; continue;
      }

      // 2. Las cabeceras firmadas, en el orden de h=, cada nombre desde abajo.
      const usadas = new Set();
      const lineas = [];
      for (const nombre of t.h.split(':').map(x => x.trim().toLowerCase()).filter(Boolean)) {
        let campo = null;
        for (let i = campos.length - 1; i >= 0; i--) {
          if (campos[i].nombre === nombre && !usadas.has(i)) { campo = campos[i]; usadas.add(i); break; }
        }
        if (!campo) continue;   // firmar una cabecera que no está es válido: no aporta nada
        lineas.push(canonCab === 'relaxed' ? cabeceraRelaxed(campo.nombre, campo.valor) : campo.crudo);
      }
      // Y la propia firma, con el valor de b= vacío y sin el salto final.
      const sinB = f.valor.replace(/(^|;)(\s*b\s*=)[^;]*/i, '$1$2');
      lineas.push(canonCab === 'relaxed' ? cabeceraRelaxed('dkim-signature', sinB)
        : f.crudo.slice(0, f.crudo.indexOf(':') + 1) + sinB);
      const datos = Buffer.from(lineas.join('\r\n'), 'latin1');

      // 3. La firma, con la clave pública del DNS del dominio.
      let clave;
      try { clave = await clavePublica(t.s, t.d, cache); }
      catch (e) {
        r.resultado = e.sinClave ? 'no_valida' : 'no_se_pudo';
        r.motivo = e.sinClave || e.noSe ? e.message
          : /^ERR_/.test(e.code || '') ? `su clave DKIM no se entiende (${e.code})`
            : `no se pudo preguntar al DNS por la clave (${e.code || e.message})`;
        continue;
      }
      const ok = crypto.verify('sha256', datos, clave, Buffer.from(t.b.replace(/\s+/g, ''), 'base64'));
      r.resultado = ok ? 'valida' : 'no_valida';
      r.motivo = ok ? `firma DKIM de ${r.dominio}` : 'la firma no cuadra con las cabeceras';
    } catch (e) {
      r.resultado = 'no_se_pudo';
      r.motivo = e.message;
    }
  }
  return out;
}

module.exports = { comprobar, sinCortes };
