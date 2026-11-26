// ============================================================
// LOS DESCUENTOS EN NÓMINA — LA PUERTA (módulo 4.2, db/298, 26/11/2026)
// ============================================================
// El encargo: cada descuento con su origen, su prueba y su aprobación; ninguno
// sin aprobar entra en la nómina; al cerrar el mes, el efectivo queda saldado en
// Recaudación. Camilo (26/11/2026):
//   · Los KM, del Banco de KM: el exceso de cada semana cerrada a
//     `descuentos.km_euro` € por km. Entran solos, pendientes de aprobar.
//   · Aprobar es una llave ('/descuentos/aprobar') que se da a quien se quiera.
//     Proponer, '/descuentos/proponer' (Taller, Control, RR. HH.); el efectivo
//     también lo propone quien apunta la nómina en Recaudación.
//   · Sin tope: se aplaza a mano, entero o una parte, y queda su saldo.
//   · Conceptos de A3 por origen (Parámetros): efectivo 753, km 758,
//     siniestro 751, combustible y otros 754.
//   · El combustible nunca se aprueba sin el visto bueno de Legal (el encargo).
'use strict';

const repo = require('./descuentos.repo');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const contadores = require('../../services/contadores');
const adjuntos = require('../../services/adjuntos');
const calendario = require('../../services/calendario');
const parametros = require('../../services/parametros');
const tareasProgramadas = require('../../services/tareasProgramadas');
const db = require('../../services/db');

const CLAVE_VER = '/descuentos';
const CLAVE_PROPONER = '/descuentos/proponer';
const CLAVE_APROBAR = '/descuentos/aprobar';
const CLAVE_RECAUDACION = '/recaudacion/nomina';
const TOTAL = ['superadmin', 'desarrollador'];
const PRUEBAS = 'descuento';
// Los km se generan desde la semana del 23/11/2026: la primera del mes de nómina que empieza el 26/11.
const KM_DESDE = '2026-11-23';

const ORIGENES = {
  efectivo: { etiqueta: 'Efectivo sin entregar', parametro: 'descuentos.concepto_efectivo', defecto: '753' },
  km: { etiqueta: 'Km fuera de la aplicación', parametro: 'descuentos.concepto_km', defecto: '758' },
  siniestro: { etiqueta: 'Siniestro (negligencia)', parametro: 'descuentos.concepto_siniestro', defecto: '751' },
  combustible: { etiqueta: 'Sustracción de combustible', parametro: 'descuentos.concepto_otro', defecto: '754' },
  otro: { etiqueta: 'Otro descuento', parametro: 'descuentos.concepto_otro', defecto: '754' },
};
const ESTADOS = {
  pendiente: { etiqueta: 'Por aprobar', tono: 'warn' },
  aprobado: { etiqueta: 'Aprobado', tono: 'gold' },
  aplazado: { etiqueta: 'Aplazado (con saldo)', tono: 'azul' },
  aplicado: { etiqueta: 'Descontado', tono: 'green' },
  anulado: { etiqueta: 'Anulado', tono: 'muted' },
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const texto = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const esIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dosDec = n => Math.round(Number(n) * 100) / 100;
const importeDe = v => dosDec(String(v == null ? '' : v).replace(/\./g, (m, i, s) => (s.indexOf(',') >= 0 ? '' : m)).replace(',', '.'));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = p => `${MESES[Number(p.slice(5, 7)) - 1]} de ${p.slice(0, 4)}`;

async function puede(quien, llave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol) && llave === CLAVE_VER) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(llave); } catch (_) { return false; }
}
const exigir = async (quien, llave, que) => { if (!await puede(quien, llave)) throw error(que || 'No tienes permiso para esto', 403); };

// ── El mes de nómina ───────────────────────────────────────────────────────
/** El mes de nómina de un día ('AAAA-MM'): la nómina va del 26 al 25 (`nomina.dia_corte`). */
async function periodoDe(iso) {
  const corte = Number(await parametros.valor('nomina.dia_corte').catch(() => 25)) || 25;
  const [y, m, d] = iso.split('-').map(Number);
  if (d <= corte) return `${y}-${String(m).padStart(2, '0')}`;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const siguiente = p => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const conceptoDe = async origen => String(await parametros.valor(ORIGENES[origen].parametro).catch(() => '') || ORIGENES[origen].defecto);

async function cargar(cli, id) {
  const d = await repo.porId(String(id), cli);
  if (!d) throw error('No existe ese descuento', 404);
  return d;
}

// ── Proponer ───────────────────────────────────────────────────────────────
/**
 * UN DESCUENTO A MANO: la persona, el origen, el importe, el día y el motivo
 * (las pruebas se suben en su ficha). Si quien lo apunta puede aprobar, sale
 * aprobado (salvo el combustible, que pide el visto bueno de Legal). → { id, estado }
 */
async function crear({ conductorId, origen, importe, fecha, motivo } = {}, quien = {}) {
  if (!ORIGENES[origen] || origen === 'km') throw error('Elige de dónde sale el descuento');
  const proponer = await puede(quien, CLAVE_PROPONER) || (origen === 'efectivo' && await puede(quien, CLAVE_RECAUDACION));
  if (!proponer) throw error('Proponer descuentos es de quien tiene la llave «Descuentos · proponer»', 403);
  const euros = importeDe(importe);
  if (!(euros > 0)) throw error('El importe tiene que ser mayor que cero');
  const dia = esIso(fecha) ? fecha : calendario.hoy();
  const m = texto(motivo);
  if (m.length < 3) throw error('Di por qué se le descuenta');
  const persona = (await repo.personas()).find(p => p.id === String(conductorId));
  if (!persona) throw error('No encuentro a esa persona');
  const aprueba = origen !== 'combustible' && await puede(quien, CLAVE_APROBAR);
  const estado = aprueba ? 'aprobado' : 'pendiente';
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'descuentos', accion: 'alta', motivo: `${ORIGENES[origen].etiqueta}: ${m}` }, async cli => {
    const id = await repo.insertar(cli, { conductorId: Number(conductorId), origen, concepto: await conceptoDe(origen), importe: euros,
      periodo: await periodoDe(dia), fecha: dia, motivo: m, estado, creadoPor: quien.usuarioId });
    return { id, estado };
  });
  avisarCambio();
  return r;
}

// ── Decidir ────────────────────────────────────────────────────────────────
/** APROBAR: entra en la nómina de su mes. El combustible, con el visto bueno de Legal. */
async function aprobar(id, { vistoLegal, nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aprobar descuentos es de quien tiene la llave «Descuentos · aprobar»');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'descuentos', accion: 'cambio', motivo: 'Descuento aprobado' }, async cli => {
    const d = await cargar(cli, id);
    if (d.estado !== 'pendiente') throw error('Solo se aprueba el que está por aprobar', 409);
    const legal = texto(vistoLegal, 500);
    if (d.origen === 'combustible' && legal.length < 3) throw error('La sustracción de combustible necesita el visto bueno de Legal: di quién lo dio y cuándo');
    await repo.cambiar(cli, d.id, { estado: 'aprobado', aprobado_at: 'now', aprobado_por: quien.usuarioId,
      ...(legal ? { visto_legal: legal } : {}), ...(texto(nota) ? { nota: texto(nota) } : {}) });
    return { estado: 'aprobado' };
  });
  avisarCambio();
  return r;
}

/** ANULAR, con motivo: quien aprueba, o quien lo propuso mientras sigue por aprobar. */
async function anular(id, { motivo } = {}, quien = {}) {
  const m = texto(motivo);
  if (m.length < 3) throw error('Di por qué se anula');
  const d0 = await cargar(null, id);
  const propio = d0.estado === 'pendiente' && await esSuyo(d0.id, quien.usuarioId);
  if (!propio) await exigir(quien, CLAVE_APROBAR, 'Anular descuentos es de quien los aprueba');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'descuentos', accion: 'cambio', motivo: `Anulado: ${m}` }, async cli => {
    const d = await cargar(cli, id);
    if (!['pendiente', 'aprobado', 'aplazado'].includes(d.estado)) throw error('Ese ya no se puede anular', 409);
    if (d.descontado > 0) throw error('Ya se le ha descontado una parte: aplázalo o deja que se descuente lo que queda', 409);
    await repo.cambiar(cli, d.id, { estado: 'anulado', nota: `Anulado: ${m}`, cerrado_at: 'now', cerrado_por: quien.usuarioId });
    return { estado: 'anulado' };
  });
  avisarCambio();
  return r;
}
const esSuyo = async (id, usuarioId) => (await db.consulta(`SELECT creado_por = $2 AS suyo FROM descuento_nomina WHERE id = $1`, [id, usuarioId])).rows.some(x => x.suyo);

/**
 * APLAZAR, a mano (sin tope: Camilo). Sin importe, todo al mes siguiente; con
 * importe, eso se descuenta este mes y el resto se aplaza al cerrarlo.
 */
async function aplazar(id, { importe, nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aplazar descuentos es de quien los aprueba');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'descuentos', accion: 'cambio', motivo: `Aplazado${texto(nota) ? `: ${texto(nota)}` : ''}` }, async cli => {
    const d = await cargar(cli, id);
    if (!['aprobado', 'aplazado'].includes(d.estado)) throw error('Solo se aplaza uno aprobado', 409);
    const parte = importe == null || String(importe).trim() === '' ? 0 : importeDe(importe);
    if (parte < 0 || parte >= d.saldo) throw error(`Este mes se le puede descontar menos de ${String(d.saldo).replace('.', ',')} € (lo que le queda); el resto pasa al mes siguiente`);
    if (parte > 0) await repo.cambiar(cli, d.id, { a_descontar: parte, ...(texto(nota) ? { nota: texto(nota) } : {}) });
    else await repo.cambiar(cli, d.id, { estado: 'aplazado', periodo: siguiente(d.periodo), a_descontar: null, ...(texto(nota) ? { nota: texto(nota) } : {}) });
    return { periodo: parte > 0 ? d.periodo : siguiente(d.periodo), aDescontar: parte || null };
  });
  avisarCambio();
  return r;
}

/**
 * CERRAR EL MES: se descuenta lo de cada aprobado o aplazado de ese mes (su
 * parte, o todo su saldo). Lo que queda pasa al mes siguiente, aplazado. El
 * efectivo queda saldado en Recaudación (un movimiento «nómina»). → { descontados, aplazados, total }
 */
async function cerrarMes({ periodo } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Cerrar los descuentos de un mes es de quien los aprueba');
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) throw error('Elige el mes');
  const corte = Number(await parametros.valor('nomina.dia_corte').catch(() => 25)) || 25;
  const hoy = calendario.hoy();
  const fin = `${periodo}-${String(corte).padStart(2, '0')}`;
  const diaMov = fin < hoy ? fin : hoy;
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'descuentos', accion: 'cambio', motivo: `Descuentos de la nómina de ${mesDe(periodo)} aplicados` }, async cli => {
    const lista_ = await repo.delPeriodo(cli, periodo);
    if (!lista_.length) throw error(`No hay ningún descuento aprobado en la nómina de ${mesDe(periodo)}`);
    let descontados = 0, aplazados = 0, total = 0;
    for (const d of lista_) {
      const x = dosDec(Math.min(d.a_descontar || d.saldo, d.saldo));
      let movimientoId = null;
      if (d.origen === 'efectivo') {
        const m = await cli.query(
          `INSERT INTO recaudacion_movimiento (conductor_id, fecha, tipo, importe, observacion, usuario_id)
           VALUES ($1, $2::date, 'nomina', $3, $4, $5) RETURNING id::text AS id`,
          [d.conductor_id, diaMov, x, `Descuento en la nómina de ${mesDe(periodo)} (descuento ${d.id})`.slice(0, 255), quien.usuarioId]);
        movimientoId = m.rows[0].id;
      }
      await repo.aplicacion(cli, { descuentoId: d.id, periodo, importe: x, movimientoId, usuarioId: quien.usuarioId });
      const saldo = dosDec(d.saldo - x);
      if (saldo > 0) {
        await repo.cambiar(cli, d.id, { saldo, estado: 'aplazado', periodo: siguiente(periodo), a_descontar: null });
        aplazados++;
      } else {
        await repo.cambiar(cli, d.id, { saldo: 0, estado: 'aplicado', a_descontar: null, cerrado_at: 'now', cerrado_por: quien.usuarioId });
      }
      descontados++;
      total = dosDec(total + x);
    }
    return { descontados, aplazados, total };
  });
  avisarCambio();
  return r;
}

// ── Los km del Banco de KM ─────────────────────────────────────────────────
/**
 * LOS KM DE UNA SEMANA CERRADA: a quien de la plantilla propia se pasó de su
 * límite, el exceso a `descuentos.km_euro` € por km, pendiente de aprobar. Una
 * por persona y semana. Si la semana aún no está calculada entera, no hace nada.
 * → { nuevos, semana } o { sinCalcular }
 */
async function kmDeLaSemana(lunes, { cli = null } = {}) {
  if (!await repo.hayTabla()) return { nuevos: 0 };
  const banco = require('../Operaciones/bancoKm.service');
  const s = await banco.semana(lunes);
  if (s.sinMigracion || s.faltan.length || s.dias.some(d => !d.cerrada)) return { sinCalcular: true, lunes };
  const precio = Number(await parametros.valor('descuentos.km_euro').catch(() => 1));
  if (!(precio > 0)) return { nuevos: 0, sinPrecio: true };
  const propias = new Set((await db.consulta(
    `SELECT DISTINCT conductor_id::text AS cid FROM conductor_periodo_empleo
      WHERE tipo = 'propia' AND alta <= $2::date AND (baja IS NULL OR baja >= $1::date)`, [s.lunes, s.domingo])).rows.map(x => x.cid));
  const pasados = s.conductores.filter(x => x.conductorId && propias.has(String(x.conductorId)) && x.km > x.limite);
  const bot = await require('./firmas.repo').bot();
  const firma = { usuarioId: bot, origen: 'descuentos · km', accion: 'alta', motivo: `Km fuera de la aplicación, semana del ${s.lunes}` };
  const hacer = async c => {
    let nuevos = 0;
    for (const x of pasados) {
      const origenId = `${x.conductorId}|${s.lunes}`;
      if (await repo.deOrigen(c, 'km', origenId)) continue;
      const exceso = Math.round((x.km - x.limite) * 10) / 10;
      const importe = dosDec(exceso * precio);
      if (!(importe > 0)) continue;
      await repo.insertar(c, {
        conductorId: Number(x.conductorId), origen: 'km', origenId, concepto: await conceptoDe('km'), importe,
        periodo: await periodoDe(s.domingo), fecha: s.domingo, creadoPor: bot,
        motivo: `Km fuera de la aplicación, semana del ${s.lunes.split('-').reverse().join('/')} al ${s.domingo.split('-').reverse().join('/')}: ${String(exceso).replace('.', ',')} km de más a ${String(precio).replace('.', ',')} €/km`,
        evidencia: { lunes: s.lunes, domingo: s.domingo, km: x.km, kmFuera: x.kmFuera, justificados: x.justificados, pendientesDeJustificar: x.pendientes,
          limite: x.limite, horasViaje: x.horasViaje, exceso, precio, matriculas: (x.matriculas || []).slice(0, 5) },
      });
      nuevos++;
    }
    return { nuevos, semana: s.lunes };
  };
  const r = await (cli ? libro.firmar(cli, firma).then(() => hacer(cli)) : libro.conFirma(firma, hacer));
  if (r.nuevos) avisarCambio();
  return r;
}

/** Las semanas cerradas desde KM_DESDE que aún no tienen sus km (cada día, por si la semana tardó en calcularse). */
async function kmPendientes({ cli = null, hoy = calendario.hoy() } = {}) {
  const hechos = [];
  for (let l = KM_DESDE; calendario.sumarDias(l, 6) < hoy; l = calendario.sumarDias(l, 7)) {
    hechos.push(await kmDeLaSemana(l, { cli }));
  }
  return { semanas: hechos };
}

tareasProgramadas.registrar({
  clave: 'descuentos.km',
  descripcion: 'Cada día a las 11:00, los km de más de cada semana cerrada del Banco de KM, como descuentos por aprobar',
  desde: '2026-11-30',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '11:00' }),
  hacer: ({ cli }) => kmPendientes({ cli }),
});

// ── Leer ───────────────────────────────────────────────────────────────────
async function lista(quien) {
  await exigir(quien, CLAVE_VER);
  const base = { origenes: ORIGENES, estados: ESTADOS };
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, ...base };
  const [filas, proponer, aprobar_] = await Promise.all([repo.lista(), puede(quien, CLAVE_PROPONER), puede(quien, CLAVE_APROBAR)]);
  return { filas: filas.map(d => ({ ...d, mes: mesDe(d.periodo) })), sinTabla: false, ...base,
    periodoActual: await periodoDe(calendario.hoy()), puede: { proponer, aprobar: aprobar_ } };
}

async function ficha(id, quien) {
  await exigir(quien, CLAVE_VER);
  const d = await cargar(null, id);
  const [aplic, aprobar_, suyo] = await Promise.all([repo.aplicaciones(d.id), puede(quien, CLAVE_APROBAR), esSuyo(d.id, quien.usuarioId)]);
  return { ...d, mes: mesDe(d.periodo), aplicaciones: aplic, puede: { aprobar: aprobar_, anularPropio: suyo && d.estado === 'pendiente' } };
}

async function personas(quien) {
  if (!await puede(quien, CLAVE_PROPONER) && !await puede(quien, CLAVE_RECAUDACION)) throw error('No tienes permiso para esto', 403);
  return { personas: await repo.personas() };
}

/** EL EXCEL DEL MES para la gestoría (hasta que llegue el lienzo): persona, concepto de A3 e importe. */
async function excelDelMes(periodo, quien) {
  await exigir(quien, CLAVE_VER);
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) throw error('Elige el mes');
  const ExcelJS = require('exceljs');
  const filas = (await db.consulta(
    `SELECT c.legajo, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, d.concepto, d.origen, d.motivo,
            LEAST(COALESCE(d.a_descontar, d.saldo), d.saldo)::float AS importe
       FROM descuento_nomina d JOIN conductor c ON c.id = d.conductor_id
      WHERE d.periodo = $1 AND d.estado IN ('aprobado', 'aplazado')
     UNION ALL
     SELECT c.legajo, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre), d.concepto, d.origen, d.motivo, a.importe::float
       FROM descuento_aplicacion a JOIN descuento_nomina d ON d.id = a.descuento_id JOIN conductor c ON c.id = d.conductor_id
      WHERE a.periodo = $1
      ORDER BY 2, 3`, [periodo])).rows;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Descuentos ${periodo}`);
  const cab = ws.addRow(['Legajo', 'Nombre', 'Concepto A3', 'Importe (€)', 'Origen', 'Motivo']);
  cab.font = { bold: true };
  filas.forEach(f => ws.addRow([f.legajo || '', f.nombre, f.concepto, f.importe, ORIGENES[f.origen].etiqueta, f.motivo]));
  [10, 36, 12, 12, 26, 80].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(4).numFmt = '#,##0.00';
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre: `Descuentos en nómina ${mesDe(periodo)}.xlsx` };
}

// ── Las pruebas (fotos del siniestro, el ticket, el parte…) ────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(PRUEBAS, {
  etiqueta: 'Pruebas de un descuento en nómina',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async q => (await puede(quienDe(q), CLAVE_PROPONER)) || puede(quienDe(q), CLAVE_APROBAR),
});

// ── El número del menú: los que esperan aprobación ─────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('descuentos'); }
contadores.registrarFuente('descuentos', {
  async contar(q) {
    const tiene = c => q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(c)));
    if (!tiene(CLAVE_APROBAR)) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.cuantos() : { pendientes: 0 })) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const n = (await cuenta.valor).pendientes;
    return { 'descuentos.pendientes': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'descuento' : 'descuentos'} en nómina por aprobar` } };
  },
});

module.exports = {
  crear, aprobar, anular, aplazar, cerrarMes, kmDeLaSemana, kmPendientes, lista, ficha, personas, excelDelMes, periodoDe, puede,
  ORIGENES, ESTADOS, CLAVE_VER, CLAVE_PROPONER, CLAVE_APROBAR,
};
