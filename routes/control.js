const express = require('express');
const router = express.Router();
const { enDirecto } = require('../services/flotaViva/directo');
const { kmConectadoDesconectado } = require('../services/flotaViva/rutas');
const justificantes = require('../services/justificantes');   // el Excel del reporte de horas (los datos, en repo/reporteHoras)
const repoJust = require('../services/repo/justificantes');    // justificar: PostgreSQL
const llamadas = require('../services/repo/llamadas');         // el "telefonito" de seguimiento
const actor = require('../services/repo/actor');               // quién firma (id por email si la cookie es vieja)
const callCenter = require('../services/callCenter');          // espejo de las llamadas en su hoja
const { generarExcelTurnos } = require('../services/controlExcel');

// Hoy en Madrid, 'YYYY-MM-DD' (fecha de calendario: para los descargables que
// piden un día concreto). El cockpit y sus acciones van por JORNADA OPERATIVA.
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Las horas que escribe una persona: "7,5" vale, "7.5" vale, "siete" no. Se
// devuelven como texto limpio; los límites los pone repo/justificantes.
const horasLimpias = h => (h == null || h === '') ? '' : String(h).trim().replace(',', '.');

// EN DIRECTO — el cockpit. Fusiona el plan del Cuadrante con la realidad viva de
// Flota Viva y las alertas abiertas. El tablero clásico de hojas se retiró; lo
// exportable vive en /control/reportes.
router.get('/', (req, res) => {
  res.render('controlDirecto', {
    titulo: 'Control · En directo',
    seccion: 'control',
    layout: 'layout-gestion',
    // El buzón de resultados vive en el servidor (repo/llamadas): una sola
    // lista para el cockpit y para las campañas.
    resultadosLlamada: llamadas.RESULTADOS,
    catalogoLlamada: llamadas.CATALOGO,
    tiposJ: require('../services/repo/justificantes').TIPOS_J,
  });
});

// ── CAMPAÑAS DE LLAMADAS: la mañana en tres pasadas (09:00 / 11:00 / 12:00) ──
// La 1 llama a los que no se han conectado; la 2 insiste sobre los etiquetados
// (con su responsable) y verifica los "confirma que sale ya"; la 3 es el
// repaso. Con las listas de activos, justificados por tipo y la lista roja.
router.get('/campanas', (req, res) => {
  // DOS VISTAS de la misma cosa. El gestor ve la operativa (la gente, a quién
  // llamar); admin y desarrollador entran al INFORME: cuántos llamados, cuántos
  // contactados, por quién — cómo va el día, no la lista de gente. El informe
  // enlaza a la vista de gestor (?vista=gestor) para cuando quieran bajar.
  const esAdmin = ['superadmin', 'desarrollador'].includes((req.usuario || {}).rol);
  const vista = esAdmin && req.query.vista !== 'gestor' ? 'controlCampanasInforme' : 'controlCampanas';
  res.render(vista, {
    titulo: 'Control · Campañas',
    seccion: 'control',
    layout: 'layout-gestion',
    esAdmin,
    resultadosLlamada: llamadas.RESULTADOS,
    catalogoLlamada: llamadas.CATALOGO,
    tiposJ: require('../services/repo/justificantes').TIPOS_J,
  });
});

// Las campañas van POR TURNO (?turno=dia|noche); sin él decide el reloj.
const turnoCampana = q => (q === 'dia' || q === 'noche' ? q : undefined);

// El informe: el estado de las campañas (números, no gente) + las cuentas de
// llamadas del día por campaña y por agente, del turno que se mire.
router.get('/api/campanas-informe', async (req, res) => {
  try {
    const dia = ISO.test(req.query.dia || '') ? req.query.dia : llamadas.diaOperativoHoy();
    const estado = await require('../services/repo/campanas').estado({ dia, turno: turnoCampana(req.query.turno) });
    // Las cuentas, del turno que el estado eligió (pedido o por reloj).
    const stats = await llamadas.estadisticasHoy(dia, estado.turno);
    res.json({ status: 'ok', ...estado, estadisticas: stats });
  } catch (e) {
    console.error('❌ [Control] /api/campanas-informe:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

router.get('/api/campanas', async (req, res) => {
  try {
    const dia = ISO.test(req.query.dia || '') ? req.query.dia : undefined;
    res.json({ status: 'ok', ...(await require('../services/repo/campanas').estado({ dia, turno: turnoCampana(req.query.turno) })) });
  } catch (e) {
    console.error('❌ [Control] /api/campanas:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Los datos del cockpit (JSON). El front lo refresca solo cada pocos segundos.
router.get('/api/directo', async (req, res) => {
  try {
    // UNA sola jornada para todo: el plan, la actividad, las llamadas y las J.
    // Antes el cockpit iba por fecha de calendario y las llamadas por jornada
    // operativa, y entre las 00:00 y las 05:00 se pintaban badges del lunes
    // sobre el plan del martes.
    const dia = ISO.test(req.query.dia || '') ? req.query.dia : llamadas.diaOperativoHoy();
    const base = await enDirecto({ dia });
    // Las llamadas hechas y los justificantes puestos EN ESTA JORNADA: es lo que
    // evita que dos operadores llamen dos veces al mismo conductor.
    const [llam, justis] = await Promise.all([
      llamadas.resumenHoy(dia).catch(() => ({})),
      llamadas.justificadosHoy(dia).catch(() => ({})),
    ]);
    res.json({ status: 'ok', ...base, llamadas: llam, justificados: justis });
  } catch (error) {
    console.error('❌ [Control] /api/directo:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── HISTÓRICO ───────────────────────────────────────────────────────────────
// Lo que pasó un día y lo que se hizo con ello: quién no salió, qué alertas
// levantó cada uno, a quién se llamó, qué contestó y qué horas se justificaron.
// Sustituye al histórico de partes de Flota Viva, que contaba las incidencias
// de un sistema de alertas de vehículo apagado desde el 08/09.
router.get('/historico', (req, res) => {
  res.render('controlHistorico', {
    titulo: 'Control · Histórico', seccion: 'control', layout: 'layout-gestion',
    hoy: llamadas.diaOperativoHoy(),
  });
});

router.get('/api/historico', async (req, res) => {
  try {
    const parte = await require('../services/repo/historicoControl').parte(req.query.dia);
    res.json({ status: 'ok', ...parte });
  } catch (error) {
    console.error('❌ [Control] /api/historico:', error.stack || error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// EL INFORME. Un día por defecto; con ?desde=&hasta= apila varios en las mismas
// hojas con la fecha delante (para la tabla dinámica del mes).
//
// El tope de días NO es capricho: cada día recalcula el cockpit entero contra el
// núcleo (unos 5 s), así que un mes de una sentada serían dos minutos y medio de
// petición colgada. Se baja por semanas.
const MAX_DIAS_INFORME = 7;
router.get('/historico/excel', async (req, res) => {
  try {
    const repo = require('../services/repo/historicoControl');
    const hoy = llamadas.diaOperativoHoy();
    const desde = ISO.test(req.query.desde || '') ? req.query.desde
      : (ISO.test(req.query.dia || '') ? req.query.dia : hoy);
    const hasta = ISO.test(req.query.hasta || '') ? req.query.hasta : desde;
    if (hasta < desde) throw new Error('El "hasta" es anterior al "desde"');

    // Se camina el calendario (no se restan bloques de 24 h: el día del cambio
    // de hora tiene 23 o 25 y la resta se salta una jornada).
    const dias = [];
    for (let d = desde; d <= hasta && dias.length < MAX_DIAS_INFORME; ) {
      dias.push(d);
      const [y, m, dd] = d.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, dd, 12) + 86400000);
      d = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    }

    // De uno en uno: cada parte ya paraleliza sus consultas por dentro y
    // lanzarlos todos a la vez ahogaría el pool.
    const partes = [];
    for (const d of dias) partes.push(await repo.parte(d));

    const libro = await require('../services/historicoControlExcel').generar(partes);
    const total = partes.reduce((a, p) => ({
      llamadas: a.llamadas + p.resumen.llamadas,
      noSalieron: a.noSalieron + p.resumen.noSalieron,
      alertas: a.alertas + p.conductores.reduce((n, c) => n + c.alertas.length, 0),
    }), { llamadas: 0, noSalieron: 0, alertas: 0 });
    console.log(`📊 [Control] histórico (Excel) ${dias[0]}→${dias[dias.length - 1]}: ` +
      `${total.noSalieron} no salieron · ${total.alertas} alertas · ${total.llamadas} llamadas`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="control-historico-${dias[0]}` +
      (dias.length > 1 ? `-a-${dias[dias.length - 1]}` : '') + '.xlsx"');
    res.send(libro);
  } catch (error) {
    console.error('❌ [Control] /historico/excel:', error.stack || error.message);
    res.status(400).json({ status: 'error', msg: error.message });
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
// Solo descargables (Excel y PDF): reporte de horas + Sankey, reporte por turnos,
// turnos para imprimir y la parrilla del planificador. Sin listas en pantalla.
router.get('/reportes', (req, res) => {
  res.render('reportes', { titulo: 'Control · Reportes', seccion: 'control', layout: 'layout-gestion' });
});

// El "Tablero clásico" (leía las horas de la hoja Datos_API) se RETIRÓ: manda el
// cockpit "En directo" (PostgreSQL) y lo exportable vive en Reportes. Las dos
// listas en pantalla que tenía Reportes ("Quién sale — para llamar" y "Control
// del día") se quitaron el 07/09/2026: Reportes es SOLO descargables; lo que se
// mira en vivo está en el cockpit, con el telefonito y la J al lado de cada uno.
// Con el tablero se fueron también sus rutas huérfanas: el POST /excel (exportaba
// filas que ya no mandaba nadie), el POST /enviar-ws (mandaba hasta 200
// plantillas de WhatsApp a los números que llegaran en el cuerpo, sin ningún
// botón detrás), y /justificar + /justificantes por NOMBRE (la J va por id
// desde el cockpit y desde la bitácora).

// El PDF de asistencia: quién faltó y cuántas veces, más la plantilla entera por
// promedio. Por defecto, del día 1 del mes HASTA AYER — la jornada de hoy no ha
// terminado y quien entra a las 17:00 aún no ha faltado a nada.
router.get('/asistencia/pdf', async (req, res) => {
  try {
    const asistencia = require('../services/repo/asistencia');
    const datos = await asistencia.faltas({ desde: req.query.desde, hasta: req.query.hasta });
    const pdf = await require('../services/asistenciaPdf').generar(datos);
    console.log(`📄 [Control] asistencia ${datos.desde}→${datos.hasta}: ` +
      `${datos.reincidentes.length} con faltas de ${datos.todos.length}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="asistencia-${datos.desde}-a-${datos.hasta}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('❌ [Control] /asistencia/pdf:', error.stack || error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// El mismo reporte en Excel: es el que se usa de verdad, porque se puede ordenar,
// filtrar por turno y mandarle a cada jefe su trozo. El PDF es para imprimirlo.
router.get('/asistencia/excel', async (req, res) => {
  try {
    const asistencia = require('../services/repo/asistencia');
    const datos = await asistencia.faltas({ desde: req.query.desde, hasta: req.query.hasta });
    const libro = await require('../services/asistenciaExcel').generar(datos);
    console.log(`📊 [Control] asistencia (Excel) ${datos.desde}→${datos.hasta}: ` +
      `${datos.reincidentes.length} con faltas de ${datos.todos.length}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="asistencia-${datos.desde}-a-${datos.hasta}.xlsx"`);
    res.send(libro);
  } catch (error) {
    console.error('❌ [Control] /asistencia/excel:', error.stack || error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Las fechas por defecto, para que la tarjeta las enseñe ya puestas.
router.get('/asistencia/periodo', (req, res) =>
  res.json({ status: 'ok', ...require('../services/repo/asistencia').periodoPorDefecto() }));

// ── Auditoría de los lunes · SIN TARJETA, a propósito ───────────────────────
// Cuatro hojas —resumen, por conductor, por matrícula y el detalle de faltas y
// justificantes— de los N últimos lunes ya cerrados: quién debía salir, quién
// salió, cuántas horas hizo y, si no salió, por qué.
//
// Se pidió como un vistazo puntual, no como un reporte de cada semana, así que
// NO tiene botón en /control/reportes: una tarjeta más en esa pantalla sería
// estorbo para algo que casi nunca se va a pulsar. Se baja por URL cuando haga
// falta y el día que se quiera fija, la tarjeta son diez líneas de EJS.
//
//   /control/auditoria-lunes/excel            → los 4 últimos lunes
//   /control/auditoria-lunes/excel?lunes=8    → los 8 últimos (máximo 12)
router.get('/auditoria-lunes/excel', async (req, res) => {
  try {
    const datos = await require('../services/repo/auditoriaLunes').informe({ lunes: req.query.lunes });
    const libro = await require('../services/auditoriaLunesExcel').generar(datos);
    console.log(`📊 [Control] auditoría de lunes ${datos.dias.join(', ')}: ` +
      `${datos.conductores.length} conductores · ${datos.totales.faltas} faltas · ` +
      `${datos.detalle.length} casos a mirar`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="auditoria-lunes-${datos.dias[0]}-a-${datos.dias[datos.dias.length - 1]}.xlsx"`);
    res.send(libro);
  } catch (error) {
    console.error('❌ [Control] /auditoria-lunes/excel:', error.stack || error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// ── Llamadas de seguimiento (el "telefonito" de En directo) ─────────────────
// Cada pulsación apunta la llamada en PostgreSQL (la verdad: quién, cuándo, turno
// y resultado) y la ESPEJA en la hoja del call center como llamada saliente de
// Asistencia · Conexión. Si la hoja no responde, la traza de aquí no se pierde.
router.post('/api/llamada', async (req, res) => {
  try {
    const b = req.body || {};
    const u = req.usuario || {};
    const r = await llamadas.registrar({
      conductorId: b.conductorId, turno: b.turno, resultado: b.resultado, nota: b.nota,
      // El tipo (taller, rrhh, tráfico…) y lo que contestó de CADA alerta.
      tipo: b.tipo, alertas: b.alertas,
      // De dónde viene la llamada: 'control' (el cockpit) o 'campana1/2/3'. Es
      // lo que luego permite saber en qué pasada se etiquetó a cada uno.
      origen: /^campana[123]$/.test(b.origen || '') ? b.origen : 'control',
      usuarioId: u.id || await actor.idDe(req),
      // La jornada que está mirando quien llama, para que la llamada caiga en la
      // misma carta donde se apuntó (de madrugada no es la fecha de hoy).
      dia: ISO.test(b.dia || '') ? b.dia : undefined,
    });
    let enCallCenter = false;
    try {
      const agente = `${u.nombre || ''} ${u.apellidos || ''}`.trim() || u.email || '';
      await callCenter.registrar({
        direccion: 'saliente',
        conductor: b.conductor || ('#' + b.conductorId),
        telefono: b.telefono || '', matricula: b.matricula || '',
        turno: b.turno === 'noche' ? 'Noche' : b.turno === 'dia' ? 'Día' : '',
        cluster: 'Asistencia', subcluster: 'Conexión', motivo: 'No se ha conectado a su puesto',
        resultado: b.resultado, estado: 'resuelta',
        notas: ('Seguimiento desde Control. ' + (b.nota || '')).trim(),
      }, agente);
      enCallCenter = true;
    } catch (e) {
      console.error('⚠️ [Control] la llamada no llegó al call center (queda en PG):', e.message);
    }
    console.log(`📞 [Control] Llamada apuntada · conductor ${b.conductorId} · ${b.resultado || 'sin resultado'} · ${(req.usuario || {}).nombre || ''}`);
    res.json({ status: 'ok', ...r, enCallCenter });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Las llamadas de un rango de días (la lista "Llamadas de seguimiento" del Histórico).
router.get('/api/llamadas', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await llamadas.listar({ desde: req.query.desde, hasta: req.query.hasta })) });
  } catch (e) {
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Justificar DESDE EL COCKPIT, por conductor_id y para la jornada operativa en
// curso: horas que se justifican + motivo, con el usuario que lo hizo. La carta
// enseña luego "J · X h · quién", que es lo que le dice al segundo operador que
// no hace falta volver a llamar.
router.post('/api/justificar-directo', async (req, res) => {
  try {
    const b = req.body || {};
    const dia = ISO.test(b.dia || '') ? b.dia : llamadas.diaOperativoHoy();
    const r = await repoJust.guardarPorId({
      conductorId: b.conductorId, diaIso: dia,
      horas: horasLimpias(b.horas),
      observacion: b.observacion,
      tipo: b.tipo,
      usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req),
    });
    console.log(`📝 [Control] J en directo · ${dia} · conductor ${r.conductorId} (${b.horas || 'sin'} h) · ${(req.usuario || {}).nombre || ''}`);
    res.json({ status: 'ok', dia, ...r });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
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
// LA CASCADA: el mismo dato que el Sankey, contado como una cuenta de
// resultados. Se hizo porque dirección no leía el Sankey —hay que explicar cómo
// se sigue una cinta de grosor variable— y un gráfico que hay que explicar no
// sirve para una reunión. El Sankey se queda ahí abajo para quien lo prefiera.
router.get('/cascada/pdf', async (req, res) => {
  try {
    const key = [1, 2, 3].includes(Number(req.query.dia)) ? Number(req.query.dia) : 1;
    const { Y, M, D, str: fecha, idx } = justificantes.fechaDeClave(key);
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    await require('../services/flotaViva/db').preparar();
    const s = await require('../services/flotaViva/rutas').sankeyFlota(iso);
    const diaSem = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][idx];
    const pdf = await require('../services/kmCascadaPdf').generarPdfCascada({
      titulo: `${diaSem} ${fecha} · jornada completa`,
      subtitulo: 'Cada kilómetro que rodó la flota, repartido por lo que estaba haciendo el conductor en ese momento.',
      tramos: s.tramos, matriculas: s.matriculas,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="km-cascada-${fecha.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('❌ [Control] /cascada/pdf:', e.stack || e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

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
      // BOLT en vivo marca "en viaje" desde que acepta hasta que deja al
      // pasajero: la ida a recoger va DENTRO de ese km, no separada. Ponía
      // "Con pasajero · 0 de camino", que se leía como que nadie fue a recoger.
      etiquetas: { totalPasajero: 'En viaje (con pasajero o de camino)' },
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

// REPORTE POR TURNOS (5-5) en Excel: quién rodó de 05:00→17:00 (día) y de
// 17:00→05:00 (noche), con horas, matrícula y los NN incluidos. Del núcleo (fv_*),
// no de las hojas. Es el reporte del control antiguo, ahora fiable.
router.get('/reporte-turnos/excel', async (req, res) => {
  try {
    const rt = require('../services/reporteTurnos');
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(req.query.dia || '') ? req.query.dia : hoyMadrid();
    const reporte = await rt.datos(dia);
    const buffer = await rt.excelTurnos(reporte);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_turnos_${dia}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    console.error('❌ [Control] /reporte-turnos/excel:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
