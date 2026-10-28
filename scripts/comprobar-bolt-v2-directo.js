// ============================================================
// EL DIRECTO CON LA API v2 DE BOLT — las reglas
// ============================================================
//   node scripts/comprobar-bolt-v2-directo.js
//
// `getOnlineDrivers` (v2) decide desde el 28/10/2026 quién está conectado
// ahora en el mapa, En directo de Control e Inicio. Ver
// services/flotaViva/enLinea.js (la lista en memoria), services/flotaViva/
// ahora.js (la foto del ahora con la lista o, sin ella, con la base) y
// services/inicio.js (conectadosPorTurno).
//
// No llama a BOLT ni toca ninguna base: BOLT y las consultas se sustituyen.
process.env.BOLT_V2_FRESCA_MS = '300';
process.env.BOLT_V2_TIMEOUT_MS = '200';
// En producción solo se pregunta por la 143626; aquí dos, para probar qué pasa
// cuando una de ellas falla.
process.env.BOLT_V2_EMPRESAS = '63530,143626';
const path = require('path');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const espera = ms => new Promise(r => setTimeout(r, ms));
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

// El cliente de verdad, para probar cómo lee las respuestas de BOLT (sección 7).
// Se carga ANTES de sustituirlo por el doble que usa todo lo demás.
const boltReal = require('../services/bolt');
delete require.cache[require.resolve('../services/bolt')];

// ── Los dobles ──────────────────────────────────────────────────────────────
let credenciales = false;
let respuestas = {};          // empresa → lista de conductores o un Error
let llamadas = 0;
sustituir('services/bolt.js', {
  CONFIG_BOLT: { flotas: [{ id: 63530 }, { id: 143626 }] },
  fetchAllPaginated: async () => [],
  v2Configurada: () => credenciales,
  onlineDriversV2: async id => {
    llamadas++;
    const r = respuestas[id];
    if (r instanceof Error) throw r;
    return r || [];
  },
});
sustituir('services/mapon.js', {});

const conductor = (uuid, code, changed, veh, mat, extra) => ({
  uuid, first_name: 'Nombre', last_name: uuid.toUpperCase(), phone: '+34600' + uuid.length,
  current_state: { code, changed_at: changed },
  vehicle: veh ? { uuid: veh, registration_number: mat, normalised_registration_number: mat } : undefined,
  ...(extra || {}),
});

// La base de la foto del ahora: el catálogo, los tramos y (plan B) lo de antes.
const CATALOGO = [
  { codigo: 'viaje', etiqueta: 'En viaje', color: 'green', conectado: true, orden: 1 },
  { codigo: 'espera', etiqueta: 'En espera', color: 'gold', conectado: true, orden: 2 },
  { codigo: 'descanso', etiqueta: 'En descanso', color: 'warn', conectado: true, orden: 3 },
  { codigo: 'desconectado', etiqueta: 'Desconectado', color: 'muted', conectado: false, orden: 4 },
  { codigo: 'otro', etiqueta: 'Sin clasificar', color: 'red', conectado: true, orden: 9 },
];
const tramo = (veh, mat, situacion, conductorUuid, desde, km) => ({
  vehiculo_uuid: veh, matricula: mat, mapon_unit: null, tramo_id: veh + '-t', situacion,
  situacion_etiqueta: (CATALOGO.find(c => c.codigo === situacion) || {}).etiqueta, conectado: situacion !== 'desconectado',
  color: 'x', situacion_orden: 1, estado_bolt: 'x', desde, segundos: 1, conductor_uuid: conductorUuid,
  conductor: 'Casa ' + conductorUuid, telefono: 'tel-casa', km, v_uuid: veh, v_matricula: mat, v_unit: null, vigilado: true,
});
const TRAMOS = [
  tramo('vA', '1111AAA', 'espera', 'd1', '2026-10-28T09:00:00Z', 12.5),
  tramo('vB', '2222BBB', 'viaje', 'd2', '2026-10-28T09:10:00Z', 3),
  tramo('vC', '3333CCC', 'desconectado', 'd3', '2026-10-28T07:00:00Z', 0),
  { v_uuid: 'vD', v_matricula: '4444DDD', v_unit: 7, vigilado: false },
];
const consultas = [];
sustituir('services/flotaViva/db.js', {
  consulta: async sql => {
    consultas.push(sql);
    if (/fv_cat_situacion\s*$/.test(sql.trim()) || /FROM fv_cat_situacion/.test(sql) && !/JOIN/.test(sql)) return { rows: CATALOGO };
    if (/LATERAL/.test(sql)) return { rows: TRAMOS.map(t => ({ ...t, situacion_cruda: null })) };   // plan B: coches
    if (/DISTINCT ON \(l\.driver_uuid\)/.test(sql)) return { rows: [] };                           // plan B: conductores
    if (/LEFT JOIN fv_ahora/.test(sql)) return { rows: TRAMOS };                                   // con la v2
    throw new Error('consulta inesperada: ' + sql.slice(0, 60));
  },
});

const enLinea = require('../services/flotaViva/enLinea');
const ahora = require('../services/flotaViva/ahora');

(async () => {
  // ── 1. Traducir la v2 ─────────────────────────────────────────────────────
  const t = enLinea.traducir(conductor('d1', 'on_ride', '2026-10-28T10:05:00+01:00', 'vA', '1111AAA'));
  igual('on_ride es viaje', t.situacion, 'viaje');
  igual('waiting es espera', enLinea.traducir(conductor('x', 'waiting', null)).situacion, 'espera');
  igual('on_break es descanso', enLinea.traducir(conductor('x', 'on_break', null)).situacion, 'descanso');
  igual('Un estado nuevo de BOLT sale como «otro», no se pierde', enLinea.traducir(conductor('x', 'algo_nuevo', null)).situacion, 'otro');
  igual('El desde es el changed_at', t.desde.toISOString(), '2026-10-28T09:05:00.000Z');
  igual('El coche, por uuid y matrícula', [t.vehiculoUuid, t.matricula], ['vA', '1111AAA']);

  // ── 2. La lista en memoria ────────────────────────────────────────────────
  igual('Sin credenciales no pregunta a BOLT', await enLinea.refrescar(), null);
  igual('…ni hay lista', enLinea.vigente(), null);
  igual('…ni llamadas', llamadas, 0);

  credenciales = true;
  respuestas = { 143626: [conductor('d1', 'on_ride', '2026-10-28T10:05:00+01:00', 'vA', '1111AAA')], 63530: new Error('caída') };
  let r = await enLinea.refrescar();
  igual('Con una empresa que nunca ha contestado, la lista NO vale (desconectaría a los suyos)', enLinea.vigente(), null);
  igual('…aunque la otra sí contestó', r.ok, 1);

  respuestas = {
    143626: [
      conductor('d1', 'on_ride', '2026-10-28T10:05:00+01:00', 'vA', '1111AAA'),
      conductor('d2', 'waiting', '2026-10-28T10:10:00+01:00', 'vB', '2222BBB'),
      conductor('d5', 'waiting', '2026-10-28T10:20:00+01:00', 'vE', '5555EEE'),
    ],
    63530: [],
  };
  r = await enLinea.refrescar();
  igual('Con las dos, vale', !!enLinea.vigente(), true);
  igual('…y es un cambio (hay que rehacer la foto)', r.cambio, true);
  r = await enLinea.refrescar();
  igual('Lo mismo otra vez no es un cambio', r.cambio, false);
  igual('Tres conectados', enLinea.vigente().porUuid.size, 3);

  // d2 se desconecta: desaparece de la lista.
  respuestas[143626] = respuestas[143626].filter(c => c.uuid !== 'd2');
  r = await enLinea.refrescar();
  igual('Que alguien se desconecte es un cambio', r.cambio, true);

  // ── 3. La foto del ahora con la v2 ────────────────────────────────────────
  ahora.invalidar('prueba');
  let f = await ahora.foto();
  igual('La foto sale de la v2', f.fuente, 'v2');
  igual('…sin la consulta cara del último apunte', consultas.some(s => /LATERAL/.test(s)), false);
  const A = f.porMatricula.get('1111AAA');
  igual('Coche en la lista: la situación de BOLT gana al tramo', [A.situacion, A.fuente_ahora, A.conectado], ['viaje', 'v2', true]);
  igual('…con su desde', new Date(A.desde).toISOString(), '2026-10-28T09:05:00.000Z');
  igual('…y los km del tramo, que la v2 no sabe', A.km, 12.5);
  igual('…y el nombre de la casa si es la misma persona', A.conductor, 'Casa d1');
  const B = f.porMatricula.get('2222BBB');
  igual('Coche fuera de la lista con el tramo «en viaje»: desconectado', [B.situacion, B.conectado, B.fuente_ahora], ['desconectado', false, 'v2']);
  igual('…desde la última vez que la v2 lo vio, no sin hora', !!B.desde, true);
  igual('…y quien lo llevaba sigue ahí, para explicar un rojo', B.conductor_uuid, 'd2');
  const C = f.porMatricula.get('3333CCC');
  igual('Coche con el tramo ya desconectado: se queda el tramo', [C.situacion, C.fuente_ahora, C.desde], ['desconectado', 'tramo', '2026-10-28T07:00:00Z']);
  const D = f.porMatricula.get('4444DDD');
  igual('Coche no vigilado y nunca visto: no sabemos nada, como antes', D.situacion || null, null);
  igual('…y se encuentra por su unidad de Mapon', f.porUnidad.get(7) === D, true);
  const E = f.porMatricula.get('5555EEE');
  igual('Coche conectado que aún no está en el padrón: el mapa lo encuentra', E && E.situacion, 'espera');
  igual('Por conductor: el de la lista, conectado', [f.porConductor.get('d1').situacion, f.porConductor.get('d1').conectado], ['viaje', true]);
  igual('…el que se fue, desconectado', [f.porConductor.get('d2').situacion, f.porConductor.get('d2').conectado], ['desconectado', false]);
  igual('…el del tramo desconectado, del tramo', f.porConductor.get('d3').fuente, 'tramo');
  igual('…y la matrícula del coche de la casa', f.porConductor.get('d1').matricula, '1111AAA');

  // ── 4. Sin lista válida, el plan B ────────────────────────────────────────
  respuestas[63530] = new Error('caída otra vez');
  await enLinea.refrescar();
  igual('Una empresa que falla un rato: la lista sigue valiendo mientras esté fresca', !!enLinea.vigente(), true);
  await espera(350);
  igual('Pasado el margen, ya no vale', enLinea.vigente(), null);
  ahora.invalidar('prueba');
  f = await ahora.foto();
  igual('…y la foto vuelve a la base', f.fuente, 'bd');
  igual('…con su consulta de siempre', consultas.some(s => /LATERAL/.test(s)), true);
  igual('El diagnóstico dice qué empresa falla, sin datos personales',
    enLinea.estado().empresas.map(e => [e.id, !!e.fallo]), [[63530, true], [143626, false]]);

  credenciales = false;
  igual('Si quitan las credenciales, la lista deja de valer en el acto', enLinea.vigente(), null);

  // ── 5. Inicio: los conectados por su turno del plan ───────────────────────
  // c1 tiene dos cuentas conectadas (la suya y una prestada): cuenta una vez.
  // c2 es de noche ayer y hoy, c3 de todo turno, c4 era de día AYER (hoy no
  // tiene turno) y d9 es una cuenta sin ficha.
  const reparto = require('../services/flotaViva/repartoTurnos');
  const hoy = reparto.enMadrid(Date.now()).fecha, ayer = reparto.sumarDias(hoy, -1);
  sustituir('services/visibilidad.js', {});
  sustituir('services/db.js', {
    consulta: async (sql, p) => {
      if (/conductor_externo/.test(sql)) {
        const de = { d1: 1, d1b: 1, d2: 2, d3: 3, d4: 4 };
        return { rows: p[0].filter(u => de[u]).map(u => ({ uuid: u, conductor_id: de[u] })) };
      }
      if (/f_cobertura/.test(sql)) return { rows: [
        { dia: hoy, conductor_id: 1, turno: 'dia' },
        { dia: ayer, conductor_id: 2, turno: 'noche' }, { dia: hoy, conductor_id: 2, turno: 'noche' },
        { dia: hoy, conductor_id: 3, turno: 'todoturno' },
        { dia: ayer, conductor_id: 4, turno: 'dia' },
      ] };
      throw new Error('consulta inesperada: ' + sql.slice(0, 60));
    },
  });
  credenciales = true;
  respuestas = {
    143626: ['d1', 'd1b', 'd2', 'd3', 'd4', 'd9'].map((u, i) => conductor(u, 'waiting', '2026-10-28T10:00:00+01:00', 'v' + u, i + '000ZZZ')),
    63530: [],
  };
  await enLinea.refrescar();
  ahora.invalidar('prueba');
  const inicio = require('../services/inicio');
  const v = await inicio.conectadosPorTurno();
  igual('Inicio cuenta personas, no cuentas, y las separa por su turno del plan',
    [v.total, v.dia, v.noche, v.todoturno, v.sinTurno, v.fuente], [5, 1, 1, 1, 2, 'v2']);

  // ── 6. Con todo fallando no se insiste cada 5 s ───────────────────────────
  enLinea._reiniciar();
  respuestas = { 63530: new Error('401'), 143626: new Error('401') };
  const reloj = Date.now;
  let t0 = reloj();
  Date.now = () => t0;
  await enLinea.refrescar();
  t0 += 61000;
  const antes = llamadas;
  await enLinea.refrescar();
  igual('Pasado un minuto fallando, vuelve a intentarlo (una vez)', llamadas - antes, 2);
  t0 += 5000;
  const r6 = await enLinea.refrescar();
  igual('…y a los 5 s siguientes no pregunta', [llamadas - antes, !!r6.esperando], [2, true]);
  t0 += 30000;
  await enLinea.refrescar();
  igual('…hasta pasados 30 s', llamadas - antes, 4);
  Date.now = reloj;

  // ── 7. El cliente: una respuesta rara es un fallo, nunca «nadie conectado» ──
  process.env.CLIENT_ID_BOLT = 'id-de-prueba';
  process.env.CLIENT_SECRET_BOLT = 'secreto-de-prueba';
  const fetchReal = global.fetch;
  let api = [];            // respuestas de la API, en orden
  let tokens = 0;
  global.fetch = async (url, opciones) => {
    if (/oidc\.bolt\.eu/.test(url)) { tokens++; return { status: 200, text: async () => JSON.stringify({ access_token: 'tok' + tokens, expires_in: 600 }) }; }
    const [status, cuerpo] = api.shift();
    // 'CALLA': manda las cabeceras y se calla; solo lo corta el plazo.
    if (cuerpo === 'CALLA') {
      return { status, text: () => new Promise((_, rechaza) => opciones.signal.addEventListener('abort', () => {
        const e = new Error('This operation was aborted'); e.name = 'AbortError'; rechaza(e);
      })) };
    }
    return { status, text: async () => cuerpo };
  };
  const falla = async (lista, patron) => {
    api = lista.slice();
    try { await boltReal.onlineDriversV2(143626); return 'no falló'; } catch (e) { return patron.test(e.message) ? 'falla bien' : e.message; }
  };
  igual('Un 200 que no es JSON es un fallo', await falla([[200, '<html>proxy</html>']], /no es JSON/), 'falla bien');
  igual('Un 200 sin la lista de conductores es un fallo', await falla([[200, '{"code":0,"data":{}}']], /lista de conductores/), 'falla bien');
  igual('Un code distinto de 0 es un fallo', await falla([[200, '{"code":1005,"message":"TOO_MANY_REQUESTS"}']], /code 1005/), 'falla bien');
  api = [[200, '{"code":0,"data":{"drivers":[{"uuid":"a"}]}}']];
  igual('Una respuesta buena trae su lista', (await boltReal.onlineDriversV2(143626)).length, 1);
  api = [[200, '{"code":0,"data":{"drivers":[]}}']];
  igual('Una lista vacía de verdad es una lista vacía', (await boltReal.onlineDriversV2(143626)).length, 0);
  const t1 = tokens;
  api = [[200, '{"code":498811,"message":"unauthorized"}'], [200, '{"code":0,"data":{"drivers":[]}}']];
  await boltReal.onlineDriversV2(143626);
  igual('Con el token caducado pide otro una vez y sigue', tokens - t1, 1);
  const tCalla = Date.now();
  igual('Un BOLT que manda las cabeceras y se calla no cuelga el sondeo: lo corta el plazo',
    await falla([[200, 'CALLA']], /no terminó de mandar la respuesta/), 'falla bien');
  igual('…en su plazo, no en los cinco minutos de Node', Date.now() - tCalla < 1500, true);
  global.fetch = fetchReal;

  // ── 8. Una lista vacía no se cree a la primera, y el log habla ────────────
  enLinea._reiniciar();
  const lineas = [];
  const [log, warn] = [console.log, console.warn];
  console.log = (...a) => lineas.push(a.join(' '));
  console.warn = (...a) => lineas.push(a.join(' '));
  credenciales = true;
  const seis = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map(u => conductor(u, 'waiting', '2026-10-28T10:00:00+01:00', 'v' + u, u + 'XXX'));
  respuestas = { 63530: [], 143626: seis };
  await enLinea.refrescar();
  const cuantas = re => lineas.filter(l => re.test(l)).length;
  const conLaV2 = () => (enLinea.vigente() || { porUuid: new Map() }).porUuid.size;
  await enLinea.refrescar();
  respuestas[143626] = [];
  await enLinea.refrescar();
  const tras1 = conLaV2();
  await enLinea.refrescar();
  const tras2 = conLaV2();
  await enLinea.refrescar();
  const tras3 = conLaV2();
  respuestas[63530] = new Error('caída');
  await enLinea.refrescar();
  await espera(350);
  await enLinea.refrescar();
  console.log = log; console.warn = warn;
  igual('Al empezar a valer lo dice en el log, una sola vez', cuantas(/Lista de conectados al día: 6/), 1);
  igual('BOLT dice «nadie» de golpe: se sigue con los 6, también la segunda vez', [tras1, tras2], [6, 6]);
  igual('…y a la tercera seguida se lo cree', tras3, 0);
  igual('…avisando en el log', cuantas(/se espera a que lo repita|se da por buena/), 2);
  igual('Al dejar de valer también lo dice, con el porqué', cuantas(/ya no vale \(sin respuesta buena desde las/), 1);

  // ── 9. Lo que encontró la revisión ────────────────────────────────────────
  enLinea._reiniciar();
  lineas.length = 0;
  console.log = (...a) => lineas.push(a.join(' '));
  console.warn = (...a) => lineas.push(a.join(' '));
  console.error = (...a) => lineas.push(a.join(' '));
  const err = console.error;
  respuestas = { 63530: [], 143626: [null, ...seis] };
  await enLinea.refrescar();
  const conNull = conLaV2();
  // Deja de valer por edad: el salto es un cambio aunque la lista sea la misma.
  respuestas[143626] = new Error('caída');
  await espera(350);
  const rSalto = await enLinea.refrescar();
  // Vuelve diciendo «nadie»: ya ha contestado, aunque no se le crea todavía.
  respuestas[143626] = [];
  await enLinea.refrescar();
  const falloTrasVacia = enLinea.estado().empresas.find(e => e.id === 143626).fallo;
  // BOLT alterna vacía y llena: un solo aviso, no uno por vacía.
  respuestas[143626] = seis; await enLinea.refrescar();
  for (let k = 0; k < 4; k++) {
    respuestas[143626] = []; await enLinea.refrescar();
    respuestas[143626] = seis; await enLinea.refrescar();
  }
  console.log = log; console.warn = warn; console.error = err;
  igual('Un null en la lista de BOLT no tumba el sondeo: se descarta', conNull, 6);
  igual('Que la lista deje de valer es un cambio (se rehace la foto en el momento)', rSalto.cambio, true);
  igual('Una vacía sin confirmar ya cuenta como que BOLT contesta', falloTrasVacia, null);
  igual('Si BOLT alterna vacía y llena, un aviso y no uno por vacía', cuantas(/dice que no hay nadie conectado/), 1);

  // ── 10. El viaje en curso: recogida y destino ─────────────────────────────
  const parada = (type, lat, lng, address, departed) => ({ type, address, location: { lat, lng }, arrived_at_datetime: null, departed_at_datetime: departed || null });
  const con = enLinea.viajeDe({ state: 'driving_with_client', type: 'regular', category_name: 'Bolt',
    stops: [parada('dropoff', 40.45, -3.69, 'Calle Destino 1'), parada('pickup', 40.41, -3.70, 'Calle Recogida 2', '2026-10-28T10:00:00+01:00')] });
  igual('La recogida y el destino van por su tipo, no por su sitio en la lista',
    [con.recogida.direccion, con.destino.direccion, con.conCliente], ['Calle Recogida 2', 'Calle Destino 1', true]);
  const yendo = enLinea.viajeDe({ state: 'driver_accepted', stops: [parada('pickup', 40.41, -3.70, null), parada('waypoint', 40.42, -3.70, 'X'),
    parada('dropoff', 40.45, -3.69, 'Calle Destino 1'), { type: 'dropoff', address: 'sin sitio' }] });
  igual('Yendo a recoger: sin cliente, con las paradas de por medio y sin la que no trae sitio',
    [yendo.conCliente, yendo.paradas, yendo.recogida.direccion, yendo.destino.direccion], [false, 1, null, 'Calle Destino 1']);
  igual('Una oferta sin aceptar no es un viaje en curso', enLinea.viajeDe({ state: 'waiting_driver_confirmation', stops: [] }), null);
  igual('Un viaje acabado tampoco', enLinea.viajeDe({ state: 'finished', stops: [] }), null);
  igual('Sin pedido, nada', enLinea.viajeDe(null), null);
  const tv = enLinea.traducir(conductor('d7', 'on_ride', '2026-10-28T10:00:00+01:00', 'vA', '1111AAA',
    { current_order: { state: 'driver_arrived_to_client', stops: [parada('pickup', 40.41, -3.70, 'Calle Recogida 2')] } }));
  igual('El conductor traducido lleva su viaje', [tv.viaje.estado, tv.viaje.recogida.direccion, tv.viaje.destino], ['driver_arrived_to_client', 'Calle Recogida 2', null]);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
