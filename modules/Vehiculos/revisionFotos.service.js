// ============================================================
// REVISIÓN DE FOTOS — LA PUERTA (db/282-283, 24/11/2026)
// ============================================================
// Camilo: «un módulo en el ERP en taller, en el cual pueda comparar las dos
// últimos lotes de fotos de los conductores, por ejemplo, si lo coge hoy
// Carlos, toma las fotos y lo deja, el próximo hará lo mismo, entonces, en
// dicho módulo, por cada dos últimas fotos, debemos de comprobar a mano las
// fotos de los coches, para aprobar la revisión, una vez calificada, esperamos
// el próximo ciclo de dos lotes de fotos». Y luego (db/283): «la quiero tipo
// tinder jajaj, toca aprobar cada foto con su némesis (…) también poder poner
// si una foto está mal tomada o no muestra nada, para poder reportar al
// conductor por no hacer el trabajo, es comparación por comparación, dos, dos,
// dos, dos y dos, cada una con aprobar / con daños / Imagen no válida».
//
// LAS REGLAS (decididas en el chat)
//   · UN LOTE: las cinco fotos de quien desvincula el coche en el portal. Su
//     dueño es su turno de fichaje (`turno_fotos`).
//   · CADA LOTE CON EL ANTERIOR del mismo coche: A-B, B-C, C-D… El primero de
//     un coche (o aquel cuyo anterior ya se borró) se revisa solo.
//   · FOTO A FOTO: la n del lote nuevo contra la n del anterior, una tras
//     otra. Cada una: «Aprobada», «Con daños» (qué se ve, obligatorio) o
//     «Imagen no válida» (mal hecha o no enseña nada; motivo opcional). Las
//     dos últimas son del conductor del lote nuevo.
//   · LA PAREJA SE CIERRA AL JUZGAR LA QUINTA: con daños si alguna lo tiene;
//     si no, imagen no válida si alguna lo es; si no, aprobada. Cambiar una
//     foto después vuelve a calcularla. Todo va al libro de auditoría.
//   · LAS FOTOS SE BORRAN A LOS 20 DÍAS (portal.fotos), salvo: los dos lotes de
//     una pareja con daños (el de antes prueba que no estaba) y el lote nuevo
//     de una con alguna imagen no válida (la prueba para el conductor).
//   · Solo la flota de Madrid, como todo el taller.
'use strict';

const repo = require('./revisionFotos.repo');
const calendario = require('../../services/calendario');
const libro = require('../../services/libro');
const contadores = require('../../services/contadores');

const RESULTADOS = { aprobada: 'Aprobada', danos: 'Con daños', no_valida: 'Imagen no válida' };
const CLAVE_VER = '/revision-fotos';
const CLAVE_CALIFICAR = '/revision-fotos/calificar';
const NOTA_MAX = 500;
const AVISO_DIAS = 3;   // a partir de aquí, la pareja pendiente se pinta en rojo
const TOTAL = 5;

// Del portal, al usarlas (el portal también pide de aquí qué fotos no borrar).
const diasQueSeGuardan = () => require('../Portal/portal.fotos').DIAS;
const fotosDelPortal = () => require('../Portal/portal.coche').FOTOS;

const utc = iso => { const [a, m, d] = String(iso).split('-').map(Number); return Date.UTC(a, m - 1, d); };
const diasEntre = (desde, hasta) => Math.round((utc(hasta) - utc(desde)) / 86400000);

/** El resultado de la pareja, de los de sus fotos: daños gana, luego no válida. */
const resultadoDe = rs => (rs.includes('danos') ? 'danos' : rs.includes('no_valida') ? 'no_valida' : 'aprobada');

/** Lo que se enseña de un lote. */
const lote = l => (l ? {
  turno: l.turno, quien: l.quien, conductorId: l.conductor_id || null, oficina: l.tipo === 'viaje',
  dia: l.dia, desde: l.desde, hasta: l.hasta, nFotos: l.n_fotos, hechoMs: new Date(l.hecho_at).getTime(),
} : null);

/**
 * LAS PAREJAS (pura): cada lote con el anterior de su coche, con su estado,
 * lo juzgado de cada foto y cuándo se borran sus fotos. Las pendientes
 * primero (la más vieja arriba: es la que antes se borra); luego las
 * calificadas, de la más nueva a la más vieja.
 */
function parejas(lotes, revisiones, { hoy = calendario.hoy(), dias = diasQueSeGuardan(), veredictos = [] } = {}) {
  const rev = new Map((revisiones || []).map(r => [String(r.turno), r]));
  const porFoto = new Map();
  for (const v of veredictos || []) {
    const t = String(v.turno);
    if (!porFoto.has(t)) porFoto.set(t, {});
    porFoto.get(t)[Number(v.n)] = { resultado: v.resultado, etiqueta: RESULTADOS[v.resultado] || v.resultado, nota: v.nota || '', por: v.por || '', cuando: v.cuando || '' };
  }
  const protegidos = new Set();
  for (const r of revisiones || []) {
    if (r.resultado === 'danos') {
      protegidos.add(String(r.turno));
      if (r.turno_anterior) protegidos.add(String(r.turno_anterior));
    } else if (r.resultado === 'no_valida') protegidos.add(String(r.turno));
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
      const fotos = porFoto.get(String(l.turno)) || {};
      const juzgadas = Object.values(fotos);
      const borrados = [seBorra(l), antes ? seBorra(antes) : null].filter(Boolean).sort();
      const borraEl = borrados[0] || null;
      filas.push({
        turno: String(l.turno), vehiculoId: String(l.vehiculo_id), matricula: l.matricula,
        estado: r ? r.resultado : 'pendiente',
        hechas: juzgadas.length, total: TOTAL,
        veredictos: fotos,
        nDanos: juzgadas.filter(v => v.resultado === 'danos').length,
        nNoValidas: juzgadas.filter(v => v.resultado === 'no_valida').length,
        nuevo: lote(l), anterior: lote(antes),
        quien: l.quien, quienAnterior: antes ? antes.quien : '',
        borraEl, quedan: borraEl ? diasEntre(hoy, borraEl) : null,
        revision: r ? {
          resultado: r.resultado, etiqueta: RESULTADOS[r.resultado] || r.resultado, nota: r.nota || '',
          por: r.revisado_nombre || '', cuando: r.revisado || '', turnoAnterior: r.turno_anterior || null,
        } : null,
      });
    });
  }
  const pend = filas.filter(f => f.estado === 'pendiente').sort((a, b) => a.nuevo.hechoMs - b.nuevo.hechoMs);
  const hechas = filas.filter(f => f.estado !== 'pendiente').sort((a, b) => b.nuevo.hechoMs - a.nuevo.hechoMs);
  return [...pend, ...hechas];
}

/** Las calificaciones y los veredictos; sin las tablas (db/282-283 sin aplicar), ninguno y se dice. */
async function calificaciones() {
  let revisiones = [], sinTabla = false;
  try { revisiones = await repo.revisiones(); } catch (e) {
    if (!repo.faltaMigracion(e)) throw e;
    sinTabla = true;
  }
  const veredictos = sinTabla ? null : await repo.veredictos();
  return { revisiones, veredictos: veredictos || [], sinTabla: sinTabla || veredictos === null };
}

async function todas({ hoy } = {}) {
  const [lotes, { revisiones, veredictos, sinTabla }] = await Promise.all([repo.lotes(), calificaciones()]);
  return { filas: parejas(lotes, revisiones, { hoy, veredictos }), sinTabla };
}

/** LA LISTA: una fila por pareja. */
async function lista() {
  const { filas, sinTabla } = await todas();
  return { filas, sinTabla, dias: diasQueSeGuardan(), avisoDias: AVISO_DIAS, resultados: RESULTADOS };
}

/** El número de la foto por el nombre del fichero («1-conductor.jpg» → 1). */
const numeroDe = fichero => Number(String(fichero || '').split('-')[0]) || 0;

/**
 * LA FICHA DE UNA PAREJA: las cinco comparaciones (antes y después de cada
 * foto, con lo que se juzgó); y cuál toca después (la siguiente pendiente del
 * mismo coche o, si no queda, la más vieja de los demás).
 */
async function ficha(turno) {
  const { filas, sinTabla } = await todas();
  const f = filas.find(x => x.turno === String(turno));
  if (!f) throw new Error('Ese lote ya no está: sus fotos se borraron a los 20 días, o no es de un coche de Madrid');
  const fotos = await repo.fotosDe([f.turno, f.anterior && f.anterior.turno]);
  const de = t => new Map(fotos.filter(x => x.turno === t).map(x => [numeroDe(x.fichero), `/adjuntos/${x.adjunto}/fichero`]));
  const nuevas = de(f.turno), viejas = f.anterior ? de(f.anterior.turno) : new Map();
  const pend = filas.filter(x => x.estado === 'pendiente' && x.turno !== f.turno);
  const delCoche = pend.filter(x => x.vehiculoId === f.vehiculoId && x.nuevo.hechoMs > f.nuevo.hechoMs);
  const siguiente = (delCoche[0] || pend[0] || null);
  return {
    ...f, sinTabla,
    fotos: fotosDelPortal().map((p, i) => ({
      n: i + 1, etiqueta: p.etiqueta, antes: viejas.get(i + 1) || null, despues: nuevas.get(i + 1) || null,
      veredicto: f.veredictos[i + 1] || null,
    })),
    pendientes: pend.length + (f.estado === 'pendiente' ? 1 : 0),
    siguiente: siguiente ? { turno: siguiente.turno, matricula: siguiente.matricula, mismoCoche: siguiente.vehiculoId === f.vehiculoId } : null,
  };
}

/** El veredicto de una foto, comprobado. Lanza con un mensaje que se puede enseñar. */
function validarFoto({ n, resultado, nota } = {}) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > TOTAL) throw new Error('Esa foto no existe');
  const res = String(resultado || '');
  if (!RESULTADOS[res]) throw new Error('Elige «Aprobada», «Con daños» o «Imagen no válida»');
  const t = String(nota == null ? '' : nota).trim();
  if (t.length > NOTA_MAX) throw new Error(`La nota no puede pasar de ${NOTA_MAX} letras`);
  if (res === 'danos' && !t) throw new Error('Con daños: escribe qué daño se ve');
  return { n: num, resultado: res, nota: res === 'aprobada' ? '' : t };
}

/**
 * JUZGA UNA FOTO (o cambia lo juzgado). Con la quinta, cierra la pareja; si
 * ya estaba cerrada, la vuelve a calcular. Va al libro de auditoría.
 * Devuelve { hechas, total, cerrada: { resultado, etiqueta } | null }.
 */
async function calificarFoto(turno, datos, { usuarioId } = {}) {
  const v = validarFoto(datos);
  const { filas, sinTabla } = await todas();
  if (sinTabla) throw new Error('Faltan las migraciones db/282 y db/283 (Migraciones)');
  const f = filas.find(x => x.turno === String(turno));
  if (!f) throw new Error('Ese lote ya no está: sus fotos se borraron a los 20 días, o no es de un coche de Madrid');
  const etiquetaFoto = (fotosDelPortal()[v.n - 1] || {}).etiqueta || `Foto ${v.n}`;
  const motivo = `Revisión de fotos de ${f.matricula} · ${etiquetaFoto}: ${RESULTADOS[v.resultado].toLowerCase()}`
    + (v.nota ? `. ${v.nota}` : '');
  const r = await libro.conFirma({ usuarioId, origen: 'revision-fotos', accion: 'estado', motivo }, async cli => {
    const juzgadas = await repo.guardarFoto(cli, { turno: f.turno, n: v.n, resultado: v.resultado, nota: v.nota, usuarioId });
    if (juzgadas.length < TOTAL) return { hechas: juzgadas.length, cerrada: null };
    const resultado = resultadoDe(juzgadas.map(x => x.resultado));
    const conDano = juzgadas.filter(x => x.resultado === 'danos').map(x => Number(x.n));
    await repo.guardar(cli, {
      turno: f.turno, anterior: f.anterior ? f.anterior.turno : null, vehiculoId: f.vehiculoId,
      resultado, nota: null, fotos: conDano, usuarioId,
    });
    return { hechas: TOTAL, cerrada: { resultado, etiqueta: RESULTADOS[resultado] } };
  });
  if (r.cerrada || f.estado !== 'pendiente') { olvidarCuenta(); contadores.cambio('revision_fotos'); }
  return { ...r, total: TOTAL, matricula: f.matricula };
}

/** Los turnos cuyas fotos no se borran (los de las parejas con daños o no válidas). Para la purga del portal. */
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

module.exports = {
  lista, ficha, calificarFoto, validarFoto, parejas, resultadoDe, turnosProtegidos, loteNuevo,
  RESULTADOS, CLAVE_VER, CLAVE_CALIFICAR, AVISO_DIAS, TOTAL,
};
