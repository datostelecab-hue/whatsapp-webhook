// ============================================================
// LA ORGANIZACIÓN — áreas, superiores y quién hace qué (db/248)
// ============================================================
// Pieza A5 de docs/Hoja de ruta.md (13/11/2026). La hoja de ruta reparte el
// trabajo entre personas: «la aprueba un supervisor (Ángel, William o
// Ignacio)», «una tarea para Daiane», «avisa al responsable y a su superior»,
// «cada responsable de área ve el suyo». Esto es lo que lo resuelve sin escribir
// un nombre ni un id en el código:
//
//   organizacion.quienes('multas')            → [{ id: 9, nombre: 'Daiane Alves', suplente: false }]
//   await organizacion.exigir(usuarioId, 'expedientes_ver')   // lanza si no la tiene
//   organizacion.superiorDe(usuarioId)        → { id, nombre } o null
//   organizacion.equipo(usuarioId)            → a quién ve en el «Tablero del equipo»
//
// UNA FUNCIÓN NO ES UNA LLAVE. La llave (services/permisos.js) dice qué pantalla
// abre alguien; la función dice qué le toca hacer: a quién le llega una tarea,
// quién aprueba. Y se mira EN LA PERSONA: ni el superadmin ni el desarrollador
// tienen una función por su rol (como la llave de aprobar vacaciones).
//
// EL CATÁLOGO DE FUNCIONES es este fichero; quién tiene cada una está en la base
// (usuario_funcion), con su historia: darla y quitarla quedan en el libro de
// auditoría (db/245), y quitarla es anularla con motivo.
'use strict';

const repo = require('./repo/organizacion');
const libro = require('./libro');
const permisos = require('./permisos');

// ── El catálogo de funciones ───────────────────────────────────────────────
// `item`: el ítem de la hoja de ruta que la usa. `varias`: si la pueden tener
// varias personas a la vez (todas pueden tener suplente).
const FUNCIONES = [
  { codigo: 'supervisor', etiqueta: 'Supervisor: aprueba tarjetas', item: 1, varias: true,
    descripcion: 'Aprueba las tarjetas que lo necesitan (una suspensión que detecta Control, una sanción); el plazo cuenta desde su aprobación.' },
  { codigo: 've_todos_los_tableros', etiqueta: 'Ve el tablero de todos', item: 1, varias: true,
    descripcion: 'En el «Tablero del equipo» ve el de toda la oficina, no solo el de su área.' },
  { codigo: 'direccion', etiqueta: 'Dirección: valida', item: 4, varias: true,
    descripcion: 'Valida las propuestas de despido antes de que lleguen a RR. HH.' },
  { codigo: 'expedientes', etiqueta: 'Lleva los expedientes laborales', item: 4, varias: false,
    descripcion: 'Cada expediente nuevo le crea una tarea con su plazo.' },
  { codigo: 'expedientes_ver', etiqueta: 'Ve los expedientes laborales', item: 4, varias: true,
    descripcion: 'Datos sensibles: solo quien tenga esta función ve el tablero de expedientes, también en la búsqueda.' },
  { codigo: 'nomina', etiqueta: 'Lleva la nómina', item: 7, varias: false,
    descripcion: 'Recibe el informe de pendientes del día 20 y los descuentos y reintegros que entran en nómina.' },
  { codigo: 'cartas_consulta', etiqueta: 'Consulta las cartas de descuento', item: 6, varias: true,
    descripcion: 'Ve las cartas y su firma; no las emite.' },
  { codigo: 'desactiva_baja_voluntaria', etiqueta: 'Desactiva al que se va: baja voluntaria o periodo de prueba', item: 8, varias: true,
    descripcion: 'Tarea de desactivar al trabajador en Telecab y en Bolt el mismo día.' },
  { codigo: 'desactiva_suspension_despido', etiqueta: 'Desactiva al que se va: suspensión o despido', item: 8, varias: true,
    descripcion: 'Tarea de desactivar al trabajador en Telecab y en Bolt el mismo día.' },
  { codigo: 'desactiva_fin_ett', etiqueta: 'Desactiva al que se va: fin de contrato de ETT', item: 8, varias: true,
    descripcion: 'Tarea de desactivar al trabajador en Telecab y en Bolt el mismo día.' },
  { codigo: 'credenciales_combustible', etiqueta: 'Anula credenciales y PIN de combustible', item: 8, varias: true,
    descripcion: 'Al cerrar una baja o un despido, tarea de anularlos en 1 día.' },
  { codigo: 'multas', etiqueta: 'Identifica las multas', item: 10, varias: true,
    descripcion: 'Sube las multas, las identifica en plazo o las escala.' },
  { codigo: 'multas_escalado', etiqueta: 'Recibe las multas que no se pueden identificar', item: 10, varias: true,
    descripcion: 'Las multas escaladas. Angie (Formentera) también, pero no tiene usuario.' },
  { codigo: 'caja_receptor', etiqueta: 'Recibe efectivo', item: 12, varias: true,
    descripcion: 'Quien puede apuntar que ha recibido efectivo de un conductor. El suplente, solo si falta el titular.' },
  { codigo: 'caja_testigo', etiqueta: 'Testigo del arqueo de caja', item: 12, varias: true,
    descripcion: 'Firma el arqueo del lunes cuando quien firma recibió efectivo esa semana. Angie también, sin usuario.' },
  { codigo: 'avisos_combustible', etiqueta: 'Recibe los avisos de cargas raras de combustible', item: 13, varias: true,
    descripcion: 'Las cargas que no cuadran con el turno o con el servicio del coche.' },
  { codigo: 'documentacion_vehiculos', etiqueta: 'Sube a Bolt la documentación de los coches', item: 14, varias: true,
    descripcion: 'Documentos nuevos o renovados, coches que entran o salen, e ITV a 30 días.' },
  { codigo: 'reintegros', etiqueta: 'Aprueba reintegros hasta el tope', item: 15, varias: true,
    descripcion: 'Aprueba o corrige el importe hasta el tope del parámetro reintegros.tope_daiane.' },
  { codigo: 'reintegros_por_encima', etiqueta: 'Aprueba reintegros por encima del tope', item: 15, varias: true,
    descripcion: 'Lo que pasa del tope.' },
  { codigo: 'taller', etiqueta: 'Responsable del taller', item: 16, varias: true,
    descripcion: 'Acusa recibo de las averías, da fecha de taller y programa los mantenimientos.' },
  { codigo: 'sustituciones', etiqueta: 'Coche de sustitución y cambio de cuadrante', item: 16, varias: true,
    descripcion: 'Cuando un coche queda en stand-by, le llega la tarea.' },
  { codigo: 'polizas', etiqueta: 'Lleva las pólizas de seguro', item: 19, varias: true,
    descripcion: 'Es quien las edita, y le llega la tarea de renovarlas.' },
];
const POR_CODIGO = new Map(FUNCIONES.map(f => [f.codigo, f]));

function funcion(codigo) {
  const f = POR_CODIGO.get(String(codigo || ''));
  if (!f) throw new Error(`No existe la función «${codigo}»`);
  return f;
}

const entero = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// ── Leer ───────────────────────────────────────────────────────────────────
/** Quién tiene una función (vigente, y usuario no bloqueado). Primero los titulares. */
async function quienes(codigo, { conSuplentes = true } = {}) {
  funcion(codigo);
  return (await repo.funciones())
    .filter(f => f.funcion === codigo && f.estado !== 'bloqueado' && (conSuplentes || !f.suplente))
    .map(f => ({ id: f.usuario_id, nombre: f.nombre, suplente: f.suplente }));
}

/** ¿La tiene esta persona (titular o suplente)? Ante cualquier duda, no. */
async function tiene(usuarioId, codigo) {
  const id = entero(usuarioId);
  if (!id) return false;
  return (await quienes(codigo)).some(p => p.id === id);
}

/** Lanza, diciendo quién la tiene, si esta persona no tiene la función. */
async function exigir(usuarioId, codigo) {
  if (await tiene(usuarioId, codigo)) return;
  const f = funcion(codigo);
  const q = (await quienes(codigo)).map(p => p.nombre);
  throw new Error(q.length
    ? `«${f.etiqueta}» es de ${q.join(', ')}.`
    : `Nadie tiene la función «${f.etiqueta}»: hay que dársela a alguien en Organización.`);
}

/**
 * El superior de una persona: el que tiene puesto; si no, el responsable de su
 * área (salvo que sea ella misma). Sin nada de eso, null. Bloqueados, nunca: un
 * superior puesto que está bloqueado no cuenta, y entonces manda el área.
 */
async function superiorDe(usuarioId) {
  const id = entero(usuarioId);
  if (!id) return null;
  const [gente, areas] = await Promise.all([repo.personas({ conBloqueados: true }), repo.areas()]);
  return superiorEn(gente, areas, id);
}

function superiorEn(gente, areas, id) {
  const p = gente.find(x => x.id === id);
  if (!p) return null;
  const activo = uid => gente.find(x => x.id === uid && x.estado !== 'bloqueado');
  if (p.superior_id) {
    const s = activo(p.superior_id);
    if (s) return { id: s.id, nombre: s.nombre, porque: 'puesto' };
  }
  const a = areas.find(x => x.codigo === p.area_codigo);
  if (a && a.responsable_id && a.responsable_id !== id) {
    const s = activo(a.responsable_id);
    return s ? { id: s.id, nombre: s.nombre, porque: 'responsable del área' } : null;
  }
  return null;
}

/**
 * Un camino de superiores que sale de `id` y vuelve a ella, contando los DOS
 * enlaces de cada persona (su superior puesto y el responsable de su área), o
 * null. → [id, …, id]. Los bloqueados cuentan: pueden desbloquearse.
 */
function circuloDesde(gente, areas, id) {
  const porId = new Map(gente.map(p => [p.id, p]));
  const resp = new Map(areas.filter(a => a.responsable_id).map(a => [a.codigo, a.responsable_id]));
  const enlaces = x => {
    const p = porId.get(x);
    if (!p) return [];
    const r = resp.get(p.area_codigo);
    return [...new Set([p.superior_id, r].filter(y => y && y !== x))];
  };
  const padre = new Map([[id, null]]);
  const pila = [id];
  while (pila.length) {
    const x = pila.pop();
    for (const y of enlaces(x)) {
      if (y === id) {
        const camino = [id];
        for (let z = x; z !== id; z = padre.get(z)) camino.splice(1, 0, z);
        return [...camino, id];
      }
      if (!padre.has(y)) { padre.set(y, x); pila.push(y); }
    }
  }
  return null;
}

/**
 * A quién ve una persona en el «Tablero del equipo» (ítem 1): todos, si tiene
 * «ve_todos_los_tableros»; si no, la gente de las áreas de las que es
 * responsable y quien la tenga puesta como superior.
 */
async function equipo(usuarioId) {
  const id = entero(usuarioId);
  if (!id) return { todos: false, personas: [] };
  const [gente, areas, todos] = await Promise.all([repo.personas(), repo.areas(), tiene(id, 've_todos_los_tableros')]);
  const lleva = new Set(areas.filter(a => a.responsable_id === id).map(a => a.codigo));
  const personas = gente.filter(p => p.id !== id && (todos || lleva.has(p.area_codigo) || p.superior_id === id))
    .map(p => ({ id: p.id, nombre: p.nombre, area: p.area_codigo }));
  return { todos, personas };
}

/**
 * Las llaves de una persona que se salen de las de su rol: la «matriz de
 * permisos por rol» de la convención 6, con sus excepciones por persona.
 */
async function excepcionesDeLlaves(usuarioId, rol) {
  const id = entero(usuarioId);
  if (!id || ['superadmin', 'desarrollador'].includes(rol)) return { accesoTotal: true, deMas: [], deMenos: [] };
  const semilla = new Set(permisos.semillaDeRol(rol));
  const tiene_ = await permisos.clavesDe(id);
  const etiqueta = new Map();
  for (const g of permisos.CATALOGO) {
    for (const it of g.items) {
      etiqueta.set(it.clave, `${g.grupo} · ${it.etiqueta}`);
      // Las hijas ya llevan el nombre de su pantalla («Planificador · editar…»).
      for (const h of it.hijos || []) etiqueta.set(h.clave, `${g.grupo} · ${h.etiqueta}`);
    }
  }
  const conEtiqueta = c => ({ clave: c, etiqueta: etiqueta.get(c) || c });
  return {
    accesoTotal: false,
    deMas: [...tiene_].filter(c => !semilla.has(c)).sort().map(conEtiqueta),
    deMenos: [...semilla].filter(c => !tiene_.has(c)).sort().map(conEtiqueta),
  };
}

/** Lo que pinta la pantalla /organizacion: cada persona con su sitio y lo que hace. */
async function organigrama() {
  const [gente, areas, funcs] = await Promise.all([repo.personas(), repo.areas(), repo.funciones()]);
  const etqArea = new Map(areas.map(a => [a.codigo, a.etiqueta]));
  const personas = gente.map(p => {
    const sup = superiorEn(gente, areas, p.id);
    const suyas = funcs.filter(f => f.usuario_id === p.id).map(f => ({
      id: f.id, codigo: f.funcion, etiqueta: (POR_CODIGO.get(f.funcion) || {}).etiqueta || f.funcion,
      suplente: f.suplente, desde: f.creado_at, dadaPor: f.dada_por || null, nota: f.nota,
    }));
    return {
      id: p.id, nombre: p.nombre, email: p.email, rol: p.rol, rolEtiqueta: p.rol_etiqueta,
      area: p.area_codigo, areaEtiqueta: etqArea.get(p.area_codigo) || null,
      responsableDe: areas.filter(a => a.responsable_id === p.id).map(a => a.etiqueta),
      superiorId: p.superior_id, superior: sup ? sup.nombre : null, superiorPorque: sup ? sup.porque : null,
      funciones: suyas,
    };
  });
  const sinNadie = FUNCIONES.filter(f => !funcs.some(x => x.funcion === f.codigo && x.estado !== 'bloqueado'))
    .map(f => ({ codigo: f.codigo, etiqueta: f.etiqueta, item: f.item }));
  return { personas, areas, funciones: FUNCIONES, sinNadie };
}

/** La ficha de una persona: lo del organigrama, más sus llaves fuera de su rol. */
async function ficha(usuarioId) {
  const id = entero(usuarioId);
  const o = await organigrama();
  const p = o.personas.find(x => x.id === id);
  if (!p) throw new Error('Esa persona no existe o está bloqueada');
  return { ...p, llaves: await excepcionesDeLlaves(p.id, p.rol) };
}

// ── Cambiar ────────────────────────────────────────────────────────────────
/**
 * Pone el área y el superior de una persona. `responsable`: si es la
 * responsable de esa área (si el área ya tenía otra, pasa a ser esta). Cada
 * persona está en UNA área, así que solo lleva esa: al cambiarla de área, o con
 * `responsable` en falso, deja de llevar la que llevase. Un superior no puede
 * acabar siendo subordinado suyo.
 */
async function ponerArea(usuarioId, { area, superiorId, responsable = false } = {}, { quien } = {}) {
  const id = entero(usuarioId);
  if (!id) throw new Error('Falta la persona');
  const cod = area ? String(area) : null;
  const sup = superiorId ? entero(superiorId) : null;
  if (superiorId && !sup) throw new Error('Ese superior no se entiende');
  if (sup === id) throw new Error('Nadie es su propio superior');
  if (responsable && !cod) throw new Error('Para ser responsable de un área, primero hay que estar en ella');

  await libro.conFirma({ usuarioId: quien, origen: 'organizacion' }, async cli => {
    // En fila y leyendo dentro de la transacción: dos cambios a la vez no
    // pueden cerrar un círculo entre los dos.
    await repo.bloquear(cli);
    // Con los bloqueados: también cuentan para que no quede un círculo (abajo).
    const todos = await repo.personas({ conBloqueados: true, cli });
    const gente = todos.filter(p => p.estado !== 'bloqueado');
    const areas = await repo.areas(cli);
    if (!gente.some(p => p.id === id)) throw new Error('Esa persona no existe o está bloqueada');
    if (cod && !areas.some(a => a.codigo === cod && a.activa)) throw new Error(`No existe el área «${area}»`);
    if (sup && !gente.some(p => p.id === sup)) throw new Error('Ese superior no existe o está bloqueado');

    // QUE NO SE CIERRE UN CÍRCULO, ni ahora ni cuando alguien se bloquee o se
    // desbloquee. Cada persona depende de su superior puesto o, si no lo tiene
    // o está bloqueado, del responsable de su área: así que bloquear a alguien
    // en /usuarios cambia de quién depende la gente que lo tenía puesto, sin
    // pasar por aquí. Por eso se mira con LOS DOS enlaces de cada persona a la
    // vez (el puesto y el del área), bloqueados incluidos: si con ellos no hay
    // círculo, ningún bloqueo ni desbloqueo de después lo puede cerrar, porque
    // cada persona solo usa uno de sus dos. Todo enlace que cambia aquí toca a
    // esta persona, así que basta con buscar un camino que vuelva a ella.
    const simulada = todos.map(p => (p.id === id ? { ...p, area_codigo: cod, superior_id: sup } : p));
    const areasSim = areas.map(a => (a.codigo === cod && responsable ? { ...a, responsable_id: id }
      : (a.responsable_id === id ? { ...a, responsable_id: null } : a)));
    const camino = circuloDesde(simulada, areasSim, id);
    if (camino) {
      const nombre = x => (simulada.find(p => p.id === x) || {}).nombre || `#${x}`;
      const hoy = camino.slice(1).every((x, i) => (superiorEn(simulada, areasSim, camino[i]) || {}).id === x);
      throw new Error(hoy
        ? `Así quedaría un círculo de superiores: ${camino.map(nombre).join(' → ')}`
        : `Así podría quedar un círculo de superiores: ${camino.map(nombre).join(' → ')}. ` +
          'Pasaría al bloquear a alguien, porque entonces su gente depende del responsable de su área. Elige otro superior.');
    }

    await repo.ponerAreaYSuperior(cli, id, cod, sup);
    await repo.soltarResponsable(cli, id, responsable ? cod : null);
    if (responsable) await repo.ponerResponsable(cli, cod, id);
  });
  return ficha(id);
}

/**
 * Da una función a una persona. Si es de una sola persona y su titular está
 * BLOQUEADO (se fue, o ya no entra en el ERP), se le anula a él en la misma
 * transacción, con su motivo: si no, al desbloquearlo habría dos titulares, y
 * desde la pantalla no se le podría quitar (no enseña a los bloqueados).
 */
async function darFuncion(usuarioId, codigo, { suplente = false, nota = '' } = {}, { quien } = {}) {
  const id = entero(usuarioId);
  if (!id) throw new Error('Falta la persona');
  const f = funcion(codigo);
  await libro.conFirma({ usuarioId: quien, origen: 'organizacion' }, async cli => {
    await repo.bloquear(cli);
    const yo = (await repo.personas({ cli })).find(p => p.id === id);
    if (!yo) throw new Error('Esa persona no existe o está bloqueada');
    const vigentes = (await repo.funciones({ cli })).filter(x => x.funcion === codigo);
    if (vigentes.some(x => x.usuario_id === id)) throw new Error(`Ya tiene «${f.etiqueta}»`);
    if (!f.varias && !suplente) {
      const titulares = vigentes.filter(x => !x.suplente);
      const activos = titulares.filter(x => x.estado !== 'bloqueado');
      if (activos.length) {
        throw new Error(`«${f.etiqueta}» es de una sola persona (${activos.map(x => x.nombre).join(', ')}): quítasela antes, o dásela como suplente`);
      }
      for (const t of titulares) {
        // El motivo firmado vale para la anulación (un UPDATE); el alta de
        // abajo es siempre «alta».
        const motivo = `Pasa a ${yo.nombre}: ${t.nombre} está bloqueado en el ERP`;
        await libro.firmar(cli, { usuarioId: quien, origen: 'organizacion', motivo });
        await repo.anularFuncion(cli, { id: t.id, motivo, anuladoPor: entero(quien) });
      }
    }
    await repo.darFuncion(cli, { usuarioId: id, funcion: codigo, suplente: !!suplente,
      nota: String(nota || '').trim().slice(0, 500) || null, creadoPor: entero(quien) });
  });
  return ficha(id);
}

/**
 * Quita una función: la anula, con motivo. Devuelve la ficha de la persona, o
 * null si ya no se puede enseñar (la bloquearon mientras tanto): lo guardado,
 * guardado está, y no se contesta un error por eso.
 */
async function quitarFuncion(asignacionId, motivo, { quien } = {}) {
  const id = entero(asignacionId);
  if (!id) throw new Error('Falta cuál');
  const m = String(motivo || '').trim();
  if (m.length < 3) throw new Error('Di por qué se le quita: queda en su historia');
  const dueno = await libro.conFirma({ usuarioId: quien, origen: 'organizacion', motivo: m }, async cli => {
    await repo.bloquear(cli);
    const f = (await repo.funciones({ cli })).find(x => x.id === id);
    if (!f || !await repo.anularFuncion(cli, { id, motivo: m.slice(0, 500), anuladoPor: entero(quien) })) {
      throw new Error('Esa función ya no la tiene');
    }
    return f.usuario_id;
  });
  try { return await ficha(dueno); } catch (_) { return null; }
}

module.exports = {
  FUNCIONES, funcion, quienes, tiene, exigir, superiorDe, equipo, excepcionesDeLlaves,
  organigrama, ficha, ponerArea, darFuncion, quitarFuncion,
};
