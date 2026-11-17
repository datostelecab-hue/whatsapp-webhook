// ============================================================
// EL LIBRO DE AUDITORÍA (pieza A4 de la hoja de ruta, db/245)
// ============================================================
// Convención 5 de Ignacio: «Cada alta, cambio de estado, aprobación o lectura
// de un aviso guarda quién, qué y cuándo. Nada se borra: se anula, con motivo».
// Se prueba con tablas inventadas que se crean dentro del test (y se deshacen
// con él), puestas bajo el libro como lo hará cada módulo nuevo.
'use strict';

const { conBase, URL_PRUEBAS } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const db = require('../services/db');
const libro = require('../services/libro');

async function tablaVigilada(consulta) {
  await consulta(`
    CREATE TABLE prueba_libro (
      id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      titulo         TEXT,
      estado         TEXT NOT NULL DEFAULT 'pendiente',
      pass_hash      TEXT,
      responsable_id INTEGER,
      usuario_id     INTEGER,
      creado_por     INTEGER,
      anulado_at     TIMESTAMPTZ,
      anulado_por    INTEGER,
      anulado_motivo TEXT
    )`);
  await consulta(`SELECT auditoria_vigilar('prueba_libro', 'id', ARRAY['pass_hash'])`);
}

const alta = async (consulta, campos = {}) => {
  const k = Object.keys(campos);
  const sql = k.length
    ? `INSERT INTO prueba_libro (${k.join(', ')}) VALUES (${k.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`
    : `INSERT INTO prueba_libro DEFAULT VALUES RETURNING id`;
  return String((await consulta(sql, Object.values(campos))).rows[0].id);
};

test('convención 5: un alta firmada guarda quién, qué, cuándo y desde dónde', () => conBase(async ({ fabrica, consulta }) => {
  await tablaVigilada(consulta);
  const u = await fabrica.usuario({ nombre: 'Laura', apellidos: 'De Prueba' });
  const id = await libro.conFirma({ usuarioId: u.id, origen: 'tablero' }, async cli =>
    String((await cli.query(`INSERT INTO prueba_libro (titulo) VALUES ('Llamar a la gestoría') RETURNING id`)).rows[0].id));

  const h = await libro.historial('prueba_libro', id);
  assert.equal(h.length, 1);
  assert.equal(h[0].accion, 'alta');
  assert.equal(h[0].quien, 'Laura De Prueba');
  assert.equal(h[0].origen, 'tablero');
  assert.match(h[0].en, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
}));

test('convención 5: un cambio de estado guarda el antes y el después; un cambio que no cambia nada no se apunta', () =>
  conBase(async ({ consulta }) => {
    await tablaVigilada(consulta);
    const id = await alta(consulta, { titulo: 'Carta' });
    await consulta(`UPDATE prueba_libro SET estado = 'en_curso' WHERE id = $1`, [id]);
    await consulta(`UPDATE prueba_libro SET estado = 'en_curso' WHERE id = $1`, [id]);   // igual: nada

    const h = await libro.historial('prueba_libro', id);
    assert.deepEqual(h.map(x => x.accion), ['alta', 'estado']);
    assert.deepEqual(h[1].cambios, [{ campo: 'estado', antes: 'pendiente', despues: 'en_curso' }]);
  }));

test('sin firma, el autor de un alta es creado_por y nunca usuario_id (que puede ser el destinatario)', () =>
  conBase(async ({ fabrica, consulta }) => {
    await tablaVigilada(consulta);
    const quienCrea = await fabrica.usuario({ nombre: 'Creadora', apellidos: 'De Prueba' });
    const destinataria = await fabrica.usuario({ nombre: 'Destinataria', apellidos: 'De Prueba' });
    const id1 = await alta(consulta, { usuario_id: destinataria.id, creado_por: quienCrea.id });
    const id2 = await alta(consulta, { usuario_id: destinataria.id });
    assert.equal((await libro.historial('prueba_libro', id1))[0].quien, 'Creadora De Prueba');
    assert.equal((await libro.historial('prueba_libro', id2))[0].quien, null, 'sin creado_por no se inventa un autor');
  }));

test('firmado un origen sin usuario (una tarea programada), el autor queda vacío: lo hizo el sistema', () =>
  conBase(async ({ fabrica, consulta }) => {
    await tablaVigilada(consulta);
    const otra = await fabrica.usuario();
    const id = await libro.conFirma({ origen: 'tareas-programadas' }, async cli =>
      String((await cli.query(`INSERT INTO prueba_libro (creado_por) VALUES ($1) RETURNING id`, [otra.id])).rows[0].id));
    const h = await libro.historial('prueba_libro', id);
    assert.equal(h[0].quien, null);
    assert.equal(h[0].origen, 'tareas-programadas');
  }));

test('convención 5: anular sin firmar se apunta igual, con quien firmó la columna y su motivo', () =>
  conBase(async ({ fabrica, consulta }) => {
    await tablaVigilada(consulta);
    const u = await fabrica.usuario({ nombre: 'Ignacio', apellidos: 'De Prueba' });
    const id = await alta(consulta, { titulo: 'Multa' });
    await consulta(
      `UPDATE prueba_libro SET anulado_at = now(), anulado_por = $2, anulado_motivo = 'Duplicada' WHERE id = $1`, [id, u.id]);

    const ultima = (await libro.historial('prueba_libro', id)).pop();
    assert.equal(ultima.accion, 'anulacion');
    assert.equal(ultima.quien, 'Ignacio De Prueba');
    assert.equal(ultima.motivo, 'Duplicada');
    assert.equal(ultima.origen, 'sin decir (SQL a mano o migración)');
  }));

test('la acción y el motivo firmados valen para los cambios; un alta y un borrado de la misma transacción siguen siéndolo', () =>
  conBase(async ({ fabrica, consulta }) => {
    await tablaVigilada(consulta);
    const u = await fabrica.usuario();
    const id = await alta(consulta, { titulo: 'Tarea', responsable_id: 1 });
    const otra = await alta(consulta, { titulo: 'Para borrar' });
    let nueva;
    await libro.conFirma({ usuarioId: u.id, origen: 'tablero', accion: 'reasignacion', motivo: 'Laura está de vacaciones' }, async cli => {
      await cli.query(`UPDATE prueba_libro SET responsable_id = 2 WHERE id = $1`, [id]);
      nueva = String((await cli.query(`INSERT INTO prueba_libro (titulo) VALUES ('Aviso al nuevo') RETURNING id`)).rows[0].id);
      await cli.query(`DELETE FROM prueba_libro WHERE id = $1`, [otra]);
    });

    const cambio = (await libro.historial('prueba_libro', id)).pop();
    assert.equal(cambio.accion, 'reasignacion');
    assert.equal(cambio.motivo, 'Laura está de vacaciones');
    assert.deepEqual(cambio.cambios, [{ campo: 'responsable_id', antes: 1, despues: 2 }]);
    const deLaNueva = await libro.historial('prueba_libro', nueva);
    assert.equal(deLaNueva[0].accion, 'alta');
    assert.equal(deLaNueva[0].motivo, null, 'el motivo de la reasignación no es el del alta');
    assert.equal((await libro.historial('prueba_libro', otra)).pop().accion, 'borrado');
  }));

test('la firma no pasa a la transacción siguiente (como en producción)', () => conBase(async ({ fabrica, consulta }) => {
  await tablaVigilada(consulta);
  const u = await fabrica.usuario();
  await db.transaccion(cli => libro.firmar(cli, { usuarioId: u.id, origen: 'pantalla' }));
  const id = await db.transaccion(async cli =>
    String((await cli.query(`INSERT INTO prueba_libro (titulo) VALUES ('sin firmar') RETURNING id`)).rows[0].id));
  assert.equal((await libro.historial('prueba_libro', id))[0].origen, 'sin decir (SQL a mano o migración)');
}));

test('firmar fuera de una transacción no se queda callado', async () => {
  const suelto = new Client({ connectionString: URL_PRUEBAS });
  await suelto.connect();
  try {
    await assert.rejects(libro.firmar(suelto, { usuarioId: 1, origen: 'pantalla' }), /va dentro de una transacción/);
  } finally {
    await suelto.end();
  }
});

test('las columnas que no se apuntan no llegan al libro, ni sus cambios', () => conBase(async ({ consulta }) => {
  await tablaVigilada(consulta);
  const id = await alta(consulta, { titulo: 'X', pass_hash: 'clave' });
  await consulta(`UPDATE prueba_libro SET pass_hash = 'otra' WHERE id = $1`, [id]);
  const filas = (await consulta(`SELECT despues FROM auditoria WHERE tabla = 'prueba_libro' AND registro = $1`, [id])).rows;
  assert.equal(filas.length, 1, 'cambiar solo lo que no se apunta no deja fila');
  assert.equal('pass_hash' in filas[0].despues, false);
}));

test('auditoria_vigilar no deja pasar lo que se quedaría mal para siempre en el libro', () => conBase(async ({ consulta }) => {
  await consulta(`CREATE TABLE prueba_mal (id BIGINT PRIMARY KEY, pass_hash TEXT, token_reset TEXT, dia DATE, momento TIMESTAMPTZ UNIQUE)`);
  const intento = async (sql, error) => {
    await consulta('SAVEPOINT intento');
    await assert.rejects(consulta(sql), error, sql);
    await consulta('ROLLBACK TO SAVEPOINT intento');
  };
  await intento(`SELECT auditoria_vigilar('prueba_mal', 'id', ARRAY['pass_has', 'token_reset'])`, /no tiene estas columnas.*pass_has/);
  await intento(`SELECT auditoria_vigilar('prueba_mal', 'id', ARRAY['pass_hash'])`, /nombre de secreto.*token_reset/);
  await intento(`SELECT auditoria_vigilar('prueba_mal', 'dia', ARRAY['pass_hash', 'token_reset'])`, /no es única/);
  await intento(`SELECT auditoria_vigilar('prueba_mal', 'momento', ARRAY['pass_hash', 'token_reset'])`, /fecha con hora/);
  await intento(`SELECT auditoria_vigilar('prueba_mal', 'no_existe')`, /no tiene la columna/);
  await consulta(`SELECT auditoria_vigilar('prueba_mal', 'id', ARRAY['pass_hash', 'token_reset'])`);   // así sí
}));

test('si un cambio mueve la clave, la historia de la clave vieja también lo cuenta', () => conBase(async ({ consulta }) => {
  await consulta(`CREATE TABLE prueba_clave (codigo TEXT PRIMARY KEY, nombre TEXT)`);
  await consulta(`SELECT auditoria_vigilar('prueba_clave', 'codigo')`);
  const larga = 'X'.repeat(120);   // una clave larga no tumba la escritura
  await consulta(`INSERT INTO prueba_clave VALUES ($1, 'uno')`, [larga]);
  await consulta(`UPDATE prueba_clave SET codigo = 'NUEVA' WHERE codigo = $1`, [larga]);
  assert.deepEqual((await libro.historial('prueba_clave', larga)).map(x => x.accion), ['alta', 'cambio']);
  assert.deepEqual((await libro.historial('prueba_clave', 'NUEVA')).map(x => x.accion), ['cambio']);
}));

test('ítem 3: la lectura de un aviso se apunta con quién y cuándo', () => conBase(async ({ fabrica }) => {
  const u = await fabrica.usuario({ nombre: 'Daiane', apellidos: 'De Prueba' });
  await libro.apuntar({ tabla: 'aviso', registro: 77, accion: 'lectura', usuarioId: u.id, origen: 'avisos' });
  const h = await libro.historial('aviso', '77');
  assert.equal(h.length, 1);
  assert.equal(h[0].etiqueta, 'Leído');
  assert.equal(h[0].quien, 'Daiane De Prueba');
}));

test('las fechas: un registro no puede ser un Date, y una fecha del detalle se guarda como su día', () => conBase(async ({ consulta }) => {
  await assert.rejects(libro.historial('aviso', new Date(2026, 10, 9)), /aaaa-mm-dd/);
  await assert.rejects(libro.apuntar({ tabla: 'aviso', registro: new Date(2026, 10, 9), accion: 'lectura' }), /aaaa-mm-dd/);
  const id = await libro.apuntar({ tabla: 'aviso', registro: 'x', accion: 'lectura', detalle: { dia: new Date(2026, 10, 9) } });
  const d = (await consulta('SELECT detalle FROM auditoria WHERE id = $1', [id])).rows[0].detalle;
  assert.equal(d.dia, '2026-11-09', 'el 9 de noviembre, no el 8 a las 23:00 de UTC');
}));

test('un apunte sin tabla, sin registro o con una acción rara no se hace', () => conBase(async () => {
  await assert.rejects(libro.apuntar({ registro: 1, accion: 'lectura' }), /de qué tabla/);
  await assert.rejects(libro.apuntar({ tabla: 'aviso', accion: 'lectura' }), /Falta cuál/);
  await assert.rejects(libro.apuntar({ tabla: 'aviso', registro: 1, accion: 'Borrar Todo' }), /no válida/);
}));

test('el origen firmado cabe en el libro de las J (40 letras)', () => conBase(async ({ consulta }) => {
  await tablaVigilada(consulta);
  const id = await libro.conFirma({ origen: 'o'.repeat(60) }, async cli =>
    String((await cli.query(`INSERT INTO prueba_libro DEFAULT VALUES RETURNING id`)).rows[0].id));
  assert.equal((await libro.historial('prueba_libro', id))[0].origen.length, 40);
}));

test('convención 5: el libro no se cambia, no se borra y una tabla vigilada no se vacía', () => conBase(async ({ consulta }) => {
  await tablaVigilada(consulta);
  await alta(consulta, { titulo: 'X' });
  for (const sql of [`UPDATE auditoria SET motivo = 'otro'`, `DELETE FROM auditoria`, `TRUNCATE auditoria`, `TRUNCATE prueba_libro`]) {
    await consulta('SAVEPOINT intento');
    await assert.rejects(consulta(sql), /no se cambia ni se borra|no se vacía/, sql);
    await consulta('ROLLBACK TO SAVEPOINT intento');
  }
}));
