// ============================================================
// CALL CENTER — registro y análisis de llamadas a conductores
// ============================================================
// Cada llamada se clasifica en Cluster → Subcluster → Motivo → Resultado → Acción,
// con el motivo separado del resultado a propósito: así los KPIs (% resueltas,
// no contactados, reincidencia…) salen solos y el catálogo puede crecer sin
// rediseñar nada. Regla heredada del diseño: un motivo vive en UN solo cluster
// ("exceso de velocidad" es conducta, aunque también sea operativa) y el TIPO de
// incidencia (qué clase de siniestro, qué avería) va en las notas, no en el motivo.
//
// Persistencia: PostgreSQL (`llamada_cc`). Vivía en una hoja; ver la nota de
// «Persistencia» más abajo.


const TZ = 'Europe/Madrid';

// ── Catálogo ──────────────────────────────────────────────────────────────────
// Deduplicado del dictado original: cada motivo aparece UNA vez. Los resultados
// son por motivo; a todos se les suman los universales de contacto (abajo).
const CATALOGO = [
  { cluster: 'Asistencia', icono: 'fa-user-check', subclusters: [
    { nombre: 'Conexión', motivos: [
      { motivo: 'No se ha conectado a su puesto',
        resultados: ['Confirma que sale ya', 'No asistirá', 'Incidencia que lo impide'],
        acciones: ['Avisar a tráfico para cubrir el turno', 'Recordar horario', 'Programar seguimiento'] },
      { motivo: 'Revisión de asistencia / confirmación de turno',
        resultados: ['Confirma asistencia', 'No asistirá', 'Duda resuelta'],
        acciones: ['Confirmar en el planificador', 'Avisar a tráfico'] }
    ] },
    { nombre: 'Ausencias', motivos: [
      { motivo: 'Justificante de ausencia',
        resultados: ['Justificante recibido', 'Quedó en enviarlo', 'No lo aportará'],
        acciones: ['Solicitar justificante', 'Registrar en RRHH', 'Programar seguimiento'] }
    ] }
  ] },
  { cluster: 'Operativa', icono: 'fa-route', subclusters: [
    { nombre: 'Servicio', motivos: [
      { motivo: 'Espera extendida',
        resultados: ['Retoma actividad', 'Espera justificada', 'Escalado a tráfico'],
        acciones: ['Recordar protocolo de esperas', 'Registrar aviso'] },
      { motivo: 'Espera fuera de la M-30',
        resultados: ['Vuelve a zona', 'Espera justificada', 'Escalado a tráfico'],
        acciones: ['Recordar zona de trabajo', 'Registrar aviso'] }
    ] }
  ] },
  { cluster: 'Vehículo', icono: 'fa-car-burst', subclusters: [
    { nombre: 'Avería', motivos: [
      { motivo: 'Problema con el coche',
        resultados: ['Resuelto en llamada', 'Cita con taller', 'Cambio de vehículo', 'Sigue rodando con la avería'],
        acciones: ['Abrir parte de taller', 'Coordinar coche de sustitución'] }
    ] },
    { nombre: 'Siniestro', motivos: [
      { motivo: 'Siniestro / accidente',   // el TIPO de siniestro va en las notas
        resultados: ['Parte amistoso enviado', 'Grúa solicitada', 'Cambio de vehículo', 'Sin daños, continúa'],
        acciones: ['Pedir fotos y parte', 'Solicitar grúa', 'Avisar al seguro'] }
    ] },
    { nombre: 'Combustible', motivos: [
      { motivo: 'Problemas con la gasolina / repostaje',
        resultados: ['Resuelto en llamada', 'Escalado a tráfico'],
        acciones: ['Explicar protocolo Ballenoil', 'Verificar saldo y PIN'] },
      { motivo: 'Credenciales Ballenoil (PIN / código)',
        resultados: ['PIN reenviado', 'Código nuevo entregado', 'Escalado a tráfico'],
        acciones: ['Reenviar PIN por el bot', 'Generar código de lavado'] }
    ] }
  ] },
  { cluster: 'Tecnología', icono: 'fa-mobile-screen', subclusters: [
    { nombre: 'Bolt', motivos: [
      { motivo: 'Problemas con Bolt (app o cuenta)',
        resultados: ['Resuelto en llamada', 'Escalado a Bolt', 'Pendiente de Bolt'],
        acciones: ['Guiar reinicio de sesión', 'Abrir caso con Bolt'] }
    ] },
    { nombre: 'Bot Telecab', motivos: [
      { motivo: 'Problemas con el bot (puertas, códigos, turnos)',
        resultados: ['Resuelto en llamada', 'Escalado a IT'],
        acciones: ['Guiar por WhatsApp', 'Reportar a desarrollo'] }
    ] },
    { nombre: 'Cámaras', motivos: [
      { motivo: 'Cámara averiada / sin señal',
        resultados: ['Resuelto en llamada', 'Revisión en base'],
        acciones: ['Programar revisión en base'] }
    ] }
  ] },
  { cluster: 'Nómina', icono: 'fa-money-check-dollar', subclusters: [
    { nombre: 'Incidencias', motivos: [
      { motivo: 'Problema en la nómina',
        resultados: ['Corregido', 'Escalado a RRHH', 'Pendiente de revisión'],
        acciones: ['Abrir ticket de RRHH', 'Revisar con nóminas extras'] }
    ] },
    { nombre: 'Consultas', motivos: [
      { motivo: 'Explicación de variables', resultados: ['Aclarado', 'Escalado a RRHH'], acciones: ['Explicar cálculo de variables'] },
      { motivo: 'Explicación de conceptos de nómina', resultados: ['Aclarado', 'Escalado a RRHH'], acciones: ['Explicar conceptos'] }
    ] }
  ] },
  { cluster: 'Turnos', icono: 'fa-calendar-week', subclusters: [
    { nombre: 'Cambios', motivos: [
      { motivo: 'Coordinación de cambio de turno',
        resultados: ['Cambio aprobado', 'Cambio denegado', 'Pendiente de cuadrar'],
        acciones: ['Actualizar planificador', 'Consultar con tráfico'] }
    ] },
    { nombre: 'Consultas', motivos: [
      { motivo: 'Explicación de turnos', resultados: ['Aclarado'], acciones: ['Reenviar aviso "Ver mis turnos"'] }
    ] }
  ] },
  { cluster: 'Conducta', icono: 'fa-scale-balanced', subclusters: [
    { nombre: 'Uso del vehículo', motivos: [
      { motivo: 'Uso personal del coche',
        resultados: ['Advertido', 'Justificado', 'Expediente abierto'],
        acciones: ['Registrar advertencia', 'Abrir expediente', 'Cruzar con auditoría en vivo'] }
    ] },
    { nombre: 'Velocidad', motivos: [
      { motivo: 'Exceso de velocidad',
        resultados: ['Advertido', 'Justificado', 'Sanción registrada'],
        acciones: ['Registrar en sanciones', 'Enviar aviso WhatsApp'] }
    ] },
    { nombre: 'Cámaras', motivos: [
      { motivo: 'Manipulación de cámaras',
        resultados: ['Advertido', 'Justificado', 'Expediente abierto'],
        acciones: ['Registrar advertencia', 'Abrir expediente'] }
    ] }
  ] }
];

// Válidos para CUALQUIER motivo (sobre todo en salientes): la llamada existió
// aunque no hubiera conversación, y de ahí sale el KPI de no contactados.
const RESULTADOS_UNIVERSALES = ['No contactado', 'Buzón / no contesta', 'Número erróneo'];
const NO_CONTACTO = new Set(RESULTADOS_UNIVERSALES);

// Búsqueda en el catálogo (case-insensitive, para no pelearse con el cliente).
const low = s => String(s || '').trim().toLowerCase();
function buscarMotivo(cluster, subcluster, motivo) {
  const c = CATALOGO.find(x => low(x.cluster) === low(cluster));
  if (!c) return null;
  const s = c.subclusters.find(x => low(x.nombre) === low(subcluster));
  if (!s) return null;
  const m = s.motivos.find(x => low(x.motivo) === low(motivo));
  return m ? { cluster: c.cluster, subcluster: s.nombre, ...m } : null;
}

/** Valida la clasificación completa; devuelve la versión canónica o lanza. */
function validarClasificacion({ cluster, subcluster, motivo, resultado }) {
  const m = buscarMotivo(cluster, subcluster, motivo);
  if (!m) throw new Error(`Clasificación desconocida: ${cluster} → ${subcluster} → ${motivo}`);
  const r = [...m.resultados, ...RESULTADOS_UNIVERSALES].find(x => low(x) === low(resultado));
  if (!r) throw new Error(`Resultado "${resultado}" no válido para "${m.motivo}"`);
  return { cluster: m.cluster, subcluster: m.subcluster, motivo: m.motivo, resultado: r };
}

// ── Fechas (el servidor corre con TZ=Europe/Madrid; Render lo tiene puesto) ───
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
// 'YYYY-MM-DD' → epoch (s) a las 00:00 de Madrid. Se apoya en el TZ del proceso.
const inicioDia = f => Math.floor(new Date(`${f}T00:00:00`).getTime() / 1000);
const finDia = f => inicioDia(f) + 86400;

// ── Persistencia ────────────────────────────────────────────────
// En PostgreSQL desde el 15/09/2026. Antes, una hoja. Dos razones y la segunda
// es la que importa:
//
//   1. Cada llamada era una escritura en Google, y cerrarla otra. Esto se usa
//      MIENTRAS se habla por teléfono: esperar a Google con alguien al otro
//      lado es justo el momento en que no se quiere esperar.
//
//   2. Resolver una llamada era leer-modificar-escribir sobre una fila
//      localizada por su POSICIÓN. Dos personas cerrando a la vez podían
//      escribir una sobre la otra y nada lo impedía. Ahora es un WHERE.
//
// EL HISTORIAL VIEJO NO SE TRAE, y es una decisión, no un olvido: todas las
// llamadas se han hecho desde los botones de teléfono de Control, y ahí está el
// registro. Copiar una hoja que duplica lo que ya hay solo serviría para tener
// dos versiones de lo mismo.
//
// El CATÁLOGO de arriba NO se ha movido a la base, a propósito: no son datos,
// es el vocabulario con el que se clasifica, y cada cambio arrastra reglas —qué
// resultados valen para qué motivo, qué cuenta como «no contactado»—. En tablas
// daría la ilusión de que se cambia desde una pantalla.

const repo = require('./callcenter.repo');

/**
 * A quién se llamó, en id de la base. La reincidencia se cuenta POR PERSONA, y
 * por nombre se contaría mal en cuanto alguien lo escriba distinto. Si no se
 * resuelve, la llamada se guarda igual con el nombre tecleado: perder la llamada
 * sería peor que perder el enlace.
 */
async function resolverPersona(d) {
  try {
    const plantilla = require('../Conductores/plantilla.service');
    const p = await plantilla.buscarPersona({
      telefono: d.telefono, nombreBolt: d.conductor, dni: d.dni,
    });
    return p ? p.id : null;
  } catch (_) { return null; }
}

/** Registra una llamada. Devuelve la llamada canónica tal como quedó guardada. */
async function registrar(datos, agente, quien = {}) {
  const d = datos || {};
  const cls = validarClasificacion(d);
  if (!String(d.conductor || '').trim()) throw new Error('Falta el conductor');
  const direccion = low(d.direccion) === 'entrante' ? 'entrante' : 'saliente';
  const turno = ['Día', 'Noche'].includes(d.turno) ? d.turno : '';
  const estado = low(d.estado) === 'pendiente' ? 'pendiente' : 'resuelta';
  const ts = Math.floor(Date.now() / 1000);
  return repo.guardar({
    clave: `cc-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    ts, agente: agente || '', agenteId: quien.usuarioId || null, direccion,
    conductorId: await resolverPersona(d),
    conductor: String(d.conductor).trim(), telefono: String(d.telefono || '').trim(),
    matricula: String(d.matricula || '').trim().toUpperCase(), turno,
    ...cls,
    accion: String(d.accion || '').trim(), notas: String(d.notas || '').trim(),
    estado,
    // Resuelta en la propia llamada → la resolución es instantánea (cuenta aparte
    // en los KPIs).
    tsResuelta: estado === 'resuelta' ? ts : 0,
    resueltaPor: estado === 'resuelta' ? (agente || '') : '', resolucion: '',
  });
}

/**
 * Cierra una llamada pendiente. La nota de resolución es obligatoria: una
 * llamada que se cierra sin decir en qué quedó no sirve para nada dos semanas
 * después, que es cuando se mira.
 */
async function resolver(clave, { resolucion, resultado } = {}, agente, quien = {}) {
  if (!String(resolucion || '').trim()) throw new Error('La nota de resolución es obligatoria');

  // Se puede CORREGIR el resultado al cerrar (la llamada acabó de otra forma de
  // la que parecía). Se valida contra el motivo de la llamada que hay guardada,
  // no contra lo que venga en la petición: si no, se colaría cualquier resultado
  // mandando también un motivo inventado.
  let res = null;
  if (resultado) {
    const actual = await repo.una(clave);
    if (!actual) throw new Error('No encuentro esa llamada');
    res = validarClasificacion({ ...actual, resultado }).resultado;
  }

  const ll = await repo.cerrar(clave, {
    resolucion: String(resolucion).trim(), resultado: res,
    agente: agente || '', agenteId: quien.usuarioId || null,
    ts: Math.floor(Date.now() / 1000),
  });
  if (ll) return ll;

  // No se actualizó nada: o no existe, o ya estaba cerrada. Se distingue, porque
  // son dos problemas distintos para quien está delante.
  const estado = await repo.existe(clave);
  if (!estado) throw new Error('No encuentro esa llamada');
  throw new Error('Esa llamada ya está resuelta');
}

/** Todas las llamadas, de la más nueva a la más vieja. */
const listar = () => repo.listar();

// ── KPIs (función pura: se prueba sin Sheets) ─────────────────────────────────
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const top = (mapa, n) => [...mapa.entries()].map(([nombre, v]) => ({ nombre, ...v }))
  .sort((a, b) => b.n - a.n).slice(0, n);

/**
 * KPIs sobre un conjunto de llamadas (ya filtrado por periodo).
 * `todas` (opcional) = historial completo, para detectar reincidencias que
 * empezaron antes del periodo. Reincidencia = mismo conductor + mismo motivo
 * 2 o más veces en una ventana de 30 días.
 */
function kpis(llamadas, todas) {
  const L = llamadas || [];
  const H = todas || L;
  const resueltas = L.filter(x => x.estado === 'resuelta');
  const noContacto = L.filter(x => NO_CONTACTO.has(x.resultado));

  // Conductores a los que se llamó, no se les localizó y NO hubo contacto después.
  const ultimo = new Map();   // conductor → última llamada del periodo
  [...L].sort((a, b) => a.ts - b.ts).forEach(x => ultimo.set(low(x.conductor), x));
  const sinLocalizar = [...ultimo.values()].filter(x => NO_CONTACTO.has(x.resultado)).map(x => x.conductor);

  // Resolución: instantánea (en la propia llamada) vs seguimiento (horas hasta cerrarse).
  const conSeguimiento = resueltas.filter(x => x.tsResuelta > x.ts + 60);
  const enLlamada = resueltas.filter(x => x.tsResuelta && x.tsResuelta <= x.ts + 60);
  const mediaResolucionH = conSeguimiento.length
    ? Math.round(conSeguimiento.reduce((s, x) => s + (x.tsResuelta - x.ts), 0) / conSeguimiento.length / 360) / 10
    : 0;

  const cuenta = (campo, conMotivos) => {
    const m = new Map();
    L.forEach(x => {
      const k = x[campo] || '—';
      if (!m.has(k)) m.set(k, { n: 0, pendientes: 0, ...(conMotivos ? { motivos: new Set() } : {}) });
      const v = m.get(k); v.n++;
      if (x.estado === 'pendiente') v.pendientes++;
      if (conMotivos) v.motivos.add(x.motivo);
    });
    return m;
  };
  const porConductor = top(cuenta('conductor', true), 10).map(x => ({ ...x, motivos: x.motivos.size }));

  // Reincidencia: pares conductor+motivo con ≥2 llamadas en 30 días, mirando también
  // el historial anterior al periodo para no perder las que vienen de atrás.
  const V30 = 30 * 86400;
  const enL = new Set(L.map(x => x.clave));
  const porPar = new Map();
  H.forEach(x => {
    const k = `${low(x.conductor)}|${low(x.motivo)}`;
    if (!porPar.has(k)) porPar.set(k, []);
    porPar.get(k).push(x);
  });
  const reincidencias = [];
  for (const grupo of porPar.values()) {
    grupo.sort((a, b) => a.ts - b.ts);
    const enPeriodo = grupo.filter(x => enL.has(x.clave));
    if (!enPeriodo.length) continue;
    const ult = enPeriodo[enPeriodo.length - 1];
    const enVentana = grupo.filter(x => ult.ts - x.ts >= 0 && ult.ts - x.ts < V30);
    if (enVentana.length >= 2) {
      reincidencias.push({ conductor: ult.conductor, motivo: ult.motivo, n: enVentana.length, ultima: ult.ts });
    }
  }
  reincidencias.sort((a, b) => b.n - a.n || b.ultima - a.ultima);

  const porTurno = { 'Día': 0, 'Noche': 0, '—': 0 };
  L.forEach(x => { porTurno[x.turno === 'Día' || x.turno === 'Noche' ? x.turno : '—']++; });

  return {
    total: L.length,
    salientes: L.filter(x => x.direccion === 'saliente').length,
    entrantes: L.filter(x => x.direccion === 'entrante').length,
    resueltas: resueltas.length, pctResueltas: pct(resueltas.length, L.length),
    pendientes: L.filter(x => x.estado === 'pendiente').length,
    noContactadas: noContacto.length, pctNoContactadas: pct(noContacto.length, L.length),
    sinLocalizar,
    resueltasEnLlamada: enLlamada.length, conSeguimiento: conSeguimiento.length, mediaResolucionH,
    porCluster: top(cuenta('cluster'), 99),
    porMotivo: top(cuenta('motivo'), 8),
    porConductor,
    porMatricula: top(cuenta('matricula'), 8).filter(x => x.nombre !== '—'),
    porTurno,
    reincidencias: reincidencias.slice(0, 12)
  };
}

// ── Conductores para el formulario ─────────────────────────────────────────
// A quién se puede llamar, con su coche y su turno.
//
// Sale de la PLANTILLA, que es la lista de personas del sistema. Antes lo daba
// el motor viejo leyendo la rejilla de la semana, y contestaba a OTRA pregunta:
// «quién tiene hueco en un coche HOY». Eso dejaba fuera a todo el que librara
// hoy —112 de 215— que es justo a quien a veces hay que llamar.
let _condCache = { ts: 0, lista: [] };
async function conductoresForm() {
  if (Date.now() - _condCache.ts < 10 * 60 * 1000) return _condCache.lista;
  const { filas } = await require('../Conductores/plantilla.service').lista({});
  _condCache = {
    ts: Date.now(),
    lista: filas
      .filter(c => c.empleo_vigente && !c.es_centinela)
      .map(c => ({
        id: String(c.id),
        nombre: c.nombre_completo || c.nombre || `Conductor ${c.id}`,
        telefono: c.telefono || '',
        // Con dos coches vienen separados por '+': es quien cubre día y noche.
        matricula: c.matricula || '',
        turno: c.turno || '',
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  };
  return _condCache.lista;
}

/**
 * LO QUE PINTA EL PANEL, de una sola vuelta: los KPIs del periodo, sus llamadas
 * y las pendientes DE CUALQUIER FECHA.
 *
 * Las pendientes van aparte del periodo a propósito: una llamada sin resolver
 * de hace tres días sigue sin resolver hoy, y si solo saliera dentro de su
 * ventana desaparecería de la vista justo cuando más falta hace verla.
 *
 * El tope de 800 llamadas es para que un mes entero no mande un JSON de varios
 * megas al navegador. Los KPIs se calculan sobre el periodo COMPLETO, antes de
 * recortar: la cifra no depende de cuántas quepan en la tabla.
 */
async function panelDelPeriodo({ desde, hasta } = {}) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = hoyMadrid();
  const d = ISO.test(desde || '') ? desde : hoy;
  const h = ISO.test(hasta || '') ? hasta : hoy;
  const d0 = inicioDia(d), d1 = finDia(h);

  const todas = await listar();
  const periodo = todas.filter(x => x.ts >= d0 && x.ts < d1);
  return {
    desde: d, hasta: h,
    kpis: kpis(periodo, todas),
    llamadas: [...periodo].sort((a, b) => b.ts - a.ts).slice(0, 800),
    pendientes: todas.filter(x => x.estado === 'pendiente').sort((a, b) => a.ts - b.ts),
  };
}

module.exports = {
  CATALOGO, RESULTADOS_UNIVERSALES,
  validarClasificacion, registrar, resolver, listar, kpis, conductoresForm,
  panelDelPeriodo, inicioDia, finDia, hoyMadrid
};
