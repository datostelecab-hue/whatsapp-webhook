// ============================================================
// EL CIERRE DE LA NÓMINA DEL MES (módulo 4 del plan de RR. HH., db/299)
// ============================================================
// El mes de nómina (del 26 al 25, `nomina.dia_corte`) con sus cuatro etapas,
// cada una con su fecha (Camilo, 26/11/2026):
//
//   1. proforma   Proforma revisada            el 20. SE VE SOLA: la proforma
//                                              del mes subida y sin casos por
//                                              decidir en Gestoría › Proforma.
//   2. variables  Variables y descuentos       el 25 (el corte). Se marca a
//                 enviados a la gestoría       mano. Antes mira las líneas de
//                                              A3 preparadas (db/300), la
//                                              variable del mes congelada en
//                                              /nominas y los descuentos del
//                                              mes cerrados:
//                                              avisa, no frena (si falta algo,
//                                              la nota dice por qué).
//   3. borrador   Borrador revisado            el 28. A mano.
//   4. aprobada   Nómina aprobada              el 30 (o el último del mes).
//                                              Quien tiene '/gestoria/nomina'
//                                              (Ignacio), con las tres antes.
//
// Marcar 2 y 3 es de quien gestiona la gestoría ('/gestoria/gestionar').
// Deshacer pide motivo, y solo la última hecha (no se deshace la 2 con la 3
// marcada). Todo al libro.
//
// LAS TARJETAS: cada día a las 08:00 (`nomina.cierre`), de este mes y el
// anterior, para cada etapa sin hacer cuya fecha está a 3 días hábiles o
// menos, nace una tarjeta (tipo `nomina_cierre`, origen «AAAA-MM|etapa») a
// quien tiene la función «plantilla_gestoria»; la de aprobar, a quien tiene la
// llave. Se cierra sola al marcar la etapa. La de la proforma solo nace si aún
// no se ha subido: una vez subida, la lleva su propia tarjeta (db/296).
'use strict';

const repo = require('./cierre.repo');
const proformaRepo = require('./proforma.repo');
const gestoria = require('./gestoria.service');
const libro = require('../../services/libro');
const parametros = require('../../services/parametros');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const tareasProgramadas = require('../../services/tareasProgramadas');
const contadores = require('../../services/contadores');

const CLAVE_VER = '/gestoria';
const CLAVE_MARCAR = '/gestoria/gestionar';
const CLAVE_APROBAR = '/gestoria/nomina';
const TIPO_TARJETA = 'nomina_cierre';
// Desde cuándo se siguen los meses (el primero, noviembre de 2026).
const PRIMER_PERIODO = '2026-11';
const AVISO_DIAS_HABILES = 3;

const ETAPAS = [
  { clave: 'proforma', titulo: 'Proforma revisada', parametro: 'nomina.cierre_proforma', defecto: 20, sola: true,
    texto: 'La proforma de A3 subida en Gestoría › Proforma y todos sus casos decididos.' },
  { clave: 'variables', titulo: 'Variables y descuentos enviados', parametro: 'nomina.dia_corte', defecto: 25,
    texto: 'La variable del mes congelada en Nóminas y los descuentos del mes cerrados, mandados a la gestoría.' },
  { clave: 'borrador', titulo: 'Borrador revisado', parametro: 'nomina.cierre_borrador', defecto: 28,
    texto: 'El borrador de la nómina que devuelve la gestoría, revisado.' },
  { clave: 'aprobada', titulo: 'Nómina aprobada', parametro: 'nomina.cierre_aprobada', defecto: 30,
    texto: 'La nómina del mes aprobada para pagarla.' },
];
const ETAPA = Object.fromEntries(ETAPAS.map((e, i) => [e.clave, { ...e, orden: i }]));
const A_MANO = ['variables', 'borrador', 'aprobada'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = p => `${MESES[Number(p.slice(5, 7)) - 1]} de ${p.slice(0, 4)}`;
const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const exigir = async (quien, clave, msg) => { if (!await gestoria.puede(quien, clave)) throw error(msg || 'No tienes permiso para esto', 403); };
const esPeriodo = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''));
const anterior = p => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const siguiente = p => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const diaDe = async (parametro, defecto) => {
  const n = Number(await parametros.valor(parametro).catch(() => defecto));
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : defecto;
};

/** El mes de nómina de un día: hasta el corte, el suyo; después, el siguiente. */
async function periodoDe(iso) {
  const corte = await diaDe('nomina.dia_corte', 25);
  const [y, m, d] = iso.split('-').map(Number);
  const p = `${y}-${String(m).padStart(2, '0')}`;
  return d <= corte ? p : siguiente(p);
}

/** La fecha de cada etapa de un mes: el día del parámetro, sin pasar del último del mes. */
async function fechas(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = {};
  for (const e of ETAPAS) out[e.clave] = `${periodo}-${String(Math.min(await diaDe(e.parametro, e.defecto), ultimo)).padStart(2, '0')}`;
  return out;
}

/** La proforma del mes: sin subir, con casos por decidir, o revisada. */
async function proformaDe(periodo, cli = null) {
  try {
    const carga = await proformaRepo.ultimaCarga(periodo);
    if (!carga) return { subida: false, quedan: 0, hecha: false, detalle: 'Sin subir' };
    const quedan = await proformaRepo.quedanDe(cli, periodo);
    return { subida: true, quedan, hecha: quedan === 0,
      detalle: quedan ? `${quedan} ${quedan === 1 ? 'caso' : 'casos'} por decidir` : `Revisada («${carga.nombre}»)` };
  } catch (_) {
    return { subida: false, quedan: 0, hecha: false, detalle: 'Sin subir' };
  }
}

/** Lo que se mira antes de mandar las variables: la variable del mes y los descuentos. */
async function requisitosVariables(periodo, cli = null) {
  const [y, m] = periodo.split('-').map(Number);
  const nominas = require('../Nominas/nominas.service');
  const congelada = (await nominas.mesesCongelados().catch(() => [])).some(x => Number(x.mes) === m && Number(x.ano) === y);
  const d = await repo.descuentosAbiertos(cli, periodo);
  const abiertos = d ? d.por_aprobar + d.por_descontar : 0;
  // Las líneas del lienzo de A3 (db/300), preparadas en la pestaña «Variables».
  const lineas = await require('./variables.repo').cuantasDelMes(cli, periodo).catch(() => null);
  return [
    { clave: 'lineas', ok: !!lineas,
      texto: lineas == null ? 'Las variables de A3 aún no están (falta la migración 300)'
        : lineas ? `Variables de A3 preparadas (${lineas} ${lineas === 1 ? 'línea' : 'líneas'})` : 'Las variables de A3 no están preparadas (pestaña «Variables»)' },
    { clave: 'variable', texto: congelada ? 'Variable del mes congelada en Nóminas' : 'La variable del mes no está congelada en Nóminas', ok: congelada },
    { clave: 'descuentos', ok: !!d && abiertos === 0,
      texto: !d ? 'Los descuentos en nómina aún no están (falta la migración 298)'
        : abiertos === 0 ? (d.descontados ? 'Descuentos del mes cerrados' : 'Sin descuentos abiertos este mes')
          : `Descuentos sin cerrar: ${d.por_aprobar} por aprobar y ${d.por_descontar} por descontar` },
  ];
}

/** El mes entero: sus etapas, con su fecha, quién y cuándo, y si va con retraso. */
async function estado(periodo, quien = null, { cli = null, ligero = false } = {}) {
  const hoy = calendario.hoy();
  const [vivas, fec, pro, req] = await Promise.all([
    repo.vivas(cli, periodo), fechas(periodo), proformaDe(periodo, cli), ligero ? null : requisitosVariables(periodo, cli),
  ]);
  const etapas = ETAPAS.map(e => {
    const v = vivas.get(e.clave);
    const hecha = e.sola ? pro.hecha : !!v;
    return {
      clave: e.clave, titulo: e.titulo, texto: e.texto, sola: !!e.sola,
      venceEl: fec[e.clave], vence: dmy(fec[e.clave]), hecha,
      retraso: !hecha && hoy > fec[e.clave],
      cuando: v ? v.hecho : null, por: v ? v.hecho_por_nombre : null, nota: v ? v.nota : null,
      detalle: e.sola ? pro.detalle : null,
      requisitos: e.clave === 'variables' ? req : null,
    };
  });
  // La que toca: la primera sin hacer.
  const toca = etapas.find(e => !e.hecha);
  if (toca) toca.toca = true;
  return { periodo, mes: mesDe(periodo), desde: dmy(`${anterior(periodo)}-26`), hasta: dmy(`${periodo}-25`),
    etapas, hechas: etapas.filter(e => e.hecha).length, cerrado: etapas.every(e => e.hecha) };
}

/** Para la pestaña: el mes que se pide (o el que está en curso) y los meses que se pueden mirar. */
async function vista({ periodo } = {}, quien) {
  await exigir(quien, CLAVE_VER);
  const hay = await repo.hayTabla();
  const actual = await periodoDe(calendario.hoy());
  // El que está en curso; si el anterior aún no está cerrado, ese primero.
  let p = esPeriodo(periodo) ? periodo : actual;
  if (!esPeriodo(periodo) && hay && anterior(actual) >= PRIMER_PERIODO) {
    const ant = await estado(anterior(actual), quien);
    if (!ant.cerrado) p = anterior(actual);
  }
  const meses = [];
  for (let x = siguiente(actual); x >= PRIMER_PERIODO && meses.length < 12; x = anterior(x)) meses.push({ periodo: x, mes: mesDe(x) });
  const [puedeMarcar, puedeAprobar] = await Promise.all([gestoria.puede(quien, CLAVE_MARCAR), gestoria.puede(quien, CLAVE_APROBAR)]);
  if (!hay) return { sinTabla: true, meses, periodo: p, puedeMarcar, puedeAprobar };
  return { ...(await estado(p, quien)), meses, actual, puedeMarcar, puedeAprobar,
    historia: await repo.deshechas(p) };
}

const tarjetaId = (periodo, etapa) => `${periodo}|${etapa}`;

/** Marca una etapa hecha. `nota` hace falta si se mandan las variables sin estar todo. */
async function marcar({ periodo, etapa, nota } = {}, quien) {
  if (!esPeriodo(periodo)) throw error('Elige el mes');
  if (!A_MANO.includes(etapa)) throw error('Esa etapa no se marca a mano');
  if (!await repo.hayTabla()) throw error('Falta aplicar la migración 299');
  if (etapa === 'aprobada') await exigir(quien, CLAVE_APROBAR, 'Aprobar la nómina del mes es de quien tiene la llave «Gestoría · aprobar la nómina del mes»');
  else await exigir(quien, CLAVE_MARCAR, 'Marcar las etapas del cierre es de quien gestiona la gestoría');
  const n = String(nota || '').trim().slice(0, 2000);
  const e = await estado(periodo, quien);
  const ya = e.etapas.find(x => x.clave === etapa);
  if (ya.hecha) throw error(`«${ya.titulo}» ya está marcada`, 409);
  const antes = e.etapas.filter(x => ETAPA[x.clave].orden < ETAPA[etapa].orden && !x.hecha);
  if (etapa === 'aprobada' && antes.length) throw error(`Antes de aprobarla falta: ${antes.map(x => x.titulo.toLowerCase()).join(', ')}`);
  if (etapa === 'borrador' && antes.some(x => x.clave === 'variables')) throw error('Primero, las variables y los descuentos enviados');
  if (etapa === 'variables') {
    const faltan = ya.requisitos.filter(r => !r.ok);
    if (faltan.length && n.length < 3) {
      throw error(`${faltan.map(r => r.texto).join('. ')}. Si se mandan igual, di por qué en la nota.`);
    }
  }
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · cierre', accion: 'cambio',
    motivo: `Cierre de la nómina de ${mesDe(periodo)}: ${ya.titulo.toLowerCase()}` }, async cli => {
    await repo.marcar(cli, { periodo, etapa, nota: n, usuarioId: quien.usuarioId });
    await tablero.cerrarPorOrigen(cli, { tipo: TIPO_TARJETA, origenId: tarjetaId(periodo, etapa), autorId: quien.usuarioId, nota: 'Marcada en Gestoría › Cierre' });
  });
  retrasos = null;
  contadores.cambio('gestoria_cierre');
  return { ok: true, estado: await estado(periodo, quien) };
}

/** Deshace la última etapa hecha, con motivo. */
async function deshacer({ periodo, etapa, motivo } = {}, quien) {
  if (!esPeriodo(periodo)) throw error('Elige el mes');
  if (!A_MANO.includes(etapa)) throw error('Esa etapa no se marca a mano');
  if (etapa === 'aprobada') await exigir(quien, CLAVE_APROBAR, 'Reabrir la nómina aprobada es de quien la aprueba');
  else await exigir(quien, CLAVE_MARCAR, 'Deshacer las etapas del cierre es de quien gestiona la gestoría');
  const m = String(motivo || '').trim();
  if (m.length < 3) throw error('Di por qué se deshace');
  const e = await estado(periodo, quien);
  const despues = e.etapas.filter(x => A_MANO.includes(x.clave) && ETAPA[x.clave].orden > ETAPA[etapa].orden && x.hecha);
  if (despues.length) throw error(`Primero hay que deshacer «${despues[despues.length - 1].titulo}»`);
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · cierre', accion: 'cambio',
    motivo: `Cierre de la nómina de ${mesDe(periodo)}: se deshace «${ETAPA[etapa].titulo.toLowerCase()}». ${m}` }, async cli => {
    if (!await repo.deshacer(cli, { periodo, etapa, motivo: m.slice(0, 2000), usuarioId: quien.usuarioId })) throw error('Esa etapa no está marcada', 409);
  });
  retrasos = null;
  contadores.cambio('gestoria_cierre');
  return { ok: true, estado: await estado(periodo, quien) };
}

// ── Las tarjetas ─────────────────────────────────────────────────────────────
tablero.registrarTipo(TIPO_TARJETA, { etiqueta: 'Cierre de la nómina', abrir: 'Abrir el cierre', cierreManual: false });

const TITULOS = {
  proforma: m => `Subir y revisar la proforma de ${m}`,
  variables: m => `Mandar a la gestoría las variables y los descuentos de ${m}`,
  borrador: m => `Revisar el borrador de la nómina de ${m}`,
  aprobada: m => `Aprobar la nómina de ${m}`,
};

/** Las tarjetas de este mes y del anterior: nacen a 3 días hábiles de su fecha. */
async function tarjetas({ cli = null, hoy = calendario.hoy() } = {}) {
  if (!await repo.hayTabla(cli)) return { nacidas: 0, sinTabla: true };
  const cal = await calendario.de('madrid');
  const actual = await periodoDe(hoy);
  const gestor = ((await organizacion.quienes('plantilla_gestoria', { conSuplentes: false }).catch(() => []))[0] || {}).id || null;
  const aprobador = (await gestoriaAprobadores(cli))[0] || null;
  let nacidas = 0;
  for (const periodo of [anterior(actual), actual]) {
    if (periodo < PRIMER_PERIODO) continue;
    const e = await estado(periodo, null, { cli });
    for (const x of e.etapas) {
      const origenId = tarjetaId(periodo, x.clave);
      // La proforma subida la lleva su propia tarjeta (Gestoría › Proforma).
      const pro = x.clave === 'proforma' && x.detalle !== 'Sin subir';
      if (x.hecha || pro) {
        await tablero.cerrarPorOrigen(cli, { tipo: TIPO_TARJETA, origenId, nota: x.hecha ? 'Hecha' : 'La proforma ya está subida' });
        continue;
      }
      const faltan = x.venceEl > hoy ? cal.diasHabilesEntre(hoy, x.venceEl) : 0;
      if (faltan > AVISO_DIAS_HABILES) continue;
      const r = await tablero.nacer(cli, {
        tipo: TIPO_TARJETA, origenId, sensible: true, enlace: `/gestoria?vista=cierre&periodo=${periodo}`,
        titulo: TITULOS[x.clave](mesDe(periodo)),
        descripcion: `${x.texto} Fecha del cierre: ${x.vence}.`,
        responsableId: x.clave === 'aprobada' ? aprobador : gestor, plazoDias: faltan,
      });
      if (r.nueva) nacidas++;
    }
  }
  return { nacidas };
}

async function gestoriaAprobadores(cli) {
  const db = require('../../services/db');
  const r = await (cli ? cli.query.bind(cli) : db.consulta)(
    `SELECT p.usuario_id AS id FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.clave = $1 AND u.estado = 'activo' ORDER BY p.usuario_id`, [CLAVE_APROBAR]);
  return r.rows.map(x => Number(x.id));
}

tareasProgramadas.registrar({
  clave: 'nomina.cierre',
  descripcion: 'Cada día a las 08:00, las tarjetas del cierre de la nómina (este mes y el anterior), a 3 días hábiles de cada fecha',
  desde: '2026-11-27',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '08:00' }),
  hacer: ({ cli }) => tarjetas({ cli }),
});

// El número de la pestaña: las etapas con retraso del mes en curso y del
// anterior. Es el mismo para todos: se cuenta una vez por minuto (o al marcar).
let retrasos = null;
async function contarRetrasos() {
  if (retrasos && Date.now() - retrasos.at < 60000) return retrasos.n;
  if (!await repo.hayTabla()) return null;
  const actual = await periodoDe(calendario.hoy());
  let n = 0;
  for (const p of [anterior(actual), actual]) {
    if (p < PRIMER_PERIODO) continue;
    n += (await estado(p, null, { ligero: true })).etapas.filter(e => e.retraso).length;
  }
  retrasos = { n, at: Date.now() };
  return n;
}
contadores.registrarFuente('gestoria_cierre', {
  async contar(q) {
    const ve = q && (q.permisos === null || ['superadmin', 'desarrollador'].includes(q.rol)
      || (Array.isArray(q.permisos) && q.permisos.includes(CLAVE_VER)));
    if (!ve) return {};
    const n = await contarRetrasos();
    if (n == null) return {};
    return { 'gestoria.cierre': { n, tono: n ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'etapa' : 'etapas'} del cierre con retraso` } };
  },
});

module.exports = { ETAPAS, CLAVE_APROBAR, CLAVE_MARCAR, TIPO_TARJETA, periodoDe, fechas, estado, vista, marcar, deshacer, tarjetas };
