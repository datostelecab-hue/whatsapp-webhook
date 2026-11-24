// ============================================================
// LAS FOTOS DEL PORTAL: 20 DÍAS Y FUERA (24/11/2026)
// ============================================================
// Camilo: «las fotos tomadas por los conductores los últimos 20 días, después
// del día 20, el lote de 10 fotos de hace 21 días se borra definitivamente de
// R2 para que no se vaya haciendo tan grande». Y: «que en el ERP, al entrar a
// la ficha del vehículo, se puedan ver las fotos por fecha, con límite de 20
// días hacia atrás».
//
//   · SE GUARDAN 20 DÍAS: hoy y los 20 de antes. Cada mañana (04:20) la tarea
//     `portal.fotos_caducadas` borra del almacén (R2) las de antes, y su fila
//     de `adjunto`. Del todo: no se anulan, se borran. El libro de auditoría
//     guarda que se borraron (la fila de antes, con su ruta y su tamaño), pero
//     la foto ya no existe en ningún sitio.
//   · Primero el fichero y luego la fila: si R2 falla con uno, su fila se queda
//     y se intenta otra vez al día siguiente (borrar en R2 lo que ya no está no
//     da error).
//   · LA FICHA DEL VEHÍCULO en el ERP enseña las que quedan, por día: cada vez
//     que alguien lo desvinculó, quién, de qué hora a qué hora, y sus cinco
//     fotos con su nombre (GET /vehiculos/api/ficha/:id/fotos).
'use strict';

const calendario = require('../../services/calendario');
const almacen = require('../../services/almacen');
const libro = require('../../services/libro');
const tareasProgramadas = require('../../services/tareasProgramadas');
const repoAdjuntos = require('../../services/repo/adjuntos');
const repo = require('./portal.repo');

const DIAS = 20;
const TIPO = 'turno_fotos';
const CLAVE = 'portal.fotos_caducadas';

/** El primer día que se guarda: hoy menos 20. Lo de antes, fuera. */
const primerDia = (hoy = calendario.hoy()) => calendario.sumarDias(hoy, -DIAS);

/**
 * BORRA LAS CADUCADAS: del almacén y de la base, dentro de la transacción de la
 * tarea (`cli`). Devuelve recuentos.
 */
async function purgar(cli, { hoy = calendario.hoy(), limite = 2000 } = {}) {
  const antesDe = primerDia(hoy);
  const filas = await repoAdjuntos.anterioresA(cli, TIPO, antesDe, limite);
  if (!filas.length) return { borradas: 0, fallos: 0, antesDe };
  await libro.firmar(cli, { origen: `tarea · ${CLAVE}`, motivo: `Fotos del portal de más de ${DIAS} días: borradas del almacén` });
  const hechas = [];
  let fallos = 0, bytes = 0;
  for (const a of filas) {
    try {
      await almacen.de(a.almacen).borrar(a.ruta);
      hechas.push(a.id);
      bytes += Number(a.bytes) || 0;
    } catch (e) {
      fallos++;
      console.error(`❌ [Portal] no se pudo borrar la foto ${a.id} del almacén:`, e.message);
    }
  }
  const borradas = await repoAdjuntos.borrar(cli, hechas);
  console.log(`🗑️ [Portal] fotos de antes del ${antesDe}: ${borradas} borradas (${Math.round(bytes / 1e5) / 10} MB)` +
    (fallos ? `, ${fallos} no se pudieron` : ''));
  return { borradas, fallos, megas: Math.round(bytes / 1e5) / 10, antesDe };
}

tareasProgramadas.registrar({
  clave: CLAVE,
  descripcion: `Borra del almacén las fotos del portal de más de ${DIAS} días`,
  desde: '2026-11-25',
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '04:20' }),
  hacer: ({ cli }) => purgar(cli),
});

/**
 * LAS FOTOS DE UN COCHE, POR DÍA (las de los últimos 20 días): [{ dia, veces:
 * [{ turno, quien, oficina, desde, hasta, fotos: [{ id, etiqueta, url }] }] }],
 * del día más nuevo al más viejo.
 */
async function deVehiculo(vehiculoId, { hoy = calendario.hoy() } = {}) {
  const { FOTOS } = require('./portal.coche');
  const filas = await repo.fotosDeVehiculo(vehiculoId, primerDia(hoy));
  const dias = new Map();
  for (const f of filas) {
    if (!dias.has(f.dia)) dias.set(f.dia, new Map());
    const veces = dias.get(f.dia);
    if (!veces.has(f.turno)) {
      veces.set(f.turno, { turno: f.turno, quien: f.quien, oficina: f.tipo === 'viaje', desde: f.desde, hasta: f.hasta, fotos: [] });
    }
    // El nombre del fichero empieza por su número («1-conductor.jpg»): de ahí su nombre.
    const n = Number(String(f.fichero).split('-')[0]);
    veces.get(f.turno).fotos.push({
      id: f.adjunto, n, etiqueta: (FOTOS[n - 1] || {}).etiqueta || 'Foto', url: `/adjuntos/${f.adjunto}/fichero`,
    });
  }
  return {
    desde: primerDia(hoy), dias: DIAS,
    porDia: [...dias.entries()].map(([dia, veces]) => ({
      dia, veces: [...veces.values()].map(v => ({ ...v, fotos: v.fotos.sort((a, b) => a.n - b.n) })),
    })),
  };
}

module.exports = { purgar, deVehiculo, primerDia, DIAS, CLAVE };
