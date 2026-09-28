// ============================================================
// TURNOS POR CONDUCTOR — el mensaje de WhatsApp y a quién le toca
// ============================================================
// La SEMANA de cada conductor (qué coche lleva, de quién lo recibe y a quién se lo
// entrega) la calcula `repo/cobertura.porConductor` desde el tablero de PostgreSQL.
// Aquí queda solo lo que rodea al mensaje:
//
//   · textoTurnos({ phone })          → lo que le contesta el bot al pulsar
//                                       «Ver mis turnos»: de HOY a 7 días.
//   · mensajeProximos(entrada, v)     → ese texto, a partir de la ventana.
//   · resolver(lista, { phone, … })   → de un teléfono a SU entrada de la lista.
//
// DE HOY A 7 DÍAS, NO LA SEMANA (28/09/2026). Antes se mandaba la semana de
// lunes a domingo, y el martes el conductor recibía el lunes que ya había
// pasado y no veía el lunes siguiente. Camilo: «si hoy es jueves, del jueves al
// otro jueves; lo que pasó ya no interesa».
//
// Cero hojas: antes esto leía el tablero de Sheets y volvía del teléfono a la
// persona comparando NOMBRES (fallaba con una tilde, con los apellidos en otro
// orden o si el teléfono no estaba en el padrón). Ahora el teléfono identifica
// solo, contra la base; el nombre queda de red por si acaso.

const cob = require('./cobertura.repo');

// El planner usa días abreviados; para el mensaje al conductor van completos.
const DIAS_LARGOS = {
  Lun: 'Lunes', Mar: 'Martes', Mié: 'Miércoles', Mie: 'Miércoles',
  Jue: 'Jueves', Vie: 'Viernes', Sáb: 'Sábado', Sab: 'Sábado', Dom: 'Domingo',
};
const diaLargo = d => DIAS_LARGOS[d] || d;

/** Une nombres de día: ["Martes","Miércoles"] → "Martes y Miércoles". */
function unirDias(nombres) {
  if (nombres.length === 1) return nombres[0];
  return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1];
}

/** Cómo se nombra un día de la ventana: «Hoy, martes 29/09», «Viernes 02/10». */
function nombreDelDia(d, i) {
  const f = fechaLarga(d.fecha);
  if (i === 0) return `Hoy, ${f}`;
  if (i === 1) return `Mañana, ${f}`;
  return f.charAt(0).toUpperCase() + f.slice(1);
}

/**
 * El mensaje de «Ver mis turnos»: sus turnos de HOY a 7 días, con de quién
 * recibe el coche y a quién se lo entrega.
 *
 * @param {object} entrada  su entrada de `cobertura.proximos()` (días con fecha)
 * @param {object} v        { desde, hasta, pila } — la ventana y su nombre de pila
 */
function mensajeProximos(entrada, v = {}) {
  if (!entrada) return 'No encuentro tus turnos. Avisa a la oficina, por favor.';
  const hola = `👋 Hola, ${v.pila || entrada.nombre}.`;
  const dias = entrada.dias || [];
  const tel = x => (x.telefono ? ` (${x.telefono})` : '');
  // CUÁNDO pasa el coche, solo cuando aporta: si el coche se queda parado en
  // medio (relevo no directo). En el relevo directo pasa de mano en el momento
  // y nombrar otro día solo confunde. Con fecha y no con «el domingo pasado»:
  // la ventana cruza semanas y «pasado» ya no se sabe respecto a qué.
  const cuando = (x, d, verbo) =>
    (!x.directo && x.fecha && x.fecha !== d.fecha ? ` (${verbo} el ${fechaLarga(x.fecha)})` : '');

  const L = [];
  let i = 0;
  while (i < dias.length) {
    const d = dias[i];
    // Un día que NO está cargado en el planificador no se menciona: ni trabaja
    // ni libra, sencillamente no hay dato. Decir «libras» sería mentirle.
    if (d.sinPlan) { i++; continue; }
    if (!d.trabaja) {
      let j = i; while (j < dias.length && !dias[j].trabaja && !dias[j].sinPlan) j++;
      const nombres = dias.slice(i, j).map((x, k) => {
        const n = nombreDelDia(x, i + k);
        return k ? n.charAt(0).toLowerCase() + n.slice(1) : n;
      });
      L.push(`😴 *${unirDias(nombres)}*: libras`, '');
      i = j; continue;
    }
    L.push(`📅 *${nombreDelDia(d, i)}* · turno de ${d.turno} · coche *${d.matricula}*`);
    if (d.recibeDe) {
      const r = d.recibeDe;
      L.push(`   🔑 Recibes el coche de *${r.nombre}*${tel(r)}${cuando(r, d, 'lo deja')}`);
    }
    if (d.entregaA) {
      const en = d.entregaA;
      L.push(`   🤝 Al terminar, se lo entregas a *${en.nombre}*${tel(en)}${cuando(en, d, 'lo coge')}`);
    }
    L.push('');
    i++;
  }
  const hasta = v.hasta ? fechaLarga(v.hasta) : '';
  // Sin un solo día con plan: se dice claro, no un saludo huérfano.
  if (!L.length) return `${hola} Todavía no tengo cargados tus turnos de los próximos días. En cuanto estén, te aviso.`;
  return [`${hola} Estos son tus turnos de hoy${hasta ? ` al ${hasta}` : ''}:`, '', ...L].join('\n').trim();
}

/**
 * Lo que contesta el bot a «Ver mis turnos». Durante un EVENTO manda el mensaje
 * del evento (sus días del apaño, a quién entrega el coche y su semana normal);
 * si no, sus turnos de hoy a 7 días.
 *
 * Devuelve { texto, como } — `como` dice por dónde se identificó, para el log.
 */
async function textoTurnos({ phone, nombreSesion } = {}) {
  const ev = await mensajeSiHayEvento({ phone, nombreSesion }).catch(e => {
    console.error('⚠️ [Turnos] mensaje de evento:', e.message); return null;
  });
  if (ev) return { texto: ev.texto, como: 'evento', evento: ev.evento };

  const v = await cob.proximos();
  const { entrada, como, quien, pila } = await resolver(v.porConductor, { phone, nombreSesion });
  if (entrada) return { texto: mensajeProximos(entrada, { ...v, pila }), como, nombre: entrada.nombre };
  // Identificado pero SIN turnos: no es un fallo, es que libra. Se dice así.
  if (como === 'sin-turnos') {
    return {
      texto: `👋 Hola${pila || quien ? ', ' + (pila || quien) : ''}. No tienes turnos asignados de hoy al ` +
        `${fechaLarga(v.hasta)}. Si crees que es un error, avisa a la oficina.`,
      como, nombre: quien,
    };
  }
  return { texto: mensajeProximos(null), como };
}

/** "2026-09-13" → "domingo 13/09". */
function fechaLarga(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const nombre = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][
    (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
  return `${nombre} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** Los días de una entrada semanal, ya formateados (los que trabaja). */
function lineasDeDias(entrada, { soloDias = null, fechas = null } = {}) {
  const L = [];
  const dias = (entrada && entrada.dias) || [];
  const tel = x => (x.telefono ? ` (${x.telefono})` : '');
  dias.forEach((d, i) => {
    if (d.sinPlan || !d.trabaja) return;
    // `soloDias` recorta a los días del evento: el resto de la semana no es
    // temporal y se cuenta después, con su turno normal.
    if (soloDias && !soloDias.includes(i)) return;
    const cuando = fechas && fechas[i] ? ` ${fechaLarga(fechas[i]).split(' ')[1]}` : '';
    L.push(`📅 *${diaLargo(d.diaNombre)}${cuando}* · turno de ${d.turno} · coche *${d.matricula}*`);
    if (d.recibeDe) {
      const r = d.recibeDe;
      const c = r.semanaPasada ? ` (lo deja el ${diaLargo(r.dia).toLowerCase()} pasado)`
        : (!r.directo && r.dia && r.dia !== d.diaNombre ? ` (lo deja el ${diaLargo(r.dia).toLowerCase()})` : '');
      L.push(`   🔑 Recibes el coche de *${r.nombre}*${tel(r)}${c}`);
    }
    if (d.entregaA) {
      const e = d.entregaA;
      const c = e.semanaSiguiente ? ` (lo coge el ${diaLargo(e.dia).toLowerCase()} que viene)`
        : (!e.directo && e.dia && e.dia !== d.diaNombre ? ` (lo coge el ${diaLargo(e.dia).toLowerCase()})` : '');
      L.push(`   🤝 Al terminar tu turno, lo entregas a *${e.nombre}*${tel(e)}${c}`);
    }
    L.push('');
  });
  return L;
}

/**
 * EL MENSAJE CUANDO HAY UN EVENTO.
 *
 * Durante un evento los turnos no son los suyos: son un apaño de tres días. Un
 * conductor que recibe su cuadro normal y luego se encuentra otro coche no
 * entiende nada, así que se le dice las tres cosas, en este orden:
 *
 *   1. que es TEMPORAL y por qué,
 *   2. qué hace esos días,
 *   3. A QUIÉN LE ENTREGA EL COCHE cuando se acabe —que es lo que hace que todo
 *      vuelva a su sitio sin una llamada— y
 *   4. sus turnos de la semana siguiente, ya normales.
 *
 * @param {object} entrada     su semana DEL EVENTO (la del tablero de esos días)
 * @param {object} proxima     su semana siguiente, ya normal (puede ser null)
 * @param {object} evento      { nombre, desde, hasta, cierraAt }
 * @param {array}  entregas    [{ matricula, turno, quien, telefono, dia }]
 * @param {object} opciones    { fechas, fechasProxima, diasEvento }
 */
function mensajeEvento(entrada, proxima, evento, entregas = [], opciones = {}) {
  const nombre = (entrada && entrada.nombre) || (proxima && proxima.nombre) || '';
  const L = [`👋 Hola ${nombre}.`, ''];
  L.push(`⚡ Como motivo por el evento de *${evento.nombre}* tus turnos temporales serán estos:`, '');

  const delEvento = lineasDeDias(entrada, { soloDias: opciones.diasEvento, fechas: opciones.fechas });
  if (delEvento.length) L.push(...delEvento);
  else L.push('😴 Durante el evento no tienes turnos asignados: libras.', '');

  // A QUIÉN SE LE DA EL COCHE AL TERMINAR. Es la frase que evita el lío del
  // lunes: el apaño se acaba y el coche tiene que volver a su gente.
  if (entregas.length) {
    L.push(`🔁 *Cuando termine el evento* (${fechaLarga(evento.hasta)}, al acabar tu turno):`);
    entregas.forEach(e => {
      L.push(`   🤝 El coche *${e.matricula}* se lo entregas a *${e.quien}*` +
        (e.telefono ? ` (${e.telefono})` : '') +
        (e.dia ? ` — lo coge el ${fechaLarga(e.dia)}` : ''));
    });
    L.push('');
  }

  const dePro = lineasDeDias(proxima, { fechas: opciones.fechasProxima });
  L.push('✅ *Y la semana que viene vuelves a lo normal:*', '');
  if (dePro.length) L.push(...dePro);
  else {
    // NUNCA "no tienes turnos". Durante un evento el cuadrante se mueve mucho, y
    // a un conductor al que le acaban de cambiar el fin de semana esa frase le
    // suena a que se ha quedado sin trabajo. Si de verdad no hay nada cargado,
    // se dice que no lo hay todavía y a quién preguntar — que es lo que es.
    L.push('ℹ️ Todavía no tengo cargado tu cuadro de la semana que viene. ' +
      'En cuanto esté, te aviso; si tienes dudas, pregunta en la oficina.', '');
  }

  return L.join('\n').trim();
}

const TZ_ES = 'Europe/Madrid';
const hoyEs = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ_ES, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const masDias = (iso, n) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const lunesDe = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return masDias(iso, -(((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7)));
};
/** Cuántas semanas hay del lunes de `a` al lunes de `b`. */
const semanasEntre = (a, b) => Math.round(
  (Date.parse(lunesDe(b) + 'T12:00:00Z') - Date.parse(lunesDe(a) + 'T12:00:00Z')) / (7 * 86400000));

/**
 * SI HAY UN EVENTO VIVO, el mensaje completo del conductor; si no, null.
 *
 * Junta tres cosas que viven en sitios distintos: su semana del evento (el
 * tablero de esos días), a quién entrega el coche al terminar (el plan de
 * después, que ya es el bueno porque cada apaño nació con fecha de vuelta) y su
 * semana siguiente. El bot solo tiene que mandarlo.
 */
async function mensajeSiHayEvento({ phone, nombreSesion } = {}) {
  const eventos = require('./eventos.repo');
  const hoy = hoyEs();
  const ev = await eventos.vigenteEn(hoy).catch(e => {
    console.error('⚠️ [Turnos] evento vigente:', e.message); return null;
  });
  if (!ev) return null;

  // Las semanas que hacen falta: la del evento (desde hoy) y la de después.
  const offEvento = Math.max(0, semanasEntre(hoy, ev.desde > hoy ? ev.desde : hoy));
  const offDespues = semanasEntre(hoy, masDias(ev.hasta, 1));
  const semanas = new Map();
  const dameSemana = async off => {
    if (!semanas.has(off)) semanas.set(off, await cob.datos({ offsetSemana: off }));
    return semanas.get(off);
  };

  const sEvento = await dameSemana(offEvento);
  const { entrada, como, quien } = await resolver(sEvento.porConductor, { phone, nombreSesion });
  const id = entrada ? String(entrada.id) : null;
  // Ni identificado ni con turnos: que siga el camino normal, que ya sabe
  // explicarlo mejor (y así un evento no rompe el "no te encuentro").
  if (!id && como !== 'sin-turnos') return null;

  const sDespues = offDespues === offEvento ? sEvento : await dameSemana(offDespues);
  const proxima = id ? (sDespues.porConductor || []).find(x => String(x.id) === id) : null;

  // Solo los días de la semana que caen DENTRO del evento y no han pasado: el
  // resto de esa semana ya es normal y va en el bloque de después.
  const ini = sEvento.semanaInfo.desde;
  const diasEvento = [];
  const fechas = [];
  for (let i = 0; i < 7; i++) {
    const f = masDias(ini, i);
    fechas.push(f);
    if (f >= ev.desde && f <= ev.hasta && f >= hoy) diasEvento.push(i);
  }

  const mapa = await eventos.entregas(ev).catch(e => {
    console.error('⚠️ [Turnos] entregas del evento:', e.message); return new Map();
  });
  const mias = id ? (mapa.get(id) || []) : [];

  const fechasProxima = [];
  for (let i = 0; i < 7; i++) fechasProxima.push(masDias(sDespues.semanaInfo.desde, i));

  return {
    evento: ev,
    texto: mensajeEvento(
      entrada || { nombre: quien || '', dias: [] },
      proxima, ev, mias,
      { diasEvento, fechas, fechasProxima }),
  };
}

// Nombre normalizado para la red de seguridad: sin tildes, en minúsculas y con las
// palabras ordenadas, para que "Juan Pérez Gómez" y "Gómez, Juan Perez" casen.
const normNombre = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .trim().split(/\s+/).filter(Boolean).sort().join(' ');

const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);

/**
 * De un teléfono a SU entrada de la semana.
 *
 * 1. Por TELÉFONO contra la base (lo normal y lo fiable: el sufijo de 9 dígitos es
 *    único, así que no hay margen de error).
 * 2. Por el teléfono que ya trae la propia lista (mismo criterio, sin otra consulta).
 * 3. Por NOMBRE (el de la sesión del bot), como último cartucho.
 *
 * Devuelve { entrada, como } — `como` dice por dónde se resolvió, que es lo que
 * hace diagnosticable el caso raro.
 */
async function resolver(lista, { phone, nombreSesion } = {}) {
  const L = lista || [];

  // 1. El teléfono, contra la base.
  try {
    const p = await cob.conductorPorTelefono(phone);
    if (p) {
      const e = L.find(x => String(x.id) === p.conductorId);
      if (e) return { entrada: e, como: 'telefono', pila: p.pila };
      // Está en la base pero no le toca ningún turno esta semana: eso NO es un
      // fallo de identificación, es que libra. Se dice tal cual.
      return { entrada: null, como: 'sin-turnos', quien: p.nombre, pila: p.pila };
    }
  } catch (e) {
    console.error('⚠️ [Turnos] conductorPorTelefono:', e.message);
  }

  // 2. El teléfono que ya viene en la lista.
  const mio = tel9(phone);
  if (mio) {
    const e = L.find(x => tel9(x.telefono) === mio);
    if (e) return { entrada: e, como: 'telefono-lista' };
  }

  // 3. El nombre de la sesión.
  const clave = normNombre(nombreSesion);
  if (clave) {
    const e = L.find(x => normNombre(x.nombre) === clave);
    if (e) return { entrada: e, como: 'nombre' };
  }

  return { entrada: null, como: 'no-identificado' };
}

module.exports = {
  textoTurnos, mensajeProximos, mensajeEvento, mensajeSiHayEvento, resolver, normNombre, tel9, fechaLarga,
};
