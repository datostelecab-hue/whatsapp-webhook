// ============================================================
// LAS VACACIONES LAS APRUEBA UNA SOLA PERSONA
// ============================================================
// Camilo, 09/10/2026: «el departamento de Laura será el único que apruebe
// vacaciones; el resto puede verlas pero no aprobarlas. Laura Blanco será la
// única» (db/189, services/aprobarVacaciones.js).
//
// Aprobar es ponerlas en la ficha por cualquier camino. Esto prueba las siete
// puertas: en la Ticketera aplicar, cerrar y sacar de la bandeja un ticket de
// vacaciones; en Plantilla cambiar la situación a vacaciones, añadir un tramo y
// corregir o borrar uno. Con la llave pasan; sin ella no, ni siendo superadmin.
// Lo demás (bajas, permisos, volver al trabajo, poner un ticket «en curso»)
// sigue abierto para todos.
//
//   node scripts/comprobar-vacaciones.js
//
// No toca la base: los permisos, los repositorios y la consulta de quién tiene
// la llave se sustituyen.

const db = require('../services/db');
const permisos = require('../services/permisos');
const aprobarVac = require('../services/aprobarVacaciones');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const LAURA = 4, MERCEDES = 9, SUPER = 1;
async function intenta(fn) {
  try { await fn(); return 'pasa'; }
  catch (e) { return /solo las aprueba Laura Blanco/.test(e.message) ? 'bloqueada' : 'error: ' + e.message; }
}

// ── Lo de fuera, sustituido ─────────────────────────────────────────────────
permisos.clavesDe = async id => (id === LAURA ? new Set(['/vacaciones/aprobar', '/ticketera', '/plantilla'])
  : new Set(['/ticketera', '/plantilla']));
db.consulta = async (sql) => (/usuario_permiso/.test(sql) ? { rows: [{ nombre: 'Laura Blanco' }] } : { rows: [] });

const con = require('../modules/Conductores/conductores.repo');
const hechos = [];
con.cambiarSituacion = async (id, d) => { hechos.push(['situacion', d.estado]); return {}; };
con.anadirAusencia = async (id, d) => { hechos.push(['ausencia', d.estado]); return {}; };
con.editarAusencia = async () => { hechos.push(['editar']); return {}; };
con.borrarAusencia = async () => { hechos.push(['borrar']); return {}; };
const FILAS = { 10: 'vacaciones', 11: 'baja_medica' };
con.situacionDe = async (id, filaId) => FILAS[filaId] || null;

const tRepo = require('../modules/Ticketera/ticketera.repo');
const TICKETS = {
  1: { id: 1, codigo: 'RRHH-1', subtipo: 'Vacaciones', subtipoCodigo: 'VACACIONES', estadoAbre: 'vacaciones', conductorId: 50, fechaIniIso: '2026-10-20', fechaFinIso: '2026-10-30', estado: 'pendiente', area: 'RRHH' },
  2: { id: 2, codigo: 'RRHH-2', subtipo: 'Baja', subtipoCodigo: 'BAJA_AUSENCIA', estadoAbre: 'baja_medica', conductorId: 51, fechaIniIso: '2026-10-09', fechaFinIso: null, estado: 'pendiente', area: 'RRHH' },
};
tRepo.una = async id => TICKETS[id] && { ...TICKETS[id] };
tRepo.catalogos = async () => ({
  estados: [{ codigo: 'en_curso', etiqueta: 'En curso', cierra: false }, { codigo: 'rechazado', etiqueta: 'Rechazado', cierra: true },
    { codigo: 'aprobado', etiqueta: 'Aprobado', cierra: true }],
  ausencias: [{ codigo: 'vacaciones', etiqueta: 'Vacaciones' }, { codigo: 'baja_medica', etiqueta: 'Baja médica' }, { codigo: 'permiso', etiqueta: 'Permiso' }],
});
tRepo.cambiarEstado = async () => {};
tRepo.apuntar = async () => {};
tRepo.reclasificar = async () => true;

const P = require('../modules/Conductores/plantilla.service');
const T = require('../modules/Ticketera/ticketera.service');
const q = id => ({ usuarioId: id, nombre: 'x', rol: id === SUPER ? 'superadmin' : 'oficina' });

(async () => {
  // ── La llave ─────────────────────────────────────────────────────────────
  igual('Laura tiene la llave', await aprobarVac.puede(LAURA), true);
  igual('Mercedes no', await aprobarVac.puede(MERCEDES), false);
  igual('El superadmin tampoco: va por la llave, no por el rol', await aprobarVac.puede(SUPER), false);
  igual('Sin usuario, no', await aprobarVac.puede(null), false);
  const entrada = permisos.CATALOGO.flatMap(g => g.items.map(i => ({ ...i, grupo: g.grupo }))).find(i => i.clave === '/vacaciones/aprobar');
  igual('Está en el catálogo, manual y en «Aprobaciones»', entrada && [entrada.manual, entrada.grupo], [true, 'Aprobaciones']);
  const roles = ['oficina', 'trafico', 'jefe_trafico', 'gestor_trafico', 'taller', 'reclutador', 'administracion', 'operaciones', 'gerencia', 'directiva'];
  igual('Ningún rol la recibe al crearse', roles.filter(r => permisos.semillaDeRol(r).includes('/vacaciones/aprobar')), []);

  // ── Plantilla ────────────────────────────────────────────────────────────
  igual('Cambiar la situación a vacaciones: sin la llave, no', await intenta(() => P.cambiarSituacion(5, { estado: 'vacaciones', desde: '2026-10-20', hastaPrevisto: '2026-10-30' }, q(MERCEDES))), 'bloqueada');
  igual('…ni siendo superadmin', await intenta(() => P.cambiarSituacion(5, { estado: 'vacaciones' }, q(SUPER))), 'bloqueada');
  igual('…ni con el valor envuelto del selector', await intenta(() => P.cambiarSituacion(5, { estado: { valor: 'vacaciones' } }, q(MERCEDES))), 'bloqueada');
  igual('Laura sí', await intenta(() => P.cambiarSituacion(5, { estado: 'vacaciones' }, q(LAURA))), 'pasa');
  igual('Volver al trabajo lo apunta cualquiera', await intenta(() => P.cambiarSituacion(5, { estado: 'activo' }, q(MERCEDES))), 'pasa');
  igual('Una baja médica, cualquiera', await intenta(() => P.cambiarSituacion(5, { estado: 'baja_medica' }, q(MERCEDES))), 'pasa');
  igual('Añadir un tramo de vacaciones: sin la llave, no', await intenta(() => P.anadirAusencia(5, { estado: 'vacaciones' }, q(MERCEDES))), 'bloqueada');
  igual('Añadir un permiso: cualquiera', await intenta(() => P.anadirAusencia(5, { estado: 'permiso' }, q(MERCEDES))), 'pasa');
  igual('Corregir unas vacaciones: sin la llave, no', await intenta(() => P.editarAusencia(5, 10, { hasta: '2026-11-01' }, q(MERCEDES))), 'bloqueada');
  igual('Borrar unas vacaciones: sin la llave, no', await intenta(() => P.borrarAusencia(5, 10, q(MERCEDES))), 'bloqueada');
  igual('Corregir una baja: cualquiera', await intenta(() => P.editarAusencia(5, 11, { hasta: '2026-11-01' }, q(MERCEDES))), 'pasa');
  igual('Laura corrige y borra vacaciones', [await intenta(() => P.editarAusencia(5, 10, {}, q(LAURA))), await intenta(() => P.borrarAusencia(5, 10, q(LAURA)))], ['pasa', 'pasa']);
  igual('Lo bloqueado no llegó a escribir nada: solo están las de Laura', hechos.filter(h => h[1] === 'vacaciones').length, 1);

  // ── Ticketera ────────────────────────────────────────────────────────────
  hechos.length = 0;
  igual('Aplicar un ticket de vacaciones: sin la llave, no', await intenta(() => T.aplicar(1, {}, q(MERCEDES))), 'bloqueada');
  igual('…y no se abrió nada en la ficha', hechos.length, 0);
  igual('Abrir unas vacaciones desde un ticket de baja: tampoco', await intenta(() => T.aplicar(2, { estado: 'vacaciones' }, q(MERCEDES))), 'bloqueada');
  igual('Aplicar una baja: cualquiera', await intenta(() => T.aplicar(2, {}, q(MERCEDES))), 'pasa');
  igual('Laura aplica las vacaciones', await intenta(() => T.aplicar(1, {}, q(LAURA))), 'pasa');
  igual('Rechazar un ticket de vacaciones: sin la llave, no', await intenta(() => T.cambiarEstado(1, { estado: 'rechazado', resolucion: 'no hay cupo' }, q(MERCEDES))), 'bloqueada');
  igual('Aprobarlo: tampoco', await intenta(() => T.cambiarEstado(1, { estado: 'aprobado', resolucion: 'ok' }, q(MERCEDES))), 'bloqueada');
  igual('Ponerlo «en curso»: cualquiera', await intenta(() => T.cambiarEstado(1, { estado: 'en_curso' }, q(MERCEDES))), 'pasa');
  igual('Cerrar un ticket de baja: cualquiera', await intenta(() => T.cambiarEstado(2, { estado: 'rechazado', resolucion: 'x' }, q(MERCEDES))), 'pasa');
  igual('Sacarlo de vacaciones: sin la llave, no', await intenta(() => T.reclasificar(1, 'PERMISO_RETRIBUIDO', q(MERCEDES))), 'bloqueada');
  igual('Meter uno en vacaciones: cualquiera (así le llega a Laura)', await intenta(() => T.reclasificar(2, 'VACACIONES', q(MERCEDES))), 'pasa');
  igual('Laura lo rechaza', await intenta(() => T.cambiarEstado(1, { estado: 'rechazado', resolucion: 'no hay cupo' }, q(LAURA))), 'pasa');

  // ── El mensaje dice a quién acudir ───────────────────────────────────────
  try { await aprobarVac.exigir(MERCEDES); } catch (e) { igual('El aviso nombra a Laura', e.message, 'Las vacaciones solo las aprueba Laura Blanco. Puedes verlas, pero no aprobarlas, rechazarlas ni cambiarlas.'); }

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
