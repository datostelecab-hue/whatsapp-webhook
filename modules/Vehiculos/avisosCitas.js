// ============================================================
// LAS CITAS DEL TALLER AVISAN A CONTROL — el primer aviso entre módulos (ítem 3)
// ============================================================
// La hoja de ruta lo pone de ejemplo: un coche con salida programada al taller
// es algo que Control tiene que saber. Cada cita PENDIENTE de un coche de
// Madrid (las de Barcelona son solo agenda) es un aviso al área Control, con su
// número en la entrada «Mantenimientos» del menú (módulo taller), hasta que:
//
//   · Control llama y apunta lo que dijo el conductor (/control/citas-taller),
//   · el conductor la confirma por WhatsApp,
//   · la cita cambia de estado (hecha, no se presentó, anulada),
//   · o pasa su hora: caduca.
//
// Se repasa solo (services/avisos.js → sincronizar): citas.service lo pide tras
// importar el Excel, poner una a mano, apuntar una llamada, cambiar el estado o
// recibir la respuesta del conductor; y hay un repaso cada día.
'use strict';

const db = require('../../services/db');
const avisos = require('../../services/avisos');

const TIPO = 'cita_taller';
const ESTADO = { hecha: 'hecha', no_presentado: 'no se presentó', anulada: 'anulada' };
const fechaLarga = iso => require('./citas.service').fechaLarga(iso);

avisos.registrarTipo(TIPO, {
  etiqueta: 'Cita del taller',
  modulo: 'taller',
  icono: 'fa-screwdriver-wrench',
  area: 'control',
  async abiertos() {
    const r = await db.consulta(
      `SELECT c.id::text AS id, c.matricula, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.hora, 'HH24:MI') AS hora,
              ((c.fecha + c.hora) AT TIME ZONE 'Europe/Madrid') AS caduca
         FROM taller_cita c
         JOIN vehiculo v ON v.id = c.vehiculo_id
        WHERE c.estado = 'pendiente'
          AND COALESCE(v.sede, 'madrid') = 'madrid'
          AND (c.fecha + c.hora) AT TIME ZONE 'Europe/Madrid' > now()
          AND c.confirmacion IS DISTINCT FROM 'confirmada'
          AND NOT EXISTS (SELECT 1 FROM taller_cita_seguimiento s WHERE s.cita_id = c.id AND s.tipo = 'llamada')
        ORDER BY c.fecha, c.hora
        LIMIT 500`);
    return r.rows.map(c => ({
      origenId: c.id,
      titulo: `Cita del taller: ${c.matricula}`,
      texto: `El ${fechaLarga(c.fecha)} a las ${c.hora}. Llama a quien lleve el coche para confirmarla.`,
      enlace: '/control/citas-taller',
      caducaAt: c.caduca,
    }));
  },
  async comoAcabaron(ids) {
    const r = await db.consulta(
      `SELECT c.id::text AS id, c.estado, c.confirmacion,
              ((c.fecha + c.hora) AT TIME ZONE 'Europe/Madrid') <= now() AS paso,
              (SELECT s.usuario_id FROM taller_cita_seguimiento s
                WHERE s.cita_id = c.id AND s.tipo = 'llamada' ORDER BY s.creado_at DESC LIMIT 1) AS llamo,
              (SELECT s.usuario_id FROM taller_cita_seguimiento s
                WHERE s.cita_id = c.id AND s.tipo = 'estado' ORDER BY s.creado_at DESC LIMIT 1) AS cambio
         FROM taller_cita c WHERE c.id = ANY($1::bigint[])`, [ids.map(Number)]);
    const m = new Map();
    for (const c of r.rows) {
      if (c.estado !== 'pendiente') m.set(c.id, { estado: 'resuelto', nota: `La cita quedó ${ESTADO[c.estado] || c.estado}`, autorId: c.cambio ? Number(c.cambio) : null });
      else if (c.llamo) m.set(c.id, { estado: 'resuelto', nota: 'Control llamó y apuntó la respuesta', autorId: Number(c.llamo) });
      else if (c.confirmacion === 'confirmada') m.set(c.id, { estado: 'resuelto', nota: 'El conductor la confirmó' });
      else if (c.paso) m.set(c.id, { estado: 'caducado', nota: 'Pasó la hora de la cita' });
    }
    // La que ya no está (o pasó a ser de otra sede): ya no hay nada que avisar.
    for (const id of ids) if (!m.has(String(id))) m.set(String(id), { estado: 'anulado', nota: 'La cita ya no está' });
    return m;
  },
});

/** Lo pide citas.service tras cada cambio. Nunca lanza. */
const pedir = () => avisos.pedir(TIPO);

module.exports = { TIPO, pedir };
