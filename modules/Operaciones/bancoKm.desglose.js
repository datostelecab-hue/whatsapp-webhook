// ============================================================
// EL BANCO DE KM — de dónde sale cada km de una persona (18/11/2026)
// ============================================================
// Camilo, con la ficha de un conductor de noche que salía con 661 km en una
// semana: «Dejemos la regla, pero que por día, al darle click a la persona de
// la semana, me desglose todos los KM: si es por descanso, si es por supuesto
// fichaje no cerrado, etc. Necesitamos decirles: ey, por no haber desfichado,
// mira los KM que se te imputan».
//
// LAS CAUSAS de un km fuera de BOLT que se le apunta a una persona:
//   descanso          estaba conectado a BOLT en descanso (en pausa) con el coche;
//   desconectado      estaba desconectado de BOLT y era el último con el coche
//                     (con su corte: hasta que otro se conecta, él aparece en
//                     otro coche o pasan 12 h);
//   fichaje_abierto   tenía el coche FICHADO y quien estaba en BOLT con él era
//                     OTRO (en descanso o desconectado): el turno que no terminó.
//                     Es el «por no haber desfichado»;
//   fichado_sin_bolt  tenía el coche fichado y nadie estaba en BOLT con él.
//
// LA REGLA ES LA DEL REPORTE (rutas.FIN_KM y kmFichaje.js), aquí minuto a
// minuto y solo para los coches de una persona en una semana: con el coche
// fichado, el km es de quien lo fichó; sin fichar, del último que estuvo en
// BOLT con él; en viaje o en espera, no es de fuera. Los km se cortan en
// trozos de un minuto como mucho, y cada trozo va a la causa de su mitad.
//
// LOS TOTALES MANDAN: el desglose da el REPARTO, y se escala a los km que la
// foto del banco ya tiene de ese día y ese coche (los del reporte de Control).
// Así la ficha no puede decir dos cifras distintas para lo mismo.
'use strict';

const TOPE_TRAMO_MS = 12 * 3600 * 1000;   // el de rutas.TOPE_TRAMO_ABIERTO
const UMBRAL_CAN = Number(process.env.FV_UMBRAL_CAN || 0.85);
const TROZO_MS = 60 * 1000;
const EN_BOLT = new Set(['viaje', 'espera']);

const CAUSAS = [
  { codigo: 'fichaje_abierto', etiqueta: 'Por no terminar el turno' },
  { codigo: 'descanso', etiqueta: 'En descanso en BOLT' },
  { codigo: 'desconectado', etiqueta: 'Desconectado de BOLT' },
  { codigo: 'fichado_sin_bolt', etiqueta: 'Con el coche fichado, sin conectarse a BOLT' },
  { codigo: 'sin_desglose', etiqueta: 'Sin desglose' },
];

/**
 * El final de cada tramo para los km, como rutas.FIN_KM: lo que pase antes de
 * su propio final, 12 h, que OTRO se conecte a ese coche o que ÉL aparezca en
 * otro. `tramos`: todos los leídos ({ id, vehiculo, cuenta, situacion, desde,
 * hasta } en ms; hasta null = abierto). Devuelve Map(id → fin en ms).
 */
function finesKm(tramos, ahora = Date.now()) {
  const porCoche = new Map(), porCuenta = new Map();
  for (const t of tramos) {
    if (!porCoche.has(t.vehiculo)) porCoche.set(t.vehiculo, []);
    porCoche.get(t.vehiculo).push(t);
    if (!porCuenta.has(t.cuenta)) porCuenta.set(t.cuenta, []);
    porCuenta.get(t.cuenta).push(t);
  }
  [...porCoche.values(), ...porCuenta.values()].forEach(l => l.sort((a, b) => a.desde - b.desde));
  const fin = new Map();
  for (const t of tramos) {
    let f = Math.min(t.hasta == null ? ahora : t.hasta, t.desde + TOPE_TRAMO_MS);
    const otro = porCoche.get(t.vehiculo).find(x => x.desde > t.desde && x.cuenta !== t.cuenta);
    if (otro) f = Math.min(f, otro.desde);
    const enOtro = porCuenta.get(t.cuenta).find(x => x.desde > t.desde && x.vehiculo !== t.vehiculo);
    if (enOtro) f = Math.min(f, enOtro.desde);
    fin.set(t.id, f);
  }
  return fin;
}

/**
 * Los km de un coche en una ventana, en trozos de un minuto como mucho:
 * [{ t (la mitad), metros }]. Del odómetro si cuenta (la regla de UMBRAL_CAN
 * del reporte, con la ventana entera); si no, del GPS.
 */
function trozos({ odometro, rutas }, ini, fin) {
  const dentro = (segs) => {
    const out = [];
    let total = 0;
    for (const s of segs) {
      const a = Math.max(s.inicio, ini), b = Math.min(s.fin, fin);
      if (!(b > a) || !(s.fin > s.inicio)) continue;
      const ritmo = s.metros / (s.fin - s.inicio);
      for (let x = a; x < b; x += TROZO_MS) {
        const y = Math.min(b, x + TROZO_MS);
        out.push({ t: (x + y) / 2, metros: ritmo * (y - x) });
        total += ritmo * (y - x);
      }
    }
    return { out, total };
  };
  const can = dentro(odometro || []), gps = dentro(rutas || []);
  return (can.total > 0 && can.total >= UMBRAL_CAN * gps.total) ? can.out : gps.out;
}

/**
 * La causa de cada trozo que es de `persona`. Devuelve Map(clave → { causa,
 * con, fichajeId, metros }), clave = causa|con|fichaje.
 *   tramos     los de ESE coche, con `fin` ya puesto (finesKm)
 *   fichajes   los de ese coche: { id, dueno, inicio, fin } (fin null = abierto)
 *   suyas      Set de las cuentas de BOLT de la persona ese día
 *   nombreDe   cuenta → nombre (para decir quién llevaba el coche)
 */
function clasificar(trozosCoche, { tramos, fichajes, persona, suyas, nombreDe, ahora = Date.now() }) {
  const out = new Map();
  const sumar = (causa, con, fichajeId, metros) => {
    const k = `${causa}|${con || ''}|${fichajeId || ''}`;
    const x = out.get(k) || { causa, con: con || null, fichajeId: fichajeId || null, metros: 0 };
    x.metros += metros;
    out.set(k, x);
  };
  const cubre = (t, x) => x.desde <= t && t < x.fin;
  for (const { t, metros } of trozosCoche) {
    if (!(metros > 0)) continue;
    const vivos = tramos.filter(x => cubre(t, x));
    if (vivos.some(x => EN_BOLT.has(x.situacion))) continue;            // en BOLT: no es de fuera
    const fuera = vivos.filter(x => !EN_BOLT.has(x.situacion)).sort((a, b) => b.desde - a.desde);
    const fich = fichajes.filter(f => f.inicio <= t && t < (f.fin == null ? ahora : f.fin)).sort((a, b) => b.inicio - a.inicio)[0];
    if (fich) {
      if (fich.dueno !== persona) continue;
      const propio = fuera.find(x => suyas.has(x.cuenta));
      if (propio) sumar(propio.situacion === 'descanso' ? 'descanso' : 'desconectado', null, null, metros);
      else if (fuera.length) sumar('fichaje_abierto', nombreDe(fuera[0].cuenta), fich.id, metros);
      else sumar('fichado_sin_bolt', null, fich.id, metros);
      continue;
    }
    // Sin fichar: del último que estuvo en BOLT con el coche.
    const ultimo = fuera[0];
    if (ultimo && suyas.has(ultimo.cuenta)) sumar(ultimo.situacion === 'descanso' ? 'descanso' : 'desconectado', null, null, metros);
  }
  return out;
}

/**
 * Escala un reparto (Map de clasificar) a los km que dice la foto. Sin reparto
 * (los datos crudos no dan nada para esa persona), todo va a «sin desglose».
 */
function escalar(reparto, km) {
  const lista = [...reparto.values()].filter(x => x.metros > 0);
  const total = lista.reduce((s, x) => s + x.metros, 0);
  if (!(km > 0)) return [];
  if (!total) return [{ causa: 'sin_desglose', con: null, fichajeId: null, km: Math.round(km * 10) / 10 }];
  const crudo = lista.map(x => ({ ...x, km: km * x.metros / total }));
  // Redondeo a una décima que sume exacto lo de la foto (el resto, al mayor).
  const r = crudo.map(x => ({ causa: x.causa, con: x.con, fichajeId: x.fichajeId, km: Math.round(x.km * 10) / 10 }));
  const dif = Math.round((km - r.reduce((s, x) => s + x.km, 0)) * 10) / 10;
  if (dif) { const mayor = r.reduce((m, x) => (x.km > m.km ? x : m), r[0]); mayor.km = Math.round((mayor.km + dif) * 10) / 10; }
  return r.filter(x => x.km > 0).sort((a, b) => b.km - a.km);
}

module.exports = { finesKm, trozos, clasificar, escalar, CAUSAS };
