// ============================================================
// LA FLOTA DE MAPON — cuándo se pone ✓ a cada función
// ============================================================
// Las reglas del inventario de Operaciones (/operaciones/mapon/flota.xlsx,
// 08/10/2026): GPS, CAN, contacto, corte de motor, órdenes del catálogo y lo que
// ha probado el bot. Sin base ni Mapon.
//
//   node scripts/comprobar-mapon-flota.js
const { diagnosticar } = require('../modules/Operaciones/maponFlota.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

const AHORA = Date.parse('2026-10-08T10:00:00Z');
const iso = horas => new Date(AHORA - horas * 3600e3).toISOString().slice(0, 19) + 'Z';
const BUENA = {
  unit_id: 893922, number: '1194 LCK', make: 'Toyota', model: 'Corolla', last_update: iso(0.1), state: { name: 'driving' }, lat: 40.4, lng: -3.7,
  can: { odom: { value: 123456.7 }, fuel_level: { value: 40 } }, ignition: { value: 'on' },
  relays: [{ relay_id: 1, type: 'engine_block', title: 'Bloqueo Motor' }],
};
const TODAS = ['open_doors', 'close_doors', 'open_trunk', 'hazard_lights', 'open_windows', 'close_windows', 'horn'];
const d = diagnosticar(BUENA, TODAS, { ahora: AHORA, coche: { sede: 'madrid', estado_operativo: 'Operativo' }, puertas: { aperturas_ok: 3, cierres_ok: 2, fallos: 0, ultima_ok: iso(2) } });
igual('Una unidad completa: todo ✓',
  [d.gpsBueno, d.can, d.kmCan, d.combustible, d.contacto, d.corteMotor, d.abrirPuertas, d.cerrarPuertas, d.maletero, d.warnings, d.ventanillas, d.puertasProbadas],
  [true, true, 123457, true, true, true, true, true, true, true, true, true]);
igual('La matrícula tal cual, la sede y los comandos que no se conocen', [d.matricula, d.sede, d.otrosComandos], ['1194 LCK', 'Madrid', 'horn']);

const sinGps = diagnosticar({ ...BUENA, state: { name: 'nogps' } }, TODAS, { ahora: AHORA });
igual('Sin GPS pero enviando: envía ✓, señal ✗, GPS bueno ✗', [sinGps.enviaDatos, sinGps.gpsSenal, sinGps.gpsBueno], [true, false, false]);
const vieja = diagnosticar({ ...BUENA, last_update: iso(30) }, TODAS, { ahora: AHORA });
igual('Con señal pero sin datos en 30 h: GPS bueno ✗', [vieja.enviaDatos, vieja.gpsBueno, vieja.horasSinDatos], [false, false, 30]);
const posCero = diagnosticar({ ...BUENA, lat: 0, lng: 0 }, TODAS, { ahora: AHORA });
igual('Posición 0,0 no es posición', posCero.gpsSenal, false);

const pelada = diagnosticar({ unit_id: 1, number: '1111AAA', last_update: iso(1), state: { name: 'standing' }, lat: 40, lng: -3,
  relays: [{ type: 'basic' }, { type: 'basic' }, { type: 'basic' }] }, [], { ahora: AHORA });
igual('Sin CAN, sin contacto y tres relés «basic»: sin corte', [pelada.can, pelada.kmCan, pelada.contacto, pelada.corteMotor, pelada.combustible], [false, null, false, false, false]);
igual('Catálogo vacío: ninguna orden', [pelada.abrirPuertas, pelada.cerrarPuertas, pelada.otrosComandos], [false, false, '']);
igual('Sin coche de Telecab: «Sin enlazar» y se dice', [pelada.sede, /No está enlazada/.test(pelada.observaciones)], ['Sin enlazar', true]);

const sinCatalogo = diagnosticar(BUENA, { error: 'Unit not found' }, { ahora: AHORA });
igual('Si Mapon no da el catálogo: «?» (null), no ✗', [sinCatalogo.abrirPuertas, sinCatalogo.cerrarPuertas, /catálogo/.test(sinCatalogo.observaciones)], [null, null, true]);

const sobra = diagnosticar(BUENA, TODAS, { ahora: AHORA, duplicado: { total: 2, enUso: false, usado: 932730 } });
igual('Un equipo sobrante de una matrícula con dos', [sobra.enUso, /SOBRA/.test(sobra.observaciones)], [false, true]);
const fallidas = diagnosticar(BUENA, TODAS, { ahora: AHORA, coche: { sede: 'barcelona' }, puertas: { aperturas_ok: 0, cierres_ok: 0, fallos: 4 } });
igual('El bot lo intentó y nunca funcionó', [fallidas.puertasProbadas, fallidas.sede, /nunca ha funcionado/.test(fallidas.observaciones)], [false, 'Barcelona', true]);

// ── Lo que enseñaron los datos reales (08/10/2026) ───────────────────────
const vacio = diagnosticar({ ...BUENA, can: { odom: { value: 1000 } }, fuel: [{ type: 'CAN', metrics: null, value: null, last_update: null }] }, TODAS, { ahora: AHORA });
igual('El bloque de combustible viene vacío en todas: sin valor, ✗', vacio.combustible, false);
const conLitros = diagnosticar({ ...BUENA, can: { odom: { value: 1000 } }, fuel: [{ type: 'CAN', metrics: 'L', value: 40 }] }, TODAS, { ahora: AHORA });
igual('Con litros, ✓', conLitros.combustible, true);
const apagado = diagnosticar({ ...BUENA, relays: [{ relay_id: 1, type: 'engine_block', title: 'Bloqueo Motor', enabled: 0 }] }, TODAS, { ahora: AHORA });
igual('Corte configurado pero desactivado: ✗ y se dice', [apagado.corteMotor, /DESACTIVADO/.test(apagado.observaciones)], [false, true]);
const activo = diagnosticar({ ...BUENA, relays: [{ relay_id: 1, type: 'engine_block', enabled: 1 }, { relay_id: 2, type: 'basic', enabled: 0 }] }, TODAS, { ahora: AHORA });
igual('Corte activado: ✓', activo.corteMotor, true);
const hibrido = diagnosticar({ ...BUENA, ev_values: { ev_charging: { value: 0 }, can_ev_battery_rel: { value: 61.4 } } }, TODAS, { ahora: AHORA });
igual('Batería del híbrido con su %', [hibrido.bateriaHibrida, hibrido.bateriaPct, BUENA.ev_values === undefined && diagnosticar(BUENA, TODAS, { ahora: AHORA }).bateriaHibrida], [true, 61, false]);
const equipos = [{ model: 'TELTONIKA', model_ver: 'FMC880', unit_id: 893922 }];
igual('El equipo, por la lista de dispositivos; sin cámara', [diagnosticar(BUENA, TODAS, { ahora: AHORA, equipos }).equipo, diagnosticar(BUENA, TODAS, { ahora: AHORA, equipos }).camara], ['TELTONIKA FMC880', false]);
const conCam = diagnosticar(BUENA, TODAS, { ahora: AHORA, equipos: [...equipos, { model: 'TELTONIKA', model_ver: 'DualCam', unit_id: 893922 }] });
igual('Una cámara registrada: ✓ y no se mezcla con el localizador', [conCam.camara, conCam.camaraModelo, conCam.equipo], [true, 'TELTONIKA DualCam', 'TELTONIKA FMC880']);
const guion = diagnosticar({ ...BUENA, number: '-', label: '' }, TODAS, { ahora: AHORA });
igual('Una unidad con matrícula «-»', [guion.matricula, /no tiene matrícula/.test(guion.observaciones)], ['(sin matrícula) #893922', true]);

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
