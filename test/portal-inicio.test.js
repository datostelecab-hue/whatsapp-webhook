// ============================================================
// PORTAL — EL INICIO, UN RESUMEN QUE LLEVA A CADA SITIO (23-24/11/2026)
// ============================================================
// «Que el inicio sea un resumen de lo que hay, al darle tap o click a la
// pantalla sí lo lleve allí». Lo que quedó de la revisión: si el coche no se
// puede leer, la portada sale igual; con coche vinculado, su tarjeta va la
// primera; si pulsó «Entregar coche», lo dice; y «vinculado desde» se dice
// igual en el inicio y en Coche («las 06:02» hoy, «el 22/11 a las 23:40» otro día).
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const portal = require('../modules/Portal/portal.service');
const coche = require('../modules/Portal/portal.coche');
const f = require('../modules/Portal/formato');

const VISTAS = path.join(__dirname, '..', 'modules', 'Portal', 'vistas');
const pintar = datos => ejs.renderFile(path.join(VISTAS, 'portalInicio.ejs'),
  { f, conductor: { nombre: 'Prueba', pila: 'Prueba' }, pagina: 'portalInicio', ...datos }, { views: [VISTAS] });
// El orden de las tarjetas: los id de sus títulos, como salen en la página.
const orden = html => [...html.matchAll(/aria-labelledby="(t-[a-z]+)"/g)].map(m => m[1]);

test('si el coche no se puede leer, la portada sale igual, sin su tarjeta', () => conBase(async ({ fabrica }) => {
  const c = await fabrica.conductor({ alta: '2026-01-01' });
  const real = coche.estado;
  coche.estado = async () => { throw new Error('Mapon no contesta'); };
  try {
    const datos = await portal.inicio({ id: c.id, telefono: '612345678' });
    assert.equal(datos.coche, null);
    const html = await pintar(datos);
    assert.ok(!orden(html).includes('t-coche'), 'sin la tarjeta del coche');
    assert.ok(orden(html).includes('t-proximo') && orden(html).includes('t-nota'), 'y lo demás sí');
  } finally { coche.estado = real; }
}));

test('con coche vinculado, su tarjeta va la primera; sin él, después del próximo turno', async () => {
  const base = { hoy: '2026-11-24', hasta: '2026-12-01', proximo: null, hayPlan: false, evento: null, ultima: null, anterior: null,
    dinero: null, efectivo: null };
  const vinculado = await pintar({ ...base, coche: { puede: true, vinculado: true, matricula: '1234ABC', desde: 'desde las 06:02', entregando: null } });
  assert.deepEqual(orden(vinculado).slice(0, 2), ['t-coche', 't-proximo']);
  assert.match(vinculado, /Vinculado desde las 06:02/);
  const sin = await pintar({ ...base, coche: { puede: true, vinculado: false } });
  assert.deepEqual(orden(sin).slice(0, 2), ['t-proximo', 't-coche']);
  // Si ya pulsó «Entregar coche», el resumen lo dice.
  const entregando = await pintar({ ...base, coche: { puede: true, vinculado: true, matricula: '1234ABC',
    desde: 'desde las 06:02', entregando: 'a las 13:40' } });
  assert.match(entregando, /Pulsaste «Entregar coche» a las 13:40\. Sigue a tu nombre hasta que tu compañero lo vincule\./);
});

test('«vinculado desde»: de hoy, solo la hora; de otro día, el día y la hora (hora de Madrid)', () => {
  const ahora = new Date('2026-11-24T10:00:00Z');                       // 11:00 en Madrid
  const hoy = coche._momento(Date.parse('2026-11-24T05:02:00Z') / 1000, ahora);
  assert.deepEqual(hoy, { hoy: true, hora: '06:02', dia: '24/11' });
  const ayer = coche._momento(Date.parse('2026-11-23T22:40:00Z') / 1000, ahora);   // 23:40 del 23 en Madrid
  assert.deepEqual(ayer, { hoy: false, hora: '23:40', dia: '23/11' });
});
