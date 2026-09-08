// ============================================================
// CAMPAÑAS DE LLAMADAS — cada turno, en tres pasadas que ABREN y CIERRAN
// ============================================================
// Lo pidió Tráfico tal cual: el arranque de cada turno son TRES campañas de
// llamadas sobre la gente que no se ha conectado, cada una con su ventana:
//
//   TURNO DÍA                        TURNO NOCHE
//   · Campaña 1 · 10:00–11:00        · Campaña 1 · 18:00–19:00
//   · Campaña 2 · 11:00–12:00        · Campaña 2 · 19:00–20:00
//   · Campaña 3 · 12:00–fin (17:00)  · Campaña 3 · 20:00–fin (05:00)
//
//   · CAMPAÑA 1 — los que NO se han conectado y a los que aún no ha llamado
//     nadie. Se llama y se etiqueta con el buzón; el etiquetado sale de la cola.
//   · CAMPAÑA 2 — los ETIQUETADOS en la primera, con el RESPONSABLE que los
//     etiquetó, para insistir; los "?" a los que nadie llegó a llamar; y los
//     "confirma que sale ya" VERIFICADOS contra la actividad real.
//   · CAMPAÑA 3 — el repaso hasta que el turno termina: todo el que siga sin
//     conectarse, con su historia del día delante.
//
// Las ventanas ABREN Y CIERRAN, pero no bloquean botones: dicen cuál es la
// campaña activa y cuáles quedaron atrás. Si alguien quiere adelantar una
// llamada, es su criterio.
//
// Y las tres listas de consulta: ACTIVOS, JUSTIFICADOS (por sus cinco tipos) y
// la LISTA ROJA (sin conectar, cero horas, sin J).
//
// Aquí no se inventa ningún dato: todo sale del cockpit (enDirecto), de las
// llamadas (llamada_seguimiento) y de las J (justificante). Esta capa solo
// REPARTE en colas. Si el cockpit y las campañas dijeran cosas distintas, uno
// de los dos mentiría.

const { enDirecto } = require('../flotaViva/directo');
const llamadas = require('./llamadas');
const { TIPOS_J } = require('./justificantes');

// Las ventanas de cada turno. `cierra` de la 3 es el FIN DEL TURNO.
const VENTANAS = {
  dia:   [{ n: 1, abre: 10, cierra: 11 }, { n: 2, abre: 11, cierra: 12 }, { n: 3, abre: 12, cierra: 17 }],
  noche: [{ n: 1, abre: 18, cierra: 19 }, { n: 2, abre: 19, cierra: 20 }, { n: 3, abre: 20, cierra: 5 }],
};
const TEXTOS = {
  1: { titulo: 'Primera llamada', detalle: 'Los que no se han conectado y nadie ha llamado aún' },
  2: { titulo: 'Insistir', detalle: 'Los etiquetados en la primera, con su responsable, y los que quedaron sin llamar' },
  3: { titulo: 'Repaso', detalle: 'Hasta el fin del turno: todo el que siga sin conectarse, con su historia del día' },
};

const horaMadrid = () => Number(new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date())) % 24;

/**
 * El estado de una campaña a una hora dada: 'pronto', 'abierta' o 'terminada'.
 *
 * Se calcula en "horas de turno" (cuánto llevamos desde que ese turno arrancó:
 * 05:00 el día, 17:00 la noche), que es lo que endereza a la noche cuando cruza
 * la medianoche: las 02:00 son la hora 9 de su turno, no la 2.
 *
 * Fuera del turno, cada uno cae hacia su lado de la jornada (05→05): el DÍA va
 * primero —a las 20:00 sus campañas ya son cosa terminada— y la NOCHE va
 * después —a las 10:00 la suya todavía no ha llegado.
 */
function estadoVentana(h, turno, v) {
  const ini = turno === 'noche' ? 17 : 5;
  const rel = x => (x - ini + 24) % 24;
  const hr = rel(h);
  if (hr >= 12) return turno === 'noche' ? 'pronto' : 'terminada';   // fuera del turno
  if (hr < rel(v.abre)) return 'pronto';
  if (hr < rel(v.cierra)) return 'abierta';
  return 'terminada';
}

// El resultado que significa "dice que ya sale": es el único que se verifica
// contra la realidad en la campaña 2. El texto histórico se respeta.
const DICE_QUE_SALE = r => /confirma que sale|ya se conecta/i.test(r || '');
const NO_ASISTE = r => /no asistir/i.test(r || '');

/**
 * ¿Se ha conectado hoy? Con actividad en su turno o conectado ahora mismo, sí.
 * 'salio' es quien trabajó en su ventana y ya no está: SE CONECTÓ; su problema
 * (irse antes de hora) es de la alerta del cockpit, no de aquí.
 */
function seConecto(f) {
  const a = f.actividad || {};
  return f.salida === 'conectado' || f.salida === 'descanso' || f.salida === 'salio'
    || Number(a.minutos) > 0 || !!a.conectado;
}

/**
 * El estado de las campañas de un turno ('dia' incluye a los TodoTurno; los
 * de noche tienen las suyas por la tarde). Sin `turno`, el del reloj: hasta las
 * 17:00 el día, desde las 17:00 (y de madrugada) la noche.
 *
 * `ahora` es solo para las pruebas: deja fijar la hora sin esperar a que sea.
 */
async function estado({ dia, turno, ahora } = {}) {
  const h = Number.isInteger(ahora) ? ahora : horaMadrid();
  const t = turno === 'noche' || turno === 'dia' ? turno : (h >= 17 || h < 5 ? 'noche' : 'dia');
  const hoy = (dia && String(dia).slice(0, 10)) || llamadas.diaOperativoHoy();

  const [directo, llam, justs] = await Promise.all([
    enDirecto({ dia: hoy }),
    llamadas.resumenHoy(hoy).catch(() => ({})),
    llamadas.justificadosHoy(hoy).catch(() => ({})),
  ]);

  // El directo reparte por turno. Al DÍA van también los TodoTurno (a las 10:00
  // deberían estar rodando); la noche va sola, que a los TodoTurno ya se les
  // persiguió por la mañana. Sin conductorId no hay a quién llamar (NN aparte).
  const pt = directo.porTurno || {};
  const filas = (t === 'noche' ? (pt.noche || []) : [...(pt.dia || []), ...(pt.todoturno || [])])
    .filter(f => f.conductorId);

  const gente = filas.map(f => {
    const ll = llam[String(f.conductorId)] || null;
    const j = justs[String(f.conductorId)] || null;
    const u = (ll && ll.ultima) || {};
    const conectado = seConecto(f);
    return {
      conductorId: String(f.conductorId),
      conductor: f.conductor,
      telefono: f.telefono || '',
      matricula: f.trazoMat || (f.matriculas || [])[0] || '',
      turno: f.turno,
      rendimiento: f.rendimiento || null,
      minutos: Number((f.actividad || {}).minutos) || 0,
      conectado,
      // 'pendiente' = su turno aún no ha empezado. No se le persigue por no
      // haberse conectado a un turno que no ha arrancado.
      leToca: f.salida !== 'pendiente',
      llamadas: ll ? ll.n : 0,
      etiqueta: u.resultado || '',
      etiquetadoPor: u.quien || '',
      etiquetadoA: u.at || null,
      nota: u.nota || '',
      verificacion: DICE_QUE_SALE(u.resultado) ? (conectado ? 'cumplio' : 'sigue_sin') : null,
      j: j ? { horas: j.horas, obs: j.obs, quien: j.quien, tipo: j.tipo || 'trafico' } : null,
      noAsiste: NO_ASISTE(u.resultado),
    };
  });

  // ── Las colas ──────────────────────────────────────────────────────────
  // Fuera quedan los conectados, los justificados, los "no asistirá" (ya se
  // sabe qué pasa con ellos) y los que aún no les toca salir.
  const pendientes = gente.filter(p => p.leToca && !p.conectado && !p.j && !p.noAsiste);

  const c1 = pendientes.filter(p => !p.etiqueta);
  const c2 = {
    etiquetados: pendientes.filter(p => p.etiqueta),
    interrogacion: pendientes.filter(p => !p.etiqueta),
    cumplieron: gente.filter(p => p.conectado && p.verificacion === 'cumplio'),
  };
  const c3 = pendientes;

  // ── Las listas de consulta ─────────────────────────────────────────────
  const activos = gente.filter(p => p.conectado).sort((a, b) => b.minutos - a.minutos);
  const porTipo = {};
  TIPOS_J.forEach(x => { porTipo[x.codigo] = []; });
  gente.filter(p => p.j).forEach(p => {
    (porTipo[p.j.tipo] || (porTipo[p.j.tipo] = [])).push(p);
  });
  const listaRoja = gente.filter(p => p.leToca && !p.conectado && p.minutos === 0 && !p.j)
    .sort((a, b) => (b.llamadas - a.llamadas) || a.conductor.localeCompare(b.conductor));

  const campanas = VENTANAS[t].map(v => ({
    ...v, ...TEXTOS[v.n],
    estado: estadoVentana(h, t, v),
  }));
  const abierta = campanas.find(c => c.estado === 'abierta');

  return {
    dia: hoy,
    hora: h,
    turno: t,
    // El turno que toca por reloj, para que la pantalla marque la pestaña.
    turnoDelReloj: h >= 17 || h < 5 ? 'noche' : 'dia',
    campanaActiva: abierta ? abierta.n : 0,
    campanas,
    resultados: llamadas.RESULTADOS,
    tiposJ: TIPOS_J,
    resumen: {
      plan: gente.length,
      activos: activos.length,
      pendientes: pendientes.length,
      sinLlamar: c1.length,
      justificados: gente.filter(p => p.j).length,
      listaRoja: listaRoja.length,
      noAsisten: gente.filter(p => p.noAsiste && !p.conectado).length,
      // Cuántos aún no arrancan (el turno no ha empezado para ellos): explica
      // por qué el plan no cuadra con activos + pendientes.
      aunNoLesToca: gente.filter(p => !p.leToca && !p.conectado && !p.j).length,
    },
    c1, c2, c3,
    activos,
    justificados: porTipo,
    listaRoja,
    noAsisten: gente.filter(p => p.noAsiste && !p.conectado),
  };
}

module.exports = { estado, VENTANAS, estadoVentana };
