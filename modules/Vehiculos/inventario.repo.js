// ============================================================
// INVENTARIO DEL TALLER — el SQL (db/241)
// ============================================================
// Lo que el taller tiene en el almacén y no lleva matrícula: los recambios de
// Hergar (filtros, pastillas, baterías, lámparas…). Camilo, 12/11/2026: «que se
// pueda sumar cosas al inventario y restar también si las usamos y apuntar en
// qué matrícula fue y qué fecha».
//
// EL STOCK NO SE GUARDA: es la suma de los movimientos no anulados
// (v_inventario_stock). Un número guardado aparte acaba diciendo otra cosa que
// su historia, y aquí la historia es lo que se audita.
//
//   entrada  +   llega (las facturas de Hergar, o a mano)
//   salida   −   se pone en un COCHE, con su fecha: crea además un
//                mantenimiento de ese coche (origen 'inventario'), que es lo que
//                hace que salga en su ficha. Anular la salida lo anula también.
//   ajuste   ±   recuento, rotura, devolución: con el motivo
//
// Nada se borra: un movimiento se anula, con quién y por qué.

const db = require('../../services/db');
const { SEDE_FLOTA } = require('../../services/nucleo');

const TIPOS_MOV = [
  { codigo: 'entrada', etiqueta: 'Entrada' },
  { codigo: 'salida',  etiqueta: 'Puesta en un coche' },
  { codigo: 'ajuste',  etiqueta: 'Ajuste' },
];
const CATEGORIAS = ['aceite', 'frenos', 'neumaticos', 'suspension', 'alumbrado', 'bateria', 'chapa', 'mecanica', 'otro'];

const ent = v => (v == null || v === '' ? null : Math.round(Number(v)));
const txt = v => (v == null ? null : String(v).trim() || null);

/** Una cantidad escrita como sea («2», «1,5») → número con dos decimales como mucho. */
function cantidadDe(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error('La cantidad no es un número');
  return Math.round(n * 100) / 100;
}

/** Euros escritos como sea («1.234,50», «12.5») → céntimos. */
function aCentimos(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('El precio no es un número válido');
  return Math.round(n * 100);
}

/** dd/mm/aaaa o aaaa-mm-dd → 'aaaa-mm-dd', leída por componentes (nunca new Date(cadena)). */
function aIso(v) {
  const s = txt(v);
  if (!s) return null;
  const dd = n => String(n).padStart(2, '0');
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${dd(+m[2])}-${dd(+m[1])}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${dd(+m[2])}-${dd(+m[3])}`;
  return null;
}

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const num = v => (v == null ? null : Number(v));
const euros = c => (c == null ? null : Number(c) / 100);

// ============================================================
// LECTURA
// ============================================================

const SELECT_ARTICULO = `
  SELECT a.id, a.codigo, a.descripcion, a.categoria, a.unidad, a.notas, a.activo,
         a.ultimo_precio_cent, p.nombre AS proveedor,
         s.stock::float8 AS stock, s.entradas::float8 AS entradas, s.salidas::float8 AS salidas,
         to_char(s.ultimo_movimiento, 'YYYY-MM-DD') AS ultimo_movimiento,
         to_char(a.creado_at, 'YYYY-MM-DD HH24:MI') AS creado_at
    FROM inventario_articulo a
    JOIN v_inventario_stock s ON s.articulo_id = a.id
    LEFT JOIN taller_proveedor p ON p.id = a.proveedor_id`;

function aArticulo(a) {
  const stock = num(a.stock) || 0;
  const precio = euros(a.ultimo_precio_cent);
  return {
    id: Number(a.id),
    codigo: a.codigo,
    descripcion: a.descripcion,
    categoria: a.categoria,
    unidad: a.unidad,
    notas: a.notas,
    activo: a.activo,
    proveedor: a.proveedor,
    stock,
    entradas: num(a.entradas) || 0,
    salidas: num(a.salidas) || 0,
    precio,
    // Lo que vale lo que hay, al último precio. Sin precio no se inventa.
    valor: precio == null ? null : Math.round(stock * precio * 100) / 100,
    ultimoMovimiento: a.ultimo_movimiento,
    creadoAt: a.creado_at,
  };
}

/** Todos los artículos con su stock. */
async function lista() {
  const r = await db.consulta(`${SELECT_ARTICULO} ORDER BY a.activo DESC, regexp_replace(a.descripcion, '^[^[:alnum:]]+', ''), a.id`);
  return r.rows.map(aArticulo);
}

/** Un artículo con todos sus movimientos, del más reciente al más antiguo. */
async function ficha(id) {
  const n = ent(id);
  if (!n) throw new Error('Falta el artículo');
  const r = await db.consulta(`${SELECT_ARTICULO} WHERE a.id = $1`, [n]);
  if (!r.rows.length) throw new Error('Ese artículo no existe');
  const m = await db.consulta(`
    SELECT m.id, m.tipo, m.cantidad::float8 AS cantidad, to_char(m.fecha, 'YYYY-MM-DD') AS fecha,
           m.precio_cent, m.albaran, m.destino, m.notas, m.mantenimiento_id,
           v.id AS vehiculo_id, v.matricula,
           f.id AS factura_id, f.numero AS factura_numero,
           u.nombre AS usuario, to_char(m.creado_at, 'YYYY-MM-DD HH24:MI') AS creado_at,
           to_char(m.anulado_at, 'YYYY-MM-DD HH24:MI') AS anulado_at, m.anulado_motivo,
           ua.nombre AS anulado_usuario
      FROM inventario_movimiento m
      LEFT JOIN vehiculo v       ON v.id = m.vehiculo_id
      LEFT JOIN factura_taller f ON f.id = m.factura_id
      LEFT JOIN usuario u        ON u.id = m.usuario_id
      LEFT JOIN usuario ua       ON ua.id = m.anulado_por
     WHERE m.articulo_id = $1
     ORDER BY m.fecha DESC, m.id DESC`, [n]);
  return {
    ...aArticulo(r.rows[0]),
    movimientos: m.rows.map(x => ({
      id: Number(x.id),
      tipo: x.tipo,
      tipoEtiqueta: (TIPOS_MOV.find(t => t.codigo === x.tipo) || {}).etiqueta || x.tipo,
      cantidad: num(x.cantidad),
      fecha: x.fecha,
      precio: euros(x.precio_cent),
      albaran: x.albaran,
      destino: x.destino,
      notas: x.notas,
      vehiculoId: x.vehiculo_id == null ? null : Number(x.vehiculo_id),
      matricula: x.matricula,
      facturaId: x.factura_id == null ? null : Number(x.factura_id),
      facturaNumero: x.factura_numero,
      usuario: x.usuario,
      creadoAt: x.creado_at,
      anuladoAt: x.anulado_at,
      anuladoMotivo: x.anulado_motivo,
      anuladoPor: x.anulado_usuario,
    })),
  };
}

/**
 * Los coches en los que se puede poner una pieza: los de la flota de Madrid
 * (la que mantiene el taller) que no están de baja.
 */
async function coches() {
  const r = await db.consulta(`
    SELECT id, matricula, marca_modelo
      FROM vehiculo
     WHERE baja_at IS NULL AND sede = $1
     ORDER BY matricula`, [SEDE_FLOTA]);
  return r.rows.map(v => ({ id: Number(v.id), matricula: v.matricula, modelo: v.marca_modelo || '' }));
}

// ============================================================
// ESCRITURA
// ============================================================

function datosArticulo(d = {}) {
  const descripcion = txt(d.descripcion);
  if (!descripcion) throw new Error('Falta la descripción del artículo');
  const categoria = txt(d.categoria) || 'otro';
  if (!CATEGORIAS.includes(categoria)) throw new Error(`Categoría desconocida: ${categoria}`);
  return {
    codigo: txt(d.codigo) ? txt(d.codigo).toUpperCase().slice(0, 48) : null,
    descripcion: descripcion.slice(0, 300),
    categoria,
    unidad: (txt(d.unidad) || 'ud').slice(0, 8),
    notas: txt(d.notas),
    precio: aCentimos(d.precio),
  };
}

/** Un artículo nuevo. Con `cantidad`, entra ya con su primera entrada. */
async function crearArticulo(d = {}, { usuarioId } = {}) {
  const a = datosArticulo(d);
  const cantidad = cantidadDe(d.cantidad);
  if (cantidad != null && cantidad <= 0) throw new Error('La cantidad que entra tiene que ser mayor que cero');
  return db.transaccion(async cli => {
    if (a.codigo) {
      const ya = await cli.query(
        `SELECT id, descripcion FROM inventario_articulo WHERE upper(btrim(codigo)) = $1`, [a.codigo]);
      if (ya.rows.length) throw new Error(`Ya hay un artículo con la referencia ${a.codigo}: «${ya.rows[0].descripcion}»`);
    }
    const r = await cli.query(`
      INSERT INTO inventario_articulo (codigo, descripcion, categoria, unidad, notas, ultimo_precio_cent, usuario_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [a.codigo, a.descripcion, a.categoria, a.unidad, a.notas, a.precio, ent(usuarioId)]);
    const id = Number(r.rows[0].id);
    if (cantidad) {
      await cli.query(`
        INSERT INTO inventario_movimiento (articulo_id, tipo, cantidad, fecha, precio_cent, notas, usuario_id)
        VALUES ($1, 'entrada', $2, $3, $4, $5, $6)`,
        [id, cantidad, aIso(d.fecha) || hoyMadrid(), a.precio, 'Alta del artículo', ent(usuarioId)]);
    }
    return { id };
  });
}

/** Cambiar los datos de un artículo (no su stock: eso son movimientos). */
async function editarArticulo(id, d = {}) {
  const n = ent(id);
  if (!n) throw new Error('Falta el artículo');
  const a = datosArticulo(d);
  if (a.codigo) {
    const ya = await db.consulta(
      `SELECT id FROM inventario_articulo WHERE upper(btrim(codigo)) = $1 AND id <> $2`, [a.codigo, n]);
    if (ya.rows.length) throw new Error(`Ya hay otro artículo con la referencia ${a.codigo}`);
  }
  const r = await db.consulta(`
    UPDATE inventario_articulo
       SET codigo = $2, descripcion = $3, categoria = $4, unidad = $5, notas = $6,
           ultimo_precio_cent = COALESCE($7, ultimo_precio_cent),
           activo = COALESCE($8, activo)
     WHERE id = $1 RETURNING id`,
    [n, a.codigo, a.descripcion, a.categoria, a.unidad, a.notas, a.precio,
      typeof d.activo === 'boolean' ? d.activo : null]);
  if (!r.rowCount) throw new Error('Ese artículo no existe');
  return { id: n };
}

/** El stock de un artículo, BLOQUEANDO su fila: dos salidas a la vez no dejan el almacén en negativo. */
async function stockBloqueado(cli, articuloId) {
  const a = await cli.query(
    `SELECT id, codigo, descripcion, categoria, ultimo_precio_cent FROM inventario_articulo WHERE id = $1 FOR UPDATE`,
    [articuloId]);
  if (!a.rows.length) throw new Error('Ese artículo no existe');
  const s = await cli.query(
    `SELECT COALESCE(sum(cantidad), 0)::float8 AS stock FROM inventario_movimiento
      WHERE articulo_id = $1 AND anulado_at IS NULL`, [articuloId]);
  return { articulo: a.rows[0], stock: Number(s.rows[0].stock) };
}

const fmtCant = n => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

/**
 * Un movimiento: entrada (suma), salida (resta y se pone en un coche) o ajuste.
 * `cantidad` llega en POSITIVO para entrada y salida; el ajuste lleva su signo.
 */
async function mover(d = {}, { usuarioId } = {}) {
  const articuloId = ent(d.articuloId);
  if (!articuloId) throw new Error('Falta el artículo');
  const tipo = txt(d.tipo);
  if (!TIPOS_MOV.some(t => t.codigo === tipo)) throw new Error('Ese movimiento no existe');
  const cantidad = cantidadDe(d.cantidad);
  if (cantidad == null || cantidad === 0) throw new Error('Falta la cantidad');
  if (tipo !== 'ajuste' && cantidad < 0) throw new Error('La cantidad va en positivo');
  if (Math.abs(cantidad) > 100000) throw new Error('Esa cantidad no puede ser');
  if (txt(d.fecha) && !aIso(d.fecha)) throw new Error('Esa fecha no se entiende: va en dd/mm/aaaa');
  const fecha = aIso(d.fecha) || hoyMadrid();
  if (fecha > hoyMadrid()) throw new Error('La fecha no puede ser de un día que no ha llegado');
  const notas = txt(d.notas);
  if (tipo === 'ajuste' && !notas) throw new Error('Un ajuste dice por qué (recuento, rotura, devolución…)');
  const precio = aCentimos(d.precio);

  return db.transaccion(async cli => {
    const { articulo, stock } = await stockBloqueado(cli, articuloId);
    const signo = tipo === 'salida' ? -Math.abs(cantidad) : cantidad;

    if (stock + signo < 0) {
      throw new Error(`Solo hay ${fmtCant(stock)} de «${articulo.descripcion}»: no se pueden sacar ${fmtCant(Math.abs(signo))}`);
    }

    let vehiculoId = null, mantenimientoId = null, matricula = null;
    if (tipo === 'salida') {
      vehiculoId = ent(d.vehiculoId);
      if (!vehiculoId) throw new Error('¿En qué coche se ha puesto? Falta la matrícula');
      const v = await cli.query(
        'SELECT id, matricula FROM vehiculo WHERE id = $1 AND baja_at IS NULL', [vehiculoId]);
      if (!v.rows.length) throw new Error('Ese coche no existe o está de baja');
      matricula = v.rows[0].matricula;
      const km = ent(d.km);
      if (km != null && (km < 0 || km > 2000000)) throw new Error('Ese kilometraje no puede ser');
      const precioUd = articulo.ultimo_precio_cent == null ? null : Number(articulo.ultimo_precio_cent);
      const coste = precioUd == null ? null : Math.round(precioUd * Math.abs(signo));
      // El mantenimiento que la pone en la ficha del coche.
      const desc = `${fmtCant(Math.abs(signo))} × ${articulo.descripcion}`;
      const m = await cli.query(`
        INSERT INTO mantenimiento (vehiculo_id, tipo, fecha, km, taller, coste_cent, descripcion,
                                   origen, referencia, categorias, usuario_id)
        VALUES ($1, $2::text, $3, $4, 'Inventario', $5, $6, 'inventario', $7, ARRAY[$2::text], $8)
        RETURNING id`,
        [vehiculoId, articulo.categoria, fecha, km, coste, notas ? `${desc}. ${notas}` : desc,
          articulo.codigo, ent(usuarioId)]);
      mantenimientoId = Number(m.rows[0].id);
      await cli.query(`
        INSERT INTO mantenimiento_pieza (mantenimiento_id, orden, codigo, descripcion, cantidad, precio_cent, importe_cent, categoria)
        VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
        [mantenimientoId, articulo.codigo, articulo.descripcion, Math.abs(signo), precioUd, coste, articulo.categoria]);
    }

    const r = await cli.query(`
      INSERT INTO inventario_movimiento (articulo_id, tipo, cantidad, fecha, vehiculo_id, precio_cent,
                                         notas, mantenimiento_id, usuario_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [articuloId, tipo, signo, fecha, vehiculoId,
        tipo === 'salida' ? articulo.ultimo_precio_cent : precio, notas, mantenimientoId, ent(usuarioId)]);

    // Una entrada con precio deja ese precio como el último del artículo.
    if (tipo === 'entrada' && precio != null) {
      await cli.query('UPDATE inventario_articulo SET ultimo_precio_cent = $2 WHERE id = $1', [articuloId, precio]);
    }
    return { id: Number(r.rows[0].id), stock: stock + signo, matricula, mantenimientoId };
  });
}

/**
 * Anular un movimiento: no se borra. Si era una salida, se anula también su
 * mantenimiento (la pieza deja de salir en la ficha del coche y vuelve al
 * almacén). Una entrada no se anula si deja el stock en negativo: esas piezas
 * ya se han puesto en coches.
 */
async function anular(id, motivo, { usuarioId } = {}) {
  const n = ent(id);
  if (!n) throw new Error('Falta el movimiento');
  const razon = txt(motivo);
  if (!razon) throw new Error('Hay que decir por qué se anula');
  return db.transaccion(async cli => {
    const m = await cli.query(
      `SELECT id, articulo_id, cantidad::float8 AS cantidad, mantenimiento_id, anulado_at
         FROM inventario_movimiento WHERE id = $1`, [n]);
    if (!m.rows.length) throw new Error('Ese movimiento no existe');
    const mov = m.rows[0];
    if (mov.anulado_at) throw new Error('Ese movimiento ya estaba anulado');
    const { articulo, stock } = await stockBloqueado(cli, mov.articulo_id);
    if (stock - Number(mov.cantidad) < 0) {
      throw new Error(`Si se anula, el stock de «${articulo.descripcion}» quedaría en ${fmtCant(stock - Number(mov.cantidad))}: ` +
        'parte de lo que entró ya se ha puesto en coches');
    }
    await cli.query(`
      UPDATE inventario_movimiento SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3 WHERE id = $1`,
      [n, ent(usuarioId), razon]);
    if (mov.mantenimiento_id) {
      await cli.query(`
        UPDATE mantenimiento SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
         WHERE id = $1 AND anulado_at IS NULL`,
        [mov.mantenimiento_id, ent(usuarioId), `Anulada la salida del inventario: ${razon}`]);
    }
    return { id: n, stock: stock - Number(mov.cantidad) };
  });
}

module.exports = {
  TIPOS_MOV, CATEGORIAS,
  lista, ficha, coches, crearArticulo, editarArticulo, mover, anular,
};
