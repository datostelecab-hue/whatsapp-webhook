// ============================================================
// ETT · SERVICIO — la bolsa de empleo de la agencia
// ============================================================
// Los candidatos de la agencia son candidaturas como las demás, con
// `canal = bolsa_ett`. Una tabla, dos puertas de entrada: en Selección se
// escribe un teléfono, aquí se pega la tabla del correo.
//
// El extra de aquí son las TANDAS (`solicitud`): la unidad con la que se le
// contesta a la agencia, y de la que cuelga si toca mandar Excel o no.
//
// LO QUE ESTE FICHERO SE TRAJO DEL CONTROLADOR, que es lo que de verdad es de
// negocio y no de HTTP:
//   · El NOMBRE DE LA ETT, y el orden en que se decide.
//   · El alta de una candidatura, con el aviso al planificador (y su plaza
//     reservada, si la tenía), que puede fallar sin tumbar el alta.
//   · El «Alta a mano» (23/11/2026), que sustituye al alta rápida: una fila de la
//     tabla del correo escrita a mano, con todo obligatorio.

const cand = require('./candidaturas.service');
const excel = require('./ett.excel');
const incorporaciones = require('./incorporaciones.repo');
const modalidad = require('../Conductores/jornada');

/** Las candidaturas que vienen de la agencia. */
const CANAL = 'bolsa_ett';

/**
 * Con qué ETT se trabaja.
 *
 * El orden importa y se equivocó una vez: el formulario manda el nombre VACÍO
 * cuando no se escribe nada, así que si se pone delante pisa al configurado en
 * el servidor y el alta se cae por falta de nombre. Lo que llega solo manda si
 * trae algo.
 *
 * Y el último recurso es el nombre de la agencia, no la palabra "ETT": ese
 * literal llenó la base de 99 periodos que decían "ETT" a secas y no se sabía
 * con quién estaban contratados.
 */
const POR_DEFECTO = 'GiGroup';
const ettNombre = pedido =>
  String(pedido || '').trim() || process.env.ETT_NOMBRE || POR_DEFECTO;

/**
 * Los contratos que se ofrecen al contratar en la ETT, en horas (Camilo, 14/10/2026:
 * «el contrato (40, 32, 20 horas)»).
 *
 * No salen de `cat_jornada`, como los de «Contratar», y es a propósito: ese
 * catálogo solo tiene 32 y 40, y cada fila lleva sus `dias_ct`, que son los que
 * deciden qué contrato ofrece una vacante de correturnos y cuántos días planifica
 * el cuadrante. Meter ahí las 20 horas cambiaría las dos cosas sin que nadie lo
 * haya pedido.
 */
// El 40 se reparte en 40x5 o 40x4.
const CONTRATOS = [40, 32, 20];
const CONTRATOS_OPCIONES = [
  ...modalidad.DIAS_40.map(d => ({ valor: `40x${d}`, texto: `40x${d}` })),
  { valor: '32', texto: '32 horas' },
  { valor: '20', texto: '20 horas' },
];

// ── Lectura ────────────────────────────────────────────────────────────────

/** Los catálogos para pintar la pantalla. Si fallan, se abre igual. */
async function paraLaPantalla() {
  const vacio = { estados: [], canales: [], turnos: [], zonas: [], campos: [] };
  const catalogos = await cand.catalogos()
    .catch(e => { console.error('❌ [ETT] catálogos:', e.message); return vacio; });
  return { catalogos, contratos: CONTRATOS_OPCIONES };
}

/**
 * La lista y las tandas, en una sola respuesta.
 *
 * CON LAS CERRADAS: a la agencia se le responde también por quien no se
 * presentó o no pasó, así que tienen que verse.
 *
 * Las solicitudes van aquí dentro y no en otra llamada: la pantalla filtra por
 * tanda, y para pintar el filtro hace falta saber por qué fase va cada una. Dos
 * viajes para pintar una barra es un viaje de más.
 *
 * Los recuentos NO se mandan: cada fila ya trae `etiqueta_ett` e
 * `inicio_previsto`, así que la pantalla los saca de lo que está enseñando.
 * Contarlos aquí daba números del total mientras se miraba una sola tanda.
 */
async function lista() {
  const [filas, solicitudes] = await Promise.all([
    cand.listar({ canal: CANAL, incluirCerradas: true }),
    cand.solicitudesETT(),
  ]);
  return { filas, solicitudes };
}

async function ficha(id) {
  const f = await cand.ficha(Number(id));
  if (!f) throw new Error('No existe esa candidatura');
  return { ...f, faltan: await cand.faltantes(f.id) };
}

const catalogos = () => cand.catalogos();

// ── La matriz del correo ───────────────────────────────────────────────────

/**
 * Se pega la tabla del correo y de ahí salen las fichas. Idempotente por
 * teléfono: la agencia reenvía la misma tabla ampliada cada semana, así que
 * pegarla dos veces tiene que ser inofensivo.
 *
 * Sin `solicitudId` se abre una tanda nueva —una tabla pegada es una solicitud—;
 * con él se añade a una que ya existe.
 */
async function importar({ texto, solicitudId, referencia, recibida }, quien) {
  const r = await cand.importarMatriz(texto, quien, { solicitudId, referencia, recibida });
  console.log(`👥 [ETT] solicitud ${r.solicitudId} · ${r.leidas} filas: ` +
    `${r.creados} nuevas · ${r.vuelven} vuelven · ` +
    `${r.yaEstaban} ya estaban · ${r.yaTrabajan} ya trabajan aquí · ${r.errores} con error`);
  // Quien ya está en plantilla y la agencia manda como candidato: se deja dicho
  // en el log con nombre, que es una confusión que conviene poder rastrear.
  r.detalle.filter(d => d.que === 'ya_trabaja')
    .forEach(d => console.log(`   ⚠️  ${d.nombre} (${d.telefono}) — ${d.nota}`));
  return r;
}

// ── El proceso ─────────────────────────────────────────────────────────────

// Por la MISMA puerta que Seleccion: ahi se apartan las fechas del carne y se
// guardan en su documento. Si la ETT fuera directa al repositorio, en su
// formulario las fechas se escribirian y se perderian sin decir nada.
const guardar = (id, datos, quien) => require('./seleccion.service').guardar(id, datos, quien);

// La foto, por la misma puerta que Seleccion: es la misma persona y la misma foto.
const foto = id => require('./seleccion.service').foto(id);
const subirFoto = (id, datos, quien) => require('./seleccion.service').subirFoto(id, datos, quien);
const cambiarEstado = (id, estado, motivo, quien) =>
  cand.cambiarEstado(Number(id), estado, { motivo, ...quien });
const eliminar = (id, quien) => cand.eliminar(Number(id), quien);

/**
 * No pasa, y por qué. El MOTIVO decide a qué estado va —no presentarse no es no
 * superar la entrevista—, así que no se le pasa ningún estado: se pasa el
 * motivo y lo demás lo saca el catálogo.
 */
async function descartar(id, { motivoCodigo, detalle }, quien) {
  const r = await cand.descartar(Number(id), { motivoCodigo, detalle, ...quien });
  console.log(`🚫 [ETT] candidatura ${r.id} no pasa: ${motivoCodigo} → ${r.estado}`);
  return r;
}

/**
 * AVISA AL PLANIFICADOR de que ha entrado alguien: la alerta de «hay alguien
 * nuevo y no tiene coche», que se va sola en cuanto se le da una plaza. Y si
 * tenía una PLAZA RESERVADA (db/277), se le planifica en ella desde su alta.
 *
 * Las vacantes se fueron el 23/11/2026 (Camilo: «vamos a eliminar completamente
 * el módulo de vacantes»): la plaza se guarda desde el planificador.
 *
 * SI FALLA, EL ALTA NO SE CAE. La persona ya está dada de alta y eso es lo que
 * importa; lo demás es un aviso.
 */
async function avisarAlPlanificador(r, conductorId, origen, usuarioId, desde) {
  if (!conductorId) return null;
  let i = null;
  try {
    i = await incorporaciones.crear({ conductorId, origen, desde, usuarioId });
    console.log(`🔔 [ETT] Incorporación ${i && i.id} · ficha ${conductorId}`);
  } catch (e) {
    console.error('⚠️ [ETT] no se pudo crear la incorporación:', e.message);
    r.avisos = [...(r.avisos || []),
      'El alta salió bien, pero el planificador no se ha enterado de que entra alguien: ' + e.message];
  }
  // LA PLAZA RESERVADA (db/277, 23/11/2026): si tenía una, se le planifica en
  // ella desde su alta. Nunca tumba el alta (lo dice el propio servicio).
  const desdeReserva = await require('../Planificacion/reservas.service').alDarDeAlta({ conductorId, usuarioId });
  if (desdeReserva) r.reserva = { planificadaDesde: desdeReserva };
  return i;
}

/**
 * ALTA A MANO (23/11/2026): una fila de la tabla del correo, escrita a mano y
 * con todo obligatorio. Ver candidaturas.service.altaAMano.
 */
async function altaAMano(datos, quien) {
  const r = await cand.altaAMano(datos || {}, quien);
  console.log(`✍️ [ETT] Alta a mano: ${r.nombre} → ${r.que}`);
  return r;
}

/** Pasa a RRHH. Por esta vía el contrato es de ETT salvo que se diga otra cosa. */
async function pasarARRHH(id, datos, quien) {
  const b = datos || {};
  const r = await cand.pasarARRHH(Number(id),
    { tipo: 'ett', ...b, ettNombre: ettNombre(b.ettNombre) }, quien);
  console.log(`👤 [ETT] ${r.quien} pasa a RRHH (ficha ${r.conductorId})` +
    (r.boltEnlazada ? ` — BOLT enlazada${r.boltReactivar ? ` (${r.boltEstado}: REACTIVAR)` : ''}`
      : r.faltaBolt ? ' — SIN cuenta de BOLT' : ''));
  // A Tráfico le llega el aviso de que entra alguien; y si tenía plaza
  // reservada en el planificador, se le planifica en ella desde su alta.
  const incorporacion = await avisarAlPlanificador(r, r.conductorId, 'ett', quien.usuarioId, b.alta);
  return { ...r, incorporacion };
}

// ── Lo que se le devuelve a la agencia ─────────────────────────────────────

/**
 * Ya se le ha contestado. Lo apunta la pantalla justo después de descargar el
 * Excel: el correo lo manda una persona, así que el sistema no puede saberlo
 * solo. De aquí sale la regla del segundo envío.
 */
async function registrarEnvio(solicitudId, formato, quien) {
  const r = await cand.registrarEnvio(Number(solicitudId), { formato, ...quien });
  console.log(`📤 [ETT] solicitud ${r.solicitudId} · envío ${r.orden} (${formato || 'excel'})` +
    (r.cerrada ? ' — cerrada: no queda nadie pendiente' : ` — quedan ${r.pendientes} pendiente(s)`));
  return r;
}

/**
 * ¿Se puede mandar esta tanda? Se pregunta ANTES de descargar.
 *
 * Una descarga del navegador no sabe enseñar un error: si el servidor se niega,
 * el fichero simplemente no aparece y no hay forma de saber por qué. Así que
 * primero se pregunta por aquí —que sí contesta el motivo, con nombres— y solo
 * si sale bien se lanza la descarga.
 */
const comprobar = async solicitudId => ({ filas: (await cand.paraETT({ solicitudId })).length });

/** El Excel de una tanda entera: LA respuesta oficial a una petición suya. */
const excelDeTanda = async solicitudId =>
  ({ bytes: await excel.generarExcelETT(await cand.paraETT({ solicitudId })), nombre: excel.nombreFichero() });

/**
 * El Excel de unos elegidos a mano. Para el resto de veces —"mándame otra vez
 * estos cinco", gente de tandas distintas, lo que se quedó a medias— y se puede
 * generar las veces que haga falta.
 */
const excelDeElegidos = async ids =>
  ({ bytes: await excel.generarExcelETT(await cand.paraETTElegidos(ids)), nombre: excel.nombreFichero() });

module.exports = {
  foto, subirFoto,
  CANAL, POR_DEFECTO, CONTRATOS,
  paraLaPantalla, lista, ficha, catalogos,
  importar, guardar, cambiarEstado, descartar, eliminar,
  pasarARRHH, altaAMano,
  registrarEnvio, comprobar, excelDeTanda, excelDeElegidos,
  _ettNombre: ettNombre,
};
