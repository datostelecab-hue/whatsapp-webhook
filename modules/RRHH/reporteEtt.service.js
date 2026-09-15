// ============================================================
// REPORTE DE HORAS DE LA ETT — lo que se le manda a la empresa de trabajo temporal
// ============================================================
// Las horas de AYER de los conductores que vienen por ETT. Sale por correo con
// su Excel adjunto, así que es de lo poco que escribe este sistema y lee alguien
// de fuera: lo que diga aquí es lo que se factura.
//
// ── DE DÓNDE SALEN AHORA LAS HORAS (15/09/2026) ─────────────────────────────
// Salían de la hoja `Datos_API`, que un cron rellenaba desde BOLT. Esa hoja se
// cortó, y con motivo: los crons que la llenaban llevaban apagados desde el
// 03/09, así que el reporte habría salido con CEROS para todo el mundo y con la
// misma cara de siempre.
//
// Ahora las pide a la Bitácora (`horasDeJornada`), que es quien las sella. Eso
// tiene dos consecuencias que conviene saber:
//
//   1. LA JORNADA ES 05→05, no el día natural. Un turno de noche que empieza el
//      lunes a las 21:00 y acaba el martes a las 05:00 cuenta ENTERO en el
//      lunes. En la hoja se partía por medianoche y esas horas aparecían en dos
//      días distintos. Es la misma jornada con la que cuadran la Bitácora, el
//      reporte de Control y Visibilidad: ahora los cuatro dicen lo mismo.
//
//   2. LO SELLADO NO SE MUEVE. Si un día ya se cerró, se leen sus horas tal como
//      quedaron, no se recalculan. Enlazar hoy una cuenta de BOLT no cambia lo
//      que se le facturó a la ETT la semana pasada.
//
// ── Y LA PERSONA SE IDENTIFICA POR SU CONTRATO ──────────────────────────────
// "De la ETT" no es una etiqueta escrita a mano: es tener un periodo de empleo
// de tipo `ett` vigente ESE DÍA. Quien pasó a plantilla propia ayer sigue
// saliendo en el reporte de anteayer, que es cuando trabajó para ellos.

const ExcelJS = require('exceljs');
const repo = require('./reporteEtt.repo');
const bitacora = require('../Operaciones/bitacora.service');

const TZ = 'Europe/Madrid';
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Ayer en Madrid: { iso, txt, diaSemana }. */
function ayer() {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const [Y, M, D] = hoy.split('-').map(Number);
  const a = new Date(Date.UTC(Y, M - 1, D - 1, 12));
  const p = n => String(n).padStart(2, '0');
  return {
    iso: `${a.getUTCFullYear()}-${p(a.getUTCMonth() + 1)}-${p(a.getUTCDate())}`,
    txt: `${p(a.getUTCDate())}/${p(a.getUTCMonth() + 1)}/${a.getUTCFullYear()}`,
    diaSemana: DIAS[(a.getUTCDay() + 6) % 7],
  };
}

/** El reporte de una jornada. Por omisión, la de ayer. */
async function reporte(diaIso) {
  const dia = diaIso ? { iso: diaIso, txt: diaIso.split('-').reverse().join('/'),
                         diaSemana: DIAS[(new Date(diaIso + 'T12:00:00Z').getUTCDay() + 6) % 7] }
                     : ayer();

  const [gente, horas] = await Promise.all([
    repo.ettDelDia(dia.iso),
    bitacora.horasDeJornada(dia.iso),
  ]);

  const filas = gente.map(p => {
    const seg = horas.get(p.conductorId) || 0;
    return {
      nombre: p.nombreBolt || p.nombre,
      turno: p.turno,
      contrato: p.ett || 'ETT',
      dni: p.dni,
      naf: p.naf,
      matricula: p.matricula,
      libra: p.libra,
      situacion: p.situacion,
      horas: Math.round((seg / 3600) * 10) / 10,
      telefono: p.telefono,
    };
  }).sort((a, b) => b.horas - a.horas || a.nombre.localeCompare(b.nombre, 'es'));

  const totalHoras = Math.round(filas.reduce((s, f) => s + f.horas, 0) * 10) / 10;

  // "Disponible" ya no depende de que una hoja esté al día: la base siempre
  // tiene la jornada de ayer. Lo que sí puede pasar es que no haya NADIE de ETT
  // de alta, y eso se dice en vez de mandar un Excel vacío.
  return {
    fecha: dia.txt, dia: dia.iso, diaSemana: dia.diaSemana,
    disponible: filas.length > 0,
    filas, totalHoras,
    conHoras: filas.filter(f => f.horas > 0).length,
  };
}

/** El Excel que se adjunta al correo. */
async function excel(rep) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Horas ETT');

  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `Horas ETT — ${rep.diaSemana} ${rep.fecha}`;
  ws.getCell('A1').font = { bold: true, size: 13 };

  // La jornada, escrita en el propio fichero. Quien lo reciba tiene que poder
  // saber por qué un turno de noche cuenta entero en el día que empezó, sin
  // preguntarle a nadie.
  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = 'Jornada operativa de 05:00 a 05:00: el turno de noche cuenta entero en el día en que empieza.';
  ws.getCell('A2').font = { size: 9, italic: true, color: { argb: 'FF666666' } };

  const cab = ['Conductor (BOLT)', 'Turno', 'ETT', 'DNI/NIE', 'NAF', 'Matrícula', 'Horas', 'Teléfono'];
  ws.getRow(4).values = cab;
  ws.getRow(4).font = { bold: true };
  ws.columns = [{ width: 32 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 16 },
                { width: 12 }, { width: 10 }, { width: 16 }];

  rep.filas.forEach(f => {
    ws.addRow([
      f.nombre, f.turno, f.contrato, f.dni, f.naf,
      // Un cero se explica solo si se dice por qué: libraba, o estaba de baja.
      f.matricula || (f.libra ? 'Libra' : (f.situacion || '')),
      f.horas, f.telefono,
    ]);
  });

  ws.addRow([]);
  const total = ws.addRow(['', '', '', '', '', 'TOTAL', rep.totalHoras, '']);
  total.font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { reporte, excel };
