// ============================================================
// BARCELONA · RECAUDACIÓN DEL EFECTIVO
// ============================================================
// Camilo, 05/11/2026: «Déjame listo la recaudación de efectivo en Barcelona, de
// la misma forma». Es LA MISMA recaudación de Madrid (modules/Administracion:
// quincenas, cierres de BOLT congelados, ajustes con motivo, caja, cambio,
// transferencias, «¿Cuadra?»), con tres cosas suyas:
//
//   · SUS TABLAS (db/230): sede_recaudacion_cierre y sede_recaudacion_movimiento.
//     Nada de lo que se cobre aquí suma en la caja ni en la deuda de Madrid.
//   · SU EFECTIVO sale de sus pedidos (sede_bolt_order), no de bolt_order.
//   · NO HAY FICHAS: cada persona es su cuenta de BOLT de la empresa de
//     Barcelona (soloCuentas). Cobrar, ajustar y la ficha van por la cuenta.
//
// La deuda empieza el 1 de noviembre de 2026 (lo eligió Camilo): es el corte, y
// sale de PAGO_DESDE, que es también desde cuándo la ingesta guarda el pago de
// sus pedidos. Antes del corte no hay nada (ni Excel ni histórico).
//
// Llaves PROPIAS, no las de Madrid (también lo eligió él): /barcelona/recaudacion
// para entrar y cobrar, /barcelona/recaudacion/nomina para los descuentos de
// nómina. Ver services/permisos.js.

const fabricaRepo = require('../Administracion/recaudacion.repo');
const fabricaServicio = require('../Administracion/recaudacion.service');
const { PAGO_DESDE } = require('../../services/repo/otrasSedes');

const SEDE = 'barcelona';
const CLAVE = '/barcelona/recaudacion';
const CLAVE_NOMINA = '/barcelona/recaudacion/nomina';

const repo = fabricaRepo.crear({
  sede: SEDE,
  corte: fabricaRepo.quincenaDe(PAGO_DESDE[SEDE]),
  tablas: { cierre: 'sede_recaudacion_cierre', mov: 'sede_recaudacion_movimiento' },
  ordenes: { tabla: 'sede_bolt_order', filtro: `AND o.sede = '${SEDE}'` },
  soloCuentas: true,
});

const servicio = fabricaServicio.crear({ repo, claveNomina: CLAVE_NOMINA });

module.exports = { ...servicio, repo, SEDE, CLAVE, CLAVE_NOMINA };
