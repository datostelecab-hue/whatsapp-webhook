// ============================================================
// EL PASO DE LA ETT A PLANTILLA PROPIA — las fechas
// ============================================================
//   node scripts/comprobar-pasar-a-propia.js
//
// El 27/10/2026 NADIE podía pasar a plantilla propia: Sara Zamora (alta en la
// ETT el 14/07/2026) con el 14/10 o con el 27/10, el mismo «no puede ser
// anterior al alta en la ETT». El alta llegaba de la base como objeto Date y se
// comparaba como texto: «Tue Jul 14» va después de cualquier «2026-…». Ver
// services/repo/alta.js (convertirAPropia).
//
// No toca ninguna base. La de mentira hace lo que hace pg: un DATE a secas
// llega como objeto Date; uno pasado por to_char, como texto.
const path = require('path');
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

let escrito = [];
sustituir('services/db.js', {
  HAY_BD: true,
  consulta: async () => ({ rows: [] }),
  transaccion: async fn => fn({
    query: async (sql, params) => {
      if (/FROM conductor_periodo_empleo/.test(sql) && /SELECT/.test(sql)) {
        return { rows: [{
          id: 5, tipo: 'ett', ett_nombre: 'GiGroup',
          alta: /to_char\(alta/.test(sql) ? '2026-07-14' : new Date(2026, 6, 14),
          fecha_antiguedad: /to_char\(fecha_antiguedad/.test(sql) ? null : null,
        }] };
      }
      escrito.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/INSERT INTO conductor_periodo_empleo/.test(sql)) return { rows: [{ id: 99 }] };
      return { rows: [] };
    },
  }),
});

const alta = require('../services/repo/alta');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const nada = { faltaPara: async () => [] };
async function pasar(desde, extra = nada) {
  escrito = [];
  try { return { ok: await alta.convertirAPropia(1, { desde, jornadaHoras: 40 }, { usuarioId: 7 }, extra) }; }
  catch (e) { return { error: e.message }; }
}

(async () => {
  // ── Lo de Sara: alta en la ETT el 14/07/2026 ─────────────────────────────
  const r = await pasar('2026-10-14');
  igual('Tres meses después de su alta en la ETT, pasa', r.error, undefined);
  igual('…y conserva la antigüedad de la ETT, como fecha', r.ok && r.ok.antiguedad, '2026-07-14');
  const cierre = escrito.find(e => /UPDATE conductor_periodo_empleo/.test(e.sql));
  igual('El periodo de la ETT se cierra el día antes (lo hace la base con el 14/10)', cierre && cierre.params.slice(0, 1), ['2026-10-14']);
  const nuevo = escrito.find(e => /INSERT INTO conductor_periodo_empleo/.test(e.sql));
  igual('El contrato propio empieza el 14/10 con la antigüedad del 14/07', nuevo && nuevo.params.slice(1, 3), ['2026-10-14', '2026-07-14']);
  const aud = escrito.find(e => /INSERT INTO cambio_campo/.test(e.sql));
  igual('El historial dice las fechas, no un «GMT+0200»',
    !!aud && /desde 2026-07-14/.test(JSON.stringify(aud.params)) && !/GMT/.test(JSON.stringify(aud.params)), true);

  igual('El 27/10 también', (await pasar('2026-10-27')).error, undefined);

  // ── Lo que sí tiene que frenar ───────────────────────────────────────────
  igual('El mismo día del alta en la ETT, no (los dos periodos se pisarían)',
    (await pasar('2026-07-14')).error, 'El paso a plantilla propia tiene que ser después del alta en la ETT (14/07/2026)');
  igual('Antes del alta en la ETT, tampoco', /después del alta en la ETT/.test((await pasar('2026-06-01')).error || ''), true);
  igual('…y no se escribe nada', escrito.length, 0);
  igual('Una fecha con barras (sin pasar por el formulario) se rechaza', /AAAA-MM-DD/.test((await pasar('14/10/2026')).error || ''), true);
  igual('Sin el expediente completo, no pasa',
    /falta: Contrato firmado/.test((await pasar('2026-10-14', { faltaPara: async () => ['Contrato firmado'] })).error || ''), true);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
