const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { TIPOS, UMBRAL, MAX_DIAS, leerAlertas, listarSetups } = require('../services/mapon');
const auditoria = require('../services/auditoriaFlota');
const vivo = require('../services/auditoriaVivo');
const { cargarAuditoria } = auditoria;

router.get('/', (req, res) => {
  res.render('operaciones', {
    titulo: 'Alertas Mapon', seccion: 'operaciones', layout: 'layout-gestion',
    tipos: TIPOS, umbral: UMBRAL, maxDias: MAX_DIAS
  });
});

router.get('/api/alertas', async (req, res) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const r = await leerAlertas({ desde, hasta, tipo });
    console.log(`🛰️  [OPERACIONES] ${r.alertas.length} alertas (${tipo || 'todas'}) ${desde || '-7d'} → ${hasta || 'hoy'}`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/alertas:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Diagnóstico: con qué límite está avisando Mapon ahora mismo.
router.get('/api/setups', async (req, res) => {
  try {
    res.json({ status: 'ok', setups: await listarSetups() });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/setups:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// ── Auditoría de flota: KM (Mapon vs BOLT) + repostajes, con histórico en Sheet ──

router.get('/auditoria', (req, res) => {
  res.render('auditoriaFlota', {
    titulo: 'Auditoría de flota', seccion: 'auditoria', layout: 'layout-gestion',
    maxDias: MAX_DIAS
  });
});

// Datos de la auditoría del rango (se sirven del histórico; solo hoy+ayer tocan las APIs).
router.get('/api/auditoria', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const r = await cargarAuditoria({ desde, hasta });
    console.log(`📊 [OPERACIONES] auditoría: ${r.km.length} matrículas · ${r.eventos.length} repostajes · ` +
      `${r.dias.length} días · ${r.refrescados} refrescados`);
    res.json({ status: 'ok', ...r });
  } catch (error) {
    console.error('❌ [OPERACIONES] /api/auditoria:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

// Procesa (o reprocesa) un rango de días: es PESADO — una llamada a Mapon por coche y
// día —, así que corre en segundo plano y el panel sondea el progreso. Lo normal es que
// lo haga el cron de las 5am; esto es para backfill o para rehacer un día concreto.
router.post('/auditoria/procesar', (req, res) => {
  try {
    const b = req.body || {};
    if (auditoria.progreso().activo) return res.status(409).json({ status: 'error', msg: 'Ya hay un procesado en marcha' });
    // Se admite la LISTA de días pendientes (no tienen por qué ser contiguos): así no
    // se reprocesan de balde los días buenos que haya en medio.
    auditoria.procesarRango({ desde: b.desde, hasta: b.hasta, dias: b.dias })
      .catch(e => console.error('❌ [AUDITORÍA] procesar:', e.message));
    res.json({ status: 'ok', msg: 'Procesado iniciado' });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

router.get('/auditoria/procesar/estado', (req, res) => res.json({ status: 'ok', progreso: auditoria.progreso() }));

// Parada de emergencia del backfill. Un procesado largo consume mucha cuota de Google
// y puede dejar sin servicio al resto del ERP (el login también lee de Sheets); esto lo
// corta sin tener que reiniciar. Se acepta por GET para poder pararlo desde el navegador.
const pararAuditoria = (req, res) => res.json({ status: 'ok', ...auditoria.detener() });
router.post('/auditoria/procesar/detener', pararAuditoria);
router.get('/auditoria/procesar/detener', pararAuditoria);

// ── Diagnóstico del fichaje: ¿deja Mapon crear/asignar conductores con esta clave? ──
// Solo lectura por defecto. Con ?crear=NOMBRE intenta dar de alta ese conductor y
// devuelve la respuesta CRUDA de Mapon, que es lo único que dice el motivo real.
// ── Auditoría EN VIVO: coches planificados que ruedan estando en descanso ──
router.get('/vivo', (req, res) => {
  res.render('auditoriaVivo', {
    titulo: 'Auditoría en vivo',
    seccion: 'vivo',
    layout: 'layout-gestion'
  });
});

router.get('/api/vivo', (req, res) => res.json({ status: 'ok', ...vivo.estado() }));

// Fuerza una vuelta sin esperar al temporizador.
router.post('/api/vivo/refrescar', async (req, res) => {
  try { await vivo.pasada(); res.json({ status: 'ok', ...vivo.estado() }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Justificar cierra el caso dejando dicho por qué (el motivo es obligatorio).
router.post('/api/vivo/justificar', async (req, res) => {
  // El usuario de la sesión va en req.usuario (lo deja sesion.identificar), no en req.session.
  const quien = req.usuario ? (req.usuario.nombre || req.usuario.email || '') : '';
  const b = req.body || {};
  const r = await vivo.justificar(b.clave, b.motivo, quien);
  if (!r.ok) return res.status(400).json({ status: 'error', msg: r.msg });
  res.json({ status: 'ok', ...vivo.estado() });
});

// Relee el expediente de la hoja y reemplaza lo que hay en memoria. Es lo que
// hay que llamar si alguien edita o borra filas a mano en AUDITORIA_VIVO.
router.post('/api/vivo/recargar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await require('../services/auditoriaVivo').recargarExpediente()) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Borra el expediente entero (memoria + hoja). Sin vuelta atrás.
router.post('/api/vivo/vaciar', async (req, res) => {
  try { res.json({ status: 'ok', ...(await require('../services/auditoriaVivo').vaciarExpediente()) }); }
  catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.get('/fichaje/diagnostico', async (req, res) => {
  const mapon = require('../services/mapon');
  const q = req.query || {};
  const out = { clave: !!process.env.MAPON_API_KEY };
  let lista = [];
  try {
    lista = await mapon.listarConductores();
    out.conductores = lista.length;
  } catch (e) { out.errorLista = e.message; }

  // ?buscar=Claude → conductores cuyo nombre coincide (sirve para ver DUPLICADOS)
  const buscar = (q.buscar || '').toString().trim().toLowerCase();
  if (buscar) {
    out.coincidencias = lista
      .map(d => ({ id: d.id || d.driver_id, nombre: `${d.name || ''} ${d.surname || ''}`.trim(), tel: d.phone || '' }))
      .filter(d => d.nombre.toLowerCase().includes(buscar));
  }

  // ?matricula=0417MMZ → resuelve la unidad y dice qué conductor tiene puesto ahora
  let unitId = q.unit ? String(q.unit) : null;
  if (q.matricula) {
    const u = await mapon.unidadPorMatricula(q.matricula).catch(e => { out.errorUnidad = e.message; return null; });
    if (u) { unitId = String(u.unitId); out.unidad = { unitId: u.unitId, matricula: u.matricula, vehiculo: u.vehiculo }; }
    else out.unidad = null;
  }
  if (unitId) {
    try { out.conductoresDeLaUnidad = await mapon.conductoresDeUnidad(unitId); }
    catch (e) { out.errorConductoresUnidad = e.message; }
  }

  // ?reles=1 → ¿tienen los coches relé de corte de motor instalado? (solo lectura)
  if (q.reles) {
    try { out.reles = await mapon.relesDeFlota(); }
    catch (e) { out.errorReles = e.message; }
  }

  // ?crudo=1 con ?matricula= → qué devuelve Mapon TAL CUAL, probando varias formas de
  // pedir los extras. Sirve para distinguir "no tiene relé" de "no lo pedimos bien".
  if (q.crudo && unitId) {
    try { out.crudo = await mapon.crudoUnidad(unitId); }
    catch (e) { out.errorCrudo = e.message; }
  }

  // ?comandos=1 con ?matricula= → CATÁLOGO de comandos de esa unidad (unit_commands,
  // la vía que Mapon confirmó por correo el 18/08/2026). Solo lectura: no toca el
  // coche. Es el primer paso — hasta no ver los nombres reales no se manda nada.
  if (q.comandos && unitId) {
    try { out.comandos = await mapon.comandosDisponibles(unitId); }
    catch (e) { out.errorComandos = e.message; }
  }

  // ?ejecutar=<nombre> con ?matricula= → EJECUTA ese comando en el coche.
  // OJO: esto SÍ actúa sobre el vehículo. Se comprueba antes que el comando exista
  // en el catálogo de esa unidad; si no, se devuelve la lista real y no se manda nada.
  if (q.ejecutar && unitId) {
    try {
      const info = await mapon.relesDeUnidad(unitId).catch(() => null);
      if (info && info.enMarcha) {
        out.errorEjecutar = `Coche en marcha (${info.velocidad} km/h): no se manda nada`;
      } else {
        out.antesDeEjecutar = info;
        out.ejecucion = await mapon.ejecutarComandoSeguro({ unitId, command: String(q.ejecutar) });
      }
    } catch (e) { out.errorEjecutar = e.message; }
  }

  // ?probarrele=1 con ?matricula= → prueba el corte por POST y por GET, más una ruta
  // inventada como control. Es la evidencia para saber si el 1006 es de PERMISO o si
  // estamos mandando mal la petición (no cambia nada en el coche si no tiene permiso).
  if (q.probarrele && unitId) {
    try {
      const info = await mapon.relesDeUnidad(unitId);
      const rele = mapon.releDeCorte(info);
      if (!rele) out.errorProbar = 'Ese vehículo no reporta relé';
      else if (info.enMarcha) out.errorProbar = `Coche en marcha (${info.velocidad} km/h): no se prueba`;
      else {
        out.pruebaRele = await mapon.probarRele({
          unitId, relayId: rele.relay_id, estado: String(q.probarrele) === '1' ? 0 : 1
        });
      }
    } catch (e) { out.errorProbar = e.message; }
  }

  // ?rele=0|1 con ?matricula= → PRUEBA el corte de motor en UN coche y confirma el
  // estado real (change_relay solo dice que la orden salió). 0/1 lo decide quien llama:
  // qué valor bloquea y cuál libera se comprueba mirando el coche, no adivinando.
  if (q.rele !== undefined && unitId) {
    try {
      const info = await mapon.relesDeUnidad(unitId);
      out.antesDeTodo = info;
      const rele = mapon.releDeCorte(info);
      if (!rele) out.errorRele = 'Ese vehículo no reporta ningún relé';
      else if (info.enMarcha) out.errorRele = `El coche está EN MARCHA (${info.velocidad} km/h): no se toca el relé`;
      else {
        out.rele = await mapon.cambiarReleConfirmado({
          unitId, relayId: rele.relay_id, estado: String(q.rele) === '1'
        });
      }
    } catch (e) { out.errorRele = e.message; }
  }

  // ?repaso=1 → SIMULA el repaso de bloqueos: dice a qué coches se les cortaría el
  // motor y por qué se deja fuera a los demás, sin tocar ninguno. Es lo que hay que
  // mirar ANTES de encender FICHAJE_BLOQUEO_MOTOR: si aquí aparece un coche que
  // está trabajando, la regla está mal y no se enciende nada.
  //
  // ?repaso=aplicar → lo ejecuta de verdad (lo mismo que hace el cron).
  if (q.repaso) {
    try {
      const fj = require('../services/fichaje');
      out.alcance = {
        bloqueoActivo: fj.BLOQUEO_ACTIVO,
        matriculas: fj.MATRICULAS,
        todaLaFlota: fj.TODA_LA_FLOTA,
        alcance: fj.TODA_LA_FLOTA ? 'toda la flota' : 'solo los coches que han pasado por el fichaje',
        telefonos: 'los de FICHAJE_TELEFONOS',
      };
      out.repaso = await fj.repasarBloqueos({ soloMirar: String(q.repaso) !== 'aplicar' });
    } catch (e) { out.errorRepaso = e.message; }
  }

  // ?crear=NOMBRE → lo crea si no existe (o reutiliza el que ya haya con ese nombre)
  const nombre = (q.crear || '').toString().trim();
  if (nombre) {
    const yaEsta = lista.find(d => `${d.name || ''} ${d.surname || ''}`.trim().toLowerCase() === nombre.toLowerCase());
    try {
      let id = yaEsta ? (yaEsta.id || yaEsta.driver_id) : null;
      if (id) out.reutilizado = { id, nombre };
      else {
        const partes = nombre.split(/\s+/);
        id = await mapon.crearConductor({ nombre: partes[0], apellidos: partes.slice(1).join(' ') || '-' });
        out.creado = { id, nombre };
      }
      // ?asignar=1 → prueba la ASIGNACIÓN al coche (la otra mitad del fichaje)
      if (unitId && q.asignar) {
        try {
          await mapon.asignarConductor(id, unitId);
          out.asignado = `driver ${id} → unit ${unitId}`;
          out.compruebaEnUnidad = await mapon.conductoresDeUnidad(unitId).catch(() => null);
        } catch (e) { out.errorAsignar = e.message; }
      }
      // ?soltar=1 → le quita el coche (para dejarlo como estaba)
      if (q.soltar) {
        try { await mapon.desasignarConductor(id); out.desasignado = id; }
        catch (e) { out.errorDesasignar = e.message; }
      }
    } catch (e) { out.errorCrear = e.message; }
  }
  res.json(out);
});

// Excel de la auditoría (mismos datos cacheados): KM (Mapon/BOLT/dif), Repostajes y Ofensores.
// ── Descargas de la auditoría ────────────────────────────────────────────────
// UN EXCEL POR TABLA (no un libro con muchas hojas): cada tabla de la pantalla se
// descarga por separado con todas sus columnas, incluidos los conductores que BOLT vio
// en ese tramo. El Sankey se descarga en PDF (vectorial, ver services/auditoriaPdf.js).

const diaES = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fecha = iso => ddmm(iso) + '/' + iso.slice(0, 4);
const r1 = v => Math.round(v * 10) / 10;

// Nombre corto de cada tramo, para hoja y fichero.
const NOMBRE_TRAMO = { dia: 'turno-dia', noche: 'turno-noche', manana: 'mitad-00-12', tarde: 'mitad-12-24', completo: 'dia-natural' };
const TITULO_TRAMO = { dia: 'Turno de día', noche: 'Turno de noche', manana: 'Primera mitad 00-12', tarde: 'Segunda mitad 12-24', completo: 'Día natural' };

/** Columnas del detalle de un tramo: exactamente lo que muestra la tabla en pantalla. */
const COLS_TRAMO = [
  { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Vehículo', key: 'veh', width: 20 },
  { header: 'Conductores (BOLT)', key: 'cond', width: 38 },
  { header: 'KM total (Mapon)', key: 'mapon', width: 16 },
  { header: 'Con pasajero', key: 'pas', width: 13 }, { header: 'Ida a recoger', key: 'ida', width: 13 },
  { header: 'Espera (disponible)', key: 'esp', width: 18 },
  { header: 'DESCANSO (ocupado)', key: 'des', width: 19 }, { header: 'FUERA (app cerrada)', key: 'fue', width: 19 },
  { header: 'KM no disponible', key: 'nod', width: 17 }, { header: '% no disponible', key: 'pctn', width: 15 },
  { header: '% con pasajero', key: 'pctp', width: 14 },
  { header: 'h con pedido', key: 'hped', width: 12 }, { header: 'h espera', key: 'hesp', width: 10 },
  { header: 'h DESCANSO', key: 'hdes', width: 12 }, { header: 'h app cerrada', key: 'hfue', width: 13 },
  { header: 'KM facturado BOLT', key: 'bolt', width: 17 }, { header: 'Viajes', key: 'viajes', width: 8 }
];

/** Remata una hoja: cabecera en negrita, panel congelado y autofiltro. */
function rematar(ws, nCols) {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: nCols } };
}

async function enviarLibro(res, wb, nombre) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

/**
 * Excel de UNA tabla. ?tabla= tramo (dia|noche|manana|tarde|completo) · resumen-turnos ·
 * detalle-dia · repostajes · ofensores. Por defecto, el turno de día.
 */
router.get('/auditoria/excel', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const tabla = (req.query.tabla || 'dia').toString();
    const r = await cargarAuditoria({ desde, hasta });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tibus Luxury';
    const sufijo = `${diaES(r.desde)}-a-${diaES(r.hasta)}`;

    // ── Detalle de un tramo ──
    if (NOMBRE_TRAMO[tabla]) {
      const filas = tabla === 'completo' ? r.km : ((r.segmentos && r.segmentos[tabla]) || []);
      const ws = wb.addWorksheet(TITULO_TRAMO[tabla].slice(0, 31));
      ws.columns = COLS_TRAMO;
      [...filas].sort((a, b) => b.totalNoDisp - a.totalNoDisp).forEach(k => ws.addRow({
        mat: k.matricula, veh: k.vehiculo, cond: (k.conductores || []).join(' · '),
        mapon: k.totalMapon, pas: k.totalPasajero, ida: k.totalIda, esp: k.totalEspera,
        des: k.totalDescanso, fue: k.totalFuera, nod: k.totalNoDisp,
        pctn: k.pctNoDisp == null ? '' : k.pctNoDisp / 100,
        pctp: k.pctPasajero == null ? '' : k.pctPasajero / 100,
        hped: k.hPedido, hesp: k.hEspera, hdes: k.hDescanso, hfue: k.hFuera,
        bolt: k.totalBolt, viajes: k.viajesBolt
      }));
      ws.getColumn('pctn').numFmt = '0%'; ws.getColumn('pctp').numFmt = '0%';
      rematar(ws, COLS_TRAMO.length);
      return enviarLibro(res, wb, `auditoria-${NOMBRE_TRAMO[tabla]}-${sufijo}`);
    }

    // ── Resumen de turnos: día y noche uno al lado del otro ──
    if (tabla === 'resumen-turnos') {
      const ws = wb.addWorksheet('Resumen turnos');
      ws.columns = [
        { header: 'Matrícula', key: 'mat', width: 14 },
        { header: 'DÍA · conductores (BOLT)', key: 'dc', width: 34 },
        { header: 'DÍA · KM total', key: 'dkm', width: 14 }, { header: 'DÍA · con pasajero', key: 'dpas', width: 17 },
        { header: 'DÍA · no disponible', key: 'dnd', width: 18 }, { header: 'DÍA · %', key: 'dp', width: 9 },
        { header: 'NOCHE · conductores (BOLT)', key: 'nc', width: 34 },
        { header: 'NOCHE · KM total', key: 'nkm', width: 16 }, { header: 'NOCHE · con pasajero', key: 'npas', width: 19 },
        { header: 'NOCHE · no disponible', key: 'nnd', width: 20 }, { header: 'NOCHE · %', key: 'np', width: 10 },
        { header: 'Consolidado KM', key: 'tkm', width: 15 }, { header: 'Consolidado no disp.', key: 'tnd', width: 19 },
        { header: 'Consolidado %', key: 'tp', width: 14 }
      ];
      const segDia = new Map(((r.segmentos && r.segmentos.dia) || []).map(k => [k.placa, k]));
      const segNoche = new Map(((r.segmentos && r.segmentos.noche) || []).map(k => [k.placa, k]));
      [...new Set([...segDia.keys(), ...segNoche.keys()])].map(p => ({ d: segDia.get(p), n: segNoche.get(p) }))
        .sort((a, b) => (((b.d && b.d.totalNoDisp) || 0) + ((b.n && b.n.totalNoDisp) || 0)) - (((a.d && a.d.totalNoDisp) || 0) + ((a.n && a.n.totalNoDisp) || 0)))
        .forEach(({ d, n }) => {
          const tkm = r1(((d && d.totalMapon) || 0) + ((n && n.totalMapon) || 0));
          const tnd = r1(((d && d.totalNoDisp) || 0) + ((n && n.totalNoDisp) || 0));
          const fila = ws.addRow({
            mat: (d || n).matricula,
            dc: d ? (d.conductores || []).join(' · ') : '', dkm: d ? d.totalMapon : '', dpas: d ? d.totalPasajero : '',
            dnd: d ? d.totalNoDisp : '', dp: d && d.pctNoDisp != null ? d.pctNoDisp / 100 : '',
            nc: n ? (n.conductores || []).join(' · ') : '', nkm: n ? n.totalMapon : '', npas: n ? n.totalPasajero : '',
            nnd: n ? n.totalNoDisp : '', np: n && n.pctNoDisp != null ? n.pctNoDisp / 100 : '',
            tkm, tnd, tp: tkm > 0 ? tnd / tkm : ''
          });
          ['dp', 'np', 'tp'].forEach(c => fila.getCell(c).numFmt = '0%');
        });
      rematar(ws, 14);
      return enviarLibro(res, wb, `auditoria-resumen-turnos-${sufijo}`);
    }

    // ── Detalle día a día (para señalar la jornada concreta en una reclamación) ──
    if (tabla === 'detalle-dia') {
      const ws = wb.addWorksheet('Detalle por día');
      ws.columns = [
        { header: 'Día', key: 'dia', width: 12 }, { header: 'Matrícula', key: 'mat', width: 14 },
        { header: 'Conductores (BOLT)', key: 'cond', width: 34 },
        { header: 'KM total', key: 'mapon', width: 10 }, { header: 'Con pasajero', key: 'pas', width: 13 },
        { header: 'Ida a recoger', key: 'ida', width: 13 }, { header: 'Espera', key: 'esp', width: 10 },
        { header: 'DESCANSO', key: 'des', width: 11 }, { header: 'FUERA', key: 'fue', width: 10 },
        { header: 'h DESCANSO', key: 'hdes', width: 12 }, { header: 'h app cerrada', key: 'hfue', width: 13 },
        { header: 'Facturado BOLT', key: 'bolt', width: 14 }
      ];
      r.km.forEach(k => r.dias.forEach(d => {
        const x = k.dias[d]; if (!x) return;
        ws.addRow({ dia: fecha(d), mat: k.matricula, cond: (x.conductores || []).join(' · '), mapon: x.mapon,
          pas: x.pasajero, ida: x.ida, esp: x.espera, des: x.descanso, fue: x.fuera,
          hdes: x.hDescanso, hfue: x.hFuera, bolt: x.bolt });
      }));
      rematar(ws, 12);
      return enviarLibro(res, wb, `auditoria-detalle-por-dia-${sufijo}`);
    }

    // ── Repostajes y caídas de nivel ──
    if (tabla === 'repostajes') {
      const ws = wb.addWorksheet('Repostajes y caídas');
      ws.columns = [
        { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 8 },
        { header: 'Matrícula', key: 'mat', width: 14 }, { header: 'Evento', key: 'tipo', width: 12 },
        { header: 'Litros', key: 'litros', width: 9 }, { header: 'Nivel antes', key: 'antes', width: 11 },
        { header: 'Lugar', key: 'lugar', width: 45 }, { header: 'Fuente', key: 'fuente', width: 8 }
      ];
      r.eventos.forEach(e => ws.addRow({
        fecha: fecha(e.dia), hora: e.hora, mat: e.matricula,
        tipo: e.tipo === 'repostaje' ? 'Repostaje' : 'Caída', litros: e.litros,
        antes: e.nivelAntes, lugar: e.direccion || (e.lat != null ? `${e.lat}, ${e.lng}` : ''), fuente: e.fuente
      }));
      rematar(ws, 8);
      return enviarLibro(res, wb, `auditoria-repostajes-${sufijo}`);
    }

    // ── Top ofensores (los tres bloques) ──
    if (tabla === 'ofensores') {
      const ws = wb.addWorksheet('Ofensores');
      const negritas = [];
      const bloque = (titulo, cabecera, filas) => {
        negritas.push(ws.addRow([titulo]).number);
        negritas.push(ws.addRow(cabecera).number);
        filas.forEach(f => ws.addRow(f));
        ws.addRow([]);
      };
      bloque('TOP 5 — más KM sin estar disponible (descanso + app cerrada)',
        ['Matrícula', 'KM no disponible', '% del total', 'de ellos DESCANSO', 'de ellos app cerrada', 'KM total'],
        r.ofensores.fuera.map(o => [o.matricula, o.noDisp, o.pct == null ? '' : o.pct + '%', o.descanso, o.fuera, o.mapon]));
      bloque('TOP 5 — más HORAS marcado "ocupado" (descanso)',
        ['Matrícula', 'Horas en descanso', 'KM rodados en descanso'],
        r.ofensores.descanso.map(o => [o.matricula, o.horas, o.km]));
      bloque('TOP 5 — más repostan', ['Matrícula', 'Litros', 'Repostajes'],
        r.ofensores.repostaje.map(o => [o.matricula, o.litros, o.veces]));
      ws.getColumn(1).width = 18;
      negritas.forEach(n => ws.getRow(n).font = { bold: true });
      return enviarLibro(res, wb, `auditoria-ofensores-${sufijo}`);
    }

    res.status(400).json({ status: 'error', msg: `Tabla desconocida: ${tabla}` });
  } catch (error) {
    console.error('❌ [OPERACIONES] /auditoria/excel:', error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

/** PDF del Sankey. ?flujo=turnos (05-17/17-05) o ?flujo=mitades (00-12/12-24). */
router.get('/auditoria/pdf', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const flujo = (req.query.flujo || 'turnos').toString();
    const r = await cargarAuditoria({ desde, hasta });
    const { generarPdfFlujo, totalesDe } = require('../services/auditoriaPdf');

    const defs = flujo === 'mitades'
      ? { titulo: 'Flujo de kilómetros · día natural partido a mediodía',
          subtitulo: 'Día de 00:00 a 24:00, dividido en primera mitad (00–12) y segunda mitad (12–24).',
          tramos: [
            { seg: 'manana', txt: '00:00 - 12:00', color: 'gold' },
            { seg: 'tarde', txt: '12:00 - 24:00', color: 'azul' }
          ] }
      : { titulo: 'Flujo de kilómetros · por turno',
          subtitulo: 'Turno de día 05:00–17:00 y turno de noche 17:00–05:00 del día siguiente.',
          tramos: [
            { seg: 'dia', txt: 'Turno de día', color: 'gold' },
            { seg: 'noche', txt: 'Turno de noche', color: 'azul' }
          ] };

    const { rgb } = require('pdf-lib');
    const COLOR = { gold: rgb(0.91, 0.72, 0.29), azul: rgb(0.38, 0.65, 0.98) };
    const tramos = defs.tramos.map(t => ({
      txt: t.txt, color: COLOR[t.color], tot: totalesDe((r.segmentos && r.segmentos[t.seg]) || [])
    }));
    const matriculas = new Set(defs.tramos.flatMap(t => (r.segmentos && r.segmentos[t.seg]) || []).map(k => k.placa)).size;

    const pdf = await generarPdfFlujo({
      titulo: defs.titulo, subtitulo: defs.subtitulo,
      rango: `${fecha(diaES(r.desde))} → ${fecha(diaES(r.hasta))}`.replace(/\//g, '/'),
      tramos, matriculas
    });
    const nombre = `flujo-km-${flujo}-${diaES(r.desde)}-a-${diaES(r.hasta)}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('❌ [OPERACIONES] /auditoria/pdf:', error.stack || error.message);
    res.status(400).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
