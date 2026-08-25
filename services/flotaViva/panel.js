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

// El enlace con el Call Center se puede apagar.
//
// Existe para poder probar el flujo entero en produccion —que es donde vive el
// modulo— sin meter una llamada de mentira en su libro y ensuciarles los KPIs y
// la reincidencia. Con `off`, la incidencia se justifica igual y se devuelve la
// llamada que SE HABRIA creado, para poder verla sin escribirla.
//
// Por defecto ENCENDIDO: apagarlo es la excepcion, y un enlace que hay que
// acordarse de encender es un enlace que un dia no esta.
const CC_ACTIVO = String(process.env.FLOTA_VIVA_CC || '').toLowerCase() !== 'off';

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
  kmDudoso: !!r.km_dudoso,
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
            round(t.km_m / 1000.0, 1) AS km, t.km_dudoso
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
    kmDudoso: !!x.km_dudoso,
  }));
}

/**
 * Lo que hay que llamar AHORA.
 *
 * Solo lo que sigue pasando y nadie ha justificado todavia. En cuanto alguien
 * llama y anota el motivo, desaparece de aqui — y sigue estando en el parte del
 * cierre, que es donde tiene que constar.
 */
async function incidencias({ dia, franja, incluirJustificadas = false } = {}) {
  const donde = ['1 = 1'], params = [];
  if (dia)    { params.push(dia);    donde.push(`i.dia_operativo = $${params.length}`); }
  if (franja) { params.push(franja); donde.push(`i.franja = $${params.length}`); }
  if (!incluirJustificadas) donde.push('i.justificada_at IS NULL');

  const r = await db.consulta(
    `SELECT i.id, i.tipo, c.etiqueta AS tipo_etiqueta, c.gravedad,
            i.franja, f.etiqueta AS franja_etiqueta, i.dia_operativo,
            v.matricula, i.detalle, i.veces,
            i.abierta_at, i.resuelta_at,
            i.justificada_at, i.justificada_por, i.motivo,
            EXTRACT(EPOCH FROM (COALESCE(i.resuelta_at, now()) - i.abierta_at))::bigint AS segundos,
            co.nombre AS conductor, co.telefono
       FROM fv_incidencia i
       JOIN fv_cat_incidencia c ON c.codigo = i.tipo
       JOIN fv_franja f         ON f.codigo = i.franja
       JOIN fv_vehiculo v       ON v.uuid = i.vehiculo_uuid
       LEFT JOIN fv_conductor co ON co.uuid = i.conductor_uuid
      WHERE ${donde.join(' AND ')}
      ORDER BY i.resuelta_at NULLS FIRST, c.gravedad DESC, i.abierta_at`, params);

  return r.rows.map(x => ({
    id: Number(x.id), tipo: x.tipo, etiqueta: x.tipo_etiqueta, gravedad: x.gravedad,
    franja: x.franja, franjaEtiqueta: x.franja_etiqueta, dia: x.dia_operativo,
    matricula: x.matricula, detalle: x.detalle || '', veces: x.veces,
    abierta: x.abierta_at, resuelta: x.resuelta_at, sigue: !x.resuelta_at,
    duracion: duracion(x.segundos),
    conductor: x.conductor || '', telefono: x.telefono || '',
    justificada: !!x.justificada_at, justificadaPor: x.justificada_por || '',
    motivo: x.motivo || '',
  }));
}

/**
 * Alguien ha llamado y cuenta que paso.
 *
 * El motivo es obligatorio: una incidencia cerrada sin explicacion no es una
 * incidencia resuelta, es una incidencia escondida.
 */
async function justificar(id, { motivo, resultado, accion, quien } = {}) {
  const texto = String(motivo || '').trim();
  if (!texto) throw new Error('Hace falta decir qué pasó: sin motivo no se cierra');

  const inc = (await db.consulta(
    `SELECT i.id, i.tipo, i.franja, v.matricula, c.nombre AS conductor, c.telefono,
            k.cc_cluster, k.cc_subcluster, k.cc_motivo
       FROM fv_incidencia i
       JOIN fv_vehiculo v        ON v.uuid = i.vehiculo_uuid
       JOIN fv_cat_incidencia k  ON k.codigo = i.tipo
       LEFT JOIN fv_conductor c  ON c.uuid = i.conductor_uuid
      WHERE i.id = $1`, [Number(id)])).rows[0];
  if (!inc) throw new Error('No existe esa incidencia');

  // PRIMERO se guarda aquí. La justificación es lo que necesita el parte del
  // cierre, y no puede perderse porque el Call Center —que escribe en una hoja—
  // falle o esté sin cuota.
  await db.consulta(
    `UPDATE fv_incidencia
        SET justificada_at = now(), justificada_por = $2, motivo = $3
      WHERE id = $1`,
    [Number(id), String(quien || '').slice(0, 120) || null, texto]);

  // Y DESPUÉS se crea la llamada, si ese tipo tiene clasificación. Justificar
  // una incidencia ES una llamada: tiene que contar en sus KPIs y en su
  // reincidencia, no quedarse en un libro aparte.
  let llamada = null, errorLlamada = '', ensayo = null;
  if (inc.cc_motivo && inc.conductor) {
    const datos = {
      direccion: 'saliente',
      conductor: inc.conductor, telefono: inc.telefono || '',
      matricula: inc.matricula || '',
      turno: inc.franja === 'noche' ? 'Noche' : 'Día',
      cluster: inc.cc_cluster, subcluster: inc.cc_subcluster, motivo: inc.cc_motivo,
      resultado: String(resultado || '').trim(),
      accion: String(accion || '').trim(),
      notas: texto,
      estado: 'resuelta',
    };

    // Apagado: se comprueba que la clasificacion es valida —que es la mitad de
    // lo que se quiere probar— pero NO se escribe en su hoja.
    if (!CC_ACTIVO) {
      try {
        require('../callCenter').validarClasificacion(datos);
        ensayo = datos;
      } catch (e) { errorLlamada = e.message; }
      return {
        id: Number(id), justificada: true, llamada: null, ensayo,
        sinLlamada: errorLlamada || 'FLOTA_VIVA_CC=off: no se ha escrito en el Call Center (prueba)',
      };
    }

    try {
      const cc = require('../callCenter');
      llamada = await cc.registrar(datos, quien || '');
      await db.consulta('UPDATE fv_incidencia SET llamada_clave = $2 WHERE id = $1',
        [Number(id), llamada.clave]);
    } catch (e) {
      // La justificación NO se deshace: quedó guardada arriba. Solo se dice que
      // la llamada no llegó al Call Center, para poder repetirla a mano.
      errorLlamada = e.message;
      console.error('⚠️  [FLOTA VIVA] No se pudo registrar la llamada:', e.message);
    }
  }

  return {
    id: Number(id), justificada: true,
    llamada: llamada ? llamada.clave : null,
    sinLlamada: !inc.cc_motivo ? 'ese tipo no tiene clasificación de Call Center'
      : !inc.conductor ? 'no consta el conductor'
        : errorLlamada || '',
  };
}

/** La clasificación y los resultados válidos de una incidencia, para el diálogo. */
async function clasificacionDe(id) {
  const r = (await db.consulta(
    `SELECT k.cc_cluster, k.cc_subcluster, k.cc_motivo
       FROM fv_incidencia i JOIN fv_cat_incidencia k ON k.codigo = i.tipo
      WHERE i.id = $1`, [Number(id)])).rows[0];
  if (!r || !r.cc_motivo) return null;

  const cc = require('../callCenter');
  const m = cc.CATALOGO
    .filter(c => c.cluster === r.cc_cluster)
    .flatMap(c => c.subclusters.filter(s => s.nombre === r.cc_subcluster))
    .flatMap(s => s.motivos.filter(x => x.motivo === r.cc_motivo))[0];
  if (!m) return null;

  return {
    cluster: r.cc_cluster, subcluster: r.cc_subcluster, motivo: r.cc_motivo,
    resultados: [...m.resultados, ...cc.RESULTADOS_UNIVERSALES],
    acciones: m.acciones || [],
  };
}

/**
 * El parte de una franja: que paso y que quedo sin explicar.
 *
 * Es lo que se mira al cierre. Lo que aparece aqui sin justificar es lo que
 * sube, asi que va primero.
 */
async function cierre({ dia, franja } = {}) {
  const lista = await incidencias({ dia, franja, incluirJustificadas: true });
  const sinJustificar = lista.filter(x => !x.justificada);
  const porTipo = {};
  lista.forEach(x => { porTipo[x.etiqueta] = (porTipo[x.etiqueta] || 0) + 1; });

  return {
    dia, franja,
    incidencias: lista,
    resumen: {
      total: lista.length,
      sinJustificar: sinJustificar.length,
      justificadas: lista.length - sinJustificar.length,
      coches: new Set(lista.map(x => x.matricula)).size,
      porTipo,
    },
  };
}

module.exports = { estado, historial, incidencias, justificar, clasificacionDe, cierre, duracion };
