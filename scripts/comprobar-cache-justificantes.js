// ============================================================
// LAS J Y LA CACHÉ DE LA BITÁCORA — las reglas
// ============================================================
// La bitácora guarda su rejilla tres minutos (bitacora.service.datos). Desde el
// 21/10/2026 cualquier cambio de una J la tira, se haga desde donde se haga: el
// repositorio de las J (services/repo/justificantes) avisa y la bitácora se
// apunta. Antes, una J aprobada en /justificantes seguía «pendiente» en la
// bitácora hasta tres minutos (la del 11/10 de Jorge Eduardo Rodríguez Lezcano).
//
//   node scripts/comprobar-cache-justificantes.js
//
// No toca ninguna base: la base y el repositorio de la bitácora se sustituyen.
const path = require('path');
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

// La base de mentira: contesta lo justo a cada escritura de una J. De la
// última J escrita se guardan los parámetros, para ver a qué área fue.
let ultimaJ = null;
let aprobarEncuentra = true;
const responde = sql => {
  if (/SET aprobado_at = now\(\)/.test(sql)) return { rows: aprobarEncuentra ? [{ id: 5 }] : [] };
  if (/SET cerrada_at = now\(\)/.test(sql) || /SET cerrada_at = NULL/.test(sql)) return { rows: [{ id: 9 }] };
  if (/INSERT INTO justificante/.test(sql)) return { rows: [{ id: 9 }] };
  if (/UPDATE justificante SET anulado_at/.test(sql)) return { rows: [{ id: 9, conductor_id: 1, dia_operativo: '2026-10-11' }] };
  return { rows: [] };
};
sustituir('services/db.js', {
  HAY_BD: true,
  consulta: async sql => responde(sql),
  transaccion: async fn => fn({ query: async (sql, params) => { if (/INSERT INTO justificante/.test(sql)) ultimaJ = params; return responde(sql); } }),
});
// La rejilla de la bitácora: se cuenta cuántas veces se lee de verdad.
let lecturas = 0;
sustituir('modules/Operaciones/bitacora.repo.js', { leerBitacora: async () => { lecturas++; return { lectura: lecturas }; } });

const J = require('../services/repo/justificantes');
const B = require('../modules/Operaciones/bitacora.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  await B.datos(); await B.datos();
  igual('Dos cargas seguidas leen una vez: la caché funciona', lecturas, 1);

  await J.aprobar(5, { usuarioId: 2 });
  await B.datos();
  igual('Aprobar en /justificantes tira la caché de la bitácora', lecturas, 2);

  aprobarEncuentra = false;
  try { await J.aprobar(5, {}); } catch (_) { /* tenía que fallar */ }
  await B.datos();
  igual('Una aprobación que no sale no la tira', lecturas, 2);
  aprobarEncuentra = true;

  const pasos = [
    ['Poner una J (también desde Control)', () => J.guardarPorId({ conductorId: 1, diaIso: '2026-10-11', horas: '3,5', observacion: 'FL', tipo: 'trafico', usuarioId: 2 })],
    ['Rechazarla', () => J.rechazar(9, { usuarioId: 2, motivo: 'No consta' })],
    // Anular pide el porqué desde el 30/10/2026 (db/228, la auditoría).
    ['Anularla', () => J.anularPorId({ conductorId: 1, diaIso: '2026-10-11', motivo: 'Puesta por error', usuarioId: 2 })],
    ['Darla por cerrada', () => J.cerrar(9, { usuarioId: 2, nota: 'Llamado' })],
    ['Reabrirla', () => J.reabrir(9, { usuarioId: 2 })],
  ];
  for (const [nombre, hacer] of pasos) {
    const antes = lecturas;
    await hacer();
    await B.datos();
    igual(`${nombre} tira la caché`, lecturas, antes + 1);
  }

  // Un aviso que falla no tumba la escritura: ya está hecha.
  J.avisarCambios(() => { throw new Error('se rompió quien escuchaba'); });
  const r = await J.aprobar(5, {});
  igual('Un aviso que falla no tumba la aprobación', r.ok, true);

  // ── A QUIÉN VA LA J DESDE LA BITÁCORA (26/10/2026) ──────────────────────────
  // El área es el tipo del justificante (db/73): decide quién la aprueba.
  const areaDe = async tipo => {
    ultimaJ = null;
    await B.justificar({ conductorId: 1, dia: '2026-10-20', horas: 2, observacion: 'ITV', tipo }, 7);
    return ultimaJ && ultimaJ[4];
  };
  igual('Desde la bitácora se ofrecen Tráfico, RRHH y Taller', B.DESTINOS, ['trafico', 'rrhh', 'taller']);
  igual('Mandada a RRHH, la J queda de RRHH', await areaDe('rrhh'), 'rrhh');
  igual('Mandada a Taller, de Taller', await areaDe('taller'), 'taller');
  igual('Mandada a Tráfico, de Tráfico', await areaDe('trafico'), 'trafico');
  igual('Sin elegir (una pantalla vieja en caché), a Tráfico como siempre', await areaDe(undefined), 'trafico');
  igual('Al editar una J de BOLT que vino de Control, sigue siendo de BOLT', await areaDe('bolt'), 'bolt');
  let error = null;
  try { await areaDe('contabilidad'); } catch (e) { error = e.message; }
  igual('Un área que no existe se rechaza, no se manda a Tráfico a escondidas', /Tráfico, RRHH o Taller/.test(error || ''), true);
  igual('…y no se escribe nada', ultimaJ, null);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
