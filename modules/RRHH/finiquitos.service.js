// ============================================================
// LOS FINIQUITOS — LA PUERTA (módulo 7, db/291, 25/11/2026)
// ============================================================
// Módulo 7 del plan de RR. HH. y nóminas. El encargo: «El resumen de cierre
// incluye siempre vacaciones netas, el 100% de la recaudación pendiente,
// descuentos y bonus pendientes, cada uno con su soporte. Tras la aprobación,
// se dispara solo el envío a firma y el aviso a la gestoría».
//
// Decidido por Camilo el 25/11/2026: nace AL DAR LA BAJA, de plantilla propia
// (va a la gestoría) y de ETT (va a la agencia); Diana revisa e Ignacio aprueba;
// las vacaciones, en días.
//
// NO SE CALCULA NADA APARTE. Cada concepto sale del módulo que ya lo cuenta,
// para que el finiquito no diga algo distinto de la pantalla de cada uno:
//   · VACACIONES NETAS: el saldo de Vacaciones a la fecha de baja (días). Las
//     de ETT las liquida la agencia.
//   · RECAUDACIÓN PENDIENTE (100 %): lo que debe en Recaudación, con su extracto.
//   · VARIABLES Y BONUS PENDIENTES: las «Extras pendientes» de Nóminas (los dos
//     meses que se van sin pagar), con su Excel.
//   · OTROS DESCUENTOS (26/11/2026): los de Descuentos en nómina (db/298) que
//     le quedan por descontar: km, siniestro, combustible u otro, APROBADOS o
//     aplazados, por su saldo. Los que están por aprobar se enseñan, pero no
//     entran (lo mismo que en el lienzo: «ningún descuento sin aprobación»).
//     El efectivo no: ya va entero en la recaudación pendiente.
//
// EL CAMINO: borrador → revisado (Diana) → aprobado (Ignacio) → enviado (solo:
// el PDF y el Excel por correo a la gestoría o a la ETT; sin correo en
// Parámetros, se manda a mano y se marca) → firmado (con el firmado adjunto,
// mientras no esté la firma digital del módulo 6). Mientras no está aprobado se
// puede recalcular; aprobado, la foto ya no cambia.
'use strict';

const repo = require('./finiquitos.repo');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const parametros = require('../../services/parametros');
const contadores = require('../../services/contadores');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const adjuntos = require('../../services/adjuntos');
const tareasProgramadas = require('../../services/tareasProgramadas');

// Nacen solos los de las bajas desde aquí (25/11/2026). Las de antes se
// preparan a mano desde la ficha: muchas ya se liquidaron por el camino de siempre.
const DESDE = '2026-11-25';
const CLAVE_VER = '/finiquitos';
const CLAVE_REVISAR = '/finiquitos/revisar';
const CLAVE_APROBAR = '/finiquitos/aprobar';
const TOTAL = ['superadmin', 'desarrollador'];
const T_REVISAR = 'finiquito_revisar';
const T_APROBAR = 'finiquito_aprobar';
const DUENO = 'finiquito';

const ESTADOS = {
  borrador: { etiqueta: 'Por revisar', tono: 'warn' },
  revisado: { etiqueta: 'Por aprobar', tono: 'warn' },
  aprobado: { etiqueta: 'Aprobado, sin enviar', tono: 'red' },
  enviado: { etiqueta: 'Enviado, sin firmar', tono: 'azul' },
  firmado: { etiqueta: 'Firmado', tono: 'green' },
  anulado: { etiqueta: 'Anulado', tono: 'muted' },
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const texto = v => String(v == null ? '' : v).trim().slice(0, 2000);

async function puede(quien, llave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol) && llave === CLAVE_VER) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(llave); } catch (_) { return false; }
}
const exigir = async (quien, llave, que) => {
  if (!await puede(quien, llave)) throw error(que || 'No tienes permiso para esto', 403);
};

// ── El resumen de cierre ───────────────────────────────────────────────────
// Cada concepto: { clave, titulo, cantidad, unidad, importe (con signo: + a su
// favor, − a descontar), soporte: [líneas], error }. Si una fuente falla, el
// concepto sale con su error y el resto sigue: el finiquito no se pierde por uno.
async function concepto(clave, titulo, fn) {
  try { return { clave, titulo, ...(await fn()) }; }
  catch (e) { return { clave, titulo, error: e.message, soporte: [] }; }
}

/** Lo que le queda por descontar en Descuentos en nómina (db/298), sin el efectivo. */
async function descuentosPendientes(conductorId) {
  const db = require('../../services/db');
  const hay = (await db.consulta(`SELECT to_regclass('public.descuento_nomina') IS NOT NULL AS hay`)).rows[0].hay;
  if (!hay) return { cuentan: [], porAprobar: [], efectivo: false };
  const r = await db.consulta(
    `SELECT origen, estado, periodo, saldo::float AS saldo, motivo FROM descuento_nomina
      WHERE conductor_id = $1 AND estado IN ('pendiente', 'aprobado', 'aplazado') AND saldo > 0
      ORDER BY periodo, id`, [conductorId]);
  const { ORIGENES } = require('./descuentos.service');
  const filas = r.rows.map(x => ({ ...x, etiqueta: (ORIGENES[x.origen] || {}).etiqueta || x.origen }));
  return {
    cuentan: filas.filter(x => x.origen !== 'efectivo' && ['aprobado', 'aplazado'].includes(x.estado)),
    porAprobar: filas.filter(x => x.origen !== 'efectivo' && x.estado === 'pendiente'),
    efectivo: filas.some(x => x.origen === 'efectivo'),
  };
}

async function calcularResumen(p) {
  const id = Number(p.conductor_id);
  const esEtt = p.tipo === 'ett';
  const vacaciones = await concepto('vacaciones', 'Vacaciones netas', async () => {
    if (esEtt) return { noAplica: true, soporte: ['Las vacaciones de quien viene de ETT las liquida la agencia.'] };
    const v = await require('../Vacaciones/vacaciones.service').ficha(id);
    return {
      cantidad: r2(v.saldo), unidad: 'días',
      soporte: [
        `Generadas hasta la baja: ${r2(v.generadas)} días`,
        `Festivos trabajados que suman: ${v.festivosSuman || 0}`,
        `Disfrutadas: ${r2(v.disfrutadas)} días`,
        `Saldo a la fecha de baja: ${r2(v.saldo)} días (el importe lo pone la gestoría)`,
      ],
    };
  });
  const recaudacion = await concepto('recaudacion', 'Recaudación pendiente (100 %)', async () => {
    const x = await require('../Administracion/recaudacion.service').extractoDe(id);
    const pend = r2(x.pendiente);
    return {
      importe: pend > 0 ? -pend : (pend < 0 ? -pend : 0), unidad: '€',
      soporte: [
        `Efectivo cobrado de BOLT desde junio de 2026: ${r2(x.cobrado)} €`,
        `Entregado (en mano, nómina, transferencia, remesas): ${r2(x.entregado)} €`,
        ...(x.dado ? [`Cambio y devoluciones que se le dieron: ${r2(x.dado)} €`] : []),
        ...(x.saldoInicial ? [`Saldo de partida: ${r2(x.saldoInicial)} €`] : []),
        pend > 0 ? `Debe ${pend} €: se descuenta entero.` : pend < 0 ? `La casa le debe ${-pend} €.` : 'No debe nada.',
      ],
    };
  });
  const variables = await concepto('variables', 'Variables y bonus pendientes', async () => {
    const f = await require('../Nominas/nominas.service').finiquito(id);
    return {
      importe: r2(f.total), unidad: '€',
      soporte: f.meses.map(m => `${m.etiqueta}${m.enCurso ? ' (en curso)' : ''}: ${r2(m.fila ? m.fila.total : 0)} €`
        + `${m.esMesDeLaBaja ? `, ${m.diasDeAlta} días de alta` : ''}`)
        .concat(['El detalle día a día, en el Excel «Extras pendientes».']),
    };
  });
  const otros = await concepto('otros', 'Otros descuentos (km, siniestros, combustible)', async () => {
    const d = await descuentosPendientes(id);
    const linea = x => `${x.etiqueta} · nómina de ${x.periodo} · ${r2(x.saldo)} €${x.motivo ? ` (${x.motivo})` : ''}`;
    return {
      importe: d.cuentan.length ? -r2(d.cuentan.reduce((s, x) => s + x.saldo, 0)) : 0, unidad: '€',
      soporte: [
        ...(d.cuentan.length ? d.cuentan.map(x => `${linea(x)}: ${x.estado === 'aplazado' ? 'aplazado, queda este saldo' : 'aprobado'}`) : ['Ningún descuento aprobado pendiente.']),
        ...d.porAprobar.map(x => `${linea(x)}: POR APROBAR, no entra hasta que se apruebe en Descuentos`),
        ...(d.efectivo ? ['El efectivo sin entregar va entero en la recaudación pendiente: aquí no se cuenta dos veces.'] : []),
      ],
    };
  });
  const conceptos = [vacaciones, recaudacion, variables, otros];
  const aFavor = r2(conceptos.reduce((s, c) => s + (c.importe > 0 ? c.importe : 0), 0));
  const aDescontar = r2(conceptos.reduce((s, c) => s + (c.importe < 0 ? -c.importe : 0), 0));
  return {
    persona: {
      nombre: p.nombre, nombreSs: p.nombre_ss || '', dni: p.dni_nie || '', legajo: p.legajo || '',
      tipo: p.tipo, ett: p.ett_nombre || '', alta: p.alta, baja: p.baja, antiguedad: p.antiguedad || '',
      motivoBaja: p.motivo_baja || '', jornada: p.jornada_horas || null,
    },
    destino: esEtt ? `la ETT${p.ett_nombre ? ` (${p.ett_nombre})` : ''}` : 'la gestoría',
    conceptos, totales: { aFavor, aDescontar, neto: r2(aFavor - aDescontar), vacacionesDias: vacaciones.cantidad ?? null },
    errores: conceptos.filter(c => c.error).length,
    calculado: new Date().toISOString(),
  };
}

// ── Nacer y recalcular ─────────────────────────────────────────────────────
tablero.registrarTipo(T_REVISAR, { etiqueta: 'Finiquito por revisar', abrir: 'Revisar el finiquito', cierreManual: false });
tablero.registrarTipo(T_APROBAR, { etiqueta: 'Finiquito por aprobar', abrir: 'Aprobar el finiquito', cierreManual: false });

async function tarjetaRevisar(cli, id, p) {
  const titulares = await organizacion.quienes('finiquitos_revisar', { conSuplentes: false }).catch(() => []);
  await tablero.nacer(cli, {
    tipo: T_REVISAR, origenId: String(id), enlace: `/finiquitos#${id}`, sensible: true,
    titulo: `Revisar el finiquito de ${p.nombre} (baja el ${dmy(p.baja)})`,
    descripcion: 'Comprueba las vacaciones, la recaudación y las variables con su soporte, y márcalo revisado para que se apruebe.',
    responsableId: titulares.length ? titulares[0].id : null, plazoDias: 2,
  });
}

/**
 * PREPARA el finiquito de una baja (la última que ya llegó, o la de `fechaBaja`).
 * Si ya existe y no está aprobado, lo recalcula y vuelve a «por revisar».
 * `quien` vacío = lo hace el sistema al dar la baja. → { id, nuevo }
 */
async function preparar(conductorId, { fechaBaja = null } = {}, quien = {}) {
  if (quien.usuarioId) await exigir(quien, CLAVE_REVISAR, 'Preparar un finiquito es de quien los revisa');
  if (!await repo.hayTabla()) throw error('Falta aplicar la migración db/291 en Migraciones');
  const p = await repo.bajaDe(Number(conductorId), fechaBaja);
  if (!p) throw error('Esta persona no tiene ninguna baja que ya haya llegado: el finiquito es de quien se va');
  const resumen = await calcularResumen(p);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio',
    motivo: quien.usuarioId ? 'Finiquito preparado a mano' : 'Finiquito preparado al dar la baja' }, async cli => {
    const ya = await repo.deBaja(cli, p.conductor_id, p.baja);
    if (ya && !['borrador', 'revisado'].includes(ya.estado)) {
      throw error(`Este finiquito ya está «${ESTADOS[ya.estado].etiqueta.toLowerCase()}»: no se recalcula.`, 409);
    }
    const id = ya ? ya.id : await repo.insertar(cli, { conductorId: p.conductor_id, periodoId: p.periodo_id,
      fechaBaja: p.baja, tipo: p.tipo, ettNombre: p.ett_nombre, resumen });
    if (ya) {
      await repo.recalcular(cli, id, resumen);
      await tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: String(id), autorId: quien.usuarioId || null, nota: 'Se recalculó: vuelve a revisión' });
    }
    await tarjetaRevisar(cli, id, p);
    return { id, nuevo: !ya };
  });
  avisarCambio();
  return r;
}

/**
 * Al dar la baja (Plantilla, la baja programada que llega): nace solo. No
 * lanza: un finiquito que no se pudo preparar no puede deshacer una baja; lo
 * recoge el repaso diario.
 */
async function alDarLaBaja(conductorId) {
  try { return await preparar(conductorId, {}, {}); }
  catch (e) { console.error(`❌ [Finiquitos] no se pudo preparar el de ${conductorId}: ${e.message}`); return null; }
}

tareasProgramadas.registrar({
  clave: 'finiquitos.preparar',
  descripcion: 'Cada día a las 07:00, los finiquitos de las bajas que se quedaron sin preparar',
  desde: '2026-11-26',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '07:00' }),
  hacer: async () => {
    if (!await repo.hayTabla()) return { preparados: 0 };
    let n = 0;
    for (const b of await repo.bajasSinFiniquito(DESDE)) {
      try { await preparar(b.conductor_id, { fechaBaja: b.baja }, {}); n++; }
      catch (e) { console.error(`❌ [Finiquitos] repaso: ${b.conductor_id} ${b.baja}: ${e.message}`); }
    }
    return { preparados: n };
  },
});

// ── Revisar, aprobar, enviar, firmar ──────────────────────────────────────
async function cargar(cli, id) {
  const f = await repo.porId(String(id), cli);
  if (!f) throw error('No existe ese finiquito', 404);
  return f;
}

/** Diana: revisado. Nace la tarjeta de aprobarlo. */
async function revisar(id, { nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_REVISAR, 'Revisar finiquitos es de quien tiene la llave «Finiquitos · revisar»');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio', motivo: `Revisado${texto(nota) ? `: ${texto(nota)}` : ''}` }, async cli => {
    const f = await cargar(cli, id);
    if (f.estado !== 'borrador') throw error(`Está «${ESTADOS[f.estado].etiqueta.toLowerCase()}»: solo se revisa el que está por revisar`, 409);
    if (f.resumen && f.resumen.errores) throw error('Hay conceptos que no se pudieron calcular: recalcúlalo antes de darlo por revisado', 409);
    await repo.cambiar(cli, f.id, { estado: 'revisado', revisado_at: 'now', revisado_por: quien.usuarioId, nota: texto(nota) || f.nota });
    await tablero.cerrarPorOrigen(cli, { tipo: T_REVISAR, origenId: f.id, autorId: quien.usuarioId, nota: 'Revisado' });
    const aprobadores = await repo.conLlave(CLAVE_APROBAR);
    await tablero.nacer(cli, {
      tipo: T_APROBAR, origenId: f.id, enlace: `/finiquitos#${f.id}`, sensible: true,
      titulo: `Aprobar el finiquito de ${f.nombre} (baja el ${dmy(f.fecha_baja)})`,
      descripcion: `Revisado. Al aprobarlo se le manda solo a ${f.resumen.destino}.`,
      responsableId: aprobadores[0] || null, plazoDias: 2,
    });
    return { estado: 'revisado' };
  });
  avisarCambio();
  return r;
}

/** Ignacio devuelve uno revisado a revisión, con su motivo. */
async function devolver(id, { nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Devolver un finiquito es de quien los aprueba');
  const n = texto(nota);
  if (n.length < 3) throw error('Di qué hay que mirar otra vez');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio', motivo: `Devuelto a revisión: ${n}` }, async cli => {
    const f = await cargar(cli, id);
    if (f.estado !== 'revisado') throw error('Solo se devuelve el que está por aprobar', 409);
    await repo.cambiar(cli, f.id, { estado: 'borrador', revisado_at: null, revisado_por: null, nota: `Devuelto: ${n}` });
    await tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: f.id, autorId: quien.usuarioId, nota: `Devuelto: ${n}` });
    const p = { nombre: f.nombre, baja: f.fecha_baja };
    await tarjetaRevisar(cli, f.id, p);
    return { estado: 'borrador' };
  });
  avisarCambio();
  return r;
}

async function correoDestino(f) {
  const clave = f.tipo === 'ett' ? 'finiquitos.correo_ett' : 'gestoria.correo';
  try { return String(await parametros.valor(clave) || '').trim(); } catch (_) { return ''; }
}

/** El PDF del resumen y el Excel de las extras pendientes. */
async function ficheros(f) {
  const pdf = await require('./finiquitos.pdf').generar(f);
  const nombre = `Finiquito - ${f.nombre} - baja ${dmy(f.fecha_baja).replace(/\//g, '-')}`;
  let excel = null;
  try {
    const n = await require('../Nominas/nominas.service').finiquito(Number(f.conductor_id));
    const x = require('../Nominas/nominas.excel');
    excel = { nombre: x.nombreFicheroFiniquito(n), bytes: Buffer.from(await x.generarExcelFiniquito(n)) };
  } catch (_) { /* sin variables: va el PDF solo */ }
  return { pdf: { nombre: `${nombre}.pdf`, bytes: Buffer.from(pdf) }, excel };
}

/** Manda el aviso con el PDF y el Excel. → { enviado, a, motivo } */
async function avisar(f) {
  const a = await correoDestino(f);
  if (!a) return { enviado: false, motivo: f.tipo === 'ett' ? 'Falta el correo de la ETT en Parámetros' : 'Falta el correo de la gestoría en Parámetros' };
  const { pdf, excel } = await ficheros(f);
  const t = f.resumen.totales || {};
  const cuerpo = [
    `Buenos días:`, '',
    `Os pasamos el finiquito de ${f.resumen.persona.nombreSs || f.nombre}${f.legajo ? ` (legajo ${f.legajo})` : ''}${f.dni_nie ? `, ${f.dni_nie}` : ''}, con baja el ${dmy(f.fecha_baja)}${f.resumen.persona.motivoBaja ? ` (${f.resumen.persona.motivoBaja})` : ''}.`, '',
    ...(t.vacacionesDias != null ? [`- Vacaciones pendientes: ${t.vacacionesDias} días.`] : []),
    ...f.resumen.conceptos.filter(c => c.importe).map(c => `- ${c.titulo}: ${c.importe > 0 ? '' : '−'}${Math.abs(c.importe).toFixed(2).replace('.', ',')} €.`),
    '', 'En el PDF va el resumen con el soporte de cada concepto; en el Excel, las variables día a día.', '',
    'Un saludo,', 'RR. HH. de Telecab',
  ].join('\n');
  const r = await require('../../services/correo').enviarCorreo({
    to: a, subject: `Finiquito: ${f.resumen.persona.nombreSs || f.nombre} (baja ${dmy(f.fecha_baja)})`, text: cuerpo,
    attachments: [{ filename: pdf.nombre, content: pdf.bytes }, ...(excel ? [{ filename: excel.nombre, content: excel.bytes }] : [])],
  });
  return r.enviado ? { enviado: true, a } : { enviado: false, a, motivo: r.motivo || 'No se pudo mandar el correo' };
}

/**
 * Ignacio: aprobado. Se guarda el PDF en sus documentos y se avisa solo a la
 * gestoría o a la ETT. Si el correo no sale, queda aprobado y lo dice.
 */
async function aprobar(id, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aprobar finiquitos es de quien tiene la llave «Finiquitos · aprobar»');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio', motivo: 'Aprobado' }, async cli => {
    const f = await cargar(cli, id);
    if (f.estado !== 'revisado') throw error('Solo se aprueba el que está revisado', 409);
    await repo.cambiar(cli, f.id, { estado: 'aprobado', aprobado_at: 'now', aprobado_por: quien.usuarioId });
    await tablero.cerrarPorOrigen(cli, { tipo: T_APROBAR, origenId: f.id, autorId: quien.usuarioId, nota: 'Aprobado' });
  });
  const f = await cargar(null, id);
  // El PDF, a sus documentos (como la ficha de alta).
  try {
    const { pdf } = await ficheros(f);
    const d = await require('../Documentos/documentos.service').subir('conductor', Number(f.conductor_id), {
      tipo: 'finiquito', nombre: pdf.nombre, mime: 'application/pdf', base64: pdf.bytes.toString('base64'),
    }, quien);
    if (d && d.id) await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio', motivo: 'PDF guardado en sus documentos' },
      cli => repo.cambiar(cli, f.id, { documento_id: d.id }));
  } catch (e) { console.error(`❌ [Finiquitos] no se pudo guardar el PDF de ${f.id}: ${e.message}`); }
  const aviso = await avisar(f).catch(e => ({ enviado: false, motivo: e.message }));
  // Y a la cola de firmas (módulo 6): a falta del finiquito de la gestoría, que es lo que se firma.
  await require('./firmas.service').desdeFiniquito(f);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio',
    motivo: aviso.enviado ? `Aviso enviado a ${aviso.a}` : `Aviso sin enviar: ${aviso.motivo}` }, cli => repo.cambiar(cli, f.id, aviso.enviado
    ? { estado: 'enviado', enviado_at: 'now', enviado_por: quien.usuarioId, enviado_a: aviso.a, envio_nota: null }
    : { envio_nota: aviso.motivo }));
  avisarCambio();
  return { estado: aviso.enviado ? 'enviado' : 'aprobado', aviso };
}

/** Reintentar el aviso, o apuntar que se mandó a mano. */
async function enviar(id, { aMano = false, a, nota } = {}, quien = {}) {
  if (!await puede(quien, CLAVE_APROBAR) && !await puede(quien, CLAVE_REVISAR)) throw error('No tienes permiso para esto', 403);
  const f = await cargar(null, id);
  if (f.estado !== 'aprobado') throw error('Solo se envía el que está aprobado y sin enviar', 409);
  const aviso = aMano ? { enviado: true, a: texto(a) || 'a mano' } : await avisar(f).catch(e => ({ enviado: false, motivo: e.message }));
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio',
    motivo: aviso.enviado ? `Enviado${aMano ? ' a mano' : ''} a ${aviso.a}${texto(nota) ? `: ${texto(nota)}` : ''}` : `Aviso sin enviar: ${aviso.motivo}` },
  cli => repo.cambiar(cli, f.id, aviso.enviado
    ? { estado: 'enviado', enviado_at: 'now', enviado_por: quien.usuarioId, enviado_a: aviso.a, envio_nota: aMano ? (texto(nota) || 'Enviado a mano') : null }
    : { envio_nota: aviso.motivo }));
  avisarCambio();
  return { estado: aviso.enviado ? 'enviado' : 'aprobado', aviso };
}

/** Firmado: con el documento firmado adjunto (mientras no esté la firma digital). */
async function firmado(id, quien = {}) {
  await exigir(quien, CLAVE_REVISAR, 'Marcar firmado es de quien revisa los finiquitos');
  const f = await cargar(null, id);
  if (!['enviado', 'aprobado'].includes(f.estado)) throw error('Solo se marca firmado el que ya está aprobado', 409);
  const lista_ = await adjuntos.lista(DUENO, f.id, { id: quien.usuarioId, rol: quien.rol }).catch(() => []);
  if (!(lista_ || []).length) throw error('Sube antes el finiquito firmado en «Firmado»', 409);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio', motivo: 'Firmado' },
    cli => repo.cambiar(cli, f.id, { estado: 'firmado', firmado_at: 'now', firmado_por: quien.usuarioId }));
  avisarCambio();
  return { estado: 'firmado' };
}

/** Anular (una baja que se anuló, un finiquito que no procede), con motivo. */
async function anular(id, { nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_REVISAR, 'Anular un finiquito es de quien los revisa');
  const n = texto(nota);
  if (n.length < 3) throw error('Di por qué se anula');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'finiquitos', accion: 'cambio', motivo: `Anulado: ${n}` }, async cli => {
    const f = await cargar(cli, id);
    if (['firmado', 'anulado'].includes(f.estado)) throw error('Ese ya no se puede anular', 409);
    await repo.cambiar(cli, f.id, { estado: 'anulado', nota: `Anulado: ${n}` });
    for (const tipo of [T_REVISAR, T_APROBAR]) await tablero.cerrarPorOrigen(cli, { tipo, origenId: f.id, autorId: quien.usuarioId, nota: 'Anulado' });
    return { estado: 'anulado' };
  });
  avisarCambio();
  return r;
}

// ── Leer ───────────────────────────────────────────────────────────────────
async function lista(quien) {
  await exigir(quien, CLAVE_VER);
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, estados: ESTADOS };
  const filas = (await repo.lista()).map(f => ({ ...f, neto: f.resumen && f.resumen.totales ? f.resumen.totales.neto : null,
    vacaciones: f.resumen && f.resumen.totales ? f.resumen.totales.vacacionesDias : null }));
  return { filas, sinTabla: false, estados: ESTADOS,
    puedeRevisar: await puede(quien, CLAVE_REVISAR), puedeAprobar: await puede(quien, CLAVE_APROBAR),
    correoGestoria: !!(await correoDestino({ tipo: 'propia' })), correoEtt: !!(await correoDestino({ tipo: 'ett' })) };
}

async function ficha(id, quien) {
  await exigir(quien, CLAVE_VER);
  const f = await cargar(null, id);
  return { ...f, puedeRevisar: await puede(quien, CLAVE_REVISAR), puedeAprobar: await puede(quien, CLAVE_APROBAR) };
}

/** Los de una persona, para su ficha en Plantilla. */
async function deConductor(conductorId, quien) {
  if (!await puede(quien, CLAVE_VER) || !await repo.hayTabla()) return { finiquitos: [], puede: false };
  return { finiquitos: (await repo.deConductor(Number(conductorId))).map(f => ({ id: f.id, fecha_baja: f.fecha_baja, estado: f.estado,
    etiqueta: ESTADOS[f.estado].etiqueta, tono: ESTADOS[f.estado].tono })), puede: true, puedePreparar: await puede(quien, CLAVE_REVISAR) };
}

async function pdf(id, quien) {
  await exigir(quien, CLAVE_VER);
  const f = await cargar(null, id);
  const { pdf: p } = await ficheros(f);
  return p;
}

// ── El firmado: un adjunto del finiquito ───────────────────────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DUENO, {
  etiqueta: 'Finiquito',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async q => puede(quienDe(q), CLAVE_REVISAR),
});

// ── El número del menú ─────────────────────────────────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('finiquitos'); }
contadores.registrarFuente('finiquitos', {
  async contar(q) {
    const tiene = c => q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(c)));
    if (!tiene(CLAVE_VER)) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.porHacer() : { revisar: 0, aprobar: 0, enviar: 0 })) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const c = await cuenta.valor;
    const n = (tiene(CLAVE_REVISAR) ? c.revisar + c.enviar : 0) + (tiene(CLAVE_APROBAR) ? c.aprobar : 0);
    return { 'finiquitos.pendientes': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'finiquito' : 'finiquitos'} por hacer` } };
  },
});

module.exports = {
  preparar, alDarLaBaja, revisar, devolver, aprobar, enviar, firmado, anular, lista, ficha, deConductor, pdf, puede,
  calcularResumen, ESTADOS, DESDE, CLAVE_VER, CLAVE_REVISAR, CLAVE_APROBAR, DUENO,
};
