// ============================================================
// FÁBRICA — datos INVENTADOS para los tests
// ============================================================
// Cada función mete en la base de pruebas lo mínimo para que una fila valga y
// devuelve la fila. Nada de aquí es de nadie: nombres de «Prueba», correos en
// el dominio reservado .invalid (no pueden llegar a ningún buzón) y matrículas
// de la serie PRB, que no existe. Sin DNI, teléfono ni cuenta de BOLT salvo que
// el test los pida.
//
// Se usa a través de conBase (test/apoyo/base.js), que la crea con la consulta
// del test: todo lo que fabrica se deshace al acabar el test.
//
// Cuando un ítem necesite otra pieza (un ticket, una cita, una ausencia), se
// añade aquí con el mismo estilo: valores por defecto razonables y todo
// sobrescribible.
'use strict';

let serie = 0;
const siguiente = () => ++serie;

function crearFabrica(consulta) {
  // pg devuelve los BIGINT como texto: el id va como número, que es como se
  // compara en los tests (los ids de la base de pruebas son pequeños).
  const una = async (sql, params) => {
    const fila = (await consulta(sql, params)).rows[0];
    return fila && fila.id != null ? { ...fila, id: Number(fila.id) } : fila;
  };

  return {
    /** Un usuario del ERP. `rol` es el código (oficina, trafico, taller…). */
    async usuario({ rol = 'oficina', nombre, apellidos = 'De Prueba', email, estado = 'activo' } = {}) {
      const n = siguiente();
      return una(
        `INSERT INTO usuario (email, nombre, apellidos, rol_id, pass_hash, estado, debe_cambiar)
         VALUES ($1, $2, $3, (SELECT id FROM rol WHERE codigo = $4), 'sin-contrasena', $5, FALSE)
         RETURNING *`,
        [email || `prueba${n}@telecab.invalid`, nombre || `Usuario${n}`, apellidos, rol, estado]);
    },

    /**
     * Un conductor con su periodo de empleo abierto desde `alta`.
     * `tipo` 'propia' o 'ett'; la jornada por defecto es la de 40 h en 5 días.
     */
    async conductor({ nombre, apellidos = 'De Prueba', alta = '2026-01-01', baja = null,
                      tipo = 'propia', ettNombre = null, jornadaHoras = 40, jornadaDias = 5 } = {}) {
      const n = siguiente();
      const c = await una(
        `INSERT INTO conductor (nombre, apellidos) VALUES ($1, $2) RETURNING *`,
        [nombre || `Conductor${n}`, apellidos]);
      await consulta(
        `INSERT INTO conductor_periodo_empleo (conductor_id, alta, baja, tipo, ett_nombre, jornada_horas, jornada_dias)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.id, alta, baja, tipo, tipo === 'ett' ? (ettNombre || 'ETT de prueba') : null,
         jornadaHoras, jornadaHoras === 40 ? jornadaDias : null]);
      return una(`SELECT * FROM conductor WHERE id = $1`, [c.id]);
    },

    /**
     * Un coche de Madrid en el estado `estado` desde `desde`, con su fila de
     * historial (la regla de la casa: no se escribe el estado sin abrirla).
     */
    async vehiculo({ matricula, estado = 'O', desde = '2026-01-01', marcaModelo = 'Toyota Corolla', sede = 'madrid' } = {}) {
      const n = siguiente();
      const v = await una(
        `INSERT INTO vehiculo (matricula, estado_operativo, marca_modelo, sede)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [matricula || `${String(9000 + n).slice(-4)}PRB`, estado, marcaModelo, sede]);
      await consulta(
        `INSERT INTO vehiculo_estado_hist (vehiculo_id, estado_codigo, desde) VALUES ($1, $2, $3)`,
        [v.id, estado, desde]);
      return v;
    },
  };
}

module.exports = { crearFabrica };
