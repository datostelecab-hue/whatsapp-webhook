// ============================================================
// PLANIFICACIÓN · EL ICEBERG — las bases, y el orden de mejor a peor
// ============================================================
// Camilo, 05/10/2026: «lo que necesitamos resolver del planificador es que no
// tenemos ordenada la información de forma ejecutiva para poder asignar los
// conductores a cada uno de los coches». Hasta hoy los cuadrantes salían por su
// NÚMERO, que es el orden en que se crearon y no dice nada de cómo van.
//
// Ahora cada base (Alcobendas, Aravaca, Canillejas, Alcorcón, Getafe) se lee
// como un iceberg: arriba lo que mejor anda y, bajando, lo que hay que mirar.
//
//   1. COMPLETOS        todas sus plazas tienen dueño (hoy o ya escrito).
//   2. CON PLAZAS VACÍAS les falta un fijo o días de correturnos.
//   3. SIN NADIE        ni una persona puesta ni por llegar.
//
// Dentro de cada escalón, primero los coches que RUEDAN, luego los que están en
// cobertura sin rodar (reservado, transporte) y al fondo los del taller o el
// siniestro: un coche parado no da horas aunque tenga la tripulación entera
// (Camilo eligió «al fondo de su escalón»). Y entre iguales, MÁS HORAS
// INSTALADAS primero.
//
// LAS HORAS INSTALADAS de un coche son las de su semana: por cada día y turno,
// el promedio de horas por día trabajado de quien lo cubre ese día —su
// calificación, la del chip «9,4 h · A»—. Un turno sin nadie suma 0. Así pesan a
// la vez estar completo y tener buenos conductores, que es lo que pidió Camilo
// («los mejores conductores: la capacidad instalada de la matrícula en horas los
// días que se trabajan»). Quien todavía no tiene calificación (N/E, recién
// llegado) cuenta con la MEDIANA de la flota y se dice que es estimado: contarlo
// como 0 hundiría el coche que acaba de completarse.
//
// Un cuadrante va en el escalón de sus coches —completo si lo están todos, sin
// nadie si no hay nadie en ninguno— y se ordena por la MEDIA de horas por coche,
// no por la suma: con la suma, un cuadrante de tres coches flojos pasaba por
// delante de uno de dos muy buenos solo por tener más coches.
//
// Es PURO: no lee la base. Recibe el tablero ya montado por `planificador.repo`
// y le añade `iceberg` a cada coche y a cada cuadrante, y devuelve las cuentas
// de cada base con la misma forma que el resumen general, para que la pantalla
// pinte las mismas tarjetas con los números de la base abierta.

/** Los escalones, de arriba abajo. `sinCoches` es para el cuadrante vacío. */
const ESCALONES = ['completo', 'vacante', 'vacio', 'sinCoches'];
const PESO_ESCALON = Object.fromEntries(ESCALONES.map((e, i) => [e, i]));

/** Siete días por dos turnos: la semana entera de un coche. */
const TURNOS_SEMANA = 14;

/** Si nadie de la flota tiene calificación todavía, un turno vale esto. */
const HORAS_SIN_DATO = 8;

/** A seis días por correturnos: lo mismo que la tarjeta general. */
const DIAS_POR_CT = 6;

/** La clave de la base de los coches que no tienen ninguna activa. */
const SIN_BASE = 'sin';

const redondea = n => Math.round(n * 10) / 10;

function mediana(xs) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Tiene calificación de verdad: no es N/E y ha trabajado algún día. */
const conDato = r => !!(r && !r.nuevo && Number(r.dias) > 0);

/**
 * Cuántas horas da cada persona por día trabajado, y cuánto se le supone a
 * quien no tiene calificación.
 *
 * @param {Map<string, {rendimiento?: object}>} gente
 */
function medidorDeHoras(gente) {
  const conocidas = [...gente.values()].map(p => p.rendimiento).filter(conDato).map(r => Number(r.horas) || 0);
  const estimada = conocidas.length ? redondea(mediana(conocidas)) : HORAS_SIN_DATO;
  return {
    estimada,
    de(id) {
      const p = gente.get(String(id));
      const r = p && p.rendimiento;
      return conDato(r) ? { horas: Number(r.horas) || 0, estimada: false } : { horas: estimada, estimada: true };
    },
  };
}

/**
 * Las horas instaladas de UN coche esta semana, turno a turno.
 *
 * Sale de la tira de la semana (`coche.semana`, 7 días × día/noche), que es la
 * cobertura de verdad: quien está de vacaciones no cubre, y su turno no suma.
 */
function capacidadDe(coche, medidor) {
  let horas = 0, turnos = 0, estimados = 0;
  (coche.semana || []).forEach(celda => {
    if (!celda || !celda.id) return;
    const h = medidor.de(celda.id);
    horas += h.horas;
    turnos++;
    if (h.estimada) estimados++;
  });
  return { horas: redondea(horas), turnos, huecos: Math.max(0, TURNOS_SEMANA - turnos), estimados };
}

/** Una plaza con alguien: puesto hoy o ya escrito para más adelante. */
const conAlguien = p => !!(p && (p.id || p.futuro));

/**
 * El escalón de un coche. Lo que le falta lo dejó apuntado `planificador.repo`
 * en `coche.falta` con la MISMA regla que las tarjetas: una plaza de fijo cuenta
 * como cubierta si tiene dueño hoy que no se va, o si ya tiene a alguien escrito.
 */
function escalonDe(coche) {
  if (!(coche.personas || []).some(conAlguien)) return 'vacio';
  const f = coche.falta || { fijo: {}, ct: {} };
  const falta = f.fijo.dia || f.fijo.noche || (f.ct.dia || 0) > 0 || (f.ct.noche || 0) > 0;
  return falta ? 'vacante' : 'completo';
}

/**
 * 0 rueda · 1 en cobertura sin rodar (reservado, transporte) · 2 parado (taller,
 * siniestro, emergencia, baja). Se lee de las dos marcas del catálogo que ya
 * trae el coche, no de una lista de letras.
 */
const pesoEstado = coche => (coche.operativo ? 0 : coche.visibleCobertura ? 1 : 2);

/** Lo que hay que saber de un coche para colocarlo en el iceberg. */
function lecturaDe(coche, medidor) {
  const cap = capacidadDe(coche, medidor);
  const f = coche.falta || { fijo: {}, ct: {} };
  return {
    escalon: escalonDe(coche),
    estado: pesoEstado(coche),
    horas: cap.horas,
    turnos: cap.turnos,
    huecos: cap.huecos,
    estimados: cap.estimados,
    // Lo que le falta, dicho para la pantalla.
    falta: {
      fijoDia: !!f.fijo.dia, fijoNoche: !!f.fijo.noche,
      ctDiasDia: f.ct.dia || 0, ctDiasNoche: f.ct.noche || 0,
    },
  };
}

function compararCoches(a, b) {
  const x = a.iceberg, y = b.iceberg;
  return PESO_ESCALON[x.escalon] - PESO_ESCALON[y.escalon]
    || x.estado - y.estado
    || y.horas - x.horas
    || String(a.matricula).localeCompare(String(b.matricula));
}

/** Un cuadrante, a partir de sus coches. */
function lecturaDeGrupo(coches) {
  if (!coches.length) {
    return { escalon: 'sinCoches', estado: 2, horas: 0, media: 0, coches: 0,
      completos: 0, vacantes: 0, vacios: 0, parados: 0 };
  }
  const cuenta = e => coches.filter(c => c.iceberg.escalon === e).length;
  const completos = cuenta('completo'), vacios = cuenta('vacio');
  const horas = redondea(coches.reduce((s, c) => s + c.iceberg.horas, 0));
  return {
    escalon: completos === coches.length ? 'completo' : vacios === coches.length ? 'vacio' : 'vacante',
    // Rueda si rueda alguno de sus coches: el cuadrante sigue en la calle.
    estado: Math.min(...coches.map(c => c.iceberg.estado)),
    horas,
    media: redondea(horas / coches.length),
    coches: coches.length,
    completos,
    vacantes: cuenta('vacante'),
    vacios,
    parados: coches.filter(c => c.iceberg.estado === 2).length,
  };
}

function compararGrupos(a, b) {
  const x = a.iceberg, y = b.iceberg;
  return PESO_ESCALON[x.escalon] - PESO_ESCALON[y.escalon]
    || x.estado - y.estado
    || y.media - x.media
    || (Number(a.numero) || 0) - (Number(b.numero) || 0);
}

/**
 * Las bases activas en el orden de Tráfico (`base_zona.orden`, db/178) y, si
 * no lo tienen, por nombre.
 */
function ordenarZonas(zonas) {
  return [...(zonas || [])].sort((a, b) =>
    (a.orden == null ? 999 : Number(a.orden)) - (b.orden == null ? 999 : Number(b.orden))
    || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/**
 * La base de un coche para el planificador: la de su CUADRANTE si está en uno
 * —es donde se decide—, y si no, la suya. La misma regla que usaba el filtro
 * de la pantalla, para que la cuenta y lo que se ve no se separen.
 */
function zonaDeCoche(coche, zonaDeCuadrante) {
  return (coche.cuadranteId && zonaDeCuadrante.get(String(coche.cuadranteId))) || coche.zonaId || null;
}

/**
 * Le pone `iceberg` a cada coche y a cada cuadrante, y devuelve las cuentas de
 * cada base.
 *
 * @param {object} t
 * @param {Array}  t.coches        los del tablero (se les añade `iceberg`)
 * @param {Array}  t.cuadrantes    los vivos (se les añade `iceberg`)
 * @param {Array}  t.zonas         las bases activas {id, nombre, orden}
 * @param {Map}    t.gente         id → persona, con su `rendimiento`
 * @param {Array}  t.huerfanos     filas de v_conductor_huerfano
 * @param {Array}  t.planificados  plazas que ya tienen dueño escrito (con vehiculoId)
 * @param {Array}  t.seVan         plazas que se quedan vacías (con vehiculoId)
 * @param {Function} t.plantelDe   lista de coches → las cuentas de personas
 * @returns {{ zonas: Array, porZona: Array, estimada: number }}
 */
function decorar({ coches, cuadrantes, zonas, gente, huerfanos = [], planificados = [], seVan = [], plantelDe }) {
  const medidor = medidorDeHoras(gente);
  const activas = ordenarZonas(zonas);
  const activa = new Set(activas.map(z => String(z.id)));
  const zonaDeCuadrante = new Map((cuadrantes || []).map(cu => [String(cu.id), cu.zonaId ? String(cu.zonaId) : null]));
  const claveDe = coche => {
    const z = zonaDeCoche(coche, zonaDeCuadrante);
    return z && activa.has(String(z)) ? String(z) : SIN_BASE;
  };

  coches.forEach(c => { c.iceberg = { ...lecturaDe(c, medidor), zona: claveDe(c) }; });
  [...coches].sort(compararCoches).forEach((c, i) => { c.iceberg.orden = i; });

  const cochesDe = new Map();
  coches.forEach(c => {
    if (!c.cuadranteId) return;
    const k = String(c.cuadranteId);
    if (!cochesDe.has(k)) cochesDe.set(k, []);
    cochesDe.get(k).push(c);
  });
  (cuadrantes || []).forEach(cu => {
    cu.iceberg = { ...lecturaDeGrupo(cochesDe.get(String(cu.id)) || []),
      zona: cu.zonaId && activa.has(String(cu.zonaId)) ? String(cu.zonaId) : SIN_BASE };
  });
  [...(cuadrantes || [])].sort(compararGrupos).forEach((cu, i) => { cu.iceberg.orden = i; });

  // ── Las cuentas de cada base ──────────────────────────────────────────
  const zonaDeVehiculo = new Map(coches.map(c => [String(c.vehiculoId), c.iceberg.zona]));
  const zonaDeMatricula = new Map(coches.map(c => [String(c.matricula), c.iceberg.zona]));
  const zonaPorNombre = new Map(activas.map(z => [String(z.nombre).toLowerCase(), String(z.id)]));
  // El huérfano se queda apuntado con su base: la pantalla lo filtra igual que
  // lo cuenta su tarjeta.
  (huerfanos || []).forEach(h => {
    h.zonaClave = zonaDeMatricula.get(String(h.matricula))
      || zonaPorNombre.get(String(h.zona || '').toLowerCase()) || SIN_BASE;
  });

  const bases = activas.map(z => ({ clave: String(z.id), zonaId: z.id, zona: z.nombre, orden: z.orden == null ? null : Number(z.orden) }));
  if (coches.some(c => c.iceberg.zona === SIN_BASE)) bases.push({ clave: SIN_BASE, zonaId: null, zona: 'Sin base', orden: null });

  const porZona = bases.map(b => {
    const suyos = coches.filter(c => c.iceberg.zona === b.clave);
    const rueda = suyos.filter(c => c.operativo);
    // Lo que faltan, con la MISMA regla que el resumen general (planificador.repo):
    // solo coches operativos, y los días de CT solo en coches que tienen su fijo
    // (un coche sin fijo necesita un fijo, no quien lo releve).
    let fijosDia = 0, fijosNoche = 0, ctDiasDia = 0, ctDiasNoche = 0, sinCubrirDia = 0, sinCubrirNoche = 0;
    rueda.forEach(c => {
      const f = c.falta || { fijo: {}, ct: {} };
      if (f.fijo.dia) fijosDia++; else ctDiasDia += f.ct.dia || 0;
      if (f.fijo.noche) fijosNoche++; else ctDiasNoche += f.ct.noche || 0;
      sinCubrirDia += c.sinCubrirDia || 0;
      sinCubrirNoche += c.sinCubrirNoche || 0;
    });
    const deAqui = x => zonaDeVehiculo.get(String(x.vehiculoId)) === b.clave;
    const cuenta = e => suyos.filter(c => c.iceberg.escalon === e).length;
    return {
      ...b,
      coches: rueda.length,
      cochesTotal: suyos.length,
      cuadrantes: (cuadrantes || []).filter(cu => cu.iceberg.zona === b.clave).length,
      iceberg: {
        completo: cuenta('completo'), vacante: cuenta('vacante'), vacio: cuenta('vacio'),
        parados: suyos.filter(c => c.iceberg.estado === 2).length,
        horas: redondea(rueda.reduce((s, c) => s + c.iceberg.horas, 0)),
      },
      diasSinCubrirDia: sinCubrirDia,
      diasSinCubrirNoche: sinCubrirNoche,
      ctQueFaltanDia: Math.ceil(ctDiasDia / DIAS_POR_CT),
      ctQueFaltanNoche: Math.ceil(ctDiasNoche / DIAS_POR_CT),
      ctDiasDia, ctDiasNoche,
      fijosQueFaltanDia: fijosDia,
      fijosQueFaltanNoche: fijosNoche,
      planificados: planificados.filter(deAqui)
        .sort((x, y) => String(x.desde).localeCompare(String(y.desde)) || String(x.matricula).localeCompare(String(y.matricula))),
      seVan: seVan.filter(deAqui)
        .sort((x, y) => String(x.hasta).localeCompare(String(y.hasta)) || String(x.matricula).localeCompare(String(y.matricula))),
      huerfanos: (huerfanos || []).filter(h => h.zonaClave === b.clave).length,
      ...(plantelDe ? plantelDe(suyos) : {}),
    };
  });

  return { zonas: activas, porZona, estimada: medidor.estimada };
}

module.exports = {
  decorar,
  // Sueltas, para las pruebas.
  escalonDe, capacidadDe, medidorDeHoras, lecturaDeGrupo, compararCoches, compararGrupos, ordenarZonas,
  ESCALONES, SIN_BASE, TURNOS_SEMANA,
};
