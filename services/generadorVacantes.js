// ============================================================
// GENERADOR DE VACANTES (correturnos)
// ============================================================
// Arma la semana de un conductor nuevo encadenando huecos de varias matrículas.
// Regla del negocio: los turnos fijos libran 2 días, y en esos 2 días entra el
// correturno. Por eso cada matrícula aporta un BLOQUE = sus días de hueco (2 en
// el caso normal), y se cogen enteros. Una vacante de 6 días = 3 bloques; de 4 =
// 2 bloques. Los bloques deben tener días DISJUNTOS (un conductor no puede estar
// en dos coches el mismo día). Prioriza la misma zona; si no completa, propone la
// zona más cercana (por coordenadas de BASES), y Tráfico decide si la toma.

const { leerTablero, DIAS_SEM } = require('./planificadorV2');

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (la2 - la1) * rad, dLon = (lo2 - lo1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const normZona = z => String(z || '').trim().toLowerCase();

async function cargarCochesBases() {
  const t = await leerTablero();
  const coches = (t.coches || []).filter(c => c.operativo && c.matricula);
  return { coches, bases: t.bases || [] };
}

/** Bloque por matrícula = sus días de hueco de ese turno, con el fijo del coche. */
function bloquesDe(coches, turno) {
  return coches.map(c => {
    const dias = (c.huecos || []).filter(h => h.turno === turno)
      .map(h => h.dia).sort((a, b) => a - b);
    if (!dias.length) return null;
    // El fijo de ese turno es quien libra esos días (a quien cubre el correturno).
    const fijoP = (c.personas || []).find(p => p.rol === 'FIJO' && p.turno === turno && p.id);
    return {
      matricula: c.matricula, zona: c.zona || '(sin zona)', dias,
      fijo: fijoP ? (fijoP.nombre || fijoP.id) : ''
    };
  }).filter(Boolean);
}

/** Devuelve fn(zonaA, zonaB) → km entre sus bases (Infinity si falta alguna). */
function distanciaEntreZonas(bases) {
  const coord = new Map();
  bases.forEach(b => coord.set(normZona(b.nombre), { lat: b.lat, lng: b.lng }));
  return (zA, zB) => {
    const a = coord.get(normZona(zA)), b = coord.get(normZona(zB));
    return (a && b) ? haversine(a.lat, a.lng, b.lat, b.lng) : Infinity;
  };
}

/** Busca una combinación EXACTA (días disjuntos) que sume `objetivo`, empezando
 *  por `inicio`. Prueba los candidatos en el orden dado (misma zona → cercanas),
 *  así prefiere completar en la propia zona. Devuelve el array o null. */
function buscarExacto(inicio, candidatos, objetivo) {
  const usados = new Set(inicio.dias);
  const elegidos = [inicio];
  function rec() {
    if (usados.size === objetivo) return true;
    for (const b of candidatos) {
      if (elegidos.includes(b)) continue;
      if (usados.size + b.dias.length > objetivo) continue;
      if (b.dias.some(d => usados.has(d))) continue;
      b.dias.forEach(d => usados.add(d)); elegidos.push(b);
      if (rec()) return true;
      elegidos.pop(); b.dias.forEach(d => usados.delete(d));
    }
    return false;
  }
  return rec() ? elegidos.slice() : null;
}

/** Relleno voraz cuando no hay combinación exacta: mete bloques disjuntos en
 *  orden de preferencia hasta donde llegue, sin pasarse del objetivo. */
function rellenoParcial(inicio, candidatos, objetivo) {
  const usados = new Set(inicio.dias);
  const elegidos = [inicio];
  for (const b of candidatos) {
    if (usados.size >= objetivo) break;
    if (usados.size + b.dias.length > objetivo) continue;
    if (b.dias.some(d => usados.has(d))) continue;
    b.dias.forEach(d => usados.add(d)); elegidos.push(b);
  }
  return elegidos;
}

/**
 * Genera una propuesta de vacante.
 * @param {{zona, turno, dias, matricula}} opt
 */
async function generarVacante(opt = {}) {
  const zona = String(opt.zona || '').trim();
  const turno = opt.turno === 'Noche' ? 'Noche' : 'Día';
  const objetivo = [2, 4, 6].includes(Number(opt.dias)) ? Number(opt.dias) : 6;
  const matricula = String(opt.matricula || '').trim();
  if (!zona || !matricula) throw new Error('Faltan la zona y la matrícula de partida');

  const { coches, bases } = await cargarCochesBases();
  const bloques = bloquesDe(coches, turno);
  const inicio = bloques.find(b => b.matricula === matricula && b.zona === zona);
  if (!inicio) throw new Error(`La matrícula ${matricula} no tiene huecos de ${turno} en ${zona}`);

  const dist = distanciaEntreZonas(bases);
  // Candidatos ordenados por preferencia: misma zona primero, luego por cercanía.
  const candidatos = bloques.filter(b => b !== inicio).sort((a, b) => {
    const sa = a.zona === zona, sb = b.zona === zona;
    if (sa !== sb) return sa ? -1 : 1;
    if (sa) return a.matricula.localeCompare(b.matricula);
    return dist(zona, a.zona) - dist(zona, b.zona);
  });

  const exacto = buscarExacto(inicio, candidatos, objetivo);
  const elegidos = exacto || rellenoParcial(inicio, candidatos, objetivo);

  // Cada bloque en formato de salida (matrícula · fijo · días · zona/km).
  const aSalida = b => ({
    matricula: b.matricula,
    zona: b.zona,
    fijo: b.fijo,
    sugerido: b.zona !== zona,
    km: b.zona !== zona ? Math.round(dist(zona, b.zona) * 10) / 10 : 0,
    dias: b.dias.map(d => ({ dia: d, nombre: DIAS_SEM[d] }))
  });

  // Pool = matrícula de partida + candidatos en orden de preferencia (misma zona,
  // luego por cercanía). El front lo usa para que Tráfico añada/quite a criterio.
  const pool = [inicio, ...candidatos].slice(0, 60).map(aSalida);

  return {
    zona, turno, objetivo,
    propuesta: elegidos.map(b => b.matricula),   // asignación automática (matrículas)
    pool
  };
}

/** Datos para la interfaz: zonas → matrículas con sus huecos (por turno). */
async function datosGenerador() {
  const { coches } = await cargarCochesBases();
  const zonasMap = new Map();
  coches.forEach(c => {
    const z = c.zona || '(sin zona)';
    const dia = (c.huecos || []).filter(h => h.turno === 'Día').map(h => h.dia);
    const noche = (c.huecos || []).filter(h => h.turno === 'Noche').map(h => h.dia);
    if (!dia.length && !noche.length) return;
    if (!zonasMap.has(z)) zonasMap.set(z, []);
    zonasMap.get(z).push({ matricula: c.matricula, dia, noche });
  });
  const zonas = [...zonasMap.entries()]
    .map(([zona, matriculas]) => ({ zona, matriculas: matriculas.sort((a, b) => a.matricula.localeCompare(b.matricula)) }))
    .sort((a, b) => a.zona.localeCompare(b.zona, 'es'));
  return { zonas, dias: DIAS_SEM };
}

module.exports = { generarVacante, datosGenerador };
