// ============================================================
// FLOTA VIVA — la vuelta de cada cinco minutos
// ============================================================
// Se mira qué dice BOLT del conductor y qué dice Mapon del coche, y se guarda el
// TRAMO: mientras la situación no cambia, la misma fila se estira. Cuando cambia,
// se cierra y se abre otra.
//
// Por qué tramos y no fotos: "¿cuánto lleva este coche desconectado?" con fotos
// obliga a recorrer el historial hacia atrás en cada consulta. Con tramos es leer
// una fila — ya trae `desde` y los km que lleva acumulados.
//
// Los km NO son la resta del odómetro final menos el inicial: se suma el trocito
// de cada vuelta y solo si es creíble. Ver `kmDelTrozo`, al final.
//
// LA VENTANA DE BOLT ES CORTA A PROPÓSITO (dos horas). BOLT no tiene un "dime
// cómo está todo ahora": tiene un registro de CAMBIOS. Un coche que lleva seis
// horas apagado no genera un solo apunte, así que pedir una ventana enorme para
// "encontrarlo" es tirar cuota. No hace falta: si no hay apunte nuevo, su
// situación es la que ya teníamos guardada, y de eso se encarga el tramo abierto.

const db = require('./db');
const fuentes = require('./fuentes');

const VENTANA_H = Number(process.env.FLOTA_VIVA_VENTANA_H) || 2;
// El padrón de coches y conductores cambia de Pascuas a Ramos: no hace falta
// pedirlo cada cinco minutos.
const PADRON_CADA_MIN = Number(process.env.FLOTA_VIVA_PADRON_MIN) || 60;

let ultimoPadron = 0;

/** Cómo se dice en nuestro vocabulario lo que manda BOLT. */
async function traducir() {
  const r = await db.consulta('SELECT estado, situacion FROM fv_estado_bolt');
  return new Map(r.rows.map(x => [x.estado, x.situacion]));
}

/**
 * Un estado de BOLT que no sabemos traducir se apunta.
 *
 * No se calla ni se convierte en "otro" y ya: se guarda la palabra exacta para
 * que aparezca en el panel. Es la única forma de enterarse de que BOLT ha
 * cambiado su vocabulario, que es la avería silenciosa de este tipo de módulos.
 */
async function apuntarDesconocido(estado) {
  await db.consulta(
    `INSERT INTO fv_estado_bolt (estado, situacion) VALUES ($1, 'otro')
     ON CONFLICT (estado) DO NOTHING`, [estado]);
  console.warn(`⚠️  [FLOTA VIVA] Estado de BOLT sin clasificar: "${estado}"`);
}

/** Las matrículas que se vigilan. Lo que no esté aquí no se mira. */
async function vigiladas() {
  const r = await db.consulta('SELECT matricula FROM fv_matricula WHERE activa');
  return new Set(r.rows.map(x => x.matricula));
}

/** Refresca el padrón de coches y conductores si toca. */
async function padron(desdeTs, hastaTs) {
  if (Date.now() - ultimoPadron < PADRON_CADA_MIN * 60000) return false;

  const [todosLosCoches, gente, lista] = await Promise.all([
    fuentes.vehiculos(desdeTs, hastaTs),
    fuentes.conductores(desdeTs, hastaTs),
    vigiladas(),
  ]);

  // EL FILTRO. BOLT devuelve la flota entera; aquí se descarta lo que no está en
  // la lista, antes de guardar nada. Así ni ocupa sitio ni sale en el panel.
  const coches = todosLosCoches.filter(v => v.matricula && lista.has(v.matricula));

  // Una matrícula de la lista que BOLT no conoce no es un detalle: o está mal
  // escrita, o ese coche ya no está en la flota. Se dice por su nombre.
  const enBolt = new Set(coches.map(v => v.matricula));
  const sinCoche = [...lista].filter(m => !enBolt.has(m));
  if (sinCoche.length) {
    console.warn(`⚠️  [FLOTA VIVA] ${sinCoche.length} matrícula(s) vigiladas que BOLT no conoce: ` +
                 sinCoche.slice(0, 12).join(', ') + (sinCoche.length > 12 ? '…' : ''));
  }

  await db.transaccion(async cli => {
    for (const v of coches) {
      await cli.query(
        `INSERT INTO fv_vehiculo (uuid, matricula, flota_id, visto_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (uuid) DO UPDATE SET
           matricula = COALESCE(EXCLUDED.matricula, fv_vehiculo.matricula),
           flota_id = EXCLUDED.flota_id, visto_at = now()`,
        [v.uuid, v.matricula || null, v.flotaId]);
    }
    for (const c of gente) {
      await cli.query(
        `INSERT INTO fv_conductor (uuid, nombre, telefono, flota_id, visto_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (uuid) DO UPDATE SET
           nombre = COALESCE(NULLIF(EXCLUDED.nombre, ''), fv_conductor.nombre),
           telefono = COALESCE(NULLIF(EXCLUDED.telefono, ''), fv_conductor.telefono),
           visto_at = now()`,
        [c.uuid, c.nombre || null, c.telefono || null, c.flotaId]);
    }
  });

  ultimoPadron = Date.now();
  console.log(`👥 [FLOTA VIVA] Padrón: ${coches.length} de ${lista.size} vigilada(s) · ` +
              `${gente.length} conductor(es)`);
  return { coches: coches.length, vigiladas: lista.size, sinCoche };
}

/**
 * Una vuelta.
 *
 * Devuelve el recuento de lo que ha pasado, que es lo que se guarda en
 * `fv_vuelta` y lo que deja ver si esto sigue vivo o lleva horas fallando.
 */
async function pasada() {
  const t0 = Date.now();
  await db.preparar();

  const vuelta = (await db.consulta(
    'INSERT INTO fv_vuelta (arrancada_at) VALUES (now()) RETURNING id')).rows[0].id;

  try {
    const hastaTs = Math.floor(Date.now() / 1000);
    const desdeTs = hastaTs - VENTANA_H * 3600;

    await padron(desdeTs, hastaTs);

    const [estadosBolt, mapon, mapa] = await Promise.all([
      fuentes.estados(desdeTs, hastaTs),
      fuentes.flotaMapon().catch(e => {
        console.error('⚠️  [FLOTA VIVA] Mapon no contestó:', e.message);
        return new Map();
      }),
      traducir(),
    ]);

    // Solo los vigilados, y por si acaso: `fv_vehiculo` ya está filtrado al
    // guardarse, pero si alguien desactiva una matrícula, su coche deja de
    // mirarse en la siguiente vuelta sin tener que borrar nada.
    const coches = (await db.consulta(
      `SELECT v.uuid, v.matricula, v.mapon_unit
         FROM fv_vehiculo v
         JOIN fv_matricula m ON m.matricula = v.matricula AND m.activa`)).rows;

    let conectados = 0, cambios = 0;

    for (const v of coches) {
      const log = estadosBolt.get(v.uuid);
      const gps = v.matricula ? mapon.get(v.matricula) : null;

      // Sin apunte nuevo de BOLT no se cambia nada: su situación es la que ya
      // teníamos. Solo si NO tenemos ninguna se asume desconectado, y se deja
      // dicho que fue una suposición nuestra dejando el estado crudo en nulo.
      let situacion = null, estadoBolt = null, conductor = null;
      if (log) {
        estadoBolt = log.estado;
        situacion = mapa.get(log.estado) || null;
        if (!situacion) { await apuntarDesconocido(log.estado); situacion = 'otro'; }
        conductor = log.conductor || null;
      }

      const r = await aplicar(v, { situacion, estadoBolt, conductor, gps });
      if (r.cambio) cambios++;
      if (r.conectado) conectados++;
    }

    const ms = Date.now() - t0;
    await db.consulta(
      `UPDATE fv_vuelta SET terminada_at = now(), vehiculos = $2, conectados = $3,
              cambios = $4, ms = $5 WHERE id = $1`,
      [vuelta, coches.length, conectados, cambios, ms]);

    console.log(`🚦 [FLOTA VIVA] ${coches.length} coche(s) · ${conectados} conectado(s) · ` +
                `${cambios} cambio(s) · ${ms} ms`);
    return { vehiculos: coches.length, conectados, cambios, ms };
  } catch (e) {
    await db.consulta('UPDATE fv_vuelta SET terminada_at = now(), error = $2 WHERE id = $1',
      [vuelta, e.message]).catch(() => {});
    throw e;
  }
}

/**
 * Estira el tramo abierto o abre uno nuevo.
 *
 * El conductor NO cuenta como cambio de tramo por sí solo: BOLT deja de mandar
 * driver_uuid al desconectarse, y tratar eso como tramo nuevo partía en dos la
 * misma racha y perdía los km acumulados. El conductor se rellena cuando viene y
 * no se borra cuando falta.
 */
async function aplicar(vehiculo, { situacion, estadoBolt, conductor, gps }) {
  const odo = gps && gps.odometroM != null ? gps.odometroM : null;
  const senal = gps && gps.senalAt ? gps.senalAt : null;

  const abierto = (await db.consulta(
    `SELECT id, situacion, conductor_uuid, odometro_visto_m, senal_at, km_dudoso
       FROM fv_tramo WHERE vehiculo_uuid = $1 AND hasta IS NULL`,
    [vehiculo.uuid])).rows[0];

  // La primera vez que vemos un coche sin apunte de BOLT: se le supone apagado.
  const destino = situacion || (abierto ? abierto.situacion : 'desconectado');
  const conectado = destino !== 'desconectado';

  if (gps && gps.unitId && !vehiculo.mapon_unit) {
    await db.consulta('UPDATE fv_vehiculo SET mapon_unit = $2 WHERE uuid = $1',
      [vehiculo.uuid, gps.unitId]);
  }

  if (abierto && abierto.situacion === destino) {
    const avance = kmDelTrozo(abierto, odo, senal);
    await db.consulta(
      `UPDATE fv_tramo
          SET hasta = NULL,
              odometro_fin_m = COALESCE($2, odometro_fin_m),
              odometro_ini_m = COALESCE(odometro_ini_m, $2),
              odometro_visto_m = COALESCE($2, odometro_visto_m),
              senal_at = COALESCE($5, senal_at),
              km_m = km_m + $6,
              km_dudoso = km_dudoso OR $7,
              conductor_uuid = COALESCE($3, conductor_uuid),
              estado_bolt = COALESCE($4, estado_bolt),
              vueltas = vueltas + 1
        WHERE id = $1`,
      [abierto.id, odo, conductor || null, estadoBolt || null, senal,
       avance.metros, avance.dudoso]);
    return { cambio: false, conectado };
  }

  // Cambió de situación: se cierra lo anterior y se abre lo nuevo, en la misma
  // transacción. A medias quedaría un coche con dos tramos abiertos, y el índice
  // único lo rechazaría — que es lo que tiene que pasar.
  await db.transaccion(async cli => {
    if (abierto) {
      await cli.query(
        'UPDATE fv_tramo SET hasta = now(), odometro_fin_m = COALESCE($2, odometro_fin_m) WHERE id = $1',
        [abierto.id, odo]);
    }
    // El tramo nuevo empieza con CERO km, no con la resta de odómetros. Lo que
    // el coche hizo antes es del tramo anterior, aunque el equipo lo cuente
    // ahora.
    await cli.query(
      `INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, estado_bolt,
                             desde, odometro_ini_m, odometro_fin_m, odometro_visto_m,
                             senal_at, km_m)
       VALUES ($1, $2, $3, $4, now(), $5, $5, $5, $6, 0)`,
      [vehiculo.uuid, conductor || (abierto ? abierto.conductor_uuid : null) || null,
       destino, estadoBolt || null, odo, senal]);
  });
  return { cambio: true, conectado };
}

// Lo más rápido que puede ir un coche, en metros por segundo. 180 km/h es
// generoso a propósito: no es un límite de velocidad, es el listón por encima
// del cual un salto de odómetro NO es un coche circulando.
const MAX_MS = 50;

/**
 * Cuántos metros ha hecho el coche DESDE LA ÚLTIMA VUELTA.
 *
 * Aquí estaba el fallo que sacó 18,9 km en un coche que llevaba tres minutos
 * parado. Antes los km de un tramo eran `odómetro final − odómetro inicial`, y
 * eso da por hecho que el odómetro avanza a la vez que el coche. No es verdad:
 * un equipo que estuvo sin cobertura se pone al día de golpe, y ese salto —que
 * son kilómetros de horas antes, o de otro día— caía entero en el tramo abierto.
 *
 * Así que se mira el trozo de cada vuelta y se compara con el tiempo que ha
 * pasado SEGÚN EL RELOJ DEL EQUIPO, no según el nuestro: si el equipo no ha
 * vuelto a hablar, no hay kilómetros nuevos que contar por mucho que haya pasado
 * el tiempo. Lo que no cabe en ese rato no se suma, y se marca como dudoso.
 */
function kmDelTrozo(tramo, odo, senal) {
  const nada = { metros: 0, dudoso: false };
  if (odo == null || tramo.odometro_visto_m == null) return nada;

  const delta = Number(odo) - Number(tramo.odometro_visto_m);
  if (delta === 0) return nada;
  // El odómetro no baja. Si baja, es que lo han reiniciado o cambiado el equipo.
  if (delta < 0) return { metros: 0, dudoso: true };

  // Sin saber cuándo habló el equipo antes y ahora, no se puede juzgar el salto.
  // Se cuenta igual, porque lo normal es que sea bueno, pero queda señalado.
  if (!senal || !tramo.senal_at) return { metros: delta, dudoso: true };

  const seg = (new Date(senal) - new Date(tramo.senal_at)) / 1000;
  // El equipo no ha vuelto a hablar: no hay nada nuevo, sea cual sea el número.
  if (seg <= 0) return nada;
  if (delta > seg * MAX_MS) return { metros: 0, dudoso: true };
  return { metros: delta, dudoso: false };
}

module.exports = { pasada, padron, vigiladas, kmDelTrozo };
