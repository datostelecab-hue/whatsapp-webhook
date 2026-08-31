// ============================================================
// AGENDA — las filas de AGENDA_V2, construidas desde PostgreSQL
// ============================================================
// Veinticuatro módulos leen los conductores de la hoja AGENDA_V2: el
// planificador, la cobertura, el control de horas, el bot, las nóminas, los
// reportes… Reescribirlos todos a la vez sería cambiar medio sistema de golpe.
//
// Casi todos pasan por `leerCrudo()` de `planificadorV2.js`, que devuelve
// `agendaFilas` (un arreglo de arreglos, tal cual venía de Google) y se lo pasa
// a `calcularTablero`, que es una función PURA. Así que basta con producir esas
// mismas filas desde la base: el motor recibe lo de siempre y nadie más se
// entera.
//
// El orden de las columnas lo manda `A_HEADERS` del propio motor, no una lista
// escrita aquí: si allí se añade una columna, esto no se queda corto en
// silencio — se comprueba al arrancar.
//
// Lo que NO se rellena: las ASG_* y BINOMIO. Las calcula el motor a partir del
// planificador, y escribirlas aquí sería inventarse un dato que él mismo va a
// sobrescribir dos líneas después.

const db = require('../db');

/** Fecha de la base → dd/mm/aaaa, que es como venía de la hoja. */
function fecha(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  const p = n => String(n).padStart(2, '0');
  // Hora LOCAL, no UTC. Una columna DATE la convierte el driver en un Date a
  // medianoche local; leerlo en UTC desde Madrid (UTC+1/+2) devuelve el dia
  // anterior. Asi es como un alta del 07/02 salia como 06/02 en 135 filas.
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// La hoja usaba 'SI' / '' para los booleanos y el motor los lee así.
const si = v => (v ? 'SI' : '');
// Para lo que puede no saberse: vacio NO quiere decir "no", quiere decir que
// nadie lo ha rellenado todavia. Un 'NO' se afirma; un hueco se deja en blanco.
const siNo = v => (v === null || v === undefined ? '' : (v ? 'SI' : 'NO'));
const txt = v => (v === null || v === undefined ? '' : String(v));

/**
 * Las filas de la agenda, CON la cabecera, exactamente como las devolvía
 * Google. La cabecera importa: `leerCrudo` la usa para validar el esquema y
 * luego la descarta con `.slice(1)`.
 */
async function filas() {
  const { A, A_HEADERS } = require('../planificadorV2');

  const r = await db.consulta('SELECT * FROM v_agenda ORDER BY nombre_apellidos');

  // Cada columna en su sitio, por su NÚMERO del mapa `A`. Colocarlas por orden
  // de aparición sería la forma de que un cambio en la hoja las descoloque
  // todas sin que nadie lo note.
  const salida = r.rows.map(c => {
    const f = new Array(A_HEADERS.length).fill('');
    f[A.ACTIVO - 1]          = si(c.activo);
    f[A.ESTADO - 1]          = txt(c.estado);
    f[A.NOMBRE - 1]          = txt(c.nombre_apellidos);
    f[A.ID_BOLT - 1]         = txt(c.id_bolt);
    f[A.DNI - 1]             = txt(c.dni_nie);
    f[A.NAF - 1]             = txt(c.naf);
    f[A.FECHA_ALTA - 1]      = fecha(c.fecha_alta);
    f[A.FIN_PRUEBA - 1]      = fecha(c.fin_periodo_prueba);
    f[A.EN_PRUEBA - 1]       = siNo(c.en_prueba);
    f[A.RECOMENDADOR - 1]    = txt(c.recomendador);
    f[A.TURNO - 1]           = txt(c.turno);
    f[A.CONTRATO - 1]        = txt(c.contrato);
    f[A.L_LUN - 1]           = si(c.lib_lun);
    f[A.L_MAR - 1]           = si(c.lib_mar);
    f[A.L_MIE - 1]           = si(c.lib_mie);
    f[A.L_JUE - 1]           = si(c.lib_jue);
    f[A.L_VIE - 1]           = si(c.lib_vie);
    f[A.L_SAB - 1]           = si(c.lib_sab);
    f[A.L_DOM - 1]           = si(c.lib_dom);
    f[A.MATRICULA - 1]       = txt(c.matricula);
    f[A.COORDENADAS - 1]     = txt(c.coordenadas);
    f[A.DIRECCION - 1]       = txt(c.direccion_completa);
    f[A.TELEFONO - 1]        = txt(c.telefono);
    f[A.TEL_EMERG - 1]       = txt(c.tel_emergencia);
    f[A.OBSERVACIONES - 1]   = txt(c.observaciones);
    f[A.REINCORPORACION - 1] = fecha(c.reincorporacion);
    // Su ID_BOLT es provisional: no tiene cuenta de BOLT todavía. El
    // planificador lo avisa sin impedir que se le coloque en un coche.
    f[A.BOLT_PENDIENTE - 1]  = si(c.bolt_pendiente);
    // BINOMIO y ASG_* se quedan vacías a propósito: las pone el motor.
    return f;
  });

  return [A_HEADERS.slice()].concat(salida);
}

/**
 * Comprueba que este constructor sigue cubriendo todas las columnas que el
 * motor espera leer. Se llama al arrancar.
 *
 * Existe porque el fallo natural aquí es mudo: si mañana se añade una columna a
 * la agenda y aquí no, esa columna llega VACÍA a todo el sistema y nadie ve un
 * error — solo datos que faltan en sitios raros semanas después.
 */
async function comprobarCobertura() {
  const { A, A_HEADERS } = require('../planificadorV2');
  // Las que el motor calcula y por eso no se rellenan aquí.
  const CALCULADAS = new Set([
    A.BINOMIO, A.ASG_LUN, A.ASG_MAR, A.ASG_MIE, A.ASG_JUE, A.ASG_VIE, A.ASG_SAB, A.ASG_DOM,
  ]);

  const fuente = require('fs').readFileSync(__filename, 'utf8');
  const puestas = new Set([...fuente.matchAll(/f\[A\.([A-Z_]+) - 1\]/g)].map(m => A[m[1]]));

  const faltan = [];
  for (let col = 1; col <= A_HEADERS.length; col++) {
    if (CALCULADAS.has(col) || puestas.has(col)) continue;
    faltan.push(`${A_HEADERS[col - 1]} (col ${col})`);
  }
  const NL = String.fromCharCode(10);
  if (faltan.length) {
    console.error('❌ [AGENDA] Estas columnas llegarían VACÍAS a todo el sistema:' + NL +
                  '   ' + faltan.join(', '));
  } else {
    console.log(`✓ [AGENDA] ${A_HEADERS.length} columnas cubiertas (${CALCULADAS.size} las calcula el motor)`);
  }
  return faltan;
}

module.exports = { filas, comprobarCobertura };
