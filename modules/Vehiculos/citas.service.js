// ============================================================
// CITAS DEL TALLER — la puerta
// ============================================================
// Camilo, 08/10/2026: el taller manda un Excel con las citas de mantenimiento
// (MATRICULA · VEHICULO · CITA TALLER · HORA). Se sube en Mantenimientos y:
//
//   · EL RESPONSABLE de cada cita es quien lleva ese coche ese día y a esa hora
//     en el planificador. No se guarda: se pregunta cada vez, porque el cuadrante
//     cambia hasta el último momento.
//   · DOS DÍAS ANTES se le avisa por WhatsApp con la plantilla de la cita, que
//     trae dos botones: «Confirmo» y «No puedo ir». Lo que pulse queda en la cita.
//   · CONTROL le llama para confirmarla y apunta lo que dijo; la llamada queda
//     también en su historial de llamadas, como cualquier otra.
//
// QUÉ SE IMPORTA. Solo los coches de la flota de Madrid que están vivos. Lo
// demás se ignora y se dice por qué: que no está en el sistema, que es de otra
// sede (el 1888LTJ, de Barcelona) o que está dado de baja.

const repo = require('./citas.repo');
const { SEDE_FLOTA, HORA_DIA, HORA_NOCHE, nombreDePila } = require('../../services/nucleo');

const PLANTILLA = (process.env.PLANTILLA_CITA_TALLER || 'cita_taller').trim();
// Cuántos días antes avisa el sistema solo. El de la víspera y el del mismo día
// se avisan a mano (Camilo): el sistema no manda nada fuera de este día.
const DIAS_ANTES = 2;

const ESTADOS = [
  { codigo: 'pendiente', etiqueta: 'Pendiente' },
  { codigo: 'hecha', etiqueta: 'Hecha' },
  { codigo: 'no_presentado', etiqueta: 'No se presentó' },
  { codigo: 'anulada', etiqueta: 'Anulada' },
];
const ETQ_ESTADO = Object.fromEntries(ESTADOS.map(e => [e.codigo, e.etiqueta]));

const CONFIRMACIONES = {
  confirmada: 'Confirmada',
  no_puede: 'No puede ir',
  no_contesta: 'No contesta',
  otro_conductor: 'Ya no lleva el coche',
};

// Lo que puede salir de una llamada de Control. `caso` es el texto con el que
// queda en el historial de llamadas y el que el Call Center clasifica
// (`callcenter.service.DESDE_CONTROL`): no se renombra sin tocar los dos.
const RESULTADOS_LLAMADA = [
  { valor: 'confirma', texto: 'Confirma la cita', confirmacion: 'confirmada', caso: 'Cita de taller: confirma' },
  { valor: 'no_puede', texto: 'No puede ir', confirmacion: 'no_puede', caso: 'Cita de taller: no puede ir' },
  { valor: 'no_contesta', texto: 'No contesta', confirmacion: 'no_contesta', caso: 'Cita de taller: no contesta' },
  { valor: 'buzon', texto: 'Buzón de voz', confirmacion: 'no_contesta', caso: 'Cita de taller: buzón de voz' },
  { valor: 'otro', texto: 'Ya no lleva ese coche', confirmacion: 'otro_conductor', caso: 'Cita de taller: ya no lleva el coche' },
];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// ── Fechas ──────────────────────────────────────────────────────────────────

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const sumarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const esIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dosCifras = n => String(n).padStart(2, '0');

/** '2026-10-10' → 'viernes 10 de octubre'. Es lo que lee el conductor. */
function fechaLarga(iso) {
  const d = new Date(Date.parse(iso + 'T12:00:00Z'));
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

// ── Cómo se lee el Excel ────────────────────────────────────────────────────

/** Sin acentos, sin signos, en minúsculas y con los espacios justos. */
const plano = v => String(v == null ? '' : v)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const normMat = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** El valor de una celda de exceljs sin envoltorios (fórmula, texto enriquecido). */
function crudo(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.result !== undefined) return crudo(v.result);
    if (v.text !== undefined) return crudo(v.text);
  }
  return v;
}

/**
 * El día de la cita. Excel la da como fecha (exceljs la deja a las 00:00 UTC),
 * pero se entiende también escrita: «10/10/2026», «10-10-26», «2026-10-10».
 */
function fechaDe(valor) {
  const v = crudo(valor);
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v)) throw new Error('fecha ilegible');
    return `${v.getUTCFullYear()}-${dosCifras(v.getUTCMonth() + 1)}-${dosCifras(v.getUTCDate())}`;
  }
  if (typeof v === 'number') {                    // número de serie de Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    return fechaDe(d);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3], s);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], s);
  throw new Error(`no se entiende la fecha «${s}»`);
}
function valida(a, m, d, s) {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) throw new Error(`la fecha «${s}» no existe`);
  return `${a}-${dosCifras(m)}-${dosCifras(d)}`;
}

/** La hora: «10:00», «10.30», «10h», una hora de Excel (1899-12-30T10:00Z) o una fracción del día. */
function horaDe(valor) {
  const v = crudo(valor);
  if (v == null || v === '') return null;
  let min;
  if (v instanceof Date) {
    if (isNaN(v)) throw new Error('hora ilegible');
    min = Math.round((v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds()) / 60);
  } else if (typeof v === 'number') {
    min = Math.round((v % 1) * 1440);
  } else {
    const m = String(v).trim().match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:h|hrs?)?$/i);
    if (!m) throw new Error(`no se entiende la hora «${String(v).trim()}»`);
    min = Number(m[1]) * 60 + Number(m[2] || 0);
  }
  if (min >= 1440) min -= 1440;
  if (min < 0 || min >= 1440) throw new Error('hora fuera del día');
  return `${dosCifras(Math.floor(min / 60))}:${dosCifras(min % 60)}`;
}

// Los títulos de las columnas, ya «planos». Si el taller cambia uno, va aquí.
const COLUMNAS = {
  matricula: ['matricula', 'matricula del vehiculo'],
  marca: ['vehiculo', 'marca', 'modelo'],
  fecha: ['cita taller', 'fecha', 'fecha cita', 'dia', 'cita'],
  hora: ['hora', 'hora cita'],
};

/**
 * LEE EL EXCEL del taller. La hoja es la que tenga la columna de la matrícula en
 * su cabecera (en las primeras filas, por si trae un título encima). Devuelve
 * { hoja, filas: [{ fila, matricula, marca, fecha, hora }], errores }.
 */
async function leerExcel(bytes) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes); }
  catch (e) { throw new Error('No se pudo abrir el archivo: tiene que ser un Excel (.xlsx)'); }

  let ws = null, cab = null, filaCab = 1;
  for (const h of wb.worksheets) {
    for (let n = 1; n <= Math.min(10, h.rowCount) && !ws; n++) {
      const m = new Map();
      h.getRow(n).eachCell({ includeEmpty: false }, (c, col) => m.set(plano(crudo(c.value)), col));
      if (COLUMNAS.matricula.some(t => m.has(t))) { ws = h; cab = m; filaCab = n; }
    }
    if (ws) break;
  }
  if (!ws) throw new Error('No encuentro la hoja: ninguna tiene la columna «MATRICULA» en su cabecera');
  const col = k => { for (const t of COLUMNAS[k]) if (cab.has(t)) return cab.get(t); return null; };
  const c = { matricula: col('matricula'), marca: col('marca'), fecha: col('fecha'), hora: col('hora') };
  if (!c.fecha) throw new Error('Falta la columna del día de la cita («CITA TALLER»)');
  if (!c.hora) throw new Error('Falta la columna «HORA»');

  const filas = [], errores = [];
  for (let n = filaCab + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const val = k => (c[k] ? row.getCell(c[k]).value : null);
    const matricula = normMat(crudo(val('matricula')));
    if (!matricula) continue;                                   // filas vacías
    let fecha = null, hora = null;
    try { fecha = fechaDe(val('fecha')); } catch (e) { errores.push(`Fila ${n} (${matricula}): ${e.message}`); }
    try { hora = horaDe(val('hora')); } catch (e) { errores.push(`Fila ${n} (${matricula}): ${e.message}`); }
    if (!fecha && !errores.some(x => x.startsWith(`Fila ${n} `))) errores.push(`Fila ${n} (${matricula}): falta el día de la cita`);
    if (!hora && fecha && !errores.some(x => x.startsWith(`Fila ${n} `))) errores.push(`Fila ${n} (${matricula}): falta la hora`);
    filas.push({ fila: n, matricula, marca: String(crudo(val('marca')) || '').trim().slice(0, 40) || null, fecha, hora });
  }
  return { hoja: ws.name, filas, errores };
}

/** Por qué no se cita un coche. null = se cita. */
function motivoIgnorada(v) {
  if (!v) return 'No está en el sistema';
  if (v.de_baja) return 'Está dado de baja en Vehículos';
  if (v.sede !== SEDE_FLOTA) return `No es de Madrid: es de ${v.sede === 'barcelona' ? 'Barcelona' : (v.sede || 'otra sede')}`;
  return null;
}

/**
 * IMPORTA EL EXCEL del taller. Lo que ya estaba no se duplica: una cita es un
 * coche y un día. Si el taller cambió la hora, se cambia en la misma cita, y si
 * ya se había avisado de la otra hora, el aviso y la confirmación se borran
 * (quedan en el seguimiento) para volver a avisar.
 *
 * Las citas de días que ya pasaron no se importan. Las que había entre las
 * fechas del Excel y ya no vienen NO se anulan solas: se listan, por si el
 * taller las ha quitado.
 */
async function importar({ base64, nombre } = {}, quien = {}) {
  const limpio = String(base64 || '').replace(/^data:[^,]*,/, '');
  if (!limpio) throw new Error('No ha llegado ningún archivo');
  const fichero = String(nombre || '').trim().slice(0, 200) || null;

  const leido = await leerExcel(Buffer.from(limpio, 'base64'));
  if (leido.errores.length) {
    const e = new Error(`No se ha importado nada: hay ${leido.errores.length} fila(s) que no se entienden. ` +
      leido.errores.slice(0, 10).join(' · ') + (leido.errores.length > 10 ? ' · …' : ''));
    e.errores = leido.errores;
    throw e;
  }
  if (!leido.filas.length) throw new Error('El Excel no trae ninguna cita');

  const avisos = [];
  const hoy = hoyMadrid();
  // Un coche, un día: si sale dos veces, vale la última fila.
  const porClave = new Map();
  leido.filas.forEach(f => {
    const k = f.matricula + '|' + f.fecha;
    if (porClave.has(k)) avisos.push(`${f.matricula} sale dos veces el ${f.fecha.split('-').reverse().join('/')} (filas ${porClave.get(k).fila} y ${f.fila}): vale la ${f.fila}`);
    porClave.set(k, f);
  });

  const coches = await repo.vehiculosPorMatricula([...new Set(leido.filas.map(f => f.matricula))]);
  const ignoradas = new Map(), pasadas = [], buenas = [];
  for (const f of porClave.values()) {
    const v = coches.get(f.matricula);
    const motivo = motivoIgnorada(v);
    if (motivo) {
      if (!ignoradas.has(f.matricula)) ignoradas.set(f.matricula, { matricula: f.matricula, motivo, citas: 0 });
      ignoradas.get(f.matricula).citas++;
      continue;
    }
    if (f.fecha < hoy) { pasadas.push(f.matricula); continue; }
    buenas.push({ ...f, vehiculoId: Number(v.id) });
  }

  const nuevas = [], cambios = [], iguales = [];
  const fechas = buenas.map(f => f.fecha).sort();
  const yaHay = fechas.length ? await repo.entreFechas(fechas[0], fechas[fechas.length - 1]) : [];
  const porCocheDia = new Map(yaHay.map(c => [c.vehiculo_id + '|' + c.fecha, c]));
  const vistas = new Set();
  for (const f of buenas) {
    const antes = porCocheDia.get(f.vehiculoId + '|' + f.fecha);
    if (!antes) { nuevas.push(f); continue; }
    vistas.add(String(antes.id));
    if (antes.estado === 'anulada') avisos.push(`${f.matricula} (${f.fecha.split('-').reverse().join('/')}) estaba anulada y vuelve a venir: no se ha tocado`);
    if (antes.hora === f.hora) { iguales.push(f.matricula); continue; }
    cambios.push({ id: antes.id, hora: f.hora, horaAntes: antes.hora, marca: f.marca, matricula: f.matricula,
      reiniciar: !!(antes.avisada || antes.confirmacion) });
  }
  const noVienen = yaHay
    .filter(c => !vistas.has(String(c.id)) && c.estado === 'pendiente' && c.fecha >= hoy)
    .map(c => `${c.matricula} · ${c.fecha.split('-').reverse().join('/')} ${c.hora}`);

  await repo.guardarImportacion({ nuevas, cambios, fichero }, quien);
  const ign = [...ignoradas.values()].sort((a, b) => a.matricula.localeCompare(b.matricula));
  console.log(`🔧 [Citas taller] Excel «${fichero || leido.hoja}»: ${nuevas.length} nueva(s), ${cambios.length} con otra hora, ` +
    `${iguales.length} igual(es), ${ign.length} matrícula(s) ignorada(s), ${pasadas.length} pasada(s)`);
  return {
    hoja: leido.hoja, filas: leido.filas.length,
    nuevas: nuevas.length, cambiadas: cambios.map(c => `${c.matricula}: ${c.horaAntes} → ${c.hora}` +
      (c.reiniciar ? ' (ya avisado: hay que volver a avisar)' : '')),
    iguales: iguales.length, ignoradas: ign, pasadas: pasadas.length, noVienen, avisos,
  };
}

// ── El responsable ──────────────────────────────────────────────────────────

/**
 * EL TURNO QUE TIENE EL COCHE a esa hora. El día va de las 05 a las 17 y la
 * noche de las 17 a las 05 del día siguiente: una cita a las 03:00 del día 10
 * es de la noche del 9.
 */
function turnoDeLaCita(fecha, hora) {
  const h = Number(String(hora || '').slice(0, 2));
  if (h < HORA_DIA) return { dia: sumarDias(fecha, -1), turno: 'noche' };
  if (h < HORA_NOCHE) return { dia: fecha, turno: 'dia' };
  return { dia: fecha, turno: 'noche' };
}

const persona = x => x && {
  conductorId: String(x.conductor_id), nombre: x.nombre || `#${x.conductor_id}`,
  pila: nombreDePila({ nombre: x.nombre_ficha, apellidos: x.apellidos, nombreBolt: x.nombre_bolt }) || x.nombre || '',
  telefono: x.telefono || '', rol: x.rol, turno: x.turno,
};

/**
 * Añade a cada cita su RESPONSABLE de ahora (el planificador manda) y quién
 * más tiene el coche ese día, por si hay que llamar a otro. Una consulta para
 * todas.
 */
async function conResponsable(citas) {
  if (!citas.length) return citas;
  const ids = [...new Set(citas.map(c => Number(c.vehiculo_id)))];
  const fechas = citas.map(c => c.fecha).sort();
  const filas = await repo.cobertura(ids, sumarDias(fechas[0], -1), fechas[fechas.length - 1]);
  const de = (veh, dia, turno) => filas.filter(f => String(f.vehiculo_id) === String(veh) && f.dia === dia && (!turno || f.turno === turno));
  return citas.map(c => {
    const t = turnoDeLaCita(c.fecha, c.hora);
    const quienes = de(c.vehiculo_id, t.dia, t.turno);   // ya vienen con el FIJO primero
    const responsable = persona(quienes[0]) || null;
    const otros = de(c.vehiculo_id, c.fecha).filter(f => !quienes[0] || String(f.conductor_id) !== String(quienes[0].conductor_id) || f.turno !== t.turno)
      .map(persona);
    const avisado = c.aviso_conductor_id ? String(c.aviso_conductor_id) : null;
    return {
      ...c,
      turno: t.turno, diaTurno: t.dia,
      fechaLarga: fechaLarga(c.fecha),
      estadoEtiqueta: ETQ_ESTADO[c.estado] || c.estado,
      confirmacionEtiqueta: c.confirmacion ? CONFIRMACIONES[c.confirmacion] : '',
      responsable, otros,
      // Se avisó a uno y el cuadrante ahora dice otro: hay que avisar al nuevo.
      cambioDeConductor: !!(avisado && responsable && avisado !== responsable.conductorId),
      mensaje: responsable ? textoAviso({ nombre: responsable.pila, matricula: c.matricula, fecha: c.fecha, hora: c.hora }) : '',
    };
  });
}

/** Las cuatro variables de la plantilla, en su orden. */
const valoresAviso = ({ nombre, matricula, fecha, hora }) =>
  [nombre || 'compañero', matricula, fechaLarga(fecha), hora];

/** El mensaje entero, igual que la plantilla: es lo que se copia para mandarlo a mano. */
function textoAviso(d) {
  const [n, m, f, h] = valoresAviso(d);
  return `Hola ${n}, el coche ${m} tiene cita en el taller el ${f} a las ${h}, y ese día lo llevas tú.\n\n` +
    'Llévalo a esa hora, por favor. Si no puedes, pulsa «No puedo ir» y te llamamos.';
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/**
 * LAS CITAS de un tramo de días, con su responsable. Por defecto desde hoy y
 * un mes. `resumen` cuenta las de los próximos días que piden algo.
 */
async function lista({ desde, hasta } = {}) {
  const hoy = hoyMadrid();
  const d = esIso(desde) ? desde : hoy;
  const h = esIso(hasta) ? hasta : sumarDias(d, 31);
  if (h < d) throw new Error('El «hasta» va antes que el «desde»');
  const citas = await conResponsable(await repo.lista({ desde: d, hasta: h }));
  const proximas = citas.filter(c => c.estado === 'pendiente' && c.fecha <= sumarDias(hoy, DIAS_ANTES));
  return {
    desde: d, hasta: h, hoy, citas,
    resumen: {
      total: citas.length,
      pendientes: citas.filter(c => c.estado === 'pendiente').length,
      proximas: proximas.length,
      sinAvisar: proximas.filter(c => !c.aviso_at).length,
      sinConfirmar: proximas.filter(c => c.confirmacion !== 'confirmada').length,
      noPueden: citas.filter(c => c.estado === 'pendiente' && c.confirmacion === 'no_puede').length,
      sinResponsable: citas.filter(c => c.estado === 'pendiente' && !c.responsable).length,
    },
  };
}

/** Las de hoy y los `dias` siguientes: lo que mira Control para llamar. */
function proximas({ dias } = {}) {
  const n = Math.min(Math.max(Number.parseInt(dias, 10) || DIAS_ANTES, 0), 60);
  const hoy = hoyMadrid();
  return lista({ desde: hoy, hasta: sumarDias(hoy, n) });
}

// Hasta dónde se mira para decir «Cita puesta para revisión»: lo que manda el
// taller llega con semanas, no con meses.
const DIAS_CITA_ESTADO = 120;

/**
 * LA PRÓXIMA CITA DE CADA COCHE, para el estado de la flota de Mantenimientos
 * (08/10/2026): la primera pendiente desde hoy, con quien lo lleva ese día.
 * Map vehiculoId (texto) → cita, con `otras` = cuántas más tiene detrás.
 * El responsable se busca solo para esas, en una consulta.
 */
async function proximaPorCoche() {
  const hoy = hoyMadrid();
  const pendientes = (await repo.lista({ desde: hoy, hasta: sumarDias(hoy, DIAS_CITA_ESTADO) }))
    .filter(c => c.estado === 'pendiente');
  const primera = new Map();
  pendientes.forEach(c => {
    const k = String(c.vehiculo_id);
    if (primera.has(k)) primera.get(k).otras++;
    else primera.set(k, { cita: c, otras: 0 });
  });
  const conR = await conResponsable([...primera.values()].map(x => x.cita));
  return new Map(conR.map(c => [String(c.vehiculo_id), { ...c, otras: primera.get(String(c.vehiculo_id)).otras }]));
}

/** Las citas pendientes de un coche desde hoy, con su responsable: la ficha del taller. */
async function deCoche(vehiculoId) {
  const id = Number(vehiculoId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const hoy = hoyMadrid();
  const citas = (await repo.lista({ desde: hoy, hasta: sumarDias(hoy, DIAS_CITA_ESTADO), vehiculoId: id }))
    .filter(c => c.estado === 'pendiente');
  return conResponsable(citas);
}

/** Una cita con todo lo que ha pasado con ella. */
async function ficha(id) {
  const c = await repo.una(id);
  if (!c) throw new Error('No existe esa cita');
  const [conR] = await conResponsable([c]);
  return { ...conR, seguimiento: await repo.seguimiento(c.id) };
}

// ── El aviso ────────────────────────────────────────────────────────────────

/**
 * AVISA POR WHATSAPP al responsable de la cita, con la plantilla. Lo usa el
 * cron dos días antes y el botón «Avisar por WhatsApp» de Mantenimientos. Si
 * no sale, se apunta el porqué y no lanza: el cron sigue con las demás.
 */
async function avisar(id, quien = {}) {
  const c = await repo.una(id);
  if (!c) throw new Error('No existe esa cita');
  if (c.estado !== 'pendiente') throw new Error(`La cita está «${ETQ_ESTADO[c.estado]}»: no se avisa`);
  const [x] = await conResponsable([c]);
  const r = x.responsable;
  const falla = async msg => { await repo.marcarIntento(c.id, msg); return { ok: false, error: msg, matricula: c.matricula }; };
  if (!r) return falla('Nadie lleva el coche en ese turno según el planificador');
  if (!r.telefono) return falla(`${r.nombre} no tiene teléfono en su ficha`);

  const wa = require('../../services/whatsapp');
  const valores = valoresAviso({ nombre: r.pila, matricula: c.matricula, fecha: c.fecha, hora: c.hora });
  const env = await wa.enviarPlantillaPosicional(r.telefono, PLANTILLA, valores,
    { origen: 'taller', usuarioId: quien.usuarioId || null, texto: textoAviso({ nombre: r.pila, matricula: c.matricula, fecha: c.fecha, hora: c.hora }) });
  if (!env || !env.ok) return falla(`WhatsApp no lo aceptó: ${(env && env.error) || 'sin respuesta'}`);
  await repo.marcarAviso(c.id, {
    via: 'whatsapp', conductorId: Number(r.conductorId), telefono: r.telefono, wamid: env.id,
    nota: `A ${r.nombre} (${r.telefono})`,
  }, quien);
  console.log(`🔧 [Citas taller] Aviso de ${c.matricula} (${c.fecha} ${c.hora}) a ${r.nombre}`);
  return { ok: true, conductor: r.nombre, matricula: c.matricula };
}

/** Lo avisó alguien a mano (desde el bot o por teléfono). Se apunta a quién. */
async function marcarAvisado(id, { conductorId, nota } = {}, quien = {}) {
  const c = await repo.una(id);
  if (!c) throw new Error('No existe esa cita');
  let cid = Number(conductorId) || null;
  if (!cid) { const [x] = await conResponsable([c]); cid = x.responsable ? Number(x.responsable.conductorId) : null; }
  if (!cid) throw new Error('¿A quién se avisó? Nadie lleva el coche ese día en el planificador');
  const p = await repo.conductor(cid);
  if (!p) throw new Error('No existe ese conductor');
  await repo.marcarAviso(c.id, {
    via: 'manual', conductorId: cid, telefono: p.telefono,
    nota: [`A ${p.nombre}`, String(nota || '').trim()].filter(Boolean).join(' · '),
  }, quien);
  return { ok: true };
}

/**
 * EL CRON: avisa las citas de dentro de dos días. Solo ese día: lo de mañana y
 * lo de hoy, a mano. Devuelve cuántas salieron y cuáles no, para el registro.
 */
async function avisarLasDeDentroDeDos() {
  const fecha = sumarDias(hoyMadrid(), DIAS_ANTES);
  const ids = await repo.paraAvisar(fecha);
  const r = { fecha, avisadas: 0, fallos: [] };
  for (const id of ids) {
    try {
      const x = await avisar(id, {});
      if (x.ok) r.avisadas++; else r.fallos.push(`${x.matricula}: ${x.error}`);
    } catch (e) { r.fallos.push(`cita ${id}: ${e.message}`); }
  }
  return r;
}

// ── Lo que contesta el conductor y lo que apunta Control ───────────────────

/** ¿Es un botón de la plantilla de la cita? 'confirma' / 'no_puede' / null. */
function botonDeCita(etiqueta) {
  const p = plano(etiqueta);
  if (/^confirm/.test(p)) return 'confirma';
  if (/^no puedo/.test(p)) return 'no_puede';
  return null;
}

/**
 * EL CONDUCTOR PULSÓ UN BOTÓN del aviso. Se busca la cita por el mensaje al que
 * contesta y, si no, por su teléfono. Devuelve el texto con el que se le
 * contesta, o null si no hay cita (el bot sigue como siempre).
 */
async function respuestaDelConductor({ telefono, etiqueta, wamid }) {
  const boton = botonDeCita(etiqueta);
  if (!boton) return null;
  const id = await repo.deRespuesta({ telefono, wamid, hoy: hoyMadrid() });
  if (!id) return null;
  const c = await repo.una(id);
  const confirma = boton === 'confirma';
  await repo.apuntarRespuesta(id, {
    tipo: 'respuesta', via: 'whatsapp', confirmacion: confirma ? 'confirmada' : 'no_puede',
    resultado: confirma ? 'Confirma por WhatsApp' : 'No puede ir (WhatsApp)',
    conductorId: c.aviso_conductor_id ? Number(c.aviso_conductor_id) : null,
  });
  console.log(`🔧 [Citas taller] ${c.matricula} (${c.fecha}): ${confirma ? 'confirma' : 'NO PUEDE'} por WhatsApp`);
  const cuando = `el ${fechaLarga(c.fecha)} a las ${c.hora}`;
  return {
    citaId: id, confirma,
    texto: confirma
      ? `Gracias. Queda confirmado: ${cuando} llevas el ${c.matricula} al taller.`
      : `Entendido. Te llamamos desde Control para ver qué hacemos con la cita del ${c.matricula} (${cuando}).`,
  };
}

/**
 * UNA LLAMADA DE CONTROL por la cita. Queda en el seguimiento de la cita y en
 * el historial de llamadas del conductor (tipo «Taller»), que es lo que lee el
 * Call Center. «No contesta» no pisa una confirmación que ya había.
 */
async function apuntarLlamada(id, b = {}, quien = {}) {
  const c = await repo.una(id);
  if (!c) throw new Error('No existe esa cita');
  const valor = String(b.resultado && typeof b.resultado === 'object' ? b.resultado.valor : (b.resultado || '')).trim();
  const res = RESULTADOS_LLAMADA.find(x => x.valor === valor);
  if (!res) throw new Error('Elige qué ha dicho');
  const conductorId = Number(b.conductorId);
  if (!Number.isInteger(conductorId) || conductorId <= 0) throw new Error('¿A quién has llamado?');
  const nota = String(b.nota || '').trim().slice(0, 300);
  if (res.valor === 'no_puede' && nota.length < 3) throw new Error('Cuenta en la nota por qué no puede ir');

  const pisa = !(res.confirmacion === 'no_contesta' && ['confirmada', 'no_puede'].includes(c.confirmacion));
  await repo.apuntarRespuesta(c.id, {
    tipo: 'llamada', via: 'llamada', confirmacion: pisa ? res.confirmacion : null,
    resultado: res.texto, nota, conductorId,
  }, quien);

  // Y en el historial de llamadas de Control, como cualquier otra.
  const t = turnoDeLaCita(c.fecha, c.hora);
  await require('../../services/repo/llamadas').registrar({
    conductorId, usuarioId: quien.usuarioId, origen: 'control', tipo: 'taller',
    resultado: res.caso, matricula: c.matricula, turno: t.turno,
    nota: [`Cita del ${c.fecha.split('-').reverse().join('/')} a las ${c.hora}`, nota].filter(Boolean).join(' · '),
  });
  console.log(`📞 [Citas taller] ${c.matricula} (${c.fecha}): ${res.texto} · usuario ${quien.usuarioId || '?'}`);
  return { ok: true };
}

/** Hecha, no se presentó, anulada o de vuelta a pendiente. Anular pide motivo. */
async function cambiarEstado(id, { estado, nota } = {}, quien = {}) {
  const e = String(estado && typeof estado === 'object' ? estado.valor : (estado || '')).trim();
  if (!ETQ_ESTADO[e]) throw new Error('Estado desconocido');
  const n = String(nota || '').trim().slice(0, 300);
  if (['anulada', 'no_presentado'].includes(e) && n.length < 3) throw new Error('Di por qué: queda escrito');
  await repo.cambiarEstado(Number(id), { estado: e, etiqueta: ETQ_ESTADO[e], nota: n }, quien);
  return { ok: true };
}

module.exports = {
  PLANTILLA, DIAS_ANTES, ESTADOS, CONFIRMACIONES, RESULTADOS_LLAMADA,
  importar, lista, proximas, proximaPorCoche, deCoche, ficha, avisar, marcarAvisado, avisarLasDeDentroDeDos,
  respuestaDelConductor, apuntarLlamada, cambiarEstado,
  // Sueltas para las pruebas.
  leerExcel, fechaDe, horaDe, turnoDeLaCita, motivoIgnorada, fechaLarga, textoAviso, valoresAviso,
  botonDeCita, sumarDias,
};
