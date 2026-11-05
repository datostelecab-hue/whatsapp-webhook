// ============================================================
// COMPROBAR QUE LA RECAUDACIÓN DE CADA SEDE SOLO TOCA LO SUYO (db/230)
// ============================================================
//   node scripts/comprobar-recaudacion-sedes.js
//
// Madrid y Barcelona comparten el código de la recaudación
// (modules/Administracion/recaudacion.repo.js, `crear(cfg)`) y cada una tiene sus
// tablas. Un nombre de tabla escrito a mano en una consulta nueva haría que
// Barcelona cobrara en la caja de Madrid, o al revés, sin que nada fallara.
//
// Esto arma las dos con una base de mentira que APUNTA todo el SQL que se le
// pide, ejecuta cada función y mira qué tablas ha nombrado. No toca ninguna base.

const fabrica = require('../modules/Administracion/recaudacion.repo');

let fallos = 0;
const ok = (titulo, cond, extra) => {
  if (!cond) fallos++;
  console.log(`${cond ? 'OK   ' : 'FALLO'} ${titulo}${!cond && extra ? '  → ' + extra : ''}`);
};

// Una base que contesta lo justo para que cada función llegue a su SQL.
function baseDeMentira() {
  const sql = [];
  const responde = (texto, params) => {
    sql.push(texto);
    if (/RETURNING id/i.test(texto)) return { rows: [{ id: 1, importe: '0', ajuste: '0' }], rowCount: 1 };
    if (/externo_id = \$1/.test(texto)) return { rows: [{ id: 'u-1', conductor: 'Cuenta', externo_id: 'u-1' }] };
    if (/FROM conductor c WHERE id = \$1/.test(texto)) return { rows: [{ id: 1, conductor: 'Persona' }] };
    if (/RETURNING importe, ajuste/.test(texto)) return { rows: [{ importe: '0', ajuste: '0' }] };
    if (/count\(\*\)::int n/.test(texto)) return { rows: [{ n: 0 }] };
    if (/AS deuda_sin_ficha/.test(texto)) return { rows: [{}] };   // la caja: una fila, todo a cero
    return { rows: [], rowCount: 0, params };
  };
  return {
    sql,
    consulta: async (t, p) => responde(t, p),
    transaccion: async fn => fn({ query: async (t, p) => responde(t, p) }),
  };
}

const MADRID = { sede: 'madrid', corte: { anio: 2026, mes: 8, quincena: 1 },
  tablas: { cierre: 'recaudacion_cierre', mov: 'recaudacion_movimiento' },
  ordenes: { tabla: 'bolt_order', filtro: '' }, soloCuentas: false };
const BARCELONA = { sede: 'barcelona', corte: { anio: 2026, mes: 11, quincena: 1 },
  tablas: { cierre: 'sede_recaudacion_cierre', mov: 'sede_recaudacion_movimiento' },
  ordenes: { tabla: 'sede_bolt_order', filtro: "AND o.sede = 'barcelona'" }, soloCuentas: true };

// Lo que se le pide a cada una: lo que hace la pantalla.
async function recorrer(repo, persona) {
  const q = repo.quincenaHoy();
  await repo.cuadro();
  await repo.cuadre();
  await repo.salidas();
  await repo.candidatos();
  await repo.ficha(persona);
  await repo.efectivoBolt(q);
  await repo.calcularDesdeBolt(q, {});
  await repo.anotar({ conductorId: persona, tipo: 'presencial', importe: '1', fecha: '2026-11-04' });
  await repo.anotar({ tipo: 'salida_banco', importe: '1', fecha: '2026-11-04', observacion: 'banco' });
  await repo.anular(1, { motivo: 'prueba' });
  await repo.ajustarCierre({ conductorId: persona, anio: q.anio, mes: q.mes, quincena: q.quincena, ajuste: '1', motivo: 'prueba' });
  await repo.comprobar();
}

(async () => {
  // ── Madrid ────────────────────────────────────────────────────────────────
  const bm = baseDeMentira();
  await recorrer(fabrica.crear({ ...MADRID, db: bm }), '12');
  const textoM = bm.sql.join('\n');
  ok('Madrid lee y escribe sus tablas', /\brecaudacion_cierre\b/.test(textoM) && /\brecaudacion_movimiento\b/.test(textoM));
  ok('Madrid nunca nombra las tablas de Barcelona', !/sede_recaudacion_/.test(textoM));
  ok('Madrid saca el efectivo de bolt_order', /FROM bolt_order o/.test(textoM) && !/sede_bolt_order/.test(textoM));

  // ── Barcelona ─────────────────────────────────────────────────────────────
  const bb = baseDeMentira();
  await recorrer(fabrica.crear({ ...BARCELONA, db: bb }), 'u-1');
  const textoB = bb.sql.join('\n');
  ok('Barcelona lee y escribe sus tablas', /sede_recaudacion_cierre/.test(textoB) && /sede_recaudacion_movimiento/.test(textoB));
  // \b no separa «sede_» de «recaudacion_»: así solo casa la tabla de Madrid.
  const deMadrid = textoB.split('\n').filter(l => /\brecaudacion_(cierre|movimiento)\b/.test(l));
  ok('Barcelona nunca nombra las tablas de Madrid', !deMadrid.length, deMadrid.slice(0, 3).join(' | '));
  ok('Barcelona saca el efectivo de sus pedidos, y solo de su sede',
    /FROM sede_bolt_order o/.test(textoB) && /o\.sede = 'barcelona'/.test(textoB) && !/\bbolt_order\b/.test(textoB));
  ok('Barcelona no lista la plantilla de Madrid en el cuadro ni en los candidatos',
    !bb.sql.some(t => /FROM conductor c\b/.test(t) && /empleo_vigente|es_centinela/.test(t)));
  ok('Barcelona apunta a la persona por su cuenta de BOLT',
    bb.sql.some(t => /INSERT INTO sede_recaudacion_movimiento \(bolt_uuid,/.test(t)));
  ok('…y el ajuste también',
    bb.sql.some(t => /INSERT INTO sede_recaudacion_cierre \(bolt_uuid,/.test(t) && /ON CONFLICT \(bolt_uuid/.test(t)));
  ok('…comprobando que la cuenta es de la empresa de su sede',
    bb.sql.some(t => /f\.sede = 'barcelona'/.test(t) && /externo_id = \$1/.test(t)));

  // ── Lo que en Barcelona no existe ────────────────────────────────────────
  const rb = fabrica.crear({ ...BARCELONA, db: baseDeMentira() });
  let msg = '';
  try { await rb.importarCierre({ anio: 2026, mes: 10, quincena: 2, texto: 'x 1' }); } catch (e) { msg = e.message; }
  ok('En Barcelona no se pega un cierre a mano (no hay histórico)', /no hay histórico/.test(msg), msg);
  msg = '';
  try { await rb.guardarCierre({ conductorId: 'u-1', anio: 2026, mes: 10, quincena: 2, importe: '1' }); } catch (e) { msg = e.message; }
  ok('…ni se teclea un cierre', /no hay histórico/.test(msg), msg);
  msg = '';
  try { fabrica.crear({ ...BARCELONA, sede: "barcelona' OR 1=1 --" }); } catch (e) { msg = e.message; }
  ok('Una sede que no es una palabra no entra en el SQL', /sede no válida/.test(msg), msg);

  // ── Lo de siempre ────────────────────────────────────────────────────────
  ok('El módulo sigue exportando el Madrid de siempre', fabrica.CORTE.mes === 8 && typeof fabrica.cuadro === 'function' && typeof fabrica.crear === 'function');

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
