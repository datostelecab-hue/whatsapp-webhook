// ============================================================
// QUÉ SE EXIGE PARA CONTRATAR
// ============================================================
// Vive aquí y no dentro de un módulo porque lo necesitan DOS momentos distintos
// que no se conocen entre sí:
//
//   · Selección, al pasar a RRHH (`repo/candidaturas.pasarARRHH`).
//   · Los tres meses, al pasar de ETT a plantilla propia
//     (`repo/alta.convertirAPropia`).
//
// Si la lista viviera en uno de los dos, el otro tendría que copiarla o
// importarlo, y `alta` y `candidaturas` ya se requieren en un sentido: en el
// otro habría un ciclo.
//
// LA REGLA: "obligatorio" no es una propiedad del dato, es de la RELACIÓN.
//
//   propia -> el expediente entero. La relación laboral es con nosotros.
//   ett    -> lo mínimo para existir y para abrirle cuenta en BOLT. La agencia
//             no da más por protección de datos, y los papeles los manda
//             después. Exigirlos antes bloquea a gente que ya está trabajando.

const db = require('../db');

const CAMPOS = {
  propia: [
    ['nombre', 'Nombre'], ['apellidos', 'Apellidos'], ['dni_nie', 'DNI/NIE'],
    ['fecha_nacimiento', 'Fecha de nacimiento'], ['sexo', 'Sexo'], ['email', 'Correo'],
    ['via_nombre', 'Dirección'], ['codigo_postal', 'Código postal'],
    ['estado_civil', 'Estado civil'], ['naf_numero', 'Nº Seguridad Social'],
  ],
  ett: [
    ['nombre', 'Nombre'], ['dni_nie', 'DNI/NIE'],
  ],
};

/**
 * Qué le falta a una PERSONA para poder contratarla por esta vía.
 *
 * Se pregunta por el conductor y no por la candidatura: a los tres meses la
 * candidatura puede llevar tiempo cerrada, y la persona sigue ahí.
 */
async function faltaPara(conductorId, via = 'propia') {
  const lista = CAMPOS[via] || CAMPOS.propia;
  const r = await db.consulta(
    `SELECT c.*,
            (SELECT count(*)::int FROM conductor_telefono
              WHERE conductor_id = c.id AND vigente_hasta IS NULL) AS telefonos
       FROM conductor c WHERE c.id = $1`, [Number(conductorId)]);
  const c = r.rows[0];
  if (!c) return ['esa persona no existe'];

  const faltan = lista.filter(([campo]) => !String(c[campo] == null ? '' : c[campo]).trim())
    .map(([, etiqueta]) => etiqueta);

  // El teléfono no es un campo de la ficha, tiene su propia tabla. Y sin él no
  // hay cuenta de BOLT que abrir, que es para lo que se crea la ficha.
  if (!c.telefonos) faltan.push('Teléfono');

  // Los documentos previos al alta que exija esta vía.
  const columna = via === 'ett' ? 'td.obligatorio_ett' : 'td.obligatorio';
  const docs = await db.consulta(
    `SELECT d.etiqueta
       FROM v_documento_falta_persona d
       JOIN cat_tipo_documento td ON td.codigo = d.tipo
      WHERE d.conductor_id = $1 AND td.previo_alta AND ${columna}
      ORDER BY td.orden`, [c.id]);

  return [...faltan, ...docs.rows.map(d => 'Documento: ' + d.etiqueta)];
}

module.exports = { CAMPOS, faltaPara };
