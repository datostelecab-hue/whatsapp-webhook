// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC — la puerta (módulo 5, 25/11/2026)
// ============================================================
// Por conductor y rango de fechas, desde su ficha: los datos (la cuenta, en
// informeJornada.js), el PDF y el Excel. Con su trazabilidad: de dónde sale
// cada dato, con qué regla, quién lo emitió y cuándo, y una huella (sha256) de
// las cifras para poder decir, si alguien lo discute, que no se ha tocado.
// Cada emisión queda en el libro de auditoría (en la ficha de la persona).
'use strict';

const crypto = require('crypto');
const repo = require('./informeJornada.repo');
const informe = require('./informeJornada');
const calendario = require('../../services/calendario');
const libro = require('../../services/libro');
const permisos = require('../../services/permisos');

const CLAVE = '/informe-jornada';
const TOTAL = ['superadmin', 'desarrollador'];
// Desde cuándo guarda el ERP los tramos de BOLT de cada conductor (Flota viva).
const DESDE_DATOS = '2026-07-01';
const MAX_DIAS = 400;

const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

async function puede(quien) {
  if (!quien || !quien.usuarioId) return false;
  if (TOTAL.includes(quien.rol)) return true;
  try { return (await permisos.clavesDe(quien.usuarioId)).has(CLAVE); } catch (_) { return false; }
}

/** El rango pedido, comprobado. */
function rango({ desde, hasta } = {}) {
  const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  if (!ok(desde) || !ok(hasta)) throw error('Elige el día de inicio y el de fin');
  if (hasta < desde) throw error('El día de fin es anterior al de inicio');
  if (desde < DESDE_DATOS) {
    throw error(`El ERP guarda los estados de BOLT de cada conductor desde el ${dmy(DESDE_DATOS)}. Lo anterior se saca del informe mensual de BOLT, como en las demandas.`);
  }
  if (hasta > calendario.hoy()) throw error('El día de fin no puede ser posterior a hoy');
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;
  if (dias > MAX_DIAS) throw error(`Como mucho ${MAX_DIAS} días por informe`);
  return { desde, hasta };
}

/**
 * LOS DATOS DEL INFORME de una persona en un rango. Apunta la emisión en el
 * libro. → { persona, rango, calculo, regla, hayZonas, emitido, huella, fuente }
 */
async function datos(conductorId, consulta = {}, quien = {}) {
  if (!await puede(quien)) throw error('Los informes de jornada son de RR. HH. y legal', 403);
  const { desde, hasta } = rango(consulta);
  const p = await repo.persona(conductorId);
  if (!p) throw error('No existe esa ficha', 404);

  const ini = informe.medianoche(desde), fin = informe.medianoche(calendario.sumarDias(hasta, 1));
  const tramos = await repo.tramos(p.cuentas, ini, fin);
  // La espera, ¿dentro del área? Con la misma función que el motor del convenio (f_en_area, zonas de Mapon).
  const esperas = tramos.filter(t => t.situacion === 'espera');
  if (esperas.length) {
    const staging = require('../../services/repo/staging');
    const dentro = await staging.enAreaVarios(esperas.map(t => ({ veh: t.veh, t: Math.floor(t.desdeMs / 1000) })));
    esperas.forEach((t, i) => { t.enArea = !!dentro.get(i); });
  }
  const calculo = informe.calcular({ tramos, desde, hasta });
  const [regla, hayZonas, por] = await Promise.all([repo.regla(), repo.hayZonas(), repo.usuarioNombre(quien.usuarioId)]);
  const emitido = { cuando: new Date().toISOString(), por: por || '' };
  // La huella de las cifras: el mismo informe de las mismas fechas da la misma huella.
  const huella = crypto.createHash('sha256').update(JSON.stringify({
    conductor: p.id, desde, hasta, dias: calculo.dias, sesiones: calculo.sesiones,
  })).digest('hex');

  await libro.apuntar({
    tabla: 'conductor', registro: p.id, accion: 'lectura', usuarioId: quien.usuarioId, origen: 'informe de jornada',
    motivo: `Informe de jornada del ${dmy(desde)} al ${dmy(hasta)}`, detalle: { desde, hasta, huella, formato: consulta.formato || null },
  });
  return {
    persona: p, rango: { desde, hasta }, calculo, regla, hayZonas, emitido, huella,
    fuente: {
      datos: 'Estados de la plataforma BOLT (Fleet Integration Gateway, getFleetStateLogs) de las cuentas de BOLT de la persona, recogidos por el ERP cada 5 minutos y guardados tramo a tramo (Flota viva, tabla fv_tramo).',
      desde: DESDE_DATOS,
      area: 'Zonas de Mapon (GPS de cada coche): función f_en_area, la misma del motor del convenio.',
      tope: 'Un tramo que BOLT no cierra no cuenta sin fin: se corta cuando otro conductor coge el coche, cuando la persona aparece en otro coche o a las 12 horas.',
      dia: 'Día natural de Madrid (00:00 a 24:00); lo que cruza la medianoche se parte.',
    },
  };
}

module.exports = { datos, puede, rango, CLAVE, DESDE_DATOS };
