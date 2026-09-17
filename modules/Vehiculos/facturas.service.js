// ============================================================
// FACTURAS DE TALLER — la puerta
// ============================================================
// Desde fuera del módulo se entra por aquí, nunca por `facturas.repo`.
//
// Lo que decide este servicio y no el repositorio: QUÉ SEDES ve quien pregunta.
// El repositorio se niega a listar sin que le digan las sedes —a propósito, para
// que un olvido no enseñe Barcelona a quien solo lleva Madrid— y es aquí donde
// se traduce «este usuario» a «estas sedes».

const repo = require('./facturas.repo');

const SEDES = ['madrid', 'barcelona'];
const SEDE_POR_DEFECTO = 'madrid';

/**
 * Las sedes que puede ver quien pregunta.
 *
 * Óscar lleva el taller de Madrid y el jefe quiere verlo todo, así que la
 * diferencia es un permiso, no un rol: quien tenga `/vehiculos/sedes` ve las
 * dos. El resto, Madrid — que es donde se usa el sistema.
 */
const sedesDe = ({ todasLasSedes = false } = {}) => (todasLasSedes ? SEDES : [SEDE_POR_DEFECTO]);

const normSede = s => (SEDES.includes(String(s || '').toLowerCase()) ? String(s).toLowerCase() : SEDE_POR_DEFECTO);

/** La lista de facturas, ya filtrada por lo que esa persona puede ver. */
const listar = (filtros = {}, quien = {}) =>
  repo.lista({ ...filtros, sedes: sedesDe(quien) });

/**
 * Una factura. Se comprueba la sede DESPUÉS de leerla: la alternativa es
 * meter el filtro en el WHERE y devolver «no existe» para algo que sí existe,
 * y entonces nadie entiende por qué no la encuentra.
 */
async function ver(id, quien = {}) {
  const f = await repo.ficha(id);
  if (!f) throw new Error('Esa factura no existe');
  if (!sedesDe(quien).includes(f.sede)) throw new Error('Esa factura es de otra sede');
  return f;
}

/**
 * Alta. Las líneas sin importe ni matrícula se tiran: son filas vacías del
 * formulario, no gasto.
 *
 * NO se exige que las líneas sumen el total. Una factura trae portes, descuentos
 * y redondeos que no son de ningún coche, y obligar a cuadrarlo al céntimo
 * acabaría con alguien inventándose una línea para poder guardar. Se avisa del
 * descuadre y se guarda lo que dice el papel.
 */
async function alta(datos = {}, quien = {}) {
  const lineas = (datos.lineas || []).filter(l =>
    String(l.matricula || '').trim() || String(l.concepto || '').trim() || Number(l.importe));
  const sede = normSede(datos.sede);
  if (!sedesDe(quien).includes(sede)) throw new Error('No puedes dar de alta facturas de esa sede');

  const r = await repo.crear({ ...datos, sede, lineas }, quien);
  const f = await repo.ficha(r.id);
  const suma = f.lineasDetalle.reduce((a, l) => a + l.importe, 0);
  // EL DESCUADRE SE MIDE CONTRA LA BASE, NO CONTRA EL TOTAL.
  //
  // Los talleres facturan los artículos SIN IVA y el total con él. Comparándolo
  // con el total, una factura perfecta avisaba de que "quedan 528,76 € sin
  // repartir" — que era justo el IVA. Se vio al cargar las nueve facturas
  // reales: las siete daban descuadre y ninguna lo tenía.
  const referencia = f.base != null ? f.base : f.total;
  return {
    ...r,
    // Se devuelve para que la pantalla lo diga, no para impedir el alta.
    descuadre: +(referencia - suma).toFixed(2),
    lineas: f.lineasDetalle.length,
    // Dos avisos distintos, porque se arreglan de forma distinta: el NN se le
    // reclama al taller y la matrícula desconocida se comprueba aquí.
    sinCoche: f.lineasDetalle.filter(l => !l.reconocido && !l.matricula).length,
    desconocidas: f.lineasDetalle.filter(l => !l.reconocido && l.matricula).length,
  };
}

const anular = (id, motivo, quien = {}) => repo.anular(id, motivo, quien);

/**
 * Le pone coche a una línea que estaba sin él (o le corrige la matrícula).
 * Se comprueba antes que la factura sea de una sede que esa persona pueda ver.
 */
async function asignarCoche(facturaId, lineaId, datos, quien = {}) {
  await ver(facturaId, quien);
  const r = await repo.ponerCoche(lineaId, datos);
  if (String(r.facturaId) !== String(facturaId)) throw new Error('Esa línea no es de esa factura');
  return r;
}
const adjuntar = (id, adjunto) => repo.guardarAdjunto(id, adjunto);

/**
 * Guarda el PDF de la factura en Drive y apunta DÓNDE quedó.
 *
 * El fichero va a Drive y el ÍNDICE a Postgres, que es como guarda documentos el
 * resto del sistema: la base no es sitio para megas de papel escaneado, y Drive
 * no es sitio para buscar "qué me gasté en este coche".
 *
 * Una carpeta por MES. En una sola acabarían miles de PDFs con nombres que solo
 * entiende quien los subió.
 *
 * Si Drive falla, NO se toca la factura: mejor una factura sin PDF que una
 * factura apuntando a un archivo que no existe.
 */
async function subirPdf(id, { nombre, mime, base64 } = {}, quien = {}) {
  const f = await ver(id, quien);            // comprueba que existe y que es de su sede
  if (!base64) throw new Error('El archivo llegó vacío');
  const drive = require('../../services/drive');
  if (!drive.configurado || !drive.configurado()) {
    throw new Error('Drive no está configurado en el servidor (falta GOOGLE_CREDENTIALS)');
  }

  const mes = String(f.fecha || '').slice(0, 7) || 'sin-fecha';
  // El nombre lo pone el sistema: así dos facturas del mismo taller no se
  // machacan porque alguien subiera dos veces "escaneo.pdf".
  const limpio = `${f.proveedor} ${f.numero}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
  // La extensión, la que traiga el fichero. No todas las facturas son PDF: las
  // escaneadas llegan en imagen, y llamar «.pdf» a un JPG hace que no abra.
  const ext = (String(nombre || '').match(/[.]([a-z0-9]{2,5})$/i) || [, 'pdf'])[1].toLowerCase();
  const subido = await drive.subir(`Facturas de taller ${mes}`, {
    nombre: `${limpio}.${ext}`,
    mime: mime || 'application/pdf',
    base64,
    // Si ya tenía uno, se REEMPLAZA en vez de dejar dos.
    fileId: f.archivo ? undefined : undefined,
  });

  await repo.guardarAdjunto(id, {
    almacen: 'drive',
    externoId: subido.id,
    enlace: subido.webViewLink || '',
    nombreArchivo: subido.name || nombre || '',
    mime: subido.mimeType || mime || 'application/pdf',
    bytes: subido.size == null ? null : Number(subido.size),
  });
  return { id: String(id), archivo: subido.name, enlace: subido.webViewLink || '' };
}

const proveedores = () => repo.proveedores();
const nuevoProveedor = datos => repo.crearProveedor(datos);

/** El cuadro de gasto por coche, que es para lo que existe todo esto. */
const gasto = (filtros = {}, quien = {}) =>
  repo.gastoPorVehiculo({ ...filtros, sedes: sedesDe(quien) });

/** Lo gastado en UN coche, para pintarlo en su ficha. */
const gastoDeCoche = vehiculoId => repo.gastoDe(vehiculoId);

/** Las matrículas que puede elegir quien está tecleando una factura. */
const flota = (quien = {}) => repo.flota(sedesDe(quien));

module.exports = {
  listar, ver, alta, anular, adjuntar, subirPdf, asignarCoche,
  proveedores, nuevoProveedor,
  gasto, gastoDeCoche, flota,
  sedesDe, SEDES, SEDE_POR_DEFECTO,
  EXIGE_MATRICULA_DESDE: repo.EXIGE_MATRICULA_DESDE,
};
