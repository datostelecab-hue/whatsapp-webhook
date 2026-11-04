// ============================================================
// TALLER — servicio
// ============================================================
// La puerta de la parte de TALLER del módulo Vehículos: el estado de
// mantenimiento de la flota, los apuntes y los informes.
//
// Va aparte de `vehiculos.service` a propósito. Comparten módulo porque hablan
// del mismo objeto —el coche— pero no de lo mismo: uno lleva el maestro (alta,
// ficha, zona, plazas) y otro cuándo le toca revisión. Juntarlos daría un
// fichero que nadie abre entero.

const repo = require('./taller.repo');

// ── LOS INFORMES ───────────────────────────────────────────────────────────
// Los dos formatos, DECLARADOS. Antes el controlador hacía esto:
//
//     require(`../services/taller${formato}`)
//
// con `formato` siendo 'Excel' o 'Pdf'. Funcionaba, pero esa dependencia no la
// ve NADIE: ni un grep, ni `comprobar-modulos.js`, ni quien lea el fichero. Al
// mover estos dos ficheros de carpeta, un require así se rompe en silencio y no
// da la cara hasta que alguien pulsa "descargar informe" — que además es de las
// cosas que se usan una vez por semana.
//
// Escritos a mano, el grafo de dependencias vuelve a ser verdad.
const FORMATOS = {
  xlsx: {
    generador: () => require('./taller.excel'),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pdf: {
    generador: () => require('./taller.pdf'),
    mime: 'application/pdf',
  },
};

/**
 * El informe de la flota entera en el formato pedido.
 *
 * SIEMPRE la flota entera, nunca lo filtrado en pantalla: el fichero acaba en
 * un correo, y allí nadie sabe qué filtro estaba puesto al descargarlo.
 *
 * Devuelve el fichero y cómo hay que servirlo, para que el controlador solo
 * tenga que poner cabeceras.
 */
//
// `sedes` son las de la pantalla que lo pide (04/11/2026): el de Madrid lleva
// Madrid y el de Barcelona, Barcelona. `sedeNombre` va en el título y en el
// nombre del fichero; Madrid no lo pone, que su informe se ha llamado siempre igual.
async function informe(formato, { sedes, sedeNombre } = {}) {
  const f = FORMATOS[formato];
  if (!f) throw new Error(`Formato de informe desconocido: ${formato}`);
  const datos = { ...(await repo.todo({ sedes })), sedeNombre: sedeNombre || '' };
  const fichero = await f.generador().generar(datos);
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const sufijo = sedeNombre ? '-' + String(sedeNombre).toLowerCase() : '';
  return {
    fichero,
    mime: f.mime,
    nombre: `taller${sufijo}-${hoy}.${formato}`,
    // Para el registro: cuántos coches y cuántos tocan revisión.
    resumen: datos.resumen,
    apuntes: datos.historial.length,
  };
}

const FORMATOS_INFORME = Object.keys(FORMATOS);

// ── LAS CITAS DEL TALLER, EN EL ESTADO DE CADA COCHE (08/10/2026) ──────────
// Camilo: en el estado de la flota tiene que verse la cita puesta para cada
// coche, con quien debe llevarlo, el día y la hora: «Cita puesta para
// revisión». Salen de `citas.service` (db/187), con el responsable que dice el
// planificador. Si las citas fallan, el estado sale igual, sin ellas: un
// añadido no puede tumbar la pantalla del taller.
const citas = require('./citas.service');

async function sinTumbar(fn, que) {
  try { return await fn(); }
  catch (e) { console.error(`⚠️  [Taller] ${que}: ${e.message}`); return null; }
}

/**
 * EL ESTADO DE LA FLOTA: las filas (con el filtro de la pantalla), cada una con
 * su próxima cita, y las cifras de la cabecera. Las citas se buscan una vez.
 *
 * `conCitas: false` las deja fuera (Barcelona, 04/11/2026): quién lleva el
 * coche lo dice el planificador de Madrid, y el aviso por WhatsApp es suyo.
 */
async function estadoDeLaFlota(filtros) {
  const conCitas = !(filtros && filtros.conCitas === false);
  const porCoche = conCitas ? await sinTumbar(() => citas.proximaPorCoche(), 'citas del estado de la flota') : null;
  const [filas, resumen] = await Promise.all([
    repo.cuadro(filtros),
    // Las cifras, sobre los mismos coches que la tabla (sus sedes) pero sin la
    // búsqueda ni el estado elegidos.
    repo.resumen({ conCita: porCoche ? new Set(porCoche.keys()) : null, sedes: (filtros || {}).sedes }),
  ]);
  return { filas: filas.map(f => ({ ...f, cita: (porCoche && porCoche.get(String(f.id))) || null })), resumen };
}

/** La ficha de un coche con sus citas pendientes del taller (sin ellas, con `conCitas: false`). */
async function ficha(id, { sedes, conCitas = true } = {}) {
  const f = await repo.ficha(id, { sedes });
  if (!conCitas) return { ...f, citas: [] };
  return { ...f, citas: (await sinTumbar(() => citas.deCoche(f.id), 'citas de la ficha')) || [] };
}

// ── CADA PANTALLA ESCRIBE EN LOS COCHES DE SU SEDE (04/11/2026) ────────────
// Barcelona tiene su Mantenimientos y Madrid el suyo, con las mismas tablas.
// Que la lista de una sede no enseñe los coches de la otra no basta: el id va
// en el cuerpo de la petición, y por la API se podría apuntar en cualquiera.
// Sin `sedes` (un proceso, un script) no se mira: es la flota entera.
async function exigeSede(que, sedes) {
  if (!Array.isArray(sedes) || !sedes.length) return;
  const sede = await repo.sedeDe(que);
  // Si no existe, lo dice el repositorio con su mensaje de siempre.
  if (sede != null && !sedes.includes(sede)) {
    throw new Error('Ese coche es de otra sede: se apunta desde Mantenimientos de su sede');
  }
}

// `quien` lleva quién firma ({ usuarioId }) y, desde una pantalla, sus `sedes`.
async function registrar(datos, { usuarioId, sedes } = {}) {
  await exigeSede({ vehiculoId: (datos || {}).vehiculoId }, sedes);
  return repo.registrar(datos, { usuarioId });
}
async function anular(id, motivo, { usuarioId, sedes } = {}) {
  await exigeSede({ mantenimientoId: id }, sedes);
  return repo.anular(id, motivo, { usuarioId });
}
async function anclar(datos, { usuarioId, sedes } = {}) {
  await exigeSede({ vehiculoId: (datos || {}).vehiculoId }, sedes);
  return repo.anclar(datos, { usuarioId });
}
async function intervalo(datos, { sedes } = {}) {
  await exigeSede({ vehiculoId: (datos || {}).vehiculoId }, sedes);
  return repo.intervalo(datos);
}

// ── QUIÉN PUEDE APUNTAR ────────────────────────────────────────────────────
// La misma llave en las dos sedes: '/taller/apuntar' (o el rol que lo puede
// todo). Vive aquí y no en un controlador para que Madrid y Barcelona no tengan
// cada uno su copia del candado. Ante cualquier fallo, sin apuntar.
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];
const LLAVE_APUNTAR = '/taller/apuntar';

async function puedeApuntar({ rol, usuarioId } = {}) {
  if (ADMIN_TOTAL.includes(rol)) return true;
  if (!usuarioId) return false;
  try {
    // Aquí dentro: `permisos` carga el catálogo y no hace falta para leer.
    return (await require('../../services/permisos').clavesDe(usuarioId)).has(LLAVE_APUNTAR);
  } catch (_) { return false; }
}

// ── LO QUE EL MÓDULO OFRECE ────────────────────────────────────────────────
const cuadro = filtros => repo.cuadro(filtros);
const resumen = () => repo.resumen();

module.exports = {
  // Los catálogos que la pantalla necesita para pintarse.
  INTERVALO: repo.INTERVALO, TIPOS: repo.TIPOS, ESTADOS: repo.ESTADOS,
  cuadro, resumen, estadoDeLaFlota, ficha, registrar, anular, anclar, intervalo,
  puedeApuntar, informe, FORMATOS_INFORME,
};
