// ============================================================
// WHATSAPP · LO QUE META DICE DE CADA MENSAJE QUE MANDAMOS
// ============================================================
// Meta contesta a un envío con el id del mensaje y ya está: eso NO quiere decir
// que haya llegado. Lo que pasa después —enviado, entregado, leído o FALLIDO— lo
// cuenta en otro aviso que llega al webhook (`value.statuses`). Hasta el
// 05/10/2026 el webhook lo tiraba, y con la cuenta bloqueada por un pago (error
// 131042) el ERP siguió dando por avisados a conductores que no recibieron nada:
// sus excesos de velocidad les bajaron la letra (calificación 2.1).
//
// Aquí:
//   · cada aviso de estado se apunta en `whatsapp_envio` (db/176), una fila por
//     mensaje, que avanza de estado y no retrocede;
//   · si el mensaje FALLÓ y era el aviso de un exceso de velocidad
//     (`velocidad_exceso.envio_id`), el exceso pasa de `avisado` a `error`: no
//     llegó, así que no cuenta para la letra.
//
// Nunca lanza: lo llama el webhook, y un fallo aquí no puede dejar al bot mudo.

const db = require('../db');

// Lo que manda Meta → lo que se guarda. El orden es el de la vida del mensaje:
// un «entregado» que llega después de un «leído» no lo devuelve atrás.
const ESTADO = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };
const RANGO = { enviado: 1, entregado: 2, leido: 3, fallido: 4 };

let avisadoSinTabla = false;
const tel = s => String(s == null ? '' : s).replace(/\D/g, '').slice(-9);

/** Apunta los avisos de estado de un webhook. Devuelve { apuntados, fallidos, excesos }. */
async function registrarEstados(statuses) {
  const res = { apuntados: 0, fallidos: 0, excesos: 0 };
  for (const s of statuses || []) {
    const estado = ESTADO[s && s.status];
    if (!estado || !s.id) continue;
    const err = (s.errors && s.errors[0]) || null;
    const cuando = Number(s.timestamp) > 0 ? new Date(Number(s.timestamp) * 1000) : new Date();
    const codigo = err && Number.isFinite(Number(err.code)) ? Number(err.code) : null;
    const texto = err ? [err.title, err.error_data && err.error_data.details].filter(Boolean).join(' · ').slice(0, 1000) || null
      : (estado === 'fallido' ? 'Meta no dio motivo' : null);

    if (estado === 'fallido') {
      res.fallidos++;
      console.error(`❌ [WhatsApp] Meta NO entregó un mensaje a …${tel(s.recipient_id).slice(-4)}: ` +
        `${codigo || '?'} ${(err && err.title) || 'sin motivo'}`);
      // EL AVISO DE VELOCIDAD QUE NO LLEGÓ, A ERROR. Va primero y aparte: no
      // depende de db/176, y es lo que mueve la letra de alguien.
      try {
        const r = await db.consulta(
          `UPDATE velocidad_exceso
              SET estado = 'error',
                  nota = btrim(COALESCE(nota, '') || ' WhatsApp no entregado (' || $2 || '), ' ||
                               to_char($3::timestamptz AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') ||
                               ': no cuenta para la letra.')
            WHERE envio_id = $1 AND estado = 'avisado'
            RETURNING clave`, [s.id, codigo ? `error ${codigo}` : 'sin código', cuando.toISOString()]);
        if (r.rowCount) {
          res.excesos += r.rowCount;
          console.error(`⚠️  [WhatsApp] El aviso de velocidad ${r.rows[0].clave} no llegó: pasa a «error» y no baja la letra`);
        }
      } catch (e) {
        console.error('⚠️  [WhatsApp] No se pudo marcar el exceso del mensaje fallido:', e.message);
      }
    }

    try {
      await db.consulta(
        `INSERT INTO whatsapp_envio (wamid, telefono, estado, estado_at, error_codigo, error_texto)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (wamid) DO UPDATE SET
           estado       = CASE WHEN $7 > CASE whatsapp_envio.estado WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2
                                                                   WHEN 'leido' THEN 3 ELSE 4 END
                               THEN EXCLUDED.estado ELSE whatsapp_envio.estado END,
           estado_at    = CASE WHEN $7 > CASE whatsapp_envio.estado WHEN 'enviado' THEN 1 WHEN 'entregado' THEN 2
                                                                   WHEN 'leido' THEN 3 ELSE 4 END
                               THEN EXCLUDED.estado_at ELSE whatsapp_envio.estado_at END,
           error_codigo = COALESCE(EXCLUDED.error_codigo, whatsapp_envio.error_codigo),
           error_texto  = COALESCE(EXCLUDED.error_texto, whatsapp_envio.error_texto)`,
        [s.id, s.recipient_id ? String(s.recipient_id).slice(0, 24) : null, estado, cuando.toISOString(),
         codigo, texto, RANGO[estado]]);
      res.apuntados++;
    } catch (e) {
      if (e.code === '42P01') {                         // db/176 sin aplicar
        if (!avisadoSinTabla) console.warn('⏸️  [WhatsApp] Los estados de Meta se apuntarán en cuanto esté db/176 (falta whatsapp_envio)');
        avisadoSinTabla = true;
      } else {
        console.error('⚠️  [WhatsApp] No se pudo apuntar el estado de un mensaje:', e.message);
      }
    }
  }
  return res;
}

module.exports = { registrarEstados };
