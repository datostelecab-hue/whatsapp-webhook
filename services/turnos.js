const { readSheet } = require('./sheets');

const SPREADSHEET_ID = '1Mx8RDwsrnVszd0bRJwz_hxQtnxfM8uVTqwiGYf7mQ04';

// Configuración de TurnosDB
const HOJA_TURNOS = 'TurnosDB';
const COL_NOMBRE_TURNOS = 3;  // Columna D (índice 3)
const COL_TURNO_TURNOS = 10;  // Columna K (índice 10)

// Configuración de PostMortem
const HOJA_POSTMORTEM = 'PostMortem';
const COL_NOMBRE_POSTMORTEM = 3;  // Columna D (índice 3)
const COL_TURNO_POSTMORTEM = 10;  // Columna K (índice 10)

function normalizarNombre(nombreRaw) {
  if (!nombreRaw) return '';
  const nombre = nombreRaw.toString().trim();
  const partes = nombre.split(/\s+/);
  if (partes.length < 2) return nombre;

  const primeraMayuscula = partes[0] === partes[0].toUpperCase() && partes[0].length > 1;
  if (primeraMayuscula) {
    const apellidos = [];
    const nombres = [];
    let encontradoNombre = false;

    for (let i = 0; i < partes.length; i++) {
      const esMayuscula = partes[i] === partes[i].toUpperCase() && partes[i].length > 1;
      if (!encontradoNombre && esMayuscula && i < partes.length - 1) {
        apellidos.push(partes[i].charAt(0) + partes[i].slice(1).toLowerCase());
      } else {
        encontradoNombre = true;
        nombres.push(partes[i].charAt(0) + partes[i].slice(1).toLowerCase());
      }
    }

    if (nombres.length > 0 && apellidos.length > 0) {
      return [...nombres, ...apellidos].join(' ');
    }
  }
  return nombre;
}

async function leerTurnos() {
  try {
    const data = await readSheet(SPREADSHEET_ID, `${HOJA_TURNOS}!A:Z`);
    const turnos = {};

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const nombreCompleto = row[COL_NOMBRE_TURNOS]?.trim() || '';
      if (!nombreCompleto) continue;

      const turnoRaw = (row[COL_TURNO_TURNOS] || '').toLowerCase().trim();
      const turno = !turnoRaw ? '?' : turnoRaw === 'noche' ? 'noche' : turnoRaw === 'día' || turnoRaw === 'dia' ? 'dia' : '?';

      turnos[nombreCompleto.toLowerCase()] = { turno };
    }

    console.log(`📋 Turnos cargados: ${Object.keys(turnos).length}`);
    return turnos;
  } catch (error) {
    console.error('Error leyendo turnos:', error.message);
    return {};
  }
}

async function leerPostMortem() {
  try {
    const data = await readSheet(SPREADSHEET_ID, `${HOJA_POSTMORTEM}!A:Z`);
    const nombres = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const nombreRaw = (row[COL_NOMBRE_POSTMORTEM] || '').toString().trim();
      if (!nombreRaw || nombreRaw === 'TRUE' || nombreRaw === 'FALSE' || nombreRaw === '') continue;

      const nombre = normalizarNombre(nombreRaw);
      const turnoRaw = (row[COL_TURNO_POSTMORTEM] || '').toString().trim().toLowerCase();
      const turno = turnoRaw === 'noche' ? 'noche' : turnoRaw === 'día' || turnoRaw === 'dia' ? 'dia' : '?';

      nombres.push({ nombre, turno });
    }

    console.log(`⚰️ PostMortem cargados: ${nombres.length}`);
    return nombres;
  } catch (error) {
    console.error('Error leyendo PostMortem:', error.message);
    return [];
  }
}

function buscarEnDiccionario(nombreBolt, diccionario) {
  const nombreLower = normalizarNombre(nombreBolt).toLowerCase();
  if (diccionario[nombreLower]) return diccionario[nombreLower];

  const partesBolt = nombreLower.split(' ').filter(p => p.length > 2);

  for (const [key, value] of Object.entries(diccionario)) {
    const partesKey = key.split(' ').filter(p => p.length > 2);
    let coincidencias = 0;
    for (const parte of partesBolt) {
      if (partesKey.some(pk => pk === parte || pk.includes(parte) || parte.includes(pk))) {
        coincidencias++;
      }
    }
    if (coincidencias >= Math.max(2, partesBolt.length * 0.75)) {
      return value;
    }
  }
  return null;
}

module.exports = { SPREADSHEET_ID, normalizarNombre, leerTurnos, leerPostMortem, buscarEnDiccionario };