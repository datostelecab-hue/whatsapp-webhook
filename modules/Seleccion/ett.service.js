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

const guardar = (id, datos, quien) => cand.guardar(Number(id), datos, quien);
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
 * Reserva la vacante para quien acaba de entrar: nace la alerta de
 * incorporación, que se resuelve en el planificador (aceptar = colocarlo solo
 * en esas plazas; rechazar = a mano).
 *
 * SI FALLA, EL ALTA NO SE CAE. La persona ya está dada de alta y eso es lo que
 * importa; que la vacante no quedara reservada es un aviso, no un motivo para
 * deshacerlo todo y dejar a alguien a medio contratar.
 */
async function reservarVacante(r, conductorId, vacanteId, origen, usuarioId) {
  if (!vacanteId || !conductorId) return null;
  try {
    const i = await incorporaciones.crear({ conductorId, vacanteId, origen, usuarioId });
    console.log(`🔔 [ETT] Incorporación ${i.id} · ficha ${conductorId} → vacante ${vacanteId}`);
    return i;
  } catch (e) {
    console.error('⚠️ [ETT] no se pudo crear la incorporación:', e.message);
    r.avisos = [...(r.avisos || []), 'El alta salió bien, pero la vacante no se pudo reservar: ' + e.message];
    return null;
  }
}

/** Pasa a RRHH. Por esta vía el contrato es de ETT salvo que se diga otra cosa. */
async function pasarARRHH(id, datos, quien) {
  const b = datos || {};
  const r = await cand.pasarARRHH(Number(id),
    { tipo: 'ett', ...b, ettNombre: ettNombre(b.ettNombre) }, quien);
  console.log(`👤 [ETT] ${r.quien} pasa a RRHH (ficha ${r.conductorId})` +
    (r.boltEnlazada ? ` — BOLT enlazada${r.boltReactivar ? ` (${r.boltEstado}: REACTIVAR)` : ''}`
      : r.faltaBolt ? ' — SIN cuenta de BOLT' : ''));
  const incorporacion = await reservarVacante(r, r.conductorId, b.vacanteId, 'ett', quien.usuarioId);
  return { ...r, incorporacion };
}

/**
 * ALTA RÁPIDA: teléfono + nombre → alta de ETT directa, sin matriz ni
 * candidatura, y enlace AUTOMÁTICO a BOLT por teléfono —incluidas las cuentas
 * desactivadas, con aviso de reactivarlas—.
 *
 * Reutiliza `alta.realizar`: crea la ficha, abre el periodo de empleo (así pasa
 * directo al planificador, como si ya estuviera contratado) y engancha su BOLT.
 */
async function altaRapida(datos, quien) {
  const b = datos || {};
  const nombre = String(b.nombre || '').trim();
  const telefono = String(b.telefono || '').trim();
  if (!nombre) throw new Error('Falta el nombre');
  if (telefono.replace(/\D/g, '').length < 9) throw new Error('El teléfono no parece válido');

  const hoy = new Date().toISOString().slice(0, 10);
  const r = await alta.realizar({
    nombre, telefono, tipo: 'ett', ettNombre: ettNombre(b.ettNombre), alta: hoy,
    barrio: String(b.barrio || '').trim().slice(0, 60) || undefined,
  }, quien);
  console.log(`⚡ [ETT] Alta rápida ${nombre} (ficha ${r.id})` +
    (r.boltEnlazada ? ' — BOLT enlazada' : r.faltaBolt ? ' — SIN BOLT' : ''));

  const incorporacion = await reservarVacante(r, r.id, b.vacanteId, 'ett-rapida', quien.usuarioId);
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
  CANAL, POR_DEFECTO,
  paraLaPantalla, lista, ficha, catalogos, vacantesAbiertas,
  importar, guardar, cambiarEstado, descartar, eliminar,
  pasarARRHH, altaRapida,
  registrarEnvio, comprobar, excelDeTanda, excelDeElegidos,
  _ettNombre: ettNombre,
};
