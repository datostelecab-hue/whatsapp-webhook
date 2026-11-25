// ============================================================
// LA PLANTILLA DE LA GESTORÍA — LA PUERTA (módulo 8, db/287, 25/11/2026)
// ============================================================
// Módulo 8 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md). Camilo:
// «Sí, arranca el módulo 8 con la proforma».
//
//   · SUBIR EL LISTADO: el de la gestoría (la proforma de A3NOM o, cuando
//     llegue, el de plantilla en alta), en .xls o .xlsx. Primero se enseña qué
//     sale; al confirmarlo se apunta la carga (ficheros importados: el mismo
//     fichero no entra dos veces) y se sincronizan las discrepancias.
//   · LAS DISCREPANCIAS (modules/Gestoria/listado.js): viven hasta que alguien
//     las resuelve o las descarta; si dejan de salir en un listado nuevo, se
//     resuelven solas diciendo con cuál. Una viva por discrepancia. Una
//     DESCARTADA no vuelve a salir (alguien decidió que no es un problema);
//     una RESUELTA sí, si vuelve a pasar.
//   · RESOLVER: a mano con su nota, o poniendo el legajo de la gestoría en la
//     ficha (legajo desconocido o cambiado). Todo al libro de auditoría.
//   · EL CORREO A LA GESTORÍA: el texto con lo que tienen que corregir ellos
//     (bajas sin tramitar, altas que no tienen, gente que para nosotros es de
//     ETT o se fue), para copiarlo o abrirlo en el correo; se apunta que se envió.
//   · LA TARJETA DE LOS LUNES: a las 08:00, a quien tenga la función
//     «plantilla_gestoria» (Organización), con vencimiento ese día; se cierra
//     sola al subir un listado. Si vence, avisa (tablero.vencidas: a Ignacio).
'use strict';

const repo = require('./gestoria.repo');
const listado = require('./listado');
const libro = require('../../services/libro');
const ficheros = require('../../services/ficherosImportados');
const parametros = require('../../services/parametros');
const permisos = require('../../services/permisos');
const contadores = require('../../services/contadores');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const tareasProgramadas = require('../../services/tareasProgramadas');

const TIPO_FICHERO = 'plantilla_gestoria';
const TIPO_TARJETA = 'gestoria_plantilla';
const CLAVE_VER = '/gestoria';
const CLAVE_GESTIONAR = '/gestoria/gestionar';
const TOTAL = ['superadmin', 'desarrollador'];

const TIPOS = {
  alta_gestoria_baja_nuestra: { etiqueta: 'En la gestoría y de baja con nosotros', tono: 'red', gestoria: true },
  alta_nuestra_no_gestoria: { etiqueta: 'De alta con nosotros y no en la gestoría', tono: 'red', gestoria: true },
  legajo_cambiado: { etiqueta: 'Legajo cambiado', tono: 'warn' },
  legajo_desconocido: { etiqueta: 'Legajo que no está en el ERP', tono: 'warn' },
  nombre_distinto: { etiqueta: 'El legajo es de otra persona', tono: 'warn' },
  sin_legajo: { etiqueta: 'Sin legajo', tono: 'muted' },
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** ¿Puede mirar / gestionar? Por su llave (o su rol, si lo ve todo). */
async function puede(quien, clave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol)) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(clave); } catch (_) { return false; }
}
const exigir = async (quien, clave) => { if (!await puede(quien, clave)) throw error('No tienes permiso para esto', 403); };

ficheros.registrarTipo(TIPO_FICHERO, {
  etiqueta: 'Listado de plantilla de la gestoría',
  ver: async q => puede({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol }, CLAVE_VER),
});

/** Lee e interpreta el fichero, y lo cruza. → { leido, discrepancias, resumen } */
async function analizar(buffer) {
  const leido = listado.interpretar(await listado.hojasDe(buffer));
  if (!leido.fecha) throw error('No encuentro la fecha del listado (la «FECHA:» de arriba)');
  if (!leido.trabajadores.length) throw error('El listado no trae ningún trabajador');
  const discrepancias = listado.cruzar({ trabajadores: leido.trabajadores, personas: await repo.personas(), fecha: leido.fecha, tipo: leido.tipo });
  const porTipo = {};
  discrepancias.forEach(d => { porTipo[d.tipo] = (porTipo[d.tipo] || 0) + 1; });
  return {
    leido, discrepancias,
    resumen: {
      tipo: leido.tipo, hoja: leido.hoja, fecha: leido.fecha, empresa: leido.empresa,
      trabajadores: leido.trabajadores.length, conceptos: leido.conceptos.length, avisos: leido.avisos,
      discrepancias: discrepancias.length, porTipo,
    },
  };
}

/** El lunes de la semana de una fecha (el periodo de la tarjeta). */
const lunesDe = iso => calendario.sumarDias(iso, 1 - calendario.diaSemana(iso));

/**
 * SUBE EL LISTADO. Sin `confirmar`, solo dice qué sale. Con él: apunta la
 * carga, crea las discrepancias nuevas, refresca las que siguen, resuelve las
 * que ya no salen y cierra la tarjeta de la semana.
 */
async function subir({ base64, nombre, confirmar = false } = {}, quien = {}) {
  await exigir(quien, CLAVE_GESTIONAR);
  if (!await repo.hayTabla()) throw error('Falta aplicar la migración db/287 (Migraciones)');
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw error('No ha llegado ningún fichero');
  const nombreFichero = String(nombre || 'listado-gestoria.xls').slice(0, 255);
  const { leido, discrepancias, resumen } = await analizar(buffer);
  if (!confirmar) {
    let ya = null;
    try { await ficheros.exigirNuevo(TIPO_FICHERO, ficheros.huella(buffer)); } catch (e) { if (e.yaCargado) ya = e.yaCargado; else throw e; }
    return { previa: true, yaCargado: ya, resumen };
  }
  await ficheros.exigirNuevo(TIPO_FICHERO, ficheros.huella(buffer));
  const periodo = leido.tipo === 'proforma' ? leido.fecha.slice(0, 7) : leido.fecha;
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria', accion: 'cambio',
    motivo: `Listado de la gestoría «${nombreFichero}» (${dmy(leido.fecha)})` }, async cli => {
    const ficheroId = await ficheros.apuntar(cli, {
      tipo: TIPO_FICHERO, periodo, nombre: nombreFichero, buffer,
      estructura: { hoja: leido.hoja, tipo: leido.tipo, filaCabecera: leido.filaCabecera, empresa: leido.empresa, fecha: leido.fecha,
        conceptos: leido.conceptos.map(c => ({ codigo: c.codigo, nombre: c.nombre })) },
      resultado: resumen, incidencias: discrepancias.length, usuarioId: quien.usuarioId,
    });
    const vivas = await repo.vivas(cli);
    const descartadas = await repo.descartadas(cli);
    let nuevas = 0, siguen = 0, resueltas = 0, ignoradas = 0;
    const vistas = new Set();
    for (const d of discrepancias) {
      if (vistas.has(d.clave)) continue;
      vistas.add(d.clave);
      const id = vivas.get(d.clave);
      if (id) { await repo.sigue(cli, id, { detalle: d.detalle, nombreGestoria: d.nombreGestoria, ficheroId }); siguen++; }
      else if (descartadas.has(d.clave)) ignoradas++;   // la descartó alguien: no vuelve
      else { await repo.insertar(cli, { ...d, ficheroId }); nuevas++; }
    }
    for (const [clave, id] of vivas) {
      if (vistas.has(clave)) continue;
      if (await repo.cerrar(cli, id, { estado: 'resuelta', nota: `Ya no sale en el listado de la gestoría del ${dmy(leido.fecha)}` })) resueltas++;
    }
    // La tarjeta de esta semana (y la de la anterior, si seguía abierta): hecha.
    const hoy = calendario.hoy();
    for (const semana of [lunesDe(hoy), calendario.sumarDias(lunesDe(hoy), -7)]) {
      await tablero.cerrarPorOrigen(cli, { tipo: TIPO_TARJETA, origenId: semana, autorId: quien.usuarioId,
        nota: `Subido el listado «${nombreFichero}»` });
    }
    return { ficheroId, nuevas, siguen, resueltas, ignoradas };
  });
  await ficheros.guardarOriginal(r.ficheroId, { nombre: nombreFichero, buffer, usuarioId: quien.usuarioId });
  avisarCambio();
  return { previa: false, resumen, ...r };
}

/** El coste estimado de una discrepancia, con el parámetro (0: no se calcula). */
function conCoste(d, costeDia) {
  const dias = d.tipo === 'alta_gestoria_baja_nuestra' && d.detalle ? Number(d.detalle.dias) || 0 : 0;
  return { ...d, coste: costeDia > 0 && dias ? Math.round(dias * costeDia * 100) / 100 : null };
}

/** LA LISTA: las discrepancias (pendientes, y las cerradas de 90 días), con su coste y las últimas cargas. */
async function lista(quien = {}) {
  await exigir(quien, CLAVE_VER);
  if (!await repo.hayTabla()) return { filas: [], cargas: [], sinTabla: true, tipos: TIPOS };
  const costeDia = Number(await parametros.valor('gestoria.coste_ss_dia').catch(() => 0)) || 0;
  const [filas, cargas] = await Promise.all([repo.lista(), ficheros.ultimas(TIPO_FICHERO, { id: quien.usuarioId, usuarioId: quien.usuarioId, rol: quien.rol }, { limite: 8 })]);
  return {
    filas: filas.map(d => conCoste(d, costeDia)), cargas: cargas.cargas || [], sinTabla: false, tipos: TIPOS, costeDia,
    puedeGestionar: await puede(quien, CLAVE_GESTIONAR),
  };
}

async function ficha(id, quien = {}) {
  await exigir(quien, CLAVE_VER);
  const d = await repo.porId(id);
  if (!d) throw error('Esa discrepancia no existe', 404);
  const costeDia = Number(await parametros.valor('gestoria.coste_ss_dia').catch(() => 0)) || 0;
  return conCoste(d, costeDia);
}

/** RESOLVER o DESCARTAR a mano, con su nota (descartar la exige). */
async function cerrar(id, { estado, nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_GESTIONAR);
  if (!['resuelta', 'descartada'].includes(estado)) throw error('Se resuelve o se descarta');
  const n = String(nota == null ? '' : nota).trim().slice(0, 2000);
  if (estado === 'descartada' && n.length < 3) throw error('Para descartarla, di por qué');
  const ok = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria', accion: estado === 'resuelta' ? 'resolucion' : 'anulacion', motivo: n || null },
    cli => repo.cerrar(cli, id, { estado, nota: n || null, usuarioId: quien.usuarioId }));
  if (!ok) throw error('Ya estaba cerrada');
  avisarCambio();
  return { ok: true };
}

/**
 * PONER EL LEGAJO DE LA GESTORÍA en una ficha (un legajo que el ERP no tiene,
 * o el de alguien a quien se lo cambiaron) y dar la discrepancia por resuelta.
 */
async function ponerLegajo(id, { conductorId } = {}, quien = {}) {
  await exigir(quien, CLAVE_GESTIONAR);
  const d = await repo.porId(id);
  if (!d || d.estado !== 'pendiente') throw error('Esa discrepancia ya no está pendiente');
  if (!['legajo_desconocido', 'legajo_cambiado'].includes(d.tipo)) throw error('Aquí no hay ningún legajo que poner');
  const destino = d.tipo === 'legajo_cambiado' ? d.conductor_id : String(conductorId || '');
  if (!/^\d+$/.test(destino)) throw error('Elige a qué ficha va el legajo');
  const legajos = require('../Conductores/legajos.service');
  const antes = await legajos.asignar(destino, d.legajo, quien);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria', accion: 'resolucion' },
    cli => repo.cerrar(cli, id, { estado: 'resuelta', usuarioId: quien.usuarioId,
      nota: `Legajo ${d.legajo} puesto en la ficha ${destino}${antes ? ` (antes tenía el ${antes})` : ''}` }));
  avisarCambio();
  return { ok: true, legajo: d.legajo, conductorId: destino };
}

/**
 * EL CORREO A LA GESTORÍA: lo que tienen que corregir ellos, pendiente y con
 * su texto. → { para, asunto, cuerpo, ids }
 */
async function correo(quien = {}) {
  await exigir(quien, CLAVE_GESTIONAR);
  const filas = (await repo.lista()).filter(d => d.estado === 'pendiente');
  const bajas = filas.filter(d => d.tipo === 'alta_gestoria_baja_nuestra');
  const altas = filas.filter(d => d.tipo === 'alta_nuestra_no_gestoria');
  const raras = filas.filter(d => d.tipo === 'legajo_desconocido' && d.detalle && d.detalle.propuesta
    && ['de ETT', 'de baja'].includes(d.detalle.propuesta.situacion));
  const lineas = ['Hola,', '', 'Al cruzar vuestro último listado con nuestra plantilla nos salen estas diferencias:', ''];
  if (bajas.length) {
    lineas.push('Siguen en vuestro listado y causaron baja con nosotros (por favor, tramitad la baja):');
    bajas.forEach(d => lineas.push(`  - ${d.legajo} ${d.nombre_gestoria || d.nombre_erp}: baja el ${dmy(d.detalle && d.detalle.baja)}`));
    lineas.push('');
  }
  if (altas.length) {
    lineas.push('Están de alta con nosotros y no aparecen en vuestro listado (¿se tramitó el alta?):');
    altas.forEach(d => lineas.push(`  - ${d.legajo} ${d.nombre_erp}${d.dni_nie ? `, ${d.dni_nie}` : ''}: alta el ${dmy(d.detalle && d.detalle.alta)}`));
    lineas.push('');
  }
  if (raras.length) {
    lineas.push('Aparecen en vuestro listado y para nosotros no son plantilla propia en alta:');
    raras.forEach(d => lineas.push(`  - ${d.legajo} ${d.nombre_gestoria}: para nosotros está ${d.detalle.propuesta.situacion === 'de ETT' ? 'contratado por ETT' : 'de baja'}`));
    lineas.push('');
  }
  const ids = [...bajas, ...altas, ...raras].map(d => d.id);
  if (!ids.length) return { para: '', asunto: '', cuerpo: '', ids: [] };
  lineas.push('Gracias.');
  return {
    para: String(await parametros.valor('gestoria.correo').catch(() => '') || ''),
    asunto: 'Correcciones de la plantilla', cuerpo: lineas.join('\n'), ids,
  };
}

/** Apunta que se mandó el correo con esas discrepancias. */
async function marcarEnviadas({ ids } = {}, quien = {}) {
  await exigir(quien, CLAVE_GESTIONAR);
  const lista_ = [].concat(ids || []).map(String).filter(x => /^\d+$/.test(x));
  if (!lista_.length) throw error('No hay nada que marcar');
  const n = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria', accion: 'cambio', motivo: 'Correo de correcciones a la gestoría' },
    cli => repo.marcarEnviadas(cli, lista_, quien.usuarioId));
  return { marcadas: n };
}

// ── El número del menú: las pendientes ─────────────────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('gestoria'); }
contadores.registrarFuente('gestoria', {
  async contar(q) {
    const ve = q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(CLAVE_VER)));
    if (!ve) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.lista() : [])).then(f => {
        const p = f.filter(d => d.estado === 'pendiente');
        return { n: p.length, graves: p.filter(d => TIPOS[d.tipo] && TIPOS[d.tipo].gestoria).length };
      }) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const { n, graves } = await cuenta.valor;
    return { 'gestoria.pendientes': { n, tono: graves ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'diferencia' : 'diferencias'} con la gestoría por resolver` } };
  },
});

// ── La tarjeta de los lunes ────────────────────────────────────────────────
tablero.registrarTipo(TIPO_TARJETA, { etiqueta: 'Listado de la gestoría', abrir: 'Subir el listado' });

/** Crea la tarjeta de la semana (`periodo` = su lunes) a quien tenga la función. */
async function tarjetaDelLunes({ periodo, cli }) {
  const titulares = await organizacion.quienes('plantilla_gestoria', { conSuplentes: false }).catch(() => []);
  await libro.firmar(cli, { origen: 'gestoria · lunes', accion: 'alta' });
  const r = await tablero.nacer(cli, {
    tipo: TIPO_TARJETA, origenId: periodo, enlace: '/gestoria',
    titulo: `Pedir a la gestoría el listado de plantilla en alta y subirlo (semana del ${dmy(periodo)})`,
    descripcion: 'Pídele a la gestoría el listado de plantilla en alta al cierre de la semana pasada (o el ITA) y súbelo en «Plantilla de la gestoría». La tarjeta se cierra sola al subirlo.',
    responsableId: titulares.length ? titulares[0].id : null, plazoDias: 0,
  });
  return { tarjeta: r.id, nueva: r.nueva };
}

tareasProgramadas.registrar({
  clave: 'gestoria.tarjeta_lunes',
  descripcion: 'Cada lunes, la tarjeta de pedir y subir el listado de plantilla de la gestoría',
  desde: '2026-11-30',
  toca: ahora => tareasProgramadas.cuando.semanal(ahora, { dia: 1, hora: '08:00' }),
  hacer: tarjetaDelLunes,
});

module.exports = {
  subir, analizar, lista, ficha, cerrar, ponerLegajo, correo, marcarEnviadas, tarjetaDelLunes, puede,
  TIPOS, TIPO_TARJETA, TIPO_FICHERO, CLAVE_VER, CLAVE_GESTIONAR,
};
