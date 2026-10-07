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

const SEDE = 'barcelona';
const TURNOS = ['dia', 'noche'];
const MS_DIA = 86400000;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const esFecha = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const sumar = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * MS_DIA).toISOString().slice(0, 10);

/** ¿Está activa en BOLT? Solo a esas se las ofrece para planificar. */
const activa = c => String(c.estado || '').toLowerCase() === 'active';
/** ¿El coche está dado de alta en BOLT? (los desactivados no se ofrecen) */
const cocheActivo = c => String(c.estado || '').toLowerCase() === 'active';

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
      matricula: c.matricula, modelo: c.modelo, estado: c.estado, activo: cocheActivo(c),
      dia: plaza.get(`${c.matricula}|dia`) || null, noche: plaza.get(`${c.matricula}|noche`) || null,
    }));
  // Una asignación a una matrícula que BOLT ya no devuelve no se esconde.
  asig.filter(a => !coches.some(c => c.matricula === a.matricula)).forEach(a => {
    if (filas.some(f => f.matricula === a.matricula)) return;
    filas.push({ matricula: a.matricula, modelo: '', estado: 'fuera de BOLT', activo: false,
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
  if (!coches.some(c => c.matricula === mat)) throw new Error(`La matrícula ${mat || '(vacía)'} no es de un coche de Barcelona en BOLT.`);
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

module.exports = { SEDE, tablero, asignar, hoyMadrid };
