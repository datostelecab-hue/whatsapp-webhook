// ============================================================
// LA FICHA DE ALTA LLEVA LOS DÍAS DE LIBRANZA (25/11/2026)
// ============================================================
// Camilo: «que también estén por ahí los días de libranza que apuntamos al
// darle de alta». Los del patrón vigente, con los días enteros.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diasDeLibranza } = require('../modules/Seleccion/candidaturas.repo');
const { generarFichaPDF } = require('../services/fichaAlta');

test('los días de libranza, escritos enteros', async () => {
  assert.equal(diasDeLibranza([1, 2]), 'Lunes y martes');
  assert.equal(diasDeLibranza([3]), 'Miércoles');
  assert.equal(diasDeLibranza([1, 6, 7]), 'Lunes, sábado y domingo');
  assert.equal(diasDeLibranza([]), '');
  assert.equal(diasDeLibranza(null), '');
  // Y la ficha sale con ellos (y sin ellos, igual).
  const con = await generarFichaPDF({ nombre: 'Ana', libranza: 'Lunes y martes' }, []);
  const sin = await generarFichaPDF({ nombre: 'Ana' }, []);
  assert.equal(Buffer.from(con).slice(0, 5).toString(), '%PDF-');
  assert.equal(Buffer.from(sin).slice(0, 5).toString(), '%PDF-');
});
