// ============================================================
// PLANIFICADOR V2 — tablero visual de cuadrantes (solo interfaz)
// ============================================================
// Una segunda cara del MISMO planificador: tarjetas por coche con arrastrar y
// soltar, huecos a la vista y cambio de matrícula por grupo. No añade API
// propia: lee y guarda contra /planificador/api/*, así que todas las
// validaciones (conflictos, dobles asignaciones, letras de días) son las de
// siempre y los dos planificadores no pueden divergir.

const express = require('express');
const router = express.Router();
const { DIAS_SEM, LETRAS_DIA, ESTADOS_VEHICULOS_LISTA } = (() => {
  const p = require('../services/planificadorV2');
  return {
    DIAS_SEM: p.DIAS_SEM,
    LETRAS_DIA: p.LETRAS_DIA,
    ESTADOS_VEHICULOS_LISTA: p.ESTADOS_VEHICULO
  };
})();

router.get('/', (req, res) => {
  res.render('planificadorV2', {
    titulo: 'Planificador V2',
    seccion: 'planificador-v2',
    layout: 'layout-gestion',
    diasSem: DIAS_SEM,
    letrasDia: LETRAS_DIA,
    estadosVehiculo: ESTADOS_VEHICULOS_LISTA
  });
});

module.exports = router;
