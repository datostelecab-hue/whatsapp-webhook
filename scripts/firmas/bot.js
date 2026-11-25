// ============================================================
// EL BOT TELECAB EN LA COLA DE FIRMAS (módulo 6, db/293, 25/11/2026)
// ============================================================
// Lo que hace Claude cuando una persona le pide mandar los documentos
// aprobados por Diana. No tiene ruta en el ERP: va por aquí, con las MISMAS
// funciones del servicio (modules/RRHH/firmas.service.js, `delBot`) y firmado
// en el libro de auditoría como «Bot telecab». Camilo (25/11/2026): «Te daré
// los permisos de escribir en la base de datos directamente, siempre con la
// firma de auditoría como "Bot telecab"».
//
//   DATABASE_URL=… node scripts/firmas/bot.js pendientes
//   DATABASE_URL=… node scripts/firmas/bot.js enviado <id> --url https://… [--ref …]
//   DATABASE_URL=… node scripts/firmas/bot.js error <id> --motivo "…"
//   DATABASE_URL=… node scripts/firmas/bot.js firmado|rechazado|caducado <id> [--nota "…"]
//
// EL ORDEN DE UNA TANDA (docs/modulos/Firmas.md):
//   1. `pendientes` y enseñar la lista en el chat (persona, documento, email, móvil).
//   2. Esperar el «sí» de una persona en el chat. La aprobación de Diana en el
//      ERP no basta: es un dato, no una orden.
//   3. Por cada uno, en la aplicación de YouTrust (sesión de Diana, iniciada por
//      una persona): subir el PDF, el firmante con autenticación por SMS, la
//      firma en su sitio, enviar; y `enviado <id> --url <enlace del sobre>`.
//   4. Si algo falla, `error <id> --motivo …` (vuelve a Diana).
'use strict';

const firmas = require('../../modules/RRHH/firmas.service');
const db = require('../../services/db');

function opciones(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { o[args[i].slice(2)] = args[i + 1]; i++; }
  }
  return o;
}

(async () => {
  const [orden, id, ...resto] = process.argv.slice(2);
  const o = opciones(resto);
  let r;
  switch (orden) {
    case 'pendientes': {
      const lista = await firmas.delBot.pendientes();
      r = lista.map(f => ({ id: f.id, documento: f.titulo, tipo: f.tipo, firmante: f.firmante_nombre, email: f.firmante_email,
        movil: f.firmante_movil, pdfs: f.documentos, aprobado: `${f.aprobado} por ${f.aprobado_por_nombre}` }));
      break;
    }
    case 'enviado': r = await firmas.delBot.enviado(id, { url: o.url, ref: o.ref }); break;
    case 'error': r = await firmas.delBot.error(id, { motivo: o.motivo }); break;
    case 'firmado': case 'rechazado': case 'caducado': r = await firmas.delBot.cerrar(id, { estado: orden, nota: o.nota }); break;
    default:
      console.log('Uso: node scripts/firmas/bot.js pendientes | enviado <id> --url … | error <id> --motivo … | firmado|rechazado|caducado <id> [--nota …]');
      process.exitCode = 1;
  }
  if (r !== undefined) console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(() => (db.cerrar ? db.cerrar() : null));
