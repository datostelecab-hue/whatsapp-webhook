// ============================================================
// TICKETERA — lo que pide la gente y qué se hace con ello
// ============================================================
// Un conductor rellena el Formulario y aparece un ticket en la bandeja de quien
// le toca resolverlo. Cinco bandejas, una por área:
//
//   RRHH         vacaciones, bajas, permisos, nóminas, cuentas, domicilio, papeles
//   TRÁFICO      cambios de libranza
//   TALLER       incidencias del vehículo          (dentro de Flota)
//   ADMIN        combustible y reintegros de gastos
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
  const fallos = [];

  for (const r of respuestas) {
    // UNA FILA MALA NO PUEDE TUMBAR LA PASADA. Pasó de verdad: una respuesta
    // con la prioridad larga («Incidencia grave (requiere…)») no cabía en su
    // columna, la excepción subía, y con ella se quedaron fuera TODAS las
    // respuestas posteriores —no una, todas—, pasada tras pasada.
    //
    // Ahora cada fila va por su cuenta: la que falle se apunta con su número y
    // su motivo, y las demás siguen entrando.
    try {
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
    } catch (e) {
      fallos.push({ fila: r.fila, quien: r.nombre || r.dni || '', motivo: e.message });
      console.error(`❌ [TICKETERA] fila ${r.fila} (${r.nombre || '?'}): ${e.message}`);
    }
  }

  // LA MARCA DE AGUA SE QUEDA ANTES DEL PRIMER FALLO, no al final. Así la fila
  // que falló se vuelve a intentar en cada pasada: el día que se arregle la
  // causa, entra sola. Releer unas filas de más no cuesta nada —el índice único
  // impide que se dupliquen—; perderlas para siempre, sí.
  const hasta = fallos.length ? Math.min(...fallos.map(f => f.fila)) - 1 : ultimaFila;
  await configApp.guardarConfig({ [CLAVE_MARCA]: String(Math.max(marca, hasta)) }).catch(() => {});
  if (nuevas) avisar(creados);

  console.log(`🎫 [TICKETERA] ${nuevas} nuevo(s), ${repetidas} ya estaba(n), ` +
    `${sinIdentificar} sin identificar` + (fallos.length ? `, ${fallos.length} CON FALLO` : '') +
    ` · filas ${marca + 1}→${ultimaFila}`);
  return { nuevas, repetidas, sinIdentificar, fallos, desde: marca, hasta, sueltas, porCampo };
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

// ── Soporte técnico: los tickets que se abren DESDE DENTRO ───────────────
//
// La otra ticketera: cualquiera con cuenta reporta un fallo o pide una mejora,
// y el desarrollador los atiende. Vive en la MISMA tabla que los del formulario
// porque es la misma cosa —alguien pide algo, alguien se hace cargo, queda el
// rastro— y con dos tablas habría dos formas de contestar «¿cuánto tardamos?».
//
// Lo que cambia es el área (IT) y sus subtipos, que es justo para lo que están.

const SUBTIPO_IT = {
  Bug: 'IT_BUG', Requerimiento: 'IT_REQUERIMIENTO', Mejora: 'IT_MEJORA',
  Consulta: 'IT_CONSULTA', Otro: 'IT_OTRO',
};
const TIPOS_IT = Object.keys(SUBTIPO_IT);
const PRIORIDADES = ['Baja', 'Media', 'Alta'];

/** Abre un ticket de soporte. Lo puede hacer cualquiera que haya entrado. */
async function crearSoporte({ tipo, prioridad, titulo, descripcion, adjuntos }, quien = {}) {
  const tit = String(titulo || '').trim();
  if (!tit) throw new Error('Ponle un título al ticket');
  const creado = await repo.altaInterna({
    origen: 'soporte',
    usuarioId: quien.usuarioId || null,
    nombre: quien.nombre || '',
    area: 'IT',
    subtipo: SUBTIPO_IT[tipo] || 'IT_OTRO',
    titulo: tit,
    prioridad: PRIORIDADES.includes(prioridad) ? prioridad : 'Media',
    descripcion: String(descripcion || '').trim(),
    adjuntos: Array.isArray(adjuntos) ? adjuntos : [],
  });
  await repo.apuntar(creado.id, { despues: 'pendiente', nota: tit,
    usuarioId: quien.usuarioId, quien: quien.nombre || '' });
  console.log(`🎫 [SOPORTE] ${creado.codigo} "${tit}" por ${quien.nombre || '?'}`);
  return creado;
}

// Soporte habla en sus palabras de siempre: Nuevo / En curso / Resuelto /
// Descartado. Debajo son los estados de la ticketera, que significan lo mismo.
// La traducción vive AQUÍ, en un sitio, y no repartida entre la pantalla y la
// ruta: así añadir un estado no obliga a buscar dónde más estaba escrito.
const ETIQUETA_IT = { pendiente: 'Nuevo', en_curso: 'En curso',
                      ejecutado: 'Resuelto', no_procede: 'Descartado' };
const CODIGO_IT = Object.fromEntries(Object.entries(ETIQUETA_IT).map(([k, v]) => [v, k]));

/**
 * La bandeja del desarrollador, en el vocabulario de soporte.
 *
 * Trae TODOS, cerrados incluidos: en soporte se mira tanto lo que falta como lo
 * que se hizo. Los contadores salen de `cierra` del catálogo y no de una lista
 * de estados escrita a mano, que habría que ampliar cada vez que se añada uno.
 */
async function bandejaIT() {
  const { tickets } = await datos('IT', { cerrados: true });
  const lista = tickets.map(t => ({
    id: t.id, ref: t.codigo,
    fecha_creacion: t.creado,
    solicitante_email: t.usuarioEmail, solicitante_nombre: t.quien,
    tipo: t.subtipo, prioridad: t.prioridad,
    titulo: t.gestion, descripcion: t.descripcion,
    estado: ETIQUETA_IT[t.estado] || t.estadoEtiqueta,
    abierto: !t.cerrado,
    adjuntos: t.adjuntos, notas_dev: t.notas,
    fecha_actualizacion: t.asignado || '', fecha_resolucion: t.resuelto || '',
    horas: t.horas,
  }));
  const cuenta = campo => lista.reduce((m, t) => {
    const k = (t[campo] || '').trim() || '—'; m[k] = (m[k] || 0) + 1; return m;
  }, {});
  return {
    tickets: lista,
    opciones: { tipos: TIPOS_IT, prioridades: PRIORIDADES, estados: Object.values(ETIQUETA_IT) },
    contadores: {
      total: lista.length,
      abiertos: lista.filter(t => t.abierto).length,
      nuevos: lista.filter(t => t.estado === 'Nuevo').length,
    },
    porEstado: cuenta('estado'), porTipo: cuenta('tipo'),
  };
}

/** Cambia el estado desde soporte, que habla con etiquetas y no con códigos. */
async function estadoIT(id, { estado, notas }, quien = {}) {
  const codigo = CODIGO_IT[String(estado || '').trim()];
  if (!codigo) throw new Error('Estado no válido');
  // Cerrar exige decir en qué quedó. En soporte eso son las notas del
  // desarrollador, que es lo que ya se escribe: no se pide nada nuevo.
  return cambiarEstado(id, { estado: codigo, resolucion: notas || estado }, quien);
}

/** Los que ha abierto quien mira. Para poder seguir el suyo sin ver los demás. */
const mios = async usuarioId =>
  ({ tickets: usuarioId ? await repo.mios(usuarioId) : [], tipos: TIPOS_IT, prioridades: PRIORIDADES });

async function notas(id, texto, quien = {}) {
  await repo.guardarNotas(id, texto);
  return repo.una(id);
}

async function adjuntos(id, lista) {
  await repo.guardarAdjuntos(id, lista);
  return repo.una(id);
}

// ── La pantalla ────────────────────────────────────────────────────────────

/** «septiembre de 2026»: el mes en curso, en Madrid. */
const mesEnCurso = () => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', month: 'long', year: 'numeric' }).format(new Date());

/**
 * La bandeja de un área. Con `soloMes` trae solo lo pedido este mes (las cinco
 * del formulario, desde el 25/09/2026) y dice cuál es, para que la pantalla lo
 * cuente. `codigo` se trae siempre: es el enlace directo a un ticket.
 */
async function datos(areaCodigo, { cerrados, soloMes = false, codigo = null } = {}) {
  const [tickets, cat] = await Promise.all([
    repo.bandeja(areaCodigo, { cerrados: !!cerrados, soloMes, codigo: codigo ? String(codigo).trim().slice(0, 40) : null }),
    repo.catalogos(),
  ]);
  return { tickets, ...cat, mes: soloMes ? mesEnCurso() : null };
}

/** Los pendientes de este mes de unas áreas: los cuadros de la barra de arriba. */
async function pendientesDelMes(areas) {
  const n = await repo.pendientesDelMes(areas);
  return { mes: mesEnCurso(), pendientes: Object.fromEntries(areas.map(a => [a, n[a] || 0])) };
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
async function aplicar(id, { desde, hasta, estado, motivo } = {}, quien = {}) {
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

  // QUÉ AUSENCIA SE ABRE. El subtipo propone —«Vacaciones» abre vacaciones—,
  // pero la propuesta puede estar mal: el formulario lo rellena el conductor y
  // «Baja o ausencia» cabe en una baja médica, un permiso o un asunto propio.
  // Se acepta la corrección, pero solo si es una ausencia de verdad: cualquier
  // otro código dejaría a la persona en un estado que no la aparta de nadie.
  //
  // EL VALOR PUEDE LLEGAR ENVUELTO. El selector de la casa devuelve un objeto
  // -{ valor, grupo, texto }- cuando el campo es de tipo 'opciones', y a secas
  // cuando es 'lista'. Aqui llegaba envuelto y se comparaba con `String()`, asi
  // que salia "[object Object]", no casaba con ningun codigo del catalogo y
  // TODA aplicacion moria con "Ese estado no es una ausencia" — incluso
  // eligiendo la que el propio ticket proponia. La pantalla ya manda el valor a
  // secas; esto lo desenvuelve igual porque la puerta es publica y el error que
  // daba no señalaba a donde estaba el problema.
  const codigoDe = x => (x && typeof x === 'object' ? x.valor : x);

  let cual = t.estadoAbre;
  const pedido = codigoDe(estado);
  if (pedido && String(pedido) !== String(t.estadoAbre)) {
    const { ausencias } = await repo.catalogos();
    const elegida = (ausencias || []).find(a => a.codigo === String(pedido));
    if (!elegida) throw new Error(`«${pedido}» no es una ausencia que se pueda aplicar`);
    cual = elegida.codigo;
  }

  // EL TICKET VIAJA CON LA AUSENCIA. Desde la ficha de la persona se llega asi
  // a quien la aplico, a lo que escribio el conductor y al justificante que
  // subio a Drive, sin copiar ninguno de los tres.
  await plantilla.anadirAusencia(Number(t.conductorId), {
    estado: cual, desde: d, hasta: h || null,
    motivo: String(motivo || '').trim() || `Ticket ${t.codigo}`,
    ticketId: Number(t.id),
  }, { usuarioId: quien.usuarioId || null });

  const { ausencias: cat } = await repo.catalogos();
  const nombre = ((cat || []).find(a => a.codigo === cual) || {}).etiqueta || t.subtipo;
  // En dd/mm/aaaa y no en ISO: esta frase la lee una persona en la bandeja y en
  // la historia del ticket, no una maquina.
  const enEs = x => (String(x || '').split('-').reverse().join('/') || x);
  const resolucion = `Aplicado: ${nombre} del ${enEs(d)}${h ? ' al ' + enEs(h) : ''}`;
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
  // Entera: aquí se quiere saber cuántas filas tiene la hoja, no solo las nuevas.
  const { cabeceras, porCampo, sueltas, ultimaFila, hoja } = await form.respuestasDesde(1e9, { entera: true });
  const cfg = await configApp.leerConfig().catch(() => ({}));
  return {
    libro: form.LIBRO, hoja,
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
  crearSoporte, mios, notas, adjuntos, bandejaIT, estadoIT, TIPOS_IT, PRIORIDADES,
  enlazar, reclasificar, aplicar, diagnostico,
  abiertosPorArea: repo.abiertosPorArea, pendientesDelMes,
};
