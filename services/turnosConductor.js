// ============================================================
// TURNOS POR CONDUCTOR — el mensaje de WhatsApp y a quién le toca
// ============================================================
// La SEMANA de cada conductor (qué coche lleva, de quién lo recibe y a quién se lo
// entrega) la calcula `repo/cobertura.porConductor` desde el tablero de PostgreSQL.
// Aquí queda solo lo que rodea al mensaje:
//
//   · mensajeTurnos(entrada)          → el texto que se le manda por WhatsApp.
//   · resolver(lista, { phone, … })   → de un teléfono a SU entrada de la lista.
//
// Cero hojas: antes esto leía el tablero de Sheets y volvía del teléfono a la
// persona comparando NOMBRES (fallaba con una tilde, con los apellidos en otro
// orden o si el teléfono no estaba en el padrón). Ahora el teléfono identifica
// solo, contra la base; el nombre queda de red por si acaso.

const cob = require('./repo/cobertura');

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

/** Mensaje de WhatsApp con los turnos y relevos de la semana de un conductor. */
function mensajeTurnos(entrada) {
  if (!entrada) return 'No encuentro tus turnos de esta semana. Avisa a la oficina, por favor.';
  const L = [`👋 Hola ${entrada.nombre}, estos son tus turnos y relevos de esta semana:`, ''];
  const dias = entrada.dias || [];
  const tel = x => (x.telefono ? ` (${x.telefono})` : '');

  let i = 0;
  while (i < dias.length) {
    const d = dias[i];
    // Un día que NO está cargado en el planificador no se menciona: ni trabaja ni
    // libra, sencillamente no hay dato. Antes salía como "libras" y era mentira
    // (los días anteriores a la migración salían todos como libranza).
    if (d.sinPlan) { i++; continue; }
    if (!d.trabaja) {
      let j = i; while (j < dias.length && !dias[j].trabaja && !dias[j].sinPlan) j++;
      L.push(`😴 *${unirDias(dias.slice(i, j).map(x => diaLargo(x.diaNombre)))}*: libras`, '');
      i = j; continue;
    }
    L.push(`📅 *${diaLargo(d.diaNombre)}* · turno de ${d.turno} · coche *${d.matricula}*`);
    // De quién viene y a quién va el coche. Se dice CUÁNDO solo cuando aporta:
    // siempre al cruzar la semana (el lunes se recibe del que lo dejó el domingo
    // PASADO: la semana no empieza de cero) y cuando el coche queda parado en
    // medio (relevo no directo). En el relevo directo el coche pasa de mano en el
    // momento y nombrar el día del turno anterior solo confunde.
    if (d.recibeDe) {
      const r = d.recibeDe;
      const cuando = r.semanaPasada ? ` (lo deja el ${diaLargo(r.dia).toLowerCase()} pasado)`
        : (!r.directo && r.dia && r.dia !== d.diaNombre ? ` (lo deja el ${diaLargo(r.dia).toLowerCase()})` : '');
      L.push(`   🔑 Recibes el coche de *${r.nombre}*${tel(r)}${cuando}`);
    }
    if (d.entregaA) {
      const en = d.entregaA;
      const cuando = en.semanaSiguiente ? ` (lo coge el ${diaLargo(en.dia).toLowerCase()} que viene)`
        : (!en.directo && en.dia && en.dia !== d.diaNombre ? ` (lo coge el ${diaLargo(en.dia).toLowerCase()})` : '');
      L.push(`   🤝 Al terminar tu turno, lo entregas a *${en.nombre}*${tel(en)}${cuando}`);
    }
    L.push('');
    i++;
  }
  // Si de toda la semana no salió ni un día (aún sin plan cargado), se dice claro,
  // en vez de mandar un saludo huérfano que no informa de nada.
  if (L.length <= 2) {
    return `👋 Hola ${entrada.nombre}, todavía no tengo cargados tus turnos de esa semana. ` +
           'En cuanto estén, te aviso.';
  }
  return L.join('\n').trim();
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
  const eventos = require('./repo/eventos');
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
      if (e) return { entrada: e, como: 'telefono' };
      // Está en la base pero no le toca ningún turno esta semana: eso NO es un
      // fallo de identificación, es que libra. Se dice tal cual.
      return { entrada: null, como: 'sin-turnos', quien: p.nombre };
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

module.exports = { mensajeTurnos, mensajeEvento, mensajeSiHayEvento, resolver, normNombre, tel9, fechaLarga };
