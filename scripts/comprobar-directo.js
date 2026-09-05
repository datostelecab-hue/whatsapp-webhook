// ============================================================
// LA REGLA DE "¿HA SALIDO?" — el corazón de Control · En directo
// ============================================================
// Es la pregunta con la que tráfico decide a quién llama, así que conviene que
// no se rompa nunca más. Cada caso de aquí abajo es uno que ya pasó de verdad.
//
//   node scripts/comprobar-directo.js
//
// No toca la base de datos: prueba la función pura.

const { salidaDe } = require('../services/flotaViva/directo');

let fallos = 0;
const eq = (a, b, msg) => {
  if (a === b) console.log('  ✓ ' + msg);
  else { console.log('  ✗ ' + msg + '  (esperaba "' + b + '", salió "' + a + '")'); fallos++; }
};

const corriendo = { empezada: true };
const sinEmpezar = { empezada: false };

// Una actividad vacía por defecto; cada caso cambia solo lo suyo.
const act = (x = {}) => Object.assign({
  minutos: 0, minDescanso: 0, minDesconectado: 0, km: 0, kmFuera: 0,
  conectadoAhora: false, situacionAhora: null, primera: null, matriculas: [],
}, x);

console.log('\n=== EL CASO QUE ORIGINÓ ESTO (05/09/2026) ===');
// Darwin terminó su noche a las 03:51 y se desconectó. El coche siguió rodando
// hasta las 07:50 y Mapon le imputó 20,7 km, que cruzaban el corte de las 05:00.
// La pantalla decía "Salió · 0.0 h · 20.7 km" en el turno de DÍA. No salió.
const darwin = act({ minDesconectado: 170, kmFuera: 20.7 });
eq(salidaDe(darwin, corriendo), 'no_salio',
  'el que dejó el coche rodando desconectado NO ha salido, por muchos km que marque');

// Su compañero de día sí salió: 78 minutos de viaje+espera y sigue conectado.
const andres = act({ minutos: 78, km: 11.1, conectadoAhora: true });
eq(salidaDe(andres, corriendo), 'conectado', 'el que está rodando ahora sale como conectado');

console.log('\n=== LA VENTANA DEL TURNO ===');
eq(salidaDe(null, sinEmpezar), 'pendiente',
  'un turno que no ha empezado no tiene a nadie sin salir: está pendiente');
eq(salidaDe(darwin, sinEmpezar), 'pendiente',
  'ni siquiera con actividad arrastrada: si no ha empezado, pendiente');
eq(salidaDe(null, null), 'pendiente', 'sin ventana (la fuente falló) no se acusa a nadie');

console.log('\n=== QUIÉN HAY QUE LLAMAR ===');
eq(salidaDe(null, corriendo), 'no_salio', 'su turno corre y no hay ni rastro de él: a llamar');
eq(salidaDe(act({ minDescanso: 95 }), corriendo), 'no_salio',
  'solo descanso, sin un viaje ni una espera, no es haber salido');
eq(salidaDe(act({ minDesconectado: 300, kmFuera: 80 }), corriendo), 'no_salio',
  'ochenta km rodados fuera de BOLT siguen sin ser trabajo');

console.log('\n=== SALIÓ Y AHORA ESTÁ PARADO ===');
eq(salidaDe(act({ minutos: 240, km: 180 }), corriendo), 'salio',
  'trabajó cuatro horas y ahora está desconectado: salió');
eq(salidaDe(act({ minutos: 1, km: 0.4 }), corriendo), 'salio',
  'un minuto de trabajo ya es haber salido (el umbral por defecto es cero)');
eq(salidaDe(act({ minutos: 0, km: 2.3 }), corriendo), 'salio',
  'un viaje de menos de un minuto cuenta por sus km de TRABAJO');
eq(salidaDe(act({ minutos: 0, km: 0, conectadoAhora: true }), corriendo), 'conectado',
  'acaba de conectarse hace segundos: conectado, no "no ha salido"');

console.log('\n=== EL DESCANSO NO ES TRABAJO (busy) ===');
// La regla del negocio: solo cuentan has_order (viaje) y waiting_orders (espera).
// A un conductor con 4h29 de viaje, 1h03 de espera y 8h51 de descanso el reporte le
// ponia 14,4 h y "Muy efectivo". Son 5,5 h y "No cumplieron".
eq(salidaDe(act({ minDescanso: 531, conectadoAhora: true, situacionAhora: 'descanso' }), corriendo), 'descanso',
  'el que esta en descanso ahora mismo se dice APARTE, no como conectado');
eq(salidaDe(act({ minutos: 332, minDescanso: 531 }), corriendo), 'salio',
  'el caso Rodrigo: salio de verdad, pero sus horas son 5,5 y no 14,4');
eq(salidaDe(act({ minDescanso: 480, conectadoAhora: false }), corriendo), 'no_salio',
  'ocho horas de descanso y ni un viaje: no ha trabajado');

console.log('\n=== DESCANSO CON TRABAJO DETRÁS ===');
eq(salidaDe(act({ minutos: 30, minDescanso: 120, kmFuera: 12 }), corriendo), 'salio',
  'salió media hora y luego se puso en descanso: salió (el aviso va aparte)');

console.log(fallos ? '\n❌ ' + fallos + ' fallo(s)' : '\n✅ Todo correcto');
process.exit(fallos ? 1 : 0);
