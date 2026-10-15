// ============================================================
// LOS CUMPLEAÑOS — las reglas
// ============================================================
// Quién sale cada día (15/10/2026): los del 29 de febrero el 28 en un año no
// bisiesto, quien cumple no se ve a sí mismo como «cumple hoy» sino la
// felicitación, y Control sabe a qué conductores pintar en azul.
//
//   node scripts/comprobar-cumpleanos.js
//
// No toca la base: el repositorio se sustituye.
const path = require('path');

const pedidos = [];
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};
sustituir('modules/Cumpleanos/cumpleanos.repo.js', {
  conductores: async (mes, dia, del29) => { pedidos.push(['c', mes, dia, del29]); return [{ id: 141, nombre: 'Jaime Alberto Bech Afonso', ett: false }]; },
  oficina: async (mes, dia, del29) => { pedidos.push(['o', mes, dia, del29]); return [{ id: 7, nombre: 'Camilo', apellidos: 'Bedoya', rol: 'Desarrollador' }, { id: 9, nombre: 'Laura', apellidos: 'Blanco', rol: 'Oficina' }]; },
});
const S = require('../modules/Cumpleanos/cumpleanos.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  pedidos.length = 0;
  await S.delDia('2026-10-16');
  igual('Un día cualquiera: se pregunta por ese mes y día, sin los del 29', pedidos, [['c', 10, 16, false], ['o', 10, 16, false]]);

  pedidos.length = 0;
  await S.delDia('2027-02-28');
  igual('El 28 de febrero de un año no bisiesto: también los del 29', pedidos.map(p => p[3]), [true, true]);

  pedidos.length = 0;
  await S.delDia('2028-02-28');
  igual('El 28 de febrero de un bisiesto: los del 29 tienen su día', pedidos.map(p => p[3]), [false, false]);

  S.olvidar();
  const camilo = await S.hoy(7);
  igual('Quien cumple no se ve como «cumple hoy»: le sale la felicitación',
    [camilo.felicitar, camilo.oficina.map(o => o.id)], [{ nombre: 'Camilo' }, [9]]);
  const otro = await S.hoy(3);
  igual('Los demás ven a los dos de oficina y al conductor, sin felicitación',
    [otro.felicitar, otro.oficina.map(o => o.id), otro.conductores.map(c => c.id)], [null, [7, 9], [141]]);
  igual('Control: los conductores que cumplen', [...await S.idsConductoresHoy()], ['141']);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
