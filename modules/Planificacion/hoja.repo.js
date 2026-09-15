// ============================================================
// LAS FILAS DE PLANIFICADOR_V2 Y BASES, DESDE POSTGRESQL
// ============================================================
// El gemelo de `services/repo/agenda.js`, para la otra mitad del libro.
//
// El motor viejo (`services/planificadorV2.js`) sigue vivo porque ~18 sitios lo
// llaman, y `calcularTablero` es una función PURA que recibe los valores de las
// hojas tal cual venían de Google. Los conductores ya se los damos desde la base;
// aquí se le dan también los COCHES y las ZONAS, y con eso deja de tocar Google.
//
// ── POR QUÉ FILAS DE HOJA Y NO UN OBJETO LIMPIO ─────────────────────────────
// Porque reescribir `calcularTablero` —1.000 líneas de reglas probadas contra
// 87 coches— para que lea otra forma es exactamente el cambio que no se puede
// revisar de un vistazo. Produciendo las mismas filas, el motor recibe lo de
// siempre y nadie más se entera. La forma rara vive aquí, en un sitio, y se
// tira entera el día que el motor muera.
//
// ── LAS TRES TRADUCCIONES QUE IMPORTAN ──────────────────────────────────────
//
// 1. EL ID_BOLT SE PIDE A `v_agenda`, NO SE RECALCULA. Es la clave con la que el
//    motor cruza las dos mitades, y es un NOMBRE, no un uuid: si aquí se armara
//    con otra expresión —aunque fuera "la misma" escrita dos veces— bastaría un
//    alias distinto para que un conductor apareciera en la agenda y no en su
//    coche. Se lee de la misma vista que produce la agenda.
//
// 2. EL ESTADO DEL COCHE VA EN EL SÍMBOLO DE LA HOJA. La base tiene códigos
//    ('O', 'X', 'S'…) y quien decide qué es operativo es `cat_estado_vehiculo`.
//    El motor compara contra '✓'. Así que se traduce SOLO el operativo y el
//    resto pasa tal cual: son las mismas letras.
//
// 3. LAS FECHAS EN ISO. `parseFecha` del motor acepta aaaa-mm-dd, así que no
//    hace falta dar el rodeo por dd/mm/aaaa y arriesgarse a invertir día y mes.

const db = require('../../services/db');

// El símbolo que el motor entiende por "este coche sale a la calle".
const OPERATIVO_HOJA = '✓';

// Las seis plazas, en el orden que el motor da por hecho (slot 0..5).
const ETIQUETA_SLOT = ['Día', 'Noche', 'CT1 Día', 'CT1 Noche', 'CT2 Día', 'CT2 Noche'];

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const iso = v => (v ? new Date(v).toISOString().slice(0, 10) : '');

// Los días de un correturnos, como los escribe la hoja: "L M X".
const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const letrasDe = dias => (dias || []).map(d => LETRAS[d - 1]).filter(Boolean).join(' ');

/**
 * UNA FILA POR PLAZA, seis por coche, en el orden de la pantalla.
 *
 * Se piden las plazas y su asignación viva de una vez. `v_agenda` entra por el
 * conductor para sacar su ID_BOLT — ver la traducción 1.
 */
async function plazas() {
  const r = await db.consulta(
    `SELECT p.plaza_id, p.vehiculo_id, p.matricula, p.zona, p.slot,
            p.estado_operativo, p.es_operativo,
            ag.id_bolt,
            a.desde, a.hasta,
            (SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana)
               FROM asignacion_dia ad WHERE ad.asignacion_id = a.id) AS dias
       FROM v_plaza p
       LEFT JOIN asignacion a
              ON a.plaza_id = p.plaza_id
             AND a.retirada_at IS NULL
             AND a.desde <= CURRENT_DATE
             AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
       LEFT JOIN v_agenda ag ON ag.conductor_id = a.conductor_id
      WHERE p.visible_cobertura OR p.cuadrante_id IS NOT NULL
      ORDER BY p.zona NULLS LAST, p.cuadrante_num NULLS LAST, p.matricula, p.slot`);
  return r.rows;
}

/** Las zonas con coordenadas: la pestaña BASES. */
async function bases() {
  const r = await db.consulta(
    `SELECT nombre, lat, lng FROM base_zona
      WHERE activa AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY nombre`);
  return r.rows.map(b => ({ nombre: txt(b.nombre), lat: Number(b.lat), lng: Number(b.lng) }));
}

/**
 * LAS FILAS DE PLANIFICADOR_V2, cabecera incluida.
 *
 * @param {object} P        el mapa de columnas del motor (1-based)
 * @param {string[]} cabecera  P_HEADERS, para no escribirla aquí dos veces
 * @param {number} porCoche FILAS_POR_COCHE
 * @param {number} maxCoches N_MAT
 */
async function filas({ P, cabecera, porCoche, maxCoches }) {
  const filasPlaza = await plazas();

  // Agrupar por coche RESPETANDO EL ORDEN en que vienen: el primero que aparece
  // es el coche 1 del tablero. Un Map conserva el orden de inserción.
  const porVehiculo = new Map();
  for (const f of filasPlaza) {
    const k = String(f.vehiculo_id);
    if (!porVehiculo.has(k)) porVehiculo.set(k, []);
    porVehiculo.get(k).push(f);
  }

  const coches = [...porVehiculo.values()];
  // El motor solo mira los primeros `maxCoches`. Si algún día hay más, se dice:
  // quedarse callado sería perder coches enteros del cuadrante sin que nadie lo
  // note hasta que alguien eche en falta una matrícula.
  if (coches.length > maxCoches) {
    console.error(`⚠️  [CUADRANTE] Hay ${coches.length} coches y el motor solo lee ${maxCoches}: ` +
      `${coches.length - maxCoches} se quedan fuera del tablero`);
  }

  const out = [cabecera.slice()];
  for (const plazasDelCoche of coches.slice(0, maxCoches)) {
    const cab = plazasDelCoche[0];
    const porSlot = new Map(plazasDelCoche.map(p => [Number(p.slot), p]));

    for (let k = 0; k < porCoche; k++) {
      const p = porSlot.get(k);
      const fila = [];
      fila[P.TURNO - 1] = ETIQUETA_SLOT[k] || '';
      // El estado, la matrícula y la zona van SOLO en la primera fila del coche,
      // como en la hoja (allí están combinadas). El motor lee `filaTop`.
      if (k === 0) {
        fila[P.ESTADO_VEH - 1] = cab.es_operativo ? OPERATIVO_HOJA : txt(cab.estado_operativo);
        fila[P.MATRICULA - 1] = txt(cab.matricula);
        fila[P.ZONA - 1] = txt(cab.zona);
      }
      if (p) {
        fila[P.ID_BOLT - 1] = txt(p.id_bolt);
        // Los días solo tienen sentido en un correturnos; en un fijo, la hoja los
        // deja vacíos y el motor los deduce del descanso del coche.
        if (k >= 2) fila[P.DIAS_TRABAJA - 1] = letrasDe(p.dias);
        // La ventana de un relevo temporal. `desde` siempre tiene valor, pero el
        // motor solo la usa para acotar; darla entera es más fiel que inventar.
        fila[P.DESDE - 1] = iso(p.desde);
        fila[P.HASTA - 1] = iso(p.hasta);
      }
      // Sin huecos `undefined` en medio: el motor hace txt() de todo, pero una
      // fila dispersa se serializa fatal y se lee peor al depurar.
      for (let i = 0; i < P.HASTA; i++) if (fila[i] === undefined) fila[i] = '';
      out.push(fila);
    }
  }
  return out;
}

module.exports = { filas, bases, OPERATIVO_HOJA, ETIQUETA_SLOT };
