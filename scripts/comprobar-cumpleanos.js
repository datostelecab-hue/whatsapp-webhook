// ============================================================
// LOS CUMPLEAÑOS — las reglas
// ============================================================
// Quién sale cada día (15/10/2026): los del 29 de febrero el 28 en un año no
// bisiesto, quien cumple no se ve a sí mismo como «cumple hoy» sino la
// felicitación, y Control sabe a qué conductores pintar en azul. Y las
// felicitaciones entre compañeros de oficina (db/205): solo a quien cumple hoy,
// nunca a uno mismo, una por persona, y cada uno da por vistas solo las suyas.
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
  // Las felicitaciones, en memoria, con la misma regla que la base: una por
  // quien felicita, a quién y día.
  felicitar: async (para, de, dia) => {
    if (filas.some(f => f.para === para && f.de === de && f.dia === dia)) return { nueva: false };
    filas.push({ id: filas.length + 1, para, de, dia, visto: false });
    return { nueva: true };
  },
  yaFelicitados: async (de, dia) => new Set(filas.filter(f => f.de === de && f.dia === dia).map(f => f.para)),
  pendientes: async para => filas.filter(f => f.para === para && !f.visto).map(f => ({ id: f.id, dia: f.dia, nombre: 'N' + f.de })),
  marcarVistas: async (para, ids) => {
    let n = 0;
    filas.forEach(f => { if (f.para === para && ids.includes(f.id) && !f.visto) { f.visto = true; n++; } });
    return n;
  },
});
const filas = [];
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

  // ── Felicitar ──────────────────────────────────────────────────────────────
  const r1 = await S.felicitar(9, 3);
  const r2 = await S.felicitar(9, 3);
  igual('Felicitar a quien cumple hoy: la primera cuenta, la segunda no manda otra',
    [r1, r2, filas.length], [{ nueva: true, para: 'Laura' }, { nueva: false, para: 'Laura' }, 1]);
  const error = p => p.then(() => 'sin error', e => e.message);
  igual('No se felicita a quien no cumple hoy, ni uno a sí mismo',
    [await error(S.felicitar(5, 3)), await error(S.felicitar(9, 9)), filas.length],
    ['Esa persona no cumple años hoy', 'No puedes felicitarte a ti mismo', 1]);
  const tres = await S.hoy(3);
  igual('Quien ya felicitó lo ve en su tarjeta (y a quien no, no)',
    tres.oficina.map(o => [o.id, o.yaFelicitado]), [[7, false], [9, true]]);
  const laura = await S.hoy(9);
  igual('Quien cumple ve las felicitaciones que le han llegado',
    laura.felicitaciones.map(f => [f.id, f.nombre]), [[1, 'N3']]);
  igual('Darlas por vistas: solo las suyas, y lo que no es un id no cuenta',
    [await S.vistas(7, [1]), await S.vistas(9, ['x', -1, null, 1.5]), await S.vistas(9, ['1'])],
    [{ vistas: 0 }, { vistas: 0 }, { vistas: 1 }]);
  igual('Vistas, ya no salen', await S.mias(9), { felicitaciones: [] });

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
