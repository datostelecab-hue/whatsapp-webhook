// ============================================================
// CICLO DEL CORTE DE MOTOR, sin tocar un solo coche
// ============================================================
//   node scripts/probar-corte-motor.js
//
// Mapon y la base de mentira. Comprueba lo que no se puede comprobar con un
// coche real sin salir a la calle: que la secuencia entera hace lo que dice,
// incluidos los casos que no se pueden provocar a voluntad — el conductor
// pulsando "Terminar turno" mientras conduce, el compañero que todavía no
// ficha, el relevo, y el repaso recogiendo lo que quedó suelto.
//
// No toca nada real: ni Mapon, ni la base, ni WhatsApp.
//
// Reescrita el 24/09/2026: el fichaje se enciende persona a persona (db/148) y
// la versión anterior aún usaba la lista de teléfonos. Además esperaba bloquear
// con el contacto puesto, que es justo lo que la regla de oro prohíbe desde el
// 16/09: llevaba una semana fallando sin que nadie la pasara.
//
// Al día el 29/09/2026: todo conductor de alta abre turno (el interruptor solo
// dice si se le BLOQUEA el motor al terminar) y quien escribe la matrícula de un
// coche que tiene otro SE LO QUEDA; si al otro se le bloquearía, con el coche
// parado y apagado.
//
// 30/09/2026: NO HAY REPASO. Solo bloquea el conductor al terminar; el cierre
// automático no corta, y el ciclo de cada coche lo cuenta el módulo «Ciclo de
// bloqueo de motor» (modules/BloqueoMotor), que también se prueba aquí.
// Y un coche de OTRA SEDE no se toca nunca (services/otraSede.js), y
// el coche de mentira deja de llamarse 1888LTJ, que es un coche real de
// Barcelona: con esa matrícula de ejemplo empezó el lío.

const path = require('path');
const RAIZ = path.join(__dirname, '..');

process.env.FICHAJE_BLOQUEO_MOTOR = '1';
process.env.FICHAJE_MATRICULAS = '';

const LIBRE = 0, BLOQ = 1;

// ── Los coches de mentira ──────────────────────────────────────────────────
// Se toquetean desde las pruebas para provocar cada caso.
const coches = {
  77: { unitId: 77, matricula: '1111AAA', rele: LIBRE, enMarcha: false, ignicion: false, segParado: 3600 },
  78: { unitId: 78, matricula: '2222BBB', rele: LIBRE, enMarcha: false, ignicion: false, segParado: 3600 },
  80: { unitId: 80, matricula: '3333CCC', rele: LIBRE, enMarcha: false, ignicion: false, segParado: 3600 },
  // Un coche SIN relé de corte (como el de Deisy el 28/09).
  81: { unitId: 81, matricula: '4444DDD', rele: LIBRE, enMarcha: false, ignicion: false, segParado: 3600, sinRele: true },
  // Un coche que NADIE ha fichado: el repaso no debe tocarlo jamás.
  99: { unitId: 99, matricula: '0000AAA', rele: LIBRE, enMarcha: false, ignicion: false, segParado: 3600 },
  // Un coche de BARCELONA: no se toca pase lo que pase en el libro.
  88: { unitId: 88, matricula: '5555BCN', rele: LIBRE, enMarcha: false, ignicion: false, segParado: 3600 },
};
const porMat = m => Object.values(coches).find(c => c.matricula === String(m).toUpperCase().replace(/[^A-Z0-9]/g, ''));
const ordenes = [];               // qué se le ha mandado de verdad a los coches

const falsoMapon = {
  unidadPorMatricula: async m => {
    const c = porMat(m);
    return c ? { unitId: c.unitId, matricula: c.matricula, vehiculo: 'Toyota Corolla' } : null;
  },
  listarConductores: async () => [],
  crearConductor: async () => 991,
  unidadDeConductor: async () => null,
  asignarConductor: async () => true,
  desasignarConductor: async () => true,
  kmEnVentana: async () => ({ km: 42, trayectos: 3, conConductor: 3 }),
  releDeCorte: info => ((info && info.reles) || []).find(r => r.tipo === 'engine_block') || null,
  relesDeUnidad: async unitId => {
    const c = coches[unitId];
    return {
      unitId, matricula: c.matricula, estado: c.enMarcha ? 'driving' : 'standing',
      enMarcha: c.enMarcha, velocidad: c.enMarcha ? 40 : 0, ignicion: c.ignicion,
      segParado: c.segParado, segSinSenal: 60,
      reles: c.sinRele ? [] : [{ relay_id: 1, tipo: 'engine_block', titulo: 'Bloqueo Motor', estado: c.rele, habilitado: 1 }],
    };
  },
  cambiarReleConfirmado: async ({ unitId, estado }) => {
    ordenes.push(`${coches[unitId].matricula}:${estado ? 'BLOQUEAR' : 'LIBERAR'}`);
    coches[unitId].rele = estado ? BLOQ : LIBRE;
    return { ok: true, confirmado: true, intentos: 1 };
  },
  relesDeFlota: async () => ({ vehiculos: Object.values(coches).map(c => ({
    unitId: c.unitId, matricula: c.matricula, estado: c.enMarcha ? 'driving' : 'standing',
    velocidad: c.enMarcha ? 40 : 0, ignicion: c.ignicion,
    reles: c.sinRele ? [] : [{ relay_id: 1, tipo: 'engine_block', activo: c.rele, habilitado: 1 }],
  })) }),
};

// ── La base de mentira ─────────────────────────────────────────────────────
// Se copian A PROPÓSITO los dos índices únicos de db/125 —una persona, un turno
// abierto; un coche, un turno abierto— devolviendo null igual que hace `crear`
// cuando la base lo rechaza. Sin eso la prueba pasaría por caminos que en
// producción no existen.
let turnos = [];
const tel9 = t => String(t == null ? '' : t).replace(/\D/g, '').slice(-9);
const norm = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const abierto = t => t.estado === 'abierto';

// La gente. Camilo es USUARIO (hace viajes). Ana y Beto son conductores que
// comparten el 2222BBB (día y noche). Carla es conductora DE BAJA. Dani es
// usuario Y conductor con el mismo número: manda el usuario.
const gente = {
  '640389649': { usuario: { id: '7', nombre: 'Camilo Bedoya', activo: true, vale: true } },
  '600000001': { conductor: { id: '101', nombre: 'Ana Día', activo: true, vale: true } },
  '600000002': { conductor: { id: '102', nombre: 'Beto Noche', activo: false, vale: true } },
  '600000003': { conductor: { id: '103', nombre: 'Carla Baja', activo: true, vale: false } },
  '600000004': { usuario: { id: '9', nombre: 'Dani Oficina', activo: true, vale: true },
                 conductor: { id: '104', nombre: 'Dani Conductor', activo: true, vale: true } },
};
const conductor = id => Object.values(gente).map(g => g.conductor).find(c => c && c.id === String(id));
// El cuadrante: quién lleva cada coche hoy o mañana.
const plan = { '2222BBB': ['101', '102'] };
// El libro del ciclo (fichaje_orden_motor): lo del conductor va sin usuario.
const libroMotor = [];
const USUARIOS = { 7: 'Camilo Bedoya' };
const T0 = Date.now();

const falsoRepo = {
  abiertoDe: async telefono =>
    turnos.find(t => abierto(t) && tel9(t.telefono) === tel9(telefono)) || null,
  abiertoDeCoche: async (matricula, telefono) =>
    turnos.find(t => abierto(t) && norm(t.matricula) === norm(matricula)
      && tel9(t.telefono) !== tel9(telefono)) || null,
  abiertos: async () => turnos.filter(abierto),
  unitsConocidos: async () => [...new Set(turnos.map(t => t.unitId).filter(Boolean))],
  // Como el de verdad: un viaje, o el turno de alguien con el bloqueo encendido.
  unitsConControl: async () => [...new Set(turnos
    .filter(t => t.tipo === 'viaje' || (conductor(t.conductorId) || {}).activo)
    .map(t => t.unitId).filter(Boolean))],
  controlMotorDe: async id => !!(conductor(id) || {}).activo,
  crear: async t => {
    if (turnos.some(x => abierto(x) && tel9(x.telefono) === tel9(t.telefono))) return null;
    if (turnos.some(x => abierto(x) && norm(x.matricula) === norm(t.matricula))) return null;
    // La referencia es única en la base de verdad. Aquí dos turnos de la misma
    // persona pueden nacer en el mismo milisegundo (la prueba va muy deprisa) y
    // `actualizar`, que busca por referencia, pisaría el que no es.
    const id = turnos.some(x => x.id === t.id) ? `${t.id}-${turnos.length}` : t.id;
    const g = { ...t, id, relevo: 0, estado: 'abierto', filaId: turnos.length + 1 };
    turnos.push(g);
    return g;
  },
  actualizar: async t => {
    const i = turnos.findIndex(x => x.id === t.id);
    if (i < 0) return null;
    turnos[i] = { ...turnos[i], ...t };
    return turnos[i];
  },
  quienLlevaba: async () => null,
  personaPorTelefono: async telefono => {
    const g = gente[tel9(telefono)] || {};
    return { conductor: g.conductor || null, usuario: g.usuario || null,
      abierto: turnos.some(t => abierto(t) && tel9(t.telefono) === tel9(telefono)) };
  },
  cochesDelPlan: async id => Object.entries(plan).filter(([, ids]) => ids.includes(String(id)))
    .map(([matricula]) => ({ matricula, turno: 'Día' })),
  quienesLlevan: async matricula => (plan[norm(matricula)] || [])
    .map(id => ({ conductorId: id, nombre: conductor(id).nombre, fichaCoche: conductor(id).activo })),
  cochesConQuienNoFicha: async () => new Set(Object.entries(plan)
    .filter(([, ids]) => ids.some(id => !conductor(id).activo)).map(([m]) => m)),
  marcarRelevo: async (ref, si) => {
    const t = turnos.find(x => x.id === ref && abierto(x) && x.tipo === 'turno');
    if (!t) return null;
    t.relevo = si ? (t.relevo || Math.floor(Date.now() / 1000)) : 0;
    return t;
  },
  fijarFichaCoche: async (id, activo) => { conductor(id).activo = !!activo; return { conductorId: String(id), fichaCoche: !!activo }; },
  activados: async () => [],
  registrarOrdenMotor: async o => {
    libroMotor.push({ ...o, matricula: norm(o.matricula), unitId: String(o.unitId || ''),
      deTrafico: !!o.usuarioId, usuario: o.usuarioId ? USUARIOS[o.usuarioId] || '' : '',
      cuando: new Date(T0 + libroMotor.length * 1000).toISOString() });
  },
  ultimaOrdenPorCoche: async () => { const m = new Map(); libroMotor.forEach(o => m.set(o.matricula, o)); return [...m.values()]; },
  ultimoTurnoPorCoche: async () => {
    const m = new Map();
    turnos.filter(t => !abierto(t)).forEach(t => {
      const k = norm(t.matricula), a = m.get(k);
      if (!a || (t.fin || 0) >= (a.fin || 0)) m.set(k, t);
    });
    return [...m.values()];
  },
  historiaDelCoche: async mat => ({
    ordenes: libroMotor.filter(o => o.matricula === norm(mat)).slice().reverse(),
    turnos: turnos.filter(t => norm(t.matricula) === norm(mat)).slice().reverse(),
  }),
};

require.cache[require.resolve(path.join(RAIZ, 'services/mapon.js'))] = { exports: falsoMapon, loaded: true, id: 'falso-mapon' };
require.cache[require.resolve(path.join(RAIZ, 'services/repo/fichajeTurno.js'))] = { exports: falsoRepo, loaded: true, id: 'falso-repo' };
// La sede sale de la base: aquí, una base de mentira con un solo coche de
// Barcelona. `services/otraSede.js` es el DE VERDAD, así que también se prueba.
let consultasSede = 0;
require.cache[require.resolve(path.join(RAIZ, 'services/db.js'))] = { loaded: true, id: 'falsa-db', exports: {
  consulta: async () => { consultasSede++; return { rows: [{ matricula_norm: '5555BCN', sede: 'barcelona', unit_id: '88' }] }; },
} };
const f = require(path.join(RAIZ, 'services/fichaje.js'));
const ciclo = require(path.join(RAIZ, 'modules/BloqueoMotor/bloqueoMotor.service.js'));

let mal = 0;
const comprobar = (t, ok) => { if (!ok) mal++; console.log((ok ? '  ok  ' : '  MAL ') + t); };
const CAMILO = '640389649', ANA = '600000001', BETO = '600000002', CARLA = '600000003', DANI = '600000004';
const coche = m => porMat(m);
const limpio = () => { ordenes.length = 0; };

(async () => {
  console.log('\n== 0. Quién participa ==');
  comprobar('Camilo, usuario → hace VIAJES', ((await f.participa(CAMILO)) || {}).tipo === 'viaje');
  comprobar('Ana, conductora de alta → hace TURNOS', ((await f.participa(ANA)) || {}).tipo === 'turno');
  const beto0 = await f.participa(BETO);
  comprobar('Beto, sin el bloqueo → hace TURNOS igual (desde el 28/09)', (beto0 || {}).tipo === 'turno');
  comprobar('… pero a él no se le bloquea el motor', beto0 && beto0.motor === false);
  comprobar('Carla, de baja en la empresa → no participa', (await f.participa(CARLA)) === null);
  comprobar('Dani, usuario y conductor → manda el USUARIO', ((await f.participa(DANI)) || {}).tipo === 'viaje');
  comprobar('un número desconocido → no participa', (await f.participa('699999999')) === null);

  console.log('\n== 1. Coche ya libre: empezar un viaje no manda nada ==');
  let r = await f.iniciar({ telefono: CAMILO, matricula: '1111AAA' });
  comprobar('viaje abierto', r.ok && r.turno.tipo === 'viaje');
  comprobar('motor dado por bueno', r.motor.hecho);
  comprobar('dice que YA ESTABA (sin esperar 10 s)', r.motor.yaEstaba === true);
  comprobar('no se mandó ninguna orden', ordenes.length === 0);

  console.log('\n== 2. Terminar con el contacto puesto: NO se cierra (regla de oro) ==');
  coche('1111AAA').ignicion = true; coche('1111AAA').segParado = 30;
  r = await f.terminar(CAMILO);
  comprobar('se NIEGA a terminar', r.ok === false && r.motivo === 'coche-encendido');
  comprobar('no se mandó nada al coche', ordenes.length === 0);
  comprobar('el viaje SIGUE abierto', (await f.estado(CAMILO)).abierto === true);

  console.log('\n== 3. Apaga, y entonces sí: termina y bloquea ==');
  coche('1111AAA').ignicion = false;
  r = await f.terminar(CAMILO);
  comprobar('viaje cerrado', r.ok);
  comprobar('motor bloqueado por orden de quien terminó', r.motor.hecho && !r.motor.yaEstaba);
  comprobar('la orden fue BLOQUEAR', ordenes.join() === '1111AAA:BLOQUEAR');
  const ultimo = () => libroMotor[libroMotor.length - 1];
  comprobar('queda en el libro del ciclo, sin usuario (lo hizo quien terminó)',
    ultimo().accion === 'bloquear' && ultimo().hecho && ultimo().usuarioId === null && /Termina el viaje/.test(ultimo().motivo));

  console.log('\n== 4. Coche bloqueado: empezar lo libera ==');
  limpio();
  r = await f.iniciar({ telefono: CAMILO, matricula: '1111AAA' });
  comprobar('motor liberado', r.motor.hecho && !r.motor.yaEstaba);
  comprobar('la orden fue LIBERAR', ordenes.join() === '1111AAA:LIBERAR');
  comprobar('y queda en el libro del ciclo', ultimo().accion === 'soltar' && ultimo().hecho && ultimo().usuarioId === null);

  console.log('\n== 5. Terminar EN MARCHA: no se cierra ==');
  limpio(); coche('1111AAA').enMarcha = true;
  r = await f.terminar(CAMILO);
  comprobar('se NIEGA a terminar', r.ok === false && r.motivo === 'coche-en-marcha');
  comprobar('da la velocidad para el aviso', r.velocidad === 40);
  comprobar('no se mandó nada al coche', ordenes.length === 0);
  coche('1111AAA').enMarcha = false;
  r = await f.terminar(CAMILO);
  comprobar('aparcado y apagado, ya termina', r.ok && r.motor.hecho);

  console.log('\n== 6. Turno de Ana, cuyo compañero (Beto) NO ficha: el motor se queda libre ==');
  limpio(); coche('2222BBB').ignicion = true;   // contacto puesto: da igual, no se va a bloquear
  r = await f.iniciar({ telefono: ANA, matricula: '2222BBB' });
  comprobar('turno abierto', r.ok && r.turno.tipo === 'turno');
  r = await f.terminar(ANA);
  comprobar('cierra aunque tenga el contacto puesto', r.ok);
  comprobar('el motor se queda LIBRE', r.motor.seQuedaLibre === true && !r.motor.hecho);
  comprobar('dice quién no ficha', (r.faltan || []).join() === 'Beto Noche');
  comprobar('no se mandó nada al coche', ordenes.length === 0);
  coche('2222BBB').ignicion = false;

  console.log('\n== 7. Sin repaso: el sistema no corta nada por su cuenta ==');
  comprobar('el repaso ya no existe', f.repasarBloqueos === undefined);
  // Un turno olvidado de alguien CON el bloqueo: el reloj lo cierra a las 14 h
  // y el motor no se toca (antes se intentaba bloquear aquí).
  limpio();
  r = await f.iniciar({ telefono: ANA, matricula: '3333CCC' });
  comprobar('Ana abre turno en el 3333CCC', r.ok);
  const libroAntes = libroMotor.length;
  turnos.find(t => abierto(t) && tel9(t.telefono) === ANA).inicio -= 15 * 3600;
  await f.estado(ANA);
  const olvidado = turnos.filter(t => norm(t.matricula) === '3333CCC').pop();
  comprobar('el reloj lo cierra', olvidado.estado === 'auto-cerrado' && /el motor no se toca/.test(olvidado.notas));
  comprobar('y NO bloquea: ni orden al coche ni apunte en el libro',
    ordenes.length === 0 && coche('3333CCC').rele === LIBRE && libroMotor.length === libroAntes);

  console.log('\n== 8. El que escribe la matrícula se queda el coche ==');
  // 8a. Ana (con bloqueo) lo tiene; Beto (sin bloqueo) lo comparte con ella, así
  // que a Ana no se le bloquearía: Beto lo coge aunque esté encendido.
  limpio();
  r = await f.iniciar({ telefono: ANA, matricula: '2222BBB' });
  comprobar('Ana abre turno', r.ok);
  coche('2222BBB').ignicion = true;
  r = await f.iniciar({ telefono: BETO, matricula: '2222BBB' });
  comprobar('Beto lo coge aunque Ana no pulsara «Entregar coche»', r.ok && r.turno.tipo === 'turno');
  comprobar('el turno de Ana queda RELEVADO', r.relevoDe && r.relevoDe.estado === 'relevado');
  comprobar('anotado que no pulsó el botón', r.relevoDe && r.relevoDe.sinBoton === true && /no pulsó/.test(r.relevoDe.notas));
  comprobar('a Beto le tocaba ese coche: no se anota más', r.relevoDe && !/cuadrante/.test(r.relevoDe.notas));
  comprobar('Ana ya no tiene nada abierto', (await f.estado(ANA)).abierto === false);
  comprobar('no se bloqueó nada en el relevo', !ordenes.some(o => o.endsWith('BLOQUEAR')));

  // 8b. Con los dos con el bloqueo, al que lo tiene SÍ se le bloquearía: antes de
  // pasar de manos, parado y apagado (la regla de «Terminar turno»).
  await f.activarConductor('102', true, { usuarioId: 7 });
  limpio();
  r = await f.iniciar({ telefono: ANA, matricula: '2222BBB' });
  comprobar('con el contacto puesto NO pasa de manos', r.ok === false && r.motivo === 'ocupado-encendido' && r.turno.nombre === 'Beto Noche');
  coche('2222BBB').ignicion = false; coche('2222BBB').enMarcha = true;
  r = await f.iniciar({ telefono: ANA, matricula: '2222BBB' });
  comprobar('en marcha tampoco, y da la velocidad', r.ok === false && r.motivo === 'ocupado-en-marcha' && r.velocidad === 40);
  comprobar('Beto sigue con el coche', (await f.estado(BETO)).abierto === true);
  comprobar('no se mandó nada al coche', ordenes.length === 0);
  coche('2222BBB').enMarcha = false;
  r = await f.iniciar({ telefono: ANA, matricula: '2222BBB' });
  comprobar('parado y apagado: Ana se lo queda', r.ok && r.relevoDe && r.relevoDe.nombre === 'Beto Noche');
  comprobar('y tampoco se bloquea en el relevo', !ordenes.some(o => o.endsWith('BLOQUEAR')));

  // 8c. Un viaje de la empresa también pasa de manos; y si al que entra no le
  // tocaba ese coche, queda anotado.
  r = await f.iniciar({ telefono: CAMILO, matricula: '3333CCC' });
  comprobar('un viaje no tiene «Entregar coche»', r.ok && (await f.marcarRelevo(CAMILO, true)).motivo === 'es-viaje');
  r = await f.iniciar({ telefono: BETO, matricula: '3333CCC' });
  comprobar('Beto coge el coche del viaje de Camilo', r.ok && r.relevoDe && r.relevoDe.tipo === 'viaje');
  comprobar('anotado que no lo tenía en el cuadrante', r.relevoDe && /no tenía ese coche en el cuadrante/.test(r.relevoDe.notas));
  comprobar('Camilo ya no tiene nada abierto', (await f.estado(CAMILO)).abierto === false);
  await f.terminar(BETO);

  // 8d. «Entregar coche»: el relevo de siempre, con los km del trayecto.
  r = await f.marcarRelevo(ANA, true);
  comprobar('Ana pulsa «Entregar coche»', r.ok && r.turno.relevo > 0);
  limpio();
  r = await f.iniciar({ telefono: BETO, matricula: '2222BBB' });
  comprobar('Beto coge el coche', r.ok && r.turno.tipo === 'turno');
  comprobar('con los km del trayecto al relevo', r.relevoDe && r.relevoDe.kmRelevo === 42);
  comprobar('y sin la nota de «no pulsó»', r.relevoDe && r.relevoDe.sinBoton === false);

  // 8e. Coche SIN relé de corte: no hay nada que bloquear, así que se cierra y ya,
  // aunque esté encendido (el caso de Deisy).
  r = await f.iniciar({ telefono: ANA, matricula: '4444DDD' });
  comprobar('Ana abre turno en un coche sin relé', r.ok);
  coche('4444DDD').ignicion = true;
  r = await f.iniciar({ telefono: CAMILO, matricula: '4444DDD' });
  comprobar('sin relé, pasa de manos aunque esté encendido', r.ok && r.relevoDe && r.relevoDe.nombre === 'Ana Día');
  await f.terminar(CAMILO);
  coche('4444DDD').ignicion = false;

  console.log('\n== 9. Con los dos fichando, al terminar SÍ se bloquea ==');
  limpio();
  r = await f.terminar(BETO);
  comprobar('turno cerrado y motor bloqueado', r.ok && r.motor.hecho);
  comprobar('la orden fue BLOQUEAR', ordenes.join() === '2222BBB:BLOQUEAR');

  console.log('\n== 10. Apagarle el bloqueo a alguien a mitad de turno ==');
  await f.iniciar({ telefono: BETO, matricula: '2222BBB' });
  await f.activarConductor('102', false, { usuarioId: 7 });
  const p = await f.participa(BETO);
  comprobar('sigue con sus turnos, ya sin bloqueo', p && p.tipo === 'turno' && p.motor === false);
  comprobar('no puede abrir otro con uno abierto', (await f.iniciar({ telefono: BETO, matricula: '1111AAA' })).motivo === 'ya-abierto');
  limpio(); coche('2222BBB').ignicion = true;
  r = await f.terminar(BETO);
  comprobar('termina aunque tenga el contacto puesto: no se le va a bloquear', r.ok);
  comprobar('y el motor se queda libre, sin tocar el coche', r.motor && r.motor.seQuedaLibre === true && ordenes.length === 0);
  coche('2222BBB').ignicion = false;

  console.log('\n== 11. El módulo «Ciclo de bloqueo de motor» ==');
  let l = await ciclo.lista();
  const fila = m => l.filas.find(x => x.matricula === m);
  comprobar('1111AAA BLOQUEADO: lo dejó Camilo al terminar, y se puede soltar',
    fila('1111AAA') && fila('1111AAA').estado === 'bloqueado' && fila('1111AAA').quien === 'Camilo Bedoya'
    && fila('1111AAA').puedeSoltar && fila('1111AAA').rele === 'cortado');
  comprobar('3333CCC BLOQUEADO por Beto (8c)', fila('3333CCC') && fila('3333CCC').estado === 'bloqueado' && fila('3333CCC').quien === 'Beto Noche');
  comprobar('4444DDD: al terminar no se pudo bloquear, no tiene relé',
    fila('4444DDD') && fila('4444DDD').estado === 'no-bloqueado' && /sin relé/.test(fila('4444DDD').detalle));
  comprobar('2222BBB no está: Beto terminó sin el bloqueo', !fila('2222BBB'));
  comprobar('0000AAA no está: nadie lo ha usado', !fila('0000AAA'));
  comprobar('ordenados: los bloqueados antes que los avisos de menos peso',
    l.filas.findIndex(x => x.estado === 'bloqueado') < l.filas.findIndex(x => x.estado === 'no-bloqueado'));
  // En turno: Ana, con el bloqueo, en el coche que comparte con Beto (ya sin él).
  r = await f.iniciar({ telefono: ANA, matricula: '2222BBB' });
  l = await ciclo.lista();
  comprobar('2222BBB EN TURNO con Ana: al terminar se quedará libre por Beto',
    fila('2222BBB') && fila('2222BBB').estado === 'en-turno' && fila('2222BBB').quien === 'Ana Día'
    && /quedará libre/.test(fila('2222BBB').detalle) && /Beto Noche/.test(fila('2222BBB').detalle) && !fila('2222BBB').puedeSoltar);
  await f.terminar(ANA);
  const fi = await ciclo.ficha('1111AAA');
  comprobar('la ficha cuenta lo que ha pasado', fi.estado === 'bloqueado'
    && fi.historia.some(e => e.que === 'Motor bloqueado' && e.quien === 'el conductor')
    && fi.historia.some(e => e.que === 'Termina el viaje'));
  // Un corte que no corta: Mapon lo da cortado y el coche se mueve sin turno.
  coche('1111AAA').enMarcha = true;
  l = await ciclo.lista();
  comprobar('«el corte no corta», el primero de la lista', fila('1111AAA').estado === 'no-corta' && l.filas[0].matricula === '1111AAA');
  coche('1111AAA').enMarcha = false;

  console.log('\n== 12. Soltar a mano desde el ERP ==');
  let error = '';
  try { await f.soltarCoche({ matricula: '1111AAA', motivo: '  ' }, { usuarioId: 7 }); } catch (e) { error = e.message; }
  comprobar('sin motivo NO se suelta', /por qué/.test(error) && coche('1111AAA').rele === BLOQ);
  r = await f.soltarCoche({ matricula: '1111AAA', motivo: 'Oswaldo no ficha y tiene que salir' }, { usuarioId: 7 });
  comprobar('con motivo, suelto', r.hecho && coche('1111AAA').rele === LIBRE);
  comprobar('y queda escrito quién y por qué', ultimo().usuarioId === 7 && ultimo().accion === 'soltar'
    && /Oswaldo/.test(ultimo().motivo));
  error = '';
  try { await f.soltarCoche({ matricula: '1111AAA', motivo: 'sin saber quién' }, {}); } catch (e) { error = e.message; }
  comprobar('sin saber quién suelta, NO se suelta (el libro lo leería como del conductor)', /quién eres/.test(error));
  l = await ciclo.lista();
  comprobar('sale FUERA DEL CICLO, con quién lo soltó y por qué',
    fila('1111AAA') && fila('1111AAA').estado === 'fuera' && fila('1111AAA').quien === 'Camilo Bedoya' && /Oswaldo/.test(fila('1111AAA').detalle));
  // «Hasta que nos lo entreguen de nuevo, un conductor inicie turno y termine».
  limpio();
  r = await f.iniciar({ telefono: ANA, matricula: '1111AAA' });
  comprobar('Ana lo coge: ya estaba libre, no se manda nada', r.ok && r.motor.yaEstaba && ordenes.length === 0);
  r = await f.terminar(ANA);
  l = await ciclo.lista();
  comprobar('al terminar se vuelve a bloquear: el ciclo empieza otra vez',
    r.motor.hecho && fila('1111AAA').estado === 'bloqueado' && fila('1111AAA').quien === 'Ana Día');

  console.log('\n== 13. Un coche de otra sede (Barcelona) no se toca nunca ==');
  limpio();
  r = await f.iniciar({ telefono: CAMILO, matricula: '5555BCN' });
  comprobar('no abre un viaje con él', r.ok === false && r.motivo === 'otra-sede' && r.sede === 'Barcelona');
  comprobar('ni le manda nada', ordenes.length === 0 && !turnos.some(t => t.matricula === '5555BCN'));
  // Como el 1888LTJ el 24/09: un viaje viejo con él en el libro.
  turnos.push({ id: 'viejo-bcn', tipo: 'viaje', estado: 'cerrado', telefono: CAMILO, matricula: '5555BCN', unitId: '88', relevo: 0, fin: 1 });
  r = await f.bloquearMotor('88', { porOrden: true });
  comprobar('una orden de corte directa se niega', !r.hecho && r.otraSede === 'barcelona'
    && !ordenes.some(o => o.startsWith('5555BCN')) && coche('5555BCN').rele === LIBRE);
  // Barcelona lo corta a propósito desde Mapon: nada de aquí lo toca ni lo enseña.
  coche('5555BCN').rele = BLOQ;
  const lib = await f.liberarConocidos();
  comprobar('«liberar todos» no se lo suelta', !lib.liberados.some(x => x.matricula === '5555BCN') && coche('5555BCN').rele === BLOQ);
  comprobar('no sale en el ciclo aunque Mapon lo dé cortado', !(await ciclo.lista()).filas.some(x => x.matricula === '5555BCN'));
  error = '';
  try { await ciclo.ficha('5555BCN'); } catch (e) { error = e.message; }
  comprobar('ni tiene ficha en el ciclo', /Barcelona/.test(error));
  error = '';
  try { await f.soltarCoche({ matricula: '5555BCN', motivo: 'prueba' }, { usuarioId: 7 }); } catch (e) { error = e.message; }
  comprobar('ni a mano desde el ERP', /Barcelona/.test(error) && coche('5555BCN').rele === BLOQ);
  comprobar('la sede se lee de la base una vez y se guarda', consultasSede === 1);

  console.log(mal ? `\n${mal} COMPROBACION(ES) MAL` : '\nTodo el ciclo cuadra');
  process.exitCode = mal ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
