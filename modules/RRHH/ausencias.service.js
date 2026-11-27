// ============================================================
// LAS AUSENCIAS QUE VALIDA RR. HH. — LA PUERTA (módulo 1, db/289, 25/11/2026)
// ============================================================
// Módulo 1 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md), la
// parte que no espera al fichero del INSS. El encargo: «Ninguna ausencia se
// descuenta como absentismo sin validación. Tarea diaria para Diana: revisar las
// ausencias nuevas y confirmar que no son una baja médica».
//
//   · LA DETECCIÓN (cada día a las 13:00, cuando ya han entrado las horas del
//     turno de noche de ayer): las «Ausencias» de la bitácora, con SU regla
//     (bitacora.service.claseDelDia), de plantilla propia y desde el 26/10/2026,
//     se apuntan «pendientes». Y se repasan las que ya había:
//       - la que ya no es ausencia (le pusieron una J, entraron sus horas…) se
//         cierra sola, «ya no es»;
//       - la que cae dentro de una baja médica o de un permiso se reclasifica
//         sola, también si ya estaba decidida (el encargo: «es retroactivo»);
//       - la que vuelve a serlo (se anuló la J, se borró la baja) vuelve a
//         estar pendiente.
//   · LA TARJETA DEL DÍA: si hay nuevas, a quien tenga la función
//     «ausencias_validar» (Organización, el puesto de Diana). Se cierra sola
//     cuando no queda ninguna de las suyas por revisar.
//   · DECIDIR: injustificada (absentismo), justificada (con nota), baja médica o
//     permiso (se abre esa situación, con la misma puerta que Plantilla y la
//     Ticketera, y se resuelven a la vez las de esos días). Varias a la vez,
//     las dos primeras. El justificante, como adjunto de la ausencia.
//   · EL % DE PLANTILLA DE BAJA: hoy y por meses, de la plantilla propia.
//
// Decidido por Camilo el 25/11/2026: solo plantilla propia, desde el 26/10/2026
// (las nóminas van del 26 al 25), y esas cuatro decisiones.
//
// DESDE EL 26/11/2026 LAS CONFIRMA TRÁFICO (Camilo, 27/11/2026: «a partir de
// ayer, que empieza el corte del mes, tienen que confirmarlas Tráfico, o darlas
// como justificadas, Diana no»): William y Ángel, con la llave
// '/ausencias/trafico' y la función «ausencias_trafico» (su tarjeta del día).
// Deciden injustificada o justificada; y JUSTIFICADA por ellos pide las horas y
// el motivo y NACE SU J DE TRÁFICO YA APROBADA, sin esperar a la cola de J.
// Lo de antes del 26/11 y abrir una baja médica o un permiso sigue siendo de
// RR. HH. (la llave '/ausencias/validar').
'use strict';

const repo = require('./ausencias.repo');
const bitacora = require('../Operaciones/bitacora.service');
const plantilla = require('../Conductores/plantilla.service');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');
const parametros = require('../../services/parametros');
const contadores = require('../../services/contadores');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const adjuntos = require('../../services/adjuntos');
const tareasProgramadas = require('../../services/tareasProgramadas');

// Desde aquí se validan (Camilo: «desde el 26/10/2026 ya que las nóminas se
// cortan así, con cortes al 25 de cada mes»). Lo de antes no se toca.
const DESDE = '2026-10-26';
// El % de plantilla de baja se cuenta desde que la plantilla está en PostgreSQL.
const DESDE_BAJAS = '2026-07-01';
const TIPO_TARJETA = 'ausencias_revisar';
const DUENO = 'ausencia_rrhh';
const CLAVE_VER = '/ausencias';
const CLAVE_VALIDAR = '/ausencias/validar';
const CLAVE_TRAFICO = '/ausencias/trafico';
const DESDE_TRAFICO = '2026-11-26';
const deTrafico = dia => String(dia || '') >= DESDE_TRAFICO;
const TOTAL = ['superadmin', 'desarrollador'];

const ESTADOS = {
  pendiente: { etiqueta: 'Pendiente', tono: 'warn' },
  injustificada: { etiqueta: 'Injustificada', tono: 'red' },
  justificada: { etiqueta: 'Justificada', tono: 'green' },
  baja_medica: { etiqueta: 'Baja médica (IT)', tono: 'azul' },
  permiso: { etiqueta: 'Permiso', tono: 'azul' },
  ya_no_es: { etiqueta: 'Ya no es ausencia', tono: 'muted' },
};
// Lo que se puede decidir de una, y lo que se puede decidir de varias a la vez.
const DECIDIBLES = ['pendiente', 'injustificada', 'justificada'];
const EN_BLOQUE = ['injustificada', 'justificada'];

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const clave = (cid, dia) => `${cid}|${dia}`;

/** ¿Puede mirar / validar? Por su llave (o su rol, si lo ve todo). */
async function puede(quien, llave) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol)) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(llave); } catch (_) { return false; }
}
const exigir = async (quien, llave) => { if (!await puede(quien, llave)) throw error('No tienes permiso para esto', 403); };

/**
 * EL PERIODO DE NÓMINA de un día: del 26 del mes anterior al 25 (el corte,
 * `nomina.dia_corte` en Parámetros). → { desde, hasta, mes: 'AAAA-MM' (el del corte) }
 */
function periodoDe(dia, corte = 25) {
  const [y, m, d] = dia.split('-').map(Number);
  const mesCorte = d > corte ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m - 1, 1));
  const yy = mesCorte.getUTCFullYear(), mm = mesCorte.getUTCMonth();
  const iso = (yr, mo, dd) => new Date(Date.UTC(yr, mo, dd)).toISOString().slice(0, 10);
  const ultimo = (yr, mo) => new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
  const hasta = iso(yy, mm, Math.min(corte, ultimo(yy, mm)));
  const desde = calendario.sumarDias(iso(yy, mm - 1, Math.min(corte, ultimo(yy, mm - 1))), 1);
  return { desde, hasta, mes: hasta.slice(0, 7) };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreDelPeriodo = p => `Nómina de ${MESES[Number(p.mes.slice(5, 7)) - 1]} (${dmy(p.desde).slice(0, 5)} → ${dmy(p.hasta).slice(0, 5)})`;

/** Lo que dice la nota de una que se resolvió sola. */
const notaDeSituacion = s => (s.estado === 'baja_medica'
  ? `Reclasificada sola: baja médica del ${dmy(s.desde)}${s.hasta ? ` al ${dmy(s.hasta)}` : ', sin fecha de alta'}`
  : `Reclasificada sola: permiso${s.tipo ? ` (${s.tipo})` : ''} del ${dmy(s.desde)}${s.hasta ? ` al ${dmy(s.hasta)}` : ''}`);

/**
 * LA DETECCIÓN. Compara lo que dice hoy la bitácora con lo apuntado y lo pone
 * al día (ver la cabecera). `candidatos` ([{ conductorId, dia }]) se puede pasar
 * para probarlo; si no, son las «Ausencias» de la bitácora desde el 26/10/2026
 * hasta ayer. → { nuevas, vuelven, yaNoSon, reclasificadas, tarjeta }
 */
async function detectar({ candidatos, cli = null, hoy = calendario.hoy() } = {}) {
  const ayer = calendario.sumarDias(hoy, -1);
  const brutos = candidatos || await bitacora.ausenciasEntre({ desde: DESDE, hasta: ayer });
  const firma = { origen: 'ausencias · detección', motivo: 'Las ausencias de la bitácora, puestas al día' };
  const hacer = async c => {
    const enRango = brutos.filter(p => esIso(p.dia) && p.dia >= DESDE && p.dia <= ayer);
    const propias = await repo.dePlantillaPropia(c, enRango);
    const aus = enRango.filter(p => propias.has(clave(p.conductorId, p.dia)));
    const esAus = new Set(aus.map(p => clave(p.conductorId, p.dia)));
    const hay = await repo.desde(c, DESDE);
    const porClave = new Map(hay.map(a => [clave(a.conductor_id, a.dia), a]));
    // La baja o el permiso de cada par, mirado en la base (no en la caché de la
    // bitácora, que puede llevar tres minutos de retraso).
    const sit = await repo.situacionesEn(c, [...aus, ...hay.map(a => ({ conductorId: a.conductor_id, dia: a.dia }))]);

    const r = { nuevas: 0, vuelven: 0, yaNoSon: 0, reclasificadas: 0, tarjeta: null };
    const fechas = new Set([hoy]);
    const nuevas = [];
    for (const p of aus) {
      const k = clave(p.conductorId, p.dia);
      const a = porClave.get(k), s = sit.get(k);
      if (!a) {
        if (s) continue;   // la bitácora aún no la ha visto: la cubre una baja o un permiso
        nuevas.push(p);
      } else if (!s && (a.estado === 'ya_no_es' || ((a.estado === 'baja_medica' || a.estado === 'permiso') && a.automatica)
                       || ((a.estado === 'baja_medica' || a.estado === 'permiso') && !a.situacion_id))) {
        // Vuelve a ser una ausencia: se anuló la J, se borró la baja…
        fechas.add(a.detectada_el);
        await repo.cambiar(c, a.id, { estado: 'pendiente', nota: 'Vuelve a salir como ausencia en la bitácora', detectadaEl: hoy });
        r.vuelven++;
      }
    }
    r.nuevas = await repo.insertar(c, nuevas, hoy);

    for (const a of hay) {
      const k = clave(a.conductor_id, a.dia), s = sit.get(k);
      if (s && a.estado !== s.estado && a.estado !== 'ya_no_es') {
        // La cubre una baja o un permiso: se reclasifica, aunque ya estuviera decidida.
        fechas.add(a.detectada_el);
        await repo.cambiar(c, a.id, { estado: s.estado, nota: notaDeSituacion(s), situacionId: s.id, automatica: true });
        r.reclasificadas++;
      } else if (!s && !esAus.has(k) && (a.estado === 'pendiente' || a.estado === 'injustificada')) {
        // La bitácora ya no la ve: tiene horas, una J, una libranza, vacaciones…
        fechas.add(a.detectada_el);
        await repo.cambiar(c, a.id, { estado: 'ya_no_es', automatica: true,
          nota: 'La bitácora ya no la cuenta como ausencia (horas, una J, una libranza, unas vacaciones…)' });
        r.yaNoSon++;
      }
    }

    if (r.nuevas + r.vuelven > 0) r.tarjeta = await tarjetaDelDia(c, hoy);
    await cerrarTarjetasHechas(c, fechas);
    return r;
  };
  const r = cli
    ? await libro.firmar(cli, firma).then(() => hacer(cli))
    : await libro.conFirma(firma, hacer);
  avisarCambio();
  return r;
}

// ── La tarjeta del día ─────────────────────────────────────────────────────
tablero.registrarTipo(TIPO_TARJETA, { etiqueta: 'Ausencias por revisar', abrir: 'Revisar las ausencias', cierreManual: false });

async function tarjetaDelDia(cli, hoy) {
  const n = await repo.quedanDe(cli, hoy);
  if (!n) return null;
  // Lo que se detecta hoy es de ayer: desde el corte del 26/11, de Tráfico.
  const funcion = deTrafico(calendario.sumarDias(hoy, -1)) ? 'ausencias_trafico' : 'ausencias_validar';
  const titulares = await organizacion.quienes(funcion, { conSuplentes: false }).catch(() => []);
  const titulo = `Revisar ${n} ${n === 1 ? 'ausencia nueva' : 'ausencias nuevas'} (${dmy(hoy)})`;
  const t = await tablero.nacer(cli, {
    tipo: TIPO_TARJETA, origenId: hoy, enlace: '/ausencias', titulo,
    descripcion: 'Personas de plantilla propia que tenían que salir y no salieron, sin nada que lo explique. '
      + (funcion === 'ausencias_trafico'
        ? 'Confírmala injustificada (cuenta como absentismo) o justificada con sus horas (su J nace ya aprobada). Si es una baja médica o un permiso, avisa a RR. HH. '
        : 'Mira si alguna es una baja médica o un permiso; si no, márcala injustificada (cuenta como absentismo) o justificada. ')
      + 'La tarjeta se cierra sola cuando no queda ninguna de estas por revisar.',
    responsableId: titulares.length ? titulares[0].id : null, plazoDias: 1,
  });
  if (!t.nueva) await tablero.ajustarPorOrigen(cli, { tipo: TIPO_TARJETA, origenId: hoy, titulo, responsableId: titulares.length ? titulares[0].id : null });
  return t.id;
}

/** Las tarjetas de esos días que ya no tienen nada por revisar: hechas. */
async function cerrarTarjetasHechas(cli, fechas, autorId = null) {
  for (const f of fechas) {
    if (!f || await repo.quedanDe(cli, f)) continue;
    await tablero.cerrarPorOrigen(cli, { tipo: TIPO_TARJETA, origenId: f, autorId, nota: 'Revisadas todas las ausencias' });
  }
}

tareasProgramadas.registrar({
  clave: 'ausencias.detectar',
  descripcion: 'Cada día a las 13:00, las ausencias de la bitácora que tiene que validar RR. HH. (y su tarjeta)',
  desde: '2026-11-26',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '13:00' }),
  hacer: ({ cli }) => detectar({ cli }),
});

// ── Leer ───────────────────────────────────────────────────────────────────
/**
 * Los días seguidos sin salir de cada una (las de la misma persona en días
 * consecutivos, sin contar las que ya no son): tres seguidos suelen ser una baja.
 */
function conRacha(filas) {
  const porPersona = new Map();
  filas.filter(f => f.estado !== 'ya_no_es').forEach(f => {
    if (!porPersona.has(f.conductor_id)) porPersona.set(f.conductor_id, []);
    porPersona.get(f.conductor_id).push(f);
  });
  for (const lista of porPersona.values()) {
    lista.sort((a, b) => a.dia.localeCompare(b.dia));
    let ini = 0;
    for (let i = 1; i <= lista.length; i++) {
      if (i < lista.length && calendario.sumarDias(lista[i - 1].dia, 1) === lista[i].dia) continue;
      for (let j = ini; j < i; j++) lista[j].racha = i - ini;
      ini = i;
    }
  }
  return filas;
}

async function corte() {
  try { return Number(await parametros.valor('nomina.dia_corte')) || 25; } catch (_) { return 25; }
}

async function lista(quien) {
  await exigir(quien, CLAVE_VER);
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, estados: ESTADOS, periodos: [] };
  const dc = await corte();
  const filas = conRacha(await repo.lista()).map(f => {
    const p = periodoDe(f.dia, dc);
    return { ...f, periodo: p.mes, periodo_texto: nombreDelPeriodo(p), racha: f.racha || 0 };
  });
  const hoy = calendario.hoy();
  const actual = periodoDe(calendario.sumarDias(hoy, -1), dc);
  const periodos = [...new Map(filas.map(f => [f.periodo, f.periodo_texto])).entries()]
    .sort((a, b) => b[0].localeCompare(a[0])).map(([valor, texto]) => ({ valor, texto }));
  return {
    filas, sinTabla: false,
    estados: ESTADOS, periodos, periodoActual: actual.mes, desde: DESDE, desdeTrafico: DESDE_TRAFICO,
    puedeValidar: await puede(quien, CLAVE_VALIDAR), puedeTrafico: await puede(quien, CLAVE_TRAFICO),
    baja: await bajaHoy().catch(() => null),
    tiposPermiso: await plantilla.tiposPermiso(),
  };
}

async function ficha(id, quien) {
  await exigir(quien, CLAVE_VER);
  const f = await repo.porId(String(id));
  if (!f) throw error('No existe esa ausencia', 404);
  const [conRachas, llamadas] = await Promise.all([
    repo.lista().then(t => conRacha(t.filter(x => x.conductor_id === f.conductor_id))),
    bitacora.llamadasDelDia(f.conductor_id, f.dia).then(r => (r && r.llamadas) || []).catch(() => []),
  ]);
  const yo = conRachas.find(x => x.id === f.id) || {};
  const otras = conRachas.filter(x => x.id !== f.id && x.estado !== 'ya_no_es')
    .sort((a, b) => b.dia.localeCompare(a.dia)).slice(0, 12)
    .map(x => ({ id: x.id, dia: x.dia, estado: x.estado }));
  const p = periodoDe(f.dia, await corte());
  return { ...f, racha: yo.racha || 0, periodo_texto: nombreDelPeriodo(p), llamadas, otras,
    puedeValidar: await puede(quien, CLAVE_VALIDAR), puedeTrafico: await puede(quien, CLAVE_TRAFICO), desdeTrafico: DESDE_TRAFICO };
}

// ── Decidir ────────────────────────────────────────────────────────────────
const textoNota = v => String(v == null ? '' : v).trim().slice(0, 2000);

/**
 * Decide una o varias. `estado`:
 *   · injustificada / justificada: las `ids` (varias a la vez, si se quiere).
 *     Justificada pide nota: «justificada» sin decir por qué no le sirve a nadie.
 *   · baja_medica / permiso: UNA (`ids` de una), y se abre esa situación del
 *     `desde` al `hasta` (por omisión, el día de la ausencia) con la puerta de
 *     Plantilla; las de esa persona en esas fechas quedan resueltas con ella.
 *     Es de RR. HH. (la llave de validar), sea del día que sea.
 *   · Desde el 26/11/2026 injustificada o justificada es de TRÁFICO (su llave);
 *     lo de antes, de RR. HH. Justificada por Tráfico pide `horas`: nace su J de
 *     Tráfico ya aprobada, con esas horas y la nota.
 * → { decididas }
 */
async function decidir({ ids, estado, nota, desde, hasta, tipoPermiso, motivoExceso, horas } = {}, quien = {}) {
  const [valida, trafico] = await Promise.all([puede(quien, CLAVE_VALIDAR), puede(quien, CLAVE_TRAFICO)]);
  if (!valida && !trafico) throw error('No tienes permiso para esto', 403);
  if (!EN_BLOQUE.includes(estado) && !valida) throw error('Abrir una baja médica o un permiso es de RR. HH.', 403);
  const lista_ = [...new Set([].concat(ids || []).map(String).filter(x => /^\d+$/.test(x)))];
  if (!lista_.length) throw error('No hay ninguna ausencia elegida');
  if (!ESTADOS[estado] || estado === 'pendiente' || estado === 'ya_no_es') throw error('Esa decisión no existe');
  const n = textoNota(nota);

  if (EN_BLOQUE.includes(estado)) {
    if (estado === 'justificada' && n.length < 3) throw error('Di por qué está justificada');
    // Quién decide cada una: desde el corte del 26/11, Tráfico; lo de antes, RR. HH.
    const previas = await repo.variasPorId(null, lista_);
    const ajena = previas.find(f => (deTrafico(f.dia) ? !trafico : !valida));
    if (ajena) {
      throw error(deTrafico(ajena.dia)
        ? `Desde el ${dmy(DESDE_TRAFICO)} las ausencias las confirma Tráfico (la del ${dmy(ajena.dia)} de ${ajena.nombre}).`
        : `Las ausencias de antes del ${dmy(DESDE_TRAFICO)} las decide RR. HH. (la del ${dmy(ajena.dia)} de ${ajena.nombre}).`, 403);
    }
    // Justificada por Tráfico: su J, ya aprobada, ANTES de cambiar nada (si la J
    // no se puede poner —una libranza a mano ese día—, la ausencia no cambia).
    const deTrafico_ = previas.filter(f => deTrafico(f.dia) && DECIDIBLES.includes(f.estado));
    if (estado === 'justificada' && deTrafico_.length) {
      const h = Number(String(horas == null ? '' : horas).trim().replace(',', '.'));
      if (String(horas == null ? '' : horas).trim() === '' || !Number.isFinite(h) || h < 0 || h > 24) {
        throw error('Di cuántas horas se le justifican (entre 0 y 24, por ejemplo 8)');
      }
      const jRepo = require('../../services/repo/justificantes');
      for (const f of deTrafico_) {
        const j = await jRepo.guardarPorId({ conductorId: f.conductor_id, diaIso: f.dia, horas: h,
          observacion: `Ausencia justificada por Tráfico: ${n}`, tipo: 'trafico', usuarioId: quien.usuarioId, origen: 'ausencias' });
        try { await jRepo.aprobar(j.justificanteId, { usuarioId: quien.usuarioId, origen: 'ausencias' }); } catch (e) {
          if (!/no está pendiente/.test(e.message)) throw e;   // ya estaba aprobada con lo mismo
        }
      }
    }
    const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'ausencias', accion: 'cambio',
      motivo: `${ESTADOS[estado].etiqueta}${n ? `: ${n}` : ''}` }, async cli => {
      const filas = await repo.variasPorId(cli, lista_);
      if (filas.length !== lista_.length) throw error('Alguna de esas ausencias ya no existe');
      const malas = filas.filter(f => !DECIDIBLES.includes(f.estado));
      if (malas.length) {
        throw error(`La del ${dmy(malas[0].dia)} de ${malas[0].nombre} ya es «${ESTADOS[malas[0].estado].etiqueta}»: `
          + 'eso lo decide su baja o su permiso, o la bitácora.', 409);
      }
      const fechas = new Set();
      for (const f of filas) {
        await repo.cambiar(cli, f.id, { estado, nota: n || null, resueltaPor: quien.usuarioId });
        fechas.add(f.detectada_el);
      }
      await cerrarTarjetasHechas(cli, fechas, quien.usuarioId);
      return filas.length;
    });
    avisarCambio();
    return { decididas: r };
  }

  // Baja médica o permiso: de una en una, con sus fechas.
  if (lista_.length !== 1) throw error('Una baja o un permiso se abre de una en una: elige solo una ausencia');
  const f = await repo.porId(lista_[0]);
  if (!f) throw error('No existe esa ausencia', 404);
  if (!DECIDIBLES.includes(f.estado)) throw error(`Esta ya es «${ESTADOS[f.estado].etiqueta}»`, 409);
  const d = esIso(desde) ? desde : f.dia;
  const h = hasta === '' || hasta === null ? null : (esIso(hasta) ? hasta : f.dia);
  if (d > f.dia || (h && h < f.dia)) throw error(`Las fechas tienen que cubrir el ${dmy(f.dia)}, que es el día de la ausencia`);
  if (estado === 'permiso' && !tipoPermiso) throw error('Elige qué permiso es');
  const motivo = `${estado === 'baja_medica' ? 'Baja médica' : 'Permiso'} puesta desde Ausencias (RR. HH.)${n ? `: ${n}` : ''}`;
  const puesta = await plantilla.anadirAusencia(Number(f.conductor_id),
    { estado, desde: d, hasta: h, motivo, tipoPermiso: estado === 'permiso' ? tipoPermiso : undefined, motivoExceso }, quien);
  const situacionId = puesta && puesta.anadida ? String(puesta.anadida.id) : null;
  const decididas = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'ausencias', accion: 'cambio', motivo }, async cli => {
    const filas = await repo.deEntre(cli, f.conductor_id, d, h);
    const fechas = new Set();
    let k = 0;
    for (const x of filas) {
      if (!DECIDIBLES.includes(x.estado)) continue;
      await repo.cambiar(cli, x.id, { estado, nota: n || null, situacionId, resueltaPor: quien.usuarioId });
      fechas.add(x.detectada_el);
      k++;
    }
    await cerrarTarjetasHechas(cli, fechas, quien.usuarioId);
    return k;
  });
  avisarCambio();
  return { decididas, situacionId };
}

// ── El % de plantilla de baja ──────────────────────────────────────────────
let cacheBaja = null;
const pct = (b, a) => (a ? Math.round((1000 * b) / a) / 10 : 0);

async function serieBaja() {
  const hoy = calendario.hoy();
  if (!cacheBaja || cacheBaja.hoy !== hoy || Date.now() - cacheBaja.en > 10 * 60000) {
    cacheBaja = { hoy, en: Date.now(), valor: repo.plantillaDeBaja(DESDE_BAJAS, hoy) };
    cacheBaja.valor.catch(() => { cacheBaja = null; });
  }
  return cacheBaja.valor;
}

async function bajaHoy() {
  const s = await serieBaja();
  const u = s[s.length - 1];
  return u ? { dia: u.dia, alta: u.alta, baja: u.baja, pct: pct(u.baja, u.alta) } : null;
}

/** Por meses: la media del mes, el día más alto y el más bajo. Y hoy. */
async function historicoBaja(quien) {
  await exigir(quien, CLAVE_VER);
  const s = await serieBaja();
  const porMes = new Map();
  s.forEach(x => {
    const m = x.dia.slice(0, 7);
    if (!porMes.has(m)) porMes.set(m, []);
    porMes.get(m).push({ ...x, pct: pct(x.baja, x.alta) });
  });
  const meses = [...porMes.entries()].map(([mes, dias]) => {
    const media = Math.round(10 * dias.reduce((t, d) => t + d.pct, 0) / dias.length) / 10;
    const max = dias.reduce((a, b) => (b.pct > a.pct ? b : a));
    const min = dias.reduce((a, b) => (b.pct < a.pct ? b : a));
    return { mes, texto: `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`, dias: dias.length, media,
      max: { pct: max.pct, dia: max.dia, baja: max.baja, alta: max.alta }, min: { pct: min.pct, dia: min.dia } };
  }).reverse();
  const ult = s.slice(-90).map(x => ({ dia: x.dia, pct: pct(x.baja, x.alta), baja: x.baja, alta: x.alta }));
  return { hoy: await bajaHoy(), meses, dias: ult };
}

// ── El justificante: un adjunto de la ausencia ────────────────────────────
const quienDe = q => ({ usuarioId: q && (q.usuarioId || q.id), rol: q && q.rol });
adjuntos.registrarDueno(DUENO, {
  etiqueta: 'Ausencia (RR. HH.)',
  ver: async q => puede(quienDe(q), CLAVE_VER),
  adjuntar: async q => (await puede(quienDe(q), CLAVE_VALIDAR)) || puede(quienDe(q), CLAVE_TRAFICO),
});

// ── El número del menú: las pendientes ─────────────────────────────────────
let cuenta = null;
function avisarCambio() { cuenta = null; contadores.cambio('ausencias'); }
contadores.registrarFuente('ausencias', {
  async contar(q) {
    const ve = q && (q.permisos === null || (Array.isArray(q.permisos) && q.permisos.includes(CLAVE_VER)));
    if (!ve) return {};
    if (!cuenta || Date.now() - cuenta.en > 60000) {
      cuenta = { en: Date.now(), valor: repo.hayTabla().then(h => (h ? repo.pendientes() : 0)) };
      cuenta.valor.catch(() => { cuenta = null; });
    }
    const n = await cuenta.valor;
    return { 'ausencias.pendientes': { n, tono: 'aviso', titulo: `${n} ${n === 1 ? 'ausencia' : 'ausencias'} por validar` } };
  },
});

module.exports = {
  detectar, lista, ficha, decidir, historicoBaja, puede, periodoDe,
  ESTADOS, DESDE, DESDE_TRAFICO, TIPO_TARJETA, DUENO, CLAVE_VER, CLAVE_VALIDAR, CLAVE_TRAFICO,
};
