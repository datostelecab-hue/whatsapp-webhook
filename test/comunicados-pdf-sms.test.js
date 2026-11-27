// ============================================================
// LOS COMUNICADOS CON PDF, EL SMS A QUIEN NO LOS LEE Y LA LÍNEA DE TIEMPO (db/310, 27/11/2026)
// ============================================================
// Un comunicado puede llevar un PDF, que solo se abre en el portal (queda cuándo
// lo abrió cada uno). A quien no lo ha leído, Diana le prepara un SMS
// certificado con ese PDF. Y en el expediente, todo lo que se le ha comunicado
// a una persona, por fechas.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const correo = require('../services/correo');
const adjuntos = require('../services/adjuntos');
const com = require('../modules/RRHH/comunicados.service');
const sms = require('../modules/RRHH/sms.service');
const expediente = require('../modules/Conductores/expediente.service');

const conLlaves = async (consulta, fabrica, nombre, claves) => {
  const u = await fabrica.usuario({ rol: 'oficina', nombre });
  for (const k of claves) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, k]);
  return { usuarioId: u.id, rol: 'oficina' };
};
const PDF = Buffer.from('%PDF-1.4\n% de prueba\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

test('el PDF del comunicado: en el portal solo a quien se le mandó, y el SMS certificado a quien falta', () => conBase(async ({ consulta, fabrica }) => {
  const enviados = [];
  const real = correo.enviarCorreo;
  correo.enviarCorreo = async m => { enviados.push(m); return { enviado: true }; };
  try {
    const D = await conLlaves(consulta, fabrica, 'Diana', ['/comunicados', '/comunicados/preparar', '/sms', '/sms/enviar']);
    const I = await conLlaves(consulta, fabrica, 'Ignacio', ['/comunicados', '/comunicados/aprobar']);
    const lee = await fabrica.conductor({ nombre: 'LEE' });
    const noLee = await fabrica.conductor({ nombre: 'NOLEE' });
    const otro = await fabrica.conductor({ nombre: 'OTRO', tipo: 'ett' });
    await consulta(`UPDATE conductor SET email = 'lee@prueba.invalid' WHERE id = $1`, [lee.id]);

    const { id } = await com.crear({ titulo: 'Nueva norma de limpieza', cuerpo: 'Desde el lunes, la norma del documento.', alcance: 'propia' }, D);
    const subido = await adjuntos.subirDelSistema({ tipo: com.DUENO_PDF, duenoId: String(id), nombre: 'norma.pdf', mime: 'application/pdf',
      cuerpo: Readable.from(PDF), firmante: null, creadoPor: D.usuarioId, origen: 'prueba' });
    await com.pedir(id, D);
    // Ya no es borrador: el documento no se cambia.
    await assert.rejects(adjuntos.exigirAdjuntar(com.DUENO_PDF, String(id), { id: D.usuarioId, rol: 'oficina' }), /borrador/);
    await com.aprobar(id, I, { esperar: true });
    assert.match(enviados.find(m => m.to === 'lee@prueba.invalid').text, /Lleva un documento/, 'el correo avisa; el PDF no va adjunto');
    assert.ok(!enviados.some(m => m.attachments), 'ni un adjunto en los correos');

    // En el portal: lo ve quien lo recibió, y queda cuándo lo abrió.
    const c = await com.abrirEnPortal({ id: String(lee.id) }, id);
    assert.deepEqual(c.documentos.map(x => x.nombre), ['norma.pdf']);
    assert.equal(await com.documentoEnPortal({ id: String(otro.id) }, id, subido.id), null, 'a quien no se le mandó, no existe');
    assert.equal(await com.documentoEnPortal({ id: String(lee.id) }, id, '999999'), null, 'otro adjunto, no');
    const a = await com.documentoEnPortal({ id: String(lee.id) }, id, subido.id);
    assert.ok(a.buffer.equals(PDF));
    const f = await com.ficha(id, D);
    assert.ok(f.personas.find(p => p.conductor_id === String(lee.id)).pdf, 'la oficina ve que abrió el PDF');
    assert.equal(f.puedeSms, true);
    await com.acusar({ id: String(lee.id) }, id, { ip: '10.0.0.1', agente: 'prueba' });

    // El SMS certificado a quien falta: solo a los que no lo han leído, con el PDF.
    const s = await sms.borradorDesde({ origen: 'comunicado', origenId: id }, D);
    const e = (await consulta(`SELECT origen, origen_id, plantilla, personas::text[] AS personas, mensaje FROM sms_envio WHERE id = $1`, [s.id])).rows[0];
    assert.deepEqual([e.origen, e.origen_id, e.plantilla], ['comunicado', String(id), 'comunicado']);
    assert.ok(e.personas.includes(String(noLee.id)) && !e.personas.includes(String(lee.id)), 'solo a quien no lo ha leído');
    assert.ok(e.mensaje.length <= 160, 'corto: 9 créditos');
    assert.equal((await adjuntos.bytesDe('sms_envio', s.id)).length, 1, 'con el PDF del comunicado');
    assert.equal((await sms.borradorDesde({ origen: 'comunicado', origenId: id }, D)).id, s.id, 'el mismo borrador, no otro');
    await assert.rejects(sms.borradorDesde({ origen: 'comunicado', origenId: id }, I), e2 => e2.status === 403, 'es de quien manda SMS');
  } finally {
    correo.enviarCorreo = real;
  }
}));

test('la línea de tiempo: firmas, comunicados y SMS por fechas, y solo lo que ya puede ver', () => {
  const secciones = [
    { id: 'firmas', datos: { lista: [{ tipo: 'sancion', titulo: '', estado: 'rechazado', creado: '2026-11-02', enviado: '2026-11-03' }] } },
    { id: 'comunicados', datos: { lista: [{ titulo: 'Norma', dia: '2026-11-20', leido: null }] } },
    { id: 'sms', datos: { lista: [{ asunto: 'Comunicado sin leer', dia: '2026-11-25', estado_texto: 'Entregado y certificado', certificado_adjunto_id: '7' }] } },
  ];
  const l = expediente.lineaDeTiempo(secciones).datos.lista;
  assert.deepEqual(l.map(x => x.canal), ['SMS certificado', 'Comunicado', 'Firma'], 'lo último arriba');
  assert.deepEqual([l[1].como, l[1].aviso], ['sin leer', true]);
  assert.deepEqual([l[2].que, l[2].como], ['Carta de sanción', 'no lo firmó']);
  assert.equal(l[0].certificado, '7');
  assert.equal(expediente.lineaDeTiempo([{ id: 'vacaciones', datos: {} }]), null, 'sin ninguna de las tres llaves, no sale');
  assert.deepEqual(expediente.lineaDeTiempo([{ id: 'sms', datos: { lista: [] } }]).datos.lista, []);
});
