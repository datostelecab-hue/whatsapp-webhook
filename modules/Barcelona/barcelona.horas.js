// ============================================================
// LAS HORAS DE BARCELONA — de los cambios de estado de BOLT al reporte
// ============================================================
// Puro: no lee nada. El servicio le da los apuntes de BOLT (sede_bolt_state_log),
// el planificador (sede_asignacion, sus periodos con CT y sus descansos: db/181 y
// db/234) y las cuentas, y aquí se cuenta.
//
// LA MISMA REGLA QUE MADRID (Camilo, 07/10/2026: «si es de día el mismo flujo de
// Madrid, revisar qué hizo X día de 00:00 a 23:59 y si es de noche… desde las 12
// PM hasta el día Y hasta las 12 PM»). No se reescribe: se usa la de Madrid,
// services/flotaViva/repartoTurnos.js, con el plan de Barcelona:
//
//   · Quien tiene plaza de DÍA cuenta de 00:00 a 24:00; quien la tiene de NOCHE,
//     de 12:00 a 12:00 del día siguiente.
//   · Quien trabaja sin plaza va por su hora de inicio (antes de las 12:00, día).
//   · Cuenta el trabajo: viaje y espera. El descanso no (fv_cat_situacion.efectivo).
//
// Y «No salió» (Camilo, 07/10/2026): quien tenía que trabajar y no hizo ni un
// minuto en la ventana de su turno, no salió. Hasta el 06/11/2026 Barcelona no
// tenía libranzas y eso era todo. Desde db/234 las tiene (Camilo: «ahora
// necesito agregarle días de libranzas desde el planificador»), así que «tenía
// que trabajar» lo dice el plan del día (barcelona.plan.js), no la asignación
// en crudo: el día que un fijo libra sale «Libra», no «No salió»; y un CT solo
// cuenta los días que cubre.
//
// DE LOS APUNTES A LOS RATOS. BOLT apunta CAMBIOS: cada apunte dice en qué estado
// entra el conductor y dura hasta su siguiente apunte. Dos apuntes en el mismo
// segundo se desempatan como en Madrid (desempate.js), y lo último que se sabe
// dura hasta ahora.

const R = require('../../services/flotaViva/repartoTurnos');
const P = require('./barcelona.plan');
const desempate = require('../../services/flotaViva/desempate');
const { banda } = require('../Control/reporteHoras.repo');

const EFECTIVAS = new Set(['viaje', 'espera']);
const TURNOS = ['dia', 'noche'];

// UN ESTADO DE TRABAJO NO DURA MÁS DE ESTO SIN OTRO APUNTE. Si BOLT no avisa de
// que alguien se desconectó (el móvil se apaga en espera), lo último que se sabe
// es «en espera» y duraría hasta el siguiente apunte, días después. Con los datos
// de Barcelona del 04 al 07/10 (1.704 apuntes, 1.368 ratos de trabajo; script
// barcelona-horas-prueba.js de los análisis) el rato más largo fue de 3 h y
// ninguno pasó de 4: el tope no recorta nada normal, solo lo que no puede ser.
const TOPE_H = Number(process.env.BARCELONA_TOPE_ESTADO_H || 6);

/**
 * Los RATOS de cada conductor en [iniMs, finMs), de los apuntes de BOLT.
 *
 *   apuntes      [{ uuid, veh, estado, t (ms) }]. Conviene que traiga algún
 *                apunte de antes de `iniMs`: es lo que dice en qué estado estaba
 *                cada uno al empezar la ventana.
 *   situacionDe  estado de BOLT → la nuestra ('viaje', 'espera', 'descanso'…).
 *
 * Devuelve [{ uuid, situacion, ini, fin, veh }], solo de las `situaciones`
 * pedidas (por defecto, viaje y espera).
 */
function intervalos(apuntes, situacionDe, iniMs, finMs, { situaciones = EFECTIVAS, topeMs = TOPE_H * 3600000 } = {}) {
  const porConductor = new Map();
  (apuntes || []).forEach(a => {
    if (!a || !a.uuid || !(a.t > 0)) return;
    if (!porConductor.has(a.uuid)) porConductor.set(a.uuid, []);
    porConductor.get(a.uuid).push(a);
  });
  const out = [];
  porConductor.forEach((lista, uuid) => {
    desempate.ordenar(lista, situacionDe);
    lista.forEach((a, i) => {
      const sit = situacionDe(a.estado);
      if (!situaciones.has(sit)) return;
      const siguiente = i + 1 < lista.length ? lista[i + 1].t : finMs;
      const ini = Math.max(a.t, iniMs);
      const fin = Math.min(siguiente, finMs, a.t + topeMs);
      if (fin > ini) out.push({ uuid, situacion: sit, ini, fin, veh: a.veh || null });
    });
  });
  return out;
}

/**
 * Las reglas del plan (barcelona.plan.crear) de lo que da el servicio: las
 * asignaciones, sus periodos con CT y sus descansos. Sin periodos ni descansos
 * (antes de db/234) todos son fijos que no libran: lo de antes.
 */
const reglasDe = ({ asignaciones, cts, descansos } = {}) => P.crear({ asignaciones, cts, descansos });

/**
 * El plan para el reparto: (uuid, fecha) → Set de turnos que TRABAJA ese día.
 *
 * Con el plan del día (barcelona.plan), no con las asignaciones en crudo: el
 * día que un fijo libra no tiene turno planificado —sus horas, si las hace, van
 * por su hora de inicio, como las de quien no tiene plaza—, y un CT solo tiene
 * turno los días que cubre. Si no, repartoTurnos le daría a su turno lo que
 * hizo en su día libre.
 */
function planDesde(reglas) {
  const VACIO = new Set();
  const porFecha = new Map();
  return (uuid, fecha) => {
    if (!porFecha.has(fecha)) {
      const m = new Map();
      reglas.planDelDia(fecha).forEach(a => {
        if (!m.has(a.uuid)) m.set(a.uuid, new Set());
        m.get(a.uuid).add(a.turno);
      });
      porFecha.set(fecha, m);
    }
    return porFecha.get(fecha).get(uuid) || VACIO;
  };
}

/**
 * Las plazas distintas (turno + matrícula) de una lista, en el orden en que
 * aparecen: el TURNO ASIGNADO de alguien en un periodo. Si cambió de turno o de
 * coche, salen las dos. La de CT lleva `rol: 'ct'` (la de fijo, nada: lo de
 * siempre).
 */
function plazasDistintas(lista) {
  const out = [];
  (lista || []).forEach(p => {
    if (!p) return;
    const ct = p.rol === 'ct';
    if (out.some(q => q.turno === p.turno && q.matricula === p.matricula && (q.rol === 'ct') === ct)) return;
    out.push({ turno: p.turno, matricula: p.matricula, ...(ct ? { rol: 'ct' } : {}) });
  });
  return out;
}

/** Las fechas 'AAAA-MM-DD' de `desde` a `hasta`, las dos incluidas. */
function fechasEntre(desde, hasta) {
  const out = [];
  for (let f = desde; f <= hasta && out.length < 400; f = R.sumarDias(f, 1)) out.push(f);
  return out;
}

/** La ventana [ini, fin) en ms del turno de una fecha: día 00→24, noche 12→12. */
const ventana = (fecha, turno) => [R.instante(fecha, R.INICIO[turno]), R.instante(R.sumarDias(fecha, 1), R.INICIO[turno])];

const h1 = seg => Math.round(seg / 360) / 10;

/**
 * EL REPORTE DE HORAS de unas fechas.
 *
 *   ivs           los ratos de trabajo (intervalos()), desde el mediodía de la
 *                 víspera de `desde` hasta el mediodía del día después de `hasta`
 *   asignaciones  las de sede_asignacion que tocan esas fechas (y la víspera)
 *   cts           los periodos con CT de esas fechas (sede_coche_ct)
 *   descansos     los descansos de esas fechas (sede_descanso)
 *   conductores   [{ uuid, nombre, telefono, estado }] las cuentas de la sede
 *   coches        [{ uuid, matricula }] para decir en qué coche fue, si el
 *                 rato trae el uuid del coche y no ya su matrícula
 *
 * Devuelve { filas, sinPlan, porConductor, resumen }:
 *   filas         una por día y plaza con conductor: sus horas en SU turno y si
 *                 salió. De más antigua a más nueva; el día antes que la noche.
 *                 El fijo que libra ese día sale con estado «libra» (no es «No
 *                 salió»); el CT, solo los días que cubre.
 *   sinPlan       quien trabajó un día sin trabajar en ninguna plaza ese día:
 *                 sin plaza, o en su día de libranza (`libraba`, con la matrícula).
 *   porConductor  el resumen de cada uno en el periodo.
 */
function informe({ desde, hasta, ivs, asignaciones, cts, descansos, conductores, coches, ahoraMs = Date.now() }) {
  const fechas = fechasEntre(desde, hasta);
  const reglas = reglasDe({ asignaciones, cts, descansos });
  const planDe = planDesde(reglas);
  const { porPersona } = R.repartir((ivs || []).map(x => ({ ...x, persona: x.uuid })), planDe);
  const cuenta = new Map((conductores || []).map(c => [c.uuid, c]));
  const matDe = new Map((coches || []).filter(c => c.uuid).map(c => [c.uuid, c.matricula]));
  const nombreDe = uuid => (cuenta.get(uuid) || {}).nombre || `Cuenta ${String(uuid).slice(0, 8)}`;
  const telDe = uuid => (cuenta.get(uuid) || {}).telefono || '';
  const horasDe = (uuid, fecha, turno) => ((porPersona.get(uuid) || new Map()).get(R.clave(fecha, turno))) || null;
  // En qué coches de BOLT trabajó alguien dentro de una ventana.
  const ivsDe = new Map();
  (ivs || []).forEach(x => { if (!ivsDe.has(x.uuid)) ivsDe.set(x.uuid, []); ivsDe.get(x.uuid).push(x); });
  const cochesEn = (uuid, [ini, fin]) => [...new Set((ivsDe.get(uuid) || [])
    .filter(x => x.ini < fin && x.fin > ini && x.veh).map(x => matDe.get(x.veh) || x.veh))].sort();

  const filas = [];
  const sinPlan = [];
  fechas.forEach(fecha => {
    // Las plazas vigentes ese día: los fijos (trabajen o libren) y los CT que
    // trabajan. El CT que no cubre ese día no tiene nada que contar: no libra,
    // es que ese día no es suyo.
    const delDia = reglas.vigentesEn(fecha).filter(a => a.rol !== 'ct' || reglas.trabaja(a, fecha));
    TURNOS.forEach(turno => delDia.filter(a => a.turno === turno)
      .sort((a, b) => a.matricula.localeCompare(b.matricula) || (a.rol === 'ct') - (b.rol === 'ct'))
      .forEach(a => {
        const v = ventana(fecha, turno);
        if (reglas.libra(a, fecha)) {
          // EL DÍA QUE LIBRA. Sin horas en esta plaza: ese día no tenía turno en
          // ella. Si trabajó, se dice dónde fueron sus horas, con la misma
          // condición que «Sin plaza» de abajo (planDe): si ese día trabajaba en
          // OTRA plaza suya (es CT en otro coche, o hace su turno de noche), van
          // en la fila de esa plaza (horas y «fuera de su turno»); si no tenía
          // ninguna, van por su hora de inicio y salen en «Sin plaza».
          const hizo = (horasDe(a.uuid, fecha, 'dia') || { seg: 0 }).seg + (horasDe(a.uuid, fecha, 'noche') || { seg: 0 }).seg;
          const otras = [...new Set(reglas.planDelDia(fecha).filter(x => x.uuid === a.uuid)
            .map(x => `${x.matricula}${x.rol === 'ct' ? ' (CT)' : ''}`))];
          const obs = !(hizo > 0) ? ''
            : otras.length ? `Libraba; ese día trabajó en ${otras.join(', ')}`
              : `Libraba, pero trabajó ${String(h1(hizo)).replace('.', ',')} h (van en «Sin plaza»)`;
          filas.push({
            fecha, turno, rol: a.rol, matricula: a.matricula, uuid: a.uuid, nombre: nombreDe(a.uuid), telefono: telDe(a.uuid),
            horas: 0, viaje: 0, espera: 0, fuera: 0, estado: 'libra', coches: cochesEn(a.uuid, v), banda: null, obs,
          });
          return;
        }
        const x = horasDe(a.uuid, fecha, turno);
        const seg = x ? x.seg : 0;
        let estado;
        if (ahoraMs < v[0]) estado = 'pendiente';
        else if (seg > 0) estado = ahoraMs < v[1] ? 'en_curso' : 'salio';
        else estado = ahoraMs < v[1] ? 'todavia' : 'no_salio';
        // Lo que hizo ese día fuera de su turno (sin plaza en el otro): no se
        // suma a su plaza, pero se dice.
        const otro = turno === 'dia' ? 'noche' : 'dia';
        const fuera = planDe(a.uuid, fecha).has(otro) ? null : horasDe(a.uuid, fecha, otro);
        const usados = cochesEn(a.uuid, v);
        const obs = [];
        if (estado === 'salio' || estado === 'en_curso') {
          const b = banda(h1(seg));
          if (estado === 'salio' && b.obs) obs.push(b.obs);
        }
        if (usados.length && !usados.includes(a.matricula)) obs.push(`Trabajó en ${usados.join(', ')}, no en su matrícula`);
        if (fuera && fuera.seg > 0) obs.push(`Además, ${String(h1(fuera.seg)).replace('.', ',')} h fuera de su turno`);
        filas.push({
          fecha, turno, rol: a.rol, matricula: a.matricula, uuid: a.uuid, nombre: nombreDe(a.uuid), telefono: telDe(a.uuid),
          horas: h1(seg), viaje: h1(x ? x.viajeSeg : 0), espera: h1(x ? x.esperaSeg : 0),
          fuera: fuera ? h1(fuera.seg) : 0, estado, coches: usados,
          banda: estado === 'salio' ? banda(h1(seg)).color : null,
          obs: obs.join(' · '),
        });
      }));

    // Quien trabajó ese día sin trabajar en ninguna plaza: sin plaza, o librando.
    const librando = new Map();
    reglas.vigentesEn(fecha).filter(a => reglas.libra(a, fecha)).forEach(a => {
      if (!librando.has(a.uuid)) librando.set(a.uuid, []);
      librando.get(a.uuid).push(a.matricula);
    });
    porPersona.forEach((claves, uuid) => {
      if (planDe(uuid, fecha).size) return;
      TURNOS.forEach(turno => {
        const x = claves.get(R.clave(fecha, turno));
        if (!x || !(x.seg > 0)) return;
        sinPlan.push({
          fecha, turno, uuid, nombre: nombreDe(uuid), telefono: telDe(uuid),
          horas: h1(x.seg), viaje: h1(x.viajeSeg), espera: h1(x.esperaSeg),
          coches: cochesEn(uuid, ventana(fecha, turno)),
          libraba: librando.has(uuid) ? [...new Set(librando.get(uuid))].sort() : null,
        });
      });
    });
  });
  sinPlan.sort((a, b) => a.fecha.localeCompare(b.fecha) || TURNOS.indexOf(a.turno) - TURNOS.indexOf(b.turno) || a.nombre.localeCompare(b.nombre));

  // El resumen de cada conductor con plaza: los días que le tocaba, los que
  // salió y los que libró (que no son días que le tocaran).
  const resumenDe = new Map();
  filas.forEach(f => {
    if (f.estado === 'pendiente') return;
    if (!resumenDe.has(f.uuid)) {
      resumenDe.set(f.uuid, { uuid: f.uuid, nombre: f.nombre, telefono: f.telefono, plazas: 0, salio: 0, noSalio: 0, libra: 0, horas: 0, fuera: 0, asignadas: [] });
    }
    const r = resumenDe.get(f.uuid);
    r.asignadas = plazasDistintas([...r.asignadas, { turno: f.turno, matricula: f.matricula, rol: f.rol }]);
    if (f.estado === 'libra') { r.libra++; return; }
    r.plazas++;
    if (f.estado === 'salio' || f.estado === 'en_curso') r.salio++;
    if (f.estado === 'no_salio') r.noSalio++;
    r.horas += f.horas;
    r.fuera += f.fuera;
  });
  const porConductor = [...resumenDe.values()].map(r => ({
    ...r, horas: Math.round(r.horas * 10) / 10, fuera: Math.round(r.fuera * 10) / 10,
    media: r.salio ? Math.round((r.horas / r.salio) * 10) / 10 : null,
  })).sort((a, b) => b.noSalio - a.noSalio || a.horas - b.horas || a.nombre.localeCompare(b.nombre));

  const cerradas = filas.filter(f => f.estado === 'salio' || f.estado === 'no_salio');
  return {
    desde, hasta, filas, sinPlan, porConductor,
    resumen: {
      plazas: filas.filter(f => f.estado !== 'pendiente' && f.estado !== 'libra').length,
      salieron: filas.filter(f => f.estado === 'salio' || f.estado === 'en_curso').length,
      noSalieron: cerradas.filter(f => f.estado === 'no_salio').length,
      libran: filas.filter(f => f.estado === 'libra').length,
      horas: Math.round(filas.reduce((s, f) => s + f.horas, 0) * 10) / 10,
      horasSinPlan: Math.round(sinPlan.reduce((s, f) => s + f.horas, 0) * 10) / 10,
      personasSinPlan: new Set(sinPlan.map(f => f.uuid)).size,
      abierto: filas.some(f => f.estado === 'en_curso' || f.estado === 'todavia' || f.estado === 'pendiente')
        || ahoraMs < R.cierreDe(hasta),
    },
  };
}

/**
 * Lo que suman unos ratos dentro de [iniMs, finMs): segundos de viaje, espera y
 * descanso, y cuántos conductores trabajaron (viaje o espera). Es la forma de
 * `horasVentana` de la Visibilidad de Madrid, para usar sus mismas métricas.
 */
function sumaVentana(ivs, iniMs, finMs) {
  const out = { viajeSeg: 0, esperaSeg: 0, descansoSeg: 0, conductores: 0 };
  const quien = new Set();
  (ivs || []).forEach(x => {
    const a = Math.max(x.ini, iniMs), b = Math.min(x.fin, finMs);
    if (!(b > a)) return;
    const seg = (b - a) / 1000;
    if (x.situacion === 'viaje') out.viajeSeg += seg;
    else if (x.situacion === 'espera') out.esperaSeg += seg;
    else if (x.situacion === 'descanso') out.descansoSeg += seg;
    else return;
    if (EFECTIVAS.has(x.situacion)) quien.add(x.uuid);
  });
  out.conductores = quien.size;
  return out;
}

/** El lunes de la semana de una fecha 'AAAA-MM-DD'. */
function lunesDe(fecha) {
  const dow = (new Date(String(fecha).slice(0, 10) + 'T12:00:00Z').getUTCDay() + 6) % 7;   // 0 = lunes
  return R.sumarDias(fecha, -dow);
}

/**
 * LAS HORAS DE LA SEMANA de cada conductor (Camilo, 07/10/2026: «las horas
 * semanales también en los reportes de Barcelona, solo de conductores, de horas
 * efectivas en BOLT; también la semana en curso»).
 *
 * Las horas de un día son las de su turno de DÍA más las de su turno de NOCHE,
 * con la misma regla que el reporte diario (repartoTurnos con el plan del día;
 * sin plaza, o librando, por su hora de inicio). Un día no se cierra hasta las
 * 12:00 del siguiente, cuando acaba su noche.
 *
 *   ivs           los ratos de trabajo desde el mediodía del domingo anterior
 *                 hasta el mediodía del lunes siguiente
 *   asignaciones  las de sede_asignacion que tocan la semana (y la víspera)
 *   cts, descansos  los periodos con CT y los descansos de esas fechas (db/234)
 *   conductores   las cuentas de la sede, con su estado en BOLT
 *
 * Cada día dice en qué plazas TRABAJABA (`plazas`) y en cuáles libraba
 * (`libra`). «No salió» es tener que trabajar y no hacer nada; librar, no.
 *
 * Salen las cuentas ACTIVAS y cualquiera que haya trabajado esa semana. De
 * menor a mayor: arriba, quien menos horas ha hecho (como la semanal de Madrid).
 */
function semana({ lunes, ivs, asignaciones, cts, descansos, conductores, ahoraMs = Date.now() }) {
  const l = lunesDe(lunes);
  const fechas = fechasEntre(l, R.sumarDias(l, 6));
  const reglas = reglasDe({ asignaciones, cts, descansos });
  const planDe = planDesde(reglas);
  const { porPersona } = R.repartir((ivs || []).map(x => ({ ...x, persona: x.uuid })), planDe);
  const cuenta = new Map((conductores || []).map(c => [c.uuid, c]));
  const segDe = (uuid, f, t) => { const x = (porPersona.get(uuid) || new Map()).get(R.clave(f, t)); return x ? x.seg : 0; };
  const plaza = a => ({ matricula: a.matricula, turno: a.turno, ...(a.rol === 'ct' ? { rol: 'ct' } : {}) });
  const plazasDe = (uuid, f) => reglas.planDelDia(f).filter(a => a.uuid === uuid).map(plaza);
  const libraDe = (uuid, f) => reglas.vigentesEn(f).filter(a => a.uuid === uuid && reglas.libra(a, f)).map(plaza);

  const quienes = new Set((conductores || []).filter(c => String(c.estado || '').toLowerCase() === 'active').map(c => c.uuid));
  porPersona.forEach((claves, uuid) => {
    if (fechas.some(f => segDe(uuid, f, 'dia') + segDe(uuid, f, 'noche') > 0)) quienes.add(uuid);
  });

  const filas = [...quienes].map(uuid => {
    let totalSeg = 0, dias = 0;
    const celdas = fechas.map(f => {
      const d = segDe(uuid, f, 'dia'), n = segDe(uuid, f, 'noche');
      const estado = ahoraMs < R.instante(f, 0) ? 'futuro' : ahoraMs < R.cierreDe(f) ? 'abierto' : 'cerrado';
      const plazas = plazasDe(uuid, f);
      const libra = plazas.length ? [] : libraDe(uuid, f);
      totalSeg += d + n;
      if (d + n > 0) dias++;
      return {
        fecha: f, horas: h1(d + n), dia: h1(d), noche: h1(n), estado, plazas, libra,
        noSalio: estado === 'cerrado' && plazas.length > 0 && d + n === 0,
      };
    });
    const c = cuenta.get(uuid) || {};
    return {
      uuid, nombre: c.nombre || `Cuenta ${String(uuid).slice(0, 8)}`, telefono: c.telefono || '',
      activa: String(c.estado || '').toLowerCase() === 'active',
      celdas, total: h1(totalSeg), dias, media: dias ? Math.round((totalSeg / dias) / 360) / 10 : null,
      noSalio: celdas.filter(x => x.noSalio).length,
      libra: celdas.filter(x => x.libra.length).length,
      asignadas: plazasDistintas(celdas.flatMap(x => [...x.plazas, ...x.libra])),
    };
  }).sort((a, b) => a.total - b.total || a.nombre.localeCompare(b.nombre));

  const domingo = fechas[6];
  return {
    lunes: l, domingo, fechas, filas,
    resumen: {
      conductores: filas.length,
      horas: Math.round(filas.reduce((s, f) => s + f.total, 0) * 10) / 10,
      conHoras: filas.filter(f => f.total > 0).length,
      noSalio: filas.reduce((s, f) => s + f.noSalio, 0),
      cerrada: ahoraMs >= R.cierreDe(domingo),
      enCurso: ahoraMs >= R.instante(l, 0) && ahoraMs < R.cierreDe(domingo),
    },
  };
}

// ── EL PROMEDIO DE HORAS (igual que Madrid, sin letra) ──────────────────────
// Camilo, 06/11/2026: «agregar los promedios de cada uno como en el
// planificador de Madrid, sin letra ya que no nos interesa la utilización y
// avisos de velocidad, por el momento».
//
// LA REGLA DE LA CASA (docs/nucleo/Promedio de horas.md):
//
//     promedio = horas ÷ (días que salió + «Ausencias», cada una a 0 h)
//
//   · El periodo es el MES CORRIDO: del día 1 a ayer. Hoy va a medias.
//   · Las horas de un día son lo trabajado ese día —su turno de día más su
//     turno de noche, viaje + espera—, como la semana. Un día no está cerrado
//     hasta las 12:00 del siguiente (acaba su noche): hasta entonces no cuenta.
//   · Cuenta como «salió» un día cerrado con horas, TUVIERA PLAZA O NO (como
//     Madrid: lo que hizo, lo hizo).
//   · Ausencia (0 h): un día cerrado en el que tenía una plaza que TRABAJABA ese
//     día (el plan del día) y no hizo nada.
//   · No cuentan: las libranzas, los días sin plaza sin horas y los días antes de
//     su primera plaza (no tenía ninguna que trabajara). Barcelona no tiene
//     fichas: no hay vacaciones, bajas ni permisos que mirar.
//   · Mínimo, 5 días que salió (MODELO.minDiasTrabajados de Madrid). LOS
//     PRIMEROS DÍAS DEL MES, el del mes cerrado (db/175): si el mes en curso es
//     JOVEN —van menos de 5 días CERRADOS— y el mes anterior llega a los 5, se
//     da el del mes anterior, rotulado. Si no, N/E con el motivo. Se cuentan los
//     cerrados y no los del calendario porque son los únicos que cuentan: el
//     día 6 antes de las 12:00 el 05 aún no ha cerrado, el mes lleva cuatro y
//     nadie puede llegar a cinco (con el calendario, toda Barcelona salía en N/E
//     el día 6 por la mañana, también quien había salido todos los días).
//
// No se guarda: se calcula al vuelo (Barcelona son una veintena de conductores)
// y el servicio lo guarda unos minutos.

const MIN_DIAS_PROMEDIO = 5;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Los periodos del promedio para un `hoy` ('AAAA-MM-DD') a una hora (`ahoraMs`):
 * el mes corrido y, si es joven (menos de 5 días cerrados), el mes anterior
 * entero. `desde` y `hasta` de lo que hay que cargar.
 */
function periodosDelPromedio(hoy, ahoraMs = Date.now()) {
  const primero = hoy.slice(0, 8) + '01';
  const actual = { mes: hoy.slice(0, 7), desde: primero, hasta: R.sumarDias(hoy, -1) };
  // Un día cierra a las 12:00 del siguiente (acaba su noche): R.cierreDe.
  const cerrados = actual.hasta >= primero
    ? fechasEntre(primero, actual.hasta).filter(f => ahoraMs >= R.cierreDe(f)).length : 0;
  const joven = cerrados < MIN_DIAS_PROMEDIO;
  const finAnterior = R.sumarDias(primero, -1);
  const anterior = joven ? { mes: finAnterior.slice(0, 7), desde: finAnterior.slice(0, 8) + '01', hasta: finAnterior } : null;
  return { actual, anterior, desde: (anterior || actual).desde, hasta: actual.hasta };
}

/**
 * LOS PROMEDIOS de todo el mundo. Devuelve uuid → promedio:
 *
 *   { horas      el promedio (h/día, un decimal) o null si es N/E
 *     total      las horas del periodo
 *     salio      días que salió · ausencias  días a 0 h
 *     media      la media de los días que salió (el detalle de debajo)
 *     periodo    'AAAA-MM' · mesAnterior  true si es el del mes cerrado
 *     etiqueta   «noviembre» (para rotular «Promedio de noviembre»)
 *     ne         el motivo del N/E, o null }
 *
 *   ivs     los ratos de trabajo desde el mediodía de la víspera del primer día
 *           que se carga (periodosDelPromedio().desde) hasta ahora
 *   asignaciones, cts, descansos   el planificador de esas fechas (y la víspera)
 */
function promedios({ hoy, ivs, asignaciones, cts, descansos, ahoraMs = Date.now() }) {
  const per = periodosDelPromedio(hoy, ahoraMs);
  const reglas = reglasDe({ asignaciones, cts, descansos });
  const { porPersona } = R.repartir((ivs || []).map(x => ({ ...x, persona: x.uuid })), planDesde(reglas));
  const segDe = (uuid, f) => {
    const m = porPersona.get(uuid);
    if (!m) return 0;
    return ((m.get(R.clave(f, 'dia')) || {}).seg || 0) + ((m.get(R.clave(f, 'noche')) || {}).seg || 0);
  };

  const r1 = x => Math.round(x * 10) / 10;
  const contar = ({ mes, desde, hasta }) => {
    // Solo los días cerrados del periodo; quién trabajaba cada uno, de una vez.
    const fechas = hasta >= desde ? fechasEntre(desde, hasta).filter(f => ahoraMs >= R.cierreDe(f)) : [];
    const trabajaban = new Map(fechas.map(f => [f, new Set(reglas.planDelDia(f).map(a => a.uuid))]));
    const etiqueta = MESES[Number(mes.slice(5, 7)) - 1];
    return uuid => {
      let seg = 0, salio = 0, ausencias = 0;
      fechas.forEach(f => {
        const s = segDe(uuid, f);
        if (s > 0) { salio++; seg += s; } else if (trabajaban.get(f).has(uuid)) ausencias++;
      });
      const h = seg / 3600;
      return {
        horas: salio + ausencias ? r1(h / (salio + ausencias)) : null,
        total: r1(h), salio, ausencias, media: salio ? r1(h / salio) : null,
        periodo: mes, etiqueta,
      };
    };
  };
  const actual = contar(per.actual);
  const anterior = per.anterior ? contar(per.anterior) : null;
  return uuid => {
    const a = actual(uuid);
    if (a.salio >= MIN_DIAS_PROMEDIO) return { ...a, mesAnterior: false, ne: null };
    if (anterior) {
      const b = anterior(uuid);
      if (b.salio >= MIN_DIAS_PROMEDIO) return { ...b, mesAnterior: true, ne: null };
    }
    return { ...a, horas: null, mesAnterior: false, ne: `salió menos de ${MIN_DIAS_PROMEDIO} días en el mes (${a.salio})` };
  };
}

module.exports = {
  EFECTIVAS, TOPE_H, intervalos, planDesde, fechasEntre, ventana, informe, sumaVentana, lunesDe, semana, plazasDistintas,
  periodosDelPromedio, promedios,
};
