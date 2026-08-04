const express = require('express');
const router = express.Router();
const { leerTickets, ESTADOS, ETAPAS } = require('../services/tickets');
const { leerTablero, ESTADO_PENDIENTE } = require('../services/planificadorV2');
const { leerVacantesGuardadas } = require('../services/vacantes');
const { leerPeticiones } = require('../services/peticiones');
const ticketsIT = require('../services/ticketsIT');

// El tablero es caro de recalcular, así que se cachea un minuto: aunque cada
// página pida las notificaciones al cargar, solo se recalcula una vez por minuto.
let cache = null, cacheTs = 0;
const TTL = 60 * 1000;

async function calcular() {
  const [{ lista }, tablero, vacantesAll, peticiones, ticketsItLista] = await Promise.all([
    leerTickets(),
    leerTablero().catch(() => null),
    leerVacantesGuardadas().catch(() => []),
    leerPeticiones().then(r => r.lista).catch(() => []),
    ticketsIT.leerTickets().catch(() => [])
  ]);
  const L = lista || [];
  // Tickets IT sin resolver: son los pendientes del desarrollador.
  const itAbiertos = (ticketsItLista || []).filter(t => t.estado === 'Nuevo' || t.estado === 'En curso');

  const rechazadosRRHH = L.filter(t => t.estado === ESTADOS.RECHAZADO_RRHH);
  const porTramitar = L.filter(t => t.estado === ESTADOS.APROBADO_BOLT);
  const pendientesPin = L.filter(t => t.estado === ESTADOS.PENDIENTE_PIN);
  const petPendientes = (peticiones || []).filter(p => p.estado === 'Pendiente');
  // Incorporaciones recién llegadas a Tráfico (deciden Aceptar / Asignar manual).
  const incorporaciones = L.filter(t => t.etapa === ETAPAS.TRAFICO && t.estado === ESTADOS.ALTA);
  const incIds = new Set(incorporaciones.map(t => (t.id_bolt || '').trim()).filter(Boolean));
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
        ...rechazadosRRHH.map(t => ({
          texto: `${t.nombre || t.id} — devuelto por RRHH`,
          detalle: t.motivo || '', href: `/seleccion?tel=${encodeURIComponent(t.id)}`
        }))
      ]
    },
    // RRHH: aprobados en BOLT esperando el alta + peticiones de Tráfico por resolver
    // + fichas en Administración esperando el PIN de Ballenoil (último paso).
    rrhh: {
      total: porTramitar.length + petPendientes.length + pendientesPin.length,
      items: [
        ...petPendientes.map(p => ({
          texto: `Petición: ${p.tipo} de ${p.conductor || p.id_conductor}`,
          detalle: p.desde ? `${p.desde} → ${p.hasta}` : (p.motivo || ''), href: '/peticiones'
        })),
        ...porTramitar.map(t => ({
          texto: `${t.nombre || t.id} — aprobado en BOLT, pendiente de alta`,
          detalle: '', href: `/rrhh?tel=${encodeURIComponent(t.id)}`
        })),
        ...pendientesPin.map(t => ({
          texto: `${t.nombre || t.id} — pendiente de alta en Ballenoil`,
          detalle: 'Administración', href: `/administracion?tel=${encodeURIComponent(t.id)}`
        }))
      ]
    },
    // Tráfico: incorporaciones recién llegadas (por aceptar/asignar) + los que
    // esperan coche/turno en el planificador.
    trafico: {
      total: incorporaciones.length + pendienteAsignar.length,
      items: [
        ...incorporaciones.map(t => ({
          texto: `${t.id_bolt || t.nombre || t.id} — incorporación por asignar`,
          detalle: t.turno ? `Turno: ${t.turno}` : 'Llegó de Administración', href: '/incorporaciones'
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
        texto: t.titulo || t.id,
        detalle: `${t.tipo || ''}${t.prioridad ? ' · ' + t.prioridad : ''}${t.solicitante_nombre ? ' · ' + t.solicitante_nombre : ''}`,
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
