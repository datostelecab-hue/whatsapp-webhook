// ============================================================
// DATOS_API — las horas por conductor y día, tal como las deja BOLT
// ============================================================
// Esto FUE el tablero en vivo de tráfico: cruzaba la agenda con las horas y con
// los teléfonos, y pintaba quién debía salir y quién salió. Esa pantalla ya no
// existe: la hace el COCKPIT de Control (`modules/Control/cockpit.service`),
// sobre PostgreSQL y por jornada operativa (05→05). El tablero de aquí llevaba
// tiempo sin que nadie lo llamara, y con él se va la lectura de DB_CONDUCTORES.
//
// Queda LO ÚNICO que se sigue usando: leer la hoja `Datos_API`, donde un cron
// vuelca cada hora las horas de BOLT por conductor y día del mes. De aquí beben
// dos sitios: el reporte de horas de la ETT y la reconstrucción de VISTA_FINAL.
//
// EL CRUCE ES POR NOMBRE, y por eso esto es una parada y no un destino: la hoja
// no guarda ningún identificador, solo el nombre de BOLT, así que quien se
// escriba distinto en los dos sitios no cruza y sale como NN. En PostgreSQL ese
// enlace ya está hecho y lo confirmó una persona.

const { normClave } = require('./conductores');
const { readSheet } = require('./sheets');

const ID_GESTION = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';
const HOJA_DATOS = 'Datos_API';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function numero(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

/** Datos_API → { mes, ano, horas: Map(clave -> { diaDelMes: horas }) }. */
async function leerHorasDatosApi() {
  const filas = await readSheet(ID_GESTION, `${HOJA_DATOS}!A:AZ`);
  const horas = new Map();
  const nombres = new Map();   // clave → nombre original (para poder mostrar los NN)
  let mes = null, ano = null;

  if (filas.length && filas[0][0]) {
    const m = String(filas[0][0]).match(
      /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{4})/i);
    if (m) { mes = MESES.indexOf(m[1].toLowerCase()) + 1; ano = parseInt(m[2]); }
  }

  // Filas de datos por CONTENIDO, no por posición fija. Antes se asumía que
  // empezaban en la fila 4 (i=3): si la hoja las trae una fila más arriba, se
  // perdía exactamente la PRIMERA fila — el primer nombre alfabético ("Aarón…")
  // salía como "no cruza" aunque estuviera tal cual. Ahora se salta solo lo que
  // es cabecera de verdad.
  const CABECERAS = new Set(['CONDUCTOR', 'CONDUCTORES', 'NOMBRE', 'NOMBRES',
    'NOMBRE COMPLETO', 'NOMBRE Y APELLIDOS', 'ESTADO', 'TURNO', 'ID_BOLT', 'DRIVER', 'DRIVERS']);
  for (let i = 1; i < filas.length; i++) {
    const nombre = (filas[i][1] || '').toString().trim();
    if (!nombre || nombre.toUpperCase().includes('TOTAL')) continue;
    if (CABECERAS.has(nombre.toUpperCase())) continue;
    if (!/[a-záéíóúüñ]/i.test(nombre)) continue;   // sin letras no es un conductor
    // Cabecera de números de día (1, 2, 3…): sus columnas de día son la secuencia.
    let secuencia = 0;
    for (let d = 0; d < 10; d++) if (numero(filas[i][3 + d]) === d + 1) secuencia++;
    if (secuencia >= 8) continue;
    const clave = normClave(nombre);
    if (!clave) continue;
    const porDia = {};
    for (let d = 0; d < 31; d++) {
      const v = numero(filas[i][3 + d]);
      if (v != null) porDia[d + 1] = v;
    }
    if (!horas.has(clave)) { horas.set(clave, porDia); nombres.set(clave, nombre); }
  }
  return { mes, ano, horas, nombres };
}

module.exports = { leerHorasDatosApi };
