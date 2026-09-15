// ============================================================
// PETICIONES — Tráfico pide, RRHH resuelve
// ============================================================
// Las bajas y las ausencias no se tocan a mano en el cuadrante. Dos caminos:
//
//   · Tráfico crea una petición → queda pendiente → RRHH aprueba o rechaza.
//   · RRHH la crea y la aplica de una vez.
//
// ── QUÉ CAMBIÓ AL SALIR DE LA HOJA (15/09/2026) ─────────────────────────────
// Aprobar una ausencia eran TRES escrituras en dos hojas —el estado en
// AGENDA_V2, la fecha de vuelta en otra columna de AGENDA_V2, y las letras
// V/B/P día a día en VISTA_FINAL— más dos crons: uno que ponía el estado el día
// que la ausencia empezaba y otro que lo quitaba cuando terminaba.
//
// Ahora es UN tramo en `conductor_estado_hist`. Todo lo demás lo hace la base:
// `v_agenda` mira el tramo por fecha, así que el estado aparece y desaparece
// solo el día que toca; la fecha de vuelta es `hasta_previsto`; y las letras
// salen de `cat_estado_conductor.marca_bitacora` cuando la bitácora las pide.
//
// Los dos crons y las tres escrituras se borraron. No se sustituyeron: sobran.
//
// ── Y HABÍA UN FALLO MUDO ───────────────────────────────────────────────────
// Desde que el cuadrante se lee de PostgreSQL, `actualizarConductor` escribía en
// una hoja que YA NO LEÍA NADIE. Aprobar unas vacaciones dejaba la 'V' en
// VISTA_FINAL y el estado en AGENDA_V2, y el planificador —que se reconstruye
// desde la base— no se enteraba. Sin error, sin aviso: la plaza seguía ocupada.

const repo = require('./peticiones.repo');
const plantilla = require('../Conductores/plantilla.service');

// Tipo de petición → estado del catálogo. El reingreso no está: no es una
// situación, es volver a tener contrato (ver abajo).
const ESTADO_DE = {
  vacaciones: 'vacaciones',
  baja_medica: 'baja_medica',
  permiso: 'permiso',
  baja_empresa: 'baja_empresa',
};
// Lo que lleva rango y lo que no.
const SIN_FECHAS = ['reingreso'];      // inmediato
const SIN_HASTA = ['baja_empresa'];    // un despido no tiene fecha de vuelta

const TIPOS = Object.values(repo.ETIQUETA);

/** dd/mm/aaaa (o aaaa-mm-dd) → aaaa-mm-dd. '' si no se entiende. */
function iso(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Valida tipo, persona y fechas. Devuelve todo ya normalizado. */
function validar(datos) {
  const tipo = repo.CODIGO[datos.tipo] || (repo.ETIQUETA[datos.tipo] ? datos.tipo : null);
  if (!tipo) throw new Error('Tipo de petición no válido');

  const conductorId = Number(datos.id_conductor || datos.conductorId);
  if (!conductorId) throw new Error('Falta el conductor');

  if (SIN_FECHAS.includes(tipo)) return { tipo, conductorId, desde: '', hasta: '' };

  const desde = iso(datos.desde);
  if (!desde) throw new Error('Falta la fecha (Desde)');
  if (SIN_HASTA.includes(tipo)) return { tipo, conductorId, desde, hasta: '' };

  const hasta = iso(datos.hasta);
  if (!hasta) throw new Error('Faltan las fechas Desde/Hasta');
  if (hasta < desde) throw new Error('La fecha de vuelta no puede ser anterior al día en que empieza');
  return { tipo, conductorId, desde, hasta };
}

/**
 * EL EFECTO. Aquí es donde una petición aprobada se convierte en un hecho.
 *
 * Todo pasa por la puerta de Conductores (`plantilla.service`), que es quien
 * sabe cerrar una vigencia y abrir la siguiente en una transacción, y quien
 * comprueba que el tramo no pise a otro. Duplicar esas reglas aquí sería tener
 * dos definiciones de qué es estar de vacaciones.
 */
async function aplicar(pet, quien) {
  // EL REINGRESO NO SE APLICA SOLO, Y ES A PROPÓSITO.
  //
  // Volver a la empresa es un contrato nuevo: hace falta la fecha de alta, si es
  // plantilla propia o ETT, la jornada y qué antigüedad se le reconoce. Una
  // petición no trae nada de eso, y ponerlo por defecto sería inventarle a
  // alguien un contrato. Así que se registra la autorización y el alta se
  // completa en la ficha, que es donde está el formulario entero.
  //
  // Antes esto "funcionaba" porque devolver a alguien a una hoja era mover una
  // fila; aquí hay un contrato de por medio.
  if (pet.tipo === 'reingreso') {
    return { siguientePaso: 'alta', msg: 'Reingreso autorizado. Completa el alta en la ficha de la persona (Plantilla → ficha → Dar de alta): ahí se eligen contrato, jornada y antigüedad.' };
  }

  if (pet.tipo === 'baja_empresa') {
    await plantilla.darDeBaja(pet.conductorId, { fecha: pet.desde, motivo: pet.motivo || 'Petición de Tráfico' }, quien);
    return { siguientePaso: null, msg: 'Baja aplicada.' };
  }

  // Vacaciones / baja médica / permiso: un tramo de ausencia.
  await plantilla.anadirAusencia(pet.conductorId, {
    estado: ESTADO_DE[pet.tipo],
    desde: pet.desde,
    hasta: pet.hasta || null,
    motivo: pet.motivo || null,
    peticionId: pet.id || null,
  }, quien);
  return { siguientePaso: null, msg: 'Ausencia aplicada: el estado y la plaza se mueven solos el día que empieza.' };
}

function avisarTrafico(asunto, texto) {
  const { enviarCorreo, CORREO_TRAFICO } = require('../../services/correo');
  enviarCorreo({ to: CORREO_TRAFICO, subject: asunto, text: texto }).catch(() => {});
}

/** Todo lo que la pantalla necesita: las peticiones y a quién se le pueden poner. */
async function datos() {
  const [peticiones, { filas }] = await Promise.all([
    repo.listar(),
    plantilla.lista({}),
  ]);
  const aFila = c => ({
    id: String(c.id),
    nombre: c.nombre_completo || c.nombre || `Conductor ${c.id}`,
    turno: c.turno || '',
    estado: c.situacion_etiqueta || '',
  });
  const orden = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
  return {
    peticiones,
    // Quien está de alta ahora mismo: para bajas y ausencias.
    conductores: filas.filter(c => c.empleo_vigente && !c.es_centinela).map(aFila).sort(orden),
    // Quien ya no lo está: para el reingreso. Antes esto era la hoja
    // CONDUCTORES_OUT; ahora es la misma plantilla mirada del otro lado.
    archivados: filas.filter(c => !c.empleo_vigente && !c.es_centinela).map(aFila).sort(orden),
  };
}

/** Tráfico pide. Queda pendiente hasta que RRHH la resuelva. */
async function crear(datosEntrada = {}, quien = {}) {
  const base = validar(datosEntrada);
  const solicitante = String(datosEntrada.solicitante || datosEntrada.responsable || quien.nombre || '').trim();
  if (!solicitante) throw new Error('Falta el responsable que hace la petición');

  const id = await repo.crear({
    ...base,
    motivo: String(datosEntrada.motivo || '').trim(),
    estado: 'pendiente',
    solicitante, solicitanteId: quien.usuarioId || null,
  });
  return (await repo.listar()).find(p => p.id === String(id));
}

/** RRHH aprueba: ajusta las fechas si hace falta, aplica y avisa a Tráfico. */
async function aprobar(id, opciones = {}, quien = {}) {
  const responsable = String(opciones.resuelto_por || quien.nombre || '').trim();
  if (!responsable) throw new Error('Falta el responsable de RRHH que aprueba');

  const pet = await repo.una(id);
  if (!pet) throw new Error('No existe esa petición');
  if (pet.estado !== 'pendiente') throw new Error('Esa petición ya está resuelta');

  // Las fechas que manda RRHH ganan a las que pidió Tráfico.
  const desde = SIN_FECHAS.includes(pet.tipo) ? '' : (iso(opciones.desde) || pet.desde_iso || '');
  const hasta = (SIN_FECHAS.includes(pet.tipo) || SIN_HASTA.includes(pet.tipo))
    ? '' : (iso(opciones.hasta) || pet.hasta_iso || '');
  if (!SIN_FECHAS.includes(pet.tipo)) {
    if (!desde) throw new Error('Falta la fecha para aprobar');
    if (!SIN_HASTA.includes(pet.tipo) && !hasta) throw new Error('Faltan las fechas Desde/Hasta para aprobar');
    if (hasta && hasta < desde) throw new Error('La fecha de vuelta no puede ser anterior al día en que empieza');
  }

  // SE APLICA ANTES DE MARCARLA APROBADA. Si el efecto falla —las fechas pisan
  // otra ausencia suya, la persona no está de alta— no queda registrada una
  // aprobación que nunca ocurrió. Ese orden importa: al revés, el historial
  // diría que se aprobó y en el cuadrante no habría nada.
  const r = await aplicar({ ...pet, conductorId: pet.conductor_id, desde, hasta, id: pet.id }, quien);

  const cerrada = await repo.resolver(id, {
    estado: 'aprobada', resueltoPor: responsable, resueltoPorId: quien.usuarioId || null,
    desde: desde || null, hasta: hasta || null,
  });
  if (!cerrada) throw new Error('Alguien la resolvió mientras tanto: vuelve a cargar la pantalla');

  const rango = desde ? `\nDesde ${desde}${hasta ? ' hasta ' + hasta : ''}.` : '';
  avisarTrafico(
    `Petición APROBADA — ${repo.ETIQUETA[pet.tipo]} de ${pet.conductor}`,
    `RRHH (${responsable}) aprobó la ${repo.ETIQUETA[pet.tipo]} de ${pet.conductor}.${rango}`);

  const lista = await repo.listar();
  return { peticion: lista.find(p => p.id === String(id)), ...r };
}

/** RRHH rechaza. Avisa a Tráfico con el motivo. */
async function rechazar(id, motivo, resueltoPor, quien = {}) {
  const responsable = String(resueltoPor || quien.nombre || '').trim();
  if (!responsable) throw new Error('Falta el responsable de RRHH que rechaza');

  const pet = await repo.una(id);
  if (!pet) throw new Error('No existe esa petición');
  if (pet.estado !== 'pendiente') throw new Error('Esa petición ya está resuelta');

  const razon = String(motivo || '').trim() || 'Rechazada por RRHH';
  const cerrada = await repo.resolver(id, {
    estado: 'rechazada', resueltoPor: responsable, resueltoPorId: quien.usuarioId || null,
    motivoRechazo: razon,
  });
  if (!cerrada) throw new Error('Alguien la resolvió mientras tanto: vuelve a cargar la pantalla');

  avisarTrafico(
    `Petición RECHAZADA — ${repo.ETIQUETA[pet.tipo]} de ${pet.conductor}`,
    `RRHH (${responsable}) rechazó la ${repo.ETIQUETA[pet.tipo]} de ${pet.conductor}.\nMotivo: ${razon}`);

  const lista = await repo.listar();
  return { peticion: lista.find(p => p.id === String(id)) };
}

/** RRHH crea y aplica de una vez, sin pasar por Tráfico. */
async function crearYAplicar(datosEntrada = {}, quien = {}) {
  const base = validar(datosEntrada);
  const responsable = String(datosEntrada.responsable || datosEntrada.resuelto_por || quien.nombre || '').trim();
  if (!responsable) throw new Error('Falta el responsable de RRHH');
  const motivo = String(datosEntrada.motivo || '').trim();

  // Igual que al aprobar: primero el efecto, después el registro.
  const r = await aplicar({ ...base, motivo }, quien);

  const id = await repo.crear({
    ...base, motivo, estado: 'aprobada',
    solicitante: responsable, solicitanteId: quien.usuarioId || null,
    resueltoPor: responsable, resueltoPorId: quien.usuarioId || null,
  });

  const rango = base.desde ? `\nDesde ${base.desde}${base.hasta ? ' hasta ' + base.hasta : ''}.` : '';
  avisarTrafico(
    `RRHH aplicó ${repo.ETIQUETA[base.tipo]}`,
    `RRHH (${responsable}) registró y aplicó una ${repo.ETIQUETA[base.tipo]}.${rango}`);

  const lista = await repo.listar();
  return { peticion: lista.find(p => p.id === String(id)), ...r };
}

module.exports = {
  datos, crear, aprobar, rechazar, crearYAplicar,
  listar: repo.listar, pendientes: repo.pendientes,
  TIPOS,
};
