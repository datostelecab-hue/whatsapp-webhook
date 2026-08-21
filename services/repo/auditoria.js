// ============================================================
// AUDITORÍA — quién cambió qué campo
// ============================================================
// Los cambios que tienen tabla de historial propia (turno, situación, coche,
// teléfono) ya guardan quién los hizo. Los que no la tienen —el DNI, el NAF, la
// dirección, el correo— se registran aquí.
//
// La forma de usarlo es siempre la misma: se lee la fila ANTES, se escribe, y
// se le pasan las dos versiones. El diff lo calcula esta capa, así que ningún
// módulo tiene que acordarse de comparar campo a campo:
//
//   const antes = (await cli.query('SELECT * FROM conductor WHERE id=$1',[id])).rows[0];
//   ...se actualiza...
//   const ahora = (await cli.query('SELECT * FROM conductor WHERE id=$1',[id])).rows[0];
//   await audit.registrar({ tabla: 'conductor', id, antes, ahora, usuarioId, cli });

const db = require('../db');

/**
 * Un valor a texto comparable. Las fechas llegan como Date de la base y como
 * cadena del formulario; sin normalizar, cada guardado parecería un cambio.
 */
function texto(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Buffer.isBuffer(v)) return '(cifrado)';   // el IBAN no se guarda en claro ni aquí
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Qué campos cambiaron entre dos versiones de la misma fila.
 * Devuelve [{ campo, antes, ahora }] solo con los que de verdad cambian.
 */
function diferencias(antes, ahora, { ignorar = [] } = {}) {
  const fuera = new Set(['id', 'creado_at', 'actualizado_at', ...ignorar]);
  const campos = new Set([...Object.keys(antes || {}), ...Object.keys(ahora || {})]);
  const salida = [];
  for (const c of campos) {
    if (fuera.has(c)) continue;
    const a = texto(antes ? antes[c] : null);
    const b = texto(ahora ? ahora[c] : null);
    if (a !== b) salida.push({ campo: c, antes: a, ahora: b });
  }
  return salida;
}

/**
 * Deja constancia de los cambios. Devuelve cuántos se apuntaron.
 *
 * Nunca lanza: que falle la auditoría no puede tumbar la operación de fondo.
 * Si se pasa `cli`, va dentro de la misma transacción que el cambio, que es lo
 * correcto — o se guardan las dos cosas o ninguna.
 */
async function registrar({ tabla, id, antes, ahora, cambios, usuarioId, origen = 'manual', cli, ignorar }) {
  const lista = cambios || diferencias(antes, ahora, { ignorar });
  if (!lista.length) return 0;

  const q = (sql, params) => (cli ? cli.query(sql, params) : db.consulta(sql, params));
  try {
    // Todas en una sentencia: son pocas pero una fila por campo, y en un alta
    // masiva esto se llama muchas veces.
    const valores = [];
    const marcas = lista.map((c, i) => {
      const b = i * 7;
      valores.push(tabla, Number(id), c.campo, c.antes ?? null, c.ahora ?? null, usuarioId || null, origen);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    await q(
      `INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
       VALUES ${marcas.join(', ')}`, valores);
    return lista.length;
  } catch (e) {
    console.error(`⚠️  [AUDITORÍA] No se pudo registrar el cambio en ${tabla}#${id}: ${e.message}`);
    return 0;
  }
}

/** El historial de una fila, de lo más reciente a lo más antiguo. */
async function historial(tabla, id, { limite = 200 } = {}) {
  const r = await db.consulta(`
    SELECT c.campo, c.valor_antes, c.valor_ahora, c.cambiado_at, c.origen,
           u.nombre, u.apellidos, u.email
      FROM cambio_campo c
      LEFT JOIN usuario u ON u.id = c.usuario_id
     WHERE c.tabla = $1 AND c.registro_id = $2
     ORDER BY c.cambiado_at DESC
     LIMIT $3`, [tabla, Number(id), limite]);
  return r.rows.map(x => ({
    ...x,
    quien: x.nombre ? `${x.nombre} ${x.apellidos || ''}`.trim() : (x.email || 'el sistema'),
  }));
}

module.exports = { registrar, diferencias, historial, texto };
