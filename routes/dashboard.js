const express = require('express');
const router = express.Router();
const { readSheet } = require('../services/sheets');
const { procesarYUnificar } = require('../services/boltHorasCore');
const { SPREADSHEET_ID } = require('../services/turnos');

// ============================================================
// PÁGINA PRINCIPAL DEL DASHBOARD
// ============================================================
router.get('/', async (req, res) => {
  try {
    const ahora = new Date();
    const mesActual = ahora.getMonth() + 1;
    const anoActual = ahora.getFullYear();
    const diasDelMes = new Date(anoActual, mesActual, 0).getDate();

    // Calcular columnas: A(Estado) + B(Conductor) + C(Turno) + días + TOTAL + Noc + Días + Meta + Debe
    const numColumnas = 3 + diasDelMes + 5;
    const letraColumna = numeroALetra(numColumnas);
    const rango = `TODAS_LAS_FLOTAS!A1:${letraColumna}250`;

    console.log(`📊 Dashboard: ${diasDelMes} días, ${numColumnas} columnas, rango ${rango}`);

    const data = await readSheet(SPREADSHEET_ID, rango);

    // Paginación
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 50;
    const todasFilas = data.slice(2).filter(f => f[1] && f[1].toString().trim() !== '');
    const totalConductores = todasFilas.length;
    const totalPaginas = Math.ceil(totalConductores / limite) || 1;
    const inicio = (pagina - 1) * limite;
    const filasPaginadas = todasFilas.slice(inicio, inicio + limite);

    const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const meses = [];
    for (let m = 1; m <= mesActual; m++) {
      meses.push({ numero: m, nombre: mesesNombres[m - 1] });
    }

    // Mensaje de query string
    const msg = req.query.msg === 'actualizado'
      ? '✅ Datos del mes actual actualizados correctamente'
      : req.query.msg === 'mes_actualizado'
        ? `✅ Datos de ${mesesNombres[parseInt(req.query.mes) - 1]} ${req.query.ano} generados correctamente`
        : null;

    res.render('dashboard', {
      titulo: 'Dashboard',
      msg,
      headers: data[1] || [],
      filas: filasPaginadas,
      mesActual,
      anoActual,
      meses,
      pagina,
      totalPaginas,
      limite,
      totalConductores,
      ultimaActualizacion: new Date().toLocaleString('es-ES')
    });

  } catch (error) {
    res.render('error', {
      titulo: 'Error',
      mensaje: error.message
    });
  }
});


function numeroALetra(n) {
  let letra = '';
  while (n > 0) {
    n--;
    letra = String.fromCharCode(65 + (n % 26)) + letra;
    n = Math.floor(n / 26);
  }
  return letra;
}


// ============================================================
// ACTUALIZAR MES ACTUAL
// ============================================================
router.post('/actualizar', async (req, res) => {
  try {
    const ahora = new Date();
    await procesarYUnificar(ahora.getMonth() + 1, ahora.getFullYear());
    res.redirect('/dashboard?msg=actualizado');
  } catch (error) {
    res.render('error', { titulo: 'Error', mensaje: error.message });
  }
});

// ============================================================
// ACTUALIZAR MES ESPECÍFICO
// ============================================================
router.post('/actualizar-mes', async (req, res) => {
  try {
    const mes = parseInt(req.body.mes);
    const ano = parseInt(req.body.ano);
    await procesarYUnificar(mes, ano);
    res.redirect(`/dashboard?msg=mes_actualizado&mes=${mes}&ano=${ano}`);
  } catch (error) {
    res.render('error', { titulo: 'Error', mensaje: error.message });
  }
});

const { procesarYUnificar, obtenerMetricasVisor } = require('../services/boltHorasCore');

// ============================================================
// VISOR EN VIVO - PÁGINA PRINCIPAL
// ============================================================
router.get('/visor', async (req, res) => {
  try {
    const metricas = await obtenerMetricasVisor();
    
    res.render('visor', {
      titulo: 'Flota Telecab Madrid',
      metricas,
      layout: false  // Sin layout global, usa su propio HTML
    });
  } catch (error) {
    res.render('visor', {
      titulo: 'Flota Telecab Madrid',
      metricas: null,
      error: error.message,
      layout: false
    });
  }
});

module.exports = router;
