// ============================================================
// LIBRANZAS: AGENDA_V2 → L_Acumuladas
// ============================================================
// Fuente única de libranzas. AGENDA_V2 solo tiene la SEMANA EN CURSO (checkboxes
// Lun–Dom por conductor). Cada corrida:
//   · reescribe por completo la semana actual en L_Acumuladas (pone y quita L,
//     para que destildar un check se refleje),
//   · deja intactas las semanas anteriores (histórico congelado).
//
// L_Acumuladas es el CONTRATO con lo que arma VISTA_FINAL: Render la escribe,
// el resto solo la lee. Formato intacto: Nombre | Flota | (una col por fecha).
//
// IMPORTANTE: mientras esto esté activo, el Apps Script NO debe volver a escribir
// L_Acumuladas (hay que neutralizar allí acumularLSemanales), o se pisarían.

const { leerTablero } = require('./planificadorV2');
const { readSheet, clearSheet, writeSheetRaw } = require('./sheets');

// Hoja donde vive L_Acumuladas (y VISTA_FINAL): "GestionConductores".
const ID_GESTION = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA_LACUM = 'L_Acumuladas';
const HOJA_VISTA = 'VISTA_FINAL';
const TZ = 'Europe/Madrid';

// Mismo criterio de limpieza que usa el resto del pipeline, para que los nombres
// casen con VISTA_FINAL: quita lo que va entre paréntesis y pasa a minúsculas.
function limpiarNombre(n) {
  return (n || '').toString().replace(/\s*\(.*?\)\s*/, '').trim().toLowerCase();
}

// Fecha de hoy en la zona horaria de la flota, como 'YYYY-MM-DD'. No se usa el
// huso del servidor (Render corre en UTC): a las 00:30 de Madrid en verano el
// servidor aún cree que es el día anterior, y la semana saldría corrida.
function hoyEnMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// Las 7 claves 'YYYY-MM-DD' de la semana actual, de lunes a domingo. Se opera a
// mediodía UTC para que el cambio de hora (DST) no descuadre el día.
function clavesSemanaActual() {
  const [Y, M, D] = hoyEnMadrid().split('-').map(Number);
  const base = new Date(Date.UTC(Y, M - 1, D, 12));
  const dow = base.getUTCDay();                 // 0=Dom … 6=Sáb
  const offsetLunes = dow === 0 ? 6 : dow - 1;
  const lunes = new Date(base);
  lunes.setUTCDate(base.getUTCDate() - offsetLunes);

  const claves = [];
  for (let d = 0; d < 7; d++) {
    const f = new Date(lunes);
    f.setUTCDate(lunes.getUTCDate() + d);
    claves.push(f.toISOString().slice(0, 10));
  }
  return claves;                                // [Lun … Dom]
}

// Cabeceras de L_Acumuladas: texto 'YYYY-MM-DD'. Se tolera dd/mm/yyyy por si
// alguna quedó convertida a fecha en el pasado.
function fechaValorAKey(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Sincroniza L_Acumuladas con la semana en curso de AGENDA_V2.
 * Devuelve un resumen para el log / la respuesta HTTP.
 */
async function sincronizarLibranzas() {
  const semana = clavesSemanaActual();
  const setSemana = new Set(semana);

  // 1. AGENDA_V2 (vía el lector del planificador, ya probado)
  const tablero = await leerTablero();
  const conductores = (tablero && tablero.conductores) || [];
  // No tocar el histórico si la agenda vino vacía: sería borrar la semana por
  // un fallo de lectura, no porque de verdad nadie libre.
  if (conductores.length === 0) {
    throw new Error('AGENDA_V2 sin conductores: L_Acumuladas NO se modifica');
  }

  // 2. L_Acumuladas actual → mapa nombre → Set(fechaKey con L)
  const filas = await readSheet(ID_GESTION, `${HOJA_LACUM}!A:ZZZ`);
  const acum = {};
  if (filas.length > 1) {
    const fechas = (filas[0] || []).slice(2).map(fechaValorAKey);
    for (let i = 1; i < filas.length; i++) {
      const nombre = limpiarNombre(filas[i][0]);
      if (!nombre) continue;
      if (!acum[nombre]) acum[nombre] = new Set();
      for (let j = 2; j < filas[i].length; j++) {
        const clave = fechas[j - 2];
        if (clave && String(filas[i][j]).trim().toUpperCase() === 'L') {
          acum[nombre].add(clave);
        }
      }
    }
  }

  // 3. Vaciar la semana actual en TODOS: la define AGENDA_V2, no el histórico.
  //    Esto es lo que hace que un des-check quite la L.
  Object.values(acum).forEach(set => semana.forEach(k => set.delete(k)));

  // 4. Superponer la semana actual desde AGENDA_V2
  let conLibranza = 0;
  const nombresAgenda = [];
  conductores.forEach(c => {
    const nombre = limpiarNombre(c.nombre);
    if (!nombre) return;
    nombresAgenda.push(nombre);
    const libra = c.libra || [];
    if (!acum[nombre]) acum[nombre] = new Set();
    for (let d = 0; d < 7; d++) {
      if (libra[d]) { acum[nombre].add(semana[d]); conLibranza++; }
    }
  });

  // 5. Reconstruir la matriz (mismo formato: Nombre | Flota | fechas)
  const fechasFinal = new Set();
  Object.values(acum).forEach(set => set.forEach(k => fechasFinal.add(k)));
  const cols = Array.from(fechasFinal).sort();

  const matriz = [['Nombre', 'Flota', ...cols]];
  Object.keys(acum).sort().forEach(nombre => {
    const set = acum[nombre];
    matriz.push([nombre, '', ...cols.map(k => (set.has(k) ? 'L' : ''))]);
  });

  // 6. Escribir (clear total + RAW para que las fechas queden como texto)
  await clearSheet(ID_GESTION, HOJA_LACUM);
  await writeSheetRaw(ID_GESTION, `${HOJA_LACUM}!A1`, matriz);

  const resumen = {
    semana: `${semana[0]} → ${semana[6]}`,
    conductoresAgenda: conductores.length,
    libranzasSemana: conLibranza,
    fechasHistorico: cols.length,
    filasEscritas: matriz.length - 1
  };
  console.log(`📅 [Libranzas] ${resumen.semana} · ${conLibranza} L en la semana · ` +
    `${cols.length} fechas en histórico`);
  return resumen;
}

/**
 * No escribe nada. Reporta los conductores que tienen libranza en AGENDA_V2
 * pero cuyo nombre NO aparece en VISTA_FINAL: esos son los que se perderían por
 * desajuste de nombres (el emparejamiento es por nombre, no por ID de Bolt).
 */
async function diagnosticarLibranzas() {
  const semana = clavesSemanaActual();
  const tablero = await leerTablero();
  const conductores = (tablero && tablero.conductores) || [];

  const filasVista = await readSheet(ID_GESTION, `${HOJA_VISTA}!B4:B`);
  const enVista = new Set(filasVista.map(r => limpiarNombre(r[0])).filter(Boolean));

  const conLibranza = conductores.filter(c => (c.libra || []).some(Boolean));
  const sinCasar = conLibranza
    .map(c => ({ nombre: c.nombre, clave: limpiarNombre(c.nombre) }))
    .filter(x => x.clave && !enVista.has(x.clave));

  console.log(`🔎 [Libranzas] ${conLibranza.length} con libranza esta semana; ` +
    `${sinCasar.length} sin nombre equivalente en VISTA_FINAL`);
  sinCasar.forEach(x => console.log(`   · "${x.nombre}" no está en VISTA_FINAL`));

  return {
    semana: `${semana[0]} → ${semana[6]}`,
    conLibranza: conLibranza.length,
    enVistaFinal: enVista.size,
    sinCasar: sinCasar.map(x => x.nombre)
  };
}

module.exports = { sincronizarLibranzas, diagnosticarLibranzas };
