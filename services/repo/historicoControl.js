// ============================================================
// HISTÓRICO DE CONTROL — qué pasó ese día y qué se hizo
// ============================================================
// Sustituye al histórico de Flota Viva, que contaba los partes de un sistema de
// alertas apagado desde el 08/09. Lo que de verdad hace falta saber al día
// siguiente —y sobre todo a fin de mes— es POR QUÉ no se cumplieron los
// horarios, y eso no vive en las incidencias del coche: vive en la jornada de
// cada persona y en lo que se habló con ella.
//
// Se arma de tres sitios, y ninguno es una foto guardada:
//
//   · EL DÍA        de cada conductor, recalculado con `enDirecto({dia})`: si
//                   salió, cuántas horas hizo, qué alertas levantó. La jornada
//                   ya está cerrada, así que el cálculo es estable.
//   · LAS LLAMADAS  de `llamada_seguimiento` + `llamada_alerta`: quién llamó, a
//                   qué hora, de qué tipo, qué contestó el conductor y —una a
//                   una— qué dijo de CADA alerta.
//   · LAS J         con su estado: presuntas (pendientes), aprobadas (las
//                   únicas que cuentan) y rechazadas, con el motivo del rechazo.
//
// Cruzarlo aquí y no en la pantalla es lo que permite que el Excel y la web
// cuenten exactamente lo mismo.

const db = require('../db');

/** Etiquetas de los grupos de salida, para que el informe se lea sin código. */
const SALIDA = {
  conectado: 'Conectado', salio: 'Salió', descanso: 'En descanso',
  no_salio: 'NO SALIÓ', pendiente: 'No le tocaba aún',
};

/**
 * El nombre FIJO de cada alerta. El chip de la pantalla lleva el número dentro
 * ("14 viajes rechazados"), y eso no se puede agrupar: cada persona tendría su
 * propia categoría. Aquí manda el código.
 */
const ALERTA = {
  km_parado: 'Km rodando fuera de la app',
  j_rechazada: 'Justificación rechazada',
  j_presunta: 'Llega solo con horas presuntas',
  no_llego: 'No llegó a su jornada',
  no_llegara: 'No llegará a su jornada',
  se_fue_pronto: 'Se desconectó antes de tiempo',
  rechazo_directo: 'Viajes rechazados a dedo',
  sin_respuesta: 'Ofertas sin contestar',
  aceptacion_baja: 'Tasa de aceptación baja',
};
const nombreAlerta = (codigo, etq) => ALERTA[codigo] || String(etq || codigo || '');

/** Todas las llamadas de una jornada, con lo que se contestó de cada alerta. */
async function llamadasDelDia(dia) {
  const r = await db.consulta(
    `SELECT l.id, l.conductor_id, l.tipo, l.resultado, l.nota, l.origen, l.turno,
            l.creado_at,
            to_char(l.creado_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
            COALESCE(u.nombre, '(sin usuario)') AS agente,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'alerta', a.alerta, 'etiqueta', a.etiqueta, 'comentario', a.comentario)
                      ORDER BY a.id)
                 FROM llamada_alerta a WHERE a.llamada_id = l.id), '[]'::json) AS alertas
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.dia_operativo = $1::date
      ORDER BY l.creado_at`, [dia]);
  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), hora: x.hora, at: x.creado_at,
    agente: x.agente, tipo: x.tipo || '', resultado: x.resultado || '',
    nota: x.nota || '', origen: x.origen || '', turno: x.turno || '',
    alertas: x.alertas || [],
  }));
}

/**
 * LAS ALERTAS DE FRANJA DE UN DÍA ENTERO, reconstruidas.
 *
 * El cockpit solo sabe de la franja EN CURSO: mirando un día cerrado no hay
 * "ahora" que vigilar, así que sus km rodando parado y sus ofertas sin
 * contestar desaparecían del parte — justo las dos alertas que más falta hacen
 * al día siguiente, cuando toca explicar por qué no se cumplieron los horarios.
 *
 * Aquí se recorren LAS DOS franjas del día, cerradas o no, con la misma
 * consulta que dispara los WhatsApps. Devuelve, por conductor, una alerta por
 * franja y tipo.
 */
async function alertasDeFranja(dia) {
  const AC = require('./alertasControl');
  const cfg = await AC.leerConfig();
  if (cfg.sinTabla) return new Map();
  const franjas = (cfg.franjas || []).map(f => ({ ...f, dia }));
  const listas = await Promise.all(franjas.map(f =>
    AC.candidatos(f).catch(e => { console.error('⚠️ [HISTÓRICO] franja ' + f.codigo + ':', e.message); return []; })));

  const por = new Map();
  franjas.forEach((f, i) => {
    const horas = String(f.ini).padStart(2, '0') + ':00–' + String(f.fin).padStart(2, '0') + ':00';
    listas[i].forEach(c => {
      if (!c.conductorId) return;              // sin ficha no hay a quién llamar
      ['km_parado', 'sin_respuesta'].forEach(tipo => {
        const t = cfg.tipos[tipo];
        const v = c.valores[tipo];
        if (!t || !t.activo || !(v >= t.umbral)) return;
        const k = String(c.conductorId);
        if (!por.has(k)) por.set(k, []);
        por.get(k).push({
          codigo: tipo, tono: 'error', franja: f.codigo, franjaEtiqueta: f.etiqueta,
          etiqueta: tipo === 'km_parado'
            ? String(v).replace('.', ',') + ' km fuera de la app · ' + f.etiqueta
            : v + ' sin contestar · ' + f.etiqueta,
          nombre: ALERTA[tipo],
          valor: v,
          detalle: tipo === 'km_parado'
            ? 'Entre las ' + horas + ' rodó ' + String(v).replace('.', ',') +
              ' km en descanso o desconectado (umbral ' + t.umbral + ').'
            : 'Entre las ' + horas + ' dejó pasar ' + v + ' ofertas sin contestar de ' +
              c.ofertas + ' (umbral ' + t.umbral + ').',
        });
      });
    });
  });
  return por;
}

/**
 * EL PARTE DE UN DÍA.
 *
 * @param {string} dia jornada operativa 'AAAA-MM-DD'
 */
async function parte(dia) {
  const { enDirecto } = require('../flotaViva/directo');
  const llamadasRepo = require('./llamadas');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : llamadasRepo.diaOperativoHoy();

  const [vivo, llamadas, justis, franjas] = await Promise.all([
    enDirecto({ dia: d }).catch(e => { console.error('⚠️ [HISTÓRICO] en directo:', e.message); return null; }),
    llamadasDelDia(d).catch(() => []),
    llamadasRepo.justificadosHoy(d).catch(() => ({})),
    alertasDeFranja(d).catch(e => { console.error('⚠️ [HISTÓRICO] franjas:', e.message); return new Map(); }),
  ]);

  const porT = (vivo && vivo.porTurno) || {};
  // UNA FILA POR PERSONA, no por pestaña.
  //
  // El cockpit pinta a quien dobla en tres sitios (día, noche y TodoTurno) a
  // propósito: cada pestaña es una cola de llamadas. Un informe no: si se
  // vuelcan las tres, ese señor cuenta tres veces en "no salió" y sus rechazos
  // se triplican. Se queda la fila de TodoTurno —que mide la jornada entera, que
  // es lo que de verdad hizo— y si no la hay, la del turno que cubrió.
  const porPersona = new Map();
  ['todoturno', 'dia', 'noche'].forEach(t => (porT[t] || []).forEach(f => {
    if (!f.conductorId) return;
    const k = String(f.conductorId);
    const ya = porPersona.get(k);
    if (!ya) {
      porPersona.set(k, { ...f, turnoPlan: t, turnos: [t],
        avisos: [...(f.avisos || [])], matriculas: [...(f.matriculas || [])] });
      return;
    }
    if (!ya.turnos.includes(t)) ya.turnos.push(t);
    // Las alertas se juntan por si un turno vio algo que el otro no (los avisos
    // de jornada son los mismos, pero los de proyección son de cada ventana).
    (f.avisos || []).forEach(a => { if (!ya.avisos.some(x => x.codigo === a.codigo)) ya.avisos.push(a); });
    (f.matriculas || []).forEach(m => { if (!(ya.matriculas || []).includes(m)) ya.matriculas.push(m); });
  }));
  const filas = [...porPersona.values()];

  const llamPorCond = new Map();
  llamadas.forEach(l => {
    if (!llamPorCond.has(l.conductorId)) llamPorCond.set(l.conductorId, []);
    llamPorCond.get(l.conductorId).push(l);
  });

  const conductores = filas.map(f => {
    const cid = String(f.conductorId);
    const j = justis[cid] || null;
    const a = f.actividad || {};
    const suyas = llamPorCond.get(cid) || [];
    const horasBolt = Math.round(((a.minutos || 0) / 60) * 10) / 10;
    const jAprobadas = j && j.estado === 'aprobada' ? (j.horas || 0) : 0;
    const jPresuntas = j && j.estado === 'pendiente' ? (j.horas || 0) : 0;
    const jRechazadas = (j && j.rechazadas) || [];
    return {
      conductorId: cid,
      conductor: f.conductor,
      telefono: f.telefono || '',
      turno: f.turnos.length > 1 ? 'todoturno' : f.turnoPlan,
      turnoEtiqueta: f.turnos.length > 1 ? 'TodoTurno'
        : (f.turnoPlan === 'noche' ? 'Noche' : f.turnoPlan === 'dia' ? 'Día' : 'TodoTurno'),
      rol: f.rol || '',
      cuadrante: f.cuadrante || '',
      matriculas: (a.matriculas && a.matriculas.length ? a.matriculas : f.matriculas) || [],
      salida: f.salida,
      salidaEtiqueta: SALIDA[f.salida] || f.salida,
      primera: a.primera || null,
      horasBolt,
      // Las horas que CUENTAN (BOLT + J aprobadas) y las que solo serían si se
      // aprueba lo pendiente. Son dos números distintos a propósito.
      horasFirmes: Math.round((horasBolt + jAprobadas) * 10) / 10,
      horasPresuntas: Math.round((horasBolt + jAprobadas + jPresuntas) * 10) / 10,
      km: a.km || 0, kmFuera: a.kmFuera || 0,
      rechazos: f.rechazos || null,
      // Las alertas que levantó ese día, con lo que se contestó de cada una.
      //
      // Las dos de franja vienen de `alertasDeFranja` —las DOS franjas del día,
      // cerradas o no— y no del cockpit, que solo conoce la que está en curso.
      // Por eso se quitan de la lista del cockpit antes de juntarlas: si no,
      // la de la mañana saldría dos veces mientras sigue siendo de hoy.
      alertas: (f.avisos || []).filter(a => !['km_parado', 'sin_respuesta'].includes(a.codigo))
        .concat(franjas.get(cid) || []).map(av => {
        const dicha = suyas.flatMap(l => (l.alertas || [])
          .filter(x => x.alerta === av.codigo)
          .map(x => ({ comentario: x.comentario, hora: l.hora, agente: l.agente })));
        return { codigo: av.codigo, tono: av.tono, etiqueta: av.etq || av.etiqueta,
          nombre: av.nombre || nombreAlerta(av.codigo, av.etq), franja: av.franja || '',
          detalle: av.detalle || '', respuestas: dicha, contestada: dicha.length > 0 };
      }),
      llamadas: suyas,
      justificante: j ? {
        horas: j.horas, estado: j.estado, obs: j.obs, quien: j.quien, tipo: j.tipo,
        aprobadaPor: j.aprobadaPor || '',
      } : null,
      jRechazadas: jRechazadas.map(r => ({
        horas: r.horas, obs: r.obs, motivo: r.motivo, porQuien: r.porQuien, at: r.at,
      })),
    };
  }).sort((x, y) =>
    // Primero lo que no se cumplió, que es de lo que va el parte.
    (Number(y.salida === 'no_salio') - Number(x.salida === 'no_salio')) ||
    (y.alertas.length - x.alertas.length) ||
    x.conductor.localeCompare(y.conductor, 'es'));

  const noSalieron = conductores.filter(c => c.salida === 'no_salio');
  const conAlerta = conductores.filter(c => c.alertas.some(a => a.tono === 'error'));
  const sinAtender = conAlerta.filter(c => c.alertas.some(a => a.tono === 'error' && !a.contestada));

  // Por AGENTE: cuántas llamó, a cuántos distintos y con qué resultados.
  const porAgente = {};
  llamadas.forEach(l => {
    const a = porAgente[l.agente] || (porAgente[l.agente] = {
      agente: l.agente, llamadas: 0, conductores: new Set(), porTipo: {}, alertasContestadas: 0,
    });
    a.llamadas++;
    a.conductores.add(l.conductorId);
    const t = l.tipo || '(sin tipo)';
    a.porTipo[t] = (a.porTipo[t] || 0) + 1;
    a.alertasContestadas += (l.alertas || []).length;
  });
  const agentes = Object.values(porAgente)
    .map(a => ({ ...a, conductores: a.conductores.size }))
    .sort((x, y) => y.llamadas - x.llamadas);

  // Por TIPO de alerta: cuántas saltaron y cuántas se contestaron.
  const porAlerta = {};
  conductores.forEach(c => c.alertas.forEach(a => {
    const x = porAlerta[a.codigo] || (porAlerta[a.codigo] = {
      codigo: a.codigo, etiqueta: a.nombre, n: 0, contestadas: 0, tono: a.tono,
      conductores: new Set(),
    });
    x.n++;
    x.conductores.add(c.conductorId);
    if (a.contestada) x.contestadas++;
  }));

  const js = Object.values(justis);
  return {
    dia: d,
    resumen: {
      conductores: conductores.length,
      noSalieron: noSalieron.length,
      conAlerta: conAlerta.length,
      sinAtender: sinAtender.length,
      llamadas: llamadas.length,
      llamados: new Set(llamadas.map(l => l.conductorId)).size,
      respuestasPorAlerta: llamadas.reduce((n, l) => n + (l.alertas || []).length, 0),
      jAprobadas: js.filter(j => j.estado === 'aprobada').length,
      jPendientes: js.filter(j => j.estado === 'pendiente').length,
      jRechazadas: js.reduce((n, j) => n + (j.rechazadas || []).length, 0),
      horasJAprobadas: Math.round(js.filter(j => j.estado === 'aprobada')
        .reduce((n, j) => n + (j.horas || 0), 0) * 10) / 10,
      horasJPendientes: Math.round(js.filter(j => j.estado === 'pendiente')
        .reduce((n, j) => n + (j.horas || 0), 0) * 10) / 10,
    },
    agentes,
    alertas: Object.values(porAlerta)
      .map(a => ({ ...a, conductores: a.conductores.size }))
      .sort((a, b) => b.n - a.n),
    conductores,
    // Los que rodaron sin estar en el plan. También se les llama, así que llevan
    // sus llamadas igual que los del plan: lo que contaron es la mitad del parte.
    sinPlan: (porT.nn || []).map(n => {
      const cid = String(n.conductorId || '');
      const suyas = llamPorCond.get(cid) || [];
      return {
        conductorId: cid,
        conductor: n.conductor, telefono: n.telefono || '',
        turno: n.turno || '', turnoEtiqueta: n.turnoEtiqueta || '',
        horasBolt: Math.round(((n.minutos || 0) / 60) * 10) / 10,
        km: n.enBolt || 0, kmFuera: n.desconectado || 0,
        matriculas: n.matriculas || [],
        situacion: (n.situacion || {}).etiqueta || '',
        // Un NN tiene DOS filas (día y noche) a propósito, así que cada una se
        // queda con la franja de su turno: la de mañana es del día y la de las
        // 20:00 es de la noche. Si no, el mismo aviso saldría en las dos.
        alertas: (n.avisos || []).filter(a => !['km_parado', 'sin_respuesta'].includes(a.codigo))
          .concat((franjas.get(cid) || []).filter(a =>
            (a.franja === 'manana' ? 'dia' : 'noche') === (n.turno || 'dia'))).map(av => {
            const dicha = suyas.flatMap(l => (l.alertas || [])
              .filter(x => x.alerta === av.codigo)
              .map(x => ({ comentario: x.comentario, hora: l.hora, agente: l.agente })));
            return { codigo: av.codigo, tono: av.tono, etiqueta: av.etq || av.etiqueta,
              nombre: av.nombre || nombreAlerta(av.codigo, av.etq), franja: av.franja || '',
              detalle: av.detalle || '', respuestas: dicha, contestada: dicha.length > 0 };
          }),
        llamadas: suyas,
      };
    }),
  };
}

module.exports = { parte, llamadasDelDia, SALIDA, ALERTA, nombreAlerta };
