// ============================================================
// EL ICEBERG DEL PLANIFICADOR, sin base de datos
// ============================================================
//   node scripts/probar-iceberg.js
//
// Comprueba modules/Planificacion/iceberg.js (05/10/2026) con un tablero de
// mentira: tres bases, coches completos, con plazas vacías y sin nadie, uno en
// el taller y un cuadrante vacío. Lo que importa:
//   · el escalón de cada coche (completo / con plazas vacías / sin nadie), y que
//     quien está por llegar cuenta como alguien;
//   · las horas instaladas: la calificación de quien cubre cada turno, 0 en el
//     turno sin nadie y la mediana de la flota para quien aún no tiene;
//   · el orden: escalón → rueda → horas, y el del taller al fondo de su escalón;
//   · el cuadrante por la MEDIA de horas, no por la suma, y el vacío al final;
//   · las cuentas de cada base con la misma regla que el resumen general.
const ice = require('../modules/Planificacion/iceberg');

let mal = 0;
const comprobar = (t, ok, d) => { if (!ok) mal++; console.log(`  ${ok ? 'ok' : 'MAL'}  ${t}${!ok && d ? '  → ' + d : ''}`); };

// ── La gente: horas por día trabajado (su calificación) ───────────────────
const gente = new Map([
  ['a', { rendimiento: { horas: 10, dias: 12, letra: 'A' } }],
  ['b', { rendimiento: { horas: 8, dias: 12, letra: 'B' } }],
  ['c', { rendimiento: { horas: 6, dias: 12, letra: 'C' } }],
  ['n', { rendimiento: { horas: 0, dias: 0, letra: 'N/E', nuevo: true } }],   // recién llegado
  ['z', { rendimiento: { horas: 0, dias: 9, letra: 'D' } }],                   // trabajó y no hizo horas: 0 de verdad
]);

/** Una semana de 14 turnos: `quien[i]` cubre el turno i ('' = nadie). */
const semana = quien => Array.from({ length: 14 }, (_, i) => ({ id: quien[i] || '', nombre: '' }));
const todos = id => semana(Array(14).fill(id));
const plaza = (id, extra) => ({ id: id || '', ...(extra || {}) });
const personas = ids => Array.from({ length: 6 }, (_, k) => plaza(ids[k]));
const nada = { fijo: { dia: false, noche: false }, ct: { dia: 0, noche: 0 } };

let vid = 0;
const coche = (o) => ({
  vehiculoId: ++vid, matricula: o.matricula, cuadranteId: o.cuadranteId || null, zonaId: o.zonaId || null,
  operativo: o.operativo !== false, visibleCobertura: o.visibleCobertura !== false,
  personas: o.personas || personas(['a', 'b', 'c', 'c']), semana: o.semana || todos('b'),
  falta: o.falta || nada, sinCubrirDia: o.sinCubrirDia || 0, sinCubrirNoche: o.sinCubrirNoche || 0,
});

const coches = [
  // Base 1, cuadrante 10: dos completos, uno con mejores conductores.
  coche({ matricula: 'A-BUENO', cuadranteId: 10, semana: todos('a') }),                       // 140 h
  coche({ matricula: 'A-NORMAL', cuadranteId: 10, semana: todos('b') }),                      // 112 h
  // Base 1, cuadrante 11: uno solo, completo y con más horas que la MEDIA del 10
  // pero menos que la SUMA.
  coche({ matricula: 'B-SOLO', cuadranteId: 11, semana: todos('a') }),                        // 140 h
  // Base 1, cuadrante 12: completo pero en el TALLER, con las mejores horas.
  coche({ matricula: 'C-TALLER', cuadranteId: 12, operativo: false, visibleCobertura: false, semana: todos('a') }),
  // Base 1, cuadrante 13: le falta el fijo de noche (con el CT sin sus días).
  coche({ matricula: 'D-SINFIJO', cuadranteId: 13, personas: personas(['a', '', 'c', 'c']),
    semana: semana(['a', '', 'a', '', 'a', '', 'a', '', 'a', '', 'a', '', 'a', '']),
    falta: { fijo: { dia: false, noche: true }, ct: { dia: 0, noche: 2 } }, sinCubrirNoche: 7 }),
  // Base 1, cuadrante 13: le faltan días de CT de día; uno de sus turnos es de un N/E.
  coche({ matricula: 'E-CTFALTA', cuadranteId: 13, semana: semana(['n', 'b', '', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b']),
    falta: { fijo: { dia: false, noche: false }, ct: { dia: 2, noche: 0 } } }),
  // Base 1, cuadrante 14: nadie… pero con un fijo que LLEGA: ya no es «sin nadie».
  coche({ matricula: 'F-LLEGA', cuadranteId: 14, personas: [plaza('', { futuro: { nombre: 'X', desde: '2026-10-12' } }), plaza(''), plaza(''), plaza(''), plaza(''), plaza('')],
    semana: semana([]), falta: { fijo: { dia: false, noche: true }, ct: { dia: 0, noche: 0 } } }),
  // Base 1, cuadrante 14: nadie de verdad.
  coche({ matricula: 'G-NADIE', cuadranteId: 14, personas: personas([]), semana: semana([]),
    falta: { fijo: { dia: true, noche: true }, ct: { dia: 2, noche: 2 } } }),
  // Base 2 (sin orden): un completo que trabajó y no hizo horas (0 de verdad, no estimado).
  coche({ matricula: 'H-CERO', cuadranteId: 20, semana: todos('z') }),
  // Suelto sin base.
  coche({ matricula: 'I-SUELTO', semana: todos('c') }),
  // Base 3 está apagada: su coche cae en «sin base».
  coche({ matricula: 'J-APAGADA', cuadranteId: 30, semana: todos('c') }),
];
const cuadrantes = [
  { id: '10', numero: 1, zonaId: 1 }, { id: '11', numero: 2, zonaId: 1 }, { id: '12', numero: 3, zonaId: 1 },
  { id: '13', numero: 4, zonaId: 1 }, { id: '14', numero: 5, zonaId: 1 }, { id: '15', numero: 6, zonaId: 1 },
  { id: '20', numero: 7, zonaId: 2 }, { id: '30', numero: 8, zonaId: 3 },
];
const zonas = [{ id: 2, nombre: 'Zeta', orden: null }, { id: 1, nombre: 'Uno', orden: 2 }];   // la 3 no está activa
const huerfanos = [{ matricula: 'D-SINFIJO', zona: '' }, { matricula: 'NO-ESTA', zona: 'zeta' }, { matricula: 'OTRO', zona: '' }];
const planificados = [{ vehiculoId: coches[6].vehiculoId, matricula: 'F-LLEGA', desde: '2026-10-12' }];
const seVan = [{ vehiculoId: coches[0].vehiculoId, matricula: 'A-BUENO', hasta: '2026-10-20' }];

const r = ice.decorar({ coches, cuadrantes, zonas, gente, huerfanos, planificados, seVan,
  plantelDe: lista => ({ fijoDia: lista.length }) });
const de = m => coches.find(c => c.matricula === m).iceberg;
const cu = id => cuadrantes.find(c => c.id === id).iceberg;

console.log('1. El escalón de cada coche');
comprobar('completo', de('A-BUENO').escalon === 'completo');
comprobar('sin fijo de noche → con plazas vacías', de('D-SINFIJO').escalon === 'vacante');
comprobar('le faltan días de CT → con plazas vacías', de('E-CTFALTA').escalon === 'vacante');
comprobar('nadie → sin nadie', de('G-NADIE').escalon === 'vacio');
comprobar('quien está por llegar cuenta como alguien', de('F-LLEGA').escalon === 'vacante', de('F-LLEGA').escalon);
comprobar('el del taller sigue siendo completo (el estado va aparte)', de('C-TALLER').escalon === 'completo');

console.log('\n2. Las horas instaladas');
comprobar('14 turnos de alguien de 10 h = 140 h', de('A-BUENO').horas === 140, de('A-BUENO').horas);
comprobar('el turno sin nadie suma 0', de('D-SINFIJO').horas === 70 && de('D-SINFIJO').huecos === 7, JSON.stringify(de('D-SINFIJO')));
// La mediana de los que tienen dato: 10, 8, 6 y 0 → 7. El N/E cuenta 7 y se dice.
comprobar('el N/E cuenta la mediana de la flota y se marca estimado',
  r.estimada === 7 && de('E-CTFALTA').horas === 7 + 12 * 8 && de('E-CTFALTA').estimados === 1, `${r.estimada} · ${JSON.stringify(de('E-CTFALTA'))}`);
comprobar('quien trabajó y no hizo horas cuenta 0, no la mediana', de('H-CERO').horas === 0 && de('H-CERO').estimados === 0);
comprobar('lo que falta viaja para la pantalla', de('D-SINFIJO').falta.fijoNoche === true && de('D-SINFIJO').falta.ctDiasNoche === 2);

console.log('\n3. El orden de los coches');
const orden = [...coches].sort((a, b) => a.iceberg.orden - b.iceberg.orden).map(c => c.matricula);
const pos = m => orden.indexOf(m);
comprobar('los completos, de más a menos horas', pos('A-BUENO') < pos('A-NORMAL') && pos('B-SOLO') < pos('A-NORMAL'), orden.join(' '));
comprobar('el del taller al fondo de los completos', pos('C-TALLER') > pos('A-NORMAL') && pos('C-TALLER') < pos('D-SINFIJO'), orden.join(' '));
comprobar('luego los de plazas vacías, y al final los de nadie', pos('E-CTFALTA') < pos('G-NADIE') && pos('D-SINFIJO') < pos('G-NADIE'), orden.join(' '));

console.log('\n4. Los cuadrantes');
comprobar('completo si lo están todos sus coches', cu('10').escalon === 'completo');
comprobar('uno con un coche por llegar y otro sin nadie: con plazas vacías', cu('14').escalon === 'vacante', cu('14').escalon);
comprobar('suma y media por coche', cu('10').horas === 252 && cu('10').media === 126, JSON.stringify(cu('10')));
comprobar('se ordena por la MEDIA: el de un coche de 140 h va delante del de dos (252 h)', cu('11').orden < cu('10').orden);
comprobar('el del taller va detrás de los que ruedan', cu('12').orden > cu('10').orden && cu('12').orden < cu('13').orden);
comprobar('el cuadrante sin coches, al final de todo', cu('15').escalon === 'sinCoches'
  && cu('15').orden === Math.max(...cuadrantes.map(c => c.iceberg.orden)));
comprobar('la base del cuadrante de una base apagada es «sin»', cu('30').zona === ice.SIN_BASE);

console.log('\n5. Las bases');
comprobar('en el orden de Tráfico y, sin orden, por nombre al final', r.zonas.map(z => z.nombre).join(',') === 'Uno,Zeta');
comprobar('«Sin base» solo existe si hay coches sin base, y va la última',
  r.porZona.map(z => z.clave).join(',') === '1,2,sin', r.porZona.map(z => z.clave).join(','));
const uno = r.porZona.find(z => z.clave === '1');
comprobar('coches: solo los que ruedan; cochesTotal: todos', uno.coches === 7 && uno.cochesTotal === 8, `${uno.coches} / ${uno.cochesTotal}`);
comprobar('fijos que faltan: solo coches que ruedan', uno.fijosQueFaltanDia === 1 && uno.fijosQueFaltanNoche === 3,
  `${uno.fijosQueFaltanDia}/${uno.fijosQueFaltanNoche}`);
// Días de CT: E-CTFALTA (2 de día, tiene fijo). D-SINFIJO no cuenta de noche
// (le falta el fijo); G-NADIE tampoco (sin fijos). Total 2 de día → 1 CT.
comprobar('días de CT solo en coches con su fijo, a seis por correturnos',
  uno.ctDiasDia === 2 && uno.ctDiasNoche === 0 && uno.ctQueFaltanDia === 1 && uno.ctQueFaltanNoche === 0,
  JSON.stringify({ d: uno.ctDiasDia, n: uno.ctDiasNoche }));
// Completos: A-BUENO, A-NORMAL, B-SOLO y el del taller (el estado va aparte).
comprobar('el iceberg de la base', uno.iceberg.completo === 4 && uno.iceberg.vacante === 3 && uno.iceberg.vacio === 1
  && uno.iceberg.parados === 1, JSON.stringify(uno.iceberg));
comprobar('los días sin cubrir de la semana, de los que ruedan', uno.diasSinCubrirNoche === 7);
comprobar('planificados y se van, por su coche', uno.planificados.length === 1 && uno.seVan.length === 1
  && r.porZona.find(z => z.clave === '2').planificados.length === 0);
comprobar('huérfanos: por la matrícula y, si no, por el nombre de la base',
  uno.huerfanos === 1 && r.porZona.find(z => z.clave === '2').huerfanos === 1 && r.porZona.find(z => z.clave === 'sin').huerfanos === 1);
comprobar('el huérfano queda apuntado con su base', huerfanos[0].zonaClave === '1' && huerfanos[2].zonaClave === 'sin');
comprobar('las cuentas de personas se piden con los coches de la base', uno.fijoDia === 8);
comprobar('la base vacía sale con todo a cero', (() => {
  const v = ice.decorar({ coches: [], cuadrantes: [], zonas: [{ id: 9, nombre: 'Aravaca', orden: 1 }], gente });
  const z = v.porZona[0];
  return v.porZona.length === 1 && z.coches === 0 && z.cuadrantes === 0 && z.iceberg.horas === 0 && z.fijosQueFaltanDia === 0;
})());

console.log(mal ? `\n${mal} MAL` : '\nTodo cuadra');
process.exitCode = mal ? 1 : 0;
