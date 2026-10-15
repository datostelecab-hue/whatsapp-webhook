// ============================================================
// CUMPLEAÑOS — quién cumple hoy
// ============================================================
// Camilo, 15/10/2026: «Vamos a crear algo para el cumpleaños de los
// conductores. En el perfil de TODOS (sin excepción) saldrán tarjetas de
// notificación de los conductores que están cumpliendo años ese día… que diga
// si es conductor o si es de oficina… al que sea el cumpleañero el sistema lo
// felicitará a nombre de Telecab».
//
// Lo usan:
//   · las tarjetas que salen en todas las pantallas (public/assets/js/cumpleanos.js),
//     que piden `hoy()` una vez al cargar;
//   · Control → En directo, que pinta en azul la fila de quien cumple
//     (`idsConductoresHoy`).
//
// «Hoy» es el día de calendario en Madrid, no la jornada operativa: un
// cumpleaños empieza a medianoche. Se guarda cinco minutos: lo piden todas las
// pantallas de todo el mundo al cargar.

const repo = require('./cumpleanos.repo');

const TZ = 'Europe/Madrid';
const TTL = 5 * 60 * 1000;
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const bisiesto = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

let cache = null;

/** Los de un día, sin filtrar por quién pregunta. Pura salvo el repositorio. */
async function delDia(dia) {
  const [y, m, d] = String(dia).split('-').map(Number);
  // Los del 29 de febrero, en un año no bisiesto, el 28.
  const del29 = m === 2 && d === 28 && !bisiesto(y);
  const [conductores, oficina] = await Promise.all([repo.conductores(m, d, del29), repo.oficina(m, d, del29)]);
  return { dia, conductores, oficina };
}

async function deHoy() {
  const dia = hoyMadrid();
  if (cache && cache.dia === dia && cache.hasta > Date.now()) return cache;
  cache = { ...(await delDia(dia)), hasta: Date.now() + TTL };
  return cache;
}

/**
 * LO QUE VE CADA UNO HOY. Si quien pregunta es el que cumple, no le sale «Fulano
 * cumple hoy»: le sale la felicitación, de parte de Telecab.
 *
 * { dia, conductores: [{ id, nombre, ett }], oficina: [{ id, nombre, apellidos, rol }],
 *   felicitar: { nombre } | null }
 */
async function hoy(usuarioId) {
  const c = await deHoy();
  const yo = Number(usuarioId);
  const mio = c.oficina.find(o => o.id === yo) || null;
  return {
    dia: c.dia,
    conductores: c.conductores,
    oficina: c.oficina.filter(o => o.id !== yo),
    felicitar: mio ? { nombre: mio.nombre } : null,
  };
}

/** Los ids de los conductores que cumplen hoy, para Control. */
async function idsConductoresHoy() {
  const c = await deHoy();
  return new Set(c.conductores.map(x => String(x.id)));
}

/** Se olvida lo guardado: quien acaba de poner su fecha de nacimiento la ve ya. */
const olvidar = () => { cache = null; };

module.exports = { hoy, delDia, idsConductoresHoy, olvidar };
