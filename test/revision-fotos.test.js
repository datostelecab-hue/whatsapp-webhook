// ============================================================
// REVISIÓN DE FOTOS EN EL TALLER (db/282, 24/11/2026)
// ============================================================
// «Un módulo en el ERP en taller, en el cual pueda comparar las dos últimos
// lotes de fotos de los conductores (…) para aprobar la revisión, una vez
// calificada, esperamos el próximo ciclo». Decidido en el chat: cada lote con
// el anterior del mismo coche; «Aprobada» o «Con daños»; los de daños no se
// borran a los 20 días.
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
  const filas = revision.parejas(lotes, [{ turno: '11', turno_anterior: '10', resultado: 'aprobada', fotos: [] }], { hoy: HOY, dias: 20 });
  assert.deepEqual(filas.map(f => [f.turno, f.estado, f.anterior ? f.anterior.turno : null]),
    [['20', 'pendiente', null], ['10', 'pendiente', null], ['12', 'pendiente', '11'], ['11', 'aprobada', '10']],
    'las pendientes de la más vieja a la más nueva; luego las calificadas');
  const c = filas.find(f => f.turno === '12');
  assert.equal(c.quienAnterior, 'Bea');
  assert.equal(c.borraEl, '2027-01-08', 'el lote de Bea (18/12) se va el 18/12 + 21');
  assert.equal(c.quedan, 19);
  assert.equal(filas.find(f => f.turno === '20').quedan, 2, 'el del 01/12 aún está el 21 (es «hoy − 20») y se va el 22');

  // Con daños, los dos lotes de la pareja se guardan: ya no caducan.
  const conDanos = revision.parejas(lotes, [{ turno: '12', turno_anterior: '11', resultado: 'danos', fotos: [2] }], { hoy: HOY, dias: 20 });
  const d = conDanos.find(f => f.turno === '12');
  assert.equal(d.quedan, null);
  assert.equal(conDanos.find(f => f.turno === '11').borraEl, '2027-01-08', 'la pareja 10-11 caduca por el 10, que no se guarda');
});

test('calificar: «con daños» pide nota y foto; sin eso no se guarda', () => {
  assert.throws(() => revision.validar({ resultado: 'otra' }), /Aprobada.*Con daños/);
  assert.throws(() => revision.validar({ resultado: 'danos', fotos: [1] }), /escribe qué daño/);
  assert.throws(() => revision.validar({ resultado: 'danos', nota: 'Rayón' }), /en qué foto/);
  assert.deepEqual(revision.validar({ resultado: 'danos', nota: ' Rayón ', fotos: ['3', 9, 3, '1'] }),
    { resultado: 'danos', nota: 'Rayón', fotos: [1, 3] });
  assert.deepEqual(revision.validar({ resultado: 'aprobada', fotos: [2] }).fotos, [], 'aprobada no lleva fotos con daño');
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

test('con la base: la ficha pone antes y después; calificar queda en el libro y pasa a la siguiente', () => conBase(async ({ consulta, fabrica }) => {
  const { t } = await montar({ consulta, fabrica });
  const u = await fabrica.usuario({ rol: 'taller', nombre: 'Taller' });

  const f = await revision.ficha(t.Hace20);
  assert.equal(f.anterior.turno, t.Hace21);
  assert.deepEqual(f.fotos.map(x => x.etiqueta), ['Lateral conductor', 'Frontal', 'Lateral copiloto', 'Parte trasera', 'Asientos pasajeros']);
  assert.ok(f.fotos.every(x => /^\/adjuntos\/\d+\/fichero$/.test(x.antes) && /^\/adjuntos\/\d+\/fichero$/.test(x.despues)));
  assert.equal(f.siguiente.turno, t.DeHoy, 'la siguiente pendiente del mismo coche');

  await revision.calificar(t.Hace20, { resultado: 'danos', nota: 'Rayón en la puerta', fotos: [3] }, { usuarioId: u.id });
  const g = (await consulta(`SELECT resultado, nota, fotos, turno_anterior_id::text AS ant, revisado_por FROM taller_revision_fotos WHERE turno_id = $1`, [t.Hace20])).rows[0];
  assert.deepEqual([g.resultado, g.nota, g.fotos, g.ant, g.revisado_por], ['danos', 'Rayón en la puerta', [3], t.Hace21, u.id]);
  // El alta queda en el libro con quién y desde dónde (la fila entera lleva la nota).
  const libro = (await consulta(`SELECT accion, origen, usuario_id FROM auditoria WHERE tabla = 'taller_revision_fotos' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.deepEqual([libro.accion, libro.origen, Number(libro.usuario_id)], ['alta', 'revision-fotos', u.id]);

  // Se puede cambiar, y el libro guarda el cambio.
  await revision.calificar(t.Hace20, { resultado: 'aprobada' }, { usuarioId: u.id });
  const h = (await consulta(`SELECT resultado, fotos FROM taller_revision_fotos WHERE turno_id = $1`, [t.Hace20])).rows[0];
  assert.deepEqual([h.resultado, h.fotos], ['aprobada', []]);
  const cambio = (await consulta(`SELECT accion, motivo FROM auditoria WHERE tabla = 'taller_revision_fotos' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.match(cambio.motivo, /aprobada \(antes, con daños\)/);

  const { filas } = await revision.lista();
  assert.deepEqual(filas.filter(x => x.estado === 'pendiente').map(x => x.turno), [t.Hace21, t.DeHoy]);
}));

test('la purga de los 20 días se salta los dos lotes de una pareja con daños', () => conBase(async ({ consulta, fabrica }) => {
  const { t } = await montar({ consulta, fabrica });
  const u = await fabrica.usuario({ rol: 'taller', nombre: 'Taller' });
  await revision.calificar(t.Hace20, { resultado: 'danos', nota: 'Golpe en el frontal', fotos: [2] }, { usuarioId: u.id });
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
