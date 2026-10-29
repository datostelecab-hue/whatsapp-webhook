// ============================================================
// SANCIONES DE VELOCIDAD — quién llevaba el coche cuando hay EMPATE en fv_tramo
// ============================================================
// Cuando BOLT manda dos apuntes en el mismo segundo, el motor de Flota viva deja
// un tramo de 0 segundos («espera») y el siguiente empieza en el mismo instante.
// En producción son 3.396 pares desde septiembre, siempre de la misma persona.
// `velocidad.repo.quienConducia` elegía con «ORDER BY desde DESC» a secas y a
// veces cogía el de 0 s: el exceso no caía «dentro», la antigüedad se contaba
// desde que empezó el tramo y, pasada la media hora, quedaba «dudoso» y no se
// avisaba a quien seguía conectado. Desde el 22/10/2026 desempata el que llega
// más lejos, como Combustible (Trampas conocidas).
//
// Esto lo comprueba con DATOS DE MENTIRA que empatan, sobre la base del entorno
// de pruebas local, y con el SQL de verdad: un ORDER BY no se puede comprobar con
// una base fingida. Los casos:
//   A  espera de 0 s → descanso, metidos en su orden (el del motor);
//   B  lo mismo metido AL REVÉS: el de 0 s con el id más alto. Con A, tumba
//      cualquier desempate que sea solo por id, en un sentido o en el otro;
//   C  espera de 0 s → desconectado: la antigüedad cuenta desde que se
//      desconectó, la regla de la media hora;
//   D  una cadena de cuatro (espera, descanso, espera de 0 s… y descanso);
//   E  el exceso cae DESPUÉS de los dos: «se desconectó hace 15 min» (se avisa)
//      y no «hace 35» (dudoso), que es lo que salía con el de 0 s;
//   F  el que gana sigue ABIERTO: llega hasta su última señal.
// Y lo mismo de punta a punta: `procesar` con un aviso de Mapon de mentira por
// caso (en modo pruebas: sin WhatsApp) y lo que deja en `velocidad_exceso`. Y los
// «coches rodando sin nadie» de Control (`rutas.kmSinDuenio`), que elegían su
// tramo con el mismo ORDER BY.
//
// Y CINCO MINUTOS ENTRE AVISOS (29/10/2026, Luis Alfredo Betancur Ramirez): un
// conductor de mentira con teléfono, en modo real y con un WhatsApp de mentira
// que solo apunta. Un exceso a menos de 5 min de un aviso va con él (`agrupado`,
// sin WhatsApp); uno aparte espera a la pasada siguiente si el último WhatsApp
// salió hace menos de 5 min; y una alerta que llega tarde también se agrupa.
//
//   node scripts/comprobar-sanciones.js
//
// HACE FALTA EL ENTORNO LOCAL (Docker telecab-pg en 127.0.0.1:5433, ver «Entorno
// de pruebas local»). La dirección va escrita aquí y no se lee de ninguna
// variable: no puede apuntar a producción. Además exige la marca `entorno_local`
// que pone refrescar.js, y TODO va dentro de una transacción que se deshace al
// acabar: la copia queda como estaba.
process.env.MODO_PRUEBAS = '1';
process.env.SANCIONES_MODO = 'test';
delete process.env.SANCIONES_DESDE;
delete process.env.SANCIONES_VENTANA_FIABLE;

const path = require('path');
const { Client } = require('pg');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';

const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// ── Los datos de mentira ────────────────────────────────────────────────────
// Un coche y una conductora inventados, el 01/10/2026 (UTC; en Madrid, dos
// horas más). La copia local llega más allá, así que la ingesta «ya sabe» de
// esos días y nada queda esperando.
const COCHE = 'prueba-desempate-coche';
const MATRICULA = '0000ZZZ';
const UNIDAD = 999000111;
const ANA = 'prueba-desempate-ana';
const NOMBRE = 'Ana Prueba Inventada';

const CASOS = {
  // nombre: [tramos en el orden en que se meten], instante del exceso, lo esperado
  A: { tramos: [['espera', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'],
                ['descanso', '2026-10-01T08:00:00Z', '2026-10-01T09:00:00Z']],
       exceso: '2026-10-01T08:40:00Z',
       espera: { situacion: 'descanso', dentro: true, desconectado: false, antiguedadSeg: 0 },
       libro: { estado: 'simulado', ventana_seg: 0, nota: 'Estaba en la app en ese momento (descanso)' } },
  B: { tramos: [['descanso', '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z'],
                ['espera', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z']],
       exceso: '2026-10-01T12:40:00Z',
       espera: { situacion: 'descanso', dentro: true, desconectado: false, antiguedadSeg: 0 },
       libro: { estado: 'simulado', ventana_seg: 0, nota: 'Estaba en la app en ese momento (descanso)' } },
  C: { tramos: [['espera', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z'],
                ['desconectado', '2026-10-01T15:00:00Z', '2026-10-01T16:00:00Z']],
       exceso: '2026-10-01T15:10:00Z',
       espera: { situacion: 'desconectado', dentro: false, desconectado: true, antiguedadSeg: 600 },
       libro: { estado: 'simulado', ventana_seg: 600, nota: 'Se desconectó de la app 10 min antes del exceso' } },
  D: { tramos: [['espera', '2026-10-01T17:00:00Z', '2026-10-01T17:00:00Z'],
                ['descanso', '2026-10-01T17:00:00Z', '2026-10-01T17:00:00Z'],
                ['espera', '2026-10-01T17:00:00Z', '2026-10-01T17:00:00Z'],
                ['descanso', '2026-10-01T17:00:00Z', '2026-10-01T18:00:00Z']],
       exceso: '2026-10-01T17:45:00Z',
       espera: { situacion: 'descanso', dentro: true, desconectado: false, antiguedadSeg: 0 },
       libro: { estado: 'simulado', ventana_seg: 0, nota: 'Estaba en la app en ese momento (descanso)' } },
  E: { tramos: [['espera', '2026-10-01T20:00:00Z', '2026-10-01T20:00:00Z'],
                ['viaje', '2026-10-01T20:00:00Z', '2026-10-01T20:20:00Z']],
       exceso: '2026-10-01T20:35:00Z',
       espera: { situacion: 'viaje', dentro: false, desconectado: false, antiguedadSeg: 900 },
       libro: { estado: 'simulado', ventana_seg: 900, nota: 'Se desconectó de la app 15 min antes del exceso' } },
  // El abierto llega hasta su última señal (senal_at), no hasta el infinito.
  F: { tramos: [['espera', '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z'],
                ['descanso', '2026-10-02T08:00:00Z', null, '2026-10-02T09:00:00Z']],
       exceso: '2026-10-02T08:30:00Z',
       espera: { situacion: 'descanso', dentro: true, desconectado: false, antiguedadSeg: 0 },
       libro: { estado: 'simulado', ventana_seg: 0, nota: 'Estaba en la app en ese momento (descanso)' } },
};
const clave = caso => `prueba-desempate|${caso}|speeding`;

// Los cinco minutos: otro coche y otro conductor, este CON teléfono.
const COCHE2 = 'prueba-separacion-coche';
const MATRICULA2 = '0000ZZY';
const UNIDAD2 = 999000112;
const BETO = 'prueba-separacion-beto';
const TEL_BETO = '+34600000999';
const claveSep = hora => `prueba-separacion|${hora}|speeding`;

async function sembrar(q) {
  await q(`INSERT INTO fv_conductor (uuid, nombre) VALUES ($1, $2)`, [ANA, NOMBRE]);
  // La cuenta de Beto ya ahora: el padrón se lee en la primera pasada y se
  // guarda un minuto. Sus tramos y sus excesos, en la sección 4.
  await q(`INSERT INTO fv_conductor (uuid, nombre) VALUES ($1, 'Beto Prueba Inventado')`, [BETO]);
  await q(`INSERT INTO conductor_externo (sistema, externo_id, externo_nombre, externo_telefono)
           VALUES ('bolt', $1, 'Beto Prueba Inventado', $2)`, [BETO, TEL_BETO]);
  await q(`INSERT INTO fv_vehiculo (uuid, matricula, mapon_unit, visto_at) VALUES ($1, $2, $3, now())`,
    [COCHE, MATRICULA, UNIDAD]);
  for (const [caso, c] of Object.entries(CASOS)) {
    for (const [situacion, desde, hasta, senal] of c.tramos) {
      await q(`INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, estado_bolt, desde, hasta, senal_at)
               VALUES ($1, $2, $3, 'prueba', $4, $5, $6)`, [COCHE, ANA, situacion, desde, hasta, senal || hasta]);
    }
    await q(`INSERT INTO mapon_alerta (clave, ocurrido_at, tipo, unit_id, matricula, velocidad, limite, exceso, msg, creado_at)
             VALUES ($1, $2, 'speeding', $3, $4, 130, 90, 40, $5, now())`,
      [clave(caso), c.exceso, String(UNIDAD), MATRICULA, `Caso ${caso} de comprobar-sanciones`]);
  }
  // Un trayecto de 10 km a las 10:00 (12:00 en Madrid), cuando el coche no tenía
  // ningún tramo: son km «sin dueño» y el coche sale en la lista de Control.
  await q(`INSERT INTO fv_ruta (unit_id, route_id, matricula, inicio, fin, metros)
           VALUES ($1, 'prueba-desempate-1', $2, '2026-10-01T10:00:00Z', '2026-10-01T10:30:00Z', 10000)`,
    [UNIDAD, MATRICULA]);
}

(async () => {
  const cli = new Client({ connectionString: LOCAL });
  try {
    await cli.connect();
    await cli.query('SELECT 1 FROM entorno_local LIMIT 1');
  } catch (e) {
    console.log(`No hay entorno local (${e.message}).\nArráncalo antes: node scripts/entorno-local/arrancar.js (o refrescar.js si no hay copia).`);
    process.exit(1);
  }

  await cli.query('BEGIN');
  try {
    // Todo lo que el ERP pregunte a la base, por ESTA conexión y dentro de la
    // transacción: ve los datos de mentira y no deja nada al acabar.
    const consulta = (sql, p) => cli.query(sql, p);
    sustituir('services/db', { consulta, transaccion: async fn => fn(cli), HAY_BD: true });
    sustituir('services/flotaViva/db', {
      consulta, transaccion: async fn => fn(cli), preparar: async () => true, conEsquema: f => f, HAY_BD: true,
    });
    // En modo pruebas no se llega a mandar nada; si se llegara, es un fallo.
    // En la sección 4 (modo real) solo se apunta a quién iría.
    let envios = null;
    sustituir('services/whatsapp', {
      enviarPlantillaPosicional: async (tel) => {
        if (envios) { envios.push(tel); return { ok: true, id: 'prueba-envio-' + envios.length }; }
        fallos++; console.log('FALLA se intentó mandar un WhatsApp'); return { ok: false, error: 'comprobación' };
      },
    });
    const repo = require('../modules/Operaciones/velocidad.repo');
    const sanciones = require('../modules/Operaciones/sanciones.service');
    const rutas = require('../services/flotaViva/rutas');

    const ya = await consulta(`SELECT 1 FROM fv_vehiculo WHERE uuid = $1 OR upper(matricula) = $2`, [COCHE, MATRICULA]);
    if (ya.rowCount) throw new Error(`la copia ya tiene el coche ${MATRICULA} o ${COCHE}: no siembro encima`);
    await sembrar(consulta);

    // ── 1. quienConducia, caso a caso ─────────────────────────────────────────
    console.log('\nQuién llevaba el coche (velocidad.repo.quienConducia)');
    for (const [caso, c] of Object.entries(CASOS)) {
      // Lo que devuelve la base SIN desempate, solo para que se vea que los
      // datos reproducen el fallo. No se juzga: el orden de un empate sin
      // desempate no está garantizado.
      const crudo = (await consulta(
        `SELECT situacion FROM fv_tramo WHERE vehiculo_uuid = $1 AND conductor_uuid IS NOT NULL
            AND desde <= $2 ORDER BY desde DESC LIMIT 1`, [COCHE, c.exceso])).rows[0];
      const m = await repo.quienConducia(MATRICULA, c.exceso);
      igual(`${caso} ${c.tramos.map(t => t[0] + (t[1] === t[2] ? ' 0 s' : '')).join(' → ')}` +
        `  (sin desempate la base da: ${crudo ? crudo.situacion : '—'})`,
        m && { situacion: m.situacion, dentro: m.dentro, desconectado: m.desconectado, antiguedadSeg: m.antiguedadSeg },
        c.espera);
      igual(`${caso}   es ella`, m && m.driverUuid, ANA);
    }

    // ── 2. De punta a punta: procesar y el libro ──────────────────────────────
    console.log('\nDe punta a punta (sanciones.procesar, modo pruebas)');
    // La pasada lee los días que se le digan hacia atrás desde hoy: hasta el
    // 30/09 basta para coger los casos.
    const dias = Math.ceil((Date.now() - Date.parse('2026-09-30T00:00:00Z')) / 86400000);
    const res = await sanciones.procesar({ dias });
    igual('la pasada no da error', res.error || null, null);
    const libro = (await consulta(
      `SELECT clave, estado, ventana_seg, nota, driver_uuid FROM velocidad_exceso WHERE clave LIKE 'prueba-desempate|%'`)).rows;
    for (const [caso, c] of Object.entries(CASOS)) {
      const f = libro.find(x => x.clave === clave(caso));
      igual(`${caso} queda en el libro`, f && { estado: f.estado, ventana_seg: f.ventana_seg, nota: f.nota }, c.libro);
    }

    // ── 3. Control: coches rodando sin nadie conectado ────────────────────────
    console.log('\nCoches rodando sin nadie (rutas.kmSinDuenio)');
    const sin = (await rutas.kmSinDuenio('2026-10-01', 'operativo')).find(x => x.matricula === MATRICULA);
    igual('el coche sale con sus 10 km sin dueño', sin && { km: sin.km, kmSinDuenio: sin.kmSinDuenio }, { km: 10, kmSinDuenio: 10 });
    igual('y su último tramo es el viaje, no la espera de 0 s',
      sin && { situacion: sin.situacion, desde: new Date(sin.desde).toISOString(), ultimoConductor: sin.ultimoConductor },
      { situacion: 'viaje', desde: '2026-10-01T20:00:00.000Z', ultimoConductor: NOMBRE });

    // ── 4. Cinco minutos entre avisos ─────────────────────────────────────────
    console.log('\nCinco minutos entre avisos (modo real, WhatsApp de mentira)');
    await consulta(`INSERT INTO fv_vehiculo (uuid, matricula, mapon_unit, visto_at) VALUES ($1, $2, $3, now())`,
      [COCHE2, MATRICULA2, UNIDAD2]);
    await consulta(`INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, estado_bolt, desde, hasta, senal_at)
                    VALUES ($1, $2, 'descanso', 'prueba', '2026-10-03T08:00:00Z', '2026-10-03T09:00:00Z', '2026-10-03T09:00:00Z')`,
      [COCHE2, BETO]);
    const alerta = hora => consulta(
      `INSERT INTO mapon_alerta (clave, ocurrido_at, tipo, unit_id, matricula, velocidad, limite, exceso, msg, creado_at)
       VALUES ($1, $2, 'speeding', $3, $4, 130, 90, 40, 'comprobar-sanciones: cinco minutos', now())`,
      [claveSep(hora), `2026-10-03T${hora}Z`, String(UNIDAD2), MATRICULA2]);
    for (const h of ['08:00:00', '08:03:00', '08:04:59', '08:05:30', '08:30:00']) await alerta(h);
    // Pasa el tiempo: el último WhatsApp a Beto, hace 10 min.
    const pasanDiez = () => consulta(
      `UPDATE velocidad_exceso SET enviado_at = enviado_at - interval '10 minutes' WHERE telefono = $1 AND enviado_at IS NOT NULL`, [TEL_BETO]);
    const deBeto = async () => (await consulta(
      `SELECT split_part(clave, '|', 2) AS h, estado, nota FROM velocidad_exceso WHERE clave LIKE 'prueba-separacion|%' ORDER BY ocurrido_at`)).rows;

    process.env.SANCIONES_MODO = 'live';
    envios = [];
    try {
      let r = await sanciones.procesar({ dias });
      igual('1.ª pasada: avisa el de las 10:00, agrupa los de 10:03 y 10:04:59, y deja dos para después',
        [r.error || null, r.agrupados, r.espaciados], [null, 2, 2]);
      igual('…y en el libro', (await deBeto()).map(x => [x.h, x.estado]),
        [['08:00:00', 'avisado'], ['08:03:00', 'agrupado'], ['08:04:59', 'agrupado']]);
      igual('…con la nota del aviso con el que van', (await deBeto())[1].nota,
        'Va con el aviso de las 10:00, a menos de 5 min: no se le manda otro WhatsApp');

      await pasanDiez();
      r = await sanciones.procesar({ dias });
      igual('2.ª pasada: el de 10:05:30 (5 min y medio después) es un aviso aparte; el de 10:30 espera',
        [r.agrupados, r.espaciados], [0, 1]);
      await pasanDiez();
      r = await sanciones.procesar({ dias });
      igual('3.ª pasada: sale el de 10:30', r.espaciados, 0);

      // Una alerta que Mapon entrega tarde, 2 min ANTES de un aviso ya enviado.
      await alerta('08:28:00');
      await pasanDiez();
      r = await sanciones.procesar({ dias });
      igual('La que llega tarde, 2 min antes del aviso de 10:30, va con él', r.agrupados, 1);
      igual('El libro de Beto al final', (await deBeto()).map(x => [x.h, x.estado]), [
        ['08:00:00', 'avisado'], ['08:03:00', 'agrupado'], ['08:04:59', 'agrupado'],
        ['08:05:30', 'avisado'], ['08:28:00', 'agrupado'], ['08:30:00', 'avisado']]);
      igual('Tres WhatsApps, todos a Beto', envios, [TEL_BETO, TEL_BETO, TEL_BETO]);
    } finally {
      process.env.SANCIONES_MODO = 'test';
      envios = null;
    }
  } catch (e) {
    fallos++;
    console.log('FALLA ' + (e.stack || e.message));
  } finally {
    await cli.query('ROLLBACK').catch(() => {});
    await cli.end().catch(() => {});
  }

  console.log(fallos ? `\n${fallos} fallo(s).` : '\nTodo bien. La copia local queda como estaba.');
  process.exit(fallos ? 1 : 0);
})();
