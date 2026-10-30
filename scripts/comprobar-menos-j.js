// ============================================================
// LA −J Y LA AUDITORÍA DE LAS J — comprobación de punta a punta
// (30/10/2026, db/227 y db/228)
// ============================================================
// Camilo: «Alex no le da el coche temprano a Carlos, Carlos sale tarde por
// culpa de Alex: le dejamos una −J a Alex por perjuicio a la empresa». Es
// constancia: nace pendiente, se aprueba o se rechaza en /justificantes y no
// toca horas, nómina ni letra.
//
// Lo comprueba con DOS PERSONAS DE VERDAD de la copia local (las dos primeras
// con contrato abierto) y una J inventada, sobre la base del entorno de
// pruebas, con el SQL de verdad. Todo dentro de una transacción que se deshace
// al acabar: la copia queda como estaba. Los casos:
//   · lo que se rechaza al ponerla (sin motivo, a sí mismo, casuística rara,
//     tiempo imposible) y lo que guarda (minutos, casuística, origen);
//   · la cola de /justificantes: la pestaña −J, su contador, aprobar, rechazar;
//   · la −J que nace de una J «Por compañero» y que esa J ya no la ofrece;
//   · la Bitácora: la −J sale en su rejilla en cuanto se pone (la caché se tira)
//     y sus horas NO cambian;
//   · LA AUDITORÍA (db/228, «bien auditadas en todo el flujo»): cada paso de
//     una J y de una −J deja su fila en el libro con quién, desde dónde y qué
//     cambió; editar no borra a quien la puso; editar una aprobada la devuelve
//     a pendiente; anular pide el porqué; un cambio a mano sin firmar también
//     se apunta; y el libro no se deja cambiar ni borrar.
//
//   node scripts/comprobar-menos-j.js
//
// HACE FALTA EL ENTORNO LOCAL (Docker telecab-pg en 127.0.0.1:5433). La
// dirección va escrita aquí: no puede apuntar a producción. Además exige la
// marca `entorno_local` que pone refrescar.js.
process.env.MODO_PRUEBAS = '1';

const path = require('path');
const { Client } = require('pg');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';

const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
async function falla(nombre, fn, trozo) {
  try { await fn(); igual(nombre, 'no falló', 'falla con «' + trozo + '»'); }
  catch (e) { igual(nombre, e.message.includes(trozo), true); }
}

(async () => {
  const cli = new Client({ connectionString: LOCAL });
  try {
    await cli.connect();
    await cli.query('SELECT 1 FROM entorno_local LIMIT 1');
  } catch (e) {
    console.log(`No hay entorno local (${e.message}).\nArráncalo antes: node scripts/entorno-local/arrancar.js (o refrescar.js si no hay copia).`);
    process.exit(1);
  }

  await cli.query('BEGIN');
  try {
    const consulta = (sql, p) => cli.query(sql, p);
    sustituir('services/db', { consulta, transaccion: async fn => fn(cli), HAY_BD: true });
    const menosJ = require('../services/repo/menosJ');
    const justificantes = require('../modules/Control/justificantes.service');
    const repoJust = require('../services/repo/justificantes');

    const dos = (await consulta(
      `SELECT c.id FROM conductor c
        WHERE EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = c.id
                         AND p.alta <= CURRENT_DATE AND (p.baja IS NULL OR p.baja >= CURRENT_DATE))
        ORDER BY c.id LIMIT 2`)).rows.map(x => String(x.id));
    if (dos.length < 2) throw new Error('la copia no tiene dos personas con contrato abierto');
    const [ALEX, CARLOS] = dos;
    const DIA = '2026-10-29';
    const usuario = (await consulta('SELECT id FROM usuario ORDER BY id LIMIT 1')).rows[0].id;
    // Para mirar SOLO lo de esta prueba: la copia puede traer −J de verdad.
    const yaHabia = Number((await consulta('SELECT count(*)::int n FROM menos_j')).rows[0].n);

    // ── 1. Poner ─────────────────────────────────────────────────────────────
    console.log('\nPoner una −J (menosJ.poner)');
    await falla('sin motivo, no', () => menosJ.poner({ conductorId: ALEX, dia: DIA, motivo: '  ' }), 'motivo es obligatorio');
    await falla('el perjudicado no puede ser él mismo', () =>
      menosJ.poner({ conductorId: ALEX, dia: DIA, motivo: 'x', companeroId: ALEX }), 'misma persona');
    await falla('una casuística que no existe, no', () =>
      menosJ.poner({ conductorId: ALEX, dia: DIA, motivo: 'x', casuistica: 'otra' }), 'no existe');
    await falla('más de 24 h, no', () => menosJ.poner({ conductorId: ALEX, dia: DIA, motivo: 'x', horas: '30' }), '0 a 24');
    await falla('sin día, no', () => menosJ.poner({ conductorId: ALEX, motivo: 'x' }), 'Falta el día');

    const a = await menosJ.poner({ conductorId: ALEX, dia: DIA, motivo: 'No le dio el coche a Carlos a tiempo',
      companeroId: { valor: CARLOS }, horas: '1.5', origen: 'control', usuarioId: usuario });
    const filaA = (await consulta('SELECT casuistica, minutos, companero_id::text c, origen, aprobado_at, anulado_at FROM menos_j WHERE id = $1', [a.id])).rows[0];
    igual('guarda 90 min, la casuística por defecto, el perjudicado (aunque llegue como objeto) y el origen',
      [filaA.casuistica, filaA.minutos, filaA.c, filaA.origen], ['perjuicio_empresa', 90, CARLOS, 'control']);
    igual('nace pendiente', [filaA.aprobado_at, filaA.anulado_at], [null, null]);
    const b = await menosJ.poner({ conductorId: ALEX, dia: DIA, motivo: 'Dejó el coche sin gasolina', origen: 'raro' });
    igual('sin compañero ni tiempo también vale, y un origen raro cae en «bitacora»',
      (await consulta('SELECT companero_id, minutos, origen FROM menos_j WHERE id = $1', [b.id])).rows[0],
      { companero_id: null, minutos: null, origen: 'bitacora' });

    // ── 2. La cola de /justificantes ──────────────────────────────────────────
    console.log('\nLa pestaña −J de /justificantes');
    let cola = await justificantes.cola({ tipo: 'menos_j', estado: 'pendiente' });
    const mias = f => f.filter(x => [a.id, b.id].includes(x.id));
    igual('salen las dos pendientes, con su perjudicado y su tiempo',
      mias(cola.filas).map(x => [x.estado, x.companeroId, x.minutos, x.etiqueta]),
      [['pendiente', CARLOS, 90, 'Perjuicios a la empresa'], ['pendiente', null, null, 'Perjuicios a la empresa']]);
    igual('el contador de la pestaña las cuenta', cola.pendientes.menos_j >= 2, true);
    igual('y las cuentas, con los minutos pendientes', cola.menosJ === true && cola.cuentas.minutosPendientes >= 90, true);

    await justificantes.aprobarMenosJ(a.id, usuario);
    await falla('aprobarla dos veces, no', () => justificantes.aprobarMenosJ(a.id, usuario), 'no está pendiente');
    await falla('rechazar sin motivo, no', () => justificantes.rechazarMenosJ(b.id, usuario, ''), 'obligatorio');
    await justificantes.rechazarMenosJ(b.id, usuario, 'El coche ya estaba sin gasolina');
    cola = await justificantes.cola({ tipo: 'menos_j', estado: 'aprobada' });
    igual('la aprobada sale en Aprobadas', mias(cola.filas).map(x => x.id), [a.id]);
    cola = await justificantes.cola({ tipo: 'menos_j', estado: 'rechazada' });
    igual('la rechazada, en Rechazadas y con su motivo', mias(cola.filas).map(x => [x.id, x.anuladoMotivo]),
      [[b.id, 'El coche ya estaba sin gasolina']]);
    await falla('una rechazada no se aprueba', () => justificantes.aprobarMenosJ(b.id, usuario), 'no está pendiente');

    // ── 3. Desde la J «Por compañero» del perjudicado ─────────────────────────
    console.log('\nDesde la J «Por compañero» de Carlos');
    const j = await repoJust.guardarPorId({ conductorId: CARLOS, diaIso: '2026-10-28', horas: '1.5',
      observacion: 'Alex no le dio el coche a tiempo', tipo: 'companero', usuarioId: usuario });
    cola = await justificantes.cola({ tipo: 'companero', estado: 'pendiente' });
    igual('su J sale ofreciendo la −J (todavía no la tiene)',
      (cola.filas.find(x => x.id === String(j.justificanteId)) || {}).conMenosJ, false);
    const c = await justificantes.ponerMenosJ({ conductorId: ALEX, dia: '2026-10-28', motivo: 'Alex no le dio el coche a tiempo',
      companeroId: CARLOS, horas: '1.5', justificanteId: j.justificanteId }, usuario);
    igual('la −J queda enlazada a la J y con origen «justificante»',
      (await consulta('SELECT justificante_id::text j, origen FROM menos_j WHERE id = $1', [c.id])).rows[0],
      { j: String(j.justificanteId), origen: 'justificante' });
    cola = await justificantes.cola({ tipo: 'companero', estado: 'pendiente' });
    igual('y la J ya no la vuelve a ofrecer', (cola.filas.find(x => x.id === String(j.justificanteId)) || {}).conMenosJ, true);
    igual('«Todas» no cuenta las −J: siguen en su pestaña', typeof cola.pendientes.menos_j, 'number');

    // ── 4. Lo que la base no deja ─────────────────────────────────────────────
    console.log('\nLo que la base no deja (CHECK)');
    for (const [nombre, sql, ck] of [
      ['0 minutos', `INSERT INTO menos_j (conductor_id, dia_operativo, motivo, minutos) VALUES (${ALEX}, '${DIA}', 'x', 0)`, 'ck_menosj_minutos'],
      ['motivo en blanco', `INSERT INTO menos_j (conductor_id, dia_operativo, motivo) VALUES (${ALEX}, '${DIA}', '  ')`, 'ck_menosj_motivo'],
      ['rechazada sin motivo', `UPDATE menos_j SET anulado_at = now() WHERE id = ${a.id}`, 'ck_menosj_rechazo'],
    ]) {
      await cli.query('SAVEPOINT ck');
      try { await cli.query(sql); igual(nombre, 'entró', ck); }
      catch (e) { igual(nombre, (e.constraint || e.message), ck); }
      await cli.query('ROLLBACK TO SAVEPOINT ck');
    }

    // ── 5. La Bitácora ────────────────────────────────────────────────────────
    console.log('\nLa Bitácora');
    const bitacora = require('../modules/Operaciones/bitacora.service');
    const antes = await bitacora.datos();
    const horasDe = d => { const x = d.conductores.find(k => String(k.conductorId) === ALEX); return x ? JSON.stringify(x.dias) : null; };
    const delDia = (d, dia) => ((d.menosJ || {})[ALEX] || {})[dia] || [];
    igual('ya trae las −J de Alex del 29/10 (aprobada y rechazada)', delDia(antes, DIA).map(x => x.estado).sort(), ['aprobada', 'rechazada']);
    const d = await menosJ.poner({ conductorId: ALEX, dia: '2026-10-27', motivo: 'Llegó tarde al relevo', usuarioId: usuario });
    const despues = await bitacora.datos();
    igual('una −J nueva sale al momento (la caché se tira)', delDia(despues, '2026-10-27').map(x => x.id), [d.id]);
    igual('y sus días no cambian: la −J no toca horas', horasDe(despues), horasDe(antes));

    igual('al acabar, solo hay las −J de esta prueba de más',
      Number((await consulta('SELECT count(*)::int n FROM menos_j')).rows[0].n) - yaHabia, 4);

    // ── 6. La auditoría (db/228) ──────────────────────────────────────────────
    console.log('\nLa auditoría de las −J y las J (db/228)');
    const auditoriaJ = require('../services/repo/auditoriaJ');
    const usuarios = (await consulta('SELECT id FROM usuario ORDER BY id LIMIT 2')).rows.map(x => x.id);
    const [U1, U2] = usuarios.length > 1 ? usuarios : [usuarios[0], usuarios[0]];
    const libro = async (entidad, id) => (await consulta(
      `SELECT accion, usuario_id, origen, cambios FROM justificante_auditoria
        WHERE entidad = $1 AND registro_id = $2 ORDER BY id`, [entidad, Number(id)])).rows;

    igual('−J puesta desde Control y aprobada: dos filas, con quién y desde dónde',
      (await libro('menos_j', a.id)).map(x => [x.accion, x.usuario_id, x.origen]),
      [['poner', usuario, 'control'], ['aprobar', usuario, 'justificantes']]);
    const lb = await libro('menos_j', b.id);
    igual('la rechazada, con su motivo en lo que cambió',
      [lb.map(x => x.accion), (lb[1].cambios.anulado_motivo || [])[1]],
      [['poner', 'rechazar'], 'El coche ya estaba sin gasolina']);
    igual('la que nace de una J, firmada desde Justificantes', (await libro('menos_j', c.id)).map(x => x.origen), ['justificantes']);

    // Una J: la pone U1 desde la Bitácora, se aprueba, y U2 la edita.
    const J2 = await repoJust.guardarPorId({ conductorId: ALEX, diaIso: '2026-10-26', horas: '2', observacion: 'Taller',
      tipo: 'taller', usuarioId: U1, origen: 'bitacora' });
    await repoJust.aprobar(J2.justificanteId, { usuarioId: U1 });
    const ed = await repoJust.guardarPorId({ conductorId: ALEX, diaIso: '2026-10-26', horas: '5', observacion: 'Taller',
      tipo: 'taller', usuarioId: U2, origen: 'control' });
    const filaJ = (await consulta('SELECT usuario_id, aprobado_at FROM justificante WHERE id = $1', [J2.justificanteId])).rows[0];
    igual('editar una J APROBADA la devuelve a pendiente, y se avisa', [ed.volvioAPendiente, filaJ.aprobado_at], [true, null]);
    igual('editarla no borra a quien la puso', filaJ.usuario_id, U1);
    let lj = await libro('j', J2.justificanteId);
    igual('en el libro: puesta, aprobada y editada, cada una con su quién y su pantalla',
      lj.map(x => [x.accion, x.usuario_id, x.origen]),
      [['poner', U1, 'bitacora'], ['aprobar', U1, 'justificantes'], ['editar', U2, 'control']]);
    igual('…y la edición guarda el antes y el después de las horas y de la aprobación',
      [lj[2].cambios.horas_seg_momento, lj[2].cambios.aprobado_at && lj[2].cambios.aprobado_at[1]], [[7200, 18000], null]);
    await repoJust.guardarPorId({ conductorId: ALEX, diaIso: '2026-10-26', horas: '5', observacion: 'Taller',
      tipo: 'taller', usuarioId: U2, origen: 'control' });
    igual('guardarla igual otra vez no apunta nada (nada cambió)', (await libro('j', J2.justificanteId)).length, 3);

    await falla('anular sin decir por qué, no', () =>
      repoJust.anularPorId({ conductorId: ALEX, diaIso: '2026-10-26', usuarioId: U2, origen: 'bitacora' }), 'por qué se anula');
    await repoJust.anularPorId({ conductorId: ALEX, diaIso: '2026-10-26', usuarioId: U2, motivo: 'Puesta por error', origen: 'bitacora' });
    lj = await libro('j', J2.justificanteId);
    igual('anularla: con quién, desde dónde y por qué',
      [lj[3].accion, lj[3].usuario_id, lj[3].origen, (lj[3].cambios.anulado_motivo || [])[1]],
      ['anular', U2, 'bitacora', 'Puesta por error']);

    // Un cambio a mano, sin firmar: se apunta igual. La firma vale lo que dura su
    // transacción; aquí todo va en UNA (para deshacerla al final), así que se
    // borra a mano, que es lo que pasa al empezar otra.
    await auditoriaJ.firmar(cli, {});
    await consulta(`UPDATE justificante SET observacion = 'Cambiada a mano' WHERE id = $1`, [J2.justificanteId]);
    lj = await libro('j', J2.justificanteId);
    igual('un cambio a mano sin firmar también deja su fila (sin usuario, «sin decir»)',
      [lj[4].accion, lj[4].usuario_id, /sin decir/.test(lj[4].origen)], ['editar', null, true]);

    const h = await auditoriaJ.historial('j', J2.justificanteId);
    igual('el historial que ve la pantalla, en orden y con su nombre',
      h.map(x => x.etiqueta), ['Puesta', 'Aprobada', 'Editada', 'Anulada', 'Editada']);
    igual('…con lo que cambió en cristiano', h[2].cambios.find(x => x.clave === 'horas_seg_momento').campo, 'Horas');

    for (const [nombre, sql] of [
      ['el libro no se deja cambiar', `UPDATE justificante_auditoria SET accion = 'poner' WHERE registro_id = ${J2.justificanteId}`],
      ['ni borrar', `DELETE FROM justificante_auditoria WHERE registro_id = ${J2.justificanteId}`],
    ]) {
      await cli.query('SAVEPOINT lib');
      try { await cli.query(sql); igual(nombre, 'se dejó', 'no se deja'); }
      catch (e) { igual(nombre, /no se cambia ni se borra/.test(e.message), true); }
      await cli.query('ROLLBACK TO SAVEPOINT lib');
    }
  } catch (e) {
    fallos++;
    console.log('FALLA ' + (e.stack || e.message));
  } finally {
    await cli.query('ROLLBACK').catch(() => {});
    await cli.end().catch(() => {});
  }

  console.log(fallos ? `\n${fallos} fallo(s).` : '\nTodo bien. La copia local queda como estaba.');
  process.exit(fallos ? 1 : 0);
})();
