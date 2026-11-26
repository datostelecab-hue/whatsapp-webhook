// ============================================================
// PARÁMETROS DE NEGOCIO — los números de las reglas, en un solo sitio
// ============================================================
// Hoja de ruta de Ignacio, convención 4: «Todo número de regla es un parámetro.
// Plazos, topes y fechas (5 días, 100 €, día 20, etc.) van en una tabla de
// parámetros editable por un administrador, no en el código». Pieza A3 de
// docs/Hoja de ruta.md (13/11/2026).
//
// EL CATÁLOGO es este fichero: qué parámetros hay, de qué tipo, en qué unidad,
// cuánto valen si nadie los ha cambiado y qué ítem los usa. La base
// (parametro_cambio, db/243) guarda solo los CAMBIOS, sin pisar ninguno. Un
// parámetro nuevo es una entrada más aquí, sin migración.
//
//   const parametros = require('../../services/parametros');
//   const dias = await parametros.valor('sanciones.plazo_dias_habiles');   // 5
//
// El valor sale de una caché de un minuto: se pide en cada uso, no se guarda en
// una constante al arrancar (un cambio tiene que notarse sin desplegar).
//
// UN PLAZO QUE YA CORRE NO CAMBIA. Quien calcula una fecha límite la guarda al
// nacer; cambiar el parámetro solo afecta a lo que nazca después.
//
// Quién los cambia: la llave '/parametros' o el desarrollador por su rol
// (Camilo, 13/11/2026). La pantalla es modules/Parametros.
'use strict';

const repo = require('./repo/parametros');

// ── Los tipos ──────────────────────────────────────────────────────────────
// `entero` lleva su `unidad` (lo que se escribe detrás del número) y sus
// límites; `importe` va en euros con dos decimales; `decimal`, un número con
// coma (`decimales`, 2 si no se dice) y su `unidad`; `texto`, con su largo
// máximo; `horario`, los días de la semana (1 = lunes … 7 = domingo) y la hora
// de abrir y de cerrar, en hora de Madrid.
const UNIDADES = {
  dias_habiles: { una: 'día hábil', varias: 'días hábiles' },
  horas_habiles: { una: 'hora hábil', varias: 'horas hábiles' },
  dias: { una: 'día', varias: 'días' },
  anios: { una: 'año', varias: 'años' },
  mb: { una: 'MB', varias: 'MB' },
  km: { una: 'km', varias: 'km' },
  horas: { una: 'hora', varias: 'horas' },
  pct: { una: '%', varias: '%' },
  dia_mes: null,   // «el día 20 de cada mes»
};

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// ── El catálogo ────────────────────────────────────────────────────────────
// `usa`: dónde se usa ya. Los que solo traen `item` son números que la hoja de
// ruta ya fija y que usará ese ítem cuando se haga: están aquí para que se vean
// y se puedan revisar desde ya, pero cambiarlos aún no cambia nada (la pantalla
// lo dice).
const CATALOGO = [
  // Calendario (convención 3)
  { clave: 'oficina.madrid.horario', modulo: 'Calendario', tipo: 'horario',
    etiqueta: 'Horario de la oficina de Madrid',
    defecto: { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' },
    descripcion: 'Las horas que cuentan como hábiles. Fuera de este horario, en fin de semana o en un festivo, un plazo en horas hábiles se para y sigue al abrir la oficina.',
    usa: 'Los días y las horas hábiles de todos los plazos' },

  // Adjuntos (A6)
  { clave: 'adjuntos.max_mb', modulo: 'Adjuntos', tipo: 'entero', unidad: 'mb', min: 1, max: 95, defecto: 90,
    etiqueta: 'Tamaño máximo de un adjunto',
    descripcion: 'Lo más que puede pesar un fichero que se adjunta (una foto, un PDF, un vídeo). No pasa de 95 MB: '
      + 'Cloudflare, que va delante del ERP, corta las subidas de más de 100 MB.',
    usa: 'La subida de adjuntos (services/adjuntos.js)' },

  // El mapa (18/11/2026)
  { clave: 'mapa.equipo_muerto_dias', modulo: 'Operaciones', tipo: 'entero', unidad: 'dias', min: 1, max: 90, defecto: 7,
    etiqueta: 'Mapa: días sin hablar para dar por muerto un equipo de Mapon',
    descripcion: 'Si un coche tiene dos equipos de Mapon y uno lleva estos días sin hablar mientras el otro sí habla, el callado no se pinta: es un equipo que se quitó o se cambió. '
      + 'Un coche con un solo equipo sale siempre, aunque esté callado («Sin señal»).',
    usa: 'Mapa de flota (modules/Mapa/mapa.repo.js)' },
  // El banco de KM (db/267, 18/11/2026)
  // Desde db/268: lo genera cada hora de VIAJE en BOLT, con un tope al día.
  { clave: 'banco_km.km_hora_viaje', modulo: 'Operaciones', tipo: 'decimal', unidad: 'km', decimales: 1, min: 0, max: 100, defecto: 8.8,
    etiqueta: 'Banco de KM: km fuera de BOLT por cada hora de viaje',
    descripcion: 'Lo que genera para el banco de la semana cada hora de viaje en BOLT (yendo a por el pasajero o llevándolo; la espera no genera). Camilo: «cada hora de viaje en BOLT genera 8,8 km por fuera». '
      + 'Un cambio vale para las jornadas que se calculen desde entonces: las ya calculadas guardan su límite (o se recalculan a mano).',
    usa: 'Banco de KM (modules/Operaciones/bancoKm.service.js)' },
  { clave: 'banco_km.tope_dia', modulo: 'Operaciones', tipo: 'decimal', unidad: 'km', decimales: 1, min: 0, max: 500, defecto: 53,
    etiqueta: 'Banco de KM: lo más que genera un día',
    descripcion: 'El tope de lo que generan las horas de viaje de un día. Camilo: «con un límite de 53 km al día».',
    usa: 'Banco de KM (modules/Operaciones/bancoKm.service.js)' },
  // Los asuntos propios de la oficina (db/271, 18/11/2026): un banco aparte.
  { clave: 'oficina.asuntos_propios.al_ano', modulo: 'Vacaciones', tipo: 'entero', unidad: 'dias', min: 0, max: 30, defecto: 2,
    etiqueta: 'Oficina: días de asuntos propios al año',
    descripcion: 'Lo que se suma cada año natural al banco de asuntos propios de cada persona de la oficina (desde su alta, o desde 2026). Enteros y sin prorratear; lo que no se usa se acumula. No restan vacaciones.',
    usa: 'Permisos de la oficina (modules/VacacionesOficina/vacacionesOficina.service.js)' },
  // Vacaciones de la oficina (db/263, 17/11/2026)
  { clave: 'oficina.vacaciones.tope_mes', modulo: 'Vacaciones', tipo: 'decimal', unidad: 'dias', decimales: 2, min: 0, max: 31, defecto: 1.84,
    etiqueta: 'Vacaciones de la oficina: lo más que genera un mes',
    descripcion: 'Lo que genera cada mes completo, tenga los días laborables que tenga. El mes en curso (y el del alta) genera esto entre los días de un mes medio por cada día del horario. '
      + 'Los conductores tienen su propio tope (1,85).',
    usa: 'Mis vacaciones (modules/VacacionesOficina)' },
  // (Los 22 de una vez cada 1 de enero desde 2027, `oficina.vacaciones.dias_ano`, se quitaron el
  // 26/11/2026: todos los años se genera día a día. Ver Vacaciones de la oficina.)

  // Tablero de tareas (ítem 1, entrega 1c)
  { clave: 'tablero.plazo_colas_dias_habiles', modulo: 'Tablero', item: 1, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 2,
    etiqueta: 'Plazo de las tarjetas de las colas',
    descripcion: 'Las J, las −J, las correcciones de fichaje y las vacaciones nacen en el tablero ya asignadas a quien las resuelve, '
      + 'con este plazo desde que entran. Con 0, vencen el mismo día.',
    usa: 'Las tarjetas de las colas (services/tableroColas.js y modules/Ticketera/tarjetas.js)' },
  // Fase 1 — RR. HH.
  { clave: 'expedientes.despido.plazo_dias_habiles', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 3,
    etiqueta: 'Plazo para aplicar un despido',
    descripcion: 'Desde que la propuesta de despido validada por Dirección llega al panel de RR. HH.' },
  { clave: 'expedientes.recurso.plazo_dias_habiles', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 2,
    etiqueta: 'Plazo para responder un recurso',
    descripcion: 'Recursos de sanciones o de descuentos.' },
  { clave: 'nomina.dia_regularizaciones', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 25,
    etiqueta: 'Día de presentar regularizaciones e indemnizaciones',
    descripcion: 'RR. HH. las presenta ese día de cada mes para aplicarlas en la nómina.' },
  { clave: 'sanciones.plazo_dias_habiles', modulo: 'RR. HH.', item: 5, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 5,
    etiqueta: 'Plazo para comunicar una sanción',
    descripcion: 'Cuenta desde que Ángel, William o Ignacio aprueban el ticket de sanción.' },
  { clave: 'sanciones.dia_limite_suspension', modulo: 'RR. HH.', item: 5, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 26,
    etiqueta: 'Día límite para registrar una suspensión',
    descripcion: 'Una suspensión de empleo y sueldo se registra antes de este día del mes.' },
  { clave: 'cartas.plazo_dias_habiles', modulo: 'RR. HH.', item: 6, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 4,
    etiqueta: 'Plazo de RR. HH. para una carta de descuento',
    descripcion: 'Desde que se registra el motivo del descuento.' },
  { clave: 'cartas.margen_corte_dias_habiles', modulo: 'RR. HH.', item: 6, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 4,
    etiqueta: 'Margen antes del corte de la nómina',
    descripcion: 'Lo registrado después de esa fecha pasa a la nómina del mes siguiente.' },
  // La plantilla de la gestoría (módulo 8, db/287). Sin valor (0 o vacío), no se enseña.
  { clave: 'gestoria.coste_ss_dia', modulo: 'RR. HH.', tipo: 'importe', min: 0, max: 500, defecto: 0, usa: 'Plantilla de la gestoría (modules/Gestoria)',
    etiqueta: 'Coste diario estimado de Seguridad Social por trabajador',
    descripcion: 'Para estimar lo que cuesta cada día que la gestoría tiene de alta a alguien que para nosotros ya se fue. A 0, no se calcula.' },
  { clave: 'gestoria.correo', modulo: 'RR. HH.', tipo: 'texto', max: 120, vacio: true, defecto: '', usa: 'Plantilla de la gestoría (modules/Gestoria)',
    etiqueta: 'Correo de la gestoría',
    descripcion: 'A quién va el correo con las correcciones de la plantilla. Vacío, el correo se copia a mano.' },
  // EL SMS CERTIFICADO DE MENSATEK (módulo 9, db/306): los datos del emisor que
  // Mensatek pide en cada envío, el remitente y los días que se intenta entregar.
  { clave: 'mensatek.contacto', modulo: 'RR. HH.', item: 9, tipo: 'texto', max: 120, defecto: 'TIBUS LUXURY SERVICES, S.L.', usa: 'SMS certificado (modules/RRHH/sms.service.js)',
    etiqueta: 'SMS certificado · nombre de la empresa que lo manda',
    descripcion: 'Sale en el certificado como emisor de la notificación.' },
  { clave: 'mensatek.telefono', modulo: 'RR. HH.', item: 9, tipo: 'texto', max: 20, vacio: true, defecto: '', usa: 'SMS certificado (modules/RRHH/sms.service.js)',
    etiqueta: 'SMS certificado · teléfono de contacto de la empresa',
    descripcion: 'Mensatek lo pide en cada envío. Vacío, no se puede mandar ninguno.' },
  { clave: 'mensatek.cif', modulo: 'RR. HH.', item: 9, tipo: 'texto', max: 20, vacio: true, defecto: '', usa: 'SMS certificado (modules/RRHH/sms.service.js)',
    etiqueta: 'SMS certificado · CIF de la empresa',
    descripcion: 'Mensatek lo pide en cada envío. Vacío, no se puede mandar ninguno.' },
  { clave: 'mensatek.remitente', modulo: 'RR. HH.', item: 9, tipo: 'texto', max: 11, vacio: true, defecto: '', usa: 'SMS certificado (modules/RRHH/sms.service.js)',
    etiqueta: 'SMS certificado · remitente',
    descripcion: 'Vacío: el que tenga la cuenta de Mensatek por defecto. Si se pone uno, tiene que estar registrado en la CNMC y validado en la cuenta, o la operadora lo rechaza.' },
  { clave: 'mensatek.dias_validez', modulo: 'RR. HH.', item: 9, tipo: 'entero', unidad: 'dias', min: 1, max: 20, defecto: 3, usa: 'SMS certificado (modules/RRHH/sms.service.js)',
    etiqueta: 'SMS certificado · días que se intenta entregar',
    descripcion: 'Si el móvil está apagado, Mensatek lo reintenta durante estos días; después, caduca.' },
  { clave: 'finiquitos.correo_ett', modulo: 'RR. HH.', item: 7, tipo: 'texto', max: 120, vacio: true, defecto: '', usa: 'Finiquitos (modules/RRHH/finiquitos.service.js)',
    etiqueta: 'Correo de la ETT para los finiquitos',
    descripcion: 'A quién va solo, al aprobarlo, el finiquito de quien viene de ETT. Vacío, se manda a mano y se marca enviado. Los de plantilla propia van al «Correo de la gestoría».' },
  // Los descuentos en nómina (módulo 4.2, db/298).
  { clave: 'descuentos.km_euro', modulo: 'RR. HH.', item: 4, tipo: 'importe', min: 0, max: 10, defecto: 1, usa: 'Descuentos en nómina (modules/RRHH/descuentos.service.js)',
    etiqueta: 'Precio de cada km de más (Banco de KM)',
    descripcion: 'Lo que se descuenta por cada km que pasa del límite de su semana en el Banco de KM. A 0, no se generan.' },
  { clave: 'descuentos.concepto_efectivo', modulo: 'RR. HH.', item: 4, tipo: 'texto', max: 4, defecto: '753', usa: 'Descuentos en nómina',
    etiqueta: 'Concepto de A3: efectivo sin entregar', descripcion: 'El código del concepto en la nómina de A3 («753 DTO DEVOLUCION EFECTIVO»).' },
  { clave: 'descuentos.concepto_km', modulo: 'RR. HH.', item: 4, tipo: 'texto', max: 4, defecto: '758', usa: 'Descuentos en nómina',
    etiqueta: 'Concepto de A3: km fuera de la aplicación', descripcion: 'El código del concepto en la nómina de A3 («758 Descuento vehículo»).' },
  { clave: 'descuentos.concepto_siniestro', modulo: 'RR. HH.', item: 4, tipo: 'texto', max: 4, defecto: '751', usa: 'Descuentos en nómina',
    etiqueta: 'Concepto de A3: siniestro', descripcion: 'El código del concepto en la nómina de A3 («751 DTO FRANQUICIA»).' },
  { clave: 'descuentos.concepto_otro', modulo: 'RR. HH.', item: 4, tipo: 'texto', max: 4, defecto: '754', usa: 'Descuentos en nómina',
    etiqueta: 'Concepto de A3: combustible y otros', descripcion: 'El código del concepto en la nómina de A3 («754 DESCUENTO»).' },
  // El cierre de la nómina del mes (módulo 4, db/299): el día de cada etapa.
  // La de las variables y los descuentos es el del corte.
  { clave: 'nomina.cierre_proforma', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 20,
    usa: 'Cierre de la nómina (modules/Gestoria/cierre.service.js)',
    etiqueta: 'Cierre de la nómina: proforma revisada',
    descripcion: 'El día del mes en que la proforma de A3 tiene que estar revisada. Tres días hábiles antes nace la tarjeta.' },
  { clave: 'nomina.cierre_borrador', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 28,
    usa: 'Cierre de la nómina (modules/Gestoria/cierre.service.js)',
    etiqueta: 'Cierre de la nómina: borrador revisado',
    descripcion: 'El día del mes en que el borrador de la gestoría tiene que estar revisado.' },
  { clave: 'nomina.cierre_aprobada', modulo: 'RR. HH.', item: 4, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 30,
    usa: 'Cierre de la nómina (modules/Gestoria/cierre.service.js)',
    etiqueta: 'Cierre de la nómina: nómina aprobada',
    descripcion: 'El día del mes en que la nómina tiene que estar aprobada (en un mes más corto, su último día).' },
  // La capacidad de la flota al aprobar vacaciones (módulo 2, db/302).
  { clave: 'vacaciones.capacidad_horas_mes', modulo: 'Vacaciones', tipo: 'entero', unidad: 'horas', min: 0, max: 500000, defecto: 32000,
    usa: 'Vacaciones: la capacidad (modules/Vacaciones/capacidad.js)',
    etiqueta: 'Horas al mes que tiene que hacer la flota',
    descripcion: 'Entre todos, de media al mes. Si unas vacaciones dejan a los que trabajan (cada uno con su promedio de horas, los días que le tocan) por debajo, se avisa y aprobarlas pide un motivo.' },
  { clave: 'vacaciones.capacidad_festivo_pct', modulo: 'Vacaciones', tipo: 'decimal', unidad: 'pct', decimales: 1, min: 0, max: 50, defecto: 3,
    usa: 'Vacaciones: la capacidad (modules/Vacaciones/capacidad.js)',
    etiqueta: 'Más horas por cada festivo del tramo (%)',
    descripcion: 'Lo que crecen las horas que hacen falta por cada festivo que cae en las vacaciones que se piden.' },
  { clave: 'nomina.dia_corte', modulo: 'RR. HH.', item: 6, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 25,
    etiqueta: 'Día del corte de la nómina',
    descripcion: 'La «nómina del 25» de la hoja de ruta.' },
  { clave: 'nomina.dia_pendientes', modulo: 'RR. HH.', item: 7, tipo: 'entero', unidad: 'dia_mes', min: 1, max: 31, defecto: 20,
    etiqueta: 'Día del informe de pendientes de nómina',
    descripcion: 'Si no es hábil, se genera el hábil anterior.' },
  { clave: 'bajas.plazo_pin_dias_habiles', modulo: 'RR. HH.', item: 8, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 10, defecto: 1,
    etiqueta: 'Plazo para anular credenciales y PIN',
    descripcion: 'Tarea de Daiane al cerrar una baja o un despido.' },

  // Fase 2 — Administración
  { clave: 'multas.urgente_si_quedan_dias_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 5,
    etiqueta: 'Multa urgente si quedan menos de',
    descripcion: 'Días hábiles hasta la fecha límite de identificación al subirla.' },
  { clave: 'multas.urgente_respuesta_horas_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'horas_habiles', min: 1, max: 120, defecto: 24,
    etiqueta: 'Plazo de respuesta de una multa urgente' },
  { clave: 'multas.aviso_dias_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 60, defecto: 10,
    etiqueta: 'Aviso a Daiane antes del vencimiento' },
  { clave: 'multas.identificar_antes_dias_habiles', modulo: 'Administración', item: 10, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 5,
    etiqueta: 'Identificar la multa al menos antes del vencimiento' },
  { clave: 'itv.aviso_dias', modulo: 'Administración', item: 14, tipo: 'entero', unidad: 'dias', min: 1, max: 120, defecto: 30,
    etiqueta: 'Aviso de ITV antes de que venza',
    descripcion: 'Aviso a Daiane y tarea de coordinar con tráfico que el coche vaya a la inspección.' },
  { clave: 'reintegros.tope_daiane', modulo: 'Administración', item: 15, tipo: 'importe', min: 0, max: 10000, defecto: 100,
    etiqueta: 'Tope de reintegro que aprueba Daiane',
    descripcion: 'Por encima, la aprobación pasa a Ignacio.' },

  // Fase 3 — Flota y taller
  { clave: 'taller.acuse_dias_habiles', modulo: 'Flota y taller', item: 16, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 10, defecto: 1,
    etiqueta: 'Plazo del acuse de una avería' },
  { clave: 'taller.fecha_taller_dias_habiles', modulo: 'Flota y taller', item: 16, tipo: 'entero', unidad: 'dias_habiles', min: 1, max: 30, defecto: 5,
    etiqueta: 'Plazo para dar fecha de taller',
    descripcion: 'Insumos comprados y fecha y hora de taller comunicadas al conductor.' },
  // EL TELÉFONO DE TRÁFICO EN EL PORTAL (24/11/2026, las heurísticas de Nielsen):
  // los avisos de la app dicen «comunícate con Tráfico»; con este número, al lado
  // sale un botón «Llamar a Tráfico». Vacío, no sale el botón.
  { clave: 'portal.telefono_trafico', modulo: 'Operaciones', tipo: 'texto', max: 20, vacio: true, defecto: '',
    etiqueta: 'Portal de conductores: teléfono de Tráfico',
    descripcion: 'El número al que llama el botón «Llamar a Tráfico» del portal de conductores (en los avisos de error y en la Ayuda). Nueve cifras; vacío, no sale el botón.',
    usa: 'Portal de conductores (modules/Portal)' },
  { clave: 'taller.acuse_texto', modulo: 'Flota y taller', item: 16, tipo: 'texto', max: 400,
    defecto: 'Recibimos tu aviso y estamos haciendo las comprobaciones para la bajada programada del coche',
    etiqueta: 'Texto del acuse de una avería' },
  { clave: 'taller.antelacion_minima_dias_habiles', modulo: 'Flota y taller', item: 17, tipo: 'entero', unidad: 'dias_habiles', min: 0, max: 30, defecto: 2,
    etiqueta: 'Antelación mínima de un mantenimiento programado',
    descripcion: 'El sistema no acepta una salida a taller con menos antelación.' },
  { clave: 'siniestros.parte_horas_habiles', modulo: 'Flota y taller', item: 18, tipo: 'entero', unidad: 'horas_habiles', min: 1, max: 72, defecto: 5,
    etiqueta: 'Plazo para abrir el parte de un siniestro' },
  { clave: 'polizas.aviso_dias', modulo: 'Flota y taller', item: 19, tipo: 'entero', unidad: 'dias', min: 1, max: 365, defecto: 60,
    etiqueta: 'Tarea de renovación antes de que venza una póliza' },

  // Fase 0 — Chat
  { clave: 'chat.conservacion_anios', modulo: 'Chat', item: 2, tipo: 'entero', unidad: 'anios', min: 1, max: 20, defecto: 5,
    etiqueta: 'Años que se conserva el chat' },
];

const POR_CLAVE = new Map(CATALOGO.map(p => [p.clave, p]));

function definicion(clave) {
  const p = POR_CLAVE.get(String(clave || ''));
  if (!p) throw new Error(`No existe el parámetro «${clave}»`);
  return p;
}

const copia = v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// ── Validar lo que se escribe ──────────────────────────────────────────────
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function aEntero(v, p) {
  const s = String(v == null ? '' : v).trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`«${p.etiqueta}» va en números enteros`);
  const n = Number(s);
  if (p.min != null && n < p.min) throw new Error(`«${p.etiqueta}» no puede ser menos de ${p.min}`);
  if (p.max != null && n > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max}`);
  return n;
}

function aImporte(v, p) {
  const s = String(v == null ? '' : v).replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(s);
  if (!s || !Number.isFinite(n)) throw new Error(`«${p.etiqueta}» va en euros («100» o «99,50»)`);
  const r = Math.round(n * 100) / 100;
  if (p.min != null && r < p.min) throw new Error(`«${p.etiqueta}» no puede ser menos de ${p.min} €`);
  if (p.max != null && r > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max} €`);
  return r;
}

function aDecimal(v, p) {
  const s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  if (!s || !Number.isFinite(n)) throw new Error(`«${p.etiqueta}» va con coma («1,84»)`);
  const k = 10 ** (p.decimales == null ? 2 : p.decimales);
  const r = Math.round(n * k) / k;
  if (p.min != null && r < p.min) throw new Error(`«${p.etiqueta}» no puede ser menos de ${p.min}`);
  if (p.max != null && r > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max}`);
  return r;
}

function aHorario(v, p) {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (_) { return null; } })() : v;
  if (!o || typeof o !== 'object') throw new Error(`«${p.etiqueta}»: faltan los días y las horas`);
  const dias = [...new Set((Array.isArray(o.dias) ? o.dias : []).map(Number))]
    .filter(d => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  if (!dias.length) throw new Error(`«${p.etiqueta}»: marca al menos un día`);
  const desde = String(o.desde || '').trim(), hasta = String(o.hasta || '').trim();
  if (!HORA.test(desde) || !HORA.test(hasta)) throw new Error(`«${p.etiqueta}»: las horas van como 09:00`);
  if (desde >= hasta) throw new Error(`«${p.etiqueta}»: la hora de cerrar tiene que ser después de la de abrir`);
  return { dias, desde, hasta };
}

function aTexto(v, p) {
  const s = String(v == null ? '' : v).trim();
  // `vacio: true`: en blanco es un valor válido (p. ej. «sin teléfono, no sale el botón»).
  if (!s) { if (p.vacio) return ''; throw new Error(`«${p.etiqueta}» no puede quedar en blanco`); }
  if (p.max && s.length > p.max) throw new Error(`«${p.etiqueta}» no puede pasar de ${p.max} letras`);
  return s;
}

/** Lo que se escribió, convertido al tipo del parámetro. Lanza con un mensaje que se puede enseñar. */
function validar(clave, crudo) {
  const p = definicion(clave);
  if (p.tipo === 'entero') return aEntero(crudo, p);
  if (p.tipo === 'importe') return aImporte(crudo, p);
  if (p.tipo === 'decimal') return aDecimal(crudo, p);
  if (p.tipo === 'horario') return aHorario(crudo, p);
  if (p.tipo === 'texto') return aTexto(crudo, p);
  throw new Error(`Tipo de parámetro desconocido: ${p.tipo}`);
}

// ── Escribirlo para una persona ────────────────────────────────────────────
const euros = n => Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

function diasEnTexto(dias) {
  const d = [...dias].sort((a, b) => a - b);
  const seguidos = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos && d.length > 2) return `de ${DIAS_SEMANA[d[0] - 1]} a ${DIAS_SEMANA[d[d.length - 1] - 1]}`;
  return d.map(x => DIAS_SEMANA[x - 1]).join(', ');
}

/** «5 días hábiles», «100,00 €», «el día 20 de cada mes», «de lunes a viernes, de 09:00 a 18:00». */
function formatear(clave, valor) {
  const p = definicion(clave);
  if (valor == null) return '';
  if (p.tipo === 'importe') return euros(valor);
  if (p.tipo === 'texto') return String(valor);
  if (p.tipo === 'horario') return `${diasEnTexto(valor.dias)}, de ${valor.desde} a ${valor.hasta}`;
  if (p.unidad === 'dia_mes') return `el día ${valor} de cada mes`;
  const u = UNIDADES[p.unidad];
  if (p.tipo === 'decimal') {
    const txt = Number(valor).toLocaleString('es-ES', { maximumFractionDigits: p.decimales == null ? 2 : p.decimales });
    return u ? `${txt} ${Number(valor) === 1 ? u.una : u.varias}` : txt;
  }
  return u ? `${valor} ${valor === 1 ? u.una : u.varias}` : String(valor);
}

// ── La caché ───────────────────────────────────────────────────────────────
// Todos los cambios de todos los parámetros son pocas filas: se leen de una vez
// y se guardan un minuto. Quien cambia uno la tira.
const DURA_MS = 60 * 1000;
let cache = null;   // { at, porClave: Map<clave, cambios ordenados por desde> }

async function cargar() {
  if (cache && Date.now() - cache.at < DURA_MS) return cache.porClave;
  const porClave = new Map();
  for (const f of await repo.cambios()) {
    if (!porClave.has(f.clave)) porClave.set(f.clave, []);
    porClave.get(f.clave).push(f);
  }
  cache = { at: Date.now(), porClave };
  return porClave;
}

/** Tira la caché: lo llama quien cambia un parámetro (y los tests entre uno y otro). */
function invalidar() { cache = null; }

/** El cambio que vale en `en` (el último que ya había empezado), o null. */
function vigenteEn(cambios, en) {
  const t = en.getTime();
  let v = null;
  for (const c of cambios || []) if (new Date(c.desde).getTime() <= t) v = c;
  return v;
}

/**
 * El valor de un parámetro ahora (o en `en`, una fecha o un instante). Sin
 * cambios, el del catálogo.
 */
async function valor(clave, { en } = {}) {
  const p = definicion(clave);
  const cuando = en ? new Date(en) : new Date();
  const c = vigenteEn((await cargar()).get(p.clave), cuando);
  return copia(c ? c.valor : p.defecto);
}

/** Lo que pinta la pantalla: cada parámetro con su valor de hoy y su último cambio. */
async function lista() {
  const porClave = await cargar();
  const ahora = new Date();
  return CATALOGO.map(p => {
    const cambios = porClave.get(p.clave) || [];
    const c = vigenteEn(cambios, ahora);
    const v = c ? c.valor : p.defecto;
    return {
      clave: p.clave, modulo: p.modulo, etiqueta: p.etiqueta, descripcion: p.descripcion || '',
      tipo: p.tipo, unidad: p.unidad || null, min: p.min, max: p.max,
      item: p.item || null, usa: p.usa || null, enUso: !!p.usa,
      valor: copia(v), texto: formatear(p.clave, v),
      defecto: copia(p.defecto), textoDefecto: formatear(p.clave, p.defecto),
      esDefecto: !c,
      cambios: cambios.length,
      ultimo: c ? { quien: c.quien || null, cuando: c.desde, motivo: c.motivo } : null,
    };
  });
}

/** La historia de un parámetro, del cambio más nuevo al más viejo. */
async function historial(clave) {
  const p = definicion(clave);
  const cambios = ((await cargar()).get(p.clave) || []).slice().reverse();
  return cambios.map(c => ({
    id: Number(c.id), valor: copia(c.valor), texto: formatear(p.clave, c.valor),
    desde: c.desde, motivo: c.motivo, quien: c.quien || null,
  }));
}

/**
 * Cambia un parámetro desde ahora. Exige el motivo y que sea de verdad otro
 * valor. Devuelve el parámetro como lo pinta la lista.
 */
async function cambiar(clave, crudo, { usuarioId, motivo } = {}) {
  const p = definicion(clave);
  const m = String(motivo == null ? '' : motivo).trim();
  if (m.length < 3) throw new Error('Di por qué se cambia: queda en la historia del parámetro');
  const nuevo = validar(p.clave, crudo);
  const actual = await valor(p.clave);
  if (JSON.stringify(nuevo) === JSON.stringify(actual)) throw new Error('Ese ya es el valor que tiene');
  await repo.insertarCambio({
    clave: p.clave, valorJson: JSON.stringify(nuevo), motivo: m.slice(0, 500), usuarioId: Number(usuarioId) || null,
  });
  invalidar();
  return (await lista()).find(x => x.clave === p.clave);
}

module.exports = { CATALOGO, DIAS_SEMANA, definicion, validar, formatear, valor, lista, historial, cambiar, invalidar };
