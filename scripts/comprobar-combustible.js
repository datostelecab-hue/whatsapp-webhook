// ============================================================
// COMBUSTIBLE — los repostajes que llegan por correo, las reglas
// ============================================================
// El lector de Ballenoil (22/10/2026) con los tres correos de ejemplo —el de
// PRAT DE LLOBREGAT (EL), con «devuelto» y punto decimal; el de COSLADA, sin
// «devuelto»; y el de MONTMELÓ, de una tarjeta PROVISIONAL— y uno reenviado por
// la oficina desde Outlook. Con NOMBRES INVENTADOS: los de verdad no entran en el
// repositorio. Y además: los números con coma o con punto, lo que falta o no se
// entiende (se guarda como «no se pudo leer», con el motivo), el correo sin
// saltos de línea, quién es de qué proveedor (y que los demás no se tocan), de
// quién es la tarjeta, si coincide con BOLT, que el buzón se abre en solo
// lectura sin marcar nada, y la pasada entera: no duplica, un correo raro no
// para a los demás y si no puede entrar lo dice.
//
// Y lo que salió en la revisión del 22/10/2026: el correo entero en una línea
// (con la frase y el pie), los valores que la base no aceptaría (litros
// diminutos, km imposibles), la fecha sin hora, `<br style>`, los correos de
// Ballenoil que no son repostajes, la firma DKIM (con el corte de líneas largas
// de sendmail), el correo que no se puede bajar, el oyente de 'error' de
// imapflow, el tope de la lectura, Spam, la red cuando la base rechaza un
// correo, la contraseña que no se reintenta sola, la pasada colgada, volver a
// casar el coche y la sede, y BOLT que no llega en tres días.
//
//   node scripts/comprobar-combustible.js
//
// No toca la base, ni el buzón, ni BOLT, ni el DNS: todo se sustituye.
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { Readable } = require('stream');

const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// ── Los correos de ejemplo ─────────────────────────────────────────────────
// Con la forma del de verdad: el text/plain es HTML, y los saltos van de cuatro
// maneras (<br />, <br/>, <br / > y </br>).
function htmlBallenoil(x) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head>
<title>Ballenoil - Resumen Repostaje</title></head><body><center><table><tr><td align="center">
<img alt="logo" src="http://www.ballenoil.es/images/logo_ballenoil.jpg" > <h3>Resumen repostaje DNI & GO</h3>
</td></tr><tr><td></br>Apreciado Cliente,<br /><br/> Adjuntamos los datos del repostaje realizado el día ${x.dia} en la estación de ${x.estacion}.<p>` +
  (x.ahorro ? `<br/>En este repostaje ha ahorrado ${x.ahorro}€, comparado con los precios de la competencia.<p>` : '') +
  `<br/><h3>Detalle del repostaje</h3>Conductor: ${x.conductor}<br />Matrícula: ${x.matricula}<br />KM: ${x.km}<br />` +
  `Fecha de cargo: ${x.cargo}<br />Importe total recarga: ${x.recarga}€<br />Fecha repostaje: ${x.repostaje}<br />` +
  `Importe repostaje: ${x.importe}€<br / >` + (x.devuelto ? `Importe devuelto a su saldo de recarga: ${x.devuelto}€<br />` : '') +
  `Litros: ${x.litros}L<br / >Carburante: ${x.carburante || 'Sin plomo'}<br / ><br / ><h3>Club Ballenoil</h3>` +
  `<p>Gracias por realizar sus repostajes en la Red de Estaciones de Servicio Ballenoil.<br />Aviso de confidencialidad</p></td></tr></table></body></html>`;
}
const asuntoDe = (dia, estacion) => `Adjuntamos los datos del repostaje realizado el día ${dia} en la estación de ${estacion}. con DNI & GO⛽️`;
const correoBallenoil = (x, extra = {}) => ({
  de: 'noreply@ballenoil.es', asunto: asuntoDe(x.dia, x.estacion),
  partes: [{ tipo: 'text/plain', contenido: htmlBallenoil(x) }, { tipo: 'text/html', contenido: htmlBallenoil(x) }], ...extra,
});

const PRAT = { dia: '22/10/2026', estacion: 'PRAT DE LLOBREGAT (EL)', ahorro: '4,66', conductor: 'Rubén Ortega Lafuente',
  matricula: '9107LWS', km: '123842', cargo: '22/10/2026 06:50', recarga: '50,00', repostaje: '22/10/2026 06:49',
  importe: '47,43', devuelto: '2.57', litros: '27,432' };
const COSLADA = { dia: '22/10/2026', estacion: 'COSLADA', ahorro: '5,27', conductor: ' Iker Montoya Salas',
  matricula: '8997LDK', km: '270500', cargo: '22/10/2026 12:57', recarga: '40,00', repostaje: '22/10/2026 12:57',
  importe: '40,00', litros: '24,405' };
const MONTMELO = { dia: '22/10/2026', estacion: 'MONTMELÓ', ahorro: '0,22', conductor: 'PROVISIONAL 54',
  matricula: '8477LTR', km: '158964', cargo: '22/10/2026 14:46', recarga: '80,00', repostaje: '22/10/2026 14:45',
  importe: '57,92', devuelto: '22.08', litros: '36,223' };

// Uno reenviado por la oficina desde Outlook: text/plain de verdad, con la
// cabecera del reenvío delante.
const REENVIADO = {
  de: 'admin@telecab.es',
  asunto: 'RV: ' + asuntoDe('21/10/2026', 'ALCOBENDAS II'),
  partes: [{ tipo: 'text/plain', contenido: [
    'De: Ballenoil ⛽️ <noreply@ballenoil.es> ',
    'Enviado el: miércoles, 21 de octubre de 2026 13:14',
    'Para: admin@telecab.es',
    'Asunto: ' + asuntoDe('21/10/2026', 'ALCOBENDAS II'),
    '', 'Resumen repostaje DNI & GO', '', 'Apreciado Cliente,', '',
    'Adjuntamos los datos del repostaje realizado el día 21/10/2026 en la estación de ALCOBENDAS II.', '',
    'En este repostaje ha ahorrado 6,00€, comparado con los precios de la competencia.', '', '',
    'Detalle del repostaje', '', '',
    'Conductor: [TALLER NORTE]', 'Matrícula: 7043LJN', 'KM: 58783', 'Fecha de cargo: 21/10/2026 12:54',
    'Importe total recarga: 200,00€', 'Fecha repostaje: 21/10/2026 12:53', 'Importe repostaje: 50,01€',
    'Importe devuelto a su saldo de recarga: 149.99€', 'Litros: 27,799L', 'Carburante: Diesel Excellent', '', '',
    'Club Ballenoil'].join('\r\n') }],
};

(async () => {
  // ════════════════════════════════════════════════════════════════════════
  // 1. LAS PIEZAS: números, fechas, texto
  // ════════════════════════════════════════════════════════════════════════
  const C = require('../modules/Combustible/lector.comun');
  igual('Importes con coma, con punto y sin decimales',
    ['47,43€', '2.57€', '33€', '31.1€', '149.99€', '1.234,56 €', '1,234.56', '27,432L', 'abc'].map(C.numero),
    [47.43, 2.57, 33, 31.1, 149.99, 1234.56, 1234.56, 27.432, null]);
  igual('KM con o sin puntos', ['123842', '270.500', ' 20 ', 'x'].map(C.entero), [123842, 270500, 20, null]);
  igual('Fechas de Madrid sin zona; las que no existen no, y sin hora tampoco (no son las 00:00)',
    ['22/10/2026 06:49', '1/2/2026 9:05', '31/02/2026 10:00', '22/10/2026 25:00', 'mañana', '22/10/2026'].map(C.fechaHora),
    ['2026-10-22T06:49', '2026-02-01T09:05', null, null, null, null]);
  igual('El día solo, con `fecha`', ['22/10/2026', '31/02/2026'].map(C.fecha), ['2026-10-22', null]);
  igual('El HTML de Ballenoil a texto, con sus cuatro saltos de línea',
    C.htmlATexto('<td></br>Hola<br />Matrícula: 1<br / >KM: 2<br/>Litros: 3 &euro;&nbsp;&aacute;</td>').split('\n'),
    ['Hola', 'Matrícula: 1', 'KM: 2', 'Litros: 3 € á']);
  igual('<br> con atributos también salta, y una etiqueta borrada no pega las palabras',
    C.htmlATexto('Conductor: <span>Iker</span>Matrícula: 1<br style="x">KM: 2<BR clear=all>Litros: 3').split('\n'),
    ['Conductor: Iker Matrícula: 1', 'KM: 2', 'Litros: 3']);
  igual('El corte de líneas largas de sendmail («!», salto y espacio) se deshace antes de leer',
    C.textosDe([{ tipo: 'text/plain', contenido: 'Importe repostaje: 40,0!\r\n 0€ y comerciale!\r\n s' }]), ['Importe repostaje: 40,00€ y comerciales']);

  // ════════════════════════════════════════════════════════════════════════
  // 2. EL LECTOR DE BALLENOIL, con los tres correos de ejemplo
  // ════════════════════════════════════════════════════════════════════════
  const L = require('../modules/Combustible/combustible.lector');
  const leer = c => L.leerCorreo(c);

  const prat = leer(correoBallenoil(PRAT));
  igual('PRAT: se lee entero, con el «devuelto» de punto decimal y la estación sin el punto de la frase',
    [prat.ok, prat.proveedor, prat.datos], [true, 'ballenoil', {
      estacion: 'PRAT DE LLOBREGAT (EL)', conductor_texto: 'Rubén Ortega Lafuente', matricula: '9107LWS', km: 123842,
      cargo_at: '2026-10-22T06:50', repostaje_at: '2026-10-22T06:49', importe_recarga: 50, importe: 47.43,
      devuelto: 2.57, litros: 27.432, carburante: 'Sin plomo', ahorro: 4.66 }]);
  igual('PRAT: sin avisos (50 − 47,43 = 2,57)', prat.avisos, []);

  const coslada = leer(correoBallenoil(COSLADA));
  igual('COSLADA: sin «devuelto» (es opcional), el nombre sin el espacio de delante',
    [coslada.ok, coslada.datos.devuelto, coslada.datos.conductor_texto, coslada.datos.importe, coslada.datos.litros, coslada.avisos],
    [true, null, 'Iker Montoya Salas', 40, 24.405, []]);

  const montmelo = leer(correoBallenoil(MONTMELO));
  igual('MONTMELÓ: la tilde de la estación y la tarjeta PROVISIONAL tal cual',
    [montmelo.ok, montmelo.datos.estacion, montmelo.datos.conductor_texto, montmelo.datos.devuelto],
    [true, 'MONTMELÓ', 'PROVISIONAL 54', 22.08]);

  const reenv = leer(REENVIADO);
  igual('Reenviado por la oficina: es de Ballenoil, dice quién lo reenvió, y la cabecera de Outlook no se cuela',
    [reenv.ok, reenv.proveedor, reenv.remitente, reenv.reenviadoPor, reenv.datos.estacion, reenv.datos.conductor_texto,
     reenv.datos.carburante, reenv.datos.importe_recarga, reenv.datos.devuelto],
    [true, 'ballenoil', 'noreply@ballenoil.es', 'admin@telecab.es', 'ALCOBENDAS II', '[TALLER NORTE]', 'Diesel Excellent', 200, 149.99]);

  // Lo que puede cambiar en el correo y no debe romperlo.
  const enUnaLinea = { de: 'noreply@ballenoil.es', asunto: asuntoDe('22/10/2026', 'COSLADA'),
    partes: [{ tipo: 'text/plain', contenido: 'Detalle del repostaje Conductor: Iker Montoya Salas MATRÍCULA : 8997-LDK KM: 270500 ' +
      'Fecha de cargo: 22/10/2026 12:57 Importe total recarga: 40,00€ Fecha repostaje: 22/10/2026 12:57 ' +
      'Importe repostaje: 40,00€ Litros: 24,405L Carburante: Sin plomo' }] };
  const r1 = leer(enUnaLinea);
  igual('Sin saltos de línea y con la etiqueta en mayúsculas: cada dato se corta en la etiqueta siguiente',
    [r1.ok, r1.datos.conductor_texto, r1.datos.matricula, r1.datos.litros, r1.datos.estacion],
    [true, 'Iker Montoya Salas', '8997LDK', 24.405, 'COSLADA']);

  const sinLitros = correoBallenoil({ ...COSLADA, litros: '' });
  sinLitros.partes = sinLitros.partes.map(p => ({ ...p, contenido: p.contenido.replace(/Litros: L<br \/ >/, '') }));
  const r2 = leer(sinLitros);
  igual('Sin litros no es un repostaje leído: «no se pudo leer», con lo que faltó', [r2.ok, r2.motivo], [false, 'No encuentro: Litros']);
  const malo = leer(correoBallenoil({ ...COSLADA, importe: 'cuarenta' }));
  igual('Un importe que no es un número: dice cuál y qué decía', [malo.ok, malo.motivo], [false, 'No entiendo: Importe repostaje «cuarenta€»']);
  const raro = leer(correoBallenoil({ ...PRAT, devuelto: '9.99' }));
  igual('Si la recarga menos el repostaje no da lo devuelto, se lee pero se avisa', [raro.ok, raro.avisos.length], [true, 1]);
  const sinFrase = correoBallenoil(COSLADA);
  sinFrase.partes = sinFrase.partes.map(p => ({ ...p, contenido: p.contenido.replace(/Adjuntamos los datos[^<]*\./, '') }));
  igual('Sin la frase de la estación, se saca del asunto', leer(sinFrase).datos.estacion, 'COSLADA');

  // EL CORREO ENTERO EN UNA LÍNEA, con la frase delante y el pie detrás: la
  // estación no puede llevarse la frase siguiente (no cabría en su columna y la
  // base rechazaría el correo) ni el carburante el pie.
  const PIE = 'Club Ballenoil Nuevas promociones y descuentos directos por repostar en Ballenoil .Descúbrelo Aquí . ' +
    'Gracias por realizar sus repostajes en la Red de Estaciones de Servicio Ballenoil. Aviso de confidencialidad Este mensaje y sus adjuntos contienen información confidencial y reservada dirigida exclusivamente a su destinatario.';
  const lineaEntera = frase => ({ de: 'noreply@ballenoil.es', asunto: asuntoDe('22/10/2026', 'COSLADA'),
    partes: [{ tipo: 'text/plain', contenido: 'Resumen repostaje DNI & GO Apreciado Cliente, Adjuntamos los datos del repostaje realizado el día 22/10/2026 ' +
      `en la estación de ${frase} En este repostaje ha ahorrado 5,27€, comparado con los precios de la competencia. Detalle del repostaje ` +
      'Conductor: Iker Montoya Salas Matrícula: 8997LDK KM: 270500 Fecha de cargo: 22/10/2026 12:57 Importe total recarga: 40,00€ ' +
      'Fecha repostaje: 22/10/2026 12:57 Importe repostaje: 40,00€ Litros: 24,405L Carburante: Sin plomo ' + PIE }] });
  const r3 = leer(lineaEntera('COSLADA.'));
  igual('Todo en una línea, con la frase y el pie: la estación y el carburante, sin lo que se les pega',
    [r3.ok, r3.datos.estacion, r3.datos.carburante, r3.datos.ahorro, r3.datos.litros, r3.avisos], [true, 'COSLADA', 'Sin plomo', 5.27, 24.405, []]);
  igual('…también sin asunto: la frase se corta en el punto que va antes de «En este repostaje»',
    (x => [x.ok, x.datos.estacion])(require('../modules/Combustible/lector.ballenoil').leer({ texto: lineaEntera('PRAT DE LLOBREGAT (EL).').partes[0].contenido, asunto: '' })),
    [true, 'PRAT DE LLOBREGAT (EL)']);
  const r4 = leer(lineaEntera('COSLADA. EN ESTE PUNTO TODO EN MAYÚSCULAS Y SIN CORTE POSIBLE NI PUNTO SEGUIDO DE MINÚSCULA, MÁS LARGO QUE OCHENTA LETRAS.'));
  igual('…y si la frase no se deja cortar, manda el asunto (que acaba en «con DNI»)', r4.datos.estacion, 'COSLADA');

  // LO QUE LA BASE NO ACEPTARÍA no se le manda: los obligatorios dejan el correo
  // «sin leer» con el porqué; los demás se dejan vacíos con un aviso.
  const conLitros = (l, imp) => leer(correoBallenoil({ ...COSLADA, litros: l, importe: imp || COSLADA.importe }));
  igual('Unos litros diminutos (el precio por litro saldría a miles): «no se pudo leer», con los dos valores',
    (x => [x.ok, /^No entiendo: Litros «0,01L» con Importe repostaje «40,00€»/.test(x.motivo)])(conLitros('0,01')), [false, true]);
  igual('Más litros de los que caben en un depósito: «no se pudo leer»', conLitros('900').ok, false);
  igual('0 litros por 40 €: «no se pudo leer»', conLitros('0').ok, false);
  const anulado = leer(correoBallenoil({ ...COSLADA, litros: '0', importe: '0,00', devuelto: '40.00' }));
  igual('0 litros y 0 €, con la recarga devuelta: un repostaje anulado, leído con su aviso',
    [anulado.ok, anulado.datos.litros, anulado.avisos.some(a => /anulado|no se hizo/.test(a))], [true, 0, true]);
  const kmLoco = leer(correoBallenoil({ ...COSLADA, km: '3000000000' }));
  igual('Unos km imposibles (no caben en la columna): se dejan vacíos con un aviso',
    [kmLoco.ok, kmLoco.datos.km, kmLoco.avisos.some(a => /^KM «3000000000»/.test(a))], [true, null, true]);
  const sinHora = leer(correoBallenoil({ ...COSLADA, repostaje: '22/10/2026', cargo: '22/10/2026' }));
  igual('La fecha del repostaje sin hora no se lee como las 00:00: «no se pudo leer»',
    [sinHora.ok, sinHora.motivo], [false, 'No entiendo: Fecha repostaje «22/10/2026»']);
  const brRaro = correoBallenoil(COSLADA);
  brRaro.partes = brRaro.partes.map(p => ({ ...p, contenido: p.contenido.replace(/<br \/>/g, '<br style="x">') }));
  igual('Con <br style=…> en vez de <br />, se lee igual', (x => [x.ok, x.datos.matricula, x.datos.conductor_texto])(leer(brRaro)),
    [true, '8997LDK', 'Iker Montoya Salas']);

  // ════════════════════════════════════════════════════════════════════════
  // 3. DE QUIÉN ES CADA CORREO (y los demás no se tocan)
  // ════════════════════════════════════════════════════════════════════════
  const quien = s => { const q = L.deQuien(s); return q ? [q.proveedor.codigo, q.reenviado] : null; };
  igual('Por el remitente: Ballenoil, Petroprix (preparado) y nadie más',
    [quien({ de: 'noreply@ballenoil.es', asunto: asuntoDe('22/10/2026', 'COSLADA') }), quien({ de: 'repostajes@petroprix.com' }),
     quien({ de: 'aldatara@msplus.es', asunto: 'Acceso a la API' }), quien({ de: 'admin@telecab.es', asunto: 'Gestión de Dondominio' })],
    [['ballenoil', false], ['petroprix', false], null, null]);
  igual('De Ballenoil pero sin el asunto de un repostaje (una promoción del Club): no se baja, aunque se sabe que es suyo',
    [quien({ de: 'club@ballenoil.es', asunto: 'Nuevas promociones del Club Ballenoil' }), (L.esDelProveedor('club@ballenoil.es') || {}).codigo],
    [null, 'ballenoil']);
  igual('De la casa con el asunto de Ballenoil: candidato a reenvío', quien({ de: 'admin@telecab.es', asunto: REENVIADO.asunto }), ['ballenoil', true]);
  igual('…pero si dentro no aparece la dirección de Ballenoil, no es suyo',
    leer({ ...REENVIADO, partes: [{ tipo: 'text/plain', contenido: 'Mirad los datos del repostaje realizado ayer' }] }), null);
  const petro = leer({ de: 'repostajes@petroprix.com', asunto: 'Su repostaje', partes: [{ tipo: 'text/plain', contenido: 'Litros: 30' }] });
  igual('Petroprix: no se sabe leer todavía, se guarda como «no se pudo leer» con su texto',
    [petro.ok, petro.proveedor, /Petroprix/.test(petro.motivo), petro.texto], [false, 'petroprix', true, 'Litros: 30']);
  // Un correo que no se entiende enseña TODAS sus partes: si el text/plain es
  // un «use un cliente HTML», el dato está en la otra.
  const relleno = leer({ de: 'noreply@ballenoil.es', asunto: asuntoDe('22/10/2026', 'COSLADA'), partes: [
    { tipo: 'text/plain', contenido: 'Para ver este correo, use un cliente HTML' },
    { tipo: 'text/html', contenido: '<p>Detalle del repostaje</p><p>Matrícula: 8997LDK</p>' }] });
  igual('Sin entender: el texto guardado lleva las dos partes, no solo la primera',
    [relleno.ok, /cliente HTML/.test(relleno.texto), /8997LDK/.test(relleno.texto)], [false, true, true]);
  // Releer desde las partes tal cual llegaron, con el código de hoy.
  const rel = L.releer({ proveedor: 'ballenoil', partes: correoBallenoil(PRAT).partes, texto: 'texto viejo que ya no sirve', asunto: asuntoDe(PRAT.dia, PRAT.estacion) });
  igual('Releer: desde las partes guardadas, no desde el texto ya convertido', [rel.ok, rel.datos.importe, rel.datos.devuelto], [true, 47.43, 2.57]);
  igual('…y sin partes guardadas, desde el texto', L.releer({ proveedor: 'ballenoil', texto: C.htmlATexto(htmlBallenoil(COSLADA)) }).ok, true);

  // ¿ES DE VERDAD DE BALLENOIL? Por su firma DKIM.
  const firma = (r, f) => { const x = L.firmaDe(r, f); return [x.verificado, x.detalle.split(':')[0].split(',')[0]]; };
  igual('La firma: válida, de otro dominio, que no vale, sin poder comprobarla, y reenviada por la casa',
    [firma({ proveedor: 'ballenoil' }, [{ dominio: 'ballenoil.es', resultado: 'valida' }]),
     firma({ proveedor: 'ballenoil' }, [{ dominio: 'malo.com', resultado: 'valida' }])[0],
     firma({ proveedor: 'ballenoil' }, [{ dominio: 'ballenoil.es', resultado: 'no_valida', motivo: 'el cuerpo no es el que se firmó' }])[0],
     firma({ proveedor: 'ballenoil' }, [{ dominio: 'ballenoil.es', resultado: 'no_se_pudo', motivo: 'DNS' }])[0],
     firma({ proveedor: 'ballenoil' }, null)[0],
     firma({ proveedor: 'ballenoil', reenviadoPor: 'admin@telecab.es' }, [])[0]],
    [[true, 'Firma DKIM de ballenoil.es'], false, false, null, null, null]);

  // ════════════════════════════════════════════════════════════════════════
  // 4. DE QUIÉN ES LA TARJETA, Y SI ES QUIEN LLEVABA EL COCHE EN BOLT
  // ════════════════════════════════════════════════════════════════════════
  const K = require('../modules/Combustible/combustible.casar');
  igual('La tarjeta: persona, provisional, provisional con nota y del taller',
    ['Rubén Ortega Lafuente', 'PROVISIONAL 54', 'PROVISIONAL 52  [apoyo en Barcelona]', '[TALLER NORTE]'].map(K.tarjeta),
    [{ nombre: 'Rubén Ortega Lafuente', provisional: false, nota: null }, { nombre: null, provisional: true, nota: null },
     { nombre: null, provisional: true, nota: 'apoyo en Barcelona' }, { nombre: null, provisional: false, nota: 'TALLER NORTE' }]);

  const CANDIDATOS = [
    { conductorId: 10, cuentaBolt: null, nombre: 'RUBEN ORTEGA LAFUENTE', sede: null },
    { conductorId: 10, cuentaBolt: 'u-10', nombre: 'Rubén Ortega', sede: 'madrid' },
    { conductorId: 11, cuentaBolt: null, nombre: 'Iker Fernando Montoya Salas', sede: null },
    { conductorId: 20, cuentaBolt: null, nombre: 'Ana García López', sede: null },
    { conductorId: 21, cuentaBolt: null, nombre: 'Ana García Pérez', sede: null },
    { conductorId: null, cuentaBolt: 'b-30', nombre: 'Laia Puig Soler', sede: 'barcelona' },
    { conductorId: 31, cuentaBolt: null, nombre: 'Laia Puig Soler', sede: null },
  ];
  const casa = (n, o) => { const x = K.casarNombre(n, CANDIDATOS, o); return [x.como, x.conductorId, x.cuentaBolt]; };
  igual('Exacto sin tildes ni mayúsculas, y de paso su cuenta de BOLT', casa('Rubén Ortega Lafuente'), ['exacto', 10, 'u-10']);
  igual('Parecido: la tarjeta lleva menos nombres que la ficha', casa('Iker Montoya Salas'), ['parecido', 11, null]);
  igual('Si vale para dos personas, no se enlaza con ninguna', casa('Ana García'), ['ambiguo', null, null]);
  igual('Dos con el mismo nombre en dos sedes: manda la sede del coche', casa('Laia Puig Soler', { sede: 'barcelona' }), ['exacto', null, 'b-30']);
  igual('…y sin sede, ambiguo', casa('Laia Puig Soler'), ['ambiguo', null, null]);
  igual('Una sola palabra no basta para casar', casa('Rubén'), ['nadie', null, null]);

  igual('¿Coincide con BOLT? Por la ficha, por la cuenta, por el nombre, y no',
    [K.coincide({ conductorId: 10 }, { conductorId: 10 }),
     K.coincide({ cuentaBolt: 'b-30', nombre: 'Laia Puig Soler' }, { uuid: 'b-30', nombre: 'Laia Puig' }),
     K.coincide({ nombre: 'Iker Montoya Salas' }, { uuid: 'x', nombre: 'Iker Fernando Montoya Salas' }),
     K.coincide({ conductorId: 10, nombre: 'Rubén Ortega Lafuente' }, { conductorId: 11, nombre: 'Iker Montoya' }),
     K.coincide(null, { conductorId: 11 })],
    [true, true, true, false, null]);

  // Un «no_leido» no sabe si la tarjeta es provisional: el INSERT no puede
  // mandar NULL a una columna NOT NULL (pasó al probarlo contra la base local).
  const { _valorDe } = require('../modules/Combustible/combustible.repo');
  igual('Guardar sin saber la tarjeta ni la versión: FALSE y 0, nunca NULL', [_valorDe({}, 'tarjeta_provisional'), _valorDe({}, 'lector_version'), _valorDe({}, 'km')], [false, 0, null]);

  // ════════════════════════════════════════════════════════════════════════
  // 4b. LA FIRMA DKIM (services/dkim), sin DNS: la clave va en la caché
  // ════════════════════════════════════════════════════════════════════════
  const dkim = require('../services/dkim');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const MailComposer = require('nodemailer/lib/mail-composer');
  const Firmador = require('nodemailer/lib/dkim');
  const html = '<p>Detalle del repostaje</p>Matrícula: 8997LDK<br />Litros: 24,405L<br />' + 'Aviso legal muy largo '.repeat(60);
  const crudo = await new Promise((ok, ko) => new MailComposer({ from: 'Ballenoil <noreply@ballenoil.es>', to: 'datos@telecab.es',
    subject: asuntoDe('22/10/2026', 'COSLADA'), html }).compile().build((e, x) => (e ? ko(e) : ok(x))));
  const firmado = await new Promise((ok, ko) => {
    const t = []; const s = new Firmador({ domainName: 'ballenoil.es', keySelector: 'authsmtp', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }).sign(crudo);
    s.on('data', x => t.push(x)); s.on('end', () => ok(Buffer.concat(t))); s.on('error', ko);
  });
  const cache = () => new Map([['authsmtp._domainkey.ballenoil.es', Promise.resolve(publicKey)]]);
  const res = async raw => (await dkim.comprobar(raw, { cache: cache() })).map(f => [f.dominio, f.resultado]);
  const texto = firmado.toString('latin1');
  // Una línea partida como hace sendmail DESPUÉS de firmar: «!», salto y espacio.
  const partida = texto.replace('Detalle del repostaje', 'Detalle!\r\n  del repostaje');
  if (partida === texto) throw new Error('La prueba de la línea partida no encontró dónde partir');
  igual('DKIM: la firma buena vale; con el cuerpo tocado o el asunto cambiado, no; con la línea larga partida por sendmail, sí',
    [await res(firmado), await res(Buffer.from(texto.replace('8997LDK', '0000AAA'), 'latin1')),
     await res(Buffer.from(texto.replace(/^Subject: /m, 'Subject: RE: '), 'latin1')), await res(Buffer.from(partida, 'latin1')),
     await res(Buffer.from('From: x@y.es\r\n\r\nhola'))],
    [[['ballenoil.es', 'valida']], [['ballenoil.es', 'no_valida']], [['ballenoil.es', 'no_valida']], [['ballenoil.es', 'valida']], []]);

  // ════════════════════════════════════════════════════════════════════════
  // 5. EL BUZÓN SE ABRE EN SOLO LECTURA (services/correo.leerCorreos)
  // ════════════════════════════════════════════════════════════════════════
  const llamadas = [];
  let BUZON_FALSO = [
    { carpeta: 'INBOX', uid: 7, env: { messageId: '<a@ballenoil>', from: [{ address: 'NoReply@Ballenoil.es' }], subject: 'Repostaje 1' }, cuerpo: 'uno' },
    { carpeta: 'INBOX', uid: 8, env: { messageId: '<b@msplus>', from: [{ address: 'aldatara@msplus.es' }], subject: 'Otra cosa' }, cuerpo: 'privado' },
  ];
  let imap = null, carpetasQueHay = ['INBOX'], sinContenido = null, alBuscar = null;
  class ImapFalso extends EventEmitter {
    constructor(o) { super(); imap = this; llamadas.push(['crear', o.host, o.auth.user]); this.usable = true; this.esperando = []; }
    async connect() { llamadas.push(['connect']); }
    async getMailboxLock(c, o) {
      llamadas.push(['lock', c, o]);
      if (!carpetasQueHay.includes(c)) throw Object.assign(new Error('Command failed'), { responseText: `Mailbox doesn't exist: ${c}` });
      this.carpeta = c; this.mailbox = { uidValidity: c === 'INBOX' ? 99n : 55n };
      return { release: () => llamadas.push(['release', c]) };
    }
    async search(q) {
      llamadas.push(['search', !!q.since]);
      if (alBuscar) return alBuscar(this);
      return BUZON_FALSO.filter(m => m.carpeta === this.carpeta).map(m => m.uid);
    }
    async *fetch() {
      for (const m of BUZON_FALSO.filter(x => x.carpeta === this.carpeta)) yield { uid: m.uid, envelope: m.env, internalDate: new Date('2026-10-22T11:13:27Z'),
        bodyStructure: { childNodes: [{ part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }] } };
    }
    async download(uid, parte) {
      llamadas.push(['download', this.carpeta, uid, parte === undefined ? 'entero' : parte]);
      if (sinContenido === uid) return {};
      const m = BUZON_FALSO.find(x => String(x.uid) === uid && x.carpeta === this.carpeta);
      return { content: Readable.from([Buffer.from(parte === undefined ? 'From: x\r\n\r\n' + m.cuerpo : m.cuerpo + '-' + parte)]) };
    }
    close() { llamadas.push(['close']); this.usable = false; this.esperando.splice(0).forEach(ko => ko(Object.assign(new Error('Connection not available'), { code: 'NoConnection' }))); }
    async logout() { llamadas.push(['logout']); }
  }
  ['messageFlagsAdd', 'messageFlagsSet', 'messageFlagsRemove', 'messageMove', 'messageDelete', 'append', 'mailboxOpen']
    .forEach(n => { ImapFalso.prototype[n] = async () => { llamadas.push(['PROHIBIDO', n]); }; });
  const rImap = require.resolve('imapflow');
  require.cache[rImap] = { id: rImap, filename: rImap, loaded: true, exports: { ImapFlow: ImapFalso } };
  const CORREO_REAL = require('../services/correo');
  const elegidos = [];
  const lr = await CORREO_REAL.leerCorreos({ user: 'datos@telecab.es', pass: 'x', host: 'imap.ejemplo', desde: new Date('2026-10-15T12:00:00Z'),
    elegir: s => { elegidos.push(s.de); return /ballenoil/.test(s.de); } });
  igual('Se abre con EXAMINE (readOnly) y no se llama a nada que marque, mueva o borre',
    [llamadas.find(l => l[0] === 'lock'), llamadas.filter(l => l[0] === 'PROHIBIDO')], [['lock', 'INBOX', { readOnly: true }], []]);
  igual('Solo se baja el cuerpo del elegido; del otro, solo el sobre',
    [elegidos, llamadas.filter(l => l[0] === 'download').map(l => l[2]), lr.correos.map(c => c.partes.map(p => p.contenido))],
    [['noreply@ballenoil.es', 'aldatara@msplus.es'], ['7', '7'], [['uno-1', 'uno-2']]]);
  igual('Suelta la carpeta y cierra la sesión', [llamadas.some(l => l[0] === 'release'), llamadas[llamadas.length - 1][0], lr.uidValidity, lr.vistos], [true, 'logout', 99, 2]);
  igual('Escucha el evento «error» de imapflow (sin oyente, un corte ya conectado tiraría el proceso)', imap.listenerCount('error') >= 1, true);

  // INBOX y Spam en la misma conexión, cada correo con SU carpeta (los UID son
  // por carpeta); una carpeta que no existe no para la lectura. Y la firma.
  BUZON_FALSO.push({ carpeta: 'Spam', uid: 7, env: { messageId: '<s@ballenoil>', from: [{ address: 'noreply@ballenoil.es' }], subject: 'Repostaje 2' }, cuerpo: 'spam' });
  carpetasQueHay = ['INBOX', 'Spam'];
  llamadas.length = 0;
  const lr2 = await CORREO_REAL.leerCorreos({ user: 'u', pass: 'x', host: 'h', carpetas: ['INBOX', 'Spam', 'Junk'], firma: true, elegir: s => /ballenoil/.test(s.de) });
  igual('INBOX y Spam: el mismo UID en las dos son dos correos, cada uno con su carpeta y su UIDVALIDITY; «Junk» no existe y se apunta',
    [lr2.correos.map(c => [c.carpeta, c.uid, c.uidValidity, c.partes[0].contenido]), lr2.carpetas.map(k => [k.carpeta, k.vistos == null ? 'error' : k.vistos]),
     llamadas.filter(l => l[0] === 'lock').every(l => l[2] && l[2].readOnly === true)],
    [[['INBOX', 7, 99, 'uno-1'], ['Spam', 7, 55, 'spam-1']], [['INBOX', 2], ['Spam', 1], ['Junk', 'error']], true]);
  igual('Con `firma`, cada elegido trae su comprobación DKIM (sin firma: lista vacía)', lr2.correos.map(c => c.firmas), [[], []]);

  // Un correo que no se puede bajar (se movió mientras se leía): vuelve con su
  // error y los demás se bajan igual.
  BUZON_FALSO = [
    { carpeta: 'INBOX', uid: 21, env: { messageId: '<m1@ballenoil>', from: [{ address: 'noreply@ballenoil.es' }], subject: 'R' }, cuerpo: 'movido' },
    { carpeta: 'INBOX', uid: 22, env: { messageId: '<m2@ballenoil>', from: [{ address: 'noreply@ballenoil.es' }], subject: 'R' }, cuerpo: 'bueno' },
  ];
  sinContenido = '21';
  const lr3 = await CORREO_REAL.leerCorreos({ user: 'u', pass: 'x', host: 'h', elegir: () => true });
  sinContenido = null;
  igual('Un correo sin contenido (movido o borrado a medias) no tumba la lectura: vuelve con su error y el siguiente entra',
    lr3.correos.map(c => [c.uid, !!c.error, c.partes.length]), [[21, true, 0], [22, false, 2]]);

  // El servidor corta ya conectado: imapflow EMITE el error de verdad y la
  // promesa pendiente falla con un «Connection not available» que no dice nada.
  alBuscar = cli => { cli.emit('error', Object.assign(new Error('Socket timeout'), { code: 'ETIMEOUT' }));
    throw Object.assign(new Error('Connection not available'), { code: 'NoConnection' }); };
  const corte = await CORREO_REAL.leerCorreos({ user: 'u', pass: 'x', host: 'h' }).then(() => null, e => e);
  igual('Si el servidor corta, el error que sale es el de verdad (ETIMEOUT), no «Connection not available»', [corte && corte.code, corte && corte.message], ['ETIMEOUT', 'Socket timeout']);
  // Un servidor que contesta a goteo no salta el tiempo de socket: el tope corta.
  alBuscar = cli => new Promise((ok, ko) => cli.esperando.push(ko));
  const tope = await CORREO_REAL.leerCorreos({ user: 'u', pass: 'x', host: 'h', topeMs: 30 }).then(() => null, e => e);
  alBuscar = null;
  igual('El tope de la lectura cierra la conexión y lo dice', [tope && tope.code, llamadas.some(l => l[0] === 'close')], ['ETOPE', true]);

  // ════════════════════════════════════════════════════════════════════════
  // 6. LA PASADA ENTERA (combustible.service.leerBuzon), con dobles
  // ════════════════════════════════════════════════════════════════════════
  const BD = { filas: [], lecturas: [], bolt: {}, sinBolt: 0, listas: [] };
  let buzon = { vistos: 0, correos: [] }, errorImap = null, revienta = null, datoMalo = null, colgar = null;
  let usuario = { email: 'datos@telecab.es', pass_correo: 'v1:x' };
  const llamadasBuzon = [];
  const MODO = { ACTIVO: false };
  sustituir('services/correo.js', { leerCorreos: async o => {
    llamadasBuzon.push(o);
    // Una pasada que se queda colgada en el servidor (la primera que llegue).
    if (colgar) { const c = colgar; colgar = null; await c; }
    if (errorImap) throw errorImap;
    const todos = buzon.correos.map(x => ({ carpeta: 'INBOX', uidValidity: 5, ...x }));
    return { uidValidity: 5, vistos: todos.length, correos: todos.filter(x => o.elegir(x)),
      carpetas: [{ carpeta: 'INBOX', vistos: todos.length }, { carpeta: 'Spam', vistos: 0 }] };
  } });
  sustituir('services/configApp.js', { leerConfig: async () => ({}) });
  sustituir('services/modoPruebas.js', MODO);
  sustituir('modules/Usuarios/usuarios.service.js', {
    buscarUsuario: async e => (usuario && e === usuario.email ? usuario : null),
    tienePassCorreo: u => !!(u && u.pass_correo),
    descifrarPassCorreo: u => (u && /^v1:x/.test(u.pass_correo) ? 'secreto' : null),
  });
  const mismo = (a, b) => a.proveedor === b.proveedor && a.matricula === b.matricula && a.repostaje_at === b.repostaje_at && a.importe === b.importe;
  const comoBD = l => (l ? { ...l, error_tipo: l.errorTipo || null, pass_huella: l.passHuella || null } : null);
  const COCHES = { '9107LWS': { vehiculoId: 83, sede: 'barcelona' }, '8997LDK': { vehiculoId: 80, sede: 'madrid' },
    '8477LTR': { vehiculoId: 109, sede: 'barcelona' } };
  sustituir('modules/Combustible/combustible.repo.js', {
    empezarLectura: async o => { BD.lecturas.push({ ...o, id: BD.lecturas.length + 1, empezada_at: new Date() }); return BD.lecturas.length; },
    cerrarLectura: async (id, c) => { Object.assign(BD.lecturas[id - 1], c, { cerrada: true }); },
    ultimaLectura: async () => ({ ultima: comoBD(BD.lecturas.filter(l => l.cerrada).slice(-1)[0]),
      ultimaBuena: comoBD(BD.lecturas.filter(l => l.cerrada && !l.error).slice(-1)[0]) }),
    lecturas: async () => BD.lecturas,
    purgarLecturas: async () => 0,
    yaGuardados: async () => ({ ids: new Set(BD.filas.map(f => f.mensaje_id)), uids: new Set() }),
    claveUid: (c, v, u) => `${c}:${v}:${u}`,
    guardar: async f => {
      if (revienta && f.mensaje_id === revienta) throw new Error('la base dijo que no');
      // La base rechaza el valor (un texto que no cabe): lo de verdad lo daría PostgreSQL con su código.
      if (datoMalo && f.mensaje_id === datoMalo && f.estado !== 'no_leido') {
        throw Object.assign(new Error('value too long for type character varying(160)'), { code: '22001' });
      }
      if (BD.filas.some(x => x.mensaje_id === f.mensaje_id)) return { yaEstaba: true };
      const igualA = f.estado === 'leido' ? BD.filas.find(x => x.estado === 'leido' && mismo(x, f)) : null;
      const fila = { ...f, id: BD.filas.length + 1, estado: igualA ? 'repetido' : f.estado, repetido_de: igualA ? igualA.id : null };
      BD.filas.push(fila);
      return { id: fila.id, estado: fila.estado };
    },
    releido: async () => ({ estado: 'no_leido' }),
    paraReleer: async () => [],
    paraRecasar: async () => BD.filas.filter(f => f.estado === 'leido' && (!f.vehiculo_id || !f.sede || f.bolt_estado === 'sin_coche'))
      .map(f => ({ id: f.id, matricula: f.matricula, conductor_texto: f.conductor_texto, vehiculo_id: f.vehiculo_id, sede: f.sede,
        conductor_id: f.conductor_id, conductor_cuenta_bolt: f.conductor_cuenta_bolt, conductor_como: f.conductor_como, bolt_estado: f.bolt_estado })),
    recasado: async (id, f) => { Object.assign(BD.filas[id - 1], { vehiculo_id: f.vehiculo_id, sede: f.sede, conductor_id: f.conductor_id,
      conductor_cuenta_bolt: f.conductor_cuenta_bolt, conductor_como: f.conductor_como }); },
    cocheDe: async mat => COCHES[mat] || { vehiculoId: null, sede: null },
    candidatosNombre: async () => [
      { conductorId: null, cuentaBolt: 'b-prat', nombre: 'Rubén Ortega Lafuente', sede: 'barcelona' },
      { conductorId: 80, cuentaBolt: null, nombre: 'Iker Montoya Salas', sede: null },
      { conductorId: null, cuentaBolt: 'b-laia', nombre: 'Laia Puig Soler', sede: 'barcelona' },
    ],
    frescuraBolt: async () => ({ madrid: '2026-10-22T11:30:00Z', otras: '2026-10-22T12:40:00Z' }),
    // Madrid: el COSLADA (12:57 de Madrid = 10:57 UTC) lo llevaba otro, conectado.
    boltMadrid: async () => ({ enBolt: true, repostajeAt: '2026-10-22T10:57:00Z', uuid: 'u-otro', conductorId: 99,
      nombre: 'Otro Conductor Distinto', situacion: 'espera', conectado: true, segundos: 0 }),
    // Barcelona: el PRAT lo llevaba quien dice la tarjeta; el MONTMELÓ es posterior a lo que sabe BOLT; el 5369LHJ no está en BOLT.
    boltOtraSede: async id => (BD.filas[id - 1].matricula === '9107LWS'
      ? { enBolt: true, repostajeAt: '2026-10-22T04:49:00Z', uuid: 'b-prat', conductorId: null, nombre: 'Rubén Ortega', situacion: 'espera', conectado: false, segundos: 1800 }
      : BD.filas[id - 1].matricula === '5369LHJ' ? { enBolt: false, repostajeAt: '2026-10-22T10:00:00Z' }
        : { enBolt: true, repostajeAt: '2026-10-22T12:45:00Z', uuid: null, conductorId: null, nombre: null, situacion: null, conectado: false, segundos: 0 }),
    ponerBolt: async (id, b) => { BD.bolt[id] = b; BD.filas[id - 1].bolt_estado = b.estado; },
    paraMirarBolt: async () => [],
    cerrarSinBolt: async () => { BD.sinBolt++; return 0; },
    lista: async o => { BD.listas.push(o); return []; },
  });
  const S = require('../modules/Combustible/combustible.service');
  process.env.CRED_KEY = process.env.CRED_KEY || 'clave-de-pruebas';

  // Cada correo directo de Ballenoil, con su firma DKIM válida salvo que se diga otra cosa.
  const FIRMA_BUENA = [{ dominio: 'ballenoil.es', selector: 'authsmtp', resultado: 'valida', motivo: 'firma DKIM de ballenoil.es' }];
  const m = (id, c, extra = {}) => ({ ...c, messageId: id, uid: Number(id.replace(/\D/g, '')) || 1, fecha: new Date('2026-10-22T13:13:00Z'),
    firmas: FIRMA_BUENA, ...extra });
  const OTRO = { messageId: '<x@msplus>', uid: 3, de: 'aldatara@msplus.es', asunto: 'API de coches.net', partes: [{ tipo: 'text/plain', contenido: 'privado' }] };
  const correoMalo = m('<4@ballenoil>', correoBallenoil({ ...COSLADA, importe: 'cuarenta' }));
  buzon = { correos: [m('<1@ballenoil>', correoBallenoil(PRAT)), m('<2@ballenoil>', correoBallenoil(COSLADA)), OTRO,
    m('<3@ballenoil>', correoBallenoil(MONTMELO)), correoMalo] };
  const p1 = await S.leerBuzon({ origen: 'cron' });
  igual('Primera pasada: 4 de Ballenoil (el de otro remitente ni se baja), 3 leídos y 1 sin entender',
    [p1.ok, p1.vistos, p1.candidatos, p1.nuevos, p1.noLeidos, p1.yaEstaban, p1.fallos, BD.filas.length],
    [true, 5, 4, 3, 1, 0, 0, 4]);
  igual('La primera vez se mira desde el 01/10/2026, en INBOX y Spam, con la firma', [BD.lecturas[0].desde, llamadasBuzon[0].carpetas, llamadasBuzon[0].firma],
    ['2026-10-01', ['INBOX', 'Spam'], true]);
  const porMat = mat => BD.filas.find(f => f.matricula === mat && f.estado !== 'no_leido');
  igual('Cada uno con su coche, su sede y la persona de la tarjeta',
    [['9107LWS', '8997LDK', '8477LTR'].map(x => { const f = porMat(x); return [f.vehiculo_id, f.sede, f.conductor_id, f.conductor_cuenta_bolt, f.conductor_como, f.tarjeta_provisional]; })],
    [[[83, 'barcelona', null, 'b-prat', 'exacto', false], [80, 'madrid', 80, null, 'exacto', false], [109, 'barcelona', null, null, null, true]]]);
  igual('Se guardan la carpeta, la firma verificada y las partes tal cual llegaron (para releerlo)',
    (f => [f.buzon_carpeta, f.remitente_verificado, /ballenoil\.es/.test(f.firma_detalle), f.cuerpo_partes.length, f.cuerpo_partes[0].tipo, f.avisos])(porMat('8997LDK')),
    ['INBOX', true, true, 2, 'text/plain', null]);
  igual('El que no se entiende se guarda con su motivo y su texto, no se pierde',
    (f => [f.estado, f.motivo, !!f.cuerpo_texto, f.proveedor])(BD.filas.find(f => f.mensaje_id === '<4@ballenoil>')),
    ['no_leido', 'No entiendo: Importe repostaje «cuarenta€»', true, 'ballenoil']);
  igual('BOLT: el PRAT lo llevaba quien dice la tarjeta (lo dejó hace 30 min); el MONTMELÓ aún no lo sabe BOLT',
    [BD.bolt[porMat('9107LWS').id], BD.bolt[porMat('8477LTR').id].estado],
    [{ estado: 'ultimo', uuid: 'b-prat', conductorId: null, nombre: 'Rubén Ortega', situacion: 'espera', antiguedadMin: 30, coincide: true }, 'pendiente']);
  igual('BOLT: el COSLADA lo llevaba otra persona, conectada: no coincide con la tarjeta',
    (b => [b.estado, b.nombre, b.coincide])(BD.bolt[porMat('8997LDK').id]), ['conectado', 'Otro Conductor Distinto', false]);
  igual('Los que esperaron tres días a BOLT se cierran en cada pasada', BD.sinBolt, 1);

  // La segunda pasada no duplica, y si alguien de la oficina reenvía uno que ya
  // estaba, queda «repetido». Una promoción de Ballenoil no es un repostaje:
  // no se baja, pero se cuenta.
  const reenviadoPrat = m('<9@telecab>', { de: 'admin@telecab.es', asunto: 'RV: ' + asuntoDe(PRAT.dia, PRAT.estacion),
    partes: [{ tipo: 'text/plain', contenido: 'De: Ballenoil <noreply@ballenoil.es>\n' + C.htmlATexto(htmlBallenoil(PRAT)) }] }, { firmas: [] });
  const promo = { messageId: '<promo@ballenoil>', uid: 12, de: 'club@ballenoil.es', asunto: 'Nuevas promociones del Club Ballenoil',
    partes: [{ tipo: 'text/plain', contenido: 'Descuentos' }] };
  buzon.correos.push(reenviadoPrat, promo);
  const p2 = await S.leerBuzon({ origen: 'manual', usuarioId: 7 });
  igual('Segunda pasada: lo que ya estaba ni se baja, y el reenviado del mismo repostaje queda «repetido»',
    [p2.ok, p2.yaEstaban, p2.nuevos, p2.repetidos, BD.filas.length, BD.filas[BD.filas.length - 1].estado, BD.filas[BD.filas.length - 1].repetido_de],
    [true, 4, 0, 1, 5, 'repetido', porMat('9107LWS').id]);
  igual('El reenviado no se puede verificar (null, sin aviso): la firma del original se pierde al reenviar',
    (f => [f.remitente_verificado, /Reenviado por admin@telecab\.es/.test(f.firma_detalle)])(BD.filas[BD.filas.length - 1]), [null, true]);
  igual('La promoción de Ballenoil: no es candidata ni fila, pero queda contada y apuntada en la pasada',
    [p2.otros, p2.candidatos, BD.lecturas[1].detalle.otros.map(o => o.de), BD.filas.some(f => f.mensaje_id === '<promo@ballenoil>')],
    [1, 5, ['club@ballenoil.es'], false]);
  const haceUnaSemana = new Date(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()) + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
  igual('La segunda ya no empieza en octubre: una semana atrás (la última buena es de hoy)', BD.lecturas[1].desde, haceUnaSemana);

  // Un correo que revienta al guardarse no para a los demás. Uno que no se pudo
  // bajar, tampoco, y no se guarda: la pasada siguiente lo vuelve a intentar.
  const nuevoA = m('<10@ballenoil>', correoBallenoil({ ...COSLADA, repostaje: '23/10/2026 08:00', cargo: '23/10/2026 08:01' }));
  const nuevoB = m('<11@ballenoil>', correoBallenoil({ ...COSLADA, repostaje: '23/10/2026 09:00', cargo: '23/10/2026 09:01' }));
  const sinBajar = m('<13@ballenoil>', correoBallenoil({ ...COSLADA, repostaje: '23/10/2026 10:00', cargo: '23/10/2026 10:01' }),
    { partes: [], error: 'el servidor no dio la parte 1 (¿se movió o se borró mientras se leía?)' });
  buzon.correos.push(nuevoA, nuevoB, sinBajar);
  revienta = '<10@ballenoil>';
  const p3 = await S.leerBuzon({ origen: 'cron' });
  igual('Un correo que revienta y otro que no se pudo bajar se cuentan y se apuntan; el de en medio entra igual',
    [p3.ok, p3.fallos, p3.nuevos, BD.lecturas[2].detalle.fallos.length, BD.filas.some(f => f.mensaje_id === '<13@ballenoil>')], [true, 2, 1, 2, false]);
  revienta = null;
  buzon.correos = buzon.correos.filter(x => x !== sinBajar).concat([{ ...sinBajar, error: undefined, partes: correoBallenoil({ ...COSLADA,
    repostaje: '23/10/2026 10:00', cargo: '23/10/2026 10:01' }).partes }]);

  // LA BASE RECHAZA LO LEÍDO (un texto que no cabe, un número que desborda):
  // el correo se guarda igual, como «no se pudo leer» y con el porqué. Sin esa
  // fila se volvería a bajar y a fallar en cada pasada hasta perderse. Y uno sin
  // la firma de Ballenoil se lee, pero con su aviso.
  datoMalo = '<13@ballenoil>';
  const sinFirma = m('<14@ballenoil>', correoBallenoil({ ...COSLADA, repostaje: '23/10/2026 11:00', cargo: '23/10/2026 11:01' }), { firmas: [] });
  buzon.correos.push(sinFirma);
  const p3b = await S.leerBuzon({ origen: 'cron' });
  datoMalo = null;
  const rechazado = BD.filas.find(f => f.mensaje_id === '<13@ballenoil>') || {};
  igual('La base rechaza lo leído: queda su fila «no_leido» con el porqué (sin cifras), no un fallo',
    [p3b.fallos, p3b.noLeidos, rechazado.estado, /^La base no lo acepta: value too long/.test(rechazado.motivo), rechazado.importe, !!rechazado.cuerpo_partes],
    [0, 1, 'no_leido', true, undefined, true]);
  igual('…y la pasada siguiente ya no lo vuelve a bajar', (p => p.candidatos - p.yaEstaban)(await S.leerBuzon({ origen: 'cron' })), 0);
  igual('Sin la firma DKIM de Ballenoil: se lee, pero con el aviso de que el remitente no está verificado',
    (f => [f.estado, f.remitente_verificado, (f.avisos || []).some(a => /^El remitente no está verificado/.test(a))])(BD.filas.find(f => f.mensaje_id === '<14@ballenoil>')),
    ['leido', false, true]);

  // UN COCHE QUE NADIE CONOCE: la sede, la de la cuenta de BOLT de la tarjeta.
  // Y cuando se da de alta en Vehículos, la pasada siguiente lo casa.
  const laia = m('<15@ballenoil>', correoBallenoil({ ...COSLADA, estacion: 'HOSPITALET DE LLOBREGAT (L´)', conductor: 'Laia Puig Soler',
    matricula: '5369LHJ', repostaje: '23/10/2026 12:00', cargo: '23/10/2026 12:01' }));
  buzon.correos.push(laia);
  await S.leerBuzon({ origen: 'cron' });
  const fLaia = () => BD.filas.find(f => f.mensaje_id === '<15@ballenoil>');
  igual('Coche desconocido: la sede sale de la cuenta de BOLT de la tarjeta (Barcelona), y BOLT se mira en Barcelona',
    [fLaia().vehiculo_id, fLaia().sede, fLaia().conductor_cuenta_bolt, fLaia().bolt_estado], [null, 'barcelona', 'b-laia', 'sin_coche']);
  COCHES['5369LHJ'] = { vehiculoId: 200, sede: 'barcelona' };
  const p5 = await S.leerBuzon({ origen: 'cron' });
  igual('Se da de alta en Vehículos: la pasada siguiente le pone el coche (y vuelve a mirar BOLT)',
    [p5.recasados, fLaia().vehiculo_id, fLaia().sede], [1, 200, 'barcelona']);
  igual('…y la siguiente ya no cambia nada', (await S.leerBuzon({ origen: 'cron' })).recasados, 0);

  // Si no se puede entrar, se dice por qué, queda escrito y no lanza. Y la
  // contraseña que no vale no se reintenta sola cada diez minutos.
  const errores = [];
  errorImap = Object.assign(new Error('Command failed'), { authenticationFailed: true });
  const p4 = await S.leerBuzon({ origen: 'cron' });
  errores.push(p4.error);
  const filasAntes = BD.lecturas.length, intentosAntes = llamadasBuzon.length;
  const warnPausa = console.warn; const avisosPausa = [];
  console.warn = (...x) => avisosPausa.push(x.join(' '));
  const pausa1 = await S.leerBuzon({ origen: 'cron' }), pausa2 = await S.leerBuzon({ origen: 'cron' });
  console.warn = warnPausa;
  igual('Contraseña rechazada: el cron no vuelve a intentarlo con la misma (ni deja fila, ni llama al servidor) y lo avisa una vez',
    [pausa1.saltada, pausa1.pausada, BD.lecturas.length - filasAntes, llamadasBuzon.length - intentosAntes, avisosPausa.filter(x => /no lo vuelve a intentar/.test(x)).length],
    [true, true, 0, 0, 1]);
  igual('…la pantalla lo sabe (para decirlo en la nota)', (await S.estadoLectura()).pausada, true);
  const aMano = await S.leerBuzon({ origen: 'manual', usuarioId: 7 });
  igual('…el botón sí lo intenta', [aMano.ok, llamadasBuzon.length - intentosAntes], [false, 1]);
  usuario = { email: 'datos@telecab.es', pass_correo: 'v1:x-guardada-otra-vez' };
  const nueva = await S.leerBuzon({ origen: 'cron' });
  igual('…y en cuanto se guarda otra contraseña en la ficha, el cron vuelve a intentarlo', [nueva.saltada, llamadasBuzon.length - intentosAntes], [undefined, 2]);
  igual('El error de contraseña queda escrito con su tipo y la huella de la contraseña cifrada (nunca la contraseña)',
    (l => [l.errorTipo, /^[0-9a-f]{16}$/.test(l.passHuella), JSON.stringify(l).includes('secreto')])(BD.lecturas[BD.lecturas.length - 1]), ['contrasena', true, false]);
  errorImap = null;
  usuario = { email: 'datos@telecab.es', pass_correo: 'v1:otra' };
  errores.push((await S.leerBuzon({ origen: 'cron' })).error);
  usuario = null;
  errores.push((await S.leerBuzon({ origen: 'cron' })).error);
  igual('Sin entrar: la contraseña que no vale, la que no se descifra y el buzón sin cuenta, cada uno con lo que hay que arreglar',
    errores.map(e => (/no acepta la contraseña/.test(e) ? 'contraseña' : /descifrar/.test(e) ? 'CRED_KEY' : /no es la cuenta de nadie/.test(e) ? 'sin cuenta' : e)),
    ['contraseña', 'CRED_KEY', 'sin cuenta']);
  igual('…y cada pasada fallida queda escrita con su error y su tipo', BD.lecturas.slice(-2).map(l => [!!l.error && l.cerrada, l.errorTipo]), [[true, 'config'], [true, 'config']]);
  usuario = { email: 'datos@telecab.es', pass_correo: 'v1:x' };

  // Dos a la vez: la segunda se salta (y el cron lo dice en el log).
  const warn0 = console.warn; const avisosSalto = [];
  console.warn = (...x) => avisosSalto.push(x.join(' '));
  const [a, b] = await Promise.all([S.leerBuzon({ origen: 'cron' }), S.leerBuzon({ origen: 'cron' })]);
  console.warn = warn0;
  igual('Dos pasadas a la vez: la segunda se salta y lo dice', [a.ok, b.saltada === true, avisosSalto.some(x => /se salta esta lectura/.test(x))], [true, true, true]);

  // UNA PASADA QUE NO VUELVE NUNCA no deja el buzón sin leer para siempre:
  // pasados unos minutos se da por muerta, se cierra su fila y se entra.
  let soltar; colgar = new Promise(r => { soltar = r; });
  const colgada = S.leerBuzon({ origen: 'cron' });
  await new Promise(r => setTimeout(r, 20));
  const idColgada = BD.lecturas.length;
  const ahora = Date.now; const warn1 = console.warn;
  console.warn = () => {};
  const antesDelTope = await S.leerBuzon({ origen: 'manual' });
  Date.now = () => ahora() + 9 * 60 * 1000;
  const trasElTope = await S.leerBuzon({ origen: 'manual' });
  Date.now = ahora;
  soltar();
  await colgada;
  console.warn = warn1;
  igual('Pasada colgada: antes del tope se salta; después se da por muerta, su fila se cierra con el error y la nueva lee',
    [antesDelTope.saltada, trasElTope.ok, BD.lecturas[idColgada - 1].errorTipo, /se dio por muerta/.test(BD.lecturas[idColgada - 1].error)],
    [true, true, 'tope', true]);
  igual('…y cuando la muerta acaba, no pisa su fila', BD.lecturas[idColgada - 1].errorTipo, 'tope');

  // Un día que no existe no llega a PostgreSQL: se usa el de por defecto.
  await S.lista({ desde: '2026-02-31', hasta: '2026-10-22' });
  igual('La lista con un día que no existe (31/02) usa el de por defecto en vez de mandar el error de la base',
    BD.listas[BD.listas.length - 1], { desde: '2026-09-22', hasta: '2026-10-22' });

  // Desplegado antes de aplicar db/212: lo dice una vez, no cada diez minutos.
  const DOBLE = require('../modules/Combustible/combustible.repo');
  const empezar = DOBLE.empezarLectura;
  DOBLE.empezarLectura = async () => { throw Object.assign(new Error('relation "repostaje_lectura" does not exist'), { code: '42P01' }); };
  const warn = console.warn; const avisos = [];
  console.warn = (...x) => avisos.push(x.join(' '));
  const sin1 = await S.leerBuzon({ origen: 'cron' }), sin2 = await S.leerBuzon({ origen: 'cron' });
  console.warn = warn;
  DOBLE.empezarLectura = empezar;
  igual('Sin db/212: no lanza, dice qué falta y avisa una sola vez',
    [sin1.ok, sin1.error.includes('db/212'), sin2.ok, avisos.filter(x => x.includes('db/212')).length], [false, true, false, 1]);

  // En modo pruebas lee igual (es solo lectura) y lo dice en el log.
  MODO.ACTIVO = true;
  const log = console.log; const dicho = [];
  console.log = (...x) => { dicho.push(x.join(' ')); };
  await S.leerBuzon({ origen: 'manual' });
  console.log = log;
  igual('En modo pruebas se lee el buzón real y el log lo dice', dicho.some(l => /\[PRUEBAS\].*solo lectura/.test(l)), true);
  igual('…la pasada queda marcada como de pruebas, y la pantalla sabe que no se lee sola',
    [BD.lecturas[BD.lecturas.length - 1].modoPruebas, (await S.estadoLectura()).automatica], [true, false]);
  MODO.ACTIVO = false;

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
