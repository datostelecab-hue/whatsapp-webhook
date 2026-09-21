// ============================================================
// POSICIONES — dónde está cada coche, ahora
// ============================================================
// PILOTO. Esto es lo único que faltaba para el mapa: la posición YA llegaba de
// Mapon en cada vuelta de Flota viva —`unit/list.json` la trae— y el código la
// leía y la tiraba. Aquí se guarda.
//
// ── POR QUÉ UNA VUELTA PROPIA Y NO DENTRO DEL MOTOR ────────────────────────
//
// El motor de Flota viva corre cada 5 minutos porque eso es lo que vale para
// medir horas y kilómetros. Un mapa a 5 minutos no es un mapa: es una foto de
// hace un rato. Y al revés, arrastrar todo el motor cada 30 segundos sería
// diez veces el trabajo para el mismo resultado.
//
// Así que esta vuelta hace UNA cosa: una llamada a Mapon y una escritura.
// Medido el 21/09/2026 contra la base de producción: 236 ms la llamada y
// **1 ms** de trabajo de base para las 108 unidades de una vez. A 30 segundos
// eso es el 0,003 % de la CPU de PostgreSQL.
//
// ── POR QUÉ 30 SEGUNDOS Y NO 5 ─────────────────────────────────────────────
//
// Porque más rápido no da más verdad. Medido el mismo día pidiendo dos veces
// con un minuto de diferencia: de los 40 coches conduciendo, 36 habían
// cambiado de dato. El equipo del coche renueva cada ~67 segundos de media, y
// la mediana de antigüedad conduciendo son 17 s. Preguntar cada 5 s serían
// 17.280 llamadas al día para recibir lo mismo.
//
// ── LO QUE NO HACE ─────────────────────────────────────────────────────────
//
// No guarda rastro. `fv_posicion` es una fila por unidad que se sobreescribe.
// El recorrido ya lo tiene Mapon y los km ya están en `fv_ruta`; lo que no
// había en ningún sitio era el AHORA.

const db = require('./db');
const fuentes = require('./fuentes');

// ── ANTI-SOLAPE ────────────────────────────────────────────────────────────
// node-cron NO espera a la promesa: dispara la vuelta siguiente aunque la
// anterior siga dentro. A 5 minutos eso no se nota nunca; a 30 segundos basta
// con que Mapon tarde 31 para que se pisen dos escrituras.
//
// OJO CON EL ALCANCE: esta bandera es de ESTE proceso. Si algún día Render
// levanta dos instancias, las dos correrían la vuelta. Para lo que hace —una
// foto que se sobreescribe— dos vueltas a la vez no rompen nada: la segunda
// escribe encima lo mismo. Si alguna vez esto MANDA algo, la garantía tendrá
// que bajar a la base (un índice único, como en `alerta_control`).
let corriendo = false;

// La última vuelta, para poder contestar "¿esto está vivo?" sin ir a la base.
let ultima = { at: null, unidades: 0, ms: null, error: null };

/**
 * Una vuelta: pide a Mapon dónde está todo y lo deja escrito.
 *
 * Devuelve `{ saltado: true }` si la vuelta anterior seguía dentro. No es un
 * error y no se registra como tal: es exactamente lo que tiene que pasar.
 */
async function refrescar() {
  if (corriendo) return { saltado: true, motivo: 'la vuelta anterior sigue dentro' };
  corriendo = true;
  const t0 = Date.now();
  try {
    await db.preparar();
    const uds = await fuentes.posiciones();
    if (!uds.length) {
      ultima = { at: new Date(), unidades: 0, ms: Date.now() - t0, error: 'Mapon no devolvió ninguna posición' };
      return { unidades: 0, ms: Date.now() - t0 };
    }

    // TODAS DE UNA VEZ. 108 filas en una sola sentencia y una sola transacción:
    // 108 sentencias sueltas serían 108 idas y vueltas a Frankfurt, y ahí el
    // viaje cuesta treinta veces más que el trabajo.
    const v = [];
    const huecos = uds.map((u, i) => {
      v.push(u.unitId, u.matricula, u.lat, u.lng, u.velocidad, u.rumbo,
        u.estado, u.estadoDesde, u.senalAt);
      return '(' + Array.from({ length: 9 }, (_, k) => '$' + (i * 9 + k + 1)).join(',') + ')';
    });
    await db.consulta(
      `INSERT INTO fv_posicion
         (mapon_unit, matricula, lat, lng, velocidad, rumbo,
          estado_mapon, estado_desde, visto_at)
       VALUES ${huecos.join(',')}
       ON CONFLICT (mapon_unit) DO UPDATE SET
         matricula     = EXCLUDED.matricula,
         lat           = EXCLUDED.lat,
         lng           = EXCLUDED.lng,
         velocidad     = EXCLUDED.velocidad,
         rumbo         = EXCLUDED.rumbo,
         estado_mapon  = EXCLUDED.estado_mapon,
         estado_desde  = EXCLUDED.estado_desde,
         visto_at      = EXCLUDED.visto_at,
         refrescado_at = now()`, v);

    const ms = Date.now() - t0;
    ultima = { at: new Date(), unidades: uds.length, ms, error: null };
    return { unidades: uds.length, ms };
  } catch (e) {
    ultima = { at: new Date(), unidades: 0, ms: Date.now() - t0, error: e.message };
    throw e;
  } finally {
    // En el `finally` y no al final del `try`: si salta una excepción y la
    // bandera se queda encendida, esto no vuelve a correr hasta el siguiente
    // despliegue, y nadie se entera porque el mapa sigue enseñando lo último.
    corriendo = false;
  }
}

/** ¿Esto está vivo? Para el panel y para diagnosticar sin abrir la base. */
const estado = () => ({ corriendo, ultima });

module.exports = { refrescar, estado };
