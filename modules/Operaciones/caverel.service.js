// ============================================================
// HORAS CAVEREL — servicio (db/238)
// ============================================================
// Camilo, 10/11/2026: «Tengo las horas de Caverel de mucho antes, resumida por
// meses, vamos a hacer un apartado en la bitácora llamado "Horas Caverel", en la
// cual vamos a poder visualizar las horas mensuales de este archivo por nombre,
// que se vea la utilización, horas totales y desglosadas por espera y viaje por
// el mes que se le ve ahí».
//
// El archivo es el «Fleet Owner Earnings Report» de BOLT agrupado por meses: una
// fila por cuenta y mes. Se sube desde la pantalla (los datos no van en el
// repositorio: es público y el archivo trae DNI) y se guarda en
// bitacora_caverel_mes. Subirlo otra vez sustituye cada cuenta y mes.
//
// LAS CUENTAS, de cada fila:
//   horas     «Total Online Hours»: conectado (viaje + espera)
//   utiliz.   «Occupation Rate»: % del tiempo conectado con pasajero. Es la
//             utilización de la casa (viaje / viaje + espera); BOLT la da
//             redondeada a un % entero, así que el viaje y la espera que salen
//             de ella llevan ese redondeo (como mucho, medio punto de las horas)
//   viaje     horas × utilización
//   espera    horas − viaje
// Y al sumar varios meses (o varias cuentas de la misma persona) la utilización
// es la del tiempo total —Σ viaje / Σ horas—, no la media de los porcentajes:
// pesa más el mes que más trabajó.

const repo = require('./caverel.repo');

// Lo que tiene que traer el archivo para que sea el que es.
const COLUMNAS = {
  nombre: 'Driver Name', cuenta: 'Hashed External ID', mes: 'Dynamic Timeframe',
  horas: 'Total Online Hours', ocupacion: 'Occupation Rate', viajes: 'Finished Trips Count',
  dni: 'Personal Code',
};
const MAX_BYTES = 6 * 1024 * 1024;   // el de oct-2026 (23 meses) pesa 1,2 MB
const MAX_FILAS = 60000;

/**
 * Un CSV a filas (arrays de texto). Comillas dobles con comas y saltos de línea
 * dentro, y "" para una comilla (RFC 4180): BOLT pone entre comillas los números
 * con separador de miles («"10,374.08"») y los nombres de empresa con coma.
 */
function leerCsv(texto) {
  const filas = [];
  let fila = [], celda = '', dentro = false;
  const s = String(texto || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dentro) {
      if (c === '"') {
        if (s[i + 1] === '"') { celda += '"'; i++; } else dentro = false;
      } else celda += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some(x => x !== '')) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some(x => x !== '')) filas.push(fila);
  return filas;
}

/** «10,374.08» → 10374.08; «86.00%» → 86. El formato del archivo es el inglés. Vacío → null. */
function numero(v) {
  const t = String(v === undefined || v === null ? '' : v).replace(/[,%\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const r2 = n => Math.round(n * 100) / 100;
const r1 = n => Math.round(n * 10) / 10;

/** Viaje, espera y utilización de unas horas con su ocupación. */
function desglose(horas, ocupacion) {
  const h = Number(horas) || 0;
  if (ocupacion === null || ocupacion === undefined) return { horas: r2(h), viaje: null, espera: null, utilizacion: null };
  const viaje = h * Number(ocupacion) / 100;
  return { horas: r2(h), viaje: r2(viaje), espera: r2(h - viaje), utilizacion: Number(ocupacion) };
}

/**
 * La suma de varias filas: horas, viaje, espera, viajes y la utilización del
 * tiempo total. Las filas sin ocupación suman horas pero no entran en la
 * utilización (no se sabe cuánto fue viaje).
 */
function sumar(filas) {
  let horas = 0, conOcup = 0, viaje = 0, viajes = 0;
  filas.forEach(f => {
    horas += Number(f.horas) || 0;
    viajes += Number(f.viajes) || 0;
    if (f.utilizacion !== null && f.utilizacion !== undefined) {
      conOcup += Number(f.horas) || 0;
      viaje += (Number(f.horas) || 0) * Number(f.utilizacion) / 100;
    }
  });
  return {
    horas: r2(horas), viajes,
    viaje: conOcup ? r2(viaje) : null,
    espera: conOcup ? r2(conOcup - viaje) : null,
    utilizacion: conOcup ? r1(viaje / conOcup * 100) : null,
  };
}

/**
 * EL ARCHIVO, LEÍDO Y COMPROBADO (puro). Devuelve
 *   { filas: [{ mes 'AAAA-MM-01', cuenta, nombre, dni, horas, ocupacion, viajes }],
 *     sinNombre, sinActividad, repetidas, malas: [{ linea, motivo }] }
 * y lanza un error legible si no es el archivo que tiene que ser.
 *   sinNombre     filas sin conductor (BOLT mete alguna vacía, todo a 0)
 *   sinActividad  con nombre pero 0 h y 0 viajes ese mes: no dicen nada
 *   repetidas     la misma cuenta y mes dos veces en el archivo: vale la última
 */
function interpretar(texto) {
  const filas = leerCsv(texto);
  if (!filas.length) throw new Error('El archivo está vacío.');
  const cab = filas[0].map(x => x.trim());
  const col = {};
  const faltan = [];
  Object.entries(COLUMNAS).forEach(([k, titulo]) => {
    const i = cab.indexOf(titulo);
    if (i < 0) faltan.push(titulo); else col[k] = i;
  });
  if (faltan.length) {
    throw new Error(`No es el informe de BOLT que se espera («Fleet Owner Earnings Report» por meses): le falta ${faltan.map(x => `«${x}»`).join(', ')}. No se ha importado nada.`);
  }
  if (filas.length - 1 > MAX_FILAS) throw new Error(`El archivo trae ${filas.length - 1} filas y el máximo son ${MAX_FILAS}. No se ha importado nada.`);

  const porClave = new Map();
  const malas = [];
  let sinNombre = 0, sinActividad = 0, repetidas = 0;
  filas.slice(1).forEach((f, i) => {
    const linea = i + 2;
    const nombre = String(f[col.nombre] || '').trim().replace(/\s+/g, ' ');
    if (!nombre) { sinNombre++; return; }
    const mesTxt = String(f[col.mes] || '').trim();
    const m = /^(\d{4})-(\d{2})$/.exec(mesTxt);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 2015 || +m[1] > 2100) {
      malas.push({ linea, motivo: `${nombre}: el mes «${mesTxt}» no es AAAA-MM (el informe tiene que estar agrupado por meses)` });
      return;
    }
    const horas = numero(f[col.horas]);
    const ocupacion = numero(f[col.ocupacion]);
    const viajes = numero(f[col.viajes]);
    if (horas === null || Number.isNaN(horas) || horas < 0 || horas > 744) {
      malas.push({ linea, motivo: `${nombre} (${mesTxt}): las horas «${f[col.horas]}» no son un número de horas de un mes` });
      return;
    }
    if (Number.isNaN(ocupacion) || (ocupacion !== null && (ocupacion < 0 || ocupacion > 100))) {
      malas.push({ linea, motivo: `${nombre} (${mesTxt}): la ocupación «${f[col.ocupacion]}» no es un %` });
      return;
    }
    if (Number.isNaN(viajes) || (viajes !== null && viajes < 0)) {
      malas.push({ linea, motivo: `${nombre} (${mesTxt}): los viajes «${f[col.viajes]}» no son un número` });
      return;
    }
    if (horas === 0 && !viajes) { sinActividad++; return; }
    // La cuenta es lo que identifica la fila. Si BOLT no la diera, el nombre:
    // dos personas con el mismo nombre se juntarían, pero es mejor que perderla.
    const cuenta = String(f[col.cuenta] || '').trim() || `nombre:${nombre.toLowerCase()}`;
    const mes = `${m[1]}-${m[2]}-01`;
    const clave = `${cuenta}|${mes}`;
    if (porClave.has(clave)) repetidas++;
    porClave.set(clave, {
      mes, cuenta: cuenta.slice(0, 64), nombre: nombre.slice(0, 160),
      dni: String(f[col.dni] || '').trim().toUpperCase().slice(0, 20) || null,
      horas: r2(horas), ocupacion, viajes: Math.round(viajes || 0),
    });
  });
  return { filas: [...porClave.values()], sinNombre, sinActividad, repetidas, malas };
}

/** «2025-01-01» → «enero 2025». */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = mes => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

/**
 * SUBIR EL CSV. `base64` del archivo. Se guarda todo o nada (una transacción):
 * si una fila no se puede leer, no entra ninguna y se dice cuál.
 */
async function importar({ base64, nombre } = {}, usuarioId) {
  if (!base64 || typeof base64 !== 'string') throw new Error('No ha llegado ningún archivo.');
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new Error('El archivo está vacío.');
  if (buf.length > MAX_BYTES) throw new Error(`El archivo pesa ${(buf.length / 1048576).toFixed(1)} MB y el máximo son ${MAX_BYTES / 1048576}. No se ha importado nada.`);
  if (nombre && !/\.csv$/i.test(String(nombre))) throw new Error('Tiene que ser el CSV que baja BOLT (Fleet Owner Earnings Report), no otro formato.');
  const leido = interpretar(buf.toString('utf8'));
  if (leido.malas.length) {
    const e = new Error(`Hay ${leido.malas.length} ${leido.malas.length === 1 ? 'fila que no se puede leer' : 'filas que no se pueden leer'}; no se ha importado nada. ` +
      leido.malas.slice(0, 5).map(x => `Línea ${x.linea}: ${x.motivo}.`).join(' ') + (leido.malas.length > 5 ? ` Y ${leido.malas.length - 5} más.` : ''));
    throw e;
  }
  if (!leido.filas.length) throw new Error('El archivo no trae ninguna fila con horas. No se ha importado nada.');
  const r = await repo.guardar(leido.filas, usuarioId);
  const meses = [...new Set(leido.filas.map(f => f.mes))].sort();
  console.log(`🕰️ [CAVEREL] ${nombre || 'CSV'}: ${leido.filas.length} filas (${r.nuevas} nuevas, ${r.cambiadas} sustituidas), ${meses[0]} → ${meses[meses.length - 1]}`);
  return {
    filas: leido.filas.length, nuevas: r.nuevas, cambiadas: r.cambiadas,
    personas: new Set(leido.filas.map(f => f.dni || f.cuenta)).size,
    desde: nombreMes(meses[0]), hasta: nombreMes(meses[meses.length - 1]), meses: meses.length,
    sinNombre: leido.sinNombre, sinActividad: leido.sinActividad, repetidas: leido.repetidas,
  };
}

/**
 * LA LISTA: una fila por cuenta y mes, del mes más nuevo al más viejo y, dentro
 * de cada mes, de más horas a menos. Sin el DNI: la pantalla no lo necesita.
 */
async function lista() {
  const filas = (await repo.lista()).map(f => ({
    id: String(f.id), mes: f.mes, mesNombre: nombreMes(f.mes), nombre: f.nombre,
    viajes: Number(f.viajes) || 0, conductorId: f.conductor_id ? String(f.conductor_id) : null,
    ...desglose(f.horas_online, f.ocupacion_pct === null ? null : Number(f.ocupacion_pct)),
  }));
  const meses = [...new Set(filas.map(f => f.mes))].sort().reverse().map(m => ({ mes: m, nombre: nombreMes(m) }));
  const ultima = await repo.ultimaImportacion();
  return { filas, meses, ultima };
}

/**
 * LA FICHA DE UNA PERSONA, desde una de sus filas: todos sus meses (los de todas
 * sus cuentas: misma persona = mismo DNI; sin DNI, la misma cuenta) y el total.
 */
async function persona(id) {
  if (!/^\d+$/.test(String(id || ''))) throw new Error('No existe esa fila.');
  const filas = await repo.dePersona(id);
  if (!filas.length) throw new Error('No existe esa fila: ¿se ha vuelto a subir el archivo? Recarga la lista.');
  const meses = filas.map(f => ({
    mes: f.mes, mesNombre: nombreMes(f.mes), cuenta: f.cuenta, nombre: f.nombre, viajes: Number(f.viajes) || 0,
    ...desglose(f.horas_online, f.ocupacion_pct === null ? null : Number(f.ocupacion_pct)),
  }));
  const conHoras = meses.filter(m => m.horas > 0);
  const total = sumar(meses);
  return {
    id: String(id),
    nombre: filas[0].nombre,
    conductorId: filas.find(f => f.conductor_id) ? String(filas.find(f => f.conductor_id).conductor_id) : null,
    cuentas: new Set(filas.map(f => f.cuenta)).size,
    meses, total,
    media: conHoras.length ? r1(total.horas / conHoras.length) : null,
    primero: meses.length ? meses[meses.length - 1].mesNombre : null,
    ultimo: meses.length ? meses[0].mesNombre : null,
  };
}

module.exports = { importar, lista, persona, interpretar, leerCsv, sumar, desglose };
