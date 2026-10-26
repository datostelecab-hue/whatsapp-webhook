// ============================================================
// EL PORTAL DE CONDUCTORES (19/10/2026, db/211)
// ============================================================
//   node scripts/comprobar-portal.js
//
// El acceso con DNI y código al email, sus límites y la frontera entre el
// dominio del portal y el del ERP. No toca la base ni manda correos: el
// repositorio y el correo son dobles.

const repo = require('../modules/Portal/portal.repo');
const correo = require('../services/correo');
const svc = require('../modules/Portal/portal.service');
const f = require('../modules/Portal/formato');
const ctl = require('../modules/Portal/portal.controller');
const nominas = require('../modules/Nominas/nominas.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// ── Dobles: una base en memoria con dos conductores ─────────────────────────
const fichas = {
  '12345678Z': { id: '7', nombre: 'JUAN CARLOS', nombre_completo: 'JUAN CARLOS PÉREZ', email: 'juan.perez@ejemplo.com' },
  'X1234567L': { id: '8', nombre: 'Ana', nombre_completo: 'Ana Ruiz', email: null },
};
let codigos = [], sesiones = [], correos = [];
let reloj = 0;   // minutos de mentira
repo.porDni = async dni => fichas[dni] || null;
repo.codigosRecientes = async ({ conductorId, ip, minutos }) => ({
  persona: codigos.filter(c => c.conductorId === conductorId && reloj - c.t < minutos).length,
  ip: codigos.filter(c => c.ip === ip && reloj - c.t < minutos).length,
});
repo.nuevoCodigo = async ({ conductorId, huella, ip }) => {
  codigos.filter(c => c.conductorId === conductorId).forEach(c => { c.anulado = true; });
  codigos.push({ id: String(codigos.length + 1), conductorId, huella, ip, t: reloj, intentos: 0 });
  return String(codigos.length);
};
repo.marcarEnviado = async () => {};
repo.codigoVivo = async conductorId => {
  const c = codigos.filter(x => x.conductorId === conductorId && !x.anulado && !x.usado && reloj - x.t < 10).pop();
  return c ? { id: c.id, huella: c.huella, intentos: c.intentos } : null;
};
repo.intentar = async (id, acierta, max) => {
  const c = codigos.find(x => x.id === id);
  if (!c || c.anulado || c.usado) return null;
  c.intentos++;
  if (acierta) c.usado = true; else if (c.intentos >= max) c.anulado = true;
  return { intentos: c.intentos, usado: !!c.usado, anulado: !!c.anulado };
};
repo.nuevaSesion = async s => { sesiones.push({ ...s, cerrada: false }); };
repo.sesion = async huella => {
  const s = sesiones.find(x => x.huella === huella && !x.cerrada);
  if (!s) return null;
  const p = Object.values(fichas).find(x => x.id === s.conductorId);
  return { sesion_id: '1', renovar: false, ...p };
};
repo.cerrar = async huella => { sesiones.filter(x => x.huella === huella).forEach(x => { x.cerrada = true; }); };
correo.enviarCorreo = async m => { correos.push(m); return { enviado: true }; };
const codigoDe = m => m.subject.match(/(\d{6})$/)[1];

(async () => {
  // ── 1. Lo que se escribe ─────────────────────────────────────────────────
  igual('El DNI se limpia: puntos, guiones, espacios y minúsculas', svc._normalizarDni(' 12.345.678-z '), '12345678Z');
  igual('El email se enseña oculto', svc._ocultarEmail('juan.perez@ejemplo.com'), 'ju•••@ejemplo.com');
  igual('…también uno muy corto', svc._ocultarEmail('a@b.es'), 'a•••@b.es');
  igual('El nombre de pila, bien escrito', svc._pilaDe('JUAN CARLOS'), 'Juan');
  igual('Los nombres en mayúsculas, como nombres', f.nombrePropio('JUAN FRANCISCO RUIZ DE LA CRUZ'), 'Juan Francisco Ruiz de la Cruz');
  igual('…y uno ya bien escrito no se toca', f.nombrePropio('Isac McNamara'), 'Isac McNamara');
  igual('La semana, corta y larga', [f.semana('2026-09-28', '2026-10-04'), f.semanaLarga('2026-10-12', '2026-10-18')],
    ['28 sep – 4 oct', 'del 12 al 18 de octubre']);
  igual('Hoy, mañana y los demás días', [f.nombreDia('2026-10-19', '2026-10-19'), f.nombreDia('2026-10-21', '2026-10-19')],
    [{ nombre: 'Hoy', fecha: 'lunes 19/10' }, { nombre: 'Miércoles', fecha: '21/10' }]);
  igual('El teléfono, legible y para llamar', [f.telefono('637945245'), f.telHref('+34 637 945 245')], ['637 94 52 45', 'tel:+34637945245']);
  igual('Sin nota, dicho para el conductor', f.sinNota('lleva menos de 5 días en el periodo (3)'),
    'Esa semana contaste menos de 5 días, y con tan pocos no se puede poner nota.');

  // ── 2. Pedir el código ───────────────────────────────────────────────────
  let r = await svc.pedirCodigo({ dni: '12.345.678-z', ip: '1.1.1.1' });
  igual('Con DNI y email: se manda el código y se dice a qué buzón', [r.ok, r.email, correos.length], [true, 'ju•••@ejemplo.com', 1]);
  igual('…al email de su ficha, con el código en el asunto', [correos[0].to, /^Tu código de Telecab: \d{6}$/.test(correos[0].subject)], ['juan.perez@ejemplo.com', true]);
  igual('…y el código no se guarda en claro', codigos[0].huella.length === 64 && !codigos[0].huella.includes(codigoDe(correos[0])), true);

  const sinEmail = await svc.pedirCodigo({ dni: 'X1234567L', ip: '1.1.1.1' });
  const noExiste = await svc.pedirCodigo({ dni: '99999999R', ip: '1.1.1.1' });
  igual('Sin email y sin ficha se contesta LO MISMO (no se averigua quién trabaja aquí)', [sinEmail, noExiste],
    [{ ok: false, motivo: 'no-podemos' }, { ok: false, motivo: 'no-podemos' }]);
  igual('Un DNI vacío no se busca', await svc.pedirCodigo({ dni: '  -- ', ip: '1.1.1.1' }), { ok: false, motivo: 'dni' });

  await svc.pedirCodigo({ dni: '12345678Z', ip: '1.1.1.1' });
  await svc.pedirCodigo({ dni: '12345678Z', ip: '1.1.1.1' });
  igual('A la cuarta en 15 minutos, a esperar', await svc.pedirCodigo({ dni: '12345678Z', ip: '1.1.1.1' }), { ok: false, motivo: 'espera' });
  igual('…y solo vale el último: los de antes quedan anulados', codigos.filter(c => !c.anulado).length, 1);

  // ── 3. Entrar ────────────────────────────────────────────────────────────
  reloj += 20; codigos = []; correos = [];
  await svc.pedirCodigo({ dni: '12345678Z', ip: '2.2.2.2' });
  const bueno = codigoDe(correos[0]);
  const malo = bueno === '000000' ? '111111' : '000000';
  r = await svc.entrar({ dni: '12345678Z', codigo: malo });
  igual('Un código equivocado dice cuántos intentos quedan', r, { ok: false, motivo: 'codigo', quedan: 4 });
  r = await svc.entrar({ dni: '12345678Z', codigo: bueno });
  igual('El bueno abre la sesión', [r.ok, typeof r.testigo, (r.testigo || '').length >= 40], [true, 'string', true]);
  igual('…y en la base se guarda su huella, no el testigo', sesiones[0].huella !== r.testigo && sesiones[0].huella.length === 64, true);
  igual('El mismo código no sirve dos veces', (await svc.entrar({ dni: '12345678Z', codigo: bueno })).motivo, 'caducado');

  const quien = await svc.quienEs(r.testigo);
  igual('Con la cookie se sabe quién es, con su nombre bien escrito', quien, { id: '7', nombre: 'Juan Carlos Pérez', pila: 'Juan' });
  igual('Una cookie inventada no es nadie', await svc.quienEs('x'.repeat(43)), null);
  await svc.salir(r.testigo);
  igual('Al salir, la sesión deja de valer', await svc.quienEs(r.testigo), null);

  reloj += 20; codigos = []; correos = [];
  await svc.pedirCodigo({ dni: '12345678Z', ip: '3.3.3.3' });
  const otro = codigoDe(correos[0]) === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) await svc.entrar({ dni: '12345678Z', codigo: otro });
  igual('Al quinto fallo, el código se anula', await svc.entrar({ dni: '12345678Z', codigo: otro }), { ok: false, motivo: 'agotado' });
  igual('…y ya no vale ni el bueno', (await svc.entrar({ dni: '12345678Z', codigo: codigoDe(correos[0]) })).motivo, 'caducado');

  reloj += 20; codigos = []; correos = [];
  await svc.pedirCodigo({ dni: '12345678Z', ip: '4.4.4.4' });
  reloj += 11;
  igual('A los 10 minutos, caducado', (await svc.entrar({ dni: '12345678Z', codigo: codigoDe(correos[0]) })).motivo, 'caducado');

  // ── 4. El dinero del mes ─────────────────────────────────────────────────
  const U = (j, cfg = nominas.DEFAULTS) => nominas._umbralDe(j, cfg);
  igual('El objetivo es el umbral del FAS de la nómina: 40 h → 4.750, 32 h → 3.750', [U(40), U(32)], [4750, 3750]);
  igual('…y las demás jornadas, el de 40 h, como en la nómina', [U(20), U(null)], [4750, 4750]);
  igual('El dinero se escribe con el punto de los miles, y el € pegado a la cifra', [f.euros(4750, 0), f.euros(2340.5)], ['4.750\u00a0€', '2.340,50\u00a0€']);

  const pedidos = [];
  nominas.dineroDe = async (id, desde, hasta) => {
    pedidos.push([desde, hasta]);
    return desde.endsWith('-10-01') ? { neto: 2340.5, propinas: 12, peajes: 7.5 } : { neto: 5100, propinas: 30, peajes: 0 };
  };
  nominas.umbralFASDe = async j => U(j);
  repo.contrato = async () => ({ tipo: 'propia', jornada: 32 });
  let d = await svc.dinero({ id: '7' }, '2026-10-19');
  igual('Del día 1 a hoy, y el mes pasado entero (por día natural, como la nómina)', pedidos, [['2026-10-01', '2026-10-19'], ['2026-09-01', '2026-09-30']]);
  igual('Plantilla propia de 32 h: su facturación contra 3.750', [d.ett, d.objetivo, d.mes.neto], [false, 3750, 2340.5]);
  igual('A mes vencido: lo de octubre, en la nómina de noviembre; lo de septiembre, en la de octubre',
    [d.mes.nombre, d.mes.cobro, d.anterior.nombre, d.anterior.cobro], ['octubre', 'noviembre', 'septiembre', 'octubre']);

  repo.contrato = async () => ({ tipo: 'ett', jornada: 40 });
  d = await svc.dinero({ id: '8' }, '2026-10-19');
  igual('La ETT no tiene objetivo (no ve la barra), pero sí sus propinas y peajes', [d.ett, d.objetivo, d.mes.propinas, d.mes.peajes], [true, null, 12, 7.5]);

  nominas.dineroDe = async () => ({ neto: 0, propinas: 0, peajes: 0 });
  repo.contrato = async () => ({ tipo: 'propia', jornada: 40 });
  d = await svc.dinero({ id: '9' }, '2026-01-10');
  igual('En enero, lo de diciembre del año anterior; y sin nada el mes pasado, no se enseña', [d.mes.cobro, d.anterior, d.objetivo], ['febrero', null, 4750]);

  // ── 5. El efectivo (la ficha de Recaudación, recortada) ───────────────────
  const recRepo = require('../modules/Administracion/recaudacion.repo');
  const rec = require('../modules/Administracion/recaudacion.service');
  const mov = (fecha, tipo, importe, extra = {}) => ({ fecha, tipo, importe, anulado: false, observacion: 'nota interna',
    quien: 'Laura', desglose: { 5000: 1 }, referencia: '', ...extra });
  recRepo.quincenaHoy = () => ({ anio: 2026, mes: 10, quincena: 2 });
  recRepo.ficha = async () => ({
    total: { pendiente: 70 },
    quincenas: [   // de la más nueva a la más vieja, como la ficha de la ventanilla
      { anio: 2026, mes: 10, quincena: 2, etiqueta: '16–31 oct 2026', deuda: 120, ajuste: -10, saldo: 70, movimientos: [
        mov('2026-10-18', 'presencial', 50), mov('2026-10-17', 'presencial', 999, { anulado: true }),
        mov('2026-10-16', 'transferencia', 20, { referencia: 'ABC123' }), mov('2026-10-16', 'cambio', 20)] },
      { anio: 2026, mes: 6, quincena: 2, etiqueta: '16–30 jun 2026', deuda: 100, ajuste: 0, saldo: 0, movimientos: [mov('2026-06-20', 'nomina', 100)] },
      { anio: 2026, mes: 5, quincena: 1, etiqueta: '1–15 may 2026', deuda: 80, ajuste: 0, saldo: 0, movimientos: [mov('2026-05-12', 'presencial', 80)] },
    ],
  });
  const ex = await rec.extractoDe('7');
  igual('Desde junio: mayo no sale como quincena', ex.quincenas.map(q => q.etiqueta), ['16–31 oct 2026', '16–30 jun 2026']);
  igual('…y lo de antes entra como saldo de partida', ex.saldoInicial, 0);
  igual('El pendiente es el de la ventanilla', ex.pendiente, 70);
  igual('La quincena de hoy va marcada', ex.quincenas.map(q => q.enCurso), [true, false]);
  igual('Sin los anulados, y en orden de fecha', ex.quincenas[0].movimientos.map(m => m.fecha + ' ' + m.importe),
    ['2026-10-16 20', '2026-10-16 20', '2026-10-18 50']);
  igual('Lo que ve de cada movimiento: fecha, qué, importe, si baja lo que debe y el ID de la transferencia; nada más',
    ex.quincenas[0].movimientos.find(m => m.que === 'Transferencia'), { fecha: '2026-10-16', que: 'Transferencia', importe: 20, baja: true, referencia: 'ABC123' });
  const cambio = ex.quincenas[0].movimientos.find(m => m.que === 'Cambio que te dimos');
  igual('El cambio que se le da sube lo que debe', cambio && cambio.baja, false);
  igual('Cada quincena trae lo que llegaba de la anterior (la más vieja, el saldo de antes de junio)', ex.quincenas.map(q => q.arrastre), [0, 0]);
  igual('Ni observaciones, ni quién lo apuntó, ni billetes', ex.quincenas.flatMap(q => q.movimientos).some(m => 'observacion' in m || 'quien' in m || 'desglose' in m), false);
  igual('Del ajuste, la cifra', ex.quincenas[0].ajuste, -10);
  igual('Cobrado, entregado y lo que se le dio, desde junio', [ex.cobrado, ex.entregado, ex.dado], [220, 170, 20]);
  igual('…y con eso el resumen da el pendiente', +(ex.saldoInicial + ex.cobrado - ex.entregado + ex.dado).toFixed(2), ex.pendiente);

  // ── 6. La frontera entre dominios ────────────────────────────────────────
  const req = host => ({ hostname: host });
  igual('El dominio de los conductores es del portal', ['conductorestelecab.es', 'www.conductorestelecab.es', 'conductorestelecab.localhost'].map(h => ctl.esDelPortal(req(h))), [true, true, true]);
  igual('El del ERP y el de Render no', ['erptelecab.es', 'whatsapp-webhook-g7wa.onrender.com', 'localhost'].map(h => ctl.esDelPortal(req(h))), [false, false, false]);
  let siguio = false;
  ctl.porDominio(req('erptelecab.es'), {}, () => { siguio = true; });
  igual('Por el dominio del ERP, el portal deja pasar al ERP', siguio, true);

  // ── 7. La dirección de Render manda a erptelecab.es (26/10/2026) ─────────
  // A las personas sí; a Meta (el webhook del bot) y a las máquinas, no.
  const dom = require('../services/dominioErp');
  const RENDER = 'whatsapp-webhook-g7wa.onrender.com';
  const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  const pide = (o) => ({ method: 'GET', path: '/', originalUrl: '/', query: {}, hostname: RENDER, headers: { accept: HTML }, ...o });
  function pasa(req) {
    let a = null;
    const res = { redirect: (codigo, url) => { a = { codigo, url }; } };
    dom.aLaDireccionBuena(req, res, () => { a = 'sigue'; });
    return a;
  }
  const antes = process.env.DOMINIO_ERP;
  delete process.env.DOMINIO_ERP;
  igual('Sin DOMINIO_ERP no se manda a nadie a ningún sitio', pasa(pide({})), 'sigue');
  process.env.DOMINIO_ERP = 'https://ErpTelecab.es/';
  igual('La variable se limpia: sin https://, sin barra y en minúsculas', dom.dominio(), 'erptelecab.es');
  igual('Una persona que abre la dirección de Render va a erptelecab.es, con su ruta y temporal',
    pasa(pide({ path: '/plantilla', originalUrl: '/plantilla?id=7' })), { codigo: 302, url: 'https://erptelecab.es/plantilla?id=7' });
  igual('…y la raíz, a la raíz', pasa(pide({})), { codigo: 302, url: 'https://erptelecab.es/' });
  igual('HEAD también (lo que hace un navegador al comprobar)', pasa(pide({ method: 'HEAD' })).url, 'https://erptelecab.es/');
  igual('Los MENSAJES del bot (POST / de Meta) se quedan', pasa(pide({ method: 'POST', headers: { accept: '*/*' } })), 'sigue');
  igual('…aunque Meta mandara un Accept con html', pasa(pide({ method: 'POST' })), 'sigue');
  igual('La VERIFICACIÓN del webhook (GET /?hub.mode=subscribe) se queda',
    pasa(pide({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '1' } })), 'sigue');
  igual('Una máquina que pide datos (sin text/html) se queda', pasa(pide({ path: '/api/algo', originalUrl: '/api/algo', headers: { accept: 'application/json' } })), 'sigue');
  igual('…y la que no dice qué quiere, también', pasa(pide({ headers: {} })), 'sigue');
  igual('erptelecab.es no se manda a sí mismo', pasa(pide({ hostname: 'erptelecab.es' })), 'sigue');
  igual('El portal de conductores no se toca', pasa(pide({ hostname: 'conductorestelecab.es' })), 'sigue');
  igual('Ni el entorno local', pasa(pide({ hostname: 'erp.localhost' })), 'sigue');
  process.env.DOMINIO_ERP = RENDER;
  igual('Si alguien pone la propia dirección de Render en la variable, no hay bucle', pasa(pide({})), 'sigue');
  process.env.DOMINIO_ERP = 'erptelecab.es/../evil';
  igual('Una variable que no es un dominio se ignora', [dom.dominio(), pasa(pide({}))], [null, 'sigue']);
  if (antes === undefined) delete process.env.DOMINIO_ERP; else process.env.DOMINIO_ERP = antes;

  // El ORDEN en app.js es lo que deja fuera los vídeos que Meta baja de /assets:
  // /assets se sirve antes de la redirección, y la redirección va antes del
  // portal, de la sesión y del webhook.
  const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  const en = t => fuente.indexOf(t);
  const pos = ["app.use('/assets'", "dominioErp').aLaDireccionBuena", "porDominio);", 'app.use(sesion.cargarSesion)', "app.post('/', botPuertas)"].map(en);
  igual('En app.js: /assets, luego la redirección, luego portal, sesión y webhook', pos.every((p, i) => p > -1 && (i === 0 || p > pos[i - 1])), true);

  // Y de verdad, por HTTP: un Express con el mismo orden que app.js.
  const express = require('express');
  const http = require('http');
  const mini = express();
  mini.set('trust proxy', 2);
  mini.use('/assets', express.static(require('path').join(__dirname, '..', 'public', 'assets')));
  mini.use(dom.aLaDireccionBuena);
  mini.get('/', (req, res) => res.send(req.query['hub.challenge'] || 'portada'));
  mini.post('/', (req, res) => res.sendStatus(200));
  const srv = await new Promise(ok => { const s = mini.listen(0, () => ok(s)); });
  const pedir = (metodo, ruta, cab) => new Promise((ok, mal) => {
    const r = http.request({ port: srv.address().port, method: metodo, path: ruta, headers: { host: RENDER, ...cab } }, rr => {
      rr.resume(); rr.on('end', () => ok({ codigo: rr.statusCode, a: rr.headers.location || null }));
    });
    r.on('error', mal); r.end(metodo === 'POST' ? '{}' : undefined);
  });
  process.env.DOMINIO_ERP = 'erptelecab.es';
  igual('HTTP: el navegador en la dirección de Render, a erptelecab.es', await pedir('GET', '/inicio', { accept: HTML }), { codigo: 302, a: 'https://erptelecab.es/inicio' });
  igual('HTTP: el mensaje de Meta se contesta aquí', await pedir('POST', '/', { 'content-type': 'application/json' }), { codigo: 200, a: null });
  igual('HTTP: la verificación de Meta se contesta aquí', await pedir('GET', '/?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42', { accept: '*/*' }), { codigo: 200, a: null });
  igual('HTTP: el vídeo que baja Meta se sirve aquí, aunque lo pidiera con html', (await pedir('GET', '/assets/videos/bot-coche.jpg', { accept: HTML })).codigo, 200);
  if (antes === undefined) delete process.env.DOMINIO_ERP; else process.env.DOMINIO_ERP = antes;
  srv.close();

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.stack); process.exit(1); });
