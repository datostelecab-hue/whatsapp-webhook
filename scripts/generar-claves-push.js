// ============================================================
// LAS CLAVES DE LAS NOTIFICACIONES (VAPID) — para Render (A8)
// ============================================================
// Hace un par de claves nuevas y las escribe en pantalla, listas para pegar en
// las variables de entorno del servicio de Render. Las ejecuta QUIEN las va a
// pegar, en su PC: la privada no tiene que pasar por ningún otro sitio.
//
//   node scripts/generar-claves-push.js
//
// UN PAR POR SERVICIO: el ERP y el servidor de pruebas, cada uno el suyo.
// Y SE PONEN UNA VEZ: si se cambian, todos los dispositivos activados con las
// de antes dejan de recibir (el servicio de avisos los rechaza) y cada persona
// tiene que volver a pulsar «Activar» en Configuración.
'use strict';

const { generateVAPIDKeys } = require('web-push');

const k = generateVAPIDKeys();
console.log(`
Pega estas tres en Render → tu servicio → Environment, y despliega:

VAPID_PUBLICA=${k.publicKey}
VAPID_PRIVADA=${k.privateKey}
VAPID_CONTACTO=https://erptelecab.es

La PRIVADA es un secreto: no la pegues en ningún otro sitio (ni en un chat).
Un par distinto para el ERP y para el servidor de pruebas: vuelve a ejecutar
esto para el otro.
`);
