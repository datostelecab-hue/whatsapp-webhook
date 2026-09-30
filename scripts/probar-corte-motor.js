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
// 30/09/2026: un coche de OTRA SEDE no se toca nunca (services/otraSede.js), y
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
    reles: [{ relay_id: 1, tipo: 'engine_block', activo: c.rele, habilitado: 1 }],
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
const ordenesManuales = [];

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
    const g = { ...t, relevo: 0, estado: 'abierto', filaId: turnos.length + 1 };
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
  registrarOrdenMotor: async o => { ordenesManuales.push(o); },
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

  console.log('\n== 4. Coche bloqueado: empezar lo libera ==');
  limpio();
  r = await f.iniciar({ telefono: CAMILO, matricula: '1111AAA' });
  comprobar('motor liberado', r.motor.hecho && !r.motor.yaEstaba);
  comprobar('la orden fue LIBERAR', ordenes.join() === '1111AAA:LIBERAR');

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

  console.log('\n== 7. El repaso no toca el coche de quien no ficha ==');
  let rep = await f.repasarBloqueos();
  comprobar('2222BBB NO se bloquea', !rep.bloqueados.some(x => x.matricula === '2222BBB'));
  comprobar('y dice por qué', rep.omitidos.some(x => x.matricula === '2222BBB' && /no ficha/.test(x.motivo)));

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

  console.log('\n== 11. El repaso recoge lo que quedó suelto, y nada más ==');
  // Bien parado desde hace una hora: el paso 2 lo dejó «parado hace 30 s».
  coche('1111AAA').rele = LIBRE; coche('1111AAA').segParado = 3600; coche('2222BBB').rele = LIBRE; limpio();
  rep = await f.repasarBloqueos();
  comprobar('bloquea el que pasó por el fichaje', rep.bloqueados.some(x => x.matricula === '1111AAA'));
  comprobar('NO toca el que nadie fichó', !rep.bloqueados.some(x => x.matricula === '0000AAA')
    && !rep.omitidos.some(x => x.matricula === '0000AAA'));
  comprobar('NO toca el 2222BBB: Beto ya no ficha', !rep.bloqueados.some(x => x.matricula === '2222BBB'));
  comprobar('idempotente: otra pasada no bloquea nada', (await f.repasarBloqueos()).bloqueados.length === 0);

  console.log('\n== 12. Soltar a mano desde el ERP ==');
  let error = '';
  try { await f.soltarCoche({ matricula: '1111AAA', motivo: '  ' }, { usuarioId: 7 }); } catch (e) { error = e.message; }
  comprobar('sin motivo NO se suelta', /por qué/.test(error) && coche('1111AAA').rele === BLOQ);
  r = await f.soltarCoche({ matricula: '1111AAA', motivo: 'Oswaldo no ficha y tiene que salir' }, { usuarioId: 7 });
  comprobar('con motivo, suelto', r.hecho && coche('1111AAA').rele === LIBRE);
  comprobar('y queda escrito quién y por qué', ordenesManuales.length === 1 &&
    ordenesManuales[0].usuarioId === 7 && /Oswaldo/.test(ordenesManuales[0].motivo));

  console.log('\n== 13. Un coche de otra sede (Barcelona) no se toca nunca ==');
  limpio();
  r = await f.iniciar({ telefono: CAMILO, matricula: '5555BCN' });
  comprobar('no abre un viaje con él', r.ok === false && r.motivo === 'otra-sede' && r.sede === 'Barcelona');
  comprobar('ni le manda nada', ordenes.length === 0 && !turnos.some(t => t.matricula === '5555BCN'));
  // Como el 1888LTJ el 24/09: un viaje viejo en el libro lo metía en el repaso.
  turnos.push({ id: 'viejo-bcn', tipo: 'viaje', estado: 'cerrado', telefono: CAMILO, matricula: '5555BCN', unitId: '88', relevo: 0 });
  rep = await f.repasarBloqueos();
  comprobar('el repaso NO lo corta aunque salga en el libro', !rep.bloqueados.some(x => x.matricula === '5555BCN') && coche('5555BCN').rele === LIBRE);
  comprobar('ni lo mira: está fuera de su alcance', !rep.omitidos.some(x => x.matricula === '5555BCN'));
  r = await f.bloquearMotor('88', { porOrden: true });
  // (El repaso de arriba sí vuelve a cortar el 1111AAA, de Madrid y del libro:
  // aquí solo cuenta que al de Barcelona no le llegue nada.)
  comprobar('una orden de corte directa se niega', !r.hecho && r.otraSede === 'barcelona'
    && !ordenes.some(o => o.startsWith('5555BCN')));
  comprobar('y el repaso sigue haciendo lo suyo con los de Madrid', ordenes.includes('1111AAA:BLOQUEAR'));
  // Barcelona lo corta a propósito desde Mapon: nada de aquí se lo suelta.
  coche('5555BCN').rele = BLOQ;
  const lib = await f.liberarConocidos();
  comprobar('«liberar todos» no se lo suelta', !lib.liberados.some(x => x.matricula === '5555BCN') && coche('5555BCN').rele === BLOQ);
  comprobar('no sale en la lista de motores cortados de Tráfico', !(await f.motoresCortados()).some(x => x.matricula === '5555BCN'));
  error = '';
  try { await f.soltarCoche({ matricula: '5555BCN', motivo: 'prueba' }, { usuarioId: 7 }); } catch (e) { error = e.message; }
  comprobar('ni a mano desde el ERP', /Barcelona/.test(error) && coche('5555BCN').rele === BLOQ);
  comprobar('la sede se lee de la base una vez y se guarda', consultasSede === 1);

  console.log(mal ? `\n${mal} COMPROBACION(ES) MAL` : '\nTodo el ciclo cuadra');
  process.exitCode = mal ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
