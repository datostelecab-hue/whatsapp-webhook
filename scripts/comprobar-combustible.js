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
  // BOLT de mentira, uno a uno; el servicio pregunta en lote (db/215), así que
  // las versiones «De» los juntan.
  const boltM = async () => ({ enBolt: true, repostajeAt: '2026-10-22T10:57:00Z', uuid: 'u-otro', conductorId: 99,
    nombre: 'Otro Conductor Distinto', situacion: 'espera', conectado: true, segundos: 0 });
  const boltO = async id => (BD.filas[id - 1].matricula === '9107LWS'
    ? { enBolt: true, repostajeAt: '2026-10-22T04:49:00Z', uuid: 'b-prat', conductorId: null, nombre: 'Rubén Ortega', situacion: 'espera', conectado: false, segundos: 1800 }
    : BD.filas[id - 1].matricula === '5369LHJ' ? { enBolt: false, repostajeAt: '2026-10-22T10:00:00Z' }
      : { enBolt: true, repostajeAt: '2026-10-22T12:45:00Z', uuid: null, conductorId: null, nombre: null, situacion: null, conectado: false, segundos: 0 });
  const enLote = f => async ids => new Map(await Promise.all(ids.map(async id => [Number(id), await f(id)])));
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
    boltMadrid: boltM, boltMadridDe: enLote(boltM),
    // Barcelona: el PRAT lo llevaba quien dice la tarjeta; el MONTMELÓ es posterior a lo que sabe BOLT; el 5369LHJ no está en BOLT.
    boltOtraSede: boltO, boltOtraSedeDe: enLote(boltO),
    ponerBolt: async (id, b) => { BD.bolt[id] = b; BD.filas[id - 1].bolt_estado = b.estado; },
    ponerBoltDe: async filas => { for (const { id, ...b } of filas) { BD.bolt[id] = b; BD.filas[id - 1].bolt_estado = b.estado; } },
    // El bot de WhatsApp (db/215): aquí nadie abrió turno.
    botDe: async ids => new Map(ids.map(id => [Number(id), { turnoId: null }])),
    ponerBot: async filas => { for (const f of filas) BD.filas[f.id - 1].bot_estado = f.estado; },
    paraMirarBot: async () => BD.filas.filter(f => f.estado === 'leido' && !f.bot_estado).map(f => f.id),
    paraMirarBolt: async () => [],
    cerrarSinBolt: async () => { BD.sinBolt++; return 0; },
    lista: async o => { BD.listas.push(o); return []; },
    ultimaImportacion: async () => null,
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

  // LA LISTA (db/213): solo los leídos, cada uno con sus colores; los repetidos
  // no salen, y los que no se pudieron leer van aparte (el aviso de arriba).
  const listaAntes = DOBLE.lista;
  DOBLE.lista = async () => [
    { id: 1, estado: 'leido', cuando: '22/10/2026 12:57', gps_distancia_m: 19, boya_error_pct: 1.7 },
    { id: 2, estado: 'leido', cuando: '22/10/2026 03:19', gps_distancia_m: 12, boya_error_pct: 35.3 },
    { id: 3, estado: 'leido', cuando: '21/10/2026 16:31', gps_distancia_m: null, boya_error_pct: 70 },
    { id: 4, estado: 'leido', cuando: '21/10/2026 12:53', gps_distancia_m: null, boya_error_pct: null },
    { id: 5, estado: 'repetido', cuando: '22/10/2026 12:57', gps_distancia_m: 19, boya_error_pct: 1.7 },
    { id: 6, estado: 'no_leido', cuando: '22/10/2026 13:13', proveedor: 'ballenoil', motivo: 'No encuentro: Litros', matricula: null },
    // El aforador en su techo sin corregir: lo que subió es un mínimo. Desde
    // db/215 (solo cuenta lo que falta) la auditoría solo guarda el déficit de
    // un mínimo si ya llega a lo pagado: 0 %, verde. Un mínimo con déficit (el
    // id 8) solo podría venir de antes de la migración: sin color, nunca rojo.
    { id: 7, estado: 'leido', cuando: '23/10/2026 06:11', gps_distancia_m: 12, boya_error_pct: 0, boya_litros: 29, litros: 25.539, boya_tipo: 'litros', boya_corregida: false, boya_techo: 45, boya_despues: 45 },
    { id: 8, estado: 'leido', cuando: '23/10/2026 06:12', gps_distancia_m: 12, boya_error_pct: 70, boya_tipo: 'litros', boya_corregida: false, boya_techo: 45, boya_despues: 44 },
    { id: 9, estado: 'leido', cuando: '23/10/2026 06:13', gps_distancia_m: 12, boya_error_pct: 13.6, boya_litros: 22.1, litros: 25.6, boya_tipo: 'litros', boya_corregida: true, boya_techo: 45, boya_despues: 45 },
  ];
  const lst = await S.lista({ desde: '2026-10-21', hasta: '2026-10-22' });
  DOBLE.lista = listaAntes;
  igual('La lista: solo los leídos, cada uno con el color de su GPS, su boya y el peor de los dos (sin dato en los dos, sin color)',
    lst.filas.map(f => [f.id, f.gps_color, f.boya_color, f.color]),
    [[1, 'verde', 'verde', 'verde'], [2, 'verde', 'amarillo', 'amarillo'], [3, null, 'rojo', 'rojo'], [4, null, null, null],
      [7, 'verde', 'verde', 'verde'], [8, 'verde', null, 'verde'], [9, 'verde', 'verde', 'verde']]);
  igual('…un mínimo (topó y no se pudo corregir) solo dice verde o nada: el que ya llega a lo pagado es verde (+3,5 L de más), uno con déficit va sin color; corregido, verde normal (faltan 3,5 L)',
    lst.filas.filter(f => f.id >= 7).map(f => [f.id, f.boya_minimo, f.boya_color, f.boya_faltan, f.boya_de_mas]),
    [[7, true, 'verde', 0, 3.5], [8, true, null, null, null], [9, false, 'verde', 3.5, 0]]);
  igual('…los repetidos ni salen, y los no leídos van aparte con su enlace (id) y su motivo, con los umbrales para la pantalla',
    [lst.filas.some(f => f.id === 5), lst.noLeidos, lst.umbrales],
    [false, [{ id: 6, cuando: '22/10/2026 13:13', proveedor: 'ballenoil', motivo: 'No encuentro: Litros', matricula: null }],
      { gpsM: [700, 1600], boyaPct: [35, 65] }]);

  // ════════════════════════════════════════════════════════════════════════
  // 7. LA AUDITORÍA CON MAPON (db/213): la gasolinera, la distancia, los colores
  // ════════════════════════════════════════════════════════════════════════
  const G = require('../modules/Combustible/combustible.gasolinera');
  const SEM = require('../modules/Combustible/combustible.semaforo');
  const BOYA = require('../modules/Combustible/combustible.boya');

  // La lista DE VERDAD: las 143 de db/213, leídas del propio fichero (sin base),
  // con su id por orden de carga.
  const sql213 = require('fs').readFileSync(path.join(__dirname, '..', 'db', '213-auditoria-repostajes.sql'), 'utf8');
  const TXT = "'(?:[^']|'')*'";
  const LISTA = [...sql213.matchAll(new RegExp(`^\\s*\\('(\\w+)', (${TXT}), (?:${TXT}|NULL), (?:${TXT}|NULL), '(\\w+)', (NULL|-?[\\d.]+), (NULL|-?[\\d.]+), '(\\w+)'`, 'gm'))]
    .map((x, i) => ({ id: i + 1, proveedor: x[1], nombre: x[2].slice(1, -1).replace(/''/g, "'"), sede: x[3],
      lat: x[4] === 'NULL' ? null : Number(x[4]), lng: x[5] === 'NULL' ? null : Number(x[5]), precision: x[6] }));
  const gas = nombre => LISTA.find(g => g.nombre === nombre);
  igual('db/213 trae las 143 gasolineras del Excel de Camilo: 112 de Madrid y 31 de Barcelona, 8 sin coordenadas',
    [LISTA.length, LISTA.filter(g => g.sede === 'madrid').length, LISTA.filter(g => g.sede === 'barcelona').length, LISTA.filter(g => g.lat == null).length],
    [143, 112, 31, 8]);

  // Los nombres de estación de los correos de verdad (21-23/10/2026).
  const casaGas = (estacion, sede) => (r => [r.como, r.gasolinera && r.gasolinera.nombre])(G.casar(estacion, LISTA, { sede }));
  igual('Casar: «COSLADA» es Coslada I, no Coslada III (sin número es el I)', casaGas('COSLADA'), ['exacto', 'Ballenoil Coslada I']);
  igual('Casar: «PRAT DE LLOBREGAT (EL)» es El Prat (el artículo detrás y el «de» no cuentan)', casaGas('PRAT DE LLOBREGAT (EL)'), ['parecido', 'Ballenoil El Prat']);
  igual("Casar: «HOSPITALET DE LLOBREGAT (L')» y «(L´)», con los dos apóstrofos",
    [casaGas("HOSPITALET DE LLOBREGAT (L')"), casaGas('HOSPITALET DE LLOBREGAT (L´)')],
    [['exacto', 'Ballenoil Hospitalet de Llobregat'], ['exacto', 'Ballenoil Hospitalet de Llobregat']]);
  igual('Casar: «CORNELLÀ DE LLOBREGAT II» es Cornellà II, no Cornellà (el número manda)', casaGas('CORNELLÀ DE LLOBREGAT II'), ['parecido', 'Ballenoil Cornellà II']);
  igual('Casar: «BARCELONA- ASUNCION» (el guion pegado, sin tilde) es Barcelona - Asunción', casaGas('BARCELONA- ASUNCION'), ['exacto', 'Ballenoil Barcelona - Asunción']);
  igual('Casar: «BARCELONA - CLOT» es Clot', casaGas('BARCELONA - CLOT'), ['parecido', 'Ballenoil Clot']);
  igual('Casar: «MONTMELÓ», «ALCOBENDAS II», «GALAPAGAR», «ALCALA DE HENARES» y «ARGANDA III»',
    ['MONTMELÓ', 'ALCOBENDAS II', 'GALAPAGAR', 'ALCALA DE HENARES', 'ARGANDA III'].map(e => casaGas(e)),
    [['exacto', 'Ballenoil Montmeló'], ['exacto', 'Ballenoil Alcobendas II'], ['exacto', 'Ballenoil Galapagar'],
      ['exacto', 'Ballenoil Alcalá de Henares'], ['parecido', 'Ballenoil Arganda del Rey III']]);
  igual('Casar: una gasolinera con dos nombres («Cerdanyola del Vallès / Sardañola del Vallés») casa por los dos',
    [casaGas('SARDAÑOLA DEL VALLES'), casaGas('CERDANYOLA')],
    [['exacto', 'Ballenoil Cerdanyola del Vallès / Sardañola del Vallés'], ['parecido', 'Ballenoil Cerdanyola del Vallès / Sardañola del Vallés']]);
  igual('Casar: si duda, ninguna (y dice entre cuáles): «BARCELONA» vale para Asunción y La Trinidad',
    (r => [r.como, r.gasolinera, r.candidatas.map(g => g.nombre).sort()])(G.casar('BARCELONA', LISTA)),
    ['ambiguo', null, ['Ballenoil Barcelona - Asunción', 'Ballenoil Barcelona - La Trinidad']]);
  igual('Casar: lo que no se parece a ninguna, ninguna; y un nombre vacío tampoco casa',
    [casaGas('SECOYA 12'), casaGas(''), casaGas('(EL)')], [['ninguna', null], ['ninguna', null], ['ninguna', null]]);
  const DOS = [{ id: 901, proveedor: 'ballenoil', nombre: 'Ballenoil Prueba', sede: 'madrid' }, { id: 902, proveedor: 'ballenoil', nombre: 'Ballenoil Prueba', sede: 'barcelona' }];
  igual('Casar: la sede del coche desempata entre dos iguales; sin sede, ambiguo',
    [G.casar('PRUEBA', DOS, { sede: 'barcelona' }).gasolinera.id, G.casar('PRUEBA', DOS).como], [902, 'ambiguo']);
  const ALIAS = new Map([[`ballenoil|${G.normalizar('BARCELONA').clave}`, gas('Ballenoil Barcelona - Asunción').id]]);
  igual('Casar: lo puesto a mano (alias) manda sobre el nombre, y solo para su proveedor',
    [(e => [e.como, e.gasolinera.nombre])(G.elegir('BARCELONA', { proveedor: 'ballenoil', sede: 'barcelona', gasolineras: LISTA, alias: ALIAS })),
      G.elegir('BARCELONA', { proveedor: 'petroprix', gasolineras: LISTA, alias: ALIAS }).como],
    [['alias', 'Ballenoil Barcelona - Asunción'], 'ninguna']);
  // Los subnombres: lo que le sobra al correo señala a otra gasolinera del
  // mismo sitio. Antes casaban con la I sin avisar (revisión del 23/10/2026).
  const SUBNOMBRES = [
    ['ALCORCON - EL CANO', ['Ballenoil Alcorcón I', 'Ballenoil Alcorcón II (El Cano)']],
    ['ARGANDA DEL REY - FULL OIL', ['Ballenoil Arganda del Rey I', 'Ballenoil Arganda del Rey II (Full Oil)']],
    ['MATARO PARK', ['Ballenoil Mataró I', 'Ballenoil Mataró II (Mataró Park)']],
    ['MATARO - SANT SIMO', ['Ballenoil Mataró I', 'Ballenoil Mataró III - Sant Simó']],
    ['LEGANES - LA FORTUNA', ['Ballenoil Leganés I', 'Ballenoil Leganés III - La Fortuna']],
    ['ALCORCON - VIRGISA', ['Ballenoil Alcorcón I', 'Ballenoil Alcorcón III - Virgisa']],
    ['MOSTOLES - AIDATER', ['Ballenoil Móstoles I', 'Ballenoil Móstoles VI - Aidater I', 'Ballenoil Móstoles VII - Aidater II']],
    ['MOSTOLES - AIDATER II', ['Ballenoil Móstoles II', 'Ballenoil Móstoles VI - Aidater I', 'Ballenoil Móstoles VII - Aidater II']],
  ];
  igual('Casar: un subnombre que es de otra («ALCORCON - EL CANO», «MATARO PARK», «MOSTOLES - AIDATER II»…) es ambiguo, nunca la I (ni la II)',
    SUBNOMBRES.map(([e]) => (r => [r.como, r.gasolinera, r.candidatas.map(g => g.nombre).sort()])(G.casar(e, LISTA))),
    SUBNOMBRES.map(([, c]) => ['ambiguo', null, [...c].sort()]));
  igual('…pero lo que sobra solo cuenta si es de otra del MISMO sitio: «BARCELONA - CLOT» sigue siendo Clot y «PRAT DE LLOBREGAT (EL)», El Prat',
    [casaGas('BARCELONA - CLOT', 'barcelona'), casaGas('PRAT DE LLOBREGAT (EL)', 'barcelona'), casaGas('CORNELLÀ DE LLOBREGAT II', 'barcelona')],
    [['parecido', 'Ballenoil Clot'], ['parecido', 'Ballenoil El Prat'], ['parecido', 'Ballenoil Cornellà II']]);
  igual('Ida y vuelta: los 143 nombres de la lista, escritos como en un correo (en mayúsculas, sin «Ballenoil»), vuelven a su gasolinera, con sede y sin ella',
    LISTA.flatMap(g => [g.sede, undefined].map(sede => {
      const r = G.casar(g.nombre.replace(/^Ballenoil\s+/, '').toUpperCase(), LISTA, { sede });
      return r.gasolinera && r.gasolinera.id === g.id ? null : `${g.nombre} → ${r.como}`;
    })).filter(Boolean), []);
  igual('Normalizar: sin tildes, signos ni artículos, y el número aparte',
    ['PRAT DE LLOBREGAT (EL)', 'CORNELLÀ DE LLOBREGAT II', 'Ballenoil Móstoles VI - Aidater I'].map(e => G.normalizar(e).clave),
    ['llobregat prat', 'cornella llobregat #2', 'aidater i mostoles #6']);

  // La distancia: haversine con el radio medio de la Tierra.
  igual('Distancia: un grado de latitud son 111.195 m; el mismo punto, 0; sin coordenadas, null',
    [G.metros({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), G.metros({ lat: 40.43, lng: -3.53 }, { lat: 40.43, lng: -3.53 }),
      G.metros({ lat: 40.43, lng: -3.53 }, gas('Ballenoil Clot')), G.metros(null, { lat: 1, lng: 1 })],
    [111195, 0, null, null]);
  const enCoslada = { lat: gas('Ballenoil Coslada I').lat + 0.0001, lng: gas('Ballenoil Coslada I').lng };
  igual('Distancia: a 0,0001° de Coslada I son 11 m, y es la más cercana de la lista',
    (c => [c.gasolinera.nombre, c.metros])(G.masCercana(enCoslada, LISTA)), ['Ballenoil Coslada I', 11]);
  igual('Distancia: sin posición, sin casar o con la gasolinera sin coordenadas, no hay metros y se dice por qué',
    [G.distanciaA({ posicion: null }).motivo, G.distanciaA({ posicion: enCoslada, gasolinera: null, como: 'ambiguo', estacion: 'BARCELONA' }).motivo,
      G.distanciaA({ posicion: enCoslada, gasolinera: gas('Ballenoil Clot') }).motivo, G.distanciaA({ posicion: enCoslada, gasolinera: gas('Ballenoil Coslada I') }).distancia],
    ['No se sabe dónde estaba el coche a esa hora',
      '«BARCELONA» vale para varias gasolineras de la lista: no se casa con ninguna (se puede poner a mano)',
      'Ballenoil Clot no tiene coordenadas en la lista', 11]);

  // Los umbrales de Camilo, en el borde exacto.
  igual('GPS: 699 m verde, 700 amarillo, 1.599 amarillo, 1.600 rojo', [699, 700, 1599, 1600].map(SEM.colorGps), ['verde', 'amarillo', 'amarillo', 'rojo']);
  igual('Boya: 34,9 % verde, 35 amarillo, 64,9 amarillo, 65 rojo', [34.9, 35, 64.9, 65].map(SEM.colorBoya), ['verde', 'amarillo', 'amarillo', 'rojo']);
  // El umbral se aplica a la cifra que se ve (decidido el 23/10/2026): 34,96 %
  // se guarda «35,0 %» y es amarillo; 699,6 m son «700 m», amarillo.
  const m6996 = G.metros({ lat: 40, lng: -3.7 }, { lat: 40 + 699.6 / 111195.08, lng: -3.7 });
  igual('El borde, con la cifra redondeada que se ve: faltar un 34,96 % es «35,0 %», amarillo; 699,6 m son «700 m», amarillo',
    [BOYA.deficitPct(6.504, 10), SEM.colorBoya(BOYA.deficitPct(6.504, 10)), m6996, SEM.colorGps(m6996)], [35, 'amarillo', 700, 'amarillo']);
  // Desde el 23/10/2026 la boya solo cuenta lo que falta: un mínimo que ya
  // llega a lo pagado es 0 % (verde); uno que no llega ni se compara.
  igual('Un mínimo (el aforador topó y no se pudo corregir) solo dice verde (0 %) o nada',
    [0, 13.6, 40, 70].map(v => SEM.colorBoya(v, { minimo: true })), ['verde', null, null, null]);
  igual('Sin dato no hay color (null, vacío, texto); 0 es verde', [null, undefined, '', 'x', 0].map(SEM.colorGps), [null, null, null, null, 'verde']);
  igual('La fila, por el peor: rojo > amarillo > verde; sin dato en uno manda el otro; sin los dos, sin color',
    [SEM.peor('verde', 'rojo'), SEM.peor('rojo', 'amarillo'), SEM.peor('amarillo', null), SEM.peor(null, 'verde'), SEM.peor(null, null)],
    ['rojo', 'rojo', 'amarillo', 'verde', null]);

  // ── LA BOYA, con lecturas de mentira: LA VENTANA FIJA (23/10/2026) ───────
  // El repostaje de las 12:57 de Madrid del 22/10/2026 (10:57 UTC). Un Toyota
  // lee cada 30 s con el coche encendido; parado, nada. Camilo: el nivel ANTES
  // es el de 15 minutos antes de la hora del repostaje y el DESPUÉS, el de 30
  // minutos después; ya no se busca la parada.
  const T = Date.UTC(2026, 9, 22, 10, 57), MIN = 60e3, H = 3600e3;
  const tramo = (desde, hasta, v, paso = 30e3) => { const s = []; for (let t = desde; t <= hasta; t += paso) s.push({ t, v: typeof v === 'function' ? v(t, s.length) : v }); return s; };
  const PARADA = { desde: T - 3 * MIN, hasta: T + 6 * MIN };
  const ANTES = tramo(T - H, T - 3 * MIN, (t, i) => [12, 13, 12, 11, 12][i % 5]);   // baila ±1 L
  const toyota = ANTES.concat(tramo(T + 6 * MIN, T + H, 35));
  // [antes, después, salto, minutos de la lectura de antes y de la de después respecto a T, cuántas se juntaron de cada lado]
  const ven = (s, t = T, o) => (m => (m.ok ? [m.antes, m.despues, m.salto, (m.tAntes - t) / MIN, (m.tDespues - t) / MIN, m.nAntes, m.nDespues]
    : [m.ok, m.reintentar, m.motivo]))(BOYA.ventana(s, t, o));
  igual('Ventana fija: el nivel a T − 15 (la mediana de las 5 de sus 10 minutos: 12, bailando ±1) y a T + 30 (35): +23 L',
    [ven(toyota), (m => [(m.instAntes - T) / MIN, (m.instDespues - T) / MIN])(BOYA.ventana(toyota, T)), [BOYA.ANTES_MIN, BOYA.DESPUES_MIN]],
    [[12, 35, 23, -15, 30, 5, 5], [-15, 30], [15, 30]]);
  // Un Ioniq: la aguja sube despacio al arrancar (10 → 35 L en cuatro minutos).
  // A T + 30 ya está arriba: la ventana no la coge a medias.
  const ioniq = ANTES.concat([10, 18, 26, 33, 35].map((v, i) => ({ t: T + (6 + i) * MIN, v })), tramo(T + 11 * MIN, T + H, 35, MIN));
  igual('Un Ioniq con la aguja lenta (10 → 35 L en cuatro minutos tras arrancar): a T + 30 ya está arriba, +23', ven(ioniq).slice(0, 3), [12, 35, 23]);

  // EL DE LA CAPTURA (1212MJY, Petroprix «Móstoles 2», 22/10/2026 17:46:16,
  // 30,69 L). El aforador en 9 L hasta las 17:44, 41 a las 17:45 y luego
  // 39-40; Mapon vio una parada de 23 segundos a las 17:46:07, con el depósito
  // ya lleno. La regla de antes medía a través de esa parada.
  const hora = (h, m, s = 0) => Date.UTC(2026, 9, 22, h - 2, m, s);
  const T12 = hora(17, 46, 16);
  const mjy = tramo(hora(16, 44), hora(17, 44), 9).concat([{ t: hora(17, 45), v: 41 }],
    tramo(hora(17, 45, 30), hora(18, 50), (t, i) => (i % 2 ? 39 : 40)));
  const paradaTarde = { desde: hora(17, 46, 7), hasta: hora(17, 46, 30) };
  igual('El de la captura, con la regla de antes («antes de parar» y «al arrancar», a través de la parada de 23 s): el depósito «no subía», por eso salía rojo',
    (m => [m.antes, m.despues, m.salto])(BOYA.subidaEnParada(mjy, paradaTarde)), [40, 40, 0]);
  igual('…con la ventana fija: 9 L a las 17:31 y 40 a las 18:16 (la mediana de 39-40), +31 L',
    ven(mjy, T12).slice(0, 3), [9, 40, 31]);

  // EL COCHE APAGADO, SIN LECTURAS CERCA: aparcado de T − 3 h a T − 5 min; tras
  // repostar anduvo 6 minutos y aparcó hasta T + 5 h. Aparcado el nivel no
  // cambia: vale la última lectura de antes y la primera de después.
  const apagado = tramo(T - 4 * H, T - 3 * H, 20).concat(tramo(T - 5 * MIN, T - 2 * MIN, 20), tramo(T + 2 * MIN, T + 8 * MIN, 41), tramo(T + 5 * H, T + 6 * H, 40));
  igual('Coche apagado y sin lecturas cerca: la última de antes (de hace 3 h) y la primera de después (a las 5 h, con la aguja quieta): +20 L',
    ven(apagado), [20, 40, 20, -180, 300, 5, 5]);
  // EN TODA LA SERIE (revisión del 23/10/2026): hasta entonces solo 12 h, y
  // dos rojos o amarillos de verdad se quedaban «sin medir».
  igual('Aparcado 13 h antes de repostar (el 1210MJY del 01/10): vale la última lectura de antes, de hace 13 h',
    ven(tramo(T - 14 * H, T - 13 * H, 20).concat(tramo(T + 2 * MIN, T + 2 * H, 40))), [20, 40, 20, -780, 30, 5, 5]);
  const aparca20h = tramo(T - H, T - 3 * MIN, 32).concat([33, 35, 36, 38, 38, 39].map((v, i) => ({ t: T + (1 + 2 * i) * MIN, v })),
    tramo(T + 19 * H + 46 * MIN, T + 21 * H, 38));
  igual('Aparcado casi 20 h nada más repostar (el 0524MMZ del 05/10, un rojo de verdad que se perdía): vale la primera de después, al volver a arrancar',
    ven(aparca20h, T, { ahora: T + 30 * H }), [32, 38, 6, -15, 19 * 60 + 46, 5, 5]);
  igual('Sin ni una lectura de antes en toda la serie: no hay salto y NO se reintenta (son horas del pasado: no van a llegar)',
    (m => [m.ok, m.reintentar, /^No hay lecturas del aforador en las 72 horas antes de las 12:42 \(15 minutos antes del repostaje\)/.test(m.motivo)])(
      BOYA.ventana(tramo(T + 2 * MIN, T + 2 * H, 40), T, { desde: T - 72 * H })),
    [false, false, true]);
  // LA AGUJA AL ARRANCAR (el 0870MMZ del 02/10): repostó y no arrancó hasta
  // T + 40; al arrancar, la aguja sube de 16 a 39 en dos minutos. La mediana de
  // las cinco primeras sería 19, un rojo de un repostaje bueno.
  const aguja = tramo(T - H, T - 3 * MIN, 16).concat([16, 16, 19, 28, 29, 29, 30, 31, 36, 38, 38, 39].map((v, i) => ({ t: T + 40 * MIN + i * 10e3, v })),
    tramo(T + 42 * MIN, T + 2 * H, 39));
  igual('La aguja al arrancar después de T + 30 (16 → 39 en dos minutos): sube 3 L o más tras un hueco, así que vale lo de pasados 5 minutos, 39 y no 19; y se dice cuándo arrancó',
    (m => [m.antes, m.despues, (m.tDespues - T) / MIN, (m.arranque - T) / MIN])(BOYA.ventana(aguja, T)), [16, 39, 45, 40]);
  igual('…si vuelve a parar antes de los 5 minutos, la última de ese rato; y si tras el hueco no sube (aparcado, el baile de ±1 L) o el coche andaba desde antes, nada cambia',
    [(m => [m.despues, (m.tDespues - T) / MIN])(BOYA.ventana(tramo(T - H, T - 3 * MIN, 16).concat([20, 30, 38].map((v, i) => ({ t: T + 40 * MIN + i * MIN, v })), tramo(T + 3 * H, T + 4 * H, 37)), T)),
      BOYA.ventana(toyota, T).arranque, BOYA.ventana(apagado, T).arranque,
      BOYA.ventana(tramo(T - H, T - 3 * MIN, 30).concat([44, 44, 43, 43, 43, 43, 42].map((v, i) => ({ t: T + 40 * MIN + i * 40e3, v }))), T).despues],
    [[38, 42], null, null, 43]);
  // EL AFORADOR DE LOS IONIQ solo lee cuando cambia: una lectura suelta es el
  // nivel que había. La mediana de las cinco de antes cogería niveles de horas.
  const soloCambia = [{ t: T - 90 * MIN, v: 32 }, { t: T - 50 * MIN, v: 31 }, { t: T - 20 * MIN, v: 30 }, { t: T + 4 * MIN, v: 33 }, { t: T + 6 * MIN, v: 38 },
    { t: T + 9 * MIN, v: 43 }, { t: T + 3 * H, v: 42 }, { t: T + 3.5 * H, v: 41 }];
  igual('Un aforador que solo lee cuando cambia (Ioniq): la lectura más cercana de cada lado, sola: 30 → 42 L (lo gastado entre medias se suma aparte)',
    ven(soloCambia), [30, 42, 12, -20, 180, 1, 1]);

  // LO QUE GASTA ENTRE MEDIAS: andando de T − 15 a T + 30, el salto sale corto.
  const kmAnda = tramo(T - 2 * H, T + 2 * H, t => 1000 + 30 * (t - (T - 2 * H)) / H, MIN);   // a 30 km/h todo el rato
  igual('Lo que gasta andando entre las dos lecturas: 22,5 km a 4,77 L/100 km son 1,1 L; aparcado, 0; sin km, nada',
    [BOYA.gastadoAndando(kmAnda, T - 15 * MIN, T + 30 * MIN), BOYA.gastadoAndando(tramo(T - 2 * H, T + 2 * H, 1000, MIN), T - 15 * MIN, T + 30 * MIN),
      BOYA.gastadoAndando([], T, T + H)],
    [{ km: 22.5, litros: 1.1 }, { km: 0, litros: 0 }, null]);
  igual('…y si el coche acababa de arrancar (el primer km llega un minuto después de la lectura del aforador), vale ese: 44 min a 30 km/h',
    BOYA.gastadoAndando(tramo(T - 14 * MIN, T + 2 * H, t => 1000 + 30 * (t - (T - 14 * MIN)) / H, MIN), T - 15 * MIN, T + 30 * MIN), { km: 22, litros: 1 });

  igual('Sin lecturas de después de T + 30 todavía: no hay salto y se vuelve a mirar (no «0 L», que sería un rojo de mentira)',
    (m => [m.ok, m.reintentar, /Todavía no hay lecturas del aforador de después de las 13:27 \(30 minutos después del repostaje\)/.test(m.motivo)])(BOYA.ventana(ANTES, T, { ahora: T + H })),
    [false, true, true]);
  igual('…y si aún no son las T + 30 (alguien le da a «Auditar ahora» antes), lo dice',
    /^Todavía no son las 13:27 \(30 minutos después del repostaje\)/.test(BOYA.ventana(toyota.filter(p => p.t < T + 10 * MIN), T, { ahora: T + 10 * MIN }).motivo), true);
  igual('Sin ni una lectura: el coche no da el nivel (no se reintenta)', (m => [m.ok, m.sinSerie, m.reintentar])(BOYA.ventana([], T)), [false, true, false]);
  const conHuecos = tramo(T - H, T - 17 * MIN, 12).concat([{ t: T - 16.5 * MIN, v: null }, { t: T - 16 * MIN, v: '' }, { t: T - 15.5 * MIN, v: null },
    { t: T - 15 * MIN, v: null }], tramo(T + 6 * MIN, T + H, 35));
  igual('Una lectura vacía no es un 0 (con tres seguidas, la mediana sería un 0 y el salto, +35)', ven(conHuecos).slice(0, 3), [12, 35, 23]);
  // UN FORD: el nivel en % (una lectura cada 3 min), con la misma ventana.
  const pctFord = tramo(T - H, T - 3 * MIN, 20, 3 * MIN).concat(tramo(T + 6 * MIN, T + H, 90, 3 * MIN));
  igual('Un Ford (en % del depósito, una lectura cada 3 min): la misma ventana, +70 %', ven(pctFord).slice(0, 3), [20, 90, 70]);

  // LA PARADA, SOLO PARA EL GPS: ¿una parada larga lejos de la gasolinera tras
  // la cual el depósito tiene 5 L más? (combustible.auditoria, subeEnElla). Es
  // la cuenta de la boya de antes, y para eso se queda.
  const paraOtraVez = ANTES.concat(tramo(T + 6 * MIN, T + 8 * MIN, 35));
  igual('Para el GPS, a través de una parada: las 5 de antes de parar y las de después de arrancar (pasados los 5 min de la aguja, o las del principio si vuelve a parar); sin fin, nada',
    [BOYA.subidaEnParada(toyota, PARADA).salto, BOYA.subidaEnParada(ioniq, PARADA).salto, BOYA.subidaEnParada(paraOtraVez, PARADA).salto,
      BOYA.subidaEnParada(toyota, { desde: T - 3 * MIN, hasta: null }).ok, BOYA.subidaEnParada(ANTES, PARADA).ok],
    [23, 23, 23, false, false]);

  // EL TECHO: el aforador no marca más de 40 L, y lo de encima no se ve.
  const llena = ANTES.map(p => ({ ...p, v: 15 })).concat(tramo(T + 6 * MIN, T + 2 * H - 30e3, 40), tramo(T + 2 * H, T + 3 * H, 36));
  const mT = BOYA.ventana(llena, T);
  igual('Techo: el máximo de la serie, si llega a 38 L; por debajo no es un techo', [BOYA.techo(llena), BOYA.techo(toyota)], [40, null]);
  // Una lectura rota del CAN (255, 65535) no es el techo: fijaba ahí el techo
  // y el aforador ya no «topaba» nunca.
  const conRotas = llena.concat([{ t: T + 30 * MIN + 15e3, v: 255 }, { t: T + 31 * MIN + 15e3, v: 65535 }, { t: T + 32 * MIN + 15e3, v: -3 }]);
  const mRotas = BOYA.ventana(conRotas, T);
  igual('Techo con lecturas rotas (255, 65535, −3): sigue en 40, y el repostaje sigue topando',
    [BOYA.techo(conRotas), BOYA.topa(mRotas, BOYA.techo(conRotas))], [40, true]);
  igual('…y un valor alto suelto (dos lecturas de 44) tampoco es el techo: el techo se repite',
    BOYA.techo(llena.concat([{ t: T + 33 * MIN + 15e3, v: 44 }, { t: T + 34 * MIN + 15e3, v: 44 }])), 40);
  igual('esMinimo: lo guardado es un mínimo si topó (después ≥ techo − 1) y no se corrigió; corregido, en % o sin techo, no',
    [{ boya_tipo: 'litros', boya_corregida: false, boya_techo: 45, boya_despues: 44 }, { boya_tipo: 'litros', boya_corregida: true, boya_techo: 45, boya_despues: 45 },
      { boya_tipo: 'litros', boya_corregida: false, boya_techo: 45, boya_despues: 43 }, { boya_tipo: 'porcentaje', boya_corregida: null, boya_techo: null, boya_despues: 90 },
      { boya_tipo: 'litros', boya_corregida: false, boya_techo: null, boya_despues: 35 }, null].map(BOYA.esMinimo),
    [true, false, false, false, false, false]);
  igual('…a T + 30 marca el techo: topó', [mT.salto, BOYA.topa(mT, 40), BOYA.topa(BOYA.ventana(toyota, T), null)], [25, true, false]);
  const baja = BOYA.bajaDelTecho(llena, mT, 40);
  igual('…vuelve a bajar de verdad (mediana de 5 ≤ techo − 2) un minuto antes de las 2 h: 36 L',
    [baja && (baja.t2 - T) / MIN, baja && baja.v2], [119, 36]);
  igual('…y si no ha bajado todavía, no hay corrección (se espera)', BOYA.bajaDelTecho(llena.filter(p => p.t < T + 2 * H), mT, 40), null);
  // 50 km/h: de las 13:27 (la lectura de después) a las 14:56 (t2) son 74 km → 3,5 L a 4,77 L/100 km.
  const km = [{ t: T, v: 1000 }, { t: T + 4 * H, v: 1200 }];
  igual('Corregir el techo con los km desde la lectura de después a 4,77 L/100 km: 36 + 3,5 − 15 = 24,5 L (lo de entre medias se suma aparte)',
    (c => [c.corregido, c.litros, c.gastadoEntre, c.como])(BOYA.corregirTecho(mT, baja, { km })), [true, 24.5, 3.5, '74 km a 4,77 L/100 km']);
  // POR KM, COMO LO DE ENTRE MEDIAS (revisión del 23/10/2026): hasta entonces
  // mandaba el gastado de la centralita, interpolado entre lecturas de horas,
  // y en una misma cuenta se mezclaban las dos fuentes.
  const gastado = [{ t: T, v: 5000 }, { t: T + 4 * H, v: 5010 }];
  igual('…con km y centralita, mandan los km (como lo de entre medias): 24,5 L, no los 24,7 de la centralita',
    (c => [c.litros, c.como, c.kmEntre])(BOYA.corregirTecho(mT, baja, { gastado, km })), [24.5, '74 km a 4,77 L/100 km', 74.2]);
  const gastadoJunto = tramo(T, T + 4 * H, t => 5000 + 2.5 * (t - T) / H, 5 * MIN);
  igual('…sin km, la centralita, pero solo con lecturas a pocos minutos de los dos instantes (36 + 3,7 − 15 = 24,7 L); con un hueco de horas, no se interpola',
    [(c => [c.litros, c.como])(BOYA.corregirTecho(mT, baja, { gastado: gastadoJunto })), (c => [c.corregido, c.litros])(BOYA.corregirTecho(mT, baja, { gastado }))],
    [[24.7, 'gastado de la centralita'], [false, 25]]);
  igual('…y sin ninguno de los dos, el salto sin corregir y por qué', (c => [c.corregido, c.litros, /no hay km ni gastado/.test(c.motivo)])(BOYA.corregirTecho(mT, baja, {})), [false, 25, true]);
  igual('Interpolar una serie acumulada entre dos lecturas (y fuera de ella, null)',
    [BOYA.enInstante(km, T + H), BOYA.enInstante(km, T - 1), BOYA.enInstante(km, T + 5 * H)], [1050, null, null]);
  igual('Déficit de la boya: max(0, pagado − boya) / pagado, con un decimal; subir de más es 0; con 0 litros pagados o sin boya, null; si bajó, más del 100 %',
    [BOYA.deficitPct(23, 24.405), BOYA.deficitPct(25.3, 26.5), BOYA.deficitPct(0, 30), BOYA.deficitPct(10, 0), BOYA.deficitPct(null, 10),
      BOYA.deficitPct(24.405, 24.405), BOYA.deficitPct(30, 24.405), BOYA.deficitPct(-1, 24.86)],
    [5.8, 4.5, 100, null, null, 0, 0, 104]);
  igual('…y en litros: «faltan 1,4 L» o «+5,6 L de más»', [BOYA.diferencia(23, 24.405), BOYA.diferencia(30, 24.405), BOYA.diferencia(null, 3)],
    [{ faltan: 1.4, deMas: 0 }, { faltan: 0, deMas: 5.6 }, null]);
  // El % y los litros no se contradicen (revisión del 23/10/2026): 46 L de
  // 46,04 es un 0,1 %, y «faltan 0,0 L» al lado no se entendería.
  igual('…el % y los litros no se contradicen: un 0,1 % son 0,04 L que faltan (no «0,0»); un 0,0 % es que no falta nada (aunque falten 4 ml)',
    [[46, 46.04], [46, 46.004], [46, 46], [46.04, 46]].map(([b, p]) => [BOYA.deficitPct(b, p), BOYA.diferencia(b, p)]),
    [[0.1, { faltan: 0.04, deMas: 0 }], [0, { faltan: 0, deMas: 0 }], [0, { faltan: 0, deMas: 0 }], [0, { faltan: 0, deMas: 0 }]]);
  igual('Los bordes del déficit: subir lo pagado, 0; subir de más, 0 suba lo que suba; faltar un 34,9 / 35 / 64,9 / 65 % da verde, amarillo, amarillo, rojo',
    [BOYA.deficitPct(20, 20), BOYA.deficitPct(60, 20), ...[13.02, 13, 7.02, 7].map(b => SEM.colorBoya(BOYA.deficitPct(b, 20)))],
    [0, 0, 'verde', 'amarillo', 'amarillo', 'rojo']);
  // ¿Se movió el aforador dentro de una parada? Aparcado, no; andando, sí.
  const quieto = tramo(T - 5 * H, T + 5 * H, 31, 5 * MIN);
  const anda = tramo(T - 5 * H, T + 5 * H, t => Math.round(31 - 14 * (t - (T - 5 * H)) / (10 * H)), 5 * MIN);
  igual('Dentro de una parada: el aforador quieto (31 L todo el rato) o moviéndose (de 31 a 17 L, el 9521MMX); sin lecturas, no se sabe',
    [BOYA.cambioDentro(quieto, T - 4 * H, T + 4 * H), (x => [x.min, x.max])(BOYA.cambioDentro(anda, T - 4 * H, T + 4 * H)), BOYA.cambioDentro([], T - H, T)],
    [{ lecturas: 95, min: 31, max: 31 }, [19, 29], null]);
  igual('La mediana, como en los análisis: la del medio o la de arriba de las dos del medio',
    [BOYA.mediana([3, 1, 2]), BOYA.mediana([1, 2, 3, 4]), BOYA.mediana([])], [2, 3, null]);

  // ════════════════════════════════════════════════════════════════════════
  // 8. LA AUDITORÍA DE PUNTA A PUNTA (combustible.auditoria), con dobles
  // ════════════════════════════════════════════════════════════════════════
  // Mapon de mentira, y MIRADO: si la auditoría tocara algo que no sea una
  // lectura (una orden, un relé), sale abajo. La base, otro doble.
  const MAP = { caido: false, sinClave: false, revienta: null, series: {}, pct: {}, paradas: {}, puntos: {}, capacidad: {}, gk: {}, padron: {}, pedido: [] };
  const LECTURAS_MAPON = ['configurado', 'disponible', 'estadoCaida', 'unidadPorMatricula', 'paradasUnidad', 'posicionEn',
    'nivelDeposito', 'nivelPorcentaje', 'gastadoYKm', 'capacidadDeposito'];
  const tocadoMapon = new Set();
  const falla = que => { if (MAP.revienta === que) throw new Error('Mapon no responde (timeout)'); };
  sustituir('services/mapon.js', new Proxy({
    configurado: () => !MAP.sinClave,
    disponible: () => !MAP.caido,
    estadoCaida: () => (MAP.caido ? { motivo: 'cuenta suspendida' } : null),
    unidadPorMatricula: async m => (MAP.padron[m] ? { unitId: MAP.padron[m] } : null),
    // Lo que se pregunta, apuntado (MAP.pedido): «solo la boya» no pide ni paradas ni posiciones.
    paradasUnidad: async u => { MAP.pedido.push('paradas'); falla('paradas'); return MAP.paradas[u] || []; },
    posicionEn: async u => { MAP.pedido.push('posicion'); return MAP.puntos[u] || null; },
    nivelDeposito: async u => { falla('nivel'); return MAP.series[u] || []; },
    nivelPorcentaje: async u => MAP.pct[u] || [],
    // Como Mapon: solo lo que cae en la ventana pedida.
    gastadoYKm: async (u, desde, hasta) => {
      const g = MAP.gk[u] || {}, dentro = x => (x || []).filter(q => q.t >= desde && q.t <= hasta);
      return { gastado: dentro(g.gastado), km: dentro(g.km) };
    },
    capacidadDeposito: async u => MAP.capacidad[u] || null,
  }, { get: (o, k) => { tocadoMapon.add(String(k)); return o[k]; } }));
  const AUD = { filas: {}, alias: new Map(), textos: new Map(), vecinos: {}, vecinosEntre: {}, cerrar: 0, aAuditar: [], guardarRevienta: null, movidas: [] };
  const UNIDAD = { '8997LDK': 'u-coslada', '7909LRJ': 'u-clot', '2350LHP': 'u-ford', '6584KZV': 'u-sin', '9001LWJ': 'u-techo', '3814KYG': 'u-espera' };
  const paraCasar = f => ({ id: f.id, proveedor: f.proveedor, estacion: f.estacion, sede: f.sede, gasolinera_id: f.gasolinera_id || null,
    gasolinera_como: f.gasolinera_como || null, gps_lat: f.gps_lat == null ? null : f.gps_lat, gps_lng: f.gps_lng == null ? null : f.gps_lng });
  sustituir('modules/Combustible/combustible.repo.js', {
    gasolineras: async () => LISTA,
    aliasGasolineras: async () => AUD.alias,
    // Los textos exactos del Excel de Petroprix (db/215): aquí, ninguno.
    textosGasolineras: async () => AUD.textos,
    // Otros repostajes del mismo coche en la misma parada: los que diga la prueba
    // (aquí casi todos comparten hora y coche, y no son de la misma parada).
    // Y entre qué instantes se buscan (los de las dos lecturas de la boya).
    vecinosDe: async (id, mat, desde, hasta) => { AUD.vecinosEntre[id] = [desde, hasta]; return AUD.vecinos[id] || []; },
    ponerAlias: async ({ proveedor, clave, gasolineraId }) => { AUD.alias.set(`${proveedor}|${clave}`, gasolineraId); },
    quitarAlias: async ({ proveedor, clave }) => { AUD.alias.delete(`${proveedor}|${clave}`); },
    paraCasarGasolinera: async () => Object.values(AUD.filas).filter(f => f.estado === 'leido' && (!f.gasolinera_como || ['ninguna', 'ambiguo'].includes(f.gasolinera_como))).map(paraCasar),
    leidosDelProveedor: async p => Object.values(AUD.filas).filter(f => f.estado === 'leido' && f.proveedor === p).map(paraCasar),
    ponerGasolinera: async (id, g) => {
      Object.assign(AUD.filas[id], { gasolinera_id: g.gasolineraId || null, gasolinera_como: g.como });
      if (g.conDistancia) Object.assign(AUD.filas[id], { gps_distancia_m: g.distancia, gps_motivo: g.motivo });
    },
    paraAuditar: async () => AUD.aAuditar.map(id => AUD.filas[id]),
    paraAuditarUno: async id => AUD.filas[id] || null,
    unidadMapon: async (vehiculoId, mat) => (UNIDAD[mat] ? { unitId: UNIDAD[mat], como: 'vehiculos' } : null),
    // Como el de verdad: todas las columnas, con lo que traiga `a` (y lo que no,
    // a NULL). Así un reintento parte de lo que de verdad quedó guardado.
    guardarAuditoria: async (id, a) => {
      if (AUD.guardarRevienta === id) throw new Error('la base dijo que no');
      const f = AUD.filas[id];
      const n = v => (v === undefined ? null : v);
      Object.assign(f, { a, auditoria_estado: a.estado, auditoria_intentos: f.auditoria_intentos + 1, gasolinera_id: a.gasolineraId,
        gasolinera_como: a.gasolineraComo, gps_lat: n(a.gpsLat), gps_lng: n(a.gpsLng), gps_at: a.gpsAt ? new Date(a.gpsAt) : null,
        gps_hasta: a.gpsHasta ? new Date(a.gpsHasta) : null, gps_fuente: a.gpsFuente || null, gps_direccion: a.gpsDireccion || null,
        gps_distancia_m: n(a.distancia), gps_motivo: a.gpsMotivo || null,
        boya_tipo: a.boyaTipo || null, boya_antes: n(a.boyaAntes), boya_despues: n(a.boyaDespues), boya_salto: n(a.boyaSalto),
        boya_techo: n(a.boyaTecho), boya_corregida: a.boyaCorregida == null ? null : !!a.boyaCorregida, boya_litros: n(a.boyaLitros),
        boya_error_pct: n(a.boyaErrorPct), boya_motivo: a.boyaMotivo || null,
        auditoria_detalle: a.detalle ? JSON.parse(JSON.stringify(a.detalle)) : null });
    },
    // La hora buena de una fila del Excel con la hora repetida (probarPasadas).
    moverHoraRepetida: async (id, ms) => { AUD.movidas.push([id, ms]); AUD.filas[id].repostaje_at = new Date(ms); },
    apuntarFallo: async (id, msg) => {
      const f = AUD.filas[id];
      Object.assign(f, { auditoria_intentos: f.auditoria_intentos + 1, auditoria_estado: 'incompleta',
        auditoria_detalle: { ...(f.auditoria_detalle || {}), error: msg } });
    },
    cerrarAuditoriasSinDatos: async () => { AUD.cerrar++; return 0; },
  });
  delete require.cache[require.resolve('../modules/Combustible/combustible.auditoria')];
  const A = require('../modules/Combustible/combustible.auditoria');
  const rep = (id, x) => (AUD.filas[id] = { id, proveedor: 'ballenoil', estado: 'leido', sede: 'madrid', vehiculo_id: 80, auditoria_estado: 'pendiente',
    auditoria_intentos: 0, repostaje_at: new Date(T), ...x, matricula_norm: x.matricula });
  const auditar = async id => { await A.auditarUno(id); return AUD.filas[id].a; };

  // COSLADA: parado 9 minutos a 11 m de Coslada I, y el aforador de 12 a 35 L.
  MAP.paradas['u-coslada'] = [{ ...PARADA, lat: enCoslada.lat, lng: enCoslada.lng, direccion: 'Av. del Jarama, Coslada' },
    { desde: T - 2 * H, hasta: T - H - 10 * MIN, lat: 40.45, lng: -3.6, direccion: 'otra parada' }];
  MAP.series['u-coslada'] = toyota;
  rep(1, { estacion: 'COSLADA', matricula: '8997LDK', litros: 24.405 });
  const a1 = await auditar(1);
  igual('COSLADA: casada con Coslada I, parado allí (la parada que cubre la hora, no la otra), a 11 m: verde',
    [a1.gasolineraComo, a1.gasolineraId === gas('Ballenoil Coslada I').id, a1.gpsFuente, a1.gpsAt === PARADA.desde, a1.distancia, SEM.colorGps(a1.distancia), a1.cercanaM],
    ['exacto', true, 'parada', true, 11, 'verde', 11]);
  igual('…la boya subió 23 L de 24,405: un 5,8 % de error, verde; y la auditoría queda hecha',
    [a1.boyaTipo, a1.boyaAntes, a1.boyaDespues, a1.boyaLitros, a1.boyaErrorPct, SEM.colorBoya(a1.boyaErrorPct), a1.estado, AUD.filas[1].auditoria_intentos],
    ['litros', 12, 35, 23, 5.8, 'verde', 'hecha', 1]);
  igual('…y guarda las lecturas de alrededor para dibujar el aforador en la ficha (como mucho 90)',
    [a1.detalle.boya.lecturas.length > 10, a1.detalle.boya.lecturas.length <= 90, a1.detalle.parada.direccion], [true, true, 'Av. del Jarama, Coslada']);

  // DOS REPOSTAJES EN LA MISMA PARADA (db/215): el 8203LTR pagó 23,93 L con la
  // app y 22,87 L con tarjeta en el mismo minuto. La boya ve UN salto (23 L):
  // con cada uno por separado salía verde; con la suma, falta la mitad.
  rep(40, { estacion: 'COSLADA', matricula: '8997LDK', litros: 23.93 });
  const solo = await auditar(40);
  AUD.vecinos[40] = [{ id: 41, litros: 22.87, hora: '12:57:40' }];
  const pareja = await auditar(40);
  delete AUD.vecinos[40];
  igual('Dos repostajes entre las dos lecturas de la boya: solo, 23 L de 23,93 es un 3,9 % (verde); con el otro (22,87 L), 23 de 46,8: falta un 50,9 %, amarillo, y se dice',
    [solo.boyaErrorPct, pareja.boyaErrorPct, SEM.colorBoya(pareja.boyaErrorPct), pareja.detalle.boya.pagados, pareja.detalle.boya.juntos.length,
      /Entre las dos lecturas hay otro repostaje de este coche \(12:57:40, 22,87 L\): la boya se compara con los 46,8 L de todos/.test(pareja.boyaMotivo)],
    [3.9, 50.9, 'amarillo', 46.8, 1, true]);

  // CLOT: la gasolinera no tiene coordenadas: sin color por GPS, y se dice la más cercana.
  const enElClot = { lat: 41.4087, lng: 2.1872 };
  MAP.paradas['u-clot'] = [{ ...PARADA, ...enElClot, direccion: 'Carrer del Clot, 4, 08018 Barcelona' }];
  MAP.series['u-clot'] = ANTES.concat(tramo(T + 6 * MIN, T + H, 22));
  rep(2, { estacion: 'BARCELONA - CLOT', matricula: '7909LRJ', sede: 'barcelona', litros: 10.372 });
  const a2 = await auditar(2);
  const cercaClot = G.masCercana(enElClot, LISTA);
  igual('CLOT: casada, pero sin coordenadas en la lista: sin metros (sin color por GPS), con el porqué y la más cercana',
    [a2.gasolineraId === gas('Ballenoil Clot').id, a2.distancia, a2.gpsMotivo, a2.cercanaId === cercaClot.gasolinera.id, a2.cercanaM, cercaClot.gasolinera.nombre],
    [true, null, 'Ballenoil Clot no tiene coordenadas en la lista', true, cercaClot.metros, 'Ballenoil Barcelona II - Lope de Vega']);
  igual('…y la boya sí: +10 L de 10,372, un 3,6 %', [a2.boyaSalto, a2.boyaErrorPct, a2.estado], [10, 3.6, 'hecha']);

  // UN COCHE QUE NO ESTÁ EN MAPON: ni GPS ni aforador, pero la gasolinera sí.
  rep(3, { estacion: 'GALAPAGAR', matricula: '0101LTF', vehiculo_id: null, litros: 31.662 });
  const a3 = await auditar(3);
  igual('Sin Mapon: sin GPS ni boya, los dos dicen por qué, la gasolinera casada igual y hecha (no hay nada que esperar)',
    [a3.gasolineraComo, a3.distancia, a3.gpsMotivo, a3.boyaMotivo === a3.gpsMotivo, a3.boyaErrorPct, a3.estado],
    ['exacto', undefined, 'El 0101LTF no está en Mapon: no hay GPS ni aforador que mirar', true, undefined, 'hecha']);
  MAP.padron['0101LTF'] = 'u-padron';
  MAP.paradas['u-padron'] = [{ ...PARADA, lat: gas('Ballenoil Galapagar').lat, lng: gas('Ballenoil Galapagar').lng }];
  MAP.series['u-padron'] = toyota;
  igual('…pero si está en el padrón de Mapon por la matrícula (sin dar de alta en Vehículos), se usa ese equipo',
    (a => [a.detalle.unidad.como, a.distancia, a.boyaSalto])(await auditar(3)), ['padron', 0, 23]);

  // SIN AFORADOR (no da el nivel por el CAN): sin color por boya, y no se reintenta.
  MAP.paradas['u-sin'] = [{ ...PARADA, lat: gas('Ballenoil Barcelona - Asunción').lat, lng: gas('Ballenoil Barcelona - Asunción').lng }];
  rep(4, { estacion: 'BARCELONA- ASUNCION', matricula: '6584KZV', sede: 'barcelona', litros: 29.429 });
  const a4 = await auditar(4);
  igual('Sin aforador: boya «sin», con el porqué; el GPS sí (0 m); hecha',
    [a4.boyaTipo, /no da el nivel del depósito/.test(a4.boyaMotivo), a4.boyaErrorPct, a4.distancia, a4.estado], ['sin', true, undefined, 0, 'hecha']);

  // UN FORD: el nivel en %, en otra serie. Sin la capacidad del depósito, sin litros ni color.
  MAP.paradas['u-ford'] = MAP.paradas['u-coslada'];
  MAP.series['u-ford'] = tramo(T - H, T + H, 0, 3 * MIN);
  MAP.pct['u-ford'] = tramo(T - H, T - 3 * MIN, 20, 3 * MIN).concat(tramo(T + 6 * MIN, T + H, 90, 3 * MIN));
  rep(5, { estacion: 'COSLADA', matricula: '2350LHP', litros: 38 });
  const a5 = await auditar(5);
  igual('Ford: el nivel va en % (+70 %), y sin la capacidad del depósito no hay litros ni error, y se dice',
    [a5.boyaTipo, a5.boyaSalto, a5.boyaLitros, a5.boyaErrorPct, /va en % del depósito/.test(a5.boyaMotivo), a5.estado],
    ['porcentaje', 70, undefined, undefined, true, 'hecha']);
  MAP.capacidad['u-ford'] = 55;
  igual('…con la capacidad en Mapon (55 L): 70 % son 38,5 L, más que lo pagado: no falta nada (0 %; antes, «un 1,3 % de error»)', (a => [a.boyaLitros, a.boyaErrorPct])(await auditar(5)), [38.5, 0]);

  // EL TECHO: topó en 40 L y aún no ha bajado. 25 L de 30: puede ser solo el
  // techo, así que no se pinta; se vuelve a mirar.
  MAP.paradas['u-techo'] = MAP.paradas['u-coslada'];
  MAP.series['u-techo'] = llena.filter(p => p.t < T + 2 * H);
  rep(6, { estacion: 'COSLADA', matricula: '9001LWJ', litros: 30 });
  const a6 = await auditar(6);
  igual('Techo sin bajar aún, y el salto (25 L) por debajo del correo (30): un mínimo, sin error ni color; a medias',
    [a6.boyaTecho, a6.boyaLitros, a6.boyaErrorPct, /al menos 25 L/.test(a6.boyaMotivo), a6.estado], [40, 25, undefined, true, 'incompleta']);
  rep(7, { estacion: 'COSLADA', matricula: '9001LWJ', litros: 15 });
  // Solo cuenta lo que falta (23/10/2026): hasta entonces esto era «como poco
  // un 66,7 % de error», rojo, por subir de más.
  igual('…pero si el mínimo ya pasa de lo pagado (25 L de 15), como poco entró lo pagado: 0 %, verde (y se sigue mirando para corregirlo)',
    (a => [a.boyaErrorPct, SEM.colorBoya(a.boyaErrorPct, { minimo: true }), a.estado])(await auditar(7)), [0, 'verde', 'incompleta']);
  MAP.series['u-techo'] = llena;
  MAP.gk['u-techo'] = { gastado: [], km: tramo(T - 2 * H, T + 4 * H, t => 1000 + 50 * (t - T) / H, MIN) };
  igual('…cuando baja, se corrige con lo que gastó desde la lectura de después (74 km, 3,5 L) más lo de entre medias (37,5 km, 1,8 L): 36 + 3,5 + 1,8 − 15 = 26,3 L de 30, un 12,3 %, y hecha',
    (a => [a.boyaCorregida, a.boyaLitros, a.boyaErrorPct, a.estado, a.detalle.boya.correccion.como, a.detalle.boya.andando])(await auditar(6)),
    [true, 26.3, 12.3, 'hecha', '74 km a 4,77 L/100 km', { km: 37.5, litros: 1.8 }]);

  // APARCA AL POCO DE REPOSTAR (el 3784LFV, 23/10/2026): el «después» es de
  // hora y media más tarde, cuando vuelve a arrancar, y aparcado no llegan km.
  // Los km se piden desde antes del repostaje: si se pidieran desde el
  // «después», la serie empezaría pasado ese instante y no habría corrección.
  const kmA = t => 1000 + 50 * (Math.min(t, T - 3 * MIN) - (T - H)) / H + 50 * Math.max(0, Math.min(t, T + 7 * MIN) - (T + 6 * MIN)) / H
    + 50 * Math.max(0, t - (T + 90 * MIN)) / H;
  MAP.paradas['u-aparca'] = MAP.paradas['u-coslada'];
  MAP.series['u-aparca'] = ANTES.map(q => ({ ...q, v: 15 })).concat(tramo(T + 6 * MIN, T + 7 * MIN, 40), tramo(T + 90 * MIN, T + 3 * H - 30e3, 40), tramo(T + 3 * H, T + 4 * H, 36));
  MAP.gk['u-aparca'] = { km: [T - H, T + 6 * MIN, T + 90 * MIN].flatMap((d, i) => tramo(d + 10e3, [T - 3 * MIN, T + 7 * MIN, T + 4 * H][i], kmA)) };
  UNIDAD['3784LFV'] = 'u-aparca';
  rep(12, { estacion: 'HOSPITALET DE LLOBREGAT (L´)', matricula: '3784LFV', sede: 'barcelona', litros: 25.221 });
  igual('Aparca al poco de repostar: la lectura de después es de cuando vuelve a andar (T + 90), el techo se corrige con los km desde ahí (36 + 3,5 − 15 = 24,5 L) y lo de entre medias, solo lo que anduvo (11 km, 0,5 L): 25 L',
    (a => [a.boyaCorregida, a.boyaLitros, a.detalle.boya.correccion && a.detalle.boya.correccion.como, a.detalle.boya.andando, (Date.parse(a.detalle.boya.tDespues) - T) / MIN,
      a.detalle.boya.arranque, a.estado])(await auditar(12)),
    [true, 25, '74 km a 4,77 L/100 km', { km: 11, litros: 0.5 }, 90, undefined, 'hecha']);

  // AÚN SIN LECTURAS DE DESPUÉS (el 3814KYG a las 16:57 del 22/10): no es un 0, se espera.
  MAP.paradas['u-espera'] = MAP.paradas['u-sin'];
  MAP.series['u-espera'] = ANTES;
  rep(8, { estacion: 'BARCELONA- ASUNCION', matricula: '3814KYG', sede: 'barcelona', litros: 21.901 });
  const a8 = await auditar(8);
  igual('Sin lecturas de después todavía: el GPS ya vale (0 m), la boya espera, y queda a medias para volver a mirarla',
    [a8.distancia, a8.boyaErrorPct, /Todavía no hay lecturas/.test(a8.boyaMotivo), a8.estado], [0, undefined, true, 'incompleta']);
  // db/216 SOLO TOCA LO DEL CÓDIGO DE ANTES (revisión del 23/10/2026): miraba la
  // marca de la boya (regla 'ventana'), que solo está si la ventana midió; esta
  // a medias no la lleva y la migración le habría puesto una boyaAntes falsa.
  // Ahora mira la versión del detalle, que el código de ahora escribe siempre.
  const sql216 = require('fs').readFileSync(path.join(__dirname, '..', 'db', '216-boya-ventana-fija.sql'), 'utf8');
  const where216 = sql216.slice(sql216.lastIndexOf('WHERE'), sql216.indexOf(';', sql216.lastIndexOf('WHERE')));
  igual('…y aunque no mida la boya, el detalle va con la versión 3: db/216 lo deja (su condición es la versión, < 3, no la marca de la boya)',
    [a8.detalle.version, a8.detalle.boya, /COALESCE\(\(auditoria_detalle ->> 'version'\)::int, 0\) < 3/.test(where216), /regla/.test(where216)],
    [3, undefined, true, false]);
  // Las horas del pasado no llegan: sin lecturas de antes, hecha (no se reintenta).
  MAP.paradas['u-sinantes'] = MAP.paradas['u-sin'];
  MAP.series['u-sinantes'] = tramo(T + 2 * MIN, T + 2 * H, 40);
  UNIDAD['3814KYJ'] = 'u-sinantes';
  rep(37, { estacion: 'BARCELONA- ASUNCION', matricula: '3814KYJ', sede: 'barcelona', litros: 21.901 });
  igual('Sin lecturas del aforador de antes en los 3 días de la serie: la boya sin medir, con el porqué, y hecha (no se espera a nada)',
    (a => [a.boyaLitros, /^No hay lecturas del aforador en las 72 horas antes de las 12:42/.test(a.boyaMotivo), a.estado])(await auditar(37)),
    [undefined, true, 'hecha']);

  // LA VENTANA FIJA, DE PUNTA A PUNTA (23/10/2026).
  // Sin los km de Mapon, no se suma lo gastado entre medias, y se dice.
  igual('Sin los km de Mapon de esas horas, el salto va tal cual (23 L) y la boya lo dice',
    [a1.boyaLitros, /Sin los km de Mapon de esas horas no se suma lo que gastó entre las dos lecturas/.test(a1.boyaMotivo), a1.detalle.boya.andando,
      (a1.detalle.boya.instantes.antes === new Date(T - 15 * MIN).toISOString()) && (a1.detalle.boya.instantes.despues === new Date(T + 30 * MIN).toISOString())],
    [23, true, undefined, true]);
  // EL QUE ANDA ENTRE MEDIAS: a 30 km/h de T − 15 a T + 30 gasta 1,1 L, que el
  // aforador no ve como subida: se suma.
  MAP.paradas['u-anda'] = MAP.paradas['u-coslada'];
  MAP.series['u-anda'] = toyota;
  MAP.gk['u-anda'] = { gastado: [], km: kmAnda };
  UNIDAD['8997LDP'] = 'u-anda';
  rep(31, { estacion: 'COSLADA', matricula: '8997LDP', litros: 24.405 });
  igual('El coche que anda entre las dos lecturas: 23 L de salto + 1,1 L gastados (22,5 km) = 24,1 L de 24,405: un 1,2 %, y no lo de antes (5,8 %)',
    (a => [a.boyaSalto, a.boyaLitros, a.boyaErrorPct, a.detalle.boya.andando, /Sin los km/.test(a.boyaMotivo || '')])(await auditar(31)),
    [23, 24.1, 1.2, { km: 22.5, litros: 1.1 }, false]);
  igual('…y los otros repostajes del coche que suman con este son los de entre sus dos lecturas (T − 15 a T + 30), no los de la parada',
    AUD.vecinosEntre[31].map(t => (t - T) / MIN), [-15, 30]);
  // CUANDO LA CIFRA LA DECIDEN LOS KM (revisión del 23/10/2026): un aforador
  // que solo lee cuando cambia (el de los Ioniq), con la lectura de después a
  // 3 h y 100 km entre medias. Se dice, para mirarlo en el dibujo.
  MAP.paradas['u-km'] = MAP.paradas['u-coslada'];
  MAP.series['u-km'] = [{ t: T - 2 * H, v: 31 }, { t: T - 20 * MIN, v: 30 }, { t: T + 3 * H, v: 32 }, { t: T + 3.6 * H, v: 31 }];
  MAP.gk['u-km'] = { gastado: [], km: tramo(T - 3 * H, T + 4 * H, t => 1000 + 30 * (t - (T - 3 * H)) / H, MIN) };
  UNIDAD['9775LRJ'] = 'u-km';
  rep(38, { estacion: 'COSLADA', matricula: '9775LRJ', litros: 7 });
  igual('Más de la mitad de los litros salen de los km (2 L del aforador + 4,8 L de 100 km): verde, pero se dice',
    (a => [a.boyaLitros, a.boyaErrorPct, a.detalle.boya.deKm,
      /^Más de la mitad de estos litros \(4,8 de 6,8\) no los marcó el aforador: salen de los 100 km que anduvo, a 4,77 L\/100 km/.test(a.boyaMotivo)])(await auditar(38)),
    [6.8, 2.9, { litros: 4.8, km: 100 }, true]);
  igual('…y lo del coche que anda 22,5 km en un repostaje de 24 L no se dice', /Más de la mitad/.test(AUD.filas[31].boya_motivo || ''), false);
  // …ni con el depósito quieto y 2 km (0,1 de 0,1 L: el 8512LDS): no dice nada.
  MAP.paradas['u-quieto'] = MAP.paradas['u-coslada'];
  MAP.series['u-quieto'] = ANTES.map(q => ({ ...q, v: 14 })).concat(tramo(T + 6 * MIN, T + H, t => (t < T + 40 * MIN ? 14 : 14), 30e3));
  MAP.gk['u-quieto'] = { gastado: [], km: tramo(T - 2 * H, T + 2 * H, t => 1000 + Math.max(0, Math.min(t, T + 30 * MIN) - (T - 15 * MIN)) / H * 2.7, MIN) };
  UNIDAD['8512LDT'] = 'u-quieto';
  rep(39, { estacion: 'COSLADA', matricula: '8512LDT', litros: 11.7 });
  igual('…ni con el depósito quieto y 2 km entre medias (0,1 L de 0,1): rojo, sin el aviso de los km',
    (a => [a.boyaLitros, SEM.colorBoya(a.boyaErrorPct), /Más de la mitad/.test(a.boyaMotivo || '')])(await auditar(39)), [0.1, 'rojo', false]);
  igual('…y el dibujo solo guarda las lecturas de T − 60 a T + 90 (la de después, a 3 h, se dice aparte)',
    AUD.filas[38].auditoria_detalle.boya.lecturas.map(q => (q[0] - T) / MIN), [-20]);

  // EL DE LA CAPTURA (1212MJY, 22/10/2026 17:46:16, Petroprix Móstoles 2,
  // 30,69 L): la regla de antes daba 38 → 39 L, un 95 % rojo. Con la ventana
  // fija, 9 → 40: en el techo (40 L) y sin bajar, un mínimo que ya llega a lo
  // pagado, verde; o sin color si no llegara. Nunca rojo.
  MAP.paradas['u-1212'] = [{ ...paradaTarde, lat: 40.3365, lng: -3.8807, direccion: 'Pol. Ind. 1-Calle E, 18, Móstoles' }];
  MAP.series['u-1212'] = mjy;
  UNIDAD['1212MJY'] = 'u-1212';
  rep(32, { proveedor: 'petroprix', origen: 'excel', estacion: 'Móstoles 2\nPol. Ind. 1-Calle E, 18 28938', matricula: '1212MJY', litros: 30.69, repostaje_at: new Date(T12) });
  const c1212 = await auditar(32);
  igual('El de la captura: 9 → 40 L, en el techo y sin bajar todavía: al menos 31 L de 30,69, verde (y a medias, para corregirlo cuando baje); nunca rojo',
    [c1212.boyaAntes, c1212.boyaDespues, c1212.boyaTecho, c1212.boyaLitros, c1212.boyaErrorPct, SEM.colorBoya(c1212.boyaErrorPct, { minimo: BOYA.esMinimo(AUD.filas[32]) }), c1212.estado],
    [9, 40, 40, 31, 0, 'verde', 'incompleta']);
  // …y cuando baja del techo (38 L a las 19:00), con los km de Mapon (a 30 km/h):
  // 38 + lo gastado desde las 18:16 hasta que bajó + lo de entre medias − 9.
  MAP.series['u-1212'] = mjy.concat(tramo(hora(19, 0), hora(20, 0), 38));
  MAP.gk['u-1212'] = { gastado: [], km: tramo(hora(17, 0), hora(20, 30), t => 140000 + 30 * (t - hora(17, 0)) / H, MIN) };
  const c1212b = await auditar(32);
  igual('…cuando baja del techo, corregido: 38 + 0,8 L (16,5 km desde las 18:16 hasta que bajó) + 1,1 L (22,8 km de entre medias) − 9 = 30,9 L de 30,69: 0 %, verde, y hecha',
    [c1212b.boyaCorregida, c1212b.boyaLitros, c1212b.boyaErrorPct, SEM.colorBoya(c1212b.boyaErrorPct), c1212b.estado, c1212b.detalle.boya.andando],
    [true, 30.9, 0, 'verde', 'hecha', { km: 22.8, litros: 1.1 }]);

  // SOLO LA BOYA (db/216): lo auditado con la boya de antes vuelve a la cola
  // con `soloBoya`. El GPS se queda (la distancia se rehace con la posición
  // guardada) y a Mapon no se le piden ni paradas ni posiciones.
  const enParada = { lat: enCoslada.lat, lng: enCoslada.lng };
  rep(33, { estacion: 'COSLADA', matricula: '8997LDK', litros: 24.405, auditoria_intentos: 1,
    gps_lat: enParada.lat, gps_lng: enParada.lng, gps_fuente: 'parada', gps_at: new Date(PARADA.desde), gps_hasta: new Date(PARADA.hasta), gps_direccion: 'Av. del Jarama, Coslada',
    auditoria_detalle: { version: 2, soloBoya: 'db/216', parada: { desde: new Date(PARADA.desde).toISOString(), hasta: new Date(PARADA.hasta).toISOString(), direccion: 'Av. del Jarama, Coslada' },
      boyaAntes: { regla: 'parada', antes: 13, despues: 35, litros: 22, deficitPct: 9.9 } } });
  MAP.pedido = [];
  const sb = await auditar(33);
  igual('Solo la boya: ni paradas ni posición a Mapon; el GPS de antes se queda (11 m, la parada, su dirección) y la boya se mide con la ventana fija (23 L)',
    [MAP.pedido, sb.distancia, sb.gpsFuente, sb.gpsDireccion, sb.detalle.parada.direccion, sb.boyaSalto, sb.detalle.boya.regla, sb.estado],
    [[], 11, 'parada', 'Av. del Jarama, Coslada', 'Av. del Jarama, Coslada', 23, 'ventana', 'hecha']);
  igual('…hecha, la marca se va; lo que decía la boya de antes se guarda (boyaAntes); el detalle pasa a la versión 3',
    [sb.detalle.soloBoya, sb.detalle.boyaAntes, sb.detalle.version], [undefined, { regla: 'parada', antes: 13, despues: 35, litros: 22, deficitPct: 9.9 }, 3]);
  // …y si aún no hay lecturas de después, sigue marcada: el reintento tampoco pregunta el GPS.
  MAP.series['u-solo'] = ANTES;
  UNIDAD['8997LDR'] = 'u-solo';
  rep(34, { estacion: 'COSLADA', matricula: '8997LDR', litros: 24.405, gps_lat: enParada.lat, gps_lng: enParada.lng, gps_fuente: 'punto', gps_at: new Date(T),
    auditoria_detalle: { soloBoya: 'db/216', punto: { t: new Date(T).toISOString() } } });
  MAP.pedido = [];
  igual('…a medias, sigue marcada (ni paradas ni posición en el reintento)', (a => [a.estado, a.detalle.soloBoya, a.distancia, MAP.pedido])(await auditar(34)),
    ['incompleta', 'db/216', 11, []]);
  // …y si el coche ya no sale en Mapon, el GPS que se midió se queda igual.
  rep(35, { estacion: 'COSLADA', matricula: '0000ZZZ', vehiculo_id: null, litros: 24.405, gps_lat: enParada.lat, gps_lng: enParada.lng, gps_fuente: 'parada',
    gps_at: new Date(PARADA.desde), gps_hasta: new Date(PARADA.hasta), auditoria_detalle: { soloBoya: 'db/216' } });
  igual('…y si el coche ya no sale en Mapon, el GPS de antes se queda (11 m) y la boya dice por qué no hay',
    (a => [a.distancia, a.gpsFuente, /no está en Mapon/.test(a.boyaMotivo), a.estado])(await auditar(35)), [11, 'parada', true, 'hecha']);
  // Y en una pasada: un grupo con solo esos no pide paradas (`gps: false`).
  const gSolo = A._agrupar([{ rep: { auditoria_detalle: { soloBoya: 'db/216' } }, t: T, unidad: { unitId: 'u9' } }, { rep: { auditoria_detalle: { soloBoya: 'db/216' } }, t: T + H, unidad: { unitId: 'u9' } },
    { rep: {}, t: T, unidad: { unitId: 'u8' } }], T + 30 * 24 * H);
  igual('En una pasada, el grupo de un coche con solo «solo la boya» no pide paradas; los km van con el grupo (de 3 h antes a 2 h después)',
    gSolo.map(g => [g.unidad.unitId, g.gps, (g.km[1] - g.km[0]) / H]), [['u9', false, 6], ['u8', true, 5]]);

  // MAPON FALLA a media auditoría: no lanza, dice qué, queda a medias y NO
  // BORRA lo que ya se había medido (revisión del 23/10/2026).
  MAP.revienta = 'paradas';
  const a1b = await auditar(1);
  igual('Mapon no contesta al pedir las paradas: el GPS de la vez anterior se queda (11 m, la parada), la boya se mide igual (no depende de la parada) y a medias',
    [/^Mapon no contestó/.test((a1b.detalle.fallos || {}).gps), a1b.distancia, a1b.gpsFuente, a1b.gpsAt === PARADA.desde, a1b.gpsMotivo, a1b.boyaSalto,
      (a1b.detalle.boya || {}).regla, (a1b.detalle.parada || {}).direccion, a1b.estado],
    [true, 11, 'parada', true, null, 23, 'ventana', 'Av. del Jarama, Coslada', 'incompleta']);
  MAP.revienta = 'nivel';
  igual('…y al pedir el aforador, la boya de la vez anterior se queda (23 L, 5,8 %) y el GPS se mide',
    (a => [/^Mapon no contestó al pedir el aforador/.test((a.detalle.fallos || {}).boya), a.boyaSalto, a.boyaErrorPct, ((a.detalle.boya || {}).lecturas || []).length > 10,
      a.distancia, a.estado])(await auditar(1)), [true, 23, 5.8, true, 11, 'incompleta']);
  // Sin nada de antes, se dice por qué no hay dato.
  rep(15, { estacion: 'COSLADA', matricula: '8997LDK', litros: 24.405 });
  igual('…y si no había nada de antes, se queda sin boya y dice por qué',
    (a => [/^Mapon no contestó al pedir el aforador/.test(a.boyaMotivo), a.boyaSalto, a.distancia])(await auditar(15)), [true, undefined, 11]);
  // LA BOYA DE LA REGLA DE ANTES NO SE DEVUELVE (revisión del 23/10/2026): un
  // reintento del código nuevo la ponía otra vez con la versión 3 encima, y
  // db/216 ya no la reconocía (la de antes, un 95 % rojo en el 1212MJY).
  rep(36, { estacion: 'COSLADA', matricula: '8997LDK', litros: 24.405, auditoria_estado: 'incompleta', boya_tipo: 'litros', boya_antes: 38, boya_despues: 39,
    boya_salto: 1, boya_litros: 1.5, boya_error_pct: 93.9, boya_motivo: 'de la regla de antes', auditoria_detalle: { version: 2, boya: { lecturas: [] } } });
  igual('…una boya de la regla de antes (versión 2 del detalle) no se devuelve: sin boya, con el porqué, versión 3 y a medias',
    (a => [a.boyaSalto, a.boyaLitros, a.boyaErrorPct, /^Mapon no contestó al pedir el aforador/.test(a.boyaMotivo), a.detalle.boya, a.detalle.version, a.estado])(await auditar(36)),
    [undefined, undefined, undefined, true, undefined, 3, 'incompleta']);
  MAP.revienta = 'paradas';
  rep(16, { estacion: 'COSLADA', matricula: '8997LDK', litros: 24.405 });
  igual('…ni GPS: sin posición de antes, sin metros y con el porqué', (a => [/^Mapon no contestó/.test(a.gpsMotivo), a.distancia])(await auditar(16)), [true, null]);
  MAP.revienta = null;

  // EL N.º 20 (3814KYG): el GPS bueno a la primera y la boya en el techo; en el
  // segundo intento Mapon no da las paradas. La distancia tiene que seguir ahí.
  MAP.paradas['u-n20'] = [{ ...PARADA, lat: gas('Ballenoil Barcelona - Asunción').lat + 0.0001, lng: gas('Ballenoil Barcelona - Asunción').lng, direccion: 'Asunción' }];
  MAP.series['u-n20'] = ANTES.map(q => ({ ...q, v: 16 })).concat(tramo(T + 6 * MIN, T + H, 45));
  UNIDAD['3814KYH'] = 'u-n20';
  rep(17, { estacion: 'BARCELONA- ASUNCION', matricula: '3814KYH', sede: 'barcelona', litros: 25.539 });
  const n20a = await auditar(17);
  MAP.revienta = 'paradas';
  const n20b = await auditar(17);
  MAP.revienta = null;
  igual('N.º 20: primer intento con el GPS a 11 m y la boya en el techo (al menos 29 L, un mínimo); a medias',
    [n20a.distancia, n20a.boyaLitros, n20a.boyaErrorPct, BOYA.esMinimo(AUD.filas[17]), SEM.colorBoya(n20a.boyaErrorPct, { minimo: true }), n20a.estado],
    [11, 29, 0, true, 'verde', 'incompleta']);
  igual('…segundo intento sin paradas de Mapon: la distancia sigue (11 m), la boya se mide igual con su ventana fija, y sigue a medias',
    [n20b.distancia, n20b.gpsFuente, (n20b.detalle.boya || {}).regla, n20b.boyaLitros, AUD.filas[17].gps_distancia_m, n20b.estado],
    [11, 'parada', 'ventana', 29, 11, 'incompleta']);
  igual('…y el mínimo lo dice: al menos 29 L, más que lo pagado (verde desde el 23/10/2026; antes, «como poco un 13,6 %», sin color)',
    /al menos 29 L, más que lo pagado: como poco entró lo pagado/.test(n20a.boyaMotivo), true);

  // SIN PARADA: la posición de Mapon en ese instante, si está a menos de 20 min.
  MAP.paradas['u-coslada'] = [];
  MAP.puntos['u-coslada'] = { t: T + 3 * MIN, lat: enCoslada.lat, lng: enCoslada.lng };
  igual('Sin parada: su posición a esa hora (punto a 3 min), a 11 m', (a => [a.gpsFuente, a.distancia, a.estado])(await auditar(1)), ['punto', 11, 'hecha']);
  MAP.puntos['u-coslada'] = { t: T + 45 * MIN, lat: enCoslada.lat, lng: enCoslada.lng };
  igual('…pero un punto de 45 min después no dice dónde repostó: sin GPS, se dice, y a medias',
    (a => [a.distancia, a.gpsMotivo, a.estado])(await auditar(1)),
    [undefined, 'Mapon no tiene al coche parado a esa hora, y su posición más cercana es de 45 min después: no vale para decir dónde repostó', 'incompleta']);
  MAP.paradas['u-coslada'] = [{ ...PARADA, lat: enCoslada.lat, lng: enCoslada.lng }];

  // La parada: SOLO la que cubre la hora (el minuto del correo). Una de al lado
  // queda como «cerca», para mirar si el coche seguía allí (revisión del
  // 23/10/2026: el n.º 16 cogía una que había acabado 5 min antes).
  const pd = (ps, t = T) => (r => [r.cubre ? (r.cubre.desde - T) / MIN : null, r.cerca ? (r.cerca.desde - T) / MIN : null])(A._paradaDe(ps, t));
  igual('La parada: la que cubre la hora; una que empieza dentro del minuto del correo también; abierta, también',
    [pd([{ desde: T - H, hasta: T - 10 * MIN }, PARADA]), pd([{ desde: T + 0.5 * MIN, hasta: T + 9 * MIN }]), pd([{ desde: T - 3 * MIN, hasta: null }])],
    [[-3, null], [0.5, null], [-3, null]]);
  igual('…una que empieza 4 min después o acabó 1 min antes NO la cubre: queda «cerca»; a 6 min, ni eso',
    [pd([{ desde: T + 4 * MIN, hasta: T + 9 * MIN }]), pd([{ desde: T - 20 * MIN, hasta: T - MIN }]), pd([{ desde: T + 6 * MIN, hasta: T + 9 * MIN }])],
    [[null, 4], [null, -20], [null, null]]);

  // EL N.º 16 (8997LDK, 00:05): parado hasta las 00:00 en la Av. de Burgos y a
  // las 00:04:59 ya a 1,7 km de allí. Manda dónde estaba, no la parada.
  const burgos = { lat: 40.4950, lng: -3.6680 }, andando = { lat: 40.50926, lng: -3.67834 };
  MAP.paradas['u-n16'] = [{ desde: T - 51 * MIN, hasta: T - 5 * MIN, ...burgos, direccion: 'Av. de Burgos' }];
  MAP.puntos['u-n16'] = { t: T - 1e3, ...andando };
  // Un Ioniq: su techo (44 L) sale de la víspera; esa noche marcaba 40.
  MAP.series['u-n16'] = tramo(T - 30 * H, T - 29 * H, 44, MIN).concat(tramo(T - 2 * H, T - 51 * MIN, 40), tramo(T - 5 * MIN, T + H, 40));
  UNIDAD['8997LDL'] = 'u-n16';
  rep(18, { estacion: 'ALCALA DE HENARES', matricula: '8997LDL', litros: 24.86 });
  const n16 = await auditar(18);
  igual('N.º 16: la parada acabó 5 min antes y el coche ya iba andando: manda su posición a esa hora, y se cuenta dónde estuvo parado',
    [n16.gpsFuente, n16.gpsLat, n16.detalle.paradaCerca.direccion, n16.detalle.paradaCerca.metros === G.metros(burgos, andando) && n16.detalle.paradaCerca.metros > 1600, n16.detalle.boya.regla,
      n16.distancia === G.metros(andando, gas('Ballenoil Alcalá de Henares')), SEM.colorGps(n16.distancia), n16.boyaSalto, n16.boyaErrorPct],
    ['punto', andando.lat, 'Av. de Burgos', true, 'ventana', true, 'rojo', 0, 100]);
  // EL RELOJ DEL CORREO Y EL DE MAPON: paró 3 min después de la hora del correo
  // y a esa hora el coche ya estaba a 30 m: es esa parada.
  const surtidor = { lat: gas('Ballenoil Coslada I').lat, lng: gas('Ballenoil Coslada I').lng };
  MAP.paradas['u-reloj'] = [{ desde: T + 3 * MIN, hasta: T + 9 * MIN, ...surtidor, direccion: 'Av. del Jarama' }];
  MAP.puntos['u-reloj'] = { t: T, lat: surtidor.lat + 0.00027, lng: surtidor.lng };
  MAP.series['u-reloj'] = tramo(T - H, T + 3 * MIN, 12).concat(tramo(T + 9 * MIN, T + H, 35));
  UNIDAD['8997LDM'] = 'u-reloj';
  rep(19, { estacion: 'COSLADA', matricula: '8997LDM', litros: 24.405 });
  const reloj = await auditar(19);
  igual('Relojes distintos: la parada empieza 3 min después pero a esa hora ya estaba a 30 m: se toma la parada (y se dice); la boya, con su ventana',
    [reloj.gpsFuente, reloj.distancia, reloj.detalle.parada.noCubre, reloj.detalle.boya.regla, reloj.boyaSalto],
    ['parada', 0, { antes: true, minutos: 3, metros: 30 }, 'ventana', 23]);
  MAP.puntos['u-reloj'] = null;
  igual('…y si Mapon no da su posición a esa hora, la parada de al lado es lo que hay (sin metros a la parada)',
    (a => [a.gpsFuente, a.distancia, a.detalle.parada.noCubre])(await auditar(19)), ['parada', 0, { antes: true, minutos: 3, metros: null }]);

  // UNA «PARADA» DE 24 H CON EL AFORADOR MOVIÉNDOSE (el 9521MMX, 12/10/2026):
  // el GPS se quedó clavado en San Fernando y el coche andaba (el aforador solo
  // lee encendido): bajó de 31 a 20 L, repostó 18 L en Coslada a la hora del
  // correo y siguió bajando. El GPS no vale (sin color) y la boya, sin parada.
  const sanFernando = { lat: 40.4434, lng: -3.4994 };
  MAP.paradas['u-roto'] = [{ desde: T - 10 * H, hasta: T + 14 * H, ...sanFernando, direccion: 'San Fernando de Henares' }];
  MAP.puntos['u-roto'] = { t: T, ...sanFernando };
  MAP.series['u-roto'] = tramo(T - 10 * H, T - 10 * MIN, t => Math.round(31 - 11 * (t - (T - 10 * H)) / (10 * H)), MIN)
    .concat(tramo(T + 10 * MIN, T + 14 * H, t => Math.round(38 - 10 * (t - T) / (14 * H)), MIN));
  UNIDAD['9521MMX'] = 'u-roto';
  rep(21, { estacion: 'COSLADA', matricula: '9521MMX', litros: 18 });
  const roto = await auditar(21);
  igual('Una «parada» de 24 h con el aforador moviéndose: el GPS no vale (sin metros, sin color, y se dice), y la boya, que no la mira: +18 L de 18, verde',
    [roto.distancia, /el coche andaba y su GPS no lo vio/.test(roto.gpsMotivo), (roto.detalle.paradaRota || {}).horas, (r => !!r && r.max - r.min >= 3)(roto.detalle.paradaRota),
      (roto.detalle.boya || {}).regla, roto.boyaSalto, roto.boyaErrorPct, roto.estado],
    [null, true, 24, true, 'ventana', 18, 0, 'hecha']);
  // La misma parada de 24 h con el aforador quieto: el coche estaba aparcado de
  // verdad, lejos de la gasolinera, y eso es justo lo que hay que ver.
  MAP.series['u-roto'] = tramo(T - 30 * H, T - 10 * H, 31, MIN).concat(tramo(T + 14 * H, T + 16 * H, 31, MIN));
  const aparcado = await auditar(21);
  igual('…pero si dentro el aforador no se mueve (aparcado de verdad), la parada vale: se mide desde ella, rojo por el GPS',
    [aparcado.gpsFuente, aparcado.distancia > 1600, SEM.colorGps(aparcado.distancia), !!aparcado.detalle.paradaRota], ['parada', true, 'rojo', false]);
  // EL EQUIPO SIN SEÑAL (el 0454MMZ, 04/10/2026): Mapon lo da «parado» 5,8 h
  // en el Paseo de Extremadura, a 9,6 km, sin una lectura dentro, y al arrancar
  // el depósito tiene 13 L más. Un coche aparcado no reposta: no vale (aquí,
  // 12 L: con 38, el techo del aforador, sería un mínimo).
  MAP.paradas['u-roto'] = [{ desde: T - 2 * MIN, hasta: T + 5.8 * H, ...sanFernando, direccion: 'Paseo de Extremadura, 148' }];
  MAP.series['u-roto'] = tramo(T - 3 * H, T - 2 * MIN, 25, MIN).concat(tramo(T + 5.8 * H, T + 8 * H, 37, MIN));
  rep(23, { estacion: 'COSLADA', matricula: '9521MMX', litros: 17.92 });
  const sinSenal = await auditar(23);
  igual('Una parada de 5,8 h lejos, sin lecturas dentro y con 12 L más al arrancar: el GPS no vale (sin color); la boya, con su ventana: 12 L de 17,92, verde',
    [sinSenal.distancia, /al arrancar tenía 12 L más \(25 → 37\): repostó en ese rato y su GPS no lo vio/.test(sinSenal.gpsMotivo), (sinSenal.detalle.paradaRota || {}).como,
      (sinSenal.detalle.boya || {}).regla, sinSenal.boyaSalto, SEM.colorBoya(sinSenal.boyaErrorPct)],
    [null, true, 'sube', 'ventana', 12, 'verde']);
  // …la misma, pero en la gasolinera (repostó y se quedó hora y media): vale.
  MAP.paradas['u-roto'] = [{ desde: T - 2 * MIN, hasta: T + 1.5 * H, ...surtidor, direccion: 'Coslada' }];
  MAP.series['u-roto'] = tramo(T - 3 * H, T - 2 * MIN, 25, MIN).concat(tramo(T + 1.5 * H, T + 3 * H, 38, MIN));
  igual('…en la gasolinera, repostar dentro de una parada larga es lo normal: la parada vale (0 m, verde)',
    (a => [a.gpsFuente, a.distancia, !!a.detalle.paradaRota])(await auditar(23)), ['parada', 0, false]);
  // …y una lejos tras la que el depósito BAJA (el 8512LDS en L'Hospitalet): vale, y es rojo.
  MAP.paradas['u-roto'] = [{ desde: T - 80 * MIN, hasta: T + 40 * MIN, ...sanFernando, direccion: 'Granvia de l\'Hospitalet, 136' }];
  MAP.series['u-roto'] = tramo(T - 3 * H, T - 80 * MIN, 30, MIN).concat(tramo(T + 40 * MIN, T + 3 * H, 29, MIN));
  igual('…y una de 2 h lejos tras la que el depósito no sube (el 8512LDS): vale, rojo por los dos lados',
    (a => [a.gpsFuente, SEM.colorGps(a.distancia), SEM.colorBoya(a.boyaErrorPct), !!a.detalle.paradaRota])(await auditar(23)), ['parada', 'rojo', 'rojo', false]);
  // …y una de horas «de al lado» (aparcado en casa toda la noche, 3 min de
  // camino y repostó sin apagar el coche): el depósito sube después, en la
  // gasolinera, y eso no la hace falsa. A esa hora estaba en el surtidor.
  MAP.paradas['u-roto'] = [{ desde: T - 8 * H, hasta: T - 3 * MIN, ...sanFernando, direccion: 'en casa' }];
  MAP.puntos['u-roto'] = { t: T, ...surtidor };
  MAP.series['u-roto'] = tramo(T - 9 * H, T - 8 * H, 20, MIN).concat(tramo(T - 3 * MIN, T + H, t => (t < T ? 20 : 35), MIN));
  igual('…una parada larga «de al lado» no se toma por falsa porque el depósito suba después: manda dónde estaba (en el surtidor, 0 m)',
    (a => [a.gpsFuente, a.distancia, !!a.detalle.paradaRota])(await auditar(23)), ['punto', 0, false]);
  MAP.puntos['u-roto'] = null;

  // LA PARADA ABIERTA (el 0626MMZ, 26/10/2026): Mapon lo daba «parado desde las
  // 00:00» a 8 km, con la parada aún sin cerrar, y esa noche hizo 14 viajes de
  // BOLT. Dentro, hasta la hora del repostaje, el aforador baja de 37 a 29 L: andaba.
  const odonnell = { lat: 40.4150, lng: -3.64542 };
  UNIDAD['0626MMZ'] = 'u-abierta';
  MAP.paradas['u-abierta'] = [{ desde: T - 6 * H, hasta: null, ...odonnell, direccion: 'Ctra. Eje O\'Donnell' }];
  MAP.series['u-abierta'] = tramo(T - 6 * H, T - 10 * MIN, t => Math.round(37 - 9 * (t - (T - 6 * H)) / (6 * H)), 4 * MIN)
    .concat(tramo(T + 5 * MIN, T + H, 44, MIN));
  rep(24, { estacion: 'COSLADA', matricula: '0626MMZ', litros: 16.45 });
  const abierta = await auditar(24);
  igual('Una parada ABIERTA lejos con el aforador moviéndose dentro hasta la hora (de 37 a 29 L, el 0626MMZ): el GPS no vale (sin color) y lo dice sin inventarse un final',
    [abierta.distancia, /^Mapon da el coche parado desde las \d\d:\d\d en Ctra\. Eje O'Donnell sin cerrar la parada \(6 h hasta la hora del repostaje\), pero dentro el aforador fue de 29 a 37 L: el coche andaba/.test(abierta.gpsMotivo),
      /01:00/.test(abierta.gpsMotivo), (abierta.detalle.paradaRota || {}).abierta, (abierta.detalle.paradaRota || {}).hasta, (abierta.detalle.paradaRota || {}).medidoHasta],
    [null, true, false, true, null, new Date(T).toISOString()]);
  // …la misma, sin una lectura dentro: el motor apagado, aparcado de verdad.
  MAP.series['u-abierta'] = tramo(T - 9 * H, T - 6 * H, 30, MIN).concat(tramo(T + 5 * H, T + 6 * H, 30, MIN));
  igual('…pero abierta y sin una lectura dentro (aparcado de verdad, con el motor apagado): vale, y es rojo',
    (a => [a.gpsFuente, SEM.colorGps(a.distancia), !!a.detalle.paradaRota])(await auditar(24)), ['parada', 'rojo', false]);
  // …y abierta en la gasolinera: no se mira por dentro (estar allí es lo que se busca).
  MAP.paradas['u-abierta'] = [{ desde: T - 2 * H, hasta: null, ...surtidor, direccion: 'Coslada' }];
  MAP.series['u-abierta'] = tramo(T - 2 * H, T - 10 * MIN, t => Math.round(37 - 9 * (t - (T - 2 * H)) / (2 * H)), 4 * MIN);
  igual('…y abierta EN la gasolinera, aunque el aforador se mueva, no se mira por dentro: se mide desde ella (0 m)',
    (a => [a.gpsFuente, a.distancia, !!a.detalle.paradaRota])(await auditar(24)), ['parada', 0, false]);
  // …ni cerrada: el 9107LWS esperó 3,9 h encendido en el surtidor (de 39 a 42 L dentro).
  MAP.paradas['u-abierta'] = [{ desde: T - 2 * MIN, hasta: T + 3.9 * H, ...surtidor, direccion: 'Coslada' }];
  MAP.series['u-abierta'] = tramo(T - 2 * MIN, T + 3.9 * H, t => (t < T + 2 * H ? 39 : 42), 4 * MIN);
  igual('…ni cerrada: horas encendido en el surtidor (de 39 a 42 L dentro) no es un GPS clavado, es estar en la gasolinera (0 m)',
    (a => [a.gpsFuente, a.distancia, !!a.detalle.paradaRota])(await auditar(24)), ['parada', 0, false]);

  // LA PARADA DESMENTIDA (el 9523MMX, 18/10/2026): Mapon lo daba parado 47
  // minutos a 1,7 km, pero la ruta que cerró la parada arrancó en el surtidor y
  // su punto a esa hora está a 10 m: el equipo dejó la parada clavada.
  const tenerife = { lat: surtidor.lat + 0.0155, lng: surtidor.lng };
  const enElSurtidor = { t: T + 10e3, lat: surtidor.lat + 0.00009, lng: surtidor.lng };
  UNIDAD['9523MMX'] = 'u-clavada';
  const clavada = extra => [{ desde: T - 40 * MIN, hasta: T + 7 * MIN, ...tenerife, direccion: 'Av. de Tenerife', ...extra }];
  MAP.paradas['u-clavada'] = clavada({ hasta: T + 5e3, siguiente: { t: T + 5e3, lat: surtidor.lat + 0.0002, lng: surtidor.lng } });
  MAP.puntos['u-clavada'] = enElSurtidor;
  MAP.series['u-clavada'] = tramo(T - H, T - 10 * MIN, 12).concat(tramo(T + 10 * MIN, T + H, 35));
  rep(25, { estacion: 'COSLADA', matricula: '9523MMX', litros: 23 });
  const desm = await auditar(25);
  igual('Una parada a 1,7 km que no acaba donde empezó (la ruta que la cierra arranca a 1,7 km de ella): manda su punto a esa hora (10 m), y se dice',
    [desm.gpsFuente, desm.distancia, (desm.detalle.paradaFalsa || {}).como, (desm.detalle.paradaFalsa || {}).salto > 1600, (desm.detalle.paradaFalsa || {}).direccion],
    ['punto', 10, 'salto', true, 'Av. de Tenerife']);
  MAP.paradas['u-clavada'] = clavada({});
  igual('…sin la ruta, pero con un punto suyo DENTRO de la parada y a 1,7 km de ella (el 1208MJY): también',
    (a => [a.gpsFuente, a.distancia, (a.detalle.paradaFalsa || {}).como])(await auditar(25)), ['punto', 10, 'punto']);
  MAP.paradas['u-clavada'] = clavada({ siguiente: { t: T + 7 * MIN, lat: tenerife.lat + 0.00005, lng: tenerife.lng } });
  MAP.puntos['u-clavada'] = { t: T - 163e3, lat: tenerife.lat + 0.00004, lng: tenerife.lng };
  igual('…pero aparcado de verdad (arranca a 6 m de donde paró y su punto está a 4 m, el 8997LDK en Campo Real): se queda la parada, y es rojo',
    (a => [a.gpsFuente, SEM.colorGps(a.distancia), !!a.detalle.paradaFalsa])(await auditar(25)), ['parada', 'rojo', false]);
  MAP.paradas['u-clavada'] = clavada({ siguiente: { t: T + 7 * MIN, lat: surtidor.lat + 0.0002, lng: surtidor.lng } });
  MAP.puntos['u-clavada'] = { ...enElSurtidor, t: T + 6 * MIN };
  igual('…y si su único punto es de más de 5 min, se queda la parada: con un hueco del GPS y nada más, no se sabe dónde estaba',
    (a => [a.gpsFuente, !!a.detalle.paradaFalsa])(await auditar(25)), ['parada', false]);
  MAP.paradas['u-clavada'] = clavada({});
  MAP.puntos['u-clavada'] = { t: T + 10e3, lat: tenerife.lat + 0.01, lng: tenerife.lng };
  igual('…ni si el punto de dentro queda aún más lejos de la gasolinera: nunca acusa más que la parada',
    (a => [a.gpsFuente, a.distancia === G.metros(tenerife, surtidor)])(await auditar(25)), ['parada', true]);
  MAP.puntos['u-clavada'] = null;

  // LA PARADA DE ANTES, LEJOS (Excel): el coche paró a dejar a un pasajero a
  // 1,5 km y repostó sin apagarse (Mapon no apuntó la parada del surtidor). A
  // la hora del Excel estaba a unos metros de la gasolinera: vale lo más cerca.
  const pasajero = { lat: surtidor.lat + 0.0135, lng: surtidor.lng };
  MAP.paradas['u-pasajero'] = [{ desde: T - 12 * MIN, hasta: T - 4 * MIN, ...pasajero, direccion: 'dejando a un pasajero' }];
  MAP.puntos['u-pasajero'] = { t: T - 20e3, lat: surtidor.lat + 0.00009, lng: surtidor.lng };
  MAP.series['u-pasajero'] = tramo(T - H, T - 10 * MIN, 12).concat(tramo(T + 10 * MIN, T + H, 35));
  UNIDAD['8930KVC'] = 'u-pasajero';
  rep(22, { estacion: 'COSLADA', matricula: '8930KVC', litros: 24.4, origen: 'excel' });
  const pas = await auditar(22);
  igual('Excel con la parada de antes a 1,5 km: se mira dónde estaba a esa hora (a 10 m) y vale eso; la boya, con su ventana',
    [pas.gpsFuente, pas.distancia, (pas.detalle.paradaCerca || {}).direccion, (pas.detalle.paradaCerca || {}).aLaGasolinera > 1400, (pas.detalle.boya || {}).regla, pas.boyaSalto],
    ['punto', 10, 'dejando a un pasajero', true, 'ventana', 23]);
  MAP.puntos['u-pasajero'] = { t: T - 20e3, lat: surtidor.lat + 0.02, lng: surtidor.lng };
  igual('…y si a esa hora estaba aún más lejos, se queda la parada (nunca acusa más que ella)',
    (a => [a.gpsFuente, a.distancia === G.metros(pasajero, surtidor)])(await auditar(22)), ['parada', true]);
  MAP.paradas['u-pasajero'] = [{ desde: T - 6 * MIN, hasta: T - 2 * MIN, lat: surtidor.lat + 0.0004, lng: surtidor.lng }];
  igual('…y con la parada de antes junto a la gasolinera (44 m), se mide desde ella sin más', (a => [a.gpsFuente, a.distancia])(await auditar(22)), ['parada', 44]);

  // EL CAMBIO DE HORA (domingo 25/10/2026): «02:30» pasa dos veces y la base se
  // queda con la segunda (01:30 UTC). Si el correo llegó antes, fue la primera.
  const seg = Date.UTC(2026, 9, 25, 1, 30);
  igual('Cambio de hora: «02:30» con el correo llegado a las 00:31 UTC es la primera pasada (00:30 UTC); llegado a las 01:31, la segunda',
    [A._instante({ repostaje_at: new Date(seg), recibido_at: new Date(Date.UTC(2026, 9, 25, 0, 31)) }),
      A._instante({ repostaje_at: new Date(seg), recibido_at: new Date(Date.UTC(2026, 9, 25, 1, 31)) })],
    [{ t: seg - H, repite: true, primera: true }, { t: seg, repite: true, primera: false }]);
  igual('…las 03:30 de ese día y cualquier hora de otro día no se repiten',
    [A._instante({ repostaje_at: new Date(Date.UTC(2026, 9, 25, 2, 30)), recibido_at: new Date(Date.UTC(2026, 9, 25, 1, 0)) }).repite,
      A._instante({ repostaje_at: new Date(T), recibido_at: new Date(T - H) }).repite], [false, false]);
  const T1 = seg - H;
  MAP.paradas['u-cambio'] = [{ desde: T1 - 3 * MIN, hasta: T1 + 6 * MIN, ...surtidor, direccion: 'Coslada' },
    { desde: seg - 10 * MIN, hasta: seg + 30 * MIN, lat: 40.40, lng: -3.70, direccion: 'en casa' }];
  MAP.series['u-cambio'] = tramo(T1 - H, T1 - 3 * MIN, 12).concat(tramo(T1 + 6 * MIN, T1 + 2 * H, 35));
  UNIDAD['8997LDN'] = 'u-cambio';
  rep(20, { estacion: 'COSLADA', matricula: '8997LDN', litros: 24.405, repostaje_at: new Date(seg), recibido_at: new Date(T1 + 40e3) });
  const cambio = await auditar(20);
  igual('…y la auditoría mira la primera: parado en Coslada (0 m) y +23 L, no «en casa» una hora después',
    [cambio.gpsDireccion, cambio.distancia, cambio.boyaSalto, cambio.detalle.horaRepetida], ['Coslada', 0, 23, { pasada: 'primera', t: new Date(T1).toISOString() }]);

  // EL EXCEL QUE NO DICE CUÁL (el 2903LZH, 25/10/2026, «02:42:09»): se guardó
  // la segunda, y el coche estaba en el surtidor en la primera, con el depósito
  // de 24 a 43 L; en la segunda, en casa, sin subir. Se prueban las dos.
  const seg2 = Date.UTC(2026, 9, 25, 1, 42, 9), prim2 = seg2 - H;
  UNIDAD['2903LZH'] = 'u-dos';
  MAP.paradas['u-dos'] = [{ desde: prim2 - 4 * MIN, hasta: prim2 + MIN, ...surtidor, direccion: 'Coslada' },
    { desde: seg2 - 25 * MIN, hasta: seg2 + 10 * MIN, lat: 40.40, lng: -3.70, direccion: 'Calle Agustín de Foxá, 14' }];
  MAP.series['u-dos'] = tramo(prim2 - H, prim2 - 4 * MIN, 24, MIN).concat(tramo(prim2 + MIN, seg2 - 25 * MIN, 43, MIN), tramo(seg2 + 10 * MIN, seg2 + H, 42, MIN));
  rep(26, { estacion: 'COSLADA', matricula: '2903LZH', litros: 19, origen: 'excel', hora_repetida: 'sin_saber', repostaje_at: new Date(seg2) });
  AUD.movidas = [];
  const dos = await auditar(26);
  igual('Hora repetida que el Excel no decide: se prueban las dos, cuadra la primera (en el surtidor y +19 L), se audita con ella y se corrige la hora guardada',
    [dos.distancia, dos.gpsDireccion, dos.boyaSalto, dos.detalle.horaRepetida.pasada, dos.detalle.horaRepetida.como, ((dos.detalle.horaRepetida.pruebas || {}).segunda || {}).metros > 1600,
      AUD.movidas, AUD.filas[26].repostaje_at.getTime()],
    [0, 'Coslada', 19, 'primera', 'auditoria', true, [[26, prim2]], prim2]);
  MAP.pedido = [];
  const otraVez = await auditar(26);
  igual('…y otra auditoría no lo vuelve a probar (una sola lectura de paradas): la hora guardada ya es la buena, y la decisión se queda',
    [otraVez.distancia, otraVez.detalle.horaRepetida.pasada, otraVez.detalle.horaRepetida.como, AUD.movidas.length, MAP.pedido.filter(x => x === 'paradas').length],
    [0, 'primera', 'auditoria', 1, 1]);
  // …lejos en las dos horas (el 8997LDK, o alguien que llena otro coche): sigue rojo.
  MAP.paradas['u-dos'] = [{ desde: prim2 - 30 * MIN, hasta: seg2 + 30 * MIN, lat: 40.40, lng: -3.70, direccion: 'en casa' }];
  MAP.series['u-dos'] = tramo(prim2 - 2 * H, prim2 - 30 * MIN, 30, MIN).concat(tramo(seg2 + 30 * MIN, seg2 + 2 * H, 30, MIN));
  rep(27, { estacion: 'COSLADA', matricula: '2903LZH', litros: 19, origen: 'excel', hora_repetida: 'sin_saber', repostaje_at: new Date(seg2) });
  AUD.movidas = [];
  const lejosDos = await auditar(27);
  igual('…lejos en las dos y sin subir el depósito: se queda la segunda, roja, y se dice que se probaron las dos',
    [SEM.colorGps(lejosDos.distancia), lejosDos.detalle.horaRepetida.pasada, lejosDos.detalle.horaRepetida.como, lejosDos.detalle.horaRepetida.cuadran, AUD.movidas],
    ['rojo', 'segunda', 'probadas', 0, []]);

  // Mapon parte una parada a medianoche, o con un «trayecto» de 16 s y 0 km.
  const aqui = { lat: 40.4612, lng: -3.6160 };
  const partidas = [{ desde: T - 51 * MIN, hasta: T - 38 * MIN, ...aqui }, { desde: T - 37.7 * MIN, hasta: T - 5 * MIN, ...aqui },
    { desde: T - 5 * MIN, hasta: T - 4.8 * MIN, ...aqui }, { desde: T + 30 * MIN, hasta: T + 40 * MIN, lat: 40.47, lng: -3.62 }];
  igual('Las paradas que se tocan en el mismo sitio son una (la de medianoche y la del trayecto de 16 s); la de media hora después, aparte',
    A._unirParadas(partidas).map(q => [(q.desde - T) / MIN, (q.hasta - T) / MIN]), [[-51, -4.8], [30, 40]]);
  igual('…y la que no se toca, o está a más de 100 m, no se junta',
    A._unirParadas([{ desde: T - 20 * MIN, hasta: T - 10 * MIN, ...aqui }, { desde: T - 8 * MIN, hasta: T, ...aqui },
      { desde: T, hasta: T + MIN, lat: aqui.lat + 0.002, lng: aqui.lng }]).length, 3);
  igual('…y al juntar los trozos se queda la ruta que sigue al último (detrás del de medianoche no hay ruta, hay otro trozo)',
    A._unirParadas([{ desde: T - 20 * MIN, hasta: T - 10 * MIN, ...aqui, siguiente: null }, { desde: T - 10 * MIN, hasta: T, ...aqui, siguiente: { t: T, ...aqui } }])
      .map(q => q.siguiente && q.siguiente.t), [T]);

  // A MANO: un repetido no se audita; y la gasolinera se corrige para todos los de ese nombre.
  rep(9, { estacion: 'COSLADA', matricula: '8997LDK', estado: 'repetido', litros: 24.405 });
  igual('Un repetido no se audita (ni se le pregunta a Mapon)', await A.auditarUno(9).then(() => 'auditado', e => e.message),
    'Solo se auditan los repostajes leídos (no los repetidos ni los que no se pudieron leer)');
  rep(10, { estacion: 'BARCELONA', matricula: '6584KZV', sede: 'barcelona', litros: 20, gps_lat: gas('Ballenoil Barcelona - Asunción').lat, gps_lng: gas('Ballenoil Barcelona - Asunción').lng, gasolinera_como: 'ambiguo' });
  rep(11, { estacion: 'Barcelona', matricula: '7909LRJ', sede: 'barcelona', litros: 9, gasolinera_como: 'ambiguo' });
  const asuncion = gas('Ballenoil Barcelona - Asunción').id;
  const c1 = await A.corregirGasolinera(10, asuncion, 7);
  igual('Corregir la gasolinera a mano: vale para todos los del mismo nombre (escrito como sea) y rehace la distancia con la posición que ya había',
    [c1, [10, 11].map(id => [AUD.filas[id].gasolinera_id === asuncion, AUD.filas[id].gasolinera_como]), AUD.filas[10].gps_distancia_m, AUD.filas[11].gps_distancia_m],
    [{ cambiados: 2, mismos: 2 }, [[true, 'alias'], [true, 'alias']], 0, undefined]);
  igual('…y al auditar se queda con la puesta a mano', (await auditar(10)).gasolineraComo, 'alias');
  await A.corregirGasolinera(10, null, 7);
  igual('…quitarla devuelve los de ese nombre a casarse por el nombre (aquí, ambiguo otra vez)',
    [AUD.alias.size, AUD.filas[10].gasolinera_id, AUD.filas[10].gasolinera_como], [0, null, 'ambiguo']);
  igual('…y una gasolinera que no está en la lista no se pone', await A.corregirGasolinera(10, 99999, 7).then(() => 'puesta', e => e.message), 'Esa gasolinera no está en la lista');

  // LAS PASADAS DEL CRON.
  AUD.aAuditar = [1, 4, 8];
  AUD.guardarRevienta = 4;
  const intentos4 = AUD.filas[4].auditoria_intentos;
  const errorLog = console.error, logLog = console.log; const dichos = [];
  console.error = (...x) => dichos.push(x.join(' '));
  console.log = (...x) => dichos.push(x.join(' '));
  const p = await A.auditarPendientes({ origen: 'cron' });
  console.error = errorLog; console.log = logLog;
  AUD.guardarRevienta = null;
  igual('La pasada: cierra los que ya no van a mejorar, audita uno detrás de otro y uno que revienta no para a los demás',
    [p.ok, AUD.cerrar, p.auditados, p.hechos, p.incompletos, p.fallos, dichos.some(x => /Auditar el repostaje 4/.test(x))], [true, 1, 2, 1, 1, 1, true]);
  igual('…y al que revienta se le apunta el intento (queda a medias, con el error, y lo medido sin tocar): no se queda «pendiente» para siempre',
    [AUD.filas[4].auditoria_intentos, AUD.filas[4].auditoria_estado, AUD.filas[4].auditoria_detalle.error, AUD.filas[4].gps_distancia_m],
    [intentos4 + 1, 'incompleta', 'la base dijo que no', 0]);
  MAP.caido = true;
  const intentos = AUD.filas[1].auditoria_intentos;
  const pc = await A.auditarPendientes({ origen: 'cron' });
  igual('Con Mapon caído la pasada se salta entera, sin gastar intentos (pero las gasolineras se casan igual)',
    [pc.ok, pc.motivo, AUD.filas[1].auditoria_intentos === intentos, AUD.cerrar], [false, 'Mapon no está disponible (cuenta suspendida): se audita cuando vuelva', true, 1]);
  igual('…y el botón lo dice', await A.auditarUno(1).then(() => 'auditado', e => e.message), 'Mapon no está disponible (cuenta suspendida): se audita cuando vuelva');
  MAP.caido = false; MAP.sinClave = true;
  igual('Sin MAPON_API_KEY, igual: no se audita y se dice', (await A.auditarPendientes({ origen: 'cron' })).motivo, 'Falta MAPON_API_KEY en el servidor: no se audita con Mapon');
  MAP.sinClave = false;
  // La auditoría tiene que valer ANTES de db/215 (Camilo aplica la migración
  // después de desplegar): con `r.origen` a secas se paraba entera con 42703
  // (revisión del 23/10/2026). Se mira el texto de la consulta, que aquí no hay base.
  const repoTexto = require('fs').readFileSync(require('path').join(__dirname, '..', 'modules', 'Combustible', 'combustible.repo.js'), 'utf8');
  const camposAuditar = (/const CAMPOS_AUDITAR = `([\s\S]*?)`;/.exec(repoTexto) || [])[1] || '';
  igual('La consulta de la auditoría no pide a secas columnas de db/215 (origen va con to_jsonb): vale antes de aplicarla',
    [!!camposAuditar, /\br\.(origen|excel_\w+|bot_\w+|metodo_pago|vehiculo_tipo|importacion_id)\b/.test(camposAuditar), /to_jsonb\(r\) ->> 'origen' AS origen/.test(camposAuditar)],
    [true, false, true]);
  igual('A Mapon solo se le pregunta: la auditoría no toca nada que no sea una lectura (ni órdenes ni relés)',
    [...tocadoMapon].filter(k => !LECTURAS_MAPON.includes(k)), []);
  igual('Los tiempos: a los 45 min del repostaje; reintentos a 30 min, 1, 2, 4, 8 y 12 h; «sin datos» a las 48 h (con 3 intentos) o a los 8',
    [A.MARGEN_MIN, A.ESPERAS_MIN, A.CIERRE], [45, [30, 60, 120, 240, 480, 720], { horas: 48, minIntentos: 3, maxIntentos: 8 }]);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
