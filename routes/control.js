const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const { enDirecto } = require('../services/flotaViva/directo');
const { kmConectadoDesconectado } = require('../services/flotaViva/rutas');
const { enviarAtencionHora } = require('../services/whatsapp');
const justificantes = require('../services/justificantes');   // (reporte: aún usa la hoja, se migra "luego")
const repoJust = require('../services/repo/justificantes');    // justificar/leer: PostgreSQL
const { generarExcelTurnos } = require('../services/controlExcel');

const MAX_ENVIO = 200;

// Hoy en Madrid, 'YYYY-MM-DD'. Los datos van por día operativo.
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// EN DIRECTO — el cockpit. Fusiona el plan del Cuadrante con la realidad viva de
// Flota Viva y las alertas abiertas. Sustituye al tablero de hojas (que sigue
// disponible en /api/datos y en la vista 'control' por si hace falta volver).
router.get('/', (req, res) => {
  res.render('controlDirecto', {
    titulo: 'Control · En directo',
    seccion: 'control',
    layout: 'layout-gestion'
  });
});

// Los datos del cockpit (JSON). El front lo refresca solo cada pocos segundos.
router.get('/api/directo', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await enDirecto({ dia: req.query.dia })) });
  } catch (error) {
    console.error('❌ [Control] /api/directo:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── KM y traza (Fase 3) ─────────────────────────────────────────────────────
// El km CONECTADO vs DESCONECTADO por conductor, del núcleo (route/list cruzado
// con los tramos). Es la fuente buena: el km del `mileage` era el que daba 0.
router.get('/km', (req, res) => {
  res.render('kmTraza', { titulo: 'Control · KM y traza', seccion: 'control', layout: 'layout-gestion' });
});
router.get('/api/km-traza', async (req, res) => {
  try {
    await require('../services/flotaViva/db').preparar();
    const dia = (req.query.dia && String(req.query.dia).slice(0, 10)) || hoyMadrid();
    const turno = ['dia', 'noche', 'completo'].includes(req.query.turno) ? req.query.turno : 'completo';
    res.json({ status: 'ok', ...(await kmConectadoDesconectado(dia, turno)) });
  } catch (error) {
    console.error('❌ [Control] /api/km-traza:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// DIAGNÓSTICO de km: por qué una matrícula sale (o no) con km en el reporte.
// Traza los tres cruces del núcleo (fv_ruta / fv_vehiculo.mapon_unit / fv_tramo) y
// dice dónde se corta. Ej: /control/api/km-diagnostico?dia=2026-09-01&mats=9521MMX,6663LCY
// El `turno` por defecto es 'operativo' (05→05), el mismo que usa el reporte de horas.
router.get('/api/km-diagnostico', async (req, res) => {
  try {
    const { diagnosticoKm } = require('../services/flotaViva/rutas');
    const dia = (req.query.dia && String(req.query.dia).slice(0, 10)) || hoyMadrid();
    const turno = ['dia', 'noche', 'completo', 'operativo'].includes(req.query.turno) ? req.query.turno : 'operativo';
    const mats = String(req.query.mats || req.query.mat || '').split(',').map(s => s.trim()).filter(Boolean);
    // ?nombre= (o ?nombres=) traza por conductor: en qué coches tiene tramos ese día.
    const nombres = String(req.query.nombres || req.query.nombre || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!mats.length && !nombres.length) throw new Error('Falta ?mats= (matrículas) o ?nombre= (conductor)');
    // ?mapon=1 → además le pregunta a Mapon por la ventana exacta, para cerrar la
    // bifurcación "hueco de ingesta vs. baliza caída" sin pegar JSON crudo.
    const conMapon = req.query.mapon === '1' || req.query.mapon === 'true';
    res.json({ status: 'ok', ...(await diagnosticoKm(dia, mats, turno, { conMapon, nombres })) });
  } catch (error) {
    console.error('❌ [Control] /api/km-diagnostico:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Reportes ────────────────────────────────────────────────────────────────
// De momento reúne lo que ya es "reporte" y hoy vivía suelto en el clásico: los
// turnos para imprimir y el reporte de horas del día. Se irá llenando.
router.get('/reportes', (req, res) => {
  res.render('reportes', { titulo: 'Control · Reportes', seccion: 'control', layout: 'layout-gestion' });
});

// QUIÉN DEBE SALIR — la lista para LLAMAR, por turno. Sale directa del
// planificador (f_cobertura): ya deja fuera a quien libra, a quien tiene el coche
// en descanso y a cualquier ausente. Los que aparecen, salen sí o sí.
router.get('/api/salidas', async (req, res) => {
  try {
    const { salidasHoy } = require('../services/repo/planificador');
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(req.query.dia || '') ? req.query.dia : hoyMadrid();
    const datos = await salidasHoy(dia);
    res.json({ status: 'ok', fecha: dia.split('-').reverse().join('/'), ...datos });
  } catch (e) {
    console.error('❌ [Control] /api/salidas:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// El "Tablero clásico" (leía las horas de la hoja Datos_API) se RETIRÓ: manda el
// cockpit "En directo" (PostgreSQL) y lo exportable vive en Reportes. La función
// tableroControl() sigue en services/control.js solo porque el reporte de horas la
// usa todavía; ese reporte se migra aparte ("luego"). Nada más lee de la hoja aquí.

// Exporta a Excel las filas (ya filtradas y ordenadas en el cliente) con las columnas dadas.
router.post('/excel', async (req, res) => {
  try {
    const b = req.body || {};
    const columnas = Array.isArray(b.columnas) ? b.columnas : [];
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!columnas.length) throw new Error('Sin columnas');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Control');
    ws.columns = columnas.map(c => ({ header: String(c.label || c.key), key: String(c.key), width: 22 }));
    filas.forEach(f => ws.addRow(f));
    ws.getRow(1).font = { bold: true };
    const buffer = await wb.xlsx.writeBuffer();
    const nombre = String(b.titulo || 'control').replace(/[^\w\-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ [Control] /excel:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Envía la plantilla atencion_hora a los conductores seleccionados en la UI.
// Solo actúa sobre la lista que manda el front (el usuario ya eligió y confirmó).
router.post('/enviar-ws', async (req, res) => {
  try {
    const dest = (req.body && req.body.destinatarios) || [];
    if (!Array.isArray(dest) || dest.length === 0) {
      return res.status(400).json({ status: 'error', msg: 'Sin destinatarios' });
    }
    if (dest.length > MAX_ENVIO) {
      return res.status(400).json({ status: 'error', msg: `Demasiados (máx ${MAX_ENVIO})` });
    }

    const detalle = [];
    for (const d of dest) {
      const r = await enviarAtencionHora(d.telefono, d.nombre);
      detalle.push({ nombre: d.nombre, telefono: d.telefono, ...r });
      await new Promise(ok => setTimeout(ok, 150));   // no saturar la API
    }

    const enviados = detalle.filter(x => x.ok).length;
    console.log(`📤 [Control] atencion_hora: ${enviados}/${dest.length} enviados`);
    res.json({ status: 'ok', enviados, fallidos: dest.length - enviados, detalle });
  } catch (error) {
    console.error('❌ [Control] /enviar-ws:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Justificantes (letra J) ────────────────────────────────────────────────
// Justifica un día pasado (Ayer / Hace 2 / Hace 3) a un conductor: guarda el
// justificante con su observación (obligatoria) y, si tiene fila en la bitácora,
// le pone la 'J' azul ese día. Los NN quedan solo en la hoja JUSTIFICANTES.
router.post('/justificar', async (req, res) => {
  try {
    const b = req.body || {};
    const dia = Number(b.dia);
    if (![0, 1, 2, 3].includes(dia)) throw new Error('Día no válido para justificar (Hoy, Ayer, Hace 2 o Hace 3)');
    const { Y, M, D, str: fecha } = justificantes.fechaDeClave(dia);
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    const r = await repoJust.guardar({
      diaIso: iso, nombre: b.nombre,
      horas: (b.horas == null || b.horas === '') ? '' : Number(b.horas),
      observacion: b.observacion, usuarioId: (req.usuario && req.usuario.id) || null,
    });
    console.log(`📝 [Control] Justificante PG ${iso} · ${b.nombre} → conductor ${r.conductorId} (J en bitácora)`);
    res.json({ status: 'ok', fecha, ...r });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Justificantes ya puestos de un día (para que el tablero marque a los justificados).
router.get('/justificantes', async (req, res) => {
  try {
    const dia = Number(req.query.dia);
    const key = [0, 1, 2, 3].includes(dia) ? dia : 1;
    const { Y, M, D, str: fecha } = justificantes.fechaDeClave(key);
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    const m = await repoJust.leerPorFecha(iso);
    // El Map trae la misma entrada bajo varias claves (nombre BOLT y canónico): dedup por conductor.
    const vistos = new Set(); const justis = [];
    for (const j of m.values()) { if (vistos.has(j.conductorId)) continue; vistos.add(j.conductorId); justis.push({ nombre: j.nombre, observacion: j.observacion }); }
    res.json({ status: 'ok', fecha, justis });
  } catch (e) {
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Reporte del día con COLORES en la celda de horas (Excel): verde/amarillo/rojo y los J azules al final.
router.get('/reporte/excel', async (req, res) => {
  try {
    const dia = Number(req.query.dia);
    const key = [1, 2, 3].includes(dia) ? dia : 1;
    const rep = await justificantes.reporteDia(key);
    const buf = await justificantes.excelDia(rep);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-horas-${rep.fecha.replace(/\//g, '-')}.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('❌ [Control] /reporte/excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// PDF del Sankey de flujo de KM del día (mismo `dia`=key que el reporte de horas).
// Reutiliza generarPdfFlujo de la Auditoría; el dato va POR MATRÍCULA (no duplica).
router.get('/sankey/pdf', async (req, res) => {
  try {
    const key = [1, 2, 3].includes(Number(req.query.dia)) ? Number(req.query.dia) : 1;
    const { Y, M, D, str: fecha, idx } = justificantes.fechaDeClave(key);
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    await require('../services/flotaViva/db').preparar();
    const { sankeyFlota } = require('../services/flotaViva/rutas');
    const { generarPdfFlujo } = require('../services/auditoriaPdf');
    const { rgb } = require('pdf-lib');

    const s = await sankeyFlota(iso);
    // El color de cada turno lo pone aquí (tenemos pdf-lib): día verde, noche azul.
    const tramos = s.tramos.map((t, i) => ({ ...t, color: i === 0 ? rgb(0.13, 0.70, 0.45) : rgb(0.38, 0.65, 0.98) }));
    const diaSem = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][idx];
    const pdf = await generarPdfFlujo({
      titulo: `Flujo de KM · ${diaSem} ${fecha}`,
      subtitulo: 'En BOLT (viaje + espera) vs desconectado (descanso + apagado). Por coche, sin duplicar.',
      rango: fecha, tramos, matriculas: s.matriculas,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sankey-km-${fecha.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('❌ [Control] /sankey/pdf:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Turnos de hoy (solo noche) + los dos días siguientes con las dos tablas.
// Pensado para el viernes: llevar impreso quién sale el sábado y el domingo.
router.get('/turnos/excel', async (req, res) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 2, 0), 6);
    const { buffer, nombre } = await generarExcelTurnos({ dias, desde: req.query.desde });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    console.error('❌ [Control] /turnos/excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// La PARRILLA del planificador (formato ANEXO) en Excel: por CORRETURNO, cada
// coche con su descanso, matrícula y las 4 plazas (fijo/CT × día/noche) con
// teléfono y zona. Sale del planificador REAL (PostgreSQL), no de las hojas.
router.get('/planificador/excel', async (req, res) => {
  try {
    const plani = require('../services/repo/planificador');
    const { exportar } = require('../services/exportarPlanificador');
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(req.query.dia || '') ? req.query.dia : hoyMadrid();
    const tablero = await plani.tablero({ dia });
    const buffer = await exportar(tablero);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Planificador_${dia}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('❌ [Control] /planificador/excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
