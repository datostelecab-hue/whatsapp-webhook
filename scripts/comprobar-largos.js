// ============================================================
// LO QUE CABE EN CADA COLUMNA, DICHO ANTES DE GUARDAR
// ============================================================
// Mercedes, 09/10/2026, rellenando los datos de una candidata en Selección:
// «value too long for type character varying(10)». Era una casilla de la
// dirección (número, escalera, piso, puerta o código postal admiten 10) y
// PostgreSQL no dice cuál. Ahora se comprueba antes de escribir y se dice
// qué casilla, cuánto cabe y qué se ha puesto (services/repo/largos.js).
//
//   node scripts/comprobar-largos.js
//
// No toca la base: los largos y la transacción se sustituyen.
const largos = require('../services/repo/largos');
const db = require('../services/db');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  const tope = new Map([['piso', 10], ['puerta', 10], ['codigo_postal', 10], ['email', 160]]);
  igual('Lo que no cabe, con su tope y su largo',
    largos.sobran({ piso: 'Bajo izquierda', puerta: 'B', codigo_postal: '28045', fecha: '2026-10-09', n: 3 }, tope),
    [{ columna: 'piso', max: 10, largo: 14, valor: 'Bajo izquierda' }]);
  igual('Justo en el tope, cabe', largos.sobran({ codigo_postal: '0123456789' }, tope), []);
  igual('El mensaje nombra la casilla como la ve la pantalla',
    largos.mensaje(largos.sobran({ piso: 'Bajo izquierda', puerta: 'Centro izquierda' }, tope), k => ({ piso: 'Piso', puerta: 'Puerta' })[k]),
    '«Piso» admite como mucho 10 caracteres y «Bajo izquierda» tiene 14: abrévialo · ' +
    '«Puerta» admite como mucho 10 caracteres y «Centro izquierda» tiene 16: abrévialo');

  // Los largos «de la base»: la consulta a information_schema, sustituida.
  const COLUMNAS = { conductor: tope, candidatura: new Map([['tipo_carnet', 10]]) };
  let consultas = 0;
  db.consulta = async (sql, p) => {
    if (/information_schema/.test(sql)) return { rows: [...(COLUMNAS[p[0]] || new Map())].map(([column_name, max]) => ({ column_name, max })) };
    consultas++; return { rows: [], rowCount: 1 };
  };

  // La ficha de la persona: lo dice ANTES de abrir la transacción.
  const con = require('../modules/Conductores/conductores.repo');
  let escribio = false;
  db.transaccion = async () => { escribio = true; return {}; };
  try { await con.actualizar(1, { piso: 'Entreplanta', codigo_postal: '28045' }, { usuarioId: 7 }); igual('Un piso largo se rechaza', 'pasó', 'rechazo'); }
  catch (e) { igual('Un piso largo se rechaza, con su nombre', e.message, '«Piso» admite como mucho 10 caracteres y «Entreplanta» tiene 11: abrévialo'); }
  igual('…sin llegar a escribir', escribio, false);
  await con.actualizar(1, { piso: '3º', puerta: 'B' }, { usuarioId: 7 });
  igual('Si todo cabe, se guarda', escribio, true);

  // El proceso de Selección, igual.
  const cand = require('../modules/Seleccion/candidaturas.repo');
  consultas = 0;
  try { await cand.guardarProceso(5, { tipo_carnet: 'B + BTP + C1' }); igual('Un carné largo se rechaza', 'pasó', 'rechazo'); }
  catch (e) { igual('Un carné largo se rechaza, con su nombre', e.message, '«Tipo de carné» admite como mucho 10 caracteres y «B + BTP + C1» tiene 12: abrévialo'); }
  igual('…sin llegar a escribir', consultas, 0);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
