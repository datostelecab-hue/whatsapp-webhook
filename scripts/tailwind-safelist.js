// ============================================================
// LAS CLASES QUE SE MONTAN EN TIEMPO DE EJECUCIÓN
// ============================================================
// El CSS compilado solo lleva las clases cuyo nombre COMPLETO está escrito en
// el código (tailwind.config.js lo explica). Los ayudantes de la casa pintan
// con un TONO que llega como variable y montan la clase con trozos:
//
//   listado.js         Listado.fmt.etiqueta(texto, tono)   bg-…/15 · text · border-…/30
//                      kpis { tono }                        text
//   dialogo.js         TONOS de abrir/aviso/confirmar       bg-…/15 · text · bg-…/10 ·
//                                                           border-…/40 · hover:bg-…/20
//   ticketera.ejs      boton(texto, accion, tono)           border-…/40 · bg-…/10 · text ·
//                                                           hover:bg-…/20
//   migraciones.ejs y  aviso(texto, tipo)                   border-…/40 · bg-…/5 · text
//   ticketera.ejs
//   callCenter.ejs     el tono de cada cluster              bg · bg-…/10 · bg-…/20 · text ·
//                                                           border-…/30 · border-…/50
//   planificadorV2.ejs el tono del estado del coche         bg-…/15 · text · border-…/30 ·
//                                                           hover:bg-…/25
//
// Con la CDN «Play» funcionaban porque compilaba mirando la pantalla. Compilado,
// `bg-telecab-${tono}/15` no genera nada y esa insignia sale sin color, sin
// error ninguno. Por eso aquí van TODAS las formas con TODOS los tonos, no solo
// las combinaciones de hoy: el día que alguien pase un tono nuevo a uno de
// estos ayudantes, tiene que salir pintado.
//
// Auditado el 03/11/2026: 121 construcciones con trozos en 38 ficheros; de sus
// 139 clases, 20 no estaban escritas enteras en ningún sitio (las insignias de
// Bloqueo de motor y Vehículos, los botones de la Ticketera, las píldoras del
// Call Center…). Las demás se montan desde mapas con el nombre entero
// (`TONO` de Control, los anchos de Dialogo…), y esas no necesitan estar aquí.
//
// UNA CLASE NUEVA MONTADA CON TROZOS: o se escribe entera en un mapa, o su forma
// se añade abajo.

// Los tonos con los que pintan los ayudantes (los de tailwind.config.js menos
// las superficies: dark, card, card2 y border no se pasan como tono).
const TONOS = ['gold', 'gold-soft', 'red', 'green', 'warn', 'violet', 'azul', 'text', 'muted'];

// Cada forma, con `{t}` donde va el tono.
const FORMAS = [
  'text-telecab-{t}',
  'bg-telecab-{t}',
  'bg-telecab-{t}/5',
  'bg-telecab-{t}/10',
  'bg-telecab-{t}/15',
  'bg-telecab-{t}/20',
  'border-telecab-{t}/30',
  'border-telecab-{t}/40',
  'border-telecab-{t}/50',
  'hover:bg-telecab-{t}/20',
  'hover:bg-telecab-{t}/25',
];

module.exports = FORMAS.flatMap(f => TONOS.map(t => f.replace('{t}', t)));
