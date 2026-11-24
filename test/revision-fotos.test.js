// ============================================================
// REVISIÓN DE FOTOS EN EL TALLER (db/282-283, 24/11/2026)
// ============================================================
// «Un módulo en el ERP en taller, en el cual pueda comparar las dos últimos
// lotes de fotos de los conductores (…)». Decidido en el chat: cada lote con
// el anterior del mismo coche. Y luego, «tipo tinder»: «es comparación por
// comparación, dos, dos, dos, dos y dos, cada una con aprobar / con daños /
// Imagen no válida». Las de daños y las no válidas no se borran a los 20 días.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const almacen = require('../services/almacen');
const revision = require('../modules/Vehiculos/revisionFotos.service');
const fotos = require('../modules/Portal/portal.fotos');

const HOY = '2026-12-20';
const a = (dia, hora = '11:00') => `${dia}T${hora}:00Z`;

test('las parejas: cada lote con el anterior de su coche, las pendientes primero y cuándo se borran', () => {
  const L = (turno, coche, dia, hora, quien) => ({ turno, vehiculo_id: coche, matricula: coche === '1' ? '1111AAA' : '2222BBB',
    quien, tipo: 'turno', dia, desde: '', hasta: '', n_fotos: 5, hecho_at: a(dia, hora) });
  const lotes = [L('10', '1', '2026-12-18', '08:00', 'Ana'), L('11', '1', '2026-12-18', '20:00', 'Bea'),
    L('12', '1', '2026-12-19', '08:00', 'Carlos'), L('20', '2', '2026-12-01', '09:00', 'Dani')];
  const filas = revision.parejas(lotes, [{ turno: '11', turno_anterior: '10', resultado: 'aprobada' }],
    { hoy: HOY, dias: 20, veredictos: [{ turno: '12', n: 1, resultado: 'aprobada' }, { turno: '12', n: 2, resultado: 'no_valida', nota: 'Borrosa' }] });
  assert.deepEqual(filas.map(f => [f.turno, f.estado, f.anterior ? f.anterior.turno : null]),
    [['20', 'pendiente', null], ['10', 'pendiente', null], ['12', 'pendiente', '11'], ['11', 'aprobada', '10']],
    'las pendientes de la más vieja a la más nueva; luego las calificadas');
  const c = filas.find(f => f.turno === '12');
  assert.deepEqual([c.quienAnterior, c.hechas, c.nNoValidas, c.veredictos[2].nota], ['Bea', 2, 1, 'Borrosa'], 'en curso: 2 de 5');
  assert.equal(c.borraEl, '2027-01-08', 'el lote de Bea (18/12) se va el 18/12 + 21');
  assert.equal(c.quedan, 19);
  assert.equal(filas.find(f => f.turno === '20').quedan, 2, 'el del 01/12 aún está el 21 (es «hoy − 20») y se va el 22');

  // Con daños, los dos lotes de la pareja se guardan; con una no válida, el nuevo.
  const conDanos = revision.parejas(lotes, [{ turno: '12', turno_anterior: '11', resultado: 'danos' }], { hoy: HOY, dias: 20 });
  assert.equal(conDanos.find(f => f.turno === '12').quedan, null);
  assert.equal(conDanos.find(f => f.turno === '11').borraEl, '2027-01-08', 'la pareja 10-11 caduca por el 10, que no se guarda');
  const noValida = revision.parejas(lotes, [{ turno: '11', turno_anterior: '10', resultado: 'no_valida' }], { hoy: HOY, dias: 20 });
  assert.equal(noValida.find(f => f.turno === '11').borraEl, '2027-01-08', 'el nuevo (11) se guarda; el de antes (10), no');
  assert.equal(noValida.find(f => f.turno === '12').borraEl, '2027-01-09', 'la pareja 11-12 caduca por el 12');
});

test('cada foto: aprobada, con daños (qué se ve, obligatorio) o imagen no válida (motivo opcional); la pareja, de las cinco', () => {
  assert.throws(() => revision.validarFoto({ n: 6, resultado: 'aprobada' }), /no existe/);
  assert.throws(() => revision.validarFoto({ n: 1, resultado: 'otra' }), /Aprobada.*Con daños.*Imagen no válida/);
  assert.throws(() => revision.validarFoto({ n: 1, resultado: 'danos', nota: '  ' }), /escribe qué daño/);
  assert.deepEqual(revision.validarFoto({ n: '2', resultado: 'no_valida' }), { n: 2, resultado: 'no_valida', nota: '' });
  assert.deepEqual(revision.validarFoto({ n: 3, resultado: 'aprobada', nota: 'algo' }).nota, '', 'aprobada no lleva nota');
  assert.equal(revision.resultadoDe(['aprobada', 'no_valida', 'danos', 'aprobada', 'aprobada']), 'danos');
  assert.equal(revision.resultadoDe(['aprobada', 'no_valida', 'aprobada', 'aprobada', 'aprobada']), 'no_valida');
  assert.equal(revision.resultadoDe(['aprobada', 'aprobada', 'aprobada', 'aprobada', 'aprobada']), 'aprobada');
});

async function montar({ consulta, fabrica }) {
  const v = await fabrica.vehiculo({ matricula: '1234PRB' });
  const turno = async (dia, nombre) => (await consulta(
    `INSERT INTO fichaje_turno (referencia, telefono, nombre, matricula, vehiculo_id, inicio, fin, estado, tipo)
     VALUES ($1, '600000000', $2, '1234PRB', $3, $4::timestamptz - interval '8 hours', $4::timestamptz, 'cerrado', 'turno')
     RETURNING id`, [`prueba-${dia}-${nombre}`, nombre, v.id, a(dia)])).rows[0].id;
  const foto = (turnoId, dia, n) => consulta(
    `INSERT INTO adjunto (dueno_tipo, dueno_id, almacen, ruta, nombre, mime, bytes, sha256, creado_at)
     VALUES ('turno_fotos', $1, 'disco', $2, $3, 'image/jpeg', 1000, repeat('a', 64), $4)`,
    [String(turnoId), `pruebas/fotos/${turnoId}-${n}`, `${n}-foto.jpg`, a(dia)]);
  const t = {};
  for (const [dia, nombre] of [['2026-11-29', 'Hace21'], ['2026-11-30', 'Hace20'], [HOY, 'DeHoy']]) {
    t[nombre] = String(await turno(dia, nombre));
    for (let n = 1; n <= 5; n++) await foto(t[nombre], dia, n);
  }
  return { v, t };
}

/** Juzga las cinco fotos de un lote: `res` es la lista de los cinco resultados. */
async function juzgarCinco(turno, res, usuarioId) {
  let ultima;
  for (let n = 1; n <= 5; n++) {
    ultima = await revision.calificarFoto(turno, { n, resultado: res[n - 1], nota: res[n - 1] === 'danos' ? 'Rayón en la puerta' : '' }, { usuarioId });
  }
  return ultima;
}

test('con la base: foto a foto; la quinta cierra la pareja, queda en el libro y se puede cambiar', () => conBase(async ({ consulta, fabrica }) => {
  const { t } = await montar({ consulta, fabrica });
  const u = await fabrica.usuario({ rol: 'taller', nombre: 'Taller' });

  const f = await revision.ficha(t.Hace20);
  assert.equal(f.anterior.turno, t.Hace21);
  assert.deepEqual(f.fotos.map(x => x.etiqueta), ['Lateral conductor', 'Frontal', 'Lateral copiloto', 'Parte trasera', 'Asientos pasajeros']);
  assert.ok(f.fotos.every(x => /^\/adjuntos\/\d+\/fichero$/.test(x.antes) && /^\/adjuntos\/\d+\/fichero$/.test(x.despues) && !x.veredicto));
  assert.equal(f.siguiente.turno, t.DeHoy, 'la siguiente pendiente del mismo coche');

  // Las cuatro primeras: la pareja sigue pendiente, «en curso».
  const r1 = await revision.calificarFoto(t.Hace20, { n: 1, resultado: 'aprobada' }, { usuarioId: u.id });
  assert.deepEqual([r1.hechas, r1.cerrada], [1, null]);
  const r5 = await juzgarCinco(t.Hace20, ['aprobada', 'no_valida', 'danos', 'aprobada', 'aprobada'], u.id);
  assert.deepEqual(r5.cerrada, { resultado: 'danos', etiqueta: 'Con daños' });
  const g = (await consulta(`SELECT resultado, fotos, turno_anterior_id::text AS ant, revisado_por FROM taller_revision_fotos WHERE turno_id = $1`, [t.Hace20])).rows[0];
  assert.deepEqual([g.resultado, g.fotos, g.ant, g.revisado_por], ['danos', [3], t.Hace21, u.id]);
  const porFoto = (await consulta(`SELECT n, resultado, nota FROM taller_revision_foto WHERE turno_id = $1 ORDER BY n`, [t.Hace20])).rows;
  assert.deepEqual(porFoto.map(x => x.resultado), ['aprobada', 'no_valida', 'danos', 'aprobada', 'aprobada']);
  assert.equal(porFoto[2].nota, 'Rayón en la puerta');

  // Cambiar el daño a aprobada: la pareja se recalcula (queda la no válida) y el libro lo cuenta.
  const r = await revision.calificarFoto(t.Hace20, { n: 3, resultado: 'aprobada' }, { usuarioId: u.id });
  assert.deepEqual(r.cerrada, { resultado: 'no_valida', etiqueta: 'Imagen no válida' });
  const cambio = (await consulta(
    `SELECT accion, motivo FROM auditoria WHERE tabla = 'taller_revision_foto' AND accion <> 'alta' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.match(cambio.motivo, /1234PRB · Lateral copiloto: aprobada/);

  const { filas } = await revision.lista();
  assert.deepEqual(filas.filter(x => x.estado === 'pendiente').map(x => x.turno), [t.Hace21, t.DeHoy]);
  const hecha = filas.find(x => x.turno === t.Hace20);
  assert.deepEqual([hecha.estado, hecha.hechas, hecha.nDanos, hecha.nNoValidas], ['no_valida', 5, 0, 1]);
}));

test('la purga de los 20 días se salta los dos lotes de una pareja con daños', () => conBase(async ({ consulta, fabrica }) => {
  const { t } = await montar({ consulta, fabrica });
  const u = await fabrica.usuario({ rol: 'taller', nombre: 'Taller' });
  await juzgarCinco(t.Hace20, ['aprobada', 'danos', 'aprobada', 'aprobada', 'aprobada'], u.id);
  const real = almacen.de;
  const borradas = [];
  almacen.de = nombre => ({ ...real(nombre), borrar: async ruta => { borradas.push(ruta); } });
  try {
    const r = await fotos.purgar({ query: (s, p) => consulta(s, p) }, { hoy: HOY });
    assert.equal(r.borradas, 0, 'el de hace 21 días es el «antes» de una pareja con daños: se queda');
  } finally { almacen.de = real; }
  assert.equal(borradas.length, 0);
  const quedan = (await consulta(`SELECT count(*)::int n FROM adjunto WHERE dueno_tipo = 'turno_fotos' AND dueno_id = $1`, [t.Hace21])).rows[0].n;
  assert.equal(quedan, 5);
}));
