// El banco de KM (/operaciones/banco-km, db/267, 18/11/2026).
//
// Camilo: «Va a haber un banco de KM por así decirlo por fuera, en el cual va
// por conductor y un resumen de matrículas por semana. La idea es que tengan un
// límite de 17,5 km por fuera al día, por cada uno; si descansa no se le suma
// al límite». Dos pestañas: «Por conductor» (su límite de la semana, lo que
// gastó y el saldo) y «Por matrícula» (los km fuera de BOLT de cada coche y de
// quién son). Las cuentas son del servidor (modules/Operaciones/bancoKm.service.js).
//
// EL DESGLOSE (18/11/2026): en la ficha de cada uno, de dónde sale cada km, día
// a día: en descanso, desconectado, por no terminar el turno (el coche lo
// llevaba otro con su fichaje abierto) o fichado sin conectarse. Camilo:
// «Necesitamos decirles: ey, por no haber desfichado, mira los KM que se te
// imputan». Con un mensaje listo para copiar y mandárselo.
//
// LA REGLA NUEVA (18/11/2026, db/268): cada hora de VIAJE en BOLT genera 8,8 km,
// con tope de 53 al día; y los km justificados y aprobados (llave
// «/justificantes/km») no cuentan. Desde la ficha, «Justificar km» en cada día.
//
// SUYOS Y POR NO DESFICHAR (db/269): en la lista, el % de sus km fuera que hizo
// él (desconectado o en descanso) y el que se le imputa por no terminar el
// turno (tenía el coche fichado y lo llevaba otro). Camilo: «solo necesito esa
// capilaridad extra… el % de desconectado y el % que se le imputa por no desfichar».
(function (global) {
  'use strict';
  const esc = Casa.esc;
  const API = '/operaciones/banco-km/api';
  const $ = s => document.querySelector(s);
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  // Con el punto de los miles también en las de cuatro cifras (es-ES no agrupa 1234).
  const num = (v, dec = 1) => {
    const n = Number(v) || 0;
    const [e, d] = Math.abs(n).toFixed(dec).split('.');
    return `${n < 0 ? '−' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${d ? `,${d}` : ''}`;
  };
  const km = v => `${num(v)} km`;
  const ddmm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const diaLargo = d => { const x = new Date(`${d}T12:00:00Z`); return `${DIAS[x.getUTCDay()]} ${Number(d.slice(8, 10))}`; };
  const placa = m => String(m || '').replace(/^(\d{4})([A-Z]{3})$/, '$1 $2');
  function textoSemana(l, dgo) {
    const [a, b] = [new Date(`${l}T12:00:00Z`), new Date(`${dgo}T12:00:00Z`)];
    return a.getUTCMonth() === b.getUTCMonth()
      ? `Semana del ${a.getUTCDate()} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}`
      : `Semana del ${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}`;
  }

  const ESTADO = {
    pasado: { texto: 'Pasado', pastilla: 'tc-pastilla--rojo', barra: 'bg-telecab-red' },
    cerca:  { texto: 'Cerca del límite', pastilla: 'tc-pastilla--aviso', barra: 'bg-telecab-warn' },
    dentro: { texto: 'Dentro', pastilla: 'tc-pastilla--verde', barra: 'bg-telecab-green' },
  };

  const CAUSA = {
    fichaje_abierto:  { punto: 'bg-telecab-red',    corto: 'Por no terminar el turno' },
    desconectado:     { punto: 'bg-telecab-warn',   corto: 'Desconectado de BOLT' },
    descanso:         { punto: 'bg-telecab-azul',   corto: 'En descanso en BOLT' },
    fichado_sin_bolt: { punto: 'bg-telecab-violet', corto: 'Fichado, sin conectarse a BOLT' },
    sin_desglose:     { punto: 'bg-telecab-muted',  corto: 'Sin desglose' },
  };
  const hora = iso => new Date(iso).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
  const diaDe = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(iso));
  /** «su fichaje del jueves 12 a las 03:09 se cerró solo a las 18:56». */
  function textoFichaje(f) {
    if (!f) return '';
    const ini = `su fichaje del ${diaLargo(diaDe(f.inicio))} a las ${hora(f.inicio)}`;
    const cuando = iso => (diaDe(iso) === diaDe(f.inicio) ? `a las ${hora(iso)}` : `el ${diaLargo(diaDe(iso))} a las ${hora(iso)}`);
    if (!f.fin) return `${ini} sigue abierto`;
    if (f.estado === 'auto-cerrado') return `${ini} se cerró solo ${cuando(f.fin)}`;
    if (f.estado === 'relevado') return `${ini} lo cerró el relevo ${cuando(f.fin)}`;
    return `${ini} lo terminó ${cuando(f.fin)}`;
  }
  const punto = c => `<span class="inline-block w-2 h-2 rounded-full ${(CAUSA[c] || CAUSA.sin_desglose).punto}" aria-hidden="true"></span>`;

  let datos = null;
  let pedido = null;            // el lunes que se está mirando (null = la última semana con jornadas cerradas)
  let lstC = null, lstM = null;

  // ── La semana ──────────────────────────────────────────────────────────────
  async function traer() {
    datos = await Api.get(`${API}/semana${pedido ? `?lunes=${encodeURIComponent(pedido)}` : ''}`);
    pintarCabecera();
    return datos;
  }
  async function irA(lunes) {
    pedido = lunes;
    try { await traer(); } catch (e) { aviso(e.message, 'error'); return; }
    if (lstC) lstC.recargar();
    if (lstM) lstM.recargar();
    const p = Panel.abierto && Panel.abierto();
    if (p) p.cerrar();
  }

  function aviso(texto, tono = 'info') {
    const el = $('#bk-aviso');
    if (!texto) { el.classList.add('hidden'); return; }
    el.className = `mt-3 rounded-xl border px-3 py-2 text-sm ${tono === 'error'
      ? 'border-telecab-red/40 bg-telecab-red/5 text-telecab-red'
      : tono === 'aviso' ? 'border-telecab-warn/40 bg-telecab-warn/5' : 'border-telecab-border bg-telecab-card'}`;
    el.innerHTML = texto;
  }

  let sondeo = null;
  function pintarCabecera() {
    if (datos.sinMigracion) {
      $('#bk-semana').textContent = '—';
      aviso('Para el banco de KM falta aplicar las migraciones db/267, db/268 y db/269 en /migraciones.', 'aviso');
      return;
    }
    $('#bk-semana').textContent = textoSemana(datos.lunes, datos.domingo);
    $('#bk-ant').disabled = !datos.anterior;
    $('#bk-sig').disabled = !datos.siguiente;
    const partes = [];
    if (datos.recalculando) {
      const r = datos.recalculando;
      partes.push(`<i class="fa-solid fa-rotate fa-spin text-telecab-gold mr-1" aria-hidden="true"></i>Recalculando la semana del ${esc(ddmm(r.lunes))}: ${r.hechos} de ${r.total} jornadas…`);
    }
    if (datos.faltan.length) {
      partes.push(`Faltan por calcular: ${datos.faltan.map(d => esc(diaLargo(d))).join(', ')}. Se calculan solas en unos minutos.`);
    }
    if (datos.enCurso) {
      const cerradas = datos.dias.filter(d => d.cerrada);
      partes.push(cerradas.length
        ? `Semana en curso: cuentan las jornadas cerradas, hasta el ${esc(diaLargo(cerradas[cerradas.length - 1].dia))}. Una jornada se cierra a las 12:00 del día siguiente.`
        : 'Semana en curso: todavía no hay ninguna jornada cerrada (se cierran a las 12:00 del día siguiente).');
    }
    aviso(partes.join('<br>'), datos.recalculando || datos.faltan.length ? 'aviso' : 'info');
    // Mientras se recalcula, se vuelve a mirar cada pocos segundos.
    clearTimeout(sondeo);
    if (datos.recalculando) {
      sondeo = setTimeout(async () => {
        const antes = !!datos.recalculando;
        try { await traer(); } catch (_) { return; }
        if (antes && !datos.recalculando) {
          Dialogo.hecho('Semana recalculada');
          if (lstC) lstC.recargar();
          if (lstM) lstM.recargar();
        }
      }, 4000);
    }
  }

  $('#bk-ant').addEventListener('click', () => datos && datos.anterior && irA(datos.anterior));
  $('#bk-sig').addEventListener('click', () => datos && datos.siguiente && irA(datos.siguiente));
  $('#bk-recalcular').addEventListener('click', async () => {
    if (!datos || datos.sinMigracion) return;
    const ok = await Dialogo.confirmar({
      titulo: `Recalcular la ${textoSemana(datos.lunes, datos.domingo).toLowerCase()}`,
      texto: 'Vuelve a sacar los km fuera de BOLT de sus jornadas cerradas, con los fichajes y el planificador de ahora. Tarda un poco: se hace por detrás.',
      si: 'Recalcular', no: 'Cancelar',
    });
    if (!ok) return;
    const r = await Api.post(`${API}/recalcular`, { lunes: datos.lunes }, { aviso: 'No se ha podido recalcular' });
    if (!r) return;
    await traer();
  });

  // ── Las pestañas ───────────────────────────────────────────────────────────
  Pestanas.montar($('#bk-pestanas'), {
    pestanas: [
      { id: 'conductores', texto: 'Por conductor', icono: 'fa-user' },
      { id: 'matriculas', texto: 'Por matrícula', icono: 'fa-car-side' },
    ],
    param: 'vista',
    alCambiar: id => {
      $('#bk-conductores').classList.toggle('hidden', id !== 'conductores');
      $('#bk-coches').classList.toggle('hidden', id !== 'matriculas');
      if (id === 'matriculas' && !lstM) montarCoches();
      if (id === 'conductores' && !lstC) montarConductores();
    },
  });

  const origen = clave => async () => {
    if (!datos) await traer();
    if (datos.sinMigracion) return { filas: [] };
    return { filas: datos[clave], kmHora: datos.kmHora, tope: datos.tope };
  };

  // ── Por conductor ──────────────────────────────────────────────────────────
  function montarConductores() {
    lstC = Listado.montar({
      raiz: '#bk-conductores',
      titulo: 'Banco de KM',
      icono: 'fa-piggy-bank',
      clave: 'persona',
      url: false,
      origen: origen('conductores'),
      vacio: 'Esta semana nadie tiene límite ni km fuera de BOLT.',
      buscar: { texto: 'Conductor o matrícula…', campos: ['nombre', f => f.matriculas.map(m => `${m.matricula} ${placa(m.matricula)}`).join(' ')] },
      subtitulo: (v, todas, extra) => `Cada hora de viaje en BOLT genera ${km((extra && extra.kmHora) || 8.8)} fuera de BOLT, con un tope de ${km((extra && extra.tope) || 53)} al día. Los km justificados y aprobados no cuentan. La semana va de lunes a domingo y empieza de cero.`,
      kpisDeLoVisible: true,
      kpis: filas => {
        const de = e => filas.filter(f => f.estado === e);
        const exceso = de('pasado').reduce((s, f) => s + (f.km - f.limite), 0);
        return [
          { etiqueta: 'Pasados del límite', valor: de('pasado').length, tono: de('pasado').length ? 'red' : 'muted',
            pie: de('pasado').length ? `${km(exceso)} por encima, entre todos` : 'nadie', filtro: { id: 'estado', valor: 'pasado' } },
          { etiqueta: 'Cerca del límite', valor: de('cerca').length, tono: 'warn', pie: 'desde el 80 %', filtro: { id: 'estado', valor: 'cerca' } },
          { etiqueta: 'Dentro', valor: de('dentro').length, tono: 'green', filtro: { id: 'estado', valor: 'dentro' } },
          (() => {
            const des = filas.reduce((s, f) => s + (f.kmNoDesfichar || 0), 0);
            const base = filas.reduce((s, f) => s + (f.kmDesglosado || 0), 0);
            return { etiqueta: 'Por no desvincular', valor: km(des), tono: des > 0 ? 'warn' : 'muted',
              pie: base > 0 ? `el ${Math.round(des / base * 100)} % de sus km fuera` : 'sin desglose todavía',
              filtro: { id: 'desfichar', valor: 'algo' } };
          })(),
          { etiqueta: 'Km fuera de BOLT', valor: km(filas.reduce((s, f) => s + f.km, 0)), tono: 'muted',
            pie: `de ${km(filas.reduce((s, f) => s + f.limite, 0))} de límite${filas.some(f => f.justificados > 0) ? ` · ${km(filas.reduce((s, f) => s + f.justificados, 0))} justificados` : ''}` },
        ];
      },
      filtros: [{
        id: 'estado', etiqueta: 'Estado', textoTodos: 'Todos',
        opciones: filas => Object.keys(ESTADO).map(e => ({ valor: e, texto: ESTADO[e].texto, cuenta: filas.filter(f => f.estado === e).length })).filter(o => o.cuenta),
        pasa: (f, v) => f.estado === v,
      }, {
        id: 'desfichar', etiqueta: 'Por no desvincular', textoTodos: 'Todos',
        opciones: filas => [
          { valor: 'mitad', texto: 'La mitad o más, por no desvincular', cuenta: filas.filter(f => f.pctNoDesfichar >= 50).length },
          { valor: 'algo', texto: 'Con km por no desvincular', cuenta: filas.filter(f => f.kmNoDesfichar > 0).length },
          { valor: 'nada', texto: 'Todo suyo', cuenta: filas.filter(f => f.kmDesglosado > 0 && !(f.kmNoDesfichar > 0)).length },
        ].filter(o => o.cuenta),
        pasa: (f, v) => (v === 'mitad' ? f.pctNoDesfichar >= 50 : v === 'algo' ? f.kmNoDesfichar > 0 : f.kmDesglosado > 0 && !(f.kmNoDesfichar > 0)),
      }, {
        id: 'turno', etiqueta: 'Turno', textoTodos: 'Todos los turnos',
        opciones: filas => [...new Set(filas.map(f => f.turno || 'Sin turno'))].sort()
          .map(t => ({ valor: t, texto: t, cuenta: filas.filter(f => (f.turno || 'Sin turno') === t).length })),
        pasa: (f, v) => (f.turno || 'Sin turno') === v,
      }],
      claseFila: f => (f.estado === 'pasado' ? 'bg-telecab-red/5' : ''),
      columnas: [
        { titulo: 'Conductor', campo: 'nombre',
          pinta: (v, f) => `<span class="font-semibold">${esc(f.nombre)}</span>${f.sinFicha ? ' <span class="tc-pastilla tc-pastilla--aviso" title="Una cuenta de BOLT sin ficha en la plantilla">sin ficha</span>' : ''}
            <span class="block text-[11px] text-telecab-muted">${esc([f.turno, f.matriculas.slice(0, 3).map(m => placa(m.matricula)).join(', ')].filter(Boolean).join(' · '))}</span>` },
        { titulo: 'Viaje', campo: 'horasViaje', clase: 'text-right tabular-nums whitespace-nowrap',
          ayuda: 'Horas de viaje en BOLT de la semana (yendo a por el pasajero o llevándolo). Cada una genera límite; la espera no.',
          pinta: v => `${num(v)} h` },
        { titulo: 'Límite', campo: 'limite', clase: 'text-right tabular-nums whitespace-nowrap', pinta: v => km(v) },
        { titulo: 'Km fuera de BOLT', campo: 'km', clase: 'tabular-nums whitespace-nowrap',
          ayuda: 'Desconectado o en descanso, con su regla de siempre: con el coche fichado, de quien lo fichó; sin fichar, del último que estuvo en BOLT con él. Sin los km justificados y aprobados.',
          pinta: (v, f) => `<span class="block text-right font-semibold">${km(v)}</span>${f.justificados > 0 || f.pendientes > 0
            ? `<span class="block text-right text-[10px] text-telecab-muted">${[f.justificados > 0 ? `${num(f.kmFuera)} − ${num(f.justificados)} justificados` : '',
              f.pendientes > 0 ? `${num(f.pendientes)} por aprobar` : ''].filter(Boolean).join(' · ')}</span>` : ''}
            <span class="block h-1.5 mt-1 rounded-full bg-telecab-card2 overflow-hidden min-w-[6rem]" aria-hidden="true">
              <span class="block h-full ${ESTADO[f.estado].barra}" style="width:${Math.min(100, f.pct == null ? 100 : f.pct)}%"></span></span>` },
        { titulo: 'Suyos', campo: 'pctSuyos', clase: 'text-right tabular-nums whitespace-nowrap',
          ayuda: 'De sus km fuera de BOLT, los que hizo él: desconectado o en descanso en BOLT (o con el coche fichado sin conectarse).',
          valor: f => (f.pctSuyos == null ? -1 : f.pctSuyos),
          pinta: (v, f) => (f.pctSuyos == null ? '<span class="text-telecab-muted">—</span>'
            : `<span class="font-semibold">${f.pctSuyos} %</span><span class="block text-[10px] text-telecab-muted">${km(f.kmSuyos)}</span>`) },
        { titulo: 'Por no desvincular', campo: 'pctNoDesfichar', clase: 'text-right tabular-nums whitespace-nowrap',
          ayuda: 'De sus km fuera de BOLT, los que se le imputan por no terminar el turno: tenía el coche fichado y quien estaba en BOLT con él era otro.',
          valor: f => (f.pctNoDesfichar == null ? -1 : f.pctNoDesfichar),
          pinta: (v, f) => (f.pctNoDesfichar == null ? '<span class="text-telecab-muted">—</span>'
            : `<span class="font-semibold ${f.pctNoDesfichar >= 50 ? 'text-telecab-red' : f.pctNoDesfichar > 0 ? 'text-telecab-warn' : 'text-telecab-muted'}">${f.pctNoDesfichar} %</span><span class="block text-[10px] text-telecab-muted">${km(f.kmNoDesfichar)}</span>`) },
        { titulo: 'Saldo', campo: 'saldo', clase: 'text-right tabular-nums whitespace-nowrap',
          pinta: (v, f) => (v < 0
            ? `<b class="text-telecab-red">pasado ${km(-v)}</b>`
            : `<span class="${f.estado === 'cerca' ? 'text-telecab-warn' : ''}">le quedan ${km(v)}</span>`) },
      ],
      alAbrir: f => abrirConductor(f),
    });
  }

  // La ficha de un conductor: su semana día a día y sus últimas semanas.
  function queFue(d) {
    const viaje = d.horasViaje > 0 ? `${num(d.horasViaje)} h de viaje` : 'Sin viaje';
    return d.horas > d.horasViaje ? `${viaje} (de ${num(d.horas)} h en BOLT)` : viaje;
  }
  /** Las justificaciones de KM de un día, en la ficha. */
  const justificacionesTxt = d => (d.justificaciones || []).map(j =>
    `<span class="block text-[11px] ${j.estado === 'aprobada' ? 'text-telecab-green' : 'text-telecab-azul'}">${km(j.km)} justificados · ${
      j.estado === 'aprobada' ? `aprobada por ${esc(j.aprobadaPor || '¿?')}` : 'a la espera de ser aprobada'}: «${esc(j.motivo)}»</span>`).join('');
  function abrirConductor(f) {
    const porDia = new Map(f.dias.map(d => [d.dia, d]));
    const filas = datos.dias.map(dd => {
      const d = porDia.get(dd.dia);
      if (!d) {
        const que = !dd.cerrada ? 'Sin cerrar' : !dd.calculada ? 'Sin calcular' : 'Libraba';
        return `<tr class="border-b border-telecab-border/50 text-telecab-muted"><td class="py-1.5 pr-2 whitespace-nowrap">${esc(diaLargo(dd.dia))}</td><td class="py-1.5 pr-2">${que}</td><td class="py-1.5 pr-2 text-right">—</td><td class="py-1.5 pr-2 text-right">—</td><td></td></tr>`;
      }
      const marcas = [d.sinFichar ? '<span class="tc-pastilla tc-pastilla--aviso" title="Trabajó o movió un coche sin fichar por WhatsApp">sin fichar</span>' : '',
        d.revisar ? '<span class="tc-pastilla tc-pastilla--aviso" title="Estuvo en BOLT con un coche que no dio km: lo cuadra Tráfico">REVISAR</span>' : ''].join(' ');
      // Con km, la raya va debajo de su desglose, no entre el día y él.
      const puedeJustificar = /^c\d+$/.test(f.persona) && d.kmFuera > 0;
      return `<tr class="${d.kmFuera > 0 ? '' : 'border-b border-telecab-border/50 '}align-top">
        <td class="py-1.5 pr-2 whitespace-nowrap">${esc(diaLargo(d.dia))}</td>
        <td class="py-1.5 pr-2">${esc(queFue(d))} ${marcas}
          ${d.fichaje ? `<span class="block text-[11px] text-telecab-muted">Fichaje: ${esc(d.fichaje)}</span>` : ''}
          ${justificacionesTxt(d)}
          ${puedeJustificar ? `<button type="button" class="tc-boton tc-boton--chico mt-1" data-justificar="${esc(d.dia)}"><i class="fa-solid fa-file-circle-check" aria-hidden="true"></i>Justificar km</button>` : ''}</td>
        <td class="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">${d.limite ? `+${km(d.limite)}` : '—'}</td>
        <td class="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap font-semibold">${d.kmFuera ? km(d.km) : '—'}${d.justificados > 0
          ? `<span class="block text-[10px] font-normal text-telecab-muted">${num(d.kmFuera)} − ${num(d.justificados)}</span>` : ''}</td>
        <td class="py-1.5 text-[11px] text-telecab-muted">${d.coches.map(c => `${esc(placa(c.matricula))} ${km(c.km)}`).join('<br>')}</td>
      </tr>${d.kmFuera > 0 ? `<tr class="border-b border-telecab-border/50"><td></td><td colspan="4" class="pb-2 text-[11px] text-telecab-muted" data-desglose-dia="${esc(d.dia)}">Desglosando…</td></tr>` : ''}`;
    }).join('');
    const est = ESTADO[f.estado];
    const p = Panel.abrir({
      titulo: f.nombre,
      subtitulo: `${textoSemana(datos.lunes, datos.domingo)}${f.turno ? ` · ${f.turno}` : ''}`,
      ancho: 'ancha',
      html: `<div class="grid grid-cols-3 gap-2 mb-3">
          <div class="tc-kpi" data-tono="muted"><p class="tc-kpi-etiqueta">Límite</p><p class="tc-kpi-valor">${km(f.limite)}</p></div>
          <div class="tc-kpi" data-tono="${f.estado === 'pasado' ? 'red' : f.estado === 'cerca' ? 'warn' : 'green'}"><p class="tc-kpi-etiqueta">Km fuera</p><p class="tc-kpi-valor">${km(f.km)}</p></div>
          <div class="tc-kpi" data-tono="${f.saldo < 0 ? 'red' : 'muted'}"><p class="tc-kpi-etiqueta">Saldo</p><p class="tc-kpi-valor">${f.saldo < 0 ? `−${km(-f.saldo)}` : km(f.saldo)}</p></div>
        </div>
        <p class="mb-3"><span class="tc-pastilla ${est.pastilla}">${esc(est.texto)}</span>
          <span class="text-xs text-telecab-muted ml-1">${num(f.horasViaje)} h de viaje en la semana${f.justificados > 0 ? ` · ${km(f.justificados)} justificados` : ''}${f.pendientes > 0 ? ` · ${km(f.pendientes)} a la espera de ser aprobados` : ''}</span></p>
        ${f.kmFuera > 0 ? '<div data-desglose-semana class="mb-4 text-sm text-telecab-muted">Desglosando los km…</div>' : ''}
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-[11px] uppercase tracking-wide text-telecab-muted text-left border-b border-telecab-border">
            <th class="py-1.5 pr-2 font-semibold">Día</th><th class="py-1.5 pr-2 font-semibold">Qué fue</th>
            <th class="py-1.5 pr-2 font-semibold text-right">Límite</th><th class="py-1.5 pr-2 font-semibold text-right">Km fuera</th>
            <th class="py-1.5 font-semibold">Coches</th></tr></thead>
          <tbody>${filas}</tbody></table></div>
        <p class="text-[11px] text-telecab-muted mt-2">Los km fuera de BOLT son los del reporte de Control: con el coche fichado por WhatsApp, de quien lo fichó (también si se le olvidó terminar el turno); sin fichar, del último que estuvo en BOLT con el coche. Cada hora de viaje genera ${km(datos.kmHora || 8.8)} de límite, con un tope de ${km(datos.tope || 53)} al día. Lo justificado cuenta solo cuando se aprueba.</p>
        <h3 class="text-xs uppercase tracking-wide text-telecab-muted font-semibold mt-5 mb-2">Sus últimas semanas</h3>
        <div data-historia class="text-sm text-telecab-muted">Cargando…</div>`,
    });
    p.cuerpo.querySelectorAll('[data-justificar]').forEach(b => b.addEventListener('click', () => justificar(f, porDia.get(b.dataset.justificar))));
    if (f.kmFuera > 0) {
      Api.get(`${API}/desglose?persona=${encodeURIComponent(f.persona)}&lunes=${encodeURIComponent(datos.lunes)}`)
        .then(r => pintarDesglose(p.cuerpo, f, r))
        .catch(e => {
          const caja = p.cuerpo.querySelector('[data-desglose-semana]');
          if (caja) caja.textContent = `No se ha podido desglosar: ${e.message}`;
          p.cuerpo.querySelectorAll('[data-desglose-dia]').forEach(x => { x.textContent = ''; });
        });
    }
    Api.get(`${API}/historia?persona=${encodeURIComponent(f.persona)}&hasta=${encodeURIComponent(datos.domingo)}`).then(r => {
      const caja = p.cuerpo.querySelector('[data-historia]');
      if (!caja) return;
      const s = r.semanas || [];
      caja.innerHTML = s.length ? `<table class="w-full text-sm"><tbody>${s.map(x => `<tr class="border-b border-telecab-border/50">
          <td class="py-1.5 pr-2 whitespace-nowrap">${esc(ddmm(x.lunes))}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">${km(x.km)} <span class="text-telecab-muted">de ${km(x.limite)}</span></td>
          <td class="py-1.5 text-right tabular-nums whitespace-nowrap">${x.saldo < 0 ? `<b class="text-telecab-red">pasado ${km(-x.saldo)}</b>` : `le quedaron ${km(x.saldo)}`}</td></tr>`).join('')}</tbody></table>`
        : 'Sin semanas anteriores.';
    }).catch(e => {
      const caja = p.cuerpo.querySelector('[data-historia]');
      if (caja) caja.textContent = `No se ha podido leer: ${e.message}`;
    });
  }

  /**
   * Justificar km de un día, desde la ficha. Nace pendiente: cuenta cuando la
   * aprueba quien tiene la llave (en Justificantes › KM). Después se recarga
   * la semana y se vuelve a abrir su ficha.
   */
  async function justificar(f, d) {
    if (!d) return;
    const libres = Math.max(0, Math.round((d.kmFuera - d.justificados - d.pendientes) * 10) / 10);
    const v = await Dialogo.formulario(`Justificar km de ${f.nombre} · ${diaLargo(d.dia)}`, [
      { id: 'km', etiqueta: 'Km que se justifican', obligatorio: true, marcador: `hasta ${num(libres)}` },
      ...(d.coches.length ? [{ id: 'matricula', etiqueta: 'Coche', tipo: 'lista', valor: d.coches[0].matricula,
        opciones: d.coches.map(c => ({ valor: c.matricula, texto: `${placa(c.matricula)} · ${km(c.km)} fuera` })) }] : []),
      { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', obligatorio: true, minimo: 3, marcador: 'Llevó el coche al taller, cambio de zona…' },
    ], { textoBoton: 'Apuntar',
         nota: `Ese día lleva ${km(d.kmFuera)} fuera de BOLT${d.justificados || d.pendientes ? ` (${km(d.justificados + d.pendientes)} ya justificados o por aprobar)` : ''}. Nace a la espera de ser aprobada; cuando se aprueba, esos km dejan de contar.` });
    if (!v) return;
    const r = await Api.post(`${API}/justificar`, { persona: f.persona, dia: d.dia, km: v.km, matricula: v.matricula, motivo: v.motivo },
      { aviso: 'No se ha podido apuntar' });
    if (!r) return;
    Dialogo.hecho('Apuntada: a la espera de ser aprobada');
    try { await traer(); } catch (_) { return; }
    if (lstC) lstC.recargar();
    const nuevo = datos.conductores.find(x => x.persona === f.persona);
    if (nuevo) abrirConductor(nuevo);
  }

  // El desglose: arriba la semana (barra y leyenda, y el aviso del turno sin
  // terminar con su mensaje para copiar); debajo de cada día, sus causas.
  function pintarDesglose(cuerpo, f, r) {
    const caja = cuerpo.querySelector('[data-desglose-semana]');
    if (!caja) return;
    const total = r.semana.reduce((s, x) => s + x.km, 0);
    const porCausa = new Map();
    r.semana.forEach(x => porCausa.set(x.causa, (porCausa.get(x.causa) || 0) + x.km));
    const orden = Object.keys(CAUSA).filter(c => porCausa.get(c) > 0);
    const barra = total > 0 ? `<div class="flex h-2.5 rounded-full overflow-hidden bg-telecab-card2" role="img" aria-label="Reparto de sus km fuera de BOLT">${
      orden.map(c => `<span class="block h-full ${CAUSA[c].punto}" style="width:${(porCausa.get(c) / total * 100).toFixed(2)}%"></span>`).join('')}</div>` : '';
    const leyenda = orden.map(c => `<span class="inline-flex items-center gap-1.5 mr-3 whitespace-nowrap">${punto(c)}${esc(CAUSA[c].corto)} <b class="text-telecab-text tabular-nums">${km(porCausa.get(c))}</b></span>`).join('');
    const abiertos = r.semana.filter(x => x.causa === 'fichaje_abierto' && x.km > 0);
    const kmAbierto = abiertos.reduce((s, x) => s + x.km, 0);
    caja.className = 'mb-4';
    caja.innerHTML = `<h3 class="text-xs uppercase tracking-wide text-telecab-muted font-semibold mb-2">De dónde salen sus km</h3>
      ${barra}<p class="mt-2 text-xs text-telecab-muted leading-6">${leyenda}</p>
      ${kmAbierto > 0 ? `<div class="mt-2 rounded-xl border border-telecab-red/40 bg-telecab-red/5 px-3 py-2 text-sm">
          <p><b class="text-telecab-red">${km(kmAbierto)} por no terminar el turno.</b> Su fichaje seguía abierto mientras el coche lo llevaba ${
            abiertos.map(x => `${esc(x.con || 'otra persona')} (${km(x.km)})`).join(', ')}, desconectado o en descanso en BOLT: con la regla del fichaje, esos km cuentan en su banco.</p>
          <button type="button" class="tc-boton tc-boton--chico mt-2" data-copiar-aviso><i class="fa-solid fa-copy" aria-hidden="true"></i>Copiar el mensaje para mandárselo</button>
        </div>` : ''}`;
    const boton = caja.querySelector('[data-copiar-aviso]');
    if (boton) {
      boton.addEventListener('click', async () => {
        const nombre = String(f.nombre || '').split(/\s+/)[0] || '';
        const otros = [...porCausa.entries()].filter(([c]) => c !== 'fichaje_abierto' && c !== 'sin_desglose')
          .map(([c, k]) => `${km(k)} ${c === 'descanso' ? 'en descanso en BOLT' : c === 'desconectado' ? 'desconectado de BOLT' : 'con el coche fichado sin conectarte a BOLT'}`);
        const texto = [
          `Hola${nombre ? ` ${nombre}` : ''}. En la ${textoSemana(datos.lunes, datos.domingo).toLowerCase()} llevas ${km(f.kmFuera)} fuera de BOLT${f.justificados > 0 ? ` (${km(f.justificados)} justificados, que no cuentan)` : ''}, y tu límite es de ${km(f.limite)}, por tus ${num(f.horasViaje)} h de viaje.`,
          `De esos, ${km(kmAbierto)} son por no terminar el turno en el bot: tu fichaje siguió abierto mientras el coche lo llevaba ${abiertos.map(x => x.con || 'otra persona').join(' y ')}, y esos km se te apuntan a ti.`,
          otros.length ? `El resto: ${otros.join(' y ')}.` : '',
          'Cuando dejes el coche, pulsa «Terminar turno» en el bot.',
        ].filter(Boolean).join('\n\n');
        try { await navigator.clipboard.writeText(texto); Dialogo.hecho('Mensaje copiado'); }
        catch (_) { Dialogo.aviso({ titulo: 'Cópialo a mano', texto }); }
      });
    }

    // Día a día.
    const porDia = new Map(r.dias.map(d => [d.dia, d]));
    cuerpo.querySelectorAll('[data-desglose-dia]').forEach(celda => {
      const d = porDia.get(celda.dataset.desgloseDia);
      if (!d) { celda.textContent = ''; return; }
      const varios = d.coches.length > 1;
      celda.innerHTML = d.coches.map(c => `${varios ? `<span class="block font-semibold text-telecab-text">${esc(placa(c.matricula))}</span>` : ''}${
        c.causas.map(x => `<span class="block">${punto(x.causa)} ${esc((CAUSA[x.causa] || CAUSA.sin_desglose).corto)}: <b class="text-telecab-text tabular-nums">${km(x.km)}</b>${
          x.causa === 'fichaje_abierto' ? ` <span>— lo llevaba ${esc(x.con || 'otra persona')}; ${esc(textoFichaje(r.fichajes[x.fichajeId]))}</span>`
          : x.causa === 'fichado_sin_bolt' ? ` <span>— ${esc(textoFichaje(r.fichajes[x.fichajeId]))}</span>` : ''}</span>`).join('')}`).join('');
    });
  }

  // ── Por matrícula ──────────────────────────────────────────────────────────
  function montarCoches() {
    lstM = Listado.montar({
      raiz: '#bk-coches',
      titulo: 'Banco de KM · matrículas',
      icono: 'fa-car-side',
      clave: 'matricula',
      url: false,
      origen: origen('coches'),
      vacio: 'Esta semana ningún coche tiene km fuera de BOLT.',
      buscar: { texto: 'Matrícula o conductor…', campos: [f => `${f.matricula} ${placa(f.matricula)}`, f => f.personas.map(p => p.nombre).join(' ')] },
      subtitulo: () => 'Los km fuera de BOLT de cada coche en la semana, y de quién son.',
      kpisDeLoVisible: true,
      kpis: filas => [
        { etiqueta: 'Coches', valor: filas.length, tono: 'muted', pie: 'con km fuera de BOLT' },
        { etiqueta: 'Km fuera de BOLT', valor: km(filas.reduce((s, f) => s + f.km, 0)), tono: 'muted' },
        { etiqueta: 'Media por coche', valor: km(filas.length ? filas.reduce((s, f) => s + f.km, 0) / filas.length : 0), tono: 'muted' },
      ],
      columnas: [
        { titulo: 'Matrícula', campo: 'matricula', clase: 'whitespace-nowrap', pinta: v => `<span class="font-semibold tabular-nums">${esc(placa(v))}</span>` },
        { titulo: 'Km fuera de BOLT', campo: 'km', clase: 'text-right tabular-nums whitespace-nowrap', pinta: v => `<b>${km(v)}</b>` },
        { titulo: 'De quién', campo: 'personas', valor: f => f.personas.map(p => p.nombre).join(', '),
          pinta: (v, f) => f.personas.slice(0, 3).map(p => `<span class="block whitespace-nowrap">${esc(p.nombre)}${p.oficina ? ' <span class="text-telecab-muted">(oficina)</span>' : ''}
            <span class="text-telecab-muted tabular-nums">· ${km(p.km)} · ${p.pct} %</span></span>`).join('')
            + (f.personas.length > 3 ? `<span class="block text-[11px] text-telecab-muted">y ${f.personas.length - 3} más</span>` : '') },
        { titulo: 'Días', campo: 'diasConKm', clase: 'text-right tabular-nums', ayuda: 'Días de la semana con km fuera de BOLT' },
      ],
      alAbrir: f => abrirCoche(f),
    });
  }

  function abrirCoche(f) {
    Panel.abrir({
      titulo: placa(f.matricula),
      subtitulo: `${textoSemana(datos.lunes, datos.domingo)} · ${km(f.km)} fuera de BOLT`,
      ancho: 'ancha',
      html: `<h3 class="text-xs uppercase tracking-wide text-telecab-muted font-semibold mb-2">De quién son</h3>
        <div class="space-y-2 mb-5">${f.personas.map(p => `<div>
            <div class="flex justify-between gap-3 text-sm"><span class="font-semibold">${esc(p.nombre)}${p.oficina ? ' <span class="text-telecab-muted font-normal">(oficina)</span>' : ''}</span>
              <span class="tabular-nums whitespace-nowrap">${km(p.km)} · ${p.pct} %</span></div>
            <span class="block h-1.5 mt-1 rounded-full bg-telecab-card2 overflow-hidden" aria-hidden="true"><span class="block h-full bg-telecab-gold" style="width:${p.pct}%"></span></span>
          </div>`).join('')}</div>
        <h3 class="text-xs uppercase tracking-wide text-telecab-muted font-semibold mb-2">Día a día</h3>
        <table class="w-full text-sm"><tbody>${f.dias.map(d => `<tr class="border-b border-telecab-border/50 align-top">
            <td class="py-1.5 pr-2 whitespace-nowrap">${esc(diaLargo(d.dia))}</td>
            <td class="py-1.5">${d.quienes.map(q => `${esc(q.nombre)} <span class="text-telecab-muted tabular-nums">${km(q.km)}</span>`).join('<br>')}</td>
          </tr>`).join('')}</tbody></table>`,
    });
  }

  // La primera: la pestaña de la dirección (o «Por conductor»).
  if (!lstC && !lstM) {
    if (new URLSearchParams(location.search).get('vista') === 'matriculas') { $('#bk-conductores').classList.add('hidden'); $('#bk-coches').classList.remove('hidden'); montarCoches(); }
    else montarConductores();
  }
})(window);
