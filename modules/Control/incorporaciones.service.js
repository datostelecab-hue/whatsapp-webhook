// ============================================================
// PRÓXIMAS INCORPORACIONES — Control (15/10/2026)
// ============================================================
// Camilo: «las personas que entrarán al otro día, ya que ellos tienen que
// llamar para confirmar que entran … los de control necesitan saber todo: los
// turnos planificados, la opción de enviar la plantilla de los turnos por
// WhatsApp y ver los turnos que tiene él para poder explicárselos … tanto de
// los que son NUEVOS como de los que vienen de vacaciones … y recordarles el bot
// de WhatsApp que abre y cierra puertas, que puede ver sus turnos: un
// instructivo PARA LOS NUEVOS».
//
// NO ES LA LISTA DEL PLANIFICADOR. La de allí (planificador.repo
// .proximasIncorporaciones) es para Tráfico y solo saca a quien vuelve de
// vacaciones si le han CAMBIADO de cuadrante. Control llama a TODOS los que
// entran, cambien o no.
//
// QUIÉN ENTRA UN DÍA (`clasificar`, pura):
//   · NUEVO: tiene un contrato que empezó hace poco (no un paso de ETT a propia,
//     que no es entrar) y ese día es el PRIMERO en que cubre una plaza. Si el día
//     de su alta no tiene ninguna plaza, sale igual ese día con el aviso «Sin
//     plaza»: Control tiene que saber que alguien entra y no tiene coche.
//   · VACACIONES: el primer día que cubre una plaza después de sus vacaciones.
//     Si al volver no tiene plaza (y no es que libre ni que siga ausente), sale
//     el día siguiente a las vacaciones con «Sin plaza».
// Quién cubre qué es f_cobertura, la regla del planificador.

const repo = require('./incorporaciones.repo');

const VENTANAS = {
  manana: { texto: 'Mañana', de: 1, a: 1 },
  hoy: { texto: 'Hoy', de: 0, a: 0 },
  semana: { texto: 'Próximos 7 días', de: 1, a: 7 },
};
// Cuánto se mira hacia atrás: el primer día con plaza puede ir unos días detrás
// del alta (libra el coche, o espera coche), y unas vacaciones pueden haber
// acabado antes de un par de días de libranza.
const ATRAS = 12;
// Un contrato con más de esto ya no es una incorporación: si no ha cubierto
// nada en todo este tiempo, es otra cosa (espera coche) y ya lo ve Tráfico.
const ALTA_RECIENTE = 45;

// Lo que puede salir de la llamada. `caso` es lo que queda en su historial de
// llamadas y lo que el Call Center clasifica (`callcenter.service.DESDE_CONTROL`,
// tipo «trafico»): no se renombra sin tocar los dos.
const PREFIJO = 'Incorporación:';
const RESULTADOS_LLAMADA = [
  { valor: 'confirma', texto: 'Confirma que entra', caso: 'Incorporación: confirma que entra', estado: 'confirmada' },
  { valor: 'otro_dia', texto: 'Entra otro día', caso: 'Incorporación: entra otro día', estado: 'otro_dia', notaObligatoria: true },
  { valor: 'no_entra', texto: 'No va a entrar', caso: 'Incorporación: no va a entrar', estado: 'no_entra', notaObligatoria: true },
  { valor: 'no_contesta', texto: 'No contesta', caso: 'Incorporación: no contesta', estado: 'no_contesta' },
  { valor: 'buzon', texto: 'Buzón de voz', caso: 'Incorporación: buzón de voz', estado: 'no_contesta' },
];

// ── Fechas ──────────────────────────────────────────────────────────────────
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const mas = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const es = iso => (iso ? iso.split('-').reverse().join('/') : '');

/**
 * QUIÉN ENTRA CADA DÍA DE [desde, hasta]. Pura: todo entra por los argumentos.
 *
 *   altas         [{ id, alta, baja_anterior, … }]   contratos recientes
 *   vacaciones    [{ id, desde, hasta }]             vacaciones que acaban
 *   cobertura     [{ dia, id, matricula, rol, … }]   f_cobertura de [inicio, hasta]
 *   asignaciones  [{ id, desde, hasta }]             sus plazas
 *   ausencias     [{ id, desde, hasta }]             cualquier ausencia
 *   inicio        el primer día de `cobertura`
 *
 * Devuelve [{ id, tipo: 'nuevo'|'vacaciones', dia, sinPlaza, plazas, alta?,
 * bajaAnterior?, vacaciones? }], una vez por persona (la primera entrada).
 */
function clasificar({ desde, hasta, inicio, altas = [], vacaciones = [], cobertura = [], asignaciones = [], ausencias = [] }) {
  const cubre = new Map();   // id → [días cubiertos, en orden]
  const plazasDe = new Map();   // `${id}|${dia}` → plazas de ese día
  for (const c of cobertura) {
    if (!cubre.has(c.id)) cubre.set(c.id, []);
    const ds = cubre.get(c.id);
    if (ds[ds.length - 1] !== c.dia) ds.push(c.dia);
    const k = `${c.id}|${c.dia}`;
    if (!plazasDe.has(k)) plazasDe.set(k, []);
    plazasDe.get(k).push({ matricula: c.matricula, puesto: c.rol === 'CT' ? 'Correturnos' : 'Fijo', turno: c.turno || '' });
  }
  const primeroDesde = (id, dia) => (cubre.get(id) || []).find(d => d >= dia) || null;
  const tienePlaza = (id, dia) => asignaciones.some(a => a.id === id && a.desde <= dia && (!a.hasta || a.hasta >= dia));
  const plazaAntesDe = (id, dia) => asignaciones.some(a => a.id === id && a.desde < dia);
  const ausente = (id, dia) => ausencias.some(a => a.id === id && a.desde <= dia && (!a.hasta || a.hasta >= dia));
  const dentro = d => d && d >= desde && d <= hasta;

  const out = new Map();
  const apunta = e => {
    const ya = out.get(e.id);
    if (!ya || e.dia < ya.dia || (e.dia === ya.dia && e.tipo === 'nuevo' && ya.tipo !== 'nuevo')) out.set(e.id, e);
  };

  for (const a of altas) {
    // De la ETT a propia sin hueco: sigue trabajando, no entra.
    if (a.baja_anterior && a.baja_anterior === mas(a.alta, -1)) continue;
    // Que no haya cubierto nada desde el alta hasta el día anterior a la
    // ventana: ni en lo que se mira (`cobertura`) ni con plazas que empezaran
    // antes de lo que se mira.
    const desdeAlta = a.alta > inicio ? a.alta : inicio;
    const primero = primeroDesde(a.id, desdeAlta);
    if (primero && primero < desde) continue;
    if (a.alta < inicio && plazaAntesDe(a.id, inicio)) continue;
    const base = { id: a.id, tipo: 'nuevo', alta: a.alta, bajaAnterior: a.baja_anterior || null };
    if (dentro(primero)) apunta({ ...base, dia: primero, sinPlaza: false, plazas: plazasDe.get(`${a.id}|${primero}`) || [] });
    else if (!primero && dentro(a.alta) && !tienePlaza(a.id, a.alta) && !ausente(a.id, a.alta)) {
      apunta({ ...base, dia: a.alta, sinPlaza: true, plazas: [] });
    }
  }

  for (const v of vacaciones) {
    const vuelta = mas(v.hasta, 1);
    const primero = primeroDesde(v.id, vuelta);
    // Si entre la vuelta y el primer día con plaza hay otra ausencia (una baja
    // que empieza al acabar), no vuelve de vacaciones: vuelve de lo otro.
    if (primero && ausencias.some(x => x.id === v.id && x.desde >= vuelta && x.desde < primero)) continue;
    const base = { id: v.id, tipo: 'vacaciones', vacaciones: { desde: v.desde, hasta: v.hasta } };
    if (dentro(primero)) apunta({ ...base, dia: primero, sinPlaza: false, plazas: plazasDe.get(`${v.id}|${primero}`) || [] });
    else if (!primero && dentro(vuelta) && !tienePlaza(v.id, vuelta) && !ausente(v.id, vuelta)) {
      apunta({ ...base, dia: vuelta, sinPlaza: true, plazas: [] });
    }
  }
  return [...out.values()].sort((x, y) => x.dia.localeCompare(y.dia));
}

/** El coche que llevaba antes de irse de vacaciones: el de la víspera. */
function cochesDeAntes(asignaciones, id, dia) {
  return [...new Set(asignaciones
    .filter(a => a.id === id && a.desde <= dia && (!a.hasta || a.hasta >= dia))
    .map(a => a.matricula))].sort();
}

/** El nombre de pila, para el guion («Hola, Daniela»). */
function pila(p) {
  try { return require('../../services/nucleo').nombreDePila({ nombre: p.nombre_ficha, apellidos: p.apellidos, nombreBolt: p.nombre_bolt }); }
  catch (_) { return String(p.nombre || '').split(/\s+/)[0] || ''; }
}

/**
 * LA LISTA de una ventana (`manana`, `hoy` o `semana`), con todo lo que hace
 * falta para llamar: quién es, qué coche, si tiene cuenta de BOLT, qué se le
 * dijo, si se le mandaron los turnos y el texto exacto de «Ver mis turnos».
 */
async function lista({ ventana } = {}) {
  const w = VENTANAS[ventana] ? ventana : 'manana';
  const hoy = hoyMadrid();
  const desde = mas(hoy, VENTANAS[w].de), hasta = mas(hoy, VENTANAS[w].a);
  const inicio = mas(desde, -ATRAS);

  const [altas, vacs] = await Promise.all([
    repo.altas(mas(desde, -ALTA_RECIENTE), hasta),
    repo.vacaciones(mas(desde, -ATRAS), mas(hasta, -1)),
  ]);
  const candidatos = [...new Set([...altas.map(a => a.id), ...vacs.map(v => v.id)])];
  const [cobertura, asignaciones, ausencias] = await Promise.all([
    repo.cobertura(candidatos, inicio, hasta),
    repo.asignaciones(candidatos),
    repo.ausencias(candidatos, inicio, hasta),
  ]);
  const entran = clasificar({ desde, hasta, inicio, altas, vacaciones: vacs, cobertura, asignaciones, ausencias });
  const ids = entran.map(e => e.id);

  const desdeLlamadas = mas(desde, -ATRAS);
  const [gente, llamadas, avisos] = await Promise.all([
    repo.personas(ids),
    repo.llamadas(ids, desdeLlamadas, PREFIJO),
    repo.avisosDeTurnos(ids, desdeLlamadas),
  ]);
  const persona = new Map(gente.map(p => [p.id, p]));
  // Sus turnos, con el texto que le enseñará el bot. Si falla, la lista sale
  // igual: lo que no se puede es dejar a Control sin saber a quién llamar.
  const turnos = ids.length
    ? await require('../Planificacion/cobertura.service')
      .proximosDeCadaUno(id => (persona.has(id) ? pila(persona.get(id)) : ''))
      .catch(e => { console.error('⚠️  [Incorporaciones] turnos:', e.message); return new Map(); })
    : new Map();
  const contrato = new Map(altas.map(a => [a.id, a]));
  const ahora = Date.now();

  const filas = entran.map(e => {
    const p = persona.get(e.id) || {};
    const suyas = llamadas.filter(l => l.id === e.id);
    const ultima = suyas[0] || null;
    const res = ultima ? RESULTADOS_LLAMADA.find(r => r.caso === ultima.resultado) : null;
    const aviso = avisos.find(a => a.id === e.id) || null;
    const t = turnos.get(e.id) || null;
    const k = contrato.get(e.id);
    const antes = e.tipo === 'vacaciones' ? cochesDeAntes(asignaciones, e.id, mas(e.vacaciones.desde, -1)) : [];
    const ahoraLleva = [...new Set(e.plazas.map(x => x.matricula))].sort();
    const ventanaAbierta = p.ultima_entrante_at && ahora - new Date(p.ultima_entrante_at).getTime() < 24 * 3600 * 1000;
    return {
      ...e,
      nombre: p.nombre || `Conductor ${e.id}`,
      pila: pila(p),
      telefono: p.telefono || '',
      barrio: p.barrio || '',
      jornada: p.jornada || '',
      contrato: k ? { tipo: k.tipo, ett: k.ett_nombre || '', horas: k.jornada_horas || null } : null,
      sinBolt: !p.cuentas_bolt,
      ventanaWhatsApp: !!ventanaAbierta,
      videoEnviado: p.video_enviado || null,
      cambiaDeCoche: e.tipo === 'vacaciones' && antes.length && ahoraLleva.length
        ? antes.join(',') !== ahoraLleva.join(',') : false,
      cochesAntes: antes,
      confirmacion: res ? res.estado : null,
      ultimaLlamada: ultima ? { resultado: res ? res.texto : ultima.resultado, cuando: ultima.cuando, quien: ultima.quien || '', nota: ultima.nota || '' } : null,
      llamadas: suyas.length,
      avisoTurnos: aviso ? { ok: aviso.resultado === 'ok', cuando: aviso.cuando, quien: aviso.usuario || '', detalle: aviso.detalle || '' } : null,
      turnosTexto: t ? t.texto : null,
      // Lo que le llegará con «Bienvenida con vídeo» (solo a los nuevos): el
      // mismo texto que monta el servidor al mandarla.
      bienvenida: e.tipo === 'nuevo' ? textoBienvenida({
        pila: pila(p), dia: e.dia, hoy,
        turno: (e.plazas[0] && e.plazas[0].turno) || p.jornada || '', matriculas: ahoraLleva,
      }) : null,
    };
  });
  return {
    hoy, desde, hasta, ventana: w,
    ventanas: Object.entries(VENTANAS).map(([id, v]) => ({ id, texto: v.texto })),
    filas,
  };
}

/** APUNTAR UNA LLAMADA: queda en su historial de llamadas de Control. */
async function apuntarLlamada(conductorId, b = {}, quien = {}) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta la persona');
  const valor = String(b.resultado && typeof b.resultado === 'object' ? b.resultado.valor : (b.resultado || '')).trim();
  const res = RESULTADOS_LLAMADA.find(x => x.valor === valor);
  if (!res) throw new Error('Elige qué ha dicho');
  const nota = String(b.nota || '').trim().slice(0, 240);
  if (res.notaObligatoria && nota.length < 3) {
    throw new Error(res.valor === 'otro_dia' ? 'Cuenta en la nota qué día entra' : 'Cuenta en la nota por qué no va a entrar');
  }
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dia || '')) ? String(b.dia) : null;
  await require('../../services/repo/llamadas').registrar({
    conductorId: cid, usuarioId: quien.usuarioId, origen: 'control', tipo: 'trafico',
    resultado: res.caso, matricula: b.matricula || null,
    nota: [dia ? `Entra el ${es(dia)}` : '', nota].filter(Boolean).join(' · '),
  });
  console.log(`📞 [Incorporaciones] conductor ${cid}: ${res.texto} · usuario ${quien.usuarioId || '?'}`);
  return { ok: true };
}

/**
 * MANDARLE SUS TURNOS POR WHATSAPP: la misma plantilla que manda el planificador
 * («detalle_turnos», con el botón que le enseña sus turnos de hoy a 7 días), y
 * queda en el mismo libro de avisos. Con la ventana de 24 h abierta, sus turnos
 * directamente en texto, sin plantilla (19/10/2026, ver cobertura.avisarTurnos).
 */
const enviarTurnos = (conductorId, quien = {}) =>
  require('../Planificacion/cobertura.service').enviarAUno({ id: conductorId, semana: 0 }, quien);

/**
 * MANDARLE EL VÍDEO DEL BOT (15/10/2026): el de cómo funciona el WhatsApp del
 * coche (matrícula, puertas, entregar, terminar y el bloqueo del motor). Solo
 * con la ventana de 24 h abierta; va por la puerta del módulo de WhatsApp, que
 * es quien lo comprueba y lo apunta en su chat. `base`, la dirección pública.
 */
async function enviarVideo(conductorId, quien = {}, base) {
  const [p] = await repo.personas([String(Number(conductorId))]);
  if (!p) throw new Error('No existe esa persona');
  if (!p.telefono) throw new Error('No tiene teléfono en su ficha');
  return require('../WhatsApp/whatsapp.service')
    .enviarVideo({ telefono: p.telefono, video: VIDEO_DEL_BOT }, quien.usuarioId, base);
}
const VIDEO_DEL_BOT = 'bot_coche';

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * EL TEXTO DE BIENVENIDA de un nuevo (15/10/2026). Pura. Va antes del vídeo del
 * bot y dice lo justo: su primer turno y cómo se usa el WhatsApp del coche, con
 * las palabras del bot (services/fichajeBot.js) y sin «fichar».
 *
 *   { pila, dia, hoy, turno, matriculas }
 */
function textoBienvenida({ pila, dia, hoy, turno, matriculas = [] } = {}) {
  const d = new Date(Date.parse(dia + 'T12:00:00Z'));
  const fecha = `${DIAS_SEMANA[d.getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const cuando = dia === mas(hoy, 1) ? `mañana, ${fecha}` : dia === hoy ? `hoy, ${fecha}` : `el ${fecha}`;
  const coche = matriculas.length ? `, con el coche *${matriculas.join('* y el *')}*` : '';
  const de = turno ? `, turno de ${String(turno).toLowerCase()}` : '';
  return [
    `👋 ¡Hola${pila ? ', ' + pila : ''}! Te damos la bienvenida a Telecab.`,
    `Tu primer turno es ${cuando}${de}${coche}.`,
    '',
    'Este WhatsApp es el de tu coche:',
    '• Al llegar, escríbeme la *matrícula* todo junto (ejemplo: *1234ABC*): empieza tu turno y se desbloquea el motor.',
    '• Desde aquí abres y cierras las *puertas*.',
    '• Pulsa *Entregar coche* justo antes de salir hacia donde está tu compañero.',
    '• Al acabar, *Terminar turno* con el coche aparcado y apagado.',
    '• Para ver tus turnos, escríbeme «hola» y pulsa *Ver mis turnos*.',
    '',
    'Ahora te mando un vídeo de un minuto que lo explica. Si algo falla, llama a Tráfico.',
  ].join('\n');
}

/**
 * LA BIENVENIDA CON VÍDEO de un nuevo: el texto de arriba y el vídeo del bot,
 * por la puerta del módulo de WhatsApp (solo con la ventana abierta). El día,
 * el turno y el coche llegan de la pantalla y se comprueba su forma.
 */
async function enviarBienvenida(conductorId, b = {}, quien = {}, base) {
  const [p] = await repo.personas([String(Number(conductorId))]);
  if (!p) throw new Error('No existe esa persona');
  if (!p.telefono) throw new Error('No tiene teléfono en su ficha');
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dia || '')) ? String(b.dia) : null;
  if (!dia) throw new Error('Falta el día en que entra');
  const matriculas = (Array.isArray(b.matriculas) ? b.matriculas : [])
    .map(m => String(m || '').toUpperCase().replace(/[^0-9A-Z]/g, '')).filter(m => /^[0-9A-Z]{5,8}$/.test(m)).slice(0, 3);
  const turno = /^[A-Za-zÁÉÍÓÚáéíóú ]{1,20}$/.test(String(b.turno || '')) ? String(b.turno) : '';
  const texto = textoBienvenida({ pila: pila(p), dia, hoy: hoyMadrid(), turno, matriculas });
  return require('../WhatsApp/whatsapp.service')
    .enviarVideo({ telefono: p.telefono, video: VIDEO_DEL_BOT, texto }, quien.usuarioId, base);
}

module.exports = {
  VENTANAS, RESULTADOS_LLAMADA, PREFIJO, VIDEO_DEL_BOT,
  lista, apuntarLlamada, enviarTurnos, enviarVideo, enviarBienvenida, textoBienvenida,
  // Para las pruebas.
  clasificar, cochesDeAntes,
};
