// ============================================================
// BARCELONA · MANTENIMIENTOS — el taller de los coches de Barcelona
// ============================================================
// Camilo, 04/11/2026: «habilitar en mantenimientos los coches de Barcelona,
// replica el módulo en el sistema de Barcelona, con los coches que estén en el
// ERP como sede Barcelona».
//
// ES EL MÓDULO DE MADRID CON SUS COCHES, no una copia. La regla de cuándo toca
// revisión (odómetro de hoy − km de la última revisión, el ritmo, el semáforo)
// vive en `modules/Vehiculos/taller.*`, y las tablas son las mismas
// (`mantenimiento`, `odometro_ancla`, `vehiculo_km_dia`): un apunte es de un
// coche, y el coche ya dice su sede (`vehiculo.sede`). Copiarlo serían dos
// semáforos que tarde o temprano dirían cosas distintas del mismo coche.
//
// Lo que hace este fichero es FIJAR LA SEDE en un solo sitio: todo lo que pasa
// por aquí lleva `sedes: ['barcelona']`, para leer y para escribir. El
// controlador no puede olvidársela en una ruta porque no la ve.
//
// LAS CITAS DEL TALLER, SOLO AGENDA (04/11/2026). Camilo: «pon también las
// citas del taller para Barcelona… pero sin envíos de WhatsApp… ni
// confirmaciones, solo agregar citas». Se suben con el Excel del taller o se
// ponen a mano, con las reglas de Madrid (un coche, una cita por día), y salen
// en la lista y en el estado de la flota. Ni responsable, ni aviso, ni
// confirmación, ni Control: `citas.service` las trata de agenda por ser de un
// coche de otra sede, y lo que avisa o confirma las rechaza. De su estado, solo
// ANULAR (Camilo, 04/11/2026: «ponle también anular las citas»), con motivo.

const taller = require('../Vehiculos/taller.service');
const citasTaller = require('../Vehiculos/citas.service');

const SEDE = 'barcelona';
const SEDES = [SEDE];
const SEDE_NOMBRE = 'Barcelona';

/** Las filas (con el filtro de la pantalla), con su próxima cita, y las cifras de arriba. */
const estadoDeLaFlota = ({ busca, estado } = {}) =>
  taller.estadoDeLaFlota({ busca, estado, sedes: SEDES });

/** La ficha de un coche de Barcelona; uno de otra sede no se abre desde aquí. */
const ficha = id => taller.ficha(id, { sedes: SEDES });
// El historial de mantenimientos (db/241), con los coches de Barcelona.
const historial = ({ desde, hasta } = {}) => taller.historial({ sedes: SEDES, desde, hasta });
const mantenimiento = id => taller.mantenimiento(id, { sedes: SEDES });

// Las citas: leer, los coches que se pueden citar y añadir (a mano o el Excel).
const citas = ({ desde, hasta } = {}) => citasTaller.lista({ desde, hasta, sede: SEDE });
const cita = id => citasTaller.ficha(id, { sede: SEDE });
const cochesParaCita = () => citasTaller.cochesParaCita({ sede: SEDE });
const crearCita = (datos, { usuarioId }) => citasTaller.crear(datos, { usuarioId }, { sede: SEDE });
const importarCitas = (datos, { usuarioId }) => citasTaller.importar(datos, { usuarioId }, { sede: SEDE });

/**
 * ANULA una cita de Barcelona. El motivo es obligatorio y queda en su
 * seguimiento. Solo anular: ni «hecha» ni «no se presentó». Una anulada vuelve
 * poniéndola otra vez ese día con «Nueva cita», como en Madrid.
 */
async function anularCita(id, motivo, { usuarioId }) {
  const c = await citasTaller.ficha(id, { sede: SEDE });   // de Barcelona, o «No existe esa cita»
  if (c.estado !== 'pendiente') throw new Error(`Esa cita ya está «${c.estadoEtiqueta.toLowerCase()}»: solo se anula una pendiente`);
  return citasTaller.cambiarEstado(id, { estado: 'anulada', nota: motivo }, { usuarioId }, { sede: SEDE });
}

/** El informe en Excel o PDF, con los coches de Barcelona y su nombre en el título. */
const informe = formato => taller.informe(formato, { sedes: SEDES, sedeNombre: SEDE_NOMBRE });

// Las escrituras: quién firma sale de la sesión (lo pone el controlador); la
// sede, de aquí. Un id de un coche de Madrid se rechaza en el servicio del taller.
const registrar = (datos, { usuarioId }) => taller.registrar(datos, { usuarioId, sedes: SEDES });
const anular = (id, motivo, { usuarioId }) => taller.anular(id, motivo, { usuarioId, sedes: SEDES });
const anclar = (datos, { usuarioId }) => taller.anclar(datos, { usuarioId, sedes: SEDES });
const intervalo = datos => taller.intervalo(datos, { sedes: SEDES });

module.exports = {
  SEDE, SEDE_NOMBRE,
  // Los catálogos con los que se pinta la pantalla: los del taller, tal cual.
  INTERVALO: taller.INTERVALO, TIPOS: taller.TIPOS, ESTADOS: taller.ESTADOS,
  CATEGORIAS: taller.CATEGORIAS, PARTES: taller.PARTES,
  estadoDeLaFlota, ficha, historial, mantenimiento, informe, registrar, anular, anclar, intervalo,
  citas, cita, cochesParaCita, crearCita, importarCitas, anularCita,
  // La misma llave que en Madrid: '/taller/apuntar'.
  puedeApuntar: taller.puedeApuntar,
};
