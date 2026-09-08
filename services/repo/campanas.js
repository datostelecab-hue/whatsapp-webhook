// ============================================================
// CAMPAÑAS DE LLAMADAS — el turno de día, en tres pasadas
// ============================================================
// Lo pidió Tráfico tal cual: la mañana del controlador son TRES campañas de
// llamadas sobre la gente que no se ha conectado, y cada una arranca a su hora.
//
//   · CAMPAÑA 1 (09:00) — todos los del turno de día que NO se han conectado y
//     a los que aún no ha llamado nadie. Se llama y se etiqueta con el buzón de
//     resultados (Buzón, No contesta, Incidencia, Número erróneo, No
//     contactado, Confirma que sale ya...). El etiquetado sale de la cola.
//
//   · CAMPAÑA 2 (11:00) — los ETIQUETADOS en la primera, con el RESPONSABLE que
//     los etiquetó y su resultado, para insistir; y los "?" a los que nadie
//     llegó a llamar. A los "confirma que sale ya" no se les cree por la
//     palabra: se VERIFICA contra la actividad real (✓ se conectó / ✗ sigue sin
//     conectarse).
//
//   · CAMPAÑA 3 (12:00) — el repaso: todo el que SIGA sin conectarse, tenga la
//     etiqueta que tenga, con su historia del día delante.
//
// Y las tres listas de consulta, siempre a mano: ACTIVOS (ya conectados),
// JUSTIFICADOS (las J del día, por sus cinco tipos) y la LISTA ROJA (sin
// conectar, cero horas y sin J: el núcleo duro del día).
//
// Aquí no se inventa ningún dato: todo sale del cockpit (enDirecto), de las
// llamadas (llamada_seguimiento) y de las J (justificante). Esta capa solo
// REPARTE en colas. Si el cockpit y las campañas dijeran cosas distintas, uno
// de los dos mentiría.

const { enDirecto } = require('../flotaViva/directo');
const llamadas = require('./llamadas');
const { TIPOS_J } = require('./justificantes');

// A qué hora abre cada campaña (hora de Madrid). No se bloquea nada antes de la
// hora —si alguien quiere adelantar una llamada a las 08:50, es su criterio—:
// la hora decide cuál se enseña como ACTIVA al entrar.
const CAMPANAS = [
  { n: 1, abre: 9,  titulo: 'Primera llamada',  detalle: 'Los que no se han conectado y nadie ha llamado aún' },
  { n: 2, abre: 11, titulo: 'Insistir',         detalle: 'Los etiquetados en la primera, con su responsable, y los que quedaron sin llamar' },
  { n: 3, abre: 12, titulo: 'Repaso',           detalle: 'Todo el que siga sin conectarse, con su historia del día' },
];

const horaMadrid = () => Number(new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date())) % 24;

// El resultado que significa "dice que ya sale": es el único que se verifica
// contra la realidad en la campaña 2. El texto viejo ("Confirma que sale ya" a
// secas o el histórico "Buzón / no contesta") se respeta al clasificar.
const DICE_QUE_SALE = r => /confirma que sale|ya se conecta/i.test(r || '');
const NO_ASISTE = r => /no asistir/i.test(r || '');

/**
 * ¿Se ha conectado hoy? Con actividad en su turno o conectado ahora mismo, sí.
 * Quien trabajó dos horas y se fue SE CONECTÓ: su problema es otro (la alerta
 * de "no termina su jornada" del cockpit), no esta campaña.
 */
function seConecto(f) {
  const a = f.actividad || {};
  // 'salio' es quien trabajó en su ventana y ya no está: SE CONECTÓ. Su
  // problema (irse antes de hora) es de la alerta del cockpit, no de aquí.
  return f.salida === 'conectado' || f.salida === 'descanso' || f.salida === 'salio'
    || Number(a.minutos) > 0 || !!a.conectado;
}

/**
 * El estado de las campañas de HOY (o del día que se pida).
 *
 * SOLO el turno de DÍA (y los TodoTurno, que a las 09:00 también deberían estar
 * rodando): las horas 09/11/12 son de la mañana. La noche tiene su propia
 * vigilancia en el cockpit.
 */
async function estado({ dia } = {}) {
  const hoy = (dia && String(dia).slice(0, 10)) || llamadas.diaOperativoHoy();
  const [directo, llam, justs] = await Promise.all([
    enDirecto({ dia: hoy }),
    llamadas.resumenHoy(hoy).catch(() => ({})),
    llamadas.justificadosHoy(hoy).catch(() => ({})),
  ]);

  // El directo reparte por turno; a las campañas de la mañana van los de DÍA y
  // los TodoTurno. Sin conductorId no hay a quién llamar (los NN van aparte).
  const pt = directo.porTurno || {};
  const filas = [...(pt.dia || []), ...(pt.todoturno || [])]
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
      // El coche con el que rueda si ya rueda; si no, el del plan.
      matricula: f.trazoMat || (f.matriculas || [])[0] || '',
      turno: f.turno,
      rendimiento: f.rendimiento || null,
      minutos: Number((f.actividad || {}).minutos) || 0,
      conectado,
      // La última llamada de hoy: la etiqueta que decide su cola, y el
      // RESPONSABLE que la puso, que es lo que pide la campaña 2.
      llamadas: ll ? ll.n : 0,
      etiqueta: u.resultado || '',
      etiquetadoPor: u.quien || '',
      etiquetadoA: u.at || null,
      nota: u.nota || '',
      // La verificación del "confirma que sale ya": la palabra contra los hechos.
      verificacion: DICE_QUE_SALE(u.resultado) ? (conectado ? 'cumplio' : 'sigue_sin') : null,
      j: j ? { horas: j.horas, obs: j.obs, quien: j.quien, tipo: j.tipo || 'personal' } : null,
      noAsiste: NO_ASISTE(u.resultado),
    };
  });

  // ── Las colas ──────────────────────────────────────────────────────────
  // Fuera de campaña quedan los conectados, los justificados y los "no
  // asistirá" (ya se sabe qué pasa con ellos; están en sus listas).
  const pendientes = gente.filter(p => !p.conectado && !p.j && !p.noAsiste);

  const c1 = pendientes.filter(p => !p.etiqueta);
  const c2 = {
    etiquetados: pendientes.filter(p => p.etiqueta),
    interrogacion: pendientes.filter(p => !p.etiqueta),
    // Los que dijeron "ya salgo" Y se conectaron: verificados. Salen de la cola
    // pero la campaña 2 los enseña en verde, que es la comprobación pedida.
    cumplieron: gente.filter(p => p.conectado && p.verificacion === 'cumplio'),
  };
  const c3 = pendientes;

  // ── Las listas de consulta ─────────────────────────────────────────────
  const activos = gente.filter(p => p.conectado)
    .sort((a, b) => b.minutos - a.minutos);
  const porTipo = {};
  TIPOS_J.forEach(t => { porTipo[t.codigo] = []; });
  gente.filter(p => p.j).forEach(p => {
    (porTipo[p.j.tipo] || (porTipo[p.j.tipo] = [])).push(p);
  });
  const listaRoja = gente.filter(p => !p.conectado && p.minutos === 0 && !p.j)
    .sort((a, b) => (b.llamadas - a.llamadas) || a.conductor.localeCompare(b.conductor));

  const h = horaMadrid();
  const activa = h >= 12 ? 3 : h >= 11 ? 2 : h >= 9 ? 1 : 0;   // 0 = aún no abre

  return {
    dia: hoy,
    hora: h,
    campanaActiva: activa,
    campanas: CAMPANAS.map(c => ({ ...c, abierta: h >= c.abre })),
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
    },
    c1, c2, c3,
    activos,
    justificados: porTipo,
    listaRoja,
    noAsisten: gente.filter(p => p.noAsiste && !p.conectado),
  };
}

module.exports = { estado, CAMPANAS };
