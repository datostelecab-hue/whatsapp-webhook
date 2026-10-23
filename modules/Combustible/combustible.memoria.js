// ============================================================
// COMBUSTIBLE · LO QUE YA SE LE PREGUNTÓ A MAPON EN ESTA PASADA
// ============================================================
// Puro por dentro (no llama a nadie por su cuenta): envuelve las lecturas de
// Mapon que usa la auditoría y se acuerda, durante UNA pasada, de las ventanas
// que ya pidió. Si un repostaje necesita un trozo que ya está dentro de una
// ventana pedida, se recorta de ahí y no se vuelve a preguntar.
//
// POR QUÉ (23/10/2026). Petroprix llega por Excel: 1.866 repostajes de golpe
// (01-22/10) y unos 85 al día. La auditoría pide por cada repostaje el aforador
// de 5 días (72 h antes y 48 h después), las paradas de 4 horas y los km (lo
// que gastó entre las dos lecturas de la boya, y hasta que bajó del techo), más
// la posición en el instante si hace falta. Un coche reposta dos o
// tres veces al día: pedir 5 días de aforador por cada repostaje es pedir lo
// mismo tres veces. Con esto, los repostajes de un coche en unos días se miran
// con UNA lectura del aforador, UNA de paradas y UNA de km para todos
// (`precargar`; los km, desde la boya de la ventana fija, que suma lo gastado
// entre sus dos lecturas), y lo demás se pide al ir haciendo falta. Medido en el entorno de pruebas: ver
// docs/modulos/Combustible.md, «El ritmo de la auditoría».
//
// LO RECORTADO ES LO MISMO QUE SE HABRÍA PEDIDO: las lecturas de una serie cuya
// hora cae en la ventana, y las paradas que la tocan (route/list devuelve
// también las que solo la rozan, enteras). Por eso la auditoría da lo mismo con
// memoria que sin ella, y el comprobador lo mira.
//
// Y UNA PAUSA ENTRE PREGUNTAS (`pausaMs`). La auditoría pregunta de una en una
// —Mapon admite 5 a la vez por cuenta y la ingesta y las sanciones ya usan
// hueco—, y con la pausa tampoco las encadena sin respiro durante minutos.

const sinPausa = () => Promise.resolve();
const dormir = ms => new Promise(ok => setTimeout(ok, ms));

/**
 * `mapon`: el adaptador (services/mapon) o uno de mentira. → un objeto con las
 * mismas lecturas, más `precargar(unitId, { aforador, paradas, km })`
 * (cada una [desdeMs, hastaMs] o nada) y `cuenta()` (cuántas se pidieron de
 * verdad y cuántas salieron de la memoria).
 */
function conMemoria(mapon, { pausaMs = 0 } = {}) {
  const ventanas = new Map();   // 'lectura|unidad' → [{ desde, hasta, datos }]
  const capacidades = new Map();
  const c = { pedidas: 0, deMemoria: 0 };
  const pausa = pausaMs > 0 ? () => dormir(pausaMs) : sinPausa;
  let primera = true;

  async function pedir(fn, ...args) {
    if (!primera) await pausa();
    primera = false;
    c.pedidas++;
    return mapon[fn](...args);
  }

  const enVentana = (datos, desde, hasta) => datos.filter(p => p.t >= desde && p.t <= hasta);
  const RECORTAR = {
    nivelDeposito: enVentana,
    nivelPorcentaje: enVentana,
    // Las paradas que tocan la ventana, enteras.
    paradasUnidad: (ps, desde, hasta) => ps.filter(p => p.desde <= hasta && (p.hasta == null || p.hasta >= desde)),
    gastadoYKm: (x, desde, hasta) => ({ gastado: enVentana(x.gastado || [], desde, hasta), km: enVentana(x.km || [], desde, hasta) }),
  };

  async function serie(fn, unitId, desde, hasta) {
    const k = `${fn}|${unitId}`;
    const ya = (ventanas.get(k) || []).find(w => w.desde <= desde && w.hasta >= hasta);
    if (ya) { c.deMemoria++; return RECORTAR[fn](ya.datos, desde, hasta); }
    const datos = await pedir(fn, unitId, desde, hasta);
    if (!ventanas.has(k)) ventanas.set(k, []);
    ventanas.get(k).push({ desde, hasta, datos });
    return datos;
  }

  return {
    nivelDeposito: (u, d, h) => serie('nivelDeposito', u, d, h),
    nivelPorcentaje: (u, d, h) => serie('nivelPorcentaje', u, d, h),
    paradasUnidad: (u, d, h) => serie('paradasUnidad', u, d, h),
    gastadoYKm: (u, d, h) => serie('gastadoYKm', u, d, h),
    // Un instante no se puede recortar de nada: se pide.
    posicionEn: (u, t) => pedir('posicionEn', u, t),
    capacidadDeposito: async u => {
      if (capacidades.has(u)) { c.deMemoria++; return capacidades.get(u); }
      const v = await pedir('capacidadDeposito', u);
      capacidades.set(u, v);
      return v;
    },
    // El padrón ya lo guarda el adaptador diez minutos.
    unidadPorMatricula: m => mapon.unidadPorMatricula(m),
    configurado: () => mapon.configurado(),
    disponible: () => mapon.disponible(),
    estadoCaida: () => mapon.estadoCaida(),
    /**
     * Pide de una vez las ventanas de varios repostajes de UN coche. Si falla,
     * no pasa nada: cada repostaje lo volverá a pedir a su tamaño, y ahí se
     * apunta el fallo como siempre (combustible.auditoria).
     */
    async precargar(unitId, { aforador, paradas, km } = {}) {
      if (paradas) await serie('paradasUnidad', unitId, paradas[0], paradas[1]).catch(() => null);
      if (aforador) await serie('nivelDeposito', unitId, aforador[0], aforador[1]).catch(() => null);
      if (km) await serie('gastadoYKm', unitId, km[0], km[1]).catch(() => null);
    },
    cuenta: () => ({ ...c }),
  };
}

module.exports = { conMemoria };
