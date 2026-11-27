// ============================================================
// EL SMS CERTIFICADO DE MENSATEK (módulo 9, db/306, 26/11/2026)
// ============================================================
// Diana lo prepara y lo manda sola; cada persona en su petición, con su DNI
// para abrirlo (sin DNI, su móvil); sin móvil no se le manda. Los estados que
// llegan del receptor lo mueven y, con «entregado y certificado», se guarda el
// certificado. Sanciones y Finiquitos preparan su borrador. Mensatek no se
// llama de verdad: se sustituye.
'use strict';

const { conBase } = require('./apoyo/base');   // primero: sustituye services/db
const { test } = require('node:test');
const assert = require('node:assert/strict');

const mensatek = require('../services/mensatek');
const parametros = require('../services/parametros');
const adjuntos = require('../services/adjuntos');
const sms = require('../modules/RRHH/sms.service');

test('preparar, mandar a cada uno con su DNI, los estados y el certificado', () => conBase(async ({ consulta, fabrica }) => {
  const reales = { configurado: mensatek.configurado, enviar: mensatek.enviarCertificado, cert: mensatek.certificado,
    valor: parametros.valor, subir: adjuntos.subirDelSistema };
  const mandados = [];
  let siguiente = 9000;
  mensatek.configurado = () => true;
  mensatek.enviarCertificado = async x => { mandados.push(x); return { idMensaje: ++siguiente, creditos: 3 }; };
  mensatek.certificado = async () => Buffer.from('%PDF-1.4 prueba');
  parametros.valor = async k => ({ 'mensatek.telefono': '910000000', 'mensatek.cif': 'B00000000', 'mensatek.contacto': 'EMPRESA', 'mensatek.remitente': 'PRUEBAS', 'mensatek.dias_validez': 3 }[k] ?? reales.valor(k));
  adjuntos.subirDelSistema = async () => ({ id: 777 });
  try {
    const u = await fabrica.usuario({ rol: 'oficina', nombre: 'Diana' });
    for (const k of ['/sms', '/sms/enviar']) await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, $2)`, [u.id, k]);
    const D = { usuarioId: u.id, rol: 'oficina' };
    const m = await fabrica.usuario({ rol: 'oficina', nombre: 'Mira' });
    await consulta(`INSERT INTO usuario_permiso (usuario_id, clave) VALUES ($1, '/sms')`, [m.id]);
    const M = { usuarioId: m.id, rol: 'oficina' };

    const conDni = await fabrica.conductor({ nombre: 'ANA' });
    const sinDni = await fabrica.conductor({ nombre: 'LUIS' });
    const sinMovil = await fabrica.conductor({ nombre: 'NOTEL' });
    await consulta(`UPDATE conductor SET dni_nie = '12345678-z' WHERE id = $1`, [conDni.id]);
    await consulta(`UPDATE conductor SET dni_nie = NULL WHERE id = ANY($1::bigint[])`, [[sinDni.id, sinMovil.id]]);
    await consulta(`INSERT INTO conductor_telefono (conductor_id, e164, origen, principal) VALUES ($1, '+34600111001', 'manual', TRUE), ($2, '+34600111002', 'manual', TRUE)`, [conDni.id, sinDni.id]);

    // Mandar es de su llave; el texto se rellena con los datos de cada uno.
    await assert.rejects(sms.crear({ asunto: 'X', mensaje: 'Texto de prueba', alcance: 'personas', personas: [conDni.id] }, M), e => e.status === 403);
    const { id } = await sms.crear({ asunto: 'Requerimiento', mensaje: '{nombre}: se le requiere, DNI {dni}.', alcance: 'personas',
      personas: [conDni.id, sinDni.id, sinMovil.id], aceptacion: 5 }, D);
    const f0 = await sms.ficha(id, M);
    assert.deepEqual([f0.previa.total, f0.previa.sinMovil, f0.previa.sinDni], [3, 1, 2]);

    const r = await sms.enviar(id, D, { esperar: true });
    assert.equal(r.sinMovil, 1);
    assert.equal(mandados.length, 2, 'una petición por persona; sin móvil, ninguna');
    const a = mandados.find(x => x.movil === '34600111001');
    assert.equal(a.identificar, 'DNI-12345678Z', 'abre con su DNI, limpio');
    assert.match(a.mensaje, /De Prueba, ANA: se le requiere, DNI 12345678-z\./);
    assert.equal(a.aceptacion, 5);
    assert.equal(mandados.find(x => x.movil === '34600111002').identificar, 'MOVIL', 'sin DNI, con su móvil');
    let f = await sms.ficha(id, D);
    assert.equal(f.estado, 'enviado');
    assert.equal(f.personas.find(p => p.conductor_id === String(sinMovil.id)).error, 'Sin móvil en su ficha');
    await assert.rejects(sms.enviar(id, D), /Ya se mandó/);

    // Los estados del receptor: entregado y certificado (se guarda el PDF), y la abrió con su DNI.
    const idA = Number(f.personas.find(p => p.conductor_id === String(conDni.id)).id_mensaje);
    await sms.recibirReport({ Servicio: 'SMSCERTIFICADO', Resultado: '14', Movil: '34600111001', idMensaje: String(idA) });
    await sms.recibirReport({ Servicio: 'EVENTOSSMSCERTIFICADO', TipoEvento: '8', Telefono: '34600111001', idMensaje: String(idA) });
    await sms.recibirReport({ Servicio: 'SMSCERTIFICADO', Resultado: '14', Movil: '34699999999', idMensaje: '1' });   // no es nuestro
    f = await sms.ficha(id, D);
    const pa = f.personas.find(p => p.conductor_id === String(conDni.id));
    assert.equal(pa.estado_texto, 'Entregado y certificado');
    assert.ok(pa.entregado && pa.certificado && pa.abierto);
    assert.equal(pa.certificado_adjunto_id, '777', 'el certificado, guardado');
    assert.equal(f.certificados, 1);
    assert.equal((await consulta(`SELECT count(*)::int AS n FROM sms_report`)).rows[0].n, 3, 'todo lo que llega, apuntado');

    // En el expediente.
    const exp = await sms.expediente(conDni.id);
    assert.equal(exp[0].certificado_adjunto_id, '777');

    // El receptor solo con su usuario y contraseña.
    process.env.MENSATEK_WEBHOOK_USUARIO = 'mk'; process.env.MENSATEK_WEBHOOK_CLAVE = 'secreto';
    assert.equal(sms.receptorValido('Basic ' + Buffer.from('mk:secreto').toString('base64')), true);
    assert.equal(sms.receptorValido('Basic ' + Buffer.from('mk:otra').toString('base64')), false);
    assert.equal(sms.receptorValido(''), false);
    delete process.env.MENSATEK_WEBHOOK_USUARIO; delete process.env.MENSATEK_WEBHOOK_CLAVE;
    assert.equal(sms.receptorValido('Basic ' + Buffer.from('mk:secreto').toString('base64')), false, 'sin configurar, nada');

    // Desde una sanción: el borrador a esa persona (una vez).
    const s = (await consulta(
      `INSERT INTO sancion (conductor_id, gravedad, falta, fecha_hechos, estado) VALUES ($1, 'LEVE', 'Prueba', CURRENT_DATE, 'aprobada') RETURNING id`,
      [conDni.id])).rows[0];
    {
      const b1 = await sms.borradorDesde({ origen: 'sancion', origenId: s.id, plantilla: 'sancion' }, D);
      const b2 = await sms.borradorDesde({ origen: 'sancion', origenId: s.id }, D);
      assert.equal(b1.id, b2.id, 'no se duplica el borrador');
      const fb = await sms.ficha(b1.id, D);
      assert.deepEqual([fb.origen, fb.plantilla, fb.personas.length, fb.previa.total], ['sancion', 'sancion', 0, 1]);
    }
  } finally {
    Object.assign(mensatek, { configurado: reales.configurado, enviarCertificado: reales.enviar, certificado: reales.cert });
    parametros.valor = reales.valor;
    adjuntos.subirDelSistema = reales.subir;
  }
}));

test('el móvil para Mensatek y el texto de cada uno', () => {
  assert.equal(mensatek.movilDe('+34 600 11 10 01'), '34600111001');
  assert.equal(mensatek.movilDe('600111001'), '34600111001');
  assert.equal(mensatek.movilDe('12'), null);
  assert.match(sms.rellenar('Hola {pila}, el {fecha}', { pila: 'Ana' }), /^Hola Ana, el \d{2}\/\d{2}\/\d{4}$/);
});
