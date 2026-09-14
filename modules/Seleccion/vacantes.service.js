// ============================================================
// VACANTES · SERVICIO — qué hay que reclutar, y en qué estado está
// ============================================================
// Una vacante es un hueco en el cuadrante que Selección tiene que llenar. La
// abre el generador cuando Tráfico decide que falta gente, y muere de una de
// dos formas: CUBIERTA (entró alguien) o ANULADA (ya no hace falta).
//
// Este fichero existe porque el controlador tenía dentro las dos decisiones que
// de verdad son de negocio, y desde `modules/` eso ya no vale:
//
//   · QUÉ ES UNA VACANTE VIVA. Abierta o en proceso. No es lo mismo que "no
//     cerrada": una anulada tampoco está cerrada y no hay que reclutar para
//     ella.
//   · CUÁNTO CUESTA. El número que importa no es cuántas vacantes hay abiertas
//     sino cuántas PLAZAS suman, que es el coche que está parado esperando
//     gente. Una vacante de correturnos puede valer por seis.

const repo = require('./vacantes.repo');

// Los dos estados que todavía piden trabajo a Selección. Lo demás ya está
// resuelto, para bien o para mal.
const VIVAS = new Set(['abierta', 'proceso']);

/**
 * El tablero de vacantes: las que siguen vivas, las que ya se resolvieron y las
 * cifras de cabecera.
 */
async function tablero() {
  const todas = await repo.listar({ incluirCerradas: true });
  const vacantes = todas.filter(v => VIVAS.has(v.estado));
  const resueltas = todas.filter(v => !VIVAS.has(v.estado));

  return {
    vacantes,
    resueltas,
    contadores: {
      abiertas: vacantes.filter(v => v.estado === 'abierta').length,
      proceso: vacantes.filter(v => v.estado === 'proceso').length,
      resueltas: resueltas.length,
      dia: vacantes.filter(v => v.turno === 'Día').length,
      noche: vacantes.filter(v => v.turno === 'Noche').length,
      recambios: vacantes.filter(v => v.motivo === 'recambio').length,
      // Cuántas plazas hay prometidas: es el número que dice de verdad cuánto
      // coche está esperando gente.
      plazas: vacantes.reduce((a, v) => a + v.nPlazas, 0),
    },
  };
}

/** La ficha de una vacante. Revienta si no existe, en vez de devolver nada. */
async function ficha(id) {
  const v = await repo.ficha(id);
  if (!v) throw new Error('No existe esa vacante');
  return v;
}

/**
 * Anular una vacante que ya no hace falta: el coche se fue al taller, el que se
 * iba se queda. NO se borra — anular deja rastro de que existió y de por qué
 * murió, y esa es media historia de por qué la plantilla es la que es.
 */
async function anular(id, motivo, usuarioId) {
  const r = await repo.cambiarEstado(id, 'anulada', { motivo, usuarioId });
  if (!r.ok) throw new Error('No existe esa vacante');
  console.log(`🗂️  [Vacantes] ${r.codigo} anulada`);
  return r;
}

/** Reabrirla: el candidato se cayó y a esa vacante nunca llegó a entrar nadie. */
async function reabrir(id, usuarioId) {
  const r = await repo.cambiarEstado(id, 'abierta', { usuarioId });
  if (!r.ok) throw new Error('No existe esa vacante');
  return r;
}

// Las que el resto del sistema pregunta. Van por aquí y no por el repositorio
// para que desde fuera del módulo solo haya UNA puerta.
const disponibles = (...a) => repo.disponibles(...a);
const listar = (...a) => repo.listar(...a);
const eliminar = (...a) => repo.eliminar(...a);

module.exports = { tablero, ficha, anular, reabrir, disponibles, listar, eliminar, VIVAS };
