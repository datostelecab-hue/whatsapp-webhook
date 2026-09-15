// ============================================================
// TICKETERA — lo que pide la gente y qué se hace con ello
// ============================================================
// Un conductor rellena el Formulario y aparece un ticket en la bandeja de quien
// le toca resolverlo. Cinco bandejas, una por área:
//
//   RRHH         vacaciones, bajas, permisos, nóminas, cuentas, domicilio, papeles
//   TRÁFICO      cambios de libranza
//   TALLER       incidencias del vehículo          (dentro de Flota)
//   ADMIN        Ballenoil y reintegros de gastos
//   OPERACIONES  «Tickets sin traza»: los que no se sabe clasificar
//
// Esa última bandeja es nueva y es la que arregla un agujero: el Apps Script
// mandaba a RRHH todo lo que no encajaba con ninguna regla, y ahí se perdía
// entre trescientos tickets. Son justo los que hay que mirar — cada uno es o
// algo que no habíamos previsto, o una regla de reparto que se quedó corta.
//
// ── LA ENTRADA ES LO ÚNICO QUE SIGUE EN GOOGLE ──────────────────────────────
// Y solo la entrada: se LEE la hoja de respuestas y no se escribe en ella. El
// Apps Script que clasificaba, numeraba, buscaba el DNI contra otra hoja y
// mandaba los correos deja de hacer falta, y HAY QUE APAGARLO: si sigue
// corriendo, cada ticket existirá dos veces.

const repo = require('./ticketera.repo');
const form = require('./formulario');
const { clasificar } = require('./clasificar');
const plantilla = require('../Conductores/plantilla.service');
const configApp = require('../../services/configApp');

const CLAVE_MARCA = 'ticketera_ultima_fila';

// ── Entrada: del formulario a la bandeja ───────────────────────────────────

/**
 * Trae las respuestas nuevas y las convierte en tickets.
 *
 * La llama la ingesta. Se puede repetir sin miedo: el índice único sobre
 * `fila_form` impide que la misma respuesta entre dos veces, así que una pasada
 * cortada a medias se arregla sola en la siguiente. La marca de agua es una
 * optimización —no leer de nuevo mil filas—, no la garantía.
 */
async function sincronizar({ desde } = {}) {
  const cfg = await configApp.leerConfig().catch(() => ({}));
  const marca = desde != null ? Number(desde) : (Number(cfg[CLAVE_MARCA]) || 0);

  const { respuestas, sueltas, porCampo, ultimaFila } = await form.respuestasDesde(marca);
  if (!respuestas.length) {
    return { nuevas: 0, repetidas: 0, sinIdentificar: 0, desde: marca, hasta: ultimaFila, sueltas };
  }

  let nuevas = 0, repetidas = 0, sinIdentificar = 0;
  const creados = [];

  for (const r of respuestas) {
    const clas = await clasificar(r.gestion);

    // QUIÉN LO PIDE. Por DNI primero, teléfono después y nombre el último, que
    // es el orden en que esos datos identifican de verdad a alguien. Si no se
    // resuelve, el ticket entra igual con lo que escribió: un ticket sin dueño
    // se puede enlazar después, uno que no existe no.
    const persona = await plantilla.buscarPersona({
      dni: r.dni, telefono: r.telefono, nombreBolt: r.nombre,
    }).catch(() => null);
    if (!persona) sinIdentificar++;

    const creado = await repo.alta({
      origen: 'formulario',
      filaForm: r.fila,
      marca: r.marca,
      conductorId: persona ? persona.id : null,
      dni: r.dni, nombre: r.nombre, telefono: r.telefono,
      area: clas.area, subtipo: clas.subtipo,
      gestion: r.gestion, prioridad: r.prioridad,
      descripcion: form.descripcion(r),
      matricula: r.matricula,
      fechaIni: r.fechaIni, fechaFin: r.fechaFin,
      responsable: '',
    });

    if (!creado) { repetidas++; continue; }
    nuevas++;
    creados.push({ ...creado, area: clas.area, quien: persona ? persona.nombre : (r.nombre || r.dni) });
    await repo.apuntar(creado.id, {
      despues: 'pendiente',
      nota: `Alta desde el formulario (fila ${r.fila})` +
            (persona ? ` · identificado por ${persona.por}` : ' · SIN identificar'),
      quien: 'formulario',
    });
  }

  await configApp.guardarConfig({ [CLAVE_MARCA]: String(ultimaFila) }).catch(() => {});
  if (nuevas) avisar(creados);

  console.log(`🎫 [TICKETERA] ${nuevas} nuevo(s), ${repetidas} ya estaba(n), ` +
    `${sinIdentificar} sin identificar · filas ${marca + 1}→${ultimaFila}`);
  return { nuevas, repetidas, sinIdentificar, desde: marca, hasta: ultimaFila, sueltas, porCampo };
}

/** Un correo por área con lo que le acaba de entrar. */
function avisar(creados) {
  const { enviarCorreo } = require('../../services/correo');
  const db = require('../../services/db');
  const porArea = new Map();
  creados.forEach(c => {
    if (!porArea.has(c.area)) porArea.set(c.area, []);
    porArea.get(c.area).push(c);
  });
  porArea.forEach(async (lista, area) => {
    try {
      const r = await db.consulta('SELECT email FROM ticket_area_correo WHERE area_codigo = $1', [area]);
      const to = r.rows.map(x => x.email).filter(Boolean);
      if (!to.length) return;      // nadie apuntado para esa área: no es un error
      await enviarCorreo({
        to: to.join(', '),
        subject: `${lista.length} ticket(s) nuevo(s) — ${area}`,
        text: lista.map(c => `${c.codigo} · ${c.quien}`).join('\n'),
      });
    } catch (e) { console.error('⚠️  [TICKETERA] aviso por correo:', e.message); }
  });
}

// ── La pantalla ────────────────────────────────────────────────────────────

async function datos(areaCodigo, { cerrados } = {}) {
  const [tickets, cat] = await Promise.all([
    repo.bandeja(areaCodigo, { cerrados: !!cerrados }),
    repo.catalogos(),
  ]);
  return { tickets, ...cat };
}

const ficha = async id => {
  const t = await repo.una(id);
  if (!t) throw new Error('No existe ese ticket');
  return { ticket: t, historia: await repo.historia(id) };
};

// ── Acciones ───────────────────────────────────────────────────────────────

async function asignar(id, { responsable }, quien = {}) {
  const antes = await repo.una(id);
  if (!antes) throw new Error('No existe ese ticket');
  const nombre = String(responsable || quien.nombre || '').trim();
  if (!nombre) throw new Error('Falta quién se hace cargo');
  const r = await repo.asignar(id, { responsable: nombre, responsableId: quien.usuarioId || null });
  await repo.apuntar(id, { antes: antes.estado, despues: r.estado,
    nota: `Se hace cargo ${nombre}`, usuarioId: quien.usuarioId, quien: quien.nombre || nombre });
  return repo.una(id);
}

async function cambiarEstado(id, { estado, resolucion }, quien = {}) {
  const antes = await repo.una(id);
  if (!antes) throw new Error('No existe ese ticket');
  const { estados } = await repo.catalogos();
  const e = estados.find(x => x.codigo === estado);
  if (!e) throw new Error(`Estado desconocido: ${estado}`);
  // Cerrar un ticket es la acción que no se puede deshacer sola: se exige decir
  // en qué quedó. "Rechazado" sin motivo es lo que obliga a llamar a alguien un
  // mes después para preguntarle qué pasó.
  if (e.cierra && !String(resolucion || '').trim() && !String(antes.resolucion || '').trim()) {
    throw new Error(`Para dejarlo en «${e.etiqueta}» hace falta decir en qué quedó`);
  }
  await repo.cambiarEstado(id, { estado, resolucion, cierra: e.cierra });
  await repo.apuntar(id, { antes: antes.estado, despues: estado,
    nota: resolucion || null, usuarioId: quien.usuarioId, quien: quien.nombre || '' });
  return repo.una(id);
}

async function observaciones(id, texto, quien = {}) {
  await repo.guardarObservaciones(id, texto);
  await repo.apuntar(id, { nota: 'Observaciones', usuarioId: quien.usuarioId, quien: quien.nombre || '' });
  return repo.una(id);
}

/** Lo enlaza con una persona. Es lo que resuelve un «sin identificar». */
async function enlazar(id, conductorId, quien = {}) {
  const t = await repo.una(id);
  if (!t) throw new Error('No existe ese ticket');
  await repo.enlazar(id, conductorId || null);
  const nuevo = await repo.una(id);
  await repo.apuntar(id, {
    nota: conductorId ? `Enlazado con ${nuevo.quien}` : 'Desenlazado',
    usuarioId: quien.usuarioId, quien: quien.nombre || '' });
  return nuevo;
}

/**
 * Lo manda a otra bandeja. El subtipo decide el área, no se eligen por separado:
 * si «incidencia del vehículo» es de TALLER, no tiene sentido poder dejarla en
 * RRHH.
 */
async function reclasificar(id, subtipoCodigo, quien = {}) {
  const antes = await repo.una(id);
  if (!antes) throw new Error('No existe ese ticket');
  const r = await repo.reclasificar(id, subtipoCodigo);
  if (!r) throw new Error('Ese tipo de gestión no existe');
  const nuevo = await repo.una(id);
  await repo.apuntar(id, {
    nota: `Reclasificado: ${antes.area}/${antes.subtipo} → ${nuevo.area}/${nuevo.subtipo}`,
    usuarioId: quien.usuarioId, quien: quien.nombre || '' });
  return nuevo;
}

/**
 * APLICAR: lo que pide el ticket se convierte en un hecho.
 *
 * Solo para los subtipos que abren una ausencia (vacaciones, baja, permiso).
 * Entra por la puerta de Conductores, que es donde viven las reglas: que el
 * tramo no pise otro de la misma persona, que lo que tiene vuelta la lleve, y
 * que cerrar una vigencia y abrir la siguiente vaya en una transacción.
 *
 * Se aplica ANTES de mover el ticket: si el tramo choca, el ticket se queda como
 * estaba en vez de figurar «Ejecutado» sin haberse ejecutado nada.
 */
async function aplicar(id, { desde, hasta } = {}, quien = {}) {
  const t = await repo.una(id);
  if (!t) throw new Error('No existe ese ticket');
  if (!t.estadoAbre) {
    throw new Error(`«${t.subtipo}» no abre una ausencia: eso solo lo hacen vacaciones, bajas y permisos`);
  }
  if (!t.conductorId) {
    throw new Error('Este ticket no está enlazado con nadie. Enlázalo primero: sin saber de quién es, no se le puede poner una ausencia.');
  }
  const d = desde || t.fechaIniIso;
  const h = hasta || t.fechaFinIso;
  if (!d) throw new Error('Falta la fecha de inicio');

  await plantilla.anadirAusencia(Number(t.conductorId), {
    estado: t.estadoAbre, desde: d, hasta: h || null,
    motivo: `Ticket ${t.codigo}`,
  }, { usuarioId: quien.usuarioId || null });

  const resolucion = `Aplicado: ${t.subtipo} del ${d}${h ? ' al ' + h : ''}`;
  await repo.cambiarEstado(id, { estado: 'ejecutado', resolucion, cierra: true });
  await repo.apuntar(id, { antes: t.estado, despues: 'ejecutado', nota: resolucion,
    usuarioId: quien.usuarioId, quien: quien.nombre || '' });
  console.log(`✅ [TICKETERA] ${t.codigo} aplicado: ${t.subtipo} de ${t.quien} ${d}${h ? '→' + h : ''}`);
  return repo.una(id);
}

/**
 * QUÉ ESTÁ LEYENDO DEL FORMULARIO. Sin esto, que una pregunta deje de casar es
 * invisible: el ticket simplemente sale con un campo vacío. Aquí se ve qué
 * columna alimenta qué campo y cuáles van a parar a la descripción.
 */
async function diagnostico() {
  const { cabeceras, porCampo, sueltas, ultimaFila } = await form.respuestasDesde(1e9);
  const cfg = await configApp.leerConfig().catch(() => ({}));
  return {
    libro: form.LIBRO, hoja: form.HOJA,
    filasEnLaHoja: ultimaFila,
    leidoHasta: Number(cfg[CLAVE_MARCA]) || 0,
    reconocidas: Object.entries(porCampo || {})
      .map(([campo, i]) => ({ campo, columna: cabeceras[i] }))
      .sort((a, b) => a.campo.localeCompare(b.campo)),
    // Estas no se pierden: van enteras a la descripción del ticket.
    aLaDescripcion: sueltas,
  };
}

module.exports = {
  sincronizar, datos, ficha, asignar, cambiarEstado, observaciones,
  enlazar, reclasificar, aplicar, diagnostico,
  abiertosPorArea: repo.abiertosPorArea,
};
