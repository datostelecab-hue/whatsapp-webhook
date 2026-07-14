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
    const data = await readSheet(SPREADSHEET_ID, 'TODAS_LAS_FLOTAS!A1:AM250');
    
    const ahora = new Date();
    const mesActual = ahora.getMonth() + 1;
    const anoActual = ahora.getFullYear();
    const diasDelMes = new Date(anoActual, mesActual, 0).getDate();

    const numColumnas = 3 + diasDelMes + 31;
    const letraColumna = numeroALetra(numColumnas);
    const rango = `TODAS_LAS_FLOTAS!A1:${letraColumna}250`;

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
      filas: data.slice(2) || [],
      mesActual,
      anoActual,
      meses,
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

module.exports = router;