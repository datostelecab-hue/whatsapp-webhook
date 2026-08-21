// ============================================================
// VIGENCIA — un solo sitio para todas las tablas con historial
// ============================================================
// Diez tablas del esquema tienen la MISMA forma: una entidad, un `desde` y un
// `hasta` que vale NULL mientras siga abierta. Empleos, situaciones, turnos,
// libranzas, teléfonos, cuentas externas, asignaciones, estados y bases de
// coche, y cortes de turno.
//
// Escribir el SQL a mano en cada módulo daría cuarenta consultas casi iguales,
// y cada una una oportunidad de olvidar el `hasta IS NULL`. Aquí están una vez.
//
// Los nombres de tabla y columna SIEMPRE salen de la lista de abajo, nunca de
// lo que llegue por parámetro: es lo que impide que esto sea una inyección SQL
// con lazo. Un tipo desconocido lanza en vez de construir la consulta.

const db = require('../db');

// tipo → { tabla, entidad, desde, hasta, orden }
const TIPOS = {
  empleo:          { tabla: 'conductor_periodo_empleo', entidad: 'conductor_id',
                     desde: 'alta', hasta: 'baja' },
  situacion:       { tabla: 'conductor_estado_hist',    entidad: 'conductor_id' },
  turnoConductor:  { tabla: 'conductor_turno_hist',     entidad: 'conductor_id' },
  libranza:        { tabla: 'patron_libranza',          entidad: 'conductor_id' },
  telefono:        { tabla: 'conductor_telefono',       entidad: 'conductor_id',
                     desde: 'vigente_desde', hasta: 'vigente_hasta', orden: 'principal DESC' },
  cuentaExterna:   { tabla: 'conductor_externo',        entidad: 'conductor_id',
                     desde: 'visto_desde',   hasta: 'visto_hasta' },
  asignacion:      { tabla: 'asignacion',               entidad: 'plaza_id' },
  estadoVehiculo:  { tabla: 'vehiculo_estado_hist',     entidad: 'vehiculo_id' },
  baseVehiculo:    { tabla: 'vehiculo_base_hist',       entidad: 'vehiculo_id' },
  corteTurno:      { tabla: 'turno_version',            entidad: 'turno_id' },
};

// OJO con las fechas: en SQL `desde <= NULL` no es falso sino DESCONOCIDO, asi
// que no casa NINGUNA fila. Por eso todas las comparaciones van envueltas en
// COALESCE(..., CURRENT_DATE): pasar `undefined` significa "hoy", y decirlo en
// JavaScript no basta porque el null llega igual a la consulta.
function def(tipo) {
  const d = TIPOS[tipo];
  if (!d) throw new Error(`Tipo de vigencia desconocido: "${tipo}". Los válidos: ${Object.keys(TIPOS).join(', ')}`);
  return { desde: 'desde', hasta: 'hasta', orden: null, ...d };
}

/** La fila vigente de una entidad en una fecha (hoy si no se dice otra). */
async function vigente(tipo, entidadId, fecha) {
  const d = def(tipo);
  const r = await db.consulta(
    `SELECT * FROM ${d.tabla}
      WHERE ${d.entidad} = $1
        AND ${d.desde} <= COALESCE($2::date, CURRENT_DATE)
        AND (${d.hasta} IS NULL OR ${d.hasta} >= COALESCE($2::date, CURRENT_DATE))
      ORDER BY ${d.desde} DESC${d.orden ? ', ' + d.orden : ''}
      LIMIT 1`,
    [entidadId, fecha || null]);
  return r.rows[0] || null;
}

/** Todas las filas vigentes de una entidad (teléfonos, por ejemplo, son varios). */
async function vigentes(tipo, entidadId, fecha) {
  const d = def(tipo);
  const r = await db.consulta(
    `SELECT * FROM ${d.tabla}
      WHERE ${d.entidad} = $1
        AND ${d.desde} <= COALESCE($2::date, CURRENT_DATE)
        AND (${d.hasta} IS NULL OR ${d.hasta} >= COALESCE($2::date, CURRENT_DATE))
      ORDER BY ${d.orden ? d.orden + ', ' : ''}${d.desde} DESC`,
    [entidadId, fecha || null]);
  return r.rows;
}

/** El historial completo, del más reciente al más antiguo. */
async function historial(tipo, entidadId) {
  const d = def(tipo);
  const r = await db.consulta(
    `SELECT * FROM ${d.tabla} WHERE ${d.entidad} = $1 ORDER BY ${d.desde} DESC`,
    [entidadId]);
  return r.rows;
}

/** La fila abierta (sin fecha de fin), si la hay. */
async function abierta(tipo, entidadId) {
  const d = def(tipo);
  const r = await db.consulta(
    `SELECT * FROM ${d.tabla} WHERE ${d.entidad} = $1 AND ${d.hasta} IS NULL
      ORDER BY ${d.desde} DESC LIMIT 1`,
    [entidadId]);
  return r.rows[0] || null;
}

/**
 * Abre una vigencia nueva cerrando la anterior el día antes, en UNA transacción.
 * Es la operación que se repite en todo el sistema: cambiar de turno, de
 * situación, de coche, de teléfono. Hacerlo en dos pasos deja la base un
 * instante con dos filas abiertas, y las restricciones de exclusión lo rechazan.
 */
async function reemplazar(tipo, entidadId, datos, { desde, cerrarAnterior = true, cli } = {}) {
  const d = def(tipo);
  const dia = desde || new Date().toISOString().slice(0, 10);

  const hacer = async c => {
    if (cerrarAnterior) {
      // Se cierra el día ANTERIOR al nuevo: los rangos son inclusivos y si no
      // se solaparían un día.
      await c.query(
        `UPDATE ${d.tabla} SET ${d.hasta} = (COALESCE($2::date, CURRENT_DATE) - 1)
          WHERE ${d.entidad} = $1 AND ${d.hasta} IS NULL AND ${d.desde} < COALESCE($2::date, CURRENT_DATE)`,
        [entidadId, dia]);
      // Una vigencia que empezaba HOY y se sustituye hoy mismo no llega a
      // existir: se borra en vez de dejarla con `hasta` anterior a `desde`.
      await c.query(
        `DELETE FROM ${d.tabla}
          WHERE ${d.entidad} = $1 AND ${d.hasta} IS NULL AND ${d.desde} >= COALESCE($2::date, CURRENT_DATE)`,
        [entidadId, dia]);
    }
    const campos = { [d.entidad]: entidadId, [d.desde]: dia, ...datos };
    const cols = Object.keys(campos);
    const r = await c.query(
      `INSERT INTO ${d.tabla} (${cols.join(', ')})
       VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`,
      cols.map(k => campos[k]));
    return r.rows[0];
  };

  return cli ? hacer(cli) : db.transaccion(hacer);
}

/** Cierra la vigencia abierta. Sin abrir otra: el fin de algo. */
async function cerrar(tipo, entidadId, hasta, { cli } = {}) {
  const d = def(tipo);
  const dia = hasta || new Date().toISOString().slice(0, 10);
  const sql = `UPDATE ${d.tabla} SET ${d.hasta} = COALESCE($2::date, CURRENT_DATE)
                WHERE ${d.entidad} = $1 AND ${d.hasta} IS NULL RETURNING *`;
  const r = cli ? await cli.query(sql, [entidadId, dia]) : await db.consulta(sql, [entidadId, dia]);
  return r.rows[0] || null;
}

/**
 * Lo vigente de MUCHAS entidades a la vez, en una sola consulta. Es lo que
 * evita el bucle de "por cada conductor, pídeme su turno" que hoy hace el
 * sistema con las hojas.
 */
async function vigenteDeVarias(tipo, entidadIds, fecha) {
  const d = def(tipo);
  if (!entidadIds || !entidadIds.length) return new Map();
  const r = await db.consulta(
    `SELECT DISTINCT ON (${d.entidad}) * FROM ${d.tabla}
      WHERE ${d.entidad} = ANY($1)
        AND ${d.desde} <= COALESCE($2::date, CURRENT_DATE)
        AND (${d.hasta} IS NULL OR ${d.hasta} >= COALESCE($2::date, CURRENT_DATE))
      ORDER BY ${d.entidad}, ${d.desde} DESC`,
    [entidadIds, fecha || null]);
  return new Map(r.rows.map(x => [x[d.entidad], x]));
}

/** Cuántas entidades tienen algo vigente. Para los contadores del panel. */
async function contarVigentes(tipo, fecha) {
  const d = def(tipo);
  const r = await db.consulta(
    `SELECT count(DISTINCT ${d.entidad})::int n FROM ${d.tabla}
      WHERE ${d.desde} <= COALESCE($1::date, CURRENT_DATE) AND (${d.hasta} IS NULL OR ${d.hasta} >= COALESCE($1::date, CURRENT_DATE))`,
    [fecha || null]);
  return r.rows[0].n;
}

/**
 * Comprueba que el mapa de arriba coincide con las columnas REALES. Existe
 * porque ya falló una vez: `conductor_periodo_empleo` usa alta/baja y no
 * desde/hasta, y el error no aparecia hasta que alguien consultaba ese tipo.
 * Se llama al arrancar; si algo no cuadra, se ve en el log en vez de meses
 * despues en una pantalla vacia.
 */
async function comprobarMapa() {
  const fallos = [];
  for (const [tipo, bruto] of Object.entries(TIPOS)) {
    const d = { desde: 'desde', hasta: 'hasta', ...bruto };
    try {
      const r = await db.consulta(
        `SELECT attname FROM pg_attribute
          WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`, [d.tabla]);
      const cols = new Set(r.rows.map(x => x.attname));
      const faltan = [d.entidad, d.desde, d.hasta].filter(c => !cols.has(c));
      if (faltan.length) fallos.push(`${tipo} (${d.tabla}): no existe ${faltan.join(', ')}`);
    } catch (e) {
      fallos.push(`${tipo}: ${e.message}`);
    }
  }
  const NL = String.fromCharCode(10);
  if (fallos.length) console.error('❌ [VIGENCIA] El mapa no cuadra con la base:' + NL + '   ' + fallos.join(NL + '   '));
  else console.log(`✓ [VIGENCIA] ${Object.keys(TIPOS).length} tipos comprobados contra la base`);
  return fallos;
}

module.exports = {
  TIPOS: Object.keys(TIPOS),
  comprobarMapa,
  vigente, vigentes, vigenteDeVarias, historial, abierta,
  reemplazar, cerrar, contarVigentes,
};
