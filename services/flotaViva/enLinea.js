// ============================================================
// QUIÉN ESTÁ CONECTADO AHORA — la API v2 de BOLT, en memoria
// ============================================================
// Camilo, 28/10/2026: «usemos la de DriversOnline de una vez para inicio,
// control y el mapa ... que sea solo para datos en directo, los históricos
// déjalos quietos, como las horas acumuladas».
//
// `getOnlineDrivers` (v2) contesta en UNA llamada lo que hasta ahora había que
// reconstruir: quién está conectado, en qué (viaje, espera, descanso), desde
// cuándo (`changed_at`) y con qué coche. Antes salía de cruzar el tramo del
// motor con el último apunte de `bolt_state_log`; ahora es la pregunta directa.
//
// ── CÓMO ────────────────────────────────────────────────────────────────────
//   · UN sondeo cada 5 s (app.js) pregunta por la empresa de Madrid y deja la
//     respuesta AQUÍ, en memoria. No va a la base: es el ahora, y dentro de
//     cinco segundos ya es otro.
//   · Las pantallas no llaman nunca a BOLT: leen la foto del ahora (ahora.js),
//     que se hace con esto mientras esté fresco.
//   · Los uuid de conductor y de coche son LOS MISMOS que en la v1 (comprobado
//     el 28/10/2026: 53 de 53 conectados), así que se cruza con lo que ya hay
//     sin ingesta nueva de conductores.
//
// ── CUÁNDO NO VALE ──────────────────────────────────────────────────────────
// Con la v2, «no aparece» quiere decir «desconectado». Una lista vieja o a la
// que le falta una empresa desconectaría a media flota, así que entonces no se
// usa y la foto del ahora se hace como siempre, con la base (el plan B). Pasa
// sin credenciales, con BOLT caído y nada más arrancar, hasta el primer sondeo.
//
// SOLO LA 143626, TIBUS LUXURY SERVICES (Camilo, el mismo día: «la empresa
// 63530 ignórala en el ONLINE, la de Barcelona también ya que no usa ninguno
// de los módulos por el momento ... para optimizar y bajar los tiempos de
// refresco»). Una sola pregunta por vuelta. La 63530 es la antigua, casi toda
// desactivada; si alguien se conectara por ella, aquí saldría desconectado.
// Se cambia sin tocar código con BOLT_V2_EMPRESAS (ids separados por comas).

const bolt = require('../bolt');
const { normMat } = require('./fuentes');

// Pasado esto sin respuesta buena de TODAS las empresas, la lista no vale.
// Nueve sondeos fallidos seguidos: uno suelto no basta para tirarla.
const FRESCA_MS = Number(process.env.BOLT_V2_FRESCA_MS) || 45000;

// De la v2 al vocabulario de la casa (fv_cat_situacion). `fv_estado_bolt` es
// el de la v1 y no tiene estos códigos.
const SITUACION = { on_ride: 'viaje', waiting: 'espera', on_break: 'descanso' };
const desconocidos = new Set();

const EMPRESAS = String(process.env.BOLT_V2_EMPRESAS || '143626')
  .split(',').map(s => Number(s.trim())).filter(Boolean);
const empresas = () => EMPRESAS;

// UNA LISTA VACÍA NO SE CREE A LA PRIMERA. Si antes había gente y de golpe BOLT
// dice que nadie, puede ser un fallo suyo: tomarla por buena pintaría a toda la
// flota desconectada y daría por fiables los rojos del mapa. Se espera a que lo
// repita VACIA_CONFIRMAR veces seguidas (15 s); mientras, vale la anterior.
const VACIA_ANTES_MIN = 5;
const VACIA_CONFIRMAR = 3;
// Mientras una empresa siga fallando, se recuerda en el log cada tanto.
const RECORDAR_FALLO_MS = 15 * 60 * 1000;

const porEmpresa = new Map();   // empresa → { at, conductores } (la última respuesta buena)
const fallando = new Map();     // empresa → { desde, mensaje, intentos, avisadoAt } (mientras falla)
const vacias = new Map();       // empresa → respuestas vacías seguidas sin confirmar
const vaciaAviso = new Map();   // empresa → { at, descartadas } (el aviso de vacías, como mucho cada 15 min)
// La ÚLTIMA VEZ que se vio conectado a cada conductor y a cada coche. Cuando
// alguien desaparece de la lista, se desconectó entre esa vez y ahora: es su
// «desconectado desde» con cinco segundos de margen. Se pierde al reiniciar.
const visto = { conductor: new Map(), vehiculo: new Map() };
let combinada = null;           // { at, completa, porUuid, porVehiculo, porMatricula, huella }
let enCurso = null;
let ultimoIntento = 0;
let sondeos = 0;
let fallos = 0;
let estabaVigente = false;

const hora = ms => new Intl.DateTimeFormat('es-ES',
  { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ms);

// EL VIAJE EN CURSO (current_order), para que el mapa enseñe de dónde a dónde
// va quien está de viaje (Camilo, 28/10/2026). Solo las fases en que hay un
// cliente de por medio: una oferta sin aceptar o un viaje ya acabado no son un
// viaje en curso. Forma de la especificación de BOLT (open-api.json,
// IntegrationOrderStop): { type: pickup|dropoff|waypoint|change_point, address,
// location: {lat, lng}, arrived_at_datetime, departed_at_datetime }.
//
// Las direcciones son del cliente: se quedan en memoria, como todo lo de aquí,
// y no se guardan en ninguna tabla.
const VIAJE_EN_CURSO = new Set(['driver_accepted', 'driver_arrived_to_client', 'driving_with_client', 'arrived_to_destination']);
const CON_CLIENTE = new Set(['driving_with_client', 'arrived_to_destination']);

function viajeDe(o) {
  if (!o || typeof o !== 'object' || !VIAJE_EN_CURSO.has(o.state)) return null;
  const paradas = (Array.isArray(o.stops) ? o.stops : []).filter(s => s && s.location
    && Number.isFinite(Number(s.location.lat)) && Number.isFinite(Number(s.location.lng)));
  const punto = s => s && { lat: Number(s.location.lat), lng: Number(s.location.lng), direccion: s.address || null };
  // Por su tipo y no por su sitio en la lista: BOLT no garantiza el orden.
  const recogida = paradas.find(s => s.type === 'pickup');
  const destino = paradas.slice().reverse().find(s => s.type === 'dropoff');
  return {
    estado: o.state,
    categoria: o.category_name || null,
    programado: o.type === 'scheduled',
    recogida: punto(recogida) || null,
    destino: punto(destino) || null,
    paradas: paradas.filter(s => s.type === 'waypoint').length,
    // Con el cliente dentro: por la fase o porque ya salió de la recogida.
    conCliente: CON_CLIENTE.has(o.state) || !!(recogida && recogida.departed_at_datetime),
  };
}

function traducir(d) {
  const code = (d.current_state && d.current_state.code) || null;
  let situacion = SITUACION[code];
  if (!situacion) {
    situacion = 'otro';
    if (!desconocidos.has(code)) {
      desconocidos.add(code);
      console.warn(`⚠️ [BOLT v2] Estado desconocido «${code}»: sale como «otro»`);
    }
  }
  const v = d.vehicle || {};
  const desde = d.current_state && d.current_state.changed_at ? new Date(d.current_state.changed_at) : null;
  return {
    uuid: String(d.uuid),
    situacion,
    estadoBolt: code,
    desde: desde && !isNaN(desde) ? desde : null,
    vehiculoUuid: v.uuid ? String(v.uuid) : null,
    matricula: v.normalised_registration_number || v.registration_number || null,
    nombre: [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || d.display_name || null,
    telefono: d.phone || null,
    viaje: viajeDe(d.current_order),
  };
}

/** Junta las empresas en una sola lista, por conductor, por coche y por matrícula. */
function combinar(ids) {
  const partes = ids.map(id => porEmpresa.get(id));
  const completa = partes.every(Boolean);
  const buenas = partes.filter(Boolean);
  const porUuid = new Map(), porVehiculo = new Map(), porMatricula = new Map();
  buenas.forEach(p => p.conductores.forEach(c => {
    porUuid.set(c.uuid, c);
    // El mismo coche con dos conductores no debería pasar; si pasa, el cambio
    // de estado más reciente.
    const gana = (m, k) => {
      const prev = m.get(k);
      if (!prev || (c.desde && (!prev.desde || c.desde > prev.desde))) m.set(k, c);
    };
    if (c.vehiculoUuid) gana(porVehiculo, c.vehiculoUuid);
    if (c.matricula) gana(porMatricula, normMat(c.matricula));
  }));
  // La hora de la lista es la de su parte MÁS VIEJA: es lo que se puede afirmar.
  const at = buenas.length ? Math.min(...buenas.map(p => p.at)) : 0;
  const huella = completa + '|' + [...porUuid.values()]
    // La fase del viaje y su destino también: pasar de «va a recoger» a «con
    // el cliente» cambia lo que pinta el mapa aunque el estado sea el mismo.
    .map(c => `${c.uuid}:${c.situacion}:${c.desde ? c.desde.getTime() : ''}:${c.vehiculoUuid || ''}`
      + (c.viaje ? `:${c.viaje.estado}:${c.viaje.conCliente}:${c.viaje.destino ? c.viaje.destino.lat + ',' + c.viaje.destino.lng : ''}` : ''))
    .sort().join(',');
  return { at, completa, porUuid, porVehiculo, porMatricula, huella };
}

/**
 * Pregunta a BOLT por las empresas del directo, a la vez. Una que falle no
 * tumba las demás: se queda con su última respuesta buena hasta que caduque.
 *
 * Devuelve { cambio } —si lo que sabemos es distinto de antes, para que quien
 * llama invalide la foto del ahora— o null si la v2 no está configurada.
 */
function refrescar() {
  if (!bolt.v2Configurada()) { anotar(); return Promise.resolve(null); }
  if (enCurso) return enCurso;
  // Con TODO fallando más de un minuto (credenciales malas, BOLT caído) no se
  // insiste cada 5 s: una vez cada 30 s hasta que vuelva.
  const ids0 = empresas();
  if (ids0.every(id => fallando.has(id))) {
    const racha = Date.now() - Math.min(...ids0.map(id => fallando.get(id).desde));
    if (racha > 60000 && Date.now() - ultimoIntento < 30000) {
      return Promise.resolve({ cambio: anotar(), ok: 0, de: ids0.length, esperando: true });
    }
  }
  ultimoIntento = Date.now();
  enCurso = (async () => {
    const ids = empresas();
    const r = await Promise.allSettled(ids.map(id => bolt.onlineDriversV2(id)));
    const at = Date.now();
    r.forEach((x, i) => {
      const id = ids[i];
      if (x.status === 'fulfilled') {
        // Ha contestado: deja de contar como caída AUNQUE luego no se crea lo
        // que dice (una vacía sin confirmar). Si no, la espera de 30 s de las
        // caídas retrasaba un minuto la confirmación.
        if (fallando.has(id)) {
          const f = fallando.get(id);
          console.log(`✅ [BOLT v2] ${id} vuelve a contestar (fallaba desde las ${hora(f.desde)}, ${f.intentos} intento(s))`);
          fallando.delete(id);
        }
        // Lo que no sea un conductor (un null en la lista) se descarta: no
        // puede tumbar el sondeo entero.
        const conductores = x.value.filter(d => d && typeof d === 'object' && d.uuid).map(traducir);
        const antes = porEmpresa.get(id);
        if (!conductores.length && antes && antes.conductores.length >= VACIA_ANTES_MIN) {
          const n = (vacias.get(id) || 0) + 1;
          vacias.set(id, n);
          if (n < VACIA_CONFIRMAR) {
            // Un aviso cada 15 min como mucho, con las descartadas entre medias:
            // si BOLT alterna vacía y llena, no se inunda el log.
            const a = vaciaAviso.get(id) || { at: 0, descartadas: 0 };
            a.descartadas++;
            if (at - a.at >= RECORDAR_FALLO_MS) {
              console.warn(`⚠️ [BOLT v2] ${id} dice que no hay nadie conectado (antes ${antes.conductores.length}): se espera a que lo repita` +
                (a.descartadas > 1 ? ` (${a.descartadas} vacías descartadas desde el último aviso)` : ''));
              a.at = at;
              a.descartadas = 0;
            }
            vaciaAviso.set(id, a);
            return;
          }
          console.warn(`⚠️ [BOLT v2] ${id}: ${n} respuestas seguidas sin nadie conectado; se da por buena`);
        }
        vacias.delete(id);
        porEmpresa.set(id, { at, conductores });
        conductores.forEach(c => {
          visto.conductor.set(c.uuid, { at, vehiculoUuid: c.vehiculoUuid, matricula: c.matricula });
          if (c.vehiculoUuid) {
            visto.vehiculo.set(c.vehiculoUuid, { at, conductorUuid: c.uuid, nombre: c.nombre, telefono: c.telefono });
          }
        });
      } else {
        fallos++;
        const mensaje = (x.reason && x.reason.message) || String(x.reason);
        const f = fallando.get(id) || { desde: at, intentos: 0, avisadoAt: 0 };
        f.intentos++;
        f.mensaje = mensaje;
        // Una línea al empezar la racha y un recordatorio cada 15 min, no una cada 5 s.
        if (!f.avisadoAt) console.error(`❌ [BOLT v2] ${id}: ${mensaje}`);
        else if (at - f.avisadoAt >= RECORDAR_FALLO_MS) {
          console.error(`❌ [BOLT v2] ${id} sigue fallando desde las ${hora(f.desde)} (${f.intentos} intentos): ${mensaje}`);
        }
        if (!f.avisadoAt || at - f.avisadoAt >= RECORDAR_FALLO_MS) f.avisadoAt = at;
        fallando.set(id, f);
      }
    });
    sondeos++;
    const nueva = combinar(ids);
    // También es un cambio que la lista empiece o deje de valer: la foto del
    // ahora hecha con la v2 (o con la base) ya no vale aunque la lista sea igual.
    const cambio = !combinada || combinada.huella !== nueva.huella;
    combinada = nueva;
    const salto = anotar();
    return { cambio: cambio || salto, ok: r.filter(x => x.status === 'fulfilled').length, de: ids.length };
  })().finally(() => { enCurso = null; anotar(); });
  return enCurso;
}

/**
 * La lista, SI VALE: completa (todas las empresas) y fresca. Si no, null y la
 * foto del ahora tira de la base.
 */
function vigente() {
  if (!combinada || !combinada.completa || !bolt.v2Configurada()) return null;
  if (Date.now() - combinada.at > FRESCA_MS) return null;
  return { ...combinada, at: new Date(combinada.at), visto };
}

/**
 * QUE LA v2 HABLE TAMBIÉN CUANDO VA BIEN. Con solo errores, un log callado no
 * distinguía «funciona» de «no está ni configurada». Una línea cuando la lista
 * empieza a valer y otra cuando deja de valer, con el porqué. Devuelve si ha
 * habido salto, para que la foto del ahora se rehaga en el momento.
 */
function anotar() {
  const ahora = !!vigente();
  if (ahora === estabaVigente) return false;
  estabaVigente = ahora;
  if (ahora) {
    console.log(`✅ [BOLT v2] Lista de conectados al día: ${combinada.porUuid.size} conectados (${empresas().join(', ')}). ` +
      'El mapa, En directo e Inicio salen de la v2; la ingesta de la v1 pasa a una vez por minuto.');
    return true;
  }
  const porque = !bolt.v2Configurada() ? 'faltan las credenciales'
    : !combinada || !combinada.completa ? 'falta la respuesta de alguna empresa'
      : `sin respuesta buena desde las ${hora(combinada.at)}`;
  console.warn(`⏸️ [BOLT v2] La lista de conectados ya no vale (${porque}): el ahora vuelve a la base y la ingesta de la v1 a cada 10 s.`);
  return true;
}

/** Para diagnosticar sin abrir nada. Sin nombres ni teléfonos. */
const estado = () => ({
  configurada: bolt.v2Configurada(),
  vigente: !!vigente(),
  edadMs: combinada && combinada.at ? Date.now() - combinada.at : null,
  conectados: combinada ? combinada.porUuid.size : 0,
  sondeos, fallos,
  empresas: empresas().map(id => ({
    id,
    at: porEmpresa.has(id) ? new Date(porEmpresa.get(id).at) : null,
    conectados: porEmpresa.has(id) ? porEmpresa.get(id).conductores.length : null,
    fallo: fallando.has(id) ? fallando.get(id).mensaje : null,
    fallaDesde: fallando.has(id) ? new Date(fallando.get(id).desde) : null,
    vaciasSinConfirmar: vacias.get(id) || 0,
  })),
});

/** Solo para las pruebas: vuelve a empezar como recién arrancado. */
function _reiniciar() {
  porEmpresa.clear(); fallando.clear(); vacias.clear(); vaciaAviso.clear(); visto.conductor.clear(); visto.vehiculo.clear();
  combinada = null; enCurso = null; ultimoIntento = 0; sondeos = 0; fallos = 0; estabaVigente = false;
}

module.exports = { refrescar, vigente, estado, traducir, viajeDe, SITUACION, FRESCA_MS, _reiniciar };
