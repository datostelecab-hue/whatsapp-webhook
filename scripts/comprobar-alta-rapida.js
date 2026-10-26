// ============================================================
// EL ALTA RÁPIDA DE LA ETT, CON SU JORNADA Y SU CONTRATO
// ============================================================
// 14/10/2026, Camilo: «Necesito en alta rápida poner la jornada (día o noche) y
// el contrato (40, 32, 20 horas), que lo de la jornada se asigne automática».
//
// Hasta ese día el alta rápida no preguntaba ninguna de las dos: el contrato se
// abría sin horas y el turno se lo ponía el planificador al colocarlo en un
// coche. Ahora las dos son obligatorias, la jornada va a la ficha desde el día
// del alta y, con vacante, sale de ella si no se marca (ett.service.jornadaDelAlta).
//
//   node scripts/comprobar-alta-rapida.js
//
// No toca la base: Conductores, la candidatura, la vacante y la incorporación se
// sustituyen en memoria.

const conductores = require('../modules/Conductores/conductores.service');
const conRepo = require('../modules/Conductores/conductores.repo');
const altaRepo = require('../services/repo/alta');
const cand = require('../modules/Seleccion/candidaturas.service');
const candRepo = require('../modules/Seleccion/candidaturas.repo');
const vacantes = require('../modules/Seleccion/vacantes.service');
const incorporaciones = require('../modules/Seleccion/incorporaciones.repo');
const tablero = require('../modules/Planificacion/tablero.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// Las de verdad, antes de sustituirlas: la segunda y la tercera parte las prueban.
const realizarAltaDeVerdad = conductores.realizarAlta;
const abrirContratadaDeVerdad = cand.abrirContratada;

// ── Lo de fuera, en memoria ──────────────────────────────────────────────────
const hechos = [];
const VACANTES = {
  'V-N40': { codigo: 'V-N40', turnoId: 2, turno: 'Noche', jornadaHoras: 40 },
  'V-D32': { codigo: 'V-D32', turnoId: 1, turno: 'Día', jornadaHoras: 32 },
  'V-TT':  { codigo: 'V-TT', turnoId: 3, turno: 'TodoTurno', jornadaHoras: null },
};
cand.catalogos = async () => ({ turnos: [
  { id: 1, codigo: 'dia', etiqueta: 'Día', asignable: true },
  { id: 2, codigo: 'noche', etiqueta: 'Noche', asignable: true },
  { id: 3, codigo: 'todoturno', etiqueta: 'TodoTurno', asignable: false },
] });
vacantes.ficha = async id => {
  if (!VACANTES[id]) throw new Error('No existe esa vacante');
  return { ...VACANTES[id] };
};
conductores.realizarAlta = async d => { hechos.push(['alta', d]); return { id: 500, avisos: [], boltEnlazada: true }; };
cand.abrirContratada = async (id, d) => { hechos.push(['candidatura', d]); return { id: 85, yaExistia: false }; };
incorporaciones.crear = async d => { hechos.push(['incorporacion', d.vacanteId || null]); return { id: 9, vacanteId: d.vacanteId || null }; };
tablero.colocarIncorporacion = async () => ({ plazas: 1, desde: '2026-10-20' });

const ett = require('../modules/Seleccion/ett.service');
const quien = { usuarioId: 7 };
const BASE = { nombre: 'Prueba Alta', telefono: '600111222', alta: '2026-10-20' };
async function intenta(datos) {
  hechos.length = 0;
  try { return await ett.altaRapida({ ...BASE, ...datos }, quien); }
  catch (e) { return 'error: ' + e.message; }
}
const del = tipo => (hechos.find(h => h[0] === tipo) || [])[1];

(async () => {
  // ── 1. Lo que hay que elegir ───────────────────────────────────────────────
  igual('Sin jornada ni vacante: no se da el alta', await intenta({ jornadaHoras: '40' }),
    'error: Elige la jornada: día o noche.');
  igual('…y no se ha creado nada', hechos, []);
  igual('Sin contrato: no se da el alta', await intenta({ turnoId: '2' }),
    'error: Elige el contrato: 40, 32, 20 horas.');
  igual('Un contrato que no es de los tres (30 h): tampoco', await intenta({ turnoId: '2', jornadaHoras: '30' }),
    'error: Elige el contrato: 40, 32, 20 horas.');
  igual('TodoTurno no se elige al contratar', await intenta({ turnoId: '3', jornadaHoras: '40' }),
    'error: Esa jornada no vale: tiene que ser de día o de noche.');
  igual('La lista de contratos es la que pidió Camilo', ett.CONTRATOS, [40, 32, 20]);

  // ── 2. Lo que se guarda ────────────────────────────────────────────────────
  let r = await intenta({ turnoId: '2', jornadaHoras: '32' });
  igual('Noche y 32 h: el alta lleva el turno y las horas',
    [del('alta').turnoId, del('alta').jornadaHoras, del('alta').tipo, del('alta').alta], [2, 32, 'ett', '2026-10-20']);
  igual('…la candidatura también', [del('candidatura').turnoId, del('candidatura').jornadaHoras], [2, 32]);
  igual('…y la pantalla lo puede decir', r.jornada, { turno: 'Noche', horas: 32, deLaVacante: false });
  igual('…sin avisos', r.avisos, []);
  r = await intenta({ turnoId: '1', jornadaHoras: '20' });
  igual('Día y 20 h', [del('alta').turnoId, del('alta').jornadaHoras], [1, 20]);

  // ── 3. Con vacante: la jornada sale sola ───────────────────────────────────
  r = await intenta({ jornadaHoras: '40', vacanteId: 'V-N40' });
  igual('Vacante de noche y jornada sin marcar: se pone la de la vacante', del('alta').turnoId, 2);
  igual('…y se dice que es la de la vacante', r.jornada, { turno: 'Noche', horas: 40, deLaVacante: true });
  igual('…y la incorporación va a esa vacante', del('incorporacion'), 'V-N40');
  igual('Vacante de noche y jornada de día: no se da el alta',
    await intenta({ turnoId: '1', jornadaHoras: '40', vacanteId: 'V-N40' }),
    'error: La vacante V-N40 es de noche y has elegido día. Cambia la jornada o elige otra vacante.');
  igual('…y no se ha creado nada', hechos, []);
  r = await intenta({ turnoId: '2', jornadaHoras: '20', vacanteId: 'V-N40' });
  igual('Vacante de 40 h con contrato de 20: se da el alta y se avisa',
    [del('alta').jornadaHoras, r.avisos], [20, ['La vacante V-N40 es de 40 h y el contrato queda de 20 h.']]);
  r = await intenta({ turnoId: '1', jornadaHoras: '32', vacanteId: 'V-D32' });
  igual('Vacante de día, 32 h, jornada de día: sin avisos', [del('alta').turnoId, r.avisos], [1, []]);
  igual('Vacante sin un solo turno y jornada sin marcar: hay que elegirla',
    await intenta({ jornadaHoras: '40', vacanteId: 'V-TT' }),
    'error: La vacante V-TT no es de un solo turno: elige la jornada, día o noche.');
  r = await intenta({ turnoId: '2', jornadaHoras: '40', vacanteId: 'V-TT' });
  igual('…y marcándola, se da el alta con la elegida', del('alta').turnoId, 2);
  igual('Una vacante que no existe: no se da el alta',
    await intenta({ turnoId: '2', jornadaHoras: '40', vacanteId: 'V-NO' }), 'error: No existe esa vacante');
  igual('…y no se ha creado nada', hechos, []);

  // ── 3b. La dirección exacta (15/10/2026) ──────────────────────────────────
  // Sin base: lo que cabe en cada casilla se finge, con la regla de verdad.
  const largos = require('../services/repo/largos');
  largos.comprobar = async (tabla, valores, etiquetaDe) => {
    const malos = largos.sobran(valores, new Map([['piso', 10], ['via_nombre', 80]]));
    if (malos.length) throw new Error(largos.mensaje(malos, etiquetaDe));
  };
  const DIR = ['via_tipo', 'via_nombre', 'via_numero', 'escalera', 'piso', 'puerta', 'codigo_postal', 'localidad', 'provincia'];
  r = await intenta({ turnoId: '1', jornadaHoras: '40', via_tipo: 'Calle', via_nombre: ' Mayor ', via_numero: '12',
    escalera: '', piso: '3', puerta: 'B', codigo_postal: '28013', localidad: 'Madrid', provincia: 'Madrid' });
  igual('La dirección va a la ficha, sin espacios y sin las casillas vacías',
    DIR.map(k => del('alta')[k] === undefined ? '-' : del('alta')[k]),
    ['Calle', 'Mayor', '12', '-', '3', 'B', '28013', 'Madrid', 'Madrid']);
  igual('Un piso que no cabe: no se da el alta',
    String(await intenta({ turnoId: '1', jornadaHoras: '40', piso: 'tercero izquierda interior' })).startsWith('error: '), true);
  igual('…y no se ha creado nada', hechos, []);
  await intenta({ turnoId: '1', jornadaHoras: '40' });
  igual('Sin dirección: el alta sale igual', [del('alta').alta, del('alta').via_nombre === undefined], ['2026-10-20', true]);

  // ── 4. Conductores: el turno llega también a quien vuelve ──────────────────
  conductores.realizarAlta = realizarAltaDeVerdad;
  let situacion;
  altaRepo.porTelefono = async () => situacion;
  conRepo.crear = async d => { hechos.push(['crear', d.turnoId]); return { id: 501 }; };
  conRepo.actualizar = async () => {};
  conRepo.darDeAlta = async () => { hechos.push(['darDeAlta']); return 1; };
  conRepo.guardarTelefono = async () => {};
  conRepo.enlazarBolt = async () => {};
  let turnoFalla = false;
  conRepo.cambiarTurno = async (id, t) => {
    if (turnoFalla) throw new Error('se solapa con otro turno');
    hechos.push(['turno', id, t.turnoId, t.desde]);
  };
  const ALTA = { telefono: '600111222', nombre: 'Prueba', tipo: 'ett', ettNombre: 'GiGroup',
                 alta: '2026-10-20', jornadaHoras: 32, turnoId: 2 };

  situacion = { caso: 'nuevo', ficha: null, bolt: null, avisos: [] };
  hechos.length = 0;
  await conductores.realizarAlta(ALTA, quien);
  igual('Alta nueva: el turno va con la ficha que se crea', hechos, [['crear', 2]]);

  situacion = { caso: 'restaurar', ficha: { id: 77, telefonoVigente: true }, bolt: null, avisos: [] };
  hechos.length = 0;
  let a = await conductores.realizarAlta(ALTA, quien);
  igual('Vuelve alguien que ya estuvo: se le pone el turno desde el día del alta',
    hechos, [['darDeAlta'], ['turno', 77, 2, '2026-10-20']]);
  // Desde el 26/10/2026 toda alta lleva el aviso de la inducción del bloqueo de
  // motor: entra con el bloqueo encendido (conductores.repo).
  igual('…sin más aviso que el de la inducción del bloqueo de motor', a.avisos, [conductores.AVISO_INDUCCION]);
  igual('…y ese aviso dice qué hacer: la inducción o, por lo menos, el vídeo',
    /bloqueo de motor encendido/.test(conductores.AVISO_INDUCCION) && /inducción/.test(conductores.AVISO_INDUCCION)
      && /El WhatsApp del coche/.test(conductores.AVISO_INDUCCION), true);

  turnoFalla = true;
  hechos.length = 0;
  a = await conductores.realizarAlta(ALTA, quien);
  igual('Si el turno no se puede poner, el alta queda hecha y se avisa (y la inducción, después)',
    [a.id, a.avisos.length, /no se le pudo poner el turno/.test(a.avisos[0] || ''), a.avisos[1] === conductores.AVISO_INDUCCION],
    [77, 2, true, true]);
  turnoFalla = false;

  hechos.length = 0;
  await conductores.realizarAlta({ ...ALTA, turnoId: undefined }, quien);
  igual('Sin turno, a quien vuelve no se le toca', hechos, [['darDeAlta']]);

  // ── 5. La candidatura que ya tenía se queda con lo contratado ──────────────
  candRepo.vivaDe = async () => ({ id: 85, inicio_previsto: '2026-10-20' });
  candRepo.adelantarAListo = async () => true;
  candRepo.conductorDe = async () => ({ conductor_id: 500 });
  candRepo.pactado = async () => ({});
  candRepo.guardarProceso = async (id, d) => { hechos.push(['proceso', d]); };
  hechos.length = 0;
  await abrirContratadaDeVerdad(500, { alta: '2026-10-20', jornadaHoras: 32, turnoId: 2 }, quien);
  igual('Ya tenía candidatura: se le escriben la jornada y el turno del alta',
    hechos, [['proceso', { jornada_horas: 32, turno_id: 2 }]]);
  hechos.length = 0;
  await abrirContratadaDeVerdad(500, { alta: '2026-10-20' }, quien);
  igual('…y si no vienen (alta desde la ficha), no se toca nada', hechos, []);

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
