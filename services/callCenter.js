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
// Persistencia: hoja CALL_CENTER en el libro de sanciones (CALLCENTER_LIBRO para
// cambiarlo). Se escribe solo al registrar y al resolver — nada de refrescos que
// gasten cuota (60/min compartidas por todo el ERP).

const { readSheet, writeSheet, appendRows, ensureSheet } = require('./sheets');

const LIBRO = process.env.CALLCENTER_LIBRO || '18E7ZJpc29aGDAAFNIyrvhScuMgEuYR8qNG1FGVY9_Ns';
const HOJA = 'CALL_CENTER';
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
const legible = ts => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(ts * 1000);
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
// 'YYYY-MM-DD' → epoch (s) a las 00:00 de Madrid. Se apoya en el TZ del proceso.
const inicioDia = f => Math.floor(new Date(`${f}T00:00:00`).getTime() / 1000);
const finDia = f => inicioDia(f) + 86400;

// ── Persistencia ──────────────────────────────────────────────────────────────
// Columnas A:T — 'Resolución' la última para poder añadir más al final sin romper nada.
const CABECERA = ['Clave', 'Ts', 'Fecha', 'Agente', 'Dirección', 'Conductor', 'Teléfono', 'Matrícula', 'Turno',
  'Cluster', 'Subcluster', 'Motivo', 'Resultado', 'Acción', 'Notas', 'Estado', 'Ts resuelta', 'Resuelta el', 'Resuelta por', 'Resolución'];

let _hojaLista = false;
async function asegurarHoja() {
  if (_hojaLista) return;
  await ensureSheet(LIBRO, HOJA);
  const fila1 = await readSheet(LIBRO, `${HOJA}!A1:T1`).catch(() => []);
  if (!fila1.length || !fila1[0][0]) await writeSheet(LIBRO, `${HOJA}!A1`, [CABECERA]);
  _hojaLista = true;
}

const aFila = ll => [ll.clave, ll.ts, legible(ll.ts), ll.agente, ll.direccion, ll.conductor, ll.telefono, ll.matricula,
  ll.turno, ll.cluster, ll.subcluster, ll.motivo, ll.resultado, ll.accion, ll.notas, ll.estado,
  ll.tsResuelta || '', ll.tsResuelta ? legible(ll.tsResuelta) : '', ll.resueltaPor || '', ll.resolucion || ''];

const deFila = f => ({
  clave: f[0] || '', ts: Number(f[1]) || 0, agente: f[3] || '', direccion: f[4] || '', conductor: f[5] || '',
  telefono: f[6] || '', matricula: f[7] || '', turno: f[8] || '', cluster: f[9] || '', subcluster: f[10] || '',
  motivo: f[11] || '', resultado: f[12] || '', accion: f[13] || '', notas: f[14] || '', estado: f[15] || '',
  tsResuelta: Number(f[16]) || 0, resueltaPor: f[18] || '', resolucion: f[19] || ''
});

/** Registra una llamada. Devuelve la llamada canónica tal como quedó guardada. */
async function registrar(datos, agente) {
  const d = datos || {};
  const cls = validarClasificacion(d);
  if (!String(d.conductor || '').trim()) throw new Error('Falta el conductor');
  const direccion = low(d.direccion) === 'entrante' ? 'entrante' : 'saliente';
  const turno = ['Día', 'Noche'].includes(d.turno) ? d.turno : '';
  const estado = low(d.estado) === 'pendiente' ? 'pendiente' : 'resuelta';
  const ts = Math.floor(Date.now() / 1000);
  const ll = {
    clave: `cc-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    ts, agente: agente || '', direccion,
    conductor: String(d.conductor).trim(), telefono: String(d.telefono || '').trim(),
    matricula: String(d.matricula || '').trim().toUpperCase(), turno,
    ...cls,
    accion: String(d.accion || '').trim(), notas: String(d.notas || '').trim(),
    estado,
    // Resuelta en la propia llamada → la resolución es instantánea (cuenta aparte en KPIs).
    tsResuelta: estado === 'resuelta' ? ts : 0,
    resueltaPor: estado === 'resuelta' ? (agente || '') : '', resolucion: ''
  };
  await asegurarHoja();
  await appendRows(LIBRO, `${HOJA}!A:T`, [aFila(ll)]);
  return ll;
}

/** Cierra una llamada pendiente. La nota de resolución es obligatoria. */
async function resolver(clave, { resolucion, resultado } = {}, agente) {
  if (!String(resolucion || '').trim()) throw new Error('La nota de resolución es obligatoria');
  await asegurarHoja();
  const claves = await readSheet(LIBRO, `${HOJA}!A2:A`);
  const idx = claves.findIndex(f => (f[0] || '') === clave);
  if (idx < 0) throw new Error('No encuentro esa llamada');
  const n = idx + 2;
  const [fila] = await readSheet(LIBRO, `${HOJA}!A${n}:T${n}`);
  const ll = deFila(fila);
  if (ll.estado === 'resuelta') throw new Error('Esa llamada ya está resuelta');
  const ts = Math.floor(Date.now() / 1000);
  ll.estado = 'resuelta'; ll.tsResuelta = ts; ll.resueltaPor = agente || ''; ll.resolucion = String(resolucion).trim();
  if (resultado) ll.resultado = validarClasificacion({ ...ll, resultado }).resultado;
  await writeSheet(LIBRO, `${HOJA}!A${n}:T${n}`, [aFila(ll)]);
  return ll;
}

/** Todas las llamadas de la hoja, ya parseadas (en el orden de la hoja). */
async function listar() {
  await asegurarHoja();
  const filas = await readSheet(LIBRO, `${HOJA}!A2:T`).catch(() => []);
  return filas.map(deFila).filter(ll => ll.clave && ll.ts);
}

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

// ── Conductores para el formulario (agenda + asignación de HOY del planificador) ──
let _condCache = { ts: 0, lista: [] };
async function conductoresForm() {
  if (Date.now() - _condCache.ts < 10 * 60 * 1000) return _condCache.lista;
  const planif = require('./planificadorV2');
  const t = await planif.leerTablero({ offsetSemana: 0 });
  const d = (new Date(`${hoyMadrid()}T12:00:00Z`).getUTCDay() + 6) % 7;   // 0 = lunes
  const hoy = new Map();   // id → { matricula, turno }
  (t.coches || []).forEach(c => {
    if (!c.matricula) return;
    [['Día', c.semana && c.semana[d * 2]], ['Noche', c.semana && c.semana[d * 2 + 1]]].forEach(([turno, slot]) => {
      if (!slot || !slot.id) return;
      const prev = hoy.get(slot.id);
      if (prev && prev.matricula === c.matricula) prev.turno = 'Día y Noche';
      else if (!prev) hoy.set(slot.id, { matricula: c.matricula, turno });
    });
  });
  _condCache = {
    ts: Date.now(),
    lista: (t.conductores || []).map(c => ({
      id: c.idBolt || c.id, nombre: c.nombre || c.idBolt || c.id, telefono: c.telefono || '',
      ...(hoy.get(c.idBolt || c.id) || { matricula: '', turno: '' })
    })).filter(c => c.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  };
  return _condCache.lista;
}

module.exports = {
  CATALOGO, RESULTADOS_UNIVERSALES, CABECERA,
  validarClasificacion, registrar, resolver, listar, kpis, conductoresForm,
  inicioDia, finDia, hoyMadrid
};
