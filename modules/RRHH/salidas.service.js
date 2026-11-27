// ============================================================
// LAS TAREAS AL IRSE ALGUIEN (ítem 8 de la hoja de ruta, 27/11/2026)
// ============================================================
// El documento: «tareas al cerrar una baja o un despido». El finiquito ya nace
// solo al dar la baja (db/291). Lo que decidió Camilo el 27/11/2026:
//
//   · QUÉ NACE, cada una a quien tenga su función en Organización:
//       - Desactivarle en BOLT (la API de BOLT es de solo lectura: es a mano).
//         Según por qué se va: «Desactiva al que se va: baja voluntaria o
//         periodo de prueba», «… suspensión o despido» o «… fin de contrato de
//         ETT». SE CIERRA SOLA cuando BOLT ya no le da ninguna cuenta activa.
//         Solo nace si tiene alguna activa.
//       - Recoger lo que tenía (llaves, tarjeta de combustible, uniforme…):
//         «Anula credenciales y PIN de combustible». A mano.
//       - Sacarle del coche y del cuadrante, si sigue con el coche vinculado o
//         con turnos después de su baja: «Coche de sustitución y cambio de
//         cuadrante». SE CIERRA SOLA cuando ya no hay nada.
//       - Confirmar la baja en la gestoría, con su justificante, como las altas
//         (módulo 8): «Sube el listado de plantilla de la gestoría». Solo la
//         plantilla propia (la ETT no está en la gestoría). A mano.
//   · CUÁNDO: el día EFECTIVO de la baja. Una baja programada no reparte nada
//     hasta que se aplica; una de hoy o de antes, en la vuelta siguiente.
//
// Una vuelta cada hora: reparte las de las bajas nuevas y cierra las que ya
// están hechas. Desde el 27/11/2026: las bajas de antes no se reparten.
'use strict';

const db = require('../../services/db');
const tablero = require('../../services/tablero');
const organizacion = require('../../services/organizacion');
const calendario = require('../../services/calendario');
const tareasProgramadas = require('../../services/tareasProgramadas');
const libro = require('../../services/libro');
const pruebas = require('../../services/repo/fichaDePruebas');

const DESDE = '2026-11-27';
const CAUSAS = {
  voluntaria: 'baja voluntaria', prueba: 'no supera el periodo de prueba', no_incorpora: 'no se incorpora',
  despido_disciplinario: 'despido disciplinario', despido_objetivo: 'despido objetivo', fin_contrato: 'fin de contrato', otra: 'otra causa',
};
const TIPOS = {
  salida_bolt: { etiqueta: 'Desactivar en BOLT a quien se va', cierreManual: false },
  salida_material: { etiqueta: 'Recoger lo que tenía quien se va' },
  salida_coche: { etiqueta: 'Sacar del coche y del cuadrante a quien se va', cierreManual: false },
  salida_gestoria: { etiqueta: 'Confirmar la baja en la gestoría' },
};
Object.entries(TIPOS).forEach(([t, d]) => tablero.registrarTipo(t, { ...d, abrir: 'Abrir su ficha' }));

const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** La función que desactiva según por qué se va. */
function funcionBolt(s) {
  if (s.tipo === 'ett') return 'desactiva_fin_ett';
  if (/^despido/.test(s.causa || '')) return 'desactiva_suspension_despido';
  return 'desactiva_baja_voluntaria';
}

const titular = async codigo => ((await organizacion.quienes(codigo, { conSuplentes: false }).catch(() => []))[0] || {}).id || null;

/**
 * Las salidas: personas que ya no están de alta cuyo último contrato acabó
 * en los últimos 30 días (y no antes de DESDE): pasado un mes, lo que quede
 * abierto se lleva a mano en el tablero. Un paso de la ETT a la propia no es una salida: sigue de alta.
 */
async function salidas(cli, hoy) {
  const r = await cli.query(
    `SELECT c.id::text AS conductor_id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre,
            e.tipo, e.causa_baja AS causa, to_char(e.baja, 'YYYY-MM-DD') AS baja
       FROM conductor c
       JOIN LATERAL (SELECT tipo, causa_baja, baja FROM conductor_periodo_empleo pe
                      WHERE pe.conductor_id = c.id ORDER BY pe.alta DESC, pe.id DESC LIMIT 1) e ON TRUE
      WHERE NOT c.es_centinela${await pruebas.fuera('c')} AND NOT c.empleo_vigente
        AND e.baja IS NOT NULL AND e.baja >= GREATEST($1::date, $2::date - 30) AND e.baja <= $2::date
      ORDER BY e.baja, c.id`, [DESDE, hoy]);
  return r.rows;
}

/** Quién tiene aún alguna cuenta de BOLT activa. → Set(conductorId) */
async function conBoltActivo(cli, ids) {
  if (!ids.length) return new Set();
  const r = await cli.query(
    `SELECT DISTINCT conductor_id::text AS id FROM conductor_externo
      WHERE sistema = 'bolt' AND estado_externo = 'active' AND conductor_id = ANY($1::bigint[])`, [ids]);
  return new Set(r.rows.map(x => x.id));
}

/** Quién sigue con el coche vinculado o con turnos en el cuadrante de hoy en adelante. → Set(conductorId) */
async function conCocheOTurnos(cli, ids, hoy) {
  if (!ids.length) return new Set();
  const out = new Set();
  const v = await cli.query(
    `SELECT DISTINCT conductor_id::text AS id FROM fichaje_turno WHERE fin IS NULL AND conductor_id = ANY($1::bigint[])`, [ids]);
  v.rows.forEach(x => out.add(x.id));
  const t = await cli.query(
    `SELECT DISTINCT f.conductor_id::text AS id FROM f_cobertura($2::date, $2::date + 14) f WHERE f.conductor_id = ANY($1::bigint[])`, [ids, hoy]);
  t.rows.forEach(x => out.add(x.id));
  return out;
}

/** LA VUELTA: reparte lo de las salidas nuevas y cierra lo que ya está hecho. */
async function revisar({ cli = null, hoy = calendario.hoy() } = {}) {
  const hacer = async c => {
    const lista = await salidas(c, hoy);
    if (!lista.length) return { salidas: 0, nacidas: 0, cerradas: 0 };
    const ids = lista.map(s => s.conductor_id);
    const [bolt, coche] = await Promise.all([conBoltActivo(c, ids), conCocheOTurnos(c, ids, hoy)]);
    const resp = {};
    for (const f of ['desactiva_fin_ett', 'desactiva_suspension_despido', 'desactiva_baja_voluntaria', 'credenciales_combustible', 'sustituciones', 'plantilla_gestoria']) {
      resp[f] = await titular(f);
    }
    await libro.firmar(c, { origen: 'salidas', accion: 'alta' });
    let nacidas = 0, cerradas = 0;
    for (const s of lista) {
      const origen = `${s.conductor_id}|${s.baja}`;
      const quien = `${s.nombre} (baja el ${dmy(s.baja)}, ${CAUSAS[s.causa] || 'sin causa'})`;
      const enlace = `/plantilla#${encodeURIComponent(s.conductor_id)}`;
      const nacer = async (tipo, funcion, titulo, descripcion, plazoDias) => {
        const r = await tablero.nacer(c, { tipo, origenId: origen, enlace, titulo, descripcion, responsableId: resp[funcion], plazoDias });
        if (r.nueva) nacidas++;
      };
      // BOLT: solo si aún tiene una cuenta activa; se cierra sola cuando deja de tenerla.
      if (bolt.has(s.conductor_id)) {
        await nacer('salida_bolt', funcionBolt(s), `Desactivar en BOLT: ${quien}`,
          'Su cuenta de BOLT sigue activa. Desactívala en el panel de flota de BOLT: la tarjeta se cierra sola cuando BOLT la dé por desactivada (se mira cada hora).', 0);
      } else if (await tablero.cerrarPorOrigen(c, { tipo: 'salida_bolt', origenId: origen, nota: 'BOLT ya no le da ninguna cuenta activa' })) cerradas++;
      await nacer('salida_material', 'credenciales_combustible', `Recoger lo que tenía: ${quien}`,
        'Recoge las llaves, la tarjeta de combustible, el uniforme y lo que tuviera asignado, y anula sus credenciales. Ciérrala cuando esté todo.', 1);
      if (coche.has(s.conductor_id)) {
        await nacer('salida_coche', 'sustituciones', `Sacar del coche y del cuadrante: ${quien}`,
          'Sigue con el coche vinculado o con turnos en el planificador después de su baja. Desvincula el coche y quítale los turnos: la tarjeta se cierra sola cuando ya no tenga nada.', 0);
      } else if (await tablero.cerrarPorOrigen(c, { tipo: 'salida_coche', origenId: origen, nota: 'Ya no tiene coche vinculado ni turnos' })) cerradas++;
      if (s.tipo === 'propia') {
        await nacer('salida_gestoria', 'plantilla_gestoria', `Confirmar la baja en la gestoría: ${quien}`,
          'Comprueba que la gestoría ha tramitado su baja en la Seguridad Social y adjunta aquí el justificante. Si sigue en su listado, saldrá también en Gestoría.', 2);
      }
    }
    return { salidas: lista.length, nacidas, cerradas };
  };
  return cli ? hacer(cli) : db.transaccion(hacer);
}

tareasProgramadas.registrar({
  clave: 'rrhh.salidas',
  descripcion: 'Cada hora: las tareas de quien se va (desactivar en BOLT, recoger lo que tenía, sacarle del coche y del cuadrante, la baja en la gestoría) y cerrar las que ya están hechas',
  desde: DESDE,
  toca: ahora => {
    const { fecha, min } = calendario.partesMadrid(ahora);
    return `${fecha}T${String(Math.floor(min / 60)).padStart(2, '0')}`;
  },
  hacer: ({ cli }) => revisar({ cli }),
});

module.exports = { revisar, salidas, funcionBolt, TIPOS, DESDE };
