// ============================================================
// PRUEBAS DEL CAZAMIENTO CON BOLT (sin base de datos)
// ============================================================
//   node scripts/probar-bolt.js
//
// Se sustituye la capa de base por una que solo APUNTA la consulta y sus
// parámetros. Eso NO comprueba que el SQL sea correcto —para eso hay que
// ejecutarlo— pero sí lo que es lógica de JavaScript y donde de verdad se
// equivoca uno: que los cinco arreglos que se mandan a `unnest` tengan la misma
// longitud y el mismo orden.
//
// Si se descuadran, el teléfono de una persona acaba en la cuenta de otra y no
// hay error: solo datos mal.

const path = require('path');
const Modulo = require('module');

// Se intercepta su `require('../../services/db')` ANTES de cargarlo. Desde la
// Fase 2 el cazamiento vive en modules/Conductores/cazamiento.repo.js; antes era
// services/cazamientoBolt.js y pedía './db' (01/10/2026: la prueba se había
// quedado interceptando al puente y caía en la base de verdad).
const cargarOriginal = Modulo._load;
const llamadas = [];
Modulo._load = function (peticion, padre, esPrincipal) {
  if (peticion === '../../services/db' && padre && padre.filename.endsWith('cazamiento.repo.js')) {
    return {
      consulta: async (sql, params) => {
        llamadas.push({ sql, params });
        // Lo justo para que el servicio siga: la primera consulta devuelve los
        // contadores, la segunda (el UPDATE) devuelve filas afectadas.
        if (/UPDATE conductor_externo SET estado_externo = 'no_vista'/.test(sql)) {
          return { rows: [], rowCount: 2 };
        }
        return { rows: [{ nuevas: 3, cambiadas: 1 }], rowCount: 1 };
      },
      transaccion: async fn => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    };
  }
  return cargarOriginal.apply(this, arguments);
};

const bolt = require(path.join(__dirname, '..', 'modules', 'Conductores', 'cazamiento.repo.js'));
Modulo._load = cargarOriginal;

let ok = 0, mal = 0;
const comprobar = (que, cond, detalle) => {
  if (cond) { ok++; console.log(`  ok  ${que}`); }
  else { mal++; console.log(`  NO  ${que}${detalle ? '  → ' + detalle : ''}`); }
};

(async () => {
  console.log('\n1. Los arreglos que van a unnest');
  llamadas.length = 0;
  const cuentas = [
    { driver_uuid: 'aaa', nombre: 'Ana García', phone: '+34600111222', email: 'ana@x.es', state: 'ACTIVE',
      has_cash_payment: false, rating: 4.93, score: '87' },
    { driver_uuid: 'bbb', nombre: 'Luis Pérez', phone: '', email: '', state: 'deactivated' },
    { driver_uuid: 'ccc', nombre: 'Marta Ruiz', phone: '600333444', email: 'm@x.es', state: 'active' },
  ];
  const r = await bolt.sincronizar(cuentas);

  const ins = llamadas[0];
  // OCHO desde que se guardan el efectivo, la nota y la puntuación de BOLT (las
  // cinco del principio más esas tres). La prueba esperaba cinco y se quedó atrás.
  const [uuids, nombres, tels, emails, estados, efectivos, ratings, scores] = ins.params;
  comprobar('ocho arreglos', ins.params.length === 8, `llegaron ${ins.params.length}`);
  comprobar('todos con la misma longitud',
    [nombres, tels, emails, estados, efectivos, ratings, scores].every(a => a.length === uuids.length),
    `uuids=${uuids.length} nombres=${nombres.length} tels=${tels.length} emails=${emails.length} estados=${estados.length} ` +
    `efectivos=${efectivos.length} ratings=${ratings.length} scores=${scores.length}`);
  comprobar('el efectivo: false es un dato y lo que no viene es un hueco (null)',
    efectivos[0] === false && efectivos[1] === null, JSON.stringify(efectivos));
  comprobar('la nota y la puntuación, como número; lo que no viene, null',
    ratings[0] === 4.93 && scores[0] === 87 && ratings[1] === null && scores[2] === null,
    JSON.stringify({ ratings, scores }));
  comprobar('el orden se conserva', uuids.join(',') === 'aaa,bbb,ccc', uuids.join(','));
  comprobar('cada dato con su cuenta',
    nombres[0] === 'Ana García' && tels[0] === '+34600111222' && tels[2] === '600333444',
    JSON.stringify({ nombres, tels }));
  comprobar('el vacío va como NULL, no como cadena', tels[1] === null && emails[1] === null,
    JSON.stringify({ tel: tels[1], email: emails[1] }));
  comprobar('el estado en minúsculas', estados[0] === 'active', estados[0]);
  comprobar('devuelve el recuento', r.vistas === 3 && r.nuevas === 3 && r.cambiadas === 1, JSON.stringify(r));

  console.log('\n2. EXCLUDED solo dentro del DO UPDATE');
  const trasReturning = ins.sql.slice(ins.sql.indexOf('RETURNING'));
  comprobar('no se usa EXCLUDED en el RETURNING', !/EXCLUDED/i.test(trasReturning),
    'PostgreSQL lo rechaza con "invalid reference to FROM-clause entry"');
  comprobar('sí se usa en el DO UPDATE',
    /DO UPDATE SET[\s\S]*EXCLUDED/i.test(ins.sql.slice(0, ins.sql.indexOf('RETURNING'))));

  console.log('\n3. Cuentas repetidas');
  llamadas.length = 0;
  // Si BOLT devolviera la misma dos veces, el ON CONFLICT fallaría con
  // "cannot affect row a second time".
  await bolt.sincronizar([
    { driver_uuid: 'aaa', nombre: 'Primera', state: 'active' },
    { driver_uuid: 'aaa', nombre: 'Segunda', state: 'active' },
  ]);
  const u2 = llamadas[0].params[0];
  comprobar('se manda una sola vez', u2.length === 1, `se mandaron ${u2.length}`);
  comprobar('gana la última', llamadas[0].params[1][0] === 'Segunda', llamadas[0].params[1][0]);

  console.log('\n4. Sin cuentas no se toca nada');
  llamadas.length = 0;
  const vacio = await bolt.sincronizar([]);
  comprobar('no se lanza ninguna consulta', llamadas.length === 0, `se lanzaron ${llamadas.length}`);
  comprobar('devuelve ceros', vacio.vistas === 0 && vacio.desaparecidas === 0, JSON.stringify(vacio));

  // Con cuentas sin uuid tampoco: marcarlas todas como desaparecidas borraría
  // el inventario entero.
  llamadas.length = 0;
  const sinUuid = await bolt.sincronizar([{ nombre: 'Sin uuid', state: 'active' }]);
  comprobar('una cuenta sin uuid no dispara el marcado de desaparecidas',
    llamadas.length === 0 && sinUuid.vistas === 0, `consultas=${llamadas.length}`);

  console.log(`\n${ok} bien · ${mal} mal`);
  process.exitCode = mal ? 1 : 0;
})();
