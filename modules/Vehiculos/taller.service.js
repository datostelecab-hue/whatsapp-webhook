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
async function informe(formato) {
  const f = FORMATOS[formato];
  if (!f) throw new Error(`Formato de informe desconocido: ${formato}`);
  const datos = await repo.todo();
  const fichero = await f.generador().generar(datos);
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  return {
    fichero,
    mime: f.mime,
    nombre: `taller-${hoy}.${formato}`,
    // Para el registro: cuántos coches y cuántos tocan revisión.
    resumen: datos.resumen,
    apuntes: datos.historial.length,
  };
}

const FORMATOS_INFORME = Object.keys(FORMATOS);

// ── LO QUE EL MÓDULO OFRECE ────────────────────────────────────────────────
const cuadro = filtros => repo.cuadro(filtros);
const resumen = () => repo.resumen();
const ficha = id => repo.ficha(id);
const registrar = (datos, quien) => repo.registrar(datos, quien);
const anular = (id, motivo, quien) => repo.anular(id, motivo, quien);
const anclar = (datos, quien) => repo.anclar(datos, quien);
const intervalo = datos => repo.intervalo(datos);

module.exports = {
  // Los catálogos que la pantalla necesita para pintarse.
  INTERVALO: repo.INTERVALO, TIPOS: repo.TIPOS, ESTADOS: repo.ESTADOS,
  cuadro, resumen, ficha, registrar, anular, anclar, intervalo,
  informe, FORMATOS_INFORME,
};
