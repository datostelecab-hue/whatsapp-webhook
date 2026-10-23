// ============================================================
// COMBUSTIBLE · EL EXCEL DE REPOSTAJES DE PETROPRIX
// ============================================================
// Puro: ni base ni red ni fichero. De las celdas de la hoja a los repostajes,
// con lo que no se entiende aparte y los avisos de cada fila.
//
// Camilo, 23/10/2026: «Petroprix […] no mandan correos por cada repostaje,
// entonces toca crear en el módulo un importador de excel […] siempre llegan
// con la misma estructura». El primero: «repostajes (14).xlsx», una hoja
// «Repostajes», 1.866 filas del 01/10 al 22/10/2026. TODO va como texto:
//
//   Fecha            «22-10-2026 18:14:01»   hora de Madrid, con segundos, sin zona
//   Matricula        «7222LVG», a veces en minúsculas («2903lzh»)
//   Vehículo         «Turismo» o «-»
//   Combustible      «Gasolina» (3 «Diesel»)
//   Litros           «13,93»                 coma decimal
//   Precio           «23,53»                 el importe TOTAL en €, no el €/L
//   Método de pago   «Pago Petroprix» (5 «Tarjeta», 6 «Efectivo»)
//   Gasolinera       «Alcobendas 2\nCalle Valgrande 11 28108»   nombre, salto y dirección
//
// SE RECONOCE POR SU CABECERA, EXACTA. Si no es esa, no es el Excel de
// Petroprix y no se importa nada: mejor decirlo que meter en la auditoría las
// columnas de otro fichero. Vale en cualquier hoja (la primera que la tenga).
//
// UNA FILA RARA NO PARA LAS DEMÁS. La que no se entiende (una fecha que no es
// fecha, unos litros imposibles, sin matrícula o sin gasolinera) se aparta con
// su porqué, y las demás entran. Los límites son los del correo de Ballenoil
// (lector.ballenoil): lo que no puede ser un repostaje de un turismo no llega
// a la base.
//
// SIN DUPLICADOS: LA CLAVE DE LA FILA. Petroprix no da un identificador, y
// Camilo bajará exportaciones que se solapan. La clave es la huella de la hora
// con segundos (tal cual la escribe el Excel, antes de decidir nada del cambio
// de hora), la matrícula normalizada, los litros y el importe: dos repostajes
// distintos del mismo coche en el mismo segundo con los mismos litros y euros
// no existen. La gasolinera, el pago y «Vehículo» no entran a propósito: si un
// día Petroprix arregla «CantueÃ±a», la fila sigue siendo la misma. Lo que NO
// cubre: si Petroprix corrige la matrícula de una fila ya importada, entra otra.
// Y si una exportación posterior escribe la misma fila con la hora corrida (una
// hora, después del cambio de hora, o unos segundos), la clave es otra: eso lo
// para el importador, que busca la misma fila ya guardada a ±2 s o a una hora
// (combustible.service.importarExcel, repo.casiIgualesDelExcel).
//
// EL CAMBIO DE HORA. El último domingo de octubre (el 25/10/2026), de 02:00 a
// 02:59 cada hora pasa dos veces, y el Excel no dice cuál. Si el fichero va
// ordenado por la hora (el de Petroprix va de lo más nuevo a lo más viejo) y
// DENTRO de esa hora la hora vuelve a subir, es que ahí empieza la primera
// pasada: las de antes del salto son de la segunda (horario de invierno) y las
// de después, de la primera (verano). Si no hay salto, no se puede saber: se
// toma la segunda —lo mismo que hace PostgreSQL con `AT TIME ZONE`— y la fila
// lleva un aviso para mirarla. Así, BOLT, el bot y Mapon miran el mismo
// instante. Y la hora de marzo que no existe (02:00-02:59 del último domingo),
// la de PostgreSQL también (una hora después), con su aviso.

const crypto = require('crypto');
const C = require('./lector.comun');

const PROVEEDOR = 'petroprix';
const CABECERA = ['Fecha', 'Matricula', 'Vehículo', 'Combustible', 'Litros', 'Precio', 'Método de pago', 'Gasolinera'];

// Los de un repostaje de turismo (los mismos que el correo de Ballenoil).
const LIMITES = { litros: [0, 200], importe: [0, 2000], precioLitro: [0.3, 10], texto: 40, gasolinera: 160 };
const dentro = (v, [a, b]) => v >= a && v <= b;

// Lo que es «pagar con la app»: lo de siempre. Lo demás se avisa.
const PAGO_NORMAL = 'Pago Petroprix';

/**
 * Una celda de exceljs como texto: el texto tal cual; un número con coma (es
 * lo que escribiría Petroprix); una fecha de Excel —si alguien abre el fichero y
 * lo guarda, puede volverse fecha— con su hora de pared (exceljs la da en UTC);
 * el texto enriquecido y el resultado de una fórmula, juntos.
 */
function textoCelda(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(v.getUTCDate())}-${p(v.getUTCMonth() + 1)}-${v.getUTCFullYear()} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`;
  }
  if (Array.isArray(v.richText)) return v.richText.map(x => x.text || '').join('');
  if (v.result !== undefined) return textoCelda(v.result);
  if (v.text !== undefined) return String(v.text);
  return String(v);
}

const limpiarCab = t => String(t || '').normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * ¿Es el Excel de Petroprix? `hojas`: [{ nombre, filas: [[celda, …], …] }] con
 * las celdas ya en texto y el número de fila de la hoja en `filas[i].n` (o i+1).
 * → { hoja, filaCabecera, filas } o { motivo } si ninguna hoja lo es.
 */
function reconocer(hojas) {
  const vistas = [];
  for (const h of hojas || []) {
    for (const fila of (h.filas || []).slice(0, 5)) {
      const celdas = (fila.celdas || fila).map(limpiarCab);
      if (!celdas.some(Boolean)) continue;
      const sobran = celdas.slice(CABECERA.length).some(Boolean);
      if (!sobran && CABECERA.every((t, i) => celdas[i] === t)) {
        return { hoja: h.nombre, filaCabecera: fila.n, filas: h.filas.filter(f => f.n > fila.n) };
      }
      vistas.push(`«${h.nombre}»: ${celdas.filter(Boolean).slice(0, 8).join(' · ')}`);
      break;   // la primera fila con algo es la cabecera de esa hoja
    }
  }
  return { motivo: 'Este Excel no es el de repostajes de Petroprix: su cabecera tiene que ser exactamente ' +
    `«${CABECERA.join(' · ')}»${vistas.length ? `, y la que tiene es ${vistas.slice(0, 2).join('; ')}` : ', y no tiene ninguna'}. No se ha importado nada` };
}

/** «22-10-2026 18:14:01» → '2026-10-22T18:14:01' (hora de Madrid, sin zona), o null. */
function fechaDelExcel(txt) {
  const m = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(txt || ''));
  if (!m) return null;
  const [dd, mm, a, hh, mi, ss] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || hh > 23 || mi > 59 || ss > 59) return null;
  const prueba = new Date(Date.UTC(a, mm - 1, dd));
  if (prueba.getUTCMonth() !== mm - 1) return null;
  const p = n => String(n).padStart(2, '0');
  return `${a}-${p(mm)}-${p(dd)}T${p(hh)}:${p(mi)}:${p(ss)}`;
}

const relojMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const enMadrid = ms => relojMadrid.format(ms).replace(' ', 'T');

/**
 * Los instantes (ms UTC) que en Madrid se escriben así: uno, casi siempre; dos
 * en la hora que se repite de octubre; ninguno en la que no existe de marzo.
 */
function instantesMadrid(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return [];
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // Madrid va a UTC+2 (verano) o UTC+1 (invierno): de antes a después.
  return [base - 2 * 3600e3, base - 3600e3].filter(t => enMadrid(t) === local);
}

/** La huella de una fila: lo que la hace la misma en dos exportaciones. */
const claveDe = ({ local, matricula, litros, importe }) => crypto.createHash('sha256')
  .update([PROVEEDOR, local, matricula, Number(litros).toFixed(2), Number(importe).toFixed(2)].join('|'))
  .digest('hex');

/**
 * ¿El coche va con gasolina? Los de la flota son híbridos de gasolina (Toyota
 * Corolla, Hyundai Ioniq, Ford Mondeo Hybrid). true, false (diésel) o null si
 * el modelo no lo dice (el Mercedes E220 de Barcelona puede ser cualquiera).
 */
function esDeGasolina(marcaModelo) {
  const t = String(marcaModelo || '').toLowerCase();
  if (!t) return null;
  if (/di[eé]sel|\btdi\b|\bdci\b|\bcrdi\b|\bhdi\b|\b\d{3}d\b/.test(t)) return false;
  if (/h[ií]brid|hybrid|corolla|ioniq|mondeo|prius|c-hr|yaris|niro/.test(t)) return true;
  return null;
}

// Un repostaje no puede ser de después de importarlo. Con unos minutos de
// margen, por si el reloj de Petroprix y el del servidor no son el mismo.
const MARGEN_FUTURO_MS = 10 * 60e3;

/**
 * Lee las filas de datos (las de debajo de la cabecera). `filas`: [{ n,
 * celdas: [texto × 8] }] en el orden del fichero. `ahora` (ms): lo que sea de
 * después (con 10 minutos de margen) se aparta como error.
 * → { filas: [repostaje], errores: [{ fila, motivo, celdas }] }
 *
 * Cada repostaje: { fila, local, instante (ms), horaRepetida, matricula,
 * vehiculo, combustible, litros, importe, pago, gasolinera, celdas, clave,
 * avisos }. `horaRepetida`: null, 'primera', 'segunda' o 'sin_saber'
 * (se tomó la segunda).
 *
 * UNA FECHA DEL FUTURO NO ENTRA (revisión del 23/10/2026). Con dos filas del
 * 25/10 en un Excel de prueba subido el 23/10, entraban como nuevas: BOLT las
 * dejaba «pendiente», el bot se las daba a quien tenía el coche en ese momento,
 * la lista no las enseñaba (llega hasta hoy) y la nota decía «Petroprix: hasta
 * el 25/10». Un día y un mes cambiados en una exportación meterían repostajes
 * en el futuro sin que nadie los viera.
 */
function leerFilas(filas, { ahora } = {}) {
  const buenas = [], errores = [];
  for (const f of filas || []) {
    const cel = (f.celdas || []).map(x => String(x == null ? '' : x));
    if (!cel.some(x => x.trim())) continue;                 // una fila vacía, al final
    const celdas = Object.fromEntries(CABECERA.map((t, i) => [t, cel[i] || '']));
    const mal = [];
    const local = fechaDelExcel(celdas.Fecha);
    if (!local) mal.push(`la fecha «${celdas.Fecha}» no se entiende (tiene que ser DD-MM-AAAA HH:MM:SS)`);
    const matricula = C.matricula(celdas.Matricula);
    if (!(matricula.length >= 4 && matricula.length <= 10 && /\d/.test(matricula))) {
      mal.push(celdas.Matricula.trim() ? `la matrícula «${celdas.Matricula}» no es una matrícula` : 'no trae matrícula');
    }
    const litros = celdas.Litros.trim() ? C.numero(celdas.Litros) : null;
    const importe = celdas.Precio.trim() ? C.numero(celdas.Precio) : null;
    if (litros == null) mal.push(celdas.Litros.trim() ? `los litros «${celdas.Litros}» no se entienden` : 'no trae los litros');
    else if (!dentro(litros, LIMITES.litros) || (litros === 0 && importe !== 0)) mal.push(`${celdas.Litros} litros no puede ser un repostaje`);
    if (importe == null) mal.push(celdas.Precio.trim() ? `el precio «${celdas.Precio}» no se entiende` : 'no trae el precio');
    else if (!dentro(importe, LIMITES.importe)) mal.push(`${celdas.Precio} € no puede ser un repostaje`);
    if (litros > 0 && importe > 0 && !dentro(importe / litros, LIMITES.precioLitro)) {
      mal.push(`${celdas.Litros} L por ${celdas.Precio} € salen ${(importe / litros).toFixed(3).replace('.', ',')} €/L`);
    }
    const gasolinera = celdas.Gasolinera.replace(/\r\n?/g, '\n');
    if (!gasolinera.trim()) mal.push('no trae la gasolinera');
    if (mal.length) { errores.push({ fila: f.n, motivo: mal.join('; '), celdas }); continue; }

    const candidatos = instantesMadrid(local);
    const corto = v => (String(v || '').trim().slice(0, LIMITES.texto) || null);
    buenas.push({
      fila: f.n, local, candidatos, instante: candidatos.length === 1 ? candidatos[0] : null, horaRepetida: null,
      matricula, vehiculo: corto(celdas['Vehículo']), combustible: corto(celdas.Combustible),
      litros, importe, pago: corto(celdas['Método de pago']), gasolinera: gasolinera.slice(0, LIMITES.gasolinera),
      celdas, clave: claveDe({ local, matricula, litros, importe }), avisos: [],
    });
  }
  decidirHoraRepetida(buenas);
  if (!Number.isFinite(ahora)) return { filas: buenas, errores };
  const hasta = ahora + MARGEN_FUTURO_MS;
  for (const f of buenas.filter(x => x.instante > hasta)) {
    errores.push({ fila: f.fila, celdas: f.celdas,
      motivo: `la fecha «${f.celdas.Fecha}» es de después de importar el Excel: ¿el día y el mes cambiados?` });
  }
  errores.sort((a, b) => a.fila - b.fila);
  return { filas: buenas.filter(x => !(x.instante > hasta)), errores };
}

/**
 * La hora que pasa dos veces, por el orden del fichero (cabecera). Rellena
 * `instante` y `horaRepetida` de las que tienen dos candidatos, y el de las de
 * la hora que no existe.
 */
function decidirHoraRepetida(filas) {
  for (const f of filas) {
    if (!f.candidatos.length) {
      // Marzo: esa hora no existe en Madrid. La de PostgreSQL: una hora después.
      const base = instantesSinZona(f.local);
      f.instante = base - 3600e3;
      f.avisos.push(`El ${aDdmm(f.local)} a las ${f.local.slice(11, 16)} no existe en Madrid (esa noche se adelanta la hora): se toma como si fuera una hora después`);
    }
  }
  const dobles = filas.filter(f => f.candidatos.length === 2);
  if (!dobles.length) return;
  // ¿Va el fichero ordenado por la hora? Mirando las demás filas, en su orden.
  const sencillas = filas.filter(f => f.candidatos.length === 1);
  const desc = sencillas.length < 2 || sencillas[0].instante >= sencillas[sencillas.length - 1].instante;
  const ordenado = sencillas.every((f, i) => i === 0 || (desc ? sencillas[i - 1].instante >= f.instante : sencillas[i - 1].instante <= f.instante));
  const porDia = new Map();
  for (const f of dobles) {
    const d = f.local.slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(f);
  }
  for (const fs of porDia.values()) {
    // De lo más nuevo a lo más viejo: la segunda pasada sale antes. Si la hora
    // vuelve a SUBIR, ahí empieza la primera. (Al revés si va de viejo a nuevo.)
    let salto = -1;
    if (ordenado) {
      for (let i = 1; i < fs.length; i++) {
        if (desc ? fs[i].local > fs[i - 1].local : fs[i].local < fs[i - 1].local) { salto = i; break; }
      }
    }
    fs.forEach((f, i) => {
      const primera = salto >= 0 && (desc ? i >= salto : i < salto);
      f.horaRepetida = salto < 0 ? 'sin_saber' : primera ? 'primera' : 'segunda';
      f.instante = f.candidatos[primera ? 0 : 1];
      if (salto < 0) {
        f.avisos.push(`El ${aDdmm(f.local)} a las ${f.local.slice(11, 16)} pasa dos veces (cambio de hora) y el Excel no deja saber cuál: ` +
          'se toma la segunda (ya en horario de invierno). Si sale rojo, puede ser la primera, una hora antes');
      }
    });
  }
}

const instantesSinZona = local => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(local);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};
const aDdmm = local => local.slice(0, 10).split('-').reverse().join('/');

/**
 * Los avisos de una fila que no cambian con el tiempo (se guardan con el
 * repostaje). `coche`: { marcaModelo } si está en Vehículos. Los que sí pueden
 * cambiar —la matrícula que no está en Vehículos, la gasolinera que no casa—
 * no se guardan: los dice la pantalla mientras sigan así (y el resumen de la
 * importación los cuenta).
 * → [{ tipo, texto }]
 */
function avisosFijos(f, coche) {
  const out = [];
  if (/^di[eé]sel/i.test(f.combustible || '') && coche && esDeGasolina(coche.marcaModelo) === true) {
    out.push({ tipo: 'diesel', texto: `Diésel en un coche de gasolina (${coche.marcaModelo}): ¿otro surtidor, otro coche o un error de Petroprix?` });
  }
  if (f.pago && f.pago !== PAGO_NORMAL) {
    out.push({ tipo: 'pago', texto: `Pagado con «${f.pago}», no con la app de Petroprix` });
  }
  if (f.vehiculo === '-' || !f.vehiculo) {
    out.push({ tipo: 'vehiculo', texto: `Petroprix no dice qué vehículo es (en «Vehículo» pone «${f.vehiculo || ''}»)` });
  }
  return out;
}

module.exports = {
  PROVEEDOR, CABECERA, PAGO_NORMAL, LIMITES, MARGEN_FUTURO_MS,
  textoCelda, reconocer, fechaDelExcel, instantesMadrid, claveDe, esDeGasolina, leerFilas, avisosFijos,
};
