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

const porEmpresa = new Map();   // empresa → { at, conductores } (la última respuesta buena)
const fallando = new Map();     // empresa → { desde, mensaje } (mientras falla)
// La ÚLTIMA VEZ que se vio conectado a cada conductor y a cada coche. Cuando
// alguien desaparece de la lista, se desconectó entre esa vez y ahora: es su
// «desconectado desde» con cinco segundos de margen. Se pierde al reiniciar.
const visto = { conductor: new Map(), vehiculo: new Map() };
let combinada = null;           // { at, completa, porUuid, porVehiculo, porMatricula, huella }
let enCurso = null;
let ultimoIntento = 0;
let sondeos = 0;
let fallos = 0;

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
    .map(c => `${c.uuid}:${c.situacion}:${c.desde ? c.desde.getTime() : ''}:${c.vehiculoUuid || ''}`)
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
  if (!bolt.v2Configurada()) return Promise.resolve(null);
  if (enCurso) return enCurso;
  // Con TODO fallando más de un minuto (credenciales malas, BOLT caído) no se
  // insiste cada 5 s: una vez cada 30 s hasta que vuelva.
  const ids0 = empresas();
  if (ids0.every(id => fallando.has(id))) {
    const racha = Date.now() - Math.min(...ids0.map(id => fallando.get(id).desde));
    if (racha > 60000 && Date.now() - ultimoIntento < 30000) return Promise.resolve({ cambio: false, ok: 0, de: ids0.length, esperando: true });
  }
  ultimoIntento = Date.now();
  enCurso = (async () => {
    const ids = empresas();
    const r = await Promise.allSettled(ids.map(id => bolt.onlineDriversV2(id)));
    const at = Date.now();
    r.forEach((x, i) => {
      const id = ids[i];
      if (x.status === 'fulfilled') {
        const conductores = x.value.map(traducir);
        porEmpresa.set(id, { at, conductores });
        conductores.forEach(c => {
          visto.conductor.set(c.uuid, { at, vehiculoUuid: c.vehiculoUuid, matricula: c.matricula });
          if (c.vehiculoUuid) {
            visto.vehiculo.set(c.vehiculoUuid, { at, conductorUuid: c.uuid, nombre: c.nombre, telefono: c.telefono });
          }
        });
        if (fallando.has(id)) {
          console.log(`✅ [BOLT v2] ${id} vuelve a contestar (fallaba desde ${new Date(fallando.get(id).desde).toISOString()})`);
          fallando.delete(id);
        }
      } else {
        fallos++;
        const mensaje = (x.reason && x.reason.message) || String(x.reason);
        // Una línea por racha, no una cada 5 s.
        if (!fallando.has(id)) console.error(`❌ [BOLT v2] ${id}: ${mensaje}`);
        fallando.set(id, { desde: (fallando.get(id) || {}).desde || at, mensaje });
      }
    });
    sondeos++;
    const nueva = combinar(ids);
    const cambio = !combinada || combinada.huella !== nueva.huella;
    combinada = nueva;
    return { cambio, ok: r.filter(x => x.status === 'fulfilled').length, de: ids.length };
  })().finally(() => { enCurso = null; });
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
  })),
});

/** Solo para las pruebas: vuelve a empezar como recién arrancado. */
function _reiniciar() {
  porEmpresa.clear(); fallando.clear(); visto.conductor.clear(); visto.vehiculo.clear();
  combinada = null; enCurso = null; ultimoIntento = 0; sondeos = 0; fallos = 0;
}

module.exports = { refrescar, vigente, estado, traducir, SITUACION, FRESCA_MS, _reiniciar };
