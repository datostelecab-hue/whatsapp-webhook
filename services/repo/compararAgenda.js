// ============================================================
// COMPARAR LA AGENDA: hoja contra PostgreSQL
// ============================================================
// Antes de que 24 módulos dejen de leer AGENDA_V2 hay que poder demostrar que
// la base dice lo mismo que la hoja. Esto lo lee todo de los dos sitios y saca
// las diferencias, columna por columna.
//
// No cambia nada. Se puede ejecutar tantas veces como haga falta, con el
// sistema en marcha.
//
// Cómo se emparejan las filas: por ID_BOLT primero.
//
// Y OJO con lo que es ID_BOLT, que aquí se dio por supuesto y salió caro: NO es
// un UUID, es el NOMBRE tal como aparece en BOLT. La hoja lo guarda así y el
// planificador lo usa de clave para cruzar AGENDA_V2 con PLANIFICADOR_V2.
//
// Que sea un nombre no lo hace mala clave para esto: es la MISMA cadena a los
// dos lados, carácter a carácter, y es exactamente la que el motor va a cruzar.
// Si no cuadra aquí, tampoco cuadraría en el planificador.
//
// Quien no lo tenga cae al nombre normalizado — sin tildes ni orden de
// apellidos — y eso se marca como emparejamiento DÉBIL: puede acertar aquí y
// aun así fallar en el motor, que compara la cadena tal cual.

const db = require('../db');

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const norm = v => txt(v).toUpperCase().replace(/\s+/g, ' ');
// Sin tildes y con las palabras ordenadas: "Ana García" y "GARCIA, ANA" son la
// misma persona escrita de dos formas.
const normNombre = v => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

// Columnas que NO se comparan: las calcula el motor, no son un dato guardado.
const NO_COMPARAR = ['BINOMIO', 'ASG_LUN', 'ASG_MAR', 'ASG_MIE', 'ASG_JUE', 'ASG_VIE', 'ASG_SAB', 'ASG_DOM'];

/**
 * Compara un valor de la hoja con el de la base con la manga ancha justa:
 * '' y null son lo mismo, 'SI'/'si' también, y una fecha da igual cómo se
 * escriba mientras sea el mismo día.
 */
function iguales(cabecera, hoja, base) {
  const a = txt(hoja), b = txt(base);
  if (a === b) return true;
  if (!a && !b) return true;

  // Booleanos de la hoja. Un "no" se escribe de seis maneras -- vacio, NO,
  // FALSE, 0 -- y todas significan lo mismo. Sin esto, una libranza guardada
  // como FALSE en la hoja y vacia en la base contaba como diferencia: eran
  // unas 100 por cada dia de la semana, siete columnas de ruido.
  const cierto = v => /^(si|sí|s|true|verdadero|x|1)$/i.test(v);
  const falso  = v => !v || /^(no|n|false|falso|0)$/i.test(v);
  if ((cierto(a) || falso(a)) && (cierto(b) || falso(b))) return cierto(a) === cierto(b);

  // Fechas: dd/mm/aaaa contra lo que sea.
  const dia = v => {
    const m = v.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const iso = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : null;
  };
  const da = dia(a), dbb = dia(b);
  if (da && dbb) return da === dbb;

  // Teléfonos: los últimos 9 dígitos, como cruza el bot.
  if (/TELEFONO|TEL_/.test(cabecera)) {
    const nueve = v => v.replace(/\D/g, '').slice(-9);
    if (nueve(a) && nueve(b)) return nueve(a) === nueve(b);
  }

  // Nombres: sin tildes y sin importar el orden de las palabras. La hoja pone
  // "GARCIA RUIZ, Ana" y la base arma "Ana Garcia Ruiz"; es la misma persona y
  // marcarlo como diferencia llenaria el informe de ruido.
  if (/NOMBRE|RECOMENDADOR/.test(cabecera)) return normNombre(a) === normNombre(b);

  // Coordenadas: se comparan con tres decimales (unos 100 metros).
  if (cabecera === 'COORDENADAS') {
    const c = v => (v.match(/-?\d+\.?\d*/g) || []).map(x => Number(x).toFixed(3)).join(',');
    if (c(a) && c(b)) return c(a) === c(b);
  }

  return norm(a) === norm(b);
}

/**
 * Lee las dos agendas y devuelve el informe.
 * `{ enHoja, enBase, soloHoja, soloBase, diferencias, porColumna, debiles }`
 */
async function comparar() {
  const plan = require('../planificadorV2');
  const { A, A_HEADERS } = plan;
  const { readMany } = require('../sheets');

  // La hoja, siempre desde Google (aunque el interruptor esté en postgres).
  const [agendaHoja] = await readMany(plan.SPREADSHEET_PLANIFICADOR, [plan.RANGOS.agenda]);
  const filasHoja = (agendaHoja || []).slice(1).filter(f => txt(f[A.NOMBRE - 1]) || txt(f[A.ID_BOLT - 1]));

  // Y la base.
  const filasBase = (await require('./agenda').filas()).slice(1);

  // Índices para emparejar.
  const porBolt = new Map(), porNombre = new Map();
  filasBase.forEach(f => {
    const id = txt(f[A.ID_BOLT - 1]);
    if (id) porBolt.set(id.toLowerCase(), f);
    const n = normNombre(f[A.NOMBRE - 1]);
    if (n && !porNombre.has(n)) porNombre.set(n, f);
  });

  const usadas = new Set();
  const diferencias = [], soloHoja = [], debiles = [];
  const porColumna = {};

  for (const h of filasHoja) {
    const id = txt(h[A.ID_BOLT - 1]);
    const nombre = txt(h[A.NOMBRE - 1]);
    let b = id ? porBolt.get(id.toLowerCase()) : null;
    let debil = false;
    if (!b) {
      b = porNombre.get(normNombre(nombre));
      debil = Boolean(b);
    }
    if (!b) { soloHoja.push({ id, nombre }); continue; }
    usadas.add(b);
    if (debil) debiles.push({ id, nombre });

    const campos = [];
    A_HEADERS.forEach((cab, i) => {
      if (NO_COMPARAR.includes(cab)) return;
      if (iguales(cab, h[i], b[i])) return;
      campos.push({ columna: cab, hoja: txt(h[i]), base: txt(b[i]) });
      porColumna[cab] = (porColumna[cab] || 0) + 1;
    });
    if (campos.length) diferencias.push({ id, nombre, campos, emparejamientoDebil: debil });
  }

  const soloBase = filasBase.filter(f => !usadas.has(f))
    .map(f => ({ id: txt(f[A.ID_BOLT - 1]), nombre: txt(f[A.NOMBRE - 1]) }));

  return {
    enHoja: filasHoja.length,
    enBase: filasBase.length,
    emparejadas: usadas.size,
    soloHoja,
    soloBase,
    debiles,
    conDiferencias: diferencias.length,
    diferencias: diferencias.slice(0, 200),
    porColumna: Object.entries(porColumna).sort((a, b) => b[1] - a[1])
      .map(([columna, n]) => ({ columna, filas: n })),
  };
}

module.exports = { comparar, iguales, normNombre };
