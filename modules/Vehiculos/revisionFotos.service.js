// ============================================================
// REVISIÓN DE FOTOS — LA PUERTA (db/282, 24/11/2026)
// ============================================================
// Camilo: «un módulo en el ERP en taller, en el cual pueda comparar las dos
// últimos lotes de fotos de los conductores, por ejemplo, si lo coge hoy
// Carlos, toma las fotos y lo deja, el próximo hará lo mismo, entonces, en
// dicho módulo, por cada dos últimas fotos, debemos de comprobar a mano las
// fotos de los coches, para aprobar la revisión, una vez calificada, esperamos
// el próximo ciclo de dos lotes de fotos».
//
// LAS REGLAS (decididas en el chat)
//   · UN LOTE: las cinco fotos de quien desvincula el coche en el portal. Su
//     dueño es su turno de fichaje (`turno_fotos`).
//   · CADA LOTE CON EL ANTERIOR del mismo coche: A-B, B-C, C-D… Cada lote se
//     califica UNA vez, contra el de antes. Si aparece un daño, es del
//     conductor del lote nuevo. El primero de un coche (o aquel cuyo anterior
//     ya se borró) se califica solo.
//   · «Aprobada» o «Con daños» (nota obligatoria y en qué fotos se ve). Se
//     puede cambiar después; el libro de auditoría guarda cada cambio.
//   · LAS FOTOS SE BORRAN A LOS 20 DÍAS (portal.fotos), salvo los dos lotes de
//     una pareja con daños: son la prueba. La lista dice cuántos días le
//     quedan a cada pareja pendiente.
//   · Solo la flota de Madrid, como todo el taller.
'use strict';

const repo = require('./revisionFotos.repo');
const calendario = require('../../services/calendario');
const libro = require('../../services/libro');
const contadores = require('../../services/contadores');

const RESULTADOS = { aprobada: 'Aprobada', danos: 'Con daños' };
const CLAVE_VER = '/revision-fotos';
const CLAVE_CALIFICAR = '/revision-fotos/calificar';
const NOTA_MAX = 2000;
const AVISO_DIAS = 3;   // a partir de aquí, la pareja pendiente se pinta en rojo

// Del portal, al usarlas (el portal también pide de aquí qué fotos no borrar).
const diasQueSeGuardan = () => require('../Portal/portal.fotos').DIAS;
const fotosDelPortal = () => require('../Portal/portal.coche').FOTOS;

const utc = iso => { const [a, m, d] = String(iso).split('-').map(Number); return Date.UTC(a, m - 1, d); };
const diasEntre = (desde, hasta) => Math.round((utc(hasta) - utc(desde)) / 86400000);

/** Lo que se enseña de un lote. */
const lote = l => (l ? {
  turno: l.turno, quien: l.quien, conductorId: l.conductor_id || null, oficina: l.tipo === 'viaje',
  dia: l.dia, desde: l.desde, hasta: l.hasta, nFotos: l.n_fotos, hechoMs: new Date(l.hecho_at).getTime(),
} : null);

/**
 * LAS PAREJAS (pura): cada lote con el anterior de su coche, con su estado y
 * cuándo se borran sus fotos. Las pendientes primero (la más vieja arriba: es
 * la que antes se borra); luego las calificadas, de la más nueva a la más vieja.
 */
function parejas(lotes, revisiones, { hoy = calendario.hoy(), dias = diasQueSeGuardan() } = {}) {
  const rev = new Map((revisiones || []).map(r => [String(r.turno), r]));
  const protegidos = new Set();
  for (const r of revisiones || []) {
    if (r.resultado !== 'danos') continue;
    protegidos.add(String(r.turno));
    if (r.turno_anterior) protegidos.add(String(r.turno_anterior));
  }
  // El día que la purga se lleva las fotos de un lote: borra las de antes de
  // «hoy − 20», así que las del día D se van el D + 21 por la mañana.
  const seBorra = l => (protegidos.has(String(l.turno)) ? null : calendario.sumarDias(l.dia, dias + 1));

  const porCoche = new Map();
  for (const l of lotes || []) {
    if (!porCoche.has(l.vehiculo_id)) porCoche.set(l.vehiculo_id, []);
    porCoche.get(l.vehiculo_id).push(l);
  }
  const filas = [];
  for (const ls of porCoche.values()) {
    ls.sort((a, b) => new Date(a.hecho_at) - new Date(b.hecho_at) || Number(a.turno) - Number(b.turno));
    ls.forEach((l, i) => {
      const antes = i > 0 ? ls[i - 1] : null;
      const r = rev.get(String(l.turno)) || null;
      const borrados = [seBorra(l), antes ? seBorra(antes) : null].filter(Boolean).sort();
      const borraEl = borrados[0] || null;
      filas.push({
        turno: String(l.turno), vehiculoId: String(l.vehiculo_id), matricula: l.matricula,
        estado: r ? r.resultado : 'pendiente',
        nuevo: lote(l), anterior: lote(antes),
        quien: l.quien, quienAnterior: antes ? antes.quien : '',
        borraEl, quedan: borraEl ? diasEntre(hoy, borraEl) : null,
        revision: r ? {
          resultado: r.resultado, etiqueta: RESULTADOS[r.resultado] || r.resultado, nota: r.nota || '',
          fotos: (r.fotos || []).map(Number), por: r.revisado_nombre || '', cuando: r.revisado || '',
          turnoAnterior: r.turno_anterior || null,
        } : null,
      });
    });
  }
  const pend = filas.filter(f => f.estado === 'pendiente').sort((a, b) => a.nuevo.hechoMs - b.nuevo.hechoMs);
  const hechas = filas.filter(f => f.estado !== 'pendiente').sort((a, b) => b.nuevo.hechoMs - a.nuevo.hechoMs);
  return [...pend, ...hechas];
}

/** Las calificaciones; sin la tabla (db/282 sin aplicar), ninguna y se dice. */
async function calificaciones() {
  try { return { revisiones: await repo.revisiones(), sinTabla: false }; } catch (e) {
    if (repo.faltaMigracion(e)) return { revisiones: [], sinTabla: true };
    throw e;
  }
}

async function todas({ hoy } = {}) {
  const [lotes, { revisiones, sinTabla }] = await Promise.all([repo.lotes(), calificaciones()]);
  return { filas: parejas(lotes, revisiones, { hoy }), sinTabla };
}

/** LA LISTA: una fila por pareja. */
async function lista() {
  const { filas, sinTabla } = await todas();
  return { filas, sinTabla, dias: diasQueSeGuardan(), avisoDias: AVISO_DIAS, resultados: RESULTADOS };
}

/** El número de la foto por el nombre del fichero («1-conductor.jpg» → 1). */
const numeroDe = fichero => Number(String(fichero || '').split('-')[0]) || 0;

/**
 * LA FICHA DE UNA PAREJA: las cinco fotos de cada lote, una al lado de la
 * otra; la calificación si la tiene; y cuál toca después (la siguiente
 * pendiente del mismo coche o, si no queda, la más vieja de los demás).
 */
async function ficha(turno) {
  const { filas, sinTabla } = await todas();
  const f = filas.find(x => x.turno === String(turno));
  if (!f) throw new Error('Ese lote ya no está: sus fotos se borraron a los 20 días, o no es de un coche de Madrid');
  const fotos = await repo.fotosDe([f.turno, f.anterior && f.anterior.turno]);
  const de = t => new Map(fotos.filter(x => x.turno === t).map(x => [numeroDe(x.fichero), `/adjuntos/${x.adjunto}/fichero`]));
  const nuevas = de(f.turno), viejas = f.anterior ? de(f.anterior.turno) : new Map();
  const dano = new Set(f.revision && f.revision.resultado === 'danos' ? f.revision.fotos : []);
  const pend = filas.filter(x => x.estado === 'pendiente' && x.turno !== f.turno);
  const delCoche = pend.filter(x => x.vehiculoId === f.vehiculoId && x.nuevo.hechoMs > f.nuevo.hechoMs);
  const siguiente = (delCoche[0] || pend[0] || null);
  return {
    ...f, sinTabla,
    fotos: fotosDelPortal().map((p, i) => ({
      n: i + 1, etiqueta: p.etiqueta, antes: viejas.get(i + 1) || null, despues: nuevas.get(i + 1) || null, dano: dano.has(i + 1),
    })),
    pendientes: pend.length + (f.estado === 'pendiente' ? 1 : 0),
    siguiente: siguiente ? { turno: siguiente.turno, matricula: siguiente.matricula, mismoCoche: siguiente.vehiculoId === f.vehiculoId } : null,
  };
}

/** Lo que llega del formulario, comprobado. Lanza con un mensaje que se puede enseñar. */
function validar({ resultado, nota, fotos } = {}) {
  const res = String(resultado || '');
  if (!RESULTADOS[res]) throw new Error('Elige «Aprobada» o «Con daños»');
  const n = String(nota == null ? '' : nota).trim();
  if (n.length > NOTA_MAX) throw new Error(`La nota no puede pasar de ${NOTA_MAX} letras`);
  const fs = [...new Set([].concat(fotos || []).map(Number))].filter(x => Number.isInteger(x) && x >= 1 && x <= 5).sort();
  if (res === 'danos') {
    if (!n) throw new Error('Con daños: escribe qué daño se ve');
    if (!fs.length) throw new Error('Con daños: marca en qué foto se ve');
  }
  return { resultado: res, nota: n, fotos: res === 'danos' ? fs : [] };
}

/** CALIFICA una pareja (o cambia lo calificado). Va al libro de auditoría. */
async function calificar(turno, datos, { usuarioId } = {}) {
  const v = validar(datos);
  const { filas, sinTabla } = await todas();
  if (sinTabla) throw new Error('Falta aplicar la migración db/282 (Migraciones)');
  const f = filas.find(x => x.turno === String(turno));
  if (!f) throw new Error('Ese lote ya no está: sus fotos se borraron a los 20 días, o no es de un coche de Madrid');
  const motivo = `Revisión de fotos de ${f.matricula}: ${RESULTADOS[v.resultado].toLowerCase()}`
    + (f.estado !== 'pendiente' ? ` (antes, ${(RESULTADOS[f.estado] || f.estado).toLowerCase()})` : '')
    + (v.nota ? `. ${v.nota}` : '');
  await libro.conFirma({ usuarioId, origen: 'revision-fotos', accion: v.resultado === 'aprobada' ? 'aprobacion' : 'estado', motivo },
    cli => repo.guardar(cli, {
      turno: f.turno, anterior: f.anterior ? f.anterior.turno : null, vehiculoId: f.vehiculoId,
      resultado: v.resultado, nota: v.nota, fotos: v.fotos, usuarioId,
    }));
  olvidarCuenta();
  contadores.cambio('revision_fotos');
  return { ok: true, resultado: v.resultado, etiqueta: RESULTADOS[v.resultado] };
}

/** Los turnos cuyas fotos no se borran (los de las parejas con daños). Para la purga del portal. */
const turnosProtegidos = cli => repo.turnosProtegidos(cli);

// ── EL NÚMERO DEL MENÚ: las parejas por revisar ────────────────────────────
// Se cuenta todo de una vez y se guarda un minuto: lo piden todas las pantallas.
let cuenta = null;   // { en, valor: Promise<{ n, urgentes }> }
const olvidarCuenta = () => { cuenta = null; };
function pendientes() {
  if (cuenta && Date.now() - cuenta.en < 60000) return cuenta.valor;
  const valor = todas().then(({ filas }) => {
    const p = filas.filter(f => f.estado === 'pendiente');
    return { n: p.length, urgentes: p.filter(f => f.quedan != null && f.quedan <= AVISO_DIAS).length };
  });
  cuenta = { en: Date.now(), valor };
  valor.catch(() => { if (cuenta && cuenta.valor === valor) cuenta = null; });
  return valor;
}

/** Ha llegado un lote nuevo (el portal acaba de guardar fotos). */
function loteNuevo() {
  olvidarCuenta();
  contadores.cambio('revision_fotos');
}

contadores.registrarFuente('revision_fotos', {
  async contar(quien) {
    const ve = quien && (quien.permisos === null || (Array.isArray(quien.permisos) && quien.permisos.includes(CLAVE_VER)));
    if (!ve) return {};
    const { n, urgentes } = await pendientes();
    return { 'revision_fotos.pendientes': { n, tono: urgentes ? 'aviso' : 'info',
      titulo: `${n} ${n === 1 ? 'lote' : 'lotes'} de fotos por revisar` + (urgentes ? ` (${urgentes} se ${urgentes === 1 ? 'borra' : 'borran'} en ${AVISO_DIAS} días o menos)` : '') } };
  },
});

module.exports = { lista, ficha, calificar, validar, parejas, turnosProtegidos, loteNuevo, RESULTADOS, CLAVE_VER, CLAVE_CALIFICAR, AVISO_DIAS };
