// ============================================================
// LOS FICHEROS IMPORTADOS — la puerta común (db/284, 25/11/2026)
// ============================================================
// Fase 0 del plan de RR. HH. y nóminas: la gestoría y el INSS mandan ficheros
// (la plantilla en alta, las bajas médicas, la proforma, los borradores) y
// Diana los sube. Todos se cargan igual:
//
//   // 1. El módulo dice qué tipos carga y quién ve sus originales:
//   ficherosImportados.registrarTipo('legajos', { etiqueta: 'Legajos de la gestoría', ver: async quien => … });
//
//   // 2. Al cargar: la huella primero (el mismo fichero no entra dos veces)…
//   const h = ficherosImportados.huella(buffer);
//   await ficherosImportados.exigirNuevo('legajos', h);      // lanza si ya se cargó
//   // …y lo que haga el módulo, en SU transacción, apuntando la carga en ella:
//   await libro.conFirma(firma, async cli => {
//     … escribe lo suyo …
//     id = await ficherosImportados.apuntar(cli, { tipo, periodo, nombre, buffer, estructura, resultado, incidencias, usuarioId });
//   });
//   // 3. Fuera ya de la transacción, el original al almacén:
//   await ficherosImportados.guardarOriginal(id, { nombre, buffer, mime, usuarioId });
//
// Qué se guarda: tipo, periodo, nombre, huella (sha256), bytes, la estructura
// que se le detectó (hojas, cabeceras), el resultado (recuentos) y cuántas
// incidencias dejó. Todo bajo el libro de auditoría.
'use strict';

const crypto = require('crypto');
const { Readable } = require('stream');
const repo = require('./repo/ficherosImportados');
const adjuntos = require('./adjuntos');

const TIPOS = new Map();
const TIPO_VALIDO = /^[a-z][a-z0-9_]{0,39}$/;
const DUENO = 'fichero_importado';

/** Un módulo dice qué tipo de fichero carga y quién puede ver sus originales. */
function registrarTipo(tipo, { etiqueta, ver } = {}) {
  if (!TIPO_VALIDO.test(String(tipo || ''))) throw new Error(`Tipo de fichero importado no válido: «${tipo}»`);
  if (typeof ver !== 'function') throw new Error(`El tipo «${tipo}» tiene que decir quién ve sus ficheros (ver)`);
  TIPOS.set(tipo, { tipo, etiqueta: etiqueta || tipo, ver });
}

function tipoDe(tipo) {
  const t = TIPOS.get(String(tipo || ''));
  if (!t) throw new Error(`No existe el tipo de fichero «${tipo}»`);
  return t;
}

/** La huella de un fichero: sha256 de sus bytes, en hexadecimal. */
const huella = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

/** El error de «ya se cargó», con quién y cuándo. */
function yaCargado(viva) {
  const e = new Error(`Este fichero ya se cargó el ${viva.cuando}${viva.subido_por_nombre ? ` (${viva.subido_por_nombre})` : ''}. El mismo fichero no se carga dos veces.`);
  e.yaCargado = { id: viva.id, cuando: viva.cuando, por: viva.subido_por_nombre || null };
  return e;
}

/** Lanza si ese fichero (mismo tipo, misma huella) ya está cargado. */
async function exigirNuevo(tipo, sha256) {
  tipoDe(tipo);
  const viva = await repo.cargaViva(tipo, sha256);
  if (viva) throw yaCargado(viva);
}

/**
 * Apunta la carga DENTRO de la transacción del módulo (`cli`): si lo demás
 * falla, no queda apuntada. Si otro la cargó a la vez, lanza «ya se cargó».
 */
async function apuntar(cli, { tipo, periodo = null, nombre, buffer, estructura = null, resultado = null, incidencias = 0, usuarioId = null }) {
  tipoDe(tipo);
  const sha256 = huella(buffer);
  const viva = await repo.cargaViva(tipo, sha256, cli);
  if (viva) throw yaCargado(viva);
  try {
    return await repo.insertar(cli, {
      tipo, periodo, nombre: String(nombre || 'fichero').slice(0, 255), sha256, bytes: buffer.length,
      estructura, resultado, incidencias, subidoPor: usuarioId,
    });
  } catch (e) {
    if (e.code === '23505') throw new Error('Este fichero ya se cargó (a la vez, desde otro sitio). El mismo fichero no se carga dos veces.');
    throw e;
  }
}

/**
 * Guarda el original en el almacén, como adjunto de la carga. Si el almacén
 * falla, la carga se queda (ya está hecha) y se dice en el log.
 */
async function guardarOriginal(id, { nombre, buffer, mime = 'application/octet-stream', usuarioId = null } = {}) {
  try {
    const a = await adjuntos.subirDelSistema({
      tipo: DUENO, duenoId: String(id), nombre: nombre || 'fichero', mime, cuerpo: Readable.from(buffer),
      firmante: usuarioId, creadoPor: usuarioId, origen: 'ficheros importados',
    });
    const adjuntoId = a && (a.id || a.adjuntoId);
    if (adjuntoId) await repo.ponerAdjunto(id, adjuntoId);
    return adjuntoId || null;
  } catch (e) {
    console.error(`❌ [Ficheros importados] no se guardó el original de la carga ${id}:`, e.message);
    return null;
  }
}

/** Las últimas cargas de un tipo, si quien pregunta puede verlas. */
async function ultimas(tipo, quien, { limite = 20 } = {}) {
  const t = tipoDe(tipo);
  if (!await t.ver(quien)) throw new Error('No puedes ver estas cargas');
  if (!await repo.hayTabla()) return { cargas: [], sinTabla: true };
  const cargas = (await repo.deTipo(tipo, { limite })).map(c => ({
    id: c.id, periodo: c.periodo, nombre: c.nombre, cuando: c.cuando, por: c.subido_por_nombre || '',
    incidencias: c.incidencias, resultado: c.resultado, estado: c.estado,
    original: c.adjunto_id ? `/adjuntos/${c.adjunto_id}/fichero?descargar=1` : null,
  }));
  return { cargas, sinTabla: false };
}

// El original de una carga lo ve quien puede ver las cargas de su tipo. Nadie
// adjunta a mano: solo el servidor, al cargar.
adjuntos.registrarDueno(DUENO, {
  etiqueta: 'Fichero importado',
  ver: async (quien, id) => {
    const c = await repo.porId(id).catch(() => null);
    const t = c && TIPOS.get(c.tipo);
    return !!(t && await t.ver(quien));
  },
  adjuntar: async () => false,
});

module.exports = { registrarTipo, huella, exigirNuevo, apuntar, guardarOriginal, ultimas, TIPOS };
