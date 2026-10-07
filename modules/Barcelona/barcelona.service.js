// ============================================================
// BARCELONA · SERVICIO — el planificador
// ============================================================
// Pedido por Camilo el 07/10/2026: Barcelona no necesita fichas, altas ni
// libranzas. Sus conductores son sus cuentas de BOLT (nombre y teléfono) y sus
// matrículas, los coches de su empresa de BOLT. Se planifica a cada uno en una
// matrícula, de DÍA o de NOCHE, y la asignación es FIJA hasta que se cambie: no
// hay libranzas, así que el día que no hace horas el reporte dice «No salió».
//
// Las reglas viven aquí; el SQL, en barcelona.repo.js; las horas, en
// barcelona.horas.js. Ver docs/modulos/Barcelona.md.

const repo = require('./barcelona.repo');
const H = require('./barcelona.horas');
const R = require('../../services/flotaViva/repartoTurnos');

const SEDE = 'barcelona';
const TURNOS = ['dia', 'noche'];
const MS_DIA = 86400000;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const esFecha = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const sumar = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * MS_DIA).toISOString().slice(0, 10);

/** ¿Está activa en BOLT? Solo a esas se las ofrece para planificar. */
const activa = c => String(c.estado || '').toLowerCase() === 'active';
/**
 * ¿SE PUEDE PLANIFICAR EL COCHE? Si BOLT lo conoce, manda BOLT: activo sí,
 * desactivado no (no podría trabajar). Si BOLT no lo conoce pero Vehículos lo
 * tiene de alta en la sede, sí: aún no está dado de alta en BOLT (Camilo,
 * 07/10/2026, la 3035LTX), y la pantalla lo avisa.
 */
const cocheActivo = c => (c.enBolt ? String(c.estado || '').toLowerCase() === 'active' : !!c.enErp);

/**
 * EL TABLERO DE UN DÍA: cada matrícula con su conductor de día y de noche ese
 * día, y quién de los activos se ha quedado sin plaza.
 */
async function tablero({ fecha } = {}) {
  const dia = esFecha(fecha) ? fecha : hoyMadrid();
  let conductores, coches, asig;
  try {
    [conductores, coches, asig] = await Promise.all([repo.conductores(SEDE), repo.coches(SEDE), repo.asignacionesEn(SEDE, dia)]);
  } catch (e) {
    if (repo.faltaMigracion(e)) return { faltaMigracion: true, fecha: dia, hoy: hoyMadrid() };
    throw e;
  }
  const porUuid = new Map(conductores.map(c => [c.uuid, c]));
  const quien = a => {
    const c = porUuid.get(a.uuid) || {};
    return { uuid: a.uuid, nombre: c.nombre || 'Cuenta de BOLT desconocida', telefono: c.telefono || '',
      activa: activa(c), desde: a.desde };
  };

  // Una fila por coche: los activos, y los desactivados solo si alguien los tiene.
  const plaza = new Map();
  asig.forEach(a => plaza.set(`${a.matricula}|${a.turno}`, quien(a)));
  const conAsig = new Set(asig.map(a => a.matricula));
  const filas = coches
    .filter(c => cocheActivo(c) || conAsig.has(c.matricula))
    .map(c => ({
      matricula: c.matricula, modelo: c.modelo, estado: c.estado, activo: cocheActivo(c), enBolt: !!c.enBolt,
      dia: plaza.get(`${c.matricula}|dia`) || null, noche: plaza.get(`${c.matricula}|noche`) || null,
    }));
  // Una asignación a una matrícula que ya no está ni en BOLT ni en Vehículos no se esconde.
  asig.filter(a => !coches.some(c => c.matricula === a.matricula)).forEach(a => {
    if (filas.some(f => f.matricula === a.matricula)) return;
    filas.push({ matricula: a.matricula, modelo: '', estado: 'ya no es de la sede', activo: false, enBolt: false,
      dia: plaza.get(`${a.matricula}|dia`) || null, noche: plaza.get(`${a.matricula}|noche`) || null });
  });
  filas.sort((a, b) => (Number(b.activo) - Number(a.activo)) || a.matricula.localeCompare(b.matricula));

  const conPlaza = new Set(asig.map(a => a.uuid));
  const activos = conductores.filter(activa);
  const plazasDe = new Map();
  asig.forEach(a => {
    if (!plazasDe.has(a.uuid)) plazasDe.set(a.uuid, []);
    plazasDe.get(a.uuid).push({ matricula: a.matricula, turno: a.turno });
  });

  return {
    fecha: dia, hoy: hoyMadrid(),
    filas,
    conductores: activos.map(c => ({ uuid: c.uuid, nombre: c.nombre, telefono: c.telefono, plazas: plazasDe.get(c.uuid) || [] })),
    sinPlaza: activos.filter(c => !conPlaza.has(c.uuid)).map(c => ({ uuid: c.uuid, nombre: c.nombre, telefono: c.telefono })),
    resumen: {
      coches: filas.filter(f => f.activo).length,
      plazas: filas.filter(f => f.activo).length * 2,
      cubiertas: asig.length,
      conductores: activos.length,
      sinPlaza: activos.filter(c => !conPlaza.has(c.uuid)).length,
    },
  };
}

/**
 * PONER O QUITAR A ALGUIEN de una plaza desde un día. Comprueba que la matrícula
 * es de un coche de la sede, que la persona es una cuenta ACTIVA de la sede y que
 * la fecha es razonable (hasta un mes atrás, para corregir lo que se olvidó; y
 * hasta dos meses adelante).
 */
async function asignar({ matricula, turno, conductor, desde } = {}, usuarioId) {
  const mat = String(matricula || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const t = String(turno || '');
  // El selector de la casa puede devolver { valor } (ver Componentes de la casa).
  const uuid = conductor && typeof conductor === 'object' ? String(conductor.valor || '') : String(conductor || '');
  const hoy = hoyMadrid();
  const d = esFecha(desde) ? desde : hoy;
  if (!TURNOS.includes(t)) throw new Error('El turno tiene que ser de día o de noche.');
  if (d < sumar(hoy, -31) || d > sumar(hoy, 60)) throw new Error('La fecha tiene que estar entre un mes atrás y dos meses adelante.');

  const [coches, conductores] = await Promise.all([repo.coches(SEDE), repo.conductores(SEDE)]);
  if (!coches.some(c => c.matricula === mat)) throw new Error(`La matrícula ${mat || '(vacía)'} no es de un coche de Barcelona (ni en BOLT ni en Vehículos).`);
  if (uuid) {
    const c = conductores.find(x => x.uuid === uuid);
    if (!c) throw new Error('Esa persona no es una cuenta de BOLT de Barcelona.');
    if (!activa(c)) throw new Error(`${c.nombre || 'Esa cuenta'} no está activa en BOLT.`);
  }

  const r = await repo.asignar({ sede: SEDE, matricula: mat, turno: t, driverUuid: uuid || null, desde: d, usuarioId });
  const nombre = uuid ? (conductores.find(x => x.uuid === uuid) || {}).nombre : null;
  console.log(`🗓️ [BARCELONA] ${mat} ${t === 'dia' ? 'día' : 'noche'} desde ${d}: ` +
    `${nombre || 'libre'}${r.movidaDe ? ` (viene de ${r.movidaDe})` : ''}${r.cambio ? '' : ' (sin cambios)'}`);
  return { ...r, ...(await tablero({ fecha: d })) };
}

// ── EL REPORTE DE HORAS ──────────────────────────────────────────────────────

const MAX_DIAS_REPORTE = 31;

/**
 * Los ratos de trabajo de la sede en [iniMs, finMs), con el catálogo de estados
 * de Madrid. Se leen los apuntes desde un día antes: el último de antes de la
 * ventana dice en qué estado estaba cada uno al empezar.
 */
async function ratos(iniMs, finMs, opciones) {
  const [apuntes, mapa] = await Promise.all([
    repo.apuntesEntre(SEDE, iniMs - MS_DIA, finMs),
    repo.situaciones(),
  ]);
  return H.intervalos(apuntes, e => mapa.get(e) || 'otro', iniMs, finMs, opciones);
}

/**
 * EL REPORTE DE HORAS de unas fechas (hasta 31 días). Sin fechas, ayer.
 * Cada fecha lleva su turno de día (00:00→24:00) y su noche (12:00→12:00 del
 * día siguiente): por eso se leen los ratos desde el mediodía de la víspera
 * hasta el mediodía del día después.
 */
async function reporte({ desde, hasta } = {}) {
  const hoy = hoyMadrid();
  let d1 = esFecha(desde) ? desde : sumar(hoy, -1);
  let d2 = esFecha(hasta) ? hasta : d1;
  if (d2 < d1) [d1, d2] = [d2, d1];
  if (d2 > hoy) d2 = hoy;
  if (d1 > d2) d1 = d2;
  if (H.fechasEntre(d1, d2).length > MAX_DIAS_REPORTE) throw new Error(`El reporte va de un día a ${MAX_DIAS_REPORTE}: elige un rango más corto.`);

  const iniMs = R.instante(R.sumarDias(d1, -1), R.INICIO.noche);
  const finMs = Math.min(Date.now(), R.instante(R.sumarDias(d2, 1), R.INICIO.noche));
  try {
    const [ivs, asignaciones, conductores, coches] = await Promise.all([
      ratos(iniMs, finMs),
      repo.asignacionesEntre(SEDE, R.sumarDias(d1, -1), R.sumarDias(d2, 1)),
      repo.conductores(SEDE),
      repo.coches(SEDE),
    ]);
    return H.informe({ desde: d1, hasta: d2, ivs, asignaciones, conductores, coches });
  } catch (e) {
    if (repo.faltaMigracion(e)) return { faltaMigracion: true, desde: d1, hasta: d2 };
    throw e;
  }
}

/** El Excel del reporte: { bytes, nombre }. */
async function reporteExcel(q = {}) {
  const datos = await reporte(q);
  if (datos.faltaMigracion) throw new Error('Falta aplicar la migración db/181 (en Migraciones): Barcelona aún no tiene horas.');
  const bytes = await require('./barcelona.excel').generar(datos);
  const dm = iso => iso.split('-').reverse().join('-');
  const nombre = datos.desde === datos.hasta
    ? `Horas Barcelona ${dm(datos.desde)}.xlsx`
    : `Horas Barcelona ${dm(datos.desde)} a ${dm(datos.hasta)}.xlsx`;
  return { bytes, nombre };
}

module.exports = { SEDE, tablero, asignar, hoyMadrid, ratos, reporte, reporteExcel, cocheActivo };
