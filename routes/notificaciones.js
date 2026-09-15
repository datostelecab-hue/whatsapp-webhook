const express = require('express');
const router = express.Router();
const seleccion = require('../modules/Seleccion/seleccion.service');
const { leerTablero, ESTADO_PENDIENTE } = require('../services/planificadorV2');
const { leerVacantesGuardadas } = require('../services/vacantes');
const repoInc = require('../services/repo/incorporaciones');
const ticketera = require('../modules/Ticketera/ticketera.service');

// El tablero es caro de recalcular, así que se cachea un minuto: aunque cada
// página pida las notificaciones al cargar, solo se recalcula una vez por minuto.
let cache = null, cacheTs = 0;
const TTL = 60 * 1000;

async function calcular() {
  const [tramo, tablero, vacantesAll, ticketsItLista, incPend] = await Promise.all([
    seleccion.tramoFinal().catch(() => ({ porTramitar: [], pendientePin: [], hechas: [], noAlta: [] })),
    leerTablero().catch(() => null),
    leerVacantesGuardadas().catch(() => []),
    ticketera.datos('IT', { cerrados: false }).then(r => r.tickets).catch(() => []),
    repoInc.pendientes().catch(() => [])
  ]);

  // Tickets IT sin resolver: son los pendientes del desarrollador.
  // Ya vienen solo los abiertos: la bandeja los filtra por `cierra` del
  // catálogo, no por una lista de estados escrita aquí que habría que ampliar
  // cada vez que se añada uno.
  const itAbiertos = ticketsItLista || [];

  // Del tramo final de Selección, ya en PostgreSQL. Los estados salen del
  // catálogo y no de una lista escrita aquí.
  const rechazadosRRHH = tramo.noAlta.filter(c => c.estado === 'rechazado_rrhh');
  const porTramitar = tramo.porTramitar;
  const pendientesPin = tramo.pendientePin;
  // Incorporaciones pendientes (PostgreSQL): altas con vacante esperando que
  // Tráfico las acepte o rechace EN EL PLANIFICADOR. La alerta no se va sola.
  const incorporaciones = incPend;
  const incIds = new Set();
  // Pendientes de asignar coche/turno, EXCLUYENDO las incorporaciones (esas salen aparte).
  const pendienteAsignar = ((tablero && tablero.conductores) || [])
    .filter(c => c.estadoCalculado === ESTADO_PENDIENTE && !incIds.has((c.idBolt || '').trim()));
  // Vacantes abiertas que Selección debe reclutar.
  // "Por reclutar" = solo las disponibles (excluye En proceso de alta / Cerrada / Cubierta).
  const vacantesAbiertas = (vacantesAll || []).filter(v =>
    v.estado !== 'Cerrada' && v.estado !== 'Cubierta' && v.estado !== 'En proceso de alta');

  return {
    // Reclutador (Selección): vacantes abiertas por llenar + fichas que RRHH
    // devolvió. Cada enlace abre directamente lo que hay que resolver.
    reclutador: {
      total: vacantesAbiertas.length + rechazadosRRHH.length,
      items: [
        ...vacantesAbiertas.map(v => ({
          texto: `Vacante por reclutar: ${v.puesto || 'CT'}${v.zonas ? ' · ' + v.zonas : ''}`,
          detalle: v.libranzas ? `Libra: ${v.libranzas}` : '', href: '/vacantes'
        })),
        ...rechazadosRRHH.map(c => ({
          texto: `${c.quien} — devuelto por RRHH`,
          detalle: c.motivo || '', href: `/seleccion?tel=${encodeURIComponent(c.telefono || '')}`
        }))
      ]
    },
    // RRHH: aprobados en BOLT esperando el alta + fichas en Administración
    // esperando el PIN de Ballenoil (último paso).
    // (Las peticiones de Tráfico ya no están: ese circuito se borró el 15/09/2026.
    //  Quien puede tocar la Plantilla cambia la situación en la ficha.)
    rrhh: {
      total: porTramitar.length + pendientesPin.length,
      items: [
        ...porTramitar.map(c => ({
          texto: `${c.quien} — listo para RRHH`,
          detalle: c.excelAlta ? `Excel ${c.excelAlta}` : 'aún sin Excel de altas',
          href: `/rrhh?tel=${encodeURIComponent(c.telefono || '')}`
        })),
        ...pendientesPin.map(c => ({
          texto: `${c.quien} — pendiente del PIN de Ballenoil`,
          detalle: 'Administración', href: `/administracion?tel=${encodeURIComponent(c.telefono || '')}`
        }))
      ]
    },
    // Tráfico: incorporaciones recién llegadas (por aceptar/asignar) + los que
    // esperan coche/turno en el planificador.
    trafico: {
      total: incorporaciones.length + pendienteAsignar.length,
      items: [
        ...incorporaciones.map(i => ({
          texto: `${i.nombre} — incorporación por aceptar o rechazar`,
          detalle: [((i.detalle || {}).puesto || ''), ((i.detalle || {}).zonas || '')].filter(Boolean).join(' · '),
          href: '/planificador'
        })),
        ...pendienteAsignar.map(c => ({
          texto: `${c.nombre || c.id} — pendiente de asignar coche/turno`,
          detalle: c.turno ? `Turno: ${c.turno}` : '', href: '/planificador'
        }))
      ]
    },
    // Soporte IT (solo el desarrollador): tickets abiertos que la gente ha reportado.
    soporte: {
      total: itAbiertos.length,
      items: itAbiertos.map(t => ({
        texto: t.gestion || t.codigo,
        detalle: `${t.subtipo || ''}${t.prioridad ? ' · ' + t.prioridad : ''}${t.quien ? ' · ' + t.quien : ''}`,
        href: '/tickets-telecab'
      }))
    }
  };
}

// Qué departamentos ve cada rol (defensa en profundidad: además del filtro del
// cliente, el servidor solo devuelve lo que a ese rol le corresponde).
const DEPS_ROL = {
  superadmin: ['reclutador', 'rrhh', 'trafico'],
  desarrollador: ['soporte'],   // sus pendientes son los tickets IT
  oficina: ['reclutador', 'rrhh'],
  trafico: ['trafico']
};

router.get('/', async (req, res) => {
  try {
    if (!cache || Date.now() - cacheTs > TTL) { cache = await calcular(); cacheTs = Date.now(); }
    const permitidos = DEPS_ROL[req.usuario && req.usuario.rol] || [];
    const salida = {};
    permitidos.forEach(k => { if (cache[k]) salida[k] = cache[k]; });
    res.json({ status: 'ok', ...salida });
  } catch (error) {
    console.error('❌ [Notificaciones]:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
