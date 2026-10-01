// ============================================================
// INVENTARIO FINO: funciones exportadas que no llama nadie
// ============================================================
//   node scripts/inventario-exports.js
//
// ESTO NO BORRA NADA. Lista para que lo mire una persona.
//
// El nivel de fichero ya pasó (inventario-muerto.js). Esto baja un escalón:
// dentro de un fichero VIVO puede haber funciones exportadas que ya no llama
// nadie — el resto del módulo se usa, pero esa puerta concreta quedó tapiada.
//
// ES MÁS PELIGROSO QUE BORRAR UN FICHERO, y por eso el criterio es al revés de
// lo normal: ante la duda, NO se marca. Vale más que se escape un muerto a que
// se señale un vivo, porque quien lea la lista va a confiar en ella.
//
// Una función exportada se usa por su NOMBRE, y ese nombre puede aparecer de
// muchas formas que no son "importar el fichero y llamarla":
//
//   const { pasada } = require('./motor');   → destructuring
//   motor.pasada()                           → sobre el objeto del require
//   require('./motor').pasada()              → require y llamada en una línea
//   { pasada, padron } = require(...)         → varias a la vez
//
// Se buscan todas. Y si el nombre es demasiado común para fiarse —'crear',
// 'listar', 'estado'— se dice, en vez de darlo por muerto.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

// `modules/` ENTRA (01/10/2026). Sin él, toda función que solo llama un módulo
// mudado salía como muerta —`sesion.requiereGestorUsuarios`, que usa Usuarios;
// `historiaDelCoche`, que usa el ciclo de bloqueo— y los exports de los módulos
// no se miraban nunca. Es la misma avería que tuvo inventario-muerto.
const CARPETAS = ['services', 'routes', 'modules'];

function ficherosDe(dir) {
  const out = [];
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { out.push(...ficherosDe(rel)); continue; }
    if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

// scripts/ ENTRA en la busqueda de usos, aunque no se barra: un export que solo
// llama un test de scripts/ NO esta muerto, esta probado. Olvidar esto marcaba
// como muertas media docena de funciones de flota viva que cubre su suite.
const TODOS = ficherosDe('services').concat(ficherosDe('routes'), ficherosDe('modules'), ficherosDe('scripts'), ['app.js']);
const texto = new Map(TODOS.map(f => [f, fs.readFileSync(path.join(RAIZ, f), 'utf8')]));

// ── Qué exporta cada fichero ────────────────────────────────────────────────
// Solo se mira el `module.exports = { ... }` de objeto, que es como exporta
// TODO este código. Un `module.exports = function` o `= router` exporta una
// sola cosa sin nombre propio: ese es el fichero entero, y de eso ya se encarga
// el otro inventario.
function exportsDe(src) {
  const m = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return [];
  const nombres = [];
  // Cada entrada del objeto: `nombre,` o `nombre: otraCosa,` o `nombre: fn`.
  for (const e of m[1].matchAll(/(?:^|[,{])\s*([a-zA-Z_$][\w$]*)\s*(?::|,|$)/gm)) {
    nombres.push(e[1]);
  }
  return [...new Set(nombres)];
}

// ── Se llama a `nombre` desde FUERA de su propio fichero? ────────────────────
// Un nombre puede aparecer dentro de su propio módulo (se llama a sí mismo) y
// eso NO cuenta como uso externo: si nadie de fuera entra, la puerta está
// tapiada aunque por dentro se use.
function usadoFuera(nombre, propio) {
  // El destructuring NO siempre va pegado al require. Media docena de módulos
  // hacen `const x = require('./y'); const { fn } = x;` en dos pasos, y buscar
  // solo `{ fn } = require` los perdía — dando por muerto lo que estaba vivo.
  // Ya pasó con `cargarAuditoria`. Así que se busca el nombre entre llaves sin
  // exigir que el require esté al lado.
  const patrones = [
    new RegExp(`\\{[^}]*\\b${nombre}\\b[^}]*\\}\\s*=`),  // { fn } = (require, o la var del require)
    new RegExp(`\\.${nombre}\\b`),                       // .fn  (mod.fn())
    new RegExp(`['"\`]${nombre}['"\`]`),                 // 'fn' (dispatch dinámico)
  ];
  for (const f of TODOS) {
    if (f === propio) continue;
    const src = texto.get(f);
    if (patrones.some(p => p.test(src))) return f;
  }
  return null;
}

// Nombres tan comunes que buscarlos da igual: aparecen como método de mil cosas
// (`x.estado`, `arr.crear(...)`) y no se puede afirmar nada. Se listan aparte.
const AMBIGUOS = new Set([
  'crear', 'listar', 'estado', 'guardar', 'borrar', 'actualizar', 'obtener',
  'leer', 'buscar', 'validar', 'procesar', 'generar', 'enviar', 'marcar',
  'total', 'nombre', 'tipo', 'id', 'fecha', 'valor', 'datos',
]);

// ── Lo que se deja exportado A PROPÓSITO ────────────────────────────────────
// Sin esta lista, cada pasada vuelve a sacar lo mismo y hay que volver a
// decidir lo ya decidido. Cada entrada lleva el porqué; si un día alguien la
// usa o desaparece, la salida avisa de que sobra aquí. Revisado el 01/10/2026.
const A_PROPOSITO = {
  'services/repo/notificaciones.js': {
    generarDefectoMes: 'el motor del Hito 6 del convenio: se enchufa cuando la asesoría valide las plantillas',
  },
  'modules/RRHH/contratos.repo.js': {
    vigentesEnMes: 'convenio en construcción (Hito 2): lecturas para la pantalla de objetivos',
    objetivosDe: 'convenio en construcción (Hito 2): lecturas para la pantalla de objetivos',
  },
  'services/repo/fichajeTurno.js': {
    quienLlevaba: 'quién llevaba un coche según el fichaje; candidata para atribuir excesos ahora que todos abren turno',
  },
  'services/repo/vigencia.js': {
    vigenteDeVarias: 'biblioteca de vigencias: la consulta de muchos a la vez, para no volver al bucle',
    contarVigentes: 'biblioteca de vigencias: el contador para paneles',
  },
  'services/whatsapp.js': {
    enviarPlantillaNombre: 'adaptador: plantillas con parámetro con nombre, el formato nuevo de Meta',
  },
};

// Los que empiezan por `_` son GANCHOS DE PRUEBA: una función interna que se
// exporta con otro nombre para probarla sin base (`_situarAlta: situarAlta`).
// No son puertas del módulo y que nadie los use hoy no los hace muertos: se
// listan aparte para que no se confundan con lo que sí sobra.
const esGancho = nombre => nombre.startsWith('_');

// ── Se usa DENTRO de su propio fichero? ─────────────────────────────────────
// Esta es la pregunta que de verdad separa el grano de la paja. Una funcion
// exportada y usada por otra del mismo fichero NO esta muerta: esta viva y
// exportada de mas. Quitarle la linea del export es inofensivo; quitar la
// funcion rompe a quien la llama por dentro. Son dos cosas y no se mezclan.
//
// Se cuentan las apariciones del nombre en el fichero. La declaracion es una
// (function X, const X =, o la entrada X del module.exports). Si hay MAS de esas
// declaraciones, alguien lo usa dentro.
function usadoDentro(nombre, propio) {
  const src = texto.get(propio);
  const usos = (src.match(new RegExp(`\\b${nombre}\\b`, 'g')) || []).length;
  // Descontar la declaracion y la linea del module.exports.
  const declara = new RegExp(`(?:function|const|let|var)\\s+${nombre}\\b`).test(src);
  const base = (declara ? 1 : 0) + 1;   // declaracion (si la hay) + export
  return usos > base;
}

// ── Recorrido ────────────────────────────────────────────────────────────────
const muertos = [];        // ni dentro ni fuera: candidato de verdad
const sobreExport = [];    // vivo dentro, exportado de mas: quitar solo el export
const ambiguos = [];       // nombre demasiado comun para afirmar nada
const aProposito = [];     // decidido: se queda (A_PROPOSITO)
const ganchos = [];        // exportado para probar (`_nombre`)

for (const f of TODOS) {
  // Los routers exportan `router`, no funciones; los scripts no se barren (sí
  // cuentan como uso, arriba).
  if (f.startsWith('routes/') || f.startsWith('scripts/') || /\.controller\.js$/.test(f)) continue;
  const exps = exportsDe(texto.get(f));
  for (const nombre of exps) {
    if (usadoFuera(nombre, f)) continue;             // alguien de fuera lo usa: vivo
    if (esGancho(nombre)) { ganchos.push({ f, nombre }); continue; }
    if ((A_PROPOSITO[f] || {})[nombre]) { aProposito.push({ f, nombre, motivo: A_PROPOSITO[f][nombre] }); continue; }
    if (AMBIGUOS.has(nombre)) { ambiguos.push({ f, nombre }); continue; }
    (usadoDentro(nombre, f) ? sobreExport : muertos).push({ f, nombre });
  }
}

// ── Salida ──────────────────────────────────────────────────────────────────
console.log('\n═══ EXPORTS QUE NADIE LLAMA DESDE FUERA ═══');
console.log(`${TODOS.length} ficheros · se listan services/ y modules/ (no los controladores ni los scripts)\n`);

const porFichero = {};
for (const { f, nombre } of muertos) (porFichero[f] ||= []).push(nombre);

const ficheros = Object.keys(porFichero).sort();
if (!ficheros.length) {
  console.log('   Ningún export sin usar. Todo lo que se exporta, se llama.\n');
} else {
  console.log(`── SIN USO EXTERNO (${muertos.length} en ${ficheros.length} fichero(s)) ` + '─'.repeat(20));
  console.log('   Cada uno es una función exportada que nadie de fuera llama. Antes de');
  console.log('   quitarla, confirmar que no la llama una ruta por cadena ni un cron.\n');
  for (const f of ficheros) {
    console.log(`   ${f}`);
    console.log(`      ${porFichero[f].join(', ')}`);
  }
  console.log();
}

if (sobreExport.length) {
  console.log(`── VIVO, PERO EXPORTADO DE MÁS (${sobreExport.length}) ` + '─'.repeat(24));
  console.log('   Se usa dentro de su fichero pero nadie lo importa. NO es código muerto:');
  console.log('   basta quitar su nombre del module.exports, la función se queda. Prioridad');
  console.log('   baja — no molesta a nadie, solo estrecha la superficie pública.\n');
  const ps = {};
  for (const { f, nombre } of sobreExport) (ps[f] ||= []).push(nombre);
  for (const f of Object.keys(ps).sort()) console.log(`   ${f.padEnd(40)} ${ps[f].join(', ')}`);
  console.log();
}

if (ambiguos.length) {
  console.log(`── NOMBRE DEMASIADO COMÚN PARA DECIDIR (${ambiguos.length}) ` + '─'.repeat(18));
  console.log('   Su nombre aparece por todas partes como método de otras cosas, así que');
  console.log('   el detector no puede afirmar nada. Se miran a mano.\n');
  const pa = {};
  for (const { f, nombre } of ambiguos) (pa[f] ||= []).push(nombre);
  for (const f of Object.keys(pa).sort()) console.log(`   ${f.padEnd(40)} ${pa[f].join(', ')}`);
  console.log();
}

if (aProposito.length) {
  console.log(`── SE QUEDAN A PROPÓSITO (${aProposito.length}) ` + '─'.repeat(28));
  console.log('   Sin uso hoy, pero decidido que se quedan (A_PROPOSITO, arriba).\n');
  for (const { f, nombre, motivo } of aProposito) console.log(`   ${(f + ' ' + nombre).padEnd(58)} ${motivo}`);
  console.log();
}

// Lo que dice la lista y ya no es verdad: o alguien lo usa, o ya no existe.
const sobran = [];
for (const [f, nombres] of Object.entries(A_PROPOSITO)) {
  for (const nombre of Object.keys(nombres)) {
    if (!aProposito.some(x => x.f === f && x.nombre === nombre)) sobran.push(`${f} ${nombre}`);
  }
}
if (sobran.length) {
  console.log(`── SOBRAN EN A_PROPOSITO (${sobran.length}) ` + '─'.repeat(28));
  console.log('   Ya los usa alguien o ya no se exportan: quitarlos de la lista.\n');
  sobran.forEach(x => console.log(`   ${x}`));
  console.log();
}

if (ganchos.length) {
  const pg = {};
  for (const { f, nombre } of ganchos) (pg[f] ||= []).push(nombre);
  console.log(`── GANCHOS DE PRUEBA (${ganchos.length}) ` + '─'.repeat(32));
  console.log('   Exportados con `_` para probar sin base. No son puertas del módulo.\n');
  for (const f of Object.keys(pg).sort()) console.log(`   ${f.padEnd(40)} ${pg[f].join(', ')}`);
  console.log();
}

console.log('Esto NO ha borrado nada. Es una lista para mirar.');
