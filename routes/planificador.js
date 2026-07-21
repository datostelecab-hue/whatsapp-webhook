const express = require('express');
const router = express.Router();
const {
  SPREADSHEET_PLANIFICADOR, RANGOS,
  N_MAT, PLAN_FILA_INI, PLAN_FILA_CAB, FILAS_POR_COCHE,
  A_HEADERS, P_HEADERS, SLOTS,
  validarEsquema, leerTablero, colLetra
} = require('../services/planificadorV2');
const { readMany } = require('../services/sheets');

/**
 * Radiografía de la hoja real, SIN escribir nada.
 *
 * Se ejecuta antes de construir la interfaz: el motor está hecho contra el
 * esquema que declara el Apps Script, y si la hoja ha derivado (una columna
 * movida, otro número de coches, la cabecera en otra fila) es mucho mejor
 * enterarse aquí que después de haber escrito encima de los datos.
 */
router.get('/validar', async (req, res) => {
  try {
    const [agenda, plan, bases] = await readMany(
      SPREADSHEET_PLANIFICADOR,
      [RANGOS.agenda, RANGOS.plan, RANGOS.bases]
    );

    const esquema = validarEsquema(agenda, plan);

    // Cabeceras reales frente a las esperadas, columna por columna
    const cabAgenda = (agenda[0] || []).map((v, i) => ({
      col: colLetra(i + 1), real: String(v || '').trim(), esperado: A_HEADERS[i] || '(sobra)'
    }));
    const cabPlan = (plan[0] || []).map((v, i) => ({
      col: colLetra(i + 1), real: String(v || '').trim(), esperado: P_HEADERS[i] || '(sobra)'
    }));

    // ¿Cuántos coches tienen matrícula de verdad? El motor asume N_MAT bloques
    // de 6 filas; si la hoja tiene otro tamaño, se ve aquí.
    const filasPlan = plan.slice(1);
    let cochesConMatricula = 0;
    let bloquesDesalineados = 0;
    for (let c = 0; c < N_MAT; c++) {
      const base = c * FILAS_POR_COCHE;
      const top = filasPlan[base] || [];
      if (String(top[2] || '').trim()) cochesConMatricula++;
      // El primer renglón de cada bloque debe ser el slot "Día"
      const turno = String((filasPlan[base] || [])[0] || '').trim();
      if (turno && turno !== SLOTS[0].etiqueta) bloquesDesalineados++;
    }

    const conductores = agenda.slice(1).filter(f => String(f[3] || '').trim()).length;

    res.json({
      hoja: SPREADSHEET_PLANIFICADOR,
      esquema,
      layoutEsperado: {
        filaCabeceraPlan: PLAN_FILA_CAB,
        primeraFilaDatos: PLAN_FILA_INI,
        filasPorCoche: FILAS_POR_COCHE,
        maxCoches: N_MAT,
        ultimaFila: PLAN_FILA_INI + N_MAT * FILAS_POR_COCHE - 1
      },
      loQueHay: {
        filasAgendaLeidas: agenda.length,
        conductoresConId: conductores,
        filasPlanLeidas: plan.length,
        cochesConMatricula,
        bloquesDesalineados,
        bases: Math.max(0, bases.length - 1)
      },
      cabeceras: {
        agenda: cabAgenda.filter(c => c.real !== c.esperado),
        plan: cabPlan.filter(c => c.real !== c.esperado)
      }
    });
  } catch (error) {
    console.error('❌ [PLANIFICADOR] /validar:', error.message);
    res.status(500).json({
      status: 'error',
      msg: error.message,
      pista: error.message.includes('permission') || error.message.includes('403')
        ? 'Comparte la hoja con el email de la cuenta de servicio de GOOGLE_CREDENTIALS (permiso de Editor)'
        : undefined
    });
  }
});

/** Tablero completo ya calculado, en JSON. Solo lectura. */
router.get('/api/tablero', async (req, res) => {
  try {
    const t = await leerTablero();

    // Por defecto solo los coches con matrícula, que son los que se usan.
    const coches = req.query.todos === '1'
      ? t.coches
      : t.coches.filter(c => c.matricula || c.personas.some(p => p.id));

    res.json({
      esquema: t.esquema,
      resumen: t.resumen,
      avisos: t.avisos,
      coches,
      conductores: t.conductores,
      pendientes: t.pendientes,
      bases: t.bases
    });
  } catch (error) {
    console.error('❌ [PLANIFICADOR] /api/tablero:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
