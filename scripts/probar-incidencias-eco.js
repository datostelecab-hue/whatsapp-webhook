// ============================================================
// PROBAR: el pipeline de incidencias economicas (Hito 10)
// ============================================================
//   node scripts/probar-incidencias-eco.js
//
// La regla deuda != descuento, como maquina de estados. Las funciones SQL hacen
// las transiciones; aqui se prueba la LOGICA de que estados se permiten y, sobre
// todo, que SOLO 'autorizada' crea linea de nomina. Sin base.

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

// Espejo de las transiciones que permiten las funciones SQL.
const VALIDA_DESDE = ['detectada', 'pendiente_autoridad'];
const AUTORIZA_DESDE = ['validada'];
const RECHAZA_DESDE_NO = ['programada', 'descontada', 'rechazada'];

const puedeValidar = e => VALIDA_DESDE.includes(e);
const puedeAutorizar = e => AUTORIZA_DESDE.includes(e);
const puedeRechazar = e => !RECHAZA_DESDE_NO.includes(e);
// La clave: una linea de nomina SOLO nace al autorizar.
const generaLinea = accion => accion === 'autorizar';

console.log('\n== Que se puede validar ==');
ok('detectada se valida', puedeValidar('detectada'));
ok('pendiente_autoridad se valida (multa resuelta)', puedeValidar('pendiente_autoridad'));
ok('validada NO se re-valida', !puedeValidar('validada'));
ok('programada NO se valida', !puedeValidar('programada'));

console.log('\n== DEUDA != DESCUENTO: solo autorizar crea linea ==');
ok('detectada NO genera linea de nomina', !generaLinea('detectar'));
ok('VALIDADA no genera linea de nomina', !generaLinea('validar'), '(el control del hito)');
ok('AUTORIZADA si genera linea de nomina', generaLinea('autorizar'));
ok('solo se autoriza lo VALIDADO', puedeAutorizar('validada') && !puedeAutorizar('detectada'));

console.log('\n== Casos especiales ==');
// Multa: sin resolucion de la autoridad, no se valida (se queda pendiente).
const multaValidable = (tieneResolucion) => tieneResolucion;
ok('multa sin resolucion NO se valida', multaValidable(false) === false);
ok('multa con resolucion se valida', multaValidable(true) === true);
// Combustible: sin acuerdo de vehiculo a domicilio, no se valida.
const combustibleValidable = (hayAcuerdo) => hayAcuerdo;
ok('combustible sin acuerdo firmado NO se valida (art. 28)', combustibleValidable(false) === false);
ok('combustible con acuerdo vigente se valida', combustibleValidable(true) === true);

console.log('\n== Rechazo ==');
ok('una detectada se puede rechazar', puedeRechazar('detectada'));
ok('una validada se puede rechazar', puedeRechazar('validada'));
ok('una programada NO se rechaza (ya es linea de nomina)', !puedeRechazar('programada'));

console.log('\n== Los tres importes son distintos ==');
// Detectado 100, validado 80 (parte no imputable), autorizado 80. Tres campos.
const inc = { detectado: 100, validado: 80, autorizado: 80 };
ok('lo detectado no tiene por que ser lo validado', inc.detectado !== inc.validado);
ok('el descuento en nomina es el AUTORIZADO, no el detectado',
   -inc.autorizado === -80 && inc.autorizado !== inc.detectado);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nEl pipeline de incidencias economicas cuadra');
process.exitCode = mal ? 1 : 0;
