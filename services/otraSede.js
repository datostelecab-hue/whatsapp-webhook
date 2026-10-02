// ============================================================
// LA SEDE DE CADA COCHE — qué puede tocar el bot y qué no
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
// Desde el 02/10/2026 el bot también lo usan los conductores de BARCELONA (ver
// docs/nucleo/Sedes.md), y la regla deja de ser «un coche de otra sede no se
// toca» para ser «EL COCHE TIENE QUE SER DE LA SEDE DE QUIEN LO COGE». Lo que no
// cambia es el motor: el de otra sede no se corta NUNCA, lo pida quien lo pida.
//
// Aquí se sabe de qué sede es cada coche, por MATRÍCULA y por EQUIPO de Mapon
// (las dos cosas: el repaso recorre equipos y el bot recibe matrículas). Lo usan:
//   · fichaje.motor()        nunca CORTA un coche de otra sede, venga de donde
//                            venga la orden («Terminar turno», cierre automático);
//   · el alcance del fichaje «liberar todos» y la lista de motores cortados ni
//                            los miran;
//   · fichaje.iniciar()      el turno, solo en un coche de la sede de la persona
//                            (y en uno de Barcelona el motor no se suelta: se
//                            lleva desde Mapon);
//   · las puertas            el conductor, las de su sede; la oficina con el
//                            permiso /puertas, las de todas (Camilo, 02/10/2026).
//
// UN COCHE QUE NO ESTÁ EN VEHÍCULOS no tiene sede conocida (`sedeDe` da null) y
// cuenta como de Madrid, que es lo que han sido siempre: lo puede llevar un
// conductor de Madrid y no uno de Barcelona.
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

/**
 * { matriculas: Map(matrícula → sede), units: Map(unit_id → sede) } de TODOS los
 * coches. Si una matrícula tiene dos fichas (una de baja y otra viva, como el
 * 9549LTP) manda la viva: va la última y pisa a la otra.
 */
async function cochesDeOtraSede() {
  if (lista && Date.now() - listaAt < TTL_MS) return lista;
  try {
    const r = await db.consulta(
      `SELECT v.matricula_norm, v.sede, a.externo_id AS unit_id
         FROM vehiculo v
         LEFT JOIN vehiculo_alias a
           ON a.vehiculo_id = v.id AND a.sistema = 'mapon' AND a.visto_hasta IS NULL
        WHERE v.sede IS NOT NULL
        ORDER BY (v.baja_at IS NULL), v.id`);
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

/** La sede de ese coche si consta en Vehículos ('madrid', 'barcelona'…); null si no. Con la lista ya cargada. */
function sedeDeEn(s, { matricula, unitId } = {}) {
  if (!s) return null;
  return (matricula && s.matriculas.get(normMat(matricula)))
    || (unitId != null && unitId !== '' && s.units.get(String(unitId)))
    || null;
}

/** La sede de ese coche si es de OTRA (p. ej. 'barcelona'); null si es de Madrid o no consta. Con la lista ya cargada. */
function sedeAjenaEn(s, coche = {}) {
  const sede = sedeDeEn(s, coche);
  return sede && sede !== SEDE_FLOTA ? sede : null;
}

/** Lo mismo, cargando la lista. Lanzan si no hay forma de saberlo. */
const sedeDe = async (coche = {}) => sedeDeEn(await cochesDeOtraSede(), coche);
const sedeAjena = async (coche = {}) => sedeAjenaEn(await cochesDeOtraSede(), coche);

/** 'barcelona' → 'Barcelona', para los mensajes. */
const nombreSede = s => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

/** Para las pruebas y por si hiciera falta forzar la relectura. */
const olvidar = () => { lista = null; listaAt = 0; };

module.exports = { cochesDeOtraSede, sedeDe, sedeAjena, sedeAjenaEn, nombreSede, olvidar };
