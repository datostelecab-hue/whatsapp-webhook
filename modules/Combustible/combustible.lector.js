// ============================================================
// COMBUSTIBLE · QUÉ CORREO ES DE QUIÉN, Y LEERLO
// ============================================================
// Puro: ni base ni red. Con el sobre de un correo (remitente y asunto) decide si
// es de un proveedor de combustible y de cuál; con su cuerpo, lo lee con el
// lector de ese proveedor.
//
// UN LECTOR POR PROVEEDOR, ELEGIDO POR EL REMITENTE. Ballenoil y Petroprix no
// van a escribir igual, y el día que uno cambie su correo no puede romper el del
// otro. Añadir uno es escribir su `lector.<proveedor>.js` y apuntarlo en
// PROVEEDORES.
//
// LOS CORREOS DE OTROS REMITENTES NO SE TOCAN: ni se bajan. El buzón es
// datos@telecab.es, el de Camilo en Thunderbird, con correos de todo tipo.
//
// NI LOS DEL PROVEEDOR QUE NO SON UN REPOSTAJE. De Ballenoil también pueden
// llegar promociones del Club, facturas o respuestas de cliente@: si se leyeran
// como repostajes serían filas rojas de «no se pudo leer» para siempre, y la
// cifra «sin leer» —la que avisa de los problemas de verdad— dejaría de servir.
// Por eso, si el proveedor tiene asunto conocido, se exige también en sus
// correos directos. Los que no lo traen no se bajan: la pasada los cuenta
// aparte (`esDelProveedor`) para que se vean si un día cambia el asunto.
//
// LO QUE REENVÍA LA OFICINA SÍ CUENTA. Antes de que Ballenoil escribiera
// directamente a datos@telecab.es, admin@telecab.es reenviaba sus correos
// («RV: Adjuntamos los datos del repostaje…»): dos de los nueve primeros
// llegaron así, y uno de ellos (ALCOBENDAS II) no llegó de otra forma. Un correo
// de alguien de la casa con el asunto de un proveedor se baja, y solo se da por
// suyo si dentro aparece la dirección del proveedor —la cabecera «De:» del
// reenvío—. Si el mismo repostaje llega por los dos caminos, la base deja uno
// «leido» y el otro «repetido».

const C = require('./lector.comun');

const PROVEEDORES = [
  require('./lector.ballenoil'),
  require('./lector.petroprix'),
];

// Quién es «de la casa» para reenviar: el dominio de las cuentas del ERP.
const DE_LA_CASA = /@telecab\.es$/i;

const proveedor = codigo => PROVEEDORES.find(p => p.codigo === codigo) || null;

/**
 * Con el sobre, ¿de qué proveedor es? → { proveedor, reenviado } o null.
 * `de` es la dirección del remitente; `asunto`, el asunto ya decodificado.
 */
function deQuien({ de, asunto } = {}) {
  const d = String(de || '').trim().toLowerCase();
  const directo = PROVEEDORES.find(p => p.esRemitente(d));
  if (directo) return !directo.asunto || directo.asunto.test(String(asunto || '')) ? { proveedor: directo, reenviado: false } : null;
  if (DE_LA_CASA.test(d)) {
    const p = PROVEEDORES.find(x => x.asunto && x.asunto.test(String(asunto || '')));
    if (p) return { proveedor: p, reenviado: true };
  }
  return null;
}

/** El proveedor de una dirección, mire o no el asunto: para contar los que no son repostajes. */
const esDelProveedor = de => PROVEEDORES.find(p => p.esRemitente(String(de || '').trim().toLowerCase())) || null;

// Entre las variantes de un correo que no se entendió, en lo que se enseña.
const SEPARADOR = '\n\n────────── la otra parte del correo ──────────\n\n';

/**
 * Lee los textos de un correo con el lector del proveedor: el primero que se
 * entienda. Si ninguno, el fallo del primero (el texto que mejor se ve), pero
 * con TODOS los textos en `texto`: si el text/plain era un «use un cliente
 * HTML», el dato está en el otro y la ficha tiene que enseñarlo.
 */
function leerTextos(p, textos, asunto) {
  if (!textos.length) {
    return { proveedor: p.codigo, version: p.version, texto: '', ok: false,
      motivo: 'El correo no trae texto que leer', datos: {}, avisos: [] };
  }
  let primero = null;
  for (const texto of textos) {
    const r = p.leer({ texto, asunto });
    const res = { proveedor: p.codigo, version: r.version, texto,
      ok: r.ok, datos: r.datos || {}, avisos: r.avisos || [], motivo: r.motivo || null };
    if (r.ok) return res;
    if (!primero) primero = res;
  }
  return { ...primero, texto: textos.join(SEPARADOR) };
}

/**
 * Lee un correo ya bajado. `correo`: { de, asunto, partes: [{ tipo, contenido }] }.
 *
 * Devuelve null si no es de ningún proveedor (un reenvío de la casa sin la
 * dirección del proveedor dentro: era otra cosa con un asunto parecido). Si lo
 * es, { proveedor, version, remitente, reenviadoPor, texto, ok, datos, avisos,
 * motivo }: `texto` es el cuerpo en texto plano con el que se leyó (o todos, si
 * no se entendió), el que enseña la ficha.
 */
function leerCorreo(correo = {}) {
  const quien = deQuien(correo);
  if (!quien) return null;
  const textos = C.textosDe(correo.partes);
  const p = quien.proveedor;

  let remitente = String(correo.de || '').trim().toLowerCase();
  let reenviadoPor = null;
  if (quien.reenviado) {
    const original = textos.flatMap(C.correosEn).find(x => p.esRemitente(x));
    if (!original) return null;
    reenviadoPor = remitente;
    remitente = original;
  }
  return { ...leerTextos(p, textos, correo.asunto), remitente, reenviadoPor };
}

/**
 * Vuelve a leer un correo guardado con el lector de ahora, sin ir al buzón:
 * desde sus partes tal cual llegaron (repostaje.cuerpo_partes), que pasan otra
 * vez por textosDe con el código de hoy; si no se guardaron, desde el texto.
 * Para los «no_leido» cuando el lector sube de versión.
 */
function releer({ proveedor: codigo, partes, texto, asunto }) {
  const p = proveedor(codigo);
  if (!p) return null;
  const textos = Array.isArray(partes) && partes.length ? C.textosDe(partes) : [String(texto || '')].filter(t => t.trim());
  return leerTextos(p, textos, asunto);
}

/**
 * ¿El correo es de verdad del proveedor? Por su firma DKIM, que comprueba
 * services/dkim sobre el correo en crudo (`firmas`; null si no se pudo bajar).
 * La cabecera From no prueba nada: cualquiera puede escribir
 * «From: noreply@ballenoil.es», y un repostaje se va a auditar contra un
 * conductor.
 *
 * → { verificado: true | false | null, detalle }. null es «no se puede saber»
 *   (reenviado por la oficina, o el DNS no contestó): no es lo mismo que false.
 */
function firmaDe({ proveedor: codigo, reenviadoPor }, firmas) {
  const p = proveedor(codigo);
  if (reenviadoPor) return { verificado: null, detalle: `Reenviado por ${reenviadoPor}: el correo original no se puede comprobar` };
  if (!Array.isArray(firmas)) return { verificado: null, detalle: 'No se pudo comprobar la firma: no se bajó el correo entero' };
  const suyas = firmas.filter(f => p && f.dominio && p.esRemitente('x@' + f.dominio));
  const buena = suyas.find(f => f.resultado === 'valida');
  if (buena) return { verificado: true, detalle: `Firma DKIM de ${buena.dominio}, válida` };
  const noSe = suyas.find(f => f.resultado === 'no_se_pudo');
  if (noSe) return { verificado: null, detalle: `No se pudo comprobar la firma de ${noSe.dominio}: ${noSe.motivo}` };
  if (suyas.length) return { verificado: false, detalle: `La firma DKIM de ${suyas[0].dominio} no vale: ${suyas[0].motivo}` };
  const otras = firmas.map(f => f.dominio).filter(Boolean);
  return { verificado: false, detalle: `No trae la firma DKIM de ${p ? p.nombre : codigo}` + (otras.length ? ` (solo la de ${otras.join(', ')})` : '') };
}

/** Las versiones de ahora de cada lector: { ballenoil: 1, petroprix: 0 }. */
const versiones = () => Object.fromEntries(PROVEEDORES.map(p => [p.codigo, p.version]));

module.exports = { PROVEEDORES, deQuien, esDelProveedor, leerCorreo, releer, firmaDe, versiones, proveedor };
