/**
 * FICHAJE DE TURNO por WhatsApp — "Iniciar turno" / "Terminar turno".
 *
 * Para qué: BOLT solo sabe quién conduce mientras su app está ABIERTA. En cuanto el
 * conductor se pone inactive dejan de existir logs, y justo ahí está el km que
 * persigue la auditoría (/operaciones/auditoria). Con el fichaje sabemos QUIÉN tenía
 * el coche en cada momento, aunque BOLT esté cerrado: la auditoría puede pasar de
 * señalar matrículas a señalar personas.
 *
 * Cómo:
 *   · El turno se apunta en un libro (Google Sheet) con conductor, matrícula y horas.
 *     Esa es la prueba: la atribución se hace por VENTANA TEMPORAL, igual que ya se
 *     hace con los timestamps de BOLT, sin depender de cómo trate Mapon el histórico.
 *   · Además, al abrir turno se ASIGNA el conductor a la unidad en Mapon (y al cerrar
 *     se le quita), para que en su plataforma se vea el nombre en vivo. Al terminar se
 *     comprueba si Mapon atribuyó los trayectos (route/list include=driver_id): así
 *     sabremos de verdad si ese enlace queda SELLADO en el histórico o no.
 *
 * EN PRUEBAS: solo responde a los teléfonos de FICHAJE_TELEFONOS (por defecto, el del
 * responsable). Al resto del bot no le afecta nada.
 */

const mapon = require('./mapon');
const sheets = require('./sheets');

const ID_FICHAJE = process.env.ID_FICHAJE || '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA = 'FICHAJE_TURNOS';
const CAB = ['id', 'telefono', 'nombre', 'matricula', 'unit_id', 'mapon_driver_id',
  'inicio', 'fin', 'km', 'trayectos', 'trayectos_atribuidos', 'estado', 'notas', 'unit_previa'];
const RANGO = `${HOJA}!A:N`;

// Teléfonos autorizados MIENTRAS está en pruebas, con el NOMBRE que se les pone (el
// mismo que se crea/asigna en Mapon: la mayoría de conductores no están dados de alta
// allí, así que el nombre lo decidimos aquí). Formato: '640389649:Claude code,600111222:Otro'.
const PRUEBAS = (process.env.FICHAJE_TELEFONOS || '640389649:Claude code')
  .split(',').map(s => s.trim()).filter(Boolean)
  .reduce((m, par) => { const [t, n] = par.split(':'); m[tel9(t)] = (n || '').trim(); return m; }, {});

// Si alguien olvida cerrar, el turno se cierra solo pasadas estas horas: así no queda
// un coche asignado indefinidamente en Mapon ni un turno abierto eterno en el libro.
const MAX_HORAS_TURNO = Number(process.env.FICHAJE_MAX_HORAS || 14);

const ZONA = 'Europe/Madrid';
const ahoraSeg = () => Math.floor(Date.now() / 1000);
function tel9(t) { const d = String(t == null ? '' : t).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; }
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const horaES = seg => new Intl.DateTimeFormat('es-ES', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date(seg * 1000));
function duracion(seg) {
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** ¿Este teléfono participa en la prueba? */
const esPruebas = telefono => Object.prototype.hasOwnProperty.call(PRUEBAS, tel9(telefono));
/** Nombre con el que saludar (el configurado en la lista de pruebas, si lo hay). */
const nombreDe = telefono => PRUEBAS[tel9(telefono)] || '';

// ── Libro de turnos ───────────────────────────────────────────────────────────

async function leerLibro() {
  await sheets.ensureSheet(ID_FICHAJE, HOJA);
  const filas = await sheets.readSheet(ID_FICHAJE, RANGO);
  if (!filas.length) {
    await sheets.writeSheetRaw(ID_FICHAJE, `${HOJA}!A1`, [CAB]);
    return [];
  }
  return filas.slice(1).map((r, i) => ({
    fila: i + 2,
    id: String(r[0] || ''), telefono: String(r[1] || ''), nombre: String(r[2] || ''),
    matricula: String(r[3] || ''), unitId: String(r[4] || ''), driverId: String(r[5] || ''),
    inicio: Number(r[6]) || 0, fin: Number(r[7]) || 0,
    km: r[8] === '' || r[8] == null ? null : Number(r[8]),
    trayectos: Number(r[9]) || 0, atribuidos: Number(r[10]) || 0,
    estado: String(r[11] || ''), notas: String(r[12] || ''), unitPrevia: String(r[13] || '')
  })).filter(t => t.id);
}

const aFila = t => [t.id, t.telefono, t.nombre, t.matricula, t.unitId, t.driverId,
  t.inicio || '', t.fin || '', t.km == null ? '' : t.km, t.trayectos || '', t.atribuidos || '',
  t.estado, t.notas || '', t.unitPrevia || ''];

async function guardarFila(t) {
  await sheets.writeSheetRaw(ID_FICHAJE, `${HOJA}!A${t.fila}:N${t.fila}`, [aFila(t)]);
}
async function añadirFila(t) {
  await sheets.appendRows(ID_FICHAJE, RANGO, [aFila(t)]);
}

/** Turno abierto de un teléfono (o null). */
const abiertoDe = (libro, telefono) =>
  libro.find(t => t.estado === 'abierto' && tel9(t.telefono) === tel9(telefono)) || null;
/** Turno abierto sobre una matrícula por OTRA persona (o null). */
const abiertoDeCoche = (libro, matricula, telefono) =>
  libro.find(t => t.estado === 'abierto' && normMat(t.matricula) === normMat(matricula)
    && tel9(t.telefono) !== tel9(telefono)) || null;

// ── Conductor en Mapon ────────────────────────────────────────────────────────

/**
 * Devuelve el driver_id de Mapon para el NOMBRE que le pasamos, creándolo si no
 * existe. La identidad la manda NUESTRO nombre, no lo que haya en Mapon:
 *
 *   · La mayoría de conductores NO están dados de alta en Mapon, así que hay que
 *     poder crearlos sobre la marcha con el nombre que decidamos.
 *   · Antes se buscaba primero por TELÉFONO, y eso reutilizaba a un conductor real ya
 *     existente (aparecía su nombre completo en vez del que queríamos) y además le
 *     movía el coche que tuviera puesto. Ya no: se casa por nombre exacto.
 */
async function conductorMapon(nombre, telefono) {
  const nom = String(nombre || '').trim();
  if (!nom) return null;
  let lista = [];
  try { lista = await mapon.listarConductores(); } catch (e) { console.error('⚠️ [FICHAJE] driver/list:', e.message); }
  const clave = nom.toLowerCase();
  const encontrado = lista.find(d => `${d.name || ''} ${d.surname || ''}`.trim().toLowerCase() === clave);
  if (encontrado) return encontrado.id || encontrado.driver_id;

  const partes = nom.split(/\s+/);
  const id = await mapon.crearConductor({
    nombre: partes[0],
    apellidos: partes.slice(1).join(' ') || '-',
    telefono: telefono ? `+34${tel9(telefono)}` : undefined
  });
  console.log(`🆕 [FICHAJE] Conductor creado en Mapon: "${nom}" (id ${id})`);
  return id;
}

// ── Operaciones ───────────────────────────────────────────────────────────────

/**
 * Deshace el enlace en Mapon: si el conductor tenía otro coche antes del turno, se le
 * DEVUELVE; si no tenía ninguno, se le quita. Así un fichaje nunca deja peor la ficha
 * de un conductor real de lo que estaba.
 */
async function soltarEnMapon(t) {
  if (!t.driverId) return;
  if (t.unitPrevia) await mapon.asignarConductor(t.driverId, t.unitPrevia);
  else await mapon.desasignarConductor(t.driverId);
}

/** Cierra los turnos que llevan demasiado tiempo abiertos (olvidos). */
async function cerrarOlvidados(libro) {
  const limite = ahoraSeg() - MAX_HORAS_TURNO * 3600;
  for (const t of libro.filter(x => x.estado === 'abierto' && x.inicio && x.inicio < limite)) {
    try { await soltarEnMapon(t); } catch (e) { /* se cierra igual */ }
    t.fin = t.inicio + MAX_HORAS_TURNO * 3600;
    t.estado = 'auto-cerrado';
    t.notas = `Cerrado solo tras ${MAX_HORAS_TURNO} h sin terminar`;
    await guardarFila(t);
    console.log(`⏱️ [FICHAJE] Turno de ${t.nombre} (${t.matricula}) auto-cerrado`);
  }
}

/** Estado actual: { abierto, turno } */
async function estado(telefono) {
  const libro = await leerLibro();
  await cerrarOlvidados(libro);
  const t = abiertoDe(libro, telefono);
  return { abierto: !!t, turno: t };
}

/**
 * Abre turno: resuelve la matrícula en Mapon, comprueba que nadie más la tenga,
 * asigna el conductor en Mapon y apunta el turno en el libro.
 */
async function iniciar({ telefono, nombre, matricula }) {
  const libro = await leerLibro();
  await cerrarOlvidados(libro);

  const yaAbierto = abiertoDe(libro, telefono);
  if (yaAbierto) {
    return { ok: false, motivo: 'ya-abierto', turno: yaAbierto };
  }
  const unidad = await mapon.unidadPorMatricula(matricula);
  if (!unidad) return { ok: false, motivo: 'sin-matricula' };

  const ocupado = abiertoDeCoche(libro, unidad.matricula, telefono);
  if (ocupado) return { ok: false, motivo: 'coche-ocupado', turno: ocupado };

  // El enlace en Mapon no debe impedir fichar: si falla, el turno se abre igual y se
  // anota — la prueba de quién llevaba el coche es nuestro libro, no Mapon.
  // OJO: driver/update con `unit` MUEVE al conductor de coche. Si ya tenía uno puesto
  // (caso normal si es un conductor real que ya existía en Mapon), se apunta cuál era
  // para devolvérselo al terminar y no dejarle la ficha tocada.
  let driverId = '', notas = '', unitPrevia = '';
  try {
    driverId = await conductorMapon(nombre, telefono);
    if (driverId) {
      const previa = await mapon.unidadDeConductor(driverId).catch(() => null);
      if (previa && String(previa.unitId) !== String(unidad.unitId)) {
        unitPrevia = String(previa.unitId);
        notas = `Tenía asignado ${previa.matricula || previa.unitId}; se le devolverá al terminar`;
      }
      await mapon.asignarConductor(driverId, unidad.unitId);
    }
  } catch (e) {
    notas = `Mapon no enlazó al conductor: ${e.message}`;
    console.error('⚠️ [FICHAJE] asignar:', e.message);
  }

  const turno = {
    id: `${tel9(telefono)}-${ahoraSeg()}`, telefono: tel9(telefono), nombre,
    matricula: unidad.matricula, unitId: String(unidad.unitId), driverId: String(driverId || ''),
    inicio: ahoraSeg(), fin: 0, km: null, trayectos: 0, atribuidos: 0, estado: 'abierto', notas, unitPrevia
  };
  await añadirFila(turno);
  console.log(`🟢 [FICHAJE] ${nombre} inicia turno en ${unidad.matricula} (unit ${unidad.unitId})`);
  return { ok: true, turno, vehiculo: unidad.vehiculo, enlazado: !!driverId };
}

/** Km recorridos por el coche desde que empezó el turno hasta ahora. */
async function kmDelTurno(turno, hasta) {
  try {
    return await mapon.kmEnVentana({ unitId: turno.unitId, fromTs: turno.inicio, tillTs: hasta || ahoraSeg() });
  } catch (e) {
    console.error('⚠️ [FICHAJE] km:', e.message);
    return null;
  }
}

/** Cierra el turno: quita la asignación en Mapon y calcula los km del periodo. */
async function terminar(telefono) {
  const libro = await leerLibro();
  await cerrarOlvidados(libro);
  const t = abiertoDe(libro, telefono);
  if (!t) return { ok: false, motivo: 'sin-turno' };

  const fin = ahoraSeg();
  const km = await kmDelTurno(t, fin);
  try { await soltarEnMapon(t); }
  catch (e) { t.notas = `${t.notas ? t.notas + ' · ' : ''}Mapon no soltó el coche: ${e.message}`; }

  t.fin = fin;
  t.km = km ? km.km : null;
  t.trayectos = km ? km.trayectos : 0;
  t.atribuidos = km ? km.conConductor : 0;
  t.estado = 'cerrado';
  await guardarFila(t);
  console.log(`🔴 [FICHAJE] ${t.nombre} termina turno en ${t.matricula}: ${t.km} km`);
  return { ok: true, turno: t, km };
}

module.exports = {
  esPruebas, nombreDe, estado, iniciar, terminar, kmDelTurno,
  horaES, duracion, MAX_HORAS_TURNO
};
