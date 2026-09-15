// ============================================================
// CONVENIO · MOTOR — lo que hace que el módulo deje de estar en blanco
// ============================================================
// El Hito 2 estaba ESCRITO pero no ENCHUFADO. `jornada.repo` sabía convertir los
// cambios de estado de BOLT en asientos del convenio desde hace meses, y no lo
// llamaba nadie: cero contratos, cero objetivos, cero asientos, cero registros.
// Las cuatro pantallas de /convenio salían vacías y parecían rotas.
//
// Aquí están las tres cosas que faltaban, en el orden en que hay que hacerlas.
//
// ── EL ORDEN, Y POR QUÉ ES ESE ──────────────────────────────────────────────
//
//   1. CONTRATOS.  Sin contrato no hay objetivo: `objetivo_mensual` cuelga de
//                  `contrato`, no del conductor.
//   2. OBJETIVOS.  Sin objetivo no hay contra qué comparar, y el panel del mes
//                  no puede decir si alguien va corto o largo.
//   3. DERIVACIÓN. Los asientos y el registro del art. 18.9. Esto sí se puede
//                  hacer sin lo anterior —cuánto trabajó alguien es un hecho,
//                  no depende de su contrato— y por eso se hace para TODOS.
//
// ── LAS CUATRO DECISIONES QUE HE TOMADO, POR SI HAY QUE DISCUTIRLAS ─────────
//
// · CONTRATO SOLO PARA PLANTILLA PROPIA. El objetivo mensual, el cierre y la
//   nómina son obligaciones NUESTRAS. A la gente de la ETT la contrata la
//   agencia: su objetivo y su nómina los lleva ella. Lo que sí se les calcula es
//   el REGISTRO DE JORNADA, porque cuántas horas hizo alguien en nuestros coches
//   es un hecho y lo necesitamos para el parte que se le manda a la agencia.
//
// · GRUPO G3A POR OMISIÓN (conductores de aplicación). Es lo que son casi todos
//   y es el valor que el propio esquema documenta como normal. Quien no lo sea
//   —un mecánico, alguien de oficina— se corrige a mano en su contrato; abrirlo
//   mal es mejor que no abrirlo, porque un contrato equivocado se ve y uno que
//   falta no.
//
// · 40 HORAS CUANDO NO CONSTA. 77 de las 215 personas no tienen `jornada_horas`
//   anotada en su periodo de empleo. 40 es la jornada completa y la que tienen
//   123 de las 138 que sí la llevan. Queda contado aparte en el resultado para
//   que RRHH sepa a cuántos hay que mirarles la ficha.
//
// · EL CONTRATO EMPIEZA EL DÍA DEL ALTA, aunque sea de 2022. El objetivo se
//   prorratea por días de alta EN EL MES, así que una antigüedad larga no
//   inventa objetivos de meses viejos: solo se generan los meses que se pidan.

const repo = require('./contratos.repo');
const jornada = require('./jornada.repo');

const HORAS_POR_OMISION = 40;

/** Hoy en Madrid, 'AAAA-MM-DD'. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** El día anterior, caminando el calendario (el de cambio de hora tiene 23 o 25). */
function diaMenos(dia, n) {
  const [y, m, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) - n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// ── 1. Contratos ───────────────────────────────────────────────────────────

/**
 * ABRE EL CONTRATO DE QUIEN NO LO TENGA y cierra el de quien ya causó baja.
 *
 * Idempotente: quien ya tiene contrato vigente no sale en la lista, así que
 * correrlo dos veces no crea nada. Un fallo suelto —una persona sin grupo
 * válido, por ejemplo— no tumba a los demás: se apunta y se sigue.
 */
async function sincronizarContratos({ tipo = 'propia' } = {}) {
  const agreementId = await repo.convenioVigente();
  if (!agreementId) throw new Error('No hay ningún convenio vigente cargado');

  const pendientes = await repo.sinContrato({ tipo });
  const r = { abiertos: 0, sinJornada: 0, fallos: [], cerrados: 0 };

  for (const p of pendientes) {
    const horas = Number(p.jornada_horas) > 0 ? Number(p.jornada_horas) : HORAS_POR_OMISION;
    if (!(Number(p.jornada_horas) > 0)) r.sinJornada++;
    try {
      await repo.abrir({
        conductorId: p.conductor_id, periodoId: p.periodo_id, agreementId,
        grupo: repo.GRUPO_CONDUCTOR, horasSemana: horas, desde: p.alta,
      });
      r.abiertos++;
    } catch (e) {
      r.fallos.push({ conductorId: p.conductor_id, nombre: p.nombre, motivo: e.message });
    }
  }

  r.cerrados = await repo.cerrarLosDeBaja();
  console.log(`📄 [CONVENIO] contratos: ${r.abiertos} abierto(s)` +
    (r.sinJornada ? ` (${r.sinJornada} sin jornada anotada → ${HORAS_POR_OMISION} h)` : '') +
    (r.cerrados ? ` · ${r.cerrados} cerrado(s) por baja` : '') +
    (r.fallos.length ? ` · ${r.fallos.length} FALLO(S)` : ''));
  return r;
}

// ── 2. Objetivos ───────────────────────────────────────────────────────────

/**
 * Publica los objetivos de un mes. Lo hace la base; aquí solo se pide y se
 * cuenta. No pisa lo ya publicado ni lo congelado.
 */
async function publicarObjetivos(anio, mes) {
  const creados = await repo.generarObjetivos(anio, mes);
  console.log(`🎯 [CONVENIO] objetivos ${anio}-${String(mes).padStart(2, '0')}: ${creados} creado(s)`);
  return { anio, mes, creados };
}

// ── 3. Derivación de la jornada ────────────────────────────────────────────

/**
 * DERIVA UN DÍA: de los cambios de estado de BOLT a asientos del ledger y al
 * registro del art. 18.9. Idempotente por tramo, así que rederivar no duplica.
 */
const derivarDia = dia => jornada.derivarTodos(dia);

/**
 * Deriva un rango, día a día y de uno en uno.
 *
 * DE UNO EN UNO A PROPÓSITO: cada día son ~200 conductores y por cada tramo de
 * espera se pregunta a la base si el coche estaba dentro del área. Lanzar varios
 * días a la vez ahoga el pool para ganar unos segundos en algo que corre de
 * madrugada.
 */
async function derivarRango({ desde, hasta } = {}) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO.test(desde || '')) throw new Error('Falta desde=AAAA-MM-DD');
  const fin = ISO.test(hasta || '') ? hasta : desde;
  if (fin < desde) throw new Error('El "hasta" es anterior al "desde"');

  const dias = [];
  for (let d = desde; d <= fin; ) {
    dias.push(d);
    const [y, m, dd] = d.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd, 12) + 86400000);
    d = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  }

  const hechos = [];
  for (const d of dias) hechos.push(await derivarDia(d));
  const total = hechos.reduce((a, h) => ({
    conductores: Math.max(a.conductores, h.conductores),
    asientos: a.asientos + h.asientos, nuevos: a.nuevos + h.nuevos,
  }), { conductores: 0, asientos: 0, nuevos: 0 });
  console.log(`📓 [CONVENIO] derivados ${dias.length} día(s) ${dias[0]}→${dias[dias.length - 1]}: ` +
    `${total.nuevos} asiento(s) nuevo(s)`);
  return { dias: dias.length, desde: dias[0], hasta: dias[dias.length - 1], ...total, detalle: hechos };
}

/**
 * LO QUE HACE EL CRON DE CADA NOCHE: derivar AYER.
 *
 * Ayer y no hoy: la jornada de hoy no ha terminado y la de un turno de noche
 * ni siquiera ha empezado a cerrarse. Derivar un día a medias no rompe nada
 * —es idempotente— pero deja un registro que dice menos horas de las que hubo,
 * y ese registro es el que exige el art. 18.9.
 */
const derivarAyer = () => derivarRango({ desde: diaMenos(hoyMadrid(), 1) });

/**
 * PONER EL MÓDULO AL DÍA de una sentada: contratos, objetivos del mes que se
 * pida y todos los días de BOLT que falten por derivar.
 *
 * Es lo que se ejecuta una vez para arrancar, y lo que hay que volver a ejecutar
 * si alguna vez se queda atrás. Devuelve el parte de lo que ha hecho.
 */
async function ponerAlDia({ tipo = 'propia', anio, mes } = {}) {
  const contratos = await sincronizarContratos({ tipo });

  const hoy = hoyMadrid();
  const a = Number(anio) || Number(hoy.slice(0, 4));
  const m = Number(mes) || Number(hoy.slice(5, 7));
  const objetivos = await publicarObjetivos(a, m);

  const pendientes = await repo.diasSinDerivar();
  const derivado = pendientes.length
    ? await derivarRango({ desde: pendientes[0], hasta: pendientes[pendientes.length - 1] })
    : { dias: 0, nuevos: 0 };

  return { contratos, objetivos, derivado, foto: await repo.foto() };
}

/** Cómo está el módulo: lo primero que hay que mirar si una pantalla sale vacía. */
const estado = async () => ({ ...(await repo.foto()), sinDerivar: await repo.diasSinDerivar() });

module.exports = {
  sincronizarContratos, publicarObjetivos,
  derivarDia, derivarRango, derivarAyer, ponerAlDia, estado,
  HORAS_POR_OMISION, hoyMadrid, diaMenos,
};
