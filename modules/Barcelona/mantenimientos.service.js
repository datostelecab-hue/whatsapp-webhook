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
// Lo que Barcelona NO tiene (todavía): las citas del taller. Quién lleva el
// coche el día de la cita lo dice el planificador de Madrid y el aviso por
// WhatsApp es suyo; Barcelona tiene su propio planificador (sede_asignacion)
// con cuentas de BOLT, no fichas.

const taller = require('../Vehiculos/taller.service');

const SEDE = 'barcelona';
const SEDES = [SEDE];
const SEDE_NOMBRE = 'Barcelona';

/** Las filas (con el filtro de la pantalla) y las cifras de arriba, sin citas. */
const estadoDeLaFlota = ({ busca, estado } = {}) =>
  taller.estadoDeLaFlota({ busca, estado, sedes: SEDES, conCitas: false });

/** La ficha de un coche de Barcelona; uno de otra sede no se abre desde aquí. */
const ficha = id => taller.ficha(id, { sedes: SEDES, conCitas: false });

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
  estadoDeLaFlota, ficha, informe, registrar, anular, anclar, intervalo,
  // La misma llave que en Madrid: '/taller/apuntar'.
  puedeApuntar: taller.puedeApuntar,
};
