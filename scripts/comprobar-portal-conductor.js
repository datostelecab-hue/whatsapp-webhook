// ============================================================
// EL PORTAL DEL CONDUCTOR — entrar y no salirse de su dominio
// ============================================================
// La primera parte del portal (09/10/2026): los conductores entran por su
// propio dominio con su teléfono y su DNI/NIE. Esto comprueba:
//
//   · las reglas del login (teléfono por sus 9 cifras, documento sin mirar
//     mayúsculas ni guiones, contrato en vigor, el mismo error falle lo que
//     falle, el freno tras ocho fallos);
//   · que la sesión del conductor no se pueda falsificar ni usar como la de la
//     oficina;
//   · EL DOMINIO: por el de los conductores solo existe el portal (el ERP da
//     404), y por cualquier otro, el ERP de siempre.
//
//   node scripts/comprobar-portal-conductor.js
//
// No toca la base: el repositorio se sustituye. Levanta un servidor de prueba
// en un puerto libre, con el mismo cableado que app.js.
process.env.DOMINIO_CONDUCTORES = 'conductores.test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const repo = require('../modules/PortalConductor/portal.repo');
const S = require('../modules/PortalConductor/portal.service');
const { porDominio } = require('../modules/PortalConductor/portal.controller');
const sesionOficina = require('../services/sesion');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// ── La base, sustituida ─────────────────────────────────────────────────────
const CONDUCTORES = [
  { id: 96, dni_nie: '12345678Z', empleo_vigente: true, es_centinela: false, nombre: 'Andres Jose', apellidos: 'Garrido Aparicio', nombre_bolt: 'Andres Jose Garrido Aparicio', tel: '604268811' },
  { id: 97, dni_nie: 'X1234567L', empleo_vigente: false, es_centinela: false, nombre: 'Pedro', apellidos: 'Baja', nombre_bolt: '', tel: '611111111' },
  { id: 98, dni_nie: null, empleo_vigente: true, es_centinela: false, nombre: 'Sin', apellidos: 'Documento', nombre_bolt: '', tel: '622222222' },
];
const accesos = [];
repo.porTelefono = async suf => CONDUCTORES.filter(c => c.tel === suf);
repo.datos = async id => {
  const c = CONDUCTORES.find(x => x.id === Number(id));
  return c && { id: c.id, nombre: c.nombre_bolt || `${c.nombre} ${c.apellidos}`, nombre_ficha: c.nombre, apellidos: c.apellidos,
    nombre_bolt: c.nombre_bolt, empleo_vigente: c.empleo_vigente, es_centinela: false, telefono: c.tel };
};
repo.apuntarAcceso = async x => { accesos.push(x); };

// ── La app de prueba, cableada como app.js ──────────────────────────────────
const RAIZ = path.join(__dirname, '..');
const app = express();
app.set('trust proxy', 2);
app.use(express.urlencoded({ extended: true }));
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', [path.join(RAIZ, 'views'), ...fs.readdirSync(path.join(RAIZ, 'modules'))
  .map(m => path.join(RAIZ, 'modules', m, 'vistas')).filter(p => fs.existsSync(p))]);
app.set('layout', 'layout-gestion');
app.use(porDominio);
// Lo que haría el ERP: si se llega aquí, es que el portal dejó pasar.
app.use((req, res) => res.status(200).send('ERP:' + req.path));

function pide(servidor, { host, metodo = 'GET', ruta = '/', cuerpo = null, cookie = '' }) {
  return new Promise((ok, mal) => {
    const datos = cuerpo ? new URLSearchParams(cuerpo).toString() : null;
    const r = http.request({
      host: '127.0.0.1', port: servidor.address().port, method: metodo, path: ruta,
      headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}),
        ...(datos ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(datos) } : {}) },
    }, res => {
      let t = ''; res.on('data', d => { t += d; });
      res.on('end', () => ok({ estado: res.statusCode, donde: res.headers.location || null, cuerpo: t,
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).find(c => c.startsWith(S.COOKIE + '=')) || null }));
    });
    r.on('error', mal);
    if (datos) r.write(datos);
    r.end();
  });
}

(async () => {
  // ── Las reglas, sueltas ──────────────────────────────────────────────────
  igual('Teléfono con +34 y espacios', S.sufijoTelefono('+34 604 26 88 11'), '604268811');
  igual('Teléfono corto: nada', S.sufijoTelefono('60426'), null);
  igual('Documento con minúsculas y guion', S.normalizarDocumento(' x-1234567-l '), 'X1234567L');
  igual('Mismo documento, escrito distinto', S.mismoDocumento('12.345.678-z', '12345678Z'), true);
  igual('Otro documento', S.mismoDocumento('12345678A', '12345678Z'), false);
  igual('Documento vacío nunca vale', S.mismoDocumento('', ''), false);

  // ── La sesión no se falsifica ni sirve en la oficina ─────────────────────
  const buena = S.firmar({ para: 'conductor', cid: 96, iat: Date.now(), exp: Date.now() + 60000 });
  igual('Un token bueno se lee', S.leerToken(buena) && S.leerToken(buena).cid, 96);
  const [cuerpo] = buena.split('.');
  const otroCuerpo = Buffer.from(JSON.stringify({ para: 'conductor', cid: 97, exp: Date.now() + 60000 })).toString('base64url');
  igual('Cambiar el conductor rompe la firma', S.leerToken(otroCuerpo + '.' + buena.split('.')[1]), null);
  igual('Caducado no vale', S.leerToken(S.firmar({ para: 'conductor', cid: 96, exp: Date.now() - 1 })), null);
  igual('Un token de otra cosa no vale', S.leerToken(S.firmar({ para: 'oficina', cid: 96, exp: Date.now() + 60000 })), null);
  // La cookie del conductor, presentada como la de la oficina: su firma es de otra clave.
  const req = { headers: { cookie: `${sesionOficina.COOKIE}=${encodeURIComponent(buena)}` } };
  const res = { cookie() {}, clearCookie() {}, locals: {} };
  await sesionOficina.cargarSesion(req, res, () => {});
  igual('Una sesión de conductor no abre el ERP', req.usuario, null);
  void cuerpo;

  // ── El dominio ───────────────────────────────────────────────────────────
  const servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  const C = 'conductores.test', G = 'erp.test';
  try {
    let r = await pide(servidor, { host: G, ruta: '/entrar' });
    igual('Por otro dominio, /entrar es del ERP', r.cuerpo, 'ERP:/entrar');
    r = await pide(servidor, { host: C, ruta: '/planificador' });
    igual('Por el de conductores, el ERP no existe (404)', [r.estado, r.cuerpo.startsWith('ERP')], [404, false]);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/', cuerpo: { x: 1 } });
    igual('Ni el webhook de WhatsApp', [r.estado, r.cuerpo.startsWith('ERP')], [404, false]);
    r = await pide(servidor, { host: C, ruta: '/' });
    igual('Sin sesión, a /entrar', [r.estado, r.donde], [302, '/entrar']);
    r = await pide(servidor, { host: C, ruta: '/entrar' });
    igual('El formulario: teléfono y DNI/NIE', [r.estado, r.cuerpo.includes('name="telefono"'), r.cuerpo.includes('name="documento"')], [200, true, true]);

    // ── Entrar ─────────────────────────────────────────────────────────────
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '604268811', documento: '00000000T' } });
    igual('DNI equivocado: 401 y el mensaje de siempre', [r.estado, r.cuerpo.includes(S.ERROR), r.cookie], [401, true, null]);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '699999999', documento: '12345678Z' } });
    igual('Teléfono que no es de nadie: el MISMO mensaje', [r.estado, r.cuerpo.includes(S.ERROR)], [401, true]);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '611111111', documento: 'x1234567l' } });
    igual('Sin contrato en vigor no entra', [r.estado, r.cookie], [401, null]);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '622222222', documento: '12345678Z' } });
    igual('Sin documento en su ficha no entra', [r.estado, r.cookie], [401, null]);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '604268811', documento: '' } });
    igual('Con el DNI en blanco, tampoco', [r.estado, r.cookie], [401, null]);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '+34 604 26 88 11', documento: '12345678-z', recordar: 'si' } });
    igual('Teléfono y DNI buenos: entra', [r.estado, r.donde, !!r.cookie], [302, '/', true]);
    const galleta = r.cookie;
    r = await pide(servidor, { host: C, ruta: '/', cookie: galleta });
    igual('Su portada, con su nombre de pila', [r.estado, r.cuerpo.includes('Hola, Andres Jose')], [200, true]);
    r = await pide(servidor, { host: G, ruta: '/inicio', cookie: galleta });
    igual('Su cookie no le abre el ERP en el otro dominio', r.cuerpo, 'ERP:/inicio');
    igual('Los intentos quedan apuntados', accesos.map(a => [a.motivo, a.ok]),
      [['documento', false], ['sin_telefono', false], ['inactivo', false], ['sin_documento', false], ['incompleto', false], ['ok', true]]);
    igual('Del teléfono de nadie, solo las 4 últimas cifras', accesos[1].telFinal, '9999');

    // Si deja de tener contrato, la sesión se acaba sola (tras la caché de un minuto).
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/salir', cookie: galleta });
    igual('Salir: a /entrar', [r.estado, r.donde], [302, '/entrar']);

    // ── El freno ───────────────────────────────────────────────────────────
    let ultimo;
    for (let i = 0; i < 9; i++) {
      ultimo = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '604268811', documento: 'MAL' + i } });
    }
    igual('Tras ocho fallos, frena aunque luego acierte…', ultimo.cuerpo.includes('Demasiados intentos'), true);
    r = await pide(servidor, { host: C, metodo: 'POST', ruta: '/entrar', cuerpo: { telefono: '604268811', documento: '12345678Z' } });
    igual('…y no entra mientras dura el freno', [r.estado, r.cookie], [401, null]);
  } finally {
    servidor.close();
  }

  // ── La oficina por su dominio ─────────────────────────────────────────────
  const D = require('../services/dominios');
  process.env.DOMINIO_GESTION = 'erp.test';
  const pet = (host, extra = {}) => ({ hostname: host, method: 'GET', path: '/inicio', originalUrl: '/inicio', query: {},
    get: h => (h === 'accept' ? 'text/html' : ''), ...extra });
  igual('El ERP por la dirección de Render se va a la suya', D.redireccionAGestion(pet('telecab.onrender.com')), 'https://erp.test/inicio');
  igual('Por la suya, se queda', D.redireccionAGestion(pet('erp.test')), null);
  igual('El webhook de Meta no se mueve', D.redireccionAGestion(pet('telecab.onrender.com', { query: { 'hub.mode': 'subscribe' } })), null);
  igual('Un POST no se mueve', D.redireccionAGestion(pet('telecab.onrender.com', { method: 'POST' })), null);
  igual('Una API no se mueve', D.redireccionAGestion(pet('telecab.onrender.com', { path: '/control/api/directo', originalUrl: '/control/api/directo' })), null);
  igual('Quien no pide una página (la salud de Render) no se mueve', D.redireccionAGestion(pet('telecab.onrender.com', { get: () => '*/*' })), null);
  igual('El dominio de los conductores no se manda a la oficina', D.redireccionAGestion(pet('conductores.test')), null);
  delete process.env.DOMINIO_GESTION;
  igual('Sin DOMINIO_GESTION, nada se mueve', D.redireccionAGestion(pet('telecab.onrender.com')), null);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
