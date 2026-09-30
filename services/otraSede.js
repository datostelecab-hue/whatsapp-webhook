// ============================================================
// COCHES DE OTRA SEDE — los que el bot y el fichaje NO tocan
// ============================================================
// La flota que se vigila es la de Madrid (`nucleo.SEDE_FLOTA`). Las pantallas ya
// apartaban los coches de Barcelona con `deLaFlotaVigilada`, pero lo que MANDA
// ÓRDENES a un coche —el corte de motor, las puertas, el turno que le pone el
// conductor en Mapon— no miraba la sede, y Mapon obedece esté el coche donde
// esté.
//
// Pasó con el 1888LTJ, de Barcelona. El bot lo daba de EJEMPLO («Ejemplo:
// 1888LTJ») y con él se abrió un viaje de prueba de 21 segundos el 24/09: al
// cerrarlo se le cortó el motor, y desde entonces el repaso se lo volvía a cortar
// cada vez que llevaba 20 minutos aparcado. Tráfico lo soltó el 28, volvió a
// cortarse; lo soltaron el 29, volvió a cortarse; Camilo lo soltó desde Mapon el
// 30. Antes, el 17 y el 18/09, tres conductores de Madrid le abrieron y cerraron
// las puertas escribiendo esa matrícula. Camilo, 30/09/2026: «que no toque coches
// de Barcelona».
//
// Aquí se sabe qué coches son de otra sede, por MATRÍCULA y por EQUIPO de Mapon
// (las dos cosas: el repaso recorre equipos y el bot recibe matrículas). Lo usan:
//   · fichaje.motor()        nunca CORTA un coche de otra sede, venga de donde
//                            venga la orden (repaso, «Terminar turno», cierre
//                            automático);
//   · el alcance del fichaje el repaso, «liberar todos» y la lista de motores
//                            cortados ni los miran;
//   · fichaje.iniciar()      no abre turno ni viaje con uno de ellos (y así
//                            tampoco se le asigna conductor en Mapon);
//   · las puertas            no se abren ni se cierran desde el bot.
//
// Si la base no contesta se tira de la última lista buena; sin ninguna, se lanza
// el error y cada llamada decide. Cortar un motor, por ejemplo, se niega.

const db = require('./db');
const { SEDE_FLOTA } = require('./nucleo');

const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
// Una sede no cambia cada minuto: con cinco de margen, un coche que pasa a
// Barcelona deja de tocarse enseguida y el repaso no consulta la base por coche.
const TTL_MS = 5 * 60 * 1000;
let lista = null, listaAt = 0;

/** { matriculas: Map(matrícula → sede), units: Map(unit_id → sede) } de los coches que NO son de Madrid. */
async function cochesDeOtraSede() {
  if (lista && Date.now() - listaAt < TTL_MS) return lista;
  try {
    const r = await db.consulta(
      `SELECT v.matricula_norm, v.sede, a.externo_id AS unit_id
         FROM vehiculo v
         LEFT JOIN vehiculo_alias a
           ON a.vehiculo_id = v.id AND a.sistema = 'mapon' AND a.visto_hasta IS NULL
        WHERE v.sede IS NOT NULL AND v.sede <> $1`, [SEDE_FLOTA]);
    const matriculas = new Map(), units = new Map();
    r.rows.forEach(x => {
      matriculas.set(normMat(x.matricula_norm), x.sede);
      if (x.unit_id) units.set(String(x.unit_id), x.sede);
    });
    lista = { matriculas, units };
    listaAt = Date.now();
    return lista;
  } catch (e) {
    if (lista) {
      console.error('⚠️ [SEDE] No se pudo leer la sede de los coches; sigo con la última lista:', e.message);
      return lista;
    }
    throw e;
  }
}

/** La sede de ese coche si es de OTRA (p. ej. 'barcelona'); null si es de Madrid o no consta. Con la lista ya cargada. */
function sedeAjenaEn(s, { matricula, unitId } = {}) {
  if (!s) return null;
  return (matricula && s.matriculas.get(normMat(matricula)))
    || (unitId != null && unitId !== '' && s.units.get(String(unitId)))
    || null;
}

/** Lo mismo, cargando la lista. Lanza si no hay forma de saberlo. */
async function sedeAjena(coche = {}) {
  return sedeAjenaEn(await cochesDeOtraSede(), coche);
}

/** 'barcelona' → 'Barcelona', para los mensajes. */
const nombreSede = s => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

/** Para las pruebas y por si hiciera falta forzar la relectura. */
const olvidar = () => { lista = null; listaAt = 0; };

module.exports = { cochesDeOtraSede, sedeAjena, sedeAjenaEn, nombreSede, olvidar };
