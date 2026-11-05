// ============================================================
// COMPROBAR LA MODALIDAD DE 40 HORAS (40x5 / 40x4) — db/229
// ============================================================
//   node scripts/comprobar-jornada-modalidad.js
//
// Solo prueba la lectura pura de jornada.js: no toca la base de datos.

const J = require('../modules/Conductores/jornada');

let fallos = 0;
const igual = (nombre, obtenido, esperado) => {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${nombre}${ok ? '' : `  → salió ${JSON.stringify(obtenido)}, esperaba ${JSON.stringify(esperado)}`}`);
};
const lanza = (nombre, fn) => {
  let lanzo = false;
  try { fn(); } catch (_) { lanzo = true; }
  igual(nombre, lanzo, true);
};

console.log('\n=== LEER EL VALOR DEL DESPLEGABLE ===');
igual('«40» sin modalidad es 40x5 (la de por defecto)', J.parseJornada('40'), { horas: 40, dias: 5 });
igual('40 numérico también es 40x5', J.parseJornada(40), { horas: 40, dias: 5 });
igual('«40x4» es 40 horas en 4 días', J.parseJornada('40x4'), { horas: 40, dias: 4 });
igual('«40x5» es 40 horas en 5 días', J.parseJornada('40x5'), { horas: 40, dias: 5 });
igual('admite mayúsculas y espacios: « 40X4 »', J.parseJornada(' 40X4 '), { horas: 40, dias: 4 });
igual('«32» no tiene modalidad', J.parseJornada('32'), { horas: 32, dias: null });
igual('vacío no es ninguna jornada', J.parseJornada(''), { horas: null, dias: null });
igual('null no es ninguna jornada', J.parseJornada(null), { horas: null, dias: null });
lanza('«40x3» no vale: la modalidad es 40x5 o 40x4', () => J.parseJornada('40x3'));
lanza('«32x4» no vale: solo las de 40 horas tienen modalidad', () => J.parseJornada('32x4'));
lanza('«41» no vale: el tope es 40', () => J.parseJornada('41'));
lanza('«0» no vale', () => J.parseJornada(0));
lanza('«cuarenta» no vale', () => J.parseJornada('cuarenta'));

console.log('\n=== EL TEXTO QUE SE ENSEÑA ===');
igual('40 con modalidad 4 se ve «40x4»', J.valorJornada(40, 4), '40x4');
igual('40 con modalidad 5 se ve «40x5»', J.valorJornada(40, 5), '40x5');
igual('40 sin modalidad (contrato anterior) se ve «40x5»', J.valorJornada(40, null), '40x5');
igual('32 se ve «32»', J.valorJornada(32, null), '32');
igual('sin jornada no se ve nada', J.valorJornada(null, null), '');

console.log('\n=== EL DESPLEGABLE ===');
const valores = J.OPCIONES_JORNADA.map(o => o.valor);
igual('tiene 40x5 y 40x4', valores.includes('40x5') && valores.includes('40x4'), true);
igual('ya no tiene el «40» suelto', valores.includes('40'), false);
igual('conserva las horas habituales (32 y 35)', valores.includes('32') && valores.includes('35'), true);
igual('40x5 va antes que 40x4 (la de por defecto arriba)',
  valores.indexOf('40x5') < valores.indexOf('40x4'), true);

console.log('\n=== LOS DÍAS QUE CUBRE UN CORRETURNO ===');
igual('40x4 de correturno cubre 4 días, aunque el catálogo diga 6', J.diasDeCt(40, 4, 6), 4);
igual('32 h sigue el catálogo (4 días)', J.diasDeCt(32, null, 4), 4);
igual('40 sin modalidad sigue el catálogo (6 días): decisión pendiente para 40x5', J.diasDeCt(40, null, 6), 6);
igual('40x5 sigue el catálogo (6 días): decisión pendiente', J.diasDeCt(40, 5, 6), 6);
igual('sin jornada no hay días que exigir', J.diasDeCt(null, null, null), null);

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo correcto');
process.exit(fallos ? 1 : 0);
