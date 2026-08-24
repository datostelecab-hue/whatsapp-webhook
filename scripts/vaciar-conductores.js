// ============================================================
// VACIAR LA PLANTILLA para volver a cargarla
// ============================================================
//   node scripts/vaciar-conductores.js          -> solo dice qué borraría
//   node scripts/vaciar-conductores.js --si     -> lo borra de verdad
//
// `cargar-conductores.js` no vacía nada antes de insertar: correrlo dos veces
// deja a todo el mundo duplicado. Mientras se prueba hay que poder repetir la
// carga, y el sábado, si algo sale torcido a mitad, hay que poder empezar de
// nuevo sin recrear la base entera.
//
// Solo toca personas. Los coches, los turnos, las plazas y los catálogos se
// quedan: nada de eso lo carga el script de conductores.
//
// El centinela sobrevive. Es la fila que sostiene las referencias de quien no
// tiene conductor conocido, y borrarla rompe cosas que no tienen que ver con
// esto.

const db = require('../services/db');

// El orden importa. `asignacion.conductor_id` NO borra en cascada, y está bien
// que no lo haga: una asignación es un hecho y no debe evaporarse porque
// alguien borre a una persona. Aquí se quita a mano, y solo aquí.
const PASOS = [
  ['asignacion', `DELETE FROM asignacion a
                   USING conductor c
                   WHERE c.id = a.conductor_id AND NOT c.es_centinela`],
  ['conductor',  `DELETE FROM conductor WHERE NOT es_centinela`],
];

// Lo que se va en cascada detrás de `conductor`. Se cuenta antes para que quede
// dicho en pantalla: nadie debería borrar 400 fichas sin ver el número primero.
// Las ausencias no son una tabla aparte: son estados en `conductor_estado_hist`,
// que ya está en la lista.
const ARRASTRA = ['conductor_alias', 'conductor_externo', 'conductor_telefono',
                  'conductor_periodo_empleo', 'conductor_estado_hist',
                  'conductor_turno_hist', 'patron_libranza', 'documento'];

const n = async (t, donde) => {
  try {
    const r = await db.consulta(`SELECT count(*)::int AS n FROM ${t}` + (donde ? ` WHERE ${donde}` : ''));
    return r.rows[0].n;
  } catch (e) { return null; }   // la tabla puede no existir todavía
};

(async () => {
  const deVerdad = process.argv.includes('--si');

  const personas = await n('conductor', 'NOT es_centinela');
  const centinelas = await n('conductor', 'es_centinela');
  console.log(`\nPLANTILLA: ${personas} persona(s) · ${centinelas} centinela(s), que se quedan\n`);

  console.log('Se borraría también, en cascada:');
  for (const t of [...ARRASTRA, 'asignacion']) {
    const c = await n(t);
    if (c !== null) console.log(`  ${String(c).padStart(6)}  ${t}`);
  }

  if (!personas) { console.log('\nNo hay nada que vaciar.'); return; }

  if (!deVerdad) {
    console.log('\nEsto NO ha borrado nada. Para hacerlo de verdad:');
    console.log('  node scripts/vaciar-conductores.js --si\n');
    return;
  }

  console.log('\nBorrando...');
  await db.consulta('BEGIN');
  try {
    for (const [que, sql] of PASOS) {
      const r = await db.consulta(sql);
      console.log(`  ${String(r.rowCount).padStart(6)}  ${que}`);
    }
    await db.consulta('COMMIT');
  } catch (e) {
    await db.consulta('ROLLBACK');
    throw e;
  }

  console.log(`\nQuedan ${await n('conductor', 'NOT es_centinela')} persona(s).`);
  console.log('Ahora: node scripts/cargar-conductores.js\n');
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
