// ============================================================
// LOS COMUNICADOS A LA PLANTILLA (módulos 6 y 9, db/305, 26/11/2026)
// ============================================================
// Lo prepara una persona y lo aprueba otra; al aprobarse va a la plantilla de
// alta de su alcance, por correo; cada uno lo lee en el portal y pulsa «Lo he
// leído»; a quien no, un recordatorio cada 2 días hábiles, 3 como mucho.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const correo = require('../services/correo');
const calendario = require('../services/calendario');
const com = require('../modules/RRHH/comunicados.service');

const conLlaves = async (consulta, fabrica, nombre, claves) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre });
  for (const k of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, k]);
  return { usuarioId: u.id, rol: 'oficina' };
};

test('preparar, aprobar otra persona, el correo y el «Lo he leído» del portal', () => conBase(async ({ consulta, fabrica }) => {
  const enviados = [];
  const real = correo.enviarCorreo;
  correo.enviarCorreo = async m => { enviados.push(m); return { enviado: true }; };
  try {
    const D = await conLlaves(consulta, fabrica, 'Diana', ['/comunicados', '/comunicados/preparar']);
    const I = await conLlaves(consulta, fabrica, 'Ignacio', ['/comunicados', '/comunicados/aprobar']);
    const propio = await fabrica.conductor({ nombre: 'PROPIO' });
    const ett = await fabrica.conductor({ nombre: 'DEETT', tipo: 'ett' });
    const sinCorreo = await fabrica.conductor({ nombre: 'SINCORREO' });
    await consulta(`UPDATE conductor SET email = 'propio@prueba.invalid' WHERE id = $1`, [propio.id]);
    await consulta(`UPDATE conductor SET email = 'ett@prueba.invalid' WHERE id = $1`, [ett.id]);
    await consulta(`UPDATE conductor SET email = NULL WHERE id = $1`, [sinCorreo.id]);

    // Prepararlo es de su llave; quien aprueba no prepara.
    await assert.rejects(com.crear({ titulo: 'X', cuerpo: 'Texto largo de prueba', alcance: 'propia' }, I), e => e.status === 403);
    await assert.rejects(com.crear({ titulo: 'X', cuerpo: 'corto', alcance: 'propia' }, D), /texto/);
    const { id } = await com.crear({ titulo: 'Nuevos códigos de descuento', cuerpo: 'Desde el lunes, los códigos son otros.', alcance: 'propia' }, D);

    // No sale sin pedirlo, ni lo aprueba quien lo preparó.
    await assert.rejects(com.aprobar(id, I), /por aprobar/);
    await com.pedir(id, D);
    assert.equal((await consulta(`SELECT count(*)::int AS n FROM tarea WHERE tipo = 'comunicado_aprobar' AND origen_id = $1 AND estado <> 'cerrada'`, [id])).rows[0].n, 1);
    const yo = await conLlaves(consulta, fabrica, 'Las dos', ['/comunicados', '/comunicados/preparar', '/comunicados/aprobar']);
    const { id: suyo } = await com.crear({ titulo: 'Mío', cuerpo: 'Lo preparo y lo apruebo yo.', alcance: 'todos' }, yo);
    await com.pedir(suyo, yo);
    await assert.rejects(com.aprobar(suyo, yo), /otra persona/);

    const r = await com.aprobar(id, I, { esperar: true });
    assert.equal(r.estado, 'enviado');
    const f = await com.ficha(id, D);
    const ids = f.personas.map(p => p.conductor_id);
    assert.ok(ids.includes(String(propio.id)) && ids.includes(String(sinCorreo.id)), 'la plantilla propia de alta');
    assert.ok(!ids.includes(String(ett.id)), 'la ETT no, con alcance «propia»');
    assert.equal(enviados.filter(m => m.to === 'propio@prueba.invalid').length, 1, 'su correo, con el enlace al portal');
    assert.match(enviados.find(m => m.to === 'propio@prueba.invalid').text, /\/comunicados\/\d+/);
    assert.equal(f.leidos, 0);

    // En el portal: sale, se abre (visto) y «Lo he leído» (una vez).
    const persona = { id: String(propio.id) };
    assert.equal((await com.delConductor(persona)).filter(c => !c.leido).length, 1);
    assert.equal(await com.abrirEnPortal({ id: String(ett.id) }, id), null, 'a quien no le llegó, no existe');
    await com.abrirEnPortal(persona, id);
    const leido = await com.acusar(persona, id, { ip: '10.0.0.1', agente: 'prueba' });
    assert.equal(leido.leido, true);
    const d = (await consulta(`SELECT leido_ip, visto_at IS NOT NULL AS visto FROM comunicado_destinatario WHERE comunicado_id = $1 AND conductor_id = $2`, [id, propio.id])).rows[0];
    assert.deepEqual([d.leido_ip, d.visto], ['10.0.0.1', true]);
    assert.equal((await com.ficha(id, D)).leidos, 1, 'la oficina lo ve leído');

    // Los recordatorios: a los 2 días hábiles, solo a quien no lo ha leído y tiene correo.
    const otro = await fabrica.conductor({ nombre: 'OLVIDON' });
    await consulta(`UPDATE conductor SET email = 'olvidon@prueba.invalid' WHERE id = $1`, [otro.id]);
    const { id: id2 } = await com.crear({ titulo: 'Normativa', cuerpo: 'La normativa interna nueva.', alcance: 'personas', personas: [otro.id, propio.id] }, D);
    await com.pedir(id2, D);
    await com.aprobar(id2, I, { esperar: true });
    await com.acusar(persona, id2, {});
    const cal = await calendario.de('madrid');
    const hoy = calendario.hoy();
    const habil = n => { let x = hoy; for (let i = 0; i < n;) { x = calendario.sumarDias(x, 1); if (cal.esHabil(x)) i++; } return x; };
    enviados.length = 0;
    assert.equal((await com.recordar({ hoy: habil(1) })).recordatorios, 0, 'aún no');
    assert.equal((await com.recordar({ hoy: habil(2) })).recordatorios, 1);
    assert.deepEqual(enviados.map(m => m.to), ['olvidon@prueba.invalid']);
    assert.match(enviados[0].subject, /Recordatorio/);
    await consulta(`UPDATE comunicado_destinatario SET recordatorios = 3 WHERE comunicado_id = $1`, [id2]);
    assert.equal((await com.recordar({ hoy: habil(8) })).recordatorios, 0, 'tres como mucho');
  } finally {
    correo.enviarCorreo = real;
  }
}));
