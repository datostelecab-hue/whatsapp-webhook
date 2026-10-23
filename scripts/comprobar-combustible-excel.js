// ============================================================
// COMBUSTIBLE — EL EXCEL DE PETROPRIX, EL BOT Y EL RITMO DE LA AUDITORÍA
// ============================================================
// Lo de db/215 (23/10/2026), sin base, sin Mapon y sin el Excel de verdad:
//
//   · el lector del Excel (lector.petroprixExcel): la cabecera exacta (y que
//     otro Excel no se importa), la fecha con segundos, la coma decimal, la
//     matrícula en minúsculas, las filas que no se entienden y que una rara no
//     para a las demás, la clave contra duplicados y el cambio de hora;
//   · las 30 gasolineras: los textos EXACTOS de la celda del Excel, con sus
//     rarezas («CantueÃ±a» y su espacio final, «Leganes 2 », «C\ Plasencia»),
//     casan cada uno con la suya usando las claves de db/215 tal cual (se leen
//     del fichero de la migración); y un texto que no está casa por su dirección
//     o, por palabras, solo si el nombre es el mismo («Getafe 2» no es «Getafe»);
//   · el importador entero, con un repo de mentira: importar dos veces = 0
//     nuevas; un Excel que se solapa solo trae lo nuevo; los avisos por tipo;
//     y quién llevaba el coche en BOLT y en el bot;
//   · BOLT y el bot: la misma persona, distinta, solo el bot, solo BOLT, nadie;
//   · la parada de una fila del Excel (la hora es la del FINAL del repostaje) y
//     la memoria y los grupos con que la auditoría pregunta a Mapon.
//
//   node scripts/comprobar-combustible-excel.js
//
// Las direcciones de las gasolineras son las públicas de Petroprix; matrículas
// y nombres, inventados.
const fs = require('fs');
const path = require('path');

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

// Las 30 celdas «Gasolinera» del Excel de Petroprix, TAL CUAL llegan (con su
// espacio final, su mala codificación y su barra invertida).
const TEXTOS = {
  'Petroprix Vicálvaro': 'Vicálvaro\nCalle Herce 41 28032',
  'Petroprix Carabanchel': 'Carabanchel\nCalle Secoya, 12 28044',
  'Petroprix Alcobendas 2': 'Alcobendas 2\nCalle Valgrande 11 28108',
  'Petroprix Fuenlabrada - Constitución': 'Fuenlabrada - Constitucion\nC/ Constitucion 100 28946',
  'Petroprix San Sebastián de los Reyes': 'San Sebastian de los Reyes\nAvd Fuente Nueva 18 28703',
  'Petroprix Móstoles 2': 'Móstoles 2\nC. Yolanda González, 5 28938',
  'Petroprix Madrid - Av. Aviación': 'Madrid - Av. Aviación\nAvda. de la Aviación 28054',
  'Petroprix Alcorcón': 'Alcorcón\nC/ Paraguay Esquina Avenida de America 28922',
  'Petroprix Leganés': 'Leganés\nC/ Vizcaya, 17 28917',
  'Petroprix Parla': 'Parla\nAvenida de Ronda S/N 28981',
  'Petroprix Getafe': 'Getafe\nCalle Herreros, 1 28906',
  'Petroprix Torrejón': 'Torrejón\nAvenida de la Constitución 287 28850',
  'Petroprix San Fernando de Henares 1': 'San Fernando de Henares 1\nAvenida de los Artesanos 7 28830',
  'Petroprix Alcalá de Henares': 'Alcala De Henares\nC/ Isaac Newton 33 28806',
  'Petroprix Majadahonda': 'Majadahonda\nCalle Barbero de Sevilla, Parcela 2B 28222',
  'Petroprix Leganés 2': 'Leganes 2 \nCalle Ricardo Tormo 6 28914',
  'Petroprix Rivas - Vaciamadrid': 'Rivas - Vaciamadrid\nC/ Cincel n2 28522',
  'Petroprix Alcobendas': 'Alcobendas\nC/ Marques de la Valdavia, 132 28100',
  'Petroprix Móstoles': 'Móstoles\nC\\ Plasencia 29 28935',
  'Petroprix Fuenlabrada 3': 'Fuenlabrada 3\nCalle Móstoles, 83 28942',
  'Petroprix Arganda del Rey': 'Arganda Del Rey\nAvenida de Madrid 138 28500',
  'Petroprix Fuenlabrada - Avda Cantueña': 'Fuenlabrada - Avda Cantueña\nAvenida de la CantueÃ±a, 8 28947 ',
  'Petroprix Valdemoro': 'Valdemoro\nAv. de Madrid, 5. 28342 Valdemoro 28342',
  'Petroprix Parla 2': 'Parla 2\nBulevar John Deere, s/n 28984',
  'Petroprix Collado Villalba': 'Collado Villalba\nAvd/Juan Carlos I, 24Bis 28400',
  'Petroprix Colmenar Viejo': 'Colmenar Viejo\nAv. De los Reyes nº 2 28770',
  'Petroprix Mejorada del Campo': 'Mejorada Del Campo\nC/ Portugal 30 28840',
  'Petroprix Alpedrete': 'Alpedrete\nCalle Puerta de Abajo n57 28430',
  'Petroprix Guadalajara': 'Guadalajara\nC/ Francisco Aritio, 97 19004',
  'Petroprix Benalmádena': 'Benalmádena\nAvd  La Leala 29631',
};

// ── Lo que dice db/215, leído del propio fichero ─────────────────────────────
// Un literal de SQL estándar: '...' con la comilla doblada, unidos con chr(10).
const MIG = fs.readFileSync(path.join(__dirname, '..', 'db', '215-petroprix-excel.sql'), 'utf8');
const LIT = `'(?:[^']|'')*'(?:\\s*\\|\\|\\s*chr\\(10\\)\\s*\\|\\|\\s*'(?:[^']|'')*')*`;
const deLit = t => t.split(/\s*\|\|\s*chr\(10\)\s*\|\|\s*/).map(x => x.slice(1, -1).replace(/''/g, "'")).join('\n');
const bloque = (desde, hasta) => MIG.slice(MIG.indexOf(desde), MIG.indexOf(hasta, MIG.indexOf(desde)));
const LISTA = [...bloque('INSERT INTO gasolinera (', 'ON CONFLICT (proveedor, nombre)')
  .matchAll(new RegExp(`\\('petroprix', (${LIT}), (${LIT}), (${LIT}), (${LIT}|NULL), (-?[\\d.]+), (-?[\\d.]+), (${LIT})`, 'g'))]
  .map((m, i) => ({ id: 900 + i, proveedor: 'petroprix', nombre: deLit(m[1]), direccion: deLit(m[2]), provincia: deLit(m[3]),
    sede: m[4] === 'NULL' ? null : deLit(m[4]), lat: Number(m[5]), lng: Number(m[6]), precision: deLit(m[7]) }));
const ALIAS = [...bloque('INSERT INTO gasolinera_alias', 'ON CONFLICT (proveedor, tipo, estacion_clave)')
  .matchAll(new RegExp(`\\((${LIT}), (${LIT}), (${LIT})\\)`, 'g'))].map(m => ({ clave: deLit(m[1]), estacion: deLit(m[2]), nombre: deLit(m[3]) }));
const porNombre = n => LISTA.find(g => g.nombre === n);
const TEXTOS_MAP = new Map(ALIAS.map(a => [`petroprix|${a.clave}`, porNombre(a.nombre) && porNombre(a.nombre).id]));

(async () => {
  const G = require('../modules/Combustible/combustible.gasolinera');
  const X = require('../modules/Combustible/lector.petroprixExcel');
  const casar = require('../modules/Combustible/combustible.casar');

  // ════════════════════════════════════════════════════════════════════════
  // 1. LAS 30 GASOLINERAS Y SUS TEXTOS (db/215)
  // ════════════════════════════════════════════════════════════════════════
  igual('db/215 trae las 30 gasolineras (29 de la web y Parla 2 validada; 28 de Madrid y 2 sin sede) y sus 30 textos',
    [LISTA.length, LISTA.filter(g => g.precision === 'web').length, porNombre('Petroprix Parla 2').precision,
      LISTA.filter(g => g.sede === 'madrid').length, LISTA.filter(g => !g.sede).map(g => g.nombre), ALIAS.length],
    [30, 29, 'validada', 28, ['Petroprix Guadalajara', 'Petroprix Benalmádena'], 30]);
  igual('La clave de cada alias es el textoExacto de su celda, y la «estacion» la celda tal cual (con el espacio del final)',
    ALIAS.every(a => a.clave === G.textoExacto(a.estacion) && TEXTOS[a.nombre] === a.estacion), true);
  const elegir = (texto, extra = {}) => G.elegir(texto, { proveedor: 'petroprix', gasolineras: LISTA, alias: new Map(), textos: TEXTOS_MAP, ...extra });
  const malCasadas = Object.entries(TEXTOS).filter(([nombre, t]) => { const e = elegir(t); return e.como !== 'texto' || e.gasolinera.nombre !== nombre; });
  igual('Los 30 textos del Excel casan cada uno con SU gasolinera, por el texto exacto', malCasadas.map(([n]) => n), []);
  igual('…también «CantueÃ±a» con su espacio final, «Leganes 2 » y «C\\ Plasencia», y con \\r\\n o espacios de más',
    ['Fuenlabrada - Avda Cantueña\r\nAvenida de la CantueÃ±a, 8 28947 ', 'Leganes 2 \nCalle Ricardo Tormo 6 28914', 'Móstoles\nC\\ Plasencia 29 28935',
      '  Alcobendas  \r\n  C/ Marques de la Valdavia,  132 28100 '].map(t => elegir(t).gasolinera.nombre),
    ['Petroprix Fuenlabrada - Avda Cantueña', 'Petroprix Leganés 2', 'Petroprix Móstoles', 'Petroprix Alcobendas']);
  igual('«Alcobendas» y «Alcobendas 2», «Parla» y «Parla 2», «Móstoles» y «Móstoles 2» no se confunden',
    [TEXTOS['Petroprix Alcobendas'], TEXTOS['Petroprix Alcobendas 2'], TEXTOS['Petroprix Parla'], TEXTOS['Petroprix Parla 2'],
      TEXTOS['Petroprix Móstoles'], TEXTOS['Petroprix Móstoles 2']].map(t => elegir(t).gasolinera.nombre),
    ['Petroprix Alcobendas', 'Petroprix Alcobendas 2', 'Petroprix Parla', 'Petroprix Parla 2', 'Petroprix Móstoles', 'Petroprix Móstoles 2']);
  igual('Un texto que no está: si su dirección es la de una gasolinera, esa («Alcobendas Norte» en Calle Valgrande 11)',
    (e => [e.como, e.gasolinera && e.gasolinera.nombre])(elegir('Alcobendas Norte\nCalle Valgrande 11 28108')), ['direccion', 'Petroprix Alcobendas 2']);
  igual('…si no, por palabras del nombre, pero solo el MISMO nombre: «Getafe 2» (una nueva) no es «Getafe»: dudosa, ninguna',
    [elegir('Getafe 2\nCalle Nueva 3 28900'), elegir('GETAFE\nOtra calle 1 28900')].map(e => [e.como, e.gasolineraId, e.candidatas.length]),
    [['ambiguo', null, 1], ['exacto', porNombre('Petroprix Getafe').id, 0]]);
  igual('…y lo puesto a mano en la ficha manda sobre el texto (alias por palabras)',
    elegir(TEXTOS['Petroprix Getafe'], { alias: new Map([[`petroprix|${G.normalizar(TEXTOS['Petroprix Getafe']).clave}`, porNombre('Petroprix Parla').id]]) }).como, 'alias');
  igual('Ballenoil no cambia: sin segunda línea casa por palabras como siempre',
    G.elegir('COSLADA', { proveedor: 'ballenoil', gasolineras: [{ id: 1, proveedor: 'ballenoil', nombre: 'Ballenoil Coslada I' }], alias: new Map(), textos: TEXTOS_MAP }).como, 'exacto');

  // ════════════════════════════════════════════════════════════════════════
  // 2. EL LECTOR DEL EXCEL
  // ════════════════════════════════════════════════════════════════════════
  const fila = (n, c) => ({ n, celdas: c });
  const CAB = fila(1, X.CABECERA);
  igual('Se reconoce por su cabecera exacta, en cualquier hoja', X.reconocer([{ nombre: 'Hoja1', filas: [fila(1, ['Otra', 'cosa'])] },
    { nombre: 'Repostajes', filas: [CAB, fila(2, ['x'])] }]).hoja, 'Repostajes');
  const otro = X.reconocer([{ nombre: 'Citas', filas: [fila(1, ['MATRICULA', 'VEHICULO', 'CITA TALLER', 'HORA'])] }]);
  igual('Otro Excel no es el de Petroprix: lo dice y no se importa nada', [!!otro.motivo, /no es el de repostajes de Petroprix/.test(otro.motivo),
    /MATRICULA · VEHICULO/.test(otro.motivo), /No se ha importado nada/.test(otro.motivo)], [true, true, true, true]);
  igual('Una columna de menos o de más tampoco vale', [X.reconocer([{ nombre: 'R', filas: [fila(1, X.CABECERA.slice(0, 7))] }]).motivo != null,
    X.reconocer([{ nombre: 'R', filas: [fila(1, [...X.CABECERA, 'Extra'])] }]).motivo != null], [true, true]);
  igual('La fecha: «22-10-2026 18:14:01» es la hora de Madrid sin zona; un 31/02 no existe', [X.fechaDelExcel('22-10-2026 18:14:01'),
    X.fechaDelExcel('1-10-2026 0:08:05'), X.fechaDelExcel('31-02-2026 10:00:00'), X.fechaDelExcel('2026-10-22 18:14'), X.fechaDelExcel('')],
    ['2026-10-22T18:14:01', '2026-10-01T00:08:05', null, null, null]);
  const L = X.leerFilas([
    fila(2, ['22-10-2026 18:14:01', '7222LVG', 'Turismo', 'Gasolina', '13,93', '23,53', 'Pago Petroprix', TEXTOS['Petroprix Alcobendas 2']]),
    fila(3, ['22-10-2026 18:10:08', '2903lzh', 'Turismo', 'Gasolina', '0,16', '0,29', 'Pago Petroprix', TEXTOS['Petroprix Parla 2']]),
    fila(4, ['31-02-2026 10:00:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
    fila(5, ['22-10-2026 17:00:00', '7222LVG', 'Turismo', 'Gasolina', 'muchos', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
    fila(6, ['22-10-2026 16:00:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '1,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
    fila(7, ['22-10-2026 15:00:00', 'XX', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', '']),
    fila(8, ['', '', '', '', '', '', '', '']),
    fila(9, ['22-10-2026 14:00:00', '7222LVG', 'Turismo', 'Gasolina', '250', '400', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
  ]);
  igual('Las buenas: coma decimal, matrícula en mayúsculas, el instante en UTC (octubre, +2 h)',
    L.filas.map(f => [f.fila, f.matricula, f.litros, f.importe, new Date(f.instante).toISOString()]),
    [[2, '7222LVG', 13.93, 23.53, '2026-10-22T16:14:01.000Z'], [3, '2903LZH', 0.16, 0.29, '2026-10-22T16:10:08.000Z']]);
  igual('Las raras se apartan con su porqué (y la fila vacía ni cuenta): una rara no para a las demás',
    L.errores.map(e => [e.fila, e.motivo]),
    [[4, 'la fecha «31-02-2026 10:00:00» no se entiende (tiene que ser DD-MM-AAAA HH:MM:SS)'],
      [5, 'los litros «muchos» no se entienden'],
      [6, '10,00 L por 1,00 € salen 0,100 €/L'],
      [7, 'la matrícula «XX» no es una matrícula; no trae la gasolinera'],
      [9, '250 litros no puede ser un repostaje']]);
  // UNA FECHA DEL FUTURO NO ENTRA (revisión del 23/10/2026): dos filas del 25/10 importadas el 23/10.
  const AHORA = Date.UTC(2026, 9, 23, 10, 0);
  const F = X.leerFilas([fila(2, ['25-10-2026 02:30:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
    fila(3, ['23-10-2026 12:05:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
    fila(4, ['23-10-2026 12:15:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]),
    fila(5, ['22-10-2026 18:14:01', '7222LVG', 'Turismo', 'Gasolina', '13,93', '23,53', 'Pago Petroprix', TEXTOS['Petroprix Getafe']])], { ahora: AHORA });
  igual('Una fecha de después de importar no entra: se aparta con su porqué (con 10 min de margen: las 12:05 de Madrid valen a las 12:00, las 12:15 no)',
    [F.filas.map(f => f.fila), F.errores.map(e => [e.fila, /es de después de importar el Excel/.test(e.motivo)])],
    [[3, 5], [[2, true], [4, true]]]);
  const misma = X.leerFilas([fila(40, ['22-10-2026 18:14:01', '7222lvg ', 'Turismo', 'Gasolina', '13,930', '23,53', 'Tarjeta', 'Otro texto\nOtra calle'])]).filas[0];
  igual('La clave: la misma fila es la misma clave aunque cambien el pago, la gasolinera o cómo se escribe la matrícula',
    [misma.clave === L.filas[0].clave, L.filas[0].clave === L.filas[1].clave, /^[0-9a-f]{64}$/.test(L.filas[0].clave)], [true, false, true]);

  // EL CAMBIO DE HORA (domingo 25/10/2026): de lo más nuevo a lo más viejo, y
  // dentro de la hora repetida la hora vuelve a SUBIR al empezar la primera.
  const fh = (n, t) => fila(n, [t, '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]);
  const D = X.leerFilas([fh(2, '25-10-2026 03:10:00'), fh(3, '25-10-2026 02:50:00'), fh(4, '25-10-2026 02:10:00'),
    fh(5, '25-10-2026 02:55:00'), fh(6, '25-10-2026 02:20:00'), fh(7, '25-10-2026 01:58:00')]);
  igual('Cambio de hora, con el salto en el fichero: antes del salto, la segunda pasada (invierno); después, la primera (verano)',
    D.filas.map(f => [f.local.slice(11, 16), f.horaRepetida, new Date(f.instante).toISOString().slice(11, 16), f.avisos.length]),
    [['03:10', null, '02:10', 0], ['02:50', 'segunda', '01:50', 0], ['02:10', 'segunda', '01:10', 0],
      ['02:55', 'primera', '00:55', 0], ['02:20', 'primera', '00:20', 0], ['01:58', null, '23:58', 0]]);
  const D2 = X.leerFilas([fh(2, '25-10-2026 03:10:00'), fh(3, '25-10-2026 02:30:00'), fh(4, '25-10-2026 01:30:00')]);
  igual('…sin salto no se puede saber: la segunda (como PostgreSQL) y un aviso para mirarla',
    [D2.filas[1].horaRepetida, new Date(D2.filas[1].instante).toISOString().slice(11, 16), /pasa dos veces.*no deja saber cuál/.test(D2.filas[1].avisos[0])],
    ['sin_saber', '01:30', true]);
  const D3 = X.leerFilas([fh(2, '29-03-2026 02:30:00')]);
  igual('…y la hora de marzo que no existe, una hora después (como PostgreSQL), con su aviso',
    [new Date(D3.filas[0].instante).toISOString().slice(11, 16), /no existe en Madrid/.test(D3.filas[0].avisos[0])], ['01:30', true]);

  // LOS AVISOS QUE SE GUARDAN (los que no cambian).
  const fa = c => X.leerFilas([fila(2, c)]).filas[0];
  const diesel = fa(['18-10-2026 17:03:54', '8203LTR', 'Turismo', 'Diesel', '22,87', '40,00', 'Tarjeta', TEXTOS['Petroprix Fuenlabrada 3']]);
  igual('Avisos de la fila: diésel en un coche de gasolina, pago sin la app y «Vehículo» «-»',
    [X.avisosFijos(diesel, { marcaModelo: 'Toyota Corolla Touring' }).map(a => a.tipo),
      X.avisosFijos(diesel, { marcaModelo: 'Mercedes-Benz E220' }).map(a => a.tipo),
      X.avisosFijos(fa(['18-10-2026 17:03:54', '8997LDK', '-', 'Gasolina', '30,32', '50,00', 'Pago Petroprix', TEXTOS['Petroprix Torrejón']]), null).map(a => a.tipo)],
    [['diesel', 'pago'], ['pago'], ['vehiculo']]);
  igual('¿Gasolina? Corolla, Ioniq y Mondeo sí; un diésel no; un modelo que no lo dice, no se sabe',
    ['Toyota Corolla Sedan', 'Hyundai Ioniq', 'Ford Mondeo', 'Seat León 2.0 TDI', 'Mercedes-Benz E220', ''].map(X.esDeGasolina),
    [true, true, true, false, null, null]);

  // ════════════════════════════════════════════════════════════════════════
  // 3. BOLT Y EL BOT
  // ════════════════════════════════════════════════════════════════════════
  const q = x => casar.boltYBot(x).caso;
  igual('BOLT y el bot: la misma (por la ficha), distinta, solo el bot, solo BOLT, nadie; y sin decir nada mientras BOLT no llega o el bot no se miró',
    [q({ bolt_estado: 'conectado', bolt_conductor_id: 5, bolt_nombre: 'Ana Ruiz', bot_estado: 'en_turno', bot_conductor_id: 5, bot_nombre: 'Ana Ruiz Gil' }),
      q({ bolt_estado: 'conectado', bolt_conductor_id: 5, bolt_nombre: 'Ana Ruiz', bot_estado: 'en_turno', bot_conductor_id: 6, bot_nombre: 'Luis Gil' }),
      q({ bolt_estado: 'nadie', bot_estado: 'en_turno', bot_conductor_id: 6, bot_nombre: 'Luis Gil' }),
      q({ bolt_estado: 'ultimo', bolt_conductor_id: 5, bolt_nombre: 'Ana Ruiz', bot_estado: 'nadie' }),
      q({ bolt_estado: 'nadie', bot_estado: 'nadie' }),
      q({ bolt_estado: 'pendiente', bot_estado: 'en_turno', bot_nombre: 'Luis Gil' }),
      q({ bolt_estado: 'conectado', bolt_nombre: 'Ana Ruiz' })],
    ['mismo', 'distinto', 'solo_bot', 'solo_bolt', 'nadie', null, null]);
  igual('…sin fichas, por el nombre (como la tarjeta con BOLT); sin nombre en uno, no se acusa',
    [q({ bolt_estado: 'conectado', bolt_nombre: 'Paula Andrea Díaz', bot_estado: 'ultimo', bot_nombre: 'PAULA ANDREA DIAZ ARAQUE' }),
      q({ bolt_estado: 'conectado', bolt_nombre: null, bot_estado: 'en_turno', bot_nombre: 'Luis Gil' })], ['mismo', 'sin_comparar']);
  // El 5736LGK del 17/10 (revisión del 23/10/2026): en BOLT, Isaac conectado;
  // en el bot, un turno de Ruben cerrado 11 h 41 min antes. No son «distintos».
  igual('El último del bot (un turno ya cerrado) no contradice a BOLT: «bot_cerrado», no «distinto»; en turno sí se comparan; sin BOLT, sigue siendo «solo el bot»',
    [q({ bolt_estado: 'conectado', bolt_conductor_id: 5, bolt_nombre: 'Isaac Checa', bot_estado: 'ultimo', bot_conductor_id: 6, bot_nombre: 'Ruben Armendariz' }),
      q({ bolt_estado: 'ultimo', bolt_conductor_id: 5, bolt_nombre: 'Isaac Checa', bot_estado: 'ultimo', bot_conductor_id: 6, bot_nombre: 'Ruben Armendariz' }),
      q({ bolt_estado: 'conectado', bolt_conductor_id: 5, bolt_nombre: 'Isaac Checa', bot_estado: 'ultimo', bot_conductor_id: 5, bot_nombre: 'Isaac Checa' }),
      q({ bolt_estado: 'conectado', bolt_conductor_id: 5, bolt_nombre: 'Isaac Checa', bot_estado: 'en_turno', bot_conductor_id: 6, bot_nombre: 'Ruben Armendariz' }),
      q({ bolt_estado: 'nadie', bot_estado: 'ultimo', bot_conductor_id: 6, bot_nombre: 'Ruben Armendariz' })],
    ['bot_cerrado', 'bot_cerrado', 'mismo', 'distinto', 'solo_bot']);
  igual('Barcelona no abre turno en el bot: sin nadie en el bot, ni «sin turno en el bot» ni «ninguno»; con alguien, como en Madrid; sin sede, como Madrid',
    [q({ sede: 'barcelona', bolt_estado: 'conectado', bolt_nombre: 'Ana Ruiz', bot_estado: 'nadie' }), q({ sede: 'barcelona', bolt_estado: 'nadie', bot_estado: 'nadie' }),
      q({ sede: 'barcelona', bolt_estado: 'nadie', bot_estado: 'en_turno', bot_nombre: 'Luis Gil' }), q({ sede: null, bolt_estado: 'conectado', bolt_nombre: 'Ana Ruiz', bot_estado: 'nadie' }),
      casar.boltYBot({ sede: 'barcelona', bolt_estado: 'conectado', bolt_nombre: 'Ana Ruiz', bot_estado: 'nadie' }).nombre],
    [null, null, 'solo_bot', 'solo_bolt', 'Ana Ruiz']);

  // ════════════════════════════════════════════════════════════════════════
  // 4. LA PARADA DE UNA FILA DEL EXCEL, LA MEMORIA Y LOS GRUPOS
  // ════════════════════════════════════════════════════════════════════════
  const MIN = 60e3, H = 3600e3, T = Date.UTC(2026, 9, 3, 20, 36, 5);
  const MAPON_LLAMADAS = [];
  const MAPON = {
    configurado: () => true, disponible: () => true, estadoCaida: () => null, unidadPorMatricula: async () => null,
    paradasUnidad: async (u, d, h) => { MAPON_LLAMADAS.push(['paradas', u, d, h]); return PARADAS.filter(p => p.desde <= h && (p.hasta == null || p.hasta >= d)); },
    nivelDeposito: async (u, d, h) => { MAPON_LLAMADAS.push(['nivel', u, d, h]); return SERIE.filter(p => p.t >= d && p.t <= h); },
    nivelPorcentaje: async () => [], posicionEn: async () => null, gastadoYKm: async () => ({ gastado: [], km: [] }), capacidadDeposito: async () => null,
  };
  const PARADAS = [{ desde: T - 5 * MIN, hasta: T - 127e3, lat: 40.6569, lng: -3.7545 },     // el 9528MMX: arrancó 127 s antes
    { desde: T + 46e3, hasta: T + 30 * MIN, lat: 40.66, lng: -3.76 },                          // la siguiente, 46 s después
    { desde: T - 40 * H, hasta: T - 39 * H, lat: 40.4, lng: -3.6 }];
  const SERIE = Array.from({ length: 600 }, (_, i) => ({ t: T - 72 * H + i * 12 * MIN, v: 20 + (i % 5) }));
  sustituir('services/mapon.js', MAPON);
  sustituir('modules/Combustible/combustible.repo.js', {});
  const A = require('../modules/Combustible/combustible.auditoria');
  const p1 = A._paradaDe(PARADAS, T, { delExcel: true });
  igual('Fila del Excel: la parada que acabó 127 s antes ES la del repostaje (Petroprix lo apunta al cerrarlo); la que empieza 46 s después, no',
    [p1.cubre, p1.antes && p1.antes.hasta === T - 127e3, p1.cerca], [null, true, null]);
  const p2 = A._paradaDe(PARADAS, T, {});
  igual('…con la regla del correo (Ballenoil: el minuto) cubría la siguiente: por eso el Excel va aparte', [p2.cubre && p2.cubre.desde === T + 46e3, p2.antes], [true, null]);
  igual('…y una que acabó hace más de 5 minutos ya no vale', A._paradaDe([{ desde: T - 20 * MIN, hasta: T - 6 * MIN, lat: 1, lng: 1 }], T, { delExcel: true }).antes, null);
  igual('Un instante del Excel no se mueve el día del cambio de hora (ya se decidió al leerlo); solo se dice en qué pasada cae',
    [A._instante({ origen: 'excel', repostaje_at: '2026-10-25T00:30:00Z' }), A._instante({ origen: 'excel', repostaje_at: '2026-10-25T01:30:00Z' })]
      .map(x => [new Date(x.t).toISOString(), x.repite, x.primera]),
    [['2026-10-25T00:30:00.000Z', true, true], ['2026-10-25T01:30:00.000Z', true, false]]);

  // LA MEMORIA: lo recortado de una ventana grande es lo mismo que pedir la pequeña.
  const { conMemoria } = require('../modules/Combustible/combustible.memoria');
  const mem = conMemoria(MAPON);
  await mem.precargar('u1', { aforador: [T - 72 * H, T + 48 * H], paradas: [T - 3 * H, T + 2 * H] });
  const antesLl = MAPON_LLAMADAS.length;
  const deMem = [await mem.nivelDeposito('u1', T - 72 * H + 5 * H, T + 10 * H), await mem.paradasUnidad('u1', T - 3 * H, T + H)];
  const directo = [await MAPON.nivelDeposito('u1', T - 72 * H + 5 * H, T + 10 * H), await MAPON.paradasUnidad('u1', T - 3 * H, T + H)];
  igual('La memoria: con la ventana del grupo pedida, la de cada repostaje sale de ella, igual que pedida, sin volver a preguntar',
    [JSON.stringify(deMem) === JSON.stringify(directo), MAPON_LLAMADAS.length - antesLl, mem.cuenta()], [true, 2, { pedidas: 2, deMemoria: 2 }]);
  igual('…y lo que no cabe en lo pedido se pregunta', (await mem.nivelDeposito('u1', T + 47 * H, T + 60 * H), mem.cuenta().pedidas), 3);
  // Los km (desde la boya de la ventana fija: lo que gastó entre sus dos
  // lecturas) también van con el grupo, y cada repostaje recorta los suyos.
  const KM = [{ t: T - 2 * H, v: 100 }, { t: T, v: 120 }, { t: T + H, v: 150 }, { t: T + 3 * H, v: 170 }];
  const memKm = conMemoria({ ...MAPON, gastadoYKm: async (u, d, h) => ({ gastado: [], km: KM.filter(p => p.t >= d && p.t <= h) }) });
  await memKm.precargar('u1', { km: [T - 3 * H, T + 2 * H] });
  igual('…los km también: pedidos una vez con el grupo, cada repostaje recorta los suyos de ahí',
    [await memKm.gastadoYKm('u1', T - H, T + 90 * MIN), memKm.cuenta()], [{ gastado: [], km: [KM[1], KM[2]] }, { pedidas: 1, deMemoria: 1 }]);
  const g = A._agrupar([
    { rep: { id: 1 }, t: T, unidad: { unitId: 'u1' } }, { rep: { id: 2 }, t: T + 30 * H, unidad: { unitId: 'u1' } },
    { rep: { id: 3 }, t: T + 5 * 24 * H, unidad: { unitId: 'u1' } }, { rep: { id: 4 }, t: T, unidad: { unitId: 'u2' } },
    { rep: { id: 5 }, t: T, unidad: null }], T + 30 * 24 * H);
  igual('Los grupos: los de un coche en 4 días van juntos (una lectura del aforador de 72 h antes del primero a 48 h después del último); sin Mapon, en ninguno',
    g.map(x => [x.unidad.unitId, x.reps.map(r => r.rep.id), (x.aforador[1] - x.aforador[0]) / H]), [['u1', [1, 2], 150], ['u1', [3], 120], ['u2', [4], 120]]);
  igual('El ritmo: 60 por pasada (cada 10 min), en grupos de 4 días, con 150 ms entre pregunta y pregunta', [A.POR_PASADA, A.AGRUPAR_DIAS, A.PAUSA_MAPON_MS], [60, 4, 150]);

  // ════════════════════════════════════════════════════════════════════════
  // 5. EL IMPORTADOR ENTERO, con un repo de mentira
  // ════════════════════════════════════════════════════════════════════════
  const BD = { filas: [], claves: new Set(), importaciones: [], bolt: {}, bot: {} };
  const COCHES = { '0730MMZ': { vehiculoId: 5, sede: 'madrid', marcaModelo: 'Toyota Corolla Sedan' },
    '7222LVG': { vehiculoId: 1, sede: 'madrid', marcaModelo: 'Toyota Corolla Sedan' },
    '8203LTR': { vehiculoId: 2, sede: 'madrid', marcaModelo: 'Toyota Corolla Touring' },
    '6287LBG': { vehiculoId: 3, sede: 'madrid', marcaModelo: 'Toyota Corolla Sedan', deBaja: true },
    '8997LDK': { vehiculoId: 4, sede: 'madrid', marcaModelo: 'Hyundai Ioniq' } };
  // Quién lo llevaba, por coche: en BOLT y en el bot.
  const B_ = { enBolt: true, repostajeAt: '2026-10-22T10:00:00Z' };
  const BOLT = { '7222LVG': { ...B_, uuid: 'u1', conductorId: 10, nombre: 'Ana Ruiz', conectado: true, segundos: 0, situacion: 'espera' },
    '8203LTR': { ...B_, uuid: 'u2', conductorId: 11, nombre: 'Luis Gil', conectado: true, segundos: 0, situacion: 'viaje' },
    '6287LBG': { ...B_, uuid: null },
    '8997LDK': { ...B_, uuid: 'u4', conductorId: 13, nombre: 'Eva Sanz', conectado: false, segundos: 3600 },
    '0730MMZ': { ...B_, uuid: 'u5', conductorId: 15, nombre: 'Isaac Checa', conectado: true, segundos: 0, situacion: 'espera' } };
  const BOT = { '7222LVG': { turnoId: 1, tipo: 'turno', conductorId: 10, nombre: 'Ana Ruiz', dentro: true, segFin: 0 },
    '8203LTR': { turnoId: 2, tipo: 'turno', conductorId: 12, nombre: 'Marta Vidal', dentro: true, segFin: 0 },
    '6287LBG': { turnoId: 3, tipo: 'turno', conductorId: 14, nombre: 'Pedro Díaz', dentro: false, segFin: 2 * 3600 },
    '8997LDK': { turnoId: 4, tipo: 'turno', conductorId: 13, nombre: 'Eva Sanz', dentro: false, segFin: 13 * 3600 },
    // El 5736LGK del 17/10: en BOLT, otro conectado; en el bot, un turno cerrado 11 h 41 min antes.
    '0730MMZ': { turnoId: 5, tipo: 'turno', conductorId: 16, nombre: 'Ruben Armendariz', dentro: false, segFin: 701 * 60 } };
  const mat = id => BD.filas[id - 1].matricula;
  sustituir('modules/Combustible/combustible.repo.js', {
    importacionConHuella: async h => BD.importaciones.filter(i => i.huella === h && i.terminada).slice(-1)[0] || null,
    empezarImportacion: async o => BD.importaciones.push({ ...o, id: BD.importaciones.length + 1 }),
    cerrarImportacion: async (id, c) => { Object.assign(BD.importaciones[id - 1], c, { terminada: true, empezada_local: '23/10/2026 12:00' }); },
    cochesDe: async ms => new Map(ms.map(m => [m, COCHES[m] || { vehiculoId: null, sede: null }])),
    gasolineras: async () => LISTA, aliasGasolineras: async () => new Map(), textosGasolineras: async () => TEXTOS_MAP,
    clavesYaGuardadas: async (p, cs) => new Set(cs.filter(c => BD.claves.has(c))),
    // Como el de verdad: del mismo coche, litros e importe, a ±2 s o a una hora ±2 s, y con otra clave.
    casiIgualesDelExcel: async (p, fs2) => new Map(fs2.flatMap(x => {
      const o = BD.filas.find(f => f.excel_clave !== x.clave && f.matricula === x.matricula && f.litros === x.litros && f.importe === x.importe &&
        (d => Math.abs(d) <= 2 || Math.abs(Math.abs(d) - 3600) <= 2)((Date.parse(x.instante) - Date.parse(f.repostaje_at)) / 1000));
      return o ? [[x.clave, { id: o.id, segundos: Math.round((Date.parse(x.instante) - Date.parse(o.repostaje_at)) / 1000), guardada: o.repostaje_at }]] : [];
    })),
    guardarDelExcel: async filas => filas.filter(f => !BD.claves.has(f.excel_clave)).map(f => {
      BD.claves.add(f.excel_clave);
      return { id: BD.filas.push({ ...f, id: BD.filas.length + 1 }), clave: f.excel_clave };
    }),
    frescuraBolt: async () => ({ madrid: '2026-10-23T08:00:00Z', otras: '2026-10-23T08:00:00Z' }),
    boltMadridDe: async ids => new Map(ids.map(id => [Number(id), BOLT[mat(id)] || { enBolt: false, repostajeAt: B_.repostajeAt }])),
    boltOtraSedeDe: async ids => new Map(ids.map(id => [Number(id), BOLT[mat(id)] || { enBolt: false, repostajeAt: B_.repostajeAt }])),
    ponerBoltDe: async fs2 => { for (const f of fs2) BD.bolt[f.id] = f; },
    botDe: async ids => new Map(ids.map(id => [Number(id), BOT[mat(id)] || { turnoId: null }])),
    ponerBot: async fs2 => { for (const f of fs2) BD.bot[f.id] = f; },
  });
  sustituir('services/correo.js', {});
  sustituir('services/configApp.js', { leerConfig: async () => ({}) });
  sustituir('services/modoPruebas.js', { ACTIVO: false });
  for (const k of ['combustible.auditoria', 'combustible.service']) delete require.cache[require.resolve(`../modules/Combustible/${k}`)];
  const S = require('../modules/Combustible/combustible.service');

  const ExcelJS = require('exceljs');
  const xlsx = async (filas, cab = X.CABECERA, hoja = 'Repostajes') => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(hoja);
    ws.addRow(cab);
    for (const f of filas) ws.addRow(f);
    return (await wb.xlsx.writeBuffer()).toString('base64');
  };
  const FILAS = [
    ['22-10-2026 18:14:01', '7222LVG', 'Turismo', 'Gasolina', '13,93', '23,53', 'Pago Petroprix', TEXTOS['Petroprix Alcobendas 2']],
    ['22-10-2026 17:03:54', '8203LTR', 'Turismo', 'Diesel', '22,87', '40,00', 'Tarjeta', TEXTOS['Petroprix Fuenlabrada 3']],
    ['22-10-2026 16:45:19', '6287LBG', 'Turismo', 'Gasolina', '11,70', '20,00', 'Efectivo', TEXTOS['Petroprix Carabanchel']],
    ['22-10-2026 15:00:00', '8997LDK', '-', 'Gasolina', '30,32', '50,00', 'Pago Petroprix', TEXTOS['Petroprix Torrejón']],
    ['22-10-2026 14:19:12', '1234ABC', 'Turismo', 'Gasolina', '11,70', '20,00', 'Pago Petroprix', 'Getafe 2\nCalle Nueva 3 28900'],
    ['31-02-2026 10:00:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']],
  ];
  const r1 = await S.importarExcel({ base64: await xlsx(FILAS), nombre: 'repostajes (14).xlsx' }, { usuarioId: 7 });
  igual('Importar: 6 filas, 5 nuevas, 1 con error (y cuál y por qué)',
    [r1.filas, r1.nuevas, r1.yaEstaban, r1.conError, r1.errores], [6, 5, 0, 1,
      [{ fila: 7, motivo: 'la fecha «31-02-2026 10:00:00» no se entiende (tiene que ser DD-MM-AAAA HH:MM:SS)' }]]);
  const av = Object.fromEntries(Object.entries(r1.avisos).map(([k, v]) => [k, v.filas]));
  igual('…los avisos por tipo, con sus filas: diésel, pago, «-», de baja, matrícula sin dar de alta, gasolinera que no casa',
    av, { diesel: [3], pago: [3, 4], baja: [4], vehiculo: [5], matricula: [6], gasolinera: [6] });
  igual('…cada repostaje con su coche, su sede, su gasolinera por el texto exacto y lo del Excel (pago, «Vehículo», combustible, la fila)',
    (f => [f.origen, f.vehiculo_id, f.sede, f.gasolinera_id === porNombre('Petroprix Fuenlabrada 3').id, f.gasolinera_como, f.metodo_pago,
      f.vehiculo_tipo, f.carburante, f.excel_fila, f.repostaje_at, f.avisos.length])({ origen: 'excel', ...BD.filas[1] }),
    ['excel', 2, 'madrid', true, 'texto', 'Tarjeta', 'Turismo', 'Diesel', 3, '2026-10-22T15:03:54.000Z', 2]);
  igual('…la estación, el texto con lo mínimo normalizado (el nombre y la dirección)', BD.filas[0].estacion, 'Alcobendas 2\nCalle Valgrande 11 28108');
  igual('Quién: BOLT y el bot, la misma (7222LVG); distinta (8203LTR); solo el bot, que lo dejó hace 2 h (6287LBG); solo BOLT, porque el bot lo cerró hace 13 h (8997LDK); ninguno (1234ABC)',
    r1.quien, { conBolt: 3, conBot: 3, mismo: 1, distinto: 1, botCerrado: 0, soloBot: 1, soloBolt: 1, nadie: 1, boltPendiente: 0 });
  igual('…el bot apuntado: en turno, el último (con hace cuánto) o nadie pasadas 12 h',
    [1, 3, 4].map(id => [BD.bot[id].estado, BD.bot[id].antiguedadMin == null ? null : BD.bot[id].antiguedadMin]),
    [['en_turno', 0], ['ultimo', 120], ['nadie', null]]);

  const r2 = await S.importarExcel({ base64: await xlsx(FILAS), nombre: 'repostajes (14).xlsx' }, { usuarioId: 7 });
  igual('El mismo Excel otra vez: 0 nuevas, las 5 ya estaban, y dice que ese fichero ya se importó', [r2.nuevas, r2.yaEstaban, r2.conError, !!r2.yaImportado, BD.filas.length],
    [0, 5, 1, true, 5]);
  const r3 = await S.importarExcel({ base64: await xlsx([['23-10-2026 08:00:00', '7222LVG', 'Turismo', 'Gasolina', '20,00', '33,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']],
    ...FILAS.slice(0, 2)]), nombre: 'repostajes (15).xlsx' }, { usuarioId: 7 });
  igual('Uno que se solapa con el anterior: solo entra lo nuevo', [r3.filas, r3.nuevas, r3.yaEstaban, BD.filas.length], [3, 1, 2, 6]);
  const n = BD.importaciones.length;
  igual('Un Excel que no es el de Petroprix: no importa nada, ni deja importación',
    [await S.importarExcel({ base64: await xlsx([['1234ABC', 'Toyota', '20/10/2026', '09:00']], ['MATRICULA', 'VEHICULO', 'CITA TALLER', 'HORA'], 'Citas') })
      .then(() => 'importado', e => /no es el de repostajes de Petroprix/.test(e.message)), BD.importaciones.length === n], [true, true]);
  igual('…ni un fichero que no es un Excel', await S.importarExcel({ base64: Buffer.from('hola').toString('base64') }).then(() => 'importado', e => e.message),
    'No se pudo abrir el archivo: tiene que ser un Excel (.xlsx)');

  // LA MISMA FILA CON LA HORA CORRIDA (revisión del 23/10/2026): una hora antes
  // (un Petroprix que pinta las horas de antes del cambio de hora con el desfase
  // de después) o un segundo más. Y una fila del futuro, y un turno del bot ya
  // cerrado con otro conectado en BOLT.
  const r4 = await S.importarExcel({ base64: await xlsx([
    ['22-10-2026 17:14:01', '7222LVG', 'Turismo', 'Gasolina', '13,93', '23,53', 'Pago Petroprix', TEXTOS['Petroprix Alcobendas 2']],
    ['22-10-2026 17:03:55', '8203LTR', 'Turismo', 'Diesel', '22,87', '40,00', 'Tarjeta', TEXTOS['Petroprix Fuenlabrada 3']],
    ['25-10-2030 10:00:00', '7222LVG', 'Turismo', 'Gasolina', '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']],
    ['17-10-2026 06:45:00', '0730MMZ', 'Turismo', 'Gasolina', '26,23', '45,00', 'Pago Petroprix', TEXTOS['Petroprix Parla 2']],
  ]), nombre: 'repostajes (16).xlsx' }, { usuarioId: 7 });
  igual('La hora corrida una hora o un segundo: ya estaban (no entran otra vez) y se dice; la del futuro, error; una nueva',
    [r4.filas, r4.nuevas, r4.yaEstaban, r4.conError, (r4.avisos.corrida || {}).filas, r4.corridas.map(x => x.segundos).sort((a, b) => a - b), BD.filas.length,
      r4.errores.map(e => [e.fila, /es de después de importar/.test(e.motivo)])],
    [4, 1, 2, 1, [3, 2], [-3600, 1], 7, [[4, true]]]);
  igual('…y la nueva: BOLT tiene a uno conectado y el bot, a otro que cerró su turno 11 h 41 min antes: «bot ya cerrado», no «distintos»',
    [r4.quien.botCerrado, r4.quien.distinto, BD.bot[7].estado, BD.bot[7].antiguedadMin], [1, 0, 'ultimo', 701]);

  // LO QUE CABE EN UN EXCEL: 20.000 filas, y 25 MB descomprimido.
  const nImp = BD.importaciones.length;
  const grande = Array.from({ length: 20002 }, (_, i) => [`01-0${1 + (i % 9)}-2026 10:${String(i % 60).padStart(2, '0')}:00`, '7222LVG', 'Turismo', 'Gasolina',
    '10,00', '17,00', 'Pago Petroprix', TEXTOS['Petroprix Getafe']]);
  igual('Un Excel de más de 20.000 filas no se abre entero: lo dice y no importa nada',
    [await S.importarExcel({ base64: await xlsx(grande), nombre: 'enorme.xlsx' }).then(() => 'importado', e => /como mucho se importan 20\.000 de una vez/.test(e.message)),
      BD.importaciones.length === nImp], [true, true]);
  // Un zip que dice descomprimir a 4 GB (el tamaño de una de sus partes, puesto a 0xFFFFFFFF).
  const bomba = Buffer.from(await xlsx(FILAS.slice(0, 1)), 'base64');
  for (let i = bomba.length - 22; i >= 0; i--) {
    if (bomba.readUInt32LE(i) === 0x06054b50) { bomba.writeUInt32LE(0xFFFFFFFF, bomba.readUInt32LE(i + 16) + 24); break; }
  }
  igual('…ni uno que descomprime a más de 25 MB (se mira su directorio, sin descomprimir nada)',
    [await S.importarExcel({ base64: bomba.toString('base64'), nombre: 'bomba.xlsx' }).then(() => 'importado', e => /ocupa demasiado descomprimido/.test(e.message)),
      BD.importaciones.length === nImp], [true, true]);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
