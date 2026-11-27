// ============================================================
// LOS PENDIENTES DE NÓMINA DEL DÍA 20 (ítem 7 de la hoja de ruta, 27/11/2026)
// ============================================================
// El documento: el día 20 (si no es hábil, el hábil anterior) salen los
// pendientes que hay que resolver antes del corte del 25. Lo que decidió
// Camilo el 27/11/2026:
//
//   · QUÉ SALE, de la nómina del mes (del 26 al 25):
//       - Las AUSENCIAS SIN VALIDAR del periodo (/ausencias): a quien tiene
//         «Revisa las ausencias de cada día». Se cierra sola al quedar en cero.
//       - Las HORAS SIN JUSTIFICAR: quien va por debajo de su objetivo sin
//         explicación en /nominas. Las horas van a mes vencido, así que son las
//         del mes que cobra esta nómina, ya cerrado el día 20. A quien tiene
//         «Lleva la nómina». Se cierra a mano.
//       - Las BAJAS CON PARTE POR COMPROBAR: abiertas, con el fin previsto
//         pasado o sin fecha prevista. A quien revisa las ausencias. Se cierra
//         sola cuando no queda ninguna.
//   · CÓMO: UNA TARJETA POR TIPO con su número (no una por pendiente: serían
//     decenas el mismo día), y UN AVISO con el resumen a quien lleva la nómina.
//   · Cada mañana se repasan: la que llega a cero se cierra; la que no, cambia
//     su número en el título.
'use strict';

const db = require('../../services/db');
const tablero = require('../../services/tablero');
const avisos = require('../../services/avisos');
const organizacion = require('../../services/organizacion');
const calendario = require('../../services/calendario');
const parametros = require('../../services/parametros');
const tareasProgramadas = require('../../services/tareasProgramadas');
const libro = require('../../services/libro');

const TARJETA = 'nomina_pendientes';
const AVISO = 'nomina_pendientes';
const DESDE = '2026-11-27';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

tablero.registrarTipo(TARJETA, { etiqueta: 'Pendientes de la nómina', abrir: 'Abrir' });
avisos.registrarTipo(AVISO, { etiqueta: 'Pendientes de la nómina del día 20', modulo: 'nominas', icono: 'fa-file-invoice-dollar' });

const titular = async codigo => ((await organizacion.quienes(codigo, { conSuplentes: false }).catch(() => []))[0] || {}).id || null;
const pad = n => String(n).padStart(2, '0');

/** El periodo de la nómina de un mes ('AAAA-MM'): del 26 del mes anterior al 25. */
async function ventanaDe(periodo) {
  const corte = Number(await parametros.valor('nomina.dia_corte').catch(() => 25)) || 25;
  const [y, m] = periodo.split('-').map(Number);
  const ant = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return { desde: `${ant.y}-${pad(ant.m)}-${pad(corte + 1)}`, hasta: `${y}-${pad(m)}-${pad(corte)}`, mes: MESES[m - 1], y, m };
}

// ── Cada tipo: cuántos hay, a quién y adónde lleva ─────────────────────────
const TIPOS = {
  ausencias: {
    funcion: 'ausencias_validar', enlace: '/ausencias', sola: true,
    titulo: (n, v) => `Nómina de ${v.mes}: ${n} ${n === 1 ? 'ausencia' : 'ausencias'} sin validar`,
    texto: 'Las ausencias del periodo de la nómina que siguen sin decidir: hasta que se validen no se sabe si son absentismo. Se cierra sola al quedar en cero.',
    async contar(cli, v, hoy) {
      const hasta = hoy < v.hasta ? calendario.sumarDias(hoy, -1) : v.hasta;
      try {
        return (await cli.query(`SELECT count(*)::int AS n FROM ausencia_rrhh WHERE estado = 'pendiente' AND dia BETWEEN $1::date AND $2::date`,
          [v.desde, hasta])).rows[0].n;
      } catch (e) { if (e.code === '42P01') return 0; throw e; }
    },
  },
  bajas: {
    funcion: 'ausencias_validar', enlace: '/ausencias?vista=bajas', sola: true,
    titulo: (n, v) => `Nómina de ${v.mes}: ${n} ${n === 1 ? 'baja médica' : 'bajas médicas'} con el parte por comprobar`,
    texto: 'Bajas abiertas en el periodo con el fin previsto ya pasado o sin fecha prevista: falta el parte de confirmación o el de alta. Se cierra sola cuando no queda ninguna.',
    async contar(cli, v, hoy) {
      try {
        return (await cli.query(
          `SELECT count(*)::int AS n FROM conductor_estado_hist h
            WHERE h.estado = 'baja_medica' AND h.hasta IS NULL AND h.desde <= $1::date
              AND (h.hasta_previsto IS NULL OR h.hasta_previsto < $2::date)`, [v.hasta, hoy])).rows[0].n;
      } catch (e) { if (e.code === '42P01' || e.code === '42703') return 0; throw e; }
    },
  },
  horas: {
    funcion: 'nomina', enlace: '/nominas', sola: false,
    titulo: (n, v) => `Nómina de ${v.mes}: ${n} ${n === 1 ? 'persona' : 'personas'} con horas sin justificar`,
    texto: 'Van por debajo de su objetivo de horas sin explicación (las del mes que cobra esta nómina, a mes vencido). Mira en Nóminas si falta alguna J o si se les descuenta. Ciérrala cuando esté revisado.',
    async contar(cli, v) {
      const r = await require('../Nominas/nominas.service').calcular(v.m, v.y);
      return (r.filas || []).filter(f => f.horasNoJustificadas > 0).length;
    },
  },
};

/**
 * EL DÍA 20: una tarjeta por tipo con pendientes, y el aviso con el resumen.
 * Se puede repetir: lo que ya nació no nace otra vez.
 */
async function generar({ cli = null, periodo, hoy = calendario.hoy() } = {}) {
  const v = await ventanaDe(periodo);
  const hacer = async c => {
    const cal = await calendario.de('madrid');
    const plazo = hoy < v.hasta ? cal.diasHabilesEntre(hoy, v.hasta) : 0;
    await libro.firmar(c, { origen: 'nómina · día 20', accion: 'alta' });
    const cuentas = {};
    for (const [clave, t] of Object.entries(TIPOS)) {
      const n = await t.contar(c, v, hoy);
      cuentas[clave] = n;
      if (!n) continue;
      await tablero.nacer(c, { tipo: TARJETA, origenId: `${periodo}|${clave}`, enlace: t.enlace, titulo: t.titulo(n, v),
        descripcion: `${t.texto} El corte es el ${v.hasta.slice(8, 10)}/${v.hasta.slice(5, 7)}.`, responsableId: await titular(t.funcion), plazoDias: plazo });
    }
    const partes = [
      cuentas.ausencias ? `${cuentas.ausencias} ausencias sin validar` : '',
      cuentas.horas ? `${cuentas.horas} personas con horas sin justificar` : '',
      cuentas.bajas ? `${cuentas.bajas} bajas con el parte por comprobar` : '',
    ].filter(Boolean);
    const nomina = await titular('nomina');
    if (nomina) {
      await avisos.emitir({ tipo: AVISO, origenId: periodo, usuarioId: nomina, enlace: '/tablero',
        titulo: partes.length ? `Pendientes de la nómina de ${v.mes}: ${partes.join(', ')}` : `Nómina de ${v.mes}: no hay pendientes antes del corte`,
        texto: partes.length ? `Hay que resolverlos antes del corte del ${v.hasta.slice(8, 10)}/${v.hasta.slice(5, 7)}. Cada tipo tiene su tarjeta en el tablero.` : null }, { cli: c });
    }
    return { periodo, ...cuentas };
  };
  return cli ? hacer(cli) : db.transaccion(hacer);
}

/** CADA MAÑANA: la que llegó a cero se cierra; la que no, cambia su número. */
async function seguir({ cli = null, hoy = calendario.hoy() } = {}) {
  const hacer = async c => {
    const { fecha } = calendario.partesMadrid(new Date(`${hoy}T12:00:00Z`));
    const mes = fecha.slice(0, 7);
    const [y, m] = mes.split('-').map(Number);
    const siguiente = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
    let cerradas = 0, cambiadas = 0;
    for (const periodo of [mes, siguiente]) {
      const v = await ventanaDe(periodo);
      for (const [clave, t] of Object.entries(TIPOS)) {
        if (!t.sola) continue;
        const origenId = `${periodo}|${clave}`;
        const n = await t.contar(c, v, hoy);
        if (!n) { if (await tablero.cerrarPorOrigen(c, { tipo: TARJETA, origenId, nota: 'Ya no queda ninguno' })) cerradas++; }
        else if (await tablero.ajustarPorOrigen(c, { tipo: TARJETA, origenId, titulo: t.titulo(n, v) })) cambiadas++;
      }
    }
    return { cerradas, cambiadas };
  };
  return cli ? hacer(cli) : db.transaccion(hacer);
}

tareasProgramadas.registrar({
  clave: 'nomina.pendientes_dia20',
  descripcion: 'El día 20 (o el hábil anterior) a las 08:00: los pendientes de la nómina del mes, una tarjeta por tipo y un aviso a quien lleva la nómina',
  desde: DESDE,
  toca: ahora => tareasProgramadas.cuando.mensualHabil(ahora, { dia: 20, hora: '08:00' }),
  hacer: ({ cli, periodo }) => generar({ cli, periodo }),
});
tareasProgramadas.registrar({
  clave: 'nomina.pendientes_seguir',
  descripcion: 'Cada día a las 09:00: los pendientes de la nómina que llegan a cero se cierran; los demás cambian su número',
  desde: DESDE,
  toca: ahora => tareasProgramadas.cuando.diaria(ahora, { hora: '09:00' }),
  hacer: ({ cli, periodo }) => seguir({ cli, hoy: periodo }),
});

module.exports = { generar, seguir, ventanaDe, TIPOS, TARJETA, AVISO };
