// ============================================================
// CICLO DEL CORTE DE MOTOR, sin tocar un solo coche
// ============================================================
//   node scripts/probar-corte-motor.js
//
// Mapon y Sheets de mentira. Comprueba lo que no se puede comprobar con un coche
// real sin salir a la calle: que la secuencia entera hace lo que dice, incluidos
// los casos que no se pueden provocar a voluntad — el conductor pulsando
// "Terminar turno" mientras conduce, y el repaso recogiendo lo que quedo suelto.
//
// No toca nada real: ni Mapon, ni la hoja, ni WhatsApp.

const path = require('path');
const RAIZ = path.join(__dirname, '..');

process.env.FICHAJE_BLOQUEO_MOTOR = '1';
process.env.FICHAJE_TELEFONOS = '640389649:Camilo';
process.env.FICHAJE_MATRICULAS = '';

const LIBRE = 0, BLOQ = 1;

// El coche de mentira. Se toquetea desde las pruebas para provocar cada caso.
let rele = LIBRE;                 // como estara la mayoria al principio
let segParado = 3600, ignicion = false, enMarcha = false;
const ordenes = [];               // que se le ha mandado de verdad al coche

const falsoMapon = {
  unidadPorMatricula: async m => ({ unitId: 77, matricula: m.toUpperCase(), vehiculo: 'Skoda Octavia' }),
  listarConductores: async () => [],
  crearConductor: async () => 991,
  unidadDeConductor: async () => null,
  asignarConductor: async () => true,
  desasignarConductor: async () => true,
  kmEnVentana: async () => ({ km: 42, trayectos: 3, conConductor: 3 }),
  kmDeUnidad: async () => ({ km: 42, trayectos: 3, conConductor: 3 }),
  releDeCorte: info => ((info && info.reles) || []).find(r => r.tipo === 'engine_block') || null,
  relesDeUnidad: async () => ({
    unitId: 77, matricula: '1888LTJ', estado: enMarcha ? 'driving' : 'standing',
    enMarcha, velocidad: enMarcha ? 40 : 0, ignicion, segParado, segSinSenal: 60,
    reles: [{ relay_id: 1, tipo: 'engine_block', titulo: 'Bloqueo Motor', estado: rele, habilitado: 1 }],
  }),
  cambiarReleConfirmado: async ({ estado }) => {
    ordenes.push(estado ? 'BLOQUEAR' : 'LIBERAR');
    rele = estado ? BLOQ : LIBRE;
    return { ok: true, confirmado: true, intentos: 1 };
  },
  relesDeFlota: async () => ({ vehiculos: [
    { unitId: 77, matricula: '1888LTJ', reles: [{ relay_id: 1, tipo: 'engine_block', activo: rele, habilitado: 1 }] },
    // Un coche que NADIE ha fichado: el repaso no debe tocarlo jamas.
    { unitId: 99, matricula: '0000AAA', reles: [{ relay_id: 1, tipo: 'engine_block', activo: LIBRE, habilitado: 1 }] },
  ] }),
};

let filas = [];
const falsoSheets = {
  ensureSheet: async () => true,
  readSheet: async () => filas,
  writeSheetRaw: async (id, rango, datos) => {
    const m = rango.match(/A(\d+)/);
    filas[m ? Number(m[1]) - 1 : 0] = datos[0];
  },
  appendRows: async (id, r, datos) => { datos.forEach(d => filas.push(d)); },
};

require.cache[require.resolve(path.join(RAIZ, 'services/mapon.js'))] = { exports: falsoMapon, loaded: true, id: 'falso-mapon' };
require.cache[require.resolve(path.join(RAIZ, 'services/sheets.js'))] = { exports: falsoSheets, loaded: true, id: 'falso-sheets' };
const f = require(path.join(RAIZ, 'services/fichaje.js'));

let mal = 0;
const comprobar = (t, ok) => { if (!ok) mal++; console.log((ok ? '  ok  ' : '  MAL ') + t); };
const TEL = '640389649';
const fichar = () => f.iniciar({ telefono: TEL, nombre: 'Camilo', matricula: '1888LTJ' });

(async () => {
  console.log('\n== 1. Coche ya libre: iniciar turno no manda nada ==');
  let r = await fichar();
  comprobar('turno abierto', r.ok);
  comprobar('motor dado por bueno', r.motor.hecho);
  comprobar('dice que YA ESTABA (sin esperar 10 s)', r.motor.yaEstaba === true);
  comprobar('no se mando ninguna orden', ordenes.length === 0);

  console.log('\n== 2. Terminar parado: bloquea aunque acabe de detenerse ==');
  segParado = 30; ignicion = true;
  r = await f.terminar(TEL);
  comprobar('turno cerrado', r.ok);
  comprobar('motor bloqueado por orden del conductor', r.motor.hecho && !r.motor.yaEstaba);
  comprobar('la orden fue BLOQUEAR', ordenes.join() === 'BLOQUEAR');

  console.log('\n== 3. Coche bloqueado: iniciar turno lo libera ==');
  ordenes.length = 0;
  r = await fichar();
  comprobar('motor liberado', r.motor.hecho && !r.motor.yaEstaba);
  comprobar('la orden fue LIBERAR', ordenes.join() === 'LIBERAR');

  console.log('\n== 4. Terminar EN MARCHA: no se cierra el turno ==');
  ordenes.length = 0; enMarcha = true;
  r = await f.terminar(TEL);
  comprobar('se NIEGA a terminar', r.ok === false);
  comprobar('dice que va en marcha', r.motivo === 'coche-en-marcha');
  comprobar('da la velocidad para el aviso', r.velocidad === 40);
  comprobar('no se mando nada al coche', ordenes.length === 0);
  comprobar('el turno SIGUE abierto', (await f.estado(TEL)).abierto === true);

  console.log('\n== 4b. Aparca, y entonces si ==');
  enMarcha = false; segParado = 30; ignicion = true;
  r = await f.terminar(TEL);
  comprobar('turno cerrado', r.ok);
  comprobar('motor bloqueado', r.motor.hecho);
  comprobar('la orden fue BLOQUEAR', ordenes.join() === 'BLOQUEAR');

  console.log('\n== 5. El repaso recoge lo que quedo suelto ==');
  // Un bloqueo que no llego a aplicarse: coche libre, sin turno y bien parado.
  rele = LIBRE; ordenes.length = 0; segParado = 3600; ignicion = false;
  const rep = await f.repasarBloqueos();
  comprobar('bloquea el que paso por el fichaje', rep.bloqueados.some(x => x.matricula === '1888LTJ'));
  comprobar('NO toca el coche que nadie ficho',
    !rep.bloqueados.some(x => x.matricula === '0000AAA') &&
    !rep.omitidos.some(x => x.matricula === '0000AAA'));

  console.log('\n== 6. Idempotente: otra pasada no hace nada ==');
  comprobar('no vuelve a bloquear', (await f.repasarBloqueos()).bloqueados.length === 0);

  console.log(mal ? `\n${mal} COMPROBACION(ES) MAL` : '\nTodo el ciclo cuadra');
  process.exitCode = mal ? 1 : 0;
})();
