// ============================================================
// BARCELONA — el Excel del planificador (el que sustituye a «Imprimir»)
// ============================================================
// Camilo, 06/11/2026: «no era imprimir sino exportar en excel … de una vez
// actualiza el excel y elimina lo de "imprimir"». Comprueba
// modules/Barcelona/barcelona.planificador.excel.js con un tablero de mentira
// (la forma nueva: casillas de CT del cuadrante):
//
//   · que se genera, con la banda (día largo, zona, cifras, «Exportado el …»),
//     la hoja apaisada a una página de ancho y las cabeceras de cada tabla;
//   · que cada casilla de CT es UNA celda combinada en todas las filas de su
//     cuadrante (la todoturno, además, en dos columnas), con su persona, lo que
//     cubre, lo que libra y el estado del día;
//   · los estados de los fijos (cubre el CT, hueco, libra), los colores, los
//     cuadrantes libres y «Sin plaza»;
//   · que la zona y el buscador dejan lo mismo que la pantalla
//     (pintarCuadrantes de public/assets/js/vistas/Barcelona/
//     barcelona-planificador.js): lo esperado de cada caso está escrito a mano,
//     mirando lo que la pantalla enseñaría con ese tablero.
//
//   node scripts/comprobar-barcelona-planificador-excel.js [carpeta]
//
// No toca la base. Con una carpeta, deja allí un ejemplo (ejemplo.xlsx) para
// abrirlo y mirarlo.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const X = require('../modules/Barcelona/barcelona.planificador.excel');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const contiene = (nombre, texto, trozos) => igual(nombre, trozos.filter(t => !String(texto).includes(t)), []);

// ── El tablero de mentira: viernes 06/11/2026 ────────────────────────────────
// Dos zonas; C1 con casilla de día (Ana) y de noche (vacía: hueco hoy), C2 con
// una todoturno (Eva), C3 sin casillas, C4 sin zona y vacío; dos coches libres
// (uno sin dar de alta en BOLT, otro desactivado) y dos personas sin plaza.
const FECHA = '2026-11-06';
const AHORA = new Date(Date.UTC(2026, 10, 6, 16, 30));      // 17:30 en Madrid
const pr = (horas, extra = {}) => ({ horas, total: horas == null ? 0 : horas * 13, salio: 13, ausencias: 1, media: horas, periodo: '2026-11', mesAnterior: false, ne: null, ...extra });
const P = (nombre, telefono, extra = {}) => ({ uuid: 'u-' + nombre.toLowerCase(), nombre, telefono, activa: true, desde: '2026-11-02', hasta: null, libraHoy: false, trabajaHoy: true, promedio: pr(9.4), ...extra });
const coche = (matricula, cuadranteId, extra) => ({
  matricula, modelo: 'Corolla', enBolt: true, enErp: true, activo: true, estadoBolt: 'active', cuadranteId,
  descansoTurno: { dia: [], noche: [] }, plazas: { fijoDia: null, fijoNoche: null }, turnos: { dia: 'trabaja', noche: 'trabaja' }, ...extra,
});

function tableroDePrueba() {
  const ana = P('Ana', '600000001');
  const eva = P('Eva', '600000005', { promedio: pr(8.2, { mesAnterior: true, periodo: '2026-10' }) });
  return {
    fecha: FECHA, hoy: FECHA,
    zonas: [{ id: '1', nombre: 'Eixample', cuadrantes: 2, coches: 3 }, { id: '2', nombre: 'Gràcia', cuadrantes: 1, coches: 1 }],
    cuadrantes: [
      { id: '10', numero: 1, nombre: 'Centro', zonaId: '1', zona: 'Eixample', coches: ['1111AAA', '2222BBB'],
        casillas: [
          { jornada: 'noche', desde: '2026-11-06', persona: null,
            cubre: [{ dia: 6, matricula: '2222BBB', turno: 'noche' }, { dia: 5, matricula: '1111AAA', turno: 'noche' }],
            libra: [1, 2, 3, 4, 7], hoy: { matricula: '1111AAA', turno: 'noche' } },
          { jornada: 'dia', desde: '2026-11-02', persona: ana,
            cubre: [{ dia: 1, matricula: '1111AAA', turno: 'dia' }, { dia: 2, matricula: '2222BBB', turno: 'dia' }],
            libra: [3, 4, 5, 6, 7], hoy: null },
        ],
        puedeAgregar: { dia: false, noche: false, todoturno: false } },
      { id: '20', numero: 2, nombre: null, zonaId: '1', zona: 'Eixample', coches: ['5555EEE'],
        casillas: [{ jornada: 'todoturno', desde: '2026-11-03', persona: eva,
          cubre: [{ dia: 7, matricula: '5555EEE', turno: 'noche' }, { dia: 5, matricula: '5555EEE', turno: 'dia' }],
          libra: [1, 2, 3, 4, 6], hoy: { matricula: '5555EEE', turno: 'dia' } }],
        puedeAgregar: { dia: false, noche: false, todoturno: false } },
      { id: '30', numero: 3, nombre: 'Norte', zonaId: '2', zona: 'Gràcia', coches: ['6666FFF'], casillas: [],
        puedeAgregar: { dia: true, noche: true, todoturno: true } },
      // Vacío, pero con su casilla de día ya puesta (Lola): aún no coge nada.
      { id: '40', numero: 4, nombre: null, zonaId: null, zona: null, coches: [],
        casillas: [{ jornada: 'dia', desde: '2026-11-06', persona: P('Lola', '600000012', { desde: '2026-11-06' }), cubre: [], libra: [1, 2, 3, 4, 5, 6, 7], hoy: null }],
        puedeAgregar: { dia: false, noche: true, todoturno: false } },
    ],
    coches: [
      coche('1111AAA', '10', { descansoTurno: { dia: [1], noche: [5] },
        plazas: { fijoDia: P('Beto', '600000002'), fijoNoche: P('Caro', '600000003', { libraHoy: true, trabajaHoy: false }) },
        turnos: { dia: 'trabaja', noche: 'hueco' } }),
      // El orden de los coches lo da el cuadrante (cu.coches), no el de esta lista.
      coche('2222BBB', '10', { descansoTurno: { dia: [2], noche: [6] },
        plazas: { fijoDia: P('Dani', '600000004', { activa: false }), fijoNoche: null },
        turnos: { dia: 'trabaja', noche: 'hueco' } }),
      coche('5555EEE', '20', { descansoTurno: { dia: [5], noche: [7] },
        plazas: { fijoDia: P('Fran', '600000006', { libraHoy: true, trabajaHoy: false }), fijoNoche: P('Gema', '') },
        turnos: { dia: 'cubre-ct', noche: 'trabaja' } }),
      coche('6666FFF', '30', { modelo: 'Prius', descansoTurno: { dia: [5], noche: [] },
        plazas: { fijoDia: P('Hugo', '600000008', { libraHoy: true, trabajaHoy: false, promedio: pr(null, { ne: 'menos de 5 días' }) }), fijoNoche: null },
        turnos: { dia: 'libra', noche: 'hueco' } }),
      coche('4444DDD', null, { enBolt: false, estadoBolt: '',
        plazas: { fijoDia: P('Iris Núñez', '600000009'), fijoNoche: null }, turnos: { dia: 'trabaja', noche: 'hueco' } }),
      coche('3333CCC', null, { modelo: 'Prius', activo: false, enErp: false, estadoBolt: 'deactivated', turnos: { dia: 'hueco', noche: 'hueco' } }),
    ],
    conductores: [],
    sinPlaza: [P('Kike', '600000011', { promedio: pr(null, { ne: 'menos de 5 días' }) }), P('Juan', '600000010')],
    resumen: { coches: 5, turnos: 9, cubiertos: 5, huecos: 4, libran: 1, sinPlaza: 2, casillas: 3 },
  };
}

// ── Leer lo generado ─────────────────────────────────────────────────────────
const textoDe = v => (v == null ? '' : v.richText ? v.richText.map(r => r.text).join('') : typeof v === 'object' && v.text ? v.text : String(v));

async function leer(opciones) {
  const buf = await X.generar({ ahora: AHORA, ...opciones });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Planificador');
  const celdas = [];
  ws.eachRow({ includeEmpty: false }, fila => fila.eachCell({ includeEmpty: false }, c => {
    if (c.isMerged && c.master.address !== c.address) return;      // solo la principal de cada combinada
    const t = textoDe(c.value);
    if (t) celdas.push({ fila: fila.number, col: c.col, dir: c.address, texto: t, celda: c });
  }));
  const buscar = trozo => celdas.find(c => c.texto.includes(trozo)) || { texto: '', fila: 0, col: 0 };
  const en = (fila, col) => celdas.find(c => c.fila === fila && c.col === col) || { texto: '' };
  // Las matrículas, en el orden de la hoja: la primera línea de una celda de la columna A.
  const matriculas = celdas.filter(c => c.col === 1 && /^\d{4}[A-Z]{3}$/.test(c.texto.split('\n')[0])).map(c => c.texto.split('\n')[0]);
  // La fila de un coche: la de su matrícula en la columna A (en la casilla de
  // CT también sale la matrícula, en lo que cubre).
  const coche = mat => celdas.find(c => c.col === 1 && c.texto.split('\n')[0] === mat) || { texto: '', fila: 0, col: 0 };
  const merges = ws.model.merges || [];
  return { buf, ws, celdas, buscar, en, coche, matriculas, merges };
}
const fondo = celda => (celda && celda.fill && celda.fill.fgColor ? celda.fill.fgColor.argb : null);

(async () => {
  // ═══════ TODO EL PLANIFICADOR ═══════
  const T = tableroDePrueba();
  const h = await leer({ tablero: T });
  igual('genera un .xlsx (zip)', h.buf.slice(0, 2).toString(), 'PK');
  igual('la hoja se llama Planificador', h.ws.name, 'Planificador');
  igual('apaisada, A4, a una página de ancho', [h.ws.pageSetup.orientation, h.ws.pageSetup.paperSize, h.ws.pageSetup.fitToPage, h.ws.pageSetup.fitToWidth, h.ws.pageSetup.fitToHeight],
    ['landscape', 9, true, 1, 0]);
  contiene('la banda: qué y el día largo', h.en(1, 1).texto, ['PLANIFICADOR · BARCELONA · viernes 6 de noviembre de 2026']);
  contiene('la banda: zona, cifras y cuándo se exportó (hora de Madrid)', h.en(2, 1).texto,
    ['Todas las zonas', '5 coches', '5 / 9 turnos cubiertos', '4 huecos', '1 libra (el coche no sale)', '2 sin plaza', 'Exportado el 06/11/2026 a las 17:30']);
  igual('sin buscador no dice «solo lo que coincide»', h.en(2, 1).texto.includes('coincide'), false);
  igual('seis columnas: las cuatro fijas y dos de CT (la todoturno ocupa dos)', h.ws.getColumn(7).width == null && h.ws.getColumn(6).width > 0, true);

  // El orden: las zonas como sus tarjetas, los sin zona, los libres y «Sin plaza».
  const orden = ['EIXAMPLE', 'C1 · Centro · Eixample', 'C2 · Eixample', 'GRÀCIA', 'C3 · Norte · Gràcia', 'SIN ZONA', 'C4 · sin zona', 'CUADRANTES LIBRES', 'SIN PLAZA']
    .map(t => h.buscar(t).fila);
  igual('el orden de la pantalla (zonas, sin zona, libres, sin plaza)', orden.every((x, i) => x > 0 && (!i || x > orden[i - 1])), true);
  igual('los coches, en el orden del cuadrante y luego los libres', h.matriculas, ['1111AAA', '2222BBB', '5555EEE', '6666FFF', '4444DDD', '3333CCC']);

  // ── C1: casilla de día (Ana) y de noche (vacía), combinadas en sus dos filas.
  const f1 = h.coche('1111AAA').fila;
  const cabC1 = [1, 2, 3, 4, 5, 6].map(c => h.en(f1 - 1, c).texto);
  igual('la cabecera de C1: las cuatro fijas, ☀ CT día y ☾ CT noche (de izquierda a derecha)', cabC1,
    ['Matrícula', 'Descanso', '☀ Fijo día', '☾ Fijo noche', '☀ CT día', '☾ CT noche']);
  igual('C1: la casilla de día, UNA celda en las dos filas del cuadrante', h.merges.includes(`E${f1}:E${f1 + 1}`), true);
  igual('C1: la casilla de noche, también', h.merges.includes(`F${f1}:F${f1 + 1}`), true);
  contiene('C1 ☀ CT día: la persona, su promedio, lo que cubre, lo que libra y hoy', h.en(f1, 5).texto,
    ['Ana', '9,4 h', '600000001', 'desde 02/11', 'cubre: L 1111AAA · M 2222BBB', 'libra: X J V S D', 'libra hoy']);
  contiene('C1 ☾ CT noche vacía: «Sin asignar», lo que cubriría y el hueco de hoy', h.en(f1, 6).texto,
    ['Sin asignar', 'casilla desde 06/11', 'cubre: V 1111AAA · S 2222BBB', 'libra: L M X J D', 'hueco hoy · 1111AAA de noche']);
  igual('la casilla de día va en verde y la de noche en morado', [fondo(h.ws.getCell(`E${f1}`)), fondo(h.ws.getCell(`F${f1}`))], ['FFE2EFDA', 'FFE4DFEC']);
  igual('la nota de la casilla lleva el desglose del promedio', String(h.ws.getCell(`E${f1}`).note || '').includes('Ana · promedio de noviembre: 9,4 h por día'), true);
  contiene('el descanso: sol y luna', h.en(f1, 2).texto, ['☀ libra L', '☾ libra V']);
  contiene('fijo de día que trabaja', h.en(f1, 3).texto, ['Beto', '600000002', 'libra L · desde 02/11']);
  contiene('fijo de noche que libra con la casilla vacía: «libra hoy · hueco»', h.en(f1, 4).texto, ['Caro', 'libra V', 'libra hoy · hueco']);
  igual('… en rojo', fondo(h.ws.getCell(`D${f1}`)), 'FFFDE2E2');
  igual('el fijo de día va en azul', fondo(h.ws.getCell(`C${f1}`)), 'FFDDEBF7');
  contiene('cuenta desactivada: tachada y avisada', h.en(f1 + 1, 3).texto, ['Dani', 'ya no está activa en BOLT']);
  igual('… tachada', !!h.ws.getCell(`C${f1 + 1}`).value.richText[0].font.strike, true);
  contiene('turno sin fijo: «Sin conductor» y «hueco hoy»', h.en(f1 + 1, 4).texto, ['Sin conductor', 'hueco hoy']);

  // ── C2: la todoturno, en dos columnas combinadas.
  const f2 = h.coche('5555EEE').fila;
  igual('C2: la cabecera «CT todoturno», sin icono, en dos columnas', [h.en(f2 - 1, 5).texto, h.merges.includes(`E${f2 - 1}:F${f2 - 1}`)], ['CT todoturno', true]);
  igual('C2: la casilla todoturno, una celda en E:F', h.merges.includes(`E${f2}:F${f2}`), true);
  contiene('C2 todoturno: cada plaza con su turno y hoy a quién cubre', h.en(f2, 5).texto,
    ['Eva', '8,2 h · oct', 'desde 02/11', 'cubre: V 5555EEE (día) · D 5555EEE (noche)', 'libra: L M X J S', 'cubre hoy 5555EEE de día']);
  igual('la todoturno, en gris claro', fondo(h.ws.getCell(`E${f2}`)), 'FFE5E7EB');
  contiene('fijo que libra y lo cubre la casilla: «libra hoy · lo cubre el CT»', h.en(f2, 3).texto, ['Fran', 'libra hoy · lo cubre el CT (Eva)']);
  contiene('fijo sin teléfono', h.en(f2, 4).texto, ['Gema', 'sin teléfono']);
  contiene('el título del cuadrante', h.buscar('C2 · Eixample').texto, ['C2 · Eixample', '1 coche', 'CT: todoturno']);

  // ── C3: sin casillas, la tabla se queda en cuatro columnas.
  const f3 = h.coche('6666FFF').fila;
  igual('C3 sin casillas: cuatro columnas en su cabecera', [h.en(f3 - 1, 4).texto, h.en(f3 - 1, 5).texto], ['☾ Fijo noche', '']);
  contiene('C3: el fijo libra y no hay casilla: «libra hoy» (el coche no sale)', h.en(f3, 3).texto, ['Hugo', 'N/E', 'libra hoy']);
  igual('… en gris, no en rojo', fondo(h.ws.getCell(`C${f3}`)), 'FFF3F4F6');
  igual('C3 sin fijo de noche: hueco en rojo', [h.en(f3, 4).texto.includes('hueco hoy'), fondo(h.ws.getCell(`D${f3}`))], [true, 'FFFDE2E2']);
  const f4 = h.buscar('Cuadrante vacío').fila;
  contiene('C4 vacío, sin zona, con su casilla al lado', h.en(f4, 5).texto, ['Lola', 'Todavía no coge nada: ningún fijo de día del cuadrante libra.']);

  // ── Los libres y «Sin plaza».
  contiene('libre sin dar de alta en BOLT', h.coche('4444DDD').texto, ['No está dado de alta en BOLT']);
  const fd = h.coche('3333CCC');
  contiene('libre desactivado', fd.texto, ['desactivado en BOLT']);
  contiene('un coche desactivado no tiene huecos: «no sale»', h.en(fd.fila, 3).texto, ['no sale · coche desactivado']);
  const fsp = h.buscar('SIN PLAZA').fila;
  const sp = h.celdas.filter(c => c.fila > fsp).map(c => c.texto).join(' | ');
  contiene('«Sin plaza», por nombre, con teléfono y promedio', sp, ['Nombre', 'Teléfono', 'Promedio', 'Juan', '600000010', '9,4 h', '13 días que salió · 1 ausencia', 'Kike', 'N/E', 'menos de 5 días']);
  igual('«Sin plaza» va por nombre (Juan antes que Kike)', h.buscar('Juan').fila < h.buscar('Kike').fila, true);

  // ═══════ LOS FILTROS: lo mismo que deja la pantalla ═══════
  // Lo esperado es lo que pintaría pintarCuadrantes con este tablero. La
  // pantalla manda la tarjeta «Sin zona» como zona=libres.
  const casos = [
    ['zona Eixample (por id)', { zona: '1' }, ['1111AAA', '2222BBB', '5555EEE']],
    ['zona Eixample (por su nombre, como #zona=eixample)', { zona: 'eixample' }, ['1111AAA', '2222BBB', '5555EEE']],
    ['zona Gràcia', { zona: '2' }, ['6666FFF']],
    ['«Sin zona» (zona=libres, lo que manda la pantalla): los cuadrantes sin zona y los libres', { zona: 'libres' }, ['4444DDD', '3333CCC']],
    ['«Sin zona» por su clave de la pantalla', { zona: 'sin' }, ['4444DDD', '3333CCC']],
    ['una zona que ya no existe: todas, como la pantalla', { zona: '99' }, ['1111AAA', '2222BBB', '5555EEE', '6666FFF', '4444DDD', '3333CCC']],
    ['buscar a la persona de una casilla: los coches de su cuadrante', { q: 'ana' }, ['1111AAA', '2222BBB']],
    ['buscar a un fijo', { q: 'Beto' }, ['1111AAA']],
    ['buscar sin tildes', { q: 'nunez' }, ['4444DDD']],
    ['buscar un teléfono', { q: '600000006' }, ['5555EEE']],
    ['buscar una matrícula a medias', { q: '2222' }, ['2222BBB']],
    ['buscar un modelo', { q: 'prius' }, ['6666FFF', '3333CCC']],
    ['zona y buscador a la vez', { zona: '1', q: 'eva' }, ['5555EEE']],
    ['nada que coincida', { q: 'zzz' }, []],
  ];
  for (const [nombre, filtro, esperado] of casos) {
    const x = await leer({ tablero: T, ...filtro });
    igual(`filtro: ${nombre}`, x.matriculas, esperado);
  }
  const z1 = await leer({ tablero: T, zona: '1' });
  contiene('con una zona, la banda da las cifras de sus coches', z1.en(2, 1).texto,
    ['Zona Eixample', '3 coches', '4 / 6 turnos cubiertos', '2 huecos', '0 libran', '2 sin plaza en Barcelona']);
  igual('con una zona no salen los libres', z1.buscar('CUADRANTES LIBRES').fila, 0);
  const sin = await leer({ tablero: T, zona: 'libres' });
  contiene('«Sin zona» lleva el cuadrante sin zona', sin.buscar('C4').texto + ' ' + sin.buscar('Cuadrante vacío').texto, ['C4 · sin zona', 'Cuadrante vacío']);
  contiene('… y la banda lo dice, con sus coches activos', sin.en(2, 1).texto, ['Sin zona y cuadrantes libres', '1 coche', '2 sin plaza en Barcelona']);
  igual('… sin los cuadrantes con zona', [sin.buscar('EIXAMPLE').fila, sin.buscar('CUADRANTES LIBRES').fila > 0], [0, true]);
  // Buscando a la persona de una casilla sale su cuadrante, aunque esté vacío.
  const lola = await leer({ tablero: T, q: 'lola' });
  igual('buscar a la persona de la casilla de un cuadrante vacío: sale el cuadrante', [lola.matriculas, lola.buscar('C4 · sin zona').fila > 0, lola.buscar('Lola').fila > 0], [[], true, true]);
  const beto = await leer({ tablero: T, q: 'Beto' });
  const fb = beto.coche('1111AAA').fila;
  igual('buscando, la casilla abarca solo las filas que quedan (una: sin combinar en vertical)', [beto.merges.some(m => m.startsWith(`E${fb}:`)), beto.en(fb, 5).texto.includes('Ana')], [false, true]);
  contiene('buscando, la banda lo dice', beto.en(2, 1).texto, ['solo lo que coincide con «Beto»']);
  const nada = await leer({ tablero: T, q: 'zzz' });
  contiene('sin nada que coincida, se dice, y «Sin plaza» sigue (no depende del buscador)', nada.celdas.map(c => c.texto).join(' | '),
    ['No hay coches que coincidan con «zzz».', 'SIN PLAZA', 'Juan']);
  igual('sin casillas en lo exportado, solo cuatro columnas', nada.ws.getColumn(5).width == null, true);

  // ═══════ OTRO DÍA Y TABLEROS RAROS ═══════
  const manana = await leer({ tablero: { ...T, hoy: '2026-11-05' } });
  contiene('mirando otro día no dice «hoy»: «el V 06/11»', manana.en(f1, 4).texto, ['libra el V 06/11 · hueco']);
  // Una plaza repetida (las escrituras no la dejan, pero si llega se avisa) y
  // una casilla que se quita más adelante.
  const rep = tableroDePrueba();
  const kDia = rep.cuadrantes[0].casillas[1];
  kDia.repetidas = [{ dia: 1, plazas: [{ matricula: '1111AAA', turno: 'dia' }, { matricula: '2222BBB', turno: 'dia' }] }];
  kDia.hasta = '2026-11-30';
  const rp = await leer({ tablero: rep });
  contiene('plaza repetida: se avisa en la casilla', rp.en(rp.coche('1111AAA').fila, 5).texto, ['ojo: el L coge 1111AAA y 2222BBB a la vez', 'desde 02/11 · hasta 30/11']);
  // La libranza es de la plaza: sin fijo, el día que libra con la casilla vacía
  // también es «libra hoy · hueco» (como lineaTurno de la pantalla).
  const sinFijo = tableroDePrueba();
  sinFijo.coches[0].descansoTurno.noche = [6];
  sinFijo.coches[1].descansoTurno.noche = [5];
  const sf = await leer({ tablero: sinFijo });
  contiene('turno sin fijo el día que libra la plaza: «libra hoy · hueco»', sf.en(sf.coche('2222BBB').fila, 4).texto, ['Sin conductor', 'libra hoy · hueco']);
  const vacio = await leer({ tablero: {} });
  contiene('un tablero vacío no rompe', vacio.celdas.map(c => c.texto).join(' | '), ['PLANIFICADOR · BARCELONA', 'Todavía no hay coches de Barcelona', 'Todos tienen plaza.']);
  const falta = await leer({ tablero: { faltaMigracion: 'db/236', fecha: FECHA } });
  contiene('sin la migración, se dice cuál', falta.celdas.map(c => c.texto).join(' | '), ['Falta aplicar la migración db/236 (en Migraciones)']);
  // La forma de antes (CT por coche, sin casillas): no rompe, y el fijo que
  // libra con su CT trabajando dice que lo cubre el CT.
  const viejo = tableroDePrueba();
  viejo.cuadrantes.forEach(cu => { delete cu.casillas; });
  viejo.coches[2].turnos.dia = 'trabaja';
  viejo.coches[2].plazas.ctDia = P('Eva', '600000005');
  const v = await leer({ tablero: viejo });
  igual('la forma de antes no rompe y no inventa casillas', [v.matriculas.length, v.celdas.some(c => /^(☀ CT día|☾ CT noche|CT todoturno)$/.test(c.texto))], [6, false]);
  contiene('… y «lo cubre el CT»', v.en(v.coche('5555EEE').fila, 3).texto, ['libra hoy · lo cubre el CT']);

  // El ejemplo para mirarlo.
  const carpeta = process.argv[2];
  if (carpeta) {
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(path.join(carpeta, 'ejemplo.xlsx'), h.buf);
    console.log('\nEjemplo en ' + path.join(carpeta, 'ejemplo.xlsx'));
  }

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
