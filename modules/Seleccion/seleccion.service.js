// ============================================================
// SELECCIÓN · SERVICIO — de un teléfono a una ficha de alta
// ============================================================
// El recorrido de un candidato: entra por un número de teléfono, se le va
// llenando la ficha, se le piden los papeles y, si llega al final, se le abre
// contrato y pasa a RRHH.
//
// La clave es el ID DE LA CANDIDATURA. El teléfono sirve para BUSCAR a alguien
// —es lo que se sabe de un candidato antes que nada— pero no identifica: una
// persona puede cambiar de número y haber tenido dos procesos.
//
// Aquí vive lo que el controlador tenía dentro y no le tocaba:
//   · el CATÁLOGO de documentos que hay que pedir,
//   · el RESUMEN del embudo,
//   · y las dos orquestaciones largas, la de subir un documento y la de armar
//     la ficha de alta en PDF con sus adjuntos.

const cand = require('./candidaturas.repo');
const vacantes = require('./vacantes.service');
// Por la PUERTA del módulo de Documentos, nunca por su repositorio.
const docs = require('../Documentos/documentos.service');
const drive = require('../../services/drive');
const { generarFichaPDF } = require('../../services/fichaAlta');
const { geocodificar, geocodificarEstructurado } = require('../../services/geocoding');

/**
 * Los documentos que pide la ficha de alta.
 *
 * La pantalla dice "carné" y el catálogo de la base dice "permiso de conducir".
 * La traducción vive AQUÍ y en ningún otro sitio: cuando estaba repartida entre
 * la vista y la ruta, añadir un documento eran dos ficheros y olvidarse de uno
 * dejaba un papel que se pedía pero no se guardaba.
 */
const DOCUMENTOS = [
  { key: 'dni',            tipo: 'dni',             label: 'DNI/NIE (frente)' },
  { key: 'dni_reverso',    tipo: 'dni_reverso',     label: 'DNI/NIE (reverso)', opcional: true },
  { key: 'carnet',         tipo: 'permiso',         label: 'Carné de conducir (frente)' },
  { key: 'carnet_reverso', tipo: 'permiso_reverso', label: 'Carné de conducir (reverso)', opcional: true },
  { key: 'bancario',       tipo: 'cuenta',          label: 'Certificado bancario' },
  { key: 'seg_social',     tipo: 'vida_laboral',    label: 'Vida laboral / certificado SS' },
  { key: 'penales',        tipo: 'penales',         label: 'Certificado de delitos sexuales' },
];

// LOS REVERSOS SON OPCIONALES Y LOS FRENTES NO.
//
// El frente del DNI y del carné llevan lo que la gestoría necesita —número,
// nombre, fechas—; el reverso a veces no se puede conseguir, y bloquear un alta
// entera por la cara de atrás de un carné era parar a alguien que ya está listo
// para trabajar. Se piden igual en la pantalla: lo que cambia es que no impiden.

/**
 * Lo que le falta a una candidatura para que su ficha de alta se pueda generar.
 *
 * La ficha es lo que se manda a la gestoría para dar de alta en la Seguridad
 * Social: si sale con huecos, no sirve, y el hueco se descubre allí y no aquí.
 * Por eso se comprueba antes de generarla y no después.
 *
 * Se mira lo que la ficha IMPRIME —no la lista general de contratación—, que es
 * justo lo que el papel necesita para valer.
 */
const CAMPOS_FICHA = [
  ['nombre', 'Nombre'], ['apellidos', 'Apellidos'], ['dni', 'DNI/NIE'],
  ['direccion', 'Dirección'], ['codigo_postal', 'Código postal'],
  ['fecha_nacimiento', 'Fecha de nacimiento'], ['estado_civil', 'Estado civil'],
  ['num_seg_social', 'Nº de Seguridad Social'], ['telefono', 'Teléfono'],
  ['iban', 'Nº de cuenta bancaria'], ['email', 'Correo'],
  ['carnet_expedicion', 'Fecha de expedición del carné'],
  ['carnet_caducidad', 'Fecha de caducidad del carné'],
  ['fecha_inicio', 'Fecha de inicio'],
];

function faltaParaLaFicha(datos, ficha) {
  const vacio = v => !String(v == null ? '' : v).trim();
  const faltan = CAMPOS_FICHA.filter(([k]) => vacio(datos[k])).map(([, etq]) => etq);
  const puestos = new Set((ficha.documentos || []).filter(x => x.vigente).map(x => x.tipo));
  DOCUMENTOS.filter(d => !d.opcional && !puestos.has(d.tipo))
    .forEach(d => faltan.push('Documento: ' + d.label));
  return faltan;
}

// ── Lo que hace falta para pintar la pantalla ──────────────────────────────

/**
 * Lo que necesita la pantalla al abrirse. Ninguna de las dos consultas puede
 * tumbar la página: si las vacantes fallan se recluta igual, y sin catálogos se
 * ve la lista aunque los desplegables salgan vacíos.
 */
async function paraLaPantalla() {
  const vacio = { estados: [], canales: [], turnos: [], zonas: [], funnel: [] };
  const [v, c] = await Promise.all([
    // Solo las ABIERTAS: una vacante "en proceso" ya tiene candidato, y ofrecerla
    // otra vez es cómo dos reclutadores acababan trabajando la misma plaza.
    //
    // Vienen con TODO lo que hace falta para elegir bien: matrículas, zona,
    // libranzas, la jornada que se ofrece y —si es un recambio— a quién
    // sustituye. Antes era un texto con el puesto y la zona, y quien reclutaba
    // no sabía si estaba ofreciendo 32 h o 40.
    vacantes.disponibles().catch(e => { console.error('❌ [Selección] vacantes:', e.message); return []; }),
    cand.catalogos().catch(e => { console.error('❌ [Selección] catálogos:', e.message); return vacio; }),
  ]);
  return { vacantes: v, catalogos: c, documentos: DOCUMENTOS };
}

/**
 * La lista con su resumen: cuántos hay en cada etapa del embudo.
 *
 * Los contadores se calculan sobre las filas que ya se han traído: son decenas,
 * no hace falta otra consulta. Y el embudo sale del catálogo, en su orden y con
 * su etiqueta, para que la pantalla no lleve su propia copia de las etapas —que
 * es como acaban discrepando.
 */
async function lista({ incluirCerradas } = {}) {
  const [filas, { estados, funnel }] = await Promise.all([
    cand.listar({ incluirCerradas: !!incluirCerradas }),
    cand.catalogos(),
  ]);

  const porEstado = {};
  filas.forEach(f => { porEstado[f.estado] = (porEstado[f.estado] || 0) + 1; });

  return {
    filas,
    resumen: {
      total: filas.length,
      enFunnel: filas.filter(f => f.en_funnel).length,
      porEstado,
      funnel: funnel.map(c => {
        const e = estados.find(x => x.codigo === c) || {};
        return { codigo: c, etiqueta: e.etiqueta, cuantos: porEstado[c] || 0 };
      }),
    },
  };
}

/** La ficha entera, con lo que le falta y los papeles que hay que pedirle. */
async function ficha(id) {
  const f = await cand.ficha(Number(id));
  if (!f) throw new Error('No existe esa candidatura');
  return { ...f, faltan: await cand.faltantes(f.id), documentosPedidos: DOCUMENTOS };
}

// ── Los papeles ────────────────────────────────────────────────────────────

/**
 * Guarda un documento de la candidatura. Los bytes van a Drive; lo que queda
 * aquí es el índice, con su tipo y su caducidad.
 *
 * El documento es DE LA PERSONA, no de la candidatura: por eso se cuelga del
 * `conductor_id`. Alguien que se cae del proceso y vuelve seis meses después no
 * tiene que traer otra vez el DNI.
 */
async function subirDocumento(id, { tipo, emision, caduca, archivo }, quien) {
  const def = DOCUMENTOS.find(d => d.key === tipo);
  if (!def) throw new Error('Tipo de documento no válido');
  if (!archivo) throw new Error('No llegó ningún archivo');

  const f = await cand.ficha(Number(id));
  if (!f) throw new Error('No existe esa candidatura');

  const doc = await docs.subir('conductor', f.conductor_id, {
    tipo: def.tipo,
    nombre: `${def.label} — ${archivo.originalname}`,
    mime: archivo.mimetype,
    base64: archivo.buffer.toString('base64'),
    fechaEmision: emision || null,
    fechaCaduca: caduca || null,
  }, quien);

  return { doc, faltan: await cand.faltantes(Number(id)) };
}

const retirarDocumento = (docId, quien) =>
  docs.retirar(Number(docId), { borrarArchivo: true, ...quien });

/**
 * La FICHA DE ALTA en PDF, con los documentos ya subidos incrustados detrás, y
 * guardada en la carpeta de Drive de esa persona.
 *
 * Un documento que no se puede bajar NO tumba la ficha: se anota y se sigue. La
 * ficha con seis adjuntos de siete sirve para firmar; un error 500 no sirve
 * para nada, y quien está delante del candidato no puede hacer nada con él.
 */
async function fichaPDF(id) {
  const n = Number(id);
  const [datos, f] = await Promise.all([cand.paraFicha(n), cand.ficha(n)]);
  if (!f) throw new Error('No existe esa candidatura');

  // La ficha no sale a medias: o está completa o no se genera.
  const faltan = faltaParaLaFicha(datos, f);
  if (faltan.length) {
    const e = new Error('La ficha no está completa: falta ' + faltan.join(', '));
    e.faltan = faltan;
    throw e;
  }

  const adjuntos = [];
  for (const def of DOCUMENTOS) {
    const d = (f.documentos || []).find(x => x.tipo === def.tipo && x.vigente);
    if (!d) continue;
    try {
      const a = await docs.descargar(d.id);
      adjuntos.push({ label: def.label.toUpperCase(), bytes: a.bytes, mime: a.mime });
    } catch (e) {
      console.error(`❌ [Selección] no se pudo descargar ${def.key}: ${e.message}`);
    }
  }

  const pdf = await generarFichaPDF(datos, adjuntos);
  const nombre = `FICHA DE ALTA - ${(datos.nombre || datos.telefono || n).toString().trim()}.pdf`;
  const archivo = await drive.subir(String(datos.conductorId), {
    nombre, mime: 'application/pdf', base64: Buffer.from(pdf).toString('base64'),
  });
  // Se devuelven TAMBIÉN los bytes. El PDF acaba de generarse aquí; que quien
  // quiere verlo tenga que volver a bajárselo de Drive es un viaje de más para
  // el mismo fichero que ya está en memoria.
  return { link: archivo.webViewLink, nombre, adjuntos: adjuntos.length,
           bytes: Buffer.from(pdf), mime: 'application/pdf' };
}

/**
 * Baja un documento de la persona por la clave que usa la pantalla («carné» y
 * no «permiso»). La traducción es la del catálogo de arriba, que vive en un
 * solo sitio.
 */
async function descargarDocumento(id, key) {
  const def = DOCUMENTOS.find(d => d.key === key);
  if (!def) throw new Error('Tipo de documento no válido');
  const f = await cand.ficha(Number(id));
  if (!f) throw new Error('No existe esa candidatura');
  const d = (f.documentos || []).find(x => x.tipo === def.tipo && x.vigente);
  if (!d) throw new Error(`No tiene subido el ${def.label.toLowerCase()}`);
  return docs.descargar(d.id);
}
// ── El proceso ─────────────────────────────────────────────────────────────

const catalogos = () => cand.catalogos();
const porTelefono = tel => cand.porTelefono(tel);
const abrir = (telefono, datos, quien) => cand.abrir(telefono, datos, quien);
const guardar = (id, datos, quien) => cand.guardar(Number(id), datos, quien);
const cambiarEstado = (id, estado, motivo, quien) =>
  cand.cambiarEstado(Number(id), estado, { motivo, ...quien });
const eliminar = (id, quien) => cand.eliminar(Number(id), quien);

/** Selección termina: se le abre el contrato y pasa a RRHH. */
async function pasarARRHH(id, datos, quien) {
  const r = await cand.pasarARRHH(Number(id), datos, quien);
  console.log(`👤 [SELECCIÓN] ${r.quien} pasa a RRHH (ficha ${r.conductorId})` +
    (r.faltaBolt ? ' — SIN cuenta de BOLT' : ''));
  return r;
}

// ── El tramo final: RRHH y Administración ──────────────────────────────────
// Lo que pasa DESPUÉS de «Listo para RRHH», y que hasta el 15/09/2026 vivía en
// `services/tickets.js` sobre una hoja, con su propio embudo en paralelo.
//
// Aquí no se da de alta a nadie: `pasarARRHH` ya lo hizo —abrió el contrato, puso
// el turno, enlazó BOLT—. Lo que queda es papeleo sobre alguien que YA existe.

/** Las tres bandejas del tramo final, listas para pintar. */
async function tramoFinal() {
  const filas = await cand.tramoFinal();
  const esETT = c => c.canal === 'bolsa_ett' || /ETT/i.test(c.canal_etiqueta || '');
  const preparar = c => ({
    id: String(c.id), conductorId: String(c.conductor_id),
    quien: c.quien, telefono: c.telefono || '', dni: c.dni_nie || '', email: c.email || '',
    naf: c.naf || '', turno: c.turno || '', zona: c.zona || '',
    canal: c.canal_etiqueta || '', ett: esETT(c),
    jornadaHoras: c.jornada_horas, tipoContrato: c.tipo_contrato || '',
    estado: c.estado, estadoEtiqueta: c.estado_etiqueta,
    excelAlta: c.excel_alta || '', pin: c.pin_ballenoil || '', obsPin: c.obs_ballenoil || '',
    // Qué papeles tiene, en el idioma de la pantalla («carné» y no «permiso»).
    documentos: DOCUMENTOS.map(d => ({ key: d.key, label: d.label,
      tiene: (c.docs || []).includes(d.tipo) })),
    inicioPrevisto: c.inicio_previsto, altaAt: c.alta_at, habilitadoAt: c.habilitado_at,
    empleoVigente: !!c.empleo_vigente, motivo: c.motivo || '',
  });
  const por = e => filas.filter(c => c.estado === e).map(preparar);
  return {
    porTramitar: por('listo_rrhh'),
    pendientePin: por('pendiente_pin'),
    hechas: filas.filter(c => c.estado === 'alta' || c.estado === 'asignado').map(preparar),
    noAlta: filas.filter(c => c.estado === 'no_alta' || c.estado === 'rechazado_rrhh').map(preparar),
  };
}

/**
 * El Excel de altas que se le manda a la gestoría, y la marca de que esas
 * fichas ya fueron en uno.
 *
 * Tres reglas, y las tres vienen de que la gestoría COBRA POR ALTA:
 *
 *   · Una ficha solo puede ir en UN Excel. Si ya está en otro, se dice en cuál.
 *   · La ETT no se mezcla con lo nuestro: todas las del Excel, del mismo tipo.
 *   · Y se marca DESPUÉS de generarlo: si el fichero falla, nadie se queda
 *     marcado como enviado sin haberlo estado.
 */
async function excelDeAltas({ ids, fecha, tipo }) {
  const esEtt = tipo === 'ett';
  if (!Array.isArray(ids) || !ids.length) throw new Error('No hay fichas seleccionadas');
  if (!String(fecha || '').trim()) throw new Error('Elige la fecha del grupo de altas');

  const todas = await cand.tramoFinal();
  const pedidas = new Set(ids.map(String));
  const fichas = todas.filter(c => pedidas.has(String(c.id)));
  if (!fichas.length) throw new Error('No se encontraron esas fichas');

  const deEtt = c => c.canal === 'bolsa_ett' || /ETT/i.test(c.canal_etiqueta || '');
  const noCoincide = fichas.filter(c => deEtt(c) !== esEtt);
  if (noCoincide.length) {
    throw new Error(`Estas no son de ${esEtt ? 'ETT' : 'nuestras'}: ` +
      noCoincide.map(c => c.quien).join(', '));
  }

  // La etiqueta lleva «ETT» delante para distinguir los grupos —y para que
  // Plantilla los separe—.
  const etiqueta = (esEtt ? 'ETT ' : '') + String(fecha).trim();
  const enOtro = fichas.filter(c => c.excel_alta && String(c.excel_alta).trim() !== etiqueta);
  if (enOtro.length) {
    throw new Error('Ya están en otro Excel: ' +
      enOtro.map(c => `${c.quien} (${c.excel_alta})`).join(', '));
  }

  const datos = await cand.paraAltasExcel(fichas.map(c => c.id));
  const { generarAltasExcel } = require('../../services/altasExcel');
  const buffer = await generarAltasExcel(datos, fecha);

  await cand.marcarExcelAlta(
    fichas.filter(c => String(c.excel_alta || '').trim() !== etiqueta).map(c => c.id), etiqueta);

  const nombre = 'Altas' + (esEtt ? ' ETT' : '') + ' ' +
    (String(fecha).replace(/\//g, '-') || 'grupo') + '.xlsx';
  console.log(`📄 [RRHH] Excel de altas «${etiqueta}» con ${fichas.length} ficha(s)`);
  return { buffer: Buffer.from(buffer), nombre };
}
/** RRHH tramita el alta: la ficha pasa a esperar el PIN de Ballenoil. */
const tramitarAlta = (id, datos, quien) => cand.tramitarAlta(Number(id), datos, quien);

/** Apunta en qué Excel de altas fue cada ficha. */
const marcarExcelAlta = (ids, referencia) => cand.marcarExcelAlta(ids, referencia);

/**
 * Administración guarda el PIN de Ballenoil. Último paso del alta.
 *
 * Son DOS cosas de dos dueños y por eso se encadenan AQUÍ: el PIN es de la
 * persona y lo escribe Conductores (db/124); mover la candidatura de montón es
 * de este módulo. Un repositorio que llamara al otro módulo dejaría de ser un
 * repositorio —y el verificador de capas lo dice—.
 *
 * Primero el PIN: si eso falla, la candidatura se queda esperando, que es la
 * verdad. Al revés figuraría como resuelta sin PIN que mandar.
 */
async function guardarPin(id, datos, quien) {
  const c = await cand.ficha(Number(id));
  if (!c) throw new Error('No existe esa candidatura');
  const plantilla = require('../Conductores/plantilla.service');
  const p = await plantilla.guardarPinBallenoil(c.conductor_id, datos, quien || {});
  await cand.avanzarTrasPin(Number(id));
  console.log(`💳 [ADMINISTRACIÓN] PIN de Ballenoil guardado a ${p.quien}`);
  return cand.ficha(Number(id));
}

/**
 * El PIN de un teléfono. Lo pide el bot.
 *
 * Se le pregunta a Conductores, que es de quien es el dato; este módulo lo
 * reexporta porque la pantalla que lo pone —Administración— entra por aquí.
 */
const pinPorTelefono = tel =>
  require('../Conductores/plantilla.service').pinPorTelefono(tel);
/** Cuántas fichas esperan en cada sitio. Lo pide la campana. */
const pendientesTramo = () => cand.pendientes();
// ── La dirección ───────────────────────────────────────────────────────────
// Se queda como estaba: es un servicio externo que no tiene que ver con dónde
// se guarden los datos. Con la vía puesta se pregunta por campos, que acierta
// mucho más que mandar la dirección entera en una línea.
const direccion = b => ((b.via && b.via.trim())
  ? geocodificarEstructurado({
    via: b.via, numero: b.numero, tipoVia: b.tipoVia,
    codigoPostal: b.codigo_postal, localidad: b.localidad, provincia: b.provincia,
  })
  : geocodificar(b.direccion));

/**
 * AL CONTRATAR A ALGUIEN POR OTRA PUERTA: que su candidatura lo diga.
 *
 * La usa el alta desde la ficha de Plantilla. Aqui no se abre proceso a quien
 * no lo tiene —eso seria inventarse un candidato—: solo se adelanta el que ya
 * estaba a medias. Quien no tenga ninguna se queda como esta.
 */
const alContratar = (conductorId, { alta } = {}, quien = {}) =>
  cand.abrirContratada(Number(conductorId), { alta, soloSiExiste: true }, quien);

module.exports = {
  DOCUMENTOS,
  paraLaPantalla, lista, ficha, catalogos, porTelefono,
  abrir, guardar, cambiarEstado, pasarARRHH, eliminar, alContratar,
  tramoFinal, tramitarAlta, marcarExcelAlta, excelDeAltas, guardarPin, pinPorTelefono, pendientesTramo,
  subirDocumento, retirarDocumento, descargarDocumento, fichaPDF,
  direccion,
};
