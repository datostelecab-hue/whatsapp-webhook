// ============================================================
// LA CANDIDATURA Y EL CONTRATO NO DICEN COSAS DISTINTAS
// ============================================================
// 13/10/2026: Aaron Borja entró por InfoJobs con contrato propio, pero se le dio
// de alta con el «Alta rápida» de /ett (contrato de ETT). Alguien le corrigió
// después la candidatura a InfoJobs y TIBUS, y el contrato de la ficha siguió
// diciendo ETT GiGroup. Ahora, si una edición de la candidatura cambia el tipo
// de contrato y la ficha tiene abierto otro, se pregunta y, si fue un error de
// alta, se corrige también el contrato (candidaturas.service.contratoCoherente).
//
//   node scripts/comprobar-contrato-candidatura.js
//
// No toca la base: la candidatura y el contrato se sustituyen en memoria.

const conductores = require('../modules/Conductores/conductores.service');
const repo = require('../modules/Seleccion/candidaturas.repo');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// ── Lo de fuera, en memoria ──────────────────────────────────────────────────
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const haceDias = n => new Date(Date.parse(hoy) - n * 86400000).toISOString().slice(0, 10);
let candidatura, contrato;
const hechos = [];
repo.conductorDe = async () => ({ conductor_id: 463 });
repo.pactado = async () => ({ ...candidatura });
repo.guardarProceso = async (id, d) => { hechos.push(['candidatura', d]); Object.assign(candidatura, d); };
repo.engancharVacante = async () => {};
conductores.actualizar = async () => {};
conductores.contratoAbierto = async () => (contrato ? { ...contrato } : null);
conductores.corregirTipoContrato = async (id, { tipo }) => { hechos.push(['contrato', tipo]); contrato.tipo = tipo; contrato.ettNombre = null; return true; };

const svc = require('../modules/Seleccion/candidaturas.service');
const quien = { usuarioId: 7 };
async function intenta(datos) {
  try { await svc.guardar(85, datos, quien); return 'guardado'; }
  catch (e) { return e.conflicto ? { conflicto: e.conflicto.nuevo, puedeCorregir: e.conflicto.puedeCorregir } : 'error: ' + e.message; }
}
const reinicia = (cand, con) => { candidatura = { ...cand }; contrato = con ? { ...con } : null; hechos.length = 0; };

(async () => {
  const AARON_CAND = { canal: 'bolsa_ett', tipo_contrato: 'ETT', jornada_horas: 40 };
  const ETT_HOY = { id: 456, tipo: 'ett', ettNombre: 'GiGroup', alta: hoy };

  // 1. Lo que pasó: se cambia a InfoJobs y TIBUS con el contrato de ETT abierto.
  reinicia(AARON_CAND, ETT_HOY);
  igual('El caso de Aaron: no se guarda en silencio, se pregunta', await intenta({ canal: 'infojobs', tipo_contrato: 'TIBUS' }),
    { conflicto: 'propia', puedeCorregir: true });
  igual('…y no se ha escrito nada', hechos, []);
  igual('Con «corregir»: se corrige el contrato y se guarda la candidatura',
    [await intenta({ canal: 'infojobs', tipo_contrato: 'TIBUS', corregirContrato: true }), hechos.map(h => h[0])],
    ['guardado', ['contrato', 'candidatura']]);
  igual('…a plantilla propia', contrato.tipo, 'propia');

  // 2. Un contrato viejo no es un error de alta: se manda a «Pasar a propia».
  reinicia(AARON_CAND, { ...ETT_HOY, alta: haceDias(45) });
  igual('Contrato de hace 45 días: no se ofrece corregir', await intenta({ tipo_contrato: 'TIBUS', canal: 'infojobs' }),
    { conflicto: 'propia', puedeCorregir: false });
  igual('…ni aunque se pida', [await intenta({ tipo_contrato: 'TIBUS', canal: 'infojobs', corregirContrato: true }), hechos],
    [{ conflicto: 'propia', puedeCorregir: false }, []]);

  // 3. Lo que NO debe preguntar.
  reinicia({ canal: 'bolsa_ett', tipo_contrato: 'ETT' }, { id: 1, tipo: 'propia', alta: haceDias(200) });
  igual('Quien ya pasó a propia y le cambian la candidatura a TIBUS: coincide, se guarda',
    await intenta({ tipo_contrato: 'TIBUS', canal: 'infojobs' }), 'guardado');
  reinicia({ canal: 'bolsa_ett', tipo_contrato: 'ETT' }, { id: 1, tipo: 'propia', alta: haceDias(200) });
  igual('…y si le tocan otra cosa (las notas), tampoco pregunta', await intenta({ notas: 'llamar el lunes' }), 'guardado');
  reinicia({ canal: 'bolsa_ett', tipo_contrato: 'ETT' }, ETT_HOY);
  igual('Un cambio que no cambia el tipo (ETT → «ETT GiGroup»): se guarda', await intenta({ tipo_contrato: 'ETT GiGroup' }), 'guardado');
  reinicia({ canal: 'infojobs', tipo_contrato: null }, null);
  igual('Sin contrato abierto (aún en selección): se guarda', await intenta({ tipo_contrato: 'ETT' }), 'guardado');

  // 4. Al revés también: alta con contrato propio de quien venía por la ETT.
  reinicia({ canal: 'infojobs', tipo_contrato: 'TIBUS' }, { id: 2, tipo: 'propia', alta: haceDias(2) });
  igual('Propia → ETT reciente: se pregunta igual', await intenta({ canal: 'bolsa_ett' }), { conflicto: 'ett', puedeCorregir: true });

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
