// ============================================================
// COMBUSTIBLE · EL CORREO DE BALLENOIL (DNI & GO)
// ============================================================
// Puro: del texto del correo a los campos del repostaje. Ni base ni red.
//
// Cada repostaje con la tarjeta DNI & GO llega de noreply@ballenoil.es con el
// asunto «Adjuntamos los datos del repostaje realizado el día 22/10/2026 en la
// estación de COSLADA. con DNI & GO⛽️» y, en el cuerpo, una frase con el día y
// la estación, otra con lo que se ahorró, y el «Detalle del repostaje»:
//
//   Conductor: …                       ← una persona, «PROVISIONAL 54» o «[TALLER GUTI]»
//   Matrícula: 9107LWS
//   KM: 123842                          ← lo teclea el conductor: sale «20» o «400»
//   Fecha de cargo: 22/10/2026 06:50
//   Importe total recarga: 50,00€
//   Fecha repostaje: 22/10/2026 06:49
//   Importe repostaje: 47,43€
//   Importe devuelto a su saldo de recarga: 2.57€   ← OPCIONAL, y con PUNTO decimal
//   Litros: 27,432L
//   Carburante: Sin plomo
//
// Visto en los nueve primeros correos de verdad (21-22/10/2026): la estación
// lleva espacios, guiones, paréntesis y tildes («PRAT DE LLOBREGAT (EL).»,
// «HOSPITALET DE LLOBREGAT (L´).», «BARCELONA - CLOT.»), y la frase acaba en
// punto, que no es de la estación. El ahorro no siempre viene. El «devuelto»
// sale con dos decimales, con uno («31.1€») o con ninguno («33€»). Y los que
// reenvía la oficina desde Outlook traen un text/plain de verdad, con la
// cabecera del reenvío delante.
//
// SI EL CORREO CAMBIA: la versión de abajo sube cuando este lector cambie, y los
// correos que quedaron «no_leido» con una versión anterior se vuelven a leer
// solos desde su texto guardado. No hace falta tocar el buzón.

const C = require('./lector.comun');

const VERSION = 1;

// Las etiquetas del «Detalle del repostaje». `obligatorio`: sin eso no se puede
// auditar el repostaje y el correo queda «no_leido» diciendo qué faltó.
const CAMPOS = [
  { campo: 'conductor',       etiqueta: 'Conductor' },
  { campo: 'matricula',       etiqueta: 'Matrícula',                              obligatorio: true },
  { campo: 'km',              etiqueta: 'KM' },
  { campo: 'cargo',           etiqueta: 'Fecha de cargo' },
  { campo: 'recarga',         etiqueta: 'Importe total recarga' },
  { campo: 'repostaje',       etiqueta: 'Fecha repostaje',                        obligatorio: true },
  { campo: 'importe',         etiqueta: 'Importe repostaje',                      obligatorio: true },
  { campo: 'devuelto',        etiqueta: 'Importe devuelto a su saldo de recarga' },
  { campo: 'litros',          etiqueta: 'Litros',                                 obligatorio: true },
  { campo: 'carburante',      etiqueta: 'Carburante' },
];
const NOMBRE_DE = Object.fromEntries(CAMPOS.map(c => [c.campo, c.etiqueta]));

/** ¿Es de Ballenoil? Por la dirección: noreply@ballenoil.es y lo de su casa. */
const esRemitente = de => /@(?:[a-z0-9-]+\.)*ballenoil\.(?:es|com|net)$/i.test(String(de || '').trim());

/** El asunto de sus repostajes: así se reconoce uno reenviado por la oficina. */
const ASUNTO = /datos del repostaje realizado/i;

// Lo que cabe en la base (db/212) y lo que puede ser un repostaje de un
// turismo. Un valor fuera de esto no se guarda tal cual: o el correo no se da
// por leído (lo obligatorio), o se deja vacío con un aviso (lo demás). Sin esto,
// un «Litros: 0,01L» desbordaba el precio por litro, la base rechazaba el
// correo y, al no quedar fila, se volvía a bajar y a fallar hasta perderse.
const LIMITES = {
  litros: [0, 200],              // 0 solo si el importe también es 0: un repostaje anulado
  importe: [0, 2000],
  precioLitro: [0.3, 10],        // fuera de esto, los litros o el importe están mal
  otrosImportes: [0, 10000],     // recarga, devuelto, ahorro
  km: [0, 2000000],
  estacion: 160, frase: 80, carburante: 60,
};

/**
 * La estación de una frase o del asunto, sin lo que se le pega detrás. El punto
 * final es de la frase, no de la estación. Si el correo perdió el salto de
 * línea, detrás viene la frase siguiente («COSLADA. En este repostaje…»): se
 * corta en el punto seguido de una palabra que empieza en mayúscula y sigue en
 * minúscula. Las estaciones van en mayúsculas («SANT BOI DE LL. NORTE»), así
 * que su propio punto no corta.
 */
function recortarEstacion(s) {
  let e = String(s || '').replace(/\s*con DNI\b.*$/i, '');
  const corte = /\.\s+(?=\p{Lu}\p{Ll})/u.exec(e);
  if (corte) e = e.slice(0, corte.index);
  return e.trim().replace(/\.+$/, '').trim();
}

/**
 * La estación, de la frase «…realizado el día 22/10/2026 en la estación de
 * COSLADA.» o, si no está, del asunto («…estación de COSLADA. con DNI & GO»).
 * Si lo de la frase sale largo (más de una línea pegada), manda el asunto, que
 * acaba siempre en «con DNI».
 */
function estacionYDia(texto, asunto) {
  const re = /realizado el d[ií]a\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+en la estaci[oó]n de\s+([^\n]+)/i;
  const deFrase = re.exec(texto || '');
  const deAsunto = /realizado el d[ií]a\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+en la estaci[oó]n de\s+(.+?)\s*(?:con DNI\b|$)/i.exec(asunto || '');
  const m = deFrase || deAsunto;
  if (!m) return { estacion: null, dia: null };
  let estacion = recortarEstacion(m[2]);
  if (deFrase && deAsunto && estacion.length > LIMITES.frase) estacion = recortarEstacion(deAsunto[2]);
  return { estacion: estacion.slice(0, LIMITES.estacion).trim() || null, dia: C.fecha(m[1]) };
}

/**
 * El carburante es la última etiqueta: si el correo pierde los saltos de línea,
 * detrás se le pega el pie («Sin plomo Club Ballenoil Gracias por…»).
 */
function recortarCarburante(s) {
  return String(s || '').split(/\s+(?:Club Ballenoil|Gracias por|Aviso de confidencialidad|-{3,})/i)[0]
    .split(/\.\s/)[0].trim().slice(0, LIMITES.carburante).trim() || null;
}

const dentro = (v, [min, max]) => v >= min && v <= max;

/**
 * Lee un correo. `texto` es el cuerpo ya en texto plano (lector.comun.textosDe).
 *
 * Devuelve { ok: true, datos, avisos } o { ok: false, motivo, faltan, datos }:
 * con lo que sí se entendió, para que la ficha del «no leído» enseñe hasta
 * dónde llegó.
 */
function leer({ texto, asunto } = {}) {
  const t = String(texto || '');
  // Se lee del «Detalle del repostaje» en adelante: en un reenvío, delante va la
  // cabecera de Outlook («Asunto: … »), y nada de ahí es del repostaje.
  const desde = t.search(/detalle del repostaje/i);
  const crudo = C.etiquetas(desde >= 0 ? t.slice(desde) : t, CAMPOS);
  const { estacion, dia } = estacionYDia(t, asunto);
  const ahorroM = /ha ahorrado\s+([\d.,]+)\s*(?:€|eur)/i.exec(t);

  const datos = {
    estacion,
    conductor_texto: crudo.conductor ? crudo.conductor.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null,
    matricula: crudo.matricula ? C.matricula(crudo.matricula) || null : null,
    km: crudo.km != null && crudo.km !== '' ? C.entero(crudo.km) : null,
    cargo_at: crudo.cargo ? C.fechaHora(crudo.cargo) : null,
    repostaje_at: crudo.repostaje ? C.fechaHora(crudo.repostaje) : null,
    importe_recarga: crudo.recarga ? C.numero(crudo.recarga) : null,
    importe: crudo.importe ? C.numero(crudo.importe) : null,
    devuelto: crudo.devuelto ? C.numero(crudo.devuelto) : null,
    litros: crudo.litros ? C.numero(crudo.litros) : null,
    carburante: crudo.carburante ? recortarCarburante(crudo.carburante) : null,
    ahorro: ahorroM ? C.numero(ahorroM[1]) : null,
  };

  // Qué falta o no se entiende. Una etiqueta que está pero con un valor que no
  // es lo que tiene que ser cuenta como «no se entiende», con lo que decía.
  // `graves` son los obligatorios: sin ellos no hay repostaje que auditar.
  const faltan = [], graves = [], malos = [];
  const campoDato = { matricula: 'matricula', repostaje: 'repostaje_at', importe: 'importe', litros: 'litros' };
  const dijo = campo => `${NOMBRE_DE[campo]} «${crudo[campo]}»`;
  for (const c of CAMPOS.filter(x => x.obligatorio)) {
    if (!(c.campo in crudo) || crudo[c.campo] === '') faltan.push(c.etiqueta);
    else if (datos[campoDato[c.campo]] == null) graves.push(dijo(c.campo));
  }
  if (datos.matricula && !(datos.matricula.length >= 4 && datos.matricula.length <= 10 && /\d/.test(datos.matricula))) {
    graves.push(dijo('matricula'));
    datos.matricula = null;
  }
  // Los litros y el importe, dentro de lo que puede ser un repostaje.
  const avisos = [];
  if (datos.litros != null && (!dentro(datos.litros, LIMITES.litros) || (datos.litros === 0 && datos.importe !== 0))) {
    graves.push(dijo('litros'));
    datos.litros = null;
  }
  if (datos.importe != null && !dentro(datos.importe, LIMITES.importe)) {
    graves.push(dijo('importe'));
    datos.importe = null;
  }
  if (datos.litros > 0 && datos.importe > 0 && !dentro(datos.importe / datos.litros, LIMITES.precioLitro)) {
    graves.push(`${dijo('litros')} con ${dijo('importe')} (salen ${(datos.importe / datos.litros).toFixed(3)} €/L)`);
    datos.litros = null;
    datos.importe = null;
  }
  for (const [campo, dato] of [['cargo', 'cargo_at'], ['recarga', 'importe_recarga'], ['devuelto', 'devuelto'], ['km', 'km']]) {
    if (crudo[campo] && datos[dato] == null) malos.push(dijo(campo));
  }
  for (const [campo, dato] of [['recarga', 'importe_recarga'], ['devuelto', 'devuelto']]) {
    if (datos[dato] != null && !dentro(datos[dato], LIMITES.otrosImportes)) { malos.push(dijo(campo)); datos[dato] = null; }
  }
  if (datos.ahorro != null && !dentro(datos.ahorro, LIMITES.otrosImportes)) { avisos.push(`El ahorro que dice el correo (${datos.ahorro} €) no puede ser: se deja vacío`); datos.ahorro = null; }
  if (datos.km != null && !dentro(datos.km, LIMITES.km)) {
    avisos.push(`KM «${crudo.km}» no es un cuentakilómetros posible: se deja vacío`);
    datos.km = null;
  }
  if (faltan.length || graves.length) {
    const partes = [];
    if (faltan.length) partes.push('No encuentro: ' + faltan.join(', '));
    if (graves.length) partes.push('No entiendo: ' + graves.join(', '));
    return { ok: false, motivo: partes.join('. '), faltan, datos, version: VERSION };
  }

  // Se entiende, pero hay cosas que mirar. No paran la lectura: se apuntan.
  avisos.unshift(...malos.map(m => `No entiendo ${m}: se deja vacío`));
  if (!datos.conductor_texto) avisos.push('El correo no dice el conductor');
  if (datos.litros === 0) avisos.push('0 litros y 0 €: el repostaje no se hizo (la recarga vuelve al saldo)');
  if (datos.litros > 0 && datos.importe === 0) avisos.push(`${datos.litros} litros por 0 €: ¿está bien el importe?`);
  if (datos.litros > 0 && datos.importe > 0) {
    const pl = datos.importe / datos.litros;
    if (pl < 0.8 || pl > 3) avisos.push(`El precio por litro sale a ${pl.toFixed(3)} €: ¿están bien los litros y el importe?`);
  }
  if (datos.litros > 150) avisos.push(`${datos.litros} litros es más de lo que cabe en un turismo`);
  if (datos.importe_recarga != null && datos.importe != null) {
    const resto = Math.round((datos.importe_recarga - datos.importe) * 100) / 100;
    if (datos.devuelto != null && Math.abs(resto - datos.devuelto) > 0.02) {
      avisos.push(`La recarga (${datos.importe_recarga} €) menos el repostaje (${datos.importe} €) no da lo devuelto (${datos.devuelto} €)`);
    } else if (datos.devuelto == null && resto > 0.02) {
      avisos.push(`Sobran ${resto.toFixed(2)} € de la recarga y el correo no dice que se devolvieran`);
    }
  }
  if (dia && datos.repostaje_at && dia !== datos.repostaje_at.slice(0, 10)) {
    avisos.push(`La frase dice el día ${dia.split('-').reverse().join('/')} y el repostaje, otro`);
  }
  if (!datos.estacion) avisos.push('El correo no dice la estación');

  return { ok: true, datos, avisos, version: VERSION };
}

module.exports = {
  codigo: 'ballenoil',
  nombre: 'Ballenoil',
  version: VERSION,
  esRemitente,
  asunto: ASUNTO,
  leer,
};
