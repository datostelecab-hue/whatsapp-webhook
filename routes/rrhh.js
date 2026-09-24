// ============================================================
// /rrhh — el tablero de RRHH: verificar la ficha y tramitar el alta
// ============================================================
// Recibe lo que Selección deja listo, comprueba que los papeles están, mete a la
// persona en un Excel de altas para la gestoría y la deja de alta.
//
// Hasta el 24/09/2026 la mandaba después a Administración a por el PIN de
// Ballenoil. Ya no se trabaja con Ballenoil, y esa parada se quitó.
//
// ── QUÉ CAMBIÓ AL SALIR DE LAS HOJAS (15/09/2026) ───────────────────────────
// AQUÍ NO SE DA DE ALTA A NADIE, y no es que se haya quitado: es que ya no hacía
// falta. `pasarARRHH` abre el contrato, pone el turno y enlaza la cuenta de BOLT
// en el momento en que Selección suelta la ficha. Los que esperan en esta
// pantalla ya tienen contrato.
//
// Lo que queda es lo de RRHH de verdad: mirar que los papeles estén, generar el
// Excel que se le manda a la gestoría, y decidir si sigue adelante o no.
//
// Los documentos son DE LA PERSONA y viven en su tabla, así que el mismo DNI
// vale para quien se cayó del proceso y volvió seis meses después.

const express = require('express');
const router = express.Router();
const seleccion = require('../modules/Seleccion/seleccion.service');
const actor = require('../services/repo/actor');

const quien = async req => ({ usuarioId: await actor.idDe(req) });
const tel9 = v => String(v == null ? '' : v).replace(/\D/g, '').slice(-9);

router.get('/', (req, res) => {
  res.render('rrhh', { titulo: 'RRHH', seccion: 'rrhh', layout: 'layout-gestion' });
});

/**
 * Busca una ficha del tramo por el teléfono, que es la llave que usa la
 * pantalla. Debajo ya no hay una hoja indexada por teléfono: hay candidaturas
 * con su id, y el teléfono se resuelve aquí.
 */
async function porTelefono(tel, monton) {
  const t = await seleccion.tramoFinal();
  const donde = monton ? t[monton] : [...t.porTramitar, ...t.hechas, ...t.noAlta];
  const f = donde.find(c => tel9(c.telefono) === tel9(tel));
  if (!f) throw new Error('No encuentro esa ficha' + (monton ? ' en ese montón' : ''));
  return f;
}

router.get('/api/datos', async (req, res) => {
  try {
    const t = await seleccion.tramoFinal();
    // `id` sigue siendo el teléfono: es con lo que la pantalla llama a todo lo
    // demás y no hay razón para hacerle aprender otra llave.
    const map = c => ({
      id: c.telefono, candidaturaId: c.id, conductorId: c.conductorId,
      nombre: c.quien, apellidos: '', telefono: c.telefono,
      dni: c.dni, email: c.email, num_seg_social: c.naf,
      turno: c.turno, zona: c.zona, canal: c.canal, ett: c.ett,
      jornada: c.jornadaHoras, contrato: c.tipoContrato,
      fecha_inicio: c.inicioPrevisto ? String(c.inicioPrevisto).slice(0, 10) : '',
      excel_alta: c.excelAlta, estado: c.estadoEtiqueta, motivo: c.motivo,
      documentos: c.documentos,
      // El PDF de la ficha de alta se genera al pedirlo, así que siempre hay:
      // antes era un enlace guardado que podía apuntar a una versión vieja.
      ficha_pdf_link: `/rrhh/doc?tel=${encodeURIComponent(c.telefono || '')}&tipo=ficha_pdf`,
    });
    const porTramitar = t.porTramitar.map(map);
    const altas = t.hechas.map(map);
    const noAlta = t.noAlta.map(map);
    res.json({
      status: 'ok', porTramitar, altas, noAlta,
      contadores: {
        porTramitar: porTramitar.length, altas: altas.length, noAlta: noAlta.length,
        ett: porTramitar.filter(x => x.ett).length,
        general: porTramitar.filter(x => !x.ett).length,
      },
    });
  } catch (error) {
    console.error('❌ [RRHH] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/** Tramitar: la ficha queda de alta y sale de la bandeja. El contrato ya estaba abierto. */
router.post('/alta', async (req, res) => {
  try {
    const b = req.body || {};
    const f = await porTelefono(b.tel, 'porTramitar');
    const t = await seleccion.tramitarAlta(f.id,
      { fechaAlta: b.fecha_alta, fechaHabilitado: b.fecha_habilitado }, await quien(req));
    console.log(`👤 [RRHH] ${f.quien} tramitada → de alta`);
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** RRHH decide no continuar con el alta. */
router.post('/no-continuar', async (req, res) => {
  try {
    const b = req.body || {};
    const f = await porTelefono(b.tel);
    const t = await seleccion.cambiarEstado(f.id, 'no_alta', b.motivo, await quien(req));
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** RRHH devuelve la ficha a Selección con el motivo. */
router.post('/devolver', async (req, res) => {
  try {
    const b = req.body || {};
    const f = await porTelefono(b.tel);
    const t = await seleccion.cambiarEstado(f.id, 'rechazado_rrhh', b.motivo, await quien(req));
    res.json({ status: 'ok', ticket: t });
  } catch (error) {
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** El Excel de altas de un grupo de fichas + la fecha que elige RRHH. */
router.post('/altas-excel', async (req, res) => {
  try {
    const b = req.body || {};
    // La pantalla manda teléfonos; aquí se traducen a candidaturas.
    const t = await seleccion.tramoFinal();
    const pedidos = new Set((b.tels || []).map(tel9));
    const ids = t.porTramitar
      .filter(c => pedidos.has(tel9(c.telefono))).map(c => c.id);

    const { buffer, nombre } = await seleccion.excelDeAltas({
      ids, fecha: b.fecha, tipo: b.tipo === 'ett' ? 'ett' : 'general',
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(buffer);
  } catch (error) {
    console.error('❌ [RRHH] altas-excel:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/**
 * Ver un documento sin salir de RRHH: se descarga con la cuenta de servicio y se
 * devuelve con su tipo, para pintarlo en un <img> o abrirlo en una pestaña.
 *
 * `ficha_pdf` no es un documento guardado: es la ficha de alta, que se genera al
 * pedirla. Antes era un enlace apuntando a un PDF de Drive que podía ser de
 * antes del último cambio de datos.
 */
router.get('/doc', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '');
    const f = await porTelefono(req.query.tel);

    if (tipo === 'ficha_pdf') {
      const pdf = await seleccion.fichaPDF(f.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${pdf.nombre}"`);
      return res.send(pdf.bytes);
    }

    const { bytes, mime } = await seleccion.descargarDocumento(f.id, tipo);
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(bytes);
  } catch (error) {
    console.error('❌ [RRHH] doc:', error.message);
    res.status(404).send(error.message || 'Sin documento');
  }
});

module.exports = router;
