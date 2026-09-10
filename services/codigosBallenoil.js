// ============================================================
// CÓDIGOS DE LAVADO BALLENOIL — códigos de un solo uso
// ============================================================
// Administración importa una lista (código + fecha de vencimiento). El bot de
// WhatsApp entrega uno LIBRE cuando un conductor lo pide y anota a quién se le
// dio, para que no se reparta dos veces.
//
// ── Por qué esto ya no vive en una hoja ─────────────────────────────────────
// «Que no se reparta dos veces» era, hasta ahora, una promesa. El bot leía la
// hoja entera, elegía la primera fila que pusiera "Disponible" y luego escribía
// "Usado" en ella. Entre lo uno y lo otro pasa medio segundo, y en ese medio
// segundo un segundo conductor que pidiera código leía exactamente la misma
// fila: los dos se llevaban el mismo bono y el segundo se encontraba con que ya
// estaba gastado en el surtidor.
//
// Aquí es UNA sentencia. El `FOR UPDATE SKIP LOCKED` hace que dos peticiones
// simultáneas se lleven códigos distintos sin esperarse: no es una comprobación
// que se pueda colar, es la base de datos negándose a dar el mismo dos veces.
//
// Y «usado» deja de ser una palabra en una celda: es tener fecha de uso. La
// tabla no admite una sin la otra.

const db = require('./db');

const TZ = 'Europe/Madrid';

// Instructivo que acompaña al código cuando el bot lo entrega.
const INSTRUCTIVO =
`📋 *Instrucciones de uso:*
1. Estacione el vehículo en una pista y recuerde su número de pista.
2. Diríjase al terminal Ballenoil Easy Wash y pase el bono por el lector.
3. Seleccione en la pantalla el número de la pista donde está su vehículo.
4. Regrese al vehículo e inicie el programa de lavado que prefiera.
5. Durante el lavado podrá cambiar de programa tantas veces como desee.

⚠️ El código es de *un solo uso*.`;

/** 'dd/mm/aaaa' (como lo pega Administración) → 'aaaa-mm-dd', o null. */
function aIso(s) {
  const m = String(s || '').match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  const i = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return i ? i[0] : null;
}
const esFecha = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');

/**
 * Importa una lista pegada. Acepta "código<sep>fecha" con cualquier separador
 * razonable, se salta la cabecera y no duplica lo que ya está.
 */
async function importar(texto) {
  const vistos = new Set();
  const nuevos = [];
  let invalidos = 0;

  for (const linea of String(texto || '').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const partes = l.split(/[\t;,]+|\s{1,}/).map(s => s.trim()).filter(Boolean);
    const codigo = (partes[0] || '').replace(/\D/g, '');
    if (!/^\d{4,}$/.test(codigo)) { if (!/c[oó]digo/i.test(partes[0] || '')) invalidos++; continue; }
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    nuevos.push({ codigo, vence: aIso(partes[1]) });
  }
  if (!nuevos.length) return { añadidos: 0, duplicados: 0, invalidos };

  // Los que ya estaban no se tocan: si uno ya se entregó, reimportar la lista no
  // puede resucitarlo.
  const r = await db.consulta(`
    INSERT INTO ballenoil_codigo (codigo, vence)
    SELECT x.codigo, x.vence::date
      FROM jsonb_to_recordset($1::jsonb) AS x(codigo text, vence text)
    ON CONFLICT (codigo) DO NOTHING
    RETURNING codigo`, [JSON.stringify(nuevos)]);

  return { añadidos: r.rowCount, duplicados: nuevos.length - r.rowCount, invalidos };
}

/** Todos los códigos, los libres primero. Es lo que pinta Administración. */
async function listar() {
  const r = await db.consulta(`
    SELECT c.codigo,
           to_char(c.vence, 'YYYY-MM-DD') AS vence_iso,
           c.usado_at IS NOT NULL         AS usado,
           c.telefono, c.id_bolt,
           to_char(c.usado_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI') AS fecha_uso,
           (c.usado_at IS NULL AND c.vence IS NOT NULL AND c.vence < CURRENT_DATE) AS vencido
      FROM ballenoil_codigo c
     ORDER BY (c.usado_at IS NOT NULL), c.vence NULLS LAST, c.codigo`);
  return r.rows.map(x => ({
    codigo: x.codigo,
    fecha_vencimiento: esFecha(x.vence_iso),
    estado: x.usado ? 'Usado' : 'Disponible',
    telefono: x.telefono || '', id_bolt: x.id_bolt || '',
    fecha_uso: x.fecha_uso || '', vencido: x.vencido,
  }));
}

/** Las cifras de la pantalla: cuántos quedan y cuántos caducan pronto. */
async function resumen() {
  const r = await db.consulta(`
    SELECT count(*)::int                                                        AS total,
           count(*) FILTER (WHERE usado_at IS NULL AND (vence IS NULL OR vence >= CURRENT_DATE))::int AS disponibles,
           count(*) FILTER (WHERE usado_at IS NOT NULL)::int                    AS usados,
           count(*) FILTER (WHERE usado_at IS NULL AND vence < CURRENT_DATE)::int AS vencidos,
           count(*) FILTER (WHERE usado_at IS NULL AND vence BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS caducan_pronto,
           to_char(min(vence) FILTER (WHERE usado_at IS NULL AND vence >= CURRENT_DATE), 'YYYY-MM-DD') AS proximo_vence
      FROM ballenoil_codigo`);
  return r.rows[0];
}

/**
 * Entrega un código LIBRE y lo marca usado, en una sola sentencia.
 *
 * SKIP LOCKED es lo que hace que dos conductores pidiendo a la vez no se lleven
 * el mismo: el segundo salta la fila que el primero tiene cogida en lugar de
 * esperarla o, peor, leerla como libre.
 */
async function solicitarCodigo({ telefono, idBolt, conductorId } = {}) {
  const r = await db.consulta(`
    UPDATE ballenoil_codigo c
       SET usado_at = now(), telefono = $1, id_bolt = $2, conductor_id = $3
     WHERE c.codigo = (
       SELECT codigo FROM ballenoil_codigo
        WHERE usado_at IS NULL AND (vence IS NULL OR vence >= CURRENT_DATE)
        -- El que antes caduque, primero: si no, se gastan los de largo plazo y
        -- los que estaban a punto de vencer se pierden.
        ORDER BY vence NULLS LAST, codigo
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING c.codigo, to_char(c.vence, 'YYYY-MM-DD') AS vence_iso`,
    [String(telefono || '') || null, String(idBolt || '') || null, conductorId || null]);

  if (!r.rowCount) return null;   // no quedan códigos libres
  return { codigo: r.rows[0].codigo, fecha_vencimiento: esFecha(r.rows[0].vence_iso) };
}

/**
 * Borra los códigos NO usados que ya vencieron. Los usados se conservan
 * siempre: son el histórico de a quién se le dio qué.
 */
async function purgarVencidos() {
  const r = await db.consulta(
    `DELETE FROM ballenoil_codigo
      WHERE usado_at IS NULL AND vence IS NOT NULL AND vence < CURRENT_DATE
     RETURNING codigo`);
  return { borrados: r.rowCount };
}

module.exports = {
  importar, listar, resumen, solicitarCodigo, purgarVencidos, INSTRUCTIVO,
  // Se mantienen por compatibilidad con la pantalla de Administración.
  DISPONIBLE: 'Disponible', USADO: 'Usado',
};
