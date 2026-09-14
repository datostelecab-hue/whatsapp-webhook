// ============================================================
// DOCUMENTOS — servicio
// ============================================================
// LA PUERTA del archivo documental. Es el sustituto de tener los papeles en el
// ordenador de alguien: el índice vive en PostgreSQL y los bytes en Drive.
//
// ES GENÉRICO A PROPÓSITO. No es "los documentos del conductor": es "los
// documentos DE ALGO". Hoy ese algo puede ser una persona o un coche, porque la
// tabla ya tiene las dos columnas y el catálogo de tipos ya distingue ámbitos.
// El día que haga falta guardar la ficha técnica de un vehículo o el contrato de
// un proveedor, se añade el ámbito y no se toca ni una pantalla de las que ya
// suben documentos.
//
// Por eso `ambito` viaja como dato y no como función distinta: `subir('vehiculo',
// 12, {...})` y `subir('conductor', 83, {...})` son la misma operación.
//
// QUIÉN ENTRA POR AQUÍ: Plantilla (la ficha del conductor), Selección (los
// papeles del candidato) y, cuando lo necesite, cualquier otro módulo. Nadie
// llama a `documentos.repo` desde fuera.

const repo = require('./documentos.repo');
const drive = require('../../services/drive');

// Los ámbitos que hoy admite la tabla. Añadir uno es tocar aquí y el catálogo
// `cat_tipo_documento`, nada más.
const AMBITOS = {
  conductor: 'conductorId',
  vehiculo: 'vehiculoId',
};

/**
 * Traduce (ámbito, id) a lo que espera el repositorio.
 *
 * Se valida aquí y no más abajo para que un ámbito mal escrito dé un error con
 * nombre —"no existe el ámbito proveedor"— en vez de un "falta de quién es el
 * documento" que no dice dónde mirar.
 */
function de(ambito, id) {
  const campo = AMBITOS[ambito];
  if (!campo) {
    throw new Error(`No existe el ámbito de documentos "${ambito}". Los que hay: ${Object.keys(AMBITOS).join(', ')}`);
  }
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Identificador inválido para ${ambito}: "${id}"`);
  return { [campo]: n };
}

// ── Lectura ────────────────────────────────────────────────────────────────

/** Qué tipos de documento se pueden subir en un ámbito, y cuáles caducan. */
const tipos = ambito => { de(ambito, 1); return repo.tipos(ambito); };

/** Los documentos vigentes de alguien (o de algo). */
const listar = (ambito, id, opciones = {}) =>
  repo.listar({ ...de(ambito, id), ...opciones });

/** Qué documentación obligatoria le falta a un conductor. */
const faltantes = conductorId => repo.faltantes(Number(conductorId));

/** Lo mismo para muchos a la vez: lo que necesita un listado, en una consulta. */
const faltantesDeVarios = ids => repo.faltantesDeVarios(ids);

/** Lo que caduca pronto, de personas y de coches, para el panel de avisos. */
const porVencer = opciones => repo.porVencer(opciones || {});

/** Los bytes, para servirlos. La base dice dónde están; el almacén los da. */
const descargar = id => repo.descargar(Number(id));

// ── Escritura ──────────────────────────────────────────────────────────────

/**
 * Guarda un documento de alguien. Los bytes van al almacén y el índice a la
 * base, en ese orden: si el almacén falla no queda una fila apuntando a nada.
 */
const subir = (ambito, id, datos, quien) =>
  repo.subir({ ...de(ambito, id), ...(datos || {}) }, quien || {});

/** Corrige fechas o notas sin volver a subir el archivo. */
const actualizar = (id, campos, quien) => repo.actualizar(Number(id), campos || {}, quien || {});

/** Retira un documento del índice. Con `borrarArchivo`, también de Drive. */
const retirar = (id, opciones, quien) =>
  repo.retirar(Number(id), { ...(opciones || {}), ...(quien || {}) });

// ── El almacén ─────────────────────────────────────────────────────────────
// El estado de la conexión con Drive. Lo pregunta la pantalla de ajustes para
// saber si puede ofrecer el botón de subir o hay que conectar la cuenta antes.
const estadoAlmacen = () => ({
  configurado: drive.configurado(),
  puedeConectar: drive.puedeConectar(),
  almacenes: Object.keys(repo.ALMACEN),
});

module.exports = {
  AMBITOS,
  tipos, listar, faltantes, faltantesDeVarios, porVencer, descargar,
  subir, actualizar, retirar,
  estadoAlmacen,
};
