// ============================================================
// DOS APUNTES DE BOLT EN EL MISMO SEGUNDO: ¿CUÁL ES EL DE AHORA?
// ============================================================
// BOLT apunta a veces dos estados con la misma hora, al segundo. Sin una regla,
// cada consulta se queda con uno cualquiera —el que le toque según su plan de
// ejecución— y dos pantallas que leen lo mismo dicen cosas distintas: el
// 25/09/2026 el mapa tenía a Duvan «parado» y Control «en espera», con los
// mismos apuntes delante.
//
// La regla sale de los datos, no de una opinión. En 14 días hubo 1.074 empates
// y 1.053 eran el par «waiting_orders + busy». Lo que viene DESPUÉS lo aclara:
// BOLT apunta un cambio, no un estado en el que ya estás, así que si el
// siguiente apunte es «waiting_orders», el estado del empate era el otro. Pasó
// 639 veces y en todas el de ahora era «busy»: la espera es solo la entrada de
// paso (termina un estado y empieza el descanso en el mismo segundo). El orden
// en que se guardaron (el id) no sirve: falla justo en esos casos.
//
// Así que, empatados, gana el estado con MÁS rango:
//
//   espera (0)  <  viaje (1)  <  descanso (2)  <  desconectado (3)
//
// «waiting_orders + has_order» (19 casos) sale 12 a 7 a favor del viaje, que es
// lo que da el orden. Descanso contra viaje no se ha visto nunca empatado.
//
// Contrastada con los 1.073 empates de 14 días que tienen un apunte detrás:
// encaja en 1.066. Los 7 que no, son del par raro «espera + viaje».
//
// Lo usan la foto del ahora (services/flotaViva/ahora.js), en SQL, y el motor
// de tramos, en JavaScript. Las dos versiones salen de esta misma tabla: si se
// toca el orden, se toca aquí y cambia en los dos sitios.
//
// > OJO: LA AUDITORÍA DE KM DESEMPATA AL REVÉS, Y ES A PROPÓSITO.
// > `RANGO_ESTADO` en modules/Operaciones/auditoria.service.js hace ganar a
// > «waiting_orders» sobre «busy»: allí se ACUSA a un conductor (km rodados en
// > descanso), y ante la duda se elige el estado que no acusa. Aquí la pregunta
// > es otra —qué está haciendo AHORA, para quien mira el mapa o llama por
// > teléfono— y la contesta el dato. No se unifican sin decidirlo antes.

const RANGO = { espera: 0, otro: 0, viaje: 1, descanso: 2, desconectado: 3 };

/** El rango de una situación (nuestro vocabulario: viaje, espera…). */
const rango = situacion => (Object.prototype.hasOwnProperty.call(RANGO, situacion) ? RANGO[situacion] : 0);

/**
 * La misma regla para un ORDER BY: `columna` es la situación (texto). Se
 * escribe con las claves de RANGO, que no vienen de fuera, así que no hay nada
 * que escapar.
 */
const sqlRango = columna => 'CASE ' + columna + ' ' +
  Object.entries(RANGO).map(([s, r]) => `WHEN '${s}' THEN ${r}`).join(' ') + ' ELSE 0 END';

/**
 * Ordena en su sitio los apuntes de un coche, del más viejo al más nuevo, con
 * el desempate: el último del array es el estado de ahora. `situacionDe`
 * traduce el estado de BOLT al nuestro.
 */
function ordenar(apuntes, situacionDe) {
  return apuntes.sort((a, b) => (a.t - b.t) || (rango(situacionDe(a.estado)) - rango(situacionDe(b.estado))));
}

module.exports = { RANGO, rango, sqlRango, ordenar };
