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
// Una base SIN db/174: la columna de la empresa no existe y PostgreSQL contesta
// 42703 a cualquier consulta que la nombre.
let falta174 = false;
// Lo que «devuelve BOLT» en la prueba de sincronizarDesdeBolt, y las empresas a
// las que se le preguntó.
let padronFalso = new Map();
let flotasPedidas = null;
Modulo._load = function (peticion, padre, esPrincipal) {
  if (peticion === '../../services/bolt' && padre && padre.filename.endsWith('cazamiento.repo.js')) {
    return {
      CONFIG_BOLT: {
        flotas: [{ id: 63530 }, { id: 143626 }],
        flotasOtrasSedes: [{ id: 329430, sede: 'barcelona' }],
      },
      traerDrivers: async flotas => { flotasPedidas = flotas; return padronFalso; },
    };
  }
  if (peticion === '../../services/db' && padre && padre.filename.endsWith('cazamiento.repo.js')) {
    return {
      consulta: async (sql, params) => {
        if (falta174 && /bolt_company_id/.test(sql)) {
          throw Object.assign(new Error('column "bolt_company_id" does not exist'), { code: '42703' });
        }
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
// La intercepción se queda puesta hasta el final: `sincronizarDesdeBolt` pide
// services/bolt al LLAMARLA, no al cargar, y si se quitara aquí la prueba
// preguntaría a la BOLT de verdad.

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
      has_cash_payment: false, rating: 4.93, score: '87', companyId: 143626 },
    { driver_uuid: 'bbb', nombre: 'Luis Pérez', phone: '', email: '', state: 'deactivated' },
    { driver_uuid: 'ccc', nombre: 'Marta Ruiz', phone: '600333444', email: 'm@x.es', state: 'active', companyId: 329430 },
  ];
  const r = await bolt.sincronizar(cuentas);

  const ins = llamadas[0];
  // NUEVE: las cinco del principio, el efectivo, la nota y la puntuación de
  // BOLT, y desde db/174 la empresa en la que se vio la cuenta.
  const [uuids, nombres, tels, emails, estados, efectivos, ratings, scores, empresas] = ins.params;
  comprobar('nueve arreglos', ins.params.length === 9, `llegaron ${ins.params.length}`);
  comprobar('todos con la misma longitud',
    [nombres, tels, emails, estados, efectivos, ratings, scores, empresas].every(a => a.length === uuids.length),
    `uuids=${uuids.length} nombres=${nombres.length} tels=${tels.length} emails=${emails.length} estados=${estados.length} ` +
    `efectivos=${efectivos.length} ratings=${ratings.length} scores=${scores.length} empresas=${empresas.length}`);
  comprobar('la empresa de cada cuenta; la que no la trae, null',
    empresas[0] === 143626 && empresas[1] === null && empresas[2] === 329430, JSON.stringify(empresas));
  comprobar('la empresa se guarda y, si no viene, se conserva la de antes',
    /bolt_company_id\s*=\s*COALESCE\(EXCLUDED\.bolt_company_id, conductor_externo\.bolt_company_id\)/.test(ins.sql));
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

  console.log('\n5. Madrid y Barcelona, en la misma vuelta');
  // Si Barcelona fuera en otra vuelta, el marcado de desaparecidas de cada una
  // se comería las cuentas activas de la otra.
  padronFalso = new Map([
    ['mad1', { driver_uuid: 'mad1', nombre: 'De Madrid', state: 'active', companyId: 143626 }],
    ['bcn1', { driver_uuid: 'bcn1', nombre: 'De Barcelona', state: 'active', companyId: 329430 }],
  ]);
  llamadas.length = 0;
  const juntas = await bolt.sincronizarDesdeBolt();
  comprobar('se pregunta a las de Madrid y a la de Barcelona',
    JSON.stringify((flotasPedidas || []).map(f => f.id)) === '[63530,143626,329430]',
    JSON.stringify(flotasPedidas));
  const desap = llamadas.find(l => /'no_vista'/.test(l.sql));
  comprobar('el marcado de desaparecidas conoce las dos',
    desap && desap.params[0].includes('mad1') && desap.params[0].includes('bcn1'),
    desap && JSON.stringify(desap.params[0]));
  comprobar('cuenta las de otras sedes', juntas.otrasSedes === 1, JSON.stringify(juntas));

  console.log('\n6. Sin db/174, como antes');
  // Entre desplegar y aplicar la migración: no hay dónde guardar la empresa, y
  // una cuenta de Barcelona sin empresa se vería como libre en Madrid.
  falta174 = true;
  llamadas.length = 0;
  const sin = await bolt.sincronizarDesdeBolt();
  falta174 = false;
  const ins6 = llamadas[0];
  comprobar('no falla: reintenta sin la columna', Boolean(ins6) && !/bolt_company_id/.test(ins6.sql),
    ins6 && ins6.sql.slice(0, 80));
  comprobar('ocho arreglos, como antes', ins6 && ins6.params.length === 8, ins6 && `llegaron ${ins6.params.length}`);
  comprobar('las de Barcelona no se guardan', ins6 && JSON.stringify(ins6.params[0]) === '["mad1"]',
    ins6 && JSON.stringify(ins6.params[0]));
  comprobar('y no se cuentan como guardadas', sin.otrasSedes === 0, JSON.stringify(sin));

  Modulo._load = cargarOriginal;
  console.log(`\n${ok} bien · ${mal} mal`);
  process.exitCode = mal ? 1 : 0;
})();
