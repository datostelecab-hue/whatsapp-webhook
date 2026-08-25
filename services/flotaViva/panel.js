// ============================================================
// FLOTA VIVA — las tres listas de la pantalla
// ============================================================
// Todo sale de `fv_ahora`, que es una fila por coche con su tramo abierto. No se
// recorre historial: la pregunta "cuánto lleva así" ya viene contestada.
//
// Las tres listas son la misma consulta partida por dónde está cada coche:
//
//   CONECTADOS      en viaje, en espera o en descanso. De los que descansan
//                   interesa cuánto llevan y CUÁNTOS KM — un coche que descansa
//                   rodando es el motivo por el que existe este panel.
//   RECIÉN CAÍDOS   se han desconectado hace poco. Van aparte porque es lo que
//                   hay que mirar ahora, no dentro de dos horas.
//   PARADOS         llevan mucho sin usarse. Aquí lo que importa es quién fue el
//                   último y cuánto hace de eso.

const db = require('./db');

// A partir de aquí, una desconexión deja de ser noticia y pasa a ser un coche
// aparcado. Ajustable: en una flota de noche puede no encajar.
const RECIEN_MIN = Number(process.env.FLOTA_VIVA_RECIEN_MIN) || 120;

const duracion = seg => {
  if (seg == null) return '';
  const s = Math.max(0, Math.floor(seg));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
};

const fila = r => ({
  matricula: r.matricula || '(sin matrícula)',
  situacion: r.situacion,
  etiqueta: r.situacion_etiqueta,
  color: r.color,
  estadoBolt: r.estado_bolt,
  conductor: r.conductor || '',
  telefono: r.telefono || '',
  desde: r.desde,
  segundos: Number(r.segundos) || 0,
  desdeHace: duracion(r.segundos),
  km: r.km == null ? null : Number(r.km),
  vueltas: r.vueltas,
  ultimoConductor: r.ultimo_conductor || '',
  ultimoTelefono: r.ultimo_telefono || '',
  ultimoUso: r.ultimo_uso_at,
});

/**
 * El panel entero, en una sola consulta.
 *
 * Se trae todo y se reparte aquí en vez de lanzar tres consultas: son ochenta
 * filas, y partirlo en tres viajes solo añade la posibilidad de que las tres
 * lleguen de momentos distintos y el total no cuadre con las partes.
 */
async function estado() {
  const r = await db.consulta(
    `SELECT * FROM fv_ahora
      ORDER BY conectado DESC NULLS LAST, situacion_orden, segundos DESC, matricula`);
  const todas = r.rows.map(fila);

  const conectados = todas.filter(x => x.situacion && x.situacion !== 'desconectado');
  const caidos = todas.filter(x => x.situacion === 'desconectado');

  // El corte entre "acaba de caerse" y "lleva parado" es el tiempo, no un estado
  // distinto: el mismo coche pasa de una lista a la otra sin que cambie nada.
  const recienCaidos = caidos.filter(x => x.segundos < RECIEN_MIN * 60);
  const parados = caidos.filter(x => x.segundos >= RECIEN_MIN * 60);

  const cuantos = s => conectados.filter(x => x.situacion === s).length;
  const ultima = (await db.consulta(
    `SELECT arrancada_at, terminada_at, vehiculos, conectados, cambios, ms, error
       FROM fv_vuelta ORDER BY id DESC LIMIT 1`)).rows[0] || null;

  return {
    conectados,
    recienCaidos,
    parados,
    resumen: {
      total: todas.length,
      conectados: conectados.length,
      viaje: cuantos('viaje'),
      espera: cuantos('espera'),
      descanso: cuantos('descanso'),
      sinClasificar: cuantos('otro'),
      recienCaidos: recienCaidos.length,
      parados: parados.length,
      // Km hechos en descanso ahora mismo. Es el número que justifica el módulo.
      kmEnDescanso: Math.round(conectados
        .filter(x => x.situacion === 'descanso' && x.km)
        .reduce((s, x) => s + x.km, 0) * 10) / 10,
    },
    ultimaVuelta: ultima,
    recienMin: RECIEN_MIN,
  };
}

/** El historial de un coche: en qué ha estado y cuánto ha rodado en cada cosa. */
async function historial(matricula, dias = 2) {
  const r = await db.consulta(
    `SELECT t.situacion, s.etiqueta, t.estado_bolt, t.desde, t.hasta,
            c.nombre AS conductor, c.telefono,
            EXTRACT(EPOCH FROM (COALESCE(t.hasta, now()) - t.desde))::bigint AS segundos,
            CASE WHEN t.odometro_fin_m IS NULL OR t.odometro_ini_m IS NULL THEN NULL
                 ELSE round((t.odometro_fin_m - t.odometro_ini_m) / 1000.0, 1) END AS km
       FROM fv_tramo t
       JOIN fv_vehiculo v      ON v.uuid = t.vehiculo_uuid
       JOIN fv_cat_situacion s ON s.codigo = t.situacion
       LEFT JOIN fv_conductor c ON c.uuid = t.conductor_uuid
      WHERE v.matricula = $1 AND t.desde >= now() - ($2 || ' days')::interval
      ORDER BY t.desde DESC`, [String(matricula || '').toUpperCase(), String(dias)]);

  return r.rows.map(x => ({
    situacion: x.situacion, etiqueta: x.etiqueta, estadoBolt: x.estado_bolt,
    desde: x.desde, hasta: x.hasta, conductor: x.conductor || '', telefono: x.telefono || '',
    duracion: duracion(x.segundos), km: x.km == null ? null : Number(x.km),
  }));
}

module.exports = { estado, historial, duracion };
