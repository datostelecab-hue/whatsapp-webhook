// ============================================================
// EL LIBRO DE AUDITORÍA (pieza A4 de la hoja de ruta, db/245)
// ============================================================
// Convención 5 de Ignacio: «Cada alta, cambio de estado, aprobación o lectura
// de un aviso guarda quién, qué y cuándo. Nada se borra: se anula, con motivo».
// Se prueba con una tabla inventada que se crea dentro del test (y se deshace
// con él), puesta bajo el libro como lo hará cada módulo nuevo.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const libro = require('../services/libro');

async function tablaVigilada(consulta) {
  await consulta(`
    CREATE TABLE prueba_libro (
      id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      titulo         TEXT,
      estado         TEXT NOT NULL DEFAULT 'pendiente',
      secreto        TEXT,
      usuario_id     INTEGER,
      anulado_at     TIMESTAMPTZ,
      anulado_por    INTEGER,
      anulado_motivo TEXT
    )`);
  await consulta(`SELECT auditoria_vigilar('prueba_libro', 'id', ARRAY['secreto'])`);
}

test('convención 5: un alta firmada guarda quién, qué, cuándo y desde dónde', () => conBase(async ({ fabrica, consulta }) => {
  await tablaVigilada(consulta);
  const u = await fabrica.usuario({ nombre: 'Laura', apellidos: 'De Prueba' });
  const id = await libro.conFirma({ usuarioId: u.id, origen: 'tablero' }, async cli =>
    (await cli.query(`INSERT INTO prueba_libro (titulo) VALUES ('Llamar a la gestoría') RETURNING id`)).rows[0].id);

  const h = await libro.historial('prueba_libro', id);
  assert.equal(h.length, 1);
  assert.equal(h[0].accion, 'alta');
  assert.equal(h[0].etiqueta, 'Alta');
  assert.equal(h[0].quien, 'Laura De Prueba');
  assert.equal(h[0].origen, 'tablero');
  assert.match(h[0].en, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
}));

test('convención 5: un cambio de estado guarda el antes y el después; un cambio que no cambia nada no se apunta', () =>
  conBase(async ({ consulta }) => {
    await tablaVigilada(consulta);
    const id = (await consulta(`INSERT INTO prueba_libro (titulo) VALUES ('Carta') RETURNING id`)).rows[0].id;
    await consulta(`UPDATE prueba_libro SET estado = 'en_curso' WHERE id = $1`, [id]);
    await consulta(`UPDATE prueba_libro SET estado = 'en_curso' WHERE id = $1`, [id]);   // igual: nada

    const h = await libro.historial('prueba_libro', id);
    assert.deepEqual(h.map(x => x.accion), ['alta', 'estado']);
    assert.deepEqual(h[1].cambios, [{ campo: 'estado', antes: 'pendiente', despues: 'en_curso' }]);
  }));

test('convención 5: anular sin firmar se apunta igual, con quien firmó la columna y su motivo', () =>
  conBase(async ({ fabrica, consulta }) => {
    await tablaVigilada(consulta);
    const u = await fabrica.usuario({ nombre: 'Ignacio', apellidos: 'De Prueba' });
    const id = (await consulta(`INSERT INTO prueba_libro (titulo) VALUES ('Multa') RETURNING id`)).rows[0].id;
    await consulta(
      `UPDATE prueba_libro SET anulado_at = now(), anulado_por = $2, anulado_motivo = 'Duplicada' WHERE id = $1`, [id, u.id]);

    const ultima = (await libro.historial('prueba_libro', id)).pop();
    assert.equal(ultima.accion, 'anulacion');
    assert.equal(ultima.quien, 'Ignacio De Prueba');
    assert.equal(ultima.motivo, 'Duplicada');
    assert.equal(ultima.origen, 'sin decir (SQL a mano o migración)');
  }));

test('la acción y el motivo los puede decir el código: una reasignación', () => conBase(async ({ fabrica, consulta }) => {
  await tablaVigilada(consulta);
  const u = await fabrica.usuario();
  const id = (await consulta(`INSERT INTO prueba_libro (titulo, usuario_id) VALUES ('Tarea', 1) RETURNING id`)).rows[0].id;
  await libro.conFirma({ usuarioId: u.id, origen: 'tablero', accion: 'reasignacion', motivo: 'Laura está de vacaciones' }, cli =>
    cli.query(`UPDATE prueba_libro SET usuario_id = 2 WHERE id = $1`, [id]));

  const ultima = (await libro.historial('prueba_libro', id)).pop();
  assert.equal(ultima.accion, 'reasignacion');
  assert.equal(ultima.etiqueta, 'Reasignación');
  assert.equal(ultima.motivo, 'Laura está de vacaciones');
  assert.deepEqual(ultima.cambios, [{ campo: 'usuario_id', antes: 1, despues: 2 }]);
}));

test('las columnas que no se apuntan no llegan al libro, ni sus cambios', () => conBase(async ({ consulta }) => {
  await tablaVigilada(consulta);
  const id = (await consulta(`INSERT INTO prueba_libro (titulo, secreto) VALUES ('X', 'clave') RETURNING id`)).rows[0].id;
  await consulta(`UPDATE prueba_libro SET secreto = 'otra' WHERE id = $1`, [id]);
  const filas = (await consulta(`SELECT antes, despues FROM auditoria WHERE tabla = 'prueba_libro' AND registro = $1`, [String(id)])).rows;
  assert.equal(filas.length, 1, 'cambiar solo lo que no se apunta no deja fila');
  assert.equal('secreto' in filas[0].despues, false);
}));

test('ítem 3: la lectura de un aviso se apunta con quién y cuándo', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario({ nombre: 'Daiane', apellidos: 'De Prueba' });
  await libro.apuntar({ tabla: 'aviso', registro: 77, accion: 'lectura', usuarioId: u.id, origen: 'avisos' });
  const h = await libro.historial('aviso', '77');
  assert.equal(h.length, 1);
  assert.equal(h[0].etiqueta, 'Leído');
  assert.equal(h[0].quien, 'Daiane De Prueba');
}));

test('un apunte sin tabla, sin registro o con una acción rara no se hace', () => conBase(async () => {
  await assert.rejects(libro.apuntar({ registro: 1, accion: 'lectura' }), /de qué tabla/);
  await assert.rejects(libro.apuntar({ tabla: 'aviso', registro: 1, accion: 'Borrar Todo' }), /no válida/);
}));

test('convención 5: el libro no se cambia, no se borra y una tabla vigilada no se vacía', () => conBase(async ({ consulta }) => {
  await tablaVigilada(consulta);
  await consulta(`INSERT INTO prueba_libro (titulo) VALUES ('X')`);
  for (const sql of [`UPDATE auditoria SET motivo = 'otro'`, `DELETE FROM auditoria`, `TRUNCATE auditoria`, `TRUNCATE prueba_libro`]) {
    await consulta('SAVEPOINT intento');
    await assert.rejects(consulta(sql), /no se cambia ni se borra|no se vacía/, sql);
    await consulta('ROLLBACK TO SAVEPOINT intento');
  }
}));

test('auditoria_vigilar se niega si la clave no existe', () => conBase(async ({ consulta }) => {
  await tablaVigilada(consulta);
  await assert.rejects(consulta(`SELECT auditoria_vigilar('prueba_libro', 'no_existe')`), /no tiene la columna/);
}));
