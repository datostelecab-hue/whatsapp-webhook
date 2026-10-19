// ============================================================
// EN PRUEBAS, EL CORREO NO LE LLEGA A NADIE DE VERDAD (19/10/2026)
// ============================================================
//   node scripts/comprobar-correo-pruebas.js
//
// Con MODO_PRUEBAS=1, services/correo.js manda todo:
//   · desviado a CORREO_PRUEBAS_A (UNA dirección), si hay un SMTP de verdad;
//   · si no, al buzón falso de CORREO_PRUEBAS, si es de este PC;
//   · si no, a ninguna parte (se frena y se apunta).
// No manda nada: el transporte de nodemailer es un doble.

process.env.MODO_PRUEBAS = '1';
const nodemailer = require('nodemailer');
const correo = require('../services/correo');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

let envios = [];
nodemailer.createTransport = opciones => ({
  sendMail: async m => { envios.push({ host: opciones.host, ...m }); return { messageId: 'x' }; },
});
const entorno = valores => {
  ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'CORREO_PRUEBAS_A', 'CORREO_PRUEBAS'].forEach(k => { delete process.env[k]; });
  Object.assign(process.env, valores);
  envios = [];
};
const SMTP = { SMTP_HOST: 'smtp.ejemplo.com', SMTP_USER: 'procesos@ejemplo.com', SMTP_PASS: 'x' };
const CORREO = {
  to: 'conductor@ejemplo.com', subject: 'Tu código de Telecab: 123456', text: 'Hola',
  html: '<!doctype html><html><body style="margin:0"><p>Hola</p></body></html>',
};

(async () => {
  console.error = () => {};   // los avisos del cortafuegos no interesan aquí

  // ── 1. Desviado a una sola dirección ─────────────────────────────────────
  entorno({ ...SMTP, CORREO_PRUEBAS_A: 'datostelecab@gmail.com', CORREO_PRUEBAS: '127.0.0.1:1025' });
  let r = await correo.enviarCorreo(CORREO);
  igual('Con SMTP y CORREO_PRUEBAS_A, sale por el SMTP de verdad', [r.enviado, envios.length, envios[0].host], [true, 1, 'smtp.ejemplo.com']);
  igual('…pero SOLO a esa dirección, no al conductor', envios[0].to, 'datostelecab@gmail.com');
  igual('…con [PRUEBAS] en el asunto', envios[0].subject, '[PRUEBAS] Tu código de Telecab: 123456');
  igual('…y diciendo a quién habría ido', [envios[0].text.startsWith('Entorno de pruebas: en producción este correo iría a conductor@ejemplo.com.'),
    /<body style="margin:0"><p style="[^"]+">Entorno de pruebas: en producción este correo iría a conductor@ejemplo.com.<\/p><p>Hola/.test(envios[0].html)], [true, true]);
  igual('…sin copias a nadie', [envios[0].cc, envios[0].bcc], [undefined, undefined]);

  envios = [];
  r = await correo.enviarComoUsuario('laura@telecab.es', { to: 'gestoria@ejemplo.com', subject: 'Reporte', text: 'x' });
  igual('El que va «como» un usuario, también desviado', [envios.length, envios[0].to, r.from], [1, 'datostelecab@gmail.com', 'laura@telecab.es']);

  // ── 2. Lo que no vale como desvío ────────────────────────────────────────
  entorno({ ...SMTP, CORREO_PRUEBAS_A: 'datostelecab@gmail.com, otro@ejemplo.com', CORREO_PRUEBAS: '127.0.0.1:1025' });
  await correo.enviarCorreo(CORREO);
  igual('Dos direcciones no valen: va al buzón falso, no a las dos', [envios[0].host, envios[0].to], ['127.0.0.1', 'conductor@ejemplo.com']);

  entorno({ SMTP_HOST: 'smtp.ejemplo.com', SMTP_USER: 'procesos@ejemplo.com', CORREO_PRUEBAS_A: 'datostelecab@gmail.com', CORREO_PRUEBAS: '127.0.0.1:1025' });
  await correo.enviarCorreo(CORREO);
  igual('Sin contraseña del SMTP: al buzón falso', envios[0].host, '127.0.0.1');

  // ── 3. Sin nada: no sale ─────────────────────────────────────────────────
  entorno({ CORREO_PRUEBAS: 'smtp.dondominio.com:587' });
  r = await correo.enviarCorreo(CORREO);
  igual('Un «buzón falso» que no es de este PC no vale: se frena', [r.enviado, envios.length], [false, 0]);
  entorno({});
  r = await correo.enviarCorreo(CORREO);
  igual('Sin nada configurado, se frena', [r.enviado, envios.length], [false, 0]);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { process.stdout.write('ERROR ' + e.stack + '\n'); process.exit(1); });
