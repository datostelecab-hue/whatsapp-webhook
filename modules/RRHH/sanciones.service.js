// ============================================================
// FALTAS Y SANCIONES — LA PUERTA (módulo 3, db/295, 25/11/2026)
// ============================================================
// Camilo (25/11/2026):
//   · ABRE la oficina (llave '/disciplina/abrir': Tráfico, Control, Taller,
//     RR. HH.), con los hechos y sus pruebas. APRUEBAN Ángel, William o Ignacio
//     ('/disciplina/aprobar'), dentro de la horquilla del convenio. Después
//     DIANA prepara la carta ('/disciplina/carta').
//   · El ERP PROPONE: las ausencias que RR. HH. da por injustificadas (por mes
//     natural: 1 día leve, 2 grave, 4 muy grave) y la reincidencia (3 leves en
//     un trimestre, 2 graves en un semestre). Nunca sanciona solo: una persona
//     la abre o la descarta.
//   · LA CARTA, con una plantilla de YouTrust con huecos (sin IA): los hechos los
//     escribe quien la abre; la calificación y la sanción, el ERP. Va por la cola
//     de Firmas (db/293), firma con código por SMS.
//   · UNA SUSPENSIÓN entra en el planificador (situación «suspendido») cuando la
//     carta queda firmada, o cuando no la firma o caduca: en los tres casos ya
//     está comunicada.
'use strict';

const repo = require('./sanciones.repo');
const firmasRepo = require('./firmas.repo');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const contadores = require('../../services/contadores');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const adjuntos = require('../../services/adjuntos');
const calendario = require('../../services/calendario');
const parametros = require('../../services/parametros');
const tareasProgramadas = require('../../services/tareasProgramadas');
const { diaLargo } = require('./comunicaciones');

const CLAVE_VER = '/disciplina';
const CLAVE_ABRIR = '/disciplina/abrir';
const CLAVE_APROBAR = '/disciplina/aprobar';
const CLAVE_CARTA = '/disciplina/carta';
const TOTAL = ['superadmin', 'desarrollador'];
const T_PROPUESTA = 'sancion_propuesta';
const T_APROBAR = 'sancion_aprobar';
const T_CARTA = 'sancion_carta';
const T_SITUACION = 'sancion_situacion';
const PRUEBAS = 'sancion';
// Las ausencias que valida RR. HH. empiezan el 26/10/2026 (db/289).
const DESDE = '2026-10-26';

// La horquilla del art. 39 por gravedad (la misma en todas sus reglas) y la
// prescripción del art. 60.2 del Estatuto (días naturales desde que la empresa
// lo supo; aquí, desde los hechos, como aviso).
const GRAVEDAD = {
  LEVE: { etiqueta: 'Leve', tono: 'warn', amonestacion: true, min: 1, max: 2, prescribe: 10 },
  GRAVE: { etiqueta: 'Grave', tono: 'red', amonestacion: false, min: 3, max: 30, prescribe: 20 },
  MUY_GRAVE: { etiqueta: 'Muy grave', tono: 'red', amonestacion: false, min: 31, max: 60, prescribe: 60 },
};
// Lo que dice la carta de cada falta del catálogo (el texto de la base va sin acentos).
const FALTAS = {
  ABS_1D: 'Una falta de asistencia al trabajo sin justificar en el periodo de un mes',
  ABS_2D: 'Dos faltas de asistencia al trabajo sin justificar, consecutivas o alternas, en el periodo de un mes',
  ABS_4D: 'Cuatro o más faltas de asistencia al trabajo sin justificar, consecutivas o alternas, en el periodo de un mes',
  REJ_3: 'El rechazo injustificado de servicios, tres veces en un mes',
  REJ_4_6: 'El rechazo injustificado de servicios, entre cuatro y seis veces en un mes',
  REJ_7: 'El rechazo injustificado de servicios, siete o más veces en un mes',
  LOW_CONN: 'La disminución no reiterada del rendimiento, incluida la conexión en tiempo notoriamente insuficiente',
  LOW_CONT: 'La disminución voluntaria y continuada del rendimiento',
  PERS_USE: 'El uso del vehículo de la empresa para fines personales',
  CASH_MISS: 'La falta de ingreso de las cantidades recaudadas a los clientes, salvo causa debidamente justificada',
  NO_REPORT: 'No comunicar a la empresa una incidencia o un accidente',
  DAMAGE: 'Los daños al vehículo en un accidente, mediando dolo o negligencia',
  RECID_L: 'La reincidencia: tres o más faltas leves sancionadas en un trimestre',
  RECID_G: 'La reincidencia: dos faltas graves sancionadas en un semestre',
};
const MEDIDAS = { amonestacion: 'Amonestación por escrito', suspension: 'Suspensión de empleo y sueldo' };
const ESTADOS = {
  propuesta: { etiqueta: 'Propuesta por el ERP', tono: 'warn' },
  abierta: { etiqueta: 'Por aprobar', tono: 'gold' },
  aprobada: { etiqueta: 'Carta por preparar', tono: 'azul' },
  en_firma: { etiqueta: 'Carta en firma', tono: 'azul' },
  comunicada: { etiqueta: 'Comunicada', tono: 'green' },
  descartada: { etiqueta: 'Descartada', tono: 'muted' },
};

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const texto = (v, max = 4000) => String(v == null ? '' : v).trim().slice(0, max);
const esIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dmy = iso => (iso ? iso.split('-').reverse().join('/') : '');

async function puede(quien, llave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol) && llave === CLAVE_VER) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(llave); } catch (_) { return false; }
}
const exigir = async (quien, llave, que) => { if (!await puede(quien, llave)) throw error(que || 'No tienes permiso para esto', 403); };

async function cargar(cli, id) {
  const s = await repo.porId(String(id), cli);
  if (!s) throw error('No existe esa sanción', 404);
  return s;
}

/** La horquilla de una gravedad, en palabras. */
function horquilla(gravedad) {
  const g = GRAVEDAD[gravedad];
  if (!g) return '';
  return `${g.amonestacion ? 'amonestación por escrito o ' : ''}suspensión de empleo y sueldo de ${g.min} a ${g.max} días${gravedad === 'MUY_GRAVE' ? ' (o despido, que se lleva aparte con Legal)' : ''}`;
}

/** Lo que va en los huecos de la carta (la plantilla de YouTrust «Carta de sanción»). */
function textosCarta(s, { hoy = calendario.hoy() } = {}) {
  const g = GRAVEDAD[s.gravedad] || {};
  const sancion = s.medida === 'suspension'
    ? `${MEDIDAS.suspension} de ${s.dias} ${Number(s.dias) === 1 ? 'día' : 'días'}${s.suspension_desde
      ? `, del ${diaLargo(s.suspension_desde)} al ${diaLargo(s.suspension_hasta)}, ambos incluidos` : ''}.`
    : `${MEDIDAS.amonestacion}.`;
  return {
    fecha: diaLargo(hoy),
    hechos: texto(s.hechos),
    calificacion: `Falta ${String(g.etiqueta || '').toLowerCase()}${s.articulo ? `, ${s.articulo.replace(/^Art\./, 'artículo')} del convenio colectivo` : ''}: ${s.falta}.`,
    sancion,
  };
}

/** El día en que prescribe (art. 60.2 ET), contado desde los hechos. */
const prescribe = s => (GRAVEDAD[s.gravedad] && esIso(s.fecha_hechos) ? calendario.sumarDias(s.fecha_hechos, GRAVEDAD[s.gravedad].prescribe) : null);

// ── Las tarjetas ───────────────────────────────────────────────────────────
tablero.registrarTipo(T_PROPUESTA, { etiqueta: 'Falta propuesta por el ERP', abrir: 'Abrirla o descartarla', cierreManual: false });
tablero.registrarTipo(T_APROBAR, { etiqueta: 'Sanción por aprobar', abrir: 'Decidir la sanción', cierreManual: false });
tablero.registrarTipo(T_CARTA, { etiqueta: 'Carta de sanción', abrir: 'Preparar la carta', cierreManual: false });
tablero.registrarTipo(T_SITUACION, { etiqueta: 'Suspensión por poner', abrir: 'Ponerla en su ficha', cierreManual: true });

const primero = async funcion => {
  const t = await organizacion.quienes(funcion, { conSuplentes: false }).catch(() => []);
  return t.length ? t[0].id : null;
};
async function tarjeta(cli, tipo, s, { titulo, descripcion, plazoDias = 1, funcion }) {
  await tablero.nacer(cli, {
    tipo, origenId: String(s.id), enlace: `/disciplina#${s.id}`, sensible: true,
    titulo: titulo.slice(0, 200), descripcion, responsableId: await primero(funcion), plazoDias,
  });
}
const cerrarTarjeta = (cli, tipo, id, autorId, nota) => tablero.cerrarPorOrigen(cli, { tipo, origenId: String(id), autorId, nota });
const cerrarTodas = async (cli, id, autorId, nota) => {
  for (const t of [T_PROPUESTA, T_APROBAR, T_CARTA]) await cerrarTarjeta(cli, t, id, autorId, nota);
};
const tarjetaAprobar = (cli, s) => tarjeta(cli, T_APROBAR, s, {
  titulo: `Sanción por aprobar: ${s.nombre}`, funcion: 'sanciones_aprobar', plazoDias: 2,
  descripcion: `Falta ${GRAVEDAD[s.gravedad].etiqueta.toLowerCase()} (${s.articulo || 'sin artículo'}). Lee los hechos y las pruebas y decide: ${horquilla(s.gravedad)}.`,
});

// ── Abrir ──────────────────────────────────────────────────────────────────
/** Lo que define la falta: una regla del catálogo, o la gravedad y la descripción a mano. */
async function laFalta({ regla, gravedad, falta }) {
  if (regla) {
    const r = (await repo.reglas()).find(x => x.codigo === regla);
    if (!r) throw error('Esa falta no está en el catálogo del convenio');
    return { regla: r.codigo, gravedad: r.gravedad, articulo: r.articulo, falta: FALTAS[r.codigo] || r.nota };
  }
  if (!GRAVEDAD[gravedad]) throw error('Elige la falta del convenio, o di su gravedad');
  const f = texto(falta, 400);
  if (f.length < 5) throw error('Describe la falta');
  return { regla: null, gravedad, articulo: 'Art. 39', falta: f };
}

/** ABRIR una sanción a mano: la persona, la falta, cuándo y qué pasó. → { id } (las pruebas se suben en su ficha) */
async function crear({ conductorId, regla, gravedad, falta, fechaHechos, hechos } = {}, quien = {}) {
  await exigir(quien, CLAVE_ABRIR, 'Abrir una sanción es de quien tiene la llave «Sanciones · abrir»');
  if (!esIso(fechaHechos) || fechaHechos > calendario.hoy()) throw error('Di el día de los hechos (hoy o antes)');
  const h = texto(hechos);
  if (h.length < 10) throw error('Cuenta qué pasó: es lo que dirá la carta');
  const f = await laFalta({ regla, gravedad, falta });
  const persona = (await repo.personas()).find(p => p.id === String(conductorId));
  if (!persona) throw error('No encuentro a esa persona');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sanciones', accion: 'alta', motivo: `Sanción abierta: ${f.falta}` }, async cli => {
    const id = await repo.insertar(cli, { conductorId: Number(conductorId), ...f, fechaHechos, hechos: h, abiertaPor: quien.usuarioId, creadoPor: quien.usuarioId });
    await tarjetaAprobar(cli, { id, nombre: persona.nombre, ...f });
    return { id };
  });
  avisarCambio();
  return r;
}

/** ABRIR la que propuso el ERP: con los hechos revisados (vienen escritos). */
async function abrir(id, { hechos } = {}, quien = {}) {
  await exigir(quien, CLAVE_ABRIR, 'Abrir una sanción es de quien tiene la llave «Sanciones · abrir»');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sanciones', accion: 'cambio', motivo: 'Abierta la falta que propuso el ERP' }, async cli => {
    const s = await cargar(cli, id);
    if (s.estado !== 'propuesta') throw error('Solo se abre la que está propuesta', 409);
    const h = texto(hechos) || s.hechos;
    if (!h || h.length < 10) throw error('Cuenta qué pasó: es lo que dirá la carta');
    await repo.cambiar(cli, s.id, { estado: 'abierta', hechos: h, abierta_por: quien.usuarioId, abierta_at: 'now' });
    await cerrarTarjeta(cli, T_PROPUESTA, s.id, quien.usuarioId, 'Abierta: pasa a aprobación');
    await tarjetaAprobar(cli, s);
    return { estado: 'abierta' };
  });
  avisarCambio();
  return r;
}

// ── Aprobar ────────────────────────────────────────────────────────────────
/** APROBAR: la sanción, dentro de la horquilla del convenio. Desde ahí corre el plazo para comunicarla. */
async function aprobar(id, { medida, dias, nota } = {}, quien = {}) {
  await exigir(quien, CLAVE_APROBAR, 'Aprobar sanciones es de quien tiene la llave «Sanciones · aprobar»');
  const plazo = Number(await parametros.valor('sanciones.plazo_dias_habiles')) || 5;
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sanciones', accion: 'cambio', motivo: `Sanción aprobada${texto(nota) ? `: ${texto(nota)}` : ''}` }, async cli => {
    const s = await cargar(cli, id);
    if (s.estado !== 'abierta') throw error('Solo se aprueba la que está por aprobar', 409);
    const g = GRAVEDAD[s.gravedad];
    if (!MEDIDAS[medida]) throw error('Elige la sanción');
    if (medida === 'amonestacion' && !g.amonestacion) throw error(`Una falta ${g.etiqueta.toLowerCase()} no se queda en amonestación: ${horquilla(s.gravedad)}`);
    let d = null;
    if (medida === 'suspension') {
      d = Number(dias);
      if (!Number.isInteger(d) || d < g.min || d > g.max) throw error(`Para una falta ${g.etiqueta.toLowerCase()}, la suspensión va de ${g.min} a ${g.max} días`);
    }
    const cal = await calendario.de('madrid');
    const antes = cal.sumarDiasHabiles(calendario.hoy(), plazo);
    await repo.cambiar(cli, s.id, { estado: 'aprobada', medida, dias: d, decision_nota: texto(nota) || null, aprobada_at: 'now', aprobada_por: quien.usuarioId, comunicar_antes: antes });
    await cerrarTarjeta(cli, T_APROBAR, s.id, quien.usuarioId, 'Aprobada');
    await tarjeta(cli, T_CARTA, s, {
      titulo: `Carta de sanción: ${s.nombre}`, funcion: 'sanciones_rrhh', plazoDias: plazo,
      descripcion: `${MEDIDAS[medida]}${d ? ` de ${d} días` : ''}. Prepara la carta${d ? ' con las fechas de la suspensión' : ''} y mándala a firmar antes del ${dmy(antes)}.`,
    });
    return { estado: 'aprobada', comunicarAntes: antes };
  });
  avisarCambio();
  return r;
}

/** DESCARTAR: la propuesta (quien abre) o la abierta o aprobada sin carta (quien aprueba). */
async function descartar(id, { nota } = {}, quien = {}) {
  const n = texto(nota, 2000);
  if (n.length < 3) throw error('Di por qué se descarta');
  const s0 = await cargar(null, id);
  await exigir(quien, s0.estado === 'propuesta' ? CLAVE_ABRIR : CLAVE_APROBAR,
    s0.estado === 'propuesta' ? 'Descartar una propuesta es de quien abre sanciones' : 'Descartar una sanción abierta es de quien las aprueba');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sanciones', accion: 'cambio', motivo: `Descartada: ${n}` }, async cli => {
    const s = await cargar(cli, id);
    if (!['propuesta', 'abierta', 'aprobada'].includes(s.estado)) throw error('Esa ya tiene la carta en firma o comunicada: no se descarta', 409);
    await repo.cambiar(cli, s.id, { estado: 'descartada', nota: `Descartada: ${n}`, cerrada_at: 'now', cerrada_por: quien.usuarioId });
    await cerrarTodas(cli, s.id, quien.usuarioId, 'Descartada');
    return { estado: 'descartada' };
  });
  avisarCambio();
  return r;
}

// ── La carta ───────────────────────────────────────────────────────────────
/** Si una suspensión con esas fechas se registra tarde para la nómina de este mes (sanciones.dia_limite_suspension). */
async function avisoNomina(desde, hoy = calendario.hoy()) {
  if (!esIso(desde)) return null;
  const limite = Number(await parametros.valor('sanciones.dia_limite_suspension')) || 26;
  if (Number(hoy.slice(8, 10)) < limite) return null;
  // Del día límite en adelante, lo de este mes ya no entra en su nómina.
  if (desde.slice(0, 7) <= hoy.slice(0, 7)) return `Hoy es día ${Number(hoy.slice(8, 10))} (el límite es el ${limite}): la suspensión de este mes entra en la nómina del mes siguiente.`;
  return null;
}

/**
 * MANDAR LA CARTA A FIRMAR (Diana): con las fechas, si es una suspensión. Entra
 * en la cola de Firmas como «Carta de sanción» y, si quien la manda aprueba
 * Firmas, queda aprobada a la vez (si le falta el email o el móvil, se queda
 * por aprobar en Firmas y se dice qué falta). → { firmaId, aprobada, falta }
 */
async function mandarAFirma(id, { desde, hasta } = {}, quien = {}) {
  await exigir(quien, CLAVE_CARTA, 'La carta la prepara quien tiene la llave «Sanciones · carta»');
  const s0 = await cargar(null, id);
  if (s0.estado !== 'aprobada') throw error('Solo se manda la carta de una sanción aprobada', 409);
  if (s0.medida === 'suspension') {
    if (!esIso(desde) || !esIso(hasta)) throw error('Di desde qué día y hasta qué día es la suspensión');
    if (hasta < desde) throw error('La suspensión no puede acabar antes de empezar');
    if (desde < calendario.hoy()) throw error('La suspensión tiene que empezar hoy o después: antes hay que comunicarla');
  }
  const firmas = require('./firmas.service');
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sanciones', accion: 'cambio', motivo: 'Carta de sanción a la cola de Firmas' }, async cli => {
    const s = await cargar(cli, id);
    if (s.estado !== 'aprobada') throw error('Solo se manda la carta de una sanción aprobada', 409);
    const x = { ...s, suspension_desde: s.medida === 'suspension' ? desde : null, suspension_hasta: s.medida === 'suspension' ? hasta : null };
    const firmaId = await firmas.desdeSancion(cli, {
      sancionId: s.id, conductorId: Number(s.conductor_id), tipo: s.medida === 'suspension' ? 'suspension' : 'sancion',
      titulo: `${MEDIDAS[s.medida]}: ${s.nombre}`, detalle: { sancion: s.id, ...textosCarta(x) }, creadoPor: quien.usuarioId,
    });
    await repo.cambiar(cli, s.id, { estado: 'en_firma', firma_envio_id: firmaId, suspension_desde: x.suspension_desde, suspension_hasta: x.suspension_hasta });
    await cerrarTarjeta(cli, T_CARTA, s.id, quien.usuarioId, 'Carta a la cola de Firmas');
    return { firmaId };
  });
  // Aprobarla en Firmas a la vez, si se puede (es la misma persona quien decide).
  let aprobada = false, falta = null;
  if (await firmas.puede(quien, firmas.CLAVE_APROBAR)) {
    try { await firmas.aprobar(r.firmaId, {}, quien); aprobada = true; }
    catch (e) { falta = e.message; }
  } else falta = 'Queda por aprobar en Firmas';
  avisarCambio();
  return { ...r, aprobada, falta };
}

/**
 * LA CARTA SE CERRÓ EN FIRMAS (firmado, no lo firmó o caducado): la sanción
 * queda COMUNICADA y, si es una suspensión, la situación «suspendido» entra en
 * su ficha (y en el planificador). Si no cabe (pisa otro tramo), se dice y le
 * nace a RR. HH. la tarjeta de ponerla a mano. No lanza: la firma ya se cerró.
 */
async function alCerrarFirma(sancionId, estadoFirma, quien = {}) {
  try {
    const s = await cargar(null, sancionId);
    if (s.estado !== 'en_firma') return null;
    const como = { firmado: 'firmada', rechazado: 'no la firmó', caducado: 'caducó sin firmar' }[estadoFirma] || estadoFirma;
    let situacionId = null, nota = `Comunicada: la carta ${como}`;
    if (s.medida === 'suspension' && s.suspension_desde) {
      try {
        const plantilla = require('../Conductores/plantilla.service');
        const puesta = await plantilla.anadirAusencia(Number(s.conductor_id), {
          estado: 'suspendido', desde: s.suspension_desde, hasta: s.suspension_hasta,
          motivo: `Suspensión de empleo y sueldo de ${s.dias} días (sanción ${s.id}): ${s.falta}`,
        }, { usuarioId: quien.usuarioId });
        situacionId = puesta && puesta.anadida ? String(puesta.anadida.id) : null;
      } catch (e) { nota += `. No se pudo poner la suspensión en su ficha: ${e.message}`; }
    }
    await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'sanciones', accion: 'cambio', motivo: nota }, async cli => {
      await repo.cambiar(cli, s.id, { estado: 'comunicada', comunicada_at: 'now', situacion_id: situacionId, nota });
      if (s.medida === 'suspension' && !situacionId) {
        await tarjeta(cli, T_SITUACION, s, {
          titulo: `Pon la suspensión de ${s.nombre}`, funcion: 'sanciones_rrhh', plazoDias: 0,
          descripcion: `${nota}. Ponla a mano en su ficha (Plantilla): suspendido del ${dmy(s.suspension_desde)} al ${dmy(s.suspension_hasta)}.`,
        });
      }
    });
    avisarCambio();
    return { estado: 'comunicada', situacionId };
  } catch (e) { console.error(`❌ [Sanciones] la sanción ${sancionId} no quedó comunicada: ${e.message}`); return null; }
}

/** En Firmas descartaron la carta: la sanción vuelve a «carta por preparar» (va en la misma transacción). */
async function alDescartarFirma(cli, sancionId, autorId) {
  const s = await repo.porId(String(sancionId), cli);
  if (!s || s.estado !== 'en_firma') return;
  await repo.cambiar(cli, s.id, { estado: 'aprobada', firma_envio_id: null, suspension_desde: null, suspension_hasta: null,
    nota: 'La carta se descartó en Firmas: hay que volver a prepararla' });
  await tarjeta(cli, T_CARTA, s, {
    titulo: `Carta de sanción: ${s.nombre}`, funcion: 'sanciones_rrhh', plazoDias: 1,
    descripcion: `La carta se descartó en Firmas. Vuelve a prepararla antes del ${dmy(s.comunicar_antes)}.`,
  });
  avisarCambio();
  void autorId;
}

// ── Lo que propone el ERP ──────────────────────────────────────────────────
/** 'AAAA-MM-DD' menos `n` meses (el 31 de mayo menos 3 → el 28 de febrero). */
function restarMeses(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, 1));
  const ultimo = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, ultimo));
  return t.toISOString().slice(0, 10);
}
const reglaDeAusencias = n => (n >= 4 ? 'ABS_4D' : n >= 2 ? 'ABS_2D' : 'ABS_1D');
const NIVEL = { ABS_1D: 1, ABS_2D: 2, ABS_4D: 3 };
const lista3 = dias => {
  const d = dias.map(x => `${Number(x.slice(8, 10))}`);
  return `${d.length > 1 ? `${d.slice(0, -1).join(', ')} y ${d.at(-1)}` : d[0]} de ${diaLargo(dias[0]).split(' de ').slice(1).join(' de ')}`;
};

/**
 * PROPONER (cada día, después de las ausencias): por cada persona y mes, la falta
 * que dicen sus ausencias injustificadas; y la reincidencia. Una propuesta no
 * nace dos veces; si en el mes sube de grado y la de antes sigue sin abrir, se
 * descarta sola («sustituida»). → { nuevas, sustituidas }
 */
async function proponer({ cli = null, hoy = calendario.hoy() } = {}) {
  if (!await repo.hayTabla()) return { nuevas: 0, sustituidas: 0 };
  const bot = await firmasRepo.bot();
  const reglas = new Map((await repo.reglas()).map(r => [r.codigo, r]));
  const [porMes, comunicadas, gente] = await Promise.all([repo.injustificadasPorMes(DESDE), repo.comunicadas(), repo.personas()]);
  const nombre = new Map(gente.map(p => [p.id, p.nombre]));
  const firma = { usuarioId: bot, origen: 'sanciones · propuestas', accion: 'alta', motivo: 'Las faltas que proponen las ausencias injustificadas y la reincidencia' };
  const hacer = async c => {
    let nuevas = 0, sustituidas = 0;
    const nace = async (origenId, regla, conductorId, fechaHechos, hechos, detalle) => {
      if (await repo.porOrigen(c, origenId)) return false;
      const r = reglas.get(regla);
      const s = { conductorId: Number(conductorId), regla, gravedad: r.gravedad, articulo: r.articulo, falta: FALTAS[regla] || r.nota,
        fechaHechos, hechos, origen: 'propuesta', origenId, detalle, estado: 'propuesta', creadoPor: bot };
      const id = await repo.insertar(c, s);
      await tarjeta(c, T_PROPUESTA, { id }, {
        titulo: `Falta ${GRAVEDAD[r.gravedad].etiqueta.toLowerCase()}: ${nombre.get(String(conductorId)) || 'conductor ' + conductorId}`, funcion: 'sanciones_rrhh', plazoDias: 2,
        descripcion: `${s.falta} (${r.articulo}). Revisa los hechos y ábrela para aprobación, o descártala con su motivo.`,
      });
      nuevas++;
      return id;
    };
    // Las ausencias injustificadas, por mes natural.
    for (const m of porMes) {
      const regla = reglaDeAusencias(m.dias.length);
      const hechos = `No acudió a su puesto de trabajo, sin justificarlo, ${m.dias.length === 1 ? 'el día' : 'los días'} ${lista3(m.dias)}.`;
      const id = await nace(`ABS|${m.conductor_id}|${m.mes}|${regla}`, regla, m.conductor_id, m.dias.at(-1), hechos, { mes: m.mes, dias: m.dias });
      if (!id) continue;
      // Las de grado menor del mismo mes que siguen sin abrir: sustituidas.
      for (const menor of Object.keys(NIVEL).filter(k => NIVEL[k] < NIVEL[regla])) {
        const v = await repo.porOrigen(c, `ABS|${m.conductor_id}|${m.mes}|${menor}`);
        if (v && v.estado === 'propuesta') {
          await repo.cambiar(c, v.id, { estado: 'descartada', nota: `Sustituida por la de ${m.dias.length} días (sanción ${id})`, cerrada_at: 'now', cerrada_por: bot });
          await cerrarTarjeta(c, T_PROPUESTA, v.id, bot, 'Sustituida por una de más grado');
          sustituidas++;
        }
      }
    }
    // La reincidencia: 3 leves comunicadas en 3 meses; 2 graves en 6.
    const porPersona = new Map();
    comunicadas.forEach(x => { if (!porPersona.has(x.conductor_id)) porPersona.set(x.conductor_id, []); porPersona.get(x.conductor_id).push(x); });
    for (const [cid, xs] of porPersona) {
      for (const [regla, grav, cuantas, meses] of [['RECID_L', 'LEVE', 3, 3], ['RECID_G', 'GRAVE', 2, 6]]) {
        const de = xs.filter(x => x.gravedad === grav);
        for (let i = cuantas - 1; i < de.length; i++) {
          const fin = de[i].fecha_hechos;
          const ini = restarMeses(fin, meses);
          const ventana = de.filter(x => x.fecha_hechos > ini && x.fecha_hechos <= fin);
          if (ventana.length < cuantas) continue;
          await nace(`${regla}|${cid}|${de[i].id}`, regla, cid, fin,
            `Ha sido sancionado por ${ventana.length} faltas ${grav === 'LEVE' ? 'leves' : 'graves'} en ${meses === 3 ? 'un trimestre' : 'un semestre'}: ${ventana.map(x => `la del ${diaLargo(x.fecha_hechos)}`).join(', ')}.`,
            { sanciones: ventana.map(x => x.id) });
        }
      }
    }
    return { nuevas, sustituidas };
  };
  const r = await (cli ? libro.firmar(cli, firma).then(() => hacer(cli)) : libro.conFirma(firma, hacer));
  if (r.nuevas || r.sustituidas) avisarCambio();
  void hoy;
  return r;
}

tareasProgramadas.registrar({
  clave: 'sanciones.proponer',
  descripcion: 'Cada día a las 13:30, las faltas que proponen las ausencias injustificadas y la reincidencia (art. 39)',
  desde: '2026-11-26',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '13:30' }),
  hacer: ({ cli }) => proponer({ cli }),
});

// ── Leer ───────────────────────────────────────────────────────────────────
async function lista(quien) {
  await exigir(quien, CLAVE_VER);
  const base = { estados: ESTADOS, gravedades: GRAVEDAD, medidas: MEDIDAS };
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, ...base };
  const [filas, abre, aprueba, carta] = await Promise.all([repo.lista(), puede(quien, CLAVE_ABRIR), puede(quien, CLAVE_APROBAR), puede(quien, CLAVE_CARTA)]);
  return { filas: filas.map(s => ({ ...s, prescribe: prescribe(s) })), sinTabla: false, ...base, puede: { abrir: abre, aprobar: aprueba, carta } };
}

async function ficha(id, quien) {
  await exigir(quien, CLAVE_VER);
  const s = await cargar(null, id);
  const [abre, aprueba, carta, historial, aviso] = await Promise.all([
    puede(quien, CLAVE_ABRIR), puede(quien, CLAVE_APROBAR), puede(quien, CLAVE_CARTA),
    repo.deConductor(s.conductor_id, s.id), avisoNomina(s.suspension_desde || calendario.hoy()),
  ]);
  return { ...s, prescribe: prescribe(s), horquilla: horquilla(s.gravedad), carta: textosCarta(s), avisoNomina: s.medida === 'suspension' ? aviso : null,
    historial, puede: { abrir: abre, aprobar: aprueba, carta } };
}

/** El catálogo para abrir una: las faltas del convenio y las personas. */
async function catalogo(quien) {
  await exigir(quien, CLAVE_ABRIR);
  const [reglas, personas] = await Promise.all([repo.reglas(), repo.personas()]);
  return { reglas: reglas.map(r => ({ ...r, falta: FALTAS[r.codigo] || r.nota, horquilla: horquilla(r.gravedad) })), personas, gravedades: GRAVEDAD };
}

// ── Las pruebas (fotos, capturas, el parte…) ───────────────────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(PRUEBAS, {
  etiqueta: 'Pruebas de una sanción',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async q => puede(quienDe(q), CLAVE_ABRIR),
});

// ── El número del menú ─────────────────────────────────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('disciplina'); }
contadores.registrarFuente('disciplina', {
  async contar(q) {
    const tiene = c => q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(c)));
    const abre = tiene(CLAVE_ABRIR), aprueba = tiene(CLAVE_APROBAR), carta = tiene(CLAVE_CARTA);
    if (!abre && !aprueba && !carta) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.cuantos() : { propuestas: 0, por_aprobar: 0, por_comunicar: 0 })) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const c = await cuenta.valor;
    const n = (aprueba ? c.por_aprobar : 0) + (carta ? c.por_comunicar + c.propuestas : (abre && !aprueba ? c.propuestas : 0));
    return { 'disciplina.pendientes': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'sanción' : 'sanciones'} por decidir` } };
  },
});

module.exports = {
  crear, abrir, aprobar, descartar, mandarAFirma, alCerrarFirma, alDescartarFirma, proponer, lista, ficha, catalogo, puede,
  textosCarta, horquilla, avisoNomina, ESTADOS, GRAVEDAD, MEDIDAS, FALTAS, CLAVE_VER, CLAVE_ABRIR, CLAVE_APROBAR, CLAVE_CARTA,
};
