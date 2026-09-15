// ============================================================
// EL FORMULARIO — lo único que sigue entrando por Google
// ============================================================
// Un conductor rellena un Formulario y la respuesta cae en la pestaña BBDD de
// su libro. Esto la lee y la convierte en un ticket. Nada más: no se escribe en
// esa hoja, ni se toca ninguna otra.
//
// ── POR QUÉ SE LEE BBDD Y NO MASTER ─────────────────────────────────────────
// El libro tiene también una hoja MASTER con los tickets ya montados por un
// Apps Script: clasificados, numerados, con el ID_BOLT buscado cruzando el DNI
// contra otra hoja, y con el correo ya mandado.
//
// Leer MASTER sería más fácil y dejaría vivo ese script, que es la pieza que
// hay que apagar: hace por su cuenta cuatro cosas que este sistema hace mejor
// —identificar a la persona, repartir por áreas, numerar, avisar— y las hace
// sobre filas que después reescribe el ERP. Dos programas sobre las mismas
// filas es como se llega a que uno pise al otro.
//
// Leyendo las respuestas crudas, el formulario solo RECOGE.
//
// ── LAS CABECERAS SON LAS PREGUNTAS ─────────────────────────────────────────
// Y las preguntas se reescriben: "DNI" se convierte en "Indica tu DNI o NIE
// (con la letra)" el día que alguien la aclara. El Apps Script las tenía
// clavadas en una constante, así que retocar el formulario dejaba una columna
// sin leer EN SILENCIO.
//
// Aquí se buscan por trozo de texto (`ticket_form_campo`), y —esto es lo que de
// verdad lo arregla— LO QUE NO CASE CON NINGÚN CAMPO CONOCIDO NO SE PIERDE: se
// añade a la descripción como «Pregunta: respuesta». Una pregunta nueva aparece
// en el ticket desde el primer día sin tocar una línea.

const { readSheet, getSheetIds } = require('../../services/sheets');
const db = require('../../services/db');
const { norm } = require('./clasificar');

// El libro de la ticketera («Operaciones 1.0»). Es SUYO: no es el del
// planificador ni el de horas.
const LIBRO = '1wPiOmvW77TJFNINtGwBqrjudz-lZMfY29RPAUsPmaPg';

// ── QUÉ PESTAÑA ES LA DE LAS RESPUESTAS ────────────────────────────────────
// NO se escribe un nombre fijo, y esto no es precaución teórica: el primer
// intento buscó «BBDD» y la pestaña se llama «BBDD Tickets». Google contestó
// «Unable to parse range» y las cinco bandejas salieron en rojo.
//
// Además, una hoja de respuestas de un Formulario se llama «Form_Responses1»
// hasta que alguien la renombra, y renombrarla es lo normal. Así que se
// PREGUNTA al libro qué pestañas tiene y se elige, por este orden:
//
//   1. la que diga `config_app.ticketera_hoja`, si alguien la ha fijado
//   2. una que empiece por «BBDD»
//   3. una que empiece por «Form_Responses» (el nombre de fábrica)
//
// Si no aparece ninguna, se dice CUÁLES hay. Un «no encuentro la hoja» a secas
// obliga a abrir el libro para averiguar cómo se llama.
const CLAVE_HOJA = 'ticketera_hoja';

let _hoja = null, _hojaTs = 0;

async function nombreDeLaHoja() {
  if (_hoja && Date.now() - _hojaTs < 10 * 60 * 1000) return _hoja;

  const cfg = await require('../../services/configApp').leerConfig().catch(() => ({}));
  const fijada = String(cfg[CLAVE_HOJA] || '').trim();

  const pestanas = Object.keys(await getSheetIds(LIBRO));
  const elegida = (fijada && pestanas.includes(fijada) && fijada)
    || pestanas.find(t => norm(t).startsWith('bbdd'))
    || pestanas.find(t => norm(t).startsWith('form_responses'));

  if (!elegida) {
    throw new Error('No encuentro la hoja de respuestas del formulario. ' +
      `El libro tiene estas pestañas: ${pestanas.join(', ')}. ` +
      'Pon el nombre exacto en el ajuste `ticketera_hoja`.');
  }
  _hoja = elegida; _hojaTs = Date.now();
  return elegida;
}

// Un nombre con espacios hay que ENTRECOMILLARLO en un rango A1, o Google no lo
// entiende. Y se leen todas las columnas: no se sabe cuántas preguntas tiene el
// formulario hoy, y poner un tope es la forma de perder la que se añada mañana.
const rango = hoja => `'${String(hoja).replace(/'/g, "''")}'!A:BZ`;

let campos = null, camposTs = 0;
const TTL = 60 * 1000;

async function mapaCampos() {
  if (campos && Date.now() - camposTs < TTL) return campos;
  const r = await db.consulta(
    'SELECT campo, patron FROM ticket_form_campo ORDER BY orden, id');
  campos = r.rows.map(x => ({ campo: x.campo, patron: norm(x.patron) }));
  camposTs = Date.now();
  return campos;
}

/**
 * Empareja cada cabecera con el campo que rellena. Devuelve:
 *   · `porCampo`  campo → índice de columna (el PRIMERO que lo reclama)
 *   · `sueltas`   [{ i, titulo }] las que no son de ningún campo conocido
 *
 * Una cabecera solo puede ser de un campo, y un campo solo de una cabecera: si
 * dos preguntas dicen "fecha", la segunda se queda como pregunta suelta y sale
 * en la descripción. Repartir la misma fecha entre dos columnas sería peor que
 * enseñarlas las dos.
 */
async function emparejar(cabeceras) {
  const reglas = await mapaCampos();
  const porCampo = {};
  const sueltas = [];

  cabeceras.forEach((h, i) => {
    const titulo = String(h == null ? '' : h).trim();
    if (!titulo) return;
    const n = norm(titulo);
    const regla = reglas.find(r => r.patron && n.includes(r.patron) && !(r.campo in porCampo));
    if (regla) porCampo[regla.campo] = i;
    else sueltas.push({ i, titulo });
  });

  return { porCampo, sueltas };
}

/** dd/mm/aaaa, aaaa-mm-dd o una fecha de Google → aaaa-mm-dd. '' si no se entiende. */
function fecha(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

/**
 * La marca temporal de la respuesta → 'aaaa-mm-dd hh:mm:ss', SIN zona.
 *
 * Se devuelve sin zona a propósito y la pone PostgreSQL con
 * `AT TIME ZONE 'Europe/Madrid'`. Google escribe la hora de Madrid; construir
 * aquí un Date con esos números le pegaría la zona del servidor —que en Render
 * es UTC— y todas las respuestas quedarían una o dos horas antes. Es la misma
 * trampa que ya movió 135 fechas de alta un día entero.
 */
function marca(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ` +
           `${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6] || '00'}` : null;
  }
  const p = n => String(n).padStart(2, '0');
  return `${m[3]}-${p(m[2])}-${p(m[1])} ${p(m[4])}:${m[5]}:${m[6] || '00'}`;
}

/**
 * Las respuestas del formulario a partir de una fila (excluida).
 *
 * `desde` es la MARCA DE AGUA: el número de la última fila que ya se convirtió
 * en ticket. Las hojas de respuestas solo crecen por abajo y nunca se reordenan,
 * así que el número de fila es una referencia estable — y además queda guardado
 * en el ticket, para poder volver a la respuesta original si algo no cuadra.
 */
async function respuestasDesde(desde = 0) {
  const hoja = await nombreDeLaHoja();
  const filas = await readSheet(LIBRO, rango(hoja));
  if (!filas.length) return { cabeceras: [], respuestas: [], ultimaFila: 0, sueltas: [], hoja };

  const cabeceras = filas[0];
  const { porCampo, sueltas } = await emparejar(cabeceras);
  const dame = (row, campo) => {
    const i = porCampo[campo];
    return i == null ? '' : String(row[i] == null ? '' : row[i]).trim();
  };

  const respuestas = [];
  for (let i = 1; i < filas.length; i++) {
    const nFila = i + 1;                       // 1 = cabecera
    if (nFila <= desde) continue;
    const row = filas[i];
    // Una fila sin NADA escrito es un hueco de la hoja, no una respuesta.
    if (!row.some(v => String(v == null ? '' : v).trim())) continue;

    respuestas.push({
      fila: nFila,
      marca: marca(row[porCampo.marca]),
      dni: dame(row, 'dni'),
      nombre: dame(row, 'nombre'),
      telefono: dame(row, 'telefono'),
      email: dame(row, 'email'),
      gestion: dame(row, 'gestion'),
      prioridad: dame(row, 'prioridad'),
      matricula: dame(row, 'matricula'),
      // Las vacaciones traen fecha de inicio y fin; el cambio de libranza, el día
      // que se quiere librar y el que se recupera. Son la misma pareja de fechas
      // con otro nombre, y aquí se guardan en el mismo sitio.
      fechaIni: fecha(row[porCampo.fecha_ini]) || fecha(row[porCampo.dia_librar]),
      fechaFin: fecha(row[porCampo.fecha_fin]) || fecha(row[porCampo.dia_recupera]),
      // TODO lo demás que haya escrito, con su pregunta. Aquí es donde acaban
      // las preguntas que no conocemos, y por eso no se pierde ninguna.
      extras: sueltas
        .map(s => ({ titulo: s.titulo, valor: String(row[s.i] == null ? '' : row[s.i]).trim() }))
        .filter(x => x.valor),
    });
  }

  return {
    hoja,
    cabeceras: cabeceras.map(h => String(h == null ? '' : h).trim()),
    respuestas,
    ultimaFila: filas.length,
    porCampo,
    sueltas: sueltas.map(s => s.titulo),
  };
}

/**
 * La descripción del ticket: lo que escribió la persona, con su pregunta
 * delante. Sustituye al `compilarDesc` del Apps Script, que tenía un bloque de
 * código por subtipo y por tanto se quedaba corto en cuanto se añadía una
 * pregunta al formulario.
 */
function descripcion(r) {
  return r.extras.map(x => `${x.titulo}: ${x.valor}`).join('\n');
}

module.exports = { respuestasDesde, descripcion, emparejar, nombreDeLaHoja, LIBRO };
