// ============================================================
// LAS VACACIONES DE LA OFICINA (db/263, 17/11/2026)
// ============================================================
// Camilo: «Vamos ahora con el módulo de vacaciones pero para los de la empresa,
// los que estén dentro de Telecab y tengan su fecha de alta … También que haya
// un simulador de vacaciones y que también escoja los días de libranza de cada
// quién. Los días de vacaciones se generan también igual, límite de 1,84 por
// mes, solo que sume los días de lunes a viernes como dicen los parámetros …
// No tengas en cuenta los fichajes sino los días que va trabajando hasta ahora,
// y que en el simulador, también sume los futuros días que ya tendrá generados
// para la fecha en que se va de vacas». Y eligió:
//
//   QUIÉN VE     cada uno las suyas; quien tiene la llave de Usuarios y permisos
//                (o el desarrollador), las de todos. Esa llave pone la fecha de
//                alta (en Usuarios) y aprueba.
//   GENERADAS    CADA MES COMPLETO, 1,84 JUSTOS (parámetro
//                oficina.vacaciones.tope_mes), tenga los días laborables que
//                tenga (17/11/2026, Camilo: «que el límite sea 1,84. Si se pasa,
//                se baja a 1,84 y si no alcanza, entonces que igual quede en
//                1,84»). El mes que aún no ha acabado (y el de su alta, si entró
//                a mitad) genera EL PROMEDIO por cada día real del horario de la
//                oficina (Parámetros: de lunes a viernes), aunque sea festivo o
//                esté de vacaciones, sin pasar de 1,84: el promedio es 1,84
//                entre los días del horario de un mes medio (5 × 365,25 / 7 / 12
//                = 21,74), 0,0846 por día («saca un promedio con eso, y que se
//                calculen los días así tal cual»). Hasta entonces, 0,084 por día
//                con un tope de 1,84. Sin fichajes. Quien entró antes de 2026
//                empieza el 01/01/2026, como los conductores.
//   GASTADAS     los días de unas vacaciones APROBADAS que no son sus dos días
//                de libranza (los elige al pedirlas) ni festivo de la oficina.
//                Las pasadas restan del saldo de hoy; las futuras, «programadas».
//   PEDIRLAS     desde el simulador, con sus dos días de libranza; las aprueba o
//                rechaza quien tiene la llave. Pedidas, no restan.
//   SIMULADOR    lo que gastaría y lo que tendría al empezar: lo de hoy MÁS lo
//                que generará hasta el día antes de irse, menos lo aprobado
//                (Camilo: «hoy tengo 10, pero si en el simulador pongo que
//                empiezo el otro mes las vacaciones, debe de contarme 11,84»),
//                y lo que le quedará al volver, con lo que genera durante las
//                vacaciones: cada día del calendario suma al banco con los días
//                reales de esa fecha («con el número promediado, súmale al banco
//                de vacaciones para que simule bien con los días reales»).
'use strict';

const libro = require('../../services/libro');
const calendario = require('../../services/calendario');
const parametros = require('../../services/parametros');
const permisos = require('../../services/permisos');
const contadores = require('../../services/contadores');
const repo = require('./vacacionesOficina.repo');

function conEstado(e, status) { e.status = status; return e; }
const error = (msg, status = 400) => conEstado(new Error(msg), status);

const ORIGEN = 'vacaciones_oficina';
// El promedio por día del horario: el tope entre los días de un mes medio.
const tasaDe = (tope, laborables) => tope / (laborables.length * 365.25 / 7 / 12);
const DESDE = '2026-01-01';            // todo empieza aquí, como en los conductores
const TOPE = 'oficina.vacaciones.tope_mes';
const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const URL = '/mis-vacaciones';

// ── Fechas en 'AAAA-MM-DD', sin husos ────────────────────────────────────────
const DIA = 86400000;
const ms = d => Date.parse(d + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);
const mas = (d, n) => iso(ms(d) + n * DIA);
const dow = d => { const w = new Date(ms(d)).getUTCDay(); return w === 0 ? 7 : w; };   // 1 = lunes … 7 = domingo
const r2 = n => Math.round(n * 100) / 100;
const max = (a, b) => (a > b ? a : b), min = (a, b) => (a < b ? a : b);
/** 'AAAA-MM' → el mes siguiente. */
const mesSiguiente = m => { const [y, mm] = m.split('-').map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; };
const esDia = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(ms(s));

/** Los dos días que libra: los que se digan, o los dos primeros que el horario no tiene (sábado y domingo). */
function dosDias(libra, laborables) {
  const dados = [...new Set([].concat(libra || []).map(Number))].filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
  if (dados.length === 2) return dados.sort((a, b) => a - b);
  if (dados.length) throw error('Elige dos días de libranza');
  const fuera = [1, 2, 3, 4, 5, 6, 7].filter(n => !laborables.includes(n));
  return (fuera.length >= 2 ? fuera.slice(-2) : [6, 7]).sort((a, b) => a - b);
}

/**
 * EL SALDO DE UNA PERSONA. Función pura (para probarla sin base):
 *   alta        'AAAA-MM-DD' (sin alta, no genera)
 *   vacaciones  [{ id, desde, hasta, libra_dias, estado }] suyas
 *   hoy, laborables [1..7] (el horario), festivos Set('AAAA-MM-DD'), tope
 */
function saldoDe({ alta, vacaciones = [], hoy, laborables, festivos = new Set(), tope }) {
  const inicio = alta ? max(alta, DESDE) : null;
  const tasa = tasaDe(tope, laborables);
  // Lo generado hasta un día: cada mes completo, el tope justo; el que no ha
  // acabado (o empezó con su alta a mitad), el promedio por cada día del
  // horario, sin pasar del tope. Se guarda lo de cada mes sin redondear.
  const meses = new Map();
  const generadasHasta = hasta => {
    if (!inicio || hasta < inicio) return { total: 0, meses: [] };
    const lista = [];
    for (let m = inicio.slice(0, 7); m <= hasta.slice(0, 7); m = mesSiguiente(m)) {
      const primero = m + '-01', ultimo = mas(mesSiguiente(m) + '-01', -1);
      const a = max(inicio, primero), b = min(hasta, ultimo);
      let dias = 0;
      for (let d = a; d <= b; d = mas(d, 1)) if (laborables.includes(dow(d))) dias++;
      const completo = a === primero && b === ultimo;
      const crudo = completo ? tope : Math.min(tope, tasa * dias);
      lista.push({ mes: m, dias, completo, crudo, generadas: r2(crudo) });
    }
    return { total: r2(lista.reduce((t, x) => t + x.crudo, 0)), meses: lista };
  };
  // Los días que gasta unas vacaciones entre a y b: ni sus dos de libranza ni festivos.
  const gasta = (v, a, b) => {
    let n = 0;
    for (let d = max(v.desde, a); d <= min(v.hasta, b); d = mas(d, 1)) {
      if (!(v.libra_dias || []).includes(dow(d)) && !festivos.has(d)) n++;
    }
    return n;
  };
  const hoyGen = generadasHasta(hoy);
  hoyGen.meses.forEach(x => meses.set(x.mes, { ...x, gastadas: 0 }));
  let disfrutadas = 0, programadas = 0, pedidas = 0;
  const lista = vacaciones.map(v => {
    const dias = gasta(v, v.desde, v.hasta);
    const pasados = v.estado === 'aprobada' ? gasta(v, v.desde, hoy) : 0;
    const futuros = v.estado === 'aprobada' ? gasta(v, mas(hoy, 1), v.hasta) : 0;
    disfrutadas += pasados; programadas += futuros;
    if (v.estado === 'pedida') pedidas += dias;
    if (pasados) {
      for (let d = v.desde; d <= min(v.hasta, hoy); d = mas(d, 1)) {
        if ((v.libra_dias || []).includes(dow(d)) || festivos.has(d)) continue;
        const m = meses.get(d.slice(0, 7));
        if (m) m.gastadas++;
      }
    }
    return { ...v, dias, pasados, futuros };
  });
  const saldo = r2(hoyGen.total - disfrutadas);
  return {
    inicio, generadas: hoyGen.total, disfrutadas, programadas, pedidas, saldo, saldoTras: r2(saldo - programadas),
    meses: [...meses.values()].map(({ crudo, ...x }) => x), vacaciones: lista, generadasHasta: d => generadasHasta(d).total,
    gasta, tasa,
  };
}

/**
 * EL SIMULADOR. Lo que gastarían unas vacaciones de `desde` a `hasta` librando
 * `libra`, y lo que tendría para usar al empezar: lo generado hasta el día
 * antes (si empiezan más adelante, también lo que aún no ha generado) menos
 * todo lo aprobado. Función pura, sobre el saldo de arriba.
 */
function simularSobre(s, { desde, hasta, libra, hoy, festivos = new Set(), vacaciones = [] }) {
  const dias = [];
  for (let d = desde; d <= hasta; d = mas(d, 1)) {
    const ya = vacaciones.find(v => (v.estado === 'aprobada' || v.estado === 'pedida') && v.desde <= d && v.hasta >= d);
    const libraEse = libra.includes(dow(d)), festivo = festivos.has(d);
    dias.push({ dia: d, dow: dow(d), libra: libraEse, festivo, ya: ya ? ya.estado : null, cuenta: !libraEse && !festivo });
  }
  const cuentan = dias.filter(d => d.cuenta).length;
  // Lo ya aprobado no se cuenta dos veces.
  const nuevos = dias.filter(d => d.cuenta && d.ya !== 'aprobada').length;
  const generadasAlEmpezar = desde > hoy ? s.generadasHasta(mas(desde, -1)) : s.generadas;
  const disponible = r2(generadasAlEmpezar - s.disfrutadas - s.programadas);
  // EL BANCO DE CADA DÍA DEL CALENDARIO: lo generado hasta ese día (con los
  // días reales de esa fecha), menos lo aprobado y lo que llevan gastado estas.
  let gastados = 0;
  for (const x of dias) {
    if (x.cuenta && x.ya !== 'aprobada') gastados++;
    const generado = x.dia > hoy ? s.generadasHasta(x.dia) : s.generadas;
    x.banco = r2(generado - s.disfrutadas - s.programadas - gastados);
  }
  const alVolver = dias.length ? dias[dias.length - 1].banco : disponible;
  return {
    desde, hasta, libra, naturales: dias.length, cuentan, nuevos,
    libranzas: dias.filter(d => d.libra).length, festivos: dias.filter(d => d.festivo && !d.libra).length,
    yaAprobadas: dias.filter(d => d.cuenta && d.ya === 'aprobada').length,
    yaPedidas: dias.filter(d => d.ya === 'pedida').length,
    saldoHoy: s.saldo, generaraHastaEntonces: r2(generadasAlEmpezar - s.generadas), programadas: s.programadas,
    disponible, quedaria: r2(disponible - nuevos), alVolver,
    generaDurante: r2(alVolver - (disponible - nuevos)), dias,
  };
}

// ── Lo de la base, junto ─────────────────────────────────────────────────────
async function puedeAprobar(quien) {
  if (!quien || !quien.id) return false;
  if (quien.rol === 'desarrollador') return true;
  return (await permisos.clavesDe(quien.id)).has('/usuarios');
}

// Los festivos que no gastan vacaciones: los del calendario de Madrid (los
// nacionales, los de la Comunidad y los locales de la oficina) y, de los años
// que aún no están cargados, el 1 de enero, que es seguro (17/11/2026, Camilo:
// «el festivo seguro del otro año es el 1 de enero»). Hasta dos años vista,
// lo que alcanza el simulador.
function festivosDe(cal, hoy) {
  const out = new Set(cal.festivos || []);
  const ano = Number(hoy.slice(0, 4));
  for (let a = ano; a <= ano + 2; a++) out.add(`${a}-01-01`);
  return out;
}

async function entorno() {
  const [cal, tope] = await Promise.all([calendario.de('madrid'), parametros.valor(TOPE).catch(() => 1.84)]);
  const hoy = calendario.hoy();
  return { hoy, laborables: [...cal.horario.dias], festivos: festivosDe(cal, hoy), tope: Number(tope) };
}

/** Lo de una persona: su saldo, sus vacaciones y los meses. Lanza 404 si no es de la oficina. */
async function deUna(usuarioId, e) {
  const p = await repo.persona(Number(usuarioId));
  if (!p) throw error('Esa persona no es de la oficina', 404);
  const vacs = (await repo.vacacionesDe([p.id])).get(p.id) || [];
  const s = saldoDe({ alta: p.alta, vacaciones: vacs, hoy: e.hoy, laborables: e.laborables, festivos: e.festivos, tope: e.tope });
  return { p, vacs, s };
}

const publica = (p, s, e) => ({
  id: p.id, nombre: p.nombre, alta: p.alta || null, inicio: s.inicio, hoy: e.hoy,
  generadas: s.generadas, disfrutadas: s.disfrutadas, programadas: s.programadas, pedidas: s.pedidas,
  saldo: s.saldo, saldoTras: s.saldoTras, meses: s.meses,
  vacaciones: s.vacaciones.map(v => ({
    id: v.id, desde: v.desde, hasta: v.hasta, libra: v.libra_dias, libraTexto: v.libra_dias.map(n => DIAS_SEMANA[n - 1]).join(' y '),
    estado: v.estado, nota: v.nota || '', dias: v.dias, pasados: v.pasados, futuros: v.futuros,
    resueltaPor: v.resuelta_por_nombre || null, resueltaNota: v.resuelta_nota || '', pedidaAt: v.pedida_at,
  })),
});

const reglas = e => ({
  tasa: tasaDe(e.tope, e.laborables), diasMes: r2(e.laborables.length * 365.25 / 7 / 12), tope: e.tope, desde: DESDE, laborables: e.laborables,
  laborablesTexto: e.laborables.map(n => DIAS_SEMANA[n - 1]).join(', '), libraPorDefecto: dosDias(null, e.laborables),
});

/** «Mis vacaciones»: las de quien mira (y si aprueba). */
async function mias(quien) {
  try {
    const e = await entorno();
    const { p, s } = await deUna(quien.id, e);
    return { ...publica(p, s, e), reglas: reglas(e), aprueba: await puedeAprobar(quien) };
  } catch (err) {
    if (repo.faltaMigracion(err)) return { sinMigracion: true };
    throw err;
  }
}

/** La de otra persona: solo quien aprueba. */
async function de(quien, usuarioId) {
  if (Number(usuarioId) !== quien.id && !await puedeAprobar(quien)) throw error('Solo ves tus vacaciones', 403);
  const e = await entorno();
  const { p, s } = await deUna(usuarioId, e);
  return { ...publica(p, s, e), reglas: reglas(e) };
}

/** Toda la oficina, con su saldo: solo quien aprueba. */
async function lista(quien) {
  if (!await puedeAprobar(quien)) throw error('Solo quien lleva Usuarios y permisos ve las de todos', 403);
  const e = await entorno();
  const gente = await repo.oficina();
  const vacs = await repo.vacacionesDe(gente.map(x => x.id));
  const filas = gente.map(p => {
    const s = saldoDe({ alta: p.alta, vacaciones: vacs.get(p.id) || [], hoy: e.hoy, laborables: e.laborables, festivos: e.festivos, tope: e.tope });
    return {
      id: p.id, nombre: p.nombre, puesto: p.puesto || '', alta: p.alta || null,
      generadas: s.generadas, disfrutadas: s.disfrutadas, programadas: s.programadas, saldo: s.saldo, saldoTras: s.saldoTras,
      porAprobar: s.vacaciones.filter(v => v.estado === 'pedida').length,
    };
  });
  return { filas, reglas: reglas(e) };
}

/**
 * EL CALENDARIO DE LA OFICINA (17/11/2026, Camilo: «Hazlo tipo calendario para
 * saber gráficamente quién se va y cuándo… ya hay algo parecido en bitácora
 * llamado "Vacaciones por meses", recicla ese»): lo que pinta la pieza global
 * VacacionesPorMeses. Las aprobadas y las que esperan de toda la oficina, con
 * sus dos días de libranza (no gastan), los festivos, y quién no tiene ni un
 * día este año. Solo quien aprueba.
 */
async function calendarioOficina(quien) {
  if (!await puedeAprobar(quien)) throw error('Solo quien lleva Usuarios y permisos ve las de todos', 403);
  const e = await entorno();
  const gente = await repo.oficina();
  const vacs = await repo.vacacionesDe(gente.map(x => x.id));
  const enero = e.hoy.slice(0, 4) + '-01-01';
  const periodos = [];
  const sinVacaciones = [];
  for (const p of gente) {
    const suyas = (vacs.get(p.id) || []).filter(v => v.estado === 'aprobada' || v.estado === 'pedida');
    suyas.forEach(v => periodos.push({
      id: p.id, nombre: p.nombre, detalle: p.puesto || '', desde: v.desde, hasta: v.hasta,
      pendiente: v.estado === 'pedida', libra: v.libra_dias || [],
    }));
    if (!suyas.some(v => v.hasta >= enero)) sinVacaciones.push({ id: p.id, nombre: p.nombre, detalle: p.puesto || (p.alta ? '' : 'Sin fecha de alta') });
  }
  return {
    hoy: e.hoy, desde: DESDE.slice(0, 7),
    festivos: [...e.festivos].filter(d => d >= DESDE).sort(),
    periodos, sinVacaciones,
    personas: gente.map(p => ({ id: p.id, nombre: p.nombre, alta: p.alta || null })),
  };
}

/** El simulador, para sí o (quien aprueba) para otra persona. */
async function simular(quien, { usuarioId = null, desde, hasta, libra } = {}) {
  const id = usuarioId == null || usuarioId === '' ? quien.id : Number(usuarioId);
  if (id !== quien.id && !await puedeAprobar(quien)) throw error('Solo simulas las tuyas', 403);
  if (!esDia(desde) || !esDia(hasta)) throw error('Faltan el primer y el último día');
  if (hasta < desde) throw error('El último día va antes que el primero');
  if (ms(hasta) - ms(desde) > 365 * DIA) throw error('Como mucho un año de una vez');
  const e = await entorno();
  const { p, vacs, s } = await deUna(id, e);
  if (!p.alta) throw error('Aún no tiene fecha de alta: la pone quien lleva Usuarios y permisos', 409);
  const dos = dosDias(libra, e.laborables);
  return {
    nombre: p.nombre,
    ...simularSobre(s, { desde, hasta, libra: dos, hoy: e.hoy, festivos: e.festivos, vacaciones: vacs }),
    libraTexto: dos.map(n => DIAS_SEMANA[n - 1]).join(' y '),
  };
}

// ── Pedir, aprobar, rechazar, retirar, anular ───────────────────────────────
let _push = null;
const push = () => (_push || (_push = require('../../services/notificacionesPush')));
const fecha = d => d.split('-').reverse().join('/');
async function avisar(ids, datos) {
  try { if (ids.length) await push().enviar(ids, { url: URL, ...datos }); } catch (e) { console.error('❌ [Vacaciones oficina] aviso:', e.message); }
  contadores.cambio(ORIGEN);
}

/** Pide unas vacaciones (para sí). Quedan «pedidas» hasta que se aprueben. */
async function pedir(quien, { desde, hasta, libra, nota } = {}) {
  const sim = await simular(quien, { desde, hasta, libra });
  const e = await entorno();
  if (desde < e.hoy) throw error('Las vacaciones se piden de hoy en adelante');
  if (!sim.cuentan) throw error('Esos días no gastan vacaciones (son libranzas o festivos)');
  const texto = String(nota || '').trim().slice(0, 1000);
  const id = await libro.conFirma({ usuarioId: quien.id, origen: ORIGEN, accion: 'alta' }, async cli => {
    if ((await repo.solapadas(cli, quien.id, desde, hasta)).length) throw error('Ya tienes vacaciones pedidas o aprobadas esos días', 409);
    return repo.insertar(cli, { usuarioId: quien.id, desde, hasta, libra: sim.libra, nota: texto, por: quien.id });
  });
  const aprueban = (await repo.aprobadores()).filter(x => x !== quien.id);
  await avisar(aprueban, { titulo: 'Vacaciones por aprobar', cuerpo: `${sim.nombre}: del ${fecha(desde)} al ${fecha(hasta)}, ${sim.cuentan} días`, etiqueta: `vac-oficina-${id}` });
  return { id, simulacion: sim };
}

/**
 * REGISTRAR UNAS YA DISFRUTADAS (17/11/2026, Camilo: «déjame registrar
 * vacaciones de la oficina del pasado, de tal a tal fecha el usuario disfrutó
 * X días, para que así se resten con los que tenga hoy en día… si me fui del
 * 20 al 30 de agosto, serían 7 días, ya que los sábados y domingos no
 * cuentan»). Solo quien aprueba, para cualquiera de la oficina (también para
 * sí). Entran ya aprobadas: gastan los días sin sus dos de libranza ni
 * festivos, como todas. Empiezan antes de hoy (las que vienen se piden) y
 * desde el 01/01/2026, cuando empieza la cuenta.
 */
async function registrar(quien, { usuarioId, desde, hasta, libra, nota } = {}) {
  if (!await puedeAprobar(quien)) throw error('Las registra quien lleva Usuarios y permisos', 403);
  const id = Number(usuarioId);
  if (!id) throw error('Falta de quién son');
  const e = await entorno();
  if (esDia(desde) && desde >= e.hoy) throw error('Aquí van las que ya empezaron: las que vienen se piden desde el simulador');
  if (esDia(desde) && desde < DESDE) throw error('La cuenta empieza el 01/01/2026: lo de antes no cuenta');
  const sim = await simular(quien, { usuarioId: id, desde, hasta, libra });
  if (!sim.cuentan) throw error('Esos días no gastan vacaciones (son libranzas o festivos)');
  const texto = String(nota || '').trim().slice(0, 1000);
  const nueva = await libro.conFirma({ usuarioId: quien.id, origen: ORIGEN, accion: 'alta', motivo: 'Vacaciones ya disfrutadas, registradas después' }, async cli => {
    if ((await repo.solapadas(cli, id, desde, hasta)).length) throw error('Ya tiene vacaciones pedidas o aprobadas esos días', 409);
    const vid = await repo.insertar(cli, { usuarioId: id, desde, hasta, libra: sim.libra, nota: texto, por: quien.id });
    await repo.resolver(cli, vid, { estado: 'aprobada', por: quien.id, nota: 'Ya disfrutadas: registradas después', desdeEstados: ['pedida'] });
    return vid;
  });
  await avisar(id !== quien.id ? [id] : [], { titulo: 'Vacaciones registradas', cuerpo: `Del ${fecha(desde)} al ${fecha(hasta)}: ${sim.cuentan} días, ya restados`, etiqueta: `vac-oficina-${nueva}` });
  return { id: nueva, dias: sim.cuentan, simulacion: sim };
}

async function cambiarEstado(quien, id, { estado, nota, desdeEstados, soloAprueba = true, propia = false }) {
  const v = await repo.vacacion(null, Number(id));
  if (!v) throw error('Esas vacaciones no existen', 404);
  const aprueba = await puedeAprobar(quien);
  if (soloAprueba && !aprueba) throw error('Las aprueba quien lleva Usuarios y permisos', 403);
  if (propia && v.usuario_id !== quien.id) throw error('Solo retiras las tuyas', 403);
  const hecho = await libro.conFirma({ usuarioId: quien.id, origen: ORIGEN, accion: estado === 'aprobada' ? 'aprobacion' : 'anulacion', motivo: nota || null },
    cli => repo.resolver(cli, v.id, { estado, por: quien.id, nota, desdeEstados }));
  if (!hecho) throw error(`Ya no se puede: están ${v.estado}`, 409);
  return v;
}

async function aprobar(quien, id) {
  const v = await cambiarEstado(quien, id, { estado: 'aprobada', desdeEstados: ['pedida'] });
  await avisar(v.usuario_id !== quien.id ? [v.usuario_id] : [], { titulo: 'Vacaciones aprobadas', cuerpo: `Del ${fecha(v.desde)} al ${fecha(v.hasta)}`, etiqueta: `vac-oficina-${v.id}` });
  return { ok: true };
}

async function rechazar(quien, id, { motivo } = {}) {
  const m = String(motivo || '').trim();
  if (m.length < 3) throw error('Di por qué no se aprueban: le llega a quien las pidió');
  const v = await cambiarEstado(quien, id, { estado: 'rechazada', nota: m.slice(0, 1000), desdeEstados: ['pedida'] });
  await avisar(v.usuario_id !== quien.id ? [v.usuario_id] : [], { titulo: 'Vacaciones no aprobadas', cuerpo: m, etiqueta: `vac-oficina-${v.id}` });
  return { ok: true };
}

/** Quien las pidió las retira mientras esperan. */
async function retirar(quien, id) {
  await cambiarEstado(quien, id, { estado: 'anulada', nota: 'La retiró quien la pidió', desdeEstados: ['pedida'], soloAprueba: false, propia: true });
  await avisar([], {});
  return { ok: true };
}

/** Quien aprueba anula unas ya aprobadas (con motivo). */
async function anular(quien, id, { motivo } = {}) {
  const m = String(motivo || '').trim();
  if (m.length < 3) throw error('Di por qué se anulan');
  const v = await cambiarEstado(quien, id, { estado: 'anulada', nota: m.slice(0, 1000), desdeEstados: ['aprobada'] });
  await avisar(v.usuario_id !== quien.id ? [v.usuario_id] : [], { titulo: 'Vacaciones anuladas', cuerpo: m, etiqueta: `vac-oficina-${v.id}` });
  return { ok: true };
}

// El número del menú: a quien aprueba, las que esperan.
contadores.registrarFuente(ORIGEN, {
  async contar(quien) {
    if (!await puedeAprobar(quien)) return {};
    try {
      const n = await repo.cuantasPedidas();
      return { 'vacaciones_oficina.pedidas': { n, tono: n ? 'aviso' : 'info', titulo: `${n} ${n === 1 ? 'petición' : 'peticiones'} de vacaciones por aprobar` } };
    } catch (e) {
      if (repo.faltaMigracion(e)) return {};
      throw e;
    }
  },
});

module.exports = {
  mias, de, lista, calendarioOficina, simular, registrar, pedir, aprobar, rechazar, retirar, anular, puedeAprobar,
  // Para las pruebas:
  _saldoDe: saldoDe, _simularSobre: simularSobre, _dosDias: dosDias, _tasaDe: tasaDe, DESDE,
};
