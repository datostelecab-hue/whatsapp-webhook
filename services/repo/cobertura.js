// ============================================================
// COBERTURA — sobre PostgreSQL (sustituye a la lectura de hojas)
// ============================================================
// Arma la semana de cobertura a partir del TABLERO del planificador (repo/
// planificador.tablero), que es la única verdad: quién cubre cada coche, cada día
// y cada turno. Devuelve EXACTAMENTE la misma forma que devolvía la versión de
// hoja, para que la pantalla no cambie ni una línea:
//
//   { semanaInfo, cobertura[], relevos[], porConductor[], coches[], ausentesEnPlaza[], resumen }
//
//   · cobertura[]  → una entrada por (día × turno): quién sale y QUÉ COCHES NO SALEN,
//                    cada uno con su motivo (descansa, titular ausente, plaza vacía,
//                    conflicto, vehículo fuera de servicio).
//   · relevos[]    → el paso del coche de un conductor al siguiente, en orden.
//   · porConductor → la semana de cada persona: qué coche lleva, de quién lo recibe
//                    y a quién se lo entrega, con teléfono para llamar/escribir.

const plani = require('./planificador');
const db = require('../db');

const DIAS_SEM = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const TURNOS = ['Día', 'Noche'];
const TZ = 'Europe/Madrid';

// Estado del vehículo → por qué no sale. El código va en la base; esto es el texto.
const ESTADO_VEH = {
  T: 'en taller', S: 'siniestrado', R: 'reservado', B: 'de baja', X: 'en taller',
};

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Suma días a un 'YYYY-MM-DD' sin que el cambio de hora lo desplace. */
function sumarDias(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
const corto = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/**
 * La semana de cobertura.
 * @param {number} offsetSemana 0 = esta semana, 1 = la que viene…
 */
async function datos({ offsetSemana = 0 } = {}) {
  const base = sumarDias(hoyMadrid(), Number(offsetSemana || 0) * 7);
  const [tab, contac] = await Promise.all([
    plani.tablero({ dia: base }),
    plani.contactos().catch(() => new Map()),
  ]);
  return construir(tab, contac, offsetSemana);
}

/**
 * PURA: del tablero (+ contactos) a la forma que pinta la pantalla. Separada de
 * `datos` a propósito, para poder probarla sin base de datos.
 */
function construir(tab, contac, offsetSemana = 0) {
  const fechas = (tab && tab.fechas) || [];
  const gente = new Map((tab.conductores || []).map(c => [String(c.id), c]));
  const telDe = id => {
    const c = contac.get(String(id));
    return (c && c.telefono) || '';
  };

  // ── Los coches, con su semana en 14 tramos (Lun-Día, Lun-Noche, Mar-Día…) ──
  const coches = (tab.coches || [])
    .filter(c => c.matricula)
    .map(c => {
      const semana = [];
      for (let d = 0; d < 7; d++) {
        for (let t = 0; t < 2; t++) {
          const celda = (c.semana || [])[d * 2 + t] || {};
          semana.push({
            dia: d, diaNombre: DIAS_SEM[d], turno: TURNOS[t], fecha: fechas[d] || '',
            id: celda.id ? String(celda.id) : '',
            nombre: celda.nombre || '',
            conflicto: !!celda.conflicto,
          });
        }
      }
      return {
        matricula: c.matricula, zona: c.zona || '', cuadrante: c.cuadrante || '',
        operativo: c.operativo !== false, estadoVeh: c.estadoVeh || '',
        descanso: c.descanso || [], personas: c.personas || [],
        semana,
        relevos: relevosDe(c.matricula, semana),
        numLibres: semana.filter(t => !t.id).length,
        hayError: semana.some(t => t.conflicto),
      };
    });

  const relevos = [];
  coches.forEach(c => c.relevos.forEach(r => relevos.push(r)));

  return {
    semanaInfo: {
      // `inicio`/`fin`/`esActual` son los nombres que pinta la pantalla.
      inicio: fechas[0] || '', fin: fechas[6] || '',
      esActual: Number(offsetSemana || 0) === 0,
      desde: fechas[0] || '', hasta: fechas[6] || '',
      etiqueta: fechas.length ? `${corto(fechas[0])} – ${corto(fechas[6])}` : '',
      offsetSemana: Number(offsetSemana || 0),
      dia: tab.dia,
    },
    cobertura: coberturaPorTurno(coches, gente, fechas),
    ausentesEnPlaza: ausentesEnPlaza(coches, gente),
    relevos,
    porConductor: porConductor(coches, gente, telDe),
    // La pantalla pinta los operativos; los demás salen igual en `cobertura` con
    // su motivo ("en taller"), que es justo lo que hay que ver.
    coches: coches.filter(c => c.operativo).map(c => ({
      matricula: c.matricula, zona: c.zona, semana: c.semana, relevos: c.relevos,
      numLibres: c.numLibres, hayError: c.hayError,
    })),
    resumen: resumenDe(coches, relevos, tab),
  };
}

// ── Relevos: el coche pasa de un conductor al siguiente ──────────────────────
// Se recorre la semana del coche en orden y, cada vez que cambia el ocupante
// entre un tramo con gente y el SIGUIENTE con gente, eso es un relevo. `directo`
// dice si los dos tramos van pegados (sin ningún hueco en medio): si no lo son,
// el coche se queda parado entre medias y la entrega no es mano a mano.
function relevosDe(matricula, semana) {
  const ocupados = [];
  semana.forEach((t, i) => { if (t.id) ocupados.push({ ...t, i }); });
  const out = [];
  for (let k = 0; k + 1 < ocupados.length; k++) {
    const a = ocupados[k], b = ocupados[k + 1];
    if (a.id === b.id) continue;               // sigue el mismo: no hay relevo
    out.push({
      matricula,
      entrega: { id: a.id, nombre: a.nombre, dia: a.diaNombre, turno: a.turno },
      recibe: { id: b.id, nombre: b.nombre, dia: b.diaNombre, turno: b.turno },
      directo: b.i - a.i === 1,
    });
  }
  return out;
}

// ── Por qué un coche NO sale en un tramo ─────────────────────────────────────
function motivoDe(coche, d, t, tramo, gente, fecha) {
  if (!coche.operativo) {
    return { tipo: 'vehiculo', motivo: 'Vehículo ' + (ESTADO_VEH[coche.estadoVeh] || 'fuera de servicio') };
  }
  if (tramo.conflicto) return { tipo: 'conflicto', motivo: 'Dos conductores a la vez' };

  // El titular de la plaza de ese turno (slot 0 = fijo día, 1 = fijo noche).
  const p = (coche.personas || [])[t] || {};
  const titular = p.id ? gente.get(String(p.id)) : null;

  if (titular && titular.ausente) {
    const hasta = titular.vuelveEl ? ` hasta ${titular.vuelveEl}` : '';
    return { tipo: 'ausente', motivo: `${titular.nombre}: ${titular.estado || 'ausente'}${hasta}` };
  }
  if (titular && titular.alta && fecha && titular.alta > fecha) {
    return { tipo: 'titular-pre-alta', motivo: `${titular.nombre} entra el ${titular.alta}` };
  }
  // El coche descansa ese día y no hay correturnos que lo cubra.
  if ((coche.descanso || []).includes(d + 1)) {
    return { tipo: 'descanso', motivo: 'Descansa y no hay correturnos' };
  }
  if (!p.id) return { tipo: 'sin_conductor', motivo: 'Plaza sin conductor' };
  return { tipo: 'sin_conductor', motivo: 'Sin cubrir' };
}

/** Una entrada por (día × turno): quién sale y qué coches no salen, con motivo. */
function coberturaPorTurno(coches, gente, fechas) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    for (let t = 0; t < 2; t++) {
      const enCalle = [];
      const sinConductor = [];
      coches.forEach(c => {
        const tramo = c.semana[d * 2 + t];
        if (tramo && tramo.id && c.operativo && !tramo.conflicto) {
          enCalle.push({ matricula: c.matricula, conductor: tramo.nombre, zona: c.zona });
          return;
        }
        const m = motivoDe(c, d, t, tramo || {}, gente, fechas[d] || '');
        sinConductor.push({ matricula: c.matricula, zona: c.zona, ...m });
      });
      out.push({
        dia: d, diaNombre: DIAS_SEM[d], turno: TURNOS[t], fecha: fechas[d] || '',
        enCalle, sinConductor,
      });
    }
  }
  return out;
}

/** Titulares de vacaciones/baja que SIGUEN en su plaza: su coche no sale por eso. */
function ausentesEnPlaza(coches, gente) {
  const out = [];
  coches.forEach(coche => {
    [0, 1].forEach(slot => {
      const p = (coche.personas || [])[slot];
      if (!p || !p.id) return;
      const c = gente.get(String(p.id));
      if (!c || !c.ausente) return;
      // Los días de la semana en los que ese tramo se queda sin nadie por su culpa.
      const dias = [];
      for (let d = 0; d < 7; d++) {
        const tr = coche.semana[d * 2 + slot];
        if (!tr.id) dias.push(DIAS_SEM[d].slice(0, 3));
      }
      out.push({
        matricula: coche.matricula, zona: coche.zona,
        plaza: slot === 0 ? 'Fijo día' : 'Fijo noche',
        nombre: c.nombre, estado: c.estado || 'Ausente',
        reincorporacion: c.vuelveEl || '',
        dias,
      });
    });
  });
  return out.sort((a, b) => a.matricula.localeCompare(b.matricula));
}

/**
 * La semana de CADA conductor: qué día trabaja, en qué coche, de quién lo recibe
 * y a quién se lo entrega. Es lo que se le manda por WhatsApp.
 */
function porConductor(coches, gente, telDe) {
  // id → [{ dia, diaNombre, turno, matricula }]
  const slots = new Map();
  coches.forEach(coche => coche.semana.forEach(tr => {
    if (!tr.id) return;
    if (!slots.has(tr.id)) slots.set(tr.id, []);
    slots.get(tr.id).push({ dia: tr.dia, diaNombre: tr.diaNombre, turno: tr.turno, matricula: coche.matricula });
  }));

  const relevos = [];
  coches.forEach(c => c.relevos.forEach(r => relevos.push(r)));
  const buscaRecibe = (id, s) => relevos.find(r =>
    r.matricula === s.matricula && r.recibe.id === id && r.recibe.dia === s.diaNombre && r.recibe.turno === s.turno);
  const buscaEntrega = (id, s) => relevos.find(r =>
    r.matricula === s.matricula && r.entrega.id === id && r.entrega.dia === s.diaNombre && r.entrega.turno === s.turno);
  const ordTurno = t => { const i = TURNOS.indexOf(t); return i < 0 ? 99 : i; };

  const salida = [];
  for (const [id, mis] of slots.entries()) {
    const persona = gente.get(String(id));
    const dias = DIAS_SEM.map((diaNombre, d) => {
      const delDia = mis.filter(s => s.dia === d).sort((a, b) => ordTurno(a.turno) - ordTurno(b.turno));
      if (!delDia.length) return { diaNombre, trabaja: false };
      const primero = delDia[0], ultimo = delDia[delDia.length - 1];
      const rec = buscaRecibe(id, primero);
      const ent = buscaEntrega(id, ultimo);
      return {
        diaNombre, trabaja: true,
        turno: [...new Set(delDia.map(s => s.turno))].join(' y '),
        matricula: [...new Set(delDia.map(s => s.matricula))].join(' + '),
        recibeDe: rec ? { nombre: rec.entrega.nombre, telefono: telDe(rec.entrega.id), directo: !!rec.directo } : null,
        entregaA: ent ? { nombre: ent.recibe.nombre, telefono: telDe(ent.recibe.id), directo: !!ent.directo } : null,
      };
    });
    salida.push({
      id: String(id),
      nombre: (persona && persona.nombre) || String(id),
      telefono: telDe(id),
      dias,
    });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function resumenDe(coches, relevos, tab) {
  const operativos = coches.filter(c => c.operativo);
  const tramos = operativos.length * 14;
  const cubiertos = operativos.reduce((n, c) => n + c.semana.filter(t => t.id).length, 0);
  return {
    coches: operativos.length,
    cochesFueraDeServicio: coches.length - operativos.length,
    relevos: relevos.length,
    tramos,
    cubiertos,
    sinCubrir: tramos - cubiertos,
    // Lo que ya calcula el tablero, para no tener dos cuentas distintas.
    diasSinCubrirDia: (tab.resumen || {}).diasSinCubrirDia || 0,
    diasSinCubrirNoche: (tab.resumen || {}).diasSinCubrirNoche || 0,
    ctQueFaltanDia: (tab.resumen || {}).ctQueFaltanDia || 0,
    ctQueFaltanNoche: (tab.resumen || {}).ctQueFaltanNoche || 0,
  };
}

/**
 * De un TELÉFONO a la persona. En PostgreSQL el teléfono IDENTIFICA: el sufijo de 9
 * dígitos es único entre los vigentes (uq_tel_sufijo_vigente). Esto sustituye al
 * cruce por nombre, que fallaba con una tilde, con los apellidos en otro orden o si
 * el teléfono no estaba en el padrón de BOLT.
 */
async function conductorPorTelefono(phone) {
  const t = String(phone || '').replace(/\D/g, '');
  if (t.length < 9) return null;
  const r = await db.consulta(
    `SELECT t.conductor_id,
            btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre,
            c.empleo_vigente AS activo
       FROM conductor_telefono t
       JOIN conductor c ON c.id = t.conductor_id
      WHERE t.vigente_hasta IS NULL AND t.sufijo9 = right($1, 9)
      LIMIT 1`, [t]);
  const x = r.rows[0];
  return x
    ? { conductorId: String(x.conductor_id), nombre: x.nombre || '', activo: x.activo !== false }
    : null;
}

module.exports = {
  datos, construir, conductorPorTelefono, DIAS_SEM, TURNOS,
  // Expuestas para poder probarlas sueltas, sin base de datos.
  relevosDe, coberturaPorTurno, ausentesEnPlaza, porConductor, sumarDias,
};
