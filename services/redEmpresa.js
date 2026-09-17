// ============================================================
// LA RED DE LA EMPRESA — ¿esto se hizo desde dentro o desde fuera?
// ============================================================
// Toda la oficina sale a internet por la misma línea, así que su IP pública
// identifica «estar en la empresa». Eso convierte una IP suelta —que no le dice
// nada a nadie— en la frase que sí se entiende al revisar un libro de
// auditoría: «esto se hizo desde dentro» o «esto se hizo desde fuera».
//
// NO ES UNA MEDIDA DE SEGURIDAD, es una señal. Quien robe una cuenta y se
// conecte desde la oficina saldrá como «dentro», y quien trabaje un domingo
// desde su casa saldrá como «fuera» sin haber hecho nada malo. Sirve para
// MIRAR: una acción sensible desde fuera merece una segunda lectura.
//
// ── Que se pueda cambiar sin tocar código ───────────────────────────────────
// Las líneas de empresa cambian de IP más de lo que parece. Va por variable de
// entorno (REDES_EMPRESA, separadas por comas) con la de hoy como valor por
// defecto: el día que cambie se toca ahí y no hay que desplegar nada.
//
// Y LA ETIQUETA NO SE GUARDA, se calcula al pintar. Si la IP de la oficina
// cambiara y se hubiera guardado «dentro», las filas viejas mentirían para
// siempre; guardando solo la IP, se recalculan solas.

const REDES = String(process.env.REDES_EMPRESA || '80.103.26.249')
  .split(',').map(s => s.trim()).filter(Boolean);

/**
 * Admite una IP suelta ('80.103.26.249') o un prefijo acabado en punto
 * ('80.103.26.'), que es lo que hace falta cuando la línea baila dentro de un
 * rango. Nada de máscaras CIDR: no se necesitan y traerlas es traer un error
 * de cálculo que nadie va a revisar.
 */
function esDeLaEmpresa(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '').trim();
  if (!s) return false;
  return REDES.some(r => (r.endsWith('.') ? s.startsWith(r) : s === r));
}

module.exports = { esDeLaEmpresa, REDES };
