// ============================================================
// REMESAS — lo que se le devuelve al conductor (db/266, 18/11/2026)
// ============================================================
// Camilo, con el Excel «Remesas Conductores»: «Vamos a sacar las
// funcionalidades de este excel y agregarlo a recaudación en un apartado
// llamado "Remesas"… La remesa sí o sí debe de quitarle efectivo a entregar del
// conductor, si el conductor no tiene efectivo en BOLT deben de haber los
// siguientes estados… Todos los estados pueden ser editables».
//
// Una REMESA es un gasto que pagó el conductor y se le devuelve (combustible,
// ITV, lavado, parking, peaje…). Sus estados:
//   · Pendiente de aprobación  la apunta cualquiera de Recaudación; espera.
//   · Pendiente de pago        aprobada, aún sin pagar.
//   · Pagado con efectivo de BOLT  se queda ese dinero de lo que cobró en mano:
//                              un movimiento 'remesa' en la recaudación BAJA lo
//                              que debe entregar (y no toca el cajón).
//   · Pagado en nómina         se le paga en la nómina.
//   · Pagado en su cuenta      por transferencia a su IBAN.
// Todos se pueden cambiar. «Sí o sí debe quitarle efectivo a entregar»: si
// tiene efectivo pendiente, al aprobarla lo que se propone es pagarla con él.
//
// QUIÉN
//   · Mirar y apuntar: quien entra en Recaudación ('/recaudacion').
//   · Aprobar (sacarla de «pendiente de aprobación» o volverla a ella), tocar
//     una ya aprobada, anular, ver el IBAN entero e importar el Excel: la llave
//     '/recaudacion/remesas/aprobar' (Camilo: «una llave nueva»). El
//     superadmin y el desarrollador, como en toda la caja.
//
// EL DINERO: el movimiento de una remesa pagada con efectivo se escribe y se
// anula en LA MISMA transacción que su estado (libro.conFirma). No se anula a
// mano desde la ficha del conductor (recaudacion.service.anular lo para).
'use strict';

const crypto = require('crypto');
const repo = require('./remesas.repo');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const cripto = require('../../services/cripto');
const contadores = require('../../services/contadores');

const CLAVE_APROBAR = '/recaudacion/remesas/aprobar';
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];
const ESTADOS = [
  { codigo: 'pendiente_aprobacion', etiqueta: 'Pendiente de aprobación' },
  { codigo: 'pendiente_pago',       etiqueta: 'Pendiente de pago' },
  { codigo: 'efectivo_bolt',        etiqueta: 'Pagado con efectivo de BOLT', pagado: true },
  { codigo: 'nomina',               etiqueta: 'Pagado en nómina', pagado: true },
  { codigo: 'cuenta',               etiqueta: 'Pagado en su cuenta', pagado: true },
];
const ETIQUETA = Object.fromEntries(ESTADOS.map(e => [e.codigo, e.etiqueta]));
const ORIGEN = 'recaudacion';

function error(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const esDia = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const txt = (v, max) => { const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };
const euros = c => (c / 100).toFixed(2).replace('.', ',');

/** Céntimos de «12,50», «12.5», 12.5. null si no es un importe. */
function aCentimos(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Un IBAN limpio (sin espacios, en mayúsculas) o null; lanza si no lo parece. */
function ibanLimpio(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) throw error('Ese IBAN no parece bueno: dos letras y los números, como ES12 3456 …');
  return s;
}
const enmascarado = cifrado => {
  if (!cifrado) return null;
  let iban = null;
  try { iban = cripto.descifrar(cifrado); } catch (_) { iban = null; }
  return iban ? `•••• ${iban.slice(-4)}` : 'guardado';
};

async function puedeAprobar(ctx = {}) {
  if (ADMIN_TOTAL.includes((ctx.usuario || {}).rol)) return true;
  try { return ctx.usuarioId ? (await permisos.clavesDe(ctx.usuarioId)).has(CLAVE_APROBAR) : false; } catch (_) { return false; }
}

/** Lo que tiene pendiente de entregar cada conductor: Map(id → €). */
async function pendientes() {
  try {
    const c = await require('./recaudacion.repo').cuadro();
    return new Map((c.filas || []).filter(f => !f.sinFicha).map(f => [Number(f.conductorId), Number(f.aRecaudar) || 0]));
  } catch (_) { return new Map(); }
}

const publica = (r, { aprueba, pendiente }) => ({
  id: r.id, conductorId: r.conductor_id, conductor: r.conductor || null, beneficiario: r.beneficiario,
  fecha: r.fecha, fechaDocumento: r.fecha_documento, concepto: r.concepto || '', cif: r.cif || '', numeroDocumento: r.numero_documento || '',
  importe: r.importe_cent / 100, estado: r.estado, estadoTexto: ETIQUETA[r.estado] || r.estado,
  iban: enmascarado(r.iban_cifrado), ibanDeLaFicha: !r.iban_cifrado && r.iban_ficha ? enmascarado(r.iban_ficha) : null,
  conMovimiento: !!r.movimiento_id, notas: r.notas || '', importada: !!r.origen_ref,
  creadoPor: r.creado_por_nombre || null, creadoAt: r.creado_at, aprobadaPor: r.aprobada_por_nombre || null, aprobadaAt: r.aprobada_at,
  pendienteConductor: r.conductor_id && pendiente ? (pendiente.get(r.conductor_id) ?? 0) : null,
  puedeTocar: aprueba || r.estado === 'pendiente_aprobacion',
});

// ── Mirar ───────────────────────────────────────────────────────────────────
async function lista(ctx) {
  let filas;
  try { filas = await repo.lista(); } catch (e) { if (repo.faltaMigracion(e)) return { sinMigracion: true, filas: [] }; throw e; }
  const [aprueba, pendiente] = await Promise.all([puedeAprobar(ctx), pendientes()]);
  return { filas: filas.map(r => publica(r, { aprueba, pendiente })), estados: ESTADOS, puedeAprobar: aprueba };
}

/** Para el selector: los conductores, con lo que tienen pendiente de entregar. */
async function conductores() {
  const [lista_, pendiente] = await Promise.all([repo.conductores(), pendientes()]);
  return { conductores: lista_.map(c => ({ id: c.id, nombre: c.nombre, vigente: c.vigente, conIban: c.conIban, pendiente: pendiente.get(c.id) || 0 })) };
}

/** El IBAN entero (para hacer la transferencia): solo quien aprueba. */
async function iban(id, ctx) {
  if (!await puedeAprobar(ctx)) throw error('El IBAN entero solo lo ve quien aprueba las remesas', 403);
  const r = await repo.porId(null, id);
  if (!r) throw error('Esa remesa no existe', 404);
  const cifrado = r.iban_cifrado || r.iban_ficha;
  if (!cifrado) return { iban: null };
  return { iban: cripto.descifrar(cifrado), deLaFicha: !r.iban_cifrado };
}

// ── El dinero: el descuento en la recaudación ──────────────────────────────
/** Pone o quita el movimiento según el estado. Dentro de la transacción. */
async function cuadrarMovimiento(cli, r, { estado, importeCent, conductorId, concepto }, usuarioId, porque) {
  const quiereMovimiento = estado === 'efectivo_bolt';
  const cambiaDinero = r.movimiento_id && (importeCent !== r.importe_cent || conductorId !== r.conductor_id);
  let movimientoId = r.movimiento_id;
  if (movimientoId && (!quiereMovimiento || cambiaDinero)) {
    await repo.anularMovimiento(cli, movimientoId, { motivo: `Remesa nº ${r.id}: ${porque}`, usuarioId });
    movimientoId = null;
  }
  if (quiereMovimiento && !movimientoId) {
    if (!conductorId) throw error('Para pagarla con su efectivo, primero dile de qué conductor es');
    movimientoId = await repo.apuntarMovimiento(cli, {
      conductorId, fecha: hoyMadrid(), importeCent, usuarioId,
      observacion: `Remesa nº ${r.id}${concepto ? `: ${concepto}` : ''}`,
    });
  }
  return movimientoId;
}

/** Los datos de una remesa, validados. `parcial`: solo lo que venga. */
async function leerDatos(cli, d, { parcial = false } = {}) {
  const o = {};
  if (!parcial || 'conductorId' in d) {
    o.conductorId = d.conductorId ? Number(d.conductorId) : null;
    if (!o.conductorId && !parcial) throw error('Elige el conductor');
  }
  if (!parcial || 'importe' in d) {
    o.importeCent = aCentimos(d.importe);
    if (!o.importeCent || o.importeCent <= 0) throw error('El importe tiene que ser mayor que cero');
    if (o.importeCent > 500000) throw error('¿Más de 5.000 €? Revisa el importe');
  }
  if (!parcial || 'fecha' in d) {
    o.fecha = d.fecha ? String(d.fecha) : hoyMadrid();
    if (!esDia(o.fecha)) throw error('Esa fecha no se entiende');
    if (o.fecha > hoyMadrid()) throw error('La fecha de la remesa no puede ser futura');
  }
  if (!parcial || 'fechaDocumento' in d) {
    o.fechaDocumento = d.fechaDocumento ? String(d.fechaDocumento) : null;
    if (o.fechaDocumento && !esDia(o.fechaDocumento)) throw error('La fecha del ticket no se entiende');
    if (o.fechaDocumento && o.fechaDocumento > hoyMadrid()) throw error('La fecha del ticket no puede ser futura');
  }
  if (!parcial || 'concepto' in d) {
    o.concepto = txt(d.concepto, 200);
    if (!o.concepto && !parcial) throw error('Di qué pagó: combustible, ITV, lavado, parking…');
  }
  if (!parcial || 'cif' in d) o.cif = txt(d.cif, 30);
  if (!parcial || 'numeroDocumento' in d) o.numeroDocumento = txt(d.numeroDocumento, 80);
  if (!parcial || 'notas' in d) o.notas = txt(d.notas, 1000);
  if ('iban' in d) {
    const limpio = ibanLimpio(d.iban);
    o.ibanCifrado = limpio ? cripto.cifrar(limpio) : null;
  }
  return o;
}

async function exigirCuenta(cli, estado, ibanCifrado, conductorId) {
  if (estado !== 'cuenta' || ibanCifrado) return;
  if (conductorId && await repo.ibanDeConductor(cli, conductorId)) return;
  throw error('Para pagarla en su cuenta falta el IBAN: ponlo en la remesa (o en su ficha)');
}

// ── Apuntar ─────────────────────────────────────────────────────────────────
async function crear(d = {}, ctx) {
  const aprueba = await puedeAprobar(ctx);
  // Quien aprueba puede apuntarla ya en su estado. Si no lo elige: «sí o sí
  // debe quitarle efectivo a entregar» — con lo que tenga pendiente, pagada con
  // su efectivo; sin nada pendiente, pendiente de pago. Quien no aprueba, la deja
  // esperando aprobación.
  let estado = 'pendiente_aprobacion';
  if (aprueba) {
    if (ESTADOS.some(e => e.codigo === d.estado)) estado = d.estado;
    else estado = ((await pendientes()).get(Number(d.conductorId)) || 0) > 0.005 ? 'efectivo_bolt' : 'pendiente_pago';
  }
  const id = await libro.conFirma({ usuarioId: ctx.usuarioId, origen: ORIGEN, accion: 'alta', motivo: 'Remesa' }, async cli => {
    const o = await leerDatos(cli, d);
    const c = (await repo.conductores(cli)).find(x => x.id === o.conductorId);
    if (!c) throw error('Ese conductor no está en la plantilla', 404);
    await exigirCuenta(cli, estado, o.ibanCifrado, o.conductorId);
    const nueva = await repo.insertar(cli, { ...o, beneficiario: c.nombre, estado, creadoPor: ctx.usuarioId,
      aprobadaPor: estado !== 'pendiente_aprobacion' ? ctx.usuarioId : null });
    if (estado === 'efectivo_bolt') {
      const r = await repo.porId(cli, nueva);
      const mov = await cuadrarMovimiento(cli, r, { estado, importeCent: o.importeCent, conductorId: o.conductorId, concepto: o.concepto }, ctx.usuarioId, 'alta');
      await repo.actualizar(cli, nueva, { movimiento_id: mov }, ctx.usuarioId);
    }
    return nueva;
  });
  avisar(estado === 'pendiente_aprobacion' ? id : null);
  return { id, estado };
}

async function editar(id, d = {}, ctx) {
  const aprueba = await puedeAprobar(ctx);
  await libro.conFirma({ usuarioId: ctx.usuarioId, origen: ORIGEN, accion: 'cambio', motivo: 'Remesa: datos' }, async cli => {
    const r = await repo.porId(cli, id, { bloquear: true });
    if (!r || r.anulado_at) throw error('Esa remesa no existe', 404);
    if (r.estado !== 'pendiente_aprobacion' && !aprueba) throw error('Ya está aprobada: la cambia quien aprueba las remesas', 403);
    const o = await leerDatos(cli, d, { parcial: true });
    const campos = {};
    if ('conductorId' in o) {
      if (o.conductorId) {
        const c = (await repo.conductores(cli)).find(x => x.id === o.conductorId);
        if (!c) throw error('Ese conductor no está en la plantilla', 404);
        campos.conductor_id = o.conductorId; campos.beneficiario = c.nombre;
      } else if (r.estado === 'efectivo_bolt' && !r.origen_ref) {
        throw error('Pagada con su efectivo tiene que ser de un conductor');
      } else campos.conductor_id = null;
    }
    const mapa = { importeCent: 'importe_cent', fecha: 'fecha', fechaDocumento: 'fecha_documento', concepto: 'concepto',
      cif: 'cif', numeroDocumento: 'numero_documento', notas: 'notas', ibanCifrado: 'iban_cifrado' };
    Object.entries(mapa).forEach(([k, col]) => { if (k in o) campos[col] = o[k]; });
    const conductorId = 'conductor_id' in campos ? campos.conductor_id : r.conductor_id;
    const importeCent = campos.importe_cent || r.importe_cent;
    await exigirCuenta(cli, r.estado, 'iban_cifrado' in campos ? campos.iban_cifrado : r.iban_cifrado, conductorId);
    if (r.movimiento_id) {
      const mov = await cuadrarMovimiento(cli, r, { estado: r.estado, importeCent, conductorId, concepto: campos.concepto || r.concepto },
        ctx.usuarioId, 'se cambió el importe o el conductor');
      if (mov !== r.movimiento_id) campos.movimiento_id = mov;
    }
    if (Object.keys(campos).length) await repo.actualizar(cli, r.id, campos, ctx.usuarioId);
  });
  return { ok: true };
}

/** Cambiar el estado. Aprobar es sacarla de «pendiente de aprobación». */
async function cambiarEstado(id, { estado, nota } = {}, ctx) {
  if (!ESTADOS.some(e => e.codigo === estado)) throw error('Ese estado no existe');
  const aprueba = await puedeAprobar(ctx);
  let antes = null;
  await libro.conFirma({ usuarioId: ctx.usuarioId, origen: ORIGEN, accion: 'cambio', motivo: txt(nota, 300) || `Remesa: ${ETIQUETA[estado]}` }, async cli => {
    const r = await repo.porId(cli, id, { bloquear: true });
    if (!r || r.anulado_at) throw error('Esa remesa no existe', 404);
    antes = r.estado;
    if (r.estado === estado) return;
    if ((r.estado === 'pendiente_aprobacion' || estado === 'pendiente_aprobacion') && !aprueba) {
      throw error('Aprobar una remesa (o volverla a pendiente de aprobación) es de quien aprueba las remesas', 403);
    }
    await exigirCuenta(cli, estado, r.iban_cifrado, r.conductor_id);
    const mov = await cuadrarMovimiento(cli, r, { estado, importeCent: r.importe_cent, conductorId: r.conductor_id, concepto: r.concepto },
      ctx.usuarioId, `pasa a «${ETIQUETA[estado]}»`);
    const campos = { estado, movimiento_id: mov };
    if (r.estado === 'pendiente_aprobacion') { campos.aprobada_por = ctx.usuarioId; campos.aprobada_at = new Date(); }
    if (estado === 'pendiente_aprobacion') { campos.aprobada_por = null; campos.aprobada_at = null; }
    await repo.actualizar(cli, r.id, campos, ctx.usuarioId);
  });
  if (antes !== estado) avisar(estado === 'pendiente_aprobacion' ? id : null);
  return { ok: true, estado };
}

async function anular(id, { motivo } = {}, ctx) {
  const porque = txt(motivo, 500);
  if (!porque || porque.length < 3) throw error('Di por qué se anula');
  const aprueba = await puedeAprobar(ctx);
  await libro.conFirma({ usuarioId: ctx.usuarioId, origen: ORIGEN, accion: 'anulacion', motivo: porque }, async cli => {
    const r = await repo.porId(cli, id, { bloquear: true });
    if (!r || r.anulado_at) throw error('Esa remesa no existe o ya está anulada', 404);
    const suya = r.creado_por === ctx.usuarioId && r.estado === 'pendiente_aprobacion';
    if (!aprueba && !suya) throw error('La anula quien aprueba las remesas (o quien la apuntó, mientras espera aprobación)', 403);
    if (r.movimiento_id) await repo.anularMovimiento(cli, r.movimiento_id, { motivo: `Remesa nº ${r.id} anulada: ${porque}`, usuarioId: ctx.usuarioId });
    await repo.actualizar(cli, r.id, { anulado_at: new Date(), anulado_por: ctx.usuarioId, anulado_motivo: porque, movimiento_id: null }, ctx.usuarioId);
  });
  avisar(null);
  return { ok: true };
}

// ── El aviso a quien aprueba ───────────────────────────────────────────────
let _push = null;
const push = () => (_push || (_push = require('../../services/notificacionesPush')));
function avisar(idNueva) {
  contadores.cambio('remesas');
  if (!idNueva) return;
  (async () => {
    const ids = await repo.aprobadores();
    if (ids.length) await push().enviar(ids, { titulo: 'Remesa por aprobar', cuerpo: 'Hay una remesa nueva esperando aprobación', url: '/recaudacion?vista=remesas', etiqueta: 'remesas' });
  })().catch(e => console.error('❌ [Remesas] aviso:', e.message));
}

contadores.registrarFuente('remesas', {
  async contar(quien) {
    const aprueba = quien && (quien.permisos === null || (Array.isArray(quien.permisos) && quien.permisos.includes(CLAVE_APROBAR))
      || ADMIN_TOTAL.includes(quien.rol));
    if (!aprueba) return {};
    try {
      const n = await repo.cuantasPorAprobar();
      return { 'remesas.aprobar': { n, tono: n ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'remesa' : 'remesas'} por aprobar` } };
    } catch (e) {
      if (repo.faltaMigracion(e)) return {};
      throw e;
    }
  },
});

// ── EL EXCEL DE REMESAS, UNA VEZ (Camilo: «Sí, subiendo el Excel una vez») ─
// La hoja «Remesas» (Madrid): Fecha · Beneficiario · IBAN (o cómo se pagó) ·
// Fecha documento · CIF · Nº documento · Monto · Estado · Observaciones. Se lee
// en el servidor (lleva IBAN: no pasa por el repositorio). Cada fila:
//   · el conductor, por su nombre (todas las palabras del Excel en su nombre
//     completo y que no haya dos así); si no, entra sin conductor y se le pone
//     después;
//   · el estado: «Pagado» con un IBAN → en su cuenta; con «nómina» → en
//     nómina; con «efectivo» → con efectivo de BOLT (en otro caso, nómina, que
//     es como se pagaban casi todas); «Pendiente/Aprobado» → pendiente de pago;
//     sin estado → pendiente de aprobación;
//   · SIN movimiento en la recaudación: lo del Excel ya se saldó en su día.
// Primero dice lo que haría (confirmar: false); luego lo hace. Lo que ya entró
// (mismo contenido) no se repite.
const plano = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

function casarConductor(nombre, lista_) {
  const pal = plano(nombre).split(' ').filter(p => p.length >= 2);
  if (!pal.length) return null;
  const encajan = lista_.filter(c => { const t = new Set(plano(c.paraCasar).split(' ')); return pal.every(p => t.has(p)); });
  return encajan.length === 1 ? encajan[0] : null;
}

function estadoDelExcel({ estado, medio, observaciones }) {
  const e = plano(estado);
  if (!e) return 'pendiente_aprobacion';
  if (e.startsWith('pendiente')) return 'pendiente_pago';
  const m = `${plano(medio)} ${plano(observaciones)}`;
  if (/^[a-z]{2}\s?\d{2}/.test(plano(medio)) && /\d{10,}/.test(String(medio).replace(/\s/g, ''))) return 'cuenta';
  if (/efectivo/.test(m)) return 'efectivo_bolt';
  return 'nomina';
}

async function leerExcel(base64) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(String(base64 || ''), 'base64'));
  const ws = wb.getWorksheet('Remesas') || wb.worksheets[0];
  if (!ws) throw error('El Excel no tiene la hoja «Remesas»');
  const valor = c => {
    let v = c.value;
    if (v && typeof v === 'object') {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (v.result !== undefined) v = v.result;
      else if (v.richText) v = v.richText.map(t => t.text).join('');
      else if (v.text) v = v.text;
    }
    return v instanceof Date ? v.toISOString().slice(0, 10) : v;
  };
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const [fecha, beneficiario, medio, fechaDoc, cif, numero, monto, estado, observaciones] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => valor(row.getCell(k)));
    const importeCent = aCentimos(monto);
    if (!txt(beneficiario, 160) || !importeCent || importeCent <= 0) return;   // títulos de sección, filas a medias
    filas.push({ fila: n, fecha: esDia(fecha) ? fecha : null, beneficiario: txt(beneficiario, 160), medio: txt(medio, 200),
      fechaDocumento: esDia(fechaDoc) ? fechaDoc : null, cif: txt(cif === '-' ? '' : cif, 30), numero: txt(numero === '-' ? '' : numero, 80),
      importeCent, estado: txt(estado, 40), observaciones: txt(observaciones, 300) });
  });
  return filas;
}

async function importar({ base64, confirmar = false } = {}, ctx) {
  if (!await puedeAprobar(ctx)) throw error('Importar el Excel de remesas es de quien las aprueba', 403);
  const filas = await leerExcel(base64);
  if (!filas.length) throw error('No he encontrado ninguna remesa en la hoja «Remesas»');
  const gente = await repo.conductores();
  // La huella de cada fila (con cuántas iguales van antes): lo mismo no entra dos veces.
  const vistas = new Map();
  const preparadas = filas.map(f => {
    const base = crypto.createHash('sha1').update([f.fecha, plano(f.beneficiario), f.importeCent, f.fechaDocumento, f.numero].join('|')).digest('hex').slice(0, 20);
    const n = (vistas.get(base) || 0) + 1; vistas.set(base, n);
    const c = casarConductor(f.beneficiario, gente);
    const estado = estadoDelExcel(f);
    const esIban = estado === 'cuenta' || (f.medio && /^[A-Za-z]{2}\s?\d{2}/.test(f.medio) && /\d{10,}/.test(f.medio.replace(/\s/g, '')));
    const concepto = txt(f.observaciones, 200) || (!esIban && f.medio ? txt(f.medio.replace(/devoluci[oó]n(es)?\s*(en|por)?\s*n[oó]mina/ig, '').replace(/[()]/g, ' '), 200) : null)
      || 'Remesa del Excel';
    return { ...f, estadoExcel: f.estado, origenRef: `excel-remesas:${base}#${n}`, conductor: c, estado, concepto, iban: esIban ? f.medio : null };
  });
  const ya = await repo.origenesYa(null, preparadas.map(p => p.origenRef));
  const nuevas = preparadas.filter(p => !ya.has(p.origenRef));
  const resumen = {
    leidas: preparadas.length, yaEstaban: preparadas.length - nuevas.length, nuevas: nuevas.length,
    conConductor: nuevas.filter(p => p.conductor).length,
    sinConductor: nuevas.filter(p => !p.conductor).map(p => `${p.beneficiario} · ${euros(p.importeCent)} € (fila ${p.fila})`),
    porEstado: ESTADOS.map(e => ({ estado: e.etiqueta, n: nuevas.filter(p => p.estado === e.codigo).length })).filter(x => x.n),
    importe: euros(nuevas.reduce((s, p) => s + p.importeCent, 0)),
  };
  if (!confirmar || !nuevas.length) return { resumen, hecho: false };
  await libro.conFirma({ usuarioId: ctx.usuarioId, origen: ORIGEN, accion: 'alta', motivo: 'Remesas importadas del Excel «Remesas Conductores»' }, async cli => {
    for (const p of nuevas) {
      let ibanCifrado = null;
      if (p.iban) { try { ibanCifrado = cripto.cifrar(ibanLimpio(p.iban)); } catch (_) { ibanCifrado = null; } }
      await repo.insertar(cli, {
        conductorId: p.conductor ? p.conductor.id : null, beneficiario: p.beneficiario, fecha: p.fecha || p.fechaDocumento || hoyMadrid(),
        fechaDocumento: p.fechaDocumento, concepto: p.concepto, cif: p.cif, numeroDocumento: p.numero, importeCent: p.importeCent,
        estado: p.estado, ibanCifrado, origenRef: p.origenRef, creadoPor: ctx.usuarioId,
        aprobadaPor: p.estado !== 'pendiente_aprobacion' ? ctx.usuarioId : null,
        notas: [`Del Excel (fila ${p.fila})`, p.medio && !p.iban ? `«${p.medio}»` : null, p.estadoExcel ? `estado «${p.estadoExcel}» en el Excel` : null]
          .filter(Boolean).join(' · ').slice(0, 1000),
      });
    }
  });
  avisar(null);
  return { resumen, hecho: true };
}

module.exports = {
  lista, conductores, iban, crear, editar, cambiarEstado, anular, importar, puedeAprobar, ESTADOS, CLAVE_APROBAR,
  // Para las pruebas:
  _casarConductor: casarConductor, _estadoDelExcel: estadoDelExcel, _aCentimos: aCentimos, _ibanLimpio: ibanLimpio,
};
