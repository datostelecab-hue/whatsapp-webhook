// ============================================================
// FACTURAS DE TALLER — el SQL
// ============================================================
// Lo que hay que entender antes de tocar esto: UNA FACTURA NO ES DE UN COCHE.
//
//   · iPark manda una factura al mes con VARIOS albaranes dentro, cada uno con
//     su matrícula y su kilometraje.
//   · MotorLine manda una factura por coche.
//   · Y DISCOM factura material a granel —un bidón de aceite de 200 litros—
//     que no es de ningún coche.
//
// Por eso la matrícula vive en las LÍNEAS, no en la cabecera, y una línea puede
// no tener coche: eso es el «NN». No es un agujero del modelo, es un hecho del
// papel — y desde septiembre de 2026 se le ha exigido al taller que la matrícula
// venga siempre, así que un NN posterior es algo que reclamar y tiene que verse.
//
// Los importes van en CÉNTIMOS. En euros con decimales, sumar doscientas líneas
// acaba sacando céntimos de la nada.

const db = require('../../services/db');

// Desde esta fecha se les exige la matrícula en la factura. Un NN anterior es
// como se trabajaba; uno posterior, un incumplimiento que hay que reclamar.
const EXIGE_MATRICULA_DESDE = '2026-09-01';

const cent = eur => {
  if (eur == null || eur === '') return null;
  const n = Number(String(eur).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Importe no válido: "${eur}"`);
  return Math.round(n * 100);
};
const normMat = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Los talleres que facturan. Para el desplegable y para sumar por proveedor. */
async function proveedores({ soloActivos = true } = {}) {
  const r = await db.consulta(
    `SELECT id, nombre, nif, poblacion, telefono, activo
       FROM taller_proveedor
      ${soloActivos ? 'WHERE activo' : ''}
      ORDER BY nombre`);
  return r.rows.map(x => ({ ...x, id: String(x.id) }));
}

async function crearProveedor({ nombre, nif, poblacion, telefono }) {
  const n = String(nombre || '').trim();
  if (!n) throw new Error('El taller necesita un nombre');
  const r = await db.consulta(
    `INSERT INTO taller_proveedor (nombre, nif, poblacion, telefono)
     VALUES ($1, NULLIF(btrim($2),''), NULLIF(btrim($3),''), NULLIF(btrim($4),''))
     RETURNING id, nombre`,
    [n, nif || '', poblacion || '', telefono || '']);
  return { id: String(r.rows[0].id), nombre: r.rows[0].nombre };
}

// El SELECT de la lista, con las cuentas ya hechas por la base: cuántos coches
// lleva dentro y cuánto de lo facturado no tiene matrícula. Hacerlo en JS
// obligaría a traerse todas las líneas de todas las facturas para pintar una
// tabla de veinte filas.
const SELECT_LISTA = `
  SELECT f.id, f.numero, to_char(f.fecha,'YYYY-MM-DD') AS fecha,
         f.total_cent, f.base_cent, f.iva_cent, f.sede,
         f.anulado_at IS NOT NULL AS anulada, f.anulado_motivo,
         f.nombre_archivo, f.enlace,
         p.id AS proveedor_id, p.nombre AS proveedor,
         (SELECT count(*) FROM factura_taller_linea l WHERE l.factura_id = f.id) AS lineas,
         (SELECT count(DISTINCT l.vehiculo_id) FROM factura_taller_linea l
           WHERE l.factura_id = f.id AND l.vehiculo_id IS NOT NULL) AS coches,
         -- NN DE VERDAD: el papel no dice de qué coche es. Se le reclama al
         -- taller.
         (SELECT COALESCE(sum(l.importe_cent),0) FROM factura_taller_linea l
           WHERE l.factura_id = f.id AND l.vehiculo_id IS NULL
             AND COALESCE(btrim(l.matricula_texto),'') = '') AS nn_cent,
         (SELECT count(*) FROM factura_taller_linea l
           WHERE l.factura_id = f.id AND l.vehiculo_id IS NULL
             AND COALESCE(btrim(l.matricula_texto),'') = '') AS nn_lineas,
         -- OTRA COSA: el papel SÍ dice la matrícula, pero no la reconocemos.
         -- Eso no se le reclama a nadie: o está mal tecleada, o es un coche que
         -- no llevamos nosotros. Mezclarlas en el mismo contador esconde las dos.
         (SELECT count(*) FROM factura_taller_linea l
           WHERE l.factura_id = f.id AND l.vehiculo_id IS NULL
             AND COALESCE(btrim(l.matricula_texto),'') <> '') AS desconocidas
    FROM factura_taller f
    JOIN taller_proveedor p ON p.id = f.proveedor_id`;

const aFila = x => ({
  id: String(x.id),
  numero: x.numero,
  fecha: x.fecha,
  proveedorId: String(x.proveedor_id),
  proveedor: x.proveedor,
  sede: x.sede,
  total: +(Number(x.total_cent) / 100).toFixed(2),
  base: x.base_cent == null ? null : +(Number(x.base_cent) / 100).toFixed(2),
  iva: x.iva_cent == null ? null : +(Number(x.iva_cent) / 100).toFixed(2),
  lineas: Number(x.lineas),
  coches: Number(x.coches),
  nn: +(Number(x.nn_cent) / 100).toFixed(2),
  nnLineas: Number(x.nn_lineas),
  desconocidas: Number(x.desconocidas),
  // El aviso no lo decide la pantalla: si la factura es posterior a la fecha en
  // que se les exigió la matrícula y aún trae líneas sin coche, eso se reclama.
  nnReclamable: Number(x.nn_lineas) > 0 && x.fecha >= EXIGE_MATRICULA_DESDE,
  anulada: x.anulada,
  anuladoMotivo: x.anulado_motivo,
  archivo: x.nombre_archivo || '',
  enlace: x.enlace || '',
});

/**
 * Las facturas que cumplen el filtro.
 *
 * `sedes` NO tiene valor por omisión a propósito: quien llama tiene que decir
 * qué sedes puede ver esa persona. Un olvido aquí le enseñaría Barcelona a quien
 * solo lleva Madrid, y eso es justo lo que el campo existe para evitar.
 */
async function lista({ sedes, desde, hasta, proveedorId, texto, soloNN = false, incluirAnuladas = false, limite = 500 } = {}) {
  if (!Array.isArray(sedes) || !sedes.length) throw new Error('Hay que decir de qué sedes se listan las facturas');
  const par = [sedes];
  let w = ' WHERE f.sede = ANY($1::varchar[])';
  if (!incluirAnuladas) w += ' AND f.anulado_at IS NULL';
  if (desde) { par.push(desde); w += ` AND f.fecha >= $${par.length}::date`; }
  if (hasta) { par.push(hasta); w += ` AND f.fecha <= $${par.length}::date`; }
  if (proveedorId) { par.push(Number(proveedorId)); w += ` AND f.proveedor_id = $${par.length}`; }
  if (soloNN) w += ' AND EXISTS (SELECT 1 FROM factura_taller_linea l WHERE l.factura_id = f.id AND l.vehiculo_id IS NULL)';
  if (texto && String(texto).trim()) {
    par.push(`%${String(texto).trim().toLowerCase()}%`);
    const i = par.length;
    // Se busca también por MATRÍCULA: quien pregunta por una factura casi
    // siempre pregunta por el coche, no por el número que le puso el taller.
    w += ` AND (lower(f.numero) LIKE $${i} OR lower(p.nombre) LIKE $${i}
            OR EXISTS (SELECT 1 FROM factura_taller_linea l
                        LEFT JOIN vehiculo v ON v.id = l.vehiculo_id
                       WHERE l.factura_id = f.id
                         AND (lower(COALESCE(v.matricula,'')) LIKE $${i}
                              OR lower(COALESCE(l.matricula_texto,'')) LIKE $${i}
                              OR lower(COALESCE(l.concepto,'')) LIKE $${i})))`;
  }
  par.push(Math.min(Number(limite) || 500, 5000));
  const r = await db.consulta(`${SELECT_LISTA}${w} ORDER BY f.fecha DESC, f.id DESC LIMIT $${par.length}`, par);
  return r.rows.map(aFila);
}

/** Una factura con sus líneas. */
async function ficha(id) {
  const f = (await db.consulta(`${SELECT_LISTA} WHERE f.id = $1`, [Number(id)])).rows[0];
  if (!f) return null;
  const l = await db.consulta(
    `SELECT l.id, l.vehiculo_id, l.matricula_texto, l.albaran,
            to_char(l.fecha,'YYYY-MM-DD') AS fecha, l.km, l.concepto, l.importe_cent,
            v.matricula, v.marca_modelo, v.sede AS vehiculo_sede
       FROM factura_taller_linea l
       LEFT JOIN vehiculo v ON v.id = l.vehiculo_id
      WHERE l.factura_id = $1
      ORDER BY l.fecha NULLS LAST, l.id`, [Number(id)]);
  return {
    ...aFila(f),
    notas: f.notas || '',
    lineasDetalle: l.rows.map(x => ({
      id: String(x.id),
      vehiculoId: x.vehiculo_id == null ? null : String(x.vehiculo_id),
      // Lo que se enseña: la matrícula de la ficha si la reconocimos, y si no
      // la que venía escrita en el papel. NN solo cuando no hay ni eso.
      matricula: x.matricula || x.matricula_texto || '',
      matriculaTexto: x.matricula_texto || '',
      reconocido: x.vehiculo_id != null,
      modelo: x.marca_modelo || '',
      sedeVehiculo: x.vehiculo_sede || '',
      albaran: x.albaran || '',
      fecha: x.fecha,
      km: x.km,
      concepto: x.concepto || '',
      importe: +(Number(x.importe_cent) / 100).toFixed(2),
    })),
  };
}

/**
 * Alta de una factura con sus líneas, todo o nada.
 *
 * Las matrículas se resuelven contra la ficha del coche, pero lo que venía
 * escrito en el papel se guarda SIEMPRE (`matricula_texto`). Si el taller
 * teclea mal una matrícula, sin eso la línea se convierte en un NN mudo y se
 * pierde la única pista para reclamársela.
 */
async function crear({ proveedorId, numero, fecha, base, iva, total, sede = 'madrid', notas, lineas = [] }, { usuarioId } = {}) {
  const num = String(numero || '').trim();
  if (!proveedorId) throw new Error('Falta el taller');
  if (!num) throw new Error('Falta el número de factura');
  if (!fecha) throw new Error('Falta la fecha');
  const totalCent = cent(total);
  if (totalCent == null) throw new Error('Falta el total');

  return await db.transaccion(async cli => {
    const f = await cli.query(
      `INSERT INTO factura_taller (proveedor_id, numero, fecha, base_cent, iva_cent, total_cent, sede, notas, usuario_id)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,NULLIF(btrim($8),''),$9)
       RETURNING id`,
      [Number(proveedorId), num, fecha, cent(base), cent(iva), totalCent, sede, notas || '', usuarioId || null]);
    const id = f.rows[0].id;

    for (const ln of lineas) {
      const mat = normMat(ln.matricula);
      let vehiculoId = null;
      if (mat) {
        const v = await cli.query(
          'SELECT id FROM vehiculo WHERE matricula_norm = $1 ORDER BY baja_at NULLS FIRST LIMIT 1', [mat]);
        vehiculoId = v.rows[0] ? v.rows[0].id : null;
      }
      await cli.query(
        `INSERT INTO factura_taller_linea
           (factura_id, vehiculo_id, matricula_texto, albaran, fecha, km, concepto, importe_cent)
         VALUES ($1,$2,NULLIF(btrim($3),''),NULLIF(btrim($4),''),$5::date,$6,NULLIF(btrim($7),''),$8)`,
        [id, vehiculoId, ln.matricula || '', ln.albaran || '', ln.fecha || fecha,
         ln.km == null || ln.km === '' ? null : Math.round(Number(ln.km)),
         ln.concepto || '', cent(ln.importe) || 0]);
    }
    return { id: String(id), numero: num };
  });
}

/** Una factura no se borra: se anula y se dice por qué. Es contabilidad. */
async function anular(id, motivo, { usuarioId } = {}) {
  const m = String(motivo || '').trim();
  if (!m) throw new Error('Para anular una factura hay que decir por qué');
  const r = await db.consulta(
    `UPDATE factura_taller
        SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL
      RETURNING id`, [Number(id), usuarioId || null, m]);
  if (!r.rows.length) throw new Error('Esa factura no existe o ya estaba anulada');
  return { id: String(id) };
}

/** El PDF: se guarda dónde quedó, no el fichero. */
async function guardarAdjunto(id, { almacen, externoId, enlace, nombreArchivo, mime, bytes }) {
  const r = await db.consulta(
    `UPDATE factura_taller
        SET almacen = $2, externo_id = $3, enlace = $4,
            nombre_archivo = $5, mime = $6, bytes = $7
      WHERE id = $1 RETURNING id`,
    [Number(id), almacen || null, externoId || null, enlace || null,
     nombreArchivo || null, mime || null, bytes == null ? null : Number(bytes)]);
  if (!r.rows.length) throw new Error('Esa factura no existe');
  return { id: String(id) };
}

/**
 * Lo gastado por coche en una ventana. Es la pregunta que hace Óscar: «¿cuánto
 * llevo metido en este coche?».
 *
 * Las líneas sin coche NO se reparten entre los demás: un bidón de aceite no es
 * de nadie, y repartirlo a prorrata sería inventarse un número. Salen aparte,
 * en `sinCoche`.
 */
async function gastoPorVehiculo({ sedes, desde, hasta } = {}) {
  if (!Array.isArray(sedes) || !sedes.length) throw new Error('Hay que decir de qué sedes');
  const par = [sedes, desde || null, hasta || null];
  const r = await db.consulta(
    `SELECT v.id, v.matricula, v.marca_modelo, v.sede, v.estado_operativo,
            count(DISTINCT l.factura_id) AS facturas,
            sum(l.importe_cent)          AS gasto_cent,
            max(l.km)                    AS ultimo_km,
            to_char(max(l.fecha),'YYYY-MM-DD') AS ultima
       FROM factura_taller_linea l
       JOIN factura_taller f ON f.id = l.factura_id AND f.anulado_at IS NULL
       JOIN vehiculo v       ON v.id = l.vehiculo_id
      WHERE v.sede = ANY($1::varchar[])
        AND ($2::date IS NULL OR l.fecha >= $2::date)
        AND ($3::date IS NULL OR l.fecha <= $3::date)
      GROUP BY v.id, v.matricula, v.marca_modelo, v.sede, v.estado_operativo
      ORDER BY sum(l.importe_cent) DESC`, par);

  const nn = await db.consulta(
    `SELECT count(*) FILTER (WHERE COALESCE(btrim(l.matricula_texto),'') = '')  AS lineas,
            COALESCE(sum(l.importe_cent) FILTER (WHERE COALESCE(btrim(l.matricula_texto),'') = ''),0) AS cent,
            count(*) FILTER (WHERE COALESCE(btrim(l.matricula_texto),'') = ''
                               AND f.fecha >= $4::date)                          AS reclamables,
            count(*) FILTER (WHERE COALESCE(btrim(l.matricula_texto),'') <> '') AS desconocidas,
            COALESCE(sum(l.importe_cent) FILTER (WHERE COALESCE(btrim(l.matricula_texto),'') <> ''),0) AS desconocidas_cent
       FROM factura_taller_linea l
       JOIN factura_taller f ON f.id = l.factura_id AND f.anulado_at IS NULL
      WHERE l.vehiculo_id IS NULL
        AND f.sede = ANY($1::varchar[])
        AND ($2::date IS NULL OR l.fecha >= $2::date)
        AND ($3::date IS NULL OR l.fecha <= $3::date)`, [...par, EXIGE_MATRICULA_DESDE]);

  const x = nn.rows[0] || {};
  return {
    coches: r.rows.map(v => ({
      id: String(v.id), matricula: v.matricula, modelo: v.marca_modelo || '',
      sede: v.sede, estado: v.estado_operativo,
      facturas: Number(v.facturas),
      gasto: +(Number(v.gasto_cent) / 100).toFixed(2),
      ultimoKm: v.ultimo_km, ultima: v.ultima,
    })),
    // El papel no dice de qué coche es: se le reclama al taller.
    sinCoche: {
      lineas: Number(x.lineas || 0),
      importe: +(Number(x.cent || 0) / 100).toFixed(2),
      reclamables: Number(x.reclamables || 0),
    },
    // El papel sí lo dice y nosotros no lo reconocemos: se comprueba aquí.
    desconocidas: {
      lineas: Number(x.desconocidas || 0),
      importe: +(Number(x.desconocidas_cent || 0) / 100).toFixed(2),
    },
  };
}

/** El gasto de UN coche, para su ficha. */
async function gastoDe(vehiculoId) {
  const r = await db.consulta(
    `SELECT to_char(l.fecha,'YYYY-MM-DD') AS fecha, l.km, l.albaran, l.concepto,
            l.importe_cent, f.id AS factura_id, f.numero, p.nombre AS proveedor
       FROM factura_taller_linea l
       JOIN factura_taller f ON f.id = l.factura_id AND f.anulado_at IS NULL
       JOIN taller_proveedor p ON p.id = f.proveedor_id
      WHERE l.vehiculo_id = $1
      ORDER BY l.fecha DESC NULLS LAST, l.id DESC`, [Number(vehiculoId)]);
  const lineas = r.rows.map(x => ({
    fecha: x.fecha, km: x.km, albaran: x.albaran || '', concepto: x.concepto || '',
    importe: +(Number(x.importe_cent) / 100).toFixed(2),
    facturaId: String(x.factura_id), numero: x.numero, proveedor: x.proveedor,
  }));
  return { lineas, total: +(lineas.reduce((a, b) => a + b.importe, 0)).toFixed(2) };
}

module.exports = {
  proveedores, crearProveedor,
  lista, ficha, crear, anular, guardarAdjunto,
  gastoPorVehiculo, gastoDe,
  EXIGE_MATRICULA_DESDE,
};
