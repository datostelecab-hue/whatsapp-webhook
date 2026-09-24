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
//   · Las dos altas —la de una candidatura y la rápida— con su reserva de
//     vacante, que puede fallar sin tumbar el alta.

const cand = require('./candidaturas.repo');
const vacantes = require('./vacantes.service');
const excel = require('./ett.excel');
const alta = require('../../services/repo/alta');
const incorporaciones = require('../../services/repo/incorporaciones');

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

// ── Lectura ────────────────────────────────────────────────────────────────

/** Los catálogos para pintar la pantalla. Si fallan, se abre igual. */
async function paraLaPantalla() {
  const vacio = { estados: [], canales: [], turnos: [], zonas: [], campos: [] };
  const catalogos = await cand.catalogos()
    .catch(e => { console.error('❌ [ETT] catálogos:', e.message); return vacio; });
  return { catalogos };
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

/**
 * Las vacantes ABIERTAS para elegir al dar de alta.
 *
 * El texto lleva la jornada y, si es un recambio, a quién releva: quien
 * contrata desde aquí tiene que saber qué está ofreciendo antes de prometerlo.
 */
async function vacantesAbiertas() {
  const abiertas = await vacantes.disponibles();
  return {
    vacantes: abiertas.map(v => ({
      id: v.codigo,
      texto: [v.puesto, v.zonas, v.matriculas,
        v.libranzas ? 'libra ' + v.libranzas : '',
        v.motivo === 'recambio' && v.sustituye ? '↔ releva a ' + v.sustituye : '',
      ].filter(Boolean).join(' · ') + ` (${v.codigo})`,
    })),
  };
}

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
 * AVISA AL PLANIFICADOR de que ha entrado alguien. Siempre, con vacante o sin
 * ella —son dos avisos distintos y los dos hacen falta—:
 *
 *   CON vacante  nace la alerta con la foto de lo prometido y, acto seguido,
 *                la persona OCUPA esas plazas desde `desde`.
 *   SIN vacante  nace la alerta de «hay alguien nuevo y no tiene coche», que no
 *                hay nada que aceptar y se va sola en cuanto se le da una plaza.
 *
 * LO SEGUNDO FALTABA, y es justo lo que le pasó a Óscar Góngora el 23/09/2026:
 * se le dio el alta rápida sin elegir vacante, se quedó contratado y en la
 * lista de la ETT —y el cuadrante no se enteró de que había una persona nueva
 * esperando coche—. `incorporaciones.crear` ya sabía hacerlo desde el
 * 18/09; lo que pasaba es que esta función se salía antes de llamárselo.
 *
 * El orden importa y es el de siempre: primero queda escrito qué se le
 * prometió, y después se escribe en el cuadrante. Si lo segundo falla, lo
 * primero sigue ahí y se puede colocar a mano.
 *
 * SI FALLA, EL ALTA NO SE CAE. La persona ya está dada de alta y eso es lo que
 * importa; que la vacante no quedara amarrada es un aviso, no un motivo para
 * deshacerlo todo y dejar a alguien a medio contratar.
 */
async function avisarAlPlanificador(r, conductorId, vacanteId, origen, usuarioId, desde) {
  if (!conductorId) return null;
  let i = null;
  try {
    i = await incorporaciones.crear({ conductorId, vacanteId, origen, desde, usuarioId });
    console.log(`🔔 [ETT] Incorporación ${i.id} · ficha ${conductorId}` +
      (vacanteId ? ` → vacante ${vacanteId}` : ' · SIN vacante: hay que darle coche'));
  } catch (e) {
    console.error('⚠️ [ETT] no se pudo crear la incorporación:', e.message);
    r.avisos = [...(r.avisos || []), vacanteId
      ? 'El alta salió bien, pero la vacante no se pudo reservar: ' + e.message
      : 'El alta salió bien, pero el planificador no se ha enterado de que entra alguien: ' + e.message];
    return null;
  }

  // Sin vacante no hay plazas que ocupar: la alerta ya dice lo que tenía que
  // decir y se irá sola en cuanto alguien le dé un coche.
  if (!i || !i.vacanteId) return i;

  // Y SE COLOCA EN EL ACTO, desde su fecha prevista de alta.
  //
  // Antes esto dejaba solo una alerta y la plaza seguía libre a la vista de
  // todos hasta que alguien de Tráfico entraba a aceptarla: se la podía llevar
  // otro, y el que acababa de firmar no estaba en ningún sitio. Ahora la plaza
  // es suya desde el minuto uno y la alerta pasa a ser un aviso de lo hecho:
  // Tráfico solo tiene que tocar algo si NO le vale, y entonces rechaza —lo
  // que ahora también lo SACA del cuadrante—.
  //
  // Por la puerta del módulo de Planificación, y pedido aquí dentro para que
  // dos servicios que se llaman no se queden a medio cargar.
  try {
    const tablero = require('../Planificacion/tablero.service');
    i.colocada = await tablero.colocarIncorporacion(i.id, desde, { usuarioId });
  } catch (e) {
    // El alta NO se cae por esto: la persona ya está contratada. Se dice, y
    // la alerta se queda pendiente para colocarla a mano.
    console.error('⚠️ [ETT] no se pudo colocar en la vacante:', e.message);
    r.avisos = [...(r.avisos || []),
      'El alta salió bien y la vacante queda reservada, pero no se pudo colocar en el cuadrante: '
      + e.message + '. Hay que aceptar la incorporación a mano en el planificador.'];
  }
  return i;
}

/** Pasa a RRHH. Por esta vía el contrato es de ETT salvo que se diga otra cosa. */
async function pasarARRHH(id, datos, quien) {
  const b = datos || {};
  const r = await cand.pasarARRHH(Number(id),
    { tipo: 'ett', ...b, ettNombre: ettNombre(b.ettNombre) }, quien);
  console.log(`👤 [ETT] ${r.quien} pasa a RRHH (ficha ${r.conductorId})` +
    (r.boltEnlazada ? ` — BOLT enlazada${r.boltReactivar ? ` (${r.boltEstado}: REACTIVAR)` : ''}`
      : r.faltaBolt ? ' — SIN cuenta de BOLT' : ''));
  // Mismo criterio que el alta rápida: si se elige vacante, se ocupa desde la
  // fecha de alta. Dos campos con el mismo nombre en la misma pantalla no
  // pueden hacer cosas distintas.
  const incorporacion = await avisarAlPlanificador(
    r, r.conductorId, b.vacanteId, 'ett', quien.usuarioId, b.alta);
  return { ...r, incorporacion };
}

/**
 * ALTA RÁPIDA: teléfono + nombre → alta de ETT directa, sin matriz ni
 * candidatura, y enlace AUTOMÁTICO a BOLT por teléfono —incluidas las cuentas
 * desactivadas, con aviso de reactivarlas—.
 *
 * Reutiliza `alta.realizar`: crea la ficha, abre el periodo de empleo (así pasa
 * directo al planificador, como si ya estuviera contratado) y engancha su BOLT.
 * Y le abre su candidatura YA TERMINADA, para que la agencia lo vea: sin ella
 * esta persona trabaja pero no sale ni en esta pantalla ni en el Excel que se
 * le manda a la ETT.
 */
async function altaRapida(datos, quien) {
  const b = datos || {};
  const nombre = String(b.nombre || '').trim();
  const telefono = String(b.telefono || '').trim();
  if (!nombre) throw new Error('Falta el nombre');
  if (telefono.replace(/\D/g, '').length < 9) throw new Error('El teléfono no parece válido');

  // LA FECHA PREVISTA DE ALTA, que es la que manda en todo lo que viene
  // detrás: el periodo de empleo, la candidatura y —sobre todo— el día desde
  // el que ocupa la plaza. Antes se forzaba HOY, y a quien empezaba el lunes
  // se le abría el contrato el jueves anterior y su coche quedaba ocupado
  // cuatro días de más.
  const hoy = new Date().toISOString().slice(0, 10);
  const alta_dia = /^\d{4}-\d{2}-\d{2}$/.test(String(b.alta || '')) ? String(b.alta) : hoy;

  const r = await alta.realizar({
    nombre, telefono, tipo: 'ett', ettNombre: ettNombre(b.ettNombre), alta: alta_dia,
    barrio: String(b.barrio || '').trim().slice(0, 60) || undefined,
  }, quien);

  // SU CANDIDATURA, aunque no haya habido proceso.
  //
  // Esta pantalla y el Excel que se le manda a la agencia leen CANDIDATURAS. Sin
  // esto, quien entra por el alta rápida trabaja desde el primer día pero no
  // existe para la ETT —y es exactamente a quien hay que facturarle—: no salía
  // en la lista, no se le podía elegir y no viajaba en el Excel.
  //
  // Se abre ya terminada (ver `abrirContratada`) y con la fecha de alta puesta,
  // que es lo que hace que la agencia lea «Contratado». Si falla, el alta no se
  // cae: la persona ya tiene contrato y coche, y esto se puede arreglar después.
  let candidatura = null;
  try {
    candidatura = await cand.abrirContratada(r.id, {
      canal: CANAL, alta: alta_dia, tipoContrato: 'ETT',
      jornadaHoras: b.jornadaHoras ? Number(b.jornadaHoras) : null,
    }, quien);
  } catch (e) {
    console.error('⚠️ [ETT] no se pudo abrir la candidatura:', e.message);
    r.avisos = [...(r.avisos || []),
      'El alta salió bien, pero no aparecerá en la lista de la ETT: ' + e.message];
  }

  console.log(`⚡ [ETT] Alta rápida ${nombre} (ficha ${r.id})` +
    (candidatura ? ` · candidatura ${candidatura.id}${candidatura.yaExistia ? ' (ya la tenía)' : ''}` : '') +
    (r.boltEnlazada ? ' — BOLT enlazada' : r.faltaBolt ? ' — SIN BOLT' : ''));

  const incorporacion = await avisarAlPlanificador(
    r, r.id, b.vacanteId, 'ett-rapida', quien.usuarioId, alta_dia);
  return { ...r, alta: alta_dia, candidatura, incorporacion };
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
  CANAL, POR_DEFECTO,
  paraLaPantalla, lista, ficha, catalogos, vacantesAbiertas,
  importar, guardar, cambiarEstado, descartar, eliminar,
  pasarARRHH, altaRapida,
  registrarEnvio, comprobar, excelDeTanda, excelDeElegidos,
  _ettNombre: ettNombre,
};
