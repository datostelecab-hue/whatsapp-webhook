// ============================================================
// LA COMUNICACIÓN SEMANAL DE HORAS — la puerta (db/294, 25/11/2026)
// ============================================================
// Cada MARTES a las 09:00, la semana pasada (de lunes a domingo): a cada
// persona de plantilla propia que no llegó a sus horas, su carta entra en la
// cola de Firmas («Comunicación al trabajador», plantilla de YouTrust, sin SMS,
// por correo). Camilo: «cada martes, para que tráfico también pueda mandar
// solicitudes de justificantes y se aprueben». La cuenta, en ./comunicaciones.js.
//
// Diana las revisa en Firmas (una tarjeta por semana, que se cierra sola al no
// quedar ninguna por aprobar) y las aprueba; las manda Claude desde la
// plantilla. Sin email, se dice: «Falta el email del conductor».
'use strict';

const cuenta = require('./comunicaciones');
const repo = require('./comunicaciones.repo');
const firmasRepo = require('./firmas.repo');
const bitacora = require('../Operaciones/bitacora.service');
const libro = require('../../services/libro');
const calendario = require('../../services/calendario');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const tareasProgramadas = require('../../services/tareasProgramadas');

const T_SEMANA = 'comunicaciones_semana';
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const SIN_EMAIL = 'Falta el email del conductor: ponlo en su ficha (Plantilla) para poder mandársela.';

tablero.registrarTipo(T_SEMANA, { etiqueta: 'Comunicaciones de horas', abrir: 'Revisarlas en Firmas', cierreManual: false });

/**
 * Las cartas de una semana, sin guardar nada: quién debe horas y cuáles.
 * `dias`: para probarlo (Map de la bitácora); si no, se piden a la bitácora.
 * → [{ conductorId, alta, baja, jornadaHoras, objetivo, horas, debe, lineas }]
 */
async function calcularSemana(lunes, { dias = null } = {}) {
  const { domingo } = cuenta.semanaDe(lunes);
  const [contratos, justif, porDia] = await Promise.all([
    repo.propiaEnSemana(lunes, domingo), repo.justificadas(lunes, domingo),
    dias ? Promise.resolve(dias) : bitacora.diasDe({ desde: lunes, hasta: domingo }),
  ]);
  const out = [];
  const vistos = new Set();
  for (const k of contratos) {
    if (vistos.has(k.conductor_id)) continue;   // dos contratos propios en la semana: el primero (casi nunca)
    vistos.add(k.conductor_id);
    const c = cuenta.calcular({ dias: porDia.get(k.conductor_id) || [], jornadaHoras: k.jornada_horas, alta: k.alta, baja: k.baja,
      justificadas: justif.get(k.conductor_id) || new Set() });
    if (c.debe > 0) out.push({ conductorId: k.conductor_id, alta: k.alta, baja: k.baja, jornadaHoras: k.jornada_horas, ...c });
  }
  return out;
}

/**
 * PREPARA LAS CARTAS de la semana de `lunes`: cada una, un envío por aprobar
 * en Firmas (una por persona y semana: repetirlo no duplica). → { nuevas, yaEstaban }
 */
async function prepararSemana(lunes, { cli = null, dias = null } = {}) {
  const { domingo } = cuenta.semanaDe(lunes);
  if (lunes !== cuenta.semanaDe(lunes).lunes) throw new Error('La semana empieza en lunes');
  const cartas = await calcularSemana(lunes, { dias });
  const bot = await firmasRepo.bot();
  const hacer = async c => {
    let nuevas = 0, yaEstaban = 0;
    for (const x of cartas) {
      if (await firmasRepo.deOrigen(c, 'semana', `${lunes}|${x.conductorId}`)) { yaEstaban++; continue; }
      const firmante = await firmasRepo.firmanteDe(Number(x.conductorId), c);
      await firmasRepo.insertar(c, {
        tipo: 'comunicacion', origen: 'semana', origenId: `${lunes}|${x.conductorId}`, conductorId: Number(x.conductorId),
        titulo: `Comunicación de horas: semana del ${dm(lunes)} al ${dm(domingo)}`,
        firmante, creadoPor: bot,
        detalle: { semana: { desde: lunes, hasta: domingo }, jornada: x.jornadaHoras || 40, objetivo: x.objetivo, horas: x.horas,
          debe: x.debe, lineas: x.lineas, ...cuenta.textos(x) },
        nota: firmante && firmante.email ? null : SIN_EMAIL,
      });
      nuevas++;
    }
    if (nuevas) await tarjetaDeLaSemana(c, lunes, domingo);
    return { nuevas, yaEstaban, cartas: cartas.length };
  };
  const firma = { usuarioId: bot, origen: 'comunicaciones de horas', accion: 'alta', motivo: `Las de la semana del ${dm(lunes)} al ${dm(domingo)}` };
  return cli ? libro.firmar(cli, firma).then(() => hacer(cli)) : libro.conFirma(firma, hacer);
}

async function tarjetaDeLaSemana(cli, lunes, domingo) {
  const n = await repo.porAprobarDe(cli, lunes);
  if (!n) return;
  const titulares = await organizacion.quienes('firmas_aprobar', { conSuplentes: false }).catch(() => []);
  const titulo = `Revisar ${n} ${n === 1 ? 'comunicación' : 'comunicaciones'} de horas (semana del ${dm(lunes)} al ${dm(domingo)})`;
  const t = await tablero.nacer(cli, {
    tipo: T_SEMANA, origenId: lunes, enlace: '/firmas', sensible: true, titulo,
    descripcion: 'Quien no llegó a las horas de su contrato la semana pasada. Revisa cada una en Firmas (sus días y lo que debe) y apruébala o descártala; las aprobadas se mandan desde la plantilla de YouTrust, por correo y sin SMS.',
    responsableId: titulares.length ? titulares[0].id : null, plazoDias: 1,
  });
  if (!t.nueva) await tablero.ajustarPorOrigen(cli, { tipo: T_SEMANA, origenId: lunes, titulo });
}

/** Si ya no queda ninguna de esa semana por aprobar, su tarjeta se cierra. */
async function cerrarSiHecha(cli, origenId, autorId = null) {
  const lunes = String(origenId || '').split('|')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lunes)) return;
  if (await repo.porAprobarDe(cli, lunes)) return;
  await tablero.cerrarPorOrigen(cli, { tipo: T_SEMANA, origenId: lunes, autorId, nota: 'Revisadas todas las de la semana' });
}

// Cada martes a las 09:00, la semana pasada (de lunes a domingo).
tareasProgramadas.registrar({
  clave: 'comunicaciones.semana',
  descripcion: 'Cada martes a las 09:00, las comunicaciones de horas de la semana pasada (a la cola de Firmas)',
  desde: '2026-12-01',
  toca: ahora => tareasProgramadas.cuando.semanal(ahora, { dia: 2, hora: '09:00' }),
  hacer: ({ periodo, cli }) => prepararSemana(calendario.sumarDias(periodo, -8), { cli }),
});

module.exports = { calcularSemana, prepararSemana, cerrarSiHecha, SIN_EMAIL };
