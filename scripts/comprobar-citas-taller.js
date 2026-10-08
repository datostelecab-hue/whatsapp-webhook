// ============================================================
// LAS CITAS DEL TALLER — las reglas
// ============================================================
// Las del módulo de citas (db/187, 08/10/2026): cómo se lee el Excel del
// taller, qué matrículas no se citan y por qué, quién lleva el coche a la hora
// de la cita, el aviso por WhatsApp, los botones del conductor y las llamadas
// de Control.
//
//   node scripts/comprobar-citas-taller.js
//
// No toca la base ni Meta: el repositorio, WhatsApp y las llamadas se sustituyen.
const path = require('path');

// Lo que sale fuera se sustituye ANTES de cargar el servicio.
const enviados = [], llamadasCtrl = [];
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};
sustituir('services/whatsapp.js', {
  enviarPlantillaPosicional: async (tel, plantilla, valores, op) => { enviados.push({ tel, plantilla, valores, op }); return { ok: true, id: 'wamid.X' }; },
});
sustituir('services/repo/llamadas.js', { registrar: async d => { llamadasCtrl.push(d); return { id: '1' }; } });

const S = require('../modules/Vehiculos/citas.service');
const repo = require('../modules/Vehiculos/citas.repo');
const CC = require('../modules/Control/callcenter.service');
const P = require('./crear-plantillas-whatsapp.js');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
async function lanza(nombre, fn, trozo) {
  try { await fn(); igual(nombre + ' (tenía que fallar)', 'no falló', trozo); }
  catch (e) { igual(nombre, e.message.includes(trozo) ? trozo : e.message, trozo); }
}

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const dia = n => S.sumarDias(hoy, n);

(async () => {
  // ── El Excel, celda a celda ─────────────────────────────────────────────
  igual('Fecha de Excel (00:00 UTC)', S.fechaDe(new Date('2026-10-09T00:00:00Z')), '2026-10-09');
  igual('Fecha escrita dd/mm/aaaa', S.fechaDe('9/10/2026'), '2026-10-09');
  igual('Fecha escrita dd-mm-aa', S.fechaDe('09-10-26'), '2026-10-09');
  igual('Fecha ISO', S.fechaDe('2026-10-09'), '2026-10-09');
  igual('Fecha como número de serie', S.fechaDe(46304), '2026-10-09');
  await lanza('Una fecha que no existe', () => S.fechaDe('31/02/2026'), 'no existe');
  await lanza('Una fecha que no se entiende', () => S.fechaDe('mañana'), 'no se entiende la fecha');
  igual('Hora de Excel (1899-12-30T10:00Z)', S.horaDe(new Date('1899-12-30T10:00:00Z')), '10:00');
  igual('Hora con segundos que redondean', S.horaDe(new Date('1899-12-30T12:59:59Z')), '13:00');
  igual('Hora escrita 9:30', S.horaDe('9:30'), '09:30');
  igual('Hora escrita 10.15', S.horaDe('10.15'), '10:15');
  igual('Hora escrita 11h', S.horaDe('11h'), '11:00');
  igual('Hora como fracción del día', S.horaDe(0.5), '12:00');
  await lanza('Una hora que no se entiende', () => S.horaDe('por la mañana'), 'no se entiende la hora');

  // Un Excel como el del taller, con un título encima y una fila mala.
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['Citas de octubre']);
  ws.addRow(['MATRICULA', 'VEHICULO ', 'CITA TALLER', 'HORA']);
  ws.addRow(['5736 LGK', 'HYUNDAI', new Date('2026-10-09T00:00:00Z'), new Date('1899-12-30T10:00:00Z')]);
  ws.addRow([]);
  ws.addRow(['0802mjy', 'TOYOTA', '13/10/2026', '12:00']);
  const bien = await S.leerExcel(await wb.xlsx.writeBuffer());
  igual('Lee la hoja bajo el título', bien.filas.map(f => [f.fila, f.matricula, f.marca, f.fecha, f.hora]),
    [[3, '5736LGK', 'HYUNDAI', '2026-10-09', '10:00'], [5, '0802MJY', 'TOYOTA', '2026-10-13', '12:00']]);
  ws.addRow(['9528MMX', 'TOYOTA', 'el martes', '13:00']);
  ws.addRow(['1204MJY', 'TOYOTA', new Date('2026-10-13T00:00:00Z'), null]);
  const mal = await S.leerExcel(await wb.xlsx.writeBuffer());
  igual('Las filas malas, con su número', mal.errores, ['Fila 6 (9528MMX): no se entiende la fecha «el martes»', 'Fila 7 (1204MJY): falta la hora']);

  // ── Qué no se cita ──────────────────────────────────────────────────────
  igual('No está en el sistema', S.motivoIgnorada(undefined), 'No está en el sistema');
  igual('De Barcelona (el 1888LTJ)', S.motivoIgnorada({ sede: 'barcelona', de_baja: false }), 'No es de Madrid: es de Barcelona');
  igual('Dado de baja', S.motivoIgnorada({ sede: 'madrid', de_baja: true }), 'Está dado de baja en Vehículos');
  igual('De Madrid y vivo: se cita', S.motivoIgnorada({ sede: 'madrid', de_baja: false }), null);

  // ── El turno que tiene el coche a esa hora ──────────────────────────────
  igual('A las 10:00, el de día', S.turnoDeLaCita('2026-10-10', '10:00'), { dia: '2026-10-10', turno: 'dia' });
  igual('A las 17:00, el de noche', S.turnoDeLaCita('2026-10-10', '17:00'), { dia: '2026-10-10', turno: 'noche' });
  igual('A las 03:00, la noche de la víspera', S.turnoDeLaCita('2026-10-10', '03:00'), { dia: '2026-10-09', turno: 'noche' });
  igual('A las 05:00 ya es de día', S.turnoDeLaCita('2026-10-10', '05:00'), { dia: '2026-10-10', turno: 'dia' });

  // ── El mensaje: el mismo que la plantilla de Meta ───────────────────────
  igual('Fecha larga', S.fechaLarga('2026-10-09'), 'viernes 9 de octubre');
  const plantilla = P.PLANTILLAS.find(p => p.name === S.PLANTILLA);
  igual('La plantilla existe en el script de Meta', !!plantilla, true);
  igual('La plantilla cumple las reglas de Meta', P.revisar(plantilla), []);
  const d = { nombre: 'Andrés', matricula: '1194LCK', fecha: '2026-10-09', hora: '10:00' };
  const relleno = S.valoresAviso(d).reduce((t, v, i) => t.replace(`{{${i + 1}}}`, v), plantilla.body);
  igual('El mensaje para copiar es la plantilla rellena', S.textoAviso(d), relleno);
  igual('Sin nombre, «compañero»', S.valoresAviso({ ...d, nombre: '' })[0], 'compañero');
  igual('Los botones de la plantilla los entiende el webhook', plantilla.botones.map(S.botonDeCita), ['confirma', 'no_puede']);
  igual('El botón de los turnos no es de la cita', S.botonDeCita('Ver mis turnos'), null);

  // ── Importar: qué entra, qué cambia, qué se ignora ─────────────────────
  const guardado = [];
  repo.vehiculosPorMatricula = async mats => new Map([
    ['5736LGK', { id: '10', matricula: '5736LGK', sede: 'madrid', de_baja: false }],
    ['0802MJY', { id: '11', matricula: '0802MJY', sede: 'madrid', de_baja: false }],
    ['9528MMX', { id: '12', matricula: '9528MMX', sede: 'madrid', de_baja: false }],
    ['1888LTJ', { id: '13', matricula: '1888LTJ', sede: 'barcelona', de_baja: false }],
    ['7777BBB', { id: '14', matricula: '7777BBB', sede: 'madrid', de_baja: true }],
  ].filter(([m]) => mats.includes(m)));
  repo.entreFechas = async () => [
    { id: '100', vehiculo_id: '11', matricula: '0802MJY', fecha: dia(3), hora: '09:00', estado: 'pendiente', avisada: true, confirmacion: null },
    { id: '101', vehiculo_id: '12', matricula: '9528MMX', fecha: dia(3), hora: '13:00', estado: 'pendiente', avisada: false, confirmacion: null },
    { id: '102', vehiculo_id: '10', matricula: '5736LGK', fecha: dia(4), hora: '11:00', estado: 'pendiente', avisada: false, confirmacion: null },
  ];
  repo.guardarImportacion = async x => { guardado.push(x); return {}; };
  const xl = new ExcelJS.Workbook();
  const h = xl.addWorksheet('Hoja1');
  const f = n => new Date(dia(n) + 'T00:00:00Z');
  const hr = t => new Date('1899-12-30T' + t + ':00Z');
  h.addRow(['MATRICULA', 'VEHICULO', 'CITA TALLER', 'HORA']);
  h.addRow(['5736LGK', 'HYUNDAI', f(3), hr('10:00')]);    // nueva
  h.addRow(['0802MJY', 'TOYOTA', f(3), hr('12:00')]);     // cambia de hora y ya se avisó
  h.addRow(['9528MMX', 'TOYOTA', f(3), hr('13:00')]);     // igual
  h.addRow(['1888LTJ', 'TOYOTA', f(5), hr('09:00')]);     // de Barcelona
  h.addRow(['1888LTJ', 'TOYOTA', f(6), hr('09:00')]);
  h.addRow(['0000ZZZ', 'TOYOTA', f(5), hr('09:00')]);     // no está
  h.addRow(['7777BBB', 'TOYOTA', f(5), hr('09:00')]);     // de baja
  h.addRow(['5736LGK', 'HYUNDAI', f(-2), hr('10:00')]);   // ya pasó
  h.addRow(['9528MMX', 'TOYOTA', f(8), hr('10:00')]);     // nueva…
  h.addRow(['9528MMX', 'TOYOTA', f(8), hr('11:00')]);     // …dos veces: vale esta
  const base64 = Buffer.from(await xl.xlsx.writeBuffer()).toString('base64');
  const r = await S.importar({ base64, nombre: 'MOBILITY.xlsx' }, { usuarioId: 7 });
  igual('Nuevas', guardado[0].nuevas.map(c => [c.matricula, c.fecha, c.hora]), [['5736LGK', dia(3), '10:00'], ['9528MMX', dia(8), '11:00']]);
  igual('Cambia la hora y, como ya se avisó, se vuelve a avisar', guardado[0].cambios.map(c => [c.id, c.horaAntes, c.hora, c.reiniciar]), [['100', '09:00', '12:00', true]]);
  igual('Iguales', r.iguales, 1);
  igual('Ignoradas con su motivo', r.ignoradas, [
    { matricula: '0000ZZZ', motivo: 'No está en el sistema', citas: 1 },
    { matricula: '1888LTJ', motivo: 'No es de Madrid: es de Barcelona', citas: 2 },
    { matricula: '7777BBB', motivo: 'Está dado de baja en Vehículos', citas: 1 }]);
  igual('Las pasadas no entran', r.pasadas, 1);
  igual('La que había y no viene se lista, no se anula', r.noVienen, [`5736LGK · ${dia(4).split('-').reverse().join('/')} 11:00`]);
  igual('El duplicado se avisa', r.avisos.length, 1);
  igual('El fichero queda apuntado', guardado[0].fichero, 'MOBILITY.xlsx');

  // ── El responsable y el aviso ───────────────────────────────────────────
  const cita = { id: '5', vehiculo_id: '10', matricula: '5736LGK', fecha: dia(2), hora: '10:00', estado: 'pendiente',
    aviso_conductor_id: null, confirmacion: null };
  const cob = [
    { dia: dia(2), vehiculo_id: '10', turno: 'dia', rol: 'FIJO', conductor_id: '96', nombre: 'Pedro Pérez', nombre_ficha: 'Pedro', apellidos: 'Pérez', nombre_bolt: 'Pedro Pérez', telefono: '+34600111222' },
    { dia: dia(2), vehiculo_id: '10', turno: 'noche', rol: 'FIJO', conductor_id: '447', nombre: 'Luis Gómez', nombre_ficha: 'Luis', apellidos: 'Gómez', nombre_bolt: '', telefono: '+34600333444' },
  ];
  repo.cobertura = async () => cob;
  repo.una = async () => ({ ...cita });
  const avisos = [], intentos = [];
  repo.marcarAviso = async (id, x) => { avisos.push([id, x.via, x.conductorId, x.telefono, x.wamid]); };
  repo.marcarIntento = async (id, e) => { intentos.push([id, e]); };
  const a = await S.avisar('5', { usuarioId: 7 });
  igual('Avisa al de día', [a.ok, a.conductor], [true, 'Pedro Pérez']);
  igual('Con la plantilla, sus cuatro valores y el origen del taller',
    [enviados[0].plantilla, enviados[0].valores, enviados[0].op.origen],
    ['cita_taller', ['Pedro', '5736LGK', S.fechaLarga(dia(2)), '10:00'], 'taller']);
  igual('Queda apuntado a quién y con qué mensaje', avisos[0], ['5', 'whatsapp', 96, '+34600111222', 'wamid.X']);
  repo.cobertura = async () => cob.filter(x => x.turno === 'noche');
  const sin = await S.avisar('5', {});
  igual('Nadie de día: no se manda y se dice por qué', [sin.ok, intentos[0][1]], [false, 'Nadie lleva el coche en ese turno según el planificador']);
  repo.cobertura = async () => cob.map(x => ({ ...x, telefono: null }));
  const sinTel = await S.avisar('5', {});
  igual('Sin teléfono: tampoco', sinTel.error, 'Pedro Pérez no tiene teléfono en su ficha');
  repo.una = async () => ({ ...cita, estado: 'anulada' });
  await lanza('Una anulada no se avisa', () => S.avisar('5', {}), 'no se avisa');

  // ── Lo que contesta el conductor ────────────────────────────────────────
  const respuestas = [];
  repo.deRespuesta = async ({ telefono, wamid }) => (wamid === 'wamid.X' || telefono === '34600111222' ? 5 : null);
  repo.una = async () => ({ ...cita, aviso_conductor_id: '96' });
  repo.apuntarRespuesta = async (id, x) => { respuestas.push([id, x.tipo, x.confirmacion, x.via]); return { id: '1' }; };
  const si = await S.respuestaDelConductor({ telefono: '34600111222', etiqueta: 'Confirmo', wamid: 'wamid.X' });
  igual('«Confirmo» confirma la cita', respuestas[0], [5, 'respuesta', 'confirmada', 'whatsapp']);
  igual('Y se le contesta con el día y la hora', si.texto.includes(S.fechaLarga(dia(2))) && si.texto.includes('10:00'), true);
  await S.respuestaDelConductor({ telefono: '34600111222', etiqueta: 'No puedo ir' });
  igual('«No puedo ir» se apunta', respuestas[1][2], 'no_puede');
  igual('Otro botón no es de la cita', await S.respuestaDelConductor({ telefono: '34600111222', etiqueta: 'Ver mis turnos' }), null);
  igual('Sin cita para ese teléfono: sigue el bot', await S.respuestaDelConductor({ telefono: '34699999999', etiqueta: 'Confirmo' }), null);

  // ── Las llamadas de Control ─────────────────────────────────────────────
  repo.una = async () => ({ ...cita, confirmacion: 'confirmada' });
  await S.apuntarLlamada('5', { conductorId: '96', resultado: 'no_contesta' }, { usuarioId: 7 });
  igual('«No contesta» no pisa una confirmación', respuestas[2], ['5', 'llamada', null, 'llamada']);
  igual('La llamada entra en su historial, tipo Taller', [llamadasCtrl[0].tipo, llamadasCtrl[0].resultado, llamadasCtrl[0].matricula, llamadasCtrl[0].turno],
    ['taller', 'Cita de taller: no contesta', '5736LGK', 'dia']);
  repo.una = async () => ({ ...cita });
  await S.apuntarLlamada('5', { conductorId: '96', resultado: { valor: 'confirma' } }, {});
  igual('«Confirma la cita» confirma', respuestas[3][2], 'confirmada');
  await lanza('«No puede ir» pide el porqué', () => S.apuntarLlamada('5', { conductorId: '96', resultado: 'no_puede' }, {}), 'por qué no puede ir');
  await lanza('Sin a quién se llamó', () => S.apuntarLlamada('5', { resultado: 'confirma' }, {}), 'A quién has llamado');
  await lanza('Sin resultado', () => S.apuntarLlamada('5', { conductorId: '96' }, {}), 'Elige qué ha dicho');
  S.RESULTADOS_LLAMADA.forEach(x => igual(`El Call Center sabe dónde va «${x.caso}»`,
    CC.clasificarControl({ tipo: 'taller', resultado: x.caso }).motivo, 'Limpieza, ITV o revisión programada'));

  // ── Estados ─────────────────────────────────────────────────────────────
  repo.cambiarEstado = async () => {};
  await lanza('Anular pide motivo', () => S.cambiarEstado('5', { estado: 'anulada' }, {}), 'Di por qué');
  await lanza('Un estado que no existe', () => S.cambiarEstado('5', { estado: 'perdida' }, {}), 'Estado desconocido');
  igual('Hecha, sin nota', (await S.cambiarEstado('5', { estado: { valor: 'hecha' } }, {})).ok, true);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
