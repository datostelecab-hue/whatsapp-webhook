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

const { duracion } = require('./formato');

const fila = r => ({
  matricula: r.matricula || '(sin matrícula)',
  situacion: r.situacion,
  // Conectado = está en algo (viaje/espera/descanso), no caído. Se deriva igual
  // que en `estado()` para que cuadre con sus listas; el cockpit lo usa para el
  // chip y para contar. Sin esto salía todo como "desconectado".
  conectado: !!(r.situacion && r.situacion !== 'desconectado'),
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
  // Para que el panel pueda decir "0 km" cuando es 0 y "sin GPS" cuando no se
  // sabe, en vez de pintar la misma raya para las dos cosas.
  sinGps: !!r.sin_gps,
  gpsAt: r.gps_at || null,
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
 * Como historial, pero POR CONDUCTOR: sus trazos de hoy en CUALQUIER coche (no solo
 * el que tenía planificado). El enlace conductor→BOLT (conductor_externo) da el/los
 * uuid con los que rodó; de ahí sus tramos. Cada trazo lleva su matrícula, porque el
 * conductor puede cambiar de coche a lo largo del día.
 */
async function historialConductor(conductorId, dias = 1) {
  const r = await db.consulta(
    `SELECT v.matricula, t.situacion, s.etiqueta, t.desde, t.hasta,
            EXTRACT(EPOCH FROM (COALESCE(t.hasta, now()) - t.desde))::bigint AS segundos
       FROM fv_tramo t
       JOIN fv_vehiculo v      ON v.uuid = t.vehiculo_uuid
       JOIN fv_cat_situacion s ON s.codigo = t.situacion
      WHERE t.conductor_uuid IN (
              SELECT externo_id FROM conductor_externo
               WHERE sistema = 'bolt' AND conductor_id = $1 AND externo_id IS NOT NULL)
        AND t.desde >= now() - ($2 || ' days')::interval
      ORDER BY t.desde DESC`, [Number(conductorId), String(dias)]);
  return r.rows.map(x => ({
    matricula: x.matricula || '(sin matrícula)',
    situacion: x.situacion, etiqueta: x.etiqueta,
    desde: x.desde, hasta: x.hasta, duracion: duracion(x.segundos),
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
  // ::date explicito. Si llega '2026-08-25T00:00:00.000Z' —que es lo que da un
  // Date al pasar por JSON— sin el cast la comparacion depende de la zona del
  // servidor y puede caer en el dia anterior.
  if (dia)    { params.push(String(dia).slice(0, 10)); donde.push(`i.dia_operativo = $${params.length}::date`); }
  if (franja) { params.push(franja); donde.push(`i.franja = $${params.length}`); }
  if (!incluirJustificadas) donde.push('i.justificada_at IS NULL');

  const r = await db.consulta(
    `SELECT i.id, i.tipo, c.etiqueta AS tipo_etiqueta, c.gravedad,
            c.cc_cluster, c.cc_subcluster, c.cc_motivo,
            i.franja, f.etiqueta AS franja_etiqueta,
            to_char(i.dia_operativo, 'YYYY-MM-DD') AS dia,
            v.matricula, i.detalle, i.veces,
            i.abierta_at, i.resuelta_at,
            i.justificada_at, i.justificada_por, i.motivo, i.llamada_clave,
            i.gestion, g.etiqueta AS gestion_etiqueta, g.color AS gestion_color,
            EXTRACT(EPOCH FROM (COALESCE(i.resuelta_at, now()) - i.abierta_at))::bigint AS segundos,
            i.conductor_uuid, co.nombre AS conductor, co.telefono,
            sg.n AS seg_n, sg.ult_quien AS seg_quien, sg.ult_at AS seg_at
       FROM fv_incidencia i
       JOIN fv_cat_incidencia c ON c.codigo = i.tipo
       JOIN fv_franja f         ON f.codigo = i.franja
       JOIN fv_vehiculo v       ON v.uuid = i.vehiculo_uuid
       LEFT JOIN fv_cat_gestion g ON g.codigo = i.gestion
       LEFT JOIN fv_conductor co ON co.uuid = i.conductor_uuid
       -- Cuántas veces se ha llamado ya (el "He llamado" de En directo) y el
       -- último intento. Es un rastro aparte: no cierra la incidencia.
       LEFT JOIN LATERAL (
         SELECT s.quien AS ult_quien, s.creada_at AS ult_at,
                (SELECT count(*)::int FROM fv_seguimiento s2 WHERE s2.incidencia_id = i.id) AS n
           FROM fv_seguimiento s WHERE s.incidencia_id = i.id
          ORDER BY s.creada_at DESC LIMIT 1
       ) sg ON true
      WHERE ${donde.join(' AND ')}
      ORDER BY i.resuelta_at NULLS FIRST, c.gravedad DESC, i.abierta_at`, params);

  return r.rows.map(x => ({
    id: Number(x.id), tipo: x.tipo, etiqueta: x.tipo_etiqueta, gravedad: x.gravedad,
    franja: x.franja, franjaEtiqueta: x.franja_etiqueta, dia: x.dia,
    matricula: x.matricula, detalle: x.detalle || '', veces: x.veces,
    abierta: x.abierta_at, resuelta: x.resuelta_at, sigue: !x.resuelta_at,
    duracion: duracion(x.segundos),
    conductor: x.conductor || '', telefono: x.telefono || '',
    // QUIÉN la provocó, por identificador. Sin esto el aviso solo se puede colgar
    // de la matrícula, y los dos compañeros del coche veían los mismos avisos.
    conductorUuid: x.conductor_uuid || '',
    justificada: !!x.justificada_at, justificadaPor: x.justificada_por || '',
    justificadaAt: x.justificada_at,
    motivo: x.motivo || '',
    // Como se cerro: llamando o ignorandola. Las dos cuentan como revisada; el
    // parte las separa porque no significan lo mismo.
    gestion: x.gestion || '', gestionEtiqueta: x.gestion_etiqueta || '',
    gestionColor: x.gestion_color || '',
    // La llamada del Call Center, si llego a crearse. Sin ella, la incidencia
    // esta explicada aqui pero no cuenta en sus KPIs.
    llamada: x.llamada_clave || '',
    // Como se clasificaria en el Call Center este tipo de incidencia. Sirve para
    // el detalle del parte: saber en que cajon cae aunque nadie haya llamado aun.
    clasificacion: (x.cc_cluster || x.cc_motivo)
      ? { cluster: x.cc_cluster || '', subcluster: x.cc_subcluster || '', motivo: x.cc_motivo || '' }
      : null,
    // Cuántas veces se ha llamado ya y el último intento. "He llamado" no cierra:
    // por eso una incidencia puede seguir abierta con varios seguimientos.
    seguimientos: Number(x.seg_n) || 0,
    ultimoSeguimiento: x.seg_at ? { quien: x.seg_quien || '', at: x.seg_at } : null,
  }));
}

/**
 * Alguien ha llamado y cuenta que paso.
 *
 * El motivo es obligatorio: una incidencia cerrada sin explicacion no es una
 * incidencia resuelta, es una incidencia escondida.
 */
/** Las formas de cerrar una incidencia. Salen de la base, no de la pantalla. */
async function gestiones() {
  const r = await db.consulta(
    `SELECT codigo, etiqueta, detalle, exige_motivo, crea_llamada, color
       FROM fv_cat_gestion WHERE activa ORDER BY orden`);
  return r.rows.map(x => ({
    codigo: x.codigo, etiqueta: x.etiqueta, detalle: x.detalle || '',
    exigeMotivo: x.exige_motivo, creaLlamada: x.crea_llamada, color: x.color || '',
  }));
}

/**
 * Cerrar una incidencia: llamando o ignorándola.
 *
 * LAS DOS DEJAN RASTRO IGUAL — quién, cuándo y por qué. La diferencia es que
 * ignorar no crea llamada en el Call Center: no ha habido llamada, y meter una
 * de mentira les ensucia los KPIs y la reincidencia.
 *
 * Qué gestiones hay y cuál crea llamada lo dice `fv_cat_gestion`, no este
 * código: si mañana hace falta "escalada", es una fila.
 */
async function justificar(id, { gestion = 'llamada', motivo, resultado, accion, quien } = {}) {
  const g = (await db.consulta(
    'SELECT * FROM fv_cat_gestion WHERE codigo = $1 AND activa', [String(gestion)])).rows[0];
  if (!g) throw new Error(`No existe la gestión "${gestion}"`);

  const texto = String(motivo || '').trim();
  if (g.exige_motivo && !texto) throw new Error('Hace falta decir qué pasó: sin motivo no se cierra');

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
  //
  // EL PRIMERO QUE LLEGA LA CIERRA. Ese `justificada_at IS NULL` es la mitad de
  // esta función.
  //
  // La lista se repesca cada treinta segundos, así que dos personas pueden estar
  // mirando la misma fila y descolgar a la vez. Sin la condición, el UPDATE se
  // ejecutaba dos veces: el segundo pisaba el motivo del primero y se creaban
  // DOS llamadas en el Call Center para la misma incidencia — que les ensucia
  // los KPIs y la reincidencia, que es justo lo que se quería evitar.
  //
  // Con ella no hace falta ninguna transacción explícita: Postgres bloquea la
  // fila, el segundo espera al primero y al reevaluar la condición ya no la
  // cumple. Se queda en cero filas, y de ahí no pasa.
  const upd = await db.consulta(
    `UPDATE fv_incidencia
        SET justificada_at = now(), justificada_por = $2, motivo = $3, gestion = $4
      WHERE id = $1 AND justificada_at IS NULL
      RETURNING id`,
    [Number(id), String(quien || '').slice(0, 120) || null, texto || null, g.codigo]);

  // Llegó tarde. NO se toca nada y sobre todo NO se crea llamada: se le dice
  // quién se le adelantó y qué dijo, que es lo que necesita para no volver a
  // marcar ese número.
  if (!upd.rowCount) {
    const ya = (await db.consulta(
      `SELECT i.justificada_at, i.justificada_por, i.motivo, i.llamada_clave,
              i.gestion, g.etiqueta AS gestion_etiqueta
         FROM fv_incidencia i
         LEFT JOIN fv_cat_gestion g ON g.codigo = i.gestion
        WHERE i.id = $1`, [Number(id)])).rows[0];
    if (!ya) throw new Error('No existe esa incidencia');
    return {
      id: Number(id), justificada: true, yaEstaba: true,
      gestion: ya.gestion || '', gestionEtiqueta: ya.gestion_etiqueta || '',
      por: ya.justificada_por || '', cuando: ya.justificada_at,
      motivo: ya.motivo || '', llamada: ya.llamada_clave || '',
      sinLlamada: '',
    };
  }

  // Y DESPUÉS se crea la llamada, si esta gestión la crea y ese tipo tiene
  // clasificación. Justificar una incidencia llamando ES una llamada: tiene que
  // contar en sus KPIs y en su reincidencia, no quedarse en un libro aparte.
  let llamada = null, errorLlamada = '', ensayo = null;
  if (g.crea_llamada && inc.cc_motivo && inc.conductor) {
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
    } catch (e) {
      // La justificación NO se deshace: quedó guardada arriba. Solo se dice que
      // la llamada no llegó al Call Center, para poder repetirla a mano.
      errorLlamada = e.message;
      console.error('⚠️  [FLOTA VIVA] No se pudo registrar la llamada:', e.message);
    }

    // GUARDAR EL ENLACE VA APARTE, y a propósito.
    //
    // Estaba dentro del mismo try, así que si la llamada se creaba bien y luego
    // fallaba este UPDATE, se reportaba "sin llamada en el Call Center" — con la
    // llamada ya escrita en su hoja. Decir que algo no pasó cuando sí pasó es
    // peor que no decir nada: nadie va a ir a borrarla.
    if (llamada) {
      try {
        await db.consulta('UPDATE fv_incidencia SET llamada_clave = $2 WHERE id = $1',
          [Number(id), llamada.clave]);
      } catch (e) {
        console.error(`⚠️  [FLOTA VIVA] Llamada ${llamada.clave} creada pero no enlazada: ${e.message}`);
      }
    }
  }

  return {
    id: Number(id), justificada: true,
    gestion: g.codigo, gestionEtiqueta: g.etiqueta,
    llamada: llamada ? llamada.clave : null,
    // Ignorar SIN llamada es lo correcto, no un fallo: por eso no se avisa de
    // nada. Solo se explica cuando SÍ se esperaba una llamada y no salió.
    sinLlamada: !g.crea_llamada ? ''
      : !inc.cc_motivo ? 'ese tipo no tiene clasificación de Call Center'
        : !inc.conductor ? 'no consta el conductor'
          : errorLlamada || '',
  };
}

/**
 * "He llamado" — un intento de llamada, SIN cerrar la incidencia.
 *
 * Es el botón de seguimiento de En directo, al lado de Justificar. A diferencia
 * de justificar, no toca justificada_at ni crea llamada en el Call Center: solo
 * deja rastro de que se ha intentado. Se puede pulsar tantas veces como se llame
 * —no cogen, se vuelve a marcar— y cada vez suma una fila con quién y cuándo. La
 * incidencia sigue abierta hasta que alguien la justifica de verdad.
 */
async function seguir(id, { quien, nota } = {}) {
  const inc = (await db.consulta(
    'SELECT id FROM fv_incidencia WHERE id = $1', [Number(id)])).rows[0];
  if (!inc) throw new Error('No existe esa incidencia');
  await db.consulta(
    'INSERT INTO fv_seguimiento (incidencia_id, quien, nota) VALUES ($1, $2, $3)',
    [Number(id), String(quien || '').slice(0, 120) || null, String(nota || '').trim() || null]);
  const c = (await db.consulta(
    'SELECT count(*)::int AS n FROM fv_seguimiento WHERE incidencia_id = $1', [Number(id)])).rows[0];
  return { id: Number(id), veces: c.n };
}

/** Los intentos de llamada de una incidencia, del primero al último. */
async function seguimientos(id) {
  const r = await db.consulta(
    `SELECT quien, nota, creada_at
       FROM fv_seguimiento WHERE incidencia_id = $1 ORDER BY creada_at`, [Number(id)]);
  return r.rows.map(x => ({ quien: x.quien || '', nota: x.nota || '', at: x.creada_at }));
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
      llamadas: lista.filter(x => x.gestion === 'llamada').length,
      ignoradas: lista.filter(x => x.gestion === 'ignorada').length,
      coches: new Set(lista.map(x => x.matricula)).size,
      porTipo,
    },
  };
}

/**
 * Los partes de varios dias de un vistazo.
 *
 * Es el reporte que se mira de semana en semana: cada franja de cada dia con
 * cuantas incidencias hubo y cuantas quedaron SIN REVISAR. Lo que se persigue es
 * esa segunda columna — lo demas ya se llamo y se explico.
 */
async function partes({ desde, hasta } = {}) {
  const r = await db.consulta(
    `SELECT to_char(i.dia_operativo, 'YYYY-MM-DD') AS dia, i.franja, f.etiqueta AS franja_etiqueta, f.orden,
            count(*)::int                                              AS total,
            count(*) FILTER (WHERE i.justificada_at IS NULL)::int       AS sin_revisar,
            -- Revisada no es lo mismo que llamada. Se separan porque el jefe
            -- pregunta por las dos cosas: cuantas se atendieron y cuantas
            -- llegaron a ser una llamada de verdad.
            count(*) FILTER (WHERE i.gestion = 'llamada')::int          AS llamadas,
            count(*) FILTER (WHERE i.gestion = 'ignorada')::int         AS ignoradas,
            count(*) FILTER (WHERE i.llamada_clave IS NOT NULL)::int    AS con_llamada,
            count(DISTINCT i.vehiculo_uuid)::int                        AS coches
       FROM fv_incidencia i
       JOIN fv_franja f ON f.codigo = i.franja
      WHERE i.dia_operativo BETWEEN COALESCE($1::date, CURRENT_DATE - 7)
                                AND COALESCE($2::date, CURRENT_DATE)
      GROUP BY i.dia_operativo, i.franja, f.etiqueta, f.orden
      ORDER BY i.dia_operativo DESC, f.orden`, [desde || null, hasta || null]);

  return r.rows.map(x => ({
    dia: x.dia, franja: x.franja, franjaEtiqueta: x.franja_etiqueta,
    total: x.total, sinRevisar: x.sin_revisar, conLlamada: x.con_llamada,
    llamadas: x.llamadas, ignoradas: x.ignoradas, coches: x.coches,
  }));
}

module.exports = {
  estado, historial, historialConductor, incidencias, gestiones, justificar, seguir, seguimientos,
  clasificacionDe, cierre, partes, duracion,
};
