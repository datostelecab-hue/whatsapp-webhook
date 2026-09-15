// ============================================================
// NÚCLEO — lo que comparten todas las capas
// ============================================================
// Constantes y funciones PURAS. No hay base de datos, ni red, ni reglas de
// negocio: nada que pueda fallar, nada que haya que simular para probarlo.
//
// Por eso lo puede usar cualquiera —un controlador, un servicio, un
// repositorio— sin saltarse ninguna capa. No es un piso más: es el suelo, como
// `path` o `fs`.
//
// LO QUE **NO** VA AQUÍ: nada que decida. Si una función sabe que una baja
// cierra la asignación, eso es un servicio de dominio y este fichero no es su
// casa. La prueba es sencilla: si para usarlo hay que levantar algo, no va
// aquí.
//
// Esto nació al ordenar las capas: había repositorios llamando hacia arriba, a
// un servicio, y al mirarlos de cerca casi ninguno quería el servicio — querían
// una constante o una función pura que estaba atrapada dentro de él. Sacarlas
// aquí cierra la dependencia sin mover ni una regla de sitio.

// ── LA JORNADA ─────────────────────────────────────────────────────────────
// El día operativo NO es el día natural: va de las 05:00 a las 05:00 del día
// siguiente. El turno de día es 05→17 y el de noche 17→05(+1). Es la base de
// todo lo que cuenta horas en el ERP: Visibilidad, la bitácora, el reporte de
// horas, Control y las alertas.
//
// Estaban repetidas en `flotaViva/rutas.js` y en `auditoriaFlota.js` con la
// misma variable de entorno. Dos copias de la constante que parte el día es la
// forma más silenciosa de que dos pantallas no cuadren: basta con que alguien
// cambie una.
const HORA_DIA = Number(process.env.AUDITORIA_HORA_DIA || 5);
const HORA_NOCHE = Number(process.env.AUDITORIA_HORA_NOCHE || 17);

// ── NOMBRES ────────────────────────────────────────────────────────────────
// Caracteres que no se ven pero cuentan: espacios de ancho cero, marcas de
// dirección de texto, guiones suaves. Vienen pegados de copiar y pegar desde un
// PDF o una hoja, y hacen que dos nombres idénticos en pantalla no lo sean.
const INVISIBLES = /[​-‏⁠﻿­]/g;

/**
 * La clave con la que se compara un nombre: sin tildes, sin signos, en
 * minúsculas y con las palabras ORDENADAS.
 *
 * Ordenarlas es lo importante: "GARCIA LOPEZ, Juan" y "Juan García López" son
 * la misma persona escrita por dos sistemas distintos, y aquí las dos dan
 * "garcia juan lopez".
 */
function normClave(n) {
  return (n || '').toString()
    .replace(INVISIBLES, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}

// ── LAS COLUMNAS DE LA AGENDA ──────────────────────────────────────────────
// El orden de columnas de la hoja AGENDA_V2. Es un CONTRATO DE DATOS, no una
// regla: dice dónde está cada cosa, no qué significa.
//
// Lo leen el motor del planificador y dos repositorios. Mientras vivió dentro
// del motor, los repositorios tenían que llamar hacia arriba para saber en qué
// columna va el teléfono, que es una dependencia absurda por un número.
//
// Los índices son 1..N (columna A = 1), como en la hoja.
const A = {
  ACTIVO: 1, ESTADO: 2, NOMBRE: 3, ID_BOLT: 4, DNI: 5, NAF: 6, FECHA_ALTA: 7,
  FIN_PRUEBA: 8, EN_PRUEBA: 9, RECOMENDADOR: 10, TURNO: 11, CONTRATO: 12,
  L_LUN: 13, L_MAR: 14, L_MIE: 15, L_JUE: 16, L_VIE: 17, L_SAB: 18, L_DOM: 19,
  MATRICULA: 20, BINOMIO: 21, COORDENADAS: 22, DIRECCION: 23, TELEFONO: 24,
  TEL_EMERG: 25, OBSERVACIONES: 26,
  ASG_LUN: 27, ASG_MAR: 28, ASG_MIE: 29, ASG_JUE: 30, ASG_VIE: 31, ASG_SAB: 32, ASG_DOM: 33,
  // Fecha de reincorporación para ausencias temporales (opcional). Columna AH.
  REINCORPORACION: 34,
  // Si su ID_BOLT es PROVISIONAL — o sea, todavía no está dado de alta en BOLT.
  // Solo la rellena la agenda leída de PostgreSQL; desde la hoja viene vacía, y
  // entonces se comporta como antes.
  BOLT_PENDIENTE: 35,
};

// Las cabeceras REALES de la hoja. Son 33: `REINCORPORACION` y `BOLT_PENDIENTE`
// van más allá de la última cabecera escrita, y por eso no aparecen aquí.
const A_HEADERS = [
  'ACTIVO', 'ESTADO', 'NOMBRE_APELLIDOS', 'ID_BOLT', 'DNI_NIE', 'NAF', 'FECHA_ALTA',
  'FIN_PERIODO_PRUEBA', 'EN_PRUEBA', 'RECOMENDADOR', 'TURNO', 'CONTRATO',
  'LIB_LUN', 'LIB_MAR', 'LIB_MIE', 'LIB_JUE', 'LIB_VIE', 'LIB_SAB', 'LIB_DOM',
  'MATRICULA', 'BINOMIO', 'COORDENADAS', 'DIRECCION_COMPLETA', 'TELEFONO',
  'TEL_EMERGENCIA', 'OBSERVACIONES',
  'ASG_LUN', 'ASG_MAR', 'ASG_MIE', 'ASG_JUE', 'ASG_VIE', 'ASG_SAB', 'ASG_DOM',
];

// ── LOS DÍAS DE LA SEMANA ──────────────────────────────────────────────────
// Empiezan en LUNES (índice 0), como el cuadrante y como `getDay()` NO hace.
// Esa es la única razón por la que esto merece estar aquí: el orden europeo no
// es el que trae JavaScript, así que cada copia suelta es una ocasión de
// escribirlo mal en domingo.
//
// Había SEIS copias: en `planificadorV2`, en `repo/cobertura`, en el Excel de
// turnos, en el de la parrilla, en el generador de vacantes y en Control. Media
// docena de arrays idénticos que nadie iba a mantener a la vez, y uno de ellos
// —el del motor del planificador— obligaba al tablero a llamar hacia arriba,
// a un servicio de hojas, solo para saber cómo se abrevia "miércoles".
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
// Miércoles es X, no M: es la letra que usan los cuadrantes de toda la vida
// porque la M ya está cogida por el martes.
const LETRAS_DIA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

module.exports = {
  HORA_DIA, HORA_NOCHE, INVISIBLES, normClave, A, A_HEADERS,
  DIAS_CORTOS, DIAS_LARGOS, LETRAS_DIA,
};
