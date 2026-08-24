// ============================================================
// ALTA — qué se puede hacer con este teléfono
// ============================================================
// Todo empieza escribiendo un número. Con él se hacen DOS preguntas que no
// dependen la una de la otra:
//
//   1. ¿Tenemos ficha suya?   -> conductor_telefono, incluidos los cerrados
//   2. ¿Tiene cuenta en BOLT? -> conductor_externo.externo_telefono
//
// De las dos respuestas sale lo que toca hacer. Y hace falta preguntarlo ANTES
// de dejar rellenar nada: si se pregunta después, lo único que se puede hacer es
// rechazar el alta con un error, y quien lo lee se queda sin saber si debe
// restaurar, enlazar o empezar de cero.
//
// Sin cuenta de BOLT no se puede trabajar: está prohibido. Por eso "hay ficha
// pero no hay cuenta" es un caso propio y no un detalle.
//
// Aquí NO se escribe nada. Escribir es de `conductores.crear` (alta nueva),
// `conductores.darDeAlta` (restauración) y `cazamientoBolt.enlazar` (la cuenta).

const db = require('../db');

const NOMBRE = `btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)`;

/**
 * "RUIZ CANO, JUAN FRANCISCO" -> apellidos + nombre.
 *
 * Con coma, lo de delante son los apellidos: así lo escriben la gestoría y la
 * ETT. Sin coma no se adivina — partir por el primer espacio acierta con "Juan
 * Perez" y falla con "Maria del Carmen Ruiz", así que va entero al nombre y que
 * lo separe una persona si hace falta.
 */
function partirNombre(completo) {
  const s = String(completo == null ? '' : completo).trim();
  if (!s.includes(',')) return { nombre: s.slice(0, 80), apellidos: null };
  const trozos = s.split(',');
  return {
    nombre: trozos.slice(1).join(',').trim().slice(0, 80),
    apellidos: trozos[0].trim().slice(0, 120),
  };
}

/** Los nueve últimos dígitos, que es como se comparan los teléfonos aquí. */
const sufijo9 = v => {
  const d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
};

// Qué es cada caso y qué se hace con él. El texto vive aquí y no en la pantalla
// para que la explicación sea la misma la vea quien la vea.
const CASOS = {
  ya_trabaja: {
    titulo: 'Ya está de alta',
    explica: 'Esta persona tiene contrato abierto ahora mismo. No hay nada que dar de alta.',
    accion: null,
  },
  restauracion: {
    titulo: 'Restauración al puesto',
    explica: 'Ya tuvo ficha aquí y su cuenta de BOLT sigue existiendo. Vuelve a su puesto: ' +
             'se le abre un periodo de empleo nuevo sobre la MISMA ficha, sin perder su historial.',
    accion: 'restaurar',
  },
  restauracion_sin_bolt: {
    titulo: 'Restauración, pero falta la cuenta de BOLT',
    explica: 'Tenemos su ficha, pero no hay cuenta de BOLT con este número. Sin ella no puede ' +
             'trabajar: hay que darle de alta en BOLT antes de que se incorpore.',
    accion: 'restaurar',
  },
  alta_con_bolt: {
    titulo: 'Alta nueva, con cuenta de BOLT ya existente',
    explica: 'No tenemos ficha suya, así que hay que crearla desde cero. Pero su cuenta de BOLT ' +
             'ya existe con este mismo número, así que no hay que crear ninguna: basta con ' +
             'reactivarla y enlazarla a la ficha nueva.',
    accion: 'crear',
  },
  alta_nueva: {
    titulo: 'Alta nueva',
    explica: 'Ni ficha ni cuenta de BOLT. Se crea la ficha y hay que darle de alta en BOLT: ' +
             'sin esa cuenta no puede trabajar.',
    accion: 'crear',
  },
};

/**
 * Qué sabemos de este teléfono y qué se puede hacer con él.
 *
 * Devuelve siempre un objeto, nunca lanza por no encontrar nada: no encontrarlo
 * es una respuesta ("alta nueva"), no un error.
 */
async function porTelefono(telefono) {
  const s9 = sufijo9(telefono);
  if (!s9) throw new Error('El teléfono debe tener al menos 9 dígitos');

  const r = await db.consulta(
    `SELECT f.conductor_id, f.quien, f.dni_nie, f.empleo_vigente, f.situacion,
            f.tel_vigente, f.tel_e164,
            f.baja, f.motivo_baja,
            b.cuenta_id, b.externo_id, b.externo_nombre, b.externo_telefono, b.estado_externo,
            b.conductor_id AS bolt_enlazada_con, b.enlazada_quien
       FROM (SELECT $1::text AS s9) t
       LEFT JOIN LATERAL (
         SELECT c.id AS conductor_id, ${NOMBRE} AS quien, c.dni_nie, c.empleo_vigente,
                ct.vigente_hasta IS NULL AS tel_vigente, ct.e164 AS tel_e164,
                COALESCE(ce.etiqueta, 'Activo')                    AS situacion,
                ult.baja, ult.motivo_baja
           FROM conductor_telefono ct
           JOIN conductor c ON c.id = ct.conductor_id AND NOT c.es_centinela
           LEFT JOIN conductor_estado_hist s
                  ON s.conductor_id = c.id
                 AND s.desde <= CURRENT_DATE AND (s.hasta IS NULL OR s.hasta >= CURRENT_DATE)
           LEFT JOIN cat_estado_conductor ce ON ce.codigo = s.estado
           -- El último contrato cerrado: cuándo se fue y por qué. Es lo que hay
           -- que enseñar antes de restaurar a alguien.
           LEFT JOIN LATERAL (
             SELECT baja, motivo_baja FROM conductor_periodo_empleo
              WHERE conductor_id = c.id AND baja IS NOT NULL
              ORDER BY baja DESC LIMIT 1) ult ON TRUE
          WHERE ct.sufijo9 = t.s9
          -- El teléfono vigente manda sobre uno cerrado del mismo número.
          ORDER BY (ct.vigente_hasta IS NULL) DESC, ct.id DESC
          LIMIT 1) f ON TRUE
       LEFT JOIN LATERAL (
         SELECT x.id AS cuenta_id,
                x.externo_id, x.externo_nombre, x.externo_telefono, x.estado_externo,
                x.conductor_id,
                (SELECT ${NOMBRE} FROM conductor c WHERE c.id = x.conductor_id) AS enlazada_quien
           FROM conductor_externo x
          WHERE x.sistema = 'bolt' AND x.externo_sufijo9 = t.s9
          ORDER BY (x.estado_externo = 'active') DESC, x.visto_desde DESC
          LIMIT 1) b ON TRUE`,
    [s9]);

  const f = r.rows[0] || {};
  const hayFicha = Boolean(f.conductor_id);
  const hayBolt = Boolean(f.externo_id);

  const caso = f.empleo_vigente ? 'ya_trabaja'
             : hayFicha && hayBolt ? 'restauracion'
             : hayFicha ? 'restauracion_sin_bolt'
             : hayBolt ? 'alta_con_bolt'
             : 'alta_nueva';

  // Lo que hay que mirar con los ojos abiertos antes de seguir.
  const avisos = [];
  if (hayBolt && f.estado_externo !== 'active') {
    avisos.push(`La cuenta de BOLT existe pero está "${f.estado_externo}". Hay que reactivarla antes de que empiece.`);
  }
  if (hayBolt && f.bolt_enlazada_con && f.bolt_enlazada_con !== f.conductor_id) {
    avisos.push(`Esa cuenta de BOLT ya está enlazada a ${f.enlazada_quien}. ` +
                'Dos personas no pueden compartir cuenta: hay que deshacer ese enlace o usar otro número.');
  }
  if (hayFicha && !f.tel_vigente) {
    avisos.push('Ese número figura como un teléfono ANTIGUO suyo, no el actual. Conviene confirmarlo con la persona.');
  }

  return {
    telefono: String(telefono).trim(),
    sufijo9: s9,
    caso,
    ...CASOS[caso],
    // El nombre con el que se puede arrancar el formulario. Si no tenemos ficha
    // pero sí cuenta de BOLT, el nombre de BOLT es lo que hay, y escribirlo otra
    // vez a mano solo sirve para que salga distinto.
    nombreSugerido: f.quien || f.externo_nombre || null,
    ficha: hayFicha ? {
      id: f.conductor_id,
      quien: f.quien,
      dniNie: f.dni_nie,
      empleoVigente: f.empleo_vigente,
      situacion: f.situacion,
      telefonoVigente: f.tel_vigente,
      telefono: f.tel_e164,
      baja: f.baja,
      motivoBaja: f.motivo_baja,
    } : null,
    bolt: hayBolt ? {
      // `cuentaId` es el id de la FILA de conductor_externo, que es lo que pide
      // el enlace. El uuid identifica en BOLT, no aqui.
      cuentaId: f.cuenta_id,
      uuid: f.externo_id,
      nombre: f.externo_nombre,
      telefono: f.externo_telefono,
      estado: f.estado_externo,
      activa: f.estado_externo === 'active',
      enlazadaCon: f.bolt_enlazada_con,
      enlazadaQuien: f.enlazada_quien,
    } : null,
    avisos,
  };
}

// ── Dar de alta de verdad ───────────────────────────────────────────────────

/**
 * Da de alta a alguien con lo que sepamos de él, decidiendo solo si es un alta
 * nueva o una restauración.
 *
 * Es el ÚNICO sitio por el que entra gente al sistema, lo llame Selección con
 * un candidato de TIBUS o el módulo de ETT con una tabla pegada. La diferencia
 * entre esos dos no es cómo se crea la ficha: es cuántos datos traen. Por eso no
 * hay dos funciones.
 *
 * `datos` lleva el teléfono, las columnas de la ficha que se sepan, y las del
 * contrato (`alta`, `tipo`, `jornadaHoras`…). Lo que no venga, no se toca.
 */
async function realizar(datos, quien = {}) {
  const d = datos || {};
  const con = require('./conductores');
  const s = await porTelefono(d.telefono);

  if (s.caso === 'ya_trabaja') {
    const e = new Error(`${s.ficha.quien} ya tiene contrato abierto. No hay nada que dar de alta.`);
    e.situacion = s;
    throw e;
  }

  // Los campos de la ficha son los declarados en CAMPOS; el resto (alta, tipo,
  // jornada…) son del contrato y van por otro camino. Separarlos aquí evita que
  // `actualizar` rechace la llamada entera por un campo que no le toca.
  const ficha = {};
  for (const [k, v] of Object.entries(d)) {
    if (con.CAMPOS[k] && v !== '' && v !== null && v !== undefined) ficha[k] = v;
  }
  const contrato = {
    tipo: d.tipo === 'ett' ? 'ett' : 'propia',
    ettNombre: d.ettNombre,
    alta: d.alta,
    antiguedad: d.antiguedad,
    jornadaHoras: d.jornadaHoras,
    finPrueba: d.finPrueba,
  };

  let id, restaurado = false;
  if (s.ficha) {
    // Restauración: la ficha se queda, con su historial. Se actualiza lo que
    // venga nuevo (puede haber cambiado de dirección en un año) y se le abre un
    // periodo de empleo más.
    id = s.ficha.id;
    restaurado = true;
    if (Object.keys(ficha).length) await con.actualizar(id, ficha, quien);
    await con.darDeAlta(id, contrato, quien);
    // Si vuelve con un número que no era el suyo, se le añade.
    if (!s.ficha.telefonoVigente) await con.guardarTelefono(id, d.telefono, quien);
  } else {
    const r = await con.crear({ ...ficha, ...contrato, telefono: d.telefono,
                                turnoId: d.turnoId, libranzas: d.libranzas }, quien);
    id = r.id;
  }

  // La cuenta de BOLT: si existe con ese número y no es de nadie, se enlaza
  // sola. Es el caso que describe `alta_con_bolt`, y hacerlo a mano después solo
  // sirve para que se olvide.
  let boltEnlazada = false;
  if (s.bolt && !s.bolt.enlazadaCon) {
    try { await con.enlazarBolt(id, s.bolt.cuentaId, quien); boltEnlazada = true; }
    catch (e) { console.error(`❌ [ALTA] no se pudo enlazar la cuenta de BOLT: ${e.message}`); }
  }

  return {
    id, restaurado, caso: s.caso, boltEnlazada,
    // Sin cuenta de BOLT no puede conducir. Se devuelve para que la pantalla lo
    // diga en el momento y no se descubra el día que tiene que salir.
    faltaBolt: !s.bolt,
    avisos: s.avisos,
  };
}

/**
 * El paso de ETT a plantilla propia, a los tres meses.
 *
 * NO es una baja seguida de un alta. La persona sigue trabajando: mismo coche,
 * mismo turno, mismas libranzas. Pasar por `darDeBaja` cerraría todo eso y su
 * coche aparecería descubierto al día siguiente.
 *
 * Lo único que cambia es el contrato: se cierra el periodo de ETT y se abre uno
 * propio. Y la antigüedad se ARRASTRA: llevaba tres meses aquí y esos tres meses
 * cuentan, así que `fecha_antiguedad` del periodo nuevo apunta al alta de la ETT.
 */
async function convertirAPropia(conductorId, { desde, jornadaHoras, finPrueba, motivo } = {}, { usuarioId } = {}) {
  const id = Number(conductorId);
  const dia = desde || new Date().toISOString().slice(0, 10);
  const audit = require('./auditoria');

  return db.transaccion(async cli => {
    const ett = (await cli.query(
      `SELECT id, tipo, alta, fecha_antiguedad, ett_nombre
         FROM conductor_periodo_empleo
        WHERE conductor_id = $1 AND baja IS NULL`, [id])).rows[0];

    if (!ett) throw new Error('Esta persona no tiene ningún contrato abierto');
    if (ett.tipo !== 'ett') throw new Error('Su contrato abierto ya es de plantilla propia');
    if (dia <= String(ett.alta).slice(0, 10)) {
      throw new Error('El paso a plantilla propia no puede ser anterior al alta en la ETT');
    }

    // El periodo de ETT se cierra el día ANTES: los dos no pueden solaparse, y
    // el índice uq_empleo_abierto tampoco deja dos abiertos a la vez.
    await cli.query(
      `UPDATE conductor_periodo_empleo
          SET baja = ($1::date - INTERVAL '1 day')::date,
              motivo_baja = COALESCE($2, 'Pasa a plantilla propia')
        WHERE id = $3`, [dia, motivo || null, ett.id]);

    const r = await cli.query(
      `INSERT INTO conductor_periodo_empleo
         (conductor_id, tipo, alta, fecha_antiguedad, jornada_horas, fin_periodo_prueba, usuario_id)
       VALUES ($1,'propia',$2,$3,$4,$5,$6) RETURNING id`,
      [id, dia, ett.fecha_antiguedad || ett.alta, jornadaHoras || null,
       finPrueba || null, usuarioId || null]);

    await audit.registrar({
      tabla: 'conductor', id, usuarioId, cli,
      cambios: [{ campo: 'contrato', antes: `ETT (${ett.ett_nombre || 'sin nombre'}) desde ${ett.alta}`,
                  ahora: `Plantilla propia desde ${dia}, antigüedad de ${ett.fecha_antiguedad || ett.alta}` }],
    });

    return { periodoId: r.rows[0].id, antiguedad: ett.fecha_antiguedad || ett.alta };
  });
}

module.exports = { porTelefono, realizar, convertirAPropia, partirNombre, sufijo9, CASOS };
