// ============================================================
// LOS COCHES DE UN CUADRANTE, POR LA LIBRANZA DE SUS FIJOS (23/11/2026)
// ============================================================
// «Si ambos libran por ejemplo L M, esos serán los primeros, luego los que
// libran X J y así sucesivamente». Madrid y Barcelona, la pantalla y el Excel.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compararDias, porLibranza } = require('../services/ordenLibranza');

test('L M antes que M X, M X antes que X J; sin libranza, al final', () => {
  const lista = [[3, 4], [], [1, 2], [2, 3], [5, 6], [1, 2, 3]].sort(compararDias);
  assert.deepEqual(lista, [[1, 2], [1, 2, 3], [2, 3], [3, 4], [5, 6], []]);
});

test('por el fijo de día; si empata, el de noche; y luego la matrícula', () => {
  const coche = (matricula, dia, noche) => ({ matricula, dia, noche });
  const orden = [coche('3333CCC', [5, 6], [3, 4]), coche('2222BBB', [1, 2], [1, 2]), coche('1111AAA', [1, 2], [1, 2]),
    coche('4444DDD', [5, 6], [1, 2])].sort(porLibranza(c => ({ dia: c.dia, noche: c.noche }))).map(c => c.matricula);
  assert.deepEqual(orden, ['1111AAA', '2222BBB', '4444DDD', '3333CCC']);
});
