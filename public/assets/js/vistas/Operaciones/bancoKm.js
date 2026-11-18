// El banco de KM (/operaciones/banco-km, db/267, 18/11/2026).
//
// Camilo: «Va a haber un banco de KM por así decirlo por fuera, en el cual va
// por conductor y un resumen de matrículas por semana. La idea es que tengan un
// límite de 17,5 km por fuera al día, por cada uno; si descansa no se le suma
// al límite». Dos pestañas: «Por conductor» (su límite de la semana, lo que
// gastó y el saldo) y «Por matrícula» (los km fuera de BOLT de cada coche y de
// quién son). Las cuentas son del servidor (modules/Operaciones/bancoKm.service.js).
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
      aviso('Para el banco de KM falta aplicar la migración db/267 en /migraciones.', 'aviso');
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
    return { filas: datos[clave], kmDia: datos.kmDia };
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
      subtitulo: (v, todas, extra) => `${km((extra && extra.kmDia) || 17.5)} fuera de BOLT por cada día que le toca en el planificador o que sale sin tocarle (NN o día extra). La semana va de lunes a domingo y empieza de cero.`,
      kpisDeLoVisible: true,
      kpis: filas => {
        const de = e => filas.filter(f => f.estado === e);
        const exceso = de('pasado').reduce((s, f) => s + (f.km - f.limite), 0);
        return [
          { etiqueta: 'Pasados del límite', valor: de('pasado').length, tono: de('pasado').length ? 'red' : 'muted',
            pie: de('pasado').length ? `${km(exceso)} por encima, entre todos` : 'nadie', filtro: { id: 'estado', valor: 'pasado' } },
          { etiqueta: 'Cerca del límite', valor: de('cerca').length, tono: 'warn', pie: 'desde el 80 %', filtro: { id: 'estado', valor: 'cerca' } },
          { etiqueta: 'Dentro', valor: de('dentro').length, tono: 'green', filtro: { id: 'estado', valor: 'dentro' } },
          { etiqueta: 'Km fuera de BOLT', valor: km(filas.reduce((s, f) => s + f.km, 0)), tono: 'muted',
            pie: `de ${km(filas.reduce((s, f) => s + f.limite, 0))} de límite` },
        ];
      },
      filtros: [{
        id: 'estado', etiqueta: 'Estado', textoTodos: 'Todos',
        opciones: filas => Object.keys(ESTADO).map(e => ({ valor: e, texto: ESTADO[e].texto, cuenta: filas.filter(f => f.estado === e).length })).filter(o => o.cuenta),
        pasa: (f, v) => f.estado === v,
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
        { titulo: 'Días', campo: 'programados', clase: 'tabular-nums whitespace-nowrap',
          ayuda: 'Días que le tocaban en el planificador, más los que salió sin tocarle (NN o día extra). Cada uno suma al límite.',
          valor: f => f.programados + f.extra,
          pinta: (v, f) => `${f.programados}${f.extra ? ` <span class="text-telecab-muted">+ ${f.extra} sin tocarle</span>` : ''}` },
        { titulo: 'Límite', campo: 'limite', clase: 'text-right tabular-nums whitespace-nowrap', pinta: v => km(v) },
        { titulo: 'Km fuera de BOLT', campo: 'km', clase: 'tabular-nums whitespace-nowrap',
          ayuda: 'Desconectado o en descanso, con su regla de siempre: con el coche fichado, de quien lo fichó; sin fichar, del último que estuvo en BOLT con él.',
          pinta: (v, f) => `<span class="block text-right font-semibold">${km(v)}</span>
            <span class="block h-1.5 mt-1 rounded-full bg-telecab-card2 overflow-hidden min-w-[6rem]" aria-hidden="true">
              <span class="block h-full ${ESTADO[f.estado].barra}" style="width:${Math.min(100, f.pct == null ? 100 : f.pct)}%"></span></span>` },
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
    if (d.justificado) return 'Le tocaba · J';
    if (d.programado) return d.trabajo ? 'Le tocaba · salió' : 'Le tocaba · no salió';
    if (d.trabajo) return 'Salió sin tocarle';
    return 'Libraba';
  }
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
      return `<tr class="border-b border-telecab-border/50 align-top">
        <td class="py-1.5 pr-2 whitespace-nowrap">${esc(diaLargo(d.dia))}</td>
        <td class="py-1.5 pr-2">${esc(queFue(d))}${d.horas ? ` <span class="text-telecab-muted">(${num(d.horas)} h)</span>` : ''} ${marcas}
          ${d.fichaje ? `<span class="block text-[11px] text-telecab-muted">Fichaje: ${esc(d.fichaje)}</span>` : ''}</td>
        <td class="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">${d.limite ? `+${km(d.limite)}` : '—'}</td>
        <td class="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap font-semibold">${d.km ? km(d.km) : '—'}</td>
        <td class="py-1.5 text-[11px] text-telecab-muted">${d.coches.map(c => `${esc(placa(c.matricula))} ${km(c.km)}`).join('<br>')}</td>
      </tr>`;
    }).join('');
    const est = ESTADO[f.estado];
    const p = Panel.abrir({
      titulo: f.nombre,
      subtitulo: `${textoSemana(datos.lunes, datos.domingo)}${f.turno ? ` · ${f.turno}` : ''}`,
      html: `<div class="grid grid-cols-3 gap-2 mb-3">
          <div class="tc-kpi" data-tono="muted"><p class="tc-kpi-etiqueta">Límite</p><p class="tc-kpi-valor">${km(f.limite)}</p></div>
          <div class="tc-kpi" data-tono="${f.estado === 'pasado' ? 'red' : f.estado === 'cerca' ? 'warn' : 'green'}"><p class="tc-kpi-etiqueta">Km fuera</p><p class="tc-kpi-valor">${km(f.km)}</p></div>
          <div class="tc-kpi" data-tono="${f.saldo < 0 ? 'red' : 'muted'}"><p class="tc-kpi-etiqueta">Saldo</p><p class="tc-kpi-valor">${f.saldo < 0 ? `−${km(-f.saldo)}` : km(f.saldo)}</p></div>
        </div>
        <p class="mb-3"><span class="tc-pastilla ${est.pastilla}">${esc(est.texto)}</span>
          <span class="text-xs text-telecab-muted ml-1">${f.programados} ${f.programados === 1 ? 'día le tocaba' : 'días le tocaban'}${f.extra ? `, ${f.extra} salió sin tocarle` : ''}</span></p>
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-[11px] uppercase tracking-wide text-telecab-muted text-left border-b border-telecab-border">
            <th class="py-1.5 pr-2 font-semibold">Día</th><th class="py-1.5 pr-2 font-semibold">Qué fue</th>
            <th class="py-1.5 pr-2 font-semibold text-right">Límite</th><th class="py-1.5 pr-2 font-semibold text-right">Km fuera</th>
            <th class="py-1.5 font-semibold">Coches</th></tr></thead>
          <tbody>${filas}</tbody></table></div>
        <p class="text-[11px] text-telecab-muted mt-2">Los km fuera de BOLT son los del reporte de Control: con el coche fichado por WhatsApp, de quien lo fichó (también si se le olvidó terminar el turno); sin fichar, del último que estuvo en BOLT con el coche.</p>
        <h3 class="text-xs uppercase tracking-wide text-telecab-muted font-semibold mt-5 mb-2">Sus últimas semanas</h3>
        <div data-historia class="text-sm text-telecab-muted">Cargando…</div>`,
    });
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
