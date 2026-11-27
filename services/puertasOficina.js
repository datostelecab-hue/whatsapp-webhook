// ============================================================
// PUERTAS DESDE EL ERP — la oficina abre y cierra un coche (27/11/2026)
// ============================================================
// Camilo: «hazme el botón de puertas en el ERP». Hasta hoy la oficina solo podía
// abrir un coche desde el bot de WhatsApp (escribiendo la matrícula, con el
// permiso de puertas). Ahora también desde la ficha del coche en Vehículos.
//
//   · QUIÉN: igual que en el bot. El rol desarrollador o quien tenga la llave
//     '/puertas' dada a mano. El superadmin no por serlo: una puerta es física
//     y se da persona a persona (services/permisos.js).
//   · CÓMO: la misma orden que el bot y el portal (puertasBot.ejecutar: Mapon
//     directo, la fila por equipo, el doble toque) y apuntada igual en
//     `puerta_comando`, con «ERP · nombre» como quien la dio. Sin comprobar la
//     sede, como la oficina en el bot.
//   · Si alguien lleva ese coche vinculado, se dice (no se impide: muchas veces
//     es para abrírselo a él).
'use strict';

const db = require('./db');
const permisos = require('./permisos');
const puertas = require('./puertasBot');

const norm = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const error = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** ¿Puede abrir y cerrar coches desde el ERP? El desarrollador, o la llave '/puertas'. */
async function puede(usuario) {
  if (!usuario || !usuario.id) return false;
  if (usuario.rol === 'desarrollador') return true;
  try { return (await permisos.clavesDe(usuario.id)).has('/puertas'); } catch (_) { return false; }
}

/**
 * LA ORDEN: abrir (`abrir: true`) o cerrar un coche por su matrícula.
 * → { ok, titulo, texto, lleva }
 */
async function orden({ matricula, abrir } = {}, usuario = {}) {
  if (!await puede(usuario)) throw error('Abrir y cerrar coches es de quien tiene el permiso de puertas', 403);
  const m = norm(matricula);
  if (m.length < 5) throw error('Falta la matrícula');
  if (typeof abrir !== 'boolean') throw error('Di si se abre o se cierra');
  const v = (await db.consulta(
    `SELECT id, matricula FROM vehiculo WHERE matricula_norm = $1 AND baja_at IS NULL LIMIT 1`, [m])).rows[0];
  if (!v) throw error(`El ${m} no está en Vehículos (o está de baja)`, 404);
  // Quién lo lleva ahora mismo, para decirlo.
  const lleva = await require('./fichaje').abiertoDeCoche(v.matricula, null).catch(() => null);
  const nombre = [usuario.nombre, usuario.apellidos].filter(Boolean).join(' ').trim() || `Usuario ${usuario.id}`;
  const r = await puertas.ejecutar({
    telefono: `erp:${usuario.id}`, conductorId: null, nombre: `ERP · ${nombre}`.slice(0, 120),
    matricula: v.matricula, unitId: '', abrir, sede: null,
  });
  const que = abrir ? 'abrir' : 'cerrar';
  const quien = lleva ? ` Lo lleva vinculado ${lleva.nombre}.` : '';
  if (r.ok) {
    return { ok: true, lleva: lleva ? lleva.nombre : null, titulo: `Orden de ${que} enviada`,
      texto: `${v.matricula}: Mapon ha aceptado la orden (no confirma que el coche la haya hecho). Si en unos segundos no responde, vuelve a pulsar una vez.${quien}` };
  }
  return { ok: false, lleva: lleva ? lleva.nombre : null,
    titulo: r.motivo === 'sin-respuesta' ? 'Sin confirmación de Mapon' : `No se ha podido ${que}`,
    texto: `${v.matricula}: ${puertas.textoFallo(r, abrir)}${quien}` };
}

module.exports = { orden, puede };
