const express = require('express');
const router = express.Router();
const { procesarYUnificar } = require('../services/boltHorasCore');
const {
  procesarHistorico,
  getEstado,
  nombreHojaMes,
  listarMeses,
  RANGO_DEFECTO
} = require('../services/boltHistorico');

// "4-2025" → { mes: 4, ano: 2025 }
function parsearMesAno(texto) {
  if (!texto) return null;
  const partes = texto.split('-').map(n => parseInt(n, 10));
  if (partes.length !== 2 || partes.some(isNaN)) return null;
  const [mes, ano] = partes;
  if (mes < 1 || mes > 12 || ano < 2020 || ano > 2035) return null;
  return { mes, ano };
}

// Procesar mes actual
router.get('/procesar', async (req, res) => {
  try {
    const ahora = new Date();
    const mes = ahora.getMonth() + 1;
    const ano = ahora.getFullYear();

    console.log(`🔄 Procesando ${mes}/${ano}...`);
    const result = await procesarYUnificar(mes, ano);

    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ============================================================
// BACKFILL HISTÓRICO: una hoja por mes (abril-2025, mayo-2025, ...)
// ============================================================

// Estado del backfill en curso. Va antes de /historico para que Express no
// intente resolver "estado" como un parámetro de rango.
router.get('/historico/estado', (req, res) => {
  res.json(getEstado());
});

// Lanza el backfill en segundo plano y responde al momento: procesar 13 meses
// tarda bastante más de lo que aguanta una petición HTTP.
router.get('/historico', (req, res) => {
  const desde = parsearMesAno(req.query.desde) || RANGO_DEFECTO.desde;
  const hasta = parsearMesAno(req.query.hasta) || RANGO_DEFECTO.hasta;

  const estadoActual = getEstado();
  if (estadoActual.enCurso) {
    return res.status(409).json({
      status: 'ya-en-curso',
      msg: `Ya hay un backfill corriendo (${estadoActual.procesados}/${estadoActual.totalMeses})`,
      actual: estadoActual.actual
    });
  }

  const meses = listarMeses(desde, hasta);
  if (meses.length === 0) {
    return res.status(400).json({
      status: 'error',
      msg: `Rango vacío o invertido: ${desde.mes}/${desde.ano} → ${hasta.mes}/${hasta.ano}`
    });
  }

  procesarHistorico({ desde, hasta }).catch(error => {
    console.error(`❌ [HISTÓRICO] Fallo general: ${error.message}`);
  });

  res.status(202).json({
    status: 'iniciado',
    meses: meses.length,
    hojas: meses.map(m => nombreHojaMes(m.mes, m.ano)),
    estado: '/horas/historico/estado'
  });
});

// Rehacer un único mes en su propia hoja (abril-2025), sin tocar
// TODAS_LAS_FLOTAS. Útil para reintentar un mes que haya fallado.
router.get('/mes/:mes/:ano', async (req, res) => {
  try {
    const mes = parseInt(req.params.mes, 10);
    const ano = parseInt(req.params.ano, 10);

    if (isNaN(mes) || isNaN(ano) || mes < 1 || mes > 12) {
      return res.status(400).json({ status: 'error', msg: 'Mes o año inválido' });
    }

    const hoja = nombreHojaMes(mes, ano);
    console.log(`🔄 Procesando ${mes}/${ano} → hoja "${hoja}"...`);
    const result = await procesarYUnificar(mes, ano, { hojaDestino: hoja, incluirTodos: true });

    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Procesar mes específico (escribe en TODAS_LAS_FLOTAS)
router.get('/procesar/:mes/:ano', async (req, res) => {
  try {
    const mes = parseInt(req.params.mes);
    const ano = parseInt(req.params.ano);

    console.log(`🔄 Procesando ${mes}/${ano}...`);
    const result = await procesarYUnificar(mes, ano);

    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;