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
// ── DOS SITIOS DONDE SE LLAMA, UNA SOLA HISTORIA ────────────────────────────
// A un conductor se le llama desde dos pantallas, y las dos son de verdad:
//
//   · el CALL CENTER, donde se teclea la llamada entera con su clasificación y,
//     si queda algo abierto, su seguimiento. Vive en `llamada_cc`.
//   · CONTROL · EN DIRECTO (y sus campañas), el telefonito: se llama con la
//     carta del conductor delante y se marca en dos toques qué pasa. Vive en
//     `llamada_seguimiento`, con su jornada operativa (05→05) y con lo que
//     contestó de cada alerta abierta.
//
// Hasta db/131 el Call Center COPIABA las de Control, y las copiaba mal: todas
// entraban como «Asistencia → Conexión → No se ha conectado a su puesto» porque
// la clasificación estaba clavada en el código del espejo. Ahora no se copia:
// se LEE. Las de Control se clasifican al vuelo con `DESDE_CONTROL` (abajo) y
// cada llamada sigue viviendo donde nació. Copiar da dos versiones de un hecho
// y la copia envejece; leer no puede desincronizarse.

const TZ = 'Europe/Madrid';

// ── Catálogo ──────────────────────────────────────────────────────────────────
// Cada motivo aparece UNA vez, en UN cluster. Los resultados son por motivo; a
// todos se les suman los universales de contacto (abajo).
//
// CUIDADO AL RENOMBRAR: estos textos no son solo etiquetas. `fv_cat_incidencia`
// guarda cluster/subcluster/motivo para que justificar una incidencia de
// /operaciones/vivo cree su llamada, y `DESDE_CONTROL` apunta aquí. Renombrar
// un motivo deja huérfano lo que apuntaba a él. AÑADIR es libre; renombrar pide
// migración.
const CATALOGO = [
  { cluster: 'Asistencia', icono: 'fa-user-check', subclusters: [
    { nombre: 'Conexión', motivos: [
      { motivo: 'No se ha conectado a su puesto',
        resultados: ['Confirma que sale ya', 'No asistirá', 'Incidencia que lo impide'],
        acciones: ['Avisar a tráfico para cubrir el turno', 'Recordar horario', 'Programar seguimiento'] },
      { motivo: 'Revisión de asistencia / confirmación de turno',
        resultados: ['Confirma asistencia', 'No asistirá', 'Duda resuelta'],
        acciones: ['Confirmar en el planificador', 'Avisar a tráfico'] },
      { motivo: 'No llegará a sus horas',
        resultados: ['Alargará el turno', 'No podrá alargar', 'Justifica las horas que faltan'],
        acciones: ['Pedir justificante', 'Avisar a tráfico', 'Programar seguimiento'] },
      { motivo: 'Se fue antes de terminar',
        resultados: ['Justifica la salida', 'Sin justificación', 'Volverá a conectarse'],
        acciones: ['Pedir justificante', 'Registrar advertencia'] }
    ] },
    { nombre: 'Ausencias', motivos: [
      { motivo: 'Justificante de ausencia',
        resultados: ['Justificante recibido', 'Quedó en enviarlo', 'No lo aportará'],
        acciones: ['Solicitar justificante', 'Registrar en RRHH', 'Programar seguimiento'] },
      { motivo: 'Ausencia sin avisar',
        resultados: ['Da explicación', 'Sin explicación', 'Aportará justificante'],
        acciones: ['Registrar advertencia', 'Avisar a RRHH'] }
    ] }
  ] },

  // TRÁFICO no es «operativa»: son los problemas que NO son del conductor sino
  // de lo que se le entrega —el coche, las llaves, el relevo—. Mezclarlos con
  // la operativa del servicio los escondía, y son justo los que hay que poder
  // contar para ir a hablar con quien reparte los coches.
  { cluster: 'Tráfico', icono: 'fa-satellite-dish', subclusters: [
    { nombre: 'Asignación de coche', motivos: [
      { motivo: 'No le han entregado el coche',
        resultados: ['Se le entrega ya', 'Se le asigna otro', 'Sin coche disponible'],
        acciones: ['Avisar a tráfico', 'Buscar coche libre', 'Programar seguimiento'] },
      { motivo: 'Sin coche asignado',
        resultados: ['Se le asigna ya', 'Sin coche disponible', 'Error del cuadrante'],
        acciones: ['Asignar en el planificador', 'Avisar a tráfico'] },
      { motivo: 'Su coche lo lleva otro',
        resultados: ['Se aclara la asignación', 'Se le asigna otro', 'Escalado a tráfico'],
        acciones: ['Revisar el cuadrante', 'Avisar a tráfico'] },
      { motivo: 'No sabe qué coche le toca',
        resultados: ['Se le indica el coche', 'No tiene coche asignado'],
        acciones: ['Reenviar aviso "Ver mis turnos"', 'Avisar a tráfico'] }
    ] },
    { nombre: 'Relevo', motivos: [
      { motivo: 'El relevo no ha llegado',
        resultados: ['El relevo llega ya', 'Se queda esperando', 'Deja el coche en base'],
        acciones: ['Llamar al relevo', 'Avisar a tráfico'] }
    ] },
    { nombre: 'Llaves y base', motivos: [
      { motivo: 'Problema con las llaves',
        resultados: ['Resuelto en llamada', 'Escalado a tráfico', 'Va a base a por ellas'],
        acciones: ['Avisar a base', 'Abrir puerta desde el bot'] }
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
    ] },
    // Los rechazos son el motivo número uno de las alertas de Control (82 de
    // 203) y no tenían sitio: acababan de «espera extendida», que es otra cosa.
    { nombre: 'Aceptación', motivos: [
      { motivo: 'Viajes rechazados',
        resultados: ['Reconoce los rechazos', 'Dice que fue la app', 'Advertido'],
        acciones: ['Recordar política de aceptación', 'Registrar advertencia', 'Cruzar con auditoría en vivo'] },
      { motivo: 'Aceptación baja',
        resultados: ['Reconoce el dato', 'Dice que fue la app', 'Advertido'],
        acciones: ['Recordar política de aceptación', 'Registrar advertencia'] },
      { motivo: 'Solicitudes sin contestar',
        resultados: ['Reconoce el dato', 'Problema de cobertura o del móvil', 'Advertido'],
        acciones: ['Revisar el móvil con él', 'Registrar advertencia'] }
    ] },
    { nombre: 'Recorridos', motivos: [
      { motivo: 'Km fuera de la aplicación',
        resultados: ['Justificado', 'Sin justificación', 'Expediente abierto'],
        acciones: ['Cruzar con auditoría de km', 'Registrar advertencia', 'Abrir expediente'] }
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
    { nombre: 'Taller y revisiones', motivos: [
      { motivo: 'Coche inmovilizado en taller',
        resultados: ['Sale hoy del taller', 'Sigue inmovilizado', 'Cambio de vehículo'],
        acciones: ['Coordinar coche de sustitución', 'Avisar a taller', 'Programar seguimiento'] },
      { motivo: 'Limpieza, ITV o revisión programada',
        resultados: ['Cita confirmada', 'Reprogramada', 'No podrá llevarlo'],
        acciones: ['Confirmar cita', 'Reprogramar'] }
    ] },
    { nombre: 'Equipamiento', motivos: [
      { motivo: 'Equipamiento del coche (luz, mampara, taxímetro)',
        resultados: ['Resuelto en llamada', 'Revisión en base', 'Cambio de vehículo'],
        acciones: ['Programar revisión en base', 'Abrir parte de taller'] }
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

  // RRHH y NÓMINA van separados a propósito: una baja médica y un error en el
  // finiquito se gestionan con gente distinta y se miden distinto.
  { cluster: 'RRHH', icono: 'fa-id-card', subclusters: [
    { nombre: 'Ausencias', motivos: [
      { motivo: 'Ausencia por baja médica',
        resultados: ['Aportará el parte', 'Parte recibido', 'No lo aportará'],
        acciones: ['Solicitar parte de baja', 'Registrar en RRHH', 'Programar seguimiento'] },
      { motivo: 'Vacaciones o libranza',
        resultados: ['Confirmado en el cuadrante', 'No constaba', 'Error del cuadrante'],
        acciones: ['Revisar el planificador', 'Registrar en RRHH'] },
      { motivo: 'Permiso retribuido',
        resultados: ['Aportará el justificante', 'Justificante recibido', 'No procede'],
        acciones: ['Solicitar justificante', 'Registrar en RRHH'] }
    ] },
    { nombre: 'Documentación', motivos: [
      { motivo: 'Documentación caducada o pendiente',
        resultados: ['Quedó en aportarla', 'Documento recibido', 'No lo aportará'],
        acciones: ['Solicitar documento', 'Registrar en RRHH', 'Programar seguimiento'] }
    ] },
    { nombre: 'Contrato', motivos: [
      { motivo: 'Dice que ya no trabaja aquí',
        resultados: ['Confirmada la baja', 'Sigue de alta', 'Pendiente de comprobar'],
        acciones: ['Comprobar con RRHH', 'Dar de baja en el planificador'] },
      { motivo: 'Consulta sobre su contrato',
        resultados: ['Aclarado', 'Escalado a RRHH'],
        acciones: ['Abrir ticket de RRHH'] }
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
        acciones: ['Actualizar planificador', 'Consultar con tráfico'] },
      { motivo: 'Cambio de turno sin avisar',
        resultados: ['Justificado', 'Advertido', 'Expediente abierto'],
        acciones: ['Registrar advertencia', 'Actualizar planificador'] }
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
  ] },

  // Lo que cuenta el PASAJERO. Hoy estas llamadas no tenían dónde caer y
  // acababan en «conducta» o en ningún sitio; son las que más caro salen.
  { cluster: 'Cliente', icono: 'fa-user-tie', subclusters: [
    { nombre: 'Quejas', motivos: [
      { motivo: 'Queja de un pasajero',
        resultados: ['Da su versión', 'Reconoce los hechos', 'Advertido', 'Expediente abierto'],
        acciones: ['Registrar advertencia', 'Abrir expediente', 'Responder a Bolt'] }
    ] },
    { nombre: 'Objetos', motivos: [
      { motivo: 'Objeto olvidado en el coche',
        resultados: ['Lo tiene y lo entrega', 'No lo encuentra', 'Entregado en base'],
        acciones: ['Coordinar entrega en base', 'Avisar al pasajero'] }
    ] },
    { nombre: 'Incidencias en viaje', motivos: [
      { motivo: 'Incidencia durante un viaje',
        resultados: ['Aclarado', 'Escalado a Bolt', 'Expediente abierto'],
        acciones: ['Pedir detalle del viaje', 'Abrir caso con Bolt'] }
    ] }
  ] }
];

// Válidos para CUALQUIER motivo (sobre todo en salientes): la llamada existió
// aunque no hubiera conversación, y de ahí sale el KPI de no contactados.
const RESULTADOS_UNIVERSALES = ['No contactado', 'Buzón / no contesta', 'Número erróneo'];
// El KPI de «no contactadas» tiene que valer también para las llamadas de
// Control, que escriben sus propias palabras ('Buzón', 'No contesta'). Si no,
// 128 llamadas sin contacto contarían como contacto.
const NO_CONTACTO = new Set([...RESULTADOS_UNIVERSALES, 'Buzón', 'No contesta']);

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

// ── De Control al catálogo ───────────────────────────────────────────────────
// El telefonito de Control marca un TIPO (taller, rrhh, tráfico…) y un CASO
// ('Avería en ruta'). Eso es, en el vocabulario de aquí, un motivo — pero más
// fino. Así que el caso decide el MOTIVO (la familia) y se conserva tal cual
// como RESULTADO, que es lo que marcó quien llamó.
//
// Dos cosas que no son obvias:
//
//   · El resultado de una llamada de Control NO se valida contra el catálogo.
//     Es lo que se apuntó entonces, y reescribirlo para que encaje sería
//     inventar. El catálogo manda en lo que se ESCRIBE; lo que ya se dijo se
//     respeta.
//   · Lo que no esté en este mapa cae en el motivo por defecto de su tipo, y si
//     el tipo tampoco está, en «No se ha conectado a su puesto» — que es de
//     donde viene el telefonito. Nunca se pierde una llamada por no saber
//     clasificarla.
const DESDE_CONTROL = {
  seguimiento: { _: ['Asistencia', 'Conexión', 'No se ha conectado a su puesto'] },

  taller: {
    _: ['Vehículo', 'Avería', 'Problema con el coche'],
    // Las tres averías caen en el mismo motivo, pero van escritas: así, el día
    // que alguien añada un caso nuevo al telefonito, la prueba lo canta en vez
    // de dejarlo heredar el de por defecto en silencio.
    'Avería: no puede salir': ['Vehículo', 'Avería', 'Problema con el coche'],
    'Avería en ruta': ['Vehículo', 'Avería', 'Problema con el coche'],
    'Pinchazo o neumáticos': ['Vehículo', 'Avería', 'Problema con el coche'],
    'El coche está en revisión': ['Vehículo', 'Taller y revisiones', 'Coche inmovilizado en taller'],
    'Va camino del taller': ['Vehículo', 'Taller y revisiones', 'Coche inmovilizado en taller'],
    'Esperando recambio': ['Vehículo', 'Taller y revisiones', 'Coche inmovilizado en taller'],
    'Limpieza o ITV': ['Vehículo', 'Taller y revisiones', 'Limpieza, ITV o revisión programada'],
    'Golpe o siniestro': ['Vehículo', 'Siniestro', 'Siniestro / accidente'],
    'Sin luz de puerta / mampara / taxímetro':
      ['Vehículo', 'Equipamiento', 'Equipamiento del coche (luz, mampara, taxímetro)'],
  },

  rrhh: {
    _: ['RRHH', 'Ausencias', 'Vacaciones o libranza'],
    'Presunta baja médica': ['RRHH', 'Ausencias', 'Ausencia por baja médica'],
    'Presuntas vacaciones': ['RRHH', 'Ausencias', 'Vacaciones o libranza'],
    'Presunta libranza': ['RRHH', 'Ausencias', 'Vacaciones o libranza'],
    'Presunto permiso retribuido': ['RRHH', 'Ausencias', 'Permiso retribuido'],
    'Dice que está de baja en la empresa': ['RRHH', 'Contrato', 'Dice que ya no trabaja aquí'],
    'Asunto propio sin avisar': ['Asistencia', 'Ausencias', 'Ausencia sin avisar'],
    'No ha entregado el justificante': ['Asistencia', 'Ausencias', 'Justificante de ausencia'],
    'Problema con su nómina o contrato': ['Nómina', 'Incidencias', 'Problema en la nómina'],
  },

  trafico: {
    _: ['Tráfico', 'Asignación de coche', 'Sin coche asignado'],
    'No le han entregado el coche': ['Tráfico', 'Asignación de coche', 'No le han entregado el coche'],
    'No tiene coche asignado': ['Tráfico', 'Asignación de coche', 'Sin coche asignado'],
    'Su coche lo lleva otro': ['Tráfico', 'Asignación de coche', 'Su coche lo lleva otro'],
    'No sabe qué coche le toca': ['Tráfico', 'Asignación de coche', 'No sabe qué coche le toca'],
    'El relevo no ha llegado': ['Tráfico', 'Relevo', 'El relevo no ha llegado'],
    'Problema con las llaves': ['Tráfico', 'Llaves y base', 'Problema con las llaves'],
    'Cambió el turno sin avisar': ['Turnos', 'Cambios', 'Cambio de turno sin avisar'],
    'Se ha quedado sin combustible o carga':
      ['Vehículo', 'Combustible', 'Problemas con la gasolina / repostaje'],
    'Problema con la app de BOLT': ['Tecnología', 'Bolt', 'Problemas con Bolt (app o cuenta)'],
  },
};

// Las llamadas por ALERTA no traen caso: traen el código de la alerta por la
// que se preguntó. Ese código sí es estable (la etiqueta lleva el número del
// momento: "No llegará · faltan 0,6 h"), así que se clasifica por él.
const DESDE_ALERTA = {
  rechazo_directo: ['Operativa', 'Aceptación', 'Viajes rechazados'],
  rechazos: ['Operativa', 'Aceptación', 'Viajes rechazados'],
  aceptacion_baja: ['Operativa', 'Aceptación', 'Aceptación baja'],
  sin_respuesta: ['Operativa', 'Aceptación', 'Solicitudes sin contestar'],
  no_llegara: ['Asistencia', 'Conexión', 'No llegará a sus horas'],
  no_llego: ['Asistencia', 'Conexión', 'No llegará a sus horas'],
  se_fue_pronto: ['Asistencia', 'Conexión', 'Se fue antes de terminar'],
  km_parado: ['Operativa', 'Recorridos', 'Km fuera de la aplicación'],
  rueda_caido: ['Conducta', 'Uso del vehículo', 'Uso personal del coche'],
  rueda_descanso: ['Conducta', 'Uso del vehículo', 'Uso personal del coche'],
  j_rechazada: ['Asistencia', 'Ausencias', 'Justificante de ausencia'],
  j_presunta: ['Asistencia', 'Ausencias', 'Justificante de ausencia'],
};

const POR_DEFECTO = ['Asistencia', 'Conexión', 'No se ha conectado a su puesto'];

/**
 * Clasifica una llamada de Control. Nunca falla: si no sabe, devuelve el motivo
 * del telefonito, que es de donde viene.
 *
 * Una llamada por alerta puede llevar varias alertas contestadas; manda la
 * PRIMERA que sepamos clasificar, porque es la que abrió la llamada.
 */
function clasificarControl(ll) {
  const tipo = low(ll.tipo) || 'seguimiento';
  if (tipo === 'alerta') {
    const cod = (ll.alertas || []).map(a => DESDE_ALERTA[String(a.alerta || '')]).find(Boolean);
    const [cluster, subcluster, motivo] = cod || POR_DEFECTO;
    return { cluster, subcluster, motivo };
  }
  const mapa = DESDE_CONTROL[tipo];
  const [cluster, subcluster, motivo] =
    (mapa && (mapa[String(ll.resultado || '').trim()] || mapa._)) || POR_DEFECTO;
  return { cluster, subcluster, motivo };
}

// ── Fechas (el servidor corre con TZ=Europe/Madrid; Render lo tiene puesto) ───
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
// 'YYYY-MM-DD' → epoch (s) a las 00:00 de Madrid. Se apoya en el TZ del proceso.
const inicioDia = f => Math.floor(new Date(`${f}T00:00:00`).getTime() / 1000);
const finDia = f => inicioDia(f) + 86400;

const repo = require('./callcenter.repo');
const repoControl = require('../../services/repo/llamadas');

/**
 * A quién se llamó, en id de la base. La reincidencia se cuenta POR PERSONA, y
 * por nombre se contaría mal en cuanto alguien lo escriba distinto. Si no se
 * resuelve, la llamada se guarda igual con el nombre tecleado: perder la llamada
 * sería peor que perder el enlace.
 */
async function resolverPersona(d) {
  if (d.conductorId && Number(d.conductorId) > 0) return Number(d.conductorId);
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
    origen: d.origen === 'flota_viva' ? 'flota_viva' : 'callcenter',
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

/**
 * UNA LLAMADA DE CONTROL, con el mismo aspecto que una del Call Center.
 *
 * `clave` lleva el prefijo 'ct-' para que no pueda chocar nunca con las 'cc-' y
 * para que la pantalla sepa que esta no se resuelve aquí: las de Control no
 * tienen seguimiento, se cierran solas en el momento.
 */
function aLlamadaDeControl(x) {
  const cls = clasificarControl(x);
  const notas = [x.nota, ...(x.alertas || []).map(a => `${a.etiqueta || a.alerta}: ${a.comentario}`)]
    .filter(Boolean).join(' · ');
  return {
    clave: `ct-${x.id}`, ts: x.ts,
    agente: x.agente || '', direccion: 'saliente',
    fuente: 'control', origen: x.origen || 'control', dia: x.dia || '',
    tipo: x.tipo || '', alertas: x.alertas || [],
    conductorId: x.conductorId ? String(x.conductorId) : null,
    conductor: x.conductor || '', telefono: x.telefono || '',
    matricula: x.matricula || '',
    turno: x.turno === 'noche' ? 'Noche' : x.turno === 'dia' ? 'Día' : '',
    ...cls,
    resultado: x.resultado || '(sin resultado)',
    accion: '', notas,
    // Una llamada de Control nace y muere en el momento: se marca lo que pasó y
    // ya está. No hay nada que «dejar pendiente», así que cuenta como resuelta
    // en el acto — que es la verdad, no un atajo.
    estado: 'resuelta', tsResuelta: x.ts, resueltaPor: x.agente || '', resolucion: '',
  };
}

/** Las del Call Center, marcadas con su fuente para que la pantalla las separe. */
const marcarCC = ll => ({ ...ll, fuente: 'callcenter', dia: '', tipo: '', alertas: [] });

/**
 * TODAS LAS LLAMADAS DE UNA VENTANA, de las dos fuentes, la última primero.
 *
 * `desde`/`hasta` son epoch en segundos (no fechas) a propósito: convertir una
 * fecha a instante depende de la zona horaria, y hacerlo una sola vez —arriba,
 * donde se sabe qué día pidió el usuario— evita el clásico de perder un día
 * entero al cruzar `date` con `timestamptz`.
 */
// Tope por fuente. A ~100 llamadas al día hacen falta seis meses para rozarlo,
// pero un tope que recorta en silencio es peor que no tenerlo: la pantalla
// enseñaría números más pequeños de la cuenta sin decir nada. Por eso
// `llamadasEntre` avisa cuando lo toca, y el panel lo escribe.
const TOPE = 20000;

async function llamadasEntre(desde, hasta) {
  const [cc, ct] = await Promise.all([
    repo.listar({ desde, hasta, limite: TOPE }),
    repoControl.paraCallCenter({ desde, hasta, limite: TOPE }),
  ]);
  const todas = [...cc.map(marcarCC), ...ct.map(aLlamadaDeControl)].sort((a, b) => b.ts - a.ts);
  todas.tope = cc.length >= TOPE || ct.length >= TOPE;
  return todas;
}

/** Todas las llamadas, de la más nueva a la más vieja (sin ventana). */
const listar = () => llamadasEntre(0, Math.floor(Date.now() / 1000) + 86400);

// ── KPIs (función pura: se prueba sin base de datos) ─────────────────────────
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const top = (mapa, n) => [...mapa.entries()].map(([nombre, v]) => ({ nombre, ...v }))
  .sort((a, b) => b.n - a.n).slice(0, n);

/**
 * KPIs sobre un conjunto de llamadas (ya filtrado por periodo).
 * `todas` (opcional) = historial más ancho, para detectar reincidencias que
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
      reincidencias.push({
        conductor: ult.conductor, conductorId: ult.conductorId,
        motivo: ult.motivo, n: enVentana.length, ultima: ult.ts,
      });
    }
  }
  reincidencias.sort((a, b) => b.n - a.n || b.ultima - a.ultima);

  const porTurno = { 'Día': 0, 'Noche': 0, '—': 0 };
  L.forEach(x => { porTurno[x.turno === 'Día' || x.turno === 'Noche' ? x.turno : '—']++; });

  return {
    total: L.length,
    salientes: L.filter(x => x.direccion === 'saliente').length,
    entrantes: L.filter(x => x.direccion === 'entrante').length,
    deControl: L.filter(x => x.fuente === 'control').length,
    delCallCenter: L.filter(x => x.fuente !== 'control').length,
    conductores: new Set(L.map(x => x.conductorId || low(x.conductor))).size,
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
 * Se leen 30 DÍAS MÁS de los que se piden, y solo para la reincidencia: la
 * ventana de reincidencia es de 30 días, así que sin ese colchón una segunda
 * llamada del día 1 del periodo nunca vería a la primera del día 28 anterior.
 * Los KPIs se calculan sobre el periodo, no sobre el colchón.
 *
 * El tope de 800 llamadas en la tabla es para que un mes entero no mande un
 * JSON de varios megas al navegador. Los KPIs se calculan antes de recortar.
 */
async function panelDelPeriodo({ desde, hasta } = {}) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = hoyMadrid();
  const d = ISO.test(desde || '') ? desde : hoy;
  const h = ISO.test(hasta || '') ? hasta : hoy;
  const d0 = inicioDia(d), d1 = finDia(h);

  const [anchas, pendientes] = await Promise.all([
    llamadasEntre(d0 - 30 * 86400, d1),
    repo.pendientes(),
  ]);
  const periodo = anchas.filter(x => x.ts >= d0 && x.ts < d1);
  return {
    desde: d, hasta: h,
    kpis: kpis(periodo, anchas),
    llamadas: periodo.slice(0, 800),
    truncado: periodo.length > 800,
    // Lo de arriba recorta la TABLA; esto avisa de que se recortó la LECTURA, que
    // es otra cosa: ahí los KPIs también se quedarían cortos.
    tope: !!anchas.tope,
    pendientes: pendientes.map(marcarCC).sort((a, b) => a.ts - b.ts),
  };
}

/**
 * LOS CONDUCTORES DEL PERIODO, uno por fila: cuántas llamadas, de dónde, de qué
 * y cuándo fue la última.
 *
 * Se agrupa por ID cuando lo hay y por nombre cuando no. Agrupar solo por
 * nombre juntaría a dos personas que se llaman igual y separaría a la misma
 * persona escrita de dos maneras, que es lo que pasaba en la hoja.
 */
async function porConductor({ desde, hasta } = {}) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = hoyMadrid();
  const d = ISO.test(desde || '') ? desde : hoy;
  const h = ISO.test(hasta || '') ? hasta : hoy;
  const L = await llamadasEntre(inicioDia(d), finDia(h));

  const m = new Map();
  L.forEach(x => {
    const k = x.conductorId ? `id:${x.conductorId}` : `n:${low(x.conductor)}`;
    let c = m.get(k);
    if (!c) {
      c = {
        clave: k, conductorId: x.conductorId || null, conductor: x.conductor,
        telefono: x.telefono || '', matricula: x.matricula || '',
        n: 0, deControl: 0, delCallCenter: 0, pendientes: 0, noContacto: 0,
        motivos: new Map(), clusters: new Map(), ultima: null, primera: null,
      };
      m.set(k, c);
    }
    c.n++;
    if (x.fuente === 'control') c.deControl++; else c.delCallCenter++;
    if (x.estado === 'pendiente') c.pendientes++;
    if (NO_CONTACTO.has(x.resultado)) c.noContacto++;
    c.motivos.set(x.motivo, (c.motivos.get(x.motivo) || 0) + 1);
    c.clusters.set(x.cluster, (c.clusters.get(x.cluster) || 0) + 1);
    if (!c.telefono && x.telefono) c.telefono = x.telefono;
    if (!c.matricula && x.matricula) c.matricula = x.matricula;
    if (!c.ultima || x.ts > c.ultima.ts) c.ultima = x;
    if (!c.primera || x.ts < c.primera.ts) c.primera = x;
  });

  return {
    desde: d, hasta: h,
    conductores: [...m.values()].map(c => ({
      clave: c.clave, conductorId: c.conductorId, conductor: c.conductor,
      telefono: c.telefono, matricula: c.matricula,
      n: c.n, deControl: c.deControl, delCallCenter: c.delCallCenter,
      pendientes: c.pendientes, noContacto: c.noContacto,
      motivosDistintos: c.motivos.size,
      // Su motivo más repetido: es lo que contesta a «¿por qué llamamos tanto a
      // este?» sin abrir la ficha.
      motivoTop: [...c.motivos.entries()].sort((a, b) => b[1] - a[1])[0][0],
      clusterTop: [...c.clusters.entries()].sort((a, b) => b[1] - a[1])[0][0],
      // Reincidente: el mismo motivo dos veces o más dentro del periodo.
      reincide: [...c.motivos.values()].filter(n => n >= 2).length,
      ultima: { ts: c.ultima.ts, motivo: c.ultima.motivo, resultado: c.ultima.resultado, agente: c.ultima.agente },
      primeraTs: c.primera.ts,
    })).sort((a, b) => b.n - a.n || b.ultima.ts - a.ultima.ts),
  };
}

// Tope de llamadas que viajan al navegador de una sola vez. La pantalla las
// pagina de diez en diez, así que no se ven todas juntas de todos modos, y el
// día que alguien acumule cientos esto evita mandar un mamotreto por una
// ventana que se abre para mirar las últimas. Hoy el que más tiene, quince.
const MAX_HISTORIAL = 300;

/**
 * LA HISTORIA COMPLETA DE UNA PERSONA, de las dos fuentes y sin ventana.
 *
 * Sin ventana de fechas a propósito: esta pantalla se abre para contestar
 * «¿cuántas veces hemos hablado con este y de qué?», y esa pregunta no tiene
 * fecha. Se pide entera de una vez y se pagina en el navegador, porque las
 * cifras del resumen necesitan la lista completa: paginar contra la base
 * costaría dos consultas por página en vez de una por apertura.
 */
async function historiaConductor(conductorId) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');
  const [cc, ct] = await Promise.all([
    repo.deConductor(id),
    repoControl.paraCallCenter({ conductorId: id }),
  ]);
  const L = [...cc.map(marcarCC), ...ct.map(aLlamadaDeControl)].sort((a, b) => b.ts - a.ts);

  const porMotivo = new Map(), porCluster = new Map(), porAgente = new Map();
  L.forEach(x => {
    porMotivo.set(x.motivo, (porMotivo.get(x.motivo) || 0) + 1);
    porCluster.set(x.cluster, (porCluster.get(x.cluster) || 0) + 1);
    if (x.agente) porAgente.set(x.agente, (porAgente.get(x.agente) || 0) + 1);
  });
  const lista = mapa => [...mapa.entries()].map(([nombre, n]) => ({ nombre, n }))
    .sort((a, b) => b.n - a.n);

  const D30 = Math.floor(Date.now() / 1000) - 30 * 86400;
  // Se manda un tope de filas, pero las CUENTAS de abajo se sacan de la lista
  // entera: si alguien tuviera mil llamadas, el total tiene que seguir diciendo
  // mil aunque solo viajen las 300 últimas. La pantalla avisa de que recortó.
  const mostradas = L.slice(0, MAX_HISTORIAL);
  return {
    conductorId: String(id),
    conductor: (L[0] || {}).conductor || '',
    telefono: (L.find(x => x.telefono) || {}).telefono || '',
    llamadas: mostradas,
    truncado: L.length > mostradas.length,
    resumen: {
      total: L.length,
      ultimos30: L.filter(x => x.ts >= D30).length,
      deControl: L.filter(x => x.fuente === 'control').length,
      delCallCenter: L.filter(x => x.fuente !== 'control').length,
      pendientes: L.filter(x => x.estado === 'pendiente').length,
      noContacto: L.filter(x => NO_CONTACTO.has(x.resultado)).length,
      primera: L.length ? L[L.length - 1].ts : 0,
      ultima: L.length ? L[0].ts : 0,
      porMotivo: lista(porMotivo), porCluster: lista(porCluster), porAgente: lista(porAgente),
    },
  };
}

module.exports = {
  CATALOGO, RESULTADOS_UNIVERSALES, DESDE_CONTROL, DESDE_ALERTA,
  validarClasificacion, clasificarControl, registrar, resolver, listar, kpis,
  conductoresForm, panelDelPeriodo, porConductor, historiaConductor,
  inicioDia, finDia, hoyMadrid
};
