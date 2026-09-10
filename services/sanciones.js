// ============================================================
// EXCESOS DE VELOCIDAD (Operaciones) — avisar, siempre, y llevar la cuenta
// ============================================================
// Flujo (cron cada 15 min). TODO SALE DE POSTGRESQL: este módulo no llama a
// ninguna API. Las dos ingestas ya han traído lo que hace falta.
//   1) `mapon_alerta` (ingesta de Mapon, cada 15 min) da los excesos de
//      'speeding' con su clave, su instante y su matrícula.
//   2) `fv_tramo` (ingesta de Bolt, cada 5 min) dice qué conductor llevaba ese
//      coche y entre qué horas, y por tanto quién iba al volante en ese minuto.
//   3) SE AVISA. Siempre, con la misma plantilla, tantas veces como haga falta.
//   4) Queda registrado en `velocidad_exceso`, y de ahí salen las dos preguntas
//      del módulo: cuántas veces se le ha dicho a cada uno, y qué ha pasado.
//
// ── Lo que este módulo YA NO HACE ───────────────────────────────────────────
// Antes era un expediente sancionador: la primera vez avisaba y, a partir de la
// segunda dentro de tres meses, abría un caso que alguien tenía que aprobar a
// mano para mandar OTRA plantilla más dura. En la práctica eso lo convertía en
// una bandeja de aprobaciones, y lo que de verdad se quería saber —quién sigue
// corriendo después de que se le diga— quedaba enterrado entre estados.
//
// Ahora el mensaje es siempre el mismo y siempre automático. La escalada, si
// hace falta, la decide una persona mirando quién acumula avisos: eso es
// información, no un trámite.
//
// ── Lo que sí se mantiene, porque sigue siendo verdad ───────────────────────
//   · Si no se sabe con confianza quién conducía, NO se avisa. Avisar al que no
//     fue era malo cuando pasaba una vez; ahora que es automático y repetido,
//     sería peor. Queda registrado para mirarlo a mano.
//   · MODO: 'test' por defecto (no envía nada, marca 'simulado'); 'live' envía.
//     Se cambia con la variable de entorno SANCIONES_MODO=live.
//
// ── POR QUÉ YA NO SE LLAMA A NINGUNA API ──────────────────────────────
// Porque ya lo sabíamos, y para eso se hizo la ingesta.
//
// Este módulo le preguntaba a Mapon por las alertas de velocidad —que la ingesta
// acababa de guardar en `mapon_alerta`, con la MISMA clave que usa el dedup— y
// después le preguntaba a Bolt quién conducía —que la ingesta tiene en
// `fv_tramo`—. Dos APIs para leer lo que había en casa.
//
// Y lo de Bolt se hacía de la peor manera posible: por cada exceso, hasta SIETE
// barridos paginados de `getFleetStateLogs` con ventanas crecientes hasta 15
// días, contra las dos flotas. Medido el 10/09: la ventana de 15 días descarga
// 65.884 logs y tarda 90 segundos, más los HTTP 429 de Bolt, que añaden 5 s cada
// uno. Y ese camino —el largo— es justo el que recorren los coches que NO están
// en Bolt: minuto y medio para acabar diciendo "no hay conductor". Por eso
// "Revisar ahora" se quedaba pensando.
//
// Las mismas 30 alertas resueltas contra PostgreSQL: 2,6 segundos, el mismo
// conductor en las 24 resolubles, cero discrepancias. Y más exacto, además,
// porque se sabe si el exceso cae DENTRO del tramo de esa persona en vez de
// "cuánto hace del último cambio de estado".
//
// ── Y SI LA INGESTA NO HA LLEGADO ───────────────────────────────────
// Se ESPERA. Un exceso posterior al último tramo que trajo la ingesta no se
// registra: se deja para la pasada siguiente. No es lo mismo "no había nadie" que
// "todavía no lo sé", y escribir lo primero cuando pasa lo segundo es como se
// acusa a alguien de conducir un coche que no llevaba, o como se deja sin avisar
// a quien sí corrió.

// Ni `bolt` ni `mapon`: lo que este módulo necesita ya está en PostgreSQL, puesto
// por la ingesta. Lo único que sale fuera es el WhatsApp, que es el trabajo.
const whatsapp = require('./whatsapp');
const repo = require('./repo/velocidad');

const PLANTILLA_ADVERTENCIA = 'advertencia_limite';

const modo = () => (process.env.SANCIONES_MODO === 'live' ? 'live' : 'test');
const esLive = () => modo() === 'live';

/**
 * FECHA DE ALTA DEL SISTEMA (SANCIONES_DESDE, formato aaaa-mm-dd).
 *
 * No se puede sancionar por reincidencia usando excesos anteriores a que el sistema
 * existiera: al conductor nunca se le avisó de ellos, así que no puede "reincidir".
 * Con esta fecha puesta, todo lo anterior:
 *   · NI se registra (las alertas viejas se ignoran aunque se pida un rango amplio),
 *   · NI cuenta como infracción previa (aunque queden filas antiguas en el libro).
 * Sin ella el módulo se comporta como antes (cuenta todo el histórico).
 */
function inicioSistemaTs() {
  const s = (process.env.SANCIONES_DESDE || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  // Medianoche de ese día en hora peninsular (el desfase se saca del propio día).
  const mediodiaUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour12: false, hour: '2-digit' }).format(new Date(mediodiaUTC)));
  const offsetSeg = (h - 12) * 3600;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - offsetSeg * 1000;
}
const DESDE_TS = inicioSistemaTs();

/**
 * MEDIA HORA. Hasta ahí la atribución es un dato; a partir de ahí es una conjetura.
 *
 * El motivo es el relevo. Estos coches cambian de manos cada turno, y entre que
 * uno lo deja y el otro se conecta hay un hueco de silencio en los logs. Si el
 * último rastro es de hace 45 minutos, el exceso puede perfectamente ser del que
 * acaba de recibir el coche y aún no se ha puesto en marcha en BOLT: avisar al
 * anterior sería cargarle lo que hizo otro.
 *
 * Media hora es el margen en el que un relevo normal ya ha dejado huella. Por
 * encima, el caso se registra pero NO se avisa a nadie y queda para mirarlo a
 * mano: es preferible revisar que acusar al que no fue.
 *
 * (La intención a futuro es que el propio `busy` haga de fichaje del relevo —el
 * que entrega lo quita, el que recibe lo pone— y entonces la responsabilidad
 * dejará de deducirse y pasará a estar declarada. Mientras tanto, media hora.)
 */
const VENTANA_FIABLE_SEG = Number(process.env.SANCIONES_VENTANA_FIABLE || 1800);
const humanizar = seg => seg < 3600 ? `${Math.round(seg / 60)} min`
  : seg < 86400 ? `${Math.round(seg / 3600)} h` : `${Math.round(seg / 86400)} días`;

// Los estados que puede tener un exceso. Viven también en el CHECK de la tabla:
// si aquí se añade uno, allí también.
const EST = {
  AVISADO: 'avisado',              // se le mandó el WhatsApp
  SIMULADO: 'simulado',            // modo pruebas: se habría mandado
  SIN_CONDUCTOR: 'sin_conductor',  // el coche no tenía a nadie identificable
  DUDOSO: 'dudoso',                // hay candidato, pero el log es demasiado viejo
  ERROR: 'error'                   // se intentó mandar y falló
};

const normPlaca = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const fmtMadrid = ms => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(ms));

/**
 * ¿Quién llevaba la matrícula X en el instante tMs?
 *
 * Una consulta a `fv_tramo`. Devuelve { driver_uuid, ventanaSeg, dentro } o
 * { error }, donde el error puede ser 'esperando-ingesta' —que NO es un fallo:
 * es que todavía no se puede saber, y hay que volver a preguntarlo luego—.
 */
async function conductorDeMatricula(matricula, tMs) {
  // PRIMERO, ¿sabe la ingesta lo que pasó en ese minuto?
  //
  // Va antes que nada porque si no, un tramo todavía ABIERTO contesta que sí a
  // cualquier instante posterior: el coche "sigue" con su último conductor, y un
  // exceso de dentro de una hora saldría atribuido a quien iba esta tarde.
  const fresca = await repo.frescuraIngesta();
  if (!fresca || fresca.getTime() < tMs) {
    return { error: 'esperando-ingesta', hasta: fresca ? fresca.toISOString() : null };
  }

  const m = await repo.quienConducia(matricula, new Date(tMs).toISOString());
  if (m) {
    return {
      driver_uuid: m.driverUuid,
      ventanaSeg: m.antiguedadSeg,
      dentro: m.dentro, desconectado: m.desconectado, situacion: m.situacion,
      desdeTramo: m.desde, hastaTramo: m.hasta,
    };
  }

  return (await repo.conoceMatricula(matricula))
    ? { error: 'sin-conductor' }
    : { error: 'matricula-desconocida' };
}

// ── Padrón (driver_uuid → nombre, teléfono y ficha) ────────────────────────
// De PostgreSQL. Antes eran dos hojas de cálculo encadenadas —el padrón de BOLT
// y una tabla de teléfonos por nombre—, cada una con su `.catch()`: cuando
// fallaban, el módulo se quedaba sin teléfono, el aviso no salía y nadie se
// enteraba de por qué. Se cachea un minuto porque una tanda de excesos se
// procesa entera de golpe.
let _cachePadron = { ts: 0, mapa: null };
async function datosConductor(driverUuid) {
  if (!_cachePadron.mapa || Date.now() - _cachePadron.ts > 60 * 1000) {
    _cachePadron = { ts: Date.now(), mapa: await repo.padron() };
  }
  return _cachePadron.mapa.get(String(driverUuid)) || { nombre: '', telefono: '', conductorId: null };
}

/**
 * El aviso. Es SIEMPRE el mismo: la plantilla 'advertencia_limite', ya aprobada
 * en Meta, con el nombre y la matrícula como variables. No hay una segunda
 * plantilla ni un segundo tono: si alguien no hace caso, lo que cambia no es el
 * mensaje sino el número de veces que aparece en la lista.
 */
async function enviar(telefono, nombre, matricula) {
  if (!esLive()) return { ok: true, simulado: true };
  if (!telefono) return { ok: false, error: 'sin-telefono' };
  return whatsapp.enviarPlantillaPosicional(telefono, PLANTILLA_ADVERTENCIA, [nombre, matricula]);
}

// ── Procesar (lo llama el cron) ─────────────────────────────────────────────
let _corriendo = false;
let _ultimo = { ts: null, nuevos: 0, resumen: null };

async function procesar(opciones = {}) {
  if (_corriendo) return { saltado: true, motivo: 'ya en curso' };
  _corriendo = true;
  const res = { modo: modo(), leidas: 0, nuevas: 0, avisos: 0, sinConductor: 0,
    dudosas: 0, errores: 0, esperando: 0, detalle: [] };
  try {
    // Ventana de lectura: por defecto los últimos 3 días. Ya no cuesta nada —es
    // una consulta— y así una alerta que Mapon entregue con retraso se recoge
    // igual. Lo que evita repetir avisos no es la ventana: es la clave.
    const dias = Number(opciones.dias) || 3;
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - dias * 86400000);

    // Los excesos que la ingesta ya trajo y que aún no tienen fila en el libro.
    // El dedup va en la propia consulta (NOT EXISTS), no en un Set en memoria.
    const alertas = await repo.excesosPendientes({ desde, hasta });
    res.leidas = alertas.length;

    // Hasta dónde sabe la ingesta de Bolt: lo posterior no se puede resolver aún.
    const fresca = await repo.frescuraIngesta();
    res.ingestaHasta = fresca ? fresca.toISOString() : null;

    // Vienen de la más antigua a la más reciente, que es como se leen los hechos.
    for (const a of alertas) {
      const tMs = a.tMs;
      // Anterior al alta del sistema: ni se registra ni se avisa. Evita que una
      // consulta con rango amplio mande WhatsApps por excesos de hace meses.
      if (DESDE_TS && tMs < DESDE_TS) { res.previosAlAlta = (res.previosAlAlta || 0) + 1; continue; }
      res.nuevas++;

      const base = {
        clave: a.clave, ocurridoAt: new Date(tMs).toISOString(), placa: normPlaca(a.matricula),
        velocidad: a.velocidad, limite: a.limite, exceso: a.exceso,
      };

      // ── ¿Quién conducía? ──────────────────────────────────────────────────
      let r;
      try { r = await conductorDeMatricula(a.matricula, tMs); }
      catch (e) { r = { error: 'excepcion', msg: e.message }; }

      // LA INGESTA NO HA LLEGADO A ESE MINUTO: no se escribe nada.
      //
      // Registrarlo como "sin conductor" sería mentir, y además definitivo: la
      // clave quedaría en el libro y ese exceso no se volvería a mirar nunca. Se
      // deja para la pasada siguiente, cuando la ingesta ya haya pasado por ahí.
      if (r.error === 'esperando-ingesta') {
        res.esperando++;
        res.nuevas--;
        continue;
      }

      if (r.error || !r.driver_uuid) {
        res.sinConductor++;
        await repo.registrar({ ...base, estado: EST.SIN_CONDUCTOR,
          nota: r.error === 'matricula-desconocida' ? 'La matrícula no está en Bolt'
            : r.error === 'sin-conductor' ? 'El coche estaba desconectado de Bolt en ese momento'
            : (r.msg || r.error || 'no se pudo resolver') });
        res.detalle.push({ matricula: a.matricula, estado: EST.SIN_CONDUCTOR });
        continue;
      }

      const { nombre, telefono, conductorId } = await datosConductor(r.driver_uuid);
      const quien = {
        driverUuid: r.driver_uuid, conductorId, conductor: nombre || null, telefono: telefono || null,
        ventanaSeg: r.ventanaSeg,
      };

      // ── Atribución dudosa: se registra, pero no se avisa ───────────────────
      // El coche cambia de manos cada turno. Si el último log del que se deduce
      // el conductor es de hace horas, "el último que lo condujo" puede
      // perfectamente no ser quien iba al volante.
      if (r.ventanaSeg > VENTANA_FIABLE_SEG) {
        res.dudosas++;
        await repo.registrar({ ...base, ...quien, estado: EST.DUDOSO,
          nota: `Candidato: ${nombre || r.driver_uuid} (se desconectó de la app ` +
            `${humanizar(r.ventanaSeg)} antes del exceso; el coche pudo cambiar de manos). ` +
            'Confirmar antes de avisar.' });
        res.detalle.push({ matricula: a.matricula, conductor: nombre, estado: EST.DUDOSO });
        continue;
      }

      // ── Se avisa. Siempre. ────────────────────────────────────────────────
      const env = await enviar(telefono, nombre, a.matricula);
      const estado = env.ok ? (env.simulado ? EST.SIMULADO : EST.AVISADO) : EST.ERROR;
      if (estado === EST.ERROR) res.errores++; else res.avisos++;
      await repo.registrar({ ...base, ...quien, estado,
        plantilla: PLANTILLA_ADVERTENCIA,
        envioId: env.id || null,
        enviadoAt: estado === EST.AVISADO ? new Date().toISOString() : null,
        nota: estado === EST.ERROR ? (env.error || 'fallo de envío')
          : r.dentro
            ? `Estaba en la app en ese momento (${r.situacion || 'en ruta'})`
            : `Se desconectó de la app ${humanizar(r.ventanaSeg)} antes del exceso` });
      res.detalle.push({ matricula: a.matricula, conductor: nombre, estado });
    }
  } catch (e) {
    res.error = e.message;
    console.error('❌ [VELOCIDAD] procesar:', e.stack || e.message);
  } finally {
    _corriendo = false;
    _ultimo = { ts: Date.now(), nuevos: res.nuevas, resumen: res };
  }
  return res;
}

function estadoModulo() {
  return {
    modo: modo(), corriendo: _corriendo, ultimo: _ultimo,
    plantilla: PLANTILLA_ADVERTENCIA,
    // Desde cuándo cuenta el sistema: lo anterior no genera avisos. Se llama
    // `altaSistema` y no `desde` porque la pantalla ya tiene un `desde` —el del
    // rango que se mira— y son cosas distintas: mezclarlos dejaba el rango a
    // null y la pantalla en blanco.
    altaSistema: DESDE_TS ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(DESDE_TS)) : null,
  };
}

module.exports = {
  EST, DESDE_TS, PLANTILLA_ADVERTENCIA,
  procesar, estadoModulo, conductorDeMatricula, modo,
  // La lectura la sirve el repositorio; se reexporta para que las rutas tengan
  // una sola puerta a este módulo.
  porConductor: (...a) => repo.porConductor(...a),
  historico: (...a) => repo.historico(...a),
  resumen: (...a) => repo.resumen(...a),
};
