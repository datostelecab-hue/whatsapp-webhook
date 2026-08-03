// ============================================================
// LÍMITE DE INTENTOS — anti fuerza bruta (en memoria, sin dependencias)
// ============================================================
// Cuenta fallos por "clave" (se usa la IP y el email por separado) y, tras varios
// seguidos, bloquea un rato esa clave. Suficiente para un equipo interno; al
// reiniciar el proceso se olvida (aceptable). Si algún día hace falta que sobreviva
// reinicios o varios contenedores, se mueve a una hoja/DB.

const MAX_FALLOS = 8;                    // fallos seguidos antes de bloquear
const BLOQUEO_MS = 15 * 60 * 1000;       // cuánto dura el bloqueo
const VENTANA_MS = 15 * 60 * 1000;       // los fallos caducan si no se repiten en este rato

const registro = new Map();   // clave → { fallos, primero, hasta }

// Devuelve la entrada vigente o null si caducó (y la limpia).
function vigente(clave) {
  const e = registro.get(clave);
  if (!e) return null;
  const ahora = Date.now();
  if (e.hasta && ahora >= e.hasta) { registro.delete(clave); return null; }   // bloqueo cumplido
  if (!e.hasta && ahora - e.primero > VENTANA_MS) { registro.delete(clave); return null; } // ventana caducada
  return e;
}

/** Segundos que quedan de bloqueo (0 = no bloqueado). */
function segundosBloqueo(clave) {
  const e = vigente(clave);
  return (e && e.hasta) ? Math.ceil((e.hasta - Date.now()) / 1000) : 0;
}

/** Registra un fallo; al llegar al máximo, activa el bloqueo. */
function registrarFallo(clave) {
  const ahora = Date.now();
  const e = vigente(clave) || { fallos: 0, primero: ahora, hasta: 0 };
  e.fallos++;
  if (e.fallos >= MAX_FALLOS) e.hasta = ahora + BLOQUEO_MS;
  registro.set(clave, e);
}

/** Éxito → se olvida el historial de esa clave. */
function limpiar(clave) { registro.delete(clave); }

module.exports = { segundosBloqueo, registrarFallo, limpiar };
