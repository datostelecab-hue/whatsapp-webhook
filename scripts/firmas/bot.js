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
//   DATABASE_URL=… node scripts/firmas/bot.js enviado <id> --ref <número de la solicitud de YouTrust>
//   DATABASE_URL=… node scripts/firmas/bot.js error <id> --motivo "…"
//   DATABASE_URL=… node scripts/firmas/bot.js enviados
//   DATABASE_URL=… node scripts/firmas/bot.js sincronizar <id> --estado done|declined|expired|canceled [--cuando <fecha>] [--motivo "…"]
//   DATABASE_URL=… node scripts/firmas/bot.js firmado|rechazado|caducado <id> [--nota "…"]
//
// EL ORDEN DE UNA TANDA (docs/modulos/Firmas.md):
//   1. `pendientes` y enseñar la lista en el chat (persona, documento, email, móvil).
//   2. Esperar el «sí» de una persona en el chat. La aprobación de Diana en el
//      ERP no basta: es un dato, no una orden.
//   3. Por cada uno, con el CONECTOR de YouTrust: create-signature-request (el
//      título, por email) y add-signature-request-signer (nombre, apellidos,
//      email, móvil; firma simple con SMS; es). El PDF y el campo de firma, por
//      la extensión en Brave (el conector no sube documentos), o desde una
//      plantilla. Enseñar el borrador, «sí», send-signature-request, y
//      `enviado <id> --ref <signature_request_id>`.
//   4. Si algo falla, `error <id> --motivo …` (vuelve a Diana).
//   5. Ponerlos al día: `enviados`, get-signature-request de cada uno y
//      `sincronizar <id> --estado <status> --cuando <completed_at>`.
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
      r = lista.map(f => {
        const como = firmas.comoSe(f.tipo);
        return { id: f.id, documento: f.titulo, tipo: f.tipo, firmante: f.firmante_nombre,
          nombre: f.nombre_pila, apellidos: f.apellidos, email: f.firmante_email,
          movil: como.sms ? f.firmante_movil : '(sin SMS)', pdfs: como.plantilla ? `(plantilla «${como.plantilla}»)` : f.documentos,
          // Los huecos de la plantilla de YouTrust (create-signature-request-from-template).
          ...(como.plantilla && f.detalle ? { plantilla: como.plantilla, plantillaId: como.plantillaId, workspaceId: como.workspaceId,
            incidencias: f.detalle.incidencias, total: f.detalle.total } : {}),
          aprobado: `${f.aprobado} por ${f.aprobado_por_nombre}` };
      });
      break;
    }
    case 'enviados': {
      const lista = await firmas.delBot.enviados();
      r = lista.map(f => ({ id: f.id, documento: f.titulo, firmante: f.firmante_nombre, youtrust: f.proveedor_ref, enviado: f.enviado }));
      break;
    }
    case 'enviado': r = await firmas.delBot.enviado(id, { url: o.url, ref: o.ref }); break;
    case 'sincronizar': r = await firmas.delBot.sincronizar(id, { estado: o.estado, cuando: o.cuando, motivo: o.motivo }); break;
    case 'error': r = await firmas.delBot.error(id, { motivo: o.motivo }); break;
    case 'firmado': case 'rechazado': case 'caducado': r = await firmas.delBot.cerrar(id, { estado: orden, nota: o.nota }); break;
    default:
      console.log('Uso: node scripts/firmas/bot.js pendientes | enviado <id> --ref … | error <id> --motivo … | enviados | sincronizar <id> --estado … | firmado|rechazado|caducado <id> [--nota …]');
      process.exitCode = 1;
  }
  if (r !== undefined) console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(() => (db.cerrar ? db.cerrar() : null));
