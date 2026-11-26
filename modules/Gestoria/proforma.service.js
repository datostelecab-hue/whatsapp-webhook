// ============================================================
// LA PROFORMA DE A3 — LA PUERTA (módulo 4, db/296, 25/11/2026)
// ============================================================
// Camilo (25/11/2026): en Gestoría; cada caso se marca (corregir en A3,
// corregir en el ERP o está bien) y con los de A3 el ERP prepara el correo a la
// gestoría; avisa, no frena.
//
//   · SUBIR: primero se enseña qué sale; al confirmarlo se apunta la carga
//     (ficheros importados: el mismo fichero no entra dos veces) y se
//     sincronizan los casos del mes: los nuevos entran, los que siguen se
//     refrescan (y conservan lo decidido), y los que estaban por decidir y ya
//     no salen se cierran solos.
//   · DECIDIR: uno o varios a la vez, con nota opcional.
//   · EL CORREO: los marcados «corregir en A3» que no se han mandado, con su frase.
//   · LA TARJETA: a quien sube los listados de la gestoría («plantilla_gestoria»),
//     con vencimiento el día del corte (`nomina.dia_corte`); se cierra sola al
//     no quedar ninguno por decidir.
'use strict';

const repo = require('./proforma.repo');
const proforma = require('./proforma');
const listado = require('./listado');
const gestoria = require('./gestoria.service');
const libro = require('../../services/libro');
const ficheros = require('../../services/ficherosImportados');
const parametros = require('../../services/parametros');
const contadores = require('../../services/contadores');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const adjuntos = require('../../services/adjuntos');

const TIPO_FICHERO = 'proforma_a3';
const TIPO_TARJETA = 'gestoria_proforma';
const DECISIONES = {
  pendiente: { etiqueta: 'Por decidir', tono: 'warn' },
  a3: { etiqueta: 'Corregir en A3', tono: 'red' },
  erp: { etiqueta: 'Corregir en el ERP', tono: 'gold' },
  bien: { etiqueta: 'Está bien', tono: 'green' },
  ya_no_sale: { etiqueta: 'Ya no sale', tono: 'muted' },
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = periodo => `${MESES[Number(periodo.slice(5, 7)) - 1]} de ${periodo.slice(0, 4)}`;

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const exigir = async (quien, clave) => { if (!await gestoria.puede(quien, clave)) throw error('No tienes permiso para esto', 403); };

ficheros.registrarTipo(TIPO_FICHERO, {
  etiqueta: 'Proforma de nómina de A3',
  ver: async q => gestoria.puede({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol }, gestoria.CLAVE_VER),
});

tablero.registrarTipo(TIPO_TARJETA, { etiqueta: 'Proforma de la gestoría', abrir: 'Revisar la proforma', cierreManual: false });

let admite = false;
async function admiteItSinBaja() {
  if (admite) return true;
  const db = require('../../services/db');
  const r = await db.consulta(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_proforma_tipo'`).catch(() => ({ rows: [] }));
  admite = !!(r.rows[0] && /it_sin_baja/.test(r.rows[0].def));
  return admite;
}

/** Lee la proforma y la cruza con el ERP. → { leido, casos, resumen } */
async function analizar(buffer, { hoy = calendario.hoy() } = {}) {
  const leido = proforma.leer(await listado.hojasDe(buffer));
  const todos = proforma.cruzar({ trabajadores: leido.trabajadores, personas: await repo.personasDelMes(leido.desde, leido.hasta),
    desde: leido.desde, hasta: leido.hasta, hoy });
  // `it_sin_baja` (db/307) solo cuando la base ya lo admite: con el código subido
  // y la migración sin aplicar, guardarlo rompería la carga entera.
  const casos = await admiteItSinBaja() ? todos : todos.filter(c => c.tipo !== 'it_sin_baja');
  const porTipo = {};
  casos.forEach(c => { porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1; });
  return {
    leido, casos,
    resumen: { periodo: leido.periodo, mes: mesDe(leido.periodo), hoja: leido.hoja, empresa: leido.empresa,
      trabajadores: leido.trabajadores.length, conceptos: leido.conceptos.length, totales: leido.totales, casos: casos.length, porTipo },
  };
}

/** La tarjeta del mes: vence el día del corte (o hoy, si ya pasó). */
async function tarjeta(cli, periodo, n) {
  const titulares = await organizacion.quienes('plantilla_gestoria', { conSuplentes: false }).catch(() => []);
  const corte = Number(await parametros.valor('nomina.dia_corte').catch(() => 25)) || 25;
  const hoy = calendario.hoy();
  const venceEl = `${periodo}-${String(corte).padStart(2, '0')}`;
  const cal = await calendario.de('madrid');
  const plazoDias = venceEl > hoy ? cal.diasHabilesEntre(hoy, venceEl) : 0;
  await tablero.nacer(cli, {
    tipo: TIPO_TARJETA, origenId: periodo, enlace: '/gestoria?vista=proforma', sensible: true,
    titulo: `Revisar la proforma de ${mesDe(periodo)}: ${n} ${n === 1 ? 'caso' : 'casos'}`,
    descripcion: 'Lo que no cuadra entre la proforma de A3 y el ERP. Marca cada caso: corregir en A3, corregir en el ERP o está bien; con los de A3, manda el correo a la gestoría.',
    responsableId: titulares.length ? titulares[0].id : null, plazoDias,
  });
}

async function cerrarTarjetaSiHecha(cli, periodo, autorId) {
  if (await repo.quedanDe(cli, periodo)) return;
  await tablero.cerrarPorOrigen(cli, { tipo: TIPO_TARJETA, origenId: periodo, autorId, nota: 'Revisados todos los casos' });
}

/**
 * Los casos del mes, al día con un cruce: los nuevos entran, los que siguen se
 * refrescan (conservan lo decidido) y los que estaban por decidir y ya no
 * salen se cierran solos. Y la tarjeta. → { nuevos, siguen, cerrados, quedan }
 */
async function sincronizar(cli, { leido, casos, ficheroId, nombre, quien }) {
  const hay = await repo.delMes(cli, leido.periodo);
  let nuevos = 0, siguen = 0, cerrados = 0;
  const vistos = new Set();
  for (const c of casos) {
    if (vistos.has(c.clave)) continue;
    vistos.add(c.clave);
    const ya = hay.get(c.clave);
    if (ya) { await repo.sigue(cli, ya.id, { detalle: c.detalle, nombreA3: c.nombreA3, ficheroId }); siguen++; }
    else { await repo.insertar(cli, { ...c, periodo: leido.periodo, ficheroId }); nuevos++; }
  }
  for (const [clave, x] of hay) {
    if (!vistos.has(clave) && await repo.yaNoSale(cli, x.id, `Ya no sale al cruzar «${nombre}»`)) cerrados++;
  }
  const quedan = await repo.quedanDe(cli, leido.periodo);
  if (quedan) await tarjeta(cli, leido.periodo, quedan);
  else await cerrarTarjetaSiHecha(cli, leido.periodo, quien.usuarioId);
  return { nuevos, siguen, cerrados, quedan };
}

/** Lo de cada trabajador que se guarda con la carga: su código, días, IT, bruto y líquido. */
const porTrabajador = leido => leido.trabajadores.map(t => ({ legajo: t.legajo, dias: t.dias, it: t.it, bruto: t.bruto, liquido: t.liquido }));

/** SUBE LA PROFORMA. Sin `confirmar`, solo dice qué sale. */
async function subir({ base64, nombre, confirmar = false } = {}, quien = {}) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  if (!await repo.hayTabla()) throw error('Falta aplicar la migración db/296 (Migraciones)');
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw error('No ha llegado ningún fichero');
  const nombreFichero = String(nombre || 'proforma.xlsx').slice(0, 255);
  const { leido, casos, resumen } = await analizar(buffer);
  if (!confirmar) {
    let ya = null;
    try { await ficheros.exigirNuevo(TIPO_FICHERO, ficheros.huella(buffer)); } catch (e) { if (e.yaCargado) ya = e.yaCargado; else throw e; }
    return { previa: true, yaCargado: ya, resumen };
  }
  await ficheros.exigirNuevo(TIPO_FICHERO, ficheros.huella(buffer));
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · proforma', accion: 'cambio',
    motivo: `Proforma de ${mesDe(leido.periodo)} «${nombreFichero}»` }, async cli => {
    const ficheroId = await ficheros.apuntar(cli, {
      tipo: TIPO_FICHERO, periodo: leido.periodo, nombre: nombreFichero, buffer,
      estructura: { hoja: leido.hoja, desde: leido.desde, hasta: leido.hasta, empresa: leido.empresa,
        conceptos: leido.conceptos.map(c => ({ codigo: c.codigo, nombre: c.nombre })) },
      // Con la cifra de cada trabajador (26/11/2026): el histórico de su nómina, mes a mes.
      resultado: { ...resumen, trabajadores: porTrabajador(leido) }, incidencias: casos.length, usuarioId: quien.usuarioId,
    });
    return { ficheroId, ...await sincronizar(cli, { leido, casos, ficheroId, nombre: nombreFichero, quien }) };
  });
  await ficheros.guardarOriginal(r.ficheroId, { nombre: nombreFichero, buffer, usuarioId: quien.usuarioId });
  avisarCambio();
  return { previa: false, resumen, ...r };
}

/**
 * VOLVER A CRUZAR la última proforma de un mes con el ERP de ahora (después de
 * poner un legajo, una baja o una suspensión): el original guardado, sin
 * subirlo otra vez. → { nuevos, siguen, cerrados, quedan }
 */
async function recruzar({ periodo } = {}, quien = {}) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) throw error('Elige el mes');
  const carga = await repo.ultimaCarga(periodo);
  if (!carga) throw error(`No hay ninguna proforma de ${mesDe(periodo)} subida`);
  if (!carga.adjunto_id) throw error('No se guardó el original de esa proforma: súbela otra vez');
  const r0 = await adjuntos.servir(carga.adjunto_id, { id: quien.usuarioId, usuarioId: quien.usuarioId, rol: quien.rol }, { descargar: true });
  const trozos = [];
  for await (const t of r0.cuerpo) trozos.push(Buffer.from(t));
  const { leido, casos } = await analizar(Buffer.concat(trozos));
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · proforma', accion: 'cambio',
    motivo: `Proforma de ${mesDe(periodo)} cruzada otra vez con el ERP` },
    async cli => {
      await repo.guardarTrabajadores(cli, carga.id, porTrabajador(leido));
      return sincronizar(cli, { leido, casos, ficheroId: Number(carga.id), nombre: carga.nombre, quien });
    });
  avisarCambio();
  return r;
}

/** LA LISTA: los casos de los últimos meses, con su frase, y las últimas proformas subidas. */
async function lista(quien = {}) {
  await exigir(quien, gestoria.CLAVE_VER);
  const base = { tipos: proforma.TIPOS, decisiones: DECISIONES };
  if (!await repo.hayTabla()) return { filas: [], cargas: [], sinTabla: true, ...base };
  const [filas, cargas] = await Promise.all([repo.lista(),
    ficheros.ultimas(TIPO_FICHERO, { id: quien.usuarioId, usuarioId: quien.usuarioId, rol: quien.rol }, { limite: 6 })]);
  return { filas: filas.map(c => ({ ...c, frase: proforma.frase(c), mes: mesDe(c.periodo) })), cargas: cargas.cargas || [], sinTabla: false, ...base,
    puedeGestionar: await gestoria.puede(quien, gestoria.CLAVE_GESTIONAR) };
}

async function ficha(id, quien = {}) {
  await exigir(quien, gestoria.CLAVE_VER);
  const c = await repo.porId(id);
  if (!c) throw error('Ese caso no existe', 404);
  return { ...c, frase: proforma.frase(c), mes: mesDe(c.periodo) };
}

/** DECIDIR uno o varios: corregir en A3, en el ERP, o está bien (o volver a «por decidir»). */
async function decidir({ ids, decision, nota } = {}, quien = {}) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  if (!['a3', 'erp', 'bien', 'pendiente'].includes(decision)) throw error('Elige qué se hace');
  const lista_ = [...new Set([].concat(ids || []).map(String).filter(x => /^\d+$/.test(x)))];
  if (!lista_.length) throw error('No hay ningún caso marcado');
  const n = String(nota == null ? '' : nota).trim().slice(0, 2000);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · proforma', accion: 'cambio',
    motivo: `${DECISIONES[decision].etiqueta}${n ? `: ${n}` : ''}` }, async cli => {
    const hechos = await repo.decidir(cli, lista_, { decision, nota: n || null, usuarioId: decision === 'pendiente' ? null : quien.usuarioId });
    for (const periodo of new Set(hechos.map(x => x.periodo))) {
      if (decision === 'pendiente') await tarjeta(cli, periodo, await repo.quedanDe(cli, periodo));
      else await cerrarTarjetaSiHecha(cli, periodo, quien.usuarioId);
    }
    return hechos.length;
  });
  avisarCambio();
  return { decididos: r };
}

/** EL CORREO A LA GESTORÍA: los «corregir en A3» sin mandar. → { para, asunto, cuerpo, ids } */
async function correo(quien = {}) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  const filas = (await repo.lista()).filter(c => c.decision === 'a3' && !c.enviada);
  if (!filas.length) return { para: '', asunto: '', cuerpo: '', ids: [] };
  const lineas = ['Hola,', ''];
  for (const periodo of [...new Set(filas.map(c => c.periodo))]) {
    lineas.push(`En la proforma de ${mesDe(periodo)} hemos visto esto, que creemos que hay que corregir:`, '');
    for (const c of filas.filter(x => x.periodo === periodo)) {
      lineas.push(`  - ${c.legajo || 'Sin código'} ${c.nombre_a3 || c.nombre_erp || ''}: ${proforma.frase(c)}.${c.nota ? ` ${c.nota}` : ''}`);
    }
    lineas.push('');
  }
  lineas.push('¿Lo podéis revisar? Gracias.');
  return {
    para: String(await parametros.valor('gestoria.correo').catch(() => '') || ''),
    asunto: `Correcciones de la proforma de ${mesDe(filas[0].periodo)}`, cuerpo: lineas.join('\n'), ids: filas.map(c => c.id),
  };
}

async function marcarEnviadas({ ids } = {}, quien = {}) {
  await exigir(quien, gestoria.CLAVE_GESTIONAR);
  const lista_ = [].concat(ids || []).map(String).filter(x => /^\d+$/.test(x));
  if (!lista_.length) throw error('No hay nada que marcar');
  const n = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · proforma', accion: 'cambio', motivo: 'Correo de la proforma a la gestoría' },
    cli => repo.marcarEnviadas(cli, lista_, quien.usuarioId));
  avisarCambio();
  return { marcadas: n };
}

// ── El número de la pestaña: los casos por decidir ─────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('proforma'); }
contadores.registrarFuente('proforma', {
  async contar(q) {
    const ve = q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(gestoria.CLAVE_VER)));
    if (!ve) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.pendientes() : 0)) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const n = await cuenta.valor;
    return { 'gestoria.proforma': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'caso' : 'casos'} de la proforma por decidir` } };
  },
});

module.exports = { analizar, subir, recruzar, lista, ficha, decidir, correo, marcarEnviadas, DECISIONES, TIPO_FICHERO, TIPO_TARJETA };
